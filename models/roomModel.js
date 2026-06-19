'use strict';

// ---------------------------------------------------------------------------
// Model Room – GastroHub
// Definirea structurii, validărilor și operațiilor CRUD pentru camere de hotel.
// Câmpuri suportate: tip, număr, preț sezonier, status, hotelId, tenantId
// Persistență: SQLite via sql.js (config/db)
// ---------------------------------------------------------------------------

const { getDb, run, get, all } = require('../config/db');

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
// Clasa RoomModel – operații CRUD pentru camere (SQLite)
// ---------------------------------------------------------------------------

class RoomModel {
  /**
   * Constructorul nu mai primește dbDir; baza este gestionată de config/db.
   */
  constructor() {
    // getDb() este apelat leneș în fiecare metodă, după initDb().
  }

  // -------------------------------------------------------------------------
  // Validare
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

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

    const now = new Date().toISOString();
    const preturiSezoniereJson = JSON.stringify(
      Array.isArray(data.prețuriSezoniere) ? data.prețuriSezoniere : []
    );

    try {
      const result = run(
        `INSERT INTO rooms (hotelId, tenantId, tip, numar, preturiSezoniere, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.hotelId,
          data.tenantId,
          data.tip,
          data.număr,
          preturiSezoniereJson,
          data.status || 'available',
          now,
          now,
        ]
      );

      // Returnează documentul complet
      const created = get('SELECT * FROM rooms WHERE id = ?', [result.lastInsertRowid]);
      return created;
    } catch (err) {
      // Verificăm dacă e o eroare de unicitate (SQLite constraint)
      if (err.message && err.message.includes('UNIQUE')) {
        const error = new Error('Există deja o cameră cu acest număr în acest hotel.');
        error.statusCode = 409;
        error.code = 'DUPLICATE_ROOM_NUMBER';
        throw error;
      }
      throw err;
    }
  }

  /**
   * Găsește o cameră după ID.
   * @param {string|number} id
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    const row = get('SELECT * FROM rooms WHERE id = ?', [id]);
    return row || null;
  }

  /**
   * Găsește toate camerele dintr-un hotel.
   * @param {string} hotelId
   * @returns {Promise<Object[]>}
   */
  async findByHotel(hotelId) {
    const rows = all(
      'SELECT * FROM rooms WHERE hotelId = ? ORDER BY numar ASC',
      [hotelId]
    );
    return rows || [];
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

    const rows = all(
      'SELECT * FROM rooms WHERE hotelId = ? AND status = ? ORDER BY numar ASC',
      [hotelId, status]
    );
    return rows || [];
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

    const rows = all(
      'SELECT * FROM rooms WHERE hotelId = ? AND tip = ? ORDER BY numar ASC',
      [hotelId, tip]
    );
    return rows || [];
  }

  /**
   * Găsește toate camerele unui tenant.
   * @param {string} tenantId
   * @returns {Promise<Object[]>}
   */
  async findByTenant(tenantId) {
    const rows = all(
      'SELECT * FROM rooms WHERE tenantId = ? ORDER BY hotelId ASC, numar ASC',
      [tenantId]
    );
    return rows || [];
  }

  /**
   * Actualizează o cameră.
   * @param {string|number} id
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

    // Câmpuri permise pentru actualizare (mapare nume API → coloană SQL)
    const allowedFields = ['tip', 'număr', 'prețuriSezoniere', 'status'];
    const setClauses = [];
    const params = [];
    const errors = [];

    for (const [key, value] of Object.entries(updates)) {
      if (!allowedFields.includes(key)) continue;

      switch (key) {
        case 'tip':
          if (!isValidRoomType(value)) {
            errors.push(`Tipul camerei "${value}" nu este valid.`);
          } else {
            setClauses.push('tip = ?');
            params.push(value);
          }
          break;

        case 'număr':
          if (!isValidPositiveInt(value)) {
            errors.push('Numărul camerei trebuie să fie un număr întreg pozitiv.');
          } else {
            setClauses.push('numar = ?');
            params.push(value);
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
              setClauses.push('preturiSezoniere = ?');
              params.push(JSON.stringify(value));
            }
          }
          break;

        case 'status':
          if (!isValidRoomStatus(value)) {
            errors.push(`Statusul "${value}" nu este valid.`);
          } else {
            setClauses.push('status = ?');
            params.push(value);
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

    if (setClauses.length === 0) {
      const error = new Error('Nu s-au furnizat câmpuri valide pentru actualizare.');
      error.statusCode = 400;
      error.code = 'NO_VALID_FIELDS';
      throw error;
    }

    // Adaugă updatedAt
    const now = new Date().toISOString();
    setClauses.push('updatedAt = ?');
    params.push(now);

    // Adaugă id-ul la finalul parametrilor
    params.push(id);

    const sql = `UPDATE rooms SET ${setClauses.join(', ')} WHERE id = ?`;

    try {
      const result = run(sql, params);
      if (result.changes === 0) {
        const error = new Error('Camera nu a fost găsită.');
        error.statusCode = 404;
        error.code = 'ROOM_NOT_FOUND';
        throw error;
      }

      // Returnează documentul actualizat
      const updated = get('SELECT * FROM rooms WHERE id = ?', [id]);
      return updated;
    } catch (err) {
      if (err.statusCode) throw err; // eroare deja formatată
      throw err;
    }
  }

  /**
   * Actualizează statusul unei camere.
   * @param {string|number} id
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
   * @param {string|number} id
   * @returns {Promise<boolean>}
   */
  async remove(id) {
    const result = run('DELETE FROM rooms WHERE id = ?', [id]);
    if (result.changes === 0) {
      const error = new Error('Camera nu a fost găsită.');
      error.statusCode = 404;
      error.code = 'ROOM_NOT_FOUND';
      throw error;
    }
    return true;
  }

  /**
   * Șterge toate camerele unui hotel.
   * @param {string} hotelId
   * @returns {Promise<number>} Numărul de camere șterse
   */
  async removeByHotel(hotelId) {
    const result = run('DELETE FROM rooms WHERE hotelId = ?', [hotelId]);
    return result.changes || 0;
  }

  /**
   * Numără camerele dintr-un hotel.
   * @param {string} hotelId
   * @returns {Promise<number>}
   */
  async countByHotel(hotelId) {
    const row = get('SELECT COUNT(*) AS cnt FROM rooms WHERE hotelId = ?', [hotelId]);
    return row ? row.cnt : 0;
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

    const row = get(
      'SELECT COUNT(*) AS cnt FROM rooms WHERE hotelId = ? AND status = ?',
      [hotelId, status]
    );
    return row ? row.cnt : 0;
  }

  /**
   * Găsește camere după un set de criterii (căutare flexibilă).
   *
   * Construiește dinamic clauza WHERE pe baza cheilor din `query`.
   * Suportă câmpurile: hotelId, tenantId, tip, status, numar.
   *
   * @param {Object} query - Obiect cu perechi cheie/valoare
   * @returns {Promise<Object[]>}
   */
  async find(query) {
    if (!query || typeof query !== 'object' || Object.keys(query).length === 0) {
      // Fără criterii, returnează tot (cu limită de precauție)
      const rows = all('SELECT * FROM rooms ORDER BY numar ASC LIMIT 1000');
      return rows || [];
    }

    const clauses = [];
    const params = [];

    // Mapare câmpuri query → coloane SQL
    const fieldMap = {
      hotelId: 'hotelId',
      tenantId: 'tenantId',
      tip: 'tip',
      status: 'status',
      număr: 'numar',
      numar: 'numar',
    };

    for (const [key, value] of Object.entries(query)) {
      const col = fieldMap[key];
      if (col) {
        clauses.push(`${col} = ?`);
        params.push(value);
      }
    }

    if (clauses.length === 0) {
      const rows = all('SELECT * FROM rooms ORDER BY numar ASC LIMIT 1000');
      return rows || [];
    }

    const sql = `SELECT * FROM rooms WHERE ${clauses.join(' AND ')} ORDER BY numar ASC`;
    const rows = all(sql, params);
    return rows || [];
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