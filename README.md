# GastroHub Core

**GastroHub** – Platformă SaaS pentru gestionarea restaurantelor, hotelurilor și serviciilor de catering.

## Cuprins

1. [Prezentare generală](#prezentare-generală)
2. [Arhitectură](#arhitectură)
3. [Module operaționale](#module-operaționale)
4. [Autentificare și autorizare](#autentificare-și-autorizare)
5. [API Endpoints](#api-endpoints)
    - [Autentificare (`/api/auth`)](#api-autentificare)
    - [Restaurante (`/api/restaurants`)](#api-restaurante)
    - [Hoteluri (`/api/hotels`)](#api-hoteluri)
    - [Rezervări (`/api/reservations`)](#api-rezervări)
    - [Comenzi (`/api/orders`)](#api-comenzi)
    - [Livrări (`/api/deliveries`)](#api-livrări)
    - [Resurse Umane (`/api/hr`)](#api-resurse-umane)
    - [Inventar (`/api/inventory`)](#api-inventar)
    - [Furnizori (`/api/suppliers`)](#api-furnizori)
    - [Loialitate (`/api/loyalty`)](#api-loialitate)
6. [Roluri și permisiuni](#roluri-și-permisiuni)
7. [Instalare și configurare](#instalare-și-configurare)
8. [Testare](#testare)
9. [Contribuții](#contribuții)
10. [Licență](#licență)

---

## Prezentare Generală

GastroHub este o soluție enterprise-level pentru managementul operațiunilor HoReCa. Suportă **multi-tenancy** – fiecare client (lanț de restaurante, hotel, catering) are date izolate logic.

**Funcționalități cheie:**
- Gestionare restaurante (mese, meniuri, program)
- Gestionare hoteluri (camere, tipuri, statusuri)
- Rezervări restaurant și hotel
- Comenzi restaurant cu status lifecycle
- Livrări și aprovizionare
- Resurse Umane (angajați, pontaje, salarii)
- Inventar (materii prime, produse, tranzacții)
- Furnizori și comenzi simulate
- Program de loialitate (puncte, cupoane, discounturi)

## Arhitectură

### Stack Tehnologic

| Componentă | Tehnologie |
|------------|------------|
| Runtime | Node.js |
| Framework | Express.js |
| Bază de date | NeDB (embedded, file-based) – zero configurare |
| Template engine | EJS (portal client) |
| Autentificare | JWT (JSON Web Tokens) + cookie-based |
| Validare | express-validator |
| Securitate | Helmet, CORS, bcryptjs |
| Middleware cookie | cookie-parser |

### Structură Directoare

gastrohub-core/
├── server.js           # Pornire server
├── routes/             # Rute API (@module)
│   ├── auth.js
│   ├── restaurants.js
│   ├── hotels.js
│   ├── reservations.js
│   ├── orders.js
│   ├── deliveries.js
│   ├── hr.js
│   ├── inventory.js
│   ├── suppliers.js
│   └── loyalty.js
├── middleware/         # Middleware-uri (auth, erori)
├── customer/           # Portal client (views + rute EJS)
├── admin/              # Portal administrare (EJS)
├── restaurant/         # Portal restaurant (EJS)
│   ├── views/
│   └── public/
├── models/             # Modele date (NeDB)
├── services/           # Logică de business
├── utils/              # Utilități
├── test/               # Teste unitare/integrare
└── test_data/          # Date de test
### Flux cerere-răspuns

Client HTTP → Express → Middleware (helmet, cors, json, cookie) → Route matching
→ Auth middleware (JWT verify) → Authorization (role check) → Validation (express-validator)
→ Controller (async handler) → Service/Model → Response JSON
→ Error Handler (catch-all)
## Module Operaționale

### Autentificare (`routes/auth.js`)
- Înregistrare utilizator nou
- Login cu email + parolă
- Logout cu ștergere cookie JWT
- Suport pentru roluri multiple

### Restaurante (`routes/restaurants.js`)
- CRUD complet restaurante
- Multi-tenancy (izolare tenant)
- Gestionare număr mese
- Endpointuri pentru actualizare status și configurare

### Hoteluri (`routes/hotels.js`)
- CRUD complet hoteluri
- Gestionare camere per hotel (listare cu filtre)
- Multi-tenancy

### Rezervări (`routes/reservations.js`)
- Rezervări restaurant (masă, persoane)
- Rezervări hotel (cameră, check-in/check-out)
- Status lifecycle: `confirmată` → `în desfășurare` → `finalizată` / `anulată`
- Guest management

### Comenzi (`routes/orders.js`)
- Creare comenzi cu articole
- Status lifecycle: `în așteptare` → `în pregătire` → `gata` → `servit` → `plătită`
- Calcul subtotal, taxă serviciu, discount, total
- Generare factură
- Metode de plată

### Livrări (`routes/deliveries.js`)
- Programare și gestionare livrări de la furnizori
- Status lifecycle
- Multi-tenancy

### Resurse Umane (`routes/hr.js`)
- Angajați (CRUD, filtre)
- Pontaje (clock-in/clock-out)
- Salarii (gross, net, taxe)
- Multi-tenancy

### Inventar (`routes/inventory.js`)
- Itemuri de inventar (materii prime, produse)
- Categorii și locații
- Tranzacții (intrări, ieșiri, pierderi)
- Adjustare cantități
- Multi-tenancy

### Furnizori (`routes/suppliers.js`)
- CRUD furnizori
- Comenzi simulate
- Istoric comenzi
- Multi-tenancy

### Loialitate (`routes/loyalty.js`)
- Puncte de fidelitate
- Cupoane de discount
- Calcul discount
- Istoric tranzacții loialitate

## API Endpoints

### `/api/auth` – Autentificare

| Metodă | Cale | Acces | Descriere |
|--------|------|-------|-----------|
| POST | `/register` | Public | Înregistrare utilizator |
| POST | `/login` | Public | Autentificare |
| POST | `/logout` | Public | Deconectare |

#### POST /api/auth/register
{
  "email": "user@example.com",
  "password": "parola123",
  "nume": "John Doe",
  "rol": "manager",
  "tenantId": "tenant_123"
}
#### POST /api/auth/login
{
  "email": "user@example.com",
  "password": "parola123"
}
### `/api/restaurants` – Restaurante

| Metodă | Cale | Acces | Descriere |
|--------|------|-------|-----------|
| GET | `/` | Privat | Listare restaurante |
| GET | `/:id` | Privat | Detalii restaurant |
| POST | `/` | Privat (admin, owner) | Creare restaurant |
| PUT | `/:id` | Privat (admin, owner) | Actualizare restaurant |
| PATCH | `/:id/status` | Privat (admin, owner) | Actualizare status |
| PATCH | `/:id/tables` | Privat (admin, owner) | Actualizare nr. mese |
| DELETE | `/:id` | Privat (owner, super_admin) | Ștergere restaurant |

### `/api/hotels` – Hoteluri

| Metodă | Cale | Acces | Descriere |
|--------|------|-------|-----------|
| GET | `/` | Privat | Listare hoteluri |
| GET | `/:id` | Privat | Detalii hotel |
| POST | `/` | Privat (admin, owner) | Creare hotel |
| PUT | `/:id` | Privat (admin, owner) | Actualizare hotel |
| DELETE | `/:id` | Privat (owner, super_admin) | Ștergere hotel |
| GET | `/:id/rooms` | Privat | Listare camere |

### `/api/reservations` – Rezervări

| Metodă | Cale | Acces | Descriere |
|--------|------|-------|-----------|
| GET | `/` | Privat | Listare rezervări |
| GET | `/:id` | Privat | Detalii rezervare |
| POST | `/` | Privat | Creare rezervare |
| PUT | `/:id` | Privat | Actualizare rezervare |
| DELETE | `/:id` | Privat | Ștergere rezervare |
| PATCH | `/:id/status` | Privat | Actualizare status |

### `/api/orders` – Comenzi

| Metodă | Cale | Acces | Descriere |
|--------|------|-------|-----------|
| GET | `/` | Privat | Listare comenzi |
| GET | `/:id` | Privat | Detalii comandă |
| POST | `/` | Privat | Creare comandă |
| PUT | `/:id` | Privat | Actualizare comandă |
| DELETE | `/:id` | Privat (manager, owner) | Ștergere comandă |
| PATCH | `/:id/status` | Privat | Actualizare status |
| PATCH | `/:id/items` | Privat | Adăugare articole |
| POST | `/:id/pay` | Privat | Plată comandă |
| POST | `/:id/invoice` | Privat | Generare factură |

#### POST /api/orders – Creare comandă
{
  "restaurantId": "rest_123",
  "masa": 5,
  "items": [
    { "nume": "Pizza Margherita", "cantitate": 2, "pretUnitar": 35.00 },
    { "nume": "Salată Caesar", "cantitate": 1, "pretUnitar": 28.00 }
  ],
  "numePersoana": "Ion Popescu",
  "notite": "Fără gluten"
}
#### POST /api/orders/:id/pay – Plată
{
  "metodaPlata": "card",
  "sumaPrimita": 100.00
}
### `/api/deliveries` – Livrări

| Metodă | Cale | Acces | Descriere |
|--------|------|-------|-----------|
| GET | `/` | Privat | Listare livrări |
| GET | `/:id` | Privat | Detalii livrare |
| POST | `/` | Privat | Creare livrare |
| PUT | `/:id` | Privat | Actualizare livrare |
| DELETE | `/:id` | Privat | Ștergere livrare |
| PATCH | `/:id/status` | Privat | Actualizare status |

### `/api/hr` – Resurse Umane

| Metodă | Cale | Acces | Descriere |
|--------|------|-------|-----------|
| GET | `/employees` | Privat | Listare angajați |
| GET | `/employees/:id` | Privat | Detalii angajat |
| POST | `/employees` | Privat | Adăugare angajat |
| PUT | `/employees/:id` | Privat | Actualizare angajat |
| DELETE | `/employees/:id` | Privat | Ștergere angajat |
| POST | `/attendance/clock-in` | Privat | Pontaj intrare |
| POST | `/attendance/clock-out` | Privat | Pontaj ieșire |
| GET | `/attendance/:employeeId` | Privat | Istoric pontaje |
| GET | `/salaries/:employeeId` | Privat | Salarii angajat |
| POST | `/salaries` | Privat | Creare salariu |
| PUT | `/salaries/:id` | Privat | Actualizare salariu |
| DELETE | `/salaries/:id` | Privat | Ștergere salariu |

### `/api/inventory` – Inventar

| Metodă | Cale | Acces | Descriere |
|--------|------|-------|-----------|
| GET | `/` | Privat | Listare inventar |
| GET | `/:id` | Privat | Detalii item |
| GET | `/category/:category` | Privat | Filtrare categorie |
| GET | `/location/:locationId` | Privat | Filtrare locație |
| POST | `/` | Privat | Adăugare item |
| PUT | `/:id` | Privat | Actualizare item |
| DELETE | `/:id` | Privat | Ștergere item |
| POST | `/:id/transaction` | Privat | Tranzacție (intrare/ieșire) |
| GET | `/transactions` | Privat | Listare tranzacții |

### `/api/suppliers` – Furnizori

| Metodă | Cale | Acces | Descriere |
|--------|------|-------|-----------|
| GET | `/` | Privat | Listare furnizori |
| GET | `/:id` | Privat | Detalii furnizor |
| POST | `/` | Privat | Creare furnizor |
| PUT | `/:id` | Privat | Actualizare furnizor |
| DELETE | `/:id` | Privat | Ștergere furnizor |
| POST | `/:id/order` | Privat | Comandă simulată |
| GET | `/:id/orders` | Privat | Istoric comenzi |

### `/api/loyalty` – Loialitate

| Metodă | Cale | Acces | Descriere |
|--------|------|-------|-----------|
| GET | `/points/:userId` | Privat | Puncte utilizator |
| POST | `/points/add` | Privat | Adăugare puncte |
| POST | `/points/redeem` | Privat | Răscumpărare puncte |
| POST | `/coupons/validate` | Privat | Validare cupon |
| POST | `/coupons/create` | Privat (admin) | Creare cupon |
| GET | `/coupons/user/:userId` | Privat | Cupoane utilizator |
| GET | `/history/:userId` | Privat | Istoric loialitate |
| POST | `/discount/calculate` | Public | Calcul discount |

## Roluri și Permisiuni

| Rol | Nivel acces | Descriere |
|-----|-------------|-----------|
| `super_admin` | Nelimitat | Acces la toate entitățile și tenantii |
| `owner` | 4 (maxim) | Proprietar business |
| `manager` | 3 | Manager general |
| `bucătar` | 2 | Bucătar/bucătărie |
| `recepție` | 2 | Recepție hotel |
| `ospătar` | 1 | Ospătar |
| `client` | 0 | Client final |

**Funcții autorizare:**
- `authenticate` – Verifică token JWT
- `authorize(...roluri)` – Permite doar rolurile specificate
- `authorizeMinLevel(nivel)` – Permite roluri cu nivel >= specificat

## Instalare și Configurare

### Cerințe
- Node.js >= 16.x
- npm >= 8.x

### Instalare
git clone https://github.com/your-org/gastrohub-core.git
cd gastrohub-core
npm install
### Configurare
Creează fișierul `.env` în rădăcina proiectului:
PORT=3000
NODE_ENV=development
JWT_SECRET=your-super-secret-key-change-in-production
CORS_ORIGIN=*
### Pornire
# Mod dezvoltare (cu auto-restart)
npm run dev

# Mod producție
npm start
### Verificare
curl http://localhost:3000/api/restaurants
## Testare

Proiectul include date de test în directorul `test_data/`.

### Rulare teste
npm test
### Structură teste
test/
├── unit/           # Teste unitare per modul
├── integration/    # Teste de integrare API
└── fixtures/       # Date de test
## Contribuții

1. Fork repository
2. Creează branch feature (`git checkout -b feature/amazing-feature`)
3. Commit modificări (`git commit -m 'Add amazing feature'`)
4. Push branch (`git push origin feature/amazing-feature`)
5. Deschide Pull Request

## Licență

MIT License – vezi fișierul [LICENSE](LICENSE).

---

## Contact

**Echipa GastroHub**  
Email: contact@gastrohub.com  
Website: https://gastrohub.com