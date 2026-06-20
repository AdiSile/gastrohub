'use strict';

// ---------------------------------------------------------------------------
// Model HR (Human Resources) – GastroHub
// Model pentru pontaj angajați (check-in/out) și salarii brute.
// Câmpuri: employeeId, type (checkIn/checkOut), timestamp, locationId,
//          locationType, note, userId, tenantId, salaryData, createdAt
//
// Backend: SQLite (prin db.run() / db.prepare() direct pe instanța din getDb()).
// Tabele: hr_attendance, hr_salaries
// ---------------------------------------------------------------------------

const { getDb } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

const VALID_ATTENDANCE_TYPES = ['checkIn', 'checkOut'];

const VALID_LOCATION_TYPES = ['restaurant', 'hotel', 'depozit', 'birou'];

const VALID_CURRENCIES = ['RON', 'EUR', 'USD'];

const VALID_SALARY_STATUS = ['necalculat', 'calculat', 'aprobat', 'plătit'];

const VALID_PAYMENT_FREQUENCIES = ['lunar', 'săptămânal', 'zilnic'];

// ---------------------------------------------------------------------------
// Generator intern de ID-uri unice
// ---------------------------------------------------------------------------

/**
 * Generează un ID unic fără dependențe externe.
 * Bazat pe timestamp și entropie Math.random.
 * @returns {string} ID unic
 */
function generateId() {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).substring(2, 10) +
    '-' +
    Math.random().toString(36).substring(2, 6)
  );
}

// ---------------------------------------------------------------------------
// Helper: obține numărul de changes după un db.run()
// ---------------------------------------------------------------------------

/**
 * Returnează valoarea changes() după o operație de INSERT/UPDATE/DELETE.
 * @param {import('sql.js').Database} db
 * @returns {number}
 */
function getChanges(db) {
  const result = db.exec('SELECT changes() AS cnt');
  return (result.length > 0 && result[0].values.length > 0) ? result[0].values[0][0] : 0;
}

// ---------------------------------------------------------------------------
// Helper: execută un SELECT și returnează primul rând ca obiect
// ---------------------------------------------------------------------------

/**
 * Execută o interogare SELECT și returnează primul rând sau null.
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Object|null}
 */
function dbGet(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row || null;
}

// ---------------------------------------------------------------------------
// Helper: execută un SELECT și returnează toate rândurile
// ---------------------------------------------------------------------------

/**
 * Execută o interogare SELECT și returnează toate rândurile ca array.
 * @param {import('sql.js').Database} db
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Array<Object>}
 */
function dbAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// ---------------------------------------------------------------------------
// Asigură existența tabelelor (idempotent)
// ---------------------------------------------------------------------------

let _tablesEnsured = false;

/**
 * Creează tabelele hr_attendance și hr_salaries dacă nu există deja.
 * @param {import('sql.js').Database} db
 */
function ensureTables(db) {
  if (_tablesEnsured) return;

  db.run(`
    CREATE TABLE IF NOT EXISTS hr_attendance (
      id           TEXT PRIMARY KEY,
      employeeId   TEXT NOT NULL,
      type         TEXT NOT NULL,
      timestamp    TEXT NOT NULL,
      locationId   TEXT,
      locationType TEXT,
      note         TEXT DEFAULT '',
      userId       TEXT NOT NULL,
      tenantId     TEXT NOT NULL,
      createdAt    TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_hr_attendance_employeeId ON hr_attendance(employeeId);');
  db.run('CREATE INDEX IF NOT EXISTS idx_hr_attendance_tenantId ON hr_attendance(tenantId);');
  db.run('CREATE INDEX IF NOT EXISTS idx_hr_attendance_timestamp ON hr_attendance(timestamp);');

  db.run(`
    CREATE TABLE IF NOT EXISTS hr_salaries (
      id               TEXT PRIMARY KEY,
      employeeId       TEXT NOT NULL,
      grossAmount      REAL,
      currency         TEXT DEFAULT 'RON',
      period           TEXT,
      paymentFrequency TEXT DEFAULT 'lunar',
      status           TEXT DEFAULT 'necalculat',
      deductions       REAL DEFAULT 0,
      bonuses          REAL DEFAULT 0,
      netAmount        REAL,
      note             TEXT DEFAULT '',
      userId           TEXT,
      tenantId         TEXT NOT NULL,
      createdAt        TEXT DEFAULT (datetime('now')),
      updatedAt        TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_hr_salaries_employeeId ON hr_salaries(employeeId);');
  db.run('CREATE INDEX IF NOT EXISTS idx_hr_salaries_tenantId ON hr_salaries(tenantId);');
  db.run('CREATE INDEX IF NOT EXISTS idx_hr_salaries_period ON hr_salaries(period);');
  db.run('CREATE INDEX IF NOT EXISTS idx_hr_salaries_status ON hr_salaries(status);');

  _tablesEnsured = true;
}

// ---------------------------------------------------------------------------
// Helpers: transformare rând SQL → obiect
// ---------------------------------------------------------------------------

/**
 * Transformă un rând SQL din hr_attendance în obiectul așteptat.
 * @param {Object|null} row
 * @returns {Object|null}
 */
function rowToAttendance(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    employeeId: row.employeeId,
    type: row.type,
    timestamp: row.timestamp,
    locationId: row.locationId || null,
    locationType: row.locationType || null,
    note: row.note || '',
    userId: row.userId,
    tenantId: row.tenantId,
    createdAt: row.createdAt,
  };
}

/**
 * Transformă un rând SQL din hr_salaries în obiectul așteptat.
 * @param {Object|null} row
 * @returns {Object|null}
 */
function rowToSalary(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    employeeId: row.employeeId,
    grossAmount: row.grossAmount,
    currency: row.currency || 'RON',
    period: row.period || null,
    paymentFrequency: row.paymentFrequency || 'lunar',
    status: row.status || 'necalculat',
    deductions: row.deductions || 0,
    bonuses: row.bonuses || 0,
    netAmount: row.netAmount,
    note: row.note || '',
    userId: row.userId || null,
    tenantId: row.tenantId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

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
async function createAttendanceRecord(attendanceData) {
  const validationError = validateAttendanceData(attendanceData);
  if (validationError) {
    throw new AppError(validationError, 400, 'INVALID_ATTENDANCE_DATA');
  }

  try {
    const db = await getDb();
    ensureTables(db);

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

    const id = generateId();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO hr_attendance
         (id, employeeId, type, timestamp, locationId, locationType, note, userId, tenantId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        employeeId.trim(),
        type,
        timestamp,
        locationId ? locationId.trim() : null,
        locationType || null,
        note !== undefined ? String(note).trim() : '',
        userId.trim(),
        tenantId.trim(),
        now,
      ]
    );

    const created = dbGet(db, 'SELECT * FROM hr_attendance WHERE id = ?', [id]);
    return rowToAttendance(created);
  } catch (err) {
    throw new AppError(
      `Eroare la înregistrarea pontajului: ${err.message}`,
      500,
      'DB_INSERT_ERROR'
    );
  }
}

/**
 * Găsește un eveniment de pontaj după ID.
 * @param {string} id - ID-ul SQLite
 * @returns {Promise<Object|null>}
 */
async function findAttendanceById(id) {
  if (!id || !isValidId(id)) {
    throw new AppError('ID-ul evenimentului de pontaj este invalid.', 400, 'INVALID_ATTENDANCE_ID');
  }

  try {
    const db = await getDb();
    ensureTables(db);

    const row = dbGet(db, 'SELECT * FROM hr_attendance WHERE id = ?', [id]);
    return rowToAttendance(row);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea pontajului: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
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
async function findAttendanceByEmployee(employeeId, options = {}) {
  if (!employeeId || !isValidId(employeeId)) {
    throw new AppError('ID-ul angajatului este invalid.', 400, 'INVALID_EMPLOYEE_ID');
  }

  try {
    const db = await getDb();
    ensureTables(db);

    const conditions = ['employeeId = ?'];
    const params = [employeeId.trim()];

    if (options.type && isValidAttendanceType(options.type)) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    if (options.startDate) {
      conditions.push('timestamp >= ?');
      params.push(options.startDate);
    }

    if (options.endDate) {
      conditions.push('timestamp <= ?');
      params.push(options.endDate);
    }

    const whereClause = conditions.join(' AND ');

    const sortField = options.sortBy || 'timestamp';
    const allowedSortFields = ['timestamp', 'createdAt', 'type', 'employeeId'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'timestamp';
    const sortDir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

    let sql = `SELECT * FROM hr_attendance WHERE ${whereClause} ORDER BY ${safeSortField} ${sortDir}`;

    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);

      if (options.skip && Number.isInteger(options.skip) && options.skip >= 0) {
        sql += ' OFFSET ?';
        params.push(options.skip);
      }
    }

    const rows = dbAll(db, sql, params);
    return (rows || []).map(rowToAttendance);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea pontajelor: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
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
async function findAttendanceByTenant(tenantId, options = {}) {
  if (!tenantId || !isValidId(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  try {
    const db = await getDb();
    ensureTables(db);

    const conditions = ['tenantId = ?'];
    const params = [tenantId.trim()];

    if (options.employeeId && isValidId(options.employeeId)) {
      conditions.push('employeeId = ?');
      params.push(options.employeeId.trim());
    }

    if (options.type && isValidAttendanceType(options.type)) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    if (options.locationId && isValidId(options.locationId)) {
      conditions.push('locationId = ?');
      params.push(options.locationId.trim());
    }

    if (options.startDate) {
      conditions.push('timestamp >= ?');
      params.push(options.startDate);
    }

    if (options.endDate) {
      conditions.push('timestamp <= ?');
      params.push(options.endDate);
    }

    const whereClause = conditions.join(' AND ');

    const sortField = options.sortBy || 'timestamp';
    const allowedSortFields = ['timestamp', 'createdAt', 'type', 'employeeId'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'timestamp';
    const sortDir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

    let sql = `SELECT * FROM hr_attendance WHERE ${whereClause} ORDER BY ${safeSortField} ${sortDir}`;

    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);

      if (options.skip && Number.isInteger(options.skip) && options.skip >= 0) {
        sql += ' OFFSET ?';
        params.push(options.skip);
      }
    }

    const rows = dbAll(db, sql, params);
    return (rows || []).map(rowToAttendance);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea pontajelor: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește ultimul eveniment de pontaj pentru un angajat (de obicei pentru a verifica
 * dacă este check-in sau check-out).
 * @param {string} employeeId - ID-ul angajatului
 * @returns {Promise<Object|null>} Ultimul eveniment de pontaj sau null
 */
async function findLastAttendanceEvent(employeeId) {
  if (!employeeId || !isValidId(employeeId)) {
    throw new AppError('ID-ul angajatului este invalid.', 400, 'INVALID_EMPLOYEE_ID');
  }

  try {
    const db = await getDb();
    ensureTables(db);

    const rows = dbAll(
      db,
      'SELECT * FROM hr_attendance WHERE employeeId = ? ORDER BY timestamp DESC LIMIT 1',
      [employeeId.trim()]
    );

    return rows && rows.length > 0 ? rowToAttendance(rows[0]) : null;
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea ultimului pontaj: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
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
async function countAttendance(tenantId, options = {}) {
  if (!tenantId || !isValidId(tenantId)) {
    return 0;
  }

  try {
    const db = await getDb();
    ensureTables(db);

    const conditions = ['tenantId = ?'];
    const params = [tenantId.trim()];

    if (options.employeeId && isValidId(options.employeeId)) {
      conditions.push('employeeId = ?');
      params.push(options.employeeId.trim());
    }

    if (options.type && isValidAttendanceType(options.type)) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    if (options.startDate) {
      conditions.push('timestamp >= ?');
      params.push(options.startDate);
    }

    if (options.endDate) {
      conditions.push('timestamp <= ?');
      params.push(options.endDate);
    }

    const whereClause = conditions.join(' AND ');

    const row = dbGet(
      db,
      `SELECT COUNT(*) AS cnt FROM hr_attendance WHERE ${whereClause}`,
      params
    );

    return row ? row.cnt : 0;
  } catch (err) {
    throw new AppError(
      `Eroare la numărarea pontajelor: ${err.message}`,
      500,
      'DB_COUNT_ERROR'
    );
  }
}

/**
 * Calculează orele lucrate de un angajat într-un interval de timp,
 * pe baza perechilor check-in / check-out.
 * @param {string} employeeId - ID-ul angajatului
 * @param {string} startDate - Dată de început (ISO string)
 * @param {string} endDate - Dată de sfârșit (ISO string)
 * @returns {Promise<Object>} { totalHours, totalMinutes, totalSeconds, checkIns, checkOuts, pairs }
 */
async function calculateWorkHours(employeeId, startDate, endDate) {
  if (!employeeId || !isValidId(employeeId)) {
    throw new AppError('ID-ul angajatului este invalid.', 400, 'INVALID_EMPLOYEE_ID');
  }

  if (!startDate || !isValidTimestamp(startDate)) {
    throw new AppError('Data de început este invalidă.', 400, 'INVALID_START_DATE');
  }

  if (!endDate || !isValidTimestamp(endDate)) {
    throw new AppError('Data de sfârșit este invalidă.', 400, 'INVALID_END_DATE');
  }

  try {
    const db = await getDb();
    ensureTables(db);

    const rows = dbAll(
      db,
      'SELECT * FROM hr_attendance WHERE employeeId = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC',
      [employeeId.trim(), startDate, endDate]
    );

    const allRecords = rows || [];
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

    return {
      totalHours,
      totalMinutes,
      totalSeconds,
      checkIns: checkIns.length,
      checkOuts: checkOuts.length,
      pairs: pairs.length,
    };
  } catch (err) {
    throw new AppError(
      `Eroare la calcularea orelor lucrate: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Șterge un eveniment de pontaj după ID.
 * @param {string} id - ID-ul evenimentului
 * @returns {Promise<boolean>} true dacă a fost șters
 */
async function deleteAttendanceRecord(id) {
  if (!id || !isValidId(id)) {
    throw new AppError('ID-ul evenimentului de pontaj este invalid.', 400, 'INVALID_ATTENDANCE_ID');
  }

  try {
    const db = await getDb();
    ensureTables(db);

    db.run('DELETE FROM hr_attendance WHERE id = ?', [id]);
    const changes = getChanges(db);

    if (changes === 0) {
      throw new AppError('Evenimentul de pontaj nu a fost găsit.', 404, 'ATTENDANCE_NOT_FOUND');
    }

    return true;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      `Eroare la ștergerea pontajului: ${err.message}`,
      500,
      'DB_DELETE_ERROR'
    );
  }
}

/**
 * Șterge toate evenimentele de pontaj pentru un angajat.
 * @param {string} employeeId - ID-ul angajatului
 * @returns {Promise<number>} Numărul de înregistrări șterse
 */
async function deleteAttendanceByEmployee(employeeId) {
  if (!employeeId || !isValidId(employeeId)) {
    throw new AppError('ID-ul angajatului este invalid.', 400, 'INVALID_EMPLOYEE_ID');
  }

  try {
    const db = await getDb();
    ensureTables(db);

    db.run('DELETE FROM hr_attendance WHERE employeeId = ?', [employeeId.trim()]);
    return getChanges(db);
  } catch (err) {
    throw new AppError(
      `Eroare la ștergerea pontajelor: ${err.message}`,
      500,
      'DB_DELETE_ERROR'
    );
  }
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
async function createSalaryRecord(salaryData) {
  const validationError = validateSalaryData(salaryData);
  if (validationError) {
    throw new AppError(validationError, 400, 'INVALID_SALARY_DATA');
  }

  try {
    const db = await getDb();
    ensureTables(db);

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

    const id = generateId();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO hr_salaries
         (id, employeeId, grossAmount, currency, period, paymentFrequency, status,
          deductions, bonuses, netAmount, note, userId, tenantId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        employeeId.trim(),
        grossAmount !== undefined ? grossAmount : null,
        currency || 'RON',
        period || null,
        paymentFrequency || 'lunar',
        (status && isValidSalaryStatus(status)) ? status : 'necalculat',
        isPositiveNumber(deductions) ? deductions : 0,
        isPositiveNumber(bonuses) ? bonuses : 0,
        isNonNegativeNumber(netAmount) ? netAmount : null,
        note !== undefined ? String(note).trim() : '',
        userId ? userId.trim() : null,
        tenantId.trim(),
        now,
        now,
      ]
    );

    const created = dbGet(db, 'SELECT * FROM hr_salaries WHERE id = ?', [id]);
    return rowToSalary(created);
  } catch (err) {
    throw new AppError(
      `Eroare la crearea înregistrării salariale: ${err.message}`,
      500,
      'DB_INSERT_ERROR'
    );
  }
}

/**
 * Găsește o înregistrare salarială după ID.
 * @param {string} id - ID-ul SQLite
 * @returns {Promise<Object|null>}
 */
async function findSalaryById(id) {
  if (!id || !isValidId(id)) {
    throw new AppError('ID-ul înregistrării salariale este invalid.', 400, 'INVALID_SALARY_ID');
  }

  try {
    const db = await getDb();
    ensureTables(db);

    const row = dbGet(db, 'SELECT * FROM hr_salaries WHERE id = ?', [id]);
    return rowToSalary(row);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea salariului: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
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
async function findSalariesByEmployee(employeeId, options = {}) {
  if (!employeeId || !isValidId(employeeId)) {
    throw new AppError('ID-ul angajatului este invalid.', 400, 'INVALID_EMPLOYEE_ID');
  }

  try {
    const db = await getDb();
    ensureTables(db);

    const conditions = ['employeeId = ?'];
    const params = [employeeId.trim()];

    if (options.period) {
      conditions.push('period = ?');
      params.push(options.period);
    }

    if (options.status && isValidSalaryStatus(options.status)) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    const whereClause = conditions.join(' AND ');

    const sortField = options.sortBy || 'createdAt';
    const allowedSortFields = ['createdAt', 'updatedAt', 'period', 'grossAmount', 'status'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'createdAt';
    const sortDir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

    let sql = `SELECT * FROM hr_salaries WHERE ${whereClause} ORDER BY ${safeSortField} ${sortDir}`;

    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = dbAll(db, sql, params);
    return (rows || []).map(rowToSalary);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea salariilor: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
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
async function findSalariesByTenant(tenantId, options = {}) {
  if (!tenantId || !isValidId(tenantId)) {
    throw new AppError('ID-ul tenant-ului este invalid.', 400, 'INVALID_TENANT_ID');
  }

  try {
    const db = await getDb();
    ensureTables(db);

    const conditions = ['tenantId = ?'];
    const params = [tenantId.trim()];

    if (options.employeeId && isValidId(options.employeeId)) {
      conditions.push('employeeId = ?');
      params.push(options.employeeId.trim());
    }

    if (options.period) {
      conditions.push('period = ?');
      params.push(options.period);
    }

    if (options.status && isValidSalaryStatus(options.status)) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    const whereClause = conditions.join(' AND ');

    const sortField = options.sortBy || 'createdAt';
    const allowedSortFields = ['createdAt', 'updatedAt', 'period', 'grossAmount', 'status'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'createdAt';
    const sortDir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

    let sql = `SELECT * FROM hr_salaries WHERE ${whereClause} ORDER BY ${safeSortField} ${sortDir}`;

    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);

      if (options.skip && Number.isInteger(options.skip) && options.skip >= 0) {
        sql += ' OFFSET ?';
        params.push(options.skip);
      }
    }

    const rows = dbAll(db, sql, params);
    return (rows || []).map(rowToSalary);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea salariilor: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Actualizează o înregistrare salarială.
 * @param {string} id - ID-ul înregistrării
 * @param {Object} updateData - Câmpurile de actualizat
 * @returns {Promise<Object>} Documentul actualizat
 */
async function updateSalaryRecord(id, updateData) {
  if (!id || !isValidId(id)) {
    throw new AppError('ID-ul înregistrării salariale este invalid.', 400, 'INVALID_SALARY_ID');
  }

  if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
    throw new AppError('Nu există date de actualizat.', 400, 'NO_UPDATE_DATA');
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

  const setClauses = [];
  const params = [];
  const errors = [];

  for (const [field, value] of Object.entries(updateData)) {
    if (!allowedFields.includes(field)) {
      continue;
    }

    switch (field) {
      case 'grossAmount':
        if (value !== null && !isPositiveNumber(value)) {
          errors.push('Salariul brut trebuie să fie un număr mai mare decât 0.');
        } else {
          setClauses.push('grossAmount = ?');
          params.push(value);
        }
        break;

      case 'currency':
        if (!isValidCurrency(value)) {
          errors.push(`Moneda "${value}" nu este validă. Monede acceptate: ${VALID_CURRENCIES.join(', ')}.`);
        } else {
          setClauses.push('currency = ?');
          params.push(value);
        }
        break;

      case 'period':
        if (typeof value !== 'string' || value.trim().length === 0) {
          errors.push('Perioada salarială trebuie să fie un șir nevid.');
        } else {
          setClauses.push('period = ?');
          params.push(value.trim());
        }
        break;

      case 'paymentFrequency':
        if (!isValidPaymentFrequency(value)) {
          errors.push(`Frecvența de plată "${value}" nu este validă.`);
        } else {
          setClauses.push('paymentFrequency = ?');
          params.push(value);
        }
        break;

      case 'status':
        if (!isValidSalaryStatus(value)) {
          errors.push(`Statusul "${value}" nu este valid. Statusuri acceptate: ${VALID_SALARY_STATUS.join(', ')}.`);
        } else {
          setClauses.push('status = ?');
          params.push(value);
        }
        break;

      case 'deductions':
        if (!isNonNegativeNumber(value)) {
          errors.push('Deducerile trebuie să fie un număr nenegativ.');
        } else {
          setClauses.push('deductions = ?');
          params.push(value);
        }
        break;

      case 'bonuses':
        if (!isNonNegativeNumber(value)) {
          errors.push('Bonusurile trebuie să fie un număr nenegativ.');
        } else {
          setClauses.push('bonuses = ?');
          params.push(value);
        }
        break;

      case 'netAmount':
        if (value !== null && !isNonNegativeNumber(value)) {
          errors.push('Salariul net trebuie să fie un număr nenegativ.');
        } else {
          setClauses.push('netAmount = ?');
          params.push(value);
        }
        break;

      case 'note':
        setClauses.push('note = ?');
        params.push(typeof value === 'string' ? value.trim() : String(value).trim());
        break;

      default:
        break;
    }
  }

  if (errors.length > 0) {
    throw new AppError(errors.join(' '), 400, 'VALIDATION_ERROR');
  }

  if (setClauses.length === 0) {
    throw new AppError('Niciun câmp valid de actualizat.', 400, 'NO_VALID_FIELDS');
  }

  // Adăugăm updatedAt
  const now = new Date().toISOString();
  setClauses.push('updatedAt = ?');
  params.push(now);

  // Adăugăm id-ul la final
  params.push(id);

  try {
    const db = await getDb();
    ensureTables(db);

    db.run(
      `UPDATE hr_salaries SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );

    const changes = getChanges(db);

    if (changes === 0) {
      throw new AppError('Înregistrarea salarială nu a fost găsită.', 404, 'SALARY_NOT_FOUND');
    }

    const updated = dbGet(db, 'SELECT * FROM hr_salaries WHERE id = ?', [id]);
    return rowToSalary(updated);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      `Eroare la actualizarea salariului: ${err.message}`,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Șterge o înregistrare salarială după ID.
 * @param {string} id - ID-ul înregistrării
 * @returns {Promise<boolean>} true dacă a fost șters
 */
async function deleteSalaryRecord(id) {
  if (!id || !isValidId(id)) {
    throw new AppError('ID-ul înregistrării salariale este invalid.', 400, 'INVALID_SALARY_ID');
  }

  try {
    const db = await getDb();
    ensureTables(db);

    db.run('DELETE FROM hr_salaries WHERE id = ?', [id]);
    const changes = getChanges(db);

    if (changes === 0) {
      throw new AppError('Înregistrarea salarială nu a fost găsită.', 404, 'SALARY_NOT_FOUND');
    }

    return true;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      `Eroare la ștergerea salariului: ${err.message}`,
      500,
      'DB_DELETE_ERROR'
    );
  }
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
async function countSalaries(tenantId, options = {}) {
  if (!tenantId || !isValidId(tenantId)) {
    return 0;
  }

  try {
    const db = await getDb();
    ensureTables(db);

    const conditions = ['tenantId = ?'];
    const params = [tenantId.trim()];

    if (options.employeeId && isValidId(options.employeeId)) {
      conditions.push('employeeId = ?');
      params.push(options.employeeId.trim());
    }

    if (options.period) {
      conditions.push('period = ?');
      params.push(options.period);
    }

    if (options.status && isValidSalaryStatus(options.status)) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    const whereClause = conditions.join(' AND ');

    const row = dbGet(
      db,
      `SELECT COUNT(*) AS cnt FROM hr_salaries WHERE ${whereClause}`,
      params
    );

    return row ? row.cnt : 0;
  } catch (err) {
    throw new AppError(
      `Eroare la numărarea salariilor: ${err.message}`,
      500,
      'DB_COUNT_ERROR'
    );
  }
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