/**
 * ============================================================
 * routes/reservations.js - Rute API pentru gestionarea rezervărilor (CRUD + căutare)
 * ============================================================
 *
 * Responsabilități:
 *  1. GET    /api/reservations                          – Listare rezervări (cu filtre, paginare)
 *  2. GET    /api/reservations/:id                      – Detalii rezervare
 *  3. POST   /api/reservations                          – Creare rezervare nouă
 *  4. PUT    /api/reservations/:id                      – Actualizare rezervare
 *  5. PATCH  /api/reservations/:id/status               – Actualizare status rezervare
 *  6. DELETE /api/reservations/:id                      – Ștergere rezervare
 *  7. GET    /api/reservations/restaurant/:restaurantId – Listare rezervări per restaurant
 *  8. GET    /api/reservations/hotel/:hotelId           – Listare rezervări per hotel
 *  9. GET    /api/reservations/date/:data               – Listare rezervări per dată
 * 10. GET    /api/reservations/status/:status           – Listare rezervări per status
 * 11. GET    /api/reservations/person/search            – Căutare rezervări după persoană
 * 12. GET    /api/reservations/tenant                   – Listare toate rezervările tenant-ului
 * 13. POST   /api/reservations/:id/checkin              – Check-in rezervare hotel
 * 14. POST   /api/reservations/:id/checkout             – Check-out rezervare hotel
 * 15. PATCH  /api/reservations/:id/billing              – Actualizare facturare sejur
 * 16. GET    /api/reservations/guest/:guestId/history   – Istoric oaspeți
 * 17. GET    /api/reservations/:id/billing              – Obține sumar facturare
 *
 * Folosește:
 *  - express-validator pentru validarea câmpurilor
 *  - reservationModel.js pentru operații CRUD pe rezervări
 *  - middleware/auth.js pentru autentificare
 *  - middleware/roles.js pentru autorizare pe bază de roluri
 *
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');

const {
  createReservation,
  findReservationById,
  findReservationsByRestaurant,
  findReservationsByHotel,
  findReservationsByTenant,
  findReservationsByPerson,
  findReservationsByStatus,
  findReservationsByDate,
  updateReservation,
  updateReservationStatus,
  deleteReservation,
  findReservationsByGuestId,
  updateReservationBilling,
  findReservationsByCheckInDate,
  findReservationsByCheckOutDate,
  checkInReservation,
  checkOutReservation,
  getReservationBillingSummary,
  VALID_RESERVATION_TYPES,
  VALID_RESERVATION_STATUSES,
  VALID_BILLING_STATUSES,
} = require('../models/reservationModel');

const { authenticate } = require('../middleware/auth');
const { authorize, authorizeMinLevel } = require('../middleware/roles');
const { AppError } = require('../middleware/errorHandler');

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
// Helper: determinare tenantId din utilizator
// ---------------------------------------------------------------------------

/**
 * Determină tenantId-ul pe baza utilizatorului autentificat.
 *
 * @param {Object} req - Request Express (cu req.user populat)
 * @returns {string|null} tenantId-ul
 */
function resolveUserTenantId(req) {
  if (req.user && req.user.tenantId) {
    return req.user.tenantId;
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/reservations
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/reservations
 * @desc    Listare rezervări cu opțiuni de filtrare și paginare
 * @access  Privat (autentificare necesară)
 *
 * Query params:
 *   - tip        {string}  opțional – filtrare după tip ('restaurant' | 'hotel')
 *   - status     {string}  opțional – filtrare după status
 *   - data       {string}  opțional – filtrare după dată (YYYY-MM-DD)
 *   - restaurantId {string} opțional – filtrare după restaurant
 *   - hotelId    {string}  opțional – filtrare după hotel
 *   - sort       {string}  opțional – câmp după care se sortează (ex: data, -data)
 *   - limit      {number}  opțional – număr maxim de rezultate
 *   - skip       {number}  opțional – câte rezultate se sar
 *
 * Răspuns (200):
 *   { success: true, data: { reservations, limit, skip } }
 */
router.get(
  '/',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    query('tip')
      .optional()
      .isIn(VALID_RESERVATION_TYPES)
      .withMessage(`Tipul trebuie să fie unul dintre: ${VALID_RESERVATION_TYPES.join(', ')}.`),
    query('status')
      .optional()
      .isIn(VALID_RESERVATION_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_RESERVATION_STATUSES.join(', ')}.`),
    query('data')
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('Data trebuie să fie în format YYYY-MM-DD.'),
    query('restaurantId')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul restaurantului trebuie să fie un șir nevid.'),
    query('hotelId')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului trebuie să fie un șir nevid.'),
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
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const { tip, status, data, restaurantId, hotelId, sort, limit, skip } = req.query;

      const options = {};
      if (tip) options.tip = tip;
      if (status) options.status = status;
      if (data) options.data = data;
      if (restaurantId) options.restaurantId = restaurantId;
      if (hotelId) options.hotelId = hotelId;
      if (sort) options.sort = sort;
      if (limit) options.limit = parseInt(limit, 10);
      if (skip) options.skip = parseInt(skip, 10);

      const reservations = await findReservationsByTenant(tenantId, options);

      res.status(200).json({
        success: true,
        data: {
          reservations,
          limit: options.limit || null,
          skip: options.skip || 0,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/reservations/tenant
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/reservations/tenant
 * @desc    Listare toate rezervările tenant-ului curent
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { reservations } }
 */
router.get(
  '/tenant',
  authenticate,
  authorizeMinLevel('recepție'),
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const reservations = await findReservationsByTenant(tenantId);

      res.status(200).json({
        success: true,
        data: { reservations },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/reservations/restaurant/:restaurantId
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/reservations/restaurant/:restaurantId
 * @desc    Listare rezervări pentru un restaurant specific
 * @access  Privat (autentificare necesară)
 *
 * Query params:
 *   - status  {string}  opțional – filtrare după status
 *   - data    {string}  opțional – filtrare după dată (YYYY-MM-DD)
 *   - masa    {number}  opțional – filtrare după număr masă
 *
 * Răspuns (200):
 *   { success: true, data: { reservations } }
 */
router.get(
  '/restaurant/:restaurantId',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('restaurantId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul restaurantului este obligatoriu.'),
    query('status')
      .optional()
      .isIn(VALID_RESERVATION_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_RESERVATION_STATUSES.join(', ')}.`),
    query('data')
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('Data trebuie să fie în format YYYY-MM-DD.'),
    query('masa')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Numărul mesei trebuie să fie un număr întreg pozitiv.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const { restaurantId } = req.params;
      const { status, data, masa, sort, limit, skip } = req.query;

      const options = {};
      if (status) options.status = status;
      if (data) options.data = data;
      if (masa) options.masa = parseInt(masa, 10);
      if (sort) options.sort = sort;
      if (limit) options.limit = limit ? parseInt(limit, 10) : undefined;
      if (skip) options.skip = skip ? parseInt(skip, 10) : undefined;

      const reservations = await findReservationsByRestaurant(restaurantId, tenantId, options);

      res.status(200).json({
        success: true,
        data: { reservations },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/reservations/hotel/:hotelId
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/reservations/hotel/:hotelId
 * @desc    Listare rezervări pentru un hotel specific
 * @access  Privat (autentificare necesară)
 *
 * Query params:
 *   - status  {string}  opțional – filtrare după status
 *   - data    {string}  opțional – filtrare după dată (YYYY-MM-DD)
 *   - camera  {string}  opțional – filtrare după cameră
 *
 * Răspuns (200):
 *   { success: true, data: { reservations } }
 */
router.get(
  '/hotel/:hotelId',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('hotelId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
    query('status')
      .optional()
      .isIn(VALID_RESERVATION_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_RESERVATION_STATUSES.join(', ')}.`),
    query('data')
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('Data trebuie să fie în format YYYY-MM-DD.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const { hotelId } = req.params;
      const { status, data, camera, sort, limit, skip } = req.query;

      const options = {};
      if (status) options.status = status;
      if (data) options.data = data;
      if (camera) options.camera = camera;
      if (sort) options.sort = sort;
      if (limit) options.limit = limit ? parseInt(limit, 10) : undefined;
      if (skip) options.skip = skip ? parseInt(skip, 10) : undefined;

      const reservations = await findReservationsByHotel(hotelId, tenantId, options);

      res.status(200).json({
        success: true,
        data: { reservations },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/reservations/date/:data
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/reservations/date/:data
 * @desc    Listare rezervări pentru o dată specifică
 * @access  Privat (autentificare necesară)
 *
 * Query params:
 *   - tip          {string}  opțional – filtrare după tip
 *   - restaurantId {string}  opțional – filtrare după restaurant (dacă tip='restaurant')
 *   - hotelId      {string}  opțional – filtrare după hotel (dacă tip='hotel')
 *   - status       {string}  opțional – filtrare după status
 *
 * Răspuns (200):
 *   { success: true, data: { reservations } }
 */
router.get(
  '/date/:data',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('data')
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('Data trebuie să fie în format YYYY-MM-DD.'),
    query('tip')
      .optional()
      .isIn(VALID_RESERVATION_TYPES)
      .withMessage(`Tipul trebuie să fie unul dintre: ${VALID_RESERVATION_TYPES.join(', ')}.`),
    query('restaurantId')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul restaurantului trebuie să fie un șir nevid.'),
    query('hotelId')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului trebuie să fie un șir nevid.'),
    query('status')
      .optional()
      .isIn(VALID_RESERVATION_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_RESERVATION_STATUSES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const { data } = req.params;
      const { tip, restaurantId, hotelId, status, sort, limit, skip } = req.query;

      const options = {};
      if (tip) options.tip = tip;
      if (restaurantId) options.restaurantId = restaurantId;
      if (hotelId) options.hotelId = hotelId;
      if (status) options.status = status;
      if (sort) options.sort = sort;
      if (limit) options.limit = limit ? parseInt(limit, 10) : undefined;
      if (skip) options.skip = skip ? parseInt(skip, 10) : undefined;

      const reservations = await findReservationsByDate(data, tenantId, options);

      res.status(200).json({
        success: true,
        data: { reservations },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/reservations/status/:status
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/reservations/status/:status
 * @desc    Listare rezervări după status
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { reservations } }
 */
router.get(
  '/status/:status',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('status')
      .isIn(VALID_RESERVATION_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_RESERVATION_STATUSES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const { status } = req.params;
      const { sort, limit, skip } = req.query;

      const options = {};
      if (sort) options.sort = sort;
      if (limit) options.limit = limit ? parseInt(limit, 10) : undefined;
      if (skip) options.skip = skip ? parseInt(skip, 10) : undefined;

      const reservations = await findReservationsByStatus(status, tenantId, options);

      res.status(200).json({
        success: true,
        data: { reservations },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/reservations/person/search
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/reservations/person/search
 * @desc    Căutare rezervări după persoană
 * @access  Privat (autentificare necesară)
 *
 * Query params:
 *   - q {string} obligatoriu – termen de căutare (nume, email, telefon)
 *
 * Răspuns (200):
 *   { success: true, data: { reservations } }
 */
router.get(
  '/person/search',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    query('q')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Termenul de căutare (q) este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const { q, sort, limit, skip } = req.query;

      const options = {};
      if (sort) options.sort = sort;
      if (limit) options.limit = limit ? parseInt(limit, 10) : undefined;
      if (skip) options.skip = skip ? parseInt(skip, 10) : undefined;

      const reservations = await findReservationsByPerson(q, tenantId, options);

      res.status(200).json({
        success: true,
        data: { reservations },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/reservations/:id
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/reservations/:id
 * @desc    Obține detaliile unei rezervări
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { reservation } }
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
      .withMessage('ID-ul rezervării este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const reservation = await findReservationById(req.params.id, tenantId);
      if (!reservation) {
        return next(new AppError('Rezervarea nu a fost găsită.', 404, 'NOT_FOUND'));
      }

      res.status(200).json({
        success: true,
        data: { reservation },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/reservations
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/reservations
 * @desc    Creare rezervare nouă
 * @access  Privat (autentificare necesară)
 *
 * Body (JSON):
 *   - tip            {string} obligatoriu – 'restaurant' | 'hotel'
 *   - restaurantId   {string} opțional – ID restaurant (dacă tip='restaurant')
 *   - hotelId        {string} opțional – ID hotel (dacă tip='hotel')
 *   - data           {string} obligatoriu – data rezervării (YYYY-MM-DD)
 *   - ora            {string} opțional – ora (HH:mm)
 *   - numarPersoane  {number} obligatoriu – număr persoane
 *   - numeClient     {string} obligatoriu – nume client
 *   - emailClient    {string} obligatoriu – email client
 *   - telefonClient  {string} obligatoriu – telefon client
 *   - observatii     {string} opțional – observații
 *   - masa           {number} opțional – număr masă (restaurant)
 *   - camera         {string} opțional – cameră (hotel)
 *   - checkIn        {string} opțional – dată check-in (YYYY-MM-DD)
 *   - checkOut       {string} opțional – dată check-out (YYYY-MM-DD)
 *
 * Răspuns (201):
 *   { success: true, data: { reservation } }
 */
router.post(
  '/',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    body('tip')
      .isIn(VALID_RESERVATION_TYPES)
      .withMessage(`Tipul trebuie să fie unul dintre: ${VALID_RESERVATION_TYPES.join(', ')}.`),
    body('data')
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('Data trebuie să fie în format YYYY-MM-DD.'),
    body('numarPersoane')
      .isInt({ min: 1 })
      .withMessage('Numărul de persoane trebuie să fie un număr întreg pozitiv.'),
    body('numeClient')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Numele clientului este obligatoriu.'),
    body('emailClient')
      .isEmail()
      .withMessage('Email-ul clientului nu este valid.'),
    body('telefonClient')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Telefonul clientului este obligatoriu.'),
    body('restaurantId')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul restaurantului trebuie să fie un șir nevid.'),
    body('hotelId')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului trebuie să fie un șir nevid.'),
    body('ora')
      .optional()
      .matches(/^\d{2}:\d{2}$/)
      .withMessage('Ora trebuie să fie în format HH:mm.'),
    body('observatii')
      .optional()
      .isString()
      .trim()
      .withMessage('Observațiile trebuie să fie un șir.'),
    body('masa')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Numărul mesei trebuie să fie un număr întreg pozitiv.'),
    body('camera')
      .optional()
      .isString()
      .trim()
      .withMessage('Camera trebuie să fie un șir.'),
    body('checkIn')
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('Data de check-in trebuie să fie în format YYYY-MM-DD.'),
    body('checkOut')
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('Data de check-out trebuie să fie în format YYYY-MM-DD.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const reservationData = { ...req.body, tenantId };
      const reservation = await createReservation(reservationData);

      res.status(201).json({
        success: true,
        data: { reservation },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/reservations/:id
// ---------------------------------------------------------------------------

/**
 * @route   PUT /api/reservations/:id
 * @desc    Actualizare completă rezervare
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { reservation } }
 */
router.put(
  '/:id',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul rezervării este obligatoriu.'),
    body('tip')
      .optional()
      .isIn(VALID_RESERVATION_TYPES)
      .withMessage(`Tipul trebuie să fie unul dintre: ${VALID_RESERVATION_TYPES.join(', ')}.`),
    body('data')
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('Data trebuie să fie în format YYYY-MM-DD.'),
    body('numarPersoane')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Numărul de persoane trebuie să fie un număr întreg pozitiv.'),
    body('numeClient')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Numele clientului nu poate fi gol.'),
    body('emailClient')
      .optional()
      .isEmail()
      .withMessage('Email-ul clientului nu este valid.'),
    body('telefonClient')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Telefonul clientului nu poate fi gol.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const reservation = await updateReservation(req.params.id, tenantId, req.body);
      if (!reservation) {
        return next(new AppError('Rezervarea nu a fost găsită.', 404, 'NOT_FOUND'));
      }

      res.status(200).json({
        success: true,
        data: { reservation },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/reservations/:id/status
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/reservations/:id/status
 * @desc    Actualizare status rezervare
 * @access  Privat (autentificare necesară)
 *
 * Body (JSON):
 *   - status {string} obligatoriu – noul status
 *
 * Răspuns (200):
 *   { success: true, data: { reservation } }
 */
router.patch(
  '/:id/status',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul rezervării este obligatoriu.'),
    body('status')
      .isIn(VALID_RESERVATION_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_RESERVATION_STATUSES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const reservation = await updateReservationStatus(req.params.id, tenantId, req.body.status);
      if (!reservation) {
        return next(new AppError('Rezervarea nu a fost găsită.', 404, 'NOT_FOUND'));
      }

      res.status(200).json({
        success: true,
        data: { reservation },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/reservations/:id
// ---------------------------------------------------------------------------

/**
 * @route   DELETE /api/reservations/:id
 * @desc    Ștergere rezervare
 * @access  Privat (autentificare necesară, admin)
 *
 * Răspuns (200):
 *   { success: true, message: 'Rezervarea a fost ștearsă.' }
 */
router.delete(
  '/:id',
  authenticate,
  authorize('admin'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul rezervării este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const deleted = await deleteReservation(req.params.id, tenantId);
      if (!deleted) {
        return next(new AppError('Rezervarea nu a fost găsită.', 404, 'NOT_FOUND'));
      }

      res.status(200).json({
        success: true,
        message: 'Rezervarea a fost ștearsă.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/reservations/:id/checkin
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/reservations/:id/checkin
 * @desc    Check-in rezervare hotel
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { reservation } }
 */
router.post(
  '/:id/checkin',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul rezervării este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const reservation = await checkInReservation(req.params.id, tenantId);
      if (!reservation) {
        return next(new AppError('Rezervarea nu a fost găsită.', 404, 'NOT_FOUND'));
      }

      res.status(200).json({
        success: true,
        data: { reservation },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/reservations/:id/checkout
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/reservations/:id/checkout
 * @desc    Check-out rezervare hotel
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { reservation } }
 */
router.post(
  '/:id/checkout',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul rezervării este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const reservation = await checkOutReservation(req.params.id, tenantId);
      if (!reservation) {
        return next(new AppError('Rezervarea nu a fost găsită.', 404, 'NOT_FOUND'));
      }

      res.status(200).json({
        success: true,
        data: { reservation },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/reservations/:id/billing
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/reservations/:id/billing
 * @desc    Actualizare facturare sejur
 * @access  Privat (autentificare necesară)
 *
 * Body (JSON):
 *   - statusFacturare {string} obligatoriu – status facturare
 *   - sumaTotala      {number} opțional – suma totală
 *   - moneda          {string} opțional – moneda (ex: RON, EUR)
 *
 * Răspuns (200):
 *   { success: true, data: { reservation } }
 */
router.patch(
  '/:id/billing',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul rezervării este obligatoriu.'),
    body('statusFacturare')
      .isIn(VALID_BILLING_STATUSES)
      .withMessage(`Statusul de facturare trebuie să fie unul dintre: ${VALID_BILLING_STATUSES.join(', ')}.`),
    body('sumaTotala')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Suma totală trebuie să fie un număr pozitiv.'),
    body('moneda')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 3, max: 3 })
      .withMessage('Moneda trebuie să fie un cod de 3 caractere (ex: RON, EUR).'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const reservation = await updateReservationBilling(req.params.id, tenantId, req.body);
      if (!reservation) {
        return next(new AppError('Rezervarea nu a fost găsită.', 404, 'NOT_FOUND'));
      }

      res.status(200).json({
        success: true,
        data: { reservation },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/reservations/guest/:guestId/history
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/reservations/guest/:guestId/history
 * @desc    Istoric rezervări pentru un oaspete
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { reservations } }
 */
router.get(
  '/guest/:guestId/history',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('guestId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul oaspetelui este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const { sort, limit, skip } = req.query;

      const options = {};
      if (sort) options.sort = sort;
      if (limit) options.limit = limit ? parseInt(limit, 10) : undefined;
      if (skip) options.skip = skip ? parseInt(skip, 10) : undefined;

      const reservations = await findReservationsByGuestId(req.params.guestId, tenantId, options);

      res.status(200).json({
        success: true,
        data: { reservations },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/reservations/:id/billing
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/reservations/:id/billing
 * @desc    Obține sumar facturare pentru o rezervare
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { billingSummary } }
 */
router.get(
  '/:id/billing',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul rezervării este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError('Nu ai un tenant asociat.', 400, 'MISSING_TENANT_ID'));
      }

      const billingSummary = await getReservationBillingSummary(req.params.id, tenantId);
      if (!billingSummary) {
        return next(new AppError('Rezervarea nu a fost găsită.', 404, 'NOT_FOUND'));
      }

      res.status(200).json({
        success: true,
        data: { billingSummary },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;