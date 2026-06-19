'use strict';

// ---------------------------------------------------------------------------
// Model Supplier – GastroHub
// Definirea structurii, validărilor și operațiilor CRUD pentru furnizori.
// Câmpuri suportate: name, contactPerson, phone, email, address, products,
// paymentTerms, rating, status, tenantId
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const Datastore = require('nedb');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Statusuri valide pentru un furnizor
// ---------------------------------------------------------------------------

const VALID_STATUSES = ['active', 'inactive', 'blacklisted'];

// ---------------------------------------------------------------------------
// Termeni de plată valizi
// ---------------------------------------------------------------------------

const VALID_PAYMENT_TERMS = [
  'pe loc',
  '7 zile',
  '14 zile',
  '30 zile',
  '45 zile',
  '60 zile',
  'la livrare',
  'avans 50%',
  'personalizat',
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
 * Verifică dacă un status de furnizor este valid.
 * @param {string} status
 * @returns {boolean}
 */
function isValidStatus(status) {
  return VALID_STATUSES.includes(status);
}

/**
 * Verifică dacă un termen de plată este valid.
 * @param {string} term
 * @returns {boolean}
 */
function isValidPaymentTerm(term) {
  return VALID_PAYMENT_TERMS.includes(term);
}

/**
 * Verifică dacă un șir este o adresă de email validă (format simplu).
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Verifică dacă un rating este valid (număr între 0 și 5).
 * @param {*} val
 * @returns {boolean}
 */
function isValidRating(val) {
  return typeof val === 'number' && Number.isFinite(val) && !Number.isNaN(val) && val >= 0 && val <= 5;
}

/**
 * Verifică dacă un array de produse conține doar string-uri valide.
 * @param {*} products
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateProducts(products) {
  if (!Array.isArray(products)) {
    return { valid: false, errors: ['Produsele trebuie să fie o listă.'] };
  }

  const errors = [];
  for (let i = 0; i < products.length; i++) {
    if (typeof products[i] !== 'string' || products[i].trim().length === 0) {
      errors.push(`Produsul #${i + 1} trebuie să fie un șir de caractere valid.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Configurare colecție NeDB pentru furnizori
// ---------------------------------------------------------------------------

/**
 * Asigură existența directorului pentru fișierele de date.
 * Dacă directorul nu există, îl creează recursiv.
 *
 * @param {string} dataDir - Calea absolută către directorul de date
 */
function ensureDataDir(dataDir) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('[supplierModel] Director creat:', dataDir);
  }
}

/**
 * Variabilă privată care reține instanța colecției NeDB pentru furnizori.
 * Este populată la primul apel al funcției getSuppliersDb().
 * @type {Datastore|null}
 */
let _suppliersDb = null;

/**
 * Variabilă privată care reține instanța colecției NeDB pentru comenzi furnizori.
 * Este populată la primul apel al funcției getSupplierOrdersDb().
 * @type {Datastore|null}
 */
let _supplierOrdersDb = null;

/**
 * Inițializează și returnează colecția NeDB pentru furnizori.
 *
 * Folosește un lazy singleton – colecția este creată la primul apel.
 * În regim de test (NODE_ENV === 'test') se folosește baza în-memory;
 * altfel fișierul este stocat în directorul configurat prin DB_PATH
 * (implicit ./data/).
 *
 * @returns {Datastore} Instanța NeDB pentru colecția suppliers
 */
function getSuppliersDb() {
  if (!_suppliersDb) {
    const isTest = process.env.NODE_ENV === 'test';
    const dataDir = path.resolve(process.env.DB_PATH || './data');

    // Asigură existența directorului de date (doar în afara testelor)
    if (!isTest) {
      ensureDataDir(dataDir);
    }

    _suppliersDb = new Datastore({
      filename: isTest ? undefined : path.join(dataDir, 'suppliers.db'),
      autoload: false,
      timestampData: false,
    });

    // Încărcare cu handler de eroare
    _suppliersDb.loadDatabase((loadErr) => {
      if (loadErr) {
        console.error('[supplierModel] Eroare la încărcarea bazei suppliers:', loadErr.message);
      }
    });

    // Indexuri
    _suppliersDb.ensureIndex({ fieldName: 'tenantId' }, (err) => {
      if (err) {
        console.error('[supplierModel] Eroare la crearea indexului pe tenantId:', err.message);
      }
    });

    _suppliersDb.ensureIndex({ fieldName: 'status' }, (err) => {
      if (err) {
        console.error('[supplierModel] Eroare la crearea indexului pe status:', err.message);
      }
    });

    _suppliersDb.ensureIndex({ fieldName: 'name' }, (err) => {
      if (err) {
        console.error('[supplierModel] Eroare la crearea indexului pe name:', err.message);
      }
    });

    _suppliersDb.ensureIndex({ fieldName: ['tenantId', 'status'] }, (err) => {
      if (err) {
        console.error('[supplierModel] Eroare la crearea indexului compus tenantId+status:', err.message);
      }
    });
  }

  return _suppliersDb;
}

/**
 * Inițializează și returnează colecția NeDB pentru comenzi furnizori.
 *
 * Folosește un lazy singleton – colecția este creată la primul apel.
 * În regim de test (NODE_ENV === 'test') se folosește baza în-memory;
 * altfel fișierul este stocat în directorul configurat prin DB_PATH
 * (implicit ./data/).
 *
 * @returns {Datastore} Instanța NeDB pentru colecția supplierOrders
 */
function getSupplierOrdersDb() {
  if (!_supplierOrdersDb) {
    const isTest = process.env.NODE_ENV === 'test';
    const dataDir = path.resolve(process.env.DB_PATH || './data');

    // Asigură existența directorului de date (doar în afara testelor)
    if (!isTest) {
      ensureDataDir(dataDir);
    }

    _supplierOrdersDb = new Datastore({
      filename: isTest ? undefined : path.join(dataDir, 'supplierOrders.db'),
      autoload: false,
      timestampData: false,
    });

    // Încărcare cu handler de eroare
    _supplierOrdersDb.loadDatabase((loadErr) => {
      if (loadErr) {
        console.error('[supplierModel] Eroare la încărcarea bazei supplierOrders:', loadErr.message);
      }
    });

    // Indexuri
    _supplierOrdersDb.ensureIndex({ fieldName: 'supplierId' }, (err) => {
      if (err) {
        console.error('[supplierModel] Eroare la crearea indexului pe supplierId:', err.message);
      }
    });

    _supplierOrdersDb.ensureIndex({ fieldName: 'tenantId' }, (err) => {
      if (err) {
        console.error('[supplierModel] Eroare la crearea indexului pe tenantId:', err.message);
      }
    });

    _supplierOrdersDb.ensureIndex({ fieldName: 'orderNumber' }, { unique: true }, (err) => {
      if (err) {
        console.error('[supplierModel] Eroare la crearea indexului unic pe orderNumber:', err.message);
      }
    });

    _supplierOrdersDb.ensureIndex({ fieldName: ['supplierId', 'status'] }, (err) => {
      if (err) {
        console.error('[supplierModel] Eroare la crearea indexului compus supplierId+status:', err.message);
      }
    });
  }

  return _supplierOrdersDb;
}

// ---------------------------------------------------------------------------
// Operații CRUD – Suppliers
// ---------------------------------------------------------------------------

/**
 * Creează un furnizor nou în baza de date.
 *
 * @param {Object} supplierData - Datele furnizorului
 * @param {string} supplierData.name - Numele furnizorului (obligatoriu)
 * @param {string} [supplierData.contactPerson=''] - Persoana de contact
 * @param {string} [supplierData.phone=''] - Număr de telefon
 * @param {string} [supplierData.email=''] - Email de contact
 * @param {string} [supplierData.address=''] - Adresa furnizorului
 * @param {string[]} [supplierData.products=[]] - Lista de produse furnizate
 * @param {string} [supplierData.paymentTerms='30 zile'] - Termeni de plată
 * @param {number} [supplierData.rating=null] - Rating (0-5)
 * @param {string} [supplierData.status='active'] - Statusul furnizorului
 * @param {string} supplierData.tenantId - ID-ul tenant-ului (obligatoriu)
 * @returns {Promise<Object>} Documentul furnizorului creat
 * @throws {AppError} Dacă validarea eșuează
 */
function createSupplier(supplierData) {
  return new Promise((resolve, reject) => {
    // -----------------------------------------------------------------------
    // Validare date de bază
    // -----------------------------------------------------------------------
    if (!supplierData || typeof supplierData !== 'object') {
      return reject(new AppError('Datele furnizorului sunt invalide.', 400, 'INVALID_SUPPLIER_DATA'));
    }

    const { name, contactPerson, phone, email, address, products, paymentTerms, rating, status, tenantId } = supplierData;

    // Validare nume
    if (!name || !isValidString(name, 1, 200)) {
      return reject(new AppError(
        'Numele furnizorului trebuie să aibă între 1 și 200 de caractere.',
        400,
        'INVALID_SUPPLIER_NAME'
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

    // Validare contactPerson (opțional)
    const finalContactPerson = contactPerson !== undefined && contactPerson !== null ? String(contactPerson).trim() : '';
    if (finalContactPerson && finalContactPerson.length > 200) {
      return reject(new AppError(
        'Persoana de contact poate avea maximum 200 de caractere.',
        400,
        'INVALID_CONTACT_PERSON'
      ));
    }

    // Validare phone (opțional)
    const finalPhone = phone !== undefined && phone !== null ? String(phone).trim() : '';
    if (finalPhone && finalPhone.length > 50) {
      return reject(new AppError(
        'Numărul de telefon poate avea maximum 50 de caractere.',
        400,
        'INVALID_PHONE'
      ));
    }

    // Validare email (opțional)
    const finalEmail = email !== undefined && email !== null ? email : '';
    if (finalEmail && !isValidEmail(finalEmail)) {
      return reject(new AppError(
        'Adresa de email a furnizorului este invalidă.',
        400,
        'INVALID_SUPPLIER_EMAIL'
      ));
    }

    // Validare address (opțional)
    const finalAddress = address !== undefined && address !== null ? String(address).trim() : '';
    if (finalAddress && finalAddress.length > 500) {
      return reject(new AppError(
        'Adresa furnizorului poate avea maximum 500 de caractere.',
        400,
        'INVALID_ADDRESS'
      ));
    }

    // Validare products (opțional)
    const finalProducts = Array.isArray(products) ? products.map((p) => String(p).trim()).filter((p) => p.length > 0) : [];
    if (products !== undefined && !Array.isArray(products)) {
      return reject(new AppError(
        'Produsele trebuie să fie o listă.',
        400,
        'INVALID_PRODUCTS'
      ));
    }

    // Validare paymentTerms (opțional)
    const finalPaymentTerms = paymentTerms || '30 zile';
    if (!isValidPaymentTerm(finalPaymentTerms)) {
      return reject(new AppError(
        `Termenul de plată "${finalPaymentTerms}" nu este valid. ` +
        `Termeni permisi: ${VALID_PAYMENT_TERMS.join(', ')}.`,
        400,
        'INVALID_PAYMENT_TERMS'
      ));
    }

    // Validare rating (opțional)
    const finalRating = rating !== undefined && rating !== null ? rating : null;
    if (finalRating !== null && !isValidRating(finalRating)) {
      return reject(new AppError(
        'Ratingul trebuie să fie un număr între 0 și 5.',
        400,
        'INVALID_RATING'
      ));
    }

    // Validare status (opțional)
    const finalStatus = status || 'active';
    if (!isValidStatus(finalStatus)) {
      return reject(new AppError(
        `Statusul "${finalStatus}" nu este valid. Statusuri permise: ${VALID_STATUSES.join(', ')}.`,
        400,
        'INVALID_STATUS'
      ));
    }

    // -----------------------------------------------------------------------
    // Creare document furnizor
    // -----------------------------------------------------------------------
    const supplierDoc = {
      name: name.trim(),
      contactPerson: finalContactPerson,
      phone: finalPhone,
      email: finalEmail ? finalEmail.toLowerCase().trim() : '',
      address: finalAddress,
      products: finalProducts,
      paymentTerms: finalPaymentTerms,
      rating: finalRating,
      status: finalStatus,
      tenantId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const suppliers = getSuppliersDb();
    suppliers.insert(supplierDoc, (insertErr, newSupplier) => {
      if (insertErr) {
        return reject(new AppError(
          `Eroare la crearea furnizorului: ${insertErr.message}`,
          500,
          'DB_INSERT_ERROR'
        ));
      }

      resolve(newSupplier);
    });
  });
}

/**
 * Găsește un furnizor după ID-ul său.
 * @param {string} id - ID-ul NeDB
 * @returns {Promise<Object|null>} Documentul furnizorului sau null
 */
function findSupplierById(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
    }

    const suppliers = getSuppliersDb();
    suppliers.findOne({ _id: id }, (err, supplier) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea furnizorului: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(supplier || null);
    });
  });
}

/**
 * Găsește toți furnizorii dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni de căutare (sort, limit, skip)
 * @returns {Promise<Array>} Lista de furnizori
 */
function findSuppliersByTenant(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const suppliers = getSuppliersDb();
    let query = suppliers.find({ tenantId });

    // Sortare
    if (options.sort) {
      query = query.sort(options.sort);
    } else {
      query = query.sort({ name: 1 });
    }

    // Limit
    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      query = query.limit(options.limit);
    }

    // Skip
    if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
      query = query.skip(options.skip);
    }

    query.exec((err, supplierList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea furnizorilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(supplierList || []);
    });
  });
}

/**
 * Găsește toți furnizorii după status.
 * @param {string} status - Statusul căutat
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de furnizori
 */
function findSuppliersByStatus(status, tenantId) {
  return new Promise((resolve, reject) => {
    if (!status || !isValidStatus(status)) {
      return reject(new AppError(
        `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_STATUSES.join(', ')}.`,
        400,
        'INVALID_STATUS'
      ));
    }

    const suppliers = getSuppliersDb();
    const filter = { status };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    suppliers.find(filter).sort({ name: 1 }).exec((err, supplierList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea furnizorilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(supplierList || []);
    });
  });
}

/**
 * Găsește furnizori după un anumit produs.
 * @param {string} product - Produsul căutat
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de furnizori
 */
function findSuppliersByProduct(product, tenantId) {
  return new Promise((resolve, reject) => {
    if (!product || typeof product !== 'string' || product.trim().length === 0) {
      return reject(new AppError(
        'Produsul căutat este invalid.',
        400,
        'INVALID_PRODUCT'
      ));
    }

    const suppliers = getSuppliersDb();
    const filter = { products: product.trim() };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    suppliers.find(filter).sort({ name: 1 }).exec((err, supplierList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea furnizorilor după produs: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(supplierList || []);
    });
  });
}

/**
 * Găsește furnizori după rating minim.
 * @param {number} ratingMin - Ratingul minim (0-5)
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de furnizori
 */
function findSuppliersByMinRating(ratingMin, tenantId) {
  return new Promise((resolve, reject) => {
    if (typeof ratingMin !== 'number' || ratingMin < 0 || ratingMin > 5) {
      return reject(new AppError(
        'Ratingul minim trebuie să fie un număr între 0 și 5.',
        400,
        'INVALID_RATING'
      ));
    }

    const suppliers = getSuppliersDb();
    const filter = { rating: { $gte: ratingMin } };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    suppliers.find(filter).sort({ rating: -1, name: 1 }).exec((err, supplierList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea furnizorilor după rating: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(supplierList || []);
    });
  });
}

/**
 * Găsește furnizori după termenii de plată.
 * @param {string} paymentTerms - Termenul de plată căutat
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de furnizori
 */
function findSuppliersByPaymentTerms(paymentTerms, tenantId) {
  return new Promise((resolve, reject) => {
    if (!paymentTerms || !isValidPaymentTerm(paymentTerms)) {
      return reject(new AppError(
        `Termenul de plată "${paymentTerms}" nu este valid. Termeni permisi: ${VALID_PAYMENT_TERMS.join(', ')}.`,
        400,
        'INVALID_PAYMENT_TERMS'
      ));
    }

    const suppliers = getSuppliersDb();
    const filter = { paymentTerms };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    suppliers.find(filter).sort({ name: 1 }).exec((err, supplierList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea furnizorilor după termeni de plată: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(supplierList || []);
    });
  });
}

/**
 * Actualizează un furnizor după ID.
 * @param {string} id - ID-ul furnizorului
 * @param {Object} updateData - Câmpurile de actualizat
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateSupplier(id, updateData) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
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
    const allowedFields = ['name', 'contactPerson', 'phone', 'email', 'address', 'products', 'paymentTerms', 'rating', 'status'];
    const setFields = {};
    const errors = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (!allowedFields.includes(key)) {
        continue; // Ignorăm câmpurile nepermise
      }

      switch (key) {
        case 'name':
          if (!isValidString(value, 1, 200)) {
            errors.push('Numele furnizorului trebuie să aibă între 1 și 200 de caractere.');
          } else {
            setFields.name = value.trim();
          }
          break;

        case 'contactPerson':
          if (value !== null && value !== undefined && String(value).trim().length > 200) {
            errors.push('Persoana de contact poate avea maximum 200 de caractere.');
          } else {
            setFields.contactPerson = value !== null && value !== undefined ? String(value).trim() : '';
          }
          break;

        case 'phone':
          if (value !== null && value !== undefined && String(value).trim().length > 50) {
            errors.push('Numărul de telefon poate avea maximum 50 de caractere.');
          } else {
            setFields.phone = value !== null && value !== undefined ? String(value).trim() : '';
          }
          break;

        case 'email':
          if (value !== null && value !== undefined && value !== '') {
            if (!isValidEmail(value)) {
              errors.push('Adresa de email a furnizorului este invalidă.');
            } else {
              setFields.email = value.toLowerCase().trim();
            }
          } else {
            setFields.email = '';
          }
          break;

        case 'address':
          if (value !== null && value !== undefined && String(value).trim().length > 500) {
            errors.push('Adresa furnizorului poate avea maximum 500 de caractere.');
          } else {
            setFields.address = value !== null && value !== undefined ? String(value).trim() : '';
          }
          break;

        case 'products':
          if (value !== undefined && value !== null && !Array.isArray(value)) {
            errors.push('Produsele trebuie să fie o listă.');
          } else {
            setFields.products = Array.isArray(value)
              ? value.map((p) => String(p).trim()).filter((p) => p.length > 0)
              : [];
          }
          break;

        case 'paymentTerms':
          if (!isValidPaymentTerm(value)) {
            errors.push(`Termenul de plată "${value}" nu este valid. Termeni permisi: ${VALID_PAYMENT_TERMS.join(', ')}.`);
          } else {
            setFields.paymentTerms = value;
          }
          break;

        case 'rating':
          if (value !== null && value !== undefined) {
            if (!isValidRating(value)) {
              errors.push('Ratingul trebuie să fie un număr între 0 și 5.');
            } else {
              setFields.rating = value;
            }
          } else {
            setFields.rating = null;
          }
          break;

        case 'status':
          if (!isValidStatus(value)) {
            errors.push(`Statusul "${value}" nu este valid. Statusuri permise: ${VALID_STATUSES.join(', ')}.`);
          } else {
            setFields.status = value;
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

    const suppliers = getSuppliersDb();
    suppliers.update(
      { _id: id },
      { $set: setFields },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedSupplier) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea furnizorului: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
        }

        resolve(updatedSupplier);
      }
    );
  });
}

/**
 * Actualizează ratingul unui furnizor.
 * @param {string} id - ID-ul furnizorului
 * @param {number} rating - Noul rating (0-5)
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateSupplierRating(id, rating) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
    }

    if (rating === undefined || rating === null || !isValidRating(rating)) {
      return reject(new AppError(
        'Ratingul trebuie să fie un număr între 0 și 5.',
        400,
        'INVALID_RATING'
      ));
    }

    const suppliers = getSuppliersDb();
    suppliers.update(
      { _id: id },
      {
        $set: {
          rating,
          updatedAt: new Date().toISOString(),
        },
      },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedSupplier) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea ratingului: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
        }

        resolve(updatedSupplier);
      }
    );
  });
}

/**
 * Actualizează statusul unui furnizor.
 * @param {string} id - ID-ul furnizorului
 * @param {string} status - Noul status
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateSupplierStatus(id, status) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
    }

    if (!status || !isValidStatus(status)) {
      return reject(new AppError(
        `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_STATUSES.join(', ')}.`,
        400,
        'INVALID_STATUS'
      ));
    }

    const suppliers = getSuppliersDb();
    suppliers.update(
      { _id: id },
      {
        $set: {
          status,
          updatedAt: new Date().toISOString(),
        },
      },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedSupplier) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea statusului: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
        }

        resolve(updatedSupplier);
      }
    );
  });
}

/**
 * Adaugă un produs la lista unui furnizor.
 * @param {string} id - ID-ul furnizorului
 * @param {string} product - Produsul de adăugat
 * @returns {Promise<Object>} Documentul actualizat
 */
function addSupplierProduct(id, product) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
    }

    if (!product || typeof product !== 'string' || product.trim().length === 0) {
      return reject(new AppError(
        'Produsul de adăugat este invalid.',
        400,
        'INVALID_PRODUCT'
      ));
    }

    const suppliers = getSuppliersDb();
    suppliers.update(
      { _id: id },
      {
        $addToSet: { products: product.trim() },
        $set: { updatedAt: new Date().toISOString() },
      },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedSupplier) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la adăugarea produsului: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
        }

        resolve(updatedSupplier);
      }
    );
  });
}

/**
 * Elimină un produs din lista unui furnizor.
 * @param {string} id - ID-ul furnizorului
 * @param {string} product - Produsul de eliminat
 * @returns {Promise<Object>} Documentul actualizat
 */
function removeSupplierProduct(id, product) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
    }

    if (!product || typeof product !== 'string' || product.trim().length === 0) {
      return reject(new AppError(
        'Produsul de eliminat este invalid.',
        400,
        'INVALID_PRODUCT'
      ));
    }

    const suppliers = getSuppliersDb();
    suppliers.update(
      { _id: id },
      {
        $pull: { products: product.trim() },
        $set: { updatedAt: new Date().toISOString() },
      },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedSupplier) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la eliminarea produsului: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
        }

        resolve(updatedSupplier);
      }
    );
  });
}

/**
 * Șterge un furnizor după ID.
 * @param {string} id - ID-ul furnizorului
 * @returns {Promise<boolean>} true dacă a fost șters
 */
function deleteSupplier(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
    }

    const suppliers = getSuppliersDb();
    suppliers.remove({ _id: id }, {}, (removeErr, numRemoved) => {
      if (removeErr) {
        return reject(new AppError(
          `Eroare la ștergerea furnizorului: ${removeErr.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      if (numRemoved === 0) {
        return reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
      }

      resolve(true);
    });
  });
}

/**
 * Obține numărul total de furnizori dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>}
 */
function countSuppliersByTenant(tenantId) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return resolve(0);
    }

    const suppliers = getSuppliersDb();
    suppliers.count({ tenantId }, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea furnizorilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(count);
    });
  });
}

/**
 * Obține numărul de furnizori după status.
 * @param {string} status - Statusul furnizorilor
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<number>}
 */
function countSuppliersByStatus(status, tenantId) {
  return new Promise((resolve, reject) => {
    if (!status || !isValidStatus(status)) {
      return reject(new AppError(
        `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_STATUSES.join(', ')}.`,
        400,
        'INVALID_STATUS'
      ));
    }

    const suppliers = getSuppliersDb();
    const filter = { status };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    suppliers.count(filter, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea furnizorilor după status: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(count);
    });
  });
}

/**
 * Caută furnizori după nume (potrivire parțială, case-insensitive).
 * @param {string} query - Șirul de căutare (minim 1 caracter)
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @param {Object} [options={}] - Opțiuni suplimentare (sort, limit, skip)
 * @returns {Promise<Array>} Lista de furnizori găsiți
 */
function searchSuppliersByName(query, tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!query || typeof query !== 'string' || query.trim().length < 1) {
      return reject(new AppError(
        'Termenul de căutare trebuie să aibă cel puțin un caracter.',
        400,
        'INVALID_SEARCH_QUERY'
      ));
    }

    const suppliers = getSuppliersDb();
    const escapedQuery = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRegex = new RegExp(escapedQuery, 'i');

    const filter = { name: nameRegex };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    let dbQuery = suppliers.find(filter);

    if (options.sort) {
      dbQuery = dbQuery.sort(options.sort);
    } else {
      dbQuery = dbQuery.sort({ name: 1 });
    }

    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      dbQuery = dbQuery.limit(options.limit);
    }

    if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
      dbQuery = dbQuery.skip(options.skip);
    }

    dbQuery.exec((err, supplierList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea furnizorilor după nume: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(supplierList || []);
    });
  });
}

// ---------------------------------------------------------------------------
// Operații CRUD – Supplier Orders
// ---------------------------------------------------------------------------

/**
 * Statusuri valide pentru o comandă la furnizor.
 */
const VALID_ORDER_STATUSES = ['draft', 'trimisă', 'confirmată', 'în livrare', 'livrată', 'anulată'];

/**
 * Verifică dacă un status de comandă este valid.
 * @param {string} status
 * @returns {boolean}
 */
function isValidOrderStatus(status) {
  return VALID_ORDER_STATUSES.includes(status);
}

/**
 * Creează o comandă nouă la furnizor.
 *
 * @param {Object} orderData - Datele comenzii
 * @param {string} orderData.supplierId - ID-ul furnizorului (obligatoriu)
 * @param {string} orderData.tenantId - ID-ul tenant-ului (obligatoriu)
 * @param {string} orderData.orderNumber - Numărul unic al comenzii (obligatoriu)
 * @param {Array} [orderData.items=[]] - Lista de articole comandate
 * @param {string} [orderData.status='draft'] - Statusul comenzii
 * @param {string} [orderData.notes=''] - Note adiționale
 * @param {string} [orderData.deliveryDate=null] - Data estimată de livrare
 * @returns {Promise<Object>} Documentul comenzii create
 */
function createSupplierOrder(orderData) {
  return new Promise((resolve, reject) => {
    if (!orderData || typeof orderData !== 'object') {
      return reject(new AppError('Datele comenzii sunt invalide.', 400, 'INVALID_ORDER_DATA'));
    }

    const { supplierId, tenantId, orderNumber, items, status, notes, deliveryDate } = orderData;

    // Validare supplierId
    if (!supplierId || typeof supplierId !== 'string') {
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

    // Validare orderNumber
    if (!orderNumber || typeof orderNumber !== 'string' || orderNumber.trim().length === 0) {
      return reject(new AppError(
        'Numărul comenzii este obligatoriu.',
        400,
        'MISSING_ORDER_NUMBER'
      ));
    }

    // Validare items
    const finalItems = Array.isArray(items) ? items : [];
    if (items !== undefined && !Array.isArray(items)) {
      return reject(new AppError(
        'Articolele comenzii trebuie să fie o listă.',
        400,
        'INVALID_ORDER_ITEMS'
      ));
    }

    // Validare status
    const finalStatus = status || 'draft';
    if (!isValidOrderStatus(finalStatus)) {
      return reject(new AppError(
        `Statusul comenzii "${finalStatus}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
        400,
        'INVALID_ORDER_STATUS'
      ));
    }

    // Validare deliveryDate (opțional)
    const finalDeliveryDate = deliveryDate || null;
    if (finalDeliveryDate && isNaN(Date.parse(finalDeliveryDate))) {
      return reject(new AppError(
        'Data de livrare este invalidă.',
        400,
        'INVALID_DELIVERY_DATE'
      ));
    }

    const orderDoc = {
      supplierId,
      tenantId,
      orderNumber: orderNumber.trim(),
      items: finalItems,
      status: finalStatus,
      notes: notes || '',
      deliveryDate: finalDeliveryDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ordersDb = getSupplierOrdersDb();
    ordersDb.insert(orderDoc, (insertErr, newOrder) => {
      if (insertErr) {
        if (insertErr.errorType === 'uniqueViolated') {
          return reject(new AppError(
            `Numărul comenzii "${orderNumber}" există deja.`,
            409,
            'DUPLICATE_ORDER_NUMBER'
          ));
        }
        return reject(new AppError(
          `Eroare la crearea comenzii: ${insertErr.message}`,
          500,
          'DB_INSERT_ERROR'
        ));
      }

      resolve(newOrder);
    });
  });
}

/**
 * Plasează o comandă la furnizor (wrapper peste createSupplierOrder).
 * Verifică existența furnizorului înainte de a crea comanda și se asigură
 * că tenantId-ul comenzii corespunde cu cel al furnizorului.
 *
 * @param {Object} orderData - Datele comenzii
 * @param {string} orderData.supplierId - ID-ul furnizorului (obligatoriu)
 * @param {string} orderData.tenantId - ID-ul tenant-ului (obligatoriu)
 * @param {string} orderData.orderNumber - Numărul unic al comenzii (obligatoriu)
 * @param {Array} [orderData.items=[]] - Lista de articole comandate
 * @param {string} [orderData.status='draft'] - Statusul comenzii
 * @param {string} [orderData.notes=''] - Note adiționale
 * @param {string} [orderData.deliveryDate=null] - Data estimată de livrare
 * @returns {Promise<Object>} Documentul comenzii create
 */
function placeSupplierOrder(orderData) {
  return new Promise((resolve, reject) => {
    if (!orderData || typeof orderData !== 'object') {
      return reject(new AppError('Datele comenzii sunt invalide.', 400, 'INVALID_ORDER_DATA'));
    }

    const { supplierId, tenantId } = orderData;

    if (!supplierId || typeof supplierId !== 'string') {
      return reject(new AppError(
        'ID-ul furnizorului este obligatoriu.',
        400,
        'MISSING_SUPPLIER_ID'
      ));
    }

    if (!tenantId) {
      return reject(new AppError(
        'ID-ul tenant-ului este obligatoriu.',
        400,
        'MISSING_TENANT_ID'
      ));
    }

    // Verificăm existența furnizorului
    const suppliers = getSuppliersDb();
    suppliers.findOne({ _id: supplierId }, (err, supplier) => {
      if (err) {
        return reject(new AppError(
          `Eroare la verificarea furnizorului: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      if (!supplier) {
        return reject(new AppError(
          'Furnizorul nu a fost găsit.',
          404,
          'SUPPLIER_NOT_FOUND'
        ));
      }

      // Verificăm că tenantId-ul furnizorului corespunde
      if (supplier.tenantId !== tenantId) {
        return reject(new AppError(
          'Furnizorul nu aparține acestui tenant.',
          403,
          'TENANT_MISMATCH'
        ));
      }

      // Verificăm că furnizorul nu este blacklisted sau inactive (opțional – doar avertizare; se permite comanda)
      if (supplier.status === 'blacklisted') {
        return reject(new AppError(
          'Nu se pot plasa comenzi la un furnizor blacklisted.',
          400,
          'SUPPLIER_BLACKLISTED'
        ));
      }

      // Creăm comanda efectivă
      createSupplierOrder(orderData)
        .then(resolve)
        .catch(reject);
    });
  });
}

/**
 * Găsește o comandă după ID.
 * @param {string} id - ID-ul comenzii
 * @returns {Promise<Object|null>}
 */
function findSupplierOrderById(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
    }

    const ordersDb = getSupplierOrdersDb();
    ordersDb.findOne({ _id: id }, (err, order) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea comenzii: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(order || null);
    });
  });
}

/**
 * Găsește toate comenzile unui furnizor.
 * @param {string} supplierId - ID-ul furnizorului
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de comenzi
 */
function findOrdersBySupplier(supplierId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!supplierId) {
      return reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
    }

    const ordersDb = getSupplierOrdersDb();
    const filter = { supplierId };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    ordersDb.find(filter).sort({ createdAt: -1 }).exec((err, orders) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea comenzilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(orders || []);
    });
  });
}

/**
 * Găsește toate comenzile dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni (sort, limit, skip)
 * @returns {Promise<Array>}
 */
function findOrdersByTenant(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const ordersDb = getSupplierOrdersDb();
    let query = ordersDb.find({ tenantId });

    if (options.sort) {
      query = query.sort(options.sort);
    } else {
      query = query.sort({ createdAt: -1 });
    }

    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      query = query.limit(options.limit);
    }

    if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
      query = query.skip(options.skip);
    }

    query.exec((err, orders) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea comenzilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(orders || []);
    });
  });
}

/**
 * Actualizează o comandă după ID.
 * @param {string} id - ID-ul comenzii
 * @param {Object} updateData - Câmpurile de actualizat
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateSupplierOrder(id, updateData) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
    }

    if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
      return reject(new AppError(
        'Nu s-au furnizat date pentru actualizare.',
        400,
        'EMPTY_UPDATE_DATA'
      ));
    }

    const allowedFields = ['items', 'status', 'notes', 'deliveryDate'];
    const setFields = {};
    const errors = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (!allowedFields.includes(key)) {
        continue;
      }

      switch (key) {
        case 'items':
          if (!Array.isArray(value)) {
            errors.push('Articolele comenzii trebuie să fie o listă.');
          } else {
            setFields.items = value;
          }
          break;

        case 'status':
          if (!isValidOrderStatus(value)) {
            errors.push(`Statusul "${value}" nu este valid.`);
          } else {
            setFields.status = value;
          }
          break;

        case 'notes':
          setFields.notes = value || '';
          break;

        case 'deliveryDate':
          if (value && isNaN(Date.parse(value))) {
            errors.push('Data de livrare este invalidă.');
          } else {
            setFields.deliveryDate = value || null;
          }
          break;

        // No default
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

    setFields.updatedAt = new Date().toISOString();

    const ordersDb = getSupplierOrdersDb();
    ordersDb.update(
      { _id: id },
      { $set: setFields },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedOrder) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea comenzii: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND'));
        }

        resolve(updatedOrder);
      }
    );
  });
}

/**
 * Actualizează statusul unei comenzi.
 * @param {string} id - ID-ul comenzii
 * @param {string} status - Noul status
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateOrderStatus(id, status) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
    }

    if (!status || !isValidOrderStatus(status)) {
      return reject(new AppError(
        `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
        400,
        'INVALID_ORDER_STATUS'
      ));
    }

    const ordersDb = getSupplierOrdersDb();
    ordersDb.update(
      { _id: id },
      {
        $set: {
          status,
          updatedAt: new Date().toISOString(),
        },
      },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedOrder) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea statusului comenzii: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND'));
        }

        resolve(updatedOrder);
      }
    );
  });
}

/**
 * Șterge o comandă după ID.
 * @param {string} id - ID-ul comenzii
 * @returns {Promise<boolean>} true dacă a fost ștearsă
 */
function deleteSupplierOrder(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
    }

    const ordersDb = getSupplierOrdersDb();
    ordersDb.remove({ _id: id }, {}, (removeErr, numRemoved) => {
      if (removeErr) {
        return reject(new AppError(
          `Eroare la ștergerea comenzii: ${removeErr.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      if (numRemoved === 0) {
        return reject(new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND'));
      }

      resolve(true);
    });
  });
}

/**
 * Obține numărul total de comenzi pentru un furnizor.
 * @param {string} supplierId - ID-ul furnizorului
 * @returns {Promise<number>}
 */
function countOrdersBySupplier(supplierId) {
  return new Promise((resolve, reject) => {
    if (!supplierId) {
      return resolve(0);
    }

    const ordersDb = getSupplierOrdersDb();
    ordersDb.count({ supplierId }, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea comenzilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(count);
    });
  });
}

/**
 * Găsește comenzi la furnizori pe baza unor filtre flexibile (adapter).
 *
 * @param {Object} filters - Criterii de filtrare
 * @param {string} [filters.supplierId] - ID-ul furnizorului
 * @param {string} [filters.tenantId] - ID-ul tenant-ului
 * @param {string} [filters.status] - Statusul comenzii
 * @param {string} [filters.search] - Termen de căutare în orderNumber
 * @param {string} [filters.dateFrom] - Dată minimă createdAt (ISO)
 * @param {string} [filters.dateTo] - Dată maximă createdAt (ISO)
 * @param {Object} [filters.options] - Opțiuni (sort, limit, skip)
 * @returns {Promise<Array>} Lista de comenzi găsite
 */
function findSupplierOrders(filters = {}) {
  return new Promise((resolve, reject) => {
    const ordersDb = getSupplierOrdersDb();
    const queryFilter = {};

    // Filtru după supplierId
    if (filters.supplierId) {
      queryFilter.supplierId = filters.supplierId;
    }

    // Filtru după tenantId
    if (filters.tenantId) {
      queryFilter.tenantId = filters.tenantId;
    }

    // Filtru după status
    if (filters.status) {
      if (!isValidOrderStatus(filters.status)) {
        return reject(new AppError(
          `Statusul "${filters.status}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
          400,
          'INVALID_ORDER_STATUS'
        ));
      }
      queryFilter.status = filters.status;
    }

    // Filtru după search (orderNumber)
    if (filters.search && typeof filters.search === 'string' && filters.search.trim().length > 0) {
      const escapedSearch = filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      queryFilter.orderNumber = new RegExp(escapedSearch, 'i');
    }

    // Filtru după interval de date
    if (filters.dateFrom || filters.dateTo) {
      queryFilter.createdAt = {};

      if (filters.dateFrom) {
        const fromDate = new Date(filters.dateFrom);
        if (isNaN(fromDate.getTime())) {
          return reject(new AppError(
            'Data de început (dateFrom) este invalidă.',
            400,
            'INVALID_DATE_FROM'
          ));
        }
        queryFilter.createdAt.$gte = fromDate.toISOString();
      }

      if (filters.dateTo) {
        const toDate = new Date(filters.dateTo);
        if (isNaN(toDate.getTime())) {
          return reject(new AppError(
            'Data de sfârșit (dateTo) este invalidă.',
            400,
            'INVALID_DATE_TO'
          ));
        }
        queryFilter.createdAt.$lte = toDate.toISOString();
      }
    }

    const options = filters.options || {};
    let dbQuery = ordersDb.find(queryFilter);

    if (options.sort) {
      dbQuery = dbQuery.sort(options.sort);
    } else {
      dbQuery = dbQuery.sort({ createdAt: -1 });
    }

    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      dbQuery = dbQuery.limit(options.limit);
    }

    if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
      dbQuery = dbQuery.skip(options.skip);
    }

    dbQuery.exec((err, orders) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea comenzilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(orders || []);
    });
  });
}

/**
 * Numără comenzi la furnizori pe baza unor filtre flexibile (adapter).
 *
 * @param {Object} filters - Criterii de filtrare
 * @param {string} [filters.supplierId] - ID-ul furnizorului
 * @param {string} [filters.tenantId] - ID-ul tenant-ului
 * @param {string} [filters.status] - Statusul comenzii
 * @param {string} [filters.dateFrom] - Dată minimă createdAt (ISO)
 * @param {string} [filters.dateTo] - Dată maximă createdAt (ISO)
 * @returns {Promise<number>} Numărul de comenzi
 */
function countSupplierOrders(filters = {}) {
  return new Promise((resolve, reject) => {
    const ordersDb = getSupplierOrdersDb();
    const queryFilter = {};

    // Filtru după supplierId
    if (filters.supplierId) {
      queryFilter.supplierId = filters.supplierId;
    }

    // Filtru după tenantId
    if (filters.tenantId) {
      queryFilter.tenantId = filters.tenantId;
    }

    // Filtru după status
    if (filters.status) {
      if (!isValidOrderStatus(filters.status)) {
        return reject(new AppError(
          `Statusul "${filters.status}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
          400,
          'INVALID_ORDER_STATUS'
        ));
      }
      queryFilter.status = filters.status;
    }

    // Filtru după interval de date
    if (filters.dateFrom || filters.dateTo) {
      queryFilter.createdAt = {};

      if (filters.dateFrom) {
        const fromDate = new Date(filters.dateFrom);
        if (isNaN(fromDate.getTime())) {
          return reject(new AppError(
            'Data de început (dateFrom) este invalidă.',
            400,
            'INVALID_DATE_FROM'
          ));
        }
        queryFilter.createdAt.$gte = fromDate.toISOString();
      }

      if (filters.dateTo) {
        const toDate = new Date(filters.dateTo);
        if (isNaN(toDate.getTime())) {
          return reject(new AppError(
            'Data de sfârșit (dateTo) este invalidă.',
            400,
            'INVALID_DATE_TO'
          ));
        }
        queryFilter.createdAt.$lte = toDate.toISOString();
      }
    }

    ordersDb.count(queryFilter, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea comenzilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(count);
    });
  });
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Constante
  VALID_STATUSES,
  VALID_PAYMENT_TERMS,
  VALID_ORDER_STATUSES,

  // Funcții de validare
  isValidString,
  isValidStatus,
  isValidPaymentTerm,
  isValidEmail,
  isValidRating,
  validateProducts,
  isValidOrderStatus,

  // Instanțe DB
  getSuppliersDb,
  getSupplierOrdersDb,

  // CRUD Suppliers
  createSupplier,
  findSupplierById,
  findSuppliersByTenant,
  findSuppliersByStatus,
  findSuppliersByProduct,
  findSuppliersByMinRating,
  findSuppliersByPaymentTerms,
  updateSupplier,
  updateSupplierRating,
  updateSupplierStatus,
  addSupplierProduct,
  removeSupplierProduct,
  deleteSupplier,
  countSuppliersByTenant,
  countSuppliersByStatus,
  searchSuppliersByName,

  // CRUD Supplier Orders
  createSupplierOrder,
  placeSupplierOrder,
  findSupplierOrderById,
  findOrdersBySupplier,
  findOrdersByTenant,
  findSupplierOrders,
  updateSupplierOrder,
  updateOrderStatus,
  deleteSupplierOrder,
  countOrdersBySupplier,
  countSupplierOrders,
};