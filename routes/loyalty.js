/**
 * ============================================================
 * routes/loyalty.js - Rute API pentru loialitate
 * ============================================================
 *
 * Responsabilități:
 *  1. GET    /api/loyalty/account/:userId       – Obține contul de loialitate
 *  2. POST   /api/loyalty/account/:userId/points – Acumulează puncte per comandă/sejur
 *  3. POST   /api/loyalty/account               – Creează cont de loialitate
 *  4. GET    /api/loyalty/coupons/active/:userId – Listare cupoane active
 *  5. GET    /api/loyalty/coupons/all/:userId    – Listare toate cupoanele utilizatorului
 *  6. POST   /api/loyalty/coupons/generate       – Generează cupon nou
 *  7. POST   /api/loyalty/coupons/use            – Folosește un cupon
 *  8. POST   /api/loyalty/coupons/cancel         – Anulează un cupon
 *  9. GET    /api/loyalty/coupons/validate       – Validează un cupon
 * 10. POST   /api/loyalty/coupons/cleanup        – Curăță cupoane expirate
 * 11. POST   /api/loyalty/discount/calculate     – Calculează discount pe baza cuponului
 * 12. GET    /api/loyalty/points/:userId/lifetime – Istoric total puncte (lifetime)
 *
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { authorize, authorizeMinLevel } = require('../middleware/roles');

// ---------------------------------------------------------------------------
// Model loialitate
// ---------------------------------------------------------------------------
const {
  // Configurare
  LOYALTY_CONFIG,

  // Validare
  isValidUserId,
  isValidPositiveNumber,
  isValidCouponCode,
  isValidDiscountPercent,

  // Cont loialitate
  createLoyaltyAccount,
  getLoyaltyAccount,
  addPoints,
  deductPoints,
  getLifetimePoints,

  // Cupoane
  createCoupon,
  getCouponById,
  getCouponByCode,
  validateCoupon,
  useCoupon,
  cancelCoupon,
  getActiveCoupons,
  getAllCouponsForUser,
  cleanupExpiredCoupons,
  calculateDiscount,
} = require('../models/loyaltyModel');

// ---------------------------------------------------------------------------
// Helper: validare erori de validare
// ---------------------------------------------------------------------------
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Erori de validare.',
        code: 'VALIDATION_ERROR',
        details: errors.array().map(e => ({
          field: e.path,
          message: e.msg,
        })),
      },
    });
  }
  next();
};

// ---------------------------------------------------------------------------
// POST /api/loyalty/account – Creează cont de loialitate
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/loyalty/account
 * @desc    Creează un cont de loialitate pentru un utilizator
 * @access  Privat (autentificare necesară)
 *
 * Body:
 *   { userId: string }
 *
 * Răspuns (201):
 *   { success: true, data: { account } }
 */
router.post(
  '/account',
  authenticate,
  [
    body('userId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul utilizatorului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { userId } = req.body;

      // Verificare acces – doar super_admin sau același utilizator
      if (req.user.role !== 'super_admin' && req.user._id !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Nu ai permisiunea de a crea un cont de loialitate pentru acest utilizator.',
            code: 'FORBIDDEN',
          },
        });
      }

      const account = await createLoyaltyAccount(userId);

      res.status(201).json({
        success: true,
        data: {
          account,
        },
      });
    } catch (err) {
      // 409 Conflict dacă contul există deja
      if (err.message && err.message.includes('există deja')) {
        return res.status(409).json({
          success: false,
          error: {
            message: err.message,
            code: 'CONFLICT',
          },
        });
      }
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/loyalty/account/:userId – Obține cont de loialitate
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/loyalty/account/:userId
 * @desc    Obține contul de loialitate al unui utilizator
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { account } }
 */
router.get(
  '/account/:userId',
  authenticate,
  [
    param('userId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul utilizatorului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { userId } = req.params;

      // Verificare acces – doar super_admin sau același utilizator
      if (req.user.role !== 'super_admin' && req.user._id !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Nu ai permisiunea de a vizualiza acest cont de loialitate.',
            code: 'FORBIDDEN',
          },
        });
      }

      const account = await getLoyaltyAccount(userId);

      // Curățăm cupoanele expirate înainte de a returna
      const cleanedCount = await cleanupExpiredCoupons(userId);
      const refreshedAccount = cleanedCount > 0
        ? await getLoyaltyAccount(userId)
        : account;

      res.status(200).json({
        success: true,
        data: {
          account: refreshedAccount,
          expiredCouponsCleaned: cleanedCount,
        },
      });
    } catch (err) {
      if (err.message && err.message.includes('nu a fost găsit')) {
        return res.status(404).json({
          success: false,
          error: {
            message: err.message,
            code: 'NOT_FOUND',
          },
        });
      }
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/loyalty/account/:userId/points – Acumulează puncte per comandă/sejur
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/loyalty/account/:userId/points
 * @desc    Acumulează puncte de loialitate pe baza valorii cheltuite (comandă/sejur)
 * @access  Privat (autentificare necesară, rol staff sau admin)
 *
 * Body:
 *   { spentAmount: number, description?: string }
 *
 * Răspuns (200):
 *   { success: true, data: { account, pointsEarned, description } }
 */
router.post(
  '/account/:userId/points',
  authenticate,
  authorizeMinLevel('recepție'),
  [
    param('userId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul utilizatorului este obligatoriu.'),
    body('spentAmount')
      .isFloat({ gt: 0 })
      .withMessage('Valoarea cheltuită trebuie să fie un număr pozitiv.'),
    body('description')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Descrierea poate avea maxim 255 de caractere.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { userId } = req.params;
      const { spentAmount, description } = req.body;

      // Verificare acces tenant
      if (req.user.role !== 'super_admin') {
        if (String(req.user.tenantId) !== String(req.body.tenantId || req.user.tenantId)) {
          return res.status(403).json({
            success: false,
            error: {
              message: 'Nu ai acces la acest tenant.',
              code: 'FORBIDDEN',
            },
          });
        }
      }

      const result = await addPoints(userId, spentAmount);

      res.status(200).json({
        success: true,
        data: {
          account: {
            userId: result.userId,
            totalPoints: result.totalPoints,
            lifetimePoints: result.lifetimePoints,
            activeCoupons: result.activeCoupons,
            updatedAt: result.updatedAt,
          },
          pointsEarned: result.pointsEarned,
          description: description || `Puncte acumulate pentru comandă/sejur în valoare de ${spentAmount} unități`,
        },
      });
    } catch (err) {
      if (err.message && err.message.includes('nu a fost găsit')) {
        return res.status(404).json({
          success: false,
          error: {
            message: err.message + ' Creează mai întâi un cont de loialitate.',
            code: 'NOT_FOUND',
          },
        });
      }
      if (err.message && err.message.includes('prea mică')) {
        return res.status(400).json({
          success: false,
          error: {
            message: err.message,
            code: 'BAD_REQUEST',
          },
        });
      }
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/loyalty/points/:userId/lifetime – Istoric total puncte (lifetime)
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/loyalty/points/:userId/lifetime
 * @desc    Obține numărul total de puncte acumulate de-a lungul timpului
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { lifetimePoints } }
 */
router.get(
  '/points/:userId/lifetime',
  authenticate,
  [
    param('userId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul utilizatorului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { userId } = req.params;

      if (req.user.role !== 'super_admin' && req.user._id !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Nu ai permisiunea de a vizualiza aceste informații.',
            code: 'FORBIDDEN',
          },
        });
      }

      const lifetimePoints = await getLifetimePoints(userId);

      res.status(200).json({
        success: true,
        data: {
          userId,
          lifetimePoints,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/loyalty/coupons/active/:userId – Listare cupoane active
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/loyalty/coupons/active/:userId
 * @desc    Listare cupoane active ale unui utilizator
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { coupons, count } }
 */
router.get(
  '/coupons/active/:userId',
  authenticate,
  [
    param('userId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul utilizatorului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { userId } = req.params;

      if (req.user.role !== 'super_admin' && req.user._id !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Nu ai permisiunea de a vizualiza cupoanele acestui utilizator.',
            code: 'FORBIDDEN',
          },
        });
      }

      const coupons = await getActiveCoupons(userId);

      res.status(200).json({
        success: true,
        data: {
          coupons,
          count: coupons.length,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/loyalty/coupons/all/:userId – Listare toate cupoanele
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/loyalty/coupons/all/:userId
 * @desc    Listare toate cupoanele unui utilizator (inclusiv expirate/folosite)
 * @access  Privat (autentificare necesară)
 *
 * Răspuns (200):
 *   { success: true, data: { coupons, count } }
 */
router.get(
  '/coupons/all/:userId',
  authenticate,
  [
    param('userId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul utilizatorului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { userId } = req.params;

      if (req.user.role !== 'super_admin' && req.user._id !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Nu ai permisiunea de a vizualiza cupoanele acestui utilizator.',
            code: 'FORBIDDEN',
          },
        });
      }

      const coupons = await getAllCouponsForUser(userId);

      res.status(200).json({
        success: true,
        data: {
          coupons,
          count: coupons.length,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/loyalty/coupons/generate – Generează cupon nou
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/loyalty/coupons/generate
 * @desc    Generează un cupon de reducere pentru un utilizator
 * @access  Privat (autentificare necesară)
 *
 * Body:
 *   { userId: string, discountPercent?: number, pointsCost?: number }
 *
 * Răspuns (201):
 *   { success: true, data: { coupon } }
 */
router.post(
  '/coupons/generate',
  authenticate,
  [
    body('userId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul utilizatorului este obligatoriu.'),
    body('discountPercent')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Procentajul de discount trebuie să fie între 1 și 100.'),
    body('pointsCost')
      .optional()
      .isInt({ min: 10 })
      .withMessage('Costul în puncte trebuie să fie de minim 10.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { userId, discountPercent, pointsCost } = req.body;

      // Verificare acces
      if (req.user.role !== 'super_admin' && req.user._id !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Nu ai permisiunea de a genera cupoane pentru acest utilizator.',
            code: 'FORBIDDEN',
          },
        });
      }

      const options = {};
      if (discountPercent) options.discountPercent = discountPercent;
      if (pointsCost) options.pointsCost = pointsCost;

      const coupon = await createCoupon(userId, options);

      res.status(201).json({
        success: true,
        data: {
          coupon: {
            id: coupon.id,
            code: coupon.code,
            discountPercent: coupon.discountPercent,
            pointsCost: coupon.pointsCost,
            status: coupon.status,
            expiresAt: coupon.expiresAt,
            createdAt: coupon.createdAt,
          },
        },
      });
    } catch (err) {
      if (err.message && err.message.includes('Puncte insuficiente')) {
        return res.status(400).json({
          success: false,
          error: {
            message: err.message,
            code: 'BAD_REQUEST',
          },
        });
      }
      if (err.message && err.message.includes('numărul maxim de cupoane active')) {
        return res.status(400).json({
          success: false,
          error: {
            message: err.message,
            code: 'BAD_REQUEST',
          },
        });
      }
      if (err.message && err.message.includes('nu a fost găsit')) {
        return res.status(404).json({
          success: false,
          error: {
            message: err.message + ' Creează mai întâi un cont de loialitate.',
            code: 'NOT_FOUND',
          },
        });
      }
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/loyalty/coupons/use – Folosește un cupon
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/loyalty/coupons/use
 * @desc    Folosește un cupon (îl marchează ca used)
 * @access  Privat (autentificare necesară)
 *
 * Body:
 *   { code: string, userId: string, orderId?: string }
 *
 * Răspuns (200):
 *   { success: true, data: { coupon, discountDetails } }
 */
router.post(
  '/coupons/use',
  authenticate,
  [
    body('code')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Codul cuponului este obligatoriu.'),
    body('userId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul utilizatorului este obligatoriu.'),
    body('orderId')
      .optional()
      .isString()
      .trim()
      .withMessage('ID-ul comenzii trebuie să fie un șir de caractere.'),
    body('orderAmount')
      .optional()
      .isFloat({ gt: 0 })
      .withMessage('Valoarea comenzii trebuie să fie un număr pozitiv.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { code, userId, orderId, orderAmount } = req.body;

      // Verificare acces
      if (req.user.role !== 'super_admin' && req.user._id !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Nu ai permisiunea de a folosi cupoane pentru acest utilizator.',
            code: 'FORBIDDEN',
          },
        });
      }

      const orderDetails = {};
      if (orderId) orderDetails.orderId = orderId;

      const coupon = await useCoupon(code, userId, orderDetails);

      let discountDetails = null;
      if (orderAmount) {
        discountDetails = await calculateDiscount(code, orderAmount, userId);
      }

      res.status(200).json({
        success: true,
        data: {
          coupon: {
            id: coupon.id,
            code: coupon.code,
            discountPercent: coupon.discountPercent,
            status: coupon.status,
            usedAt: coupon.usedAt,
            usedOnOrder: coupon.usedOnOrder || null,
          },
          discountDetails,
        },
      });
    } catch (err) {
      if (err.message && err.message.includes('nu există') ||
          err.message && err.message.includes('nu aparține') ||
          err.message && err.message.includes('a expirat') ||
          err.message && err.message.includes('a fost deja folosit') ||
          err.message && err.message.includes('a fost anulat')) {
        return res.status(400).json({
          success: false,
          error: {
            message: err.message,
            code: 'BAD_REQUEST',
          },
        });
      }
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/loyalty/coupons/cancel – Anulează un cupon
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/loyalty/coupons/cancel
 * @desc    Anulează un cupon activ și restituie punctele
 * @access  Privat (autentificare necesară)
 *
 * Body:
 *   { code: string, userId: string }
 *
 * Răspuns (200):
 *   { success: true, data: { coupon, pointsRefunded } }
 */
router.post(
  '/coupons/cancel',
  authenticate,
  [
    body('code')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Codul cuponului este obligatoriu.'),
    body('userId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul utilizatorului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { code, userId } = req.body;

      // Verificare acces
      if (req.user.role !== 'super_admin' && req.user._id !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Nu ai permisiunea de a anula cupoane pentru acest utilizator.',
            code: 'FORBIDDEN',
          },
        });
      }

      const result = await cancelCoupon(code, userId);

      res.status(200).json({
        success: true,
        data: {
          coupon: {
            id: result.id,
            code: result.code,
            status: result.status,
            discountPercent: result.discountPercent,
          },
          pointsRefunded: result.pointsRefunded,
        },
      });
    } catch (err) {
      if (err.message && err.message.includes('nu există') ||
          err.message && err.message.includes('nu aparține') ||
          err.message && err.message.includes('Doar cupoanele active') ||
          err.message && err.message.includes('a expirat deja')) {
        return res.status(400).json({
          success: false,
          error: {
            message: err.message,
            code: 'BAD_REQUEST',
          },
        });
      }
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/loyalty/coupons/validate – Validează un cupon
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/loyalty/coupons/validate
 * @desc    Validează un cupon fără a-l folosi
 * @access  Public (necesită cod și userId)
 *
 * Query:
 *   code, userId
 *
 * Răspuns (200):
 *   { success: true, data: { valid: boolean, coupon?, message? } }
 */
router.get(
  '/coupons/validate',
  optionalAuth,
  [
    query('code')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Codul cuponului este obligatoriu.'),
    query('userId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul utilizatorului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { code, userId } = req.query;

      const coupon = await validateCoupon(code, userId);

      res.status(200).json({
        success: true,
        data: {
          valid: true,
          coupon: {
            code: coupon.code,
            discountPercent: coupon.discountPercent,
            expiresAt: coupon.expiresAt,
          },
        },
      });
    } catch (err) {
      // Cupon invalid – returnăm 200 cu valid: false
      res.status(200).json({
        success: true,
        data: {
          valid: false,
          message: err.message,
        },
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/loyalty/coupons/cleanup – Curăță cupoane expirate
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/loyalty/coupons/cleanup
 * @desc    Curăță cupoanele expirate ale unui utilizator
 * @access  Privat (autentificare necesară)
 *
 * Body:
 *   { userId: string }
 *
 * Răspuns (200):
 *   { success: true, data: { cleanedCount } }
 */
router.post(
  '/coupons/cleanup',
  authenticate,
  [
    body('userId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul utilizatorului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { userId } = req.body;

      if (req.user.role !== 'super_admin' && req.user._id !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Nu ai permisiunea de a curăța cupoanele acestui utilizator.',
            code: 'FORBIDDEN',
          },
        });
      }

      const cleanedCount = await cleanupExpiredCoupons(userId);

      res.status(200).json({
        success: true,
        data: {
          userId,
          cleanedCount,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/loyalty/discount/calculate – Calculează discount
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/loyalty/discount/calculate
 * @desc    Calculează valoarea discount-ului pe baza cuponului și a sumei
 * @access  Public (necesită cod cupon, userId, orderAmount)
 *
 * Body:
 *   { couponCode: string, orderAmount: number, userId: string }
 *
 * Răspuns (200):
 *   { success: true, data: { originalAmount, discountPercent, discountAmount, finalAmount, couponCode } }
 */
router.post(
  '/discount/calculate',
  optionalAuth,
  [
    body('couponCode')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Codul cuponului este obligatoriu.'),
    body('orderAmount')
      .isFloat({ gt: 0 })
      .withMessage('Valoarea comenzii trebuie să fie un număr pozitiv.'),
    body('userId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('ID-ul utilizatorului este obligatoriu.'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { couponCode, orderAmount, userId } = req.body;

      const discountDetails = await calculateDiscount(couponCode, orderAmount, userId);

      res.status(200).json({
        success: true,
        data: discountDetails,
      });
    } catch (err) {
      if (err.message && err.message.includes('Suma comenzii') ||
          err.message && err.message.includes('cuponul') ||
          err.message && err.message.includes('Cuponul')) {
        return res.status(400).json({
          success: false,
          error: {
            message: err.message,
            code: 'BAD_REQUEST',
          },
        });
      }
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Export router
// ---------------------------------------------------------------------------

module.exports = router;