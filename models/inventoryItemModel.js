'use strict';

// ---------------------------------------------------------------------------
// Model InventoryItem – GastroHub
// Model SQL (sql.js/SQLite) pentru iteme de inventar (alimente, băuturi,
// consumabile).
// Tabela: inventory_items
// ---------------------------------------------------------------------------

const { getDb, get, all, run } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Categorii valide
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = [
  'alimente',
  'băuturi',
  'consumabile',
  'alte',
];

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
// Separator pentru stocarea locationId + locationType în coloana location
// ---------------------------------------------------------------------------

const LOCATION_SEPARATOR = '::';

/**
 * Construiește valoarea pentru coloana location din locationType și locationId.
 * @param {string} locationType
 * @param {string} locationId
 * @returns {string}
 */
function buildLocationValue(locationType, locationId) {
  return locationType + LOCATION_SEPARATOR + locationId;
}

/**
 * Parsează valoarea coloanei location în { locationId, locationType }.
 * @param {string} locationValue
 * @returns {{ locationId: string, locationType: string }}
 */
function parseLocationValue(locationValue) {
  if (!locationValue || typeof locationValue !== 'string') {
    return { locationId: '', locationType: '' };
  }
  const idx = locationValue.indexOf(LOCATION_SEPARATOR);
  if (idx === -1) {
    return { locationId: locationValue, locationType: '' };
  }
  return {
    locationType: locationValue.substring(0, idx),
    locationId: locationValue.substring(idx + LOCATION_SEPARATOR.length),
  };
}

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un nume de item este valid.
 * @param {*} name
 * @returns {boolean}
 */
function isValidName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 200;
}

/**
 * Verifică dacă o categorie este validă.
 * @param {string} category
 * @returns {boolean}
 */
function isValidCategory(category) {
  return VALID_CATEGORIES.includes(category);
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
 * Verifică dacă o cantitate este un număr valid (>= 0).
 * @param {*} quantity
 * @returns {boolean}
 */
function isValidQuantity(quantity) {
  return typeof quantity === 'number' && !isNaN(quantity) && quantity >= 0;
}

/**
 * Verifică dacă un prag minim este un număr valid (>= 0).
 * @param {*} threshold
 * @returns {boolean}
 */
function isValidThreshold(threshold) {
  return typeof threshold === 'number' && !isNaN(threshold) && threshold >= 0;
}

// ---------------------------------------------------------------------------
// Helper: transformă un rând SQL (raw) în obiect cu nume vechi de câmpuri
// (backward compatibility cu NeDB).
// ---------------------------------------------------------------------------

/**
 * @param {Object} row - rândul returnat de SQLite
 * @returns {Object} obiectul transformat
 */
function transformRow(row) {
  if (!row) return null;

  const loc = parseLocationValue(row.location);

  return {
    _id: row._id != null ? String(row._id) : (row.id != null ? String(row.id) : null),
    id: row._id != null ? String(row._id) : (row.id != null ? String(row.id) : null),
    name: row.name,
    category: row.category,
    quantity: row.quantity,
    unit: row.unit,
    minThreshold: row.minThreshold != null ? row.minThreshold : (row.minQuantity != null ? row.minQuantity : 0),
    minQuantity: row.minQuantity != null ? row.minQuantity : (row.minThreshold != null ? row.minThreshold : 0),
    maxQuantity: row.maxQuantity,
    price: row.price,
    currency: row.currency,
    sku: row.sku,
    description: row.description,
    expiryDate: row.expiryDate,
    status: row.status,
    locationId: loc.locationId,
    locationType: loc.locationType,
    location: row.location,
    supplierId: row.supplierId,
    tenantId: row.tenantId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUpdated: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Operații CRUD
// ---------------------------------------------------------------------------

/**
 * Creează un item de inventar nou.
 *
 * @param {Object} itemData - Datele itemului
 * @param {string} itemData.name - Denumirea itemului
 * @param {string} itemData.category - Categoria (alimente, băuturi, consumabile, alte)
 * @param {number} itemData.quantity - Cantitatea disponibilă
 * @param {string} itemData.unit - Unitatea de măsură (kg, g, l, ml, buc, etc.)
 * @param {number} [itemData.minThreshold=0] - Prag minim de alertă
 * @param {string} itemData.locationId - ID-ul locației (restaurant sau hotel)
 * @param {string} itemData.locationType - Tipul locației ('restaurant' sau 'hotel')
 * @param {string} [itemData.supplierId=null] - ID-ul furnizorului
 * @param {string} itemData.tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Itemul creat
 * @throws {AppError} Dacă validarea eșuează
 */
function createInventoryItem(itemData) {
  // Validare câmpuri obligatorii
  if (!itemData || typeof itemData !== 'object') {
    return Promise.reject(new AppError('Datele itemului de inventar sunt invalide.', 400, 'INVALID_ITEM_DATA'));
  }

  const {
    name,
    category,
    quantity,
    unit,
    minThreshold,
    locationId,
    locationType,
    supplierId,
    tenantId,
  } = itemData;

  // Validare name
  if (!name || !isValidName(name)) {
    return Promise.reject(new AppError(
      'Denumirea itemului trebuie să fie un șir de caractere între 1 și 200.',
      400,
      'INVALID_NAME'
    ));
  }

  // Validare category
  if (!category || !isValidCategory(category)) {
    return Promise.reject(new AppError(
      'Categoria "' + category + '" nu este validă. Categorii acceptate: ' + VALID_CATEGORIES.join(', ') + '.',
      400,
      'INVALID_CATEGORY'
    ));
  }

  // Validare quantity
  if (quantity === undefined || quantity === null || !isValidQuantity(quantity)) {
    return Promise.reject(new AppError(
      'Cantitatea trebuie să fie un număr mai mare sau egal cu 0.',
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

  // Validare locationId
  if (!locationId) {
    return Promise.reject(new AppError(
      'ID-ul locației este obligatoriu.',
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
  if (!tenantId) {
    return Promise.reject(new AppError(
      'ID-ul tenant-ului este obligatoriu.',
      400,
      'INVALID_TENANT_ID'
    ));
  }

  // Validare minThreshold (opțional, default 0)
  const finalThreshold = (minThreshold !== undefined && minThreshold !== null)
    ? minThreshold
    : 0;
  if (!isValidThreshold(finalThreshold)) {
    return Promise.reject(new AppError(
      'Pragul minim trebuie să fie un număr mai mare sau egal cu 0.',
      400,
      'INVALID_THRESHOLD'
    ));
  }

  // Validare supplierId (opțional)
  const finalSupplierId = supplierId !== undefined ? supplierId : null;

  const trimmedName = name.trim();
  const locationValue = buildLocationValue(locationType, locationId);

  try {
    const db = getDb();

    // Verificare duplicat: același nume + tenantId + location
    const existing = get(
      'SELECT id FROM inventory_items WHERE name = ? AND tenantId = ? AND location = ?',
      [trimmedName, tenantId, locationValue]
    );

    if (existing) {
      return Promise.reject(new AppError(
        'Există deja un item cu denumirea "' + trimmedName + '" în această locație.',
        409,
        'DUPLICATE_ITEM'
      ));
    }

    // Creare înregistrare
    const now = new Date().toISOString();

    const result = run(
      'INSERT INTO inventory_items (name, category, quantity, unit, minQuantity, location, supplierId, tenantId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [trimmedName, category, quantity, unit, finalThreshold, locationValue, finalSupplierId, tenantId, now, now]
    );

    const newId = result.lastInsertRowid;

    // Returnăm obiectul creat
    const created = get(
      'SELECT id AS _id, name, category, quantity, unit, minQuantity AS minThreshold, location, supplierId, tenantId, createdAt, updatedAt FROM inventory_items WHERE id = ?',
      [newId]
    );

    return Promise.resolve(transformRow(created));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la crearea itemului de inventar: ' + err.message,
      500,
      'DB_INSERT_ERROR'
    ));
  }
}

/**
 * Găsește un item de inventar după ID.
 * @param {string|number} id - ID-ul itemului
 * @returns {Promise<Object|null>} Itemul sau null
 */
function findInventoryItemById(id) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
  }

  try {
    const db = getDb();

    const row = get(
      'SELECT id AS _id, name, category, quantity, unit, minQuantity AS minThreshold, location, supplierId, tenantId, createdAt, updatedAt FROM inventory_items WHERE id = ?',
      [id]
    );

    return Promise.resolve(transformRow(row));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea itemului: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește iteme de inventar după tenantId.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options] - Opțiuni de filtrare suplimentare
 * @param {string} [options.category] - Filtrare după categorie
 * @param {string} [options.locationId] - Filtrare după locație
 * @param {string} [options.locationType] - Filtrare după tip locație
 * @param {string} [options.supplierId] - Filtrare după furnizor
 * @param {string} [options.sortBy='name'] - Câmpul după care se sortează
 * @param {string} [options.sortOrder='asc'] - 'asc' sau 'desc'
 * @returns {Promise<Array>} Lista de iteme
 */
function findInventoryItemsByTenant(tenantId, options) {
  if (!options) options = {};

  if (!tenantId) {
    return Promise.reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
  }

  try {
    const db = getDb();

    // Construim clauza WHERE dinamic
    const conditions = ['tenantId = ?'];
    const params = [tenantId];

    if (options.category) {
      conditions.push('category = ?');
      params.push(options.category);
    }

    if (options.locationId) {
      if (options.locationType) {
        // Căutare exactă după locationType::locationId
        conditions.push('location = ?');
        params.push(buildLocationValue(options.locationType, options.locationId));
      } else {
        // Căutare după locationId (LIKE la final)
        conditions.push('location LIKE ?');
        params.push('%' + LOCATION_SEPARATOR + options.locationId);
      }
    } else if (options.locationType) {
      // Căutare după locationType (LIKE la început)
      conditions.push('location LIKE ?');
      params.push(options.locationType + LOCATION_SEPARATOR + '%');
    }

    if (options.supplierId) {
      conditions.push('supplierId = ?');
      params.push(options.supplierId);
    }

    const sortBy = options.sortBy || 'name';
    // Mapare nume vechi de câmpuri la coloane reale
    const columnMap = {
      name: 'name',
      category: 'category',
      quantity: 'quantity',
      unit: 'unit',
      minThreshold: 'minQuantity',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    };
    const sortColumn = columnMap[sortBy] || 'name';
    const sortDir = options.sortOrder === 'desc' ? 'DESC' : 'ASC';

    const whereClause = conditions.join(' AND ');

    const rows = all(
      'SELECT id AS _id, name, category, quantity, unit, minQuantity AS minThreshold, location, supplierId, tenantId, createdAt, updatedAt FROM inventory_items WHERE ' + whereClause + ' ORDER BY ' + sortColumn + ' ' + sortDir,
      params
    );

    return Promise.resolve((rows || []).map(transformRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea itemelor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește iteme de inventar după locație.
 * @param {string} locationId - ID-ul locației
 * @param {string} locationType - Tipul locației ('restaurant' sau 'hotel')
 * @returns {Promise<Array>} Lista de iteme
 */
function findInventoryItemsByLocation(locationId, locationType) {
  if (!locationId) {
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

    const locationValue = buildLocationValue(locationType, locationId);

    const rows = all(
      'SELECT id AS _id, name, category, quantity, unit, minQuantity AS minThreshold, location, supplierId, tenantId, createdAt, updatedAt FROM inventory_items WHERE location = ? ORDER BY name ASC',
      [locationValue]
    );

    return Promise.resolve((rows || []).map(transformRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea itemelor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește iteme de inventar care sunt sub pragul minim (stock scăzut).
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>} Lista de iteme sub prag
 */
function findLowStockItems(tenantId) {
  if (!tenantId) {
    return Promise.reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
  }

  try {
    const db = getDb();

    const rows = all(
      'SELECT id AS _id, name, category, quantity, unit, minQuantity AS minThreshold, location, supplierId, tenantId, createdAt, updatedAt FROM inventory_items WHERE tenantId = ? AND quantity < minQuantity ORDER BY name ASC',
      [tenantId]
    );

    return Promise.resolve((rows || []).map(transformRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea itemelor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Actualizează cantitatea unui item de inventar.
 * @param {string|number} id - ID-ul itemului
 * @param {number} newQuantity - Noua cantitate
 * @returns {Promise<Object>} Itemul actualizat
 */
function updateQuantity(id, newQuantity) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
  }

  if (!isValidQuantity(newQuantity)) {
    return Promise.reject(new AppError(
      'Cantitatea trebuie să fie un număr mai mare sau egal cu 0.',
      400,
      'INVALID_QUANTITY'
    ));
  }

  try {
    const db = getDb();
    const now = new Date().toISOString();

    const result = run(
      'UPDATE inventory_items SET quantity = ?, updatedAt = ? WHERE id = ?',
      [newQuantity, now, id]
    );

    if (result.changes === 0) {
      return Promise.reject(new AppError('Itemul de inventar nu a fost găsit.', 404, 'ITEM_NOT_FOUND'));
    }

    const updated = get(
      'SELECT id AS _id, name, category, quantity, unit, minQuantity AS minThreshold, location, supplierId, tenantId, createdAt, updatedAt FROM inventory_items WHERE id = ?',
      [id]
    );

    return Promise.resolve(transformRow(updated));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la actualizarea cantității: ' + err.message,
      500,
      'DB_UPDATE_ERROR'
    ));
  }
}

/**
 * Adună (sau scade) o valoare la cantitatea existentă.
 * @param {string|number} id - ID-ul itemului
 * @param {number} delta - Valoarea de adăugat (poate fi negativă)
 * @returns {Promise<Object>} Itemul actualizat
 */
function adjustQuantity(id, delta) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
  }

  if (typeof delta !== 'number' || isNaN(delta)) {
    return Promise.reject(new AppError(
      'Valoarea de ajustare trebuie să fie un număr.',
      400,
      'INVALID_DELTA'
    ));
  }

  try {
    const db = getDb();

    // Căutăm itemul existent
    const item = get(
      'SELECT id, quantity FROM inventory_items WHERE id = ?',
      [id]
    );

    if (!item) {
      return Promise.reject(new AppError('Itemul de inventar nu a fost găsit.', 404, 'ITEM_NOT_FOUND'));
    }

    const newQuantity = item.quantity + delta;

    if (newQuantity < 0) {
      return Promise.reject(new AppError(
        'Cantitatea rezultată nu poate fi negativă.',
        400,
        'NEGATIVE_QUANTITY'
      ));
    }

    const now = new Date().toISOString();

    const result = run(
      'UPDATE inventory_items SET quantity = ?, updatedAt = ? WHERE id = ?',
      [newQuantity, now, id]
    );

    if (result.changes === 0) {
      return Promise.reject(new AppError('Itemul de inventar nu a fost găsit.', 404, 'ITEM_NOT_FOUND'));
    }

    const updated = get(
      'SELECT id AS _id, name, category, quantity, unit, minQuantity AS minThreshold, location, supplierId, tenantId, createdAt, updatedAt FROM inventory_items WHERE id = ?',
      [id]
    );

    return Promise.resolve(transformRow(updated));
  } catch (err) {
    // Dacă eroarea este deja AppError, o pasăm mai departe
    if (err instanceof AppError) {
      return Promise.reject(err);
    }
    return Promise.reject(new AppError(
      'Eroare la ajustarea cantității: ' + err.message,
      500,
      'DB_UPDATE_ERROR'
    ));
  }
}

/**
 * Actualizează un item de inventar.
 * @param {string|number} id - ID-ul itemului
 * @param {Object} updateData - Datele de actualizat (câmpurile permise)
 * @returns {Promise<Object>} Itemul actualizat
 */
function updateInventoryItem(id, updateData) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
  }

  if (!updateData || typeof updateData !== 'object') {
    return Promise.reject(new AppError('Datele de actualizare sunt invalide.', 400, 'INVALID_UPDATE_DATA'));
  }

  // Construim obiectul de actualizat doar cu câmpurile permise
  const allowedFields = ['name', 'category', 'unit', 'minThreshold', 'supplierId'];
  const setClauses = [];
  const params = [];
  let hasValidFields = false;

  for (let i = 0; i < allowedFields.length; i++) {
    const field = allowedFields[i];
    if (updateData[field] !== undefined) {
      // Validăm fiecare câmp
      switch (field) {
        case 'name':
          if (!isValidName(updateData[field])) {
            return Promise.reject(new AppError(
              'Denumirea itemului trebuie să fie un șir de caractere între 1 și 200.',
              400,
              'INVALID_NAME'
            ));
          }
          setClauses.push('name = ?');
          params.push(updateData[field].trim());
          break;
        case 'category':
          if (!isValidCategory(updateData[field])) {
            return Promise.reject(new AppError(
              'Categoria "' + updateData[field] + '" nu este validă.',
              400,
              'INVALID_CATEGORY'
            ));
          }
          setClauses.push('category = ?');
          params.push(updateData[field]);
          break;
        case 'unit':
          if (!isValidUnit(updateData[field])) {
            return Promise.reject(new AppError(
              'Unitatea de măsură "' + updateData[field] + '" nu este validă.',
              400,
              'INVALID_UNIT'
            ));
          }
          setClauses.push('unit = ?');
          params.push(updateData[field]);
          break;
        case 'minThreshold':
          if (!isValidThreshold(updateData[field])) {
            return Promise.reject(new AppError(
              'Pragul minim trebuie să fie un număr mai mare sau egal cu 0.',
              400,
              'INVALID_THRESHOLD'
            ));
          }
          setClauses.push('minQuantity = ?');
          params.push(updateData[field]);
          break;
        case 'supplierId':
          setClauses.push('supplierId = ?');
          params.push(updateData[field]);
          break;
      }
      hasValidFields = true;
    }
  }

  if (!hasValidFields) {
    return Promise.reject(new AppError(
      'Nu există câmpuri valide de actualizat.',
      400,
      'NO_VALID_FIELDS'
    ));
  }

  // Actualizăm și updatedAt
  const now = new Date().toISOString();
  setClauses.push('updatedAt = ?');
  params.push(now);

  // Adăugăm id-ul la finalul parametrilor
  params.push(id);

  try {
    const db = getDb();

    const result = run(
      'UPDATE inventory_items SET ' + setClauses.join(', ') + ' WHERE id = ?',
      params
    );

    if (result.changes === 0) {
      return Promise.reject(new AppError('Itemul de inventar nu a fost găsit.', 404, 'ITEM_NOT_FOUND'));
    }

    const updated = get(
      'SELECT id AS _id, name, category, quantity, unit, minQuantity AS minThreshold, location, supplierId, tenantId, createdAt, updatedAt FROM inventory_items WHERE id = ?',
      [id]
    );

    return Promise.resolve(transformRow(updated));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la actualizarea itemului: ' + err.message,
      500,
      'DB_UPDATE_ERROR'
    ));
  }
}

/**
 * Șterge un item de inventar după ID.
 * @param {string|number} id - ID-ul itemului
 * @returns {Promise<boolean>} true dacă a fost șters
 */
function deleteInventoryItem(id) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
  }

  try {
    const db = getDb();

    const result = run(
      'DELETE FROM inventory_items WHERE id = ?',
      [id]
    );

    if (result.changes === 0) {
      return Promise.reject(new AppError('Itemul de inventar nu a fost găsit.', 404, 'ITEM_NOT_FOUND'));
    }

    return Promise.resolve(true);
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la ștergerea itemului: ' + err.message,
      500,
      'DB_DELETE_ERROR'
    ));
  }
}

/**
 * Numără itemele de inventar dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.category] - Filtrare după categorie
 * @returns {Promise<number>}
 */
function countInventoryItems(tenantId, options) {
  if (!options) options = {};

  if (!tenantId) {
    return Promise.resolve(0);
  }

  try {
    const db = getDb();

    const conditions = ['tenantId = ?'];
    const params = [tenantId];

    if (options.category) {
      conditions.push('category = ?');
      params.push(options.category);
    }

    const whereClause = conditions.join(' AND ');

    const row = get(
      'SELECT COUNT(*) AS cnt FROM inventory_items WHERE ' + whereClause,
      params
    );

    return Promise.resolve(row ? row.cnt : 0);
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la numărarea itemelor: ' + err.message,
      500,
      'DB_COUNT_ERROR'
    ));
  }
}

/**
 * Obține toate itemele care aparțin unui anumit furnizor.
 * @param {string} supplierId - ID-ul furnizorului
 * @returns {Promise<Array>} Lista de iteme
 */
function findInventoryItemsBySupplier(supplierId) {
  if (!supplierId) {
    return Promise.reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
  }

  try {
    const db = getDb();

    const rows = all(
      'SELECT id AS _id, name, category, quantity, unit, minQuantity AS minThreshold, location, supplierId, tenantId, createdAt, updatedAt FROM inventory_items WHERE supplierId = ? ORDER BY name ASC',
      [supplierId]
    );

    return Promise.resolve((rows || []).map(transformRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea itemelor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Obține un sumar al inventarului pe categorii pentru un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>} Lista de obiecte { category, count, totalQuantity }
 */
function getInventorySummary(tenantId) {
  if (!tenantId) {
    return Promise.reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
  }

  try {
    const db = getDb();

    const rows = all(
      'SELECT category, COUNT(*) AS count, SUM(quantity) AS totalQuantity FROM inventory_items WHERE tenantId = ? GROUP BY category ORDER BY category ASC',
      [tenantId]
    );

    return Promise.resolve((rows || []).map(function (r) {
      return {
        category: r.category,
        count: r.count,
        totalQuantity: r.totalQuantity || 0,
      };
    }));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea itemelor: ' + err.message,
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
  VALID_CATEGORIES,
  VALID_UNITS,
  VALID_LOCATION_TYPES,

  // Validare
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
  updateInventoryItem,
  updateQuantity,
  adjustQuantity,
  deleteInventoryItem,
  countInventoryItems,
  findInventoryItemsBySupplier,
  getInventorySummary,

  // Helper-e pentru locație (utile în alte module)
  buildLocationValue,
  parseLocationValue,
};