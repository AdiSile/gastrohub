/**
 * ============================================================
 * routes/orders.js - Rute API pentru comenzi (creare, actualizare status, facturare)
 * ============================================================
 *
 * Responsabilități:
 *  1. GET    /api/orders                  – Listare comenzi (cu filtre, paginare)
 *  2. GET    /api/orders/:id              – Detalii comandă
 *  3. POST   /api/orders                  – Creare comandă nouă
 *  4. PUT    /api/orders/:id              – Actualizare comandă
 *  5. PATCH  /api/orders/:id/status       – Actualizare status comandă
 *  6. PATCH  /api/orders/:id/payment      – Actualizare metodă de plată
 *  7. POST   /api/orders/:id/items        – Adăugare articol în comandă
 *  8. GET    /api/orders/restaurant/:restaurantId – Listare comenzi per restaurant
 *  9. GET    /api/orders/restaurant/:restaurantId/status/:status – Filtrare după status
 * 10. GET    /api/orders/restaurant/:restaurantId/table/:masa – Comenzi per masă
 * 11. POST   /api/orders/:id/invoice      – Generare factură (finalizare plată)
 *
 * Folosește:
 *  - express-validator pentru validarea câmpurilor
 *  - orderModel.js pentru operații CRUD pe comenzi
 *  - middleware/auth.js pentru autentificare
 *  - middleware/roles.js pentru autorizare pe bază de roluri
 *
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');

const {
  createOrder,
  findOrderById,
  findOrdersByRestaurant,
  findOrdersByStatus,
  findOrdersByTable,
  updateOrder,
  updateOrderStatus,
  updateOrderPayment,
} = require('../models/orderModel');

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
// GET /api/orders
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/orders
 * @desc    Listare comenzi cu opțiuni de filtrare și paginare
 * @access  Privat (autentificare necesară)
 *
 * Query params:
 *   - restaurantId  {string}  obligatoriu – ID-ul restaurantului
 *   - status        {string}  opțional – filtrare după status
 *   - masa          {number}  opțional – filtrare după număr masă
 *   - ospatar       {string}  opțional – filtrare după ospătar
 *   - sort          {string}  opțional – câmp după care se sortează
 *   - limit         {number}  opțional – număr maxim de rezultate
 *   - skip          {number}  opțional – câte rezultate se sar
 *
 * Răspuns (200):
 *   { success: true, data: { orders, limit, skip } }
 */
router.get(
  '/',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    query('restaurantId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul restaurantului este obligatoriu.'),
    query('status')
      .optional()
      .isIn(['deschisă', 'în preparare', 'finalizată', 'livrată', 'achitată', 'anulată'])
      .withMessage('Statusul comenzii nu este valid.'),
    query('masa')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Numărul mesei trebuie să fie un număr întreg pozitiv.'),
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
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { restaurantId, status, masa, ospatar, sort, limit, skip } = req.query;

      const options = {};
      if (sort) options.sort = sort;
      if (limit) options.limit = parseInt(limit, 10);
      if (skip) options.skip = parseInt(skip, 10);
      if (status) options.status = status;
      if (masa) options.masa = parseInt(masa, 10);
      if (ospatar) options.ospatar = ospatar;

      const orders = await findOrdersByRestaurant(restaurantId, tenantId, options);

      res.status(200).json({
        success: true,
        data: {
          orders,
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
// GET /api/orders/restaurant/:restaurantId
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/orders/restaurant/:restaurantId
 * @desc    Listare comenzi pentru un restaurant specific
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { orders } }
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
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { restaurantId } = req.params;

      const orders = await findOrdersByRestaurant(restaurantId, tenantId);

      res.status(200).json({
        success: true,
        data: {
          orders,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/orders/restaurant/:restaurantId/status/:status
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/orders/restaurant/:restaurantId/status/:status
 * @desc    Listare comenzi după status pentru un restaurant
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { orders } }
 */
router.get(
  '/restaurant/:restaurantId/status/:status',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('restaurantId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul restaurantului este obligatoriu.'),
    param('status')
      .isIn(['deschisă', 'în preparare', 'finalizată', 'livrată', 'achitată', 'anulată'])
      .withMessage('Statusul comenzii nu este valid.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { restaurantId, status } = req.params;

      const orders = await findOrdersByStatus(status, restaurantId, tenantId);

      res.status(200).json({
        success: true,
        data: {
          orders,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/orders/restaurant/:restaurantId/table/:masa
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/orders/restaurant/:restaurantId/table/:masa
 * @desc    Listare comenzi pentru o masă specifică
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { orders } }
 */
router.get(
  '/restaurant/:restaurantId/table/:masa',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('restaurantId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul restaurantului este obligatoriu.'),
    param('masa')
      .isInt({ min: 1 })
      .withMessage('Numărul mesei trebuie să fie un număr întreg pozitiv.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { restaurantId, masa } = req.params;
      const masaNum = parseInt(masa, 10);

      const orders = await findOrdersByTable(masaNum, restaurantId, tenantId);

      res.status(200).json({
        success: true,
        data: {
          orders,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/orders/:id
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/orders/:id
 * @desc    Obține detaliile unei comenzi după ID
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { order } }
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
      .withMessage('ID-ul comenzii este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { id } = req.params;

      const order = await findOrderById(id, tenantId);

      if (!order) {
        return next(new AppError(
          'Comanda nu a fost găsită.',
          404,
          'ORDER_NOT_FOUND'
        ));
      }

      res.status(200).json({
        success: true,
        data: {
          order,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/orders
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/orders
 * @desc    Creează o comandă nouă
 * @access  Privat (autentificare + rol ospătar, recepție, manager, owner, super_admin)
 *
 * Body (JSON):
 *   - articole       {Array}   obligatoriu – lista de articole
 *   - restaurantId   {string}  obligatoriu – ID-ul restaurantului
 *   - status         {string}  opțional – statusul comenzii (implicit 'deschisă')
 *   - metodaPlata    {string}  opțional – metoda de plată
 *   - ospatar        {string}  opțional – numele/ID-ul ospătarului
 *   - masa           {number}  opțional – numărul mesei
 *   - taxaServiciu   {number}  opțional – procent taxa serviciu
 *   - discount       {number}  opțional – discount sumă fixă
 *   - note           {string}  opțional – note adiționale
 *   - total          {number}  opțional – total suprascris
 *
 * Răspuns (201):
 *   { success: true, data: { order } }
 */
router.post(
  '/',
  authenticate,
  authorizeMinLevel('ospătar'),
  [
    body('articole')
      .isArray({ min: 1 })
      .withMessage('Lista de articole trebuie să conțină cel puțin un element.'),
    body('articole.*.menuItemId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare articol trebuie să aibă un menuItemId valid.'),
    body('articole.*.nume')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare articol trebuie să aibă un nume.'),
    body('articole.*.cantitate')
      .isInt({ min: 1 })
      .withMessage('Cantitatea fiecărui articol trebuie să fie un număr întreg >= 1.'),
    body('articole.*.pret')
      .isFloat({ min: 0 })
      .withMessage('Prețul fiecărui articol trebuie să fie un număr pozitiv.'),
    body('restaurantId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul restaurantului este obligatoriu.'),
    body('status')
      .optional()
      .isIn(['deschisă', 'în preparare', 'finalizată', 'livrată', 'achitată', 'anulată'])
      .withMessage('Statusul comenzii nu este valid.'),
    body('metodaPlata')
      .optional()
      .isIn(['numerar', 'card', 'card online', 'tichet de masă', 'bon cadou', 'transfer bancar', 'altă'])
      .withMessage('Metoda de plată nu este validă.'),
    body('ospatar')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 200 })
      .withMessage('Ospătarul poate avea maximum 200 de caractere.'),
    body('masa')
      .optional({ values: 'null' })
      .isInt({ min: 1 })
      .withMessage('Numărul mesei trebuie să fie un număr întreg pozitiv.'),
    body('taxaServiciu')
      .optional({ values: 'null' })
      .isFloat({ min: 0, max: 100 })
      .withMessage('Taxa serviciu trebuie să fie un procent între 0 și 100.'),
    body('discount')
      .optional({ values: 'null' })
      .isFloat({ min: 0 })
      .withMessage('Discountul trebuie să fie un număr pozitiv.'),
    body('note')
      .optional()
      .isString()
      .isLength({ max: 2000 })
      .withMessage('Notele pot avea maximum 2000 de caractere.'),
    body('total')
      .optional({ values: 'null' })
      .isFloat({ min: 0 })
      .withMessage('Totalul trebuie să fie un număr pozitiv.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const {
        articole,
        restaurantId,
        status,
        metodaPlata,
        ospatar,
        masa,
        taxaServiciu,
        discount,
        note,
        total,
      } = req.body;

      const orderData = {
        articole,
        restaurantId,
        tenantId,
        status: status || 'deschisă',
        metodaPlata: metodaPlata || '',
        ospatar: ospatar || req.user.email || '',
        masa: masa !== undefined && masa !== null ? masa : 0,
        taxaServiciu: taxaServiciu !== undefined && taxaServiciu !== null ? taxaServiciu : 0,
        discount: discount !== undefined && discount !== null ? discount : 0,
        note: note || '',
      };

      // Dacă s-a trimis un total explicit, îl includem
      if (total !== undefined && total !== null) {
        orderData.total = total;
      }

      const newOrder = await createOrder(orderData);

      res.status(201).json({
        success: true,
        data: {
          order: newOrder,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/orders/:id
// ---------------------------------------------------------------------------

/**
 * @route   PUT /api/orders/:id
 * @desc    Actualizează o comandă existentă
 * @access  Privat (autentificare + rol ospătar, recepție, manager, owner, super_admin)
 *
 * Body (JSON) – cel puțin un câmp obligatoriu:
 *   - articole       {Array}   opțional – lista actualizată de articole
 *   - status         {string}  opțional – noul status
 *   - total          {number}  opțional – noul total
 *   - metodaPlata    {string}  opțional – noua metodă de plată
 *   - ospatar        {string}  opțional – noul ospătar
 *   - masa           {number}  opțional – noul număr de masă
 *   - taxaServiciu   {number}  opțional – noua taxă serviciu
 *   - discount       {number}  opțional – noul discount
 *   - note           {string}  opțional – noile note
 *
 * Răspuns (200):
 *   { success: true, data: { order } }
 */
router.put(
  '/:id',
  authenticate,
  authorizeMinLevel('ospătar'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul comenzii este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { id } = req.params;

      // Verificare existență comandă
      const existingOrder = await findOrderById(id, tenantId);
      if (!existingOrder) {
        return next(new AppError(
          'Comanda nu a fost găsită.',
          404,
          'ORDER_NOT_FOUND'
        ));
      }

      // Construim doar câmpurile prezente în body
      const allowedFields = [
        'articole', 'status', 'total', 'metodaPlata',
        'ospatar', 'masa', 'taxaServiciu', 'discount', 'note',
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

      const updatedOrder = await updateOrder(id, updateData, tenantId);

      res.status(200).json({
        success: true,
        data: {
          order: updatedOrder,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/status
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/orders/:id/status
 * @desc    Actualizează statusul unei comenzi
 * @access  Privat (autentificare + rol ospătar, recepție, bucătar, manager, owner, super_admin)
 *
 * Body (JSON):
 *   - status  {string}  obligatoriu – noul status
 *
 * Răspuns (200):
 *   { success: true, data: { order } }
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
      .withMessage('ID-ul comenzii este obligatoriu.'),
    body('status')
      .isString()
      .trim()
      .notEmpty()
      .isIn(['deschisă', 'în preparare', 'finalizată', 'livrată', 'achitată', 'anulată'])
      .withMessage('Statusul comenzii nu este valid.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { id } = req.params;
      const { status } = req.body;

      // Verificare existență comandă
      const existingOrder = await findOrderById(id, tenantId);
      if (!existingOrder) {
        return next(new AppError(
          'Comanda nu a fost găsită.',
          404,
          'ORDER_NOT_FOUND'
        ));
      }

      const updatedOrder = await updateOrderStatus(id, status, tenantId);

      res.status(200).json({
        success: true,
        data: {
          order: updatedOrder,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/payment
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/orders/:id/payment
 * @desc    Actualizează metoda de plată a unei comenzi
 * @access  Privat (autentificare + rol recepție, ospătar, manager, owner, super_admin)
 *
 * Body (JSON):
 *   - metodaPlata  {string}  obligatoriu – noua metodă de plată
 *
 * Răspuns (200):
 *   { success: true, data: { order } }
 */
router.patch(
  '/:id/payment',
  authenticate,
  authorizeMinLevel('ospătar'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul comenzii este obligatoriu.'),
    body('metodaPlata')
      .isString()
      .trim()
      .notEmpty()
      .isIn(['numerar', 'card', 'card online', 'tichet de masă', 'bon cadou', 'transfer bancar', 'altă'])
      .withMessage('Metoda de plată nu este validă.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { id } = req.params;
      const { metodaPlata } = req.body;

      // Verificare existență comandă
      const existingOrder = await findOrderById(id, tenantId);
      if (!existingOrder) {
        return next(new AppError(
          'Comanda nu a fost găsită.',
          404,
          'ORDER_NOT_FOUND'
        ));
      }

      const updatedOrder = await updateOrderPayment(id, metodaPlata, tenantId);

      res.status(200).json({
        success: true,
        data: {
          order: updatedOrder,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/orders/:id/items
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/orders/:id/items
 * @desc    Adaugă un articol într-o comandă existentă
 * @access  Privat (autentificare + rol ospătar, recepție, manager, owner, super_admin)
 *
 * Body (JSON):
 *   - menuItemId  {string}  obligatoriu – ID-ul produsului
 *   - nume        {string}  obligatoriu – numele produsului
 *   - cantitate   {number}  obligatoriu – cantitatea
 *   - pret        {number}  obligatoriu – prețul unitar
 *   - note        {string}  opțional – note pentru articol
 *
 * Răspuns (200):
 *   { success: true, data: { order } }
 */
router.post(
  '/:id/items',
  authenticate,
  authorizeMinLevel('ospătar'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul comenzii este obligatoriu.'),
    body('menuItemId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul produsului este obligatoriu.'),
    body('nume')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Numele produsului este obligatoriu.'),
    body('cantitate')
      .isInt({ min: 1 })
      .withMessage('Cantitatea trebuie să fie un număr întreg >= 1.'),
    body('pret')
      .isFloat({ min: 0 })
      .withMessage('Prețul trebuie să fie un număr pozitiv.'),
    body('note')
      .optional()
      .isString()
      .isLength({ max: 500 })
      .withMessage('Notele articolului pot avea maximum 500 de caractere.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { id } = req.params;
      const { menuItemId, nume, cantitate, pret, note } = req.body;

      // Verificare existență comandă
      const existingOrder = await findOrderById(id, tenantId);
      if (!existingOrder) {
        return next(new AppError(
          'Comanda nu a fost găsită.',
          404,
          'ORDER_NOT_FOUND'
        ));
      }

      const articol = {
        menuItemId,
        nume: nume.trim(),
        cantitate,
        pret,
        note: note || '',
      };

      // Adăugăm noul articol la lista existentă de item-uri
      const existingItems = existingOrder.items || [];
      const updatedItems = [...existingItems, articol];
      const updatedOrder = await updateOrder(id, { items: updatedItems });

      res.status(200).json({
        success: true,
        data: {
          order: updatedOrder,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/orders/:id/invoice
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/orders/:id/invoice
 * @desc    Finalizează comanda și generează factura (marcare ca achitată)
 * @access  Privat (autentificare + rol recepție, manager, owner, super_admin)
 *
 * Body (JSON):
 *   - metodaPlata  {string}  obligatoriu – metoda de plată
 *   - total        {number}  opțional – totalul plătit (dacă diferă)
 *
 * Răspuns (200):
 *   { success: true, data: { order, invoice } }
 */
router.post(
  '/:id/invoice',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul comenzii este obligatoriu.'),
    body('metodaPlata')
      .isString()
      .trim()
      .notEmpty()
      .isIn(['numerar', 'card', 'card online', 'tichet de masă', 'bon cadou', 'transfer bancar', 'altă'])
      .withMessage('Metoda de plată nu este validă.'),
    body('total')
      .optional({ values: 'null' })
      .isFloat({ min: 0 })
      .withMessage('Totalul trebuie să fie un număr pozitiv.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveUserTenantId(req);
      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { id } = req.params;
      const { metodaPlata, total } = req.body;

      // Verificare existență comandă
      const existingOrder = await findOrderById(id, tenantId);
      if (!existingOrder) {
        return next(new AppError(
          'Comanda nu a fost găsită.',
          404,
          'ORDER_NOT_FOUND'
        ));
      }

      // Verificare status – nu putem factura o comandă deja achitată sau anulată
      if (existingOrder.status === 'achitată') {
        return next(new AppError(
          'Comanda a fost deja achitată.',
          400,
          'ORDER_ALREADY_PAID'
        ));
      }

      if (existingOrder.status === 'anulată') {
        return next(new AppError(
          'Comanda anulată nu poate fi facturată.',
          400,
          'ORDER_CANCELLED'
        ));
      }

      // Actualizăm metoda de plată
      await updateOrderPayment(id, metodaPlata, tenantId);

      // Actualizăm totalul dacă a fost furnizat
      const updateData = { status: 'achitată' };
      if (total !== undefined && total !== null) {
        updateData.total = total;
      }

      // Marcăm comanda ca achitată
      const updatedOrder = await updateOrderStatus(id, 'achitată', tenantId);

      // Dacă s-a trimis și un total, actualizăm și totalul
      let finalOrder = updatedOrder;
      if (total !== undefined && total !== null) {
        finalOrder = await updateOrder(id, { total }, tenantId);
      }

      // Construim factura
      const invoice = {
        orderId: id,
        restaurantId: existingOrder.restaurantId,
        tenantId: existingOrder.tenantId,
        articole: existingOrder.articole,
        subtotal: finalOrder.subtotal || existingOrder.subtotal,
        taxaServiciu: finalOrder.taxaServiciu || existingOrder.taxaServiciu,
        taxaServiciuValoare: finalOrder.taxaServiciuValoare || existingOrder.taxaServiciuValoare,
        discount: finalOrder.discount || existingOrder.discount,
        total: finalOrder.total || existingOrder.total,
        metodaPlata,
        dataEmitere: new Date().toISOString(),
        numarFactura: `INV-${id}-${Date.now()}`,
      };

      res.status(200).json({
        success: true,
        data: {
          order: finalOrder,
          invoice,
        },
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