/**
 * ============================================================
 * middleware/roles.js - Middleware de autorizare pe bază de roluri
 * ============================================================
 *
 * Responsabilități:
 *  1. Definește ierarhia și lista de roluri disponibile
 *  2. Oferă middleware-uri pentru protejarea rutelor pe bază de rol
 *  3. Expune funcții utilitare pentru verificarea rolurilor
 *
 * Roluri (ordonate descrescător după nivelul de acces):
 *   super_admin – acces total, poate administra orice tenant
 *   owner       – proprietarul unui restaurant / lanț
 *   manager     – manager operațional
 *   recepție    – personal recepție / front desk
 *   ospătar     – personal service / waiter
 *   bucătar     – personal bucătărie / kitchen
 *   client      – client final / utilizator extern
 *
 * Folosire:
 *    const {
 *      authorize,        // middleware: authorize('admin', 'manager')
 *      authorizeSelf,    // middleware: utilizatorul poate accesa doar propriile resurse
 *      isValidRole,      // funcție: verifică dacă un rol este valid
 *      compareRoles,     // funcție: compară două roluri
 *      hasMinRole,       // funcție: verifică dacă un rol îndeplinește un nivel minim
 *      isStaffRole,      // funcție: verifică dacă rolul este de personal intern
 *      isAdminRole,      // funcție: verifică dacă rolul este administrativ
 *      VALID_ROLES,      // array: lista tuturor rolurilor valide
 *      VALID_EMPLOYEE_ROLES, // array: lista rolurilor de angajat (exclusiv client)
 *      ROLE_HIERARCHY,   // obiect: ierarhia numerică a rolurilor
 *    } = require('../middleware/roles');
 *
 *    // Protejează o rută - doar manager și super_admin
 *    router.get('/admin', authorize('manager'), adminController.dashboard);
 *
 *    // Roluri multiple permise
 *    router.get('/staff', authorize('manager', 'recepție', 'ospătar', 'bucătar'), staffController.list);
 *
 * ============================================================
 */

const { AppError } = require('./errorHandler');

// ---------------------------------------------------------------------------
// Ierarhia rolurilor și constante
// ---------------------------------------------------------------------------

/**
 * Lista tuturor rolurilor valide în sistem.
 * @type {string[]}
 */
const VALID_ROLES = [
  'super_admin',
  'owner',
  'manager',
  'recepție',
  'ospătar',
  'bucătar',
  'client',
];

/**
 * Lista rolurilor valide pentru angajați (fără client).
 * Util în contextul HR și al operațiunilor interne.
 * @type {string[]}
 */
const VALID_EMPLOYEE_ROLES = [
  'super_admin',
  'owner',
  'manager',
  'recepție',
  'ospătar',
  'bucătar',
];

/**
 * Ierarhia rolurilor definită numeric.
 * Cu cât valoarea este mai mare, cu atât nivelul de acces este mai ridicat.
 * @type {Object<string, number>}
 */
const ROLE_HIERARCHY = Object.freeze({
  client:      0,
  bucătar:     1,
  ospătar:     1,
  recepție:    2,
  manager:     3,
  owner:       4,
  super_admin: 5,
});

/**
 * Set de roluri considerate de „staff intern" (personalul unității).
 * @type {Set<string>}
 */
const STAFF_ROLES = new Set(['recepție', 'ospătar', 'bucătar', 'manager', 'owner', 'super_admin']);

/**
 * Set de roluri administrative (pot accesa setări, configurații, rapoarte globale).
 * @type {Set<string>}
 */
const ADMIN_ROLES = new Set(['super_admin', 'owner', 'manager']);

// ---------------------------------------------------------------------------
// Funcții de validare și comparare a rolurilor
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un șir de caractere reprezintă un rol valid din sistem.
 *
 * @param {string} role - Rolul de verificat
 * @returns {boolean} `true` dacă rolul este recunoscut
 */
function isValidRole(role) {
  return VALID_ROLES.includes(role);
}

/**
 * Verifică dacă un rol este un rol de angajat valid.
 *
 * @param {string} role - Rolul de verificat
 * @returns {boolean} `true` dacă rolul este de angajat
 */
function isValidEmployeeRole(role) {
  return VALID_EMPLOYEE_ROLES.includes(role);
}

/**
 * Returnează nivelul numeric al unui rol.
 * Dacă rolul nu este recunoscut, returnează -1 (sub orice nivel).
 *
 * @param {string} role - Rolul de evaluat
 * @returns {number} Nivelul numeric al rolului
 */
function getRoleLevel(role) {
  if (ROLE_HIERARCHY.hasOwnProperty(role)) {
    return ROLE_HIERARCHY[role];
  }
  return -1;
}

/**
 * Compară două roluri din punct de vedere al nivelului de acces.
 *
 * @param {string} roleA - Primul rol
 * @param {string} roleB - Al doilea rol
 * @returns {number} Un număr pozitiv dacă roleA > roleB,
 *                   negativ dacă roleA < roleB, zero dacă sunt egale.
 *                   Dacă unul dintre roluri este invalid, returnează NaN.
 */
function compareRoles(roleA, roleB) {
  const levelA = getRoleLevel(roleA);
  const levelB = getRoleLevel(roleB);

  if (levelA === -1 || levelB === -1) {
    return NaN;
  }

  return levelA - levelB;
}

/**
 * Verifică dacă un utilizator are cel puțin nivelul minim specificat.
 *
 * @param {string} userRole - Rolul utilizatorului
 * @param {string} minRole  - Rolul minim necesar
 * @returns {boolean} `true` dacă userRole >= minRole (ca nivel)
 */
function hasMinRole(userRole, minRole) {
  const level = getRoleLevel(userRole);
  const minLevel = getRoleLevel(minRole);

  if (level === -1 || minLevel === -1) {
    return false;
  }

  return level >= minLevel;
}

/**
 * Verifică dacă un rol aparține personalului intern (staff).
 *
 * @param {string} role - Rolul de verificat
 * @returns {boolean} `true` dacă rolul este de staff
 */
function isStaffRole(role) {
  return STAFF_ROLES.has(role);
}

/**
 * Verifică dacă un rol este unul administrativ.
 *
 * @param {string} role - Rolul de verificat
 * @returns {boolean} `true` dacă rolul este administrativ
 */
function isAdminRole(role) {
  return ADMIN_ROLES.has(role);
}

// ---------------------------------------------------------------------------
// Middleware: autorizare pe bază de rol(uri)
// ---------------------------------------------------------------------------

/**
 * Middleware care verifică dacă utilizatorul autentificat are unul dintre
 * rolurile specificate. Trebuie precedat de middleware-ul `authenticate`.
 *
 * @param {...string} allowedRoles - Unul sau mai multe roluri permise
 * @returns {Function} Middleware Express
 *
 * @throws {AppError} 401 - dacă utilizatorul nu este autentificat
 * @throws {AppError} 403 - dacă utilizatorul nu are rolul necesar
 *
 * Exemplu:
 *    router.get('/admin', authorize('super_admin', 'owner'), controller.adminPage);
 *    router.get('/staff', authorize('manager', 'recepție', 'ospătar', 'bucătar'), controller.staffArea);
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
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
    // 2. Verificare existența rolului utilizatorului
    // -----------------------------------------------------------------------
    if (!req.user.role) {
      return next(new AppError(
        'Contul tău nu are un rol definit.',
        403,
        'ROLE_UNDEFINED'
      ));
    }

    // -----------------------------------------------------------------------
    // 3. Verificare dacă rolul utilizatorului este printre cele permise
    // -----------------------------------------------------------------------
    // super_admin are acces universal (poate accesa orice rută autorizată)
    if (req.user.role === 'super_admin') {
      return next();
    }

    if (allowedRoles.includes(req.user.role)) {
      return next();
    }

    // -----------------------------------------------------------------------
    // 4. Rolul nu este permis
    // -----------------------------------------------------------------------
    return next(new AppError(
      `Acces interzis. Rolul "${req.user.role}" nu are permisiuni pentru această acțiune.`,
      403,
      'FORBIDDEN_ROLE'
    ));
  };
}

// ---------------------------------------------------------------------------
// Middleware: autorizare cu nivel minim de rol
// ---------------------------------------------------------------------------

/**
 * Middleware care verifică dacă utilizatorul are cel puțin un anumit nivel
 * de acces (definit de ierarhia ROLE_HIERARCHY).
 *
 * @param {string} minRole - Rolul minim necesar (ex: 'manager')
 * @returns {Function} Middleware Express
 *
 * @throws {AppError} 401 - dacă utilizatorul nu este autentificat
 * @throws {AppError} 403 - dacă nivelul de acces este insuficient
 *
 * Exemplu:
 *    // Permite accesul oricui are cel puțin nivelul de 'manager'
 *    // (deci manager, owner, super_admin)
 *    router.get('/reports', authorizeMinLevel('manager'), reportsController.list);
 */
function authorizeMinLevel(minRole) {
  return (req, res, next) => {
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
    // 2. Verificare existența rolului
    // -----------------------------------------------------------------------
    if (!req.user.role) {
      return next(new AppError(
        'Contul tău nu are un rol definit.',
        403,
        'ROLE_UNDEFINED'
      ));
    }

    // -----------------------------------------------------------------------
    // 3. Verificare nivel minim
    // -----------------------------------------------------------------------
    if (!hasMinRole(req.user.role, minRole)) {
      return next(new AppError(
        `Acces interzis. Este necesar nivelul minim "${minRole}".`,
        403,
        'INSUFFICIENT_ROLE'
      ));
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Middleware: autorizare pe bază de apartenență (self)
// ---------------------------------------------------------------------------

/**
 * Middleware care verifică dacă utilizatorul autentificat are acces la o
 * resursă pe baza proprietății (self). Poate fi folosit împreună cu rolurile
 * administrative care pot accesa orice resursă.
 *
 * @param {Function} getTargetUserId - Funcție care extrage ID-ul utilizatorului
 *                                       țintă din request (ex: req.params.id)
 * @returns {Function} Middleware Express
 *
 * @throws {AppError} 401 - dacă utilizatorul nu este autentificat
 * @throws {AppError} 403 - dacă utilizatorul nu este proprietarul resursei
 *                           și nu are un rol administrativ
 *
 * Exemplu:
 *    // Utilizatorul poate vedea doar propriul profil, dar adminii văd orice
 *    router.get('/user/:id', authorizeSelf((req) => req.params.id), userController.getProfile);
 */
function authorizeSelf(getTargetUserId) {
  return (req, res, next) => {
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
    // 2. Rolurile administrative (super_admin, owner, manager) pot accesa
    //    orice resursă, indiferent de proprietar
    // -----------------------------------------------------------------------
    if (isAdminRole(req.user.role)) {
      return next();
    }

    // -----------------------------------------------------------------------
    // 3. Pentru celelalte roluri, verificăm apartenența
    // -----------------------------------------------------------------------
    const targetId = getTargetUserId(req);

    if (!targetId) {
      return next(new AppError(
        'ID-ul resursei nu a fost specificat.',
        400,
        'MISSING_TARGET_ID'
      ));
    }

    // Verificăm dacă ID-ul utilizatorului din token (req.user._id)
    // coincide cu ID-ul țintă
    if (String(req.user._id) === String(targetId)) {
      return next();
    }

    // -----------------------------------------------------------------------
    // 4. Utilizatorul nu deține resursa
    // -----------------------------------------------------------------------
    return next(new AppError(
      'Nu ai permisiunea de a accesa această resursă.',
      403,
      'FORBIDDEN_SELF'
    ));
  };
}

// ---------------------------------------------------------------------------
// Middleware: autorizare pe bază de tenant
// ---------------------------------------------------------------------------

/**
 * Middleware care verifică dacă utilizatorul aparține aceluiași tenant
 * ca și resursa accesată. Super_admin poate accesa orice tenant.
 *
 * NOTĂ: Acest middleware presupune că req.tenant a fost populat de
 * middleware-ul de tenant (middleware/tenant.js).
 *
 * @param {Function} getResourceTenantId - Funcție care extrage tenantId-ul
 *                                         resursei din request
 * @returns {Function} Middleware Express
 *
 * @throws {AppError} 401 - dacă utilizatorul nu este autentificat
 * @throws {AppError} 403 - dacă tenant-ul nu corespunde
 *
 * Exemplu:
 *    // Resursa aparține unui tenant specific
 *    router.get('/orders', authorizeTenant((req) => req.params.tenantId), ordersController.list);
 */
function authorizeTenant(getResourceTenantId) {
  return (req, res, next) => {
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
    // 2. Super_admin poate accesa orice tenant
    // -----------------------------------------------------------------------
    if (req.user.role === 'super_admin') {
      return next();
    }

    // -----------------------------------------------------------------------
    // 3. Verificare tenantId al resursei
    // -----------------------------------------------------------------------
    const resourceTenantId = getResourceTenantId(req);

    if (!resourceTenantId) {
      return next(new AppError(
        'Tenant-ul resursei nu a fost specificat.',
        400,
        'MISSING_TENANT_ID'
      ));
    }

    // -----------------------------------------------------------------------
    // 4. Comparare tenant
    // -----------------------------------------------------------------------
    if (String(req.user.tenantId) !== String(resourceTenantId)) {
      return next(new AppError(
        'Acces interzis. Nu aparții tenant-ului acestei resurse.',
        403,
        'TENANT_MISMATCH'
      ));
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Middleware-uri
  authorize,
  authorizeMinLevel,
  authorizeSelf,
  authorizeTenant,

  // Funcții utilitare
  isValidRole,
  isValidEmployeeRole,
  compareRoles,
  hasMinRole,
  isStaffRole,
  isAdminRole,
  getRoleLevel,

  // Constante
  VALID_ROLES,
  VALID_EMPLOYEE_ROLES,
  ROLE_HIERARCHY,
  STAFF_ROLES,
  ADMIN_ROLES,
};