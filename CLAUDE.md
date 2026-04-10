# CLAUDE.md — AI Session Context File
# Storv POS / Future Foods Portal

> **This file is read automatically by Claude Code at the start of every session.**
> It keeps Claude aligned with the project's vision, conventions, and current state
> so every session produces consistent, high-quality results.

---

## 🎯 Vision & Mission

**Product:** Storv — A full-featured, multi-tenant retail POS and business intelligence platform built for independent convenience, grocery, and liquor stores.

**Mission:** Replace expensive legacy POS back-office software with a modern, affordable, cloud-first platform that gives small store owners the same analytics, compliance tools, and operational efficiency as big-box retailers.

**Core Pillars:**
1. **Speed** — Zero-latency POS checkout (offline-first Cashier App)
2. **Intelligence** — Sales analytics, weather correlation, Holt-Winters predictions
3. **Compliance** — Age verification, EBT/SNAP rules, deposit/CRV handling, lottery regulations
4. **Simplicity** — One platform to manage catalog, vendors, invoices, staff, and reports

---

## 🏗 Architecture at a Glance

```
┌─────────────────────────────────────────────────────┐
│  Portal (frontend/)          React 19 + Redux Toolkit │
│  Management UI, Analytics,   Vite 7, React Router v6  │
│  Reports, Settings           Port 5173                │
├─────────────────────────────────────────────────────┤
│  Admin Panel (admin-app/)    React 19 + React Router  │
│  Superadmin-only dashboard,  Vite 7, Axios, Recharts  │
│  User/Org/CMS management    Port 5175                │
├─────────────────────────────────────────────────────┤
│  Cashier App (cashier-app/)  React 18 + Zustand       │
│  POS Terminal, Cart, Tender  Dexie.js (IndexedDB)     │
│  Offline-first PWA           Port 5174                │
├─────────────────────────────────────────────────────┤
│  Backend (backend/)          Express 4 + Prisma 5     │
│  REST API, Auth, OCR         PostgreSQL 16            │
│  Multi-tenant                Port 5000                │
└─────────────────────────────────────────────────────┘
```

**Multi-tenant:** Every DB record is scoped to `orgId` + `storeId`. JWT includes `orgId`. Header `X-Store-Id` scopes to a store.

---

## 🗂 Key File Map

### Backend
| File | Purpose |
|------|---------|
| `backend/src/server.js` | Express app, all route mounts |
| `backend/src/config/postgres.js` | Prisma client singleton |
| `backend/prisma/schema.prisma` | Full DB schema (36+ models) |
| `backend/src/middleware/auth.js` | JWT `protect` + `authorize()` |
| `backend/src/middleware/scopeToTenant.js` | `req.orgId`, `req.storeId` injection |
| `backend/src/controllers/lotteryController.js` | Full lottery module logic |
| `backend/src/controllers/posTerminalController.js` | Cashier app API (creates transactions, deducts stock on sale, handles lottery items). `listTransactions` supports: dateFrom/dateTo, cashierId, stationId, status, amountMin, amountMax; returns subtotal/taxTotal/depositTotal/ebtTotal |
| `backend/src/controllers/feeMappingController.js` | Service fees and delivery charges |
| `backend/src/controllers/catalogController.js` | Product catalog CRUD |
| `backend/src/controllers/salesController.js` | Analytics + Holt-Winters predictions. `realtimeSales` (GET /sales/realtime) is rewritten to use native Prisma transactions — returns today's KPIs, hourly breakdown, top products, recent tx feed, 14-day trend, and today's lottery summary |
| `backend/src/controllers/customerController.js` | Full CRUD: `getCustomers` (supports `q`/`name`/`phone`/`email` search, OR across all fields), `getCustomerById`, `createCustomer`, `updateCustomer`, `deleteCustomer` (soft), `checkPoints` |
| `backend/src/routes/customerRoutes.js` | GET (cashier+), POST (cashier+ for quick-add), PUT/DELETE (manager+) — all require JWT `protect` |
| `backend/src/controllers/vendorPaymentController.js` | Back-office vendor payment records (no shift required) |

### Portal (frontend/)
| File | Purpose |
|------|---------|
| `frontend/src/App.jsx` | All route (portal + marketing) definitions |
| `frontend/src/components/Sidebar.jsx` | Nav links — grouped: Operations/Lottery/Catalog/Vendors/Analytics/Integrations/POS/Account |
| `frontend/src/services/api.js` | Single source of truth for ALL API calls |
| `frontend/src/pages/marketing/` | Public site: Home, About, Features, Pricing, Contact |
| `frontend/src/pages/Lottery.jsx` | Full lottery management (8 tabs) |
| `frontend/src/pages/FeesMappings.jsx` | Service fees and tax mapping |
| `frontend/src/pages/POSSettings.jsx` | Per-station POS config (action bar height, quick folders link) |
| `frontend/src/pages/ProductCatalog.jsx` | Native PG catalog management |
| `frontend/src/pages/VendorPayouts.jsx` | Back-office vendor payment management with date picker |
| `frontend/src/pages/VendorPayouts.css` | Styles for VendorPayouts page (`vp-` prefix) |
| `frontend/src/pages/QuickAccess.jsx` | Back-office quick folder config (folder + product management) |
| `frontend/src/pages/QuickAccess.css` | Styles for QuickAccess page (`qa-` prefix) |
| `frontend/src/pages/Transactions.jsx` | Full transaction browser — advanced filters, receipt modal, real-time refresh |
| `frontend/src/pages/Transactions.css` | Styles for Transactions page (`txn-` prefix) — includes `@media print` receipt styles |
| `frontend/src/pages/PosEventLog.jsx` | POS Event Log — back-office view of No Sale events and future cashier events |
| `frontend/src/pages/PosEventLog.css` | Styles for PosEventLog page (`pel-` prefix) |
| `frontend/src/pages/Customers.jsx` | Full customer CRUD — paginated list, add/edit modal (name, phone, email, card, discount, balance, charge account toggle), view profile with points history, soft delete. No Redux — uses local state + direct API calls |
| `frontend/src/pages/Customers.css` | Styles for Customers page (`cust-` prefix) |
| `frontend/src/pages/RealTimeDashboard.jsx` | Live Dashboard — KPIs, payment breakdown, hourly sales chart, live transaction feed, top products today, 14-day trend. All powered by native Prisma `Transaction` queries via `GET /api/sales/realtime` |
| `frontend/src/pages/RealTimeDashboard.css` | Styles for Live Dashboard (`rtd-` prefix) |

### Admin Panel (admin-app/)
| File | Purpose |
|------|---------|
| `admin-app/src/App.jsx` | Route definitions + ProtectedRoute (superadmin-only) |
| `admin-app/src/pages/Login.jsx` | Superadmin login — no signup, rejects non-superadmin |
| `admin-app/src/pages/Login.css` | Login page styles (`al-` prefix) |
| `admin-app/src/pages/AdminDashboard.jsx` | Admin overview with stat cards |
| `admin-app/src/pages/AdminUsers.jsx` | User approval / suspension management |
| `admin-app/src/pages/AdminOrganizations.jsx` | Organization management |
| `admin-app/src/pages/AdminAnalytics.jsx` | Analytics overview with charts |
| `admin-app/src/pages/AdminOrgAnalytics.jsx` | Organization-level analytics |
| `admin-app/src/pages/AdminStorePerformance.jsx` | Store performance metrics |
| `admin-app/src/pages/AdminUserActivity.jsx` | User activity tracking |
| `admin-app/src/pages/AdminCmsPages.jsx` | CMS page editor |
| `admin-app/src/pages/AdminCareers.jsx` | Career posting management |
| `admin-app/src/pages/AdminCareerApplications.jsx` | Job application management |
| `admin-app/src/pages/AdminTickets.jsx` | Support ticket management |
| `admin-app/src/pages/AdminSystemConfig.jsx` | System configuration |
| `admin-app/src/components/AdminSidebar.jsx` | Admin navigation sidebar |
| `admin-app/src/components/StoreveuLogo.jsx` | Brand logo SVG component |
| `admin-app/src/components/RichTextEditor.jsx` | Quill-based rich text editor |
| `admin-app/src/services/api.js` | Axios client + 24 admin API functions |
| `admin-app/src/styles/global.css` | Dark theme design tokens + layout |
| `admin-app/src/styles/admin.css` | Admin component styles |

### Cashier App (cashier-app/)
| File | Purpose |
|------|---------|
| `cashier-app/src/screens/POSScreen.jsx` | Main POS screen — 3-zone layout; CATALOG/QUICK tab bar |
| `cashier-app/src/stores/useCartStore.js` | Cart state (Zustand) — add item types here |
| `cashier-app/src/stores/useShiftStore.js` | Shift open/close state |
| `cashier-app/src/stores/useLotteryStore.js` | Lottery session tracking |
| `cashier-app/src/components/pos/ActionBar.jsx` | Bottom action bar — accepts `actionBarHeight` prop |
| `cashier-app/src/components/pos/QuickFoldersPanel.jsx` | Folder-browse panel for quick product access |
| `cashier-app/src/components/pos/QuickFoldersPanel.css` | Styles for QuickFoldersPanel (`qfp-` prefix) |
| `cashier-app/src/components/tender/TenderModal.jsx` | Checkout / payment processing |
| `cashier-app/src/components/modals/LotteryModal.jsx` | Combined Sale+Payout modal (latest) |
| `cashier-app/src/components/modals/LotteryShiftModal.jsx` | EOD ticket scan reconciliation |
| `cashier-app/src/components/modals/VendorPayoutModal.jsx` | Cashier vendor payout (numpad, vendor select, type toggle) |
| `cashier-app/src/components/modals/VendorPayoutModal.css` | Styles for VendorPayoutModal (`vpm-` prefix) |
| `cashier-app/src/components/modals/BottleRedemptionModal.jsx` | Bottle deposit entry — numpad + tap-to-select rows |
| `cashier-app/src/components/modals/BottleRedemptionModal.css` | Styles for BottleRedemptionModal (`brm-` prefix) |
| `cashier-app/src/hooks/usePOSConfig.js` | POS settings from IndexedDB (incl. actionBarHeight, quickFolders) |
| `cashier-app/src/api/pos.js` | All cashier-app API calls |
| `cashier-app/src/db/dexie.js` | IndexedDB schema for offline catalog |
| `cashier-app/src/components/modals/PackSizePickerModal.jsx` | Pack size picker when product has multiple sizes |
| `cashier-app/electron/main.cjs` | Electron main process — USB/network printing, cash drawer, app control. Dev mode loads `http://localhost:5174` |
| `cashier-app/electron/preload.cjs` | Context bridge — secure IPC between renderer and main |
| `cashier-app/src/hooks/useOnlineStatus.js` | Online/offline detection — derives health-check URL from `VITE_API_URL` (not a relative path) so Electron file:// works |
| `cashier-app/src/screens/POSScreen.jsx` | `handleNoSale` callback: opens cash drawer + calls `logPosEvent` (fire-and-forget) |
| `cashier-app/src/api/pos.js` | `logPosEvent(body)`, `searchCustomers(query, storeId)`, `createCustomer(data)` |
| `cashier-app/src/components/modals/CustomerLookupModal.jsx` | Two-tab modal: **Search** (debounced, shows name/phone/pts/discount, "Add new?" shortcut) + **New Customer** (inline quick-create form: first/last/phone/email → creates + auto-attaches) |
| `cashier-app/src/api/client.js` | Axios instance — baseURL from `VITE_API_URL`; attaches JWT + station token |
| `cashier-app/.env` | Dev API URL → `http://localhost:5000/api` |
| `cashier-app/.env.production` | Cloud API URL → `https://api.storeveu.com/api`. Use `electron:build:local` for local installs |

**Cashier App Build Modes:**
| Script | Env file used | API URL baked in | Use for |
|--------|--------------|-----------------|---------|
| `npm run electron:dev` | `.env` | `http://localhost:5000/api` | Local development (live reload) |
| `npm run electron:build:local` | `.env` | `http://localhost:5000/api` | Local installed build |
| `npm run electron:build` | `.env.production` | `https://api.storeveu.com/api` | Cloud/production deployment |

---

## 🗃 Database Models Quick Reference

### Core
- `Organization` — top-level multi-tenant entity
- `User` — employees/admins, has `role` (superadmin/admin/owner/manager/cashier)
- `Store` — physical location, belongs to Organization
- `UserStore` — many-to-many user ↔ store
- `Station` — POS terminal/register

### Catalog
- `Department` — product categories
- `MasterProduct` — org-level product catalog (incl. `unitPack`, `packInCase`, `depositPerUnit`)
- `ProductUpc` — multiple barcodes per product (`@@unique([orgId, upc])`)
- `ProductPackSize` — selectable pack sizes shown in cashier picker (label, unitCount, retailPrice, isDefault)
- `StoreProduct` — store-level price/stock overrides
- `TaxRule` — configurable tax rates
- `DepositRule` — container deposit/CRV rules
- `Promotion` — BOGO, volume, combo, mix & match promos
- `Vendor` / `VendorProductMap` — suppliers and their item codes

### POS Operations
- `Transaction` — completed sale
- `Shift` — cash drawer session
- `CashDrop` / `CashPayout` — mid-shift cash events
- `ClockEvent` — employee clock-in/out
- `Customer` — loyalty/house accounts
- `VendorPayment` — back-office vendor payment records; **not shift-scoped**; supports `paymentDate` override for historical entry

### Lottery Module (added April 2026)
- `LotteryGame` — game type (name, ticketPrice, state, isGlobal)
- `LotteryBox` — physical pack (inventory → active → depleted → settled)
- `LotteryTransaction` — individual sale or payout
- `LotteryShiftReport` — EOD reconciliation with box scan data
- `LotterySettings` — store-level config (commissionRate, scanRequired, state, cashOnly)

### Other
- `Invoice` / `Document` — OCR-processed vendor invoices
- `WeatherCache` — daily weather per lat/lng
- `ImportJob` — bulk import tracking
- `Upload` / `Transform` / `DepositMap` — CSV pipeline

---

## 🎰 Lottery Module — Full Feature Summary

The Lottery Module is one of the most recent and complex features. Key design decisions:

### Data Flow
```
Admin sets state games (isGlobal=true, state='ON')
    ↓
Store sees only their state's games (via LotterySettings.state)
    ↓
Cashier opens LotteryModal → selects game → enters qty
    ↓
Price = game.ticketPrice × qty (LOCKED — cannot be overridden)
    ↓
Items added to cart as isLottery:true line items
    ↓
TenderModal extracts lotteryItems → sends to backend
    ↓
posTerminalController creates LotteryTransaction records
    ↓
End of shift → LotteryShiftModal → scan ticket numbers
    ↓
ticketsSold = endTicket − startTicket; amount = ticketsSold × price
```

### Key Rules
- **Price is locked** to the game's `ticketPrice` — cashier only enters qty
- **Commission is store-level** (in `LotterySettings.commissionRate`), NOT per game
- **Activated boxes CANNOT be deleted** — backend enforces this
- **State-based games** — admin creates global games tagged to a province/state; stores only see their province's games
- **Cash-only option** — if `lotteryCashOnly=true`, TenderModal restricts to Cash only when cart has lottery items
- **Scan mandate** — if `scanRequiredAtShiftEnd=true`, cashier must enter end ticket # for every active box before closing shift

### Lottery API Routes (all under `/api/lottery`)
```
GET    /games                — list games (filtered by store's state)
POST   /games                — create game (manager+)
PUT    /games/:id            — update game
DELETE /games/:id            — soft delete

GET    /boxes                — list boxes (?status=active|inventory|depleted)
POST   /boxes/receive        — receive box order
PUT    /boxes/:id/activate   — activate box (sets lastShiftStartTicket)
PUT    /boxes/:id            — update box
DELETE /boxes/:id            — delete box (inventory only!)

POST   /transactions         — create single transaction
POST   /transactions/bulk    — bulk create

GET    /shift-reports/:shiftId  — get shift report
POST   /shift-reports           — save/upsert shift report

GET    /dashboard            — monthly KPIs
GET    /reports              — date-range report + chart data
GET    /commission           — commission report (uses store-level rate)

GET    /settings             — get store lottery settings
PUT    /settings             — upsert store lottery settings
```

---

## 🖥 POS Cart & Tender Architecture

### Cart Item Types
All items share the same structure in `useCartStore.items[]`. Key flags:

```js
// Regular product
{ lineId, productId, name, qty, unitPrice, effectivePrice, lineTotal,
  taxable, ebtEligible, depositAmount, discountEligible, ... }

// Lottery item  (isLottery: true)
{ lineId, isLottery: true, lotteryType: 'sale'|'payout', gameId, gameName,
  qty, unitPrice: amt, effectivePrice: amt, lineTotal: amt,
  taxable: false, ebtEligible: false, depositAmount: null,
  discountEligible: false, promoAdjustment: null }
```

### TenderModal Payload
```js
// Regular items → lineItems[]
// Lottery items → lotteryItems[] (extracted separately)
{
  lineItems: items.filter(i => !i.isLottery),
  lotteryItems: items.filter(i => i.isLottery).map(i => ({
    type: i.lotteryType,
    amount: Math.abs(i.lineTotal),
    gameId: i.gameId,
  })),
  tenderMethod, amountTendered, changeDue,
  shiftId, stationId, cashierId
}
```

### Backend posTerminalController
After saving the main Transaction, if `lotteryItems[]` is present it creates `LotteryTransaction` records linked by `posTransactionId`.

---

## 🎨 UI Conventions & Patterns

### Portal (frontend/) — Glassmorphism Dark Theme
- Background: CSS variables `var(--bg-primary)`, `var(--bg-panel)`, `var(--border)`
- Glassmorphism cards: `background: rgba(255,255,255,0.03)`, `border: 1px solid rgba(255,255,255,0.06)`
- Accent green: `var(--green)` / `#7ac143`
- Text: `var(--text-primary)`, `var(--text-secondary)`, `var(--text-muted)`
- Layout: `layout-container` + `main-content` wrapper on every page (includes `<Sidebar />`)
- Charts: Recharts `AreaChart`, `BarChart`, `ComposedChart`

### Portal Modals
- Overlay: `rgba(0,0,0,0.55)` + `backdropFilter: blur(4px)`
- Card background: **explicit `#ffffff`** (NOT CSS vars — they go transparent in modals)
- Same pattern applies to any new modals in Lottery.jsx or other portal pages

### Cashier App — Dark POS Theme
- Background: `var(--bg-primary)` dark
- All modals: **white cards**, light UI, explicit `#ffffff` backgrounds
- Green = sale/positive: `#16a34a`
- Amber = payout/warning: `#d97706`
- **New components use external `.css` files** with prefixed class names (e.g. `vpm-`, `brm-`, `qfp-`)
- Older components still use inline styles — do not retroactively rewrite unless asked

### External CSS Convention (all new components from April 2026)
Create a `.css` file alongside every new `.jsx` file. Use a **component-unique prefix** on every class to prevent collisions:
```css
/* VendorPayoutModal.css — prefix: vpm- */
.vpm-backdrop { ... }
.vpm-modal    { ... }
.vpm-numpad   { ... }
```
Import at the top of the JSX: `import './VendorPayoutModal.css';`

### Adding a New Portal Page
1. Create `frontend/src/pages/NewPage.jsx` with `<div className="layout-container"><Sidebar /><main className="main-content">...</main></div>`
2. Add route in `frontend/src/App.jsx`: `<Route path="/portal/new-page" element={<ProtectedRoute><NewPage /></ProtectedRoute>} />`
3. Add nav link in `frontend/src/components/Sidebar.jsx`

### Adding a New Cashier Modal
1. Create `cashier-app/src/components/modals/NewModal.jsx` — white card, light UI
2. Add `const [showNew, setShowNew] = useState(false)` in `POSScreen.jsx`
3. Add `<NewModal open={showNew} onClose={() => setShowNew(false)} />` in render
4. Wire the trigger button in `ActionBar.jsx` or cart UI

---

## 🔐 Auth & Roles

JWT payload: `{ id, orgId, role, storeIds[] }`

Role hierarchy (lowest → highest privilege):
```
cashier → manager → owner → admin → superadmin
```

Middleware: `protect` (validates JWT) + `authorize('manager', 'owner', 'admin')` (role check)

Cashier app uses PIN login (4–6 digit PIN), not full JWT. PIN validated against `User.pin` (bcrypt hashed). Station token stored in localStorage.

---

## 🚨 Important Dev Notes

### Database
- **Always use `npx prisma db push`** — NOT `prisma migrate dev`. Shadow DB permissions are not available in this environment. `migrate dev` will fail with "permission denied to create database".
- After schema changes: `cd backend && npx prisma db push`
- After adding new models: restart the backend server (Prisma client DLL may be locked)
- Seed lottery data: `cd backend && node prisma/seedLottery.js`

### API Response Shapes
Backend controllers return two patterns:
```js
// Wrapped (most endpoints)
{ success: true, data: [...] }

// Plain (some lottery reports)
{ totalSales, totalPayouts, ... }
```

Frontend `api.js` uses `lotteryUnwrap`:
```js
const lotteryUnwrap = (r) => r.data?.data ?? r.data;
```

### Prisma Model Name
The top-level org model is `Organization` (NOT `Tenant`). Use `prisma.organization.findFirst()`.

### Ports
- Backend: `5000`
- Frontend Portal: `5173`
- Cashier App: `5174`
- Admin Panel: `5175`

### Dev Start
```bash
# All apps at once (from root)
npm run dev

# Or individually
npm run dev:backend
npm run dev:frontend
npm run dev:cashier
npm run dev:admin
```

---

## 📦 Recent Feature Additions (April 2026)

### Marketing Site & UX (April 2026)
- Complete 5-page public site with Framer Motion animations.
- Centralized `Link` navigation implementation for all marketing pages.
- `FeesMappings.jsx` module added for service fee management.
- `DepositMapPage.jsx` for cross-store deposit rules.
- PostgreSQL schema sync stabilized via `npx prisma db push`.
- Standardized delivery pricing via `FareCalculationService`.

### Lottery Module (Full)
Complete scratch-ticket lottery management system:

**Portal (`frontend/src/pages/Lottery.jsx`)** — 8 tabs:
1. **Overview** — KPI cards (monthly sales, payouts, net, commission, active boxes)
2. **Games** — Game catalog with state/province badge, global game management
3. **Inventory** — Box receiving, inventory tracking, receive orders
4. **Active Tickets** — Activated boxes with slot numbers; activate/deplete workflow
5. **Shift Reports** — EOD reports with box scan data and variance
6. **Reports** — Date-range reports, SVG bar chart, CSV download
7. **Commission** — Store-level commission report
8. **Settings** — Store lottery config (state, commission rate, cash only, scan mandate)

**Cashier App:**
- `LotteryModal.jsx` — Combined Sale + Payout in one modal with tab switcher
  - Sale tab: game selector + qty picker (price auto-calculated, cannot override)
  - Payout tab: amount numpad + note field
  - Session summary: running total of items added
- `LotteryShiftModal.jsx` — EOD reconciliation
  - Lists all active boxes with start ticket numbers
  - Cashier enters/scans last ticket number per box
  - Calculates tickets sold and expected amount
  - Shows variance vs cart transaction total
  - Blocks save if scan is mandated and boxes unscanned

**Backend:**
- `lotteryController.js` — Full CRUD for games, boxes, transactions, reports, settings
- `lotteryRoutes.js` — 16 routes under `/api/lottery`
- `posTerminalController.js` — Extended to accept `lotteryItems[]` in transaction payload
- Schema: 5 new Prisma models (LotteryGame, LotteryBox, LotteryTransaction, LotteryShiftReport, LotterySettings)

### POS Enhancements
- Cart supports `isLottery` item type with separate tender handling
- `TenderModal` extracts lottery items → sends as `lotteryItems[]` to backend
- `TenderModal` enforces cash-only when `lotteryCashOnly=true` and cart has lottery items
- `POSSettings.jsx` — Lottery section: enable/disable, cash-only, scan mandate
- `ActionBar.jsx` — Single "Lottery" button opens combined modal

### Portal Enhancements
- `Sidebar.jsx` — Lottery nav link added under new "Lottery" group
- `App.jsx` — `/portal/lottery` route added
- `api.js` — 15+ lottery API functions with `lotteryUnwrap` helper

---

## 🛣 Product Roadmap (Known Next Steps)

### Immediate / Testing
- [ ] E2E test: full lottery sale + tender + shift close flow
- [ ] Seed games with `state` field populated (Ontario games)
- [ ] Sync `LotterySettings.cashOnly` + `scanRequired` with `usePOSConfig` on station setup

### Short-Term
- [ ] Lottery ticket barcode scanning via device camera (for EOD scan)
- [ ] Connect Lottery Reports CSV download to shift-level data
- [ ] Commission report PDF export
- [ ] Multi-store lottery dashboard (superadmin view)

### Medium-Term
- [ ] Customer loyalty points on purchases (points-per-dollar model)
- [ ] Vendor EDI/invoice auto-matching improvements
- [ ] Employee schedule management
- [ ] Ecommerce integration (Shopify/WooCommerce product sync)
- [ ] Mobile app for manager approvals (push notifications)

### Long-Term
- [ ] Kiosk mode (customer self-checkout)
- [ ] Fuel pump integration
- [ ] Multi-state lottery compliance (US states + Canadian provinces)
- [ ] Real-time inventory depletion alerts

---

## 🤝 Working Agreement

When working on this project:

1. **Read before writing** — always read the target file before editing it
2. **Use `npx prisma db push`** — never `prisma migrate dev`
3. **External CSS for ALL UI** — every new component or page **must** use a dedicated `.css` file with a unique class-name prefix (e.g. `vpm-`, `brm-`, `qa-`). **Zero inline `style={{}}` objects** in new JSX. This is a hard rule on every task, every prompt.
4. **Portal modals use explicit `#ffffff`** — CSS vars go transparent in overlay modals
5. **Respect multi-tenancy** — every DB query must filter by `orgId` and `storeId`
6. **Lottery price is sacred** — never allow manual override of ticket price in the cashier flow
7. **Activated boxes are immutable** — never delete or allow UI to delete active/depleted boxes
8. **Commission is store-level** — never store commission on individual games
9. **State-scoped games** — global games (isGlobal=true) are visible only to stores whose `LotterySettings.state` matches the game's `state` field
10. **Ask before big refactors** — this is a production-adjacent system; discuss before restructuring
11. **Update CLAUDE.md after every task** — append the feature summary to "Recent Feature Additions", update the roadmap, and mark completed items `[x]`. This must happen at the end of **every** prompt, no exceptions.

---

## 📦 Recent Feature Additions (April 2026 — Session 2)

### External CSS Policy (enforced from this session onwards)
All new React components use a dedicated `.css` file with a **unique class-name prefix** per component. No inline `style={{}}` objects in new JSX. Existing pages were not retroactively changed.

| Component | CSS File | Prefix |
|-----------|----------|--------|
| `VendorPayoutModal` | `VendorPayoutModal.css` | `vpm-` |
| `BottleRedemptionModal` | `BottleRedemptionModal.css` | `brm-` |
| `VendorPayouts` (portal page) | `VendorPayouts.css` | `vp-` |
| `QuickAccess` (portal page) | `QuickAccess.css` | `qa-` |
| `QuickFoldersPanel` | `QuickFoldersPanel.css` | `qfp-` |

---

### Sidebar Restructuring — Vendors Group
`frontend/src/components/Sidebar.jsx` reorganised into named groups:

| Group | Items |
|-------|-------|
| Operations | Live Dashboard, Customers |
| Lottery | Lottery |
| Catalog | Products, Departments, Promotions, Bulk Import, Inventory Count |
| **Vendors** *(new)* | Vendors, Vendor Payouts, Vendor Orders, Invoice Import, CSV Transform |
| Analytics | Sales, Dept Analytics, Products, Predictions |
| Integrations | POS API, eComm |
| Point of Sale | POS Settings, Receipt Settings, Stations, Transactions, Employee Reports, Payouts Report, Deposit Rules, Tax Rules, Quick Access |
| Account | Organisation, Users, Stores |

---

### Vendor Payments Module

**New DB model — `VendorPayment`** (`backend/prisma/schema.prisma`):
```prisma
model VendorPayment {
  id          String    @id @default(cuid())
  orgId       String
  storeId     String?
  vendorId    Int?
  vendorName  String?
  amount      Decimal   @db.Decimal(10, 4)
  paymentType String    @default("expense")   // "expense" | "merchandise"
  notes       String?
  paymentDate DateTime  @default(now())       // can be set historically
  createdById String
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  @@index([orgId, storeId])
  @@index([orgId, paymentDate])
  @@map("vendor_payments")
}
```
Migration: `backend/prisma/migrations/add_vendor_payments.sql`

**New controller** — `backend/src/controllers/vendorPaymentController.js`:
- `listVendorPayments` — filters by storeId/date range/type/vendorId; returns payments + summary totals
- `createVendorPayment` — accepts optional `paymentDate` for historical entries
- `updateVendorPayment` — partial update

**New routes** (added to `backend/src/routes/catalogRoutes.js`):
```
GET    /catalog/vendor-payments        manager+
POST   /catalog/vendor-payments        manager+
PUT    /catalog/vendor-payments/:id    owner+
```

**New API functions** (`frontend/src/services/api.js`):
```js
getVendorPayments(params)
createVendorPaymentEntry(data)
updateVendorPaymentEntry(id, data)
```

**Cashier — `VendorPayoutModal.jsx`** (`cashier-app/src/components/modals/`):
- Purple accent (`#a855f7`), dedicated CSS file `VendorPayoutModal.css`
- Amount entry via numpad with `buildAmount(current, key)` helper (handles decimals, backspace, clear)
- Vendor dropdown (fetches from catalog API)
- Type toggle: Expense / Merchandise
- Note / remark text field
- Confirm → success screen with amount + vendor + timestamp + "Print Receipt" / "Skip" buttons
- Integrates with `useShiftStore().addPayout()` (shift-scoped)
- Triggered via "Paid Out" button in `ActionBar.jsx` (previously opened CashDrawerModal)

**Back-office — `VendorPayouts.jsx`** (`frontend/src/pages/`):
- Summary cards: Total Expense / Total Merchandise / Grand Total
- Inline add form: vendor dropdown, free-text vendor name fallback, amount, **date picker** for historical recording, type toggle, notes
- Filter row + paginated data table with type badges
- Route: `/portal/vendor-payouts`

---

### Bottle Redemption — Numpad Redesign
`cashier-app/src/components/modals/BottleRedemptionModal.jsx` fully rewritten:

- **Split layout**: scrollable rule list on top, fixed 4-column numpad panel pinned to bottom
- **Tap-to-select**: clicking a rule row activates it (highlighted with `brm-rule-row--active`)
- **Numpad**: `buildQty(current, key)` helper — integer only, max 9999, `C` resets to 0, `⌫` = floor divide by 10
- Supports easy entry of large counts (e.g. 50 bottles, 200 cans)
- CSS file: `BottleRedemptionModal.css` with `brm-` prefix, teal/green (`#34d399`) accent

---

### POS Action Bar — Configurable Height
`cashier-app/src/hooks/usePOSConfig.js` — new config field:
```js
actionBarHeight: 'normal'   // 'compact' (48px) | 'normal' (58px) | 'large' (72px)
```

`cashier-app/src/components/pos/ActionBar.jsx`:
- Accepts `actionBarHeight` prop (numeric pixels)
- Reads from `posConfig.actionBarHeight` in `POSScreen.jsx`

`frontend/src/pages/POSSettings.jsx` — new **"Action Bar Height"** section (section 3b):
- Three visual selector buttons showing proportional bar previews (compact / normal / large)

---

### Quick Access Folders (POS Product Shortcuts)

Store administrators can create **folder-structured quick-access panels** on the cashier POS screen (e.g. "Fruits", "Vegetables", "Limes & Lemons", "Ice").

#### Data Storage
Stored in the existing `store.pos` JSON column via `GET/PUT /pos-terminal/config`. Structure:
```js
quickFolders: [
  {
    id: string,
    name: string,        // "Fruits"
    emoji: string,       // "🍎"
    color: string,       // "#16a34a"
    sortOrder: number,
    items: [
      { productId: string, name: string, price: number, barcode: string }
    ]
  }
]
```
No DB migration needed — stored in existing JSON column.

#### Back-office — `QuickAccess.jsx` (`frontend/src/pages/`)
- Route: `/portal/quick-access`
- Loads/saves quickFolders via `GET/PUT /pos-terminal/config`
- `FolderCard` sub-component: expand/collapse, edit name + emoji + color (10 swatches)
- Product search via `searchCatalogProducts` to add items to each folder
- Unsaved changes tracked via `dirty` flag; "Save All Changes" button
- Linked from **POSSettings.jsx** → Section 5 "Quick Access Folders" → "Manage Folders →"

#### Cashier — `QuickFoldersPanel.jsx` (`cashier-app/src/components/pos/`)
- CSS file: `QuickFoldersPanel.css` with `qfp-` prefix
- **Folder tile grid**: emoji + name + item count, coloured background from folder config
- Click folder → **drill into product tiles** view with back button
- Click product tile → `useCartStore().addProduct(...)` adds to cart
- Props: `folders` array from `posConfig.quickFolders`

#### POS Screen Tab Bar (`cashier-app/src/screens/POSScreen.jsx`)
- When `posConfig.quickFolders?.length > 0`, a **CATALOG | ⚡ QUICK** tab bar appears above the product grid
- `quickTab` state toggles between the existing `CategoryPanel` and the new `QuickFoldersPanel`
- `VendorPayoutModal` integrated; "Paid Out" action in `ActionBar` triggers it

#### New Portal Routes (`frontend/src/App.jsx`)
```jsx
<Route path="/portal/vendor-payouts" element={<ProtectedRoute><VendorPayouts /></ProtectedRoute>} />
<Route path="/portal/quick-access"   element={<ProtectedRoute><QuickAccess /></ProtectedRoute>} />
```

---

---

## 📦 Recent Feature Additions (April 2026 — Session 3)

### Vendor Payout — Mode of Tender
`VendorPayment` model now has `tenderMethod String? @default("cash")`.

**Schema change** (`backend/prisma/schema.prisma`):
```prisma
tenderMethod  String?   @default("cash")
```
Applied via `npx prisma db push`. Backend `createVendorPayment` / `updateVendorPayment` now read/write this field.

**POS Config** — new `vendorTenderMethods` array in `usePOSConfig.js` (and `DEFAULT_POS_CONFIG`):
```js
vendorTenderMethods: [
  { id: 'cash',          label: 'Cash',              enabled: true  },
  { id: 'cheque',        label: 'Cheque',            enabled: true  },
  { id: 'bank_transfer', label: 'Bank Transfer',     enabled: false },
  { id: 'credit_card',   label: 'Credit Card',       enabled: false },
  { id: 'interac',       label: 'Interac e-Transfer', enabled: false },
]
```
Stored in `store.pos` JSON. Managed by admin via **Store Settings** page.

---

### Store Settings Page (Portal)
New page: `frontend/src/pages/StoreSettings.jsx` / `StoreSettings.css` (`ss-` prefix).
- Route: `/portal/store-settings`
- Sidebar: Account group → "Store Settings" (Settings2 icon)
- Store selector dropdown
- **Vendor Payment Tender Methods** section — toggle switches per method, add/remove custom methods
- Loads via `getPOSConfig(storeId)`, saves via `updatePOSConfig({ storeId, ...config, vendorTenderMethods })`
- Dirty-state indicator + sticky save bar

**New API helpers** (`frontend/src/services/api.js`):
```js
getPOSConfig   = (storeId) => api.get('/pos-terminal/config', { params: { storeId } }).then(r => r.data)
updatePOSConfig = (data)   => api.put('/pos-terminal/config', data).then(r => r.data)
```

---

### VendorPayoutModal — Two-Column Numpad Layout + Tender Method
`cashier-app/src/components/modals/VendorPayoutModal.jsx` fully rewritten:
- **Layout**: form LEFT (`vpm-left-col`, flex:1, border-right), numpad RIGHT (`vpm-right-col`, width:260px)
- Tender method buttons loaded from `usePOSConfig().vendorTenderMethods.filter(t => t.enabled)`
- **Success screen**: amount, vendor name, tender label, payout type, timestamp + Print Receipt / Skip
- Responsive: `@media (max-width: 560px)` → `flex-direction: column-reverse`

---

### CashDrawerModal — Two-Column + Success Screen
`cashier-app/src/components/modals/CashDrawerModal.jsx` fully rewritten (vendor payout tab removed):
- **Layout**: form LEFT (shift chip + note), numpad RIGHT (amount display + numpad) — `CashDropModal.css` (`cdm-` prefix, amber accent)
- **Success state**: after `addCashDrop` → shows amount, "removed from drawer", note, shift info
- Print Receipt / Skip buttons; `onPrint` prop wired in `POSScreen.jsx`:
  ```jsx
  <CashDrawerModal onPrint={hasReceiptPrinter ? handlePrintTx : undefined} ... />
  ```

| CSS file | Prefix | Accent |
|----------|--------|--------|
| `CashDropModal.css` | `cdm-` | amber `#f59e0b` |

---

### Bottle Redemption — Cart-Based Negative Items
`cashier-app/src/components/modals/BottleRedemptionModal.jsx` fully rewritten:
- **No longer creates a standalone transaction** (`createOpenRefund` removed)
- Calls `useCartStore(s => s.addBottleReturnItems)(lineItems)` instead
- Two-column layout: rule list LEFT (`brm-left-col`), qty display + 4-col numpad + summary RIGHT (`brm-right-col`, width:260px)
- Amounts shown with `-` prefix in summary (e.g. `-$4.50`)
- Button: "Add to Cart (-$X.XX)" → "Added to Cart ✓" on success → auto-closes after 900ms
- `POSScreen.jsx` `onComplete` simplified to `() => setShowBottleReturn(false)`

**`useCartStore.js`** — new `addBottleReturnItems(lines)` action:
```js
addBottleReturnItems: (lines) => {
  const items = lines.map(l => ({
    lineId: nanoid(8), isBottleReturn: true,
    name: `♻️ Bottle Return – ${l.rule.name}`,
    qty: l.qty,
    unitPrice: -Number(l.rule.depositAmount),
    effectivePrice: -Number(l.rule.depositAmount),
    lineTotal: -Math.abs(l.lineTotal),
    depositTotal: 0, taxable: false, ebtEligible: false,
    depositAmount: null, discountEligible: false,
    discountType: null, discountValue: null, promoAdjustment: null,
  }));
  set(s => ({ items: [...s.items, ...items] }));
},
```

---

### TenderModal — Negative Grand Total (Refund / Pure Bottle Return)
When `totals.grandTotal < -0.005` (i.e. cart is net-negative — bottle returns exceed purchases):
- `isRefundTx = true`
- `canComplete = true` immediately (no minimum tender needed)
- `rawChange = Math.abs(grandTotal)` — displayed as "REFUND DUE TO CUSTOMER"
- `finalLines` auto-includes `{ method: 'cash', amount: Math.abs(grandTotal), note: 'Refund/Bottle Return' }`
- Completion screen shows "Refund Complete" with teal (`#34d399`) colour scheme

---

### Receipt — Negative Amounts & Bottle Returns
`cashier-app/src/services/printerService.js` — `buildReceiptString()`:
- New prefix for bottle return items: `'♻ RETURN   '`
- Lottery payout already: `'** PAYOUT  '`; lottery sale: `'>> LOTTERY '`
- TOTAL line: when `totalAmt < -0.005` → shows `REFUND DUE   -$X.XX` instead of `TOTAL`

---

## 🛣 Product Roadmap (Known Next Steps)

### Immediate / Testing
- [ ] E2E test: full lottery sale + tender + shift close flow
- [ ] Seed games with `state` field populated (Ontario games)
- [ ] Sync `LotterySettings.cashOnly` + `scanRequired` with `usePOSConfig` on station setup
- [ ] Cash Drop receipt format — `handlePrintTx` receives `{ type: 'cash_drop', amount, note }` object; may need a dedicated print path for non-transaction receipts

### Short-Term
- [ ] Lottery ticket barcode scanning via device camera (for EOD scan)
- [ ] Connect Lottery Reports CSV download to shift-level data
- [ ] Commission report PDF export
- [ ] Multi-store lottery dashboard (superadmin view)
- [ ] Audit remaining portal pages for inline styles → migrate to external CSS
- [ ] Dedicated cash-drop / payout receipt format in `printerService.js`

### Medium-Term
- [ ] Customer loyalty points on purchases (points-per-dollar model)
- [ ] Vendor EDI/invoice auto-matching improvements
- [ ] Employee schedule management
- [ ] Ecommerce integration (Shopify/WooCommerce product sync)
- [ ] Mobile app for manager approvals (push notifications)

### Long-Term
- [ ] Kiosk mode (customer self-checkout)
- [ ] Fuel pump integration
- [ ] Multi-state lottery compliance (US states + Canadian provinces)
- [ ] Real-time inventory depletion alerts

---

*Last updated: April 2026 — Session 9: Multi-UPC, Multi-Pack-Size, Simplified Pack/Deposit, Product Form Redesign, Admin Tickets*

---

## 📦 Recent Feature Additions (April 2026 — Session 4)

### P0 Fix: Lottery Cash-Only Enforcement (`usePOSConfig.js`)
`lottery` object was shallow-merged from server response, so saving `cashOnly: true` would lose `scanRequiredAtShiftEnd` (and vice-versa). Fixed with explicit deep-merge:
```js
lottery: {
  ...DEFAULT_POS_CONFIG.lottery,
  ...(r.data.lottery || {}),
},
```
`TenderModal` already had the enforcement logic (`allowedMethods = lotteryCashOnly && hasLotteryItems ? [cash only] : ALL`). The `lotteryCashOnly` prop was already being passed from `POSScreen`. This fix ensures the flag survives the config load.

---

### P0 Fix: Require Ticket Scan at Shift End

#### New "Lotto Shift" button (`ActionBar.jsx`)
- Added `ClipboardList` (lucide-react) import
- New props: `onLotteryShift`, `lotteryEnabled`
- "Lotto Shift" button (amber `#f59e0b`) shown when `shiftOpen && lotteryEnabled`, next to the existing "Lottery" button
- Wrapping both lottery buttons in `{lotteryEnabled && (...)}` guard

#### Intercepted CloseShift flow (`POSScreen.jsx`)
Two new state variables:
```js
const [lotteryShiftDone,  setLotteryShiftDone]  = useState(false);
const [pendingShiftClose, setPendingShiftClose] = useState(false);
```
`lotteryShiftDone` resets on shift ID change (`useEffect`).

`onCloseShift` now checks before opening `CloseShiftModal`:
```js
if (scanReq && lotteryOn && hasBoxes && !lotteryShiftDone) {
  setPendingShiftClose(true);
  setShowLotteryShift(true);   // must reconcile first
} else {
  setShowCloseShift(true);     // proceed normally
}
```

`handleLotteryShiftSave` updated:
```js
setLotteryShiftDone(true);
setShowLotteryShift(false);
if (pendingShiftClose) {
  setPendingShiftClose(false);
  setShowCloseShift(true);     // auto-continue to close shift
}
```

New helper `handleOpenLotteryShift` — refreshes active boxes then opens `LotteryShiftModal` (used by ActionBar button).

#### LotteryShiftModal — CSS migration + `pendingShiftClose` banner
- Fully migrated from inline styles → `LotteryShiftModal.css` (`lsm-` prefix)
- New prop `pendingShiftClose: bool` — shows amber banner: *"Scan required before closing the shift. Complete reconciliation to proceed."*
- Save button label changes: `"Save & Continue to Close Shift"` when `pendingShiftClose=true`
- When user clicks Skip, `setPendingShiftClose(false)` is also called so close-shift isn't blocked indefinitely

| File | Change |
|------|--------|
| `usePOSConfig.js` | Deep-merge `lottery` config object |
| `LotteryShiftModal.css` | NEW — `lsm-` prefix, full external CSS |
| `LotteryShiftModal.jsx` | Rewritten with external CSS + `pendingShiftClose` prop |
| `ActionBar.jsx` | Added `ClipboardList`, `onLotteryShift`, `lotteryEnabled`, "Lotto Shift" button |
| `POSScreen.jsx` | `lotteryShiftDone` + `pendingShiftClose` state, intercepted close-shift flow, `handleOpenLotteryShift` |

---

### Bug Fix: Lottery Cash-Only — Card Button Still Accessible (`TenderModal.jsx` + `POSScreen.jsx`)
Three bypass paths allowed Card checkout even when `lotteryCashOnly=true`:

1. **Card-quick screen bypass** — `if (initMethod === 'card' && splits.length === 0)` rendered a full card-payment screen before `allowedMethods` was consulted. Fixed: added `&& !(lotteryCashOnly && hasLotteryItems)` to the guard so it falls through to the entry modal.

2. **Wrong initial `method` state** — `useState(initMethod || ...)` would start `method='card'` even under cash-only, meaning `complete()` would submit as card. Fixed: initial value now forced to `'cash'` when `lotteryCashOnly && hasLotteryItems`.

3. **Quick-tender CARD button not disabled** — Both CARD shortcut buttons in POSScreen were always enabled. Added `const cashOnlyEnforced = posConfig.lottery?.cashOnly && items.some(i => i.isLottery)` and applied `disabled`, `opacity: 0.45`, `cursor: not-allowed`, and a tooltip *"Lottery items — cash only"* to both CARD buttons when enforced.

---

### Critical Bug Fix: TenderModal Blank Screen (`TenderModal.jsx`)
`const isRefundTx` was declared on line 161 but **used on lines 144 and 152** (inside `rawChange` and `canComplete`). JavaScript's temporal dead zone throws `ReferenceError: Cannot access 'isRefundTx' before initialization` on every render → blank screen whenever Cash/Card/EBT was tapped.

Fix: moved `const isRefundTx = totals.grandTotal < -0.005;` to immediately before `rawChange`.

---

## 🚦 Prioritized Product Backlog (April 2026)

> Items are ordered **P0 → P4**. Work top-to-bottom within each tier.
> Mark items `[x]` when complete and move a summary into "Recent Feature Additions".

---

### 🔴 P0 — Critical Bugs (fix before anything else)

- [ ] **Barcode scan returns wrong product** — cashier app scan always resolves to one product even when multiple exist; wrong item added to cart
- [ ] **Product-not-found not handled** — if barcode is missing from catalog, cashier app still adds a product instead of showing a "not found" error
- [ ] **No internet → screen blinks on scan** — offline mode falls back incorrectly; Dexie lookup fails silently and the screen flashes instead of showing a cached/offline result or a clear "offline" message
- [ ] **Stations page → redirects to sign-in** — `/portal/stations` drops user to the frontend login page instead of loading
- [ ] **POS Transactions tab → redirects to sign-in** — same issue as Stations; route guard or token propagation failure
- [x] **Cash-only lottery enforcement** — `usePOSConfig` now deep-merges `lottery` object so `cashOnly` flag is preserved; TenderModal already filters methods when `lotteryCashOnly=true`
- [x] **Require Ticket Scan at Shift End + Lottery Shift button** — see Session 4 notes below

---

### 🟠 P1 — High-Priority Bugs & Regressions

- [x] **Employee Report UI breaking** — added `layout-container` + `<Sidebar />` wrapper; rewritten with `EmployeeReports.css` (`er-` prefix), zero inline styles
- [x] **PIN for clock-in/out** — confirmed clock-in/out uses same 4–6 digit register PIN; added "Use your register PIN" hint text in clock mode on `PinLoginScreen.jsx`
- [x] **POS Settings not reflecting instantly** — `usePOSConfig.js` now polls every 5 minutes via `setInterval` AND re-fetches on `visibilitychange` (tab becomes visible). Config fetch logic extracted to `mergeConfig()` helper to avoid duplication.
- [x] **Active sidebar tab click resets scroll to top** — `Sidebar.jsx` NavLink now has `onClick` guard: `if (location.pathname === item.path) e.preventDefault()` — prevents React Router re-navigation (and subsequent scroll-to-top) when already on the route
- [x] **Deposit Rules page — sidebar UI broken** — added `layout-container` + `<Sidebar />` wrapper; main export converted to external CSS with `DepositRules.css` (`dr-` prefix)
- [x] **Department is mandatory** — `ProductForm.jsx` `handleSave` now validates `form.departmentId` with `toast.error('Department is required')` before submitting
- [x] **New shift at midnight** — `useShiftStore.loadActiveShift` now flags `shift._crossedMidnight = true` when `shift.openedAt < today's midnight`; `POSScreen.jsx` shows an amber banner when this flag is set

---

### 🟡 P2 — Core Features (next sprint)

- [ ] **Bottle deposit redemption** *(partially done — cart items work; needs end-to-end polish)*
  - Verify receipt shows `♻ RETURN` lines with negative amounts
  - Verify cash drawer opens on refund completion
  - Add bottle rules management in portal (admin can set deposit amounts per container type)

- [ ] **Keyboard in Cashier App** *(Need modal based implementation)*
  - Full keyboard on screen for cashier to type anything in text fields when searching text
  - Keypad for cashier always for quick numbers punchin for quick produst lookups/shortcuts
- [ ] **Export / download all products** — portal Products page needs a CSV/XLSX export button; mandatory columns: Name, UPC, Price; all others optional. Backend `GET /catalog/products/export` endpoint.

- [ ] **Create new product from cashier app** — when a barcode is not found, show a "Create Product" shortcut that opens a minimal form (Name, UPC, Price, Department). Requires manager-level PIN verification.

- [ ] **Station config edit from PIN screen** — small gear icon on cashier PIN/login screen; tapping it asks for manager verification, then opens station setup (store, station name, printer IP, etc.)

- [ ] **Connected stations view** — portal Stations page: show live heartbeat status, terminal name, cashier logged in, last activity timestamp per station

- [ ] **Station limit per subscription plan** — backend enforces max stations per store based on `Organization.plan`; portal shows current usage vs limit; cashier app blocks pairing when limit reached

- [ ] **Cash withdraw — out-of-business transactions** — "Cash Out" / "Paid Out" event that removes cash from drawer without a vendor payout; recorded as `CashPayout` with reason; shows on shift report

- [ ] **Receipt customization (back-office)** — receipt designer page: toggle which fields print (store name, address, logo, tax breakdown, cashier name, shift ID, etc.); preview pane; saved to `store.pos` config

- [ ] **Sound feedback** — play a short beep/tone on: scan success, scan error/not-found, transaction complete, transaction error. Use Web Audio API (offline-safe).

- [ ] **Sales Reports & Analytics — fix live data**
  - Live Dashboard: hook up real aggregation queries (today's sales, top products, hourly chart)
  - Department Analytics: fix data shape mismatch
  - Product Analytics: velocity ranking, sales trend
  - Predictions: Holt-Winters should use actual `Transaction` data from this POS

---

### 🟢 P3 — Important Features (following sprint)

- [ ] **Promotions management + bulk import**
  - Portal: full BOGO / volume / combo / mix-and-match CRUD
  - CSV bulk import with validation preview
  - Cashier app: promo engine already has hooks; verify they fire correctly

- [ ] **Customize quick switches (Action Bar)** — allow store admin to reorder / rename / hide the action-bar buttons (Lottery, Bottle Return, Vendor Payout, Cash Drop, etc.) via Store Settings

- [ ] **Role & permissions module** — granular permissions per user (e.g. can_void, can_discount, can_edit_prices, can_close_shift); assigned in Users page; enforced in both portal and cashier app

- [ ] **Employee clock-in/out PIN design** — decide: same PIN as register login OR separate clock PIN. Build dedicated clock screen if separate. Tie to Employee Reports.

- [ ] **Customer module — fix & loyalty tie-in**
  - Fix existing Customer page (data not loading / UI broken)
  - Link customers to transactions (lookup by phone/loyalty card at checkout)
  - Points-per-dollar accrual; balance display at checkout; redemption flow

- [ ] **Vendor order based on product velocity** — portal Vendor Orders page: suggest reorder quantities based on weekly sales velocity, seasonal trends, and reorder frequency config per product

- [ ] **Fix vendor order page** — current UI needs product-movement data feed; connect to `Transaction` line items for movement calculation

---

### 🔵 P4 — Nice-to-Have / Planned

- [ ] **POS API page → "Coming Soon"** — replace current page content with a styled "Coming Soon" placeholder; keep sidebar item visible but disabled/badged

- [ ] **Customer email/SMS marketing** — bulk campaign tool: filter inactive customers, send offer emails/SMS via SendGrid/Twilio integration

- [x] **Electron desktop build (.exe)** — fully configured: `electron/main.cjs` + `preload.cjs`, NSIS installer, USB/network printing IPC, cash drawer IPC. See Session 9 notes.

- [ ] **Multi-store lottery dashboard** — superadmin view aggregating all stores' lottery KPIs

- [ ] **Lottery ticket barcode scanning** — camera-based scan for EOD ticket number entry in `LotteryShiftModal`

- [ ] **Kiosk / self-checkout mode**

- [ ] **Fuel pump integration**

---

---

## 📦 Recent Feature Additions (April 2026 — Session 5)

### P1 Fix: Sidebar Scroll Reset on Active Tab Click (`Sidebar.jsx`)
`NavLink` in `Sidebar.jsx` now has an `onClick` guard:
```jsx
onClick={(e) => {
  if (location.pathname === item.path) e.preventDefault();
}}
```
This prevents React Router from re-navigating to the same route (which caused a re-render + `ScrollToTop` firing, scrolling the page to the top).

---

### P1 Fix: POS Settings Lag in PWA (`usePOSConfig.js`)
Config fetch logic extracted into `mergeConfig(defaults, data)` helper. `usePOSConfig` now:
- Fetches on mount (unchanged)
- Polls every **5 minutes** via `setInterval` (constant `POLL_INTERVAL_MS = 5 * 60 * 1000`)
- Re-fetches immediately on `visibilitychange` when `document.visibilityState === 'visible'` (covers returning from background on PWA/mobile)
- Cleans up both listener and interval on unmount / storeId change

---

### P1 Fix: Department Mandatory Validation (`ProductForm.jsx`)
`handleSave` now checks `form.departmentId` immediately after name:
```js
if (!form.departmentId) { toast.error('Department is required'); return; }
```

---

### P1 Fix: Midnight Shift Flag (`useShiftStore.js` + `POSScreen.jsx`)
`loadActiveShift` now mutates the returned shift with `_crossedMidnight: true` when `shift.openedAt` is before today's midnight:
```js
const todayMidnight = new Date();
todayMidnight.setHours(0, 0, 0, 0);
if (new Date(shift.openedAt) < todayMidnight) shift._crossedMidnight = true;
```
`POSScreen.jsx` shows an amber banner strip (below `StatusBar`, above content) when `shift._crossedMidnight` is true:
> ⚠ This shift was opened before midnight — please close it and open a new shift for today.

---

### P1 Fix: Employee Reports Layout (`EmployeeReports.jsx` + `EmployeeReports.css`)
Page fully rewritten:
- Wraps with `<div className="layout-container"><Sidebar /><main className="main-content">` — sidebar now visible
- All inline styles replaced with `EmployeeReports.css` (`er-` prefix)
- Summary cards, table, filters, error state all use CSS classes

| CSS file | Prefix | Accent |
|----------|--------|--------|
| `EmployeeReports.css` | `er-` | green/blue/amber |

---

### P1 Fix: Deposit Rules Layout (`DepositRules.jsx` + `DepositRules.css`)
Main export function updated:
- Wraps with `<div className="layout-container"><Sidebar /><main className="main-content">` — sidebar now visible
- Page-level structure (header, error banner, confirm row, empty state, rule list, loading) migrated to `DepositRules.css` (`dr-` prefix)
- Sub-components (`ContainerTypeToggle`, `RuleForm`, `RuleCard`) retain their pre-existing inline styles (complex conditional styles; not new code)

| CSS file | Prefix | Accent |
|----------|--------|--------|
| `DepositRules.css` | `dr-` | teal `#34d399` |

---

### P1 Fix: PIN Policy for Clock-In/Out (`PinLoginScreen.jsx`)
Clock mode (`mode === 'clock'`) now shows a small info note above the clock-in/out toggle:
> *"Use your register PIN to clock in or out"*
Confirms to cashiers that no separate PIN exists — the same 4–6 digit register PIN is used for both sign-in and clock events.

---

### Updated File Map

| File | Change |
|------|--------|
| `frontend/src/components/Sidebar.jsx` | Added `onClick` guard on NavLink to prevent same-route re-navigation |
| `cashier-app/src/hooks/usePOSConfig.js` | Added 5-min polling + `visibilitychange` listener; `mergeConfig()` helper |
| `frontend/src/pages/ProductForm.jsx` | Added `departmentId` validation in `handleSave` |
| `cashier-app/src/stores/useShiftStore.js` | Added `_crossedMidnight` flag in `loadActiveShift` |
| `cashier-app/src/screens/POSScreen.jsx` | Added midnight shift warning banner |
| `frontend/src/pages/EmployeeReports.jsx` | Rewritten with layout wrapper + external CSS |
| `frontend/src/pages/EmployeeReports.css` | NEW — `er-` prefix |
| `frontend/src/pages/DepositRules.jsx` | Added layout wrapper; main export uses CSS classes |
| `frontend/src/pages/DepositRules.css` | NEW — `dr-` prefix |
| `cashier-app/src/screens/PinLoginScreen.jsx` | Added clock mode PIN hint text |

---

---

## 📦 Recent Feature Additions (April 2026 — Session 6)

### Clock-In/Out Duplicate State Guard

**Root issue:** Backend `clockEvent` always created a new event without checking current state. A cashier could clock-in twice in a row.

**Backend (`posTerminalController.js` — `clockEvent`):**
After identifying the user by PIN, the handler now fetches their last clock event at this store:
```js
const lastEvent = await prisma.clockEvent.findFirst({
  where: { orgId, storeId: effectiveStoreId, userId: matchedUser.id },
  orderBy: { createdAt: 'desc' },
  select: { type: true, createdAt: true },
});
```
- `type='in'` + last was `'in'` → returns `{ alreadyClockedIn: true, since, userName }` (HTTP 200, no new event created)
- `type='out'` + no events or last was `'out'` → returns `{ notClockedIn: true, userName }` (HTTP 200, no event)
- Otherwise → creates event normally and returns `{ userName, type, createdAt }`

**Cashier App (`PinLoginScreen.jsx`):**
- New state `clockWarn: { kind: 'alreadyIn'|'notIn', userName, since? }`
- `submitClock` branches on response flags: sets `clockWarn` instead of `clockDone`
- `fmtDuration(since)` helper: "2h 14m" countdown from the `since` timestamp
- New warning screen replaces numpad when `clockWarn` is set:
  - **Already clocked in**: ⏱ amber banner showing "Clocked in for Xh Ym", prompt to clock out
  - **Not clocked in**: 🔒 red message, prompt to clock in
  - "Done" button auto-switches `clockType` to the correct action (so cashier can immediately proceed)
- `switchMode()` now also clears `clockWarn`

---

### Employee Timesheet Tab + PDF Export (`EmployeeReports.jsx`)

**Two-tab layout**: Summary | 🕐 Timesheet

**Timesheet tab:**
- Shows each employee as an expandable card (click to expand sessions)
- Session rows: Date · Clock In · Clock Out · Duration · Status badge (⬤ Active pulsing dot when still clocked in)
- Per-employee "PDF" button + "Export All as PDF" toolbar button
- Data comes from existing `sessions[]` array already returned by `GET /reports/employees`

**PDF export (zero new dependencies):**
- `openPDFWindow(employees, from, to)` opens a new `window.open()` tab
- `buildPDFHTML()` generates a clean print-ready HTML document with inline CSS
- Print-specific `@media print` hides the "Print / Save as PDF" button
- `setTimeout(() => w.print(), 400)` auto-triggers the browser print dialog
- Works as both physical print and "Save as PDF" (via browser's built-in PDF driver)

| File | Change |
|------|--------|
| `frontend/src/pages/EmployeeReports.jsx` | Added tabs, Timesheet tab, TimesheetCard component, PDF functions |
| `frontend/src/pages/EmployeeReports.css` | Added tab bar, timesheet card, session row, active badge, PDF button styles |

---

### Sidebar Scroll Position Persistence (`Sidebar.jsx`)

**Root cause (architectural):** Every portal page mounts its own `<Sidebar />` — there is no shared persistent layout. When React Router navigates, the old page unmounts (destroying Sidebar + its `scrollTop`), and the new page mounts a fresh Sidebar at `scrollTop = 0`.

**Fix (pragmatic — no refactor of 30+ pages needed):**
`useLayoutEffect` restores `scrollTop` from `sessionStorage` before the first paint:
```jsx
useLayoutEffect(() => {
  const saved = sessionStorage.getItem('sidebar-scroll-y');
  if (saved && asideRef.current) asideRef.current.scrollTop = parseInt(saved, 10);
}, []);
```
`onScroll` on the `<aside>` element saves the current position:
```jsx
<aside ref={asideRef} onScroll={e => sessionStorage.setItem('sidebar-scroll-y', e.currentTarget.scrollTop)}>
```
`useLayoutEffect` (vs `useEffect`) runs synchronously before paint, preventing a flash of scroll position 0.

**Why not a shared layout?** That requires removing `<Sidebar />` from all 30+ individual page files — a large refactor. The `sessionStorage` approach solves the UX problem without touching any other files.

---

### 📝 Standing Instructions (apply to every prompt / task)

> These two rules are **mandatory** on every single task without exception:
>
> 1. **Use external CSS for all UI** — no inline `style={{}}` in new JSX. Create a `.css` file with a unique class prefix per component.
> 2. **Update CLAUDE.md after completing the task** — mark the backlog item `[x]`, add a summary under "Recent Feature Additions", and update the roadmap.

---

---

## 📦 Recent Feature Additions (April 2026 — Session 7)

### Bug Fix: Clock Events Not Showing in Back-Office Reports (`employeeReportsController.js`)

**Root cause:** `new Date('2026-04-07')` in JavaScript/Node.js creates `2026-04-07T00:00:00.000Z` (midnight UTC). When used as `lte: toDate` in a Prisma `where` clause, all clock events that occurred *after* midnight UTC that day (i.e., every event during business hours in non-UTC timezones) are excluded.

**Fix:** Added `parseFromDate` and `parseToDate` helpers that append explicit time suffixes:
```js
function parseFromDate(str) {
  return str ? new Date(str + 'T00:00:00.000Z') : (() => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - 7); d.setUTCHours(0, 0, 0, 0); return d;
  })();
}
function parseToDate(str) {
  return str ? new Date(str + 'T23:59:59.999Z') : (() => {
    const d = new Date(); d.setUTCHours(23, 59, 59, 999); return d;
  })();
}
```
All date-range queries in `employeeReportsController.js` now use these helpers.

---

### Back-Office Clock Event CRUD (`employeeReportsController.js` + `reportsRoutes.js`)

New backend endpoints for manually managing employee clock sessions from the back-office portal:

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| `GET` | `/api/reports/employees` | manager+ | Aggregate report with sessions + sales per employee |
| `GET` | `/api/reports/employees/list` | manager+ | Employee dropdown list (PIN-enabled users only) |
| `GET` | `/api/reports/clock-events` | manager+ | Raw clock events with user info |
| `POST` | `/api/reports/clock-events` | owner+ | Create a clock-in + optional clock-out event |
| `PUT` | `/api/reports/clock-events/:id` | owner+ | Edit timestamp, type, or note of one event |
| `DELETE` | `/api/reports/clock-events/:id` | owner+ | Delete a single clock event |

**Controller functions added:**
- `listClockEvents` — returns events with `userName`, `userEmail`, `userRole` attached
- `listStoreEmployees` — returns `{ employees }` for dropdowns, filtered to `posPin: { not: null }` (cashier-app users only)
- `createClockSession` — body `{ userId, storeId, inTime, outTime?, note? }` — creates `in` event and optional `out` event; returns `{ inEvent, outEvent }`
- `updateClockEvent` — body `{ timestamp?, type?, note? }` — ownership-checked by `orgId`
- `deleteClockEvent` — ownership-checked; returns `{ success: true }`

**Route guards:**
```js
const readGuard  = [protect, requireTenant, authorize('manager', 'owner', 'admin', 'superadmin')];
const writeGuard = [protect, requireTenant, authorize('owner', 'admin', 'superadmin')];
```

---

### New API Functions (`frontend/src/services/api.js`)

Added before the `// ── Public API` section:
```js
export const getEmployeeReport     = (params)    => api.get('/reports/employees',           { params }).then(r => r.data);
export const getStoreEmployees     = (params)    => api.get('/reports/employees/list',       { params }).then(r => r.data);
export const getClockEvents        = (params)    => api.get('/reports/clock-events',         { params }).then(r => r.data);
export const createClockSession    = (data)      => api.post('/reports/clock-events',        data).then(r => r.data);
export const updateClockEventEntry = (id, data)  => api.put(`/reports/clock-events/${id}`,  data).then(r => r.data);
export const deleteClockEventEntry = (id)        => api.delete(`/reports/clock-events/${id}`).then(r => r.data);
```

---

### Employee Reports — Manage Shifts Tab (`EmployeeReports.jsx` + `EmployeeReports.css`)

`EmployeeReports.jsx` fully rewritten with **3 tabs**: Summary | 🕐 Timesheet | 🛠 Manage Shifts

**Manage Shifts tab:**
- `ShiftForm` sub-component: employee dropdown (for Add mode), `datetime-local` inputs for clock-in/out, note field, Save/Cancel
- Session pairing algorithm via `React.useMemo` from raw `msEvents` — groups events by `userId`, pairs each `in` with the next `out`
- Sessions sorted descending by `inTime` (most recent first)
- **Active sessions** — unpaired `in` events → shown with pulsing green ⬤ badge
- **Orphan events** — unmatched `out` events → shown with red badge
- **Edit**: populates `ShiftForm` with `isoToDatetimeLocal()` conversion of existing timestamps
- **Delete**: calls `window.confirm()` then deletes `inEvent` and `outEvent` IDs separately
- Employee filter dropdown + date range + Refresh button

**`isoToDatetimeLocal` helper:**
```js
function isoToDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

**New CSS classes added to `EmployeeReports.css` (`er-ms-` prefix):**
- `.er-ms-toolbar`, `.er-ms-add-btn`, `.er-ms-emp-filter`
- `.er-ms-form-panel`, `.er-ms-form-grid`, `.er-ms-form-field`, `.er-ms-form-input`
- `.er-ms-table-wrap`, `.er-ms-table-head`, `.er-ms-row` (grid: `1.6fr 1fr 1fr 1fr 0.8fr 100px`)
- `.er-ms-btn-edit`, `.er-ms-btn-delete`, `.er-ms-active-badge`, `.er-ms-active-dot`, `.er-ms-orphan-badge`

| File | Change |
|------|--------|
| `backend/src/controllers/employeeReportsController.js` | Fully rewritten — UTC date fix + 5 new controller functions |
| `backend/src/routes/reportsRoutes.js` | Rewritten — 6 routes with `readGuard`/`writeGuard` split |
| `frontend/src/services/api.js` | Added 6 new employee reports / clock-event API functions |
| `frontend/src/pages/EmployeeReports.jsx` | Rewritten — 3 tabs: Summary, Timesheet, Manage Shifts |
| `frontend/src/pages/EmployeeReports.css` | Extended with `er-ms-` prefix styles for Manage Shifts tab |

---

### Backlog Updates

- [x] **Employee schedule management** (Medium-Term) — back-office shift management (add/edit/delete clock sessions) is now live via the Manage Shifts tab in Employee Reports

---

---

## 📦 Recent Feature Additions (April 2026 — Session 8)

### Full Support Tickets Module — Admin Panel + Store Portal

**Schema (existing `SupportTicket` model — no migration needed):**
- `responses Json? @default("[]")` — array of `{ by, byType ('admin'|'store'), message, date }` — now fully used

**Backend — New Endpoints:**

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| `POST` | `/api/admin/tickets` | superadmin | Create ticket on behalf of a user |
| `DELETE` | `/api/admin/tickets/:id` | superadmin | Delete a ticket |
| `POST` | `/api/admin/tickets/:id/reply` | superadmin | Add admin reply (auto-sets status to `in_progress` if was `open`) |
| `GET` | `/api/tickets` | manager+ | List org's own tickets |
| `POST` | `/api/tickets` | manager+ | Create ticket (userId + orgId auto-attached) |
| `GET` | `/api/tickets/:id` | manager+ | Get single ticket with full thread |
| `POST` | `/api/tickets/:id/reply` | manager+ | Store adds reply to thread |

**New files:**
- `backend/src/controllers/ticketController.js` — store-side CRUD
- `backend/src/routes/ticketRoutes.js` — mounted at `/api/tickets`

**Admin Panel (`admin-app/src/pages/AdminTickets.jsx`) — full rewrite:**
- Split view: ticket list (left) + detail panel (right, sticky)
- Search by subject/email, filter tabs by status
- Create ticket modal (email, name, subject, body, priority)
- Per-ticket: status/priority inline dropdowns, delete button with confirm
- Conversation thread: original message + all responses, colour-coded by type (admin = purple, store = grey)
- Reply input (Ctrl+Enter to send) — sends via `POST /admin/tickets/:id/reply`
- Internal admin notes section (amber background, not visible to store)
- `AdminTickets.css` — new file with `at-` prefix

**Portal (`frontend/src/pages/SupportTickets.jsx`) — new page:**
- List view with status filter tabs, ticket preview cards
- Create ticket modal (subject, body, priority) — auto-attaches user email/name/orgId
- Detail view with full conversation thread — admin replies shown with "Support Team" tag
- Store can reply to open/in-progress tickets
- Closed tickets show a notice, reply disabled
- `SupportTickets.css` — new file with `spt-` prefix
- Route: `/portal/support-tickets`
- Sidebar: new "Support" group with "Support Tickets" link

**Updated files:**
| File | Change |
|------|--------|
| `backend/src/controllers/adminController.js` | Added `createSupportTicket`, `deleteSupportTicket`, `addAdminTicketReply` |
| `backend/src/routes/adminRoutes.js` | Added POST, DELETE, POST reply routes |
| `backend/src/server.js` | Mounted `/api/tickets` route |
| `admin-app/src/services/api.js` | Added `createAdminTicket`, `deleteAdminTicket`, `addAdminTicketReply` |
| `frontend/src/services/api.js` | Added `getOrgTickets`, `createOrgTicket`, `getOrgTicket`, `addOrgTicketReply` |
| `frontend/src/components/Sidebar.jsx` | Added "Support" group with Support Tickets link + `MessageSquare` icon import |
| `frontend/src/App.jsx` | Added `/portal/support-tickets` route |

---

## 📦 Recent Feature Additions (April 2026 — Session 8)

### Admin Panel Extracted into Standalone App (`admin-app/`)

The superadmin panel was previously embedded inside the main `frontend/` app as `/admin/*` routes with an `AdminRoute` guard. It has been fully extracted into a **separate React + Vite application** at `admin-app/` with its own build pipeline, login page, and routing.

#### New Application: `admin-app/`
- **Port**: 5175
- **Auth**: Separate `admin_user` localStorage key — superadmin-only login, no signup
- **Routes**: No `/admin` prefix needed — routes are `/dashboard`, `/users`, `/organizations`, `/cms`, `/careers`, `/tickets`, `/config`, `/analytics/*`
- **12 admin pages** migrated with adjusted imports
- **3 shared components** copied: `AdminSidebar`, `StoreveuLogo`, `RichTextEditor`
- **Dedicated API service** with 24 admin API functions + login
- **Dark theme** with design tokens in `global.css`

#### Files Created
| File | Purpose |
|------|---------|
| `admin-app/package.json` | React 19, Vite 7, Axios, Recharts, Lucide, React-Toastify, React-Quill |
| `admin-app/vite.config.js` | Port 5175, proxies `/api` → `http://localhost:5000` |
| `admin-app/index.html` | Entry HTML |
| `admin-app/src/main.jsx` | BrowserRouter + App render |
| `admin-app/src/App.jsx` | All routes + `ProtectedRoute` (superadmin check) |
| `admin-app/src/pages/Login.jsx` + `Login.css` | Superadmin login (`al-` prefix CSS) |
| `admin-app/src/services/api.js` | Axios client + 24 admin endpoints |
| `admin-app/src/styles/global.css` | Light theme tokens, sidebar, layout |
| `admin-app/src/styles/admin.css` | All admin component styles |
| `admin-app/src/components/AdminSidebar.jsx` | Nav links (paths stripped of `/admin` prefix) |
| `admin-app/src/components/StoreveuLogo.jsx` | Brand SVG component |
| `admin-app/src/components/RichTextEditor.jsx` | Quill editor for CMS/Careers |

#### Files Modified
| File | Change |
|------|---------|
| `backend/src/server.js` | Added `http://localhost:5175` to CORS origins |
| `package.json` (root) | Added `dev:admin` script; updated `dev` to run 4 apps; updated `install:all` |
| `.claude/launch.json` | Added `Admin App` configuration |
| `frontend/src/App.jsx` | Removed 12 admin imports, `AdminRoute` component, and 12 `/admin/*` routes |
| `frontend/src/services/api.js` | Removed 24 admin API functions |
| `frontend/src/pages/Login.jsx` | Removed superadmin → `/admin` redirect; all users go to `/portal/pos-api` |

#### Key Design Decisions
- **Separate localStorage key**: `admin_user` (not `user`) — admin sessions are independent of portal sessions
- **No signup**: Login page only — superadmin accounts are created via seed/backend
- **Auto-redirect**: If already logged in as superadmin, Login page redirects to `/dashboard`
- **Non-superadmin rejection**: Login form validates `role === 'superadmin'` and shows error toast for other roles

---

### Admin Panel — Light Theme Conversion

All admin-app styles converted from dark to light theme:

**`global.css` token changes:**
| Token | Dark | Light |
|-------|------|-------|
| `--bg-primary` | `#0c0f1a` | `#f8fafc` |
| `--bg-secondary` | `#111527` | `#ffffff` |
| `--bg-card` | `rgba(255,255,255,0.03)` | `#ffffff` |
| `--text-primary` | `#e8eaf6` | `#0f172a` |
| `--text-secondary` | `#a0a8c4` | `#475569` |
| `--border-color` | `rgba(255,255,255,0.08)` | `#e2e8f0` |

**`admin.css` changes:**
- All badge variants use solid light backgrounds (e.g. `#d1fae5` for active, `#fef3c7` for pending)
- Tables, cards, buttons, alerts — all swapped from dark semi-transparent to light solid colors
- Added `admin-dash-*` prefix classes for dashboard grid, cards, and mini-tables

**Analytics pages** — chart tooltip, grid, and axis colors updated to light theme in: `AdminAnalytics.jsx`, `AdminStorePerformance.jsx`, `AdminUserActivity.jsx`

---

### Admin Dashboard — Enhanced Layout

**Backend** (`adminController.js` — `getDashboardStats`):
Response now includes 6 additional fields:
- `recentUsers` — last 5 user signups (name, email, role, status, createdAt)
- `recentOrgs` — last 5 orgs (name, plan, userCount, storeCount, createdAt)
- `recentTickets` — last 5 tickets (subject, status, priority, createdAt)
- `chartData` — 7-day signup trend (users + orgs per day)
- `usersByRole` — role distribution counts
- `orgsByPlan` — plan distribution counts

**Frontend** (`AdminDashboard.jsx`):
New layout below stat cards:
```
┌──────────────────────────────────────────────────┐
│  5 Stat Cards (row)                              │
├──────────────────────┬───────────────────────────┤
│  7-day Signups       │  Users by Role            │
│  AreaChart           │  PieChart (donut)         │
├──────────────────────┴───────────────────────────┤
│  Recent Users (table) │  Recent Orgs (table)     │
├──────────────────────┴───────────────────────────┤
│  Recent Support Tickets (full-width table)       │
└──────────────────────────────────────────────────┘
```

Uses recharts `AreaChart`, `PieChart` with light-compatible tooltip styles.

---

### Frontend Admin Cleanup

Deleted leftover admin files from the main frontend directory:
- `frontend/src/pages/admin/` — 13 files (12 pages + admin.css)
- `frontend/src/components/AdminSidebar.jsx`

These were already unused (imports removed in Session 8) but the files remained on disk.

---

### Email System (`backend/src/services/emailService.js`)

Centralized email service using nodemailer. All email sending goes through this service. Templates use branded HTML with `wrapTemplate()` for consistent header/footer.

**Email templates:**
| Function | Trigger | Recipient |
|----------|---------|-----------|
| `sendForgotPassword` | POST /auth/forgot-password | User |
| `sendPasswordChanged` | POST /auth/reset-password | User |
| `sendNewSignupNotifyAdmin` | POST /auth/signup | Admin |
| `sendUserApproved` | PUT /admin/users/:id/approve | User |
| `sendUserRejected` | PUT /admin/users/:id/reject | User |
| `sendUserSuspended` | PUT /admin/users/:id/suspend | User |
| `sendContactConfirmation` | POST /public/tickets | Submitter |
| `sendContactNotifyAdmin` | POST /public/tickets | Admin |

**Auth controller changes:**
- `forgotPassword` — generates crypto token, stores hashed in DB, sends reset email
- `resetPassword` (new) — validates token, updates password, sends confirmation email
- `signup` — now sends admin notification email

**New `.env` vars:** `FRONTEND_URL`, `ADMIN_URL`

---

### Login-as-User (Admin Impersonation)

**Backend** (`adminController.js` — `impersonateUser`):
- `POST /api/admin/users/:id/impersonate`
- Generates 2-hour JWT with target user's identity + `impersonatedBy` audit field
- Blocks impersonation of other superadmins
- Returns token + user object (id, name, email, role, orgId, storeIds)

**Admin UI** (`AdminUsers.jsx`):
- "Login As" button (LogIn icon) in actions column for active non-superadmin users
- Opens portal in new tab: `http://localhost:5173/impersonate?token=...&user=...`

**Portal** (`frontend/src/App.jsx`):
- `/impersonate` route reads token + user from URL, stores in `localStorage.user`, redirects to portal

---

### Full CRUD — Users, Organizations, Stores

**New backend endpoints:**
| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/admin/users` | Create user (temp password) |
| PUT | `/api/admin/users/:id` | Update user fields |
| DELETE | `/api/admin/users/:id` | Soft delete (suspend) |
| POST | `/api/admin/users/:id/impersonate` | Login as user |
| POST | `/api/admin/organizations` | Create organization |
| DELETE | `/api/admin/organizations/:id` | Soft delete (deactivate) |
| GET | `/api/admin/stores` | List all stores |
| POST | `/api/admin/stores` | Create store |
| PUT | `/api/admin/stores/:id` | Update store |
| DELETE | `/api/admin/stores/:id` | Soft delete (deactivate) |

**Admin panel pages updated:**
- `AdminUsers.jsx` — Create/Edit modal, Delete, Login As, plus existing approve/suspend/reject
- `AdminOrganizations.jsx` — Create/Edit modal with slug auto-gen, Delete (deactivate)
- `AdminStores.jsx` (new) — Full CRUD with org dropdown, table view

**New files:**
| File | Purpose |
|------|---------|
| `backend/src/services/emailService.js` | Centralized email service with 8 branded templates |
| `admin-app/src/pages/AdminStores.jsx` | Store management CRUD page |

**Modified files:**
| File | Change |
|------|--------|
| `backend/src/controllers/authController.js` | Forgot/reset password, signup notification |
| `backend/src/controllers/adminController.js` | Email on approve/reject/suspend, user/org/store CRUD, impersonate |
| `backend/src/controllers/publicController.js` | Uses emailService instead of inline nodemailer |
| `backend/src/routes/adminRoutes.js` | Added 10 new routes |
| `backend/src/routes/authRoutes.js` | Added reset-password route |
| `admin-app/src/services/api.js` | Added 11 new API functions |
| `admin-app/src/pages/AdminUsers.jsx` | Full CRUD + Login As |
| `admin-app/src/pages/AdminOrganizations.jsx` | Full CRUD |
| `admin-app/src/components/AdminSidebar.jsx` | Added "Stores" nav item |
| `admin-app/src/App.jsx` | Added /stores route |
| `frontend/src/App.jsx` | Added /impersonate route |
| `backend/.env` | Added FRONTEND_URL, ADMIN_URL |

---

## Session 9 — P2 Features: Multi-UPC, Multi-Pack-Size, Simplified Pack/Deposit

### Schema Changes (`backend/prisma/schema.prisma`)

**MasterProduct** — 3 new fields added:
- `unitPack Int?` — units per sell unit (1=single, 6=6-pack, 12=12-pack, etc.)
- `packInCase Int?` — how many sell units per vendor case
- `depositPerUnit Decimal? @db.Decimal(10,4)` — flat per-unit deposit (replaces complex DepositRule volume-matching)

**`@@unique([orgId, upc])` removed** — replaced with `@@index` (upc no longer unique on master table; uniqueness enforced in ProductUpc table).

**New model `ProductUpc`** (`product_upcs` table):
- Links multiple barcodes to one product
- `@@unique([orgId, upc])` — each barcode unique per org
- Fields: `id`, `orgId`, `masterProductId`, `upc`, `label`, `isDefault`, `createdAt`
- Relation: `MasterProduct @relation(onDelete: Cascade)`

**New model `ProductPackSize`** (`product_pack_sizes` table):
- Defines selectable sizes shown in cashier picker modal at scan
- Fields: `id`, `orgId`, `masterProductId`, `label`, `unitCount`, `retailPrice`, `costPrice`, `isDefault`, `sortOrder`, `createdAt`, `updatedAt`
- Relation: `MasterProduct @relation(onDelete: Cascade)`

### Backend API Changes

**`catalogController.js`** — 6 new exported functions:
| Function | Route | Description |
|----------|-------|-------------|
| `getProductUpcs` | GET /products/:id/upcs | List all UPCs for a product |
| `addProductUpc` | POST /products/:id/upcs | Add UPC; blocks duplicate per org |
| `deleteProductUpc` | DELETE /products/:id/upcs/:upcId | Remove UPC |
| `getProductPackSizes` | GET /products/:id/pack-sizes | List pack sizes ordered by sortOrder |
| `addProductPackSize` | POST /products/:id/pack-sizes | Add pack size |
| `updateProductPackSize` | PUT /products/:id/pack-sizes/:sizeId | Update pack size |
| `deleteProductPackSize` | DELETE /products/:id/pack-sizes/:sizeId | Remove pack size |

**`searchMasterProducts`** — now checks `ProductUpc` table first before falling back to `MasterProduct.upc`; includes `upcs` and `packSizes` in all search/get responses.

**`getMasterProduct`**, **`getMasterProducts`** — include `upcs` and `packSizes` in response.

**`createMasterProduct` / `updateMasterProduct`** — handle `unitPack`, `packInCase`, `depositPerUnit` fields.

**`catalogRoutes.js`** — 7 new routes added under `/api/catalog/products/:id/upcs` and `/api/catalog/products/:id/pack-sizes`.

### Frontend (Portal) Changes

**`frontend/src/pages/ProductForm.css`** (NEW):
- Prefix: `pf-`
- Covers: page layout, cards, form elements, chip selectors, dollar inputs, margin bar, pack visual, deposit section, UPC manager, pack sizes manager, deals, right sidebar

**`frontend/src/pages/ProductForm.jsx`**:
- Imports `ProductForm.css` and new API functions
- New state: `upcs`, `newUpc`, `newUpcLabel`, `packSizes`, `psLabel`, `psUnits`, `psPrice`, `psDefault`
- New form fields: `unitPack`, `packInCase`, `depositPerUnit`
- New handlers: `handleAddUpc`, `handleDeleteUpc`, `handleAddPackSize`, `handleDeletePackSize`
- **New section "Additional UPCs / Barcodes"** — shows existing UPCs, add row, delete button
- **New section "Pack Sizes (Cashier Picker)"** — shows existing pack sizes, add row with label/unitCount/price/default
- **Simplified pack config** — added `unitPack` + `packInCase` chip selectors above existing complex selectors (synced bidirectionally)
- **Simplified deposit** — flat `depositPerUnit` field with quick-set buttons ($0.05/$0.10/$0.15/$0.20); old container type/volume auto-match collapsed to `<details>` (advanced)
- UPCs and pack sizes loaded via API on edit; saved individually via their own endpoints

**`frontend/src/services/api.js`** — 7 new exports:
- `getProductUpcs`, `addProductUpc`, `deleteProductUpc`
- `getProductPackSizes`, `addProductPackSize`, `updateProductPackSize`, `deleteProductPackSize`

### Cashier App Changes

**`cashier-app/src/components/modals/PackSizePickerModal.jsx`** (NEW):
- Shows when scanned product has 2+ pack sizes
- Grid of tappable buttons: label, unit count, price
- `isDefault` size is highlighted and auto-focused
- Props: `product`, `onSelect(size)`, `onCancel()`

**`cashier-app/src/components/modals/PackSizePickerModal.css`** (NEW):
- Prefix: `pspm-`
- Dark POS theme, large tappable buttons, accent color on hover

**`cashier-app/src/screens/POSScreen.jsx`**:
- Imports `PackSizePickerModal`
- New state: `packPickerProduct` (pending product)
- New handler: `handlePackSizeSelect(product, size)` — adds product with size's price/label/unitCount
- `handleScan` updated: if `product.packSizes.length > 1` → show picker; if exactly 1 → use silently; otherwise → normal flow

### Scan flow with pack sizes
1. Cashier scans barcode
2. Backend checks `ProductUpc` table first → finds product
3. API response includes `packSizes` array
4. If `packSizes.length > 1`: `PackSizePickerModal` opens, cashier taps a size
5. If `packSizes.length === 1`: size applied silently
6. If `packSizes.length === 0`: normal flow (use `defaultRetailPrice`)

---

## 📦 Recent Feature Additions (April 2026 — Session 10)

### E-Commerce Module — Phase 1 Foundation

Complete infrastructure for the e-commerce add-on module. Each organization can optionally enable e-commerce; each store gets its own branded online storefront.

#### Architecture Overview
```
POS Backend (:5000)  ──► BullMQ (Redis) ──► ecom-backend (:5005) ──► Ecom DB
                                                                  ──► Next.js Storefront (:3000)
```

- **POS is source of truth** for products, inventory, pricing
- **Event-driven sync** via BullMQ (Redis-backed) — POS emits events on every product/department/inventory mutation
- **Separate PostgreSQL database** (`storeveu_ecom`) for e-commerce data
- **ISR (Incremental Static Regeneration)** via Next.js — SSG + short TTL invalidation
- **Redis cache** for real-time inventory (60s TTL)
- **Synchronous stock check** at online checkout (ecom-backend → POS backend HTTP call)

#### New Apps

| App | Directory | Port | Tech |
|-----|-----------|------|------|
| E-com Backend | `ecom-backend/` | 5005 | Express + Prisma (own DB) |
| Storefront | `storefront/` | 3000 | Next.js (JavaScript, ISR) |

#### New Shared Packages

| Package | Directory | Purpose |
|---------|-----------|---------|
| `@storv/redis` | `packages/redis/` | Shared ioredis singleton client |
| `@storv/queue` | `packages/queue/` | BullMQ queue definitions + producer helpers |

#### E-Commerce Prisma Schema (`ecom-backend/prisma/schema.prisma`)

| Model | Purpose |
|-------|---------|
| `EcomStore` | Per-store config (slug, customDomain, branding, fulfillment, SSL status) |
| `EcomProduct` | Synced from POS MasterProduct + StoreProduct, `@@unique([storeId, posProductId])` |
| `EcomDepartment` | Synced from POS Department, `@@unique([storeId, posDepartmentId])` |
| `EcomPage` | CMS pages (website builder), `@@unique([storeId, slug])` |
| `EcomCart` | Server-side shopping cart with 7-day expiry |
| `EcomOrder` | Online orders with full lifecycle (pending → confirmed → preparing → ready → completed) |
| `EcomCustomer` | Online store customer accounts, optionally linked to POS Customer |
| `SyncEvent` | Audit trail for data sync pipeline |

#### E-com Backend API Routes

**Public (no auth):** `GET /api/store/:slug`, `/products`, `/departments`, `/pages`, `/cart`, `POST /checkout`
**Management (portal JWT):** `GET/PUT /api/manage/ecom-store`, `/products`, `/orders`, `/pages`, `/sync/status`

#### Sync Pipeline

**Producer (POS backend `catalogController.js`):**
- `emitProductSync()` on create/update/delete MasterProduct
- `emitDepartmentSync()` on create/update/delete Department
- `emitInventorySync()` on upsert/adjust StoreProduct

**Consumer (ecom-backend `syncWorker.js`):**
- BullMQ worker processes events, upserts into ecom DB
- Updates Redis inventory cache
- Triggers Next.js on-demand ISR revalidation
- Records audit trail in SyncEvent table

#### Stock Check Endpoint (POS Backend)

`POST /api/catalog/ecom-stock-check` — no auth (internal service call)
- Input: `{ storeId, items: [{ posProductId, requestedQty }] }`
- Output: `{ available: boolean, items: [{ posProductId, quantityOnHand, available }] }`

#### Next.js Storefront

- Multi-tenant via hostname middleware (subdomain or custom domain)
- ISR pages: Home (5min), Products (60s), Product Detail (60s)
- On-demand revalidation: `POST /api/revalidate?secret=TOKEN&path=/products/slug`
- Components: Header, Footer, ProductCard, ProductGrid

#### Infrastructure Changes

| File | Change |
|------|--------|
| `package.json` (root) | Added `"workspaces": ["packages/*"]`, 6-app `dev` script, `dev:ecom`, `dev:storefront` |
| `backend/docker-compose.yml` | Added Redis 7-alpine service on :6379 |
| `backend/package.json` | Added `@storv/redis`, `@storv/queue` dependencies |
| `backend/src/controllers/catalogController.js` | Import + emit sync events on all product/dept/inventory mutations |
| `backend/src/routes/catalogRoutes.js` | Added `POST /ecom-stock-check` route |
| `backend/.env.example` | Added `http://localhost:5005` to CORS_ORIGIN |
| `.claude/launch.json` | Added Ecom Backend (:5005) and Storefront (:3000) configs |

#### New File Map

| File | Purpose |
|------|---------|
| `packages/redis/index.js` | Shared Redis client singleton (ioredis) |
| `packages/queue/index.js` | BullMQ queue definitions (ecom-sync, ecom-orders, ecom-revalidate) |
| `packages/queue/producers.js` | `emitProductSync`, `emitDepartmentSync`, `emitInventorySync`, `emitPromotionSync` |
| `ecom-backend/src/server.js` | Express app + BullMQ worker startup |
| `ecom-backend/src/middleware/auth.js` | JWT validation (shared secret with POS) |
| `ecom-backend/src/middleware/storeResolver.js` | Resolve EcomStore from URL slug or hostname |
| `ecom-backend/src/middleware/requireEcomEnabled.js` | Guard: store must have ecom enabled |
| `ecom-backend/src/controllers/storefrontController.js` | Public: products, departments, pages |
| `ecom-backend/src/controllers/orderController.js` | Cart, checkout, order management |
| `ecom-backend/src/controllers/ecomStoreController.js` | Store setup, branding, fulfillment config |
| `ecom-backend/src/controllers/productManageController.js` | Product visibility, ecom descriptions |
| `ecom-backend/src/controllers/pageController.js` | CMS page CRUD |
| `ecom-backend/src/controllers/syncController.js` | Sync pipeline status |
| `ecom-backend/src/services/stockCheckService.js` | Synchronous HTTP call to POS backend |
| `ecom-backend/src/services/revalidationService.js` | Calls Next.js on-demand ISR |
| `ecom-backend/src/workers/syncWorker.js` | BullMQ consumer: product/dept/inventory sync |
| `ecom-backend/src/config/redis.js` | Redis inventory cache helpers |
| `storefront/middleware.js` | Multi-tenant hostname → storeId routing |
| `storefront/pages/index.js` | Home page (ISR, 5min revalidation) |
| `storefront/pages/products/index.js` | Product listing (ISR, 60s) |
| `storefront/pages/products/[slug].js` | Product detail (ISR, 60s, fallback: blocking) |
| `storefront/pages/api/revalidate.js` | On-demand ISR trigger endpoint |
| `storefront/lib/api.js` | ecom-backend API client |
| `storefront/lib/store.js` | Store context provider |
| `storefront/styles/globals.css` | Global storefront CSS (`sf-` prefix) |

#### Dev Start (all 6 apps)

```bash
# Start Redis first
cd backend && docker compose up redis -d

# Then all apps at once (from root)
npm run dev

# Or individually
npm run dev:ecom        # E-com backend on :5005
npm run dev:storefront  # Next.js storefront on :3000
```

#### Setup for new ecom database

```bash
# Create the ecom database
# (In your PostgreSQL, create a database named storeveu_ecom)

# Push the schema
cd ecom-backend && npx prisma db push
```

---

## 📦 Recent Feature Additions (April 2026 — Session 11)

### E-Commerce Module — Phase 2+3: Complete Shopping Experience

#### Portal — "Online Store" Sidebar Group

**Store Setup (`EcomSetup.jsx`)** — 5-tab wizard:
1. **General** — store info + "Sync Products Now" button (full sync from POS)
2. **Branding** — logo text, primary color (picker + swatches), font selector, live preview
3. **Pages** — 15 templates (5 per page type) with SVG wireframe previews, section editor with image upload
4. **Fulfillment** — pickup/delivery toggles, hours, fees, min order
5. **SEO & Social** — meta title/description, Instagram/Facebook/Twitter links

**Online Orders (`EcomOrders.jsx`)** — order list with status filters, detail view, status progression
**Custom Domain (`EcomDomain.jsx`)** — connect custom domain, DNS verification, SSL status

#### Storefront — Full Shopping Experience

**15 Premium Templates:**
| Home (5) | About (5) | Contact (5) |
|----------|-----------|-------------|
| Centered Hero | Story + Mission | Split Layout |
| Split Screen | Timeline Journey | Card Layout |
| Minimal Clean | Card Values | Minimal Form |
| Image Overlay | Image + Stats | Map + Form |
| Bold Typography | Multi-Section | Modern Floating |

**Shopping Flow:**
- Product listing with department filtering, search, sort, pagination
- Product detail with qty selector + add to cart
- Cart drawer (slide-in) + full cart page
- Checkout flow (requires authentication — redirects to login, returns after)
- Order confirmation page
- Customer auth: signup, login, my account with order history

**Dynamic Branding:**
- `_app.js` BrandingInjector — applies primary color + font as CSS vars
- Google Fonts loaded dynamically via `<link>` injection
- Each store has unique colors/fonts configured from portal

**Multi-Tenant:**
- All pages use `getServerSideProps` with `withStore()` helper
- Store resolved from: `?store=` query → subdomain → custom domain → fallback
- Each store sees only its own products/branding/pages

#### Backend Infrastructure

**Email Service (`ecom-backend/src/services/emailService.js`):**
- Contact form: sends notification to store + confirmation to customer
- Order confirmation: branded email with items, total, fulfillment type
- Order status update: email when status changes (preparing, ready, completed, cancelled)

**Product Sync Pipeline:**
- BullMQ (when Redis available) — async with retries
- HTTP fallback (no Redis) — direct POST to `POST /api/internal/sync`
- Full sync button — `POST /api/internal/sync/full` pulls all products from POS API
- Products auto-sync on every create/update/delete in POS portal

**Image Upload:**
- `POST /api/manage/upload` — multer, 5MB limit, JPEG/PNG/GIF/WebP/SVG
- Static serving at `/uploads/*`

**Customer Auth:**
- `POST /store/:slug/auth/signup` — bcrypt password, returns JWT
- `POST /store/:slug/auth/login` — validates password, returns JWT
- `GET /store/:slug/auth/me` — customer profile
- `GET /store/:slug/auth/orders` — order history

**Custom Domain:**
- `GET /manage/domain/status` — current domain + SSL status
- `POST /manage/domain` — register custom domain
- `POST /manage/domain/verify` — DNS verification
- `DELETE /manage/domain` — remove custom domain
- Public `GET /store-by-domain?domain=` — resolve store by custom domain

#### Key Files Added/Modified

| File | Purpose |
|------|---------|
| `ecom-backend/src/services/emailService.js` | Email: contact form, order confirmation, status updates |
| `ecom-backend/src/routes/syncRoutes.js` | Direct sync + full sync endpoints (HTTP fallback) |
| `ecom-backend/src/routes/uploadRoutes.js` | Image upload (multer) |
| `ecom-backend/src/controllers/domainController.js` | Custom domain management |
| `ecom-backend/src/controllers/customerAuthController.js` | Customer signup/login/profile |
| `ecom-backend/src/middleware/customerAuth.js` | Customer JWT middleware |
| `storefront/lib/cart.js` | Cart context (localStorage + server sync) |
| `storefront/lib/auth.js` | Customer auth context |
| `storefront/lib/resolveStore.js` | Multi-tenant store resolver |
| `storefront/components/templates/*.js` | 15 premium template components |
| `storefront/styles/templates.css` | 500+ lines of template layout CSS |
| `frontend/src/pages/EcomSetup.jsx` | 5-tab store setup wizard |
| `frontend/src/pages/EcomOrders.jsx` | Order management |
| `frontend/src/pages/EcomDomain.jsx` | Custom domain setup |

---

## 📦 Recent Feature Additions (April 2026 — Session 12)

### E-Commerce Module — Phase 4: Store Discovery, Portal Enhancements, Account Features

#### Store Discovery (`localhost:3000` with no store param)
- New `GET /api/stores` endpoint returns all enabled EcomStores
- Discovery page: dark hero with search, 4-column store card grid (16:9 banner, logo, description, tags, "Visit Store" CTA)
- Responsive: 4 → 3 → 2 → 1 columns across breakpoints

#### Portal — Sidebar Restructured
- Analytics + Customers moved from EcomSetup tabs to standalone sidebar pages
- Online Store sidebar: Store Setup, Online Orders, Custom Domain, Analytics, Customers

#### Portal — Analytics (`/portal/ecom/analytics`)
- KPI cards: Total Revenue, Orders, Customers, Avg Order Value (Lucide icons)
- Revenue trend bar chart (last 14 days)
- Orders by status breakdown
- Top products table (name, qty sold, revenue)

#### Portal — Customers (`/portal/ecom/customers`)
- Searchable customer list (name, email, phone)
- Customer detail view: profile + order history
- Stats: order count, total spent, join date

#### Portal — Real-Time Order Notifications
- Global `EcomOrderNotifier` component polls every 15s across ALL portal pages
- Custom MP3 sound alert (`frontend/public/sounds/ordernotification.mp3`)
- Toast notification with click-to-navigate to orders page

#### Storefront — Lucide Icons (replaced all emojis)
- `lucide-react` installed in storefront
- New `components/icons.js` with DeptIcon, TrustIcon, ContactIcon, FulfillmentIcon
- All 5 Home templates: department + trust sections use Lucide
- All 5 Contact templates: Phone, Mail, MapPin, Clock icons
- Account page: FulfillmentIcon for pickup/delivery

#### Storefront — Customer Account Overhaul
- **Profile tab**: edit first name, last name, phone (email read-only), stats, save button
- **Orders tab**: order cards with status badges, link to detail page
- **Addresses tab**: add/edit/remove saved addresses with labels
- **Order detail** (`/account/orders/[id]`): status timeline, items, totals, fulfillment info

#### Storefront — Full Responsiveness
- Comprehensive breakpoints: 1024px, 768px (tablet), 640px, 480px (small mobile)
- Product grid: 4 → 2 columns; PDP stacks vertically; cart/checkout single column
- Templates: hero text scales, grids collapse, forms stack
- Touch-friendly buttons and badges on mobile

#### Store Logo / Banner
- Portal General tab: upload store logo/banner (16:9 recommended)
- Stored in `branding.logoUrl` (JSONB)
- Discovery cards show full-cover image or color fallback with initial letter

#### Email Service (`ecom-backend/src/services/emailService.js`)
- Contact form: notification to store + confirmation to customer
- Order confirmation: branded email with items, total, fulfillment
- Order status update: email when status changes

#### Backend Schema
- `EcomCustomer`: added `firstName`, `lastName` fields
- Customer auth: signup/login/profile handle first/last name
- New endpoint: `GET /store/:slug/auth/orders/:orderId` — order detail

#### Key Files Added
| File | Purpose |
|------|---------|
| `frontend/src/pages/EcomAnalytics.jsx` | Standalone analytics page |
| `frontend/src/pages/EcomCustomers.jsx` | Standalone customers page |
| `frontend/src/components/EcomOrderNotifier.jsx` | Global order notification polling |
| `frontend/public/sounds/ordernotification.mp3` | Notification sound file |
| `storefront/components/icons.js` | Shared Lucide icon mappings |
| `storefront/pages/account/orders/[id].js` | Order detail page |
| `storefront/.env.example` | Storefront environment template |
| `ecom-backend/src/controllers/analyticsController.js` | Analytics KPIs + charts |
| `ecom-backend/src/controllers/customerManageController.js` | Customer list/detail |
| `ecom-backend/src/services/emailService.js` | Email notifications |

---

## 📊 Sales Prediction Engine — Algorithm Reference

**File:** `backend/src/utils/predictions.js`

### Core: Holt-Winters Triple Exponential Smoothing

The primary forecasting algorithm. Decomposes time-series data into three components:

- **Level (α = 0.3)** — The smoothed baseline value
- **Trend (β = 0.1)** — The direction and magnitude of change  
- **Seasonality (γ = 0.2)** — Repeating cyclical patterns

**Initialization:**
- Level: mean of first seasonal period
- Trend: average slope across first two periods
- Seasonal indices: ratio of each observation to initial level

**Forecast:** `F(t+h) = (Level + Trend × h) × Seasonal[(n+h-1) mod period]`

**Periods:**
- Daily predictions: period = 7 (weekly seasonality)
- Weekly predictions: period = 4 (monthly seasonality)
- Minimum data required: 2 × period observations

### Day-of-Week Adjustment Factors

Applied after Holt-Winters to account for consistent weekday patterns:

| Day | Factor | Meaning |
|-----|--------|---------|
| Sunday | 1.15 | +15% above baseline |
| Monday | 0.90 | −10% (slowest weekday) |
| Tuesday | 0.88 | −12% |
| Wednesday | 0.92 | −8% |
| Thursday | 1.00 | Baseline |
| Friday | 1.20 | +20% (pre-weekend boost) |
| Saturday | 1.30 | +30% (peak day) |

### Weather Impact Regression

**Function:** `computeWeatherImpact(historicalData)`

Computes weather impact coefficients by comparing sales on weather-affected days vs normal days:

1. Categorize historical days: rainy (precip > 0.5"), cold (< 32°F), hot (> 90°F), snowy (WMO 71-77), normal
2. Calculate average sales for each category
3. Derive multiplier: `(categoryAvg - normalAvg) / normalAvg`
4. Clamp to safe ranges to prevent over-correction

**Default coefficients (when insufficient data):**
- Rain: −12%
- Cold: −5%
- Hot: −3%
- Snow: −25%

### Holiday Impact Multipliers

Pre-defined multipliers for US federal holidays:

| Holiday | Multiplier | Impact |
|---------|-----------|--------|
| Christmas Day | 0.20 | −80% (most stores closed) |
| Thanksgiving | 0.30 | −70% |
| New Year's Day | 0.40 | −60% |
| Independence Day | 0.50 | −50% |
| Memorial Day | 0.80 | −20% |
| Labor Day | 0.75 | −25% |
| Other holidays | 0.85–0.90 | −10% to −15% |

### Hourly Distribution Model

**Function:** `computeHourlyDistribution(transactions)`

Learns the store's hourly sales pattern from recent transaction data:

1. Sum `grandTotal` per hour (0-23) across all recent transactions
2. Normalize to proportions summing to 1.0
3. Multiply daily prediction by each hour's proportion

**Default bell curve** (when no data): peaks at 12pm (12%) and symmetric decline.

### Prediction Pipeline (Daily Forecast)

```
Historical Daily Sales (90 days)
    ↓
Holt-Winters (period=7, α=0.3, β=0.1, γ=0.2)
    ↓
Day-of-Week Adjustment
    ↓
Holiday Multipliers
    ↓
Weather Impact (from 10-day forecast)
    ↓
Final Prediction + Factor Annotations
```

### Accuracy Validation

**Walk-forward testing:** Train on first N-14 days, predict last 14, compare:
- **MAPE** — Mean Absolute Percentage Error
- **MAE** — Mean Absolute Error  
- **RMSE** — Root Mean Square Error
- **Bias** — Systematic over/under prediction

---

## 🌤 Weather Integration — Architecture Reference

**Service:** `backend/src/services/weatherService.js`  
**Provider:** Open-Meteo (free, no API key required)

### APIs Used

| API | URL | Purpose |
|-----|-----|---------|
| Archive | `archive-api.open-meteo.com/v1/archive` | Historical weather (past dates) |
| Forecast | `api.open-meteo.com/v1/forecast` | Current + future weather |

### Data Parameters

Daily: `temperature_2m_max`, `temperature_2m_min`, `temperature_2m_mean`, `precipitation_sum`, `weathercode`, `windspeed_10m_max`, `relative_humidity_2m_mean`

Hourly: `temperature_2m`, `precipitation_probability`, `weathercode`, `windspeed_10m`, `relative_humidity_2m`

### Caching Strategy

- PostgreSQL `WeatherCache` table keyed by `(date, latitude, longitude)`
- Coordinates rounded to 2 decimal places for cache key
- On request: check cache → fetch missing dates → upsert cache → return merged
- Forecast data re-fetched daily (cache TTL implicit: forecast dates overwrite)

### Weather Functions

| Function | Purpose |
|----------|---------|
| `fetchWeatherRange(lat, lon, from, to, tz)` | Historical + forecast daily weather with caching |
| `getCurrentWeather(lat, lon, tz)` | Live conditions + 3-day mini forecast |
| `getHourlyForecast(lat, lon, tz)` | Next 48 hours hourly (temp, precip chance, wind) |
| `getTenDayForecast(lat, lon, tz)` | 10-day daily forecast with precip probability |
| `mergeSalesAndWeather(salesRows, weatherRecords)` | Join by date for combined analytics |

### WMO Weather Codes

99 distinct codes mapped to: condition label + icon name. Key codes:
- 0-3: Clear → Overcast
- 45-48: Fog
- 51-57: Drizzle (including freezing)
- 61-67: Rain (including freezing)
- 71-77: Snow
- 80-86: Showers
- 95-99: Thunderstorms

---

## 📤 Export System — Reference

### Frontend Utilities

**File:** `frontend/src/utils/exportUtils.js`

| Function | Purpose |
|----------|---------|
| `downloadCSV(data, columns, filename)` | Array → CSV Blob → download (UTF-8 BOM for Excel) |
| `downloadPDF({title, subtitle, summary, data, columns, filename})` | Styled PDF with KPI cards + auto-table via jspdf + jspdf-autotable |
| `exportChartAsPDF(chartElement, title, filename)` | Screenshot chart via html2canvas → PDF |

### Dependencies

- `jspdf` + `jspdf-autotable` — PDF generation with styled tables
- `file-saver` — Cross-browser Blob download
- `html2canvas` — DOM-to-image for chart export

### Pages with Export

All analytics pages have CSV + PDF export buttons in headers:
- Live Dashboard, Sales Analytics, Department Analytics, Product Analytics, Sales Predictions

---

## 🏗 Sidebar Navigation — Current Structure

```
Operations           → Live Dashboard
Customers            → Customers & Loyalty (tabs: Customers, Loyalty Program)
Lottery              → Lottery (10-tab mega-page)
Catalog              → Products, Departments, Promotions, Bulk Import, Inventory Count
Vendors              → Vendors, Vendor Payouts, Vendor Orders, Invoice Import, CSV Transform
Reports & Analytics  → Transactions (tabs: Transactions, Event Log, Employee, Payouts, Employees)
                     → Analytics (tabs: Sales, Departments, Products, Predictions)
Online Store         → Store Setup (tabs: General, Branding, Pages, Fulfillment, SEO, Custom Domain)
                     → Online Orders, Analytics
Integrations         → POS API, eComm
Point of Sale        → POS Configuration (tabs: Layout, Receipts, Quick Keys)
                     → Rules & Fees (tabs: Deposits, Tax)
Support & Billing    → Support Tickets, Billing & Plan
Account              → Account Settings (tabs: Organisation, Users, Stores, Settings)
```

### Tabbed Page Pattern

All hub pages follow the Lottery pattern:
1. `const [tab, setTab] = useState(searchParams.get('tab') || 'default')`
2. Tab buttons with `p-tab` / `p-tab.active` CSS classes from `portal.css`
3. Conditional rendering: `{tab === 'key' && <SubPage embedded />}`
4. Sub-pages accept `embedded` prop — when true, skip layout-container/Sidebar wrapper

### Shared Portal CSS

**File:** `frontend/src/styles/portal.css` — `p-` prefix namespace

Classes: `p-page`, `p-header`, `p-tabs`, `p-tab`, `p-card`, `p-stat-grid`, `p-stat-card`, `p-table`, `p-badge-*`, `p-btn-*`, `p-modal-*`, `p-field`, `p-input`, `p-grid-2/3/4`, `p-empty`, `p-loading`

All colors reference CSS variables from `index.css` (`--brand-*`, `--text-*`, `--bg-*`, `--border-*`, `--success`, `--error`, `--warning`).

---

## 🛍 Bag Fee System — Reference

**Cashier-app feature:** Adds a bag counter above payment buttons on the POS terminal.

### Configuration

Store-level setting in POS config (`store.pos.bagFee`):
```json
{ "enabled": true, "pricePerBag": 0.05, "ebtEligible": false, "discountable": false }
```

### Cart Integration

- `bagCount` state in `useCartStore.js` (Zustand)
- `selectTotals()` accepts optional `bagFeeInfo = { bagTotal, ebtEligible, discountable }`
- If discountable + order-level % discount, bag total is reduced proportionally
- If EBT eligible, bag total added to `ebtTotal`
- Bag total added to `grandTotal`

### Transaction Record

Bags stored as synthetic line item in `lineItems` JSON:
```json
{ "isBagFee": true, "name": "Bag Fee", "qty": 3, "unitPrice": 0.05, "lineTotal": 0.15, "taxable": false }
```

No schema migration needed — uses existing JSON column.

---

## 📺 Customer Display — Reference

**Cashier-app feature:** Read-only second screen showing live cart to customers.

### Architecture

- **Routing:** Hash-based — `/#/customer-display` renders `CustomerDisplayScreen`
- **Sync:** `BroadcastChannel('storv-customer-display')` — zero-latency, same-origin
- **Electron:** Auto-opens fullscreen on secondary monitor via `screen.getAllDisplays()`

### Message Types

| Type | When | Data |
|------|------|------|
| `cart_update` | Items/totals change | items, totals, bagCount, customer, loyalty, promos |
| `transaction_complete` | Sale finalized | txNumber, change |
| `idle` | Cart cleared | (empty) |

### Display States

1. **Idle** — Store name + clock (no items)
2. **Active** — Scrolling line items + summary panel (subtotal, tax, deposits, bags, discounts, total) + customer/loyalty bar
3. **Thank You** — Green checkmark + change due, auto-clears after 6 seconds

---

## 🔢 Seed Data — Reference

**Script:** `backend/prisma/seedTransactions.js`

Run: `node prisma/seedTransactions.js`

Generates ~3,500-4,000 POS transactions across 90 days with:
- Realistic hourly distribution (peaks at lunch/dinner)
- Weekend vs weekday variation
- 15% growth trend
- 10 departments, 80+ products
- Payment mix: 55% card, 30% cash, 10% EBT, 5% mixed
- ~2% voided, ~1% refund transactions
- Tax rates: 0% grocery, 5.5% alcohol/tobacco, 8% prepared food
- Bottle deposits on applicable beverages

---

---

## 📦 Vendor Auto-Ordering System — Algorithm Reference

**File:** `backend/src/services/orderEngine.js`

### Overview

Intelligent purchase order generation that analyzes 14 factors to determine optimal reorder quantities for every tracked product, grouped by vendor into ready-to-submit POs.

### The 14-Factor Algorithm

```
┌────────────────────────────────────────────────────────────┐
│  DEMAND FACTORS              SUPPLY FACTORS                │
│  1. Sales Velocity           7. Current Inventory          │
│  2. Trend Direction          8. Lead Time                  │
│  3. Holt-Winters Forecast    9. Safety Stock               │
│  4. Day-of-Week Pattern     10. Pack/Case Size             │
│  5. Holiday Calendar        11. Minimum Order              │
│  6. Weather Forecast        12. Shelf Life                 │
│                             13. Demand Variability (CV)    │
│                             14. Stockout History           │
└────────────────────────────────────────────────────────────┘
```

### Core Formula

```
dailyDemand    = HoltWinters(90d_history, period=7) × DOW_factor × holiday_factor × weather_factor
forecastDemand = Σ dailyDemand[today → today + leadTime + reviewPeriod]
safetyStock    = Z(serviceLevel) × σ(dailyDemand) × √(leadTime)
reorderPoint   = (avgDailyDemand × leadTime) + safetyStock
orderQty       = max(0, forecastDemand − onHand + safetyStock − onOrder) × stockoutPenalty
orderQty       = roundUpToCaseQty(orderQty, casePacks)
```

### Service Level Tiers

| Tier | Z-Score | Stockout Risk | Use Case |
|------|---------|---------------|----------|
| Critical | 2.33 | 1% | Tobacco, top sellers, essentials |
| Standard | 1.65 | 5% | Regular inventory |
| Low | 1.28 | 10% | Slow movers, seasonal items |

### Safety Stock Calculation

`safetyStock = Z × σ(dailyDemand) × √(leadTimeDays)`

Where:
- `Z` = service level Z-score (see table above)
- `σ` = standard deviation of daily unit sales (sample std dev, N-1)
- `√(LT)` = square root of vendor lead time in days

Higher demand variability (CV > 1.0) and longer lead times both increase safety stock.

### Weather Impact on Demand

Uses same regression as prediction engine (`computeWeatherImpact`):
- Fetches 10-day Open-Meteo forecast for store location
- Computes historical sales-weather correlation from 90 days
- Applies multipliers: rain (−12%), snow (−25%), cold (−5%), heat (−3%)
- Only adjusts forecast days that fall within the 10-day weather window

### Stockout Penalty

Detects likely past stockouts (days with zero sales when avg > 0.5 units/day):
- 0-2 stockout days → no penalty (1.0×)
- 3-5 stockout days → 1.08× (order 8% more)
- 6+ stockout days → 1.15× (order 15% more)

### Shelf Life Constraint

For perishable items (`MasterProduct.shelfLifeDays`):
- Caps order quantity at 110% of forecasted demand within shelf life window
- Prevents waste from over-ordering perishables
- Rounds down to nearest case qty (not up) to stay within limit

### Urgency Classification

| Urgency | Condition | Color |
|---------|-----------|-------|
| Critical | Out of stock OR days supply < lead time | Red |
| High | On hand ≤ reorder point | Amber |
| Medium | Days supply < lead time + review period | Yellow |
| Low | Trending up OR routine forecast | Green |

### Purchase Order Lifecycle

```
Generate Suggestions → Create Draft PO → Edit/Review → Submit to Vendor
                                                            ↓
                                              Receive (full or partial)
                                                            ↓
                                              Inventory Updated (+qtyReceived)
                                              quantityOnOrder Decremented
```

### Data Models

**PurchaseOrder** (`purchase_orders` table):
- `poNumber` — "PO-YYYYMMDD-001" auto-generated
- `status` — draft → submitted → partial/received → cancelled
- `generatedBy` — "manual" | "auto" | "suggestion"
- `expectedDate` — orderDate + vendor.leadTimeDays
- Links to: Vendor, Organization, PurchaseOrderItems

**PurchaseOrderItem** (`purchase_order_items` table):
- `qtyOrdered`, `qtyCases`, `qtyReceived`
- `unitCost`, `caseCost`, `lineTotal`
- Algorithm metadata: `forecastDemand`, `safetyStock`, `currentOnHand`, `avgDailySales`, `reorderReason`

**Vendor extensions:**
- `leadTimeDays` (default 3) — average delivery days
- `minOrderAmount` — minimum $ per order
- `orderFrequency` — "daily", "weekly", "biweekly", "monthly"
- `deliveryDays` — ["Monday", "Thursday"] etc.

**MasterProduct extensions:**
- `shelfLifeDays` — perishable expiry (null = non-perishable)
- `serviceLevel` — "critical", "standard", "low"

### API Endpoints

```
GET  /api/vendor-orders/suggestions           — Run 14-factor algorithm
POST /api/vendor-orders/generate              — Create draft POs from suggestions
GET  /api/vendor-orders/purchase-orders       — List POs (filter: status, vendor)
GET  /api/vendor-orders/purchase-orders/:id   — PO detail with items
PUT  /api/vendor-orders/purchase-orders/:id   — Edit draft PO
POST /api/vendor-orders/purchase-orders/:id/submit  — Mark as submitted
POST /api/vendor-orders/purchase-orders/:id/receive — Record received quantities
DELETE /api/vendor-orders/purchase-orders/:id        — Cancel draft PO
GET  /api/vendor-orders/purchase-orders/:id/pdf     — Download PO as PDF
```

### Frontend — Vendor Orders Page

Three-tab interface (`/portal/vendor-orders`):

1. **Suggestions** — Algorithm output with vendor-grouped product table, urgency color-coding, factor badges (weather, holiday, trend, stockout), "Create PO" per vendor or all
2. **Purchase Orders** — Active PO management with status badges, edit/submit/receive/PDF workflow
3. **History** — Completed/cancelled PO archive with date filtering

### Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/orderEngine.js` | 14-factor auto-order algorithm + PO number generator |
| `backend/src/controllers/orderController.js` | PO CRUD + suggestions + receive + PDF generation |
| `backend/src/routes/orderRoutes.js` | Route definitions |
| `frontend/src/pages/VendorOrderSheet.jsx` | 3-tab vendor orders UI |
| `backend/prisma/migrations/add_purchase_orders.sql` | Schema migration |

---

## 📈 Sales Analytics — Data Flow Reference

**File:** `backend/src/services/salesService.js`

### Architecture

The sales service queries POS transaction data directly from PostgreSQL via Prisma. All external POS API integration has been removed — sales analytics are computed from the local `Transaction` table.

### Aggregation Functions

| Function | Endpoint | Returns |
|----------|----------|---------|
| `getDailySales(user, storeId, from, to)` | `/api/sales/daily` | Daily buckets: Date, TotalNetSales, TransactionCount, TotalTax, etc. |
| `getWeeklySales(...)` | `/api/sales/weekly` | Aggregated into ISO week buckets |
| `getMonthlySales(...)` | `/api/sales/monthly` | Aggregated into YYYY-MM buckets |
| `getDepartmentSales(...)` | `/api/sales/departments` | Revenue by department from lineItems JSON |
| `getTopProducts(...)` | `/api/sales/products/top` | Top 20 products by net sales for a single date |
| `getProductsGrouped(...)` | `/api/sales/products/grouped` | Paginated best sellers with profit margin |
| `getProductMovement(...)` | `/api/sales/products/movement` | Time series (daily/weekly) for a specific UPC |

### Key Design Decisions

1. **Zero-fill dates** — Daily sales returns every date in range, filling gaps with zeros (important for charts)
2. **Department extraction** — Reads `departmentName` or `taxClass` from lineItems JSON (denormalized at transaction time)
3. **Profit estimation** — Uses 35% cost assumption when actual cost data unavailable (65% margin)
4. **Tenant isolation** — All queries filter by `orgId` from authenticated user
5. **Store scoping** — Optional `storeId` filter from `X-Store-Id` header

---

*Last updated: April 2026 — Session 16: Shared Layout Wrappers, Independent Scrolling, Consistent Page Structure*

---

## 📦 Recent Feature Additions (April 2026 — Session 15)

### Full CSS Refactoring & Responsiveness — All 4 Applications

Complete UI refactoring across admin-app, frontend, cashier-app, and storefront to remove inline styles, enforce external CSS with unique class-name prefixes, and add comprehensive responsive media queries.

#### Scope
- **~160 JSX/JS files** refactored across all 4 applications
- **~105 new CSS files** created with unique class-name prefixes
- **All `<style>` tags** extracted to external CSS (TenderModal, CustomerDisplayScreen, StationSetupScreen, RichTextEditor, Support, CmsPage)
- **Responsive breakpoints** added at 1024px, 768px, and 480px across all new CSS files
- **All 3 Vite apps** (admin-app, frontend, cashier-app) build successfully with zero errors

#### Admin App (14 new CSS files, 18 total)
| CSS File | Prefix | Source Component |
|----------|--------|------------------|
| `AdminBilling.css` | `ab-` | Billing management (plans, subscriptions, invoices, equipment) |
| `AdminPaymentSettings.css` | `aps-` | Payment gateway configuration |
| `AdminPaymentTerminals.css` | `apt-` | Terminal management |
| `AdminDashboard.css` | `adsh-` | Dashboard stats |
| `AdminAnalytics.css` | `aan-` | Analytics charts |
| `AdminCareers.css` | `acr-` | Career postings |
| `AdminCareerApplications.css` | `aca-` | Applications management |
| `AdminCmsPages.css` | `acms-` | CMS editor |
| `AdminOrgAnalytics.css` | `aoa-` | Org analytics |
| `AdminSystemConfig.css` | `asc-` | System config |
| `AdminUserActivity.css` | `aua-` | User activity |
| `AdminSidebar.css` | `asb-` | Sidebar nav |
| `RichTextEditor.css` | `rte-` | Quill editor wrapper |
| `StoreveuLogo.css` | `svl-` | Brand SVG |

#### Frontend Portal (70+ new CSS files, 90 total)
New CSS files created for all pages that had inline styles:

**Heavy pages (100+ inline styles each, fully converted):**
`BulkImport.css` (`bi-`), `InvoiceImport.css` (`ii-`), `POSSettings.css` (`pss-`), `Promotions.css` (`prm-`), `Organisation.css` (`org-`), `UserManagement.css` (`um-`), `VendorDetail.css` (`vd-`), `SalesPredictions.css` (`sp-`), `StoreManagement.css` (`sm-`), `Departments.css` (`dept-`)

**Medium pages:**
`InventoryCount.css` (`ic-`), `Vendors.css` (`ven-`), `ReceiptSettings.css` (`rs-`), `TaxRules.css` (`tr-`), `StoreBranding.css` (`sbr-`), `SalesAnalytics.css` (`sa-`), `PayoutsReport.css` (`pr-`), `ProductCatalog.css` (`pc-`), `VendorOrderSheet.css` (`vos-`), `BillingPortal.css` (`bp-`)

**Smaller pages + components:**
`ProductAnalytics.css` (`pan-`), `DepartmentAnalytics.css` (`dan-`), `FeesMappings.css` (`fm-`), `PaymentSettings.css` (`pms-`), `PriceUpdate.css` (`pu-`), `ForgotPassword.css` (`fp-`), `Signup.css` (`su-`), `Login.css` (`lg-`), `Dashboard.css` (`dsh-`), `EcommIntegration.css` (`ei-`), `EcomAnalytics.css` (`ean-`), `EcomCustomers.css` (`ecust-`), `PhoneLookup.css` (`pl-`), `Onboarding.css` (`ob-`), `TransformPage.css` (`tp-`), `UploadPage.css` (`up-`), `PreviewPage.css` (`pp-`), `HistoryPage.css` (`hp-`), `OCRPage.css` (`ocr-`), `DepositMapPage.css` (`dmp-`), `POSReports.css` (`posr-`)

**Components:**
`Navbar.css` (`nav-`), `SetupGuide.css` (`sg-`), `StoreSwitcher.css` (`sw-`), `WeatherWidget.css` (`ww-`), `DatePicker.css` (`dp-`), `DocumentHistory.css` (`dh-`), `DocumentUploader.css` (`du-`), `EcomOrderNotifier.css` (`eon-`), `BillingBanner.css` (`bb-`)

**Marketing pages:**
`Careers.css` (`mcr-`), `CartPage.css` (`mcp-`), `ProductPage.css` (`mpp-`), `ShopCheckout.css` (`msc-`), `ShopPage.css` (`msp-`), `Support.css` (`msup-`), `CmsPage.css` (`cms-`)

#### Cashier App (35 new CSS files, 42 total)
**Screens:**
`POSScreen.css` (`pos-`), `PinLoginScreen.css` (`pls-`), `LoginScreen.css` (`ls-`), `StationSetupScreen.css` (`sss-`), `CustomerDisplayScreen.css` (`cds-`), `StoreSelect.css` (`ssel-`)

**Tender:**
`TenderModal.css` (`tm-`), `ReceiptModal.css` (`rm-`)

**POS components:**
`ActionBar.css` (`ab-`), `CategoryPanel.css` (`cp-`), `NumPadInline.css` (`npi-`), `NumpadModal.css` (`npm-`)

**Cart:**
`CartItem.css` (`ci-`), `CartTotals.css` (`ct-`), `BagFeeRow.css` (`bfr-`)

**Layout:**
`StatusBar.css` (`sb-`), `App.css` (`app-`)

**Modals (18 new):**
`LotteryModal.css` (`lm-`), `LotteryPayoutModal.css` (`lpm-`), `LotterySaleModal.css` (`lsam-`), `AddProductModal.css` (`apm-`), `AgeVerificationModal.css` (`avm-`), `CloseShiftModal.css` (`csm-`), `CustomerLookupModal.css` (`clm-`), `DiscountModal.css` (`dm-`), `EndOfDayModal.css` (`eod-`), `HardwareSettingsModal.css` (`hsm-`), `HoldRecallModal.css` (`hrm-`), `ManagerPinModal.css` (`mpm-`), `OpenShiftModal.css` (`osm-`), `PriceCheckModal.css` (`pcm-`), `RefundModal.css` (`rfm-`), `ReprintReceiptModal.css` (`rrm-`), `TransactionHistoryModal.css` (`thm-`), `VoidModal.css` (`vm-`)

#### Storefront (3 CSS files enhanced, 23 JS files updated)
- `globals.css` — ~40 new utility classes added with responsive enhancements
- `templates.css` — ~50 new classes for template components
- Dynamic template values (gradients, brand colors) use CSS custom properties: `style={{ '--tpl-hero-bg': section.bg }}` with CSS consuming `var(--tpl-hero-bg)`

#### Responsive Design Patterns Applied
```css
@media (max-width: 1024px) {
  /* Grid layouts: reduce columns (4→2) */
  /* Stat card grids compact */
  /* Side edit panels reduce width */
}
@media (max-width: 768px) {
  /* Split layouts: stack vertically */
  /* Side panels: full width below content */
  /* Tables: horizontal scroll wrapper */
  /* Filter bars: wrap to multiple lines */
  /* Modals: near full-width */
}
@media (max-width: 480px) {
  /* Single column everything */
  /* Increased touch targets (min 44px) */
  /* Reduced padding/margins */
  /* Font size scaling */
}
```

#### Remaining Inline Styles (acceptable)
A small number of `style={{}}` remain where values are computed at runtime:
- **Recharts chart props** — library API requires inline objects for `contentStyle`, `fill`, `stroke`
- **Dynamic data colors** — status badges, chart legend dots, department colors from database
- **CSS custom property injection** — `style={{ '--var': dynamicValue }}` pattern for storefront templates
- **POS layout config** — dynamic widths/order from `layoutCfg` presets in POSScreen

#### Responsive Navigation
- **Frontend Sidebar**: Already had hamburger menu at 768px (implemented in prior session)
- **Admin Sidebar**: Already had hamburger menu at 768px (implemented in prior session)
- **Cashier App**: N/A — runs on dedicated POS terminals
- **Storefront**: Responsive header with mobile menu already in place

---

## 📦 Recent Feature Additions (April 2026 — Session 16)

### Shared Layout Wrappers & Independent Scrolling — Admin + Portal

#### Problem
1. **Admin panel** — entire page scrolled as one unit (sidebar + content together)
2. **Portal sidebar disappeared** on navigation — each page individually mounted `<Sidebar />`, causing unmount/remount on route change
3. **Inconsistent layout** — pages used different wrapper structures (some with `layout-container`, some without, some missing sidebar entirely)

#### Architecture Change — Shared Layout Components

**Admin App** (`admin-app/src/components/AdminLayout.jsx` — NEW):
- Wraps `<AdminSidebar />` + `<main className="main-content admin-page">` in one component
- All 15 admin routes in `App.jsx` now use `<AdminLayout>` wrapper
- Individual pages no longer import or mount `AdminSidebar`
- Sidebar persists across all navigation — never unmounts

**Frontend Portal** (`frontend/src/components/Layout.jsx` — UPDATED):
- Added `Outlet` from React Router for nested route support
- `{children || <Outlet />}` pattern — works both as wrapper (legacy CSV routes) and nested route element
- All `/portal/*` routes wrapped in single parent `<Route element={<Layout />}>` in `App.jsx`
- Individual pages no longer import or mount `Sidebar`
- Sidebar persists across all navigation — mounted once at the route level
- Fixed 5 pages that were completely MISSING sidebar: POSAPI, PaymentSettings, PayoutsReport, TaxRules, BillingPortal

#### CSS Changes — Independent Scrolling

**Admin App** (`admin-app/src/styles/global.css`):
- `.layout-container`: `height: 100vh; overflow: hidden` (was `min-height: 100vh`)
- `.sidebar`: `position: fixed; height: 100vh` (was `position: sticky; min-height: 100vh`)
- `.main-content`: `margin-left: 220px; height: 100vh; overflow-y: auto` — scrolls independently

**Frontend Portal** (`frontend/src/index.css`):
- `.layout-container`: `height: 100vh; overflow: hidden` (was `min-height: 100vh`)
- `.sidebar`: `position: relative; min-width: 250px` — stays in flex flow
- `.main-content`: `height: 100vh; overflow-y: auto; padding: 1.5rem 2rem` — scrolls independently
- Removed `margin-left: 250px` (no longer needed with relative sidebar in flex container)

**Portal CSS** (`frontend/src/styles/portal.css`):
- `.p-page`: Simplified to `max-width: 1400px; background: var(--bg-primary)` — no more conflicting padding/min-height

#### Pages Updated (Sidebar removal)

**Admin App** — 15 pages: AdminDashboard, AdminUsers, AdminOrganizations, AdminStores, AdminCmsPages, AdminCareers, AdminCareerApplications, AdminTickets, AdminSystemConfig, AdminAnalytics, AdminOrgAnalytics, AdminStorePerformance, AdminUserActivity, AdminPaymentSettings, AdminBilling

**Frontend Portal** — ~30 pages: All pages that previously imported `<Sidebar />` had the import and layout-container wrapper removed. Pages now just return their content (wrapped in `p-page` class for consistency).

#### Files Changed
| File | Change |
|------|--------|
| `admin-app/src/components/AdminLayout.jsx` | NEW — shared layout component |
| `admin-app/src/App.jsx` | All routes wrapped with `<AdminLayout>` |
| `admin-app/src/styles/global.css` | Independent scrolling CSS |
| `admin-app/src/pages/*.jsx` (15 files) | Removed AdminSidebar import + wrapper |
| `frontend/src/components/Layout.jsx` | Added `Outlet` for nested routes |
| `frontend/src/App.jsx` | Portal routes nested under `<Layout />` parent |
| `frontend/src/index.css` | Independent scrolling CSS |
| `frontend/src/styles/portal.css` | Simplified p-page class |
| `frontend/src/pages/*.jsx` (~30 files) | Removed Sidebar import + wrapper |

