/**
 * ============================================================
 * config/db.js — Inițializare SQLite (sql.js) partajat
 * ============================================================
 *
 * Responsabilități:
 *  - Încarcă sau creează baza de date SQLite (fișier: data/gastrohub.db)
 *  - Creează toate tabelele necesare (schema completă)
 *  - Expune metodele run(), get(), all() și getDb() pentru interogări
 *  - Expune wrapper-e de compatibilitate users, tenants cu API similar NeDB
 *
 * Backend: sql.js (SQLite compilat în WebAssembly/asm.js)
 *
 * Folosire:
 *    const { getDb, run, get, all, users, tenants } = require('../config/db');
 *    const db = await getDb();
 *    const row = await get('SELECT * FROM tenants WHERE slug = ?', [slug]);
 *
 * ============================================================
 */

const path = require('path');
const fs   = require('fs');

// ---------------------------------------------------------------------------
// sql.js — inițializare asincronă
// ---------------------------------------------------------------------------

/** @type {import('sql.js').SqlJsStatic|null} */
let SQL = null;

/**
 * Funcția initSqlJs — factory-ul asincron exportat de sql.js.
 * @type {Function|null}
 */
let initSqlJs = null;

try {
  initSqlJs = require('sql.js');
} catch (_err) {
  console.error('[db] Eroare la încărcarea sql.js. Verifică npm install.');
  initSqlJs = null;
}

// ---------------------------------------------------------------------------
// Variabilă singleton pentru instanța bazei de date
// ---------------------------------------------------------------------------

/** @type {import('sql.js').Database|null} */
let _db = null;

/** @type {Promise<void>|null} Promisiunea de inițializare */
let _initPromise = null;

// ---------------------------------------------------------------------------
// Calea fișierului de date
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data'));
const DB_PATH = path.join(DATA_DIR, 'gastrohub.db');

// ---------------------------------------------------------------------------
// Funcții de inițializare
// ---------------------------------------------------------------------------

/**
 * Asigură existența directorului de date.
 */
function _ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Încarcă baza de date din fișier sau creează una nouă.
 * @returns {import('sql.js').Database}
 */
function _loadOrCreateDb() {
  _ensureDataDir();

  if (fs.existsSync(DB_PATH)) {
    try {
      const buffer = fs.readFileSync(DB_PATH);
      return new SQL.Database(buffer);
    } catch (err) {
      console.error('[db] Eroare la încărcarea bazei de date existente:', err.message);
      console.warn('[db] Se creează o bază de date nouă.');
    }
  }

  return new SQL.Database();
}

/**
 * Salvează baza de date pe disc.
 * Folosită la shutdown și poate fi apelată manual.
 */
function _saveToDisk() {
  if (!_db) return;
  try {
    const data = _db.export();
    const buffer = Buffer.from(data);
    _ensureDataDir();
    fs.writeFileSync(DB_PATH, buffer);
    console.log('[db] Baza de date salvată pe disc:', DB_PATH);
  } catch (err) {
    console.error('[db] Eroare la salvarea bazei de date:', err.message);
  }
}

/**
 * Înregistrează handler-e pentru salvarea bazei la shutdown.
 */
function _registerShutdownHandlers() {
  const handleShutdown = (signal) => {
    console.log(`[db] Primit semnal ${signal} — se salvează baza de date...`);
    _saveToDisk();
    if (signal === 'SIGINT' || signal === 'SIGTERM') {
      process.exit(0);
    }
  };

  // SIGINT  — Ctrl+C
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  // SIGTERM — kill
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  // exit    — procesul se termină normal
  process.on('exit', () => {
    // La acest moment doar operații sincrone sunt permise în handler-ul 'exit'
    if (_db) {
      try {
        _saveToDisk();
      } catch (_) { /* ignorăm erorile la exit */ }
    }
  });

  // uncaughtException — crash neașteptat
  process.on('uncaughtException', (err) => {
    console.error('[db] Excepție neprinsă:', err.message);
    _saveToDisk();
    process.exit(1);
  });

  console.log('[db] Handler-e de shutdown înregistrate.');
}

/**
 * Inițializează baza de date asincron.
 * @returns {Promise<void>}
 */
async function _initialize() {
  if (!initSqlJs) {
    throw new Error('[db] sql.js nu este disponibil. Verifică npm install.');
  }

  try {
    SQL = await initSqlJs();
    console.log('[db] sql.js (WebAssembly) încărcat cu succes.');
  } catch (err) {
    console.error('[db] Eroare la inițializarea sql.js (WebAssembly):', err.message);
    throw err;
  }

  _db = _loadOrCreateDb();
  _createTables(_db);
  _registerShutdownHandlers();
  console.log('[db] Baza de date SQLite inițializată cu succes.');
}

// ---------------------------------------------------------------------------
// Pornire eager a inițializării (promisiunea e stocată, nu blocăm event loop-ul)
// ---------------------------------------------------------------------------

if (initSqlJs) {
  _initPromise = _initialize().catch((err) => {
    console.error('[db] Inițializarea bazei de date a eșuat:', err.message);
    _initPromise = null; // permite reîncercare la următorul apel getDb()
  });
} else {
  console.error('[db] Nu s-a putut încărca sql.js. Baza de date nu este disponibilă.');
}

// ---------------------------------------------------------------------------
// Creare tabele
// ---------------------------------------------------------------------------

/**
 * Creează toate tabelele necesare (IF NOT EXISTS).
 * @param {import('sql.js').Database} db
 */
function _createTables(db) {
  /**
   * Execută SQL-ul dat pe instanța db.
   * @param {string} sql
   */
  function exec(sql) {
    db.run(sql);
  }

  // ── users ────────────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT    NOT NULL UNIQUE,
      password    TEXT    NOT NULL,
      role        TEXT    NOT NULL DEFAULT 'client',
      tenantId    TEXT,
      restaurante TEXT    DEFAULT '[]',
      createdAt   TEXT    DEFAULT (datetime('now')),
      updatedAt   TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);');
  exec('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);');
  exec('CREATE INDEX IF NOT EXISTS idx_users_tenantId ON users(tenantId);');

  // ── tenants ──────────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT    NOT NULL,
      slug      TEXT    NOT NULL UNIQUE,
      settings  TEXT    DEFAULT '{}',
      createdAt TEXT    DEFAULT (datetime('now')),
      updatedAt TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);');

  // ── restaurants ──────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      address     TEXT    NOT NULL,
      tableCount  INTEGER DEFAULT 0,
      tenantId    TEXT    NOT NULL,
      phone       TEXT    DEFAULT '',
      email       TEXT    DEFAULT '',
      status      TEXT    DEFAULT 'active',
      createdAt   TEXT    DEFAULT (datetime('now')),
      updatedAt   TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_restaurants_tenantId ON restaurants(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_restaurants_status ON restaurants(status);');

  // ── hotels ───────────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS hotels (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenantId    TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      address     TEXT    NOT NULL,
      stars       INTEGER DEFAULT 0,
      amenities   TEXT    DEFAULT '[]',
      description TEXT    DEFAULT '',
      phone       TEXT    DEFAULT '',
      email       TEXT    DEFAULT '',
      website     TEXT    DEFAULT '',
      images      TEXT    DEFAULT '[]',
      totalRooms  INTEGER DEFAULT 0,
      status      TEXT    DEFAULT 'activ',
      rating      REAL    DEFAULT 0,
      createdAt   TEXT    DEFAULT (datetime('now')),
      updatedAt   TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_hotels_tenantId ON hotels(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_hotels_status ON hotels(status);');

  // ── rooms ────────────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      hotelId          TEXT    NOT NULL,
      tenantId         TEXT    NOT NULL,
      tip              TEXT    NOT NULL,
      numar            INTEGER NOT NULL,
      preturiSezoniere TEXT    DEFAULT '[]',
      status           TEXT    DEFAULT 'available',
      floor            INTEGER,
      capacity         INTEGER DEFAULT 1,
      amenities        TEXT    DEFAULT '[]',
      notes            TEXT    DEFAULT '',
      createdAt        TEXT    DEFAULT (datetime('now')),
      updatedAt        TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_rooms_hotelId ON rooms(hotelId);');
  exec('CREATE INDEX IF NOT EXISTS idx_rooms_tenantId ON rooms(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);');

  // ── reservations ─────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS reservations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tenantId        TEXT    NOT NULL,
      tip             TEXT    NOT NULL DEFAULT 'restaurant',
      hotelId         TEXT,
      restaurantId    TEXT,
      data            TEXT    NOT NULL,
      ora             TEXT,
      numarPersoane   INTEGER NOT NULL DEFAULT 1,
      numeClient      TEXT    NOT NULL,
      emailClient     TEXT    DEFAULT '',
      telefonClient   TEXT    DEFAULT '',
      observatii      TEXT    DEFAULT '',
      masa            INTEGER,
      camera          TEXT,
      checkIn         TEXT,
      checkOut        TEXT,
      status          TEXT    DEFAULT 'confirmată',
      statusFacturare TEXT    DEFAULT 'nefacturată',
      sumaTotala      REAL    DEFAULT 0,
      moneda          TEXT    DEFAULT 'RON',
      guestId         TEXT,
      createdAt       TEXT    DEFAULT (datetime('now')),
      updatedAt       TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_reservations_tenantId ON reservations(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_reservations_hotelId ON reservations(hotelId);');
  exec('CREATE INDEX IF NOT EXISTS idx_reservations_restaurantId ON reservations(restaurantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);');
  exec('CREATE INDEX IF NOT EXISTS idx_reservations_data ON reservations(data);');
  exec('CREATE INDEX IF NOT EXISTS idx_reservations_guestId ON reservations(guestId);');

  // ── orders ───────────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tenantId        TEXT    NOT NULL,
      restaurantId    TEXT    NOT NULL,
      items           TEXT    NOT NULL DEFAULT '[]',
      status          TEXT    NOT NULL DEFAULT 'nou',
      paymentMethod   TEXT    DEFAULT 'cash',
      tableNumber     INTEGER,
      subtotal        REAL    DEFAULT 0,
      tax             REAL    DEFAULT 0,
      total           REAL    DEFAULT 0,
      notes           TEXT    DEFAULT '',
      createdAt       TEXT    DEFAULT (datetime('now')),
      updatedAt       TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_orders_tenantId ON orders(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_orders_restaurantId ON orders(restaurantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);');

  // ── menu_items ───────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenantId     TEXT    NOT NULL,
      restaurantId TEXT    NOT NULL,
      name         TEXT    NOT NULL,
      description  TEXT    DEFAULT '',
      price        REAL    NOT NULL DEFAULT 0,
      currency     TEXT    DEFAULT 'RON',
      category     TEXT    DEFAULT 'altele',
      image        TEXT,
      allergens    TEXT    DEFAULT '[]',
      available    INTEGER DEFAULT 1,
      createdAt    TEXT    DEFAULT (datetime('now')),
      updatedAt    TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_menu_items_tenantId ON menu_items(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_menu_items_restaurantId ON menu_items(restaurantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category);');

  // ── customers ────────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenantId  TEXT    NOT NULL,
      name      TEXT    NOT NULL,
      email     TEXT    DEFAULT '',
      phone     TEXT    DEFAULT '',
      address   TEXT    DEFAULT '',
      notes     TEXT    DEFAULT '',
      createdAt TEXT    DEFAULT (datetime('now')),
      updatedAt TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_customers_tenantId ON customers(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);');

  // ── coupons ──────────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS coupons (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tenantId        TEXT    NOT NULL,
      code            TEXT    NOT NULL UNIQUE,
      discountPercent REAL    DEFAULT 10,
      discountValue   REAL    DEFAULT 0,
      minOrderValue   REAL    DEFAULT 0,
      maxUses         INTEGER DEFAULT 100,
      usedCount       INTEGER DEFAULT 0,
      expiresAt       TEXT,
      status          TEXT    DEFAULT 'active',
      createdAt       TEXT    DEFAULT (datetime('now')),
      updatedAt       TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_coupons_tenantId ON coupons(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);');

  // ── inventory_items ──────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      category    TEXT    NOT NULL,
      quantity    REAL    NOT NULL DEFAULT 0,
      unit        TEXT    NOT NULL DEFAULT 'buc',
      minQuantity REAL    DEFAULT 0,
      maxQuantity REAL,
      price       REAL    DEFAULT 0,
      currency    TEXT    DEFAULT 'RON',
      sku         TEXT,
      description TEXT    DEFAULT '',
      expiryDate  TEXT,
      status      TEXT    DEFAULT 'active',
      location    TEXT    NOT NULL,
      supplierId  TEXT,
      tenantId    TEXT    NOT NULL,
      createdAt   TEXT    DEFAULT (datetime('now')),
      updatedAt   TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_inventory_items_tenantId ON inventory_items(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category);');
  exec('CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON inventory_items(location);');

  // ── inventory_transactions ───────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenantId     TEXT    NOT NULL,
      itemId       TEXT    NOT NULL,
      type         TEXT    NOT NULL,
      quantity     REAL    NOT NULL DEFAULT 0,
      previousQty  REAL    DEFAULT 0,
      newQty       REAL    DEFAULT 0,
      referenceId  TEXT,
      referenceType TEXT,
      notes        TEXT    DEFAULT '',
      performedBy  TEXT,
      createdAt    TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_inventory_tx_tenantId ON inventory_transactions(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_inventory_tx_itemId ON inventory_transactions(itemId);');
  exec('CREATE INDEX IF NOT EXISTS idx_inventory_tx_type ON inventory_transactions(type);');
  exec('CREATE INDEX IF NOT EXISTS idx_inventory_tx_createdAt ON inventory_transactions(createdAt);');

  // ── suppliers ────────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenantId  TEXT    NOT NULL,
      name      TEXT    NOT NULL,
      contact   TEXT    DEFAULT '',
      phone     TEXT    DEFAULT '',
      email     TEXT    DEFAULT '',
      address   TEXT    DEFAULT '',
      taxId     TEXT,
      status    TEXT    DEFAULT 'activ',
      notes     TEXT    DEFAULT '',
      createdAt TEXT    DEFAULT (datetime('now')),
      updatedAt TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_suppliers_tenantId ON suppliers(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status);');
  exec('CREATE INDEX IF NOT EXISTS idx_suppliers_taxId ON suppliers(taxId);');

  // ── deliveries ───────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS deliveries (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      supplierId         TEXT    NOT NULL,
      items              TEXT    NOT NULL DEFAULT '[]',
      status             TEXT    NOT NULL DEFAULT 'comandată',
      totalValue         REAL    DEFAULT 0,
      orderDate          TEXT    DEFAULT (datetime('now')),
      estimatedDelivery  TEXT,
      actualDelivery     TEXT,
      notes              TEXT    DEFAULT '',
      locationId         TEXT    NOT NULL,
      locationType       TEXT    NOT NULL,
      tenantId           TEXT    NOT NULL,
      createdAt          TEXT    DEFAULT (datetime('now')),
      updatedAt          TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_deliveries_tenantId ON deliveries(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_deliveries_supplierId ON deliveries(supplierId);');
  exec('CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);');
  exec('CREATE INDEX IF NOT EXISTS idx_deliveries_orderDate ON deliveries(orderDate);');

  // ── hr_employees ─────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS hr_employees (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenantId   TEXT    NOT NULL,
      userId     TEXT,
      firstName  TEXT    NOT NULL,
      lastName   TEXT    NOT NULL,
      email      TEXT    DEFAULT '',
      phone      TEXT    DEFAULT '',
      position   TEXT    NOT NULL,
      department TEXT    DEFAULT '',
      salary     REAL    DEFAULT 0,
      hireDate   TEXT,
      status     TEXT    DEFAULT 'activ',
      createdAt  TEXT    DEFAULT (datetime('now')),
      updatedAt  TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_hr_employees_tenantId ON hr_employees(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_hr_employees_status ON hr_employees(status);');

  // ── attendance ───────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS attendance (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenantId   TEXT    NOT NULL,
      employeeId TEXT    NOT NULL,
      date       TEXT    NOT NULL,
      checkIn    TEXT,
      checkOut   TEXT,
      status     TEXT    DEFAULT 'prezent',
      notes      TEXT    DEFAULT '',
      createdAt  TEXT    DEFAULT (datetime('now')),
      updatedAt  TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_attendance_tenantId ON attendance(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_attendance_employeeId ON attendance(employeeId);');
  exec('CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);');

  // ── salaries ─────────────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS salaries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenantId   TEXT    NOT NULL,
      employeeId TEXT    NOT NULL,
      month      TEXT    NOT NULL,
      baseSalary REAL    DEFAULT 0,
      bonuses    REAL    DEFAULT 0,
      deductions REAL    DEFAULT 0,
      netSalary  REAL    DEFAULT 0,
      paid       INTEGER DEFAULT 0,
      paidDate   TEXT,
      notes      TEXT    DEFAULT '',
      createdAt  TEXT    DEFAULT (datetime('now')),
      updatedAt  TEXT    DEFAULT (datetime('now'))
    );
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_salaries_tenantId ON salaries(tenantId);');
  exec('CREATE INDEX IF NOT EXISTS idx_salaries_employeeId ON salaries(employeeId);');
  exec('CREATE INDEX IF NOT EXISTS idx_salaries_month ON salaries(month);');

  // ── loyalty_accounts ─────────────────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS loyalty_accounts (
      userId         TEXT    PRIMARY KEY,
      totalPoints    INTEGER NOT NULL DEFAULT 0,
      lifetimePoints INTEGER NOT NULL DEFAULT 0,
      activeCoupons  INTEGER NOT NULL DEFAULT 0,
      createdAt      TEXT    DEFAULT (datetime('now')),
      updatedAt      TEXT    DEFAULT (datetime('now'))
    );
  `);

  // ── loyalty_coupons ──────────────────────────────────────────────────────
  exec(`
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
  exec('CREATE INDEX IF NOT EXISTS idx_loyalty_coupons_userId ON loyalty_coupons(userId);');
  exec('CREATE INDEX IF NOT EXISTS idx_loyalty_coupons_code ON loyalty_coupons(code);');
  exec('CREATE INDEX IF NOT EXISTS idx_loyalty_coupons_status ON loyalty_coupons(status);');

  console.log('[db] Toate tabelele au fost create/verificate cu succes.');
}

// ---------------------------------------------------------------------------
// API public: getDb (async) / run / get / all
// ---------------------------------------------------------------------------

/**
 * Returnează instanța bazei de date sql.js (async).
 * Așteaptă finalizarea inițializării dacă este necesar.
 * @returns {Promise<import('sql.js').Database>}
 */
async function getDb() {
  // Dacă există deja o promisiune de inițializare, o așteptăm
  if (_initPromise) {
    await _initPromise;
  }

  // Dacă _db e null dar _initPromise a fost resetat (eroare), reîncercăm
  if (!_db) {
    _initPromise = _initialize().catch((err) => {
      console.error('[db] Reîncercarea inițializării a eșuat:', err.message);
      _initPromise = null;
    });
    await _initPromise;
  }

  if (!_db) {
    throw new Error('[db] Baza de date nu este inițializată. Verifică instalarea sql.js.');
  }

  return _db;
}

/**
 * Execută o interogare SQL și returnează { changes, lastInsertRowid }.
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Promise<{ changes: number, lastInsertRowid: number }>}
 */
async function run(sql, params = []) {
  const db = await getDb();
  db.run(sql, params);
  // sql.js nu returnează automat lastInsertRowid și changes,
  // așa că le extragem manual
  const lastId = db.exec('SELECT last_insert_rowid() AS id');
  const changes = db.exec('SELECT changes() AS cnt');
  return {
    changes: (changes.length > 0 && changes[0].values.length > 0) ? changes[0].values[0][0] : 0,
    lastInsertRowid: (lastId.length > 0 && lastId[0].values.length > 0) ? lastId[0].values[0][0] : 0,
  };
}

/**
 * Execută o interogare SQL și returnează primul rând sau undefined.
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Promise<Object|undefined>}
 */
async function get(sql, params = []) {
  const db = await getDb();
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  let row;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

/**
 * Execută o interogare SQL și returnează toate rândurile ca array.
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Promise<Array<Object>>}
 */
async function all(sql, params = []) {
  const db = await getDb();
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// ---------------------------------------------------------------------------
// Wrapper de compatibilitate: users (API similar cu NeDB)
// ---------------------------------------------------------------------------

const users = {
  /**
   * Găsește un utilizator după criterii.
   * @param {Object} query - Criterii de căutare (ex: { email: '...' } sau { _id: '...' })
   * @param {Function} cb - Callback (err, doc)
   */
  findOne(query, cb) {
    (async () => {
      try {
        let sql, params;
        if (query._id) {
          sql = 'SELECT * FROM users WHERE id = ?';
          params = [parseInt(query._id, 10)];
        } else if (query.email) {
          sql = 'SELECT * FROM users WHERE email = ?';
          params = [query.email.toLowerCase().trim()];
        } else {
          // Căutare generică — construim WHERE din chei
          const keys = Object.keys(query);
          const conditions = keys.map((k) => `${k} = ?`);
          sql = `SELECT * FROM users WHERE ${conditions.join(' AND ')} LIMIT 1`;
          params = keys.map((k) => query[k]);
        }
        const row = await get(sql, params);
        if (row) {
          row._id = String(row.id);
        }
        cb(null, row || null);
      } catch (err) {
        cb(err, null);
      }
    })();
  },

  /**
   * Găsește utilizatori după criterii.
   * @param {Object} query
   * @returns {{ sort: Function, limit: Function, exec: Function }}
   */
  find(query) {
    const self = this;
    let _sortField = null;
    let _sortDir = 'ASC';
    let _limit = null;
    let _skip = null;

    const builder = {
      sort(sortObj) {
        if (sortObj && typeof sortObj === 'object') {
          const keys = Object.keys(sortObj);
          if (keys.length > 0) {
            _sortField = keys[0];
            _sortDir = sortObj[keys[0]] === -1 ? 'DESC' : 'ASC';
          }
        }
        return this;
      },
      limit(n) {
        _limit = n;
        return this;
      },
      skip(n) {
        _skip = n;
        return this;
      },
      exec(cb) {
        (async () => {
          try {
            const keys = Object.keys(query);
            const conditions = keys.map((k) => `${k} = ?`);
            let sql = `SELECT * FROM users WHERE ${conditions.join(' AND ')}`;
            const params = keys.map((k) => query[k]);

            if (_sortField) {
              sql += ` ORDER BY ${_sortField} ${_sortDir}`;
            }
            if (_limit !== null) {
              sql += ` LIMIT ${_limit}`;
            }
            if (_skip !== null) {
              sql += ` OFFSET ${_skip}`;
            }

            const rows = await all(sql, params);
            const docs = rows.map((r) => { r._id = String(r.id); return r; });
            cb(null, docs);
          } catch (err) {
            cb(err, []);
          }
        })();
      },
    };
    return builder;
  },

  /**
   * Numără utilizatorii după criterii.
   * @param {Object} query
   * @param {Function} cb
   */
  count(query, cb) {
    (async () => {
      try {
        const keys = Object.keys(query);
        let sql, params;
        if (keys.length === 0) {
          sql = 'SELECT COUNT(*) AS cnt FROM users';
          params = [];
        } else {
          const conditions = keys.map((k) => `${k} = ?`);
          sql = `SELECT COUNT(*) AS cnt FROM users WHERE ${conditions.join(' AND ')}`;
          params = keys.map((k) => query[k]);
        }
        const row = await get(sql, params);
        cb(null, row ? row.cnt : 0);
      } catch (err) {
        cb(err, 0);
      }
    })();
  },

  /**
   * Inserează un utilizator.
   * @param {Object} doc
   * @param {Function} cb
   */
  insert(doc, cb) {
    (async () => {
      try {
        const now = new Date().toISOString();
        const result = await run(
          `INSERT INTO users (email, password, role, tenantId, restaurante, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            doc.email || '',
            doc.password || '',
            doc.role || 'client',
            doc.tenantId || null,
            typeof doc.restaurante === 'string' ? doc.restaurante : JSON.stringify(doc.restaurante || []),
            doc.createdAt || now,
            doc.updatedAt || now,
          ]
        );
        const newDoc = await get('SELECT * FROM users WHERE id = ?', [result.lastInsertRowid]);
        if (newDoc) newDoc._id = String(newDoc.id);
        cb(null, newDoc);
      } catch (err) {
        cb(err, null);
      }
    })();
  },

  /**
   * Actualizează un utilizator.
   * @param {Object} query
   * @param {Object} update
   * @param {Object} [options]
   * @param {Function} cb
   */
  update(query, update, options, cb) {
    if (typeof options === 'function') { cb = options; options = {}; }
    (async () => {
      try {
        const setOps = update.$set || update;
        const setKeys = Object.keys(setOps);
        const setClauses = setKeys.map((k) => `${k} = ?`);
        const setParams = setKeys.map((k) => setOps[k]);

        const qKeys = Object.keys(query);
        const qConditions = qKeys.map((k) => `${k} = ?`);
        const qParams = qKeys.map((k) => query[k]);

        const now = new Date().toISOString();
        setClauses.push('updatedAt = ?');
        setParams.push(now);

        const result = await run(
          `UPDATE users SET ${setClauses.join(', ')} WHERE ${qConditions.join(' AND ')}`,
          [...setParams, ...qParams]
        );
        cb(null, result.changes);
      } catch (err) {
        cb(err, 0);
      }
    })();
  },

  /**
   * Șterge utilizatori.
   * @param {Object} query
   * @param {Object} [options]
   * @param {Function} cb
   */
  remove(query, options, cb) {
    if (typeof options === 'function') { cb = options; options = {}; }
    (async () => {
      try {
        const keys = Object.keys(query);
        const conditions = keys.map((k) => `${k} = ?`);
        const params = keys.map((k) => query[k]);
        const result = await run(
          `DELETE FROM users WHERE ${conditions.join(' AND ')}`,
          params
        );
        cb(null, result.changes);
      } catch (err) {
        cb(err, 0);
      }
    })();
  },
};

// ---------------------------------------------------------------------------
// Wrapper de compatibilitate: tenants (API similar cu NeDB)
// ---------------------------------------------------------------------------

const tenants = {
  /**
   * Găsește un tenant după criterii.
   * @param {Object} query
   * @param {Function} cb
   */
  findOne(query, cb) {
    (async () => {
      try {
        let sql, params;
        if (query._id) {
          sql = 'SELECT * FROM tenants WHERE id = ?';
          params = [parseInt(query._id, 10)];
        } else if (query.slug) {
          sql = 'SELECT * FROM tenants WHERE slug = ?';
          params = [query.slug];
        } else {
          const keys = Object.keys(query);
          const conditions = keys.map((k) => `${k} = ?`);
          sql = `SELECT * FROM tenants WHERE ${conditions.join(' AND ')} LIMIT 1`;
          params = keys.map((k) => query[k]);
        }
        const row = await get(sql, params);
        if (row) {
          row._id = String(row.id);
          // Parsează settings dacă e JSON
          if (typeof row.settings === 'string') {
            try { row.config = JSON.parse(row.settings); } catch (_e) { row.config = {}; }
          } else {
            row.config = row.settings || {};
          }
        }
        cb(null, row || null);
      } catch (err) {
        cb(err, null);
      }
    })();
  },

  /**
   * Găsește tenant-i după criterii.
   * @param {Object} query
   * @returns {{ sort: Function, limit: Function, exec: Function }}
   */
  find(query) {
    let _sortField = null;
    let _sortDir = 'ASC';
    let _limit = null;

    const builder = {
      sort(sortObj) {
        if (sortObj && typeof sortObj === 'object') {
          const keys = Object.keys(sortObj);
          if (keys.length > 0) {
            _sortField = keys[0];
            _sortDir = sortObj[keys[0]] === -1 ? 'DESC' : 'ASC';
          }
        }
        return this;
      },
      limit(n) {
        _limit = n;
        return this;
      },
      exec(cb) {
        (async () => {
          try {
            const keys = Object.keys(query || {});
            let sql, params;
            if (keys.length === 0) {
              sql = 'SELECT * FROM tenants';
              params = [];
            } else {
              const conditions = keys.map((k) => `${k} = ?`);
              sql = `SELECT * FROM tenants WHERE ${conditions.join(' AND ')}`;
              params = keys.map((k) => query[k]);
            }

            if (_sortField) {
              sql += ` ORDER BY ${_sortField} ${_sortDir}`;
            }
            if (_limit !== null) {
              sql += ` LIMIT ${_limit}`;
            }

            const rows = await all(sql, params);
            const docs = rows.map((r) => {
              r._id = String(r.id);
              if (typeof r.settings === 'string') {
                try { r.config = JSON.parse(r.settings); } catch (_e) { r.config = {}; }
              } else {
                r.config = r.settings || {};
              }
              return r;
            });
            cb(null, docs);
          } catch (err) {
            cb(err, []);
          }
        })();
      },
    };
    return builder;
  },

  /**
   * Numără tenant-ii.
   * @param {Object} query
   * @param {Function} cb
   */
  count(query, cb) {
    (async () => {
      try {
        const keys = Object.keys(query || {});
        let sql, params;
        if (keys.length === 0) {
          sql = 'SELECT COUNT(*) AS cnt FROM tenants';
          params = [];
        } else {
          const conditions = keys.map((k) => `${k} = ?`);
          sql = `SELECT COUNT(*) AS cnt FROM tenants WHERE ${conditions.join(' AND ')}`;
          params = keys.map((k) => query[k]);
        }
        const row = await get(sql, params);
        cb(null, row ? row.cnt : 0);
      } catch (err) {
        cb(err, 0);
      }
    })();
  },

  /**
   * Inserează un tenant.
   * @param {Object} doc
   * @param {Function} cb
   */
  insert(doc, cb) {
    (async () => {
      try {
        const now = new Date().toISOString();
        const settings = doc.config || doc.settings || {};
        const result = await run(
          `INSERT INTO tenants (name, slug, settings, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?)`,
          [
            doc.name || '',
            doc.slug || '',
            typeof settings === 'string' ? settings : JSON.stringify(settings),
            doc.createdAt || now,
            doc.updatedAt || now,
          ]
        );
        const newDoc = await get('SELECT * FROM tenants WHERE id = ?', [result.lastInsertRowid]);
        if (newDoc) {
          newDoc._id = String(newDoc.id);
          if (typeof newDoc.settings === 'string') {
            try { newDoc.config = JSON.parse(newDoc.settings); } catch (_e) { newDoc.config = {}; }
          }
        }
        cb(null, newDoc);
      } catch (err) {
        cb(err, null);
      }
    })();
  },

  /**
   * Actualizează un tenant.
   * @param {Object} query
   * @param {Object} update
   * @param {Object} [options]
   * @param {Function} cb
   */
  update(query, update, options, cb) {
    if (typeof options === 'function') { cb = options; options = {}; }
    (async () => {
      try {
        const setOps = update.$set || update;
        const setKeys = Object.keys(setOps);
        const setClauses = setKeys.map((k) => `${k} = ?`);
        const setParams = setKeys.map((k) => {
          if (k === 'config' || k === 'settings') {
            return typeof setOps[k] === 'string' ? setOps[k] : JSON.stringify(setOps[k]);
          }
          return setOps[k];
        });

        const qKeys = Object.keys(query);
        const qConditions = qKeys.map((k) => `${k} = ?`);
        const qParams = qKeys.map((k) => query[k]);

        const now = new Date().toISOString();
        setClauses.push('updatedAt = ?');
        setParams.push(now);

        const result = await run(
          `UPDATE tenants SET ${setClauses.join(', ')} WHERE ${qConditions.join(' AND ')}`,
          [...setParams, ...qParams]
        );
        cb(null, result.changes);
      } catch (err) {
        cb(err, 0);
      }
    })();
  },

  /**
   * Șterge tenant-i.
   * @param {Object} query
   * @param {Object} [options]
   * @param {Function} cb
   */
  remove(query, options, cb) {
    if (typeof options === 'function') { cb = options; options = {}; }
    (async () => {
      try {
        const keys = Object.keys(query);
        const conditions = keys.map((k) => `${k} = ?`);
        const params = keys.map((k) => query[k]);
        const result = await run(
          `DELETE FROM tenants WHERE ${conditions.join(' AND ')}`,
          params
        );
        cb(null, result.changes);
      } catch (err) {
        cb(err, 0);
      }
    })();
  },
};

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // API SQLite principal (async)
  getDb,
  run,
  get,
  all,

  // Wrapper-e de compatibilitate NeDB (callback-based; deprecated, folosiți get/run/all direct)
  users,
  tenants,

  // Utilitar: salvare manuală pe disc
  saveToDisk: _saveToDisk,

  // Constante
  DATA_DIR,
  DB_PATH,
};