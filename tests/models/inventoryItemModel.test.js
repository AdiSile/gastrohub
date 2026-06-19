'use strict';

const chai = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs');

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
const inventoryModel = require('../../models/inventoryItemModel');
const { AppError } = require('../../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Helpers pentru curățare și seed
// ---------------------------------------------------------------------------
function clearCollection() {
  return new Promise((resolve, reject) => {
    inventoryModel.inventoryItems.remove({}, { multi: true }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function seedItems(items) {
  return new Promise((resolve, reject) => {
    inventoryModel.inventoryItems.insert(items, (err, inserted) => {
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
const restaurant1 = { locationId: 'loc-1', locationType: 'restaurant' };
const hotel1 = { locationId: 'loc-h1', locationType: 'hotel' };

const baseItem = {
  name: 'Ceapă',
  category: 'alimente',
  quantity: 50,
  unit: 'kg',
  minThreshold: 10,
  ...restaurant1,
  tenantId: tenantA,
};

// ---------------------------------------------------------------------------
// Test Suite – InventoryItemModel
// ---------------------------------------------------------------------------
describe('InventoryItemModel', () => {
  // Resetăm baza înainte de fiecare test
  beforeEach(async () => {
    await clearCollection();
  });

  // =========================================================================
  // CONFIGURAȚIE ȘI CONSTANTE
  // =========================================================================
  describe('Configurație și constante', () => {
    it('să exporte colecția inventoryItems', () => {
      expect(inventoryModel.inventoryItems).to.exist;
    });

    it('să exporte constantele VALID_CATEGORIES, VALID_UNITS, VALID_LOCATION_TYPES', () => {
      expect(inventoryModel.VALID_CATEGORIES).to.deep.equal([
        'alimente', 'băuturi', 'consumabile', 'alte',
      ]);
      expect(inventoryModel.VALID_UNITS).to.include('kg');
      expect(inventoryModel.VALID_LOCATION_TYPES).to.deep.equal(['restaurant', 'hotel']);
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE
  // =========================================================================
  describe('Funcții de validare', () => {
    describe('isValidName', () => {
      it('să returneze true pentru un nume valid', () => {
        expect(inventoryModel.isValidName('Ceapă verde')).to.be.true;
        expect(inventoryModel.isValidName('a')).to.be.true;
      });

      it('să returneze false pentru string gol sau prea lung', () => {
        expect(inventoryModel.isValidName('')).to.be.false;
        expect(inventoryModel.isValidName(' '.repeat(50))).to.be.false;
      });

      it('să returneze false pentru non-string', () => {
        expect(inventoryModel.isValidName(123)).to.be.false;
        expect(inventoryModel.isValidName(null)).to.be.false;
        expect(inventoryModel.isValidName(undefined)).to.be.false;
        expect(inventoryModel.isValidName({})).to.be.false;
      });
    });

    describe('isValidCategory', () => {
      it('să returneze true pentru categorii valide', () => {
        expect(inventoryModel.isValidCategory('alimente')).to.be.true;
        expect(inventoryModel.isValidCategory('băuturi')).to.be.true;
        expect(inventoryModel.isValidCategory('consumabile')).to.be.true;
        expect(inventoryModel.isValidCategory('alte')).to.be.true;
      });

      it('să returneze false pentru categorii invalide', () => {
        expect(inventoryModel.isValidCategory('legume')).to.be.false;
        expect(inventoryModel.isValidCategory('')).to.be.false;
      });
    });

    describe('isValidUnit', () => {
      it('să returneze true pentru unități valide', () => {
        expect(inventoryModel.isValidUnit('kg')).to.be.true;
        expect(inventoryModel.isValidUnit('l')).to.be.true;
        expect(inventoryModel.isValidUnit('buc')).to.be.true;
      });

      it('să returneze false pentru unități invalide', () => {
        expect(inventoryModel.isValidUnit('litru')).to.be.false;
        expect(inventoryModel.isValidUnit('')).to.be.false;
      });
    });

    describe('isValidLocationType', () => {
      it('să returneze true pentru tipuri valide', () => {
        expect(inventoryModel.isValidLocationType('restaurant')).to.be.true;
        expect(inventoryModel.isValidLocationType('hotel')).to.be.true;
      });

      it('să returneze false pentru tipuri invalide', () => {
        expect(inventoryModel.isValidLocationType('depozit')).to.be.false;
        expect(inventoryModel.isValidLocationType('')).to.be.false;
      });
    });

    describe('isValidQuantity', () => {
      it('să returneze true pentru numere >= 0', () => {
        expect(inventoryModel.isValidQuantity(0)).to.be.true;
        expect(inventoryModel.isValidQuantity(100.5)).to.be.true;
      });

      it('să returneze false pentru numere negative sau non-numeric', () => {
        expect(inventoryModel.isValidQuantity(-1)).to.be.false;
        expect(inventoryModel.isValidQuantity('10')).to.be.false;
        expect(inventoryModel.isValidQuantity(NaN)).to.be.false;
        expect(inventoryModel.isValidQuantity(null)).to.be.false;
        expect(inventoryModel.isValidQuantity(undefined)).to.be.false;
      });
    });

    describe('isValidThreshold', () => {
      it('să returneze true pentru numere >= 0', () => {
        expect(inventoryModel.isValidThreshold(0)).to.be.true;
        expect(inventoryModel.isValidThreshold(5)).to.be.true;
      });

      it('să returneze false pentru numere negative sau non-numeric', () => {
        expect(inventoryModel.isValidThreshold(-1)).to.be.false;
        expect(inventoryModel.isValidThreshold('5')).to.be.false;
        expect(inventoryModel.isValidThreshold(NaN)).to.be.false;
      });
    });
  });

  // =========================================================================
  // createInventoryItem
  // =========================================================================
  describe('createInventoryItem', () => {
    it('să creeze un item de inventar valid', async () => {
      const item = await inventoryModel.createInventoryItem(baseItem);
      expect(item).to.exist;
      expect(item._id).to.exist;
      expect(item.name).to.equal('Ceapă');
      expect(item.category).to.equal('alimente');
      expect(item.quantity).to.equal(50);
      expect(item.unit).to.equal('kg');
      expect(item.minThreshold).to.equal(10);
      expect(item.locationId).to.equal('loc-1');
      expect(item.locationType).to.equal('restaurant');
      expect(item.tenantId).to.equal(tenantA);
      expect(item.supplierId).to.be.null;
      expect(item.createdAt).to.exist;
      expect(item.updatedAt).to.exist;
      expect(item.lastUpdated).to.exist;
    });

    it('să seteze minThreshold default la 0 dacă nu este furnizat', async () => {
      const { minThreshold, ...rest } = baseItem;
      const item = await inventoryModel.createInventoryItem(rest);
      expect(item.minThreshold).to.equal(0);
    });

    it('să seteze supplierId la null dacă nu este furnizat', async () => {
      const item = await inventoryModel.createInventoryItem(baseItem);
      expect(item.supplierId).to.be.null;
    });

    it('să permită supplierId valid', async () => {
      const item = await inventoryModel.createInventoryItem({
        ...baseItem,
        supplierId: 'supplier-1',
      });
      expect(item.supplierId).to.equal('supplier-1');
    });

    it('să trimită numele', async () => {
      const item = await inventoryModel.createInventoryItem({
        ...baseItem,
        name: '  Ceapă verde  ',
      });
      expect(item.name).to.equal('Ceapă verde');
    });

    // Test pentru erori de validare
    const invalidCases = [
      { desc: 'date invalide (null)', data: null, code: 'INVALID_ITEM_DATA' },
      { desc: 'fără nume', data: { ...baseItem, name: undefined }, code: 'INVALID_NAME' },
      { desc: 'nume gol', data: { ...baseItem, name: '' }, code: 'INVALID_NAME' },
      { desc: 'categorie lipsă', data: { ...baseItem, category: undefined }, code: 'INVALID_CATEGORY' },
      { desc: 'categorie invalidă', data: { ...baseItem, category: 'nevalid' }, code: 'INVALID_CATEGORY' },
      { desc: 'cantitate lipsă', data: { ...baseItem, quantity: undefined }, code: 'INVALID_QUANTITY' },
      { desc: 'cantitate negativă', data: { ...baseItem, quantity: -1 }, code: 'INVALID_QUANTITY' },
      { desc: 'unitate lipsă', data: { ...baseItem, unit: undefined }, code: 'INVALID_UNIT' },
      { desc: 'unitate invalidă', data: { ...baseItem, unit: 'litru' }, code: 'INVALID_UNIT' },
      { desc: 'locationId lipsă', data: { ...baseItem, locationId: undefined }, code: 'INVALID_LOCATION_ID' },
      { desc: 'locationType lipsă', data: { ...baseItem, locationType: undefined }, code: 'INVALID_LOCATION_TYPE' },
      { desc: 'locationType invalid', data: { ...baseItem, locationType: 'depozit' }, code: 'INVALID_LOCATION_TYPE' },
      { desc: 'tenantId lipsă', data: { ...baseItem, tenantId: undefined }, code: 'INVALID_TENANT_ID' },
      { desc: 'minThreshold negativ', data: { ...baseItem, minThreshold: -5 }, code: 'INVALID_THRESHOLD' },
    ];

    for (const tc of invalidCases) {
      // eslint-disable-next-line no-loop-func
      it(`să respingă: ${tc.desc}`, async () => {
        try {
          await inventoryModel.createInventoryItem(tc.data);
          throw new Error('A trebuit să arunce o eroare');
        } catch (err) {
          expect(err).to.be.instanceOf(AppError);
          expect(err.code).to.equal(tc.code);
        }
      });
    }

    it('să respingă duplicatele (același nume, tenant, locație)', async () => {
      await inventoryModel.createInventoryItem(baseItem);
      try {
        await inventoryModel.createInventoryItem(baseItem);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.statusCode).to.equal(409);
        expect(err.code).to.equal('DUPLICATE_ITEM');
      }
    });

    it('să permită același nume la locații diferite', async () => {
      await inventoryModel.createInventoryItem(baseItem);
      const item2 = await inventoryModel.createInventoryItem({
        ...baseItem,
        locationId: 'loc-2',
      });
      expect(item2).to.exist;
    });

    it('să permită același nume la tenanți diferiți', async () => {
      await inventoryModel.createInventoryItem(baseItem);
      const item2 = await inventoryModel.createInventoryItem({
        ...baseItem,
        tenantId: tenantB,
      });
      expect(item2).to.exist;
    });
  });

  // =========================================================================
  // findInventoryItemById
  // =========================================================================
  describe('findInventoryItemById', () => {
    it('să găsească un item existent', async () => {
      const created = await inventoryModel.createInventoryItem(baseItem);
      const found = await inventoryModel.findInventoryItemById(created._id);
      expect(found).to.exist;
      expect(found._id).to.equal(created._id);
    });

    it('să returneze null pentru ID inexistent', async () => {
      const found = await inventoryModel.findInventoryItemById('nonexistent');
      expect(found).to.be.null;
    });

    it('să respingă ID gol', async () => {
      try {
        await inventoryModel.findInventoryItemById('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_ITEM_ID');
      }
    });

    it('să respingă ID null', async () => {
      try {
        await inventoryModel.findInventoryItemById(null);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
      }
    });
  });

  // =========================================================================
  // findInventoryItemsByTenant
  // =========================================================================
  describe('findInventoryItemsByTenant', () => {
    beforeEach(async () => {
      await seedItems([
        { ...baseItem, name: 'A', tenantId: tenantA },
        { ...baseItem, name: 'B', tenantId: tenantA, category: 'băuturi', locationId: 'loc-2' },
        { ...baseItem, name: 'C', tenantId: tenantB },
      ]);
    });

    it('să returneze toate itemele unui tenant', async () => {
      const items = await inventoryModel.findInventoryItemsByTenant(tenantA);
      expect(items).to.have.lengthOf(2);
    });

    it('să returneze lista goală pentru tenant fără iteme', async () => {
      const items = await inventoryModel.findInventoryItemsByTenant('inexistent');
      expect(items).to.deep.equal([]);
    });

    it('să filtreze după categorie', async () => {
      const items = await inventoryModel.findInventoryItemsByTenant(tenantA, { category: 'băuturi' });
      expect(items).to.have.lengthOf(1);
      expect(items[0].name).to.equal('B');
    });

    it('să filtreze după locationId', async () => {
      const items = await inventoryModel.findInventoryItemsByTenant(tenantA, { locationId: 'loc-2' });
      expect(items).to.have.lengthOf(1);
    });

    it('să filtreze după locationType', async () => {
      const items = await inventoryModel.findInventoryItemsByTenant(tenantA, { locationType: 'restaurant' });
      expect(items).to.have.lengthOf(2);
    });

    it('să sorteze descendent', async () => {
      const items = await inventoryModel.findInventoryItemsByTenant(tenantA, { sortBy: 'name', sortOrder: 'desc' });
      expect(items[0].name).to.equal('B');
    });

    it('să respingă tenantId gol', async () => {
      try {
        await inventoryModel.findInventoryItemsByTenant('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_TENANT_ID');
      }
    });
  });

  // =========================================================================
  // findInventoryItemsByLocation
  // =========================================================================
  describe('findInventoryItemsByLocation', () => {
    beforeEach(async () => {
      await seedItems([
        { ...baseItem, name: 'Item1' },
        { ...baseItem, name: 'Item2', locationId: 'loc-2' },
        { ...baseItem, name: 'Item3', ...hotel1 },
      ]);
    });

    it('să găsească iteme după locație', async () => {
      const items = await inventoryModel.findInventoryItemsByLocation('loc-1', 'restaurant');
      expect(items).to.have.lengthOf(1);
      expect(items[0].name).to.equal('Item1');
    });

    it('să returneze lista goală pentru locație fără iteme', async () => {
      const items = await inventoryModel.findInventoryItemsByLocation('inexistent', 'restaurant');
      expect(items).to.deep.equal([]);
    });

    it('să respingă locationId gol', async () => {
      try {
        await inventoryModel.findInventoryItemsByLocation('', 'restaurant');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
      }
    });

    it('să respingă locationType invalid', async () => {
      try {
        await inventoryModel.findInventoryItemsByLocation('loc-1', 'depozit');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_LOCATION_TYPE');
      }
    });
  });

  // =========================================================================
  // findLowStockItems
  // =========================================================================
  describe('findLowStockItems', () => {
    beforeEach(async () => {
      await seedItems([
        { ...baseItem, name: 'Suficient', quantity: 100, minThreshold: 10 },
        { ...baseItem, name: 'Scăzut', quantity: 3, minThreshold: 10 },
        { ...baseItem, name: 'La limită', quantity: 10, minThreshold: 10 },
        { ...baseItem, name: 'Alt tenant', tenantId: tenantB, quantity: 2, minThreshold: 10 },
      ]);
    });

    it('să găsească itemele sub prag', async () => {
      const low = await inventoryModel.findLowStockItems(tenantA);
      expect(low).to.have.lengthOf(1);
      expect(low[0].name).to.equal('Scăzut');
    });

    it('să returneze lista goală dacă niciun item nu e sub prag', async () => {
      await clearCollection();
      await seedItems([
        { ...baseItem, name: 'Ok', quantity: 50, minThreshold: 10 },
      ]);
      const low = await inventoryModel.findLowStockItems(tenantA);
      expect(low).to.deep.equal([]);
    });

    it('să respingă tenantId gol', async () => {
      try {
        await inventoryModel.findLowStockItems('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
      }
    });
  });

  // =========================================================================
  // updateQuantity
  // =========================================================================
  describe('updateQuantity', () => {
    let createdItem;

    beforeEach(async () => {
      createdItem = await inventoryModel.createInventoryItem(baseItem);
    });

    it('să actualizeze cantitatea la o valoare validă', async () => {
      const updated = await inventoryModel.updateQuantity(createdItem._id, 75);
      expect(updated.quantity).to.equal(75);
      expect(updated.lastUpdated).to.exist;
    });

    it('să actualizeze cantitatea la 0', async () => {
      const updated = await inventoryModel.updateQuantity(createdItem._id, 0);
      expect(updated.quantity).to.equal(0);
    });

    it('să respingă cantitate negativă', async () => {
      try {
        await inventoryModel.updateQuantity(createdItem._id, -5);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_QUANTITY');
      }
    });

    it('să respingă ID gol', async () => {
      try {
        await inventoryModel.updateQuantity('', 10);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
      }
    });

    it('să respingă item inexistent', async () => {
      try {
        await inventoryModel.updateQuantity('nonexistent', 10);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.statusCode).to.equal(404);
        expect(err.code).to.equal('ITEM_NOT_FOUND');
      }
    });
  });

  // =========================================================================
  // adjustQuantity
  // =========================================================================
  describe('adjustQuantity', () => {
    let createdItem;

    beforeEach(async () => {
      createdItem = await inventoryModel.createInventoryItem(baseItem);
    });

    it('să adauge o cantitate pozitivă', async () => {
      const updated = await inventoryModel.adjustQuantity(createdItem._id, 25);
      expect(updated.quantity).to.equal(75);
    });

    it('să scadă o cantitate (delta negativ)', async () => {
      const updated = await inventoryModel.adjustQuantity(createdItem._id, -20);
      expect(updated.quantity).to.equal(30);
    });

    it('să respingă rezultat negativ', async () => {
      try {
        await inventoryModel.adjustQuantity(createdItem._id, -100);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('NEGATIVE_QUANTITY');
      }
    });

    it('să respingă delta invalid (non-numeric)', async () => {
      try {
        await inventoryModel.adjustQuantity(createdItem._id, 'abc');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_DELTA');
      }
    });

    it('să respingă ID gol', async () => {
      try {
        await inventoryModel.adjustQuantity('', 10);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
      }
    });

    it('să respingă item inexistent', async () => {
      try {
        await inventoryModel.adjustQuantity('nonexistent', 10);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.statusCode).to.equal(404);
      }
    });
  });

  // =========================================================================
  // updateInventoryItem
  // =========================================================================
  describe('updateInventoryItem', () => {
    let createdItem;

    beforeEach(async () => {
      createdItem = await inventoryModel.createInventoryItem(baseItem);
    });

    it('să actualizeze câmpuri permise', async () => {
      const updated = await inventoryModel.updateInventoryItem(createdItem._id, {
        name: 'Ceapă roșie',
        unit: 'buc',
        minThreshold: 5,
      });
      expect(updated.name).to.equal('Ceapă roșie');
      expect(updated.unit).to.equal('buc');
      expect(updated.minThreshold).to.equal(5);
    });

    it('să nu actualizeze câmpuri nepermise (quantity)', async () => {
      const updated = await inventoryModel.updateInventoryItem(createdItem._id, {
        quantity: 999,
      });
      // quantity nu e în allowedFields, deci nu s-a schimbat
      expect(updated.quantity).to.equal(50);
    });

    it('să respingă dacă nu există câmpuri valide', async () => {
      try {
        await inventoryModel.updateInventoryItem(createdItem._id, {});
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('NO_VALID_FIELDS');
      }
    });

    it('să respingă nume invalid', async () => {
      try {
        await inventoryModel.updateInventoryItem(createdItem._id, { name: '' });
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_NAME');
      }
    });

    it('să respingă categorie invalidă', async () => {
      try {
        await inventoryModel.updateInventoryItem(createdItem._id, { category: 'nevalid' });
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_CATEGORY');
      }
    });

    it('să respingă item inexistent', async () => {
      try {
        await inventoryModel.updateInventoryItem('nonexistent', { name: 'Test' });
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.statusCode).to.equal(404);
      }
    });
  });

  // =========================================================================
  // deleteInventoryItem
  // =========================================================================
  describe('deleteInventoryItem', () => {
    let createdItem;

    beforeEach(async () => {
      createdItem = await inventoryModel.createInventoryItem(baseItem);
    });

    it('să șteargă un item existent', async () => {
      const result = await inventoryModel.deleteInventoryItem(createdItem._id);
      expect(result).to.be.true;

      const found = await inventoryModel.findInventoryItemById(createdItem._id);
      expect(found).to.be.null;
    });

    it('să respingă ștergerea unui item inexistent', async () => {
      try {
        await inventoryModel.deleteInventoryItem('nonexistent');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.statusCode).to.equal(404);
        expect(err.code).to.equal('ITEM_NOT_FOUND');
      }
    });

    it('să respingă ID gol', async () => {
      try {
        await inventoryModel.deleteInventoryItem('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.statusCode).to.equal(400);
      }
    });
  });

  // =========================================================================
  // countInventoryItems
  // =========================================================================
  describe('countInventoryItems', () => {
    beforeEach(async () => {
      await seedItems([
        { ...baseItem, name: 'A' },
        { ...baseItem, name: 'B', category: 'băuturi' },
        { ...baseItem, name: 'C', tenantId: tenantB },
      ]);
    });

    it('să numere itemele unui tenant', async () => {
      const count = await inventoryModel.countInventoryItems(tenantA);
      expect(count).to.equal(2);
    });

    it('să numere cu filtru de categorie', async () => {
      const count = await inventoryModel.countInventoryItems(tenantA, { category: 'băuturi' });
      expect(count).to.equal(1);
    });

    it('să returneze 0 pentru tenantId gol', async () => {
      const count = await inventoryModel.countInventoryItems('');
      expect(count).to.equal(0);
    });
  });

  // =========================================================================
  // findInventoryItemsBySupplier
  // =========================================================================
  describe('findInventoryItemsBySupplier', () => {
    beforeEach(async () => {
      await seedItems([
        { ...baseItem, name: 'A', supplierId: 'supplier-1' },
        { ...baseItem, name: 'B', supplierId: 'supplier-1' },
        { ...baseItem, name: 'C', supplierId: 'supplier-2' },
        { ...baseItem, name: 'D' },
      ]);
    });

    it('să găsească iteme după furnizor', async () => {
      const items = await inventoryModel.findInventoryItemsBySupplier('supplier-1');
      expect(items).to.have.lengthOf(2);
    });

    it('să returneze lista goală pentru furnizor fără iteme', async () => {
      const items = await inventoryModel.findInventoryItemsBySupplier('inexistent');
      expect(items).to.deep.equal([]);
    });

    it('să respingă supplierId gol', async () => {
      try {
        await inventoryModel.findInventoryItemsBySupplier('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
      }
    });
  });

  // =========================================================================
  // getInventorySummary
  // =========================================================================
  describe('getInventorySummary', () => {
    beforeEach(async () => {
      await seedItems([
        { ...baseItem, name: 'A', quantity: 10 },
        { ...baseItem, name: 'B', category: 'băuturi', quantity: 20 },
        { ...baseItem, name: 'C', category: 'alimente', quantity: 30 },
        { ...baseItem, name: 'D', tenantId: tenantB },
      ]);
    });

    it('să returneze sumarul pe categorii', async () => {
      const summary = await inventoryModel.getInventorySummary(tenantA);
      expect(summary).to.be.an('array');
      expect(summary).to.have.lengthOf(2);

      const alimente = summary.find((s) => s.category === 'alimente');
      const bauturi = summary.find((s) => s.category === 'băuturi');

      expect(alimente).to.exist;
      expect(alimente.count).to.equal(2);
      expect(alimente.totalQuantity).to.equal(40);

      expect(bauturi).to.exist;
      expect(bauturi.count).to.equal(1);
      expect(bauturi.totalQuantity).to.equal(20);
    });

    it('să returneze lista goală pentru tenant fără iteme', async () => {
      const summary = await inventoryModel.getInventorySummary('inexistent');
      expect(summary).to.deep.equal([]);
    });

    it('să respingă tenantId gol', async () => {
      try {
        await inventoryModel.getInventorySummary('');
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.code).to.equal('INVALID_TENANT_ID');
      }
    });
  });

  // =========================================================================
  // Teste suplimentare de acoperire (branch-uri)
  // =========================================================================
  describe('Branch-uri suplimentare pentru acoperire > 80%', () => {
    it('să gestioneze eroare DB la findOne în createInventoryItem', async () => {
      // Forțăm o eroare făcând stub pe findOne
      const stub = sinon.stub(inventoryModel.inventoryItems, 'findOne').yields(new Error('DB down'));

      try {
        await inventoryModel.createInventoryItem(baseItem);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.statusCode).to.equal(500);
        expect(err.message).to.include('Eroare la verificarea duplicatelor');
      } finally {
        stub.restore();
      }
    });

    it('să gestioneze eroare DB la insert în createInventoryItem', async () => {
      // Mai întâi facem să treacă de findOne, apoi să pice la insert
      const findStub = sinon.stub(inventoryModel.inventoryItems, 'findOne').yields(null, null);
      const insertStub = sinon.stub(inventoryModel.inventoryItems, 'insert').yields(new Error('Insert failed'));

      try {
        await inventoryModel.createInventoryItem(baseItem);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.statusCode).to.equal(500);
        expect(err.message).to.include('Eroare la crearea itemului');
      } finally {
        findStub.restore();
        insertStub.restore();
      }
    });

    it('să gestioneze eroare DB la find în findLowStockItems', async () => {
      const stub = sinon.stub(inventoryModel.inventoryItems, 'find').yields(new Error('Query failed'));

      try {
        await inventoryModel.findLowStockItems(tenantA);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.statusCode).to.equal(500);
      } finally {
        stub.restore();
      }
    });

    it('să gestioneze eroare DB la update în updateQuantity', async () => {
      const stub = sinon.stub(inventoryModel.inventoryItems, 'update').yields(new Error('Update failed'));

      try {
        // Mai întâi creăm itemul
        const item = await inventoryModel.createInventoryItem(baseItem);
        // Acum testăm update
        await inventoryModel.updateQuantity(item._id, 10);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.statusCode).to.equal(500);
      } finally {
        stub.restore();
      }
    });

    it('să gestioneze eroare DB la remove în deleteInventoryItem', async () => {
      const stub = sinon.stub(inventoryModel.inventoryItems, 'remove').yields(new Error('Remove failed'));

      try {
        const item = await inventoryModel.createInventoryItem(baseItem);
        await inventoryModel.deleteInventoryItem(item._id);
        throw new Error('A trebuit să arunce o eroare');
      } catch (err) {
        expect(err).to.be.instanceOf(AppError);
        expect(err.statusCode).to.equal(500);
      } finally {
        stub.restore();
      }
    });

    it('să gestioneze eroare DB la count', async () => {
      const stub = sinon.stub(inventoryModel.inventoryItems, 'count').yields(new Error('Count failed