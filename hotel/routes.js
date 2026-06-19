/**
 * ============================================================
 * hotel/routes.js - Rute de vizualizare EJS pentru modulul Hotel
 * ============================================================
 *
 * Acest fișier definește rutele de tip view (EJS) pentru interfața
 * de administrare a hotelurilor: dashboard, camere, rezervări, oaspeți, etc.
 *
 * Tehnologii:
 *  - Express Router
 *  - EJS templating (layout.ejs partajat)
 *  - Autentificare prin middleware/auth.js
 *  - Autorizare prin middleware/roles.js
 *
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const path = require('path');

const { authenticate } = require('../middleware/auth');
const { authorizeMinLevel } = require('../middleware/roles');
const { HotelModel } = require('../models/hotelModel');
const { RoomModel } = require('../models/roomModel');

const hotelModel = new HotelModel();
const roomModel = new RoomModel();

// ---------------------------------------------------------------------------
// Helper: determinare tenantId
// ---------------------------------------------------------------------------

function resolveTenantId(req) {
  if (req.user && req.user.tenantId) {
    return req.user.tenantId;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: încărcare hotel implicit / după query param
// ---------------------------------------------------------------------------

async function resolveHotel(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) return null;

  const hotels = await hotelModel.findByTenant(tenantId);
  res.locals.hotels = hotels;

  const hotelId = req.query.hotelId || null;
  let hotel = null;

  if (hotelId) {
    hotel = hotels.find(h => h._id === hotelId) || null;
  }

  if (!hotel && hotels.length > 0) {
    hotel = hotels[0];
  }

  return hotel;
}

// ---------------------------------------------------------------------------
// Helper: calculează statistici camere
// ---------------------------------------------------------------------------

function computeRoomStats(rooms) {
  return {
    totalRooms: rooms.length,
    availableRooms: rooms.filter(r => r.status === 'available').length,
    occupiedRooms: rooms.filter(r => r.status === 'occupied').length,
    maintenanceRooms: rooms.filter(r => r.status === 'maintenance').length,
    cleaningRooms: rooms.filter(r => r.status === 'cleaning').length,
    reservedRooms: rooms.filter(r => r.status === 'reserved').length,
    outOfOrderRooms: rooms.filter(r => r.status === 'out of order').length,
    occupancyRate: rooms.length > 0
      ? Math.round((rooms.filter(r => r.status === 'occupied').length / rooms.length) * 100)
      : 0,
  };
}

// ---------------------------------------------------------------------------
// Middleware: setează variabilele globale pentru layout
// ---------------------------------------------------------------------------

router.use(authenticate);
router.use(authorizeMinLevel('recepție'));

router.use(async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    let hotels = [];

    if (tenantId) {
      hotels = await hotelModel.findByTenant(tenantId);
    }

    res.locals.restaurants = []; // compatibilitate layout
    res.locals.currentRestaurantId = null;
    res.locals.hotels = hotels;
    res.locals.currentPage = 'hotel';
    res.locals.title = 'Hotel';
    res.locals.user = req.user;

    next();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /hotel/dashboard
// ---------------------------------------------------------------------------

router.get('/dashboard', async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    const hotelId = req.query.hotelId || null;

    let hotel = null;
    let rooms = [];
    let stats = {
      totalRooms: 0,
      availableRooms: 0,
      occupiedRooms: 0,
      maintenanceRooms: 0,
      cleaningRooms: 0,
      reservedRooms: 0,
      outOfOrderRooms: 0,
      occupancyRate: 0,
    };

    if (tenantId) {
      const hotels = await hotelModel.findByTenant(tenantId);
      res.locals.hotels = hotels;

      if (hotelId) {
        hotel = hotels.find(h => h._id === hotelId) || null;
      }

      if (!hotel && hotels.length > 0) {
        hotel = hotels[0];
      }

      if (hotel) {
        rooms = await roomModel.findByHotel(hotel._id);
        stats = computeRoomStats(rooms);
      }
    }

    res.locals.title = 'Dashboard Hotel';
    res.locals.currentPage = 'hotel';

    res.render('hotel/views/dashboard', {
      hotel,
      rooms,
      stats,
      loading: false,
      layout: 'restaurant/views/layout',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /hotel/rooms
// ---------------------------------------------------------------------------

router.get('/rooms', async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    const hotelId = req.query.hotelId || null;
    const statusFilter = req.query.status || null;

    let hotel = null;
    let rooms = [];
    let stats = {};

    if (tenantId) {
      const hotels = await hotelModel.findByTenant(tenantId);
      res.locals.hotels = hotels;

      if (hotelId) {
        hotel = hotels.find(h => h._id === hotelId) || null;
      }

      if (!hotel && hotels.length > 0) {
        hotel = hotels[0];
      }

      if (hotel) {
        let allRooms = await roomModel.findByHotel(hotel._id);

        if (statusFilter && statusFilter !== 'all') {
          rooms = allRooms.filter(r => r.status === statusFilter);
        } else {
          rooms = allRooms;
        }

        stats = computeRoomStats(allRooms);
      }
    }

    res.locals.title = 'Camere Hotel';
    res.locals.currentPage = 'hotel-rooms';

    res.render('hotel/views/rooms', {
      hotel,
      rooms,
      stats,
      statusFilter: statusFilter || 'all',
      loading: false,
      layout: 'restaurant/views/layout',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /hotel/reservations
// ---------------------------------------------------------------------------

router.get('/reservations', async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    const hotelId = req.query.hotelId || null;
    const statusFilter = req.query.status || 'all';
    const searchQuery = req.query.search || '';
    const dateFrom = req.query.dateFrom || '';
    const dateTo = req.query.dateTo || '';

    let hotel = null;
    let reservations = [];

    if (tenantId) {
      const hotels = await hotelModel.findByTenant(tenantId);
      res.locals.hotels = hotels;

      if (hotelId) {
        hotel = hotels.find(h => h._id === hotelId) || null;
      }

      if (!hotel && hotels.length > 0) {
        hotel = hotels[0];
      }

      if (hotel) {
        // Încercăm să încărcăm rezervările din ReservationModel
        try {
          const { createReservation, findReservationsByHotel } = require('../models/reservationModel');
          const filterOptions = {};

          if (statusFilter && statusFilter !== 'all') {
            filterOptions.status = statusFilter;
          }

          if (dateFrom) {
            filterOptions.checkInData = dateFrom;
          }

          // Obținem toate rezervările pentru hotel
          const rawReservations = await findReservationsByHotel(hotel._id, tenantId, filterOptions);

          // Mapare câmpuri pentru vizualizare
          reservations = (rawReservations || []).map(r => ({
            _id: r._id,
            oaspeteNume: r.numePersoana || 'Nespecificat',
            oaspeteEmail: r.email || '',
            oaspeteTelefon: r.telefon || '',
            cameraNumăr: r.camera || (r.cameraNumăr || 'N/A'),
            cameraTip: r.cameraTip || '',
            checkIn: r.checkInData || r.data || null,
            checkOut: r.checkOutData || null,
            nopți: r.nopți || 0,
            total: r.sumarFacturare ? r.sumarFacturare.totalNet : 0,
            status: r.status || 'pending',
            numărPersoane: r.numarPersoane || 1,
            note: r.note || '',
            creatLa: r.createdAt || null,
          }));
        } catch (err) {
          // Dacă ReservationModel nu este disponibil, încercăm prin API
          reservations = [];
        }

        // Filtrare client-side după searchQuery
        if (searchQuery && reservations.length > 0) {
          const q = searchQuery.toLowerCase();
          reservations = reservations.filter(r =>
            (r.oaspeteNume && r.oaspeteNume.toLowerCase().includes(q)) ||
            (r.oaspeteEmail && r.oaspeteEmail.toLowerCase().includes(q)) ||
            (r.cameraNumăr && String(r.cameraNumăr).toLowerCase().includes(q))
          );
        }

        // Filtrare după interval date
        if (dateFrom && reservations.length > 0) {
          const fromDate = new Date(dateFrom);
          reservations = reservations.filter(r => {
            if (!r.checkIn) return true;
            return new Date(r.checkIn) >= fromDate;
          });
        }

        if (dateTo && reservations.length > 0) {
          const toDate = new Date(dateTo);
          reservations = reservations.filter(r => {
            if (!r.checkOut) return true;
            return new Date(r.checkOut) <= toDate;
          });
        }
      }
    }

    // Statistici rapide
    const quickStats = {
      total: reservations.length,
      confirmed: reservations.filter(r => r.status === 'confirmed' || r.status === 'confirmată').length,
      pending: reservations.filter(r => r.status === 'pending' || r.status === 'în așteptare').length,
      checkedIn: reservations.filter(r => r.status === 'checked-in' || r.status === 'check-in' || r.status === 'în curs').length,
      checkedOut: reservations.filter(r => r.status === 'checked-out' || r.status === 'check-out' || r.status === 'finalizată').length,
      cancelled: reservations.filter(r => r.status === 'cancelled' || r.status === 'anulată').length,
      noShow: reservations.filter(r => r.status === 'no-show' || r.status === 'neprezentat').length,
    };

    res.locals.title = 'Rezervări Hotel';
    res.locals.currentPage = 'hotel-reservations';

    res.render('hotel/views/reservations', {
      hotel,
      reservations,
      quickStats,
      statusFilter,
      searchQuery,
      dateFrom,
      dateTo,
      loading: false,
      layout: 'restaurant/views/layout',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /hotel/guests
// ---------------------------------------------------------------------------

router.get('/guests', async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    const hotelId = req.query.hotelId || null;
    const statusFilter = req.query.status || 'all';
    const searchQuery = req.query.search || '';

    let hotel = null;
    let guests = [];

    if (tenantId) {
      const hotels = await hotelModel.findByTenant(tenantId);
      res.locals.hotels = hotels;

      if (hotelId) {
        hotel = hotels.find(h => h._id === hotelId) || null;
      }

      if (!hotel && hotels.length > 0) {
        hotel = hotels[0];
      }

      if (hotel) {
        // Încercăm să obținem oaspeții din rezervări
        try {
          const { findReservationsByHotel } = require('../models/reservationModel');
          const rawReservations = await findReservationsByHotel(hotel._id, tenantId);

          // Construim lista de oaspeți unici din rezervări
          const guestMap = new Map();

          (rawReservations || []).forEach(r => {
            const key = r.numePersoana ? r.numePersoana.trim().toLowerCase() : r._id;
            if (!guestMap.has(key)) {
              guestMap.set(key, {
                _id: r._id,
                nume: r.numePersoana || 'Nespecificat',
                email: r.email || '',
                telefon: r.telefon || '',
                cameraNumăr: r.camera || '',
                cameraTip: r.cameraTip || '',
                checkIn: r.checkInData || r.data || null,
                checkOut: r.checkOutData || null,
                status: r.status === 'checked-in' || r.status === 'check-in' || r.status === 'în curs'
                  ? 'checked-in'
                  : r.status === 'checked-out' || r.status === 'check-out' || r.status === 'finalizată'
                    ? 'checked-out'
                    : r.status === 'pending' || r.status === 'în așteptare'
                      ? 'pending'
                      : r.status === 'cancelled' || r.status === 'anulată'
                        ? 'cancelled'
                        : 'pending',
                numărPersoane: r.numarPersoane || 1,
                note: r.note || '',
                rezervareId: r._id,
              });
            } else {
              // Actualizăm dacă există o înregistrare mai recentă
              const existing = guestMap.get(key);
              if (r.checkInData && (!existing.checkIn || new Date(r.checkInData) > new Date(existing.checkIn))) {
                existing.checkIn = r.checkInData;
                existing.cameraNumăr = r.camera || existing.cameraNumăr;
              }
              if (r.checkOutData && (!existing.checkOut || new Date(r.checkOutData) > new Date(existing.checkOut))) {
                existing.checkOut = r.checkOutData;
              }
            }
          });

          guests = Array.from(guestMap.values());

          // Filtrare după status
          if (statusFilter && statusFilter !== 'all') {
            guests = guests.filter(g => g.status === statusFilter);
          }

          // Filtrare după search
          if (searchQuery) {
            const q = searchQuery.toLowerCase();
            guests = guests.filter(g =>
              (g.nume && g.nume.toLowerCase().includes(q)) ||
              (g.email && g.email.toLowerCase().includes(q)) ||
              (g.telefon && g.telefon.toLowerCase().includes(q)) ||
              (g.cameraNumăr && String(g.cameraNumăr).toLowerCase().includes(q))
            );
          }
        } catch (err) {
          // Dacă modelul nu e disponibil, încearcă să încarci direct
          guests = [];
        }

        // Încerăm să încărcăm și camerele pentru a îmbogăți datele oaspeților
        try {
          const rooms = await roomModel.findByHotel(hotel._id);
          const occupiedRooms = rooms.filter(r => r.status === 'occupied' || r.status === 'reserved');

          // Adăugăm oaspeți din camerele ocupate care nu sunt deja în listă
          occupiedRooms.forEach(room => {
            const existing = guests.find(g =>
              g.cameraNumăr === String(room.număr) ||
              g.cameraNumăr === room.număr
            );
            if (!existing) {
              guests.push({
                _id: room._id + '-auto',
                nume: 'Oaspete camera ' + room.număr,
                email: '',
                telefon: '',
                cameraNumăr: String(room.număr),
                cameraTip: room.tip || '',
                checkIn: null,
                checkOut: null,
                status: room.status === 'occupied' ? 'checked-in' : 'pending',
                numărPersoane: 1,
                note: '',
                rezervareId: null,
              });
            }
          });
        } catch (err) {
          // Ignorăm erorile de încărcare a camerelor
        }
      }
    }

    // Statistici rapide
    const quickStats = {
      total: guests.length,
      checkedIn: guests.filter(g => g.status === 'checked-in').length,
      checkedOut: guests.filter(g => g.status === 'checked-out').length,
      pending: guests.filter(g => g.status === 'pending').length,
      cancelled: guests.filter(g => g.status === 'cancelled').length,
    };

    res.locals.title = 'Oaspeți Hotel';
    res.locals.currentPage = 'hotel-guests';

    res.render('hotel/views/guests', {
      hotel,
      guests,
      quickStats,
      statusFilter,
      searchQuery,
      loading: false,
      layout: 'restaurant/views/layout',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /hotel/inventory
// ---------------------------------------------------------------------------

router.get('/inventory', async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    const hotelId = req.query.hotelId || null;
    const categoryFilter = req.query.category || 'all';
    const searchQuery = req.query.search || '';
    const lowStockOnly = req.query.lowStock === 'true';

    let hotel = null;
    let inventoryItems = [];
    let categories = [];

    if (tenantId) {
      const hotels = await hotelModel.findByTenant(tenantId);
      res.locals.hotels = hotels;

      if (hotelId) {
        hotel = hotels.find(h => h._id === hotelId) || null;
      }

      if (!hotel && hotels.length > 0) {
        hotel = hotels[0];
      }

      if (hotel) {
        try {
          const {
            findInventoryItemsByLocation,
            findLowStockItems,
            getInventorySummary,
            VALID_CATEGORIES,
          } = require('../models/inventoryItemModel');

          categories = VALID_CATEGORIES;

          // Încărcăm iteme de inventar pentru acest hotel
          let items = await findInventoryItemsByLocation(hotel._id, 'hotel');

          // Filtrare după categorie
          if (categoryFilter && categoryFilter !== 'all') {
            items = items.filter(item => item.category === categoryFilter);
          }

          // Filtrare după search
          if (searchQuery) {
            const q = searchQuery.toLowerCase();
            items = items.filter(item =>
              (item.name && item.name.toLowerCase().includes(q)) ||
              (item.category && item.category.toLowerCase().includes(q))
            );
          }

          // Filtrare low stock
          if (lowStockOnly) {
            items = items.filter(item => item.quantity < item.minThreshold);
          }

          inventoryItems = items;
        } catch (err) {
          // Dacă modelul de inventar nu e disponibil
          inventoryItems = [];
          categories = [];
        }
      }
    }

    // Statistici inventar
    const inventoryStats = {
      total: inventoryItems.length,
      lowStock: inventoryItems.filter(item => item.quantity < item.minThreshold).length,
      outOfStock: inventoryItems.filter(item => item.quantity === 0).length,
      healthyStock: inventoryItems.filter(item => item.quantity >= item.minThreshold && item.quantity > 0).length,
    };

    res.locals.title = 'Inventar Hotel';
    res.locals.currentPage = 'hotel-inventory';

    res.render('hotel/views/inventory', {
      hotel,
      inventoryItems,
      inventoryStats,
      categories,
      categoryFilter: categoryFilter || 'all',
      searchQuery,
      lowStockOnly,
      loading: false,
      layout: 'restaurant/views/layout',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /hotel/suppliers
// ---------------------------------------------------------------------------

router.get('/suppliers', async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    const hotelId = req.query.hotelId || null;
    const statusFilter = req.query.status || 'all';
    const searchQuery = req.query.search || '';

    let hotel = null;
    let suppliers = [];

    if (tenantId) {
      const hotels = await hotelModel.findByTenant(tenantId);
      res.locals.hotels = hotels;

      if (hotelId) {
        hotel = hotels.find(h => h._id === hotelId) || null;
      }

      if (!hotel && hotels.length > 0) {
        hotel = hotels[0];
      }

      if (hotel) {
        try {
          const {
            findSuppliersByTenant,
            findSuppliersByStatus,
            searchSuppliersByName,
            findAllSuppliers,
            VALID_STATUSES,
          } = require('../models/supplierModel');

          // Încărcăm furnizori
          if (statusFilter && statusFilter !== 'all' && VALID_STATUSES.includes(statusFilter)) {
            suppliers = await findSuppliersByStatus(statusFilter, tenantId);
          } else if (searchQuery) {
            try {
              suppliers = await searchSuppliersByName(searchQuery, tenantId);
            } catch (searchErr) {
              suppliers = await findSuppliersByTenant(tenantId);
            }
          } else {
            suppliers = await findSuppliersByTenant(tenantId);
          }
        } catch (err) {
          // Dacă modelul de furnizori nu e disponibil
          suppliers = [];
        }
      }
    }

    // Statistici furnizori
    const supplierStats = {
      total: suppliers.length,
      active: suppliers.filter(s => s.status === 'active').length,
      inactive: suppliers.filter(s => s.status === 'inactive').length,
      blacklisted: suppliers.filter(s => s.status === 'blacklisted').length,
    };

    res.locals.title = 'Furnizori Hotel';
    res.locals.currentPage = 'hotel-suppliers';

    res.render('hotel/views/suppliers', {
      hotel,
      suppliers,
      supplierStats,
      statusFilter: statusFilter || 'all',
      searchQuery,
      loading: false,
      layout: 'restaurant/views/layout',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /hotel/deliveries
// ---------------------------------------------------------------------------

router.get('/deliveries', async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    const hotelId = req.query.hotelId || null;
    const statusFilter = req.query.status || 'all';
    const supplierFilter = req.query.supplierId || null;
    const dateFrom = req.query.dateFrom || '';
    const dateTo = req.query.dateTo || '';

    let hotel = null;
    let deliveries = [];
    let suppliers = [];

    if (tenantId) {
      const hotels = await hotelModel.findByTenant(tenantId);
      res.locals.hotels = hotels;

      if (hotelId) {
        hotel = hotels.find(h => h._id === hotelId) || null;
      }

      if (!hotel && hotels.length > 0) {
        hotel = hotels[0];
      }

      if (hotel) {
        try {
          const {
            findDeliveriesByTenant,
            findDeliveriesBySupplier,
            findDeliveriesByDateRange,
            VALID_DELIVERY_STATUSES,
          } = require('../models/deliveryModel');

          // Colectăm opțiunile de filtrare
          const filterOptions = {};

          if (statusFilter && statusFilter !== 'all' && VALID_DELIVERY_STATUSES.includes(statusFilter)) {
            filterOptions.status = statusFilter;
          }

          if (supplierFilter) {
            filterOptions.supplierId = supplierFilter;
          }

          filterOptions.locationId = hotel._id;
          filterOptions.locationType = 'hotel';

          // Încărcăm livrările
          if (dateFrom && dateTo) {
            deliveries = await findDeliveriesByDateRange(dateFrom, dateTo, tenantId);
            // Filtrare client-side pentru locație
            deliveries = deliveries.filter(d =>
              d.locationId === hotel._id && d.locationType === 'hotel'
            );
          } else {
            deliveries = await findDeliveriesByTenant(tenantId, filterOptions);
          }

          // Încercăm să încărcăm și furnizorii pentru dropdown
          try {
            const { findSuppliersByTenant } = require('../models/supplierModel');
            suppliers = await findSuppliersByTenant(tenantId);
          } catch (supErr) {
            suppliers = [];
          }
        } catch (err) {
          // Dacă modelul de livrări nu e disponibil
          deliveries = [];
          suppliers = [];
        }
      }
    }

    // Statistici livrări
    const deliveryStats = {
      total: deliveries.length,
      comandată: deliveries.filter(d => d.status === 'comandată').length,
      înTranzit: deliveries.filter(d => d.status === 'în tranzit').length,
      livrată: deliveries.filter(d => d.status === 'livrată').length,
      anulată: deliveries.filter(d => d.status === 'anulată').length,
      valoareTotală: deliveries.reduce((sum, d) => sum + (d.totalValue || 0), 0),
    };

    res.locals.title = 'Livrări Hotel';
    res.locals.currentPage = 'hotel-deliveries';

    res.render('hotel/views/deliveries', {
      hotel,
      deliveries,
      deliveryStats,
      suppliers,
      statusFilter: statusFilter || 'all',
      supplierFilter,
      dateFrom,
      dateTo,
      loading: false,
      layout: 'restaurant/views/layout',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /hotel/settings
// ---------------------------------------------------------------------------

router.get('/settings', async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    const hotelId = req.query.hotelId || null;

    let hotel = null;

    if (tenantId) {
      const hotels = await hotelModel.findByTenant(tenantId);
      res.locals.hotels = hotels;

      if (hotelId) {
        hotel = hotels.find(h => h._id === hotelId) || null;
      }

      if (!hotel && hotels.length > 0) {
        hotel = hotels[0];
      }
    }

    res.locals.title = 'Setări Hotel';
    res.locals.currentPage = 'hotel-settings';

    res.render('hotel/views/settings', {
      hotel,
      loading: false,
      layout: 'restaurant/views/layout',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Export router
// ---------------------------------------------------------------------------

module.exports = router;