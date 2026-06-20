'use strict';

// ---------------------------------------------------------------------------
// Model MenuItem – GastroHub
// Definirea structurii, validărilor și operațiilor CRUD pentru itemele de meniu.
// Câmpuri suportate: categorie, nume, descriere, preț, alergeni, ingrediente,
// disponibilitate, tenantId, restaurantId
//
// Toate operațiile CRUD folosesc SQLite via config/db (getDb → db.run / db.exec).
// Tabela: menu_items
// ---------------------------------------------------------------------------

const getDb = require('../config/db');
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
// Helpers pentru operații SQLite directe pe instanța db (sql.js)
// ---------------------------------------------------------------------------

/**
 * Execută o interogare SELECT și returnează primul rând ca obiect,
 * sau `undefined` dacă nu există rezultate.
 *
 * @param {import('sql.js').Database} db - Instanța bazei de date
 * @param {string} sql - Interogarea SQL
 * @param {Array} [params=[]] - Parametrii
 * @returns {Object|undefined}
 */
function _dbGet(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    if (params.length > 0) {
      stmt.bind(params);
    }
    if (stmt.step()) {
      return stmt.getAsObject();
    }
    return undefined;
  } finally {
    stmt.free();
  }
}

/**
 * Execută o interogare SELECT și returnează toate rândurile ca array de obiecte.
 *
 * @param {import('sql.js').Database} db - Instanța bazei de date
 * @param {string} sql - Interogarea SQL
 * @param {Array} [params=[]] - Parametrii
 * @returns {Array<Object>}
 */
function _dbAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    if (params.length > 0) {
      stmt.bind(params);
    }
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  } finally {
    stmt.free();
  }
}

/**
 * Execută o instrucțiune INSERT / UPDATE / DELETE și returnează
 * `{ changes, lastInsertRowid }`.
 *
 * @param {import('sql.js').Database} db - Instanța bazei de date
 * @param {string} sql - Instrucțiunea SQL
 * @param {Array} [params=[]] - Parametrii
 * @returns {{ changes: number, lastInsertRowid: number }}
 */
function _dbRun(db, sql, params = []) {
  db.run(sql, params);

  const lastIdResult = db.exec('SELECT last_insert_rowid() AS id');
  const changesResult = db.exec('SELECT changes() AS cnt');

  const lastInsertRowid =
    lastIdResult.length > 0 && lastIdResult[0].values.length > 0
      ? lastIdResult[0].values[0][0]
      : 0;

  const changes =
    changesResult.length > 0 && changesResult[0].values.length > 0
      ? changesResult[0].values[0][0]
      : 0;

  return { changes, lastInsertRowid };
}

// ---------------------------------------------------------------------------
// Verificare existență restaurant (SQL pur)
// ---------------------------------------------------------------------------

/**
 * Verifică existența unui restaurant în tabela `restaurants` (SQLite).
 *
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId   - ID-ul tenant-ului
 * @returns {Promise<boolean>} `true` dacă restaurantul există
 * @throws {AppError} În caz de eroare de interogare
 */
async function _restaurantExists(restaurantId, tenantId) {
  try {
    const db = await getDb();
    const numericId = parseInt(restaurantId, 10);
    const sql = !isNaN(numericId)
      ? 'SELECT id FROM restaurants WHERE id = ? AND tenantId = ?'
      : 'SELECT id FROM restaurants WHERE CAST(id AS TEXT) = ? AND tenantId = ?';
    const param = !isNaN(numericId) ? numericId : String(restaurantId);

    const row = _dbGet(db, sql, [param, tenantId]);
    return !!row;
  } catch (err) {
    throw new AppError(
      `Eroare la verificarea restaurantului: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
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
// Helpers pentru conversie rând SQL → obiect model (și invers)
// ---------------------------------------------------------------------------

/**
 * Parsează coloana `allergens` (JSON TEXT) într-un array.
 * @param {string|null} raw
 * @returns {string[]}
 */
function _parseAllergens(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

/**
 * Convertește un rând SQL (obiect) într-un obiect menu item compatibil
 * cu interfața publică. Adaugă câmpurile istorice: `ingredients: []`,
 * `imageUrl` (mapat din `image`), `availability` (mapat din `status`).
 *
 * @param {Object} row - Rândul SQL brut
 * @returns {Object} Obiectul menu item normalizat
 */
function _rowToMenuItem(row) {
  if (!row) return null;
  return {
    id: row.id !== undefined ? String(row.id) : row._id,
    name: row.name,
    category: row.category,
    price: row.price,
    description: row.description || '',
    allergens: _parseAllergens(row.allergens),
    ingredients: [],  // Tabela curentă nu are coloană dedicată
    availability: row.status || 'available',
    imageUrl: row.image || '',
    tenantId: row.tenantId,
    restaurantId: row.restaurantId,
    currency: row.currency || 'RON',
    isVegetarian: !!row.isVegetarian,
    isVegan: !!row.isVegan,
    isGlutenFree: !!row.isGlutenFree,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
 * @param {Array}  [itemData.allergens=[]] - Lista de alergeni
 * @param {Array}  [itemData.ingredients=[]] - Lista de ingrediente
 * @param {string} [itemData.availability='available'] - Disponibilitate
 * @param {string} [itemData.imageUrl=''] - URL imagine
 * @param {string} itemData.tenantId - ID tenant (obligatoriu)
 * @param {string} itemData.restaurantId - ID restaurant (obligatoriu)
 * @returns {Promise<Object>} Documentul creat
 * @throws {AppError} Dacă validarea eșuează
 */
async function createMenuItem(itemData) {
  // Validare date de bază
  if (!itemData || typeof itemData !== 'object') {
    throw new AppError('Datele itemului de meniu sunt invalide.', 400, 'INVALID_MENU_ITEM_DATA');
  }

  const {
    name,
    category,
    price,
    description,
    allergens,
    ingredients,
    availability,
    imageUrl,
    tenantId,
    restaurantId,
  } = itemData;

  // Validare nume
  if (!name || !isValidString(name, 1, 200)) {
    throw new AppError(
      'Numele itemului trebuie să aibă între 1 și 200 de caractere.',
      400,
      'INVALID_MENU_ITEM_NAME'
    );
  }

  // Validare categorie
  if (!category || !isValidCategory(category)) {
    throw new AppError(
      `Categoria "${category}" nu este validă. Categorii permise: ${VALID_CATEGORIES.join(', ')}.`,
      400,
      'INVALID_CATEGORY'
    );
  }

  // Validare preț
  if (price === undefined || price === null || !isValidPrice(price)) {
    throw new AppError(
      'Prețul trebuie să fie un număr pozitiv.',
      400,
      'INVALID_PRICE'
    );
  }

  // Validare tenantId
  if (!tenantId) {
    throw new AppError(
      'ID-ul tenant-ului este obligatoriu.',
      400,
      'MISSING_TENANT_ID'
    );
  }

  // Validare restaurantId
  if (!restaurantId) {
    throw new AppError(
      'ID-ul restaurantului este obligatoriu.',
      400,
      'MISSING_RESTAURANT_ID'
    );
  }

  // Validare descriere (opțional)
  const finalDescription = description !== undefined && description !== null ? description : '';
  if (finalDescription && !isValidString(finalDescription, 1, 2000)) {
    throw new AppError(
      'Descrierea poate avea maximum 2000 de caractere.',
      400,
      'INVALID_DESCRIPTION'
    );
  }

  // Validare alergeni (opțional)
  const finalAllergens = Array.isArray(allergens) ? allergens : [];
  if (finalAllergens.length > 0) {
    const allergenValidation = validateAllergens(finalAllergens);
    if (!allergenValidation.valid) {
      throw new AppError(
        `Alergenii invalizi: ${allergenValidation.invalidItems.join(', ')}. ` +
        `Alergeni valizi: ${VALID_ALLERGENS.join(', ')}.`,
        400,
        'INVALID_ALLERGENS'
      );
    }
  }

  // Validare ingrediente (opțional) – se validează chiar dacă nu persistăm
  const finalIngredients = Array.isArray(ingredients) ? ingredients : [];
  if (finalIngredients.length > 0 && !isValidStringArray(finalIngredients)) {
    throw new AppError(
      'Ingredientele trebuie să fie o listă de șiruri de caractere.',
      400,
      'INVALID_INGREDIENTS'
    );
  }

  // Validare disponibilitate (opțional) → se stochează în `status`
  const finalAvailability = availability || 'available';
  if (!isValidAvailability(finalAvailability)) {
    throw new AppError(
      `Disponibilitatea "${finalAvailability}" nu este validă. ` +
      `Valori permise: ${VALID_AVAILABILITY.join(', ')}.`,
      400,
      'INVALID_AVAILABILITY'
    );
  }

  // Validare imageUrl (opțional) → se stochează în `image`
  const finalImage = imageUrl || '';

  // -----------------------------------------------------------------------
  // Verificare existență restaurant (SQL)
  // -----------------------------------------------------------------------
  const exists = await _restaurantExists(restaurantId, tenantId);
  if (!exists) {
    throw new AppError(
      'Restaurantul specificat nu există sau nu aparține acestui tenant.',
      404,
      'RESTAURANT_NOT_FOUND'
    );
  }

  // -------------------------------------------------------------------
  // INSERT în tabela menu_items
  // -------------------------------------------------------------------
  try {
    const db = await getDb();
    const now = new Date().toISOString();
    const allergensJson = JSON.stringify(finalAllergens);

    const result = _dbRun(
      db,
      `INSERT INTO menu_items
         (tenantId, restaurantId, name, description, category, price,
          allergens, status, image, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        restaurantId,
        name.trim(),
        typeof finalDescription === 'string' ? finalDescription.trim() : '',
        category,
        price,
        allergensJson,
        finalAvailability,
        finalImage,
        now,
        now,
      ]
    );

    const insertedId = result.lastInsertRowid;

    // Citim înapoi rândul creat
    const row = _dbGet(db, 'SELECT * FROM menu_items WHERE id = ?', [insertedId]);
    if (!row) {
      throw new AppError(
        'Eroare la crearea itemului de meniu: documentul nu a putut fi citit după inserare.',
        500,
        'DB_INSERT_ERROR'
      );
    }

    return _rowToMenuItem(row);
  } catch (insertErr) {
    if (insertErr instanceof AppError) throw insertErr;
    throw new AppError(
      `Eroare la crearea itemului de meniu: ${insertErr.message}`,
      500,
      'DB_INSERT_ERROR'
    );
  }
}

/**
 * Găsește un item de meniu după ID.
 * @param {string} id - ID-ul itemului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object|null>}
 */
async function findMenuItemById(id, tenantId) {
  if (!id) {
    throw new AppError('ID-ul itemului de meniu este invalid.', 400, 'INVALID_MENU_ITEM_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const numericId = parseInt(id, 10);
    const row = !isNaN(numericId)
      ? _dbGet(db, 'SELECT * FROM menu_items WHERE id = ? AND tenantId = ?', [numericId, tenantId])
      : _dbGet(db, 'SELECT * FROM menu_items WHERE CAST(id AS TEXT) = ? AND tenantId = ?', [String(id), tenantId]);

    return _rowToMenuItem(row);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea itemului de meniu: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește toate itemele de meniu dintr-un restaurant.
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @param {Object} [options={}] - Opțiuni (sort, limit, skip, category, availability)
 * @returns {Promise<Array>}
 */
async function findMenuItemsByRestaurant(restaurantId, tenantId, options = {}) {
  if (!restaurantId) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const conditions = ['restaurantId = ?', 'tenantId = ?'];
    const params = [restaurantId, tenantId];

    // Filtrare opțională după categorie
    if (options.category) {
      if (!isValidCategory(options.category)) {
        throw new AppError(
          `Categoria "${options.category}" nu este validă.`,
          400,
          'INVALID_CATEGORY'
        );
      }
      conditions.push('category = ?');
      params.push(options.category);
    }

    // Filtrare opțională după disponibilitate (status)
    if (options.availability) {
      if (!isValidAvailability(options.availability)) {
        throw new AppError(
          `Disponibilitatea "${options.availability}" nu este validă.`,
          400,
          'INVALID_AVAILABILITY'
        );
      }
      conditions.push('status = ?');
      params.push(options.availability);
    }

    let sql = `SELECT * FROM menu_items WHERE ${conditions.join(' AND ')}`;

    // Sortare
    if (options.sort && typeof options.sort === 'object') {
      const sortClauses = Object.entries(options.sort).map(([col, dir]) => {
        const dirStr = String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        return `${col} ${dirStr}`;
      });
      sql += ` ORDER BY ${sortClauses.join(', ')}`;
    } else {
      sql += ' ORDER BY category ASC, name ASC';
    }

    // Limit
    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
      sql += ` LIMIT ${options.limit}`;
    }

    // Skip / OFFSET
    if (options.skip && Number.isInteger(options.skip) && options.skip > 0) {
      sql += ` OFFSET ${options.skip}`;
    }

    const rows = _dbAll(db, sql, params);
    return (rows || []).map(_rowToMenuItem);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      `Eroare la căutarea itemelor de meniu: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește toate itemele de meniu dintr-o categorie specifică.
 * @param {string} category - Categoria
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>}
 */
async function findMenuItemsByCategory(category, restaurantId, tenantId) {
  if (!category || !isValidCategory(category)) {
    throw new AppError(
      `Categoria "${category}" nu este validă. Categorii permise: ${VALID_CATEGORIES.join(', ')}.`,
      400,
      'INVALID_CATEGORY'
    );
  }

  if (!restaurantId) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const rows = _dbAll(
      db,
      'SELECT * FROM menu_items WHERE restaurantId = ? AND tenantId = ? AND category = ? ORDER BY name ASC',
      [restaurantId, tenantId, category]
    );
    return (rows || []).map(_rowToMenuItem);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea itemelor pe categorie: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Găsește iteme de meniu care conțin un anumit alergen.
 * @param {string} allergen - Alergenul căutat
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>}
 */
async function findMenuItemsByAllergen(allergen, restaurantId, tenantId) {
  if (!allergen || !VALID_ALLERGENS.includes(allergen)) {
    throw new AppError(
      `Alergenul "${allergen}" nu este valid. Alergeni valizi: ${VALID_ALLERGENS.join(', ')}.`,
      400,
      'INVALID_ALLERGEN'
    );
  }

  if (!restaurantId) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    // Căutare în câmpul JSON allergens folosind LIKE
    const rows = _dbAll(
      db,
      `SELECT * FROM menu_items
       WHERE restaurantId = ? AND tenantId = ? AND allergens LIKE ?
       ORDER BY name ASC`,
      [restaurantId, tenantId, `%${allergen}%`]
    );
    // Post-filtrare: verificăm că alergenul este exact în array-ul parsat
    const filtered = (rows || []).filter((row) => {
      const parsed = _parseAllergens(row.allergens);
      return parsed.some((a) => a.toLowerCase() === allergen.toLowerCase());
    });
    return filtered.map(_rowToMenuItem);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea itemelor după alergen: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Actualizează un item de meniu.
 * @param {string} id - ID-ul itemului
 * @param {Object} updateData - Câmpurile de actualizat
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>} Documentul actualizat
 */
async function updateMenuItem(id, updateData, tenantId) {
  if (!id) {
    throw new AppError('ID-ul itemului de meniu este invalid.', 400, 'INVALID_MENU_ITEM_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
    throw new AppError(
      'Nu s-au furnizat date pentru actualizare.',
      400,
      'EMPTY_UPDATE_DATA'
    );
  }

  // -----------------------------------------------------------------------
  // Câmpuri permise pentru actualizare
  // -----------------------------------------------------------------------
  const allowedFields = ['name', 'category', 'price', 'description', 'allergens', 'ingredients', 'availability', 'imageUrl'];
  const setClauses = [];
  const setParams = [];
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
          setClauses.push('name = ?');
          setParams.push(value.trim());
        }
        break;

      case 'category':
        if (!isValidCategory(value)) {
          errors.push(`Categoria "${value}" nu este validă.`);
        } else {
          setClauses.push('category = ?');
          setParams.push(value);
        }
        break;

      case 'price':
        if (!isValidPrice(value)) {
          errors.push('Prețul trebuie să fie un număr pozitiv.');
        } else {
          setClauses.push('price = ?');
          setParams.push(value);
        }
        break;

      case 'description':
        if (value !== null && value !== undefined && !isValidString(value, 1, 2000)) {
          errors.push('Descrierea poate avea maximum 2000 de caractere.');
        } else {
          setClauses.push('description = ?');
          setParams.push(value ? value.trim() : '');
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
            setClauses.push('allergens = ?');
            setParams.push(JSON.stringify(value));
          }
        }
        break;

      case 'ingredients':
        // Se validează dar nu se persistă (tabela curentă nu are coloana ingredients)
        if (!Array.isArray(value) || !isValidStringArray(value)) {
          errors.push('Ingredientele trebuie să fie o listă de șiruri de caractere.');
        }
        // Nu adăugăm în setClauses – coloana nu există
        break;

      case 'availability':
        if (!isValidAvailability(value)) {
          errors.push(`Disponibilitatea "${value}" nu este validă.`);
        } else {
          setClauses.push('status = ?');
          setParams.push(value);
        }
        break;

      case 'imageUrl':
        setClauses.push('image = ?');
        setParams.push(value || '');
        break;

      // No default
    }
  }

  if (errors.length > 0) {
    throw new AppError(errors.join(' '), 400, 'VALIDATION_ERROR');
  }

  if (setClauses.length === 0) {
    throw new AppError(
      'Nu s-au furnizat câmpuri valide pentru actualizare.',
      400,
      'NO_VALID_FIELDS'
    );
  }

  // -----------------------------------------------------------------------
  // UPDATE SQL
  // -----------------------------------------------------------------------
  try {
    const db = await getDb();
    const now = new Date().toISOString();
    setClauses.push('updatedAt = ?');
    setParams.push(now);

    // Construim clauza WHERE în funcție de tipul ID-ului
    const numericId = parseInt(id, 10);
    const whereClause = !isNaN(numericId)
      ? 'id = ? AND tenantId = ?'
      : 'CAST(id AS TEXT) = ? AND tenantId = ?';
    const whereParams = [!isNaN(numericId) ? numericId : String(id), tenantId];

    const result = _dbRun(
      db,
      `UPDATE menu_items SET ${setClauses.join(', ')} WHERE ${whereClause}`,
      [...setParams, ...whereParams]
    );

    if (result.changes === 0) {
      throw new AppError('Itemul de meniu nu a fost găsit.', 404, 'MENU_ITEM_NOT_FOUND');
    }

    // Citim rândul actualizat
    const row = !isNaN(numericId)
      ? _dbGet(db, 'SELECT * FROM menu_items WHERE id = ? AND tenantId = ?', [numericId, tenantId])
      : _dbGet(db, 'SELECT * FROM menu_items WHERE CAST(id AS TEXT) = ? AND tenantId = ?', [String(id), tenantId]);

    return _rowToMenuItem(row);
  } catch (updateErr) {
    if (updateErr instanceof AppError) throw updateErr;
    throw new AppError(
      `Eroare la actualizarea itemului de meniu: ${updateErr.message}`,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Actualizează prețul unui item de meniu.
 * @param {string} id - ID-ul itemului
 * @param {number} price - Noul preț
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>}
 */
async function updateMenuItemPrice(id, price, tenantId) {
  if (!id) {
    throw new AppError('ID-ul itemului de meniu este invalid.', 400, 'INVALID_MENU_ITEM_ID');
  }

  if (!isValidPrice(price)) {
    throw new AppError('Prețul trebuie să fie un număr pozitiv.', 400, 'INVALID_PRICE');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const now = new Date().toISOString();
    const numericId = parseInt(id, 10);
    const whereClause = !isNaN(numericId)
      ? 'id = ? AND tenantId = ?'
      : 'CAST(id AS TEXT) = ? AND tenantId = ?';
    const whereParams = [!isNaN(numericId) ? numericId : String(id), tenantId];

    const result = _dbRun(
      db,
      `UPDATE menu_items SET price = ?, updatedAt = ? WHERE ${whereClause}`,
      [price, now, ...whereParams]
    );

    if (result.changes === 0) {
      throw new AppError('Itemul de meniu nu a fost găsit.', 404, 'MENU_ITEM_NOT_FOUND');
    }

    const row = !isNaN(numericId)
      ? _dbGet(db, 'SELECT * FROM menu_items WHERE id = ? AND tenantId = ?', [numericId, tenantId])
      : _dbGet(db, 'SELECT * FROM menu_items WHERE CAST(id AS TEXT) = ? AND tenantId = ?', [String(id), tenantId]);

    return _rowToMenuItem(row);
  } catch (updateErr) {
    if (updateErr instanceof AppError) throw updateErr;
    throw new AppError(
      `Eroare la actualizarea prețului: ${updateErr.message}`,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Actualizează disponibilitatea unui item de meniu.
 * @param {string} id - ID-ul itemului
 * @param {string} availability - Noul status de disponibilitate
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>}
 */
async function updateMenuItemAvailability(id, availability, tenantId) {
  if (!id) {
    throw new AppError('ID-ul itemului de meniu este invalid.', 400, 'INVALID_MENU_ITEM_ID');
  }

  if (!availability || !isValidAvailability(availability)) {
    throw new AppError(
      `Disponibilitatea "${availability}" nu este validă. Valori permise: ${VALID_AVAILABILITY.join(', ')}.`,
      400,
      'INVALID_AVAILABILITY'
    );
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const now = new Date().toISOString();
    const numericId = parseInt(id, 10);
    const whereClause = !isNaN(numericId)
      ? 'id = ? AND tenantId = ?'
      : 'CAST(id AS TEXT) = ? AND tenantId = ?';
    const whereParams = [!isNaN(numericId) ? numericId : String(id), tenantId];

    const result = _dbRun(
      db,
      `UPDATE menu_items SET status = ?, updatedAt = ? WHERE ${whereClause}`,
      [availability, now, ...whereParams]
    );

    if (result.changes === 0) {
      throw new AppError('Itemul de meniu nu a fost găsit.', 404, 'MENU_ITEM_NOT_FOUND');
    }

    const row = !isNaN(numericId)
      ? _dbGet(db, 'SELECT * FROM menu_items WHERE id = ? AND tenantId = ?', [numericId, tenantId])
      : _dbGet(db, 'SELECT * FROM menu_items WHERE CAST(id AS TEXT) = ? AND tenantId = ?', [String(id), tenantId]);

    return _rowToMenuItem(row);
  } catch (updateErr) {
    if (updateErr instanceof AppError) throw updateErr;
    throw new AppError(
      `Eroare la actualizarea disponibilității: ${updateErr.message}`,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Actualizează alergenii unui item de meniu.
 * @param {string} id - ID-ul itemului
 * @param {Array} allergens - Noua listă de alergeni
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Object>}
 */
async function updateMenuItemAllergens(id, allergens, tenantId) {
  if (!id) {
    throw new AppError('ID-ul itemului de meniu este invalid.', 400, 'INVALID_MENU_ITEM_ID');
  }

  if (!Array.isArray(allergens)) {
    throw new AppError('Alergenii trebuie să fie o listă.', 400, 'INVALID_ALLERGENS');
  }

  const validation = validateAllergens(allergens);
  if (!validation.valid) {
    throw new AppError(
      `Alergenii invalizi: ${validation.invalidItems.join(', ')}. ` +
      `Alergeni valizi: ${VALID_ALLERGENS.join(', ')}.`,
      400,
      'INVALID_ALLERGENS'
    );
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const now = new Date().toISOString();
    const allergensJson = JSON.stringify(allergens);
    const numericId = parseInt(id, 10);
    const whereClause = !isNaN(numericId)
      ? 'id = ? AND tenantId = ?'
      : 'CAST(id AS TEXT) = ? AND tenantId = ?';
    const whereParams = [!isNaN(numericId) ? numericId : String(id), tenantId];

    const result = _dbRun(
      db,
      `UPDATE menu_items SET allergens = ?, updatedAt = ? WHERE ${whereClause}`,
      [allergensJson, now, ...whereParams]
    );

    if (result.changes === 0) {
      throw new AppError('Itemul de meniu nu a fost găsit.', 404, 'MENU_ITEM_NOT_FOUND');
    }

    const row = !isNaN(numericId)
      ? _dbGet(db, 'SELECT * FROM menu_items WHERE id = ? AND tenantId = ?', [numericId, tenantId])
      : _dbGet(db, 'SELECT * FROM menu_items WHERE CAST(id AS TEXT) = ? AND tenantId = ?', [String(id), tenantId]);

    return _rowToMenuItem(row);
  } catch (updateErr) {
    if (updateErr instanceof AppError) throw updateErr;
    throw new AppError(
      `Eroare la actualizarea alergenilor: ${updateErr.message}`,
      500,
      'DB_UPDATE_ERROR'
    );
  }
}

/**
 * Șterge un item de meniu.
 * @param {string} id - ID-ul itemului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<boolean>}
 */
async function deleteMenuItem(id, tenantId) {
  if (!id) {
    throw new AppError('ID-ul itemului de meniu este invalid.', 400, 'INVALID_MENU_ITEM_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const numericId = parseInt(id, 10);
    const whereClause = !isNaN(numericId)
      ? 'id = ? AND tenantId = ?'
      : 'CAST(id AS TEXT) = ? AND tenantId = ?';
    const whereParams = [!isNaN(numericId) ? numericId : String(id), tenantId];

    const result = _dbRun(
      db,
      `DELETE FROM menu_items WHERE ${whereClause}`,
      whereParams
    );

    if (result.changes === 0) {
      throw new AppError('Itemul de meniu nu a fost găsit.', 404, 'MENU_ITEM_NOT_FOUND');
    }

    return true;
  } catch (removeErr) {
    if (removeErr instanceof AppError) throw removeErr;
    throw new AppError(
      `Eroare la ștergerea itemului de meniu: ${removeErr.message}`,
      500,
      'DB_DELETE_ERROR'
    );
  }
}

/**
 * Șterge toate itemele de meniu ale unui restaurant.
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>} Numărul de iteme șterse
 */
async function deleteAllMenuItemsByRestaurant(restaurantId, tenantId) {
  if (!restaurantId) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const result = _dbRun(
      db,
      'DELETE FROM menu_items WHERE restaurantId = ? AND tenantId = ?',
      [restaurantId, tenantId]
    );

    return result.changes || 0;
  } catch (removeErr) {
    throw new AppError(
      `Eroare la ștergerea itemelor de meniu: ${removeErr.message}`,
      500,
      'DB_DELETE_ERROR'
    );
  }
}

/**
 * Obține numărul total de iteme de meniu dintr-un restaurant.
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>}
 */
async function countMenuItemsByRestaurant(restaurantId, tenantId) {
  if (!restaurantId) {
    return 0;
  }

  if (!tenantId) {
    return 0;
  }

  try {
    const db = await getDb();
    const row = _dbGet(
      db,
      'SELECT COUNT(*) AS cnt FROM menu_items WHERE restaurantId = ? AND tenantId = ?',
      [restaurantId, tenantId]
    );
    return row ? row.cnt : 0;
  } catch (err) {
    throw new AppError(
      `Eroare la numărarea itemelor de meniu: ${err.message}`,
      500,
      'DB_COUNT_ERROR'
    );
  }
}

/**
 * Obține numărul de iteme de meniu dintr-o categorie.
 * @param {string} category - Categoria
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<number>}
 */
async function countMenuItemsByCategory(category, restaurantId, tenantId) {
  if (!category || !isValidCategory(category)) {
    throw new AppError(
      `Categoria "${category}" nu este validă.`,
      400,
      'INVALID_CATEGORY'
    );
  }

  if (!restaurantId) {
    return 0;
  }

  if (!tenantId) {
    return 0;
  }

  try {
    const db = await getDb();
    const row = _dbGet(
      db,
      'SELECT COUNT(*) AS cnt FROM menu_items WHERE restaurantId = ? AND tenantId = ? AND category = ?',
      [restaurantId, tenantId, category]
    );
    return row ? row.cnt : 0;
  } catch (err) {
    throw new AppError(
      `Eroare la numărarea itemelor pe categorie: ${err.message}`,
      500,
      'DB_COUNT_ERROR'
    );
  }
}

/**
 * Caută iteme de meniu după nume (căutare parțială, case-insensitive).
 * @param {string} searchTerm - Termenul de căutare
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>}
 */
async function searchMenuItemsByName(searchTerm, restaurantId, tenantId) {
  if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
    throw new AppError(
      'Termenul de căutare este invalid.',
      400,
      'INVALID_SEARCH_TERM'
    );
  }

  if (!restaurantId) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const rows = _dbAll(
      db,
      `SELECT * FROM menu_items
       WHERE restaurantId = ? AND tenantId = ? AND name LIKE ?
       ORDER BY name ASC`,
      [restaurantId, tenantId, `%${searchTerm.trim()}%`]
    );

    return (rows || []).map(_rowToMenuItem);
  } catch (err) {
    throw new AppError(
      `Eroare la căutarea itemelor de meniu: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

/**
 * Obține toate categoriile disponibile (listă de categorii care au cel puțin un item).
 * @param {string} restaurantId - ID-ul restaurantului
 * @param {string} tenantId - ID-ul tenant-ului
 * @returns {Promise<Array>}
 */
async function getMenuCategories(restaurantId, tenantId) {
  if (!restaurantId) {
    throw new AppError('ID-ul restaurantului este invalid.', 400, 'INVALID_RESTAURANT_ID');
  }

  if (!tenantId) {
    throw new AppError('ID-ul tenant-ului este obligatoriu.', 400, 'MISSING_TENANT_ID');
  }

  try {
    const db = await getDb();
    const rows = _dbAll(
      db,
      'SELECT DISTINCT category FROM menu_items WHERE restaurantId = ? AND tenantId = ? ORDER BY category ASC',
      [restaurantId, tenantId]
    );

    const categories = (rows || []).map((r) => r.category).filter(Boolean);
    return categories;
  } catch (err) {
    throw new AppError(
      `Eroare la obținerea categoriilor: ${err.message}`,
      500,
      'DB_QUERY_ERROR'
    );
  }
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
  _restaurantExists,
  _rowToMenuItem,
  _parseAllergens,
};
