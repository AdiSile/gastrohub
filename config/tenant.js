// ---------------------------------------------------------------------------
// config/tenant.js — Helperi multi-tenancy
// ---------------------------------------------------------------------------
// Oferă funcţii pentru instanţierea şi configurarea tenant-ilor.
// Folosește SQLite (sql.js) partajat – getTenantDb() returnează aceeași
// instanță getDb() pentru toți tenant-ii, delegând izolarea datelor către
// coloana `tenantId` din tabelele SQLite.
// ---------------------------------------------------------------------------

const { getDb, get, run, all } = require('./db');

// ---------------------------------------------------------------------------
// Bază de date per tenant (instanță partajată SQLite)
// ---------------------------------------------------------------------------

/**
 * Returnează instanța partajată SQLite (sql.js).
 * Parametrii `tenantSlug` și `forceNew` sunt păstrați pentru compatibilitate
 * cu semnătura anterioară, dar nu mai influențează crearea de fișiere per-tenant.
 *
 * @param {string}  tenantSlug - Identificatorul unic al tenant-ului (păstrat pentru compatibilitate)
 * @param {boolean} [forceNew=false] - Ignorat; păstrat pentru compatibilitate
 * @returns {Object} Instanța sql.js Database
 */
function getTenantDb(tenantSlug, forceNew = false) {
  // Validare parametru (păstrată pentru compatibilitate)
  if (!tenantSlug || typeof tenantSlug !== 'string') {
    throw new Error('[tenant] getTenantDb: tenantSlug trebuie să fie un string nevid.');
  }

  // Returnează instanța SQLite partajată
  return getDb();
}

// ---------------------------------------------------------------------------
// Configurare per tenant
// ---------------------------------------------------------------------------

/**
 * Configuraţie implicită aplicabilă oricărui tenant nou.
 * @type {Object}
 */
const DEFAULT_TENANT_CONFIG = Object.freeze({
  timezone: 'Europe/Bucharest',
  currency: 'RON',
  language: 'ro',
  dateFormat: 'DD.MM.YYYY',
  maxUsers: 50,
  maxRestaurants: 5,
  features: {
    onlineOrders: false,
    loyaltyProgram: false,
    analytics: false,
    reservations: true,
    inventory: false,
  },
});

/**
 * Recuperează configuraţia unui tenant din tabela `tenants` (SQLite).
 * Dacă tenant-ul nu este găsit, aruncă o eroare.
 *
 * @param {string} tenantSlug - Slug-ul tenant-ului.
 * @returns {Promise<Object>} Obiectul de configurare al tenant-ului.
 */
async function getTenantConfig(tenantSlug) {
  if (!tenantSlug || typeof tenantSlug !== 'string') {
    throw new Error('[tenant] getTenantConfig: tenantSlug trebuie să fie un string nevid.');
  }

  try {
    // Interogare SQLite – settings este coloana cu config-ul (JSON)
    const doc = await get(
      'SELECT name, slug, settings FROM tenants WHERE slug = ?',
      [tenantSlug]
    );

    if (!doc) {
      throw new Error(`[tenant] Tenant-ul "${tenantSlug}" nu a fost găsit.`);
    }

    // Parsează settings (JSON) din coloană; fallback la obiect gol
    let tenantConfig = {};
    if (doc.settings) {
      try {
        tenantConfig = typeof doc.settings === 'string'
          ? JSON.parse(doc.settings)
          : doc.settings;
      } catch (_parseErr) {
        tenantConfig = {};
      }
    }

    // Îmbinăm configuraţia din document cu valorile implicite
    const config = {
      ...DEFAULT_TENANT_CONFIG,
      ...tenantConfig,
      slug: doc.slug,
      name: doc.name,
    };

    return config;
  } catch (err) {
    throw new Error(`[tenant] Eroare la căutarea tenant-ului "${tenantSlug}": ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  getTenantDb,
  getTenantConfig,
  DEFAULT_TENANT_CONFIG,
};