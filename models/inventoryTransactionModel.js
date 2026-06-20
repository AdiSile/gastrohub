**Modificări principale:**

1. **Importul** – `const { getDb, get, all, run } = require('../config/db')` → `const { getDb } = require('../config/db')`. Se importă doar `getDb`.

2. **Helper-e locale noi** (în locul wrapper-elor din `config/db`):
   - `_queryOne(db, sql, params)` – folosește `db.prepare()` nativ sql.js pentru SELECT care returnează un singur rând
   - `_queryAll(db, sql, params)` – folosește `db.prepare()` nativ sql.js pentru SELECT care returnează toate rândurile
   - `_execRun(db, sql, params)` – folosește `db.run()` nativ sql.js pentru INSERT/UPDATE/DELETE și extrage `changes`/`lastInsertRowid` cu `db.exec('SELECT changes()')` / `db.exec('SELECT last_insert_rowid()')`

3. **Toate funcțiile CRUD au devenit `async`** și folosesc `await getDb()` în loc de `getDb()` sincron.

4. **Gestionarea erorilor** – `Promise.reject()` → `throw` și `Promise.resolve()` → `return`, conform pattern-ului async/await.

5. **`deleteInventoryTransaction`** – adaugă reverificare `if (err instanceof AppError) throw err` pentru a nu înveli erorile de tip 404 într-un 500 generic.