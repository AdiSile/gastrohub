const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'gastrohub.db');

let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  // Creează directorul data dacă nu există
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Încarcă sau creează baza de date
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Creează tabelele
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'client',
    name TEXT,
    tenant_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS hotels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    email TEXT,
    stars INTEGER DEFAULT 3,
    tenant_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL,
    room_number TEXT NOT NULL,
    type TEXT DEFAULT 'standard',
    price REAL DEFAULT 0,
    status TEXT DEFAULT 'available',
    tenant_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER,
    hotel_id INTEGER,
    room_id INTEGER,
    check_in TEXT,
    check_out TEXT,
    status TEXT DEFAULT 'pending',
    total_price REAL DEFAULT 0,
    tenant_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS restaurants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    capacity INTEGER DEFAULT 0,
    tenant_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price REAL DEFAULT 0,
    category TEXT,
    allergens TEXT,
    available INTEGER DEFAULT 1,
    tenant_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER,
    table_number TEXT,
    items TEXT,
    total_price REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    payment_method TEXT,
    tenant_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    quantity REAL DEFAULT 0,
    unit TEXT DEFAULT 'buc',
    min_quantity REAL DEFAULT 0,
    price_per_unit REAL DEFAULT 0,
    location TEXT,
    tenant_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT,
    phone TEXT,
    email TEXT,
    products TEXT,
    tenant_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS loyalty (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    points INTEGER DEFAULT 0,
    total_spent REAL DEFAULT 0,
    tenant_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    message TEXT,
    read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    settings TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Seed admin
  const existing = db.exec("SELECT id FROM users WHERE email = 'super_admin@gastrohub.io'");
  if (!existing.length || existing[0].values.length === 0) {
    const hash = bcrypt.hashSync('admin123', 12);
    db.run("INSERT INTO users (email, password, role, name) VALUES (?, ?, ?, ?)",
      ['super_admin@gastrohub.io', hash, 'super_admin', 'Super Admin']);
  }

  return db;
}

function saveDb() {
  if (db) {
    const buffer = Buffer.from(db.export());
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// ---------------------------------------------------------------------------
// Helperi SQLite – wrapper-e peste db.run / db.prepare pentru utilizare directă
// (auto-inițializează dacă db nu e încă pornit – pentru compatibilitate)
// ---------------------------------------------------------------------------

async function _ensureDb() {
  if (!db) await getDb();
  return db;
}

/**
 * Execută o interogare INSERT/UPDATE/DELETE și returnează { changes, lastInsertRowid }.
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Promise<{ changes: number, lastInsertRowid: number }>}
 */
async function run(sql, params = []) {
  const d = await _ensureDb();
  d.run(sql, params);
  const changesRes = d.exec('SELECT changes() AS cnt');
  const lastIdRes = d.exec('SELECT last_insert_rowid() AS id');
  return {
    changes: (changesRes.length > 0 && changesRes[0].values.length > 0) ? changesRes[0].values[0][0] : 0,
    lastInsertRowid: (lastIdRes.length > 0 && lastIdRes[0].values.length > 0) ? lastIdRes[0].values[0][0] : 0,
  };
}

/**
 * Execută o interogare SELECT și returnează primul rând (obiect) sau undefined.
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Promise<Object|undefined>}
 */
async function get(sql, params = []) {
  const d = await _ensureDb();
  const stmt = d.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  let row;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

/**
 * Execută o interogare SELECT și returnează toate rândurile ca array.
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Promise<Array<Object>>}
 */
async function all(sql, params = []) {
  const d = await _ensureDb();
  const stmt = d.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

module.exports = { getDb, saveDb, run, get, all };