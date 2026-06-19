'use strict';

// ---------------------------------------------------------------------------
// Model Hotel - GastroHub
// Contine operatii CRUD pentru hoteluri, camere si rezervari.
// Foloseste SQLite via sql.js (getDb() din config/db).
// Toate operatiile sunt Promise-based cu interogari SQL parametrizate.
// ---------------------------------------------------------------------------

const { getDb, run, get, all } = require('../config/db');

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
function createHotel(data) {
  return new Promise((resolve, reject) => {
    try {
      if (!data || typeof data !== 'object') {
        return reject(new Error('Datele hotelului sunt invalide.'));
      }

      if (!data.nume || !isValidString(data.nume, 1, 200)) {
        return reject(new Error('Numele hotelului este obligatoriu si trebuie sa aiba intre 1 si 200 de caractere.'));
      }

      if (!data.adresa || !isValidString(data.adresa, 1, 500)) {
        return reject(new Error('Adresa hotelului este obligatorie si trebuie sa aiba intre 1 si 500 de caractere.'));
      }

      if (!data.tenantId) {
        return reject(new Error('ID-ul tenant-ului este obligatoriu.'));
      }

      if (data.numarStele !== undefined && data.numarStele !== null) {
        if (!Number.isInteger(data.numarStele) || data.numarStele < 0 || data.numarStele > 5) {
          return reject(new Error('Numarul de stele trebuie sa fie un intreg intre 0 si 5.'));
        }
      }

      if (data.facilitati !== undefined && data.facilitati !== null) {
        if (!Array.isArray(data.facilitati)) {
          return reject(new Error('Facilitatile trebuie sa fie o lista.'));
        }
      }

      if (data.telefon !== undefined && data.telefon !== null && data.telefon !== '') {
        if (!isValidPhone(data.telefon)) {
          return reject(new Error('Numarul de telefon nu este valid.'));
        }
      }

      if (data.email !== undefined && data.email !== null && data.email !== '') {
        if (!isValidEmail(data.email)) {
          return reject(new Error('Adresa de email nu este valida.'));
        }
      }

      if (data.status !== undefined && data.status !== null && !isValidHotelStatus(data.status)) {
        return reject(new Error(`Statusul "${data.status}" nu este valid. Statusuri permise: ${VALID_HOTEL_STATUSES.join(', ')}.`));
      }

      const now = nowISO();
      const amenities = Array.isArray(data.facilitati) ? JSON.stringify(data.facilitati) : '[]';
      const images = data.imagine
        ? (Array.isArray(data.imagine) ? JSON.stringify(data.imagine) : JSON.stringify([data.imagine]))
        : '[]';
      const status = data.status || 'active';

      const result = run(
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

      const newHotel = get('SELECT * FROM hotels WHERE id = ?', [result.lastInsertRowid]);
      resolve(normalizeHotel(newHotel));
    } catch (err) {
      reject(new Error(`Eroare la crearea hotelului: ${err.message}`));
    }
  });
}

/**
 * Gaseste un hotel dupa ID.
 * @param {string|number} id - ID-ul hotelului
 * @returns {Promise<Object|null>}
 */
function getHotelById(id) {
  return new Promise((resolve, reject) => {
    try {
      if (!id) {
        return reject(new Error('ID-ul hotelului este invalid.'));
      }

      const intId = toIntId(id);
      const row = get('SELECT * FROM hotels WHERE id = ?', [intId]);
      resolve(normalizeHotel(row));
    } catch (err) {
      reject(new Error(`Eroare la cautarea hotelului: ${err.message}`));
    }
  });
}

/**
 * Gaseste toate hotelurile unui tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object[]>}
 */
function getHotelsByTenant(tenantId) {
  return new Promise((resolve, reject) => {
    try {
      if (!tenantId) {
        return reject(new Error('ID-ul tenant-ului este obligatoriu.'));
      }

      const rows = all('SELECT * FROM hotels WHERE tenantId = ? ORDER BY name ASC', [tenantId]);
      resolve(rows.map(normalizeHotel));
    } catch (err) {
      reject(new Error(`Eroare la cautarea hotelurilor: ${err.message}`));
    }
  });
}

/**
 * Actualizeaza un hotel.
 * @param {string|number} id - ID-ul hotelului
 * @param {Object} updates - Campurile de actualizat
 * @returns {Promise<Object|null>}
 */
function updateHotel(id, updates) {
  return new Promise((resolve, reject) => {
    try {
      if (!id) {
        return reject(new Error('ID-ul hotelului este invalid.'));
      }

      if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
        return reject(new Error('Datele de actualizare sunt invalide.'));
      }

      const campuriPermise = [
        'nume', 'adresa', 'numarStele', 'facilitati',
        'descriere', 'telefon', 'email', 'website', 'imagine', 'status',
      ];

      // Validare
      for (const [key, value] of Object.entries(updates)) {
        if (!campuriPermise.includes(key)) {
          return reject(new Error(`Campul "${key}" nu este permis pentru actualizare.`));
        }

        switch (key) {
          case 'nume':
            if (!isValidString(value, 1, 200)) {
              return reject(new Error('Numele hotelului trebuie sa aiba intre 1 si 200 de caractere.'));
            }
            break;
          case 'adresa':
            if (!isValidString(value, 1, 500)) {
              return reject(new Error('Adresa hotelului trebuie sa aiba intre 1 si 500 de caractere.'));
            }
            break;
          case 'numarStele':
            if (!Number.isInteger(value) || value < 0 || value > 5) {
              return reject(new Error('Numarul de stele trebuie sa fie un intreg intre 0 si 5.'));
            }
            break;
          case 'facilitati':
            if (!Array.isArray(value)) {
              return reject(new Error('Facilitatile trebuie sa fie o lista.'));
            }
            break;
          case 'telefon':
            if (value && !isValidPhone(value)) {
              return reject(new Error('Numarul de telefon nu este valid.'));
            }
            break;
          case 'email':
            if (value && !isValidEmail(value)) {
              return reject(new Error('Adresa de email nu este valida.'));
            }
            break;
          case 'status':
            if (!isValidHotelStatus(value)) {
              return reject(new Error(`Statusul "${value}" nu este valid. Statusuri permise: ${VALID_HOTEL_STATUSES.join(', ')}.`));
            }
            break;
          case 'descriere':
          case 'website':
          case 'imagine':
            break;
        }
      }

      const intId = toIntId(id);

      // Verifica daca hotelul exista
      const existing = get('SELECT id FROM hotels WHERE id = ?', [intId]);
      if (!existing) {
        return resolve(null);
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

      const result = run(
        `UPDATE hotels SET ${setClauses.join(', ')} WHERE id = ?`,
        params
      );

      if (result.changes === 0) {
        return resolve(null);
      }

      const updated = get('SELECT * FROM hotels WHERE id = ?', [intId]);
      resolve(normalizeHotel(updated));
    } catch (err) {
      reject(new Error(`Eroare la actualizarea hotelului: ${err.message}`));
    }
  });
}

/**
 * Sterge un hotel.
 * @param {string|number} id - ID-ul hotelului
 * @returns {Promise<boolean>}
 */
function deleteHotel(id) {
  return new Promise((resolve, reject) => {
    try {
      if (!id) {
        return reject(new Error('ID-ul hotelului este invalid.'));
      }

      const intId = toIntId(id);
      const result = run('DELETE FROM hotels WHERE id = ?', [intId]);

      if (result.changes === 0) {
        return reject(new Error('Hotelul nu a fost gasit.'));
      }

      resolve(true);
    } catch (err) {
      reject(new Error(`Eroare la stergerea hotelului: ${err.message}`));
    }
  });
}

/**
 * Lista toate hotelurile din baza de date.
 * @returns {Promise<Object[]>}
 */
function listAllHotels() {
  return new Promise((resolve, reject) => {
    try {
      const rows = all('SELECT * FROM hotels ORDER BY name ASC');
      resolve(rows.map(normalizeHotel));
    } catch (err) {
      reject(new Error(`Eroare la listarea hotelurilor: ${err.message}`));
    }
  });
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
function createRoom(data) {
  return new Promise((resolve, reject) => {
    try {
      if (!data || typeof data !== 'object') {
        return reject(new Error('Datele camerei sunt invalide.'));
      }

      if (!data.tip || !isValidRoomType(data.tip)) {
        return reject(new Error(`Tipul camerei este invalid. Tipuri permise: ${VALID_ROOM_TYPES.join(', ')}.`));
      }

      if (data.numar === undefined || data.numar === null || !isValidPositiveInt(data.numar)) {
        return reject(new Error('Numarul camerei trebuie sa fie un numar intreg pozitiv.'));
      }

      if (!data.hotelId) {
        return reject(new Error('ID-ul hotelului este obligatoriu.'));
      }

      if (!data.tenantId) {
        return reject(new Error('ID-ul tenant-ului este obligatoriu.'));
      }

      if (data.status !== undefined && !isValidRoomStatus(data.status)) {
        return reject(new Error(`Statusul "${data.status}" nu este valid. Statusuri permise: ${VALID_ROOM_STATUSES.join(', ')}.`));
      }

      if (data.preturiSezoniere !== undefined) {
        if (!Array.isArray(data.preturiSezoniere)) {
          return reject(new Error('Preturile sezoniere trebuie sa fie o lista.'));
        }
        for (let i = 0; i < data.preturiSezoniere.length; i++) {
          const p = data.preturiSezoniere[i];
          if (!p || typeof p !== 'object' || !p.sezon || !isValidPrice(p.pret)) {
            return reject(new Error(`Pretul sezonier #${i + 1} este invalid.`));
          }
        }
      }

      const now = nowISO();
      const preturiSezoniere = Array.isArray(data.preturiSezoniere) ? JSON.stringify(data.preturiSezoniere) : '[]';

      const result = run(
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

      const newRoom = get('SELECT * FROM rooms WHERE id = ?', [result.lastInsertRowid]);
      resolve(normalizeRoom(newRoom));
    } catch (err) {
      reject(new Error(`Eroare la crearea camerei: ${err.message}`));
    }
  });
}

/**
 * Gaseste o camera dupa ID.
 * @param {string|number} id - ID-ul camerei
 * @returns {Promise<Object|null>}
 */
function getRoomById(id) {
  return new Promise((resolve, reject) => {
    try {
      if (!id) {
        return reject(new Error('ID-ul camerei este invalid.'));
      }

      const intId = toIntId(id);
      const row = get('SELECT * FROM rooms WHERE id = ?', [intId]);
      resolve(normalizeRoom(row));
    } catch (err) {
      reject(new Error(`Eroare la cautarea camerei: ${err.message}`));
    }
  });
}

/**
 * Gaseste toate camerele unui hotel.
 * @param {string} hotelId - ID-ul hotelului
 * @returns {Promise<Object[]>}
 */
function getRoomsByHotel(hotelId) {
  return new Promise((resolve, reject) => {
    try {
      if (!hotelId) {
        return reject(new Error('ID-ul hotelului este invalid.'));
      }

      const rows = all('SELECT * FROM rooms WHERE hotelId = ? ORDER BY numar ASC', [String(hotelId)]);
      resolve(rows.map(normalizeRoom));
    } catch (err) {
      reject(new Error(`Eroare la cautarea camerelor: ${err.message}`));
    }
  });
}

/**
 * Actualizeaza o camera.
 * @param {string|number} id - ID-ul camerei
 * @param {Object} updates - Campurile de actualizat
 * @returns {Promise<Object|null>}
 */
function updateRoom(id, updates) {
  return new Promise((resolve, reject) => {
    try {
      if (!id) {
        return reject(new Error('ID-ul camerei este invalid.'));
      }

      if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
        return reject(new Error('Datele de actualizare sunt invalide.'));
      }

      const campuriPermise = ['tip', 'numar', 'preturiSezoniere', 'status'];

      for (const [key, value] of Object.entries(updates)) {
        if (!campuriPermise.includes(key)) {
          return reject(new Error(`Campul "${key}" nu este permis pentru actualizare.`));
        }

        switch (key) {
          case 'tip':
            if (!isValidRoomType(value)) {
              return reject(new Error(`Tipul camerei "${value}" nu este valid.`));
            }
            break;
          case 'numar':
            if (!isValidPositiveInt(value)) {
              return reject(new Error('Numarul camerei trebuie sa fie un numar intreg pozitiv.'));
            }
            break;
          case 'preturiSezoniere':
            if (!Array.isArray(value)) {
              return reject(new Error('Preturile sezoniere trebuie sa fie o lista.'));
            }
            for (let i = 0; i < value.length; i++) {
              const p = value[i];
              if (!p || typeof p !== 'object' || !p.sezon || !isValidPrice(p.pret)) {
                return reject(new Error(`Pretul sezonier #${i + 1} este invalid.`));
              }
            }
            break;
          case 'status':
            if (!isValidRoomStatus(value)) {
              return reject(new Error(`Statusul "${value}" nu este valid.`));
            }
            break;
        }
      }

      const intId = toIntId(id);

      // Verifica daca exista
      const existing = get('SELECT id FROM rooms WHERE id = ?', [intId]);
      if (!existing) {
        return reject(new Error('Camera nu a fost gasita.'));
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

      run(`UPDATE rooms SET ${setClauses.join(', ')} WHERE id = ?`, params);

      const updated = get('SELECT * FROM rooms WHERE id = ?', [intId]);
      resolve(normalizeRoom(updated));
    } catch (err) {
      reject(new Error(`Eroare la actualizarea camerei: ${err.message}`));
    }
  });
}

/**
 * Sterge o camera.
 * @param {string|number} id - ID-ul camerei
 * @returns {Promise<boolean>}
 */
function deleteRoom(id) {
  return new Promise((resolve, reject) => {
    try {
      if (!id) {
        return reject(new Error('ID-ul camerei este invalid.'));
      }

      const intId = toIntId(id);
      const result = run('DELETE FROM rooms WHERE id = ?', [intId]);

      if (result.changes === 0) {
        return reject(new Error('Camera nu a fost gasita.'));
      }

      resolve(true);
    } catch (err) {
      reject(new Error(`Eroare la stergerea camerei: ${err.message}`));
    }
  });
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
function createReservation(data) {
  return new Promise((resolve, reject) => {
    try {
      if (!data || typeof data !== 'object') {
        return reject(new Error('Datele rezervarii sunt invalide.'));
      }

      if (!data.hotelId) {
        return reject(new Error('ID-ul hotelului este obligatoriu.'));
      }

      if (!data.tenantId) {
        return reject(new Error('ID-ul tenant-ului este obligatoriu.'));
      }

      if (!data.numePersoana || !isValidString(data.numePersoana, 2, 200)) {
        return reject(new Error('Numele persoanei trebuie sa aiba intre 2 si 200 de caractere.'));
      }

      if (!data.checkIn || !isValidDate(data.checkIn)) {
        return reject(new Error('Data de check-in este obligatorie si trebuie sa fie o data valida (YYYY-MM-DD).'));
      }

      if (!data.checkOut || !isValidDate(data.checkOut)) {
        return reject(new Error('Data de check-out este obligatorie si trebuie sa fie o data valida (YYYY-MM-DD).'));
      }

      if (new Date(data.checkOut) <= new Date(data.checkIn)) {
        return reject(new Error('Data de check-out trebuie sa fie dupa data de check-in.'));
      }

      if (data.telefon && !isValidPhone(data.telefon)) {
        return reject(new Error('Numarul de telefon nu este valid.'));
      }

      if (data.email && !isValidEmail(data.email)) {
        return reject(new Error('Adresa de email nu este valida.'));
      }

      if (data.status && !isValidReservationStatus(data.status)) {
        return reject(new Error(`Statusul "${data.status}" nu este valid. Statusuri permise: ${VALID_RESERVATION_STATUSES.join(', ')}.`));
      }

      if (data.numarPersoane !== undefined && data.numarPersoane !== null) {
        if (!Number.isInteger(data.numarPersoane) || data.numarPersoane < 1) {
          return reject(new Error('Numarul de persoane trebuie sa fie un numar intreg pozitiv.'));
        }
      }

      const now = nowISO();
      const status = data.status || 'confirmata';

      const result = run(
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

      const newReservation = get('SELECT * FROM reservations WHERE id = ?', [result.lastInsertRowid]);
      resolve(normalizeReservation(newReservation));
    } catch (err) {
      reject(new Error(`Eroare la crearea rezervarii: ${err.message}`));
    }
  });
}

/**
 * Gaseste o rezervare dupa ID.
 * @param {string|number} id - ID-ul rezervarii
 * @returns {Promise<Object|null>}
 */
function getReservationById(id) {
  return new Promise((resolve, reject) => {
    try {
      if (!id) {
        return reject(new Error('ID-ul rezervarii este invalid.'));
      }

      const intId = toIntId(id);
      const row = get('SELECT * FROM reservations WHERE id = ?', [intId]);
      resolve(normalizeReservation(row));
    } catch (err) {
      reject(new Error(`Eroare la cautarea rezervarii: ${err.message}`));
    }
  });
}

/**
 * Gaseste toate rezervarile unui hotel.
 * @param {string} hotelId - ID-ul hotelului
 * @returns {Promise<Object[]>}
 */
function getReservationsByHotel(hotelId) {
  return new Promise((resolve, reject) => {
    try {
      if (!hotelId) {
        return reject(new Error('ID-ul hotelului este invalid.'));
      }

      const rows = all(
        'SELECT * FROM reservations WHERE hotelId = ? ORDER BY checkIn ASC',
        [String(hotelId)]
      );
      resolve(rows.map(normalizeReservation));
    } catch (err) {
      reject(new Error(`Eroare la cautarea rezervarilor: ${err.message}`));
    }
  });
}

/**
 * Gaseste toate rezervarile unui guest (dupa nume, telefon sau email).
 * @param {string} guestInfo - Nume, telefon sau email
 * @returns {Promise<Object[]>}
 */
function getReservationsByGuest(guestInfo) {
  return new Promise((resolve, reject) => {
    try {
      if (!guestInfo || typeof guestInfo !== 'string' || guestInfo.trim().length === 0) {
        return reject(new Error('Informatiile despre guest sunt invalide.'));
      }

      const searchTerm = `%${guestInfo.trim()}%`;

      const rows = all(
        `SELECT * FROM reservations
         WHERE numeClient LIKE ? OR telefonClient LIKE ? OR emailClient LIKE ?
         ORDER BY checkIn DESC`,
        [searchTerm, searchTerm, searchTerm]
      );
      resolve(rows.map(normalizeReservation));
    } catch (err) {
      reject(new Error(`Eroare la cautarea rezervarilor: ${err.message}`));
    }
  });
}

/**
 * Actualizeaza statusul unei rezervari.
 * @param {string|number} id - ID-ul rezervarii
 * @param {string} status - Noul status
 * @returns {Promise<Object|null>}
 */
function updateReservationStatus(id, status) {
  return new Promise((resolve, reject) => {
    try {
      if (!id) {
        return reject(new Error('ID-ul rezervarii este invalid.'));
      }

      if (!status || !isValidReservationStatus(status)) {
        return reject(new Error(`Statusul "${status}" nu este valid. Statusuri permise: ${VALID_RESERVATION_STATUSES.join(', ')}.`));
      }

      const intId = toIntId(id);
      const now = nowISO();

      const result = run(
        'UPDATE reservations SET status = ?, updatedAt = ? WHERE id = ?',
        [status, now, intId]
      );

      if (result.changes === 0) {
        return reject(new Error('Rezervarea nu a fost gasita.'));
      }

      const updated = get('SELECT * FROM reservations WHERE id = ?', [intId]);
      resolve(normalizeReservation(updated));
    } catch (err) {
      reject(new Error(`Eroare la actualizarea statusului rezervarii: ${err.message}`));
    }
  });
}

/**
 * Anuleaza o rezervare.
 * @param {string|number} id - ID-ul rezervarii
 * @returns {Promise<Object|null>}
 */
function cancelReservation(id) {
  return new Promise((resolve, reject) => {
    try {
      if (!id) {
        return reject(new Error('ID-ul rezervarii este invalid.'));
      }

      const intId = toIntId(id);

      const reservation = get('SELECT * FROM reservations WHERE id = ?', [intId]);
      if (!reservation) {
        return reject(new Error('Rezervarea nu a fost gasita.'));
      }

      if (reservation.status === 'anulata') {
        return reject(new Error('Rezervarea este deja anulata.'));
      }

      if (reservation.status === 'finalizata' || reservation.status === 'check-out') {
        return reject(new Error('Rezervarile finalizate nu pot fi anulate.'));
      }

      const now = nowISO();
      run(
        'UPDATE reservations SET status = ?, updatedAt = ? WHERE id = ?',
        ['anulata', now, intId]
      );

      const updated = get('SELECT * FROM reservations WHERE id = ?', [intId]);
      resolve(normalizeReservation(updated));
    } catch (err) {
      reject(new Error(`Eroare la anularea rezervarii: ${err.message}`));
    }
  });
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
### routes/hotels.js
/**
 * ============================================================
 * routes/hotels.js - Rute API pentru gestionarea hotelurilor (CRUD + configurare)
 * ============================================================
 *
 * Responsabilități:
 *  1. GET    /api/hotels                  – Listare hoteluri (cu filtre, paginare, căutare)
 *  2. GET    /api/hotels/:id              – Detalii hotel
 *  3. POST   /api/hotels                  – Creare hotel nou
 *  4. PUT    /api/hotels/:id              – Actualizare hotel
 *  5. PATCH  /api/hotels/:id/status       – Actualizare status hotel
 *  6. PATCH  /api/hotels/:id/facilities   – Actualizare facilități
 *  7. DELETE /api/hotels/:id              – Ștergere hotel
 *  8. GET    /api/hotels/:id/rooms        – Listare camere ale unui hotel
 *  9. GET    /api/hotels/:id/rooms/available – Camere disponibile
 * 10. POST   /api/hotels/:id/rooms        – Adăugare cameră nouă
 *
 * Folosește:
 *  - express-validator pentru validarea câmpurilor
 *  - hotelModel.js pentru operații CRUD pe hoteluri (export direct de funcții)
 *  - roomModel.js pentru operații pe camere
 *  - middleware/auth.js pentru autentificare
 *  - middleware/roles.js pentru autorizare pe bază de roluri
 *
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');

const {
  createHotel,
  getHotelById,
  getHotelsByTenant,
  updateHotel,
  deleteHotel,
  listAllHotels,
  VALID_HOTEL_STATUSES,
} = require('../models/hotelModel');

const {
  RoomModel,
  VALID_ROOM_TYPES,
  VALID_ROOM_STATUSES,
} = require('../models/roomModel');

const { authenticate } = require('../middleware/auth');
const { authorize, authorizeMinLevel } = require('../middleware/roles');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Instanțiere modele
// ---------------------------------------------------------------------------

const roomModel = new RoomModel();

// ---------------------------------------------------------------------------
// Helper: verificare rezultate validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă există erori de validare din express-validator.
 * Dacă da, trimite un răspuns 422 cu lista de erori.
 *
 * @param {Object} req  - Request Express
 * @param {Object} res  - Response Express
 * @param {Function} next - Next middleware
 * @returns {void}
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map((e) => e.msg);
    return next(new AppError(errorMessages.join('; '), 422, 'VALIDATION_ERROR'));
  }
  next();
}

// ---------------------------------------------------------------------------
// Helper: determinare tenantId pentru filtrare
// ---------------------------------------------------------------------------

/**
 * Determină tenantId-ul care trebuie folosit în interogări.
 * super_admin poate specifica un tenantId prin query param, ceilalți
 * utilizatori sunt limitați la propriul tenant.
 *
 * @param {Object} req - Request Express (cu req.user populat)
 * @returns {string|null} tenantId-ul de filtrat
 */
function resolveTenantId(req) {
  if (req.user.role === 'super_admin' && req.query.tenantId) {
    return req.query.tenantId;
  }
  return req.user.tenantId || null;
}

// ---------------------------------------------------------------------------
// GET /api/hotels
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hotels
 * @desc    Listare hoteluri cu opțiuni de filtrare, căutare și paginare
 * @access  Privat (autentificare necesară)
 *
 * Query params:
 *   - status    {string}  opțional – filtrare după status
 *   - search    {string}  opțional – căutare după nume
 *   - tenantId  {string}  opțional – (doar super_admin) filtrare după tenant
 *   - sort      {string}  opțional – câmp după care se sortează
 *   - limit     {number}  opțional – număr maxim de rezultate
 *   - skip      {number}  opțional – câte rezultate se sar
 *
 * Răspuns (200):
 *   {
 *     success: true,
 *     data: { hotels, total, limit, skip }
 *   }
 */
router.get(
  '/',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    query('status')
      .optional()
      .isIn(VALID_HOTEL_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_HOTEL_STATUSES.join(', ')}.`),
    query('search')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1 })
      .withMessage('Termenul de căutare trebuie să aibă cel puțin 1 caracter.'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit trebuie să fie un număr între 1 și 100.'),
    query('skip')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Skip trebuie să fie un număr întreg, mai mare sau egal cu 0.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { status, search, sort, limit, skip } = req.query;
      const tenantId = resolveTenantId(req);

      // Dacă nu avem tenantId (utilizator fără tenant și nu e super_admin),
      // returnăm listă goală
      if (!tenantId && req.user.role !== 'super_admin') {
        return res.status(200).json({
          success: true,
          data: {
            hotels: [],
            total: 0,
            limit: limit ? parseInt(limit, 10) : null,
            skip: skip ? parseInt(skip, 10) : 0,
          },
        });
      }

      let hotels;
      let total;

      // Construim opțiunile de paginare
      const options = {};
      if (sort) options.sort = sort;
      if (limit) options.limit = parseInt(limit, 10);
      if (skip) options.skip = parseInt(skip, 10);

      if (search) {
        // Căutare după nume – filtrăm din lista tenantului
        const allHotels = await getHotelsByTenant(tenantId);
        const searchLower = search.toLowerCase();
        hotels = allHotels.filter((h) => h.nume && h.nume.toLowerCase().includes(searchLower));
        total = hotels.length;
      } else if (status) {
        // Filtrare după status – filtrăm din lista tenantului
        const allHotels = await getHotelsByTenant(tenantId);
        hotels = allHotels.filter((h) => h.status === status);
        total = hotels.length;
      } else {
        // Listare toate hotelurile tenant-ului
        const allHotels = await getHotelsByTenant(tenantId);
        total = allHotels.length;
        // Aplicăm opțiunile de paginare manual
        const start = options.skip || 0;
        const end = options.limit ? start + options.limit : undefined;
        hotels = allHotels.slice(start, end);
      }

      res.status(200).json({
        success: true,
        data: {
          hotels,
          total,
          limit: options.limit || null,
          skip: options.skip || 0,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/hotels/:id
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hotels/:id
 * @desc    Obține detaliile unui hotel după ID
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { hotel } }
 */
router.get(
  '/:id',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const hotel = await getHotelById(id);

      if (!hotel) {
        return next(new AppError(
          'Hotelul nu a fost găsit.',
          404,
          'HOTEL_NOT_FOUND'
        ));
      }

      // Verificare acces tenant (doar super_admin poate vedea hoteluri din alt tenant)
      if (req.user.role !== 'super_admin') {
        if (String(hotel.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest hotel.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      res.status(200).json({
        success: true,
        data: {
          hotel,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/hotels
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/hotels
 * @desc    Creează un hotel nou
 * @access  Privat (autentificare + rol manager, owner sau super_admin)
 *
 * Body (JSON):
 *   - nume        {string}  obligatoriu – numele hotelului
 *   - adresa      {string}  obligatoriu – adresa hotelului
 *   - facilitati  {string[]} opțional – lista facilităților
 *   - telefon     {string}  opțional – număr de telefon
 *   - email       {string}  opțional – email de contact
 *   - descriere   {string}  opțional – descrierea hotelului
 *   - status      {string}  opțional – statusul (implicit 'active')
 *
 * Răspuns (201):
 *   { success: true, data: { hotel } }
 */
router.post(
  '/',
  authenticate,
  authorizeMinLevel('manager'),
  [
    body('nume')
      .isString()
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage('Numele hotelului trebuie să aibă între 1 și 200 de caractere.'),
    body('adresa')
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage('Adresa hotelului trebuie să aibă între 5 și 500 de caractere.'),
    body('facilitati')
      .optional({ values: 'null' })
      .isArray()
      .withMessage('Facilitățile trebuie să fie o listă.'),
    body('facilitati.*')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare facilitate trebuie să fie un șir de caractere nevid.'),
    body('telefon')
      .optional({ values: 'null' })
      .isString()
      .withMessage('Telefonul trebuie să fie un șir de caractere.'),
    body('email')
      .optional({ values: 'null' })
      .isEmail()
      .withMessage('Adresa de email nu este validă.')
      .normalizeEmail(),
    body('descriere')
      .optional({ values: 'null' })
      .isString()
      .isLength({ max: 2000 })
      .withMessage('Descrierea poate avea maximum 2000 de caractere.'),
    body('status')
      .optional()
      .isIn(VALID_HOTEL_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_HOTEL_STATUSES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { nume, adresa, facilitati, telefon, email, descriere, status } = req.body;

      // Determinare tenantId
      const tenantId = resolveTenantId(req);

      if (!tenantId) {
        return next(new AppError(
          'Nu poți crea un hotel fără un tenant asociat.',
          400,
          'MISSING_TENANT_ID'
        ));
      }

      const hotelData = {
        nume,
        adresa,
        facilitati: facilitati || [],
        telefon: telefon || '',
        email: email || '',
        descriere: descriere || '',
        status: status || 'active',
        tenantId,
      };

      const newHotel = await createHotel(hotelData);

      res.status(201).json({
        success: true,
        data: {
          hotel: newHotel,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/hotels/:id
// ---------------------------------------------------------------------------

/**
 * @route   PUT /api/hotels/:id
 * @desc    Actualizează un hotel existent
 * @access  Privat (autentificare + rol manager, owner sau super_admin)
 *
 * Body (JSON) – cel puțin un câmp obligatoriu:
 *   - nume        {string}  opțional
 *   - adresa      {string}  opțional
 *   - facilitati  {string[]} opțional
 *   - telefon     {string}  opțional
 *   - email       {string}  opțional
 *   - descriere   {string}  opțional
 *   - status      {string}  opțional
 *
 * Răspuns (200):
 *   { success: true, data: { hotel } }
 */
router.put(
  '/:id',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
    body('nume')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage('Numele hotelului trebuie să aibă între 1 și 200 de caractere.'),
    body('adresa')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage('Adresa hotelului trebuie să aibă între 5 și 500 de caractere.'),
    body('facilitati')
      .optional({ values: 'null' })
      .isArray()
      .withMessage('Facilitățile trebuie să fie o listă.'),
    body('facilitati.*')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare facilitate trebuie să fie un șir de caractere nevid.'),
    body('telefon')
      .optional({ values: 'null' })
      .isString()
      .withMessage('Telefonul trebuie să fie un șir de caractere.'),
    body('email')
      .optional({ values: 'null' })
      .isEmail()
      .withMessage('Adresa de email nu este validă.')
      .normalizeEmail(),
    body('descriere')
      .optional({ values: 'null' })
      .isString()
      .isLength({ max: 2000 })
      .withMessage('Descrierea poate avea maximum 2000 de caractere.'),
    body('status')
      .optional()
      .isIn(VALID_HOTEL_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_HOTEL_STATUSES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Verificare existență și acces la hotel
      const existingHotel = await getHotelById(id);
      if (!existingHotel) {
        return next(new AppError(
          'Hotelul nu a fost găsit.',
          404,
          'HOTEL_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingHotel.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest hotel.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      // Construim obiectul doar cu câmpurile prezente în body
      // NOTĂ: folosim exact numele de câmp acceptate de hotelModel.updateHotel()
      const allowedFields = [
        'nume', 'adresa', 'facilitati',
        'telefon', 'email', 'descriere', 'status',
      ];
      const updateData = {};

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      }

      if (Object.keys(updateData).length === 0) {
        return next(new AppError(
          'Nu s-au furnizat câmpuri pentru actualizare.',
          400,
          'EMPTY_UPDATE_DATA'
        ));
      }

      const updatedHotel = await updateHotel(id, updateData);

      res.status(200).json({
        success: true,
        data: {
          hotel: updatedHotel,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/hotels/:id/status
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/hotels/:id/status
 * @desc    Actualizează statusul unui hotel
 * @access  Privat (autentificare + rol manager, owner sau super_admin)
 *
 * Body (JSON):
 *   - status  {string}  obligatoriu – noul status
 *
 * Răspuns (200):
 *   { success: true, data: { hotel } }
 */
router.patch(
  '/:id/status',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
    body('status')
      .isString()
      .trim()
      .notEmpty()
      .isIn(VALID_HOTEL_STATUSES)
      .withMessage(`Statusul trebuie să fie unul dintre: ${VALID_HOTEL_STATUSES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      // Verificare existență și acces
      const existingHotel = await getHotelById(id);
      if (!existingHotel) {
        return next(new AppError(
          'Hotelul nu a fost găsit.',
          404,
          'HOTEL_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(existingHotel.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest hotel.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedHotel = await updateHotel(id, { status });

      res.status(200).json({
        success: true,
        data: {
          hotel: updatedHotel,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/hotels/:id/facilities
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/hotels/:id/facilities
 * @desc    Actualizează lista de facilități a unui hotel
 * @access  Privat (autentificare + rol manager, owner sau super_admin)
 *
 * Body (JSON):
 *   - facilitati  {string[]}  obligatoriu – noua listă de facilități
 *
 * Răspuns (200):
 *   { success: true, data: { hotel } }
 */
router.patch(
  '/:id/facilities',
  authenticate,
  authorizeMinLevel('manager'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
    body('facilitati')
      .isArray({ min: 1 })
      .withMessage('Lista de facilități trebuie să conțină cel puțin un element.'),
    body('facilitati.*')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Fiecare facilitate trebuie să fie un șir de caractere nevid.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { facilitati } = req.body;

      // Verificare existență și acces
      const existingHotel = await getHotelById(id);
      if (!existingHotel) {
        return next(new AppError(
          'Hotelul nu a fost găsit.',
          404,
          'HOTEL_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(existingHotel.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest hotel.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      const updatedHotel = await updateHotel(id, {
        facilitati: facilitati.map((f) => f.trim()),
      });

      res.status(200).json({
        success: true,
        data: {
          hotel: updatedHotel,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/hotels/:id
// ---------------------------------------------------------------------------

/**
 * @route   DELETE /api/hotels/:id
 * @desc    Șterge un hotel
 * @access  Privat (autentificare + rol owner sau super_admin)
 *
 * Răspuns (200):
 *   { success: true, message: 'Hotelul a fost șters cu succes.' }
 */
router.delete(
  '/:id',
  authenticate,
  authorize('super_admin', 'owner'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Verificare existență
      const existingHotel = await getHotelById(id);
      if (!existingHotel) {
        return next(new AppError(
          'Hotelul nu a fost găsit.',
          404,
          'HOTEL_NOT_FOUND'
        ));
      }

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(existingHotel.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest hotel.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      await deleteHotel(id);

      res.status(200).json({
        success: true,
        message: 'Hotelul a fost șters cu succes.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/hotels/:id/rooms
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/hotels/:id/rooms
 * @desc    Listare camere ale unui hotel
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { rooms } }
 */
router.get(
  '/:id/rooms',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('id')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul hotelului este obligatoriu.'),
    query('status')
      .optional()
      .isIn(VALID_ROOM_STATUSES)
      .withMessage(`Statusul camerei trebuie să fie unul dintre: ${VALID_ROOM_STATUSES.join(', ')}.`),
    query('tip')
      .optional()
      .isIn(VALID_ROOM_TYPES)
      .withMessage(`Tipul camerei trebuie să fie unul dintre: ${VALID_ROOM_TYPES.join(', ')}.`),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status, tip } = req.query;

      // Verificare existență și acces hotel
      const hotel = await getHotelById(id);
      if (!hotel) {
        return next(new AppError(
          'Hotelul nu a fost găsit.',
          404,
          'HOTEL_NOT_FOUND'
        ));
      }

      if (req.user.role !== 'super_admin') {
        if (String(hotel.tenantId) !== String(req.user.tenantId)) {
          return next(new AppError(
            'Nu ai acces la acest hotel.',
            403,
            'TENANT_MISMATCH'
          ));
        }
      }

      let rooms;
      if (status && tip) {
        // Filtrăm după hotel, status și tip
        const allRooms = await roomModel.findByHotel(id);
        rooms = allRooms.filter((room) => room.status === status && room.tip === tip);
      } else if (status) {
        // Filtrăm doar după hotel și status
        rooms = await roomModel.findByHotelAndStatus(id, status);
      } else if (tip) {
        // Filtrăm doar după hotel și tip
        rooms = await roomModel.findByHotelAndType(id, tip);
      } else {
        // Fără filtre - toate camerele hotelului
        rooms = await roomModel.findByHotel(id);
      }

      res.status(200).json({
        success: true,
        data: {
          rooms,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = router;