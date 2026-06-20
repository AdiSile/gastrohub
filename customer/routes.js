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

const { authenticate, optionalAuth } = require('../middleware/auth');
const { authorizeMinLevel } = require('../middleware/roles');

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
 * Execută un fetch intern cu timeout și parsing JSON sigur.
 * Returnează null la orice eroare (network, timeout, parsing, HTTP !ok).
 *
 * @param {string} url - URL-ul apelului
 * @param {number} [timeoutMs=5000] - timeout în milisecunde
 * @returns {Promise<Object|null>} obiectul JSON parsat sau null
 */
async function safeInternalFetch(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      console.warn(`[customer/routes] Fetch intern eșuat (HTTP ${response.status}): ${url}`);
      return null;
    }

    // Parsare JSON sigură
    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      console.warn(`[customer/routes] Răspuns invalid JSON de la: ${url}`, parseErr.message);
      return null;
    }

    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[customer/routes] Timeout (${timeoutMs}ms) la fetch: ${url}`);
    } else {
      console.warn(`[customer/routes] Eroare rețea la fetch: ${url}`, err.message);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
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
 * @route   GET /customer/register
 * @desc    Pagina de înregistrare
 * @access  Public
 */
router.get('/register', optionalAuth, renderView('register', { title: 'Înregistrare', currentPage: 'customer-register' }));

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