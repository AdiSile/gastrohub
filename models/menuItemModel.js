'use strict';

// ---------------------------------------------------------------------------
// Model MenuItem – GastroHub
// Definirea structurii, validărilor și operațiilor CRUD pentru itemele de meniu.
// Câmpuri suportate: categorie, nume, descriere, preț, alergeni, ingrediente,
// disponibilitate, tenantId, restaurantId
//
// Compatibilitate duală: verificarea restaurantului funcționează atât cu
// SQLite (via getDb()) cât și cu NeDB (via restaurants).
// Itemii de meniu sunt stocați per-tenant prin config/tenant.js.
// ---------------------------------------------------------------------------

const { restaurants, getDb } = require('../config/db');
const { getTenantDb } = require('../config/tenant');
const { AppError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Categorii predefinite de meniu
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = [
  'aperitiv',
  'fel principal',
  'desert',
  'băuturi',
  'gustări',
  'salate',
  'supe/ciorbă',
  'paste',
  'pizza',
  'pește',
  'carne',
  'vegetarian',
  'vegan',
  'mic dejun',
  'brunch',
  'cină',
  'bar',
  'cocktail',
  'vinuri',
  'bere',
  'cafea',
  'alte',
];

// ---------------------------------------------------------------------------
// Alergeni standard (Regulament UE 1169/2011 + extra)
// ---------------------------------------------------------------------------

const VALID_ALLERGENS = [
  'lactoză',
  'ouă',
  'arahide',
  'nuci',
  'migdale',
  'alune',
  'soia',
  'gluten',
  'crustacee',
  'pește',
  'sulfiți',
  'susan',
  'țelină',
  'muștar',
  'lupin',
  'moluște',
];

// ---------------------------------------------------------------------------
// Statusuri disponibilitate
// ---------------------------------------------------------------------------

const VALID_AVAILABILITY = ['available', 'unavailable', 'seasonal', 'temporary'];

// ---------------------------------------------------------------------------
// Detecție backend SQLite (compatibilitate cu restaurantModel.js)
// ---------------------------------------------------------------------------

let _sqlAvailable = null;

/**
 * Returnează `true` dacă SQLite este disponibil și inițializat.
 * Cache-uiește rezultatul după prima verificare.
 * @returns {boolean}
 */
function _isSqlAvailable() {
  if (_sqlAvailable !== null) return _sqlAvailable;
  try {
    getDb();
    _sqlAvailable = true;
  } catch (_e) {
    _sqlAvailable = false;
  }
  return _sqlAvailable;
}

/**
 * Verifică existența unui restaurant, folosind SQLite (dacă e disponibil)
 * sau NeDB ca fallback. Asigură compatibilitatea cu restaurantModel.js care
 * scrie în SQLite când acesta este inițializat.
 *
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<boolean>} `true` dacă restaurantul există
 * @throws {AppError} În caz de eroare de interogare
 */
function _restaurantExists(restaurantId, tenantId) {
  return new Promise((resolve, reject) => {
    // ---- SQLite ----
    if (_isSqlAvailable()) {
      try {
        const numericId = parseInt(restaurantId, 10);
        const sql = !isNaN(numericId)
          ? 'SELECT id FROM restaurants WHERE id = ? AND tenantId = ?'
          : 'SELECT id FROM restaurants WHERE CAST(id AS TEXT) = ? AND tenantId = ?';
        const param = !isNaN(numericId) ? numericId : String(restaurantId);

        // Folosim get() din config/db – import inline pentru a evita probleme
        // de circularitate (get este definit în config/db.js)
        const { get } = require('../config/db');
        const row = get(sql, [param, tenantId]);
        return resolve(!!row);
      } catch (sqlErr) {
        // Dacă SQLite eșuează, încercăm NeDB
      }
    }

    // ---- NeDB ----
    restaurants.findOne({ _id: restaurantId, tenantId }, (findErr, restaurant) => {
      if (findErr) {
        return reject(new AppError(
          `Eroare la verificarea restaurantului: ${findErr.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(!!restaurant);
    });
  });
}

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
 * Verifică dacă o valoare este un număr pozitiv (preț).
 * @param {*} val
 * @returns {boolean}
 */
function isValidPrice(val) {
  return typeof val === 'number' && !Number.isNaN(val) && val >= 0 && Number.isFinite(val);
}

/**
 * Verifică dacă o categorie este validă.
 * @param {string} category
 * @returns {boolean}
 */
function isValidCategory(category) {
  return VALID_CATEGORIES.includes(category);
}

/**
 * Verifică dacă o listă de alergeni este validă.
 * @param {Array} allergens
 * @returns {{ valid: boolean, invalidItems: string[] }}
 */
function validateAllergens(allergens) {
  if (!Array.isArray(allergens)) {
    return { valid: false, invalidItems: [] };
  }

  const invalidItems = allergens.filter((a) => !VALID_ALLERGENS.includes(a));
  return {
    valid: invalidItems.length === 0,
    invalidItems,
  };
}

/**
 * Verifică dacă statusul de disponibilitate este valid.
 * @param {string} availability
 * @returns {boolean}
 */
function isValidAvailability(availability) {
  return VALID_AVAILABILITY.includes(availability);
}

/**
 * Verifică dacă un array conține doar string-uri nevide.
 * @param {*} arr
 * @returns {boolean}
 */
function isValidStringArray(arr) {
  if (!Array.isArray(arr)) return false;
  return arr.every((item) => typeof item === 'string' && item.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Funcții de inițializare a colecției
// ---------------------------------------------------------------------------

/**
 * Obține colecția NeDB pentru itemele de meniu ale unui tenant.
 * Folosește baza de date per-tenant din config/tenant.js.
 * @param {string} tenantId
 * @returns {Datastore}
 */
function getMenuItemsDb(tenantId) {
  return getTenantDb(tenantId);
}

// ---------------------------------------------------------------------------
// Operații CRUD – Menu Items
// ---------------------------------------------------------------------------

/**
 * Creează un item de meniu nou.
 *
 * @param {Object} itemData - Datele itemului
 * @param {string} itemData.name - Numele itemului (obligatoriu)
 * @param {string} itemData.category - Categoria (obligatoriu)
 * @param {number} itemData.price - Prețul (obligatoriu)
 * @param {string} [itemData.description=''] - Descrierea
 * @param {Array} [itemData.allergens=[]] - Lista de alergeni
 * @param {Array} [itemData.ingredients=[]] - Lista de ingrediente
 * @param {string} [itemData.availability='available'] - Disponibilitate
 * @param {string} [itemData.imageUrl=''] - URL imagine
 * @param {string} itemData.tenantId - ID tenant (obligatoriu)
 * @param {string} itemData.restaurantId - ID restaurant (obligatoriu)
 * @returns {Promise<Object>} Documentul creat
 * @throws {AppError} Dacă validarea eșuează
 */
function createMenuItem(itemData) {
  return new Promise((resolve, reject) => {
    // Validare date de bază
    if (!itemData || typeof itemData !== 'object') {
      return reject(new AppError('Datele itemului de meniu sunt invalide.', 400, 'INVALID_MENU_ITEM_DATA'));
    }

    const { name, category, price, description, allergens, ingredients, availability, imageUrl, tenantId, restaurantId } = itemData;

    // Validare nume
    if (!name || !isValidString(name, 1, 200)) {
      return reject(new AppError(
        'Numele itemului trebuie să aibă între 1 și 200 de caractere.',
        400,
        'INVALID_MENU_ITEM_NAME'
      ));
    }

    // Validare categorie
    if (!category || !isValidCategory(category)) {
      return reject(new AppError(
        `Categoria "${category}" nu este validă. Categorii permise: ${VALID_CATEGORIES.join(', ')}.`,
        400,
        'INVALID_CATEGORY'
      ));
    }

    // Validare preț
    if (price === undefined || price === null || !isValidPrice(price)) {
      return reject(new AppError(
        'Prețul trebuie să fie un număr pozitiv.',
        400,
        'INVALID_PRICE'
      ));
    }

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

    // Validare descriere (opțional)
    const finalDescription = description !== undefined && description !== null ? description : '';
    if (finalDescription && !isValidString(finalDescription, 1, 2000)) {
      return reject(new AppError(
        'Descrierea poate avea maximum 2000 de caractere.',
        400,
        'INVALID_DESCRIPTION'
      ));
    }

    // Validare alergeni (opțional)
    const finalAllergens = Array.isArray(allergens) ? allergens : [];
    if (finalAllergens.length > 0) {
      const allergenValidation = validateAllergens(finalAllergens);
      if (!allergenValidation.valid) {
        return reject(new AppError(
          `Alergenii invalizi: ${allergenValidation.invalidItems.join(', ')}. ` +
          `Alergeni valizi: ${VALID_ALLERGENS.join(', ')}.`,
          400,
          'INVALID_ALLERGENS'
        ));
      }
    }

    // Validare ingrediente (opțional)
    const finalIngredients = Array.isArray(ingredients) ? ingredients : [];
    if (finalIngredients.length > 0 && !isValidStringArray(finalIngredients)) {
      return reject(new AppError(
        'Ingredientele trebuie să fie o listă de șiruri de caractere.',
        400,
        'INVALID_INGREDIENTS'
      ));
    }

    // Validare disponibilitate (opțional)
    const finalAvailability = availability || 'available';
    if (!isValidAvailability(finalAvailability)) {
      return reject(new AppError(
        `Disponibilitatea "${finalAvailability}" nu este validă. ` +
        `Valori permise: ${VALID_AVAILABILITY.join(', ')}.`,
        400,
        'INVALID_AVAILABILITY'
      ));
    }

    // Validare imageUrl (opțional)
    const finalImageUrl = imageUrl || '';

    // -----------------------------------------------------------------------
    // Verificare existență restaurant (compatibilă SQLite + NeDB)
    // -----------------------------------------------------------------------
    _restaurantExists(restaurantId, tenantId)
      .then((exists) => {
        if (!exists) {
          return reject(new AppError(
            'Restaurantul specificat nu există sau nu aparține acestui tenant.',
            404,
            'RESTAURANT_NOT_FOUND'
          ));
        }

        // -------------------------------------------------------------------
        // Creare document menu item
        // -------------------------------------------------------------------
        const menuItemDoc = {
          name: name.trim(),
          category,
          price,
          description: typeof finalDescription === 'string' ? finalDescription.trim() : '',
          allergens: finalAllergens,
          ingredients: finalIngredients.map((i) => i.trim()),
          availability: finalAvailability,
          imageUrl: finalImageUrl,
          tenantId,
          restaurantId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const menuDb = getMenuItemsDb(tenantId);
        menuDb.insert(menuItemDoc, (insertErr, newItem) => {
          if (insertErr) {
            return reject(new AppError(
              `Eroare la crearea itemului de meniu: ${insertErr.message}`,
              500,
              'DB_INSERT_ERROR'
            ));
          }

          resolve(newItem);
        });
      })
      .catch((err) => {
        reject(err instanceof AppError ? err : new AppError(
          `Eroare la verificarea restaurantului: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      });
  });
}

/**
 * Găsește un item de meniu după ID.
 * @param {string} id - ID-ul NeDB
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object|null>}
 */
function findMenuItemById(id, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul itemului de meniu este invalid.', 400, 'INVALID_MENU_ITEM_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const menuDb = getMenuItemsDb(tenantId);
    menuDb.findOne({ _id: id }, (err, item) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea itemului de meniu: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }
      resolve(item || null);
    });
  });
}

/**
 * Găsește toate itemele de meniu dintr-un restaurant.
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni (sort, limit, skip, category)
 * @returns {Promise<Array>}
 */
function findMenuItemsByRestaurant(restaurantId, tenantId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!restaurantId) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const filter = { restaurantId };

    // Filtrare opțională după categorie
    if (options.category) {
      if (!isValidCategory(options.category)) {
        return reject(new AppError(
          `Categoria "${options.category}" nu este validă.`,
          400,
          'INVALID_CATEGORY'
        ));
      }
      filter.category = options.category;
    }

    // Filtrare opțională după disponibilitate
    if (options.availability) {
      if (!isValidAvailability(options.availability)) {
        return reject(new AppError(
          `Disponibilitatea "${options.availability}" nu este validă.`,
          400,
          'INVALID_AVAILABILITY'
        ));
      }
      filter.availability = options.availability;
    }

    const menuDb = getMenuItemsDb(tenantId);
    let query = menuDb.find(filter);

    // Sortare
    if (options.sort) {
      query = query.sort(options.sort);
    } else {
      query = query.sort({ category: 1, name: 1 });
    }

    // Limit
    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      query = query.limit(options.limit);
    }

    // Skip
    if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
      query = query.skip(options.skip);
    }

    query.exec((err, items) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea itemelor de meniu: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(items || []);
    });
  });
}

/**
 * Găsește toate itemele de meniu dintr-o categorie specifică.
 * @param {string} category - Categoria
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>}
 */
function findMenuItemsByCategory(category, restaurantId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!category || !isValidCategory(category)) {
      return reject(new AppError(
        `Categoria "${category}" nu este validă. Categorii permise: ${VALID_CATEGORIES.join(', ')}.`,
        400,
        'INVALID_CATEGORY'
      ));
    }

    if (!restaurantId) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const menuDb = getMenuItemsDb(tenantId);
    menuDb.find({ restaurantId, category }).sort({ name: 1 }).exec((err, items) => {
      if (err) {
        return reject(new AppError(
          `Eroare la căutarea itemelor pe categorie: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      resolve(items || []);
    });
  });
}

/**
 * Găsește iteme de meniu care conțin un anumit alergen.
 * @param {string} allergen - Alergenul căutat
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>}
 */
function findMenuItemsByAllergen(allergen, restaurantId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!allergen || !VALID_ALLERGENS.includes(allergen)) {
      return reject(new AppError(
        `Alergenul "${allergen}" nu este valid. Alergeni valizi: ${VALID_ALLERGENS.join(', ')}.`,
        400,
        'INVALID_ALLERGEN'
      ));
    }

    if (!restaurantId) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const menuDb = getMenuItemsDb(tenantId);
    menuDb.find({ restaurantId, allergens: { $regex: new RegExp(`^${allergen}$`, 'i') } })
      .sort({ name: 1 })
      .exec((err, items) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea itemelor după alergen: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        resolve(items || []);
      });
  });
}

/**
 * Actualizează un item de meniu.
 * @param {string} id - ID-ul itemului
 * @param {Object} updateData - Câmpurile de actualizat
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Documentul actualizat
 */
function updateMenuItem(id, updateData, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul itemului de meniu este invalid.', 400, 'INVALID_MENU_ITEM_ID'));
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
    const allowedFields = ['name', 'category', 'price', 'description', 'allergens', 'ingredients', 'availability', 'imageUrl'];
    const setFields = {};
    const errors = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (!allowedFields.includes(key)) {
        continue;
      }

      switch (key) {
        case 'name':
          if (!isValidString(value, 1, 200)) {
            errors.push('Numele itemului trebuie să aibă între 1 și 200 de caractere.');
          } else {
            setFields.name = value.trim();
          }
          break;

        case 'category':
          if (!isValidCategory(value)) {
            errors.push(`Categoria "${value}" nu este validă.`);
          } else {
            setFields.category = value;
          }
          break;

        case 'price':
          if (!isValidPrice(value)) {
            errors.push('Prețul trebuie să fie un număr pozitiv.');
          } else {
            setFields.price = value;
          }
          break;

        case 'description':
          if (value !== null && value !== undefined && !isValidString(value, 1, 2000)) {
            errors.push('Descrierea poate avea maximum 2000 de caractere.');
          } else {
            setFields.description = value ? value.trim() : '';
          }
          break;

        case 'allergens':
          if (!Array.isArray(value)) {
            errors.push('Alergenii trebuie să fie o listă.');
          } else {
            const validation = validateAllergens(value);
            if (!validation.valid) {
              errors.push(`Alergenii invalizi: ${validation.invalidItems.join(', ')}.`);
            } else {
              setFields.allergens = value;
            }
          }
          break;

        case 'ingredients':
          if (!Array.isArray(value) || !isValidStringArray(value)) {
            errors.push('Ingredientele trebuie să fie o listă de șiruri de caractere.');
          } else {
            setFields.ingredients = value.map((i) => i.trim());
          }
          break;

        case 'availability':
          if (!isValidAvailability(value)) {
            errors.push(`Disponibilitatea "${value}" nu este validă.`);
          } else {
            setFields.availability = value;
          }
          break;

        case 'imageUrl':
          setFields.imageUrl = value || '';
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

    const menuDb = getMenuItemsDb(tenantId);
    menuDb.update(
      { _id: id },
      { $set: setFields },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedItem) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea itemului de meniu: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Itemul de meniu nu a fost găsit.', 404, 'MENU_ITEM_NOT_FOUND'));
        }

        resolve(updatedItem);
      }
    );
  });
}

/**
 * Actualizează prețul unui item de meniu.
 * @param {string} id - ID-ul itemului
 * @param {number} price - Noul preț
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>}
 */
function updateMenuItemPrice(id, price, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul itemului de meniu este invalid.', 400, 'INVALID_MENU_ITEM_ID'));
    }

    if (!isValidPrice(price)) {
      return reject(new AppError('Prețul trebuie să fie un număr pozitiv.', 400, 'INVALID_PRICE'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const menuDb = getMenuItemsDb(tenantId);
    menuDb.update(
      { _id: id },
      {
        $set: {
          price,
          updatedAt: new Date().toISOString(),
        },
      },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedItem) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea prețului: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Itemul de meniu nu a fost găsit.', 404, 'MENU_ITEM_NOT_FOUND'));
        }

        resolve(updatedItem);
      }
    );
  });
}

/**
 * Actualizează disponibilitatea unui item de meniu.
 * @param {string} id - ID-ul itemului
 * @param {string} availability - Noul status de disponibilitate
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>}
 */
function updateMenuItemAvailability(id, availability, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul itemului de meniu este invalid.', 400, 'INVALID_MENU_ITEM_ID'));
    }

    if (!availability || !isValidAvailability(availability)) {
      return reject(new AppError(
        `Disponibilitatea "${availability}" nu este validă. Valori permise: ${VALID_AVAILABILITY.join(', ')}.`,
        400,
        'INVALID_AVAILABILITY'
      ));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const menuDb = getMenuItemsDb(tenantId);
    menuDb.update(
      { _id: id },
      {
        $set: {
          availability,
          updatedAt: new Date().toISOString(),
        },
      },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedItem) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea disponibilității: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Itemul de meniu nu a fost găsit.', 404, 'MENU_ITEM_NOT_FOUND'));
        }

        resolve(updatedItem);
      }
    );
  });
}

/**
 * Actualizează alergenii unui item de meniu.
 * @param {string} id - ID-ul itemului
 * @param {Array} allergens - Noua listă de alergeni
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>}
 */
function updateMenuItemAllergens(id, allergens, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul itemului de meniu este invalid.', 400, 'INVALID_MENU_ITEM_ID'));
    }

    if (!Array.isArray(allergens)) {
      return reject(new AppError('Alergenii trebuie să fie o listă.', 400, 'INVALID_ALLERGENS'));
    }

    const validation = validateAllergens(allergens);
    if (!validation.valid) {
      return reject(new AppError(
        `Alergenii invalizi: ${validation.invalidItems.join(', ')}. ` +
        `Alergeni valizi: ${VALID_ALLERGENS.join(', ')}.`,
        400,
        'INVALID_ALLERGENS'
      ));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const menuDb = getMenuItemsDb(tenantId);
    menuDb.update(
      { _id: id },
      {
        $set: {
          allergens,
          updatedAt: new Date().toISOString(),
        },
      },
      { returnUpdatedDocs: true },
      (updateErr, numUpdated, updatedItem) => {
        if (updateErr) {
          return reject(new AppError(
            `Eroare la actualizarea alergenilor: ${updateErr.message}`,
            500,
            'DB_UPDATE_ERROR'
          ));
        }

        if (numUpdated === 0) {
          return reject(new AppError('Itemul de meniu nu a fost găsit.', 404, 'MENU_ITEM_NOT_FOUND'));
        }

        resolve(updatedItem);
      }
    );
  });
}

/**
 * Șterge un item de meniu.
 * @param {string} id - ID-ul itemului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<boolean>}
 */
function deleteMenuItem(id, tenantId) {
  return new Promise((resolve, reject) => {
    if (!id) {
      return reject(new AppError('ID-ul itemului de meniu este invalid.', 400, 'INVALID_MENU_ITEM_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const menuDb = getMenuItemsDb(tenantId);
    menuDb.remove({ _id: id }, {}, (removeErr, numRemoved) => {
      if (removeErr) {
        return reject(new AppError(
          `Eroare la ștergerea itemului de meniu: ${removeErr.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      if (numRemoved === 0) {
        return reject(new AppError('Itemul de meniu nu a fost găsit.', 404, 'MENU_ITEM_NOT_FOUND'));
      }

      resolve(true);
    });
  });
}

/**
 * Șterge toate itemele de meniu ale unui restaurant.
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>} Numărul de iteme șterse
 */
function deleteAllMenuItemsByRestaurant(restaurantId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!restaurantId) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const menuDb = getMenuItemsDb(tenantId);
    menuDb.remove({ restaurantId }, { multi: true }, (removeErr, numRemoved) => {
      if (removeErr) {
        return reject(new AppError(
          `Eroare la ștergerea itemelor de meniu: ${removeErr.message}`,
          500,
          'DB_DELETE_ERROR'
        ));
      }

      resolve(numRemoved || 0);
    });
  });
}

/**
 * Obține numărul total de iteme de meniu dintr-un restaurant.
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>}
 */
function countMenuItemsByRestaurant(restaurantId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!restaurantId) {
      return resolve(0);
    }

    if (!tenantId) {
      return resolve(0);
    }

    const menuDb = getMenuItemsDb(tenantId);
    menuDb.count({ restaurantId }, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea itemelor de meniu: ${err.message}`,
          500,
          'DB_COUNT_ERROR'
        ));
      }
      resolve(count || 0);
    });
  });
}

/**
 * Obține numărul de iteme de meniu dintr-o categorie.
 * @param {string} category - Categoria
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>}
 */
function countMenuItemsByCategory(category, restaurantId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!category || !isValidCategory(category)) {
      return reject(new AppError(
        `Categoria "${category}" nu este validă.`,
        400,
        'INVALID_CATEGORY'
      ));
    }

    if (!restaurantId) {
      return resolve(0);
    }

    if (!tenantId) {
      return resolve(0);
    }

    const menuDb = getMenuItemsDb(tenantId);
    menuDb.count({ restaurantId, category }, (err, count) => {
      if (err) {
        return reject(new AppError(
          `Eroare la numărarea itemelor pe categorie: ${err.message}`,
          500,
          'DB_COUNT_ERROR'
        ));
      }
      resolve(count || 0);
    });
  });
}

/**
 * Caută iteme de meniu după nume (căutare parțială, case-insensitive).
 * @param {string} searchTerm - Termenul de căutare
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>}
 */
function searchMenuItemsByName(searchTerm, restaurantId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
      return reject(new AppError(
        'Termenul de căutare este invalid.',
        400,
        'INVALID_SEARCH_TERM'
      ));
    }

    if (!restaurantId) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    // Regex pentru căutare parțială, case-insensitive
    const regex = new RegExp(searchTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const menuDb = getMenuItemsDb(tenantId);
    menuDb.find({ restaurantId, name: regex })
      .sort({ name: 1 })
      .exec((err, items) => {
        if (err) {
          return reject(new AppError(
            `Eroare la căutarea itemelor de meniu: ${err.message}`,
            500,
            'DB_QUERY_ERROR'
          ));
        }

        resolve(items || []);
      });
  });
}

/**
 * Obține toate categoriile disponibile (listă de categorii care au cel puțin un item).
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>}
 */
function getMenuCategories(restaurantId, tenantId) {
  return new Promise((resolve, reject) => {
    if (!restaurantId) {
      return reject(new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID'));
    }

    if (!tenantId) {
      return reject(new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID'));
    }

    const menuDb = getMenuItemsDb(tenantId);
    menuDb.find({ restaurantId }, (err, items) => {
      if (err) {
        return reject(new AppError(
          `Eroare la obținerea categoriilor: ${err.message}`,
          500,
          'DB_QUERY_ERROR'
        ));
      }

      // Extrage categorii unice
      const categories = [...new Set((items || []).map((item) => item.category).filter(Boolean))];
      resolve(categories.sort());
    });
  });
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Constante
  VALID_CATEGORIES,
  VALID_ALLERGENS,
  VALID_AVAILABILITY,

  // Funcții de validare
  isValidString,
  isValidPrice,
  isValidCategory,
  validateAllergens,
  isValidAvailability,
  isValidStringArray,

  // Operații CRUD
  createMenuItem,
  findMenuItemById,
  findMenuItemsByRestaurant,
  findMenuItemsByCategory,
  findMenuItemsByAllergen,
  updateMenuItem,
  updateMenuItemPrice,
  updateMenuItemAvailability,
  updateMenuItemAllergens,
  deleteMenuItem,
  deleteAllMenuItemsByRestaurant,
  countMenuItemsByRestaurant,
  countMenuItemsByCategory,
  searchMenuItemsByName,
  getMenuCategories,

  // Expunere pentru debugging / testare
  _isSqlAvailable,
  _restaurantExists,
  _resetSqlAvailable: function () { _sqlAvailable = null; },
};