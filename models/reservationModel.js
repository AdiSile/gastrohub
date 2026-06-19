'use strict';

// ---------------------------------------------------------------------------
// Model Reservation – GastroHub
// Gestionează rezervările (restaurant + hotel) cu compatibilitate duală:
// SQLite (primar, prin getDb()) + NeDB (fallback).
//
// Structura unui document:
//   _id              {string}  – generat automat (NeDB) / conversie din id (SQLite)
//   tenantId         {string}  – tenant-ul proprietar (obligatoriu)
//   tip              {string}  – 'restaurant' | 'hotel' (obligatoriu)
//   restaurantId     {string}  – ID restaurant (dacă tip='restaurant')
//   hotelId          {string}  – ID hotel (dacă tip='hotel')
//   data             {string}  – data rezervării YYYY-MM-DD (obligatoriu)
//   ora              {string}  – ora HH:mm
//   numarPersoane    {number}  – număr persoane (obligatoriu)
//   numeClient       {string}  – nume client (obligatoriu)
//   emailClient      {string}  – email client (obligatoriu)
//   telefonClient    {string}  – telefon client (obligatoriu)
//   observatii       {string}  – observații
//   masa             {number}  – număr masă (restaurant)
//   camera           {string}  – cameră (hotel)
//   checkIn          {string}  – dată check-in YYYY-MM-DD (hotel)
//   checkOut         {string}  – dată check-out YYYY-MM-DD (hotel)
//   status           {string}  – status rezervare
//   statusFacturare  {string}  – status facturare
//   sumaTotala       {number}  – suma totală
//   moneda           {string}  – moneda (ex: RON, EUR)
//   guestId          {string}  – ID guest (legătură cu sistemul de oaspeți)
//   createdAt        {string}  – data creării (ISO 8601)
//   updatedAt        {string}  – data actualizării (ISO 8601)
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { reservations, getDb, run, get, all } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Marcaj pentru migrarea tabelei reservations în SQLite (executată o singură
// dată, la primul apel către orice funcție SQL)
// ---------------------------------------------------------------------------

let _sqlMigrated = false;

/**
 * Asigură că tabela `reservations` din SQLite există și are schema completă.
 * Se execută o singură dată, idempotent.
 */
function _ensureSqlSchema() {
  if (_sqlMigrated) return;
  try {
    const db = getDb();

    // Verifică dacă tabela reservations există deja
    const tableInfo = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='reservations'");
    const tableExists = tableInfo.length > 0 && tableInfo[0].values.length > 0;

    if (!tableExists) {
      // Tabela nu există – o creăm cu schema completă
      db.run(`
        CREATE TABLE reservations (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          tenantId        TEXT    NOT NULL,
          tip             TEXT    NOT NULL,
          restaurantId    TEXT,
          hotelId         TEXT,
          data            TEXT    NOT NULL,
          ora             TEXT,
          numarPersoane   INTEGER NOT NULL DEFAULT 1,
          numeClient      TEXT    NOT NULL,
          emailClient     TEXT    NOT NULL,
          telefonClient   TEXT    NOT NULL,
          observatii      TEXT    DEFAULT '',
          masa            INTEGER,
          camera          TEXT,
          checkIn         TEXT,
          checkOut        TEXT,
          status          TEXT    DEFAULT 'confirmată',
          statusFacturare TEXT    DEFAULT 'nefacturat',
          sumaTotala      REAL    DEFAULT 0,
          moneda          TEXT    DEFAULT 'RON',
          guestId         TEXT,
          createdAt       TEXT    DEFAULT (datetime('now')),
          updatedAt       TEXT    DEFAULT (datetime('now'))
        );
      `);

      // Indexuri pentru performanță
      db.run('CREATE INDEX IF NOT EXISTS idx_reservations_tenantId ON reservations(tenantId);');
      db.run('CREATE INDEX IF NOT EXISTS idx_reservations_tip ON reservations(tip);');
      db.run('CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);');
      db.run('CREATE INDEX IF NOT EXISTS idx_reservations_tenantId_tip ON reservations(tenantId, tip);');
      db.run('CREATE INDEX IF NOT EXISTS idx_reservations_tenantId_status ON reservations(tenantId, status);');
      db.run('CREATE INDEX IF NOT EXISTS idx_reservations_guestId ON reservations(guestId);');
    } else {
      // Tabela există – verificăm și adăugăm coloanele lipsă (migrare incrementală)
      const info = db.exec('PRAGMA table_info(reservations)');
      const columns = info.length > 0 ? info[0].values.map(function (r) { return r[1]; }) : [];

      const missingColumns = [
        { name: 'tenantId', def: 'TEXT' },
        { name: 'tip', def: "TEXT NOT NULL DEFAULT 'restaurant'" },
        { name: 'restaurantId', def: 'TEXT' },
        { name: 'data', def: 'TEXT' },
        { name: 'ora', def: 'TEXT' },
        { name: 'numarPersoane', def: 'INTEGER NOT NULL DEFAULT 1' },
        { name: 'numeClient', def: 'TEXT' },
        { name: 'emailClient', def: 'TEXT' },
        { name: 'telefonClient', def: 'TEXT' },
        { name: 'observatii', def: "TEXT DEFAULT ''" },
        { name: 'masa', def: 'INTEGER' },
        { name: 'camera', def: 'TEXT' },
        { name: 'statusFacturare', def: "TEXT DEFAULT 'nefacturat'" },
        { name: 'sumaTotala', def: 'REAL DEFAULT 0' },
        { name: 'moneda', def: "TEXT DEFAULT 'RON'" },
        { name: 'guestId', def: 'TEXT' },
      ];

      for (let i = 0; i < missingColumns.length; i++) {
        const col = missingColumns[i];
        if (columns.indexOf(col.name) === -1) {
          try {
            db.run('ALTER TABLE reservations ADD COLUMN ' + col.name + ' ' + col.def);
          } catch (_colErr) {
            // Coloana poate exista deja; ignorăm eroarea silențios
          }
        }
      }
    }

    // Persistă modificarea de schemă pe disc
    const data = db.export();
    const dataDir = path.resolve(process.env.DB_PATH || './data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'gastrohub.db');
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    fs.writeFileSync(dbPath, buffer);

    _sqlMigrated = true;
  } catch (_e) {
    // SQLite nu este disponibil – ignorăm; vom folosi NeDB
    _sqlMigrated = true;
  }
}

// ---------------------------------------------------------------------------
// Detecție backend SQLite
// ---------------------------------------------------------------------------

/**
 * Returnează `true` dacă SQLite este disponibil și inițializat.
 * @returns {boolean}
 */
function _isSqlAvailable() {
  try {
    getDb();
    _ensureSqlSchema();
    return true;
  } catch (_e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers de conversie rând SQL → document compatibil NeDB
// ---------------------------------------------------------------------------

/**
 * Convertește un rând SQL (id INTEGER) într-un obiect compatibil cu NeDB
 * (cu _id string).
 * @param {Object} row
 * @returns {Object}
 */
function _sqlRowToDoc(row) {
  if (!row) return row;
  const doc = {};
  const keys = Object.keys(row);
  for (let i = 0; i < keys.length; i++) {
    doc[keys[i]] = row[keys[i]];
  }
  doc._id = String(row.id);
  return doc;
}

// ---------------------------------------------------------------------------
// Constante de validare
// ---------------------------------------------------------------------------

/**
 * Tipuri de rezervare acceptate.
 */
const VALID_RESERVATION_TYPES = ['restaurant', 'hotel'];

/**
 * Statusuri valide pentru o rezervare.
 */
const VALID_RESERVATION_STATUSES = [
  'confirmată',
  'în așteptare',
  'anulată',
  'finalizată',
  'neprezentat',
  'în curs',
  'check-in',
  'check-out',
];

/**
 * Statusuri de facturare acceptate.
 */
const VALID_BILLING_STATUSES = [
  'nefacturat',
  'facturat',
  'plătit',
  'anulat',
  'parțial',
];

// ---------------------------------------------------------------------------
// Helpers – validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un șir are lungimea între min și max.
 */
function isValidString(val, min, max) {
  if (min === undefined) min = 1;
  if (max === undefined) max = 255;
  return typeof val === 'string' && val.trim().length >= min && val.trim().length <= max;
}

/**
 * Verifică dacă o dată este în format YYYY-MM-DD valid.
 */
function isValidDate(dateStr) {
  if (typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00.000Z');
  return !isNaN(d.getTime());
}

/**
 * Verifică dacă o oră este în format HH:mm.
 */
function isValidTime(timeStr) {
  if (typeof timeStr !== 'string') return false;
  if (!/^\d{2}:\d{2}$/.test(timeStr)) return false;
  const parts = timeStr.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/**
 * Verifică dacă un email este valid (format simplu).
 */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Verifică dacă un telefon este valid.
 */
function isValidPhone(phone) {
  if (typeof phone !== 'string') return false;
  return /^[+]?[\d\s\-./()]{6,20}$/.test(phone.trim());
}

/**
 * Returnează un timestamp ISO 8601.
 */
function nowISO() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Helpers – construire query + sortare/paginare (NeDB)
// ---------------------------------------------------------------------------

/**
 * Construiește query-ul de bază pentru NeDB pe baza tenantId-ului și a
 * opțiunilor primite.
 */
function buildQuery(tenantId, options) {
  if (!options) options = {};
  const query = { tenantId: tenantId };

  if (options.tip) {
    query.tip = options.tip;
  }

  if (options.status) {
    query.status = options.status;
  }

  if (options.data) {
    query.data = options.data;
  }

  if (options.restaurantId) {
    query.restaurantId = options.restaurantId;
  }

  if (options.hotelId) {
    query.hotelId = options.hotelId;
  }

  if (options.camera) {
    query.camera = options.camera;
  }

  if (options.masa !== undefined && options.masa !== null) {
    query.masa = Number(options.masa);
  }

  return query;
}

/**
 * Construiește obiectul de sortare pentru NeDB.
 */
function buildSort(sort) {
  if (!sort) return undefined;

  const sortObj = {};
  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;

  sortObj[field] = isDesc ? -1 : 1;
  return sortObj;
}

/**
 * Aplică sort, skip, limit pe un cursor NeDB și returnează o Promisiune.
 */
function executeQuery(query, options) {
  if (!options) options = {};
  return new Promise(function (resolve, reject) {
    let cursor = reservations.find(query);

    const sortObj = buildSort(options.sort);
    if (sortObj) {
      cursor = cursor.sort(sortObj);
    }

    if (options.skip !== undefined && options.skip !== null) {
      cursor = cursor.skip(Number(options.skip));
    }

    if (options.limit !== undefined && options.limit !== null) {
      cursor = cursor.limit(Number(options.limit));
    }

    cursor.exec(function (err, docs) {
      if (err) return reject(err);
      resolve(docs);
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers SQLite – construire WHERE + ORDER BY + LIMIT/OFFSET din opțiuni
// ---------------------------------------------------------------------------

/**
 * Construiește clauza WHERE și parametrii pentru o interogare SQL.
 */
function _buildSqlWhere(tenantId, options) {
  if (!options) options = {};
  const clauses = ['tenantId = ?'];
  const params = [tenantId];

  if (options.tip) {
    clauses.push('tip = ?');
    params.push(options.tip);
  }

  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }

  if (options.data) {
    clauses.push('data = ?');
    params.push(options.data);
  }

  if (options.restaurantId) {
    clauses.push('restaurantId = ?');
    params.push(options.restaurantId);
  }

  if (options.hotelId) {
    clauses.push('hotelId = ?');
    params.push(options.hotelId);
  }

  if (options.camera) {
    clauses.push('camera = ?');
    params.push(options.camera);
  }

  if (options.masa !== undefined && options.masa !== null) {
    clauses.push('masa = ?');
    params.push(Number(options.masa));
  }

  return { whereClause: clauses.join(' AND '), params: params };
}

/**
 * Construiește clauza ORDER BY din opțiunea sort.
 */
function _buildSqlOrderBy(sort) {
  if (!sort) return ' ORDER BY createdAt DESC';

  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;
  const safeField = field.replace(/[^a-zA-Z0-9_]/g, '');
  return ' ORDER BY ' + safeField + (isDesc ? ' DESC' : ' ASC');
}

/**
 * Aplică LIMIT / OFFSET pe SQL.
 */
function _applySqlPagination(baseSql, params, options) {
  if (!options) options = {};
  let sql = baseSql;
  if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }
  if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
    sql += ' OFFSET ?';
    params.push(options.skip);
  }
  return { sql: sql, params: params };
}

// ---------------------------------------------------------------------------
// createReservation
// ---------------------------------------------------------------------------

/**
 * Creează o rezervare nouă (restaurant sau hotel).
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 *
 * @param {Object} data
 * @param {string} data.tenantId       - ID-ul tenant-ului (obligatoriu)
 * @param {string} data.tip             - 'restaurant' | 'hotel' (obligatoriu)
 * @param {string} [data.restaurantId]  - ID restaurant (dacă tip='restaurant')
 * @param {string} [data.hotelId]       - ID hotel (dacă tip='hotel')
 * @param {string} data.data            - Data rezervării YYYY-MM-DD (obligatoriu)
 * @param {string} [data.ora]           - Ora HH:mm
 * @param {number} data.numarPersoane   - Număr persoane (obligatoriu)
 * @param {string} data.numeClient      - Nume client (obligatoriu)
 * @param {string} data.emailClient     - Email client (obligatoriu)
 * @param {string} data.telefonClient   - Telefon client (obligatoriu)
 * @param {string} [data.observatii]    - Observații
 * @param {number} [data.masa]          - Număr masă (restaurant)
 * @param {string} [data.camera]        - Cameră (hotel)
 * @param {string} [data.checkIn]       - Check-in YYYY-MM-DD (hotel)
 * @param {string} [data.checkOut]      - Check-out YYYY-MM-DD (hotel)
 * @param {string} [data.guestId]       - ID guest
 * @returns {Promise<Object>} Rezervarea creată
 */
async function createReservation(data) {
  if (!data || typeof data !== 'object') {
    throw new AppError('Datele rezervării sunt invalide.', 400, 'INVALID_RESERVATION_DATA');
  }

  const {
    tenantId,
    tip,
    restaurantId,
    hotelId,
    data: dataRez,
    ora,
    numarPersoane,
    numeClient,
    emailClient,
    telefonClient,
    observatii,
    masa,
    camera,
    checkIn,
    checkOut,
    guestId,
  } = data;

  // --- validări obligatorii ---
  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  if (!tip || !VALID_RESERVATION_TYPES.includes(tip)) {
    throw new AppError(
      'Tipul rezervării trebuie să fie unul dintre: ' + VALID_RESERVATION_TYPES.join(', ') + '.',
      400,
      'INVALID_RESERVATION_TYPE'
    );
  }

  if (tip === 'restaurant' && (!restaurantId || !isValidString(restaurantId))) {
    throw new AppError(
      'ID-ul restaurantului este obligatoriu pentru rezervările de tip restaurant.',
      400,
      'MISSING_RESTAURANT_ID'
    );
  }

  if (tip === 'hotel' && (!hotelId || !isValidString(hotelId))) {
    throw new AppError(
      'ID-ul hotelului este obligatoriu pentru rezervările de tip hotel.',
      400,
      'MISSING_HOTEL_ID'
    );
  }

  if (!dataRez || !isValidDate(dataRez)) {
    throw new AppError('Data rezervării este obligatorie (YYYY-MM-DD).', 400, 'INVALID_DATE');
  }

  if (ora !== null && ora !== undefined && ora !== '' && !isValidTime(ora)) {
    throw new AppError('Ora trebuie să fie în format HH:mm.', 400, 'INVALID_TIME');
  }

  if (!Number.isInteger(numarPersoane) || numarPersoane < 1) {
    throw new AppError('Numărul de persoane trebuie să fie un întreg pozitiv.', 400, 'INVALID_GUEST_COUNT');
  }

  if (!numeClient || !isValidString(numeClient, 2, 200)) {
    throw new AppError('Numele clientului este obligatoriu (2-200 caractere).', 400, 'INVALID_CLIENT_NAME');
  }

  if (!emailClient || !isValidEmail(emailClient)) {
    throw new AppError('Email-ul clientului nu este valid.', 400, 'INVALID_EMAIL');
  }

  if (!telefonClient || !isValidPhone(telefonClient)) {
    throw new AppError('Telefonul clientului nu este valid.', 400, 'INVALID_PHONE');
  }

  // --- validări opționale ---
  if (checkIn && !isValidDate(checkIn)) {
    throw new AppError('Data de check-in nu este validă (YYYY-MM-DD).', 400, 'INVALID_CHECKIN_DATE');
  }

  if (checkOut && !isValidDate(checkOut)) {
    throw new AppError('Data de check-out nu este validă (YYYY-MM-DD).', 400, 'INVALID_CHECKOUT_DATE');
  }

  if (checkIn && checkOut && new Date(checkOut + 'T00:00:00.000Z') <= new Date(checkIn + 'T00:00:00.000Z')) {
    throw new AppError('Data de check-out trebuie să fie după data de check-in.', 400, 'CHECKOUT_BEFORE_CHECKIN');
  }

  if (tip === 'restaurant' && masa !== null && (!Number.isInteger(masa) || masa < 1)) {
    throw new AppError('Numărul mesei trebuie să fie un întreg pozitiv.', 400, 'INVALID_TABLE_NUMBER');
  }

  // --- construire document ---
  const now = nowISO();
  const finalNume = numeClient.trim();
  const finalEmail = emailClient.trim().toLowerCase();
  const finalTelefon = telefonClient.trim();
  const finalObs = typeof observatii === 'string' ? observatii.trim() : '';
  const finalRestaurantId = tip === 'restaurant' ? (restaurantId || null) : null;
  const finalHotelId = tip === 'hotel' ? (hotelId || null) : null;
  const finalMasa = tip === 'restaurant' && masa !== null ? masa : null;
  const finalCamera = tip === 'hotel' && camera ? camera.trim() : null;
  const finalCheckIn = tip === 'hotel' && checkIn ? checkIn : null;
  const finalCheckOut = tip === 'hotel' && checkOut ? checkOut : null;

  // -------------------------------------------------------------------
  // Încercare SQLite
  // -------------------------------------------------------------------
  if (_isSqlAvailable()) {
    try {
      const result = run(
        'INSERT INTO reservations (' +
        'tenantId, tip, restaurantId, hotelId, data, ora, ' +
        'numarPersoane, numeClient, emailClient, telefonClient, ' +
        'observatii, masa, camera, checkIn, checkOut, ' +
        'status, statusFacturare, sumaTotala, moneda, guestId, ' +
        'createdAt, updatedAt' +
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          tenantId, tip, finalRestaurantId, finalHotelId, dataRez, ora || null,
          numarPersoane, finalNume, finalEmail, finalTelefon,
          finalObs, finalMasa, finalCamera, finalCheckIn, finalCheckOut,
          'confirmată', 'nefacturat', 0, 'RON', guestId || null,
          now, now,
        ]
      );

      const newId = result.lastInsertRowid;
      const newRow = get('SELECT * FROM reservations WHERE id = ?', [newId]);
      return _sqlRowToDoc(newRow);
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la crearea rezervării (SQL): ' + sqlErr.message,
        500,
        'DB_INSERT_ERROR'
      );
    }
  }

  // -------------------------------------------------------------------
  // Fallback NeDB
  // -------------------------------------------------------------------
  const doc = {
    tenantId: tenantId,
    tip: tip,
    restaurantId: finalRestaurantId,
    hotelId: finalHotelId,
    data: dataRez,
    ora: ora || null,
    numarPersoane: numarPersoane,
    numeClient: finalNume,
    emailClient: finalEmail,
    telefonClient: finalTelefon,
    observatii: finalObs,
    masa: finalMasa,
    camera: finalCamera,
    checkIn: finalCheckIn,
    checkOut: finalCheckOut,
    status: 'confirmată',
    statusFacturare: 'nefacturat',
    sumaTotala: 0,
    moneda: 'RON',
    guestId: guestId || null,
    createdAt: now,
    updatedAt: now,
  };

  return new Promise(function (resolve, reject) {
    reservations.insert(doc, function (err, newDoc) {
      if (err) {
        return reject(new AppError(
          'Eroare la crearea rezervării: ' + err.message,
          500,
          'DB_INSERT_ERROR'
        ));
      }
      resolve(newDoc);
    });
  });
}

// ---------------------------------------------------------------------------
// findReservationById
// ---------------------------------------------------------------------------

/**
 * Găsește o rezervare după ID (_id) și tenantId.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 *
 * @param {string} id       - ID-ul documentului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object|null>} Documentul sau null
 */
async function findReservationById(id, tenantId) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new AppError('ID-ul rezervării este invalid.', 400, 'INVALID_RESERVATION_ID');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      const numericId = parseInt(id, 10);
      let row;
      if (isNaN(numericId)) {
        row = get(
          'SELECT * FROM reservations WHERE CAST(id AS TEXT) = ? AND tenantId = ?',
          [String(id), tenantId]
        );
      } else {
        row = get(
          'SELECT * FROM reservations WHERE id = ? AND tenantId = ?',
          [numericId, tenantId]
        );
      }
      return row ? _sqlRowToDoc(row) : null;
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la căutarea rezervării (SQL): ' + sqlErr.message,
        500,
        'DB_QUERY_ERROR'
      );
    }
  }

  // ---- NeDB ----
  return new Promise(function (resolve, reject) {
    reservations.findOne({ _id: id, tenantId: tenantId }, function (err, doc) {
      if (err) {
        return reject(new AppError(
          'Eroare la căutarea rezervării: ' + err.message,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(doc || null);
    });
  });
}

// ---------------------------------------------------------------------------
// findReservationsByRestaurant
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările unui restaurant, cu opțiuni de filtrare.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function findReservationsByRestaurant(restaurantId, tenantId, options) {
  if (!options) options = {};

  if (!restaurantId || !isValidString(restaurantId)) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      const built = _buildSqlWhere(tenantId, Object.assign({}, options, {
        tip: 'restaurant',
        restaurantId: restaurantId,
      }));

      let sql = 'SELECT * FROM reservations WHERE ' + built.whereClause;
      sql += _buildSqlOrderBy(options.sort);

      const paginated = _applySqlPagination(sql, built.params, options);
      const rows = all(paginated.sql, paginated.params);
      return rows.map(function (r) { return _sqlRowToDoc(r); });
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
        500,
        'DB_QUERY_ERROR'
      );
    }
  }

  // ---- NeDB ----
  const query = buildQuery(tenantId, Object.assign({}, options, {
    tip: 'restaurant',
    restaurantId: restaurantId,
  }));

  if (options.masa !== undefined && options.masa !== null) {
    query.masa = Number(options.masa);
  }

  return executeQuery(query, options);
}

// ---------------------------------------------------------------------------
// findReservationsByHotel
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările unui hotel, cu opțiuni de filtrare.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function findReservationsByHotel(hotelId, tenantId, options) {
  if (!options) options = {};

  if (!hotelId || !isValidString(hotelId)) {
    throw new AppError('ID-ul hotelului este invalid.', 400, 'INVALID_HOTEL_ID');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      const built = _buildSqlWhere(tenantId, Object.assign({}, options, {
        tip: 'hotel',
        hotelId: hotelId,
      }));

      let sql = 'SELECT * FROM reservations WHERE ' + built.whereClause;
      sql += _buildSqlOrderBy(options.sort);

      const paginated = _applySqlPagination(sql, built.params, options);
      const rows = all(paginated.sql, paginated.params);
      return rows.map(function (r) { return _sqlRowToDoc(r); });
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
        500,
        'DB_QUERY_ERROR'
      );
    }
  }

  // ---- NeDB ----
  const query = buildQuery(tenantId, Object.assign({}, options, {
    tip: 'hotel',
    hotelId: hotelId,
  }));

  if (options.camera) {
    query.camera = options.camera;
  }

  return executeQuery(query, options);
}

// ---------------------------------------------------------------------------
// findReservationsByTenant
// ---------------------------------------------------------------------------

/**
 * Returnează toate rezervările unui tenant, cu opțiuni de filtrare.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function findReservationsByTenant(tenantId, options) {
  if (!options) options = {};

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      const built = _buildSqlWhere(tenantId, options);
      let sql = 'SELECT * FROM reservations WHERE ' + built.whereClause;
      sql += _buildSqlOrderBy(options.sort);

      const paginated = _applySqlPagination(sql, built.params, options);
      const rows = all(paginated.sql, paginated.params);
      return rows.map(function (r) { return _sqlRowToDoc(r); });
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
        500,
        'DB_QUERY_ERROR'
      );
    }
  }

  // ---- NeDB ----
  const query = buildQuery(tenantId, options);
  return executeQuery(query, options);
}

// ---------------------------------------------------------------------------
// findReservationsByPerson
// ---------------------------------------------------------------------------

/**
 * Caută rezervări după nume, email sau telefon ale clientului.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function findReservationsByPerson(searchTerm, tenantId, options) {
  if (!options) options = {};

  if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
    throw new AppError('Termenul de căutare este obligatoriu.', 400, 'INVALID_SEARCH_TERM');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      const likeTerm = '%' + searchTerm.trim() + '%';
      const whereClause = 'tenantId = ? AND (numeClient LIKE ? OR emailClient LIKE ? OR telefonClient LIKE ?)';
      let params = [tenantId, likeTerm, likeTerm, likeTerm];

      let sql = 'SELECT * FROM reservations WHERE ' + whereClause;
      sql += _buildSqlOrderBy(options.sort);

      const paginated = _applySqlPagination(sql, params, options);
      const rows = all(paginated.sql, paginated.params);
      return rows.map(function (r) { return _sqlRowToDoc(r); });
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
        500,
        'DB_QUERY_ERROR'
      );
    }
  }

  // ---- NeDB ----
  const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedTerm, 'i');

  const query = {
    tenantId: tenantId,
    $or: [
      { numeClient: regex },
      { emailClient: regex },
      { telefonClient: regex },
    ],
  };

  return executeQuery(query, options);
}

// ---------------------------------------------------------------------------
// findReservationsByStatus
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările cu un anumit status.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function findReservationsByStatus(status, tenantId, options) {
  if (!options) options = {};

  if (!status || !VALID_RESERVATION_STATUSES.includes(status)) {
    throw new AppError(
      'Statusul "' + status + '" nu este valid. Permise: ' + VALID_RESERVATION_STATUSES.join(', ') + '.',
      400,
      'INVALID_STATUS'
    );
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      const built = _buildSqlWhere(tenantId, Object.assign({}, options, { status: status }));
      let sql = 'SELECT * FROM reservations WHERE ' + built.whereClause;
      sql += _buildSqlOrderBy(options.sort);

      const paginated = _applySqlPagination(sql, built.params, options);
      const rows = all(paginated.sql, paginated.params);
      return rows.map(function (r) { return _sqlRowToDoc(r); });
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
        500,
        'DB_QUERY_ERROR'
      );
    }
  }

  // ---- NeDB ----
  const query = buildQuery(tenantId, Object.assign({}, options, { status: status }));
  return executeQuery(query, options);
}

// ---------------------------------------------------------------------------
// findReservationsByDate
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările pentru o anumită dată.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function findReservationsByDate(date, tenantId, options) {
  if (!options) options = {};

  if (!date || !isValidDate(date)) {
    throw new AppError('Data este obligatorie și trebuie să fie în format YYYY-MM-DD.', 400, 'INVALID_DATE');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      const built = _buildSqlWhere(tenantId, Object.assign({}, options, { data: date }));
      let sql = 'SELECT * FROM reservations WHERE ' + built.whereClause;
      sql += _buildSqlOrderBy(options.sort);

      const paginated = _applySqlPagination(sql, built.params, options);
      const rows = all(paginated.sql, paginated.params);
      return rows.map(function (r) { return _sqlRowToDoc(r); });
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
        500,
        'DB_QUERY_ERROR'
      );
    }
  }

  // ---- NeDB ----
  const query = buildQuery(tenantId, Object.assign({}, options, { data: date }));
  return executeQuery(query, options);
}

// ---------------------------------------------------------------------------
// findReservationsByCheckInDate
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările cu o anumită dată de check-in.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function findReservationsByCheckInDate(date, tenantId, options) {
  if (!options) options = {};

  if (!date || !isValidDate(date)) {
    throw new AppError('Data de check-in este obligatorie (YYYY-MM-DD).', 400, 'INVALID_CHECKIN_DATE');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      let whereClause = 'tenantId = ? AND tip = ? AND checkIn = ?';
      const params = [tenantId, 'hotel', date];

      if (options.status) {
        whereClause += ' AND status = ?';
        params.push(options.status);
      }

      let sql = 'SELECT * FROM reservations WHERE ' + whereClause;
      sql += _buildSqlOrderBy(options.sort);

      const paginated = _applySqlPagination(sql, params, options);
      const rows = all(paginated.sql, paginated.params);
      return rows.map(function (r) { return _sqlRowToDoc(r); });
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
        500,
        'DB_QUERY_ERROR'
      );
    }
  }

  // ---- NeDB ----
  const query = {
    tenantId: tenantId,
    tip: 'hotel',
    checkIn: date,
  };

  if (options.status) query.status = options.status;

  return executeQuery(query, options);
}

// ---------------------------------------------------------------------------
// findReservationsByCheckOutDate
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările cu o anumită dată de check-out.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function findReservationsByCheckOutDate(date, tenantId, options) {
  if (!options) options = {};

  if (!date || !isValidDate(date)) {
    throw new AppError('Data de check-out este obligatorie (YYYY-MM-DD).', 400, 'INVALID_CHECKOUT_DATE');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      let whereClause = 'tenantId = ? AND tip = ? AND checkOut = ?';
      const params = [tenantId, 'hotel', date];

      if (options.status) {
        whereClause += ' AND status = ?';
        params.push(options.status);
      }

      let sql = 'SELECT * FROM reservations WHERE ' + whereClause;
      sql += _buildSqlOrderBy(options.sort);

      const paginated = _applySqlPagination(sql, params, options);
      const rows = all(paginated.sql, paginated.params);
      return rows.map(function (r) { return _sqlRowToDoc(r); });
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
        500,
        'DB_QUERY_ERROR'
      );
    }
  }

  // ---- NeDB ----
  const query = {
    tenantId: tenantId,
    tip: 'hotel',
    checkOut: date,
  };

  if (options.status) query.status = options.status;

  return executeQuery(query, options);
}

// ---------------------------------------------------------------------------
// findReservationsByGuestId
// ---------------------------------------------------------------------------

/**
 * Returnează istoricul rezervărilor pentru un oaspete (guestId).
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function findReservationsByGuestId(guestId, tenantId, options) {
  if (!options) options = {};

  if (!guestId || typeof guestId !== 'string' || guestId.trim().length === 0) {
    throw new AppError('ID-ul oaspetelui este obligatoriu.', 400, 'INVALID_GUEST_ID');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      let sql = 'SELECT * FROM reservations WHERE tenantId = ? AND guestId = ?';
      const params = [tenantId, guestId];
      sql += _buildSqlOrderBy(options.sort);

      const paginated = _applySqlPagination(sql, params, options);
      const rows = all(paginated.sql, paginated.params);
      return rows.map(function (r) { return _sqlRowToDoc(r); });
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
        500,
        'DB_QUERY_ERROR'
      );
    }
  }

  // ---- NeDB ----
  const query = { tenantId: tenantId, guestId: guestId };
  return executeQuery(query, options);
}

// ---------------------------------------------------------------------------
// updateReservation
// ---------------------------------------------------------------------------

/**
 * Actualizează complet o rezervare.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function updateReservation(id, tenantId, updates) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new AppError('ID-ul rezervării este invalid.', 400, 'INVALID_RESERVATION_ID');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  if (!updates || typeof updates !== 'object') {
    throw new AppError('Datele de actualizare sunt invalide.', 400, 'INVALID_UPDATE_DATA');
  }

  // Verificăm existența
  const existing = await findReservationById(id, tenantId);
  if (!existing) {
    return null;
  }

  // Construim setul de actualizare (doar câmpurile permise)
  const allowedFields = [
    'tip', 'restaurantId', 'hotelId', 'data', 'ora',
    'numarPersoane', 'numeClient', 'emailClient', 'telefonClient',
    'observatii', 'masa', 'camera', 'checkIn', 'checkOut',
  ];

  const setFields = {};
  const sqlSetClauses = [];
  const sqlParams = [];
  const now = nowISO();

  for (let i = 0; i < allowedFields.length; i++) {
    const field = allowedFields[i];
    if (field in updates) {
      const val = updates[field];

      // Validări per câmp
      switch (field) {
        case 'tip':
          if (val && !VALID_RESERVATION_TYPES.includes(val)) {
            throw new AppError(
              'Tipul trebuie să fie unul dintre: ' + VALID_RESERVATION_TYPES.join(', ') + '.',
              400,
              'INVALID_RESERVATION_TYPE'
            );
          }
          setFields.tip = val;
          sqlSetClauses.push('tip = ?');
          sqlParams.push(val);
          break;

        case 'data':
          if (val && !isValidDate(val)) {
            throw new AppError('Data trebuie să fie în format YYYY-MM-DD.', 400, 'INVALID_DATE');
          }
          setFields.data = val;
          sqlSetClauses.push('data = ?');
          sqlParams.push(val);
          break;

        case 'ora':
          if (val && !isValidTime(val)) {
            throw new AppError('Ora trebuie să fie în format HH:mm.', 400, 'INVALID_TIME');
          }
          setFields.ora = val;
          sqlSetClauses.push('ora = ?');
          sqlParams.push(val);
          break;

        case 'numarPersoane':
          if (!Number.isInteger(val) || val < 1) {
            throw new AppError('Numărul de persoane trebuie să fie un întreg pozitiv.', 400, 'INVALID_GUEST_COUNT');
          }
          setFields.numarPersoane = val;
          sqlSetClauses.push('numarPersoane = ?');
          sqlParams.push(val);
          break;

        case 'numeClient':
          if (val && !isValidString(val, 2, 200)) {
            throw new AppError('Numele clientului trebuie să aibă 2-200 caractere.', 400, 'INVALID_CLIENT_NAME');
          }
          setFields.numeClient = val.trim();
          sqlSetClauses.push('numeClient = ?');
          sqlParams.push(val.trim());
          break;

        case 'emailClient':
          if (val && !isValidEmail(val)) {
            throw new AppError('Email-ul clientului nu este valid.', 400, 'INVALID_EMAIL');
          }
          setFields.emailClient = val.trim().toLowerCase();
          sqlSetClauses.push('emailClient = ?');
          sqlParams.push(val.trim().toLowerCase());
          break;

        case 'telefonClient':
          if (val && !isValidPhone(val)) {
            throw new AppError('Telefonul clientului nu este valid.', 400, 'INVALID_PHONE');
          }
          setFields.telefonClient = val.trim();
          sqlSetClauses.push('telefonClient = ?');
          sqlParams.push(val.trim());
          break;

        case 'observatii':
          setFields.observatii = typeof val === 'string' ? val.trim() : '';
          sqlSetClauses.push('observatii = ?');
          sqlParams.push(typeof val === 'string' ? val.trim() : '');
          break;

        case 'masa':
          if (val !== null && (!Number.isInteger(val) || val < 1)) {
            throw new AppError('Numărul mesei trebuie să fie un întreg pozitiv.', 400, 'INVALID_TABLE_NUMBER');
          }
          setFields.masa = val;
          sqlSetClauses.push('masa = ?');
          sqlParams.push(val);
          break;

        case 'camera':
          setFields.camera = val ? val.trim() : null;
          sqlSetClauses.push('camera = ?');
          sqlParams.push(val ? val.trim() : null);
          break;

        case 'checkIn':
          if (val && !isValidDate(val)) {
            throw new AppError('Data de check-in nu este validă (YYYY-MM-DD).', 400, 'INVALID_CHECKIN_DATE');
          }
          setFields.checkIn = val || null;
          sqlSetClauses.push('checkIn = ?');
          sqlParams.push(val || null);
          break;

        case 'checkOut':
          if (val && !isValidDate(val)) {
            throw new AppError('Data de check-out nu este validă (YYYY-MM-DD).', 400, 'INVALID_CHECKOUT_DATE');
          }
          setFields.checkOut = val || null;
          sqlSetClauses.push('checkOut = ?');
          sqlParams.push(val || null);
          break;

        case 'restaurantId':
          setFields.restaurantId = val || null;
          sqlSetClauses.push('restaurantId = ?');
          sqlParams.push(val || null);
          break;

        case 'hotelId':
          setFields.hotelId = val || null;
          sqlSetClauses.push('hotelId = ?');
          sqlParams.push(val || null);
          break;

        default:
          setFields[field] = val;
      }
    }
  }

  // Validare cross-field: checkOut > checkIn
  const finalCheckIn = setFields.checkIn !== undefined ? setFields.checkIn : existing.checkIn;
  const finalCheckOut = setFields.checkOut !== undefined ? setFields.checkOut : existing.checkOut;
  if (finalCheckIn && finalCheckOut && new Date(finalCheckOut + 'T00:00:00.000Z') <= new Date(finalCheckIn + 'T00:00:00.000Z')) {
    throw new AppError('Data de check-out trebuie să fie după data de check-in.', 400, 'CHECKOUT_BEFORE_CHECKIN');
  }

  setFields.updatedAt = now;
  sqlSetClauses.push('updatedAt = ?');
  sqlParams.push(now);

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      const numericId = parseInt(id, 10);
      if (!isNaN(numericId)) {
        sqlParams.push(numericId);
        sqlParams.push(tenantId);
        const result = run(
          'UPDATE reservations SET ' + sqlSetClauses.join(', ') + ' WHERE id = ? AND tenantId = ?',
          sqlParams
        );
        if (result.changes === 0) {
          return null;
        }
        const updatedRow = get('SELECT * FROM reservations WHERE id = ?', [numericId]);
        return _sqlRowToDoc(updatedRow);
      } else {
        sqlParams.push(String(id));
        sqlParams.push(tenantId);
        const result = run(
          'UPDATE reservations SET ' + sqlSetClauses.join(', ') + ' WHERE CAST(id AS TEXT) = ? AND tenantId = ?',
          sqlParams
        );
        if (result.changes === 0) {
          return null;
        }
        const updatedRow = get('SELECT * FROM reservations WHERE CAST(id AS TEXT) = ?', [String(id)]);
        return _sqlRowToDoc(updatedRow);
      }
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la actualizarea rezervării (SQL): ' + sqlErr.message,
        500,
        'DB_UPDATE_ERROR'
      );
    }
  }

  // ---- NeDB ----
  return new Promise(function (resolve, reject) {
    reservations.update(
      { _id: id, tenantId: tenantId },
      { $set: setFields },
      {},
      function (err, numReplaced) {
        if (err) {
          return reject(new AppError(
            'Eroare la actualizarea rezervării: ' + err.message,
            500,
            'DB_UPDATE_ERROR'
          ));
        }
        if (numReplaced === 0) {
          return resolve(null);
        }
        // Returnăm documentul actualizat
        reservations.findOne({ _id: id, tenantId: tenantId }, function (err2, doc) {
          if (err2) {
            return reject(new AppError(
              'Eroare la citirea rezervării actualizate: ' + err2.message,
              500,
              'DB_QUERY_ERROR'
            ));
          }
          resolve(doc || null);
        });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// updateReservationStatus
// ---------------------------------------------------------------------------

/**
 * Actualizează statusul unei rezervări.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function updateReservationStatus(id, tenantId, status) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new AppError('ID-ul rezervării este invalid.', 400, 'INVALID_RESERVATION_ID');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  if (!status || !VALID_RESERVATION_STATUSES.includes(status)) {
    throw new AppError(
      'Statusul "' + status + '" nu este valid. Permise: ' + VALID_RESERVATION_STATUSES.join(', ') + '.',
      400,
      'INVALID_STATUS'
    );
  }

  const existing = await findReservationById(id, tenantId);
  if (!existing) {
    return null;
  }

  // Reguli de tranziție
  if (existing.status === 'anulată' && status !== 'anulată') {
    throw new AppError('O rezervare anulată nu mai poate fi reactivată.', 400, 'STATUS_TRANSITION_DENIED');
  }

  if ((existing.status === 'finalizată' || existing.status === 'check-out') &&
      status === 'anulată') {
    throw new AppError('Rezervările finalizate nu pot fi anulate.', 400, 'STATUS_TRANSITION_DENIED');
  }

  const now = nowISO();

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      const numericId = parseInt(id, 10);
      let result;
      if (!isNaN(numericId)) {
        result = run(
          'UPDATE reservations SET status = ?, updatedAt = ? WHERE id = ? AND tenantId = ?',
          [status, now, numericId, tenantId]
        );
      } else {
        result = run(
          'UPDATE reservations SET status = ?, updatedAt = ? WHERE CAST(id AS TEXT) = ? AND tenantId = ?',
          [status, now, String(id), tenantId]
        );
      }
      if (result.changes === 0) {
        return null;
      }
      return findReservationById(id, tenantId);
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la actualizarea statusului (SQL): ' + sqlErr.message,
        500,
        'DB_UPDATE_ERROR'
      );
    }
  }

  // ---- NeDB ----
  return new Promise(function (resolve, reject) {
    reservations.update(
      { _id: id, tenantId: tenantId },
      { $set: { status: status, updatedAt: now } },
      {},
      function (err) {
        if (err) {
          return reject(new AppError(
            'Eroare la actualizarea statusului: ' + err.message,
            500,
            'DB_UPDATE_ERROR'
          ));
        }
        reservations.findOne({ _id: id, tenantId: tenantId }, function (err2, doc) {
          if (err2) {
            return reject(new AppError(
              'Eroare la citirea rezervării: ' + err2.message,
              500,
              'DB_QUERY_ERROR'
            ));
          }
          resolve(doc || null);
        });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// deleteReservation
// ---------------------------------------------------------------------------

/**
 * Șterge o rezervare.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function deleteReservation(id, tenantId) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new AppError('ID-ul rezervării este invalid.', 400, 'INVALID_RESERVATION_ID');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      const numericId = parseInt(id, 10);
      let result;
      if (!isNaN(numericId)) {
        result = run(
          'DELETE FROM reservations WHERE id = ? AND tenantId = ?',
          [numericId, tenantId]
        );
      } else {
        result = run(
          'DELETE FROM reservations WHERE CAST(id AS TEXT) = ? AND tenantId = ?',
          [String(id), tenantId]
        );
      }
      return result.changes > 0;
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la ștergerea rezervării (SQL): ' + sqlErr.message,
        500,
        'DB_DELETE_ERROR'
      );
    }
  }

  // ---- NeDB ----
  return new Promise(function (resolve, reject) {
    reservations.remove({ _id: id, tenantId: tenantId }, {}, function (err, numRemoved) {
      if (err) {
        return reject(new AppError(
          'Eroare la ștergerea rezervării: ' + err.message,
          500,
          'DB_DELETE_ERROR'
        ));
      }
      resolve(numRemoved > 0);
    });
  });
}

// ---------------------------------------------------------------------------
// checkInReservation
// ---------------------------------------------------------------------------

/**
 * Efectuează check-in pentru o rezervare de tip hotel.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function checkInReservation(id, tenantId) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new AppError('ID-ul rezervării este invalid.', 400, 'INVALID_RESERVATION_ID');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  const existing = await findReservationById(id, tenantId);
  if (!existing) {
    return null;
  }

  if (existing.tip !== 'hotel') {
    throw new AppError('Check-in-ul este disponibil doar pentru rezervările de tip hotel.', 400, 'INVALID_RESERVATION_TYPE');
  }

  if (existing.status === 'anulată') {
    throw new AppError('Nu se poate face check-in pentru o rezervare anulată.', 400, 'STATUS_TRANSITION_DENIED');
  }

  if (existing.status === 'check-in') {
    throw new AppError('Check-in-ul a fost deja efectuat pentru această rezervare.', 400, 'ALREADY_CHECKED_IN');
  }

  if (existing.status === 'check-out' || existing.status === 'finalizată') {
    throw new AppError('Nu se poate face check-in pentru o rezervare finalizată.', 400, 'STATUS_TRANSITION_DENIED');
  }

  const now = nowISO();

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      const numericId = parseInt(id, 10);
      if (!isNaN(numericId)) {
        run(
          'UPDATE reservations SET status = ?, updatedAt = ? WHERE id = ? AND tenantId = ?',
          ['check-in', now, numericId, tenantId]
        );
      } else {
        run(
          'UPDATE reservations SET status = ?, updatedAt = ? WHERE CAST(id AS TEXT) = ? AND tenantId = ?',
          ['check-in', now, String(id), tenantId]
        );
      }
      return findReservationById(id, tenantId);
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la check-in (SQL): ' + sqlErr.message,
        500,
        'DB_UPDATE_ERROR'
      );
    }
  }

  // ---- NeDB ----
  return new Promise(function (resolve, reject) {
    reservations.update(
      { _id: id, tenantId: tenantId },
      { $set: { status: 'check-in', updatedAt: now } },
      {},
      function (err) {
        if (err) {
          return reject(new AppError(
            'Eroare la check-in: ' + err.message,
            500,
            'DB_UPDATE_ERROR'
          ));
        }
        reservations.findOne({ _id: id, tenantId: tenantId }, function (err2, doc) {
          if (err2) {
            return reject(new AppError(
              'Eroare la citirea rezervării: ' + err2.message,
              500,
              'DB_QUERY_ERROR'
            ));
          }
          resolve(doc || null);
        });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// checkOutReservation
// ---------------------------------------------------------------------------

/**
 * Efectuează check-out pentru o rezervare de tip hotel.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function checkOutReservation(id, tenantId) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new AppError('ID-ul rezervării este invalid.', 400, 'INVALID_RESERVATION_ID');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  const existing = await findReservationById(id, tenantId);
  if (!existing) {
    return null;
  }

  if (existing.tip !== 'hotel') {
    throw new AppError('Check-out-ul este disponibil doar pentru rezervările de tip hotel.', 400, 'INVALID_RESERVATION_TYPE');
  }

  if (existing.status === 'anulată') {
    throw new AppError('Nu se poate face check-out pentru o rezervare anulată.', 400, 'STATUS_TRANSITION_DENIED');
  }

  if (existing.status === 'check-out' || existing.status === 'finalizată') {
    throw new AppError('Check-out-ul a fost deja efectuat pentru această rezervare.', 400, 'ALREADY_CHECKED_OUT');
  }

  if (existing.status !== 'check-in' && existing.status !== 'confirmată' && existing.status !== 'în curs') {
    throw new AppError(
      'Nu se poate face check-out dintr-un status "' + existing.status + '".',
      400,
      'STATUS_TRANSITION_DENIED'
    );
  }

  const now = nowISO();

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      const numericId = parseInt(id, 10);
      if (!isNaN(numericId)) {
        run(
          'UPDATE reservations SET status = ?, updatedAt = ? WHERE id = ? AND tenantId = ?',
          ['check-out', now, numericId, tenantId]
        );
      } else {
        run(
          'UPDATE reservations SET status = ?, updatedAt = ? WHERE CAST(id AS TEXT) = ? AND tenantId = ?',
          ['check-out', now, String(id), tenantId]
        );
      }
      return findReservationById(id, tenantId);
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la check-out (SQL): ' + sqlErr.message,
        500,
        'DB_UPDATE_ERROR'
      );
    }
  }

  // ---- NeDB ----
  return new Promise(function (resolve, reject) {
    reservations.update(
      { _id: id, tenantId: tenantId },
      { $set: { status: 'check-out', updatedAt: now } },
      {},
      function (err) {
        if (err) {
          return reject(new AppError(
            'Eroare la check-out: ' + err.message,
            500,
            'DB_UPDATE_ERROR'
          ));
        }
        reservations.findOne({ _id: id, tenantId: tenantId }, function (err2, doc) {
          if (err2) {
            return reject(new AppError(
              'Eroare la citirea rezervării: ' + err2.message,
              500,
              'DB_QUERY_ERROR'
            ));
          }
          resolve(doc || null);
        });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// updateReservationBilling
// ---------------------------------------------------------------------------

/**
 * Actualizează informațiile de facturare ale unei rezervări.
 * Compatibilitate duală: SQLite (primar) + NeDB (fallback).
 */
async function updateReservationBilling(id, tenantId, billingData) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new AppError('ID-ul rezervării este invalid.', 400, 'INVALID_RESERVATION_ID');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  if (!billingData || typeof billingData !== 'object') {
    throw new AppError('Datele de facturare sunt invalide.', 400, 'INVALID_BILLING_DATA');
  }

  const { statusFacturare, sumaTotala, moneda } = billingData;

  if (!statusFacturare || !VALID_BILLING_STATUSES.includes(statusFacturare)) {
    throw new AppError(
      'Statusul de facturare trebuie să fie unul dintre: ' + VALID_BILLING_STATUSES.join(', ') + '.',
      400,
      'INVALID_BILLING_STATUS'
    );
  }

  const existing = await findReservationById(id, tenantId);
  if (!existing) {
    return null;
  }

  if (sumaTotala !== undefined && sumaTotala !== null) {
    if (typeof sumaTotala !== 'number' || sumaTotala < 0) {
      throw new AppError('Suma totală trebuie să fie un număr pozitiv.', 400, 'INVALID_AMOUNT');
    }
  }

  if (moneda !== undefined && moneda !== null) {
    if (typeof moneda !== 'string' || moneda.trim().length !== 3) {
      throw new AppError('Moneda trebuie să fie un cod de 3 caractere (ex: RON, EUR).', 400, 'INVALID_CURRENCY');
    }
  }

  const now = nowISO();
  const finalMoneda = moneda ? moneda.trim().toUpperCase() : undefined;

  // ---- SQLite ----
  if (_isSqlAvailable()) {
    try {
      const numericId = parseInt(id, 10);
      const setClauses = ['statusFacturare = ?', 'updatedAt = ?'];
      const params = [statusFacturare, now];

      if (sumaTotala !== undefined && sumaTotala !== null) {
        setClauses.push('sumaTotala = ?');
        params.push(sumaTotala);
      }
      if (finalMoneda !== undefined) {
        setClauses.push('moneda = ?');
        params.push(finalMoneda);
      }

      if (!isNaN(numericId)) {
        params.push(numericId);
        params.push(tenantId);
        run(
          'UPDATE reservations SET ' + setClauses.join(', ') + ' WHERE id = ? AND tenantId = ?',
          params
        );
      } else {
        params.push(String(id));
        params.push(tenantId);
        run(
          'UPDATE reservations SET ' + setClauses.join(', ') + ' WHERE CAST(id AS TEXT) = ? AND tenantId = ?',
          params
        );
      }
      return findReservationById(id, tenantId);
    } catch (sqlErr) {
      throw new AppError(
        'Eroare la actualizarea facturării (SQL): ' + sqlErr.message,
        500,
        'DB_UPDATE_ERROR'
      );
    }
  }

  // ---- NeDB ----
  const setFields = {
    statusFacturare: statusFacturare,
    updatedAt: now,
  };

  if (sumaTotala !== undefined && sumaTotala !== null) {
    setFields.sumaTotala = sumaTotala;
  }

  if (finalMoneda !== undefined) {
    setFields.moneda = finalMoneda;
  }

  return new Promise(function (resolve, reject) {
    reservations.update(
      { _id: id, tenantId: tenantId },
      { $set: setFields },
      {},
      function (err) {
        if (err) {
          return reject(new AppError(
            'Eroare la actualizarea facturării: ' + err.message,
            500,
            'DB_UPDATE_ERROR'
          ));
        }
        reservations.findOne({ _id: id, tenantId: tenantId }, function (err2, doc) {
          if (err2) {
            return reject(new AppError(
              'Eroare la citirea rezervării: ' + err2.message,
              500,
              'DB_QUERY_ERROR'
            ));
          }
          resolve(doc || null);
        });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// getReservationBillingSummary
// ---------------------------------------------------------------------------

/**
 * Obține sumarul de facturare pentru o rezervare.
 */
async function getReservationBillingSummary(id, tenantId) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new AppError('ID-ul rezervării este invalid.', 400, 'INVALID_RESERVATION_ID');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  const existing = await findReservationById(id, tenantId);
  if (!existing) {
    return null;
  }

  // Construim sumarul de facturare
  const numNopti = computeNopti(existing);

  return {
    reservationId: existing._id,
    numeClient: existing.numeClient,
    emailClient: existing.emailClient,
    tip: existing.tip,
    data: existing.data,
    checkIn: existing.checkIn,
    checkOut: existing.checkOut,
    numNopti: numNopti,
    numarPersoane: existing.numarPersoane,
    camera: existing.camera,
    status: existing.status,
    statusFacturare: existing.statusFacturare,
    sumaTotala: existing.sumaTotala || 0,
    moneda: existing.moneda || 'RON',
  };
}

/**
 * Calculează numărul de nopți pe baza checkIn și checkOut.
 */
function computeNopti(reservation) {
  if (!reservation.checkIn || !reservation.checkOut) {
    return 0;
  }
  const checkIn = new Date(reservation.checkIn + 'T00:00:00.000Z');
  const checkOut = new Date(reservation.checkOut + 'T00:00:00.000Z');
  if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
    return 0;
  }
  const diffMs = checkOut.getTime() - checkIn.getTime();
  const nights = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return nights > 0 ? nights : 0;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = {
  // Constante
  VALID_RESERVATION_TYPES: VALID_RESERVATION_TYPES,
  VALID_RESERVATION_STATUSES: VALID_RESERVATION_STATUSES,
  VALID_BILLING_STATUSES: VALID_BILLING_STATUSES,

  // Funcții CRUD + căutare
  createReservation: createReservation,
  findReservationById: findReservationById,
  findReservationsByRestaurant: findReservationsByRestaurant,
  findReservationsByHotel: findReservationsByHotel,
  findReservationsByTenant: findReservationsByTenant,
  findReservationsByPerson: findReservationsByPerson,
  findReservationsByStatus: findReservationsByStatus,
  findReservationsByDate: findReservationsByDate,
  updateReservation: updateReservation,
  updateReservationStatus: updateReservationStatus,
  deleteReservation: deleteReservation,

  // Funcții specifice guest
  findReservationsByGuestId: findReservationsByGuestId,

  // Funcții hotel
  findReservationsByCheckInDate: findReservationsByCheckInDate,
  findReservationsByCheckOutDate: findReservationsByCheckOutDate,
  checkInReservation: checkInReservation,
  checkOutReservation: checkOutReservation,

  // Facturare
  updateReservationBilling: updateReservationBilling,
  getReservationBillingSummary: getReservationBillingSummary,

  // Expunere pentru testare și debugging
  _isSqlAvailable: _isSqlAvailable,
  _sqlRowToDoc: _sqlRowToDoc,
  _ensureSqlSchema: _ensureSqlSchema,
  _resetSqlMigrated: function () { _sqlMigrated = false; },
};