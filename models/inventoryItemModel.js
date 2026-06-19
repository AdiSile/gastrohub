'use strict';

// ---------------------------------------------------------------------------
// Model InventoryItem – GastroHub
// Model NeDB pentru iteme de inventar (alimente, băuturi, consumabile).
// Câmpuri: name, category, quantity, unit, minThreshold, locationId,
//          locationType (restaurant/hotel), supplierId, tenantId,
//          updatedAt, createdAt
// ---------------------------------------------------------------------------

const { AppError } = require('../middleware/errorHandler');
const { inventoryItems } = require('../config/db');

// ---------------------------------------------------------------------------
// Indexuri specifice modelului (cele generice sunt deja create în config/db.js)
// ---------------------------------------------------------------------------

/**
 * Index pentru căutarea itemelor după locationId.
 * (nu este definit în config/db.js – specific acestui model)
 */
inventoryItems.ensureIndex({ fieldName: 'locationId' }, (err) => {
  if (err) {
    console.error('[inventoryItemModel] Eroare la crearea indexului pe locationId:', err.message);
  }
});

/**
 * Index pentru căutarea itemelor după locationType.
 * (nu este definit în config/db.js – specific acestui model)
 */
inventoryItems.ensureIndex({ fieldName: 'locationType' }, (err) => {
  if (err) {
    console.error('[inventoryItemModel] Eroare la crearea indexului pe locationType:', err.message);
  }
});

/**
 * Index pentru căutarea itemelor după nume.
 * (nu este definit în config/db.js – specific acestui model)
 */
inventoryItems.ensureIndex({ fieldName: 'name', unique: false }, (err) => {
  if (err) {
    console.error('[inventoryItemModel] Eroare la crearea indexului pe name:', err.message);
  }
});

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
 * @returns {Promise<Object>} Documentul itemului creat
 * @throws {AppError} Dacă validarea eșuează
 */
function createInventoryItem(itemData) {
  return new Promise((resolve, reject) => {
    // -----------------------------------------------------------------------
    // Validare câmpuri obligatorii
    // -----------------------------------------------------------------------
    if (!itemData || typeof itemData !== 'object') {
      return reject(new AppError('Datele itemului de inventar sunt invalide.', 400, 'INVALID_ITEM_DATA'));
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
      return reject(new AppError(
        'Denumirea itemului trebuie să fie un șir de caractere între 1 și 200.',
        400,
        'INVALID_NAME'
      ));
    }

    // Validare category
    if (!category || !isValidCategory(category)) {
      return reject(new AppError(
        `Categoria "${category}" nu este validă. Categorii acceptate: ${VALID_CATEGORIES.join(', ')}.`,
        400,
        'INVALID_CATEGORY'
      ));
    }

    // Validare quantity
    if (quantity === undefined || quantity === null || !isValidQuantity(quantity)) {
      return reject(new AppError(
        'Cantitatea trebuie să fie un număr mai mare sau egal cu 0.',
        400,
        'INVALID_QUANTITY'
      ));
    }

    // Validare unit
    if (!unit || !isValidUnit(unit)) {
      return reject(new AppError(
        `Unitatea de măsură "${unit}" nu este validă. Unități acceptate: ${VALID_UNITS.join(', ')}.`,
        400,
        'INVALID_UNIT'
      ));
    }

    // Validare locationId
    if (!locationId) {
      return reject(new AppError(
        'ID-ul locației este obligatoriu.',
        400,
        'INVALID_LOCATION_ID'
      ));
    }

    // Validare locationType
    if (!locationType || !isValidLocationType(locationType)) {
      return reject(new AppError(
        `Tipul locației trebuie să fie "restaurant" sau "hotel".`,
        400,
        'INVALID_LOCATION_TYPE'
      ));
    }

    // Validare tenantId
    if (!tenantId) {
      return reject(new AppError(
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
      return reject(new AppError(
        'Pragul minim trebuie să fie un număr mai mare sau egal cu 0.',
        400,
        'INVALID_THRESHOLD'
      ));
    }

    // Validare supplierId (opțional)
    const finalSupplierId = supplierId !== undefined ? supplierId : null;

    // -----------------------------------------------------------------------
    // Verificare duplicat: același nume + tenantId + locationId
    // -----------------------------------------------------------------------
    const trimmedName = name.trim();

    inventoryItems.findOne(
      { name: trimmedName, tenantId, locationId },
      (findErr, existingItem) => {
        if (findErr) {
          return reject(new AppError(
            `Eroare la verificarea duplicatelor: ${findErr.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        if (existingItem) {
          return reject(new AppError(
            `Există deja un item cu denumirea "${trimmedName}" în această locație.`,
            409,
            'DUPLICATE_ITEM'
          ));
        }

        // -----------------------------------------------------------------------
        // Creare document
        // -----------------------------------------------------------------------
        const now = new Date().toISOString();

        const itemDoc = {
          name: trimmedName,
          category,
          quantity,
          unit,
          minThreshold: finalThreshold,
          locationId,
          locationType,
          supplierId: finalSupplierId,
          tenantId,
          updatedAt: now,
          lastUpdated: now,
          createdAt: now,
        };

        inventoryItems.insert(itemDoc, (insertErr, newItem) => {
          if (insertErr) {
            return reject(new AppError(
              `Eroare la crearea itemului de inventar: ${insertErr.message}`,
              500,
              'DB_INSERT_ERROR'
            ));
          }

          resolve(newItem);
        });
      }
    );
  });
}

/**
 * Găsește un item de inventar după ID.
 * @param {string} id - ID-ul NeDB
 * @returns {Promise<Object|null>} Documentul itemului sau null
 */
function findInventoryItemById(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
    }

    inventoryItems.findOne({ _id: id }, (err, item) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea itemului: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(item || null);
    });
  });
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
function findInventoryItemsByTenant(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const query = { tenantId };

    if (options.category) {
      query.category = options.category;
    }

    if (options.locationId) {
      query.locationId = options.locationId;
    }

    if (options.locationType) {
      query.locationType = options.locationType;
    }

    if (options.supplierId) {
      query.supplierId = options.supplierId;
    }

    inventoryItems.find(query)
      .sort({ [options.sortBy || 'name']: options.sortOrder === 'desc' ? -1 : 1 })
      .exec((err, items) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea itemelor: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        resolve(items || []);
      });
  });
}

/**
 * Găsește iteme de inventar după locație.
 * @param {string} locationId - ID-ul locației
 * @param {string} locationType - Tipul locației ('restaurant' sau 'hotel')
 * @returns {Promise<Array>} Lista de iteme
 */
function findInventoryItemsByLocation(locationId, locationType) {
  return new Promise((resolve, reject) => {
    if (!locationId) {
      return reject(new AppError('ID-ul locației este invalid.', 400, 'INVALID_LOCATION_ID'));
    }

    if (!locationType || !isValidLocationType(locationType)) {
      return reject(new AppError(
        `Tipul locației trebuie să fie "restaurant" sau "hotel".`,
        400,
        'INVALID_LOCATION_TYPE'
      ));
    }

    const query = { locationId, locationType };

    inventoryItems.find(query)
      .sort({ name: 1 })
      .exec((err, items) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea itemelor: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        resolve(items || []);
      });
  });
}

/**
 * Găsește iteme de inventar care sunt sub pragul minim (stock scăzut).
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>} Lista de iteme sub prag
 */
function findLowStockItems(tenantId) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    // Folosim $where pentru a compara quantity cu minThreshold
    // Notă: $where este mai lent, dar NeDB nu suportă $expr
    inventoryItems.find({ tenantId }, (err, allItems) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea itemelor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      const lowStock = (allItems || []).filter(
        (item) => item.quantity < item.minThreshold
      );

      resolve(lowStock);
    });
  });
}

/**
 * Actualizează cantitatea unui item de inventar.
 * @param {string} id - ID-ul itemului
 * @param {number} newQuantity - Noua cantitate
 * @returns {Promise<Object>} Itemul actualizat
 */
function updateQuantity(id, newQuantity) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
    }

    if (!isValidQuantity(newQuantity)) {
      return reject(new AppError(
        'Cantitatea trebuie să fie un număr mai mare sau egal cu 0.',
        400,
        'INVALID_QUANTITY'
      ));
    }

    const now = new Date().toISOString();

    inventoryItems.update(
      { _id: id },
      { $set: { quantity: newQuantity, lastUpdated: now, updatedAt: now } },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedItem) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea cantității: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Itemul de inventar nu a fost găsit.', 404, 'ITEM_NOT_FOUND'));
        }

        resolve(updatedItem);
      }
    );
  });
}

/**
 * Adună (sau scade) o valoare la cantitatea existentă.
 * @param {string} id - ID-ul itemului
 * @param {number} delta - Valoarea de adăugat (poate fi negativă)
 * @returns {Promise<Object>} Itemul actualizat
 */
function adjustQuantity(id, delta) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
    }

    if (typeof delta !== 'number' || isNaN(delta)) {
      return reject(new AppError(
        'Valoarea de ajustare trebuie să fie un număr.',
        400,
        'INVALID_DELTA'
      ));
    }

    // Căutăm itemul existent pentru a calcula noua cantitate
    inventoryItems.findOne({ _id: id }, (findErr, item) => {
      if (findErr) {
        return reject(new AppError(
          `Eroare la căutarea itemului: ${findErr.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      if (!item) {
        return reject(new AppError('Itemul de inventar nu a fost găsit.', 404, 'ITEM_NOT_FOUND'));
      }

      const newQuantity = item.quantity + delta;

      if (newQuantity < 0) {
        return reject(new AppError(
          'Cantitatea rezultată nu poate fi negativă.',
          400,
          'NEGATIVE_QUANTITY'
        ));
      }

      const now = new Date().toISOString();

      inventoryItems.update(
        { _id: id },
        { $set: { quantity: newQuantity, lastUpdated: now, updatedAt: now } },
        { returnUpdatedDocs: true },
        (updateErr, numUpdated, updatedItem) => {
          if (updateErr) {
            return reject(new AppError(
              `Eroare la ajustarea cantității: ${updateErr.message}`,
              500,
              'DB_UPDATE_ERROR'
            ));
          }

          if (numUpdated === 0) {
            return reject(new AppError('Itemul de inventar nu a fost găsit.', 404, 'ITEM_NOT_FOUND'));
          }

          resolve(updatedItem);
        }
      );
    });
  });
}

/**
 * Actualizează un item de inventar.
 * @param {string} id - ID-ul itemului
 * @param {Object} updateData - Datele de actualizat (câmpurile permise)
 * @returns {Promise<Object>} Itemul actualizat
 */
function updateInventoryItem(id, updateData) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
    }

    if (!updateData || typeof updateData !== 'object') {
      return reject(new AppError('Datele de actualizare sunt invalide.', 400, 'INVALID_UPDATE_DATA'));
    }

    // Construim obiectul de actualizat doar cu câmpurile permise
    const allowedFields = ['name', 'category', 'unit', 'minThreshold', 'supplierId'];
    const setFields = {};
    let hasValidFields = false;

    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        // Validăm fiecare câmp
        switch (field) {
          case 'name':
            if (!isValidName(updateData[field])) {
              return reject(new AppError(
                'Denumirea itemului trebuie să fie un șir de caractere între 1 și 200.',
                400,
                'INVALID_NAME'
              ));
            }
            setFields.name = updateData[field].trim();
            break;
          case 'category':
            if (!isValidCategory(updateData[field])) {
              return reject(new AppError(
                `Categoria "${updateData[field]}" nu este validă.`,
                400,
                'INVALID_CATEGORY'
              ));
            }
            setFields.category = updateData[field];
            break;
          case 'unit':
            if (!isValidUnit(updateData[field])) {
              return reject(new AppError(
                `Unitatea de măsură "${updateData[field]}" nu este validă.`,
                400,
                'INVALID_UNIT'
              ));
            }
            setFields.unit = updateData[field];
            break;
          case 'minThreshold':
            if (!isValidThreshold(updateData[field])) {
              return reject(new AppError(
                'Pragul minim trebuie să fie un număr mai mare sau egal cu 0.',
                400,
                'INVALID_THRESHOLD'
              ));
            }
            setFields.minThreshold = updateData[field];
            break;
          case 'supplierId':
            setFields.supplierId = updateData[field];
            break;
        }
        hasValidFields = true;
      }
    }

    if (!hasValidFields) {
      return reject(new AppError(
        'Nu există câmpuri valide de actualizat.',
        400,
        'NO_VALID_FIELDS'
      ));
    }

    // Actualizăm și lastUpdated / updatedAt
    const now = new Date().toISOString();
    setFields.lastUpdated = now;
    setFields.updatedAt = now;

    inventoryItems.update(
      { _id: id },
      { $set: setFields },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedItem) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea itemului: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Itemul de inventar nu a fost găsit.', 404, 'ITEM_NOT_FOUND'));
        }

        resolve(updatedItem);
      }
    );
  });
}

/**
 * Șterge un item de inventar după ID.
 * @param {string} id - ID-ul itemului
 * @returns {Promise<boolean>} true dacă a fost șters
 */
function deleteInventoryItem(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
    }

    inventoryItems.remove({ _id: id }, {}, (removeErr, numRemoved) => {
      if (removeErr) {
        return reject(new AppError(
          `Eroare la ștergerea itemului: ${removeErr.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      if (numRemoved === 0) {
        return reject(new AppError('Itemul de inventar nu a fost găsit.', 404, 'ITEM_NOT_FOUND'));
      }

      resolve(true);
    });
  });
}

/**
 * Numără itemele de inventar dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.category] - Filtrare după categorie
 * @returns {Promise<number>}
 */
function countInventoryItems(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return resolve(0);
    }

    const query = { tenantId };

    if (options.category) {
      query.category = options.category;
    }

    inventoryItems.count(query, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea itemelor: ${err.message}`,
          500,
          'DB_COUNT_ERROR'
        ));
      }
      resolve(count || 0);
    });
  });
}

/**
 * Obține toate itemele care aparțin unui anumit furnizor.
 * @param {string} supplierId - ID-ul furnizorului
 * @returns {Promise<Array>} Lista de iteme
 */
function findInventoryItemsBySupplier(supplierId) {
  return new Promise((resolve, reject) => {
    if (!supplierId) {
      return reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
    }

    inventoryItems.find({ supplierId }, (err, items) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea itemelor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(items || []);
    });
  });
}

/**
 * Obține un sumar al inventarului pe categorii pentru un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>} Lista de obiecte { category, count, totalQuantity }
 */
function getInventorySummary(tenantId) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    inventoryItems.find({ tenantId }, (err, items) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea itemelor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      const itemsList = items || [];

      // Grupare pe categorii
      const summary = {};

      for (const item of itemsList) {
        const cat = item.category || 'alte';
        if (!summary[cat]) {
          summary[cat] = { category: cat, count: 0, totalQuantity: 0 };
        }
        summary[cat].count += 1;
        summary[cat].totalQuantity += item.quantity;
      }

      resolve(Object.values(summary));
    });
  });
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Instanța bazei de date (compatibilitate: re-export din config/db.js)
  inventoryItems,

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
};