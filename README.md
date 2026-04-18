# Storeveu POS — Full-Stack Multi-Tenant Retail Platform
### POS Terminal + Management Portal + Business Intelligence

A modern, cloud-first retail management system for independent convenience, grocery, and liquor stores. Combines a real-time management portal with an offline-first POS cashier terminal (Electron desktop app), a superadmin panel, an e-commerce module (backend + Next.js storefront), AI-powered invoice processing, hardware integration (receipt printers, cash drawers, barcode scanners, scales, PAX payment terminals), and a complete lottery compliance module.

---

## Table of Contents

1. [Tech Stack](#1-tech-stack)
2. [Project Structure](#2-project-structure)
3. [Getting Started](#3-getting-started)
4. [Environment Variables](#4-environment-variables)
5. [Frontend Pages & Routes](#5-frontend-pages--routes)
6. [Cashier App Screens & Modals](#6-cashier-app-screens--modals)
7. [Backend API Reference](#7-backend-api-reference)
8. [Database Models (Prisma)](#8-database-models-prisma)
9. [Key Services & Utilities](#9-key-services--utilities)
10. [Feature Deep-Dives](#10-feature-deep-dives)
    - [Lottery Module](#101-lottery-module)
    - [POS Cart & Tender](#102-pos-cart--tender-architecture)
    - [Sales Analytics + Weather](#103-sales-analytics--weather)
    - [Live Dashboard](#104-live-dashboard)
    - [Sales Predictions](#105-sales-predictions--residual-analysis)
    - [Invoice OCR Pipeline](#106-invoice-ocr-pipeline)
    - [MarktPOS / IT Retail Integration](#107-marktpos--it-retail-integration)
    - [CSV Transformer](#108-csv-transformer)
11. [Authentication & Authorization](#11-authentication--authorization)
12. [Styling System](#12-styling-system)
13. [Developer Guides](#13-developer-guides)
14. [Hardware Integration](#14-hardware-integration)
15. [CI/CD & Deployment](#15-cicd--deployment)
16. [Changelog](#16-changelog)

---

## 1. Tech Stack

| Layer | Technology |
|-------|-----------|
| Portal Frontend | React 19, Vite 7, React Router v6, Redux Toolkit |
| Marketing Site | React 19, Lucide, Framer Motion (animations) |
| Cashier Terminal | React 18, Vite 5, Zustand, Dexie.js (IndexedDB), Electron 33 |
| Desktop Packaging | Electron Builder (NSIS installer for Windows x64) |
| Receipt Printing | ESC/POS (USB via PowerShell, Network TCP, QZ Tray fallback) |
| Label Printing | ZPL (network TCP to Zebra-compatible printers) |
| Hardware | Barcode scanners (HID/Serial), scales (Magellan/Serial), PAX terminals |
| Charts | Recharts (portal), Pure SVG (cashier/lottery) |
| Icons | Lucide React |
| Backend | Node.js, Express 4 |
| Database | **PostgreSQL 16** via Prisma 5 ORM |
| Auth | JWT (8-hour access tokens, configurable via `JWT_ACCESS_TTL`) + bcryptjs (passwords & POS PINs) |
| Auth Hardening | DOMPurify XSS sanitization, in-memory rate limiting, server-side password/email/phone validators, `parsePrice` hardening |
| File Handling | Multer, pdf2pic, csv-parser, fast-csv, xlsx |
| OCR | Azure Document Intelligence + OpenAI GPT-4o-mini |
| Payment Terminals | PAX A920/A35/A80/S300 (via backend API proxy) |
| POS Integration | MarktPOS / IT Retail REST API v2 |
| Weather | Open-Meteo API |
| Predictions | Holt-Winters Triple Exponential Smoothing + DOW factors |
| Dev Tooling | Concurrently, Nodemon, ESLint, Jest |

---

## 2. Project Structure

```
Fortune_POS_Platform/
├── CLAUDE.md                    # AI session context — auto-loaded by Claude Code
├── README.md                    # This file
├── ENGINEERING_PRINCIPLES.md    # Code standards & architectural decisions
├── ProjectOverview.md           # High-level product overview
├── .github/
│   └── workflows/
│       └── deploy.yml           # CI/CD: auto-deploy on push to main
│
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma        # 38+ Prisma models — full DB schema
│   │   ├── seed.js              # Tax/deposit/product seeder
│   │   └── seedLottery.js       # Ontario OLGC lottery game seeder (20 games)
│   ├── src/
│   │   ├── server.js            # Express app, middleware, route mounts
│   │   ├── config/
│   │   │   └── postgres.js      # Prisma client singleton
│   │   ├── controllers/
│   │   │   ├── authController.js
│   │   │   ├── catalogController.js      # Native POS catalog CRUD (depts, tax, vendors, deposits, rebates)
│   │   │   ├── customerController.js
│   │   │   ├── employeeReportsController.js # Employee shift/clock summaries
│   │   │   ├── feeMappingController.js   # Service fees and delivery charges
│   │   │   ├── importController.js       # Bulk CSV/Excel import pipeline
│   │   │   ├── invoiceController.js      # Azure OCR + GPT matching
│   │   │   ├── lotteryController.js      # Full lottery module (games/boxes/txns/reports/settings)
│   │   │   ├── paymentController.js      # PAX terminal integration (sale/refund/void/test)
│   │   │   ├── posController.js          # IT Retail proxy
│   │   │   ├── posTerminalController.js  # Cashier terminal API + lottery + receipt printing
│   │   │   ├── productController.js      # Master/store products, promotions
│   │   │   ├── salesController.js        # Analytics + Holt-Winters predictions
│   │   │   ├── shiftController.js        # Shift open/close, cash drops, payouts
│   │   │   ├── stationController.js      # Station registration, PIN login, hardware config
│   │   │   ├── storeController.js        # Store CRUD, branding, billing
│   │   │   └── userManagementController.js # Tenant users, invites, roles
│   │   ├── middleware/
│   │   │   ├── auth.js                   # JWT protect + authorize(roles)
│   │   │   └── scopeToTenant.js          # Injects req.orgId / req.storeId
│   │   └── routes/
│   │       ├── authRoutes.js
│   │       ├── catalogRoutes.js          # /api/catalog
│   │       ├── customerRoutes.js         # /api/customers
│   │       ├── invoiceRoutes.js          # /api/invoices
│   │       ├── feeMappingRoutes.js        # /api/fees-mappings
│   │       ├── lotteryRoutes.js          # /api/lottery
│   │       ├── paymentRoutes.js          # /api/payment (PAX terminals)
│   │       ├── posRoutes.js              # /api/pos (IT Retail proxy)
│   │       ├── posTerminalRoutes.js      # /api/pos-terminal
│   │       ├── productRoutes.js          # /api/products
│   │       ├── reportsRoutes.js          # /api/reports
│   │       ├── salesRoutes.js            # /api/sales
│   │       ├── storeRoutes.js            # /api/stores
│   │       ├── tenantRoutes.js           # /api/tenants
│   │       ├── weatherRoutes.js          # /api/weather
│   │       └── userManagementRoutes.js   # /api/users
│
├── cashier-app/
│   ├── electron/
│   │   ├── main.cjs                     # Electron main process (IPC handlers, printer/drawer)
│   │   └── preload.cjs                  # Context bridge (window.electronAPI)
│   ├── src/
│   │   ├── api/
│   │   │   ├── client.js                # Axios instance (Bearer + Station token headers)
│   │   │   └── pos.js                   # All cashier API calls (single source of truth)
│   │   ├── services/
│   │   │   ├── printerService.js        # ESC/POS receipt builder + printing (USB/Network/QZ)
│   │   │   └── qzService.js             # QZ Tray WebSocket client (printers, serial ports)
│   │   ├── components/
│   │   │   ├── cart/
│   │   │   │   ├── CartItem.jsx          # Handles lottery items (isLottery flag)
│   │   │   │   └── CartTotals.jsx
│   │   │   ├── layout/
│   │   │   │   └── StatusBar.jsx
│   │   │   ├── modals/
│   │   │   │   ├── LotteryModal.jsx      # Combined Sale+Payout modal
│   │   │   │   ├── LotterySaleModal.jsx  # Record lottery sale (game/box/qty)
│   │   │   │   ├── LotteryPayoutModal.jsx # Record lottery payout
│   │   │   │   ├── LotteryShiftModal.jsx # EOD ticket scan reconciliation
│   │   │   │   ├── AgeVerificationModal.jsx
│   │   │   │   ├── CashDrawerModal.jsx
│   │   │   │   ├── CloseShiftModal.jsx
│   │   │   │   ├── CustomerLookupModal.jsx
│   │   │   │   ├── DiscountModal.jsx
│   │   │   │   ├── EndOfDayModal.jsx
│   │   │   │   ├── HoldRecallModal.jsx
│   │   │   │   ├── ManagerPinModal.jsx
│   │   │   │   ├── OpenShiftModal.jsx
│   │   │   │   ├── PriceCheckModal.jsx
│   │   │   │   ├── RefundModal.jsx
│   │   │   │   ├── ReprintReceiptModal.jsx
│   │   │   │   ├── TransactionHistoryModal.jsx
│   │   │   │   └── VoidModal.jsx
│   │   │   │   └── ReceiptModal.jsx       # Preview + print receipt
│   │   │   ├── pos/
│   │   │   │   ├── ActionBar.jsx         # Bottom bar — all quick-action buttons
│   │   │   │   ├── CategoryPanel.jsx
│   │   │   │   ├── NumPadInline.jsx      # Inline numeric keypad
│   │   │   │   └── NumpadModal.jsx       # Full-screen numeric input
│   │   │   └── tender/
│   │   │       └── TenderModal.jsx       # Checkout — handles lottery cash-only enforcement
│   │   ├── db/
│   │   │   └── dexie.js                  # IndexedDB schema for offline catalog
│   │   ├── hooks/
│   │   │   ├── useBarcodeScanner.js      # HID/serial barcode scanner listener
│   │   │   ├── useBranding.js            # Store branding, colors, logos
│   │   │   ├── useCatalogSync.js         # Product sync (server → IndexedDB)
│   │   │   ├── useHardware.js            # Hardware detection (printers, drawers, scales)
│   │   │   ├── useOnlineStatus.js        # Internet connectivity monitor
│   │   │   ├── usePOSConfig.js           # POS settings from IndexedDB (incl. lottery config)
│   │   │   ├── useProductLookup.js       # Online fallback product search
│   │   │   └── useScale.js              # Weight scale reading (serial)
│   │   ├── screens/
│   │   │   ├── POSScreen.jsx             # Main POS — 3-zone layout
│   │   │   ├── LoginScreen.jsx
│   │   │   ├── PinLoginScreen.jsx
│   │   │   ├── StationSetupScreen.jsx
│   │   │   └── StoreSelect.jsx
│   │   ├── stores/
│   │   │   ├── useAuthStore.js           # Cashier login, token, offline mode
│   │   │   ├── useCartStore.js           # Cart state (incl. addLotteryItem action)
│   │   │   ├── useLotteryStore.js        # Lottery session tracking
│   │   │   ├── useManagerStore.js        # Manager PIN session
│   │   │   ├── useShiftStore.js          # Shift open/close
│   │   │   ├── useStationStore.js        # Terminal registration + hardware config
│   │   │   └── useSyncStore.js           # Background catalog sync + pending tx count
│   │   └── utils/
│   │       ├── branding.js               # Store branding helpers
│   │       ├── cashPresets.js            # Cash denomination presets
│   │       ├── formatters.js             # Currency, date, percent formatting
│   │       ├── pdf417Parser.js           # PDF-417 driver's license parser (age verify)
│   │       ├── promoEngine.js            # Promo evaluation (excludes lottery items)
│   │       └── taxCalc.js               # Tax calculation engine (EBT exemptions)
│
├── admin-app/                        # Superadmin panel (React 19, Vite 7, port 5175)
│   ├── src/
│   │   ├── pages/                    # 15 admin pages (dashboard, users, orgs, stores, tickets, etc.)
│   │   ├── components/               # AdminSidebar, AdminLayout, StoreveuLogo, RichTextEditor
│   │   ├── services/api.js           # 24+ admin API functions
│   │   └── styles/                   # Light theme (global.css, admin.css)
│   └── vite.config.js
│
├── ecom-backend/                     # E-commerce API (Express, Prisma, port 5005)
│   ├── prisma/schema.prisma          # 8 ecom models (EcomStore, EcomProduct, EcomOrder, etc.)
│   ├── src/
│   │   ├── controllers/              # Storefront, orders, customer auth, analytics, sync
│   │   ├── services/                 # Stock check, email, ISR revalidation
│   │   └── workers/syncWorker.js     # BullMQ consumer for product sync
│   └── uploads/                      # Uploaded store images
│
├── storefront/                       # Customer-facing online store (Next.js, port 3000)
│   ├── pages/                        # SSR pages (products, cart, checkout, account, CMS)
│   ├── components/                   # 15 premium templates, layout, icons
│   ├── lib/                          # API client, cart context, auth context, store resolver
│   └── styles/                       # globals.css, templates.css, cart-drawer.css
│
├── packages/                         # Shared npm workspaces
│   ├── redis/index.js                # Shared ioredis client singleton
│   └── queue/                        # BullMQ queue definitions + producers
│
└── frontend/
    ├── src/
    │   ├── App.jsx                       # All route definitions
    │   ├── components/
    │   │   ├── Sidebar.jsx               # Nav links (incl. Lottery group)
    │   │   ├── Layout.jsx
    │   │   ├── Navbar.jsx
    │   │   ├── StoreSwitcher.jsx         # Multi-store selector
    │   │   ├── SetupGuide.jsx            # Onboarding wizard
    │   │   ├── DatePicker.jsx
    │   │   ├── DocumentUploader.jsx
    │   │   └── DocumentHistory.jsx
    │   ├── contexts/
    │   │   └── StoreContext.js            # Active store context
    │   ├── pages/
    │   │   ├── Lottery.jsx               # Full lottery portal (8 tabs)
    │   │   ├── POSSettings.jsx           # POS config (incl. lottery settings)
    │   │   ├── ReceiptSettings.jsx       # Per-store receipt configuration
    │   │   ├── Dashboard.jsx
    │   │   ├── RealTimeDashboard.jsx
    │   │   ├── SalesAnalytics.jsx
    │   │   ├── ProductCatalog.jsx
    │   │   ├── ProductForm.jsx           # Product create/edit form
    │   │   ├── Promotions.jsx
    │   │   ├── BulkImport.jsx            # CSV/Excel bulk product import
    │   │   ├── EmployeeReports.jsx
    │   │   ├── Transactions.jsx          # POS transaction audit log
    │   │   ├── Customers.jsx
    │   │   ├── OCRPage.jsx
    │   │   ├── StoreManagement.jsx       # Multi-store CRUD
    │   │   ├── StoreBranding.jsx         # Store theme/logo config
    │   │   └── ... (45+ pages total)
    │   └── services/
    │       └── api.js                    # All API calls (incl. 15 lottery functions)
```

---

## 3. Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 16+ (local or cloud)
- Azure Document Intelligence resource (OCR)
- OpenAI API key
- MarktPOS / IT Retail credentials (optional)

### Install & Run

```bash
# 1. Install all dependencies
npm run install:all   # installs root + backend + frontend + cashier-app + admin-app + ecom-backend + storefront

# 2. Set up environment files
cp backend/.env.example backend/.env
# Fill in: DATABASE_URL, JWT_SECRET, AZURE_API_KEY, AZURE_ENDPOINT, OPENAI_API_KEY

# 3. Push database schema
cd backend
npx prisma db push    # NOTE: always use db push, not migrate dev

# 4. Seed initial data
npx prisma db seed           # core data (tax rules, departments, products)
node prisma/seedLottery.js   # Ontario OLGC lottery games + sample data

# 5. Run all apps
cd ..
npm run dev          # starts backend (5000) + frontend (5173) + cashier-app (5174) + admin-app (5175) + ecom-backend (5005) + storefront (3000)
```

> ⚠️ **Always use `npx prisma db push`** — not `prisma migrate dev`. Shadow DB creation is blocked in this environment.

---

## 4. Environment Variables

### Backend (`backend/.env`)
```env
# Core
PORT=5000
DATABASE_URL="postgresql://user:pass@localhost:5432/storv_pos"
CORS_ORIGIN="http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5005"

# Auth (Session 18 hardening)
JWT_SECRET="your-secret-key"           # must match ecom-backend JWT_SECRET
JWT_ACCESS_TTL="8h"                    # access token expiry (default 8h)
APP_SECRET="your-app-secret-key"       # CardPointe credential encryption

# Internal service-to-service (C-1 fix — required)
INTERNAL_API_KEY="your_internal_api_key"   # generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# External services
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT="https://your-resource.cognitiveservices.azure.com/"
AZURE_DOCUMENT_INTELLIGENCE_KEY="..."
OPENAI_API_KEY="sk-..."

# Frontend URLs (email reset links)
FRONTEND_URL="http://localhost:5173"
ADMIN_URL="http://localhost:5175"

# Email / SMTP (password reset, ticket notifications)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="you@example.com"
SMTP_PASS="your_app_password"
SMTP_FROM="noreply@storeveu.com"

# E-commerce sync
ECOM_BACKEND_URL="http://localhost:5005"
REDIS_URL="redis://127.0.0.1:6379"    # optional — enables BullMQ async sync
```

### Ecom Backend (`ecom-backend/.env`)
```env
PORT=5005
DATABASE_URL="postgresql://user:pass@localhost:5432/storeveu_ecom"
POS_BACKEND_URL="http://localhost:5000"
JWT_SECRET="your-secret-key"               # must match backend/.env
INTERNAL_API_KEY="your_internal_api_key"   # must match backend/.env
STOREFRONT_URL="http://localhost:3000"
REVALIDATE_SECRET="any_random_secret_string"
REDIS_URL="redis://127.0.0.1:6379"        # optional
```

### Frontend / Cashier App (`frontend/.env`, `cashier-app/.env`, `admin-app/.env`)
```env
VITE_API_URL="http://localhost:5000/api"
VITE_ECOM_URL="http://localhost:5005"        # portal only (image previews)
VITE_STOREFRONT_URL="http://localhost:3000"  # portal only ("View live store" links)
VITE_PORTAL_URL="http://localhost:5173"      # admin-app only (impersonation)
```

### Storefront (`storefront/.env.local`)
```env
ECOM_API_URL="http://localhost:5005/api"
NEXT_PUBLIC_ECOM_API_URL="http://localhost:5005/api"
NEXT_PUBLIC_ECOM_URL="http://localhost:5005"
REVALIDATE_SECRET="any_random_secret_string"    # must match ecom-backend
```

> ⚠️ **`INTERNAL_API_KEY` is REQUIRED** in both `backend/.env` and `ecom-backend/.env` and **must match exactly**, otherwise the ecom-backend → POS stock-check call at online checkout returns `401 Unauthorized`. This was added in Session 18 to fix the C-1 unauthenticated inventory leak.

---

## 5. Frontend Pages & Routes

| `/` | Home.jsx | Marketing Home |
| `/about` | About.jsx | About Storv |
| `/features` | Features.jsx | Product features |
| `/pricing` | Pricing.jsx | Subscription plans |
| `/contact` | Contact.jsx | Get in touch |
| `/login` | Login.jsx | JWT login |
| `/signup` | Signup.jsx | New org registration |
| `/portal/dashboard` | Dashboard.jsx | KPI overview |
| `/portal/realtime` | RealTimeDashboard.jsx | Live 60s refresh |
| `/portal/sales` | SalesAnalytics.jsx | Weather-correlated sales |
| `/portal/departments` | DepartmentAnalytics.jsx | Dept-level breakdown |
| `/portal/products-analytics` | ProductAnalytics.jsx | Product performance |
| `/portal/predictions` | SalesPredictions.jsx | Holt-Winters forecast |
| `/portal/employees` | EmployeeReports.jsx | Clock-in/out reports |
| `/portal/catalog` | ProductCatalog.jsx | Product management |
| `/portal/promotions` | Promotions.jsx | Promo/deal management |
| `/portal/inventory` | InventoryCount.jsx | Stock counting |
| `/portal/departments-mgmt` | Departments.jsx | Dept management |
| `/portal/vendors` | Vendors.jsx | Vendor list |
| `/portal/vendor/:id` | VendorDetail.jsx | Vendor detail |
| `/portal/customers` | Customers.jsx | Loyalty customers |
| `/portal/ocr` | OCRPage.jsx | Invoice OCR |
| `/portal/invoices` | InvoiceImport.jsx | Invoice management |
| `/portal/pos-settings` | POSSettings.jsx | POS terminal config |
| `/portal/pos-api` | POSAPI.jsx | IT Retail integration |
| `/portal/organisation` | Organisation.jsx | Org settings |
| `/portal/stores` | StoreManagement.jsx | Store management |
| `/portal/users` | UserManagement.jsx | User management |
| `/portal/lottery` | **Lottery.jsx** | Full lottery management |
| `/portal/fees` | **FeesMappings.jsx** | Service fee management |
| `/portal/deposits` | **DepositMapPage.jsx** | Deposit mapping |
| `/portal/bulk-import` | BulkImport.jsx | Bulk product import |
| `/portal/receipt-settings` | **ReceiptSettings.jsx** | Receipt printer config |
| `/portal/branding` | **StoreBranding.jsx** | Store theme & logo |
| `/portal/transactions` | **Transactions.jsx** | POS transaction audit log |
| `/portal/ecomm` | EcommIntegration.jsx | eCommerce sync |

All portal routes are wrapped in `<ProtectedRoute>`.

---

## 6. Cashier App Screens & Modals

### Screens
| Screen | Purpose |
|--------|---------|
| `LoginScreen` | Org + user authentication |
| `StationSetupScreen` | Terminal registration (one-time) |
| `StoreSelect` | Store selection after login |
| `PinLoginScreen` | 4–6 digit cashier PIN login |
| `POSScreen` | Main 3-zone POS layout |

### Modals (20+)
| Modal | Trigger | Description |
|-------|---------|-------------|
| `LotteryModal` | Lottery button | Combined sale + payout, qty-based pricing |
| `LotterySaleModal` | Via LotteryModal | Select game/box, enter quantity |
| `LotteryPayoutModal` | Via LotteryModal | Record payout amount |
| `LotteryShiftModal` | Close Shift / EOD | Per-box ticket scan reconciliation |
| `TenderModal` | Cart checkout | Multi-method payment, lottery cash-only |
| `ReceiptModal` | After tender | Preview + print receipt |
| `DiscountModal` | Discount button | Line or order discounts |
| `RefundModal` | Refund button | Transaction refund |
| `VoidModal` | Void Tx button | Void full transaction |
| `HoldRecallModal` | Hold/Recall button | Park and recall carts |
| `CustomerLookupModal` | Customer button | Loyalty account lookup |
| `PriceCheckModal` | Price Check button | Product price lookup |
| `AgeVerificationModal` | Age-restricted product | DOB/ID verification |
| `ManagerPinModal` | Any locked action | Manager PIN override |
| `OpenShiftModal` | Auto on start | Shift opening count |
| `CloseShiftModal` | Manager only | Shift close + count |
| `CashDrawerModal` | Cash Drop / Paid Out | Mid-shift cash events |
| `TransactionHistoryModal` | History button | Past transaction lookup |
| `ReprintReceiptModal` | Reprint button | Last receipt reprint |
| `EndOfDayModal` | End of Day | EOD report |

---

## 7. Backend API Reference

All routes require `Authorization: Bearer <token>` unless noted.

### Auth `/api/auth`
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/register` | Public | Create org + admin |
| POST | `/login` | Public | Get JWT |
| POST | `/forgot-password` | Public | Password reset |

### POS Terminal `/api/pos-terminal`
| Method | Path | Description |
|--------|------|-------------|
| POST | `/register-station` | Register terminal |
| POST | `/verify-station` | Verify station token |
| POST | `/pin-login` | Cashier PIN auth |
| GET | `/catalog-snapshot` | Full offline catalog |
| POST | `/transactions` | Save cart transaction (supports `lotteryItems[]`) |
| POST | `/transactions/batch` | Bulk sync offline transactions |
| GET | `/transactions` | Transaction history |
| POST | `/transactions/:id/void` | Void transaction |
| POST | `/transactions/:id/refund` | Refund transaction |
| POST | `/shifts` | Open shift |
| PUT | `/shifts/:id` | Update/close shift |
| POST | `/cash-events` | Cash drop / payout |
| GET | `/promotions` | Active promotions |
| GET | `/branding` | Store branding config |
| GET | `/config` | POS station config |
| PUT | `/config` | Save POS station config |
| GET | `/hardware-config` | Hardware settings |
| PUT | `/hardware-config` | Save hardware settings |
| POST | `/print-network` | Print receipt via network printer |
| GET | `/end-of-day` | End of day report |

### Payment `/api/payment`
| Method | Path | Description |
|--------|------|-------------|
| POST | `/pax/sale` | Initiate PAX card sale |
| POST | `/pax/refund` | PAX refund |
| POST | `/pax/void` | PAX void |
| POST | `/pax/test` | PAX connection test |

### Stores `/api/stores`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List stores |
| POST | `/` | Create store |
| PUT | `/:id` | Update store |
| PUT | `/:id/branding` | Update store branding |
| PUT | `/:id/location` | Update store location |
| GET | `/billing-summary` | Billing overview |

### Shifts `/api/pos-terminal`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/shifts/active` | Get active shift |
| POST | `/shifts/open` | Open new shift |
| POST | `/shifts/close` | Close active shift |
| POST | `/shifts/cash-drop` | Record cash drop |
| POST | `/shifts/payout` | Record cash payout |

### Fee Mappings `/api/fees-mappings`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List fee mappings |
| PUT | `/` | Upsert fee mapping |
| DELETE | `/:id` | Delete fee mapping |

### Weather `/api/weather`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/current` | Current weather for store |
| GET | `/range` | Weather history for date range |

### Lottery `/api/lottery`
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/games` | cashier+ | List games (state-filtered) |
| POST | `/games` | manager+ | Create game |
| PUT | `/games/:id` | manager+ | Update game |
| DELETE | `/games/:id` | manager+ | Soft delete game |
| GET | `/boxes` | cashier+ | List boxes |
| POST | `/boxes/receive` | manager+ | Receive box order |
| PUT | `/boxes/:id/activate` | cashier+ | Activate box (inventory → active) |
| PUT | `/boxes/:id` | cashier+ | Update box (slot, current ticket) |
| DELETE | `/boxes/:id` | manager+ | Delete box (**inventory only**) |
| POST | `/transactions` | cashier+ | Create transaction |
| POST | `/transactions/bulk` | cashier+ | Bulk create |
| GET | `/transactions` | manager+ | List transactions |
| GET | `/shift-reports/:shiftId` | cashier+ | Get shift report |
| POST | `/shift-reports` | cashier+ | Save shift report |
| GET | `/shift-reports` | manager+ | List all shift reports |
| GET | `/dashboard` | manager+ | Monthly KPIs |
| GET | `/reports` | manager+ | Date-range report + chart |
| GET | `/commission` | manager+ | Commission report |
| GET | `/settings` | manager+ | Get store lottery settings |
| PUT | `/settings` | manager+ | Update store lottery settings |

### Admin `/api/admin` (superadmin only)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/backup/:target` | Download database backup (main/ecom) |
| GET | `/images/rehost-status` | Global image cache stats |
| POST | `/images/rehost` | Re-host next batch of external images |

### Catalog `/api/catalog`
CRUD for Departments, MasterProducts, StoreProducts, TaxRules, DepositRules, Promotions, Vendors.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/products/:id/image` | Upload product image (multer, 5MB max) |

### Reports `/api/reports`
Sales reports, employee hours, department breakdowns.

### Sales `/api/sales`
Analytics with weather correlation, predictions.

---

## 8. Database Models (Prisma)

### Multi-Tenant Core
| Model | Key Fields |
|-------|-----------|
| `Organization` | id, name, state, country, subscriptionPlan (trial/starter/pro/enterprise) |
| `User` | id, orgId, email, pin, role (cashier/manager/owner/admin/superadmin) |
| `Store` | id, orgId, name, address, state, timezone, pos (JSON), branding (JSON) |
| `UserStore` | userId, storeId (many-to-many) |
| `Station` | id, storeId, name, token, hardwareConfig (JSON — printer, scale, PAX) |

### Catalog & Inventory
| Model | Key Fields |
|-------|-----------|
| `Department` | id, orgId, name, taxClassId, ageRestricted |
| `TaxRule` | id, orgId, storeId, taxClass, rate |
| `DepositRule` | id, orgId, storeId, itemCode, amount |
| `Vendor` | id, orgId, name, contactInfo |
| `MasterProduct` | id, orgId, upc, name, deptId, basePrice, ebtEligible |
| `StoreProduct` | id, storeId, masterProductId, overridePrice, stock |
| `Promotion` | id, orgId, type (sale/BOGO/volume/mix_match/combo), dealConfig (JSON) |
| `RebateProgram` | id, orgId, manufacturer, amount, active |
| `VendorProductMap` | vendorCode, orgId, masterProductId, matchTier |

### POS Operations
| Model | Key Fields |
|-------|-----------|
| `Transaction` | id, storeId, shiftId, total, tenderMethod, lineItems (JSON) |
| `Shift` | id, storeId, stationId, cashierId, openedAt, closedAt, openingFloat |
| `CashDrop` | id, shiftId, amount, reason |
| `CashPayout` | id, shiftId, amount, vendor |
| `Customer` | id, orgId, phone, name, points, balance |
| `ClockEvent` | id, userId, storeId, type (in/out), timestamp |
| `PosToken` | id, userId, token, expiresAt |
| `PosLog` | id, endpoint, method, status, statusCode (TTL 30 days) |

### Lottery Module
| Model | Key Fields |
|-------|-----------|
| `LotteryGame` | id, orgId, storeId, name, gameNumber, ticketPrice, ticketsPerBox, state, isGlobal, active |
| `LotteryBox` | id, storeId, gameId, boxNumber, slotNumber, status, startTicket, currentTicket, lastShiftStartTicket, lastShiftEndTicket, ticketsSold, salesAmount |
| `LotteryTransaction` | id, storeId, shiftId, type (sale/payout), amount, gameId, boxId, ticketCount, posTransactionId |
| `LotteryShiftReport` | id, storeId, shiftId, machineAmount, scannedAmount, boxScans (JSON), totalSales, totalPayouts, netAmount, variance |
| `LotterySettings` | id, storeId (unique), enabled, cashOnly, state, commissionRate, scanRequiredAtShiftEnd |

### Product Image Cache
| Model | Key Fields |
|-------|-----------|
| `GlobalProductImage` | strippedUpc (unique), originalUpc, imageUrl, rehostedUrl, source, productName, brand |

### Documents & OCR
| Model | Key Fields |
|-------|-----------|
| `Invoice` | id, orgId, vendorId, invoiceDate, totalAmount, status, lineItems (JSON), pages (JSON) |
| `Document` | id, orgId, fileName, docType, extractedFields (JSON) |
| `FeeMapping` | id, orgId, label, internalType (bottle_deposit/bag_fee/alcohol_surcharge) |

### Analytics & External
| Model | Key Fields |
|-------|-----------|
| `WeatherCache` | date, lat, lng, maxTemp, precip, wind, conditionCode |
| `ImportJob` | id, orgId, type, successCount, failedCount, skippedCount, errors (JSON) |

### CSV Pipeline (Legacy)
| Model | Key Fields |
|-------|-----------|
| `Upload` | id, orgId, fileName, status (pending/processing/complete/error) |
| `Transform` | id, uploadId, outputFormat, rowsProcessed, warnings (JSON) |
| `DepositMap` | id, orgId, itemCode, depositAmount |

---

## 9. Key Services & Utilities

### Backend
| File | Purpose |
|------|---------|
| `services/marktPOSService.js` | IT Retail API client (auth + product/transaction calls) |
| `services/importService.js` | CSV/Excel bulk import validator & executor |
| `services/salesService.js` | Sales data aggregation and formatting |
| `services/weatherService.js` | Open-Meteo fetch + cache pipeline |
| `services/matchingService.js` | Invoice line item ↔ POS product fuzzy matching |
| `services/gptService.js` | OpenAI GPT-4o-mini for invoice field enrichment |
| `utils/predictions.js` | Holt-Winters Triple Exponential Smoothing |
| `utils/fileProcessor.js` | CSV/Excel parsing + vendor-specific transforms |
| `utils/posScheduler.js` | Auto-refreshes MarktPOS auth tokens |
| `utils/transformer.js` | CSV column mapping orchestrator |
| `utils/transformers/` | Vendor-specific transforms (Agne Foods, Pine State Spirits) |

### Cashier App
| File | Purpose |
|------|---------|
| `services/printerService.js` | ESC/POS receipt builder + USB/Network/QZ printing |
| `services/qzService.js` | QZ Tray WebSocket (printers, serial ports, scales) |
| `utils/promoEngine.js` | Client-side promotion evaluation (skips lottery items) |
| `utils/taxCalc.js` | Tax calculation engine (EBT exemptions, dept rules) |
| `utils/pdf417Parser.js` | PDF-417 driver's license barcode parser |
| `utils/formatters.js` | Currency, date, percent formatters |
| `utils/cashPresets.js` | Smart cash tender quick-button presets |
| `db/dexie.js` | IndexedDB v5: products, promotions, tax rules, deposits, departments, cashiers, scan frequency |
| `hooks/useBarcodeScanner.js` | HID/Serial barcode scanner event handler |
| `hooks/useHardware.js` | Hardware detection (receipt printer, drawer, scale) |
| `hooks/useScale.js` | Magellan serial scale weight reading |
| `hooks/useCatalogSync.js` | Product + department sync (server → IndexedDB) |
| `hooks/usePOSConfig.js` | Reads POS config from IndexedDB (lottery settings included) |
| `hooks/useOnlineStatus.js` | Internet connectivity monitor |
| `electron/main.cjs` | Electron IPC: USB/network printing, drawer kick, app control |
| `electron/preload.cjs` | Context bridge: `window.electronAPI` |

---

## 10. Feature Deep-Dives

### 10.1 Lottery Module

A complete scratch-ticket lottery management system compliant with provincial lottery regulations (Ontario OLGC-modeled).

#### Key Rules
- **Price is locked** to `game.ticketPrice` — cashier enters quantity only; `amount = qty × ticketPrice`
- **Commission is store-level** — set in `LotterySettings.commissionRate`, applied uniformly to all sales; NOT stored per game
- **State-based games** — admin creates games with `state = 'ON'` and `isGlobal = true`; stores see only games matching their `LotterySettings.state`
- **Activated boxes cannot be deleted** — backend enforces; UI hides delete for non-inventory boxes
- **Cash-only enforcement** — if `LotterySettings.cashOnly = true`, `TenderModal` restricts payment methods to Cash only when cart contains lottery items
- **Scan mandate** — if `scanRequiredAtShiftEnd = true`, cashier must enter the last ticket number for every active box before saving the shift report

#### Ticket Sales Calculation (EOD)
```
ticketsSold = lastScannedTicketNumber - box.startTicket
salesAmount = ticketsSold × game.ticketPrice
variance    = scannedTotal - cartTransactionTotal
```

#### Portal (Lottery.jsx — 8 Tabs)
1. **Overview** — Monthly KPIs: total sales, payouts, net revenue, commission earned, active boxes
2. **Games** — Game catalog; admin adds/edits with state + isGlobal fields
3. **Inventory** — Receive box orders; track inventory boxes
4. **Active Tickets** — Activate boxes (assign slot number); mark as depleted
5. **Shift Reports** — EOD reports with box scan data, variance, notes
6. **Reports** — Date-range picker + SVG bar chart + CSV export
7. **Commission** — Store-level commission report with game breakdown
8. **Settings** — Province, commission rate, enable/disable, cash-only, scan mandate

#### Cashier (LotteryModal.jsx)
```
Tab: 🎟️ Sale
  → Select game → Qty picker (− 1 2 3 5 10 +) → Total displayed (qty × price)
  → "Add 3 × $5 Bingo Explosion — $15.00" button

Tab: 💰 Payout
  → Amount numpad → Optional note → "Add Payout — $25.00" button

Both tabs:
  → Items go into cart as isLottery:true line items
  → Session summary shows running total
  → "Done — N items in cart" closes modal
```

---

### 10.2 POS Cart & Tender Architecture

#### Cart Item Types

```js
// Standard product
{
  lineId, productId, name, qty, unitPrice, effectivePrice, lineTotal,
  taxable, ebtEligible, depositAmount, discountEligible,
  discountType, discountValue, promoAdjustment
}

// Lottery item (isLottery: true)
{
  lineId, isLottery: true, lotteryType: 'sale' | 'payout',
  gameId, gameName, qty,
  unitPrice: amount,     // positive for sale, negative for payout
  effectivePrice: amount,
  lineTotal: amount,
  taxable: false,        // lottery is never taxable
  ebtEligible: false,    // lottery is never EBT-eligible
  depositAmount: null,   // no deposit on lottery
  discountEligible: false,
  promoAdjustment: null  // promo engine skips lottery items
}
```

#### TenderModal → Backend Payload
```js
{
  lineItems: items.filter(i => !i.isLottery),     // regular products
  lotteryItems: items.filter(i => i.isLottery).map(i => ({
    type:   i.lotteryType,
    amount: Math.abs(i.lineTotal),
    gameId: i.gameId
  })),
  tenderMethod, amountTendered, changeDue,
  shiftId, stationId, cashierId
}
```

Backend `posTerminalController.createTransaction` saves the main `Transaction` then creates `LotteryTransaction` records linked via `posTransactionId`.

---

### 10.3 Sales Analytics + Weather

`SalesAnalytics.jsx` + `salesController.js` + `weatherService.js`

- Fetches 90-day daily sales from PostgreSQL
- Fetches corresponding daily weather from Open-Meteo (cached in `WeatherCache`)
- Recharts `ComposedChart` shows dual-axis: revenue bars + temperature line
- Calculates Pearson correlation coefficient for rain/cold/heat vs sales impact
- WMO weather code → emoji/label mapping (`utils/weatherIcons.js`)

---

### 10.4 Live Dashboard

`RealTimeDashboard.jsx` — auto-refreshes every 60 seconds

Panels: Today's sales, hourly trend, top products, recent transactions, weather widget, active staff count.

---

### 10.5 Sales Predictions + Residual Analysis

`utils/predictions.js` → `salesController.getPredictions`

- **Holt-Winters Triple Exponential Smoothing** with day-of-week seasonality
- Generates 14-day forward forecast (walk-forward validated)
- **Residual analysis**: Actual vs predicted → identifies anomaly days
- Frontend renders forecast + confidence interval band

---

### 10.6 Invoice OCR Pipeline

`invoiceController.js` + `services/matchingService.js`

1. PDF/image uploaded via Multer
2. Azure Document Intelligence (`prebuilt-invoice`) extracts: vendor, date, line items, amounts
3. GPT-4o-mini enriches ambiguous line items + fuzzy-matches vendor codes to POS products
4. Results stored in `Invoice` model with `status: 'pending' | 'matched' | 'posted'`
5. Portal preview shows side-by-side: OCR extract ↔ POS product match
6. Manager confirms matches → posts to inventory

---

### 10.7 MarktPOS / IT Retail Integration

`services/marktPOSService.js` + `posController.js` + `utils/posScheduler.js`

- Proxies requests to IT Retail REST API v2
- Auto-refreshes auth tokens (stored in `PosToken` table)
- Cashier app uses this for legacy product lookup and historical transactions
- Native PostgreSQL catalog (`MasterProduct`/`StoreProduct`) is the primary catalog going forward

---

### 10.8 CSV Transformer

`utils/fileProcessor.js` + `routes/api.js`

- Upload CSV/Excel → parse → apply vendor-specific transform rules → download transformed file
- Deposit mapping: `DepositMap` table maps item codes → deposit amounts
- Supports multiple vendor formats (extensible: add new transformer in `fileProcessor.js`)

---

## 11. Authentication & Authorization

### JWT Auth
- Token in `Authorization: Bearer <token>` header
- **8-hour access token TTL** (was 30d → 2h in Session 18, then 8h in Session 29). Override with `JWT_ACCESS_TTL` env var.
- Payload: `{ id, orgId, role, storeIds[] }`
- Middleware: `protect` (validates token) + `authorize(...roles)` (role check)
- **Global 401 interceptor** in `frontend/src/services/api.js` clears stale session and redirects to `/login?session=expired&returnTo=...`

### Password Policy (server-enforced)
Validators live in [`backend/src/utils/validators.js`](backend/src/utils/validators.js):
- **8–128 characters**
- Must contain at least 1 uppercase, 1 lowercase, 1 digit, 1 special char
- Applied to: `signup`, `resetPassword`, `createUser` (admin)
- Random temp passwords generated via `crypto.randomInt` in `createUser` (16 chars, policy-compliant)

### Rate Limiting
In-memory fixed-window limiter in [`backend/src/middleware/rateLimit.js`](backend/src/middleware/rateLimit.js). Replace with `express-rate-limit` + Redis store for multi-instance production.

| Limiter | Window | Max | Applied To |
|---|---|---|---|
| `loginLimiter` | 15 min | 5 | `POST /auth/login`, `POST /auth/phone-lookup` |
| `signupLimiter` | 60 min | 10 | `POST /auth/signup` |
| `forgotPasswordLimiter` | 60 min | 3 | `POST /auth/forgot-password` |
| `resetPasswordLimiter` | 15 min | 20 | `POST /auth/reset-password` |
| `pinLimiter` | 5 min | 15 | `POST /pos-terminal/clock`, `POST /pos-terminal/pin-login` |

### RBAC Tiers
```
cashier < manager < owner < admin < superadmin
```
Route guards use `authorize(...roles)`. Financial sign-off routes (PO approve/reject, vendor credit, delete) require `owner+`. Routine writes require `manager+`. See [`backend/src/routes/orderRoutes.js`](backend/src/routes/orderRoutes.js) and [`backend/src/routes/vendorReturnRoutes.js`](backend/src/routes/vendorReturnRoutes.js) for tiered-role examples.

### Internal Service-to-Service
- `POST /api/catalog/ecom-stock-check` requires `X-Internal-Api-Key` header matching `INTERNAL_API_KEY` env var (same value in both `backend/.env` and `ecom-backend/.env`).
- Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### Cashier App PIN Auth
- Cashier registers their 4–6 digit PIN
- PIN stored as bcrypt hash in `User.pin`
- `POST /api/pos-terminal/pin-login` validates PIN → returns short-lived session token
- Station token (long-lived) stored in browser `localStorage`

### Multi-Tenant Scoping
```js
// scopeToTenant middleware injects:
req.orgId   = decoded.orgId              // from JWT
req.storeId = req.headers['x-store-id'] // from request header

// Every controller filters:
prisma.lotteryGame.findMany({ where: { orgId, storeId, ... } })
```

---

## 12. Styling System

### Portal (Dark Glassmorphism)
CSS variables defined in `frontend/src/index.css`:

```css
--bg-primary:       #0d0f14    /* Page background */
--bg-panel:         #13161e    /* Card/panel background */
--bg-card:          #1a1d27    /* Inner card */
--border:           rgba(255,255,255,0.06)
--border-light:     rgba(255,255,255,0.04)
--text-primary:     #e8eaf0
--text-secondary:   #9ca3af
--text-muted:       #6b7280
--green:            #7ac143    /* Brand accent */
--amber:            #f59e0b
--red:              #ef4444
--blue:             #3b82f6
```

Glassmorphism cards:
```css
background: rgba(255,255,255,0.03);
border: 1px solid rgba(255,255,255,0.06);
backdrop-filter: blur(12px);
```

> ⚠️ **Portal modals must use explicit `#ffffff` backgrounds** — CSS variable backgrounds become transparent when inside `position:fixed` overlay containers.

### Cashier App (Dark POS + Light Modals)
- Main POS screen: dark theme matching portal
- All modals: **explicit white `#ffffff` backgrounds**, light UI
- Green (`#16a34a`) = sale / confirm / positive
- Amber (`#d97706`) = payout / warning
- Red (`#ef4444`) = void / error
- All new components use external CSS files with unique class-name prefixes (e.g. `tm-`, `lm-`, `pos-`)

---

## 13. Developer Guides

### Adding a New Portal Page

```jsx
// 1. Create frontend/src/pages/NewFeature.jsx
// Sidebar is provided by the shared Layout wrapper — do NOT import Sidebar here.
export default function NewFeature() {
  return (
    <div className="p-page">
      {/* content */}
    </div>
  );
}

// 2. Add route in frontend/src/App.jsx (nested under the <Layout /> parent route)
<Route path="new-feature" element={<ProtectedRoute><NewFeature /></ProtectedRoute>} />

// 3. Add nav link in frontend/src/components/Sidebar.jsx
{ name: 'New Feature', icon: <IconName size={13} />, path: '/portal/new-feature' }
```

### Adding a New Cashier Modal

```jsx
// 1. Create cashier-app/src/components/modals/NewModal.jsx
// Use white card, light UI, explicit #ffffff

// 2. In POSScreen.jsx
const [showNew, setShowNew] = useState(false);
// ... in JSX:
<NewModal open={showNew} onClose={() => setShowNew(false)} />

// 3. Trigger from ActionBar.jsx
<ACT icon={IconName} label="New Action" onClick={onNewAction} color="var(--green)" />
```

### Adding a New API Endpoint

```js
// 1. backend/src/controllers/newController.js
export const getNewData = async (req, res) => {
  const orgId   = req.orgId;
  const storeId = req.storeId || req.query.storeId;
  const data = await prisma.newModel.findMany({ where: { orgId, storeId } });
  res.json({ success: true, data });
};

// 2. backend/src/routes/newRoutes.js
import { protect, authorize } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { getNewData } from '../controllers/newController.js';
router.get('/', protect, scopeToTenant, getNewData);

// 3. backend/src/server.js
import newRoutes from './routes/newRoutes.js';
app.use('/api/new-feature', newRoutes);

// 4. frontend/src/services/api.js
export const getNewData = (storeId) => api.get('/new-feature', { params: { storeId } }).then(r => r.data);
```

### Updating the Database Schema

```bash
# 1. Edit backend/prisma/schema.prisma

# 2. Push changes (NEVER use migrate dev)
cd backend
npx prisma db push

# 3. Restart backend server to reload Prisma client
```

---

## 14. Hardware Integration

The cashier app includes a full ESC/POS hardware layer that works without browser print dialogs.

### Supported Hardware

| Device | Connection | Implementation |
|--------|-----------|----------------|
| Receipt Printer | USB (Windows) | Electron IPC → PowerShell → winspool.drv |
| Receipt Printer | Network TCP | Electron/Backend → TCP socket port 9100 |
| Receipt Printer | QZ Tray | Browser → QZ Tray bridge → USB driver |
| Cash Drawer | Via printer | ESC/POS `DRAWER_KICK` command (auto on cash tender) |
| Barcode Scanner | HID USB/BT | Global keydown listener (timing-based) |
| Barcode Scanner | Serial | QZ Tray / Web Serial API |
| Weight Scale | Serial (Magellan) | Web Serial API, configurable baud rate |
| Label Printer | Network ZPL | TCP socket to Zebra-compatible printers |
| PAX Terminal | Network IP | Backend API proxy (`/api/payment/pax/*`) |

### Electron Desktop App

The cashier app packages as a Windows desktop app via Electron Builder:

```bash
cd cashier-app
npm run electron:dev    # Dev mode (Vite + Electron)
npm run electron:build  # Production NSIS installer (Windows x64)
```

**App ID:** `com.storeveu.pos` | **Output:** `dist-electron/` | **Persistent config:** `%APPDATA%/storeveu_station.json`

### Receipt Printing

- **Paper widths:** 80mm (42 chars) and 58mm (32 chars)
- **Content:** Store info, cashier, items, discounts, tax breakdown, tender, change, footer
- **End of Day report** prints directly to receipt printer
- **Print performance:** First USB print ~2-3s (compiles DLL), subsequent ~200-400ms

---

## 15. CI/CD & Deployment

**GitHub Actions** (`.github/workflows/deploy.yml`) — auto-deploys on push to `main` with atomic deploys:

1. Backend: `npm ci` → `prisma generate` → `prisma db push` → `pm2 restart`
2. Frontend: `npm ci` → `npm run build` → atomic `mv` + `nginx -s reload`
3. Cashier App: `npm ci` → `npm run build` → atomic `mv` + `nginx -s reload`
4. Admin App: `npm ci` → `npm run build` → atomic `mv` + `nginx -s reload`
5. Ecom Backend: `npm ci` → `prisma generate` → `prisma db push` → `pm2 restart`
6. Storefront: `npm ci` → `npm run build` → `pm2 restart`
7. Health checks: `curl -f` against all endpoints

**Production URLs:**
| Service | URL |
|---------|-----|
| API | `https://api-pos.thefortunetech.com` |
| Dashboard | `https://dashboard.thefortunetech.com` |
| POS Web | `https://pos.thefortunetech.com` |
| Admin | `https://admin.thefortunetech.com` |
| Ecom API | `https://api-ecom.thefortunetech.com` |
| Storefront | `https://*.shop.thefortunetech.com` |

---

## 16. Changelog

### April 2026 — QA & Security Audit (Session 18)

Comprehensive security + functional audit across backend, portal, admin-app, cashier-app, and storefront. **30 of 32** issues fixed in 4 rounds. See CLAUDE.md "Session 18" entries for full details.

#### 🔴 Critical Security (7/7 fixed)

| ID | Issue | Fix |
|---|---|---|
| C-1 | Unauthenticated `ecom-stock-check` inventory leak | `X-Internal-Api-Key` shared-secret check; ecom-backend sends header on every call |
| C-2 | Stored XSS in CMS + Career pages | `DOMPurify.sanitize()` with strict tag/attr allowlist |
| C-3 | RBAC gaps on vendor-return + purchase-order routes | Read/write/owner role tiers applied |
| C-4 | Customer enumeration via `/check-points` | Added `authorize()` role guard |
| C-5 | Broken forgot-password flow (missing frontend page) | New `ResetPassword.jsx` page + route + strength meter |
| C-6 | 30-day JWT TTL | Reduced to 2h via `JWT_ACCESS_TTL` env var |
| C-7 | Weak clock-event station auth | Strict PIN format, station-bound storeId, `pinLimiter` rate limit |

#### 🟠 High Priority (12/12 fixed)

- **H-1** Server-side password policy (`validatePassword` — 8+ chars, upper/lower/digit/special)
- **H-2** Rate limiting on all 5 auth endpoints + PIN endpoints
- **H-3** New `PriceInput` component — replaces `type="number"` across ProductForm, Promotions, Lottery, VendorPayouts, DepositRules, Customers. Blocks scientific notation, negatives, locale issues, wheel-scroll corruption
- **H-4** Cashier VendorPayoutModal, CashDrawerModal, LotteryModal numpads rewritten to cent-based entry (matches TenderModal)
- **H-5** `parsePrice()` helper applied in catalogController — rejects NaN/Infinity with proper 400 errors
- **H-6** Email regex validation + lowercase normalization server-side
- **H-7** Phone validation with `normalizePhone()` → canonical E.164-ish form
- **H-8** Global 401 interceptor in `api.js` — clears stale session + redirects with `returnTo`
- **H-9** Seed scripts no longer log plaintext passwords (written to gitignored `.seed-credentials`)
- **H-10** Silent `.catch(() => {})` replaced in POSScreen + BulkImport
- **H-11** Storefront signup shows "Awaiting approval" state instead of premature account redirect

#### 🟡 Medium (7/9 fixed)

- **M-1** Admin Login password show/hide toggle
- **M-2** ProductForm unsaved-changes warning (`beforeunload` + guarded Cancel)
- **M-3** Duplicate UPC error display (backend 409 → toast)
- **M-4** Pack-size validation (unitCount ≥ 1, price > 0, at most one default)
- **M-5** Extended ProductForm save guards (covered by M-4)
- **M-8** Random crypto-generated admin temp password (replaces hardcoded `Temp@1234`)
- **M-9** Modal overlay CSS vars (`--modal-overlay`, `--modal-shadow`)

Deferred: **M-6** (httpOnly cookie migration — 1–2 sprint refactor) and **M-7** (Stripe Elements iFrame — requires merchant onboarding). Both mitigated by other Session 18 fixes.

#### 🟢 Low Priority (4/4 fixed)

- **L-1** ProductForm DeptManager/VendorManager inline styles → `pf-mm-*` external CSS (120+ inline style props removed)
- **L-2** Storefront responsive breakpoints at 1024/768/480 (125 lines added to `globals.css`)
- **L-3** Main-content uses robust `flex: 1 1 0; min-height: 0` pattern (was `height: 100vh`)
- **L-4** `$` prefix wrapper on VendorPayouts amount input

#### New Files

| File | Purpose |
|---|---|
| `backend/src/utils/validators.js` | Shared email/password/phone/price validators |
| `backend/src/middleware/rateLimit.js` | In-memory rate limiter (5 tiers) |
| `frontend/src/components/PriceInput.jsx` | Safe price input replacement for `type="number"` |
| `frontend/src/pages/ResetPassword.jsx` + `.css` | Password reset flow with strength meter |

#### Deployment Notes

1. **Set `INTERNAL_API_KEY`** in both `backend/.env` and `ecom-backend/.env` (must match)
2. **All existing sessions invalidate on deploy** due to JWT TTL change (30d → 2h) — users will need to re-login
3. **Rate limiters are in-memory** — restarting the backend resets counters. For multi-instance production, swap to Redis-backed limiter
4. **DOMPurify** is already a frontend dependency — no install step needed

---

### April 2026 — Hardware Integration & Electron Build

#### Hardware & Printing
- **Receipt printer configuration** — Station-level setup for USB (PowerShell/winspool), Network (TCP:9100), and QZ Tray printers.
- **ESC/POS receipt builder** — Full receipt generation with store info, line items, tax/deposit breakdown, tender, and footer.
- **Cash drawer integration** — ESC/POS drawer kick via receipt printer (auto on cash tender, manual via No Sale).
- **Barcode scanner support** — HID keyboard emulation with timing-based detection + QZ Tray serial port.
- **Weight scale integration** — Magellan/Datalogic serial scales via Web Serial API.
- **PAX payment terminal** — Backend API proxy for sale/refund/void (A920, A35, A80, S300).
- **Label printer** — ZPL printing via network TCP to Zebra-compatible printers.

#### Electron Desktop App
- **Electron 33** wrapper for cashier-app with native IPC for USB/network printing.
- **NSIS installer** for Windows x64 (`com.storeveu.pos`).
- **Persistent config** — Station hardware settings backed up to `%APPDATA%/storeveu_station.json`.
- **Preload context bridge** — `window.electronAPI` for secure IPC communication.

#### Receipt Settings (Portal)
- **Per-store receipt configuration** — Print behaviour (always/ask/never), paper width, store info, custom header/footer lines, return policy.
- **Branding sync** — Primary colour and logo text synced from portal to POS receipt.

#### CI/CD
- **GitHub Actions deploy pipeline** — Auto-deploy backend, frontend, and cashier-app on push to `main`.
- **Health check verification** — Automated curl checks against production endpoints.

### April 2026 — Marketing Site & UX Overhaul

#### Marketing Site
- Added complete multi-page public marketing site (`/`, `/about`, `/features`, `/pricing`, `/contact`).
- Responsive interactive design with Framer Motion animations.
- Centralized `Link` navigation for zero-reload browsing.

#### New Portal Modules
- **Fees & Mappings:** New module for managing service fees and delivery charges.
- **Deposit Mapping:** Advanced tool for mapping container deposits across multi-state operations.

#### Performance & Sync
- **PostgreSQL Stability:** Synchronized Prisma schema with PostgreSQL; switched to `npx prisma db push` as the primary sync method.
- **Delivery Standardisation:** Implemented `FareCalculationService` as single source of truth for all pricing.

### April 2026 — Lottery Module (Full Build)

#### New Files
| File | Description |
|------|-------------|
| `backend/src/controllers/lotteryController.js` | Complete lottery CRUD + reports |
| `backend/src/routes/lotteryRoutes.js` | 20 routes under `/api/lottery` |
| `backend/prisma/seedLottery.js` | 20 Ontario OLGC games + 458 sample transactions |
| `cashier-app/src/components/modals/LotteryModal.jsx` | Combined Sale+Payout modal |
| `cashier-app/src/components/modals/LotteryShiftModal.jsx` | EOD ticket scan reconciliation |
| `cashier-app/src/stores/useLotteryStore.js` | Lottery session Zustand store |
| `frontend/src/pages/Lottery.jsx` | Full lottery portal (8 tabs) |

#### Updated Files
| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | +5 lottery models: LotteryGame, LotteryBox, LotteryTransaction, LotteryShiftReport, LotterySettings |
| `backend/src/server.js` | Mount `/api/lottery` routes |
| `backend/src/controllers/posTerminalController.js` | Accept `lotteryItems[]` in transaction payload |
| `cashier-app/src/stores/useCartStore.js` | `addLotteryItem()` action |
| `cashier-app/src/components/cart/CartItem.jsx` | Render lottery item type |
| `cashier-app/src/components/pos/ActionBar.jsx` | Single "Lottery" button → combined modal |
| `cashier-app/src/components/tender/TenderModal.jsx` | Extract lottery items; cash-only enforcement |
| `cashier-app/src/hooks/usePOSConfig.js` | `lottery.cashOnly`, `lottery.scanRequiredAtShiftEnd` defaults |
| `cashier-app/src/screens/POSScreen.jsx` | Lottery modal wiring; active box loading |
| `cashier-app/src/api/pos.js` | `getLotteryGames`, `getLotteryBoxes`, lottery transaction APIs |
| `frontend/src/services/api.js` | 15 lottery API functions + `lotteryUnwrap` helper |
| `frontend/src/components/Sidebar.jsx` | Lottery nav group |
| `frontend/src/App.jsx` | `/portal/lottery` route |
| `frontend/src/pages/POSSettings.jsx` | Lottery settings: enable, cash-only, scan mandate |

#### Key Design Decisions
- **Price locked to game** — cashier enters qty only; `price = qty × ticketPrice`
- **Store-level commission** — `LotterySettings.commissionRate` applies to all sales; removed from individual games
- **State-scoped games** — global games (isGlobal=true) visible only to matching-state stores
- **Activated box protection** — boxes in active/depleted/settled state cannot be deleted (backend + UI)
- **EOD scan workflow** — each active box requires last ticket # entry; calculates `ticketsSold = end - start`
- **Cart integration** — lottery items are cart line items (`isLottery:true`); tender splits them out for `LotteryTransaction` creation

---

### April 2026 — Multi-UPC, Pack Sizes & Product Form Redesign

#### Schema Additions
- **ProductUpc** model — multiple barcodes per product (`@@unique([orgId, upc])`)
- **ProductPackSize** model — selectable pack sizes at POS (label, unitCount, retailPrice, isDefault)
- **MasterProduct** fields — `unitPack`, `packInCase`, `depositPerUnit` for simplified pack/deposit config

#### Backend
- 7 new API routes under `/catalog/products/:id/upcs` and `/catalog/products/:id/pack-sizes`
- Barcode search now checks `ProductUpc` table first, then falls back to `MasterProduct.upc`
- All product responses include `upcs[]` and `packSizes[]`

#### Portal — Product Form Redesign
- **Multi-UPC manager** — add/remove barcodes per product with labels
- **Pack Sizes manager** — define cashier picker variants (Single, 6-Pack, 12-Pack, etc.)
- **Simplified pack config** — `unitPack` + `packInCase` chip selectors
- **Simplified deposit** — flat `depositPerUnit` with quick-set buttons ($0.05/$0.10/$0.15/$0.20)
- Full external CSS (`ProductForm.css`, `pf-` prefix)

#### Cashier App
- **PackSizePickerModal** — shown at scan when product has 2+ sizes; tappable grid buttons
- Smart scan flow: multi-size → picker modal; single size → silent apply; no sizes → normal flow

### April 2026 — Admin Panel & Support Tickets

#### Admin Panel (`admin-app/`)
- Standalone React + Vite app (port 5175), superadmin-only
- Light theme, enhanced dashboard with charts and recent activity tables
- Full CRUD for Users, Organizations, Stores
- Login-as-User impersonation, email notifications on approve/reject/suspend
- Support ticket management with conversation threads

#### Support Tickets (Portal)
- Store-side ticket creation, threaded conversations with admin
- Status filter tabs, priority badges, auto-attached user context

#### Email System
- Centralized `emailService.js` with 8 branded HTML templates
- Forgot/reset password flow, signup notifications, contact form confirmations

#### Vendor Auto-Ordering (Purchase Orders)
- **14-factor demand-driven reorder engine** analyzes sales velocity, Holt-Winters forecast, day-of-week patterns, holidays, weather, current inventory, lead time, safety stock, pack sizes, minimum orders, shelf life, demand variability, and stockout history
- **Service level tiers**: Critical (98%), Standard (95%), Low (90%) controlling safety stock depth
- **Safety stock formula**: `Z × σ(dailyDemand) × √(leadTime)` — adapts to demand variability and vendor lead times
- **Purchase order lifecycle**: Generate suggestions → Create draft PO → Edit/review → Submit → Receive (full/partial) → Inventory updated
- **PO PDF generation**: Server-side PDFKit with store letterhead, vendor details, line items table, totals
- **Vendor extensions**: Lead time days, minimum order amount, order frequency, delivery days
- 3-tab UI: Suggestions (algorithm output), Purchase Orders (active PO management), History (archive)

#### Live Dashboard & Weather Integration
- **Weather widget**: Current conditions, 48-hour hourly strip, 10-day forecast from Open-Meteo (free, no API key)
- **Date picker**: View any historical date's dashboard with weather for that day
- **Auto-refresh**: 60-second countdown only when viewing today
- **Hourly sales chart**: All 24 hours with transaction count overlay
- **Payment PieChart**: Cash/Card/EBT donut chart with percentages

#### Sales Predictions (Enhanced)
- **4-tab forecast**: Hourly, Daily (30d), Weekly (12w), Monthly (6m)
- **Weather-adjusted predictions**: Correlates historical sales with weather to compute rain/snow/cold/heat impact coefficients
- **Factor badges**: Each predicted day shows weather icon, holiday badge, weekend indicator, trend arrow
- **Hourly predictions**: Learns store's hourly sales distribution pattern, breaks daily forecast into 24-hour view
- **Accuracy metrics**: MAPE, MAE, RMSE from walk-forward validation

#### Export System
- **CSV/PDF export** on all analytics pages (Dashboard, Sales, Departments, Products, Predictions)
- Frontend: `jspdf` + `jspdf-autotable` for styled PDF tables, `file-saver` for downloads
- Backend: `pdfkit` for server-side PO PDF generation

#### Bag Fee System (POS)
- Cashier-facing (+)/(−) bag counter above payment buttons
- Store-level config: price per bag, EBT eligible toggle, discountable toggle
- Integrated into cart totals, transaction record (synthetic line item), and receipts

#### Customer Display Screen (POS)
- Read-only second-screen display for customer-facing monitor
- Real-time sync via BroadcastChannel API (zero-latency, same-origin)
- Auto-opens fullscreen on secondary monitor in Electron
- Three states: Idle (welcome), Active (live cart with totals), Thank You (change due)

#### Sidebar Reorganization
- Consolidated from 42 items → ~19 items across 10 groups
- Related pages combined into tabbed views (like Lottery pattern)
- Shared `portal.css` with `p-` prefix for all tabbed pages
- Backwards-compatible: old URLs redirect to new tabbed pages with `?tab=` params

#### Billing & Subscription System (Release 3)
- Subscription plans, add-ons, org-level subscriptions
- Automated billing scheduler (trial expiry, invoicing, retry logic)
- Equipment shop with CardSecure tokenized checkout
- Admin billing console (plans, subscriptions, invoices, equipment)

#### Label Design & Printing
- Visual shelf label designer with live preview
- 10 industry-standard Zebra-compatible label sizes (1.5"×1" to 4"×6")
- 10 variable fields: Product Name, Brand, Size, UPC Barcode, UPC Text, Price, Sale Price, PLU, Department, Aisle
- Position units: pt, px, mm, or raw dots with DPI selector (203/300/600)
- Font sizes in proper points (6pt through 48pt)
- ZPL code generation for Zebra label printers via TCP
- Default template system — star a template for auto-use during printing
- 4 built-in templates: Standard Shelf Tag, Price Tag, Sale Price Tag, Barcode Label
- Templates persist in localStorage, customizable per store

#### Label Queue (Auto-Detection)
- **Auto-detects price changes** — hooks into `updateMasterProduct`, `bulkUpdateMasterProducts`, `upsertStoreProduct`
- **Auto-detects new products** — hooks into `createMasterProduct`
- **Sale detection** — queues labels when sale price is set or sale ends
- **Manual add** — search or scan barcodes to add products to queue
- **Barcode scanner support** — scans auto-detected (fast input + Enter) and added without clicking
- Inline price editing — change price in queue, updates product catalog automatically
- Grouped by reason: Price Changes (amber), New Products (blue), Sales (purple), Manual (gray)
- Age indicators: >24h amber, >48h red highlighting
- Batch print/dismiss with checkbox selection

#### Employee Management
- **3-tab hub**: Team | Timesheets | Shifts
- **Team tab**: Employee list, role badges (Owner/Admin/Manager/Cashier), PIN management, store assignment, activate/deactivate
- **Timesheets tab**: Unified hours + sales report with expandable per-employee sessions, PDF export
- **Shifts tab**: Full CRUD for clock sessions — add/edit/delete shifts manually, employee filter, date range

#### Shift Management
- Add manual clock-in/out sessions for employees
- Edit existing shift times
- Delete erroneous clock entries
- Employee filter dropdown + date range picker
- Sessions table with duration calculation

---

## 📁 Project File Structure

```
Storv_POS_All/
├── backend/                          # Express + Prisma + PostgreSQL
│   ├── prisma/
│   │   ├── schema.prisma             # Full data model (~2000 lines)
│   │   ├── seed.js                   # Department/tax/deposit seed
│   │   ├── seedTransactions.js       # Generate ~3,900 dummy POS transactions
│   │   └── migrations/
│   │       ├── add_purchase_orders.sql
│   │       ├── add_label_queue.sql
│   │       ├── add_billing_equipment_models.sql
│   │       └── fix_billing_column_names.sql
│   ├── src/
│   │   ├── server.js                 # Express app entry point
│   │   ├── config/postgres.js        # Prisma client singleton
│   │   ├── middleware/               # auth, scopeToTenant, attachPOSUser
│   │   ├── controllers/
│   │   │   ├── salesController.js    # Analytics + realtime + predictions
│   │   │   ├── catalogController.js  # Product CRUD + label queue hooks + image fallback
│   │   │   ├── backupController.js   # Database backup (pg_dump streaming)
│   │   │   ├── orderController.js    # Purchase order lifecycle + PDF
│   │   │   ├── paymentController.js  # CardPointe terminal charges
│   │   │   ├── posTerminalController.js  # POS transactions + label printing
│   │   │   ├── billingController.js  # Subscription billing
│   │   │   ├── adminController.js    # Superadmin operations
│   │   │   └── ...
│   │   ├── services/
│   │   │   ├── salesService.js       # Prisma-native sales aggregation
│   │   │   ├── orderEngine.js        # 14-factor auto-reorder algorithm
│   │   │   ├── globalImageService.js # Cross-org product image cache by UPC
│   │   │   ├── imageRehostService.js # Download external images to local storage
│   │   │   ├── labelQueueService.js  # Label queue CRUD + auto-detection
│   │   │   ├── weatherService.js     # Open-Meteo integration + caching
│   │   │   ├── cardPointeService.js  # CardPointe gateway + terminal API
│   │   │   ├── billingService.js     # Subscription charging
│   │   │   ├── billingScheduler.js   # Daily billing cron
│   │   │   └── ...
│   │   ├── routes/
│   │   │   ├── salesRoutes.js        # /api/sales/*
│   │   │   ├── orderRoutes.js        # /api/vendor-orders/*
│   │   │   ├── labelQueueRoutes.js   # /api/label-queue/*
│   │   │   ├── billingRoutes.js      # /api/billing/*
│   │   │   ├── catalogRoutes.js      # /api/catalog/*
│   │   │   ├── paymentRoutes.js      # /api/payment/*
│   │   │   └── ...
│   │   └── utils/
│   │       └── predictions.js        # Holt-Winters + weather impact + holidays
│   └── package.json
│
├── frontend/                         # React 19 + Vite portal
│   ├── src/
│   │   ├── App.jsx                   # All routes + ProtectedRoute
│   │   ├── styles/
│   │   │   └── portal.css            # Shared CSS (`p-` prefix) for all pages
│   │   ├── components/
│   │   │   ├── Sidebar.jsx           # 10-group navigation (~19 items)
│   │   │   ├── Layout.jsx            # Sidebar + Outlet wrapper
│   │   │   ├── BillingBanner.jsx     # Past-due/suspended warning
│   │   │   ├── WeatherWidget.jsx     # Current + hourly + 10-day forecast
│   │   │   ├── StoreSwitcher.jsx     # Multi-store selector
│   │   │   └── EcomOrderNotifier.jsx # Real-time order toasts
│   │   ├── pages/
│   │   │   ├── RealTimeDashboard.jsx # Live dashboard + weather + date picker
│   │   │   ├── AnalyticsHub.jsx      # Tabs: Sales, Departments, Products, Predictions
│   │   │   ├── SalesAnalytics.jsx    # Revenue trends + weather correlation
│   │   │   ├── SalesPredictions.jsx  # 4-tab: Hourly, Daily, Weekly, Monthly
│   │   │   ├── POSConfig.jsx         # Tabs: Layout, Receipts, Quick Keys, Labels
│   │   │   ├── POSReports.jsx        # Tabs: Transactions, Event Log, Payouts
│   │   │   ├── RulesAndFees.jsx      # Tabs: Deposit Rules, Tax Rules
│   │   │   ├── CustomersHub.jsx      # Tabs: Customers, Loyalty Program
│   │   │   ├── AccountHub.jsx        # Tabs: Organisation, Users, Stores, Settings
│   │   │   ├── VendorOrderSheet.jsx  # Tabs: Suggestions, Purchase Orders, History
│   │   │   ├── LabelDesign.jsx       # Visual label designer + ZPL generator
│   │   │   ├── LabelQueue.jsx        # Auto-detected label print queue
│   │   │   ├── EmployeeManagement.jsx# Tabs: Team, Timesheets, Shifts
│   │   │   ├── ShiftManagement.jsx   # Clock session CRUD
│   │   │   ├── SupportTickets.jsx    # Ticket creation + threaded chat
│   │   │   ├── Lottery.jsx           # 10-tab lottery management
│   │   │   ├── BillingPortal.jsx     # Subscription + invoices
│   │   │   └── ...
│   │   ├── services/
│   │   │   └── api.js                # Axios client + all API functions
│   │   └── utils/
│   │       └── exportUtils.js        # CSV/PDF download helpers
│   └── package.json
│
├── cashier-app/                      # Standalone POS terminal (Vite + Electron)
│   ├── electron/
│   │   ├── main.cjs                  # Electron main process + customer display
│   │   └── preload.cjs               # IPC bridge (printers, drawer, display)
│   ├── src/
│   │   ├── App.jsx                   # State machine + hash routing
│   │   ├── screens/
│   │   │   ├── POSScreen.jsx         # Main POS terminal
│   │   │   ├── CustomerDisplayScreen.jsx # Read-only second screen
│   │   │   ├── PinLoginScreen.jsx    # Cashier PIN entry
│   │   │   └── StationSetupScreen.jsx# One-time station config
│   │   ├── stores/
│   │   │   └── useCartStore.js       # Zustand cart (items, bags, loyalty)
│   │   ├── hooks/
│   │   │   ├── usePOSConfig.js       # POS layout + bag fee config
│   │   │   ├── useBroadcastSync.js   # Customer display sync
│   │   │   └── useHardware.js        # Printer, drawer, scale
│   │   └── components/
│   │       ├── cart/BagFeeRow.jsx     # Bag (+)/(−) counter
│   │       ├── cart/CartTotals.jsx    # Totals with bags
│   │       ├── tender/TenderModal.jsx # Payment flow
│   │       └── pos/ActionBar.jsx      # Bottom action bar
│   └── package.json
│
├── admin-app/                        # Superadmin panel (Vite)
├── ecom-backend/                     # E-commerce API (Express)
├── storefront/                       # Customer storefront (Next.js)
├── CLAUDE.md                         # AI session context (auto-loaded)
├── README.md                         # This file
├── ENGINEERING_PRINCIPLES.md         # Development standards
└── ECOMMERCE_GUIDE.md               # E-commerce module docs
```

---

### April 2026 — Session 29: Image System, Backup, UI Consistency

#### Product Image System (3 Phases)
- **Phase 1 — Import**: `imageUrl` field mapped during CSV/Excel bulk import (aliases: image, images, photourl, etc.)
- **Phase 2 — Global UPC Cache**: `GlobalProductImage` table keyed by stripped UPC; auto-populated on import/create/update; cross-org image sharing via `batchResolveProductImages()`
- **Phase 3 — Re-hosting**: Background download of external images to `backend/uploads/product-images/`; admin UI with stats + trigger button; protects against CDN deletion
- **Product Form**: New image card with preview, URL input, file upload (5MB), remove button

#### Database Backup (Admin Panel)
- Manual pg_dump from System Config page — streams SQL directly to browser download
- Auto-discovers `pg_dump.exe` on Windows (scans `C:\Program Files\PostgreSQL\{ver}\bin\`)
- Supports both main DB and ecom DB; filename: `{db}-backup-DD-MM-YYYY.sql`

#### UPC Normalization
- New `stripUpc()` utility — removes ALL leading zeros for consistent cross-org matching
- Existing `normalizeUPC()` (EAN-13) + `upcVariants()` (15+ format variants) unchanged

#### Admin UI Consistency
- Fixed table header background boxes (misused `.admin-header-icon` class)
- Added `.admin-header-actions`, `.admin-name-cell`, `.admin-row-actions` classes
- Standardized filter tab `border-radius: 8px` (was mixed pill/rectangle)
- Replaced hardcoded colors with CSS variables across AdminTickets, AdminBilling, AdminPaymentSettings

#### Button Hover Contrast
- Fixed invisible-text-on-hover bug in 11 files — every active filter tab/button now has `.active:hover` guard

#### CSS Variable Centralization
- `--content-max-width: 1400px` (portal + admin), `--mkt-max-width: 1200px` (marketing) — 22 files updated
- Horizontal scroll prevention: `overflow-x: hidden` on `.main-content`

#### Mobile Responsiveness
- Added 480px breakpoint: `.main-content` padding `0.625rem`, compact headers/tables/buttons
- TaxRules/DepositRules: hardcoded colors → CSS variables
- StoreSettings: 640px compact breakpoint

#### Dashboard Showcase (Marketing Home)
- 6-tab screenshot showcase in PC monitor mockup with side-by-side layout
- Tabs: Live Dashboard, Analytics, Products, Transactions, Employees, Vendor Orders

#### JWT TTL
- Changed from 2h → 8h (full workday). `.env` + `.env.example` updated.

#### Seed Script
- New `seedToday.js` — generates 35-50 transactions for today with realistic hourly distribution

---

*Built with care — Storeveu POS v2.0*
