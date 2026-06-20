/**
 * ============================================================
 * middleware/auth.js - Middleware de autentificare JWT
 * ============================================================
 *
 * Responsabilități:
 *  1. Verifică token-ul JWT din cookie-ul 'token' sau din header-ul
 *     Authorization (Bearer <token>)
 *  2. Decodifică token-ul și populază req.user cu datele utilizatorului
 *  3. Expune middleware-ul `authenticate` (obligatoriu) și `optionalAuth`
 *     (autentificare opțională)
 *  4. Expune funcția `generateToken` pentru crearea de token-uri JWT
 *  5. Expune funcția `setTokenCookie` / `clearTokenCookie` pentru gestionarea
 *     cookie-urilor
 *
 * Folosire:
 *    const { authenticate, optionalAuth, generateToken, setTokenCookie,
 *           clearTokenCookie } = require('../middleware/auth');
 *
 *    // Protejează o rută
 *    router.get('/me', authenticate, userController.getMe);
 *
 *    // Autentificare opțională
 *    router.get('/public', optionalAuth, controller.publicEndpoint);
 *
 * ============================================================
 */

const jwt = require('jsonwebtoken');
const { AppError } = require('./errorHandler');
const { promisify } = require('util');
const { authorize } = require('./roles');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/**
 * Numele cookie-ului folosit pentru stocarea token-ului JWT.
 * @type {string}
 */
const TOKEN_COOKIE_NAME = 'token';

/**
 * Timpul implicit de expirare a token-ului (7 zile).
 * @type {string}
 */
const DEFAULT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ---------------------------------------------------------------------------
// Funcție internă: căutare utilizator după ID
// ---------------------------------------------------------------------------

/**
 * Caută un utilizator în baza de date după ID-ul extras din token.
 * Întoarce o promisiune pentru a putea fi folosit cu async/await.
 *
 * Backend: exclusiv SQLite (prin userModel.findUserById).
 *
 * @param {string} id - ID-ul utilizatorului
 * @returns {Promise<Object|null>}
 */
function findUserById(id) {
  const { findUserById: modelFindUserById } = require('../models/userModel');
  return modelFindUserById(id);
}

// ---------------------------------------------------------------------------
// Generare token JWT
// ---------------------------------------------------------------------------

/**
 * Creează un token JWT semnat cu datele utilizatorului.
 *
 * @param {Object}  user         - Obiectul utilizator (minim: _id, email, role, tenantId)
 * @param {string}  [expiresIn]  - Durata de valabilitate (ex: '7d', '24h')
 * @returns {string} Token JWT
 */
function generateToken(user, expiresIn = DEFAULT_EXPIRES_IN) {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('[auth] JWT_SECRET nu este configurat în variabilele de mediu.');
  }

  const payload = {
    sub: user._id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId || null,
  };

  return jwt.sign(payload, secret, { expiresIn });
}

// ---------------------------------------------------------------------------
// Gestionare cookie-uri
// ---------------------------------------------------------------------------

/**
 * Setează cookie-ul cu token-ul JWT pe răspuns.
 *
 * @param {Object} res    - Obiectul response Express
 * @param {string} token  - Token-ul JWT
 */
function setTokenCookie(res, token) {
  const cookieOptions = {
    httpOnly: true,               // Inaccesibil din JavaScript (XSS)
    secure: true,                 // Doar HTTPS
    sameSite: 'strict',           // Protecție CSRF
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 zile în milisecunde
    path: '/',
  };

  res.cookie(TOKEN_COOKIE_NAME, token, cookieOptions);
}

/**
 * Șterge cookie-ul cu token-ul JWT (folosit la logout).
 *
 * @param {Object} res - Obiectul response Express
 */
function clearTokenCookie(res) {
  res.clearCookie(TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
  });
}

// ---------------------------------------------------------------------------
// Funcție internă: extragere token din request
// ---------------------------------------------------------------------------

/**
 * Extrage token-ul JWT din request, în ordinea:
 *  1. Cookie 'token'
 *  2. Header-ul Authorization: Bearer <token>
 *
 * @param {Object} req - Obiectul request Express
 * @returns {string|null} Token-ul sau null dacă nu există
 */
function extractToken(req) {
  // 1. Încercare din cookie
  if (req.cookies && req.cookies[TOKEN_COOKIE_NAME]) {
    return req.cookies[TOKEN_COOKIE_NAME];
  }

  // 2. Încercare din header-ul Authorization
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Middleware: autentificare obligatorie
// ---------------------------------------------------------------------------

/**
 * Middleware care blochează request-urile neautentificate.
 *
 * @param {Object}   req   - Obiectul request Express
 * @param {Object}   res   - Obiectul response Express
 * @param {Function} next  - Următorul middleware
 *
 * @throws {AppError} 401 - dacă token-ul lipsește, e invalid sau expirat
 */
async function authenticate(req, res, next) {
  try {
    // -----------------------------------------------------------------------
    // 1. Extragere token
    // -----------------------------------------------------------------------
    const token = extractToken(req);

    if (!token) {
      return next(new AppError(
        'Autentificare necesară. Token-ul JWT lipsește.',
        401,
        'TOKEN_MISSING'
      ));
    }

    // -----------------------------------------------------------------------
    // 2. Verificare token (decodare + verificare semnătură + expirare)
    // -----------------------------------------------------------------------
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      console.error('[auth] JWT_SECRET nu este configurat.');
      return next(new AppError('Eroare de configurare a serverului.', 500, 'SERVER_CONFIG_ERROR'));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return next(new AppError(
          'Token-ul a expirat. Te rugăm să te autentifici din nou.',
          401,
          'TOKEN_EXPIRED'
        ));
      }
      if (jwtError.name === 'JsonWebTokenError') {
        return next(new AppError(
          'Token-ul JWT este invalid.',
          401,
          'TOKEN_INVALID'
        ));
      }
      throw jwtError; // Eroare neașteptată
    }

    // -----------------------------------------------------------------------
    // 3. Verificare existență utilizator în baza de date
    // -----------------------------------------------------------------------
    const user = await findUserById(decoded.sub);

    if (!user) {
      return next(new AppError(
        'Utilizatorul asociat acestui token nu mai există.',
        401,
        'USER_NOT_FOUND'
      ));
    }

    // -----------------------------------------------------------------------
    // 4. Populare req.user cu datele utilizatorului (fără parolă)
    // -----------------------------------------------------------------------
    req.user = {
      _id: user._id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId || null,
      restaurante: user.restaurante || [],
      createdAt: user.createdAt,
    };

    // Adăugăm token-ul și în req pentru alte middlevare
    req.token = token;

    next();
  } catch (err) {
    console.error('[auth] Eroare neașteptată în middleware-ul authenticate:', err);
    return next(new AppError('Eroare internă de autentificare.', 500, 'AUTH_INTERNAL_ERROR'));
  }
}

// ---------------------------------------------------------------------------
// Middleware: autentificare opțională
// ---------------------------------------------------------------------------

/**
 * Middleware care încearcă să autentifice utilizatorul, dar nu blochează
 * request-ul dacă token-ul lipsește sau este invalid.
 *
 * Utilitate: rute publice unde prezența utilizatorului autentificat
 *            personalizează răspunsul (ex: preîncărcare date pentru
 *            utilizatorul logat).
 *
 * @param {Object}   req   - Obiectul request Express
 * @param {Object}   res   - Obiectul response Express
 * @param {Function} next  - Următorul middleware
 */
async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      req.user = null;
      req.token = null;
      return next();
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      req.user = null;
      req.token = null;
      return next();
    }

    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (jwtError) {
      // Token invalid sau expirat – nu blocăm, setăm user = null
      req.user = null;
      req.token = null;
      return next();
    }

    const user = await findUserById(decoded.sub);
    if (!user) {
      req.user = null;
      req.token = null;
      return next();
    }

    req.user = {
      _id: user._id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId || null,
      restaurante: user.restaurante || [],
      createdAt: user.createdAt,
    };
    req.token = token;

    next();
  } catch (err) {
    // Orice eroare neașteptată – nu blocăm, continuăm fără utilizator
    console.error('[auth] Eroare în optionalAuth:', err);
    req.user = null;
    req.token = null;
    next();
  }
}

// ---------------------------------------------------------------------------
// Token refresh helper
// ---------------------------------------------------------------------------

/**
 * Reîmprospătează token-ul JWT dacă utilizatorul este deja autentificat.
 * Util pentru prelungirea sesiunii înainte de expirare.
 *
 * @param {Object} req - Obiectul request Express (trebuie să aibă req.user populat)
 * @param {Object} res - Obiectul response Express
 * @returns {string|null} Noul token sau null dacă utilizatorul nu e autentificat
 */
function refreshToken(req, res) {
  if (!req.user) {
    return null;
  }

  const newToken = generateToken(req.user);
  setTokenCookie(res, newToken);
  return newToken;
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Aliase principale (documentate)
  auth: authenticate,
  authenticate,
  optionalAuth,
  checkRole: authorize,  // re-export din roles pentru compatibilitate

  // Aliase pentru compatibilitate cu rute care folosesc requireAuth / requireRole
  requireAuth: authenticate,
  requireRole: authorize,

  // Generare și gestionare token
  generateToken,
  setTokenCookie,
  clearTokenCookie,
  refreshToken,
  TOKEN_COOKIE_NAME,
};