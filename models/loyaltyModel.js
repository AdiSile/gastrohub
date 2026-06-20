'use strict';

// ---------------------------------------------------------------------------
// Model Loyalty – GastroHub
// Gestionarea punctelor de loialitate și a cupoanelor de reduceri
// Suportă: acumulare puncte, validare cupoane, expirare automată
// Persistență: SQLite via sql.js (config/db) – tabelele loyalty_accounts și loyalty_coupons
// ---------------------------------------------------------------------------

const { getDb } = require('../config/db');

// ---------------------------------------------------------------------------
// Helpers interne pentru interogări sql.js
// ---------------------------------------------------------------------------

/**
 * Execută o interogare și returnează primul rând ca obiect, sau undefined.
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Object|undefined}
 */
function _queryOne(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : undefined;
  stmt.free();
  return row;
}

/**
 * Execută o interogare și returnează toate rândurile ca array de obiecte.
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Array<Object>}
 */
function _queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/**
 * Execută o interogare de tip INSERT/UPDATE/DELETE și returnează numărul de changes.
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {{ changes: number }}
 */
function _execute(db, sql, params = []) {
  db.run(sql, params);
  const changesRes = db.exec('SELECT changes() AS cnt');
  const changes = (changesRes.length && changesRes[0].values.length) ? changesRes[0].values[0][0] : 0;
  return { changes };
}

// ---------------------------------------------------------------------------
// Asigură existența tabelelor (idempotent)
// ---------------------------------------------------------------------------

let _tablesEnsured = false;

/**
 * Asigură existența tabelelor loyalty_accounts și loyalty_coupons.
 * @param {import('sql.js').Database} db
 */
function ensureTables(db) {
  if (_tablesEnsured) return;
  // Tabelele pot exista deja din config/db, dar le creăm idempotent
  db.exec(`
    CREATE TABLE IF NOT EXISTS loyalty_accounts (
      userId         TEXT    PRIMARY KEY,
      totalPoints    INTEGER NOT NULL DEFAULT 0,
      lifetimePoints INTEGER NOT NULL DEFAULT 0,
      activeCoupons  INTEGER NOT NULL DEFAULT 0,
      createdAt      TEXT    DEFAULT (datetime('now')),
      updatedAt      TEXT    DEFAULT (datetime('now'))
    );
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
    CREATE INDEX IF NOT EXISTS idx_loyalty_coupons_userId ON loyalty_coupons(userId);
    CREATE INDEX IF NOT EXISTS idx_loyalty_coupons_code ON loyalty_coupons(code);
    CREATE INDEX IF NOT EXISTS idx_loyalty_coupons_status ON loyalty_coupons(status);
  `);
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
async function createLoyaltyAccount(userId) {
  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  const db = await getDb();
  ensureTables(db);

  const existing = _queryOne(db, 'SELECT userId FROM loyalty_accounts WHERE userId = ?', [userId]);
  if (existing) {
    throw new Error('Contul de loialitate există deja pentru acest utilizator.');
  }

  const now = new Date().toISOString();
  _execute(db,
    'INSERT INTO loyalty_accounts (userId, totalPoints, lifetimePoints, activeCoupons, createdAt, updatedAt) VALUES (?, 0, 0, 0, ?, ?)',
    [userId, now, now]
  );

  const account = _queryOne(db, 'SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
  return account;
}

/**
 * Obține un cont de loialitate după userId.
 * @param {string} userId
 * @returns {Promise<Object>} Contul de loialitate
 * @throws {Error} Dacă userId este invalid sau contul nu există
 */
async function getLoyaltyAccount(userId) {
  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  const db = await getDb();
  ensureTables(db);

  const account = _queryOne(db, 'SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
  if (!account) {
    throw new Error('Contul de loialitate nu a fost găsit.');
  }

  return account;
}

/**
 * Adaugă puncte de loialitate unui utilizator.
 * @param {string} userId - ID-ul utilizatorului
 * @param {number} spentAmount - Valoarea cheltuită (în unități monetare)
 * @returns {Promise<Object>} Contul actualizat
 * @throws {Error} Dacă validarea eșuează
 */
async function addPoints(userId, spentAmount) {
  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  if (!isValidPositiveNumber(spentAmount)) {
    throw new Error('Valoarea cheltuită trebuie să fie un număr pozitiv.');
  }

  const db = await getDb();
  ensureTables(db);

  const account = _queryOne(db, 'SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
  if (!account) {
    throw new Error('Contul de loialitate nu a fost găsit. Creați mai întâi un cont.');
  }

  const pointsEarned = Math.floor(spentAmount / LOYALTY_CONFIG.PUNCTE_PER_VALOARE);
  if (pointsEarned < 1) {
    throw new Error('Valoarea cheltuită este prea mică pentru a acumula puncte.');
  }

  const now = new Date().toISOString();
  _execute(db,
    'UPDATE loyalty_accounts SET totalPoints = totalPoints + ?, lifetimePoints = lifetimePoints + ?, updatedAt = ? WHERE userId = ?',
    [pointsEarned, pointsEarned, now, userId]
  );

  const updated = _queryOne(db, 'SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
  return { ...updated, pointsEarned };
}

/**
 * Scade puncte din cont (de exemplu, la generarea unui cupon).
 * @param {string} userId
 * @param {number} pointsToDeduct
 * @returns {Promise<Object>} Contul actualizat
 * @throws {Error} Dacă punctele sunt insuficiente
 */
async function deductPoints(userId, pointsToDeduct) {
  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  if (!isValidPositiveNumber(pointsToDeduct)) {
    throw new Error('Numărul de puncte de scăzut trebuie să fie un număr pozitiv.');
  }

  const db = await getDb();
  ensureTables(db);

  const account = _queryOne(db, 'SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
  if (!account) {
    throw new Error('Contul de loialitate nu a fost găsit.');
  }

  if (account.totalPoints < pointsToDeduct) {
    throw new Error(`Puncte insuficiente. Disponibile: ${account.totalPoints}, Necesare: ${pointsToDeduct}`);
  }

  const now = new Date().toISOString();
  _execute(db,
    'UPDATE loyalty_accounts SET totalPoints = totalPoints - ?, updatedAt = ? WHERE userId = ?',
    [pointsToDeduct, now, userId]
  );

  const updated = _queryOne(db, 'SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
  return { ...updated, pointsDeducted: pointsToDeduct };
}

/**
 * Obține istoricul total al punctelor (lifetime) pentru un utilizator.
 * @param {string} userId
 * @returns {Promise<number>}
 */
async function getLifetimePoints(userId) {
  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  const db = await getDb();
  ensureTables(db);

  const account = _queryOne(db, 'SELECT lifetimePoints FROM loyalty_accounts WHERE userId = ?', [userId]);
  if (!account) {
    return 0;
  }

  return account.lifetimePoints;
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
async function createCoupon(userId, options = {}) {
  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  const discountPercent = options.discountPercent || LOYALTY_CONFIG.DISCOUNT_PERCENT_DEFAULT;
  if (!isValidDiscountPercent(discountPercent)) {
    throw new Error('Procentajul de discount trebuie să fie între 1 și 100.');
  }

  const db = await getDb();
  ensureTables(db);

  const account = _queryOne(db, 'SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
  if (!account) {
    throw new Error('Contul de loialitate nu a fost găsit. Creați mai întâi un cont.');
  }

  if (account.activeCoupons >= LOYALTY_CONFIG.MAX_CUPOANE_ACTIVE) {
    throw new Error(`Ai atins numărul maxim de cupoane active (${LOYALTY_CONFIG.MAX_CUPOANE_ACTIVE}). Folosește sau anulează un cupon existent.`);
  }

  const pointsCost = options.pointsCost || LOYALTY_CONFIG.PUNCTE_MINIME_FOR_CUPON;
  if (account.totalPoints < pointsCost) {
    throw new Error(`Puncte insuficiente pentru a genera cupon. Ai nevoie de ${pointsCost} puncte, ai doar ${account.totalPoints}.`);
  }

  const couponId = generateId();
  const couponCode = generateCouponCode();
  const now = new Date().toISOString();
  const expiresAt = calculateExpiryDate();

  // Scădem punctele și actualizăm contorul
  _execute(db,
    'UPDATE loyalty_accounts SET totalPoints = totalPoints - ?, activeCoupons = activeCoupons + 1, updatedAt = ? WHERE userId = ?',
    [pointsCost, now, userId]
  );

  // Inserăm cuponul
  _execute(db,
    'INSERT INTO loyalty_coupons (id, code, userId, discountPercent, pointsCost, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [couponId, couponCode, userId, discountPercent, pointsCost, 'active', now, expiresAt]
  );

  const coupon = _queryOne(db, 'SELECT * FROM loyalty_coupons WHERE id = ?', [couponId]);
  return coupon;
}

/**
 * Obține un cupon după ID.
 * @param {string} couponId
 * @returns {Promise<Object>}
 * @throws {Error} Dacă cuponul nu există
 */
async function getCouponById(couponId) {
  if (!couponId || typeof couponId !== 'string') {
    throw new Error('ID-ul cuponului este invalid.');
  }

  const db = await getDb();
  ensureTables(db);

  const cupon = _queryOne(db, 'SELECT * FROM loyalty_coupons WHERE id = ?', [couponId]);
  if (!cupon) {
    throw new Error('Cuponul nu a fost găsit.');
  }

  return cupon;
}

/**
 * Obține un cupon după cod.
 * @param {string} code - Codul cuponului
 * @returns {Promise<Object>}
 * @throws {Error} Dacă codul este invalid sau cuponul nu există
 */
async function getCouponByCode(code) {
  if (!isValidCouponCode(code)) {
    throw new Error('Codul cuponului este invalid (minim 4 caractere, maxim 30).');
  }

  const db = await getDb();
  ensureTables(db);

  const normalizedCode = code.trim().toUpperCase();
  const cupon = _queryOne(db, 'SELECT * FROM loyalty_coupons WHERE UPPER(code) = ?', [normalizedCode]);

  if (!cupon) {
    throw new Error('Cuponul nu a fost găsit.');
  }

  return cupon;
}

/**
 * Validează un cupon (verifică status, expirare, apartenență).
 * @param {string} code - Codul cuponului
 * @param {string} userId - ID-ul utilizatorului care încearcă să folosească cuponul
 * @returns {Promise<Object>} Cuponul validat
 * @throws {Error} Dacă cuponul nu este valid
 */
async function validateCoupon(code, userId) {
  if (!isValidCouponCode(code)) {
    throw new Error('Codul cuponului este invalid.');
  }

  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  const db = await getDb();
  ensureTables(db);

  const normalizedCode = code.trim().toUpperCase();
  const cupon = _queryOne(db, 'SELECT * FROM loyalty_coupons WHERE UPPER(code) = ?', [normalizedCode]);

  if (!cupon) {
    throw new Error('Cuponul nu există.');
  }

  if (cupon.userId !== userId) {
    throw new Error('Acest cupon nu aparține utilizatorului curent.');
  }

  if (isCouponExpired(cupon)) {
    throw new Error('Cuponul a expirat.');
  }

  if (isCouponUsed(cupon)) {
    throw new Error('Cuponul a fost deja folosit.');
  }

  if (isCouponCancelled(cupon)) {
    throw new Error('Cuponul a fost anulat.');
  }

  return cupon;
}

/**
 * Folosește un cupon (îl marchează ca used).
 * @param {string} code - Codul cuponului
 * @param {string} userId - ID-ul utilizatorului
 * @param {Object} [orderDetails] - Detalii opționale despre comandă
 * @returns {Promise<Object>} Cuponul actualizat
 * @throws {Error} Dacă cuponul nu poate fi folosit
 */
async function useCoupon(code, userId, orderDetails = {}) {
  if (!isValidCouponCode(code)) {
    throw new Error('Codul cuponului este invalid.');
  }

  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  const db = await getDb();
  ensureTables(db);

  const normalizedCode = code.trim().toUpperCase();
  const cupon = _queryOne(db, 'SELECT * FROM loyalty_coupons WHERE UPPER(code) = ?', [normalizedCode]);

  if (!cupon) {
    throw new Error('Cuponul nu există.');
  }

  if (cupon.userId !== userId) {
    throw new Error('Acest cupon nu aparține utilizatorului curent.');
  }

  if (isCouponExpired(cupon)) {
    throw new Error('Cuponul a expirat.');
  }

  if (isCouponUsed(cupon)) {
    throw new Error('Cuponul a fost deja folosit.');
  }

  if (isCouponCancelled(cupon)) {
    throw new Error('Cuponul a fost anulat.');
  }

  // Marcăm ca folosit
  const now = new Date().toISOString();
  const usedOnOrder = orderDetails.orderId || null;

  _execute(db,
    'UPDATE loyalty_coupons SET status = ?, usedAt = ?, usedOnOrder = ? WHERE id = ?',
    ['used', now, usedOnOrder, cupon.id]
  );

  // Actualizăm contorul în cont
  const account = _queryOne(db, 'SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
  if (account) {
    _execute(db,
      'UPDATE loyalty_accounts SET activeCoupons = MAX(0, activeCoupons - 1), updatedAt = ? WHERE userId = ?',
      [now, userId]
    );
  }

  const updated = _queryOne(db, 'SELECT * FROM loyalty_coupons WHERE id = ?', [cupon.id]);
  return updated;
}

/**
 * Anulează un cupon activ și restituie punctele.
 * @param {string} code - Codul cuponului
 * @param {string} userId - ID-ul utilizatorului
 * @returns {Promise<Object>} Cuponul actualizat
 * @throws {Error} Dacă cuponul nu poate fi anulat
 */
async function cancelCoupon(code, userId) {
  if (!isValidCouponCode(code)) {
    throw new Error('Codul cuponului este invalid.');
  }

  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  const db = await getDb();
  ensureTables(db);

  const normalizedCode = code.trim().toUpperCase();
  const cupon = _queryOne(db, 'SELECT * FROM loyalty_coupons WHERE UPPER(code) = ?', [normalizedCode]);

  if (!cupon) {
    throw new Error('Cuponul nu există.');
  }

  if (cupon.userId !== userId) {
    throw new Error('Acest cupon nu aparține utilizatorului curent.');
  }

  if (cupon.status !== 'active') {
    throw new Error('Doar cupoanele active pot fi anulate.');
  }

  if (isCouponExpired(cupon)) {
    throw new Error('Cuponul a expirat deja și nu mai poate fi anulat.');
  }

  // Anulăm cuponul
  _execute(db,
    'UPDATE loyalty_coupons SET status = ? WHERE id = ?',
    ['cancelled', cupon.id]
  );

  // Restituim punctele
  const account = _queryOne(db, 'SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
  if (account) {
    const now = new Date().toISOString();
    _execute(db,
      'UPDATE loyalty_accounts SET totalPoints = totalPoints + ?, activeCoupons = MAX(0, activeCoupons - 1), updatedAt = ? WHERE userId = ?',
      [cupon.pointsCost, now, userId]
    );
  }

  const updated = _queryOne(db, 'SELECT * FROM loyalty_coupons WHERE id = ?', [cupon.id]);
  return { ...updated, pointsRefunded: cupon.pointsCost };
}

/**
 * Obține toate cupoanele active ale unui utilizator.
 * @param {string} userId
 * @returns {Promise<Array>} Lista cupoanelor active
 */
async function getActiveCoupons(userId) {
  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  const db = await getDb();
  ensureTables(db);

  const now = new Date().toISOString();
  const rows = _queryAll(db,
    'SELECT * FROM loyalty_coupons WHERE userId = ? AND status = ? AND expiresAt > ?',
    [userId, 'active', now]
  );

  return rows;
}

/**
 * Obține toate cupoanele unui utilizator (inclusiv expirate/folosite).
 * @param {string} userId
 * @returns {Promise<Array>} Lista completă a cupoanelor
 */
async function getAllCouponsForUser(userId) {
  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  const db = await getDb();
  ensureTables(db);

  const rows = _queryAll(db,
    'SELECT * FROM loyalty_coupons WHERE userId = ? ORDER BY createdAt DESC',
    [userId]
  );

  return rows;
}

/**
 * Curăță cupoanele expirate dintr-un cont (marcare automată).
 * @param {string} userId
 * @returns {Promise<number>} Numărul de cupoane curățate
 */
async function cleanupExpiredCoupons(userId) {
  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  const db = await getDb();
  ensureTables(db);

  const now = new Date().toISOString();

  // Marcăm cupoanele active expirate
  const result = _execute(db,
    "UPDATE loyalty_coupons SET status = 'expired' WHERE userId = ? AND status = 'active' AND expiresAt <= ?",
    [userId, now]
  );

  const cleanedCount = result.changes || 0;

  // Actualizăm contorul activ
  if (cleanedCount > 0) {
    const account = _queryOne(db, 'SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
    if (account) {
      _execute(db,
        'UPDATE loyalty_accounts SET activeCoupons = MAX(0, activeCoupons - ?), updatedAt = ? WHERE userId = ?',
        [cleanedCount, now, userId]
      );
    }
  }

  return cleanedCount;
}

/**
 * Calculează valoarea discount-ului pe baza cuponului și a sumei.
 * @param {string} couponCode - Codul cuponului
 * @param {number} orderAmount - Suma comenzii
 * @param {string} userId - ID-ul utilizatorului
 * @returns {Promise<Object>} Detalii discount
 */
async function calculateDiscount(couponCode, orderAmount, userId) {
  if (!isValidPositiveNumber(orderAmount)) {
    throw new Error('Suma comenzii trebuie să fie un număr pozitiv.');
  }

  if (!isValidCouponCode(couponCode)) {
    throw new Error('Codul cuponului este invalid.');
  }

  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  const db = await getDb();
  ensureTables(db);

  const normalizedCode = couponCode.trim().toUpperCase();
  const cupon = _queryOne(db, 'SELECT * FROM loyalty_coupons WHERE UPPER(code) = ?', [normalizedCode]);

  if (!cupon) {
    throw new Error('Cuponul nu există.');
  }

  if (cupon.userId !== userId) {
    throw new Error('Acest cupon nu aparține utilizatorului curent.');
  }

  if (isCouponExpired(cupon)) {
    throw new Error('Cuponul a expirat.');
  }

  if (isCouponUsed(cupon)) {
    throw new Error('Cuponul a fost deja folosit.');
  }

  if (isCouponCancelled(cupon)) {
    throw new Error('Cuponul a fost anulat.');
  }

  const discountAmount = (orderAmount * cupon.discountPercent) / 100;
  const finalAmount = orderAmount - discountAmount;

  return {
    originalAmount: orderAmount,
    discountPercent: cupon.discountPercent,
    discountAmount: Math.round(discountAmount * 100) / 100,
    finalAmount: Math.round(finalAmount * 100) / 100,
    couponCode: cupon.code,
  };
}

/**
 * Resetează toate datele (pentru testare).
 * @returns {Promise<boolean>}
 */
async function resetAllData() {
  try {
    const db = await getDb();
    ensureTables(db);
    _execute(db, 'DELETE FROM loyalty_coupons');
    _execute(db, 'DELETE FROM loyalty_accounts');
    return true;
  } catch (err) {
    // Dacă tabelele nu există încă, ignorăm eroarea
    return true;
  }
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