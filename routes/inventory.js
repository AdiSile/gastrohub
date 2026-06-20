const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { auth, checkRole } = require('../middleware/auth');
const {
  createItem,
  getItemById,
  getInventoryByTenant,
  updateItem,
  deleteItem
} = require('../models/inventoryModel');

const VALID_CATEGORIES = ['alimente', 'bauturi', 'consumabile', 'curatenie', 'ambalaje', 'altele'];

router.get('/', auth, checkRole('super_admin', 'admin', 'manager'), async (req, res) => {
  try {
    const items = await getInventoryByTenant(req.user.tenant_id);
    res.json(items);
  } catch (err) {
    res.status(500).json({ success: false, error: { message: err.message, code: 'SERVER_ERROR' } });
  }
});

router.get('/:id', auth, checkRole('super_admin', 'admin', 'manager'), async (req, res) => {
  try {
    const item = await getItemById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: { message: 'Produs negăsit', code: 'NOT_FOUND' } });
    res.json(item);
  } catch (err) {
    res.status(500).json({ success: false, error: { message: err.message, code: 'SERVER_ERROR' } });
  }
});

router.post('/',
  auth,
  checkRole('super_admin', 'admin', 'manager'),
  [
    body('name').trim().notEmpty().withMessage('Numele produsului este obligatoriu.'),
    body('category').trim().isIn(VALID_CATEGORIES).withMessage(`Categoria trebuie să fie una dintre: ${VALID_CATEGORIES.join(', ')}.`),
    body('quantity').isFloat({ min: 0 }).withMessage('Cantitatea trebuie să fie un număr pozitiv.'),
    body('unit').trim().notEmpty().withMessage('Unitatea de măsură este obligatorie.'),
    body('price_per_unit').isFloat({ min: 0 }).withMessage('Prețul trebuie să fie un număr pozitiv.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const messages = errors.array().map(e => e.msg).join('; ');
      return res.status(422).json({ success: false, error: { message: messages, code: 'VALIDATION_ERROR' } });
    }
    try {
      const item = await createItem({ ...req.body, tenant_id: req.user.tenant_id });
      res.status(201).json({ success: true, data: item });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err.message, code: 'CREATE_ERROR' } });
    }
  }
);

router.put('/:id',
  auth,
  checkRole('super_admin', 'admin', 'manager'),
  [
    body('category').optional().isIn(VALID_CATEGORIES).withMessage(`Categoria trebuie să fie una dintre: ${VALID_CATEGORIES.join(', ')}.`),
    body('quantity').optional().isFloat({ min: 0 }).withMessage('Cantitatea trebuie să fie un număr pozitiv.'),
    body('price_per_unit').optional().isFloat({ min: 0 }).withMessage('Prețul trebuie să fie un număr pozitiv.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const messages = errors.array().map(e => e.msg).join('; ');
      return res.status(422).json({ success: false, error: { message: messages, code: 'VALIDATION_ERROR' } });
    }
    try {
      const updated = await updateItem(req.params.id, req.body);
      res.json({ success: true, data: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err.message, code: 'UPDATE_ERROR' } });
    }
  }
);

router.delete('/:id', auth, checkRole('super_admin', 'admin'), async (req, res) => {
  try {
    await deleteItem(req.params.id);
    res.json({ success: true, message: 'Produs șters' });
  } catch (err) {
    res.status(500).json({ success: false, error: { message: err.message, code: 'DELETE_ERROR' } });
  }
});

module.exports = router;