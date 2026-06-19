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
 * Funcție robustă de inițializare a bazei de date.
 *
 * Responsabilități:
 *  1. Verifică existența directorului `data/` și îl creează dacă nu există.
 *  2. Încarcă modulul `config/db` (trigger pentru SQLite).
 *  3. Verifică disponibilitatea bazei de date SQLite.
 *  4. Înregistrează handler-e pentru SIGINT / SIGTERM care salvează baza
 *     de date SQLite în `data/gastrohub.db` folosind `db.export()`.
 *  5. Loghează erorile fără a opri serverul – promisiunea se resolve întotdeauna.
 *
 * @returns {Promise<void>} Promisiune care se rezolvă după verificarea bazei de date.
 */
function initDb() {
  return new Promise((resolve) => {
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
    // 2. Încarcă modulul de bază de date (trigger pentru inițializarea
    //    colecțiilor NeDB + SQLite la primul require)
    // ------------------------------------------------------------------
    try {
      dbModule = require('./config/db');
      console.log('[GastroHub] Modulul config/db a fost încărcat.');
    } catch (err) {
      console.error('[GastroHub] Eroare la încărcarea config/db:', err.message);
      console.warn('[GastroHub] Se continuă fără bază de date.');
      return resolve();
    }

    // ------------------------------------------------------------------
    // 3. Verifică disponibilitatea bazei de date SQLite
    // ------------------------------------------------------------------
    try {
      const testRow = dbModule.get('SELECT 1 AS ok');
      if (testRow && testRow.ok === 1) {
        console.log('[GastroHub] Baza de date SQLite este operațională.');
      } else {
        console.warn('[GastroHub] Verificarea bazei de date SQLite a returnat un rezultat neașteptat.');
      }
    } catch (err) {
      console.error('[GastroHub] Eroare la verificarea bazei de date SQLite:', err.message);
    }

    // Verifică existența tabelei tenants (sanity check)
    try {
      const tenantCount = dbModule.get('SELECT COUNT(*) AS cnt FROM tenants');
      console.log(`[GastroHub] Tabela tenants conține ${tenantCount ? tenantCount.cnt : 0} înregistrări.`);
    } catch (err) {
      console.warn('[GastroHub] Nu s-a putut verifica tabela tenants:', err.message);
    }

    console.log('[GastroHub] Verificarea bazei de date s-a încheiat.');
    resolve();
  });
}

// ------------------------------------------------------------------
// Salvarea bazei de date la oprire (graceful shutdown)
// ------------------------------------------------------------------

/**
 * Salvează baza de date SQLite pe disc în `data/gastrohub.db`.
 *
 * Folosește `db.export()` de la sql.js pentru a obține un ArrayBuffer
 * cu întreaga bază de date, apoi îl scrie atomic pe disc cu `fs.writeFileSync`.
 */
function shutdownSaveDb() {
  if (!dbModule) {
    console.log('[GastroHub] Modulul config/db nu este încărcat – shutdown fără salvare SQLite.');
    return;
  }

  /** @type {Object|null} */
  let dbInstance;
  try {
    dbInstance = dbModule.getDb();
  } catch (_err) {
    console.log('[GastroHub] Instanța SQLite nu este disponibilă – shutdown fără salvare.');
    return;
  }

  if (!dbInstance || typeof dbInstance.export !== 'function') {
    console.log('[GastroHub] Instanța SQLite nu are metoda export – shutdown fără salvare.');
    return;
  }

  const DB_PATH = path.join(__dirname, 'data', 'gastrohub.db');

  try {
    // Asigură directorul data/ înainte de scriere
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Exportă baza de date ca ArrayBuffer și scrie pe disc
    const data = dbInstance.export();
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    fs.writeFileSync(DB_PATH, buffer);
    console.log(`[GastroHub] Baza de date salvată cu succes în ${DB_PATH}`);
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