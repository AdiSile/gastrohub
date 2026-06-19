'use strict';

// ---------------------------------------------------------------------------
// Model InventoryTransaction – GastroHub
// Model SQL (sql.js/SQLite) pentru tranzacții de inventar (intrări, ieșiri,
// pierderi).
// Tabela: inventory_transactions
//
// Coloane SQL:
//   id (INTEGER PK), tenantId, itemId, type, quantity, unitPrice, totalPrice,
//   referenceType, referenceId, notes, performedBy, createdAt
//
// Câmpurile adiționale din API-ul vechi (unit, locationId, locationType,
// userId, reference, previousQuantity, newQuantity) sunt serializate în
// coloana notes (JSON) pentru backward compatibility.
// ---------------------------------------------------------------------------

const { getDb, get, all, run } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Tipuri de tranzacții valide
// ---------------------------------------------------------------------------

const VALID_TRANSACTION_TYPES = ['intrare', 'ieșire', 'pierdere'];

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
// Tipuri de locații valide
// ---------------------------------------------------------------------------

const VALID_LOCATION_TYPES = ['restaurant', 'hotel'];

// ---------------------------------------------------------------------------
// Helper: parsează câmpurile extinse din notes (JSON)
// ---------------------------------------------------------------------------

/**
 * Parsează coloana notes (JSON) și returnează un obiect cu câmpurile extinse.
 * @param {string|null} notesRaw - Valoarea brută din coloana notes
 * @returns {Object} Câmpurile extinse
 */
function parseExtendedFields(notesRaw) {
  if (!notesRaw || typeof notesRaw !== 'string') {
    return {
      unit: 'buc',
      locationId: '',
      locationType: '',
      previousQuantity: null,
      newQuantity: null,
    };
  }

  try {
    const parsed = JSON.parse(notesRaw);
    return {
      unit: parsed.unit || 'buc',
      locationId: parsed.locationId || '',
      locationType: parsed.locationType || '',
      previousQuantity: parsed.previousQuantity != null ? parsed.previousQuantity : null,
      newQuantity: parsed.newQuantity != null ? parsed.newQuantity : null,
      reference: parsed.reference || '',
    };
  } catch (_e) {
    return {
      unit: notesRaw || 'buc',
      locationId: '',
      locationType: '',
      previousQuantity: null,
      newQuantity: null,
    };
  }
}

/**
 * Serializează câmpurile extinse într-un JSON pentru coloana notes.
 * @param {Object} fields
 * @returns {string}
 */
function serializeExtendedFields(fields) {
  const obj = {};
  if (fields.unit !== undefined && fields.unit !== 'buc') {
    obj.unit = fields.unit;
  }
  if (fields.locationId) {
    obj.locationId = fields.locationId;
  }
  if (fields.locationType) {
    obj.locationType = fields.locationType;
  }
  if (fields.previousQuantity !== undefined && fields.previousQuantity !== null) {
    obj.previousQuantity = fields.previousQuantity;
  }
  if (fields.newQuantity !== undefined && fields.newQuantity !== null) {
    obj.newQuantity = fields.newQuantity;
  }
  if (fields.reference) {
    obj.reference = fields.reference;
  }
  return JSON.stringify(obj);
}

// ---------------------------------------------------------------------------
// Helper: transformă un rând SQL (raw) în obiect cu nume vechi de câmpuri
// (backward compatibility cu NeDB).
// ---------------------------------------------------------------------------

/**
 * @param {Object} row - rândul returnat de SQLite
 * @returns {Object|null} obiectul transformat
 */
function transformRow(row) {
  if (!row) return null;

  const extended = parseExtendedFields(row.notes);

  return {
    _id: row.id != null ? String(row.id) : null,
    id: row.id != null ? String(row.id) : null,
    itemId: row.itemId,
    type: row.type,
    quantity: row.quantity,
    unit: extended.unit,
    note: row.notes_raw || '',
    reference: extended.reference || row.referenceType || '',
    referenceType: row.referenceType || '',
    referenceId: row.referenceId || '',
    userId: row.performedBy || '',
    performedBy: row.performedBy || '',
    previousQuantity: extended.previousQuantity,
    newQuantity: extended.newQuantity,
    unitPrice: row.unitPrice,
    totalPrice: row.totalPrice,
    locationId: extended.locationId,
    locationType: extended.locationType,
    tenantId: row.tenantId,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un ID este un șir nevid.
 * @param {*} id
 * @returns {boolean}
 */
function isValidId(id) {
  return typeof id === 'string' && id.trim().length > 0;
}

/**
 * Verifică dacă un tip de tranzacție este valid.
 * @param {string} type
 * @returns {boolean}
 */
function isValidTransactionType(type) {
  return VALID_TRANSACTION_TYPES.includes(type);
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
 * Verifică dacă un tip de locație este valid.
 * @param {string} locationType
 * @returns {boolean}
 */
function isValidLocationType(locationType) {
  return VALID_LOCATION_TYPES.includes(locationType);
}

/**
 * Verifică dacă o cantitate este un număr valid (> 0).
 * @param {*} quantity
 * @returns {boolean}
 */
function isValidQuantity(quantity) {
  return typeof quantity === 'number' && !isNaN(quantity) && quantity > 0;
}

// ---------------------------------------------------------------------------
// Operații CRUD
// ---------------------------------------------------------------------------

/**
 * Creează o tranzacție de inventar nouă.
 *
 * @param {Object} transactionData - Datele tranzacției
 * @param {string} transactionData.itemId - ID-ul itemului de inventar
 * @param {string} transactionData.type - Tipul tranzacției (intrare/ieșire/pierdere)
 * @param {number} transactionData.quantity - Cantitatea tranzacționată
 * @param {string} transactionData.unit - Unitatea de măsură
 * @param {string} [transactionData.note] - Notă opțională
 * @param {string} [transactionData.reference] - Referință opțională (ex. număr factură, comandă)
 * @param {string} [transactionData.userId] - ID-ul utilizatorului (vechiul API)
 * @param {string} [transactionData.performedBy] - ID-ul utilizatorului (noul API, prioritar)
 * @param {number} [transactionData.previousQuantity] - Cantitatea anterioară (opțional)
 * @param {number} [transactionData.newQuantity] - Cantitatea nouă (opțional)
 * @param {string} transactionData.locationId - ID-ul locației
 * @param {string} transactionData.locationType - Tipul locației ('restaurant' sau 'hotel')
 * @param {string} transactionData.tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Documentul tranzacției create
 * @throws {AppError} Dacă validarea eșuează
 */
function createInventoryTransaction(transactionData) {
  // -----------------------------------------------------------------------
  // Validare câmpuri obligatorii
  // -----------------------------------------------------------------------
  if (!transactionData || typeof transactionData !== 'object') {
    return Promise.reject(new AppError('Datele tranzacției de inventar sunt invalide.', 400, 'INVALID_TRANSACTION_DATA'));
  }

  const {
    itemId,
    type,
    quantity,
    unit,
    note,
    reference,
    userId,
    performedBy,
    previousQuantity,
    newQuantity,
    locationId,
    locationType,
    tenantId,
    unitPrice,
    totalPrice,
    referenceType,
    referenceId,
    notes: notesField,
  } = transactionData;

  // Rezolvăm userId: poate veni ca performedBy (noul API) sau userId (vechiul API)
  const resolvedUserId = performedBy || userId;

  // Validare itemId
  if (!itemId || !isValidId(itemId)) {
    return Promise.reject(new AppError(
      'ID-ul itemului de inventar este obligatoriu și trebuie să fie un șir nevid.',
      400,
      'INVALID_ITEM_ID'
    ));
  }

  // Validare type
  if (!type || !isValidTransactionType(type)) {
    return Promise.reject(new AppError(
      'Tipul tranzacției "' + type + '" nu este valid. Tipuri acceptate: ' + VALID_TRANSACTION_TYPES.join(', ') + '.',
      400,
      'INVALID_TRANSACTION_TYPE'
    ));
  }

  // Validare quantity
  if (quantity === undefined || quantity === null || !isValidQuantity(quantity)) {
    return Promise.reject(new AppError(
      'Cantitatea trebuie să fie un număr mai mare decât 0.',
      400,
      'INVALID_QUANTITY'
    ));
  }

  // Validare unit
  if (!unit || !isValidUnit(unit)) {
    return Promise.reject(new AppError(
      'Unitatea de măsură "' + unit + '" nu este validă. Unități acceptate: ' + VALID_UNITS.join(', ') + '.',
      400,
      'INVALID_UNIT'
    ));
  }

  // Validare userId / performedBy
  if (!resolvedUserId || !isValidId(resolvedUserId)) {
    return Promise.reject(new AppError(
      'ID-ul utilizatorului (userId sau performedBy) este obligatoriu și trebuie să fie un șir nevid.',
      400,
      'INVALID_USER_ID'
    ));
  }

  // Validare locationId
  if (!locationId || !isValidId(locationId)) {
    return Promise.reject(new AppError(
      'ID-ul locației este obligatoriu și trebuie să fie un șir nevid.',
      400,
      'INVALID_LOCATION_ID'
    ));
  }

  // Validare locationType
  if (!locationType || !isValidLocationType(locationType)) {
    return Promise.reject(new AppError(
      'Tipul locației trebuie să fie "restaurant" sau "hotel".',
      400,
      'INVALID_LOCATION_TYPE'
    ));
  }

  // Validare tenantId
  if (!tenantId || !isValidId(tenantId)) {
    return Promise.reject(new AppError(
      'ID-ul tenant-ului este obligatoriu și trebuie să fie un șir nevid.',
      400,
      'INVALID_TENANT_ID'
    ));
  }

  // -----------------------------------------------------------------------
  // Construire câmpuri extinse în notes
  // -----------------------------------------------------------------------
  const extendedFields = {
    unit,
    locationId,
    locationType,
    previousQuantity,
    newQuantity,
    reference,
  };

  const notesJson = serializeExtendedFields(extendedFields);

  // Combinăm note-ul text (dacă există) cu câmpurile extinse
  // Dacă avem un câmp `notes` explicit (noul API), îl folosim
  // Altfel construim din note + extended
  const finalNotes = notesField !== undefined
    ? notesField
    : (note ? note + ' | ' + notesJson : notesJson);

  // Rezolvăm referenceType și referenceId
  const finalReferenceType = referenceType || (reference ? 'reference' : null);
  const finalReferenceId = referenceId || reference || null;

  // Rezolvăm unitPrice și totalPrice
  const finalUnitPrice = (unitPrice !== undefined && unitPrice !== null) ? unitPrice : 0;
  const finalTotalPrice = (totalPrice !== undefined && totalPrice !== null) ? totalPrice : 0;

  try {
    const db = getDb();
    const now = new Date().toISOString();

    const result = run(
      'INSERT INTO inventory_transactions (tenantId, itemId, type, quantity, unitPrice, totalPrice, referenceType, referenceId, notes, performedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        tenantId.trim(),
        itemId.trim(),
        type,
        quantity,
        finalUnitPrice,
        finalTotalPrice,
        finalReferenceType,
        finalReferenceId,
        finalNotes,
        resolvedUserId.trim(),
        now,
      ]
    );

    const newId = result.lastInsertRowid;

    // Returnăm obiectul creat
    const created = get(
      'SELECT id, tenantId, itemId, type, quantity, unitPrice, totalPrice, referenceType, referenceId, notes, performedBy, createdAt FROM inventory_transactions WHERE id = ?',
      [newId]
    );

    return Promise.resolve(transformRow(created));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la crearea tranzacției de inventar: ' + err.message,
      500,
      'DB_INSERT_ERROR'
    ));
  }
}

/**
 * Găsește o tranzacție de inventar după ID.
 * @param {string|number} id - ID-ul tranzacției
 * @returns {Promise<Object|null>} Documentul tranzacției sau null
 */
function findInventoryTransactionById(id) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul tranzacției de inventar este invalid.', 400, 'INVALID_TRANSACTION_ID'));
  }

  try {
    const db = getDb();

    const row = get(
      'SELECT id, tenantId, itemId, type, quantity, unitPrice, totalPrice, referenceType, referenceId, notes, performedBy, createdAt FROM inventory_transactions WHERE id = ?',
      [id]
    );

    return Promise.resolve(transformRow(row));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea tranzacției: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește tranzacții de inventar după itemId.
 * @param {string} itemId - ID-ul itemului de inventar
 * @param {Object} [options] - Opțiuni de filtrare suplimentare
 * @param {string} [options.type] - Filtrare după tipul tranzacției
 * @param {string} [options.sortBy='createdAt'] - Câmpul după care se sortează
 * @param {string} [options.sortOrder='desc'] - 'asc' sau 'desc'
 * @returns {Promise<Array>} Lista de tranzacții
 */
function findTransactionsByItem(itemId, options) {
  if (!options) options = {};

  if (!itemId || !isValidId(itemId)) {
    return Promise.reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
  }

  try {
    const db = getDb();

    const conditions = ['itemId = ?'];
    const params = [itemId.trim()];

    if (options.type && isValidTransactionType(options.type)) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    const sortBy = options.sortBy || 'createdAt';
    // Mapare nume vechi de câmpuri la coloane reale
    const columnMap = {
      createdAt: 'createdAt',
      quantity: 'quantity',
      type: 'type',
    };
    const sortColumn = columnMap[sortBy] || 'createdAt';
    const sortDir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

    const whereClause = conditions.join(' AND ');

    const rows = all(
      'SELECT id, tenantId, itemId, type, quantity, unitPrice, totalPrice, referenceType, referenceId, notes, performedBy, createdAt FROM inventory_transactions WHERE ' + whereClause + ' ORDER BY ' + sortColumn + ' ' + sortDir,
      params
    );

    return Promise.resolve((rows || []).map(transformRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea tranzacțiilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește tranzacții de inventar după tenantId.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options] - Opțiuni de filtrare suplimentare
 * @param {string} [options.type] - Filtrare după tipul tranzacției
 * @param {string} [options.itemId] - Filtrare după item
 * @param {string} [options.userId] - Filtrare după utilizator
 * @param {string} [options.locationId] - Filtrare după locație
 * @param {string} [options.locationType] - Filtrare după tip locație
 * @param {string} [options.startDate] - Dată de început (inclusiv) în format ISO
 * @param {string} [options.endDate] - Dată de sfârșit (inclusiv) în format ISO
 * @param {string} [options.sortBy='createdAt'] - Câmpul după care se sortează
 * @param {string} [options.sortOrder='desc'] - 'asc' sau 'desc'
 * @param {number} [options.limit] - Numărul maxim de rezultate
 * @param {number} [options.skip] - Numărul de rezultate de sărit
 * @returns {Promise<Array>} Lista de tranzacții
 */
function findTransactionsByTenant(tenantId, options) {
  if (!options) options = {};

  if (!tenantId || !isValidId(tenantId)) {
    return Promise.reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
  }

  try {
    const db = getDb();

    const conditions = ['tenantId = ?'];
    const params = [tenantId.trim()];

    if (options.type && isValidTransactionType(options.type)) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    if (options.itemId && isValidId(options.itemId)) {
      conditions.push('itemId = ?');
      params.push(options.itemId.trim());
    }

    if (options.userId && isValidId(options.userId)) {
      conditions.push('performedBy = ?');
      params.push(options.userId.trim());
    }

    // Filtrare după locație (stocată în notes JSON)
    if (options.locationId && isValidId(options.locationId)) {
      conditions.push('notes LIKE ?');
      params.push('%' + options.locationId.trim() + '%');
    }

    if (options.locationType && isValidLocationType(options.locationType)) {
      conditions.push('notes LIKE ?');
      params.push('%' + options.locationType + '%');
    }

    // Filtrare pe interval de date
    if (options.startDate) {
      conditions.push('createdAt >= ?');
      params.push(options.startDate);
    }
    if (options.endDate) {
      conditions.push('createdAt <= ?');
      params.push(options.endDate);
    }

    const sortBy = options.sortBy || 'createdAt';
    const columnMap = {
      createdAt: 'createdAt',
      quantity: 'quantity',
      type: 'type',
    };
    const sortColumn = columnMap[sortBy] || 'createdAt';
    const sortDir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

    const whereClause = conditions.join(' AND ');

    let sql = 'SELECT id, tenantId, itemId, type, quantity, unitPrice, totalPrice, referenceType, referenceId, notes, performedBy, createdAt FROM inventory_transactions WHERE ' + whereClause + ' ORDER BY ' + sortColumn + ' ' + sortDir;

    if (typeof options.limit === 'number' && options.limit > 0) {
      sql += ' LIMIT ' + options.limit;
    }
    if (typeof options.skip === 'number' && options.skip > 0) {
      sql += ' OFFSET ' + options.skip;
    }

    const rows = all(sql, params);

    return Promise.resolve((rows || []).map(transformRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea tranzacțiilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește tranzacții de inventar după utilizator.
 * @param {string} userId - ID-ul utilizatorului
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.type] - Filtrare după tip
 * @param {number} [options.limit] - Număr maxim de rezultate
 * @returns {Promise<Array>} Lista de tranzacții
 */
function findTransactionsByUser(userId, options) {
  if (!options) options = {};

  if (!userId || !isValidId(userId)) {
    return Promise.reject(new AppError('ID-ul utilizatorului este invalid.', 400, 'INVALID_USER_ID'));
  }

  try {
    const db = getDb();

    const conditions = ['performedBy = ?'];
    const params = [userId.trim()];

    if (options.type && isValidTransactionType(options.type)) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    const whereClause = conditions.join(' AND ');

    let sql = 'SELECT id, tenantId, itemId, type, quantity, unitPrice, totalPrice, referenceType, referenceId, notes, performedBy, createdAt FROM inventory_transactions WHERE ' + whereClause + ' ORDER BY createdAt DESC';

    if (typeof options.limit === 'number' && options.limit > 0) {
      sql += ' LIMIT ' + options.limit;
    }

    const rows = all(sql, params);

    return Promise.resolve((rows || []).map(transformRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea tranzacțiilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește tranzacții de inventar după referință.
 * @param {string} reference - Referința căutată (ex. număr factură, comandă)
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.tenantId] - Filtrare după tenant
 * @param {number} [options.limit] - Număr maxim de rezultate
 * @returns {Promise<Array>} Lista de tranzacții
 */
function findTransactionsByReference(reference, options) {
  if (!options) options = {};

  if (!reference || !isValidId(reference)) {
    return Promise.reject(new AppError('Referința tranzacției este invalidă.', 400, 'INVALID_REFERENCE'));
  }

  try {
    const db = getDb();

    // Căutăm atât în referenceId cât și în referenceType
    const conditions = ['(referenceId = ? OR referenceType = ? OR notes LIKE ?)'];
    const params = [reference.trim(), reference.trim(), '%' + reference.trim() + '%'];

    if (options.tenantId && isValidId(options.tenantId)) {
      conditions.push('tenantId = ?');
      params.push(options.tenantId.trim());
    }

    const whereClause = conditions.join(' AND ');

    let sql = 'SELECT id, tenantId, itemId, type, quantity, unitPrice, totalPrice, referenceType, referenceId, notes, performedBy, createdAt FROM inventory_transactions WHERE ' + whereClause + ' ORDER BY createdAt DESC';

    if (typeof options.limit === 'number' && options.limit > 0) {
      sql += ' LIMIT ' + options.limit;
    }

    const rows = all(sql, params);

    return Promise.resolve((rows || []).map(transformRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea tranzacțiilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește tranzacții de inventar după locație.
 * @param {string} locationId - ID-ul locației
 * @param {string} locationType - Tipul locației ('restaurant' sau 'hotel')
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.type] - Filtrare după tip
 * @param {string} [options.startDate] - Dată de început
 * @param {string} [options.endDate] - Dată de sfârșit
 * @param {number} [options.limit] - Număr maxim de rezultate
 * @returns {Promise<Array>} Lista de tranzacții
 */
function findTransactionsByLocation(locationId, locationType, options) {
  if (!options) options = {};

  if (!locationId || !isValidId(locationId)) {
    return Promise.reject(new AppError('ID-ul locației este invalid.', 400, 'INVALID_LOCATION_ID'));
  }

  if (!locationType || !isValidLocationType(locationType)) {
    return Promise.reject(new AppError(
      'Tipul locației trebuie să fie "restaurant" sau "hotel".',
      400,
      'INVALID_LOCATION_TYPE'
    ));
  }

  try {
    const db = getDb();

    // Căutăm în notes JSON după locationId și locationType
    const conditions = [
      'notes LIKE ?',
      'notes LIKE ?',
    ];
    const params = [
      '%' + locationId.trim() + '%',
      '%' + locationType + '%',
    ];

    if (options.type && isValidTransactionType(options.type)) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    if (options.startDate) {
      conditions.push('createdAt >= ?');
      params.push(options.startDate);
    }
    if (options.endDate) {
      conditions.push('createdAt <= ?');
      params.push(options.endDate);
    }

    const whereClause = conditions.join(' AND ');

    let sql = 'SELECT id, tenantId, itemId, type, quantity, unitPrice, totalPrice, referenceType, referenceId, notes, performedBy, createdAt FROM inventory_transactions WHERE ' + whereClause + ' ORDER BY createdAt DESC';

    if (typeof options.limit === 'number' && options.limit > 0) {
      sql += ' LIMIT ' + options.limit;
    }

    const rows = all(sql, params);

    return Promise.resolve((rows || []).map(transformRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea tranzacțiilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește tranzacții de inventar după tip.
 * @param {string} type - Tipul tranzacției (intrare/ieșire/pierdere)
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.tenantId] - Filtrare după tenant
 * @param {string} [options.locationId] - Filtrare după locație
 * @param {number} [options.limit] - Număr maxim de rezultate
 * @returns {Promise<Array>} Lista de tranzacții
 */
function findTransactionsByType(type, options) {
  if (!options) options = {};

  if (!type || !isValidTransactionType(type)) {
    return Promise.reject(new AppError(
      'Tipul tranzacției "' + type + '" nu este valid. Tipuri acceptate: ' + VALID_TRANSACTION_TYPES.join(', ') + '.',
      400,
      'INVALID_TRANSACTION_TYPE'
    ));
  }

  try {
    const db = getDb();

    const conditions = ['type = ?'];
    const params = [type];

    if (options.tenantId && isValidId(options.tenantId)) {
      conditions.push('tenantId = ?');
      params.push(options.tenantId.trim());
    }

    if (options.locationId && isValidId(options.locationId)) {
      conditions.push('notes LIKE ?');
      params.push('%' + options.locationId.trim() + '%');
    }

    const whereClause = conditions.join(' AND ');

    let sql = 'SELECT id, tenantId, itemId, type, quantity, unitPrice, totalPrice, referenceType, referenceId, notes, performedBy, createdAt FROM inventory_transactions WHERE ' + whereClause + ' ORDER BY createdAt DESC';

    if (typeof options.limit === 'number' && options.limit > 0) {
      sql += ' LIMIT ' + options.limit;
    }

    const rows = all(sql, params);

    return Promise.resolve((rows || []).map(transformRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea tranzacțiilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Numără tranzacțiile de inventar dintr-un tenant, cu opțiuni de filtrare.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.type] - Filtrare după tip
 * @param {string} [options.itemId] - Filtrare după item
 * @param {string} [options.userId] - Filtrare după utilizator
 * @param {string} [options.startDate] - Dată de început
 * @param {string} [options.endDate] - Dată de sfârșit
 * @returns {Promise<number>}
 */
function countTransactions(tenantId, options) {
  if (!options) options = {};

  if (!tenantId || !isValidId(tenantId)) {
    return Promise.resolve(0);
  }

  try {
    const db = getDb();

    const conditions = ['tenantId = ?'];
    const params = [tenantId.trim()];

    if (options.type && isValidTransactionType(options.type)) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    if (options.itemId && isValidId(options.itemId)) {
      conditions.push('itemId = ?');
      params.push(options.itemId.trim());
    }

    if (options.userId && isValidId(options.userId)) {
      conditions.push('performedBy = ?');
      params.push(options.userId.trim());
    }

    if (options.startDate) {
      conditions.push('createdAt >= ?');
      params.push(options.startDate);
    }
    if (options.endDate) {
      conditions.push('createdAt <= ?');
      params.push(options.endDate);
    }

    const whereClause = conditions.join(' AND ');

    const row = get(
      'SELECT COUNT(*) AS cnt FROM inventory_transactions WHERE ' + whereClause,
      params
    );

    return Promise.resolve(row ? row.cnt : 0);
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la numărarea tranzacțiilor: ' + err.message,
      500,
      'DB_COUNT_ERROR'
    ));
  }
}

/**
 * Obține un sumar al tranzacțiilor pe tipuri pentru un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.startDate] - Dată de început
 * @param {string} [options.endDate] - Dată de sfârșit
 * @returns {Promise<Array>} Lista de obiecte { type, count, totalQuantity }
 */
function getTransactionSummary(tenantId, options) {
  if (!options) options = {};

  if (!tenantId || !isValidId(tenantId)) {
    return Promise.reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
  }

  try {
    const db = getDb();

    const conditions = ['tenantId = ?'];
    const params = [tenantId.trim()];

    if (options.startDate) {
      conditions.push('createdAt >= ?');
      params.push(options.startDate);
    }
    if (options.endDate) {
      conditions.push('createdAt <= ?');
      params.push(options.endDate);
    }

    const whereClause = conditions.join(' AND ');

    const rows = all(
      'SELECT type, COUNT(*) AS count, SUM(quantity) AS totalQuantity FROM inventory_transactions WHERE ' + whereClause + ' GROUP BY type ORDER BY type ASC',
      params
    );

    return Promise.resolve((rows || []).map(function (r) {
      return {
        type: r.type,
        count: r.count,
        totalQuantity: r.totalQuantity || 0,
      };
    }));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea tranzacțiilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Obține istoricul complet al tranzacțiilor pentru un item, cu paginare.
 * @param {string} itemId - ID-ul itemului de inventar
 * @param {Object} [options] - Opțiuni de paginare
 * @param {number} [options.page=1] - Numărul paginii
 * @param {number} [options.limit=50] - Rezultate pe pagină
 * @returns {Promise<Object>} { transactions, total, page, limit, totalPages }
 */
function getItemTransactionHistory(itemId, options) {
  if (!options) options = {};

  if (!itemId || !isValidId(itemId)) {
    return Promise.reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
  }

  const page = Math.max(1, parseInt(options.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 50));
  const skip = (page - 1) * limit;

  try {
    const db = getDb();

    // Obținem numărul total
    const countRow = get(
      'SELECT COUNT(*) AS cnt FROM inventory_transactions WHERE itemId = ?',
      [itemId.trim()]
    );
    const total = countRow ? countRow.cnt : 0;

    // Obținem tranzacțiile pentru pagina curentă
    const rows = all(
      'SELECT id, tenantId, itemId, type, quantity, unitPrice, totalPrice, referenceType, referenceId, notes, performedBy, createdAt FROM inventory_transactions WHERE itemId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?',
      [itemId.trim(), limit, skip]
    );

    return Promise.resolve({
      transactions: (rows || []).map(transformRow),
      total: total || 0,
      page,
      limit,
      totalPages: Math.ceil((total || 0) / limit),
    });
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea tranzacțiilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Șterge o tranzacție de inventar după ID.
 * @param {string|number} id - ID-ul tranzacției
 * @returns {Promise<boolean>} true dacă a fost ștearsă
 */
function deleteInventoryTransaction(id) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul tranzacției de inventar este invalid.', 400, 'INVALID_TRANSACTION_ID'));
  }

  try {
    const db = getDb();

    const result = run(
      'DELETE FROM inventory_transactions WHERE id = ?',
      [id]
    );

    if (result.changes === 0) {
      return Promise.reject(new AppError('Tranzacția de inventar nu a fost găsită.', 404, 'TRANSACTION_NOT_FOUND'));
    }

    return Promise.resolve(true);
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la ștergerea tranzacției: ' + err.message,
      500,
      'DB_DELETE_ERROR'
    ));
  }
}

/**
 * Șterge toate tranzacțiile pentru un item de inventar.
 * @param {string} itemId - ID-ul itemului
 * @returns {Promise<number>} Numărul de tranzacții șterse
 */
function deleteTransactionsByItem(itemId) {
  if (!itemId || !isValidId(itemId)) {
    return Promise.reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
  }

  try {
    const db = getDb();

    const result = run(
      'DELETE FROM inventory_transactions WHERE itemId = ?',
      [itemId.trim()]
    );

    return Promise.resolve(result.changes || 0);
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la ștergerea tranzacțiilor: ' + err.message,
      500,
      'DB_DELETE_ERROR'
    ));
  }
}

/**
 * Calculează cantitatea totală consumată dintr-un item (ieșiri + pierderi).
 * @param {string} itemId - ID-ul itemului de inventar
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.startDate] - Dată de început
 * @param {string} [options.endDate] - Dată de sfârșit
 * @returns {Promise<Object>} { totalOut, totalLoss, netConsumption }
 */
function getItemConsumption(itemId, options) {
  if (!options) options = {};

  if (!itemId || !isValidId(itemId)) {
    return Promise.reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
  }

  try {
    const db = getDb();

    const conditions = ['itemId = ?'];
    const params = [itemId.trim()];

    if (options.startDate) {
      conditions.push('createdAt >= ?');
      params.push(options.startDate);
    }
    if (options.endDate) {
      conditions.push('createdAt <= ?');
      params.push(options.endDate);
    }

    const whereClause = conditions.join(' AND ');

    // Obținem sumele pe tipuri
    const rows = all(
      'SELECT type, SUM(quantity) AS totalQty FROM inventory_transactions WHERE ' + whereClause + ' GROUP BY type',
      params
    );

    let totalOut = 0;
    let totalLoss = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.type === 'ieșire') {
        totalOut += r.totalQty || 0;
      } else if (r.type === 'pierdere') {
        totalLoss += r.totalQty || 0;
      }
    }

    return Promise.resolve({
      totalOut,
      totalLoss,
      netConsumption: totalOut + totalLoss,
    });
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea tranzacțiilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Constante
  VALID_TRANSACTION_TYPES,
  VALID_UNITS,
  VALID_LOCATION_TYPES,

  // Validare
  isValidId,
  isValidTransactionType,
  isValidUnit,
  isValidLocationType,
  isValidQuantity,

  // Operații CRUD
  createInventoryTransaction,
  findInventoryTransactionById,
  findTransactionsByItem,
  findTransactionsByTenant,
  findTransactionsByUser,
  findTransactionsByReference,
  findTransactionsByLocation,
  findTransactionsByType,
  countTransactions,
  getTransactionSummary,
  getItemTransactionHistory,
  deleteInventoryTransaction,
  deleteTransactionsByItem,
  getItemConsumption,
};