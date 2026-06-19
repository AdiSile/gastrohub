/**
 * ============================================================
 * middleware/tenant.js - Middleware pentru identificarea și setarea tenantului curent
 * ============================================================
 *
 * Responsabilități:
 *  1. Identifică tenant-ul curent din request (subdomeniu, header, query param)
 *  2. Validează existența tenant-ului în baza de date
 *  3. Populează req.tenant cu datele și configurația tenant-ului
 *  4. Populează req.tenantDb cu baza de date dedicată tenant-ului
 *  5. Expune middleware-ul `resolveTenant` (obligatoriu) și `optionalTenant`
 *     (identificare opțională)
 *
 * Strategie de identificare (în ordinea priorității):
 *  1. Header-ul X-Tenant-Slug
 *  2. Subdomeniu (ex: restaurant-abc.exemplu.com)
 *  3. Query parameter ?tenant=<slug>
 *  4. Utilizator autentificat – tenantId din token (req.user.tenantId)
 *
 * Folosire:
 *    const { resolveTenant, optionalTenant } = require('../middleware/tenant');
 *
 *    // Toate rutele dintr-un grup necesită un tenant valid
 *    router.use('/api/restaurant', resolveTenant, restaurantRoutes);
 *
 *    // Tenant opțional – ruta funcționează și fără tenant
 *    router.get('/api/public', optionalTenant, publicController.list);
 *
 * ============================================================
 */

const { AppError } = require('./errorHandler');
const { getTenantConfig, getTenantDb, DEFAULT_TENANT_CONFIG } = require('../config/tenant');
const { tenants } = require('../config/db');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/**
 * Numele header-ului folosit pentru specificarea manuală a tenant-ului.
 * @type {string}
 */
const TENANT_HEADER = 'x-tenant-slug';

/**
 * Numele query parameter-ului pentru specificarea tenant-ului.
 * @type {string}
 */
const TENANT_QUERY_PARAM = 'tenant';

// ---------------------------------------------------------------------------
// Funcții interne
// ---------------------------------------------------------------------------

/**
 * Extrage slug-ul tenant-ului din subdomeniul request-ului.
 * Funcționează doar dacă aplicația este accesată printr-un domeniu
 * care conține subdomenii (ex: tenant1.exemplu.com).
 *
 * @param {Object} req - Obiectul request Express
 * @returns {string|null} Slug-ul tenant-ului sau null dacă nu se poate extrage
 */
function extractFromSubdomain(req) {
  const host = req.headers.host;
  if (!host) return null;

  // Eliminăm portul (ex: "localhost:3000" -> "localhost")
  const hostWithoutPort = host.split(':')[0];

  // Separăm părțile domeniului
  const parts = hostWithoutPort.split('.');

  // Trebuie să avem cel puțin 3 părți pentru a exista un subdomeniu real
  // (ex: tenant.exemplu.com -> parts = ['tenant', 'exemplu', 'com'])
  // Excludem cazul "www" care nu este un tenant
  if (parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'localhost') {
    return parts[0];
  }

  return null;
}

/**
 * Validează slug-ul unui tenant – trebuie să fie un string nevid,
 * format doar din caractere alfanumerice, underscore și cratimă.
 *
 * @param {string} slug - Slug-ul de validat
 * @returns {boolean} `true` dacă slug-ul este valid
 */
function isValidSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  return /^[a-zA-Z0-9_-]+$/.test(slug);
}

/**
 * Caută un tenant în baza de date după slug.
 * Întoarce o promisiune.
 *
 * @param {string} slug - Slug-ul tenant-ului
 * @returns {Promise<Object|null>}
 */
function findTenantBySlug(slug) {
  return new Promise((resolve, reject) => {
    tenants.findOne({ slug }, (err, doc) => {
      if (err) return reject(err);
      resolve(doc || null);
    });
  });
}

// ---------------------------------------------------------------------------
// Funcție principală: identificare tenant
// ---------------------------------------------------------------------------

/**
 * Identifică slug-ul tenant-ului curent pe baza request-ului.
 * Ordinea de încercare:
 *  1. Header-ul X-Tenant-Slug
 *  2. Subdomeniul din host
 *  3. Query param ?tenant=
 *  4. Utilizator autentificat (req.user.tenantId -> slug)
 *
 * @param {Object} req - Obiectul request Express
 * @returns {Promise<string|null>} Slug-ul tenant-ului sau null dacă nu s-a putut identifica
 */
async function identifyTenantSlug(req) {
  let slug = null;

  // -----------------------------------------------------------------------
  // 1. Header X-Tenant-Slug
  // -----------------------------------------------------------------------
  const headerSlug = req.headers[TENANT_HEADER];
  if (headerSlug && isValidSlug(headerSlug)) {
    slug = headerSlug;
  }

  // -----------------------------------------------------------------------
  // 2. Subdomeniu
  // -----------------------------------------------------------------------
  if (!slug) {
    const subdomainSlug = extractFromSubdomain(req);
    if (subdomainSlug && isValidSlug(subdomainSlug)) {
      slug = subdomainSlug;
    }
  }

  // -----------------------------------------------------------------------
  // 3. Query parameter
  // -----------------------------------------------------------------------
  if (!slug) {
    const querySlug = req.query[TENANT_QUERY_PARAM];
    if (querySlug && isValidSlug(querySlug)) {
      slug = querySlug;
    }
  }

  // -----------------------------------------------------------------------
  // 4. Utilizator autentificat
  // -----------------------------------------------------------------------
  if (!slug && req.user && req.user.tenantId) {
    // tenantId poate fi un slug sau un ID; dacă pare slug valid, îl folosim direct
    if (isValidSlug(String(req.user.tenantId))) {
      slug = String(req.user.tenantId);
    } else {
      // Altfel, căutăm tenant-ul după _id
      try {
        const tenantDoc = await new Promise((resolve, reject) => {
          tenants.findOne({ _id: req.user.tenantId }, (err, doc) => {
            if (err) return reject(err);
            resolve(doc || null);
          });
        });
        if (tenantDoc && tenantDoc.slug) {
          slug = tenantDoc.slug;
        }
      } catch (err) {
        // Ignorăm eroarea, slug rămâne null
      }
    }
  }

  return slug;
}

// ---------------------------------------------------------------------------
// Middleware: rezolvare tenant obligatorie
// ---------------------------------------------------------------------------

/**
 * Middleware care identifică tenant-ul curent din request și populează
 * req.tenant și req.tenantDb. Dacă tenant-ul nu poate fi identificat sau
 * nu există, întoarce eroare 404.
 *
 * @param {Object}   req   - Obiectul request Express
 * @param {Object}   res   - Obiectul response Express
 * @param {Function} next  - Următorul middleware
 *
 * @throws {AppError} 404 - dacă tenant-ul nu este găsit sau nu există
 * @throws {AppError} 400 - dacă slug-ul este invalid
 */
async function resolveTenant(req, res, next) {
  try {
    // -----------------------------------------------------------------------
    // 1. Identificare slug tenant
    // -----------------------------------------------------------------------
    const slug = await identifyTenantSlug(req);

    if (!slug) {
      return next(new AppError(
        'Tenant-ul nu a putut fi identificat. Verifică subdomeniul, header-ul X-Tenant-Slug sau parametrul de query.',
        404,
        'TENANT_NOT_IDENTIFIED'
      ));
    }

    // -----------------------------------------------------------------------
    // 2. Validare slug
    // -----------------------------------------------------------------------
    if (!isValidSlug(slug)) {
      return next(new AppError(
        `Slug-ul tenant-ului "${slug}" conține caractere nepermise.`,
        400,
        'TENANT_INVALID_SLUG'
      ));
    }

    // -----------------------------------------------------------------------
    // 3. Verificare existență tenant în baza de date
    // -----------------------------------------------------------------------
    const tenantDoc = await findTenantBySlug(slug);

    if (!tenantDoc) {
      return next(new AppError(
        `Tenant-ul "${slug}" nu a fost găsit.`,
        404,
        'TENANT_NOT_FOUND'
      ));
    }

    // -----------------------------------------------------------------------
    // 4. Populare req.tenant cu datele tenant-ului
    // -----------------------------------------------------------------------
    req.tenant = {
      _id: tenantDoc._id,
      slug: tenantDoc.slug,
      name: tenantDoc.name,
      config: tenantDoc.config || {},
      createdAt: tenantDoc.createdAt,
    };

    // -----------------------------------------------------------------------
    // 5. Populare req.tenantDb cu baza de date dedicată tenant-ului
    // -----------------------------------------------------------------------
    req.tenantDb = getTenantDb(slug);

    // -----------------------------------------------------------------------
    // 6. Adăugăm și configurația completă (cu valori implicite) în req.tenantConfig
    // -----------------------------------------------------------------------
    try {
      req.tenantConfig = await getTenantConfig(slug);
    } catch (configErr) {
      // Dacă getTenantConfig eșuează, folosim config-ul din document
      // îmbinat cu valorile implicite din config/tenant.js
      req.tenantConfig = {
        ...DEFAULT_TENANT_CONFIG,
        ...(tenantDoc.config || {}),
        slug: tenantDoc.slug,
        name: tenantDoc.name,
      };
    }

    next();
  } catch (err) {
    console.error('[tenant] Eroare neașteptată în resolveTenant:', err);
    return next(new AppError(
      'Eroare internă la identificarea tenant-ului.',
      500,
      'TENANT_INTERNAL_ERROR'
    ));
  }
}

// ---------------------------------------------------------------------------
// Middleware: rezolvare tenant opțională
// ---------------------------------------------------------------------------

/**
 * Middleware care încearcă să identifice tenant-ul curent, dar nu blochează
 * request-ul dacă acesta nu poate fi determinat.
 *
 * Utilitate: rute publice sau rute de tip "multi-tenant" unde lipsa
 *            tenant-ului nu împiedică funcționarea de bază.
 *
 * @param {Object}   req   - Obiectul request Express
 * @param {Object}   res   - Obiectul response Express
 * @param {Function} next  - Următorul middleware
 */
async function optionalTenant(req, res, next) {
  try {
    const slug = await identifyTenantSlug(req);

    if (!slug) {
      // Nu există tenant – setăm câmpurile la null și continuăm
      req.tenant = null;
      req.tenantDb = null;
      req.tenantConfig = null;
      return next();
    }

    // Validare slug
    if (!isValidSlug(slug)) {
      req.tenant = null;
      req.tenantDb = null;
      req.tenantConfig = null;
      return next();
    }

    // Căutare tenant în baza de date
    const tenantDoc = await findTenantBySlug(slug);

    if (!tenantDoc) {
      // Tenant-ul nu există – nu blocăm, setăm null
      req.tenant = null;
      req.tenantDb = null;
      req.tenantConfig = null;
      return next();
    }

    // Populare date tenant
    req.tenant = {
      _id: tenantDoc._id,
      slug: tenantDoc.slug,
      name: tenantDoc.name,
      config: tenantDoc.config || {},
      createdAt: tenantDoc.createdAt,
    };

    req.tenantDb = getTenantDb(slug);

    try {
      req.tenantConfig = await getTenantConfig(slug);
    } catch (configErr) {
      req.tenantConfig = {
        ...DEFAULT_TENANT_CONFIG,
        ...(tenantDoc.config || {}),
        slug: tenantDoc.slug,
        name: tenantDoc.name,
      };
    }

    next();
  } catch (err) {
    // Eroare neașteptată – nu blocăm, continuăm cu tenant = null
    console.error('[tenant] Eroare în optionalTenant:', err);
    req.tenant = null;
    req.tenantDb = null;
    req.tenantConfig = null;
    next();
  }
}

// ---------------------------------------------------------------------------
// Middleware: verificare acces tenant (izolare multi-tenant)
// ---------------------------------------------------------------------------

/**
 * Middleware care verifică dacă utilizatorul autentificat are acces la
 * tenant-ul curent. Aceasta asigură izolarea datelor între tenant-i.
 *
 * Reguli:
 *  - super_admin poate accesa orice tenant
 *  - ceilalți utilizatori pot accesa doar tenant-ul din care fac parte
 *
 * @param {Object}   req   - Obiectul request Express (trebuie să aibă req.tenant și req.user)
 * @param {Object}   res   - Obiectul response Express
 * @param {Function} next  - Următorul middleware
 *
 * @throws {AppError} 401 - dacă utilizatorul nu este autentificat
 * @throws {AppError} 403 - dacă utilizatorul nu are acces la tenant
 */
function enforceTenantAccess(req, res, next) {
  // -----------------------------------------------------------------------
  // 1. Verificare autentificare
  // -----------------------------------------------------------------------
  if (!req.user) {
    return next(new AppError(
      'Autentificare necesară pentru această acțiune.',
      401,
      'AUTH_REQUIRED'
    ));
  }

  // -----------------------------------------------------------------------
  // 2. Verificare existență tenant în request
  // -----------------------------------------------------------------------
  if (!req.tenant) {
    return next(new AppError(
      'Tenant-ul nu a fost rezolvat. Asigură-te că middleware-ul resolveTenant este aplicat.',
      400,
      'TENANT_NOT_RESOLVED'
    ));
  }

  // -----------------------------------------------------------------------
  // 3. Super_admin poate accesa orice tenant
  // -----------------------------------------------------------------------
  if (req.user.role === 'super_admin') {
    return next();
  }

  // -----------------------------------------------------------------------
  // 4. Verificare apartenență tenant
  // -----------------------------------------------------------------------
  const userTenantId = String(req.user.tenantId || '');
  const requestTenantId = String(req.tenant._id || '');

  // Verificăm atât după _id cât și după slug
  const userTenantSlug = String(req.user.tenantId || '');
  const requestTenantSlug = String(req.tenant.slug || '');

  if (userTenantId === requestTenantId || userTenantSlug === requestTenantSlug) {
    return next();
  }

  // -----------------------------------------------------------------------
  // 5. Acces interzis
  // -----------------------------------------------------------------------
  return next(new AppError(
    'Acces interzis. Nu ai permisiunea de a accesa datele acestui tenant.',
    403,
    'TENANT_ACCESS_DENIED'
  ));
}

// ---------------------------------------------------------------------------
// Funcție utilitară: obținere slug din request
// ---------------------------------------------------------------------------

/**
 * Extrage slug-ul tenant-ului din request folosind aceleași surse ca
 * resolveTenant. Utilă în rute pentru a verifica sau loga tenant-ul curent.
 *
 * @param {Object} req - Obiectul request Express
 * @returns {Promise<string|null>} Slug-ul tenant-ului sau null
 */
async function getTenantSlugFromRequest(req) {
  return identifyTenantSlug(req);
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Middleware-uri
  resolveTenant,
  optionalTenant,
  enforceTenantAccess,

  // Funcții utilitare
  identifyTenantSlug,
  getTenantSlugFromRequest,
  isValidSlug,
  extractFromSubdomain,

  // Constante
  TENANT_HEADER,
  TENANT_QUERY_PARAM,
};