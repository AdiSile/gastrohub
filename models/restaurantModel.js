'use strict';

// ---------------------------------------------------------------------------
// Model Restaurant – GastroHub
// Definirea structurii, validărilor și operațiilor CRUD pentru configurarea
// unui restaurant (nume, adresă, nr. mese, tenant asociat).
// Câmpuri suportate: name, address, tableCount, tenantId, phone, email, status
//
// Compatibilitate duală: SQLite (prin getDb()) cu fallback la NeDB.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { restaurants, getDb, run, get, all } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Statusuri valide pentru un restaurant
// ---------------------------------------------------------------------------

const VALID_STATUSES = ['active', 'inactive', 'closed'];

// ---------------------------------------------------------------------------
// Marcaj pentru migrarea tabelei restaurants în SQLite (executată o singură
// dată, la primul apel către orice funcție SQL)
// ---------------------------------------------------------------------------

let _sqlMigrated = false;

/**
 * Asigură că tabela `restaurants` din SQLite există și are schema corectă.
 * Se execută o singură dată, idempotent.
 */
function _ensureSqlSchema() {
  if (_sqlMigrated) return;
  try {
    const db = getDb();

    // Verifică dacă tabela restaurants există
    const tableInfo = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='restaurants'");
    const tableExists = tableInfo.length > 0 && tableInfo[0].values.length > 0;

    if (!tableExists) {
      db.run(`
        CREATE TABLE restaurants (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT    NOT NULL,
          address     TEXT    NOT NULL,
          tableCount  INTEGER DEFAULT 0,
          tenantId    TEXT    NOT NULL,
          phone       TEXT    DEFAULT '',
          email       TEXT    DEFAULT '',
          status      TEXT    DEFAULT 'active',
          createdAt   TEXT    DEFAULT (datetime('now')),
          updatedAt   TEXT    DEFAULT (datetime('now'))
        );
      `);

      // Index pentru căutarea rapidă după tenantId
      db.run('CREATE INDEX IF NOT EXISTS idx_restaurants_tenantId ON restaurants(tenantId);');
      // Index pentru căutarea după status
      db.run('CREATE INDEX IF NOT EXISTS idx_restaurants_status ON restaurants(status);');
      // Index compus tenantId + status
      db.run('CREATE INDEX IF NOT EXISTS idx_restaurants_tenantId_status ON restaurants(tenantId, status);');

      // Persistă modificarea de schemă pe disc
      const data = db.export();
      const dataDir = path.resolve(process.env.DB_PATH || './data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const dbPath = path.join(dataDir, 'gastrohub.db');
      const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      fs.writeFileSync(dbPath, buffer);
    }

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
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un șir nu este gol și are lungimea între limite.
 * @param {string} val - Valoarea de verificat
 * @param {number} [min=1] - Lungimea minimă
 * @param {number} [max=255] - Lungimea maximă
 * @returns {boolean}
 */
function isValidString(val, min = 1, max = 255) {
  return typeof val === 'string' && val.trim().length >= min && val.trim().length <= max;
}

/**
 * Verifică dacă un număr este un întreg pozitiv.
 * @param {*} val
 * @returns {boolean}
 */
function isValidPositiveInt(val) {
  return Number.isInteger(val) && val >= 0;
}

/**
 * Verifică dacă statusul este valid.
 * @param {string} status
 * @returns {boolean}
 */
function isValidStatus(status) {
  return VALID_STATUSES.includes(status);
}

/**
 * Verifică dacă un șir este o adresă de email validă (format simplu).
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// ---------------------------------------------------------------------------
// Operații CRUD – Restaurante (SQLite primar + NeDB fallback)
// ---------------------------------------------------------------------------

/**
 * Creează un restaurant nou în baza de date.
 *
 * @param {Object} restaurantData - Datele restaurantului
 * @param {string} restaurantData.name - Numele restaurantului (obligatoriu)
 * @param {string} restaurantData.address - Adresa restaurantului (obligatoriu)
 * @param {number} [restaurantData.tableCount=0] - Numărul de mese
 * @param {string} restaurantData.tenantId - ID-ul tenant-ului asociat (obligatoriu)
 * @param {string} [restaurantData.phone] - Număr de telefon
 * @param {string} [restaurantData.email] - Email de contact
 * @param {string} [restaurantData.status='active'] - Statusul restaurantului
 * @returns {Promise<Object>} Documentul restaurantului creat
 * @throws {AppError} Dacă validarea eșuează
 */
function createRestaurant(restaurantData) {
  return new Promise((resolve, reject) => {
    // -----------------------------------------------------------------------
    // Validare câmpuri obligatorii
    // -----------------------------------------------------------------------
    if (!restaurantData || typeof restaurantData !== 'object') {
      return reject(new AppError('Datele restaurantului sunt invalide.', 400, 'INVALID_RESTAURANT_DATA'));
    }

    const { name, address, tableCount, tenantId, phone, email, status } = restaurantData;

    // Validare nume
    if (!name || !isValidString(name, 1, 100)) {
      return reject(new AppError(
        'Numele restaurantului trebuie să aibă între 1 și 100 de caractere.',
        400,
        'INVALID_RESTAURANT_NAME'
      ));
    }

    // Validare adresă
    if (!address || !isValidString(address, 5, 500)) {
      return reject(new AppError(
        'Adresa restaurantului trebuie să aibă între 5 și 500 de caractere.',
        400,
        'INVALID_RESTAURANT_ADDRESS'
      ));
    }

    // Validare tenantId
    if (!tenantId) {
      return reject(new AppError(
        'ID-ul tenant-ului este obligatoriu.',
        400,
        'MISSING_TENANT_ID'
      ));
    }

    // Validare tableCount (opțional, implicit 0)
    const finalTableCount = tableCount !== undefined ? tableCount : 0;
    if (!isValidPositiveInt(finalTableCount)) {
      return reject(new AppError(
        'Numărul de mese trebuie să fie un număr întreg, mai mare sau egal cu 0.',
        400,
        'INVALID_TABLE_COUNT'
      ));
    }

    // Validare status (opțional, implicit 'active')
    const finalStatus = status || 'active';
    if (!isValidStatus(finalStatus)) {
      return reject(new AppError(
        `Statusul "${finalStatus}" nu este valid. Valorile permise: ${VALID_STATUSES.join(', ')}.`,
        400,
        'INVALID_STATUS'
      ));
    }

    // Validare email (opțional)
    if (email !== undefined && email !== null && email !== '' && !isValidEmail(email)) {
      return reject(new AppError(
        'Adresa de email a restaurantului este invalidă.',
        400,
        'INVALID_RESTAURANT_EMAIL'
      ));
    }

    // Validare phone (opțional, doar string)
    if (phone !== undefined && phone !== null && typeof phone !== 'string') {
      return reject(new AppError(
        'Numărul de telefon trebuie să fie un șir de caractere.',
        400,
        'INVALID_RESTAURANT_PHONE'
      ));
    }

    const now = new Date().toISOString();
    const finalName = name.trim();
    const finalAddress = address.trim();
    const finalPhone = phone || '';
    const finalEmail = email ? email.toLowerCase().trim() : '';

    // -------------------------------------------------------------------
    // Încercare SQLite
    // -------------------------------------------------------------------
    if (_isSqlAvailable()) {
      try {
        const result = run(
          `INSERT INTO restaurants (name, address, tableCount, tenantId, phone, email, status, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [finalName, finalAddress, finalTableCount, tenantId, finalPhone, finalEmail, finalStatus, now, now]
        );

        const newId = result.lastInsertRowid;
        const newRow = get('SELECT * FROM restaurants WHERE id = ?', [newId]);
        const doc = _sqlRowToDoc(newRow);
        return resolve(doc);
      } catch (sqlErr) {
        return reject(new AppError(
          `Eroare la crearea restaurantului (SQL): ${sqlErr.message}`,
          500,
          'DB_INSERT_ERROR'
        ));
      }
    }

    // -------------------------------------------------------------------
    // Fallback NeDB
    // -------------------------------------------------------------------
    const restaurantDoc = {
      name: finalName,
      address: finalAddress,
      tableCount: finalTableCount,
      tenantId: tenantId,
      phone: finalPhone,
      email: finalEmail,
      status: finalStatus,
      createdAt: now,
      updatedAt: now,
    };

    restaurants.insert(restaurantDoc, (insertErr, newRestaurant) => {
      if (insertErr) {
        return reject(new AppError(
          `Eroare la crearea restaurantului: ${insertErr.message}`,
          500,
          'DB_INSERT_ERROR'
        ));
      }

      resolve(newRestaurant);
    });
  });
}

/**
 * Găsește un restaurant după ID-ul său.
 * @param {string} id - ID-ul (NeDB _id sau SQLite id convertit la string)
 * @returns {Promise<Object|null>} Documentul restaurantului sau null
 */
function findRestaurantById(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    // ---- SQLite ----
    if (_isSqlAvailable()) {
      try {
        const numericId = parseInt(id, 10);
        let row;
        if (isNaN(numericId)) {
          row = get('SELECT * FROM restaurants WHERE CAST(id AS TEXT) = ?', [String(id)]);
        } else {
          row = get('SELECT * FROM restaurants WHERE id = ?', [numericId]);
        }
        return resolve(row ? _sqlRowToDoc(row) : null);
      } catch (sqlErr) {
        return reject(new AppError(
          `Eroare la căutarea restaurantului (SQL): ${sqlErr.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
    }

    // ---- NeDB ----
    restaurants.findOne({ _id: id }, (err, restaurant) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea restaurantului: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(restaurant || null);
    });
  });
}

/**
 * Găsește toate restaurantele dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni de căutare (sort, limit, skip)
 * @returns {Promise<Array>} Lista de restaurante
 */
function findRestaurantsByTenant(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    // ---- SQLite ----
    if (_isSqlAvailable()) {
      try {
        let sql = 'SELECT * FROM restaurants WHERE tenantId = ?';
        const params = [tenantId];

        // Sortare
        if (options.sort && typeof options.sort === 'object') {
          const sortKeys = Object.keys(options.sort);
          if (sortKeys.length > 0) {
            const sortClauses = sortKeys.map((k) => `${k} ${options.sort[k] === -1 ? 'DESC' : 'ASC'}`);
            sql += ' ORDER BY ' + sortClauses.join(', ');
          } else {
            sql += ' ORDER BY name ASC';
          }
        } else {
          sql += ' ORDER BY name ASC';
        }

        // Limit
        if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
          sql += ' LIMIT ?';
          params.push(options.limit);
        }

        // Offset (skip)
        if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
          sql += ' OFFSET ?';
          params.push(options.skip);
        }

        const rows = all(sql, params);
        return resolve(rows.map((r) => _sqlRowToDoc(r)));
      } catch (sqlErr) {
        return reject(new AppError(
          `Eroare la căutarea restaurantelor (SQL): ${sqlErr.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
    }

    // ---- NeDB ----
    let query = restaurants.find({ tenantId });

    if (options.sort) {
      query = query.sort(options.sort);
    } else {
      query = query.sort({ name: 1 });
    }

    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      query = query.limit(options.limit);
    }

    if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
      query = query.skip(options.skip);
    }

    query.exec((err, restaurantList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea restaurantelor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(restaurantList || []);
    });
  });
}

/**
 * Găsește toate restaurantele după status.
 * @param {string} status - Statusul căutat
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de restaurante
 */
function findRestaurantsByStatus(status, tenantId) {
  return new Promise((resolve, reject) => {
    if (!status || !isValidStatus(status)) {
      return reject(new AppError(
        `Statusul "${status}" nu este valid. Valorile permise: ${VALID_STATUSES.join(', ')}.`,
        400,
        'INVALID_STATUS'
      ));
    }

    // ---- SQLite ----
    if (_isSqlAvailable()) {
      try {
        let sql;
        const params = [status];

        if (tenantId) {
          sql = 'SELECT * FROM restaurants WHERE status = ? AND tenantId = ? ORDER BY name ASC';
          params.push(tenantId);
        } else {
          sql = 'SELECT * FROM restaurants WHERE status = ? ORDER BY name ASC';
        }

        const rows = all(sql, params);
        return resolve(rows.map((r) => _sqlRowToDoc(r)));
      } catch (sqlErr) {
        return reject(new AppError(
          `Eroare la căutarea restaurantelor (SQL): ${sqlErr.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
    }

    // ---- NeDB ----
    const filter = { status };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    restaurants.find(filter).sort({ name: 1 }).exec((err, restaurantList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea restaurantelor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(restaurantList || []);
    });
  });
}

/**
 * Actualizează un restaurant după ID.
 * @param {string} id - ID-ul restaurantului
 * @param {Object} updateData - Câmpurile de actualizat
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateRestaurant(id, updateData) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
      return reject(new AppError(
        'Nu s-au furnizat date pentru actualizare.',
        400,
        'EMPTY_UPDATE_DATA'
      ));
    }

    // -----------------------------------------------------------------------
    // Câmpuri permise pentru actualizare
    // -----------------------------------------------------------------------
    const allowedFields = ['name', 'address', 'tableCount', 'phone', 'email', 'status'];
    const setFields = {};
    const sqlUpdates = {};
    const errors = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (!allowedFields.includes(key)) {
        continue; // Ignorăm câmpurile nepermise
      }

      switch (key) {
        case 'name':
          if (!isValidString(value, 1, 100)) {
            errors.push('Numele restaurantului trebuie să aibă între 1 și 100 de caractere.');
          } else {
            setFields.name = value.trim();
            sqlUpdates.name = value.trim();
          }
          break;

        case 'address':
          if (!isValidString(value, 5, 500)) {
            errors.push('Adresa restaurantului trebuie să aibă între 5 și 500 de caractere.');
          } else {
            setFields.address = value.trim();
            sqlUpdates.address = value.trim();
          }
          break;

        case 'tableCount':
          if (!isValidPositiveInt(value)) {
            errors.push('Numărul de mese trebuie să fie un număr întreg, mai mare sau egal cu 0.');
          } else {
            setFields.tableCount = value;
            sqlUpdates.tableCount = value;
          }
          break;

        case 'phone':
          if (value !== null && value !== undefined && typeof value !== 'string') {
            errors.push('Numărul de telefon trebuie să fie un șir de caractere.');
          } else {
            setFields.phone = value || '';
            sqlUpdates.phone = value || '';
          }
          break;

        case 'email':
          if (value !== null && value !== undefined && value !== '' && !isValidEmail(value)) {
            errors.push('Adresa de email a restaurantului este invalidă.');
          } else {
            setFields.email = value ? value.toLowerCase().trim() : '';
            sqlUpdates.email = value ? value.toLowerCase().trim() : '';
          }
          break;

        case 'status':
          if (!isValidStatus(value)) {
            errors.push(`Statusul "${value}" nu este valid. Valorile permise: ${VALID_STATUSES.join(', ')}.`);
          } else {
            setFields.status = value;
            sqlUpdates.status = value;
          }
          break;

        // No default – allowedFields garantează că ajungem doar aici
      }
    }

    if (errors.length > 0) {
      return reject(new AppError(errors.join(' '), 400, 'VALIDATION_ERROR'));
    }

    if (Object.keys(setFields).length === 0) {
      return reject(new AppError(
        'Nu s-au furnizat câmpuri valide pentru actualizare.',
        400,
        'NO_VALID_FIELDS'
      ));
    }

    // -------------------------------------------------------------------
    // Actualizare – SQLite
    // -------------------------------------------------------------------
    const now = new Date().toISOString();

    if (_isSqlAvailable()) {
      try {
        const numericId = parseInt(id, 10);

        // Construim interogarea SQL dinamic
        const setClauses = Object.keys(sqlUpdates).map((k) => `${k} = ?`);
        setClauses.push('updatedAt = ?');
        const allParams = Object.values(sqlUpdates);
        allParams.push(now);

        let result;
        if (!isNaN(numericId)) {
          allParams.push(numericId);
          result = run(
            `UPDATE restaurants SET ${setClauses.join(', ')} WHERE id = ?`,
            allParams
          );
        } else {
          allParams.push(String(id));
          result = run(
            `UPDATE restaurants SET ${setClauses.join(', ')} WHERE CAST(id AS TEXT) = ?`,
            allParams
          );
        }

        if (result.changes === 0) {
          return reject(new AppError('Restaurantul nu a fost găsit.', 404, 'RESTAURANT_NOT_FOUND'));
        }

        // Returnăm documentul actualizat
        let updatedRow;
        if (!isNaN(numericId)) {
          updatedRow = get('SELECT * FROM restaurants WHERE id = ?', [numericId]);
        } else {
          updatedRow = get('SELECT * FROM restaurants WHERE CAST(id AS TEXT) = ?', [String(id)]);
        }
        return resolve(_sqlRowToDoc(updatedRow));
      } catch (sqlErr) {
        return reject(new AppError(
          `Eroare la actualizarea restaurantului (SQL): ${sqlErr.message}`,
          500,
          'DB_UPDATE_ERROR'
        ));
      }
    }

    // -------------------------------------------------------------------
    // Actualizare – NeDB
    // -------------------------------------------------------------------
    setFields.updatedAt = now;

    restaurants.update(
      { _id: id },
      { $set: setFields },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedRestaurant) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea restaurantului: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Restaurantul nu a fost găsit.', 404, 'RESTAURANT_NOT_FOUND'));
        }

        resolve(updatedRestaurant);
      }
    );
  });
}

/**
 * Actualizează numărul de mese al unui restaurant.
 * @param {string} id - ID-ul restaurantului
 * @param {number} tableCount - Noul număr de mese
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateTableCount(id, tableCount) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!isValidPositiveInt(tableCount)) {
      return reject(new AppError(
        'Numărul de mese trebuie să fie un număr întreg, mai mare sau egal cu 0.',
        400,
        'INVALID_TABLE_COUNT'
      ));
    }

    const now = new Date().toISOString();

    // ---- SQLite ----
    if (_isSqlAvailable()) {
      try {
        const numericId = parseInt(id, 10);
        let result;
        if (!isNaN(numericId)) {
          result = run(
            'UPDATE restaurants SET tableCount = ?, updatedAt = ? WHERE id = ?',
            [tableCount, now, numericId]
          );
        } else {
          result = run(
            'UPDATE restaurants SET tableCount = ?, updatedAt = ? WHERE CAST(id AS TEXT) = ?',
            [tableCount, now, String(id)]
          );
        }

        if (result.changes === 0) {
          return reject(new AppError('Restaurantul nu a fost găsit.', 404, 'RESTAURANT_NOT_FOUND'));
        }

        let updatedRow;
        if (!isNaN(numericId)) {
          updatedRow = get('SELECT * FROM restaurants WHERE id = ?', [numericId]);
        } else {
          updatedRow = get('SELECT * FROM restaurants WHERE CAST(id AS TEXT) = ?', [String(id)]);
        }
        return resolve(_sqlRowToDoc(updatedRow));
      } catch (sqlErr) {
        return reject(new AppError(
          `Eroare la actualizarea numărului de mese (SQL): ${sqlErr.message}`,
          500,
          'DB_UPDATE_ERROR'
        ));
      }
    }

    // ---- NeDB ----
    restaurants.update(
      { _id: id },
      {
        $set: {
          tableCount,
          updatedAt: now,
        },
      },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedRestaurant) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea numărului de mese: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Restaurantul nu a fost găsit.', 404, 'RESTAURANT_NOT_FOUND'));
        }

        resolve(updatedRestaurant);
      }
    );
  });
}

/**
 * Actualizează statusul unui restaurant.
 * @param {string} id - ID-ul restaurantului
 * @param {string} status - Noul status
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateRestaurantStatus(id, status) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!status || !isValidStatus(status)) {
      return reject(new AppError(
        `Statusul "${status}" nu este valid. Valorile permise: ${VALID_STATUSES.join(', ')}.`,
        400,
        'INVALID_STATUS'
      ));
    }

    const now = new Date().toISOString();

    // ---- SQLite ----
    if (_isSqlAvailable()) {
      try {
        const numericId = parseInt(id, 10);
        let result;
        if (!isNaN(numericId)) {
          result = run(
            'UPDATE restaurants SET status = ?, updatedAt = ? WHERE id = ?',
            [status, now, numericId]
          );
        } else {
          result = run(
            'UPDATE restaurants SET status = ?, updatedAt = ? WHERE CAST(id AS TEXT) = ?',
            [status, now, String(id)]
          );
        }

        if (result.changes === 0) {
          return reject(new AppError('Restaurantul nu a fost găsit.', 404, 'RESTAURANT_NOT_FOUND'));
        }

        let updatedRow;
        if (!isNaN(numericId)) {
          updatedRow = get('SELECT * FROM restaurants WHERE id = ?', [numericId]);
        } else {
          updatedRow = get('SELECT * FROM restaurants WHERE CAST(id AS TEXT) = ?', [String(id)]);
        }
        return resolve(_sqlRowToDoc(updatedRow));
      } catch (sqlErr) {
        return reject(new AppError(
          `Eroare la actualizarea statusului (SQL): ${sqlErr.message}`,
          500,
          'DB_UPDATE_ERROR'
        ));
      }
    }

    // ---- NeDB ----
    restaurants.update(
      { _id: id },
      {
        $set: {
          status,
          updatedAt: now,
        },
      },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedRestaurant) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea statusului: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Restaurantul nu a fost găsit.', 404, 'RESTAURANT_NOT_FOUND'));
        }

        resolve(updatedRestaurant);
      }
    );
  });
}

/**
 * Șterge un restaurant după ID.
 * @param {string} id - ID-ul restaurantului
 * @returns {Promise<boolean>} true dacă a fost șters
 */
function deleteRestaurant(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    // ---- SQLite ----
    if (_isSqlAvailable()) {
      try {
        const numericId = parseInt(id, 10);
        let result;
        if (!isNaN(numericId)) {
          result = run('DELETE FROM restaurants WHERE id = ?', [numericId]);
        } else {
          result = run('DELETE FROM restaurants WHERE CAST(id AS TEXT) = ?', [String(id)]);
        }

        if (result.changes === 0) {
          return reject(new AppError('Restaurantul nu a fost găsit.', 404, 'RESTAURANT_NOT_FOUND'));
        }

        return resolve(true);
      } catch (sqlErr) {
        return reject(new AppError(
          `Eroare la ștergerea restaurantului (SQL): ${sqlErr.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }
    }

    // ---- NeDB ----
    restaurants.remove({ _id: id }, {}, (removeErr, numRemoved) => {
      if (removeErr) {
        return reject(new AppError(
          `Eroare la ștergerea restaurantului: ${removeErr.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      if (numRemoved === 0) {
        return reject(new AppError('Restaurantul nu a fost găsit.', 404, 'RESTAURANT_NOT_FOUND'));
      }

      resolve(true);
    });
  });
}

/**
 * Obține numărul total de restaurante dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>}
 */
function countRestaurantsByTenant(tenantId) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return resolve(0);
    }

    // ---- SQLite ----
    if (_isSqlAvailable()) {
      try {
        const row = get('SELECT COUNT(*) AS cnt FROM restaurants WHERE tenantId = ?', [tenantId]);
        return resolve(row ? row.cnt : 0);
      } catch (sqlErr) {
        return reject(new AppError(
          `Eroare la numărarea restaurantelor (SQL): ${sqlErr.message}`,
          500,
          'DB_COUNT_ERROR'
        ));
      }
    }

    // ---- NeDB ----
    restaurants.count({ tenantId }, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea restaurantelor: ${err.message}`,
          500,
          'DB_COUNT_ERROR'
        ));
      }
      resolve(count || 0);
    });
  });
}

/**
 * Obține numărul total de restaurante după status.
 * @param {string} status - Statusul
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<number>}
 */
function countRestaurantsByStatus(status, tenantId) {
  return new Promise((resolve, reject) => {
    if (!status || !isValidStatus(status)) {
      return reject(new AppError(
        `Statusul "${status}" nu este valid. Valorile permise: ${VALID_STATUSES.join(', ')}.`,
        400,
        'INVALID_STATUS'
      ));
    }

    // ---- SQLite ----
    if (_isSqlAvailable()) {
      try {
        let sql;
        const params = [status];

        if (tenantId) {
          sql = 'SELECT COUNT(*) AS cnt FROM restaurants WHERE status = ? AND tenantId = ?';
          params.push(tenantId);
        } else {
          sql = 'SELECT COUNT(*) AS cnt FROM restaurants WHERE status = ?';
        }

        const row = get(sql, params);
        return resolve(row ? row.cnt : 0);
      } catch (sqlErr) {
        return reject(new AppError(
          `Eroare la numărarea restaurantelor (SQL): ${sqlErr.message}`,
          500,
          'DB_COUNT_ERROR'
        ));
      }
    }

    // ---- NeDB ----
    const filter = { status };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    restaurants.count(filter, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea restaurantelor: ${err.message}`,
          500,
          'DB_COUNT_ERROR'
        ));
      }
      resolve(count || 0);
    });
  });
}

/**
 * Caută restaurante după nume (căutare parțială, case-insensitive).
 * @param {string} searchTerm - Termenul de căutare
 * @param {string} [tenantId] - Opțional, filtrează și după tenant
 * @returns {Promise<Array>} Lista de restaurante găsite
 */
function searchRestaurantsByName(searchTerm, tenantId) {
  return new Promise((resolve, reject) => {
    if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
      return reject(new AppError(
        'Termenul de căutare este invalid.',
        400,
        'INVALID_SEARCH_TERM'
      ));
    }

    const escapedTerm = searchTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // ---- SQLite ----
    if (_isSqlAvailable()) {
      try {
        let sql;
        const params = [`%${searchTerm.trim()}%`];

        if (tenantId) {
          sql = 'SELECT * FROM restaurants WHERE name LIKE ? AND tenantId = ? ORDER BY name ASC';
          params.push(tenantId);
        } else {
          sql = 'SELECT * FROM restaurants WHERE name LIKE ? ORDER BY name ASC';
        }

        const rows = all(sql, params);
        return resolve(rows.map((r) => _sqlRowToDoc(r)));
      } catch (sqlErr) {
        return reject(new AppError(
          `Eroare la căutarea restaurantelor (SQL): ${sqlErr.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
    }

    // ---- NeDB ----
    const regex = new RegExp(escapedTerm, 'i');

    const filter = { name: regex };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    restaurants.find(filter).sort({ name: 1 }).exec((err, restaurantList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea restaurantelor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(restaurantList || []);
    });
  });
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Validare
  isValidString,
  isValidPositiveInt,
  isValidStatus,
  isValidEmail,
  VALID_STATUSES,

  // Operații CRUD de bază
  createRestaurant,
  findRestaurantById,
  findRestaurantsByTenant,
  findRestaurantsByStatus,
  updateRestaurant,
  deleteRestaurant,

  // Operații specifice
  updateTableCount,
  updateRestaurantStatus,
  countRestaurantsByTenant,
  countRestaurantsByStatus,
  searchRestaurantsByName,

  // Expunere pentru testare și debugging
  _isSqlAvailable,
  _sqlRowToDoc,
  _ensureSqlSchema,
  _resetSqlMigrated: function () { _sqlMigrated = false; },
};