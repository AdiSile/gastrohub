/**
 * ============================================================
 * routes/deliveries.js - Rute API CRUD pentru livrări simulate
 * ============================================================
 *
 * Responsabilități:
 *  1. GET    /api/deliveries                     – Listare livrări (cu filtre, paginare)
 *  2. GET    /api/deliveries/:id                 – Detalii livrare
 *  3. POST   /api/deliveries                     – Creare livrare nouă
 *  4. PUT    /api/deliveries/:id                 – Actualizare livrare
 *  5. PATCH  /api/deliveries/:id/status          – Actualizare status livrare
 *  6. DELETE /api/deliveries/:id                 – Ștergere livrare
 *  7. GET    /api/deliveries/status/:status      – Listare livrări după status
 *  8. GET    /api/deliveries/supplier/:supplierId – Listare livrări după furnizor
 *  9. GET    /api/deliveries/location/:locationId – Listare livrări după locație
 * 10. GET    /api/deliveries/date-range           – Listare livrări în interval de date
 *
 * Folosește:
 *  - express-validator pentru validarea câmpurilor
 *  - deliveryModel.js pentru operații CRUD pe livrări
 *  - middleware/auth.js pentru autentificare
 *  - middleware/roles.js pentru autorizare pe bază de roluri
 *
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');

const {
  createDelivery,
  findDeliveryById,
  findDeliveriesByTenant,
  findDeliveriesByStatus,
  findDeliveriesBySupplier,
  findDeliveriesByLocation,
  findDeliveriesByDateRange,
  updateDelivery,
  updateDeliveryStatus,
  deleteDelivery,
  countDeliveries,
  getTotalDeliveryValue,
  VALID_DELIVERY_STATUSES,
  VALID_LOCATION_TYPES,
  VALID_UNITS,
} = require('../models/deliveryModel');

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
// GET /api/deliveries
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/deliveries
 * @desc    Listare livrări cu opțiuni de filtrare, căutare și paginare
 * @access  Privat (autentificare necesară)
 *
 * Query params:
 *   - status        {string}  opțional – filtrare după status
 *   - supplierId    {string}  opțional – filtrare după furnizor
 *   - locationId    {string}  opțional – filtrare după locație
 *   - locationType  {string}  opțional – filtrare după tip locație
 *   - tenantId      {string}  opțional – (doar super_admin) filtrare după tenant
 *   - sortBy        {string}  opțional – câmp după care se sortează (implicit 'orderDate')
 *   - sortOrder     {string}  opțional – 'asc' sau 'desc' (implicit 'desc')
 *   - limit         {number}  opțional – număr maxim de rezultate
 *   - skip          {number}  opțional – câte rezultate se sar
 *
 * Răspuns (200):
 *   {
 *     success: true,
 *     data: { deliveries, total, limit, skip }
 *   }
 */
router.get(
  '/',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    query('status')
      .optional()
      .isIn(VALID_DELIVERY_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_DELIVERY_STATUSES.join(', ')}.`),
    query('locationType')
      .optional()
      .isIn(VALID_LOCATION_TYPES)
      .withMessage(`Tipul locației trebuie să fie: ${VALID_LOCATION_TYPES.join(', ')}.`),
    query('sortBy')
      .optional()
      .isString()
      .trim()
      .withMessage('sortBy trebuie să fie un șir de caractere.'),
    query('sortOrder')
      .optional()
      .isIn(['asc', 'desc'])
      .withMessage('sortOrder trebuie să fie "asc" sau "desc".'),
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
      const tenantId = resolveTenantId(req);

      if (!tenantId && req.user.role !== 'super_admin') {
        return res.status(200).json({
          success: true,
          data: {
            deliveries: [],
            total: 0,
            limit: req.query.limit ? parseInt(req.query.limit, 10) : null,
            skip: req.query.skip ? parseInt(req.query.skip, 10) : 0,
          },
        });
      }

      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { status, supplierId, locationId, locationType, sortBy, sortOrder, limit, skip } = req.query;

      const options = {};
      if (status) options.status = status;
      if (supplierId) options.supplierId = supplierId;
      if (locationId) options.locationId = locationId;
      if (locationType) options.locationType = locationType;
      if (sortBy) options.sortBy = sortBy;
      if (sortOrder) options.sortOrder = sortOrder;
      if (limit) options.limit = parseInt(limit, 10);
      if (skip) options.skip = parseInt(skip, 10);

      const deliveries = await findDeliveriesByTenant(tenantId, options);
      const total = await countDeliveries(tenantId, { status });

      res.status(200).json({
        success: true,
        data: {
          deliveries,
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
// GET /api/deliveries/status/:status
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/deliveries/status/:status
 * @desc    Listare livrări după status
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Răspuns (200):
 *   { success: true, data: { deliveries } }
 */
router.get(
  '/status/:status',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('status')
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_DELIVERY_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_DELIVERY_STATUSES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { status } = req.params;
      const tenantId = resolveTenantId(req);

      const deliveries = await findDeliveriesByStatus(status, tenantId);

      res.status(200).json({
        success: true,
        data: { deliveries },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/deliveries/supplier/:supplierId
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/deliveries/supplier/:supplierId
 * @desc    Listare livrări după furnizor
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Răspuns (200):
 *   { success: true, data: { deliveries } }
 */
router.get(
  '/supplier/:supplierId',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('supplierId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul furnizorului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { supplierId } = req.params;
      const tenantId = resolveTenantId(req);

      const deliveries = await findDeliveriesBySupplier(supplierId, tenantId);

      res.status(200).json({
        success: true,
        data: { deliveries },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/deliveries/location/:locationId
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/deliveries/location/:locationId
 * @desc    Listare livrări după locație
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Query params:
 *   - locationType  {string}  obligatoriu – tipul locației ('restaurant' sau 'hotel')
 *
 * Răspuns (200):
 *   { success: true, data: { deliveries } }
 */
router.get(
  '/location/:locationId',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('locationId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul locației este obligatoriu.'),
    query('locationType')
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_LOCATION_TYPES)
      .withMessage(`Tipul locației trebuie să fie: ${VALID_LOCATION_TYPES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { locationId } = req.params;
      const { locationType } = req.query;
      const tenantId = resolveTenantId(req);

      const deliveries = await findDeliveriesByLocation(locationId, locationType, tenantId);

      res.status(200).json({
        success: true,
        data: { deliveries },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/deliveries/date-range
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/deliveries/date-range
 * @desc    Listare livrări într-un interval de date
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Query params:
 *   - startDate  {string}  obligatoriu – data de început (ISO string)
 *   - endDate    {string}  obligatoriu – data de sfârșit (ISO string)
 *
 * Răspuns (200):
 *   { success: true, data: { deliveries } }
 */
router.get(
  '/date-range',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    query('startDate')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Data de început (startDate) este obligatorie.'),
    query('endDate')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Data de sfârșit (endDate) este obligatorie.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { startDate, endDate } = req.query;
      const tenantId = resolveTenantId(req);

      const deliveries = await findDeliveriesByDateRange(startDate, endDate, tenantId);

      res.status(200).json({
        success: true,
        data: { deliveries },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/deliveries/:id
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/deliveries/:id
 * @desc    Obține detaliile unei livrări după ID
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { delivery } }
 */
router.get(
  '/:id',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul livrării este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const delivery = await findDeliveryById(id);

      if (!delivery) {
        return next(new AppError(
          'Livrarea nu a fost găsită.',
          404,
          'DELIVERY_NOT_FOUND'
        ));
      }

      // Verificare acces tenant (doar super_admin poate vedea livrări din alt tenant)
      if (req.user.role !== 'super_admin') {
        if (String(delivery.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la această livrare.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      res.status(200).json({
        success: true,
        data: {
          delivery,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/deliveries
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/deliveries
 * @desc    Creează o livrare nouă simulată
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Body (JSON):
 *   - supplierId        {string}   obligatoriu – ID-ul furnizorului
 *   - items             {Array}    obligatoriu – lista itemilor livrați
 *   - items.*.itemId    {string}   obligatoriu – ID-ul itemului
 *   - items.*.itemName  {string}   obligatoriu – numele itemului
 *   - items.*.quantity  {number}   obligatoriu – cantitatea
 *   - items.*.unit      {string}   obligatoriu – unitatea de măsură
 *   - items.*.price     {number}   obligatoriu – prețul unitar
 *   - status            {string}   opțional – statusul (implicit 'comandată')
 *   - orderDate         {string}   opțional – data comenzii (ISO, implicit acum)
 *   - estimatedDelivery {string}   opțional – data estimată de livrare (ISO)
 *   - actualDelivery   {string}   opțional – data efectivă de livrare (ISO)
 *   - notes             {string}   opțional – note adiționale
 *   - locationId        {string}   obligatoriu – ID-ul locației
 *   - locationType      {string}   obligatoriu – tipul locației ('restaurant' sau 'hotel')
 *
 * Răspuns (201):
 *   { success: true, data: { delivery } }
 */
router.post(
  '/',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    body('supplierId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul furnizorului este obligatoriu.'),
    body('items')
      .isArray({ min: 1 })
      .withMessage('Lista de itemi trebuie să conțină cel puțin un element.'),
    body('items.*.itemId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare item trebuie să aibă un itemId valid.'),
    body('items.*.itemName')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare item trebuie să aibă un itemName.'),
    body('items.*.quantity')
      .isFloat({ min: 0 })
      .withMessage('Cantitatea fiecărui item trebuie să fie un număr >= 0.'),
    body('items.*.unit')
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_UNITS)
      .withMessage(`Unitatea de măsură trebuie să fie una dintre: ${VALID_UNITS.join(', ')}.`),
    body('items.*.price')
      .isFloat({ min: 0 })
      .withMessage('Prețul fiecărui item trebuie să fie un număr >= 0.'),
    body('status')
      .optional()
      .isIn(VALID_DELIVERY_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_DELIVERY_STATUSES.join(', ')}.`),
    body('orderDate')
      .optional()
      .isString()
      .trim()
      .withMessage('Data comenzii trebuie să fie un șir de caractere.'),
    body('estimatedDelivery')
      .optional({ values: 'null' })
      .isString()
      .trim()
      .withMessage('Data estimată de livrare trebuie să fie un șir de caractere.'),
    body('actualDelivery')
      .optional({ values: 'null' })
      .isString()
      .trim()
      .withMessage('Data efectivă de livrare trebuie să fie un șir de caractere.'),
    body('notes')
      .optional()
      .isString()
      .isLength({ max: 2000 })
      .withMessage('Notele pot avea maximum 2000 de caractere.'),
    body('locationId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul locației este obligatoriu.'),
    body('locationType')
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_LOCATION_TYPES)
      .withMessage(`Tipul locației trebuie să fie: ${VALID_LOCATION_TYPES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveTenantId(req);

      if (!tenantId) {
        return next(new AppError(
          'Nu poți crea o livrare fără un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const {
        supplierId,
        items,
        status,
        orderDate,
        estimatedDelivery,
        actualDelivery,
        notes,
        locationId,
        locationType,
      } = req.body;

      const deliveryData = {
        supplierId,
        items,
        status: status || 'comandată',
        orderDate: orderDate || undefined,
        estimatedDelivery: estimatedDelivery || undefined,
        actualDelivery: actualDelivery || undefined,
        notes: notes || '',
        locationId,
        locationType,
        tenantId,
      };

      const newDelivery = await createDelivery(deliveryData);

      res.status(201).json({
        success: true,
        data: {
          delivery: newDelivery,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/deliveries/:id
// ---------------------------------------------------------------------------

/**
 * @route   PUT /api/deliveries/:id
 * @desc    Actualizează o livrare existentă
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Body (JSON) – cel puțin un câmp obligatoriu:
 *   - supplierId        {string}   opțional
 *   - items             {Array}    opțional
 *   - status            {string}   opțional
 *   - orderDate         {string}   opțional
 *   - estimatedDelivery {string}   opțional
 *   - actualDelivery    {string}   opțional
 *   - notes             {string}   opțional
 *   - locationId        {string}   opțional
 *   - locationType      {string}   opțional
 *
 * Răspuns (200):
 *   { success: true, data: { delivery } }
 */
router.put(
  '/:id',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul livrării este obligatoriu.'),
    body('supplierId')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul furnizorului trebuie să fie un șir de caractere.'),
    body('items')
      .optional()
      .isArray({ min: 1 })
      .withMessage('Lista de itemi trebuie să conțină cel puțin un element.'),
    body('items.*.itemId')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare item trebuie să aibă un itemId valid.'),
    body('items.*.itemName')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare item trebuie să aibă un itemName.'),
    body('items.*.quantity')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Cantitatea fiecărui item trebuie să fie un număr >= 0.'),
    body('items.*.unit')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_UNITS)
      .withMessage(`Unitatea de măsură trebuie să fie una dintre: ${VALID_UNITS.join(', ')}.`),
    body('items.*.price')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Prețul fiecărui item trebuie să fie un număr >= 0.'),
    body('status')
      .optional()
      .isIn(VALID_DELIVERY_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_DELIVERY_STATUSES.join(', ')}.`),
    body('orderDate')
      .optional()
      .isString()
      .trim()
      .withMessage('Data comenzii trebuie să fie un șir de caractere.'),
    body('estimatedDelivery')
      .optional({ values: 'null' })
      .isString()
      .trim()
      .withMessage('Data estimată de livrare trebuie să fie un șir de caractere.'),
    body('actualDelivery')
      .optional({ values: 'null' })
      .isString()
      .trim()
      .withMessage('Data efectivă de livrare trebuie să fie un șir de caractere.'),
    body('notes')
      .optional()
      .isString()
      .isLength({ max: 2000 })
      .withMessage('Notele pot avea maximum 2000 de caractere.'),
    body('locationId')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul locației trebuie să fie un șir de caractere.'),
    body('locationType')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_LOCATION_TYPES)
      .withMessage(`Tipul locației trebuie să fie: ${VALID_LOCATION_TYPES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Verificare existență și acces la livrare
      const existingDelivery = await findDeliveryById(id);
      if (!existingDelivery) {
        return next(new AppError(
          'Livrarea nu a fost găsită.',
          404,
          'DELIVERY_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingDelivery.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la această livrare.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      // Construim obiectul doar cu câmpurile prezente în body
      const allowedFields = [
        'supplierId', 'items', 'status', 'orderDate',
        'estimatedDelivery', 'actualDelivery', 'notes',
        'locationId', 'locationType',
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

      const updatedDelivery = await updateDelivery(id, updateData);

      res.status(200).json({
        success: true,
        data: {
          delivery: updatedDelivery,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/deliveries/:id/status
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/deliveries/:id/status
 * @desc    Actualizează statusul unei livrări
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Body (JSON):
 *   - status  {string}  obligatoriu – noul status
 *
 * Răspuns (200):
 *   { success: true, data: { delivery } }
 */
router.patch(
  '/:id/status',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul livrării este obligatoriu.'),
    body('status')
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_DELIVERY_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_DELIVERY_STATUSES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      // Verificare existență și acces
      const existingDelivery = await findDeliveryById(id);
      if (!existingDelivery) {
        return next(new AppError(
          'Livrarea nu a fost găsită.',
          404,
          'DELIVERY_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(existingDelivery.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la această livrare.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedDelivery = await updateDeliveryStatus(id, status);

      res.status(200).json({
        success: true,
        data: {
          delivery: updatedDelivery,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/deliveries/:id
// ---------------------------------------------------------------------------

/**
 * @route   DELETE /api/deliveries/:id
 * @desc    Șterge o livrare
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Răspuns (200):
 *   { success: true, message: 'Livrarea a fost ștearsă cu succes.' }
 */
router.delete(
  '/:id',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul livrării este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Verificare existență
      const existingDelivery = await findDeliveryById(id);
      if (!existingDelivery) {
        return next(new AppError(
          'Livrarea nu a fost găsită.',
          404,
          'DELIVERY_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingDelivery.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la această livrare.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      await deleteDelivery(id);

      res.status(200).json({
        success: true,
        message: 'Livrarea a fost ștearsă cu succes.',
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