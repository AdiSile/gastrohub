'use strict';

// ---------------------------------------------------------------------------
// Routes – Suppliers & Supplier Orders
// GastroHub – rutare pentru gestionarea furnizorilor și comenzilor
// ---------------------------------------------------------------------------

const express = require('express');
const { param, body, query, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { authorizeMinLevel } = require('../middleware/roles');
const { AppError } = require('../middleware/errorHandler');

const {
  createSupplier,
  findSupplierById,
  findSuppliersByTenant,
  findSuppliersByStatus,
  findSuppliersByProduct,
  findSuppliersByMinRating,
  findSuppliersByPaymentTerms,
  updateSupplier,
  updateSupplierRating,
  updateSupplierStatus,
  addSupplierProduct,
  removeSupplierProduct,
  deleteSupplier,
  countSuppliersByTenant,
  countSuppliersByStatus,
  searchSuppliersByName,
  placeSupplierOrder,
  findSupplierOrders,
  countSupplierOrders,
  VALID_STATUSES,
  VALID_PAYMENT_TERMS,
} = require('../models/supplierModel');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: validare erori de validare
// ─────────────────────────────────────────────────────────────────────────────

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map((e) => e.msg);
    return next(new AppError(messages.join('; '), 400, 'VALIDATION_ERROR'));
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/suppliers – Creare furnizor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   POST /api/suppliers
 * @desc    Creează un furnizor nou
 * @access  Privat (rol manager, owner, super_admin)
 *
 * Body (JSON):
 *   - name          {string} obligatoriu
 *   - contactPerson {string} opțional
 *   - phone         {string} opțional
 *   - email         {string} opțional
 *   - address       {string} opțional
 *   - products      {string[]} opțional
 *   - paymentTerms  {string} opțional – implicit '30 zile'
 *   - rating        {number} opțional – 0-5
 *   - status        {string} opțional – implicit 'active'
 *   - tenantId      {string} obligatoriu
 *
 * Răspuns (201): { success: true, message, data: { supplier } }
 */
router.post(
  '/',
  authenticate,
  authorizeMinLevel('manager'),
  [
    body('name')
      .isString()
      .trim()
      .notEmpty()
      .isLength({ min: 1, max: 200 })
      .withMessage('Numele furnizorului trebuie să aibă între 1 și 200 de caractere.'),
    body('contactPerson')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 200 })
      .withMessage('Persoana de contact poate avea maximum 200 de caractere.'),
    body('phone')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 50 })
      .withMessage('Numărul de telefon poate avea maximum 50 de caractere.'),
    body('email')
      .optional()
      .isEmail()
      .normalizeEmail()
      .withMessage('Adresa de email este invalidă.'),
    body('address')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Adresa poate avea maximum 500 de caractere.'),
    body('products')
      .optional()
      .isArray()
      .withMessage('Produsele trebuie să fie o listă.'),
    body('products.*')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare produs trebuie să fie un șir de caractere valid.'),
    body('paymentTerms')
      .optional()
      .isIn(VALID_PAYMENT_TERMS)
      .withMessage(`Termenul de plată trebuie să fie unul dintre: ${VALID_PAYMENT_TERMS.join(', ')}.`),
    body('rating')
      .optional()
      .isFloat({ min: 0, max: 5 })
      .withMessage('Ratingul trebuie să fie un număr între 0 și 5.'),
    body('status')
      .optional()
      .isIn(VALID_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_STATUSES.join(', ')}.`),
    body('tenantId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul tenant-ului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const supplierData = req.body;

      // Super_admin poate crea furnizori pentru orice tenant
      if (req.user.role !== 'super_admin') {
        if (String(supplierData.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu poți crea furnizori pentru un alt tenant.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const supplier = await createSupplier(supplierData);

      res.status(201).json({
        success: true,
        message: 'Furnizorul a fost creat cu succes.',
        data: { supplier },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/suppliers – Listare furnizori (cu filtre)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/suppliers
 * @desc    Obține lista furnizorilor tenant-ului curent, cu filtre opționale
 * @access  Privat (autentificare)
 *
 * Query params (toți opționali):
 *   - status        {string}  filtrare după status
 *   - product       {string}  filtrare după produs
 *   - minRating     {number}  rating minim (0–5)
 *   - paymentTerms  {string}  filtrare după termeni de plată
 *   - search        {string}  căutare după nume (parțial)
 *   - limit         {number}  limitează rezultatele (max 100)
 *   - skip          {number}  paginare
 *
 * Răspuns (200): { success: true, message, data: { suppliers, total, limit, skip } }
 */
router.get(
  '/',
  authenticate,
  [
    query('status')
      .optional()
      .isIn(VALID_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_STATUSES.join(', ')}.`),
    query('product')
      .optional()
      .isString()
      .trim()
      .withMessage('Produsul trebuie să fie un șir de caractere.'),
    query('minRating')
      .optional()
      .isFloat({ min: 0, max: 5 })
      .withMessage('Ratingul minim trebuie să fie un număr între 0 și 5.'),
    query('paymentTerms')
      .optional()
      .isIn(VALID_PAYMENT_TERMS)
      .withMessage(`Termenul de plată trebuie să fie unul dintre: ${VALID_PAYMENT_TERMS.join(', ')}.`),
    query('search')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1 })
      .withMessage('Termenul de căutare trebuie să aibă cel puțin un caracter.'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit trebuie să fie un număr între 1 și 100.'),
    query('skip')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Skip trebuie să fie un număr mai mare sau egal cu 0.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { status, product, minRating, paymentTerms, search, limit, skip } = req.query;
      const tenantId = req.user.tenantId;

      const options = {};
      if (limit) options.limit = parseInt(limit, 10);
      if (skip) options.skip = parseInt(skip, 10);

      let suppliers = [];
      let total = 0;

      if (search) {
        // Căutare după nume
        suppliers = await searchSuppliersByName(search, tenantId);
        total = suppliers.length;

        // Aplică paginare manual pentru search
        if (options.skip) suppliers = suppliers.slice(options.skip);
        if (options.limit) suppliers = suppliers.slice(0, options.limit);
      } else if (status) {
        suppliers = await findSuppliersByStatus(status, tenantId);
        total = suppliers.length;
        if (options.skip) suppliers = suppliers.slice(options.skip);
        if (options.limit) suppliers = suppliers.slice(0, options.limit);
      } else if (product) {
        suppliers = await findSuppliersByProduct(product, tenantId);
        total = suppliers.length;
        if (options.skip) suppliers = suppliers.slice(options.skip);
        if (options.limit) suppliers = suppliers.slice(0, options.limit);
      } else if (minRating !== undefined) {
        suppliers = await findSuppliersByMinRating(parseFloat(minRating), tenantId);
        total = suppliers.length;
        if (options.skip) suppliers = suppliers.slice(options.skip);
        if (options.limit) suppliers = suppliers.slice(0, options.limit);
      } else if (paymentTerms) {
        suppliers = await findSuppliersByPaymentTerms(paymentTerms, tenantId);
        total = suppliers.length;
        if (options.skip) suppliers = suppliers.slice(options.skip);
        if (options.limit) suppliers = suppliers.slice(0, options.limit);
      } else {
        // Default: toți furnizorii tenant-ului
        suppliers = await findSuppliersByTenant(tenantId, options);
        total = await countSuppliersByTenant(tenantId);
      }

      res.status(200).json({
        success: true,
        message: 'Lista furnizorilor a fost obținută cu succes.',
        data: {
          suppliers,
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/suppliers/:id – Detalii furnizor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/suppliers/:id
 * @desc    Obține detaliile unui furnizor după ID
 * @access  Privat (autentificare)
 *
 * Răspuns (200): { success: true, message, data: { supplier } }
 */
router.get(
  '/:id',
  authenticate,
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul furnizorului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const supplier = await findSupplierById(id);
      if (!supplier) {
        return next(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(supplier.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest furnizor.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      res.status(200).json({
        success: true,
        message: 'Detaliile furnizorului au fost obținute cu succes.',
        data: { supplier },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/suppliers/:id – Actualizare furnizor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   PUT /api/suppliers/:id
 * @desc    Actualizează un furnizor existent
 * @access  Privat (rol manager, owner, super_admin)
 *
 * Body (JSON): câmpurile de actualizat (parțial)
 *
 * Răspuns (200): { success: true, message, data: { supplier } }
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
      .withMessage('ID-ul furnizorului este obligatoriu.'),
    body('name')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage('Numele furnizorului trebuie să aibă între 1 și 200 de caractere.'),
    body('contactPerson')
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 200 })
      .withMessage('Persoana de contact poate avea maximum 200 de caractere.'),
    body('phone')
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 50 })
      .withMessage('Numărul de telefon poate avea maximum 50 de caractere.'),
    body('email')
      .optional({ nullable: true })
      .isEmail()
      .normalizeEmail()
      .withMessage('Adresa de email este invalidă.'),
    body('address')
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Adresa poate avea maximum 500 de caractere.'),
    body('products')
      .optional()
      .isArray()
      .withMessage('Produsele trebuie să fie o listă.'),
    body('products.*')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare produs trebuie să fie un șir de caractere valid.'),
    body('paymentTerms')
      .optional()
      .isIn(VALID_PAYMENT_TERMS)
      .withMessage(`Termenul de plată trebuie să fie unul dintre: ${VALID_PAYMENT_TERMS.join(', ')}.`),
    body('rating')
      .optional({ nullable: true })
      .isFloat({ min: 0, max: 5 })
      .withMessage('Ratingul trebuie să fie un număr între 0 și 5.'),
    body('status')
      .optional()
      .isIn(VALID_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_STATUSES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Verificare existență furnizor
      const existingSupplier = await findSupplierById(id);
      if (!existingSupplier) {
        return next(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingSupplier.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest furnizor.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedSupplier = await updateSupplier(id, req.body);

      res.status(200).json({
        success: true,
        message: 'Furnizorul a fost actualizat cu succes.',
        data: { supplier: updatedSupplier },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/suppliers/:id – Ștergere furnizor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   DELETE /api/suppliers/:id
 * @desc    Șterge un furnizor
 * @access  Privat (rol owner, super_admin)
 *
 * Răspuns (200): { success: true, message, data: { deleted: true } }
 */
router.delete(
  '/:id',
  authenticate,
  authorizeMinLevel('owner'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul furnizorului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Verificare existență furnizor
      const existingSupplier = await findSupplierById(id);
      if (!existingSupplier) {
        return next(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingSupplier.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest furnizor.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      await deleteSupplier(id);

      res.status(200).json({
        success: true,
        message: 'Furnizorul a fost șters cu succes.',
        data: { deleted: true },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/suppliers/:id/rating – Actualizare rating
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   PATCH /api/suppliers/:id/rating
 * @desc    Actualizează ratingul unui furnizor
 * @access  Privat (rol bucătar, manager, owner, super_admin)
 *
 * Body: { rating: number (0-5) }
 *
 * Răspuns (200): { success: true, message, data: { supplier } }
 */
router.patch(
  '/:id/rating',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul furnizorului este obligatoriu.'),
    body('rating')
      .isFloat({ min: 0, max: 5 })
      .withMessage('Ratingul trebuie să fie un număr între 0 și 5.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { rating } = req.body;

      // Verificare existență furnizor
      const existingSupplier = await findSupplierById(id);
      if (!existingSupplier) {
        return next(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingSupplier.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest furnizor.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedSupplier = await updateSupplierRating(id, rating);

      res.status(200).json({
        success: true,
        message: 'Ratingul furnizorului a fost actualizat cu succes.',
        data: { supplier: updatedSupplier },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/suppliers/:id/status – Actualizare status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   PATCH /api/suppliers/:id/status
 * @desc    Actualizează statusul unui furnizor
 * @access  Privat (rol manager, owner, super_admin)
 *
 * Body: { status: string ('active' | 'inactive' | 'blacklisted') }
 *
 * Răspuns (200): { success: true, message, data: { supplier } }
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
      .withMessage('ID-ul furnizorului este obligatoriu.'),
    body('status')
      .isIn(VALID_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_STATUSES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      // Verificare existență furnizor
      const existingSupplier = await findSupplierById(id);
      if (!existingSupplier) {
        return next(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingSupplier.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest furnizor.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedSupplier = await updateSupplierStatus(id, status);

      res.status(200).json({
        success: true,
        message: 'Statusul furnizorului a fost actualizat cu succes.',
        data: { supplier: updatedSupplier },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/suppliers/:id/products – Adăugare produs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   POST /api/suppliers/:id/products
 * @desc    Adaugă un produs nou în lista furnizorului
 * @access  Privat (rol manager, owner, super_admin)
 *
 * Body: { product: string }
 *
 * Răspuns (201): { success: true, message, data: { supplier } }
 */
router.post(
  '/:id/products',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul furnizorului este obligatoriu.'),
    body('product')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Numele produsului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { product } = req.body;

      // Verificare existență furnizor
      const existingSupplier = await findSupplierById(id);
      if (!existingSupplier) {
        return next(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingSupplier.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest furnizor.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedSupplier = await addSupplierProduct(id, product.trim());

      res.status(201).json({
        success: true,
        message: 'Produsul a fost adăugat cu succes.',
        data: { supplier: updatedSupplier },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/suppliers/:id/products/:product – Eliminare produs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   DELETE /api/suppliers/:id/products/:product
 * @desc    Elimină un produs din lista furnizorului
 * @access  Privat (rol manager, owner, super_admin)
 *
 * Răspuns (200): { success: true, message, data: { supplier } }
 */
router.delete(
  '/:id/products/:product',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul furnizorului este obligatoriu.'),
    param('product')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Numele produsului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id, product } = req.params;

      // Verificare existență furnizor
      const existingSupplier = await findSupplierById(id);
      if (!existingSupplier) {
        return next(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingSupplier.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest furnizor.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedSupplier = await removeSupplierProduct(id, decodeURIComponent(product).trim());

      res.status(200).json({
        success: true,
        message: 'Produsul a fost eliminat cu succes.',
        data: { supplier: updatedSupplier },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/suppliers/:id/order – Plasează comandă furnizor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   POST /api/suppliers/:id/order
 * @desc    Plasează o comandă simulată către un furnizor
 * @access  Privat (rol bucătar, manager, owner, super_admin)
 *
 * Body (JSON):
 *   - items            {Array}   obligatoriu
 *   - items[].product  {string}  obligatoriu
 *   - items[].quantity {number}  obligatoriu
 *   - items[].unit     {string}  opțional (ex: kg, buc, l)
 *   - notes            {string}  opțional
 *   - deliveryDate     {string}  opțional (format ISO 8601)
 *
 * Răspuns (201): { success: true, message, data: { order } }
 */
router.post(
  '/:id/order',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul furnizorului este obligatoriu.'),
    body('items')
      .isArray({ min: 1 })
      .withMessage('Lista de articole este obligatorie și trebuie să conțină cel puțin un element.'),
    body('items.*.product')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare articol trebuie să aibă un nume de produs.'),
    body('items.*.quantity')
      .isFloat({ min: 0.01 })
      .withMessage('Cantitatea trebuie să fie un număr pozitiv.'),
    body('items.*.unit')
      .optional()
      .isString()
      .trim()
      .withMessage('Unitatea de măsură trebuie să fie un șir de caractere.'),
    body('notes')
      .optional()
      .isString()
      .trim()
      .withMessage('Observațiile trebuie să fie un șir de caractere.'),
    body('deliveryDate')
      .optional()
      .isISO8601()
      .withMessage('Data livrării trebuie să fie în format ISO 8601 (ex: 2025-03-20T10:00:00.000Z).'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { items, notes, deliveryDate } = req.body;

      // Verificare existență furnizor
      const supplier = await findSupplierById(id);
      if (!supplier) {
        return next(new AppError(
          'Furnizorul nu a fost găsit.',
          404,
          'SUPPLIER_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(supplier.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest furnizor.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      // Verificare status furnizor – doar furnizorii activi pot primi comenzi
      if (supplier.status !== 'active') {
        return next(new AppError(
          'Nu se poate plasa o comandă unui furnizor cu statusul "' + supplier.status + '". Statusul trebuie să fie "active".',
          400,
          'SUPPLIER_NOT_ACTIVE'
        ));
      }

      // Verificare că produsele comandate sunt în lista furnizorului
      const orderedProductNames = items.map((item) => item.product.trim().toLowerCase());
      const supplierProductNames = (supplier.products || []).map((p) => p.toLowerCase());

      const unknownProducts = orderedProductNames.filter((p) => !supplierProductNames.includes(p));
      if (unknownProducts.length > 0) {
        return next(new AppError(
          `Următoarele produse nu se găsesc în lista furnizorului: ${unknownProducts.join(', ')}.`,
          400,
          'PRODUCT_NOT_FOUND_IN_SUPPLIER'
        ));
      }

      // Generare număr comandă unic
      const now = new Date();
      const timestamp = now.getTime().toString(36).toUpperCase();
      const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
      const orderNumber = `ORD-${timestamp}-${randomPart}`;

      // Calcul total estimativ (prețurile sunt simulate)
      let totalAmount = 0;
      const orderItems = items.map((item) => {
        const itemTotal = Math.round(item.quantity * (Math.random() * 90 + 10) * 100) / 100;
        totalAmount += itemTotal;
        return {
          product: item.product.trim(),
          quantity: item.quantity,
          unit: item.unit || 'buc',
          estimatedPrice: Math.round((itemTotal / item.quantity) * 100) / 100,
          total: itemTotal,
        };
      });

      totalAmount = Math.round(totalAmount * 100) / 100;

      // Construire document comandă
      const orderDoc = {
        orderNumber,
        supplierId: id,
        supplierName: supplier.name,
        tenantId: supplier.tenantId,
        placedBy: {
          userId: req.user._id,
          userName: req.user.name || req.user.email || 'Unknown',
        },
        items: orderItems,
        totalAmount,
        status: 'plasată',
        notes: notes || '',
        deliveryDate: deliveryDate || null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      // Salvare comandă
      const savedOrder = await placeSupplierOrder(orderDoc);

      res.status(201).json({
        success: true,
        message: 'Comanda a fost plasată cu succes.',
        data: {
          order: savedOrder,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/suppliers/:id/orders – Istoric comenzi furnizor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/suppliers/:id/orders
 * @desc    Obține istoricul comenzilor plasate către un furnizor
 * @access  Privat (rol bucătar, manager, owner, super_admin)
 *
 * Query params:
 *   - status  {string}  opțional – filtrare după status
 *   - limit   {number}  opțional – max 100
 *   - skip    {number}  opțional
 *
 * Răspuns (200): { success: true, message, data: { orders, total, limit, skip } }
 */
router.get(
  '/:id/orders',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul furnizorului este obligatoriu.'),
    query('status')
      .optional()
      .isString()
      .trim()
      .withMessage('Statusul comenzii trebuie să fie un șir de caractere.'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit trebuie să fie un număr între 1 și 100.'),
    query('skip')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Skip trebuie să fie un număr întreg mai mare sau egal cu 0.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status, limit, skip } = req.query;

      // Verificare existență furnizor
      const supplier = await findSupplierById(id);
      if (!supplier) {
        return next(new AppError(
          'Furnizorul nu a fost găsit.',
          404,
          'SUPPLIER_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(supplier.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest furnizor.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const options = {};
      if (limit) options.limit = parseInt(limit, 10);
      if (skip) options.skip = parseInt(skip, 10);
      if (status) options.statusFilter = status;

      const orders = await findSupplierOrders(id, options);
      const total = await countSupplierOrders(id, options.statusFilter);

      res.status(200).json({
        success: true,
        message: 'Istoricul comenzilor a fost obținut cu succes.',
        data: {
          orders,
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

// ─────────────────────────────────────────────────────────────────────────────
// Export router
// ─────────────────────────────────────────────────────────────────────────────

module.exports = router;