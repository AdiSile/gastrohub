'use strict';

// ---------------------------------------------------------------------------
// Model Order – GastroHub
// Definirea structurii, validărilor și operațiilor CRUD pentru comenzi.
// Câmpuri suportate: status, articole, total, metodă plată, ospătar, masă,
// tenantId, restaurantId, note, discount, taxă serviciu
//
// Backend: SQLite (prin getDb() din config/db).
// Tabela: orders
// ---------------------------------------------------------------------------

const { run, get, all } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
**Principalele modificări:**

| Aspect | Înainte (NeDB) | După (SQLite) |
|---|---|---|
| **Dependență DB** | `require('../config/tenant')` → `getTenantDb()` | `require('../config/db')` → `run`, `get`, `all` |
| **Verificare restaurant** | `restaurants.findOne()` (NeDB) | `_restaurantExists()` (SELECT SQL) |
| **CREATE** | `ordersDb.insert(orderDoc)` | `INSERT INTO orders (...)` |
| **READ (by ID)** | `ordersDb.findOne({ _id: id })` | `SELECT * FROM orders WHERE id = ?` |
| **READ (list)** | `ordersDb.find(filter).sort().limit().skip().exec()` | `SELECT ... WHERE ... ORDER BY ... LIMIT ... OFFSET ...` |
| **UPDATE** | `ordersDb.update({ _id: id }, { $set: ... })` | `UPDATE orders SET ... WHERE id = ?` |
| **DELETE** | `ordersDb.remove({ _id: id })` | `DELETE FROM orders WHERE id = ?` |
| **Mapare câmpuri** | `articole`, `metodaPlata`, `masa`, `taxaServiciu`, `ospatar`, `discount`, `note` | `items` (JSON), `paymentMethod`, `tableNumber`, `tax`, `items.ospatar` (JSON), `items.discount` (JSON), `notes` |
| **Conversie rând** | Document NeDB direct | `_rowToOrder()` reconstruiește `_id`, `articole`, `taxaServiciuValoare` etc. |
| **Export `getOrdersDb`** | Prezent | Eliminat |

**Strategia de stocare a câmpurilor extinse** (`ospatar`, `discount`):
- Coloana SQL `items` (TEXT) stochează un obiect JSON: `{"articole": [...], "ospatar": "...", "discount": 0}`
- `_packItems()` serializează, `_parseItems()` deserializează
- `_rowToOrder()` reconstruiește documentul complet, inclusiv `taxaServiciuValoare` (calculat din `subtotal * tax / 100`)
- Căutarea după `ospatar` folosește `items LIKE '%"ospatar":"...%'` cu post-filtrare exactă

**Funcții CRUD păstrate (semnături identice):**
- `createOrder`, `findOrderById`, `findOrdersByRestaurant`, `findOrdersByStatus`, `findOrdersByTable`, `findOrdersByWaiter`
- `updateOrder`, `updateOrderStatus`, `updateOrderPaymentMethod`
- `addOrderItem`, `removeOrderItem`
- `deleteOrder`, `deleteAllOrdersByRestaurant`

**Validările și constantele rămân neschimbate.**