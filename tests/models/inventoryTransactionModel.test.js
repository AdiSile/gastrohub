'use strict';

const chai = require('chai');
const sinon = require('sinon');
const path = require('path');

const { expect } = chai;

// ---------------------------------------------------------------------------
// Pregătire mediu de test – suprascriem NODE_ENV și DB_PATH înainte de
// încărcarea modelului
// ---------------------------------------------------------------------------
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(__dirname, '..', '..', 'data_test');

// ---------------------------------------------------------------------------
// Preluăm modelul (va folosi baza în-memory datorită NODE_ENV=test)
// ---------------------------------------------------------------------------
const transactionModel = require('../../models/inventoryTransactionModel');
const { AppError } = require('../../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Helpers pentru curățare și seed
// ---------------------------------------------------------------------------
function clearCollection() {
  return new Promise((resolve, reject) => {
    transactionModel.inventoryTransactions.remove({}, { multi: true }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function seedTransactions(items) {
  return new Promise((resolve, reject) => {
    transactionModel.inventoryTransactions.insert(items, (err, inserted) => {
      if (err) return reject(err);
      resolve(inserted);
    });
  });
}

// ---------------------------------------------------------------------------
// Date de test reutilizabile
// ---------------------------------------------------------------------------
const tenantA = 'tenant-a';
const tenantB = 'tenant-b';
const itemIdA = 'item-123';
const itemIdB = 'item-456';
const itemIdC = 'item-789';
const userId1 = 'user-1';
const userId2 = 'user-2';
const locationRestaurant1 = { locationId: 'loc-1', locationType: 'restaurant' };
const locationHotel1 = { locationId: 'loc-h1', locationType: 'hotel' };

const baseTransaction = {
  itemId: itemIdA,
  type: 'intrare',
  quantity: 50,
  unit: 'kg',
  note: 'Notă test',
  reference: 'REF-001',
  userId: userId1,
  ...locationRestaurant1,
  tenantId: tenantA,
};

// ---------------------------------------------------------------------------
// Test Suite – InventoryTransactionModel
// ---------------------------------------------------------------------------
describe('InventoryTransactionModel', () => {
  // Resetăm baza înainte de fiecare test
  beforeEach(async () => {
    await clearCollection();
  });

  // =========================================================================
  // CONFIGURAȚIE ȘI CONSTANTE
  // =========================================================================
  describe('Configurație și constante', () => {
    it('să exporte colecția inventoryTransactions', () => {
      expect(transactionModel.inventoryTransactions).to.exist;
    });

    it('să exporte constantele VALID_TRANSACTION_TYPES, VALID_UNITS, VALID_LOCATION_TYPES', () => {
      expect(transactionModel.VALID_TRANSACTION_TYPES).to.deep.equal(['intrare', 'ieșire', 'pierdere']);
      expect(transactionModel.VALID_UNITS).to.include('kg');
      expect(transactionModel.VALID_LOCATION_TYPES).to.deep.equal(['restaurant', 'hotel']);
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE
  // =========================================================================
  describe('Funcții de validare', () => {
    describe('isValidId', () => {
      it('să returneze true pentru string nevid', () => {
        expect(transactionModel.isValidId('abc-123')).to.be.true;
        expect(transactionModel.isValidId('a')).to.be.true;
      });

      it('să returneze false pentru string gol', () => {
        expect(transactionModel.isValidId('')).to.be.false;
      });

      it('să returneze false pentru non-string', () => {
        expect(transactionModel.isValidId(null)).to.be.false;
        expect(transactionModel.isValidId(undefined)).to.be.false;
        expect(transactionModel.isValidId(123)).to.be.false;
        expect(transactionModel.isValidId({})).to.be.false;
      });
    });

    describe('isValidTransactionType', () => {
      it('să returneze true pentru tipuri valide', () => {
        expect(transactionModel.isValidTransactionType('intrare')).to.be.true;
        expect(transactionModel.isValidTransactionType('ieșire')).to.be.true;
        expect(transactionModel.isValidTransactionType('pierdere')).to.be.true;
      });

      it('să returneze false pentru tipuri invalide', () => {
        expect(transactionModel.isValidTransactionType('transfer')).to.be.false;
        expect(transactionModel.isValidTransactionType('')).to.be.false;
      });
    });

    describe('isValidUnit', () => {
      it('să returneze true pentru unități valide', () => {
        expect(transactionModel.isValidUnit('kg')).to.be.true;
        expect(transactionModel.isValidUnit('l')).to.be.true;
        expect(transactionModel.isValidUnit('buc')).to.be.true;
        expect(transactionModel.isValidUnit('bax')).to.be.true;
      });

      it('să returneze false pentru unități invalide', () => {
        expect(transactionModel.isValidUnit('litru')).to.be.false;
        expect(transactionModel.isValidUnit('')).to.be.false;
      });
    });

    describe('isValidLocationType', () => {
      it('să returneze true pentru tipuri valide', () => {
        expect(transactionModel.isValidLocationType('restaurant')).to.be.true;
        expect(transactionModel.isValidLocationType('hotel')).to.be.true;
      });

      it('să returneze false pentru tipuri invalide', () => {
        expect(transactionModel.isValidLocationType('depozit')).to.be.false;
        expect(transactionModel.isValidLocationType('')).to.be.false;
      });
    });

    describe('isValidQuantity', () => {
      it('să returneze true pentru numere > 0', () => {
        expect(transactionModel.isValidQuantity(1)).to.be.true;
        expect(transactionModel.isValidQuantity(100.5)).to.be.true;
        expect(transactionModel.isValidQuantity(0.01)).to.be.true;
      });

      it('să returneze false pentru 0, negative sau non-numeric', () => {
        expect(transactionModel.isValidQuantity(0)).to.be.false;
        expect(transactionModel.isValidQuantity(-1)).to.be.false;
        expect(transactionModel.isValidQuantity('10')).to.be.false;
        expect(transactionModel.isValidQuantity(NaN)).to.be.false;
        expect(transactionModel.isValidQuantity(null)).to.be.false;
        expect(transactionModel.isValidQuantity(undefined)).to.be.false;
      });
    });
  });

  // =========================================================================
  // createInventoryTransaction
  // =========================================================================
  describe('createInventoryTransaction', () => {
    it('să creeze o tranzacție de inventar validă', async () => {
      const trx = await transactionModel.createInventoryTransaction(baseTransaction);
      expect(trx).to.exist;
      expect(trx._id).to.exist;
      expect(trx.itemId).to.equal(itemIdA);
      expect(trx.type).to.equal('intrare');
      expect(trx.quantity).to.equal(50);
      expect(trx.unit).to.equal('kg');
      expect(trx.note).to.equal('Notă test');
      expect(trx.reference).to.equal('REF-001');
      expect(trx.userId).to.equal(userId1);
      expect(trx.locationId).to.equal('loc-1');
      expect(trx.locationType).to.equal('restaurant');
      expect(trx.tenantId).to.equal(tenantA);
      expect(trx.createdAt).to.exist;
    });

    it('să seteze note și reference cu valori default la string gol', async () => {
      const trx = await transactionModel.createInventoryTransaction({
        ...baseTransaction,
        note: undefined,
        reference: undefined,
      });
      expect(trx.note).to.equal('');
      expect(trx.reference).to.equal('');
    });

    it('să permită note și reference explicite ca string gol', async () => {
      const trx = await transactionModel.createInventoryTransaction({
        ...baseTransaction,
        note: '',
        reference: '',
      });
      expect(trx.note).to.equal('');
      expect(trx.reference).to.equal('');
    });

    // Test pentru erori de validare
    const invalidCases = [
      { desc: 'date invalide (null)', data: null, code: 'INVALID_TRANSACTION_DATA' },
      { desc: 'fără itemId', data: { ...baseTransaction, itemId: undefined }, code: 'INVALID_ITEM_ID' },
      { desc: 'itemId gol', data: { ...baseTransaction, itemId: '' }, code: 'INVALID_ITEM_ID' },
      { desc: 'fără type', data: { ...baseTransaction, type: undefined }, code: 'INVALID_TRANSACTION_TYPE' },
      { desc: 'type invalid', data: { ...baseTransaction, type: 'transfer' }, code: 'INVALID_TRANSACTION_TYPE' },
      { desc: 'fără quantity', data: { ...baseTransaction, quantity: undefined }, code: 'INVALID_QUANTITY' },
      { desc: 'quantity = 0', data: { ...baseTransaction, quantity: 0 }, code: 'INVALID_QUANTITY' },
      { desc: 'quantity negativă', data: { ...baseTransaction, quantity: -5 }, code: 'INVALID_QUANTITY' },
      { desc: 'fără unit', data: { ...baseTransaction, unit: undefined }, code: 'INVALID_UNIT' },
      { desc: 'unit invalid', data: { ...baseTransaction, unit: 'litru' }, code: 'INVALID_UNIT' },
      { desc: 'fără userId', data: { ...baseTransaction, userId: undefined }, code: 'INVALID_USER_ID' },
      { desc: 'userId gol', data: { ...baseTransaction, userId: '' }, code: 'INVALID_USER_ID' },
      { desc: 'fără locationId', data: { ...baseTransaction, locationId: undefined }, code: 'INVALID_LOCATION_ID' },
      { desc: 'locationId gol', data: { ...baseTransaction, locationId: '' }, code: 'INVALID_LOCATION_ID' },
      { desc: 'fără locationType', data: { ...baseTransaction, locationType: undefined }, code: 'INVALID_LOCATION_TYPE' },
      { desc: 'locationType invalid', data: { ...baseTransaction, locationType: 'depozit' }, code: 'INVALID_LOCATION_TYPE' },
      { desc: 'fără tenantId', data: { ...baseTransaction, tenantId: undefined }, code: 'INVALID_TENANT_ID' },
      { desc: 'tenantId gol', data: { ...baseTransaction, tenantId: '' }, code: 'INVALID_TENANT_ID' },
    ];

    for (const tc of invalidCases) {
      // eslint-disable-next-line no-loop-func
      it(`să respingă: ${tc.desc}`, async () => {
        try {
          await transactionModel.createInventoryTransaction(tc.data);
          throw new Error('A trebuit să arunce o eroare');
        } catch (err) {
          expect(err).to.be.instanceOf(AppError);
          expect(err.code).to.equal(tc.code);
        }
      });
    }
  });

  // =========================================================================
  // findInventoryTransactionById
  // =========================================================================
  describe('findInventoryTransactionById', () => {
    it('să găsească o tranzacție existentă', async () => {
      const created = await transactionModel.createInventoryTransaction(baseTransaction);
      const found = await transactionModel.findInventoryTransactionById(created._id);
      expect(found).to.exist;
      expect(found._id).to.equal(created._id);
    });

    it('să returneze null pentru ID inexistent', async () => {
      const found = await transactionModel.findInventoryTransactionById('nonexistent');
      expect(found).to.be.null;
    });

    it('să respingă ID gol', async () => {
      try {
        await transactionModel.findInventoryTransactionById('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_TRANSACTION_ID');
      }
    });

    it('să respingă ID null', async () => {
      try {
        await transactionModel.findInventoryTransactionById(null);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_TRANSACTION_ID');
      }
    });
  });

  // =========================================================================
  // findTransactionsByItem
  // =========================================================================
  describe('findTransactionsByItem', () => {
    beforeEach(async () => {
      await seedTransactions([
        { ...baseTransaction, itemId: itemIdA, quantity: 10 },
        { ...baseTransaction, itemId: itemIdA, type: 'ieșire', quantity: 5 },
        { ...baseTransaction, itemId: itemIdB, quantity: 20 },
      ]);
    });

    it('să găsească tranzacțiile pentru un item', async () => {
      const trxList = await transactionModel.findTransactionsByItem(itemIdA);
      expect(trxList).to.have.lengthOf(2);
    });

    it('să filtreze după tip', async () => {
      const trxList = await transactionModel.findTransactionsByItem(itemIdA, { type: 'ieșire' });
      expect(trxList).to.have.lengthOf(1);
      expect(trxList[0].type).to.equal('ieșire');
    });

    it('să sorteze ascendent', async () => {
      const trxList = await transactionModel.findTransactionsByItem(itemIdA, { sortOrder: 'asc' });
      expect(trxList).to.have.lengthOf(2);
    });

    it('să returneze lista goală pentru item fără tranzacții', async () => {
      const trxList = await transactionModel.findTransactionsByItem('inexistent');
      expect(trxList).to.deep.equal([]);
    });

    it('să respingă itemId gol', async () => {
      try {
        await transactionModel.findTransactionsByItem('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_ITEM_ID');
      }
    });
  });

  // =========================================================================
  // findTransactionsByTenant
  // =========================================================================
  describe('findTransactionsByTenant', () => {
    beforeEach(async () => {
      await seedTransactions([
        { ...baseTransaction, tenantId: tenantA, type: 'intrare', quantity: 10, userId: userId1 },
        { ...baseTransaction, tenantId: tenantA, type: 'ieșire', quantity: 5, userId: userId2 },
        { ...baseTransaction, tenantId: tenantA, type: 'pierdere', quantity: 2, itemId: itemIdB },
        { ...baseTransaction, tenantId: tenantB, type: 'intrare', quantity: 100 },
      ]);
    });

    it('să găsească toate tranzacțiile unui tenant', async () => {
      const trxList = await transactionModel.findTransactionsByTenant(tenantA);
      expect(trxList).to.have.lengthOf(3);
    });

    it('să filtreze după type', async () => {
      const trxList = await transactionModel.findTransactionsByTenant(tenantA, { type: 'ieșire' });
      expect(trxList).to.have.lengthOf(1);
      expect(trxList[0].type).to.equal('ieșire');
    });

    it('să filtreze după itemId', async () => {
      const trxList = await transactionModel.findTransactionsByTenant(tenantA, { itemId: itemIdB });
      expect(trxList).to.have.lengthOf(1);
    });

    it('să filtreze după userId', async () => {
      const trxList = await transactionModel.findTransactionsByTenant(tenantA, { userId: userId2 });
      expect(trxList).to.have.lengthOf(1);
    });

    it('să filtreze după locationId', async () => {
      const trxList = await transactionModel.findTransactionsByTenant(tenantA, { locationId: 'loc-1' });
      expect(trxList).to.have.lengthOf(3);
    });

    it('să filtreze după locationType', async () => {
      const trxList = await transactionModel.findTransactionsByTenant(tenantA, { locationType: 'restaurant' });
      expect(trxList).to.have.lengthOf(3);
    });

    it('să filtreze după interval de date (startDate)', async () => {
      const trxList = await transactionModel.findTransactionsByTenant(tenantA, {
        startDate: new Date(Date.now() - 3600000).toISOString(),
      });
      expect(trxList).to.have.lengthOf(3);
    });

    it('să filtreze după interval de date (endDate)', async () => {
      const trxList = await transactionModel.findTransactionsByTenant(tenantA, {
        endDate: new Date(Date.now() + 3600000).toISOString(),
      });
      expect(trxList).to.have.lengthOf(3);
    });

    it('să suporte paginare cu skip și limit', async () => {
      await seedTransactions([
        { ...baseTransaction, tenantId: tenantA, type: 'intrare', quantity: 1 },
        { ...baseTransaction, tenantId: tenantA, type: 'intrare', quantity: 2 },
      ]);
      const trxList = await transactionModel.findTransactionsByTenant(tenantA, { limit: 2, skip: 1 });
      expect(trxList).to.have.lengthOf(2);
    });

    it('să sorteze ascendent', async () => {
      const trxList = await transactionModel.findTransactionsByTenant(tenantA, { sortOrder: 'asc' });
      expect(trxList).to.have.lengthOf(3);
    });

    it('să returneze lista goală pentru tenant fără tranzacții', async () => {
      const trxList = await transactionModel.findTransactionsByTenant('inexistent');
      expect(trxList).to.deep.equal([]);
    });

    it('să respingă tenantId gol', async () => {
      try {
        await transactionModel.findTransactionsByTenant('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_TENANT_ID');
      }
    });
  });

  // =========================================================================
  // findTransactionsByUser
  // =========================================================================
  describe('findTransactionsByUser', () => {
    beforeEach(async () => {
      await seedTransactions([
        { ...baseTransaction, userId: userId1, quantity: 10 },
        { ...baseTransaction, userId: userId1, type: 'ieșire', quantity: 5 },
        { ...baseTransaction, userId: userId2, quantity: 20 },
      ]);
    });

    it('să găsească tranzacțiile unui utilizator', async () => {
      const trxList = await transactionModel.findTransactionsByUser(userId1);
      expect(trxList).to.have.lengthOf(2);
    });

    it('să filtreze după tip', async () => {
      const trxList = await transactionModel.findTransactionsByUser(userId1, { type: 'ieșire' });
      expect(trxList).to.have.lengthOf(1);
    });

    it('să limiteze numărul de rezultate', async () => {
      const trxList = await transactionModel.findTransactionsByUser(userId1, { limit: 1 });
      expect(trxList).to.have.lengthOf(1);
    });

    it('să returneze lista goală pentru utilizator fără tranzacții', async () => {
      const trxList = await transactionModel.findTransactionsByUser('inexistent');
      expect(trxList).to.deep.equal([]);
    });

    it('să respingă userId gol', async () => {
      try {
        await transactionModel.findTransactionsByUser('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_USER_ID');
      }
    });
  });

  // =========================================================================
  // findTransactionsByReference
  // =========================================================================
  describe('findTransactionsByReference', () => {
    beforeEach(async () => {
      await seedTransactions([
        { ...baseTransaction, reference: 'REF-001', quantity: 10 },
        { ...baseTransaction, reference: 'REF-001', type: 'ieșire', quantity: 5 },
        { ...baseTransaction, reference: 'REF-002', quantity: 20 },
      ]);
    });

    it('să găsească tranzacțiile după referință', async () => {
      const trxList = await transactionModel.findTransactionsByReference('REF-001');
      expect(trxList).to.have.lengthOf(2);
    });

    it('să filtreze după tenant', async () => {
      const trxList = await transactionModel.findTransactionsByReference('REF-001', { tenantId: tenantA });
      expect(trxList).to.have.lengthOf(2);
    });

    it('să limiteze numărul de rezultate', async () => {
      const trxList = await transactionModel.findTransactionsByReference('REF-001', { limit: 1 });
      expect(trxList).to.have.lengthOf(1);
    });

    it('să returneze lista goală pentru referință inexistentă', async () => {
      const trxList = await transactionModel.findTransactionsByReference('INEXISTENT');
      expect(trxList).to.deep.equal([]);
    });

    it('să respingă referință goală', async () => {
      try {
        await transactionModel.findTransactionsByReference('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_REFERENCE');
      }
    });
  });

  // =========================================================================
  // findTransactionsByLocation
  // =========================================================================
  describe('findTransactionsByLocation', () => {
    beforeEach(async () => {
      await seedTransactions([
        { ...baseTransaction, locationId: 'loc-1', locationType: 'restaurant', quantity: 10 },
        { ...baseTransaction, locationId: 'loc-1', locationType: 'restaurant', type: 'ieșire', quantity: 5 },
        { ...baseTransaction, locationId: 'loc-h1', locationType: 'hotel', quantity: 20 },
      ]);
    });

    it('să găsească tranzacțiile după locație', async () => {
      const trxList = await transactionModel.findTransactionsByLocation('loc-1', 'restaurant');
      expect(trxList).to.have.lengthOf(2);
    });

    it('să filtreze după tip', async () => {
      const trxList = await transactionModel.findTransactionsByLocation('loc-1', 'restaurant', { type: 'ieșire' });
      expect(trxList).to.have.lengthOf(1);
    });

    it('să filtreze după interval de date', async () => {
      const trxList = await transactionModel.findTransactionsByLocation('loc-1', 'restaurant', {
        startDate: new Date(Date.now() - 3600000).toISOString(),
      });
      expect(trxList).to.have.lengthOf(2);
    });

    it('să limiteze numărul de rezultate', async () => {
      const trxList = await transactionModel.findTransactionsByLocation('loc-1', 'restaurant', { limit: 1 });
      expect(trxList).to.have.lengthOf(1);
    });

    it('să returneze lista goală pentru locație fără tranzacții', async () => {
      const trxList = await transactionModel.findTransactionsByLocation('inexistent', 'restaurant');
      expect(trxList).to.deep.equal([]);
    });

    it('să respingă locationId gol', async () => {
      try {
        await transactionModel.findTransactionsByLocation('', 'restaurant');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_LOCATION_ID');
      }
    });

    it('să respingă locationType invalid', async () => {
      try {
        await transactionModel.findTransactionsByLocation('loc-1', 'depozit');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_LOCATION_TYPE');
      }
    });
  });

  // =========================================================================
  // findTransactionsByType
  // =========================================================================
  describe('findTransactionsByType', () => {
    beforeEach(async () => {
      await seedTransactions([
        { ...baseTransaction, type: 'intrare', quantity: 10 },
        { ...baseTransaction, type: 'ieșire', quantity: 5 },
        { ...baseTransaction, type: 'pierdere', quantity: 2 },
        { ...baseTransaction, type: 'intrare', quantity: 20, tenantId: tenantB },
      ]);
    });

    it('să găsească tranzacțiile după tip', async () => {
      const trxList = await transactionModel.findTransactionsByType('intrare');
      expect(trxList).to.have.lengthOf(2);
    });

    it('să filtreze după tenant', async () => {
      const trxList = await transactionModel.findTransactionsByType('intrare', { tenantId: tenantA });
      expect(trxList).to.have.lengthOf(1);
    });

    it('să filtreze după locationId', async () => {
      const trxList = await transactionModel.findTransactionsByType('intrare', { locationId: 'loc-1' });
      expect(trxList).to.have.lengthOf(2);
    });

    it('să limiteze numărul de rezultate', async () => {
      const trxList = await transactionModel.findTransactionsByType('intrare', { limit: 1 });
      expect(trxList).to.have.lengthOf(1);
    });

    it('să returneze lista goală pentru tip fără tranzacții', async () => {
      const trxList = await transactionModel.findTransactionsByType('pierdere', { tenantId: tenantB });
      expect(trxList).to.deep.equal([]);
    });

    it('să respingă type invalid', async () => {
      try {
        await transactionModel.findTransactionsByType('transfer');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_TRANSACTION_TYPE');
      }
    });

    it('să respingă type gol', async () => {
      try {
        await transactionModel.findTransactionsByType('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_TRANSACTION_TYPE');
      }
    });
  });

  // =========================================================================
  // countTransactions
  // =========================================================================
  describe('countTransactions', () => {
    beforeEach(async () => {
      await seedTransactions([
        { ...baseTransaction, tenantId: tenantA, type: 'intrare', quantity: 10 },
        { ...baseTransaction, tenantId: tenantA, type: 'ieșire', quantity: 5 },
        { ...baseTransaction, tenantId: tenantA, type: 'pierdere', quantity: 2, itemId: itemIdB },
        { ...baseTransaction, tenantId: tenantB, type: 'intrare', quantity: 100 },
      ]);
    });

    it('să numere tranzacțiile unui tenant', async () => {
      const count = await transactionModel.countTransactions(tenantA);
      expect(count).to.equal(3);
    });

    it('să numere cu filtru de tip', async () => {
      const count = await transactionModel.countTransactions(tenantA, { type: 'ieșire' });
      expect(count).to.equal(1);
    });

    it('să numere cu filtru de itemId', async () => {
      const count = await transactionModel.countTransactions(tenantA, { itemId: itemIdB });
      expect(count).to.equal(1);
    });

    it('să numere cu filtru de userId', async () => {
      const count = await transactionModel.countTransactions(tenantA, { userId: userId1 });
      expect(count).to.equal(3);
    });

    it('să numere cu filtru de interval date', async () => {
      const count = await transactionModel.countTransactions(tenantA, {
        startDate: new Date(Date.now() - 3600000).toISOString(),
        endDate: new Date(Date.now() + 3600000).toISOString(),
      });
      expect(count).to.equal(3);
    });

    it('să returneze 0 pentru tenantId gol', async () => {
      const count = await transactionModel.countTransactions('');
      expect(count).to.equal(0);
    });
  });

  // =========================================================================
  // getTransactionSummary
  // =========================================================================
  describe('getTransactionSummary', () => {
    beforeEach(async () => {
      await seedTransactions([
        { ...baseTransaction, tenantId: tenantA, type: 'intrare', quantity: 50 },
        { ...baseTransaction, tenantId: tenantA, type: 'intrare', quantity: 30 },
        { ...baseTransaction, tenantId: tenantA, type: 'ieșire', quantity: 20 },
        { ...baseTransaction, tenantId: tenantA, type: 'pierdere', quantity: 5 },
        { ...baseTransaction, tenantId: tenantB, type: 'intrare', quantity: 100 },
      ]);
    });

    it('să returneze sumarul pe tipuri de tranzacții', async () => {
      const summary = await transactionModel.getTransactionSummary(tenantA);
      expect(summary).to.be.an('array');
      expect(summary).to.have.lengthOf(3);

      const intrare = summary.find((s) => s.type === 'intrare');
      const iesire = summary.find((s) => s.type === 'ieșire');
      const pierdere = summary.find((s) => s.type === 'pierdere');

      expect(intrare).to.exist;
      expect(intrare.count).to.equal(2);
      expect(intrare.totalQuantity).to.equal(80);

      expect(iesire).to.exist;
      expect(iesire.count).to.equal(1);
      expect(iesire.totalQuantity).to.equal(20);

      expect(pierdere).to.exist;
      expect(pierdere.count).to.equal(1);
      expect(pierdere.totalQuantity).to.equal(5);
    });

    it('să filtreze după interval de date', async () => {
      const summary = await transactionModel.getTransactionSummary(tenantA, {
        startDate: new Date(Date.now() - 3600000).toISOString(),
      });
      expect(summary).to.have.lengthOf(3);
    });

    it('să returneze lista goală pentru tenant fără tranzacții', async () => {
      const summary = await transactionModel.getTransactionSummary('inexistent');
      expect(summary).to.deep.equal([]);
    });

    it('să respingă tenantId gol', async () => {
      try {
        await transactionModel.getTransactionSummary('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_TENANT_ID');
      }
    });
  });

  // =========================================================================
  // getItemTransactionHistory
  // =========================================================================
  describe('getItemTransactionHistory', () => {
    beforeEach(async () => {
      await seedTransactions([
        { ...baseTransaction, itemId: itemIdA, quantity: 10 },
        { ...baseTransaction, itemId: itemIdA, type: 'ieșire', quantity: 5 },
        { ...baseTransaction, itemId: itemIdA, type: 'pierdere', quantity: 2 },
        { ...baseTransaction, itemId: itemIdB, quantity: 20 },
      ]);
    });

    it('să returneze istoricul paginat', async () => {
      const result = await transactionModel.getItemTransactionHistory(itemIdA);
      expect(result).to.exist;
      expect(result.transactions).to.have.lengthOf(3);
      expect(result.total).to.equal(3);
      expect(result.page).to.equal(1);
      expect(result.limit).to.equal(50);
      expect(result.totalPages).to.equal(1);
    });

    it('să suporte paginare personalizată', async () => {
      const result = await transactionModel.getItemTransactionHistory(itemIdA, { page: 1, limit: 2 });
      expect(result.transactions).to.have.lengthOf(2);
      expect(result.total).to.equal(3);
      expect(result.limit).to.equal(2);
      expect(result.totalPages).to.equal(2);
    });

    it('să returneze paginare corectă pentru pagina 2', async () => {
      const result = await transactionModel.getItemTransactionHistory(itemIdA, { page: 2, limit: 2 });
      expect(result.transactions).to.have.lengthOf(1);
      expect(result.page).to.equal(2);
      expect(result.totalPages).to.equal(2);
    });

    it('să returneze istoric gol pentru item fără tranzacții', async () => {
      const result = await transactionModel.getItemTransactionHistory('inexistent');
      expect(result.transactions).to.deep.equal([]);
      expect(result.total).to.equal(0);
      expect(result.totalPages).to.equal(0);
    });

    it('să respingă itemId gol', async () => {
      try {
        await transactionModel.getItemTransactionHistory('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_ITEM_ID');
      }
    });

    it('să normalizeze page/limit la valori valide', async () => {
      const result = await transactionModel.getItemTransactionHistory(itemIdA, { page: 0, limit: 200 });
      expect(result.page).to.equal(1);
      expect(result.limit).to.equal(100);
    });
  });

  // =========================================================================
  // createInventoryTransaction – câmpuri noi (performedBy, previousQuantity, newQuantity)
  // =========================================================================
  describe('createInventoryTransaction – câmpuri noul API', () => {
    it('să accepte performedBy în loc de userId', async () => {
      const { userId, ...withoutUserId } = baseTransaction;
      const trx = await transactionModel.createInventoryTransaction({
        ...withoutUserId,
        performedBy: userId1,
      });
      expect(trx.userId).to.equal(userId1);
    });

    it('să acorde prioritate lui performedBy față de userId', async () => {
      const trx = await transactionModel.createInventoryTransaction({
        ...baseTransaction,
        userId: 'old-user',
        performedBy: 'new-user',
      });
      expect(trx.userId).to.equal('new-user');
    });

    it('să stocheze previousQuantity când este furnizat', async () => {
      const trx = await transactionModel.createInventoryTransaction({
        ...baseTransaction,
        previousQuantity: 30,
      });
      expect(trx.previousQuantity).to.equal(30);
    });

    it('să stocheze newQuantity când este furnizat', async () => {
      const trx = await transactionModel.createInventoryTransaction({
        ...baseTransaction,
        newQuantity: 80,
      });
      expect(trx.newQuantity).to.equal(80);
    });

    it('să stocheze ambele previousQuantity și newQuantity împreună', async () => {
      const trx = await transactionModel.createInventoryTransaction({
        ...baseTransaction,
        previousQuantity: 30,
        newQuantity: 80,
      });
      expect(trx.previousQuantity).to.equal(30);
      expect(trx.newQuantity).to.equal(80);
    });

    it('să NU adauge previousQuantity dacă este null/undefined', async () => {
      const trx = await transactionModel.createInventoryTransaction({
        ...baseTransaction,
        previousQuantity: null,
        newQuantity: undefined,
      });
      expect(trx).to.not.have.property('previousQuantity');
      expect(trx).to.not.have.property('newQuantity');
    });

    it('să respingă dacă nici userId nici performedBy nu sunt furnizate', async () => {
      const { userId, ...withoutUserId } = baseTransaction;
      try {
        await transactionModel.createInventoryTransaction(withoutUserId);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_USER_ID');
      }
    });
  });

  // =========================================================================
  // deleteInventoryTransaction
  // =========================================================================
  describe('deleteInventoryTransaction', () => {
    it('să șteargă o tranzacție existentă', async () => {
      const created = await transactionModel.createInventoryTransaction(baseTransaction);
      const result = await transactionModel.deleteInventoryTransaction(created._id);
      expect(result).to.be.true;

      const found = await transactionModel.findInventoryTransactionById(created._id);
      expect(found).to.be.null;
    });

    it('să arunce TRANSACTION_NOT_FOUND pentru ID inexistent', async () => {
      try {
        await transactionModel.deleteInventoryTransaction('nonexistent');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('TRANSACTION_NOT_FOUND');
      }
    });

    it('să respingă ID gol', async () => {
      try {
        await transactionModel.deleteInventoryTransaction('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_TRANSACTION_ID');
      }
    });

    it('să respingă ID null', async () => {
      try {
        await transactionModel.deleteInventoryTransaction(null);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_TRANSACTION_ID');
      }
    });
  });

  // =========================================================================
  // deleteTransactionsByItem
  // =========================================================================
  describe('deleteTransactionsByItem', () => {
    beforeEach(async () => {
      await seedTransactions([
        { ...baseTransaction, itemId: itemIdA, quantity: 10 },
        { ...baseTransaction, itemId: itemIdA, type: 'ieșire', quantity: 5 },
        { ...baseTransaction, itemId: itemIdB, quantity: 20 },
      ]);
    });

    it('să șteargă toate tranzacțiile pentru un item', async () => {
      const numRemoved = await transactionModel.deleteTransactionsByItem(itemIdA);
      expect(numRemoved).to.equal(2);

      const remaining = await transactionModel.findTransactionsByItem(itemIdA);
      expect(remaining).to.deep.equal([]);
    });

    it('să returneze 0 pentru item fără tranzacții', async () => {
      const numRemoved = await transactionModel.deleteTransactionsByItem('inexistent');
      expect(numRemoved).to.equal(0);
    });

    it('să nu șteargă tranzacțiile altor iteme', async () => {
      await transactionModel.deleteTransactionsByItem(itemIdA);
      const remaining = await transactionModel.findTransactionsByItem(itemIdB);
      expect(remaining).to.have.lengthOf(1);
    });

    it('să respingă itemId gol', async () => {
      try {
        await transactionModel.deleteTransactionsByItem('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_ITEM_ID');
      }
    });
  });

  // =========================================================================
  // getItemConsumption
  // =========================================================================
  describe('getItemConsumption', () => {
    beforeEach(async () => {
      await seedTransactions([
        { ...baseTransaction, itemId: itemIdA, type: 'intrare', quantity: 100 },
        { ...baseTransaction, itemId: itemIdA, type: 'ieșire', quantity: 30 },
        { ...baseTransaction, itemId: itemIdA, type: 'ieșire', quantity: 20 },
        { ...baseTransaction, itemId: itemIdA, type: 'pierdere', quantity: 5 },
        { ...baseTransaction, itemId: itemIdB, type: 'intrare', quantity: 50 },
      ]);
    });

    it('să calculeze consumul total (ieșiri + pierderi)', async () => {
      const result = await transactionModel.getItemConsumption(itemIdA);
      expect(result).to.exist;
      expect(result.totalOut).to.equal(50);  // 30 + 20
      expect(result.totalLoss).to.equal(5);
      expect(result.netConsumption).to.equal(55); // 50 + 5
    });

    it('să returneze 0 pentru item fără consum', async () => {
      await clearCollection();
      await seedTransactions([
        { ...baseTransaction, itemId: itemIdC, type: 'intrare', quantity: 100 },
      ]);
      const result = await transactionModel.getItemConsumption(itemIdC);
      expect(result.totalOut).to.equal(0);
      expect(result.totalLoss).to.equal(0);
      expect(result.netConsumption).to.equal(0);
    });

    it('să filtreze după interval de date (startDate)', async () => {
      const result = await transactionModel.getItemConsumption(itemIdA, {
        startDate: new Date(Date.now() - 3600000).toISOString(),
      });
      expect(result.netConsumption).to.equal(55);
    });

    it('să filtreze după interval de date (endDate)', async () => {
      const result = await transactionModel.getItemConsumption(itemIdA, {
        endDate: new Date(Date.now() + 3600000).toISOString(),
      });
      expect(result.netConsumption).to.equal(55);
    });

    it('să returneze 0 pentru item fără tranzacții', async () => {
      const result = await transactionModel.getItemConsumption('inexistent');
      expect(result.totalOut).to.equal(0);
      expect(result.totalLoss).to.equal(0);
      expect(result.netConsumption).to.equal(0);
    });

    it('să respingă itemId gol', async () => {
      try {
        await transactionModel.getItemConsumption('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_ITEM_ID');
      }
    });
  });
});