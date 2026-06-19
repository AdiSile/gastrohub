'use strict';

// ---------------------------------------------------------------------------
// Model Customer – GastroHub
// Model pentru gestionarea clienților și autentificarea portalului.
// Suportă: înregistrare clienți, autentificare portal, gestionare profil,
// istoric comenzi/rezervări, adrese livrare, preferințe.
// Câmpuri suportate: email, password (hash), nume, telefon, adrese,
// preferințe, dataÎnregistrării, ultimaAutentificare, status, tenantId,
// type (pentru diferențierea documentelor în DB-ul per-tenant).
//
// Compatibilitate: config/db.js (NeDB + SQLite) și config/tenant.js
// (izolare multi-tenant cu DB per organizație).
// ---------------------------------------------------------------------------

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Configurări externe — compatibilitate cu config/db.js și config/tenant.js
// ---------------------------------------------------------------------------

const { getTenantDb, getTenantConfig, DEFAULT_TENANT_CONFIG } = require('../config/tenant');
const {
  users,
  tenants,
  restaurants,
  hotels,
  reservations,
  inventoryItems,
  inventoryTransactions,
  suppliers,
  deliveries,
  dataDir,
  run,
  get,
  all,
} = require('../config/db');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/** Tipul de document în colecția per-tenant (diferențiere multi-tip). */
const DOC_TYPE = 'customer';

/** Statusuri valide pentru un client */
const VALID_CUSTOMER_STATUSES = ['active', 'inactive', 'suspended', 'deleted'];

/** Cache intern pentru instanțele NeDB per-tenant (complementar celui din config/tenant.js). */
const _customerDbCache = new Map();

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un șir nu este gol și are lungimea între limite.
 * @param {*} val - Valoarea de verificat
 * @param {number} [min=1] - Lungimea minimă
 * @param {number} [max=255] - Lungimea maximă
 * @returns {boolean}
 */
function isValidString(val, min = 1, max = 255) {
  return typeof val === 'string' && val.trim().length >= min && val.trim().length <= max;
}

/**
 * Verifică dacă un șir este o adresă de email validă (format simplu).
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Verifică dacă parola respectă cerințele minime de securitate:
 * - minim 6 caractere
 * - maxim 128 caractere
 * @param {string} password
 * @returns {boolean}
 */
function isValidPassword(password) {
  if (typeof password !== 'string') return false;
  return password.length >= 6 && password.length <= 128;
}

/**
 * Verifică dacă un număr de telefon este valid (format românesc sau internațional simplu).
 * @param {string} telefon
 * @returns {boolean}
 */
function isValidPhone(telefon) {
  if (typeof telefon !== 'string') return false;
  const phoneRegex = /^[+]?[\d\s\-/()]{7,20}$/;
  return phoneRegex.test(telefon.trim());
}

/**
 * Verifică dacă un status de client este valid.
 * @param {string} status
 * @returns {boolean}
 */
function isValidCustomerStatus(status) {
  return VALID_CUSTOMER_STATUSES.includes(status);
}

/**
 * Verifică dacă o valoare este un număr pozitiv.
 * @param {*} val
 * @returns {boolean}
 */
function isValidPositiveNumber(val) {
  return typeof val === 'number' && !Number.isNaN(val) && val >= 0 && Number.isFinite(val);
}

// ---------------------------------------------------------------------------
// Funcții de inițializare a colecției per-tenant
// ---------------------------------------------------------------------------

/**
 * Obține colecția NeDB pentru clienții unui tenant.
 * Folosește baza de date per-tenant din config/tenant.js,
 * adăugând un index pe `email` dacă acesta nu există deja.
 *
 * @param {string} tenantSlug - Identificatorul unic al tenant-ului (slug)
 * @param {boolean} [forceNew=false] - Dacă `true`, ignoră cache-ul local
 * @returns {Datastore} Instanța NeDB pentru acel tenant
 */
function getCustomersDb(tenantSlug, forceNew = false) {
  // Validare parametru
  if (!tenantSlug || typeof tenantSlug !== 'string') {
    throw new Error('[customerModel] getCustomersDb: tenantSlug trebuie să fie un string nevid.');
  }

  // Cache local (complementar cache-ului din config/tenant.js)
  const cacheKey = `customers:${tenantSlug}`;
  if (!forceNew && _customerDbCache.has(cacheKey)) {
    return _customerDbCache.get(cacheKey);
  }

  // Obține instanța per-tenant (delegare către config/tenant.js)
  const db = getTenantDb(tenantSlug, forceNew);

  // Asigură indexarea pe `email` (unicitate în cadrul tenant-ului + tip document)
  db.ensureIndex({ fieldName: 'email', sparse: true }, (err) => {
    if (err) {
      console.error(`[customerModel] Eroare index email pentru ${tenantSlug}:`, err.message);
    }
  });

  // Asigură indexarea pe `type` (diferențiere documente per-tip în DB-ul multi-colecție)
  db.ensureIndex({ fieldName: 'type', sparse: true }, (err) => {
    if (err) {
      console.error(`[customerModel] Eroare index type pentru ${tenantSlug}:`, err.message);
    }
  });

  // Asigură index compus pe tenantId + status pentru căutări rapide
  db.ensureIndex({ fieldName: 'tenantId_status', fieldName: ['tenantId', 'status'] }, (err) => {
    if (err) {
      console.error(`[customerModel] Eroare index tenantId+status pentru ${tenantSlug}:`, err.message);
    }
  });

  _customerDbCache.set(cacheKey, db);
  return db;
}

/**
 * Invalidare cache pentru un tenant (util la ștergerea tenant-ului sau reîncărcare).
 * @param {string} tenantSlug - Identificatorul unic al tenant-ului
 */
function invalidateCustomerDbCache(tenantSlug) {
  const cacheKey = `customers:${tenantSlug}`;
  _customerDbCache.delete(cacheKey);
}

// ---------------------------------------------------------------------------
// Operații CRUD – Customers
// ---------------------------------------------------------------------------

/**
 * Creează un client nou (înregistrare portal).
 * Password-ul este hashuit automat cu bcryptjs (salt rounds: 10).
 *
 * @param {Object} customerData - Datele clientului
 * @param {string} customerData.email - Email unic (obligatoriu)
 * @param {string} customerData.password - Parolă (plain text – va fi hashuită) (obligatoriu)
 * @param {string} customerData.nume - Numele complet (obligatoriu)
 * @param {string} [customerData.telefon=''] - Număr de telefon
 * @param {Array} [customerData.adrese=[]] - Lista de adrese
 * @param {Object} [customerData.preferinte={}] - Preferințe client
 * @param {string} [customerData.status='active'] - Statusul clientului
 * @param {string} customerData.tenantId - ID-ul tenant-ului (obligatoriu) – compatibil și cu tenantSlug
 * @param {string} [customerData.restaurantId] - ID-ul restaurantului preferat
 * @param {string} [customerData.hotelId] - ID-ul hotelului preferat
 * @returns {Promise<Object>} Documentul clientului creat (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
function createCustomer(customerData) {
  return new Promise((resolve, reject) => {
    // -----------------------------------------------------------------------
    // Validare date de bază
    // -----------------------------------------------------------------------
    if (!customerData || typeof customerData !== 'object') {
      return reject(new AppError('Datele clientului sunt invalide.', 400, 'INVALID_CUSTOMER_DATA'));
    }

    const {
      email,
      password,
      nume,
      telefon,
      adrese,
      preferinte,
      status,
      tenantId,
      restaurantId,
      hotelId,
    } = customerData;

    // Validare tenantId (slug)
    if (!tenantId) {
      return reject(new AppError(
        'ID-ul tenant-ului este obligatoriu.',
        400,
        'MISSING_TENANT_ID'
      ));
    }

    // Validare email
    if (!email || !isValidEmail(email)) {
      return reject(new AppError('Adresa de email este invalidă.', 400, 'INVALID_EMAIL'));
    }

    // Validare parolă
    if (!password || !isValidPassword(password)) {
      return reject(new AppError(
        'Parola trebuie să aibă între 6 și 128 de caractere.',
        400,
        'INVALID_PASSWORD'
      ));
    }

    // Validare nume
    if (!nume || !isValidString(nume, 2, 200)) {
      return reject(new AppError(
        'Numele clientului trebuie să aibă între 2 și 200 de caractere.',
        400,
        'INVALID_CUSTOMER_NAME'
      ));
    }

    // Validare telefon (opțional)
    const finalTelefon = telefon || '';
    if (finalTelefon && !isValidPhone(finalTelefon)) {
      return reject(new AppError(
        'Numărul de telefon este invalid.',
        400,
        'INVALID_PHONE'
      ));
    }

    // Validare adrese (opțional)
    const finalAdrese = Array.isArray(adrese) ? adrese : [];
    if (finalAdrese.length > 0) {
      for (let i = 0; i < finalAdrese.length; i++) {
        const adresa = finalAdrese[i];
        if (!adresa || typeof adresa !== 'object') {
          return reject(new AppError(
            `Adresa #${i + 1} este invalidă.`,
            400,
            'INVALID_ADDRESS'
          ));
        }
        if (!adresa.denumire || !isValidString(adresa.denumire, 1, 100)) {
          return reject(new AppError(
            `Adresa #${i + 1}: denumirea este obligatorie (max 100 caractere).`,
            400,
            'INVALID_ADDRESS_NAME'
          ));
        }
        if (!adresa.adresa || !isValidString(adresa.adresa, 5, 500)) {
          return reject(new AppError(
            `Adresa #${i + 1}: adresa completă este obligatorie (min 5, max 500 caractere).`,
            400,
            'INVALID_ADDRESS_FULL'
          ));
        }
        if (adresa.oras && !isValidString(adresa.oras, 1, 100)) {
          return reject(new AppError(
            `Adresa #${i + 1}: orașul poate avea maximum 100 de caractere.`,
            400,
            'INVALID_ADDRESS_CITY'
          ));
        }
        if (adresa.codPostal && !isValidString(adresa.codPostal, 1, 20)) {
          return reject(new AppError(
            `Adresa #${i + 1}: codul poștal poate avea maximum 20 de caractere.`,
            400,
            'INVALID_ADDRESS_ZIP'
          ));
        }
        if (adresa.tara && !isValidString(adresa.tara, 1, 100)) {
          return reject(new AppError(
            `Adresa #${i + 1}: țara poate avea maximum 100 de caractere.`,
            400,
            'INVALID_ADDRESS_COUNTRY'
          ));
        }
      }
    }

    // Validare preferințe (opțional)
    const finalPreferinte = preferinte && typeof preferinte === 'object' && !Array.isArray(preferinte)
      ? preferinte
      : {};

    // Validare status (opțional)
    const finalStatus = status || 'active';
    if (!isValidCustomerStatus(finalStatus)) {
      return reject(new AppError(
        `Statusul "${finalStatus}" nu este valid. Statusuri permise: ${VALID_CUSTOMER_STATUSES.join(', ')}.`,
        400,
        'INVALID_CUSTOMER_STATUS'
      ));
    }

    // -----------------------------------------------------------------------
    // Verificare dacă email-ul există deja în acest tenant
    // -----------------------------------------------------------------------
    const customersDb = getCustomersDb(tenantId);
    customersDb.findOne({ email: email.toLowerCase().trim(), tenantId, type: DOC_TYPE }, (findErr, existingCustomer) => {
      if (findErr) {
        return reject(new AppError(
          `Eroare la verificarea email-ului: ${findErr.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      if (existingCustomer) {
        return reject(new AppError(
          'Există deja un client cu această adresă de email în acest tenant.',
          409,
          'DUPLICATE_EMAIL'
        ));
      }

      // -----------------------------------------------------------------------
      // Hash parolă
      // -----------------------------------------------------------------------
      bcrypt.hash(password, 10, (hashErr, hashedPassword) => {
        if (hashErr) {
          return reject(new AppError('Eroare internă la hash-uirea parolei.', 500, 'HASH_ERROR'));
        }

        // -----------------------------------------------------------------------
        // Creare document client
        // -----------------------------------------------------------------------
        const now = new Date().toISOString();

        const customerDoc = {
          type: DOC_TYPE,
          email: email.toLowerCase().trim(),
          password: hashedPassword,
          nume: nume.trim(),
          telefon: finalTelefon,
          adrese: finalAdrese,
          preferinte: finalPreferinte,
          status: finalStatus,
          tenantId,
          restaurantId: restaurantId || null,
          hotelId: hotelId || null,
          ultimaAutentificare: null,
          dataInregistrarii: now,
          createdAt: now,
          updatedAt: now,
        };

        customersDb.insert(customerDoc, (insertErr, newCustomer) => {
          if (insertErr) {
            return reject(new AppError(
              `Eroare la crearea clientului: ${insertErr.message}`,
              500,
              'DB_INSERT_ERROR'
            ));
          }

          // Returnăm clientul fără parolă
          const safeCustomer = { ...newCustomer };
          delete safeCustomer.password;
          resolve(safeCustomer);
        });
      });
    });
  });
}

/**
 * Găsește un client după ID.
 * @param {string} id - ID-ul NeDB
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<Object|null>} Documentul clientului (cu tot cu password hash) sau null
 */
function findCustomerById(id, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const customersDb = getCustomersDb(tenantId);
    customersDb.findOne({ _id: id, tenantId, type: DOC_TYPE }, (err, customer) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea clientului: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(customer || null);
    });
  });
}

/**
 * Găsește un client după adresa de email (în cadrul unui tenant).
 * @param {string} email - Adresa de email
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<Object|null>} Documentul clientului (cu tot cu password hash) sau null
 */
function findCustomerByEmail(email, tenantId) {
  return new Promise((resolve, reject) => {
    if (!email || !isValidEmail(email)) {
      return reject(new AppError('Adresa de email este invalidă.', 400, 'INVALID_EMAIL'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const customersDb = getCustomersDb(tenantId);
    customersDb.findOne({ email: email.toLowerCase().trim(), tenantId, type: DOC_TYPE }, (err, customer) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea clientului după email: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(customer || null);
    });
  });
}

/**
 * Găsește toți clienții dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @param {Object} [options={}] - Opțiuni de căutare (sort, limit, skip, status, fields)
 * @returns {Promise<Array>} Lista de clienți (fără password hash)
 */
function findCustomersByTenant(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const filter = { tenantId, type: DOC_TYPE };

    // Filtrare opțională după status
    if (options.status) {
      if (!isValidCustomerStatus(options.status)) {
        return reject(new AppError(
          `Statusul "${options.status}" nu este valid. Statusuri permise: ${VALID_CUSTOMER_STATUSES.join(', ')}.`,
          400,
          'INVALID_CUSTOMER_STATUS'
        ));
      }
      filter.status = options.status;
    }

    const customersDb = getCustomersDb(tenantId);
    let query = customersDb.find(filter);

    // Proiecție câmpuri (dacă se specifică)
    if (options.fields && typeof options.fields === 'object') {
      query = query.projection(options.fields);
    }

    // Sortare
    if (options.sort) {
      query = query.sort(options.sort);
    } else {
      query = query.sort({ dataInregistrarii: -1 });
    }

    // Limit
    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      query = query.limit(options.limit);
    }

    // Skip
    if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
      query = query.skip(options.skip);
    }

    query.exec((err, customerList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea clienților: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      // Eliminăm parolele din rezultate
      const safeCustomers = (customerList || []).map((c) => {
        const safe = { ...c };
        delete safe.password;
        return safe;
      });

      resolve(safeCustomers);
    });
  });
}

/**
 * Caută clienți după nume (căutare parțială, case-insensitive).
 * @param {string} searchTerm - Termenul de căutare
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<Array>} Lista de clienți găsiți (fără password hash)
 */
function searchCustomersByName(searchTerm, tenantId) {
  return new Promise((resolve, reject) => {
    if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
      return reject(new AppError(
        'Termenul de căutare este invalid.',
        400,
        'INVALID_SEARCH_TERM'
      ));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const regex = new RegExp(searchTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const customersDb = getCustomersDb(tenantId);
    customersDb.find({ tenantId, type: DOC_TYPE, nume: regex })
      .sort({ nume: 1 })
      .exec((err, customerList) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea clienților: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        const safeCustomers = (customerList || []).map((c) => {
          const safe = { ...c };
          delete safe.password;
          return safe;
        });

        resolve(safeCustomers);
      });
  });
}

/**
 * Caută clienți după număr de telefon.
 * @param {string} telefon - Numărul de telefon căutat
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<Array>} Lista de clienți găsiți (fără password hash)
 */
function searchCustomersByPhone(telefon, tenantId) {
  return new Promise((resolve, reject) => {
    if (!telefon || !isValidPhone(telefon)) {
      return reject(new AppError(
        'Numărul de telefon este invalid.',
        400,
        'INVALID_PHONE'
      ));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const customersDb = getCustomersDb(tenantId);
    customersDb.find({ tenantId, type: DOC_TYPE, telefon })
      .sort({ nume: 1 })
      .exec((err, customerList) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea clienților după telefon: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        const safeCustomers = (customerList || []).map((c) => {
          const safe = { ...c };
          delete safe.password;
          return safe;
        });

        resolve(safeCustomers);
      });
  });
}

/**
 * Numără clienții dintr-un tenant (opțional filtrat după status).
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @param {string} [status] - Status opțional pentru filtrare
 * @returns {Promise<number>} Numărul de clienți
 */
function countCustomers(tenantId, status) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const filter = { tenantId, type: DOC_TYPE };
    if (status) {
      if (!isValidCustomerStatus(status)) {
        return reject(new AppError(
          `Statusul "${status}" nu este valid.`,
          400,
          'INVALID_CUSTOMER_STATUS'
        ));
      }
      filter.status = status;
    }

    const customersDb = getCustomersDb(tenantId);
    customersDb.count(filter, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea clienților: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(count);
    });
  });
}

// ---------------------------------------------------------------------------
// Operații de autentificare portal
// ---------------------------------------------------------------------------

/**
 * Verifică dacă o parolă corespunde hash-ului stocat.
 * @param {string} plainPassword - Parola în clar
 * @param {string} hashedPassword - Hash-ul stocat
 * @returns {Promise<boolean>}
 */
function comparePassword(plainPassword, hashedPassword) {
  return new Promise((resolve, reject) => {
    if (!plainPassword || !hashedPassword) {
      return resolve(false);
    }

    bcrypt.compare(plainPassword, hashedPassword, (err, result) => {
      if (err) {
        return reject(new AppError('Eroare la verificarea parolei.', 500, 'BCRYPT_ERROR'));
      }
      resolve(result);
    });
  });
}

/**
 * Autentifică un client pe portal (verifică email + parolă).
 * @param {string} email - Adresa de email
 * @param {string} password - Parola în clar
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<Object>} Clientul autentificat (fără password hash)
 * @throws {AppError} Dacă autentificarea eșuează
 */
function authenticateCustomer(email, password, tenantId) {
  return new Promise((resolve, reject) => {
    if (!email || !isValidEmail(email)) {
      return reject(new AppError('Adresa de email este invalidă.', 400, 'INVALID_EMAIL'));
    }

    if (!password || !isValidPassword(password)) {
      return reject(new AppError(
        'Parola trebuie să aibă între 6 și 128 de caractere.',
        400,
        'INVALID_PASSWORD'
      ));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const customersDb = getCustomersDb(tenantId);
    customersDb.findOne({ email: email.toLowerCase().trim(), tenantId, type: DOC_TYPE }, (err, customer) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea clientului: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      if (!customer) {
        return reject(new AppError(
          'Email sau parolă incorectă.',
          401,
          'INVALID_CREDENTIALS'
        ));
      }

      // Verificare status
      if (customer.status === 'suspended') {
        return reject(new AppError(
          'Contul tău a fost suspendat. Contactează administrația.',
          403,
          'ACCOUNT_SUSPENDED'
        ));
      }

      if (customer.status === 'deleted') {
        return reject(new AppError(
          'Contul tău a fost dezactivat.',
          403,
          'ACCOUNT_DELETED'
        ));
      }

      // Verificare parolă
      bcrypt.compare(password, customer.password, (compareErr, isMatch) => {
        if (compareErr) {
          return reject(new AppError('Eroare la verificarea parolei.', 500, 'BCRYPT_ERROR'));
        }

        if (!isMatch) {
          return reject(new AppError(
            'Email sau parolă incorectă.',
            401,
            'INVALID_CREDENTIALS'
          ));
        }

        // Actualizăm ultima autentificare
        const now = new Date().toISOString();
        customersDb.update(
          { _id: customer._id, type: DOC_TYPE },
          { $set: { ultimaAutentificare: now, updatedAt: now } },
          {},
          (updateErr) => {
            if (updateErr) {
              // Non-fatal – log doar
              console.error('[customerModel] Eroare la actualizarea ultimei autentificări:', updateErr.message);
            }
          }
        );

        // Returnăm clientul fără parolă
        const safeCustomer = { ...customer };
        delete safeCustomer.password;
        safeCustomer.ultimaAutentificare = now;
        resolve(safeCustomer);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Operații de actualizare profil
// ---------------------------------------------------------------------------

/**
 * Actualizează profilul unui client (câmpuri permise: nume, telefon, adrese, preferințe).
 * @param {string} id - ID-ul clientului
 * @param {Object} updateData - Câmpurile de actualizat
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<Object>} Clientul actualizat (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
function updateCustomerProfile(id, updateData, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
      return reject(new AppError(
        'Nu s-au furnizat date pentru actualizare.',
        400,
        'EMPTY_UPDATE_DATA'
      ));
    }

    // -----------------------------------------------------------------------
    // Câmpuri permise pentru actualizare
    // -----------------------------------------------------------------------
    const allowedFields = ['nume', 'telefon', 'adrese', 'preferinte', 'restaurantId', 'hotelId'];
    const setFields = {};
    const errors = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (!allowedFields.includes(key)) {
        continue; // Ignorăm câmpurile nepermise
      }

      switch (key) {
        case 'nume':
          if (!isValidString(value, 2, 200)) {
            errors.push('Numele clientului trebuie să aibă între 2 și 200 de caractere.');
          } else {
            setFields.nume = value.trim();
          }
          break;

        case 'telefon':
          if (value && !isValidPhone(value)) {
            errors.push('Numărul de telefon este invalid.');
          } else {
            setFields.telefon = value || '';
          }
          break;

        case 'adrese':
          if (!Array.isArray(value)) {
            errors.push('Adresele trebuie să fie o listă.');
          } else {
            const adreseErrors = [];
            for (let i = 0; i < value.length; i++) {
              const adresa = value[i];
              if (!adresa || typeof adresa !== 'object') {
                adreseErrors.push(`Adresa #${i + 1} este invalidă.`);
                continue;
              }
              if (!adresa.denumire || !isValidString(adresa.denumire, 1, 100)) {
                adreseErrors.push(`Adresa #${i + 1}: denumirea este obligatorie (max 100 caractere).`);
              }
              if (!adresa.adresa || !isValidString(adresa.adresa, 5, 500)) {
                adreseErrors.push(`Adresa #${i + 1}: adresa completă este obligatorie (min 5, max 500 caractere).`);
              }
              if (adresa.oras && !isValidString(adresa.oras, 1, 100)) {
                adreseErrors.push(`Adresa #${i + 1}: orașul poate avea maximum 100 de caractere.`);
              }
              if (adresa.codPostal && !isValidString(adresa.codPostal, 1, 20)) {
                adreseErrors.push(`Adresa #${i + 1}: codul poștal poate avea maximum 20 de caractere.`);
              }
              if (adresa.tara && !isValidString(adresa.tara, 1, 100)) {
                adreseErrors.push(`Adresa #${i + 1}: țara poate avea maximum 100 de caractere.`);
              }
            }
            if (adreseErrors.length > 0) {
              errors.push(adreseErrors.join(' '));
            } else {
              setFields.adrese = value;
            }
          }
          break;

        case 'preferinte':
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            errors.push('Preferințele trebuie să fie un obiect valid.');
          } else {
            setFields.preferinte = value;
          }
          break;

        case 'restaurantId':
          setFields.restaurantId = value || null;
          break;

        case 'hotelId':
          setFields.hotelId = value || null;
          break;

        // No default
      }
    }

    if (errors.length > 0) {
      return reject(new AppError(errors.join(' '), 400, 'VALIDATION_ERROR'));
    }

    if (Object.keys(setFields).length === 0) {
      return reject(new AppError(
        'Nu s-au furnizat câmpuri valide pentru actualizare.',
        400,
        'NO_VALID_FIELDS'
      ));
    }

    // -----------------------------------------------------------------------
    // Actualizare document
    // -----------------------------------------------------------------------
    setFields.updatedAt = new Date().toISOString();

    const customersDb = getCustomersDb(tenantId);
    customersDb.update(
      { _id: id, tenantId, type: DOC_TYPE },
      { $set: setFields },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedCustomer) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea profilului clientului: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND'));
        }

        const safeCustomer = { ...updatedCustomer };
        delete safeCustomer.password;
        resolve(safeCustomer);
      }
    );
  });
}

/**
 * Actualizează parola unui client.
 * @param {string} id - ID-ul clientului
 * @param {string} currentPassword - Parola curentă (pentru verificare)
 * @param {string} newPassword - Noua parolă
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<Object>} Clientul actualizat (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
function updateCustomerPassword(id, currentPassword, newPassword, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    if (!currentPassword) {
      return reject(new AppError('Parola curentă este obligatorie.', 400, 'MISSING_CURRENT_PASSWORD'));
    }

    if (!newPassword || !isValidPassword(newPassword)) {
      return reject(new AppError(
        'Noua parolă trebuie să aibă între 6 și 128 de caractere.',
        400,
        'INVALID_PASSWORD'
      ));
    }

    const customersDb = getCustomersDb(tenantId);
    customersDb.findOne({ _id: id, tenantId, type: DOC_TYPE }, (findErr, customer) => {
      if (findErr) {
        return reject(new AppError(
          `Eroare la căutarea clientului: ${findErr.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      if (!customer) {
        return reject(new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND'));
      }

      // Verificare parolă curentă
      bcrypt.compare(currentPassword, customer.password, (compareErr, isMatch) => {
        if (compareErr) {
          return reject(new AppError('Eroare la verificarea parolei curente.', 500, 'BCRYPT_ERROR'));
        }

        if (!isMatch) {
          return reject(new AppError('Parola curentă este incorectă.', 400, 'WRONG_CURRENT_PASSWORD'));
        }

        // Hash parola nouă
        bcrypt.hash(newPassword, 10, (hashErr, hashedPassword) => {
          if (hashErr) {
            return reject(new AppError('Eroare internă la hash-uirea parolei.', 500, 'HASH_ERROR'));
          }

          customersDb.update(
            { _id: id, type: DOC_TYPE },
            {
              $set: {
                password: hashedPassword,
                updatedAt: new Date().toISOString(),
              },
            },
            { returnUpdatedDocs: true },
            (updateErr, numUpdated, updatedCustomer) => {
              if (updateErr) {
                return reject(new AppError(
                  `Eroare la actualizarea parolei: ${updateErr.message}`,
                  500,
                  'DB_UPDATE_ERROR'
                ));
              }

              if (numUpdated === 0) {
                return reject(new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND'));
              }

              const safeCustomer = { ...updatedCustomer };
              delete safeCustomer.password;
              resolve(safeCustomer);
            }
          );
        });
      });
    });
  });
}

/**
 * Resetează parola unui client (fără verificare parolă curentă – folosit de admin).
 * @param {string} id - ID-ul clientului
 * @param {string} newPassword - Noua parolă
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<Object>} Clientul actualizat (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
function resetCustomerPassword(id, newPassword, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    if (!newPassword || !isValidPassword(newPassword)) {
      return reject(new AppError(
        'Parola trebuie să aibă între 6 și 128 de caractere.',
        400,
        'INVALID_PASSWORD'
      ));
    }

    bcrypt.hash(newPassword, 10, (hashErr, hashedPassword) => {
      if (hashErr) {
        return reject(new AppError('Eroare internă la hash-uirea parolei.', 500, 'HASH_ERROR'));
      }

      const customersDb = getCustomersDb(tenantId);
      customersDb.update(
        { _id: id, tenantId, type: DOC_TYPE },
        {
          $set: {
            password: hashedPassword,
            updatedAt: new Date().toISOString(),
          },
        },
        { returnUpdatedDocs: true },
        (updateErr, numUpdated, updatedCustomer) => {
          if (updateErr) {
            return reject(new AppError(
              `Eroare la resetarea parolei: ${updateErr.message}`,
              500,
              'DB_UPDATE_ERROR'
            ));
          }

          if (numUpdated === 0) {
            return reject(new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND'));
          }

          const safeCustomer = { ...updatedCustomer };
          delete safeCustomer.password;
          resolve(safeCustomer);
        }
      );
    });
  });
}

/**
 * Actualizează statusul unui client (activ/inactiv/suspendat/șters).
 * @param {string} id - ID-ul clientului
 * @param {string} newStatus - Noul status
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<Object>} Clientul actualizat (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
function updateCustomerStatus(id, newStatus, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    if (!newStatus || !isValidCustomerStatus(newStatus)) {
      return reject(new AppError(
        `Statusul "${newStatus}" nu este valid. Statusuri permise: ${VALID_CUSTOMER_STATUSES.join(', ')}.`,
        400,
        'INVALID_CUSTOMER_STATUS'
      ));
    }

    const customersDb = getCustomersDb(tenantId);
    const now = new Date().toISOString();

    customersDb.update(
      { _id: id, tenantId, type: DOC_TYPE },
      {
        $set: {
          status: newStatus,
          updatedAt: now,
        },
      },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedCustomer) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea statusului clientului: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND'));
        }

        const safeCustomer = { ...updatedCustomer };
        delete safeCustomer.password;
        resolve(safeCustomer);
      }
    );
  });
}

/**
 * Șterge logic un client (soft-delete: setează status = 'deleted').
 * @param {string} id - ID-ul clientului
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<Object>} Clientul marcat ca șters (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
function softDeleteCustomer(id, tenantId) {
  return updateCustomerStatus(id, 'deleted', tenantId);
}

/**
 * Șterge definitiv un client din baza de date.
 * @param {string} id - ID-ul clientului
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<boolean>} `true` dacă ștergerea a avut loc
 * @throws {AppError} Dacă validarea eșuează
 */
function hardDeleteCustomer(id, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const customersDb = getCustomersDb(tenantId);
    customersDb.remove({ _id: id, tenantId, type: DOC_TYPE }, {}, (err, numRemoved) => {
      if (err) {
        return reject(new AppError(
          `Eroare la ștergerea clientului: ${err.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      if (numRemoved === 0) {
        return reject(new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND'));
      }

      // Curățare cache local după ștergere
      invalidateCustomerDbCache(tenantId);
      resolve(true);
    });
  });
}

// ---------------------------------------------------------------------------
// Utilitare cross-tenant (folosesc config/db.js pentru referințe globale)
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un tenant există în colecția globală `tenants`.
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<boolean>}
 */
function tenantExists(tenantId) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return resolve(false);
    }
    tenants.findOne({ slug: tenantId }, (err, doc) => {
      if (err) {
        return reject(new AppError(
          `Eroare la verificarea tenant-ului: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(!!doc);
    });
  });
}

/**
 * Obține clienții asociați unui restaurant (util pentru notificări, statistici).
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<Array>} Lista de clienți (fără password hash)
 */
function findCustomersByRestaurant(restaurantId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!restaurantId) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const customersDb = getCustomersDb(tenantId);
    customersDb.find({ tenantId, type: DOC_TYPE, restaurantId })
      .sort({ nume: 1 })
      .exec((err, customerList) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea clienților după restaurant: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        const safeCustomers = (customerList || []).map((c) => {
          const safe = { ...c };
          delete safe.password;
          return safe;
        });

        resolve(safeCustomers);
      });
  });
}

/**
 * Obține clienții asociați unui hotel (util pentru notificări, statistici).
 * @param {string} hotelId - ID-ul hotelului
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<Array>} Lista de clienți (fără password hash)
 */
function findCustomersByHotel(hotelId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!hotelId) {
      return reject(new AppError('ID-ul hotelului este invalid.', 400, 'INVALID_HOTEL_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const customersDb = getCustomersDb(tenantId);
    customersDb.find({ tenantId, type: DOC_TYPE, hotelId })
      .sort({ nume: 1 })
      .exec((err, customerList) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea clienților după hotel: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        const safeCustomers = (customerList || []).map((c) => {
          const safe = { ...c };
          delete safe.password;
          return safe;
        });

        resolve(safeCustomers);
      });
  });
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Constante
  VALID_CUSTOMER_STATUSES,
  DOC_TYPE,

  // Conexiune / cache
  getCustomersDb,
  invalidateCustomerDbCache,

  // CRUD
  createCustomer,
  findCustomerById,
  findCustomerByEmail,
  findCustomersByTenant,
  searchCustomersByName,
  searchCustomersByPhone,
  countCustomers,

  // Autentificare
  comparePassword,
  authenticateCustomer,

  // Actualizări
  updateCustomerProfile,
  updateCustomerPassword,
  resetCustomerPassword,
  updateCustomerStatus,

  // Ștergere
  softDeleteCustomer,
  hardDeleteCustomer,

  // Cross-tenant / relațional
  tenantExists,
  findCustomersByRestaurant,
  findCustomersByHotel,

  // Validatori (expuși pentru teste și reutilizare)
  isValidString,
  isValidEmail,
  isValidPassword,
  isValidPhone,
  isValidCustomerStatus,
  isValidPositiveNumber,
};