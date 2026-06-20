const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/roles');
const {
  createHotel,
  getHotelById,
  getHotelsByTenant,
  updateHotel,
  deleteHotel,
  createRoom,
  getRoomById,
  getRoomsByHotel,
  updateRoom,
  deleteRoom
} = require('../models/hotelModel');

// === Hoteluri ===
router.get('/', authenticate, async (req, res) => {
  try {
    const hotels = await getHotelsByTenant(req.user.tenantId);
    res.json(hotels);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticate, authorize('super_admin', 'owner'), async (req, res) => {
  try {
    const hotel = await createHotel({ ...req.body, tenant_id: req.user.tenantId });
    res.status(201).json(hotel);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const hotel = await getHotelById(req.params.id);
    if (!hotel) return res.status(404).json({ error: 'Hotel negăsit' });
    res.json(hotel);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticate, authorize('super_admin', 'owner'), async (req, res) => {
  try {
    const updated = await updateHotel(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, authorize('super_admin'), async (req, res) => {
  try {
    await deleteHotel(req.params.id);
    res.json({ message: 'Hotel șters' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Camere ===
router.get('/:hotelId/rooms', authenticate, async (req, res) => {
  try {
    const rooms = await getRoomsByHotel(req.params.hotelId);
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:hotelId/rooms', authenticate, authorize('super_admin', 'owner', 'manager_hotel'), async (req, res) => {
  try {
    const room = await createRoom({ ...req.body, hotel_id: req.params.hotelId, tenant_id: req.user.tenantId });
    res.status(201).json(room);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/rooms/:id', authenticate, async (req, res) => {
  try {
    const room = await getRoomById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Cameră negăsită' });
    res.json(room);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/rooms/:id', authenticate, authorize('super_admin', 'owner', 'manager_hotel'), async (req, res) => {
  try {
    const updated = await updateRoom(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/rooms/:id', authenticate, authorize('super_admin'), async (req, res) => {
  try {
    await deleteRoom(req.params.id);
    res.json({ message: 'Cameră ștearsă' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;