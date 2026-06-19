'use strict';

// ---------------------------------------------------------------------------
// Model HR (Human Resources) – GastroHub
// Model pentru pontaj angajați (check-in/out) și salarii brute.
// Câmpuri: employeeId, type (checkIn/checkOut), timestamp, locationId,
//          locationType, note, userId, tenantId, salaryData, createdAt
//
// Compatibilitate: config/db.js (NeDB) – colecțiile attendance și salaries.
// ---------------------------------------------------------------------------

const { AppError } = require('../middleware/errorHandler');
const { attendance, salaries } = require('../config/db');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

const VALID_ATTENDANCE_TYPES = ['checkIn', 'checkOut'];

const VALID_LOCATION_TYPES = ['restaurant', 'hotel', 'depozit', 'birou'];

const VALID_CURRENCIES = ['RON', 'EUR', 'USD'];

const VALID_SALARY_STATUS = ['necalculat', 'calculat', 'aprobat', 'plătit'];

const VALID_PAYMENT_FREQUENCIES = ['lunar', 'săptămânal', 'zilnic'];

// ---------------------------------------------------------------------------
// Funcții de validare – generale
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un ID este un șir nevid.
 * @param {*} id
 * @returns {boolean}
 */
function isValidId(id) {
  return typeof id === 'string' && id.trim().length > 0;
}

/**
 * Verifică dacă un tip de pontaj este valid.
 * @param {string} type
 * @returns {boolean}
 */
function isValidAttendanceType(type) {
  return VALID_ATTENDANCE_TYPES.includes(type);
}

/**
 * Verifică dacă un tip de locație este valid.
 * @param {string} locationType
 * @returns {boolean}
 */
function isValidLocationType(locationType) {
  return VALID_LOCATION_TYPES.includes(locationType);
}

/**
 * Verifică dacă o monedă este validă.
 * @param {string} currency
 * @returns {boolean}
 */
function isValidCurrency(currency) {
  return VALID_CURRENCIES.includes(currency);
}

/**
 * Verifică dacă un status salarial este valid.
 * @param {string} status
 * @returns {boolean}
 */
function isValidSalaryStatus(status) {
  return VALID_SALARY_STATUS.includes(status);
}

/**
 * Verifică dacă o frecvență de plată este validă.
 * @param {string} frequency
 * @returns {boolean}
 */
function isValidPaymentFrequency(frequency) {
  return VALID_PAYMENT_FREQUENCIES.includes(frequency);
}

/**
 * Verifică dacă o valoare numerică este pozitivă.
 * @param {*} value
 * @returns {boolean}
 */
function isPositiveNumber(value) {
  return typeof value === 'number' && !isNaN(value) && value > 0;
}

/**
 * Verifică dacă o valoare numerică este nenegativă.
 * @param {*} value
 * @returns {boolean}
 */
function isNonNegativeNumber(value) {
  return typeof value === 'number' && !isNaN(value) && value >= 0;
}

// ---------------------------------------------------------------------------
// Funcții de validare – pontaj (attendance)
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un timestamp este un șir ISO valid.
 * @param {string} ts
 * @returns {boolean}
 */
function isValidTimestamp(ts) {
  if (typeof ts !== 'string') return false;
  const date = new Date(ts);
  return !isNaN(date.getTime());
}

/**
 * Validează datele pentru un eveniment de pontaj.
 * @param {Object} data
 * @returns {string|null} Mesaj de eroare sau null dacă e valid
 */
function validateAttendanceData(data) {
  if (!data || typeof data !== 'object') {
    return 'Datele de pontaj sunt invalide.';
  }

  const { employeeId, type, timestamp, locationId, locationType, userId, tenantId } = data;

  if (!employeeId || !isValidId(employeeId)) {
    return 'ID-ul angajatului este obligatoriu și trebuie să fie un șir nevid.';
  }

  if (!type || !isValidAttendanceType(type)) {
    return `Tipul de pontaj "${type}" nu este valid. Tipuri acceptate: ${VALID_ATTENDANCE_TYPES.join(', ')}.`;
  }

  if (!timestamp || !isValidTimestamp(timestamp)) {
    return 'Timestamp-ul este obligatoriu și trebuie să fie o dată ISO validă.';
  }

  if (locationId && !isValidId(locationId)) {
    return 'ID-ul locației, dacă este furnizat, trebuie să fie un șir nevid.';
  }

  if (locationType && !isValidLocationType(locationType)) {
    return `Tipul locației "${locationType}" nu este valid. Tipuri acceptate: ${VALID_LOCATION_TYPES.join(', ')}.`;
  }

  if (!userId || !isValidId(userId)) {
    return 'ID-ul utilizatorului care înregistrează pontajul este obligatoriu.';
  }

  if (!tenantId || !isValidId(tenantId)) {
    return 'ID-ul tenant-ului este obligatoriu.';
  }

  return null;
}

/**
 * Validează datele pentru o fișă de salariu.
 * @param {Object} data
 * @returns {string|null} Mesaj de eroare sau null dacă e valid
 */
function validateSalaryData(data) {
  if (!data || typeof data !== 'object') {
    return 'Datele salariale sunt invalide.';
  }

  const {
    employeeId,
    grossAmount,
    currency,
    period,
    paymentFrequency,
    tenantId,
  } = data;

  if (!employeeId || !isValidId(employeeId)) {
    return 'ID-ul angajatului este obligatoriu și trebuie să fie un șir nevid.';
  }

  if (grossAmount !== undefined && grossAmount !== null && !isPositiveNumber(grossAmount)) {
    return 'Salariul brut trebuie să fie un număr mai mare decât 0.';
  }

  if (currency && !isValidCurrency(currency)) {
    return `Moneda "${currency}" nu este validă. Monede acceptate: ${VALID_CURRENCIES.join(', ')}.`;
  }

  if (period && typeof period !== 'string') {
    return 'Perioada salarială trebuie să fie un șir de caractere (ex: "2025-01").';
  }

  if (paymentFrequency && !isValidPaymentFrequency(paymentFrequency)) {
    return `Frecvența de plată "${paymentFrequency}" nu este validă. Frecvențe acceptate: ${VALID_PAYMENT_FREQUENCIES.join(', ')}.`;
  }

  if (!tenantId || !isValidId(tenantId)) {
    return 'ID-ul tenant-ului este obligatoriu.';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Operații CRUD – Pontaj (Attendance)
// ---------------------------------------------------------------------------

/**
 * Înregistrează un eveniment de pontaj (check-in sau check-out).
 *
 * @param {Object} attendanceData - Datele evenimentului
 * @param {string} attendanceData.employeeId - ID-ul angajatului
 * @param {string} attendanceData.type - Tipul: 'checkIn' | 'checkOut'
 * @param {string} attendanceData.timestamp - Momentul evenimentului (ISO string)
 * @param {string} [attendanceData.locationId] - ID-ul locației (opțional)
 * @param {string} [attendanceData.locationType] - Tipul locației (opțional)
 * @param {string} [attendanceData.note] - Notă opțională
 * @param {string} attendanceData.userId - ID-ul utilizatorului care înregistrează
 * @param {string} attendanceData.tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Documentul de pontaj creat
 * @throws {AppError} Dacă validarea eșuează
 */
function createAttendanceRecord(attendanceData) {
  return new Promise((resolve, reject) => {
    const validationError = validateAttendanceData(attendanceData);
    if (validationError) {
      return reject(new AppError(validationError, 400, 'INVALID_ATTENDANCE_DATA'));
    }

    const {
      employeeId,
      type,
      timestamp,
      locationId,
      locationType,
      note,
      userId,
      tenantId,
    } = attendanceData;

    const now = new Date().toISOString();

    const attendanceDoc = {
      employeeId: employeeId.trim(),
      type,
      timestamp,
      locationId: locationId ? locationId.trim() : null,
      locationType: locationType || null,
      note: note !== undefined ? String(note).trim() : '',
      userId: userId.trim(),
      tenantId: tenantId.trim(),
      createdAt: now,
    };

    attendance.insert(attendanceDoc, (insertErr, newRecord) => {
      if (insertErr) {
        return reject(new AppError(
          `Eroare la înregistrarea pontajului: ${insertErr.message}`,
          500,
          'DB_INSERT_ERROR'
        ));
      }

      resolve(newRecord);
    });
  });
}

/**
 * Găsește un eveniment de pontaj după ID.
 * @param {string} id - ID-ul NeDB
 * @returns {Promise<Object|null>}
 */
function findAttendanceById(id) {
  return new Promise((resolve, reject) => {
    if (!id || !isValidId(id)) {
      return reject(new AppError('ID-ul evenimentului de pontaj este invalid.', 400, 'INVALID_ATTENDANCE_ID'));
    }

    attendance.findOne({ _id: id }, (err, record) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea pontajului: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(record || null);
    });
  });
}

/**
 * Găsește evenimente de pontaj pentru un angajat, cu opțiuni de filtrare.
 * @param {string} employeeId - ID-ul angajatului
 * @param {Object} [options] - Opțiuni de filtrare și paginare
 * @param {string} [options.type] - 'checkIn' | 'checkOut'
 * @param {string} [options.startDate] - Dată de început (inclusiv)
 * @param {string} [options.endDate] - Dată de sfârșit (inclusiv)
 * @param {string} [options.sortBy='timestamp'] - Câmpul de sortare
 * @param {string} [options.sortOrder='desc'] - 'asc' sau 'desc'
 * @param {number} [options.limit] - Număr maxim de rezultate
 * @param {number} [options.skip] - Număr de rezultate de sărit
 * @returns {Promise<Array>}
 */
function findAttendanceByEmployee(employeeId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!employeeId || !isValidId(employeeId)) {
      return reject(new AppError('ID-ul angajatului este invalid.', 400, 'INVALID_EMPLOYEE_ID'));
    }

    const query = { employeeId: employeeId.trim() };

    if (options.type && isValidAttendanceType(options.type)) {
      query.type = options.type;
    }

    if (options.startDate || options.endDate) {
      query.timestamp = {};
      if (options.startDate) {
        query.timestamp.$gte = options.startDate;
      }
      if (options.endDate) {
        query.timestamp.$lte = options.endDate;
      }
    }

    let queryBuilder = attendance.find(query)
      .sort({ [options.sortBy || 'timestamp']: options.sortOrder === 'asc' ? 1 : -1 });

    if (typeof options.skip === 'number' && options.skip >= 0) {
      queryBuilder = queryBuilder.skip(options.skip);
    }

    if (typeof options.limit === 'number' && options.limit > 0) {
      queryBuilder = queryBuilder.limit(options.limit);
    }

    queryBuilder.exec((err, records) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea pontajelor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(records || []);
    });
  });
}

/**
 * Găsește evenimente de pontaj pentru un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options] - Opțiuni de filtrare și paginare
 * @param {string} [options.employeeId] - Filtrare după angajat
 * @param {string} [options.type] - Filtrare după tip
 * @param {string} [options.startDate] - Dată de început
 * @param {string} [options.endDate] - Dată de sfârșit
 * @param {string} [options.locationId] - Filtrare după locație
 * @param {string} [options.sortBy='timestamp'] - Câmpul de sortare
 * @param {string} [options.sortOrder='desc'] - 'asc' sau 'desc'
 * @param {number} [options.limit] - Număr maxim de rezultate
 * @param {number} [options.skip] - Număr de rezultate de sărit
 * @returns {Promise<Array>}
 */
function findAttendanceByTenant(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId || !isValidId(tenantId)) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const query = { tenantId: tenantId.trim() };

    if (options.employeeId && isValidId(options.employeeId)) {
      query.employeeId = options.employeeId.trim();
    }

    if (options.type && isValidAttendanceType(options.type)) {
      query.type = options.type;
    }

    if (options.locationId && isValidId(options.locationId)) {
      query.locationId = options.locationId.trim();
    }

    if (options.startDate || options.endDate) {
      query.timestamp = {};
      if (options.startDate) {
        query.timestamp.$gte = options.startDate;
      }
      if (options.endDate) {
        query.timestamp.$lte = options.endDate;
      }
    }

    let queryBuilder = attendance.find(query)
      .sort({ [options.sortBy || 'timestamp']: options.sortOrder === 'asc' ? 1 : -1 });

    if (typeof options.skip === 'number' && options.skip >= 0) {
      queryBuilder = queryBuilder.skip(options.skip);
    }

    if (typeof options.limit === 'number' && options.limit > 0) {
      queryBuilder = queryBuilder.limit(options.limit);
    }

    queryBuilder.exec((err, records) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea pontajelor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(records || []);
    });
  });
}

/**
 * Găsește ultimul eveniment de pontaj pentru un angajat (de obicei pentru a verifica
 * dacă este check-in sau check-out).
 * @param {string} employeeId - ID-ul angajatului
 * @returns {Promise<Object|null>} Ultimul eveniment de pontaj sau null
 */
function findLastAttendanceEvent(employeeId) {
  return new Promise((resolve, reject) => {
    if (!employeeId || !isValidId(employeeId)) {
      return reject(new AppError('ID-ul angajatului este invalid.', 400, 'INVALID_EMPLOYEE_ID'));
    }

    attendance.find({ employeeId: employeeId.trim() })
      .sort({ timestamp: -1 })
      .limit(1)
      .exec((err, records) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea ultimului pontaj: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        resolve(records && records.length > 0 ? records[0] : null);
      });
  });
}

/**
 * Numără evenimentele de pontaj pentru un tenant, cu opțiuni de filtrare.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.employeeId] - Filtrare după angajat
 * @param {string} [options.type] - Filtrare după tip
 * @param {string} [options.startDate] - Dată de început
 * @param {string} [options.endDate] - Dată de sfârșit
 * @returns {Promise<number>}
 */
function countAttendance(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId || !isValidId(tenantId)) {
      return resolve(0);
    }

    const query = { tenantId: tenantId.trim() };

    if (options.employeeId && isValidId(options.employeeId)) {
      query.employeeId = options.employeeId.trim();
    }

    if (options.type && isValidAttendanceType(options.type)) {
      query.type = options.type;
    }

    if (options.startDate || options.endDate) {
      query.timestamp = {};
      if (options.startDate) {
        query.timestamp.$gte = options.startDate;
      }
      if (options.endDate) {
        query.timestamp.$lte = options.endDate;
      }
    }

    attendance.count(query, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea pontajelor: ${err.message}`,
          500,
          'DB_COUNT_ERROR'
        ));
      }
      resolve(count || 0);
    });
  });
}

/**
 * Calculează orele lucrate de un angajat într-un interval de timp,
 * pe baza perechilor check-in / check-out.
 * @param {string} employeeId - ID-ul angajatului
 * @param {string} startDate - Dată de început (ISO string)
 * @param {string} endDate - Dată de sfârșit (ISO string)
 * @returns {Promise<Object>} { totalHours, totalMinutes, totalSeconds, checkIns, checkOuts, pairs }
 */
function calculateWorkHours(employeeId, startDate, endDate) {
  return new Promise((resolve, reject) => {
    if (!employeeId || !isValidId(employeeId)) {
      return reject(new AppError('ID-ul angajatului este invalid.', 400, 'INVALID_EMPLOYEE_ID'));
    }

    if (!startDate || !isValidTimestamp(startDate)) {
      return reject(new AppError('Data de început este invalidă.', 400, 'INVALID_START_DATE'));
    }

    if (!endDate || !isValidTimestamp(endDate)) {
      return reject(new AppError('Data de sfârșit este invalidă.', 400, 'INVALID_END_DATE'));
    }

    const query = {
      employeeId: employeeId.trim(),
      timestamp: { $gte: startDate, $lte: endDate },
    };

    attendance.find(query)
      .sort({ timestamp: 1 }) // Sortare ascendentă pentru a forma perechi
      .exec((err, records) => {
        if (err) {
          return reject(new AppError(
            `Eroare la calcularea orelor lucrate: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        const allRecords = records || [];
        const checkIns = allRecords.filter((r) => r.type === 'checkIn');
        const checkOuts = allRecords.filter((r) => r.type === 'checkOut');

        // Formăm perechi check-in -> check-out
        let totalMilliseconds = 0;
        const pairs = [];
        let currentCheckIn = null;

        for (const record of allRecords) {
          if (record.type === 'checkIn' && !currentCheckIn) {
            currentCheckIn = record;
          } else if (record.type === 'checkOut' && currentCheckIn) {
            const checkInTime = new Date(currentCheckIn.timestamp).getTime();
            const checkOutTime = new Date(record.timestamp).getTime();
            const duration = checkOutTime - checkInTime;

            if (duration > 0) {
              totalMilliseconds += duration;
              pairs.push({
                checkIn: currentCheckIn.timestamp,
                checkOut: record.timestamp,
                durationMs: duration,
              });
            }

            currentCheckIn = null;
          }
        }

        const totalSeconds = Math.floor(totalMilliseconds / 1000);
        const totalMinutes = Math.floor(totalSeconds / 60);
        const totalHours = Math.round((totalMinutes / 60) * 100) / 100;

        resolve({
          totalHours,
          totalMinutes,
          totalSeconds,
          checkIns: checkIns.length,
          checkOuts: checkOuts.length,
          pairs: pairs.length,
        });
      });
  });
}

/**
 * Șterge un eveniment de pontaj după ID.
 * @param {string} id - ID-ul evenimentului
 * @returns {Promise<boolean>} true dacă a fost șters
 */
function deleteAttendanceRecord(id) {
  return new Promise((resolve, reject) => {
    if (!id || !isValidId(id)) {
      return reject(new AppError('ID-ul evenimentului de pontaj este invalid.', 400, 'INVALID_ATTENDANCE_ID'));
    }

    attendance.remove({ _id: id }, {}, (removeErr, numRemoved) => {
      if (removeErr) {
        return reject(new AppError(
          `Eroare la ștergerea pontajului: ${removeErr.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      if (numRemoved === 0) {
        return reject(new AppError('Evenimentul de pontaj nu a fost găsit.', 404, 'ATTENDANCE_NOT_FOUND'));
      }

      resolve(true);
    });
  });
}

/**
 * Șterge toate evenimentele de pontaj pentru un angajat.
 * @param {string} employeeId - ID-ul angajatului
 * @returns {Promise<number>} Numărul de înregistrări șterse
 */
function deleteAttendanceByEmployee(employeeId) {
  return new Promise((resolve, reject) => {
    if (!employeeId || !isValidId(employeeId)) {
      return reject(new AppError('ID-ul angajatului este invalid.', 400, 'INVALID_EMPLOYEE_ID'));
    }

    attendance.remove({ employeeId: employeeId.trim() }, { multi: true }, (removeErr, numRemoved) => {
      if (removeErr) {
        return reject(new AppError(
          `Eroare la ștergerea pontajelor: ${removeErr.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      resolve(numRemoved || 0);
    });
  });
}

// ---------------------------------------------------------------------------
// Operații CRUD – Salarii brute (Gross Salaries)
// ---------------------------------------------------------------------------

/**
 * Creează o înregistrare salarială (salariu brut) pentru un angajat.
 *
 * @param {Object} salaryData - Datele salariale
 * @param {string} salaryData.employeeId - ID-ul angajatului
 * @param {number} salaryData.grossAmount - Salariul brut
 * @param {string} [salaryData.currency='RON'] - Moneda
 * @param {string} salaryData.period - Perioada (ex: "2025-01")
 * @param {string} [salaryData.paymentFrequency='lunar'] - Frecvența de plată
 * @param {string} [salaryData.status='necalculat'] - Statusul salariului
 * @param {string} [salaryData.note] - Notă opțională
 * @param {string} salaryData.userId - ID-ul utilizatorului care înregistrează
 * @param {string} salaryData.tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Documentul salarial creat
 * @throws {AppError} Dacă validarea eșuează
 */
function createSalaryRecord(salaryData) {
  return new Promise((resolve, reject) => {
    const validationError = validateSalaryData(salaryData);
    if (validationError) {
      return reject(new AppError(validationError, 400, 'INVALID_SALARY_DATA'));
    }

    const {
      employeeId,
      grossAmount,
      currency,
      period,
      paymentFrequency,
      status,
      deductions,
      bonuses,
      netAmount,
      note,
      userId,
      tenantId,
    } = salaryData;

    const now = new Date().toISOString();

    const salaryDoc = {
      employeeId: employeeId.trim(),
      grossAmount: grossAmount !== undefined ? grossAmount : null,
      currency: currency || 'RON',
      period: period || null,
      paymentFrequency: paymentFrequency || 'lunar',
      status: status && isValidSalaryStatus(status) ? status : 'necalculat',
      deductions: isPositiveNumber(deductions) ? deductions : 0,
      bonuses: isPositiveNumber(bonuses) ? bonuses : 0,
      netAmount: isNonNegativeNumber(netAmount) ? netAmount : null,
      note: note !== undefined ? String(note).trim() : '',
      userId: userId ? userId.trim() : null,
      tenantId: tenantId.trim(),
      createdAt: now,
      updatedAt: now,
    };

    salaries.insert(salaryDoc, (insertErr, newSalary) => {
      if (insertErr) {
        return reject(new AppError(
          `Eroare la crearea înregistrării salariale: ${insertErr.message}`,
          500,
          'DB_INSERT_ERROR'
        ));
      }

      resolve(newSalary);
    });
  });
}

/**
 * Găsește o înregistrare salarială după ID.
 * @param {string} id - ID-ul NeDB
 * @returns {Promise<Object|null>}
 */
function findSalaryById(id) {
  return new Promise((resolve, reject) => {
    if (!id || !isValidId(id)) {
      return reject(new AppError('ID-ul înregistrării salariale este invalid.', 400, 'INVALID_SALARY_ID'));
    }

    salaries.findOne({ _id: id }, (err, salary) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea salariului: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(salary || null);
    });
  });
}

/**
 * Găsește înregistrări salariale pentru un angajat.
 * @param {string} employeeId - ID-ul angajatului
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.period] - Filtrare după perioadă
 * @param {string} [options.status] - Filtrare după status
 * @param {string} [options.sortBy='createdAt'] - Câmpul de sortare
 * @param {string} [options.sortOrder='desc'] - 'asc' sau 'desc'
 * @param {number} [options.limit] - Număr maxim de rezultate
 * @returns {Promise<Array>}
 */
function findSalariesByEmployee(employeeId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!employeeId || !isValidId(employeeId)) {
      return reject(new AppError('ID-ul angajatului este invalid.', 400, 'INVALID_EMPLOYEE_ID'));
    }

    const query = { employeeId: employeeId.trim() };

    if (options.period) {
      query.period = options.period;
    }

    if (options.status && isValidSalaryStatus(options.status)) {
      query.status = options.status;
    }

    let queryBuilder = salaries.find(query)
      .sort({ [options.sortBy || 'createdAt']: options.sortOrder === 'asc' ? 1 : -1 });

    if (typeof options.limit === 'number' && options.limit > 0) {
      queryBuilder = queryBuilder.limit(options.limit);
    }

    queryBuilder.exec((err, salaryRecords) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea salariilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(salaryRecords || []);
    });
  });
}

/**
 * Găsește înregistrări salariale pentru un tenant.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options] - Opțiuni de filtrare și paginare
 * @param {string} [options.employeeId] - Filtrare după angajat
 * @param {string} [options.period] - Filtrare după perioadă
 * @param {string} [options.status] - Filtrare după status
 * @param {string} [options.sortBy='createdAt'] - Câmpul de sortare
 * @param {string} [options.sortOrder='desc'] - 'asc' sau 'desc'
 * @param {number} [options.limit] - Număr maxim de rezultate
 * @param {number} [options.skip] - Număr de rezultate de sărit
 * @returns {Promise<Array>}
 */
function findSalariesByTenant(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId || !isValidId(tenantId)) {
      return reject(new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID'));
    }

    const query = { tenantId: tenantId.trim() };

    if (options.employeeId && isValidId(options.employeeId)) {
      query.employeeId = options.employeeId.trim();
    }

    if (options.period) {
      query.period = options.period;
    }

    if (options.status && isValidSalaryStatus(options.status)) {
      query.status = options.status;
    }

    let queryBuilder = salaries.find(query)
      .sort({ [options.sortBy || 'createdAt']: options.sortOrder === 'asc' ? 1 : -1 });

    if (typeof options.skip === 'number' && options.skip >= 0) {
      queryBuilder = queryBuilder.skip(options.skip);
    }

    if (typeof options.limit === 'number' && options.limit > 0) {
      queryBuilder = queryBuilder.limit(options.limit);
    }

    queryBuilder.exec((err, salaryRecords) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea salariilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(salaryRecords || []);
    });
  });
}

/**
 * Actualizează o înregistrare salarială.
 * @param {string} id - ID-ul înregistrării
 * @param {Object} updateData - Câmpurile de actualizat
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateSalaryRecord(id, updateData) {
  return new Promise((resolve, reject) => {
    if (!id || !isValidId(id)) {
      return reject(new AppError('ID-ul înregistrării salariale este invalid.', 400, 'INVALID_SALARY_ID'));
    }

    if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
      return reject(new AppError('Nu există date de actualizat.', 400, 'NO_UPDATE_DATA'));
    }

    // Câmpuri permise pentru actualizare
    const allowedFields = [
      'grossAmount',
      'currency',
      'period',
      'paymentFrequency',
      'status',
      'deductions',
      'bonuses',
      'netAmount',
      'note',
    ];

    const updateSet = {};

    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        // Validări specifice fiecărui câmp
        switch (field) {
          case 'grossAmount':
            if (updateData.grossAmount !== null && !isPositiveNumber(updateData.grossAmount)) {
              return reject(new AppError(
                'Salariul brut trebuie să fie un număr mai mare decât 0.',
                400,
                'INVALID_GROSS_AMOUNT'
              ));
            }
            updateSet.grossAmount = updateData.grossAmount;
            break;

          case 'currency':
            if (!isValidCurrency(updateData.currency)) {
              return reject(new AppError(
                `Moneda "${updateData.currency}" nu este validă. Monede acceptate: ${VALID_CURRENCIES.join(', ')}.`,
                400,
                'INVALID_CURRENCY'
              ));
            }
            updateSet.currency = updateData.currency;
            break;

          case 'period':
            if (typeof updateData.period !== 'string' || updateData.period.trim().length === 0) {
              return reject(new AppError(
                'Perioada salarială trebuie să fie un șir nevid.',
                400,
                'INVALID_PERIOD'
              ));
            }
            updateSet.period = updateData.period.trim();
            break;

          case 'paymentFrequency':
            if (!isValidPaymentFrequency(updateData.paymentFrequency)) {
              return reject(new AppError(
                `Frecvența de plată "${updateData.paymentFrequency}" nu este validă.`,
                400,
                'INVALID_PAYMENT_FREQUENCY'
              ));
            }
            updateSet.paymentFrequency = updateData.paymentFrequency;
            break;

          case 'status':
            if (!isValidSalaryStatus(updateData.status)) {
              return reject(new AppError(
                `Statusul "${updateData.status}" nu este valid. Statusuri acceptate: ${VALID_SALARY_STATUS.join(', ')}.`,
                400,
                'INVALID_SALARY_STATUS'
              ));
            }
            updateSet.status = updateData.status;
            break;

          case 'deductions':
            if (!isNonNegativeNumber(updateData.deductions)) {
              return reject(new AppError(
                'Deducerile trebuie să fie un număr nenegativ.',
                400,
                'INVALID_DEDUCTIONS'
              ));
            }
            updateSet.deductions = updateData.deductions;
            break;

          case 'bonuses':
            if (!isNonNegativeNumber(updateData.bonuses)) {
              return reject(new AppError(
                'Bonusurile trebuie să fie un număr nenegativ.',
                400,
                'INVALID_BONUSES'
              ));
            }
            updateSet.bonuses = updateData.bonuses;
            break;

          case 'netAmount':
            if (updateData.netAmount !== null && !isNonNegativeNumber(updateData.netAmount)) {
              return reject(new AppError(
                'Salariul net trebuie să fie un număr nenegativ.',
                400,
                'INVALID_NET_AMOUNT'
              ));
            }
            updateSet.netAmount = updateData.netAmount;
            break;

          case 'note':
            updateSet.note = typeof updateData.note === 'string' ? updateData.note.trim() : String(updateData.note).trim();
            break;

          default:
            break;
        }
      }
    }

    if (Object.keys(updateSet).length === 0) {
      return reject(new AppError('Niciun câmp valid de actualizat.', 400, 'NO_VALID_FIELDS'));
    }

    updateSet.updatedAt = new Date().toISOString();

    salaries.update(
      { _id: id },
      { $set: updateSet },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedDoc) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea salariului: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError(
            'Înregistrarea salarială nu a fost găsită.',
            404,
            'SALARY_NOT_FOUND'
          ));
        }

        resolve(updatedDoc);
      }
    );
  });
}

/**
 * Șterge o înregistrare salarială după ID.
 * @param {string} id - ID-ul înregistrării
 * @returns {Promise<boolean>} true dacă a fost șters
 */
function deleteSalaryRecord(id) {
  return new Promise((resolve, reject) => {
    if (!id || !isValidId(id)) {
      return reject(new AppError('ID-ul înregistrării salariale este invalid.', 400, 'INVALID_SALARY_ID'));
    }

    salaries.remove({ _id: id }, {}, (removeErr, numRemoved) => {
      if (removeErr) {
        return reject(new AppError(
          `Eroare la ștergerea salariului: ${removeErr.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      if (numRemoved === 0) {
        return reject(new AppError('Înregistrarea salarială nu a fost găsită.', 404, 'SALARY_NOT_FOUND'));
      }

      resolve(true);
    });
  });
}

/**
 * Numără înregistrările salariale pentru un tenant, cu opțiuni de filtrare.
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options] - Opțiuni de filtrare
 * @param {string} [options.employeeId] - Filtrare după angajat
 * @param {string} [options.period] - Filtrare după perioadă
 * @param {string} [options.status] - Filtrare după status
 * @returns {Promise<number>}
 */
function countSalaries(tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!tenantId || !isValidId(tenantId)) {
      return resolve(0);
    }

    const query = { tenantId: tenantId.trim() };

    if (options.employeeId && isValidId(options.employeeId)) {
      query.employeeId = options.employeeId.trim();
    }

    if (options.period) {
      query.period = options.period;
    }

    if (options.status && isValidSalaryStatus(options.status)) {
      query.status = options.status;
    }

    salaries.count(query, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea salariilor: ${err.message}`,
          500,
          'DB_COUNT_ERROR'
        ));
      }
      resolve(count || 0);
    });
  });
}

/**
 * Calculează automat salariul net pe baza salariului brut, deducerilor și bonusurilor.
 * @param {number} grossAmount - Salariul brut
 * @param {number} [deductions=0] - Deduceri totale
 * @param {number} [bonuses=0] - Bonusuri totale
 * @returns {number} Salariul net calculat
 */
function computeNetSalary(grossAmount, deductions = 0, bonuses = 0) {
  const gross = isPositiveNumber(grossAmount) ? grossAmount : 0;
  const deduct = isNonNegativeNumber(deductions) ? deductions : 0;
  const bonus = isNonNegativeNumber(bonuses) ? bonuses : 0;
  return Math.round((gross - deduct + bonus) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Colecții
  attendance,
  salaries,

  // Constante
  VALID_ATTENDANCE_TYPES,
  VALID_LOCATION_TYPES,
  VALID_CURRENCIES,
  VALID_SALARY_STATUS,
  VALID_PAYMENT_FREQUENCIES,

  // Validare
  isValidId,
  isValidAttendanceType,
  isValidLocationType,
  isValidCurrency,
  isValidSalaryStatus,
  isValidPaymentFrequency,
  isPositiveNumber,
  isNonNegativeNumber,
  isValidTimestamp,
  validateAttendanceData,
  validateSalaryData,

  // Pontaj (Attendance)
  createAttendanceRecord,
  findAttendanceById,
  findAttendanceByEmployee,
  findAttendanceByTenant,
  findLastAttendanceEvent,
  countAttendance,
  calculateWorkHours,
  deleteAttendanceRecord,
  deleteAttendanceByEmployee,

  // Salarii (Gross Salaries)
  createSalaryRecord,
  findSalaryById,
  findSalariesByEmployee,
  findSalariesByTenant,
  updateSalaryRecord,
  deleteSalaryRecord,
  countSalaries,
  computeNetSalary,
};