/**
 * ============================================================
 * routes/inventory.js - Rute API pentru gestionarea inventarului (CRUD + alertă + intrări/ieșiri)
 * ============================================================
 *
 * Responsabilități:
 *  1. GET    /api/inventory                          – Listare iteme inventar (cu filtre, paginare)
 *  2. GET    /api/inventory/:id                      – Detalii item inventar
 *  3. POST   /api/inventory                          – Creare item inventar nou
 *  4. PUT    /api/inventory/:id                      – Actualizare item inventar
 *  5. PATCH  /api/inventory/:id/quantity             – Actualizare cantitate
 *  6. PATCH  /api/inventory/:id/adjust               – Ajustare cantitate (adunare/scădere)
 *  7. DELETE /api/inventory/:id                      – Ștergere item inventar
 *  8. GET    /api/inventory/low-stock                – Listare iteme sub prag minim (alertă)
 *  9. GET    /api/inventory/summary                  – Sumar inventar pe categorii
 * 10. GET    /api/inventory/location/:locationId     – Listare iteme per locație
 * 11. GET    /api/inventory/supplier/:supplierId     – Listare iteme per furnizor
 * 12. GET    /api/inventory/:id/transactions         – Istoric tranzacții pentru un item
 * 13. POST   /api/inventory/:id/transactions         – Creare tranzacție (intrare/ieșire)
 * 14. GET    /api/inventory/transactions             – Listare tranzacții (cu filtre)
 * 15. GET    /api/inventory/transactions/summary     – Sumar tranzacții pe tipuri
 *
 * Folosește:
 *  - express-validator pentru validarea câmpurilor
 *  - inventoryItemModel.js pentru operații CRUD pe iteme de inventar
 *  - inventoryTransactionModel.js pentru operații pe tranzacții
 *  - middleware/auth.js pentru autentificare
 *  - middleware/roles.js pentru autorizare pe bază de roluri
 *
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');

const {
  createInventoryItem,
  findInventoryItemById,
  findInventoryItemsByTenant,
  findInventoryItemsByLocation,
  findLowStockItems,
  updateInventoryItem,
  updateQuantity,
  adjustQuantity,
  deleteInventoryItem,
  countInventoryItems,
  findInventoryItemsBySupplier,
  getInventorySummary,
  VALID_CATEGORIES,
  VALID_UNITS,
  VALID_LOCATION_TYPES,
} = require('../models/inventoryItemModel');

const {
  createInventoryTransaction,
  findTransactionsByItem,
  findTransactionsByTenant,
  findTransactionsByLocation,
  findTransactionsByType,
  countTransactions,
  getTransactionSummary,
  getItemTransactionHistory,
  VALID_TRANSACTION_TYPES,
} = require('../models/inventoryTransactionModel');

const { authenticate } = require('../middleware/auth');
const { authorizeMinLevel } = require('../middleware/roles');
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
// Helper: determinare tenantId
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
// GET /api/inventory
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/inventory
 * @desc    Listare iteme de inventar cu opțiuni de filtrare și paginare
 * @access  Privat (autentificare necesară)
 *
 * Query params:
 *   - category      {string}  opțional – filtrare după categorie
 *   - locationId    {string}  opțional – filtrare după locație
 *   - locationType  {string}  opțional – filtrare după tip locație
 *   - supplierId    {string}  opțional – filtrare după furnizor
 *   - tenantId      {string}  opțional – (doar super_admin) filtrare după tenant
 *   - sortBy        {string}  opțional – câmp după care se sortează (implicit 'name')
 *   - sortOrder     {string}  opțional – 'asc' sau 'desc' (implicit 'asc')
 *
 * Răspuns (200):
 *   { success: true, data: { items, total } }
 */
router.get(
  '/',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    query('category')
      .optional()
      .isIn(VALID_CATEGORIES)
      .withMessage(`Categoria trebuie să fie una dintre: ${VALID_CATEGORIES.join(', ')}.`),
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
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveTenantId(req);

      if (!tenantId && req.user.role !== 'super_admin') {
        return res.status(200).json({
          success: true,
          data: { items: [], total: 0 },
        });
      }

      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { category, locationId, locationType, supplierId, sortBy, sortOrder } = req.query;

      const options = {};
      if (category) options.category = category;
      if (locationId) options.locationId = locationId;
      if (locationType) options.locationType = locationType;
      if (supplierId) options.supplierId = supplierId;
      if (sortBy) options.sortBy = sortBy;
      if (sortOrder) options.sortOrder = sortOrder;

      const items = await findInventoryItemsByTenant(tenantId, options);
      const total = await countInventoryItems(tenantId, { category });

      res.status(200).json({
        success: true,
        data: { items, total },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/inventory/low-stock
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/inventory/low-stock
 * @desc    Listare iteme de inventar sub pragul minim de alertă
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Query params:
 *   - tenantId  {string}  opțional – (doar super_admin) filtrare după tenant
 *
 * Răspuns (200):
 *   { success: true, data: { items } }
 */
router.get(
  '/low-stock',
  authenticate,
  authorizeMinLevel('bucătar'),
  async (req, res, next) => {
    try {
      const tenantId = resolveTenantId(req);

      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const items = await findLowStockItems(tenantId);

      res.status(200).json({
        success: true,
        data: { items },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/inventory/summary
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/inventory/summary
 * @desc    Sumar inventar pe categorii pentru tenantul curent
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Query params:
 *   - tenantId  {string}  opțional – (doar super_admin) filtrare după tenant
 *
 * Răspuns (200):
 *   { success: true, data: { summary } }
 */
router.get(
  '/summary',
  authenticate,
  authorizeMinLevel('bucătar'),
  async (req, res, next) => {
    try {
      const tenantId = resolveTenantId(req);

      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const summary = await getInventorySummary(tenantId);

      res.status(200).json({
        success: true,
        data: { summary },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/inventory/location/:locationId
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/inventory/location/:locationId
 * @desc    Listare iteme de inventar pentru o locație specifică
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Query params:
 *   - locationType  {string}  obligatoriu – tipul locației ('restaurant' sau 'hotel')
 *
 * Răspuns (200):
 *   { success: true, data: { items } }
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

      const items = await findInventoryItemsByLocation(locationId, locationType);

      res.status(200).json({
        success: true,
        data: { items },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/inventory/supplier/:supplierId
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/inventory/supplier/:supplierId
 * @desc    Listare iteme de inventar pentru un furnizor specific
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Răspuns (200):
 *   { success: true, data: { items } }
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

      const items = await findInventoryItemsBySupplier(supplierId);

      res.status(200).json({
        success: true,
        data: { items },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/inventory/transactions
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/inventory/transactions
 * @desc    Listare tranzacții de inventar cu opțiuni de filtrare și paginare
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Query params:
 *   - type          {string}  opțional – filtrare după tip (intrare/ieșire/pierdere)
 *   - locationId    {string}  opțional – filtrare după locație
 *   - locationType  {string}  opțional – filtrare după tip locație
 *   - itemId        {string}  opțional – filtrare după item
 *   - tenantId      {string}  opțional – (doar super_admin) filtrare după tenant
 *   - page          {number}  opțional – numărul paginii (implicit 1)
 *   - limit         {number}  opțional – rezultate pe pagină (implicit 50, max 100)
 *   - sortBy        {string}  opțional – câmp după care se sortează (implicit 'createdAt')
 *   - sortOrder     {string}  opțional – 'asc' sau 'desc' (implicit 'desc')
 *
 * Răspuns (200):
 *   { success: true, data: { transactions, total, page, limit, totalPages } }
 */
router.get(
  '/transactions',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    query('type')
      .optional()
      .isIn(VALID_TRANSACTION_TYPES)
      .withMessage(`Tipul tranzacției trebuie să fie unul dintre: ${VALID_TRANSACTION_TYPES.join(', ')}.`),
    query('locationType')
      .optional()
      .isIn(VALID_LOCATION_TYPES)
      .withMessage(`Tipul locației trebuie să fie: ${VALID_LOCATION_TYPES.join(', ')}.`),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page trebuie să fie un număr întreg >= 1.'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit trebuie să fie un număr între 1 și 100.'),
    query('sortBy')
      .optional()
      .isString()
      .trim()
      .withMessage('sortBy trebuie să fie un șir de caractere.'),
    query('sortOrder')
      .optional()
      .isIn(['asc', 'desc'])
      .withMessage('sortOrder trebuie să fie "asc" sau "desc".'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveTenantId(req);

      if (!tenantId && req.user.role !== 'super_admin') {
        return res.status(200).json({
          success: true,
          data: { transactions: [], total: 0, page: 1, limit: 50, totalPages: 0 },
        });
      }

      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { type, locationId, locationType, itemId, page, limit, sortBy, sortOrder } = req.query;

      const options = {};
      if (type) options.type = type;
      if (locationId) options.locationId = locationId;
      if (locationType) options.locationType = locationType;
      if (itemId) options.itemId = itemId;
      if (page) options.page = parseInt(page, 10);
      if (limit) options.limit = parseInt(limit, 10);
      if (sortBy) options.sortBy = sortBy;
      if (sortOrder) options.sortOrder = sortOrder;

      // Determinăm ce funcție de căutare folosim
      let transactions;
      let total;

      if (type && !locationId && !itemId) {
        // Filtrare doar după tip
        transactions = await findTransactionsByType(type, { ...options, tenantId });
        total = await countTransactions(tenantId, { type });
      } else if (locationId && locationType) {
        // Filtrare după locație
        transactions = await findTransactionsByLocation(locationId, locationType, options);
        total = await countTransactions(tenantId, { locationId, locationType });
      } else if (itemId) {
        // Filtrare după item
        transactions = await findTransactionsByItem(itemId, options);
        total = await countTransactions(tenantId, { itemId });
      } else {
        // Căutare generală pe tenant
        transactions = await findTransactionsByTenant(tenantId, options);
        total = await countTransactions(tenantId, {});
      }

      const currentPage = options.page || 1;
      const currentLimit = options.limit || 50;
      const totalPages = Math.ceil(total / currentLimit);

      res.status(200).json({
        success: true,
        data: {
          transactions,
          total,
          page: currentPage,
          limit: currentLimit,
          totalPages,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/inventory/transactions/summary
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/inventory/transactions/summary
 * @desc    Sumar tranzacții pe tipuri pentru tenantul curent
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Query params:
 *   - tenantId  {string}  opțional – (doar super_admin) filtrare după tenant
 *
 * Răspuns (200):
 *   { success: true, data: { summary } }
 */
router.get(
  '/transactions/summary',
  authenticate,
  authorizeMinLevel('bucătar'),
  async (req, res, next) => {
    try {
      const tenantId = resolveTenantId(req);

      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const summary = await getTransactionSummary(tenantId);

      res.status(200).json({
        success: true,
        data: { summary },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/inventory/:id
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/inventory/:id
 * @desc    Obține detaliile unui item de inventar după ID
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Răspuns (200):
 *   { success: true, data: { item } }
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
      .withMessage('ID-ul itemului de inventar este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const item = await findInventoryItemById(id);

      if (!item) {
        return next(new AppError(
          'Itemul de inventar nu a fost găsit.',
          404,
          'ITEM_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(item.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest item de inventar.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      res.status(200).json({
        success: true,
        data: { item },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/inventory
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/inventory
 * @desc    Creează un item de inventar nou
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Body (JSON):
 *   - name          {string}  obligatoriu – denumirea itemului
 *   - category      {string}  obligatoriu – categoria (alimente, băuturi, consumabile, alte)
 *   - quantity      {number}  obligatoriu – cantitatea disponibilă
 *   - unit          {string}  obligatoriu – unitatea de măsură
 *   - minThreshold  {number}  opțional – prag minim de alertă (implicit 0)
 *   - locationId    {string}  obligatoriu – ID-ul locației (restaurant sau hotel)
 *   - locationType  {string}  obligatoriu – tipul locației ('restaurant' sau 'hotel')
 *   - supplierId    {string}  opțional – ID-ul furnizorului
 *
 * Răspuns (201):
 *   { success: true, data: { item } }
 */
router.post(
  '/',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    body('name')
      .isString()
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage('Denumirea itemului trebuie să aibă între 1 și 200 de caractere.'),
    body('category')
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_CATEGORIES)
      .withMessage(`Categoria trebuie să fie una dintre: ${VALID_CATEGORIES.join(', ')}.`),
    body('quantity')
      .isFloat({ min: 0 })
      .withMessage('Cantitatea trebuie să fie un număr mai mare sau egal cu 0.'),
    body('unit')
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_UNITS)
      .withMessage(`Unitatea de măsură trebuie să fie una dintre: ${VALID_UNITS.join(', ')}.`),
    body('minThreshold')
      .optional({ values: 'null' })
      .isFloat({ min: 0 })
      .withMessage('Pragul minim trebuie să fie un număr mai mare sau egal cu 0.'),
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
    body('supplierId')
      .optional({ values: 'null' })
      .isString()
      .trim()
      .withMessage('supplierId trebuie să fie un șir de caractere.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveTenantId(req);

      if (!tenantId) {
        return next(new AppError(
          'Nu poți crea un item de inventar fără un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { name, category, quantity, unit, minThreshold, locationId, locationType, supplierId } = req.body;

      const itemData = {
        name: name.trim(),
        category,
        quantity,
        unit,
        minThreshold: minThreshold !== undefined ? minThreshold : 0,
        locationId,
        locationType,
        supplierId: supplierId || null,
        tenantId,
      };

      const newItem = await createInventoryItem(itemData);

      res.status(201).json({
        success: true,
        data: { item: newItem },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/inventory/:id
// ---------------------------------------------------------------------------

/**
 * @route   PUT /api/inventory/:id
 * @desc    Actualizează un item de inventar existent
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Body (JSON) – cel puțin un câmp obligatoriu:
 *   - name          {string}  opțional
 *   - category      {string}  opțional
 *   - unit          {string}  opțional
 *   - minThreshold  {number}  opțional
 *   - supplierId    {string}  opțional
 *
 * Răspuns (200):
 *   { success: true, data: { item } }
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
      .withMessage('ID-ul itemului de inventar este obligatoriu.'),
    body('name')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage('Denumirea itemului trebuie să aibă între 1 și 200 de caractere.'),
    body('category')
      .optional()
      .isString()
      .trim()
      .isIn(VALID_CATEGORIES)
      .withMessage(`Categoria trebuie să fie una dintre: ${VALID_CATEGORIES.join(', ')}.`),
    body('unit')
      .optional()
      .isString()
      .trim()
      .isIn(VALID_UNITS)
      .withMessage(`Unitatea de măsură trebuie să fie una dintre: ${VALID_UNITS.join(', ')}.`),
    body('minThreshold')
      .optional({ values: 'null' })
      .isFloat({ min: 0 })
      .withMessage('Pragul minim trebuie să fie un număr mai mare sau egal cu 0.'),
    body('supplierId')
      .optional({ values: 'null' })
      .isString()
      .trim()
      .withMessage('supplierId trebuie să fie un șir de caractere.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Verificare existență și acces
      const existingItem = await findInventoryItemById(id);
      if (!existingItem) {
        return next(new AppError(
          'Itemul de inventar nu a fost găsit.',
          404,
          'ITEM_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(existingItem.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest item de inventar.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      // Construim obiectul doar cu câmpurile permise
      const allowedFields = ['name', 'category', 'unit', 'minThreshold', 'supplierId'];
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

      const updatedItem = await updateInventoryItem(id, updateData);

      res.status(200).json({
        success: true,
        data: { item: updatedItem },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/inventory/:id/quantity
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/inventory/:id/quantity
 * @desc    Actualizează cantitatea unui item de inventar (suprascrie)
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Body (JSON):
 *   - quantity  {number}  obligatoriu – noua cantitate
 *
 * Răspuns (200):
 *   { success: true, data: { item } }
 */
router.patch(
  '/:id/quantity',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul itemului de inventar este obligatoriu.'),
    body('quantity')
      .isFloat({ min: 0 })
      .withMessage('Cantitatea trebuie să fie un număr mai mare sau egal cu 0.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { quantity } = req.body;

      // Verificare existență și acces
      const existingItem = await findInventoryItemById(id);
      if (!existingItem) {
        return next(new AppError(
          'Itemul de inventar nu a fost găsit.',
          404,
          'ITEM_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(existingItem.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest item de inventar.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedItem = await updateQuantity(id, quantity);

      res.status(200).json({
        success: true,
        data: { item: updatedItem },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/inventory/:id/adjust
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/inventory/:id/adjust
 * @desc    Ajustează cantitatea unui item (adună sau scade o valoare)
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Body (JSON):
 *   - delta  {number}  obligatoriu – valoarea de ajustat (poate fi negativă)
 *
 * Răspuns (200):
 *   { success: true, data: { item } }
 */
router.patch(
  '/:id/adjust',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul itemului de inventar este obligatoriu.'),
    body('delta')
      .isFloat()
      .withMessage('Valoarea de ajustare trebuie să fie un număr.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { delta } = req.body;

      // Verificare existență și acces
      const existingItem = await findInventoryItemById(id);
      if (!existingItem) {
        return next(new AppError(
          'Itemul de inventar nu a fost găsit.',
          404,
          'ITEM_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(existingItem.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest item de inventar.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedItem = await adjustQuantity(id, delta);

      res.status(200).json({
        success: true,
        data: { item: updatedItem },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/inventory/:id
// ---------------------------------------------------------------------------

/**
 * @route   DELETE /api/inventory/:id
 * @desc    Șterge un item de inventar
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Răspuns (200):
 *   { success: true, message: 'Itemul de inventar a fost șters cu succes.' }
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
      .withMessage('ID-ul itemului de inventar este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Verificare existență și acces
      const existingItem = await findInventoryItemById(id);
      if (!existingItem) {
        return next(new AppError(
          'Itemul de inventar nu a fost găsit.',
          404,
          'ITEM_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(existingItem.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest item de inventar.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      await deleteInventoryItem(id);

      res.status(200).json({
        success: true,
        message: 'Itemul de inventar a fost șters cu succes.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/inventory/:id/transactions
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/inventory/:id/transactions
 * @desc    Istoricul tranzacțiilor pentru un item de inventar
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Query params:
 *   - page   {number}  opțional – numărul paginii (implicit 1)
 *   - limit  {number}  opțional – rezultate pe pagină (implicit 50, max 100)
 *
 * Răspuns (200):
 *   { success: true, data: { transactions, total, page, limit, totalPages } }
 */
router.get(
  '/:id/transactions',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul itemului de inventar este obligatoriu.'),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page trebuie să fie un număr întreg >= 1.'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit trebuie să fie un număr între 1 și 100.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { page, limit } = req.query;

      // Verificare existență item
      const existingItem = await findInventoryItemById(id);
      if (!existingItem) {
        return next(new AppError(
          'Itemul de inventar nu a fost găsit.',
          404,
          'ITEM_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(existingItem.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest item de inventar.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const options = {};
      if (page) options.page = parseInt(page, 10);
      if (limit) options.limit = parseInt(limit, 10);

      const history = await getItemTransactionHistory(id, options);

      res.status(200).json({
        success: true,
        data: history,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/inventory/:id/transactions
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/inventory/:id/transactions
 * @desc    Creează o tranzacție de inventar (intrare sau ieșire) și ajustează automat cantitatea
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Body (JSON):
 *   - type      {string}  obligatoriu – tipul tranzacției (intrare/ieșire/pierdere)
 *   - quantity  {number}  obligatoriu – cantitatea tranzacționată
 *   - unit      {string}  obligatoriu – unitatea de măsură
 *   - note      {string}  opțional – nota tranzacției
 *
 * Răspuns (201):
 *   { success: true, data: { transaction, item } }
 */
router.post(
  '/:id/transactions',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul itemului de inventar este obligatoriu.'),
    body('type')
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_TRANSACTION_TYPES)
      .withMessage(`Tipul tranzacției trebuie să fie unul dintre: ${VALID_TRANSACTION_TYPES.join(', ')}.`),
    body('quantity')
      .isFloat({ min: 0.001 })
      .withMessage('Cantitatea trebuie să fie un număr mai mare decât 0.'),
    body('unit')
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_UNITS)
      .withMessage(`Unitatea de măsură trebuie să fie una dintre: ${VALID_UNITS.join(', ')}.`),
    body('note')
      .optional()
      .isString()
      .isLength({ max: 2000 })
      .withMessage('Nota poate avea maximum 2000 de caractere.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { type, quantity, unit, note } = req.body;

      // Verificare existență și acces item
      const existingItem = await findInventoryItemById(id);
      if (!existingItem) {
        return next(new AppError(
          'Itemul de inventar nu a fost găsit.',
          404,
          'ITEM_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(existingItem.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest item de inventar.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      // Calculăm delta în funcție de tipul tranzacției
      let delta;
      if (type === 'intrare') {
        delta = quantity;
      } else if (type === 'ieșire' || type === 'pierdere') {
        delta = -quantity;
      }

      // Verificăm stoc suficient pentru ieșiri
      if (delta < 0 && existingItem.quantity + delta < 0) {
        return next(new AppError(
          `Stoc insuficient. Disponibil: ${existingItem.quantity} ${existingItem.unit}.`,
          400,
          'INSUFFICIENT_STOCK'
        ));
      }

      // Ajustăm cantitatea itemului
      const updatedItem = await adjustQuantity(id, delta);

      // Construim datele tranzacției
      const transactionData = {
        itemId: id,
        type,
        quantity,
        unit,
        note: note || null,
        locationId: existingItem.locationId,
        locationType: existingItem.locationType,
        tenantId: existingItem.tenantId,
        performedBy: req.user.id,
        previousQuantity: existingItem.quantity,
        newQuantity: updatedItem.quantity,
      };

      // Creăm tranzacția
      const transaction = await createInventoryTransaction(transactionData);

      res.status(201).json({
        success: true,
        data: { transaction, item: updatedItem },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;