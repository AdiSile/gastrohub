'use strict';

// ---------------------------------------------------------------------------
// Model Order – GastroHub
// Model pentru gestionarea comenzilor (restaurant/ospătărie).
// Câmpuri suportate: tenantId, restaurantId, items (JSON), status,
// paymentMethod, tableNumber, subtotal, tax, total, notes.
//
// Backend: exclusiv SQLite (prin getDb() → db.run() / db.prepare() / db.exec()).
// ---------------------------------------------------------------------------

const { getDb } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Statusuri valide pentru o comandă
// ---------------------------------------------------------------------------

const VALID_ORDER_STATUSES = [
  'nou',
  'confirmata',
  'in_preparare',
  'finalizata',
  'livrata',
  'platita',
  'anulata',
];

// ---------------------------------------------------------------------------
// Metode de plată valide
// ---------------------------------------------------------------------------

const VALID_PAYMENT_METHODS = [
  'cash',
  'card',
  'transfer',
  'online',
  'voucher',
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
// Helpers de conversie rând SQL → document compatibil
// ---------------------------------------------------------------------------

/**
 * Convertește un rând SQL (id INTEGER) într-un obiect cu _id string.
 * Parsează câmpul `items` din JSON dacă este stocat ca string.
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

  // Parsează items din JSON dacă există
  if (typeof doc.items === 'string') {
    try {
      doc.items = JSON.parse(doc.items);
    } catch (_e) {
      doc.items = [];
    }
  }
  if (!Array.isArray(doc.items)) {
    doc.items = [];
  }

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
 * @param {*} val - Valoarea de verificat
 * @param {number} [min=1] - Lungimea minimă
 * @param {number} [max=255] - Lungimea maximă
 * @returns {boolean}
 */
function isValidString(val, min = 1, max = 255) {
  return typeof val === 'string' && val.trim().length >= min && val.trim().length <= max;
}

/**
 * Verifică dacă un număr este un număr pozitiv (include 0).
 * @param {*} val
 * @returns {boolean}
 */
function isValidPositiveNumber(val) {
  return typeof val === 'number' && !Number.isNaN(val) && val >= 0 && Number.isFinite(val);
}

/**
 * Verifică dacă un număr este un întreg pozitiv (include 0).
 * @param {*} val
 * @returns {boolean}
 */
function isValidPositiveInt(val) {
  return Number.isInteger(val) && val >= 0;
}

/**
 * Verifică dacă statusul comenzii este valid.
 * @param {string} status
 * @returns {boolean}
 */
function isValidOrderStatus(status) {
  return VALID_ORDER_STATUSES.includes(status);
}

/**
 * Verifică dacă metoda de plată este validă.
 * @param {string} method
 * @returns {boolean}
 */
function isValidPaymentMethod(method) {
  return VALID_PAYMENT_METHODS.includes(method);
}

/**
 * Verifică dacă o valoare este un array de item-uri valid.
 * Fiecare item trebuie să aibă cel puțin `menuItemId`, `name`, `quantity`, `price`.
 * @param {*} val
 * @returns {boolean}
 */
function isValidItemsArray(val) {
  if (!Array.isArray(val) || val.length === 0) return false;
  for (let i = 0; i < val.length; i++) {
    const item = val[i];
    if (!item || typeof item !== 'object') return false;
    if (!item.menuItemId || !item.name || !Number.isFinite(item.quantity) || item.quantity <= 0) return false;
    if (!Number.isFinite(item.price) || item.price < 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Operații CRUD – Orders (SQLite)
// ---------------------------------------------------------------------------

/**
 * Creează o comandă nouă.
 *
 * @param {Object} orderData - Datele comenzii
 * @param {string} orderData.tenantId - ID-ul tenant-ului (obligatoriu)
 * @param {string} orderData.restaurantId - ID-ul restaurantului (obligatoriu)
 * @param {Array}  orderData.items - Lista de item-uri comandate (obligatoriu, min. 1)
 * @param {string} [orderData.status='nou'] - Statusul comenzii
 * @param {string} [orderData.paymentMethod='cash'] - Metoda de plată
 * @param {number} [orderData.tableNumber] - Numărul mesei
 * @param {number} [orderData.subtotal=0] - Subtotalul comenzii
 * @param {number} [orderData.tax=0] - Taxa aplicată
 * @param {number} [orderData.total=0] - Totalul comenzii
 * @param {string} [orderData.notes=''] - Observații
 * @returns {Promise<Object>} Documentul comenzii create
 * @throws {AppError} Dacă validarea eșuează
 */
async function createOrder(orderData) {
  // -----------------------------------------------------------------------
  // Validare date de bază
  // -----------------------------------------------------------------------
  if (!orderData || typeof orderData !== 'object') {
    throw new AppError('Datele comenzii sunt invalide.', 400, 'INVALID_ORDER_DATA');
  }

  const {
    tenantId,
    restaurantId,
    items,
    status,
    paymentMethod,
    tableNumber,
    subtotal,
    tax,
    total,
    notes,
  } = orderData;

  // Validare tenantId
  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  // Validare restaurantId
  if (!restaurantId) {
    throw new AppError('ID-ul restaurantului este obligatoriu.', 400, 'MISSING_RESTAURANT_ID');
  }

  // Validare items
  if (!items || !isValidItemsArray(items)) {
    throw new AppError(
      'Comanda trebuie să conțină cel puțin un item valid (menuItemId, name, quantity, price).',
      400,
      'INVALID_ITEMS'
    );
  }

  // Validare status
  const finalStatus = status || 'nou';
  if (!isValidOrderStatus(finalStatus)) {
    throw new AppError(
      `Statusul "${finalStatus}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
      400,
      'INVALID_ORDER_STATUS'
    );
  }

  // Validare paymentMethod
  const finalPaymentMethod = paymentMethod || 'cash';
  if (!isValidPaymentMethod(finalPaymentMethod)) {
    throw new AppError(
      `Metoda de plată "${finalPaymentMethod}" nu este validă. Metode permise: ${VALID_PAYMENT_METHODS.join(', ')}.`,
      400,
      'INVALID_PAYMENT_METHOD'
    );
  }

  // Validare tableNumber (opțional)
  if (tableNumber !== undefined && tableNumber !== null && !isValidPositiveInt(tableNumber)) {
    throw new AppError(
      'Numărul mesei trebuie să fie un număr întreg pozitiv.',
      400,
      'INVALID_TABLE_NUMBER'
    );
  }

  // Validare subtotal
  const finalSubtotal = subtotal !== undefined ? subtotal : 0;
  if (!isValidPositiveNumber(finalSubtotal)) {
    throw new AppError('Subtotalul trebuie să fie un număr pozitiv.', 400, 'INVALID_SUBTOTAL');
  }

  // Validare tax
  const finalTax = tax !== undefined ? tax : 0;
  if (!isValidPositiveNumber(finalTax)) {
    throw new AppError('Taxa trebuie să fie un număr pozitiv.', 400, 'INVALID_TAX');
  }

  // Validare total
  const finalTotal = total !== undefined ? total : 0;
  if (!isValidPositiveNumber(finalTotal)) {
    throw new AppError('Totalul trebuie să fie un număr pozitiv.', 400, 'INVALID_TOTAL');
  }

  // Validare notes (opțional)
  const finalNotes = notes || '';

  const now = new Date().toISOString();
  const itemsJson = JSON.stringify(items);

  const db = await getDb();

  try {
    const result = _dbRun(
      db,
      `INSERT INTO orders
       (tenantId, restaurantId, items, status, paymentMethod, tableNumber,
        subtotal, tax, total, notes, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        restaurantId,
        itemsJson,
        finalStatus,
        finalPaymentMethod,
        tableNumber !== undefined ? tableNumber : null,
        finalSubtotal,
        finalTax,
        finalTotal,
        finalNotes,
        now,
        now,
      ]
    );

    const newId = result.lastInsertRowid;
    const newRow = _dbGet(db, 'SELECT * FROM orders WHERE id = ?', [newId]);
    return _sqlRowToDoc(newRow);
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la crearea comenzii (SQL): ' + sqlErr.message,
      500,
      'DB_INSERT_ERROR'
    );
  }
}

/**
 * Găsește o comandă după ID.
 * @param {string} id - ID-ul comenzii
 * @returns {Promise<Object|null>} Documentul comenzii sau null
 */
async function findOrderById(id) {
  if (!id) {
    throw new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID');
  }

  const db = await getDb();

  try {
    const numericId = parseInt(id, 10);
    let row;
    if (isNaN(numericId)) {
      row = _dbGet(db, 'SELECT * FROM orders WHERE CAST(id AS TEXT) = ?', [String(id)]);
    } else {
      row = _dbGet(db, 'SELECT * FROM orders WHERE id = ?', [numericId]);
    }
    return row ? _sqlRowToDoc(row) : null;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea comenzii (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește toate comenzile dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni de căutare (sort, limit, skip, status)
 * @returns {Promise<Array>} Lista de comenzi
 */
async function findOrdersByTenant(tenantId, options = {}) {
  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // Filtrare opțională după status
  if (options.status) {
    if (!isValidOrderStatus(options.status)) {
      throw new AppError(
        `Statusul "${options.status}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
        400,
        'INVALID_ORDER_STATUS'
      );
    }
  }

  const db = await getDb();

  try {
    let sql = 'SELECT * FROM orders WHERE tenantId = ?';
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
        sql += ' ORDER BY createdAt DESC';
      }
    } else {
      sql += ' ORDER BY createdAt DESC';
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
      'Eroare la căutarea comenzilor (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește toate comenzile dintr-un restaurant.
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {Object} [options={}] - Opțiuni de căutare (sort, limit, skip, status)
 * @returns {Promise<Array>} Lista de comenzi
 */
async function findOrdersByRestaurant(restaurantId, options = {}) {
  if (!restaurantId) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  // Filtrare opțională după status
  if (options.status) {
    if (!isValidOrderStatus(options.status)) {
      throw new AppError(
        `Statusul "${options.status}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
        400,
        'INVALID_ORDER_STATUS'
      );
    }
  }

  const db = await getDb();

  try {
    let sql = 'SELECT * FROM orders WHERE restaurantId = ?';
    const params = [restaurantId];

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
        sql += ' ORDER BY createdAt DESC';
      }
    } else {
      sql += ' ORDER BY createdAt DESC';
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
      'Eroare la căutarea comenzilor după restaurant (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește toate comenzile după status.
 * @param {string} status - Statusul căutat
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de comenzi
 */
async function findOrdersByStatus(status, tenantId) {
  if (!status || !isValidOrderStatus(status)) {
    throw new AppError(
      `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
      400,
      'INVALID_ORDER_STATUS'
    );
  }

  const db = await getDb();

  try {
    let sql;
    const params = [status];

    if (tenantId) {
      sql = 'SELECT * FROM orders WHERE status = ? AND tenantId = ? ORDER BY createdAt DESC';
      params.push(tenantId);
    } else {
      sql = 'SELECT * FROM orders WHERE status = ? ORDER BY createdAt DESC';
    }

    const rows = _dbAll(db, sql, params);
    return rows.map((r) => _sqlRowToDoc(r));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea comenzilor după status (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește comenzile asociate unei mese dintr-un restaurant.
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {number} tableNumber - Numărul mesei
 * @returns {Promise<Array>} Lista de comenzi
 */
async function findOrdersByTable(restaurantId, tableNumber) {
  if (!restaurantId) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  if (tableNumber === undefined || tableNumber === null || !isValidPositiveInt(tableNumber)) {
    throw new AppError(
      'Numărul mesei este invalid.',
      400,
      'INVALID_TABLE_NUMBER'
    );
  }

  const db = await getDb();

  try {
    const rows = _dbAll(
      db,
      'SELECT * FROM orders WHERE restaurantId = ? AND tableNumber = ? ORDER BY createdAt DESC',
      [restaurantId, tableNumber]
    );
    return rows.map((r) => _sqlRowToDoc(r));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea comenzilor după masă (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește comenzile după metoda de plată.
 * @param {string} paymentMethod - Metoda de plată
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de comenzi
 */
async function findOrdersByPaymentMethod(paymentMethod, tenantId) {
  if (!paymentMethod || !isValidPaymentMethod(paymentMethod)) {
    throw new AppError(
      `Metoda de plată "${paymentMethod}" nu este validă. Metode permise: ${VALID_PAYMENT_METHODS.join(', ')}.`,
      400,
      'INVALID_PAYMENT_METHOD'
    );
  }

  const db = await getDb();

  try {
    let sql;
    const params = [paymentMethod];

    if (tenantId) {
      sql = 'SELECT * FROM orders WHERE paymentMethod = ? AND tenantId = ? ORDER BY createdAt DESC';
      params.push(tenantId);
    } else {
      sql = 'SELECT * FROM orders WHERE paymentMethod = ? ORDER BY createdAt DESC';
    }

    const rows = _dbAll(db, sql, params);
    return rows.map((r) => _sqlRowToDoc(r));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea comenzilor după metoda de plată (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește comenzile dintr-un interval de date.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {string} startDate - Data de început (ISO 8601)
 * @param {string} endDate - Data de sfârșit (ISO 8601)
 * @param {Object} [options={}] - Opțiuni de căutare (sort, limit, skip, status)
 * @returns {Promise<Array>} Lista de comenzi
 */
async function findOrdersByDateRange(tenantId, startDate, endDate, options = {}) {
  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  if (!startDate || typeof startDate !== 'string') {
    throw new AppError('Data de început este invalidă.', 400, 'INVALID_START_DATE');
  }

  if (!endDate || typeof endDate !== 'string') {
    throw new AppError('Data de sfârșit este invalidă.', 400, 'INVALID_END_DATE');
  }

  if (options.status) {
    if (!isValidOrderStatus(options.status)) {
      throw new AppError(
        `Statusul "${options.status}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
        400,
        'INVALID_ORDER_STATUS'
      );
    }
  }

  const db = await getDb();

  try {
    let sql = 'SELECT * FROM orders WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ?';
    const params = [tenantId, startDate, endDate];

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
        sql += ' ORDER BY createdAt DESC';
      }
    } else {
      sql += ' ORDER BY createdAt DESC';
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
      'Eroare la căutarea comenzilor după interval de date (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Actualizează o comandă după ID.
 * @param {string} id - ID-ul comenzii
 * @param {Object} updateData - Câmpurile de actualizat
 * @returns {Promise<Object>} Documentul actualizat
 */
async function updateOrder(id, updateData) {
  if (!id) {
    throw new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID');
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
  const allowedFields = ['items', 'status', 'paymentMethod', 'tableNumber', 'subtotal', 'tax', 'total', 'notes'];
  const sqlUpdates = {};
  const errors = [];

  for (const [key, value] of Object.entries(updateData)) {
    if (!allowedFields.includes(key)) {
      continue; // Ignorăm câmpurile nepermise
    }

    switch (key) {
      case 'items':
        if (!isValidItemsArray(value)) {
          errors.push('Comanda trebuie să conțină cel puțin un item valid (menuItemId, name, quantity, price).');
        } else {
          sqlUpdates.items = JSON.stringify(value);
        }
        break;

      case 'status':
        if (!isValidOrderStatus(value)) {
          errors.push(`Statusul "${value}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`);
        } else {
          sqlUpdates.status = value;
        }
        break;

      case 'paymentMethod':
        if (!isValidPaymentMethod(value)) {
          errors.push(`Metoda de plată "${value}" nu este validă. Metode permise: ${VALID_PAYMENT_METHODS.join(', ')}.`);
        } else {
          sqlUpdates.paymentMethod = value;
        }
        break;

      case 'tableNumber':
        if (value !== null && !isValidPositiveInt(value)) {
          errors.push('Numărul mesei trebuie să fie un număr întreg pozitiv.');
        } else {
          sqlUpdates.tableNumber = value;
        }
        break;

      case 'subtotal':
        if (!isValidPositiveNumber(value)) {
          errors.push('Subtotalul trebuie să fie un număr pozitiv.');
        } else {
          sqlUpdates.subtotal = value;
        }
        break;

      case 'tax':
        if (!isValidPositiveNumber(value)) {
          errors.push('Taxa trebuie să fie un număr pozitiv.');
        } else {
          sqlUpdates.tax = value;
        }
        break;

      case 'total':
        if (!isValidPositiveNumber(value)) {
          errors.push('Totalul trebuie să fie un număr pozitiv.');
        } else {
          sqlUpdates.total = value;
        }
        break;

      case 'notes':
        sqlUpdates.notes = value || '';
        break;

      // No default – allowedFields garantează că ajungem doar aici
    }
  }

  if (errors.length > 0) {
    throw new AppError(errors.join(' '), 400, 'VALIDATION_ERROR');
  }

  if (Object.keys(sqlUpdates).length === 0) {
    throw new AppError(
      'Nu s-au furnizat câmpuri valide pentru actualizare.',
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
        `UPDATE orders SET ${setClauses.join(', ')} WHERE id = ?`,
        allParams
      );
    } else {
      allParams.push(String(id));
      result = _dbRun(
        db,
        `UPDATE orders SET ${setClauses.join(', ')} WHERE CAST(id AS TEXT) = ?`,
        allParams
      );
    }

    if (result.changes === 0) {
      throw new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND');
    }

    // Returnăm documentul actualizat
    let updatedRow;
    if (!isNaN(numericId)) {
      updatedRow = _dbGet(db, 'SELECT * FROM orders WHERE id = ?', [numericId]);
    } else {
      updatedRow = _dbGet(db, 'SELECT * FROM orders WHERE CAST(id AS TEXT) = ?', [String(id)]);
    }
    return _sqlRowToDoc(updatedRow);
  } catch (sqlErr) {
    if (sqlErr instanceof AppError) throw sqlErr;
    throw new AppError(
      'Eroare la actualizarea comenzii (SQL): ' + sqlErr.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Actualizează statusul unei comenzi.
 * @param {string} id - ID-ul comenzii
 * @param {string} status - Noul status
 * @returns {Promise<Object>} Documentul actualizat
 */
async function updateOrderStatus(id, status) {
  if (!id) {
    throw new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID');
  }

  if (!status || !isValidOrderStatus(status)) {
    throw new AppError(
      `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
      400,
      'INVALID_ORDER_STATUS'
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
        'UPDATE orders SET status = ?, updatedAt = ? WHERE id = ?',
        [status, now, numericId]
      );
    } else {
      result = _dbRun(
        db,
        'UPDATE orders SET status = ?, updatedAt = ? WHERE CAST(id AS TEXT) = ?',
        [status, now, String(id)]
      );
    }

    if (result.changes === 0) {
      throw new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND');
    }

    let updatedRow;
    if (!isNaN(numericId)) {
      updatedRow = _dbGet(db, 'SELECT * FROM orders WHERE id = ?', [numericId]);
    } else {
      updatedRow = _dbGet(db, 'SELECT * FROM orders WHERE CAST(id AS TEXT) = ?', [String(id)]);
    }
    return _sqlRowToDoc(updatedRow);
  } catch (sqlErr) {
    if (sqlErr instanceof AppError) throw sqlErr;
    throw new AppError(
      'Eroare la actualizarea statusului comenzii (SQL): ' + sqlErr.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Actualizează item-urile și totalurile unei comenzi.
 * @param {string} id - ID-ul comenzii
 * @param {Array} items - Noua listă de item-uri
 * @param {number} [subtotal] - Noul subtotal
 * @param {number} [tax] - Noua taxă
 * @param {number} [total] - Noul total
 * @returns {Promise<Object>} Documentul actualizat
 */
async function updateOrderItems(id, items, subtotal, tax, total) {
  if (!id) {
    throw new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID');
  }

  if (!items || !isValidItemsArray(items)) {
    throw new AppError(
      'Comanda trebuie să conțină cel puțin un item valid (menuItemId, name, quantity, price).',
      400,
      'INVALID_ITEMS'
    );
  }

  const finalSubtotal = subtotal !== undefined ? subtotal : 0;
  if (!isValidPositiveNumber(finalSubtotal)) {
    throw new AppError('Subtotalul trebuie să fie un număr pozitiv.', 400, 'INVALID_SUBTOTAL');
  }

  const finalTax = tax !== undefined ? tax : 0;
  if (!isValidPositiveNumber(finalTax)) {
    throw new AppError('Taxa trebuie să fie un număr pozitiv.', 400, 'INVALID_TAX');
  }

  const finalTotal = total !== undefined ? total : 0;
  if (!isValidPositiveNumber(finalTotal)) {
    throw new AppError('Totalul trebuie să fie un număr pozitiv.', 400, 'INVALID_TOTAL');
  }

  const now = new Date().toISOString();
  const itemsJson = JSON.stringify(items);
  const db = await getDb();

  try {
    const numericId = parseInt(id, 10);
    let result;
    if (!isNaN(numericId)) {
      result = _dbRun(
        db,
        'UPDATE orders SET items = ?, subtotal = ?, tax = ?, total = ?, updatedAt = ? WHERE id = ?',
        [itemsJson, finalSubtotal, finalTax, finalTotal, now, numericId]
      );
    } else {
      result = _dbRun(
        db,
        'UPDATE orders SET items = ?, subtotal = ?, tax = ?, total = ?, updatedAt = ? WHERE CAST(id AS TEXT) = ?',
        [itemsJson, finalSubtotal, finalTax, finalTotal, now, String(id)]
      );
    }

    if (result.changes === 0) {
      throw new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND');
    }

    let updatedRow;
    if (!isNaN(numericId)) {
      updatedRow = _dbGet(db, 'SELECT * FROM orders WHERE id = ?', [numericId]);
    } else {
      updatedRow = _dbGet(db, 'SELECT * FROM orders WHERE CAST(id AS TEXT) = ?', [String(id)]);
    }
    return _sqlRowToDoc(updatedRow);
  } catch (sqlErr) {
    if (sqlErr instanceof AppError) throw sqlErr;
    throw new AppError(
      'Eroare la actualizarea item-urilor comenzii (SQL): ' + sqlErr.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Actualizează metoda de plată a unei comenzi.
 * @param {string} id - ID-ul comenzii
 * @param {string} paymentMethod - Noua metodă de plată
 * @returns {Promise<Object>} Documentul actualizat
 */
async function updateOrderPayment(id, paymentMethod) {
  if (!id) {
    throw new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID');
  }

  if (!paymentMethod || !isValidPaymentMethod(paymentMethod)) {
    throw new AppError(
      `Metoda de plată "${paymentMethod}" nu este validă. Metode permise: ${VALID_PAYMENT_METHODS.join(', ')}.`,
      400,
      'INVALID_PAYMENT_METHOD'
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
        'UPDATE orders SET paymentMethod = ?, updatedAt = ? WHERE id = ?',
        [paymentMethod, now, numericId]
      );
    } else {
      result = _dbRun(
        db,
        'UPDATE orders SET paymentMethod = ?, updatedAt = ? WHERE CAST(id AS TEXT) = ?',
        [paymentMethod, now, String(id)]
      );
    }

    if (result.changes === 0) {
      throw new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND');
    }

    let updatedRow;
    if (!isNaN(numericId)) {
      updatedRow = _dbGet(db, 'SELECT * FROM orders WHERE id = ?', [numericId]);
    } else {
      updatedRow = _dbGet(db, 'SELECT * FROM orders WHERE CAST(id AS TEXT) = ?', [String(id)]);
    }
    return _sqlRowToDoc(updatedRow);
  } catch (sqlErr) {
    if (sqlErr instanceof AppError) throw sqlErr;
    throw new AppError(
      'Eroare la actualizarea metodei de plată (SQL): ' + sqlErr.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Șterge o comandă după ID.
 * @param {string} id - ID-ul comenzii
 * @returns {Promise<boolean>} true dacă a fost șters
 */
async function deleteOrder(id) {
  if (!id) {
    throw new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID');
  }

  const db = await getDb();

  try {
    const numericId = parseInt(id, 10);
    let result;
    if (!isNaN(numericId)) {
      result = _dbRun(db, 'DELETE FROM orders WHERE id = ?', [numericId]);
    } else {
      result = _dbRun(db, 'DELETE FROM orders WHERE CAST(id AS TEXT) = ?', [String(id)]);
    }

    if (result.changes === 0) {
      throw new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND');
    }

    return true;
  } catch (sqlErr) {
    if (sqlErr instanceof AppError) throw sqlErr;
    throw new AppError(
      'Eroare la ștergerea comenzii (SQL): ' + sqlErr.message,
      500,
      'DB_DELETE_ERROR'
    );
  }
}

/**
 * Obține numărul total de comenzi dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {string} [status] - Opțional, filtrează după status
 * @returns {Promise<number>}
 */
async function countOrdersByTenant(tenantId, status) {
  if (!tenantId) {
    return 0;
  }

  if (status) {
    if (!isValidOrderStatus(status)) {
      throw new AppError(
        `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
        400,
        'INVALID_ORDER_STATUS'
      );
    }
  }

  const db = await getDb();

  try {
    let sql;
    const params = [tenantId];

    if (status) {
      sql = 'SELECT COUNT(*) AS cnt FROM orders WHERE tenantId = ? AND status = ?';
      params.push(status);
    } else {
      sql = 'SELECT COUNT(*) AS cnt FROM orders WHERE tenantId = ?';
    }

    const row = _dbGet(db, sql, params);
    return row ? row.cnt : 0;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la numărarea comenzilor (SQL): ' + sqlErr.message,
      500,
      'DB_COUNT_ERROR'
    );
  }
}

/**
 * Obține numărul total de comenzi dintr-un restaurant.
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} [status] - Opțional, filtrează după status
 * @returns {Promise<number>}
 */
async function countOrdersByRestaurant(restaurantId, status) {
  if (!restaurantId) {
    return 0;
  }

  if (status) {
    if (!isValidOrderStatus(status)) {
      throw new AppError(
        `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
        400,
        'INVALID_ORDER_STATUS'
      );
    }
  }

  const db = await getDb();

  try {
    let sql;
    const params = [restaurantId];

    if (status) {
      sql = 'SELECT COUNT(*) AS cnt FROM orders WHERE restaurantId = ? AND status = ?';
      params.push(status);
    } else {
      sql = 'SELECT COUNT(*) AS cnt FROM orders WHERE restaurantId = ?';
    }

    const row = _dbGet(db, sql, params);
    return row ? row.cnt : 0;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la numărarea comenzilor (SQL): ' + sqlErr.message,
      500,
      'DB_COUNT_ERROR'
    );
  }
}

/**
 * Obține numărul total de comenzi după status.
 * @param {string} status - Statusul
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<number>}
 */
async function countOrdersByStatus(status, tenantId) {
  if (!status || !isValidOrderStatus(status)) {
    throw new AppError(
      `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
      400,
      'INVALID_ORDER_STATUS'
    );
  }

  const db = await getDb();

  try {
    let sql;
    const params = [status];

    if (tenantId) {
      sql = 'SELECT COUNT(*) AS cnt FROM orders WHERE status = ? AND tenantId = ?';
      params.push(tenantId);
    } else {
      sql = 'SELECT COUNT(*) AS cnt FROM orders WHERE status = ?';
    }

    const row = _dbGet(db, sql, params);
    return row ? row.cnt : 0;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la numărarea comenzilor (SQL): ' + sqlErr.message,
      500,
      'DB_COUNT_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Constante
  VALID_ORDER_STATUSES,
  VALID_PAYMENT_METHODS,

  // Validare
  isValidString,
  isValidPositiveNumber,
  isValidPositiveInt,
  isValidOrderStatus,
  isValidPaymentMethod,
  isValidItemsArray,

  // Operații CRUD de bază
  createOrder,
  findOrderById,
  findOrdersByTenant,
  findOrdersByRestaurant,
  findOrdersByStatus,
  findOrdersByTable,
  findOrdersByPaymentMethod,
  findOrdersByDateRange,
  updateOrder,
  deleteOrder,

  // Operații specifice
  updateOrderStatus,
  updateOrderItems,
  updateOrderPayment,
  countOrdersByTenant,
  countOrdersByRestaurant,
  countOrdersByStatus,

  // Expunere pentru testare și debugging
  _isSqlAvailable,
  _sqlRowToDoc,
};