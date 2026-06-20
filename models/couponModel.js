// Modificări principale:

// 1. Import – doar getDb (async)
const { getDb } = require('../config/db');

// 2. Helpers interne care folosesc db.prepare / db.run / db.exec
function _dbGet(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  let row;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

function _dbAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function _dbRun(db, sql, params = []) {
  db.run(sql, params);
  const changesRes = db.exec('SELECT changes() AS cnt');
  const lastIdRes = db.exec('SELECT last_insert_rowid() AS id');
  return {
    changes:
      changesRes.length > 0 && changesRes[0].values.length > 0
        ? changesRes[0].values[0][0]
        : 0,
    lastInsertRowid:
      lastIdRes.length > 0 && lastIdRes[0].values.length > 0
        ? lastIdRes[0].values[0][0]
        : 0,
  };
}

// 3. ensureTables – async, folosește await getDb() + db.run()
let _tablesEnsured = false;

async function ensureTables() {
  if (_tablesEnsured) return;
  const db = await getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS coupons (
      id                TEXT    PRIMARY KEY,
      code              TEXT    NOT NULL UNIQUE,
      userId            TEXT    NOT NULL,
      discountType      TEXT    NOT NULL DEFAULT 'percent',
      discountValue     REAL    NOT NULL DEFAULT 10,
      status            TEXT    NOT NULL DEFAULT 'active',
      validityDays      INTEGER NOT NULL DEFAULT 90,
      minOrderAmount    REAL    NOT NULL DEFAULT 0,
      maxUsageCount     INTEGER NOT NULL DEFAULT 1,
      currentUsageCount INTEGER NOT NULL DEFAULT 0,
      usedOnOrders      TEXT    NOT NULL DEFAULT '[]',
      description       TEXT    NOT NULL DEFAULT '',
      restaurantId      TEXT,
      hotelId           TEXT,
      createdBy         TEXT,
      createdAt         TEXT    NOT NULL DEFAULT (datetime('now')),
      expiresAt         TEXT    NOT NULL,
      usedAt            TEXT,
      cancelledAt       TEXT,
      cancelledBy       TEXT,
      cancelledReason   TEXT    NOT NULL DEFAULT '',
      extraDays         INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_coupons_userId ON coupons(userId);
    CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
    CREATE INDEX IF NOT EXISTS idx_coupons_status ON coupons(status);
    CREATE INDEX IF NOT EXISTS idx_coupons_discountType ON coupons(discountType);
  `);
  _tablesEnsured = true;
}

// 4. Toate funcțiile CRUD – async/await, fără new Promise wrapper

// ---------------------------------------------------------------------------
// Configurare
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

const VALID_COUPON_STATUSES = ['active', 'used', 'expired', 'cancelled'];
const VALID_DISCOUNT_TYPES = ['percent', 'fixed'];

// ---------------------------------------------------------------------------
// Generator intern de ID-uri unice
// ---------------------------------------------------------------------------

let _idCounter = 0;

function generateId() {
  _idCounter += 1;
  return (
    _idCounter.toString(36) +
    '-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).substring(2, 10) +
    '-' +
    Math.random().toString(36).substring(2, 6)
  );
}

// ---------------------------------------------------------------------------
// Helpers de transformare rând DB → obiect cupon
// ---------------------------------------------------------------------------

function parseUsedOnOrders(raw) {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function rowToCoupon(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    userId: row.userId,
    discountType: row.discountType,
    discountValue: row.discountValue,
    status: row.status,
    validityDays: row.validityDays,
    minOrderAmount: row.minOrderAmount,
    maxUsageCount: row.maxUsageCount,
    currentUsageCount: row.currentUsageCount,
    usedOnOrders: parseUsedOnOrders(row.usedOnOrders),
    description: row.description || '',
    restaurantId: row.restaurantId || null,
    hotelId: row.hotelId || null,
    createdBy: row.createdBy || null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt || null,
    cancelledAt: row.cancelledAt || null,
    cancelledBy: row.cancelledBy || null,
    cancelledReason: row.cancelledReason || '',
    extraDays: row.extraDays || 0,
  };
}

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

function isValidUserId(userId) {
  return typeof userId === 'string' && userId.trim().length > 0 && userId.trim().length <= 100;
}

function isValidCouponCode(code) {
  return typeof code === 'string' && code.trim().length >= COUPON_CONFIG.MIN_CODE_LENGTH && code.trim().length <= COUPON_CONFIG.MAX_CODE_LENGTH;
}

function isValidDiscountPercent(percent) {
  return typeof percent === 'number' && percent >= COUPON_CONFIG.MIN_DISCOUNT_PERCENT && percent <= COUPON_CONFIG.MAX_DISCOUNT_PERCENT && isFinite(percent) && !Number.isNaN(percent);
}

function isValidDiscountAmount(amount) {
  return typeof amount === 'number' && amount > 0 && isFinite(amount) && !Number.isNaN(amount);
}

function isValidDiscountType(type) {
  return VALID_DISCOUNT_TYPES.includes(type);
}

function isValidCouponStatus(status) {
  return VALID_COUPON_STATUSES.includes(status);
}

function isValidPositiveNumber(val) {
  return typeof val === 'number' && val > 0 && isFinite(val) && !Number.isNaN(val);
}

function isValidNonNegativeNumber(val) {
  return typeof val === 'number' && val >= 0 && isFinite(val) && !Number.isNaN(val);
}

function isValidValidityDays(days) {
  return Number.isInteger(days) && days >= COUPON_CONFIG.MIN_VALIDITY_DAYS && days <= COUPON_CONFIG.MAX_VALIDITY_DAYS;
}

function isValidNonNegativeInt(val) {
  return Number.isInteger(val) && val >= 0;
}

// ---------------------------------------------------------------------------
// Funcții de verificare stare cupon
// ---------------------------------------------------------------------------

function isCouponExpired(coupon) {
  if (!coupon || !coupon.expiresAt || typeof coupon.expiresAt !== 'string') return false;
  const now = new Date();
  const expiresAt = new Date(coupon.expiresAt);
  return expiresAt < now;
}

function isCouponUsed(coupon) {
  return coupon && coupon.status === 'used';
}

function isCouponCancelled(coupon) {
  return coupon && coupon.status === 'cancelled';
}

function isCouponActive(coupon) {
  return coupon && coupon.status === 'active' && !isCouponExpired(coupon);
}

// ---------------------------------------------------------------------------
// Funcții utilitare
// ---------------------------------------------------------------------------

function calculateExpiryDate(validityDays) {
  const days = isValidValidityDays(validityDays) ? validityDays : COUPON_CONFIG.DEFAULT_VALIDITY_DAYS;
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + days);
  return expiryDate.toISOString();
}

function generateCouponCode(prefix) {
  const pfx = typeof prefix === 'string' && prefix.trim().length > 0 ? prefix.trim() : COUPON_CONFIG.CODE_PREFIX;
  const unique = generateId().replace(/-/g, '').substring(0, COUPON_CONFIG.CODE_LENGTH).toUpperCase();
  return `${pfx}-${unique}`;
}

function normalizeCouponCode(code) {
  if (typeof code !== 'string') return '';
  return code.trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// CRUD: createCoupon
// ---------------------------------------------------------------------------

async function createCoupon(options = {}) {
  await ensureTables();

  const {
    userId,
    discountType,
    discountValue,
    validityDays,
    code: customCode,
    minOrderAmount,
    maxUsageCount,
    description,
    restaurantId,
    hotelId,
    createdBy,
  } = options;

  // Validare userId
  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  // Validare discountType
  const finalDiscountType = discountType || 'percent';
  if (!isValidDiscountType(finalDiscountType)) {
    throw new Error(`Tipul de discount "${finalDiscountType}" nu este valid. Tipuri permise: ${VALID_DISCOUNT_TYPES.join(', ')}.`);
  }

  // Validare discountValue
  const finalDiscountValue = discountValue !== undefined ? discountValue : COUPON_CONFIG.DEFAULT_DISCOUNT_PERCENT;
  if (finalDiscountType === 'percent') {
    if (!isValidDiscountPercent(finalDiscountValue)) {
      throw new Error(`Procentajul de discount trebuie să fie între ${COUPON_CONFIG.MIN_DISCOUNT_PERCENT} și ${COUPON_CONFIG.MAX_DISCOUNT_PERCENT}.`);
    }
  } else {
    if (!isValidDiscountAmount(finalDiscountValue)) {
      throw new Error('Suma discountului trebuie să fie un număr pozitiv.');
    }
  }

  // Validare validityDays
  const finalValidityDays = validityDays !== undefined ? validityDays : COUPON_CONFIG.DEFAULT_VALIDITY_DAYS;
  if (!isValidValidityDays(finalValidityDays)) {
    throw new Error(`Valabilitatea trebuie să fie un număr întreg între ${COUPON_CONFIG.MIN_VALIDITY_DAYS} și ${COUPON_CONFIG.MAX_VALIDITY_DAYS} zile.`);
  }

  // Validare minOrderAmount
  const finalMinOrderAmount = minOrderAmount !== undefined ? minOrderAmount : 0;
  if (finalMinOrderAmount < 0 || (finalMinOrderAmount > 0 && !isValidPositiveNumber(finalMinOrderAmount))) {
    if (finalMinOrderAmount < 0) {
      throw new Error('Suma minimă a comenzii trebuie să fie un număr pozitiv.');
    }
    throw new Error('Suma minimă a comenzii trebuie să fie un număr pozitiv.');
  }
  if (finalMinOrderAmount > 0 && !isValidPositiveNumber(finalMinOrderAmount)) {
    throw new Error('Suma minimă a comenzii trebuie să fie un număr pozitiv.');
  }

  // Validare maxUsageCount
  const finalMaxUsageCount = maxUsageCount !== undefined ? maxUsageCount : 1;
  if (!isValidNonNegativeInt(finalMaxUsageCount)) {
    throw new Error('Numărul maxim de utilizări trebuie să fie un număr întreg nenegativ.');
  }

  // Validare customCode
  let finalCode;
  if (customCode !== undefined) {
    if (!isValidCouponCode(customCode)) {
      throw new Error(`Codul cuponului este invalid (minim ${COUPON_CONFIG.MIN_CODE_LENGTH} caractere, maxim ${COUPON_CONFIG.MAX_CODE_LENGTH}).`);
    }
    finalCode = customCode.trim().toUpperCase();
  } else {
    finalCode = generateCouponCode();
  }

  // Validare description
  const finalDescription = description !== undefined && description !== null ? String(description).trim() : '';

  const db = await getDb();

  // Verificare cod duplicat
  const existing = _dbGet(db, 'SELECT id FROM coupons WHERE UPPER(code) = ?', [finalCode]);
  if (existing) {
    throw new Error('Codul cuponului există deja.');
  }

  const couponId = generateId();
  const now = new Date().toISOString();
  const expiresAt = calculateExpiryDate(finalValidityDays);

  _dbRun(
    db,
    `INSERT INTO coupons
       (id, code, userId, discountType, discountValue, status, validityDays,
        minOrderAmount, maxUsageCount, currentUsageCount, usedOnOrders,
        description, restaurantId, hotelId, createdBy, createdAt, expiresAt,
        extraDays)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      couponId,
      finalCode,
      userId,
      finalDiscountType,
      finalDiscountValue,
      'active',
      finalValidityDays,
      finalMinOrderAmount,
      finalMaxUsageCount,
      0,
      '[]',
      finalDescription,
      restaurantId || null,
      hotelId || null,
      createdBy || null,
      now,
      expiresAt,
      0,
    ]
  );

  const coupon = _dbGet(db, 'SELECT * FROM coupons WHERE id = ?', [couponId]);
  return rowToCoupon(coupon);
}

// ---------------------------------------------------------------------------
// CRUD: getCouponById
// ---------------------------------------------------------------------------

async function getCouponById(id) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('ID-ul cuponului este invalid.');
  }

  await ensureTables();
  const db = await getDb();

  const row = _dbGet(db, 'SELECT * FROM coupons WHERE id = ?', [id]);
  if (!row) {
    throw new Error('Cuponul nu a fost găsit.');
  }

  return rowToCoupon(row);
}

// ---------------------------------------------------------------------------
// CRUD: getCouponByCode
// ---------------------------------------------------------------------------

async function getCouponByCode(code) {
  if (!isValidCouponCode(code)) {
    throw new Error(`Codul cuponului este invalid (minim ${COUPON_CONFIG.MIN_CODE_LENGTH} caractere, maxim ${COUPON_CONFIG.MAX_CODE_LENGTH}).`);
  }

  await ensureTables();
  const db = await getDb();

  const normalizedCode = normalizeCouponCode(code);
  const row = _dbGet(db, 'SELECT * FROM coupons WHERE UPPER(code) = ?', [normalizedCode]);
  if (!row) {
    throw new Error('Cuponul nu a fost găsit.');
  }

  return rowToCoupon(row);
}

// ---------------------------------------------------------------------------
// validateCoupon
// ---------------------------------------------------------------------------

async function validateCoupon(code, userId, context = {}) {
  if (!isValidCouponCode(code)) {
    throw new Error('Codul cuponului este invalid.');
  }

  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  await ensureTables();
  const db = await getDb();

  const normalizedCode = normalizeCouponCode(code);
  const row = _dbGet(db, 'SELECT * FROM coupons WHERE UPPER(code) = ?', [normalizedCode]);

  if (!row) {
    throw new Error('Cuponul nu există.');
  }

  const coupon = rowToCoupon(row);

  if (coupon.userId !== userId) {
    throw new Error('Acest cupon nu aparține utilizatorului curent.');
  }

  if (isCouponExpired(coupon)) {
    throw new Error('Cuponul a expirat.');
  }

  if (isCouponUsed(coupon)) {
    throw new Error('Cuponul a fost deja folosit.');
  }

  if (isCouponCancelled(coupon)) {
    throw new Error('Cuponul a fost anulat.');
  }

  // Verificare orderAmount dacă este furnizat
  const { orderAmount } = context;
  if (orderAmount !== undefined && orderAmount !== null) {
    if (!isValidPositiveNumber(orderAmount)) {
      throw new Error('Suma comenzii trebuie să fie un număr pozitiv.');
    }

    if (coupon.minOrderAmount > 0 && orderAmount < coupon.minOrderAmount) {
      throw new Error(`Suma minimă a comenzii pentru acest cupon este ${coupon.minOrderAmount}.`);
    }
  }

  return coupon;
}

// ---------------------------------------------------------------------------
// useCoupon
// ---------------------------------------------------------------------------

async function useCoupon(code, userId, orderDetails = {}) {
  if (!isValidCouponCode(code)) {
    throw new Error('Codul cuponului este invalid.');
  }

  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  await ensureTables();
  const db = await getDb();

  const normalizedCode = normalizeCouponCode(code);
  const row = _dbGet(db, 'SELECT * FROM coupons WHERE UPPER(code) = ?', [normalizedCode]);

  if (!row) {
    throw new Error('Cuponul nu există.');
  }

  const coupon = rowToCoupon(row);

  if (coupon.userId !== userId) {
    throw new Error('Acest cupon nu aparține utilizatorului curent.');
  }

  if (isCouponExpired(coupon)) {
    throw new Error('Cuponul a expirat.');
  }

  if (isCouponUsed(coupon)) {
    throw new Error('Cuponul a fost deja folosit.');
  }

  if (isCouponCancelled(coupon)) {
    throw new Error('Cuponul a fost anulat.');
  }

  // Verificare orderAmount
  const orderAmount = orderDetails.orderAmount;
  if (orderAmount !== undefined && orderAmount !== null) {
    if (!isValidPositiveNumber(orderAmount)) {
      throw new Error('Suma comenzii trebuie să fie un număr pozitiv.');
    }
    if (coupon.minOrderAmount > 0 && orderAmount < coupon.minOrderAmount) {
      throw new Error(`Suma minimă a comenzii pentru acest cupon este ${coupon.minOrderAmount}.`);
    }
  }

  const now = new Date().toISOString();
  const newUsageCount = coupon.currentUsageCount + 1;

  // Actualizare usedOnOrders
  const usedOnOrders = [...coupon.usedOnOrders];
  if (orderDetails.orderId) {
    usedOnOrders.push({
      orderId: orderDetails.orderId,
      usedAt: now,
      orderAmount: orderAmount || null,
    });
  }

  const newStatus = (coupon.maxUsageCount > 0 && newUsageCount >= coupon.maxUsageCount)
    ? 'used'
    : coupon.status;

  _dbRun(
    db,
    `UPDATE coupons
     SET currentUsageCount = ?, usedOnOrders = ?, status = ?, usedAt = ?
     WHERE id = ?`,
    [
      newUsageCount,
      JSON.stringify(usedOnOrders),
      newStatus,
      newStatus === 'used' ? now : coupon.usedAt,
      coupon.id,
    ]
  );

  const updated = _dbGet(db, 'SELECT * FROM coupons WHERE id = ?', [coupon.id]);
  return rowToCoupon(updated);
}

// ---------------------------------------------------------------------------
// cancelCoupon
// ---------------------------------------------------------------------------

async function cancelCoupon(code, userId, reason) {
  if (!isValidCouponCode(code)) {
    throw new Error('Codul cuponului este invalid.');
  }

  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  await ensureTables();
  const db = await getDb();

  const normalizedCode = normalizeCouponCode(code);
  const row = _dbGet(db, 'SELECT * FROM coupons WHERE UPPER(code) = ?', [normalizedCode]);

  if (!row) {
    throw new Error('Cuponul nu există.');
  }

  const coupon = rowToCoupon(row);

  if (coupon.userId !== userId) {
    throw new Error('Acest cupon nu aparține utilizatorului curent.');
  }

  if (coupon.status !== 'active') {
    throw new Error('Doar cupoanele cu status "active" pot fi anulate.');
  }

  if (isCouponExpired(coupon)) {
    throw new Error('Cuponul a expirat deja și nu mai poate fi anulat.');
  }

  const now = new Date().toISOString();
  const cancelReason = reason !== undefined && reason !== null ? String(reason).trim() : '';

  _dbRun(
    db,
    `UPDATE coupons
     SET status = ?, cancelledAt = ?, cancelledBy = ?, cancelledReason = ?
     WHERE id = ?`,
    ['cancelled', now, userId, cancelReason, coupon.id]
  );

  const updated = _dbGet(db, 'SELECT * FROM coupons WHERE id = ?', [coupon.id]);
  return rowToCoupon(updated);
}

// ---------------------------------------------------------------------------
// calculateDiscount
// ---------------------------------------------------------------------------

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

  await ensureTables();
  const db = await getDb();

  const normalizedCode = normalizeCouponCode(couponCode);
  const row = _dbGet(db, 'SELECT * FROM coupons WHERE UPPER(code) = ?', [normalizedCode]);

  if (!row) {
    throw new Error('Cuponul nu există.');
  }

  const coupon = rowToCoupon(row);

  if (coupon.userId !== userId) {
    throw new Error('Acest cupon nu aparține utilizatorului curent.');
  }

  if (isCouponExpired(coupon)) {
    throw new Error('Cuponul a expirat.');
  }

  if (isCouponUsed(coupon)) {
    throw new Error('Cuponul a fost deja folosit.');
  }

  if (isCouponCancelled(coupon)) {
    throw new Error('Cuponul a fost anulat.');
  }

  let discountAmount;
  if (coupon.discountType === 'percent') {
    discountAmount = (orderAmount * coupon.discountValue) / 100;
  } else {
    // fixed – nu poate depăși suma comenzii
    discountAmount = Math.min(coupon.discountValue, orderAmount);
  }

  const roundedDiscount = Math.round(discountAmount * 100) / 100;
  const finalAmount = Math.round((orderAmount - roundedDiscount) * 100) / 100;

  return {
    originalAmount: orderAmount,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    discountAmount: roundedDiscount,
    finalAmount: finalAmount < 0 ? 0 : finalAmount,
    couponCode: coupon.code,
  };
}

// ---------------------------------------------------------------------------
// getActiveCoupons
// ---------------------------------------------------------------------------

async function getActiveCoupons(userId) {
  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  await ensureTables();
  const db = await getDb();

  const now = new Date().toISOString();
  const rows = _dbAll(
    db,
    `SELECT * FROM coupons
     WHERE userId = ? AND status = 'active' AND expiresAt > ?
     ORDER BY expiresAt ASC`,
    [userId, now]
  );

  return (rows || []).map(rowToCoupon);
}

// ---------------------------------------------------------------------------
// getAllCouponsForUser
// ---------------------------------------------------------------------------

async function getAllCouponsForUser(userId, options = {}) {
  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  if (options.status && !isValidCouponStatus(options.status)) {
    throw new Error(`Statusul "${options.status}" nu este valid. Statusuri permise: ${VALID_COUPON_STATUSES.join(', ')}.`);
  }

  await ensureTables();
  const db = await getDb();

  const conditions = ['userId = ?'];
  const params = [userId];

  if (options.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }

  const whereClause = conditions.join(' AND ');

  // Sortare
  const allowedSortFields = ['createdAt', 'expiresAt', 'code', 'status', 'discountValue'];
  const sortBy = options.sortBy && allowedSortFields.includes(options.sortBy) ? options.sortBy : 'createdAt';
  const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const rows = _dbAll(
    db,
    `SELECT * FROM coupons WHERE ${whereClause} ORDER BY ${sortBy} ${sortOrder}`,
    params
  );

  return (rows || []).map(rowToCoupon);
}

// ---------------------------------------------------------------------------
// cleanupExpiredCoupons
// ---------------------------------------------------------------------------

async function cleanupExpiredCoupons(userId) {
  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  await ensureTables();
  const db = await getDb();

  const now = new Date().toISOString();

  const result = _dbRun(
    db,
    `UPDATE coupons SET status = 'expired'
     WHERE userId = ? AND status = 'active' AND expiresAt <= ?`,
    [userId, now]
  );

  return result.changes || 0;
}

// ---------------------------------------------------------------------------
// extendCouponValidity
// ---------------------------------------------------------------------------

async function extendCouponValidity(code, userId, extraDays) {
  if (!isValidCouponCode(code)) {
    throw new Error('Codul cuponului este invalid.');
  }

  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  if (!isValidPositiveNumber(extraDays) || !Number.isInteger(extraDays)) {
    throw new Error('Numărul de zile adiționale trebuie să fie un număr întreg pozitiv.');
  }

  await ensureTables();
  const db = await getDb();

  const normalizedCode = normalizeCouponCode(code);
  const row = _dbGet(db, 'SELECT * FROM coupons WHERE UPPER(code) = ?', [normalizedCode]);

  if (!row) {
    throw new Error('Cuponul nu există.');
  }

  const coupon = rowToCoupon(row);

  if (coupon.userId !== userId) {
    throw new Error('Acest cupon nu aparține utilizatorului curent.');
  }

  if (coupon.status !== 'active') {
    throw new Error('Doar cupoanele active pot fi extinse.');
  }

  if (isCouponExpired(coupon)) {
    throw new Error('Cuponul a expirat deja.');
  }

  const newValidityDays = coupon.validityDays + extraDays;
  if (newValidityDays > COUPON_CONFIG.MAX_VALIDITY_DAYS) {
    throw new Error(`Nu se pot adăuga mai mult de ${COUPON_CONFIG.MAX_VALIDITY_DAYS - coupon.validityDays} zile. Valabilitatea maximă este de ${COUPON_CONFIG.MAX_VALIDITY_DAYS} zile.`);
  }

  const newExpiresAt = new Date(coupon.expiresAt);
  newExpiresAt.setDate(newExpiresAt.getDate() + extraDays);

  _dbRun(
    db,
    `UPDATE coupons
     SET validityDays = ?, expiresAt = ?, extraDays = extraDays + ?
     WHERE id = ?`,
    [newValidityDays, newExpiresAt.toISOString(), extraDays, coupon.id]
  );

  const updated = _dbGet(db, 'SELECT * FROM coupons WHERE id = ?', [coupon.id]);
  const result = rowToCoupon(updated);
  result.extraDays = extraDays; // suprascriem pentru a returna zilele adăugate acum
  return result;
}

// ---------------------------------------------------------------------------
// getCouponStats
// ---------------------------------------------------------------------------

async function getCouponStats(userId) {
  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  await ensureTables();
  const db = await getDb();

  const stats = {
    total: 0,
    active: 0,
    used: 0,
    expired: 0,
    cancelled: 0,
  };

  const rows = _dbAll(
    db,
    `SELECT status, COUNT(*) AS cnt FROM coupons WHERE userId = ? GROUP BY status`,
    [userId]
  );

  for (const row of rows || []) {
    const cnt = row.cnt || 0;
    stats.total += cnt;
    if (row.status === 'active') stats.active = cnt;
    else if (row.status === 'used') stats.used = cnt;
    else if (row.status === 'expired') stats.expired = cnt;
    else if (row.status === 'cancelled') stats.cancelled = cnt;
  }

  return stats;
}

// ---------------------------------------------------------------------------
// deleteCoupon
// ---------------------------------------------------------------------------

async function deleteCoupon(id, userId) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('ID-ul cuponului este invalid.');
  }

  if (!isValidUserId(userId)) {
    throw new Error('ID-ul utilizatorului este invalid.');
  }

  await ensureTables();
  const db = await getDb();

  const row = _dbGet(db, 'SELECT * FROM coupons WHERE id = ?', [id]);

  if (!row) {
    throw new Error('Cuponul nu a fost găsit.');
  }

  const coupon = rowToCoupon(row);

  if (coupon.userId !== userId) {
    throw new Error('Acest cupon nu aparține utilizatorului curent.');
  }

  if (coupon.currentUsageCount > 0) {
    throw new Error('Nu se pot șterge cupoane deja folosite.');
  }

  _dbRun(db, 'DELETE FROM coupons WHERE id = ?', [id]);
  return true;
}

// ---------------------------------------------------------------------------
// getTotalCouponCount
// ---------------------------------------------------------------------------

async function getTotalCouponCount() {
  await ensureTables();
  const db = await getDb();

  const row = _dbGet(db, 'SELECT COUNT(*) AS cnt FROM coupons');
  return row ? row.cnt : 0;
}

// ---------------------------------------------------------------------------
// resetAllData
// ---------------------------------------------------------------------------

async function resetAllData() {
  try {
    await ensureTables();
    const db = await getDb();
    _dbRun(db, 'DELETE FROM coupons');
    return true;
  } catch (err) {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Configurare
  COUPON_CONFIG,
  VALID_COUPON_STATUSES,
  VALID_DISCOUNT_TYPES,

  // Validare
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

  // Verificare stare cupon
  isCouponExpired,
  isCouponUsed,
  isCouponCancelled,
  isCouponActive,

  // Utilitare
  calculateExpiryDate,
  generateCouponCode,
  normalizeCouponCode,

  // CRUD
  createCoupon,
  getCouponById,
  getCouponByCode,
  validateCoupon,
  useCoupon,
  cancelCoupon,
  calculateDiscount,
  getActiveCoupons,
  getAllCouponsForUser,
  cleanupExpiredCoupons,
  extendCouponValidity,
  getCouponStats,
  deleteCoupon,

  // Management date
  getTotalCouponCount,
  resetAllData,
};
