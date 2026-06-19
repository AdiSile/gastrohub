/**
 * ============================================================
 * routes/restaurants.js - Rute API pentru gestionarea restaurantelor (CRUD + configurare)
 * ============================================================
 *
 * Responsabilități:
 *  1. GET    /api/restaurants       – Listare restaurante (cu filtre, paginare, căutare)
 *  2. GET    /api/restaurants/:id   – Detalii restaurant
 *  3. POST   /api/restaurants       – Creare restaurant nou
 *  4. PUT    /api/restaurants/:id   – Actualizare restaurant
 *  5. PATCH  /api/restaurants/:id/status – Actualizare status restaurant
 *  6. PATCH  /api/restaurants/:id/tables  – Actualizare număr mese
 *  7. DELETE /api/restaurants/:id   – Ștergere restaurant
 *
 * Folosește:
 *  - express-validator pentru validarea câmpurilor
 *  - restaurantModel.js pentru operații CRUD pe restaurante
 *  - middleware/auth.js pentru autentificare
 *  - middleware/roles.js pentru autorizare pe bază de roluri
 *  - middleware/tenant.js pentru izolarea datelor pe tenant
 *
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');

const {
  createRestaurant,
  findRestaurantById,
  findRestaurantsByTenant,
  findRestaurantsByStatus,
  updateRestaurant,
  updateTableCount,
  updateRestaurantStatus,
  deleteRestaurant,
  countRestaurantsByTenant,
  countRestaurantsByStatus,
  searchRestaurantsByName,
} = require('../models/restaurantModel');

const { authenticate } = require('../middleware/auth');
const { authorize, authorizeMinLevel } = require('../middleware/roles');
const { enforceTenantAccess } = require('../middleware/tenant');
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
// GET /api/restaurants
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/restaurants
 * @desc    Listare restaurante cu opțiuni de filtrare, căutare și paginare
 * @access  Privat (autentificare necesară)
 *
 * Query params:
 *   - status    {string}  opțional – filtrare după status
 *   - search    {string}  opțional – căutare după nume
 *   - tenantId  {string}  opțional – (doar super_admin) filtrare după tenant
 *   - sort      {string}  opțional – câmp după care se sortează (ex: name, -createdAt)
 *   - limit     {number}  opțional – număr maxim de rezultate
 *   - skip      {number}  opțional – câte rezultate se sar
 *
 * Răspuns (200):
 *   {
 *     success: true,
 *     data: { restaurants, total, limit, skip }
 *   }
 */
router.get(
  '/',
  authenticate,
  [
    query('status')
      .optional()
      .isIn(['active', 'inactive', 'closed'])
      .withMessage('Statusul trebuie să fie: active, inactive sau closed.'),
    query('search')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1 })
      .withMessage('Termenul de căutare trebuie să aibă cel puțin 1 caracter.'),
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
      const { status, search, sort, limit, skip } = req.query;
      const tenantId = resolveTenantId(req);

      // Dacă nu avem tenantId (utilizator fără tenant și nu e super_admin),
      // returnăm listă goală
      if (!tenantId && req.user.role !== 'super_admin') {
        return res.status(200).json({
          success: true,
          data: {
            restaurants: [],
            total: 0,
            limit: limit ? parseInt(limit, 10) : null,
            skip: skip ? parseInt(skip, 10) : 0,
          },
        });
      }

      let restaurants;
      let total;

      // Construim opțiunile de paginare
      const options = {};
      if (sort) options.sort = sort;
      if (limit) options.limit = parseInt(limit, 10);
      if (skip) options.skip = parseInt(skip, 10);

      if (search) {
        // Căutare după nume
        restaurants = await searchRestaurantsByName(search, tenantId);
        total = restaurants.length;
      } else if (status) {
        // Filtrare după status
        restaurants = await findRestaurantsByStatus(status, tenantId);
        total = restaurants.length;
      } else {
        // Listare toate restaurantele tenant-ului
        restaurants = await findRestaurantsByTenant(tenantId, options);
        total = await countRestaurantsByTenant(tenantId);
      }

      res.status(200).json({
        success: true,
        data: {
          restaurants,
          total,
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
// GET /api/restaurants/:id
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/restaurants/:id
 * @desc    Obține detaliile unui restaurant după ID
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { restaurant } }
 */
router.get(
  '/:id',
  authenticate,
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul restaurantului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const restaurant = await findRestaurantById(id);

      if (!restaurant) {
        return next(new AppError(
          'Restaurantul nu a fost găsit.',
          404,
          'RESTAURANT_NOT_FOUND'
        ));
      }

      // Verificare acces tenant (doar super_admin poate vedea restaurante din alt tenant)
      if (req.user.role !== 'super_admin') {
        if (String(restaurant.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest restaurant.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      res.status(200).json({
        success: true,
        data: {
          restaurant,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/restaurants
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/restaurants
 * @desc    Creează un restaurant nou
 * @access  Privat (autentificare + rol manager, owner sau super_admin)
 *
 * Body (JSON):
 *   - name        {string}  obligatoriu – numele restaurantului
 *   - address     {string}  obligatoriu – adresa restaurantului
 *   - tableCount  {number}  opțional – numărul de mese (implicit 0)
 *   - phone       {string}  opțional – număr de telefon
 *   - email       {string}  opțional – email de contact
 *   - status      {string}  opțional – statusul (implicit 'active')
 *
 * Răspuns (201):
 *   { success: true, data: { restaurant } }
 */
router.post(
  '/',
  authenticate,
  authorizeMinLevel('manager'),
  [
    body('name')
      .isString()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Numele restaurantului trebuie să aibă între 1 și 100 de caractere.'),
    body('address')
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage('Adresa restaurantului trebuie să aibă între 5 și 500 de caractere.'),
    body('tableCount')
      .optional({ values: 'null' })
      .isInt({ min: 0 })
      .withMessage('Numărul de mese trebuie să fie un număr întreg, mai mare sau egal cu 0.'),
    body('phone')
      .optional({ values: 'null' })
      .isString()
      .withMessage('Telefonul trebuie să fie un șir de caractere.'),
    body('email')
      .optional({ values: 'null' })
      .isEmail()
      .withMessage('Adresa de email nu este validă.')
      .normalizeEmail(),
    body('status')
      .optional()
      .isIn(['active', 'inactive', 'closed'])
      .withMessage('Statusul trebuie să fie: active, inactive sau closed.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { name, address, tableCount, phone, email, status } = req.body;

      // Determinare tenantId
      const tenantId = resolveTenantId(req);

      if (!tenantId) {
        return next(new AppError(
          'Nu poți crea un restaurant fără un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const restaurantData = {
        name,
        address,
        tableCount: tableCount !== undefined ? tableCount : 0,
        tenantId,
        phone: phone || '',
        email: email || '',
        status: status || 'active',
      };

      const newRestaurant = await createRestaurant(restaurantData);

      res.status(201).json({
        success: true,
        data: {
          restaurant: newRestaurant,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/restaurants/:id
// ---------------------------------------------------------------------------

/**
 * @route   PUT /api/restaurants/:id
 * @desc    Actualizează un restaurant existent
 * @access  Privat (autentificare + rol manager, owner sau super_admin)
 *
 * Body (JSON) – cel puțin un câmp obligatoriu:
 *   - name        {string}  opțional
 *   - address     {string}  opțional
 *   - tableCount  {number}  opțional
 *   - phone       {string}  opțional
 *   - email       {string}  opțional
 *   - status      {string}  opțional
 *
 * Răspuns (200):
 *   { success: true, data: { restaurant } }
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
      .withMessage('ID-ul restaurantului este obligatoriu.'),
    body('name')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Numele restaurantului trebuie să aibă între 1 și 100 de caractere.'),
    body('address')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage('Adresa restaurantului trebuie să aibă între 5 și 500 de caractere.'),
    body('tableCount')
      .optional({ values: 'null' })
      .isInt({ min: 0 })
      .withMessage('Numărul de mese trebuie să fie un număr întreg, mai mare sau egal cu 0.'),
    body('phone')
      .optional({ values: 'null' })
      .isString()
      .withMessage('Telefonul trebuie să fie un șir de caractere.'),
    body('email')
      .optional({ values: 'null' })
      .isEmail()
      .withMessage('Adresa de email nu este validă.')
      .normalizeEmail(),
    body('status')
      .optional()
      .isIn(['active', 'inactive', 'closed'])
      .withMessage('Statusul trebuie să fie: active, inactive sau closed.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const updateData = {};

      // Construim obiectul doar cu câmpurile prezente în body
      const allowedFields = ['name', 'address', 'tableCount', 'phone', 'email', 'status'];
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

      // Verificare existență și acces la restaurant
      const existingRestaurant = await findRestaurantById(id);
      if (!existingRestaurant) {
        return next(new AppError(
          'Restaurantul nu a fost găsit.',
          404,
          'RESTAURANT_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingRestaurant.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest restaurant.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedRestaurant = await updateRestaurant(id, updateData);

      res.status(200).json({
        success: true,
        data: {
          restaurant: updatedRestaurant,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/restaurants/:id/status
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/restaurants/:id/status
 * @desc    Actualizează statusul unui restaurant
 * @access  Privat (autentificare + rol manager, owner sau super_admin)
 *
 * Body (JSON):
 *   - status  {string}  obligatoriu – noul status
 *
 * Răspuns (200):
 *   { success: true, data: { restaurant } }
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
      .withMessage('ID-ul restaurantului este obligatoriu.'),
    body('status')
      .isString()
      .trim()
      .notEmpty()
      .isIn(['active', 'inactive', 'closed'])
      .withMessage('Statusul trebuie să fie: active, inactive sau closed.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      // Verificare existență și acces
      const existingRestaurant = await findRestaurantById(id);
      if (!existingRestaurant) {
        return next(new AppError(
          'Restaurantul nu a fost găsit.',
          404,
          'RESTAURANT_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(existingRestaurant.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest restaurant.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedRestaurant = await updateRestaurantStatus(id, status);

      res.status(200).json({
        success: true,
        data: {
          restaurant: updatedRestaurant,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/restaurants/:id/tables
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/restaurants/:id/tables
 * @desc    Actualizează numărul de mese al unui restaurant
 * @access  Privat (autentificare + rol manager, owner sau super_admin)
 *
 * Body (JSON):
 *   - tableCount  {number}  obligatoriu – noul număr de mese
 *
 * Răspuns (200):
 *   { success: true, data: { restaurant } }
 */
router.patch(
  '/:id/tables',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul restaurantului este obligatoriu.'),
    body('tableCount')
      .isInt({ min: 0 })
      .withMessage('Numărul de mese trebuie să fie un număr întreg, mai mare sau egal cu 0.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { tableCount } = req.body;

      // Verificare existență și acces
      const existingRestaurant = await findRestaurantById(id);
      if (!existingRestaurant) {
        return next(new AppError(
          'Restaurantul nu a fost găsit.',
          404,
          'RESTAURANT_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(existingRestaurant.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest restaurant.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedRestaurant = await updateTableCount(id, tableCount);

      res.status(200).json({
        success: true,
        data: {
          restaurant: updatedRestaurant,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/restaurants/:id
// ---------------------------------------------------------------------------

/**
 * @route   DELETE /api/restaurants/:id
 * @desc    Șterge un restaurant
 * @access  Privat (autentificare + rol owner sau super_admin)
 *
 * Răspuns (200):
 *   { success: true, message: 'Restaurantul a fost șters cu succes.' }
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
      .withMessage('ID-ul restaurantului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Verificare existență
      const existingRestaurant = await findRestaurantById(id);
      if (!existingRestaurant) {
        return next(new AppError(
          'Restaurantul nu a fost găsit.',
          404,
          'RESTAURANT_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingRestaurant.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest restaurant.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      await deleteRestaurant(id);

      res.status(200).json({
        success: true,
        message: 'Restaurantul a fost șters cu succes.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Export router
// ---------------------------------------------------------------------------

module.exports = router;