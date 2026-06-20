'use strict';

// ---------------------------------------------------------------------------
// Model InventoryItem – GastroHub
// Model Nedb pentru iteme de inventar (alimente, băuturi, consumabile).
// Utilizat în teste (NODE_ENV=test) și opțional în producție.
// ---------------------------------------------------------------------------

const path = require('path');
const Datastore = require('nedb');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Configurare – cale bază de date Nedb
// ---------------------------------------------------------------------------
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data');

const inventoryItems = new Datastore({
  filename: path.join(dbPath, 'inventory_items.db'),
  autoload: true,
});

// ---------------------------------------------------------------------------
// Constante exportate
// ---------------------------------------------------------------------------
const VALID_CATEGORIES = ['alimente', 'băuturi', 'consumabile', 'alte'];

const VALID_UNITS = [
  'kg', 'l', 'buc', 'g', 'ml', 'pachet', 'cutie', 'sticlă', 'bax', 'kg/l',
];

const VALID_LOCATION_TYPES = ['restaurant', 'hotel'];

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă numele este valid (string nevid, max 200 caractere).
 * @param {*} name
 * @returns {boolean}
 */
function isValidName(name) {
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 200;
}

/**
 * Verifică dacă o categorie este validă.
 * @param {*} category
 * @returns {boolean}
 */
function isValidCategory(category) {
  return typeof category === 'string' && VALID_CATEGORIES.includes(category);
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
 * Verifică dacă o cantitate este validă (număr >= 0).
 * @param {*} quantity
 * @returns {boolean}
 */
function isValidQuantity(quantity) {
  return typeof quantity === 'number' && !isNaN(quantity) && quantity >= 0;
}

/**
 * Verifică dacă un prag minim este valid (număr >= 0).
 * @param {*} threshold
 * @returns {boolean}
 */
function isValidThreshold(threshold) {
  return typeof threshold === 'number' && !isNaN(threshold) && threshold >= 0;
}

// ---------------------------------------------------------------------------
// Helper: promisifică operațiile Nedb
// ---------------------------------------------------------------------------

function nedbFind(query, sort) {
  return new Promise((resolve, reject) => {
    let cursor = inventoryItems.find(query);
    if (sort) cursor = cursor.sort(sort);
    cursor.exec((err, docs) => {
      if (err) return reject(err);
      resolve(docs);
    });
  });
}

function nedbFindOne(query) {
  return new Promise((resolve, reject) => {
    inventoryItems.findOne(query, (err, doc) => {
      if (err) return reject(err);
      resolve(doc);
    });
  });
}

function nedbInsert(doc) {
  return new Promise((resolve, reject) => {
    inventoryItems.insert(doc, (err, inserted) => {
      if (err) return reject(err);
      resolve(inserted);
    });
  });
}

function nedbUpdate(query, update, options) {
  return new Promise((resolve, reject) => {
    inventoryItems.update(query, update, options || {}, (err, numAffected, affectedDocuments) => {
      if (err) return reject(err);
      resolve({ numAffected, affectedDocuments });
    });
  });
}

function nedbRemove(query, options) {
  return new Promise((resolve, reject) => {
    inventoryItems.remove(query, options || {}, (err, numRemoved) => {
      if (err) return reject(err);
      resolve(numRemoved);
    });
  });
}

function nedbCount(query) {
  return new Promise((resolve, reject) => {
    inventoryItems.count(query, (err, count) => {
      if (err) return reject(err);
      resolve(count);
    });
  });
}

// ---------------------------------------------------------------------------
// CRUD – Operații
// ---------------------------------------------------------------------------

/**
 * Creează un item de inventar.
 *
 * @param {Object} data
 * @param {string} data.name
 * @param {string} data.category
 * @param {number} data.quantity
 * @param {string} data.unit
 * @param {number} [data.minThreshold=0]
 * @param {string} data.locationId
 * @param {string} data.locationType
 * @param {string} data.tenantId
 * @param {string} [data.supplierId=null]
 * @returns {Promise<Object>} Itemul creat
 * @throws {AppError}
 */
async function createInventoryItem(data) {
  // Validare date de intrare
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppError('Datele itemului sunt invalide.', 400, 'INVALID_ITEM_DATA');
  }

  const name = data.name;
  const category = data.category;
  const quantity = data.quantity;
  const unit = data.unit;
  let minThreshold = data.minThreshold;
  const locationId = data.locationId;
  const locationType = data.locationType;
  const tenantId = data.tenantId;
  const supplierId = data.supplierId !== undefined ? data.supplierId : null;

  // Validare nume
  if (!isValidName(name)) {
    throw new AppError('Numele produsului este invalid.', 400, 'INVALID_NAME');
  }
  const trimmedName = name.trim();

  // Validare categorie
  if (!isValidCategory(category)) {
    throw new AppError('Categoria nu este validă.', 400, 'INVALID_CATEGORY');
  }

  // Validare cantitate
  if (quantity === undefined || quantity === null || !isValidQuantity(quantity)) {
    throw new AppError('Cantitatea trebuie să fie un număr pozitiv.', 400, 'INVALID_QUANTITY');
  }

  // Validare unitate
  if (!isValidUnit(unit)) {
    throw new AppError('Unitatea de măsură nu este validă.', 400, 'INVALID_UNIT');
  }

  // Validare locationId
  if (!locationId || typeof locationId !== 'string') {
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

  // minThreshold default
  if (minThreshold === undefined || minThreshold === null) {
    minThreshold = 0;
  }

  if (!isValidThreshold(minThreshold)) {
    throw new AppError('Pragul minim nu este valid.', 400, 'INVALID_THRESHOLD');
  }

  // Verificare duplicat
  try {
    const existing = await nedbFindOne({
      name: trimmedName,
      tenantId,
      locationId,
    });

    if (existing) {
      throw new AppError(
        'Un produs cu același nume există deja în această locație.',
        409,
        'DUPLICATE_ITEM'
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la verificarea duplicatelor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    );
  }

  const now = new Date().toISOString();

  const doc = {
    name: trimmedName,
    category,
    quantity,
    unit,
    minThreshold,
    locationId,
    locationType,
    tenantId,
    supplierId,
    createdAt: now,
    updatedAt: now,
    lastUpdated: now,
  };

  try {
    const inserted = await nedbInsert(doc);
    return inserted;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la crearea itemului: ' + err.message,
      500,
      'DB_INSERT_ERROR'
    );
  }
}

/**
 * Găsește un item de inventar după ID.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function findInventoryItemById(id) {
  if (!id || typeof id !== 'string') {
    throw new AppError('ID-ul itemului este invalid.', 400, 'INVALID_ITEM_ID');
  }

  try {
    const doc = await nedbFindOne({ _id: id });
    return doc || null;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la căutarea itemului: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește itemele de inventar ale unui tenant.
 * @param {string} tenantId
 * @param {Object} [options]
 * @param {string} [options.category]
 * @param {string} [options.locationId]
 * @param {string} [options.locationType]
 * @param {string} [options.supplierId]
 * @param {string} [options.sortBy='name']
 * @param {string} [options.sortOrder='asc']
 * @returns {Promise<Array>}
 */
async function findInventoryItemsByTenant(tenantId, options) {
  if (!options) options = {};

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  const query = { tenantId };

  if (options.category) query.category = options.category;
  if (options.locationId) query.locationId = options.locationId;
  if (options.locationType) query.locationType = options.locationType;
  if (options.supplierId) query.supplierId = options.supplierId;

  const sortBy = options.sortBy || 'name';
  const sortOrder = options.sortOrder === 'desc' ? -1 : 1;
  const sort = { [sortBy]: sortOrder };

  try {
    return await nedbFind(query, sort);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la căutarea itemelor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește itemele de inventar dintr-o locație.
 * @param {string} locationId
 * @param {string} locationType
 * @returns {Promise<Array>}
 */
async function findInventoryItemsByLocation(locationId, locationType) {
  if (!locationId) {
    throw new AppError('ID-ul locației este invalid.', 400, 'INVALID_LOCATION_ID');
  }
  if (!isValidLocationType(locationType)) {
    throw new AppError('Tipul locației nu este valid.', 400, 'INVALID_LOCATION_TYPE');
  }

  const query = { locationId, locationType };
  const sort = { name: 1 };

  try {
    return await nedbFind(query, sort);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la căutarea itemelor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește itemele sub pragul minim pentru un tenant.
 * @param {string} tenantId
 * @returns {Promise<Array>}
 */
async function findLowStockItems(tenantId) {
  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  try {
    // Nedb nu suportă comparații directe între câmpuri,
    // deci găsim toate itemele și filtrăm în memorie
    const allItems = await nedbFind({ tenantId });
    return allItems.filter((item) => item.quantity < item.minThreshold);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la căutarea itemelor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Actualizează cantitatea unui item (setare directă).
 * @param {string} id
 * @param {number} quantity
 * @returns {Promise<Object>}
 */
async function updateQuantity(id, quantity) {
  if (!id) {
    throw new AppError('ID-ul itemului este invalid.', 400, 'INVALID_ITEM_ID');
  }

  if (!isValidQuantity(quantity)) {
    throw new AppError('Cantitatea trebuie să fie un număr pozitiv.', 400, 'INVALID_QUANTITY');
  }

  try {
    const existing = await findInventoryItemById(id);
    if (!existing) {
      throw new AppError('Produsul nu a fost găsit.', 404, 'ITEM_NOT_FOUND');
    }

    const now = new Date().toISOString();
    await nedbUpdate(
      { _id: id },
      { $set: { quantity, lastUpdated: now, updatedAt: now } },
      { returnUpdatedDocs: true }
    );

    const updated = await findInventoryItemById(id);
    return updated;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la actualizarea cantității: ' + err.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Ajustează cantitatea unui item (adună/scade delta).
 * @param {string} id
 * @param {number} delta
 * @returns {Promise<Object>}
 */
async function adjustQuantity(id, delta) {
  if (!id) {
    throw new AppError('ID-ul itemului este invalid.', 400, 'INVALID_ITEM_ID');
  }

  if (typeof delta !== 'number' || isNaN(delta)) {
    throw new AppError('Delta trebuie să fie un număr valid.', 400, 'INVALID_DELTA');
  }

  try {
    const existing = await findInventoryItemById(id);
    if (!existing) {
      throw new AppError('Produsul nu a fost găsit.', 404, 'ITEM_NOT_FOUND');
    }

    const newQuantity = existing.quantity + delta;
    if (newQuantity < 0) {
      throw new AppError('Cantitatea nu poate fi negativă.', 400, 'NEGATIVE_QUANTITY');
    }

    const now = new Date().toISOString();
    const result = await nedbUpdate(
      { _id: id },
      { $set: { quantity: newQuantity, lastUpdated: now, updatedAt: now } },
      { returnUpdatedDocs: true }
    );

    if (result.numAffected === 0) {
      throw new AppError('Produsul nu a fost găsit.', 404, 'ITEM_NOT_FOUND');
    }

    const updated = await findInventoryItemById(id);
    return updated;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la ajustarea cantității: ' + err.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Actualizează metadatele unui item de inventar.
 * Câmpurile permise: name, category, unit, minThreshold, supplierId
 * Câmpurile interzise: quantity, locationId, locationType, tenantId
 *
 * @param {string} id
 * @param {Object} data
 * @returns {Promise<Object>}
 */
async function updateInventoryItem(id, data) {
  if (!id) {
    throw new AppError('ID-ul itemului este invalid.', 400, 'INVALID_ITEM_ID');
  }

  if (!data || typeof data !== 'object') {
    throw new AppError('Datele de actualizare sunt invalide.', 400, 'INVALID_UPDATE_DATA');
  }

  const allowedFields = ['name', 'category', 'unit', 'minThreshold', 'supplierId'];
  const updates = {};

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      let value = data[field];

      // Validare per câmp
      switch (field) {
        case 'name':
          if (!isValidName(value)) {
            throw new AppError('Numele produsului este invalid.', 400, 'INVALID_NAME');
          }
          value = value.trim();
          break;

        case 'category':
          if (!isValidCategory(value)) {
            throw new AppError('Categoria nu este validă.', 400, 'INVALID_CATEGORY');
          }
          break;

        case 'unit':
          if (!isValidUnit(value)) {
            throw new AppError('Unitatea de măsură nu este validă.', 400, 'INVALID_UNIT');
          }
          break;

        case 'minThreshold':
          if (!isValidThreshold(value)) {
            throw new AppError('Pragul minim nu este valid.', 400, 'INVALID_THRESHOLD');
          }
          break;

        case 'supplierId':
          // supplierId poate fi null sau string
          break;

        default:
          break;
      }

      updates[field] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new AppError('Nu s-au furnizat câmpuri valide pentru actualizare.', 400, 'NO_VALID_FIELDS');
  }

  try {
    const existing = await findInventoryItemById(id);
    if (!existing) {
      throw new AppError('Produsul nu a fost găsit.', 404, 'ITEM_NOT_FOUND');
    }

    const now = new Date().toISOString();
    updates.updatedAt = now;
    updates.lastUpdated = now;

    await nedbUpdate(
      { _id: id },
      { $set: updates },
      { returnUpdatedDocs: true }
    );

    const updated = await findInventoryItemById(id);
    return updated;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la actualizarea itemului: ' + err.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Șterge un item de inventar după ID.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
async function deleteInventoryItem(id) {
  if (!id) {
    throw new AppError('ID-ul itemului este invalid.', 400, 'INVALID_ITEM_ID');
  }

  try {
    const existing = await findInventoryItemById(id);
    if (!existing) {
      throw new AppError('Produsul nu a fost găsit.', 404, 'ITEM_NOT_FOUND');
    }

    await nedbRemove({ _id: id }, {});
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

/**
 * Numără itemele de inventar pentru un tenant.
 * @param {string} tenantId
 * @param {Object} [options]
 * @param {string} [options.category]
 * @returns {Promise<number>}
 */
async function countInventoryItems(tenantId, options) {
  if (!options) options = {};

  if (!tenantId) {
    return 0;
  }

  const query = { tenantId };
  if (options.category) query.category = options.category;

  try {
    return await nedbCount(query);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la numărarea itemelor: ' + err.message,
      500,
      'DB_COUNT_ERROR'
    );
  }
}

/**
 * Găsește itemele de inventar după furnizor.
 * @param {string} supplierId
 * @returns {Promise<Array>}
 */
async function findInventoryItemsBySupplier(supplierId) {
  if (!supplierId) {
    throw new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID');
  }

  try {
    return await nedbFind({ supplierId }, { name: 1 });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Eroare la căutarea itemelor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Returnează sumarul inventarului pe categorii.
 * @param {string} tenantId
 * @returns {Promise<Array<{category: string, count: number, totalQuantity: number}>>}
 */
async function getInventorySummary(tenantId) {
  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  try {
    const items = await nedbFind({ tenantId });

    const summaryMap = {};
    for (const item of items) {
      const cat = item.category;
      if (!summaryMap[cat]) {
        summaryMap[cat] = { category: cat, count: 0, totalQuantity: 0 };
      }
      summaryMap[cat].count += 1;
      summaryMap[cat].totalQuantity += item.quantity;
    }

    return Object.values(summaryMap);
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
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Colecția Nedb (expusă pentru stubbing în teste)
  inventoryItems,

  // Constante
  VALID_CATEGORIES,
  VALID_UNITS,
  VALID_LOCATION_TYPES,

  // Funcții de validare
  isValidName,
  isValidCategory,
  isValidUnit,
  isValidLocationType,
  isValidQuantity,
  isValidThreshold,

  // Operații CRUD
  createInventoryItem,
  findInventoryItemById,
  findInventoryItemsByTenant,
  findInventoryItemsByLocation,
  findLowStockItems,
  updateQuantity,
  adjustQuantity,
  updateInventoryItem,
  deleteInventoryItem,
  countInventoryItems,
  findInventoryItemsBySupplier,
  getInventorySummary,
};
