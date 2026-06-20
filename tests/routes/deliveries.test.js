/**
 * ============================================================
 * tests/routes/deliveries.test.js - Teste pentru rutele de livrări
 * ============================================================
 *
 * Acoperă:
 *   1. GET    /api/deliveries                     – Listare livrări
 *   2. GET    /api/deliveries/:id                 – Detalii livrare
 *   3. POST   /api/deliveries                     – Creare livrare
 *   4. PUT    /api/deliveries/:id                 – Actualizare livrare
 *   5. PATCH  /api/deliveries/:id/status          – Actualizare status
 *   6. DELETE /api/deliveries/:id                 – Ștergere livrare
 *   7. GET    /api/deliveries/status/:status      – Filtrare după status
 *   8. GET    /api/deliveries/supplier/:supplierId– Filtrare după furnizor
 *   9. GET    /api/deliveries/location/:locationId– Filtrare după locație
 *  10. GET    /api/deliveries/date-range          – Filtrare după interval
 *
 * Cerințe:
 *  - 80%+ branches, functions, lines, statements
 * ============================================================
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-deliveries-2025';
process.env.DB_PATH = './data_test';

const request = require('supertest');
const { expect } = require('chai');
const { describe, it, before, after, beforeEach } = require('mocha');

const app = require('../server');
const { getDb } = require('../config/db');

// ---------------------------------------------------------------------------
// Helperi pentru test
// ---------------------------------------------------------------------------

/**
 * Generează un token JWT pentru un utilizator de test.
 * @param {Object} overrides - Suprascrieri pentru utilizator
 * @returns {string} Token JWT
 */
function generateTestToken(overrides = {}) {
  const jwt = require('jsonwebtoken');
  const payload = {
    sub: overrides._id || '999',
    email: overrides.email || 'test@deliveries.test',
    role: overrides.role || 'bucătar',
    tenantId: overrides.tenantId || 'tenant-deliveries-001',
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

/**
 * Creează un utilizator de test direct în baza de date.
 */
async function seedTestUser(db, overrides = {}) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('parola123', 4);

  db.run(
    `INSERT INTO users (email, password, role, tenant_id, name)
     VALUES (?, ?, ?, ?, ?)`,
    [
      overrides.email || 'test@deliveries.test',
      hash,
      overrides.role || 'bucătar',
      overrides.tenantId || 'tenant-deliveries-001',
      overrides.name || 'Test User',
    ]
  );

  const result = db.exec('SELECT last_insert_rowid() AS id');
  const id = result[0].values[0][0];
  return String(id);
}

/**
 * Inserează o livrare de test direct în baza de date.
 */
function seedTestDelivery(db, overrides = {}) {
  const now = new Date().toISOString();
  const items = overrides.items || [
    { itemId: 'itm-001', itemName: 'Roșii cherry', quantity: 10, unit: 'kg', price: 15.50 },
    { itemId: 'itm-002', itemName: 'Busuioc proaspăt', quantity: 2, unit: 'kg', price: 40.00 },
  ];

  const totalValue = items.reduce((sum, i) => sum + (i.quantity * i.price), 0);

  db.run(
    `INSERT INTO deliveries
       (supplierId, items, status, totalValue, orderDate,
        estimatedDelivery, actualDelivery, notes,
        locationId, locationType, tenantId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      overrides.supplierId || 'sup-001',
      JSON.stringify(items),
      overrides.status || 'comandată',
      totalValue,
      overrides.orderDate || now,
      overrides.estimatedDelivery || null,
      overrides.actualDelivery || null,
      overrides.notes || '',
      overrides.locationId || 'loc-restaurant-001',
      overrides.locationType || 'restaurant',
      overrides.tenantId || 'tenant-deliveries-001',
      now,
      now,
    ]
  );

  const result = db.exec('SELECT last_insert_rowid() AS id');
  return String(result[0].values[0][0]);
}

// ---------------------------------------------------------------------------
// Hook-uri globale
// ---------------------------------------------------------------------------

let db;

before(async function () {
  this.timeout(15000);
  db = await getDb();

  // Asigură existența tabelei deliveries (nu este creată automat în config/db.js)
  db.run(`CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplierId TEXT NOT NULL,
    items TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'comandată',
    totalValue REAL DEFAULT 0,
    orderDate TEXT,
    estimatedDelivery TEXT,
    actualDelivery TEXT,
    notes TEXT DEFAULT '',
    locationId TEXT NOT NULL,
    locationType TEXT NOT NULL DEFAULT 'restaurant',
    tenantId TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  )`);

  // Indexuri pentru performanță
  try { db.run('CREATE INDEX IF NOT EXISTS idx_deliveries_tenantId ON deliveries (tenantId)'); } catch (_) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries (status)'); } catch (_) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_deliveries_supplierId ON deliveries (supplierId)'); } catch (_) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_deliveries_locationId ON deliveries (locationId)'); } catch (_) {}

  // Seed un utilizator de test
  await seedTestUser(db);
});

after(function () {
  // Curățare livrări de test
  if (db) {
    try { db.run("DELETE FROM deliveries WHERE tenantId LIKE 'tenant-deliveries%'"); } catch (_) {}
    try { db.run("DELETE FROM users WHERE email LIKE '%@deliveries.test'"); } catch (_) {}
  }
});

beforeEach(function () {
  // Curățare livrări înainte de fiecare test
  if (db) {
    try { db.run("DELETE FROM deliveries WHERE tenantId LIKE 'tenant-deliveries%'"); } catch (_) {}
  }
});

// ---------------------------------------------------------------------------
// 1. GET /api/deliveries – Listare livrări
// ---------------------------------------------------------------------------

describe('GET /api/deliveries', function () {
  this.timeout(10000);

  it('ar trebui să returneze 401 fără autentificare', function (done) {
    request(app)
      .get('/api/deliveries')
      .expect(401)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        done();
      });
  });

  it('ar trebui să returneze lista goală când nu există livrări', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        expect(res.body.data).to.be.an('object');
        expect(res.body.data.deliveries).to.be.an('array');
        expect(res.body.data.total).to.equal(0);
        done();
      });
  });

  it('ar trebui să returneze livrările existente', function (done) {
    seedTestDelivery(db, { tenantId: 'tenant-deliveries-001', status: 'comandată' });
    seedTestDelivery(db, {
      tenantId: 'tenant-deliveries-001',
      status: 'livrată',
      supplierId: 'sup-002',
      items: [{ itemId: 'itm-003', itemName: 'Ulei măsline', quantity: 5, unit: 'l', price: 35.00 }],
    });

    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        expect(res.body.data.deliveries).to.be.an('array');
        expect(res.body.data.deliveries.length).to.equal(2);
        expect(res.body.data.total).to.equal(2);
        done();
      });
  });

  it('ar trebui să filtreze după status', function (done) {
    seedTestDelivery(db, { tenantId: 'tenant-deliveries-001', status: 'comandată' });
    seedTestDelivery(db, { tenantId: 'tenant-deliveries-001', status: 'livrată' });

    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries?status=livrată')
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.data.deliveries).to.be.an('array');
        expect(res.body.data.deliveries.length).to.equal(1);
        expect(res.body.data.deliveries[0].status).to.equal('livrată');
        done();
      });
  });

  it('ar trebui să respingă un status invalid (422)', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries?status=status_invalid')
      .set('Cookie', `token=${token}`)
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să ofere paginare cu limit și skip', function (done) {
    for (let i = 0; i < 5; i++) {
      seedTestDelivery(db, {
        tenantId: 'tenant-deliveries-001',
        supplierId: `sup-${i}`,
        items: [{ itemId: `itm-${i}`, itemName: `Produs ${i}`, quantity: 1, unit: 'buc', price: 10 }],
      });
    }

    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries?limit=2&skip=1')
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.data.deliveries).to.be.an('array');
        expect(res.body.data.deliveries.length).to.be.at.most(2);
        expect(res.body.data.limit).to.equal(2);
        expect(res.body.data.skip).to.equal(1);
        expect(res.body.data.total).to.equal(5);
        done();
      });
  });

  it('ar trebui să respingă limit > 100 (422)', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries?limit=200')
      .set('Cookie', `token=${token}`)
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să respingă sortOrder invalid (422)', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries?sortOrder=invalid')
      .set('Cookie', `token=${token}`)
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });
});

// ---------------------------------------------------------------------------
// 2. GET /api/deliveries/:id – Detalii livrare
// ---------------------------------------------------------------------------

describe('GET /api/deliveries/:id', function () {
  this.timeout(10000);

  it('ar trebui să returneze 401 fără autentificare', function (done) {
    request(app)
      .get('/api/deliveries/999')
      .expect(401)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        done();
      });
  });

  it('ar trebui să returneze 404 pentru livrare inexistentă', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries/99999')
      .set('Cookie', `token=${token}`)
      .expect(404)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('DELIVERY_NOT_FOUND');
        done();
      });
  });

  it('ar trebui să returneze detaliile unei livrări existente', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-001' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get(`/api/deliveries/${deliveryId}`)
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        expect(res.body.data.delivery).to.be.an('object');
        expect(res.body.data.delivery._id).to.equal(deliveryId);
        expect(res.body.data.delivery.supplierId).to.equal('sup-001');
        expect(res.body.data.delivery.items).to.be.an('array');
        expect(res.body.data.delivery.status).to.equal('comandată');
        done();
      });
  });

  it('ar trebui să blocheze accesul la livrarea altui tenant (403)', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-002' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get(`/api/deliveries/${deliveryId}`)
      .set('Cookie', `token=${token}`)
      .expect(403)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('TENANT_MISMATCH');
        done();
      });
  });

  it('ar trebui să permită super_admin-ului să vadă orice livrare', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-002' });
    const token = generateTestToken({ role: 'super_admin', tenantId: 'tenant-admin' });

    request(app)
      .get(`/api/deliveries/${deliveryId}`)
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        expect(res.body.data.delivery._id).to.equal(deliveryId);
        done();
      });
  });
});

// ---------------------------------------------------------------------------
// 3. POST /api/deliveries – Creare livrare
// ---------------------------------------------------------------------------

describe('POST /api/deliveries', function () {
  this.timeout(10000);

  const validDeliveryBody = {
    supplierId: 'sup-001',
    items: [
      { itemId: 'itm-001', itemName: 'Roșii cherry', quantity: 10, unit: 'kg', price: 15.50 },
      { itemId: 'itm-002', itemName: 'Busuioc proaspăt', quantity: 2, unit: 'kg', price: 40.00 },
    ],
    locationId: 'loc-restaurant-001',
    locationType: 'restaurant',
    notes: 'Livrare prioritară',
  };

  it('ar trebui să returneze 401 fără autentificare', function (done) {
    request(app)
      .post('/api/deliveries')
      .send(validDeliveryBody)
      .expect(401)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        done();
      });
  });

  it('ar trebui să creeze o livrare cu date valide', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send(validDeliveryBody)
      .expect(201)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        expect(res.body.data.delivery).to.be.an('object');
        expect(res.body.data.delivery._id).to.be.a('string');
        expect(res.body.data.delivery.supplierId).to.equal('sup-001');
        expect(res.body.data.delivery.status).to.equal('comandată');
        expect(res.body.data.delivery.items).to.be.an('array');
        expect(res.body.data.delivery.items.length).to.equal(2);
        expect(res.body.data.delivery.locationId).to.equal('loc-restaurant-001');
        expect(res.body.data.delivery.locationType).to.equal('restaurant');
        expect(res.body.data.delivery.totalValue).to.be.closeTo(155 + 80, 0.01);
        done();
      });
  });

  it('ar trebui să creeze o livrare cu status explicit', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send({ ...validDeliveryBody, status: 'în tranzit' })
      .expect(201)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.data.delivery.status).to.equal('în tranzit');
        done();
      });
  });

  it('ar trebui să respingă date fără supplierId (422)', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send({ ...validDeliveryBody, supplierId: undefined })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să respingă items gol (422)', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send({ ...validDeliveryBody, items: [] })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să respingă items fără itemId (422)', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send({
        ...validDeliveryBody,
        items: [{ itemName: 'Fără ID', quantity: 1, unit: 'kg', price: 10 }],
      })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să respingă unitate invalidă (422)', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send({
        ...validDeliveryBody,
        items: [{ itemId: 'itm-001', itemName: 'X', quantity: 1, unit: 'tone', price: 10 }],
      })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să respingă quantity negativ (422)', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send({
        ...validDeliveryBody,
        items: [{ itemId: 'itm-001', itemName: 'X', quantity: -5, unit: 'kg', price: 10 }],
      })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să respingă price negativ (422)', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send({
        ...validDeliveryBody,
        items: [{ itemId: 'itm-001', itemName: 'X', quantity: 1, unit: 'kg', price: -10 }],
      })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să respingă fără locationId (422)', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send({ ...validDeliveryBody, locationId: undefined })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să respingă locationType invalid (422)', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send({ ...validDeliveryBody, locationType: 'cafenea' })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să respingă status invalid (422)', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send({ ...validDeliveryBody, status: 'inexistent' })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să respingă notes prea lungi (422)', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send({ ...validDeliveryBody, notes: 'x'.repeat(2001) })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să creeze livrare cu note la limita maximă (2000 caractere)', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send({ ...validDeliveryBody, notes: 'x'.repeat(2000) })
      .expect(201)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        expect(res.body.data.delivery.notes.length).to.equal(2000);
        done();
      });
  });

  it('ar trebui să respingă fără tenant (400 când nu ai tenantId)', function (done) {
    // Token fără tenantId
    const token = generateTestToken({ tenantId: null, role: 'bucătar' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send(validDeliveryBody)
      .expect(400)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('MISSING_TENANT_ID');
        done();
      });
  });

  it('ar trebui să funcționeze cu locationType "hotel"', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send({ ...validDeliveryBody, locationType: 'hotel', locationId: 'loc-hotel-001' })
      .expect(201)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        expect(res.body.data.delivery.locationType).to.equal('hotel');
        done();
      });
  });
});

// ---------------------------------------------------------------------------
// 4. PUT /api/deliveries/:id – Actualizare livrare
// ---------------------------------------------------------------------------

describe('PUT /api/deliveries/:id', function () {
  this.timeout(10000);

  it('ar trebui să returneze 401 fără autentificare', function (done) {
    request(app)
      .put('/api/deliveries/999')
      .send({ status: 'livrată' })
      .expect(401)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        done();
      });
  });

  it('ar trebui să returneze 404 pentru livrare inexistentă', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .put('/api/deliveries/99999')
      .set('Cookie', `token=${token}`)
      .send({ status: 'livrată' })
      .expect(404)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('DELIVERY_NOT_FOUND');
        done();
      });
  });

  it('ar trebui să actualizeze statusul unei livrări', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-001' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .put(`/api/deliveries/${deliveryId}`)
      .set('Cookie', `token=${token}`)
      .send({ status: 'livrată' })
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        expect(res.body.data.delivery.status).to.equal('livrată');
        done();
      });
  });

  it('ar trebui să actualizeze notele unei livrări', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-001' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .put(`/api/deliveries/${deliveryId}`)
      .set('Cookie', `token=${token}`)
      .send({ notes: 'Note actualizate' })
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.data.delivery.notes).to.equal('Note actualizate');
        done();
      });
  });

  it('ar trebui să actualizeze itemii și să recalculeze totalValue', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-001' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    const newItems = [
      { itemId: 'itm-new', itemName: 'Produs nou', quantity: 3, unit: 'buc', price: 25.00 },
    ];

    request(app)
      .put(`/api/deliveries/${deliveryId}`)
      .set('Cookie', `token=${token}`)
      .send({ items: newItems })
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.data.delivery.items).to.be.an('array');
        expect(res.body.data.delivery.items.length).to.equal(1);
        expect(res.body.data.delivery.items[0].itemName).to.equal('Produs nou');
        expect(res.body.data.delivery.totalValue).to.be.closeTo(75, 0.01);
        done();
      });
  });

  it('ar trebui să respingă body gol (400)', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-001' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .put(`/api/deliveries/${deliveryId}`)
      .set('Cookie', `token=${token}`)
      .send({})
      .expect(400)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('EMPTY_UPDATE_DATA');
        done();
      });
  });

  it('ar trebui să blocheze actualizarea livrării altui tenant (403)', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-002' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .put(`/api/deliveries/${deliveryId}`)
      .set('Cookie', `token=${token}`)
      .send({ status: 'livrată' })
      .expect(403)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('TENANT_MISMATCH');
        done();
      });
  });
});

// ---------------------------------------------------------------------------
// 5. PATCH /api/deliveries/:id/status – Actualizare status
// ---------------------------------------------------------------------------

describe('PATCH /api/deliveries/:id/status', function () {
  this.timeout(10000);

  it('ar trebui să returneze 401 fără autentificare', function (done) {
    request(app)
      .patch('/api/deliveries/999/status')
      .send({ status: 'livrată' })
      .expect(401)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        done();
      });
  });

  it('ar trebui să actualizeze statusul la "livrată"', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-001', status: 'în tranzit' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .patch(`/api/deliveries/${deliveryId}/status`)
      .set('Cookie', `token=${token}`)
      .send({ status: 'livrată' })
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        expect(res.body.data.delivery.status).to.equal('livrată');
        // Când devine livrată, actualDelivery ar trebui populat automat
        expect(res.body.data.delivery.actualDelivery).to.be.a('string');
        done();
      });
  });

  it('ar trebui să actualizeze statusul la "anulată"', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-001' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .patch(`/api/deliveries/${deliveryId}/status`)
      .set('Cookie', `token=${token}`)
      .send({ status: 'anulată' })
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.data.delivery.status).to.equal('anulată');
        done();
      });
  });

  it('ar trebui să respingă status invalid (422)', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-001' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .patch(`/api/deliveries/${deliveryId}/status`)
      .set('Cookie', `token=${token}`)
      .send({ status: 'status_inventat' })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să returneze 404 pentru livrare inexistentă', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .patch('/api/deliveries/99999/status')
      .set('Cookie', `token=${token}`)
      .send({ status: 'livrată' })
      .expect(404)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('DELIVERY_NOT_FOUND');
        done();
      });
  });
});

// ---------------------------------------------------------------------------
// 6. DELETE /api/deliveries/:id – Ștergere livrare
// ---------------------------------------------------------------------------

describe('DELETE /api/deliveries/:id', function () {
  this.timeout(10000);

  it('ar trebui să returneze 401 fără autentificare', function (done) {
    request(app)
      .delete('/api/deliveries/999')
      .expect(401)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        done();
      });
  });

  it('ar trebui să respingă ștergerea pentru rol fără permisiune (403)', function (done) {
    // bucătar nu are voie să șteargă (necesită minim manager)
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-001' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001', role: 'bucătar' });

    request(app)
      .delete(`/api/deliveries/${deliveryId}`)
      .set('Cookie', `token=${token}`)
      .expect(403)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        done();
      });
  });

  it('ar trebui să șteargă o livrare (rol manager)', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-001' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001', role: 'manager' });

    request(app)
      .delete(`/api/deliveries/${deliveryId}`)
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        expect(res.body.data.message).to.include('ștearsă cu succes');
        done();
      });
  });

  it('ar trebui să șteargă o livrare (rol owner)', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-001' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001', role: 'owner' });

    request(app)
      .delete(`/api/deliveries/${deliveryId}`)
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        done();
      });
  });

  it('ar trebui să șteargă o livrare (rol super_admin)', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-003' });
    const token = generateTestToken({ role: 'super_admin', tenantId: 'tenant-admin' });

    request(app)
      .delete(`/api/deliveries/${deliveryId}`)
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        done();
      });
  });

  it('ar trebui să returneze 404 pentru livrare deja ștearsă', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-001' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001', role: 'manager' });

    // Prima ștergere
    request(app)
      .delete(`/api/deliveries/${deliveryId}`)
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end(() => {
        // A doua ștergere
        request(app)
          .delete(`/api/deliveries/${deliveryId}`)
          .set('Cookie', `token=${token}`)
          .expect(404)
          .end((err, res) => {
            if (err) return done(err);
            expect(res.body.success).to.equal(false);
            expect(res.body.error.code).to.equal('DELIVERY_NOT_FOUND');
            done();
          });
      });
  });
});

// ---------------------------------------------------------------------------
// 7. GET /api/deliveries/status/:status
// ---------------------------------------------------------------------------

describe('GET /api/deliveries/status/:status', function () {
  this.timeout(10000);

  it('ar trebui să returneze livrări filtrate după status', function (done) {
    seedTestDelivery(db, { tenantId: 'tenant-deliveries-001', status: 'comandată' });
    seedTestDelivery(db, { tenantId: 'tenant-deliveries-001', status: 'livrată' });
    seedTestDelivery(db, { tenantId: 'tenant-deliveries-001', status: 'comandată' });

    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries/status/comandată')
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        expect(res.body.data.deliveries).to.be.an('array');
        expect(res.body.data.deliveries.length).to.equal(2);
        res.body.data.deliveries.forEach((d) => {
          expect(d.status).to.equal('comandată');
        });
        done();
      });
  });

  it('ar trebui să returneze 422 pentru status invalid', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries/status/inventat')
      .set('Cookie', `token=${token}`)
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să returneze listă goală pentru status fără livrări', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries/status/anulată')
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.data.deliveries).to.be.an('array');
        expect(res.body.data.deliveries.length).to.equal(0);
        done();
      });
  });
});

// ---------------------------------------------------------------------------
// 8. GET /api/deliveries/supplier/:supplierId
// ---------------------------------------------------------------------------

describe('GET /api/deliveries/supplier/:supplierId', function () {
  this.timeout(10000);

  it('ar trebui să returneze livrări filtrate după furnizor', function (done) {
    seedTestDelivery(db, { tenantId: 'tenant-deliveries-001', supplierId: 'sup-abc' });
    seedTestDelivery(db, { tenantId: 'tenant-deliveries-001', supplierId: 'sup-xyz' });
    seedTestDelivery(db, { tenantId: 'tenant-deliveries-001', supplierId: 'sup-abc' });

    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries/supplier/sup-abc')
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        expect(res.body.data.deliveries).to.be.an('array');
        expect(res.body.data.deliveries.length).to.equal(2);
        res.body.data.deliveries.forEach((d) => {
          expect(d.supplierId).to.equal('sup-abc');
        });
        done();
      });
  });

  it('ar trebui să returneze listă goală pentru furnizor inexistent', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries/supplier/sup-inexistent')
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.data.deliveries).to.be.an('array');
        expect(res.body.data.deliveries.length).to.equal(0);
        done();
      });
  });

  it('ar trebui să returneze 422 pentru supplierId gol', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries/supplier/%20')
      .set('Cookie', `token=${token}`)
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });
});

// ---------------------------------------------------------------------------
// 9. GET /api/deliveries/location/:locationId
// ---------------------------------------------------------------------------

describe('GET /api/deliveries/location/:locationId', function () {
  this.timeout(10000);

  it('ar trebui să returneze livrări filtrate după locație', function (done) {
    seedTestDelivery(db, {
      tenantId: 'tenant-deliveries-001',
      locationId: 'loc-restaurant-001',
      locationType: 'restaurant',
    });
    seedTestDelivery(db, {
      tenantId: 'tenant-deliveries-001',
      locationId: 'loc-restaurant-002',
      locationType: 'restaurant',
    });
    seedTestDelivery(db, {
      tenantId: 'tenant-deliveries-001',
      locationId: 'loc-restaurant-001',
      locationType: 'restaurant',
    });

    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries/location/loc-restaurant-001?locationType=restaurant')
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        expect(res.body.data.deliveries).to.be.an('array');
        expect(res.body.data.deliveries.length).to.equal(2);
        res.body.data.deliveries.forEach((d) => {
          expect(d.locationId).to.equal('loc-restaurant-001');
        });
        done();
      });
  });

  it('ar trebui să returneze 422 fără locationType', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries/location/loc-001')
      .set('Cookie', `token=${token}`)
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să returneze 422 pentru locationType invalid', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries/location/loc-001?locationType=invalid')
      .set('Cookie', `token=${token}`)
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });
});

// ---------------------------------------------------------------------------
// 10. GET /api/deliveries/date-range
// ---------------------------------------------------------------------------

describe('GET /api/deliveries/date-range', function () {
  this.timeout(10000);

  it('ar trebui să returneze livrări în intervalul de date', function (done) {
    seedTestDelivery(db, {
      tenantId: 'tenant-deliveries-001',
      orderDate: '2025-01-15T10:00:00.000Z',
    });
    seedTestDelivery(db, {
      tenantId: 'tenant-deliveries-001',
      orderDate: '2025-02-15T10:00:00.000Z',
    });
    seedTestDelivery(db, {
      tenantId: 'tenant-deliveries-001',
      orderDate: '2025-03-15T10:00:00.000Z',
    });

    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries/date-range?startDate=2025-01-01T00:00:00.000Z&endDate=2025-02-28T23:59:59.000Z')
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        expect(res.body.data.deliveries).to.be.an('array');
        expect(res.body.data.deliveries.length).to.equal(2);
        done();
      });
  });

  it('ar trebui să returneze 422 fără startDate', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries/date-range?endDate=2025-03-01T00:00:00.000Z')
      .set('Cookie', `token=${token}`)
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să returneze 422 fără endDate', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries/date-range?startDate=2025-01-01T00:00:00.000Z')
      .set('Cookie', `token=${token}`)
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să returneze 422 pentru date invalide', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001' });

    request(app)
      .get('/api/deliveries/date-range?startDate=not-a-date&endDate=also-not-a-date')
      .set('Cookie', `token=${token}`)
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });
});

// ---------------------------------------------------------------------------
// 11. Teste de integrare: flux complet CRUD
// ---------------------------------------------------------------------------

describe('Flux CRUD complet livrări', function () {
  this.timeout(15000);

  it('CREATE -> READ -> UPDATE -> DELETE', function (done) {
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001', role: 'manager' });

    // Pasul 1: CREATE
    const newDelivery = {
      supplierId: 'sup-flux',
      items: [
        { itemId: 'itm-flux', itemName: 'Produs flux', quantity: 5, unit: 'buc', price: 20 },
      ],
      locationId: 'loc-flux-001',
      locationType: 'restaurant',
      notes: 'Test flux complet',
    };

    request(app)
      .post('/api/deliveries')
      .set('Cookie', `token=${token}`)
      .send(newDelivery)
      .expect(201)
      .end((createErr, createRes) => {
        if (createErr) return done(createErr);
        const deliveryId = createRes.body.data.delivery._id;

        // Pasul 2: READ
        request(app)
          .get(`/api/deliveries/${deliveryId}`)
          .set('Cookie', `token=${token}`)
          .expect(200)
          .end((readErr, readRes) => {
            if (readErr) return done(readErr);
            expect(readRes.body.data.delivery.supplierId).to.equal('sup-flux');
            expect(readRes.body.data.delivery.status).to.equal('comandată');

            // Pasul 3: UPDATE (status)
            request(app)
              .patch(`/api/deliveries/${deliveryId}/status`)
              .set('Cookie', `token=${token}`)
              .send({ status: 'livrată' })
              .expect(200)
              .end((updateErr, updateRes) => {
                if (updateErr) return done(updateErr);
                expect(updateRes.body.data.delivery.status).to.equal('livrată');

                // Pasul 4: DELETE
                request(app)
                  .delete(`/api/deliveries/${deliveryId}`)
                  .set('Cookie', `token=${token}`)
                  .expect(200)
                  .end((deleteErr, deleteRes) => {
                    if (deleteErr) return done(deleteErr);
                    expect(deleteRes.body.success).to.equal(true);
                    expect(deleteRes.body.data.message).to.include('ștearsă cu succes');

                    // Confirmare ștergere
                    request(app)
                      .get(`/api/deliveries/${deliveryId}`)
                      .set('Cookie', `token=${token}`)
                      .expect(404)
                      .end((finalErr, finalRes) => {
                        if (finalErr) return done(finalErr);
                        expect(finalRes.body.error.code).to.equal('DELIVERY_NOT_FOUND');
                        done();
                      });
                  });
              });
          });
      });
  });
});

// ---------------------------------------------------------------------------
// 12. Teste de autorizare pe roluri
// ---------------------------------------------------------------------------

describe('Autorizare pe roluri', function () {
  this.timeout(10000);

  const rolesCuAcces = ['bucătar', 'ospătar', 'recepție', 'manager', 'owner', 'super_admin'];
  const rolesFaraAcces = ['client'];

  rolesCuAcces.forEach((role) => {
    it(`ar trebui să permită GET /api/deliveries pentru rolul "${role}"`, function (done) {
      seedTestDelivery(db, { tenantId: 'tenant-deliveries-001' });
      const token = generateTestToken({ tenantId: 'tenant-deliveries-001', role });

      request(app)
        .get('/api/deliveries')
        .set('Cookie', `token=${token}`)
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body.success).to.equal(true);
          done();
        });
    });
  });

  rolesFaraAcces.forEach((role) => {
    it(`ar trebui să respingă GET /api/deliveries pentru rolul "${role}" (403)`, function (done) {
      const token = generateTestToken({ tenantId: 'tenant-deliveries-001', role });

      request(app)
        .get('/api/deliveries')
        .set('Cookie', `token=${token}`)
        .expect(403)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body.success).to.equal(false);
          done();
        });
    });
  });

  it('ar trebui să permită DELETE pentru manager, owner, super_admin', function (done) {
    const deliveryId = seedTestDelivery(db, { tenantId: 'tenant-deliveries-001' });
    const token = generateTestToken({ tenantId: 'tenant-deliveries-001', role: 'owner' });

    request(app)
      .delete(`/api/deliveries/${deliveryId}`)
      .set('Cookie', `token=${token}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.equal(true);
        done();
      });
  });
});