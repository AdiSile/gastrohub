/**
 * ============================================================
 * customer/routes.js - Rute pentru portal client
 * ============================================================
 *
 * Acest fișier expune paginile EJS pentru portalul client:
 * autentificare, dashboard, rezervări, comenzi, loialitate.
 *
 * Folosește:
 *  - express.Router pentru rute de vizualizare
 *  - middleware/auth.js pentru autentificare și optionalAuth
 *  - middleware/roles.js pentru autorizare client
 *
 * NOTĂ: Toate rutele din acest fișier sunt montate sub prefixul /customer
 * în server.js, cu excepția rutelor de redirecționare API.
 *
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const http = require('http');
const https = require('https');

const { authenticate, optionalAuth, generateToken, setTokenCookie } = require('../middleware/auth');
const { authorizeMinLevel } = require('../middleware/roles');
const { findUserByEmail, comparePassword, createUser } = require('../models/userModel');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/**
 * Durata maximă (ms) pentru fetch-urile interne de pe dashboard.
 * @type {number}
 */
const DASHBOARD_FETCH_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Helper: randare pagină EJS
// ---------------------------------------------------------------------------

/**
 * Randare pagină EJS din directorul customer/views/.
 *
 * @param {string} view - numele fișierului fără .ejs
 * @param {Object} extraData - date suplimentare trimise la view
 * @returns {Function} middleware Express
 */
function renderView(view, extraData = {}) {
  return (req, res) => {
    try {
      res.render(view, {
        title: extraData.title || 'Portal Client',
        currentPage: extraData.currentPage || '',
        user: req.user || null,
        isAuthenticated: !!req.user,
        customer: req.user || null,
        ...extraData,
      });
    } catch (renderErr) {
      console.error(`[customer/routes] Eroare la randarea view-ului "${view}":`, renderErr.message);
      // Fallback: dacă fișierul EJS lipsește, trimite un răspuns text simplu
      if (!res.headersSent) {
        res.status(500).send(`Eroare la încărcarea paginii. Vă rugăm încercați din nou. (View: ${view})`);
      }
    }
  };
}

/**
 * Randare pagină EJS cu layout și date suplimentare.
 *
 * @param {string} view - numele fișierului fără .ejs
 * @param {Object} extraData - date suplimentare trimise la view
 * @returns {Function} middleware Express
 */
function renderWithLayout(view, extraData = {}) {
  return (req, res) => {
    try {
      res.render(view, {
        title: extraData.title || 'Portal Client',
        currentPage: extraData.currentPage || '',
        user: req.user || null,
        isAuthenticated: !!req.user,
        customer: req.user || null,
        pendingOrdersCount: extraData.pendingOrdersCount || 0,
        pageIcon: extraData.pageIcon || 'home',
        headerButtons: extraData.headerButtons || [],
        head: extraData.head || '',
        ...extraData,
      });
    } catch (renderErr) {
      console.error(`[customer/routes] Eroare la randarea view-ului "${view}":`, renderErr.message);
      if (!res.headersSent) {
        res.status(500).send(`Eroare la încărcarea paginii. Vă rugăm încercați din nou. (View: ${view})`);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Helper: construire URL intern pentru fetch
// ---------------------------------------------------------------------------

/**
 * Construiește un URL intern pentru apeluri API, folosind variabilele
 * de mediu ca fallback pentru req.hostname și req.protocol.
 *
 * @param {Object} req - obiectul request Express
 * @param {string} apiPath - calea API (ex: /api/orders/customer/...)
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
 * Returnează null la orice eroare.
 *
 * Compatibil cu Node.js < 18 (nu depinde de fetch global).
 *
 * @param {string} url - URL-ul apelului (complet, cu protocol)
 * @param {number} [timeoutMs=5000] - timeout în milisecunde
 * @returns {Promise<Object|null>} obiectul JSON parsat sau null
 */
async function safeInternalFetch(url, timeoutMs = DASHBOARD_FETCH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (parseErr) {
      console.warn(`[customer/routes] URL invalid: ${url}`, parseErr.message);
      return resolve(null);
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      timeout: timeoutMs,
      rejectUnauthorized: false,
    };

    const reqInternal = transport.request(options, (resInternal) => {
      let data = '';
      resInternal.on('data', (chunk) => {
        data += chunk;
      });
      resInternal.on('end', () => {
        if (resInternal.statusCode >= 200 && resInternal.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (parseErr) {
            console.warn(`[customer/routes] JSON parse error for ${url}:`, parseErr.message);
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });

    reqInternal.on('error', (err) => {
      console.warn(`[customer/routes] Fetch error for ${url}:`, err.message);
      resolve(null);
    });

    reqInternal.on('timeout', () => {
      reqInternal.destroy();
      console.warn(`[customer/routes] Fetch timeout for ${url}`);
      resolve(null);
    });

    reqInternal.end();
  });
}

// ===========================================================================
// RUTE PUBLICE (fără autentificare)
// ===========================================================================

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * @route   GET /customer/login
 * @desc    Pagina de autentificare
 * @access  Public
 */
router.get('/login', optionalAuth, (req, res) => {
  res.render('login', {
    title: 'Autentificare',
    currentPage: 'customer-login',
    user: req.user || null,
    isAuthenticated: !!req.user,
    customer: req.user || null,
    email: '',
    error: null,
  });
});

/**
 * @route   POST /customer/login
 * @desc    Procesează autentificarea
 * @access  Public
 */
router.post('/login', optionalAuth, async (req, res) => {
  // -------------------------------------------------------------------
  // 1. Extragere email și parolă din body
  //    Suportă atât form-urlencoded (req.body direct) cât și JSON
  // -------------------------------------------------------------------
  const email = (req.body && req.body.email) ? req.body.email.trim() : '';
  const password = (req.body && req.body.password) ? req.body.password : '';

  // -------------------------------------------------------------------
  // 2. Validare prezență câmpuri
  // -------------------------------------------------------------------
  const errors = [];

  if (!email) {
    errors.push('Adresa de email este obligatorie.');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Adresa de email nu este validă.');
  }

  if (!password) {
    errors.push('Parola este obligatorie.');
  } else if (password.length < 6) {
    errors.push('Parola trebuie să aibă minimum 6 caractere.');
  }

  if (errors.length > 0) {
    return res.render('login', {
      title: 'Autentificare',
      currentPage: 'customer-login',
      user: req.user || null,
      isAuthenticated: !!req.user,
      customer: req.user || null,
      email,
      error: errors.join(' '),
    });
  }

  // -------------------------------------------------------------------
  // 3. Delegare la logica de autentificare (bcrypt + JWT + cookie)
  //    Aceeași logică folosită de POST /api/auth/login
  // -------------------------------------------------------------------
  try {
    // 3a. Căutare utilizator după email
    const user = await findUserByEmail(email);
    if (!user) {
      return res.render('login', {
        title: 'Autentificare',
        currentPage: 'customer-login',
        user: null,
        isAuthenticated: false,
        customer: null,
        email,
        error: 'Email sau parolă incorectă.',
      });
    }

    // 3b. Verificare parolă
    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      return res.render('login', {
        title: 'Autentificare',
        currentPage: 'customer-login',
        user: null,
        isAuthenticated: false,
        customer: null,
        email,
        error: 'Email sau parolă incorectă.',
      });
    }

    // 3c. Generare token JWT
    const token = generateToken(user);

    // 3d. Setare cookie JWT
    setTokenCookie(res, token);

    // 4. Redirect către dashboard
    return res.redirect('/customer/dashboard');
  } catch (err) {
    console.error('[customer/routes] Eroare la autentificare:', err);
    let errorMessage = 'Eroare internă la autentificare. Vă rugăm încercați din nou.';
    return res.render('login', {
      title: 'Autentificare',
      currentPage: 'customer-login',
      user: req.user || null,
      isAuthenticated: !!req.user,
      customer: req.user || null,
      email,
      error: errorMessage,
    });
  }
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/**
 * @route   GET /customer/logout
 * @desc    Deautentificare (șterge cookie-ul JWT)
 * @access  Public
 */
router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/customer/login');
});

// ---------------------------------------------------------------------------
// Înregistrare
// ---------------------------------------------------------------------------

/**
 * @route   GET /customer/register
 * @desc    Pagina de înregistrare
 * @access  Public
 */
router.get('/register', optionalAuth, (req, res) => {
  res.render('register', {
    title: 'Înregistrare',
    currentPage: 'customer-register',
    user: req.user || null,
    isAuthenticated: !!req.user,
    customer: req.user || null,
    email: '',
    name: '',
    phone: '',
    error: null,
  });
});

/**
 * @route   POST /customer/register
 * @desc    Procesează înregistrarea unui client nou
 * @access  Public
 */
router.post('/register', optionalAuth, async (req, res) => {
  // Extragere câmpuri
  const email = (req.body && req.body.email) ? req.body.email.trim() : '';
  const password = (req.body && req.body.password) ? req.body.password : '';
  const name = (req.body && req.body.name) ? req.body.name.trim() : '';
  const phone = (req.body && req.body.phone) ? req.body.phone.trim() : '';

  // Validare
  const errors = [];

  if (!name) {
    errors.push('Numele este obligatoriu.');
  } else if (name.length < 2) {
    errors.push('Numele trebuie să aibă minimum 2 caractere.');
  }

  if (!email) {
    errors.push('Adresa de email este obligatorie.');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Adresa de email nu este validă.');
  }

  if (!password) {
    errors.push('Parola este obligatorie.');
  } else if (password.length < 6) {
    errors.push('Parola trebuie să aibă minimum 6 caractere.');
  }

  if (errors.length > 0) {
    return res.render('register', {
      title: 'Înregistrare',
      currentPage: 'customer-register',
      user: req.user || null,
      isAuthenticated: !!req.user,
      customer: req.user || null,
      email,
      name,
      phone,
      error: errors.join(' '),
    });
  }

  try {
    const user = await createUser({
      email,
      password,
      name,
      phone,
    });

    // Autentificare automată după înregistrare
    const token = generateToken(user);
    setTokenCookie(res, token);

    return res.redirect('/customer/dashboard');
  } catch (err) {
    console.error('[customer/routes] Eroare la înregistrare:', err);
    let errorMessage = 'Eroare internă la înregistrare. Vă rugăm încercați din nou.';
    if (err.statusCode === 409) {
      errorMessage = 'Există deja un cont cu această adresă de email.';
    } else if (err.statusCode === 400) {
      errorMessage = err.message;
    }

    return res.render('register', {
      title: 'Înregistrare',
      currentPage: 'customer-register',
      user: req.user || null,
      isAuthenticated: !!req.user,
      customer: req.user || null,
      email,
      name,
      phone,
      error: errorMessage,
    });
  }
});

// ===========================================================================
// RUTE PROTEJATE (autentificare obligatorie)
// ===========================================================================

// ---------------------------------------------------------------------------
// Dashboard client
// ---------------------------------------------------------------------------

/**
 * @route   GET /customer/dashboard
 * @desc    Dashboard principal pentru client - ultimele comenzi, puncte loialitate, rezervări active
 * @access  Privat (orice utilizator autentificat)
 *
 * NOTĂ: Dashboard-ul folosește safeInternalFetch pentru a prelua date de la API-urile
 * interne. Toate fetch-urile sunt izolate: eșecul unuia nu le afectează pe celelalte.
 * Dacă TOATE fetch-urile eșuează, dashboard-ul se randează cu array-uri goale
 * și un indicator de eroare pentru interfață. Timpul maxim de așteptare per fetch
 * este de 5 secunde, după care se abandonează.
 */
router.get('/dashboard', authenticate, async (req, res) => {
  // -------------------------------------------------------------------------
  // Bază date dashboard - comune atât pentru success cât și fallback
  // -------------------------------------------------------------------------
  const baseData = {
    user: req.user,
    isAuthenticated: true,
    customer: req.user,
    currentPage: 'customer-dashboard',
  };

  // -------------------------------------------------------------------------
  // Fetch-uri paralele izolate (Promise.allSettled)
  // -------------------------------------------------------------------------
  const apiBase = buildInternalUrl(req, '');

  const [ordersResult, reservationsResult, loyaltyResult] = await Promise.allSettled([
    safeInternalFetch(`${apiBase}/api/orders/customer/${req.user.id}?limit=5`),
    safeInternalFetch(`${apiBase}/api/reservations/customer/${req.user.id}?limit=5`),
    safeInternalFetch(`${apiBase}/api/loyalty/${req.user.id}`),
  ]);

  const recentOrders = (ordersResult.status === 'fulfilled' && ordersResult.value) ? ordersResult.value : [];
  const upcomingReservations = (reservationsResult.status === 'fulfilled' && reservationsResult.value) ? reservationsResult.value : [];
  const loyaltyData = (loyaltyResult.status === 'fulfilled' && loyaltyResult.value) ? loyaltyResult.value : null;

  const allFailed =
    ordersResult.status === 'rejected' &&
    reservationsResult.status === 'rejected' &&
    loyaltyResult.status === 'rejected';

  if (allFailed) {
    console.warn('[customer/routes] Toate fetch-urile dashboard au eșuat.');
  }

  res.render('dashboard', {
    ...baseData,
    recentOrders: Array.isArray(recentOrders) ? recentOrders : (recentOrders && recentOrders.orders ? recentOrders.orders : []),
    upcomingReservations: Array.isArray(upcomingReservations) ? upcomingReservations : (upcomingReservations && upcomingReservations.reservations ? upcomingReservations.reservations : []),
    loyaltyPoints: loyaltyData ? (loyaltyData.points || 0) : 0,
    loyaltyTier: loyaltyData ? (loyaltyData.tier || 'Standard') : 'Standard',
    allFetchFailed: allFailed,
  });
});

// ---------------------------------------------------------------------------
// Rezervări client
// ---------------------------------------------------------------------------

/**
 * @route   GET /customer/reservations
 * @desc    Lista rezervărilor clientului
 * @access  Privat (orice utilizator autentificat)
 */
router.get('/reservations', authenticate, renderWithLayout('reservations', {
  title: 'Rezervările mele',
  currentPage: 'customer-reservations',
  pageIcon: 'calendar-alt',
}));

/**
 * @route   GET /customer/reservations/new
 * @desc    Pagină rezervare nouă
 * @access  Privat (orice utilizator autentificat)
 */
router.get('/reservations/new', authenticate, renderWithLayout('reservations-new', {
  title: 'Rezervare nouă',
  currentPage: 'customer-reservations',
  pageIcon: 'plus-circle',
}));

/**
 * @route   GET /customer/reservations/:id
 * @desc    Detalii rezervare
 * @access  Privat (orice utilizator autentificat)
 */
router.get('/reservations/:id', authenticate, (req, res) => {
  res.render('reservations-detail', {
    user: req.user,
    isAuthenticated: true,
    customer: req.user,
    reservationId: req.params.id,
    currentPage: 'customer-reservations',
  });
});

// ---------------------------------------------------------------------------
// Comenzi client
// ---------------------------------------------------------------------------

/**
 * @route   GET /customer/orders
 * @desc    Lista comenzilor clientului
 * @access  Privat (orice utilizator autentificat)
 */
router.get('/orders', authenticate, renderWithLayout('orders', {
  title: 'Comenzile mele',
  currentPage: 'customer-orders',
  pageIcon: 'receipt',
}));

/**
 * @route   GET /customer/orders/new
 * @desc    Pagină comandă nouă
 * @access  Privat (orice utilizator autentificat)
 */
router.get('/orders/new', authenticate, renderWithLayout('orders-new', {
  title: 'Comandă nouă',
  currentPage: 'customer-orders',
  pageIcon: 'plus-circle',
}));

/**
 * @route   GET /customer/orders/:id
 * @desc    Detalii comandă
 * @access  Privat (orice utilizator autentificat)
 */
router.get('/orders/:id', authenticate, (req, res) => {
  res.render('orders-detail', {
    user: req.user,
    isAuthenticated: true,
    customer: req.user,
    orderId: req.params.id,
    currentPage: 'customer-orders',
  });
});

// ---------------------------------------------------------------------------
// Loialitate client
// ---------------------------------------------------------------------------

/**
 * @route   GET /customer/loyalty
 * @desc    Pagina de loialitate (puncte, cupoane)
 * @access  Privat (orice utilizator autentificat)
 */
router.get('/loyalty', authenticate, renderWithLayout('loyalty', {
  title: 'Loialitate',
  currentPage: 'customer-loyalty',
  pageIcon: 'star',
}));

/**
 * @route   GET /customer/loyalty/coupons
 * @desc    Lista cupoanelor clientului
 * @access  Privat (orice utilizator autentificat)
 */
router.get('/loyalty/coupons', authenticate, renderWithLayout('loyalty-coupons', {
  title: 'Cupoanele mele',
  currentPage: 'customer-loyalty',
  pageIcon: 'ticket-alt',
}));

// ---------------------------------------------------------------------------
// Favorite client
// ---------------------------------------------------------------------------

/**
 * @route   GET /customer/favorites
 * @desc    Pagina de favorite
 * @access  Privat (orice utilizator autentificat)
 */
router.get('/favorites', authenticate, renderWithLayout('favorites', {
  title: 'Favorite',
  currentPage: 'customer-favorites',
  pageIcon: 'heart',
}));

// ---------------------------------------------------------------------------
// Restaurante client
// ---------------------------------------------------------------------------

/**
 * @route   GET /customer/restaurants
 * @desc    Lista restaurantelor
 * @access  Privat (orice utilizator autentificat)
 */
router.get('/restaurants', authenticate, renderWithLayout('restaurants', {
  title: 'Restaurante',
  currentPage: 'customer-restaurants',
  pageIcon: 'store',
}));

// ---------------------------------------------------------------------------
// Profil client
// ---------------------------------------------------------------------------

/**
 * @route   GET /customer/profile
 * @desc    Pagina de profil a clientului
 * @access  Privat (orice utilizator autentificat)
 */
router.get('/profile', authenticate, renderWithLayout('profile', {
  title: 'Profilul meu',
  currentPage: 'customer-profile',
  pageIcon: 'user',
}));

// ---------------------------------------------------------------------------
// Adrese client
// ---------------------------------------------------------------------------

/**
 * @route   GET /customer/addresses
 * @desc    Pagina de adrese
 * @access  Privat (orice utilizator autentificat)
 */
router.get('/addresses', authenticate, renderWithLayout('addresses', {
  title: 'Adresele mele',
  currentPage: 'customer-addresses',
  pageIcon: 'map-marker-alt',
}));

// ---------------------------------------------------------------------------
// Setări client
// ---------------------------------------------------------------------------

/**
 * @route   GET /customer/settings
 * @desc    Pagina de setări
 * @access  Privat (orice utilizator autentificat)
 */
router.get('/settings', authenticate, renderWithLayout('settings', {
  title: 'Setări',
  currentPage: 'customer-settings',
  pageIcon: 'cog',
}));

// ===========================================================================
// Fallback – redirect către dashboard pentru rute necunoscute
// ===========================================================================
router.get('*', authenticate, (req, res) => {
  res.redirect('/customer/dashboard');
});

// ===========================================================================
// Export router
// ===========================================================================

module.exports = router;