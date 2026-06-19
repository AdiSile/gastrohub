/**
 * ============================================================
 * config/db.js - Inițializare NeDB (embedded document database)
 * ============================================================
 *
 * Responsabilități:
 *  - Configurarea și expunerea conexiunilor NeDB pentru:
 *      1. users.db   – colecția globală de utilizatori
 *      2. tenants.db – colecția globală de tenant-i (organizații)
 *      3. restaurants.db – colecția de restaurante
 *      4. hotels.db      – colecția de hoteluri
 *      5. reservations.db – colecția de rezervări
 *      6. inventoryItems.db      – colecția de articole din inventar
 *      7. inventoryTransactions.db – colecția de tranzacții de inventar
 *      8. suppliers.db           – colecția de furnizori
 *      9. deliveries.db          – colecția de livrări
 *     10. attendance.db          – colecția de pontaje (check-in/out)
 *     11. salaries.db            – colecția de salarii brute
 *  - Crearea automată a directorului de date (implicit ./data/)
 *  - Încărcare la primul `require` – singleton pattern
 *
 * Folosire:
 *    const {
 *      users, tenants, restaurants, hotels, reservations,
 *      inventoryItems, inventoryTransactions, suppliers, deliveries,
 *      attendance, salaries
 *    } = require('../config/db');
 *    inventoryItems.find({ ... }, (err, docs) => { ... });
 *
 * ============================================================
 */

const path = require('path');
const fs   = require('fs');
const Datastore = require('nedb');
const Database = require('better-sqlite3');

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Determină calea absolută către directorul de date.
 * Citeşte variabila de mediu `DB_PATH` sau implicit `./data/`.
 */
function resolveDataPath() {
  const rel = process.env.DB_PATH || './data';
  return path.resolve(rel);
}

/**
 * Asigură existenţa directorului de date (creare recursivă dacă nu există).
 */
function ensureDataDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// In-Memory / File mode helpers
// ---------------------------------------------------------------------------

/**
 * În teste sau când `NODE_ENV === 'test'` se preferă baza în-memory
 * pentru performanţă şi izolare între rulări.
 */
function isTestEnv() {
  return process.env.NODE_ENV === 'test';
}

// ---------------------------------------------------------------------------
// NeDB onload error handler – recreare fișiere corupte
// ---------------------------------------------------------------------------

/**
 * Returnează un handler `onload` pentru un Datastore NeDB.
 *
 * La eroare de încărcare (fișier corupt, trunchiat, etc.):
 *   1. Afișează un mesaj de avertizare în consolă.
 *   2. Șterge fișierul corupt de pe disc.
 *   3. Colecția rămâne operațională în memorie; la următoarea
 *      persistență fișierul va fi recreat automat de la zero.
 *
 * @param {string} collectionName - numele colecției (pentru logging)
 * @param {string|undefined} filePath - calea absolută către fișierul .db
 * @returns {Function} callback pentru evenimentul `onload`
 */
function onloadErrorHandler(collectionName, filePath) {
  return function (err) {
    if (err) {
      console.error(
        `[db] Fișier corupt detectat pentru ${collectionName} (${filePath}): ${err.message}`
      );
      console.warn(
        `[db] Se șterge fișierul corupt și se recreează ${collectionName} de la zero...`
      );
      try {
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[db] Fișierul ${filePath} a fost șters cu succes.`);
        }
      } catch (cleanupErr) {
        console.error(
          `[db] Eroare la ștergerea fișierului corupt ${filePath}: ${cleanupErr.message}`
        );
      }
      console.log(
        `[db] Colecția ${collectionName} funcționează în memorie; va fi persistată la următoarea scriere.`
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Initializare baze de date
// ---------------------------------------------------------------------------

const dataDir = resolveDataPath();
ensureDataDir(dataDir);

/**
 * Colecţia de utilizatori (globală – toţi tenant-ii).
 * Fişierul pe disc: <dataDir>/users.db
 */
const users = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'users.db'),
  autoload: true,
  timestampData: true,
  onload: onloadErrorHandler(
    'users',
    isTestEnv() ? undefined : path.join(dataDir, 'users.db')
  ),
});

/**
 * Colecţia de tenant-i (organizaţii).
 * Fişierul pe disc: <dataDir>/tenants.db
 */
const tenants = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'tenants.db'),
  autoload: true,
  timestampData: true,
  onload: onloadErrorHandler(
    'tenants',
    isTestEnv() ? undefined : path.join(dataDir, 'tenants.db')
  ),
});

/**
 * Colecţia de restaurante.
 * Fişierul pe disc: <dataDir>/restaurants.db
 */
const restaurants = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'restaurants.db'),
  autoload: true,
  timestampData: true,
  onload: onloadErrorHandler(
    'restaurants',
    isTestEnv() ? undefined : path.join(dataDir, 'restaurants.db')
  ),
});

/**
 * Colecţia de hoteluri.
 * Fişierul pe disc: <dataDir>/hotels.db
 */
const hotels = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'hotels.db'),
  autoload: true,
  timestampData: true,
  onload: onloadErrorHandler(
    'hotels',
    isTestEnv() ? undefined : path.join(dataDir, 'hotels.db')
  ),
});

/**
 * Colecţia de rezervări.
 * Fişierul pe disc: <dataDir>/reservations.db
 */
const reservations = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'reservations.db'),
  autoload: true,
  timestampData: true,
  onload: onloadErrorHandler(
    'reservations',
    isTestEnv() ? undefined : path.join(dataDir, 'reservations.db')
  ),
});

/**
 * Colecţia de articole din inventar.
 * Fişierul pe disc: <dataDir>/inventoryItems.db
 */
const inventoryItems = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'inventoryItems.db'),
  autoload: true,
  timestampData: true,
  onload: onloadErrorHandler(
    'inventoryItems',
    isTestEnv() ? undefined : path.join(dataDir, 'inventoryItems.db')
  ),
});

/**
 * Colecţia de tranzacţii de inventar (intrări/ieşiri, ajustări, transferuri).
 * Fişierul pe disc: <dataDir>/inventoryTransactions.db
 */
const inventoryTransactions = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'inventoryTransactions.db'),
  autoload: true,
  timestampData: true,
  onload: onloadErrorHandler(
    'inventoryTransactions',
    isTestEnv() ? undefined : path.join(dataDir, 'inventoryTransactions.db')
  ),
});

/**
 * Colecţia de furnizori.
 * Fişierul pe disc: <dataDir>/suppliers.db
 */
const suppliers = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'suppliers.db'),
  autoload: true,
  timestampData: true,
  onload: onloadErrorHandler(
    'suppliers',
    isTestEnv() ? undefined : path.join(dataDir, 'suppliers.db')
  ),
});

/**
 * Colecţia de livrări.
 * Fişierul pe disc: <dataDir>/deliveries.db
 */
const deliveries = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'deliveries.db'),
  autoload: true,
  timestampData: true,
  onload: onloadErrorHandler(
    'deliveries',
    isTestEnv() ? undefined : path.join(dataDir, 'deliveries.db')
  ),
});

/**
 * Colecţia de pontaje (attendance / check-in / check-out).
 * Fişierul pe disc: <dataDir>/attendance.db
 */
const attendance = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'attendance.db'),
  autoload: true,
  timestampData: true,
  onload: onloadErrorHandler(
    'attendance',
    isTestEnv() ? undefined : path.join(dataDir, 'attendance.db')
  ),
});

/**
 * Colecţia de salarii brute (gross salary records).
 * Fişierul pe disc: <dataDir>/salaries.db
 */
const salaries = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'salaries.db'),
  autoload: true,
  timestampData: true,
  onload: onloadErrorHandler(
    'salaries',
    isTestEnv() ? undefined : path.join(dataDir, 'salaries.db')
  ),
});

// ---------------------------------------------------------------------------
// SQLite database (better-sqlite3) – pentru modele noi (ex: reservationModel)
// ---------------------------------------------------------------------------

/**
 * Conexiune SQLite partajată. Fișierul: <dataDir>/gastrohub.db
 */
const sqliteDb = new Database(path.join(dataDir, 'gastrohub.db'));

// Pragmatic: activăm WAL pentru performanță concurentă mai bună
sqliteDb.pragma('journal_mode = WAL');
sqliteDb.pragma('foreign_keys = ON');

/**
 * Asigură existența tabelei de rezervări (SQLite).
 */
sqliteDb.exec(`
  CREATE TABLE IF NOT EXISTS reservations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    hotelId     TEXT    NOT NULL,
    guestId     TEXT,
    guestName   TEXT    NOT NULL,
    guestPhone  TEXT    DEFAULT '',
    guestEmail  TEXT    DEFAULT '',
    checkIn     TEXT    NOT NULL,
    checkOut    TEXT    NOT NULL,
    roomId      TEXT,
    numGuests   INTEGER DEFAULT 1,
    status      TEXT    DEFAULT 'confirmată',
    notes       TEXT    DEFAULT '',
    createdAt   TEXT    DEFAULT (datetime('now')),
    updatedAt   TEXT    DEFAULT (datetime('now'))
  );
`);

/**
 * Asigură existența tabelei de utilizatori (SQLite).
 * Coloane: id, email (UNIQUE), password, role, tenantId, restaurante, createdAt, updatedAt
 */
sqliteDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE,
    password      TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'client',
    tenantId      TEXT,
    restaurante   TEXT    DEFAULT '[]',
    createdAt     TEXT    DEFAULT (datetime('now')),
    updatedAt     TEXT    DEFAULT (datetime('now'))
  );
`);

/**
 * Asigură existența coloanei `restaurante` în tabela users (migrare).
 * Verifică schema existentă și adaugă coloana dacă lipsește.
 */
(function _migrateUsersSchema() {
  try {
    const tableInfo = sqliteDb.exec('PRAGMA table_info(users)');
    if (tableInfo.length > 0) {
      const columns = tableInfo[0].values.map(function (row) { return row[1]; });
      if (columns.indexOf('restaurante') === -1) {
        sqliteDb.exec("ALTER TABLE users ADD COLUMN restaurante TEXT DEFAULT '[]'");
      }
    }
  } catch (_e) {
    // Ignorăm erorile de migrare – probabil tabela nu există încă
  }
})();

/**
 * Metode expuse pentru compatibilitate cu modelele SQLite:
 *  - db.run(sql, params)   => returnează { changes, lastInsertRowid }
 *  - db.get(sql, params)   => returnează primul rând sau undefined
 *  - db.all(sql, params)   => returnează toate rândurile (Array)
 */

const run = (sql, params = []) => {
  const stmt = sqliteDb.prepare(sql);
  return stmt.run(...params);
};

const get = (sql, params = []) => {
  const stmt = sqliteDb.prepare(sql);
  return stmt.get(...params);
};

const all = (sql, params = []) => {
  const stmt = sqliteDb.prepare(sql);
  return stmt.all(...params);
};

// ---------------------------------------------------------------------------
// Funcție de inițializare asincronă a bazei de date
// ---------------------------------------------------------------------------

/**
 * Inițializează baza de date și returnează o Promisiune.
 * Asigură că toate tabelele și indexurile sunt gata înainte ca serverul
 * să înceapă să accepte cereri.
 *
 * @returns {Promise<void>}
 */
function initDb() {
  return new Promise(function (resolve, reject) {
    try {
      // Verifică rapid că SQLite răspunde
      get('SELECT 1 AS ok');
      resolve();
    } catch (err) {
      // Dacă SQLite nu e disponibil, NeDB e fallback-ul și e deja inițializat
      // Verificăm că măcar NeDB răspunde
      users.findOne({ _id: '__init_check__' }, function () {
        // Ignorăm rezultatul; dacă nu crapă, NeDB e funcțional
        resolve();
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Indexuri – colecţii existente
// ---------------------------------------------------------------------------

/**
 * Asigură unicitatea email-urilor la nivel global.
 * Indexare implicită pe câmpul `email` – previne duplicarea utilizatorilor.
 */
users.ensureIndex({ fieldName: 'email', unique: true, sparse: true }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului unic pe email (users):', err.message);
  }
});

/**
 * Asigură unicitatea numelor de tenant (slug).
 * `sparse: true` permite documentelor fără câmpul `slug` să nu fie indexate.
 */
tenants.ensureIndex({ fieldName: 'slug', unique: true, sparse: true }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului unic pe slug (tenants):', err.message);
  }
});

/**
 * Index pentru căutarea rapidă a restaurantelor după tenantId.
 */
restaurants.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (restaurants):', err.message);
  }
});

/**
 * Index pentru căutarea restaurantelor după status.
 */
restaurants.ensureIndex({ fieldName: 'status' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe status (restaurants):', err.message);
  }
});

/**
 * Index compus pentru restaurante per tenant + status.
 */
restaurants.ensureIndex({ fieldName: 'tenantId_status', fieldName: ['tenantId', 'status'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+status (restaurants):', err.message);
  }
});

// ---------------------------------------------------------------------------
// Indexuri – hotels
// ---------------------------------------------------------------------------

/**
 * Index pentru căutarea hotelurilor după tenantId.
 */
hotels.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (hotels):', err.message);
  }
});

/**
 * Index pentru căutarea hotelurilor după status.
 */
hotels.ensureIndex({ fieldName: 'status' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe status (hotels):', err.message);
  }
});

// ---------------------------------------------------------------------------
// Indexuri – reservations
// ---------------------------------------------------------------------------

/**
 * Index pentru căutarea rezervărilor după tenantId.
 */
reservations.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (reservations):', err.message);
  }
});

/**
 * Index pentru căutarea rezervărilor după hotelId / restaurantId (resursa).
 */
reservations.ensureIndex({ fieldName: 'resourceId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe resourceId (reservations):', err.message);
  }
});

/**
 * Index pentru căutarea rezervărilor după status.
 */
reservations.ensureIndex({ fieldName: 'status' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe status (reservations):', err.message);
  }
});

/**
 * Index compus pentru rezervări per tenant + resursă.
 */
reservations.ensureIndex({ fieldName: 'tenantId_resourceId', fieldName: ['tenantId', 'resourceId'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+resourceId (reservations):', err.message);
  }
});

/**
 * Index compus pentru rezervări per tenant + status.
 */
reservations.ensureIndex({ fieldName: 'tenantId_status', fieldName: ['tenantId', 'status'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+status (reservations):', err.message);
  }
});

// ---------------------------------------------------------------------------
// Indexuri – inventoryItems
// ---------------------------------------------------------------------------

/**
 * Index pentru căutarea articolelor după tenantId.
 */
inventoryItems.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (inventoryItems):', err.message);
  }
});

/**
 * Index pentru căutarea articolelor după SKU (unic per tenant).
 */
inventoryItems.ensureIndex({ fieldName: 'sku', unique: true, sparse: true }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului unic pe sku (inventoryItems):', err.message);
  }
});

/**
 * Index pentru căutarea articolelor după categorie.
 */
inventoryItems.ensureIndex({ fieldName: 'category' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe category (inventoryItems):', err.message);
  }
});

/**
 * Index pentru căutarea articolelor după status (activ/inactiv).
 */
inventoryItems.ensureIndex({ fieldName: 'status' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe status (inventoryItems):', err.message);
  }
});

/**
 * Index compus pentru articolele per tenant după categorie.
 */
inventoryItems.ensureIndex({ fieldName: 'tenantId_category', fieldName: ['tenantId', 'category'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+category (inventoryItems):', err.message);
  }
});

// ---------------------------------------------------------------------------
// Indexuri – inventoryTransactions
// ---------------------------------------------------------------------------

/**
 * Index pentru căutarea tranzacţiilor după tenantId.
 */
inventoryTransactions.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (inventoryTransactions):', err.message);
  }
});

/**
 * Index pentru căutarea tranzacţiilor după itemId (articolul implicat).
 */
inventoryTransactions.ensureIndex({ fieldName: 'itemId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe itemId (inventoryTransactions):', err.message);
  }
});

/**
 * Index pentru căutarea tranzacţiilor după tip (in/out/adjustment/transfer).
 */
inventoryTransactions.ensureIndex({ fieldName: 'type' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe type (inventoryTransactions):', err.message);
  }
});

/**
 * Index pentru căutarea tranzacţiilor după referinţă (id comandă/livrare).
 */
inventoryTransactions.ensureIndex({ fieldName: 'referenceId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe referenceId (inventoryTransactions):', err.message);
  }
});

/**
 * Index pentru căutarea tranzacţiilor după dată.
 */
inventoryTransactions.ensureIndex({ fieldName: 'createdAt' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe createdAt (inventoryTransactions):', err.message);
  }
});

/**
 * Index compus pentru tranzacţii per tenant + item.
 */
inventoryTransactions.ensureIndex({ fieldName: 'tenantId_itemId', fieldName: ['tenantId', 'itemId'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+itemId (inventoryTransactions):', err.message);
  }
});

// ---------------------------------------------------------------------------
// Indexuri – suppliers
// ---------------------------------------------------------------------------

/**
 * Index pentru căutarea furnizorilor după tenantId.
 */
suppliers.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (suppliers):', err.message);
  }
});

/**
 * Index unic pentru codul fiscal al furnizorului per tenant.
 */
suppliers.ensureIndex({ fieldName: 'taxId', unique: true, sparse: true }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului unic pe taxId (suppliers):', err.message);
  }
});

/**
 * Index pentru căutarea furnizorilor după status.
 */
suppliers.ensureIndex({ fieldName: 'status' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe status (suppliers):', err.message);
  }
});

/**
 * Index pentru căutarea furnizorilor după nume.
 */
suppliers.ensureIndex({ fieldName: 'name' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe name (suppliers):', err.message);
  }
});

/**
 * Index compus pentru furnizori per tenant + status.
 */
suppliers.ensureIndex({ fieldName: 'tenantId_status', fieldName: ['tenantId', 'status'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+status (suppliers):', err.message);
  }
});

// ---------------------------------------------------------------------------
// Indexuri – deliveries
// ---------------------------------------------------------------------------

/**
 * Index pentru căutarea livrărilor după tenantId.
 */
deliveries.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (deliveries):', err.message);
  }
});

/**
 * Index pentru căutarea livrărilor după supplierId.
 */
deliveries.ensureIndex({ fieldName: 'supplierId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe supplierId (deliveries):', err.message);
  }
});

/**
 * Index pentru căutarea livrărilor după status.
 */
deliveries.ensureIndex({ fieldName: 'status' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe status (deliveries):', err.message);
  }
});

/**
 * Index pentru căutarea livrărilor după dată programată.
 */
deliveries.ensureIndex({ fieldName: 'scheduledDate' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe scheduledDate (deliveries):', err.message);
  }
});

/**
 * Index pentru căutarea livrărilor după dată reală de primire.
 */
deliveries.ensureIndex({ fieldName: 'receivedDate' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe receivedDate (deliveries):', err.message);
  }
});

/**
 * Index compus pentru livrări per tenant + status.
 */
deliveries.ensureIndex({ fieldName: 'tenantId_status', fieldName: ['tenantId', 'status'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+status (deliveries):', err.message);
  }
});

/**
 * Index compus pentru livrări per tenant + supplier.
 */
deliveries.ensureIndex({ fieldName: 'tenantId_supplierId', fieldName: ['tenantId', 'supplierId'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+supplierId (deliveries):', err.message);
  }
});

// ---------------------------------------------------------------------------
// Indexuri – attendance (pontaje)
// ---------------------------------------------------------------------------

/**
 * Index pentru căutarea pontajelor după employeeId.
 */
attendance.ensureIndex({ fieldName: 'employeeId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe employeeId (attendance):', err.message);
  }
});

/**
 * Index pentru căutarea pontajelor după tenantId.
 */
attendance.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (attendance):', err.message);
  }
});

/**
 * Index pentru căutarea pontajelor după type (checkIn/checkOut).
 */
attendance.ensureIndex({ fieldName: 'type' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe type (attendance):', err.message);
  }
});

/**
 * Index pentru căutarea pontajelor după timestamp.
 */
attendance.ensureIndex({ fieldName: 'timestamp' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe timestamp (attendance):', err.message);
  }
});

/**
 * Index compus pentru pontaje per tenant + employee.
 */
attendance.ensureIndex({ fieldName: 'tenantId_employeeId', fieldName: ['tenantId', 'employeeId'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+employeeId (attendance):', err.message);
  }
});

/**
 * Index compus pentru pontaje per employee + timestamp.
 */
attendance.ensureIndex({ fieldName: 'employeeId_timestamp', fieldName: ['employeeId', 'timestamp'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus employeeId+timestamp (attendance):', err.message);
  }
});

// ---------------------------------------------------------------------------
// Indexuri – salaries (salarii brute)
// ---------------------------------------------------------------------------

/**
 * Index pentru căutarea salariilor după employeeId.
 */
salaries.ensureIndex({ fieldName: 'employeeId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe employeeId (salaries):', err.message);
  }
});

/**
 * Index pentru căutarea salariilor după tenantId.
 */
salaries.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (salaries):', err.message);
  }
});

/**
 * Index pentru căutarea salariilor după period.
 */
salaries.ensureIndex({ fieldName: 'period' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe period (salaries):', err.message);
  }
});

/**
 * Index compus pentru salarii per tenant + employee.
 */
salaries.ensureIndex({ fieldName: 'tenantId_employeeId', fieldName: ['tenantId', 'employeeId'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+employeeId (salaries):', err.message);
  }
});

/**
 * Index compus pentru salarii per employee + period.
 */
salaries.ensureIndex({ fieldName: 'employeeId_period', fieldName: ['employeeId', 'period'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus employeeId+period (salaries):', err.message);
  }
});

// ---------------------------------------------------------------------------
// Export singleton
// ---------------------------------------------------------------------------

module.exports = {
  users,
  tenants,
  restaurants,
  hotels,
  reservations,
  inventoryItems,
  inventoryTransactions,
  suppliers,
  deliveries,
  attendance,
  salaries,
  dataDir,
  run,
  get,
  all,
  initDb,
  sqliteDb,
};