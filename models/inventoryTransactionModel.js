'use strict';

// ---------------------------------------------------------------------------
// Model InventoryTransaction – GastroHub
// Model SQL (sql.js/SQLite) pentru tranzacții de inventar.
// Tabela: inventory_transactions
// ---------------------------------------------------------------------------

const { getDb } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Tipuri de tranzacții valide
// ---------------------------------------------------------------------------

const VALID_TRANSACTION_TYPES = [
  'intrare',
  'ieșire',
  'ajustare',
  'transfer',
];

// ---------------------------------------------------------------------------
// Helper-e locale care folosesc direct API-ul sql.js (db.prepare / db.run / db.exec)
// ---------------------------------------------------------------------------

/**
 * Execută un SELECT și returnează primul rând (sau undefined).
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Object|undefined}
 */
function _queryOne(db, sql, params = []) {
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
 * Execută un SELECT și returnează toate rândurile ca array.
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Array<Object>}
 */
function _queryAll(db, sql, params = []) {
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
 * Execută un INSERT/UPDATE/DELETE și returnează { changes, lastInsertRowid }.
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {{ changes: number, lastInsertRowid: number }}
 */
function _execRun(db, sql, params = []) {
  db.run(sql, params);
  const changesResult = db.exec('SELECT changes() AS cnt');
  const lastIdResult = db.exec('SELECT last_insert_rowid() AS id');
  return {
    changes: (changesResult.length > 0 && changesResult[0].values.length > 0)
      ? changesResult[0].values[0][0]
      : 0,
    lastInsertRowid: (lastIdResult.length > 0 && lastIdResult[0].values.length > 0)
      ? lastIdResult[0].values[0][0]
      : 0,
  };
}

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un tip de tranzacție este valid.
 * @param {string} type
 * @returns {boolean}
 */
function isValidTransactionType(type) {
  return VALID_TRANSACTION_TYPES.includes(type);
}

/**
 * Verifică dacă o cantitate este un număr valid (pozitiv, > 0).
 * @param {*} quantity
 * @returns {boolean}
 */
function isValidQuantity(quantity) {
  return typeof quantity === 'number' && !isNaN(quantity) && quantity > 0;
}

// ---------------------------------------------------------------------------
// Helper: transformă un rând SQL (raw) în obiect cu nume consistente de câmpuri
// ---------------------------------------------------------------------------

/**
 * @param {Object} row - rândul returnat de SQLite
 * @returns {Object} obiectul transformat
 */
function transformRow(row) {
  if (!row) return null;

  return {
    _id: row.id != null ? String(row.id) : null,
    id: row.id != null ? String(row.id) : null,
    tenantId: row.tenantId,
    itemId: row.itemId,
    type: row.type,
    quantity: row.quantity,
    previousQty: row.previousQty,
    newQty: row.newQty,
    referenceId: row.referenceId,
    referenceType: row.referenceType,
    notes: row.notes,
    performedBy: row.performedBy,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Operații CRUD
// ---------------------------------------------------------------------------

/**
 * Creează o tranzacție de inventar nouă.
 *
 * @param {Object} txData - Datele tranzacției
 * @param {string} txData.tenantId - ID-ul tenant-ului
 * @param {string} txData.itemId - ID-ul itemului de inventar
 * @param {string} txData.type - Tipul tranzacției ('intrare', 'ieșire', 'ajustare', 'transfer')
 * @param {number} txData.quantity - Cantitatea tranzacționată
 * @param {number} [txData.previousQty=0] - Cantitatea anterioară
 * @param {number} [txData.newQty=0] - Cantitatea nouă
 * @param {string} [txData.referenceId=null] - ID-ul de referință (ex: livrare, comandă)
 * @param {string} [txData.referenceType=null] - Tipul referinței (ex: 'delivery', 'order')
 * @param {string} [txData.notes=''] - Note
 * @param {string} [txData.performedBy=null] - Cine a efectuat tranzacția
 * @returns {Promise<Object>} Tranzacția creată
 * @throws {AppError} Dacă validarea eșuează
 */
async function createInventoryTransaction(txData) {
  // Validare câmpuri obligatorii
  if (!txData || typeof txData !== 'object') {
    throw new AppError('Datele tranzacției de inventar sunt invalide.', 400, 'INVALID_TRANSACTION_DATA');
  }

  const {
    tenantId,
    itemId,
    type,
    quantity,
    previousQty,
    newQty,
    referenceId,
    referenceType,
    notes,
    performedBy,
  } = txData;

  // Validare tenantId
  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'INVALID_TENANT_ID');
  }

  // Validare itemId
  if (!itemId) {
    throw new AppError('ID-ul itemului de inventar este obligatoriu.', 400, 'INVALID_ITEM_ID');
  }

  // Validare type
  if (!type || !isValidTransactionType(type)) {
    throw new AppError(
      'Tipul tranzacției "' + type + '" nu este valid. Tipuri acceptate: ' + VALID_TRANSACTION_TYPES.join(', ') + '.',
      400,
      'INVALID_TRANSACTION_TYPE'
    );
  }

  // Validare quantity
  if (quantity === undefined || quantity === null || !isValidQuantity(quantity)) {
    throw new AppError(
      'Cantitatea trebuie să fie un număr mai mare decât 0.',
      400,
      'INVALID_QUANTITY'
    );
  }

  const finalPreviousQty = (previousQty !== undefined && previousQty !== null) ? previousQty : 0;
  const finalNewQty = (newQty !== undefined && newQty !== null) ? newQty : 0;
  const finalReferenceId = referenceId !== undefined ? referenceId : null;
  const finalReferenceType = referenceType !== undefined ? referenceType : null;
  const finalNotes = notes !== undefined ? notes : '';
  const finalPerformedBy = performedBy !== undefined ? performedBy : null;
  const now = new Date().toISOString();

  try {
    const db = await getDb();

    const result = _execRun(db,
      `INSERT INTO inventory_transactions
       (tenantId, itemId, type, quantity, previousQty, newQty, referenceId, referenceType, notes, performedBy, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, itemId, type, quantity, finalPreviousQty, finalNewQty, finalReferenceId, finalReferenceType, finalNotes, finalPerformedBy, now]
    );

    const created = _queryOne(db,
      'SELECT * FROM inventory_transactions WHERE id = ?',
      [result.lastInsertRowid]
    );

    return transformRow(created);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la crearea tranzacției de inventar: ' + err.message,
      500,
      'DB_INSERT_ERROR'
    );
  }
}

/**
 * Găsește o tranzacție de inventar după ID.
 * @param {string|number} id - ID-ul tranzacției
 * @returns {Promise<Object|null>} Tranzacția sau null
 */
async function findInventoryTransactionById(id) {
  if (!id) {
    throw new AppError('ID-ul tranzacției de inventar este invalid.', 400, 'INVALID_TRANSACTION_ID');
  }

  try {
    const db = await getDb();

    const row = _queryOne(db,
      'SELECT * FROM inventory_transactions WHERE id = ?',
      [id]
    );

    return transformRow(row);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la căutarea tranzacției: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește tranzacțiile de inventar după tenantId.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options] - Opțiuni de filtrare suplimentare
 * @param {string} [options.itemId] - Filtrare după item
 * @param {string} [options.type] - Filtrare după tipul tranzacției
 * @param {string} [options.referenceId] - Filtrare după referință
 * @param {string} [options.referenceType] - Filtrare după tipul referinței
 * @param {string} [options.sortBy='createdAt'] - Câmpul după care se sortează
 * @param {string} [options.sortOrder='desc'] - 'asc' sau 'desc'
 * @param {number} [options.limit] - Numărul maxim de rezultate
 * @param {number} [options.offset] - Offset pentru paginare
 * @returns {Promise<Array>} Lista de tranzacții
 */
async function findInventoryTransactionsByTenant(tenantId, options) {
  if (!options) options = {};

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  try {
    const db = await getDb();

    const conditions = ['tenantId = ?'];
    const params = [tenantId];

    if (options.itemId) {
      conditions.push('itemId = ?');
      params.push(options.itemId);
    }

    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    if (options.referenceId) {
      conditions.push('referenceId = ?');
      params.push(options.referenceId);
    }

    if (options.referenceType) {
      conditions.push('referenceType = ?');
      params.push(options.referenceType);
    }

    const sortBy = options.sortBy || 'createdAt';
    // Mapare nume de câmpuri la coloane reale
    const columnMap = {
      id: 'id',
      tenantId: 'tenantId',
      itemId: 'itemId',
      type: 'type',
      quantity: 'quantity',
      previousQty: 'previousQty',
      newQty: 'newQty',
      referenceId: 'referenceId',
      referenceType: 'referenceType',
      performedBy: 'performedBy',
      createdAt: 'createdAt',
    };
    const sortColumn = columnMap[sortBy] || 'createdAt';
    const sortDir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

    const whereClause = conditions.join(' AND ');

    let sql = 'SELECT * FROM inventory_transactions WHERE ' + whereClause + ' ORDER BY ' + sortColumn + ' ' + sortDir;

    if (options.limit !== undefined && options.limit !== null) {
      sql += ' LIMIT ' + parseInt(options.limit, 10);
    }
    if (options.offset !== undefined && options.offset !== null) {
      sql += ' OFFSET ' + parseInt(options.offset, 10);
    }

    const rows = _queryAll(db, sql, params);

    return (rows || []).map(transformRow);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la căutarea tranzacțiilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește tranzacțiile de inventar pentru un anumit item.
 * @param {string} itemId - ID-ul itemului de inventar
 * @param {Object} [options] - Opțiuni de filtrare suplimentare
 * @param {string} [options.type] - Filtrare după tipul tranzacției
 * @param {string} [options.sortBy='createdAt'] - Câmpul după care se sortează
 * @param {string} [options.sortOrder='desc'] - 'asc' sau 'desc'
 * @param {number} [options.limit] - Numărul maxim de rezultate
 * @returns {Promise<Array>} Lista de tranzacții
 */
async function findInventoryTransactionsByItem(itemId, options) {
  if (!options) options = {};

  if (!itemId) {
    throw new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID');
  }

  try {
    const db = await getDb();

    const conditions = ['itemId = ?'];
    const params = [itemId];

    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    const sortBy = options.sortBy || 'createdAt';
    const columnMap = {
      id: 'id',
      type: 'type',
      quantity: 'quantity',
      createdAt: 'createdAt',
    };
    const sortColumn = columnMap[sortBy] || 'createdAt';
    const sortDir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

    const whereClause = conditions.join(' AND ');

    let sql = 'SELECT * FROM inventory_transactions WHERE ' + whereClause + ' ORDER BY ' + sortColumn + ' ' + sortDir;

    if (options.limit !== undefined && options.limit !== null) {
      sql += ' LIMIT ' + parseInt(options.limit, 10);
    }

    const rows = _queryAll(db, sql, params);

    return (rows || []).map(transformRow);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la căutarea tranzacțiilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește tranzacțiile de inventar după referință (ex: livrare, comandă).
 * @param {string} referenceId - ID-ul de referință
 * @param {string} [referenceType] - Tipul referinței (opțional)
 * @returns {Promise<Array>} Lista de tranzacții
 */
async function findInventoryTransactionsByReference(referenceId, referenceType) {
  if (!referenceId) {
    throw new AppError('ID-ul de referință este invalid.', 400, 'INVALID_REFERENCE_ID');
  }

  try {
    const db = await getDb();

    let sql = 'SELECT * FROM inventory_transactions WHERE referenceId = ?';
    const params = [referenceId];

    if (referenceType) {
      sql += ' AND referenceType = ?';
      params.push(referenceType);
    }

    sql += ' ORDER BY createdAt DESC';

    const rows = _queryAll(db, sql, params);

    return (rows || []).map(transformRow);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la căutarea tranzacțiilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Șterge o tranzacție de inventar după ID.
 * @param {string|number} id - ID-ul tranzacției
 * @returns {Promise<boolean>} true dacă a fost șters
 */
async function deleteInventoryTransaction(id) {
  if (!id) {
    throw new AppError('ID-ul tranzacției de inventar este invalid.', 400, 'INVALID_TRANSACTION_ID');
  }

  try {
    const db = await getDb();

    // Verificăm mai întâi dacă tranzacția există
    const existing = _queryOne(db,
      'SELECT id FROM inventory_transactions WHERE id = ?',
      [id]
    );

    if (!existing) {
      throw new AppError('Tranzacția de inventar nu a fost găsită.', 404, 'TRANSACTION_NOT_FOUND');
    }

    const result = _execRun(db,
      'DELETE FROM inventory_transactions WHERE id = ?',
      [id]
    );

    if (result.changes === 0) {
      throw new AppError('Tranzacția de inventar nu a fost găsită.', 404, 'TRANSACTION_NOT_FOUND');
    }

    return true;
  } catch (err) {
    // Reverificare: dacă eroarea este deja AppError (ex: 404), o pasăm mai departe
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la ștergerea tranzacției: ' + err.message,
      500,
      'DB_DELETE_ERROR'
    );
  }
}

/**
 * Numără tranzacțiile de inventar dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.itemId] - Filtrare după item
 * @param {string} [options.type] - Filtrare după tip
 * @returns {Promise<number>}
 */
async function countInventoryTransactions(tenantId, options) {
  if (!options) options = {};

  if (!tenantId) {
    return 0;
  }

  try {
    const db = await getDb();

    const conditions = ['tenantId = ?'];
    const params = [tenantId];

    if (options.itemId) {
      conditions.push('itemId = ?');
      params.push(options.itemId);
    }

    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    const whereClause = conditions.join(' AND ');

    const row = _queryOne(db,
      'SELECT COUNT(*) AS cnt FROM inventory_transactions WHERE ' + whereClause,
      params
    );

    return row ? row.cnt : 0;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la numărarea tranzacțiilor: ' + err.message,
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
  VALID_TRANSACTION_TYPES,

  // Validare
  isValidTransactionType,
  isValidQuantity,

  // Operații CRUD
  createInventoryTransaction,
  findInventoryTransactionById,
  findInventoryTransactionsByTenant,
  findInventoryTransactionsByItem,
  findInventoryTransactionsByReference,
  deleteInventoryTransaction,
  countInventoryTransactions,
};