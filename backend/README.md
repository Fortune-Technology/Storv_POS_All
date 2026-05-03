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
| **jsonwebtoken** | JWT authentication (8-hour access tokens by default, configurable via `JWT_ACCESS_TTL`) |
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

- **Org-Scoping:** `req.orgId` is derived from the active store (`X-Store-Id` header) via `scopeToTenant`, NOT from the JWT. This supports the multi-org access model — a user can have `UserOrg` memberships in many orgs; switching stores switches the active org automatically. See Sessions 32–35 in `CLAUDE.md`.
- **RBAC-first route gating:** Every mutating route uses `requirePermission('module.action')` from `src/rbac/permissionService.js`. The legacy `authorize(...roles)` still works for back-compat, but new code should use permissions. See the 133-key catalog in `src/rbac/permissionCatalog.js`.
- **All Data in PostgreSQL:** Core records, invoices, transactions, lottery, fuel, analytics, RBAC tables — all via Prisma ORM.

---

## 📁 Folder Structure

```
backend/
├── prisma/
│   ├── schema.prisma      → Full SQL schema (50+ models incl. RBAC, UserOrg, Fuel, QuickButtons, State)
│   ├── seed.js            → Tax rules, deposits, sample products
│   ├── seedLottery.js     → Ontario OLGC lottery games (20 games)
│   ├── seedRbac.js        → 133 permissions + 6 system roles (run on every deploy)
│   ├── seedTransactions.js→ ~3,900 realistic POS transactions (90 days)
│   └── seedToday.js       → Seed today's transactions for dashboard testing
├── src/
│   ├── controllers/       → 30+ controllers. Large ones split into per-concern folders (sales/,
│   │                        shift/, payment/{adminMerchant,adminTerminal,hpp,posSpin}/) with a
│   │                        1-line shim at the original path. All TypeScript.
│   ├── routes/            → API definitions
│   ├── middleware/        → auth (JWT + PIN), scopeToTenant, rateLimit, requirePermission, autoAudit
│   ├── rbac/              → permissionCatalog.ts (133 keys), permissionService.ts
│   ├── services/          → Domain folders (Session 55):
│   │                        ai/ (OpenAI client), notifications/ (email + sms),
│   │                        sales/ (sales + dailySale), inventory/ (orderEngine + matching + import),
│   │                        fuel/ (FIFO + topology), weather/ (Open-Meteo + cache),
│   │                        lottery/, scanData/, dejavoo/, payment/, reconciliation/.
│   │                        Top-level: auditService, auditDiff, billingService, loyaltyService,
│   │                        chargeAccountService, marktPOSService, kbService, labelQueueService, etc.
│   ├── utils/             → validators (email/password/phone/price/fuel/count/alphanumeric),
│   │                        upc stripping, Holt-Winters predictions, cryptoVault (AES-256-GCM)
│   └── server.ts          → App entry (starts billing + order + shift + scan-data schedulers)
└── uploads/               → Product images, quick-button tiles, invoice uploads, scan-data files
```

---

## 🔐 Authentication & Security

- **Registration:** `POST /api/auth/signup` creates a new Organization and User. Server-enforced password policy (8+ chars, upper/lower/digit/special) via `utils/validators.js`.
- **Login:** `POST /api/auth/login` returns an **8-hour access token** (default; configurable via `JWT_ACCESS_TTL`). Response includes `permissions: string[]` for frontend gating.
- **PIN Login:** `POST /api/pos-terminal/pin-login` allows rapid switching at the terminal using a 4–8 digit PIN. Tiered lookup — per-store override (`UserStore.posPin`) wins over org-wide (`User.posPin`) fallback. Rate-limited to 15 attempts per 5 minutes per IP (`pinLimiter`).
- **Password reset:** `POST /api/auth/forgot-password` → email link → `/reset-password?token=...` → `POST /api/auth/reset-password`. Frontend page with live strength meter at [`frontend/src/pages/ResetPassword.jsx`](../frontend/src/pages/ResetPassword.jsx).
- **Verify password (inactivity lock):** `POST /api/auth/verify-password` (JWT required, rate-limited) — bcrypt compares supplied password to the current user's hash. Used by the portal's 1-minute idle lock screen.
- **Invitations:** `POST /api/invitations` creates a 7-day invitation (email + optional SMS). Public `GET /api/invitations/:token` and `POST /:token/accept` let the recipient self-serve account creation. `transferOwnership: true` variant transfers store ownership end-to-end (see Sessions 33–34).

### Rate Limiting
In-memory fixed-window limiter in `src/middleware/rateLimit.js`:
| Limiter | Window | Max | Applied To |
|---|---|---|---|
| `loginLimiter` | 15 min | 5 | `/auth/login`, `/auth/phone-lookup` |
| `signupLimiter` | 60 min | 10 | `/auth/signup` |
| `forgotPasswordLimiter` | 60 min | 3 | `/auth/forgot-password` |
| `resetPasswordLimiter` | 15 min | 20 | `/auth/reset-password` |
| `pinLimiter` | 5 min | 15 | `/pos-terminal/clock`, `/pos-terminal/pin-login` |
| `invitationLookupLimiter` | 10 min | 20 | `GET /invitations/:token` |
| `invitationAcceptLimiter` | 10 min | 10 | `POST /invitations/:token/accept` |

### Internal Service-to-Service Auth
`POST /api/catalog/ecom-stock-check` is unauthenticated by design (called by ecom-backend during online checkout) but requires an `X-Internal-Api-Key` header matching the `INTERNAL_API_KEY` env var. Generate with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Must match the same value in `ecom-backend/.env`.

### Input Validators + Formatters
All shared validators live in `src/utils/validators.ts`:
- `validateEmail(email)` — regex + length check
- `validatePassword(password)` — 8-128 chars, upper/lower/digit/special
- `validatePhone(phone)` — 7-15 digits, E.164-ish
- `validateAlphanumeric(value, {minLength, maxLength, allowedSpecials})` — string fields with safe whitelist
- `parsePrice(value, {min, max})` — money (4 decimals, Prisma `Decimal(10,4)`)
- `parseFuel(value, {min, max})` — fuel quantity / $/gal (3 decimals)
- `parseCount(value, {min, max})` — integer-only counts
- `formatMoney(n)` / `formatFuel(n)` / `formatCount(n)` — output formatters mirrored in
  `frontend/src/utils/formatters.js`, `cashier-app/src/utils/formatters.js`, and
  `admin-app/src/utils/formatters.js` so server + client render identically.

Applied throughout `authController`, `customerController`, `catalogController`, `adminController`,
plus the cashier-app + portal `<MoneyInput>`/`<FuelInput>`/`<CountInput>` components
(scroll/arrow-proof, Session 52).

---

## 🛤️ API Routes Documentation

### Auth (`/api/auth`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/signup` | Public | Create org + admin user |
| POST | `/login` | Public (rate-limited 5/15min) | Get access token (8h default) + permissions[] |
| POST | `/reset-password` | Public (rate-limited 20/15min) | Reset password with email token |
| POST | `/forgot-password` | Public | Password reset request |
| POST | `/verify-password` | JWT (rate-limited) | Re-verify current password (inactivity lock) |
| POST | `/set-cashier-pin` | JWT | Set/update cashier PIN |

### RBAC (`/api/roles`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/permissions` | Full 133-key permission catalog |
| GET/POST/PUT/DELETE | `/` | List/create/edit/delete roles (system roles are immutable) |
| GET/PUT | `/users/:userId/roles` | Assign roles to a user |
| GET | `/me/permissions` | Effective permission set for the current user |

### Invitations (`/api/invitations`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET/POST | `/` | manager+ | List / create invitation (7-day expiry, email + optional SMS) |
| POST | `/:id/resend` | manager+ | Bump expiry + re-send |
| DELETE | `/:id` | manager+ | Revoke pending invitation |
| GET | `/:token` | Public (rate-limited) | Lookup by token (accept page) |
| POST | `/:token/accept` | Public (rate-limited) | Accept — creates account or attaches UserOrg; supports ownership transfer |

### Self-service user (`/api/users/me`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/me` | Own profile + all UserOrg memberships |
| PUT | `/me` | Update name/phone (email/role require admin) |
| PUT | `/me/password` | Change password (requires current) |
| GET | `/me/pins` | List stores where user can set a per-store PIN |
| PUT | `/me/pin` | Set per-store PIN (`UserStore.posPin`) |
| DELETE | `/me/pin/:storeId` | Remove per-store PIN |

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
| GET | `/employees` | Detailed sales performance by staff member (refunds netted; see Session 27) |
| GET/POST/PUT/DELETE | `/clock-events` | Manual clock session CRUD (owner+ for writes) |
| GET | `/end-of-day` | Unified EoD report — tender details, payouts, transactions, fuel section, reconciliation (see Sessions 22, 26) |

### Fuel (`/api/fuel`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST/PUT/DELETE | `/types` | Fuel grade catalog (3-decimal $/gallon) |
| GET/PUT | `/settings` | Per-store enable + cashOnly + allowRefunds + defaultEntryMode |
| GET | `/transactions` | List fuel transactions |
| GET | `/report` | Date-range by-type aggregation |
| GET | `/dashboard` | Today + month KPIs |

### Quick Buttons (`/api/quick-buttons`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/PUT/DELETE | `/` | Per-store WYSIWYG tile layout (products/folders/actions/text/image) |
| POST | `/upload` | Upload tile image (multer, 10MB, image MIME only) |
| GET | `/actions` | Whitelist of valid action keys |

### States (`/api/states`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST/PUT/DELETE | `/` | Superadmin: US state catalog (tax, age, deposit rules, lottery stubs) |
| GET | `/public` | Active states list (portal dropdown) |

### Price Scenarios (`/api/price-scenarios`)
Superadmin-only. CRUD for saved Interchange-plus pricing scenarios (sales collateral).

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
| `Invoice` | OCR-processed vendor invoices (lineItems JSON, pages JSON, `vendorId` for vendor-scoped matching) |
| `Document` | Generic OCR documents (extractedFields JSON) |
| `VendorProductMap` | Vendor itemCode to POS product mapping |
| `FeeMapping` | Fee label to internal type mapping |
| `WeatherCache` | Daily weather per lat/lng |
| `ImportJob` | Bulk import tracking |
| `Station` | POS terminal (token, hardwareConfig JSON) |
| `PosToken` | Cached POS auth tokens |
| `PosLog` | Immutable API audit log (TTL 30 days) |

### RBAC (Sessions 30–31)
| Model | Purpose |
|-------|---------|
| `Permission` | Global catalog (key, module, action, scope: org\|admin). 133 seeded keys. |
| `Role` | System (seeded, `orgId=null`) or per-org custom role with status/scope |
| `RolePermission` | m:n |
| `UserRole` | m:n — users may hold multiple roles; effective perms = union |

### Multi-Org Access (Sessions 32–35)
| Model | Purpose |
|-------|---------|
| `UserOrg` | Junction — one user ↔ many orgs. `role` is per-org. `isPrimary` marks home org. |
| `Invitation` | 7-day email invite token (role, storeIds, `transferOwnership` flag) |
| `User.orgId` | **Nullable** home org (login affinity). Real access comes from `UserOrg`. |

### Fuel (Session 23)
| Model | Purpose |
|-------|---------|
| `FuelType` | Per-store fuel grade (`pricePerGallon` Decimal(10,3), taxable, color) |
| `FuelSettings` | Per-store enable + cashOnly + allowRefunds + defaultEntryMode + defaultFuelTypeId |
| `FuelTransaction` | Per-sale record linked to `Transaction.posTransactionId` |

### Misc New Tables
| Model | Purpose |
|-------|---------|
| `QuickButtonLayout` | Per-store POS home screen (gridCols, rowHeight, tree JSON) |
| `State` | Superadmin-curated US state catalog (tax rate, age limits, deposit rules) |
| `Store.stateCode` | FK → `State.code` for auto-populating defaults |
| `GlobalProductImage` | Cross-org product image cache keyed by stripped UPC |
| `UserStore.posPin` | Per-store PIN override (tiered lookup — wins over `User.posPin`) |
| `PriceScenario` | Saved Interchange-plus pricing scenarios (superadmin sales tool) |
| `PurchaseOrder` / `PurchaseOrderItem` | 14-factor auto-order system (see `services/orderEngine.js`) |
| `LabelQueue` | Auto-detected + manual shelf-label print queue |
| `VendorPayment` | Back-office vendor payments (NOT shift-scoped; separate from cashier `CashPayout`) |

---

## ⏰ Background Schedulers

Started from `server.js` at boot:

| Scheduler | File | Purpose |
|-----------|------|---------|
| Billing | `services/billingScheduler.js` | Monthly subscription renewals |
| Orders | `services/orderScheduler.js` | Weekly auto-generate PO suggestions |
| Shift auto-close | `services/shiftScheduler.js` | Every 10 min — closes shifts that crossed store-local midnight (see Session 19b) |

---

## ⚙️ Setup

```bash
cd backend
npm install
npx prisma generate
npx prisma db push
node prisma/seedRbac.js        # REQUIRED — seeds 133 permissions + 6 system roles
npm run db:seed -- <orgId>     # Optional — sample tax rules, deposits, products
npm run dev
```

### Production deploy checklist

Every deploy must include:

```bash
git pull
npm install
npx prisma db push              # applies any additive schema changes
node prisma/seedRbac.js         # resyncs system roles if permission catalog changed
pm2 restart api-pos
```

Skipping `seedRbac.js` is the #1 cause of "works locally, 403 in prod" regressions (see Session 37b).
