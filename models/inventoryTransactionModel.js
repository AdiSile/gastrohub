'use strict';

// ---------------------------------------------------------------------------
// Model InventoryTransaction – GastroHub
// Model NeDB pentru tranzacții de inventar (intrări, ieșiri, pierderi).
// Câmpuri: itemId, type (intrare/ieșire/pierdere), quantity, unit, note,
//          reference, userId, locationId, locationType, tenantId, createdAt
// ---------------------------------------------------------------------------

const Datastore = require('nedb');
const path = require('path');
const fs = require('fs');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Configurare colecție separată pentru inventoryTransactions
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
 * Colecţia de tranzacții de inventar.
 * Fişierul pe disc: <dataDir>/inventoryTransactions.db
 * În mediu de test se folosește baza în-memory.
 */
const inventoryTransactions = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'inventoryTransactions.db'),
  autoload: true,
  timestampData: false,
});

// ---------------------------------------------------------------------------
// Indexuri
// ---------------------------------------------------------------------------

/**
 * Index pentru căutarea rapidă a tranzacțiilor după itemId.
 */
inventoryTransactions.ensureIndex({ fieldName: 'itemId' }, (err) => {
  if (err) {
    console.error('[inventoryTransactionModel] Eroare la crearea indexului pe itemId:', err.message);
  }
});

/**
 * Index pentru căutarea tranzacțiilor după type.
 */
inventoryTransactions.ensureIndex({ fieldName: 'type' }, (err) => {
  if (err) {
    console.error('[inventoryTransactionModel] Eroare la crearea indexului pe type:', err.message);
  }
});

/**
 * Index pentru căutarea tranzacțiilor după tenantId.
 */
inventoryTransactions.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[inventoryTransactionModel] Eroare la crearea indexului pe tenantId:', err.message);
  }
});

/**
 * Index pentru căutarea tranzacțiilor după userId.
 */
inventoryTransactions.ensureIndex({ fieldName: 'userId' }, (err) => {
  if (err) {
    console.error('[inventoryTransactionModel] Eroare la crearea indexului pe userId:', err.message);
  }
});

/**
 * Index pentru căutarea tranzacțiilor după locationId.
 */
inventoryTransactions.ensureIndex({ fieldName: 'locationId' }, (err) => {
  if (err) {
    console.error('[inventoryTransactionModel] Eroare la crearea indexului pe locationId:', err.message);
  }
});

/**
 * Index pentru căutarea tranzacțiilor după createdAt (pentru rapoarte cronologice).
 */
inventoryTransactions.ensureIndex({ fieldName: 'createdAt' }, (err) => {
  if (err) {
    console.error('[inventoryTransactionModel] Eroare la crearea indexului pe createdAt:', err.message);
  }
});

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
 * @param {string} transactionData.userId - ID-ul utilizatorului care a efectuat tranzacția
 * @param {string} transactionData.locationId - ID-ul locației
 * @param {string} transactionData.locationType - Tipul locației ('restaurant' sau 'hotel')
 * @param {string} transactionData.tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Documentul tranzacției create
 * @throws {AppError} Dacă validarea eșuează
 */
function createInventoryTransaction(transactionData) {
  return new Promise((resolve, reject) => {
    // -----------------------------------------------------------------------
    // Validare câmpuri obligatorii
    // -----------------------------------------------------------------------
    if (!transactionData || typeof transactionData !== 'object') {
      return reject(new AppError('Datele tranzacției de inventar sunt invalide.', 400, 'INVALID_TRANSACTION_DATA'));
    }

    const {
      itemId,
      type,
      quantity,
      unit,
      note,
      reference,
      userId,
      locationId,
      locationType,
      tenantId,
    } = transactionData;

    // Validare itemId
    if (!itemId || !isValidId(itemId)) {
      return reject(new AppError(
        'ID-ul itemului de inventar este obligatoriu și trebuie să fie un șir nevid.',
        400,
        'INVALID_ITEM_ID'
      ));
    }

    // Validare type
    if (!type || !isValidTransactionType(type)) {
      return reject(new AppError(
        `Tipul tranzacției "${type}" nu este valid. Tipuri acceptate: ${VALID_TRANSACTION_TYPES.join(', ')}.`,
        400,
        'INVALID_TRANSACTION_TYPE'
      ));
    }

    // Validare quantity
    if (quantity === undefined || quantity === null || !isValidQuantity(quantity)) {
      return reject(new AppError(
        'Cantitatea trebuie să fie un număr mai mare decât 0.',
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

    // Validare userId
    if (!userId || !isValidId(userId)) {
      return reject(new AppError(
        'ID-ul utilizatorului este obligatoriu și trebuie să fie un șir nevid.',
        400,
        'INVALID_USER_ID'
      ));
    }

    // Validare locationId
    if (!locationId || !isValidId(locationId)) {
      return reject(new AppError(
        'ID-ul locației este obligatoriu și trebuie să fie un șir nevid.',
        400,
        'INVALID_LOCATION_ID'
      ));
    }

    // Validare locationType
    if (!locationType || !isValidLocationType(locationType)) {
      return reject(new AppError(
        'Tipul locației trebuie să fie "restaurant" sau "hotel".',
        400,
        'INVALID_LOCATION_TYPE'
      ));
    }

    // Validare tenantId
    if (!tenantId || !isValidId(tenantId)) {
      return reject(new AppError(
        'ID-ul tenant-ului este obligatoriu și trebuie să fie un șir nevid.',
        400,
        'INVALID_TENANT_ID'
      ));
    }

    // -----------------------------------------------------------------------
    // Creare document
    // -----------------------------------------------------------------------
    const now = new Date().toISOString();

    const transactionDoc = {
      itemId: itemId.trim(),
      type,
      quantity,
      unit,
      note: note !== undefined ? String(note).trim() : '',
      reference: reference !== undefined ? String(reference).trim() : '',
      userId: userId.trim(),
      locationId: locationId.trim(),
      locationType,
      tenantId: tenantId.trim(),
      createdAt: now,
    };

    inventoryTransactions.insert(transactionDoc, (insertErr, newTransaction) => {
      if (insertErr) {
        return reject(new AppError(
          `Eroare la crearea tranzacției de inventar: ${insertErr.message}`,
          500,
          'DB_INSERT_ERROR'
        ));
      }

      resolve(newTransaction);
    });
  });
}

/**
 * Găsește o tranzacție de inventar după ID.
 * @param {string} id - ID-ul NeDB
 * @returns {Promise<Object|null>} Documentul tranzacției sau null
 */
function findInventoryTransactionById(id) {
  return new Promise((resolve, reject) => {
    if (!id || !isValidId(id)) {
      return reject(new AppError('ID-ul tranzacției de inventar este invalid.', 400, 'INVALID_TRANSACTION_ID'));
    }

    inventoryTransactions.findOne({ _id: id }, (err, transaction) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea tranzacției: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(transaction || null);
    });
  });
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
function findTransactionsByItem(itemId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!itemId || !isValidId(itemId)) {
      return reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
    }

    const query = { itemId: itemId.trim() };

    if (options.type && isValidTransactionType(options.type)) {
      query.type = options.type;
    }

    inventoryTransactions.find(query)
      .sort({ [options.sortBy || 'createdAt']: options.sortOrder === 'asc' ? 1 : -1 })
      .exec((err, transactions) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea tranzacțiilor: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        resolve(transactions || []);
      });
  });
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
function findTransactionsByTenant(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId || !isValidId(tenantId)) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const query = { tenantId: tenantId.trim() };

    if (options.type && isValidTransactionType(options.type)) {
      query.type = options.type;
    }

    if (options.itemId && isValidId(options.itemId)) {
      query.itemId = options.itemId.trim();
    }

    if (options.userId && isValidId(options.userId)) {
      query.userId = options.userId.trim();
    }

    if (options.locationId && isValidId(options.locationId)) {
      query.locationId = options.locationId.trim();
    }

    if (options.locationType && isValidLocationType(options.locationType)) {
      query.locationType = options.locationType;
    }

    // Filtrare pe interval de date
    if (options.startDate || options.endDate) {
      query.createdAt = {};
      if (options.startDate) {
        query.createdAt.$gte = options.startDate;
      }
      if (options.endDate) {
        query.createdAt.$lte = options.endDate;
      }
    }

    let queryBuilder = inventoryTransactions.find(query)
      .sort({ [options.sortBy || 'createdAt']: options.sortOrder === 'asc' ? 1 : -1 });

    if (typeof options.skip === 'number' && options.skip >= 0) {
      queryBuilder = queryBuilder.skip(options.skip);
    }

    if (typeof options.limit === 'number' && options.limit > 0) {
      queryBuilder = queryBuilder.limit(options.limit);
    }

    queryBuilder.exec((err, transactions) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea tranzacțiilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(transactions || []);
    });
  });
}

/**
 * Găsește tranzacții de inventar după utilizator.
 * @param {string} userId - ID-ul utilizatorului
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.type] - Filtrare după tip
 * @param {number} [options.limit] - Număr maxim de rezultate
 * @returns {Promise<Array>} Lista de tranzacții
 */
function findTransactionsByUser(userId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!userId || !isValidId(userId)) {
      return reject(new AppError('ID-ul utilizatorului este invalid.', 400, 'INVALID_USER_ID'));
    }

    const query = { userId: userId.trim() };

    if (options.type && isValidTransactionType(options.type)) {
      query.type = options.type;
    }

    let queryBuilder = inventoryTransactions.find(query)
      .sort({ createdAt: -1 });

    if (typeof options.limit === 'number' && options.limit > 0) {
      queryBuilder = queryBuilder.limit(options.limit);
    }

    queryBuilder.exec((err, transactions) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea tranzacțiilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(transactions || []);
    });
  });
}

/**
 * Găsește tranzacții de inventar după referință.
 * @param {string} reference - Referința căutată (ex. număr factură, comandă)
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.tenantId] - Filtrare după tenant
 * @param {number} [options.limit] - Număr maxim de rezultate
 * @returns {Promise<Array>} Lista de tranzacții
 */
function findTransactionsByReference(reference, options = {}) {
  return new Promise((resolve, reject) => {
    if (!reference || !isValidId(reference)) {
      return reject(new AppError('Referința tranzacției este invalidă.', 400, 'INVALID_REFERENCE'));
    }

    const query = { reference: reference.trim() };

    if (options.tenantId && isValidId(options.tenantId)) {
      query.tenantId = options.tenantId.trim();
    }

    let queryBuilder = inventoryTransactions.find(query)
      .sort({ createdAt: -1 });

    if (typeof options.limit === 'number' && options.limit > 0) {
      queryBuilder = queryBuilder.limit(options.limit);
    }

    queryBuilder.exec((err, transactions) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea tranzacțiilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(transactions || []);
    });
  });
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
function findTransactionsByLocation(locationId, locationType, options = {}) {
  return new Promise((resolve, reject) => {
    if (!locationId || !isValidId(locationId)) {
      return reject(new AppError('ID-ul locației este invalid.', 400, 'INVALID_LOCATION_ID'));
    }

    if (!locationType || !isValidLocationType(locationType)) {
      return reject(new AppError(
        'Tipul locației trebuie să fie "restaurant" sau "hotel".',
        400,
        'INVALID_LOCATION_TYPE'
      ));
    }

    const query = {
      locationId: locationId.trim(),
      locationType,
    };

    if (options.type && isValidTransactionType(options.type)) {
      query.type = options.type;
    }

    // Filtrare pe interval de date
    if (options.startDate || options.endDate) {
      query.createdAt = {};
      if (options.startDate) {
        query.createdAt.$gte = options.startDate;
      }
      if (options.endDate) {
        query.createdAt.$lte = options.endDate;
      }
    }

    let queryBuilder = inventoryTransactions.find(query)
      .sort({ createdAt: -1 });

    if (typeof options.limit === 'number' && options.limit > 0) {
      queryBuilder = queryBuilder.limit(options.limit);
    }

    queryBuilder.exec((err, transactions) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea tranzacțiilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(transactions || []);
    });
  });
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
function findTransactionsByType(type, options = {}) {
  return new Promise((resolve, reject) => {
    if (!type || !isValidTransactionType(type)) {
      return reject(new AppError(
        `Tipul tranzacției "${type}" nu este valid. Tipuri acceptate: ${VALID_TRANSACTION_TYPES.join(', ')}.`,
        400,
        'INVALID_TRANSACTION_TYPE'
      ));
    }

    const query = { type };

    if (options.tenantId && isValidId(options.tenantId)) {
      query.tenantId = options.tenantId.trim();
    }

    if (options.locationId && isValidId(options.locationId)) {
      query.locationId = options.locationId.trim();
    }

    let queryBuilder = inventoryTransactions.find(query)
      .sort({ createdAt: -1 });

    if (typeof options.limit === 'number' && options.limit > 0) {
      queryBuilder = queryBuilder.limit(options.limit);
    }

    queryBuilder.exec((err, transactions) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea tranzacțiilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(transactions || []);
    });
  });
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
function countTransactions(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId || !isValidId(tenantId)) {
      return resolve(0);
    }

    const query = { tenantId: tenantId.trim() };

    if (options.type && isValidTransactionType(options.type)) {
      query.type = options.type;
    }

    if (options.itemId && isValidId(options.itemId)) {
      query.itemId = options.itemId.trim();
    }

    if (options.userId && isValidId(options.userId)) {
      query.userId = options.userId.trim();
    }

    if (options.startDate || options.endDate) {
      query.createdAt = {};
      if (options.startDate) {
        query.createdAt.$gte = options.startDate;
      }
      if (options.endDate) {
        query.createdAt.$lte = options.endDate;
      }
    }

    inventoryTransactions.count(query, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea tranzacțiilor: ${err.message}`,
          500,
          'DB_COUNT_ERROR'
        ));
      }
      resolve(count || 0);
    });
  });
}

/**
 * Obține un sumar al tranzacțiilor pe tipuri pentru un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.startDate] - Dată de început
 * @param {string} [options.endDate] - Dată de sfârșit
 * @returns {Promise<Array>} Lista de obiecte { type, count, totalQuantity }
 */
function getTransactionSummary(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId || !isValidId(tenantId)) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const query = { tenantId: tenantId.trim() };

    if (options.startDate || options.endDate) {
      query.createdAt = {};
      if (options.startDate) {
        query.createdAt.$gte = options.startDate;
      }
      if (options.endDate) {
        query.createdAt.$lte = options.endDate;
      }
    }

    inventoryTransactions.find(query, (err, transactions) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea tranzacțiilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      const transactionsList = transactions || [];

      // Grupare pe tipuri
      const summary = {};

      for (const t of transactionsList) {
        const type = t.type || 'necunoscut';
        if (!summary[type]) {
          summary[type] = { type, count: 0, totalQuantity: 0 };
        }
        summary[type].count += 1;
        summary[type].totalQuantity += t.quantity;
      }

      resolve(Object.values(summary));
    });
  });
}

/**
 * Obține istoricul complet al tranzacțiilor pentru un item, cu paginare.
 * @param {string} itemId - ID-ul itemului de inventar
 * @param {Object} [options] - Opțiuni de paginare
 * @param {number} [options.page=1] - Numărul paginii
 * @param {number} [options.limit=50] - Rezultate pe pagină
 * @returns {Promise<Object>} { transactions, total, page, limit, totalPages }
 */
function getItemTransactionHistory(itemId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!itemId || !isValidId(itemId)) {
      return reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
    }

    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const query = { itemId: itemId.trim() };

    // Obținem numărul total
    inventoryTransactions.count(query, (countErr, total) => {
      if (countErr) {
        return reject(new AppError(
          `Eroare la numărarea tranzacțiilor: ${countErr.message}`,
          500,
          'DB_COUNT_ERROR'
        ));
      }

      // Obținem tranzacțiile pentru pagina curentă
      inventoryTransactions.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec((findErr, transactions) => {
          if (findErr) {
            return reject(new AppError(
              `Eroare la căutarea tranzacțiilor: ${findErr.message}`,
              500,
              'DB_QUERY_ERROR'
            ));
          }

          resolve({
            transactions: transactions || [],
            total: total || 0,
            page,
            limit,
            totalPages: Math.ceil((total || 0) / limit),
          });
        });
    });
  });
}

/**
 * Șterge o tranzacție de inventar după ID.
 * @param {string} id - ID-ul tranzacției
 * @returns {Promise<boolean>} true dacă a fost ștearsă
 */
function deleteInventoryTransaction(id) {
  return new Promise((resolve, reject) => {
    if (!id || !isValidId(id)) {
      return reject(new AppError('ID-ul tranzacției de inventar este invalid.', 400, 'INVALID_TRANSACTION_ID'));
    }

    inventoryTransactions.remove({ _id: id }, {}, (removeErr, numRemoved) => {
      if (removeErr) {
        return reject(new AppError(
          `Eroare la ștergerea tranzacției: ${removeErr.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      if (numRemoved === 0) {
        return reject(new AppError('Tranzacția de inventar nu a fost găsită.', 404, 'TRANSACTION_NOT_FOUND'));
      }

      resolve(true);
    });
  });
}

/**
 * Șterge toate tranzacțiile pentru un item de inventar.
 * @param {string} itemId - ID-ul itemului
 * @returns {Promise<number>} Numărul de tranzacții șterse
 */
function deleteTransactionsByItem(itemId) {
  return new Promise((resolve, reject) => {
    if (!itemId || !isValidId(itemId)) {
      return reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
    }

    inventoryTransactions.remove({ itemId: itemId.trim() }, { multi: true }, (removeErr, numRemoved) => {
      if (removeErr) {
        return reject(new AppError(
          `Eroare la ștergerea tranzacțiilor: ${removeErr.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      resolve(numRemoved || 0);
    });
  });
}

/**
 * Calculează cantitatea totală consumată dintr-un item (ieșiri + pierderi).
 * @param {string} itemId - ID-ul itemului de inventar
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.startDate] - Dată de început
 * @param {string} [options.endDate] - Dată de sfârșit
 * @returns {Promise<Object>} { totalOut, totalLoss, netConsumption }
 */
function getItemConsumption(itemId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!itemId || !isValidId(itemId)) {
      return reject(new AppError('ID-ul itemului de inventar este invalid.', 400, 'INVALID_ITEM_ID'));
    }

    const query = { itemId: itemId.trim() };

    if (options.startDate || options.endDate) {
      query.createdAt = {};
      if (options.startDate) {
        query.createdAt.$gte = options.startDate;
      }
      if (options.endDate) {
        query.createdAt.$lte = options.endDate;
      }
    }

    inventoryTransactions.find(query, (err, transactions) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea tranzacțiilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      const transactionsList = transactions || [];
      let totalOut = 0;
      let totalLoss = 0;

      for (const t of transactionsList) {
        if (t.type === 'ieșire') {
          totalOut += t.quantity;
        } else if (t.type === 'pierdere') {
          totalLoss += t.quantity;
        }
      }

      resolve({
        totalOut,
        totalLoss,
        netConsumption: totalOut + totalLoss,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Instanța bazei de date (pentru acces direct în caz de nevoie)
  inventoryTransactions,

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