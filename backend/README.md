# 🔧 Future Foods Portal — Backend

The backend REST API for the Future Foods business portal and POS terminal system. Built with **Express.js** and **PostgreSQL** (via Prisma).

---

## ⚡ Tech Stack

| Technology | Purpose |
|------------|---------|
| **Express.js 4** | HTTP server and routing |
| **Prisma 5** | Type-safe ORM for PostgreSQL |
| **PostgreSQL 16** | Primary relational database (Catalog, Transactions, Identity) |
| **Azure Document Intelligence** | Core OCR for Invoices |
| **OpenAI GPT-4o-mini** | OCR enrichment and fuzzy matching |
| **jsonwebtoken** | JWT authentication (30-day tokens) |
| **bcryptjs** | Password and PIN hashing |
| **Multer** | File upload handling |
| **Open-Meteo API** | Weather data syncing |

---

## 🏗️ Architecture

The backend follows a **layered architecture** with multi-tenant isolation:

```
Request → Routes → Middleware (JWT + Org Scope) → Controllers → Prisma → PostgreSQL
```

- **Org-Scoping:** Every request is automatically scoped to the user's organization using `X-Store-Id` headers and session JWTs.
- **Hybrid Data:** Core records in PostgreSQL; large blobs or legacy logs in MongoDB.

---

## 📁 Folder Structure

```
backend/
├── prisma/
│   ├── schema.prisma   → Full SQL schema
│   └── seed.js         → Org-agnostic base data
├── src/
│   ├── controllers/    → Business logic
│   ├── routes/         → API definitions
│   ├── middleware/     → Auth & Scoping guards
│   ├── services/       → External API wrappers (MarktPOS, Weather)
│   ├── utils/          → Algorithms (Holt-Winters) and Schedulers
│   └── server.js       → App entry
└── uploads/            → Temporary file storage
```

---

## 🔐 Authentication

- **Registration:** `POST /api/auth/signup` creates a new Organization and User.
- **Login:** `POST /api/auth/login` returns a 30-day JWT.
- **PIN Login:** `POST /api/pos-terminal/pin-login` allows rapid switching at the terminal using a 4–6 digit PIN.

---

## 🛤️ API Routes Documentation

### Core API (`/api`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/vendors` | ❌ | List configured vendor transformers |
| POST | `/upload-file`| ❌ | Upload CSV for transformation |
| POST | `/transform` | ❌ | Run async transformation |

### Catalog (`/api/catalog`) 🔒
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/products` | List all master products |
| POST | `/products` | Add new product to catalog |
| PUT | `/products/:id`| Update product details |
| GET | `/tax-rules` | Fetch Maine/configured taxes |

### POS Terminal (`/api/pos-terminal`) 🔒
Used by the **Cashier App**.
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/catalog/snapshot`| Full catalog dump for offline sync |
| POST | `/transactions` | Submit a completed sale |
| POST | `/transactions/batch`| Sync multiple offline sales |
| GET | `/config` | Get station layout/UI settings |
| POST | `/clock` | Employee clock-in/out event |

### Reports (`/api/reports`) 🔒
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/employees` | Detailed sales performance by staff member |

---

## 🗄️ Database Schema Overview (Prisma / PostgreSQL)

### Organization (Tenant)
| Field | Type | Description |
|-------|------|-------------|
| `id` | CUID | Primary key |
| `name` | String | Commercial name |
| `slug` | String | URL-safe identifier (org slug) |
| `plan` | String | `trial` \| `pro` \| `enterprise` |
| `settings`| JSONB | Timezone, default tax rates, etc. |

### MasterProduct (Global Catalog)
| Field | Type | Description |
|-------|------|-------------|
| `id` | Int | Serial PK |
| `upc` | String | 12-14 digit barcode (Indexed) |
| `name` | String | Product name |
| `departmentId`| Int | FK to Department |
| `vendorId` | Int | FK to Vendor |
| `defaultCost`| Decimal| Global default cost |
| `defaultRetail`| Decimal| Global default retail |

### Customer (Loyalty)
| Field | Type | Description |
|-------|------|-------------|
| `id` | CUID | Primary key |
| `name` | String | Full name |
| `email` | String | Unique email |
| `phone` | String | Unique phone (Lookup key) |
| `loyaltyPoints` | Int | Cumulative balance |

### Legacy Tables (MongoDB)
- **Invoice:** Raw OCR extractions, draft line items, and page image metadata.
- **Transform:** CSV/Excel transformation results and file paths.

---

## ⚙️ Setup

```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run db:seed -- <orgId>
npm run dev
```
