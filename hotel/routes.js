const express = require('express');
const router = express.Router();
const path = require('path');
const http = require('http');
const https = require('https');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { authorize } = require('../middleware/roles');
const {
  createHotel,
  getHotelById,
  getHotelsByTenant,
  updateHotel,
  deleteHotel,
  createRoom,
  getRoomById,
  getRoomsByHotel,
  updateRoom,
  deleteRoom
} = require('../models/hotelModel');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/**
 * Directorul view-urilor pentru modulul hotel.
 * @type {string}
 */
const VIEWS_DIR = path.join(__dirname, 'views');

/**
 * Durata maximă (ms) pentru fetch-urile interne de login.
 * @type {number}
 */
const LOGIN_FETCH_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// Helper: randare pagină EJS pentru hotel
// ---------------------------------------------------------------------------

/**
 * Randare pagină EJS din directorul hotel/views/.
 *
 * @param {string} view - numele fișierului fără .ejs
 * @param {Object} extraData - date suplimentare trimise la view
 * @returns {Function} middleware Express
 */
function renderHotelView(view, extraData = {}) {
  return (req, res) => {
    const viewPath = path.join(VIEWS_DIR, view);

    try {
      res.render(viewPath, {
        title: extraData.title || 'Hotel',
        currentPage: extraData.currentPage || '',
        user: req.user || null,
        isAuthenticated: !!req.user,
        error: extraData.error || null,
        flash: extraData.flash || null,
        email: extraData.email || '',
        ...extraData,
      });
    } catch (renderErr) {
      console.error(`[hotel/routes] Eroare la randarea view-ului "${view}":`, renderErr.message);
      if (!res.headersSent) {
        res.status(500).send(
          `Eroare la încărcarea paginii. Vă rugăm încercați din nou. (View: ${view})`
        );
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Helper: construire URL intern pentru fetch
// ---------------------------------------------------------------------------

/**
 * Construiește un URL intern pentru apeluri API.
 *
 * @param {Object} req - obiectul request Express
 * @param {string} apiPath - calea API (ex: /api/auth/login)
 * @returns {string} URL complet
 */
function buildInternalUrl(req, apiPath) {
  const protocol = req.protocol || 'http';
  const host = req.hostname || req.get('host') || 'localhost';
  const port = process.env.PORT || process.env.API_PORT || 3000;
  return `${protocol}://${host}:${port}${apiPath}`;
}

// ---------------------------------------------------------------------------
// Helper: fetch intern cu timeout și parsing JSON robust
// ---------------------------------------------------------------------------

/**
 * Execută un fetch intern folosind modulul nativ Node.js http/https,
 * cu suport pentru timeout și parsing JSON sigur.
 * Permite specificarea metodei, corpului și header-elor.
 *
 * Compatibil cu Node.js < 18 (nu depinde de fetch global).
 *
 * @param {string} url - URL-ul apelului (complet, cu protocol)
 * @param {Object} [options] - Opțiuni suplimentare
 * @param {string} [options.method='GET'] - Metoda HTTP
 * @param {Object} [options.headers={}] - Header-e adiționale
 * @param {string|null} [options.body=null] - Corpul request-ului (pentru POST/PUT)
 * @param {number} [options.timeoutMs=10000] - timeout în milisecunde
 * @returns {Promise<{statusCode: number, data: Object}>} obiectul cu status și date
 */
function internalFetch(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeoutMs = LOGIN_FETCH_TIMEOUT_MS,
  } = options;

  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (parseErr) {
      return reject(new Error(`URL invalid: ${url} - ${parseErr.message}`));
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const defaultHeaders = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: { ...defaultHeaders, ...headers },
      timeout: timeoutMs,
    };

    if (body) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = transport.request(reqOptions, (res) => {
      let rawData = '';

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        rawData += chunk;
      });

      res.on('end', () => {
        let data;
        try {
          data = JSON.parse(rawData);
        } catch (parseErr) {
          data = { raw: rawData };
        }

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout (${timeoutMs}ms) la fetch: ${url}`));
    });

    if (body) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(bodyStr);
    }

    req.end();
  });
}

// ===========================================================================
// RUTE PUBLICE
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /hotel/login – Formular de autentificare pentru modulul Hotel
// ---------------------------------------------------------------------------

/**
 * @route   GET /hotel/login
 * @desc    Servește formularul de login pentru modulul Hotel
 * @access  Public
 */
router.get('/login', optionalAuth, (req, res) => {
  // Dacă utilizatorul este deja autentificat, redirect la dashboard
  if (req.user) {
    return res.redirect('/hotel/dashboard');
  }

  return renderHotelView('login', {
    title: 'Autentificare Hotel – GastroHub',
    currentPage: 'hotel-login',
    error: req.query.error || null,
    flash: req.query.flash ? { type: req.query.flashType || 'info', message: req.query.flash } : null,
    email: req.query.email || '',
  })(req, res);
});

// ---------------------------------------------------------------------------
// POST /hotel/login – Procesare autentificare
// ---------------------------------------------------------------------------

/**
 * @route   POST /hotel/login
 * @desc    Procesează autentificarea delegând la /api/auth/login prin fetch intern.
 *          La succes redirecționează către /hotel/dashboard.
 *          La eroare reafișează formularul cu mesajul de eroare.
 * @access  Public
 */
router.post('/login', optionalAuth, async (req, res) => {
  const { email, password } = req.body;

  // -------------------------------------------------------------------------
  // Validare de bază server-side
  // -------------------------------------------------------------------------
  const errors = [];

  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    errors.push('Adresa de email este obligatorie.');
  }

  if (!password || typeof password !== 'string' || password.length === 0) {
    errors.push('Parola este obligatorie.');
  }

  if (errors.length > 0) {
    return renderHotelView('login', {
      title: 'Autentificare Hotel – GastroHub',
      currentPage: 'hotel-login',
      error: errors.join(' '),
      email: email || '',
    })(req, res);
  }

  // -------------------------------------------------------------------------
  // Construire URL intern pentru /api/auth/login
  // -------------------------------------------------------------------------
  const loginUrl = buildInternalUrl(req, '/api/auth/login');

  // -------------------------------------------------------------------------
  // Pregătire corp request
  // -------------------------------------------------------------------------
  const requestBody = {
    email: email.trim().toLowerCase(),
    password,
  };

  // -------------------------------------------------------------------------
  // Forward cookies de la clientul original (dacă există)
  // pentru ca răspunsul să poată seta cookie-ul de sesiune
  // -------------------------------------------------------------------------
  const forwardHeaders = {};

  // Forward cookie-ul original pentru a menține orice sesiune existentă
  if (req.headers.cookie) {
    forwardHeaders['Cookie'] = req.headers.cookie;
  }

  // Forward X-Forwarded-For și User-Agent pentru logging
  if (req.headers['x-forwarded-for']) {
    forwardHeaders['X-Forwarded-For'] = req.headers['x-forwarded-for'];
  }
  if (req.headers['user-agent']) {
    forwardHeaders['User-Agent'] = req.headers['user-agent'];
  }

  // -------------------------------------------------------------------------
  // Execuție fetch intern
  // -------------------------------------------------------------------------
  try {
    const result = await internalFetch(loginUrl, {
      method: 'POST',
      headers: forwardHeaders,
      body: requestBody,
      timeoutMs: LOGIN_FETCH_TIMEOUT_MS,
    });

    const { statusCode, headers: responseHeaders, data } = result;

    // -----------------------------------------------------------------------
    // Autentificare reușită (2xx)
    // -----------------------------------------------------------------------
    if (statusCode >= 200 && statusCode < 300 && data.success) {
      // Forward set-cookie de la răspunsul API către client
      if (responseHeaders && responseHeaders['set-cookie']) {
        const setCookieHeaders = Array.isArray(responseHeaders['set-cookie'])
          ? responseHeaders['set-cookie']
          : [responseHeaders['set-cookie']];

        setCookieHeaders.forEach((cookie) => {
          res.setHeader('Set-Cookie', cookie);
        });
      }

      // Redirect la dashboard-ul hotelului
      return res.redirect('/hotel/dashboard');
    }

    // -----------------------------------------------------------------------
    // Eroare de autentificare (401, 404 etc.)
    // -----------------------------------------------------------------------
    let errorMessage = 'Email sau parolă incorectă.';

    if (data && data.error) {
      if (typeof data.error === 'string') {
        errorMessage = data.error;
      } else if (data.error.message) {
        errorMessage = data.error.message;
      }
    } else if (data && data.message) {
      errorMessage = data.message;
    }

    // Dacă API-ul returnează erori de validare
    if (data && data.errors && Array.isArray(data.errors)) {
      errorMessage = data.errors.map((e) => (e.msg || e)).join('; ');
    }

    return renderHotelView('login', {
      title: 'Autentificare Hotel – GastroHub',
      currentPage: 'hotel-login',
      error: errorMessage,
      email: email || '',
    })(req, res);

  } catch (fetchErr) {
    // -----------------------------------------------------------------------
    // Eroare de rețea / server indisponibil
    // -----------------------------------------------------------------------
    console.error('[hotel/routes] Eroare fetch intern login:', fetchErr.message);

    return renderHotelView('login', {
      title: 'Autentificare Hotel – GastroHub',
      currentPage: 'hotel-login',
      error: 'Eroare de rețea sau server indisponibil. Verifică conexiunea și încearcă din nou.',
      email: email || '',
    })(req, res);
  }
});

// === Hoteluri ===
router.get('/', authenticate, async (req, res) => {
  try {
    const hotels = await getHotelsByTenant(req.user.tenantId);
    res.json({ success: true, data: hotels });
  } catch (err) {
    res.status(500).json({ success: false, error: { message: err.message, code: 'SERVER_ERROR' } });
  }
});

router.post('/', authenticate, authorize('super_admin', 'owner'), async (req, res) => {
  try {
    const hotel = await createHotel({ ...req.body, tenant_id: req.user.tenantId });
    res.status(201).json({ success: true, data: hotel });
  } catch (err) {
    res.status(400).json({ success: false, error: { message: err.message, code: 'VALIDATION_ERROR' } });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const hotel = await getHotelById(req.params.id);
    if (!hotel) return res.status(404).json({ success: false, error: { message: 'Hotel negăsit', code: 'NOT_FOUND' } });
    res.json({ success: true, data: hotel });
  } catch (err) {
    res.status(500).json({ success: false, error: { message: err.message, code: 'SERVER_ERROR' } });
  }
});

router.put('/:id', authenticate, authorize('super_admin', 'owner'), async (req, res) => {
  try {
    const updated = await updateHotel(req.params.id, req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: { message: err.message, code: 'VALIDATION_ERROR' } });
  }
});

router.delete('/:id', authenticate, authorize('super_admin'), async (req, res) => {
  try {
    await deleteHotel(req.params.id);
    res.json({ success: true, message: 'Hotel șters', data: null });
  } catch (err) {
    res.status(500).json({ success: false, error: { message: err.message, code: 'SERVER_ERROR' } });
  }
});

// === Camere ===
router.get('/:hotelId/rooms', authenticate, async (req, res) => {
  try {
    const rooms = await getRoomsByHotel(req.params.hotelId);
    res.json({ success: true, data: rooms });
  } catch (err) {
    res.status(500).json({ success: false, error: { message: err.message, code: 'SERVER_ERROR' } });
  }
});

router.post('/:hotelId/rooms', authenticate, authorize('super_admin', 'owner'), async (req, res) => {
  try {
    const room = await createRoom({ ...req.body, hotel_id: req.params.hotelId, tenant_id: req.user.tenantId });
    res.status(201).json({ success: true, data: room });
  } catch (err) {
    res.status(400).json({ success: false, error: { message: err.message, code: 'VALIDATION_ERROR' } });
  }
});

router.get('/rooms/:id', authenticate, async (req, res) => {
  try {
    const room = await getRoomById(req.params.id);
    if (!room) return res.status(404).json({ success: false, error: { message: 'Cameră negăsită', code: 'NOT_FOUND' } });
    res.json({ success: true, data: room });
  } catch (err) {
    res.status(500).json({ success: false, error: { message: err.message, code: 'SERVER_ERROR' } });
  }
});

router.put('/rooms/:id', authenticate, authorize('super_admin', 'owner'), async (req, res) => {
  try {
    const updated = await updateRoom(req.params.id, req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: { message: err.message, code: 'VALIDATION_ERROR' } });
  }
});

router.delete('/rooms/:id', authenticate, authorize('super_admin'), async (req, res) => {
  try {
    await deleteRoom(req.params.id);
    res.json({ success: true, message: 'Cameră ștearsă', data: null });
  } catch (err) {
    res.status(500).json({ success: false, error: { message: err.message, code: 'SERVER_ERROR' } });
  }
});

module.exports = router;