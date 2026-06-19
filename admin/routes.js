/**
 * ============================================================
 * admin/routes.js - Rute pentru panoul de administrare
 * ============================================================
 *
 * Responsabilități:
 *  1. GET    /admin/login       – Pagina de autentificare super admin
 *  2. POST   /admin/login       – Procesare autentificare
 *  3. GET    /admin/logout      – Deconectare
 *  4. GET    /admin/dashboard   – Dashboard principal admin
 *  5. GET    /admin/tenants     – Gestionare tenanți
 *  6. GET    /admin/settings    – Setări platformă
 *  7. GET    /admin/*           – Fallback – pagină negăsită
 *
 * NOTĂ: Toate rutele din acest fișier sunt montate sub prefixul /admin
 * în server.js.
 *
 * API-urile de administrare sunt disponibile la /api/admin/*
 * (definite în rutele API dedicate).
 *
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');

const { authenticate, optionalAuth, generateToken, setTokenCookie, clearTokenCookie } = require('../middleware/auth');
const { authorize, authorizeMinLevel, isAdminRole } = require('../middleware/roles');
const { users } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/**
 * Lista rolurilor considerate de administrare pentru panou.
 * @type {string[]}
 */
const ADMIN_ROLES = ['super_admin'];

/**
 * Numele view-urilor pentru paginile statice EJS din admin/views/.
 * @type {Object}
 */
const ADMIN_VIEWS = {
  LOGIN: 'login',
  DASHBOARD: 'dashboard',
  LAYOUT: 'layout',
  SETTINGS: 'settings',
  TENANTS: 'tenants',
};

// ---------------------------------------------------------------------------
// Funcție internă: căutare utilizator în baza de date (promisiune)
// ---------------------------------------------------------------------------

/**
 * Caută un utilizator în baza de date după email.
 *
 * @param {string} email - Adresa de email
 * @returns {Promise<Object|null>}
 */
function findUserByEmail(email) {
  return new Promise((resolve, reject) => {
    users.findOne({ email: email.toLowerCase().trim() }, (err, doc) => {
      if (err) return reject(err);
      resolve(doc || null);
    });
  });
}

/**
 * Caută un utilizator în baza de date după ID.
 *
 * @param {string} id - ID-ul utilizatorului
 * @returns {Promise<Object|null>}
 */
function findUserById(id) {
  return new Promise((resolve, reject) => {
    users.findOne({ _id: id }, (err, doc) => {
      if (err) return reject(err);
      resolve(doc || null);
    });
  });
}

// ---------------------------------------------------------------------------
// Funcție internă: numărare tenanți (pentru sidebar)
// ---------------------------------------------------------------------------

/**
 * Returnează numărul total de tenanți din baza de date.
 *
 * @returns {Promise<number>}
 */
function countTenants() {
  const { tenants } = require('../config/db');
  return new Promise((resolve, reject) => {
    tenants.count({}, (err, count) => {
      if (err) return reject(err);
      resolve(count || 0);
    });
  });
}

// ---------------------------------------------------------------------------
// Middleware: verificare acces super_admin
// ---------------------------------------------------------------------------

/**
 * Middleware care verifică dacă utilizatorul autentificat are rolul
 * de super_admin. Blochează accesul celorlalți utilizatori.
 *
 * @param {Object}   req   - Obiectul request Express
 * @param {Object}   res   - Obiectul response Express
 * @param {Function} next  - Următorul middleware
 */
function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.redirect('/admin/login');
  }

  if (req.user.role !== 'super_admin') {
    return res.status(403).render('login', {
      title: 'Acces Interzis',
      error: 'Nu ai permisiunile necesare pentru a accesa panoul de administrare.',
      admin: null,
      isAuthenticated: false,
    });
  }

  next();
}

// ---------------------------------------------------------------------------
// Helper: randare pagină EJS cu date comune
// ---------------------------------------------------------------------------

/**
 * Randare pagină EJS din directorul admin/views/.
 * Include date comune precum admin, tenantCount, etc.
 *
 * @param {string} view - numele fișierului fără .ejs
 * @param {Object} extraData - date suplimentare trimise la view
 * @returns {Function} middleware Express
 */
function renderAdminView(view, extraData = {}) {
  return async (req, res) => {
    try {
      const tenantCount = await countTenants();

      const admin = req.user ? {
        _id: req.user._id,
        email: req.user.email,
        name: req.user.name || req.user.email,
        role: req.user.role,
      } : null;

      res.render(view, {
        title: extraData.title || 'Panou Administrare',
        currentPage: extraData.currentPage || '',
        admin,
        isAuthenticated: !!req.user,
        tenantCount,
        ...extraData,
      });
    } catch (err) {
      console.error('[admin/routes] Eroare la randare view:', err);
      res.render(view, {
        title: extraData.title || 'Panou Administrare',
        currentPage: extraData.currentPage || '',
        admin: req.user ? {
          _id: req.user._id,
          email: req.user.email,
          name: req.user.name || req.user.email,
          role: req.user.role,
        } : null,
        isAuthenticated: !!req.user,
        tenantCount: 0,
        ...extraData,
      });
    }
  };
}

// ===========================================================================
// RUTE PUBLICE (autentificare)
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /admin/login – Pagina de autentificare super admin
// ---------------------------------------------------------------------------

/**
 * @route   GET /admin/login
 * @desc    Pagina de autentificare pentru super admin
 * @access  Public
 */
router.get('/login', optionalAuth, async (req, res) => {
  // Dacă utilizatorul este deja autentificat și e super_admin, redirect la dashboard
  if (req.user && req.user.role === 'super_admin') {
    return res.redirect('/admin/dashboard');
  }

  try {
    const tenantCount = await countTenants();
    res.render(ADMIN_VIEWS.LOGIN, {
      title: 'Autentificare Admin',
      currentPage: 'admin-login',
      admin: null,
      isAuthenticated: false,
      tenantCount,
      success: null,
      error: null,
      warning: null,
      formData: {},
      action: '/admin/login',
      forgotUrl: '/admin/forgot-password',
    });
  } catch (err) {
    res.render(ADMIN_VIEWS.LOGIN, {
      title: 'Autentificare Admin',
      currentPage: 'admin-login',
      admin: null,
      isAuthenticated: false,
      tenantCount: 0,
      success: null,
      error: null,
      warning: null,
      formData: {},
      action: '/admin/login',
      forgotUrl: '/admin/forgot-password',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/login – Procesare autentificare super admin
// ---------------------------------------------------------------------------

/**
 * @route   POST /admin/login
 * @desc    Procesează autentificarea super admin-ului
 * @access  Public
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password, remember } = req.body;

    // -----------------------------------------------------------------------
    // 1. Validare câmpuri obligatorii
    // -----------------------------------------------------------------------
    if (!email || !email.trim()) {
      return res.render(ADMIN_VIEWS.LOGIN, {
        title: 'Autentificare Admin',
        currentPage: 'admin-login',
        admin: null,
        isAuthenticated: false,
        tenantCount: await countTenants().catch(() => 0),
        error: 'Adresa de email este obligatorie.',
        warning: null,
        success: null,
        formData: { email },
        action: '/admin/login',
        forgotUrl: '/admin/forgot-password',
      });
    }

    if (!password || !password.trim()) {
      return res.render(ADMIN_VIEWS.LOGIN, {
        title: 'Autentificare Admin',
        currentPage: 'admin-login',
        admin: null,
        isAuthenticated: false,
        tenantCount: await countTenants().catch(() => 0),
        error: 'Parola este obligatorie.',
        warning: null,
        success: null,
        formData: { email },
        action: '/admin/login',
        forgotUrl: '/admin/forgot-password',
      });
    }

    // -----------------------------------------------------------------------
    // 2. Căutare utilizator după email
    // -----------------------------------------------------------------------
    const user = await findUserByEmail(email);

    if (!user) {
      return res.render(ADMIN_VIEWS.LOGIN, {
        title: 'Autentificare Admin',
        currentPage: 'admin-login',
        admin: null,
        isAuthenticated: false,
        tenantCount: await countTenants().catch(() => 0),
        error: 'Adresă de email sau parolă incorectă.',
        warning: null,
        success: null,
        formData: { email },
        action: '/admin/login',
        forgotUrl: '/admin/forgot-password',
      });
    }

    // -----------------------------------------------------------------------
    // 3. Verificare rol super_admin
    // -----------------------------------------------------------------------
    if (user.role !== 'super_admin') {
      return res.render(ADMIN_VIEWS.LOGIN, {
        title: 'Autentificare Admin',
        currentPage: 'admin-login',
        admin: null,
        isAuthenticated: false,
        tenantCount: await countTenants().catch(() => 0),
        error: 'Nu ai permisiunile necesare pentru a accesa acest panou.',
        warning: null,
        success: null,
        formData: { email },
        action: '/admin/login',
        forgotUrl: '/admin/forgot-password',
      });
    }

    // -----------------------------------------------------------------------
    // 4. Verificare parolă
    // -----------------------------------------------------------------------
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.render(ADMIN_VIEWS.LOGIN, {
        title: 'Autentificare Admin',
        currentPage: 'admin-login',
        admin: null,
        isAuthenticated: false,
        tenantCount: await countTenants().catch(() => 0),
        error: 'Adresă de email sau parolă incorectă.',
        warning: null,
        success: null,
        formData: { email },
        action: '/admin/login',
        forgotUrl: '/admin/forgot-password',
      });
    }

    // -----------------------------------------------------------------------
    // 5. Generare token JWT și setare cookie
    // -----------------------------------------------------------------------
    const expiresIn = remember ? '30d' : '7d';
    const token = generateToken(user, expiresIn);
    setTokenCookie(res, token);

    // -----------------------------------------------------------------------
    // 6. Redirect la dashboard
    // -----------------------------------------------------------------------
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('[admin/routes] Eroare la autentificare:', err);
    try {
      const tenantCount = await countTenants().catch(() => 0);
      res.render(ADMIN_VIEWS.LOGIN, {
        title: 'Autentificare Admin',
        currentPage: 'admin-login',
        admin: null,
        isAuthenticated: false,
        tenantCount,
        error: 'Eroare internă la autentificare. Încearcă din nou.',
        warning: null,
        success: null,
        formData: { email: req.body.email || '' },
        action: '/admin/login',
        forgotUrl: '/admin/forgot-password',
      });
    } catch (renderErr) {
      next(new AppError('Eroare internă la autentificare.', 500, 'ADMIN_LOGIN_ERROR'));
    }
  }
});

// ---------------------------------------------------------------------------
// GET /admin/logout – Deconectare
// ---------------------------------------------------------------------------

/**
 * @route   GET /admin/logout
 * @desc    Deconectează utilizatorul și șterge cookie-ul
 * @access  Public
 */
router.get('/logout', (req, res) => {
  clearTokenCookie(res);
  res.redirect('/admin/login');
});

// ===========================================================================
// RUTE PROTEJATE (necesită autentificare super_admin)
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /admin/dashboard – Dashboard principal admin
// ---------------------------------------------------------------------------

/**
 * @route   GET /admin/dashboard
 * @desc    Dashboard-ul principal al panoului de administrare
 * @access  Privat (doar super_admin)
 */
router.get('/dashboard', authenticate, requireSuperAdmin, renderAdminView(ADMIN_VIEWS.DASHBOARD, {
  title: 'Dashboard',
  currentPage: 'admin-dashboard',
}));

// ---------------------------------------------------------------------------
// GET /admin/ – Redirect la dashboard
// ---------------------------------------------------------------------------

/**
 * @route   GET /admin/
 * @desc    Redirect automat la dashboard
 * @access  Privat (doar super_admin)
 */
router.get('/', authenticate, requireSuperAdmin, (req, res) => {
  res.redirect('/admin/dashboard');
});

// ---------------------------------------------------------------------------
// GET /admin/tenants – Gestionare tenanți
// ---------------------------------------------------------------------------

/**
 * @route   GET /admin/tenants
 * @desc    Pagina de gestionare a tenanților
 * @access  Privat (doar super_admin)
 */
router.get('/tenants', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const tenantCount = await countTenants();

    const { tenants } = require('../config/db');

    // Încărcare listă tenanți pentru randare inițială pe server
    const items = await new Promise((resolve, reject) => {
      tenants.find({})
        .sort({ createdAt: -1 })
        .limit(50)
        .exec((err, docs) => {
          if (err) return reject(err);
          resolve(docs || []);
        });
    });

    const admin = req.user ? {
      _id: req.user._id,
      email: req.user.email,
      name: req.user.name || req.user.email,
      role: req.user.role,
    } : null;

    res.render(ADMIN_VIEWS.TENANTS, {
      title: 'Gestionare Tenanți',
      currentPage: 'admin-tenants',
      admin,
      isAuthenticated: true,
      tenantCount,
      tenants: {
        items,
        total: tenantCount,
      },
    });
  } catch (err) {
    console.error('[admin/routes] Eroare la încărcarea tenanților:', err);

    const admin = req.user ? {
      _id: req.user._id,
      email: req.user.email,
      name: req.user.name || req.user.email,
      role: req.user.role,
    } : null;

    res.render(ADMIN_VIEWS.TENANTS, {
      title: 'Gestionare Tenanți',
      currentPage: 'admin-tenants',
      admin,
      isAuthenticated: true,
      tenantCount: 0,
      tenants: {
        items: [],
        total: 0,
      },
    });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/settings – Setări platformă
// ---------------------------------------------------------------------------

/**
 * @route   GET /admin/settings
 * @desc    Pagina de setări ale platformei
 * @access  Privat (doar super_admin)
 */
router.get('/settings', authenticate, requireSuperAdmin, renderAdminView(ADMIN_VIEWS.SETTINGS, {
  title: 'Setări Platformă',
  currentPage: 'admin-settings',
}));

// ---------------------------------------------------------------------------
// GET /admin/users – Gestionare utilizatori admin (viitoare implementare)
// ---------------------------------------------------------------------------

/**
 * @route   GET /admin/users
 * @desc    Pagina de gestionare a utilizatorilor admin
 * @access  Privat (doar super_admin)
 */
router.get('/users', authenticate, requireSuperAdmin, renderAdminView(ADMIN_VIEWS.DASHBOARD, {
  title: 'Gestionare Utilizatori',
  currentPage: 'admin-users',
}));

// ---------------------------------------------------------------------------
// GET /admin/audit – Jurnal audit (viitoare implementare)
// ---------------------------------------------------------------------------

/**
 * @route   GET /admin/audit
 * @desc    Pagina de jurnal audit
 * @access  Privat (doar super_admin)
 */
router.get('/audit', authenticate, requireSuperAdmin, renderAdminView(ADMIN_VIEWS.DASHBOARD, {
  title: 'Jurnal Audit',
  currentPage: 'admin-audit',
}));

// ---------------------------------------------------------------------------
// POST /admin/forgot-password – Resetare parolă (simplificat)
// ---------------------------------------------------------------------------

/**
 * @route   POST /admin/forgot-password
 * @desc    Trimite email de resetare parolă (implementare de bază)
 * @access  Public
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.trim()) {
      return res.render(ADMIN_VIEWS.LOGIN, {
        title: 'Autentificare Admin',
        currentPage: 'admin-login',
        admin: null,
        isAuthenticated: false,
        tenantCount: await countTenants().catch(() => 0),
        error: 'Adresa de email este obligatorie.',
        warning: null,
        success: null,
        formData: { email },
        action: '/admin/login',
        forgotUrl: '/admin/forgot-password',
      });
    }

    // Verificare dacă utilizatorul există
    const user = await findUserByEmail(email);

    // Nu dezvăluim dacă email-ul există sau nu (securitate)
    res.render(ADMIN_VIEWS.LOGIN, {
      title: 'Autentificare Admin',
      currentPage: 'admin-login',
      admin: null,
      isAuthenticated: false,
      tenantCount: await countTenants().catch(() => 0),
      success: 'Dacă adresa de email există în sistem, vei primi instrucțiuni de resetare.',
      error: null,
      warning: null,
      formData: {},
      action: '/admin/login',
      forgotUrl: '/admin/forgot-password',
    });
  } catch (err) {
    console.error('[admin/routes] Eroare la forgot-password:', err);
    res.render(ADMIN_VIEWS.LOGIN, {
      title: 'Autentificare Admin',
      currentPage: 'admin-login',
      admin: null,
      isAuthenticated: false,
      tenantCount: 0,
      error: 'Eroare internă. Încearcă din nou.',
      warning: null,
      success: null,
      formData: {},
      action: '/admin/login',
      forgotUrl: '/admin/forgot-password',
    });
  }
});

// ===========================================================================
// RUTĂ FALLBACK – 404 pentru rutele negăsite sub /admin
// ===========================================================================

/**
 * @route   GET /admin/*
 * @desc    Fallback pentru rute admin negăsite
 * @access  Public / Privat
 */
router.get('*', optionalAuth, (req, res) => {
  // Dacă utilizatorul e autentificat ca super_admin, redirect la dashboard
  if (req.user && req.user.role === 'super_admin') {
    return res.redirect('/admin/dashboard');
  }

  // Altfel, redirect la login
  res.redirect('/admin/login');
});

// ===========================================================================
// Export router
// ===========================================================================

module.exports = router;