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
 *  - Crearea automată a directorului de date (implicit ./data/)
 *  - Încărcare la primul `require` – singleton pattern
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
  timestampData: false,
});

/**
 * Colecţia de tenant-i (organizaţii).
 * Fişierul pe disc: <dataDir>/tenants.db
 */
const tenants = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'tenants.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colecţia de restaurante.
 * Fişierul pe disc: <dataDir>/restaurants.db
 */
const restaurants = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'restaurants.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colecţia de hoteluri.
 * Fişierul pe disc: <dataDir>/hotels.db
 */
const hotels = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'hotels.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colecţia de rezervări.
 * Fişierul pe disc: <dataDir>/reservations.db
 */
const reservations = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'reservations.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colecţia de articole din inventar.
 * Fişierul pe disc: <dataDir>/inventoryItems.db
 */
const inventoryItems = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'inventoryItems.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colecţia de tranzacţii de inventar (intrări/ieşiri, ajustări, transferuri).
 * Fişierul pe disc: <dataDir>/inventoryTransactions.db
 */
const inventoryTransactions = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'inventoryTransactions.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colecţia de furnizori.
 * Fişierul pe disc: <dataDir>/suppliers.db
 */
const suppliers = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'suppliers.db'),
  autoload: true,
  timestampData: false,
});

/**
 * Colecţia de livrări.
 * Fişierul pe disc: <dataDir>/deliveries.db
 */
const deliveries = new Datastore({
  filename: isTestEnv() ? undefined : path.join(dataDir, 'deliveries.db'),
  autoload: true,
  timestampData: false,
});

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
// Export singleton
// ---------------------------------------------------------------------------

module.exports = { users, tenants, restaurants, hotels, reservations, inventoryItems, inventoryTransactions, suppliers, deliveries, dataDir };