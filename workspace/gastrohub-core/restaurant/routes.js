/**
 * ============================================================
 * restaurant/routes.js - Rute pentru modulul Restaurant
 * ============================================================
 *
 * Responsabilități:
 *  1. GET    /restaurant/dashboard   – Dashboard principal restaurant
 *  2. GET    /restaurant/orders      – Lista și gestionare comenzi
 *  3. GET    /restaurant/orders/new  – Formular comandă nouă
 *  4. GET    /restaurant/orders/:id  – Detalii comandă
 *  5. GET    /restaurant/menu        – Gestionare meniu
 *  6. GET    /restaurant/inventory   – Gestionare inventar
 *  7. GET    /restaurant/deliveries  – Gestionare livrări
 *  8. GET    /restaurant/suppliers   – Gestionare furnizori
 *  9. GET    /restaurant/settings    – Setări restaurant
 * 10. GET    /restaurant/*           – Fallback – redirect dashboard
 *
 * NOTĂ: Toate rutele din acest fișier sunt montate sub prefixul /restaurant
 * în server.js.
 *
 * API-urile de restaurant sunt disponibile la /api/restaurants,
 * /api/orders, /api/inventory, /api/deliveries, /api/suppliers.
 *
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const http = require('http');
const https = require('https');

const { authenticate, optionalAuth } = require('../middleware/auth');
const { authorizeMinLevel, isStaffRole } = require('../middleware/roles');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/**
 * Directorul view-urilor pentru modulul restaurant.
 * @type {string}
 */
const VIEWS_DIR = path.join(__dirname, 'views');

/**
 * Roluri care au acces la panoul de restaurant (staff intern).
 * @type {string}
 */
const MIN_STAFF_ROLE = 'ospătar';

/**
 * Durata maximă (ms) pentru fetch-urile interne de pe dashboard.
 * @type {number}
 */
const DASHBOARD_FETCH_TIMEOUT_MS = 5000;

/**
 * Durata maximă (ms) pentru fetch-urile interne de login.
 * @type {number}
 */
const LOGIN_FETCH_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// Middleware: requireStaff – verifică rol minim de staff
// ---------------------------------------------------------------------------

/**
 * Middleware care verifică dacă utilizatorul are cel puțin rolul minim de staff.
 * Dacă nu, randează pagina de login cu un mesaj de eroare.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next
 */
function requireStaff(req, res, next) {
  if (!req.user) {
    return renderRestaurantView('login', {
      title: 'Autentificare Restaurant – GastroHub',
      currentPage: 'restaurant-login',
      error: 'Trebuie să te autentifici pentru a accesa panoul de restaurant.',
      email: '',
    })(req, res);
  }

  if (!isStaffRole(req.user.role)) {
    console.warn(
      `[restaurant/routes] Acces respins: utilizatorul ${req.user.email} are rolul "${req.user.role}" (necesită minim "${MIN_STAFF_ROLE}")`
    );
    return renderRestaurantView('login', {
      title: 'Autentificare Restaurant – GastroHub',
      currentPage: 'restaurant-login',
      error: 'Nu ai permisiunile necesare pentru a accesa panoul de restaurant.',
      email: req.user.email || '',
    })(req, res);
  }

  next();
}

// ---------------------------------------------------------------------------
// Helper: randare view restaurant cu date implicite
// ---------------------------------------------------------------------------

/**
 * Returnează o funcție middleware care randează un view din directorul
 * restaurant/views, injectând automat datele comune (user, isAuthenticated,
 * currentPage, etc.).
 *
 * @param {string} viewName - numele fișierului view (fără extensie)
 * @param {Object} [extraData={}] - date suplimentare pentru view
 * @returns {Function} middleware Express
 */
function renderRestaurantView(viewName, extraData = {}) {
  return (req, res) => {
    const baseData = {
      user: req.user || null,
      isAuthenticated: !!req.user,
      currentPage: extraData.currentPage || viewName,
      title: extraData.title || 'Restaurant – GastroHub',
    };

    const viewData = { ...baseData, ...extraData };

    try {
      res.render(path.join(VIEWS_DIR, viewName), viewData);
    } catch (renderErr) {
      console.error(
        `[restaurant/routes] Eroare randare view "${viewName}":`,
        renderErr.message
      );
      if (!res.headersSent) {
        res.status(500).send('Eroare la încărcarea paginii.');
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
 * @param {string} apiPath - calea API (ex: /api/orders?...)
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
      console.warn(`[restaurant/routes] URL invalid: ${url}`, parseErr.message);
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
            `[restaurant/routes] Fetch intern eșuat (HTTP ${res.statusCode}): ${url}`
          );
          return resolve(null);
        }

        let data;
        try {
          data = JSON.parse(rawData);
        } catch (parseErr) {
          console.warn(
            `[restaurant/routes] Răspuns invalid JSON de la: ${url}`,
            parseErr.message
          );
          return resolve(null);
        }

        resolve(data);
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        console.warn(`[restaurant/routes] Timeout (${timeoutMs}ms) la fetch: ${url}`);
      } else {
        console.warn(`[restaurant/routes] Eroare rețea la fetch: ${url}`, err.message);
      }
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      console.warn(`[restaurant/routes] Timeout (${timeoutMs}ms) la fetch: ${url}`);
      resolve(null);
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Helper: fetch intern cu suport pentru metode și corp (POST/PUT)
// ---------------------------------------------------------------------------

/**
 * Execută un fetch intern generic cu suport pentru orice metodă HTTP,
 * headers personalizate și corp (body).
 *
 * @param {string} url - URL-ul complet al apelului
 * @param {Object} [options={}] - opțiuni
 * @param {string} [options.method='GET'] - Metoda HTTP
 * @param {Object} [options.headers={}] - Header-e adiționale
 * @param {string|null} [options.body=null] - Corpul request-ului (pentru POST/PUT)
 * @param {number} [options.timeoutMs=10000] - timeout în milisecunde
 * @returns {Promise<{statusCode: number, headers: Object, data: Object}>} obiectul cu status, headers și date
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
// GET /restaurant/login – Formular de autentificare pentru Restaurant
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/login
 * @desc    Servește formularul de login pentru modulul Restaurant
 * @access  Public
 */
router.get('/login', optionalAuth, (req, res) => {
  // Dacă utilizatorul este deja autentificat și e staff, redirect la dashboard
  if (req.user && isStaffRole(req.user.role)) {
    return res.redirect('/restaurant/dashboard');
  }

  return renderRestaurantView('login', {
    title: 'Autentificare Restaurant – GastroHub',
    currentPage: 'restaurant-login',
    error: req.query.error || null,
    flash: req.query.flash
      ? { type: req.query.flashType || 'info', message: req.query.flash }
      : null,
    email: req.query.email || '',
  })(req, res);
});

// ---------------------------------------------------------------------------
// POST /restaurant/login – Procesare autentificare Restaurant
// ---------------------------------------------------------------------------

/**
 * @route   POST /restaurant/login
 * @desc    Procesează autentificarea delegând la /api/auth/login prin fetch intern.
 *          Verifică rolul de staff. La succes redirecționează către /restaurant/dashboard.
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
    return renderRestaurantView('login', {
      title: 'Autentificare Restaurant – GastroHub',
      currentPage: 'restaurant-login',
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

  try {
    const result = await internalFetch(loginUrl, {
      method: 'POST',
      headers: forwardHeaders,
      body: requestBody,
    });

    // -----------------------------------------------------------------------
    // Verificare răspuns
    // -----------------------------------------------------------------------
    if (!result || result.statusCode !== 200) {
      const errorMessage =
        (result && result.data && result.data.error) ||
        'Email sau parolă incorecte.';
      return renderRestaurantView('login', {
        title: 'Autentificare Restaurant – GastroHub',
        currentPage: 'restaurant-login',
        error: errorMessage,
        email: email,
      })(req, res);
    }

    // -----------------------------------------------------------------------
    // Verificare rol de staff
    // -----------------------------------------------------------------------
    const user = result.data.user || result.data;
    if (!user || !isStaffRole(user.role)) {
      return renderRestaurantView('login', {
        title: 'Autentificare Restaurant – GastroHub',
        currentPage: 'restaurant-login',
        error:
          'Contul tău nu are permisiuni de staff. Contactează administratorul.',
        email: email,
      })(req, res);
    }

    // -----------------------------------------------------------------------
    // Forward set-cookie headers de la API-ul de auth către browser
    // -----------------------------------------------------------------------
    if (
      result.headers &&
      result.headers['set-cookie'] &&
      !res.headersSent
    ) {
      const setCookies = Array.isArray(result.headers['set-cookie'])
        ? result.headers['set-cookie']
        : [result.headers['set-cookie']];
      setCookies.forEach((cookie) => {
        res.setHeader('Set-Cookie', cookie);
      });
    }

    // -----------------------------------------------------------------------
    // Redirect la dashboard
    // -----------------------------------------------------------------------
    return res.redirect('/restaurant/dashboard');
  } catch (fetchErr) {
    console.error(
      '[restaurant/routes] Eroare fetch login:',
      fetchErr.message
    );
    return renderRestaurantView('login', {
      title: 'Autentificare Restaurant – GastroHub',
      currentPage: 'restaurant-login',
      error:
        'Eroare de conexiune la serverul de autentificare. Încearcă din nou.',
      email: email,
    })(req, res);
  }
});

// ===========================================================================
// RUTE PROTEJATE (STAFF)
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /restaurant/dashboard – Dashboard principal
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/dashboard
 * @desc    Pagina principală de dashboard pentru staff-ul restaurantului.
 *          Agregă date din multiple API-uri interne (comenzi, inventar, livrări etc.)
 *          folosind Promise.allSettled pentru izolare. Dacă un API e indisponibil,
 *          se randează cu array-uri goale și un indicator de eroare.
 * @access  Privat (doar staff)
 */
router.get('/dashboard', authenticate, requireStaff, async (req, res) => {
  // -------------------------------------------------------------------------
  // Bază date dashboard – comune atât pentru success cât și fallback
  // -------------------------------------------------------------------------
  const tenantId = req.user && req.user.tenantId;
  const restaurantId = req.query.restaurantId || null;

  const baseDashboardData = {
    title: 'Dashboard',
    currentPage: 'dashboard',
    user: req.user,
    isAuthenticated: true,
    restaurant: null,
    restaurants: [],
    currentRestaurantId: restaurantId,
    stats: {
      ordersToday: 0,
      revenueToday: 0,
      activeOrders: 0,
      occupiedTables: 0,
      totalTables: 0,
      occupancyPercent: 0,
    },
    activeOrders: [],
    recentOrders: [],
    inventoryItems: [],
    lowStockItems: [],
    suppliers: [],
    recentSupplierOrders: [],
    headerButtons: [
      {
        href: '/restaurant/orders/new',
        label: 'Comandă nouă',
        icon: 'plus',
        class: 'btn-primary',
      },
    ],
    loading: true,
    alert: null,
    fetchErrors: [],
  };

  // -------------------------------------------------------------------------
  // Dacă nu avem tenantId, randăm direct cu date goale
  // -------------------------------------------------------------------------
  if (!tenantId) {
    console.warn('[restaurant/routes] Dashboard: lipsă tenantId pe req.user');
    baseDashboardData.loading = false;
    baseDashboardData.alert = {
      type: 'warning',
      message:
        'Identitate utilizator incompletă. Unele date pot fi indisponibile.',
    };

    try {
      return res.render(
        path.join(VIEWS_DIR, 'dashboard'),
        baseDashboardData
      );
    } catch (renderErr) {
      console.error(
        '[restaurant/routes] Eroare randare dashboard:',
        renderErr.message
      );
      if (!res.headersSent) {
        return res
          .status(500)
          .send('Eroare la încărcarea dashboard-ului.');
      }
    }
    return;
  }

  // -------------------------------------------------------------------------
  // Fetch-uri paralele izolate cu Promise.allSettled
  // -------------------------------------------------------------------------
  const queryParams = restaurantId
    ? `&restaurantId=${restaurantId}`
    : '';

  const dashboardUrl = buildInternalUrl(
    req,
    `/api/restaurants/dashboard?tenantId=${tenantId}${queryParams}`
  );
  const ordersUrl = buildInternalUrl(
    req,
    `/api/orders?tenantId=${tenantId}${queryParams}&status=deschis,în+preparare&limit=10`
  );
  const recentOrdersUrl = buildInternalUrl(
    req,
    `/api/orders?tenantId=${tenantId}${queryParams}&limit=10`
  );
  const inventoryUrl = buildInternalUrl(
    req,
    `/api/inventory?tenantId=${tenantId}&limit=10`
  );
  const suppliersUrl = buildInternalUrl(
    req,
    `/api/suppliers?tenantId=${tenantId}&limit=10`
  );
  const deliveriesUrl = buildInternalUrl(
    req,
    `/api/deliveries?tenantId=${tenantId}&limit=5`
  );

  const results = await Promise.allSettled([
    safeInternalFetch(dashboardUrl),
    safeInternalFetch(ordersUrl),
    safeInternalFetch(recentOrdersUrl),
    safeInternalFetch(inventoryUrl),
    safeInternalFetch(suppliersUrl),
    safeInternalFetch(deliveriesUrl),
  ]);

  // -------------------------------------------------------------------------
  // Procesare rezultate – fiecare settled promise tratat independent
  // -------------------------------------------------------------------------
  const [
    dashboardResult,
    ordersResult,
    recentOrdersResult,
    inventoryResult,
    suppliersResult,
    deliveriesResult,
  ] = results;

  // Extrage datele din fiecare rezultat (valoare sau null)
  const dashboardData =
    dashboardResult.status === 'fulfilled' ? dashboardResult.value : null;
  const ordersData =
    ordersResult.status === 'fulfilled' ? ordersResult.value : null;
  const recentOrdersData =
    recentOrdersResult.status === 'fulfilled'
      ? recentOrdersResult.value
      : null;
  const inventoryData =
    inventoryResult.status === 'fulfilled'
      ? inventoryResult.value
      : null;
  const suppliersData =
    suppliersResult.status === 'fulfilled'
      ? suppliersResult.value
      : null;
  const deliveriesData =
    deliveriesResult.status === 'fulfilled'
      ? deliveriesResult.value
      : null;

  // Colectare erori de fetch
  const fetchErrors = [];
  if (dashboardResult.status === 'rejected' || !dashboardData)
    fetchErrors.push('Dashboard API');
  if (ordersResult.status === 'rejected' || !ordersData)
    fetchErrors.push('Comenzi active');
  if (recentOrdersResult.status === 'rejected' || !recentOrdersData)
    fetchErrors.push('Comenzi recente');
  if (inventoryResult.status === 'rejected' || !inventoryData)
    fetchErrors.push('Inventar');
  if (suppliersResult.status === 'rejected' || !suppliersData)
    fetchErrors.push('Furnizori');
  if (deliveriesResult.status === 'rejected' || !deliveriesData)
    fetchErrors.push('Livrări');

  // -------------------------------------------------------------------------
  // Populare date dashboard din rezultate
  // -------------------------------------------------------------------------
  if (dashboardData) {
    baseDashboardData.stats = {
      ordersToday: dashboardData.ordersToday || 0,
      revenueToday: dashboardData.revenueToday || 0,
      activeOrders: dashboardData.activeOrders || 0,
      occupiedTables: dashboardData.occupiedTables || 0,
      totalTables: dashboardData.totalTables || 0,
      occupancyPercent: dashboardData.occupancyPercent || 0,
    };
    baseDashboardData.restaurant = dashboardData.restaurant || null;
    baseDashboardData.restaurants = dashboardData.restaurants || [];
  }

  baseDashboardData.activeOrders =
    (ordersData && ordersData.orders) ||
    (ordersData && Array.isArray(ordersData) ? ordersData : []) ||
    [];
  baseDashboardData.recentOrders =
    (recentOrdersData && recentOrdersData.orders) ||
    (recentOrdersData && Array.isArray(recentOrdersData)
      ? recentOrdersData
      : []) ||
    [];
  baseDashboardData.inventoryItems =
    (inventoryData && inventoryData.items) ||
    (inventoryData && Array.isArray(inventoryData)
      ? inventoryData
      : []) ||
    [];
  baseDashboardData.lowStockItems =
    baseDashboardData.inventoryItems.filter(
      (item) =>
        item.quantity !== undefined &&
        item.minQuantity !== undefined &&
        item.quantity <= item.minQuantity
    );
  baseDashboardData.suppliers =
    (suppliersData && suppliersData.suppliers) ||
    (suppliersData && Array.isArray(suppliersData)
      ? suppliersData
      : []) ||
    [];
  baseDashboardData.recentSupplierOrders =
    (deliveriesData && deliveriesData.deliveries) ||
    (deliveriesData && Array.isArray(deliveriesData)
      ? deliveriesData
      : []) ||
    [];

  // -------------------------------------------------------------------------
  // Setare stare finală
  // -------------------------------------------------------------------------
  baseDashboardData.loading = false;
  baseDashboardData.fetchErrors = fetchErrors;

  if (fetchErrors.length > 0) {
    baseDashboardData.alert = {
      type: 'warning',
      message: `Unele date nu au putut fi încărcate: ${fetchErrors.join(', ')}.`,
    };
  }

  // -------------------------------------------------------------------------
  // Randare dashboard
  // -------------------------------------------------------------------------
  try {
    res.render(path.join(VIEWS_DIR, 'dashboard'), baseDashboardData);
  } catch (renderErr) {
    console.error(
      '[restaurant/routes] Eroare critică la randarea dashboard:',
      renderErr.message
    );
    if (!res.headersSent) {
      res
        .status(500)
        .send(
          'Eroare la încărcarea dashboard-ului. Vă rugăm încercați din nou.'
        );
    }
  }
});

// ---------------------------------------------------------------------------
// GET /restaurant/orders – Lista comenzilor
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/orders
 * @desc    Pagina de gestionare a comenzilor (listă completă cu filtre)
 * @access  Privat (doar staff)
 */
router.get(
  '/orders',
  authenticate,
  requireStaff,
  renderRestaurantView('orders', {
    title: 'Comenzi',
    currentPage: 'orders',
    pageIcon: 'receipt',
    headerButtons: [
      {
        href: '/restaurant/orders/new',
        label: 'Comandă nouă',
        icon: 'plus',
        class: 'btn-primary',
      },
    ],
    head: '',
    scripts: `
    <script src="/restaurant/js/orders-page.js"></script>
  `,
  })
);

// ---------------------------------------------------------------------------
// GET /restaurant/orders/new – Formular comandă nouă
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/orders/new
 * @desc    Pagina de creare a unei comenzi noi
 * @access  Privat (doar staff)
 */
router.get(
  '/orders/new',
  authenticate,
  requireStaff,
  renderRestaurantView('orders', {
    title: 'Comandă nouă',
    currentPage: 'orders',
    pageIcon: 'plus-circle',
    headerButtons: [],
    head: '',
    scripts: `
    <script src="/restaurant/js/orders-new.js"></script>
  `,
    isNewOrder: true,
  })
);

// ---------------------------------------------------------------------------
// GET /restaurant/orders/:id – Detalii comandă
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/orders/:id
 * @desc    Pagina de detalii pentru o comandă specifică
 * @access  Privat (doar staff)
 */
router.get(
  '/orders/:id',
  authenticate,
  requireStaff,
  renderRestaurantView('orders', {
    title: 'Detalii comandă',
    currentPage: 'orders',
    pageIcon: 'info-circle',
    headerButtons: [
      {
        href: '/restaurant/orders',
        label: 'Înapoi la comenzi',
        icon: 'arrow-left',
        class: 'btn-secondary',
      },
    ],
    head: '',
    scripts: `
    <script src="/restaurant/js/orders-detail.js"></script>
  `,
    isDetail: true,
  })
);

// ---------------------------------------------------------------------------
// GET /restaurant/menu – Gestionare meniu
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/menu
 * @desc    Pagina de gestionare a meniului
 * @access  Privat (doar staff)
 */
router.get(
  '/menu',
  authenticate,
  requireStaff,
  renderRestaurantView('menu', {
    title: 'Meniu',
    currentPage: 'menu',
    pageIcon: 'utensils',
    headerButtons: [
      {
        href: '/restaurant/menu/new',
        label: 'Produs nou',
        icon: 'plus',
        class: 'btn-primary',
      },
    ],
    head: '',
    scripts: `
    <script src="/restaurant/js/menu-page.js"></script>
  `,
  })
);

// ---------------------------------------------------------------------------
// GET /restaurant/inventory – Gestionare inventar
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/inventory
 * @desc    Pagina de gestionare a inventarului
 * @access  Privat (doar staff)
 */
router.get(
  '/inventory',
  authenticate,
  requireStaff,
  renderRestaurantView('inventory', {
    title: 'Inventar',
    currentPage: 'inventory',
    pageIcon: 'boxes',
    headerButtons: [
      {
        href: '/restaurant/inventory/new',
        label: 'Articol nou',
        icon: 'plus',
        class: 'btn-primary',
      },
    ],
    head: '',
    scripts: `
    <script src="/restaurant/js/inventory-page.js"></script>
  `,
  })
);

// ---------------------------------------------------------------------------
// GET /restaurant/deliveries – Gestionare livrări
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/deliveries
 * @desc    Pagina de gestionare a livrărilor
 * @access  Privat (doar staff)
 */
router.get(
  '/deliveries',
  authenticate,
  requireStaff,
  renderRestaurantView('deliveries', {
    title: 'Livrări',
    currentPage: 'deliveries',
    pageIcon: 'truck',
    headerButtons: [
      {
        href: '/restaurant/deliveries/new',
        label: 'Livrare nouă',
        icon: 'plus',
        class: 'btn-primary',
      },
    ],
    head: '',
    scripts: `
    <script src="/restaurant/js/deliveries-page.js"></script>
  `,
  })
);

// ---------------------------------------------------------------------------
// GET /restaurant/suppliers – Gestionare furnizori
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/suppliers
 * @desc    Pagina de gestionare a furnizorilor
 * @access  Privat (doar staff)
 */
router.get(
  '/suppliers',
  authenticate,
  requireStaff,
  renderRestaurantView('suppliers', {
    title: 'Furnizori',
    currentPage: 'suppliers',
    pageIcon: 'address-book',
    headerButtons: [
      {
        href: '/restaurant/suppliers/new',
        label: 'Furnizor nou',
        icon: 'plus',
        class: 'btn-primary',
      },
    ],
    head: '',
    scripts: `
    <script src="/restaurant/js/suppliers-page.js"></script>
  `,
  })
);

// ---------------------------------------------------------------------------
// GET /restaurant/settings – Setări restaurant
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/settings
 * @desc    Pagina de setări pentru restaurant
 * @access  Privat (doar staff)
 */
router.get(
  '/settings',
  authenticate,
  requireStaff,
  renderRestaurantView('settings', {
    title: 'Setări',
    currentPage: 'settings',
    pageIcon: 'gear',
    headerButtons: [],
    head: '',
    scripts: `
    <script src="/restaurant/js/settings-page.js"></script>
  `,
  })
);

// ---------------------------------------------------------------------------
// GET /restaurant/reports – Rapoarte (redirect la dashboard)
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/reports
 * @desc    Pagina de rapoarte (placeholder – redirect la dashboard)
 * @access  Privat (doar staff)
 */
router.get('/reports', authenticate, requireStaff, (req, res) => {
  // Momentan redirect la dashboard; pagina de rapoarte va fi implementată ulterior
  res.redirect('/restaurant/dashboard');
});

// ---------------------------------------------------------------------------
// GET /restaurant/staff – Personal (redirect la dashboard)
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/staff
 * @desc    Pagina de gestionare a personalului (placeholder – redirect)
 * @access  Privat (doar staff)
 */
router.get('/staff', authenticate, requireStaff, (req, res) => {
  // Momentan redirect la dashboard; pagina de personal va fi implementată ulterior
  res.redirect('/restaurant/dashboard');
});

// ===========================================================================
// RUTĂ FALLBACK – 404 pentru rutele negăsite sub /restaurant
// ===========================================================================

/**
 * @route   GET /restaurant/*
 * @desc    Fallback pentru rute restaurant negăsite
 * @access  Public / Privat
 */
router.get('*', optionalAuth, (req, res) => {
  // Dacă utilizatorul e autentificat ca staff, redirect la dashboard
  if (req.user && isStaffRole(req.user.role)) {
    return res.redirect('/restaurant/dashboard');
  }

  // Altfel, redirect la login-ul de restaurant
  res.redirect('/restaurant/login');
});

// ===========================================================================
// Export router
// ===========================================================================

module.exports = router;