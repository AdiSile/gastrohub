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

// ---------------------------------------------------------------------------
// Helper: randare pagină EJS pentru restaurant
// ---------------------------------------------------------------------------

/**
 * Randare pagină EJS din directorul restaurant/views/.
 *
 * @param {string} view - numele fișierului fără .ejs
 * @param {Object} extraData - date suplimentare trimise la view
 * @returns {Function} middleware Express
 */
function renderRestaurantView(view, extraData = {}) {
  return (req, res) => {
    const viewPath = path.join(VIEWS_DIR, view);

    try {
      res.render(viewPath, {
        title: extraData.title || 'Restaurant',
        currentPage: extraData.currentPage || '',
        user: req.user || null,
        isAuthenticated: !!req.user,
        restaurant: extraData.restaurant || null,
        restaurants: extraData.restaurants || [],
        currentRestaurantId: extraData.currentRestaurantId || null,
        stats: extraData.stats || {},
        activeOrders: extraData.activeOrders || [],
        recentOrders: extraData.recentOrders || [],
        inventoryItems: extraData.inventoryItems || [],
        lowStockItems: extraData.lowStockItems || [],
        suppliers: extraData.suppliers || [],
        recentSupplierOrders: extraData.recentSupplierOrders || [],
        headerButtons: extraData.headerButtons || [],
        loading: extraData.loading || false,
        alert: extraData.alert || null,
        pageIcon: extraData.pageIcon || 'store',
        head: extraData.head || '',
        scripts: extraData.scripts || '',
        ...extraData,
      });
    } catch (renderErr) {
      console.error(`[restaurant/routes] Eroare la randarea view-ului "${view}":`, renderErr.message);
      if (!res.headersSent) {
        res.status(500).send(
          `Eroare la încărcarea paginii. Vă rugăm încercați din nou. (View: ${view})`
        );
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Helper: middleware de verificare acces staff
// ---------------------------------------------------------------------------

/**
 * Middleware care verifică dacă utilizatorul este membru al staff-ului
 * (orice rol intern: ospătar, bucătar, recepție, manager, owner, super_admin).
 *
 * @param {Object}   req   - Obiectul request Express
 * @param {Object}   res   - Obiectul response Express
 * @param {Function} next  - Următorul middleware
 */
function requireStaff(req, res, next) {
  if (!req.user) {
    return res.redirect('/customer/login');
  }

  if (!isStaffRole(req.user.role)) {
    return res.status(403).render(path.join(VIEWS_DIR, 'dashboard'), {
      title: 'Acces Interzis',
      currentPage: '',
      user: req.user,
      isAuthenticated: true,
      restaurant: null,
      restaurants: [],
      stats: {},
      activeOrders: [],
      recentOrders: [],
      inventoryItems: [],
      lowStockItems: [],
      suppliers: [],
      recentSupplierOrders: [],
      headerButtons: [],
      loading: false,
      alert: {
        type: 'error',
        message: 'Nu ai permisiunile necesare pentru a accesa panoul de restaurant.',
      },
    });
  }

  next();
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
 * Execută un fetch intern cu timeout și parsing JSON sigur.
 * Returnează null la orice eroare.
 *
 * @param {string} url - URL-ul apelului
 * @param {number} [timeoutMs=5000] - timeout în milisecunde
 * @returns {Promise<Object|null>} obiectul JSON parsat sau null
 */
async function safeInternalFetch(url, timeoutMs = DASHBOARD_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      console.warn(`[restaurant/routes] Fetch intern eșuat (HTTP ${response.status}): ${url}`);
      return null;
    }

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      console.warn(`[restaurant/routes] Răspuns invalid JSON de la: ${url}`, parseErr.message);
      return null;
    }

    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[restaurant/routes] Timeout (${timeoutMs}ms) la fetch: ${url}`);
    } else {
      console.warn(`[restaurant/routes] Eroare rețea la fetch: ${url}`, err.message);
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
// GET /restaurant/ – Redirect la dashboard
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/
 * @desc    Redirect automat către dashboard
 * @access  Public
 */
router.get('/', optionalAuth, (req, res) => {
  if (req.user && isStaffRole(req.user.role)) {
    return res.redirect('/restaurant/dashboard');
  }
  res.redirect('/customer/login');
});

// ===========================================================================
// RUTE PROTEJATE (necesită autentificare + rol staff)
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /restaurant/dashboard – Dashboard principal restaurant
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/dashboard
 * @desc    Dashboard-ul principal al restaurantului cu statistici,
 *          comenzi active, inventar și furnizori.
 * @access  Privat (doar staff)
 *
 * Fetch-urile interne sunt izolate: eșecul unuia nu le afectează pe
 * celelalte. Dacă TOATE fetch-urile eșuează, dashboard-ul se randează
 * cu array-uri goale și un indicator de eroare.
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
      { href: '/restaurant/orders/new', label: 'Comandă nouă', icon: 'plus', class: 'btn-primary' },
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
      message: 'Identitate utilizator incompletă. Unele date pot fi indisponibile.',
    };

    try {
      return res.render(path.join(VIEWS_DIR, 'dashboard'), baseDashboardData);
    } catch (renderErr) {
      console.error('[restaurant/routes] Eroare randare dashboard:', renderErr.message);
      if (!res.headersSent) {
        return res.status(500).send('Eroare la încărcarea dashboard-ului.');
      }
    }
    return;
  }

  // -------------------------------------------------------------------------
  // Fetch-uri paralele izolate cu Promise.allSettled
  // -------------------------------------------------------------------------
  const queryParams = restaurantId ? `&restaurantId=${restaurantId}` : '';

  const dashboardUrl = buildInternalUrl(
    req,
    `/api/restaurants/dashboard?tenantId=${tenantId}${queryParams}`
  );
  const ordersUrl = buildInternalUrl(
    req,
    `/api/orders?tenantId=${tenantId}${queryParams}&status=deschisă,în+preparare&limit=10`
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

  // Dashboard stats
  if (dashboardResult.status === 'fulfilled' && dashboardResult.value) {
    const data = dashboardResult.value;
    if (data.success && data.data) {
      baseDashboardData.stats = {
        ordersToday: data.data.ordersToday || 0,
        revenueToday: data.data.revenueToday || 0,
        activeOrders: data.data.activeOrders || 0,
        occupiedTables: data.data.occupiedTables || 0,
        totalTables: data.data.totalTables || 0,
        occupancyPercent: data.data.occupancyPercent || 0,
        ordersTrend: data.data.ordersTrend,
        revenueTrend: data.data.revenueTrend,
      };
      baseDashboardData.restaurant = data.data.restaurant || null;
      baseDashboardData.restaurants = data.data.restaurants || [];
    }
  } else {
    baseDashboardData.fetchErrors.push('Statistici dashboard indisponibile momentan.');
  }

  // Comenzi active
  if (ordersResult.status === 'fulfilled' && ordersResult.value) {
    const data = ordersResult.value;
    if (data.success) {
      baseDashboardData.activeOrders = data.data && data.data.orders ? data.data.orders : [];
    }
  } else {
    baseDashboardData.fetchErrors.push('Comenzi active indisponibile momentan.');
  }

  // Comenzi recente
  if (recentOrdersResult.status === 'fulfilled' && recentOrdersResult.value) {
    const data = recentOrdersResult.value;
    if (data.success) {
      baseDashboardData.recentOrders = data.data && data.data.orders ? data.data.orders : [];
    }
  } else {
    baseDashboardData.fetchErrors.push('Comenzi recente indisponibile momentan.');
  }

  // Inventar
  if (inventoryResult.status === 'fulfilled' && inventoryResult.value) {
    const data = inventoryResult.value;
    if (data.success) {
      const items = data.data && data.data.items ? data.data.items : [];
      baseDashboardData.inventoryItems = items;
      baseDashboardData.lowStockItems = items.filter(
        item => (item.quantity || 0) <= (item.minStock || item.minThreshold || 5)
      );
    }
  } else {
    baseDashboardData.fetchErrors.push('Inventar indisponibil momentan.');
  }

  // Furnizori
  if (suppliersResult.status === 'fulfilled' && suppliersResult.value) {
    const data = suppliersResult.value;
    if (data.success) {
      baseDashboardData.suppliers = data.data && data.data.items ? data.data.items : [];
    }
  } else {
    baseDashboardData.fetchErrors.push('Furnizori indisponibili momentan.');
  }

  // Livrări recente (ca recentSupplierOrders)
  if (deliveriesResult.status === 'fulfilled' && deliveriesResult.value) {
    const data = deliveriesResult.value;
    if (data.success) {
      baseDashboardData.recentSupplierOrders =
        data.data && data.data.items ? data.data.items : [];
    }
  } else {
    baseDashboardData.fetchErrors.push('Livrări recente indisponibile momentan.');
  }

  // Dacă toate fetch-urile au eșuat, setăm un alert
  if (
    baseDashboardData.fetchErrors.length >= 5 &&
    !baseDashboardData.alert
  ) {
    baseDashboardData.alert = {
      type: 'warning',
      message: 'Nu s-au putut încărca datele. Verifică conexiunea și reîncearcă.',
    };
  }

  baseDashboardData.loading = false;

  // -------------------------------------------------------------------------
  // Randare dashboard
  // -------------------------------------------------------------------------
  try {
    res.render(path.join(VIEWS_DIR, 'dashboard'), baseDashboardData);
  } catch (renderErr) {
    console.error('[restaurant/routes] Eroare critică la randarea dashboard:', renderErr.message);
    if (!res.headersSent) {
      res.status(500).send('Eroare la încărcarea dashboard-ului. Vă rugăm încercați din nou.');
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
router.get('/orders', authenticate, requireStaff, renderRestaurantView('orders', {
  title: 'Comenzi',
  currentPage: 'orders',
  pageIcon: 'receipt',
  headerButtons: [
    { href: '/restaurant/orders/new', label: 'Comandă nouă', icon: 'plus', class: 'btn-primary' },
  ],
  head: '',
  scripts: `
    <script src="/restaurant/js/orders-page.js"></script>
  `,
}));

// ---------------------------------------------------------------------------
// GET /restaurant/orders/new – Formular comandă nouă
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/orders/new
 * @desc    Pagina de creare a unei comenzi noi
 * @access  Privat (doar staff)
 */
router.get('/orders/new', authenticate, requireStaff, renderRestaurantView('orders', {
  title: 'Comandă nouă',
  currentPage: 'orders',
  pageIcon: 'plus-circle',
  headerButtons: [],
  head: '',
  scripts: `
    <script src="/restaurant/js/orders-new.js"></script>
  `,
  isNewOrder: true,
}));

// ---------------------------------------------------------------------------
// GET /restaurant/orders/:id – Detalii comandă
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/orders/:id
 * @desc    Pagina de detalii a unei comenzi
 * @access  Privat (doar staff)
 */
router.get('/orders/:id', authenticate, requireStaff, (req, res) => {
  const viewPath = path.join(VIEWS_DIR, 'orders');

  try {
    res.render(viewPath, {
      title: `Comanda #${req.params.id.substring(0, 8)}`,
      currentPage: 'orders',
      user: req.user,
      isAuthenticated: true,
      orderId: req.params.id,
      restaurant: null,
      restaurants: [],
      stats: {},
      activeOrders: [],
      recentOrders: [],
      inventoryItems: [],
      lowStockItems: [],
      suppliers: [],
      recentSupplierOrders: [],
      headerButtons: [
        { href: '/restaurant/orders', label: 'Înapoi la comenzi', icon: 'arrow-left', class: 'btn-secondary' },
      ],
      loading: false,
      alert: null,
      pageIcon: 'receipt',
      isDetailView: true,
    });
  } catch (renderErr) {
    console.error('[restaurant/routes] Eroare randare detaliu comandă:', renderErr.message);
    if (!res.headersSent) {
      res.status(500).send('Eroare la încărcarea detaliilor comenzii.');
    }
  }
});

// ---------------------------------------------------------------------------
// GET /restaurant/menu – Gestionare meniu
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/menu
 * @desc    Pagina de gestionare a meniului (categorii, produse, prețuri)
 * @access  Privat (doar staff)
 */
router.get('/menu', authenticate, requireStaff, renderRestaurantView('menu', {
  title: 'Meniul',
  currentPage: 'menu',
  pageIcon: 'utensils',
  headerButtons: [
    { href: '#', label: 'Adaugă produs', icon: 'plus', class: 'btn-primary',
      onClick: 'openAddMenuItemModal()' },
  ],
  head: '',
  scripts: `
    <script src="/restaurant/js/menu.js"></script>
  `,
}));

// ---------------------------------------------------------------------------
// GET /restaurant/menu/categories – Categorii meniu (redirect)
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/menu/categories
 * @desc    Redirect la pagina de meniu (categoriile se gestionează în meniu)
 * @access  Privat (doar staff)
 */
router.get('/menu/categories', authenticate, requireStaff, (req, res) => {
  res.redirect('/restaurant/menu');
});

// ---------------------------------------------------------------------------
// GET /restaurant/inventory – Gestionare inventar
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/inventory
 * @desc    Pagina de gestionare a inventarului
 * @access  Privat (doar staff)
 */
router.get('/inventory', authenticate, requireStaff, renderRestaurantView('inventory', {
  title: 'Inventar',
  currentPage: 'inventory',
  pageIcon: 'boxes',
  headerButtons: [
    { href: '#', label: 'Adaugă produs', icon: 'plus', class: 'btn-primary',
      onClick: 'openAddInventoryModal()' },
  ],
  head: '',
  scripts: `
    <script src="/restaurant/js/inventory.js"></script>
  `,
}));

// ---------------------------------------------------------------------------
// GET /restaurant/deliveries – Gestionare livrări
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/deliveries
 * @desc    Pagina de gestionare a livrărilor de la furnizori
 * @access  Privat (doar staff)
 */
router.get('/deliveries', authenticate, requireStaff, renderRestaurantView('deliveries', {
  title: 'Livrări',
  currentPage: 'deliveries',
  pageIcon: 'truck',
  headerButtons: [
    { href: '#', label: 'Livrare nouă', icon: 'plus', class: 'btn-primary',
      onClick: 'openAddDeliveryModal()' },
  ],
  head: '',
  scripts: `
    <script src="/restaurant/js/deliveries.js"></script>
  `,
}));

// ---------------------------------------------------------------------------
// GET /restaurant/suppliers – Gestionare furnizori
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/suppliers
 * @desc    Pagina de gestionare a furnizorilor
 * @access  Privat (doar staff)
 */
router.get('/suppliers', authenticate, requireStaff, renderRestaurantView('suppliers', {
  title: 'Furnizori',
  currentPage: 'suppliers',
  pageIcon: 'truck-loading',
  headerButtons: [
    { href: '#', label: 'Adaugă furnizor', icon: 'plus', class: 'btn-primary',
      onClick: 'openAddSupplierModal()' },
  ],
  head: '',
  scripts: `
    <script src="/restaurant/js/suppliers.js"></script>
  `,
}));

// ---------------------------------------------------------------------------
// GET /restaurant/settings – Setări restaurant
// ---------------------------------------------------------------------------

/**
 * @route   GET /restaurant/settings
 * @desc    Pagina de setări a restaurantului (profil, preferințe, configurări)
 * @access  Privat (doar staff)
 */
router.get('/settings', authenticate, requireStaff, renderRestaurantView('settings', {
  title: 'Setări',
  currentPage: 'settings',
  pageIcon: 'cog',
  headerButtons: [],
  head: '',
  scripts: `
    <script src="/restaurant/js/settings.js"></script>
  `,
  // Date implicite pentru formularul de setări
  settingsData: {
    restaurantName: '',
    address: '',
    phone: '',
    email: '',
    openingHours: '',
    currency: 'RON',
    taxRate: 19,
    serviceCharge: 0,
    lowStockThreshold: 5,
    enableNotifications: true,
    enableOnlineOrders: false,
    theme: 'light',
    language: 'ro',
  },
}));

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

  // Altfel, redirect la login
  res.redirect('/customer/login');
});

// ===========================================================================
// Export router
// ===========================================================================

module.exports = router;