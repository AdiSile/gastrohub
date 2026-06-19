'use strict';

// ---------------------------------------------------------------------------
// Model Room – GastroHub
// Definirea structurii, validărilor și operațiilor CRUD pentru camere de hotel.
// Câmpuri suportate: tip, număr, preț sezonier, status, hotelId, tenantId
// ---------------------------------------------------------------------------

const Datastore = require('nedb');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Tipuri valide de camere
// ---------------------------------------------------------------------------

const VALID_ROOM_TYPES = [
  'single',
  'double',
  'twin',
  'triple',
  'suite',
  'junior suite',
  'penthouse',
  'dormitor',
  'apartament',
  'family room',
  'cabana',
  'vila',
];

// ---------------------------------------------------------------------------
// Statusuri valide pentru o cameră
// ---------------------------------------------------------------------------

const VALID_ROOM_STATUSES = [
  'available',
  'occupied',
  'cleaning',
  'maintenance',
  'reserved',
  'out of order',
];

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un șir nu este gol și are lungimea între limite.
 * @param {*} val
 * @param {number} [min=1]
 * @param {number} [max=255]
 * @returns {boolean}
 */
function isValidString(val, min = 1, max = 255) {
  return typeof val === 'string' && val.trim().length >= min && val.trim().length <= max;
}

/**
 * Verifică dacă un tip de cameră este valid.
 * @param {string} tip
 * @returns {boolean}
 */
function isValidRoomType(tip) {
  return VALID_ROOM_TYPES.includes(tip);
}

/**
 * Verifică dacă un status de cameră este valid.
 * @param {string} status
 * @returns {boolean}
 */
function isValidRoomStatus(status) {
  return VALID_ROOM_STATUSES.includes(status);
}

/**
 * Verifică dacă un număr este un număr întreg pozitiv.
 * @param {*} val
 * @returns {boolean}
 */
function isValidPositiveInt(val) {
  return Number.isInteger(val) && val > 0;
}

/**
 * Verifică dacă o valoare este un număr pozitiv (preț).
 * @param {*} val
 * @returns {boolean}
 */
function isValidPrice(val) {
  return typeof val === 'number' && !Number.isNaN(val) && val >= 0 && Number.isFinite(val);
}

// ---------------------------------------------------------------------------
// Clasa RoomModel – operații CRUD pentru camere
// ---------------------------------------------------------------------------

class RoomModel {
  /**
   * @param {string} dbDir - Directorul unde se stochează baza de date NeDB
   */
  constructor(dbDir = './data') {
    // Verifică existența directorului pentru baza de date; îl creează dacă nu există
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Datastore({
      filename: path.join(dbDir, 'rooms.db'),
      autoload: true,
      onload: (err) => {
        if (err) {
          console.error('Eroare la încărcarea bazei de date rooms.db:', err.message);
          throw err;
        }
      },
    });
    this.db.ensureIndex({ fieldName: 'tenantId' });
    this.db.ensureIndex({ fieldName: 'hotelId' });
    this.db.ensureIndex({ fieldName: 'număr' });
  }

  /**
   * Validează datele unei camere înainte de creare.
   * @param {Object} data
   * @returns {{ valid: boolean, errors: string[] }}
   */
  _validate(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
      return { valid: false, errors: ['Datele camerei sunt invalide.'] };
    }

    // tip – obligatoriu
    if (!data.tip || !isValidRoomType(data.tip)) {
      errors.push(
        `Tipul camerei este invalid. Tipuri permise: ${VALID_ROOM_TYPES.join(', ')}.`
      );
    }

    // număr – obligatoriu
    if (data.număr === undefined || data.număr === null || !isValidPositiveInt(data.număr)) {
      errors.push('Numărul camerei trebuie să fie un număr întreg pozitiv.');
    }

    // prețuriSezoniere – opțional, dar validăm structura dacă este furnizat
    if (data.prețuriSezoniere !== undefined) {
      if (!Array.isArray(data.prețuriSezoniere)) {
        errors.push('Prețurile sezoniere trebuie să fie o listă.');
      } else {
        for (let i = 0; i < data.prețuriSezoniere.length; i++) {
          const p = data.prețuriSezoniere[i];
          if (!p || typeof p !== 'object') {
            errors.push(`Prețul sezonier #${i + 1} este invalid.`);
            continue;
          }
          if (!isValidString(p.sezon, 1, 100)) {
            errors.push(`Prețul sezonier #${i + 1}: denumirea sezonului este obligatorie (max 100 caractere).`);
          }
          if (!isValidPrice(p.preț)) {
            errors.push(`Prețul sezonier #${i + 1}: prețul trebuie să fie un număr pozitiv.`);
          }
        }
      }
    }

    // status – opțional, default 'available'
    if (data.status !== undefined && !isValidRoomStatus(data.status)) {
      errors.push(
        `Statusul "${data.status}" nu este valid. Statusuri permise: ${VALID_ROOM_STATUSES.join(', ')}.`
      );
    }

    // hotelId – obligatoriu
    if (!data.hotelId) {
      errors.push('ID-ul hotelului este obligatoriu.');
    }

    // tenantId – obligatoriu
    if (!data.tenantId) {
      errors.push('ID-ul tenant-ului este obligatoriu.');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Creează o cameră nouă.
   * @param {Object} data
   * @param {string} data.tip - Tipul camerei (ex: 'single', 'double', 'suite')
   * @param {number} data.număr - Numărul camerei
   * @param {Object[]} [data.prețuriSezoniere] - Listă de prețuri sezoniere
   * @param {string} data.prețuriSezoniere[].sezon - Denumirea sezonului
   * @param {number} data.prețuriSezoniere[].preț - Prețul pentru acel sezon
   * @param {string} [data.status='available'] - Statusul camerei
   * @param {string} data.hotelId - ID-ul hotelului
   * @param {string} data.tenantId - ID-ul tenant-ului
   * @returns {Promise<Object>}
   */
  async create(data) {
    const validation = this._validate(data);
    if (!validation.valid) {
      const error = new Error(validation.errors.join(' '));
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    const doc = {
      tip: data.tip,
      număr: data.număr,
      prețuriSezoniere: Array.isArray(data.prețuriSezoniere) ? data.prețuriSezoniere : [],
      status: data.status || 'available',
      hotelId: data.hotelId,
      tenantId: data.tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return new Promise((resolve, reject) => {
      this.db.insert(doc, (err, newDoc) => {
        if (err) {
          if (err.errorType === 'uniqueViolated') {
            const error = new Error('Există deja o cameră cu acest număr în acest hotel.');
            error.statusCode = 409;
            error.code = 'DUPLICATE_ROOM_NUMBER';
            return reject(error);
          }
          return reject(err);
        }
        resolve(newDoc);
      });
    });
  }

  /**
   * Găsește o cameră după ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    return new Promise((resolve, reject) => {
      this.db.findOne({ _id: id }, (err, doc) => {
        if (err) return reject(err);
        resolve(doc || null);
      });
    });
  }

  /**
   * Găsește toate camerele dintr-un hotel.
   * @param {string} hotelId
   * @returns {Promise<Object[]>}
   */
  async findByHotel(hotelId) {
    return new Promise((resolve, reject) => {
      this.db.find({ hotelId }).sort({ număr: 1 }).exec((err, docs) => {
        if (err) return reject(err);
        resolve(docs || []);
      });
    });
  }

  /**
   * Găsește camere după hotel și status.
   * @param {string} hotelId
   * @param {string} status
   * @returns {Promise<Object[]>}
   */
  async findByHotelAndStatus(hotelId, status) {
    if (!isValidRoomStatus(status)) {
      const error = new Error(
        `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_ROOM_STATUSES.join(', ')}.`
      );
      error.statusCode = 400;
      error.code = 'INVALID_ROOM_STATUS';
      throw error;
    }

    return new Promise((resolve, reject) => {
      this.db.find({ hotelId, status }).sort({ număr: 1 }).exec((err, docs) => {
        if (err) return reject(err);
        resolve(docs || []);
      });
    });
  }

  /**
   * Găsește camere după hotel și tip.
   * @param {string} hotelId
   * @param {string} tip
   * @returns {Promise<Object[]>}
   */
  async findByHotelAndType(hotelId, tip) {
    if (!isValidRoomType(tip)) {
      const error = new Error(
        `Tipul camerei "${tip}" nu este valid. Tipuri permise: ${VALID_ROOM_TYPES.join(', ')}.`
      );
      error.statusCode = 400;
      error.code = 'INVALID_ROOM_TYPE';
      throw error;
    }

    return new Promise((resolve, reject) => {
      this.db.find({ hotelId, tip }).sort({ număr: 1 }).exec((err, docs) => {
        if (err) return reject(err);
        resolve(docs || []);
      });
    });
  }

  /**
   * Găsește toate camerele dintr-un tenant.
   * @param {string} tenantId
   * @returns {Promise<Object[]>}
   */
  async findByTenant(tenantId) {
    return new Promise((resolve, reject) => {
      this.db.find({ tenantId }).sort({ hotelId: 1, număr: 1 }).exec((err, docs) => {
        if (err) return reject(err);
        resolve(docs || []);
      });
    });
  }

  /**
   * Actualizează o cameră.
   * @param {string} id
   * @param {Object} updates - Câmpurile de actualizat
   * @returns {Promise<Object|null>}
   */
  async update(id, updates) {
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      const error = new Error('Nu s-au furnizat date pentru actualizare.');
      error.statusCode = 400;
      error.code = 'EMPTY_UPDATE_DATA';
      throw error;
    }

    // Câmpuri permise pentru actualizare
    const allowedFields = ['tip', 'număr', 'prețuriSezoniere', 'status'];
    const $set = {};
    const errors = [];

    for (const [key, value] of Object.entries(updates)) {
      if (!allowedFields.includes(key)) continue;

      switch (key) {
        case 'tip':
          if (!isValidRoomType(value)) {
            errors.push(`Tipul camerei "${value}" nu este valid.`);
          } else {
            $set.tip = value;
          }
          break;

        case 'număr':
          if (!isValidPositiveInt(value)) {
            errors.push('Numărul camerei trebuie să fie un număr întreg pozitiv.');
          } else {
            $set.număr = value;
          }
          break;

        case 'prețuriSezoniere':
          if (!Array.isArray(value)) {
            errors.push('Prețurile sezoniere trebuie să fie o listă.');
          } else {
            let valid = true;
            for (let i = 0; i < value.length; i++) {
              const p = value[i];
              if (!p || typeof p !== 'object' || !isValidString(p.sezon, 1, 100) || !isValidPrice(p.preț)) {
                errors.push(`Prețul sezonier #${i + 1} este invalid (necesită sezon și preț valid).`);
                valid = false;
              }
            }
            if (valid) {
              $set.prețuriSezoniere = value;
            }
          }
          break;

        case 'status':
          if (!isValidRoomStatus(value)) {
            errors.push(`Statusul "${value}" nu este valid.`);
          } else {
            $set.status = value;
          }
          break;

        // No default
      }
    }

    if (errors.length > 0) {
      const error = new Error(errors.join(' '));
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    if (Object.keys($set).length === 0) {
      const error = new Error('Nu s-au furnizat câmpuri valide pentru actualizare.');
      error.statusCode = 400;
      error.code = 'NO_VALID_FIELDS';
      throw error;
    }

    $set.updatedAt = new Date();

    return new Promise((resolve, reject) => {
      this.db.update(
        { _id: id },
        { $set },
        { returnUpdatedDocs: true },
        (err, numAffected, affectedDocs) => {
          if (err) return reject(err);
          if (numAffected === 0) {
            const error = new Error('Camera nu a fost găsită.');
            error.statusCode = 404;
            error.code = 'ROOM_NOT_FOUND';
            return reject(error);
          }
          resolve(affectedDocs);
        }
      );
    });
  }

  /**
   * Actualizează statusul unei camere.
   * @param {string} id
   * @param {string} status
   * @returns {Promise<Object|null>}
   */
  async updateStatus(id, status) {
    if (!isValidRoomStatus(status)) {
      const error = new Error(
        `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_ROOM_STATUSES.join(', ')}.`
      );
      error.statusCode = 400;
      error.code = 'INVALID_ROOM_STATUS';
      throw error;
    }

    return this.update(id, { status });
  }

  /**
   * Șterge o cameră.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async remove(id) {
    return new Promise((resolve, reject) => {
      this.db.remove({ _id: id }, {}, (err, numRemoved) => {
        if (err) return reject(err);
        if (numRemoved === 0) {
          const error = new Error('Camera nu a fost găsită.');
          error.statusCode = 404;
          error.code = 'ROOM_NOT_FOUND';
          return reject(error);
        }
        resolve(true);
      });
    });
  }

  /**
   * Șterge toate camerele unui hotel.
   * @param {string} hotelId
   * @returns {Promise<number>} Numărul de camere șterse
   */
  async removeByHotel(hotelId) {
    return new Promise((resolve, reject) => {
      this.db.remove({ hotelId }, { multi: true }, (err, numRemoved) => {
        if (err) return reject(err);
        resolve(numRemoved || 0);
      });
    });
  }

  /**
   * Numără camerele dintr-un hotel.
   * @param {string} hotelId
   * @returns {Promise<number>}
   */
  async countByHotel(hotelId) {
    return new Promise((resolve, reject) => {
      this.db.count({ hotelId }, (err, count) => {
        if (err) return reject(err);
        resolve(count || 0);
      });
    });
  }

  /**
   * Numără camerele dintr-un hotel după status.
   * @param {string} hotelId
   * @param {string} status
   * @returns {Promise<number>}
   */
  async countByHotelAndStatus(hotelId, status) {
    if (!isValidRoomStatus(status)) {
      const error = new Error(
        `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_ROOM_STATUSES.join(', ')}.`
      );
      error.statusCode = 400;
      error.code = 'INVALID_ROOM_STATUS';
      throw error;
    }

    return new Promise((resolve, reject) => {
      this.db.count({ hotelId, status }, (err, count) => {
        if (err) return reject(err);
        resolve(count || 0);
      });
    });
  }

  /**
   * Găsește camere după un set de criterii (căutare flexibilă).
   * @param {Object} query
   * @returns {Promise<Object[]>}
   */
  async find(query) {
    return new Promise((resolve, reject) => {
      this.db.find(query).sort({ număr: 1 }).exec((err, docs) => {
        if (err) return reject(err);
        resolve(docs || []);
      });
    });
  }
}

module.exports = {
  RoomModel,
  // Funcții de validare exportate pentru reutilizare și testare
  isValidString,
  isValidRoomType,
  isValidRoomStatus,
  isValidPositiveInt,
  isValidPrice,
  VALID_ROOM_TYPES,
  VALID_ROOM_STATUSES,
};