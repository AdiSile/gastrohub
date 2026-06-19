// ---------------------------------------------------------------------------
// config/tenant.js — Helperi multi-tenancy
// ---------------------------------------------------------------------------
// Oferă funcţii pentru instanţierea şi configurarea tenant-ilor.
// Fiecare tenant primeşte un fişier NeDB propriu (tenants/<slug>.db),
// astfel încât datele operaţionale rămân izolate la nivel de organizaţie.
// ---------------------------------------------------------------------------

const path = require('path');
const Datastore = require('nedb');
const { tenants, dataDir } = require('./db');

// ---------------------------------------------------------------------------
// Bază de date per tenant (cache)
// ---------------------------------------------------------------------------

/**
 * Mapă care reţine referinţele către bazele de date deja deschise.
 * Cheia este slug-ul tenant-ului, valoarea este instanţa NeDB.
 * @type {Map<string, Datastore>}
 */
const tenantDbCache = new Map();

/**
 * Configurează şi deschide baza de date NeDB dedicată unui tenant.
 *
 * @param {string}  tenantSlug - Identificatorul unic al tenant-ului (ex: "restaurant-abc")
 * @param {boolean} [forceNew=false] - Dacă `true`, ignoră cache-ul şi creează o instanţă proaspătă.
 * @returns {Datastore} Instanţa NeDB asociată tenant-ului.
 */
function getTenantDb(tenantSlug, forceNew = false) {
  // Validare parametru
  if (!tenantSlug || typeof tenantSlug !== 'string') {
    throw new Error('[tenant] getTenantDb: tenantSlug trebuie să fie un string nevid.');
  }

  // Dacă nu forţăm re-crearea şi există deja în cache, returnăm instanţa existentă
  if (!forceNew && tenantDbCache.has(tenantSlug)) {
    return tenantDbCache.get(tenantSlug);
  }

  // Determinare cale fişier
  const tenantDir = path.join(dataDir, 'tenants');

  // NeDB creează directorul intermediar dacă nu există la autoload,
  // dar pentru siguranţă încercăm să existe mai întâi directorul tenant-ilor
  const fs = require('fs');
  if (!fs.existsSync(tenantDir)) {
    fs.mkdirSync(tenantDir, { recursive: true });
  }

  const dbPath = path.join(tenantDir, `${tenantSlug}.db`);

  // În test (NODE_ENV=test) folosim doar baza în-memory
  const isTest = process.env.NODE_ENV === 'test';

  const db = new Datastore({
    filename: isTest ? undefined : dbPath,
    autoload: true,
    timestampData: false,
  });

  // Index implicit pe `_id` asigură unicitatea, dar adăugăm indexare utilă
  db.ensureIndex({ fieldName: 'type', sparse: true }, (err) => {
    if (err) {
      console.error(`[tenant] Eroare index type pentru ${tenantSlug}:`, err.message);
    }
  });

  // Stocăm în cache şi returnăm
  tenantDbCache.set(tenantSlug, db);
  return db;
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
 * Recuperează configuraţia unui tenant din colecţia `tenants`.
 * Dacă tenant-ul nu este găsit, aruncă o eroare.
 *
 * @param {string} tenantSlug - Slug-ul tenant-ului.
 * @returns {Promise<Object>} Obiectul de configurare al tenant-ului.
 */
function getTenantConfig(tenantSlug) {
  return new Promise((resolve, reject) => {
    if (!tenantSlug || typeof tenantSlug !== 'string') {
      return reject(new Error('[tenant] getTenantConfig: tenantSlug trebuie să fie un string nevid.'));
    }

    tenants.findOne({ slug: tenantSlug }, (err, doc) => {
      if (err) {
        return reject(new Error(`[tenant] Eroare la căutarea tenant-ului "${tenantSlug}": ${err.message}`));
      }
      if (!doc) {
        return reject(new Error(`[tenant] Tenant-ul "${tenantSlug}" nu a fost găsit.`));
      }

      // Îmbinăm configuraţia din document cu valorile implicite
      const config = {
        ...DEFAULT_TENANT_CONFIG,
        ...(doc.config || {}),
        // Păstrăm slug-ul şi numele din document
        slug: doc.slug,
        name: doc.name,
      };

      resolve(config);
    });
  });
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  getTenantDb,
  getTenantConfig,
  DEFAULT_TENANT_CONFIG,
};