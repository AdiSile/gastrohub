/**
 * ============================================================
 * tests/middleware/auth.test.js - Teste pentru middleware/auth.js
 * ============================================================
 *
 * Verifică compatibilitatea dintre middleware/auth.js și
 * models/userModel.js (import și comportament la runtime).
 *
 * Acoperă:
 *  1. generateToken          – creare token JWT
 *  2. setTokenCookie         – setare cookie JWT
 *  3. clearTokenCookie       – ștergere cookie JWT
 *  4. refreshToken           – reîmprospătare token
 *  5. authenticate           – middleware autentificare obligatorie
 *  6. optionalAuth           – middleware autentificare opțională
 *  7. Compatibilitate findUserById (userModel + fallback NeDB)
 *
 * Cerințe:
 *  - 80%+ branches, functions, lines, statements
 * ============================================================
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-auth-middleware-2025';
process.env.DB_PATH = './data';

const { expect } = require('chai');
const { describe, it, before, after, beforeEach } = require('mocha');
const jwt = require('jsonwebtoken');
const sinon = require('sinon');

const { initDb, users } = require('../../config/db');
const {
  authenticate,
  optionalAuth,
  generateToken,
  setTokenCookie,
  clearTokenCookie,
  refreshToken,
  TOKEN_COOKIE_NAME,
} = require('../../middleware/auth');
const { AppError } = require('../../middleware/errorHandler');
const userModel = require('../../models/userModel');

// ---------------------------------------------------------------------------
// Helper: creează mock-uri pentru req/res Express
// ---------------------------------------------------------------------------

/**
 * @param {Object} [opts]
 * @param {Object} [opts.cookies]  - cookie-uri pe request
 * @param {Object} [opts.headers]  - headere HTTP
 * @returns {{ req: Object, res: Object }}
 */
function mockReqRes(opts) {
  opts = opts || {};
  var req = {
    cookies: opts.cookies || {},
    headers: opts.headers || {},
  };
  var res = {
    _cookies: {},
    cookie: function (name, value, options) {
      res._cookies[name] = { value: value, options: options || {} };
    },
    clearCookie: function (name, options) {
      res._cookies[name] = { value: '', options: options || {} };
    },
  };
  return { req: req, res: res };
}

// ---------------------------------------------------------------------------
// Helper: inserează un utilizator de test în NeDB
// ---------------------------------------------------------------------------

function insertTestUser(doc) {
  return new Promise(function (resolve, reject) {
    users.insert(doc, function (err, newDoc) {
      if (err) return reject(err);
      resolve(newDoc);
    });
  });
}

// ---------------------------------------------------------------------------
// Hook-uri globale
// ---------------------------------------------------------------------------

before(function (done) {
  this.timeout(10000);
  initDb().then(function () {
    users.remove({}, { multi: true }, function () { done(); });
  }).catch(done);
});

after(function (done) {
  users.remove({}, { multi: true }, function () { done(); });
});

beforeEach(function (done) {
  users.remove({}, { multi: true }, function () { done(); });
});

// ===========================================================================
// 1. generateToken
// ===========================================================================

describe('generateToken(user, expiresIn)', function () {

  it('ar trebui să genereze un token JWT valid', function () {
    var user = { _id: 'u1', email: 'a@b.com', role: 'client', tenantId: null };
    var token = generateToken(user);

    expect(token).to.be.a('string');
    expect(token.split('.')).to.have.lengthOf(3); // header.payload.signature

    var decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.sub).to.equal('u1');
    expect(decoded.email).to.equal('a@b.com');
    expect(decoded.role).to.equal('client');
    expect(decoded.tenantId).to.be.null;
  });

  it('ar trebui să includă tenantId când este furnizat', function () {
    var user = { _id: 'u2', email: 't@b.com', role: 'manager', tenantId: 'tenant-99' };
    var token = generateToken(user);
    var decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.tenantId).to.equal('tenant-99');
  });

  it('ar trebui să accepte o durată de expirare personalizată', function () {
    var user = { _id: 'u3', email: 'c@b.com', role: 'client', tenantId: null };
    var token = generateToken(user, '1h');
    var decoded = jwt.verify(token, process.env.JWT_SECRET);
    // expiresIn 1h => iat + 3600 secunde
    expect(decoded.exp - decoded.iat).to.equal(3600);
  });

  it('ar trebui să folosească DEFAULT_EXPIRES_IN (7d) când nu se specifică', function () {
    var user = { _id: 'u4', email: 'd@b.com', role: 'client', tenantId: null };
    var token = generateToken(user);
    var decoded = jwt.verify(token, process.env.JWT_SECRET);
    var expectedDiff = 7 * 24 * 60 * 60;
    expect(decoded.exp - decoded.iat).to.equal(expectedDiff);
  });

  it('ar trebui să arunce eroare dacă JWT_SECRET nu este setat', function () {
    var originalSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;

    var user = { _id: 'u5', email: 'e@b.com', role: 'client', tenantId: null };
    expect(function () { generateToken(user); }).to.throw(Error, /JWT_SECRET/);

    // Restaurăm
    process.env.JWT_SECRET = originalSecret;
  });
});

// ===========================================================================
// 2. setTokenCookie / clearTokenCookie
// ===========================================================================

describe('setTokenCookie(res, token) / clearTokenCookie(res)', function () {

  it('ar trebui să seteze cookie-ul JWT pe răspuns', function () {
    var mocks = mockReqRes();
    setTokenCookie(mocks.res, 'test-token-abc');

    var cookie = mocks.res._cookies[TOKEN_COOKIE_NAME];
    expect(cookie).to.exist;
    expect(cookie.value).to.equal('test-token-abc');
  });

  it('ar trebui să seteze flag-urile de securitate corecte', function () {
    var mocks = mockReqRes();
    setTokenCookie(mocks.res, 'test-token-sec');

    var cookie = mocks.res._cookies[TOKEN_COOKIE_NAME];
    expect(cookie.options.httpOnly).to.equal(true);
    expect(cookie.options.sameSite).to.equal('strict');
    expect(cookie.options.path).to.equal('/');
    expect(cookie.options.maxAge).to.equal(7 * 24 * 60 * 60 * 1000);
  });

  it('ar trebui să seteze secure=true în producție', function () {
    var originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    var mocks = mockReqRes();
    setTokenCookie(mocks.res, 'test-token-prod');

    var cookie = mocks.res._cookies[TOKEN_COOKIE_NAME];
    expect(cookie.options.secure).to.equal(true);

    process.env.NODE_ENV = originalEnv;
  });

  it('clearTokenCookie ar trebui să șteargă cookie-ul', function () {
    var mocks = mockReqRes();
    clearTokenCookie(mocks.res);

    var cleared = mocks.res._cookies[TOKEN_COOKIE_NAME];
    expect(cleared).to.exist;
    expect(cleared.value).to.equal('');
    expect(cleared.options.httpOnly).to.equal(true);
    expect(cleared.options.sameSite).to.equal('strict');
  });
});

// ===========================================================================
// 3. refreshToken
// ===========================================================================

describe('refreshToken(req, res)', function () {

  it('ar trebui să returneze un nou token și să îl seteze în cookie', function () {
    var mocks = mockReqRes();
    mocks.req.user = { _id: 'uR1', email: 'refresh@test.com', role: 'client', tenantId: null };

    var newToken = refreshToken(mocks.req, mocks.res);

    expect(newToken).to.be.a('string');
    var decoded = jwt.verify(newToken, process.env.JWT_SECRET);
    expect(decoded.sub).to.equal('uR1');
    expect(decoded.email).to.equal('refresh@test.com');

    // Verifică cookie-ul
    var cookie = mocks.res._cookies[TOKEN_COOKIE_NAME];
    expect(cookie).to.exist;
    expect(cookie.value).to.equal(newToken);
  });

  it('ar trebui să returneze null dacă req.user nu există', function () {
    var mocks = mockReqRes();
    mocks.req.user = null;

    var result = refreshToken(mocks.req, mocks.res);
    expect(result).to.be.null;
  });
});

// ===========================================================================
// 4. authenticate – middleware
// ===========================================================================

describe('authenticate middleware', function () {
  this.timeout(10000);

  /** Creează un token JWT valid pentru un utilizator de test */
  function makeToken(user) {
    var payload = {
      sub: user._id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId || null,
    };
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
  }

  // --------------------------------------------------------------------------
  // 4a. Token absent
  // --------------------------------------------------------------------------

  describe('când token-ul lipsește', function () {

    it('ar trebui să returneze 401 TOKEN_MISSING (fără cookie și fără header)', function (done) {
      var mocks = mockReqRes();

      authenticate(mocks.req, mocks.res, function (err) {
        expect(err).to.be.an.instanceOf(AppError);
        expect(err.statusCode).to.equal(401);
        expect(err.code).to.equal('TOKEN_MISSING');
        done();
      });
    });

    it('ar trebui să returneze 401 TOKEN_MISSING (header Authorization absent)', function (done) {
      var mocks = mockReqRes({ headers: { 'x-custom': 'value' } });

      authenticate(mocks.req, mocks.res, function (err) {
        expect(err).to.be.an.instanceOf(AppError);
        expect(err.statusCode).to.equal(401);
        expect(err.code).to.equal('TOKEN_MISSING');
        done();
      });
    });
  });

  // --------------------------------------------------------------------------
  // 4b. Token invalid
  // --------------------------------------------------------------------------

  describe('când token-ul este invalid', function () {

    it('ar trebui să returneze 401 TOKEN_INVALID (token alterat)', function (done) {
      var mocks = mockReqRes({ cookies: { token: 'header.payload.signature-alterat' } });

      authenticate(mocks.req, mocks.res, function (err) {
        expect(err).to.be.an.instanceOf(AppError);
        expect(err.statusCode).to.equal(401);
        expect(err.code).to.equal('TOKEN_INVALID');
        done();
      });
    });

    it('ar trebui să returneze 401 TOKEN_INVALID (Bearer cu semnătură greșită)', function (done) {
      var mocks = mockReqRes({
        headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.cGxhaW50ZXh0.badsignature' },
      });

      authenticate(mocks.req, mocks.res, function (err) {
        expect(err).to.be.an.instanceOf(AppError);
        expect(err.statusCode).to.equal(401);
        expect(err.code).to.equal('TOKEN_INVALID');
        done();
      });
    });
  });

  // --------------------------------------------------------------------------
  // 4c. Token expirat
  // --------------------------------------------------------------------------

  describe('când token-ul este expirat', function () {

    it('ar trebui să returneze 401 TOKEN_EXPIRED', function (done) {
      var expiredToken = jwt.sign(
        { sub: 'u-exp', email: 'exp@test.com', role: 'client', tenantId: null },
        process.env.JWT_SECRET,
        { expiresIn: '0s' } // expiră imediat
      );

      var mocks = mockReqRes({ cookies: { token: expiredToken } });

      authenticate(mocks.req, mocks.res, function (err) {
        expect(err).to.be.an.instanceOf(AppError);
        expect(err.statusCode).to.equal(401);
        expect(err.code).to.equal('TOKEN_EXPIRED');
        done();
      });
    });
  });

  // --------------------------------------------------------------------------
  // 4d. Token valid, dar utilizatorul nu există în DB
  // --------------------------------------------------------------------------

  describe('când utilizatorul nu este găsit în DB', function () {

    it('ar trebui să returneze 401 USER_NOT_FOUND', function (done) {
      var tokenForMissingUser = jwt.sign(
        { sub: 'id_inexistent', email: 'no@test.com', role: 'client', tenantId: null },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      var mocks = mockReqRes({ cookies: { token: tokenForMissingUser } });

      authenticate(mocks.req, mocks.res, function (err) {
        expect(err).to.be.an.instanceOf(AppError);
        expect(err.statusCode).to.equal(401);
        expect(err.code).to.equal('USER_NOT_FOUND');
        done();
      });
    });
  });

  // --------------------------------------------------------------------------
  // 4e. Token valid + utilizator există (compatibilitate userModel)
  // --------------------------------------------------------------------------

  describe('compatibilitate cu userModel.findUserById', function () {
    var testUserId;
    var testUserDoc;

    beforeEach(function (done) {
      testUserDoc = {
        email: 'compat@test.com',
        password: '$2a$10$dummyhash',
        role: 'manager',
        tenantId: 'tenant-42',
        restaurante: ['r1', 'r2'],
        createdAt: new Date('2025-01-15').toISOString(),
        updatedAt: new Date('2025-01-15').toISOString(),
      };

      users.insert(testUserDoc, function (err, newDoc) {
        if (err) return done(err);
        testUserId = newDoc._id;
        done();
      });
    });

    it('ar trebui să populeze req.user cu datele din userModel (NeDB)', function (done) {
      var token = makeToken({
        _id: testUserId,
        email: testUserDoc.email,
        role: testUserDoc.role,
        tenantId: testUserDoc.tenantId,
      });

      var mocks = mockReqRes({ cookies: { token: token } });

      authenticate(mocks.req, mocks.res, function (err) {
        if (err) return done(err);

        // Verifică req.user
        expect(mocks.req.user).to.be.an('object');
        expect(mocks.req.user._id).to.equal(testUserId);
        expect(mocks.req.user.email).to.equal('compat@test.com');
        expect(mocks.req.user.role).to.equal('manager');
        expect(mocks.req.user.tenantId).to.equal('tenant-42');
        expect(mocks.req.user.restaurante).to.deep.equal(['r1', 'r2']);
        expect(mocks.req.user.createdAt).to.be.a('string');

        // Parola NU trebuie să fie în req.user
        expect(mocks.req.user).to.not.have.property('password');

        // Token-ul trebuie atașat
        expect(mocks.req.token).to.equal(token);

        done();
      });
    });

    it('ar trebui să populeze tenantId=null când utilizatorul nu are tenant', function (done) {
      users.insert({
        email: 'fara-tenant@test.com',
        password: '$2a$10$dummyhash',
        role: 'client',
        tenantId: null,
        restaurante: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, function (err, newDoc) {
        if (err) return done(err);

        var token = makeToken({
          _id: newDoc._id,
          email: 'fara-tenant@test.com',
          role: 'client',
          tenantId: null,
        });

        var mocks = mockReqRes({ cookies: { token: token } });

        authenticate(mocks.req, mocks.res, function (err2) {
          if (err2) return done(err2);
          expect(mocks.req.user.tenantId).to.be.null;
          expect(mocks.req.user.restaurante).to.deep.equal([]);
          done();
        });
      });
    });

    it('ar trebui să funcționeze și cu header Authorization: Bearer', function (done) {
      var token = makeToken({
        _id: testUserId,
        email: testUserDoc.email,
        role: testUserDoc.role,
        tenantId: testUserDoc.tenantId,
      });

      var mocks = mockReqRes({
        headers: { authorization: 'Bearer ' + token },
      });

      authenticate(mocks.req, mocks.res, function (err) {
        if (err) return done(err);
        expect(mocks.req.user._id).to.equal(testUserId);
        expect(mocks.req.user.email).to.equal('compat@test.com');
        done();
      });
    });

    it('ar trebui să prefere cookie-ul în fața header-ului când ambele există', function (done) {
      var validToken = makeToken({
        _id: testUserId,
        email: testUserDoc.email,
        role: testUserDoc.role,
        tenantId: testUserDoc.tenantId,
      });

      var mocks = mockReqRes({
        cookies: { token: validToken },
        headers: { authorization: 'Bearer header.payload.fake' },
      });

      authenticate(mocks.req, mocks.res, function (err) {
        if (err) return done(err);
        expect(mocks.req.user._id).to.equal(testUserId);
        done();
      });
    });
  });

  // --------------------------------------------------------------------------
  // 4f. Integrare directă cu userModel.findUserById
  // --------------------------------------------------------------------------

  describe('integrare directă cu userModel.findUserById', function () {

    it('userModel.findUserById returnează documentul complet (inclusiv password)', function () {
      return insertTestUser({
        email: 'integration@test.com',
        password: '$2a$10$hashedSecret',
        role: 'owner',
        tenantId: 't-int',
        restaurante: ['r10'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).then(function (newUser) {
        return userModel.findUserById(newUser._id);
      }).then(function (found) {
        expect(found).to.be.an('object');
        expect(found._id).to.equal(newUser._id);
        expect(found.email).to.equal('integration@test.com');
        expect(found.role).to.equal('owner');
        expect(found.tenantId).to.equal('t-int');
        expect(found.restaurante).to.deep.equal(['r10']);
        // findUserById returnează inclusiv parola (pentru comparePassword)
        expect(found.password).to.equal('$2a$10$hashedSecret');
      });
    });

    it('userModel.findUserById returnează null pentru ID inexistent', function () {
      return userModel.findUserById('id_inexistent_total').then(function (found) {
        expect(found).to.be.null;
      });
    });
  });
});

// ===========================================================================
// 5. optionalAuth – middleware
// ===========================================================================

describe('optionalAuth middleware', function () {
  this.timeout(10000);

  function makeToken(user) {
    var payload = {
      sub: user._id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId || null,
    };
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
  }

  // --------------------------------------------------------------------------
  // 5a. Fără token – nu blochează
  // --------------------------------------------------------------------------

  describe('când token-ul lipsește', function () {

    it('ar trebui să seteze req.user = null și să continue', function (done) {
      var mocks = mockReqRes();

      optionalAuth(mocks.req, mocks.res, function (err) {
        if (err) return done(err);
        expect(mocks.req.user).to.be.null;
        expect(mocks.req.token).to.be.null;
        done();
      });
    });
  });

  // --------------------------------------------------------------------------
  // 5b. Token invalid – nu blochează
  // --------------------------------------------------------------------------

  describe('când token-ul este invalid', function () {

    it('ar trebui să seteze req.user = null și să continue', function (done) {
      var mocks = mockReqRes({ cookies: { token: 'invalid.token.here' } });

      optionalAuth(mocks.req, mocks.res, function (err) {
        if (err) return done(err);
        expect(mocks.req.user).to.be.null;
        expect(mocks.req.token).to.be.null;
        done();
      });
    });
  });

  // --------------------------------------------------------------------------
  // 5c. Token expirat – nu blochează
  // --------------------------------------------------------------------------

  describe('când token-ul este expirat', function () {

    it('ar trebui să seteze req.user = null și să continue', function (done) {
      var expiredToken = jwt.sign(
        { sub: 'u-exp', email: 'exp@test.com', role: 'client', tenantId: null },
        process.env.JWT_SECRET,
        { expiresIn: '0s' }
      );

      var mocks = mockReqRes({ cookies: { token: expiredToken } });

      optionalAuth(mocks.req, mocks.res, function (err) {
        if (err) return done(err);
        expect(mocks.req.user).to.be.null;
        expect(mocks.req.token).to.be.null;
        done();
      });
    });
  });

  // --------------------------------------------------------------------------
  // 5d. Token valid + utilizator există
  // --------------------------------------------------------------------------

  describe('când token-ul este valid și utilizatorul există', function () {
    var testUserId;

    beforeEach(function (done) {
      users.insert({
        email: 'optional@test.com',
        password: '$2a$10$hash',
        role: 'ospătar',
        tenantId: 't-opt',
        restaurante: ['rA'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, function (err, doc) {
        if (err) return done(err);
        testUserId = doc._id;
        done();
      });
    });

    it('ar trebui să populeze req.user și să continue', function (done) {
      var token = makeToken({
        _id: testUserId,
        email: 'optional@test.com',
        role: 'ospătar',
        tenantId: 't-opt',
      });

      var mocks = mockReqRes({ cookies: { token: token } });

      optionalAuth(mocks.req, mocks.res, function (err) {
        if (err) return done(err);
        expect(mocks.req.user).to.be.an('object');
        expect(mocks.req.user._id).to.equal(testUserId);
        expect(mocks.req.user.email).to.equal('optional@test.com');
        expect(mocks.req.user.role).to.equal('ospătar');
        expect(mocks.req.user.tenantId).to.equal('t-opt');
        expect(mocks.req.user).to.not.have.property('password');
        expect(mocks.req.token).to.equal(token);
        done();
      });
    });
  });

  // --------------------------------------------------------------------------
  // 5e. Token valid dar utilizatorul nu există – nu blochează
  // --------------------------------------------------------------------------

  describe('când utilizatorul din token nu mai există', function () {

    it('ar trebui să seteze req.user = null și să continue', function (done) {
      var token = makeToken({
        _id: 'utilizator-sters',
        email: 'sters@test.com',
        role: 'client',
        tenantId: null,
      });

      var mocks = mockReqRes({ cookies: { token: token } });

      optionalAuth(mocks.req, mocks.res, function (err) {
        if (err) return done(err);
        expect(mocks.req.user).to.be.null;
        expect(mocks.req.token).to.be.null;
        done();
      });
    });
  });
});

// ===========================================================================
// 6. Teste de robustețe și edge cases
// ===========================================================================

describe('Robustețe și edge cases', function () {
  this.timeout(5000);

  it('authenticate: ar trebui să gestioneze erori interne (JWT_SECRET lipsă)', function (done) {
    var originalSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;

    var mocks = mockReqRes({ cookies: { token: 'un.token.oarecare' } });

    authenticate(mocks.req, mocks.res, function (err) {
      process.env.JWT_SECRET = originalSecret;

      expect(err).to.be.an.instanceOf(AppError);
      expect(err.statusCode).to.equal(500);
      expect(['SERVER_CONFIG_ERROR', 'AUTH_INTERNAL_ERROR']).to.include(err.code);
      done();
    });
  });

  it('optionalAuth: ar trebui să nu se blocheze la erori interne (JWT_SECRET lipsă)', function (done) {
    var originalSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;

    var mocks = mockReqRes({ cookies: { token: 'un.token.oarecare' } });

    optionalAuth(mocks.req, mocks.res, function (err) {
      process.env.JWT_SECRET = originalSecret;

      expect(err).to.be.undefined;
      expect(mocks.req.user).to.be.null;
      expect(mocks.req.token).to.be.null;
      done();
    });
  });

  it('authenticate: ar trebui să funcționeze cu ID-uri NeDB alfanumerice', function (done) {
    var alphanumericId = 'abc123xyz890';

    users.insert({
      _id: alphanumericId,
      email: 'alpha@test.com',
      password: '$2a$10$hash',
      role: 'client',
      tenantId: null,
      restaurante: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, function (err) {
      if (err) return done(err);

      var token = jwt.sign(
        { sub: alphanumericId, email: 'alpha@test.com', role: 'client', tenantId: null },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      var mocks = mockReqRes({ cookies: { token: token } });

      authenticate(mocks.req, mocks.res, function (authErr) {
        if (authErr) return done(authErr);
        expect(mocks.req.user._id).to.equal(alphanumericId);
        expect(mocks.req.user.email).to.equal('alpha@test.com');
        done();
      });
    });
  });

  it('authenticate: restaurantele trebuie să fie array chiar dacă DB returnează null', function (done) {
    users.insert({
      email: 'null-rest@test.com',
      password: '$2a$10$hash',
      role: 'client',
      tenantId: null,
      restaurante: null, // forțat null
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, function (err, doc) {
      if (err) return done(err);

      var token = jwt.sign(
        { sub: doc._id, email: 'null-rest@test.com', role: 'client', tenantId: null },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      var mocks = mockReqRes({ cookies: { token: token } });

      authenticate(mocks.req, mocks.res, function (authErr) {
        if (authErr) return done(authErr);
        // middleware face: user.restaurante || []
        expect(mocks.req.user.restaurante).to.deep.equal([]);
        done();
      });
    });
  });
});

// ===========================================================================
// 7. TOKEN_COOKIE_NAME – constantă exportată
// ===========================================================================

describe('TOKEN_COOKIE_NAME', function () {

  it('ar trebui să fie șirul "token"', function () {
    expect(TOKEN_COOKIE_NAME).to.equal('token');
  });
});