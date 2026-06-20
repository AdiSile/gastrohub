'use strict';

// ---------------------------------------------------------------------------
// Model Reservation – GastroHub
// Gestionează rezervările (restaurant + hotel) prin SQLite.
//
// Structura unui document (camelCase – API):
//   _id              {string}  – conversie din id (SQLite)
//   tenantId         {string}  – tenant-ul proprietar (obligatoriu)
//   tip              {string}  – 'restaurant' | 'hotel' (obligatoriu)
//   restaurantId     {string}  – ID restaurant (dacă tip='restaurant')
//   hotelId          {string}  – ID hotel (dacă tip='hotel')
//   roomId           {string}  – ID cameră (dacă tip='hotel')
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
//
// NOTĂ: Coloanele din baza de date SQLite sunt snake_case.
// Modelul face conversia automată snake_case ↔ camelCase.
// ---------------------------------------------------------------------------

const { getDb, run, get, all } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Mapare coloane DB (snake_case) ↔ Document JS (camelCase)
// ---------------------------------------------------------------------------

/**
 * Mapare de la numele coloanei din baza de date (snake_case)
 * la cheia din documentul JavaScript (camelCase).
 */
const COL_DB_TO_JS = {
  'id': '_id',
  'tenant_id': 'tenantId',
  'tip': 'tip',
  'restaurant_id': 'restaurantId',
  'hotel_id': 'hotelId',
  'room_id': 'roomId',
  'data': 'data',
  'ora': 'ora',
  'numar_persoane': 'numarPersoane',
  'nume_client': 'numeClient',
  'email_client': 'emailClient',
  'telefon_client': 'telefonClient',
  'observatii': 'observatii',
  'masa': 'masa',
  'camera': 'camera',
  'check_in': 'checkIn',
  'check_out': 'checkOut',
  'status': 'status',
  'status_facturare': 'statusFacturare',
  'total_price': 'sumaTotala',
  'moneda': 'moneda',
  'guest_id': 'guestId',
  'created_at': 'createdAt',
  'updated_at': 'updatedAt',
};

/**
 * Mapare inversă: camelCase → snake_case (pentru coloane SQL).
 */
const COL_JS_TO_DB = {};
for (const dbCol of Object.keys(COL_DB_TO_JS)) {
  COL_JS_TO_DB[COL_DB_TO_JS[dbCol]] = dbCol;
}

// ---------------------------------------------------------------------------
// Detecție backend SQLite
// ---------------------------------------------------------------------------

/**
 * Returnează `true` dacă SQLite este disponibil și inițializat.
 * Schema este deja gestionată de config/db (_createTables).
 * @returns {Promise<boolean>}
 */
async function _isSqlAvailable() {
  try {
    await getDb();
    return true;
  } catch (_e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers de conversie rând SQL → document
// ---------------------------------------------------------------------------

/**
 * Convertește un rând SQL (id INTEGER) într-un obiect cu _id string.
 * Face maparea snake_case → camelCase folosind COL_DB_TO_JS.
 * @param {Object} row
 * @returns {Promise<Object>}
 */
async function _sqlRowToDoc(row) {
  if (!row) return row;
  const doc = {};
  const keys = Object.keys(row);
  for (let i = 0; i < keys.length; i++) {
    const dbKey = keys[i];
    const jsKey = COL_DB_TO_JS[dbKey] || dbKey;
    doc[jsKey] = row[dbKey];
  }
  // Asigurăm _id string
  if (row.id !== undefined && row.id !== null) {
    doc._id = String(row.id);
  }
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
// Helpers SQLite – construire WHERE + ORDER BY + LIMIT/OFFSET din opțiuni
// ---------------------------------------------------------------------------

/**
 * Construiește clauza WHERE și parametrii pentru o interogare SQL.
 * Folosește nume de coloană snake_case (DB).
 */
function _buildSqlWhere(tenantId, options) {
  if (!options) options = {};
  const clauses = ['tenant_id = ?'];
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
    clauses.push('restaurant_id = ?');
    params.push(options.restaurantId);
  }

  if (options.hotelId) {
    clauses.push('hotel_id = ?');
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
 * Acceptă atât nume camelCase cât și snake_case; le convertește la snake_case pentru SQL.
 */
function _buildSqlOrderBy(sort) {
  if (!sort) return ' ORDER BY created_at DESC';

  const isDesc = sort.startsWith('-');
  const fieldRaw = isDesc ? sort.slice(1) : sort;

  // Dacă e camelCase, îl mapăm la snake_case; altfel păstrăm ca atare
  const dbField = COL_JS_TO_DB[fieldRaw] || fieldRaw;
  const safeField = dbField.replace(/[^a-zA-Z0-9_]/g, '');
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

  if (tip === 'restaurant' && masa !== null && masa !== undefined && (!Number.isInteger(masa) || masa < 1)) {
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
  const finalMasa = tip === 'restaurant' && masa !== null && masa !== undefined ? Number(masa) : null;
  const finalCamera = tip === 'hotel' && camera ? camera.trim() : null;
  const finalCheckIn = tip === 'hotel' && checkIn ? checkIn : null;
  const finalCheckOut = tip === 'hotel' && checkOut ? checkOut : null;

  // -------------------------------------------------------------------
  // SQLite – coloane snake_case
  // -------------------------------------------------------------------
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    const result = await run(
      'INSERT INTO reservations (' +
      'tenant_id, tip, restaurant_id, hotel_id, data, ora, ' +
      'numar_persoane, nume_client, email_client, telefon_client, ' +
      'observatii, masa, camera, check_in, check_out, ' +
      'status, status_facturare, total_price, moneda, guest_id, ' +
      'created_at, updated_at' +
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
    const newRow = await get('SELECT * FROM reservations WHERE id = ?', [newId]);
    return await _sqlRowToDoc(newRow);
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la crearea rezervării (SQL): ' + sqlErr.message,
      500,
      'DB_INSERT_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// findReservationById
// ---------------------------------------------------------------------------

/**
 * Găsește o rezervare după ID (_id) și tenantId.
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
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    const numericId = parseInt(id, 10);
    let row;
    if (isNaN(numericId)) {
      row = await get(
        'SELECT * FROM reservations WHERE CAST(id AS TEXT) = ? AND tenant_id = ?',
        [String(id), tenantId]
      );
    } else {
      row = await get(
        'SELECT * FROM reservations WHERE id = ? AND tenant_id = ?',
        [numericId, tenantId]
      );
    }
    return row ? await _sqlRowToDoc(row) : null;
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea rezervării (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// findReservationsByRestaurant
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările unui restaurant, cu opțiuni de filtrare.
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
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    const built = _buildSqlWhere(tenantId, Object.assign({}, options, {
      tip: 'restaurant',
      restaurantId: restaurantId,
    }));

    let sql = 'SELECT * FROM reservations WHERE ' + built.whereClause;
    sql += _buildSqlOrderBy(options.sort);

    const paginated = _applySqlPagination(sql, built.params, options);
    const rows = await all(paginated.sql, paginated.params);
    return Promise.all(rows.map(function (r) { return _sqlRowToDoc(r); }));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// findReservationsByHotel
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările unui hotel, cu opțiuni de filtrare.
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
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    const built = _buildSqlWhere(tenantId, Object.assign({}, options, {
      tip: 'hotel',
      hotelId: hotelId,
    }));

    let sql = 'SELECT * FROM reservations WHERE ' + built.whereClause;
    sql += _buildSqlOrderBy(options.sort);

    const paginated = _applySqlPagination(sql, built.params, options);
    const rows = await all(paginated.sql, paginated.params);
    return Promise.all(rows.map(function (r) { return _sqlRowToDoc(r); }));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// findReservationsByTenant
// ---------------------------------------------------------------------------

/**
 * Returnează toate rezervările unui tenant, cu opțiuni de filtrare.
 */
async function findReservationsByTenant(tenantId, options) {
  if (!options) options = {};

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // ---- SQLite ----
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    const built = _buildSqlWhere(tenantId, options);
    let sql = 'SELECT * FROM reservations WHERE ' + built.whereClause;
    sql += _buildSqlOrderBy(options.sort);

    const paginated = _applySqlPagination(sql, built.params, options);
    const rows = await all(paginated.sql, paginated.params);
    return Promise.all(rows.map(function (r) { return _sqlRowToDoc(r); }));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// findReservationsByPerson
// ---------------------------------------------------------------------------

/**
 * Caută rezervări după nume, email sau telefon ale clientului.
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
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    const likeTerm = '%' + searchTerm.trim() + '%';
    const whereClause = 'tenant_id = ? AND (nume_client LIKE ? OR email_client LIKE ? OR telefon_client LIKE ?)';
    let params = [tenantId, likeTerm, likeTerm, likeTerm];

    let sql = 'SELECT * FROM reservations WHERE ' + whereClause;
    sql += _buildSqlOrderBy(options.sort);

    const paginated = _applySqlPagination(sql, params, options);
    const rows = await all(paginated.sql, paginated.params);
    return Promise.all(rows.map(function (r) { return _sqlRowToDoc(r); }));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// findReservationsByStatus
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările cu un anumit status.
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
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    const built = _buildSqlWhere(tenantId, Object.assign({}, options, { status: status }));
    let sql = 'SELECT * FROM reservations WHERE ' + built.whereClause;
    sql += _buildSqlOrderBy(options.sort);

    const paginated = _applySqlPagination(sql, built.params, options);
    const rows = await all(paginated.sql, paginated.params);
    return Promise.all(rows.map(function (r) { return _sqlRowToDoc(r); }));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// findReservationsByDate
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările pentru o anumită dată.
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
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    const built = _buildSqlWhere(tenantId, Object.assign({}, options, { data: date }));
    let sql = 'SELECT * FROM reservations WHERE ' + built.whereClause;
    sql += _buildSqlOrderBy(options.sort);

    const paginated = _applySqlPagination(sql, built.params, options);
    const rows = await all(paginated.sql, paginated.params);
    return Promise.all(rows.map(function (r) { return _sqlRowToDoc(r); }));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// findReservationsByCheckInDate
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările cu o anumită dată de check-in.
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
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    let whereClause = 'tenant_id = ? AND tip = ? AND check_in = ?';
    const params = [tenantId, 'hotel', date];

    if (options.status) {
      whereClause += ' AND status = ?';
      params.push(options.status);
    }

    let sql = 'SELECT * FROM reservations WHERE ' + whereClause;
    sql += _buildSqlOrderBy(options.sort);

    const paginated = _applySqlPagination(sql, params, options);
    const rows = await all(paginated.sql, paginated.params);
    return Promise.all(rows.map(function (r) { return _sqlRowToDoc(r); }));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// findReservationsByCheckOutDate
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările cu o anumită dată de check-out.
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
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    let whereClause = 'tenant_id = ? AND tip = ? AND check_out = ?';
    const params = [tenantId, 'hotel', date];

    if (options.status) {
      whereClause += ' AND status = ?';
      params.push(options.status);
    }

    let sql = 'SELECT * FROM reservations WHERE ' + whereClause;
    sql += _buildSqlOrderBy(options.sort);

    const paginated = _applySqlPagination(sql, params, options);
    const rows = await all(paginated.sql, paginated.params);
    return Promise.all(rows.map(function (r) { return _sqlRowToDoc(r); }));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// findReservationsByGuestId
// ---------------------------------------------------------------------------

/**
 * Returnează istoricul rezervărilor pentru un oaspete (guestId).
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
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    let sql = 'SELECT * FROM reservations WHERE tenant_id = ? AND guest_id = ?';
    const params = [tenantId, guestId];
    sql += _buildSqlOrderBy(options.sort);

    const paginated = _applySqlPagination(sql, params, options);
    const rows = await all(paginated.sql, paginated.params);
    return Promise.all(rows.map(function (r) { return _sqlRowToDoc(r); }));
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la căutarea rezervărilor (SQL): ' + sqlErr.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// updateReservation
// ---------------------------------------------------------------------------

/**
 * Actualizează complet o rezervare.
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
  // NOTĂ: lista conține chei camelCase; le convertim la snake_case pentru SQL
  const allowedFields = [
    'tip', 'restaurantId', 'hotelId', 'data', 'ora',
    'numarPersoane', 'numeClient', 'emailClient', 'telefonClient',
    'observatii', 'masa', 'camera', 'checkIn', 'checkOut',
  ];

  const sqlSetClauses = [];
  const sqlParams = [];
  const now = nowISO();

  // Pentru validarea cross-field
  let finalCheckIn = existing.checkIn;
  let finalCheckOut = existing.checkOut;

  for (let i = 0; i < allowedFields.length; i++) {
    const field = allowedFields[i];
    if (field in updates) {
      const val = updates[field];
      // Obținem numele coloanei DB
      const dbCol = COL_JS_TO_DB[field] || field;

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
          sqlSetClauses.push(dbCol + ' = ?');
          sqlParams.push(val);
          break;

        case 'data':
          if (val && !isValidDate(val)) {
            throw new AppError('Data trebuie să fie în format YYYY-MM-DD.', 400, 'INVALID_DATE');
          }
          sqlSetClauses.push(dbCol + ' = ?');
          sqlParams.push(val);
          break;

        case 'ora':
          if (val && !isValidTime(val)) {
            throw new AppError('Ora trebuie să fie în format HH:mm.', 400, 'INVALID_TIME');
          }
          sqlSetClauses.push(dbCol + ' = ?');
          sqlParams.push(val);
          break;

        case 'numarPersoane':
          if (!Number.isInteger(val) || val < 1) {
            throw new AppError('Numărul de persoane trebuie să fie un întreg pozitiv.', 400, 'INVALID_GUEST_COUNT');
          }
          sqlSetClauses.push(dbCol + ' = ?');
          sqlParams.push(val);
          break;

        case 'numeClient':
          if (val && !isValidString(val, 2, 200)) {
            throw new AppError('Numele clientului trebuie să aibă 2-200 caractere.', 400, 'INVALID_CLIENT_NAME');
          }
          sqlSetClauses.push(dbCol + ' = ?');
          sqlParams.push(val.trim());
          break;

        case 'emailClient':
          if (val && !isValidEmail(val)) {
            throw new AppError('Email-ul clientului nu este valid.', 400, 'INVALID_EMAIL');
          }
          sqlSetClauses.push(dbCol + ' = ?');
          sqlParams.push(val.trim().toLowerCase());
          break;

        case 'telefonClient':
          if (val && !isValidPhone(val)) {
            throw new AppError('Telefonul clientului nu este valid.', 400, 'INVALID_PHONE');
          }
          sqlSetClauses.push(dbCol + ' = ?');
          sqlParams.push(val.trim());
          break;

        case 'observatii':
          sqlSetClauses.push(dbCol + ' = ?');
          sqlParams.push(typeof val === 'string' ? val.trim() : '');
          break;

        case 'masa':
          if (val !== null && val !== undefined && (!Number.isInteger(val) || val < 1)) {
            throw new AppError('Numărul mesei trebuie să fie un întreg pozitiv.', 400, 'INVALID_TABLE_NUMBER');
          }
          sqlSetClauses.push(dbCol + ' = ?');
          sqlParams.push(val !== null && val !== undefined ? val : null);
          break;

        case 'camera':
          sqlSetClauses.push(dbCol + ' = ?');
          sqlParams.push(val ? val.trim() : null);
          break;

        case 'checkIn':
          if (val && !isValidDate(val)) {
            throw new AppError('Data de check-in nu este validă (YYYY-MM-DD).', 400, 'INVALID_CHECKIN_DATE');
          }
          finalCheckIn = val || null;
          sqlSetClauses.push(dbCol + ' = ?');
          sqlParams.push(finalCheckIn);
          break;

        case 'checkOut':
          if (val && !isValidDate(val)) {
            throw new AppError('Data de check-out nu este validă (YYYY-MM-DD).', 400, 'INVALID_CHECKOUT_DATE');
          }
          finalCheckOut = val || null;
          sqlSetClauses.push(dbCol + ' = ?');
          sqlParams.push(finalCheckOut);
          break;

        case 'restaurantId':
          sqlSetClauses.push(dbCol + ' = ?');
          sqlParams.push(val || null);
          break;

        case 'hotelId':
          sqlSetClauses.push(dbCol + ' = ?');
          sqlParams.push(val || null);
          break;

        default:
          break;
      }
    }
  }

  // Validare cross-field: checkOut > checkIn
  if (finalCheckIn && finalCheckOut && new Date(finalCheckOut + 'T00:00:00.000Z') <= new Date(finalCheckIn + 'T00:00:00.000Z')) {
    throw new AppError('Data de check-out trebuie să fie după data de check-in.', 400, 'CHECKOUT_BEFORE_CHECKIN');
  }

  sqlSetClauses.push('updated_at = ?');
  sqlParams.push(now);

  // ---- SQLite ----
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    const numericId = parseInt(id, 10);
    if (!isNaN(numericId)) {
      sqlParams.push(numericId);
      sqlParams.push(tenantId);
      const result = await run(
        'UPDATE reservations SET ' + sqlSetClauses.join(', ') + ' WHERE id = ? AND tenant_id = ?',
        sqlParams
      );
      if (result.changes === 0) {
        return null;
      }
      const updatedRow = await get('SELECT * FROM reservations WHERE id = ?', [numericId]);
      return await _sqlRowToDoc(updatedRow);
    } else {
      sqlParams.push(String(id));
      sqlParams.push(tenantId);
      const result = await run(
        'UPDATE reservations SET ' + sqlSetClauses.join(', ') + ' WHERE CAST(id AS TEXT) = ? AND tenant_id = ?',
        sqlParams
      );
      if (result.changes === 0) {
        return null;
      }
      const updatedRow = await get('SELECT * FROM reservations WHERE CAST(id AS TEXT) = ?', [String(id)]);
      return await _sqlRowToDoc(updatedRow);
    }
  } catch (sqlErr) {
    throw new AppError(
      'Eroare la actualizarea rezervării (SQL): ' + sqlErr.message,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// updateReservationStatus
// ---------------------------------------------------------------------------

/**
 * Actualizează statusul unei rezervări.
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
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    const numericId = parseInt(id, 10);
    let result;
    if (!isNaN(numericId)) {
      result = await run(
        'UPDATE reservations SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
        [status, now, numericId, tenantId]
      );
    } else {
      result = await run(
        'UPDATE reservations SET status = ?, updated_at = ? WHERE CAST(id AS TEXT) = ? AND tenant_id = ?',
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

// ---------------------------------------------------------------------------
// deleteReservation
// ---------------------------------------------------------------------------

/**
 * Șterge o rezervare.
 */
async function deleteReservation(id, tenantId) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new AppError('ID-ul rezervării este invalid.', 400, 'INVALID_RESERVATION_ID');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  // ---- SQLite ----
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    const numericId = parseInt(id, 10);
    let result;
    if (!isNaN(numericId)) {
      result = await run(
        'DELETE FROM reservations WHERE id = ? AND tenant_id = ?',
        [numericId, tenantId]
      );
    } else {
      result = await run(
        'DELETE FROM reservations WHERE CAST(id AS TEXT) = ? AND tenant_id = ?',
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

// ---------------------------------------------------------------------------
// checkInReservation
// ---------------------------------------------------------------------------

/**
 * Efectuează check-in pentru o rezervare de tip hotel.
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
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    const numericId = parseInt(id, 10);
    if (!isNaN(numericId)) {
      await run(
        'UPDATE reservations SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
        ['check-in', now, numericId, tenantId]
      );
    } else {
      await run(
        'UPDATE reservations SET status = ?, updated_at = ? WHERE CAST(id AS TEXT) = ? AND tenant_id = ?',
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

// ---------------------------------------------------------------------------
// checkOutReservation
// ---------------------------------------------------------------------------

/**
 * Efectuează check-out pentru o rezervare de tip hotel.
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
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    const numericId = parseInt(id, 10);
    if (!isNaN(numericId)) {
      await run(
        'UPDATE reservations SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
        ['check-out', now, numericId, tenantId]
      );
    } else {
      await run(
        'UPDATE reservations SET status = ?, updated_at = ? WHERE CAST(id AS TEXT) = ? AND tenant_id = ?',
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

// ---------------------------------------------------------------------------
// updateReservationBilling
// ---------------------------------------------------------------------------

/**
 * Actualizează informațiile de facturare ale unei rezervări.
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
  if (!(await _isSqlAvailable())) {
    throw new AppError('Baza de date nu este disponibilă.', 500, 'DB_UNAVAILABLE');
  }

  try {
    const numericId = parseInt(id, 10);
    const setClauses = ['status_facturare = ?', 'updated_at = ?'];
    const params = [statusFacturare, now];

    if (sumaTotala !== undefined && sumaTotala !== null) {
      setClauses.push('total_price = ?');
      params.push(sumaTotala);
    }
    if (finalMoneda !== undefined) {
      setClauses.push('moneda = ?');
      params.push(finalMoneda);
    }

    if (!isNaN(numericId)) {
      params.push(numericId);
      params.push(tenantId);
      await run(
        'UPDATE reservations SET ' + setClauses.join(', ') + ' WHERE id = ? AND tenant_id = ?',
        params
      );
    } else {
      params.push(String(id));
      params.push(tenantId);
      await run(
        'UPDATE reservations SET ' + setClauses.join(', ') + ' WHERE CAST(id AS TEXT) = ? AND tenant_id = ?',
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
};