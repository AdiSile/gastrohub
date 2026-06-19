'use strict';

// ---------------------------------------------------------------------------
// Model Restaurant – GastroHub
// Definirea structurii, validărilor și operațiilor CRUD pentru configurarea
// unui restaurant (nume, adresă, nr. mese, tenant asociat).
// Câmpuri suportate: name, address, tableCount, tenantId, phone, email, status
// ---------------------------------------------------------------------------

const { restaurants } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Statusuri valide pentru un restaurant
// ---------------------------------------------------------------------------

const VALID_STATUSES = ['active', 'inactive', 'closed'];

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
// Operații CRUD – Restaurante
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

    // -----------------------------------------------------------------------
    // Creare document restaurant
    // -----------------------------------------------------------------------
    const restaurantDoc = {
      name: name.trim(),
      address: address.trim(),
      tableCount: finalTableCount,
      tenantId: tenantId,
      phone: phone || '',
      email: email ? email.toLowerCase().trim() : '',
      status: finalStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
 * @param {string} id - ID-ul NeDB
 * @returns {Promise<Object|null>} Documentul restaurantului sau null
 */
function findRestaurantById(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

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

    let query = restaurants.find({ tenantId });

    // Sortare
    if (options.sort) {
      query = query.sort(options.sort);
    } else {
      query = query.sort({ name: 1 });
    }

    // Limit
    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      query = query.limit(options.limit);
    }

    // Skip
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
          }
          break;

        case 'address':
          if (!isValidString(value, 5, 500)) {
            errors.push('Adresa restaurantului trebuie să aibă între 5 și 500 de caractere.');
          } else {
            setFields.address = value.trim();
          }
          break;

        case 'tableCount':
          if (!isValidPositiveInt(value)) {
            errors.push('Numărul de mese trebuie să fie un număr întreg, mai mare sau egal cu 0.');
          } else {
            setFields.tableCount = value;
          }
          break;

        case 'phone':
          if (value !== null && value !== undefined && typeof value !== 'string') {
            errors.push('Numărul de telefon trebuie să fie un șir de caractere.');
          } else {
            setFields.phone = value || '';
          }
          break;

        case 'email':
          if (value !== null && value !== undefined && value !== '' && !isValidEmail(value)) {
            errors.push('Adresa de email a restaurantului este invalidă.');
          } else {
            setFields.email = value ? value.toLowerCase().trim() : '';
          }
          break;

        case 'status':
          if (!isValidStatus(value)) {
            errors.push(`Statusul "${value}" nu este valid. Valorile permise: ${VALID_STATUSES.join(', ')}.`);
          } else {
            setFields.status = value;
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

    // -----------------------------------------------------------------------
    // Actualizare document
    // -----------------------------------------------------------------------
    setFields.updatedAt = new Date().toISOString();

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

    restaurants.update(
      { _id: id },
      {
        $set: {
          tableCount,
          updatedAt: new Date().toISOString(),
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

    restaurants.update(
      { _id: id },
      {
        $set: {
          status,
          updatedAt: new Date().toISOString(),
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

    // NeDB suportă regex pentru căutare parțială
    const regex = new RegExp(searchTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

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
};