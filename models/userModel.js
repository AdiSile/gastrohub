'use strict';

// ---------------------------------------------------------------------------
// Model User – GastroHub
// Definirea structurii, validărilor și operațiilor comune pentru un utilizator.
// Câmpuri suportate: email, password (hash), role, tenantId, restaurante asociate
// ---------------------------------------------------------------------------

const bcrypt = require('bcryptjs');
const { users } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Roluri valide în sistem
// ---------------------------------------------------------------------------

const VALID_ROLES = [
  'super_admin',
  'owner',
  'manager',
  'recepție',
  'ospătar',
  'bucătar',
  'client',
];

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un șir este o adresă de email validă (format simplu).
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  // Regex simplu pentru validare email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Verifică dacă un rol este valid.
 * @param {string} role
 * @returns {boolean}
 */
function isValidRole(role) {
  return VALID_ROLES.includes(role);
}

/**
 * Verifică dacă parola respectă cerințele minime de securitate:
 * - minim 6 caractere
 * - maxim 128 caractere
 * @param {string} password
 * @returns {boolean}
 */
function isValidPassword(password) {
  if (typeof password !== 'string') return false;
  return password.length >= 6 && password.length <= 128;
}

// ---------------------------------------------------------------------------
// Operații pe utilizatori
// ---------------------------------------------------------------------------

/**
 * Creează un utilizator nou în baza de date.
 * Password-ul este hashuit automat cu bcryptjs (salt rounds: 10).
 *
 * @param {Object} userData - Datele utilizatorului
 * @param {string} userData.email - Email unic
 * @param {string} userData.password - Parolă (plain text – va fi hashuită)
 * @param {string} [userData.role='client'] - Rolul utilizatorului
 * @param {string|null} [userData.tenantId=null] - ID-ul tenant-ului
 * @param {Array} [userData.restaurante=[]] - Listă de ID-uri restaurante asociate
 * @returns {Promise<Object>} Documentul utilizatorului (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
function createUser(userData) {
  return new Promise((resolve, reject) => {
    // -----------------------------------------------------------------------
    // Validare câmpuri obligatorii
    // -----------------------------------------------------------------------
    if (!userData || typeof userData !== 'object') {
      return reject(new AppError('Datele utilizatorului sunt invalide.', 400, 'INVALID_USER_DATA'));
    }

    const { email, password, role, tenantId, restaurante } = userData;

    // Validare email
    if (!email || !isValidEmail(email)) {
      return reject(new AppError('Adresa de email este invalidă.', 400, 'INVALID_EMAIL'));
    }

    // Validare parolă
    if (!password || !isValidPassword(password)) {
      return reject(new AppError(
        'Parola trebuie să aibă între 6 și 128 de caractere.',
        400,
        'INVALID_PASSWORD'
      ));
    }

    // Validare rol
    const finalRole = role || 'client';
    if (!isValidRole(finalRole)) {
      return reject(new AppError(`Rolul "${finalRole}" nu este valid.`, 400, 'INVALID_ROLE'));
    }

    // Validare tenantId – poate fi null, string sau number
    const finalTenantId = tenantId !== undefined ? tenantId : null;

    // Validare restaurante – trebuie să fie array
    const finalRestaurante = Array.isArray(restaurante) ? restaurante : [];

    // -----------------------------------------------------------------------
    // Creare document utilizator
    // -----------------------------------------------------------------------
    bcrypt.hash(password, 10, (hashErr, hashedPassword) => {
      if (hashErr) {
        return reject(new AppError('Eroare internă la hash-uirea parolei.', 500, 'HASH_ERROR'));
      }

      const userDoc = {
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: finalRole,
        tenantId: finalTenantId,
        restaurante: finalRestaurante,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      users.insert(userDoc, (insertErr, newUser) => {
        if (insertErr) {
          // Eroare de unicitate (email duplicat)
          if (insertErr.errorType === 'uniqueViolated') {
            return reject(new AppError(
              'Există deja un cont cu această adresă de email.',
              409,
              'DUPLICATE_EMAIL'
            ));
          }
          return reject(new AppError(
            `Eroare la crearea utilizatorului: ${insertErr.message}`,
            500,
            'DB_INSERT_ERROR'
          ));
        }

        // Returnăm utilizatorul fără parolă
        const safeUser = { ...newUser };
        delete safeUser.password;
        resolve(safeUser);
      });
    });
  });
}

/**
 * Găsește un utilizator după adresa de email.
 * @param {string} email
 * @returns {Promise<Object|null>} Documentul utilizatorului (cu tot cu password hash) sau null
 */
function findUserByEmail(email) {
  return new Promise((resolve, reject) => {
    if (!email || !isValidEmail(email)) {
      return reject(new AppError('Adresa de email este invalidă.', 400, 'INVALID_EMAIL'));
    }

    users.findOne({ email: email.toLowerCase().trim() }, (err, user) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea utilizatorului: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(user || null);
    });
  });
}

/**
 * Găsește un utilizator după ID-ul său.
 * @param {string} id - ID-ul NeDB
 * @returns {Promise<Object|null>} Documentul utilizatorului (cu tot cu password hash) sau null
 */
function findUserById(id) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul utilizatorului este invalid.', 400, 'INVALID_USER_ID'));
    }

    users.findOne({ _id: id }, (err, user) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea utilizatorului: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(user || null);
    });
  });
}

/**
 * Găsește toți utilizatorii dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>} Lista de utilizatori (fără password hash)
 */
function findUsersByTenant(tenantId) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    users.find({ tenantId }, (err, userList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea utilizatorilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      // Eliminăm parolele din rezultate
      const safeUsers = (userList || []).map((u) => {
        const safe = { ...u };
        delete safe.password;
        return safe;
      });

      resolve(safeUsers);
    });
  });
}

/**
 * Găsește toți utilizatorii după un rol specific.
 * @param {string} role - Rolul căutat
 * @returns {Promise<Array>} Lista de utilizatori (fără password hash)
 */
function findUsersByRole(role) {
  return new Promise((resolve, reject) => {
    if (!role || !isValidRole(role)) {
      return reject(new AppError(`Rolul "${role}" nu este valid.`, 400, 'INVALID_ROLE'));
    }

    users.find({ role }, (err, userList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea utilizatorilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      const safeUsers = (userList || []).map((u) => {
        const safe = { ...u };
        delete safe.password;
        return safe;
      });

      resolve(safeUsers);
    });
  });
}

/**
 * Verifică dacă o parolă corespunde hash-ului stocat.
 * @param {string} plainPassword - Parola în clar
 * @param {string} hashedPassword - Hash-ul stocat
 * @returns {Promise<boolean>}
 */
function comparePassword(plainPassword, hashedPassword) {
  return new Promise((resolve, reject) => {
    if (!plainPassword || !hashedPassword) {
      return resolve(false);
    }

    bcrypt.compare(plainPassword, hashedPassword, (err, result) => {
      if (err) {
        return reject(new AppError('Eroare la verificarea parolei.', 500, 'BCRYPT_ERROR'));
      }
      resolve(result);
    });
  });
}

/**
 * Actualizează parola unui utilizator.
 * @param {string} userId - ID-ul utilizatorului
 * @param {string} newPassword - Noua parolă (plain text)
 * @returns {Promise<Object>} Utilizatorul actualizat (fără password hash)
 */
function updatePassword(userId, newPassword) {
  return new Promise((resolve, reject) => {
    if (!userId) {
      return reject(new AppError('ID-ul utilizatorului este invalid.', 400, 'INVALID_USER_ID'));
    }

    if (!newPassword || !isValidPassword(newPassword)) {
      return reject(new AppError(
        'Parola trebuie să aibă între 6 și 128 de caractere.',
        400,
        'INVALID_PASSWORD'
      ));
    }

    bcrypt.hash(newPassword, 10, (hashErr, hashedPassword) => {
      if (hashErr) {
        return reject(new AppError('Eroare internă la hash-uirea parolei.', 500, 'HASH_ERROR'));
      }

      users.update(
        { _id: userId },
        { $set: { password: hashedPassword, updatedAt: new Date().toISOString() } },
        { returnUpdatedDocs: true },
        (updateErr, numUpdated, updatedUser) => {
          if (updateErr) {
            return reject(new AppError(
              `Eroare la actualizarea parolei: ${updateErr.message}`,
              500,
              'DB_UPDATE_ERROR'
            ));
          }

          if (numUpdated === 0) {
            return reject(new AppError('Utilizatorul nu a fost găsit.', 404, 'USER_NOT_FOUND'));
          }

          const safeUser = { ...updatedUser };
          delete safeUser.password;
          resolve(safeUser);
        }
      );
    });
  });
}

/**
 * Actualizează rolul unui utilizator.
 * @param {string} userId - ID-ul utilizatorului
 * @param {string} newRole - Noul rol
 * @returns {Promise<Object>} Utilizatorul actualizat (fără password hash)
 */
function updateRole(userId, newRole) {
  return new Promise((resolve, reject) => {
    if (!userId) {
      return reject(new AppError('ID-ul utilizatorului este invalid.', 400, 'INVALID_USER_ID'));
    }

    if (!newRole || !isValidRole(newRole)) {
      return reject(new AppError(`Rolul "${newRole}" nu este valid.`, 400, 'INVALID_ROLE'));
    }

    users.update(
      { _id: userId },
      { $set: { role: newRole, updatedAt: new Date().toISOString() } },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedUser) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea rolului: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Utilizatorul nu a fost găsit.', 404, 'USER_NOT_FOUND'));
        }

        const safeUser = { ...updatedUser };
        delete safeUser.password;
        resolve(safeUser);
      }
    );
  });
}

/**
 * Asociază restaurante la un utilizator.
 * @param {string} userId - ID-ul utilizatorului
 * @param {Array} restaurantIds - Lista de ID-uri restaurante
 * @returns {Promise<Object>} Utilizatorul actualizat (fără password hash)
 */
function addRestaurante(userId, restaurantIds) {
  return new Promise((resolve, reject) => {
    if (!userId) {
      return reject(new AppError('ID-ul utilizatorului este invalid.', 400, 'INVALID_USER_ID'));
    }

    if (!Array.isArray(restaurantIds) || restaurantIds.length === 0) {
      return reject(new AppError(
        'Lista de restaurante este invalidă sau goală.',
        400,
        'INVALID_RESTAURANT_LIST'
      ));
    }

    users.update(
      { _id: userId },
      { $addToSet: { restaurante: { $each: restaurantIds } }, $set: { updatedAt: new Date().toISOString() } },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedUser) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la asocierea restaurantelor: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Utilizatorul nu a fost găsit.', 404, 'USER_NOT_FOUND'));
        }

        const safeUser = { ...updatedUser };
        delete safeUser.password;
        resolve(safeUser);
      }
    );
  });
}

/**
 * Șterge un utilizator după ID.
 * @param {string} userId - ID-ul utilizatorului
 * @returns {Promise<boolean>} true dacă a fost șters
 */
function deleteUser(userId) {
  return new Promise((resolve, reject) => {
    if (!userId) {
      return reject(new AppError('ID-ul utilizatorului este invalid.', 400, 'INVALID_USER_ID'));
    }

    users.remove({ _id: userId }, {}, (removeErr, numRemoved) => {
      if (removeErr) {
        return reject(new AppError(
          `Eroare la ștergerea utilizatorului: ${removeErr.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      if (numRemoved === 0) {
        return reject(new AppError('Utilizatorul nu a fost găsit.', 404, 'USER_NOT_FOUND'));
      }

      resolve(true);
    });
  });
}

/**
 * Obține numărul total de utilizatori dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>}
 */
function countUsersByTenant(tenantId) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return resolve(0);
    }

    users.count({ tenantId }, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea utilizatorilor: ${err.message}`,
          500,
          'DB_COUNT_ERROR'
        ));
      }
      resolve(count || 0);
    });
  });
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Validare
  isValidEmail,
  isValidRole,
  isValidPassword,
  VALID_ROLES,

  // Operații CRUD
  createUser,
  findUserByEmail,
  findUserById,
  findUsersByTenant,
  findUsersByRole,
  deleteUser,

  // Operații specifice
  comparePassword,
  updatePassword,
  updateRole,
  addRestaurante,
  countUsersByTenant,
};