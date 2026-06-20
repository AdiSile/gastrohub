'use strict';

// ---------------------------------------------------------------------------
// Model Customer – GastroHub
// Model pentru gestionarea clienților și autentificarea portalului.
// Suportă: înregistrare clienți, autentificare portal, gestionare profil,
// istoric comenzi/rezervări, adrese livrare, preferințe.
//
// Backend: exclusiv SQLite (prin getDb() → db.run() / db.prepare() / db.exec()).
// ---------------------------------------------------------------------------

const bcrypt = require('bcryptjs');
const { getDb } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Statusuri valide pentru un client
// ---------------------------------------------------------------------------

const VALID_CUSTOMER_STATUSES = ['active', 'inactive', 'suspended', 'deleted'];

// ---------------------------------------------------------------------------
// Detecție backend SQLite – întotdeauna true (NeDB a fost eliminat)
// ---------------------------------------------------------------------------

/**
 * Returnează `true` – SQLite este singurul backend.
 * @returns {boolean}
 */
function _isSqlAvailable() {
  return true;
}

// ---------------------------------------------------------------------------
// Helpers de conversie rând SQL → document compatibil
// ---------------------------------------------------------------------------

/**
 * Convertește un rând SQL (id INTEGER) într-un obiect cu _id string.
 * Parsează câmpurile JSON: adrese, preferinte.
 * @param {Object} row
 * @returns {Object}
 */
function _sqlRowToDoc(row) {
  if (!row) return row;
  const doc = {};
  const keys = Object.keys(row);
  for (let i = 0; i < keys.length; i++) {
    doc[keys[i]] = row[keys[i]];
  }
  doc._id = String(row.id);

  // Parsează adrese din JSON dacă există
  if (typeof doc.adrese === 'string') {
    try {
      doc.adrese = JSON.parse(doc.adrese);
    } catch (_e) {
      doc.adrese = [];
    }
  }
  if (!Array.isArray(doc.adrese)) {
    doc.adrese = [];
  }

  // Parsează preferinte din JSON dacă există
  if (typeof doc.preferinte === 'string') {
    try {
      doc.preferinte = JSON.parse(doc.preferinte);
    } catch (_e) {
      doc.preferinte = {};
    }
  }
  if (!doc.preferinte || typeof doc.preferinte !== 'object' || Array.isArray(doc.preferinte)) {
    doc.preferinte = {};
  }

  return doc;
}

/**
 * Elimină parola dintr-un document, returnând o copie sigură.
 * @param {Object} doc
 * @returns {Object}
 */
function _stripPassword(doc) {
  if (!doc) return doc;
  const safe = {};
  const keys = Object.keys(doc);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== 'password') {
      safe[keys[i]] = doc[keys[i]];
    }
  }
  return safe;
}

// ---------------------------------------------------------------------------
// Wrappere interne peste sql.js Database
// ---------------------------------------------------------------------------

/**
 * Execută o interogare de tip INSERT/UPDATE/DELETE pe instanța db sql.js.
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {{ changes: number, lastInsertRowid: number }}
 */
function _dbRun(db, sql, params = []) {
  db.run(sql, params);
  const changesRes = db.exec('SELECT changes() AS cnt');
  const lastIdRes = db.exec('SELECT last_insert_rowid() AS id');
  const changes = (changesRes.length > 0 && changesRes[0].values.length > 0)
    ? changesRes[0].values[0][0]
    : 0;
  const lastInsertRowid = (lastIdRes.length > 0 && lastIdRes[0].values.length > 0)
    ? lastIdRes[0].values[0][0]
    : 0;
  return { changes, lastInsertRowid };
}

/**
 * Execută o interogare SELECT și returnează primul rând (obiect) sau undefined.
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Object|undefined}
 */
function _dbGet(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  let row;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

/**
 * Execută o interogare SELECT și returnează toate rândurile ca array de obiecte.
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Array<Object>}
 */
function _dbAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * Execută una sau mai multe instrucțiuni SQL (fără parametri).
 * @param {import('sql.js').Database} db
 * @param {string} sql
 */
function _dbExec(db, sql) {
  db.exec(sql);
}

// ---------------------------------------------------------------------------
// Wrappere Promise pentru bcrypt (callback → Promise)
// ---------------------------------------------------------------------------

/**
 * Hash-uie o parolă cu bcryptjs.
 * @param {string} password
 * @param {number} rounds
 * @returns {Promise<string>}
 */
function _bcryptHash(password, rounds) {
  return new Promise((resolve, reject) => {
    bcrypt.hash(password, rounds, (err, hash) => {
      if (err) return reject(err);
      resolve(hash);
    });
  });
}

/**
 * Compară o parolă în clar cu un hash bcrypt.
 * @param {string} plainPassword
 * @param {string} hashedPassword
 * @returns {Promise<boolean>}
 */
function _bcryptCompare(plainPassword, hashedPassword) {
  return new Promise((resolve, reject) => {
    bcrypt.compare(plainPassword, hashedPassword, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

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
// Operații CRUD – Customers (SQLite)
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
 * @param {string} customerData.tenantId - ID-ul tenant-ului (obligatoriu)
 * @param {string} [customerData.restaurantId] - ID-ul restaurantului preferat
 * @param {string} [customerData.hotelId] - ID-ul hotelului preferat
 * @returns {Promise<Object>} Documentul clientului creat (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
async function createCustomer(customerData) {
  // -----------------------------------------------------------------------
  // Validare date de bază
  // -----------------------------------------------------------------------
  if (!customerData || typeof customerData !== 'object') {
    throw new AppError('Datele clientului sunt invalide.', 400, 'INVALID_CUSTOMER_DATA');
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

  // Validare tenantId
  if (!tenantId) {
    throw new AppError(
      'ID-ul tenant-ului este obligatoriu.',
      400,
      'MISSING_TENANT_ID'
    );
  }

  // Validare email
  if (!email || !isValidEmail(email)) {
    throw new AppError('Adresa de email este invalidă.', 400, 'INVALID_EMAIL');
  }

  // Validare parolă
  if (!password || !isValidPassword(password)) {
    throw new AppError(
      'Parola trebuie să aibă între 6 și 128 de caractere.',
      400,
      'INVALID_PASSWORD'
    );
  }

  // Validare nume
  if (!nume || !isValidString(nume, 2, 200)) {
    throw new AppError(
      'Numele clientului trebuie să aibă între 2 și 200 de caractere.',
      400,
      'INVALID_CUSTOMER_NAME'
    );
  }

  // Validare telefon (opțional)
  const finalTelefon = telefon || '';
  if (finalTelefon && !isValidPhone(finalTelefon)) {
    throw new AppError(
      'Numărul de telefon este invalid.',
      400,
      'INVALID_PHONE'
    );
  }

  // Validare adrese (opțional)
  const finalAdrese = Array.isArray(adrese) ? adrese : [];
  if (finalAdrese.length > 0) {
    for (let i = 0; i < finalAdrese.length; i++) {
      const adresa = finalAdrese[i];
      if (!adresa || typeof adresa !== 'object') {
        throw new AppError(
          `Adresa #${i + 1} este invalidă.`,
          400,
          'INVALID_ADDRESS'
        );
      }
      if (!adresa.denumire || !isValidString(adresa.denumire, 1, 100)) {
        throw new AppError(
          `Adresa #${i + 1}: denumirea este obligatorie (max 100 caractere).`,
          400,
          'INVALID_ADDRESS_NAME'
        );
      }
      if (!adresa.adresa || !isValidString(adresa.adresa, 5, 500)) {
        throw new AppError(
          `Adresa #${i + 1}: adresa completă este obligatorie (min 5, max 500 caractere).`,
          400,
          'INVALID_ADDRESS_FULL'
        );
      }
      if (adresa.oras && !isValidString(adresa.oras, 1, 100)) {
        throw new AppError(
          `Adresa #${i + 1}: orașul poate avea maximum 100 de caractere.`,
          400,
          'INVALID_ADDRESS_CITY'
        );
      }
      if (adresa.codPostal && !isValidString(adresa.codPostal, 1, 20)) {
        throw new AppError(
          `Adresa #${i + 1}: codul poștal poate avea maximum 20 de caractere.`,
          400,
          'INVALID_ADDRESS_ZIP'
        );
      }
      if (adresa.tara && !isValidString(adresa.tara, 1, 100)) {
        throw new AppError(
          `Adresa #${i + 1}: țara poate avea maximum 100 de caractere.`,
          400,
          'INVALID_ADDRESS_COUNTRY'
        );
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
    throw new AppError(
      `Statusul "${finalStatus}" nu este valid. Statusuri permise: ${VALID_CUSTOMER_STATUSES.join(', ')}.`,
      400,
      'INVALID_CUSTOMER_STATUS'
    );
  }

  // -----------------------------------------------------------------------
  // Hash parolă
  // -----------------------------------------------------------------------
  let hashedPassword;
  try {
    hashedPassword = await _bcryptHash(password, 10);
  } catch (hashErr) {
    throw new AppError('Eroare internă la hash-uirea parolei.', 500, 'HASH_ERROR');
  }

  const now = new Date().toISOString();
  const normalizedEmail = email.toLowerCase().trim();
  const finalNume = nume.trim();
  const adreseJson = JSON.stringify(finalAdrese);
  const preferinteJson = JSON.stringify(finalPreferinte);

  // -------------------------------------------------------------------
  // SQLite
  // -------------------------------------------------------------------
  try {
    const db = await getDb();

    // Verificare duplicat email în același tenant
    const existing = _dbGet(
      db,
      'SELECT id FROM customers WHERE email = ? AND tenantId = ?',
      [normalizedEmail, tenantId]
    );
    if (existing) {
      throw new AppError(
        'Există deja un client cu această adresă de email în acest tenant.',
        409,
        'DUPLICATE_EMAIL'
      );
    }

    const result = _dbRun(
      db,
      `INSERT INTO customers
       (email, password, nume, telefon, adrese, preferinte, status, tenantId,
        restaurantId, hotelId, ultimaAutentificare, dataInregistrarii, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        normalizedEmail,
        hashedPassword,
        finalNume,
        finalTelefon,
        adreseJson,
        preferinteJson,
        finalStatus,
        tenantId,
        restaurantId || null,
        hotelId || null,
        now,
        now,
        now,
      ]
    );

    const newId = result.lastInsertRowid;
    const newRow = _dbGet(db, 'SELECT * FROM customers WHERE id = ?', [newId]);
    const doc = _sqlRowToDoc(newRow);
    return _stripPassword(doc);
  } catch (sqlErr) {
    // Duplicat email prins de constraint-ul UNIQUE
    if (sqlErr.message && sqlErr.message.indexOf('UNIQUE') !== -1) {
      throw new AppError(
        'Există deja un client cu această adresă de email în acest tenant.',
        409,
        'DUPLICATE_EMAIL'
      );
    }
    throw new AppError(
      'Eroare la crearea clientului (SQL): ' + sqlErr.message,
      500,
      'DB_INSERT_ERROR'
    );
  }
}

/**
 * Găsește un client după ID.
 * @param {string} id - ID-ul clientului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object|null>} Documentul clientului (cu tot cu password hash) sau null
 */
async function findCustomerById(id, tenantId) {
  if (!id) {
    throw new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const numericId = parseInt(id, 10);
    let row;
    if (isNaN(numericId)) {
      row = _dbGet(
        db,
        'SELECT * FROM customers WHERE CAST(id AS TEXT) = ? AND tenantId = ?',
        [String(id), tenantId]
      );
    } else {
      row = _dbGet(db, 'SELECT * FROM customers WHERE id = ? AND tenantId = ?', [numericId, tenantId]);
    }
    return row ? _sqlRowToDoc(row) : null;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea clientului (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește un client după adresa de email (în cadrul unui tenant).
 * @param {string} email - Adresa de email
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object|null>} Documentul clientului (cu tot cu password hash) sau null
 */
async function findCustomerByEmail(email, tenantId) {
  if (!email || !isValidEmail(email)) {
    throw new AppError('Adresa de email este invalidă.', 400, 'INVALID_EMAIL');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const normalizedEmail = email.toLowerCase().trim();
    const row = _dbGet(
      db,
      'SELECT * FROM customers WHERE email = ? AND tenantId = ?',
      [normalizedEmail, tenantId]
    );
    return row ? _sqlRowToDoc(row) : null;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea clientului după email (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește toți clienții dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni de căutare (sort, limit, skip, status, fields)
 * @returns {Promise<Array>} Lista de clienți (fără password hash)
 */
async function findCustomersByTenant(tenantId, options = {}) {
  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // Filtrare opțională după status
  if (options.status) {
    if (!isValidCustomerStatus(options.status)) {
      throw new AppError(
        `Statusul "${options.status}" nu este valid. Statusuri permise: ${VALID_CUSTOMER_STATUSES.join(', ')}.`,
        400,
        'INVALID_CUSTOMER_STATUS'
      );
    }
  }

  try {
    const db = await getDb();

    // Proiecție câmpuri
    let selectClause = '*';
    if (options.fields && typeof options.fields === 'object') {
      const fieldKeys = Object.keys(options.fields);
      if (fieldKeys.length > 0) {
        selectClause = fieldKeys.join(', ');
      }
    }

    let sql = `SELECT ${selectClause} FROM customers WHERE tenantId = ?`;
    const params = [tenantId];

    if (options.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }

    // Sortare
    if (options.sort && typeof options.sort === 'object') {
      const sortKeys = Object.keys(options.sort);
      if (sortKeys.length > 0) {
        const sortClauses = sortKeys.map((k) => `${k} ${options.sort[k] === -1 ? 'DESC' : 'ASC'}`);
        sql += ' ORDER BY ' + sortClauses.join(', ');
      } else {
        sql += ' ORDER BY dataInregistrarii DESC';
      }
    } else {
      sql += ' ORDER BY dataInregistrarii DESC';
    }

    // Limit
    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    // Offset (skip)
    if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
      sql += ' OFFSET ?';
      params.push(options.skip);
    }

    const rows = _dbAll(db, sql, params);
    const safeCustomers = rows.map((r) => _stripPassword(_sqlRowToDoc(r)));
    return safeCustomers;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea clienților (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Caută clienți după nume (căutare parțială, case-insensitive).
 * @param {string} searchTerm - Termenul de căutare
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>} Lista de clienți găsiți (fără password hash)
 */
async function searchCustomersByName(searchTerm, tenantId) {
  if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
    throw new AppError(
      'Termenul de căutare este invalid.',
      400,
      'INVALID_SEARCH_TERM'
    );
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  try {
    const db = await getDb();
    const rows = _dbAll(
      db,
      'SELECT * FROM customers WHERE tenantId = ? AND nume LIKE ? ORDER BY nume ASC',
      [tenantId, `%${searchTerm.trim()}%`]
    );
    const safeCustomers = rows.map((r) => _stripPassword(_sqlRowToDoc(r)));
    return safeCustomers;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea clienților (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Caută clienți după număr de telefon.
 * @param {string} telefon - Numărul de telefon căutat
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>} Lista de clienți găsiți (fără password hash)
 */
async function searchCustomersByPhone(telefon, tenantId) {
  if (!telefon || !isValidPhone(telefon)) {
    throw new AppError(
      'Numărul de telefon este invalid.',
      400,
      'INVALID_PHONE'
    );
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  try {
    const db = await getDb();
    const rows = _dbAll(
      db,
      'SELECT * FROM customers WHERE tenantId = ? AND telefon = ? ORDER BY nume ASC',
      [tenantId, telefon]
    );
    const safeCustomers = rows.map((r) => _stripPassword(_sqlRowToDoc(r)));
    return safeCustomers;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea clienților după telefon (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Numără clienții dintr-un tenant (opțional filtrat după status).
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {string} [status] - Status opțional pentru filtrare
 * @returns {Promise<number>} Numărul de clienți
 */
async function countCustomers(tenantId, status) {
  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  if (status) {
    if (!isValidCustomerStatus(status)) {
      throw new AppError(
        `Statusul "${status}" nu este valid.`,
        400,
        'INVALID_CUSTOMER_STATUS'
      );
    }
  }

  try {
    const db = await getDb();
    let sql;
    const params = [tenantId];

    if (status) {
      sql = 'SELECT COUNT(*) AS cnt FROM customers WHERE tenantId = ? AND status = ?';
      params.push(status);
    } else {
      sql = 'SELECT COUNT(*) AS cnt FROM customers WHERE tenantId = ?';
    }

    const row = _dbGet(db, sql, params);
    return row ? row.cnt : 0;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la numărarea clienților (SQL): ' + sqlErr.message,
      500,
      'DB_COUNT_ERROR'
    );
  }
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
async function comparePassword(plainPassword, hashedPassword) {
  if (!plainPassword || !hashedPassword) {
    return false;
  }

  try {
    return await _bcryptCompare(plainPassword, hashedPassword);
  } catch (err) {
    throw new AppError('Eroare la verificarea parolei.', 500, 'BCRYPT_ERROR');
  }
}

/**
 * Autentifică un client pe portal (verifică email + parolă).
 * @param {string} email - Adresa de email
 * @param {string} password - Parola în clar
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Clientul autentificat (fără password hash)
 * @throws {AppError} Dacă autentificarea eșuează
 */
async function authenticateCustomer(email, password, tenantId) {
  if (!email || !isValidEmail(email)) {
    throw new AppError('Adresa de email este invalidă.', 400, 'INVALID_EMAIL');
  }

  if (!password || !isValidPassword(password)) {
    throw new AppError(
      'Parola trebuie să aibă între 6 și 128 de caractere.',
      400,
      'INVALID_PASSWORD'
    );
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const db = await getDb();
    const row = _dbGet(
      db,
      'SELECT * FROM customers WHERE email = ? AND tenantId = ?',
      [normalizedEmail, tenantId]
    );

    if (!row) {
      throw new AppError(
        'Email sau parolă incorectă.',
        401,
        'INVALID_CREDENTIALS'
      );
    }

    const customer = _sqlRowToDoc(row);

    // Verificare status
    if (customer.status === 'suspended') {
      throw new AppError(
        'Contul tău a fost suspendat. Contactează administrația.',
        403,
        'ACCOUNT_SUSPENDED'
      );
    }

    if (customer.status === 'deleted') {
      throw new AppError(
        'Contul tău a fost dezactivat.',
        403,
        'ACCOUNT_DELETED'
      );
    }

    // Verificare parolă
    let isMatch;
    try {
      isMatch = await _bcryptCompare(password, customer.password);
    } catch (compareErr) {
      throw new AppError('Eroare la verificarea parolei.', 500, 'BCRYPT_ERROR');
    }

    if (!isMatch) {
      throw new AppError(
        'Email sau parolă incorectă.',
        401,
        'INVALID_CREDENTIALS'
      );
    }

    // Actualizăm ultima autentificare
    const now = new Date().toISOString();
    try {
      const numericId = parseInt(customer._id, 10);
      if (!isNaN(numericId)) {
        _dbRun(
          db,
          'UPDATE customers SET ultimaAutentificare = ?, updatedAt = ? WHERE id = ?',
          [now, now, numericId]
        );
      } else {
        _dbRun(
          db,
          'UPDATE customers SET ultimaAutentificare = ?, updatedAt = ? WHERE CAST(id AS TEXT) = ?',
          [now, now, String(customer._id)]
        );
      }
    } catch (updateErr) {
      // Non-fatal – log doar
      console.error('[customerModel] Eroare la actualizarea ultimei autentificări:', updateErr.message);
    }

    // Returnăm clientul fără parolă
    const safeCustomer = _stripPassword(customer);
    safeCustomer.ultimaAutentificare = now;
    return safeCustomer;
  } catch (sqlErr) {
    // Dacă eroarea este deja un AppError, o propagăm
    if (sqlErr instanceof AppError) {
      throw sqlErr;
    }
    throw new AppError(
      'Eroare la căutarea clientului (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// Operații de actualizare profil
// ---------------------------------------------------------------------------

/**
 * Actualizează profilul unui client (câmpuri permise: nume, telefon, adrese, preferințe).
 * @param {string} id - ID-ul clientului
 * @param {Object} updateData - Câmpurile de actualizat
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Clientul actualizat (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
async function updateCustomerProfile(id, updateData, tenantId) {
  if (!id) {
    throw new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
    throw new AppError(
      'Nu s-au furnizat date pentru actualizare.',
      400,
      'EMPTY_UPDATE_DATA'
    );
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
            setFields.adrese = JSON.stringify(value);
          }
        }
        break;

      case 'preferinte':
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          errors.push('Preferințele trebuie să fie un obiect valid.');
        } else {
          setFields.preferinte = JSON.stringify(value);
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
    throw new AppError(errors.join(' '), 400, 'VALIDATION_ERROR');
  }

  if (Object.keys(setFields).length === 0) {
    throw new AppError(
      'Nu s-au furnizat câmpuri valide pentru actualizare.',
      400,
      'NO_VALID_FIELDS'
    );
  }

  // -----------------------------------------------------------------------
  // Actualizare SQL
  // -----------------------------------------------------------------------
  const now = new Date().toISOString();

  try {
    const db = await getDb();
    const numericId = parseInt(id, 10);

    // Construim interogarea SQL dinamic
    const setClauses = Object.keys(setFields).map((k) => `${k} = ?`);
    setClauses.push('updatedAt = ?');
    const allParams = Object.values(setFields);
    allParams.push(now);

    let result;
    if (!isNaN(numericId)) {
      allParams.push(numericId, tenantId);
      result = _dbRun(
        db,
        `UPDATE customers SET ${setClauses.join(', ')} WHERE id = ? AND tenantId = ?`,
        allParams
      );
    } else {
      allParams.push(String(id), tenantId);
      result = _dbRun(
        db,
        `UPDATE customers SET ${setClauses.join(', ')} WHERE CAST(id AS TEXT) = ? AND tenantId = ?`,
        allParams
      );
    }

    if (result.changes === 0) {
      throw new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND');
    }

    // Returnăm documentul actualizat
    let updatedRow;
    if (!isNaN(numericId)) {
      updatedRow = _dbGet(db, 'SELECT * FROM customers WHERE id = ? AND tenantId = ?', [numericId, tenantId]);
    } else {
      updatedRow = _dbGet(db, 'SELECT * FROM customers WHERE CAST(id AS TEXT) = ? AND tenantId = ?', [String(id), tenantId]);
    }
    return _stripPassword(_sqlRowToDoc(updatedRow));
  } catch (sqlErr) {
    if (sqlErr instanceof AppError) {
      throw sqlErr;
    }
    throw new AppError(
      'Eroare la actualizarea profilului clientului (SQL): ' + sqlErr.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Actualizează parola unui client.
 * @param {string} id - ID-ul clientului
 * @param {string} currentPassword - Parola curentă (pentru verificare)
 * @param {string} newPassword - Noua parolă
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Clientul actualizat (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
async function updateCustomerPassword(id, currentPassword, newPassword, tenantId) {
  if (!id) {
    throw new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  if (!currentPassword) {
    throw new AppError('Parola curentă este obligatorie.', 400, 'MISSING_CURRENT_PASSWORD');
  }

  if (!newPassword || !isValidPassword(newPassword)) {
    throw new AppError(
      'Noua parolă trebuie să aibă între 6 și 128 de caractere.',
      400,
      'INVALID_PASSWORD'
    );
  }

  try {
    const db = await getDb();
    const numericId = parseInt(id, 10);
    let customerRow;
    if (!isNaN(numericId)) {
      customerRow = _dbGet(db, 'SELECT * FROM customers WHERE id = ? AND tenantId = ?', [numericId, tenantId]);
    } else {
      customerRow = _dbGet(db, 'SELECT * FROM customers WHERE CAST(id AS TEXT) = ? AND tenantId = ?', [String(id), tenantId]);
    }

    if (!customerRow) {
      throw new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND');
    }

    const customer = _sqlRowToDoc(customerRow);

    // Verificare parolă curentă
    let isMatch;
    try {
      isMatch = await _bcryptCompare(currentPassword, customer.password);
    } catch (compareErr) {
      throw new AppError('Eroare la verificarea parolei curente.', 500, 'BCRYPT_ERROR');
    }

    if (!isMatch) {
      throw new AppError('Parola curentă este incorectă.', 400, 'WRONG_CURRENT_PASSWORD');
    }

    // Hash parola nouă
    let hashedPassword;
    try {
      hashedPassword = await _bcryptHash(newPassword, 10);
    } catch (hashErr) {
      throw new AppError('Eroare internă la hash-uirea parolei.', 500, 'HASH_ERROR');
    }

    const now = new Date().toISOString();
    let result;
    if (!isNaN(numericId)) {
      result = _dbRun(
        db,
        'UPDATE customers SET password = ?, updatedAt = ? WHERE id = ? AND tenantId = ?',
        [hashedPassword, now, numericId, tenantId]
      );
    } else {
      result = _dbRun(
        db,
        'UPDATE customers SET password = ?, updatedAt = ? WHERE CAST(id AS TEXT) = ? AND tenantId = ?',
        [hashedPassword, now, String(id), tenantId]
      );
    }

    if (result.changes === 0) {
      throw new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND');
    }

    let updatedRow;
    if (!isNaN(numericId)) {
      updatedRow = _dbGet(db, 'SELECT * FROM customers WHERE id = ? AND tenantId = ?', [numericId, tenantId]);
    } else {
      updatedRow = _dbGet(db, 'SELECT * FROM customers WHERE CAST(id AS TEXT) = ? AND tenantId = ?', [String(id), tenantId]);
    }
    return _stripPassword(_sqlRowToDoc(updatedRow));
  } catch (sqlErr) {
    if (sqlErr instanceof AppError) {
      throw sqlErr;
    }
    throw new AppError(
      'Eroare la actualizarea parolei (SQL): ' + sqlErr.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Resetează parola unui client (fără verificare parolă curentă – folosit de admin).
 * @param {string} id - ID-ul clientului
 * @param {string} newPassword - Noua parolă
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Clientul actualizat (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
async function resetCustomerPassword(id, newPassword, tenantId) {
  if (!id) {
    throw new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  if (!newPassword || !isValidPassword(newPassword)) {
    throw new AppError(
      'Parola trebuie să aibă între 6 și 128 de caractere.',
      400,
      'INVALID_PASSWORD'
    );
  }

  let hashedPassword;
  try {
    hashedPassword = await _bcryptHash(newPassword, 10);
  } catch (hashErr) {
    throw new AppError('Eroare internă la hash-uirea parolei.', 500, 'HASH_ERROR');
  }

  try {
    const db = await getDb();
    const numericId = parseInt(id, 10);
    const now = new Date().toISOString();
    let result;
    if (!isNaN(numericId)) {
      result = _dbRun(
        db,
        'UPDATE customers SET password = ?, updatedAt = ? WHERE id = ? AND tenantId = ?',
        [hashedPassword, now, numericId, tenantId]
      );
    } else {
      result = _dbRun(
        db,
        'UPDATE customers SET password = ?, updatedAt = ? WHERE CAST(id AS TEXT) = ? AND tenantId = ?',
        [hashedPassword, now, String(id), tenantId]
      );
    }

    if (result.changes === 0) {
      throw new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND');
    }

    let updatedRow;
    if (!isNaN(numericId)) {
      updatedRow = _dbGet(db, 'SELECT * FROM customers WHERE id = ? AND tenantId = ?', [numericId, tenantId]);
    } else {
      updatedRow = _dbGet(db, 'SELECT * FROM customers WHERE CAST(id AS TEXT) = ? AND tenantId = ?', [String(id), tenantId]);
    }
    return _stripPassword(_sqlRowToDoc(updatedRow));
  } catch (sqlErr) {
    if (sqlErr instanceof AppError) {
      throw sqlErr;
    }
    throw new AppError(
      'Eroare la resetarea parolei (SQL): ' + sqlErr.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Actualizează statusul unui client (activ/inactiv/suspendat/șters).
 * @param {string} id - ID-ul clientului
 * @param {string} newStatus - Noul status
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Clientul actualizat (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
async function updateCustomerStatus(id, newStatus, tenantId) {
  if (!id) {
    throw new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  if (!newStatus || !isValidCustomerStatus(newStatus)) {
    throw new AppError(
      `Statusul "${newStatus}" nu este valid. Statusuri permise: ${VALID_CUSTOMER_STATUSES.join(', ')}.`,
      400,
      'INVALID_CUSTOMER_STATUS'
    );
  }

  try {
    const db = await getDb();
    const numericId = parseInt(id, 10);
    const now = new Date().toISOString();
    let result;
    if (!isNaN(numericId)) {
      result = _dbRun(
        db,
        'UPDATE customers SET status = ?, updatedAt = ? WHERE id = ? AND tenantId = ?',
        [newStatus, now, numericId, tenantId]
      );
    } else {
      result = _dbRun(
        db,
        'UPDATE customers SET status = ?, updatedAt = ? WHERE CAST(id AS TEXT) = ? AND tenantId = ?',
        [newStatus, now, String(id), tenantId]
      );
    }

    if (result.changes === 0) {
      throw new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND');
    }

    let updatedRow;
    if (!isNaN(numericId)) {
      updatedRow = _dbGet(db, 'SELECT * FROM customers WHERE id = ? AND tenantId = ?', [numericId, tenantId]);
    } else {
      updatedRow = _dbGet(db, 'SELECT * FROM customers WHERE CAST(id AS TEXT) = ? AND tenantId = ?', [String(id), tenantId]);
    }
    return _stripPassword(_sqlRowToDoc(updatedRow));
  } catch (sqlErr) {
    if (sqlErr instanceof AppError) {
      throw sqlErr;
    }
    throw new AppError(
      'Eroare la actualizarea statusului clientului (SQL): ' + sqlErr.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Șterge logic un client (soft-delete: setează status = 'deleted').
 * @param {string} id - ID-ul clientului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Clientul marcat ca șters (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
function softDeleteCustomer(id, tenantId) {
  return updateCustomerStatus(id, 'deleted', tenantId);
}

/**
 * Șterge definitiv un client din baza de date.
 * @param {string} id - ID-ul clientului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<boolean>} `true` dacă ștergerea a avut loc
 * @throws {AppError} Dacă validarea eșuează
 */
async function hardDeleteCustomer(id, tenantId) {
  if (!id) {
    throw new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const numericId = parseInt(id, 10);
    let result;
    if (!isNaN(numericId)) {
      result = _dbRun(db, 'DELETE FROM customers WHERE id = ? AND tenantId = ?', [numericId, tenantId]);
    } else {
      result = _dbRun(db, 'DELETE FROM customers WHERE CAST(id AS TEXT) = ? AND tenantId = ?', [String(id), tenantId]);
    }

    if (result.changes === 0) {
      throw new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND');
    }

    return true;
  } catch (sqlErr) {
    if (sqlErr instanceof AppError) {
      throw sqlErr;
    }
    throw new AppError(
      'Eroare la ștergerea clientului (SQL): ' + sqlErr.message,
      500,
      'DB_DELETE_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// Utilitare cross-tenant / relaționale
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un tenant există în tabela `tenants`.
 * @param {string} tenantId - ID-ul tenant-ului (slug)
 * @returns {Promise<boolean>}
 */
async function tenantExists(tenantId) {
  if (!tenantId) {
    return false;
  }

  try {
    const db = await getDb();
    const row = _dbGet(db, 'SELECT 1 FROM tenants WHERE slug = ?', [tenantId]);
    return !!row;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la verificarea tenant-ului (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Obține clienții asociați unui restaurant (util pentru notificări, statistici).
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>} Lista de clienți (fără password hash)
 */
async function findCustomersByRestaurant(restaurantId, tenantId) {
  if (!restaurantId) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const rows = _dbAll(
      db,
      'SELECT * FROM customers WHERE tenantId = ? AND restaurantId = ? ORDER BY nume ASC',
      [tenantId, restaurantId]
    );
    const safeCustomers = rows.map((r) => _stripPassword(_sqlRowToDoc(r)));
    return safeCustomers;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea clienților după restaurant (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Obține clienții asociați unui hotel (util pentru notificări, statistici).
 * @param {string} hotelId - ID-ul hotelului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>} Lista de clienți (fără password hash)
 */
async function findCustomersByHotel(hotelId, tenantId) {
  if (!hotelId) {
    throw new AppError('ID-ul hotelului este invalid.', 400, 'INVALID_HOTEL_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const rows = _dbAll(
      db,
      'SELECT * FROM customers WHERE tenantId = ? AND hotelId = ? ORDER BY nume ASC',
      [tenantId, hotelId]
    );
    const safeCustomers = rows.map((r) => _stripPassword(_sqlRowToDoc(r)));
    return safeCustomers;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea clienților după hotel (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Constante
  VALID_CUSTOMER_STATUSES,

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

  // Expunere pentru testare și debugging
  _isSqlAvailable,
  _sqlRowToDoc,
  _stripPassword,
};