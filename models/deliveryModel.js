'use strict';

// ---------------------------------------------------------------------------
// Model Delivery – GastroHub
// Model NeDB pentru livrări simulate de la furnizori.
// Câmpuri suportate: supplierId, items (array de {itemId, itemName, quantity,
// unit, price}), status (comandată, în tranzit, livrată, anulată), orderDate,
// estimatedDelivery, actualDelivery, notes, locationId, locationType, tenantId
// ---------------------------------------------------------------------------

const Datastore = require('nedb');
const path = require('path');
const fs = require('fs');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Configurare colecție separată pentru deliveries
// ---------------------------------------------------------------------------

/**
 * Determină calea absolută către directorul de date.
 * Citeşte variabila de mediu `DB_PATH` sau implicit `./data/`.
 */
function resolveDataPath() {
  const rel = process.env.DB_PATH || './data';
  return path.resolve(rel);
}

/**
 * Asigură existenţa directorului de date (creare recursivă dacă nu există).
 */
function ensureDataDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function isTestEnv() {
  return process.env.NODE_ENV === 'test';
}

const dataDir = resolveDataPath();
ensureDataDir(dataDir);

/**
 * Colecţia de livrări.
 * Fişierul pe disc: <dataDir>/deliveries.db
 * În mediu de test se folosește baza în-memory.
 */
const deliveries = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'deliveries.db'),
  autoload: true,
  timestampData: false,
});

// ---------------------------------------------------------------------------
// Indexuri
// ---------------------------------------------------------------------------

/**
 * Index pentru căutarea rapidă a livrărilor după tenantId.
 */
deliveries.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[deliveryModel] Eroare la crearea indexului pe tenantId:', err.message);
  }
});

/**
 * Index pentru căutarea livrărilor după status.
 */
deliveries.ensureIndex({ fieldName: 'status' }, (err) => {
  if (err) {
    console.error('[deliveryModel] Eroare la crearea indexului pe status:', err.message);
  }
});

/**
 * Index pentru căutarea livrărilor după supplierId.
 */
deliveries.ensureIndex({ fieldName: 'supplierId' }, (err) => {
  if (err) {
    console.error('[deliveryModel] Eroare la crearea indexului pe supplierId:', err.message);
  }
});

/**
 * Index pentru căutarea livrărilor după locationId.
 */
deliveries.ensureIndex({ fieldName: 'locationId' }, (err) => {
  if (err) {
    console.error('[deliveryModel] Eroare la crearea indexului pe locationId:', err.message);
  }
});

/**
 * Index pentru căutarea livrărilor după locationType.
 */
deliveries.ensureIndex({ fieldName: 'locationType' }, (err) => {
  if (err) {
    console.error('[deliveryModel] Eroare la crearea indexului pe locationType:', err.message);
  }
});

/**
 * Index pentru căutarea livrărilor după orderDate.
 */
deliveries.ensureIndex({ fieldName: 'orderDate' }, (err) => {
  if (err) {
    console.error('[deliveryModel] Eroare la crearea indexului pe orderDate:', err.message);
  }
});

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

// ---------------------------------------------------------------------------
// Operații CRUD – Deliveries
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
function createDelivery(deliveryData) {
  return new Promise((resolve, reject) => {
    // -----------------------------------------------------------------------
    // Validare date de bază
    // -----------------------------------------------------------------------
    if (!deliveryData || typeof deliveryData !== 'object') {
      return reject(new AppError('Datele livrării sunt invalide.', 400, 'INVALID_DELIVERY_DATA'));
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
      return reject(new AppError(
        'ID-ul furnizorului este obligatoriu.',
        400,
        'MISSING_SUPPLIER_ID'
      ));
    }

    // Validare tenantId
    if (!tenantId) {
      return reject(new AppError(
        'ID-ul tenant-ului este obligatoriu.',
        400,
        'MISSING_TENANT_ID'
      ));
    }

    // Validare locationId
    if (!locationId) {
      return reject(new AppError(
        'ID-ul locației este obligatoriu.',
        400,
        'MISSING_LOCATION_ID'
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

    // Validare items
    const itemsValidation = validateItems(items);
    if (!itemsValidation.valid) {
      return reject(new AppError(
        itemsValidation.errors.join(' '),
        400,
        'INVALID_DELIVERY_ITEMS'
      ));
    }

    // Validare status (opțional)
    const finalStatus = status || 'comandată';
    if (!isValidDeliveryStatus(finalStatus)) {
      return reject(new AppError(
        `Statusul "${finalStatus}" nu este valid. Statusuri permise: ${VALID_DELIVERY_STATUSES.join(', ')}.`,
        400,
        'INVALID_DELIVERY_STATUS'
      ));
    }

    // Validare orderDate (opțional, default acum)
    const finalOrderDate = orderDate || new Date().toISOString();
    if (!isValidISODate(finalOrderDate)) {
      return reject(new AppError(
        'Data comenzii (orderDate) nu este o dată validă.',
        400,
        'INVALID_ORDER_DATE'
      ));
    }

    // Validare estimatedDelivery (opțional)
    const finalEstimatedDelivery = estimatedDelivery || null;
    if (finalEstimatedDelivery && !isValidISODate(finalEstimatedDelivery)) {
      return reject(new AppError(
        'Data estimată de livrare (estimatedDelivery) nu este o dată validă.',
        400,
        'INVALID_ESTIMATED_DELIVERY'
      ));
    }

    // Validare actualDelivery (opțional)
    const finalActualDelivery = actualDelivery || null;
    if (finalActualDelivery && !isValidISODate(finalActualDelivery)) {
      return reject(new AppError(
        'Data efectivă de livrare (actualDelivery) nu este o dată validă.',
        400,
        'INVALID_ACTUAL_DELIVERY'
      ));
    }

    // Validare notes (opțional)
    const finalNotes = notes !== undefined && notes !== null ? String(notes).trim() : '';
    if (finalNotes.length > 2000) {
      return reject(new AppError(
        'Notele pot avea maximum 2000 de caractere.',
        400,
        'INVALID_NOTES'
      ));
    }

    // -----------------------------------------------------------------------
    // Calcul valoare totală
    // -----------------------------------------------------------------------
    const totalValue = calculateTotalValue(items);

    // -----------------------------------------------------------------------
    // Curățare itemi
    // -----------------------------------------------------------------------
    const cleanedItems = items.map((item) => ({
      itemId: item.itemId.trim(),
      itemName: item.itemName.trim(),
      quantity: item.quantity,
      unit: item.unit,
      price: item.price,
    }));

    // -----------------------------------------------------------------------
    // Creare document livrare
    // -----------------------------------------------------------------------
    const now = new Date().toISOString();

    const deliveryDoc = {
      supplierId,
      items: cleanedItems,
      status: finalStatus,
      totalValue,
      orderDate: finalOrderDate,
      estimatedDelivery: finalEstimatedDelivery,
      actualDelivery: finalActualDelivery,
      notes: finalNotes,
      locationId,
      locationType,
      tenantId,
      createdAt: now,
      updatedAt: now,
    };

    deliveries.insert(deliveryDoc, (insertErr, newDelivery) => {
      if (insertErr) {
        return reject(new AppError(
          `Eroare la crearea livrării: ${insertErr.message}`,
          500,
          'DB_INSERT_ERROR'
        ));
      }

      resolve(newDelivery);
    });
  });
}

/**
 * Găsește o livrare după ID.
 * @param {string} id - ID-ul NeDB
 * @returns {Promise<Object|null>} Documentul livrării sau null
 */
function findDeliveryById(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul livrării este invalid.', 400, 'INVALID_DELIVERY_ID'));
    }

    deliveries.findOne({ _id: id }, (err, delivery) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea livrării: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(delivery || null);
    });
  });
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
function findDeliveriesByTenant(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const filter = { tenantId };

    if (options.status) {
      if (!isValidDeliveryStatus(options.status)) {
        return reject(new AppError(
          `Statusul "${options.status}" nu este valid. Statusuri permise: ${VALID_DELIVERY_STATUSES.join(', ')}.`,
          400,
          'INVALID_DELIVERY_STATUS'
        ));
      }
      filter.status = options.status;
    }

    if (options.supplierId) {
      filter.supplierId = options.supplierId;
    }

    if (options.locationId) {
      filter.locationId = options.locationId;
    }

    if (options.locationType) {
      if (!isValidLocationType(options.locationType)) {
        return reject(new AppError(
          `Tipul locației trebuie să fie "restaurant" sau "hotel".`,
          400,
          'INVALID_LOCATION_TYPE'
        ));
      }
      filter.locationType = options.locationType;
    }

    const sortField = options.sortBy || 'orderDate';
    const sortDir = options.sortOrder === 'asc' ? 1 : -1;

    let query = deliveries.find(filter).sort({ [sortField]: sortDir });

    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      query = query.limit(options.limit);
    }

    if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
      query = query.skip(options.skip);
    }

    query.exec((err, deliveryList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea livrărilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(deliveryList || []);
    });
  });
}

/**
 * Găsește livrări după status.
 * @param {string} status - Statusul livrării
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de livrări
 */
function findDeliveriesByStatus(status, tenantId) {
  return new Promise((resolve, reject) => {
    if (!status || !isValidDeliveryStatus(status)) {
      return reject(new AppError(
        `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_DELIVERY_STATUSES.join(', ')}.`,
        400,
        'INVALID_DELIVERY_STATUS'
      ));
    }

    const filter = { status };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    deliveries.find(filter)
      .sort({ orderDate: -1 })
      .exec((err, deliveryList) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea livrărilor după status: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        resolve(deliveryList || []);
      });
  });
}

/**
 * Găsește livrări după furnizor.
 * @param {string} supplierId - ID-ul furnizorului
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de livrări
 */
function findDeliveriesBySupplier(supplierId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!supplierId) {
      return reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
    }

    const filter = { supplierId };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    deliveries.find(filter)
      .sort({ orderDate: -1 })
      .exec((err, deliveryList) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea livrărilor după furnizor: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        resolve(deliveryList || []);
      });
  });
}

/**
 * Găsește livrări după locație.
 * @param {string} locationId - ID-ul locației
 * @param {string} locationType - Tipul locației
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de livrări
 */
function findDeliveriesByLocation(locationId, locationType, tenantId) {
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

    const filter = { locationId, locationType };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    deliveries.find(filter)
      .sort({ orderDate: -1 })
      .exec((err, deliveryList) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea livrărilor după locație: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        resolve(deliveryList || []);
      });
  });
}

/**
 * Găsește livrări într-un interval de date.
 * @param {string} startDate - Data de început (ISO string)
 * @param {string} endDate - Data de sfârșit (ISO string)
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de livrări
 */
function findDeliveriesByDateRange(startDate, endDate, tenantId) {
  return new Promise((resolve, reject) => {
    if (!startDate || !isValidISODate(startDate)) {
      return reject(new AppError('Data de început este invalidă.', 400, 'INVALID_START_DATE'));
    }

    if (!endDate || !isValidISODate(endDate)) {
      return reject(new AppError('Data de sfârșit este invalidă.', 400, 'INVALID_END_DATE'));
    }

    const filter = {
      orderDate: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    deliveries.find(filter)
      .sort({ orderDate: -1 })
      .exec((err, deliveryList) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea livrărilor în interval: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        resolve(deliveryList || []);
      });
  });
}

/**
 * Actualizează o livrare.
 * @param {string} id - ID-ul livrării
 * @param {Object} updateData - Câmpurile de actualizat
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateDelivery(id, updateData) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul livrării este invalid.', 400, 'INVALID_DELIVERY_ID'));
    }

    if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
      return reject(new AppError(
        'Nu s-au furnizat date pentru actualizare.',
        400,
        'EMPTY_UPDATE_DATA'
      ));
    }

    // -----------------------------------------------------------------------
    // Câmpuri permise pentru actualizare
    // -----------------------------------------------------------------------
    const allowedFields = [
      'supplierId', 'items', 'status', 'orderDate',
      'estimatedDelivery', 'actualDelivery', 'notes',
      'locationId', 'locationType',
    ];
    const setFields = {};
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
            setFields.supplierId = value.trim();
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
              const cleanedItems = value.map((item) => ({
                itemId: item.itemId.trim(),
                itemName: item.itemName.trim(),
                quantity: item.quantity,
                unit: item.unit,
                price: item.price,
              }));
              setFields.items = cleanedItems;
              // Recalculăm valoarea totală
              setFields.totalValue = calculateTotalValue(cleanedItems);
            }
          }
          break;

        case 'status':
          if (!isValidDeliveryStatus(value)) {
            errors.push(`Statusul "${value}" nu este valid. Statusuri permise: ${VALID_DELIVERY_STATUSES.join(', ')}.`);
          } else {
            setFields.status = value;
          }
          break;

        case 'orderDate':
          if (value && !isValidISODate(value)) {
            errors.push('Data comenzii (orderDate) nu este o dată validă.');
          } else {
            setFields.orderDate = value || new Date().toISOString();
          }
          break;

        case 'estimatedDelivery':
          if (value && !isValidISODate(value)) {
            errors.push('Data estimată de livrare (estimatedDelivery) nu este o dată validă.');
          } else {
            setFields.estimatedDelivery = value || null;
          }
          break;

        case 'actualDelivery':
          if (value && !isValidISODate(value)) {
            errors.push('Data efectivă de livrare (actualDelivery) nu este o dată validă.');
          } else {
            setFields.actualDelivery = value || null;
          }
          break;

        case 'notes':
          if (value !== null && value !== undefined && String(value).length > 2000) {
            errors.push('Notele pot avea maximum 2000 de caractere.');
          } else {
            setFields.notes = value !== null && value !== undefined ? String(value).trim() : '';
          }
          break;

        case 'locationId':
          if (!value || typeof value !== 'string' || value.trim().length === 0) {
            errors.push('ID-ul locației este obligatoriu.');
          } else {
            setFields.locationId = value.trim();
          }
          break;

        case 'locationType':
          if (!value || !isValidLocationType(value)) {
            errors.push(`Tipul locației trebuie să fie "restaurant" sau "hotel".`);
          } else {
            setFields.locationType = value;
          }
          break;

        // No default – allowedFields garantează că ajungem doar aici
      }
    }

    if (errors.length > 0) {
      return reject(new AppError(errors.join(' '), 400, 'VALIDATION_ERROR'));
    }

    if (Object.keys(setFields).length === 0) {
      return reject(new AppError(
        'Nu s-au furnizat câmpuri valide pentru actualizare.',
        400,
        'NO_VALID_FIELDS'
      ));
    }

    // -----------------------------------------------------------------------
    // Actualizare document
    // -----------------------------------------------------------------------
    setFields.updatedAt = new Date().toISOString();

    deliveries.update(
      { _id: id },
      { $set: setFields },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedDelivery) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea livrării: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Livrarea nu a fost găsită.', 404, 'DELIVERY_NOT_FOUND'));
        }

        resolve(updatedDelivery);
      }
    );
  });
}

/**
 * Actualizează statusul unei livrări.
 * @param {string} id - ID-ul livrării
 * @param {string} status - Noul status
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateDeliveryStatus(id, status) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul livrării este invalid.', 400, 'INVALID_DELIVERY_ID'));
    }

    if (!status || !isValidDeliveryStatus(status)) {
      return reject(new AppError(
        `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_DELIVERY_STATUSES.join(', ')}.`,
        400,
        'INVALID_DELIVERY_STATUS'
      ));
    }

    const setFields = {
      status,
      updatedAt: new Date().toISOString(),
    };

    // Dacă statusul este 'livrată' și nu există actualDelivery, o setăm acum
    if (status === 'livrată') {
      setFields.actualDelivery = new Date().toISOString();
    }

    deliveries.update(
      { _id: id },
      { $set: setFields },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedDelivery) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea statusului livrării: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Livrarea nu a fost găsită.', 404, 'DELIVERY_NOT_FOUND'));
        }

        resolve(updatedDelivery);
      }
    );
  });
}

/**
 * Șterge o livrare după ID.
 * @param {string} id - ID-ul livrării
 * @returns {Promise<boolean>} true dacă a fost ștearsă
 */
function deleteDelivery(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul livrării este invalid.', 400, 'INVALID_DELIVERY_ID'));
    }

    deliveries.remove({ _id: id }, {}, (removeErr, numRemoved) => {
      if (removeErr) {
        return reject(new AppError(
          `Eroare la ștergerea livrării: ${removeErr.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      if (numRemoved === 0) {
        return reject(new AppError('Livrarea nu a fost găsită.', 404, 'DELIVERY_NOT_FOUND'));
      }

      resolve(true);
    });
  });
}

/**
 * Numără livrările dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni de filtrare
 * @param {string} [options.status] - Filtrare după status
 * @returns {Promise<number>}
 */
function countDeliveries(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return resolve(0);
    }

    const filter = { tenantId };

    if (options.status) {
      if (!isValidDeliveryStatus(options.status)) {
        return reject(new AppError(
          `Statusul "${options.status}" nu este valid. Statusuri permise: ${VALID_DELIVERY_STATUSES.join(', ')}.`,
          400,
          'INVALID_DELIVERY_STATUS'
        ));
      }
      filter.status = options.status;
    }

    deliveries.count(filter, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea livrărilor: ${err.message}`,
          500,
          'DB_COUNT_ERROR'
        ));
      }
      resolve(count || 0);
    });
  });
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

    const filter = { tenantId };

    if (options.status) {
      if (!isValidDeliveryStatus(options.status)) {
        return reject(new AppError(
          `Statusul "${options.status}" nu este valid. Statusuri permise: ${VALID_DELIVERY_STATUSES.join(', ')}.`,
          400,
          'INVALID_DELIVERY_STATUS'
        ));
      }
      filter.status = options.status;
    }

    deliveries.find(filter).exec((err, deliveryList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la obținerea valorii totale: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      const total = (deliveryList || []).reduce((sum, delivery) => {
        return sum + (delivery.totalValue || 0);
      }, 0);

      resolve(+total.toFixed(2));
    });
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

    deliveries.find({ tenantId }).exec((err, deliveryList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la obținerea statisticilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      const stats = {};
      for (const delivery of (deliveryList || [])) {
        const status = delivery.status || 'necunoscut';
        if (!stats[status]) {
          stats[status] = { count: 0, totalValue: 0 };
        }
        stats[status].count += 1;
        stats[status].totalValue += (delivery.totalValue || 0);
      }

      // Rotunjim valorile
      for (const key of Object.keys(stats)) {
        stats[key].totalValue = +stats[key].totalValue.toFixed(2);
      }

      resolve(stats);
    });
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

    deliveries.remove({ tenantId }, { multi: true }, (err, numRemoved) => {
      if (err) {
        return reject(new AppError(
          `Eroare la ștergerea livrărilor: ${err.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      resolve(numRemoved || 0);
    });
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