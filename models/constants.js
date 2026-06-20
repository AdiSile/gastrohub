'use strict';

// ===========================================================================
// CONSTANTE CENTRALIZATE – GastroHub
// ===========================================================================
// Acest modul agregă toate constantele de validare din modelele aplicației,
// oferind un punct unic de import pentru rute și middleware.
// ===========================================================================

// ---------------------------------------------------------------------------
// Din reservationModel
// ---------------------------------------------------------------------------
const {
  VALID_RESERVATION_TYPES: _VALID_RESERVATION_TYPES,
  VALID_RESERVATION_STATUSES: _VALID_RESERVATION_STATUSES,
  VALID_BILLING_STATUSES: _VALID_BILLING_STATUSES,
} = require('./reservationModel');

// ---------------------------------------------------------------------------
// Din roomModel
// ---------------------------------------------------------------------------
const {
  VALID_ROOM_TYPES: _VALID_ROOM_TYPES,
  VALID_ROOM_STATUSES: _VALID_ROOM_STATUSES,
} = require('./roomModel');

// ---------------------------------------------------------------------------
// Din hotelModel
// ---------------------------------------------------------------------------
const {
  VALID_HOTEL_STATUSES: _VALID_HOTEL_STATUSES,
} = require('./hotelModel');

// ---------------------------------------------------------------------------
// Din orderModel
// ---------------------------------------------------------------------------
const {
  VALID_ORDER_STATUSES: _VALID_ORDER_STATUSES,
  VALID_PAYMENT_METHODS: _VALID_PAYMENT_METHODS,
} = require('./orderModel');

// ---------------------------------------------------------------------------
// Din deliveryModel
// ---------------------------------------------------------------------------
const {
  VALID_DELIVERY_STATUSES: _VALID_DELIVERY_STATUSES,
  VALID_LOCATION_TYPES: _VALID_LOCATION_TYPES,
  VALID_UNITS: _VALID_UNITS,
} = require('./deliveryModel');

// ---------------------------------------------------------------------------
// Din hrModel
// ---------------------------------------------------------------------------
const {
  VALID_ATTENDANCE_TYPES: _VALID_ATTENDANCE_TYPES,
  VALID_CURRENCIES: _VALID_CURRENCIES,
  VALID_SALARY_STATUS: _VALID_SALARY_STATUS,
  VALID_PAYMENT_FREQUENCIES: _VALID_PAYMENT_FREQUENCIES,
} = require('./hrModel');

// ---------------------------------------------------------------------------
// Din restaurantModel
// ---------------------------------------------------------------------------
const {
  VALID_STATUSES: _VALID_RESTAURANT_STATUSES,
  VALID_TABLE_STATUSES: _VALID_TABLE_STATUSES,
} = require('./restaurantModel');

// ---------------------------------------------------------------------------
// Din middleware/roles (roluri angajați)
// ---------------------------------------------------------------------------
const {
  VALID_ROLES: _VALID_ROLES,
  VALID_EMPLOYEE_ROLES: _VALID_EMPLOYEE_ROLES,
} = require('../middleware/roles');

// ---------------------------------------------------------------------------
// Din generated.js / supplierModel (statusuri comandă furnizor)
// ---------------------------------------------------------------------------
const {
  VALID_ORDER_STATUSES: _VALID_SUPPLIER_ORDER_STATUSES,
  VALID_STATUSES: _VALID_SUPPLIER_STATUSES,
  VALID_PAYMENT_TERMS: _VALID_PAYMENT_TERMS,
} = require('../generated');

// ===========================================================================
// EXPORTURI – toate constantele
// ===========================================================================

module.exports = {
  // --- Rezervări ---
  VALID_RESERVATION_TYPES: _VALID_RESERVATION_TYPES,
  VALID_RESERVATION_STATUSES: _VALID_RESERVATION_STATUSES,
  VALID_BILLING_STATUSES: _VALID_BILLING_STATUSES,

  // --- Camere ---
  VALID_ROOM_TYPES: _VALID_ROOM_TYPES,
  VALID_ROOM_STATUSES: _VALID_ROOM_STATUSES,
  // Alias pentru ROOM_TYPES (fără prefix)
  ROOM_TYPES: _VALID_ROOM_TYPES,

  // --- Hoteluri ---
  VALID_HOTEL_STATUSES: _VALID_HOTEL_STATUSES,

  // --- Comenzi restaurant ---
  VALID_ORDER_STATUSES: _VALID_ORDER_STATUSES,
  VALID_PAYMENT_METHODS: _VALID_PAYMENT_METHODS,

  // --- Comenzi furnizor ---
  VALID_SUPPLIER_ORDER_STATUSES: _VALID_SUPPLIER_ORDER_STATUSES,
  VALID_SUPPLIER_STATUSES: _VALID_SUPPLIER_STATUSES,
  VALID_PAYMENT_TERMS: _VALID_PAYMENT_TERMS,

  // --- Livrări ---
  VALID_DELIVERY_STATUSES: _VALID_DELIVERY_STATUSES,
  VALID_LOCATION_TYPES: _VALID_LOCATION_TYPES,
  VALID_UNITS: _VALID_UNITS,

  // --- HR / Pontaj ---
  VALID_ATTENDANCE_TYPES: _VALID_ATTENDANCE_TYPES,
  VALID_CURRENCIES: _VALID_CURRENCIES,
  VALID_SALARY_STATUS: _VALID_SALARY_STATUS,
  VALID_PAYMENT_FREQUENCIES: _VALID_PAYMENT_FREQUENCIES,

  // --- Restaurante ---
  VALID_RESTAURANT_STATUSES: _VALID_RESTAURANT_STATUSES,
  VALID_TABLE_STATUSES: _VALID_TABLE_STATUSES,

  // --- Roluri ---
  VALID_ROLES: _VALID_ROLES,
  VALID_EMPLOYEE_ROLES: _VALID_EMPLOYEE_ROLES,
};