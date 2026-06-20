/**
 * ============================================================
 * routes/hotels.js - Rute API pentru gestionarea hotelurilor (CRUD + configurare)
 * ============================================================
 *
 * Responsabilități:
 *  1. GET    /api/hotels                  – Listare hoteluri (cu filtre, paginare, căutare)
 *  2. GET    /api/hotels/:id              – Detalii hotel
 *  3. POST   /api/hotels                  – Creare hotel nou
 *  4. PUT    /api/hotels/:id              – Actualizare hotel
 *  5. PATCH  /api/hotels/:id/status       – Actualizare status hotel
 *  6. PATCH  /api/hotels/:id/facilities   – Actualizare facilități
 *  7. DELETE /api/hotels/:id              – Ștergere hotel
 *  8. GET    /api/hotels/:id/rooms        – Listare camere ale unui hotel
 *  9. GET    /api/hotels/:id/rooms/available – Camere disponibile
 * 10. POST   /api/hotels/:id/rooms        – Adăugare cameră nouă
 *
 * Folosește:
 *  - express-validator pentru validarea câmpurilor
 *  - hotelModel.js pentru operații CRUD pe hoteluri (export direct de funcții)
 *  - roomModel.js pentru operații pe camere
 *  - middleware/auth.js pentru autentificare
 *  - middleware/roles.js pentru autorizare pe bază de roluri
 *
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');

const {
  createHotel,
  getHotelById,
  getHotelsByTenant,
  updateHotel,
  deleteHotel,
  listAllHotels,
} = require('../models/hotelModel');

const {
  RoomModel,
  VALID_ROOM_TYPES,
  VALID_ROOM_STATUSES,
} = require('../models/roomModel');

const { authenticate } = require('../middleware/auth');
const { authorize, authorizeMinLevel } = require('../middleware/roles');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Instanțiere modele
// ---------------------------------------------------------------------------

const roomModel = new RoomModel();

// ---------------------------------------------------------------------------
// Statusuri valide pentru hoteluri (definite local, deoarece hotelModel
// exportă doar funcții, nu și constantele)
// ---------------------------------------------------------------------------

const VALID_HOTEL_STATUSES = ['active', 'inactive', 'maintenance', 'closed'];

// ---------------------------------------------------------------------------
// Câmpuri permise pentru sortare hoteluri
// ---------------------------------------------------------------------------

const VALID_HOTEL_SORT_FIELDS = ['nume', 'status', 'createdAt', 'updatedAt'];

// ---------------------------------------------------------------------------
// Helper: verificare rezultate validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă există erori de validare din express-validator.
 * Dacă da, trimite un răspuns 422 cu lista de erori.
 *
 * @param {Object} req  - Request Express
 * @param {Object} res  - Response Express
 * @param {Function} next - Next middleware
 * @returns {void}
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map((e) => e.msg);
    return next(new AppError(errorMessages.join('; '), 422, 'VALIDATION_ERROR'));
  }
  next();
}

// ---------------------------------------------------------------------------
// Helper: determinare tenantId pentru filtrare
// ---------------------------------------------------------------------------

/**
 * Determină tenantId-ul care trebuie folosit în interogări.
 * super_admin poate specifica un tenantId prin query param, ceilalți
 * utilizatori sunt limitați la propriul tenant.
 *
 * @param {Object} req - Request Express (cu req.user populat)
 * @returns {string|null} tenantId-ul de filtrat
 */
function resolveTenantId(req) {
  if (req.user.role === 'super_admin' && req.query.tenantId) {
    return req.query.tenantId;
  }
  return req.user.tenantId || null;
}

// ---------------------------------------------------------------------------
// Helper: sortare array hoteluri după un câmp
// ---------------------------------------------------------------------------

/**
 * Sortează un array de hoteluri după câmpul specificat.
 *
 * @param {Array}  hotels    - Array-ul de hoteluri
 * @param {string} sortField - Câmpul după care se sortează
 * @param {string} [order='asc'] - Direcția de sortare ('asc' sau 'desc')
 * @returns {Array} Array-ul sortat
 */
function sortHotels(hotels, sortField, order = 'asc') {
  if (!sortField || !VALID_HOTEL_SORT_FIELDS.includes(sortField)) {
    return hotels;
  }

  const sorted = [...hotels].sort((a, b) => {
    const valA = (a[sortField] || '').toString().toLowerCase();
    const valB = (b[sortField] || '').toString().toLowerCase();

    if (valA < valB) return -1;
    if (valA > valB) return 1;
    return 0;
  });

  return order === 'desc' ? sorted.reverse() : sorted;
}

// ---------------------------------------------------------------------------
// Helper: aplică paginare pe un array
// ---------------------------------------------------------------------------

/**
 * Aplică skip și limit pe un array de rezultate.
 *
 * @param {Array}  array - Array-ul de rezultate
 * @param {number} [skip=0]  - Câte elemente se sar
 * @param {number} [limit]   - Numărul maxim de elemente returnate
 * @returns {Array} Sub-array-ul paginat
 */
function paginateArray(array, skip = 0, limit) {
  const start = skip || 0;
  const end = limit ? start + limit : undefined;
  return array.slice(start, end);
}

// ---------------------------------------------------------------------------
// GET /api/hotels
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hotels
 * @desc    Listare hoteluri cu opțiuni de filtrare, căutare și paginare
 * @access  Privat (autentificare necesară)
 *
 * Query params:
 *   - status    {string}  opțional – filtrare după status
 *   - search    {string}  opțional – căutare după nume
 *   - tenantId  {string}  opțional – (doar super_admin) filtrare după tenant
 *   - sort      {string}  opțional – câmp după care se sortează (nume, status, createdAt, updatedAt)
 *   - order     {string}  opțional – direcția de sortare ('asc' sau 'desc', implicit 'asc')
 *   - limit     {number}  opțional – număr maxim de rezultate
 *   - skip      {number}  opțional – câte rezultate se sar
 *
 * Răspuns (200):
 *   {
 *     success: true,
 *     data: { hotels, total, limit, skip }
 *   }
 */
router.get(
  '/',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    query('status')
      .optional()
      .isIn(VALID_HOTEL_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_HOTEL_STATUSES.join(', ')}.`),
    query('search')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1 })
      .withMessage('Termenul de căutare trebuie să aibă cel puțin 1 caracter.'),
    query('sort')
      .optional()
      .isIn(VALID_HOTEL_SORT_FIELDS)
      .withMessage(`Câmpul de sortare trebuie să fie unul dintre: ${VALID_HOTEL_SORT_FIELDS.join(', ')}.`),
    query('order')
      .optional()
      .isIn(['asc', 'desc'])
      .withMessage('Direcția de sortare trebuie să fie "asc" sau "desc".'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit trebuie să fie un număr între 1 și 100.'),
    query('skip')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Skip trebuie să fie un număr întreg, mai mare sau egal cu 0.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { status, search, sort, order, limit, skip } = req.query;
      const tenantId = resolveTenantId(req);

      // Parsează opțiunile de paginare
      const parsedLimit = limit ? parseInt(limit, 10) : null;
      const parsedSkip = skip ? parseInt(skip, 10) : 0;

      // Dacă nu avem tenantId (utilizator fără tenant și nu e super_admin),
      // returnăm listă goală
      if (!tenantId && req.user.role !== 'super_admin') {
        return res.status(200).json({
          success: true,
          data: {
            hotels: [],
            total: 0,
            limit: parsedLimit,
            skip: parsedSkip,
          },
        });
      }

      let hotels;
      let total;

      if (search) {
        // Căutare după nume – filtrăm din lista tenantului
        const allHotels = await getHotelsByTenant(tenantId);
        const searchLower = search.toLowerCase();
        hotels = allHotels.filter((h) => h.nume && h.nume.toLowerCase().includes(searchLower));
      } else if (status) {
        // Filtrare după status – filtrăm din lista tenantului
        const allHotels = await getHotelsByTenant(tenantId);
        hotels = allHotels.filter((h) => h.status === status);
      } else {
        // Listare toate hotelurile tenant-ului
        hotels = await getHotelsByTenant(tenantId);
      }

      // Aplică sortarea (dacă este specificată)
      if (sort) {
        hotels = sortHotels(hotels, sort, order || 'asc');
      }

      // Păstrează totalul înainte de paginare
      total = hotels.length;

      // Aplică paginarea
      hotels = paginateArray(hotels, parsedSkip, parsedLimit);

      res.status(200).json({
        success: true,
        data: {
          hotels,
          total,
          limit: parsedLimit,
          skip: parsedSkip,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/hotels/:id
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hotels/:id
 * @desc    Obține detaliile unui hotel după ID
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { hotel } }
 */
router.get(
  '/:id',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const hotel = await getHotelById(id);

      if (!hotel) {
        return next(new AppError(
          'Hotelul nu a fost găsit.',
          404,
          'HOTEL_NOT_FOUND'
        ));
      }

      // Verificare acces tenant (doar super_admin poate vedea hoteluri din alt tenant)
      if (req.user.role !== 'super_admin') {
        if (String(hotel.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest hotel.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      res.status(200).json({
        success: true,
        data: {
          hotel,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/hotels
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/hotels
 * @desc    Creează un hotel nou
 * @access  Privat (autentificare + rol manager, owner sau super_admin)
 *
 * Body (JSON):
 *   - nume        {string}  obligatoriu – numele hotelului
 *   - adresă      {string}  obligatoriu – adresa hotelului
 *   - facilități  {string[]} opțional – lista facilităților
 *   - configurareCamere {Object[]} opțional – configurarea camerelor
 *   - prețuriSezoniere  {Object[]} opțional – prețuri sezoniere
 *   - telefon     {string}  opțional – număr de telefon
 *   - email       {string}  opțional – email de contact
 *   - descriere   {string}  opțional – descrierea hotelului
 *   - status      {string}  opțional – statusul (implicit 'active')
 *
 * Răspuns (201):
 *   { success: true, data: { hotel } }
 */
router.post(
  '/',
  authenticate,
  authorizeMinLevel('manager'),
  [
    body('nume')
      .isString()
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage('Numele hotelului trebuie să aibă între 1 și 200 de caractere.'),
    body('adresă')
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage('Adresa hotelului trebuie să aibă între 5 și 500 de caractere.'),
    body('facilități')
      .optional({ values: 'null' })
      .isArray()
      .withMessage('Facilitățile trebuie să fie o listă.'),
    body('facilități.*')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare facilitate trebuie să fie un șir de caractere nevid.'),
    body('telefon')
      .optional({ values: 'null' })
      .isString()
      .withMessage('Telefonul trebuie să fie un șir de caractere.'),
    body('email')
      .optional({ values: 'null' })
      .isEmail()
      .withMessage('Adresa de email nu este validă.')
      .normalizeEmail(),
    body('descriere')
      .optional({ values: 'null' })
      .isString()
      .isLength({ max: 2000 })
      .withMessage('Descrierea poate avea maximum 2000 de caractere.'),
    body('status')
      .optional()
      .isIn(VALID_HOTEL_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_HOTEL_STATUSES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { nume, adresă, facilități, configurareCamere, prețuriSezoniere, telefon, email, descriere, status } = req.body;

      // Determinare tenantId
      const tenantId = resolveTenantId(req);

      if (!tenantId) {
        return next(new AppError(
          'Nu poți crea un hotel fără un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const hotelData = {
        nume,
        adresă,
        facilități: facilități || [],
        configurareCamere: configurareCamere || [],
        prețuriSezoniere: prețuriSezoniere || [],
        telefon: telefon || '',
        email: email || '',
        descriere: descriere || '',
        status: status || 'active',
        tenantId,
      };

      const newHotel = await createHotel(hotelData);

      res.status(201).json({
        success: true,
        data: {
          hotel: newHotel,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/hotels/:id
// ---------------------------------------------------------------------------

/**
 * @route   PUT /api/hotels/:id
 * @desc    Actualizează un hotel existent
 * @access  Privat (autentificare + rol manager, owner sau super_admin)
 *
 * Body (JSON) – cel puțin un câmp obligatoriu:
 *   - nume        {string}  opțional
 *   - adresă      {string}  opțional
 *   - facilități  {string[]} opțional
 *   - configurareCamere {Object[]} opțional
 *   - prețuriSezoniere  {Object[]} opțional
 *   - telefon     {string}  opțional
 *   - email       {string}  opțional
 *   - descriere   {string}  opțional
 *   - status      {string}  opțional
 *
 * Răspuns (200):
 *   { success: true, data: { hotel } }
 */
router.put(
  '/:id',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
    body('nume')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage('Numele hotelului trebuie să aibă între 1 și 200 de caractere.'),
    body('adresă')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage('Adresa hotelului trebuie să aibă între 5 și 500 de caractere.'),
    body('facilități')
      .optional({ values: 'null' })
      .isArray()
      .withMessage('Facilitățile trebuie să fie o listă.'),
    body('facilități.*')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare facilitate trebuie să fie un șir de caractere nevid.'),
    body('telefon')
      .optional({ values: 'null' })
      .isString()
      .withMessage('Telefonul trebuie să fie un șir de caractere.'),
    body('email')
      .optional({ values: 'null' })
      .isEmail()
      .withMessage('Adresa de email nu este validă.')
      .normalizeEmail(),
    body('descriere')
      .optional({ values: 'null' })
      .isString()
      .isLength({ max: 2000 })
      .withMessage('Descrierea poate avea maximum 2000 de caractere.'),
    body('status')
      .optional()
      .isIn(VALID_HOTEL_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_HOTEL_STATUSES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Verificare existență și acces la hotel
      const existingHotel = await getHotelById(id);
      if (!existingHotel) {
        return next(new AppError(
          'Hotelul nu a fost găsit.',
          404,
          'HOTEL_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingHotel.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest hotel.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      // Construim obiectul doar cu câmpurile prezente în body
      const allowedFields = [
        'nume', 'adresă', 'facilități', 'configurareCamere',
        'prețuriSezoniere', 'telefon', 'email', 'descriere', 'status',
      ];
      const updateData = {};

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      }

      if (Object.keys(updateData).length === 0) {
        return next(new AppError(
          'Nu s-au furnizat câmpuri pentru actualizare.',
          400,
          'EMPTY_UPDATE_DATA'
        ));
      }

      const updatedHotel = await updateHotel(id, updateData);

      res.status(200).json({
        success: true,
        data: {
          hotel: updatedHotel,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/hotels/:id/status
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/hotels/:id/status
 * @desc    Actualizează statusul unui hotel
 * @access  Privat (autentificare + rol manager, owner sau super_admin)
 *
 * Body (JSON):
 *   - status  {string}  obligatoriu – noul status
 *
 * Răspuns (200):
 *   { success: true, data: { hotel } }
 */
router.patch(
  '/:id/status',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
    body('status')
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_HOTEL_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_HOTEL_STATUSES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      // Verificare existență și acces
      const existingHotel = await getHotelById(id);
      if (!existingHotel) {
        return next(new AppError(
          'Hotelul nu a fost găsit.',
          404,
          'HOTEL_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(existingHotel.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest hotel.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedHotel = await updateHotel(id, { status });

      res.status(200).json({
        success: true,
        data: {
          hotel: updatedHotel,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/hotels/:id/facilities
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/hotels/:id/facilities
 * @desc    Actualizează lista de facilități a unui hotel
 * @access  Privat (autentificare + rol manager, owner sau super_admin)
 *
 * Body (JSON):
 *   - facilități  {string[]}  obligatoriu – noua listă de facilități
 *
 * Răspuns (200):
 *   { success: true, data: { hotel } }
 */
router.patch(
  '/:id/facilities',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
    body('facilități')
      .isArray({ min: 1 })
      .withMessage('Lista de facilități trebuie să conțină cel puțin un element.'),
    body('facilități.*')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare facilitate trebuie să fie un șir de caractere nevid.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { facilități } = req.body;

      // Verificare existență și acces
      const existingHotel = await getHotelById(id);
      if (!existingHotel) {
        return next(new AppError(
          'Hotelul nu a fost găsit.',
          404,
          'HOTEL_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(existingHotel.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest hotel.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedHotel = await updateHotel(id, {
        facilități: facilități.map((f) => f.trim()),
      });

      res.status(200).json({
        success: true,
        data: {
          hotel: updatedHotel,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/hotels/:id
// ---------------------------------------------------------------------------

/**
 * @route   DELETE /api/hotels/:id
 * @desc    Șterge un hotel
 * @access  Privat (autentificare + rol owner sau super_admin)
 *
 * Răspuns (200):
 *   { success: true, data: { message: 'Hotelul a fost șters cu succes.' } }
 */
router.delete(
  '/:id',
  authenticate,
  authorize('super_admin', 'owner'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Verificare existență
      const existingHotel = await getHotelById(id);
      if (!existingHotel) {
        return next(new AppError(
          'Hotelul nu a fost găsit.',
          404,
          'HOTEL_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingHotel.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest hotel.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      await deleteHotel(id);

      res.status(200).json({
        success: true,
        data: {
          message: 'Hotelul a fost șters cu succes.',
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/hotels/:id/rooms
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hotels/:id/rooms
 * @desc    Listare camere ale unui hotel
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { rooms } }
 */
router.get(
  '/:id/rooms',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
    query('status')
      .optional()
      .isIn(VALID_ROOM_STATUSES)
      .withMessage(`Statusul camerei trebuie să fie unul dintre: ${VALID_ROOM_STATUSES.join(', ')}.`),
    query('tip')
      .optional()
      .isIn(VALID_ROOM_TYPES)
      .withMessage(`Tipul camerei trebuie să fie unul dintre: ${VALID_ROOM_TYPES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status, tip } = req.query;

      // Verificare existență și acces hotel
      const hotel = await getHotelById(id);
      if (!hotel) {
        return next(new AppError(
          'Hotelul nu a fost găsit.',
          404,
          'HOTEL_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(hotel.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest hotel.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      let rooms;
      if (status && tip) {
        // Filtrăm după hotel, status și tip
        const allRooms = await roomModel.findByHotel(id);
        rooms = allRooms.filter((room) => room.status === status && room.tip === tip);
      } else if (status) {
        // Filtrăm doar după hotel și status
        rooms = await roomModel.findByHotelAndStatus(id, status);
      } else if (tip) {
        // Filtrăm doar după hotel și tip
        rooms = await roomModel.findByHotelAndType(id, tip);
      } else {
        // Fără filtre - toate camerele hotelului
        rooms = await roomModel.findByHotel(id);
      }

      res.status(200).json({
        success: true,
        data: {
          rooms,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/hotels/:id/rooms/available
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hotels/:id/rooms/available
 * @desc    Listare camere disponibile ale unui hotel
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { rooms } }
 */
router.get(
  '/:id/rooms/available',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Verificare existență și acces hotel
      const hotel = await getHotelById(id);
      if (!hotel) {
        return next(new AppError(
          'Hotelul nu a fost găsit.',
          404,
          'HOTEL_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(hotel.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest hotel.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const rooms = await roomModel.findByHotelAndStatus(id, 'available');

      res.status(200).json({
        success: true,
        data: {
          rooms,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/hotels/:id/rooms
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/hotels/:id/rooms
 * @desc    Adaugă o cameră nouă într-un hotel
 * @access  Privat (autentificare + rol manager, owner sau super_admin)
 *
 * Body (JSON):
 *   - tip              {string}   obligatoriu – tipul camerei
 *   - număr            {number}   obligatoriu – numărul camerei
 *   - prețuriSezoniere {Object[]} opțional – prețuri sezoniere
 *   - status           {string}   opțional – statusul (implicit 'available')
 *
 * Răspuns (201):
 *   { success: true, data: { room } }
 */
router.post(
  '/:id/rooms',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
    body('tip')
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_ROOM_TYPES)
      .withMessage(`Tipul camerei trebuie să fie unul dintre: ${VALID_ROOM_TYPES.join(', ')}.`),
    body('număr')
      .isInt({ min: 1 })
      .withMessage('Numărul camerei trebuie să fie un număr întreg pozitiv.'),
    body('prețuriSezoniere')
      .optional({ values: 'null' })
      .isArray()
      .withMessage('Prețurile sezoniere trebuie să fie o listă.'),
    body('prețuriSezoniere.*.sezon')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Denumirea sezonului este obligatorie pentru fiecare preț sezonier.'),
    body('prețuriSezoniere.*.preț')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Prețul sezonier trebuie să fie un număr pozitiv.'),
    body('status')
      .optional()
      .isIn(VALID_ROOM_STATUSES)
      .withMessage(`Statusul camerei trebuie să fie unul dintre: ${VALID_ROOM_STATUSES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { tip, număr, prețuriSezoniere, status } = req.body;

      // Verificare existență și acces hotel
      const hotel = await getHotelById(id);
      if (!hotel) {
        return next(new AppError(
          'Hotelul nu a fost găsit.',
          404,
          'HOTEL_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(hotel.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest hotel.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const roomData = {
        tip,
        număr,
        prețuriSezoniere: prețuriSezoniere || [],
        status: status || 'available',
        hotelId: id,
        tenantId: hotel.tenantId,
      };

      const newRoom = await roomModel.create(roomData);

      res.status(201).json({
        success: true,
        data: {
          room: newRoom,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = router;