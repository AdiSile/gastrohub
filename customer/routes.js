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
    res.render(view, {
      title: extraData.title || 'Portal Client',
      currentPage: extraData.currentPage || '',
      user: req.user || null,
      isAuthenticated: !!req.user,
      customer: req.user || null,
      ...extraData,
    });
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
  };
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
 */
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const customerId = req.user._id;

    // Fetch-uri paralele pentru date dashboard
    const [ordersRes, reservationsRes, loyaltyRes] = await Promise.all([
      fetch(`${req.protocol}://${req.hostname}:${process.env.PORT || 3000}/api/orders/customer/${customerId}?tenantId=${tenantId}&limit=5`).catch(() => null),
      fetch(`${req.protocol}://${req.hostname}:${process.env.PORT || 3000}/api/reservations/customer/${customerId}?tenantId=${tenantId}&status=confirmată,check-in&limit=5`).catch(() => null),
      fetch(`${req.protocol}://${req.hostname}:${process.env.PORT || 3000}/api/loyalty/account/${customerId}?tenantId=${tenantId}`).catch(() => null),
    ]);

    let recentOrders = [];
    let activeReservations = [];
    let loyaltyAccount = null;

    if (ordersRes && ordersRes.ok) {
      const ordersData = await ordersRes.json();
      if (ordersData.success) recentOrders = ordersData.data.orders || [];
    }

    if (reservationsRes && reservationsRes.ok) {
      const reservationsData = await reservationsRes.json();
      if (reservationsData.success) activeReservations = reservationsData.data.reservations || [];
    }

    if (loyaltyRes && loyaltyRes.ok) {
      const loyaltyData = await loyaltyRes.json();
      if (loyaltyData.success) loyaltyAccount = loyaltyData.data.account || null;
    }

    const loyaltyPoints = loyaltyAccount ? loyaltyAccount.totalPoints || 0 : 0;

    res.render('dashboard', {
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
      recentOrders,
      activeReservations,
      loyaltyPoints,
      pendingOrdersCount: (recentOrders.filter(o => o.status === 'deschisă' || o.status === 'în preparare')).length,
    });
  } catch (err) {
    // Fallback la dashboard simplu fără date
    res.render('dashboard', {
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
      recentOrders: [],
      activeReservations: [],
      loyaltyPoints: 0,
      pendingOrdersCount: 0,
    });
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
