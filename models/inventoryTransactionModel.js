'use strict';

// ---------------------------------------------------------------------------
// Model InventoryTransaction – GastroHub
// Model Nedb pentru tranzacții de inventar (intrări, ieșiri, pierderi).
// Utilizat în teste (NODE_ENV=test) și opțional în producție.
// ---------------------------------------------------------------------------

const path = require('path');
const Datastore = require('nedb');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Configurare – cale bază de date Nedb
// ---------------------------------------------------------------------------
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data');

const inventoryTransactions = new Datastore({
  filename: path.join(dbPath, 'inventory_transactions.db'),
  autoload: true,
});

// ---------------------------------------------------------------------------
// Constante exportate
// ---------------------------------------------------------------------------
const VALID_TRANSACTION_TYPES = ['intrare', 'ieșire', 'pierdere'];

const VALID_UNITS = [
  'kg', 'l', 'buc', 'g', 'ml', 'pachet', 'cutie', 'sticlă', 'bax', 'kg/l',
];

const VALID_LOCATION_TYPES = ['restaurant', 'hotel'];

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un ID este valid (string nevid).
 * @param {*} id
 * @returns {boolean}
 */
function isValidId(id) {
  return typeof id === 'string' && id.length > 0;
}

/**
 * Verifică dacă un tip de tranzacție este valid.
 * @param {*} type
 * @returns {boolean}
 */
function isValidTransactionType(type) {
  return typeof type === 'string' && VALID_TRANSACTION_TYPES.includes(type);
}

/**
 * Verifică dacă o unitate de măsură este validă.
 * @param {*} unit
 * @returns {boolean}
 */
function isValidUnit(unit) {
  return typeof unit === 'string' && VALID_UNITS.includes(unit);
}

/**
 * Verifică dacă un tip de locație este valid.
 * @param {*} locationType
 * @returns {boolean}
 */
function isValidLocationType(locationType) {
  return typeof locationType === 'string' && VALID_LOCATION_TYPES.includes(locationType);
}

/**
 * Verifică dacă o cantitate este validă (număr > 0).
 * @param {*} quantity
 * @returns {boolean}
 */
function isValidQuantity(quantity) {
  return typeof quantity === 'number' && !isNaN(quantity) && quantity > 0;
}

// ---------------------------------------------------------------------------
// Helpers: promisifică operațiile Nedb
// ---------------------------------------------------------------------------

function nedbFind(query, sort) {
  return new Promise((resolve, reject) => {
    let cursor = inventoryTransactions.find(query);
    if (sort) cursor = cursor.sort(sort);
    cursor.exec((err, docs) => {
      if (err) return reject(err);
      resolve(docs);
    });
  });
}

function nedbFindOne(query) {
  return new Promise((resolve, reject) => {
    inventoryTransactions.findOne(query, (err, doc) => {
      if (err) return reject(err);
      resolve(doc);
    });
  });
}

function nedbInsert(doc) {
  return new Promise((resolve, reject) => {
    inventoryTransactions.insert(doc, (err, inserted) => {
      if (err) return reject(err);
      resolve(inserted);
    });
  });
}

function nedbRemove(query, options) {
  return new Promise((resolve, reject) => {
    inventoryTransactions.remove(query, options || {}, (err, numRemoved) => {
      if (err) return reject(err);
      resolve(numRemoved);
    });
  });
}

function nedbCount(query) {
  return new Promise((resolve, reject) => {
    inventoryTransactions.count(query, (err, count) => {
      if (err) return reject(err);
      resolve(count);
    });
  });
}

// ---------------------------------------------------------------------------
// Helper: construiește query din opțiuni
// ---------------------------------------------------------------------------

/**
 * Construiește un obiect query Nedb din opțiunile de filtrare.
 * @param {Object} base - query-ul de bază
 * @param {Object} options - opțiuni adiționale
 * @param {Array<string>} dateFields - câmpuri ce pot fi comparate cu intervale de dată
 * @returns {Object} query-ul complet
 */
function buildQuery(base, options, dateFields) {
  const query = { ...base };

  if (!options) return query;

  if (options.type) query.type = options.type;
  if (options.itemId) query.itemId = options.itemId;
  if (options.userId) query.userId = options.userId;
  if (options.locationId) query.locationId = options.locationId;
  if (options.locationType) query.locationType = options.locationType;
  if (options.tenantId) query.tenantId = options.tenantId;

  // Filtrare după interval de date
  const df = dateFields || ['createdAt'];
  const dateField = df[0];

  if (options.startDate || options.endDate) {
    query[dateField] = {};
    if (options.startDate) {
      query[dateField].$gte = typeof options.startDate === 'string'
        ? options.startDate
        : options.startDate.toISOString();
    }
    if (options.endDate) {
      query[dateField].$lte = typeof options.endDate === 'string'
        ? options.endDate
        : options.endDate.toISOString();
    }
    // Dacă nu există operatori, ștergem cheia
    if (Object.keys(query[dateField]).length === 0) {
      delete query[dateField];
    }
  }

  return query;
}

// ---------------------------------------------------------------------------
// Operații CRUD
// ---------------------------------------------------------------------------

/**
 * Creează o tranzacție de inventar.
 *
 * @param {Object} data
 * @param {string} data.itemId
 * @param {string} data.type
 * @param {number} data.quantity
 * @param {string} data.unit
 * @param {string} [data.note='']
 * @param {string} [data.reference='']
 * @param {string} [data.userId]
 * @param {string} [data.performedBy]
 * @param {string} data.locationId
 * @param {string} data.locationType
 * @param {string} data.tenantId
 * @param {number} [data.previousQuantity]
 * @param {number} [data.newQuantity]
 * @returns {Promise<Object>}
 */
async function createInventoryTransaction(data) {
  if (!data || typeof data !== 'object') {
    throw new AppError('Datele tranzacției sunt invalide.', 400, 'INVALID_TRANSACTION_DATA');
  }

  const {
    itemId,
    type,
    quantity,
    unit,
    locationId,
    locationType,
    tenantId,
  } = data;

  // performedBy are prioritate față de userId
  let userId = data.performedBy !== undefined ? data.performedBy : data.userId;

  // Validare itemId
  if (!isValidId(itemId)) {
    throw new AppError('ID-ul itemului este invalid.', 400, 'INVALID_ITEM_ID');
  }

  // Validare type
  if (!isValidTransactionType(type)) {
    throw new AppError('Tipul tranzacției nu este valid.', 400, 'INVALID_TRANSACTION_TYPE');
  }

  // Validare quantity
  if (quantity === undefined || quantity === null || !isValidQuantity(quantity)) {
    throw new AppError('Cantitatea trebuie să fie un număr mai mare decât 0.', 400, 'INVALID_QUANTITY');
  }

  // Validare unit
  if (!isValidUnit(unit)) {
    throw new AppError('Unitatea de măsură nu este validă.', 400, 'INVALID_UNIT');
  }

  // Validare userId
  if (!isValidId(userId)) {
    throw new AppError('ID-ul utilizatorului este invalid.', 400, 'INVALID_USER_ID');
  }

  // Validare locationId
  if (!isValidId(locationId)) {
    throw new AppError('ID-ul locației este invalid.', 400, 'INVALID_LOCATION_ID');
  }

  // Validare locationType
  if (!isValidLocationType(locationType)) {
    throw new AppError('Tipul locației nu este valid.', 400, 'INVALID_LOCATION_TYPE');
  }

  // Validare tenantId
  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'INVALID_TENANT_ID');
  }

  const finalNote = data.note !== undefined ? data.note : '';
  const finalReference = data.reference !== undefined ? data.reference : '';

  const now = new Date().toISOString();

  const doc = {
    itemId,
    type,
    quantity,
    unit,
    note: finalNote,
    reference: finalReference,
    userId,
    locationId,
    locationType,
    tenantId,
    createdAt: now,
  };

  // Câmpuri opționale
  if (data.previousQuantity !== undefined && data.previousQuantity !== null) {
    doc.previousQuantity = data.previousQuantity;
  }
  if (data.newQuantity !== undefined && data.newQuantity !== null) {
    doc.newQuantity = data.newQuantity;
  }

  try {
    const inserted = await nedbInsert(doc);
    return inserted;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la crearea tranzacției: ' + err.message,
      500,
      'DB_INSERT_ERROR'
    );
  }
}

/**
 * Găsește o tranzacție după ID.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function findInventoryTransactionById(id) {
  if (!isValidId(id)) {
    throw new AppError('ID-ul tranzacției este invalid.', 400, 'INVALID_TRANSACTION_ID');
  }

  try {
    const doc = await nedbFindOne({ _id: id });
    return doc || null;
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
 * Găsește tranzacțiile pentru un item.
 * @param {string} itemId
 * @param {Object} [options]
 * @param {string} [options.type]
 * @param {string} [options.sortOrder='desc']
 * @returns {Promise<Array>}
 */
async function findTransactionsByItem(itemId, options) {
  if (!options) options = {};

  if (!isValidId(itemId)) {
    throw new AppError('ID-ul itemului este invalid.', 400, 'INVALID_ITEM_ID');
  }

  const query = { itemId };
  if (options.type) query.type = options.type;

  const sortOrder = options.sortOrder === 'asc' ? 1 : -1;
  const sort = { createdAt: sortOrder };

  try {
    return await nedbFind(query, sort);
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
 * Găsește tranzacțiile unui tenant.
 * @param {string} tenantId
 * @param {Object} [options]
 * @param {string} [options.type]
 * @param {string} [options.itemId]
 * @param {string} [options.userId]
 * @param {string} [options.locationId]
 * @param {string} [options.locationType]
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @param {number} [options.limit]
 * @param {number} [options.skip]
 * @param {string} [options.sortOrder='desc']
 * @returns {Promise<Array>}
 */
async function findTransactionsByTenant(tenantId, options) {
  if (!options) options = {};

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  const query = buildQuery({ tenantId }, options, ['createdAt']);

  const sortOrder = options.sortOrder === 'asc' ? 1 : -1;
  const sort = { createdAt: sortOrder };

  try {
    let cursor = inventoryTransactions.find(query).sort(sort);

    if (options.skip !== undefined && options.skip !== null) {
      cursor = cursor.skip(parseInt(options.skip, 10));
    }
    if (options.limit !== undefined && options.limit !== null) {
      cursor = cursor.limit(parseInt(options.limit, 10));
    }

    return new Promise((resolve, reject) => {
      cursor.exec((err, docs) => {
        if (err) return reject(err);
        resolve(docs);
      });
    });
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
 * Găsește tranzacțiile unui utilizator.
 * @param {string} userId
 * @param {Object} [options]
 * @param {string} [options.type]
 * @param {number} [options.limit]
 * @returns {Promise<Array>}
 */
async function findTransactionsByUser(userId, options) {
  if (!options) options = {};

  if (!isValidId(userId)) {
    throw new AppError('ID-ul utilizatorului este invalid.', 400, 'INVALID_USER_ID');
  }

  const query = { userId };
  if (options.type) query.type = options.type;

  const sort = { createdAt: -1 };

  try {
    let cursor = inventoryTransactions.find(query).sort(sort);
    if (options.limit !== undefined && options.limit !== null) {
      cursor = cursor.limit(parseInt(options.limit, 10));
    }

    return new Promise((resolve, reject) => {
      cursor.exec((err, docs) => {
        if (err) return reject(err);
        resolve(docs);
      });
    });
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
 * Găsește tranzacțiile după referință.
 * @param {string} reference
 * @param {Object} [options]
 * @param {string} [options.tenantId]
 * @param {number} [options.limit]
 * @returns {Promise<Array>}
 */
async function findTransactionsByReference(reference, options) {
  if (!options) options = {};

  if (!reference) {
    throw new AppError('Referința este invalidă.', 400, 'INVALID_REFERENCE');
  }

  const query = { reference };
  if (options.tenantId) query.tenantId = options.tenantId;

  const sort = { createdAt: -1 };

  try {
    let cursor = inventoryTransactions.find(query).sort(sort);
    if (options.limit !== undefined && options.limit !== null) {
      cursor = cursor.limit(parseInt(options.limit, 10));
    }

    return new Promise((resolve, reject) => {
      cursor.exec((err, docs) => {
        if (err) return reject(err);
        resolve(docs);
      });
    });
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
 * Găsește tranzacțiile dintr-o locație.
 * @param {string} locationId
 * @param {string} locationType
 * @param {Object} [options]
 * @param {string} [options.type]
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @param {number} [options.limit]
 * @returns {Promise<Array>}
 */
async function findTransactionsByLocation(locationId, locationType, options) {
  if (!options) options = {};

  if (!locationId) {
    throw new AppError('ID-ul locației este invalid.', 400, 'INVALID_LOCATION_ID');
  }
  if (!isValidLocationType(locationType)) {
    throw new AppError('Tipul locației nu este valid.', 400, 'INVALID_LOCATION_TYPE');
  }

  const query = buildQuery({ locationId, locationType }, options, ['createdAt']);

  if (options.type) query.type = options.type;

  const sort = { createdAt: -1 };

  try {
    let cursor = inventoryTransactions.find(query).sort(sort);
    if (options.limit !== undefined && options.limit !== null) {
      cursor = cursor.limit(parseInt(options.limit, 10));
    }

    return new Promise((resolve, reject) => {
      cursor.exec((err, docs) => {
        if (err) return reject(err);
        resolve(docs);
      });
    });
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
 * Găsește tranzacțiile după tip.
 * @param {string} type
 * @param {Object} [options]
 * @param {string} [options.tenantId]
 * @param {string} [options.locationId]
 * @param {number} [options.limit]
 * @returns {Promise<Array>}
 */
async function findTransactionsByType(type, options) {
  if (!options) options = {};

  if (!isValidTransactionType(type)) {
    throw new AppError('Tipul tranzacției nu este valid.', 400, 'INVALID_TRANSACTION_TYPE');
  }

  const query = { type };
  if (options.tenantId) query.tenantId = options.tenantId;
  if (options.locationId) query.locationId = options.locationId;

  const sort = { createdAt: -1 };

  try {
    let cursor = inventoryTransactions.find(query).sort(sort);
    if (options.limit !== undefined && options.limit !== null) {
      cursor = cursor.limit(parseInt(options.limit, 10));
    }

    return new Promise((resolve, reject) => {
      cursor.exec((err, docs) => {
        if (err) return reject(err);
        resolve(docs);
      });
    });
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
 * Numără tranzacțiile unui tenant.
 * @param {string} tenantId
 * @param {Object} [options]
 * @param {string} [options.type]
 * @param {string} [options.itemId]
 * @param {string} [options.userId]
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @returns {Promise<number>}
 */
async function countTransactions(tenantId, options) {
  if (!options) options = {};

  if (!tenantId) {
    return 0;
  }

  const query = buildQuery({ tenantId }, options, ['createdAt']);

  // buildQuery adaugă deja type și itemId dacă sunt în options
  // dar userId nu este adăugat automat, așa că îl adăugăm manual
  if (options.userId) query.userId = options.userId;

  try {
    return await nedbCount(query);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la numărarea tranzacțiilor: ' + err.message,
      500,
      'DB_COUNT_ERROR'
    );
  }
}

/**
 * Returnează sumarul tranzacțiilor pe tipuri.
 * @param {string} tenantId
 * @param {Object} [options]
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @returns {Promise<Array<{type: string, count: number, totalQuantity: number}>>}
 */
async function getTransactionSummary(tenantId, options) {
  if (!options) options = {};

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  const query = buildQuery({ tenantId }, options, ['createdAt']);

  try {
    const transactions = await nedbFind(query);

    const summaryMap = {};
    for (const tx of transactions) {
      const t = tx.type;
      if (!summaryMap[t]) {
        summaryMap[t] = { type: t, count: 0, totalQuantity: 0 };
      }
      summaryMap[t].count += 1;
      summaryMap[t].totalQuantity += tx.quantity;
    }

    return Object.values(summaryMap);
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
 * Returnează istoricul paginat al tranzacțiilor unui item.
 * @param {string} itemId
 * @param {Object} [options]
 * @param {number} [options.page=1]
 * @param {number} [options.limit=50]
 * @returns {Promise<{transactions: Array, total: number, page: number, limit: number, totalPages: number}>}
 */
async function getItemTransactionHistory(itemId, options) {
  if (!options) options = {};

  if (!isValidId(itemId)) {
    throw new AppError('ID-ul itemului este invalid.', 400, 'INVALID_ITEM_ID');
  }

  let page = parseInt(options.page, 10) || 1;
  let limit = parseInt(options.limit, 10) || 50;

  // Normalizare
  if (page < 1) page = 1;
  if (limit < 1) limit = 50;
  if (limit > 100) limit = 100;

  const skip = (page - 1) * limit;
  const sort = { createdAt: -1 };

  try {
    const total = await nedbCount({ itemId });

    const transactions = await new Promise((resolve, reject) => {
      inventoryTransactions
        .find({ itemId })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          resolve(docs);
        });
    });

    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

    return {
      transactions,
      total,
      page,
      limit,
      totalPages,
    };
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
 * Șterge o tranzacție după ID.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
async function deleteInventoryTransaction(id) {
  if (!isValidId(id)) {
    throw new AppError('ID-ul tranzacției este invalid.', 400, 'INVALID_TRANSACTION_ID');
  }

  try {
    const existing = await findInventoryTransactionById(id);
    if (!existing) {
      throw new AppError('Tranzacția nu a fost găsită.', 404, 'TRANSACTION_NOT_FOUND');
    }

    await nedbRemove({ _id: id }, {});
    return true;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la ștergerea tranzacției: ' + err.message,
      500,
      'DB_DELETE_ERROR'
    );
  }
}

/**
 * Șterge toate tranzacțiile unui item.
 * @param {string} itemId
 * @returns {Promise<number>} numărul de tranzacții șterse
 */
async function deleteTransactionsByItem(itemId) {
  if (!isValidId(itemId)) {
    throw new AppError('ID-ul itemului este invalid.', 400, 'INVALID_ITEM_ID');
  }

  try {
    const numRemoved = await nedbRemove({ itemId }, { multi: true });
    return numRemoved;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la ștergerea tranzacțiilor: ' + err.message,
      500,
      'DB_DELETE_ERROR'
    );
  }
}

/**
 * Calculează consumul unui item (ieșiri + pierderi).
 * @param {string} itemId
 * @param {Object} [options]
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @returns {Promise<{totalOut: number, totalLoss: number, netConsumption: number}>}
 */
async function getItemConsumption(itemId, options) {
  if (!options) options = {};

  if (!isValidId(itemId)) {
    throw new AppError('ID-ul itemului este invalid.', 400, 'INVALID_ITEM_ID');
  }

  const query = buildQuery({ itemId }, options, ['createdAt']);

  try {
    const transactions = await nedbFind(query);

    let totalOut = 0;
    let totalLoss = 0;

    for (const tx of transactions) {
      if (tx.type === 'ieșire') {
        totalOut += tx.quantity;
      } else if (tx.type === 'pierdere') {
        totalLoss += tx.quantity;
      }
    }

    return {
      totalOut,
      totalLoss,
      netConsumption: totalOut + totalLoss,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la calcularea consumului: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Colecția Nedb (expusă pentru stubbing în teste)
  inventoryTransactions,

  // Constante
  VALID_TRANSACTION_TYPES,
  VALID_UNITS,
  VALID_LOCATION_TYPES,

  // Funcții de validare
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
