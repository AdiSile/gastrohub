'use strict';

// ---------------------------------------------------------------------------
// Model Reservation – GastroHub (NeDB via config/db)
// ---------------------------------------------------------------------------
// Gestionează rezervările (restaurant + hotel) utilizând colecția NeDB
// `reservations` exportată de config/db.js.
//
// Structura unui document:
//   _id              {string}  – generat automat de NeDB
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

const { reservations } = require('../config/db');

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
// Helpers – promisificare operații NeDB
// ---------------------------------------------------------------------------

/**
 * Execută o operație NeDB și returnează o Promisiune.
 *
 * @param {Function} fn - funcția NeDB (find, findOne, insert, update, remove, count)
 * @param {...*} args    - argumentele specifice operației
 * @returns {Promise}
 */
function nedbPromise(fn, ...args) {
  return new Promise((resolve, reject) => {
    // Adăugăm callback-ul la finalul listei de argumente
    fn.call(reservations, ...args, (err, result) => {
      if (err) {
        return reject(err);
      }
      resolve(result);
    });
  });
}

/**
 * Execută `count` pe colecția de rezervări.
 */
function nedbCount(query) {
  return new Promise((resolve, reject) => {
    reservations.count(query, (err, n) => {
      if (err) return reject(err);
      resolve(n);
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers – validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un șir are lungimea între min și max.
 */
function isValidString(val, min = 1, max = 255) {
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
  const [h, m] = timeStr.split(':').map(Number);
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
// Helpers – construire query + sortare/paginare
// ---------------------------------------------------------------------------

/**
 * Construiește query-ul de bază pentru NeDB pe baza tenantId-ului și a
 * opțiunilor primite.
 *
 * @param {string} tenantId
 * @param {Object} [options={}]
 * @param {string} [options.tip]
 * @param {string} [options.status]
 * @param {string} [options.data]
 * @param {string} [options.restaurantId]
 * @param {string} [options.hotelId]
 * @param {string} [options.camera]
 * @param {number} [options.masa]
 * @returns {Object} query NeDB
 */
function buildQuery(tenantId, options = {}) {
  const query = { tenantId };

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
 *
 * @param {string} [sort]
 * @returns {Object|undefined}
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
 * Aplică sort, skip, limit pe un cursor NeDB și returnează o Promisiune
 * care rezolvă array-ul de documente.
 *
 * @param {Object} query
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
function executeQuery(query, options = {}) {
  return new Promise((resolve, reject) => {
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

    cursor.exec((err, docs) => {
      if (err) return reject(err);
      resolve(docs);
    });
  });
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
    throw new Error('Datele rezervării sunt invalide.');
  }

  const {
    tenantId,
    tip,
    restaurantId = null,
    hotelId = null,
    data: dataRez,
    ora = null,
    numarPersoane,
    numeClient,
    emailClient,
    telefonClient,
    observatii = '',
    masa = null,
    camera = null,
    checkIn = null,
    checkOut = null,
    guestId = null,
  } = data;

  // --- validări obligatorii ---
  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este obligatoriu.');
  }

  if (!tip || !VALID_RESERVATION_TYPES.includes(tip)) {
    throw new Error(`Tipul rezervării trebuie să fie unul dintre: ${VALID_RESERVATION_TYPES.join(', ')}.`);
  }

  if (tip === 'restaurant' && (!restaurantId || !isValidString(restaurantId))) {
    throw new Error('ID-ul restaurantului este obligatoriu pentru rezervările de tip restaurant.');
  }

  if (tip === 'hotel' && (!hotelId || !isValidString(hotelId))) {
    throw new Error('ID-ul hotelului este obligatoriu pentru rezervările de tip hotel.');
  }

  if (!dataRez || !isValidDate(dataRez)) {
    throw new Error('Data rezervării este obligatorie (YYYY-MM-DD).');
  }

  if (ora !== null && ora !== undefined && ora !== '' && !isValidTime(ora)) {
    throw new Error('Ora trebuie să fie în format HH:mm.');
  }

  if (!Number.isInteger(numarPersoane) || numarPersoane < 1) {
    throw new Error('Numărul de persoane trebuie să fie un întreg pozitiv.');
  }

  if (!numeClient || !isValidString(numeClient, 2, 200)) {
    throw new Error('Numele clientului este obligatoriu (2-200 caractere).');
  }

  if (!emailClient || !isValidEmail(emailClient)) {
    throw new Error('Email-ul clientului nu este valid.');
  }

  if (!telefonClient || !isValidPhone(telefonClient)) {
    throw new Error('Telefonul clientului nu este valid.');
  }

  // --- validări opționale ---
  if (checkIn && !isValidDate(checkIn)) {
    throw new Error('Data de check-in nu este validă (YYYY-MM-DD).');
  }

  if (checkOut && !isValidDate(checkOut)) {
    throw new Error('Data de check-out nu este validă (YYYY-MM-DD).');
  }

  if (checkIn && checkOut && new Date(checkOut) <= new Date(checkIn)) {
    throw new Error('Data de check-out trebuie să fie după data de check-in.');
  }

  if (tip === 'restaurant' && masa !== null && (!Number.isInteger(masa) || masa < 1)) {
    throw new Error('Numărul mesei trebuie să fie un întreg pozitiv.');
  }

  // --- construire document ---
  const now = nowISO();
  const doc = {
    tenantId,
    tip,
    restaurantId: tip === 'restaurant' ? restaurantId : null,
    hotelId: tip === 'hotel' ? hotelId : null,
    data: dataRez,
    ora: ora || null,
    numarPersoane,
    numeClient: numeClient.trim(),
    emailClient: emailClient.trim().toLowerCase(),
    telefonClient: telefonClient.trim(),
    observatii: typeof observatii === 'string' ? observatii.trim() : '',
    masa: tip === 'restaurant' && masa !== null ? masa : null,
    camera: tip === 'hotel' && camera ? camera.trim() : null,
    checkIn: tip === 'hotel' && checkIn ? checkIn : null,
    checkOut: tip === 'hotel' && checkOut ? checkOut : null,
    status: 'confirmată',
    statusFacturare: 'nefacturat',
    sumaTotala: 0,
    moneda: 'RON',
    guestId: guestId || null,
    createdAt: now,
    updatedAt: now,
  };

  const newDoc = await nedbPromise(reservations.insert, doc);
  return newDoc;
}

// ---------------------------------------------------------------------------
// findReservationById
// ---------------------------------------------------------------------------

/**
 * Găsește o rezervare după ID (_id) și tenantId.
 *
 * @param {string} id       - ID-ul documentului NeDB
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object|null>} Documentul sau null
 */
async function findReservationById(id, tenantId) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('ID-ul rezervării este invalid.');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  const doc = await nedbPromise(reservations.findOne, { _id: id, tenantId });
  return doc || null;
}

// ---------------------------------------------------------------------------
// findReservationsByRestaurant
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările unui restaurant, cu opțiuni de filtrare.
 *
 * @param {string} restaurantId
 * @param {string} tenantId
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
async function findReservationsByRestaurant(restaurantId, tenantId, options = {}) {
  if (!restaurantId || !isValidString(restaurantId)) {
    throw new Error('ID-ul restaurantului este invalid.');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  const query = buildQuery(tenantId, {
    ...options,
    tip: 'restaurant',
    restaurantId,
  });

  // Dacă se trimite `masa` în options
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
 *
 * @param {string} hotelId
 * @param {string} tenantId
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
async function findReservationsByHotel(hotelId, tenantId, options = {}) {
  if (!hotelId || !isValidString(hotelId)) {
    throw new Error('ID-ul hotelului este invalid.');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  const query = buildQuery(tenantId, {
    ...options,
    tip: 'hotel',
    hotelId,
  });

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
 *
 * @param {string} tenantId
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
async function findReservationsByTenant(tenantId, options = {}) {
  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  const query = buildQuery(tenantId, options);
  return executeQuery(query, options);
}

// ---------------------------------------------------------------------------
// findReservationsByPerson
// ---------------------------------------------------------------------------

/**
 * Caută rezervări după nume, email sau telefon ale clientului.
 *
 * @param {string} searchTerm - termenul de căutare
 * @param {string} tenantId
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
async function findReservationsByPerson(searchTerm, tenantId, options = {}) {
  if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
    throw new Error('Termenul de căutare este obligatoriu.');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedTerm, 'i');

  const query = {
    tenantId,
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
 *
 * @param {string} status
 * @param {string} tenantId
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
async function findReservationsByStatus(status, tenantId, options = {}) {
  if (!status || !VALID_RESERVATION_STATUSES.includes(status)) {
    throw new Error(`Statusul "${status}" nu este valid. Permise: ${VALID_RESERVATION_STATUSES.join(', ')}.`);
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  const query = buildQuery(tenantId, { ...options, status });
  return executeQuery(query, options);
}

// ---------------------------------------------------------------------------
// findReservationsByDate
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările pentru o anumită dată.
 *
 * @param {string} date    - Data YYYY-MM-DD
 * @param {string} tenantId
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
async function findReservationsByDate(date, tenantId, options = {}) {
  if (!date || !isValidDate(date)) {
    throw new Error('Data este obligatorie și trebuie să fie în format YYYY-MM-DD.');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  const query = buildQuery(tenantId, { ...options, data: date });
  return executeQuery(query, options);
}

// ---------------------------------------------------------------------------
// findReservationsByCheckInDate
// ---------------------------------------------------------------------------

/**
 * Returnează rezervările cu o anumită dată de check-in.
 *
 * @param {string} date    - Data YYYY-MM-DD
 * @param {string} tenantId
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
async function findReservationsByCheckInDate(date, tenantId, options = {}) {
  if (!date || !isValidDate(date)) {
    throw new Error('Data de check-in este obligatorie (YYYY-MM-DD).');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  const query = {
    tenantId,
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
 *
 * @param {string} date    - Data YYYY-MM-DD
 * @param {string} tenantId
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
async function findReservationsByCheckOutDate(date, tenantId, options = {}) {
  if (!date || !isValidDate(date)) {
    throw new Error('Data de check-out este obligatorie (YYYY-MM-DD).');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  const query = {
    tenantId,
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
 *
 * @param {string} guestId
 * @param {string} tenantId
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
async function findReservationsByGuestId(guestId, tenantId, options = {}) {
  if (!guestId || typeof guestId !== 'string' || guestId.trim().length === 0) {
    throw new Error('ID-ul oaspetelui este obligatoriu.');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  const query = { tenantId, guestId };
  return executeQuery(query, options);
}

// ---------------------------------------------------------------------------
// updateReservation
// ---------------------------------------------------------------------------

/**
 * Actualizează complet o rezervare.
 *
 * @param {string} id       - _id-ul documentului
 * @param {string} tenantId
 * @param {Object} updates  - Câmpurile de actualizat
 * @returns {Promise<Object|null>} Documentul actualizat sau null
 */
async function updateReservation(id, tenantId, updates) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('ID-ul rezervării este invalid.');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  if (!updates || typeof updates !== 'object') {
    throw new Error('Datele de actualizare sunt invalide.');
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

  const setFields = { updatedAt: nowISO() };

  for (const field of allowedFields) {
    if (field in updates) {
      const val = updates[field];

      // Validări per câmp
      switch (field) {
        case 'tip':
          if (val && !VALID_RESERVATION_TYPES.includes(val)) {
            throw new Error(`Tipul trebuie să fie unul dintre: ${VALID_RESERVATION_TYPES.join(', ')}.`);
          }
          setFields.tip = val;
          break;

        case 'data':
          if (val && !isValidDate(val)) {
            throw new Error('Data trebuie să fie în format YYYY-MM-DD.');
          }
          setFields.data = val;
          break;

        case 'ora':
          if (val && !isValidTime(val)) {
            throw new Error('Ora trebuie să fie în format HH:mm.');
          }
          setFields.ora = val;
          break;

        case 'numarPersoane':
          if (!Number.isInteger(val) || val < 1) {
            throw new Error('Numărul de persoane trebuie să fie un întreg pozitiv.');
          }
          setFields.numarPersoane = val;
          break;

        case 'numeClient':
          if (val && !isValidString(val, 2, 200)) {
            throw new Error('Numele clientului trebuie să aibă 2-200 caractere.');
          }
          setFields.numeClient = val.trim();
          break;

        case 'emailClient':
          if (val && !isValidEmail(val)) {
            throw new Error('Email-ul clientului nu este valid.');
          }
          setFields.emailClient = val.trim().toLowerCase();
          break;

        case 'telefonClient':
          if (val && !isValidPhone(val)) {
            throw new Error('Telefonul clientului nu este valid.');
          }
          setFields.telefonClient = val.trim();
          break;

        case 'observatii':
          setFields.observatii = typeof val === 'string' ? val.trim() : '';
          break;

        case 'masa':
          if (val !== null && (!Number.isInteger(val) || val < 1)) {
            throw new Error('Numărul mesei trebuie să fie un întreg pozitiv.');
          }
          setFields.masa = val;
          break;

        case 'camera':
          setFields.camera = val ? val.trim() : null;
          break;

        case 'checkIn':
          if (val && !isValidDate(val)) {
            throw new Error('Data de check-in nu este validă (YYYY-MM-DD).');
          }
          setFields.checkIn = val || null;
          break;

        case 'checkOut':
          if (val && !isValidDate(val)) {
            throw new Error('Data de check-out nu este validă (YYYY-MM-DD).');
          }
          setFields.checkOut = val || null;
          break;

        case 'restaurantId':
          setFields.restaurantId = val || null;
          break;

        case 'hotelId':
          setFields.hotelId = val || null;
          break;

        default:
          setFields[field] = val;
      }
    }
  }

  // Validare cross-field: checkOut > checkIn
  const finalCheckIn = setFields.checkIn !== undefined ? setFields.checkIn : existing.checkIn;
  const finalCheckOut = setFields.checkOut !== undefined ? setFields.checkOut : existing.checkOut;
  if (finalCheckIn && finalCheckOut && new Date(finalCheckOut) <= new Date(finalCheckIn)) {
    throw new Error('Data de check-out trebuie să fie după data de check-in.');
  }

  // Aplicăm update-ul
  const numReplaced = await nedbPromise(reservations.update, { _id: id, tenantId }, { $set: setFields }, {});

  if (numReplaced === 0) {
    return null;
  }

  // Returnăm documentul actualizat
  return findReservationById(id, tenantId);
}

// ---------------------------------------------------------------------------
// updateReservationStatus
// ---------------------------------------------------------------------------

/**
 * Actualizează statusul unei rezervări.
 *
 * @param {string} id       - _id
 * @param {string} tenantId
 * @param {string} status   - noul status
 * @returns {Promise<Object|null>} Documentul actualizat sau null
 */
async function updateReservationStatus(id, tenantId, status) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('ID-ul rezervării este invalid.');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  if (!status || !VALID_RESERVATION_STATUSES.includes(status)) {
    throw new Error(`Statusul "${status}" nu este valid. Permise: ${VALID_RESERVATION_STATUSES.join(', ')}.`);
  }

  const existing = await findReservationById(id, tenantId);
  if (!existing) {
    return null;
  }

  // Reguli de tranziție
  if (existing.status === 'anulată' && status !== 'anulată') {
    throw new Error('O rezervare anulată nu mai poate fi reactivată.');
  }

  if ((existing.status === 'finalizată' || existing.status === 'check-out') &&
      status === 'anulată') {
    throw new Error('Rezervările finalizate nu pot fi anulate.');
  }

  await nedbPromise(reservations.update, { _id: id, tenantId }, { $set: { status, updatedAt: nowISO() } }, {});

  return findReservationById(id, tenantId);
}

// ---------------------------------------------------------------------------
// deleteReservation
// ---------------------------------------------------------------------------

/**
 * Șterge o rezervare.
 *
 * @param {string} id
 * @param {string} tenantId
 * @returns {Promise<boolean>} true dacă a fost ștearsă, false dacă nu a fost găsită
 */
async function deleteReservation(id, tenantId) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('ID-ul rezervării este invalid.');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  const numRemoved = await nedbPromise(reservations.remove, { _id: id, tenantId }, {});
  return numRemoved > 0;
}

// ---------------------------------------------------------------------------
// checkInReservation
// ---------------------------------------------------------------------------

/**
 * Efectuează check-in pentru o rezervare de tip hotel.
 *
 * @param {string} id
 * @param {string} tenantId
 * @returns {Promise<Object|null>} Documentul actualizat sau null
 */
async function checkInReservation(id, tenantId) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('ID-ul rezervării este invalid.');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  const existing = await findReservationById(id, tenantId);
  if (!existing) {
    return null;
  }

  if (existing.tip !== 'hotel') {
    throw new Error('Check-in-ul este disponibil doar pentru rezervările de tip hotel.');
  }

  if (existing.status === 'anulată') {
    throw new Error('Nu se poate face check-in pentru o rezervare anulată.');
  }

  if (existing.status === 'check-in') {
    throw new Error('Check-in-ul a fost deja efectuat pentru această rezervare.');
  }

  if (existing.status === 'check-out' || existing.status === 'finalizată') {
    throw new Error('Nu se poate face check-in pentru o rezervare finalizată.');
  }

  await nedbPromise(reservations.update, { _id: id, tenantId }, { $set: { status: 'check-in', updatedAt: nowISO() } }, {});

  return findReservationById(id, tenantId);
}

// ---------------------------------------------------------------------------
// checkOutReservation
// ---------------------------------------------------------------------------

/**
 * Efectuează check-out pentru o rezervare de tip hotel.
 *
 * @param {string} id
 * @param {string} tenantId
 * @returns {Promise<Object|null>} Documentul actualizat sau null
 */
async function checkOutReservation(id, tenantId) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('ID-ul rezervării este invalid.');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  const existing = await findReservationById(id, tenantId);
  if (!existing) {
    return null;
  }

  if (existing.tip !== 'hotel') {
    throw new Error('Check-out-ul este disponibil doar pentru rezervările de tip hotel.');
  }

  if (existing.status === 'anulată') {
    throw new Error('Nu se poate face check-out pentru o rezervare anulată.');
  }

  if (existing.status === 'check-out' || existing.status === 'finalizată') {
    throw new Error('Check-out-ul a fost deja efectuat pentru această rezervare.');
  }

  if (existing.status !== 'check-in' && existing.status !== 'confirmată' && existing.status !== 'în curs') {
    throw new Error(`Nu se poate face check-out dintr-un status "${existing.status}".`);
  }

  await nedbPromise(reservations.update, { _id: id, tenantId }, { $set: { status: 'check-out', updatedAt: nowISO() } }, {});

  return findReservationById(id, tenantId);
}

// ---------------------------------------------------------------------------
// updateReservationBilling
// ---------------------------------------------------------------------------

/**
 * Actualizează informațiile de facturare ale unei rezervări.
 *
 * @param {string} id
 * @param {string} tenantId
 * @param {Object} billingData
 * @param {string} billingData.statusFacturare - noul status de facturare
 * @param {number} [billingData.sumaTotala]     - suma totală
 * @param {string} [billingData.moneda]         - cod monedă (3 caractere)
 * @returns {Promise<Object|null>} Documentul actualizat sau null
 */
async function updateReservationBilling(id, tenantId, billingData) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('ID-ul rezervării este invalid.');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
  }

  if (!billingData || typeof billingData !== 'object') {
    throw new Error('Datele de facturare sunt invalide.');
  }

  const { statusFacturare, sumaTotala, moneda } = billingData;

  if (!statusFacturare || !VALID_BILLING_STATUSES.includes(statusFacturare)) {
    throw new Error(`Statusul de facturare trebuie să fie unul dintre: ${VALID_BILLING_STATUSES.join(', ')}.`);
  }

  const existing = await findReservationById(id, tenantId);
  if (!existing) {
    return null;
  }

  const setFields = {
    statusFacturare,
    updatedAt: nowISO(),
  };

  if (sumaTotala !== undefined && sumaTotala !== null) {
    if (typeof sumaTotala !== 'number' || sumaTotala < 0) {
      throw new Error('Suma totală trebuie să fie un număr pozitiv.');
    }
    setFields.sumaTotala = sumaTotala;
  }

  if (moneda !== undefined && moneda !== null) {
    if (typeof moneda !== 'string' || moneda.trim().length !== 3) {
      throw new Error('Moneda trebuie să fie un cod de 3 caractere (ex: RON, EUR).');
    }
    setFields.moneda = moneda.trim().toUpperCase();
  }

  await nedbPromise(reservations.update, { _id: id, tenantId }, { $set: setFields }, {});

  return findReservationById(id, tenantId);
}

// ---------------------------------------------------------------------------
// getReservationBillingSummary
// ---------------------------------------------------------------------------

/**
 * Obține sumarul de facturare pentru o rezervare.
 *
 * @param {string} id
 * @param {string} tenantId
 * @returns {Promise<Object|null>} Sumarul de facturare sau null
 */
async function getReservationBillingSummary(id, tenantId) {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('ID-ul rezervării este invalid.');
  }

  if (!tenantId || !isValidString(tenantId)) {
    throw new Error('ID-ul tenant-ului este invalid.');
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
    numNopti,
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
 *
 * @param {Object} reservation
 * @returns {number}
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
  VALID_RESERVATION_TYPES,
  VALID_RESERVATION_STATUSES,
  VALID_BILLING_STATUSES,

  // Funcții CRUD + căutare
  createReservation,
  findReservationById,
  findReservationsByRestaurant,
  findReservationsByHotel,
  findReservationsByTenant,
  findReservationsByPerson,
  findReservationsByStatus,
  findReservationsByDate,
  updateReservation,
  updateReservationStatus,
  deleteReservation,

  // Funcții specifice guest
  findReservationsByGuestId,

  // Funcții hotel
  findReservationsByCheckInDate,
  findReservationsByCheckOutDate,
  checkInReservation,
  checkOutReservation,

  // Facturare
  updateReservationBilling,
  getReservationBillingSummary,
};