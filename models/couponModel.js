// Modificări principale:

// 1. Import – doar getDb (async)
const { getDb } = require('../config/db');

// 2. Helpers interne care folosesc db.prepare / db.run / db.exec
function _dbGet(db, sql, params)   { ... stmt = db.prepare(sql); ... }
function _dbAll(db, sql, params)   { ... stmt = db.prepare(sql); ... }
function _dbRun(db, sql, params)   { db.run(sql, params); db.exec('SELECT changes() AS cnt'); ... }

// 3. ensureTables – async, folosește await getDb() + db.run()
async function ensureTables() {
  if (_tablesEnsured) return;
  const db = await getDb();
  db.run(`CREATE TABLE IF NOT EXISTS coupons ...`);
  ...
}

// 4. Toate funcțiile CRUD – async/await, fără new Promise wrapper
async function createCoupon(options) {
  await ensureTables();
  const db = await getDb();
  ...
  _dbRun(db, 'INSERT ...', [...]);
  const coupon = _dbGet(db, 'SELECT ...', [...]);
  return parseUsedOnOrders(coupon);
}
// (același pattern pentru getCouponById, getCouponByCode, validateCoupon, etc.)