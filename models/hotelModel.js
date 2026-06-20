'use strict';

// ---------------------------------------------------------------------------
// Model Hotel - GastroHub
// Contine operatii CRUD pentru hoteluri, camere si rezervari.
// Foloseste SQLite via sql.js (getDb() din config/db).
// Toate operatiile sunt Promise-based (async/await) cu interogari SQL parametrizate.
// Utilizeaza direct db.run() / db.exec() dupa await getDb().
// ---------------------------------------------------------------------------

const { getDb } = require('../config/db');

// ---------------------------------------------------------------------------
// Constante si liste valide
// ---------------------------------------------------------------------------

const VALID_ROOM_TYPES = [
  'single', 'double', 'twin', 'triple', 'suite',
  'junior suite', 'penthouse', 'dormitor', 'apartament',
  'family room', 'cabana', 'vila',
];

const VALID_ROOM_STATUSES = [
  'available', 'occupied', 'cleaning', 'maintenance', 'reserved', 'out of order',
];

const VALID_RESERVATION_STATUSES = [
  'confirmata', 'in asteptare', 'anulata', 'finalizata',
  'neprezentat', 'in curs', 'check-in', 'check-out',
];

const VALID_HOTEL_STATUSES = ['active', 'inactive', 'maintenance', 'closed'];

// ---------------------------------------------------------------------------
// Functii ajutatoare de validare
// ---------------------------------------------------------------------------

function isValidString(val, min = 1, max = 255) {
  return typeof val === 'string' && val.trim().length >= min && val.trim().length <= max;
}

function isValidPositiveInt(val) {
  return Number.isInteger(val) && val > 0;
}

function isValidPrice(val) {
  return typeof val === 'number' && !Number.isNaN(val) && val >= 0 && Number.isFinite(val);
}

function isValidRoomType(tip) {
  return VALID_ROOM_TYPES.includes(tip);
}

function isValidRoomStatus(status) {
  return VALID_ROOM_STATUSES.includes(status);
}

function isValidReservationStatus(status) {
  return VALID_RESERVATION_STATUSES.includes(status);
}

function isValidHotelStatus(status) {
  return VALID_HOTEL_STATUSES.includes(status);
}

function isValidDate(dateStr) {
  if (typeof dateStr !== 'string') return false;
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) return false;
  const date = new Date(dateStr + 'T00:00:00.000Z');
  return !isNaN(date.getTime());
}

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  if (typeof phone !== 'string') return false;
  return /^[+]?[\d\s\-./()]{6,20}$/.test(phone.trim());
}

// ---------------------------------------------------------------------------
// Helpers: conversie rand SQL → obiect de iesire (compatibil cu vechiul API)
// ---------------------------------------------------------------------------

/**
 * Normalizeaza un rând din tabela hotels la formatul asteptat de controller-e.
 * @param {Object} row
 * @returns {Object}
 */
function normalizeHotel(row) {
  if (!row) return null;
  return {
    _id: String(row.id),
    id: row.id,
    nume: row.name,
    name: row.name,
    adresa: row.address,
    address: row.address,
    numarStele: row.stars,
    stars: row.stars,
    facilitati: safeJsonParse(row.amenities, []),
    amenities: safeJsonParse(row.amenities, []),
    descriere: row.description || '',
    description: row.description || '',
    telefon: row.phone || '',
    phone: row.phone || '',
    email: row.email || '',
    website: row.website || '',
    imagine: safeJsonParse(row.images, []),
    images: safeJsonParse(row.images, []),
    totalRooms: row.totalRooms || 0,
    status: row.status || 'active',
    rating: row.rating || 0,
    tenantId: row.tenantId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Normalizeaza un rând din tabela rooms.
 * @param {Object} row
 * @returns {Object}
 */
function normalizeRoom(row) {
  if (!row) return null;
  return {
    _id: String(row.id),
    id: row.id,
    tip: row.tip,
    numar: row.numar,
    preturiSezoniere: safeJsonParse(row.preturiSezoniere, []),
    status: row.status,
    floor: row.floor,
    capacity: row.capacity,
    amenities: safeJsonParse(row.amenities, []),
    notes: row.notes || '',
    hotelId: row.hotelId,
    tenantId: row.tenantId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Normalizeaza un rând din tabela reservations (tip hotel).
 * @param {Object} row
 * @returns {Object}
 */
function normalizeReservation(row) {
  if (!row) return null;
  return {
    _id: String(row.id),
    id: row.id,
    tip: row.tip,
    hotelId: row.hotelId,
    tenantId: row.tenantId,
    numePersoana: row.numeClient,
    numeClient: row.numeClient,
    telefon: row.telefonClient || '',
    telefonClient: row.telefonClient || '',
    email: row.emailClient || '',
    emailClient: row.emailClient || '',
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    cameraId: row.camera || null,
    camera: row.camera || null,
    numarPersoane: row.numarPersoane,
    status: row.status,
    note: row.observatii || '',
    observatii: row.observatii || '',
    guestId: row.guestId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Parseaza JSON in siguranta; returneaza defaultValue daca parsarea esueaza.
 * @param {string} str
 * @param {*} defaultValue
 * @returns {*}
 */
function safeJsonParse(str, defaultValue) {
  if (typeof str !== 'string' || str.trim() === '') return defaultValue;
  try {
    return JSON.parse(str);
  } catch (_e) {
    return defaultValue;
  }
}

/**
 * Converteste un ID (string sau number) la integer pentru interogari SQL.
 * Arunca eroare daca valoarea nu este convertibila la un intreg valid (>0).
 * @param {*} id
 * @returns {number}
 */
function toIntId(id) {
  if (typeof id === 'number' && Number.isInteger(id) && id > 0) return id;
  if (typeof id === 'string') {
    const parsed = parseInt(id, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  throw new Error('ID-ul este invalid.');
}

/**
 * Returneaza un timestamp ISO 8601 curent.
 * @returns {string}
 */
function nowISO() {
  return new Date().toISOString();
}

// =========================================================================
// Operatii CRUD - Hoteluri
// =========================================================================

// ---------------------------------------------------------------------------
// Helpers interne: executie interogari peste sql.js (db.run / db.exec)
// ---------------------------------------------------------------------------

/**
 * Executa o interogare de tip INSERT/UPDATE/DELETE cu parametri.
 * Foloseste db.run() din sql.js si extrage changes + lastInsertRowid via db.exec().
 *
 * @param {import('sql.js').Database} db - Instanta bazei de date
 * @param {string} sql - Interogarea SQL parametrizata
 * @param {Array} [params=[]] - Parametrii
 * @returns {{ changes: number, lastInsertRowid: number }}
 */
function _dbRun(db, sql, params = []) {
  db.run(sql, params);
  const lastIdRes = db.exec('SELECT last_insert_rowid() AS id');
  const changesRes = db.exec('SELECT changes() AS cnt');
  return {
    changes: (changesRes.length > 0 && changesRes[0].values.length > 0) ? changesRes[0].values[0][0] : 0,
    lastInsertRowid: (lastIdRes.length > 0 && lastIdRes[0].values.length > 0) ? lastIdRes[0].values[0][0] : 0,
  };
}

/**
 * Executa o interogare SELECT cu parametri si returneaza un singur rand.
 * Foloseste prepared statements (singura cale sigura de a parametriza SELECT in sql.js).
 *
 * @param {import('sql.js').Database} db - Instanta bazei de date
 * @param {string} sql - Interogarea SQL parametrizata
 * @param {Array} [params=[]] - Parametrii
 * @returns {Object|undefined}
 */
function _dbGet(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  let row;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

/**
 * Executa o interogare SELECT cu parametri si returneaza toate randurile.
 * Foloseste prepared statements.
 *
 * @param {import('sql.js').Database} db - Instanta bazei de date
 * @param {string} sql - Interogarea SQL parametrizata
 * @param {Array} [params=[]] - Parametrii
 * @returns {Array<Object>}
 */
function _dbAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/**
 * Creeaza un hotel nou.
 * @param {Object} data - Datele hotelului
 * @param {string} data.nume - Numele hotelului (obligatoriu)
 * @param {string} data.adresa - Adresa hotelului (obligatoriu)
 * @param {number} [data.numarStele] - Numarul de stele (0-5)
 * @param {string[]} [data.facilitati] - Lista facilitatilor
 * @param {string} [data.descriere] - Descrierea hotelului
 * @param {string} [data.telefon] - Numarul de telefon
 * @param {string} [data.email] - Adresa de email
 * @param {string} [data.website] - Website-ul
 * @param {string|string[]} [data.imagine] - URL sau array de imagini
 * @param {string} [data.status] - Statusul hotelului (implicit 'active')
 * @param {string} data.tenantId - ID-ul tenant-ului (obligatoriu)
 * @returns {Promise<Object>}
 */
async function createHotel(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Datele hotelului sunt invalide.');
  }

  if (!data.nume || !isValidString(data.nume, 1, 200)) {
    throw new Error('Numele hotelului este obligatoriu si trebuie sa aiba intre 1 si 200 de caractere.');
  }

  if (!data.adresa || !isValidString(data.adresa, 1, 500)) {
    throw new Error('Adresa hotelului este obligatorie si trebuie sa aiba intre 1 si 500 de caractere.');
  }

  if (!data.tenantId) {
    throw new Error('ID-ul tenant-ului este obligatoriu.');
  }

  if (data.numarStele !== undefined && data.numarStele !== null) {
    if (!Number.isInteger(data.numarStele) || data.numarStele < 0 || data.numarStele > 5) {
      throw new Error('Numarul de stele trebuie sa fie un intreg intre 0 si 5.');
    }
  }

  if (data.facilitati !== undefined && data.facilitati !== null) {
    if (!Array.isArray(data.facilitati)) {
      throw new Error('Facilitatile trebuie sa fie o lista.');
    }
  }

  if (data.telefon !== undefined && data.telefon !== null && data.telefon !== '') {
    if (!isValidPhone(data.telefon)) {
      throw new Error('Numarul de telefon nu este valid.');
    }
  }

  if (data.email !== undefined && data.email !== null && data.email !== '') {
    if (!isValidEmail(data.email)) {
      throw new Error('Adresa de email nu este valida.');
    }
  }

  if (data.status !== undefined && data.status !== null && !isValidHotelStatus(data.status)) {
    throw new Error(`Statusul "${data.status}" nu este valid. Statusuri permise: ${VALID_HOTEL_STATUSES.join(', ')}.`);
  }

  const now = nowISO();
  const amenities = Array.isArray(data.facilitati) ? JSON.stringify(data.facilitati) : '[]';
  const images = data.imagine
    ? (Array.isArray(data.imagine) ? JSON.stringify(data.imagine) : JSON.stringify([data.imagine]))
    : '[]';
  const status = data.status || 'active';

  const db = await getDb();
  const result = _dbRun(
    db,
    `INSERT INTO hotels (tenantId, name, address, stars, amenities, description, phone, email, website, images, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.tenantId,
      data.nume.trim(),
      data.adresa.trim(),
      data.numarStele !== undefined && data.numarStele !== null ? data.numarStele : 0,
      amenities,
      data.descriere || '',
      data.telefon || '',
      data.email || '',
      data.website || '',
      images,
      status,
      now,
      now,
    ]
  );

  const newHotel = _dbGet(db, 'SELECT * FROM hotels WHERE id = ?', [result.lastInsertRowid]);
  return normalizeHotel(newHotel);
}

/**
 * Gaseste un hotel dupa ID.
 * @param {string|number} id - ID-ul hotelului
 * @returns {Promise<Object|null>}
 */
async function getHotelById(id) {
  if (!id) {
    throw new Error('ID-ul hotelului este invalid.');
  }

  const intId = toIntId(id);
  const db = await getDb();
  const row = _dbGet(db, 'SELECT * FROM hotels WHERE id = ?', [intId]);
  return normalizeHotel(row);
}

/**
 * Gaseste toate hotelurile unui tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object[]>}
 */
async function getHotelsByTenant(tenantId) {
  if (!tenantId) {
    throw new Error('ID-ul tenant-ului este obligatoriu.');
  }

  const db = await getDb();
  const rows = _dbAll(db, 'SELECT * FROM hotels WHERE tenantId = ? ORDER BY name ASC', [tenantId]);
  return rows.map(normalizeHotel);
}

/**
 * Actualizeaza un hotel.
 * @param {string|number} id - ID-ul hotelului
 * @param {Object} updates - Campurile de actualizat
 * @returns {Promise<Object|null>}
 */
async function updateHotel(id, updates) {
  if (!id) {
    throw new Error('ID-ul hotelului este invalid.');
  }

  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    throw new Error('Datele de actualizare sunt invalide.');
  }

  const campuriPermise = [
    'nume', 'adresa', 'numarStele', 'facilitati',
    'descriere', 'telefon', 'email', 'website', 'imagine', 'status',
  ];

  // Validare
  for (const [key, value] of Object.entries(updates)) {
    if (!campuriPermise.includes(key)) {
      throw new Error(`Campul "${key}" nu este permis pentru actualizare.`);
    }

    switch (key) {
      case 'nume':
        if (!isValidString(value, 1, 200)) {
          throw new Error('Numele hotelului trebuie sa aiba intre 1 si 200 de caractere.');
        }
        break;
      case 'adresa':
        if (!isValidString(value, 1, 500)) {
          throw new Error('Adresa hotelului trebuie sa aiba intre 1 si 500 de caractere.');
        }
        break;
      case 'numarStele':
        if (!Number.isInteger(value) || value < 0 || value > 5) {
          throw new Error('Numarul de stele trebuie sa fie un intreg intre 0 si 5.');
        }
        break;
      case 'facilitati':
        if (!Array.isArray(value)) {
          throw new Error('Facilitatile trebuie sa fie o lista.');
        }
        break;
      case 'telefon':
        if (value && !isValidPhone(value)) {
          throw new Error('Numarul de telefon nu este valid.');
        }
        break;
      case 'email':
        if (value && !isValidEmail(value)) {
          throw new Error('Adresa de email nu este valida.');
        }
        break;
      case 'status':
        if (!isValidHotelStatus(value)) {
          throw new Error(`Statusul "${value}" nu este valid. Statusuri permise: ${VALID_HOTEL_STATUSES.join(', ')}.`);
        }
        break;
      case 'descriere':
      case 'website':
      case 'imagine':
        break;
    }
  }

  const intId = toIntId(id);
  const db = await getDb();

  // Verifica daca hotelul exista
  const existing = _dbGet(db, 'SELECT id FROM hotels WHERE id = ?', [intId]);
  if (!existing) {
    return null;
  }

  // Construieste clauza SET dinamic
  const setClauses = [];
  const params = [];
  const fieldMap = {
    nume: 'name',
    adresa: 'address',
    numarStele: 'stars',
    facilitati: 'amenities',
    descriere: 'description',
    telefon: 'phone',
    email: 'email',
    website: 'website',
    imagine: 'images',
    status: 'status',
  };

  for (const [key, value] of Object.entries(updates)) {
    const col = fieldMap[key];
    if (col === 'amenities') {
      setClauses.push(`${col} = ?`);
      params.push(JSON.stringify(value));
    } else if (col === 'images') {
      setClauses.push(`${col} = ?`);
      params.push(Array.isArray(value) ? JSON.stringify(value) : JSON.stringify([value]));
    } else {
      setClauses.push(`${col} = ?`);
      params.push(typeof value === 'string' ? value.trim() : value);
    }
  }

  setClauses.push('updatedAt = ?');
  params.push(nowISO());
  params.push(intId);

  const result = _dbRun(
    db,
    `UPDATE hotels SET ${setClauses.join(', ')} WHERE id = ?`,
    params
  );

  if (result.changes === 0) {
    return null;
  }

  const updated = _dbGet(db, 'SELECT * FROM hotels WHERE id = ?', [intId]);
  return normalizeHotel(updated);
}

/**
 * Sterge un hotel.
 * @param {string|number} id - ID-ul hotelului
 * @returns {Promise<boolean>}
 */
async function deleteHotel(id) {
  if (!id) {
    throw new Error('ID-ul hotelului este invalid.');
  }

  const intId = toIntId(id);
  const db = await getDb();
  const result = _dbRun(db, 'DELETE FROM hotels WHERE id = ?', [intId]);

  if (result.changes === 0) {
    throw new Error('Hotelul nu a fost gasit.');
  }

  return true;
}

/**
 * Lista toate hotelurile din baza de date.
 * @returns {Promise<Object[]>}
 */
async function listAllHotels() {
  const db = await getDb();
  const rows = _dbAll(db, 'SELECT * FROM hotels ORDER BY name ASC');
  return rows.map(normalizeHotel);
}

// =========================================================================
// Operatii CRUD - Camere
// =========================================================================

/**
 * Creeaza o camera noua.
 * @param {Object} data - Datele camerei
 * @param {string} data.tip - Tipul camerei (obligatoriu)
 * @param {number} data.numar - Numarul camerei (obligatoriu)
 * @param {Object[]} [data.preturiSezoniere] - Preturi sezoniere
 * @param {string} [data.status='available'] - Statusul camerei
 * @param {string} data.hotelId - ID-ul hotelului (obligatoriu)
 * @param {string} data.tenantId - ID-ul tenant-ului (obligatoriu)
 * @returns {Promise<Object>}
 */
async function createRoom(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Datele camerei sunt invalide.');
  }

  if (!data.tip || !isValidRoomType(data.tip)) {
    throw new Error(`Tipul camerei este invalid. Tipuri permise: ${VALID_ROOM_TYPES.join(', ')}.`);
  }

  if (data.numar === undefined || data.numar === null || !isValidPositiveInt(data.numar)) {
    throw new Error('Numarul camerei trebuie sa fie un numar intreg pozitiv.');
  }

  if (!data.hotelId) {
    throw new Error('ID-ul hotelului este obligatoriu.');
  }

  if (!data.tenantId) {
    throw new Error('ID-ul tenant-ului este obligatoriu.');
  }

  if (data.status !== undefined && !isValidRoomStatus(data.status)) {
    throw new Error(`Statusul "${data.status}" nu este valid. Statusuri permise: ${VALID_ROOM_STATUSES.join(', ')}.`);
  }

  if (data.preturiSezoniere !== undefined) {
    if (!Array.isArray(data.preturiSezoniere)) {
      throw new Error('Preturile sezoniere trebuie sa fie o lista.');
    }
    for (let i = 0; i < data.preturiSezoniere.length; i++) {
      const p = data.preturiSezoniere[i];
      if (!p || typeof p !== 'object' || !p.sezon || !isValidPrice(p.pret)) {
        throw new Error(`Pretul sezonier #${i + 1} este invalid.`);
      }
    }
  }

  const now = nowISO();
  const preturiSezoniere = Array.isArray(data.preturiSezoniere) ? JSON.stringify(data.preturiSezoniere) : '[]';

  const db = await getDb();
  const result = _dbRun(
    db,
    `INSERT INTO rooms (hotelId, tenantId, tip, numar, preturiSezoniere, status, floor, capacity, amenities, notes, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(data.hotelId),
      data.tenantId,
      data.tip,
      data.numar,
      preturiSezoniere,
      data.status || 'available',
      data.floor || null,
      data.capacity || 1,
      Array.isArray(data.amenities) ? JSON.stringify(data.amenities) : '[]',
      data.notes || '',
      now,
      now,
    ]
  );

  const newRoom = _dbGet(db, 'SELECT * FROM rooms WHERE id = ?', [result.lastInsertRowid]);
  return normalizeRoom(newRoom);
}

/**
 * Gaseste o camera dupa ID.
 * @param {string|number} id - ID-ul camerei
 * @returns {Promise<Object|null>}
 */
async function getRoomById(id) {
  if (!id) {
    throw new Error('ID-ul camerei este invalid.');
  }

  const intId = toIntId(id);
  const db = await getDb();
  const row = _dbGet(db, 'SELECT * FROM rooms WHERE id = ?', [intId]);
  return normalizeRoom(row);
}

/**
 * Gaseste toate camerele unui hotel.
 * @param {string} hotelId - ID-ul hotelului
 * @returns {Promise<Object[]>}
 */
async function getRoomsByHotel(hotelId) {
  if (!hotelId) {
    throw new Error('ID-ul hotelului este invalid.');
  }

  const db = await getDb();
  const rows = _dbAll(db, 'SELECT * FROM rooms WHERE hotelId = ? ORDER BY numar ASC', [String(hotelId)]);
  return rows.map(normalizeRoom);
}

/**
 * Actualizeaza o camera.
 * @param {string|number} id - ID-ul camerei
 * @param {Object} updates - Campurile de actualizat
 * @returns {Promise<Object|null>}
 */
async function updateRoom(id, updates) {
  if (!id) {
    throw new Error('ID-ul camerei este invalid.');
  }

  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    throw new Error('Datele de actualizare sunt invalide.');
  }

  const campuriPermise = ['tip', 'numar', 'preturiSezoniere', 'status'];

  for (const [key, value] of Object.entries(updates)) {
    if (!campuriPermise.includes(key)) {
      throw new Error(`Campul "${key}" nu este permis pentru actualizare.`);
    }

    switch (key) {
      case 'tip':
        if (!isValidRoomType(value)) {
          throw new Error(`Tipul camerei "${value}" nu este valid.`);
        }
        break;
      case 'numar':
        if (!isValidPositiveInt(value)) {
          throw new Error('Numarul camerei trebuie sa fie un numar intreg pozitiv.');
        }
        break;
      case 'preturiSezoniere':
        if (!Array.isArray(value)) {
          throw new Error('Preturile sezoniere trebuie sa fie o lista.');
        }
        for (let i = 0; i < value.length; i++) {
          const p = value[i];
          if (!p || typeof p !== 'object' || !p.sezon || !isValidPrice(p.pret)) {
            throw new Error(`Pretul sezonier #${i + 1} este invalid.`);
          }
        }
        break;
      case 'status':
        if (!isValidRoomStatus(value)) {
          throw new Error(`Statusul "${value}" nu este valid.`);
        }
        break;
    }
  }

  const intId = toIntId(id);
  const db = await getDb();

  // Verifica daca exista
  const existing = _dbGet(db, 'SELECT id FROM rooms WHERE id = ?', [intId]);
  if (!existing) {
    throw new Error('Camera nu a fost gasita.');
  }

  // Construieste SET dinamic
  const setClauses = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'preturiSezoniere') {
      setClauses.push('preturiSezoniere = ?');
      params.push(JSON.stringify(value));
    } else {
      setClauses.push(`${key} = ?`);
      params.push(value);
    }
  }

  setClauses.push('updatedAt = ?');
  params.push(nowISO());
  params.push(intId);

  _dbRun(db, `UPDATE rooms SET ${setClauses.join(', ')} WHERE id = ?`, params);

  const updated = _dbGet(db, 'SELECT * FROM rooms WHERE id = ?', [intId]);
  return normalizeRoom(updated);
}

/**
 * Sterge o camera.
 * @param {string|number} id - ID-ul camerei
 * @returns {Promise<boolean>}
 */
async function deleteRoom(id) {
  if (!id) {
    throw new Error('ID-ul camerei este invalid.');
  }

  const intId = toIntId(id);
  const db = await getDb();
  const result = _dbRun(db, 'DELETE FROM rooms WHERE id = ?', [intId]);

  if (result.changes === 0) {
    throw new Error('Camera nu a fost gasita.');
  }

  return true;
}

// =========================================================================
// Operatii CRUD - Rezervari
// =========================================================================

/**
 * Creeaza o rezervare noua.
 * @param {Object} data - Datele rezervarii
 * @param {string} data.hotelId - ID-ul hotelului (obligatoriu)
 * @param {string} data.tenantId - ID-ul tenant-ului (obligatoriu)
 * @param {string} data.numePersoana - Numele persoanei (obligatoriu)
 * @param {string} [data.telefon] - Numarul de telefon
 * @param {string} [data.email] - Adresa de email
 * @param {string} data.checkIn - Data check-in (YYYY-MM-DD) (obligatoriu)
 * @param {string} data.checkOut - Data check-out (YYYY-MM-DD) (obligatoriu)
 * @param {string} [data.cameraId] - ID-ul camerei rezervate
 * @param {number} [data.numarPersoane=1] - Numarul de persoane
 * @param {string} [data.status='confirmata'] - Statusul rezervarii
 * @param {string} [data.note] - Note aditionale
 * @returns {Promise<Object>}
 */
async function createReservation(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Datele rezervarii sunt invalide.');
  }

  if (!data.hotelId) {
    throw new Error('ID-ul hotelului este obligatoriu.');
  }

  if (!data.tenantId) {
    throw new Error('ID-ul tenant-ului este obligatoriu.');
  }

  if (!data.numePersoana || !isValidString(data.numePersoana, 2, 200)) {
    throw new Error('Numele persoanei trebuie sa aiba intre 2 si 200 de caractere.');
  }

  if (!data.checkIn || !isValidDate(data.checkIn)) {
    throw new Error('Data de check-in este obligatorie si trebuie sa fie o data valida (YYYY-MM-DD).');
  }

  if (!data.checkOut || !isValidDate(data.checkOut)) {
    throw new Error('Data de check-out este obligatorie si trebuie sa fie o data valida (YYYY-MM-DD).');
  }

  if (new Date(data.checkOut) <= new Date(data.checkIn)) {
    throw new Error('Data de check-out trebuie sa fie dupa data de check-in.');
  }

  if (data.telefon && !isValidPhone(data.telefon)) {
    throw new Error('Numarul de telefon nu este valid.');
  }

  if (data.email && !isValidEmail(data.email)) {
    throw new Error('Adresa de email nu este valida.');
  }

  if (data.status && !isValidReservationStatus(data.status)) {
    throw new Error(`Statusul "${data.status}" nu este valid. Statusuri permise: ${VALID_RESERVATION_STATUSES.join(', ')}.`);
  }

  if (data.numarPersoane !== undefined && data.numarPersoane !== null) {
    if (!Number.isInteger(data.numarPersoane) || data.numarPersoane < 1) {
      throw new Error('Numarul de persoane trebuie sa fie un numar intreg pozitiv.');
    }
  }

  const now = nowISO();
  const status = data.status || 'confirmata';

  const db = await getDb();
  const result = _dbRun(
    db,
    `INSERT INTO reservations
       (tenantId, tip, hotelId, data, numarPersoane, numeClient, emailClient, telefonClient,
        observatii, camera, checkIn, checkOut, status, guestId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.tenantId,
      'hotel',
      String(data.hotelId),
      data.checkIn,
      data.numarPersoane || 1,
      data.numePersoana.trim(),
      data.email || '',
      data.telefon || '',
      data.note || '',
      data.cameraId || null,
      data.checkIn,
      data.checkOut,
      status,
      data.guestId || null,
      now,
      now,
    ]
  );

  const newReservation = _dbGet(db, 'SELECT * FROM reservations WHERE id = ?', [result.lastInsertRowid]);
  return normalizeReservation(newReservation);
}

/**
 * Gaseste o rezervare dupa ID.
 * @param {string|number} id - ID-ul rezervarii
 * @returns {Promise<Object|null>}
 */
async function getReservationById(id) {
  if (!id) {
    throw new Error('ID-ul rezervarii este invalid.');
  }

  const intId = toIntId(id);
  const db = await getDb();
  const row = _dbGet(db, 'SELECT * FROM reservations WHERE id = ?', [intId]);
  return normalizeReservation(row);
}

/**
 * Gaseste toate rezervarile unui hotel.
 * @param {string} hotelId - ID-ul hotelului
 * @returns {Promise<Object[]>}
 */
async function getReservationsByHotel(hotelId) {
  if (!hotelId) {
    throw new Error('ID-ul hotelului este invalid.');
  }

  const db = await getDb();
  const rows = _dbAll(
    db,
    'SELECT * FROM reservations WHERE hotelId = ? ORDER BY checkIn ASC',
    [String(hotelId)]
  );
  return rows.map(normalizeReservation);
}

/**
 * Gaseste toate rezervarile unui guest (dupa nume, telefon sau email).
 * @param {string} guestInfo - Nume, telefon sau email
 * @returns {Promise<Object[]>}
 */
async function getReservationsByGuest(guestInfo) {
  if (!guestInfo || typeof guestInfo !== 'string' || guestInfo.trim().length === 0) {
    throw new Error('Informatiile despre guest sunt invalide.');
  }

  const searchTerm = `%${guestInfo.trim()}%`;
  const db = await getDb();
  const rows = _dbAll(
    db,
    `SELECT * FROM reservations
     WHERE numeClient LIKE ? OR telefonClient LIKE ? OR emailClient LIKE ?
     ORDER BY checkIn DESC`,
    [searchTerm, searchTerm, searchTerm]
  );
  return rows.map(normalizeReservation);
}

/**
 * Actualizeaza statusul unei rezervari.
 * @param {string|number} id - ID-ul rezervarii
 * @param {string} status - Noul status
 * @returns {Promise<Object|null>}
 */
async function updateReservationStatus(id, status) {
  if (!id) {
    throw new Error('ID-ul rezervarii este invalid.');
  }

  if (!status || !isValidReservationStatus(status)) {
    throw new Error(`Statusul "${status}" nu este valid. Statusuri permise: ${VALID_RESERVATION_STATUSES.join(', ')}.`);
  }

  const intId = toIntId(id);
  const now = nowISO();
  const db = await getDb();

  const result = _dbRun(
    db,
    'UPDATE reservations SET status = ?, updatedAt = ? WHERE id = ?',
    [status, now, intId]
  );

  if (result.changes === 0) {
    throw new Error('Rezervarea nu a fost gasita.');
  }

  const updated = _dbGet(db, 'SELECT * FROM reservations WHERE id = ?', [intId]);
  return normalizeReservation(updated);
}

/**
 * Anuleaza o rezervare.
 * @param {string|number} id - ID-ul rezervarii
 * @returns {Promise<Object|null>}
 */
async function cancelReservation(id) {
  if (!id) {
    throw new Error('ID-ul rezervarii este invalid.');
  }

  const intId = toIntId(id);
  const db = await getDb();

  const reservation = _dbGet(db, 'SELECT * FROM reservations WHERE id = ?', [intId]);
  if (!reservation) {
    throw new Error('Rezervarea nu a fost gasita.');
  }

  if (reservation.status === 'anulata') {
    throw new Error('Rezervarea este deja anulata.');
  }

  if (reservation.status === 'finalizata' || reservation.status === 'check-out') {
    throw new Error('Rezervarile finalizate nu pot fi anulate.');
  }

  const now = nowISO();
  _dbRun(
    db,
    'UPDATE reservations SET status = ?, updatedAt = ? WHERE id = ?',
    ['anulata', now, intId]
  );

  const updated = _dbGet(db, 'SELECT * FROM reservations WHERE id = ?', [intId]);
  return normalizeReservation(updated);
}

// =========================================================================
// Exporturi
// =========================================================================

module.exports = {
  // Hoteluri
  createHotel,
  getHotelById,
  getHotelsByTenant,
  updateHotel,
  deleteHotel,
  listAllHotels,

  // Camere
  createRoom,
  getRoomById,
  getRoomsByHotel,
  updateRoom,
  deleteRoom,

  // Rezervari
  createReservation,
  getReservationById,
  getReservationsByHotel,
  getReservationsByGuest,
  updateReservationStatus,
  cancelReservation,

  // Constante
  VALID_ROOM_TYPES,
  VALID_ROOM_STATUSES,
  VALID_RESERVATION_STATUSES,
  VALID_HOTEL_STATUSES,
};