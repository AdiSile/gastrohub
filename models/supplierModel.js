'use strict';

// ---------------------------------------------------------------------------
// Model Supplier – GastroHub
// Definirea structurii, validărilor și operațiilor CRUD pentru furnizori.
// Câmpuri suportate: name, contactPerson, phone, email, address, products,
// paymentTerms, rating, status, tenantId
//
// Bază de date: SQLite via config/db.js (getDb, run, get, all)
// Tabele: suppliers, supplier_orders
// ---------------------------------------------------------------------------

const { getDb, run, get, all } = require('../config/db');
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
      errors.push('Produsul #' + (i + 1) + ' trebuie să fie un șir de caractere valid.');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Helpers: parsare/serializare coloane JSON
// ---------------------------------------------------------------------------

/**
 * Parsează o coloană TEXT care conține un array JSON.
 * @param {string|null} raw
 * @returns {Array}
 */
function parseJsonArray(raw) {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

/**
 * Parsează o coloană TEXT care conține un obiect JSON pentru notes.
 * Returnează { text: string, rating: number|null }.
 * @param {string|null} raw
 * @returns {{ text: string, rating: number|null, orderNumber: string|null }}
 */
function parseNotes(raw) {
  if (!raw || typeof raw !== 'string') return { text: '', rating: null, orderNumber: null };
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      return {
        text: typeof parsed.text === 'string' ? parsed.text : '',
        rating: typeof parsed.rating === 'number' ? parsed.rating : null,
        orderNumber: typeof parsed.orderNumber === 'string' ? parsed.orderNumber : null,
      };
    }
    // Dacă e string simplu, îl tratăm ca text
    return { text: raw, rating: null, orderNumber: null };
  } catch (_e) {
    return { text: raw, rating: null, orderNumber: null };
  }
}

/**
 * Construiește valoarea JSON pentru coloana notes dintr-un obiect.
 * @param {{ text?: string, rating?: number|null, orderNumber?: string|null }} obj
 * @returns {string}
 */
function buildNotes(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const clean = {};
  if (obj.text !== undefined && obj.text !== null) clean.text = String(obj.text);
  else clean.text = '';
  if (obj.rating !== undefined && obj.rating !== null) clean.rating = Number(obj.rating);
  if (obj.orderNumber !== undefined && obj.orderNumber !== null) clean.orderNumber = String(obj.orderNumber);
  if (Object.keys(clean).length === 0) return '';
  return JSON.stringify(clean);
}

// ---------------------------------------------------------------------------
// Transformare rând SQL → obiect model (backward compatibil cu NeDB)
// ---------------------------------------------------------------------------

/**
 * Transformă un rând din tabela suppliers în obiectul model.
 * @param {Object} row
 * @returns {Object|null}
 */
function transformSupplierRow(row) {
  if (!row) return null;

  const notesParsed = parseNotes(row.notes);

  return {
    _id: row._id != null ? String(row._id) : (row.id != null ? String(row.id) : null),
    id: row._id != null ? String(row._id) : (row.id != null ? String(row.id) : null),
    name: row.name,
    contactPerson: row.contactPerson || '',
    phone: row.phone || '',
    email: row.email || '',
    address: row.address || '',
    taxId: row.taxId || '',
    products: parseJsonArray(row.categories),
    categories: row.categories || '[]',
    paymentTerms: row.paymentTerms || '',
    rating: notesParsed.rating,
    status: row.status || 'active',
    notes: notesParsed.text,
    tenantId: row.tenantId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Transformă un rând din tabela supplier_orders în obiectul model.
 * @param {Object} row
 * @returns {Object|null}
 */
function transformOrderRow(row) {
  if (!row) return null;

  const notesParsed = parseNotes(row.notes);

  return {
    _id: row._id != null ? String(row._id) : (row.id != null ? String(row.id) : null),
    id: row._id != null ? String(row._id) : (row.id != null ? String(row.id) : null),
    supplierId: row.supplierId,
    tenantId: row.tenantId,
    orderNumber: notesParsed.orderNumber || ('ORD-' + String(row.id)),
    orderDate: row.orderDate,
    expectedDate: row.expectedDate,
    deliveryDate: row.expectedDate,    // backward compat
    receivedDate: row.receivedDate,
    status: row.status || 'plasată',
    items: parseJsonArray(row.items),
    subtotal: row.subtotal || 0,
    tax: row.tax || 0,
    total: row.total || 0,
    currency: row.currency || 'RON',
    notes: notesParsed.text,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
  // -----------------------------------------------------------------------
  // Validare date de bază
  // -----------------------------------------------------------------------
  if (!supplierData || typeof supplierData !== 'object') {
    return Promise.reject(new AppError('Datele furnizorului sunt invalide.', 400, 'INVALID_SUPPLIER_DATA'));
  }

  const { name, contactPerson, phone, email, address, products, paymentTerms, rating, status, tenantId } = supplierData;

  // Validare nume
  if (!name || !isValidString(name, 1, 200)) {
    return Promise.reject(new AppError(
      'Numele furnizorului trebuie să aibă între 1 și 200 de caractere.',
      400,
      'INVALID_SUPPLIER_NAME'
    ));
  }

  // Validare tenantId
  if (!tenantId) {
    return Promise.reject(new AppError(
      'ID-ul tenant-ului este obligatoriu.',
      400,
      'MISSING_TENANT_ID'
    ));
  }

  // Validare contactPerson (opțional)
  const finalContactPerson = contactPerson !== undefined && contactPerson !== null ? String(contactPerson).trim() : '';
  if (finalContactPerson && finalContactPerson.length > 200) {
    return Promise.reject(new AppError(
      'Persoana de contact poate avea maximum 200 de caractere.',
      400,
      'INVALID_CONTACT_PERSON'
    ));
  }

  // Validare phone (opțional)
  const finalPhone = phone !== undefined && phone !== null ? String(phone).trim() : '';
  if (finalPhone && finalPhone.length > 50) {
    return Promise.reject(new AppError(
      'Numărul de telefon poate avea maximum 50 de caractere.',
      400,
      'INVALID_PHONE'
    ));
  }

  // Validare email (opțional)
  const finalEmail = email !== undefined && email !== null ? email : '';
  if (finalEmail && !isValidEmail(finalEmail)) {
    return Promise.reject(new AppError(
      'Adresa de email a furnizorului este invalidă.',
      400,
      'INVALID_SUPPLIER_EMAIL'
    ));
  }

  // Validare address (opțional)
  const finalAddress = address !== undefined && address !== null ? String(address).trim() : '';
  if (finalAddress && finalAddress.length > 500) {
    return Promise.reject(new AppError(
      'Adresa furnizorului poate avea maximum 500 de caractere.',
      400,
      'INVALID_ADDRESS'
    ));
  }

  // Validare products (opțional)
  const finalProducts = Array.isArray(products) ? products.map(function (p) { return String(p).trim(); }).filter(function (p) { return p.length > 0; }) : [];
  if (products !== undefined && !Array.isArray(products)) {
    return Promise.reject(new AppError(
      'Produsele trebuie să fie o listă.',
      400,
      'INVALID_PRODUCTS'
    ));
  }

  // Validare paymentTerms (opțional)
  const finalPaymentTerms = paymentTerms || '30 zile';
  if (!isValidPaymentTerm(finalPaymentTerms)) {
    return Promise.reject(new AppError(
      'Termenul de plată "' + finalPaymentTerms + '" nu este valid. ' +
      'Termeni permisi: ' + VALID_PAYMENT_TERMS.join(', ') + '.',
      400,
      'INVALID_PAYMENT_TERMS'
    ));
  }

  // Validare rating (opțional)
  const finalRating = rating !== undefined && rating !== null ? rating : null;
  if (finalRating !== null && !isValidRating(finalRating)) {
    return Promise.reject(new AppError(
      'Ratingul trebuie să fie un număr între 0 și 5.',
      400,
      'INVALID_RATING'
    ));
  }

  // Validare status (opțional)
  const finalStatus = status || 'active';
  if (!isValidStatus(finalStatus)) {
    return Promise.reject(new AppError(
      'Statusul "' + finalStatus + '" nu este valid. Statusuri permise: ' + VALID_STATUSES.join(', ') + '.',
      400,
      'INVALID_STATUS'
    ));
  }

  // -----------------------------------------------------------------------
  // Creare înregistrare SQL
  // -----------------------------------------------------------------------
  try {
    const now = new Date().toISOString();
    const categoriesJson = JSON.stringify(finalProducts);
    const notesJson = buildNotes({ text: '', rating: finalRating });

    const result = run(
      'INSERT INTO suppliers (name, contactPerson, phone, email, address, paymentTerms, categories, status, notes, tenantId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name.trim(), finalContactPerson, finalPhone, finalEmail ? finalEmail.toLowerCase().trim() : '', finalAddress, finalPaymentTerms, categoriesJson, finalStatus, notesJson, tenantId, now, now]
    );

    const newId = result.lastInsertRowid;

    const created = get(
      'SELECT id, name, contactPerson, phone, email, address, taxId, paymentTerms, categories, status, notes, tenantId, createdAt, updatedAt FROM suppliers WHERE id = ?',
      [newId]
    );

    return Promise.resolve(transformSupplierRow(created));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la crearea furnizorului: ' + err.message,
      500,
      'DB_INSERT_ERROR'
    ));
  }
}

/**
 * Găsește un furnizor după ID-ul său.
 * @param {string|number} id - ID-ul furnizorului
 * @returns {Promise<Object|null>} Documentul furnizorului sau null
 */
function findSupplierById(id) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
  }

  try {
    const row = get(
      'SELECT id, name, contactPerson, phone, email, address, taxId, paymentTerms, categories, status, notes, tenantId, createdAt, updatedAt FROM suppliers WHERE id = ?',
      [id]
    );

    return Promise.resolve(transformSupplierRow(row));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea furnizorului: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește toți furnizorii dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni de căutare (sort, limit, skip)
 * @returns {Promise<Array>} Lista de furnizori
 */
function findSuppliersByTenant(tenantId, options) {
  if (!options) options = {};

  if (!tenantId) {
    return Promise.reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
  }

  try {
    let sql = 'SELECT id, name, contactPerson, phone, email, address, taxId, paymentTerms, categories, status, notes, tenantId, createdAt, updatedAt FROM suppliers WHERE tenantId = ?';
    const params = [tenantId];

    // Sortare
    const sortBy = (options.sort && options.sort.name) ? 'name' : 'name';
    const sortDir = (options.sort && options.sort.name === -1) ? 'DESC' : 'ASC';
    sql += ' ORDER BY ' + sortBy + ' ' + sortDir;

    // Limit / Skip
    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
      if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
        sql += ' OFFSET ?';
        params.push(options.skip);
      }
    }

    const rows = all(sql, params);

    return Promise.resolve((rows || []).map(transformSupplierRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea furnizorilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește toți furnizorii după status.
 * @param {string} status - Statusul căutat
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de furnizori
 */
function findSuppliersByStatus(status, tenantId) {
  if (!status || !isValidStatus(status)) {
    return Promise.reject(new AppError(
      'Statusul "' + status + '" nu este valid. Statusuri permise: ' + VALID_STATUSES.join(', ') + '.',
      400,
      'INVALID_STATUS'
    ));
  }

  try {
    let sql = 'SELECT id, name, contactPerson, phone, email, address, taxId, paymentTerms, categories, status, notes, tenantId, createdAt, updatedAt FROM suppliers WHERE status = ?';
    const params = [status];

    if (tenantId) {
      sql += ' AND tenantId = ?';
      params.push(tenantId);
    }

    sql += ' ORDER BY name ASC';

    const rows = all(sql, params);

    return Promise.resolve((rows || []).map(transformSupplierRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea furnizorilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește furnizori după un anumit produs.
 * @param {string} product - Produsul căutat
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de furnizori
 */
function findSuppliersByProduct(product, tenantId) {
  if (!product || typeof product !== 'string' || product.trim().length === 0) {
    return Promise.reject(new AppError(
      'Produsul căutat este invalid.',
      400,
      'INVALID_PRODUCT'
    ));
  }

  try {
    // Căutare în coloana categories (JSON array) folosind LIKE
    const searchTerm = '%"' + product.trim() + '"%';
    let sql = 'SELECT id, name, contactPerson, phone, email, address, taxId, paymentTerms, categories, status, notes, tenantId, createdAt, updatedAt FROM suppliers WHERE categories LIKE ?';
    const params = [searchTerm];

    if (tenantId) {
      sql += ' AND tenantId = ?';
      params.push(tenantId);
    }

    sql += ' ORDER BY name ASC';

    const rows = all(sql, params);

    return Promise.resolve((rows || []).map(transformSupplierRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea furnizorilor după produs: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește furnizori după rating minim.
 * Rating-ul este stocat în coloana notes (JSON).
 * @param {number} ratingMin - Ratingul minim (0-5)
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de furnizori
 */
function findSuppliersByMinRating(ratingMin, tenantId) {
  if (typeof ratingMin !== 'number' || ratingMin < 0 || ratingMin > 5) {
    return Promise.reject(new AppError(
      'Ratingul minim trebuie să fie un număr între 0 și 5.',
      400,
      'INVALID_RATING'
    ));
  }

  try {
    let sql = 'SELECT id, name, contactPerson, phone, email, address, taxId, paymentTerms, categories, status, notes, tenantId, createdAt, updatedAt FROM suppliers';
    const conditions = [];
    const params = [];

    if (tenantId) {
      conditions.push('tenantId = ?');
      params.push(tenantId);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY name ASC';

    const rows = all(sql, params);
    const suppliers = (rows || []).map(transformSupplierRow);

    // Filtrare în JS după rating minim
    const filtered = suppliers.filter(function (s) {
      return s.rating !== null && s.rating >= ratingMin;
    });

    // Sortare descrescătoare după rating
    filtered.sort(function (a, b) {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return (a.name || '').localeCompare(b.name || '');
    });

    return Promise.resolve(filtered);
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea furnizorilor după rating: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește furnizori după termenii de plată.
 * @param {string} paymentTerms - Termenul de plată căutat
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de furnizori
 */
function findSuppliersByPaymentTerms(paymentTerms, tenantId) {
  if (!paymentTerms || !isValidPaymentTerm(paymentTerms)) {
    return Promise.reject(new AppError(
      'Termenul de plată "' + paymentTerms + '" nu este valid. Termeni permisi: ' + VALID_PAYMENT_TERMS.join(', ') + '.',
      400,
      'INVALID_PAYMENT_TERMS'
    ));
  }

  try {
    let sql = 'SELECT id, name, contactPerson, phone, email, address, taxId, paymentTerms, categories, status, notes, tenantId, createdAt, updatedAt FROM suppliers WHERE paymentTerms = ?';
    const params = [paymentTerms];

    if (tenantId) {
      sql += ' AND tenantId = ?';
      params.push(tenantId);
    }

    sql += ' ORDER BY name ASC';

    const rows = all(sql, params);

    return Promise.resolve((rows || []).map(transformSupplierRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea furnizorilor după termeni de plată: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Actualizează un furnizor după ID.
 * @param {string|number} id - ID-ul furnizorului
 * @param {Object} updateData - Câmpurile de actualizat
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateSupplier(id, updateData) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
  }

  if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
    return Promise.reject(new AppError(
      'Nu s-au furnizat date pentru actualizare.',
      400,
      'EMPTY_UPDATE_DATA'
    ));
  }

  // -----------------------------------------------------------------------
  // Câmpuri permise pentru actualizare
  // -----------------------------------------------------------------------
  const allowedFields = ['name', 'contactPerson', 'phone', 'email', 'address', 'products', 'paymentTerms', 'rating', 'status'];
  const setClauses = [];
  const params = [];
  const errors = [];
  let newRating = undefined;

  for (const key of Object.keys(updateData)) {
    const value = updateData[key];
    if (!allowedFields.includes(key)) {
      continue;
    }

    switch (key) {
      case 'name':
        if (!isValidString(value, 1, 200)) {
          errors.push('Numele furnizorului trebuie să aibă între 1 și 200 de caractere.');
        } else {
          setClauses.push('name = ?');
          params.push(value.trim());
        }
        break;

      case 'contactPerson':
        if (value !== null && value !== undefined && String(value).trim().length > 200) {
          errors.push('Persoana de contact poate avea maximum 200 de caractere.');
        } else {
          setClauses.push('contactPerson = ?');
          params.push(value !== null && value !== undefined ? String(value).trim() : '');
        }
        break;

      case 'phone':
        if (value !== null && value !== undefined && String(value).trim().length > 50) {
          errors.push('Numărul de telefon poate avea maximum 50 de caractere.');
        } else {
          setClauses.push('phone = ?');
          params.push(value !== null && value !== undefined ? String(value).trim() : '');
        }
        break;

      case 'email':
        if (value !== null && value !== undefined && value !== '') {
          if (!isValidEmail(value)) {
            errors.push('Adresa de email a furnizorului este invalidă.');
          } else {
            setClauses.push('email = ?');
            params.push(value.toLowerCase().trim());
          }
        } else {
          setClauses.push('email = ?');
          params.push('');
        }
        break;

      case 'address':
        if (value !== null && value !== undefined && String(value).trim().length > 500) {
          errors.push('Adresa furnizorului poate avea maximum 500 de caractere.');
        } else {
          setClauses.push('address = ?');
          params.push(value !== null && value !== undefined ? String(value).trim() : '');
        }
        break;

      case 'products':
        if (value !== undefined && value !== null && !Array.isArray(value)) {
          errors.push('Produsele trebuie să fie o listă.');
        } else {
          const productsArr = Array.isArray(value)
            ? value.map(function (p) { return String(p).trim(); }).filter(function (p) { return p.length > 0; })
            : [];
          setClauses.push('categories = ?');
          params.push(JSON.stringify(productsArr));
        }
        break;

      case 'paymentTerms':
        if (!isValidPaymentTerm(value)) {
          errors.push('Termenul de plată "' + value + '" nu este valid. Termeni permisi: ' + VALID_PAYMENT_TERMS.join(', ') + '.');
        } else {
          setClauses.push('paymentTerms = ?');
          params.push(value);
        }
        break;

      case 'rating':
        if (value !== null && value !== undefined) {
          if (!isValidRating(value)) {
            errors.push('Ratingul trebuie să fie un număr între 0 și 5.');
          } else {
            newRating = value;
          }
        } else {
          newRating = null;
        }
        break;

      case 'status':
        if (!isValidStatus(value)) {
          errors.push('Statusul "' + value + '" nu este valid. Statusuri permise: ' + VALID_STATUSES.join(', ') + '.');
        } else {
          setClauses.push('status = ?');
          params.push(value);
        }
        break;
    }
  }

  if (errors.length > 0) {
    return Promise.reject(new AppError(errors.join(' '), 400, 'VALIDATION_ERROR'));
  }

  // Reconstruim notes dacă rating-ul s-a schimbat
  if (newRating !== undefined) {
    try {
      const existing = get('SELECT notes FROM suppliers WHERE id = ?', [id]);
      if (existing) {
        const existingNotes = parseNotes(existing.notes);
        const updatedNotes = buildNotes({ text: existingNotes.text, rating: newRating });
        setClauses.push('notes = ?');
        params.push(updatedNotes);
      } else {
        const updatedNotes = buildNotes({ text: '', rating: newRating });
        setClauses.push('notes = ?');
        params.push(updatedNotes);
      }
    } catch (_e) {
      const updatedNotes = buildNotes({ text: '', rating: newRating });
      setClauses.push('notes = ?');
      params.push(updatedNotes);
    }
  }

  if (setClauses.length === 0) {
    return Promise.reject(new AppError(
      'Nu s-au furnizat câmpuri valide pentru actualizare.',
      400,
      'NO_VALID_FIELDS'
    ));
  }

  // Adăugăm updatedAt
  const now = new Date().toISOString();
  setClauses.push('updatedAt = ?');
  params.push(now);

  // Adăugăm ID-ul la final
  params.push(id);

  try {
    const result = run(
      'UPDATE suppliers SET ' + setClauses.join(', ') + ' WHERE id = ?',
      params
    );

    if (result.changes === 0) {
      return Promise.reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
    }

    const updated = get(
      'SELECT id, name, contactPerson, phone, email, address, taxId, paymentTerms, categories, status, notes, tenantId, createdAt, updatedAt FROM suppliers WHERE id = ?',
      [id]
    );

    return Promise.resolve(transformSupplierRow(updated));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la actualizarea furnizorului: ' + err.message,
      500,
      'DB_UPDATE_ERROR'
    ));
  }
}

/**
 * Actualizează ratingul unui furnizor.
 * @param {string|number} id - ID-ul furnizorului
 * @param {number} rating - Noul rating (0-5)
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateSupplierRating(id, rating) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
  }

  if (rating === undefined || rating === null || !isValidRating(rating)) {
    return Promise.reject(new AppError(
      'Ratingul trebuie să fie un număr între 0 și 5.',
      400,
      'INVALID_RATING'
    ));
  }

  try {
    // Obținem notes curent
    const existing = get('SELECT notes FROM suppliers WHERE id = ?', [id]);
    if (!existing) {
      return Promise.reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
    }

    const existingNotes = parseNotes(existing.notes);
    const updatedNotes = buildNotes({ text: existingNotes.text, rating: rating });
    const now = new Date().toISOString();

    const result = run(
      'UPDATE suppliers SET notes = ?, updatedAt = ? WHERE id = ?',
      [updatedNotes, now, id]
    );

    if (result.changes === 0) {
      return Promise.reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
    }

    const updated = get(
      'SELECT id, name, contactPerson, phone, email, address, taxId, paymentTerms, categories, status, notes, tenantId, createdAt, updatedAt FROM suppliers WHERE id = ?',
      [id]
    );

    return Promise.resolve(transformSupplierRow(updated));
  } catch (err) {
    if (err instanceof AppError) return Promise.reject(err);
    return Promise.reject(new AppError(
      'Eroare la actualizarea ratingului: ' + err.message,
      500,
      'DB_UPDATE_ERROR'
    ));
  }
}

/**
 * Actualizează statusul unui furnizor.
 * @param {string|number} id - ID-ul furnizorului
 * @param {string} status - Noul status
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateSupplierStatus(id, status) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
  }

  if (!status || !isValidStatus(status)) {
    return Promise.reject(new AppError(
      'Statusul "' + status + '" nu este valid. Statusuri permise: ' + VALID_STATUSES.join(', ') + '.',
      400,
      'INVALID_STATUS'
    ));
  }

  try {
    const now = new Date().toISOString();

    const result = run(
      'UPDATE suppliers SET status = ?, updatedAt = ? WHERE id = ?',
      [status, now, id]
    );

    if (result.changes === 0) {
      return Promise.reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
    }

    const updated = get(
      'SELECT id, name, contactPerson, phone, email, address, taxId, paymentTerms, categories, status, notes, tenantId, createdAt, updatedAt FROM suppliers WHERE id = ?',
      [id]
    );

    return Promise.resolve(transformSupplierRow(updated));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la actualizarea statusului: ' + err.message,
      500,
      'DB_UPDATE_ERROR'
    ));
  }
}

/**
 * Adaugă un produs la lista unui furnizor.
 * @param {string|number} id - ID-ul furnizorului
 * @param {string} product - Produsul de adăugat
 * @returns {Promise<Object>} Documentul actualizat
 */
function addSupplierProduct(id, product) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
  }

  if (!product || typeof product !== 'string' || product.trim().length === 0) {
    return Promise.reject(new AppError(
      'Produsul de adăugat este invalid.',
      400,
      'INVALID_PRODUCT'
    ));
  }

  try {
    const existing = get('SELECT categories FROM suppliers WHERE id = ?', [id]);
    if (!existing) {
      return Promise.reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
    }

    const products = parseJsonArray(existing.categories);
    const trimmedProduct = product.trim();

    if (!products.includes(trimmedProduct)) {
      products.push(trimmedProduct);
    }

    const now = new Date().toISOString();
    const categoriesJson = JSON.stringify(products);

    const result = run(
      'UPDATE suppliers SET categories = ?, updatedAt = ? WHERE id = ?',
      [categoriesJson, now, id]
    );

    if (result.changes === 0) {
      return Promise.reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
    }

    const updated = get(
      'SELECT id, name, contactPerson, phone, email, address, taxId, paymentTerms, categories, status, notes, tenantId, createdAt, updatedAt FROM suppliers WHERE id = ?',
      [id]
    );

    return Promise.resolve(transformSupplierRow(updated));
  } catch (err) {
    if (err instanceof AppError) return Promise.reject(err);
    return Promise.reject(new AppError(
      'Eroare la adăugarea produsului: ' + err.message,
      500,
      'DB_UPDATE_ERROR'
    ));
  }
}

/**
 * Elimină un produs din lista unui furnizor.
 * @param {string|number} id - ID-ul furnizorului
 * @param {string} product - Produsul de eliminat
 * @returns {Promise<Object>} Documentul actualizat
 */
function removeSupplierProduct(id, product) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
  }

  if (!product || typeof product !== 'string' || product.trim().length === 0) {
    return Promise.reject(new AppError(
      'Produsul de eliminat este invalid.',
      400,
      'INVALID_PRODUCT'
    ));
  }

  try {
    const existing = get('SELECT categories FROM suppliers WHERE id = ?', [id]);
    if (!existing) {
      return Promise.reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
    }

    const products = parseJsonArray(existing.categories);
    const trimmedProduct = product.trim();
    const filtered = products.filter(function (p) { return p !== trimmedProduct; });

    const now = new Date().toISOString();
    const categoriesJson = JSON.stringify(filtered);

    const result = run(
      'UPDATE suppliers SET categories = ?, updatedAt = ? WHERE id = ?',
      [categoriesJson, now, id]
    );

    if (result.changes === 0) {
      return Promise.reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
    }

    const updated = get(
      'SELECT id, name, contactPerson, phone, email, address, taxId, paymentTerms, categories, status, notes, tenantId, createdAt, updatedAt FROM suppliers WHERE id = ?',
      [id]
    );

    return Promise.resolve(transformSupplierRow(updated));
  } catch (err) {
    if (err instanceof AppError) return Promise.reject(err);
    return Promise.reject(new AppError(
      'Eroare la eliminarea produsului: ' + err.message,
      500,
      'DB_UPDATE_ERROR'
    ));
  }
}

/**
 * Șterge un furnizor după ID.
 * @param {string|number} id - ID-ul furnizorului
 * @returns {Promise<boolean>} true dacă a fost șters
 */
function deleteSupplier(id) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
  }

  try {
    const result = run(
      'DELETE FROM suppliers WHERE id = ?',
      [id]
    );

    if (result.changes === 0) {
      return Promise.reject(new AppError('Furnizorul nu a fost găsit.', 404, 'SUPPLIER_NOT_FOUND'));
    }

    return Promise.resolve(true);
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la ștergerea furnizorului: ' + err.message,
      500,
      'DB_DELETE_ERROR'
    ));
  }
}

/**
 * Obține numărul total de furnizori dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>}
 */
function countSuppliersByTenant(tenantId) {
  if (!tenantId) {
    return Promise.resolve(0);
  }

  try {
    const row = get(
      'SELECT COUNT(*) AS cnt FROM suppliers WHERE tenantId = ?',
      [tenantId]
    );

    return Promise.resolve(row ? row.cnt : 0);
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la numărarea furnizorilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Obține numărul de furnizori după status.
 * @param {string} status - Statusul furnizorilor
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<number>}
 */
function countSuppliersByStatus(status, tenantId) {
  if (!status || !isValidStatus(status)) {
    return Promise.reject(new AppError(
      'Statusul "' + status + '" nu este valid. Statusuri permise: ' + VALID_STATUSES.join(', ') + '.',
      400,
      'INVALID_STATUS'
    ));
  }

  try {
    let sql = 'SELECT COUNT(*) AS cnt FROM suppliers WHERE status = ?';
    const params = [status];

    if (tenantId) {
      sql += ' AND tenantId = ?';
      params.push(tenantId);
    }

    const row = get(sql, params);

    return Promise.resolve(row ? row.cnt : 0);
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la numărarea furnizorilor după status: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Caută furnizori după nume (potrivire parțială, case-insensitive).
 * @param {string} query - Șirul de căutare (minim 1 caracter)
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @param {Object} [options={}] - Opțiuni suplimentare (sort, limit, skip)
 * @returns {Promise<Array>} Lista de furnizori găsiți
 */
function searchSuppliersByName(query, tenantId, options) {
  if (!options) options = {};

  if (!query || typeof query !== 'string' || query.trim().length < 1) {
    return Promise.reject(new AppError(
      'Termenul de căutare trebuie să aibă cel puțin un caracter.',
      400,
      'INVALID_SEARCH_QUERY'
    ));
  }

  try {
    const searchPattern = '%' + query.trim() + '%';
    let sql = 'SELECT id, name, contactPerson, phone, email, address, taxId, paymentTerms, categories, status, notes, tenantId, createdAt, updatedAt FROM suppliers WHERE name LIKE ?';
    const params = [searchPattern];

    if (tenantId) {
      sql += ' AND tenantId = ?';
      params.push(tenantId);
    }

    // Sortare
    const sortBy = (options.sort && options.sort.name) ? 'name' : 'name';
    const sortDir = (options.sort && options.sort.name === -1) ? 'DESC' : 'ASC';
    sql += ' ORDER BY ' + sortBy + ' ' + sortDir;

    // Limit / Skip
    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
      if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
        sql += ' OFFSET ?';
        params.push(options.skip);
      }
    }

    const rows = all(sql, params);

    return Promise.resolve((rows || []).map(transformSupplierRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea furnizorilor după nume: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
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
  if (!orderData || typeof orderData !== 'object') {
    return Promise.reject(new AppError('Datele comenzii sunt invalide.', 400, 'INVALID_ORDER_DATA'));
  }

  const { supplierId, tenantId, orderNumber, items, status, notes, deliveryDate } = orderData;

  // Validare supplierId
  if (!supplierId || typeof supplierId !== 'string') {
    return Promise.reject(new AppError(
      'ID-ul furnizorului este obligatoriu.',
      400,
      'MISSING_SUPPLIER_ID'
    ));
  }

  // Validare tenantId
  if (!tenantId) {
    return Promise.reject(new AppError(
      'ID-ul tenant-ului este obligatoriu.',
      400,
      'MISSING_TENANT_ID'
    ));
  }

  // Validare orderNumber
  if (!orderNumber || typeof orderNumber !== 'string' || orderNumber.trim().length === 0) {
    return Promise.reject(new AppError(
      'Numărul comenzii este obligatoriu.',
      400,
      'MISSING_ORDER_NUMBER'
    ));
  }

  // Validare items
  const finalItems = Array.isArray(items) ? items : [];
  if (items !== undefined && !Array.isArray(items)) {
    return Promise.reject(new AppError(
      'Articolele comenzii trebuie să fie o listă.',
      400,
      'INVALID_ORDER_ITEMS'
    ));
  }

  // Validare status
  const finalStatus = status || 'draft';
  if (!isValidOrderStatus(finalStatus)) {
    return Promise.reject(new AppError(
      'Statusul comenzii "' + finalStatus + '" nu este valid. Statusuri permise: ' + VALID_ORDER_STATUSES.join(', ') + '.',
      400,
      'INVALID_ORDER_STATUS'
    ));
  }

  // Validare deliveryDate (opțional)
  const finalDeliveryDate = deliveryDate || null;
  if (finalDeliveryDate && isNaN(Date.parse(finalDeliveryDate))) {
    return Promise.reject(new AppError(
      'Data de livrare este invalidă.',
      400,
      'INVALID_DELIVERY_DATE'
    ));
  }

  // Verificare duplicat orderNumber
  try {
    const existing = get(
      'SELECT id FROM supplier_orders WHERE notes LIKE ? AND tenantId = ?',
      ['%"orderNumber":"' + orderNumber.trim() + '"%', tenantId]
    );
    if (existing) {
      return Promise.reject(new AppError(
        'Numărul comenzii "' + orderNumber + '" există deja.',
        409,
        'DUPLICATE_ORDER_NUMBER'
      ));
    }
  } catch (_e) {
    // Continuăm – eroarea la verificare nu e critică
  }

  try {
    const now = new Date().toISOString();
    const itemsJson = JSON.stringify(finalItems);
    const notesJson = buildNotes({ text: notes || '', orderNumber: orderNumber.trim() });

    const result = run(
      'INSERT INTO supplier_orders (supplierId, tenantId, orderDate, expectedDate, status, items, notes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [supplierId, tenantId, now, finalDeliveryDate, finalStatus, itemsJson, notesJson, now, now]
    );

    const newId = result.lastInsertRowid;

    const created = get(
      'SELECT id, supplierId, tenantId, orderDate, expectedDate, receivedDate, status, items, subtotal, tax, total, currency, notes, createdAt, updatedAt FROM supplier_orders WHERE id = ?',
      [newId]
    );

    return Promise.resolve(transformOrderRow(created));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la crearea comenzii: ' + err.message,
      500,
      'DB_INSERT_ERROR'
    ));
  }
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
  if (!orderData || typeof orderData !== 'object') {
    return Promise.reject(new AppError('Datele comenzii sunt invalide.', 400, 'INVALID_ORDER_DATA'));
  }

  const { supplierId, tenantId } = orderData;

  if (!supplierId || typeof supplierId !== 'string') {
    return Promise.reject(new AppError(
      'ID-ul furnizorului este obligatoriu.',
      400,
      'MISSING_SUPPLIER_ID'
    ));
  }

  if (!tenantId) {
    return Promise.reject(new AppError(
      'ID-ul tenant-ului este obligatoriu.',
      400,
      'MISSING_TENANT_ID'
    ));
  }

  // Verificăm existența furnizorului
  return findSupplierById(supplierId).then(function (supplier) {
    if (!supplier) {
      return Promise.reject(new AppError(
        'Furnizorul nu a fost găsit.',
        404,
        'SUPPLIER_NOT_FOUND'
      ));
    }

    // Verificăm că tenantId-ul furnizorului corespunde
    if (String(supplier.tenantId) !== String(tenantId)) {
      return Promise.reject(new AppError(
        'Furnizorul nu aparține acestui tenant.',
        403,
        'TENANT_MISMATCH'
      ));
    }

    // Verificăm că furnizorul nu este blacklisted
    if (supplier.status === 'blacklisted') {
      return Promise.reject(new AppError(
        'Nu se pot plasa comenzi la un furnizor blacklisted.',
        400,
        'SUPPLIER_BLACKLISTED'
      ));
    }

    // Creăm comanda efectivă
    return createSupplierOrder(orderData);
  });
}

/**
 * Găsește o comandă după ID.
 * @param {string|number} id - ID-ul comenzii
 * @returns {Promise<Object|null>}
 */
function findSupplierOrderById(id) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
  }

  try {
    const row = get(
      'SELECT id, supplierId, tenantId, orderDate, expectedDate, receivedDate, status, items, subtotal, tax, total, currency, notes, createdAt, updatedAt FROM supplier_orders WHERE id = ?',
      [id]
    );

    return Promise.resolve(transformOrderRow(row));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea comenzii: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește toate comenzile unui furnizor.
 * @param {string} supplierId - ID-ul furnizorului
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de comenzi
 */
function findOrdersBySupplier(supplierId, tenantId) {
  if (!supplierId) {
    return Promise.reject(new AppError('ID-ul furnizorului este invalid.', 400, 'INVALID_SUPPLIER_ID'));
  }

  try {
    let sql = 'SELECT id, supplierId, tenantId, orderDate, expectedDate, receivedDate, status, items, subtotal, tax, total, currency, notes, createdAt, updatedAt FROM supplier_orders WHERE supplierId = ?';
    const params = [supplierId];

    if (tenantId) {
      sql += ' AND tenantId = ?';
      params.push(tenantId);
    }

    sql += ' ORDER BY createdAt DESC';

    const rows = all(sql, params);

    return Promise.resolve((rows || []).map(transformOrderRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea comenzilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește toate comenzile dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni (sort, limit, skip)
 * @returns {Promise<Array>}
 */
function findOrdersByTenant(tenantId, options) {
  if (!options) options = {};

  if (!tenantId) {
    return Promise.reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
  }

  try {
    let sql = 'SELECT id, supplierId, tenantId, orderDate, expectedDate, receivedDate, status, items, subtotal, tax, total, currency, notes, createdAt, updatedAt FROM supplier_orders WHERE tenantId = ?';
    const params = [tenantId];

    // Sortare
    const sortBy = (options.sort && options.sort.createdAt) ? 'createdAt' : 'createdAt';
    const sortDir = (options.sort && options.sort.createdAt === 1) ? 'ASC' : 'DESC';
    sql += ' ORDER BY ' + sortBy + ' ' + sortDir;

    // Limit / Skip
    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
      if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
        sql += ' OFFSET ?';
        params.push(options.skip);
      }
    }

    const rows = all(sql, params);

    return Promise.resolve((rows || []).map(transformOrderRow));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la căutarea comenzilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Găsește comenzi la furnizori pe baza unor filtre flexibile (adapter).
 * Suportă două forme de apel:
 *   1. findSupplierOrders(filters) – unde filters este un obiect
 *   2. findSupplierOrders(supplierId, options) – backward compat cu rutele
 *
 * @param {Object|string} filtersOrSupplierId - Criterii de filtrare (obiect) sau supplierId (string)
 * @param {Object} [maybeOptions] - Opțiuni (doar când primul argument e supplierId)
 * @returns {Promise<Array>} Lista de comenzi găsite
 */
function findSupplierOrders(filtersOrSupplierId, maybeOptions) {
  // Detectare formă de apel
  let filters;
  if (typeof filtersOrSupplierId === 'string') {
    // Forma: findSupplierOrders(supplierId, options)
    const opts = maybeOptions || {};
    filters = {
      supplierId: filtersOrSupplierId,
      tenantId: opts.tenantId || undefined,
      status: opts.statusFilter || opts.status || undefined,
      search: opts.search || undefined,
      dateFrom: opts.dateFrom || undefined,
      dateTo: opts.dateTo || undefined,
      options: {
        sort: opts.sort || undefined,
        limit: opts.limit || undefined,
        skip: opts.skip || undefined,
      },
    };
  } else {
    filters = filtersOrSupplierId || {};
  }

  try {
    let sql = 'SELECT id, supplierId, tenantId, orderDate, expectedDate, receivedDate, status, items, subtotal, tax, total, currency, notes, createdAt, updatedAt FROM supplier_orders';
    const conditions = [];
    const params = [];

    // Filtru după supplierId
    if (filters.supplierId) {
      conditions.push('supplierId = ?');
      params.push(filters.supplierId);
    }

    // Filtru după tenantId
    if (filters.tenantId) {
      conditions.push('tenantId = ?');
      params.push(filters.tenantId);
    }

    // Filtru după status
    if (filters.status) {
      if (!isValidOrderStatus(filters.status)) {
        return Promise.reject(new AppError(
          'Statusul "' + filters.status + '" nu este valid. Statusuri permise: ' + VALID_ORDER_STATUSES.join(', ') + '.',
          400,
          'INVALID_ORDER_STATUS'
        ));
      }
      conditions.push('status = ?');
      params.push(filters.status);
    }

    // Filtru după search (orderNumber stocat în notes JSON)
    if (filters.search && typeof filters.search === 'string' && filters.search.trim().length > 0) {
      conditions.push('notes LIKE ?');
      params.push('%"orderNumber":"%' + filters.search.trim() + '%"');
    }

    // Filtru după interval de date
    if (filters.dateFrom) {
      const fromDate = new Date(filters.dateFrom);
      if (isNaN(fromDate.getTime())) {
        return Promise.reject(new AppError(
          'Data de început (dateFrom) este invalidă.',
          400,
          'INVALID_DATE_FROM'
        ));
      }
      conditions.push('createdAt >= ?');
      params.push(fromDate.toISOString());
    }

    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo);
      if (isNaN(toDate.getTime())) {
        return Promise.reject(new AppError(
          'Data de sfârșit (dateTo) este invalidă.',
          400,
          'INVALID_DATE_TO'
        ));
      }
      conditions.push('createdAt <= ?');
      params.push(toDate.toISOString());
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    // Sortare
    const options = filters.options || {};
    const sortBy = (options.sort && options.sort.createdAt) ? 'createdAt' : 'createdAt';
    const sortDir = (options.sort && options.sort.createdAt === 1) ? 'ASC' : 'DESC';
    sql += ' ORDER BY ' + sortBy + ' ' + sortDir;

    // Limit / Skip
    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
      if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
        sql += ' OFFSET ?';
        params.push(options.skip);
      }
    }

    const rows = all(sql, params);

    return Promise.resolve((rows || []).map(transformOrderRow));
  } catch (err) {
    if (err instanceof AppError) return Promise.reject(err);
    return Promise.reject(new AppError(
      'Eroare la căutarea comenzilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Actualizează o comandă după ID.
 * @param {string|number} id - ID-ul comenzii
 * @param {Object} updateData - Câmpurile de actualizat
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateSupplierOrder(id, updateData) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
  }

  if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
    return Promise.reject(new AppError(
      'Nu s-au furnizat date pentru actualizare.',
      400,
      'EMPTY_UPDATE_DATA'
    ));
  }

  const allowedFields = ['items', 'status', 'notes', 'deliveryDate'];
  const setClauses = [];
  const params = [];
  const errors = [];

  for (const key of Object.keys(updateData)) {
    const value = updateData[key];
    if (!allowedFields.includes(key)) {
      continue;
    }

    switch (key) {
      case 'items':
        if (!Array.isArray(value)) {
          errors.push('Articolele comenzii trebuie să fie o listă.');
        } else {
          setClauses.push('items = ?');
          params.push(JSON.stringify(value));
        }
        break;

      case 'status':
        if (!isValidOrderStatus(value)) {
          errors.push('Statusul "' + value + '" nu este valid.');
        } else {
          setClauses.push('status = ?');
          params.push(value);
        }
        break;

      case 'notes':
        // Actualizăm doar textul din notes, păstrând orderNumber
        try {
          const existing = get('SELECT notes FROM supplier_orders WHERE id = ?', [id]);
          if (existing) {
            const existingNotes = parseNotes(existing.notes);
            const updatedNotes = buildNotes({ text: value || '', orderNumber: existingNotes.orderNumber });
            setClauses.push('notes = ?');
            params.push(updatedNotes);
          } else {
            setClauses.push('notes = ?');
            params.push(buildNotes({ text: value || '' }));
          }
        } catch (_e) {
          setClauses.push('notes = ?');
          params.push(buildNotes({ text: value || '' }));
        }
        break;

      case 'deliveryDate':
        if (value && isNaN(Date.parse(value))) {
          errors.push('Data de livrare este invalidă.');
        } else {
          setClauses.push('expectedDate = ?');
          params.push(value || null);
        }
        break;
    }
  }

  if (errors.length > 0) {
    return Promise.reject(new AppError(errors.join(' '), 400, 'VALIDATION_ERROR'));
  }

  if (setClauses.length === 0) {
    return Promise.reject(new AppError(
      'Nu s-au furnizat câmpuri valide pentru actualizare.',
      400,
      'NO_VALID_FIELDS'
    ));
  }

  const now = new Date().toISOString();
  setClauses.push('updatedAt = ?');
  params.push(now);

  params.push(id);

  try {
    const result = run(
      'UPDATE supplier_orders SET ' + setClauses.join(', ') + ' WHERE id = ?',
      params
    );

    if (result.changes === 0) {
      return Promise.reject(new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND'));
    }

    const updated = get(
      'SELECT id, supplierId, tenantId, orderDate, expectedDate, receivedDate, status, items, subtotal, tax, total, currency, notes, createdAt, updatedAt FROM supplier_orders WHERE id = ?',
      [id]
    );

    return Promise.resolve(transformOrderRow(updated));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la actualizarea comenzii: ' + err.message,
      500,
      'DB_UPDATE_ERROR'
    ));
  }
}

/**
 * Actualizează statusul unei comenzi.
 * @param {string|number} id - ID-ul comenzii
 * @param {string} status - Noul status
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateOrderStatus(id, status) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
  }

  if (!status || !isValidOrderStatus(status)) {
    return Promise.reject(new AppError(
      'Statusul "' + status + '" nu este valid. Statusuri permise: ' + VALID_ORDER_STATUSES.join(', ') + '.',
      400,
      'INVALID_ORDER_STATUS'
    ));
  }

  try {
    const now = new Date().toISOString();

    const result = run(
      'UPDATE supplier_orders SET status = ?, updatedAt = ? WHERE id = ?',
      [status, now, id]
    );

    if (result.changes === 0) {
      return Promise.reject(new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND'));
    }

    const updated = get(
      'SELECT id, supplierId, tenantId, orderDate, expectedDate, receivedDate, status, items, subtotal, tax, total, currency, notes, createdAt, updatedAt FROM supplier_orders WHERE id = ?',
      [id]
    );

    return Promise.resolve(transformOrderRow(updated));
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la actualizarea statusului comenzii: ' + err.message,
      500,
      'DB_UPDATE_ERROR'
    ));
  }
}

/**
 * Șterge o comandă după ID.
 * @param {string|number} id - ID-ul comenzii
 * @returns {Promise<boolean>} true dacă a fost ștearsă
 */
function deleteSupplierOrder(id) {
  if (!id) {
    return Promise.reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
  }

  try {
    const result = run(
      'DELETE FROM supplier_orders WHERE id = ?',
      [id]
    );

    if (result.changes === 0) {
      return Promise.reject(new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND'));
    }

    return Promise.resolve(true);
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la ștergerea comenzii: ' + err.message,
      500,
      'DB_DELETE_ERROR'
    ));
  }
}

/**
 * Obține numărul total de comenzi pentru un furnizor.
 * @param {string} supplierId - ID-ul furnizorului
 * @returns {Promise<number>}
 */
function countOrdersBySupplier(supplierId) {
  if (!supplierId) {
    return Promise.resolve(0);
  }

  try {
    const row = get(
      'SELECT COUNT(*) AS cnt FROM supplier_orders WHERE supplierId = ?',
      [supplierId]
    );

    return Promise.resolve(row ? row.cnt : 0);
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la numărarea comenzilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    ));
  }
}

/**
 * Numără comenzi la furnizori pe baza unor filtre flexibile (adapter).
 * Suportă două forme de apel:
 *   1. countSupplierOrders(filters) – unde filters este un obiect
 *   2. countSupplierOrders(supplierId, status) – backward compat
 *
 * @param {Object|string} filtersOrSupplierId - Criterii de filtrare sau supplierId
 * @param {string} [maybeStatus] - Status (doar când primul argument e supplierId)
 * @returns {Promise<number>} Numărul de comenzi
 */
function countSupplierOrders(filtersOrSupplierId, maybeStatus) {
  // Detectare formă de apel
  let filters;
  if (typeof filtersOrSupplierId === 'string') {
    filters = {
      supplierId: filtersOrSupplierId,
      status: maybeStatus || undefined,
    };
  } else {
    filters = filtersOrSupplierId || {};
  }

  try {
    let sql = 'SELECT COUNT(*) AS cnt FROM supplier_orders';
    const conditions = [];
    const params = [];

    if (filters.supplierId) {
      conditions.push('supplierId = ?');
      params.push(filters.supplierId);
    }

    if (filters.tenantId) {
      conditions.push('tenantId = ?');
      params.push(filters.tenantId);
    }

    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const row = get(sql, params);

    return Promise.resolve(row ? row.cnt : 0);
  } catch (err) {
    return Promise.reject(new AppError(
      'Eroare la numărarea comenzilor: ' + err.message,
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

  // Instanțe DB (backward compat – returnează getDb())
  getSuppliersDb: function () { return getDb(); },
  getSupplierOrdersDb: function () { return getDb(); },

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