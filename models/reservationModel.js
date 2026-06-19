'use strict';

// ---------------------------------------------------------------------------
// Model Reservation – GastroHub (SQLite / better-sqlite3 via config/db)
// ---------------------------------------------------------------------------
// Gestionează rezervările hoteliere: creare, căutare după ID, hotel, guest,
// actualizare status și anulare.
//
// Presupune existența tabelei:
//   CREATE TABLE IF NOT EXISTS reservations (
//     id          INTEGER PRIMARY KEY AUTOINCREMENT,
//     hotelId     TEXT    NOT NULL,
//     guestId     TEXT,
//     guestName   TEXT    NOT NULL,
//     guestPhone  TEXT    DEFAULT '',
//     guestEmail  TEXT    DEFAULT '',
//     checkIn     TEXT    NOT NULL,   -- YYYY-MM-DD
//     checkOut    TEXT    NOT NULL,   -- YYYY-MM-DD
//     roomId      TEXT,
//     numGuests   INTEGER DEFAULT 1,
//     status      TEXT    DEFAULT 'confirmată',
//     notes       TEXT    DEFAULT '',
//     createdAt   TEXT    DEFAULT (datetime('now')),
//     updatedAt   TEXT    DEFAULT (datetime('now'))
//   );
// ---------------------------------------------------------------------------

const db = require('../config/db');

// ---------------------------------------------------------------------------
// Statusuri valide
// ---------------------------------------------------------------------------
const VALID_STATUSES = [
  'confirmată',
  'în așteptare',
  'anulată',
  'finalizată',
  'neprezentat',
  'în curs',
  'check-in',
  'check-out',
];

// ---------------------------------------------------------------------------
// Helpers
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
 * Verifică dacă un status este permis.
 */
function isValidStatus(status) {
  return VALID_STATUSES.includes(status);
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

// ---------------------------------------------------------------------------
// createReservation
// ---------------------------------------------------------------------------

/**
 * Creează o rezervare hotelieră nouă.
 *
 * @param {Object} data
 * @param {string} data.hotelId      - ID-ul hotelului (obligatoriu)
 * @param {string} data.guestName    - Numele persoanei (obligatoriu)
 * @param {string} data.checkIn      - Data check-in, YYYY-MM-DD (obligatoriu)
 * @param {string} data.checkOut     - Data check-out, YYYY-MM-DD (obligatoriu)
 * @param {string} [data.guestId]    - ID-ul guest-ului
 * @param {string} [data.guestPhone] - Telefon
 * @param {string} [data.guestEmail] - Email
 * @param {string} [data.roomId]     - ID-ul camerei
 * @param {number} [data.numGuests=1] - Număr persoane
 * @param {string} [data.status='confirmată'] - Status
 * @param {string} [data.notes='']   - Note
 * @returns {Object} Rezervarea creată (cu id)
 */
function createReservation(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Datele rezervării sunt invalide.');
  }

  const {
    hotelId,
    guestId = null,
    guestName,
    guestPhone = '',
    guestEmail = '',
    checkIn,
    checkOut,
    roomId = null,
    numGuests = 1,
    status = 'confirmată',
    notes = '',
  } = data;

  // --- validări ---
  if (!hotelId || !isValidString(hotelId, 1, 100)) {
    throw new Error('ID-ul hotelului este obligatoriu.');
  }

  if (!guestName || !isValidString(guestName, 2, 200)) {
    throw new Error('Numele persoanei este obligatoriu (2-200 caractere).');
  }

  if (!checkIn || !isValidDate(checkIn)) {
    throw new Error('Data de check-in este obligatorie (YYYY-MM-DD).');
  }

  if (!checkOut || !isValidDate(checkOut)) {
    throw new Error('Data de check-out este obligatorie (YYYY-MM-DD).');
  }

  if (new Date(checkOut) <= new Date(checkIn)) {
    throw new Error('Data de check-out trebuie să fie după data de check-in.');
  }

  if (guestPhone && !isValidPhone(guestPhone)) {
    throw new Error('Numărul de telefon nu este valid.');
  }

  if (guestEmail && !isValidEmail(guestEmail)) {
    throw new Error('Adresa de email nu este validă.');
  }

  if (!Number.isInteger(numGuests) || numGuests < 1 || numGuests > 999) {
    throw new Error('Numărul de persoane trebuie să fie un întreg între 1 și 999.');
  }

  if (!isValidStatus(status)) {
    throw new Error(`Statusul "${status}" nu este valid. Permise: ${VALID_STATUSES.join(', ')}.`);
  }

  const finalNotes = typeof notes === 'string' ? notes : '';

  // --- inserare ---
  const sql = `
    INSERT INTO reservations
      (hotelId, guestId, guestName, guestPhone, guestEmail,
       checkIn, checkOut, roomId, numGuests, status, notes)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const info = db.run(sql, [
    hotelId,
    guestId,
    guestName.trim(),
    guestPhone.trim(),
    guestEmail.trim().toLowerCase(),
    checkIn,
    checkOut,
    roomId,
    numGuests,
    status,
    finalNotes,
  ]);

  // returnăm documentul complet
  return getReservationById(info.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// getReservationById
// ---------------------------------------------------------------------------

/**
 * Găsește o rezervare după ID.
 *
 * @param {number} id
 * @returns {Object|undefined} Rezervarea sau undefined
 */
function getReservationById(id) {
  if (id === undefined || id === null) {
    throw new Error('ID-ul rezervării este invalid.');
  }

  const sql = `SELECT * FROM reservations WHERE id = ?`;
  return db.get(sql, [id]);
}

// ---------------------------------------------------------------------------
// getReservationsByHotel
// ---------------------------------------------------------------------------

/**
 * Returnează toate rezervările unui hotel, ordonate după checkIn.
 *
 * @param {string} hotelId
 * @returns {Array<Object>}
 */
function getReservationsByHotel(hotelId) {
  if (!hotelId || !isValidString(hotelId)) {
    throw new Error('ID-ul hotelului este invalid.');
  }

  const sql = `
    SELECT * FROM reservations
    WHERE hotelId = ?
    ORDER BY checkIn ASC, id DESC
  `;
  return db.all(sql, [hotelId]);
}

// ---------------------------------------------------------------------------
// getReservationsByGuest
// ---------------------------------------------------------------------------

/**
 * Caută rezervări după nume, telefon sau email ale guest-ului.
 *
 * @param {string} guestInfo - Termen de căutare
 * @returns {Array<Object>}
 */
function getReservationsByGuest(guestInfo) {
  if (!guestInfo || typeof guestInfo !== 'string' || guestInfo.trim().length === 0) {
    throw new Error('Informațiile despre guest sunt invalide.');
  }

  const term = `%${guestInfo.trim()}%`;

  const sql = `
    SELECT * FROM reservations
    WHERE guestName  LIKE ?
       OR guestPhone LIKE ?
       OR guestEmail LIKE ?
    ORDER BY checkIn DESC, id DESC
  `;

  return db.all(sql, [term, term, term]);
}

// ---------------------------------------------------------------------------
// updateReservationStatus
// ---------------------------------------------------------------------------

/**
 * Actualizează statusul unei rezervări.
 *
 * @param {number} id     - ID-ul rezervării
 * @param {string} status - Noul status
 * @returns {Object|undefined} Rezervarea actualizată sau undefined dacă nu există
 */
function updateReservationStatus(id, status) {
  if (id === undefined || id === null) {
    throw new Error('ID-ul rezervării este invalid.');
  }

  if (!status || !isValidStatus(status)) {
    throw new Error(`Statusul "${status}" nu este valid. Permise: ${VALID_STATUSES.join(', ')}.`);
  }

  const existing = getReservationById(id);
  if (!existing) {
    return undefined;
  }

  const sql = `
    UPDATE reservations
    SET status    = ?,
        updatedAt = datetime('now')
    WHERE id = ?
  `;

  db.run(sql, [status, id]);

  return getReservationById(id);
}

// ---------------------------------------------------------------------------
// cancelReservation
// ---------------------------------------------------------------------------

/**
 * Anulează o rezervare (setează status = 'anulată').
 *
 * @param {number} id - ID-ul rezervării
 * @returns {Object|undefined} Rezervarea actualizată sau undefined
 * @throws {Error} Dacă rezervarea este deja anulată sau finalizată
 */
function cancelReservation(id) {
  if (id === undefined || id === null) {
    throw new Error('ID-ul rezervării este invalid.');
  }

  const existing = getReservationById(id);
  if (!existing) {
    return undefined;
  }

  if (existing.status === 'anulată') {
    throw new Error('Rezervarea este deja anulată.');
  }

  if (existing.status === 'finalizată' || existing.status === 'check-out') {
    throw new Error('Rezervările finalizate nu pot fi anulate.');
  }

  const sql = `
    UPDATE reservations
    SET status    = 'anulată',
        updatedAt = datetime('now')
    WHERE id = ?
  `;

  db.run(sql, [id]);

  return getReservationById(id);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = {
  createReservation,
  getReservationById,
  getReservationsByHotel,
  getReservationsByGuest,
  updateReservationStatus,
  cancelReservation,
  VALID_STATUSES,
};