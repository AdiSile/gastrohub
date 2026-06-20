**Modificări în `createUser`:**
1. Se extrag `name` și `phone` din `userData`
2. `name` – opțional, dacă e string nevid se trimite la INSERT, altfel `null`
3. `phone` – opțional, validat prin noua funcție `isValidPhone` (acceptă 7-20 caractere: cifre, spații, `+`, `-`, paranteze)
4. INSERT-ul include acum coloanele `name` și `phone`
5. S-a adăugat funcția `isValidPhone` (exportată)
6. JSDoc-ul a fost actualizat pentru a documenta noii parametri
7. Comentariul header listează acum `name` și `phone` printre câmpurile suportate

---

### config/db.js

**Modificări în schema `users`:**
1. `CREATE TABLE` include acum coloanele: `phone TEXT`, `restaurante TEXT DEFAULT '[]'`, `updated_at TEXT`
2. S-a adăugat funcția `_applyMigrations()` care rulează `ALTER TABLE ADD COLUMN` pentru bazele de date existente (cu `try/catch` pentru a ignora erorile de coloană deja existentă)
3. Migrările se aplică după `CREATE TABLE IF NOT EXISTS`, asigurând compatibilitatea atât cu baze noi cât și cu cele vechi

---

### models/userModel.js
'use strict';

// ---------------------------------------------------------------------------
// Model User – GastroHub
// Definirea structurii, validărilor și operațiilor comune pentru un utilizator.
// Câmpuri suportate: email, password (hash), role, name, phone, tenant_id,
// restaurante asociate, created_at, updated_at
//
// Backend: exclusiv SQLite (prin getDb() din config/db, folosind db.run() / db.exec()).
// ---------------------------------------------------------------------------

const bcrypt = require('bcryptjs');
const { getDb } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Roluri valide în sistem
// ---------------------------------------------------------------------------

const VALID_ROLES = [
  'super_admin',
  'owner',
  'manager',
  'recepție',
  'ospătar',
  'bucătar',
  'client',
];

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
// Helpers de conversie rând SQL → document
// ---------------------------------------------------------------------------

/**
 * Convertește un rând SQL (id INTEGER) într-un obiect cu _id string.
 * Normalizează coloanele snake_case din SQL la camelCase în documentul returnat.
 * @param {Object} row
 * @returns {Object}
 */
function _sqlRowToDoc(row) {
  if (!row) return row;
  var doc = {};
  var keys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var camelKey = _snakeToCamel(key);
    doc[camelKey] = row[key];
  }
  doc._id = String(row.id);
  // Parsează restaurante din JSON dacă există
  if (typeof doc.restaurante === 'string') {
    try {
      doc.restaurante = JSON.parse(doc.restaurante);
    } catch (_e) {
      doc.restaurante = [];
    }
  }
  if (!Array.isArray(doc.restaurante)) {
    doc.restaurante = [];
  }
  return doc;
}

/**
 * Convertește un nume de coloană din snake_case în camelCase.
 * @param {string} str
 * @returns {string}
 */
function _snakeToCamel(str) {
  return str.replace(/_([a-z])/g, function (_, letter) {
    return letter.toUpperCase();
  });
}

/**
 * Elimină parola dintr-un document, returnând o copie sigură.
 * @param {Object} doc
 * @returns {Object}
 */
function _stripPassword(doc) {
  if (!doc) return doc;
  var safe = {};
  var keys = Object.keys(doc);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] !== 'password') {
      safe[keys[i]] = doc[keys[i]];
    }
  }
  return safe;
}

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un șir este o adresă de email validă (format simplu).
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  // Regex simplu pentru validare email
  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Verifică dacă un rol este valid.
 * @param {string} role
 * @returns {boolean}
 */
function isValidRole(role) {
  return VALID_ROLES.includes(role);
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
 * Verifică dacă un număr de telefon are un format rezonabil (opțional).
 * Acceptă șiruri care conțin între 7 și 20 de caractere (cifre, spații, +, -, paranteze).
 * @param {string} phone
 * @returns {boolean}
 */
function isValidPhone(phone) {
  if (typeof phone !== 'string') return false;
  var cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
  return cleaned.length >= 7 && cleaned.length <= 20 && /^\+?[\d\s\-\(\)]+$/.test(phone);
}

// ---------------------------------------------------------------------------
// Helpers pentru promisificare bcrypt
// ---------------------------------------------------------------------------

/**
 * Hash-uiește o parolă cu bcrypt (promisificat).
 * @param {string} password
 * @param {number} [rounds=10]
 * @returns {Promise<string>}
 */
function _bcryptHash(password, rounds) {
  return new Promise(function (resolve, reject) {
    bcrypt.hash(password, rounds || 10, function (err, hash) {
      if (err) return reject(err);
      resolve(hash);
    });
  });
}

/**
 * Compară o parolă cu un hash bcrypt (promisificat).
 * @param {string} plainPassword
 * @param {string} hashedPassword
 * @returns {Promise<boolean>}
 */
function _bcryptCompare(plainPassword, hashedPassword) {
  return new Promise(function (resolve, reject) {
    bcrypt.compare(plainPassword, hashedPassword, function (err, result) {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

// ---------------------------------------------------------------------------
// Operații pe utilizatori – exclusiv SQLite
// ---------------------------------------------------------------------------

// =========================== createUser ====================================

/**
 * Creează un utilizator nou în baza de date.
 * Password-ul este hashuit automat cu bcryptjs (salt rounds: 10).
 *
 * @param {Object} userData - Datele utilizatorului
 * @param {string} userData.email - Email unic
 * @param {string} userData.password - Parolă (plain text – va fi hashuită)
 * @param {string} [userData.role='client'] - Rolul utilizatorului
 * @param {string} [userData.name] - Numele afișat al utilizatorului (opțional)
 * @param {string} [userData.phone] - Numărul de telefon (opțional)
 * @param {string|null} [userData.tenantId=null] - ID-ul tenant-ului
 * @param {Array} [userData.restaurante=[]] - Listă de ID-uri restaurante asociate
 * @returns {Promise<Object>} Documentul utilizatorului (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
async function createUser(userData) {
  // -----------------------------------------------------------------------
  // Validare câmpuri obligatorii
  // -----------------------------------------------------------------------
  if (!userData || typeof userData !== 'object') {
    throw new AppError('Datele utilizatorului sunt invalide.', 400, 'INVALID_USER_DATA');
  }

  var email = userData.email;
  var password = userData.password;
  var role = userData.role;
  var tenantId = userData.tenantId;
  var restaurante = userData.restaurante;
  var name = userData.name;
  var phone = userData.phone;

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

  // Validare rol
  var finalRole = role || 'client';
  if (!isValidRole(finalRole)) {
    throw new AppError('Rolul "' + finalRole + '" nu este valid.', 400, 'INVALID_ROLE');
  }

  // Validare tenantId – poate fi null, string sau number
  var finalTenantId = tenantId !== undefined ? tenantId : null;

  // Validare restaurante – trebuie să fie array
  var finalRestaurante = Array.isArray(restaurante) ? restaurante : [];

  // Validare name – opțional, dar dacă e transmis trebuie să fie string nevid
  var finalName = (typeof name === 'string' && name.trim().length > 0) ? name.trim() : null;

  // Validare phone – opțional, dar dacă e transmis trebuie să respecte formatul
  var finalPhone = null;
  if (typeof phone === 'string' && phone.trim().length > 0) {
    if (!isValidPhone(phone.trim())) {
      throw new AppError(
        'Numărul de telefon este invalid. Format acceptat: +40712345678.',
        400,
        'INVALID_PHONE'
      );
    }
    finalPhone = phone.trim();
  }

  // -----------------------------------------------------------------------
  // Hash parolă
  // -----------------------------------------------------------------------
  var hashedPassword;
  try {
    hashedPassword = await _bcryptHash(password, 10);
  } catch (hashErr) {
    throw new AppError('Eroare internă la hash-uirea parolei.', 500, 'HASH_ERROR');
  }

  var now = new Date().toISOString();
  var normalizedEmail = email.toLowerCase().trim();

  // -------------------------------------------------------------------
  // SQLite
  // -------------------------------------------------------------------
  try {
    var db = await getDb();

    // Verificare duplicat email
    var checkStmt = db.prepare('SELECT id FROM users WHERE email = ?');
    checkStmt.bind([normalizedEmail]);
    var existing = checkStmt.step() ? checkStmt.getAsObject() : undefined;
    checkStmt.free();

    if (existing) {
      throw new AppError(
        'Există deja un cont cu această adresă de email.',
        409,
        'DUPLICATE_EMAIL'
      );
    }

    var restauranteJson = JSON.stringify(finalRestaurante);
    db.run(
      'INSERT INTO users (email, password, role, name, phone, tenant_id, restaurante, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [normalizedEmail, hashedPassword, finalRole, finalName, finalPhone, finalTenantId, restauranteJson, now, now]
    );

    var metaResult = db.exec('SELECT last_insert_rowid() AS id');
    var newId = metaResult[0].values[0][0];

    var fetchStmt = db.prepare('SELECT * FROM users WHERE id = ?');
    fetchStmt.bind([newId]);
    var newRow = fetchStmt.step() ? fetchStmt.getAsObject() : undefined;
    fetchStmt.free();

    var doc = _sqlRowToDoc(newRow);
    return _stripPassword(doc);
  } catch (sqlErr) {
    // Duplicat email prins de constraint-ul UNIQUE
    if (sqlErr.message && sqlErr.message.indexOf('UNIQUE') !== -1) {
      throw new AppError(
        'Există deja un cont cu această adresă de email.',
        409,
        'DUPLICATE_EMAIL'
      );
    }
    throw new AppError(
      'Eroare la crearea utilizatorului (SQL): ' + sqlErr.message,
      500,
      'DB_INSERT_ERROR'
    );
  }
}

// ========================= findUserByEmail ==================================

/**
 * Găsește un utilizator după adresa de email.
 * @param {string} email
 * @returns {Promise<Object|null>} Documentul utilizatorului (cu tot cu password hash) sau null
 */
async function findUserByEmail(email) {
  if (!email || !isValidEmail(email)) {
    throw new AppError('Adresa de email este invalidă.', 400, 'INVALID_EMAIL');
  }

  var normalizedEmail = email.toLowerCase().trim();

  try {
    var db = await getDb();
    var stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    stmt.bind([normalizedEmail]);
    var row;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();
    return row ? _sqlRowToDoc(row) : null;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea utilizatorului (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ========================== findUserById ====================================

/**
 * Găsește un utilizator după ID-ul său.
 * @param {string} id - ID-ul (SQLite id convertit la string)
 * @returns {Promise<Object|null>} Documentul utilizatorului (cu tot cu password hash) sau null
 */
async function findUserById(id) {
  if (!id) {
    throw new AppError('ID-ul utilizatorului este invalid.', 400, 'INVALID_USER_ID');
  }

  try {
    var db = await getDb();
    var numericId = parseInt(id, 10);
    var stmt;
    if (isNaN(numericId)) {
      stmt = db.prepare('SELECT * FROM users WHERE CAST(id AS TEXT) = ?');
      stmt.bind([String(id)]);
    } else {
      stmt = db.prepare('SELECT * FROM users WHERE id = ?');
      stmt.bind([numericId]);
    }
    var row;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();
    return row ? _sqlRowToDoc(row) : null;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea utilizatorului (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ======================= findUsersByTenant ==================================

/**
 * Găsește toți utilizatorii dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>} Lista de utilizatori (fără password hash)
 */
async function findUsersByTenant(tenantId) {
  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  try {
    var db = await getDb();
    var stmt = db.prepare('SELECT * FROM users WHERE tenant_id = ?');
    stmt.bind([tenantId]);
    var rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    var safeUsers = rows.map(function (r) {
      return _stripPassword(_sqlRowToDoc(r));
    });
    return safeUsers;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea utilizatorilor (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ======================== findUsersByRole ===================================

/**
 * Găsește toți utilizatorii după un rol specific.
 * @param {string} role - Rolul căutat
 * @returns {Promise<Array>} Lista de utilizatori (fără password hash)
 */
async function findUsersByRole(role) {
  if (!role || !isValidRole(role)) {
    throw new AppError('Rolul "' + role + '" nu este valid.', 400, 'INVALID_ROLE');
  }

  try {
    var db = await getDb();
    var stmt = db.prepare('SELECT * FROM users WHERE role = ?');
    stmt.bind([role]);
    var rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    var safeUsers = rows.map(function (r) {
      return _stripPassword(_sqlRowToDoc(r));
    });
    return safeUsers;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea utilizatorilor (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ======================== comparePassword ===================================

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
    var result = await _bcryptCompare(plainPassword, hashedPassword);
    return result;
  } catch (err) {
    throw new AppError('Eroare la verificarea parolei.', 500, 'BCRYPT_ERROR');
  }
}

// ======================== updatePassword ====================================

/**
 * Actualizează parola unui utilizator.
 * @param {string} userId - ID-ul utilizatorului
 * @param {string} newPassword - Noua parolă (plain text)
 * @returns {Promise<Object>} Utilizatorul actualizat (fără password hash)
 */
async function updatePassword(userId, newPassword) {
  if (!userId) {
    throw new AppError('ID-ul utilizatorului este invalid.', 400, 'INVALID_USER_ID');
  }

  if (!newPassword || !isValidPassword(newPassword)) {
    throw new AppError(
      'Parola trebuie să aibă între 6 și 128 de caractere.',
      400,
      'INVALID_PASSWORD'
    );
  }

  var hashedPassword;
  try {
    hashedPassword = await _bcryptHash(newPassword, 10);
  } catch (hashErr) {
    throw new AppError('Eroare internă la hash-uirea parolei.', 500, 'HASH_ERROR');
  }

  var now = new Date().toISOString();

  try {
    var db = await getDb();
    var numericId = parseInt(userId, 10);

    if (!isNaN(numericId)) {
      db.run(
        'UPDATE users SET password = ?, updated_at = ? WHERE id = ?',
        [hashedPassword, now, numericId]
      );
    } else {
      db.run(
        'UPDATE users SET password = ?, updated_at = ? WHERE CAST(id AS TEXT) = ?',
        [hashedPassword, now, String(userId)]
      );
    }

    var changesResult = db.exec('SELECT changes() AS cnt');
    var changes = changesResult[0].values[0][0];

    if (changes === 0) {
      throw new AppError('Utilizatorul nu a fost găsit.', 404, 'USER_NOT_FOUND');
    }

    var fetchStmt;
    if (!isNaN(numericId)) {
      fetchStmt = db.prepare('SELECT * FROM users WHERE id = ?');
      fetchStmt.bind([numericId]);
    } else {
      fetchStmt = db.prepare('SELECT * FROM users WHERE CAST(id AS TEXT) = ?');
      fetchStmt.bind([String(userId)]);
    }
    var updatedRow;
    if (fetchStmt.step()) {
      updatedRow = fetchStmt.getAsObject();
    }
    fetchStmt.free();

    return _stripPassword(_sqlRowToDoc(updatedRow));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la actualizarea parolei (SQL): ' + sqlErr.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

// =========================== updateRole =====================================

/**
 * Actualizează rolul unui utilizator.
 * @param {string} userId - ID-ul utilizatorului
 * @param {string} newRole - Noul rol
 * @returns {Promise<Object>} Utilizatorul actualizat (fără password hash)
 */
async function updateRole(userId, newRole) {
  if (!userId) {
    throw new AppError('ID-ul utilizatorului este invalid.', 400, 'INVALID_USER_ID');
  }

  if (!newRole || !isValidRole(newRole)) {
    throw new AppError('Rolul "' + newRole + '" nu este valid.', 400, 'INVALID_ROLE');
  }

  var now = new Date().toISOString();

  try {
    var db = await getDb();
    var numericId = parseInt(userId, 10);

    if (!isNaN(numericId)) {
      db.run(
        'UPDATE users SET role = ?, updated_at = ? WHERE id = ?',
        [newRole, now, numericId]
      );
    } else {
      db.run(
        'UPDATE users SET role = ?, updated_at = ? WHERE CAST(id AS TEXT) = ?',
        [newRole, now, String(userId)]
      );
    }

    var changesResult = db.exec('SELECT changes() AS cnt');
    var changes = changesResult[0].values[0][0];

    if (changes === 0) {
      throw new AppError('Utilizatorul nu a fost găsit.', 404, 'USER_NOT_FOUND');
    }

    var fetchStmt;
    if (!isNaN(numericId)) {
      fetchStmt = db.prepare('SELECT * FROM users WHERE id = ?');
      fetchStmt.bind([numericId]);
    } else {
      fetchStmt = db.prepare('SELECT * FROM users WHERE CAST(id AS TEXT) = ?');
      fetchStmt.bind([String(userId)]);
    }
    var updatedRow;
    if (fetchStmt.step()) {
      updatedRow = fetchStmt.getAsObject();
    }
    fetchStmt.free();

    return _stripPassword(_sqlRowToDoc(updatedRow));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la actualizarea rolului (SQL): ' + sqlErr.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

// ======================== addRestaurante ====================================

/**
 * Asociază restaurante la un utilizator.
 * @param {string} userId - ID-ul utilizatorului
 * @param {Array} restaurantIds - Lista de ID-uri restaurante
 * @returns {Promise<Object>} Utilizatorul actualizat (fără password hash)
 */
async function addRestaurante(userId, restaurantIds) {
  if (!userId) {
    throw new AppError('ID-ul utilizatorului este invalid.', 400, 'INVALID_USER_ID');
  }

  if (!Array.isArray(restaurantIds) || restaurantIds.length === 0) {
    throw new AppError(
      'Lista de restaurante este invalidă sau goală.',
      400,
      'INVALID_RESTAURANT_LIST'
    );
  }

  var now = new Date().toISOString();

  try {
    var db = await getDb();
    var numericId = parseInt(userId, 10);

    // Obține lista curentă
    var fetchStmt;
    if (!isNaN(numericId)) {
      fetchStmt = db.prepare('SELECT * FROM users WHERE id = ?');
      fetchStmt.bind([numericId]);
    } else {
      fetchStmt = db.prepare('SELECT * FROM users WHERE CAST(id AS TEXT) = ?');
      fetchStmt.bind([String(userId)]);
    }
    var currentRow;
    if (fetchStmt.step()) {
      currentRow = fetchStmt.getAsObject();
    }
    fetchStmt.free();

    if (!currentRow) {
      throw new AppError('Utilizatorul nu a fost găsit.', 404, 'USER_NOT_FOUND');
    }

    // Parsează restaurantele curente
    var currentRestaurante = [];
    if (typeof currentRow.restaurante === 'string') {
      try {
        currentRestaurante = JSON.parse(currentRow.restaurante);
      } catch (_e) {
        currentRestaurante = [];
      }
    }
    if (!Array.isArray(currentRestaurante)) currentRestaurante = [];

    // Adaugă fără duplicate (union)
    var updatedRestaurante = currentRestaurante.slice();
    for (var i = 0; i < restaurantIds.length; i++) {
      if (updatedRestaurante.indexOf(restaurantIds[i]) === -1) {
        updatedRestaurante.push(restaurantIds[i]);
      }
    }

    var restauranteJson = JSON.stringify(updatedRestaurante);

    if (!isNaN(numericId)) {
      db.run(
        'UPDATE users SET restaurante = ?, updated_at = ? WHERE id = ?',
        [restauranteJson, now, numericId]
      );
    } else {
      db.run(
        'UPDATE users SET restaurante = ?, updated_at = ? WHERE CAST(id AS TEXT) = ?',
        [restauranteJson, now, String(userId)]
      );
    }

    var changesResult = db.exec('SELECT changes() AS cnt');
    var changes = changesResult[0].values[0][0];

    if (changes === 0) {
      throw new AppError('Utilizatorul nu a fost găsit.', 404, 'USER_NOT_FOUND');
    }

    var fetchUpdatedStmt;
    if (!isNaN(numericId)) {
      fetchUpdatedStmt = db.prepare('SELECT * FROM users WHERE id = ?');
      fetchUpdatedStmt.bind([numericId]);
    } else {
      fetchUpdatedStmt = db.prepare('SELECT * FROM users WHERE CAST(id AS TEXT) = ?');
      fetchUpdatedStmt.bind([String(userId)]);
    }
    var updatedRow;
    if (fetchUpdatedStmt.step()) {
      updatedRow = fetchUpdatedStmt.getAsObject();
    }
    fetchUpdatedStmt.free();

    return _stripPassword(_sqlRowToDoc(updatedRow));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la asocierea restaurantelor (SQL): ' + sqlErr.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

// =========================== deleteUser =====================================

/**
 * Șterge un utilizator după ID.
 * @param {string} userId - ID-ul utilizatorului
 * @returns {Promise<boolean>} true dacă a fost șters
 */
async function deleteUser(userId) {
  if (!userId) {
    throw new AppError('ID-ul utilizatorului este invalid.', 400, 'INVALID_USER_ID');
  }

  try {
    var db = await getDb();
    var numericId = parseInt(userId, 10);

    if (!isNaN(numericId)) {
      db.run('DELETE FROM users WHERE id = ?', [numericId]);
    } else {
      db.run('DELETE FROM users WHERE CAST(id AS TEXT) = ?', [String(userId)]);
    }

    var changesResult = db.exec('SELECT changes() AS cnt');
    var changes = changesResult[0].values[0][0];

    if (changes === 0) {
      throw new AppError('Utilizatorul nu a fost găsit.', 404, 'USER_NOT_FOUND');
    }

    return true;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la ștergerea utilizatorului (SQL): ' + sqlErr.message,
      500,
      'DB_DELETE_ERROR'
    );
  }
}

// ======================= countUsersByTenant =================================

/**
 * Obține numărul total de utilizatori dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>}
 */
async function countUsersByTenant(tenantId) {
  if (!tenantId) {
    return 0;
  }

  try {
    var db = await getDb();
    var stmt = db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE tenant_id = ?');
    stmt.bind([tenantId]);
    var row;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();
    return row ? row.cnt : 0;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la numărarea utilizatorilor (SQL): ' + sqlErr.message,
      500,
      'DB_COUNT_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Validare
  isValidEmail: isValidEmail,
  isValidRole: isValidRole,
  isValidPassword: isValidPassword,
  isValidPhone: isValidPhone,
  VALID_ROLES: VALID_ROLES,

  // Operații CRUD
  createUser: createUser,
  findUserByEmail: findUserByEmail,
  findUserById: findUserById,
  findUsersByTenant: findUsersByTenant,
  findUsersByRole: findUsersByRole,
  deleteUser: deleteUser,

  // Operații specifice
  comparePassword: comparePassword,
  updatePassword: updatePassword,
  updateRole: updateRole,
  addRestaurante: addRestaurante,
  countUsersByTenant: countUsersByTenant,

  // Expunere pentru testare și debugging
  _isSqlAvailable: _isSqlAvailable,
  _sqlRowToDoc: _sqlRowToDoc,
  _stripPassword: _stripPassword,
};