'use strict';

// ---------------------------------------------------------------------------
// Model Hotel - GastroHub
// Contine operatii CRUD pentru hoteluri, camere si rezervari.
// Foloseste NeDB (@seald-io/nedb) ca baza de date embedded.
// ---------------------------------------------------------------------------

const Datastore = require('nedb');
const path = require('path');

// ---------------------------------------------------------------------------
// Directorul implicit pentru bazele de date NeDB
// ---------------------------------------------------------------------------

const DB_DIR = './data';

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
// Initializare baze de date NeDB
// ---------------------------------------------------------------------------

const hotelsDb = new Datastore({
  filename: path.join(DB_DIR, 'hotels.db'),
  autoload: true,
});

const roomsDb = new Datastore({
  filename: path.join(DB_DIR, 'rooms.db'),
  autoload: true,
});

const reservationsDb = new Datastore({
  filename: path.join(DB_DIR, 'reservations.db'),
  autoload: true,
});

// ---------------------------------------------------------------------------
// Indexuri pentru performanta
// ---------------------------------------------------------------------------

hotelsDb.ensureIndex({ fieldName: 'tenantId' });
hotelsDb.ensureIndex({ fieldName: 'nume' });

roomsDb.ensureIndex({ fieldName: 'tenantId' });
roomsDb.ensureIndex({ fieldName: 'hotelId' });
roomsDb.ensureIndex({ fieldName: 'numar' });

reservationsDb.ensureIndex({ fieldName: 'tenantId' });
reservationsDb.ensureIndex({ fieldName: 'hotelId' });
reservationsDb.ensureIndex({ fieldName: 'guestId' });
reservationsDb.ensureIndex({ fieldName: 'status' });

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
 * @param {string} [data.imagine] - URL-ul imaginii
 * @param {string} data.tenantId - ID-ul tenant-ului (obligatoriu)
 * @returns {Promise<Object>}
 */
function createHotel(data) {
  return new Promise((resolve, reject) => {
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

    const doc = {
      nume: data.nume.trim(),
      adresa: data.adresa.trim(),
      numarStele: data.numarStele !== undefined && data.numarStele !== null ? data.numarStele : 0,
      facilitati: Array.isArray(data.facilitati) ? data.facilitati : [],
      descriere: data.descriere || '',
      telefon: data.telefon || '',
      email: data.email || '',
      website: data.website || '',
      imagine: data.imagine || '',
      tenantId: data.tenantId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    hotelsDb.insert(doc, (err, newDoc) => {
      if (err) {
        return reject(new Error(`Eroare la crearea hotelului: ${err.message}`));
      }
      resolve(newDoc);
    });
  });
}

/**
 * Gaseste un hotel dupa ID.
 * @param {string} id - ID-ul hotelului
 * @returns {Promise<Object|null>}
 */
function getHotelById(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new Error('ID-ul hotelului este invalid.'));
    }

    hotelsDb.findOne({ _id: id }, (err, doc) => {
      if (err) {
        return reject(new Error(`Eroare la cautarea hotelului: ${err.message}`));
      }
      resolve(doc || null);
    });
  });
}

/**
 * Gaseste toate hotelurile unui tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object[]>}
 */
function getHotelsByTenant(tenantId) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return reject(new Error('ID-ul tenant-ului este obligatoriu.'));
    }

    hotelsDb.find({ tenantId }).sort({ nume: 1 }).exec((err, docs) => {
      if (err) {
        return reject(new Error(`Eroare la cautarea hotelurilor: ${err.message}`));
      }
      resolve(docs || []);
    });
  });
}

/**
 * Actualizeaza un hotel.
 * @param {string} id - ID-ul hotelului
 * @param {Object} updates - Campurile de actualizat
 * @returns {Promise<Object|null>}
 */
function updateHotel(id, updates) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new Error('ID-ul hotelului este invalid.'));
    }

    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return reject(new Error('Datele de actualizare sunt invalide.'));
    }

    const campuriPermise = ['nume', 'adresa', 'numarStele', 'facilitati', 'descriere', 'telefon', 'email', 'website', 'imagine'];

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
        case 'descriere':
        case 'website':
        case 'imagine':
          break;
      }
    }

    const $set = { ...updates, updatedAt: new Date().toISOString() };

    hotelsDb.update({ _id: id }, { $set }, {}, (err, numReplaced) => {
      if (err) {
        return reject(new Error(`Eroare la actualizarea hotelului: ${err.message}`));
      }

      if (numReplaced === 0) {
        return resolve(null);
      }

      hotelsDb.findOne({ _id: id }, (findErr, doc) => {
        if (findErr) {
          return reject(new Error(`Eroare la regasirea hotelului actualizat: ${findErr.message}`));
        }
        resolve(doc || null);
      });
    });
  });
}

/**
 * Sterge un hotel.
 * @param {string} id - ID-ul hotelului
 * @returns {Promise<boolean>}
 */
function deleteHotel(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new Error('ID-ul hotelului este invalid.'));
    }

    hotelsDb.remove({ _id: id }, {}, (err, numRemoved) => {
      if (err) {
        return reject(new Error(`Eroare la stergerea hotelului: ${err.message}`));
      }

      if (numRemoved === 0) {
        return reject(new Error('Hotelul nu a fost gasit.'));
      }

      resolve(true);
    });
  });
}

/**
 * Lista toate hotelurile din baza de date.
 * @returns {Promise<Object[]>}
 */
function listAllHotels() {
  return new Promise((resolve, reject) => {
    hotelsDb.find({}).sort({ nume: 1 }).exec((err, docs) => {
      if (err) {
        return reject(new Error(`Eroare la listarea hotelurilor: ${err.message}`));
      }
      resolve(docs || []);
    });
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

    const doc = {
      tip: data.tip,
      numar: data.numar,
      preturiSezoniere: Array.isArray(data.preturiSezoniere) ? data.preturiSezoniere : [],
      status: data.status || 'available',
      hotelId: data.hotelId,
      tenantId: data.tenantId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    roomsDb.insert(doc, (err, newDoc) => {
      if (err) {
        return reject(new Error(`Eroare la crearea camerei: ${err.message}`));
      }
      resolve(newDoc);
    });
  });
}

/**
 * Gaseste o camera dupa ID.
 * @param {string} id - ID-ul camerei
 * @returns {Promise<Object|null>}
 */
function getRoomById(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new Error('ID-ul camerei este invalid.'));
    }

    roomsDb.findOne({ _id: id }, (err, doc) => {
      if (err) {
        return reject(new Error(`Eroare la cautarea camerei: ${err.message}`));
      }
      resolve(doc || null);
    });
  });
}

/**
 * Gaseste toate camerele unui hotel.
 * @param {string} hotelId - ID-ul hotelului
 * @returns {Promise<Object[]>}
 */
function getRoomsByHotel(hotelId) {
  return new Promise((resolve, reject) => {
    if (!hotelId) {
      return reject(new Error('ID-ul hotelului este invalid.'));
    }

    roomsDb.find({ hotelId }).sort({ numar: 1 }).exec((err, docs) => {
      if (err) {
        return reject(new Error(`Eroare la cautarea camerelor: ${err.message}`));
      }
      resolve(docs || []);
    });
  });
}

/**
 * Actualizeaza o camera.
 * @param {string} id - ID-ul camerei
 * @param {Object} updates - Campurile de actualizat
 * @returns {Promise<Object|null>}
 */
function updateRoom(id, updates) {
  return new Promise((resolve, reject) => {
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

    const $set = { ...updates, updatedAt: new Date().toISOString() };

    roomsDb.update({ _id: id }, { $set }, { returnUpdatedDocs: true }, (err, numAffected, affectedDocs) => {
      if (err) {
        return reject(new Error(`Eroare la actualizarea camerei: ${err.message}`));
      }

      if (numAffected === 0) {
        return reject(new Error('Camera nu a fost gasita.'));
      }

      resolve(affectedDocs);
    });
  });
}

/**
 * Sterge o camera.
 * @param {string} id - ID-ul camerei
 * @returns {Promise<boolean>}
 */
function deleteRoom(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new Error('ID-ul camerei este invalid.'));
    }

    roomsDb.remove({ _id: id }, {}, (err, numRemoved) => {
      if (err) {
        return reject(new Error(`Eroare la stergerea camerei: ${err.message}`));
      }

      if (numRemoved === 0) {
        return reject(new Error('Camera nu a fost gasita.'));
      }

      resolve(true);
    });
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

    const doc = {
      tip: 'hotel',
      hotelId: data.hotelId,
      tenantId: data.tenantId,
      numePersoana: data.numePersoana.trim(),
      telefon: data.telefon || '',
      email: data.email || '',
      checkIn: data.checkIn,
      checkOut: data.checkOut,
      cameraId: data.cameraId || null,
      numarPersoane: data.numarPersoane || 1,
      status: data.status || 'confirmata',
      note: data.note || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    reservationsDb.insert(doc, (err, newDoc) => {
      if (err) {
        return reject(new Error(`Eroare la crearea rezervarii: ${err.message}`));
      }
      resolve(newDoc);
    });
  });
}

/**
 * Gaseste o rezervare dupa ID.
 * @param {string} id - ID-ul rezervarii
 * @returns {Promise<Object|null>}
 */
function getReservationById(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new Error('ID-ul rezervarii este invalid.'));
    }

    reservationsDb.findOne({ _id: id }, (err, doc) => {
      if (err) {
        return reject(new Error(`Eroare la cautarea rezervarii: ${err.message}`));
      }
      resolve(doc || null);
    });
  });
}

/**
 * Gaseste toate rezervarile unui hotel.
 * @param {string} hotelId - ID-ul hotelului
 * @returns {Promise<Object[]>}
 */
function getReservationsByHotel(hotelId) {
  return new Promise((resolve, reject) => {
    if (!hotelId) {
      return reject(new Error('ID-ul hotelului este invalid.'));
    }

    reservationsDb.find({ hotelId }).sort({ checkIn: 1 }).exec((err, docs) => {
      if (err) {
        return reject(new Error(`Eroare la cautarea rezervarilor: ${err.message}`));
      }
      resolve(docs || []);
    });
  });
}

/**
 * Gaseste toate rezervarile unui guest (dupa nume, telefon sau email).
 * @param {string} guestInfo - Nume, telefon sau email
 * @returns {Promise<Object[]>}
 */
function getReservationsByGuest(guestInfo) {
  return new Promise((resolve, reject) => {
    if (!guestInfo || typeof guestInfo !== 'string' || guestInfo.trim().length === 0) {
      return reject(new Error('Informatiile despre guest sunt invalide.'));
    }

    const searchTerm = guestInfo.trim();

    reservationsDb.find({
      $or: [
        { numePersoana: { $regex: new RegExp(searchTerm, 'i') } },
        { telefon: { $regex: new RegExp(searchTerm, 'i') } },
        { email: { $regex: new RegExp(searchTerm, 'i') } },
      ],
    }).sort({ checkIn: -1 }).exec((err, docs) => {
      if (err) {
        return reject(new Error(`Eroare la cautarea rezervarilor: ${err.message}`));
      }
      resolve(docs || []);
    });
  });
}

/**
 * Actualizeaza statusul unei rezervari.
 * @param {string} id - ID-ul rezervarii
 * @param {string} status - Noul status
 * @returns {Promise<Object|null>}
 */
function updateReservationStatus(id, status) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new Error('ID-ul rezervarii este invalid.'));
    }

    if (!status || !isValidReservationStatus(status)) {
      return reject(new Error(`Statusul "${status}" nu este valid. Statusuri permise: ${VALID_RESERVATION_STATUSES.join(', ')}.`));
    }

    reservationsDb.update(
      { _id: id },
      { $set: { status, updatedAt: new Date().toISOString() } },
      { returnUpdatedDocs: true },
      (err, numAffected, affectedDocs) => {
        if (err) {
          return reject(new Error(`Eroare la actualizarea statusului rezervarii: ${err.message}`));
        }

        if (numAffected === 0) {
          return reject(new Error('Rezervarea nu a fost gasita.'));
        }

        resolve(affectedDocs);
      }
    );
  });
}

/**
 * Anuleaza o rezervare.
 * @param {string} id - ID-ul rezervarii
 * @returns {Promise<Object|null>}
 */
function cancelReservation(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new Error('ID-ul rezervarii este invalid.'));
    }

    reservationsDb.findOne({ _id: id }, (err, reservation) => {
      if (err) {
        return reject(new Error(`Eroare la cautarea rezervarii: ${err.message}`));
      }

      if (!reservation) {
        return reject(new Error('Rezervarea nu a fost gasita.'));
      }

      if (reservation.status === 'anulata') {
        return reject(new Error('Rezervarea este deja anulata.'));
      }

      if (reservation.status === 'finalizata' || reservation.status === 'check-out') {
        return reject(new Error('Rezervarile finalizate nu pot fi anulate.'));
      }

      reservationsDb.update(
        { _id: id },
        { $set: { status: 'anulata', updatedAt: new Date().toISOString() } },
        { returnUpdatedDocs: true },
        (updateErr, numAffected, affectedDocs) => {
          if (updateErr) {
            return reject(new Error(`Eroare la anularea rezervarii: ${updateErr.message}`));
          }
          resolve(affectedDocs);
        }
      );
    });
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
};