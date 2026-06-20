/**
 * ============================================================
 * middleware/errorHandler.js - Middleware global de gestionare a erorilor
 * ============================================================
 *
 * Responsabilități:
 *  1. Interceptează toate erorile neprinse care ajung în pipeline-ul Express
 *  2. Normalizează erorile într-un răspuns JSON consistent
 *  3. Diferențiază între erori operaționale (previzibile) și erori de programare
 *  4. În modul development returnează stack trace; în producție doar mesajul
 *  5. Loghează erorile critice pe stderr
 *
 * Folosire:
 *    const errorHandler = require('./middleware/errorHandler');
 *    app.use(errorHandler);
 *
 *    // în rute:
 *    next(new AppError('Resursa nu a fost găsită', 404));
 *
 * ============================================================
 */

// ---------------------------------------------------------------------------
// AppError - clasă personalizată pentru erori operaționale
// ---------------------------------------------------------------------------

/**
 * @class AppError
 * @extends Error
 * @description
 *  Utilizează această clasă pentru a distinge erorile operaționale
 *  (de ex. validare, resursă negăsită) de erorile neprevăzute.
 *
 * @param {string}  message   - Descrierea erorii
 * @param {number}  statusCode - Codul HTTP (implicit 500)
 * @param {string}  [code]    - Cod intern opțional (ex: 'VALIDATION_ERROR')
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code || null;
    this.isOperational = true; // Semnalează că este o eroare controlată
    Error.captureStackTrace(this, this.constructor);
  }
}

// ---------------------------------------------------------------------------
// Middleware propriu-zis
// ---------------------------------------------------------------------------

/**
 * Middleware global de gestionare a erorilor pentru Express.
 * Primește 4 parametri (err, req, res, next) - Express îl recunoaște
 * automat ca middleware de eroare datorită numărului de parametri.
 *
 * @param {Error}  err   - Obiectul erorii (poate fi AppError sau orice Error)
 * @param {Object} req   - Obiectul request Express
 * @param {Object} res   - Obiectul response Express
 * @param {Function} next - Următorul middleware (de obicei nefolosit)
 */
function errorHandler(err, req, res, next) {
  // -----------------------------------------------------------------------
  // 1. Normalizare eroare
  // -----------------------------------------------------------------------
  // Dacă eroarea nu este una operațională (AppError), o transformăm
  // într-un răspuns generic 500 Internal Server Error.
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'Eroare internă de server';
  const code = err.code || null;

  // -----------------------------------------------------------------------
  // 2. Logare
  // -----------------------------------------------------------------------
  // Erorile 500+ (server) le logăm pe stderr cu stack trace.
  // Erorile sub 500 (client) le logăm doar pe stdout, fără stack.
  if (statusCode >= 500) {
    console.error(`[ERROR] ${new Date().toISOString()} ${statusCode} - ${err.message}`);
    if (err.stack) {
      console.error(err.stack);
    }
  } else {
    console.log(`[WARN] ${new Date().toISOString()} ${statusCode} - ${err.message}`);
  }

  // -----------------------------------------------------------------------
  // 3. Construire răspuns JSON
  // -----------------------------------------------------------------------
  const response = {
    success: false,
    error: {
      message,
      code,
    },
  };

  // În development (NODE_ENV nefiind 'production') adăugăm detalii
  if (process.env.NODE_ENV !== 'production') {
    response.error.statusCode = statusCode;
    if (err.stack) {
      response.error.stack = err.stack.split('\n').map((line) => line.trim());
    }
  }

  // -----------------------------------------------------------------------
  // 4. Trimitere răspuns
  // -----------------------------------------------------------------------
  res.status(statusCode).json(response);
}

// ---------------------------------------------------------------------------
// Funcție helper pentru a crea rapid erori operaționale în rute
// ---------------------------------------------------------------------------

/**
 * Funcție shorthand pentru a crea și trimite mai departe un AppError.
 *
 * @param {string}  message    - Mesajul erorii
 * @param {number}  statusCode - Codul HTTP
 * @param {string}  [code]     - Cod intern
 * @returns {AppError}
 *
 * Exemplu:
 *    return next(createError('Email-ul există deja', 409, 'DUPLICATE_EMAIL'));
 */
function createError(message, statusCode = 500, code) {
  return new AppError(message, statusCode, code);
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  errorHandler,
  AppError,
  createError,
};