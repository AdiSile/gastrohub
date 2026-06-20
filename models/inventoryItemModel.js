'use strict';

// ---------------------------------------------------------------------------
// Model InventoryItem – GastroHub
// Model SQL (sql.js/SQLite) pentru iteme de inventar (alimente, băuturi,
// consumabile).
// Tabela: inventory_items
// ---------------------------------------------------------------------------

const { getDb, run, get, all } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Asigură existența tabelei inventory_items (creează dacă nu există)
// ---------------------------------------------------------------------------

let _tableReady = false;

async function _ensureTable() {
  if (_tableReady) return;
  const db = await getDb();
  db.run('CREATE TABLE IF NOT EXISTS inventory_items (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
    'name TEXT NOT NULL, ' +
    'category TEXT NOT NULL, ' +
    'quantity REAL NOT NULL DEFAULT 0, ' +
    'unit TEXT NOT NULL DEFAULT \'buc\', ' +
    'minQuantity REAL NOT NULL DEFAULT 0, ' +
    'maxQuantity REAL DEFAULT NULL, ' +
    'price REAL DEFAULT NULL, ' +
    'currency TEXT DEFAULT \'RON\', ' +
    'sku TEXT DEFAULT NULL, ' +
    'description TEXT DEFAULT \'\', ' +
    'expiryDate TEXT DEFAULT NULL, ' +
    'status TEXT DEFAULT \'activ\', ' +
    'location TEXT DEFAULT \'\', ' +
    'supplierId TEXT DEFAULT NULL, ' +
    'tenantId TEXT NOT NULL, ' +
    'createdAt TEXT NOT NULL, ' +
    'updatedAt TEXT NOT NULL' +
  ')');
  _tableReady = true;
}

// ... (restul conținutului rămâne identic, cu toate modificările de mai jos)