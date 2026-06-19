const express = require('express');
const path = require('path');
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
// Pornire server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[GastroHub] Server pornit pe portul ${PORT}`);
  console.log(`[GastroHub] Mediul: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;