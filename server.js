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
 *  2. Încarcă și verifică toate colecțiile NeDB.
 *  3. Loghează erorile fără a opri serverul – promisiunea se resolve întotdeauna.
 *
 * @returns {Promise<void>} Promisiune care se rezolvă după verificarea tuturor colecțiilor.
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
    /** @type {Object} */
    let db;
    try {
      db = require('./config/db');
      console.log('[GastroHub] Modulul config/db a fost încărcat.');
    } catch (err) {
      console.error('[GastroHub] Eroare la încărcarea config/db:', err.message);
      console.warn('[GastroHub] Se continuă fără bază de date.');
      return resolve();
    }

    // ------------------------------------------------------------------
    // 3. Verifică fiecare colecție NeDB printr-un findOne inofensiv
    // ------------------------------------------------------------------
    const collections = [
      { name: 'users',                   ref: db.users },
      { name: 'tenants',                 ref: db.tenants },
      { name: 'restaurants',             ref: db.restaurants },
      { name: 'hotels',                  ref: db.hotels },
      { name: 'reservations',            ref: db.reservations },
      { name: 'inventoryItems',          ref: db.inventoryItems },
      { name: 'inventoryTransactions',   ref: db.inventoryTransactions },
      { name: 'suppliers',               ref: db.suppliers },
      { name: 'deliveries',              ref: db.deliveries },
      { name: 'attendance',              ref: db.attendance },
      { name: 'salaries',                ref: db.salaries },
    ];

    if (collections.length === 0) {
      console.log('[GastroHub] Nu există colecții NeDB de verificat.');
      return resolve();
    }

    let pending = collections.length;

    collections.forEach(({ name, ref }) => {
      if (!ref || typeof ref.findOne !== 'function') {
        console.error(
          `[GastroHub] Colecția "${name}" nu este un Datastore NeDB valid (findOne lipsește).`
        );
        pending--;
        if (pending === 0) {
          console.log('[GastroHub] Verificarea colecțiilor NeDB s-a încheiat (cu erori).');
          resolve();
        }
        return;
      }

      ref.findOne({ _id: '__init_check__' }, (err) => {
        if (err) {
          console.error(
            `[GastroHub] Eroare la verificarea colecției "${name}":`,
            err.message
          );
        } else {
          console.log(`[GastroHub] Colecția "${name}" este operațională.`);
        }
        pending--;
        if (pending === 0) {
          console.log('[GastroHub] Toate colecțiile NeDB au fost verificate.');
          resolve();
        }
      });
    });
  });
}

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