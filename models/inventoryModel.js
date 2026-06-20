'use strict';

// ---------------------------------------------------------------------------
// Model Inventory – GastroHub
// Operații CRUD pentru tabela `inventory` (SQLite via getDb).
// Expune: createItem, getItemById, getInventoryByTenant, updateItem, deleteItem
// ---------------------------------------------------------------------------

const { getDb } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Categorii valide
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = [
  'alimente',
  'bauturi',
  'consumabile',
  'curatenie',
  'ambalaje',
  'altele',
];

// ---------------------------------------------------------------------------
// CREATE TABLE IF NOT EXISTS (rulat la prima utilizare)
// ---------------------------------------------------------------------------

let _tableEnsured = false;

/**
 * Asigură existența tabelei `inventory`.
 * @param {import('sql.js').Database} db
 */
function _ensureTable(db) {
  if (_tableEnsured) return;
  db.run(`CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    quantity REAL DEFAULT 0,
    unit TEXT DEFAULT 'buc',
    min_quantity REAL DEFAULT 0,
    price_per_unit REAL DEFAULT 0,
    location TEXT,
    tenant_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  _tableEnsured = true;
}

// ---------------------------------------------------------------------------
// Helpers interne pentru interogări SQLite
// ---------------------------------------------------------------------------

/**
 * Execută INSERT / UPDATE / DELETE și returnează { changes, lastInsertRowid }.
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
    changes: (changesRes.length > 0 && changesRes[0].values.length > 0) ? changesRes[0].values[0][0] : 0,
    lastInsertRowid: (lastIdRes.length > 0 && lastIdRes[0].values.length > 0) ? lastIdRes[0].values[0][0] : 0,
  };
}

/**
 * Execută SELECT și returnează primul rând ca obiect, sau undefined.
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Object|undefined}
 */
function _dbGet(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  let row;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

/**
 * Execută SELECT și returnează toate rândurile.
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Array<Object>}
 */
function _dbAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// ---------------------------------------------------------------------------
// Helper: transformă un rând SQL (snake_case) în obiect cu _id
// ---------------------------------------------------------------------------

/**
 * @param {Object|undefined} row - rândul SQLite brut
 * @returns {Object|null}
 */
function _transformRow(row) {
  if (!row) return null;

  return {
    _id: row.id != null ? String(row.id) : null,
    name: row.name,
    category: row.category,
    quantity: row.quantity,
    unit: row.unit,
    min_quantity: row.min_quantity,
    price_per_unit: row.price_per_unit,
    location: row.location,
    tenant_id: row.tenant_id,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// createItem
// ---------------------------------------------------------------------------

/**
 * Creează un item de inventar.
 *
 * @param {Object}  data
 * @param {string}  data.name          - Numele produsului
 * @param {string}  data.category      - Categoria (vezi VALID_CATEGORIES)
 * @param {number}  data.quantity      - Cantitatea inițială
 * @param {string}  data.unit          - Unitatea de măsură
 * @param {number}  data.price_per_unit - Prețul per unitate
 * @param {string}  data.tenant_id     - ID-ul tenant-ului
 * @param {string}  [data.location]    - Locația (opțional)
 * @returns {Promise<Object>} Itemul creat (cu _id)
 * @throws {AppError} Dacă validarea eșuează
 */
async function createItem(data) {
  if (!data || typeof data !== 'object') {
    throw new AppError('Datele itemului sunt invalide.', 400, 'INVALID_ITEM_DATA');
  }

  const {
    name,
    category,
    quantity,
    unit,
    price_per_unit,
    tenant_id,
    location,
  } = data;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new AppError('Numele produsului este obligatoriu.', 400, 'INVALID_NAME');
  }
  const trimmedName = name.trim();
  if (trimmedName.length > 200) {
    throw new AppError('Numele produsului este prea lung (maxim 200 caractere).', 400, 'INVALID_NAME');
  }

  if (!category || !VALID_CATEGORIES.includes(category)) {
    throw new AppError(
      'Categoria "' + category + '" nu este validă. Categorii acceptate: ' + VALID_CATEGORIES.join(', ') + '.',
      400,
      'INVALID_CATEGORY'
    );
  }

  if (quantity === undefined || quantity === null || typeof quantity !== 'number' || isNaN(quantity) || quantity < 0) {
    throw new AppError('Cantitatea trebuie să fie un număr pozitiv.', 400, 'INVALID_QUANTITY');
  }

  if (!unit || typeof unit !== 'string' || unit.trim().length === 0) {
    throw new AppError('Unitatea de măsură este obligatorie.', 400, 'INVALID_UNIT');
  }
  const trimmedUnit = unit.trim();

  if (price_per_unit === undefined || price_per_unit === null || typeof price_per_unit !== 'number' || isNaN(price_per_unit) || price_per_unit < 0) {
    throw new AppError('Prețul trebuie să fie un număr pozitiv.', 400, 'INVALID_PRICE');
  }

  if (!tenant_id) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'INVALID_TENANT_ID');
  }

  const finalLocation = location || '';
  const now = new Date().toISOString();

  try {
    const db = await getDb();
    _ensureTable(db);

    // Verificare duplicat
    const existing = _dbGet(db,
      'SELECT id FROM inventory WHERE name = ? AND tenant_id = ?',
      [trimmedName, tenant_id]
    );

    if (existing) {
      throw new AppError(
        'Un produs cu numele "' + trimmedName + '" există deja în inventar.',
        409,
        'DUPLICATE_ITEM'
      );
    }

    const result = _dbRun(db,
      `INSERT INTO inventory (name, category, quantity, unit, min_quantity, price_per_unit, location, tenant_id, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [trimmedName, category, quantity, trimmedUnit, price_per_unit, finalLocation, tenant_id, now]
    );

    const created = _dbGet(db,
      'SELECT * FROM inventory WHERE id = ?',
      [result.lastInsertRowid]
    );

    if (!created) {
      throw new AppError('Eroare la crearea itemului: nu s-a putut recupera rândul inserat.', 500, 'CREATE_ERROR');
    }

    return _transformRow(created);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la crearea itemului de inventar: ' + err.message,
      500,
      'DB_INSERT_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// getItemById
// ---------------------------------------------------------------------------

/**
 * Găsește un item de inventar după ID.
 *
 * @param {string|number} id - ID-ul itemului
 * @returns {Promise<Object|null>} Itemul sau null dacă nu există
 * @throws {AppError} Dacă ID-ul este invalid
 */
async function getItemById(id) {
  if (!id) {
    throw new AppError('ID-ul itemului este invalid.', 400, 'INVALID_ITEM_ID');
  }

  try {
    const db = await getDb();
    _ensureTable(db);

    const row = _dbGet(db,
      'SELECT * FROM inventory WHERE id = ?',
      [id]
    );

    return _transformRow(row);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la căutarea itemului: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// getInventoryByTenant
// ---------------------------------------------------------------------------

/**
 * Returnează toate itemele de inventar ale unui tenant.
 *
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>} Lista de iteme
 * @throws {AppError} Dacă tenantId lipsește
 */
async function getInventoryByTenant(tenantId) {
  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  try {
    const db = await getDb();
    _ensureTable(db);

    const rows = _dbAll(db,
      'SELECT * FROM inventory WHERE tenant_id = ? ORDER BY name ASC',
      [tenantId]
    );

    return (rows || []).map(_transformRow);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la căutarea itemelor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// updateItem
// ---------------------------------------------------------------------------

/**
 * Actualizează un item de inventar.
 *
 * @param {string|number} id   - ID-ul itemului
 * @param {Object}       data  - Câmpurile de actualizat
 * @returns {Promise<Object>} Itemul actualizat
 * @throws {AppError} Dacă ID-ul este invalid, itemul nu există sau datele sunt invalide
 */
async function updateItem(id, data) {
  if (!id) {
    throw new AppError('ID-ul itemului este invalid.', 400, 'INVALID_ITEM_ID');
  }

  if (!data || typeof data !== 'object') {
    throw new AppError('Datele de actualizare sunt invalide.', 400, 'INVALID_UPDATE_DATA');
  }

  const allowedFields = ['name', 'category', 'quantity', 'unit', 'price_per_unit', 'location'];
  const updates = {};
  const params = [];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      let value = data[field];

      switch (field) {
        case 'name':
          if (typeof value !== 'string' || value.trim().length === 0) {
            throw new AppError('Numele produsului nu poate fi gol.', 400, 'INVALID_NAME');
          }
          value = value.trim();
          if (value.length > 200) {
            throw new AppError('Numele produsului este prea lung (maxim 200 caractere).', 400, 'INVALID_NAME');
          }
          break;

        case 'category':
          if (!VALID_CATEGORIES.includes(value)) {
            throw new AppError(
              'Categoria "' + value + '" nu este validă. Categorii acceptate: ' + VALID_CATEGORIES.join(', ') + '.',
              400,
              'INVALID_CATEGORY'
            );
          }
          break;

        case 'quantity':
          if (typeof value !== 'number' || isNaN(value) || value < 0) {
            throw new AppError('Cantitatea trebuie să fie un număr pozitiv.', 400, 'INVALID_QUANTITY');
          }
          break;

        case 'price_per_unit':
          if (typeof value !== 'number' || isNaN(value) || value < 0) {
            throw new AppError('Prețul trebuie să fie un număr pozitiv.', 400, 'INVALID_PRICE');
          }
          break;

        case 'unit':
          if (typeof value !== 'string' || value.trim().length === 0) {
            throw new AppError('Unitatea de măsură nu poate fi goală.', 400, 'INVALID_UNIT');
          }
          value = value.trim();
          break;

        case 'location':
          if (typeof value !== 'string') {
            value = '';
          }
          break;

        default:
          break;
      }

      updates[field] = value;
      params.push(value);
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new AppError('Nu s-au furnizat câmpuri valide pentru actualizare.', 400, 'NO_VALID_FIELDS');
  }

  const now = new Date().toISOString();

  try {
    const db = await getDb();
    _ensureTable(db);

    const existing = _dbGet(db,
      'SELECT id FROM inventory WHERE id = ?',
      [id]
    );

    if (!existing) {
      throw new AppError('Produsul nu a fost găsit.', 404, 'NOT_FOUND');
    }

    const setClauses = Object.keys(updates).map((field) => field + ' = ?').join(', ');
    params.push(now);
    params.push(id);

    _dbRun(db,
      'UPDATE inventory SET ' + setClauses + ', created_at = ? WHERE id = ?',
      params
    );

    const updated = _dbGet(db,
      'SELECT * FROM inventory WHERE id = ?',
      [id]
    );

    return _transformRow(updated);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la actualizarea itemului: ' + err.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// deleteItem
// ---------------------------------------------------------------------------

/**
 * Șterge un item de inventar după ID.
 *
 * @param {string|number} id - ID-ul itemului
 * @returns {Promise<boolean>} true dacă a fost șters
 * @throws {AppError} Dacă ID-ul este invalid sau itemul nu există
 */
async function deleteItem(id) {
  if (!id) {
    throw new AppError('ID-ul itemului este invalid.', 400, 'INVALID_ITEM_ID');
  }

  try {
    const db = await getDb();
    _ensureTable(db);

    const existing = _dbGet(db,
      'SELECT id FROM inventory WHERE id = ?',
      [id]
    );

    if (!existing) {
      throw new AppError('Produsul nu a fost găsit.', 404, 'NOT_FOUND');
    }

    _dbRun(db,
      'DELETE FROM inventory WHERE id = ?',
      [id]
    );

    return true;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la ștergerea itemului: ' + err.message,
      500,
      'DB_DELETE_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  createItem,
  getItemById,
  getInventoryByTenant,
  updateItem,
  deleteItem,
  VALID_CATEGORIES,
};