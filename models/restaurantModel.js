'use strict';

// ---------------------------------------------------------------------------
// Model Restaurant – GastroHub
// Definirea structurii, validărilor și operațiilor CRUD pentru configurarea
// unui restaurant (nume, adresă, nr. mese, tenant asociat).
// Câmpuri suportate: name, address, tableCount, tenantId, phone, email, status
//
// Backend: SQLite (prin getDb())
// ---------------------------------------------------------------------------

const { getDb } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Statusuri valide pentru un restaurant
// ---------------------------------------------------------------------------

const VALID_STATUSES = ['active', 'inactive', 'closed'];

// ---------------------------------------------------------------------------
// Detecție backend SQLite
// ---------------------------------------------------------------------------

/**
 * Returnează `true` – SQLite este întotdeauna disponibil.
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
  return doc;
}

// ---------------------------------------------------------------------------
// Helpers interne pentru interogări SQLite (folosesc direct db.*)
// ---------------------------------------------------------------------------

/**
 * Execută o interogare de tip INSERT/UPDATE/DELETE și returnează
 * { changes, lastInsertRowid }.
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {{ changes: number, lastInsertRowid: number }}
 */
function _dbRun(db, sql, params = []) {
  db.run(sql, params);
  const changesRes = db.exec('SELECT changes() AS cnt');
  const lastIdRes = db.exec('SELECT last_insert_rowid() AS id');
  return {
    changes: (changesRes.length > 0 && changesRes[0].values.length > 0)
      ? changesRes[0].values[0][0] : 0,
    lastInsertRowid: (lastIdRes.length > 0 && lastIdRes[0].values.length > 0)
      ? lastIdRes[0].values[0][0] : 0,
  };
}

/**
 * Execută o interogare SELECT care returnează un singur rând (sau undefined).
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
 * Execută o interogare SELECT care returnează toate rândurile ca array.
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

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un șir nu este gol și are lungimea între limite.
 * @param {string} val - Valoarea de verificat
 * @param {number} [min=1] - Lungimea minimă
 * @param {number} [max=255] - Lungimea maximă
 * @returns {boolean}
 */
function isValidString(val, min = 1, max = 255) {
  return typeof val === 'string' && val.trim().length >= min && val.trim().length <= max;
}

/**
 * Verifică dacă un număr este un întreg pozitiv.
 * @param {*} val
 * @returns {boolean}
 */
function isValidPositiveInt(val) {
  return Number.isInteger(val) && val >= 0;
}

/**
 * Verifică dacă statusul este valid.
 * @param {string} status
 * @returns {boolean}
 */
function isValidStatus(status) {
  return VALID_STATUSES.includes(status);
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

// ---------------------------------------------------------------------------
// Operații CRUD – Restaurante (SQLite)
// ---------------------------------------------------------------------------

/**
 * Creează un restaurant nou în baza de date.
 *
 * @param {Object} restaurantData - Datele restaurantului
 * @param {string} restaurantData.name - Numele restaurantului (obligatoriu)
 * @param {string} restaurantData.address - Adresa restaurantului (obligatoriu)
 * @param {number} [restaurantData.tableCount=0] - Numărul de mese
 * @param {string} restaurantData.tenantId - ID-ul tenant-ului asociat (obligatoriu)
 * @param {string} [restaurantData.phone] - Număr de telefon
 * @param {string} [restaurantData.email] - Email de contact
 * @param {string} [restaurantData.status='active'] - Statusul restaurantului
 * @returns {Promise<Object>} Documentul restaurantului creat
 * @throws {AppError} Dacă validarea eșuează
 */
async function createRestaurant(restaurantData) {
  // -----------------------------------------------------------------------
  // Validare câmpuri obligatorii
  // -----------------------------------------------------------------------
  if (!restaurantData || typeof restaurantData !== 'object') {
    throw new AppError('Datele restaurantului sunt invalide.', 400, 'INVALID_RESTAURANT_DATA');
  }

  const { name, address, tableCount, tenantId, phone, email, status } = restaurantData;

  // Validare nume
  if (!name || !isValidString(name, 1, 100)) {
    throw new AppError(
      'Numele restaurantului trebuie sa aiba intre 1 si 100 de caractere.',
      400,
      'INVALID_RESTAURANT_NAME'
    );
  }

  // Validare adresa
  if (!address || !isValidString(address, 5, 500)) {
    throw new AppError(
      'Adresa restaurantului trebuie sa aiba intre 5 si 500 de caractere.',
      400,
      'INVALID_RESTAURANT_ADDRESS'
    );
  }

  // Validare tenantId
  if (!tenantId) {
    throw new AppError(
      'ID-ul tenant-ului este obligatoriu.',
      400,
      'MISSING_TENANT_ID'
    );
  }

  // Validare tableCount (optional, implicit 0)
  const finalTableCount = tableCount !== undefined ? tableCount : 0;
  if (!isValidPositiveInt(finalTableCount)) {
    throw new AppError(
      'Numarul de mese trebuie sa fie un numar intreg, mai mare sau egal cu 0.',
      400,
      'INVALID_TABLE_COUNT'
    );
  }

  // Validare status (optional, implicit 'active')
  const finalStatus = status || 'active';
  if (!isValidStatus(finalStatus)) {
    throw new AppError(
      `Statusul "${finalStatus}" nu este valid. Valorile permise: ${VALID_STATUSES.join(', ')}.`,
      400,
      'INVALID_STATUS'
    );
  }

  // Validare email (optional)
  if (email !== undefined && email !== null && email !== '' && !isValidEmail(email)) {
    throw new AppError(
      'Adresa de email a restaurantului este invalida.',
      400,
      'INVALID_RESTAURANT_EMAIL'
    );
  }

  // Validare phone (optional, doar string)
  if (phone !== undefined && phone !== null && typeof phone !== 'string') {
    throw new AppError(
      'Numarul de telefon trebuie sa fie un sir de caractere.',
      400,
      'INVALID_RESTAURANT_PHONE'
    );
  }

  const now = new Date().toISOString();
  const finalName = name.trim();
  const finalAddress = address.trim();
  const finalPhone = phone || '';
  const finalEmail = email ? email.toLowerCase().trim() : '';

  const db = await getDb();

  try {
    const result = _dbRun(
      db,
      `INSERT INTO restaurants (name, address, tableCount, tenantId, phone, email, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [finalName, finalAddress, finalTableCount, tenantId, finalPhone, finalEmail, finalStatus, now, now]
    );

    const newId = result.lastInsertRowid;
    const newRow = _dbGet(db, 'SELECT * FROM restaurants WHERE id = ?', [newId]);
    const doc = _sqlRowToDoc(newRow);
    return doc;
  } catch (sqlErr) {
    throw new AppError(
      `Eroare la crearea restaurantului (SQL): ${sqlErr.message}`,
      500,
      'DB_INSERT_ERROR'
    );
  }
}

/**
 * Gaseste un restaurant dupa ID-ul sau.
 * @param {string} id - ID-ul (SQLite id convertit la string)
 * @returns {Promise<Object|null>} Documentul restaurantului sau null
 */
async function findRestaurantById(id) {
  if (!id) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  const db = await getDb();

  try {
    const numericId = parseInt(id, 10);
    let row;
    if (isNaN(numericId)) {
      row = _dbGet(db, 'SELECT * FROM restaurants WHERE CAST(id AS TEXT) = ?', [String(id)]);
    } else {
      row = _dbGet(db, 'SELECT * FROM restaurants WHERE id = ?', [numericId]);
    }
    return row ? _sqlRowToDoc(row) : null;
  } catch (sqlErr) {
    throw new AppError(
      `Eroare la cautarea restaurantului (SQL): ${sqlErr.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Gaseste toate restaurantele dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Optiuni de cautare (sort, limit, skip)
 * @returns {Promise<Array>} Lista de restaurante
 */
async function findRestaurantsByTenant(tenantId, options = {}) {
  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  const db = await getDb();

  try {
    let sql = 'SELECT * FROM restaurants WHERE tenantId = ?';
    const params = [tenantId];

    // Sortare
    if (options.sort && typeof options.sort === 'object') {
      const sortKeys = Object.keys(options.sort);
      if (sortKeys.length > 0) {
        const sortClauses = sortKeys.map((k) => `${k} ${options.sort[k] === -1 ? 'DESC' : 'ASC'}`);
        sql += ' ORDER BY ' + sortClauses.join(', ');
      } else {
        sql += ' ORDER BY name ASC';
      }
    } else {
      sql += ' ORDER BY name ASC';
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
    return rows.map((r) => _sqlRowToDoc(r));
  } catch (sqlErr) {
    throw new AppError(
      `Eroare la cautarea restaurantelor (SQL): ${sqlErr.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Gaseste toate restaurantele dupa status.
 * @param {string} status - Statusul cautat
 * @param {string} [tenantId] - Optional, filtreaza si dupa tenant
 * @returns {Promise<Array>} Lista de restaurante
 */
async function findRestaurantsByStatus(status, tenantId) {
  if (!status || !isValidStatus(status)) {
    throw new AppError(
      `Statusul "${status}" nu este valid. Valorile permise: ${VALID_STATUSES.join(', ')}.`,
      400,
      'INVALID_STATUS'
    );
  }

  const db = await getDb();

  try {
    let sql;
    const params = [status];

    if (tenantId) {
      sql = 'SELECT * FROM restaurants WHERE status = ? AND tenantId = ? ORDER BY name ASC';
      params.push(tenantId);
    } else {
      sql = 'SELECT * FROM restaurants WHERE status = ? ORDER BY name ASC';
    }

    const rows = _dbAll(db, sql, params);
    return rows.map((r) => _sqlRowToDoc(r));
  } catch (sqlErr) {
    throw new AppError(
      `Eroare la cautarea restaurantelor (SQL): ${sqlErr.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Actualizeaza un restaurant dupa ID.
 * @param {string} id - ID-ul restaurantului
 * @param {Object} updateData - Campurile de actualizat
 * @returns {Promise<Object>} Documentul actualizat
 */
async function updateRestaurant(id, updateData) {
  if (!id) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
    throw new AppError(
      'Nu s-au furnizat date pentru actualizare.',
      400,
      'EMPTY_UPDATE_DATA'
    );
  }

  // -----------------------------------------------------------------------
  // Campuri permise pentru actualizare
  // -----------------------------------------------------------------------
  const allowedFields = ['name', 'address', 'tableCount', 'phone', 'email', 'status'];
  const sqlUpdates = {};
  const errors = [];

  for (const [key, value] of Object.entries(updateData)) {
    if (!allowedFields.includes(key)) {
      continue; // Ignoram campurile nepermise
    }

    switch (key) {
      case 'name':
        if (!isValidString(value, 1, 100)) {
          errors.push('Numele restaurantului trebuie sa aiba intre 1 si 100 de caractere.');
        } else {
          sqlUpdates.name = value.trim();
        }
        break;

      case 'address':
        if (!isValidString(value, 5, 500)) {
          errors.push('Adresa restaurantului trebuie sa aiba intre 5 si 500 de caractere.');
        } else {
          sqlUpdates.address = value.trim();
        }
        break;

      case 'tableCount':
        if (!isValidPositiveInt(value)) {
          errors.push('Numarul de mese trebuie sa fie un numar intreg, mai mare sau egal cu 0.');
        } else {
          sqlUpdates.tableCount = value;
        }
        break;

      case 'phone':
        if (value !== null && value !== undefined && typeof value !== 'string') {
          errors.push('Numarul de telefon trebuie sa fie un sir de caractere.');
        } else {
          sqlUpdates.phone = value || '';
        }
        break;

      case 'email':
        if (value !== null && value !== undefined && value !== '' && !isValidEmail(value)) {
          errors.push('Adresa de email a restaurantului este invalida.');
        } else {
          sqlUpdates.email = value ? value.toLowerCase().trim() : '';
        }
        break;

      case 'status':
        if (!isValidStatus(value)) {
          errors.push(`Statusul "${value}" nu este valid. Valorile permise: ${VALID_STATUSES.join(', ')}.`);
        } else {
          sqlUpdates.status = value;
        }
        break;

      // No default – allowedFields garanteaza ca ajungem doar aici
    }
  }

  if (errors.length > 0) {
    throw new AppError(errors.join(' '), 400, 'VALIDATION_ERROR');
  }

  if (Object.keys(sqlUpdates).length === 0) {
    throw new AppError(
      'Nu s-au furnizat campuri valide pentru actualizare.',
      400,
      'NO_VALID_FIELDS'
    );
  }

  const now = new Date().toISOString();
  const db = await getDb();

  try {
    const numericId = parseInt(id, 10);

    // Construim interogarea SQL dinamic
    const setClauses = Object.keys(sqlUpdates).map((k) => `${k} = ?`);
    setClauses.push('updatedAt = ?');
    const allParams = Object.values(sqlUpdates);
    allParams.push(now);

    let result;
    if (!isNaN(numericId)) {
      allParams.push(numericId);
      result = _dbRun(
        db,
        `UPDATE restaurants SET ${setClauses.join(', ')} WHERE id = ?`,
        allParams
      );
    } else {
      allParams.push(String(id));
      result = _dbRun(
        db,
        `UPDATE restaurants SET ${setClauses.join(', ')} WHERE CAST(id AS TEXT) = ?`,
        allParams
      );
    }

    if (result.changes === 0) {
      throw new AppError('Restaurantul nu a fost gasit.', 404, 'RESTAURANT_NOT_FOUND');
    }

    // Returnam documentul actualizat
    let updatedRow;
    if (!isNaN(numericId)) {
      updatedRow = _dbGet(db, 'SELECT * FROM restaurants WHERE id = ?', [numericId]);
    } else {
      updatedRow = _dbGet(db, 'SELECT * FROM restaurants WHERE CAST(id AS TEXT) = ?', [String(id)]);
    }
    return _sqlRowToDoc(updatedRow);
  } catch (sqlErr) {
    if (sqlErr instanceof AppError) throw sqlErr;
    throw new AppError(
      `Eroare la actualizarea restaurantului (SQL): ${sqlErr.message}`,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Actualizeaza numarul de mese al unui restaurant.
 * @param {string} id - ID-ul restaurantului
 * @param {number} tableCount - Noul numar de mese
 * @returns {Promise<Object>} Documentul actualizat
 */
async function updateTableCount(id, tableCount) {
  if (!id) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  if (!isValidPositiveInt(tableCount)) {
    throw new AppError(
      'Numarul de mese trebuie sa fie un numar intreg, mai mare sau egal cu 0.',
      400,
      'INVALID_TABLE_COUNT'
    );
  }

  const now = new Date().toISOString();
  const db = await getDb();

  try {
    const numericId = parseInt(id, 10);
    let result;
    if (!isNaN(numericId)) {
      result = _dbRun(
        db,
        'UPDATE restaurants SET tableCount = ?, updatedAt = ? WHERE id = ?',
        [tableCount, now, numericId]
      );
    } else {
      result = _dbRun(
        db,
        'UPDATE restaurants SET tableCount = ?, updatedAt = ? WHERE CAST(id AS TEXT) = ?',
        [tableCount, now, String(id)]
      );
    }

    if (result.changes === 0) {
      throw new AppError('Restaurantul nu a fost gasit.', 404, 'RESTAURANT_NOT_FOUND');
    }

    let updatedRow;
    if (!isNaN(numericId)) {
      updatedRow = _dbGet(db, 'SELECT * FROM restaurants WHERE id = ?', [numericId]);
    } else {
      updatedRow = _dbGet(db, 'SELECT * FROM restaurants WHERE CAST(id AS TEXT) = ?', [String(id)]);
    }
    return _sqlRowToDoc(updatedRow);
  } catch (sqlErr) {
    if (sqlErr instanceof AppError) throw sqlErr;
    throw new AppError(
      `Eroare la actualizarea numarului de mese (SQL): ${sqlErr.message}`,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Actualizeaza statusul unui restaurant.
 * @param {string} id - ID-ul restaurantului
 * @param {string} status - Noul status
 * @returns {Promise<Object>} Documentul actualizat
 */
async function updateRestaurantStatus(id, status) {
  if (!id) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  if (!status || !isValidStatus(status)) {
    throw new AppError(
      `Statusul "${status}" nu este valid. Valorile permise: ${VALID_STATUSES.join(', ')}.`,
      400,
      'INVALID_STATUS'
    );
  }

  const now = new Date().toISOString();
  const db = await getDb();

  try {
    const numericId = parseInt(id, 10);
    let result;
    if (!isNaN(numericId)) {
      result = _dbRun(
        db,
        'UPDATE restaurants SET status = ?, updatedAt = ? WHERE id = ?',
        [status, now, numericId]
      );
    } else {
      result = _dbRun(
        db,
        'UPDATE restaurants SET status = ?, updatedAt = ? WHERE CAST(id AS TEXT) = ?',
        [status, now, String(id)]
      );
    }

    if (result.changes === 0) {
      throw new AppError('Restaurantul nu a fost gasit.', 404, 'RESTAURANT_NOT_FOUND');
    }

    let updatedRow;
    if (!isNaN(numericId)) {
      updatedRow = _dbGet(db, 'SELECT * FROM restaurants WHERE id = ?', [numericId]);
    } else {
      updatedRow = _dbGet(db, 'SELECT * FROM restaurants WHERE CAST(id AS TEXT) = ?', [String(id)]);
    }
    return _sqlRowToDoc(updatedRow);
  } catch (sqlErr) {
    if (sqlErr instanceof AppError) throw sqlErr;
    throw new AppError(
      `Eroare la actualizarea statusului (SQL): ${sqlErr.message}`,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Sterge un restaurant dupa ID.
 * @param {string} id - ID-ul restaurantului
 * @returns {Promise<boolean>} true daca a fost sters
 */
async function deleteRestaurant(id) {
  if (!id) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  const db = await getDb();

  try {
    const numericId = parseInt(id, 10);
    let result;
    if (!isNaN(numericId)) {
      result = _dbRun(db, 'DELETE FROM restaurants WHERE id = ?', [numericId]);
    } else {
      result = _dbRun(db, 'DELETE FROM restaurants WHERE CAST(id AS TEXT) = ?', [String(id)]);
    }

    if (result.changes === 0) {
      throw new AppError('Restaurantul nu a fost gasit.', 404, 'RESTAURANT_NOT_FOUND');
    }

    return true;
  } catch (sqlErr) {
    if (sqlErr instanceof AppError) throw sqlErr;
    throw new AppError(
      `Eroare la stergerea restaurantului (SQL): ${sqlErr.message}`,
      500,
      'DB_DELETE_ERROR'
    );
  }
}

/**
 * Obtine numarul total de restaurante dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>}
 */
async function countRestaurantsByTenant(tenantId) {
  if (!tenantId) {
    return 0;
  }

  const db = await getDb();

  try {
    const row = _dbGet(db, 'SELECT COUNT(*) AS cnt FROM restaurants WHERE tenantId = ?', [tenantId]);
    return row ? row.cnt : 0;
  } catch (sqlErr) {
    throw new AppError(
      `Eroare la numararea restaurantelor (SQL): ${sqlErr.message}`,
      500,
      'DB_COUNT_ERROR'
    );
  }
}

/**
 * Obtine numarul total de restaurante dupa status.
 * @param {string} status - Statusul
 * @param {string} [tenantId] - Optional, filtreaza si dupa tenant
 * @returns {Promise<number>}
 */
async function countRestaurantsByStatus(status, tenantId) {
  if (!status || !isValidStatus(status)) {
    throw new AppError(
      `Statusul "${status}" nu este valid. Valorile permise: ${VALID_STATUSES.join(', ')}.`,
      400,
      'INVALID_STATUS'
    );
  }

  const db = await getDb();

  try {
    let sql;
    const params = [status];

    if (tenantId) {
      sql = 'SELECT COUNT(*) AS cnt FROM restaurants WHERE status = ? AND tenantId = ?';
      params.push(tenantId);
    } else {
      sql = 'SELECT COUNT(*) AS cnt FROM restaurants WHERE status = ?';
    }

    const row = _dbGet(db, sql, params);
    return row ? row.cnt : 0;
  } catch (sqlErr) {
    throw new AppError(
      `Eroare la numararea restaurantelor (SQL): ${sqlErr.message}`,
      500,
      'DB_COUNT_ERROR'
    );
  }
}

/**
 * Cauta restaurante dupa nume (cautare partiala, case-insensitive).
 * @param {string} searchTerm - Termenul de cautare
 * @param {string} [tenantId] - Optional, filtreaza si dupa tenant
 * @returns {Promise<Array>} Lista de restaurante gasite
 */
async function searchRestaurantsByName(searchTerm, tenantId) {
  if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
    throw new AppError(
      'Termenul de cautare este invalid.',
      400,
      'INVALID_SEARCH_TERM'
    );
  }

  const db = await getDb();

  try {
    let sql;
    const params = [`%${searchTerm.trim()}%`];

    if (tenantId) {
      sql = 'SELECT * FROM restaurants WHERE name LIKE ? AND tenantId = ? ORDER BY name ASC';
      params.push(tenantId);
    } else {
      sql = 'SELECT * FROM restaurants WHERE name LIKE ? ORDER BY name ASC';
    }

    const rows = _dbAll(db, sql, params);
    return rows.map((r) => _sqlRowToDoc(r));
  } catch (sqlErr) {
    throw new AppError(
      `Eroare la cautarea restaurantelor (SQL): ${sqlErr.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Validare
  isValidString,
  isValidPositiveInt,
  isValidStatus,
  isValidEmail,
  VALID_STATUSES,

  // Operatii CRUD de baza
  createRestaurant,
  findRestaurantById,
  findRestaurantsByTenant,
  findRestaurantsByStatus,
  updateRestaurant,
  deleteRestaurant,

  // Operatii specifice
  updateTableCount,
  updateRestaurantStatus,
  countRestaurantsByTenant,
  countRestaurantsByStatus,
  searchRestaurantsByName,

  // Expunere pentru testare si debugging
  _isSqlAvailable,
  _sqlRowToDoc,
};