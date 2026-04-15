# Storeveu POS — Backend API

The backend REST API for the Storeveu POS platform (portal + cashier terminal). Built with **Express.js** and **PostgreSQL** (via Prisma).

---

## ⚡ Tech Stack

| Technology | Purpose |
|------------|---------|
| **Express.js 4** | HTTP server and routing |
| **Prisma 5** | Type-safe ORM for PostgreSQL |
| **PostgreSQL 16** | Primary relational database (Catalog, Transactions, Identity) |
| **Azure Document Intelligence** | Core OCR for Invoices |
| **OpenAI GPT-4o-mini** | OCR enrichment and fuzzy matching |
| **jsonwebtoken** | JWT authentication (2-hour access tokens, configurable via `JWT_ACCESS_TTL`) |
| **bcryptjs** | Password and PIN hashing |
| **DOMPurify** (frontend) | XSS sanitization of CMS/Career HTML content |
| **Multer** | File upload handling |
| **Open-Meteo API** | Weather data syncing |
| **FareCalculationService**| Delivery pricing source-of-truth |

---

## 🏗️ Architecture

The backend follows a **layered architecture** with multi-tenant isolation:

```
Request → Routes → Middleware (JWT + Org Scope) → Controllers → Prisma → PostgreSQL
```

- **Org-Scoping:** Every request is automatically scoped to the user's organization using `X-Store-Id` headers and session JWTs.
- **All Data in PostgreSQL:** Core records, invoices, transactions, lottery, and analytics all stored via Prisma ORM.

---

## 📁 Folder Structure

```
backend/
├── prisma/
│   ├── schema.prisma     → Full SQL schema (35+ models)
│   ├── seed.js           → Tax rules, deposits, sample products
│   └── seedLottery.js    → Ontario OLGC lottery games (20 games)
├── src/
│   ├── controllers/      → Business logic (18 controllers)
│   ├── routes/           → API definitions (17 route files)
│   ├── middleware/       → Auth (JWT + PIN), Scoping (org + store), POS user
│   ├── services/         → External API wrappers (MarktPOS, Weather, GPT, Import)
│   ├── utils/            → Algorithms (Holt-Winters), Schedulers, CSV transformers
│   └── server.js         → App entry
└── uploads/              → Temporary file storage
```

---

## 🔐 Authentication & Security

- **Registration:** `POST /api/auth/signup` creates a new Organization and User. Server-enforced password policy (8+ chars, upper/lower/digit/special) via `utils/validators.js`.
- **Login:** `POST /api/auth/login` returns a **2-hour access token** (default; configurable via `JWT_ACCESS_TTL`).
- **PIN Login:** `POST /api/pos-terminal/pin-login` allows rapid switching at the terminal using a 4–6 digit PIN. Rate-limited to 15 attempts per 5 minutes per IP (`pinLimiter`).
- **Password reset:** `POST /api/auth/forgot-password` → email link → `/reset-password?token=...` → `POST /api/auth/reset-password`. Frontend page with live strength meter at [`frontend/src/pages/ResetPassword.jsx`](../frontend/src/pages/ResetPassword.jsx).

### Rate Limiting
In-memory fixed-window limiter in `src/middleware/rateLimit.js`:
| Limiter | Window | Max | Applied To |
|---|---|---|---|
| `loginLimiter` | 15 min | 5 | `/auth/login`, `/auth/phone-lookup` |
| `signupLimiter` | 60 min | 10 | `/auth/signup` |
| `forgotPasswordLimiter` | 60 min | 3 | `/auth/forgot-password` |
| `resetPasswordLimiter` | 15 min | 20 | `/auth/reset-password` |
| `pinLimiter` | 5 min | 15 | `/pos-terminal/clock`, `/pos-terminal/pin-login` |

### Internal Service-to-Service Auth
`POST /api/catalog/ecom-stock-check` is unauthenticated by design (called by ecom-backend during online checkout) but requires an `X-Internal-Api-Key` header matching the `INTERNAL_API_KEY` env var. Generate with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Must match the same value in `ecom-backend/.env`.

### Input Validators
All shared validators live in `src/utils/validators.js`:
- `validateEmail(email)` — regex + length check
- `validatePassword(password)` — 8-128 chars, upper/lower/digit/special
- `validatePhone(phone)` — 7-15 digits, E.164-ish
- `parsePrice(value, {min, max})` — rejects NaN/Infinity/scientific notation, rounds to 4 decimals for Prisma `Decimal(10,4)`

Applied throughout `authController`, `customerController`, `catalogController`, `adminController`.

---

## 🛤️ API Routes Documentation

### Auth (`/api/auth`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/signup` | Public | Create org + admin user |
| POST | `/login` | Public (rate-limited 5/15min) | Get access token (2h default) |
| POST | `/reset-password` | Public (rate-limited 20/15min) | Reset password with email token |
| POST | `/forgot-password` | Public | Password reset |
| POST | `/set-cashier-pin` | JWT | Set/update cashier PIN |

### Catalog (`/api/catalog`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/departments` | Department CRUD |
| GET/POST | `/tax-rules` | Tax rule management |
| GET/POST | `/vendors` | Vendor management |
| GET/POST | `/deposit-rules` | Container deposit rules |
| GET/POST | `/rebate-programs` | Manufacturer rebate programs |

### Products (`/api/products`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/master` | Master product CRUD |
| GET/PUT | `/store` | Store-specific price/stock overrides |
| PUT | `/bulk-update` | Bulk pricing updates |
| GET/POST | `/promotions` | Promotion management |

### POS Terminal (`/api/pos-terminal`)
Used by the **Cashier App**.
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/register-station` | Register terminal |
| POST | `/verify-station` | Verify station token |
| POST | `/pin-login` | Cashier PIN auth |
| GET | `/catalog-snapshot` | Full catalog dump for offline sync |
| POST | `/transactions` | Submit sale (supports `lotteryItems[]`) |
| POST | `/transactions/batch` | Sync multiple offline sales |
| POST | `/transactions/:id/void` | Void transaction |
| POST | `/transactions/:id/refund` | Refund transaction |
| GET | `/config` | Get station layout/UI settings |
| PUT | `/config` | Save POS config |
| GET | `/hardware-config` | Hardware settings |
| PUT | `/hardware-config` | Save hardware config |
| POST | `/print-network` | Print receipt via network printer |
| GET | `/branding` | Store branding config |
| GET | `/end-of-day` | End of day report |

### Lottery (`/api/lottery`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/games` | Game catalog (state-filtered) |
| GET/POST | `/boxes` | Box inventory + lifecycle |
| POST | `/boxes/:id/activate` | Activate box |
| POST/GET | `/transactions` | Lottery sale/payout records |
| GET/POST | `/shift-reports` | EOD shift reconciliation |
| GET | `/dashboard` | Monthly KPIs |
| GET | `/reports` | Date-range report + chart data |
| GET | `/commission` | Commission report |
| GET/PUT | `/settings` | Store lottery settings |

### Payment (`/api/payment`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/pax/sale` | Initiate PAX card sale |
| POST | `/pax/refund` | PAX refund |
| POST | `/pax/void` | PAX void |
| POST | `/pax/test` | PAX connection test |

### Shifts (`/api/pos-terminal`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/shifts/active` | Get active shift |
| POST | `/shifts/open` | Open shift |
| POST | `/shifts/close` | Close shift |
| POST | `/cash-drop` | Mid-shift cash drop |
| POST | `/payout` | Mid-shift cash payout |

### Sales & Analytics (`/api/sales`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/realtime` | Today's live sales |
| GET | `/daily` | Daily sales + weather |
| GET | `/weekly` | Weekly summary |
| GET | `/monthly` | Monthly summary |
| GET | `/predictions/daily` | Holt-Winters daily forecast |
| GET | `/top-products` | Product movement analysis |
| GET | `/department-comparison` | Department comparison |

### Reports (`/api/reports`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/employees` | Detailed sales performance by staff member |

### Storefront Auth (`/api/storefront`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/:storeId/auth/signup` | Public | Create customer account with password |
| POST | `/:storeId/auth/login` | Public | Validate password, return JWT |
| GET | `/:storeId/auth/me` | Customer JWT | Get customer profile |
| PUT | `/:storeId/auth/password` | Customer JWT | Change password |

Controller: `storefrontAuthController.js` — Unified customer auth using the POS `Customer` table as the single source of truth for both in-store and online storefront authentication.

### Other Routes
| Mount | Description |
|-------|-------------|
| `/api/stores` | Store CRUD, branding, location, billing |
| `/api/users` | User management, roles, invites |
| `/api/customers` | Customer lookup, loyalty, sync |
| `/api/invoice` | Invoice upload, OCR, drafts, confirm |
| `/api/fees-mappings` | Fee label mapping |
| `/api/weather` | Weather data (current + range) |
| `/api/pos` | IT Retail / MarktPOS proxy |
| `/api` | Legacy CSV endpoints |

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

### Lottery
| Field | Type | Description |
|-------|------|-------------|
| `LotteryGame` | Model | Game type (name, ticketPrice, state, isGlobal) |
| `LotteryBox` | Model | Physical pack (status: inventory/active/depleted/settled) |
| `LotteryTransaction` | Model | Individual sale or payout |
| `LotteryShiftReport` | Model | EOD reconciliation with box scan data |
| `LotterySettings` | Model | Store-level config (commission, cashOnly, state) |

### Documents & Other
| Model | Purpose |
|-------|---------|
| `Invoice` | OCR-processed vendor invoices (lineItems JSON, pages JSON) |
| `Document` | Generic OCR documents (extractedFields JSON) |
| `VendorProductMap` | Vendor itemCode to POS product mapping |
| `FeeMapping` | Fee label to internal type mapping |
| `WeatherCache` | Daily weather per lat/lng |
| `ImportJob` | Bulk import tracking |
| `Station` | POS terminal (token, hardwareConfig JSON) |
| `PosToken` | Cached POS auth tokens |
| `PosLog` | Immutable API audit log (TTL 30 days) |

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
