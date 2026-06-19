/**
 * ============================================================
 * routes/hr.js - Rute API pentru pontaj și salarii (HR)
 * ============================================================
 *
 * Responsabilități:
 *  1. Pontaj (Attendance):
 *     - POST   /api/hr/attendance              – Înregistrare check-in/check-out
 *     - GET    /api/hr/attendance               – Listare evenimente de pontaj (cu filtre)
 *     - GET    /api/hr/attendance/last/:employeeId – Ultimul eveniment de pontaj
 *     - GET    /api/hr/attendance/employee/:employeeId – Istoric pontaj angajat
 *     - GET    /api/hr/attendance/work-hours/:employeeId – Calcul ore lucrate
 *     - DELETE /api/hr/attendance/:id           – Șterge un eveniment de pontaj
 *     - DELETE /api/hr/attendance/employee/:employeeId – Șterge toate pontajele unui angajat
 *
 *  2. Salarii (Salaries):
 *     - POST   /api/hr/salaries                – Creează o înregistrare salarială
 *     - GET    /api/hr/salaries                 – Listare înregistrări salariale
 *     - GET    /api/hr/salaries/:id             – Detalii înregistrare salarială
 *     - GET    /api/hr/salaries/employee/:employeeId – Salariile unui angajat
 *     - PUT    /api/hr/salaries/:id             – Actualizează o înregistrare salarială
 *     - PATCH  /api/hr/salaries/:id/status      – Actualizează statusul salariului
 *     - PATCH  /api/hr/salaries/:id/amount      – Actualizează suma brută
 *     - DELETE /api/hr/salaries/:id             – Șterge o înregistrare salarială
 *     - GET    /api/hr/salaries/summary         – Sumar salarii pe perioade / statusuri
 *
 * Folosește:
 *  - express-validator pentru validarea câmpurilor
 *  - hrModel.js pentru operații CRUD pe pontaj și salarii
 *  - middleware/auth.js pentru autentificare
 *  - middleware/roles.js pentru autorizare pe bază de roluri
 *
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');

const {
  // Pontaj
  createAttendanceRecord,
  findAttendanceById,
  findAttendanceByEmployee,
  findAttendanceByTenant,
  findLastAttendanceEvent,
  calculateWorkHours,
  countAttendance,
  deleteAttendanceRecord,
  deleteAttendanceByEmployee,

  // Salarii
  createSalaryRecord,
  findSalaryById,
  findSalariesByEmployee,
  findSalariesByTenant,
  updateSalaryRecord,
  deleteSalaryRecord,

  // Constante
  VALID_ATTENDANCE_TYPES,
  VALID_LOCATION_TYPES,
  VALID_CURRENCIES,
  VALID_SALARY_STATUS,
  VALID_PAYMENT_FREQUENCIES,
} = require('../models/hrModel');

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
// ========================= PONTAJ (ATTENDANCE) ===========================
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// POST /api/hr/attendance – Înregistrare check-in / check-out
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/hr/attendance
 * @desc    Înregistrează un eveniment de pontaj (check-in sau check-out)
 * @access  Privat (autentificare + rol ospătar, bucătar, recepție,
 *                  manager, owner, super_admin)
 *
 * Body (JSON):
 *   - employeeId    {string}  obligatoriu – ID-ul angajatului
 *   - type          {string}  obligatoriu – 'checkIn' | 'checkOut'
 *   - timestamp     {string}  obligatoriu – momentul evenimentului (ISO string)
 *   - locationId    {string}  opțional – ID-ul locației
 *   - locationType  {string}  opțional – tipul locației
 *   - note          {string}  opțional – notă adițională
 *
 * Răspuns (201):
 *   { success: true, data: { record } }
 */
router.post(
  '/attendance',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    body('employeeId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul angajatului este obligatoriu.'),
    body('type')
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_ATTENDANCE_TYPES)
      .withMessage(`Tipul de pontaj trebuie să fie: ${VALID_ATTENDANCE_TYPES.join(', ')}.`),
    body('timestamp')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Timestamp-ul este obligatoriu (ISO string).'),
    body('locationId')
      .optional({ values: 'null' })
      .isString()
      .trim()
      .withMessage('ID-ul locației trebuie să fie un șir de caractere.'),
    body('locationType')
      .optional({ values: 'null' })
      .isString()
      .trim()
      .isIn(VALID_LOCATION_TYPES)
      .withMessage(`Tipul locației trebuie să fie: ${VALID_LOCATION_TYPES.join(', ')}.`),
    body('note')
      .optional()
      .isString()
      .isLength({ max: 2000 })
      .withMessage('Nota poate avea maximum 2000 de caractere.'),
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

      const { employeeId, type, timestamp, locationId, locationType, note } = req.body;

      const attendanceData = {
        employeeId: employeeId.trim(),
        type,
        timestamp,
        locationId: locationId || null,
        locationType: locationType || null,
        note: note || '',
        userId: req.user._id,
        tenantId,
      };

      const newRecord = await createAttendanceRecord(attendanceData);

      res.status(201).json({
        success: true,
        data: { record: newRecord },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/hr/attendance – Listare evenimente de pontaj
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hr/attendance
 * @desc    Listare evenimente de pontaj cu opțiuni de filtrare și paginare
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Query params:
 *   - employeeId    {string}  opțional – filtrare după angajat
 *   - type          {string}  opțional – 'checkIn' | 'checkOut'
 *   - startDate     {string}  opțional – dată de început (ISO)
 *   - endDate       {string}  opțional – dată de sfârșit (ISO)
 *   - locationId    {string}  opțional – filtrare după locație
 *   - sortBy        {string}  opțional – câmp de sortare (implicit 'timestamp')
 *   - sortOrder     {string}  opțional – 'asc' | 'desc' (implicit 'desc')
 *   - limit         {number}  opțional – număr maxim de rezultate
 *   - skip          {number}  opțional – câte rezultate se sar
 *
 * Răspuns (200):
 *   { success: true, data: { records, total } }
 */
router.get(
  '/attendance',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    query('type')
      .optional()
      .isIn(VALID_ATTENDANCE_TYPES)
      .withMessage(`Tipul trebuie să fie: ${VALID_ATTENDANCE_TYPES.join(', ')}.`),
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
      .isInt({ min: 1, max: 200 })
      .withMessage('Limit trebuie să fie un număr între 1 și 200.'),
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
          data: { records: [], total: 0 },
        });
      }

      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { employeeId, type, startDate, endDate, locationId, sortBy, sortOrder, limit, skip } = req.query;

      const options = {};
      if (employeeId) options.employeeId = employeeId.trim();
      if (type) options.type = type;
      if (startDate) options.startDate = startDate;
      if (endDate) options.endDate = endDate;
      if (locationId) options.locationId = locationId.trim();
      if (sortBy) options.sortBy = sortBy;
      if (sortOrder) options.sortOrder = sortOrder;
      if (limit) options.limit = parseInt(limit, 10);
      if (skip) options.skip = parseInt(skip, 10);

      const records = await findAttendanceByTenant(tenantId, options);
      const total = await countAttendance(tenantId, { employeeId, type, startDate, endDate });

      res.status(200).json({
        success: true,
        data: { records, total },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/hr/attendance/last/:employeeId – Ultimul eveniment de pontaj
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hr/attendance/last/:employeeId
 * @desc    Obține ultimul eveniment de pontaj pentru un angajat
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Răspuns (200):
 *   { success: true, data: { record } }
 */
router.get(
  '/attendance/last/:employeeId',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('employeeId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul angajatului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { employeeId } = req.params;

      const record = await findLastAttendanceEvent(employeeId);

      if (!record) {
        return next(new AppError(
          'Nu s-a găsit niciun eveniment de pontaj pentru acest angajat.',
          404,
          'NO_ATTENDANCE_FOUND'
        ));
      }

      res.status(200).json({
        success: true,
        data: { record },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/hr/attendance/employee/:employeeId – Istoric pontaj angajat
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hr/attendance/employee/:employeeId
 * @desc    Listare evenimente de pontaj pentru un angajat specific
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Query params:
 *   - type          {string}  opțional – 'checkIn' | 'checkOut'
 *   - startDate     {string}  opțional – dată de început (ISO)
 *   - endDate       {string}  opțional – dată de sfârșit (ISO)
 *   - sortBy        {string}  opțional – câmp de sortare (implicit 'timestamp')
 *   - sortOrder     {string}  opțional – 'asc' | 'desc' (implicit 'desc')
 *   - limit         {number}  opțional – număr maxim de rezultate
 *   - skip          {number}  opțional – câte rezultate se sar
 *
 * Răspuns (200):
 *   { success: true, data: { records } }
 */
router.get(
  '/attendance/employee/:employeeId',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('employeeId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul angajatului este obligatoriu.'),
    query('type')
      .optional()
      .isIn(VALID_ATTENDANCE_TYPES)
      .withMessage(`Tipul trebuie să fie: ${VALID_ATTENDANCE_TYPES.join(', ')}.`),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 200 })
      .withMessage('Limit trebuie să fie un număr între 1 și 200.'),
    query('skip')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Skip trebuie să fie un număr întreg, mai mare sau egal cu 0.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { employeeId } = req.params;
      const { type, startDate, endDate, sortBy, sortOrder, limit, skip } = req.query;

      const options = {};
      if (type) options.type = type;
      if (startDate) options.startDate = startDate;
      if (endDate) options.endDate = endDate;
      if (sortBy) options.sortBy = sortBy;
      if (sortOrder) options.sortOrder = sortOrder;
      if (limit) options.limit = parseInt(limit, 10);
      if (skip) options.skip = parseInt(skip, 10);

      const records = await findAttendanceByEmployee(employeeId, options);

      res.status(200).json({
        success: true,
        data: { records },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/hr/attendance/work-hours/:employeeId – Calcul ore lucrate
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hr/attendance/work-hours/:employeeId
 * @desc    Calculează orele lucrate de un angajat într-un interval
 * @access  Privat (autentificare + rol bucătar, manager, owner, super_admin)
 *
 * Query params:
 *   - startDate  {string}  obligatoriu – dată de început (ISO)
 *   - endDate    {string}  obligatoriu – dată de sfârșit (ISO)
 *
 * Răspuns (200):
 *   { success: true, data: { workHours } }
 */
router.get(
  '/attendance/work-hours/:employeeId',
  authenticate,
  authorizeMinLevel('bucătar'),
  [
    param('employeeId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul angajatului este obligatoriu.'),
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
      const { employeeId } = req.params;
      const { startDate, endDate } = req.query;

      const workHours = await calculateWorkHours(employeeId, startDate, endDate);

      res.status(200).json({
        success: true,
        data: { workHours },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/hr/attendance/:id – Șterge un eveniment de pontaj
// ---------------------------------------------------------------------------

/**
 * @route   DELETE /api/hr/attendance/:id
 * @desc    Șterge un eveniment de pontaj după ID
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Răspuns (200):
 *   { success: true, message: 'Evenimentul de pontaj a fost șters cu succes.' }
 */
router.delete(
  '/attendance/:id',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul evenimentului de pontaj este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Verificare existență
      const existingRecord = await findAttendanceById(id);
      if (!existingRecord) {
        return next(new AppError(
          'Evenimentul de pontaj nu a fost găsit.',
          404,
          'ATTENDANCE_NOT_FOUND'
        ));
      }

      await deleteAttendanceRecord(id);

      res.status(200).json({
        success: true,
        message: 'Evenimentul de pontaj a fost șters cu succes.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/hr/attendance/employee/:employeeId – Șterge toate pontajele
// ---------------------------------------------------------------------------

/**
 * @route   DELETE /api/hr/attendance/employee/:employeeId
 * @desc    Șterge toate evenimentele de pontaj pentru un angajat
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Răspuns (200):
 *   { success: true, data: { deletedCount } }
 */
router.delete(
  '/attendance/employee/:employeeId',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('employeeId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul angajatului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { employeeId } = req.params;

      const deletedCount = await deleteAttendanceByEmployee(employeeId);

      res.status(200).json({
        success: true,
        data: { deletedCount },
        message: deletedCount > 0
          ? `Au fost șterse ${deletedCount} înregistrări de pontaj.`
          : 'Nu s-au găsit înregistrări de pontaj pentru acest angajat.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// ========================= SALARII (SALARIES) =============================
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// POST /api/hr/salaries – Creează o înregistrare salarială
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/hr/salaries
 * @desc    Creează o înregistrare salarială (salariu brut) pentru un angajat
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Body (JSON):
 *   - employeeId       {string}  obligatoriu – ID-ul angajatului
 *   - grossAmount      {number}  obligatoriu – salariul brut
 *   - currency         {string}  opțional – moneda (implicit 'RON')
 *   - period           {string}  opțional – perioada (ex: "2025-01")
 *   - paymentFrequency {string}  opțional – frecvența de plată (implicit 'lunar')
 *   - status           {string}  opțional – statusul (implicit 'necalculat')
 *   - deductions       {number}  opțional – deduceri
 *   - bonuses          {number}  opțional – bonusuri
 *   - netAmount        {number}  opțional – suma netă
 *   - note             {string}  opțional – notă adițională
 *
 * Răspuns (201):
 *   { success: true, data: { salary } }
 */
router.post(
  '/salaries',
  authenticate,
  authorizeMinLevel('manager'),
  [
    body('employeeId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul angajatului este obligatoriu.'),
    body('grossAmount')
      .isFloat({ min: 0.01 })
      .withMessage('Salariul brut trebuie să fie un număr mai mare decât 0.'),
    body('currency')
      .optional()
      .isString()
      .trim()
      .isIn(VALID_CURRENCIES)
      .withMessage(`Moneda trebuie să fie: ${VALID_CURRENCIES.join(', ')}.`),
    body('period')
      .optional({ values: 'null' })
      .isString()
      .trim()
      .withMessage('Perioada trebuie să fie un șir de caractere (ex: "2025-01").'),
    body('paymentFrequency')
      .optional()
      .isString()
      .trim()
      .isIn(VALID_PAYMENT_FREQUENCIES)
      .withMessage(`Frecvența de plată trebuie să fie: ${VALID_PAYMENT_FREQUENCIES.join(', ')}.`),
    body('status')
      .optional()
      .isString()
      .trim()
      .isIn(VALID_SALARY_STATUS)
      .withMessage(`Statusul trebuie să fie: ${VALID_SALARY_STATUS.join(', ')}.`),
    body('deductions')
      .optional({ values: 'null' })
      .isFloat({ min: 0 })
      .withMessage('Deducerile trebuie să fie un număr mai mare sau egal cu 0.'),
    body('bonuses')
      .optional({ values: 'null' })
      .isFloat({ min: 0 })
      .withMessage('Bonusurile trebuie să fie un număr mai mare sau egal cu 0.'),
    body('netAmount')
      .optional({ values: 'null' })
      .isFloat({ min: 0 })
      .withMessage('Suma netă trebuie să fie un număr mai mare sau egal cu 0.'),
    body('note')
      .optional()
      .isString()
      .isLength({ max: 2000 })
      .withMessage('Nota poate avea maximum 2000 de caractere.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const tenantId = resolveTenantId(req);

      if (!tenantId) {
        return next(new AppError(
          'Nu poți crea o înregistrare salarială fără un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const {
        employeeId,
        grossAmount,
        currency,
        period,
        paymentFrequency,
        status,
        deductions,
        bonuses,
        netAmount,
        note,
      } = req.body;

      const salaryData = {
        employeeId: employeeId.trim(),
        grossAmount,
        currency: currency || 'RON',
        period: period || null,
        paymentFrequency: paymentFrequency || 'lunar',
        status: status || 'necalculat',
        deductions: deductions !== undefined ? deductions : 0,
        bonuses: bonuses !== undefined ? bonuses : 0,
        netAmount: netAmount !== undefined ? netAmount : null,
        note: note || '',
        userId: req.user._id,
        tenantId,
      };

      const newSalary = await createSalaryRecord(salaryData);

      res.status(201).json({
        success: true,
        data: { salary: newSalary },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/hr/salaries – Listare înregistrări salariale
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hr/salaries
 * @desc    Listare înregistrări salariale cu opțiuni de filtrare
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Query params:
 *   - employeeId  {string}  opțional – filtrare după angajat
 *   - period      {string}  opțional – filtrare după perioadă
 *   - status      {string}  opțional – filtrare după status
 *   - sortBy      {string}  opțional – câmp de sortare (implicit 'createdAt')
 *   - sortOrder   {string}  opțional – 'asc' | 'desc' (implicit 'desc')
 *   - limit       {number}  opțional – număr maxim de rezultate
 *   - skip        {number}  opțional – câte rezultate se sar
 *
 * Răspuns (200):
 *   { success: true, data: { salaries } }
 */
router.get(
  '/salaries',
  authenticate,
  authorizeMinLevel('manager'),
  [
    query('status')
      .optional()
      .isIn(VALID_SALARY_STATUS)
      .withMessage(`Statusul trebuie să fie: ${VALID_SALARY_STATUS.join(', ')}.`),
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
      .isInt({ min: 1, max: 200 })
      .withMessage('Limit trebuie să fie un număr între 1 și 200.'),
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
          data: { salaries: [] },
        });
      }

      if (!tenantId) {
        return next(new AppError(
          'Nu ai un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const { employeeId, period, status, sortBy, sortOrder, limit, skip } = req.query;

      const options = {};
      if (employeeId) options.employeeId = employeeId.trim();
      if (period) options.period = period;
      if (status) options.status = status;
      if (sortBy) options.sortBy = sortBy;
      if (sortOrder) options.sortOrder = sortOrder;
      if (limit) options.limit = parseInt(limit, 10);
      if (skip) options.skip = parseInt(skip, 10);

      const salaries = await findSalariesByTenant(tenantId, options);

      res.status(200).json({
        success: true,
        data: { salaries },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/hr/salaries/summary – Sumar salarii pe perioade / statusuri
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hr/salaries/summary
 * @desc    Returnează un sumar al salariilor: totaluri pe statusuri,
 *           perioade, monede și totalul general brut/net
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Query params:
 *   - period      {string}  opțional – filtrare după perioadă
 *   - startPeriod {string}  opțional – perioadă de început
 *   - endPeriod   {string}  opțional – perioadă de sfârșit
 *
 * Răspuns (200):
 *   {
 *     success: true,
 *     data: {
 *       summary: {
 *         totalGross: number,
 *         totalNet: number,
 *         totalDeductions: number,
 *         totalBonuses: number,
 *         byStatus: { [status]: { count, totalGross, totalNet } },
 *         byPeriod: { [period]: { count, totalGross, totalNet } },
 *         byCurrency: { [currency]: { count, totalGross, totalNet } }
 *       }
 *     }
 *   }
 */
router.get(
  '/salaries/summary',
  authenticate,
  authorizeMinLevel('manager'),
  [
    query('period')
      .optional()
      .isString()
      .trim()
      .withMessage('Perioada trebuie să fie un șir de caractere.'),
    query('startPeriod')
      .optional()
      .isString()
      .trim()
      .withMessage('Perioada de început trebuie să fie un șir de caractere.'),
    query('endPeriod')
      .optional()
      .isString()
      .trim()
      .withMessage('Perioada de sfârșit trebuie să fie un șir de caractere.'),
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

      const { period, startPeriod, endPeriod } = req.query;

      // Obținem toate salariile pentru tenant
      const filters = {};
      if (period) filters.period = period;
      if (startPeriod) filters.startPeriod = startPeriod;
      if (endPeriod) filters.endPeriod = endPeriod;

      const salaries = await findSalariesByTenant(tenantId, filters);

      // Construim sumarul
      const summary = {
        totalGross: 0,
        totalNet: 0,
        totalDeductions: 0,
        totalBonuses: 0,
        byStatus: {},
        byPeriod: {},
        byCurrency: {},
      };

      for (const s of salaries) {
        const gross = Number(s.grossAmount) || 0;
        const net = Number(s.netAmount) || 0;
        const deductions = Number(s.deductions) || 0;
        const bonuses = Number(s.bonuses) || 0;
        const status = s.status || 'necunoscut';
        const periodKey = s.period || 'neperioada';
        const currency = s.currency || 'RON';

        // Totaluri globale
        summary.totalGross += gross;
        summary.totalNet += net;
        summary.totalDeductions += deductions;
        summary.totalBonuses += bonuses;

        // Pe status
        if (!summary.byStatus[status]) {
          summary.byStatus[status] = { count: 0, totalGross: 0, totalNet: 0 };
        }
        summary.byStatus[status].count += 1;
        summary.byStatus[status].totalGross += gross;
        summary.byStatus[status].totalNet += net;

        // Pe perioadă
        if (!summary.byPeriod[periodKey]) {
          summary.byPeriod[periodKey] = { count: 0, totalGross: 0, totalNet: 0 };
        }
        summary.byPeriod[periodKey].count += 1;
        summary.byPeriod[periodKey].totalGross += gross;
        summary.byPeriod[periodKey].totalNet += net;

        // Pe monedă
        if (!summary.byCurrency[currency]) {
          summary.byCurrency[currency] = { count: 0, totalGross: 0, totalNet: 0 };
        }
        summary.byCurrency[currency].count += 1;
        summary.byCurrency[currency].totalGross += gross;
        summary.byCurrency[currency].totalNet += net;
      }

      // Rotunjire la 2 zecimale
      summary.totalGross = Math.round(summary.totalGross * 100) / 100;
      summary.totalNet = Math.round(summary.totalNet * 100) / 100;
      summary.totalDeductions = Math.round(summary.totalDeductions * 100) / 100;
      summary.totalBonuses = Math.round(summary.totalBonuses * 100) / 100;

      for (const key of Object.keys(summary.byStatus)) {
        summary.byStatus[key].totalGross =
          Math.round(summary.byStatus[key].totalGross * 100) / 100;
        summary.byStatus[key].totalNet =
          Math.round(summary.byStatus[key].totalNet * 100) / 100;
      }
      for (const key of Object.keys(summary.byPeriod)) {
        summary.byPeriod[key].totalGross =
          Math.round(summary.byPeriod[key].totalGross * 100) / 100;
        summary.byPeriod[key].totalNet =
          Math.round(summary.byPeriod[key].totalNet * 100) / 100;
      }
      for (const key of Object.keys(summary.byCurrency)) {
        summary.byCurrency[key].totalGross =
          Math.round(summary.byCurrency[key].totalGross * 100) / 100;
        summary.byCurrency[key].totalNet =
          Math.round(summary.byCurrency[key].totalNet * 100) / 100;
      }

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
// GET /api/hr/salaries/:id – Detalii înregistrare salarială
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hr/salaries/:id
 * @desc    Obține detaliile unei înregistrări salariale după ID
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Răspuns (200):
 *   { success: true, data: { salary } }
 */
router.get(
  '/salaries/:id',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul înregistrării salariale este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const salary = await findSalaryById(id);

      if (!salary) {
        return next(new AppError(
          'Înregistrarea salarială nu a fost găsită.',
          404,
          'SALARY_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(salary.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la această înregistrare salarială.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      res.status(200).json({
        success: true,
        data: { salary },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/hr/salaries/employee/:employeeId – Salariile unui angajat
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hr/salaries/employee/:employeeId
 * @desc    Listare înregistrări salariale pentru un angajat specific
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Query params:
 *   - period  {string}  opțional – filtrare după perioadă
 *   - status  {string}  opțional – filtrare după status
 *   - sortBy  {string}  opțional – câmp de sortare (implicit 'createdAt')
 *   - sortOrder {string} opțional – 'asc' | 'desc'
 *   - limit   {number}  opțional – număr maxim de rezultate
 *
 * Răspuns (200):
 *   { success: true, data: { salaries } }
 */
router.get(
  '/salaries/employee/:employeeId',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('employeeId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul angajatului este obligatoriu.'),
    query('status')
      .optional()
      .isIn(VALID_SALARY_STATUS)
      .withMessage(`Statusul trebuie să fie: ${VALID_SALARY_STATUS.join(', ')}.`),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 200 })
      .withMessage('Limit trebuie să fie un număr între 1 și 200.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { employeeId } = req.params;
      const { period, status, sortBy, sortOrder, limit } = req.query;

      const options = {};
      if (period) options.period = period;
      if (status) options.status = status;
      if (sortBy) options.sortBy = sortBy;
      if (sortOrder) options.sortOrder = sortOrder;
      if (limit) options.limit = parseInt(limit, 10);

      const salaries = await findSalariesByEmployee(employeeId, options);

      res.status(200).json({
        success: true,
        data: { salaries },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/hr/salaries/:id – Actualizează o înregistrare salarială
// ---------------------------------------------------------------------------

/**
 * @route   PUT /api/hr/salaries/:id
 * @desc    Actualizează o înregistrare salarială existentă
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Body (JSON) – cel puțin un câmp obligatoriu:
 *   - grossAmount      {number}  opțional
 *   - currency         {string}  opțional
 *   - period           {string}  opțional
 *   - paymentFrequency {string}  opțional
 *   - deductions       {number}  opțional
 *   - bonuses          {number}  opțional
 *   - netAmount        {number}  opțional
 *   - note             {string}  opțional
 *
 * Răspuns (200):
 *   { success: true, data: { salary } }
 */
router.put(
  '/salaries/:id',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul înregistrării salariale este obligatoriu.'),
    body('grossAmount')
      .optional({ values: 'null' })
      .isFloat({ min: 0.01 })
      .withMessage('Salariul brut trebuie să fie un număr mai mare decât 0.'),
    body('currency')
      .optional()
      .isString()
      .trim()
      .isIn(VALID_CURRENCIES)
      .withMessage(`Moneda trebuie să fie: ${VALID_CURRENCIES.join(', ')}.`),
    body('period')
      .optional({ values: 'null' })
      .isString()
      .trim()
      .withMessage('Perioada trebuie să fie un șir de caractere (ex: "2025-01").'),
    body('paymentFrequency')
      .optional()
      .isString()
      .trim()
      .isIn(VALID_PAYMENT_FREQUENCIES)
      .withMessage(`Frecvența de plată trebuie să fie: ${VALID_PAYMENT_FREQUENCIES.join(', ')}.`),
    body('deductions')
      .optional({ values: 'null' })
      .isFloat({ min: 0 })
      .withMessage('Deducerile trebuie să fie un număr mai mare sau egal cu 0.'),
    body('bonuses')
      .optional({ values: 'null' })
      .isFloat({ min: 0 })
      .withMessage('Bonusurile trebuie să fie un număr mai mare sau egal cu 0.'),
    body('netAmount')
      .optional({ values: 'null' })
      .isFloat({ min: 0 })
      .withMessage('Suma netă trebuie să fie un număr mai mare sau egal cu 0.'),
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

      // Verificare existență
      const existingSalary = await findSalaryById(id);
      if (!existingSalary) {
        return next(new AppError(
          'Înregistrarea salarială nu a fost găsită.',
          404,
          'SALARY_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingSalary.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la această înregistrare salarială.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const {
        grossAmount,
        currency,
        period,
        paymentFrequency,
        deductions,
        bonuses,
        netAmount,
        note,
      } = req.body;

      // Construim obiectul de update doar cu câmpurile trimise
      const updateData = {};
      if (grossAmount !== undefined) updateData.grossAmount = grossAmount;
      if (currency !== undefined) updateData.currency = currency.trim();
      if (period !== undefined) updateData.period = period ? period.trim() : null;
      if (paymentFrequency !== undefined) updateData.paymentFrequency = paymentFrequency.trim();
      if (deductions !== undefined) updateData.deductions = deductions;
      if (bonuses !== undefined) updateData.bonuses = bonuses;
      if (netAmount !== undefined) updateData.netAmount = netAmount;
      if (note !== undefined) updateData.note = note;

      if (Object.keys(updateData).length === 0) {
        return next(new AppError(
          'Trebuie să trimiți cel puțin un câmp pentru actualizare.',
          400,
          'NO_UPDATE_DATA'
        ));
      }

      const updatedSalary = await updateSalaryRecord(id, updateData);

      res.status(200).json({
        success: true,
        data: { salary: updatedSalary },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/hr/salaries/:id/status – Actualizează statusul salariului
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/hr/salaries/:id/status
 * @desc    Actualizează doar statusul unei înregistrări salariale
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Body (JSON):
 *   - status  {string}  obligatoriu – noul status
 *
 * Răspuns (200):
 *   { success: true, data: { salary } }
 */
router.patch(
  '/salaries/:id/status',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul înregistrării salariale este obligatoriu.'),
    body('status')
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_SALARY_STATUS)
      .withMessage(`Statusul trebuie să fie: ${VALID_SALARY_STATUS.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      // Verificare existență
      const existingSalary = await findSalaryById(id);
      if (!existingSalary) {
        return next(new AppError(
          'Înregistrarea salarială nu a fost găsită.',
          404,
          'SALARY_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingSalary.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la această înregistrare salarială.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedSalary = await updateSalaryRecord(id, { status: status.trim() });

      res.status(200).json({
        success: true,
        data: { salary: updatedSalary },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/hr/salaries/:id/amount – Actualizează suma brută
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/hr/salaries/:id/amount
 * @desc    Actualizează suma brută (și opțional netă, deduceri, bonusuri)
 *           pentru o înregistrare salarială
 * @access  Privat (autentificare + rol manager, owner, super_admin)
 *
 * Body (JSON):
 *   - grossAmount  {number}  obligatoriu – noua sumă brută
 *   - deductions   {number}  opțional – deduceri actualizate
 *   - bonuses      {number}  opțional – bonusuri actualizate
 *   - netAmount    {number}  opțional – sumă netă actualizată
 *
 * Răspuns (200):
 *   { success: true, data: { salary } }
 */
router.patch(
  '/salaries/:id/amount',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul înregistrării salariale este obligatoriu.'),
    body('grossAmount')
      .isFloat({ min: 0.01 })
      .withMessage('Salariul brut trebuie să fie un număr mai mare decât 0.'),
    body('deductions')
      .optional({ values: 'null' })
      .isFloat({ min: 0 })
      .withMessage('Deducerile trebuie să fie un număr mai mare sau egal cu 0.'),
    body('bonuses')
      .optional({ values: 'null' })
      .isFloat({ min: 0 })
      .withMessage('Bonusurile trebuie să fie un număr mai mare sau egal cu 0.'),
    body('netAmount')
      .optional({ values: 'null' })
      .isFloat({ min: 0 })
      .withMessage('Suma netă trebuie să fie un număr mai mare sau egal cu 0.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { grossAmount, deductions, bonuses, netAmount } = req.body;

      // Verificare existență
      const existingSalary = await findSalaryById(id);
      if (!existingSalary) {
        return next(new AppError(
          'Înregistrarea salarială nu a fost găsită.',
          404,
          'SALARY_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingSalary.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la această înregistrare salarială.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updateData = { grossAmount };
      if (deductions !== undefined) updateData.deductions = deductions;
      if (bonuses !== undefined) updateData.bonuses = bonuses;
      if (netAmount !== undefined) updateData.netAmount = netAmount;

      const updatedSalary = await updateSalaryRecord(id, updateData);

      res.status(200).json({
        success: true,
        data: { salary: updatedSalary },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/hr/salaries/:id – Șterge o înregistrare salarială
// ---------------------------------------------------------------------------

/**
 * @route   DELETE /api/hr/salaries/:id
 * @desc    Șterge o înregistrare salarială după ID
 * @access  Privat (autentificare + rol owner, super_admin)
 *
 * Răspuns (200):
 *   { success: true, message: 'Înregistrarea salarială a fost ștearsă cu succes.' }
 */
router.delete(
  '/salaries/:id',
  authenticate,
  authorizeMinLevel('owner'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul înregistrării salariale este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Verificare existență
      const existingSalary = await findSalaryById(id);
      if (!existingSalary) {
        return next(new AppError(
          'Înregistrarea salarială nu a fost găsită.',
          404,
          'SALARY_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingSalary.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la această înregistrare salarială.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      await deleteSalaryRecord(id);

      res.status(200).json({
        success: true,
        message: 'Înregistrarea salarială a fost ștearsă cu succes.',
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;