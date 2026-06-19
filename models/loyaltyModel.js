'use strict';

// ---------------------------------------------------------------------------
// Model Loyalty – GastroHub
// Gestionarea punctelor de loialitate și a cupoanelor de reduceri
// Suportă: acumulare puncte, validare cupoane, expirare automată
// Model în-memory (Map), fără dependențe externe directe.
// ---------------------------------------------------------------------------

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

// Stocare în-memory (înlocuiește cu DB real în producție)
const loyaltyAccounts = new Map();
const cupoane = new Map();

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
    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    if (loyaltyAccounts.has(userId)) {
      return reject(new Error('Contul de loialitate există deja pentru acest utilizator.'));
    }

    const account = {
      userId,
      totalPoints: 0,
      lifetimePoints: 0,
      activeCoupons: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    loyaltyAccounts.set(userId, account);
    resolve({ ...account });
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
    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    const account = loyaltyAccounts.get(userId);
    if (!account) {
      return reject(new Error('Contul de loialitate nu a fost găsit.'));
    }

    resolve({ ...account });
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
    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    if (!isValidPositiveNumber(spentAmount)) {
      return reject(new Error('Valoarea cheltuită trebuie să fie un număr pozitiv.'));
    }

    const account = loyaltyAccounts.get(userId);
    if (!account) {
      return reject(new Error('Contul de loialitate nu a fost găsit. Creați mai întâi un cont.'));
    }

    const pointsEarned = Math.floor(spentAmount / LOYALTY_CONFIG.PUNCTE_PER_VALOARE);
    if (pointsEarned < 1) {
      return reject(new Error('Valoarea cheltuită este prea mică pentru a acumula puncte.'));
    }

    account.totalPoints += pointsEarned;
    account.lifetimePoints += pointsEarned;
    account.updatedAt = new Date().toISOString();

    loyaltyAccounts.set(userId, account);
    resolve({ ...account, pointsEarned });
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
    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    if (!isValidPositiveNumber(pointsToDeduct)) {
      return reject(new Error('Numărul de puncte de scăzut trebuie să fie un număr pozitiv.'));
    }

    const account = loyaltyAccounts.get(userId);
    if (!account) {
      return reject(new Error('Contul de loialitate nu a fost găsit.'));
    }

    if (account.totalPoints < pointsToDeduct) {
      return reject(new Error(`Puncte insuficiente. Disponibile: ${account.totalPoints}, Necesare: ${pointsToDeduct}`));
    }

    account.totalPoints -= pointsToDeduct;
    account.updatedAt = new Date().toISOString();

    loyaltyAccounts.set(userId, account);
    resolve({ ...account, pointsDeducted: pointsToDeduct });
  });
}

/**
 * Obține istoricul total al punctelor (lifetime) pentru un utilizator.
 * @param {string} userId
 * @returns {Promise<number>}
 */
function getLifetimePoints(userId) {
  return new Promise((resolve, reject) => {
    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    const account = loyaltyAccounts.get(userId);
    if (!account) {
      return resolve(0);
    }

    resolve(account.lifetimePoints);
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
    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    const discountPercent = options.discountPercent || LOYALTY_CONFIG.DISCOUNT_PERCENT_DEFAULT;
    if (!isValidDiscountPercent(discountPercent)) {
      return reject(new Error('Procentajul de discount trebuie să fie între 1 și 100.'));
    }

    const account = loyaltyAccounts.get(userId);
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

    const couponCode = generateCouponCode();
    const coupon = {
      id: generateId(),
      code: couponCode,
      userId,
      discountPercent,
      pointsCost,
      status: 'active',
      createdAt: new Date().toISOString(),
      expiresAt: calculateExpiryDate(),
      usedAt: null,
    };

    // Scădem punctele și actualizăm contorul
    account.totalPoints -= pointsCost;
    account.activeCoupons += 1;
    account.updatedAt = new Date().toISOString();

    loyaltyAccounts.set(userId, account);
    cupoane.set(coupon.id, coupon);

    resolve({ ...coupon });
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
    if (!couponId || typeof couponId !== 'string') {
      return reject(new Error('ID-ul cuponului este invalid.'));
    }

    const cupon = cupoane.get(couponId);
    if (!cupon) {
      return reject(new Error('Cuponul nu a fost găsit.'));
    }

    resolve({ ...cupon });
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
    if (!isValidCouponCode(code)) {
      return reject(new Error('Codul cuponului este invalid (minim 4 caractere, maxim 30).'));
    }

    const normalizedCode = code.trim().toUpperCase();
    const cupon = Array.from(cupoane.values()).find(c => c.code === normalizedCode);

    if (!cupon) {
      return reject(new Error('Cuponul nu a fost găsit.'));
    }

    resolve({ ...cupon });
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
    if (!isValidCouponCode(code)) {
      return reject(new Error('Codul cuponului este invalid.'));
    }

    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    const normalizedCode = code.trim().toUpperCase();
    const cupon = Array.from(cupoane.values()).find(c => c.code === normalizedCode);

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

    resolve({ ...cupon });
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
    // Mai întâi validăm
    let cupon;
    try {
      cupon = validateCoupon(code, userId);
    } catch (err) {
      return reject(err);
    }

    // Marcăm ca folosit
    cupon.status = 'used';
    cupon.usedAt = new Date().toISOString();

    if (orderDetails.orderId) {
      cupon.usedOnOrder = orderDetails.orderId;
    }

    cupoane.set(cupon.id, cupon);

    // Actualizăm contorul în cont
    const account = loyaltyAccounts.get(userId);
    if (account) {
      account.activeCoupons = Math.max(0, account.activeCoupons - 1);
      account.updatedAt = new Date().toISOString();
      loyaltyAccounts.set(userId, account);
    }

    resolve({ ...cupon });
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
    if (!isValidCouponCode(code)) {
      return reject(new Error('Codul cuponului este invalid.'));
    }

    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    const normalizedCode = code.trim().toUpperCase();
    const cupon = Array.from(cupoane.values()).find(c => c.code === normalizedCode);

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
    cupon.status = 'cancelled';
    cupoane.set(cupon.id, cupon);

    // Restituim punctele
    const account = loyaltyAccounts.get(userId);
    if (account) {
      account.totalPoints += cupon.pointsCost;
      account.activeCoupons = Math.max(0, account.activeCoupons - 1);
      account.updatedAt = new Date().toISOString();
      loyaltyAccounts.set(userId, account);
    }

    resolve({ ...cupon, pointsRefunded: cupon.pointsCost });
  });
}

/**
 * Obține toate cupoanele active ale unui utilizator.
 * @param {string} userId
 * @returns {Promise<Array>} Lista cupoanelor active
 */
function getActiveCoupons(userId) {
  return new Promise((resolve, reject) => {
    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    const userCoupons = Array.from(cupoane.values())
      .filter(c => c.userId === userId && c.status === 'active' && !isCouponExpired(c));

    resolve(userCoupons.map(c => ({ ...c })));
  });
}

/**
 * Obține toate cupoanele unui utilizator (inclusiv expirate/folosite).
 * @param {string} userId
 * @returns {Promise<Array>} Lista completă a cupoanelor
 */
function getAllCouponsForUser(userId) {
  return new Promise((resolve, reject) => {
    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    const userCoupons = Array.from(cupoane.values())
      .filter(c => c.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    resolve(userCoupons.map(c => ({ ...c })));
  });
}

/**
 * Curăță cupoanele expirate dintr-un cont (marcare automată).
 * @param {string} userId
 * @returns {Promise<number>} Numărul de cupoane curățate
 */
function cleanupExpiredCoupons(userId) {
  return new Promise((resolve, reject) => {
    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    let cleanedCount = 0;
    const userCoupons = Array.from(cupoane.values())
      .filter(c => c.userId === userId && c.status === 'active');

    for (const cupon of userCoupons) {
      if (isCouponExpired(cupon)) {
        cupon.status = 'expired';
        cupoane.set(cupon.id, cupon);
        cleanedCount++;
      }
    }

    // Actualizăm contorul activ
    const account = loyaltyAccounts.get(userId);
    if (account && cleanedCount > 0) {
      account.activeCoupons = Math.max(0, account.activeCoupons - cleanedCount);
      account.updatedAt = new Date().toISOString();
      loyaltyAccounts.set(userId, account);
    }

    resolve(cleanedCount);
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
    if (!isValidPositiveNumber(orderAmount)) {
      return reject(new Error('Suma comenzii trebuie să fie un număr pozitiv.'));
    }

    let cupon;
    try {
      cupon = validateCoupon(couponCode, userId);
    } catch (err) {
      return reject(err);
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
  });
}

/**
 * Resetează toate datele (pentru testare).
 * @returns {Promise<boolean>}
 */
function resetAllData() {
  return new Promise((resolve) => {
    loyaltyAccounts.clear();
    cupoane.clear();
    resolve(true);
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
