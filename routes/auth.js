/**
 * ============================================================
 * routes/auth.js - Rute de autentificare (register, login, logout)
 * ============================================================
 *
 * Responsabilități:
 *  1. POST /api/auth/register  – Înregistrare utilizator nou
 *  2. POST /api/auth/login     – Autentificare utilizator existent
 *  3. POST /api/auth/logout    – Deconectare (ștergere cookie)
 *
 * Folosește:
 *  - express-validator pentru validarea câmpurilor
 *  - userModel.js pentru operații pe utilizatori
 *  - middleware/auth.js pentru generare token și cookie-uri
 *
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');

const {
  createUser,
  findUserByEmail,
  comparePassword,
} = require('../models/userModel');

const {
  generateToken,
  setTokenCookie,
  clearTokenCookie,
} = require('../middleware/auth');

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
// POST /api/auth/register
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/auth/register
 * @desc    Creează un cont nou
 * @access  Public
 *
 * Body (JSON):
 *   - email      {string}  obligatoriu
 *   - password   {string}  obligatoriu, 6-128 caractere
 *   - role       {string}  opțional, implicit 'client'
 *   - tenantId   {string}  opțional
 *
 * Răspuns (201):
 *   { success: true, data: { user, token } }
 */
router.post(
  '/register',
  [
    body('email')
      .isEmail()
      .withMessage('Adresa de email nu este validă.')
      .normalizeEmail(),
    body('password')
      .isLength({ min: 6, max: 128 })
      .withMessage('Parola trebuie să aibă între 6 și 128 de caractere.'),
    body('role')
      .optional()
      .isIn(['super_admin', 'owner', 'manager', 'recepție', 'ospătar', 'bucătar', 'client'])
      .withMessage('Rolul specificat nu este valid.'),
    body('tenantId')
      .optional({ values: 'null' })
      .isString()
      .withMessage('tenantId trebuie să fie un șir de caractere.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { email, password, role, tenantId } = req.body;

      // -------------------------------------------------------------------
      // Verificare existență utilizator (email duplicat)
      // -------------------------------------------------------------------
      const existingUser = await findUserByEmail(email);
      if (existingUser) {
        return next(new AppError(
          'Există deja un cont cu această adresă de email.',
          409,
          'DUPLICATE_EMAIL'
        ));
      }

      // -------------------------------------------------------------------
      // Creare utilizator
      // -------------------------------------------------------------------
      const newUser = await createUser({
        email,
        password,
        role: role || 'client',
        tenantId: tenantId || null,
      });

      // -------------------------------------------------------------------
      // Generare token JWT
      // -------------------------------------------------------------------
      const token = generateToken(newUser);

      // -------------------------------------------------------------------
      // Setare cookie
      // -------------------------------------------------------------------
      setTokenCookie(res, token);

      // -------------------------------------------------------------------
      // Răspuns
      // -------------------------------------------------------------------
      res.status(201).json({
        success: true,
        data: {
          user: newUser,
          token,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/auth/login
 * @desc    Autentificare utilizator
 * @access  Public
 *
 * Body (JSON):
 *   - email      {string}  obligatoriu
 *   - password   {string}  obligatoriu
 *
 * Răspuns (200):
 *   { success: true, data: { user, token } }
 */
router.post(
  '/login',
  [
    body('email')
      .isEmail()
      .withMessage('Adresa de email nu este validă.')
      .normalizeEmail(),
    body('password')
      .notEmpty()
      .withMessage('Parola este obligatorie.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { email, password } = req.body;

      // -------------------------------------------------------------------
      // Căutare utilizator după email
      // -------------------------------------------------------------------
      const user = await findUserByEmail(email);
      if (!user) {
        return next(new AppError(
          'Email sau parolă incorectă.',
          401,
          'INVALID_CREDENTIALS'
        ));
      }

      // -------------------------------------------------------------------
      // Verificare parolă
      // -------------------------------------------------------------------
      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        return next(new AppError(
          'Email sau parolă incorectă.',
          401,
          'INVALID_CREDENTIALS'
        ));
      }

      // -------------------------------------------------------------------
      // Pregătire date utilizator pentru răspuns (fără parolă)
      // -------------------------------------------------------------------
      const safeUser = { ...user };
      delete safeUser.password;

      // -------------------------------------------------------------------
      // Generare token JWT
      // -------------------------------------------------------------------
      const token = generateToken(safeUser);

      // -------------------------------------------------------------------
      // Setare cookie
      // -------------------------------------------------------------------
      setTokenCookie(res, token);

      // -------------------------------------------------------------------
      // Răspuns
      // -------------------------------------------------------------------
      res.status(200).json({
        success: true,
        data: {
          user: safeUser,
          token,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/auth/logout
 * @desc    Deconectare utilizator (șterge cookie-ul JWT)
 * @access  Public (funcționează și fără token)
 *
 * Răspuns (200):
 *   { success: true, message: 'Te-ai deconectat cu succes.' }
 */
router.post('/logout', (req, res) => {
  // -------------------------------------------------------------------
  // Ștergere cookie JWT
  // -------------------------------------------------------------------
  clearTokenCookie(res);

  // -------------------------------------------------------------------
  // Răspuns
  // -------------------------------------------------------------------
  res.status(200).json({
    success: true,
    message: 'Te-ai deconectat cu succes.',
  });
});

// ---------------------------------------------------------------------------
// Export router
// ---------------------------------------------------------------------------

module.exports = router;