'use strict';

// ---------------------------------------------------------------------------
// Model Coupon – GastroHub
// Model pentru cupoane de reducere generate automat
// Suportă: generare automată de cupoane cu cod unic, validare, expirare,
// aplicare discount, anulare, istoric, reguli de utilizare
// Persistență: SQLite via sql.js (config/db) – tabela coupons
// ---------------------------------------------------------------------------

const { getDb, run, get, all } = require('../config/db');

// ---------------------------------------------------------------------------
// Configurare implicită
// ---------------------------------------------------------------------------

const COUPON_CONFIG = {
  CODE_PREFIX: 'GH',
  CODE_LENGTH: 8,
  MIN_CODE_LENGTH: 4,
  MAX_CODE_LENGTH: 30,
  DEFAULT_DISCOUNT_PERCENT: 10,
  MIN_DISCOUNT_PERCENT: 1,
  MAX_DISCOUNT_PERCENT: 100,
  DEFAULT_VALIDITY_DAYS: 90,
  MAX_VALIDITY_DAYS: 365,
  MIN_VALIDITY_DAYS: 1,
  MAX_ACTIVE_COUPONS_PER_USER: 10,
  MIN_ORDER_AMOUNT: 1,
};

// ---------------------------------------------------------------------------
// Statusuri valide pentru cupoane
// ---------------------------------------------------------------------------

const VALID_COUPON_STATUSES = ['active', 'used', 'expired', 'cancelled'];

// ---------------------------------------------------------------------------
// Tipuri de discount suportate
// ---------------------------------------------------------------------------

const VALID_DISCOUNT_TYPES = ['percent', 'fixed'];

// ---------------------------------------------------------------------------
// Asigură existența tabelei coupons (idempotent)
// ---------------------------------------------------------------------------

let _tablesEnsured = false;

function ensureTables() {
  if (_tablesEnsured) return;
  run(`
    CREATE TABLE IF NOT EXISTS coupons (
      id                TEXT PRIMARY KEY,
      code              TEXT NOT NULL UNIQUE,
      userId            TEXT NOT NULL,
      discountType      TEXT NOT NULL DEFAULT 'percent',
      discountValue     REAL NOT NULL DEFAULT 10,
      validityDays      INTEGER NOT NULL DEFAULT 90,
      minOrderAmount    REAL,
      maxUsageCount     INTEGER NOT NULL DEFAULT 1,
      currentUsageCount INTEGER NOT NULL DEFAULT 0,
      description       TEXT DEFAULT '',
      restaurantId      TEXT,
      hotelId           TEXT,
      createdBy         TEXT,
      status            TEXT NOT NULL DEFAULT 'active',
      createdAt         TEXT DEFAULT (datetime('now')),
      updatedAt         TEXT DEFAULT (datetime('now')),
      expiresAt         TEXT,
      usedAt            TEXT,
      usedOnOrders      TEXT DEFAULT '[]',
      cancelledAt       TEXT,
      cancelledBy       TEXT,
      cancelledReason   TEXT DEFAULT ''
    );
  `);
  run('CREATE INDEX IF NOT EXISTS idx_coupons_userId ON coupons(userId);');
  run('CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);');
  run('CREATE INDEX IF NOT EXISTS idx_coupons_status ON coupons(status);');
  run('CREATE INDEX IF NOT EXISTS idx_coupons_userId_status ON coupons(userId, status);');
  _tablesEnsured = true;
}

// ---------------------------------------------------------------------------
// Generator intern de ID-uri unice (înlocuiește uuid)
// ---------------------------------------------------------------------------

/**
 * Generează un ID unic fără dependențe externe.
 * Bazat pe timestamp și entropie Math.random.
 * @returns {string} ID unic
 */
function generateId() {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).substring(2, 10) +
    '-' +
    Math.random().toString(36).substring(2, 6)
  );
}

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Validează un ID de utilizator.
 * @param {*} userId
 * @returns {boolean}
 */
function isValidUserId(userId) {
  return typeof userId === 'string' && userId.trim().length > 0 && userId.trim().length <= 100;
}

/**
 * Validează un cod de cupon.
 * @param {string} code
 * @returns {boolean}
 */
function isValidCouponCode(code) {
  if (typeof code !== 'string') return false;
  const trimmed = code.trim();
  return trimmed.length >= COUPON_CONFIG.MIN_CODE_LENGTH && trimmed.length <= COUPON_CONFIG.MAX_CODE_LENGTH;
}

/**
 * Validează un procentaj de discount.
 * @param {number} percent
 * @returns {boolean}
 */
function isValidDiscountPercent(percent) {
  return typeof percent === 'number' && Number.isFinite(percent) && percent >= COUPON_CONFIG.MIN_DISCOUNT_PERCENT && percent <= COUPON_CONFIG.MAX_DISCOUNT_PERCENT;
}

/**
 * Validează o sumă fixă de discount.
 * @param {number} amount
 * @returns {boolean}
 */
function isValidDiscountAmount(amount) {
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0;
}

/**
 * Validează un tip de discount.
 * @param {string} type
 * @returns {boolean}
 */
function isValidDiscountType(type) {
  return VALID_DISCOUNT_TYPES.includes(type);
}

/**
 * Validează un status de cupon.
 * @param {string} status
 * @returns {boolean}
 */
function isValidCouponStatus(status) {
  return VALID_COUPON_STATUSES.includes(status);
}

/**
 * Validează o valoare numerică pozitivă finită.
 * @param {*} value
 * @returns {boolean}
 */
function isValidPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Validează o valoare numerică nenegativă finită.
 * @param {*} value
 * @returns {boolean}
 */
function isValidNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Verifică dacă un număr de zile de valabilitate este valid.
 * @param {number} days
 * @returns {boolean}
 */
function isValidValidityDays(days) {
  return Number.isInteger(days) && days >= COUPON_CONFIG.MIN_VALIDITY_DAYS && days <= COUPON_CONFIG.MAX_VALIDITY_DAYS;
}

/**
 * Verifică dacă un număr este un întreg nenegativ.
 * @param {*} val
 * @returns {boolean}
 */
function isValidNonNegativeInt(val) {
  return Number.isInteger(val) && val >= 0;
}

/**
 * Verifică dacă un cupon este expirat.
 * @param {Object} coupon
 * @returns {boolean}
 */
function isCouponExpired(coupon) {
  if (!coupon.expiresAt) return false;
  const now = new Date();
  const expiresAt = new Date(coupon.expiresAt);
  return expiresAt < now;
}

/**
 * Verifică dacă un cupon a fost deja folosit.
 * @param {Object} coupon
 * @returns {boolean}
 */
function isCouponUsed(coupon) {
  return coupon.status === 'used';
}

/**
 * Verifică dacă un cupon este anulat.
 * @param {Object} coupon
 * @returns {boolean}
 */
function isCouponCancelled(coupon) {
  return coupon.status === 'cancelled';
}

/**
 * Verifică dacă un cupon este activ (status active și neexpirat).
 * @param {Object} coupon
 * @returns {boolean}
 */
function isCouponActive(coupon) {
  return coupon.status === 'active' && !isCouponExpired(coupon);
}

// ---------------------------------------------------------------------------
// Funcții utilitare
// ---------------------------------------------------------------------------

/**
 * Calculează data de expirare pe baza numărului de zile.
 * @param {number} validityDays - Numărul de zile de valabilitate
 * @returns {string} Data de expirare în ISO string
 */
function calculateExpiryDate(validityDays = COUPON_CONFIG.DEFAULT_VALIDITY_DAYS) {
  if (!isValidValidityDays(validityDays)) {
    validityDays = COUPON_CONFIG.DEFAULT_VALIDITY_DAYS;
  }
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + validityDays);
  return expiryDate.toISOString();
}

/**
 * Generează un cod unic de cupon.
 * @param {string} [prefix] - Prefix pentru cod (implicit COUPON_CONFIG.CODE_PREFIX)
 * @returns {string} Codul cuponului
 */
function generateCouponCode(prefix = COUPON_CONFIG.CODE_PREFIX) {
  const unique = generateId().replace(/-/g, '').substring(0, COUPON_CONFIG.CODE_LENGTH).toUpperCase();
  return `${prefix}-${unique}`;
}

/**
 * Normalizează un cod de cupon (trim, upperCase).
 * @param {string} code
 * @returns {string}
 */
function normalizeCouponCode(code) {
  if (typeof code !== 'string') return '';
  return code.trim().toUpperCase();
}

/**
 * Parses the usedOnOrders JSON field into an array.
 * @param {Object} row - Database row
 * @returns {Object} Row with parsed usedOnOrders
 */
function parseUsedOnOrders(row) {
  if (!row) return row;
  if (typeof row.usedOnOrders === 'string') {
    try {
      row.usedOnOrders = JSON.parse(row.usedOnOrders);
    } catch (_) {
      row.usedOnOrders = [];
    }
  }
  return row;
}

// ---------------------------------------------------------------------------
// Operații CRUD Cupoane
// ---------------------------------------------------------------------------

/**
 * Creează un cupon de reducere.
 *
 * @param {Object} options - Opțiuni pentru crearea cuponului
 * @param {string} options.userId - ID-ul utilizatorului (obligatoriu)
 * @param {string} [options.code] - Cod personalizat (opțional, se generează automat dacă lipsește)
 * @param {string} [options.discountType='percent'] - Tipul de discount ('percent' sau 'fixed')
 * @param {number} [options.discountValue=10] - Valoarea discountului (procent sau sumă fixă)
 * @param {number} [options.validityDays=90] - Zile de valabilitate
 * @param {number} [options.minOrderAmount] - Suma minimă a comenzii pentru aplicare
 * @param {number} [options.maxUsageCount=1] - Numărul maxim de utilizări
 * @param {string} [options.description] - Descrierea cuponului
 * @param {string} [options.restaurantId] - ID-ul restaurantului (dacă e specific)
 * @param {string} [options.hotelId] - ID-ul hotelului (dacă e specific)
 * @param {string} [options.createdBy] - Cine a creat cuponul (userId sau 'system')
 * @returns {Promise<Object>} Cuponul creat
 * @throws {Error} Dacă validarea eșuează
 */
function createCoupon(options = {}) {
  return new Promise((resolve, reject) => {
    try {
      // --- Validare userId ---
      if (!options.userId || !isValidUserId(options.userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      // --- Validare discountType ---
      const discountType = options.discountType || 'percent';
      if (!isValidDiscountType(discountType)) {
        return reject(new Error(`Tipul de discount trebuie să fie 'percent' sau 'fixed'.`));
      }

      // --- Validare discountValue ---
      let discountValue = options.discountValue !== undefined ? options.discountValue : COUPON_CONFIG.DEFAULT_DISCOUNT_PERCENT;
      if (discountType === 'percent') {
        if (!isValidDiscountPercent(discountValue)) {
          return reject(new Error(`Procentajul de discount trebuie să fie între ${COUPON_CONFIG.MIN_DISCOUNT_PERCENT} și ${COUPON_CONFIG.MAX_DISCOUNT_PERCENT}.`));
        }
      } else {
        if (!isValidDiscountAmount(discountValue)) {
          return reject(new Error('Suma discountului trebuie să fie un număr pozitiv.'));
        }
      }

      // --- Validare validityDays ---
      const validityDays = options.validityDays !== undefined ? options.validityDays : COUPON_CONFIG.DEFAULT_VALIDITY_DAYS;
      if (!isValidValidityDays(validityDays)) {
        return reject(new Error(`Valabilitatea trebuie să fie între ${COUPON_CONFIG.MIN_VALIDITY_DAYS} și ${COUPON_CONFIG.MAX_VALIDITY_DAYS} zile.`));
      }

      // --- Validare minOrderAmount ---
      if (options.minOrderAmount !== undefined && !isValidPositiveNumber(options.minOrderAmount)) {
        return reject(new Error('Suma minimă a comenzii trebuie să fie un număr pozitiv.'));
      }

      // --- Validare maxUsageCount ---
      const maxUsageCount = options.maxUsageCount !== undefined ? options.maxUsageCount : 1;
      if (!isValidNonNegativeInt(maxUsageCount)) {
        return reject(new Error('Numărul maxim de utilizări trebuie să fie un număr întreg mai mare sau egal cu 0.'));
      }

      ensureTables();

      // --- Generare cod cupon ---
      let couponCode;
      if (options.code) {
        if (!isValidCouponCode(options.code)) {
          return reject(new Error(`Codul cuponului trebuie să aibă între ${COUPON_CONFIG.MIN_CODE_LENGTH} și ${COUPON_CONFIG.MAX_CODE_LENGTH} caractere.`));
        }
        couponCode = normalizeCouponCode(options.code);
        // Verificăm unicitatea codului
        const existing = get('SELECT id FROM coupons WHERE code = ?', [couponCode]);
        if (existing) {
          return reject(new Error('Codul cuponului există deja.'));
        }
      } else {
        // Generăm cod unic
        do {
          couponCode = generateCouponCode();
        } while (get('SELECT id FROM coupons WHERE code = ?', [couponCode]));
      }

      // --- Creare cupon ---
      const id = generateId();
      const userId = options.userId.trim();
      const now = new Date().toISOString();
      const expiresAt = calculateExpiryDate(validityDays);

      run(
        `INSERT INTO coupons (
          id, code, userId, discountType, discountValue, validityDays,
          minOrderAmount, maxUsageCount, currentUsageCount, description,
          restaurantId, hotelId, createdBy, status, createdAt, updatedAt, expiresAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        [
          id, couponCode, userId, discountType, discountValue, validityDays,
          options.minOrderAmount || null, maxUsageCount,
          options.description || '', options.restaurantId || null,
          options.hotelId || null, options.createdBy || userId,
          now, now, expiresAt
        ]
      );

      const coupon = get('SELECT * FROM coupons WHERE id = ?', [id]);
      resolve(parseUsedOnOrders(coupon));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Obține un cupon după ID.
 * @param {string} couponId
 * @returns {Promise<Object>}
 * @throws {Error} Dacă cuponul nu există
 */
function getCouponById(couponId) {
  return new Promise((resolve, reject) => {
    try {
      if (!couponId || typeof couponId !== 'string') {
        return reject(new Error('ID-ul cuponului este invalid.'));
      }

      ensureTables();

      const coupon = get('SELECT * FROM coupons WHERE id = ?', [couponId]);
      if (!coupon) {
        return reject(new Error('Cuponul nu a fost găsit.'));
      }

      resolve(parseUsedOnOrders(coupon));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Obține un cupon după cod.
 * @param {string} code - Codul cuponului
 * @returns {Promise<Object>}
 * @throws {Error} Dacă codul este invalid sau cuponul nu există
 */
function getCouponByCode(code) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidCouponCode(code)) {
        return reject(new Error(`Codul cuponului este invalid (minim ${COUPON_CONFIG.MIN_CODE_LENGTH} caractere, maxim ${COUPON_CONFIG.MAX_CODE_LENGTH}).`));
      }

      ensureTables();

      const normalizedCode = normalizeCouponCode(code);
      const coupon = get('SELECT * FROM coupons WHERE code = ?', [normalizedCode]);

      if (!coupon) {
        return reject(new Error('Cuponul nu a fost găsit.'));
      }

      resolve(parseUsedOnOrders(coupon));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Validează un cupon pentru utilizare.
 *
 * Verificări:
 *  - Codul cuponului există
 *  - Cuponul aparține utilizatorului
 *  - Cuponul nu este expirat
 *  - Cuponul nu a fost deja folosit
 *  - Cuponul nu este anulat
 *  - Suma comenzii depășește minimul (dacă e configurat)
 *  - Numărul de utilizări nu a fost epuizat
 *
 * @param {string} code - Codul cuponului
 * @param {string} userId - ID-ul utilizatorului
 * @param {Object} [options] - Opțiuni adiționale de validare
 * @param {number} [options.orderAmount] - Suma comenzii (pentru validare minOrderAmount)
 * @returns {Promise<Object>} Cuponul validat
 * @throws {Error} Dacă cuponul nu este valid
 */
function validateCoupon(code, userId, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidCouponCode(code)) {
        return reject(new Error('Codul cuponului este invalid.'));
      }

      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const normalizedCode = normalizeCouponCode(code);
      const coupon = get('SELECT * FROM coupons WHERE code = ?', [normalizedCode]);

      if (!coupon) {
        return reject(new Error('Cuponul nu există.'));
      }

      if (coupon.userId !== userId) {
        return reject(new Error('Acest cupon nu aparține utilizatorului curent.'));
      }

      // Verificare expirare
      if (isCouponExpired(coupon)) {
        return reject(new Error('Cuponul a expirat.'));
      }

      // Verificare status used
      if (isCouponUsed(coupon)) {
        return reject(new Error('Cuponul a fost deja folosit.'));
      }

      // Verificare status cancelled
      if (isCouponCancelled(coupon)) {
        return reject(new Error('Cuponul a fost anulat.'));
      }

      // Verificare limită de utilizări
      if (coupon.maxUsageCount > 0 && coupon.currentUsageCount >= coupon.maxUsageCount) {
        return reject(new Error('Cuponul și-a epuizat numărul maxim de utilizări.'));
      }

      // Verificare sumă minimă comandă
      if (options.orderAmount !== undefined) {
        if (!isValidPositiveNumber(options.orderAmount)) {
          return reject(new Error('Suma comenzii trebuie să fie un număr pozitiv.'));
        }
        if (coupon.minOrderAmount !== null && options.orderAmount < coupon.minOrderAmount) {
          return reject(new Error(`Suma minimă a comenzii pentru acest cupon este de ${coupon.minOrderAmount}.`));
        }
      }

      resolve(parseUsedOnOrders(coupon));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Folosește un cupon (incrementează contorul de utilizări).
 *
 * @param {string} code - Codul cuponului
 * @param {string} userId - ID-ul utilizatorului
 * @param {Object} [orderDetails] - Detalii despre comandă
 * @param {string} [orderDetails.orderId] - ID-ul comenzii
 * @param {number} [orderDetails.orderAmount] - Suma comenzii
 * @returns {Promise<Object>} Cuponul actualizat
 * @throws {Error} Dacă cuponul nu poate fi folosit
 */
async function useCoupon(code, userId, orderDetails = {}) {
  let coupon;
  try {
    coupon = await validateCoupon(code, userId, { orderAmount: orderDetails.orderAmount });
  } catch (err) {
    throw err;
  }

  return new Promise((resolve, reject) => {
    try {
      ensureTables();

      const now = new Date().toISOString();
      const newCount = coupon.currentUsageCount + 1;

      // Actualizăm usedOnOrders
      let usedOnOrders = [];
      if (typeof coupon.usedOnOrders === 'string') {
        try { usedOnOrders = JSON.parse(coupon.usedOnOrders); } catch (_) { usedOnOrders = []; }
      } else if (Array.isArray(coupon.usedOnOrders)) {
        usedOnOrders = coupon.usedOnOrders;
      }

      if (orderDetails.orderId) {
        usedOnOrders.push({
          orderId: orderDetails.orderId,
          usedAt: now,
          orderAmount: orderDetails.orderAmount || null,
        });
      }

      // Dacă s-a atins maxUsageCount, marcăm ca used
      if (coupon.maxUsageCount > 0 && newCount >= coupon.maxUsageCount) {
        run(
          'UPDATE coupons SET currentUsageCount = ?, status = ?, usedAt = ?, usedOnOrders = ?, updatedAt = ? WHERE id = ?',
          [newCount, 'used', now, JSON.stringify(usedOnOrders), now, coupon.id]
        );
      } else {
        run(
          'UPDATE coupons SET currentUsageCount = ?, usedOnOrders = ?, updatedAt = ? WHERE id = ?',
          [newCount, JSON.stringify(usedOnOrders), now, coupon.id]
        );
      }

      const updated = get('SELECT * FROM coupons WHERE id = ?', [coupon.id]);
      resolve(parseUsedOnOrders(updated));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Anulează un cupon activ.
 *
 * @param {string} code - Codul cuponului
 * @param {string} userId - ID-ul utilizatorului
 * @param {string} [reason] - Motivul anulării
 * @returns {Promise<Object>} Cuponul actualizat
 * @throws {Error} Dacă cuponul nu poate fi anulat
 */
function cancelCoupon(code, userId, reason = '') {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidCouponCode(code)) {
        return reject(new Error('Codul cuponului este invalid.'));
      }

      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const normalizedCode = normalizeCouponCode(code);
      const coupon = get('SELECT * FROM coupons WHERE code = ?', [normalizedCode]);

      if (!coupon) {
        return reject(new Error('Cuponul nu există.'));
      }

      if (coupon.userId !== userId) {
        return reject(new Error('Acest cupon nu aparține utilizatorului curent.'));
      }

      if (coupon.status !== 'active') {
        return reject(new Error('Doar cupoanele cu status "active" pot fi anulate.'));
      }

      if (isCouponExpired(coupon)) {
        return reject(new Error('Cuponul a expirat deja și nu mai poate fi anulat.'));
      }

      // Anulare cupon
      const now = new Date().toISOString();
      run(
        'UPDATE coupons SET status = ?, cancelledAt = ?, cancelledBy = ?, cancelledReason = ?, updatedAt = ? WHERE id = ?',
        ['cancelled', now, userId, reason || '', now, coupon.id]
      );

      const updated = get('SELECT * FROM coupons WHERE id = ?', [coupon.id]);
      resolve(parseUsedOnOrders(updated));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Calculează discountul aplicat pe baza cuponului și a sumei.
 *
 * @param {string} couponCode - Codul cuponului
 * @param {number} orderAmount - Suma comenzii
 * @param {string} userId - ID-ul utilizatorului
 * @returns {Promise<Object>} Detalii discount
 * @throws {Error} Dacă validarea eșuează
 */
async function calculateDiscount(couponCode, orderAmount, userId) {
  if (!isValidPositiveNumber(orderAmount)) {
    throw new Error('Suma comenzii trebuie să fie un număr pozitiv.');
  }

  let coupon;
  try {
    coupon = await validateCoupon(couponCode, userId, { orderAmount });
  } catch (err) {
    throw err;
  }

  let discountAmount;
  if (coupon.discountType === 'percent') {
    discountAmount = (orderAmount * coupon.discountValue) / 100;
  } else {
    discountAmount = coupon.discountValue;
    // Discountul fix nu poate depăși suma comenzii
    if (discountAmount > orderAmount) {
      discountAmount = orderAmount;
    }
  }

  const finalAmount = orderAmount - discountAmount;

  return {
    originalAmount: orderAmount,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    discountAmount: Math.round(discountAmount * 100) / 100,
    finalAmount: Math.round(finalAmount * 100) / 100,
    couponCode: coupon.code,
  };
}

/**
 * Obține toate cupoanele active ale unui utilizator.
 *
 * @param {string} userId
 * @returns {Promise<Array>} Lista cupoanelor active
 */
function getActiveCoupons(userId) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const now = new Date().toISOString();
      const rows = all(
        "SELECT * FROM coupons WHERE userId = ? AND status = 'active' AND expiresAt > ? ORDER BY expiresAt ASC",
        [userId, now]
      );

      resolve(rows.map(r => parseUsedOnOrders(r)));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Obține toate cupoanele unui utilizator (toate statusurile).
 *
 * @param {string} userId
 * @param {Object} [options]
 * @param {string} [options.status] - Filtrare după status
 * @param {string} [options.sortBy='createdAt'] - Câmpul de sortare
 * @param {string} [options.sortOrder='desc'] - Direcția de sortare
 * @returns {Promise<Array>} Lista cupoanelor
 */
function getAllCouponsForUser(userId, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      let sql = 'SELECT * FROM coupons WHERE userId = ?';
      const params = [userId];

      // Filtrare după status
      if (options.status) {
        if (!isValidCouponStatus(options.status)) {
          return reject(new Error(`Statusul "${options.status}" nu este valid.`));
        }
        sql += ' AND status = ?';
        params.push(options.status);
      }

      // Sortare
      const sortBy = options.sortBy || 'createdAt';
      const sortOrder = (options.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      const validSortFields = ['createdAt', 'updatedAt', 'expiresAt', 'discountValue', 'status'];

      if (validSortFields.includes(sortBy)) {
        sql += ` ORDER BY ${sortBy} ${sortOrder}`;
      } else {
        sql += ' ORDER BY createdAt DESC';
      }

      const rows = all(sql, params);
      resolve(rows.map(r => parseUsedOnOrders(r)));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Marchează automat cupoanele expirate (curează statusul).
 *
 * @param {string} userId
 * @returns {Promise<number>} Numărul de cupoane marcate ca expirate
 */
function cleanupExpiredCoupons(userId) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const now = new Date().toISOString();
      const result = run(
        "UPDATE coupons SET status = 'expired', updatedAt = ? WHERE userId = ? AND status = 'active' AND expiresAt <= ?",
        [now, userId, now]
      );

      resolve(result.changes || 0);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Extinde valabilitatea unui cupon activ.
 *
 * @param {string} code - Codul cuponului
 * @param {string} userId - ID-ul utilizatorului
 * @param {number} extraDays - Numărul de zile adiționale
 * @returns {Promise<Object>} Cuponul actualizat
 * @throws {Error} Dacă validarea eșuează
 */
function extendCouponValidity(code, userId, extraDays) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidCouponCode(code)) {
        return reject(new Error('Codul cuponului este invalid.'));
      }

      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      if (!isValidNonNegativeInt(extraDays) || extraDays < 1) {
        return reject(new Error('Numărul de zile adiționale trebuie să fie un număr întreg pozitiv.'));
      }

      if (extraDays > COUPON_CONFIG.MAX_VALIDITY_DAYS) {
        return reject(new Error(`Nu se pot adăuga mai mult de ${COUPON_CONFIG.MAX_VALIDITY_DAYS} zile.`));
      }

      ensureTables();

      const normalizedCode = normalizeCouponCode(code);
      const coupon = get('SELECT * FROM coupons WHERE code = ?', [normalizedCode]);

      if (!coupon) {
        return reject(new Error('Cuponul nu există.'));
      }

      if (coupon.userId !== userId) {
        return reject(new Error('Acest cupon nu aparține utilizatorului curent.'));
      }

      if (coupon.status !== 'active') {
        return reject(new Error('Doar cupoanele active pot fi extinse.'));
      }

      // Extindem expirarea
      const currentExpiry = new Date(coupon.expiresAt);
      currentExpiry.setDate(currentExpiry.getDate() + extraDays);
      const newExpiresAt = currentExpiry.toISOString();
      const newValidityDays = coupon.validityDays + extraDays;
      const now = new Date().toISOString();

      run(
        'UPDATE coupons SET expiresAt = ?, validityDays = ?, updatedAt = ? WHERE id = ?',
        [newExpiresAt, newValidityDays, now, coupon.id]
      );

      const updated = get('SELECT * FROM coupons WHERE id = ?', [coupon.id]);
      const result = parseUsedOnOrders(updated);
      result.extraDays = extraDays;
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Obține statistici despre cupoanele unui utilizator.
 *
 * @param {string} userId
 * @returns {Promise<Object>} Statistici
 */
function getCouponStats(userId) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const now = new Date().toISOString();

      const total = get('SELECT COUNT(*) as count FROM coupons WHERE userId = ?', [userId]);
      const active = get("SELECT COUNT(*) as count FROM coupons WHERE userId = ? AND status = 'active' AND expiresAt > ?", [userId, now]);
      const used = get("SELECT COUNT(*) as count FROM coupons WHERE userId = ? AND status = 'used'", [userId]);
      const expired = get("SELECT COUNT(*) as count FROM coupons WHERE userId = ? AND (status = 'expired' OR (status = 'active' AND expiresAt <= ?))", [userId, now]);
      const cancelled = get("SELECT COUNT(*) as count FROM coupons WHERE userId = ? AND status = 'cancelled'", [userId]);
      const discountSum = get("SELECT COALESCE(SUM(discountValue), 0) as total FROM coupons WHERE userId = ? AND status = 'used'", [userId]);

      resolve({
        total: total.count,
        active: active.count,
        used: used.count,
        expired: expired.count,
        cancelled: cancelled.count,
        totalDiscountValue: discountSum.total,
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Șterge un cupon (doar dacă nu a fost folosit).
 *
 * @param {string} couponId - ID-ul cuponului
 * @param {string} userId - ID-ul utilizatorului
 * @returns {Promise<boolean>}
 * @throws {Error} Dacă nu poate fi șters
 */
function deleteCoupon(couponId, userId) {
  return new Promise((resolve, reject) => {
    try {
      if (!couponId || typeof couponId !== 'string') {
        return reject(new Error('ID-ul cuponului este invalid.'));
      }

      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const coupon = get('SELECT * FROM coupons WHERE id = ?', [couponId]);
      if (!coupon) {
        return reject(new Error('Cuponul nu a fost găsit.'));
      }

      if (coupon.userId !== userId) {
        return reject(new Error('Acest cupon nu aparține utilizatorului curent.'));
      }

      if (coupon.status === 'used') {
        return reject(new Error('Cupoanele deja folosite nu pot fi șterse.'));
      }

      run('DELETE FROM coupons WHERE id = ?', [couponId]);
      resolve(true);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Resetează toate datele (pentru testare).
 * @returns {Promise<boolean>}
 */
function resetAllData() {
  return new Promise((resolve) => {
    try {
      ensureTables();
      run('DELETE FROM coupons');
      resolve(true);
    } catch (err) {
      // Dacă tabela nu există încă, ignorăm eroarea
      resolve(true);
    }
  });
}

/**
 * Obține numărul total de cupoane din sistem.
 * @returns {Promise<number>}
 */
function getTotalCouponCount() {
  return new Promise((resolve, reject) => {
    try {
      ensureTables();
      const result = get('SELECT COUNT(*) as count FROM coupons');
      resolve(result.count);
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Configurare
  COUPON_CONFIG,
  VALID_COUPON_STATUSES,
  VALID_DISCOUNT_TYPES,

  // Validări
  isValidUserId,
  isValidCouponCode,
  isValidDiscountPercent,
  isValidDiscountAmount,
  isValidDiscountType,
  isValidCouponStatus,
  isValidPositiveNumber,
  isValidNonNegativeNumber,
  isValidValidityDays,
  isValidNonNegativeInt,
  isCouponExpired,
  isCouponUsed,
  isCouponCancelled,
  isCouponActive,

  // Utilitare
  calculateExpiryDate,
  generateCouponCode,
  normalizeCouponCode,

  // Operații CRUD
  createCoupon,
  getCouponById,
  getCouponByCode,
  validateCoupon,
  useCoupon,
  cancelCoupon,
  calculateDiscount,

  // Interogări
  getActiveCoupons,
  getAllCouponsForUser,
  cleanupExpiredCoupons,

  // Operații avansate
  extendCouponValidity,
  getCouponStats,
  deleteCoupon,

  // Administrare și testare
  resetAllData,
  getTotalCouponCount,
};