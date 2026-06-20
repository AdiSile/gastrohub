const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'gastrohub.db');

let db = null;

/**
 * Rulează migrări incrementale pe o bază de date existentă,
 * adăugând coloane care ar putea lipsi din versiuni anterioare.
 * @param {Object} database - Instanța sql.js Database
 */
function _applyMigrations(database) {
  // ===== users =====
  try { database.run('ALTER TABLE users ADD COLUMN name TEXT'); } catch (_) {}
  try { database.run('ALTER TABLE users ADD COLUMN phone TEXT'); } catch (_) {}
  try { database.run("ALTER TABLE users ADD COLUMN restaurante TEXT DEFAULT '[]'"); } catch (_) {}
  try { database.run('ALTER TABLE users ADD COLUMN updated_at TEXT'); } catch (_) {}

  // ===== hotels: coloane adăugate pentru hotelModel.js (snake_case) =====
  try { database.run("ALTER TABLE hotels ADD COLUMN amenities TEXT DEFAULT '[]'"); } catch (_) {}
  try { database.run("ALTER TABLE hotels ADD COLUMN description TEXT DEFAULT ''"); } catch (_) {}
  try { database.run("ALTER TABLE hotels ADD COLUMN website TEXT DEFAULT ''"); } catch (_) {}
  try { database.run("ALTER TABLE hotels ADD COLUMN images TEXT DEFAULT '[]'"); } catch (_) {}
  try { database.run("ALTER TABLE hotels ADD COLUMN status TEXT DEFAULT 'active'"); } catch (_) {}
  try { database.run("ALTER TABLE hotels ADD COLUMN total_rooms INTEGER DEFAULT 0"); } catch (_) {}
  try { database.run("ALTER TABLE hotels ADD COLUMN rating REAL DEFAULT 0"); } catch (_) {}
  try { database.run('ALTER TABLE hotels ADD COLUMN updated_at TEXT'); } catch (_) {}

  // ===== rooms: coloane adăugate pentru hotelModel.js (snake_case) =====
  try { database.run("ALTER TABLE rooms ADD COLUMN tip TEXT"); } catch (_) {}
  try { database.run("ALTER TABLE rooms ADD COLUMN numar INTEGER"); } catch (_) {}
  try { database.run("ALTER TABLE rooms ADD COLUMN preturi_sezoniere TEXT DEFAULT '[]'"); } catch (_) {}
  try { database.run('ALTER TABLE rooms ADD COLUMN floor INTEGER'); } catch (_) {}
  try { database.run('ALTER TABLE rooms ADD COLUMN capacity INTEGER DEFAULT 1'); } catch (_) {}
  try { database.run("ALTER TABLE rooms ADD COLUMN amenities TEXT DEFAULT '[]'"); } catch (_) {}
  try { database.run("ALTER TABLE rooms ADD COLUMN notes TEXT DEFAULT ''"); } catch (_) {}
  try { database.run('ALTER TABLE rooms ADD COLUMN updated_at TEXT'); } catch (_) {}

  // ===== reservations: coloane adăugate pentru hotelModel.js + reservationModel.js (snake_case) =====
  try { database.run("ALTER TABLE reservations ADD COLUMN tip TEXT DEFAULT 'hotel'"); } catch (_) {}
  try { database.run("ALTER TABLE reservations ADD COLUMN data TEXT"); } catch (_) {}
  try { database.run("ALTER TABLE reservations ADD COLUMN numar_persoane INTEGER DEFAULT 1"); } catch (_) {}
  try { database.run('ALTER TABLE reservations ADD COLUMN nume_client TEXT'); } catch (_) {}
  try { database.run('ALTER TABLE reservations ADD COLUMN email_client TEXT'); } catch (_) {}
  try { database.run('ALTER TABLE reservations ADD COLUMN telefon_client TEXT'); } catch (_) {}
  try { database.run("ALTER TABLE reservations ADD COLUMN observatii TEXT DEFAULT ''"); } catch (_) {}
  try { database.run('ALTER TABLE reservations ADD COLUMN camera INTEGER'); } catch (_) {}
  try { database.run('ALTER TABLE reservations ADD COLUMN updated_at TEXT'); } catch (_) {}
  try { database.run('ALTER TABLE reservations ADD COLUMN restaurant_id INTEGER'); } catch (_) {}
  try { database.run("ALTER TABLE reservations ADD COLUMN ora TEXT"); } catch (_) {}
  try { database.run("ALTER TABLE reservations ADD COLUMN masa INTEGER"); } catch (_) {}
  try { database.run("ALTER TABLE reservations ADD COLUMN status_facturare TEXT DEFAULT 'nefacturat'"); } catch (_) {}
  try { database.run("ALTER TABLE reservations ADD COLUMN moneda TEXT DEFAULT 'RON'"); } catch (_) {}
}

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
    phone TEXT,
    tenant_id TEXT,
    restaurante TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`);

  // Aplică migrări pentru baze de date existente (coloane adăugate ulterior)
  _applyMigrations(db);

  db.run(`CREATE TABLE IF NOT EXISTS hotels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    email TEXT,
    stars INTEGER DEFAULT 0,
    amenities TEXT DEFAULT '[]',
    description TEXT DEFAULT '',
    website TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    total_rooms INTEGER DEFAULT 0,
    rating REAL DEFAULT 0,
    tenant_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL,
    tenant_id TEXT,
    tip TEXT,
    numar INTEGER,
    preturi_sezoniere TEXT DEFAULT '[]',
    status TEXT DEFAULT 'available',
    floor INTEGER,
    capacity INTEGER DEFAULT 1,
    amenities TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    tip TEXT DEFAULT 'hotel',
    restaurant_id INTEGER,
    hotel_id INTEGER,
    room_id INTEGER,
    data TEXT,
    ora TEXT,
    numar_persoane INTEGER DEFAULT 1,
    nume_client TEXT,
    email_client TEXT,
    telefon_client TEXT,
    observatii TEXT DEFAULT '',
    masa INTEGER,
    camera INTEGER,
    check_in TEXT,
    check_out TEXT,
    status TEXT DEFAULT 'confirmata',
    status_facturare TEXT DEFAULT 'nefacturat',
    total_price REAL DEFAULT 0,
    moneda TEXT DEFAULT 'RON',
    guest_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
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

  // Index pentru căutare rapidă după email în contact_messages
  db.run(`CREATE INDEX IF NOT EXISTS idx_contact_messages_email ON contact_messages (email)`);

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