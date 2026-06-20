'use strict';

// ---------------------------------------------------------------------------
// Model Delivery – GastroHub
// Model SQLite pentru livrări simulate de la furnizori.
// Câmpuri suportate: supplierId, items (array de {itemId, itemName, quantity,
// unit, price}), status (comandată, în tranzit, livrată, anulată), orderDate,
// estimatedDelivery, actualDelivery, notes, locationId, locationType, tenantId
//
// Backend: SQLite (prin getDb, db.run / db.exec / db.prepare din config/db).
// Tabela: deliveries
// ---------------------------------------------------------------------------

const { getDb } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Helperi DB interni – operează direct pe instanța sql.js Database
// ---------------------------------------------------------------------------

/**
 * Execută o interogare de tip INSERT/UPDATE/DELETE și returnează
 * { changes, lastInsertRowid } folosind db.run și db.exec.
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {{ changes: number, lastInsertRowid: number }}
 */
function _dbRun(db, sql, params = []) {
  db.run(sql, params);
  const lastIdResult = db.exec('SELECT last_insert_rowid() AS id');
  const changesResult = db.exec('SELECT changes() AS cnt');
  return {
    changes:
      changesResult.length > 0 && changesResult[0].values.length > 0
        ? changesResult[0].values[0][0]
        : 0,
    lastInsertRowid:
      lastIdResult.length > 0 && lastIdResult[0].values.length > 0
        ? lastIdResult[0].values[0][0]
        : 0,
  };
}

/**
 * Execută o interogare SELECT și returnează primul rând (sau undefined).
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
 * Execută o interogare SELECT și returnează toate rândurile.
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
// Statusuri valide pentru o livrare
// ---------------------------------------------------------------------------

const VALID_DELIVERY_STATUSES = [
  'comandată',
  'în tranzit',
  'livrată',
  'anulată',
];

// ---------------------------------------------------------------------------
// Tipuri de locații valide
// ---------------------------------------------------------------------------

const VALID_LOCATION_TYPES = ['restaurant', 'hotel'];

// ---------------------------------------------------------------------------
// Unități de măsură valide
// ---------------------------------------------------------------------------

const VALID_UNITS = [
  'kg',
  'g',
  'l',
  'ml',
  'buc',
  'pachet',
  'cutie',
  'sticlă',
  'bax',
  'kg/l',
];

// ---------------------------------------------------------------------------
// Coloanele tabelului deliveries (pentru construire SELECT-uri)
// ---------------------------------------------------------------------------

const DELIVERY_COLUMNS = [
  'id', 'supplierId', 'items', 'status', 'totalValue',
  'orderDate', 'estimatedDelivery', 'actualDelivery', 'notes',
  'locationId', 'locationType', 'tenantId', 'createdAt', 'updatedAt',
].join(', ');

// ---------------------------------------------------------------------------
// Helper: transformă un rând SQL → obiect delivery (backward compatibil)
// ---------------------------------------------------------------------------

/**
 * Parsează coloana items (JSON) într-un array.
 * @param {string|null} raw
 * @returns {Array}
 */
function parseItemsJson(raw) {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

/**
 * Transformă un rând SQL brut în obiectul delivery așteptat de controllere.
 * @param {Object|null} row
 * @returns {Object|null}
 */
function rowToDelivery(row) {
  if (!row) return null;

  return {
    _id: row.id != null ? String(row.id) : null,
    id: row.id != null ? String(row.id) : null,
    supplierId: row.supplierId,
    items: parseItemsJson(row.items),
    status: row.status,
    totalValue: row.totalValue != null ? row.totalValue : 0,
    orderDate: row.orderDate,
    estimatedDelivery: row.estimatedDelivery || null,
    actualDelivery: row.actualDelivery || null,
    notes: row.notes || '',
    locationId: row.locationId,
    locationType: row.locationType,
    tenantId: row.tenantId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un șir nu este gol și are lungimea între limite.
 * @param {*} val
 * @param {number} [min=1]
 * @param {number} [max=255]
 * @returns {boolean}
 */
function isValidString(val, min = 1, max = 255) {
  return typeof val === 'string' && val.trim().length >= min && val.trim().length <= max;
}

/**
 * Verifică dacă un status de livrare este valid.
 * @param {string} status
 * @returns {boolean}
 */
function isValidDeliveryStatus(status) {
  return VALID_DELIVERY_STATUSES.includes(status);
}

/**
 * Verifică dacă un tip de locație este valid.
 * @param {string} locationType
 * @returns {boolean}
 */
function isValidLocationType(locationType) {
  return VALID_LOCATION_TYPES.includes(locationType);
}

/**
 * Verifică dacă o unitate de măsură este validă.
 * @param {string} unit
 * @returns {boolean}
 */
function isValidUnit(unit) {
  return VALID_UNITS.includes(unit);
}

/**
 * Verifică dacă o valoare este un număr pozitiv (preț, cantitate etc.).
 * @param {*} val
 * @returns {boolean}
 */
function isValidPositiveNumber(val) {
  return typeof val === 'number' && !Number.isNaN(val) && val >= 0 && Number.isFinite(val);
}

/**
 * Verifică dacă o dată este un string ISO valid.
 * @param {*} val
 * @returns {boolean}
 */
function isValidISODate(val) {
  if (typeof val !== 'string') return false;
  const date = new Date(val);
  return !isNaN(date.getTime()) && val.length >= 10;
}

/**
 * Verifică dacă un array de itemi de livrare este valid.
 * Fiecare item trebuie să aibă: itemId (string), itemName (string),
 * quantity (number >= 0), unit (string valid), price (number >= 0).
 * @param {*} arr
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateItems(arr) {
  if (!Array.isArray(arr)) {
    return { valid: false, errors: ['Itemii de livrare trebuie să fie o listă.'] };
  }

  if (arr.length === 0) {
    return { valid: false, errors: ['Livrarea trebuie să conțină cel puțin un item.'] };
  }

  const errors = [];

  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    const idx = i + 1;

    if (!item || typeof item !== 'object') {
      errors.push(`Itemul #${idx} este invalid.`);
      continue;
    }

    if (!item.itemId || typeof item.itemId !== 'string' || item.itemId.trim().length === 0) {
      errors.push(`Itemul #${idx}: ID-ul itemului (itemId) este obligatoriu.`);
    }

    if (!item.itemName || typeof item.itemName !== 'string' || item.itemName.trim().length === 0) {
      errors.push(`Itemul #${idx}: numele itemului (itemName) este obligatoriu.`);
    }

    if (item.quantity === undefined || item.quantity === null || !isValidPositiveNumber(item.quantity)) {
      errors.push(`Itemul #${idx}: cantitatea trebuie să fie un număr mai mare sau egal cu 0.`);
    }

    if (!item.unit || !isValidUnit(item.unit)) {
      errors.push(`Itemul #${idx}: unitatea de măsură "${item.unit}" nu este validă. ` +
        `Unități acceptate: ${VALID_UNITS.join(', ')}.`);
    }

    if (item.price === undefined || item.price === null || !isValidPositiveNumber(item.price)) {
      errors.push(`Itemul #${idx}: prețul trebuie să fie un număr mai mare sau egal cu 0.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Calculează valoarea totală a unei livrări pe baza itemilor.
 * @param {Array} items - Lista de itemi
 * @returns {number} Valoarea totală
 */
function calculateTotalValue(items) {
  const total = items.reduce((sum, item) => {
    return sum + (item.quantity * item.price);
  }, 0);
  return +total.toFixed(2);
}

/**
 * Curăță itemii (trim pe stringuri) și returnează o copie curată.
 * @param {Array} items
 * @returns {Array}
 */
function cleanItems(items) {
  return items.map((item) => ({
    itemId: item.itemId.trim(),
    itemName: item.itemName.trim(),
    quantity: item.quantity,
    unit: item.unit,
    price: item.price,
  }));
}

// ---------------------------------------------------------------------------
// Operații CRUD – Deliveries (SQLite)
// ---------------------------------------------------------------------------

/**
 * Creează o livrare nouă.
 *
 * @param {Object} deliveryData - Datele livrării
 * @param {string} deliveryData.supplierId - ID-ul furnizorului (obligatoriu)
 * @param {Array} deliveryData.items - Lista itemilor livrați (obligatoriu)
 * @param {string} [deliveryData.status='comandată'] - Statusul livrării
 * @param {string} [deliveryData.orderDate] - Data comenzii (default: acum)
 * @param {string} [deliveryData.estimatedDelivery] - Data estimată de livrare
 * @param {string} [deliveryData.actualDelivery] - Data efectivă de livrare
 * @param {string} [deliveryData.notes=''] - Note adiționale
 * @param {string} deliveryData.locationId - ID-ul locației (obligatoriu)
 * @param {string} deliveryData.locationType - Tipul locației (obligatoriu: 'restaurant' sau 'hotel')
 * @param {string} deliveryData.tenantId - ID-ul tenant-ului (obligatoriu)
 * @returns {Promise<Object>} Documentul livrării create
 * @throws {AppError} Dacă validarea eșuează
 */
async function createDelivery(deliveryData) {
  // -----------------------------------------------------------------------
  // Validare date de bază
  // -----------------------------------------------------------------------
  if (!deliveryData || typeof deliveryData !== 'object') {
    throw new AppError('Datele livrării sunt invalide.', 400, 'INVALID_DELIVERY_DATA');
  }

  const {
    supplierId,
    items,
    status,
    orderDate,
    estimatedDelivery,
    actualDelivery,
    notes,
    locationId,
    locationType,
    tenantId,
  } = deliveryData;

  // Validare supplierId
  if (!supplierId) {
    throw new AppError(
      'ID-ul furnizorului este obligatoriu.',
      400,
      'MISSING_SUPPLIER_ID'
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

  // Validare locationId
  if (!locationId) {
    throw new AppError(
      'ID-ul locației este obligatoriu.',
      400,
      'MISSING_LOCATION_ID'
    );
  }

  // Validare locationType
  if (!locationType || !isValidLocationType(locationType)) {
    throw new AppError(
      `Tipul locației trebuie să fie "restaurant" sau "hotel".`,
      400,
      'INVALID_LOCATION_TYPE'
    );
  }

  // Validare items
  const itemsValidation = validateItems(items);
  if (!itemsValidation.valid) {
    throw new AppError(
      itemsValidation.errors.join(' '),
      400,
      'INVALID_DELIVERY_ITEMS'
    );
  }

  // Validare status (opțional)
  const finalStatus = status || 'comandată';
  if (!isValidDeliveryStatus(finalStatus)) {
    throw new AppError(
      `Statusul "${finalStatus}" nu este valid. Statusuri permise: ${VALID_DELIVERY_STATUSES.join(', ')}.`,
      400,
      'INVALID_DELIVERY_STATUS'
    );
  }

  // Validare orderDate (opțional, default acum)
  const finalOrderDate = orderDate || new Date().toISOString();
  if (!isValidISODate(finalOrderDate)) {
    throw new AppError(
      'Data comenzii (orderDate) nu este o dată validă.',
      400,
      'INVALID_ORDER_DATE'
    );
  }

  // Validare estimatedDelivery (opțional)
  const finalEstimatedDelivery = estimatedDelivery || null;
  if (finalEstimatedDelivery && !isValidISODate(finalEstimatedDelivery)) {
    throw new AppError(
      'Data estimată de livrare (estimatedDelivery) nu este o dată validă.',
      400,
      'INVALID_ESTIMATED_DELIVERY'
    );
  }

  // Validare actualDelivery (opțional)
  const finalActualDelivery = actualDelivery || null;
  if (finalActualDelivery && !isValidISODate(finalActualDelivery)) {
    throw new AppError(
      'Data efectivă de livrare (actualDelivery) nu este o dată validă.',
      400,
      'INVALID_ACTUAL_DELIVERY'
    );
  }

  // Validare notes (opțional)
  const finalNotes = notes !== undefined && notes !== null ? String(notes).trim() : '';
  if (finalNotes.length > 2000) {
    throw new AppError(
      'Notele pot avea maximum 2000 de caractere.',
      400,
      'INVALID_NOTES'
    );
  }

  // -----------------------------------------------------------------------
  // Calcul valoare totală + curățare itemi
  // -----------------------------------------------------------------------
  const cleanedItems = cleanItems(items);
  const totalValue = calculateTotalValue(cleanedItems);
  const itemsJson = JSON.stringify(cleanedItems);
  const now = new Date().toISOString();

  // -----------------------------------------------------------------------
  // INSERT SQL
  // -----------------------------------------------------------------------
  try {
    const db = await getDb();

    const result = _dbRun(
      db,
      `INSERT INTO deliveries
         (supplierId, items, status, totalValue, orderDate,
          estimatedDelivery, actualDelivery, notes,
          locationId, locationType, tenantId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        supplierId,
        itemsJson,
        finalStatus,
        totalValue,
        finalOrderDate,
        finalEstimatedDelivery,
        finalActualDelivery,
        finalNotes,
        locationId,
        locationType,
        tenantId,
        now,
        now,
      ]
    );

    const created = _dbGet(
      db,
      `SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE id = ?`,
      [result.lastInsertRowid]
    );

    return rowToDelivery(created);
  } catch (err) {
    throw new AppError(
      `Eroare la crearea livrării: ${err.message}`,
      500,
      'DB_INSERT_ERROR'
    );
  }
}

/**
 * Găsește o livrare după ID.
 * @param {string} id - ID-ul SQLite
 * @returns {Promise<Object|null>} Documentul livrării sau null
 */
async function findDeliveryById(id) {
  if (!id) {
    throw new AppError('ID-ul livrării este invalid.', 400, 'INVALID_DELIVERY_ID');
  }

  try {
    const db = await getDb();
    const row = _dbGet(
      db,
      `SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE id = ?`,
      [id]
    );
    return rowToDelivery(row);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea livrării: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește livrări după tenantId.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni de filtrare și sortare
 * @param {string} [options.status] - Filtrare după status
 * @param {string} [options.supplierId] - Filtrare după furnizor
 * @param {string} [options.locationId] - Filtrare după locație
 * @param {string} [options.locationType] - Filtrare după tip locație
 * @param {string} [options.sortBy='orderDate'] - Câmpul de sortare
 * @param {string} [options.sortOrder='desc'] - 'asc' sau 'desc'
 * @param {number} [options.limit] - Limită de rezultate
 * @param {number} [options.skip] - Skip pentru paginare
 * @returns {Promise<Array>} Lista de livrări
 */
async function findDeliveriesByTenant(tenantId, options = {}) {
  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // Validare opțiuni
  if (options.status && !isValidDeliveryStatus(options.status)) {
    throw new AppError(
      `Statusul "${options.status}" nu este valid. Statusuri permise: ${VALID_DELIVERY_STATUSES.join(', ')}.`,
      400,
      'INVALID_DELIVERY_STATUS'
    );
  }

  if (options.locationType && !isValidLocationType(options.locationType)) {
    throw new AppError(
      `Tipul locației trebuie să fie "restaurant" sau "hotel".`,
      400,
      'INVALID_LOCATION_TYPE'
    );
  }

  try {
    const db = await getDb();

    const conditions = ['tenantId = ?'];
    const params = [tenantId];

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    if (options.supplierId) {
      conditions.push('supplierId = ?');
      params.push(options.supplierId);
    }

    if (options.locationId) {
      conditions.push('locationId = ?');
      params.push(options.locationId);
    }

    if (options.locationType) {
      conditions.push('locationType = ?');
      params.push(options.locationType);
    }

    const whereClause = conditions.join(' AND ');

    // Sortare
    const sortField = options.sortBy || 'orderDate';
    // Validează câmpul de sortare pentru a preveni SQL injection
    const allowedSortFields = [
      'orderDate', 'createdAt', 'updatedAt', 'status',
      'totalValue', 'supplierId', 'locationId', 'locationType',
    ];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'orderDate';
    const sortDir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

    let sql = `SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE ${whereClause} ORDER BY ${safeSortField} ${sortDir}`;

    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);

      if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
        sql += ' OFFSET ?';
        params.push(options.skip);
      }
    }

    const rows = _dbAll(db, sql, params);
    return (rows || []).map(rowToDelivery);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea livrărilor: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește livrări după status.
 * @param {string} status - Statusul livrării
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de livrări
 */
async function findDeliveriesByStatus(status, tenantId) {
  if (!status || !isValidDeliveryStatus(status)) {
    throw new AppError(
      `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_DELIVERY_STATUSES.join(', ')}.`,
      400,
      'INVALID_DELIVERY_STATUS'
    );
  }

  try {
    const db = await getDb();

    const conditions = ['status = ?'];
    const params = [status];

    if (tenantId) {
      conditions.push('tenantId = ?');
      params.push(tenantId);
    }

    const whereClause = conditions.join(' AND ');

    const rows = _dbAll(
      db,
      `SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE ${whereClause} ORDER BY orderDate DESC`,
      params
    );

    return (rows || []).map(rowToDelivery);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea livrărilor după status: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește livrări după furnizor.
 * @param {string} supplierId - ID-ul furnizorului
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de livrări
 */
async function findDeliveriesBySupplier(supplierId, tenantId) {
  if (!supplierId) {
    throw new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID');
  }

  try {
    const db = await getDb();

    const conditions = ['supplierId = ?'];
    const params = [supplierId];

    if (tenantId) {
      conditions.push('tenantId = ?');
      params.push(tenantId);
    }

    const whereClause = conditions.join(' AND ');

    const rows = _dbAll(
      db,
      `SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE ${whereClause} ORDER BY orderDate DESC`,
      params
    );

    return (rows || []).map(rowToDelivery);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea livrărilor după furnizor: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește livrări după locație.
 * @param {string} locationId - ID-ul locației
 * @param {string} locationType - Tipul locației
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de livrări
 */
async function findDeliveriesByLocation(locationId, locationType, tenantId) {
  if (!locationId) {
    throw new AppError('ID-ul locației este invalid.', 400, 'INVALID_LOCATION_ID');
  }

  if (!locationType || !isValidLocationType(locationType)) {
    throw new AppError(
      `Tipul locației trebuie să fie "restaurant" sau "hotel".`,
      400,
      'INVALID_LOCATION_TYPE'
    );
  }

  try {
    const db = await getDb();

    const conditions = ['locationId = ?', 'locationType = ?'];
    const params = [locationId, locationType];

    if (tenantId) {
      conditions.push('tenantId = ?');
      params.push(tenantId);
    }

    const whereClause = conditions.join(' AND ');

    const rows = _dbAll(
      db,
      `SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE ${whereClause} ORDER BY orderDate DESC`,
      params
    );

    return (rows || []).map(rowToDelivery);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea livrărilor după locație: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește livrări într-un interval de date.
 * @param {string} startDate - Data de început (ISO string)
 * @param {string} endDate - Data de sfârșit (ISO string)
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de livrări
 */
async function findDeliveriesByDateRange(startDate, endDate, tenantId) {
  if (!startDate || !isValidISODate(startDate)) {
    throw new AppError('Data de început este invalidă.', 400, 'INVALID_START_DATE');
  }

  if (!endDate || !isValidISODate(endDate)) {
    throw new AppError('Data de sfârșit este invalidă.', 400, 'INVALID_END_DATE');
  }

  try {
    const db = await getDb();

    const conditions = ['orderDate >= ?', 'orderDate <= ?'];
    const params = [startDate, endDate];

    if (tenantId) {
      conditions.push('tenantId = ?');
      params.push(tenantId);
    }

    const whereClause = conditions.join(' AND ');

    const rows = _dbAll(
      db,
      `SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE ${whereClause} ORDER BY orderDate DESC`,
      params
    );

    return (rows || []).map(rowToDelivery);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea livrărilor în interval: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Actualizează o livrare.
 * @param {string} id - ID-ul livrării
 * @param {Object} updateData - Câmpurile de actualizat
 * @returns {Promise<Object>} Documentul actualizat
 */
async function updateDelivery(id, updateData) {
  if (!id) {
    throw new AppError('ID-ul livrării este invalid.', 400, 'INVALID_DELIVERY_ID');
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
  const allowedFields = [
    'supplierId', 'items', 'status', 'orderDate',
    'estimatedDelivery', 'actualDelivery', 'notes',
    'locationId', 'locationType',
  ];
  const setClauses = [];
  const params = [];
  const errors = [];

  for (const [key, value] of Object.entries(updateData)) {
    if (!allowedFields.includes(key)) {
      continue; // Ignorăm câmpurile nepermise
    }

    switch (key) {
      case 'supplierId':
        if (!value || typeof value !== 'string' || value.trim().length === 0) {
          errors.push('ID-ul furnizorului este obligatoriu.');
        } else {
          setClauses.push('supplierId = ?');
          params.push(value.trim());
        }
        break;

      case 'items':
        if (value !== undefined && !Array.isArray(value)) {
          errors.push('Itemii de livrare trebuie să fie o listă.');
        } else if (value !== undefined && value.length === 0) {
          errors.push('Livrarea trebuie să conțină cel puțin un item.');
        } else {
          const valResult = validateItems(value);
          if (!valResult.valid) {
            errors.push(valResult.errors.join(' '));
          } else {
            const cleanedItems = cleanItems(value);
            const newTotalValue = calculateTotalValue(cleanedItems);
            setClauses.push('items = ?');
            params.push(JSON.stringify(cleanedItems));
            setClauses.push('totalValue = ?');
            params.push(newTotalValue);
          }
        }
        break;

      case 'status':
        if (!isValidDeliveryStatus(value)) {
          errors.push(`Statusul "${value}" nu este valid. Statusuri permise: ${VALID_DELIVERY_STATUSES.join(', ')}.`);
        } else {
          setClauses.push('status = ?');
          params.push(value);
        }
        break;

      case 'orderDate':
        if (value && !isValidISODate(value)) {
          errors.push('Data comenzii (orderDate) nu este o dată validă.');
        } else {
          setClauses.push('orderDate = ?');
          params.push(value || new Date().toISOString());
        }
        break;

      case 'estimatedDelivery':
        if (value && !isValidISODate(value)) {
          errors.push('Data estimată de livrare (estimatedDelivery) nu este o dată validă.');
        } else {
          setClauses.push('estimatedDelivery = ?');
          params.push(value || null);
        }
        break;

      case 'actualDelivery':
        if (value && !isValidISODate(value)) {
          errors.push('Data efectivă de livrare (actualDelivery) nu este o dată validă.');
        } else {
          setClauses.push('actualDelivery = ?');
          params.push(value || null);
        }
        break;

      case 'notes':
        if (value !== null && value !== undefined && String(value).length > 2000) {
          errors.push('Notele pot avea maximum 2000 de caractere.');
        } else {
          setClauses.push('notes = ?');
          params.push(value !== null && value !== undefined ? String(value).trim() : '');
        }
        break;

      case 'locationId':
        if (!value || typeof value !== 'string' || value.trim().length === 0) {
          errors.push('ID-ul locației este obligatoriu.');
        } else {
          setClauses.push('locationId = ?');
          params.push(value.trim());
        }
        break;

      case 'locationType':
        if (!value || !isValidLocationType(value)) {
          errors.push(`Tipul locației trebuie să fie "restaurant" sau "hotel".`);
        } else {
          setClauses.push('locationType = ?');
          params.push(value);
        }
        break;

      // No default – allowedFields garantează că ajungem doar aici
    }
  }

  if (errors.length > 0) {
    throw new AppError(errors.join(' '), 400, 'VALIDATION_ERROR');
  }

  if (setClauses.length === 0) {
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
  setClauses.push('updatedAt = ?');
  params.push(now);

  // Adăugăm id-ul la final
  params.push(id);

  try {
    const db = await getDb();

    const result = _dbRun(
      db,
      `UPDATE deliveries SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );

    if (result.changes === 0) {
      throw new AppError('Livrarea nu a fost găsită.', 404, 'DELIVERY_NOT_FOUND');
    }

    const updated = _dbGet(
      db,
      `SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE id = ?`,
      [id]
    );

    return rowToDelivery(updated);
  } catch (err) {
    // Dacă eroarea este deja un AppError (ex: DELIVERY_NOT_FOUND), o pasăm mai departe
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(
      `Eroare la actualizarea livrării: ${err.message}`,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Actualizează statusul unei livrări.
 * @param {string} id - ID-ul livrării
 * @param {string} status - Noul status
 * @returns {Promise<Object>} Documentul actualizat
 */
async function updateDeliveryStatus(id, status) {
  if (!id) {
    throw new AppError('ID-ul livrării este invalid.', 400, 'INVALID_DELIVERY_ID');
  }

  if (!status || !isValidDeliveryStatus(status)) {
    throw new AppError(
      `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_DELIVERY_STATUSES.join(', ')}.`,
      400,
      'INVALID_DELIVERY_STATUS'
    );
  }

  const now = new Date().toISOString();
  const setClauses = ['status = ?', 'updatedAt = ?'];
  const params = [status, now];

  // Dacă statusul este 'livrată' și nu există actualDelivery, o setăm acum
  if (status === 'livrată') {
    setClauses.push('actualDelivery = ?');
    params.push(now);
  }

  // Adăugăm id-ul
  params.push(id);

  try {
    const db = await getDb();

    const result = _dbRun(
      db,
      `UPDATE deliveries SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );

    if (result.changes === 0) {
      throw new AppError('Livrarea nu a fost găsită.', 404, 'DELIVERY_NOT_FOUND');
    }

    const updated = _dbGet(
      db,
      `SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE id = ?`,
      [id]
    );

    return rowToDelivery(updated);
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(
      `Eroare la actualizarea statusului livrării: ${err.message}`,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Șterge o livrare după ID.
 * @param {string} id - ID-ul livrării
 * @returns {Promise<boolean>} true dacă a fost ștearsă
 */
async function deleteDelivery(id) {
  if (!id) {
    throw new AppError('ID-ul livrării este invalid.', 400, 'INVALID_DELIVERY_ID');
  }

  try {
    const db = await getDb();

    const result = _dbRun(db, 'DELETE FROM deliveries WHERE id = ?', [id]);

    if (result.changes === 0) {
      throw new AppError('Livrarea nu a fost găsită.', 404, 'DELIVERY_NOT_FOUND');
    }

    return true;
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(
      `Eroare la ștergerea livrării: ${err.message}`,
      500,
      'DB_DELETE_ERROR'
    );
  }
}

/**
 * Numără livrările dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni de filtrare
 * @param {string} [options.status] - Filtrare după status
 * @returns {Promise<number>}
 */
async function countDeliveries(tenantId, options = {}) {
  if (!tenantId) {
    return 0;
  }

  if (options.status && !isValidDeliveryStatus(options.status)) {
    throw new AppError(
      `Statusul "${options.status}" nu este valid. Statusuri permise: ${VALID_DELIVERY_STATUSES.join(', ')}.`,
      400,
      'INVALID_DELIVERY_STATUS'
    );
  }

  try {
    const db = await getDb();

    const conditions = ['tenantId = ?'];
    const params = [tenantId];

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    const whereClause = conditions.join(' AND ');

    const row = _dbGet(
      db,
      `SELECT COUNT(*) AS cnt FROM deliveries WHERE ${whereClause}`,
      params
    );

    return row ? row.cnt : 0;
  } catch (err) {
    throw new AppError(
      `Eroare la numărarea livrărilor: ${err.message}`,
      500,
      'DB_COUNT_ERROR'
    );
  }
}

/**
 * Obține valoarea totală a livrărilor dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni de filtrare
 * @param {string} [options.status] - Filtrare după status
 * @returns {Promise<number>} Valoarea totală
 */
function getTotalDeliveryValue(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return resolve(0);
    }

    if (options.status && !isValidDeliveryStatus(options.status)) {
      return reject(new AppError(
        `Statusul "${options.status}" nu este valid. Statusuri permise: ${VALID_DELIVERY_STATUSES.join(', ')}.`,
        400,
        'INVALID_DELIVERY_STATUS'
      ));
    }

    try {
      const conditions = ['tenantId = ?'];
      const params = [tenantId];

      if (options.status) {
        conditions.push('status = ?');
        params.push(options.status);
      }

      const whereClause = conditions.join(' AND ');

      const row = get(
        `SELECT COALESCE(SUM(totalValue), 0) AS total FROM deliveries WHERE ${whereClause}`,
        params
      );

      const total = row ? row.total : 0;
      resolve(+Number(total).toFixed(2));
    } catch (err) {
      return reject(new AppError(
        `Eroare la obținerea valorii totale: ${err.message}`,
        500,
        'DB_QUERY_ERROR'
      ));
    }
  });
}

/**
 * Obține statistici agregate pe statusuri pentru un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Statistici pe statusuri
 */
function getDeliveryStatsByStatus(tenantId) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return resolve({});
    }

    try {
      const rows = all(
        `SELECT status, COUNT(*) AS cnt, COALESCE(SUM(totalValue), 0) AS totalValue
         FROM deliveries
         WHERE tenantId = ?
         GROUP BY status`,
        [tenantId]
      );

      const stats = {};
      for (const row of (rows || [])) {
        stats[row.status] = {
          count: row.cnt,
          totalValue: +Number(row.totalValue).toFixed(2),
        };
      }

      resolve(stats);
    } catch (err) {
      return reject(new AppError(
        `Eroare la obținerea statisticilor: ${err.message}`,
        500,
        'DB_QUERY_ERROR'
      ));
    }
  });
}

/**
 * Șterge toate livrările unui tenant (util pentru cleanup în teste).
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>} Numărul de livrări șterse
 */
function deleteDeliveriesByTenant(tenantId) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return resolve(0);
    }

    try {
      const result = run('DELETE FROM deliveries WHERE tenantId = ?', [tenantId]);
      resolve(result.changes || 0);
    } catch (err) {
      return reject(new AppError(
        `Eroare la ștergerea livrărilor: ${err.message}`,
        500,
        'DB_DELETE_ERROR'
      ));
    }
  });
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Constante
  VALID_DELIVERY_STATUSES,
  VALID_LOCATION_TYPES,
  VALID_UNITS,

  // Funcții de validare
  isValidString,
  isValidDeliveryStatus,
  isValidLocationType,
  isValidUnit,
  isValidPositiveNumber,
  isValidISODate,
  validateItems,
  calculateTotalValue,

  // CRUD
  createDelivery,
  findDeliveryById,
  findDeliveriesByTenant,
  findDeliveriesByStatus,
  findDeliveriesBySupplier,
  findDeliveriesByLocation,
  findDeliveriesByDateRange,
  updateDelivery,
  updateDeliveryStatus,
  deleteDelivery,

  // Agregări și statistici
  countDeliveries,
  getTotalDeliveryValue,
  getDeliveryStatsByStatus,

  // Utilitare
  deleteDeliveriesByTenant,
};