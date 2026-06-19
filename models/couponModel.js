'use strict';

// ---------------------------------------------------------------------------
// Model Coupon – GastroHub
// Model pentru cupoane de reducere generate automat
// Suportă: generare automată de cupoane cu cod unic, validare, expirare,
// aplicare discount, anulare, istoric, reguli de utilizare
// ---------------------------------------------------------------------------

const { v4: uuidv4 } = require('uuid');

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
// Stocare în-memory (înlocuiește cu DB real în producție)
// ---------------------------------------------------------------------------

const coupons = new Map();

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
  const unique = uuidv4().replace(/-/g, '').substring(0, COUPON_CONFIG.CODE_LENGTH).toUpperCase();
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
 * Găsește un cupon după codul normalizat.
 * @param {string} normalizedCode - Codul deja normalizat
 * @returns {Object|undefined}
 */
function findCouponByNormalizedCode(normalizedCode) {
  return Array.from(coupons.values()).find(c => c.code === normalizedCode);
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

    // --- Generare cod cupon ---
    let couponCode;
    if (options.code) {
      if (!isValidCouponCode(options.code)) {
        return reject(new Error(`Codul cuponului trebuie să aibă între ${COUPON_CONFIG.MIN_CODE_LENGTH} și ${COUPON_CONFIG.MAX_CODE_LENGTH} caractere.`));
      }
      couponCode = normalizeCouponCode(options.code);
      // Verificăm unicitatea codului
      if (findCouponByNormalizedCode(couponCode)) {
        return reject(new Error('Codul cuponului există deja.'));
      }
    } else {
      // Generăm cod unic
      do {
        couponCode = generateCouponCode();
      } while (findCouponByNormalizedCode(couponCode));
    }

    // --- Creare obiect cupon ---
    const coupon = {
      id: uuidv4(),
      code: couponCode,
      userId: options.userId.trim(),
      discountType,
      discountValue,
      validityDays,
      minOrderAmount: options.minOrderAmount || null,
      maxUsageCount,
      currentUsageCount: 0,
      description: options.description || '',
      restaurantId: options.restaurantId || null,
      hotelId: options.hotelId || null,
      createdBy: options.createdBy || options.userId.trim(),
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: calculateExpiryDate(validityDays),
      usedAt: null,
      usedOnOrders: [],
      cancelledAt: null,
      cancelledBy: null,
    };

    coupons.set(coupon.id, coupon);

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

    const coupon = coupons.get(couponId);
    if (!coupon) {
      return reject(new Error('Cuponul nu a fost găsit.'));
    }

    resolve({ ...coupon });
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
      return reject(new Error(`Codul cuponului este invalid (minim ${COUPON_CONFIG.MIN_CODE_LENGTH} caractere, maxim ${COUPON_CONFIG.MAX_CODE_LENGTH}).`));
    }

    const normalizedCode = normalizeCouponCode(code);
    const coupon = findCouponByNormalizedCode(normalizedCode);

    if (!coupon) {
      return reject(new Error('Cuponul nu a fost găsit.'));
    }

    resolve({ ...coupon });
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
    if (!isValidCouponCode(code)) {
      return reject(new Error('Codul cuponului este invalid.'));
    }

    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    const normalizedCode = normalizeCouponCode(code);
    const coupon = findCouponByNormalizedCode(normalizedCode);

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

    resolve({ ...coupon });
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
function useCoupon(code, userId, orderDetails = {}) {
  return new Promise((resolve, reject) => {
    let coupon;
    try {
      coupon = validateCoupon(code, userId, { orderAmount: orderDetails.orderAmount });
    } catch (err) {
      return reject(err);
    }

    // Incrementare contor utilizări
    coupon.currentUsageCount += 1;

    // Dacă s-a atins maxUsageCount, marcăm ca used
    if (coupon.maxUsageCount > 0 && coupon.currentUsageCount >= coupon.maxUsageCount) {
      coupon.status = 'used';
      coupon.usedAt = new Date().toISOString();
    }

    // Adăugăm comanda la istoric
    if (orderDetails.orderId) {
      coupon.usedOnOrders.push({
        orderId: orderDetails.orderId,
        usedAt: new Date().toISOString(),
        orderAmount: orderDetails.orderAmount || null,
      });
    }

    coupon.updatedAt = new Date().toISOString();
    coupons.set(coupon.id, coupon);

    resolve({ ...coupon });
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
    if (!isValidCouponCode(code)) {
      return reject(new Error('Codul cuponului este invalid.'));
    }

    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    const normalizedCode = normalizeCouponCode(code);
    const coupon = findCouponByNormalizedCode(normalizedCode);

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
    coupon.status = 'cancelled';
    coupon.cancelledAt = new Date().toISOString();
    coupon.cancelledBy = userId;
    coupon.cancelledReason = reason || '';
    coupon.updatedAt = new Date().toISOString();

    coupons.set(coupon.id, coupon);

    resolve({ ...coupon });
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
function calculateDiscount(couponCode, orderAmount, userId) {
  return new Promise((resolve, reject) => {
    if (!isValidPositiveNumber(orderAmount)) {
      return reject(new Error('Suma comenzii trebuie să fie un număr pozitiv.'));
    }

    let coupon;
    try {
      coupon = validateCoupon(couponCode, userId, { orderAmount });
    } catch (err) {
      return reject(err);
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

    resolve({
      originalAmount: orderAmount,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discountAmount: Math.round(discountAmount * 100) / 100,
      finalAmount: Math.round(finalAmount * 100) / 100,
      couponCode: coupon.code,
    });
  });
}

/**
 * Obține toate cupoanele active ale unui utilizator.
 *
 * @param {string} userId
 * @returns {Promise<Array>} Lista cupoanelor active
 */
function getActiveCoupons(userId) {
  return new Promise((resolve, reject) => {
    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    const userCoupons = Array.from(coupons.values())
      .filter(c => c.userId === userId && isCouponActive(c))
      .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));

    resolve(userCoupons.map(c => ({ ...c })));
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
    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    let userCoupons = Array.from(coupons.values()).filter(c => c.userId === userId);

    // Filtrare după status
    if (options.status) {
      if (!isValidCouponStatus(options.status)) {
        return reject(new Error(`Statusul "${options.status}" nu este valid.`));
      }
      userCoupons = userCoupons.filter(c => c.status === options.status);
    }

    // Sortare
    const sortBy = options.sortBy || 'createdAt';
    const sortOrder = options.sortOrder || 'desc';
    const validSortFields = ['createdAt', 'updatedAt', 'expiresAt', 'discountValue', 'status'];

    if (validSortFields.includes(sortBy)) {
      userCoupons.sort((a, b) => {
        const valA = a[sortBy] || '';
        const valB = b[sortBy] || '';
        if (sortOrder === 'asc') {
          return valA > valB ? 1 : -1;
        }
        return valA < valB ? 1 : -1;
      });
    }

    resolve(userCoupons.map(c => ({ ...c })));
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
    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    let cleanedCount = 0;
    const userCoupons = Array.from(coupons.values())
      .filter(c => c.userId === userId && c.status === 'active');

    for (const coupon of userCoupons) {
      if (isCouponExpired(coupon)) {
        coupon.status = 'expired';
        coupon.updatedAt = new Date().toISOString();
        coupons.set(coupon.id, coupon);
        cleanedCount++;
      }
    }

    resolve(cleanedCount);
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

    const normalizedCode = normalizeCouponCode(code);
    const coupon = findCouponByNormalizedCode(normalizedCode);

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
    coupon.expiresAt = currentExpiry.toISOString();
    coupon.validityDays += extraDays;
    coupon.updatedAt = new Date().toISOString();

    coupons.set(coupon.id, coupon);

    resolve({ ...coupon, extraDays });
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
    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    const userCoupons = Array.from(coupons.values()).filter(c => c.userId === userId);
    const now = new Date();

    const stats = {
      total: userCoupons.length,
      active: userCoupons.filter(c => c.status === 'active' && new Date(c.expiresAt) >= now).length,
      used: userCoupons.filter(c => c.status === 'used').length,
      expired: userCoupons.filter(c => c.status === 'expired' || (c.status === 'active' && new Date(c.expiresAt) < now)).length,
      cancelled: userCoupons.filter(c => c.status === 'cancelled').length,
      totalDiscountValue: userCoupons
        .filter(c => c.status === 'used')
        .reduce((sum, c) => sum + c.discountValue, 0),
    };

    resolve(stats);
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
    if (!couponId || typeof couponId !== 'string') {
      return reject(new Error('ID-ul cuponului este invalid.'));
    }

    if (!isValidUserId(userId)) {
      return reject(new Error('ID-ul utilizatorului este invalid.'));
    }

    const coupon = coupons.get(couponId);
    if (!coupon) {
      return reject(new Error('Cuponul nu a fost găsit.'));
    }

    if (coupon.userId !== userId) {
      return reject(new Error('Acest cupon nu aparține utilizatorului curent.'));
    }

    if (coupon.status === 'used') {
      return reject(new Error('Cupoanele deja folosite nu pot fi șterse.'));
    }

    coupons.delete(couponId);
    resolve(true);
  });
}

/**
 * Resetează toate datele (pentru testare).
 * @returns {Promise<boolean>}
 */
function resetAllData() {
  return new Promise((resolve) => {
    coupons.clear();
    resolve(true);
  });
}

/**
 * Obține numărul total de cupoane din sistem.
 * @returns {Promise<number>}
 */
function getTotalCouponCount() {
  return new Promise((resolve) => {
    resolve(coupons.size);
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