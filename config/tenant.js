// ---------------------------------------------------------------------------
// config/tenant.js — Helperi multi-tenancy
// ---------------------------------------------------------------------------
// Oferă funcţii pentru instanţierea şi configurarea tenant-ilor.
// Fiecare tenant primeşte un fişier NeDB propriu (tenants/<slug>.db),
// astfel încât datele operaţionale rămân izolate la nivel de organizaţie.
// ---------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');
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
 * Set care urmăreşte tenant-ii pentru care s-a declanşat deja recreerea,
 * prevenind bucle infinite în cazul unor coruperi repetate.
 * @type {Set<string>}
 */
const _recreating = new Set();

/**
 * Creează o instanță NeDB cu handler de eroare la încărcare.
 * Dacă fișierul `.db` este corupt, îl șterge și recreează baza de date.
 *
 * @param {string}  dbPath     - Calea completă către fișierul `.db`
 * @param {boolean} isTest     - Dacă `true`, baza va fi în memorie (fără fișier)
 * @param {string}  tenantSlug - Slug-ul tenant-ului (pentru logging)
 * @returns {Datastore} Instanța NeDB (nouă sau recreată)
 */
function _createTenantDbInstance(dbPath, isTest, tenantSlug) {
  if (isTest) {
    return new Datastore({
      filename: undefined,
      autoload: true,
      timestampData: false,
    });
  }

  /**
   * Încearcă să instanțieze NeDB cu încărcare sincronă.
   * NeDB, în mod sincron (fără callback), aruncă eroare dacă fișierul
   * nu poate fi citit sau conține date corupte irecuperabile.
   */
  try {
    const db = new Datastore({
      filename: dbPath,
      autoload: true,
      timestampData: false,
    });

    // Handler asincron suplimentar: unele coruperi pot apărea după ce
    // instanța a fost deja returnată (de exemplu, în timpul compactării).
    // Înregistrăm un handler pe evenimentele interne de eroare.
    db.on('error', (err) => {
      console.error(
        `[tenant] Eroare asincronă NeDB pentru "${tenantSlug}" (${dbPath}):`,
        err.message,
      );
    });

    return db;
  } catch (loadErr) {
    // ------------------------------------------------------------------
    // Fișier corupt detectat → ștergem și recreeăm
    // ------------------------------------------------------------------
    console.error(
      `[tenant] Fișier corupt detectat pentru "${tenantSlug}" la ${dbPath}: ${loadErr.message}`,
    );
    console.error('[tenant] Se șterge fișierul corupt și se recreează baza de la zero.');

    // Prevenim bucle infinite: dacă deja am încercat recreerea și tot eșuează, cedăm
    if (_recreating.has(tenantSlug)) {
      _recreating.delete(tenantSlug);
      throw new Error(
        `[tenant] Nu s-a putut recrea baza pentru "${tenantSlug}" după ștergerea fișierului corupt: ${loadErr.message}`,
      );
    }
    _recreating.add(tenantSlug);

    // Ștergem fișierul corupt
    try {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        console.error(`[tenant] Fișierul corupt ${dbPath} a fost șters.`);
      }
    } catch (unlinkErr) {
      console.error(`[tenant] Nu s-a putut șterge fișierul corupt ${dbPath}: ${unlinkErr.message}`);
      _recreating.delete(tenantSlug);
      throw new Error(
        `[tenant] Eroare la ștergerea fișierului corupt pentru "${tenantSlug}": ${unlinkErr.message}`,
      );
    }

    // Recreeăm baza de date de la zero (fișierul nu mai există, NeDB îl va recrea)
    try {
      const freshDb = new Datastore({
        filename: dbPath,
        autoload: true,
        timestampData: false,
      });

      console.error(`[tenant] Baza de date pentru "${tenantSlug}" a fost recreată cu succes.`);
      _recreating.delete(tenantSlug);
      return freshDb;
    } catch (recreateErr) {
      _recreating.delete(tenantSlug);
      throw new Error(
        `[tenant] Eroare la recrearea bazei pentru "${tenantSlug}": ${recreateErr.message}`,
      );
    }
  }
}

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

  // Dacă forţăm re-crearea, scoatem din cache şi lăsăm să se recreeze
  if (forceNew) {
    tenantDbCache.delete(tenantSlug);
  }

  // Determinare cale fişier
  const tenantDir = path.join(dataDir, 'tenants');

  // NeDB creează directorul intermediar dacă nu există la autoload,
  // dar pentru siguranţă încercăm să existe mai întâi directorul tenant-ilor
  if (!fs.existsSync(tenantDir)) {
    fs.mkdirSync(tenantDir, { recursive: true });
  }

  const dbPath = path.join(tenantDir, `${tenantSlug}.db`);

  // În test (NODE_ENV=test) folosim doar baza în-memory
  const isTest = process.env.NODE_ENV === 'test';

  // Creează instanța cu handler de corupere integrat
  const db = _createTenantDbInstance(dbPath, isTest, tenantSlug);

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