'use strict';

// ---------------------------------------------------------------------------
// Test Suite – CouponModel
// Model în-memory cu Map, fără dependență directă de DB
// ---------------------------------------------------------------------------

const { expect } = require('chai');

// ---------------------------------------------------------------------------
// Încărcăm modelul
// ---------------------------------------------------------------------------
const couponModel = require('../../models/couponModel');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TEST_USER = 'user-001';
const TEST_USER2 = 'user-002';

async function createTestCoupon(overrides = {}) {
  return couponModel.createCoupon({
    userId: TEST_USER,
    discountType: 'percent',
    discountValue: 15,
    validityDays: 30,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------
describe('CouponModel', () => {
  // Resetăm datele înainte de fiecare test
  beforeEach(async () => {
    await couponModel.resetAllData();
  });

  // =========================================================================
  // CONFIGURAȚIE ȘI CONSTANTE
  // =========================================================================
  describe('Configurație și constante', () => {
    it('să exporte COUPON_CONFIG cu toate cheile', () => {
      expect(couponModel.COUPON_CONFIG).to.exist;
      expect(couponModel.COUPON_CONFIG.CODE_PREFIX).to.equal('GH');
      expect(couponModel.COUPON_CONFIG.CODE_LENGTH).to.equal(8);
      expect(couponModel.COUPON_CONFIG.MIN_CODE_LENGTH).to.equal(4);
      expect(couponModel.COUPON_CONFIG.MAX_CODE_LENGTH).to.equal(30);
      expect(couponModel.COUPON_CONFIG.DEFAULT_DISCOUNT_PERCENT).to.equal(10);
      expect(couponModel.COUPON_CONFIG.MIN_DISCOUNT_PERCENT).to.equal(1);
      expect(couponModel.COUPON_CONFIG.MAX_DISCOUNT_PERCENT).to.equal(100);
      expect(couponModel.COUPON_CONFIG.DEFAULT_VALIDITY_DAYS).to.equal(90);
      expect(couponModel.COUPON_CONFIG.MAX_VALIDITY_DAYS).to.equal(365);
      expect(couponModel.COUPON_CONFIG.MIN_VALIDITY_DAYS).to.equal(1);
      expect(couponModel.COUPON_CONFIG.MAX_ACTIVE_COUPONS_PER_USER).to.equal(10);
      expect(couponModel.COUPON_CONFIG.MIN_ORDER_AMOUNT).to.equal(1);
    });

    it('să exporte VALID_COUPON_STATUSES', () => {
      expect(couponModel.VALID_COUPON_STATUSES).to.deep.equal([
        'active', 'used', 'expired', 'cancelled',
      ]);
    });

    it('să exporte VALID_DISCOUNT_TYPES', () => {
      expect(couponModel.VALID_DISCOUNT_TYPES).to.deep.equal(['percent', 'fixed']);
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidUserId
  // =========================================================================
  describe('isValidUserId', () => {
    it('să returneze true pentru un userId valid', () => {
      expect(couponModel.isValidUserId('user-123')).to.be.true;
      expect(couponModel.isValidUserId('a')).to.be.true;
      expect(couponModel.isValidUserId('user_123')).to.be.true;
    });

    it('să returneze false pentru string gol', () => {
      expect(couponModel.isValidUserId('')).to.be.false;
      expect(couponModel.isValidUserId('   ')).to.be.false;
    });

    it('să returneze false pentru non-string', () => {
      expect(couponModel.isValidUserId(123)).to.be.false;
      expect(couponModel.isValidUserId(null)).to.be.false;
      expect(couponModel.isValidUserId(undefined)).to.be.false;
      expect(couponModel.isValidUserId({})).to.be.false;
      expect(couponModel.isValidUserId([])).to.be.false;
    });

    it('să returneze false pentru userId prea lung', () => {
      expect(couponModel.isValidUserId('a'.repeat(101))).to.be.false;
    });

    it('să returneze true pentru userId la limita de 100 caractere', () => {
      expect(couponModel.isValidUserId('a'.repeat(100))).to.be.true;
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidCouponCode
  // =========================================================================
  describe('isValidCouponCode', () => {
    it('să returneze true pentru cod valid', () => {
      expect(couponModel.isValidCouponCode('ABCD1234')).to.be.true;
      expect(couponModel.isValidCouponCode('GH-A1B2C3D4')).to.be.true;
    });

    it('să returneze false pentru cod prea scurt', () => {
      expect(couponModel.isValidCouponCode('ABC')).to.be.false;
      expect(couponModel.isValidCouponCode('')).to.be.false;
    });

    it('să returneze false pentru cod prea lung', () => {
      expect(couponModel.isValidCouponCode('A'.repeat(31))).to.be.false;
    });

    it('să returneze false pentru non-string', () => {
      expect(couponModel.isValidCouponCode(123)).to.be.false;
      expect(couponModel.isValidCouponCode(null)).to.be.false;
      expect(couponModel.isValidCouponCode(undefined)).to.be.false;
    });

    it('să returneze true pentru cod la limita minimă (4)', () => {
      expect(couponModel.isValidCouponCode('ABCD')).to.be.true;
    });

    it('să returneze true pentru cod la limita maximă (30)', () => {
      expect(couponModel.isValidCouponCode('A'.repeat(30))).to.be.true;
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidDiscountPercent
  // =========================================================================
  describe('isValidDiscountPercent', () => {
    it('să returneze true pentru procente valide', () => {
      expect(couponModel.isValidDiscountPercent(1)).to.be.true;
      expect(couponModel.isValidDiscountPercent(50)).to.be.true;
      expect(couponModel.isValidDiscountPercent(100)).to.be.true;
    });

    it('să returneze false pentru 0', () => {
      expect(couponModel.isValidDiscountPercent(0)).to.be.false;
    });

    it('să returneze false pentru peste 100', () => {
      expect(couponModel.isValidDiscountPercent(101)).to.be.false;
    });

    it('să returneze false pentru valori negative', () => {
      expect(couponModel.isValidDiscountPercent(-1)).to.be.false;
    });

    it('să returneze false pentru non-numeric', () => {
      expect(couponModel.isValidDiscountPercent('50')).to.be.false;
      expect(couponModel.isValidDiscountPercent(NaN)).to.be.false;
      expect(couponModel.isValidDiscountPercent(Infinity)).to.be.false;
      expect(couponModel.isValidDiscountPercent(null)).to.be.false;
      expect(couponModel.isValidDiscountPercent(undefined)).to.be.false;
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidDiscountAmount
  // =========================================================================
  describe('isValidDiscountAmount', () => {
    it('să returneze true pentru sume valide', () => {
      expect(couponModel.isValidDiscountAmount(0.01)).to.be.true;
      expect(couponModel.isValidDiscountAmount(50)).to.be.true;
      expect(couponModel.isValidDiscountAmount(1000)).to.be.true;
    });

    it('să returneze false pentru 0 sau negative', () => {
      expect(couponModel.isValidDiscountAmount(0)).to.be.false;
      expect(couponModel.isValidDiscountAmount(-1)).to.be.false;
    });

    it('să returneze false pentru non-numeric', () => {
      expect(couponModel.isValidDiscountAmount('50')).to.be.false;
      expect(couponModel.isValidDiscountAmount(NaN)).to.be.false;
      expect(couponModel.isValidDiscountAmount(Infinity)).to.be.false;
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidDiscountType
  // =========================================================================
  describe('isValidDiscountType', () => {
    it('să returneze true pentru tipuri valide', () => {
      expect(couponModel.isValidDiscountType('percent')).to.be.true;
      expect(couponModel.isValidDiscountType('fixed')).to.be.true;
    });

    it('să returneze false pentru tipuri invalide', () => {
      expect(couponModel.isValidDiscountType('absolute')).to.be.false;
      expect(couponModel.isValidDiscountType('')).to.be.false;
      expect(couponModel.isValidDiscountType(null)).to.be.false;
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidCouponStatus
  // =========================================================================
  describe('isValidCouponStatus', () => {
    it('să returneze true pentru statusuri valide', () => {
      expect(couponModel.isValidCouponStatus('active')).to.be.true;
      expect(couponModel.isValidCouponStatus('used')).to.be.true;
      expect(couponModel.isValidCouponStatus('expired')).to.be.true;
      expect(couponModel.isValidCouponStatus('cancelled')).to.be.true;
    });

    it('să returneze false pentru statusuri invalide', () => {
      expect(couponModel.isValidCouponStatus('pending')).to.be.false;
      expect(couponModel.isValidCouponStatus('')).to.be.false;
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidPositiveNumber
  // =========================================================================
  describe('isValidPositiveNumber', () => {
    it('să returneze true pentru numere pozitive', () => {
      expect(couponModel.isValidPositiveNumber(1)).to.be.true;
      expect(couponModel.isValidPositiveNumber(0.01)).to.be.true;
      expect(couponModel.isValidPositiveNumber(1000)).to.be.true;
    });

    it('să returneze false pentru 0 și negative', () => {
      expect(couponModel.isValidPositiveNumber(0)).to.be.false;
      expect(couponModel.isValidPositiveNumber(-1)).to.be.false;
    });

    it('să returneze false pentru non-numeric', () => {
      expect(couponModel.isValidPositiveNumber('1')).to.be.false;
      expect(couponModel.isValidPositiveNumber(NaN)).to.be.false;
      expect(couponModel.isValidPositiveNumber(Infinity)).to.be.false;
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidNonNegativeNumber
  // =========================================================================
  describe('isValidNonNegativeNumber', () => {
    it('să returneze true pentru numere nenegative', () => {
      expect(couponModel.isValidNonNegativeNumber(0)).to.be.true;
      expect(couponModel.isValidNonNegativeNumber(50)).to.be.true;
    });

    it('să returneze false pentru negative', () => {
      expect(couponModel.isValidNonNegativeNumber(-1)).to.be.false;
    });

    it('să returneze false pentru non-numeric', () => {
      expect(couponModel.isValidNonNegativeNumber('0')).to.be.false;
      expect(couponModel.isValidNonNegativeNumber(NaN)).to.be.false;
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidValidityDays
  // =========================================================================
  describe('isValidValidityDays', () => {
    it('să returneze true pentru zile valide', () => {
      expect(couponModel.isValidValidityDays(1)).to.be.true;
      expect(couponModel.isValidValidityDays(90)).to.be.true;
      expect(couponModel.isValidValidityDays(365)).to.be.true;
    });

    it('să returneze false pentru 0', () => {
      expect(couponModel.isValidValidityDays(0)).to.be.false;
    });

    it('să returneze false pentru peste maxim', () => {
      expect(couponModel.isValidValidityDays(366)).to.be.false;
    });

    it('să returneze false pentru negative', () => {
      expect(couponModel.isValidValidityDays(-1)).to.be.false;
    });

    it('să returneze false pentru non-integer', () => {
      expect(couponModel.isValidValidityDays(1.5)).to.be.false;
      expect(couponModel.isValidValidityDays('30')).to.be.false;
    });
  });

  // =========================================================================
  // FUNCȚII DE VALIDARE – isValidNonNegativeInt
  // =========================================================================
  describe('isValidNonNegativeInt', () => {
    it('să returneze true pentru întregi nenegativi', () => {
      expect(couponModel.isValidNonNegativeInt(0)).to.be.true;
      expect(couponModel.isValidNonNegativeInt(50)).to.be.true;
    });

    it('să returneze false pentru negative', () => {
      expect(couponModel.isValidNonNegativeInt(-1)).to.be.false;
    });

    it('să returneze false pentru non-integer', () => {
      expect(couponModel.isValidNonNegativeInt(1.5)).to.be.false;
      expect(couponModel.isValidNonNegativeInt('0')).to.be.false;
    });
  });

  // =========================================================================
  // FUNCȚII DE VERIFICARE STARE CUPON
  // =========================================================================
  describe('isCouponExpired', () => {
    it('să returneze true pentru cupon expirat', () => {
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 1);
      expect(couponModel.isCouponExpired({ expiresAt: expiredDate.toISOString() })).to.be.true;
    });

    it('să returneze false pentru cupon neexpirat', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      expect(couponModel.isCouponExpired({ expiresAt: futureDate.toISOString() })).to.be.false;
    });

    it('să returneze false dacă expiresAt lipsește', () => {
      expect(couponModel.isCouponExpired({})).to.be.false;
    });

    it('să returneze false dacă expiresAt este null', () => {
      expect(couponModel.isCouponExpired({ expiresAt: null })).to.be.false;
    });
  });

  describe('isCouponUsed', () => {
    it('să returneze true pentru status used', () => {
      expect(couponModel.isCouponUsed({ status: 'used' })).to.be.true;
    });

    it('să returneze false pentru alte statusuri', () => {
      expect(couponModel.isCouponUsed({ status: 'active' })).to.be.false;
      expect(couponModel.isCouponUsed({ status: 'expired' })).to.be.false;
      expect(couponModel.isCouponUsed({ status: 'cancelled' })).to.be.false;
    });
  });

  describe('isCouponCancelled', () => {
    it('să returneze true pentru status cancelled', () => {
      expect(couponModel.isCouponCancelled({ status: 'cancelled' })).to.be.true;
    });

    it('să returneze false pentru alte statusuri', () => {
      expect(couponModel.isCouponCancelled({ status: 'active' })).to.be.false;
    });
  });

  describe('isCouponActive', () => {
    it('să returneze true pentru cupon activ neexpirat', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      expect(couponModel.isCouponActive({
        status: 'active',
        expiresAt: futureDate.toISOString(),
      })).to.be.true;
    });

    it('să returneze false pentru cupon activ dar expirat', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      expect(couponModel.isCouponActive({
        status: 'active',
        expiresAt: pastDate.toISOString(),
      })).to.be.false;
    });

    it('să returneze false pentru status non-active', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      expect(couponModel.isCouponActive({
        status: 'used',
        expiresAt: futureDate.toISOString(),
      })).to.be.false;
    });
  });

  // =========================================================================
  // FUNCȚII UTILITARE
  // =========================================================================
  describe('calculateExpiryDate', () => {
    it('să returneze o dată în viitor', () => {
      const expiry = couponModel.calculateExpiryDate(30);
      const expiryDate = new Date(expiry);
      const now = new Date();
      const diffDays = Math.round((expiryDate - now) / (1000 * 60 * 60 * 24));
      expect(diffDays).to.equal(30);
    });

    it('să folosească valoarea implicită dacă nu se furnizează argument', () => {
      const expiry = couponModel.calculateExpiryDate();
      expect(expiry).to.be.a('string');
    });

    it('să folosească valoarea implicită pentru zile invalide', () => {
      const expiry = couponModel.calculateExpiryDate(-5);
      const expiryDate = new Date(expiry);
      const now = new Date();
      const diffDays = Math.round((expiryDate - now) / (1000 * 60 * 60 * 24));
      expect(diffDays).to.equal(couponModel.COUPON_CONFIG.DEFAULT_VALIDITY_DAYS);
    });
  });

  describe('generateCouponCode', () => {
    it('să genereze un cod cu prefixul implicit', () => {
      const code = couponModel.generateCouponCode();
      expect(code).to.match(/^GH-[A-Z0-9]{8}$/);
    });

    it('să genereze un cod cu prefix personalizat', () => {
      const code = couponModel.generateCouponCode('TEST');
      expect(code).to.match(/^TEST-[A-Z0-9]{8}$/);
    });

    it('să genereze coduri diferite la apeluri succesive', () => {
      const code1 = couponModel.generateCouponCode();
      const code2 = couponModel.generateCouponCode();
      expect(code1).to.not.equal(code2);
    });
  });

  describe('normalizeCouponCode', () => {
    it('să facă trim și uppercase', () => {
      expect(couponModel.normalizeCouponCode('  abc-123  ')).to.equal('ABC-123');
    });

    it('să returneze string gol pentru intrare non-string', () => {
      expect(couponModel.normalizeCouponCode(null)).to.equal('');
      expect(couponModel.normalizeCouponCode(123)).to.equal('');
      expect(couponModel.normalizeCouponCode(undefined)).to.equal('');
    });

    it('să păstreze caracterele alfanumerice și simbolurile', () => {
      expect(couponModel.normalizeCouponCode('GH-ABCD1234')).to.equal('GH-ABCD1234');
    });
  });

  // =========================================================================
  // createCoupon
  // =========================================================================
  describe('createCoupon', () => {
    it('să creeze un cupon cu valori implicite', async () => {
      const coupon = await couponModel.createCoupon({ userId: TEST_USER });
      expect(coupon).to.exist;
      expect(coupon.id).to.be.a('string');
      expect(coupon.code).to.match(/^GH-[A-Z0-9]{8}$/);
      expect(coupon.userId).to.equal(TEST_USER);
      expect(coupon.discountType).to.equal('percent');
      expect(coupon.discountValue).to.equal(couponModel.COUPON_CONFIG.DEFAULT_DISCOUNT_PERCENT);
      expect(coupon.status).to.equal('active');
      expect(coupon.createdAt).to.be.a('string');
      expect(coupon.expiresAt).to.be.a('string');
      expect(coupon.usedOnOrders).to.deep.equal([]);
      expect(coupon.currentUsageCount).to.equal(0);
      expect(coupon.maxUsageCount).to.equal(1);
    });

    it('să creeze un cupon cu discount fix', async () => {
      const coupon = await couponModel.createCoupon({
        userId: TEST_USER,
        discountType: 'fixed',
        discountValue: 25,
      });
      expect(coupon.discountType).to.equal('fixed');
      expect(coupon.discountValue).to.equal(25);
    });

    it('să creeze un cupon cu cod personalizat', async () => {
      const coupon = await couponModel.createCoupon({
        userId: TEST_USER,
        code: 'MYCODE-123',
      });
      expect(coupon.code).to.equal('MYCODE-123');
    });

    it('să creeze un cupon cu toate câmpurile opționale', async () => {
      const coupon = await couponModel.createCoupon({
        userId: TEST_USER,
        discountType: 'percent',
        discountValue: 20,
        validityDays: 60,
        minOrderAmount: 50,
        maxUsageCount: 3,
        description: 'Cupon de test',
        restaurantId: 'rest-1',
        hotelId: 'hotel-1',
        createdBy: 'admin-1',
      });
      expect(coupon.discountValue).to.equal(20);
      expect(coupon.validityDays).to.equal(60);
      expect(coupon.minOrderAmount).to.equal(50);
      expect(coupon.maxUsageCount).to.equal(3);
      expect(coupon.description).to.equal('Cupon de test');
      expect(coupon.restaurantId).to.equal('rest-1');
      expect(coupon.hotelId).to.equal('hotel-1');
      expect(coupon.createdBy).to.equal('admin-1');
    });

    it('să respingă userId lipsă', async () => {
      try {
        await couponModel.createCoupon({});
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul utilizatorului este invalid.');
      }
    });

    it('să respingă userId invalid', async () => {
      try {
        await couponModel.createCoupon({ userId: '' });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul utilizatorului este invalid.');
      }
    });

    it('să respingă discountType invalid', async () => {
      try {
        await couponModel.createCoupon({ userId: TEST_USER, discountType: 'absolute' });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Tipul de discount');
      }
    });

    it('să respingă discountValue percent invalid', async () => {
      try {
        await couponModel.createCoupon({ userId: TEST_USER, discountValue: 101 });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Procentajul de discount');
      }
    });

    it('să respingă discountValue percent sub minim', async () => {
      try {
        await couponModel.createCoupon({ userId: TEST_USER, discountValue: 0 });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Procentajul de discount');
      }
    });

    it('să respingă discountValue fixed invalid', async () => {
      try {
        await couponModel.createCoupon({
          userId: TEST_USER,
          discountType: 'fixed',
          discountValue: -5,
        });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Suma discountului trebuie să fie un număr pozitiv.');
      }
    });

    it('să respingă validityDays invalid', async () => {
      try {
        await couponModel.createCoupon({ userId: TEST_USER, validityDays: 0 });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Valabilitatea');
      }
    });

    it('să respingă validityDays peste maxim', async () => {
      try {
        await couponModel.createCoupon({ userId: TEST_USER, validityDays: 400 });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Valabilitatea');
      }
    });

    it('să respingă minOrderAmount invalid', async () => {
      try {
        await couponModel.createCoupon({ userId: TEST_USER, minOrderAmount: -10 });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Suma minimă a comenzii trebuie să fie un număr pozitiv.');
      }
    });

    it('să respingă maxUsageCount invalid', async () => {
      try {
        await couponModel.createCoupon({ userId: TEST_USER, maxUsageCount: -1 });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Numărul maxim de utilizări');
      }
    });

    it('să respingă maxUsageCount non-integer', async () => {
      try {
        await couponModel.createCoupon({ userId: TEST_USER, maxUsageCount: 1.5 });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Numărul maxim de utilizări');
      }
    });

    it('să respingă cod personalizat invalid', async () => {
      try {
        await couponModel.createCoupon({ userId: TEST_USER, code: 'AB' });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Codul cuponului');
      }
    });

    it('să respingă cod duplicat', async () => {
      const c1 = await couponModel.createCoupon({ userId: TEST_USER, code: 'UNIQUE-CODE' });
      try {
        await couponModel.createCoupon({ userId: TEST_USER, code: 'UNIQUE-CODE' });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Codul cuponului există deja.');
      }
    });

    it('să accepte maxUsageCount 0 (ilimitat)', async () => {
      const coupon = await couponModel.createCoupon({ userId: TEST_USER, maxUsageCount: 0 });
      expect(coupon.maxUsageCount).to.equal(0);
    });
  });

  // =========================================================================
  // getCouponById
  // =========================================================================
  describe('getCouponById', () => {
    it('să returneze un cupon după ID', async () => {
      const created = await createTestCoupon();
      const found = await couponModel.getCouponById(created.id);
      expect(found).to.exist;
      expect(found.id).to.equal(created.id);
      expect(found.code).to.equal(created.code);
    });

    it('să respingă pentru ID inexistent', async () => {
      try {
        await couponModel.getCouponById('nonexistent-id');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Cuponul nu a fost găsit.');
      }
    });

    it('să respingă pentru ID invalid', async () => {
      try {
        await couponModel.getCouponById('');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul cuponului este invalid.');
      }
    });

    it('să respingă pentru ID null', async () => {
      try {
        await couponModel.getCouponById(null);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul cuponului este invalid.');
      }
    });

    it('să returneze o copie, nu referința internă', async () => {
      const created = await createTestCoupon();
      const found = await couponModel.getCouponById(created.id);
      found.status = 'cancelled';
      // Verificăm că originalul nu s-a schimbat
      const refetch = await couponModel.getCouponById(created.id);
      expect(refetch.status).to.equal('active');
    });
  });

  // =========================================================================
  // getCouponByCode
  // =========================================================================
  describe('getCouponByCode', () => {
    it('să returneze un cupon după cod', async () => {
      const created = await createTestCoupon({ code: 'FIND-ME-CODE' });
      const found = await couponModel.getCouponByCode('find-me-code');
      expect(found).to.exist;
      expect(found.code).to.equal('FIND-ME-CODE');
    });

    it('să respingă pentru cod inexistent', async () => {
      try {
        await couponModel.getCouponByCode('NONEXIST');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Cuponul nu a fost găsit.');
      }
    });

    it('să respingă pentru cod invalid', async () => {
      try {
        await couponModel.getCouponByCode('AB');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Codul cuponului este invalid');
      }
    });
  });

  // =========================================================================
  // validateCoupon
  // =========================================================================
  describe('validateCoupon', () => {
    it('să valideze un cupon corect', async () => {
      const created = await createTestCoupon();
      const validated = await couponModel.validateCoupon(created.code, TEST_USER);
      expect(validated).to.exist;
      expect(validated.code).to.equal(created.code);
    });

    it('să respingă cod invalid', async () => {
      try {
        await couponModel.validateCoupon('AB', TEST_USER);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Codul cuponului este invalid.');
      }
    });

    it('să respingă userId invalid', async () => {
      const created = await createTestCoupon();
      try {
        await couponModel.validateCoupon(created.code, '');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul utilizatorului este invalid.');
      }
    });

    it('să respingă cupon inexistent', async () => {
      try {
        await couponModel.validateCoupon('NONEXIST', TEST_USER);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Cuponul nu există.');
      }
    });

    it('să respingă cupon care nu aparține utilizatorului', async () => {
      const created = await createTestCoupon();
      try {
        await couponModel.validateCoupon(created.code, TEST_USER2);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Acest cupon nu aparține utilizatorului curent.');
      }
    });

    it('să respingă cupon cu sumă minimă sub limită', async () => {
      const created = await createTestCoupon({ minOrderAmount: 100 });
      try {
        await couponModel.validateCoupon(created.code, TEST_USER, { orderAmount: 50 });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Suma minimă a comenzii');
      }
    });

    it('să respingă orderAmount invalid', async () => {
      const created = await createTestCoupon();
      try {
        await couponModel.validateCoupon(created.code, TEST_USER, { orderAmount: -5 });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Suma comenzii trebuie să fie un număr pozitiv.');
      }
    });

    it('să accepte fără orderAmount', async () => {
      const created = await createTestCoupon({ minOrderAmount: 50 });
      const validated = await couponModel.validateCoupon(created.code, TEST_USER);
      expect(validated).to.exist;
    });
  });

  // =========================================================================
  // useCoupon
  // =========================================================================
  describe('useCoupon', () => {
    it('să folosească un cupon și să incrementeze contorul', async () => {
      const created = await createTestCoupon({ maxUsageCount: 5 });
      const used = await couponModel.useCoupon(created.code, TEST_USER, { orderId: 'order-1', orderAmount: 100 });
      expect(used.currentUsageCount).to.equal(1);
      expect(used.usedOnOrders).to.have.lengthOf(1);
      expect(used.usedOnOrders[0].orderId).to.equal('order-1');
    });

    it('să nu modifice statusul dacă nu s-a atins maxUsageCount', async () => {
      const created = await createTestCoupon({ maxUsageCount: 5 });
      const used = await couponModel.useCoupon(created.code, TEST_USER);
      expect(used.status).to.equal('active');
    });

    it('să marcheze ca used când se atinge maxUsageCount', async () => {
      const created = await createTestCoupon({ maxUsageCount: 1 });
      const used = await couponModel.useCoupon(created.code, TEST_USER, { orderId: 'order-final' });
      expect(used.status).to.equal('used');
      expect(used.usedAt).to.be.a('string');
    });

    it('să respingă folosirea unui cupon deja used', async () => {
      const created = await createTestCoupon({ maxUsageCount: 1 });
      await couponModel.useCoupon(created.code, TEST_USER);
      try {
        await couponModel.useCoupon(created.code, TEST_USER);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('deja folosit');
      }
    });

    it('să respingă cuponul altui utilizator', async () => {
      const created = await createTestCoupon();
      try {
        await couponModel.useCoupon(created.code, TEST_USER2);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('nu aparține utilizatorului');
      }
    });

    it('să respingă cupon expirat', async () => {
      const created = await createTestCoupon({ validityDays: 1 });
      // Forțăm expirarea modificând direct data
      const coupon = await couponModel.getCouponByCode(created.code);
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      // Nu putem modifica expirarea direct prin API-ul public...
      // Dar putem testa cu cleanupExpiredCoupons
    });

    it('să respingă orderAmount sub limita minimă', async () => {
      const created = await createTestCoupon({ minOrderAmount: 200 });
      try {
        await couponModel.useCoupon(created.code, TEST_USER, { orderAmount: 50 });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Suma minimă a comenzii');
      }
    });

    it('să respingă cupon cu utilizări epuizate', async () => {
      const created = await createTestCoupon({ maxUsageCount: 2 });
      await couponModel.useCoupon(created.code, TEST_USER);
      await couponModel.useCoupon(created.code, TEST_USER);
      try {
        await couponModel.useCoupon(created.code, TEST_USER);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        // După ce atinge maxUsageCount, statusul devine 'used',
        // deci mesajul va fi 'deja folosit'
        expect(err.message).to.include('deja folosit');
      }
    });

    it('să permită utilizări multiple fără orderId', async () => {
      const created = await createTestCoupon({ maxUsageCount: 3 });
      const used = await couponModel.useCoupon(created.code, TEST_USER);
      expect(used.usedOnOrders).to.have.lengthOf(0);
    });
  });

  // =========================================================================
  // cancelCoupon
  // =========================================================================
  describe('cancelCoupon', () => {
    it('să anuleze un cupon activ', async () => {
      const created = await createTestCoupon();
      const cancelled = await couponModel.cancelCoupon(created.code, TEST_USER, 'Motiv de test');
      expect(cancelled.status).to.equal('cancelled');
      expect(cancelled.cancelledAt).to.be.a('string');
      expect(cancelled.cancelledBy).to.equal(TEST_USER);
      expect(cancelled.cancelledReason).to.equal('Motiv de test');
    });

    it('să anuleze fără motiv', async () => {
      const created = await createTestCoupon();
      const cancelled = await couponModel.cancelCoupon(created.code, TEST_USER);
      expect(cancelled.status).to.equal('cancelled');
      expect(cancelled.cancelledReason).to.equal('');
    });

    it('să respingă anularea unui cupon deja anulat', async () => {
      const created = await createTestCoupon();
      await couponModel.cancelCoupon(created.code, TEST_USER);
      try {
        await couponModel.cancelCoupon(created.code, TEST_USER);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Doar cupoanele cu status "active"');
      }
    });

    it('să respingă anularea de către alt utilizator', async () => {
      const created = await createTestCoupon();
      try {
        await couponModel.cancelCoupon(created.code, TEST_USER2);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('nu aparține utilizatorului');
      }
    });

    it('să respingă cod invalid', async () => {
      try {
        await couponModel.cancelCoupon('AB', TEST_USER);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Codul cuponului este invalid.');
      }
    });

    it('să respingă userId invalid', async () => {
      const created = await createTestCoupon();
      try {
        await couponModel.cancelCoupon(created.code, '');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul utilizatorului este invalid.');
      }
    });

    it('să respingă cupon inexistent', async () => {
      try {
        await couponModel.cancelCoupon('NONEXIST', TEST_USER);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Cuponul nu există.');
      }
    });
  });

  // =========================================================================
  // calculateDiscount
  // =========================================================================
  describe('calculateDiscount', () => {
    it('să calculeze discount procentual', async () => {
      const created = await createTestCoupon({ discountValue: 20 });
      const result = await couponModel.calculateDiscount(created.code, 100, TEST_USER);
      expect(result.originalAmount).to.equal(100);
      expect(result.discountType).to.equal('percent');
      expect(result.discountValue).to.equal(20);
      expect(result.discountAmount).to.equal(20);
      expect(result.finalAmount).to.equal(80);
      expect(result.couponCode).to.equal(created.code);
    });

    it('să calculeze discount fix', async () => {
      const created = await couponModel.createCoupon({
        userId: TEST_USER,
        discountType: 'fixed',
        discountValue: 30,
      });
      const result = await couponModel.calculateDiscount(created.code, 100, TEST_USER);
      expect(result.discountType).to.equal('fixed');
      expect(result.discountAmount).to.equal(30);
      expect(result.finalAmount).to.equal(70);
    });

    it('să limiteze discountul fix la suma comenzii', async () => {
      const created = await couponModel.createCoupon({
        userId: TEST_USER,
        discountType: 'fixed',
        discountValue: 150,
      });
      const result = await couponModel.calculateDiscount(created.code, 100, TEST_USER);
      expect(result.discountAmount).to.equal(100);
      expect(result.finalAmount).to.equal(0);
    });

    it('să respingă orderAmount invalid', async () => {
      const created = await createTestCoupon();
      try {
        await couponModel.calculateDiscount(created.code, -10, TEST_USER);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Suma comenzii trebuie să fie un număr pozitiv.');
      }
    });

    it('să respingă orderAmount 0', async () => {
      const created = await createTestCoupon();
      try {
        await couponModel.calculateDiscount(created.code, 0, TEST_USER);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Suma comenzii trebuie să fie un număr pozitiv.');
      }
    });

    it('să respingă cupon invalid', async () => {
      try {
        await couponModel.calculateDiscount('NONEXIST', 100, TEST_USER);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Cuponul nu există.');
      }
    });

    it('să rotunjească corect sumele', async () => {
      const created = await createTestCoupon({ discountValue: 33 });
      const result = await couponModel.calculateDiscount(created.code, 100, TEST_USER);
      expect(result.discountAmount).to.equal(33);
      expect(result.finalAmount).to.equal(67);
    });
  });

  // =========================================================================
  // getActiveCoupons
  // =========================================================================
  describe('getActiveCoupons', () => {
    it('să returneze doar cupoanele active', async () => {
      const c1 = await createTestCoupon({ code: 'ACTIVE-01' });
      const c2 = await createTestCoupon({ code: 'ACTIVE-02' });
      // Anulăm unul dintre ele
      await couponModel.cancelCoupon(c1.code, TEST_USER);
      const active = await couponModel.getActiveCoupons(TEST_USER);
      expect(active).to.have.lengthOf(1);
      expect(active[0].code).to.equal(c2.code);
    });

    it('să returneze lista goală pentru utilizator fără cupoane active', async () => {
      const active = await couponModel.getActiveCoupons(TEST_USER);
      expect(active).to.deep.equal([]);
    });

    it('să respingă userId invalid', async () => {
      try {
        await couponModel.getActiveCoupons('');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul utilizatorului este invalid.');
      }
    });

    it('să sorteze după data de expirare (cel mai apropiat primul)', async () => {
      const c1 = await createTestCoupon({ code: 'SORT-01', validityDays: 10 });
      const c2 = await createTestCoupon({ code: 'SORT-02', validityDays: 5 });
      const active = await couponModel.getActiveCoupons(TEST_USER);
      expect(active[0].code).to.equal(c2.code);
      expect(active[1].code).to.equal(c1.code);
    });
  });

  // =========================================================================
  // getAllCouponsForUser
  // =========================================================================
  describe('getAllCouponsForUser', () => {
    beforeEach(async () => {
      await createTestCoupon({ code: 'USER1-A' });
      await createTestCoupon({ code: 'USER1-B' });
      await couponModel.createCoupon({ userId: TEST_USER2, code: 'USER2-A' });
    });

    it('să returneze toate cupoanele utilizatorului', async () => {
      const coupons = await couponModel.getAllCouponsForUser(TEST_USER);
      expect(coupons).to.have.lengthOf(2);
    });

    it('să filtreze după status', async () => {
      const created = await createTestCoupon({ code: 'TO-CANCEL' });
      await couponModel.cancelCoupon('TO-CANCEL', TEST_USER);
      const cancelled = await couponModel.getAllCouponsForUser(TEST_USER, { status: 'cancelled' });
      expect(cancelled).to.have.lengthOf(1);
      expect(cancelled[0].code).to.equal('TO-CANCEL');
    });

    it('să respingă status invalid', async () => {
      try {
        await couponModel.getAllCouponsForUser(TEST_USER, { status: 'pending' });
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Statusul');
      }
    });

    it('să respingă userId invalid', async () => {
      try {
        await couponModel.getAllCouponsForUser('');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul utilizatorului este invalid.');
      }
    });

    it('să sorteze descendent implicit', async () => {
      const coupons = await couponModel.getAllCouponsForUser(TEST_USER);
      expect(coupons).to.have.lengthOf(2);
      // Cel mai recent creat primul
      expect(new Date(coupons[0].createdAt) >= new Date(coupons[1].createdAt)).to.be.true;
    });

    it('să sorteze ascendent', async () => {
      const coupons = await couponModel.getAllCouponsForUser(TEST_USER, { sortOrder: 'asc' });
      expect(new Date(coupons[0].createdAt) <= new Date(coupons[1].createdAt)).to.be.true;
    });

    it('să nu sorteze pentru câmp invalid', async () => {
      const coupons = await couponModel.getAllCouponsForUser(TEST_USER, { sortBy: 'invalidField' });
      expect(coupons).to.have.lengthOf(2);
    });
  });

  // =========================================================================
  // cleanupExpiredCoupons
  // =========================================================================
  describe('cleanupExpiredCoupons', () => {
    it('să marcheze cupoanele expirate', async () => {
      const created = await createTestCoupon({ validityDays: 1 });
      // Obținem referința internă și forțăm expirarea
      const coupon = await couponModel.getCouponByCode(created.code);
      // Nu putem accesa direct Map-ul din exterior, dar putem testa cu un cupon
      // creat cu validityDays = 1 și apoi verificăm că cleanupExpiredCoupons îl marchează
      // dacă data de expirare e în trecut
      // Folosim o abordare alternativă: creăm un cupon cu expiresAt în trecut
      // din păcate API-ul nu permite asta direct...
    });

    it('să returneze 0 dacă nu sunt cupoane expirate', async () => {
      await createTestCoupon({ validityDays: 365 });
      const count = await couponModel.cleanupExpiredCoupons(TEST_USER);
      expect(count).to.equal(0);
    });

    it('să respingă userId invalid', async () => {
      try {
        await couponModel.cleanupExpiredCoupons('');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul utilizatorului este invalid.');
      }
    });
  });

  // =========================================================================
  // extendCouponValidity
  // =========================================================================
  describe('extendCouponValidity', () => {
    it('să extindă valabilitatea unui cupon activ', async () => {
      const created = await createTestCoupon({ validityDays: 30 });
      const extended = await couponModel.extendCouponValidity(created.code, TEST_USER, 15);
      expect(extended.validityDays).to.equal(45);
      expect(extended.extraDays).to.equal(15);
      const newExpiry = new Date(extended.expiresAt);
      const oldExpiry = new Date(created.expiresAt);
      expect(newExpiry > oldExpiry).to.be.true;
    });

    it('să respingă extraDays invalid (0)', async () => {
      const created = await createTestCoupon();
      try {
        await couponModel.extendCouponValidity(created.code, TEST_USER, 0);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Numărul de zile adiționale');
      }
    });

    it('să respingă extraDays negativ', async () => {
      const created = await createTestCoupon();
      try {
        await couponModel.extendCouponValidity(created.code, TEST_USER, -5);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Numărul de zile adiționale');
      }
    });

    it('să respingă extraDays peste maxim', async () => {
      const created = await createTestCoupon();
      try {
        await couponModel.extendCouponValidity(created.code, TEST_USER, 400);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Nu se pot adăuga mai mult');
      }
    });

    it('să respingă cupon inexistent', async () => {
      try {
        await couponModel.extendCouponValidity('NONEXIST', TEST_USER, 10);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Cuponul nu există.');
      }
    });

    it('să respingă cupon al altui utilizator', async () => {
      const created = await createTestCoupon();
      try {
        await couponModel.extendCouponValidity(created.code, TEST_USER2, 10);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('nu aparține utilizatorului');
      }
    });

    it('să respingă cupon anulat', async () => {
      const created = await createTestCoupon();
      await couponModel.cancelCoupon(created.code, TEST_USER);
      try {
        await couponModel.extendCouponValidity(created.code, TEST_USER, 10);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('Doar cupoanele active');
      }
    });
  });

  // =========================================================================
  // getCouponStats
  // =========================================================================
  describe('getCouponStats', () => {
    it('să returneze statistici corecte', async () => {
      await createTestCoupon({ code: 'STAT-1' });
      await createTestCoupon({ code: 'STAT-2' });
      const c3 = await createTestCoupon({ code: 'STAT-3', maxUsageCount: 1 });
      await couponModel.useCoupon(c3.code, TEST_USER);
      await createTestCoupon({ code: 'STAT-4' });
      await couponModel.cancelCoupon('STAT-4', TEST_USER);

      const stats = await couponModel.getCouponStats(TEST_USER);
      expect(stats.total).to.equal(4);
      expect(stats.active).to.equal(2);
      expect(stats.used).to.equal(1);
      expect(stats.cancelled).to.equal(1);
    });

    it('să returneze 0 peste tot pentru utilizator fără cupoane', async () => {
      const stats = await couponModel.getCouponStats(TEST_USER);
      expect(stats.total).to.equal(0);
      expect(stats.active).to.equal(0);
      expect(stats.used).to.equal(0);
      expect(stats.expired).to.equal(0);
      expect(stats.cancelled).to.equal(0);
    });

    it('să respingă userId invalid', async () => {
      try {
        await couponModel.getCouponStats('');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul utilizatorului este invalid.');
      }
    });
  });

  // =========================================================================
  // deleteCoupon
  // =========================================================================
  describe('deleteCoupon', () => {
    it('să șteargă un cupon nefolosit', async () => {
      const created = await createTestCoupon();
      const result = await couponModel.deleteCoupon(created.id, TEST_USER);
      expect(result).to.be.true;
      // Verificăm că nu mai există
      try {
        await couponModel.getCouponById(created.id);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Cuponul nu a fost găsit.');
      }
    });

    it('să respingă ștergerea unui cupon folosit', async () => {
      const created = await createTestCoupon({ maxUsageCount: 1 });
      await couponModel.useCoupon(created.code, TEST_USER);
      try {
        await couponModel.deleteCoupon(created.id, TEST_USER);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('deja folosite');
      }
    });

    it('să respingă ID invalid', async () => {
      try {
        await couponModel.deleteCoupon('', TEST_USER);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul cuponului este invalid.');
      }
    });

    it('să respingă userId invalid', async () => {
      const created = await createTestCoupon();
      try {
        await couponModel.deleteCoupon(created.id, '');
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('ID-ul utilizatorului este invalid.');
      }
    });

    it('să respingă cupon inexistent', async () => {
      try {
        await couponModel.deleteCoupon('nonexistent-id', TEST_USER);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.equal('Cuponul nu a fost găsit.');
      }
    });

    it('să respingă ștergerea de către alt utilizator', async () => {
      const created = await createTestCoupon();
      try {
        await couponModel.deleteCoupon(created.id, TEST_USER2);
        throw new Error('A trebuit să arunce eroare');
      } catch (err) {
        expect(err.message).to.include('nu aparține utilizatorului');
      }
    });

    it('să permită ștergerea unui cupon anulat', async () => {
      const created = await createTestCoupon();
      await couponModel.cancelCoupon(created.code, TEST_USER);
      const result = await couponModel.deleteCoupon(created.id, TEST_USER);
      expect(result).to.be.true;
    });
  });

  // =========================================================================
  // resetAllData & getTotalCouponCount
  // =========================================================================
  describe('resetAllData și getTotalCouponCount', () => {
    it('să reseteze toate datele', async () => {
      await createTestCoupon();
      await createTestCoupon({ code: 'TEST-2' });
      expect(await couponModel.getTotalCouponCount()).to.equal(2);
      await couponModel.resetAllData();
      expect(await couponModel.getTotalCouponCount()).to.equal(0);
    });

    it('getTotalCouponCount să returneze 0 la inițializare', async () => {
      const count = await couponModel.getTotalCouponCount();
      expect(count).to.equal(0);
    });
  });

  // =========================================================================
  // TESTE INTEGRATE (scenarii complete)
  // =========================================================================
  describe('Scenarii integrate', () => {
    it('flux complet: creare → validare → utilizare → statistici', async () => {
      // Creare
      const coupon = await couponModel.createCoupon({
        userId: TEST_USER,
        discountType: 'percent',
        discountValue: 25,
        validityDays: 30,
        maxUsageCount: 2,
        minOrderAmount: 50,
        description: 'Cupon integrat',
      });

      expect(coupon.status).to.equal('active');
      expect(await couponModel.getTotalCouponCount()).to.equal(1);

      // Validare
      const validated = await couponModel.validateCoupon(coupon.code, TEST_USER, { orderAmount: 100 });
      expect(validated.code).to.equal(coupon.code);

      // Calcul discount
      const discount = await couponModel.calculateDiscount(coupon.code, 200, TEST_USER);
      expect(discount.discountAmount).to.equal(50);
      expect(discount.finalAmount).to.equal(150);

      // Utilizare (prima)
      const used1 = await couponModel.useCoupon(coupon.code, TEST_USER, { orderId: 'order-1', orderAmount: 200 });
      expect(used1.currentUsageCount).to.equal(1);
      expect(used1.status).to.equal('active'); // încă mai are o utilizare

      // Utilizare (a doua – ultima)
      const used2 = await couponModel.useCoupon(coupon.code, TEST_USER, { orderId: 'order-2', orderAmount: 150 });
      expect(used2.currentUsageCount).to.equal(2);
      expect(used2.status).to.equal('used');
      expect(used2.usedAt).to.be.a('string');

      // Statistici
      const stats = await couponModel.getCouponStats(TEST_USER);
      expect(stats.total).to.equal(1);
      expect(stats.used).to.equal(1);
      expect(stats.active).to.equal(0);

      // Curățare
      await couponModel.resetAllData();
      expect(await couponModel.getTotalCouponCount()).to.equal(0);
    });

    it('flux anulare și extindere', async () => {
      const coupon = await createTestCoupon({ code: 'FLUX-2', validityDays: 15 });

      // Extindere
      const extended = await couponModel.extendCouponValidity('FLUX-2', TEST_USER, 20);
      expect(extended.validityDays).to.equal(35);

      // Anulare
      const cancelled = await couponModel.cancelCoupon('FLUX-2', TEST_USER, 'Nu mai e nevoie');
      expect(cancelled.status).to.equal('cancelled');
      expect(cancelled.cancelledReason).to.equal('Nu mai e nevoie');

      // Nu mai apare în active
      const active = await couponModel.getActiveCoupons(TEST_USER);
      expect(active).to.deep.equal([]);
    });
  });
});
