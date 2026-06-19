'use strict';

// ---------------------------------------------------------------------------
// Model Order – GastroHub
// Definirea structurii, validărilor și operațiilor CRUD pentru comenzi.
// Câmpuri suportate: status, articole, total, metodă plată, ospătar, masă,
// tenantId, restaurantId, note, discount, taxă serviciu
// ---------------------------------------------------------------------------

const { restaurants } = require('../config/db');
const { getTenantDb } = require('../config/tenant');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Statusuri valide pentru o comandă
// ---------------------------------------------------------------------------

const VALID_ORDER_STATUSES = [
  'deschisă',
  'în preparare',
  'finalizată',
  'livrată',
  'achitată',
  'anulată',
];

// ---------------------------------------------------------------------------
// Metode de plată valide
// ---------------------------------------------------------------------------

const VALID_PAYMENT_METHODS = [
  'numerar',
  'card',
  'card online',
  'tichet de masă',
  'bon cadou',
  'transfer bancar',
  'altă',
];

// ---------------------------------------------------------------------------
// Funcții de validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă un șir nu este gol și are lungimea între limite.
 * @param {*} val
 * @param {number} [min=1]
 * @param {number} [max=255]
 * @returns {boolean}
 */
function isValidString(val, min = 1, max = 255) {
  return typeof val === 'string' && val.trim().length >= min && val.trim().length <= max;
}

/**
 * Verifică dacă o valoare este un număr pozitiv (preț, total etc.).
 * @param {*} val
 * @returns {boolean}
 */
function isValidPrice(val) {
  return typeof val === 'number' && !Number.isNaN(val) && val >= 0 && Number.isFinite(val);
}

/**
 * Verifică dacă un status de comandă este valid.
 * @param {string} status
 * @returns {boolean}
 */
function isValidOrderStatus(status) {
  return VALID_ORDER_STATUSES.includes(status);
}

/**
 * Verifică dacă o metodă de plată este validă.
 * @param {string} method
 * @returns {boolean}
 */
function isValidPaymentMethod(method) {
  return VALID_PAYMENT_METHODS.includes(method);
}

/**
 * Verifică dacă un număr de masă este valid (număr întreg pozitiv).
 * @param {*} val
 * @returns {boolean}
 */
function isValidTableNumber(val) {
  return Number.isInteger(val) && val > 0;
}

/**
 * Verifică dacă un array conține doar obiecte cu structură validă de articol.
 * Un articol valid conține: menuItemId (string), nume (string), cantitate (int > 0), preț (number >= 0).
 * @param {*} arr
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateItems(arr) {
  if (!Array.isArray(arr)) {
    return { valid: false, errors: ['Articolele trebuie să fie o listă.'] };
  }

  if (arr.length === 0) {
    return { valid: false, errors: ['Comanda trebuie să conțină cel puțin un articol.'] };
  }

  const errors = [];

  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    const idx = i + 1;

    if (!item || typeof item !== 'object') {
      errors.push(`Articolul #${idx} este invalid.`);
      continue;
    }

    if (!item.menuItemId || typeof item.menuItemId !== 'string' || item.menuItemId.trim().length === 0) {
      errors.push(`Articolul #${idx}: ID-ul produsului (menuItemId) este obligatoriu.`);
    }

    if (!item.nume || typeof item.nume !== 'string' || item.nume.trim().length === 0) {
      errors.push(`Articolul #${idx}: numele produsului este obligatoriu.`);
    }

    if (!Number.isInteger(item.cantitate) || item.cantitate < 1) {
      errors.push(`Articolul #${idx}: cantitatea trebuie să fie un număr întreg >= 1.`);
    }

    if (item.pret === undefined || item.pret === null || !isValidPrice(item.pret)) {
      errors.push(`Articolul #${idx}: prețul trebuie să fie un număr pozitiv.`);
    }

    if (item.subtotal !== undefined && item.subtotal !== null && !isValidPrice(item.subtotal)) {
      errors.push(`Articolul #${idx}: subtotalul trebuie să fie un număr pozitiv.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Calculează subtotalul pentru un articol (cantitate * preț).
 * @param {Object} item
 * @returns {number}
 */
function calculateItemSubtotal(item) {
  return item.cantitate * item.pret;
}

/**
 * Calculează totalul unei comenzi pe baza articolelor.
 * @param {Array} items - Lista de articole
 * @param {number} [taxaServiciu=0] - Taxa serviciu (procent, ex: 10 pentru 10%)
 * @param {number} [discount=0] - Discount (sumă fixă)
 * @returns {{ subtotal: number, taxaServiciuValoare: number, discount: number, total: number }}
 */
function calculateOrderTotal(items, taxaServiciu = 0, discount = 0) {
  const subtotal = items.reduce((sum, item) => {
    const itemSubtotal = item.subtotal !== undefined && item.subtotal !== null
      ? item.subtotal
      : calculateItemSubtotal(item);
    return sum + itemSubtotal;
  }, 0);

  const taxaServiciuValoare = taxaServiciu > 0 ? +(subtotal * (taxaServiciu / 100)).toFixed(2) : 0;
  const discountValoare = discount > 0 ? +discount.toFixed(2) : 0;
  const total = +(subtotal + taxaServiciuValoare - discountValoare).toFixed(2);

  return {
    subtotal: +subtotal.toFixed(2),
    taxaServiciuValoare,
    discount: discountValoare,
    total: Math.max(0, total),
  };
}

// ---------------------------------------------------------------------------
// Funcții de inițializare a colecției
// ---------------------------------------------------------------------------

/**
 * Obține colecția NeDB pentru comenzile unui tenant.
 * Folosește baza de date per-tenant din config/tenant.js.
 * @param {string} tenantId
 * @returns {Datastore}
 */
function getOrdersDb(tenantId) {
  return getTenantDb(tenantId);
}

// ---------------------------------------------------------------------------
// Operații CRUD – Orders
// ---------------------------------------------------------------------------

/**
 * Creează o comandă nouă.
 *
 * @param {Object} orderData - Datele comenzii
 * @param {Array} orderData.articole - Lista articolelor (obligatoriu)
 * @param {string} [orderData.status='deschisă'] - Statusul comenzii
 * @param {number} [orderData.total] - Totalul (calculat automat dacă nu este furnizat)
 * @param {string} [orderData.metodaPlata] - Metoda de plată
 * @param {string} [orderData.ospatar] - Numele/ID-ul ospătarului
 * @param {number} [orderData.masa] - Numărul mesei
 * @param {number} [orderData.taxaServiciu=0] - Procent taxa serviciu
 * @param {number} [orderData.discount=0] - Discount sumă fixă
 * @param {string} [orderData.note=''] - Note adiționale
 * @param {string} orderData.tenantId - ID tenant (obligatoriu)
 * @param {string} orderData.restaurantId - ID restaurant (obligatoriu)
 * @returns {Promise<Object>} Documentul comenzii creat
 * @throws {AppError} Dacă validarea eșuează
 */
function createOrder(orderData) {
  return new Promise((resolve, reject) => {
    // Validare date de bază
    if (!orderData || typeof orderData !== 'object') {
      return reject(new AppError('Datele comenzii sunt invalide.', 400, 'INVALID_ORDER_DATA'));
    }

    const {
      articole,
      status,
      total,
      metodaPlata,
      ospatar,
      masa,
      taxaServiciu,
      discount,
      note,
      tenantId,
      restaurantId,
    } = orderData;

    // Validare tenantId
    if (!tenantId) {
      return reject(new AppError(
        'ID-ul tenant-ului este obligatoriu.',
        400,
        'MISSING_TENANT_ID'
      ));
    }

    // Validare restaurantId
    if (!restaurantId) {
      return reject(new AppError(
        'ID-ul restaurantului este obligatoriu.',
        400,
        'MISSING_RESTAURANT_ID'
      ));
    }

    // Validare articole
    const itemsValidation = validateItems(articole);
    if (!itemsValidation.valid) {
      return reject(new AppError(
        itemsValidation.errors.join(' '),
        400,
        'INVALID_ORDER_ITEMS'
      ));
    }

    // Validare status (opțional)
    const finalStatus = status || 'deschisă';
    if (!isValidOrderStatus(finalStatus)) {
      return reject(new AppError(
        `Statusul "${finalStatus}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
        400,
        'INVALID_ORDER_STATUS'
      ));
    }

    // Validare metodă plată (opțional)
    const finalMetodaPlata = metodaPlata || '';
    if (finalMetodaPlata && !isValidPaymentMethod(finalMetodaPlata)) {
      return reject(new AppError(
        `Metoda de plată "${finalMetodaPlata}" nu este validă. ` +
        `Metode permise: ${VALID_PAYMENT_METHODS.join(', ')}.`,
        400,
        'INVALID_PAYMENT_METHOD'
      ));
    }

    // Validare ospătar (opțional)
    const finalOspatar = ospatar || '';
    if (finalOspatar && !isValidString(finalOspatar, 1, 200)) {
      return reject(new AppError(
        'Numele/ID-ul ospătarului poate avea maximum 200 de caractere.',
        400,
        'INVALID_WAITER'
      ));
    }

    // Validare masă (opțional)
    const finalMasa = masa !== undefined && masa !== null ? masa : 0;
    if (finalMasa !== 0 && !isValidTableNumber(finalMasa)) {
      return reject(new AppError(
        'Numărul mesei trebuie să fie un număr întreg pozitiv.',
        400,
        'INVALID_TABLE_NUMBER'
      ));
    }

    // Validare taxa serviciu (opțional)
    const finalTaxaServiciu = taxaServiciu || 0;
    if (typeof finalTaxaServiciu !== 'number' || finalTaxaServiciu < 0 || finalTaxaServiciu > 100) {
      return reject(new AppError(
        'Taxa serviciu trebuie să fie un procent între 0 și 100.',
        400,
        'INVALID_SERVICE_CHARGE'
      ));
    }

    // Validare discount (opțional)
    const finalDiscount = discount || 0;
    if (typeof finalDiscount !== 'number' || finalDiscount < 0) {
      return reject(new AppError(
        'Discountul trebuie să fie un număr pozitiv.',
        400,
        'INVALID_DISCOUNT'
      ));
    }

    // Validare note (opțional)
    const finalNote = note !== undefined && note !== null ? String(note) : '';
    if (finalNote.length > 2000) {
      return reject(new AppError(
        'Notele pot avea maximum 2000 de caractere.',
        400,
        'INVALID_NOTES'
      ));
    }

    // Calcul total
    const calculatedTotals = calculateOrderTotal(
      articole.map((a) => ({
        ...a,
        subtotal: a.subtotal !== undefined ? a.subtotal : undefined,
      })),
      finalTaxaServiciu,
      finalDiscount
    );

    // Total poate fi suprascris de client, dar validăm
    const finalTotal = total !== undefined && total !== null
      ? (isValidPrice(total) ? +total.toFixed(2) : calculatedTotals.total)
      : calculatedTotals.total;

    // -----------------------------------------------------------------------
    // Verificare existență restaurant
    // -----------------------------------------------------------------------
    restaurants.findOne({ _id: restaurantId, tenantId }, (findErr, restaurant) => {
      if (findErr) {
        return reject(new AppError(
          `Eroare la verificarea restaurantului: ${findErr.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      if (!restaurant) {
        return reject(new AppError(
          'Restaurantul specificat nu există sau nu aparține acestui tenant.',
          404,
          'RESTAURANT_NOT_FOUND'
        ));
      }

      // -----------------------------------------------------------------------
      // Creare document comandă
      // -----------------------------------------------------------------------
      const articoleFinale = articole.map((a) => ({
        menuItemId: a.menuItemId,
        nume: a.nume.trim(),
        cantitate: a.cantitate,
        pret: a.pret,
        subtotal: a.subtotal !== undefined && a.subtotal !== null
          ? a.subtotal
          : calculateItemSubtotal(a),
        note: a.note || '',
      }));

      const orderDoc = {
        articole: articoleFinale,
        status: finalStatus,
        subtotal: calculatedTotals.subtotal,
        taxaServiciu: finalTaxaServiciu,
        taxaServiciuValoare: calculatedTotals.taxaServiciuValoare,
        discount: finalDiscount,
        total: finalTotal,
        metodaPlata: finalMetodaPlata,
        ospatar: finalOspatar,
        masa: finalMasa,
        note: finalNote,
        tenantId,
        restaurantId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const ordersDb = getOrdersDb(tenantId);
      ordersDb.insert(orderDoc, (insertErr, newOrder) => {
        if (insertErr) {
          return reject(new AppError(
            `Eroare la crearea comenzii: ${insertErr.message}`,
            500,
            'DB_INSERT_ERROR'
          ));
        }

        resolve(newOrder);
      });
    });
  });
}

/**
 * Găsește o comandă după ID.
 * @param {string} id - ID-ul NeDB
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object|null>}
 */
function findOrderById(id, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const ordersDb = getOrdersDb(tenantId);
    ordersDb.findOne({ _id: id }, (err, order) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea comenzii: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(order || null);
    });
  });
}

/**
 * Găsește toate comenzile dintr-un restaurant.
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni (sort, limit, skip, status)
 * @returns {Promise<Array>}
 */
function findOrdersByRestaurant(restaurantId, tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!restaurantId) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const filter = { restaurantId };

    // Filtrare opțională după status
    if (options.status) {
      if (!isValidOrderStatus(options.status)) {
        return reject(new AppError(
          `Statusul "${options.status}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
          400,
          'INVALID_ORDER_STATUS'
        ));
      }
      filter.status = options.status;
    }

    // Filtrare opțională după masă
    if (options.masa !== undefined && options.masa !== null) {
      if (!isValidTableNumber(options.masa)) {
        return reject(new AppError(
          'Numărul mesei trebuie să fie un număr întreg pozitiv.',
          400,
          'INVALID_TABLE_NUMBER'
        ));
      }
      filter.masa = options.masa;
    }

    // Filtrare opțională după ospătar
    if (options.ospatar) {
      filter.ospatar = options.ospatar;
    }

    const ordersDb = getOrdersDb(tenantId);
    let query = ordersDb.find(filter);

    // Sortare
    if (options.sort) {
      query = query.sort(options.sort);
    } else {
      query = query.sort({ createdAt: -1 });
    }

    // Limit
    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      query = query.limit(options.limit);
    }

    // Skip
    if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
      query = query.skip(options.skip);
    }

    query.exec((err, orders) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea comenzilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(orders || []);
    });
  });
}

/**
 * Găsește comenzi după status.
 * @param {string} status - Statusul comenzilor
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>}
 */
function findOrdersByStatus(status, restaurantId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!status || !isValidOrderStatus(status)) {
      return reject(new AppError(
        `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
        400,
        'INVALID_ORDER_STATUS'
      ));
    }

    if (!restaurantId) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const ordersDb = getOrdersDb(tenantId);
    ordersDb.find({ restaurantId, status })
      .sort({ createdAt: -1 })
      .exec((err, orders) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea comenzilor: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        resolve(orders || []);
      });
  });
}

/**
 * Găsește comenzile unei mese specifice.
 * @param {number} masa - Numărul mesei
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>}
 */
function findOrdersByTable(masa, restaurantId, tenantId) {
  return new Promise((resolve, reject) => {
    if (masa === undefined || masa === null || !isValidTableNumber(masa)) {
      return reject(new AppError(
        'Numărul mesei trebuie să fie un număr întreg pozitiv.',
        400,
        'INVALID_TABLE_NUMBER'
      ));
    }

    if (!restaurantId) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const ordersDb = getOrdersDb(tenantId);
    ordersDb.find({ restaurantId, masa })
      .sort({ createdAt: -1 })
      .exec((err, orders) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea comenzilor după masă: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        resolve(orders || []);
      });
  });
}

/**
 * Găsește comenzile procesate de un anumit ospătar.
 * @param {string} ospatar - Numele/ID-ul ospătarului
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>}
 */
function findOrdersByWaiter(ospatar, restaurantId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!ospatar || !isValidString(ospatar, 1, 200)) {
      return reject(new AppError(
        'Ospătarul trebuie să fie un șir de caractere valid.',
        400,
        'INVALID_WAITER'
      ));
    }

    if (!restaurantId) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const ordersDb = getOrdersDb(tenantId);
    ordersDb.find({ restaurantId, ospatar })
      .sort({ createdAt: -1 })
      .exec((err, orders) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea comenzilor după ospătar: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        resolve(orders || []);
      });
  });
}

/**
 * Actualizează o comandă.
 * @param {string} id - ID-ul comenzii
 * @param {Object} updateData - Câmpurile de actualizat
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateOrder(id, updateData, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
      return reject(new AppError(
        'Nu s-au furnizat date pentru actualizare.',
        400,
        'EMPTY_UPDATE_DATA'
      ));
    }

    // -----------------------------------------------------------------------
    // Câmpuri permise pentru actualizare
    // -----------------------------------------------------------------------
    const allowedFields = [
      'articole', 'status', 'total', 'metodaPlata',
      'ospatar', 'masa', 'taxaServiciu', 'discount', 'note',
    ];
    const setFields = {};
    const errors = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (!allowedFields.includes(key)) {
        continue;
      }

      switch (key) {
        case 'status':
          if (!isValidOrderStatus(value)) {
            errors.push(`Statusul "${value}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`);
          } else {
            setFields.status = value;
          }
          break;

        case 'articole':
          if (!Array.isArray(value)) {
            errors.push('Articolele trebuie să fie o listă.');
          } else if (value.length === 0) {
            errors.push('Comanda trebuie să conțină cel puțin un articol.');
          } else {
            const valResult = validateItems(value);
            if (!valResult.valid) {
              errors.push(valResult.errors.join(' '));
            } else {
              // Recalculăm totalul și subtotalurile
              const articoleActualizate = value.map((a) => ({
                menuItemId: a.menuItemId,
                nume: a.nume.trim(),
                cantitate: a.cantitate,
                pret: a.pret,
                subtotal: a.subtotal !== undefined && a.subtotal !== null
                  ? a.subtotal
                  : calculateItemSubtotal(a),
                note: a.note || '',
              }));

              setFields.articole = articoleActualizate;

              // Recalculăm totalurile
              const currentTaxa = setFields.taxaServiciu !== undefined
                ? setFields.taxaServiciu
                : (updateData.taxaServiciu || 0);
              const currentDiscount = setFields.discount !== undefined
                ? setFields.discount
                : (updateData.discount || 0);

              const newTotals = calculateOrderTotal(articoleActualizate, currentTaxa, currentDiscount);
              setFields.subtotal = newTotals.subtotal;
              setFields.taxaServiciuValoare = newTotals.taxaServiciuValoare;
              setFields.total = newTotals.total;
            }
          }
          break;

        case 'total':
          if (value !== null && value !== undefined && !isValidPrice(value)) {
            errors.push('Totalul trebuie să fie un număr pozitiv.');
          } else if (value !== null && value !== undefined) {
            setFields.total = +value.toFixed(2);
          }
          break;

        case 'metodaPlata':
          if (value && !isValidPaymentMethod(value)) {
            errors.push(`Metoda de plată "${value}" nu este validă.`);
          } else {
            setFields.metodaPlata = value || '';
          }
          break;

        case 'ospatar':
          if (value && !isValidString(value, 1, 200)) {
            errors.push('Ospătarul poate avea maximum 200 de caractere.');
          } else {
            setFields.ospatar = value || '';
          }
          break;

        case 'masa':
          if (value !== undefined && value !== null && value !== 0 && !isValidTableNumber(value)) {
            errors.push('Numărul mesei trebuie să fie un număr întreg pozitiv.');
          } else {
            setFields.masa = value || 0;
          }
          break;

        case 'taxaServiciu':
          if (typeof value !== 'number' || value < 0 || value > 100) {
            errors.push('Taxa serviciu trebuie să fie un procent între 0 și 100.');
          } else {
            setFields.taxaServiciu = value;
            // Recalculăm taxa serviciu valoare dacă avem articole
            const itemsForCalc = setFields.articole || null;
            if (itemsForCalc) {
              const currentDiscount = setFields.discount !== undefined
                ? setFields.discount
                : (updateData.discount || 0);
              const newTotals = calculateOrderTotal(itemsForCalc, value, currentDiscount);
              setFields.subtotal = newTotals.subtotal;
              setFields.taxaServiciuValoare = newTotals.taxaServiciuValoare;
              setFields.total = newTotals.total;
            }
          }
          break;

        case 'discount':
          if (typeof value !== 'number' || value < 0) {
            errors.push('Discountul trebuie să fie un număr pozitiv.');
          } else {
            setFields.discount = value;
            // Recalculăm totalurile dacă avem articole
            const itemsForCalc = setFields.articole || null;
            if (itemsForCalc) {
              const currentTaxa = setFields.taxaServiciu !== undefined
                ? setFields.taxaServiciu
                : (updateData.taxaServiciu || 0);
              const newTotals = calculateOrderTotal(itemsForCalc, currentTaxa, value);
              setFields.subtotal = newTotals.subtotal;
              setFields.taxaServiciuValoare = newTotals.taxaServiciuValoare;
              setFields.total = newTotals.total;
            }
          }
          break;

        case 'note':
          if (value !== null && value !== undefined && String(value).length > 2000) {
            errors.push('Notele pot avea maximum 2000 de caractere.');
          } else {
            setFields.note = value !== null && value !== undefined ? String(value) : '';
          }
          break;

        // No default
      }
    }

    if (errors.length > 0) {
      return reject(new AppError(errors.join(' '), 400, 'VALIDATION_ERROR'));
    }

    if (Object.keys(setFields).length === 0) {
      return reject(new AppError(
        'Nu s-au furnizat câmpuri valide pentru actualizare.',
        400,
        'NO_VALID_FIELDS'
      ));
    }

    // -----------------------------------------------------------------------
    // Actualizare document
    // -----------------------------------------------------------------------
    setFields.updatedAt = new Date().toISOString();

    const ordersDb = getOrdersDb(tenantId);
    ordersDb.update(
      { _id: id },
      { $set: setFields },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedOrder) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea comenzii: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND'));
        }

        resolve(updatedOrder);
      }
    );
  });
}

/**
 * Actualizează statusul unei comenzi.
 * @param {string} id - ID-ul comenzii
 * @param {string} status - Noul status
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>}
 */
function updateOrderStatus(id, status, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
    }

    if (!status || !isValidOrderStatus(status)) {
      return reject(new AppError(
        `Statusul "${status}" nu este valid. Statusuri permise: ${VALID_ORDER_STATUSES.join(', ')}.`,
        400,
        'INVALID_ORDER_STATUS'
      ));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const ordersDb = getOrdersDb(tenantId);
    ordersDb.update(
      { _id: id },
      {
        $set: {
          status,
          updatedAt: new Date().toISOString(),
        },
      },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedOrder) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea statusului comenzii: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND'));
        }

        resolve(updatedOrder);
      }
    );
  });
}

/**
 * Actualizează metoda de plată a unei comenzi.
 * @param {string} id - ID-ul comenzii
 * @param {string} metodaPlata - Noua metodă de plată
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>}
 */
function updateOrderPaymentMethod(id, metodaPlata, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
    }

    if (!metodaPlata || !isValidPaymentMethod(metodaPlata)) {
      return reject(new AppError(
        `Metoda de plată "${metodaPlata}" nu este validă. ` +
        `Metode permise: ${VALID_PAYMENT_METHODS.join(', ')}.`,
        400,
        'INVALID_PAYMENT_METHOD'
      ));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const ordersDb = getOrdersDb(tenantId);
    ordersDb.update(
      { _id: id },
      {
        $set: {
          metodaPlata,
          updatedAt: new Date().toISOString(),
        },
      },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedOrder) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea metodei de plată: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND'));
        }

        resolve(updatedOrder);
      }
    );
  });
}

/**
 * Adaugă un articol la o comandă existentă.
 * @param {string} id - ID-ul comenzii
 * @param {Object} articol - Articolul de adăugat
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>}
 */
function addOrderItem(id, articol, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
    }

    if (!articol || typeof articol !== 'object') {
      return reject(new AppError('Articolul este invalid.', 400, 'INVALID_ITEM'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    // Validare articol individual
    const itemValidation = validateItems([articol]);
    if (!itemValidation.valid) {
      return reject(new AppError(
        itemValidation.errors.join(' '),
        400,
        'INVALID_ITEM'
      ));
    }

    const ordersDb = getOrdersDb(tenantId);

    // Găsim comanda existentă
    ordersDb.findOne({ _id: id }, (findErr, order) => {
      if (findErr) {
        return reject(new AppError(
          `Eroare la căutarea comenzii: ${findErr.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      if (!order) {
        return reject(new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND'));
      }

      // Construim noul articol
      const newItem = {
        menuItemId: articol.menuItemId,
        nume: articol.nume.trim(),
        cantitate: articol.cantitate,
        pret: articol.pret,
        subtotal: articol.subtotal !== undefined && articol.subtotal !== null
          ? articol.subtotal
          : calculateItemSubtotal(articol),
        note: articol.note || '',
      };

      // Adăugăm articolul la lista existentă
      const updatedItems = [...order.articole, newItem];

      // Recalculăm totalurile
      const newTotals = calculateOrderTotal(
        updatedItems,
        order.taxaServiciu || 0,
        order.discount || 0
      );

      const updateFields = {
        articole: updatedItems,
        subtotal: newTotals.subtotal,
        taxaServiciuValoare: newTotals.taxaServiciuValoare,
        total: newTotals.total,
        updatedAt: new Date().toISOString(),
      };

      ordersDb.update(
        { _id: id },
        { $set: updateFields },
        { returnUpdatedDocs: true },
        (updateErr, numUpdated, updatedOrder) => {
          if (updateErr) {
            return reject(new AppError(
              `Eroare la actualizarea comenzii: ${updateErr.message}`,
              500,
              'DB_UPDATE_ERROR'
            ));
          }

          if (numUpdated === 0) {
            return reject(new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND'));
          }

          resolve(updatedOrder);
        }
      );
    });
  });
}

/**
 * Elimină un articol dintr-o comandă existentă.
 * @param {string} id - ID-ul comenzii
 * @param {string} menuItemId - ID-ul articolului de eliminat
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>}
 */
function removeOrderItem(id, menuItemId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
    }

    if (!menuItemId || typeof menuItemId !== 'string') {
      return reject(new AppError('ID-ul articolului este invalid.', 400, 'INVALID_MENU_ITEM_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const ordersDb = getOrdersDb(tenantId);

    ordersDb.findOne({ _id: id }, (findErr, order) => {
      if (findErr) {
        return reject(new AppError(
          `Eroare la căutarea comenzii: ${findErr.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      if (!order) {
        return reject(new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND'));
      }

      // Filtrăm articolul cu menuItemId specificat
      const updatedItems = order.articole.filter(
        (item) => item.menuItemId !== menuItemId
      );

      if (updatedItems.length === order.articole.length) {
        return reject(new AppError(
          'Articolul nu a fost găsit în comandă.',
          404,
          'ITEM_NOT_FOUND'
        ));
      }

      // Dacă nu mai rămân articole, returnăm eroare
      if (updatedItems.length === 0) {
        return reject(new AppError(
          'Comanda trebuie să conțină cel puțin un articol. Ștergeți comanda în loc să eliminați ultimul articol.',
          400,
          'LAST_ITEM'
        ));
      }

      // Recalculăm totalurile
      const newTotals = calculateOrderTotal(
        updatedItems,
        order.taxaServiciu || 0,
        order.discount || 0
      );

      const updateFields = {
        articole: updatedItems,
        subtotal: newTotals.subtotal,
        taxaServiciuValoare: newTotals.taxaServiciuValoare,
        total: newTotals.total,
        updatedAt: new Date().toISOString(),
      };

      ordersDb.update(
        { _id: id },
        { $set: updateFields },
        { returnUpdatedDocs: true },
        (updateErr, numUpdated, updatedOrder) => {
          if (updateErr) {
            return reject(new AppError(
              `Eroare la actualizarea comenzii: ${updateErr.message}`,
              500,
              'DB_UPDATE_ERROR'
            ));
          }

          if (numUpdated === 0) {
            return reject(new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND'));
          }

          resolve(updatedOrder);
        }
      );
    });
  });
}

/**
 * Șterge o comandă după ID.
 * @param {string} id - ID-ul comenzii
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>} Numărul de documente șterse
 */
function deleteOrder(id, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul comenzii este invalid.', 400, 'INVALID_ORDER_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const ordersDb = getOrdersDb(tenantId);
    ordersDb.remove({ _id: id }, {}, (err, numRemoved) => {
      if (err) {
        return reject(new AppError(
          `Eroare la ștergerea comenzii: ${err.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      if (numRemoved === 0) {
        return reject(new AppError('Comanda nu a fost găsită.', 404, 'ORDER_NOT_FOUND'));
      }

      resolve(numRemoved);
    });
  });
}

/**
 * Șterge toate comenzile unui restaurant.
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>} Numărul de documente șterse
 */
function deleteAllOrdersByRestaurant(restaurantId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!restaurantId) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const ordersDb = getOrdersDb(tenantId);
    ordersDb.remove({ restaurantId }, { multi: true }, (err, numRemoved) => {
      if (err) {
        return reject(new AppError(
          `Eroare la ștergerea comenzilor: ${err.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      resolve(numRemoved);
    });
  });
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Constante
  VALID_ORDER_STATUSES,
  VALID_PAYMENT_METHODS,

  // Funcții de validare
  isValidString,
  isValidPrice,
  isValidOrderStatus,
  isValidPaymentMethod,
  isValidTableNumber,
  validateItems,
  calculateItemSubtotal,
  calculateOrderTotal,

  // Operații CRUD
  getOrdersDb,
  createOrder,
  findOrderById,
  findOrdersByRestaurant,
  findOrdersByStatus,
  findOrdersByTable,
  findOrdersByWaiter,
  updateOrder,
  updateOrderStatus,
  updateOrderPaymentMethod,
  addOrderItem,
  removeOrderItem,
  deleteOrder,
  deleteAllOrdersByRestaurant,
};