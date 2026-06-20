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
 * 16. GET    /api/inventory/demand-planning/forecast – Prognoză cerere pe baza istoricului
 * 17. GET    /api/inventory/demand-planning/reorder  – Recomandări de reaprovizionare
 * 18. GET    /api/inventory/demand-planning/:id      – Analiză cerere pentru un item specific
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
  findInventoryTransactionsByTenant: findTxByTenant,
  findInventoryTransactionsByItem: findTxByItem,
  countInventoryTransactions: countTx,
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
      const total = await countInventoryItems(tenantId, { category, locationId, locationType, supplierId });

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
      if (page) options.page = parseInt(page, 10);
      if (limit) options.limit = parseInt(limit, 10);
      if (sortBy) options.sortBy = sortBy;
      if (sortOrder) options.sortOrder = sortOrder;

      // Construim obiectul de filtre pentru tranzacții
      const filters = {};
      if (type) filters.type = type;
      if (locationId) filters.locationId = locationId;
      if (locationType) filters.locationType = locationType;
      if (itemId) filters.itemId = itemId;

      const transactions = await findTransactionsByTenant(tenantId, { ...filters, ...options });
      const total = await countTransactions(tenantId, filters);

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
// DEMAND PLANNING – Prognoză cerere și recomandări de reaprovizionare
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /api/inventory/demand-planning/forecast
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/inventory/demand-planning/forecast
 * @desc    Generează prognoza cererii pe baza istoricului de tranzacții (ieșiri)
 *          Calculul se bazează pe consumul mediu zilnic per item și proiectează
 *          necesarul pentru următoarele 7/14/30 zile.
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Query params:
 *   - days          {number}  opțional – zile de prognoză (implicit 7, max 90)
 *   - category      {string}  opțional – filtrează după categorie
 *   - locationId    {string}  opțional – filtrează după locație
 *   - locationType  {string}  opțional – filtrează după tip locație
 *   - tenantId      {string}  opțional – (doar super_admin) filtrează după tenant
 *
 * Răspuns (200):
 *   { success: true, data: { forecast: [...], metadata: { days, generatedAt } } }
 */
router.get(
  '/demand-planning/forecast',
  authenticate,
  authorizeMinLevel('manager'),
  [
    query('days')
      .optional()
      .isInt({ min: 1, max: 90 })
      .withMessage('Zilele de prognoză trebuie să fie între 1 și 90.'),
    query('category')
      .optional()
      .isIn(VALID_CATEGORIES)
      .withMessage(`Categoria trebuie să fie una dintre: ${VALID_CATEGORIES.join(', ')}.`),
    query('locationType')
      .optional()
      .isIn(VALID_LOCATION_TYPES)
      .withMessage(`Tipul locației trebuie să fie: ${VALID_LOCATION_TYPES.join(', ')}.`),
  ],
  handleValidationErrors,
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

      const forecastDays = parseInt(req.query.days, 10) || 7;
      const { category, locationId, locationType } = req.query;

      // Obținem toate itemele active din tenant
      const itemOptions = {};
      if (category) itemOptions.category = category;
      if (locationId) itemOptions.locationId = locationId;
      if (locationType) itemOptions.locationType = locationType;

      const items = await findInventoryItemsByTenant(tenantId, itemOptions);

      if (!items || items.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            forecast: [],
            metadata: {
              days: forecastDays,
              generatedAt: new Date().toISOString(),
              totalItems: 0,
            },
          },
        });
      }

      // Pentru fiecare item, calculăm consumul mediu zilnic din tranzacțiile de ieșire
      // din ultimele 90 de zile (fereastra de analiză)
      const analysisWindowDays = 90;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - analysisWindowDays);

      // Obținem toate tranzacțiile pentru tenant din fereastra de analiză
      const allTransactions = await findTxByTenant(tenantId, {
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      // Filtrăm doar tranzacțiile de ieșire din fereastra de analiză
      const cutoffStr = cutoffDate.toISOString();
      const outgoingTx = (allTransactions || []).filter(
        (tx) => tx.type === 'ieșire' && tx.createdAt >= cutoffStr
      );

      // Grupăm tranzacțiile per itemId
      const consumptionByItem = {};
      for (const tx of outgoingTx) {
        if (!consumptionByItem[tx.itemId]) {
          consumptionByItem[tx.itemId] = { totalQty: 0, txCount: 0 };
        }
        consumptionByItem[tx.itemId].totalQty += tx.quantity;
        consumptionByItem[tx.itemId].txCount += 1;
      }

      // Construim prognoza
      const forecast = items.map((item) => {
        const itemId = String(item.id || item._id);
        const consumption = consumptionByItem[itemId] || { totalQty: 0, txCount: 0 };
        const avgDailyConsumption = consumption.totalQty / analysisWindowDays;
        const projectedDemand = avgDailyConsumption * forecastDays;
        const currentStock = item.quantity || 0;
        const daysOfStock = avgDailyConsumption > 0
          ? Math.round((currentStock / avgDailyConsumption) * 100) / 100
          : (currentStock > 0 ? 999 : 0);
        const shortageQty = Math.max(0, projectedDemand - currentStock);
        const stockStatus = currentStock <= (item.minThreshold || 0) ? 'critical'
          : daysOfStock < forecastDays ? 'low'
          : 'adequate';

        return {
          itemId,
          name: item.name,
          category: item.category,
          unit: item.unit,
          currentStock,
          minThreshold: item.minThreshold || 0,
          avgDailyConsumption: Math.round(avgDailyConsumption * 10000) / 10000,
          projectedDemand: Math.round(projectedDemand * 100) / 100,
          daysOfStock,
          shortageQty: Math.round(shortageQty * 100) / 100,
          stockStatus,
          locationId: item.locationId,
          locationType: item.locationType,
        };
      });

      // Sortăm: întâi cele critice, apoi low, apoi adequate
      const statusOrder = { critical: 0, low: 1, adequate: 2 };
      forecast.sort((a, b) => {
        if (statusOrder[a.stockStatus] !== statusOrder[b.stockStatus]) {
          return statusOrder[a.stockStatus] - statusOrder[b.stockStatus];
        }
        return a.daysOfStock - b.daysOfStock;
      });

      res.status(200).json({
        success: true,
        data: {
          forecast,
          metadata: {
            days: forecastDays,
            analysisWindowDays,
            generatedAt: new Date().toISOString(),
            totalItems: forecast.length,
            criticalCount: forecast.filter((f) => f.stockStatus === 'critical').length,
            lowCount: forecast.filter((f) => f.stockStatus === 'low').length,
            adequateCount: forecast.filter((f) => f.stockStatus === 'adequate').length,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/inventory/demand-planning/reorder
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/inventory/demand-planning/reorder
 * @desc    Generează recomandări de reaprovizionare pentru itemele care au
 *          stocul sub pragul minim sau al căror stoc curent nu acoperă
 *          consumul proiectat pentru următoarele 14 zile.
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Query params:
 *   - category      {string}  opțional – filtrează după categorie
 *   - locationId    {string}  opțional – filtrează după locație
 *   - locationType  {string}  opțional – filtrează după tip locație
 *   - tenantId      {string}  opțional – (doar super_admin) filtrează după tenant
 *   - leadTimeDays  {number}  opțional – timpul de aprovizionare în zile (implicit 3)
 *   - coverageDays  {number}  opțional – zilele de acoperire dorite (implicit 14)
 *
 * Răspuns (200):
 *   { success: true, data: { recommendations: [...], metadata: { ... } } }
 */
router.get(
  '/demand-planning/reorder',
  authenticate,
  authorizeMinLevel('manager'),
  [
    query('category')
      .optional()
      .isIn(VALID_CATEGORIES)
      .withMessage(`Categoria trebuie să fie una dintre: ${VALID_CATEGORIES.join(', ')}.`),
    query('locationType')
      .optional()
      .isIn(VALID_LOCATION_TYPES)
      .withMessage(`Tipul locației trebuie să fie: ${VALID_LOCATION_TYPES.join(', ')}.`),
    query('leadTimeDays')
      .optional()
      .isInt({ min: 1, max: 60 })
      .withMessage('Timpul de aprovizionare trebuie să fie între 1 și 60 de zile.'),
    query('coverageDays')
      .optional()
      .isInt({ min: 1, max: 90 })
      .withMessage('Zilele de acoperire trebuie să fie între 1 și 90.'),
  ],
  handleValidationErrors,
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

      const leadTimeDays = parseInt(req.query.leadTimeDays, 10) || 3;
      const coverageDays = parseInt(req.query.coverageDays, 10) || 14;
      const { category, locationId, locationType } = req.query;

      // Obținem itemele
      const itemOptions = {};
      if (category) itemOptions.category = category;
      if (locationId) itemOptions.locationId = locationId;
      if (locationType) itemOptions.locationType = locationType;

      const items = await findInventoryItemsByTenant(tenantId, itemOptions);

      if (!items || items.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            recommendations: [],
            metadata: {
              leadTimeDays,
              coverageDays,
              generatedAt: new Date().toISOString(),
              totalItems: 0,
            },
          },
        });
      }

      // Analiză consum din ultimele 90 de zile
      const analysisWindowDays = 90;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - analysisWindowDays);
      const cutoffStr = cutoffDate.toISOString();

      const allTransactions = await findTxByTenant(tenantId, {
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      const outgoingTx = (allTransactions || []).filter(
        (tx) => tx.type === 'ieșire' && tx.createdAt >= cutoffStr
      );

      // Grupăm consumul per item
      const consumptionByItem = {};
      for (const tx of outgoingTx) {
        if (!consumptionByItem[tx.itemId]) {
          consumptionByItem[tx.itemId] = { totalQty: 0, txCount: 0 };
        }
        consumptionByItem[tx.itemId].totalQty += tx.quantity;
        consumptionByItem[tx.itemId].txCount += 1;
      }

      // Generăm recomandări
      const recommendations = [];

      for (const item of items) {
        const itemId = String(item.id || item._id);
        const consumption = consumptionByItem[itemId] || { totalQty: 0, txCount: 0 };
        const avgDailyConsumption = consumption.totalQty / analysisWindowDays;
        const currentStock = item.quantity || 0;
        const minThreshold = item.minThreshold || 0;

        // Stocul necesar pentru perioada de acoperire + lead time
        const totalDaysNeeded = coverageDays + leadTimeDays;
        const requiredStock = avgDailyConsumption * totalDaysNeeded;
        const stockGap = Math.max(0, requiredStock - currentStock);

        // Pragul minim de reaprovizionare: fie sub minThreshold, fie stockGap > 0
        const needsReorder = currentStock <= minThreshold || stockGap > 0;

        if (needsReorder) {
          // Cantitatea de comandat: suficient pentru coverageDays + leadTimeDays,
          // plus un buffer de 20% pentru variații
          const safetyBuffer = 1.2;
          const suggestedOrderQty = Math.max(
            minThreshold > 0 ? minThreshold * 2 - currentStock : 0,
            Math.ceil(stockGap * safetyBuffer * 100) / 100
          );

          const daysOfStock = avgDailyConsumption > 0
            ? Math.round((currentStock / avgDailyConsumption) * 100) / 100
            : (currentStock > 0 ? 999 : 0);

          const priority = currentStock <= 0 ? 'urgent'
            : currentStock <= minThreshold ? 'high'
            : daysOfStock < coverageDays ? 'medium'
            : 'low';

          recommendations.push({
            itemId,
            name: item.name,
            category: item.category,
            unit: item.unit,
            currentStock,
            minThreshold,
            avgDailyConsumption: Math.round(avgDailyConsumption * 10000) / 10000,
            daysOfStock,
            leadTimeDays,
            coverageDays,
            requiredStock: Math.round(requiredStock * 100) / 100,
            stockGap: Math.round(stockGap * 100) / 100,
            suggestedOrderQty,
            priority,
            locationId: item.locationId,
            locationType: item.locationType,
            supplierId: item.supplierId || null,
          });
        }
      }

      // Sortăm după prioritate
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      recommendations.sort((a, b) => {
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        return a.daysOfStock - b.daysOfStock;
      });

      const totalOrderValue = recommendations.reduce(
        (sum, r) => sum + r.suggestedOrderQty, 0
      );

      res.status(200).json({
        success: true,
        data: {
          recommendations,
          metadata: {
            leadTimeDays,
            coverageDays,
            analysisWindowDays,
            generatedAt: new Date().toISOString(),
            totalItems: items.length,
            itemsToReorder: recommendations.length,
            urgentCount: recommendations.filter((r) => r.priority === 'urgent').length,
            highCount: recommendations.filter((r) => r.priority === 'high').length,
            mediumCount: recommendations.filter((r) => r.priority === 'medium').length,
            lowCount: recommendations.filter((r) => r.priority === 'low').length,
            totalSuggestedQty: Math.round(totalOrderValue * 100) / 100,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/inventory/demand-planning/:id
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/inventory/demand-planning/:id
 * @desc    Analiză detaliată a cererii pentru un item specific:
 *          consum istoric, tendințe, prognoză și recomandări de reaprovizionare.
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Query params:
 *   - analysisDays  {number}  opțional – zile de analiză istorică (implicit 90, max 365)
 *   - forecastDays  {number}  opțional – zile de prognoză (implicit 14, max 90)
 *   - leadTimeDays  {number}  opțional – timp de aprovizionare (implicit 3)
 *
 * Răspuns (200):
 *   { success: true, data: { item, demandAnalysis } }
 */
router.get(
  '/demand-planning/:id',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul itemului de inventar este obligatoriu.'),
    query('analysisDays')
      .optional()
      .isInt({ min: 7, max: 365 })
      .withMessage('Zilele de analiză trebuie să fie între 7 și 365.'),
    query('forecastDays')
      .optional()
      .isInt({ min: 1, max: 90 })
      .withMessage('Zilele de prognoză trebuie să fie între 1 și 90.'),
    query('leadTimeDays')
      .optional()
      .isInt({ min: 1, max: 60 })
      .withMessage('Timpul de aprovizionare trebuie să fie între 1 și 60 de zile.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const analysisDays = parseInt(req.query.analysisDays, 10) || 90;
      const forecastDays = parseInt(req.query.forecastDays, 10) || 14;
      const leadTimeDays = parseInt(req.query.leadTimeDays, 10) || 3;

      // Verificare existență item
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

      const tenantId = item.tenantId;
      const itemId = String(item.id || item._id);

      // Obținem tranzacțiile pentru acest item din fereastra de analiză
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - analysisDays);
      const cutoffStr = cutoffDate.toISOString();

      const allItemTx = await findTxByItem(itemId, {
        sortBy: 'createdAt',
        sortOrder: 'asc',
      });

      // Filtrăm tranzacțiile din fereastra de analiză
      const txInWindow = (allItemTx || []).filter(
        (tx) => tx.createdAt >= cutoffStr
      );

      // Separăm pe tipuri
      const incomingTx = txInWindow.filter((tx) => tx.type === 'intrare');
      const outgoingTx = txInWindow.filter((tx) => tx.type === 'ieșire');
      const adjustmentTx = txInWindow.filter((tx) => tx.type === 'ajustare');
      const transferTx = txInWindow.filter((tx) => tx.type === 'transfer');

      // Calculăm metrici
      const totalOutgoing = outgoingTx.reduce((sum, tx) => sum + tx.quantity, 0);
      const totalIncoming = incomingTx.reduce((sum, tx) => sum + tx.quantity, 0);
      const avgDailyConsumption = totalOutgoing / analysisDays;
      const currentStock = item.quantity || 0;
      const minThreshold = item.minThreshold || 0;

      const daysOfStock = avgDailyConsumption > 0
        ? Math.round((currentStock / avgDailyConsumption) * 100) / 100
        : (currentStock > 0 ? 999 : 0);

      // Prognoză
      const projectedDemand = avgDailyConsumption * forecastDays;
      const projectedStock = currentStock - projectedDemand;
      const shortageQty = Math.max(0, projectedDemand - currentStock);

      // Recomandare reaprovizionare
      const totalDaysNeeded = forecastDays + leadTimeDays;
      const requiredStock = avgDailyConsumption * totalDaysNeeded;
      const stockGap = Math.max(0, requiredStock - currentStock);
      const safetyBuffer = 1.2;
      const suggestedOrderQty = stockGap > 0
        ? Math.ceil(stockGap * safetyBuffer * 100) / 100
        : (currentStock <= minThreshold
          ? Math.max(minThreshold * 2 - currentStock, 0)
          : 0);

      // Tendință: comparăm prima jumătate cu a doua jumătate a ferestrei de analiză
      const midPoint = new Date(cutoffDate.getTime() + (analysisDays / 2) * 86400000).toISOString();
      const firstHalfConsumption = outgoingTx
        .filter((tx) => tx.createdAt < midPoint)
        .reduce((sum, tx) => sum + tx.quantity, 0);
      const secondHalfConsumption = outgoingTx
        .filter((tx) => tx.createdAt >= midPoint)
        .reduce((sum, tx) => sum + tx.quantity, 0);

      let trend;
      if (firstHalfConsumption === 0 && secondHalfConsumption === 0) {
        trend = 'stable';
      } else if (firstHalfConsumption === 0) {
        trend = 'increasing';
      } else {
        const trendRatio = secondHalfConsumption / firstHalfConsumption;
        if (trendRatio > 1.2) trend = 'increasing';
        else if (trendRatio < 0.8) trend = 'decreasing';
        else trend = 'stable';
      }

      // Status stoc
      const stockStatus = currentStock <= 0 ? 'out_of_stock'
        : currentStock <= minThreshold ? 'critical'
        : daysOfStock < forecastDays ? 'low'
        : 'adequate';

      // Construim seriile temporale (agregare pe săptămână)
      const weeklyBuckets = {};
      for (const tx of outgoingTx) {
        const txDate = new Date(tx.createdAt);
        const weekStart = new Date(txDate);
        weekStart.setDate(txDate.getDate() - txDate.getDay());
        const weekKey = weekStart.toISOString().slice(0, 10);
        if (!weeklyBuckets[weekKey]) {
          weeklyBuckets[weekKey] = 0;
        }
        weeklyBuckets[weekKey] += tx.quantity;
      }

      const weeklyConsumption = Object.entries(weeklyBuckets)
        .map(([week, qty]) => ({ week, quantity: Math.round(qty * 100) / 100 }))
        .sort((a, b) => a.week.localeCompare(b.week));

      res.status(200).json({
        success: true,
        data: {
          item: {
            id: itemId,
            name: item.name,
            category: item.category,
            unit: item.unit,
            currentStock,
            minThreshold,
            locationId: item.locationId,
            locationType: item.locationType,
            supplierId: item.supplierId || null,
          },
          demandAnalysis: {
            analysisWindow: {
              days: analysisDays,
              startDate: cutoffStr,
              endDate: new Date().toISOString(),
            },
            transactions: {
              total: txInWindow.length,
              incoming: { count: incomingTx.length, totalQty: Math.round(totalIncoming * 100) / 100 },
              outgoing: { count: outgoingTx.length, totalQty: Math.round(totalOutgoing * 100) / 100 },
              adjustments: { count: adjustmentTx.length },
              transfers: { count: transferTx.length },
            },
            consumption: {
              avgDaily: Math.round(avgDailyConsumption * 10000) / 10000,
              avgWeekly: Math.round(avgDailyConsumption * 7 * 100) / 100,
              avgMonthly: Math.round(avgDailyConsumption * 30 * 100) / 100,
              trend,
              firstHalfTotal: Math.round(firstHalfConsumption * 100) / 100,
              secondHalfTotal: Math.round(secondHalfConsumption * 100) / 100,
            },
            stock: {
              currentStock,
              minThreshold,
              daysOfStock,
              status: stockStatus,
            },
            forecast: {
              days: forecastDays,
              projectedDemand: Math.round(projectedDemand * 100) / 100,
              projectedStock: Math.round(projectedStock * 100) / 100,
              shortageQty: Math.round(shortageQty * 100) / 100,
              needsReorder: shortageQty > 0 || currentStock <= minThreshold,
            },
            reorder: {
              leadTimeDays,
              coverageDays: forecastDays,
              requiredStock: Math.round(requiredStock * 100) / 100,
              stockGap: Math.round(stockGap * 100) / 100,
              suggestedOrderQty,
            },
            weeklyConsumption,
          },
        },
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
 *   { success: true, data: {}, message: 'Itemul de inventar a fost șters cu succes.' }
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
        data: {},
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