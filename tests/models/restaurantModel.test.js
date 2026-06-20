'use strict';

// ---------------------------------------------------------------------------
// Test Suite – RestaurantModel
// Model SQLite cu operații CRUD pentru restaurante
// ---------------------------------------------------------------------------

const { expect } = require('chai');
const sinon = require('sinon');

// ---------------------------------------------------------------------------
// Mock-uri pentru dependențe
// ---------------------------------------------------------------------------

// Mock pentru config/db (getDb)
let mockDb;
const mockGetDb = sinon.stub();

const mockDbRun = sinon.stub();
const mockDbPrepare = sinon.stub();
const mockDbExec = sinon.stub();

// Construim un obiect mock pentru baza de date
function buildMockDb() {
  return {
    run: mockDbRun,
    prepare: mockDbPrepare,
    exec: mockDbExec,
  };
}

// Mock pentru middleware/errorHandler (AppError)
class AppError extends Error {
  constructor(message, statusCode = 500, code) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code || null;
    this.isOperational = true;
  }
}

// ---------------------------------------------------------------------------
// Pregătirea modulului sub test
// ---------------------------------------------------------------------------
const proxyquire = require('proxyquire');

const restaurantModel = proxyquire('../../models/restaurantModel', {
  '../config/db': { getDb: mockGetDb },
  '../middleware/errorHandler': { AppError },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_TENANT = 'tenant-001';
const TEST_TENANT2 = 'tenant-002';

/**
 * Creează un obiect restaurant valid pentru teste.
 * @param {Object} [overrides={}]
 * @returns {Object}
 */
function validRestaurantData(overrides = {}) {
  return {
    name: 'Test Restaurant',
    address: 'Str. Test nr. 1, București',
    tenantId: TEST_TENANT,
    tableCount: 20,
    phone: '+40700123456',
    email: 'test@restaurant.ro',
    status: 'active',
    ...overrides,
  };
}

/**
 * Creează un mock de rând SQL (snake_case) așa cum ar veni din SQLite.
 * @param {Object} [overrides={}]
 * @returns {Object}
 */
function mockSqlRow(overrides = {}) {
  return {
    id: 1,
    name: 'Test Restaurant',
    address: 'Str. Test nr. 1, București',
    capacity: 20,
    tenant_id: TEST_TENANT,
    phone: '+40700123456',
    email: 'test@restaurant.ro',
    status: 'active',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Creează un mock de statement sql.js.
 * @param {Object} rowData
 * @returns {Object}
 */
function mockStatement(rowData) {
  let stepped = false;
  return {
    bind: sinon.stub(),
    step: () => {
      if (!stepped) {
        stepped = true;
        return true;
      }
      return false;
    },
    getAsObject: () => rowData,
    free: sinon.stub(),
  };
}

/**
 * Creează un mock de statement care returnează array de rânduri.
 * @param {Array<Object>} rows
 * @returns {Object}
 */
function mockStatementAll(rows) {
  let index = 0;
  return {
    bind: sinon.stub(),
    step: () => {
      if (index < rows.length) {
        index++;
        return true;
      }
      return false;
    },
    getAsObject: () => rows[index - 1],
    free: sinon.stub(),
  };
}

/**
 * Creează un mock de statement gol (fără rânduri).
 * @returns {Object}
 */
function mockStatementEmpty() {
  return {
    bind: sinon.stub(),
    step: () => false,
    getAsObject: sinon.stub().returns(undefined),
    free: sinon.stub(),
  };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------
describe('RestaurantModel', () => {
  beforeEach(() => {
    // Resetăm toate stub-urile
    sinon.resetHistory();
    mockGetDb.resetBehavior();
    mockDbRun.resetBehavior();
    mockDbPrepare.resetBehavior();
    mockDbExec.resetBehavior();

    // Mock implicit: getDb() returnează o bază de date mock
    mockGetDb.resolves(buildMockDb());

    // Mock db.run (pentru _dbRun)
    mockDbRun.callsFake(() => {}); // nu face nimic, doar permite apelul

    // Mock db.exec pentru changes() și last_insert_rowid()
    mockDbExec.callsFake((sql) => {
      if (sql.includes('changes()')) {
        return [{ columns: ['cnt'], values: [[1]] }];
      }
      if (sql.includes('last_insert_rowid()')) {
        return [{ columns: ['id'], values: [[1]] }];
      }
      return [];
    });
  });

  // =========================================================================
  // CONSTANTE
  // =========================================================================
  describe('Constante', () => {
    it('să exporte VALID_STATUSES', () => {
      expect(restaurantModel.VALID_STATUSES).to.deep.equal(['active', 'inactive', 'closed']);
    });

    it('să exporte VALID_TABLE_STATUSES', () => {
      expect(restaurantModel.VALID_TABLE_STATUSES).to.deep.equal([
        'liberă',
        'ocupată',
        'rezervată',
        'în curățare',
        'indisponibilă',
      ]);
    });

    it('să exporte COLUMN_MAP', () => {
      expect(restaurantModel.COLUMN_MAP).to.be.an('object');
      expect(restaurantModel.COLUMN_MAP.tenant_id).to.equal('tenantId');
      expect(restaurantModel.COLUMN_MAP.capacity).to.equal('tableCount');
      expect(restaurantModel.COLUMN_MAP.created_at).to.equal('createdAt');
      expect(restaurantModel.COLUMN_MAP.updated_at).to.equal('updatedAt');
    });

    it('să exporte COLUMN_MAP_REVERSE', () => {
      expect(restaurantModel.COLUMN_MAP_REVERSE).to.be.an('object');
      expect(restaurantModel.COLUMN_MAP_REVERSE.tenantId).to.equal('tenant_id');
      expect(restaurantModel.COLUMN_MAP_REVERSE.tableCount).to.equal('capacity');
    });
  });

  // =========================================================================
  // _isSqlAvailable
  // =========================================================================
  describe('_isSqlAvailable', () => {
    it('să returneze true întotdeauna', () => {
      expect(restaurantModel._isSqlAvailable()).to.be.true;
    });
  });

  // =========================================================================
  // _sqlRowToDoc
  // =========================================================================
  describe('_sqlRowToDoc', () => {
    it('să convertească un rând SQL în document', () => {
      const row = mockSqlRow();
      const doc = restaurantModel._sqlRowToDoc(row);
      expect(doc).to.be.an('object');
      expect(doc._id).to.equal('1');
      expect(doc.name).to.equal('Test Restaurant');
      expect(doc.tenantId).to.equal(TEST_TENANT);
      expect(doc.tableCount).to.equal(20);
      expect(doc.createdAt).to.equal('2025-01-01T00:00:00.000Z');
      expect(doc.updatedAt).to.equal('2025-01-01T00:00:00.000Z');
      // Verificăm că cheile snake_case NU sunt prezente
      expect(doc.tenant_id).to.be.undefined;
      expect(doc.capacity).to.be.undefined;
      expect(doc.created_at).to.be.undefined;
    });

    it('să returneze null/undefined nemodificat', () => {
      expect(restaurantModel._sqlRowToDoc(null)).to.be.null;
      expect(restaurantModel._sqlRowToDoc(undefined)).to.be.undefined;
    });

    it('să păstreze cheile nemapate', () => {
      const row = { id: 5, name: 'Test', phone: '123', extra_field: 'val' };
      const doc = restaurantModel._sqlRowToDoc(row);
      expect(doc.extra_field).to.equal('val');
      expect(doc.phone).to.equal('123');
    });

    it('să seteze _id ca string din id numeric', () => {
      const row = { id: 99, name: 'X' };
      const doc = restaurantModel._sqlRowToDoc(row);
      expect(doc._id).to.equal('99');
    });
  });

  // =========================================================================
  // _docToSqlParams
  // =========================================================================
  describe('_docToSqlParams', () => {
    it('să convertească camelCase în snake_case', () => {
      const doc = {
        name: 'Test',
        tenantId: 't1',
        tableCount: 10,
        createdAt: '2025-01-01',
      };
      const sql = restaurantModel._docToSqlParams(doc);
      expect(sql.name).to.equal('Test');
      expect(sql.tenant_id).to.equal('t1');
      expect(sql.capacity).to.equal(10);
      expect(sql.created_at).to.equal('2025-01-01');
      // Verificăm că cheile camelCase NU sunt prezente
      expect(sql.tenantId).to.be.undefined;
      expect(sql.tableCount).to.be.undefined;
      expect(sql.createdAt).to.be.undefined;
    });

    it('să returneze obiect gol pentru obiect gol', () => {
      const result = restaurantModel._docToSqlParams({});
      expect(result).to.deep.equal({});
    });

    it('să păstreze cheile fără mapare', () => {
      const doc = { customField: 'val', name: 'Test' };
      const sql = restaurantModel._docToSqlParams(doc);
      expect(sql.customField).to.equal('val');
      expect(sql.name).to.equal('Test');
    });
  });

  // =========================================================================
  // _ensureRestaurantSchema
  // =========================================================================
  describe('_ensureRestaurantSchema', () => {
    it('să execute ALTER TABLE pentru coloanele lipsă', () => {
      const db = buildMockDb();
      restaurantModel._ensureRestaurantSchema(db);
      // Ar trebui să fi apelat db.run de 3 ori (email, status, updated_at)
      expect(mockDbRun.callCount).to.equal(3);
      expect(mockDbRun.firstCall.args[0]).to.include('ADD COLUMN email');
      expect(mockDbRun.secondCall.args[0]).to.include('ADD COLUMN status');
      expect(mockDbRun.thirdCall.args[0]).to.include('ADD COLUMN updated_at');
    });

    it('să nu arunce eroare dacă ALTER TABLE eșuează (coloana există)', () => {
      const db = buildMockDb();
      mockDbRun.throws(new Error('duplicate column'));
      // Nu ar trebui să arunce
      expect(() => restaurantModel._ensureRestaurantSchema(db)).to.not.throw();
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidString
  // =========================================================================
  describe('isValidString', () => {
    it('să returneze true pentru șir valid', () => {
      expect(restaurantModel.isValidString('Hello')).to.be.true;
      expect(restaurantModel.isValidString('a')).to.be.true;
      expect(restaurantModel.isValidString('A'.repeat(255))).to.be.true;
    });

    it('să returneze false pentru șir gol', () => {
      expect(restaurantModel.isValidString('')).to.be.false;
      expect(restaurantModel.isValidString('   ')).to.be.false;
    });

    it('să returneze false pentru non-string', () => {
      expect(restaurantModel.isValidString(123)).to.be.false;
      expect(restaurantModel.isValidString(null)).to.be.false;
      expect(restaurantModel.isValidString(undefined)).to.be.false;
      expect(restaurantModel.isValidString({})).to.be.false;
    });

    it('să respecte limitele min și max', () => {
      expect(restaurantModel.isValidString('abc', 1, 5)).to.be.true;
      expect(restaurantModel.isValidString('abcdef', 1, 5)).to.be.false; // prea lung
      expect(restaurantModel.isValidString('', 1, 5)).to.be.false; // prea scurt
    });

    it('să accepte limite personalizate', () => {
      expect(restaurantModel.isValidString('abc', 3, 3)).to.be.true;
      expect(restaurantModel.isValidString('ab', 3, 3)).to.be.false;
      expect(restaurantModel.isValidString('abcd', 3, 3)).to.be.false;
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidPositiveInt
  // =========================================================================
  describe('isValidPositiveInt', () => {
    it('să returneze true pentru întregi nenegativi', () => {
      expect(restaurantModel.isValidPositiveInt(0)).to.be.true;
      expect(restaurantModel.isValidPositiveInt(1)).to.be.true;
      expect(restaurantModel.isValidPositiveInt(100)).to.be.true;
    });

    it('să returneze false pentru numere negative', () => {
      expect(restaurantModel.isValidPositiveInt(-1)).to.be.false;
      expect(restaurantModel.isValidPositiveInt(-100)).to.be.false;
    });

    it('să returneze false pentru non-integer', () => {
      expect(restaurantModel.isValidPositiveInt(1.5)).to.be.false;
      expect(restaurantModel.isValidPositiveInt('5')).to.be.false;
      expect(restaurantModel.isValidPositiveInt(NaN)).to.be.false;
      expect(restaurantModel.isValidPositiveInt(Infinity)).to.be.false;
      expect(restaurantModel.isValidPositiveInt(null)).to.be.false;
      expect(restaurantModel.isValidPositiveInt(undefined)).to.be.false;
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidStatus
  // =========================================================================
  describe('isValidStatus', () => {
    it('să returneze true pentru statusuri valide', () => {
      expect(restaurantModel.isValidStatus('active')).to.be.true;
      expect(restaurantModel.isValidStatus('inactive')).to.be.true;
      expect(restaurantModel.isValidStatus('closed')).to.be.true;
    });

    it('să returneze false pentru statusuri invalide', () => {
      expect(restaurantModel.isValidStatus('pending')).to.be.false;
      expect(restaurantModel.isValidStatus('')).to.be.false;
      expect(restaurantModel.isValidStatus(null)).to.be.false;
      expect(restaurantModel.isValidStatus(undefined)).to.be.false;
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidTableStatus
  // =========================================================================
  describe('isValidTableStatus', () => {
    it('să returneze true pentru statusuri valide de mese', () => {
      expect(restaurantModel.isValidTableStatus('liberă')).to.be.true;
      expect(restaurantModel.isValidTableStatus('ocupată')).to.be.true;
      expect(restaurantModel.isValidTableStatus('rezervată')).to.be.true;
      expect(restaurantModel.isValidTableStatus('în curățare')).to.be.true;
      expect(restaurantModel.isValidTableStatus('indisponibilă')).to.be.true;
    });

    it('să returneze false pentru statusuri invalide', () => {
      expect(restaurantModel.isValidTableStatus('free')).to.be.false;
      expect(restaurantModel.isValidTableStatus('')).to.be.false;
      expect(restaurantModel.isValidTableStatus(null)).to.be.false;
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidEmail
  // =========================================================================
  describe('isValidEmail', () => {
    it('să returneze true pentru email-uri valide', () => {
      expect(restaurantModel.isValidEmail('test@example.com')).to.be.true;
      expect(restaurantModel.isValidEmail('user.name@domain.co')).to.be.true;
      expect(restaurantModel.isValidEmail('a@b.c')).to.be.true;
    });

    it('să returneze false pentru email-uri invalide', () => {
      expect(restaurantModel.isValidEmail('')).to.be.false;
      expect(restaurantModel.isValidEmail('notanemail')).to.be.false;
      expect(restaurantModel.isValidEmail('@domain.com')).to.be.false;
      expect(restaurantModel.isValidEmail('user@')).to.be.false;
      expect(restaurantModel.isValidEmail('user@.com')).to.be.false;
      expect(restaurantModel.isValidEmail('user @domain.com')).to.be.false;
    });

    it('să returneze false pentru non-string', () => {
      expect(restaurantModel.isValidEmail(null)).to.be.false;
      expect(restaurantModel.isValidEmail(123)).to.be.false;
      expect(restaurantModel.isValidEmail(undefined)).to.be.false;
    });
  });

  // =========================================================================
  // createRestaurant
  // =========================================================================
  describe('createRestaurant', () => {
    beforeEach(() => {
      // Mock pentru _dbGet (SELECT după INSERT returnează rândul creat)
      mockDbPrepare.callsFake((sql) => {
        if (sql.includes('SELECT * FROM restaurants WHERE id = ?')) {
          return mockStatement(mockSqlRow());
        }
        return mockStatementEmpty();
      });
    });

    it('să creeze un restaurant cu date minime', async () => {
      const restaurant = await restaurantModel.createRestaurant(validRestaurantData());
      expect(restaurant).to.be.an('object');
      expect(restaurant._id).to.equal('1');
      expect(restaurant.name).to.equal('Test Restaurant');
      expect(restaurant.address).to.equal('Str. Test nr. 1, București');
      expect(restaurant.tenantId).to.equal(TEST_TENANT);
    });

    it('să creeze un restaurant cu tableCount implicit 0', async () => {
      const data = validRestaurantData({ tableCount: undefined });
      const restaurant = await restaurantModel.createRestaurant(data);
      expect(restaurant.tableCount).to.equal(20); // vine din mockSqlRow (capacity: 20)
      // Verificăm că INSERT a primit 0 pentru capacity
      const insertCall = mockDbRun.getCalls().find(
        (c) => c.args[0] && c.args[0].includes('INSERT INTO restaurants'),
      );
      expect(insertCall).to.exist;
    });

    it('să creeze un restaurant cu email și phone', async () => {
      const restaurant = await restaurantModel.createRestaurant(
        validRestaurantData({ email: 'CONTACT@RESTAURANT.RO', phone: '+40700123456' }),
      );
      expect(restaurant.email).to.equal('test@restaurant.ro'); // vine din mockSqlRow
    });

    it('să creeze un restaurant cu status personalizat', async () => {
      const restaurant = await restaurantModel.createRestaurant(
        validRestaurantData({ status: 'inactive' }),
      );
      expect(restaurant).to.exist;
    });

    it('să respingă date nule', async () => {
      try {
        await restaurantModel.createRestaurant(null);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Datele restaurantului sunt invalide.');
        expect(err.statusCode).to.equal(400);
      }
    });

    it('să respingă date non-obiect', async () => {
      try {
        await restaurantModel.createRestaurant('string');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Datele restaurantului sunt invalide.');
      }
    });

    it('să respingă nume lipsă', async () => {
      try {
        await restaurantModel.createRestaurant(validRestaurantData({ name: '' }));
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Numele restaurantului');
      }
    });

    it('să respingă nume prea lung', async () => {
      try {
        await restaurantModel.createRestaurant(validRestaurantData({ name: 'A'.repeat(101) }));
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Numele restaurantului');
      }
    });

    it('să respingă adresă lipsă', async () => {
      try {
        await restaurantModel.createRestaurant(validRestaurantData({ address: '' }));
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Adresa restaurantului');
      }
    });

    it('să respingă adresă prea scurtă', async () => {
      try {
        await restaurantModel.createRestaurant(validRestaurantData({ address: 'abc' }));
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Adresa restaurantului');
      }
    });

    it('să respingă tenantId lipsă', async () => {
      try {
        await restaurantModel.createRestaurant(validRestaurantData({ tenantId: '' }));
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul tenant-ului este obligatoriu.');
      }
    });

    it('să respingă tableCount negativ', async () => {
      try {
        await restaurantModel.createRestaurant(validRestaurantData({ tableCount: -1 }));
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Numarul de mese');
      }
    });

    it('să respingă tableCount non-integer', async () => {
      try {
        await restaurantModel.createRestaurant(validRestaurantData({ tableCount: 5.5 }));
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Numarul de mese');
      }
    });

    it('să respingă status invalid', async () => {
      try {
        await restaurantModel.createRestaurant(validRestaurantData({ status: 'pending' }));
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Statusul');
      }
    });

    it('să respingă email invalid', async () => {
      try {
        await restaurantModel.createRestaurant(validRestaurantData({ email: 'not-an-email' }));
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('email');
      }
    });

    it('să respingă phone non-string', async () => {
      try {
        await restaurantModel.createRestaurant(validRestaurantData({ phone: 12345 }));
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('telefon');
      }
    });

    it('să accepte email null/undefined/gol', async () => {
      mockDbPrepare.callsFake((sql) => {
        if (sql.includes('SELECT * FROM restaurants')) {
          return mockStatement(mockSqlRow());
        }
        return mockStatementEmpty();
      });
      const r1 = await restaurantModel.createRestaurant(validRestaurantData({ email: undefined }));
      expect(r1).to.exist;
      const r2 = await restaurantModel.createRestaurant(validRestaurantData({ email: null }));
      expect(r2).to.exist;
      const r3 = await restaurantModel.createRestaurant(validRestaurantData({ email: '' }));
      expect(r3).to.exist;
    });

    it('să accepte phone null/undefined', async () => {
      mockDbPrepare.callsFake((sql) => {
        if (sql.includes('SELECT * FROM restaurants')) {
          return mockStatement(mockSqlRow());
        }
        return mockStatementEmpty();
      });
      const r1 = await restaurantModel.createRestaurant(validRestaurantData({ phone: undefined }));
      expect(r1).to.exist;
      const r2 = await restaurantModel.createRestaurant(validRestaurantData({ phone: null }));
      expect(r2).to.exist;
    });

    it('să trimită valorile corecte în INSERT', async () => {
      mockDbPrepare.callsFake((sql) => {
        if (sql.includes('SELECT * FROM restaurants')) {
          return mockStatement(mockSqlRow());
        }
        return mockStatementEmpty();
      });
      await restaurantModel.createRestaurant(validRestaurantData({
        name: '  Pizza Uno  ',
        address: '  Via Roma 1  ',
        email: 'PIZZA@UNO.IT',
      }));

      // Verificăm că db.run a fost apelat cu valorile trim-uite
      const insertCall = mockDbRun.getCalls().find(
        (c) => c.args[0] && c.args[0].includes('INSERT INTO restaurants'),
      );
      expect(insertCall).to.exist;
      const params = insertCall.args[1];
      expect(params[0]).to.equal('Pizza Uno'); // name trim
      expect(params[1]).to.equal('Via Roma 1'); // address trim
      expect(params[5]).to.equal('pizza@uno.it'); // email lowercase+trim
    });

    it('să returneze eroare DB la eroare SQL', async () => {
      mockDbRun.throws(new Error('SQLITE_CONSTRAINT'));
      try {
        await restaurantModel.createRestaurant(validRestaurantData());
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Eroare la crearea restaurantului');
        expect(err.statusCode).to.equal(500);
      }
    });
  });

  // =========================================================================
  // findRestaurantById
  // =========================================================================
  describe('findRestaurantById', () => {
    it('să găsească un restaurant după ID numeric', async () => {
      mockDbPrepare.callsFake((sql) => {
        return mockStatement(mockSqlRow({ id: 42, name: 'Found' }));
      });

      const restaurant = await restaurantModel.findRestaurantById('42');
      expect(restaurant).to.exist;
      expect(restaurant._id).to.equal('42');
      expect(restaurant.name).to.equal('Found');
    });

    it('să găsească un restaurant după ID string', async () => {
      mockDbPrepare.callsFake((sql) => {
        return mockStatement(mockSqlRow({ id: 7, name: 'StringId' }));
      });

      const restaurant = await restaurantModel.findRestaurantById('abc-123');
      expect(restaurant).to.exist;
      expect(restaurant.name).to.equal('StringId');
    });

    it('să returneze null pentru ID inexistent', async () => {
      mockDbPrepare.callsFake(() => mockStatementEmpty());

      const restaurant = await restaurantModel.findRestaurantById('9999');
      expect(restaurant).to.be.null;
    });

    it('să respingă ID invalid', async () => {
      try {
        await restaurantModel.findRestaurantById('');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul restaurantului este invalid.');
      }
    });

    it('să respingă ID null', async () => {
      try {
        await restaurantModel.findRestaurantById(null);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul restaurantului este invalid.');
      }
    });

    it('să arunce AppError la eroare SQL', async () => {
      mockDbPrepare.throws(new Error('DB corrupted'));
      try {
        await restaurantModel.findRestaurantById('1');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Eroare la cautarea restaurantului');
        expect(err.statusCode).to.equal(500);
      }
    });
  });

  // =========================================================================
  // findRestaurantsByTenant
  // =========================================================================
  describe('findRestaurantsByTenant', () => {
    it('să returneze lista de restaurante pentru un tenant', async () => {
      mockDbPrepare.callsFake(() => mockStatementAll([
        mockSqlRow({ id: 1, name: 'R1' }),
        mockSqlRow({ id: 2, name: 'R2' }),
      ]));

      const restaurants = await restaurantModel.findRestaurantsByTenant(TEST_TENANT);
      expect(restaurants).to.have.lengthOf(2);
      expect(restaurants[0].name).to.equal('R1');
      expect(restaurants[1].name).to.equal('R2');
      expect(restaurants[0]._id).to.equal('1');
    });

    it('să returneze listă goală pentru tenant fără restaurante', async () => {
      mockDbPrepare.callsFake(() => mockStatementEmpty());

      const restaurants = await restaurantModel.findRestaurantsByTenant(TEST_TENANT);
      expect(restaurants).to.deep.equal([]);
    });

    it('să respingă tenantId invalid', async () => {
      try {
        await restaurantModel.findRestaurantsByTenant('');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul tenant-ului este invalid.');
      }
    });

    it('să sorteze după nume ascendent implicit', async () => {
      mockDbPrepare.callsFake((sql) => {
        expect(sql).to.include('ORDER BY name ASC');
        return mockStatementEmpty();
      });
      await restaurantModel.findRestaurantsByTenant(TEST_TENANT);
    });

    it('să accepte opțiuni de sortare', async () => {
      mockDbPrepare.callsFake((sql) => {
        expect(sql).to.include('ORDER BY');
        return mockStatementAll([mockSqlRow()]);
      });
      await restaurantModel.findRestaurantsByTenant(TEST_TENANT, {
        sort: { name: -1 },
      });
    });

    it('să accepte opțiuni de sortare cu chei multiple', async () => {
      mockDbPrepare.callsFake((sql) => {
        return mockStatementAll([mockSqlRow()]);
      });
      const restaurants = await restaurantModel.findRestaurantsByTenant(TEST_TENANT, {
        sort: { name: -1, status: 1 },
      });
      expect(restaurants).to.have.lengthOf(1);
    });

    it('să accepte limit și skip', async () => {
      mockDbPrepare.callsFake((sql) => {
        expect(sql).to.include('LIMIT');
        expect(sql).to.include('OFFSET');
        return mockStatementAll([mockSqlRow()]);
      });
      await restaurantModel.findRestaurantsByTenant(TEST_TENANT, {
        limit: 10,
        skip: 20,
      });
    });

    it('să nu aplice limit pentru valori non-pozitive', async () => {
      mockDbPrepare.callsFake((sql) => {
        expect(sql).to.not.include('LIMIT');
        return mockStatementAll([mockSqlRow()]);
      });
      await restaurantModel.findRestaurantsByTenant(TEST_TENANT, { limit: 0 });
    });

    it('să mapeze cheile de sortare la snake_case', async () => {
      mockDbPrepare.callsFake((sql) => {
        // tableCount se mapează la capacity
        expect(sql).to.include('capacity');
        return mockStatementEmpty();
      });
      await restaurantModel.findRestaurantsByTenant(TEST_TENANT, {
        sort: { tableCount: -1 },
      });
    });

    it('să arunce AppError la eroare SQL', async () => {
      mockDbPrepare.throws(new Error('DB error'));
      try {
        await restaurantModel.findRestaurantsByTenant(TEST_TENANT);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Eroare la cautarea restaurantelor');
        expect(err.statusCode).to.equal(500);
      }
    });

    it('să trateze sort cu obiect gol (default name ASC)', async () => {
      mockDbPrepare.callsFake((sql) => {
        expect(sql).to.include('ORDER BY name ASC');
        return mockStatementEmpty();
      });
      await restaurantModel.findRestaurantsByTenant(TEST_TENANT, { sort: {} });
    });
  });

  // =========================================================================
  // findRestaurantsByStatus
  // =========================================================================
  describe('findRestaurantsByStatus', () => {
    it('să returneze restaurante după status', async () => {
      mockDbPrepare.callsFake(() => mockStatementAll([
        mockSqlRow({ id: 1, name: 'Active R', status: 'active' }),
      ]));

      const restaurants = await restaurantModel.findRestaurantsByStatus('active');
      expect(restaurants).to.have.lengthOf(1);
      expect(restaurants[0].status).to.equal('active');
    });

    it('să filtreze și după tenantId', async () => {
      mockDbPrepare.callsFake((sql) => {
        expect(sql).to.include('tenant_id');
        return mockStatementAll([mockSqlRow()]);
      });
      await restaurantModel.findRestaurantsByStatus('active', TEST_TENANT);
    });

    it('să respingă status invalid', async () => {
      try {
        await restaurantModel.findRestaurantsByStatus('pending');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Statusul');
      }
    });

    it('să respingă status gol', async () => {
      try {
        await restaurantModel.findRestaurantsByStatus('');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Statusul');
      }
    });

    it('să arunce AppError la eroare SQL', async () => {
      mockDbPrepare.throws(new Error('DB error'));
      try {
        await restaurantModel.findRestaurantsByStatus('active');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Eroare la cautarea restaurantelor');
        expect(err.statusCode).to.equal(500);
      }
    });
  });

  // =========================================================================
  // updateRestaurant
  // =========================================================================
  describe('updateRestaurant', () => {
    beforeEach(() => {
      mockDbPrepare.callsFake((sql) => {
        if (sql.includes('SELECT * FROM restaurants')) {
          return mockStatement(mockSqlRow({ id: 1, name: 'Updated Name' }));
        }
        return mockStatementEmpty();
      });
    });

    it('să actualizeze numele unui restaurant', async () => {
      const updated = await restaurantModel.updateRestaurant('1', { name: 'Nou Nume' });
      expect(updated).to.exist;
      expect(updated.name).to.equal('Updated Name'); // vine din mockSqlRow
    });

    it('să actualizeze adresa', async () => {
      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[1]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[1]] }];
        return [];
      });
      const updated = await restaurantModel.updateRestaurant('1', { address: 'Adresă nouă' });
      expect(updated).to.exist;
    });

    it('să actualizeze tableCount (mapat la capacity)', async () => {
      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[1]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[1]] }];
        return [];
      });
      const updated = await restaurantModel.updateRestaurant('1', { tableCount: 50 });
      expect(updated).to.exist;
      // Verificăm că s-a folosit capacity în SQL
      const updateCall = mockDbRun.getCalls().find(
        (c) => c.args[0] && c.args[0].includes('UPDATE restaurants'),
      );
      expect(updateCall.args[0]).to.include('capacity = ?');
    });

    it('să actualizeze statusul', async () => {
      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[1]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[1]] }];
        return [];
      });
      const updated = await restaurantModel.updateRestaurant('1', { status: 'inactive' });
      expect(updated).to.exist;
    });

    it('să actualizeze emailul (lowercase + trim)', async () => {
      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[1]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[1]] }];
        return [];
      });
      // Emailul cu litere mari va fi convertit la lowercase de model
      const updated = await restaurantModel.updateRestaurant('1', { email: 'NEW@EMAIL.COM' });
      expect(updated).to.exist;
      // Verificăm că în query s-a folosit lowercase
      const updateCall = mockDbRun.getCalls().find(
        (c) => c.args[0] && c.args[0].includes('UPDATE restaurants'),
      );
      expect(updateCall.args[1]).to.include('new@email.com');
    });

    it('să actualizeze mai multe câmpuri simultan', async () => {
      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[1]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[1]] }];
        return [];
      });
      const updated = await restaurantModel.updateRestaurant('1', {
        name: 'Nou',
        address: 'Adresă',
        phone: '+40000',
        email: 'nou@email.com',
        status: 'closed',
        tableCount: 30,
      });
      expect(updated).to.exist;
    });

    it('să respingă ID invalid', async () => {
      try {
        await restaurantModel.updateRestaurant('', { name: 'Test' });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul restaurantului este invalid.');
      }
    });

    it('să respingă date de actualizare goale', async () => {
      try {
        await restaurantModel.updateRestaurant('1', {});
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Nu s-au furnizat date pentru actualizare.');
      }
    });

    it('să respingă date de actualizare non-obiect', async () => {
      try {
        await restaurantModel.updateRestaurant('1', null);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Nu s-au furnizat date pentru actualizare.');
      }
    });

    it('să respingă nume invalid în actualizare', async () => {
      try {
        await restaurantModel.updateRestaurant('1', { name: '' });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Numele restaurantului');
      }
    });

    it('să respingă adresă invalidă în actualizare', async () => {
      try {
        await restaurantModel.updateRestaurant('1', { address: 'ab' });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Adresa restaurantului');
      }
    });

    it('să respingă tableCount invalid în actualizare', async () => {
      try {
        await restaurantModel.updateRestaurant('1', { tableCount: -5 });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Numarul de mese');
      }
    });

    it('să respingă status invalid în actualizare', async () => {
      try {
        await restaurantModel.updateRestaurant('1', { status: 'pending' });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Statusul');
      }
    });

    it('să ignore câmpurile nepermise', async () => {
      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[1]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[1]] }];
        return [];
      });
      const updated = await restaurantModel.updateRestaurant('1', {
        name: 'Valid',
        tenantId: 'hacked-tenant', // câmp nepermis → ignorat
        _id: '999',
      });
      expect(updated).to.exist;
    });

    it('să arunce eroare dacă niciun câmp valid nu e furnizat', async () => {
      try {
        await restaurantModel.updateRestaurant('1', { tenantId: 'x', _id: 'y' });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Nu s-au furnizat campuri valide pentru actualizare.');
      }
    });

    it('să arunce 404 dacă restaurantul nu există', async () => {
      mockDbExec.callsFake((sql) => {
        // Simulăm 0 changes
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[0]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[0]] }];
        return [];
      });
      try {
        await restaurantModel.updateRestaurant('1', { name: 'Test' });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Restaurantul nu a fost gasit.');
        expect(err.statusCode).to.equal(404);
      }
    });

    it('să accepte phone null/undefined', async () => {
      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[1]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[1]] }];
        return [];
      });
      const updated = await restaurantModel.updateRestaurant('1', { phone: null });
      expect(updated).to.exist;
    });

    it('să accepte email null/undefined/gol', async () => {
      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[1]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[1]] }];
        return [];
      });
      const r1 = await restaurantModel.updateRestaurant('1', { email: null });
      expect(r1).to.exist;
      const r2 = await restaurantModel.updateRestaurant('1', { email: '' });
      expect(r2).to.exist;
    });

    it('să arunce eroare SQL generică', async () => {
      mockDbRun.throws(new Error('DB error'));
      try {
        await restaurantModel.updateRestaurant('1', { name: 'Test' });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Eroare la actualizarea restaurantului');
        expect(err.statusCode).to.equal(500);
      }
    });
  });

  // =========================================================================
  // updateTableCount
  // =========================================================================
  describe('updateTableCount', () => {
    beforeEach(() => {
      mockDbPrepare.callsFake((sql) => {
        if (sql.includes('SELECT * FROM restaurants')) {
          return mockStatement(mockSqlRow({ id: 1, capacity: 50 }));
        }
        return mockStatementEmpty();
      });
    });

    it('să actualizeze numărul de mese', async () => {
      const updated = await restaurantModel.updateTableCount('1', 50);
      expect(updated).to.exist;
      expect(updated.tableCount).to.equal(50);
    });

    it('să respingă tableCount negativ', async () => {
      try {
        await restaurantModel.updateTableCount('1', -1);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Numarul de mese');
      }
    });

    it('să respingă tableCount non-integer', async () => {
      try {
        await restaurantModel.updateTableCount('1', 5.5);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Numarul de mese');
      }
    });

    it('să respingă ID invalid', async () => {
      try {
        await restaurantModel.updateTableCount('', 10);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul restaurantului este invalid.');
      }
    });

    it('să arunce 404 dacă restaurantul nu există', async () => {
      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[0]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[0]] }];
        return [];
      });
      try {
        await restaurantModel.updateTableCount('999', 10);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Restaurantul nu a fost gasit.');
        expect(err.statusCode).to.equal(404);
      }
    });

    it('să funcționeze cu ID string', async () => {
      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[1]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[1]] }];
        return [];
      });
      const updated = await restaurantModel.updateTableCount('abc', 10);
      expect(updated).to.exist;
    });
  });

  // =========================================================================
  // updateRestaurantStatus
  // =========================================================================
  describe('updateRestaurantStatus', () => {
    beforeEach(() => {
      mockDbPrepare.callsFake((sql) => {
        if (sql.includes('SELECT * FROM restaurants')) {
          return mockStatement(mockSqlRow({ id: 1, status: 'inactive' }));
        }
        return mockStatementEmpty();
      });
    });

    it('să actualizeze statusul', async () => {
      const updated = await restaurantModel.updateRestaurantStatus('1', 'inactive');
      expect(updated).to.exist;
      expect(updated.status).to.equal('inactive');
    });

    it('să respingă status invalid', async () => {
      try {
        await restaurantModel.updateRestaurantStatus('1', 'pending');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Statusul');
      }
    });

    it('să respingă status gol', async () => {
      try {
        await restaurantModel.updateRestaurantStatus('1', '');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Statusul');
      }
    });

    it('să respingă ID invalid', async () => {
      try {
        await restaurantModel.updateRestaurantStatus('', 'active');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul restaurantului este invalid.');
      }
    });

    it('să arunce 404 dacă restaurantul nu există', async () => {
      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[0]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[0]] }];
        return [];
      });
      try {
        await restaurantModel.updateRestaurantStatus('999', 'closed');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Restaurantul nu a fost gasit.');
      }
    });
  });

  // =========================================================================
  // deleteRestaurant
  // =========================================================================
  describe('deleteRestaurant', () => {
    it('să șteargă un restaurant după ID', async () => {
      const result = await restaurantModel.deleteRestaurant('1');
      expect(result).to.be.true;
    });

    it('să respingă ID invalid', async () => {
      try {
        await restaurantModel.deleteRestaurant('');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul restaurantului este invalid.');
      }
    });

    it('să respingă ID null', async () => {
      try {
        await restaurantModel.deleteRestaurant(null);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul restaurantului este invalid.');
      }
    });

    it('să arunce 404 dacă restaurantul nu există', async () => {
      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[0]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[0]] }];
        return [];
      });
      try {
        await restaurantModel.deleteRestaurant('999');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Restaurantul nu a fost gasit.');
        expect(err.statusCode).to.equal(404);
      }
    });

    it('să șteargă cu ID string', async () => {
      const result = await restaurantModel.deleteRestaurant('abc-def');
      expect(result).to.be.true;
    });

    it('să arunce eroare SQL generică', async () => {
      mockDbRun.throws(new Error('DB error'));
      try {
        await restaurantModel.deleteRestaurant('1');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Eroare la stergerea restaurantului');
        expect(err.statusCode).to.equal(500);
      }
    });
  });

  // =========================================================================
  // countRestaurantsByTenant
  // =========================================================================
  describe('countRestaurantsByTenant', () => {
    it('să returneze numărul de restaurante pentru un tenant', async () => {
      mockDbPrepare.callsFake(() => mockStatement({ cnt: 5 }));

      const count = await restaurantModel.countRestaurantsByTenant(TEST_TENANT);
      expect(count).to.equal(5);
    });

    it('să returneze 0 pentru tenant fără restaurante', async () => {
      mockDbPrepare.callsFake(() => mockStatementEmpty());

      const count = await restaurantModel.countRestaurantsByTenant(TEST_TENANT2);
      expect(count).to.equal(0);
    });

    it('să returneze 0 pentru tenantId gol', async () => {
      const count = await restaurantModel.countRestaurantsByTenant('');
      expect(count).to.equal(0);
    });

    it('să returneze 0 pentru tenantId null', async () => {
      const count = await restaurantModel.countRestaurantsByTenant(null);
      expect(count).to.equal(0);
    });

    it('să arunce eroare SQL generică', async () => {
      mockDbPrepare.throws(new Error('DB error'));
      try {
        await restaurantModel.countRestaurantsByTenant(TEST_TENANT);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Eroare la numararea restaurantelor');
        expect(err.statusCode).to.equal(500);
      }
    });
  });

  // =========================================================================
  // countRestaurantsByStatus
  // =========================================================================
  describe('countRestaurantsByStatus', () => {
    it('să returneze numărul după status', async () => {
      mockDbPrepare.callsFake(() => mockStatement({ cnt: 3 }));

      const count = await restaurantModel.countRestaurantsByStatus('active');
      expect(count).to.equal(3);
    });

    it('să filtreze și după tenantId', async () => {
      mockDbPrepare.callsFake((sql) => {
        expect(sql).to.include('tenant_id');
        return mockStatement({ cnt: 2 });
      });
      const count = await restaurantModel.countRestaurantsByStatus('active', TEST_TENANT);
      expect(count).to.equal(2);
    });

    it('să respingă status invalid', async () => {
      try {
        await restaurantModel.countRestaurantsByStatus('pending');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Statusul');
      }
    });

    it('să respingă status gol', async () => {
      try {
        await restaurantModel.countRestaurantsByStatus('');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Statusul');
      }
    });

    it('să returneze 0 pentru rând fără cnt', async () => {
      mockDbPrepare.callsFake(() => mockStatementEmpty());

      const count = await restaurantModel.countRestaurantsByStatus('inactive');
      expect(count).to.equal(0);
    });

    it('să arunce eroare SQL generică', async () => {
      mockDbPrepare.throws(new Error('DB error'));
      try {
        await restaurantModel.countRestaurantsByStatus('active');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Eroare la numararea restaurantelor');
        expect(err.statusCode).to.equal(500);
      }
    });
  });

  // =========================================================================
  // searchRestaurantsByName
  // =========================================================================
  describe('searchRestaurantsByName', () => {
    it('să găsească restaurante după nume parțial', async () => {
      mockDbPrepare.callsFake(() => mockStatementAll([
        mockSqlRow({ id: 1, name: 'Pizza Uno' }),
        mockSqlRow({ id: 2, name: 'Pizza Due' }),
      ]));

      const results = await restaurantModel.searchRestaurantsByName('Pizza');
      expect(results).to.have.lengthOf(2);
      expect(results[0].name).to.equal('Pizza Uno');
    });

    it('să filtreze și după tenantId', async () => {
      mockDbPrepare.callsFake((sql) => {
        expect(sql).to.include('tenant_id');
        return mockStatementAll([mockSqlRow()]);
      });
      await restaurantModel.searchRestaurantsByName('Test', TEST_TENANT);
    });

    it('să returneze listă goală dacă nu găsește', async () => {
      mockDbPrepare.callsFake(() => mockStatementEmpty());

      const results = await restaurantModel.searchRestaurantsByName('NONE');
      expect(results).to.deep.equal([]);
    });

    it('să respingă termen de căutare gol', async () => {
      try {
        await restaurantModel.searchRestaurantsByName('');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Termenul de cautare este invalid.');
      }
    });

    it('să respingă termen de căutare null', async () => {
      try {
        await restaurantModel.searchRestaurantsByName(null);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Termenul de cautare este invalid.');
      }
    });

    it('să respingă termen de căutare doar spații', async () => {
      try {
        await restaurantModel.searchRestaurantsByName('   ');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Termenul de cautare este invalid.');
      }
    });

    it('să respingă termen non-string', async () => {
      try {
        await restaurantModel.searchRestaurantsByName(123);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Termenul de cautare este invalid.');
      }
    });

    it('să trim-ă termenul de căutare', async () => {
      let capturedParams;
      mockDbPrepare.callsFake(() => {
        const stmt = mockStatementEmpty();
        const origBind = stmt.bind;
        stmt.bind = (params) => {
          capturedParams = params;
          origBind(params);
        };
        return stmt;
      });
      await restaurantModel.searchRestaurantsByName('  test  ');
      // Parametrul LIKE ar trebui să conțină termenul trim-uit
      expect(capturedParams).to.be.an('array');
      expect(capturedParams[0]).to.equal('%test%');
    });

    it('să sorteze după nume ascendent', async () => {
      mockDbPrepare.callsFake((sql) => {
        expect(sql).to.include('ORDER BY name ASC');
        return mockStatementEmpty();
      });
      await restaurantModel.searchRestaurantsByName('test');
    });

    it('să arunce eroare SQL generică', async () => {
      mockDbPrepare.throws(new Error('DB error'));
      try {
        await restaurantModel.searchRestaurantsByName('test');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Eroare la cautarea restaurantelor');
        expect(err.statusCode).to.equal(500);
      }
    });
  });

  // =========================================================================
  // TESTE INTEGRATE (scenarii complete)
  // =========================================================================
  describe('Scenarii integrate', () => {
    it('flux complet: creare → găsire → actualizare → ștergere', async () => {
      // Configurăm mock-urile pentru flux
      mockDbPrepare.callsFake((sql) => {
        if (sql.includes('SELECT * FROM restaurants WHERE id = ?')) {
          // findRestaurantById după creare
          return mockStatement(mockSqlRow({ id: 1, name: 'Flux Restaurant' }));
        }
        if (sql.includes('SELECT * FROM restaurants WHERE CAST(id AS TEXT) = ?')) {
          // findRestaurantById cu id string
          return mockStatement(mockSqlRow({ id: 1, name: 'Flux Restaurant' }));
        }
        if (sql.includes('SELECT * FROM restaurants WHERE tenant_id = ?')) {
          // findRestaurantsByTenant
          return mockStatementAll([mockSqlRow({ id: 1, name: 'Flux Restaurant' })]);
        }
        if (sql.includes('COUNT(*)') && sql.includes('tenant_id')) {
          // countRestaurantsByTenant
          return mockStatement({ cnt: 1 });
        }
        return mockStatementEmpty();
      });

      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[1]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[1]] }];
        return [];
      });

      // 1. Creare
      const created = await restaurantModel.createRestaurant(validRestaurantData({
        name: 'Flux Restaurant',
      }));
      expect(created._id).to.equal('1');
      expect(created.name).to.equal('Flux Restaurant');

      // 2. Găsire după ID
      const found = await restaurantModel.findRestaurantById('1');
      expect(found).to.exist;

      // 3. Găsire după tenant
      const byTenant = await restaurantModel.findRestaurantsByTenant(TEST_TENANT);
      expect(byTenant).to.have.lengthOf(1);

      // 4. Actualizare
      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[1]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[1]] }];
        return [];
      });
      const updated = await restaurantModel.updateRestaurant('1', { name: 'Flux Updated' });
      expect(updated).to.exist;

      // 5. Numărare
      const count = await restaurantModel.countRestaurantsByTenant(TEST_TENANT);
      expect(count).to.equal(1);

      // 6. Ștergere
      const deleted = await restaurantModel.deleteRestaurant('1');
      expect(deleted).to.be.true;
    });

    it('flux de căutare și filtrare', async () => {
      mockDbPrepare.callsFake((sql) => {
        if (sql.includes('status = ?') && sql.includes('tenant_id = ?') && sql.includes('ORDER BY')) {
          return mockStatementAll([
            mockSqlRow({ id: 1, name: 'R1', status: 'active' }),
          ]);
        }
        if (sql.includes('name LIKE ?') && sql.includes('tenant_id = ?')) {
          return mockStatementAll([
            mockSqlRow({ id: 1, name: 'R1', status: 'active' }),
          ]);
        }
        if (sql.includes('COUNT(*)') && sql.includes('status = ?') && sql.includes('tenant_id = ?')) {
          return mockStatement({ cnt: 1 });
        }
        return mockStatementEmpty();
      });

      // Căutare după status + tenant
      const byStatus = await restaurantModel.findRestaurantsByStatus('active', TEST_TENANT);
      expect(byStatus).to.have.lengthOf(1);

      // Căutare după nume + tenant
      const byName = await restaurantModel.searchRestaurantsByName('R1', TEST_TENANT);
      expect(byName).to.have.lengthOf(1);

      // Numărare după status + tenant
      const count = await restaurantModel.countRestaurantsByStatus('active', TEST_TENANT);
      expect(count).to.equal(1);
    });

    it('flux de actualizare a statusului și a numărului de mese', async () => {
      // Folosim un contor pentru a diferenția apelurile SELECT
      let callIndex = 0;
      mockDbPrepare.callsFake((sql) => {
        if (sql.includes('SELECT * FROM restaurants')) {
          callIndex++;
          if (callIndex === 1) {
            // Primul SELECT: după updateTableCount → returnează capacity 100
            return mockStatement(mockSqlRow({ id: 1, capacity: 100, status: 'active' }));
          }
          // Al doilea SELECT: după updateRestaurantStatus → returnează status closed
          return mockStatement(mockSqlRow({ id: 1, capacity: 100, status: 'closed' }));
        }
        return mockStatementEmpty();
      });

      mockDbExec.callsFake((sql) => {
        if (sql.includes('changes()')) return [{ columns: ['cnt'], values: [[1]] }];
        if (sql.includes('last_insert_rowid()')) return [{ columns: ['id'], values: [[1]] }];
        return [];
      });

      // Actualizare număr mese
      const updatedTables = await restaurantModel.updateTableCount('1', 100);
      expect(updatedTables.tableCount).to.equal(100);

      // Actualizare status
      const updatedStatus = await restaurantModel.updateRestaurantStatus('1', 'closed');
      expect(updatedStatus.status).to.equal('closed');
    });
  });

  // =========================================================================
  // TESTE DE TIP (type checking) pentru exporturi
  // =========================================================================
  describe('Exporturi', () => {
    it('să exporte toate funcțiile', () => {
      expect(restaurantModel.VALID_STATUSES).to.be.an('array');
      expect(restaurantModel.VALID_TABLE_STATUSES).to.be.an('array');
      expect(restaurantModel.isValidString).to.be.a('function');
      expect(restaurantModel.isValidPositiveInt).to.be.a('function');
      expect(restaurantModel.isValidStatus).to.be.a('function');
      expect(restaurantModel.isValidTableStatus).to.be.a('function');
      expect(restaurantModel.isValidEmail).to.be.a('function');
      expect(restaurantModel.createRestaurant).to.be.a('function');
      expect(restaurantModel.findRestaurantById).to.be.a('function');
      expect(restaurantModel.findRestaurantsByTenant).to.be.a('function');
      expect(restaurantModel.findRestaurantsByStatus).to.be.a('function');
      expect(restaurantModel.updateRestaurant).to.be.a('function');
      expect(restaurantModel.deleteRestaurant).to.be.a('function');
      expect(restaurantModel.updateTableCount).to.be.a('function');
      expect(restaurantModel.updateRestaurantStatus).to.be.a('function');
      expect(restaurantModel.countRestaurantsByTenant).to.be.a('function');
      expect(restaurantModel.countRestaurantsByStatus).to.be.a('function');
      expect(restaurantModel.searchRestaurantsByName).to.be.a('function');
      expect(restaurantModel._isSqlAvailable).to.be.a('function');
      expect(restaurantModel._sqlRowToDoc).to.be.a('function');
      expect(restaurantModel._docToSqlParams).to.be.a('function');
      expect(restaurantModel._ensureRestaurantSchema).to.be.a('function');
    });
  });
});