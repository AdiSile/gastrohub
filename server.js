const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Referință persistentă la modulul de bază de date
// (partajat între initDb și handler-ele de shutdown)
// ---------------------------------------------------------------------------
/** @type {Object|null} */
let dbModule = null;

// ---------------------------------------------------------------------------
// Middleware globale
// ---------------------------------------------------------------------------

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Fișiere statice – portal client
// ---------------------------------------------------------------------------

app.use('/customer', express.static(path.join(__dirname, 'customer', 'public')));
app.use('/customer/css', express.static(path.join(__dirname, 'customer', 'public', 'css')));
app.use('/customer/js', express.static(path.join(__dirname, 'customer', 'public', 'js')));

// ---------------------------------------------------------------------------
// Fișiere statice – PWA (Progressive Web App)
// ---------------------------------------------------------------------------

app.use('/pwa', express.static(path.join(__dirname, 'public', 'pwa')));

// ---------------------------------------------------------------------------
// Rute PWA
// ---------------------------------------------------------------------------

// Servește manifest.json pentru PWA
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pwa', 'manifest.json'));
});

// Servește service worker-ul pentru PWA (la rădăcină pentru scope corect)
app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pwa', 'sw.js'));
});

// ---------------------------------------------------------------------------
// Rute API – Module operaționale
// ---------------------------------------------------------------------------

// Autentificare
app.use('/api/auth', require('./routes/auth'));

// Restaurante
app.use('/api/restaurants', require('./routes/restaurants'));

// Hoteluri
app.use('/api/hotels', require('./routes/hotels'));

// Rezervări
app.use('/api/reservations', require('./routes/reservations'));

// Comenzi (restaurant)
app.use('/api/orders', require('./routes/orders'));

// Livrări (inventar / furnizori)
app.use('/api/deliveries', require('./routes/deliveries'));

// Resurse umane
app.use('/api/hr', require('./routes/hr'));

// Inventar
app.use('/api/inventory', require('./routes/inventory'));

// Furnizori
app.use('/api/suppliers', require('./routes/suppliers'));

// ---------------------------------------------------------------------------
// Rute module client & loialitate
// ---------------------------------------------------------------------------

app.use('/api/loyalty', require('./routes/loyalty'));

// ---------------------------------------------------------------------------
// Rute de vizualizare (EJS) – portal client
// ---------------------------------------------------------------------------

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'customer', 'views'));

// Portal client – rute de vizualizare (prefix /customer)
const customerRoutes = require('./customer/routes');
app.use('/customer', customerRoutes);

// ---------------------------------------------------------------------------
// Rute de administrare (prefix /admin)
// ---------------------------------------------------------------------------

// Rute de vizualizare administrare
app.use('/admin', require('./admin/routes'));

// ---------------------------------------------------------------------------
// Rute modul hotel (prefix /hotel)
// ---------------------------------------------------------------------------

app.use('/hotel', require('./hotel/routes'));

// ---------------------------------------------------------------------------
// Rute modul restaurant (prefix /restaurant)
// ---------------------------------------------------------------------------

app.use('/restaurant', require('./restaurant/routes'));

// ---------------------------------------------------------------------------
// Ruta rădăcină – redirect automat către portalul client
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
  res.redirect('/customer');
});

// ---------------------------------------------------------------------------
// Middleware de erori (ultimul)
// ---------------------------------------------------------------------------

const { errorHandler } = require('./middleware/errorHandler');
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Inițializare bază de date + Pornire server
// ---------------------------------------------------------------------------

/**
 * Funcție robustă de inițializare a bazei de date (async).
 *
 * Responsabilități:
 *  1. Verifică existența directorului `data/` și îl creează dacă nu există.
 *  2. Încarcă modulul `config/db` și așteaptă `getDb()` async.
 *  3. Verifică disponibilitatea bazei de date SQLite.
 *  4. Înregistrează handler-e pentru SIGINT / SIGTERM care salvează baza
 *     de date SQLite în `data/gastrohub.db` folosind `saveDb()`.
 *  5. Loghează erorile fără a opri serverul – promisiunea se resolve întotdeauna.
 *
 * @returns {Promise<void>} Promisiune care se rezolvă după verificarea bazei de date.
 */
async function initDb() {
  // ------------------------------------------------------------------
  // 1. Verifică / creează directorul data/
  // ------------------------------------------------------------------
  const dataDir = path.resolve(process.env.DB_PATH || path.join(__dirname, 'data'));

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log(`[GastroHub] Directorul ${dataDir} a fost creat.`);
    } else {
      console.log(`[GastroHub] Directorul ${dataDir} există deja.`);
    }
  } catch (err) {
    console.error(
      `[GastroHub] Eroare la verificarea/crearea directorului ${dataDir}:`,
      err.message
    );
    console.warn('[GastroHub] Se continuă fără garanția că directorul de date există.');
  }

  // ------------------------------------------------------------------
  // 2. Încarcă modulul de bază de date și așteaptă inițializarea async
  //    (getDb() pornește sql.js WebAssembly + creează tabelele)
  // ------------------------------------------------------------------
  try {
    dbModule = require('./config/db');
    console.log('[GastroHub] Modulul config/db a fost încărcat.');
  } catch (err) {
    console.error('[GastroHub] Eroare la încărcarea config/db:', err.message);
    console.warn('[GastroHub] Se continuă fără bază de date.');
    return;
  }

  // ------------------------------------------------------------------
  // 3. Așteaptă inițializarea async a bazei de date SQLite
  // ------------------------------------------------------------------
  try {
    await dbModule.getDb();
    console.log('[GastroHub] Baza de date SQLite este operațională.');
  } catch (err) {
    console.error('[GastroHub] Eroare la inițializarea async a bazei de date SQLite:', err.message);
    console.warn('[GastroHub] Se continuă fără bază de date.');
    return;
  }

  // ------------------------------------------------------------------
  // 4. Verifică existența tabelei tenants (sanity check)
  // ------------------------------------------------------------------
  try {
    const tenantDb = await dbModule.getDb();
    const stmt = tenantDb.prepare('SELECT COUNT(*) AS cnt FROM tenants');
    let tenantCount = 0;
    if (stmt.step()) {
      tenantCount = stmt.getAsObject().cnt;
    }
    stmt.free();
    console.log(`[GastroHub] Tabela tenants conține ${tenantCount} înregistrări.`);
  } catch (err) {
    console.warn('[GastroHub] Nu s-a putut verifica tabela tenants:', err.message);
  }

  console.log('[GastroHub] Verificarea bazei de date s-a încheiat.');
}

// ------------------------------------------------------------------
// Salvarea bazei de date la oprire (graceful shutdown)
// ------------------------------------------------------------------

/**
 * Salvează baza de date SQLite pe disc în `data/gastrohub.db`.
 *
 * Folosește funcția `saveDb()` exportată de `config/db`,
 * care scrie atomic conținutul bazei de date pe disc.
 */
function shutdownSaveDb() {
  if (!dbModule) {
    console.log('[GastroHub] Modulul config/db nu este încărcat – shutdown fără salvare SQLite.');
    return;
  }

  if (typeof dbModule.saveDb !== 'function') {
    console.log('[GastroHub] Funcția saveDb nu este disponibilă – shutdown fără salvare.');
    return;
  }

  try {
    dbModule.saveDb();
    console.log('[GastroHub] Baza de date salvată cu succes.');
  } catch (err) {
    console.error('[GastroHub] Eroare la salvarea bazei de date în shutdown:', err.message);
  }
}

/**
 * Handler pentru semnalele de terminare (SIGINT / SIGTERM).
 * Salvează baza de date, apoi închide procesul.
 */
function gracefulShutdown(signal) {
  console.log(`[GastroHub] Semnal ${signal} primit – se salvează baza de date...`);
  shutdownSaveDb();
  console.log('[GastroHub] Serverul se oprește.');
  process.exit(0);
}

// Înregistrează handler-ele pentru shutdown
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ------------------------------------------------------------------
// Pornire server – tratează respingerea cu console.error și continuă
// ------------------------------------------------------------------
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[GastroHub] Server pornit pe portul ${PORT}`);
      console.log(`[GastroHub] Mediul: ${process.env.NODE_ENV || 'development'}`);
    });
  })
  .catch((err) => {
    // Siguranță: dacă initDb() a aruncat o excepție sincronă neprevăzută
    console.error('[GastroHub] Eroare neașteptată la inițializarea bazei de date:', err);
    console.warn('[GastroHub] Se pornește serverul în mod degradat.');
    app.listen(PORT, () => {
      console.log(`[GastroHub] Server pornit pe portul ${PORT} (mod degradat)`);
      console.log(`[GastroHub] Mediul: ${process.env.NODE_ENV || 'development'}`);
    });
  });

module.exports = app;