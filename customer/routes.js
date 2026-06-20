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
        Accept: 'application/json',
      },
      timeout: timeoutMs,
    };

    const req = transport.request(options, (res) => {
      let rawData = '';

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        rawData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.warn(
            `[customer/routes] Fetch intern eșuat (HTTP ${res.statusCode}): ${url}`
          );
          return resolve(null);
        }

        let data;
        try {
          data = JSON.parse(rawData);
        } catch (parseErr) {
          console.warn(
            `[customer/routes] Răspuns invalid JSON de la: ${url}`,
            parseErr.message
          );
          return resolve(null);
        }

        resolve(data);
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        console.warn(`[customer/routes] Timeout (${timeoutMs}ms) la fetch: ${url}`);
      } else {
        console.warn(`[customer/routes] Eroare rețea la fetch: ${url}`, err.message);
      }
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      console.warn(`[customer/routes] Timeout (${timeoutMs}ms) la fetch: ${url}`);
      resolve(null);
    });

    req.end();
  });
}

// ===========================================================================
// RUTE PUBLICE
// ===========================================================================

// ---------------------------------------------------------------------------
// Pagina principală / login
// ---------------------------------------------------------------------------

/**
 * @route   GET /customer/
 * @desc    Pagina principală – redirect la login sau dashboard
 * @access  Public
 */
router.get('/', optionalAuth, (req, res) => {
  if (req.user) {
    return res.redirect('/customer/dashboard');
  }
  res.redirect('/customer/login');
});

/**
 * @route   GET /customer/login
 * @desc    Pagina de autentificare
 * @access  Public
 */
router.get('/login', optionalAuth, renderView('login', { title: 'Autentificare', currentPage: 'customer-login' }));

/**
 * @route   POST /customer/login
 * @desc    Procesează autentificarea server-side (bcrypt + JWT + cookie)
 * @access  Public
 *
 * Body (application/x-www-form-urlencoded sau JSON):
 *   - email      {string}  obligatoriu
 *   - password   {string}  obligatoriu
 *
 * Răspuns:
 *   - Succes:  redirect 302 → /customer/dashboard (cu cookie JWT setat)
 *   - Eroare:  re-randare pagină login cu mesaj de eroare
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

    // 3b. Verificare parolă (bcrypt)
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

    // 3c. Pregătire date utilizator fără parolă
    const safeUser = { ...user };
    delete safeUser.password;

    // 3d. Generare token JWT
    const token = generateToken(safeUser);

    // 3e. Setare cookie JWT (httpOnly, secure, sameSite strict)
    setTokenCookie(res, token);

    // 3f. Redirect către dashboard
    return res.redirect('/customer/dashboard');
  } catch (err) {
    console.error('[customer/routes] Eroare la autentificare (POST /customer/login):', err.message);

    return res.render('login', {
      title: 'Autentificare',
      currentPage: 'customer-login',
      user: null,
      isAuthenticated: false,
      customer: null,
      email,
      error: 'Eroare internă la autentificare. Vă rugăm încercați din nou.',
    });
  }
});

/**
 * @route   GET /customer/register
 * @desc    Pagina de înregistrare
 * @access  Public
 */
router.get('/register', optionalAuth, renderView('register', { title: 'Înregistrare', currentPage: 'customer-register' }));

/**
 * @route   POST /customer/register
 * @desc    Procesează înregistrarea server-side (validare, creare user, token, redirect dashboard)
 * @access  Public
 *
 * Body (application/x-www-form-urlencoded sau JSON):
 *   - email             {string}  obligatoriu
 *   - password          {string}  obligatoriu (minim 6 caractere)
 *   - confirmPassword   {string}  obligatoriu (trebuie să coincidă cu password)
 *   - name              {string}  opțional
 *   - phone             {string}  opțional
 *
 * Răspuns:
 *   - Succes:  redirect 302 → /customer/dashboard (cu cookie JWT setat)
 *   - Eroare:  re-randare pagină register cu mesaj de eroare
 */
router.post('/register', optionalAuth, async (req, res) => {
  // -------------------------------------------------------------------
  // 1. Extragere câmpuri din body
  //    Suportă atât form-urlencoded (req.body direct) cât și JSON
  // -------------------------------------------------------------------
  const email = (req.body && req.body.email) ? req.body.email.trim() : '';
  const password = (req.body && req.body.password) ? req.body.password : '';
  const confirmPassword = (req.body && req.body.confirmPassword) ? req.body.confirmPassword : '';
  const name = (req.body && req.body.name) ? req.body.name.trim() : '';
  const phone = (req.body && req.body.phone) ? req.body.phone.trim() : '';

  // -------------------------------------------------------------------
  // 2. Validare câmpuri
  // -------------------------------------------------------------------
  const errors = [];

  // Validare email
  if (!email) {
    errors.push('Adresa de email este obligatorie.');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Adresa de email nu este validă.');
  }

  // Validare parolă
  if (!password) {
    errors.push('Parola este obligatorie.');
  } else if (password.length < 6) {
    errors.push('Parola trebuie să aibă minimum 6 caractere.');
  } else if (password.length > 128) {
    errors.push('Parola trebuie să aibă maximum 128 de caractere.');
  }

  // Validare confirmare parolă
  if (!confirmPassword) {
    errors.push('Confirmarea parolei este obligatorie.');
  } else if (password && confirmPassword && password !== confirmPassword) {
    errors.push('Parolele nu coincid.');
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

  // -------------------------------------------------------------------
  // 3. Creare utilizator prin userModel.createUser
  // -------------------------------------------------------------------
  try {
    const userData = {
      email: email,
      password: password,
      role: 'client',
    };

    // Adăugăm câmpuri opționale doar dacă sunt completate
    if (name) {
      userData.name = name;
    }
    if (phone) {
      userData.phone = phone;
    }

    const newUser = await createUser(userData);

    // 4. Generare token JWT
    const safeUser = { ...newUser };
    delete safeUser.password;
    const token = generateToken(safeUser);

    // 5. Setare cookie JWT (httpOnly, secure, sameSite strict)
    setTokenCookie(res, token);

    // 6. Redirect către dashboard
    return res.redirect('/customer/dashboard');
  } catch (err) {
    console.error('[customer/routes] Eroare la înregistrare (POST /customer/register):', err.message);

    // Dacă e AppError cu cod de eroare, folosim mesajul său
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
 * @desc    Dashboard principal pentru client – ultimele comenzi, puncte loialitate, rezervări active
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
  // Bază date dashboard – comune atât pentru success cât și fallback
  // -------------------------------------------------------------------------
  const baseDashboardData = {
    title: 'Dashboard',
    currentPage: 'customer-dashboard',
    user: req.user,
    isAuthenticated: true,
    customer: req.user,
    pageIcon: 'th-large',
    headerButtons: [
      { href: '/customer/orders/new', label: 'Comandă nouă', icon: 'plus' },
      { href: '/customer/reservations/new', label: 'Rezervare nouă', icon: 'calendar-plus' },
    ],
    // Valori implicite – pot fi suprascrise de fetch-uri reușite
    recentOrders: [],
    activeReservations: [],
    loyaltyPoints: 0,
    pendingOrdersCount: 0,
    // Indicator pentru UI: arată un banner dacă datele sunt incomplete
    fetchErrors: [],
  };

  // -------------------------------------------------------------------------
  // Validare date utilizator – fără tenantId/userId, sărim fetch-urile
  // -------------------------------------------------------------------------
  const tenantId = req.user && req.user.tenantId;
  const customerId = req.user && req.user._id;

  if (!tenantId || !customerId) {
    console.warn('[customer/routes] Dashboard: lipsă tenantId sau customerId pe req.user');
    baseDashboardData.fetchErrors.push('Identitate utilizator incompletă. Unele date pot fi indisponibile.');

    try {
      return res.render('dashboard', baseDashboardData);
    } catch (renderErr) {
      console.error('[customer/routes] Eroare randare dashboard (fallback identitate):', renderErr.message);
      if (!res.headersSent) {
        return res.status(500).send('Eroare la încărcarea dashboard-ului. Vă rugăm încercați din nou.');
      }
    }
    return;
  }

  // -------------------------------------------------------------------------
  // Fetch-uri paralele izolate cu Promise.allSettled
  // Fiecare fetch are propriul timeout (5s) și parsing JSON sigur.
  // -------------------------------------------------------------------------
  const ordersUrl = buildInternalUrl(req, `/api/orders/customer/${customerId}?tenantId=${tenantId}&limit=5`);
  const reservationsUrl = buildInternalUrl(req, `/api/reservations/customer/${customerId}?tenantId=${tenantId}&status=confirmată,check-in&limit=5`);
  const loyaltyUrl = buildInternalUrl(req, `/api/loyalty/account/${customerId}?tenantId=${tenantId}`);

  const results = await Promise.allSettled([
    safeInternalFetch(ordersUrl),
    safeInternalFetch(reservationsUrl),
    safeInternalFetch(loyaltyUrl),
  ]);

  // -------------------------------------------------------------------------
  // Procesare rezultate – fiecare settled promise este tratat independent
  // -------------------------------------------------------------------------
  const [ordersResult, reservationsResult, loyaltyResult] = results;

  // Comenzi recente
  if (ordersResult.status === 'fulfilled' && ordersResult.value) {
    const ordersData = ordersResult.value;
    if (ordersData.success) {
      baseDashboardData.recentOrders = ordersData.data.orders || [];
      baseDashboardData.pendingOrdersCount = baseDashboardData.recentOrders.filter(
        o => o.status === 'deschisă' || o.status === 'în preparare'
      ).length;
    }
  } else {
    baseDashboardData.fetchErrors.push('Comenzi recente indisponibile momentan.');
  }

  // Rezervări active
  if (reservationsResult.status === 'fulfilled' && reservationsResult.value) {
    const reservationsData = reservationsResult.value;
    if (reservationsData.success) {
      baseDashboardData.activeReservations = reservationsData.data.reservations || [];
    }
  } else {
    baseDashboardData.fetchErrors.push('Rezervări active indisponibile momentan.');
  }

  // Cont loialitate
  if (loyaltyResult.status === 'fulfilled' && loyaltyResult.value) {
    const loyaltyData = loyaltyResult.value;
    if (loyaltyData.success) {
      const loyaltyAccount = loyaltyData.data.account || null;
      baseDashboardData.loyaltyPoints = loyaltyAccount ? loyaltyAccount.totalPoints || 0 : 0;
    }
  } else {
    baseDashboardData.fetchErrors.push('Puncte loialitate indisponibile momentan.');
  }

  // -------------------------------------------------------------------------
  // Randare dashboard – cu date disponibile și eventuale erori
  // -------------------------------------------------------------------------
  try {
    res.render('dashboard', baseDashboardData);
  } catch (renderErr) {
    console.error('[customer/routes] Eroare critică la randarea dashboard:', renderErr.message);
    if (!res.headersSent) {
      res.status(500).send('Eroare la încărcarea dashboard-ului. Vă rugăm încercați din nou.');
    }
  }
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
  pageIcon: 'calendar-check',
}));

/**
 * @route   GET /customer/reservations/new
 * @desc    Formular creare rezervare nouă
 * @access  Privat (orice utilizator autentificat)
 */
router.get('/reservations/new', authenticate, renderWithLayout('reservation-new', {
  title: 'Rezervare nouă',
  currentPage: 'customer-reservations',
  pageIcon: 'calendar-plus',
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