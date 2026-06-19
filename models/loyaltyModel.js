'use strict';

// ---------------------------------------------------------------------------
// Model Loyalty – GastroHub
// Gestionarea punctelor de loialitate și a cupoanelor de reduceri
// Suportă: acumulare puncte, validare cupoane, expirare automată
// Persistență: SQLite via sql.js (config/db) – tabelele loyalty_accounts și loyalty_coupons
// ---------------------------------------------------------------------------

const { getDb, run, get, all } = require('../config/db');

// ---------------------------------------------------------------------------
// Asigură existența tabelelor (idempotent)
// ---------------------------------------------------------------------------

let _tablesEnsured = false;

function ensureTables() {
  if (_tablesEnsured) return;
  // Tabela nu există încă în config/db, o creăm aici idempotent
  run(`
    CREATE TABLE IF NOT EXISTS loyalty_accounts (
      userId         TEXT    PRIMARY KEY,
      totalPoints    INTEGER NOT NULL DEFAULT 0,
      lifetimePoints INTEGER NOT NULL DEFAULT 0,
      activeCoupons  INTEGER NOT NULL DEFAULT 0,
      createdAt      TEXT    DEFAULT (datetime('now')),
      updatedAt      TEXT    DEFAULT (datetime('now'))
    );
  `);
  run(`
    CREATE TABLE IF NOT EXISTS loyalty_coupons (
      id              TEXT    PRIMARY KEY,
      code            TEXT    NOT NULL UNIQUE,
      userId          TEXT    NOT NULL,
      discountPercent REAL    NOT NULL DEFAULT 10,
      pointsCost      INTEGER NOT NULL DEFAULT 100,
      status          TEXT    NOT NULL DEFAULT 'active',
      createdAt       TEXT    DEFAULT (datetime('now')),
      expiresAt       TEXT,
      usedAt          TEXT,
      usedOnOrder     TEXT
    );
  `);
  run('CREATE INDEX IF NOT EXISTS idx_loyalty_coupons_userId ON loyalty_coupons(userId);');
  run('CREATE INDEX IF NOT EXISTS idx_loyalty_coupons_code ON loyalty_coupons(code);');
  run('CREATE INDEX IF NOT EXISTS idx_loyalty_coupons_status ON loyalty_coupons(status);');
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
// Configurare
// ---------------------------------------------------------------------------

const LOYALTY_CONFIG = {
  PUNCTE_PER_VALOARE: 10,        // 1 punct per 10 unități valutare
  PUNCTE_MINIME_FOR_CUPON: 100,  // Puncte minime pentru generare cupon
  DISCOUNT_PERCENT_DEFAULT: 10,  // Discount procentual implicit per cupon
  VALIDITY_DAYS: 90,            // Valabilitate cupon în zile
  MAX_CUPOANE_ACTIVE: 5,        // Maxim cupoane active simultan
};

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Validează un ID de utilizator.
 * @param {string} userId
 * @returns {boolean}
 */
function isValidUserId(userId) {
  return typeof userId === 'string' && userId.trim().length > 0 && userId.length <= 100;
}

/**
 * Validează o valoare numerică pozitivă.
 * @param {number} value
 * @returns {boolean}
 */
function isValidPositiveNumber(value) {
  return typeof value === 'number' && value > 0 && isFinite(value);
}

/**
 * Validează un cod de cupon.
 * @param {string} code
 * @returns {boolean}
 */
function isValidCouponCode(code) {
  return typeof code === 'string' && code.trim().length >= 4 && code.trim().length <= 30;
}

/**
 * Validează un procentaj de discount.
 * @param {number} percent - 0-100
 * @returns {boolean}
 */
function isValidDiscountPercent(percent) {
  return typeof percent === 'number' && percent > 0 && percent <= 100 && isFinite(percent);
}

/**
 * Verifică dacă un cupon este expirat.
 * @param {Object} cupon
 * @returns {boolean}
 */
function isCouponExpired(cupon) {
  const now = new Date();
  const expiresAt = new Date(cupon.expiresAt);
  return expiresAt < now;
}

/**
 * Verifică dacă un cupon a fost deja folosit.
 * @param {Object} cupon
 * @returns {boolean}
 */
function isCouponUsed(cupon) {
  return cupon.status === 'used';
}

/**
 * Verifică dacă un cupon este anulat.
 * @param {Object} cupon
 * @returns {boolean}
 */
function isCouponCancelled(cupon) {
  return cupon.status === 'cancelled';
}

// ---------------------------------------------------------------------------
// Operații cont loialitate
// ---------------------------------------------------------------------------

/**
 * Creează un cont de loialitate pentru un utilizator.
 * @param {string} userId - ID-ul utilizatorului
 * @returns {Promise<Object>} Contul de loialitate creat
 * @throws {Error} Dacă userId este invalid sau contul există deja
 */
function createLoyaltyAccount(userId) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const existing = get('SELECT userId FROM loyalty_accounts WHERE userId = ?', [userId]);
      if (existing) {
        return reject(new Error('Contul de loialitate există deja pentru acest utilizator.'));
      }

      const now = new Date().toISOString();
      run(
        'INSERT INTO loyalty_accounts (userId, totalPoints, lifetimePoints, activeCoupons, createdAt, updatedAt) VALUES (?, 0, 0, 0, ?, ?)',
        [userId, now, now]
      );

      const account = get('SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
      resolve(account);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Obține un cont de loialitate după userId.
 * @param {string} userId
 * @returns {Promise<Object>} Contul de loialitate
 * @throws {Error} Dacă userId este invalid sau contul nu există
 */
function getLoyaltyAccount(userId) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const account = get('SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
      if (!account) {
        return reject(new Error('Contul de loialitate nu a fost găsit.'));
      }

      resolve(account);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Adaugă puncte de loialitate unui utilizator.
 * @param {string} userId - ID-ul utilizatorului
 * @param {number} spentAmount - Valoarea cheltuită (în unități monetare)
 * @returns {Promise<Object>} Contul actualizat
 * @throws {Error} Dacă validarea eșuează
 */
function addPoints(userId, spentAmount) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      if (!isValidPositiveNumber(spentAmount)) {
        return reject(new Error('Valoarea cheltuită trebuie să fie un număr pozitiv.'));
      }

      ensureTables();

      const account = get('SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
      if (!account) {
        return reject(new Error('Contul de loialitate nu a fost găsit. Creați mai întâi un cont.'));
      }

      const pointsEarned = Math.floor(spentAmount / LOYALTY_CONFIG.PUNCTE_PER_VALOARE);
      if (pointsEarned < 1) {
        return reject(new Error('Valoarea cheltuită este prea mică pentru a acumula puncte.'));
      }

      const now = new Date().toISOString();
      run(
        'UPDATE loyalty_accounts SET totalPoints = totalPoints + ?, lifetimePoints = lifetimePoints + ?, updatedAt = ? WHERE userId = ?',
        [pointsEarned, pointsEarned, now, userId]
      );

      const updated = get('SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
      resolve({ ...updated, pointsEarned });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Scade puncte din cont (de exemplu, la generarea unui cupon).
 * @param {string} userId
 * @param {number} pointsToDeduct
 * @returns {Promise<Object>} Contul actualizat
 * @throws {Error} Dacă punctele sunt insuficiente
 */
function deductPoints(userId, pointsToDeduct) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      if (!isValidPositiveNumber(pointsToDeduct)) {
        return reject(new Error('Numărul de puncte de scăzut trebuie să fie un număr pozitiv.'));
      }

      ensureTables();

      const account = get('SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
      if (!account) {
        return reject(new Error('Contul de loialitate nu a fost găsit.'));
      }

      if (account.totalPoints < pointsToDeduct) {
        return reject(new Error(`Puncte insuficiente. Disponibile: ${account.totalPoints}, Necesare: ${pointsToDeduct}`));
      }

      const now = new Date().toISOString();
      run(
        'UPDATE loyalty_accounts SET totalPoints = totalPoints - ?, updatedAt = ? WHERE userId = ?',
        [pointsToDeduct, now, userId]
      );

      const updated = get('SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
      resolve({ ...updated, pointsDeducted: pointsToDeduct });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Obține istoricul total al punctelor (lifetime) pentru un utilizator.
 * @param {string} userId
 * @returns {Promise<number>}
 */
function getLifetimePoints(userId) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const account = get('SELECT lifetimePoints FROM loyalty_accounts WHERE userId = ?', [userId]);
      if (!account) {
        return resolve(0);
      }

      resolve(account.lifetimePoints);
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Operații cupoane
// ---------------------------------------------------------------------------

/**
 * Calculează data de expirare pe baza configurării.
 * @returns {string} Data de expirare în ISO string
 */
function calculateExpiryDate() {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + LOYALTY_CONFIG.VALIDITY_DAYS);
  return expiryDate.toISOString();
}

/**
 * Generează un cod unic de cupon.
 * @returns {string} Codul cuponului
 */
function generateCouponCode() {
  const prefix = 'GH';
  const unique = generateId().replace(/-/g, '').substring(0, 8).toUpperCase();
  return `${prefix}-${unique}`;
}

/**
 * Creează un cupon de reducere pentru un utilizator.
 * @param {string} userId - ID-ul utilizatorului
 * @param {Object} [options]
 * @param {number} [options.discountPercent] - Procentajul de discount (1-100)
 * @param {number} [options.pointsCost] - Puncte necesare pentru cupon
 * @returns {Promise<Object>} Cuponul creat
 * @throws {Error} Dacă validarea eșuează
 */
function createCoupon(userId, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      const discountPercent = options.discountPercent || LOYALTY_CONFIG.DISCOUNT_PERCENT_DEFAULT;
      if (!isValidDiscountPercent(discountPercent)) {
        return reject(new Error('Procentajul de discount trebuie să fie între 1 și 100.'));
      }

      ensureTables();

      const account = get('SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
      if (!account) {
        return reject(new Error('Contul de loialitate nu a fost găsit. Creați mai întâi un cont.'));
      }

      if (account.activeCoupons >= LOYALTY_CONFIG.MAX_CUPOANE_ACTIVE) {
        return reject(new Error(`Ai atins numărul maxim de cupoane active (${LOYALTY_CONFIG.MAX_CUPOANE_ACTIVE}). Folosește sau anulează un cupon existent.`));
      }

      const pointsCost = options.pointsCost || LOYALTY_CONFIG.PUNCTE_MINIME_FOR_CUPON;
      if (account.totalPoints < pointsCost) {
        return reject(new Error(`Puncte insuficiente pentru a genera cupon. Ai nevoie de ${pointsCost} puncte, ai doar ${account.totalPoints}.`));
      }

      const couponId = generateId();
      const couponCode = generateCouponCode();
      const now = new Date().toISOString();
      const expiresAt = calculateExpiryDate();

      // Scădem punctele și actualizăm contorul
      run(
        'UPDATE loyalty_accounts SET totalPoints = totalPoints - ?, activeCoupons = activeCoupons + 1, updatedAt = ? WHERE userId = ?',
        [pointsCost, now, userId]
      );

      // Inserăm cuponul
      run(
        'INSERT INTO loyalty_coupons (id, code, userId, discountPercent, pointsCost, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [couponId, couponCode, userId, discountPercent, pointsCost, 'active', now, expiresAt]
      );

      const coupon = get('SELECT * FROM loyalty_coupons WHERE id = ?', [couponId]);
      resolve(coupon);
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

      const cupon = get('SELECT * FROM loyalty_coupons WHERE id = ?', [couponId]);
      if (!cupon) {
        return reject(new Error('Cuponul nu a fost găsit.'));
      }

      resolve(cupon);
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
        return reject(new Error('Codul cuponului este invalid (minim 4 caractere, maxim 30).'));
      }

      ensureTables();

      const normalizedCode = code.trim().toUpperCase();
      const cupon = get('SELECT * FROM loyalty_coupons WHERE UPPER(code) = ?', [normalizedCode]);

      if (!cupon) {
        return reject(new Error('Cuponul nu a fost găsit.'));
      }

      resolve(cupon);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Validează un cupon (verifică status, expirare, apartenență).
 * @param {string} code - Codul cuponului
 * @param {string} userId - ID-ul utilizatorului care încearcă să folosească cuponul
 * @returns {Promise<Object>} Cuponul validat
 * @throws {Error} Dacă cuponul nu este valid
 */
function validateCoupon(code, userId) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidCouponCode(code)) {
        return reject(new Error('Codul cuponului este invalid.'));
      }

      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const normalizedCode = code.trim().toUpperCase();
      const cupon = get('SELECT * FROM loyalty_coupons WHERE UPPER(code) = ?', [normalizedCode]);

      if (!cupon) {
        return reject(new Error('Cuponul nu există.'));
      }

      if (cupon.userId !== userId) {
        return reject(new Error('Acest cupon nu aparține utilizatorului curent.'));
      }

      if (isCouponExpired(cupon)) {
        return reject(new Error('Cuponul a expirat.'));
      }

      if (isCouponUsed(cupon)) {
        return reject(new Error('Cuponul a fost deja folosit.'));
      }

      if (isCouponCancelled(cupon)) {
        return reject(new Error('Cuponul a fost anulat.'));
      }

      resolve(cupon);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Folosește un cupon (îl marchează ca used).
 * @param {string} code - Codul cuponului
 * @param {string} userId - ID-ul utilizatorului
 * @param {Object} [orderDetails] - Detalii opționale despre comandă
 * @returns {Promise<Object>} Cuponul actualizat
 * @throws {Error} Dacă cuponul nu poate fi folosit
 */
function useCoupon(code, userId, orderDetails = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidCouponCode(code)) {
        return reject(new Error('Codul cuponului este invalid.'));
      }

      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const normalizedCode = code.trim().toUpperCase();
      const cupon = get('SELECT * FROM loyalty_coupons WHERE UPPER(code) = ?', [normalizedCode]);

      if (!cupon) {
        return reject(new Error('Cuponul nu există.'));
      }

      if (cupon.userId !== userId) {
        return reject(new Error('Acest cupon nu aparține utilizatorului curent.'));
      }

      if (isCouponExpired(cupon)) {
        return reject(new Error('Cuponul a expirat.'));
      }

      if (isCouponUsed(cupon)) {
        return reject(new Error('Cuponul a fost deja folosit.'));
      }

      if (isCouponCancelled(cupon)) {
        return reject(new Error('Cuponul a fost anulat.'));
      }

      // Marcăm ca folosit
      const now = new Date().toISOString();
      const usedOnOrder = orderDetails.orderId || null;

      run(
        'UPDATE loyalty_coupons SET status = ?, usedAt = ?, usedOnOrder = ? WHERE id = ?',
        ['used', now, usedOnOrder, cupon.id]
      );

      // Actualizăm contorul în cont
      const account = get('SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
      if (account) {
        run(
          'UPDATE loyalty_accounts SET activeCoupons = MAX(0, activeCoupons - 1), updatedAt = ? WHERE userId = ?',
          [now, userId]
        );
      }

      const updated = get('SELECT * FROM loyalty_coupons WHERE id = ?', [cupon.id]);
      resolve(updated);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Anulează un cupon activ și restituie punctele.
 * @param {string} code - Codul cuponului
 * @param {string} userId - ID-ul utilizatorului
 * @returns {Promise<Object>} Cuponul actualizat
 * @throws {Error} Dacă cuponul nu poate fi anulat
 */
function cancelCoupon(code, userId) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidCouponCode(code)) {
        return reject(new Error('Codul cuponului este invalid.'));
      }

      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const normalizedCode = code.trim().toUpperCase();
      const cupon = get('SELECT * FROM loyalty_coupons WHERE UPPER(code) = ?', [normalizedCode]);

      if (!cupon) {
        return reject(new Error('Cuponul nu există.'));
      }

      if (cupon.userId !== userId) {
        return reject(new Error('Acest cupon nu aparține utilizatorului curent.'));
      }

      if (cupon.status !== 'active') {
        return reject(new Error('Doar cupoanele active pot fi anulate.'));
      }

      if (isCouponExpired(cupon)) {
        return reject(new Error('Cuponul a expirat deja și nu mai poate fi anulat.'));
      }

      // Anulăm cuponul
      run(
        'UPDATE loyalty_coupons SET status = ? WHERE id = ?',
        ['cancelled', cupon.id]
      );

      // Restituim punctele
      const account = get('SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
      if (account) {
        const now = new Date().toISOString();
        run(
          'UPDATE loyalty_accounts SET totalPoints = totalPoints + ?, activeCoupons = MAX(0, activeCoupons - 1), updatedAt = ? WHERE userId = ?',
          [cupon.pointsCost, now, userId]
        );
      }

      const updated = get('SELECT * FROM loyalty_coupons WHERE id = ?', [cupon.id]);
      resolve({ ...updated, pointsRefunded: cupon.pointsCost });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Obține toate cupoanele active ale unui utilizator.
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
        'SELECT * FROM loyalty_coupons WHERE userId = ? AND status = ? AND expiresAt > ?',
        [userId, 'active', now]
      );

      resolve(rows);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Obține toate cupoanele unui utilizator (inclusiv expirate/folosite).
 * @param {string} userId
 * @returns {Promise<Array>} Lista completă a cupoanelor
 */
function getAllCouponsForUser(userId) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const rows = all(
        'SELECT * FROM loyalty_coupons WHERE userId = ? ORDER BY createdAt DESC',
        [userId]
      );

      resolve(rows);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Curăță cupoanele expirate dintr-un cont (marcare automată).
 * @param {string} userId
 * @returns {Promise<number>} Numărul de cupoane curățate
 */
function cleanupExpiredCoupons(userId) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const now = new Date().toISOString();

      // Marcăm cupoanele active expirate
      const result = run(
        "UPDATE loyalty_coupons SET status = 'expired' WHERE userId = ? AND status = 'active' AND expiresAt <= ?",
        [userId, now]
      );

      const cleanedCount = result.changes || 0;

      // Actualizăm contorul activ
      if (cleanedCount > 0) {
        const account = get('SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
        if (account) {
          run(
            'UPDATE loyalty_accounts SET activeCoupons = MAX(0, activeCoupons - ?), updatedAt = ? WHERE userId = ?',
            [cleanedCount, now, userId]
          );
        }
      }

      resolve(cleanedCount);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Calculează valoarea discount-ului pe baza cuponului și a sumei.
 * @param {string} couponCode - Codul cuponului
 * @param {number} orderAmount - Suma comenzii
 * @param {string} userId - ID-ul utilizatorului
 * @returns {Promise<Object>} Detalii discount
 */
function calculateDiscount(couponCode, orderAmount, userId) {
  return new Promise((resolve, reject) => {
    try {
      if (!isValidPositiveNumber(orderAmount)) {
        return reject(new Error('Suma comenzii trebuie să fie un număr pozitiv.'));
      }

      if (!isValidCouponCode(couponCode)) {
        return reject(new Error('Codul cuponului este invalid.'));
      }

      if (!isValidUserId(userId)) {
        return reject(new Error('ID-ul utilizatorului este invalid.'));
      }

      ensureTables();

      const normalizedCode = couponCode.trim().toUpperCase();
      const cupon = get('SELECT * FROM loyalty_coupons WHERE UPPER(code) = ?', [normalizedCode]);

      if (!cupon) {
        return reject(new Error('Cuponul nu există.'));
      }

      if (cupon.userId !== userId) {
        return reject(new Error('Acest cupon nu aparține utilizatorului curent.'));
      }

      if (isCouponExpired(cupon)) {
        return reject(new Error('Cuponul a expirat.'));
      }

      if (isCouponUsed(cupon)) {
        return reject(new Error('Cuponul a fost deja folosit.'));
      }

      if (isCouponCancelled(cupon)) {
        return reject(new Error('Cuponul a fost anulat.'));
      }

      const discountAmount = (orderAmount * cupon.discountPercent) / 100;
      const finalAmount = orderAmount - discountAmount;

      resolve({
        originalAmount: orderAmount,
        discountPercent: cupon.discountPercent,
        discountAmount: Math.round(discountAmount * 100) / 100,
        finalAmount: Math.round(finalAmount * 100) / 100,
        couponCode: cupon.code,
      });
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
      run('DELETE FROM loyalty_coupons');
      run('DELETE FROM loyalty_accounts');
      resolve(true);
    } catch (err) {
      // Dacă tabelele nu există încă, ignorăm eroarea
      resolve(true);
    }
  });
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Configurare
  LOYALTY_CONFIG,

  // Validare
  isValidUserId,
  isValidPositiveNumber,
  isValidCouponCode,
  isValidDiscountPercent,
  isCouponExpired,
  isCouponUsed,
  isCouponCancelled,

  // Cont loialitate
  createLoyaltyAccount,
  getLoyaltyAccount,
  addPoints,
  deductPoints,
  getLifetimePoints,

  // Cupoane
  createCoupon,
  getCouponById,
  getCouponByCode,
  validateCoupon,
  useCoupon,
  cancelCoupon,
  getActiveCoupons,
  getAllCouponsForUser,
  cleanupExpiredCoupons,
  calculateDiscount,

  // Utilitare
  resetAllData,
};