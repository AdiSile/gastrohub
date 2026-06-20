**Linii cu markdown identificate:**

| Linia | Tip markdown | Conținut |
|-------|-------------|----------|
| 15 | Listă (`- `) | ` *  - Configurarea şi expunerea conexiunilor NeDB pentru:` |
| 16 | Sub-listă numerotată | ` *      1. users.db   – colecţia globală de utilizatori` |
| 17 | Sub-listă numerotată | ` *      2. tenants.db – colecţia globală de tenant-i (organizaţii)` |
| 18 | Listă + inline code | ` *  - Încărcare la primul \`require\` – singleton pattern` |
| 41 | Inline code | ` * Citeşte variabila de mediu \`DB_PATH\` sau implicit \`./data/\`.` |
| 62 | Inline code | ` * În teste sau când \`NODE_ENV === 'test'\` se preferă baza în-memory` |
| 77 | Em-dash (nu markdown) | ` * Colecţia de utilizatori (globală – toţi tenant-ii).` |
| 87 | Em-dash (nu markdown) | ` * Colecţia de tenant-i (organizaţii).` |
| 166 | Separator `---` | `// ---------------------------------------------------------------------------` |
| 168 | Separator `---` | `// ---------------------------------------------------------------------------` |
| 182 | Fenced code block (`` ``` ``) | ``   CREATE TABLE IF NOT EXISTS reservations (`` |
| 199 | Fenced code block (`` ``` ``) | `` \`); `` |
| 203 | Listă (`- `) + arrow | ` *  - db.run(sql, params)   => returnează { changes, lastInsertRowid }` |
| 204 | Listă (`- `) + arrow | ` *  - db.get(sql, params)   => returnează primul rând sau undefined` |
| 205 | Listă (`- `) + arrow | ` *  - db.all(sql, params)   => returnează toate rândurile (Array)` |
| 229 | Inline code | ` * Indexare implicită pe câmpul \`email\` – previne duplicarea utilizatorilor.` |
| 239 | Inline code (×2) | ` * \`sparse: true\` permite documentelor fără câmpul \`slug\` să nu fie indexate.` |

**Separatoare `/*** --- ***/` (posibil confundate cu markdown `---`):** Liniile 1, 39, 48, 61, 76, 86, 96, 106, 116, 126, 136, 146, 156, 170, 179, 201, 227, 237, 247, 256, 265, 278, 287, 300, 309, 318, 327, 336, 349, 358, 367, 376, 385, 398, 407, 416, 425, 434, 443, 456, 465, 474, 483, 492, 505, 514, 523, 532, 541, 550, 559 (toate conțin `/**` — deschidere JSDoc, NU markdown bold `**`).

**Separatoare `// ---`:** Liniile 166, 168, 223, 225, 274, 276, 296, 298, 345, 347, 394, 396, 452, 454, 501, 503, 568, 570 — acestea conțin `---` dar sunt comentarii JavaScript, nu reguli orizontale markdown standalone.

**Concluzie:** Fișierul conține **5 linii cu inline code** (backtick simplu), **2 linii de fenced code block** (triplu backtick), și **6 linii cu listă markdown** (`- `) în comentariile JSDoc. Nu există bold (`**`), italic (`*`), link-uri (`[]()`), imagini (`![]()`), tabele, headere (`#`), sau reguli orizontale markdown reale. Toate sintaxele markdown identificate sunt încorporate în comentarii JavaScript/JSDoc și nu afectează parsarea ca JS.

### temp_db_original.js
/**
 * ============================================================
 * config/db.js - Ini╚Ťializare NeDB (embedded document database)
 * ============================================================
 *
 * Responsabilit─â╚Ťi:
 *  - Configurarea ╚Öi expunerea conexiunilor NeDB pentru:          <!-- MARKDOWN: list item -->
 *      1. users.db   ÔÇô colec╚Ťia global─â de utilizatori           <!-- MARKDOWN: numbered sublist -->
 *      2. tenants.db ÔÇô colec╚Ťia global─â de tenant-i (organiza╚Ťii) <!-- MARKDOWN: numbered sublist -->
 *  - Crearea automat─â a directorului de date (implicit ./data/)   <!-- MARKDOWN: list item -->
 *  - ├Änc─ârcare la primul `require` ÔÇô singleton pattern            <!-- MARKDOWN: list item + inline code -->
 *
 * Folosire:
 *    const {
 *      users, tenants, restaurants, hotels, reservations,
 *      inventoryItems, inventoryTransactions, suppliers, deliveries
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
 * Determin─â calea absolut─â c─âtre directorul de date.
 * Cite┼čte variabila de mediu `DB_PATH` sau implicit `./data/`.          <!-- MARKDOWN: inline code (×2) -->
 */
function resolveDataPath() {
  const rel = process.env.DB_PATH || './data';
  return path.resolve(rel);
}

/**
 * Asigur─â existen┼úa directorului de date (creare recursiv─â dac─â nu exist─â).
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
 * ├Än teste sau c├ónd `NODE_ENV === 'test'` se prefer─â baza ├«n-memory       <!-- MARKDOWN: inline code -->
 * pentru performan┼ú─â ┼či izolare ├«ntre rul─âri.
 */
function isTestEnv() {
  return process.env.NODE_ENV === 'test';
}

// ---------------------------------------------------------------------------
// Initializare baze de date
// ---------------------------------------------------------------------------

const dataDir = resolveDataPath();
ensureDataDir(dataDir);

/**
 * Colec┼úia de utilizatori (global─â ÔÇô to┼úi tenant-ii).
 * Fi┼čierul pe disc: <dataDir>/users.db
 */
const users = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'users.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colec┼úia de tenant-i (organiza┼úii).
 * Fi┼čierul pe disc: <dataDir>/tenants.db
 */
const tenants = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'tenants.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colec┼úia de restaurante.
 * Fi┼čierul pe disc: <dataDir>/restaurants.db
 */
const restaurants = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'restaurants.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colec┼úia de hoteluri.
 * Fi┼čierul pe disc: <dataDir>/hotels.db
 */
const hotels = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'hotels.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colec┼úia de rezerv─âri.
 * Fi┼čierul pe disc: <dataDir>/reservations.db
 */
const reservations = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'reservations.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colec┼úia de articole din inventar.
 * Fi┼čierul pe disc: <dataDir>/inventoryItems.db
 */
const inventoryItems = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'inventoryItems.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colec┼úia de tranzac┼úii de inventar (intr─âri/ie┼čiri, ajust─âri, transferuri).
 * Fi┼čierul pe disc: <dataDir>/inventoryTransactions.db
 */
const inventoryTransactions = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'inventoryTransactions.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colec┼úia de furnizori.
 * Fi┼čierul pe disc: <dataDir>/suppliers.db
 */
const suppliers = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'suppliers.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colec┼úia de livr─âri.
 * Fi┼čierul pe disc: <dataDir>/deliveries.db
 */
const deliveries = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'deliveries.db'),
  autoload: true,
  timestampData: false,
});

// ---------------------------------------------------------------------------
// SQLite database (better-sqlite3) ÔÇô pentru modele noi (ex: reservationModel)
// ---------------------------------------------------------------------------

/**
 * Conexiune SQLite partajat─â. Fi╚Öierul: <dataDir>/gastrohub.db
 */
const sqliteDb = new Database(path.join(dataDir, 'gastrohub.db'));

// Pragmatic: activ─âm WAL pentru performan╚Ť─â concurent─â mai bun─â
sqliteDb.pragma('journal_mode = WAL');
sqliteDb.pragma('foreign_keys = ON');

/**
 * Asigur─â existen╚Ťa tabelei de rezerv─âri (SQLite).
 */
sqliteDb.exec(`                                                                <!-- MARKDOWN: fenced code block open -->
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
    status      TEXT    DEFAULT 'confirmat─â',
    notes       TEXT    DEFAULT '',
    createdAt   TEXT    DEFAULT (datetime('now')),
    updatedAt   TEXT    DEFAULT (datetime('now'))
  );
`);                                                                           <!-- MARKDOWN: fenced code block close -->

/**
 * Metode expuse pentru compatibilitate cu modelele SQLite:
 *  - db.run(sql, params)   => returneaz─â { changes, lastInsertRowid }        <!-- MARKDOWN: list item -->
 *  - db.get(sql, params)   => returneaz─â primul r├ónd sau undefined          <!-- MARKDOWN: list item -->
 *  - db.all(sql, params)   => returneaz─â toate r├óndurile (Array)            <!-- MARKDOWN: list item -->
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
// Indexuri ÔÇô colec┼úii existente
// ---------------------------------------------------------------------------

/**
 * Asigur─â unicitatea email-urilor la nivel global.
 * Indexare implicit─â pe c├ómpul `email` ÔÇô previne duplicarea utilizatorilor.  <!-- MARKDOWN: inline code -->
 */
users.ensureIndex({ fieldName: 'email', unique: true, sparse: true }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului unic pe email (users):', err.message);
  }
});

/**
 * Asigur─â unicitatea numelor de tenant (slug).
 * `sparse: true` permite documentelor f─âr─â c├ómpul `slug` s─â nu fie indexate. <!-- MARKDOWN: inline code (×2) -->
 */
tenants.ensureIndex({ fieldName: 'slug', unique: true, sparse: true }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului unic pe slug (tenants):', err.message);
  }
});

/**
 * Index pentru c─âutarea rapid─â a restaurantelor dup─â tenantId.
 */
restaurants.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (restaurants):', err.message);
  }
});

/**
 * Index pentru c─âutarea restaurantelor dup─â status.
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
// Indexuri ÔÇô hotels
// ---------------------------------------------------------------------------

/**
 * Index pentru c─âutarea hotelurilor dup─â tenantId.
 */
hotels.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (hotels):', err.message);
  }
});

/**
 * Index pentru c─âutarea hotelurilor dup─â status.
 */
hotels.ensureIndex({ fieldName: 'status' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe status (hotels):', err.message);
  }
});

// ---------------------------------------------------------------------------
// Indexuri ÔÇô reservations
// ---------------------------------------------------------------------------

/**
 * Index pentru c─âutarea rezerv─ârilor dup─â tenantId.
 */
reservations.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (reservations):', err.message);
  }
});

/**
 * Index pentru c─âutarea rezerv─ârilor dup─â hotelId / restaurantId (resursa).
 */
reservations.ensureIndex({ fieldName: 'resourceId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe resourceId (reservations):', err.message);
  }
});

/**
 * Index pentru c─âutarea rezerv─ârilor dup─â status.
 */
reservations.ensureIndex({ fieldName: 'status' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe status (reservations):', err.message);
  }
});

/**
 * Index compus pentru rezerv─âri per tenant + resurs─â.
 */
reservations.ensureIndex({ fieldName: 'tenantId_resourceId', fieldName: ['tenantId', 'resourceId'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+resourceId (reservations):', err.message);
  }
});

/**
 * Index compus pentru rezerv─âri per tenant + status.
 */
reservations.ensureIndex({ fieldName: 'tenantId_status', fieldName: ['tenantId', 'status'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+status (reservations):', err.message);
  }
});

// ---------------------------------------------------------------------------
// Indexuri ÔÇô inventoryItems
// ---------------------------------------------------------------------------

/**
 * Index pentru c─âutarea articolelor dup─â tenantId.
 */
inventoryItems.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (inventoryItems):', err.message);
  }
});

/**
 * Index pentru c─âutarea articolelor dup─â SKU (unic per tenant).
 */
inventoryItems.ensureIndex({ fieldName: 'sku', unique: true, sparse: true }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului unic pe sku (inventoryItems):', err.message);
  }
});

/**
 * Index pentru c─âutarea articolelor dup─â categorie.
 */
inventoryItems.ensureIndex({ fieldName: 'category' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe category (inventoryItems):', err.message);
  }
});

/**
 * Index pentru c─âutarea articolelor dup─â status (activ/inactiv).
 */
inventoryItems.ensureIndex({ fieldName: 'status' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe status (inventoryItems):', err.message);
  }
});

/**
 * Index compus pentru articolele per tenant dup─â categorie.
 */
inventoryItems.ensureIndex({ fieldName: 'tenantId_category', fieldName: ['tenantId', 'category'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+category (inventoryItems):', err.message);
  }
});

// ---------------------------------------------------------------------------
// Indexuri ÔÇô inventoryTransactions
// ---------------------------------------------------------------------------

/**
 * Index pentru c─âutarea tranzac┼úiilor dup─â tenantId.
 */
inventoryTransactions.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (inventoryTransactions):', err.message);
  }
});

/**
 * Index pentru c─âutarea tranzac┼úiilor dup─â itemId (articolul implicat).
 */
inventoryTransactions.ensureIndex({ fieldName: 'itemId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe itemId (inventoryTransactions):', err.message);
  }
});

/**
 * Index pentru c─âutarea tranzac┼úiilor dup─â tip (in/out/adjustment/transfer).
 */
inventoryTransactions.ensureIndex({ fieldName: 'type' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe type (inventoryTransactions):', err.message);
  }
});

/**
 * Index pentru c─âutarea tranzac┼úiilor dup─â referin┼ú─â (id comand─â/livrare).
 */
inventoryTransactions.ensureIndex({ fieldName: 'referenceId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe referenceId (inventoryTransactions):', err.message);
  }
});

/**
 * Index pentru c─âutarea tranzac┼úiilor dup─â dat─â.
 */
inventoryTransactions.ensureIndex({ fieldName: 'createdAt' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe createdAt (inventoryTransactions):', err.message);
  }
});

/**
 * Index compus pentru tranzac┼úii per tenant + item.
 */
inventoryTransactions.ensureIndex({ fieldName: 'tenantId_itemId', fieldName: ['tenantId', 'itemId'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+itemId (inventoryTransactions):', err.message);
  }
});

// ---------------------------------------------------------------------------
// Indexuri ÔÇô suppliers
// ---------------------------------------------------------------------------

/**
 * Index pentru c─âutarea furnizorilor dup─â tenantId.
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
 * Index pentru c─âutarea furnizorilor dup─â status.
 */
suppliers.ensureIndex({ fieldName: 'status' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe status (suppliers):', err.message);
  }
});

/**
 * Index pentru c─âutarea furnizorilor dup─â nume.
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
// Indexuri ÔÇô deliveries
// ---------------------------------------------------------------------------

/**
 * Index pentru c─âutarea livr─ârilor dup─â tenantId.
 */
deliveries.ensureIndex({ fieldName: 'tenantId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe tenantId (deliveries):', err.message);
  }
});

/**
 * Index pentru c─âutarea livr─ârilor dup─â supplierId.
 */
deliveries.ensureIndex({ fieldName: 'supplierId' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe supplierId (deliveries):', err.message);
  }
});

/**
 * Index pentru c─âutarea livr─ârilor dup─â status.
 */
deliveries.ensureIndex({ fieldName: 'status' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe status (deliveries):', err.message);
  }
});

/**
 * Index pentru c─âutarea livr─ârilor dup─â dat─â programat─â.
 */
deliveries.ensureIndex({ fieldName: 'scheduledDate' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe scheduledDate (deliveries):', err.message);
  }
});

/**
 * Index pentru c─âutarea livr─ârilor dup─â dat─â real─â de primire.
 */
deliveries.ensureIndex({ fieldName: 'receivedDate' }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului pe receivedDate (deliveries):', err.message);
  }
});

/**
 * Index compus pentru livr─âri per tenant + status.
 */
deliveries.ensureIndex({ fieldName: 'tenantId_status', fieldName: ['tenantId', 'status'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+status (deliveries):', err.message);
  }
});

/**
 * Index compus pentru livr─âri per tenant + supplier.
 */
deliveries.ensureIndex({ fieldName: 'tenantId_supplierId', fieldName: ['tenantId', 'supplierId'] }, (err) => {
  if (err) {
    console.error('[db] Eroare la crearea indexului compus tenantId+supplierId (deliveries):', err.message);
  }
});

// ---------------------------------------------------------------------------
// Export singleton
// ---------------------------------------------------------------------------

module.exports = { users, tenants, restaurants, hotels, reservations, inventoryItems, inventoryTransactions, suppliers, deliveries, dataDir, run, get, all };