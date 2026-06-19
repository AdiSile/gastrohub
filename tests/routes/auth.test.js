/**
 * ============================================================
 * tests/routes/auth.test.js - Teste pentru rutele de autentificare
 * ============================================================
 *
 * Verifică că rutele funcționează corect cu noul sistem de
 * inițializare async al bazei de date.
 *
 * Acoperă:
 *  1. POST /api/auth/register  – înregistrare
 *  2. POST /api/auth/login     – autentificare
 *  3. POST /api/auth/logout    – deconectare
 *
 * Cerințe:
 *  - 80%+ branches, functions, lines, statements
 * ============================================================
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-auth-routes-2025';
process.env.DB_PATH = './data';

const request = require('supertest');
const { expect } = require('chai');
const { describe, it, before, after, beforeEach } = require('mocha');

const app = require('../server');
const { initDb, users } = require('../config/db');

// ---------------------------------------------------------------------------
// Hook-uri globale: asigură inițializarea async a bazei de date
// ---------------------------------------------------------------------------

before(function (done) {
  this.timeout(10000);
  // Inițializare async db (SQLite + NeDB)
  initDb().then(() => {
    // Curățăm colecția users pentru teste izolate
    users.remove({}, { multi: true }, () => {
      done();
    });
  }).catch(done);
});

after(function (done) {
  // Curățăm după toate testele
  users.remove({}, { multi: true }, () => {
    done();
  });
});

beforeEach(function (done) {
  // Curățăm înainte de fiecare test pentru izolare completă
  users.remove({}, { multi: true }, () => {
    done();
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------

describe('POST /api/auth/register', function () {
  this.timeout(10000);

  it('ar trebui să înregistreze un utilizator nou cu date valide', function (done) {
    request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'parola123',
      })
      .expect(201)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.success).to.equal(true);
        expect(res.body.data).to.be.an('object');
        expect(res.body.data.user).to.be.an('object');
        expect(res.body.data.user.email).to.equal('test@example.com');
        expect(res.body.data.user.role).to.equal('client');
        expect(res.body.data.user).to.not.have.property('password');
        expect(res.body.data.token).to.be.a('string');
        expect(res.body.data.token.length).to.be.greaterThan(0);

        // Verifică că token-ul este setat în cookie
        const cookies = res.headers['set-cookie'];
        expect(cookies).to.be.an('array');
        const tokenCookie = cookies.find((c) => c.startsWith('token='));
        expect(tokenCookie).to.exist;

        done();
      });
  });

  it('ar trebui să înregistreze cu un rol specificat', function (done) {
    request(app)
      .post('/api/auth/register')
      .send({
        email: 'manager@example.com',
        password: 'parola123',
        role: 'manager',
        tenantId: 'tenant-001',
      })
      .expect(201)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.success).to.equal(true);
        expect(res.body.data.user.role).to.equal('manager');
        expect(res.body.data.user.tenantId).to.equal('tenant-001');
        done();
      });
  });

  it('ar trebui să respingă un email duplicat (409)', function (done) {
    // Înregistrăm primul utilizator
    request(app)
      .post('/api/auth/register')
      .send({ email: 'duplicat@example.com', password: 'parola123' })
      .expect(201)
      .end(() => {
        // Încercăm înregistrare duplicat
        request(app)
          .post('/api/auth/register')
          .send({ email: 'duplicat@example.com', password: 'altaParola456' })
          .expect(409)
          .end((err, res) => {
            if (err) return done(err);

            expect(res.body.success).to.equal(false);
            expect(res.body.error.code).to.equal('DUPLICATE_EMAIL');
            done();
          });
      });
  });

  it('ar trebui să respingă un email invalid (422)', function (done) {
    request(app)
      .post('/api/auth/register')
      .send({
        email: 'nu-e-email-valid',
        password: 'parola123',
      })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să respingă o parolă prea scurtă (422)', function (done) {
    request(app)
      .post('/api/auth/register')
      .send({
        email: 'scurt@example.com',
        password: '12345',
      })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să respingă o parolă prea lungă (422)', function (done) {
    request(app)
      .post('/api/auth/register')
      .send({
        email: 'lung@example.com',
        password: 'x'.repeat(129),
      })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să respingă un rol invalid (422)', function (done) {
    request(app)
      .post('/api/auth/register')
      .send({
        email: 'rol-invalid@example.com',
        password: 'parola123',
        role: 'rol_inexistent',
      })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să normalizeze email-ul (lowercase)', function (done) {
    request(app)
      .post('/api/auth/register')
      .send({
        email: 'MAJUSCULE@Example.COM',
        password: 'parola123',
      })
      .expect(201)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.data.user.email).to.equal('majuscule@example.com');
        done();
      });
  });

  it('ar trebui să accepte tenantId setat la null', function (done) {
    request(app)
      .post('/api/auth/register')
      .send({
        email: 'fara-tenant@example.com',
        password: 'parola123',
        tenantId: null,
      })
      .expect(201)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.data.user.tenantId).to.be.null;
        done();
      });
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', function () {
  this.timeout(10000);

  // Utilizator pre-înregistrat pentru testele de login
  const testUser = {
    email: 'login@example.com',
    password: 'parola123',
  };

  beforeEach(function (done) {
    // Înregistrăm un utilizator înainte de testele de login
    request(app)
      .post('/api/auth/register')
      .send(testUser)
      .expect(201)
      .end(() => done());
  });

  it('ar trebui să autentifice un utilizator cu credențiale corecte', function (done) {
    request(app)
      .post('/api/auth/login')
      .send({
        email: 'login@example.com',
        password: 'parola123',
      })
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.success).to.equal(true);
        expect(res.body.data).to.be.an('object');
        expect(res.body.data.user.email).to.equal('login@example.com');
        expect(res.body.data.user).to.not.have.property('password');
        expect(res.body.data.token).to.be.a('string');

        // Verifică cookie-ul
        const cookies = res.headers['set-cookie'];
        expect(cookies).to.be.an('array');
        const tokenCookie = cookies.find((c) => c.startsWith('token='));
        expect(tokenCookie).to.exist;

        done();
      });
  });

  it('ar trebui să respingă email incorect (401)', function (done) {
    request(app)
      .post('/api/auth/login')
      .send({
        email: 'nu-exista@example.com',
        password: 'parola123',
      })
      .expect(401)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('INVALID_CREDENTIALS');
        done();
      });
  });

  it('ar trebui să respingă parolă incorectă (401)', function (done) {
    request(app)
      .post('/api/auth/login')
      .send({
        email: 'login@example.com',
        password: 'parola-gresita',
      })
      .expect(401)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('INVALID_CREDENTIALS');
        done();
      });
  });

  it('ar trebui să respingă email invalid (422)', function (done) {
    request(app)
      .post('/api/auth/login')
      .send({
        email: 'invalid-email',
        password: 'parola123',
      })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să respingă parolă goală (422)', function (done) {
    request(app)
      .post('/api/auth/login')
      .send({
        email: 'login@example.com',
        password: '',
      })
      .expect(422)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.success).to.equal(false);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
        done();
      });
  });

  it('ar trebui să normalizeze email-ul la login (case insensitive)', function (done) {
    request(app)
      .post('/api/auth/login')
      .send({
        email: 'LOGIN@Example.COM',
        password: 'parola123',
      })
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.success).to.equal(true);
        expect(res.body.data.user.email).to.equal('login@example.com');
        done();
      });
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

describe('POST /api/auth/logout', function () {
  this.timeout(5000);

  it('ar trebui să șteargă cookie-ul JWT și să returneze succes', function (done) {
    request(app)
      .post('/api/auth/logout')
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.success).to.equal(true);
        expect(res.body.message).to.include('deconectat');

        // Verifică că răspunsul conține clear-cookie
        const cookies = res.headers['set-cookie'];
        expect(cookies).to.be.an('array');
        const clearCookie = cookies.find((c) => c.startsWith('token=;'));
        expect(clearCookie).to.exist;

        done();
      });
  });

  it('ar trebui să funcționeze chiar și fără token', function (done) {
    // Logout fără a fi autentificat – ar trebui să meargă oricum
    request(app)
      .post('/api/auth/logout')
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);

        expect(res.body.success).to.equal(true);
        done();
      });
  });
});

// ---------------------------------------------------------------------------
// Flux complet: register -> login -> logout
// ---------------------------------------------------------------------------

describe('Flux complet de autentificare', function () {
  this.timeout(10000);

  it('register -> login -> logout', function (done) {
    const userData = {
      email: 'complet@example.com',
      password: 'fluxparola456',
    };

    // Pasul 1: Register
    request(app)
      .post('/api/auth/register')
      .send(userData)
      .expect(201)
      .end((registerErr, registerRes) => {
        if (registerErr) return done(registerErr);

        expect(registerRes.body.data.user.email).to.equal('complet@example.com');
        const registerToken = registerRes.body.data.token;
        expect(registerToken).to.be.a('string');

        // Extrage cookie-ul de token din register
        let cookies = registerRes.headers['set-cookie'];
        let tokenCookie = cookies.find((c) => c.startsWith('token='));
        const cookieValue = tokenCookie.split(';')[0].replace('token=', '');

        // Pasul 2: Login
        request(app)
          .post('/api/auth/login')
          .send(userData)
          .expect(200)
          .end((loginErr, loginRes) => {
            if (loginErr) return done(loginErr);

            expect(loginRes.body.data.user.email).to.equal('complet@example.com');
            expect(loginRes.body.data.token).to.be.a('string');

            // Pasul 3: Logout
            request(app)
              .post('/api/auth/logout')
              .expect(200)
              .end((logoutErr, logoutRes) => {
                if (logoutErr) return done(logoutErr);

                expect(logoutRes.body.success).to.equal(true);
                expect(logoutRes.body.message).to.include('deconectat');

                done();
              });
          });
      });
  });
});