'use strict';

// ---------------------------------------------------------------------------
// Model Customer – GastroHub
// Model pentru gestionarea clienților și autentificarea portalului.
// Suportă: înregistrare clienți, autentificare portal, gestionare profil,
// istoric comenzi/rezervări, adrese livrare, preferințe.
// Câmpuri suportate: email, password (hash), nume, telefon, adrese,
// preferințe, dataÎnregistrării, ultimaAutentificare, status, tenantId
// ---------------------------------------------------------------------------

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Statusuri valide pentru un client
// ---------------------------------------------------------------------------

const VALID_CUSTOMER_STATUSES = ['active', 'inactive', 'suspended', 'deleted'];

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un șir nu este gol și are lungimea între limite.
 * @param {*} val - Valoarea de verificat
 * @param {number} [min=1] - Lungimea minimă
 * @param {number} [max=255] - Lungimea maximă
 * @returns {boolean}
 */
function isValidString(val, min = 1, max = 255) {
  return typeof val === 'string' && val.trim().length >= min && val.trim().length <= max;
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

/**
 * Verifică dacă un număr de telefon este valid (format românesc sau internațional simplu).
 * @param {string} telefon
 * @returns {boolean}
 */
function isValidPhone(telefon) {
  if (typeof telefon !== 'string') return false;
  const phoneRegex = /^[+]?[\d\s\-/()]{7,20}$/;
  return phoneRegex.test(telefon.trim());
}

/**
 * Verifică dacă un status de client este valid.
 * @param {string} status
 * @returns {boolean}
 */
function isValidCustomerStatus(status) {
  return VALID_CUSTOMER_STATUSES.includes(status);
}

/**
 * Verifică dacă o valoare este un număr pozitiv.
 * @param {*} val
 * @returns {boolean}
 */
function isValidPositiveNumber(val) {
  return typeof val === 'number' && !Number.isNaN(val) && val >= 0 && Number.isFinite(val);
}

// ---------------------------------------------------------------------------
// Funcții de inițializare a colecției per-tenant
// ---------------------------------------------------------------------------

/**
 * Obține colecția NeDB pentru clienții unui tenant.
 * Folosește baza de date per-tenant din config/tenant.js.
 * @param {string} tenantId
 * @returns {Datastore}
 */
function getCustomersDb(tenantId) {
  const { getTenantDb } = require('../config/tenant');
  return getTenantDb(tenantId);
}

// ---------------------------------------------------------------------------
// Operații CRUD – Customers
// ---------------------------------------------------------------------------

/**
 * Creează un client nou (înregistrare portal).
 * Password-ul este hashuit automat cu bcryptjs (salt rounds: 10).
 *
 * @param {Object} customerData - Datele clientului
 * @param {string} customerData.email - Email unic (obligatoriu)
 * @param {string} customerData.password - Parolă (plain text – va fi hashuită) (obligatoriu)
 * @param {string} customerData.nume - Numele complet (obligatoriu)
 * @param {string} [customerData.telefon=''] - Număr de telefon
 * @param {Array} [customerData.adrese=[]] - Lista de adrese
 * @param {Object} [customerData.preferinte={}] - Preferințe client
 * @param {string} [customerData.status='active'] - Statusul clientului
 * @param {string} customerData.tenantId - ID-ul tenant-ului (obligatoriu)
 * @param {string} [customerData.restaurantId] - ID-ul restaurantului preferat
 * @param {string} [customerData.hotelId] - ID-ul hotelului preferat
 * @returns {Promise<Object>} Documentul clientului creat (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
function createCustomer(customerData) {
  return new Promise((resolve, reject) => {
    // -----------------------------------------------------------------------
    // Validare date de bază
    // -----------------------------------------------------------------------
    if (!customerData || typeof customerData !== 'object') {
      return reject(new AppError('Datele clientului sunt invalide.', 400, 'INVALID_CUSTOMER_DATA'));
    }

    const {
      email,
      password,
      nume,
      telefon,
      adrese,
      preferinte,
      status,
      tenantId,
      restaurantId,
      hotelId,
    } = customerData;

    // Validare tenantId
    if (!tenantId) {
      return reject(new AppError(
        'ID-ul tenant-ului este obligatoriu.',
        400,
        'MISSING_TENANT_ID'
      ));
    }

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

    // Validare nume
    if (!nume || !isValidString(nume, 2, 200)) {
      return reject(new AppError(
        'Numele clientului trebuie să aibă între 2 și 200 de caractere.',
        400,
        'INVALID_CUSTOMER_NAME'
      ));
    }

    // Validare telefon (opțional)
    const finalTelefon = telefon || '';
    if (finalTelefon && !isValidPhone(finalTelefon)) {
      return reject(new AppError(
        'Numărul de telefon este invalid.',
        400,
        'INVALID_PHONE'
      ));
    }

    // Validare adrese (opțional)
    const finalAdrese = Array.isArray(adrese) ? adrese : [];
    if (finalAdrese.length > 0) {
      for (let i = 0; i < finalAdrese.length; i++) {
        const adresa = finalAdrese[i];
        if (!adresa || typeof adresa !== 'object') {
          return reject(new AppError(
            `Adresa #${i + 1} este invalidă.`,
            400,
            'INVALID_ADDRESS'
          ));
        }
        if (!adresa.denumire || !isValidString(adresa.denumire, 1, 100)) {
          return reject(new AppError(
            `Adresa #${i + 1}: denumirea este obligatorie (max 100 caractere).`,
            400,
            'INVALID_ADDRESS_NAME'
          ));
        }
        if (!adresa.adresa || !isValidString(adresa.adresa, 5, 500)) {
          return reject(new AppError(
            `Adresa #${i + 1}: adresa completă este obligatorie (min 5, max 500 caractere).`,
            400,
            'INVALID_ADDRESS_FULL'
          ));
        }
        if (adresa.oras && !isValidString(adresa.oras, 1, 100)) {
          return reject(new AppError(
            `Adresa #${i + 1}: orașul poate avea maximum 100 de caractere.`,
            400,
            'INVALID_ADDRESS_CITY'
          ));
        }
        if (adresa.codPostal && !isValidString(adresa.codPostal, 1, 20)) {
          return reject(new AppError(
            `Adresa #${i + 1}: codul poștal poate avea maximum 20 de caractere.`,
            400,
            'INVALID_ADDRESS_ZIP'
          ));
        }
        if (adresa.tara && !isValidString(adresa.tara, 1, 100)) {
          return reject(new AppError(
            `Adresa #${i + 1}: țara poate avea maximum 100 de caractere.`,
            400,
            'INVALID_ADDRESS_COUNTRY'
          ));
        }
      }
    }

    // Validare preferințe (opțional)
    const finalPreferinte = preferinte && typeof preferinte === 'object' && !Array.isArray(preferinte)
      ? preferinte
      : {};

    // Validare status (opțional)
    const finalStatus = status || 'active';
    if (!isValidCustomerStatus(finalStatus)) {
      return reject(new AppError(
        `Statusul "${finalStatus}" nu este valid. Statusuri permise: ${VALID_CUSTOMER_STATUSES.join(', ')}.`,
        400,
        'INVALID_CUSTOMER_STATUS'
      ));
    }

    // -----------------------------------------------------------------------
    // Verificare dacă email-ul există deja în acest tenant
    // -----------------------------------------------------------------------
    const customersDb = getCustomersDb(tenantId);
    customersDb.findOne({ email: email.toLowerCase().trim(), tenantId }, (findErr, existingCustomer) => {
      if (findErr) {
        return reject(new AppError(
          `Eroare la verificarea email-ului: ${findErr.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      if (existingCustomer) {
        return reject(new AppError(
          'Există deja un client cu această adresă de email în acest tenant.',
          409,
          'DUPLICATE_EMAIL'
        ));
      }

      // -----------------------------------------------------------------------
      // Hash parolă
      // -----------------------------------------------------------------------
      bcrypt.hash(password, 10, (hashErr, hashedPassword) => {
        if (hashErr) {
          return reject(new AppError('Eroare internă la hash-uirea parolei.', 500, 'HASH_ERROR'));
        }

        // -----------------------------------------------------------------------
        // Creare document client
        // -----------------------------------------------------------------------
        const now = new Date().toISOString();

        const customerDoc = {
          email: email.toLowerCase().trim(),
          password: hashedPassword,
          nume: nume.trim(),
          telefon: finalTelefon,
          adrese: finalAdrese,
          preferinte: finalPreferinte,
          status: finalStatus,
          tenantId,
          restaurantId: restaurantId || null,
          hotelId: hotelId || null,
          ultimaAutentificare: null,
          dataInregistrarii: now,
          createdAt: now,
          updatedAt: now,
        };

        customersDb.insert(customerDoc, (insertErr, newCustomer) => {
          if (insertErr) {
            return reject(new AppError(
              `Eroare la crearea clientului: ${insertErr.message}`,
              500,
              'DB_INSERT_ERROR'
            ));
          }

          // Returnăm clientul fără parolă
          const safeCustomer = { ...newCustomer };
          delete safeCustomer.password;
          resolve(safeCustomer);
        });
      });
    });
  });
}

/**
 * Găsește un client după ID.
 * @param {string} id - ID-ul NeDB
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object|null>} Documentul clientului (cu tot cu password hash) sau null
 */
function findCustomerById(id, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const customersDb = getCustomersDb(tenantId);
    customersDb.findOne({ _id: id, tenantId }, (err, customer) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea clientului: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(customer || null);
    });
  });
}

/**
 * Găsește un client după adresa de email (în cadrul unui tenant).
 * @param {string} email - Adresa de email
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object|null>} Documentul clientului (cu tot cu password hash) sau null
 */
function findCustomerByEmail(email, tenantId) {
  return new Promise((resolve, reject) => {
    if (!email || !isValidEmail(email)) {
      return reject(new AppError('Adresa de email este invalidă.', 400, 'INVALID_EMAIL'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const customersDb = getCustomersDb(tenantId);
    customersDb.findOne({ email: email.toLowerCase().trim(), tenantId }, (err, customer) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea clientului după email: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(customer || null);
    });
  });
}

/**
 * Găsește toți clienții dintr-un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni de căutare (sort, limit, skip, status)
 * @returns {Promise<Array>} Lista de clienți (fără password hash)
 */
function findCustomersByTenant(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const filter = { tenantId };

    // Filtrare opțională după status
    if (options.status) {
      if (!isValidCustomerStatus(options.status)) {
        return reject(new AppError(
          `Statusul "${options.status}" nu este valid. Statusuri permise: ${VALID_CUSTOMER_STATUSES.join(', ')}.`,
          400,
          'INVALID_CUSTOMER_STATUS'
        ));
      }
      filter.status = options.status;
    }

    const customersDb = getCustomersDb(tenantId);
    let query = customersDb.find(filter);

    // Sortare
    if (options.sort) {
      query = query.sort(options.sort);
    } else {
      query = query.sort({ dataInregistrarii: -1 });
    }

    // Limit
    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      query = query.limit(options.limit);
    }

    // Skip
    if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
      query = query.skip(options.skip);
    }

    query.exec((err, customerList) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea clienților: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      // Eliminăm parolele din rezultate
      const safeCustomers = (customerList || []).map((c) => {
        const safe = { ...c };
        delete safe.password;
        return safe;
      });

      resolve(safeCustomers);
    });
  });
}

/**
 * Caută clienți după nume (căutare parțială, case-insensitive).
 * @param {string} searchTerm - Termenul de căutare
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>} Lista de clienți găsiți (fără password hash)
 */
function searchCustomersByName(searchTerm, tenantId) {
  return new Promise((resolve, reject) => {
    if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
      return reject(new AppError(
        'Termenul de căutare este invalid.',
        400,
        'INVALID_SEARCH_TERM'
      ));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const regex = new RegExp(searchTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const customersDb = getCustomersDb(tenantId);
    customersDb.find({ tenantId, nume: regex })
      .sort({ nume: 1 })
      .exec((err, customerList) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea clienților: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        const safeCustomers = (customerList || []).map((c) => {
          const safe = { ...c };
          delete safe.password;
          return safe;
        });

        resolve(safeCustomers);
      });
  });
}

/**
 * Caută clienți după număr de telefon.
 * @param {string} telefon - Numărul de telefon căutat
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>} Lista de clienți găsiți (fără password hash)
 */
function searchCustomersByPhone(telefon, tenantId) {
  return new Promise((resolve, reject) => {
    if (!telefon || !isValidPhone(telefon)) {
      return reject(new AppError(
        'Numărul de telefon este invalid.',
        400,
        'INVALID_PHONE'
      ));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const customersDb = getCustomersDb(tenantId);
    customersDb.find({ tenantId, telefon })
      .sort({ nume: 1 })
      .exec((err, customerList) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea clienților după telefon: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        const safeCustomers = (customerList || []).map((c) => {
          const safe = { ...c };
          delete safe.password;
          return safe;
        });

        resolve(safeCustomers);
      });
  });
}

// ---------------------------------------------------------------------------
// Operații de autentificare portal
// ---------------------------------------------------------------------------

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
 * Autentifică un client pe portal (verifică email + parolă).
 * @param {string} email - Adresa de email
 * @param {string} password - Parola în clar
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Clientul autentificat (fără password hash)
 * @throws {AppError} Dacă autentificarea eșuează
 */
function authenticateCustomer(email, password, tenantId) {
  return new Promise((resolve, reject) => {
    if (!email || !isValidEmail(email)) {
      return reject(new AppError('Adresa de email este invalidă.', 400, 'INVALID_EMAIL'));
    }

    if (!password || !isValidPassword(password)) {
      return reject(new AppError(
        'Parola trebuie să aibă între 6 și 128 de caractere.',
        400,
        'INVALID_PASSWORD'
      ));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const customersDb = getCustomersDb(tenantId);
    customersDb.findOne({ email: email.toLowerCase().trim(), tenantId }, (err, customer) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea clientului: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      if (!customer) {
        return reject(new AppError(
          'Email sau parolă incorectă.',
          401,
          'INVALID_CREDENTIALS'
        ));
      }

      // Verificare status
      if (customer.status === 'suspended') {
        return reject(new AppError(
          'Contul tău a fost suspendat. Contactează administrația.',
          403,
          'ACCOUNT_SUSPENDED'
        ));
      }

      if (customer.status === 'deleted') {
        return reject(new AppError(
          'Contul tău a fost dezactivat.',
          403,
          'ACCOUNT_DELETED'
        ));
      }

      // Verificare parolă
      bcrypt.compare(password, customer.password, (compareErr, isMatch) => {
        if (compareErr) {
          return reject(new AppError('Eroare la verificarea parolei.', 500, 'BCRYPT_ERROR'));
        }

        if (!isMatch) {
          return reject(new AppError(
            'Email sau parolă incorectă.',
            401,
            'INVALID_CREDENTIALS'
          ));
        }

        // Actualizăm ultima autentificare
        const now = new Date().toISOString();
        customersDb.update(
          { _id: customer._id },
          { $set: { ultimaAutentificare: now, updatedAt: now } },
          {},
          (updateErr) => {
            if (updateErr) {
              // Non-fatal – log doar
              console.error('[customerModel] Eroare la actualizarea ultimei autentificări:', updateErr.message);
            }
          }
        );

        // Returnăm clientul fără parolă
        const safeCustomer = { ...customer };
        delete safeCustomer.password;
        safeCustomer.ultimaAutentificare = now;
        resolve(safeCustomer);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Operații de actualizare profil
// ---------------------------------------------------------------------------

/**
 * Actualizează profilul unui client (câmpuri permise: nume, telefon, adrese, preferințe).
 * @param {string} id - ID-ul clientului
 * @param {Object} updateData - Câmpurile de actualizat
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Clientul actualizat (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
function updateCustomerProfile(id, updateData, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
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
    const allowedFields = ['nume', 'telefon', 'adrese', 'preferinte', 'restaurantId', 'hotelId'];
    const setFields = {};
    const errors = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (!allowedFields.includes(key)) {
        continue; // Ignorăm câmpurile nepermise
      }

      switch (key) {
        case 'nume':
          if (!isValidString(value, 2, 200)) {
            errors.push('Numele clientului trebuie să aibă între 2 și 200 de caractere.');
          } else {
            setFields.nume = value.trim();
          }
          break;

        case 'telefon':
          if (value && !isValidPhone(value)) {
            errors.push('Numărul de telefon este invalid.');
          } else {
            setFields.telefon = value || '';
          }
          break;

        case 'adrese':
          if (!Array.isArray(value)) {
            errors.push('Adresele trebuie să fie o listă.');
          } else {
            const adreseErrors = [];
            for (let i = 0; i < value.length; i++) {
              const adresa = value[i];
              if (!adresa || typeof adresa !== 'object') {
                adreseErrors.push(`Adresa #${i + 1} este invalidă.`);
                continue;
              }
              if (!adresa.denumire || !isValidString(adresa.denumire, 1, 100)) {
                adreseErrors.push(`Adresa #${i + 1}: denumirea este obligatorie (max 100 caractere).`);
              }
              if (!adresa.adresa || !isValidString(adresa.adresa, 5, 500)) {
                adreseErrors.push(`Adresa #${i + 1}: adresa completă este obligatorie (min 5, max 500 caractere).`);
              }
              if (adresa.oras && !isValidString(adresa.oras, 1, 100)) {
                adreseErrors.push(`Adresa #${i + 1}: orașul poate avea maximum 100 de caractere.`);
              }
              if (adresa.codPostal && !isValidString(adresa.codPostal, 1, 20)) {
                adreseErrors.push(`Adresa #${i + 1}: codul poștal poate avea maximum 20 de caractere.`);
              }
              if (adresa.tara && !isValidString(adresa.tara, 1, 100)) {
                adreseErrors.push(`Adresa #${i + 1}: țara poate avea maximum 100 de caractere.`);
              }
            }
            if (adreseErrors.length > 0) {
              errors.push(adreseErrors.join(' '));
            } else {
              setFields.adrese = value;
            }
          }
          break;

        case 'preferinte':
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            errors.push('Preferințele trebuie să fie un obiect valid.');
          } else {
            setFields.preferinte = value;
          }
          break;

        case 'restaurantId':
          setFields.restaurantId = value || null;
          break;

        case 'hotelId':
          setFields.hotelId = value || null;
          break;

        // No default
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

    const customersDb = getCustomersDb(tenantId);
    customersDb.update(
      { _id: id, tenantId },
      { $set: setFields },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedCustomer) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea profilului clientului: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND'));
        }

        const safeCustomer = { ...updatedCustomer };
        delete safeCustomer.password;
        resolve(safeCustomer);
      }
    );
  });
}

/**
 * Actualizează parola unui client.
 * @param {string} id - ID-ul clientului
 * @param {string} currentPassword - Parola curentă (pentru verificare)
 * @param {string} newPassword - Noua parolă
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Clientul actualizat (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
function updateCustomerPassword(id, currentPassword, newPassword, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    if (!currentPassword) {
      return reject(new AppError('Parola curentă este obligatorie.', 400, 'MISSING_CURRENT_PASSWORD'));
    }

    if (!newPassword || !isValidPassword(newPassword)) {
      return reject(new AppError(
        'Noua parolă trebuie să aibă între 6 și 128 de caractere.',
        400,
        'INVALID_PASSWORD'
      ));
    }

    const customersDb = getCustomersDb(tenantId);
    customersDb.findOne({ _id: id, tenantId }, (findErr, customer) => {
      if (findErr) {
        return reject(new AppError(
          `Eroare la căutarea clientului: ${findErr.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      if (!customer) {
        return reject(new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND'));
      }

      // Verificare parolă curentă
      bcrypt.compare(currentPassword, customer.password, (compareErr, isMatch) => {
        if (compareErr) {
          return reject(new AppError('Eroare la verificarea parolei curente.', 500, 'BCRYPT_ERROR'));
        }

        if (!isMatch) {
          return reject(new AppError('Parola curentă este incorectă.', 400, 'WRONG_CURRENT_PASSWORD'));
        }

        // Hash parola nouă
        bcrypt.hash(newPassword, 10, (hashErr, hashedPassword) => {
          if (hashErr) {
            return reject(new AppError('Eroare internă la hash-uirea parolei.', 500, 'HASH_ERROR'));
          }

          customersDb.update(
            { _id: id },
            {
              $set: {
                password: hashedPassword,
                updatedAt: new Date().toISOString(),
              },
            },
            { returnUpdatedDocs: true },
            (updateErr, numUpdated, updatedCustomer) => {
              if (updateErr) {
                return reject(new AppError(
                  `Eroare la actualizarea parolei: ${updateErr.message}`,
                  500,
                  'DB_UPDATE_ERROR'
                ));
              }

              if (numUpdated === 0) {
                return reject(new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND'));
              }

              const safeCustomer = { ...updatedCustomer };
              delete safeCustomer.password;
              resolve(safeCustomer);
            }
          );
        });
      });
    });
  });
}

/**
 * Resetează parola unui client (fără verificare parolă curentă – folosit de admin).
 * @param {string} id - ID-ul clientului
 * @param {string} newPassword - Noua parolă
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Clientul actualizat (fără password hash)
 * @throws {AppError} Dacă validarea eșuează
 */
function resetCustomerPassword(id, newPassword, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul clientului este invalid.', 400, 'INVALID_CUSTOMER_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
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

      const customersDb = getCustomersDb(tenantId);
      customersDb.update(
        { _id: id, tenantId },
        {
          $set: {
            password: hashedPassword,
            updatedAt: new Date().toISOString(),
          },
        },
        { returnUpdatedDocs: true },
        (updateErr, numUpdated, updatedCustomer) => {
          if (updateErr) {
            return reject(new AppError(
              `Eroare la resetarea parolei: ${updateErr.message}`,
              500,
              'DB_UPDATE_ERROR'
            ));
          }

          if (numUpdated === 0) {
            return reject(new AppError('Clientul nu a fost găsit.', 404, 'CUSTOMER_NOT_FOUND'));
          }

          const safeCustomer = { ...updatedCustomer };
          delete safeCustomer.password;
          resolve(safeCustomer);
        }
      );
    });
  });
}

/**
 * Actualizează statusul unui client (activ/inactiv/suspendat/șters).
 * @param {string} id - ID-ul clientului
 *