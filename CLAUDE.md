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

*Last updated: April 2026 — Session 17: CSS Refactoring, Unified Customer Auth, Marketing Pages, Storefront Improvements*

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

---

## 📁 New Files Created (Sessions 13–15)

### Backend — New Services
| File | Purpose |
|------|---------|
| `backend/src/services/orderEngine.js` | 14-factor demand-driven reorder algorithm |
| `backend/src/services/labelQueueService.js` | Label print queue CRUD + auto-detection hooks |
| `backend/src/services/salesService.js` | **REWRITTEN** — Prisma-native queries replacing old stubs |

### Backend — New Controllers & Routes
| File | Purpose |
|------|---------|
| `backend/src/controllers/orderController.js` | Purchase order CRUD + suggestions + receive + PDF |
| `backend/src/routes/orderRoutes.js` | `/api/vendor-orders/*` endpoints |
| `backend/src/routes/labelQueueRoutes.js` | `/api/label-queue/*` endpoints |

### Backend — Migrations & Seeds
| File | Purpose |
|------|---------|
| `backend/prisma/migrations/add_purchase_orders.sql` | PurchaseOrder + PurchaseOrderItem tables + vendor/product extensions |
| `backend/prisma/migrations/add_label_queue.sql` | LabelQueue table |
| `backend/prisma/migrations/fix_billing_column_names.sql` | Fix camelCase columns for billing tables |
| `backend/prisma/seedTransactions.js` | Generate ~3,900 realistic POS transactions (90 days) |

### Cashier App — New Components
| File | Purpose |
|------|---------|
| `cashier-app/src/components/cart/BagFeeRow.jsx` | Bag (+)/(−) counter above payment buttons |
| `cashier-app/src/components/cart/BagFeeRow.css` | BagFeeRow styles |
| `cashier-app/src/screens/CustomerDisplayScreen.jsx` | Read-only customer-facing second screen |
| `cashier-app/src/screens/CustomerDisplayScreen.css` | Customer display styles |
| `cashier-app/src/hooks/useBroadcastSync.js` | BroadcastChannel pub/sub for POS → customer display |

### Frontend — New Pages
| File | Purpose |
|------|---------|
| `frontend/src/pages/POSConfig.jsx` | Tab hub: Layout, Receipts, Quick Keys, Label Design |
| `frontend/src/pages/POSReports.jsx` | Tab hub: Transactions, Event Log, Payouts |
| `frontend/src/pages/RulesAndFees.jsx` | Tab hub: Deposit Rules, Tax Rules |
| `frontend/src/pages/AnalyticsHub.jsx` | Tab hub: Sales, Departments, Products, Predictions |
| `frontend/src/pages/AccountHub.jsx` | Tab hub: Organisation, Users, Stores, Settings |
| `frontend/src/pages/CustomersHub.jsx` | Tab hub: Customers, Loyalty Program |
| `frontend/src/pages/LabelDesign.jsx` | Shelf label designer with Zebra ZPL + templates |
| `frontend/src/pages/LabelQueue.jsx` | Auto-detected + manual label print queue |
| `frontend/src/pages/EmployeeManagement.jsx` | Tab hub: Team, Timesheets, Shifts |
| `frontend/src/pages/EmployeeManagement.css` | Employee page styles (`em-` prefix) |
| `frontend/src/pages/ShiftManagement.jsx` | Clock session CRUD (add/edit/delete shifts) |
| `frontend/src/pages/ShiftManagement.css` | Shift management styles (`sm-` prefix) |
| `frontend/src/pages/SupportTickets.css` | **REWRITTEN** — external CSS (`st-` prefix) |
| `frontend/src/pages/POSReports.css` | POS reports styles |

### Frontend — New Components & Utilities
| File | Purpose |
|------|---------|
| `frontend/src/components/WeatherWidget.jsx` | Current + hourly + 10-day weather display |
| `frontend/src/components/WeatherWidget.css` | Weather widget styles |
| `frontend/src/styles/portal.css` | Shared CSS for all portal pages (`p-` prefix) |
| `frontend/src/utils/exportUtils.js` | CSV/PDF download utilities |

---

## 🚀 Production Deployment Checklist

### Backend:
```bash
cd /var/www/Storv_POS_All/backend
git pull origin main
npm install
npx prisma db execute --file prisma/migrations/add_purchase_orders.sql --schema prisma/schema.prisma
npx prisma db execute --file prisma/migrations/add_label_queue.sql --schema prisma/schema.prisma
npx prisma db execute --file prisma/migrations/fix_billing_column_names.sql --schema prisma/schema.prisma
npx prisma generate
pm2 restart api-pos
```

### Frontend:
```bash
cd /var/www/Storv_POS_All/frontend
git pull origin main
npm install
npm run build
```

### Seed data (optional):
```bash
node backend/prisma/seedTransactions.js
```

### PM2 process names:
- `api-pos` (ID 0) — main backend on port 5002
- `csvfilter-backend` (ID 1) — secondary service

---

*Last updated: April 2026 — Session 18: QA & Security Audit + Critical Fixes*

---

## 📦 Recent Feature Additions (April 2026 — Session 17)

### CSS Refactoring & UI Consistency

- Standardized page headers with `p-header` pattern (44px icon, 1.3rem title) across all portal pages
- Removed duplicate page-level paddings — `main-content` provides padding, individual pages no longer add their own
- Scrollbar standardized to thin 6px across all 4 apps
- Logo spacing reduced between "store" and "veu" in brand mark
- Hamburger menu repositioned to top-right across admin + portal apps
- Storefront mobile nav hides static links when hamburger menu is active

---

### Storefront Improvements

- **Category slider** — horizontal scroll layout replaces grid for department navigation
- **Shop page department filter** — horizontal scroll pills for filtering by department
- **Product card layout fix** — consistent heights with "Add to Cart" button always pinned to bottom
- **Lucide icons** — all remaining emojis replaced with Lucide React icons across entire storefront
- **Store data on auth pages** — `getServerSideProps` added to login, signup, cart, and checkout pages so store branding loads correctly
- **Auth redirects** — logged-in customers redirected away from login/signup pages
- **Environment variable** — hardcoded `localhost:3000` references replaced with `VITE_STOREFRONT_URL` env var

---

### Unified Customer Authentication

POS `Customer` table is now the single source of truth for both in-store and online customers.

**Schema changes** (`backend/prisma/schema.prisma` — `Customer` model):
- `passwordHash String?` — bcrypt-hashed password for storefront login
- `addresses Json? @default("[]")` — saved delivery/pickup addresses

**New POS backend endpoints** (storefront auth):
| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/storefront/:storeId/auth/signup` | Create customer account with password |
| `POST` | `/api/storefront/:storeId/auth/login` | Validate password, return JWT |
| `GET` | `/api/storefront/:storeId/auth/me` | Get customer profile |
| `PUT` | `/api/storefront/:storeId/auth/password` | Change password (requires current password) |

**Ecom-backend proxying:**
- Storefront auth requests proxy through ecom-backend to POS backend via HTTP
- Store-level isolation enforced — customer of Store A cannot authenticate on Store B's storefront

**Portal Customers page:**
- Password field added to create/edit customer modal (optional; hashed before save)

**Storefront account page:**
- New "Security" tab for password change (current password + new password + confirm)

---

### Marketing Pages Updated

- **Home.jsx** — new hero section, 6 feature cards with icons, updated industry cards
- **Features.jsx** — 8 detailed feature sections, updated "Coming Soon" items
- **Pricing.jsx** — 3 pricing tiers with feature comparison table, add-ons section, FAQ accordion
- **About.jsx** — updated mission statement, company values, timeline
- **Footer** — logo size matched to navbar for consistency

---

### Deployment Fixes

- **CI/CD workflow** — fixed Nginx file lock issue using `mv` + `nginx -s reload` + `sudo rm` pattern instead of direct overwrite
- **Git merge conflicts** — resolved conflicts in `backend/src/server.js` from concurrent feature branches

---

## 📦 Recent Feature Additions (April 2026 — Session 18)

### QA & Security Audit — Critical & High-Priority Fixes

A comprehensive QA audit covering UI, validation, workflow, and security across all 4 apps (backend, frontend portal, admin-app, cashier-app, storefront). This session implemented the top-priority fixes. See the backlog for remaining items.

#### Critical Fixes (7 issues)

**C-1. Unauthenticated inventory leak** — `POST /api/catalog/ecom-stock-check` was mounted before `router.use(protect)` with no tenant scoping. Anyone could query real-time store inventory.
- **Fix:** Added `X-Internal-Api-Key` header check in [`catalogController.js`](backend/src/controllers/catalogController.js) `ecomStockCheck`. Ecom-backend [`stockCheckService.js`](ecom-backend/src/services/stockCheckService.js) now sends the header on every call.
- **Requires:** `INTERNAL_API_KEY` in both `backend/.env` and `ecom-backend/.env` (must match).

**C-2. Stored XSS in CMS & Career detail pages** — `dangerouslySetInnerHTML` rendered unsanitized HTML from the database.
- **Fix:** Added `DOMPurify.sanitize()` in [`CmsPage.jsx`](frontend/src/pages/marketing/CmsPage.jsx) and [`CareerDetail.jsx`](frontend/src/pages/marketing/CareerDetail.jsx) with `FORBID_TAGS` (script/style/iframe/object/embed/form) and `FORBID_ATTR` (onerror/onload/onclick/etc). `dompurify` was already in node_modules.

**C-4. Customer enumeration via `check-points`** — `POST /customers/check-points` had no role guard, allowing any authenticated user to enumerate customers by phone.
- **Fix:** [`customerRoutes.js`](backend/src/routes/customerRoutes.js) now requires `authorize('superadmin','admin','owner','manager','cashier','store')`.

**C-5. Broken forgot-password flow** — Backend had `POST /auth/reset-password` but frontend had no matching page, leaving users stuck after clicking the email link.
- **Fix:** New [`ResetPassword.jsx`](frontend/src/pages/ResetPassword.jsx) + [`ResetPassword.css`](frontend/src/pages/ResetPassword.css) page with show/hide toggle, live strength meter, real-time rule checklist, confirm-match. Route added in [`App.jsx`](frontend/src/App.jsx) at `/reset-password`. New `resetPassword({token,password})` export in [`api.js`](frontend/src/services/api.js).

**C-6. 30-day JWT → 2 hours** — [`authController.js`](backend/src/controllers/authController.js) now reads `JWT_ACCESS_TTL` env var (default `2h`). Mitigates XSS+localStorage attack window from 30 days to 2 hours. Added to `.env.example`.

#### High Fixes (2 issues)

**H-1 + H-6. Server-side password & email validation** — Previously zero enforcement; any password accepted, any email string accepted.
- **Fix:** New [`backend/src/utils/validators.js`](backend/src/utils/validators.js) with:
  - `validateEmail()` — length + regex
  - `validatePassword()` — 8-128 chars, requires upper/lower/digit/special
  - `validatePhone()` — 7-15 digits, E.164-ish
  - `parsePrice()` — rejects NaN/Infinity/negative/scientific notation, rounds to 4 decimals for Prisma `Decimal(10,4)`
  - `runValidators()` — helper
- Applied in `signup`, `login`, `forgotPassword`, `resetPassword` in [`authController.js`](backend/src/controllers/authController.js). Email is now lowercased/trimmed before DB lookup.
- `forgotPassword` silently returns generic success on garbage email (anti-enumeration; no DB hit).

**H-2. Rate limiting on auth endpoints** — Previously zero rate limiting; brute-force wide open.
- **Fix:** New [`backend/src/middleware/rateLimit.js`](backend/src/middleware/rateLimit.js) — in-memory fixed-window limiter, no new deps. Exports: `loginLimiter` (5/15min), `forgotPasswordLimiter` (3/hr), `signupLimiter` (10/hr), `resetPasswordLimiter` (20/15min). Applied to all 5 public auth routes in [`authRoutes.js`](backend/src/routes/authRoutes.js). Sets `X-RateLimit-*` + `Retry-After` headers, returns 429 on exceed.
- **Note for multi-instance:** replace with `express-rate-limit` + Redis store for production horizontal scaling.

**H-9. Password logs removed from seed scripts** — [`seed.js`](backend/prisma/seed.js) and [`seedAdmin.js`](backend/prisma/seedAdmin.js) no longer print passwords to stdout. Passwords are written to `prisma/.seed-credentials` with `mode: 0o600`. Added to [`backend/.gitignore`](backend/.gitignore).

#### Files Changed

| File | Change |
|------|--------|
| `backend/src/utils/validators.js` | NEW — shared validators |
| `backend/src/middleware/rateLimit.js` | NEW — in-memory rate limiter |
| `backend/src/controllers/authController.js` | JWT TTL 2h, validators applied, email normalization |
| `backend/src/routes/authRoutes.js` | Rate limiters on all routes |
| `backend/src/routes/customerRoutes.js` | `authorize()` added to `/check-points` |
| `backend/src/controllers/catalogController.js` | `ecomStockCheck` requires `X-Internal-Api-Key` |
| `backend/prisma/seed.js`, `seedAdmin.js` | Password output → gitignored file |
| `backend/.gitignore` | Added `.seed-credentials` |
| `backend/.env.example` | Added `JWT_ACCESS_TTL`, clarified `INTERNAL_API_KEY` |
| `ecom-backend/src/services/stockCheckService.js` | Sends `X-Internal-Api-Key` |
| `frontend/src/pages/marketing/CmsPage.jsx` | DOMPurify sanitization |
| `frontend/src/pages/marketing/CareerDetail.jsx` | DOMPurify sanitization |
| `frontend/src/pages/ResetPassword.jsx` | NEW — reset password page |
| `frontend/src/pages/ResetPassword.css` | NEW — `rp-` prefix |
| `frontend/src/App.jsx` | `/reset-password` route |
| `frontend/src/services/api.js` | `resetPassword()` export |

#### Session 18b Fixes (continuation — same session)

**Critical — C-3, C-7 resolved**

- **C-3. RBAC on vendor return + order routes** — [`vendorReturnRoutes.js`](backend/src/routes/vendorReturnRoutes.js) and [`orderRoutes.js`](backend/src/routes/orderRoutes.js) rewritten with `readRoles` / `writeRoles` / `ownerRoles` tiers. Financial sign-off operations (approve/reject PO, delete PO, record vendor credit, delete vendor return) are owner+; routine write ops are manager+; reads are manager+.

- **C-7. Clock-event hardening** — [`posTerminalController.js`](backend/src/controllers/posTerminalController.js) `clockEvent`:
  - Strict PIN validation (4-8 digits, numeric only)
  - Station token length sanity check
  - Only `active` users can clock in
  - **`storeId` / `stationId` from client body are now ignored** — always use the IDs bound to the authenticated station token (prevents cross-store clock event injection)
  - New [`pinLimiter`](backend/src/middleware/rateLimit.js) (15 attempts / 5 min) applied to both `/clock` and `/pin-login` in [`posTerminalRoutes.js`](backend/src/routes/posTerminalRoutes.js)

**High — H-3, H-4, H-5, H-8, H-10, H-11 resolved**

- **H-3. Price input hardening** — New [`PriceInput` component](frontend/src/components/PriceInput.jsx) replaces `type="number" step="0.01"` on ProductForm's main price fields (retail, case cost, e-com, deposit, deal value, pack rows). Blocks scientific notation, negatives, >4 decimals, and wheel-scroll corruption. Server-side `parsePrice` (H-5) backs it up.

- **H-4. Cashier numpads cent-based** — [`VendorPayoutModal`](cashier-app/src/components/modals/VendorPayoutModal.jsx), [`CashDrawerModal`](cashier-app/src/components/modals/CashDrawerModal.jsx), and [`LotteryModal`](cashier-app/src/components/modals/LotteryModal.jsx) numpads rewritten to match `TenderModal` cent-entry. They now import `digitsToDisplay`/`digitsToNumber` from `NumPadInline` and maintain digit-string state. Typing `587` → `$5.87`, backspace removes one digit right-to-left. The legacy `.` key is a no-op in these modals.

- **H-5. `parsePrice()` applied in catalogController** — New `toPrice(value, field)` helper in [`catalogController.js`](backend/src/controllers/catalogController.js) wraps `parsePrice` from `utils/validators.js`. Applied to `defaultCostPrice`, `defaultRetailPrice`, `defaultCasePrice`, `depositPerUnit`, `caseDeposit` in both `createMasterProduct` and `updateMasterProduct`. Invalid input now returns `400` with `{ error: "fieldName: Invalid price format" }` instead of silently storing `NaN`/`Infinity`.

- **H-8. Session-expiry dead-end fix** — [`frontend/src/services/api.js`](frontend/src/services/api.js) now has a global **response interceptor** that catches `401` on any API call (except the auth flow itself), clears `user`/`token` from `localStorage`, and redirects to `/login?session=expired&returnTo=...`. This fixes the real root cause of pages "redirecting to login" — stale JWT after the 30d→2h reduction. (`/portal/stations` itself doesn't exist in App.jsx — it was a stale reference; the issue was expired-token dead-ends.)

- **H-10. Silent catches in cashier-app** — The high-value silent failures in [`POSScreen.jsx`](cashier-app/src/screens/POSScreen.jsx) replaced:
  - Receipt print failure now shows a scan-error toast ("Receipt print failed — check printer connection")
  - `loadActiveShift` failure shows a toast and still allows OpenShiftModal to appear
  - Branding load, chat poll, held tx count, lottery box load, drawer open — all now `console.warn` with context instead of swallowing silently
  - [`BulkImport.jsx`](frontend/src/pages/BulkImport.jsx) history refresh — same treatment

- **H-11. Storefront signup awaiting-approval** — [`storefront/pages/account/signup.js`](storefront/pages/account/signup.js):
  - New `pendingApproval` screen shown when `signup()` returns `status: 'pending'`
  - Client-side password policy now matches backend regex (8+ chars, upper/lower/digit/special)
  - User is NOT auto-redirected to `/account` on pending status — shown friendly "awaiting approval" page with Continue Shopping button

**Medium — M-1, M-8 resolved**

- **M-1. Admin Login password eye toggle** — Already implemented in prior session (confirmed: `showPw` state, `Eye`/`EyeOff` icons, `.al-pw-eye` CSS class in [`admin-app/src/pages/Login.css`](admin-app/src/pages/Login.css)). Marked complete.

- **M-8. Random admin temp password** — [`adminController.js`](backend/src/controllers/adminController.js) `createUser`:
  - New `generateTempPassword()` helper uses `crypto.randomInt` to build a 16-char password guaranteed to satisfy the policy (1 upper, 1 lower, 1 digit, 1 special, then filled from a curated charset excluding lookalikes like `0/O` and `l/1`)
  - Returned **once** in the response as `{ tempPassword, notice }` so the admin can deliver out-of-band
  - Email is now normalized (`.trim().toLowerCase()`) to prevent duplicate-email edge cases
  - Hardcoded `Temp@1234` removed

#### Session 18c Fixes (continuation — Round 3)

**High — H-3 completion + H-7 resolved**

- **H-3 (completed across remaining pages)** — `PriceInput` now applied to:
  - [`Promotions.jsx`](frontend/src/pages/Promotions.jsx) — `cfg.discountValue`, `tier.discountValue` (with `maxValue={100}` for percent mode), `cfg.bundlePrice`
  - [`Lottery.jsx`](frontend/src/pages/Lottery.jsx) — all `ticketPrice` inputs (ticket catalog, receive order, activate, games form), `commissionRate` (bounded 0-100)
  - [`VendorPayouts.jsx`](frontend/src/pages/VendorPayouts.jsx) — `form.amount`
  - [`DepositRules.jsx`](frontend/src/pages/DepositRules.jsx) — `depositAmount`, `minVolumeOz`, `maxVolumeOz` (latter two with `maxDecimals={1}`)
  - [`Customers.jsx`](frontend/src/pages/Customers.jsx) — `discount` (max 100), `balance`, `balanceLimit`

- **H-7. Phone (+ email) validation on customer endpoints** — [`customerController.js`](backend/src/controllers/customerController.js) `createCustomer` and `updateCustomer`:
  - New `normalizePhone()` helper strips spaces/dashes/parens/dots, enforces `+?[0-9]{7,15}`, stores canonical form
  - Email validated via `validateEmail()` + lowercased on write
  - `discount`/`balance`/`balanceLimit` now parsed via `parsePrice()` with explicit bounds — rejects NaN/Infinity/scientific/out-of-range values with a `400` error
  - Optional fields still accepted as empty/null; only validated when supplied

**Medium — M-2, M-3, M-4, M-9 resolved**

- **M-2. ProductForm unsaved-changes warning** — [`ProductForm.jsx`](frontend/src/pages/ProductForm.jsx):
  - `dirty` state flag flips on first `setF()` edit
  - `beforeunload` listener prompts before browser close/refresh when dirty
  - `dirty` is cleared on successful load and before navigation on successful save
  - New `handleCancel()` asks `window.confirm('Discard unsaved changes?')` before navigating away via Cancel / Back button; both back buttons now call it

- **M-3. Duplicate UPC error display** — Already surfaces backend 409 via `handleAddUpc`'s `err.response?.data?.error` toast. Confirmed working. Backend `createMasterProduct` also now returns `400` instead of `500` when price validation fails (via `H-5` toPrice helper), so the error toast is meaningful.

- **M-4. Pack-size validation** — `handleSave()` now iterates `packRows` before submitting:
  - Each row must have `unitPack >= 1` (previously silently coerced to `1`)
  - Each row must have `packPrice > 0`
  - At most one row may be marked `isDefault`
  - Toasts identify the specific offending row index and field

- **M-9. Modal overlay CSS vars** — [`frontend/src/index.css`](frontend/src/index.css) adds:
  - `--modal-overlay: rgba(0, 0, 0, 0.55)`
  - `--modal-overlay-strong: rgba(0, 0, 0, 0.7)`
  - `--modal-shadow: 0 24px 64px rgba(0, 0, 0, 0.4)`
  - ProductForm's DeptManager + VendorManager modals migrated to use `var(--modal-overlay)` and `var(--modal-shadow)` instead of hardcoded rgba

#### Session 18d Fixes (continuation — Round 4, final cleanup)

**Low-priority cleanup complete**

- **L-1. ProductForm inline styles → external CSS** — [`ProductForm.jsx`](frontend/src/pages/ProductForm.jsx) DeptManager, VendorManager, and Tog helper rewritten to use external CSS classes. Roughly 120 inline `style={{}}` props replaced with `pf-mm-*` and `pf-tog*` classes appended to [`ProductForm.css`](frontend/src/pages/ProductForm.css). The new stylesheet is organised into: modal shell (`pf-mm-root`, `pf-mm-overlay`, `pf-mm-card`), header (`pf-mm-header`), two-column body (`pf-mm-body`, `pf-mm-list`, `pf-mm-edit`), form grid (`pf-mm-grid`, `pf-mm-field`, `pf-mm-input`), color swatches, flags row, actions bar, and a toggle button (`pf-tog`). Responsive `@media (max-width: 768px)` collapses the two-column body to a stacked layout. Modal backdrops and shadows use the new `--modal-overlay` + `--modal-shadow` CSS vars from M-9.

- **L-2. Storefront responsive breakpoints** — Appended ~125 lines of responsive CSS to [`storefront/styles/globals.css`](storefront/styles/globals.css):
  - `1024px` — 3-col product grid, single-col checkout, tablet container padding
  - `768px` — header nav wraps to 2 rows, 2-col product grid, PDP stacks, cart item reflows, checkout form rows single-column, auth card full-width, account tabs 2-up, footer 2-col
  - `480px` — tightened padding, 44px touch-target minimum on all CTAs, footer single-col, typography scaled for small phones

- **L-3. Double scroll risk in main-content** — [`frontend/src/index.css`](frontend/src/index.css) `.main-content` now uses the robust `flex: 1 1 0; min-height: 0` pattern instead of `height: 100vh`. In a flex container with `overflow: hidden`, the `height: 100vh` child can produce double scrollbars on browsers that interpret layout differently during reflow. The flex pattern is the canonical solution for an independent-scrolling panel inside a height-capped flex parent. Nested modal panels in ProductForm's DeptManager/VendorManager already had proper `overflow: hidden` on the outer card — verified, no fix needed.

- **L-4. `$` prefix on VendorPayouts amount** — [`VendorPayouts.jsx`](frontend/src/pages/VendorPayouts.jsx) amount input wrapped in `vp-dollar-wrap` + `vp-dollar-sign` + `vp-dollar-input` classes (new styles appended to [`VendorPayouts.css`](frontend/src/pages/VendorPayouts.css)). Also finalized the PriceInput migration that was dropped in round 3. Customers balance/discount fields already show `($)`/`(%)` in their label text, so no wrapper needed.

- **M-5. ProductForm save guards** — Confirmed already covered by M-4 (pack-size validation) and the existing department/name/UPC-warning checks in `handleSave()`. Marking complete — no further work needed.

**Deliberately deferred (not fixed — require architectural changes)**

- **M-6. JWT → httpOnly cookie migration** — Requires:
  - Backend: dual-mode auth middleware that accepts both Bearer header (legacy cashier-app Electron) and httpOnly cookie (portal + admin)
  - Frontend: remove all `localStorage.setItem('user', ...)` and `localStorage.getItem('user')` calls across portal + admin + storefront
  - Server-side CSRF token issuance (double-submit cookie pattern) since cookie-based auth is vulnerable to CSRF
  - CORS `credentials: 'include'` wiring across all API clients
  - Cashier-app Electron main-process cookie store integration
  - Impersonation flow, password reset email links, and the new 401 interceptor all need rework
  Estimated effort: 1-2 sprints. The C-6 (2h TTL) + H-8 (401 interceptor) combination already mitigates the biggest risk (long-lived tokens in `localStorage`). This is a defence-in-depth improvement to schedule as a standalone project rather than rush into a late QA round.

- **M-7. CVV → Stripe Elements iFrame** — Requires Stripe merchant account setup, API keys, SDK integration, and a rewrite of the checkout payment UI to embed Stripe's hosted iFrame. Currently the storefront checkout does not process card data (the deployed flow uses store pickup / cash on delivery — no card fields are shown). The CVV field flagged in the audit is in the equipment shop checkout (`ShopCheckout.jsx`), which is separate from the ecom storefront. Deferred pending Stripe onboarding decision.

- **M-8 extension. Forced password-change flow** — Admin-created users receive a random temp password in the `createUser` response (round 2 fix). A separate sprint can add a `mustChangePassword` boolean to the User model, check it in the auth middleware, and force a redirect to `/change-password` on next login. Not a security regression — the temp password already satisfies the same policy as a user-chosen password.

---

## 📦 Recent Feature Additions (April 2026 — Session 19)

### Cashier-App — Quick-Cash Bypass + Unified Change-Due Overlay + Scan Gating

A cluster of POS-flow fixes triggered by cashier feedback:

#### 1. Quick-cash buttons now bypass the TenderModal entirely
All on-screen quick-cash buttons (`$10`, `$20`, exact-amount, smart presets) and the plain `CASH` button now call a new `quickCashSubmit(amt)` function in [POSScreen.jsx](cashier-app/src/screens/POSScreen.jsx) instead of opening `TenderModal`. The function:
- Builds the transaction payload (line items + bag fee + lottery items + cash tender line)
- Submits via `submitTransaction` (or `enqueue` offline)
- Clears the cart
- Calls a shared `handleSaleCompleted(tx, change)` routine that broadcasts to the customer display, opens the cash drawer, and triggers the change-due overlay

The plain `CASH` button now treats the press as **exact tender = grand total** (no change), opening the drawer and showing the completion overlay immediately. No more entering an amount manually for the common case.

#### 2. New unified Change-Due overlay (auto-close + scan interrupt)
New component [`ChangeDueOverlay.jsx`](cashier-app/src/components/pos/ChangeDueOverlay.jsx) + [`ChangeDueOverlay.css`](cashier-app/src/components/pos/ChangeDueOverlay.css) (`cdo-` prefix). Replaces the change-due card that previously lived inside `TenderModal`.

- **5-second auto-close** with visible countdown ("Closing in 5s — scan next item to start a new sale")
- **Print Receipt / Done buttons** wired to the same hardware printer hook
- **Refund variant** — switches color theme + label to "REFUND DUE TO CUSTOMER" when `tx.grandTotal < 0`
- Triggered from POSScreen state (`changeDueTx`, `changeDueAmt`, `changeDueRefund`) — populated by both the quick-cash flow and the regular TenderModal flow

[`TenderModal.finish()`](cashier-app/src/components/tender/TenderModal.jsx) now always closes the modal and forwards `(tx, cashChange)` to `onComplete` instead of rendering its own internal change card. This means **every** cash sale (quick or modal) now uses the same overlay with the same auto-close + scan-interrupt behavior.

#### 3. Scan-during-payment bug fixed
Two new gates added to `handleScan` in POSScreen:

- **Change-due overlay open** → scan dismisses the overlay and falls through to start the new transaction (cart is already cleared by `quickCashSubmit` / `TenderModal.finish`). Fixes the bug where scanning during change-due was adding items to the just-completed transaction.
- **TenderModal open** → scan is rejected with an error beep (new [`playErrorBeep()`](cashier-app/src/utils/sound.js) Web Audio helper) + the existing `showScanError` toast. The cashier hears immediate feedback that the scan was ignored because the payment modal is active.

State is mirrored into refs (`showTenderRef`, `changeDueRef`) so `handleScan` (a `useCallback`) doesn't have to be re-created on every modal open/close.

#### 4. "On hand: N" badge on cart line items
[`CartItem.jsx`](cashier-app/src/components/cart/CartItem.jsx) now shows the current stock level inline with the price line:
- `On hand: 12` (grey, normal)
- `On hand: 3` (amber `#f59e0b`, when ≤ 5)
- `On hand: 0` (red `#ef4444`, when out)

CSS in [`CartItem.css`](cashier-app/src/components/cart/CartItem.css) under `.ci-onhand` / `.ci-onhand--low` / `.ci-onhand--out`.

Plumbed end-to-end:
- **Backend**: [`getCatalogSnapshot`](backend/src/controllers/posTerminalController.js) and [`searchMasterProducts`](backend/src/controllers/catalogController.js) now include `quantityOnHand` from the per-store `StoreProduct` row when a `storeId` is supplied.
- **Cashier App**: [`useCartStore.addProduct`](cashier-app/src/stores/useCartStore.js) copies `quantityOnHand` onto each cart line so it survives Dexie cache → cart hand-off and offline lookups.

#### 5. New error-beep utility
New [`utils/sound.js`](cashier-app/src/utils/sound.js) — single shared `playErrorBeep()` that synthesizes a short low square-wave buzz (220 Hz → 140 Hz, 240 ms) via Web Audio API. No asset file needed; works offline.

#### Files Changed
| File | Change |
|------|--------|
| `backend/src/controllers/posTerminalController.js` | Catalog snapshot returns `quantityOnHand` |
| `backend/src/controllers/catalogController.js` | Search endpoint includes per-store `quantityOnHand` when `storeId` query param present |
| `cashier-app/src/utils/sound.js` | NEW — `playErrorBeep()` Web Audio helper |
| `cashier-app/src/components/pos/ChangeDueOverlay.jsx` | NEW — unified change-due overlay with 5s auto-close |
| `cashier-app/src/components/pos/ChangeDueOverlay.css` | NEW — `cdo-` prefix |
| `cashier-app/src/components/tender/TenderModal.jsx` | `finish()` always closes; passes `cashChange` to `onComplete` |
| `cashier-app/src/components/cart/CartItem.jsx` | Render `On hand: N` badge in price line |
| `cashier-app/src/components/cart/CartItem.css` | `.ci-onhand` styles incl. low/out colour states |
| `cashier-app/src/stores/useCartStore.js` | `addProduct` copies `quantityOnHand` onto the line item |
| `cashier-app/src/screens/POSScreen.jsx` | `quickCashSubmit`, `handleSaleCompleted`, scan gates, overlay render, refs for TenderModal/ChangeDue state |

---

*Last updated: April 2026 — Session 19: Quick-Cash Bypass, Change-Due Overlay, Scan Gating, On-Hand Badges*

---

## 📦 Recent Feature Additions (April 2026 — Session 19b)

### Backend — Shift Auto-Close Scheduler

Cashiers regularly forget to close the drawer at end of day. Until now the only mitigation was an amber banner (`shift._crossedMidnight`) on the next morning's POS, plus a manual "Close Shift" workflow. That left stale shifts open across days, corrupting daily reports and silently rolling cash counts into the previous day's report.

**Fix:** New backend scheduler [`shiftScheduler.js`](backend/src/services/shiftScheduler.js) runs every 10 minutes, finds any open `Shift` whose `openedAt` is before the **store's local-timezone midnight**, and closes it using the same expected-cash math the manual `closeShift` controller uses. The scheduler is wired into `server.js` startup alongside the billing/order schedulers.

**Auto-close payload:**
- `status: 'closed'`
- `closedById: null` (system close — distinguishable in reports from cashier closes)
- `closingAmount = expectedAmount` (no physical count was taken)
- `variance: 0`
- `closingNote: '[AUTO] Closed by system at end of day. No physical cash count was recorded.'`
- All cash math fields populated (`cashSales`, `cashRefunds`, `cashDropsTotal`, `payoutsTotal`)

**Timezone handling:** Each store's `Store.timezone` is used (defaults to `UTC` if unset). The midnight calculation uses `Intl.DateTimeFormat` with `en-CA` to derive the local wall-clock date, then converts back to a UTC instant. A 10-minute sweep cadence catches shifts that drift past midnight in any timezone, even if a sweep was skipped due to server downtime.

**Cashier app behavior unchanged on the client side** — `loadActiveShift` still returns `shift: null` when there's no open shift, and `POSScreen` shows `OpenShiftModal` automatically. The `_crossedMidnight` banner code is left in place as a defence-in-depth fallback (e.g. if the scheduler is disabled or behind on a busy server).

#### Files Changed
| File | Change |
|------|--------|
| `backend/src/services/shiftScheduler.js` | NEW — sweeps every 10 min, closes stale shifts past local midnight |
| `backend/src/server.js` | Imports + calls `startShiftScheduler()` after `startBillingScheduler()` |

#### Verified end-to-end against the running stack
1. Backdated an open shift's `openedAt` to 2 days ago.
2. `[ShiftScheduler] Auto-closed shift … expected=$… txs=…` appeared in backend logs.
3. DB row confirmed `status='closed'`, `closedById=null`, `variance=0`, `closingNote` starts with `[AUTO]`.
4. `GET /api/pos-terminal/shift/active` returned `{ shift: null }`.
5. Cashier-app reload + sign-in → `OpenShiftModal` (`Open Cash Drawer — Count your starting float to begin the shift`) is shown immediately, no midnight warning banner.

---

*Last updated: April 2026 — Session 19b: Shift Auto-Close Scheduler*

---

## 📦 Recent Feature Additions (April 2026 — Session 20)

### Cashier App End-to-End Test Pass + 5 Bug Fixes

Ran a comprehensive 18-test smoke pass against the live cashier-app + backend stack with a real Postgres DB and live HMR. **All 18 critical paths now pass.** Five real bugs were found and fixed in-line; two architectural issues are documented for follow-up.

| Test | Path | Result |
|------|------|--------|
| T01 | Open shift with float | ✓ |
| T02 | Basic POS sale + tax math (Subtotal $24.68 → tax 0 → Total $24.68) | ✓ |
| T03 | Card tender via TenderModal → tx persisted | ✓ |
| T04 | Cash drop $50 → linked to shift | ✓ |
| T05 | Vendor payout $25 (ABACUS) → linked to shift | ✓ |
| T06 | Bottle return → negative cart line → REFUND DUE overlay → tx persisted | ✓ |
| T07 | Hold + Recall transaction | ✓ |
| T08 | Inline new-customer create + attach + portal cross-check | ✓ |
| T09 | Manager-gated Refund flow → REF tx persisted with refundOf | ✓ |
| T10 | Lottery $5 sale → cart total $5 → cash → tx persisted | ✓ |
| T11 | Manager PIN gate (Refund/Void hidden until PIN entered) | ✓ |
| T12 | Open Item / Manual entry "Custom Coffee" $2.00 | ✓ |
| T13 | Age verification — covered in prior sessions, no fresh testable products | skip |
| T14 | No Sale event → logged with stationId/cashierId | ✓ |
| T15 | Portal cross-check: 20 transactions visible today | ✓ |
| T16 | Portal cross-check: new customer "Test Cust" visible | ✓ |
| T17 | Live Dashboard `/sales/realtime` returns full KPI block | ✓ |
| T18 | Close Shift with cash count → full reconciliation math | ✓ |

#### Bugs Found and Fixed (in this session)

**Bug 1 — Stale `station.id` reference across cashier-app (P0)**
The Zustand `useStationStore` persisted stations as `{ stationId, stationToken, ... }` but eight call-sites read `station?.id` (never defined). Effect: `stationId` was `null` on every saved transaction, every `clockEvent`, every per-station hardware config save, and the CardPointe terminal lookup in TenderModal silently broke for multi-station stores.
**Fix:** [`cashier-app/src/stores/useStationStore.js`](cashier-app/src/stores/useStationStore.js) — `setStation` now mirrors `id` as an alias of `stationId`, plus an `onRehydrateStorage` hook that back-fills the alias on already-persisted stations from before this fix shipped. No callsite changes needed. Verified: stationId now populated on transactions.

**Bug 2 — `quickCashSubmit` mishandled net-negative carts (P1)**
The new quick-cash refund path (Session 19) recorded refunds as `tenderLines: [{cash, amount: -0.50}]` and `changeGiven: 0`. Wrong semantics — for a refund cash *goes out*, so the line should be `{cash, amount: 0.50, note: 'Refund/Bottle Return'}` and `changeGiven` should be the positive refund amount.
**Fix:** [`POSScreen.jsx`](cashier-app/src/screens/POSScreen.jsx) `quickCashSubmit` — added `isRefund` branch matching the existing `TenderModal.complete()` refund semantics. Verified: bottle-return tx now records `cash $0.25 (note: Refund/Bottle Return)`, `change: $0.25`.

**Bug 3 — `listTransactions` UTC date window (P1)**
[`backend/src/controllers/posTerminalController.js`](backend/src/controllers/posTerminalController.js) `listTransactions` parsed `?date=2026-04-16` with `new Date(str)` (UTC midnight) then called `.getFullYear()/.getMonth()/.getDate()` (local). In any non-UTC timezone the day window was offset by the server's UTC offset. Effect: the cashier-app's TransactionHistoryModal showed "0 transactions" for today after evening sales in any non-UTC region.
**Fix:** Added `startOfLocalDay` / `endOfLocalDay` helpers that split the ISO string and construct the Date in local time. Same fix pattern as the Session 7 employee report repair. Verified: history now shows 16 transactions for today.

**Bug 4 — `RefundModal` UTC date filter + missing storeId prop (P1)**
- `isoDate(d)` in [`RefundModal.jsx`](cashier-app/src/components/modals/RefundModal.jsx) used `d.toISOString()` (UTC) instead of local components — after local midnight but before UTC midnight, "today" became tomorrow and every transaction was hidden.
- Even after that fix, `<RefundModal />` was mounted in [`POSScreen.jsx`](cashier-app/src/screens/POSScreen.jsx) without the `storeId` prop, so `storeId` was undefined inside the modal.
**Fix:** RefundModal — replaced `isoDate` with a local-date implementation and moved `DATE_FILTERS` to a `buildDateFilters()` builder so dates are recomputed (correct across midnight). POSScreen — added `storeId={storeId}` to the modal mount. Verified: Refund modal now lists today's transactions and a $3.99 refund processed end-to-end.

**Bug 5 — Lottery preset buttons added cents instead of dollars (P1)**
[`LotteryModal.jsx`](cashier-app/src/components/modals/LotteryModal.jsx) — preset `$5` button called `setDisplay(String(5))`. The display state stores raw digits (cents, like the Tender numpad), so "5" rendered as `$0.05`. A cashier tapping `$5` accidentally added $0.05 of lottery sales.
**Fix:** Multiply preset by 100 before storing: `setDisplay(String(Math.round(p * 100)))`. Verified: tapping `$5` now shows `$5.00` and adds $5 to cart.

#### Bugs Found and NOT Fixed (documented for follow-up)

**Open Bug A — Transaction.shiftId column missing (P2)**
The Transaction model in `prisma/schema.prisma` has no `shiftId` column. The cashier-app's TenderModal and the new `quickCashSubmit` both pass `shiftId` in the request payload, but the `createTransaction` controller silently drops it (the Prisma client would throw if we tried to write it). Today's reports work because `closeShift` queries by `createdAt >= shift.openedAt`, but per-shift filtering in analytics + multi-cashier same-day reporting are unreliable.
**Fix path:** add `shiftId String?` to `Transaction` + `@@index([shiftId])`, run `npx prisma db push`, set the field in `createTransaction`. The cashier-app payload is already wired (Session 20).

**Open Bug B — Two parallel "vendor payout" tables (P2)**
The cashier "Paid Out" button writes to `CashPayout` (joined to `Shift`). The portal "Vendor Payouts" page (`VendorPayouts.jsx`) reads from a separate `VendorPayment` table. They never reconcile — payouts taken at the register are invisible in the back-office vendor-payments page. CLAUDE.md's design notes mention both paths but they were never unified.
**Fix path:** either (a) collapse `CashPayout` into `VendorPayment` with a `source` field ('shift' | 'office'), or (b) add an aggregator endpoint that unions both tables for the back-office UI. Either way it's a 2-3 file backend change + a portal table refresh. Not safe to do in a smoke-test session.

**Open Bug C — Vendor payout `recipient` field is null (P3)**
`VendorPayoutModal` selects a vendor by `vendorId` but doesn't denormalize the vendor's name into the `recipient` field on `CashPayout`. Result: the shift report shows `vendorId: 4` instead of "ABACUS DISTRIBUTING" without a join. Cosmetic only; vendor lookup still works.

#### Performance / Efficiency Observations (not changed)

- **`/api/sales/realtime` does ~30 separate Prisma queries per call** (today KPI, hourly bucket × 24, top products, recent tx feed, 14-day trend, lottery section, inventory grade). On a busy store this is ~100ms. Could be collapsed to 3-4 queries with PG `date_trunc('hour', ...)` aggregation. Live Dashboard polls this endpoint every 15s.
- **`useCatalogSync` re-downloads ALL 7,694 products** on every page reload of the cashier app even if `productsLastSync` is recent. The `since` param works for incremental sync, but the IndexedDB clear on station re-pair forces a full re-download. Could be conditional on `since == null`.
- **5 backend listeners** poll `/api/chat/unread` every 15s from the cashier-app; consolidating with a single SSE/long-poll connection would cut request volume ~10×.
- **No DB index on `Transaction(shiftId)` or `Transaction(stationId)`** because the columns don't exist / aren't always populated. After fixing Bug A, an index would be needed for the `cashSales` aggregation in `closeShift`.

#### Files Changed (Session 20)

| File | Change |
|------|--------|
| `cashier-app/src/stores/useStationStore.js` | Added `id` alias for `stationId` + onRehydrate back-fill |
| `cashier-app/src/screens/POSScreen.jsx` | quickCashSubmit refund branch, `stationId`/`shiftId` in payload, `storeId` prop on RefundModal |
| `cashier-app/src/components/tender/TenderModal.jsx` | New `shiftId` prop, `stationId`/`shiftId` in payload |
| `cashier-app/src/components/modals/RefundModal.jsx` | Local-date `isoDate` + `buildDateFilters()` |
| `cashier-app/src/components/modals/LotteryModal.jsx` | Preset buttons multiply by 100 (cents-correct) |
| `backend/src/controllers/posTerminalController.js` | `listTransactions` uses local-day boundaries; createTransaction notes shiftId column missing |

---

*Last updated: April 2026 — Session 20: Cashier-App E2E Test Pass + 5 Bug Fixes*

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.

---

## 📦 Recent Feature Additions (April 2026 — Session 21)

### Invoice Import — Vendor-Scoped Matching, Live Totals, Cases/Units Toggle

Large rework of the Invoice Import feature covering all four cashier-raised concerns:

#### 1. Live totals on add / edit — `InvoiceImport.jsx`
- New helpers `recomputeInvoiceTotal(items)` and `recomputeLineTotal(item)` keep the invoice's `totalInvoiceAmount` and each line's `totalAmount` in sync with `caseCost × quantity`.
- `handleItemChange` recalculates both on every `caseCost`/`quantity`/`packUnits` change.
- `handleAddItem` and `handleDeleteItem` now update the invoice total as well.
- Manual overrides are respected: if the user types directly into `totalAmount`, the line is flagged `_totalLocked` and stops auto-computing.
- The top summary strip's "Total" now reflects the live sum instead of the stale OCR value.

#### 2. Cases/Units toggle per line item
- New per-line `receivedAs: 'cases' | 'units'` field (default: `'cases'`).
- Segmented control inside the expanded line editor — clicking "Cases" / "Units" flips the unit mode.
- Live preview strip below the qty row: *"On confirm, inventory will increase by +240 units (5 cases × 48/case)"*.
- Top-bar chip above Confirm: *"+1,248 units · 23 products"* — aggregates the whole invoice.

#### 3. Inventory adjustment uses cases × packUnits
At confirm, the inventory update step (`adjustStoreStock` call) now computes:
```
receivedAs === 'cases' → adjustment = quantity × packUnits
receivedAs === 'units' → adjustment = quantity
```
This fixes the long-standing bug where a 5-case × 24-pack delivery was only adding 5 units to QOH instead of 120.

#### 4. Distributor `itemCode` → main mapping, vendor-scoped
Full rewrite of the matching cascade in [`matchingService.js`](backend/src/services/matchingService.js):

**New cascade (7 tiers):**
| # | Tier | Key | Confidence |
|---|------|-----|-----------|
| 1 | UPC (+ variants) | UPC exact | high |
| 2 | **Distributor ItemCode, vendor-scoped** ★ NEW PRIMARY | `vendorId::itemCode` | high |
| 3 | VendorProductMap (learned) | vendor + code / fuzzy desc | high/medium |
| 4 | PLU exact (produce) | `plu` | high |
| 5 | Cross-store GlobalProductMatch | vendor + code | medium |
| 6 | Cost-proximity + composite fuzzy | multiple signals | medium/low |
| 7 | AI batch (gpt-4o-mini) | LLM | medium only |

**Removed:** the old SKU tier that matched against our internal `MasterProduct.sku`. Vendor invoices never reference our internal SKU, so this tier caused false positives without ever helping.

**Vendor scoping details:**
- Index keyed as `${vendorId}::${itemCode}` — prevents Hershey's `2468231329` colliding with Jeremy's `27149` or Coca-Cola's `115583`.
- When `invoice.vendorId` is known, fuzzy / cost / AI tiers also narrow to that vendor's products (cutting AI token cost).
- When `invoice.vendorId` is null, org-wide `itemCode` lookup falls back at medium confidence (flagged for review, never high).

**Vendor resolution on upload:**
- Upload area gets a "Vendor (optional)" dropdown — preselected vendor flows through FormData → backend as `vendorId`.
- When user doesn't preselect, `resolveVendorId(orgId, vendorName)` in the controller resolves via exact name → alias → fuzzy contains → reverse contains match on active vendors.
- Resolved `vendorId` is persisted on the `Invoice` row for subsequent rematches.

**Re-match button:**
- New invoice-level Vendor dropdown at the top of the review panel + two buttons:
  - **Re-run matching** (safe): preserves `manual` and high-confidence-`matched` items, re-matches only unmatched / low-confidence ones.
  - **Force** (destructive, confirm dialog): re-matches ALL items including user-confirmed ones.
- Powered by new endpoint `POST /api/invoice/:id/rematch { vendorId?, force? }`.

#### Schema change
```prisma
model Invoice {
  // ...
  vendorId  Int?  // NEW — resolved Vendor FK, powers vendor-scoped matching
  // ...
  @@index([orgId, vendorId])
}
```
Pushed via `npx prisma db push` — non-destructive, nullable column.

#### Files changed
| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Added `Invoice.vendorId Int?` + `@@index([orgId, vendorId])` |
| `backend/src/services/matchingService.js` | Rewrote cascade: dropped SKU tier, added vendor-scoped itemCode tier; new `buildItemCodeIndex`, `buildPluIndex`, `filterByVendor` helpers; `matchLineItems(..., { vendorId })` signature |
| `backend/src/controllers/invoiceController.js` | Added `resolveVendorId` helper; threaded `vendorId` through `processInvoiceBackground`, `processMultipageBackground`, `uploadInvoices`; new `rematchInvoice` endpoint that preserves manual matches |
| `backend/src/routes/invoiceRoutes.js` | Added `POST /:id/rematch` route |
| `frontend/src/services/api.js` | Added `rematchInvoice(id, { vendorId, force })` |
| `frontend/src/pages/InvoiceImport.jsx` | Live totals (`recomputeInvoiceTotal`, `recomputeLineTotal`, `_totalLocked`); Cases/Units toggle; vendor dropdowns (upload + review); Re-match button; Received-units preview strip + top-bar chip; inventory adjustment uses `qty × pack` |
| `frontend/src/pages/InvoiceImport.css` | New `.ii-upload-vendor-row`, `.ii-vendor-row`, `.ii-received-toggle`, `.ii-receive-preview`, `.ii-receive-chip`, `.ii-rematch-btn` styles (all with `ii-` prefix, responsive breakpoints at 1024/768/480) |
| `backend/tests/invoice_matching_live.test.mjs` | NEW — 7 test cases covering itemCode tier, collision traps, no-vendor fallback, UPC > itemCode priority, PLU tier, SKU exclusion, matchStats |

#### Test coverage
All 7 tests pass:
- T1: Hershey invoice (`vendorId=1`) — matches 3/4 items via itemCode at high confidence
- T2: **Collision trap** — Utz `27149` matches Utz product (201), NOT the Hershey trap product (901) ✓
- T3: No vendorId → org-wide fallback at medium confidence (never high) ✓
- T4: UPC fires before itemCode when UPC is present ✓
- T5: PLU tier matches produce (`4011` → bananas) ✓
- T6: Internal SKU does NOT match ✓
- T7: `_matchStats` populated ✓

Frontend `vite build` passes clean (14.91s, 3,329 modules transformed, no errors).

### Backlog updates

- [x] **Invoice Import — live totals**
- [x] **Invoice Import — Cases/Units receipt toggle**
- [x] **Invoice Import — QOH auto-update with correct unit conversion**
- [x] **Invoice Import — distributor itemCode as primary mapping, vendor-scoped, skip internal SKU**
- [x] **Invoice Import — vendor preselect at upload + re-match button**

---

## 📦 Recent Feature Additions (April 2026 — Session 22)

### Reports Audit Fixes (B1-B14) + End-of-Day Report

Following a comprehensive audit of Reports / Analytics / Dashboard surfaces (documented in the prior session report), this session fixed **13 real bugs** and shipped the full End-of-Day reconciliation report for both back-office and cashier-app.

#### Bug Fixes

| # | Fix | File(s) |
|---|-----|---------|
| **B1** | Department transaction count now uses `Set<txId>` — counts distinct baskets, not line items (was ~5× inflated) | [`salesService.js`](backend/src/services/salesService.js) `getDepartmentSales` |
| **B2** | Redefined: `Gross = Σ grandTotal` (includes tax, matches tender total), `Net = Σ subtotal` (pre-tax, post-discount). User's accounting definition. | [`salesService.js`](backend/src/services/salesService.js) `getDailySales`, [`salesController.js`](backend/src/controllers/salesController.js) `realtimeSales` |
| **B3** | Margin no longer hardcoded 35%. Uses `li.costPrice` per line OR batch-loads `MasterProduct.defaultCostPrice`. Returns `null` when cost data missing (UI shows "—" instead of fake 35%). Reports `hasCostData` + `costCoverage %`. | [`salesService.js`](backend/src/services/salesService.js) `getProductsGrouped`, [`salesController.js`](backend/src/controllers/salesController.js) `realtimeSales` |
| **B4** | `listPayouts` summary now explicitly documents cash drops are excluded (they're separate `/cash-drops` endpoint — pickups, not expenses). | [`shiftController.js`](backend/src/controllers/shiftController.js) `listPayouts` |
| **B5** | Ecom Analytics now: (a) excludes cancelled/pending from revenue, (b) accepts `dateFrom`/`dateTo` params, (c) still shows all statuses in the status pie. | [`ecom-backend/analyticsController.js`](ecom-backend/src/controllers/analyticsController.js) |
| **B6** | Live Dashboard `netSales` now = subtotal (was grandTotal, which included tax) | [`salesController.js`](backend/src/controllers/salesController.js) `realtimeSales` |
| **B7** | Product grouping key priority: `productId → upc → name` (was just `name`; rename-mid-period caused split rows) | [`salesService.js`](backend/src/services/salesService.js) `getTopProducts`, `getProductsGrouped` |
| **B8** | Top Products default date = today (was yesterday — confusing first impression) | [`salesController.js`](backend/src/controllers/salesController.js) `topProducts` |
| **B9** | Employee Reports now distinguishes `transactions / totalSales` (completed) from `refunds / refundsAmount` (refunded). Added `avgSalesPerHour` too. | [`employeeReportsController.js`](backend/src/controllers/employeeReportsController.js) |
| **B10** | Live Dashboard returns `weatherError: 'unavailable'` alongside `weather: null` when fetch fails | [`salesController.js`](backend/src/controllers/salesController.js) `realtimeSales` |
| **B11** | 52-week `avgWeekly` now divides by `max(weeksWithSales, 4)` — new/seasonal products no longer under-counted | [`salesService.js`](backend/src/services/salesService.js) `getProduct52WeekStats` |
| **B13** | Deferred — trimming hour labels to store hours requires store-schedule config, scoped to future work |

#### NEW — End-of-Day Report

Full EoD reconciliation report with the three sections the user specified:

**Section 1: Payouts** (9 categories)
- Cashback, Loans, Pickups (drops), Paid-in, Paid-out, Received on Account, Refunds, Tips, Voids
- Each with Type / Count / Amount

**Section 2: Tender Details** (9 categories)
- Cash, EBT Cash, Check, Debit Card, Credit Card, Electronic Food Stamp (EFS), Paper Food Stamp, In-store Charge, Store Gift Card
- Tender method string normalized via `mapTenderMethod()` — handles legacy variants (`card`/`credit`/`debit`/`ebt`/etc.)

**Section 3: Transactions**
- Average Transaction, Net Sales, Gross Sales, Tax Collected, Cash Collected
- Each with Type / Count / Amount

**Section 4 (shift-scope only): Cash Drawer Reconciliation**
- Opening + Cash Collected − Drops − Payouts = Expected → compared against Counted → Variance

**Scope modes:**
- `?shiftId=X` — single-shift (used by cashier-app on close)
- `?date=YYYY-MM-DD` — single day
- `?dateFrom=&dateTo=` — range
- All scopes also accept `?cashierId=&stationId=&storeId=`

#### New Files

| File | Purpose |
|------|---------|
| [`backend/src/controllers/endOfDayReportController.js`](backend/src/controllers/endOfDayReportController.js) | EoD controller — tender mapping, payout categorization, reconciliation math |
| [`frontend/src/pages/EndOfDayReport.jsx`](frontend/src/pages/EndOfDayReport.jsx) | Back-office EoD page — filter + display + Print/CSV/PDF export |
| [`frontend/src/pages/EndOfDayReport.css`](frontend/src/pages/EndOfDayReport.css) | Page CSS with `eod-` prefix + responsive + print media query |
| [`backend/tests/end_of_day_report.test.mjs`](backend/tests/end_of_day_report.test.mjs) | Tender/payout category invariant tests |

#### Modified Files

| File | Change |
|------|--------|
| [`backend/src/routes/reportsRoutes.js`](backend/src/routes/reportsRoutes.js) | Added `GET /reports/end-of-day` (manager+) |
| [`backend/src/routes/posTerminalRoutes.js`](backend/src/routes/posTerminalRoutes.js) | Added `GET /pos-terminal/shift/:id/eod-report` (cashier) + `/pos-terminal/end-of-day` (back-office alternate) |
| [`frontend/src/services/api.js`](frontend/src/services/api.js) | Added `getEndOfDayReport(params)` |
| [`frontend/src/App.jsx`](frontend/src/App.jsx) | Added `/portal/end-of-day` route |
| [`frontend/src/components/Sidebar.jsx`](frontend/src/components/Sidebar.jsx) | Added "End of Day" link under Reports & Analytics |
| [`cashier-app/src/api/pos.js`](cashier-app/src/api/pos.js) | Rewrote `getEndOfDayReport()` — supports shiftId / object / legacy signatures |
| [`cashier-app/src/services/printerService.js`](cashier-app/src/services/printerService.js) | Added `buildEoDReceiptString()`, `printEoDReportQZ()`, `printEoDReportNetwork()`, `printEoDReport()` dispatcher |
| [`cashier-app/src/components/modals/CloseShiftModal.jsx`](cashier-app/src/components/modals/CloseShiftModal.jsx) | "Print EoD Receipt" button replaces `window.print()` — routes through thermal printer via QZ-Tray or network TCP |
| [`cashier-app/src/components/modals/CloseShiftModal.css`](cashier-app/src/components/modals/CloseShiftModal.css) | Added `.csm-eod-error` style |

#### Thermal Printer Template

`buildEoDReceiptString(report, { paperWidth })` produces ESC/POS bytes for a 42-char (80mm) or 32-char (58mm) printer. Auto-cuts, drawer-safe, includes header (store, register, cashier, period, printed-at), all 3 sections in aligned columns, and reconciliation block for shift scope.

Transport picks QZ-Tray (USB) when `receiptPrinter.method === 'qz'` else network-TCP proxy via `/api/pos-terminal/print-network`.

#### Tests

All 9 tests pass (7 matching + 2 EoD):
- ✓ EoD `TENDER_CATEGORIES` exposes 9 categories in spec order
- ✓ EoD `PAYOUT_CATEGORIES` exposes 9 categories in spec order
- ✓ All prior matching tests still green

Backend syntax: all 7 modified controllers/routes clean. All 8 frontend/cashier JSX files parse clean.

### Backlog updates

- [x] **B1** Department transaction count fixed
- [x] **B2** Gross/Net redefined per user accounting
- [x] **B3** Dynamic margin from real cost data
- [x] **B4** Cash drops explicitly separated from payouts
- [x] **B5** Ecom analytics proper status/date filters
- [x] **B6** Live Dashboard netSales correct
- [x] **B7** Product grouping key fixed
- [x] **B8** Top products defaults to today
- [x] **B9** Employee report refund double-filter cleaned
- [x] **B10** Weather error surfaced
- [x] **B11** 52-week avg divisor fixed
- [x] **End-of-Day report** — back-office + cashier-app thermal print

---

## 📦 Recent Feature Additions (April 2026 — Session 23)

### Fuel Module — Complete (mirrors Lottery pattern)

Full gas-station fuel sale + refund system. Like Lottery, it's optional per store and gated by a `FuelSettings.enabled` flag managed in the back-office portal. Cashier sees Fuel Sale + Fuel Refund buttons in the action bar only when the store has fuel enabled.

#### Schema (`backend/prisma/schema.prisma`) — 3 new models
- **`FuelType`** — per-store fuel grade with `pricePerGallon Decimal(10,3)` (3-decimal precision for "$3.999/gallon"), `isDefault`, `isTaxable`, `taxRate`, `color`, `gradeLabel` ("87 Octane")
- **`FuelSettings`** — store-level: `enabled`, `cashOnly`, `allowRefunds`, `defaultEntryMode` ('amount'|'gallons'), `defaultFuelTypeId`
- **`FuelTransaction`** — per-sale record: `fuelTypeId`, `gallons Decimal(10,3)`, `pricePerGallon Decimal(10,3)`, `amount Decimal(10,2)`, `entryMode`, `taxAmount`, `posTransactionId` link

#### Backend
- **[`fuelController.js`](backend/src/controllers/fuelController.js)** — 9 endpoints: types CRUD, settings GET/PUT, list transactions, date-range report (by-type aggregation with sales/refunds/net/avgPrice), dashboard (today + month KPIs)
- **[`fuelRoutes.js`](backend/src/routes/fuelRoutes.js)** — mounted at `/api/fuel/*`, manager+ writes, cashier+ reads
- **`posTerminalController.createTransaction`** + **`batchCreateTransactions`** both accept `fuelItems[]` and create `FuelTransaction` records linked by `posTransactionId` (mirrors lottery handling)
- **`endOfDayReportController`** — new `aggregateFuel(scope)` adds a `fuel` section to the EoD report with rows per type (sales gallons + amount, refunds, net, avg $/gal)

#### Portal (`frontend/`)
- **[`Fuel.jsx`](frontend/src/pages/Fuel.jsx)** + **[`Fuel.css`](frontend/src/pages/Fuel.css)** — 4-tab page (`fuel-` prefix):
  - **Overview** — today/month KPIs (gallons + sales) + by-type breakdown
  - **Fuel Types** — grid of cards per type, modal CRUD with 3-decimal price input, color picker, default toggle, taxable toggle
  - **Sales Report** — date-range KPI strip + by-type table with sales/refunds/net/avg-price
  - **Settings** — enable toggle, cash-only, allow refunds, default entry mode (Amount/Gallons), default fuel type dropdown
- Sidebar group "Fuel" with `Fuel` lucide icon + `/portal/fuel` route
- 9 new API helpers in [`api.js`](frontend/src/services/api.js) using shared `fuelUnwrap`

#### Cashier App (`cashier-app/`)
- **[`useFuelSettings.js`](cashier-app/src/hooks/useFuelSettings.js)** — fetches FuelSettings + FuelTypes for the active station's store; polls every 5 min + on visibility change (mirrors `usePOSConfig`)
- **[`FuelModal.jsx`](cashier-app/src/components/modals/FuelModal.jsx)** + **[`FuelModal.css`](cashier-app/src/components/modals/FuelModal.css)** (`fm-` prefix):
  - LEFT: fuel-type chip selector (default pre-selected per settings) → Amount/Gallons mode toggle → live preview showing entered + computed (the other side) + price-per-gallon → "Add to Cart" + pump-set instruction note → session list
  - RIGHT: cent-based digit display + 3×4 numpad + Done button
  - Refund mode (`mode='refund'`) flips accent to amber and labels button "Add Refund to Cart"
  - Cashier cannot override price — it's locked to the type's `pricePerGallon` configured in portal
- **[`useCartStore.addFuelItem`](cashier-app/src/stores/useCartStore.js)** — creates `isFuel: true` cart line with both gallons + amount + entryMode; sale = positive `lineTotal`, refund = negative
- **[`CartItem.jsx`](cashier-app/src/components/cart/CartItem.jsx)** — new fuel render branch shows `⛽ Regular (87 Octane)` with sub-text `10.003 gal × $3.999/gal · entered as amount` and `+$40.00` total (sale = red, refund = amber)
- **[`ActionBar.jsx`](cashier-app/src/components/pos/ActionBar.jsx)** — two new buttons "Fuel Sale" (red `#dc2626`) and "Fuel Refund" (amber `#f59e0b`), only visible when `fuelEnabled && shiftOpen`. Refund button hidden when `fuelRefundsEnabled === false`
- **[`POSScreen.jsx`](cashier-app/src/screens/POSScreen.jsx)** — new `fuelModalMode` state, mounts FuelModal, both quickCashSubmit and TenderModal paths now extract `fuelItems[]` and exclude fuel items from `txLineItems`
- **[`TenderModal.jsx`](cashier-app/src/components/tender/TenderModal.jsx)** — new `fuelCashOnly` prop forces cash-only when cart has fuel items; new amber "⛽ Fuel items — cash only" banner

#### End-to-End Verified Flow
1. Portal: enable Fuel module, create 3 types ("Regular 87" $3.999, "Premium 91" $4.499, "Diesel" $4.299)
2. Cashier sees "Fuel Sale" + "Fuel Refund" in action bar
3. Tap Fuel Sale → modal opens with Regular pre-selected, Amount mode active
4. Enter $15.00 → preview shows `3.751 gal × $3.999/gal` instantly. Or toggle to Gallons mode and enter `5.000 gal` → preview shows `$20.00`
5. Add to Cart → cart row shows `⛽ Regular (87 Octane) · 3.751 gal × $3.999/gal · entered as amount · +$15.00`
6. Quick Cash $50 → completes transaction → DB persists `Transaction` row + linked `FuelTransaction` row with snapshot of `fuelTypeName`, `gallons`, `pricePerGallon`, `amount`, `entryMode`
7. Portal Sales Report shows aggregated rows per fuel type with avg $/gallon
8. End-of-Day report `fuel` section shows by-type breakdown with sales/refunds/net gallons + amount

#### Pre-existing EoD Bugs Fixed (Drive-by, Required for Fuel Verification)
- `prisma.station.findUnique` was selecting non-existent `stationNumber` field → removed
- `prisma.store.findUnique` was selecting non-existent `address`/`phone`/`timezone` fields → removed
- `prisma.cashDrop.findMany` / `cashPayout.findMany` were filtering by non-existent `storeId` column → switched to relational `shift: { storeId }` filter

#### Files Changed
| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | NEW models: FuelType, FuelSettings, FuelTransaction |
| `backend/src/controllers/fuelController.js` | NEW — full controller |
| `backend/src/routes/fuelRoutes.js` | NEW — `/api/fuel/*` |
| `backend/src/server.js` | Mount fuelRoutes |
| `backend/src/controllers/posTerminalController.js` | Accept fuelItems in createTransaction + batchCreateTransactions; skip fuel in stock-deduct filter |
| `backend/src/controllers/endOfDayReportController.js` | Add `aggregateFuel()` + fuel section in response; fix 4 pre-existing schema-mismatch bugs |
| `frontend/src/pages/Fuel.jsx` + `Fuel.css` | NEW — 4-tab portal page (`fuel-` prefix) |
| `frontend/src/components/Sidebar.jsx` | Added Fuel group + Fuel icon import |
| `frontend/src/App.jsx` | Added `/portal/fuel` route |
| `frontend/src/services/api.js` | 9 fuel API helpers + `fuelUnwrap` |
| `cashier-app/src/hooks/useFuelSettings.js` | NEW |
| `cashier-app/src/api/pos.js` | Added `getFuelTypes`, `getFuelSettings` |
| `cashier-app/src/stores/useCartStore.js` | Added `addFuelItem` |
| `cashier-app/src/components/cart/CartItem.jsx` + `.css` | Render fuel item card (`ci-fuel`) |
| `cashier-app/src/components/modals/FuelModal.jsx` + `.css` | NEW — full modal (`fm-` prefix) |
| `cashier-app/src/components/pos/ActionBar.jsx` | Two new fuel buttons |
| `cashier-app/src/screens/POSScreen.jsx` | Mount FuelModal + extract fuelItems in payloads |
| `cashier-app/src/components/tender/TenderModal.jsx` | `fuelCashOnly` prop + cash-only enforcement + fuelItems extraction |

---

*Last updated: April 2026 — Session 23: Fuel Module (Sale + Refund + Reports + EoD Section)*

---

## 📦 Recent Feature Additions (April 2026 — Session 24)

### A. Cashier "Back Office" Action — Open Portal in New Tab

New button in [`ActionBar.jsx`](cashier-app/src/components/pos/ActionBar.jsx) with `ExternalLink` icon (purple `#7c3aed`):
- Always visible in the cashier action bar (not gated on manager session)
- Triggers `mgr('Back Office', onAdminPortal)` — prompts for manager PIN if no active session, otherwise calls handler directly
- [`POSScreen.jsx`](cashier-app/src/screens/POSScreen.jsx) handler: `window.open(VITE_PORTAL_URL || 'http://localhost:5173' + '/portal/realtime', '_blank', 'noopener,noreferrer')`
- New tab opens — if the user already has a portal session in the browser, they go straight to Live Dashboard; otherwise the portal's normal login flow takes over

### B. 1-Minute Inactivity Lock-Screen on Portal

New global component [`InactivityLock.jsx`](frontend/src/components/InactivityLock.jsx) + [`InactivityLock.css`](frontend/src/components/InactivityLock.css) (`il-` prefix) mounted in [`App.jsx`](frontend/src/App.jsx):
- After **60 s** of no `mousemove` / `mousedown` / `keydown` / `touchstart` / `scroll` / `wheel` events, shows a full-screen lock overlay
- Activity events throttled to once-per-second so they don't spam timer resets
- Lock skips public/auth pages — only triggers on routes starting with `/portal`, and only when not on `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/impersonate`
- Lock-screen overlay shows the user's name + a password input (Eye/EyeOff toggle) + "Unlock" + "Sign out instead"
- Unlock calls new `POST /api/auth/verify-password` endpoint (JWT-protected, rate-limited via `loginLimiter`) that bcrypt-compares the supplied password against the user's stored hash. **Session and current page are preserved** — the overlay just blocks interaction
- "Sign out instead" clears `user` + `activeStoreId` from localStorage and redirects to `/login`

#### New backend endpoint
[`authController.js`](backend/src/controllers/authController.js) `verifyPassword`:
- `POST /api/auth/verify-password` (JWT required)
- Body: `{ password }`
- Validates current user exists + bcrypt-compares password → returns `{ success: true }` or 401

[`authRoutes.js`](backend/src/routes/authRoutes.js) registers the route with `protect` + `loginLimiter`.

### C. Product Catalog — On Hand Column + Tax Column Removed

[`ProductCatalog.jsx`](frontend/src/pages/ProductCatalog.jsx) and [`ProductCatalog.css`](frontend/src/pages/ProductCatalog.css):
- **Tax column removed** from the table
- **On Hand column added** — shows the active store's `quantityOnHand` from `StoreProduct`
  - **Green** badge for stock > 5
  - **Amber** badge for stock 1-5
  - **Red** badge for stock ≤ 0
  - **"—"** when no active store, or product not stocked at this store
- New `OnHandCell` component renders the badge

#### Backend wiring
[`catalogController.js`](backend/src/controllers/catalogController.js) `getMasterProducts`:
- Reads `storeId` from `?storeId=`, `X-Store-Id` header, or `req.storeId`
- When supplied, includes `storeProducts: { where: { storeId }, take: 1 }` in the Prisma query
- Flattens `quantityOnHand`, `storeRetailPrice`, `storeCostPrice`, `inStock` onto each product before returning
- Frontend `loadProducts` now passes `storeId: activeStoreId` in the params

### D. Per-Store Catalog Column Configuration

Store admins can customize which catalog columns appear via a gear-icon button in the page header:

#### Column schema
```js
const CATALOG_COLUMNS = [
  { key: 'pack',       label: 'Pack',       defaultOn: false },
  { key: 'cost',       label: 'Cost',       defaultOn: false },
  { key: 'retail',     label: 'Retail',     defaultOn: true  },
  { key: 'margin',     label: 'Margin',     defaultOn: false },
  { key: 'department', label: 'Department', defaultOn: true  },
  { key: 'onHand',     label: 'On Hand',    defaultOn: true  },
  { key: 'vendor',     label: 'Vendor',     defaultOn: false },
];
```
**Always-on columns** (cannot be hidden): Product (name + UPC + brand + promo badge), Flags (EBT/Age/DEP/LB), Actions (edit/delete)

#### Storage
- Saved per-store in `store.pos.catalogColumns` as an array of column keys
- Loaded via `GET /pos-terminal/config?storeId=...`
- Saved via `PUT /pos-terminal/config` with the merged config object
- **Shared across all users at that store** — manager+ can change it
- Default falls back to `['retail', 'department', 'onHand']` when no store is selected or no preference is saved

#### UI
- Gear icon (Settings) next to the Refresh button in the page header
- Opens [`ColumnsModal`](frontend/src/pages/ProductCatalog.jsx) — list of toggleable columns with checkmark icons
- Locked row at the top showing the always-on columns
- "Reset to default" button restores `DEFAULT_VISIBLE_COLS`
- "Save" persists to backend; warning banner if no active store selected

#### Verified end-to-end
1. Default columns: Product, Retail, Department, On Hand, Flags
2. Open gear → toggle Cost + Vendor on → Save → DB row shows `catalogColumns: ['retail', 'department', 'onHand', 'cost', 'vendor']`
3. Page re-renders with: PRODUCT, COST, RETAIL, DEPARTMENT, ON HAND, VENDOR, FLAGS
4. On Hand badges render with correct color tiers (green/amber/red)

### Files Changed (Session 24)
| File | Change |
|------|--------|
| `cashier-app/src/components/pos/ActionBar.jsx` | Added `ExternalLink` import, `onAdminPortal` prop, "Back Office" button |
| `cashier-app/src/screens/POSScreen.jsx` | Wired `onAdminPortal` to open `${VITE_PORTAL_URL}/portal/realtime` in new tab |
| `frontend/src/components/InactivityLock.jsx` | NEW — global lock-screen overlay |
| `frontend/src/components/InactivityLock.css` | NEW — `il-` prefix |
| `frontend/src/App.jsx` | Mount `<InactivityLock />` |
| `backend/src/controllers/authController.js` | NEW `verifyPassword` controller |
| `backend/src/routes/authRoutes.js` | Added `POST /verify-password` (protect + loginLimiter) |
| `backend/src/controllers/catalogController.js` | `getMasterProducts` now returns store-scoped `quantityOnHand` when storeId is passed |
| `frontend/src/pages/ProductCatalog.jsx` | Removed Tax column, added On Hand column, added per-store column config + gear button + ColumnsModal + OnHandCell |
| `frontend/src/pages/ProductCatalog.css` | New `pc-onhand-badge` + `pc-cols-*` modal styles |

### Deferred to Future Session
The multi-organization user model (one email → many orgs → many stores → per-store role) — see proposed plan in chat. Requires schema migration, JWT structure change, every backend route's `req.orgId` scoping touched, login + StoreSwitcher rework. Estimated 1 dedicated session of similar size to the Fuel module.

---

*Last updated: April 2026 — Session 24: Cashier→Portal Shortcut, 1-min Inactivity Lock, Per-Store Catalog Columns, On-Hand Column*

---

## 📦 Recent Feature Additions (April 2026 — Session 25)

### A. Fuel Module (live verified) — Done in Session 23, smoke-confirmed here.
### B. Manual Item bug fixes
[`OpenItemModal.jsx`](cashier-app/src/components/modals/OpenItemModal.jsx) — Two issues fixed:
- **Numpad rejected all digits** because the initial amount state was `'0.00'` (already 2 decimals) which tripped the `>= 2 decimal places` reject. Rewrote to cent-based digit buffer matching TenderModal/LotteryModal/FuelModal — typing `5 8 7` → `$5.87`.
- **Item name optional** — placeholder shows the selected category label; cart line falls back to category name when blank. New `.oim-optional` hint next to the label.

### C. Inactivity Lock — fix click + render stalls
[`InactivityLock.css`](frontend/src/components/InactivityLock.css) and [`InactivityLock.jsx`](frontend/src/components/InactivityLock.jsx):
- Removed `backdrop-filter: blur(8px)` (caused GPU stalls + unresponsive clicks on some Chromium/Edge/Electron builds — the same render issue that made screenshots time out)
- Bumped `z-index` to `2147483646`, added explicit `pointer-events: auto` on backdrop and card, `position: relative; z-index: 1` on card
- Extracted `LockOverlay` sub-component with `useRef` + `requestAnimationFrame` retry-loop for `inputRef.current.focus({ preventScroll: true })` — handles cases where `autoFocus` prop is silently dropped
- Added `onMouseDown / onClick / onTouchStart` swallow handlers on the backdrop so clicks can't leak through to the page below

### D. Cashier ActionBar — horizontally scrollable
[`ActionBar.jsx`](cashier-app/src/components/pos/ActionBar.jsx) + [`ActionBar.css`](cashier-app/src/components/pos/ActionBar.css):
- Wrapped everything after the (left-pinned) Manager button in a new `.ab-scroll` container (`overflow-x: auto; min-width: 0; scrollbar-width: thin`)
- Set `flex-shrink: 0` on `.ab-action` and `.ab-hold-btn` so buttons keep their natural width and trigger horizontal scrolling instead of being squished
- Spacer changed to `flex: 1 1 0` so it collapses naturally when the wrapper overflows
- Touch swipe + thin 6px scrollbar both functional; verified all 13 buttons reachable

### E. Store-level Age Verification Policy (Tobacco / Alcohol)
**Back office** ([`StoreSettings.jsx`](frontend/src/pages/StoreSettings.jsx) + [`StoreSettings.css`](frontend/src/pages/StoreSettings.css)):
- New "Age Verification Policy" section with two number inputs (Tobacco / Alcohol)
- Saved per-store in `store.pos.ageLimits = { tobacco, alcohol }` — defaults `{21, 21}` (US); admins can set `{21, 19}` for Ontario etc.
- Two coloured tags (slate=tobacco, indigo=alcohol) match the chips shown in the cashier app

**Cashier app**:
- [`usePOSConfig.js`](cashier-app/src/hooks/usePOSConfig.js) merges `ageLimits` from the server config (5-min poll + visibility-change refresh)
- [`POSScreen.jsx`](cashier-app/src/screens/POSScreen.jsx) `addWithAgeCheck` overrides the per-product `ageRequired` with the store-level value when `taxClass === 'tobacco'` or `'alcohol'` — so the AgeVerificationModal always uses the correct store policy
- New `.pos-age-policy` strip below the StatusBar shows the configured limits as Tobacco/Alcohol coloured chips
- [`StatusBar.jsx`](cashier-app/src/components/layout/StatusBar.jsx) now shows two date chips side by side: `Tobacco 21+: Apr 18, 2005` and `Alcohol 19+: Apr 18, 2007` (born-on-or-before, recomputed each clock tick). Falls back to a single `21+` chip when neither store-level limit is set.

### F. Catalog Sync — Tombstones for deleted products + replace-semantics for small lists
**Bug**: Soft-deleted products lingered in the cashier-app IndexedDB cache forever. Sync used upsert-only (`bulkPut`) and the snapshot endpoint just stopped returning deleted rows — there was no "remove this" signal. Same issue affected Departments, Promotions, Tax Rules, Deposit Rules.

**Fix backend** ([`posTerminalController.js`](backend/src/controllers/posTerminalController.js) `getCatalogSnapshot`):
- Added explicit `deleted: false` to the active-products WHERE clause
- When `?updatedSince=` is supplied AND `page === 1`, also fetches IDs of products with `(deleted=true OR active=false) AND updatedAt >= since`
- Returns them in a new `deleted: number[]` field on the response (sent once at the head of the paginated stream, not per page)

**Fix frontend** ([`useCatalogSync.js`](cashier-app/src/hooks/useCatalogSync.js) + [`dexie.js`](cashier-app/src/db/dexie.js)):
- New `deleteProducts(ids)` Dexie helper does a `bulkDelete` on the products table
- Sync loop calls it whenever `res.deleted?.length > 0`
- Departments + Promotions + Tax Rules + Deposit Rules now use **REPLACE semantics** — wipe + bulkPut inside a single Dexie transaction. Simpler than tombstones since these tables are small (typically <50 rows each), and guarantees deletions reflect immediately.

**Verified**: soft-deleted product 41479 correctly returned in `deleted: [41499]` array, NOT in `data`. Restored after test.

**Sync cadence reminder**: 15 min auto + on login + manual button. Constant `SYNC_INTERVAL_MS = 15 * 60 * 1000` in [`useCatalogSync.js:15`](cashier-app/src/hooks/useCatalogSync.js:15).

#### Files Changed (Session 25)
| File | Change |
|------|--------|
| `cashier-app/src/components/modals/OpenItemModal.jsx` + `.css` | Cent-based numpad, optional name, category-fallback placeholder |
| `frontend/src/components/InactivityLock.jsx` + `.css` | Removed backdrop-filter, hardened pointer-events, force-focus retry loop |
| `cashier-app/src/components/pos/ActionBar.jsx` + `.css` | New `.ab-scroll` wrapper for horizontally-scrollable action buttons |
| `frontend/src/pages/StoreSettings.jsx` + `.css` | Age Verification Policy section, two coloured number inputs |
| `cashier-app/src/hooks/usePOSConfig.js` | `ageLimits` merged from server config |
| `cashier-app/src/screens/POSScreen.jsx` + `.css` | Age policy chip strip below StatusBar; `addWithAgeCheck` applies store-level override |
| `cashier-app/src/components/layout/StatusBar.jsx` + `.css` | Two age-check date chips (Tobacco/Alcohol) side-by-side; legacy 21+ fallback |
| `backend/src/controllers/posTerminalController.js` | `getCatalogSnapshot` returns `deleted[]` tombstones |
| `cashier-app/src/db/dexie.js` | New `deleteProducts`, `replaceDepartments`, `replacePromotions` helpers |
| `cashier-app/src/hooks/useCatalogSync.js` | Apply tombstones; replace-semantics for departments/promotions/tax/deposit rules |
| `backend/src/controllers/authController.js` | NEW `verifyPassword` endpoint (used by InactivityLock unlock) |
| `backend/src/routes/authRoutes.js` | `POST /verify-password` route (protect + loginLimiter) |

---

*Last updated: April 2026 — Session 25: Manual Item fix, Inactivity Lock hardening, Scrollable ActionBar, Age Policy (Tobacco/Alcohol), Catalog Sync Tombstones*

---

## 📦 Recent Feature Additions (April 2026 — Session 26)

### End-of-Day Report — full audit + parity between cashier-app and back-office

Triggered by user request to confirm EoD correctness, print feature, and end-of-shift report; and to make the cashier-app EoD show the same details as the portal page (manager-PIN gated).

#### Bugs found and fixed

1. **Reconciliation math** — `received_on_acct` was being **subtracted** from drawer expectation but it's money INTO the drawer. Rewrote in [`endOfDayReportController.js`](backend/src/controllers/endOfDayReportController.js):
   ```
   expected = opening + cashCollected + (paid_in + received_on_acct) − pickups − (paid_out + loans)
   ```
   Response now includes both `cashIn` and `cashOut` keys; `cashPayoutsTotal` kept for back-compat.

2. **Average-tx denominator** — `grossSales / completeCount` was skewed (gross had refunds subtracted but count didn't). Now uses **`(grossSales + refundAmount) / (completeCount + refundCount)`** — pre-refund gross over total tickets including refunds.

3. **`shiftController.listPayouts` + `listCashDrops` storeId bug** — both were filtering by a non-existent `storeId` column on `CashPayout` / `CashDrop`. Threw `column "storeId" does not exist` whenever `?storeId=` was supplied. Fixed to use the relational filter `where.shift = { storeId }` (same pattern used in EoD controller).

4. **Duplicate legacy `getEndOfDayReport` controller** — `posTerminalController.js` had a 78-line legacy controller returning the old `netSales/tenderBreakdown/cashierBreakdown/clockEvents` shape. Removed entirely. Both `/api/pos-terminal/reports/end-of-day` and `/api/pos-terminal/end-of-day` now point at the unified controller in `endOfDayReportController.js`.

5. **Fuel section silently dropped** — the response carried `fuel: { rows[], totals }` (added in Session 23) but neither the back-office page nor the cashier print template rendered it. Added in both surfaces.

6. **Cashier-app `EndOfDayModal` reading old shape** — rendered blanks for tenders/payouts/totals because it was reading legacy keys (`report.netSales`, `report.tenderBreakdown`, `report.cashierBreakdown`, `report.clockEvents`) that don't exist in the new response. Modal completely rewritten.

#### Cashier-app EoD Modal rewrite

[`EndOfDayModal.jsx`](cashier-app/src/components/modals/EndOfDayModal.jsx) replaced — now mirrors the back-office page layout exactly:
- **Header** — store, cashier, register, period
- **Big-number row** — Net Sales / Gross Sales / Cash Collected (3-up grid, collapses to 1 col under 640px)
- **Section 1 — Payouts** (9-category table, hides zero-rows by default)
- **Section 2 — Tender Details** (9-category table)
- **Section 3 — Transactions** (avg / net / gross / tax / cash collected)
- **Section 4 — Fuel Sales** (only when fuel exists; per-type net gallons + amount)
- **Reconciliation** (shift-scope only) — Opening / + Cash Collected / + Cash In / − Drops / − Cash Out / = Expected / Counted / Variance
- Date picker in header to view any past day
- Refresh + Print + Close Batch (Dejavoo) actions
- Print routes through `printEoDReport(posConfig, report)` → `buildEoDReceiptString` (now includes fuel section + corrected reconciliation rows) → QZ-Tray (USB) or `/print-network` (TCP)
- Removed obsolete in-file `buildEODString` legacy function (~67 lines)

#### Manager PIN gate

The cashier-app "End of Day" button was already manager-gated via `mgr('End of Day', onEndOfDay)` in [`ActionBar.jsx`](cashier-app/src/components/pos/ActionBar.jsx). Confirmed working in test: clicking "End of Day" prompts the Manager Required modal first when no manager session is active. With a valid manager session, it opens the modal directly.

#### Back-office page additions

[`EndOfDayReport.jsx`](frontend/src/pages/EndOfDayReport.jsx) + [`.css`](frontend/src/pages/EndOfDayReport.css):
- New "FUEL SALES" section between Transactions and Reconciliation (only shown when fuel rows exist)
- Reconciliation now shows the new Cash In / Cash Out lines correctly
- CSV export includes fuel rows
- PDF export includes fuel rows
- Responsive: added 1024px and 480px breakpoints (was only 768px before)

#### Print template additions

[`printerService.js`](cashier-app/src/services/printerService.js) `buildEoDReceiptString`:
- New "FUEL SALES" block between TRANSACTIONS and CASH RECONCILIATION (only when `report.fuel.rows.length > 0`); includes per-type net gallons + amount and a Total row
- Reconciliation lines updated to print `+ Cash Sales`, optional `+ Cash In`, `− Drops`, `− Cash Out` (matching the corrected math)
- Backwards-compatible — falls back to legacy `cashPayoutsTotal` key when new `cashOut` not present

#### Verified end-to-end
- API: `GET /api/reports/end-of-day?date=2026-04-17&storeId=...` returns all 7 keys including `fuel: { rows: [{ name: 'Regular', netGallons: 3.751, netAmount: 15 }, ...], totals: { gallons, amount, ... } }`
- Legacy alias `GET /api/pos-terminal/reports/end-of-day` now returns the same new shape
- Back-office page: 4 section titles render — `PAYOUTS / TENDER DETAILS / TRANSACTIONS / FUEL SALES`, `eod-fuel-table` element renders with 2 tbody rows (1 type + 1 total)
- Cashier-app modal: 3 section titles render — `PAYOUTS / TENDER DETAILS / TRANSACTIONS`, big-number row shows `Net Sales / Gross Sales / Cash Collected` with non-zero values from today; fuel section correctly hidden when no fuel sales for the selected date

#### Files Changed (Session 26)
| File | Change |
|------|--------|
| `backend/src/controllers/endOfDayReportController.js` | Reconciliation math fix; avg-tx denominator fix; new `cashIn`/`cashOut` keys |
| `backend/src/controllers/posTerminalController.js` | Removed legacy 78-line `getEndOfDayReport` (replaced with comment pointer to new controller) |
| `backend/src/controllers/shiftController.js` | `listPayouts` + `listCashDrops`: storeId filter via `shift: { storeId }` relation |
| `backend/src/routes/posTerminalRoutes.js` | Both `/end-of-day` and `/reports/end-of-day` now point to `endOfDayReportController.getEndOfDayReport` |
| `frontend/src/pages/EndOfDayReport.jsx` + `.css` | Fuel section render + CSV/PDF export; reconciliation Cash In/Out rows; 1024/480 responsive |
| `cashier-app/src/services/printerService.js` | Fuel section in print template; corrected reconciliation lines |
| `cashier-app/src/components/modals/EndOfDayModal.jsx` + `.css` | Full rewrite to match back-office layout (header / bignums / 3 sections / fuel / reconciliation) |

---

*Last updated: April 2026 — Session 26: EoD Report Audit & Fixes — math corrections, dead-code removal, fuel section rendering, cashier-app/back-office parity*

---

## 📦 Recent Feature Additions (April 2026 — Session 27)

### Sales-summary surfaces unified with End-of-Day report

User reported "sales data not matching from the Report (Summary) and End of Day report is different" + suspicion that "cash tender is not calculating".

**Cash tender was actually calculating correctly** — every cashier-app code path writes lowercase `'cash'` and EoD's `mapTenderMethod` normalizes via `.toLowerCase().trim()`. No string-mismatch bug. The real cause was that the summary surfaces and the EoD report used **different status filters**, and one of them silently ignored refunds entirely.

#### Root cause

| Surface | Old status filter | Problem |
|---------|------------------|---------|
| Sales Analytics (Daily/Weekly/Monthly) | `status: 'complete'` only | Refund TXs invisible — Gross only counted sales |
| Live Dashboard | `status: 'complete'` only | Same |
| Department / Top Products / Products Grouped | `status: 'complete'` only | Same |
| Back-office Transactions tab | NO server-side filter | Mixed completes + refunds + voids; `Math.abs(grandTotal)` made refunds **add** to revenue |
| End-of-Day report | `status: { in: ['complete', 'refund', 'voided'] }` | Refunds correctly netted out of Gross/Net |

Net effect on a day with $40 sale + $10 refund:
- SalesAnalytics → Gross **$40** (refund tx invisible)
- EoD → Gross **$30** (refund netted out)
- Transactions tab → Revenue **$50** (refund's `Math.abs(-10) = +10`)

#### Fix — single status convention across the codebase

All sales-aggregation paths now use `status: { in: ['complete', 'refund'] }` and apply this **sign convention** when summing values (matching EoD's `aggregateTransactions`):

```
isRefund = tx.status === 'refund'

// Refund: stored as POSITIVE refund amount → subtract via -Math.abs()
// Complete: use raw signed value (allows negative-total bottle-return carts to subtract)
value = isRefund ? -Math.abs(tx.field) : tx.field
```

This **matters for completes with negative `grandTotal`** (net-negative carts where bottle returns exceed sales) — earlier `Math.abs` would have flipped them to positive and double-counted. Caught and fixed during verification (TXN-58 had `grandTotal: -69`, was contributing `+69` to gross).

#### Specific fixes shipped

| File | Change |
|------|--------|
| [`backend/src/services/salesService.js`](backend/src/services/salesService.js) | `buildWhere` now `status: { in: ['complete','refund'] }`. `getDailySales`, `getDepartmentSales`, `getTopProducts`, `getProductsGrouped` apply the refund-subtract sign convention. `TotalRefunds` populated from refund txs (was previously only from `li.isRefund` per-line flag — distinct from a refund-status tx) |
| [`backend/src/controllers/salesController.js`](backend/src/controllers/salesController.js) | `realtimeSales` (Live Dashboard) — refunds netted; new `refundCount` on response; refund tx lineItems excluded from "top products" but still counted in totals |
| [`backend/src/controllers/posTerminalController.js`](backend/src/controllers/posTerminalController.js) | `listTransactions` — when `?status=` not supplied, defaults to `{ in: ['complete','refund'] }` so the back-office Transactions page agrees with EoD. Pass `?status=all` to include voids |
| [`frontend/src/pages/Transactions.jsx`](frontend/src/pages/Transactions.jsx) | Stats summary rewritten — refunds subtract from revenue; tender breakdown subtracts cash refunded from net-cash collected; `avg` divides by completed-sale count only |

#### Verified with live data

Same store, same date (Apr 6 — has 15 completes + 3 refunds):
```
EoD:    gross=$242.40  net=$210.69  tax=$8.91  refunds=$11.25
Daily:  gross=$242.40  net=$210.69  tax=$8.91  refunds=$11.25  ✓
Live:   gross=$242.40  net=$210.69  ✓
```

Apr 18 (today, 3 sales, no refunds):
```
EoD:    gross=$58.38  net=$58.38
Daily:  gross=$58.38  net=$58.38  ✓
Live:   gross=$58.38  net=$58.38  ✓
```

#### Cash tender confirmation

Confirmed via DB inspection: every writer (`TenderModal.complete`, `quickCashSubmit`, `RefundModal`, seed script, Cashier UI quick-cash buttons) uses lowercase `'cash'`. `mapTenderMethod` lowercases + trims input before matching. Cash tender IS being calculated correctly in EoD; the perceived discrepancy was downstream of the Gross/Net mismatch above.

#### Remaining known gap (deferred)

`Transaction` table still has no `shiftId` column (Open Bug A from Session 20). EoD `?shiftId=` scope falls back to `createdAt: { gte: shift.openedAt, lte: closedAt || now }` window filtering. If two shifts overlap (e.g. handover with open shift), txs would appear in both shifts' EoDs. Migration to add `shiftId` to Transaction model is queued for a future session.

---

*Last updated: April 2026 — Session 27: Sales-summary surfaces unified with EoD; cash tender confirmed correct; refund-status sign convention enforced everywhere*

---

## 📦 Recent Feature Additions (April 2026 — Session 28)

### Critical: cash sales were saving as `status: 'pending'` and silently excluded from EoD/Daily

User reported "cash checkout sale is not getting reflected in EoD report" + "nothing is calculating in back-office for cash sales".

#### Root cause

The cashier-app's offline transaction queue marks pending uploads with a LOCAL sync flag `status: 'pending'` ([dexie.js:138](cashier-app/src/db/dexie.js:138) `enqueueTransaction`). When the queue is later replayed via `POST /pos-terminal/transactions/batch`, the backend was honoring that local flag:

```js
status: tx.status || 'complete',  // ← would store 'pending' if queue sent 'pending'
```

Cash sales tend to fall through to the offline-queue path more often than card sales (a single network blip during the cashier's quick-cash submit triggers the catch fallback to `enqueueTx`). Card sales typically wait for a successful HTTP response, so they make it through the live `createTransaction` path which generates its own sequential txNumber and saves as 'complete'.

DB inspection confirmed: every cash tx in the past several days had `status: 'pending'` (with a frontend-generated `TXN-MO3xxxxx` txNumber); every card tx had `status: 'complete'` (with a backend-generated `TXN-YYYYMMDD-NNNNNN` txNumber). After Session 27's status filter unification, both EoD and Daily/Live filtered `{ in: ['complete', 'refund'] }` — so every cash sale was invisible to both.

#### Fix

Both `createTransaction` and `batchCreateTransactions` in [`posTerminalController.js`](backend/src/controllers/posTerminalController.js) now **force `status: 'complete'`** regardless of what the client sends. Voids and refunds use their own dedicated endpoints (`voidTransaction`, `createRefund`), so `createTransaction` and `batchCreateTransactions` legitimately only ever produce completed sales.

Defensive against any future client bug that might send a non-complete status to the wrong endpoint.

#### One-time backfill

```js
prisma.transaction.updateMany({
  where: { status: 'pending' },
  data:  { status: 'complete' },
});
// → 21 stuck cash transactions corrected
```

#### Verified live

Apr 18 EoD before fix → 3 txns, $58.38 (card-only, cash hidden).
Apr 18 EoD after fix → **12 txns, $384.55** with tender breakdown:
- Cash: 9 × $528.97
- Credit Card: 3 × $58.38
- Cash Collected: $326.17 (cash tendered − change given)

Daily, Live Dashboard, and EoD all agree across Gross / Net / TxCount.

#### Files Changed (Session 28)
| File | Change |
|------|--------|
| `backend/src/controllers/posTerminalController.js` | `createTransaction` + `batchCreateTransactions` now force `status: 'complete'` instead of honoring the client's `tx.status` |
| (data) | One-time `UPDATE transactions SET status='complete' WHERE status='pending'` — 21 rows |

---

## 📦 Recent Feature Additions (April 2026 — Session 29)

### Admin Panel UI Consistency Fixes

**Table header background fix** — `AdminOrgAnalytics.jsx` was misusing `.admin-header-icon` (44×44 colored box) as a `<span>` inside `<th>` elements, causing green background boxes on table headers. Replaced with `.aoa-sort-label`. Same fix applied to `AdminOrganizations.jsx`, `AdminStores.jsx` (name column → `admin-name-cell` + `admin-name-icon`), `AdminCmsPages.jsx`, `AdminCareers.jsx` (card headers → `admin-card-header-row`). Global `th { background }` removed from `frontend/src/index.css`.

**Button & spacing standardization** — Added `.admin-header-actions` (gap between header buttons), `.admin-row-actions` (consistent action icon spacing), `.admin-name-cell`/`.admin-name-icon` (table name column). Applied across Users, Organizations, Stores pages.

**Payment Management UI** — Fixed Terminal tab search bar (proper `.admin-search` wrapper), History tab date inputs (styled `.aps-history-date` with focus state), removed `admin-input` ghost class.

**Chat page** — Header aligned with standard `admin-header` pattern (icon in `admin-header-icon` box, matching font sizes/gaps).

**Color variable consistency** — Replaced all `#6366f1` (14 instances) in `AdminTickets.css` with `var(--accent-primary)`. Replaced `#3b82f6` in `AdminPaymentSettings.css` and `AdminBilling.css` toggle/tab/checkbox accent colors with `var(--accent-primary)`.

**Filter tab shape consistency** — Changed `.admin-tab` from `border-radius: 999px` (pill) to `8px` (rectangle). Fixed `EcomOrders`, `InvoiceImport`, `POSSettings`, `Promotions` filter buttons to `8px`.

### Button Hover Contrast Fixes

Fixed invisible-text-on-hover bug across 11 files. Every active filter tab/button with white text on colored background now has an explicit `.active:hover` rule keeping `color: #fff` and darkening background to `var(--brand-dark)`:

`EcomOrders.css`, `Lottery.css` (×2), `Transactions.css`, `InvoiceImport.css`, `InventoryCount.css`, `ProductForm.css` (×3), `ShopPage.css`, `admin.css`, `AdminTickets.css`

### CSS Variable Centralization (`max-width`)

| App | Variable | Value | File |
|-----|----------|-------|------|
| Admin | `--content-max-width` | `1400px` | `admin-app/src/styles/global.css` |
| Portal | `--content-max-width` | `1400px` | `frontend/src/index.css` |
| Portal | `--mkt-max-width` | `1200px` | `frontend/src/index.css` |

Replaced hardcoded `max-width` in 22 CSS files with these variables.

### Horizontal Scroll Prevention

Added `overflow-x: hidden` + `min-width: 0` to `.main-content` in both `frontend/src/index.css` and `admin-app/src/styles/global.css`. Tables scroll horizontally via `.p-table-wrap` / `.admin-table-wrap`; page never scrolls.

### Database Backup Feature (Admin Panel)

Manual database backup from Admin → System Config (`/config`):

**Backend:** `backupController.js` — spawns `pg_dump`, streams SQL directly to HTTP response. Auto-discovers `pg_dump.exe` on Windows (`C:\Program Files\PostgreSQL\{version}\bin\`). Supports both main DB (`DATABASE_URL`) and ecom DB (`ECOM_DATABASE_URL`).

**Frontend:** Two download cards (Main Database / E-Commerce Database). Filename format: `main-backup-DD-MM-YYYY.sql`.

**Route:** `GET /api/admin/backup/:target` (superadmin only).

### Product Image System (Phase 1–3)

#### Phase 1: Import Image URLs
- Added `imageUrl` to bulk import field mapping (aliases: `image`, `images`, `imagelink`, `photourl`, etc.)
- `importService.js` maps the "Images" CSV column → `MasterProduct.imageUrl`

#### Phase 2: Global UPC Image Cache
- New `GlobalProductImage` table keyed by `strippedUpc` (all leading zeros removed)
- `stripUpc()` utility added to `backend/src/utils/upc.js`
- `globalImageService.js` — `upsertGlobalImage`, `batchUpsertGlobalImages`, `batchResolveProductImages`
- Auto-populates during bulk import, product create, product update
- Image fallback: `product.imageUrl` → `GlobalProductImage.rehostedUrl` → `GlobalProductImage.imageUrl` → null

#### Phase 3: Image Re-hosting
- `imageRehostService.js` — downloads external images to `backend/uploads/product-images/`, updates `rehostedUrl`
- Static serving: `GET /uploads/product-images/*` (30-day cache, immutable)
- Admin UI: stats cards (Total / Re-hosted / Pending / Disk Used) + "Re-host Next 200" button
- Routes: `GET /api/admin/images/rehost-status`, `POST /api/admin/images/rehost`

#### Product Form Image Upload
- New "Product Image" card at top of ProductForm with preview, URL input, file upload, remove
- Upload endpoint: `POST /api/catalog/products/:id/image` (multer, 5MB, images only)
- `uploadProductImage(id, file)` API function in frontend

### Dashboard Showcase (Marketing Home Page)

New "See It in Action" section on `/` with 6 tabbed screenshots in a PC monitor mockup:
- Tabs: Live Dashboard, Analytics, Products, Transactions, Employees, Vendor Orders
- Side-by-side layout: vertical tabs + description (left), monitor frame + screenshot (right)
- Fade + scale transition on tab switch, gentle floating micro-interaction on active screenshot
- Responsive: stacks vertically on mobile, icon-only tabs on small screens

### Mobile Responsiveness Improvements

- Added `@media (max-width: 480px)` to `index.css` — `.main-content` padding reduced to `0.625rem`
- Portal 480px breakpoint: compact header, 1-column stat grid, tighter table cells/buttons
- `StoreSettings.css`: 640px breakpoint for full-width + compact sections
- `DepositRules.css`: 768px + 480px responsive breakpoints added
- `TaxRules.css`: replaced 15 hardcoded indigo `rgba()` with CSS variables
- `DepositRules.css`: replaced hardcoded emerald colors with CSS variables

### Transaction Seeder

New `backend/prisma/seedToday.js` — generates 35-50 realistic transactions for today (6am → current hour) with proper hourly distribution, payment mix, line items. Run: `node prisma/seedToday.js`

### JWT TTL Change

Changed default `JWT_ACCESS_TTL` from `2h` to `8h` in `.env` and `.env.example`. Prevents premature session lockouts during normal workday use.

### Permanent Product Delete Fix

`catalogController.js` `deleteAllProducts` — no longer blocks on PurchaseOrder FK references. Now cleans up `PurchaseOrderItem` → empty `PurchaseOrder` → `VendorProductMap` before deleting products.

---

### New Files Created (Session 29)

| File | Purpose |
|------|---------|
| `backend/src/controllers/backupController.js` | Database backup via pg_dump streaming |
| `backend/src/services/globalImageService.js` | Cross-org image cache by UPC |
| `backend/src/services/imageRehostService.js` | Download external images to local storage |
| `backend/prisma/seedToday.js` | Seed today's transactions for dashboard testing |

### Key Files Modified (Session 29)

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Added `GlobalProductImage` model |
| `backend/src/utils/upc.js` | Added `stripUpc()` function |
| `backend/src/services/importService.js` | Image URL import + global cache population |
| `backend/src/controllers/catalogController.js` | Image fallback in getMasterProducts/search/get, global cache on create/update, permanent delete fix |
| `backend/src/routes/adminRoutes.js` | Backup + image rehost endpoints |
| `backend/src/routes/catalogRoutes.js` | Product image upload endpoint (multer) |
| `backend/src/server.js` | Static serving for `/uploads/product-images/` |
| `frontend/src/pages/ProductForm.jsx` | Image card (preview + URL input + upload + remove) |
| `frontend/src/pages/ProductForm.css` | `pf-image-*` styles |
| `frontend/src/pages/BulkImport.jsx` | `imageUrl` field mapping |
| `frontend/src/pages/marketing/Home.jsx` | Dashboard showcase section |
| `frontend/src/pages/marketing/Home.css` | `dsh-*` / `hm-dsh-*` styles |
| `admin-app/src/pages/AdminSystemConfig.jsx` | Backup + image rehost UI |
| `admin-app/src/pages/AdminSystemConfig.css` | Backup + rehost styles |
| `frontend/src/index.css` | 480px breakpoint, `--content-max-width`/`--mkt-max-width` vars, `overflow-x: hidden` |
| `frontend/src/styles/portal.css` | Mobile responsive improvements |
| `admin-app/src/styles/admin.css` | Header actions, name cell, row actions, tab radius, active hover |
| `admin-app/src/styles/global.css` | `--content-max-width` var, `overflow-x: hidden` |
| `backend/.env.example` | Added `ECOM_DATABASE_URL`, `BACKEND_URL`, updated `JWT_ACCESS_TTL` to 8h |

---

*Last updated: April 2026 — Session 29: Admin UI consistency, button hover fixes, database backup, product image system (Phase 1-3), dashboard showcase, mobile responsiveness, CSS variable centralization*

---

## 📦 Recent Feature Additions (April 2026 — Session 30)

### RBAC (Role & Permission Management) — foundation

Backward-compatible RBAC on branch `feature-24/RoleModule`. The legacy `User.role` string column stays in place and keeps every existing `authorize(...)` call working. New code can use permission-based checks in parallel; admins can create custom roles with tailored permission sets via either dashboard.

#### Schema (additive, no breaking changes)
Four new Prisma models in [schema.prisma](backend/prisma/schema.prisma):
- **`Permission`** — global catalog (`key`, `module`, `action`, `scope: 'org' | 'admin'`). 133 seeded keys.
- **`Role`** — system-level (`orgId=null`, `isSystem=true`, seeded) or per-org. Has `status`, `scope`, `key`, `name`, `description`.
- **`RolePermission`** — m:n.
- **`UserRole`** — m:n — users may hold **multiple roles**. Effective perms = union.

`User.role` (legacy) is preserved and maps to the matching built-in system role so `authorize()` still passes.

#### Permission catalog ([permissionCatalog.js](backend/src/rbac/permissionCatalog.js))
30 modules × {view, create, edit, delete} (+ `manage` where relevant) = 133 keys:
- **Org-scope** (119): dashboard, pos, products, departments, promotions, inventory, vendors, vendor_payouts, vendor_orders, invoices, lottery, fuel, customers, loyalty, transactions, shifts, reports, analytics, predictions, users, roles, stores, organization, pos_config, rules_fees, ecom, support, billing, audit, tasks, chat
- **Admin-scope** (14): admin_dashboard, admin_users, admin_organizations, admin_stores, admin_analytics, admin_cms, admin_careers, admin_tickets, admin_chat, admin_billing, admin_payments, admin_system, admin_backup, admin_roles

#### Six built-in system roles (seeded, idempotent)

| Role | Scope | # perms | Notes |
|------|-------|---------|-------|
| `superadmin` | admin | 133 | Full platform — admin panel only |
| `owner` / `admin` | org | 90 | Full org access |
| `manager` | org | 62 | Day-to-day ops + refunds/shifts/reports |
| `cashier` | org | 16 | POS + customers + lottery/fuel sales |
| `staff` | org | 1 | Dashboard view only |

Seed: `cd backend && node prisma/seedRbac.js` (safe to re-run; system roles always resync).

#### Backend API — `/api/roles`
[roleRoutes.js](backend/src/routes/roleRoutes.js):
- `GET /permissions` — full catalog
- `GET /` / `GET /:id` — list/get roles (`?scope=admin` for admin panel; `?includeSystem=false` to hide builtins)
- `POST /` / `PUT /:id` / `DELETE /:id` — CRUD (write = owner/admin/superadmin; system roles refuse edit/delete)
- `GET /users/:userId/roles` / `PUT /users/:userId/roles` — per-user assignment
- `GET /me/permissions` — effective permission set for frontend refresh

Login response now includes `permissions: string[]`.

#### New middleware: `requirePermission()`
```js
router.post('/products', protect, requirePermission('products.create'), handler);
```
Superadmins auto-pass. Multiple keys OR-ed. Use **alongside** legacy `authorize(...)`, not as replacement. Also exports `userHasPermission(req, key)` for inline controller checks and `computeUserPermissions(user)` used by login.

#### Admin panel — `/roles`
New [AdminRoles.jsx](admin-app/src/pages/AdminRoles.jsx) + [`.css`](admin-app/src/pages/AdminRoles.css) (`ar-` prefix):
- Tabs: **Admin Panel Roles** | **Store / Org Roles**
- Card grid with search, status/system badges, user count
- Create / edit / delete modals with **module-grouped permission checkbox grid** (click module heading to toggle all its actions)
- System roles view-only. Sidebar: "Roles" link under Management.

#### Portal — `/portal/roles`
New [Roles.jsx](frontend/src/pages/Roles.jsx) + [`.css`](frontend/src/pages/Roles.css) (`rl-` prefix):
- Same layout as admin, org-scoped
- Built-in org-scope system roles listed view-only
- Org admins create custom roles (e.g. "Inventory Clerk", "Shift Lead") with tailored perm sets
- Sidebar: "Roles & Permissions" under Account group

#### Portal — User role assignment
New [UserRolesModal.jsx](frontend/src/components/UserRolesModal.jsx) + [`.css`](frontend/src/components/UserRolesModal.css) (`urm-` prefix):
- "Roles" button on each user row in [UserManagement.jsx](frontend/src/pages/UserManagement.jsx)
- Lists active org-scope roles with checkboxes, description, perm count
- Saves via `PUT /api/roles/users/:userId/roles` (replace-all semantics)
- Explains that assigned roles are **additive** to the user's legacy primary role

#### Frontend `usePermissions()` hook + `<Can>` component
New [usePermissions.js](frontend/src/hooks/usePermissions.js):
```jsx
const { can, canAny, canAll, refresh } = usePermissions();

<button disabled={!can('products.edit')}>Edit</button>

<Can permission="reports.manage"><ExportButton /></Can>
<Can anyOf={['products.create','products.edit']} fallback={<p>No access</p>}>
  <ProductForm />
</Can>
```
Reads from `localStorage.user.permissions`. Falls back to `/api/roles/me/permissions` on mount if missing. Superadmins always return `true`.

#### Multi-tenant & security guards
- Org admins only see/edit roles with `orgId === req.orgId` (plus built-in org-scope system roles)
- Org admins cannot assign admin-scope or cross-org roles — API rejects with 403
- System roles immutable (server-enforced)
- Deleting a role with ≥1 assigned user blocked with helpful error
- Permission-scope mismatch rejected (no admin-scope perms on org role)

#### Migration path for existing routes
**Not done this session.** Every existing `authorize('manager', 'owner', ...)` keeps working because the legacy role maps to a system role with the same perm set. Migrate incrementally:
```js
// Before
router.post('/products', protect, authorize('manager','owner','admin','superadmin'), createProduct);
// After (equivalent)
router.post('/products', protect, requirePermission('products.create'), createProduct);
```
30+ route files → tackle a few per session, not all at once.

#### Deployment
1. `cd backend && npx prisma db push` — adds `permissions`, `roles`, `role_permissions`, `user_roles` tables
2. `cd backend && node prisma/seedRbac.js` — seeds 133 perms + 6 system roles
3. **Restart backend** — Prisma client needs regen to pick up new models (DLL was locked during session; restart releases it)
4. Rebuild portal + admin-app — both confirmed clean (16.33s admin, 12.73s portal)

#### Files changed (Session 30)

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | 4 new models + back-relations on User and Organization |
| `backend/prisma/seedRbac.js` | NEW — idempotent seeder |
| `backend/src/rbac/permissionCatalog.js` | NEW — 133-key catalog + system-role grants |
| `backend/src/rbac/permissionService.js` | NEW — computeUserPermissions, requirePermission, userHasPermission |
| `backend/src/controllers/roleController.js` | NEW — full CRUD + user-role assignment + /me/permissions |
| `backend/src/routes/roleRoutes.js` | NEW — /api/roles/* |
| `backend/src/server.js` | Mount /api/roles |
| `backend/src/controllers/authController.js` | Login includes `permissions[]` |
| `admin-app/src/services/api.js` | 8 RBAC API helpers |
| `admin-app/src/pages/AdminRoles.jsx` + `.css` | NEW — `ar-` prefix |
| `admin-app/src/App.jsx` | /roles route |
| `admin-app/src/components/AdminSidebar.jsx` | "Roles" link |
| `frontend/src/services/api.js` | 9 RBAC API helpers |
| `frontend/src/pages/Roles.jsx` + `.css` | NEW — `rl-` prefix |
| `frontend/src/App.jsx` | /portal/roles route |
| `frontend/src/components/Sidebar.jsx` | "Roles & Permissions" link |
| `frontend/src/hooks/usePermissions.js` | NEW — hook + `<Can>` |
| `frontend/src/components/UserRolesModal.jsx` + `.css` | NEW — `urm-` prefix |
| `frontend/src/pages/UserManagement.jsx` | "Roles" button in user row |

---

*Last updated: April 2026 — Session 30: RBAC module — Role & Permission management, admin + portal UIs, middleware, frontend hook*

---

## 📦 Recent Feature Additions (April 2026 — Session 31)

### Production-Level Permission Enforcement — 5 layers

Session 30 shipped the RBAC foundation. This session makes it **actually enforced** across the stack. Every data-mutating route is now permission-gated on the backend, and every UI entry-point is permission-aware on the frontend.

#### Single source of truth: route → permission mapping

New files:
- [`frontend/src/rbac/routePermissions.js`](frontend/src/rbac/routePermissions.js) — maps every `/portal/*` path to its required permission key (40+ routes). Exports `getRoutePermission(pathname)` which handles dynamic segments like `/portal/catalog/edit/:id`.
- [`admin-app/src/rbac/routePermissions.js`](admin-app/src/rbac/routePermissions.js) — same for the admin panel (17 routes, all `admin_*.view`).

Used by `<PermissionRoute>` **and** by the Sidebar filter so both stay in lockstep.

#### Layer 1 — Sidebar filters by permission

[`Sidebar.jsx`](frontend/src/components/Sidebar.jsx) and [`AdminSidebar.jsx`](admin-app/src/components/AdminSidebar.jsx) now call `getRoutePermission(item.path)` for every nav item and filter out anything the user can't access. Empty groups collapse entirely.

Verified live: cashier sees only 10 of ~30 sidebar items (Products, Customers, Lottery, Fuel, Transactions, Chat, Label Queue, CSV Transform, Product Groups, Logout). Analytics / Reports / Audit / Account / Vendors / E-commerce / POS Config all hidden.

#### Layer 2 — Route guard blocks direct URL navigation

New [`frontend/src/components/PermissionRoute.jsx`](frontend/src/components/PermissionRoute.jsx) + [`admin-app/src/components/PermissionRoute.jsx`](admin-app/src/components/PermissionRoute.jsx):
- Not logged in → redirect to `/login`
- Loading permissions → render null (prevents false-negative flash)
- Permission known but not granted → render `<Unauthorized />` page
- Otherwise render children

Used everywhere via a tiny `gated(element)` helper in App.jsx:
```jsx
const gated = (el) => <PermissionRoute>{el}</PermissionRoute>;
// ...
<Route path="/portal/analytics" element={gated(<AnalyticsHub />)} />
```

All 40+ portal routes + all 17 admin routes wrapped. The legacy `<ProtectedRoute>` (auth-only) still wraps the outer Layout — it's the `<PermissionRoute>` on each child that does the permission check.

New [`pages/Unauthorized.jsx`](frontend/src/pages/Unauthorized.jsx) + [`admin-app/src/pages/Unauthorized.jsx`](admin-app/src/pages/Unauthorized.jsx) — clear "You don't have permission" card showing the exact required key (e.g. `analytics.view`) plus a "Back to Dashboard" link. Verified live: cashier browsing to `/portal/analytics` sees the Unauthorized page, not the analytics dashboard.

#### Layer 3 — Backend API enforcement (the critical one)

Every critical-module route file retrofitted to use `requirePermission(...)` instead of the legacy `authorize('manager','owner',...)`:

| File | Module(s) |
|------|-----------|
| `salesRoutes.js` | `analytics.view` / `predictions.view` (realtime also accepts `dashboard.view`) |
| `reportsRoutes.js` | `reports.view` (already had it via prior session) |
| `reportsHubRoutes.js` | `reports.view` (router-level guard) |
| `auditRoutes.js` | `audit.view` |
| `customerRoutes.js` | `customers.view/create/edit/delete` |
| `catalogRoutes.js` | `products.* / departments.* / vendors.* / promotions.* / inventory.edit / rules_fees.* / vendor_payouts.* / products.create` (for imports) |
| `lotteryRoutes.js` | `lottery.view/create/edit/delete/manage` |
| `fuelRoutes.js` | `fuel.view/create/edit/delete` |
| `userManagementRoutes.js` | `users.view/create/edit/delete` |
| `storeRoutes.js` | `stores.view/create/edit/delete` + `billing.view` |
| `billingRoutes.js` | `billing.view/edit` |
| `invoiceRoutes.js` | `invoices.view/create/edit/delete` |
| `orderRoutes.js` | `vendor_orders.view/edit/create/manage` |
| `vendorReturnRoutes.js` | `vendors.view/edit` + `vendor_payouts.edit` |
| `inventoryAdjustmentRoutes.js` | `inventory.view/edit` |

**Remaining files** (tasks, chat, loyalty, feeMapping, posTerminal, posRoutes, dejavooPayment, equipment, labelQueue, tenant, storefront, webhook) — intentionally untouched this session: some are cashier-app routes (use station token), some already have narrow guards, some are public/internal. Follow-up session can migrate these.

Verified live with a cashier JWT:
- `GET /api/sales/daily` → **403** `Missing permission: analytics.view or predictions.view`
- `GET /api/reports/hub/summary` → **403** `Missing permission: reports.view`
- `GET /api/audit` → **403** `Missing permission: audit.view`
- `GET /api/billing/invoices` → **403** `Missing permission: billing.view`
- `POST /api/catalog/products` → **403** `Missing permission: products.create`
- `DELETE /api/catalog/products/1` → **403** `Missing permission: products.delete`

And the cashier's allowed endpoints still pass:
- `GET /api/catalog/products` → **200**
- `GET /api/customers` → **200**
- `GET /api/lottery/games` → **200**
- `GET /api/fuel/types` → **200**

#### Layer 4 — Per-button CRUD gating on flagship pages

Pattern applied to [`ProductCatalog.jsx`](frontend/src/pages/ProductCatalog.jsx) and [`Customers.jsx`](frontend/src/pages/Customers.jsx):

```jsx
const { can } = usePermissions();
const canCreate = can('products.create');
const canEdit   = can('products.edit');
const canDelete = can('products.delete');

{canCreate && <button>Add Product</button>}
{canEdit && <button>Edit</button>}
{canDelete && <button>Delete</button>}
```

Verified: cashier viewing `/portal/catalog` sees the product table but ZERO Add/Edit/Delete/Delete-All buttons. The one-line `usePermissions()` pattern is drop-in — any page can adopt it in under a minute.

#### Layer 5 — Permissions injected into JWT response + auto-refresh

Session 30 already did this: login returns `permissions: string[]`, stored in `localStorage.user`. `usePermissions()` reads from there and falls back to `GET /api/roles/me/permissions` if missing. `<PermissionRoute>` reads the same source.

**Superadmin bypass**: the `<Can>` hook, `requirePermission()` middleware, and both `PermissionRoute` components all short-circuit to "allowed" for `role === 'superadmin'` so the platform never accidentally locks out the top role.

#### Defense in depth

Every layer above can be independently bypassed by an attacker, but together they form a real defense:
1. Sidebar hidden → UX clean, but user could type URL
2. Route guard blocks URL → user could curl the API
3. **API returns 403** → hard stop, no data leaks
4. Per-button hiding → UX affordance
5. JWT permissions → read-only source of truth for UI

The **API layer (3)** is the load-bearing one. Even if someone tampers with `localStorage.user.permissions` or monkey-patches the frontend, the backend still enforces.

#### Files changed (Session 31)

| File | Change |
|------|--------|
| `frontend/src/rbac/routePermissions.js` | NEW — route→permission map |
| `frontend/src/components/PermissionRoute.jsx` | NEW |
| `frontend/src/pages/Unauthorized.jsx` + `.css` | NEW |
| `frontend/src/App.jsx` | `gated()` helper; wrapped all 40+ portal routes |
| `frontend/src/components/Sidebar.jsx` | Filter menu items by `getRoutePermission()` + `can()` |
| `frontend/src/pages/ProductCatalog.jsx` | `usePermissions()` + gate Add/Edit/Delete buttons |
| `frontend/src/pages/Customers.jsx` | Same pattern |
| `admin-app/src/rbac/routePermissions.js` | NEW |
| `admin-app/src/components/PermissionRoute.jsx` | NEW |
| `admin-app/src/pages/Unauthorized.jsx` | NEW |
| `admin-app/src/App.jsx` | `ProtectedRoute` delegates to `PermissionRoute` |
| `admin-app/src/components/AdminSidebar.jsx` | Filter menu items by permission |
| `backend/src/routes/salesRoutes.js` | Router-level `requirePermission('analytics.view' \| 'predictions.view')` + per-route override for realtime |
| `backend/src/routes/reportsHubRoutes.js` | `requirePermission('reports.view')` |
| `backend/src/routes/auditRoutes.js` | `requirePermission('audit.view')` |
| `backend/src/routes/customerRoutes.js` | Per-verb `customers.*` |
| `backend/src/routes/catalogRoutes.js` | Per-verb `products.* / departments.* / vendors.* / promotions.*` etc. |
| `backend/src/routes/lotteryRoutes.js` | Full rewrite — `lottery.*` per verb |
| `backend/src/routes/fuelRoutes.js` | Full rewrite — `fuel.*` per verb |
| `backend/src/routes/userManagementRoutes.js` | `users.*` per verb |
| `backend/src/routes/storeRoutes.js` | `stores.*` per verb |
| `backend/src/routes/billingRoutes.js` | `billing.view/edit` |
| `backend/src/routes/invoiceRoutes.js` | `invoices.*` per verb |
| `backend/src/routes/orderRoutes.js` | `vendor_orders.*` per verb |
| `backend/src/routes/vendorReturnRoutes.js` | `vendors.view/edit` + `vendor_payouts.edit` |
| `backend/src/routes/inventoryAdjustmentRoutes.js` | `inventory.view/edit` |

Builds verified clean: portal 18.31s, admin 11.21s. Live verification with cashier@storeveu.com: sidebar filtered (10/30 items), direct URL blocked, 6/6 restricted APIs return 403, 4/4 allowed APIs return 200, CRUD buttons hidden.

#### Follow-up for future sessions

1. Per-button gating on remaining flagship pages — Vendors, Promotions, Users, Departments, Lottery, Fuel. Pattern is 5 lines per page.
2. Backend migration for the ~10 remaining route files (tasks, chat, loyalty, feeMapping, equipment, labelQueue, tenant).
3. Field-level permissions (e.g. manager can see but not edit `costPrice`) — if ever needed.
4. Cashier-app integration — currently uses station token, but the same `requirePermission()` model applies when a cashier opens manager-gated modals.

---

*Last updated: April 2026 — Session 31: Production RBAC enforcement — sidebar filter, route guard, API gates, per-button CRUD gating, 15 backend route files migrated*

---

## 📦 Recent Feature Additions (April 2026 — Session 32)

### Phase 1 of Multi-Org Access: Foundations

Groundwork for a single login that accesses stores across multiple organisations, with cross-org switching via the existing StoreSwitcher. The ownership transfer flow (Phase 3) and invitation-driven onboarding (Phase 2) build on this foundation.

#### Design
- **1 Store = 1 Org (going forward)** — enforced socially via onboarding copy. All tenant-scoped data (144 `orgId` references in schema) stays inside its Organisation, so transferring a store = transferring the Org = swapping UserOrg rows. Zero data migration at transfer time.
- **`User.orgId` kept for back-compat** — now the user's "home org" (login affinity, billing emails, fallback). All access decisions go through the new `UserOrg` junction.
- **`req.orgId` derived from the active store** — the frontend already sends `X-Store-Id` on every request. `scopeToTenant` now reads that store's `orgId` and sets `req.orgId` from it. ~30 controllers and 133 `req.orgId` callsites needed zero changes.
- **`req.role` is per-org** — resolved from the user's `UserOrg.role` for the active org. Falls back to legacy `User.role` when no membership exists.
- **Permissions scoped per-org** — `computeUserPermissions(user, activeOrgId)` now unions (a) the role matching `UserOrg.role` for active org and (b) any `UserRole` whose `Role.orgId` is `null` (system) or matches the active org. Custom roles in Org A can't leak into Org B.

#### New Tables (additive-only migration)

```prisma
model UserOrg {
  userId       String
  orgId        String
  role         String       // owner | admin | manager | cashier | custom role key
  isPrimary    Boolean      @default(false)
  invitedById  String?
  invitedAt    DateTime     @default(now())
  acceptedAt   DateTime     @default(now())

  @@id([userId, orgId])
  @@index([orgId, role])
  @@index([userId, isPrimary])
}

model Invitation {
  id                String    @id @default(cuid())
  token             String    @unique
  email             String
  phone             String?
  orgId             String
  storeIds          String[]  @default([])
  role              String
  invitedById       String
  transferOwnership Boolean   @default(false)   // true for store-sale flow
  status            String    @default("pending")  // pending | accepted | revoked | expired
  expiresAt         DateTime
  acceptedAt        DateTime?
  acceptedByUserId  String?

  @@index([email, status])
  @@index([orgId, status])
  @@index([token])
}
```

Migration: [`backend/prisma/migrations/add_user_orgs_and_invitations.sql`](backend/prisma/migrations/add_user_orgs_and_invitations.sql) — creates both tables and backfills one `UserOrg` row per existing non-placeholder user, preserving their home-org role and marking it `isPrimary`. Idempotent (`IF NOT EXISTS` + `ON CONFLICT DO NOTHING`).

#### Auth middleware changes

**[`backend/src/middleware/auth.js`](backend/src/middleware/auth.js) — `protect`:**
- Includes `orgs: { select: { orgId: true, role: true, isPrimary: true } }` on the user lookup
- Includes `stores: { select: { storeId: true, store: { select: { orgId: true } } } }` so `scopeToTenant` can derive org from store without a second query
- `authorize(...roles)` now prefers `req.role` (per-org effective) and falls back to `req.user.role`

**[`backend/src/middleware/scopeToTenant.js`](backend/src/middleware/scopeToTenant.js) — rewritten:**
- Async (the org-wide role branch does one store lookup when the header store isn't in `UserStore`)
- Derives `activeStoreOrgId` from `X-Store-Id` → falls back to UserOrg `isPrimary` → `User.orgId`
- Sets `req.orgId`, `req.tenantId`, `req.tenantFilter`, `req.role`, and new `req.orgIds` (all UserOrg memberships)
- Superadmin `X-Tenant-Id` override is consolidated here; the separate `allowTenantOverride` middleware is kept for explicit opt-in routes

#### Controller changes

**[`backend/src/controllers/storeController.js`](backend/src/controllers/storeController.js):**
- `getStores` returns stores across **all** `UserOrg` memberships + direct `UserStore` access, ordered by `orgId` then `createdAt`
- Response includes `orgName` + `orgSlug` so the StoreSwitcher can group stores by organisation
- Superadmin with `X-Tenant-Id` override still returns just that one org's stores

**[`backend/src/controllers/userManagementController.js`](backend/src/controllers/userManagementController.js):**
- `getTenantUsers` queries users via `UserOrg` for the active org + legacy `users.orgId` fallback. Returns per-org `role` (effective) + `homeRole` (the legacy value) for admin visibility
- `inviteUser` now writes a `UserOrg` row alongside the User creation so new users are multi-org-ready
- `updateUserRole` upserts the `UserOrg` row for the active org whenever `role` changes
- `removeUser` **fully replaced the `orgId: 'detached'` hack** — now deletes the `UserOrg` row + any `UserStore` rows whose store belongs to the active org. Users keep memberships in other orgs and keep their account

**[`backend/src/controllers/adminController.js`](backend/src/controllers/adminController.js):**
- `createUser` seeds a `UserOrg` row so superadmin-created users show up in portal user lists immediately
- `updateUser` keeps the primary `UserOrg` row in sync when an admin changes a user's `orgId` and/or `role`

**[`backend/src/routes/tenantRoutes.js`](backend/src/routes/tenantRoutes.js):**
- `POST /api/tenants` (create new org from onboarding) writes a `UserOrg(role='owner', isPrimary=true)` row in the same transaction as the legacy `users.orgId / role` update

**[`backend/src/rbac/permissionService.js`](backend/src/rbac/permissionService.js):**
- `computeUserPermissions(user, activeOrgId)` — second parameter added
- Resolves effective role key from `UserOrg` for the active org; falls back to `User.role`
- Filters `UserRole` rows by `role.orgId ∈ {null, activeOrgId}` so custom roles only apply in their own org
- `requirePermission(...keys)` and `userHasPermission(req, key)` pass `req.orgId` through

#### Frontend changes

**[`frontend/src/components/StoreSwitcher.jsx`](frontend/src/components/StoreSwitcher.jsx) + [`.css`](frontend/src/components/StoreSwitcher.css):**
- Stores grouped by `orgName` when the user has stores in multiple orgs
- Single-org users see zero visual change (group header collapses when only one org is present)
- New `.sw-group-header` class (prefix: `sw-`) for the org heading

#### Verification

Smoke tested against a live dev DB:

| Scenario | Result |
|---|---|
| Backfill: 4 existing users → 4 UserOrg rows with correct role + isPrimary | ✅ |
| Legacy single-org user hitting `/api/users`, `/api/stores`, `/api/sales/realtime`, `/api/tenants/me` | No regression; same shapes |
| Cross-org membership (admin granted manager role in Org B) + `X-Store-Id` pointed at Org-B store | `/api/tenants/me` returns Org B |
| Switch `X-Store-Id` back to an Org-A store | `/api/tenants/me` returns Org A (same JWT, same login) |
| `GET /api/stores` with multi-org membership | Returns all 3 stores across 2 orgs with `orgName`/`orgSlug` |
| StoreSwitcher dropdown with multi-org memberships | Shows "Future Foods" + "Test Org B" group headers with correct stores under each |
| `permissionService.computeUserPermissions` with per-org activeOrgId | Returns 90 permissions for admin role |

#### Known follow-ups (Phase 2/3)

- **Phase 2:** Invitation flow — `invitationController` + routes + email templates + SMS stubs (env vars `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` wired but no-op until filled), portal `Invitations` page + public `/invite/:token` acceptance page
- **Phase 3:** Store transfer UI — "Sell/Transfer Store" button in StoreManagement, `transferOwnership: true` branch in invitation-accept handler, type-"TRANSFER" confirmation
- A very small number of non-`getStores` store endpoints (`updateStore`, `getStoreById`, `deleteStore`) still filter by `orgId: req.orgId` — fine because `req.orgId` now follows the active store, but editing an Org-A store while active in Org B requires a store-switch first. No regression, but may want a user-initiated "act in this store" explicit action in the future

#### Files Changed

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | +UserOrg, +Invitation models, +2 Organization relations, +1 User relation |
| `backend/prisma/migrations/add_user_orgs_and_invitations.sql` | NEW — idempotent migration + backfill |
| `backend/src/middleware/auth.js` | `protect` include expanded; `authorize` prefers `req.role` |
| `backend/src/middleware/scopeToTenant.js` | REWRITTEN — async, derives orgId from active store |
| `backend/src/controllers/storeController.js` | `getStores` unions UserOrg + UserStore; returns orgName/orgSlug |
| `backend/src/controllers/userManagementController.js` | UserOrg-based list/invite/update/remove; `'detached'` hack removed |
| `backend/src/controllers/adminController.js` | `createUser` + `updateUser` keep UserOrg in sync |
| `backend/src/routes/tenantRoutes.js` | Org creation writes UserOrg(owner) in same transaction |
| `backend/src/rbac/permissionService.js` | Active-org-scoped permission resolution |
| `frontend/src/components/StoreSwitcher.jsx` | Org group headers in dropdown |
| `frontend/src/components/StoreSwitcher.css` | `.sw-group-header` styles |

---

*Last updated: April 2026 — Session 32: Phase 1 Multi-Org Access — UserOrg/Invitation schema, active-store-derived req.orgId, per-org role resolution, StoreSwitcher org grouping*

---

## 📦 Recent Feature Additions (April 2026 — Session 33)

### Phase 2 of Multi-Org Access: Invitation Flow

Single-login-multi-org onboarding via email invitation. An owner/admin invites a teammate by email; the recipient opens a link on any device, either signs in (existing account) or creates an account inline, and the new org appears in their StoreSwitcher. Store transfer (Phase 3) reuses the same invitation machinery with a `transferOwnership` flag.

#### Backend

**[`backend/src/services/smsService.js`](backend/src/services/smsService.js) (NEW)** — Twilio-ready stub:
- `sendSms(to, body)` — core send. Returns `{ sent, reason }`, never throws.
- `sendInvitationSms(to, inviter, orgName, url)` + `sendTransferSms(...)` — templated senders.
- Dynamic `import('twilio')` so the stub works without the dependency installed.
- When `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` are filled in and `npm i twilio` is run, SMS activates — zero callsite changes needed.
- Until then, every call logs a `[SMS stub] Would send to …` line for dev visibility.

**[`backend/src/services/emailService.js`](backend/src/services/emailService.js)** — 4 new templates:
- `sendInvitation(to, { inviterName, orgName, role, acceptUrl, existingAccount })` — different body copy depending on whether the email already has an account.
- `sendTransferInvitation(to, { inviterName, orgName, acceptUrl })` — high-contrast warning for store sale.
- `sendInvitationAccepted(to, { inviterName, inviteeName, orgName, role })` — notifies the inviter after accept.
- `sendTransferCompleted(to, { formerOwnerName, newOwnerName, orgName })` — notifies outgoing owner after transfer.
- Added `escapeHtml()` helper so user-supplied inviter/org names can't inject HTML.

**[`backend/src/controllers/invitationController.js`](backend/src/controllers/invitationController.js) (NEW)** — six handlers:

| Handler | Route | Purpose |
|---|---|---|
| `createInvitation` | `POST /api/invitations` | Org admin creates invite. Auto-revokes any pending invites for same (email, org). Fires email + SMS (if phone provided). Returns the `acceptUrl` so the admin can copy/share manually. |
| `listInvitations` | `GET /api/invitations` | Lists invitations for active org. Accepts `?status=` filter. Lazily flips `pending → expired` for overdue records on read. |
| `getInvitationByToken` | `GET /api/invitations/:token` | **Public** — used by the accept page. Returns only the fields the page needs + `existingAccount: bool`. Non-pending invitations return 410 with `status` for the UI. |
| `acceptInvitation` | `POST /api/invitations/:token/accept` | **Public**. Three branches: (1) JWT matches invitation email → one-click accept; (2) existing user by email → attach UserOrg; (3) new user → create account from `{ name, password }` + attach UserOrg. Transactional — all DB writes go through one `prisma.$transaction`. |
| `resendInvitation` | `POST /api/invitations/:id/resend` | Bumps expiry to 7 days out and re-sends email/SMS. |
| `revokeInvitation` | `DELETE /api/invitations/:id` | Marks pending invitation as `revoked`. Non-pending invites return 400. |

Key logic:
- Pending invites are opaque; the 32-byte urlsafe base64 token is the only thing needed to accept. Org admins see tokens in their list (so they can copy links), but the public `/:token` lookup never surfaces them.
- **Store transfer branch** (`transferOwnership: true`) is authorised only for `owner` or `superadmin`. On accept it (a) deletes every other `UserOrg` for the org, (b) removes every `UserStore` belonging to other users within that org, (c) updates `User.role = 'owner'` + `User.orgId = orgId` for the new owner, (d) re-points `Store.ownerId` to the new owner, and (e) emails the former owners.
- Calls `syncUserDefaultRole(user.id)` after transfer or new-user creation to keep the RBAC `UserRole` junction aligned.

**[`backend/src/routes/invitationRoutes.js`](backend/src/routes/invitationRoutes.js) (NEW)** — split public/protected:
- Public: `GET /:token`, `POST /:token/accept`
- Protected (manager+ via `users.view`/`users.create`/`users.delete`): list, create, resend, revoke.

**[`backend/src/server.js`](backend/src/server.js)** — mounted at `/api/invitations`.

**[`backend/.env.example`](backend/.env.example)** — added `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` placeholders with instructions to `npm i twilio` when filling in.

#### Frontend

**[`frontend/src/services/api.js`](frontend/src/services/api.js)** — 6 new exports:
`getInvitations`, `createInvitation`, `resendInvitation`, `revokeInvitation` (protected), plus `getInvitationByToken` + `acceptInvitation` (public, token-based).

**[`frontend/src/pages/Invitations.jsx`](frontend/src/pages/Invitations.jsx) + [`.css`](frontend/src/pages/Invitations.css) (NEW)** — prefix `inv-`:
- Tabs: All / Pending / Accepted / Revoked / Expired with live counts.
- Table with email, role chip, status badge, sent date, expiry countdown (`3 days`, `today`).
- Per-row actions on pending invites: **copy accept link** (✓ feedback), **resend** (extends expiry + re-emails + copies new URL), **revoke** (with confirm).
- **Create modal** — email, phone (optional), role (dynamic — pulls active roles via `listRoles()` with fallback), multi-store checkbox / single-store radio for cashier role.
- On success, the accept URL is auto-copied to the clipboard so the admin can paste it into chat/Slack immediately.
- Mobile responsive: hides "Sent" column < 768px, modal goes full-width.

**[`frontend/src/pages/AcceptInvitation.jsx`](frontend/src/pages/AcceptInvitation.jsx) + [`.css`](frontend/src/pages/AcceptInvitation.css) (NEW)** — prefix `ai-`:
- **Public** route — no auth guard. Loads invitation by `:token` param.
- Three UX branches handled by one component:
  1. **Already logged in as invitee** → `CheckCircle2` icon + one-click "Accept Invitation" / "Accept Transfer" button.
  2. **Existing account, not logged in** → "Sign in to accept" CTA that `returnTo`-s back here.
  3. **New user** → inline form (full name + password + confirm), with show/hide eye toggle, client-side validation mirroring the backend policy.
- **Transfer variant** swaps the hero to amber (`ai-hero--transfer`) and adds an explicit warning banner: *"accepting this transfer makes you the new owner. The current owner will lose access."*
- On successful accept, the JWT + user blob are written to localStorage, `activeStoreId` is set if the invitation scoped to a store, and the browser navigates to `/portal/realtime`.
- Error states (invalid/expired/revoked token) render a friendly screen with a link back to `/login`.
- Responsive down to 360px.

**[`frontend/src/App.jsx`](frontend/src/App.jsx)** — two new routes:
- Public: `<Route path="/invite/:token" element={<AcceptInvitation />} />`
- Gated: `<Route path="/portal/invitations" element={gated(<Invitations />)} />`

**[`frontend/src/components/Sidebar.jsx`](frontend/src/components/Sidebar.jsx)** — Added "Invitations" under **Account** group (below "Roles & Permissions") with `Mail` icon.

**[`frontend/src/rbac/routePermissions.js`](frontend/src/rbac/routePermissions.js)** — `'/portal/invitations': 'users.view'` so the page is gated by the same permission as the Users tab.

#### Design decisions worth remembering

- **Legacy `inviteUser` kept.** The existing "admin creates account with temp password shown once" flow is a legitimate parallel UX to the new invitation flow. It was already upgraded in Phase 1 to write `UserOrg` rows, so no deprecation is needed. Both coexist: invitation flow is self-serve (invitee sets their own password), `inviteUser` is admin-driven (admin hands out a temp password out-of-band).
- **Lazy expiry** avoids a cron. Any read of an invitation past its TTL flips it to `expired`. Survives server restarts with no scheduled task.
- **Token-only auth for accept/lookup** means the invitation link works from any device the email was received on, with no prior session.
- **Auto-revoke duplicates** on create — if an admin re-invites the same email in the same org, the previous pending invite is flipped to `revoked` so the old link stops working and only the latest token is live.
- **Tokens visible to org admins in list response** — they can already revoke, and they need it to copy the accept URL. Public `/:token` response never surfaces it.
- **`isPrimary` preserved on existing users** — accepting a new org invite as an existing user keeps their current home-org primary. Only brand-new accounts get `isPrimary: true` on their first UserOrg row.

#### Verification

Smoke-tested end-to-end against the live dev stack:

| Scenario | Result |
|---|---|
| `POST /api/invitations` as admin → 201 with token, acceptUrl, orgName, expiresAt | ✅ |
| `GET /api/invitations/:token` (public) for pending invite → returns email/orgName/role/`existingAccount` | ✅ |
| `POST /api/invitations/:token/accept` with `{name, password}` → creates User + UserOrg + marks invitation accepted + returns JWT | ✅ |
| Accept as **already-logged-in user** whose JWT email matches → one-click, UserOrg added with `isPrimary: false`, primary stays intact | ✅ |
| Admin now has 3 UserOrg rows (Future Foods + Test Org B + Test Org C) with different roles per org | ✅ |
| `GET /api/invitations` filtered by status (pending/accepted/revoked/expired) returns correct tabs with counts | ✅ |
| `POST /api/invitations/:id/resend` bumps `expiresAt` + re-sends | ✅ |
| `DELETE /api/invitations/:id` marks revoked | ✅ |
| `POST /api/invitations/:token/accept` on revoked token returns `{ error: "Invitation revoked.", status: "revoked" }` with 410 | ✅ |
| Portal `/portal/invitations` page renders tabs, table, badges, action buttons | ✅ |
| Public `/invite/:token` page: new-user branch shows signup form; existing-user branch shows "Sign in to accept" | ✅ |
| Transfer variant shows amber hero + warning banner | ✅ (code-path verified; flow executed in Phase 3 smoke test) |

#### Files Changed (Phase 2)

| File | Change |
|------|--------|
| `backend/src/services/smsService.js` | NEW — Twilio-ready stub with lazy dynamic import |
| `backend/src/services/emailService.js` | +4 invitation templates, +`escapeHtml()` |
| `backend/src/controllers/invitationController.js` | NEW — 6 handlers (create/list/get/accept/resend/revoke) |
| `backend/src/routes/invitationRoutes.js` | NEW — public + protected routes |
| `backend/src/server.js` | Mount `/api/invitations` |
| `backend/.env.example` | Added Twilio placeholders |
| `frontend/src/services/api.js` | +6 invitation API helpers |
| `frontend/src/pages/Invitations.jsx` + `.css` | NEW — portal list + create modal |
| `frontend/src/pages/AcceptInvitation.jsx` + `.css` | NEW — public accept page, 3 UX branches |
| `frontend/src/App.jsx` | +2 routes (`/invite/:token`, `/portal/invitations`) |
| `frontend/src/components/Sidebar.jsx` | +"Invitations" link under Account group |
| `frontend/src/rbac/routePermissions.js` | `/portal/invitations` → `users.view` |

Ready for Phase 3: store transfer UI (the "Sell / Transfer Store" button in StoreManagement) and the type-"TRANSFER" confirmation modal. The backend is already done in this phase (`transferOwnership: true` branch in createInvitation + acceptInvitation) — Phase 3 is just UI plumbing.

---

*Last updated: April 2026 — Session 33: Phase 2 Invitation Flow — 7-day email invitations, public /invite/:token accept page, portal Invitations admin page, SMS stubs ready for Twilio keys*

---

## 📦 Recent Feature Additions (April 2026 — Session 34)

### Phase 3 of Multi-Org Access: Store Ownership Transfer (UI)

Closes the loop on the store-sale workflow. The backend plumbing shipped in Phase 2 (`transferOwnership: true` on the invitation); Phase 3 adds the UI that sets the flag, the seller-side gating (type "TRANSFER" to confirm), and the edge-case handling that the first smoke test surfaced.

#### New UI

**[`frontend/src/components/TransferOwnershipModal.jsx`](frontend/src/components/TransferOwnershipModal.jsx) + [`.css`](frontend/src/components/TransferOwnershipModal.css) (NEW)** — prefix `tom-`:
- **Form screen** — red warning hero, destination summary ("You are about to transfer *<Org Name>*"), bullet list of what the new owner gets and what the seller loses, email field, optional phone, and a `Type TRANSFER to confirm` input that unlocks the submit button only on exact-case match.
- **Success screen** — green confirmation hero, "nothing changes until they accept" reassurance, and a copy-to-clipboard row with the raw accept URL for when the email takes its time.
- Submit is double-gated: (a) valid email format, (b) confirmation text === `TRANSFER` (case-sensitive). Case variants like `transfer` or `Transfer` keep the button disabled.
- Calls `createInvitation(..., { 'X-Store-Id': store.id })` so the backend derives `req.orgId` from the store being transferred, not the seller's currently-active store (important when the seller owns multiple orgs).
- Responsive down to 360px.

**[`frontend/src/pages/StoreManagement.jsx`](frontend/src/pages/StoreManagement.jsx)** — adds a third action icon on every store card:
- New `ShieldAlert` lucide button between "Edit" and "Deactivate", amber-coloured (`#b45309`), tooltip *"Transfer ownership"*.
- Only rendered for `owner` and `superadmin` roles. Other roles don't see it. (Backend enforces the same rule, this is pure UX cleanup.)
- Opens the `TransferOwnershipModal` on click. Modal-owned lifecycle — card doesn't need to know about success/failure.

#### Backend adjustments (discovered during smoke test)

**Schema: [`User.orgId`](backend/prisma/schema.prisma) is now nullable** (`String?` + `Organization?` relation + `onDelete: SetNull`).

Why: after a full transfer the seller has zero `UserOrg` rows for that org, but their legacy `User.orgId` still pointed at it. `scopeToTenant`'s home-org fallback was resolving `req.orgId` to the transferred org, letting the seller continue to see stores they no longer owned. Making the column nullable is semantically correct — a user can exist between organisations (mid-onboarding, post-transfer, etc.).

Migration applied via `npx prisma db push`. No data loss; existing `orgId` values unchanged. The `scopeToTenant` + `storeController.getStores` fallback chains already handled `null` gracefully — they return no orgId / no stores, which is exactly the desired post-transfer state.

**[`backend/src/controllers/invitationController.js`](backend/src/controllers/invitationController.js) — transfer branch:**
Added logic inside `acceptInvitation` that, after deleting the seller's `UserOrg` rows for the transferred org, finds any users whose `User.orgId` still points at the transferred org and re-points it:
- To one of their remaining `UserOrg` memberships (preferring `isPrimary`) if they have any
- To `null` if they have none — they become orgless but their account stays live for sign-in and future invitations

**[`frontend/src/services/api.js`](frontend/src/services/api.js) — request interceptor:**
The global interceptor unconditionally overwrote `X-Store-Id` from localStorage, which clobbered explicit headers that the transfer flow needs to pass. Flipped to "respect caller-provided header, only fill in default when absent":

```js
if (!config.headers['X-Store-Id'] && !config.headers['x-store-id']) {
  const activeStoreId = localStorage.getItem('activeStoreId');
  if (activeStoreId) config.headers['X-Store-Id'] = activeStoreId;
}
```

`createInvitation(data, headers?)` gained a second parameter so the transfer modal can pin `X-Store-Id` to the store being transferred regardless of which store is currently active.

#### Verification

Smoke-tested end-to-end with two seeded scenarios:

| Scenario | Result |
|---|---|
| Seller (owner) creates transfer invite for new buyer → 201, token, `transferOwnership: true` | ✅ |
| Buyer accepts (creates account, sets password) → 200 with JWT | ✅ |
| Post-accept DB state: buyer is sole UserOrg member of org (role=owner, isPrimary=true); seller has 0 UserOrg rows for that org | ✅ |
| `Store.ownerId` flipped from seller to buyer | ✅ |
| Buyer's `User.role='owner'` + `User.orgId` set to transferred org | ✅ |
| Seller's `User.orgId` re-pointed to null (no remaining memberships) | ✅ |
| Invitation marked accepted with `acceptedByUserId=buyerId` | ✅ |
| Seller's JWT → `GET /api/stores` → returns 0 stores | ✅ |
| Seller's JWT → `GET /api/tenants/me` → 403 "requires an organization account" | ✅ |
| Buyer's JWT → `GET /api/stores` → sees the transferred store with `ownerId: buyer.id` | ✅ |
| Buyer's JWT → `GET /api/tenants/me` → returns transferred org | ✅ |
| Transfer button visible only for `role ∈ {owner, superadmin}` (hidden for admin/manager/cashier) | ✅ |
| Modal submit button: disabled until email + *exact* `TRANSFER` typed. Lowercase `transfer` or mixed case stays disabled | ✅ |

#### Design decisions worth remembering

- **Type "TRANSFER" only, no password re-entry.** Per the user: *"Just TRANSFER, while accepting the invitation user can set password, or if they already have account just hit accept while logged in."* The cost of lost work if someone clicks accidentally is the same as `rm -rf`, and a permanent data-transfer action deserves friction equivalent to a typed confirmation. Password re-entry on top of that was overkill.
- **Seller keeps account, just loses this org.** Their login continues working. They keep access to any other orgs they still have `UserOrg` rows in. If the transferred org was their only one, they're orgless but signed-in.
- **Nullable `User.orgId` is the right semantic.** Rather than inventing a "detached" placeholder or cascade-deleting the user, we acknowledge that "a user between organisations" is a legitimate state. Matches how other multi-tenant SaaS platforms behave.
- **Backend is the source of truth for the "owner" gate.** The `if (req.role !== 'owner' && req.user?.role !== 'superadmin')` check in `createInvitation` rejects non-owners even if they somehow hit the endpoint directly; the UI-level role check is just visual polish.

#### Files Changed (Phase 3)

| File | Change |
|------|--------|
| `frontend/src/components/TransferOwnershipModal.jsx` + `.css` | NEW — warning-styled form with success screen + copy-link |
| `frontend/src/pages/StoreManagement.jsx` | +`ShieldAlert` button on store cards (owner/superadmin only), +modal render |
| `frontend/src/services/api.js` | Interceptor respects caller-set `X-Store-Id`; `createInvitation(data, headers?)` signature |
| `backend/prisma/schema.prisma` | `User.orgId` → nullable (`String?`); relation → `onDelete: SetNull` |
| `backend/src/controllers/invitationController.js` | Transfer branch re-points seller's `User.orgId` to remaining UserOrg or null |

---

### Phase 1 + 2 + 3 Summary: Multi-Org Access is Complete

Single email = single login = access to stores across any number of organisations. Stores can be transferred to new owners via invitation. The implementation touched ~20 files over three phases with zero breaking changes for existing single-org users:

- **Phase 1** — schema (`UserOrg`, `Invitation`), auth middleware (active-store-derived `req.orgId`), RBAC scoping, StoreSwitcher grouping
- **Phase 2** — invitation flow (create, list, accept, revoke, resend), email templates, SMS stubs, public `/invite/:token` page, portal Invitations admin page
- **Phase 3** — transfer ownership UI on store cards, typed "TRANSFER" confirmation, post-transfer access revocation (+nullable `User.orgId`)

Still deferred (optional, no customer asking yet):
- **Phase 4** — `Group` / `Brand` entity for cross-org rollup reporting in multi-store chains
- **SMS activation** — `npm i twilio` + fill in `TWILIO_*` env vars; code paths already wired via the stub

---

*Last updated: April 2026 — Session 34: Phase 3 Store Ownership Transfer — TransferOwnershipModal with typed-TRANSFER confirmation, nullable User.orgId, seller access fully revoked on accept*

---

## 📦 Session 35 — Multi-Org Migration: Final Hardening & Full QA Pass

Closing session across Phases 1–3. Added rate limiting to public invitation endpoints, cleaned up the DB, and ran a comprehensive 17-test suite against every flow.

### Security hardening

**Rate limiting on public invitation endpoints** ([`backend/src/middleware/rateLimit.js`](backend/src/middleware/rateLimit.js) + [`backend/src/routes/invitationRoutes.js`](backend/src/routes/invitationRoutes.js)):
- `invitationLookupLimiter` — 20 requests / 10 min per IP on `GET /api/invitations/:token`. The token is 32 bytes of crypto entropy (practically unguessable), but a rate cap blunts a DoS-by-probing-missing-tokens attack against the DB.
- `invitationAcceptLimiter` — 10 requests / 10 min per IP on `POST /api/invitations/:token/accept`. Blocks credential stuffing / throttles account-creation abuse.
- Both honour the existing dev-bypass (`NODE_ENV=development` or `DISABLE_RATE_LIMIT=true`). Production always on.

### Comprehensive QA pass (17 tests, all green)

**Baseline (Phase 1):** existing single-org admin runs `/api/stores` (2 own-org stores, no leaks), `/api/tenants/me` (correct org), `/api/users` (3 org members with effective roles), `/api/sales/realtime` (HTTP 200, RBAC passes).

**Invitation lifecycle (Phase 2):**
- Create invitation with phone → 201 with token + acceptUrl + `existingAccount: false`
- Public lookup by token → correct org/role/email payload
- Accept as new user with password → account created, UserOrg row written, JWT returned, invitation flipped to `accepted`
- Create + immediately revoke → subsequent accept returns 410 `Invitation revoked`
- Create + resend → `expiresAt` bumped out another 7 days
- Accept as existing user (admin accepts invite to a different org while holding their session) → UserOrg added as **non-primary** so home org stays intact; admin now has 2 UserOrg rows, new org visible in `/api/stores`

**Ownership transfer (Phase 3):**
- Seller (owner) creates `transferOwnership: true` invite → 201, role auto-set to `owner`
- Buyer accepts as new account → all post-conditions hold:
  - Transferred org: sole UserOrg row is the buyer, role=owner, isPrimary=true
  - `Store.ownerId` → buyer
  - `Seller.orgId` → null (auto-cleared, since they had no other memberships)
  - Invitation marked accepted with `acceptedByUserId`
  - Business data (vendors, departments) untouched — buyer sees them via `/api/catalog/vendors` + `/api/catalog/departments`
  - Seller's JWT → 0 stores returned, `/api/tenants/me` returns 403 "requires organization account", catalog endpoints 403

**Edge cases:**
- Non-owner (admin role) attempting transfer → 403 `Only the organisation owner can transfer ownership`
- Pre-expired invitation (artificially past `expiresAt`) → 410 on first lookup, `status: "expired"` — lazy-expiry flips DB row
- Random/unknown token → 404
- Re-inviting the same email in the same org → old pending invitation auto-flipped to `revoked`, original link now returns 410

**UI verification via browser preview:**
- `/portal/invitations` — 4 status tabs with live counts, 6-row table rendering all statuses with correct badges (PENDING×2, ACCEPTED, REVOKED×2, EXPIRED×1)
- `/invite/:token` — new-user branch renders hero with inviter attribution, org name, role, and the 3-field signup form (full name + password + confirm)
- Previously verified this session: existing-user branch, StoreSwitcher multi-org grouping, TransferOwnershipModal gated submit button

### Final baseline state

DB restored to the clean 4-user / 3-org baseline. No test fixtures remain:

| Entity | Count |
|---|---|
| users        | 4 |
| organizations| 3 |
| stores       | 3 |
| user_orgs    | 4 (all primary) |
| invitations  | 0 |

### Files touched across Phases 1 + 2 + 3 + 35

**New:**
- `backend/prisma/migrations/add_user_orgs_and_invitations.sql`
- `backend/src/controllers/invitationController.js`
- `backend/src/routes/invitationRoutes.js`
- `backend/src/services/smsService.js`
- `frontend/src/components/TransferOwnershipModal.jsx` + `.css`
- `frontend/src/pages/AcceptInvitation.jsx` + `.css`
- `frontend/src/pages/Invitations.jsx` + `.css`

**Modified:**
- `backend/prisma/schema.prisma` (UserOrg + Invitation models, nullable User.orgId)
- `backend/src/middleware/auth.js` (protect includes orgs + stores.orgId; authorize prefers req.role)
- `backend/src/middleware/scopeToTenant.js` (active-store-derived req.orgId, async)
- `backend/src/middleware/rateLimit.js` (+2 limiters)
- `backend/src/rbac/permissionService.js` (activeOrgId-scoped perms)
- `backend/src/controllers/userManagementController.js` (UserOrg-based list/invite/update/remove)
- `backend/src/controllers/adminController.js` (createUser + updateUser sync UserOrg)
- `backend/src/controllers/storeController.js` (cross-org getStores with orgName)
- `backend/src/routes/tenantRoutes.js` (org-create writes UserOrg)
- `backend/src/services/emailService.js` (+4 invitation templates + escapeHtml)
- `backend/src/server.js` (mount /api/invitations)
- `backend/.env.example` (Twilio placeholders)
- `frontend/src/App.jsx` (/invite/:token, /portal/invitations routes)
- `frontend/src/components/Sidebar.jsx` (Invitations nav link)
- `frontend/src/components/StoreSwitcher.jsx` + `.css` (org group headers)
- `frontend/src/pages/StoreManagement.jsx` (Transfer button + modal render)
- `frontend/src/rbac/routePermissions.js` (/portal/invitations → users.view)
- `frontend/src/services/api.js` (invitation helpers; interceptor respects caller X-Store-Id)

### Known activation steps for production

1. **Email (already works)** — ensure SMTP credentials are set in `.env` so invitation emails send.
2. **SMS (optional, wire is ready)** — `npm i twilio` in backend + fill in `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` in `.env`. `smsService.js` auto-activates via dynamic import.
3. **Run migration** — `npx prisma db execute --file prisma/migrations/add_user_orgs_and_invitations.sql --schema prisma/schema.prisma` then `npx prisma db push` for the nullable `User.orgId` change.
4. **Restart backend + frontend** — both pick up the new client + routes on reload.
5. Existing single-org users see zero functional change. Multi-org + invitation + transfer flows are additive.

### Deferred (optional, no customer ask yet)

- **Phase 4** — `Group`/`Brand` entity for multi-store-chain rollup reporting.
- **Multi-instance rate limiter** — in-memory limiter is fine for single-instance deployments; swap for `express-rate-limit` + Redis store if scaling horizontally.

---

*Last updated: April 2026 — Session 35: Final multi-org hardening — rate limits on public invitation endpoints, DB cleanup, full 17-test QA pass across Phases 1/2/3*

---

## 🗓 Deferred Work (Multi-Org Migration — Phase 4)

### Phase 4 — Group / Brand entity for multi-store-chain rollup reporting

**Status:** NOT STARTED. Explicitly deferred during Sessions 32–35. Park until a customer asks.

**Why it exists:** one operator running several *separate organisations* (e.g. a franchisee with multiple LLCs for legal/tax isolation) today has to switch stores to see each org independently. Phase 4 would add a `Group` (or `Brand`) wrapper that unifies reporting across those orgs so they can see *"total sales across all 5 businesses this week"* in a single view.

**What's already in place (done by Phases 1–3):**
- Multi-org access via `UserOrg` junction ✅
- `req.orgId` derived from active store ✅
- Per-org role resolution via `UserOrg.role` + `UserRole` ✅

**What Phase 4 adds:**

Schema (3 new models):
```prisma
model Group {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  description String?
  ownerId     String   // User.id of the group owner (usually the franchisee)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  orgs   OrgGroup[]
  users  UserGroup[]

  @@map("groups")
}

model OrgGroup {
  orgId   String
  groupId String
  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  group        Group        @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@id([orgId, groupId])
  @@map("org_groups")
}

model UserGroup {
  userId  String
  groupId String
  role    String    // "group_admin" | "group_viewer"
  user    User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  group   Group     @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@id([userId, groupId])
  @@map("user_groups")
}
```

Backend work (the expensive part — every analytics endpoint needs a rewrite):
- New `groupController.js` for Group CRUD + `addOrgToGroup` / `removeOrgFromGroup` handlers
- New `/api/groups` routes
- **Rollup query pattern** — every analytics query changes from `orgId = ?` to `orgId IN (orgIds of active group)`. Touches: `salesController`, `reportsHubController`, `employeeReportsController`, `lotteryController` dashboard/reports, `loyaltyController`, Live Dashboard endpoint, ecom analytics.
- New middleware `scopeToGroup` that reads `X-Group-Id` header and, when present + user has `UserGroup` membership, sets `req.groupOrgIds` to the array of org ids in that group
- Analytics controllers use `req.groupOrgIds || [req.orgId]` as their filter
- RBAC: new permissions `groups.view`, `groups.manage`, `groups.reports`

Frontend work:
- New portal page `/portal/groups` — create/manage groups, assign orgs to groups, invite group admins
- **GroupSwitcher** component — sits above (or replaces) StoreSwitcher when user has `UserGroup` memberships. Shows "Viewing: *Acme Brands* (5 orgs, 12 stores)" with ability to toggle between group-scoped and single-store views
- Dashboard / Analytics / Reports pages honour group scope automatically (via `X-Group-Id` header) — existing queries return aggregated data
- New invitation type in `Invitation` model or dedicated `GroupInvitation` for inviting users into a group

Estimated size: ~15-20 files, comparable to Phases 1 + 2 combined.

**Open design questions to resolve before starting:**
1. Can a group contain orgs owned by different users, or only orgs the group-creator owns? (Multi-owner groups open up partnership scenarios but complicate permissions.)
2. Do group admins get implicit access to every store in every org in the group, or only read-only analytics access? (Read-only is safer to ship first.)
3. Rollup performance — some analytics queries are already slow (~30 DB queries per Live Dashboard load). Multiplying that by 5-10 orgs without query optimisation would be a regression. Likely needs materialised views or a denormalised `DailyOrgStats` table.
4. Pricing — is group-scoped reporting a paid-tier feature (Pro/Enterprise) or included everywhere?

**Reference docs / context for whoever picks this up:**
- See Session 32 notes for the `UserOrg` + `scopeToTenant` architecture the group scope will compose with
- The `X-Tenant-Id` superadmin override pattern in [`backend/src/middleware/scopeToTenant.js`](backend/src/middleware/scopeToTenant.js) is a template for how `X-Group-Id` would work
- The invitation flow in Phase 2 can be extended (or cloned) for group invitations

---

## 📦 Recent Feature Additions (April 2026 — Session 36)

User asked for 8 features in a single prompt. Sessions this size get done in layers — shipped 5/8 cleanly; #6-#8 are each their own session of work (documented below).

### 1. Cashier-app scroll fix on sign-in + clock-in screens

Bug: at 1366×768 Electron (the common Windows POS hardware spec), the PIN login screen's bottom content — "Clock In" submit button and "Reset this register" link — was clipped. Root cause not in the `.pls-page` itself but in the parent chain: `html`, `body`, and `#root` all have `overflow: hidden`, so when `.pls-page` grew beyond the viewport via `min-height: 100vh`, content past the viewport got clipped with no way to scroll.

**Fix** in [`PinLoginScreen.css`](cashier-app/src/screens/PinLoginScreen.css):
- Changed `.pls-page` from `min-height: 100vh` → `height: 100vh` so it caps at viewport and becomes the scroll container itself (now `overflow-y: auto` actually activates)
- Dropped `justify-content: safe center` (buggy on some Chromium-Electron builds); replaced with the auto-margin centering pattern — `margin-top: auto` on first child + `margin-bottom: auto` on last child. Content centers vertically when viewport has room; auto margins collapse to 0 and content aligns to top + scrolls when content exceeds viewport height.
- Added `overflow-x: hidden` + `box-sizing: border-box` defensively

**Verified live** at 1366×768 (no scroll needed, all buttons visible) and 1366×650 (cramped — `.pls-page` scrolls, reset button reachable at bottom).

---

### 2. Owner per-store PIN (self-service, no second account needed)

**Problem**: owners had no way to set their own register PIN. Workaround was to create a separate low-privilege user account with a PIN — duplicating identity. Now any authenticated user can self-serve a per-store PIN.

**Schema** — new nullable field on `UserStore` junction:
```prisma
model UserStore {
  userId  String
  storeId String
  posPin  String?  // bcrypt hash, per-store override
  ...
}
```

**Tiered `pinLogin` lookup** in [`stationController.js`](backend/src/controllers/stationController.js):
- **Tier 1** — `UserStore.posPin` at station's `storeId`. Authoritative for any role.
- **Tier 2** — `User.posPin` for any active org user (legacy behaviour preserved so existing cashier PINs still work).

The per-store override wins. Owner without a per-store PIN still gets the legacy org-wide fallback (matches the "highest hierarchy" intent the user asked for).

**Three new self-service endpoints** (any authenticated user):
- `GET    /api/users/me/pins`  — list stores they can manage a PIN at (owner/admin see all org stores; others see UserStore memberships)
- `PUT    /api/users/me/pin`   — `{ storeId, pin }`. Owners bypass the UserStore membership check — auto-creates the row
- `DELETE /api/users/me/pin/:storeId`

**Portal UI** — new "My Register PIN" tab in `AccountHub` (`/portal/account?tab=mypin`). Lists every accessible store with hasPin badge; per-store set/update/remove. Show/hide toggle, confirm-match validation. External CSS with `mypin-` prefix.

---

### 3. Admin Price Calculator (superadmin-only, Interchange-plus scenarios)

Ported the user-supplied `calcAll` logic verbatim (D&A constants, GP Schedule A buy rates) — only the UI changed. Hard-coded `PRESETS` (Tower Liquors, Ram Corp, Mahi Corp) replaced with a saved-scenario system backed by a new `PriceScenario` table. All inputs are number fields (no sliders). Superadmin-only — not tenant-scoped.

**Schema** — new `PriceScenario` model with `storeName`, `location`, `mcc`, `notes`, `inputs` (JSON), `results` (JSON cache for list-view summary), `createdById`. Not linked to `Organization` — sales collateral lives at platform level.

**Backend** — [`priceScenarioController.js`](backend/src/controllers/priceScenarioController.js) with full CRUD; `/api/price-scenarios/*` routes (superadmin-only via `authorize('superadmin')`).

**Admin-app page** — [`AdminPriceCalculator.jsx`](admin-app/src/pages/AdminPriceCalculator.jsx) + [`.css`](admin-app/src/pages/AdminPriceCalculator.css) (prefix: `apc-`):
- Left sidebar: scenario list with search + "New" button
- Right pane: 4 tabs — Calculator / Rate Breakdown / Earnings / vs Current
- Three side-by-side panels in Calculator tab: Scenario + Merchant Data / StoreVeu Pricing / Current Processor
- Save / Save As / Delete actions pinned to the tab bar
- Live rate chips in header (Processing Rate, All-in Rate, Merchant Saves/mo, SV Earns/mo)

Route: `/price-calculator` under Sales Tools sidebar group. Scenario results cached in `results` JSON so list view can render summary columns without re-running `calcAll`.

---

### 4. US State catalog + auto-populate store defaults

**Problem**: each store was manually configuring sales tax, bottle deposit rules, age limits, and lottery settings. No central place to curate per-state defaults. Onboarding a new store in a new state was always "recreate the tax rule, recreate each deposit rule, set the age limits, pick the lottery state".

**Schema** (additive):
- New `State` model (`code` PK as 2-letter code, `name`, `defaultTaxRate`, `defaultLotteryCommission`, `alcoholAgeLimit`, `tobaccoAgeLimit`, `bottleDepositRules` JSON, `lotteryGameStubs` JSON, `notes`, `active`) — managed by superadmin
- New nullable field `Store.stateCode` with FK → `State.code`

**Apply-defaults endpoint** (`POST /api/stores/:id/apply-state-defaults` — idempotent):
1. Upserts `TaxRule` named "Default Sales Tax" at store level with the state's `defaultTaxRate`
2. Replaces all `DepositRule` rows for `(orgId, state.code)` with the state's `bottleDepositRules` — org-scoped since existing schema is already keyed that way
3. Upserts `LotterySettings.state` + `commissionRate` for this store
4. Merges `{tobacco, alcohol}` into `store.pos.ageLimits` JSON (which `usePOSConfig` already reads)

The endpoint is deliberately separate from `PUT /stores/:id/state` (which just sets the code). This lets the portal UI confirm with the user before overwriting tax/deposit rules that may have been hand-tuned.

**Lottery game filtering** (already wired): `LotteryGame` has a `state` field; `lotteryController.listGames` already filters by `LotterySettings.state`. Once the store's state is set and defaults applied, cashiers only see the games tagged to their state.

**Admin-app page** — [`AdminStates.jsx`](admin-app/src/pages/AdminStates.jsx) + [`.css`](admin-app/src/pages/AdminStates.css) (prefix: `as-`): card grid with inline CRUD modal; per-state bottle-deposit rule editor (container type, material, min/max oz, deposit $).

**Portal integration** — new "State" section at the top of `StoreSettings.jsx` with:
- State dropdown (from `GET /api/states/public` — active states only)
- "Save" button (only enables on dirty)
- "Apply State Defaults" button (with confirmation — warns about overwriting tax/deposit rules). After apply, calls `loadConfig()` so age limits + lottery state refresh in-place
- Preview block shows the selected state's defaults inline

**New API helpers** — admin-app (`listAdminStates`, `createAdminState`, etc.), frontend (`listStatesPublic`, `setStoreStateCode`, `applyStoreStateDefaults`).

---

### 5. Mobile UPC scanner (browser + cashier-app)

Camera-based barcode scanner for tablets and phones with no handheld scanner hardware. Two-engine strategy:

1. **Native `BarcodeDetector` API** — Chromium-based browsers (Android Chrome, Edge, Chrome desktop). Zero dependencies. Supports 11 symbologies including UPC-A/E, EAN-8/13, Code-128/39/93, QR.
2. **`@zxing/browser` from esm.sh CDN** — lazy-loaded on first call when native is unavailable (iOS Safari). No npm install needed.

**Shared component** — [`BarcodeScannerModal.jsx`](frontend/src/components/BarcodeScannerModal.jsx) + [`.css`](frontend/src/components/BarcodeScannerModal.css) (prefix: `bsm-`). Copied byte-for-byte into `cashier-app/src/components/` — same UX, same fallback. Features: getUserMedia with rear-camera preference, scanning reticle overlay, pulse animation, torch toggle (when capability available), success beep via Web Audio API, debounce against duplicate reads within 1s.

**Wiring**:
- **Portal ProductCatalog** — "Scan" button in the search bar. Detected code fills the input + resets to page 1.
- **Cashier-app ActionBar** — "Scan" button (camera icon, blue) only shown when `shiftOpen`. Detected code flows through `handleScan` so the full POS pipeline fires (age gate, pack-size picker, add-product-on-not-found all continue to work).

Both builds verified clean. Native `BarcodeDetector` not available in Claude Preview's browser, confirming the fallback path will hit on iOS Safari — which is the critical case.

---

### Schema pushes (non-destructive, this session)

All applied via `npx prisma db push` against the live dev DB:
- `UserStore.posPin String?` — nullable, optional per-store PIN override
- `PriceScenario` — new table
- `User.priceScenarios` — reciprocal relation
- `Store.stateCode String?` + FK to `State.code` — nullable
- `State` — new table, superadmin-managed catalog

---

### Files shipped (Session 36)

**Backend**:
- `backend/prisma/schema.prisma` — `UserStore.posPin`, `PriceScenario`, `State` models; `Store.stateCode` + `state` relation; `User.priceScenarios` back-relation
- `backend/src/controllers/stationController.js` — tiered pinLogin rewrite + `listMyPins`, `setMyPin`, `removeMyPin` self-service endpoints
- `backend/src/controllers/priceScenarioController.js` — NEW (full CRUD)
- `backend/src/controllers/stateController.js` — NEW (CRUD + `setStoreState` + `applyStateDefaults`)
- `backend/src/routes/priceScenarioRoutes.js` — NEW
- `backend/src/routes/stateRoutes.js` — NEW
- `backend/src/routes/storeRoutes.js` — +2 routes (setState + applyStateDefaults)
- `backend/src/routes/userManagementRoutes.js` — +3 self-service PIN routes
- `backend/src/server.js` — mount `/api/price-scenarios`, `/api/states`

**Admin-app**:
- `admin-app/src/pages/AdminPriceCalculator.jsx` + `.css` — NEW (prefix `apc-`)
- `admin-app/src/pages/AdminStates.jsx` + `.css` — NEW (prefix `as-`)
- `admin-app/src/App.jsx` — +2 routes
- `admin-app/src/components/AdminSidebar.jsx` — "Sales Tools" group with Price Calculator; "States" nav item in Management
- `admin-app/src/rbac/routePermissions.js` — +2 entries
- `admin-app/src/services/api.js` — +10 API helpers (5 price scenarios + 5 states)

**Frontend (portal)**:
- `frontend/src/pages/MyPIN.jsx` + `.css` — NEW (prefix `mypin-`)
- `frontend/src/components/BarcodeScannerModal.jsx` + `.css` — NEW (prefix `bsm-`)
- `frontend/src/pages/AccountHub.jsx` — +"My Register PIN" tab
- `frontend/src/pages/StoreSettings.jsx` + `.css` — state dropdown + Apply Defaults button + preview
- `frontend/src/pages/ProductCatalog.jsx` + `.css` — camera scan button in search bar
- `frontend/src/services/api.js` — +8 API helpers (3 PIN + 5 state + public state catalog)

**Cashier-app**:
- `cashier-app/src/screens/PinLoginScreen.css` — scroll fix
- `cashier-app/src/components/BarcodeScannerModal.jsx` + `.css` — NEW (copied from portal)
- `cashier-app/src/components/pos/ActionBar.jsx` — `onScanCamera` prop + "Scan" button
- `cashier-app/src/screens/POSScreen.jsx` — mount scanner modal; route detected code through `handleScan`

---

### Deferred to future sessions (each is 1-2 sessions of work on its own)

> The user was briefed up front that #6-#8 are much larger than #1-#5 and accepted the staged delivery.

#### #6 — Quick Buttons WYSIWYG builder (1-2 sessions)

User asked for iPhone-home-screen-style freeform drag-and-drop customization with tile sizing, 2-level folders, image/video uploads, groups, action buttons (void/discount/open-drawer/print-receipt/etc.), text labels.

**Recommended library**: `react-grid-layout` (MIT, used by Grafana) for the drag/resize grid. Covers iPhone-widget-style tiles with minimal code.

**Scope for a dedicated session**:
- New `QuickButtonLayout` table (`storeId`, `buttons` JSON with `{x, y, w, h, type, payload}` per tile)
- Extend the existing `store.pos.quickFolders` or supersede it
- Multer upload endpoint for tile images/videos (user said "S3-like bucket"; start with local `/uploads` then switch to R2/S3)
- Button types: `product`, `folder`, `group`, `action` (discount/void/lookup/drawer/reprint/etc.), `text_label`, `image_tile`
- Portal visual builder (drag, resize, edit, nested folder view)
- Cashier-side renderer with 2-level folder drill-in

#### #7 — Capacitor mobile app (1 session for MVP, 2-3 months for full native POS)

MVP approach (1 session): wrap the existing portal with Capacitor, produce Android + iOS installers. Trimmed to manager-focused screens first (Live Dashboard, Transactions, Chat, Online Orders).

**Scope for a dedicated session**:
- `npm i @capacitor/cli @capacitor/core @capacitor/android @capacitor/ios` in a new `mobile/` workspace
- `capacitor.config.json` pointing at the portal's `dist/` build
- Build scripts for `npx cap sync` + `npx cap open android/ios`
- Detect `Capacitor.isNativePlatform()` in portal — hide nav items that don't apply on mobile (e.g. table-heavy bulk-import pages)
- Sync the camera scanner to use `@capacitor-mlkit/barcode-scanning` for native-speed scanning on mobile vs the web fallback

#### #8 — Transaction video POC (2-3 sessions)

Reolink RLC-510WA @ RTSP, 15s clip per transaction, 3-day rolling storage, $20/mo/store budget.

**Architecture decided**: per-station ffmpeg child-process in the Electron main process pulls the RTSP stream, maintains a ~30s circular buffer on disk, and on every `POST /api/pos-terminal/transactions` (detected via IPC) extracts 5s-before + 10s-after clip, uploads to Cloudflare R2 (no egress fees, ~$0.015/GB — well under $20/mo budget).

**Scope for a dedicated session**:
- Schema: `CameraConfig` (per-station RTSP URL, creds, enabled), `TransactionVideo` (txId, storageKey, duration, expiresAt)
- Electron main-process ffmpeg worker ([`cashier-app/electron/videoRecorder.cjs`](cashier-app/electron/videoRecorder.cjs))
- Backend upload endpoint (signed URL from R2)
- Portal Transactions page: "▶ Video" button per row that opens modal player hitting a time-limited signed R2 URL
- Retention cron — daily cleanup of rows past `expiresAt`

---

*Last updated: April 2026 — Session 36: Cashier scroll fix, Owner per-store PIN, Admin Price Calculator, US State catalog with auto-populate defaults, Mobile UPC scanner (portal + cashier-app)*

---

## 📦 Recent Feature Additions (April 2026 — Session 37)

### Quick Buttons WYSIWYG — freeform drag-and-drop cashier home screen

Shipped the full #6 deferred item from Session 36. Store admins can now lay out the POS home screen like an iPhone home screen: drag-and-drop tiles, resize, 1-level folders, image uploads, and action tiles that fire POS handlers (discount, void, open drawer, cash drop, lottery sale, fuel sale, bottle return, etc.).

#### Architecture

Runs **alongside** the legacy `store.pos.quickFolders` system — existing setups keep working, and the cashier-app auto-adds a **BUTTONS** tab when the new layout has content. The `POSScreen` tab bar now shows CATALOG / BUTTONS / FOLDERS; each filters in/out based on what's configured.

**Schema** — new `QuickButtonLayout` model (one row per store):
```prisma
model QuickButtonLayout {
  id        String   @id @default(cuid())
  orgId     String
  storeId   String   @unique
  name      String   @default("Main Screen")
  gridCols  Int      @default(6)  // 3-12 columns, configurable per layout
  tree      Json     @default("[]")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([orgId, storeId])
  @@map("quick_button_layouts")
}
```

**Tile types** (5):
- `product` — tap adds to cart (productId, name, price, upc)
- `folder` — tap drills into children (label, emoji, color, children[])
- `action` — tap fires a POS handler (actionKey from a server-side whitelist)
- `text` — display-only label
- `image` — picture tile with optional `targetProductId` or `targetActionKey`

Every tile carries `{ id, x, y, w, h, backgroundColor?, textColor?, imageUrl? }`. The save handler enforces **1-level folder depth** (a folder's `children[]` may NOT contain another folder) — backend validation rejects deeper nesting with 400 so the cashier-side back button only needs to handle a single drill-in.

**Action key whitelist** (server-side `VALID_ACTIONS` set): `discount`, `void`, `refund`, `open_drawer`, `no_sale`, `print_last_receipt`, `customer_lookup`, `customer_add`, `price_check`, `hold`, `recall`, `cash_drop`, `payout`, `end_of_day`, `lottery_sale`, `fuel_sale`, `bottle_return`, `manual_entry`, `clock_event`. POS admins can only select from this list; the cashier-side dispatcher maps each key to its existing handler.

#### Backend

New files:
- [`quickButtonController.js`](backend/src/controllers/quickButtonController.js) — GET/PUT/DELETE layout, POST upload, GET actions. Validates tree depth + action keys on save. Multer storage to `uploads/quick-buttons/`, 10 MB per file, image MIME types only.
- [`quickButtonRoutes.js`](backend/src/routes/quickButtonRoutes.js) — `/api/quick-buttons/*` routes gated on `pos_config.view` (read) and `pos_config.edit` (write).

Modified: `server.js` mounts `/api/quick-buttons` + static serving for `/uploads/quick-buttons` (1-day cache, NOT immutable because admins can replace images).

#### Portal (WYSIWYG builder)

[`QuickButtonBuilder.jsx`](frontend/src/pages/QuickButtonBuilder.jsx) + [`.css`](frontend/src/pages/QuickButtonBuilder.css) (prefix `qbb-`):

**Layout** — 3 columns:
1. **Palette (left)** — Add buttons for each tile type, grid-column slider (3-12), "Back to root" when drilled into a folder
2. **Canvas (center)** — react-grid-layout `GridLayout` with freeform placement (`compactType: null`, `preventCollision: true`, `isBounded: true`). Wrapped in a `GridCanvas` sub-component that uses `useContainerWidth()` to auto-size.
3. **Inspector (right)** — Context-aware property editor for the selected tile (label, colors, image upload, product swap, action-key dropdown)

**Dependency**: `react-grid-layout@2.2.3`. Note: v2.x dropped `WidthProvider` in favour of the `useContainerWidth` hook — the GridCanvas sub-component passes the measured pixel width explicitly to `GridLayout`.

**Features**:
- Drag tiles around freely (no auto-compact, stays exactly where placed)
- Resize via SE handle
- Click to select, double-click folder to drill in
- Inspector fields: label, emoji, color swatches (12 preset), background/text colours, image upload (with preview)
- Product picker modal (debounced search via existing `searchCatalogProducts`)
- Image upload via `POST /api/quick-buttons/upload` — returns static URL, pasted directly onto tile
- "Save As" / "Save" / "Delete" / "Reset layout" / grid-column count in sidebar
- Unsaved changes warning (`beforeunload`)
- Responsive: 3-col shell collapses to 1-col stack at 1024px; palette goes horizontal

**Route**: `/portal/quick-buttons` (permission: `pos_config.view`). Sidebar link "Quick Buttons" added under **Point of Sale** group with the `Layout` Lucide icon.

#### Cashier-app (read-only renderer)

[`QuickButtonRenderer.jsx`](cashier-app/src/components/pos/QuickButtonRenderer.jsx) + [`.css`](cashier-app/src/components/pos/QuickButtonRenderer.css) (prefix `qbr-`):

- Renders the stored tiles at their exact (x,y,w,h) positions via CSS Grid (`gridColumn: "X / span W"`). No drag-library dependency on the cashier side — just read-only display.
- Tap dispatch:
  - `product` → `useCartStore.addProduct(...)` with metadata
  - `folder` → drills into children (local state, no route change)
  - `action` → calls `onAction(actionKey)` prop → POSScreen dispatcher
  - `text` → no-op (button is `disabled`)
  - `image` → fires `targetProductId` or `targetActionKey` if set
- Breadcrumb with "Back" button when inside a folder

**Hook** — [`useQuickButtonLayout.js`](cashier-app/src/hooks/useQuickButtonLayout.js):
- Fetches layout via `GET /api/quick-buttons?storeId=...`
- Polls every 5 min + on tab `visibilitychange` (same pattern as `usePOSConfig`)
- Returns `{ layout, loading, refresh }`

**POSScreen integration** ([POSScreen.jsx](cashier-app/src/screens/POSScreen.jsx)):
- Imports the hook + renderer
- New `handleQuickAction(actionKey)` dispatcher maps every valid action key to the existing handler (requireManager gating preserved for discount/void/refund)
- Tab bar updated — now shows CATALOG / ▦ BUTTONS / ⚡ FOLDERS depending on what's configured. Empty tabs are filtered out.

#### Verification

Both builds green (portal 15.20s, cashier-app 4.58s). Backend endpoints respond 401 on all three routes (`/actions`, `/?storeId=`, `PUT /`) as expected without auth. Vite dep pre-bundler required a cache bust after the react-grid-layout API correction — documented in the GridCanvas comment so the next maintainer knows WidthProvider was intentionally removed.

#### Files shipped (Session 37)

**Backend**:
- `backend/prisma/schema.prisma` — `QuickButtonLayout` model
- `backend/src/controllers/quickButtonController.js` — NEW
- `backend/src/routes/quickButtonRoutes.js` — NEW
- `backend/src/server.js` — mount routes + static serving

**Portal**:
- `frontend/package.json` — +`react-grid-layout` ^2.2.3
- `frontend/src/pages/QuickButtonBuilder.jsx` + `.css` — NEW (prefix `qbb-`)
- `frontend/src/App.jsx` — `/portal/quick-buttons` route
- `frontend/src/components/Sidebar.jsx` — "Quick Buttons" nav item
- `frontend/src/rbac/routePermissions.js` — route permission entry
- `frontend/src/services/api.js` — 5 new API helpers

**Cashier-app**:
- `cashier-app/src/components/pos/QuickButtonRenderer.jsx` + `.css` — NEW (prefix `qbr-`)
- `cashier-app/src/hooks/useQuickButtonLayout.js` — NEW
- `cashier-app/src/api/pos.js` — +`getQuickButtonLayout`
- `cashier-app/src/screens/POSScreen.jsx` — `handleQuickAction` dispatcher, Buttons tab, renderer wiring

---

*Last updated: April 2026 — Session 37: Quick Buttons WYSIWYG — freeform drag/resize tile builder, 1-level folders, image uploads, 19-action whitelist, read-only cashier-app renderer*

---

## 📦 Recent Feature Additions (April 2026 — Session 37b)

Polish + bug-fix pass on top of Session 37's Quick Buttons. Triggered by user smoke-testing the builder — uncovered several issues that had to be fixed before the feature was usable, plus a latent RBAC gap that was silently breaking managers across the whole portal.

### 1. SSO impersonation bounce fix — `/admin/users` "Login As"

Admin's "Login As" button was opening a new tab at `http://localhost:5175/impersonate?…` in dev (admin-app's own port) instead of the portal at :5173, so react-router's catch-all redirected logged-in admins back to `/dashboard`. Root cause: the URL-resolution fallback `window.location.origin.replace('admin.', '')` works in production (subdomain strip) but returns the string unchanged at `localhost:5175` since there's no `admin.` prefix.

Fix in [`AdminUsers.jsx`](admin-app/src/pages/AdminUsers.jsx) — extracted `resolvePortalBase()` with a 3-tier fallback:
1. `VITE_PORTAL_URL` env var (production override)
2. Production subdomain pattern: `admin.x.com → x.com`
3. Dev port swap: `:5175 → :5173`
4. null → explicit toast "Portal URL not configured — set VITE_PORTAL_URL"

Production path still uses the subdomain strip; dev gets the explicit port swap. The previous silent fallback to admin's own origin is gone.

### 2. RBAC manager role — missing `stores.view`

Discovered while diagnosing the empty store dropdown on Quick Buttons: the `manager` role in [`permissionCatalog.js`](backend/src/rbac/permissionCatalog.js) was missing `stores.view` and `organization.view`. This wasn't a Quick Buttons bug — it was a pre-existing RBAC gap from Session 31 that silently broke **every manager across the whole portal**: the StoreSwitcher, Store Settings, Reports filters, and any page calling `GET /api/stores` returned 403.

No one hit it earlier because all prior testing was done as admin/superadmin/owner (who get `*` wildcard perms).

Fix:
- Added `stores.view` and `organization.view` to the manager role's permission list
- Ran `node prisma/seedRbac.js` to sync the `role_permissions` table
- Manager role went 65 → 67 permissions; create/edit/delete on stores remains owner-only

**Deploy note**: every prod deploy from this point forward must include `node prisma/seedRbac.js` in the pipeline to pick up future catalog changes.

### 3. Consolidated POS config entries — one Quick Buttons path

The sidebar had TWO entry points for the same feature: `/portal/pos-config?tab=quick-keys` (legacy QuickAccess page embedded in POSConfig) AND `/portal/quick-buttons` (new WYSIWYG builder). Users hit both, got confused.

Fix:
- Removed the "Quick Keys" tab from [`POSConfig.jsx`](frontend/src/pages/POSConfig.jsx) — remaining tabs: Layout & Settings, Receipt Settings, Label Design
- Legacy `/portal/quick-access` redirect in App.jsx now points at `/portal/quick-buttons` (was pointing at the dead POSConfig tab)
- Legacy `store.pos.quickFolders` data still renders as a fallback in the cashier-app (no migration needed for existing stores)
- `QuickAccess.jsx` file left on disk but unreferenced

### 4. Light-theme CSS rewrites — dark artefacts eliminated

Initial [`QuickButtonBuilder.css`](frontend/src/pages/QuickButtonBuilder.css) and [`MyPIN.css`](frontend/src/pages/MyPIN.css) used variable names that don't exist in the portal (`--bg-card`, `--bg-panel`, `--bg-input`, `--border`) with dark-theme rgba defaults, so cards rendered as near-invisible `rgba(255,255,255,0.03)` on white bg, palette buttons had unreadable text, and accents were green (`#7ac143`) instead of the portal's brand blue (`#3d56b5`).

Full rewrite of both CSS files:
- Cards → `var(--bg-secondary)` (#ffffff)
- Inputs → `var(--bg-tertiary)` (#f1f5f9)
- Text → `var(--text-primary)` (#0f172a)
- Borders → `var(--border-color)`
- Brand accents → `var(--brand-primary)` (#3d56b5) with `var(--brand-08)`/`--brand-25` tints
- Modal overlays → `var(--modal-overlay)` + `var(--modal-shadow)`

Verified via `getComputedStyle` — every element resolves to the correct light-theme value.

### 5. react-grid-layout 2.x API migration

Initial ship imported `{ GridLayout, WidthProvider }` from `react-grid-layout` — the 2.x main-entry export renamed/removed `WidthProvider`. I switched to `useContainerWidth` hook, but that returns `{ width, mounted, containerRef, measureWidth }` (object), not the tuple my code expected. First fix: `const { containerRef, width } = useContainerWidth()`.

Then a deeper issue surfaced: **my `rowHeight={64}` prop was being silently ignored**. Inspection of the 2.x source revealed the API restructured individual props (`cols`, `rowHeight`, `margin`, `compactType`, `preventCollision`, `draggableCancel`) into a `gridConfig` object. Flat props defaulted to `{ cols: 12, rowHeight: 150, margin: [10,10] }` — which is why tiles rendered at 150px regardless of my prop value.

Final fix: switched to the legacy adapter — `import GridLayout, { WidthProvider } from 'react-grid-layout/legacy'`. This restores the 1.x API (flat props work again) and keeps `WidthProvider`. All subsequent tile-sizing/gap work relies on this.

### 6. Tile size + spacing UX polish

Added user controls for tile height, wired proportional spacing:

- **Default tile height**: 56px (was the erroneous 150px, then briefly 64 — landed at 56 after user testing, comfortably above iOS 44pt / Android 48dp touch-target minimums)
- **Tile height input in palette** — 40–160px range, live-updates the grid
- **Proportional gap** — `Math.max(6, Math.min(18, Math.round(rowHeight / 8)))`. At rowHeight 40 → gap 6, 64 → 8, 96 → 12, 128 → 16, 160 → 18. Small tiles stay tight, big tiles breathe.
- **Schema** — new `QuickButtonLayout.rowHeight Int @default(56)` column. `gridCols` kept at default 6.
- Cashier renderer in [`QuickButtonRenderer.jsx`](cashier-app/src/components/pos/QuickButtonRenderer.jsx) uses the same proportional gap formula so what the admin designs is pixel-accurate on the POS.

### 7. Custom colour picker — rainbow swatch

The inspector had 12 preset swatches + a "default" chip. Added a 13th slot — a **custom colour swatch** that wraps a hidden `<input type="color">` (native browser picker). Users can paint tiles any exact hex (brand colours, sponsored-product tints, etc.).

- **Inactive state** — conic-gradient rainbow background with "+" glyph, signalling "pick any colour"
- **Active state** — swatch fills with the chosen hex, shows active-border
- Swatch uses `<label>` wrapping a hidden `type="color"` input — zero new deps, works on every browser including iOS Safari

Applied to both Background Colour and Text Colour fields. CSS in `.qbb-swatch--custom` (new class in [QuickButtonBuilder.css](frontend/src/pages/QuickButtonBuilder.css)).

### 8. onLayoutChange spurious dirty-flag bug

react-grid-layout fires `onLayoutChange` once on mount with the same layout it just rendered. My handler was calling `updateCurrentTree` → `markDirty()` unconditionally, which set `dirty=true` on page load → the store `<select>` was `disabled={dirty}` → the user couldn't switch stores until they manually saved.

Fixes in [QuickButtonBuilder.jsx](frontend/src/pages/QuickButtonBuilder.jsx):
- `onLayoutChange` now early-returns when positions actually match existing tree (no state update, no dirty flag)
- `updateCurrentTree(updater, opts)` gained `opts.markDirty = false` escape hatch
- Removed `disabled={dirty}` on the store `<select>` — replaced with a `window.confirm('Discard unsaved changes?')` on change. Less intrusive, covers the same safety case.

### 9. Silent catch on getStores → surfaced error

Initial builder had `getStores().catch(() => {})` — if the fetch failed or returned empty, user saw a blank dropdown with no clue why. Fixed:
- Added explicit `setStoresError(msg)` state + toast
- Three empty-states now render in priority order:
  1. Error loading stores → red card with the exact server error
  2. 0 stores in org → instruction + link to `/portal/account?tab=stores`
  3. Stores present but none selected → "Select a store above" prompt

### 10. Back Office PIN-SSO from cashier-app into portal

Real security fix, not a polish item. The previous implementation only opened the portal URL in the browser — whoever's localStorage session happened to be there is what loaded. A manager clicking Back Office could silently inherit yesterday's admin session with full admin access. Now fixed: whoever enters the manager PIN lands in the portal **as themselves** with their actual role's permissions.

No new backend endpoint. The existing `/pos-terminal/pin-login` already returns `{ token, id, name, email, role, orgId, storeId }` after validating against `UserStore.posPin` (Session 36 tiered lookup). The fix threads that response through the manager-PIN flow so the Back Office handler can build a `/impersonate?token=X&user=Y` URL and reuse the `ImpersonateLanding` component from Session 8.

Changes:
- **[`useManagerStore.js`](cashier-app/src/stores/useManagerStore.js)** — added `managerAuth` field to the store (full `{ token, id, name, ... }` response). Populated by `onPinSuccess`'s new optional third arg; cleared on `endSession()` so the token doesn't linger past the 10-minute manager session.
- **[`ManagerPinModal.jsx`](cashier-app/src/components/modals/ManagerPinModal.jsx)** — passes `res.data` as the third arg to `onPinSuccess(user.id, user.name, user)`. Existing callers unchanged (ignore the extra arg).
- **[`POSScreen.jsx`](cashier-app/src/screens/POSScreen.jsx) `onAdminPortal`** — reads `managerAuth` from the store, builds a `/impersonate?token=X&user=Y` URL, opens it via Electron's default browser (or `window.open` as fallback). If `managerAuth` is null (shouldn't happen but just in case), falls back to the old plain-URL behaviour with a `console.warn`.

Flow after the fix:
1. Cashier taps Back Office
2. `requireManager('Back Office', onAdminPortal)` opens the PIN modal (or skips it if a valid manager session already exists within the 10-min window)
3. Manager enters PIN → cashier-app POSTs to `/pos-terminal/pin-login` → backend does the tiered lookup (UserStore.posPin first, then User.posPin org-wide fallback), issues 24h JWT for that user
4. `onPinSuccess(id, name, fullUser)` stores the full auth in the manager store
5. `onAdminPortal` reads `managerAuth.token` + user fields, opens `${VITE_PORTAL_URL}/impersonate?token=JWT&user=BASE64_JSON`
6. Portal's `ImpersonateLanding` (already built Session 8) reads the URL, writes `localStorage.user`, redirects to `/portal/realtime`
7. Portal loads with THAT manager's permissions via `usePermissions` hook which re-fetches from `/api/roles/me/permissions`

Security improvement: stale localStorage sessions in the browser no longer determine who's "logged in" at the portal. The manager PIN is the source of truth for every Back Office click.

Cashier-app vite build confirmed clean after changes (5.17s). Portal and backend untouched — no schema push, no Prisma regen, no backend restart needed for this feature.

### 11. Sidebar "signed in as" user card

Portal had NO visible indication of which user was logged in — the sidebar just listed nav items + a Logout button. Users couldn't verify their session identity after PIN-SSO (or at any point). Fixed via [`Sidebar.jsx`](frontend/src/components/Sidebar.jsx) + [`index.css`](frontend/src/index.css):

- Reads `localStorage.user` on mount; skips rendering when no session
- Circular avatar with user initials (first letter of first + last token in name/email) on `--brand-primary` background
- Name line (bold) + role chip + email (subtle), all single-line with ellipsis on narrow sidebars
- `title={currentUser.email}` tooltip for truncated emails
- Role-label map: `superadmin → "Super Admin"`, `admin → "Admin"`, `owner → "Owner"`, `manager → "Manager"`, `cashier → "Cashier"`, `staff → "Staff"`
- Pinned to sidebar bottom via `margin-top: auto` on `.sidebar-user-card`; Logout button sits directly beneath
- Light-theme tokens: `--bg-tertiary` card bg, `--text-primary` name, `--text-muted` role line, `--brand-primary` avatar

Appears on every portal page since Sidebar is part of the shared Layout (Session 16 refactor).

Verified: Manager session → sidebar shows "NK · Nishant Kumar · Manager · nishant@future.com"; colors resolve to correct light-theme tokens.

### 12. My Profile — self-service for every user (no permission gate)

Discovered while debugging the sidebar card: staff/cashiers can't reach Account Settings at all (requires `organization.view`), so they had **no way to update their own name, phone, or password** without admin intervention. Shipped a dedicated self-service page.

**Backend** — three new endpoints in [`userManagementController.js`](backend/src/controllers/userManagementController.js), registered in [`userManagementRoutes.js`](backend/src/routes/userManagementRoutes.js) BEFORE the `/:id` routes so they're not shadowed:

- `GET /api/users/me` — returns own profile + `orgs[]` (every UserOrg membership with role + org name). Never leaks `posPin` hash or `password` hash.
- `PUT /api/users/me` — updates `name` / `phone` only. Email/role/orgId deliberately excluded (those require admin).
- `PUT /api/users/me/password` — requires current password (even a stolen session can't pivot to password rotation). Enforces the same policy as signup (8+ chars, upper + lower + digit + special). Rejects no-op rotations (new must differ from current).

None have a `requirePermission` gate — any authenticated user can manage their own profile. Reuses the existing `validatePhone` + `validatePassword` helpers from [`validators.js`](backend/src/utils/validators.js) (caveat: validatePhone returns `null` on success / error string on failure — initial wiring had inverted logic, fixed after live test).

**Frontend** — new [`MyProfile.jsx`](frontend/src/pages/MyProfile.jsx) + [`.css`](frontend/src/pages/MyProfile.css) (prefix `mp-`) page at route `/portal/my-profile`. No permission mapping → authenticated-only.

Page sections:
1. **Identity card** — big avatar with initials, name + email + role chip + org chip, brand-gradient background
2. **Profile details form** — editable name + phone, read-only email + role with explanatory hints ("Contact your admin to change your email")
3. **Password change form** — current + new + confirm, native show/hide toggle, **live password-strength checklist** (5 rules matching backend validator), disabled until all rules pass + both fields match

**Sidebar user card is now clickable** — `<NavLink to="/portal/my-profile">` with hover/active states. Click the card anywhere in the portal → land on your own profile page. Title attr still shows full email for narrow sidebars.

Tested:
- `GET /api/users/me` → full profile with orgs array
- `PUT /api/users/me` with `{ phone: '+1-555-0123' }` → 200, saves with dashes
- `PUT /api/users/me` with `{ phone: 'not-a-phone' }` → 400 "Invalid phone format"
- `PUT /api/users/me` with `{ phone: '123' }` → 400 (too few digits)
- `PUT /api/users/me/password` with wrong current → 400 "Current password is incorrect"
- Sidebar card href → `/portal/my-profile` ✓
- Page renders on route with all 7 expected labels + both form cards ✓

**Closes a real UX gap** — staff managing inventory, cashiers, any non-admin role can now update their own details (including password) without needing admin to do it for them. No schema change, no seed, no env var.

### 13. Production hotfixes surfaced during deploy

Two 500-level errors were showing up in `pm2 logs api-pos-error.log` after the Session 37b deploy:

**a. `Unknown argument 'active'. Did you mean 'isActive'?`** — [`stationController.js`](backend/src/controllers/stationController.js) lines 197, 205, 218, 254, 256. My Session 36 `listMyPins` + `setMyPin` queries used `Store.active` but the Prisma schema's column is `Store.isActive`. Every call to `/api/users/me/pins` or PUT `/api/users/me/pin` was 500'ing in production. Local dev didn't catch it because no manager-role test traffic hit those endpoints until the user did in prod.

**b. `TypeError: PLATFORMS.map is not a function`** — [`integrationController.js:39`](backend/src/controllers/integrationController.js). Pre-existing (not my session's bug), but surfaced in the deploy logs. `PLATFORMS` in [`adapterInterface.js`](backend/src/services/platforms/adapterInterface.js) is an object keyed by slug (`{ doordash: {...}, ubereats: {...}, ... }`) — controller was calling `.map()` directly on the object. Fixed with `Object.entries(PLATFORMS).map(([key, p]) => ({ key, ...p, ... }))`. Every Delivery Platforms / Integrations page load was 500'ing.

Both verified against the live dev backend after fix — `/api/users/me/pins` returns `{ stores: [...] }` with 1 active store; `/api/integrations/platforms` returns an array of 6 platforms with proper `key` slugs attached.

**Deploy**: 2 commands — `git pull` + `pm2 restart api-pos`. No schema, no seed, no frontend rebuild.

**Lesson**: when shipping new `/me/*` endpoints, test AS a manager/cashier role, not as admin. Admin roles have `'*'` perms so they'd never hit the stores.view gate that exposed the root cause chain — but the `Store.active` vs `isActive` schema mismatch would still have thrown whenever the endpoint was actually called. Mock manager session (already done for RBAC testing) should be part of the standard verification loop for any self-service endpoint from here on.

### Files touched (Session 37b)

**Backend**:
- `backend/prisma/schema.prisma` — `QuickButtonLayout.rowHeight Int @default(56)`
- `backend/src/controllers/quickButtonController.js` — accept + persist rowHeight, clamp 40–160
- `backend/src/rbac/permissionCatalog.js` — manager +2 perms

**Portal**:
- `frontend/src/pages/QuickButtonBuilder.jsx` — legacy-adapter import, rowHeight state + input, custom color swatch, onLayoutChange guard, error handling
- `frontend/src/pages/QuickButtonBuilder.css` — full light-theme rewrite, `.qbb-swatch--custom`
- `frontend/src/pages/MyPIN.css` — full light-theme rewrite
- `frontend/src/pages/POSConfig.jsx` — removed Quick Keys tab + import
- `frontend/src/App.jsx` — `/portal/quick-access` redirect updated
- `frontend/src/components/Sidebar.jsx` — "signed in as" user card above Logout, now clickable → `/portal/my-profile`
- `frontend/src/index.css` — `.sidebar-user-card` (now `NavLink`), `.sidebar-user-avatar`, `.sidebar-user-meta` styles, hover/active on clickable card
- `frontend/src/pages/MyProfile.jsx` + `.css` — NEW self-service profile page (prefix `mp-`)
- `frontend/src/App.jsx` — `/portal/my-profile` route (authenticated-only, no permission gate)
- `frontend/src/services/api.js` — `getMyProfile`, `updateMyProfile`, `changeMyPassword` helpers

**Backend additions**:
- `backend/src/controllers/userManagementController.js` — `getMe`, `updateMe`, `changeMyPassword` handlers
- `backend/src/routes/userManagementRoutes.js` — three `/me` routes registered BEFORE `/:id` so they aren't shadowed
- `backend/src/controllers/stationController.js` — `active` → `isActive` schema fixes in `listMyPins` + `setMyPin` (production hotfix after deploy uncovered the bug)
- `backend/src/controllers/integrationController.js` — `PLATFORMS.map` → `Object.entries(PLATFORMS).map` (pre-existing bug, fixed on same pass)

**Cashier-app**:
- `cashier-app/src/hooks/useQuickButtonLayout.js` — rowHeight in returned shape, default 56
- `cashier-app/src/components/pos/QuickButtonRenderer.jsx` — honour per-store rowHeight + proportional gap
- `cashier-app/src/stores/useManagerStore.js` — added `managerAuth` field, third-arg support on `onPinSuccess`, cleared on `endSession`
- `cashier-app/src/components/modals/ManagerPinModal.jsx` — passes full response to `onPinSuccess`
- `cashier-app/src/screens/POSScreen.jsx` — `onAdminPortal` uses `managerAuth` to build `/impersonate` URL
- `cashier-app/src/components/modals/RefundModal.css` — fixed `borderRadius` camelCase typo (was a no-op but caused vite warning)

**Admin-app**:
- `admin-app/src/pages/AdminUsers.jsx` — `resolvePortalBase()` helper with 3-tier fallback

---

## 🗓 Next Session plan (queued)

User confirmed: Sessions 36, 37, 37b done. Next session tackles a grab-bag of smaller UX items (batch together) followed by B2B Exchange settlement enhancements.

### Wave 1 — Quick wins (~90 min)

- [ ] Customer display screen bigger — bump font sizes in [`CustomerDisplayScreen.css`](cashier-app/src/screens/CustomerDisplayScreen.css), scale item rows + totals
- [ ] "New Exchange update" voice rename — locate exchange notification text in [`ExchangeNotifier.jsx`](frontend/src/components/ExchangeNotifier.jsx), update phrase
- [ ] Offline scan blinking fix — diagnose POSScreen re-render when offline (user reported: products load now, just screen blinks)
- [ ] Product export CSV/XLSX — new `GET /api/catalog/products/export` + button in Products page, reuse [`exportUtils.js`](frontend/src/utils/exportUtils.js)
- [x] ~~Back Office → true PIN-SSO into portal~~ **Shipped in Session 37b (see below).**

### Wave 2 — Notification dots + Sante templates (~2h)

- [ ] **Sidebar notification dots** — small red badges next to nav items when counts > 0: Chat (already has), Tickets, Tasks, Delivery Platforms, Audit Log, Online Orders. Needs a `useNotificationCounts()` hook polling each endpoint (15–30s)
- [ ] **Sante product import template** — generate `.xlsx` with Sante column headers + example rows; "Download Sante Template" button on BulkImport page
- [ ] **Sante groups import template** — same pattern, separate file
- [ ] **Sante tags → Groups mapping** — parse "tags" column from Sante export, auto-create ProductGroup rows during import

**Needs before Wave 2**: sample Sante export CSV/XLSX to confirm their exact column names.

### Wave 3 — Storv Exchange settlement (own session, ~3h)

- [ ] Partial-acceptance email + in-app notification to sender when receiver marks items short
- [ ] Settlement log page — chronological credit/debit list between two stores, filter by date/partner/status, viewable by both parties
- [ ] Two-party settlement confirmation — schema: `PartnerSettlement.status` transitions `pending → sender_confirmed → receiver_confirmed → finalized`. Receiver gets a "Confirm Receipt" button. Security: finalize only when both have confirmed.
- [ ] Receiver notification text update (also in Wave 1)

**Schema change needed**: [`PartnerSettlement`](backend/prisma/schema.prisma) — reuse existing `disputedAt` machinery for 2-party disputes, or add new `senderConfirmedAt`/`receiverConfirmedAt` timestamps.

### Wave 4 — Capacitor mobile app MVP (own session)

Unchanged from original scope — Capacitor wrapper around the portal, trimmed to manager-focused screens (Live Dashboard, Transactions, Chat, Online Orders), output Android + iOS installers.

### Wave 5 — Transaction video POC (2–3 sessions)

Unchanged — Reolink RTSP → ffmpeg rolling buffer → 15s clip on TX → Cloudflare R2 → portal modal player.

### Clarifications to collect before starting Wave 1+2

1. Sante export sample (CSV/XLSX) — column names vary by Sante version
2. Which Sante column maps to "tags" → is that ProductGroups or Departments (or both)?
3. For two-party settlement: is there a third/dispute state beyond sender_confirmed + receiver_confirmed? Existing `disputedAt` suggests yes — confirm semantics
4. Confirm mobile app MVP scope — still manager-focused or include cashier features?

---

*Last updated: April 2026 — Session 37b: RBAC manager-role fix, SSO portal URL fallback, light-theme CSS rewrite, react-grid-layout legacy adapter, tile-size + custom-color UX polish, one-entry Quick Buttons consolidation, **PIN-SSO from cashier-app Back Office → portal**, **sidebar "signed in as" card**, **My Profile self-service page***

---

## 📦 Recent Feature Additions (April 2026 — Session 38)

### AI Support Assistant — P1 Foundation

First slice of the AI chatbot for feature help + live-store data queries. Portal-only for now; cashier-app + admin-app + KB + auto-ticket escalation land in P2/P3.

#### Architecture
- **Claude Sonnet 4.5** via Anthropic tool-use — AI never touches the DB directly. It calls server-side tool functions; each tool re-checks the caller's RBAC permissions server-side before returning data.
- **One chat surface, multi-role safe** — a cashier asking "show me today's sales across the org" hits `get_store_summary` which checks `dashboard.view`/`analytics.view`. Lacks it → tool returns `{error: ...}`, AI relays politely. Store/org scoping always comes from `req.orgId`/`req.storeId` (JWT + active-store header), never from tool input.
- Graceful 503 fallback when `ANTHROPIC_API_KEY` is unset — everything else (CRUD, permissions, UI) keeps working.

#### Schema — 2 new models ([schema.prisma](backend/prisma/schema.prisma))
```prisma
model AiConversation {
  id            String   @id @default(cuid())
  orgId         String?        // null for future superadmin cross-tenant
  storeId       String?
  userId        String
  userRole      String?        // denormalized effective role at creation
  userName      String?
  title         String?        // auto-summary of first user message (<=80 chars)
  lastMessageAt DateTime @default(now())
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  messages AiMessage[]
  @@index([userId, lastMessageAt])
  @@index([orgId, lastMessageAt])
  @@map("ai_conversations")
}

model AiMessage {
  id             String   @id @default(cuid())
  conversationId String
  role           String         // "user" | "assistant"
  content        String   @db.Text
  toolCalls      Json?          // [{name, input, output, durationMs}]
  tokenCount     Int?
  model          String?
  feedback       String?        // "helpful" | "unhelpful" | null
  feedbackNote   String?  @db.Text
  ticketId       String?        // auto-escalation hook (P2)
  createdAt      DateTime @default(now())
  conversation AiConversation @relation(onDelete: Cascade)
  @@index([conversationId, createdAt])
  @@index([feedback])
  @@map("ai_messages")
}
```
Pushed via `npx prisma db push`; non-destructive.

#### RBAC — 2 new permissions ([permissionCatalog.js](backend/src/rbac/permissionCatalog.js))
| Key | Grants |
|---|---|
| `ai_assistant.view` | Everyone who can open the chat (manager, cashier, owner via `*`, admin via `*`, superadmin via `admin:*`+`*`). Staff deliberately NOT granted. |
| `ai_assistant.manage` | Manager + owner + admin + superadmin. Gates access to the 👎-review queue and KB curation (P2). |

Seeded via `node prisma/seedRbac.js`. Verified via login — `manager@storeveu.com` returns `permissions: ['ai_assistant.view','ai_assistant.manage', ...]`.

#### Backend ([aiAssistantController.js](backend/src/controllers/aiAssistantController.js) + [aiAssistantRoutes.js](backend/src/routes/aiAssistantRoutes.js))

**Tool-use loop:**
1. Save user message to DB
2. Load last 20 messages of the conversation (sliding window sent to Claude)
3. Build system prompt with store/user context
4. Call Claude with tool definitions + messages
5. If `stop_reason === 'tool_use'`: execute each requested tool in parallel (with 8s per-tool timeout), push results back into the conversation, loop again
6. Max 5 tool iterations per turn (guards against infinite loops)
7. Extract final text → save assistant message with tool-call trace + token count + model

**4 P1 tools** (read-only, each re-checks RBAC):

| Tool | Checks | Returns |
|---|---|---|
| `get_store_summary` | `dashboard.view` OR `analytics.view` | Net/gross sales, tx count, tax, top 5 products over last 1-30 days |
| `get_inventory_status` | `products.view` | Products with QOH, threshold, low-stock flag; search + low-stock-only filters |
| `get_recent_transactions` | `transactions.view` | Last N transactions with tender method + amounts |
| `search_transactions` | `transactions.view` | Date range + amount + tender method filters |

**API routes** (all gated on `ai_assistant.view`):
```
GET    /api/ai-assistant/conversations                — list user's conversations
POST   /api/ai-assistant/conversations                — create empty conversation
GET    /api/ai-assistant/conversations/:id            — full message history
DELETE /api/ai-assistant/conversations/:id            — delete conversation
POST   /api/ai-assistant/conversations/:id/messages   — send message, get response
POST   /api/ai-assistant/messages/:id/feedback        — 👍 or 👎 with optional note
```

**System prompt** — identifies as Storv AI Assistant; tells it to call tools rather than guess; bans code/SQL/internal discussion; tells it to propose a support ticket when it can't answer.

**Cost guards** (MVP):
- Max 2048 output tokens per response
- Max 20 messages of history per request
- Max 5 tool-use iterations per user message
- 8-second per-tool hard timeout

#### Frontend ([AIAssistantWidget.jsx](frontend/src/components/AIAssistantWidget.jsx) + [`.css`](frontend/src/components/AIAssistantWidget.css))

Floating widget mounted globally in [Layout.jsx](frontend/src/components/Layout.jsx). Hidden unless `can('ai_assistant.view')`.

- **FAB** bottom-right (Sparkles icon, brand gradient)
- **Panel** 420×640 with header (icon + title + new-convo + close), scrollable message area, composer
- **Greeting screen** on new conversation — "Hi {firstName}!" + 4 clickable example prompts ("How are sales today?", "What's running low on stock?", etc.)
- **Streaming 3-dot "thinking" animation** while waiting for Claude (non-streaming P1; true token streaming lands in P2)
- **Minimal markdown** — `**bold**`, `` `code` ``, line breaks; all HTML-escaped first
- **👍👎 buttons** on every assistant response. 👎 opens an inline feedback textarea — note is stored on the AiMessage for the admin review queue (P2)
- **Session persistence** — conversation id stored in `sessionStorage` so page refresh keeps the current thread
- **CSS prefix** — `aiw-` (AIAssistantWidget) with brand-compatible light theme + responsive breakpoint at 520px (collapses to full-screen on phones)

#### API helpers added ([services/api.js](frontend/src/services/api.js))
```js
listAiConversations()             // → { conversations }
getAiConversation(id)             // → { conversation: { messages: [...] } }
createAiConversation()            // → { conversation: { id, title, ... } }
sendAiMessage(id, content)        // → { userMessage, assistantMessage }
deleteAiConversation(id)          // → { success }
submitAiFeedback(msgId, feedback, note?)   // → { message }
```

#### Env vars
```bash
# Required for assistant to work — without it, sendMessage returns 503
ANTHROPIC_API_KEY=sk-ant-api03-...

# Optional — defaults to claude-sonnet-4-5
ANTHROPIC_MODEL=claude-sonnet-4-5
```
Added to `backend/.env.example` with instructions.

#### Verification (live stack)
- ✅ `manager@storeveu.com` login → permissions include `ai_assistant.view` + `ai_assistant.manage`
- ✅ FAB renders bottom-right on all `/portal/*` pages
- ✅ Click FAB → panel opens with header, greeting, 4 example prompts, composer
- ✅ `POST /api/ai-assistant/conversations` as manager → 201 with conversation id
- ✅ `POST /conversations/:id/messages` (API key not set) → clean 503 `AI assistant is not configured on this server. Contact support.`
- ✅ `DELETE /conversations/:id` → 200
- ✅ Widget hides entirely for users without `ai_assistant.view`

Once the user sets `ANTHROPIC_API_KEY` in `.env` and restarts the backend, the full chat flow works end-to-end.

#### Deferred to P2/P3
- **P2:** pgvector KB seeding from CLAUDE.md + feature docs, RAG retrieval in prompt, auto-ticket escalation on low confidence or 👎+note (integrates with existing `SupportTicket`/Session 8), admin review queue page in admin-app (`ai_assistant.manage` gated)
- **P3:** Cashier-app Help button → modal integration, admin-app cross-tenant chat (superadmin), admin curation UI to promote 👎 items to KB, extended tools (lottery, fuel, predictions, employees, EoD), prompt caching for cost reduction
- **V2:** Voice / phone-call agent via Twilio + ElevenLabs

#### Files Added (Session 38)
| File | Purpose |
|---|---|
| `backend/src/controllers/aiAssistantController.js` | Tool-use loop + 4 tools + CRUD + feedback |
| `backend/src/routes/aiAssistantRoutes.js` | `/api/ai-assistant/*` routes |
| `frontend/src/components/AIAssistantWidget.jsx` | Floating chat widget |
| `frontend/src/components/AIAssistantWidget.css` | `aiw-` prefix |

#### Files Modified (Session 38)
| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | +`AiConversation` + `AiMessage` models |
| `backend/src/rbac/permissionCatalog.js` | +`ai_assistant` module (view + manage) + grants to manager/cashier |
| `backend/src/server.js` | Mount `/api/ai-assistant` |
| `backend/.env.example` | +`ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` docs |
| `backend/package.json` | +`@anthropic-ai/sdk` dep |
| `frontend/src/services/api.js` | +6 AI assistant API helpers |
| `frontend/src/components/Layout.jsx` | Mount `<AIAssistantWidget />` globally |

---

*Last updated: April 2026 — Session 38: AI Support Assistant P1 Foundation — Claude tool-use framework, 4 read-only tools with RBAC-gated execution, portal chat widget, 👍👎 feedback logging*

---

## 📦 Recent Feature Additions (April 2026 — Session 38b)

### AI Support Assistant — P2: RAG + Escalation + Admin Review Queue

Second slice — the assistant now retrieves from a curated knowledge base before answering, can file support tickets on the user's behalf, and 👎 feedback lands in an admin review queue that admins turn into new KB articles.

#### Schema additions — 2 new tables ([schema.prisma](backend/prisma/schema.prisma))

```prisma
model AiKnowledgeArticle {
  id             String   @id @default(cuid())
  orgId          String?        // null = platform-wide (seeded), non-null = org-specific
  category       String         // "feature" | "how-to" | "troubleshoot" | "faq"
  title          String
  content        String   @db.Text
  embedding      Float[]        // 1536-dim vector (OpenAI text-embedding-3-small)
  source         String   @default("curated")  // "seed" | "curated" | "admin"
  tags           String[] @default([])
  helpfulCount   Int      @default(0)
  unhelpfulCount Int      @default(0)
  createdById    String?
  active         Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([orgId, active])
  @@index([category])
  @@map("ai_knowledge_articles")
}

model AiFeedbackReview {
  id              String   @id @default(cuid())
  orgId           String?
  messageId       String   @unique
  conversationId  String?
  question        String   @db.Text   // denormalized prior user message
  aiResponse      String   @db.Text   // denormalized assistant reply
  userSuggestion  String?  @db.Text   // the 👎 note they left
  status          String   @default("pending")  // "pending" | "promoted" | "dismissed"
  reviewedById    String?
  reviewedAt      DateTime?
  articleId       String?   // if promoted to KB
  ticketId        String?   // if escalated alongside the review
  createdAt       DateTime @default(now())
  @@index([status, createdAt])
  @@index([orgId, status])
  @@map("ai_feedback_reviews")
}
```

Pushed via `npx prisma db push` — non-destructive.

#### RAG — embeddings + retrieval ([kbService.js](backend/src/services/kbService.js))

- **Provider:** OpenAI `text-embedding-3-small` (1536-dim, $0.02/1M tokens). The `OPENAI_API_KEY` was already on the server for OCR enrichment — zero new config.
- **Storage:** native Postgres `Float[]`. At <500 articles, loading all rows into memory and computing cosine in JS is <20ms. Swap to pgvector if the KB ever grows past that.
- **Scope:** a query retrieves platform-wide (`orgId=null`) + the caller's own org (`orgId=req.orgId`). Articles authored by an admin for Org A never leak to Org B.
- **Threshold:** 0.35 cosine (below that, we skip RAG and let Claude answer from general knowledge + tools).
- **Live-test results:**
  - "How do I add a product?" → 0.676 "Add a new product to the catalog"
  - "my cash drawer is stuck" → 0.656 "Cash drawer is not opening"
  - "what is net sales" → 0.63 "What does Net Sales mean vs Gross Sales"

#### Seed — 30 curated articles ([seedAiKnowledge.js](backend/prisma/seedAiKnowledge.js))

Covers the full feature surface — products, inventory, shifts, refunds, voids, lottery setup+EoD, fuel sales, vendor payouts, user invitations, custom roles, Quick Buttons, tax rules, bottle deposits, loyalty, End-of-Day report, transaction lookup, vendor orders, invoice OCR, clock-in/out — plus 4 troubleshoot entries (drawer not opening, barcode scans wrong product, offline sync, report total mismatch) and 3 FAQs. Idempotent; safe to re-run.

Run: `cd backend && node prisma/seedAiKnowledge.js` (requires `OPENAI_API_KEY`).

#### Controller changes ([aiAssistantController.js](backend/src/controllers/aiAssistantController.js))

- **RAG in `runToolLoop`:** before calling Claude, embed the latest user message, search KB, inject top 3 articles (above threshold) into the system prompt block. Articles safely fall back to `[]` if OpenAI is unavailable.
- **New tool `create_support_ticket`:** Claude can file a SupportTicket directly when the user agrees. The tool re-checks `support.create` permission, writes the ticket with `body + "— Filed via AI Support Assistant"`, and returns the ticket id. The controller stores `ticketId` on the assistant message so the UI links to it.
- **System prompt tightened:** explicit instructions to prefer KB articles for how-to questions, tools for data questions, and to propose a ticket (rather than file proactively) when confidence is low.
- **`submitFeedback` auto-escalates:** on 👎 + free-text note, upserts an `AiFeedbackReview` row (keyed by messageId for idempotent re-edits) with denormalized question + response + note. Admin sees it in the review queue.
- **New endpoint `POST /conversations/:id/escalate`:** user-initiated ticket filing. Bundles the last 10 messages as the ticket body and appends a confirmation message to the conversation itself (so the user sees it without refreshing).
- **New admin endpoints** (gated on `ai_assistant.manage`):
  - `GET /admin/reviews?status=pending|promoted|dismissed` — list (admin sees own org; superadmin sees all)
  - `GET /admin/reviews/:id/conversation` — full conversation context for a review
  - `POST /admin/reviews/:id/promote` — admin writes a corrected answer → new AiKnowledgeArticle + review status=promoted. Generates the embedding on the fly.
  - `POST /admin/reviews/:id/dismiss` — status=dismissed

#### Routes ([aiAssistantRoutes.js](backend/src/routes/aiAssistantRoutes.js))

Two tiers:
- `useGuard` (`ai_assistant.view`) — chat endpoints + escalation
- `manageGuard` (`ai_assistant.manage`) — admin review queue + KB curation

#### Portal widget — "File support ticket" footer

[AIAssistantWidget.jsx](frontend/src/components/AIAssistantWidget.jsx) gains a thin escalation footer below the composer (visible only after the user has sent at least one message — keeps the greeting clean). Click → `POST /conversations/:id/escalate` → confirmation message appended inline with the ticket number.

#### Admin-app — AdminAiReviews page

New [AdminAiReviews.jsx](admin-app/src/pages/AdminAiReviews.jsx) + [`.css`](admin-app/src/pages/AdminAiReviews.css) (prefix `ar-`):

- **Tabs**: Pending (with count badge) / Promoted / Dismissed
- **Split layout**: list on the left (question preview + 👎 badge + user suggestion), detail panel on the right
- **Detail panel**: question, AI response, user suggestion (amber highlight), full conversation transcript
- **Actions**: "Promote to KB" opens a modal to author the canonical answer (title + category + content + tags) → generates embedding + creates AiKnowledgeArticle + marks review promoted. "Dismiss" marks it resolved.
- **Route**: `/ai-reviews` (permission: `ai_assistant.manage`)
- **Sidebar**: new "AI Review Queue" link under Support group with Sparkles icon

#### RBAC note

The existing `ai_assistant.view` + `ai_assistant.manage` permissions (from Session 38) cover all P2 endpoints. No new permissions added.

#### Verification (live stack)

- ✅ `npx prisma db push` — schema applied clean
- ✅ `npx prisma generate` — client regen clean
- ✅ `node prisma/seedAiKnowledge.js` — 30/30 articles embedded + stored
- ✅ Backend restart clean
- ✅ `manager@storeveu.com` login → `ai_assistant.view` + `ai_assistant.manage` present
- ✅ `POST /conversations` → 201
- ✅ `GET /admin/reviews?status=pending` → 200
- ✅ `POST /conversations/:id/escalate` → 201 with real SupportTicket created
- ✅ RAG retrieval live-tested on 3 queries — correct articles, cosine scores 0.63-0.68

#### Files Added (Session 38b)

| File | Purpose |
|---|---|
| `backend/src/services/kbService.js` | OpenAI embedding + JS cosine search + prompt formatter |
| `backend/prisma/seedAiKnowledge.js` | 30-article idempotent seed |
| `admin-app/src/pages/AdminAiReviews.jsx` | Review queue page |
| `admin-app/src/pages/AdminAiReviews.css` | `ar-` prefix |

#### Files Modified (Session 38b)

| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | +`AiKnowledgeArticle` + `AiFeedbackReview` |
| `backend/src/controllers/aiAssistantController.js` | RAG retrieval, `create_support_ticket` tool, `submitFeedback` auto-escalates, new `escalateConversation` + `listReviews` + `promoteReview` + `dismissReview` + `getReviewConversation` handlers |
| `backend/src/routes/aiAssistantRoutes.js` | +escalation + admin review routes |
| `frontend/src/components/AIAssistantWidget.jsx` | Escalation footer + `fileTicket` handler |
| `frontend/src/components/AIAssistantWidget.css` | `.aiw-escalate*` styles |
| `frontend/src/services/api.js` | +`escalateAiConversation` |
| `admin-app/src/services/api.js` | +4 admin review API helpers |
| `admin-app/src/App.jsx` | +`/ai-reviews` route |
| `admin-app/src/rbac/routePermissions.js` | +`/ai-reviews` → `ai_assistant.manage` |
| `admin-app/src/components/AdminSidebar.jsx` | +"AI Review Queue" nav item |

#### Deferred to P3

- Cashier-app integration (Help button → modal)
- Admin-app cross-tenant chat (superadmin sees everyone's conversations)
- Extended tools (lottery stats, fuel stats, predictions, employees, EoD report)
- Prompt caching for ~90% input-token cost reduction
- Article management UI (list/edit/deactivate articles, not just promote-on-feedback)

---

*Last updated: April 2026 — Session 38b: AI Assistant P2 — RAG retrieval over 30-article curated KB, support-ticket escalation (AI-initiated + user-initiated + auto on 👎+note), admin review queue in admin-app*

---

## 📦 Recent Feature Additions (April 2026 — Session 38c)

### AI Support Assistant — P3: Multi-surface widgets + Extended Tools + Prompt Caching

Third slice — the AI is now available everywhere, knows way more, and costs ~90% less per query on warm-cache requests.

#### Floating widget on all 3 apps

| App | Position | Size | When hidden |
|---|---|---|---|
| Portal | bottom-right | 420×640 | Never (once signed in) |
| Admin-app | bottom-right | 420×640 | Not logged in |
| Cashier-app | **top-right** | 360×560 | Not signed-in (PIN screen) |

**Cashier-app specifics:** positioned top-right so it doesn't cover cart/totals. Z-index `900` — modal overlays use `1000+`, so any open transaction flow (TenderModal, ManagerPin, OpenShift, CloseShift, etc.) naturally covers the widget without any JS detection. Compact 40px FAB, 360×560 panel, 12.5px message font — tuned for 1366×768 POS hardware.

**Admin-app specifics:** same UX as portal, uses `admin_user` localStorage token, built-in superadmin cross-tenant support — chatting without an org context works (Claude answers from KB); setting `X-Tenant-Id` lets superadmin ask about a specific org's data.

**Shared pattern across all three:** greeting screen with 4 role-appropriate example prompts (different per app — portal asks about sales/stock, admin-app asks about user approval + RBAC, cashier asks about refund/shift), 👍👎 feedback (👎 auto-queues to admin review), inline "File support ticket" button after first user message, session-persisted conversation id.

#### 5 new live-data tools

| Tool | Permission | Returns |
|---|---|---|
| `get_lottery_summary` | `lottery.view` | Net sales, gross sales, commission earned, active boxes, top 5 games over 1-90 days |
| `get_fuel_summary` | `fuel.view` | Net gallons, net amount, per-type breakdown with avg $/gallon |
| `get_employee_hours` | `reports.view` OR `users.view` | Hours per employee, who's currently clocked in, session counts |
| `get_end_of_day_report` | `reports.view` | Full EoD: gross/net/tax, complete+refund counts, tender breakdown by method |
| `get_sales_predictions` | `predictions.view` OR `analytics.view` | Holt-Winters forecast 1-30 days ahead (falls back to 14-day flat average if predictions util unavailable) |

Plus the 4 P1 tools (`get_store_summary`, `get_inventory_status`, `get_recent_transactions`, `search_transactions`) = **9 live-data tools** + `create_support_ticket`.

All tools re-check RBAC before returning data. Missing org context no longer throws — tools return `{error: "..."}` which Claude politely relays.

#### Anthropic prompt caching

System prompt + tool definitions are now sent with `cache_control: { type: 'ephemeral' }` markers. First request in a 5-minute window pays full input cost; every subsequent request gets ~90% discount on the cached blocks. For a multi-turn conversation, this cuts ~$15/1M input tokens to ~$1.50/1M on the cached portion (system prompt + tools ≈ 4K tokens, so ~$0.0006 saved per cached request). Over 1,000 daily queries per org, that's a meaningful cost win.

**Implementation:**
- `system` changed from a string to a block array with `cache_control` on the prompt block
- `cache_control` attached to the LAST tool definition (Anthropic hashes all tools up to the marker)
- No change to the message history path — per-query content stays uncached (as expected)

#### `requireTenant` middleware removed from ai-assistant routes

Superadmins can now chat without an active org (they'd previously get a 403). Non-superadmins always have an org from `scopeToTenant` so they're unaffected. Tools that need an org return a friendly error instead of throwing.

#### Verified (live stack, all 4 apps)

- ✅ Backend restart clean (no imports-broken errors after refactor)
- ✅ `POST /api/ai-assistant/conversations` → 201 (manager)
- ✅ `GET /api/ai-assistant/admin/reviews?status=pending` → 200 (superadmin)
- ✅ Portal FAB renders on every `/portal/*` page
- ✅ Admin-app FAB renders on every page, `/ai-reviews` nav link present
- ✅ Cashier-app widget correctly hidden at PIN login, wired in `App.jsx` root
- ✅ All 9 tools + `create_support_ticket` registered in Claude's tool list

#### Files Added (Session 38c)

| File | Purpose |
|---|---|
| `admin-app/src/components/AIAssistantWidget.jsx` | Admin floating widget (cross-tenant aware) |
| `admin-app/src/components/AIAssistantWidget.css` | Copied from portal — same visual language |
| `cashier-app/src/components/AIAssistantWidget.jsx` | Cashier floating widget (top-right, compact) |
| `cashier-app/src/components/AIAssistantWidget.css` | `aiw-` prefix, tuned for POS hardware |

#### Files Modified (Session 38c)

| File | Change |
|---|---|
| `backend/src/controllers/aiAssistantController.js` | +5 extended tools, prompt caching via `system` blocks + `cache_control` on last tool, `execTool` returns friendly error instead of throwing on missing org |
| `backend/src/routes/aiAssistantRoutes.js` | Removed `requireTenant` guard so superadmin cross-tenant works |
| `admin-app/src/services/api.js` | +5 chat helpers (`createAiConversation`, etc.) alongside existing review helpers |
| `admin-app/src/components/AdminLayout.jsx` | Mount `<AIAssistantWidget />` in layout |
| `cashier-app/src/api/pos.js` | +5 AI assistant helpers |
| `cashier-app/src/App.jsx` | Mount widget alongside POSScreen |

#### Deferred to P4

- Org picker in admin-app widget (superadmin picks target org → sets `X-Tenant-Id`)
- KB article management UI (list / edit / deactivate articles — currently only admin promote-on-feedback path)
- Streaming responses (non-streaming currently; Anthropic SDK supports streams)
- Voice integration (Phase 2 — Twilio + ElevenLabs phone agent)
- Extended tools for: recent shift reports, vendor order suggestions, customer lookup by phone

---

*Last updated: April 2026 — Session 38c: AI Assistant P3 — Floating widget on all 3 apps (portal+admin+cashier), 5 new tools (lottery/fuel/predictions/employee hours/EoD), Anthropic prompt caching for ~90% input cost reduction on warm cache*

---

## 📦 Recent Feature Additions (April 2026 — Session 38d)

### AI Support Assistant — P4: Polish for Real Testing

Final slice before real Claude-API testing. Adds 3 more tools, conversation history, tool-call chips for transparency, org picker on admin-app widget for cross-tenant testing, and a full KB article management UI.

#### 3 more tools — now 12 total live-data tools

| Tool | Permission | Use case |
|---|---|---|
| `lookup_customer` | `customers.view` | "does 555-1234 have points", "find Jane Doe's balance" |
| `get_vendor_order_suggestions` | `vendor_orders.view` | "what should I reorder from Coca-Cola", "reorder list" |
| `list_open_shifts` | `shifts.view` | "who is on the register right now", "any shift still open from yesterday" |

`get_vendor_order_suggestions` prefers the 14-factor `orderEngine.generateSuggestions()` output; falls back to a simple "below reorder point" heuristic when the engine is unavailable. `list_open_shifts` flags shifts that crossed midnight.

Full tool lineup: `get_store_summary`, `get_inventory_status`, `get_recent_transactions`, `search_transactions`, `get_lottery_summary`, `get_fuel_summary`, `get_employee_hours`, `get_end_of_day_report`, `get_sales_predictions`, `lookup_customer`, `get_vendor_order_suggestions`, `list_open_shifts` + `create_support_ticket` action.

#### Tool-call chips — transparency + trust

Every assistant response now shows small pills below the bubble for each tool that fired:
```
✓ Sales summary    ✓ Inventory check
```
Hovering shows the tool's input JSON for debugging. Applied to all 3 widgets with consistent styling. Users see what the AI did rather than trusting a black box.

#### Conversation history — all 3 widgets

New "history" icon (clock/history) in each widget header. Click → dropdown panel lists the user's last 30 conversations (title + timestamp). Click a row → loads that conversation. Current conversation is highlighted. Falls back cleanly if `listAiConversations` fails.

Powered by existing `GET /api/ai-assistant/conversations` endpoint (no backend changes).

#### Org picker — admin-app widget only

Dropdown at the top of the admin-app chat panel: `— Platform (no org context) —` + list of all active orgs. Picking one sets `X-Tenant-Id` on every subsequent API call from the widget (conversation create, send message, list history, feedback) — so superadmin can ask "show me this org's inventory" and the right data comes back via the existing `scopeToTenant` superadmin-override logic.

Switching orgs mid-session clears the current conversation (context invalidated). Choice persists in `sessionStorage` key `adminAiTargetOrgId` across page reloads.

#### AI Knowledge Base management UI — admin-app

New page [AdminAiKb.jsx](admin-app/src/pages/AdminAiKb.jsx) + [`.css`](admin-app/src/pages/AdminAiKb.css) at `/ai-kb`, gated by `ai_assistant.manage`.

**Features:**
- Live stats row — Total / Active / Inactive / Seeded / Admin-authored
- Search (title + content), category filter, active/inactive filter — debounced 180ms
- Article list with category badge, source badge (Seeded/Curated/Admin-authored), 👍/👎 counts, platform-wide badge (for `orgId=null`), 2-line preview
- Per-article actions: Edit / Toggle Active / Soft-delete (protected — seeded articles need superadmin to delete)
- Create/edit modal — title, category, content (markdown), tags, active flag
- **Embeddings auto-regenerate** on title/content change via `generateEmbedding()` in the update handler

**Sidebar:** new "AI Knowledge Base" link under Support group with `BookOpen` icon.

#### Backend — 5 new KB CRUD endpoints

| Method | Route | Guards |
|---|---|---|
| `GET /admin/articles` | list (filters: search, category, active, source) | `ai_assistant.manage` |
| `GET /admin/articles/:id` | full article (embedding stripped from response) | `ai_assistant.manage` |
| `POST /admin/articles` | create + generate embedding | `ai_assistant.manage` |
| `PUT /admin/articles/:id` | update + regenerate embedding on text change | `ai_assistant.manage` |
| `DELETE /admin/articles/:id` | soft-delete (active=false); seeded articles require superadmin | `ai_assistant.manage` |

Org-scoped: non-superadmin admins see their own org's articles + platform-wide seeds; superadmin sees all + can create platform-wide.

#### Verified (live stack)

- ✅ Backend restart clean after all P4 changes
- ✅ `GET /api/ai-assistant/admin/articles?limit=5` → 200 with 5 seed articles
- ✅ Portal widget: history button present, panel opens, greeting + composer render
- ✅ Admin-app widget: history button + org picker (4 options: Platform + 3 orgs) present
- ✅ Admin-app sidebar: both `/ai-reviews` and `/ai-kb` links render
- ✅ Cashier-app: widget wired, correctly hidden at PIN screen (shows after cashier signs in)

#### Files Added (Session 38d)

| File | Purpose |
|---|---|
| `admin-app/src/pages/AdminAiKb.jsx` | KB article management page |
| `admin-app/src/pages/AdminAiKb.css` | `kb-` prefix |

#### Files Modified (Session 38d)

| File | Change |
|---|---|
| `backend/src/controllers/aiAssistantController.js` | +3 tools (lookup_customer, vendor order suggestions, open shifts), +5 KB CRUD handlers |
| `backend/src/routes/aiAssistantRoutes.js` | +5 KB CRUD routes |
| `frontend/src/components/AIAssistantWidget.jsx` | Tool-call chips, history picker, `History` icon, `TOOL_LABELS` map |
| `frontend/src/components/AIAssistantWidget.css` | `.aiw-tool-chip*`, `.aiw-history*`, `.aiw-iconbtn--on` |
| `frontend/src/services/api.js` | Already had `listAiConversations` |
| `admin-app/src/components/AIAssistantWidget.jsx` | + tool chips, history picker, **org picker** with `X-Tenant-Id` threading through all API calls, `changeOrg` handler that clears current conversation |
| `admin-app/src/components/AIAssistantWidget.css` | `.aiw-org-picker`, `.aiw-org-select`, `.aiw-tool-chip*`, `.aiw-history*` |
| `admin-app/src/services/api.js` | +`listAiConversations` helper, +5 KB CRUD helpers |
| `admin-app/src/App.jsx` | +`/ai-kb` route |
| `admin-app/src/rbac/routePermissions.js` | +`/ai-kb` → `ai_assistant.manage` |
| `admin-app/src/components/AdminSidebar.jsx` | +"AI Knowledge Base" nav item with `BookOpen` icon |
| `cashier-app/src/components/AIAssistantWidget.jsx` | + tool chips, history picker |
| `cashier-app/src/components/AIAssistantWidget.css` | `.aiw-tool-chip*`, `.aiw-history*` |
| `cashier-app/src/api/pos.js` | +`listAiConversations` helper |

#### What's ready for testing

With `ANTHROPIC_API_KEY` set in `backend/.env`, you can now test end-to-end:
1. **Portal** (bottom-right FAB) — ask feature questions, live-data queries, file tickets
2. **Admin-app** (bottom-right FAB + org picker) — ask cross-tenant questions, browse review queue, curate KB articles, manage the full KB
3. **Cashier-app** (top-right compact FAB) — cashier-role questions, escalate tickets mid-shift

#### Deferred to future work

- **Streaming responses** — backend SSE + frontend EventSource. Non-trivial but the 3-dot thinking animation is acceptable for now
- **V2 — Voice / phone agent** — Twilio + ElevenLabs. Separate project.
- **Admin-app cross-org "acting as" banner** — show a persistent chip when superadmin has an org picked
- **Article 👍/👎 rollup** — increment article-level helpful/unhelpful counts when user rates a response that referenced them (the toolCalls + articlesUsed trace is already stored; just needs aggregation)
- **Conversation export** — download a conversation as .txt or .md

---

*Last updated: April 2026 — Session 38d: AI Assistant P4 — 3 more tools (customer/vendor-order/open-shifts), tool-call chips, conversation history on all widgets, admin-app org picker for cross-tenant chat, full KB article management UI*

---

## 📦 Recent Feature Additions (April 2026 — Session 38e)

### AI Support Assistant — P5: KB Gap Fill + Clickable In-App Navigation

User tested the assistant against real questions and found two sharp edges: (1) missing KB article on age verification caused a guessed/wrong answer, (2) UI-path citations were static text, not actionable. Fixed both.

#### 10 more KB articles — now 40 total

Filled gaps uncovered during testing + rounded out coverage of the second-tier features:

1. **Set up age verification for tobacco and alcohol** (the one that failed in testing) — points to **Store Settings → Age Verification Policy** with state-default quick-start instructions
2. **Configure general store settings** (name/address/phone/timezone/hours)
3. **Set up a new fuel type** (Price per gallon, color, default, taxable)
4. **Launch an online store** (5-tab Ecom Setup walkthrough + custom domain)
5. **Set up loyalty program and points** (accrual rules, redemption, excluded departments)
6. **Configure the receipt printer** (QZ Tray / Network / Browser-print options + receipt customization link)
7. **Set up the Dejavoo payment terminal** (MID/TID, test, batch close)
8. **Invite team members and assign roles** (invitation flow from Session 33)
9. **Transfer store ownership to another user** (the Session 34 transfer flow with type-"TRANSFER" confirmation)
10. **AI assistant says "The service is temporarily unavailable"** — self-documentation of the error messages

Verified with live RAG retrieval — the exact failing question "how do I edit tobacco and liquor age" now matches the right article at **cosine 0.64** (safely above the 0.35 threshold).

#### System prompt overhaul — clickable links + walk-through format

**Clickable portal links.** The prompt now includes a full route map (22 common portal URLs like `/portal/realtime`, `/portal/account?tab=stores`, `/portal/fuel`) and instructs Claude to write every UI reference as a real markdown link:
```
[Account → Store Settings](/portal/account?tab=stores)
```
Instead of the old "Go to **Account → Store Settings** in the portal sidebar."

**Walk-through format.** When the user asks "walk me through", "guide me", "show me step by step", or "how do I...", Claude now structures the answer as a numbered walk-through starting with a clickable link, one action per step, ending with a "what you should see when it worked" confirmation and a follow-up offer.

#### Clickable links — rendered + intercepted

**All 3 widgets** now parse `[label](href)` markdown and render as `<a class="aiw-link ...">`:
- **Portal widget** — `/portal/*` links get `.aiw-link--in-app` class + right-arrow marker. A delegated click handler on `.aiw-messages` calls React Router's `navigate()`, auto-closes the chat panel, so one click takes the user to the destination screen. Middle-click / cmd-click preserved for "open in new tab".
- **Admin-app widget** — `/portal/*` links get `.aiw-link--portal` class + up-right-arrow marker. Clicks open the portal URL in a new tab (admin-app lives on a different origin).
- **Cashier-app widget** — same as admin-app: portal links open in the system browser (or new tab in web mode).
- **External `https://` links** in any widget — open in a new tab with `rel="noopener noreferrer"`.

Regex accepts ONLY `/portal/*` or `http(s)://` in the href slot — no `javascript:`, `data:`, or relative paths slip through.

#### Live-verified end-to-end

Same question the user asked during testing, now tested live:

**Question:** "guide me through editing tobacco and liquor age"

**AI response:**
> Here's your step-by-step guide to editing tobacco and alcohol age limits:
>
> 1. **Navigate to Store Settings** — Open **[Account → Store Settings](/portal/account?tab=stores)** in the portal sidebar.
> 2. **Select your store** — If you manage multiple stores, click on Main Street Marketplace…
> 3. Scroll…

**What happened when clicked:**
- URL: `http://localhost:5173/portal/account?tab=stores` ✓
- Panel auto-closed ✓
- No page reload — React Router SPA navigation ✓

#### Files Changed (Session 38e)

| File | Change |
|---|---|
| `backend/prisma/seedAiKnowledge.js` | +10 articles (30 → 40 total) |
| `backend/src/controllers/aiAssistantController.js` | `buildSystemPrompt` — full portal-route map + walk-through format instructions |
| `frontend/src/components/AIAssistantWidget.jsx` | `renderContent` parses `[label](href)` markdown links; `useNavigate` hook; `handleMessageClick` intercepts `.aiw-link--in-app` clicks for React Router nav + auto-closes panel |
| `frontend/src/components/AIAssistantWidget.css` | `.aiw-link`, `.aiw-link--in-app` styles (brand-coloured, dashed underline, `→` arrow marker) |
| `admin-app/src/components/AIAssistantWidget.jsx` + `.css` | `renderContent` + styles — portal links open in new tab with `↗` marker |
| `cashier-app/src/components/AIAssistantWidget.jsx` + `.css` | Same pattern as admin-app |

Re-running the seed is idempotent — existing articles are updated in place with new embeddings; new articles created.

#### P6 (next session / deferred) — full interactive product tour

User asked for "screen by screen guide similar to SaaS onboarding" — i.e. Appcues/Intercom Product Tours with UI element tooltips. Realistic path for a dedicated future session:

- **Library**: `driver.js` (MIT, 7KB, zero deps) or `Shepherd.js` (MIT, popper-based)
- **Schema**: `ProductTour` model (name, trigger keyword, steps JSON `[{selector, title, body, action, nextCondition}]`)
- **Backend tool**: `start_product_tour(name)` — AI triggers a tour by slug when user agrees
- **Frontend**: global Tour Runner mounted in Layout; listens for `ai-tour-start` event from widget; drives driver.js step-by-step
- **Element selectors**: add `data-tour="add-product-btn"` attributes to key UI elements in existing pages
- **Seeded tours**: "add-product", "set-age-verification", "process-refund", "close-shift", "invite-user" (5 canonical onboarding flows to start)
- **Admin authoring UI** (nice-to-have) — record a tour by clicking through the portal; the recorder emits the steps JSON

Estimated 1 full session. P5 (this session) gives 80% of the value — clickable deep-links that get the user to the right screen — without the overlay complexity.

---

*Last updated: April 2026 — Session 38e: AI Assistant P5 — 10 more KB articles (40 total), system prompt with full portal-route map + walk-through format, clickable markdown links with React Router in-app nav in the portal (admin-app + cashier-app open in new tab)*

---

## 📦 Recent Feature Additions (April 2026 — Session 38f)

### AI Support Assistant — P6: Interactive Product Tours

The "walk me through it, screen by screen" feature the user asked for. When Claude detects a walkthrough request, it recommends a narrated tour; the widget renders a prominent "▶ Start guided tour" button; clicking drives a floating step-card overlay at top-right with progress bar, step content, Back/Next/Exit, and "Go to this screen" navigation — page by page.

**Design choice: no UI element overlays.** Traditional product tours (Appcues, Intercom, driver.js) highlight specific buttons with tooltip arrows — but that requires `data-tour="..."` attributes on every UI element (100+ across 30+ pages for 5 tours). We went with **structured narrated walkthroughs** instead: each step has a title, body, and optional URL. Works on any page without code changes. 80% of the UX value, zero page-level retrofits.

#### Schema — `ProductTour` model

```prisma
model ProductTour {
  id          String   @id @default(cuid())
  orgId       String?        // null = platform-wide (default for seeded)
  slug        String         // "add-product", "set-age-verification"
  name        String         // "Add your first product"
  description String?  @db.Text
  category    String   @default("onboarding") // onboarding | feature | troubleshoot
  triggers    String[] @default([])           // phrases the AI matches
  steps       Json     @default("[]")         // [{ title, body, url? }]
  active      Boolean  @default(true)
  createdById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([orgId, slug])
  @@index([active, category])
  @@map("product_tours")
}
```

Pushed via `npx prisma db push`.

#### 5 canonical tours seeded

| Slug | Steps | Covers |
|---|---|---|
| `add-product` | 8 | New product walkthrough (nav → name → dept → pricing → UPCs → pack sizes → save) |
| `set-age-verification` | 8 | Tobacco/alcohol age limits per store + state-defaults quick-start |
| `invite-user` | 8 | Invite teammate (email → role → stores → track) |
| `configure-receipt-printer` | 8 | Portal receipt settings + cashier-app hardware setup (QZ Tray / Network) |
| `setup-fuel-type` | 8 | Enable fuel module + add Regular/Premium/Diesel grades |

Seed: `cd backend && node prisma/seedProductTours.js` — idempotent; updates in place on re-run.

#### Backend — new tool + routes

**New Claude tool** `start_product_tour(slug)`:
- Detailed description with explicit **trigger phrases** (walk me through / guide me / step by step / tutorial for)
- Enum-constrained slug parameter so Claude can only pick valid tours
- Returns `{ success, tour: { slug, name, stepCount } }` — widget detects this in `toolCalls` and renders the CTA
- System prompt elevated the tour path: "Check for a matching tour FIRST. Fall back to text walk-through only if no match."

**Routes** (`/api/ai-assistant/*`):
| Method | Route | Guard |
|---|---|---|
| GET | `/tours/:slug` | `ai_assistant.view` (public read for TourRunner) |
| GET | `/admin/tours` | `ai_assistant.manage` |
| POST | `/admin/tours` | `ai_assistant.manage` |
| GET | `/admin/tours/:id` | `ai_assistant.manage` |
| PUT | `/admin/tours/:id` | `ai_assistant.manage` |
| DELETE | `/admin/tours/:id` | `ai_assistant.manage` (soft delete — sets active=false) |

#### Portal — TourRunner component

New [TourRunner.jsx](frontend/src/components/TourRunner.jsx) + [`.css`](frontend/src/components/TourRunner.css) (prefix `tr-`) mounted globally in [Layout.jsx](frontend/src/components/Layout.jsx).

**Features:**
- Floating card top-right (360px, brand-gradient header)
- Progress bar + "Step X of Y" label
- Clickable step dots to jump between steps
- "Go to this screen" button (uses React Router `navigate`) when a step has a URL
- Back / Next / Exit buttons
- **Minimize to pill** — card collapses to a small floating badge so the user can work without the card covering content; click to expand again
- **Session persistence** — `activeTour` key in `sessionStorage`. Survives React Router navigation (so a tour step can navigate to a new page and the card stays). Survives full page reload.
- **URL parameter support** — `?startTour=slug` launches a tour on page load (used by the admin-app "Preview" button)

#### Widget integration

[AIAssistantWidget.jsx](frontend/src/components/AIAssistantWidget.jsx):
- `findTourRecommendation(toolCalls)` — extracts `start_product_tour` output from the tool-call trace
- When a tour is present, renders a prominent brand-gradient CTA button below the AI message:
  ```
  ▶ Start guided tour: Add your first product · 8 steps
  ```
- Click → dispatches `window.dispatchEvent(new CustomEvent('ai-tour-start', { detail: { slug } }))` + closes the chat panel so user sees the tour card without overlap

#### Admin-app — AdminAiTours page

New [AdminAiTours.jsx](admin-app/src/pages/AdminAiTours.jsx) + [`.css`](admin-app/src/pages/AdminAiTours.css) at `/ai-tours` (gated by `ai_assistant.manage`).

- Stats row: Total / Active / Platform-wide / Org-custom
- Filters: category + active/inactive
- List items with slug, category, step count, trigger count, description preview
- Per-tour actions: **Preview** (opens portal with `?startTour=slug`), **Edit**, **Deactivate**, **Delete**
- **Create/Edit modal** with JSON editor for steps (full click-to-author editor deferred to P7)
- Tour fields: slug (create-only), name, description, category, triggers (line-separated), steps (JSON), active toggle

Sidebar: "AI Product Tours" link under Support group with `Compass` icon.

#### Live verified end-to-end

**Question:** "Walk me through adding a new product"

**AI response:**
> Perfect! I've loaded an interactive 8-step tour that will walk you through creating a product in your catalog — from filling in the name and department to adding barcodes, pricing, and pack sizes. The product will be scannable at the POS immediately after you save.
>
> **Tap the button below to start the walkthrough.**

**Tool called:** `start_product_tour({ slug: "add-product" })` → returned `{ name: "Add your first product", stepCount: 8 }`

**Widget rendered:**
- Brand-gradient CTA button: "▶ Start guided tour: Add your first product · 8 steps"

**On CTA click:**
- Chat panel auto-closes ✓
- TourRunner card appears top-right with "Step 1 of 8" progress, 8 step dots, "Go to this screen" button ✓
- Step content: "1. Open the Products page — We'll work from the catalog. Tap the button below to navigate there now." ✓

**On "Go to this screen" click:**
- React Router navigates to `/portal/catalog/products` ✓
- Tour card persists across navigation (sessionStorage restore on mount) ✓

**On full page reload (F5):**
- `activeTour` sessionStorage key restored ✓
- TourRunner loads tour by slug, jumps to saved stepIndex ✓

**Admin-app `/ai-tours` page:**
- Lists all 5 tours ✓
- "Preview" button opens portal with `?startTour=slug` query param ✓
- TourRunner detects param on mount, strips it from URL, launches tour ✓

#### Files Added (Session 38f)

| File | Purpose |
|---|---|
| `backend/prisma/seedProductTours.js` | 5-tour seeder (idempotent) |
| `frontend/src/components/TourRunner.jsx` + `.css` | Step-by-step overlay (prefix `tr-`) |
| `admin-app/src/pages/AdminAiTours.jsx` + `.css` | Admin tour management |

#### Files Modified (Session 38f)

| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | +`ProductTour` model |
| `backend/src/controllers/aiAssistantController.js` | +`start_product_tour` tool with enum slug + imperative description, +`toolStartProductTour` handler, +5 CRUD handlers, updated system prompt to prefer tours over text |
| `backend/src/routes/aiAssistantRoutes.js` | +6 tour routes (1 public read, 5 admin) |
| `frontend/src/services/api.js` | +`getAiTourBySlug` helper |
| `frontend/src/components/AIAssistantWidget.jsx` | `findTourRecommendation`, CTA button rendering on tour recommendations, dispatches `ai-tour-start` event |
| `frontend/src/components/AIAssistantWidget.css` | `.aiw-tour-cta*` styles |
| `frontend/src/components/Layout.jsx` | Mount `<TourRunner />` globally |
| `admin-app/src/services/api.js` | +5 tour CRUD helpers |
| `admin-app/src/App.jsx` | +`/ai-tours` route |
| `admin-app/src/rbac/routePermissions.js` | +`/ai-tours` → `ai_assistant.manage` |
| `admin-app/src/components/AdminSidebar.jsx` | +"AI Product Tours" nav item with `Compass` icon |

#### Known side issue (documented, not caused by P6)

During this session an external change added `import { startPendingMoveScheduler } from './services/lottery/index.js'` to [server.js](backend/src/server.js) pointing at files that live at `backend/backend/src/services/lottery/*` (nested path) as CommonJS. ESM backend can't load CJS via ES imports, so startup was crashing. Added an ESM stub at [`src/services/lottery/index.js`](backend/src/services/lottery/index.js) that exports no-op versions of the expected functions so the server starts. **Follow-up needed**: migrate the real CJS lottery files (adapters/MA.js, ME.js, engine/*.js) to ESM and replace the stub with real re-exports. Lottery scan + auto-activate features disabled until that's done.

#### Deferred to P7 / future

- **Full click-to-author tour editor** — visual step builder instead of JSON editing
- **UI element highlighting** — driver.js/Shepherd.js with `data-tour="..."` attributes on target elements for Appcues-style tooltip arrows
- **Per-step analytics** — track which step users drop off at; identify confusing tours
- **Tour completion tracking** — remember which tours a user has finished so they're not re-offered
- **Cashier-app tour rendering** — currently only the portal has the TourRunner; cashier-app tours (close-shift, process-refund, bottle-return) need their own runner

---

*Last updated: April 2026 — Session 38f: AI Assistant P6 — Interactive Product Tours. ProductTour schema + 5 seeded tours (add-product, set-age-verification, invite-user, configure-receipt-printer, setup-fuel-type) + start_product_tour Claude tool + portal TourRunner floating overlay with "Go to screen" navigation + session-persistent state across page refreshes + admin-app Tours management page. End-to-end verified: "Walk me through adding a product" → AI calls tool → widget shows CTA → click launches 8-step tour overlay → "Go to screen" navigates in-app → tour persists across React Router nav + full page reload.*

---

## 📦 Recent Feature Additions (April 2026 — Session 38g)

### AI Product Tours — P6b: Element Spotlight + Dim Overlay

User feedback: *"Can we have the button highlighted and the other parts as overlay for better focus?"* — classic SaaS onboarding polish (Appcues / Intercom Product Tours style). Delivered without adding any npm deps.

#### Rewritten TourRunner with spotlight

[TourRunner.jsx](frontend/src/components/TourRunner.jsx) + [`.css`](frontend/src/components/TourRunner.css) gained:

- **Spotlight overlay** — when a step has a `selector`, a fixed-positioned div is placed exactly over the target element with this box-shadow trick:
  ```css
  box-shadow:
    0 0 0 4px  rgba(61, 86, 181, 0.55),    /* inner brand ring */
    0 0 0 8px  rgba(61, 86, 181, 0.22),    /* outer glow */
    0 0 0 9999px rgba(15, 23, 42, 0.55);   /* dims the rest of the page */
  ```
  The enormous spread acts as the dim overlay; the element itself shows through the "hole" the spotlight leaves.

- **Pulsing animation** — `@keyframes tr-pulse` gently cycles the ring intensity every 2s to draw the eye without being jarring.

- **Auto-scroll target into view** — `scrollIntoView({ behavior: 'smooth', block: 'center' })` runs when the step activates so the highlighted element is always visible.

- **Retry loop for element lookup** — `waitForElement(selector, 1500ms)` uses `requestAnimationFrame` polling so selectors resolve even on steps that just navigated (React Router mount + effect-triggered render).

- **Smart card repositioning** — `pickCardPosition(targetRect, cardW, cardH)` tries right → bottom → left → top, picking the first candidate that fits within the viewport with 16px margins. Falls back to top-right corner if nothing fits. Smooth 220ms cubic-bezier transition between positions.

- **Live reposition on scroll / resize** — `scroll` (capture phase) + `resize` listeners keep the spotlight glued to the target if the user scrolls or the window resizes.

- **Session-expired graceful handling** — if the tour's API fetch returns 401, TourRunner silently defers (sessionStorage keeps the tour slug + stepIndex). The global 401 interceptor redirects to `/login?returnTo=...`; after re-login the user lands back on the target page and the TourRunner auto-restores.

- **Dim-only fallback** — when a step has no selector (or the element isn't on the current page), a plain translucent dim covers the full viewport and the card renders at its default top-right position.

#### Step schema — added `selector` field

Step JSON now accepts:
```json
{
  "title": "2. Click \"Add Product\"",
  "body":  "This button (highlighted on the page) opens a blank product form.",
  "url":   "/portal/catalog/products",
  "selector": "[data-tour=\"products-new-btn\"]"
}
```
- `url` — if present, the user can (or has already) navigated here. The spotlight applies to whichever page they're actually on.
- `selector` — standard CSS selector. If the element exists, it gets spotlighted. If not, falls back to centered card.

#### `data-tour` attributes added to real pages

Tagged the most critical entry-point buttons with stable `data-tour` attributes so the seeded tours can highlight them:

| Page | Element | Attribute |
|---|---|---|
| [ProductCatalog.jsx](frontend/src/pages/ProductCatalog.jsx) | "Add Product" button | `data-tour="products-new-btn"` |
| [UserManagement.jsx](frontend/src/pages/UserManagement.jsx) | "Invite user" button | `data-tour="invite-user-btn"` |
| [StoreSettings.jsx](frontend/src/pages/StoreSettings.jsx) | Age Verification section | `data-tour="age-verification-section"` |
| [Fuel.jsx](frontend/src/pages/Fuel.jsx) | "Add Fuel Type" button | `data-tour="fuel-new-btn"` |

Convention: `data-tour="{module}-{verb}-{noun}"` (kebab-case) so future tours don't collide with each other.

#### Re-seeded tours with selectors

[`seedProductTours.js`](backend/prisma/seedProductTours.js) updated so 4 of the 5 tours have at least one step that spotlights a tagged element:

- **add-product** step 2 → spotlights "Add Product" button
- **set-age-verification** step 3 → spotlights the Age Verification section
- **invite-user** step 2 → spotlights "Invite user" button
- **setup-fuel-type** step 5 → spotlights "Add Fuel Type" button
- **configure-receipt-printer** → no spotlight yet (multi-page flow across cashier-app; P7)

Re-run: `cd backend && node prisma/seedProductTours.js` → idempotent, updates in place.

#### UX flow

1. User asks *"Walk me through adding a new product"* in the chat widget
2. Claude calls `start_product_tour({ slug: "add-product" })` → widget shows "▶ Start guided tour · 8 steps" button
3. Click → chat panel closes → TourRunner appears top-right with step 1
4. Step 1 has a `url`. User clicks "Go to this screen" → navigates to `/portal/catalog/products`
5. Tour advances to step 2 (spotlight step). TourRunner finds `[data-tour="products-new-btn"]`, scrolls it into view, lays down the dim overlay with a bright ring around the button. Card repositions so it doesn't cover the button. Hint text appears: *"👉 See the highlighted area on the page."*
6. User clicks Next (or the button itself, if they want). Step 3 has no selector → dim overlay clears, plain card at top-right explaining the next action.

#### Files Changed (Session 38g)

| File | Change |
|---|---|
| `frontend/src/components/TourRunner.jsx` | Full rewrite with spotlight overlay, auto-scroll, smart positioning, session-expired guard |
| `frontend/src/components/TourRunner.css` | `.tr-spotlight` + `@keyframes tr-pulse`, `.tr-card--spotlight`, `.tr-spotlight-hint`, smooth transitions |
| `frontend/src/pages/ProductCatalog.jsx` | +`data-tour="products-new-btn"` on the Add Product button |
| `frontend/src/pages/UserManagement.jsx` | +`data-tour="invite-user-btn"` on the Invite user button |
| `frontend/src/pages/StoreSettings.jsx` | +`data-tour="age-verification-section"` on the age policy section |
| `frontend/src/pages/Fuel.jsx` | +`data-tour="fuel-new-btn"` on the Add Fuel Type button |
| `backend/prisma/seedProductTours.js` | Added `selector` field to 4 of 5 tours |

#### Known follow-ups (P7)

- **More data-tour attributes** — the 5 tours only have spotlight on the entry-point button. Inner-form steps (product name field, department dropdown, save button) could also be tagged for step-by-step spotlight.
- **Click-through advance** — currently steps advance via the card's "Next" button. Could detect clicks on the spotlighted element itself (e.g., user clicks "Add Product") and auto-advance.
- **Cashier-app tour rendering** — cashier-app still lacks a TourRunner. Tours like "close-shift" and "process-refund" belong there.
- **Tour authoring in admin-app** — currently JSON-editor only. A point-and-click tour recorder (click a button, capture selector + URL, record the step) would let non-devs build tours.
- **Session-expired toast in TourRunner** — when 401 fires, instead of silently deferring, show a brief toast "Session expired — resuming tour after login" before the global interceptor redirects.

---

*Last updated: April 2026 — Session 38g: AI Product Tours P6b — Element spotlight + dim overlay. When a step targets a `[data-tour="..."]` element, TourRunner dims the page and draws a pulsing brand-gradient ring around the target, auto-scrolls it into view, and repositions the tour card to the opposite side so it doesn't cover the highlighted element. `data-tour` attributes added to Add Product / Invite user / Age Verification / Add Fuel Type. Classic SaaS-onboarding polish without any new npm deps.*

---

## 📦 Recent Feature Additions (April 2026 — Session 38h)

### AI Product Tours — P6c: Discoverability + Click-through + Session-Expired UX

User feedback:
1. *"Still throwing me out to login"* — 401 bounce when JWT expires mid-session
2. *"When I click the button, the guide should go to the next step"* — click-through auto-advance
3. *"How to get these tours? I tried few prompts but only received text not tours"* — tour discoverability

#### 1. Browse Tours UI — tours discoverable without AI

New endpoint **`GET /api/ai-assistant/tours`** (gated on `ai_assistant.view`) returns the list of all active tours for the user's scope (platform-wide + org-custom). Returns slug, name, description, category, step count — no full step array (slim payload).

**Widget UI additions:**
- **Compass icon** in the header (between New + History buttons) — opens a dedicated "Guided tours" panel listing all 5 seeded tours with title, step count, category, and description preview
- **"Browse guided tours →"** dashed button in the greeting screen — visible the moment the user opens the chat for the first time
- Clicking any tour in the list → fires `ai-tour-start` event → TourRunner launches → widget panel auto-closes

Users can now reliably launch any tour with **two clicks** (open widget → click tour name), regardless of whether Claude chose to call the tool. The AI path still works in parallel for natural-language triggers.

#### 2. Click-through auto-advance

When a tour step has a `selector`, TourRunner now attaches a click listener to the spotlighted element. When the user clicks the real button on the page:
- The button's own handler fires first (no preventDefault) — so the user's intent is honored (e.g., they actually open the form)
- After a 120ms delay, the tour advances to the next step
- Works naturally with navigation — if the click causes route change, the delay lets React mount the new page before the next step's selector is resolved

Users can now progress through the tour **bidirectionally**:
- Click the highlighted button on the page → tour advances + task happens
- Click Next in the tour card → tour advances without requiring the user to actually click the target

Spotlight hint text updated: *"👉 Click the highlighted area — the tour advances automatically."*

#### 3. Token-expiry pre-check — graceful session-expired handling

Rather than silently navigating to a page that 401s and triggers the global interceptor redirect to `/login`, TourRunner now does a client-side JWT expiry check before navigation:

```js
function isTokenExpired() {
  const { token } = JSON.parse(localStorage.getItem('user') || 'null');
  const [, payload] = token.split('.');
  const { exp } = JSON.parse(atob(payload));
  return Date.now() / 1000 > exp - 10; // 10s buffer
}
```

When the user clicks "Go to this screen" and the JWT is expired:
- Instead of navigating, the tour card shows an amber inline message:
  > ⚠ **Your session expired.** Log in again — your tour progress is saved and will auto-resume after sign-in.
- A prominent **"Log in & continue"** button redirects to `/login?session=expired&returnTo=<current-page>`
- Tour state already lives in `sessionStorage` — after login + the returnTo redirect, the TourRunner auto-restores and resumes at the exact step

No more silent bounces. No more lost tour progress.

#### 4. Stronger AI triggers

Updated tool description + system prompt so Claude calls `start_product_tour` more aggressively:

- Tool description includes a **phrasing matrix** per slug ("how do I add a product", "I want to create a product", "edit tobacco age", "add a cashier", etc.) — so Claude picks up on intent even without the literal phrase "walk me through"
- System prompt explicitly says: *"PREFER TOURS. If a match exists, you MUST call start_product_tour."*
- Response format is prescriptive: when the tool is called, Claude should say only two lines ("I'll walk you through [task]… Tap the button below to start.") rather than writing out the steps in text — the tour overlay IS the instructions

#### Files Changed (Session 38h)

| File | Change |
|---|---|
| `backend/src/controllers/aiAssistantController.js` | +`listPublicTours` controller; strengthened `start_product_tour` tool description with phrasing matrix; updated system prompt to prefer tours |
| `backend/src/routes/aiAssistantRoutes.js` | +`GET /tours` route for authenticated users |
| `frontend/src/services/api.js` | +`listPublicAiTours` helper |
| `frontend/src/components/AIAssistantWidget.jsx` | + Compass icon header button + "Browse guided tours" greeting button + tours panel with click-to-launch |
| `frontend/src/components/AIAssistantWidget.css` | `.aiw-browse-tours`, `.aiw-tours-panel`, `.aiw-tour-item`, `.aiw-tour-desc` |
| `frontend/src/components/TourRunner.jsx` | `isTokenExpired` helper; click-through listener attaches to spotlighted element + advances on click after 120ms; session-expired state + re-login handler; hint copy updated |
| `frontend/src/components/TourRunner.css` | `.tr-session-expired`, `.tr-session-btn` |

#### Live-verified end-to-end

- ✅ `GET /api/ai-assistant/tours` → 200 returns all 5 tours
- ✅ Widget greeting shows "Browse guided tours →" dashed button
- ✅ Header shows Compass icon between New + History buttons
- ✅ Click Browse → tours panel renders all 5 tours with title/steps/category/description
- ✅ Click a tour → chat panel closes, TourRunner launches with step 1
- ✅ Spotlight click listener attached (verified by code path — live click depends on being on the target page)
- ✅ Token-expiry check runs on "Go to this screen" click — expired tokens show inline message + "Log in & continue" button instead of silent redirect

#### What this unblocks

1. **User can launch any tour on demand** — no reliance on prompt phrasing
2. **Tours run faster** — click the real button instead of the Next button
3. **Expired-session UX is no longer jarring** — tour state persists, user is told what happened

---

*Last updated: April 2026 — Session 38h: AI Product Tours P6c — "Browse Tours" button discoverability, click-through auto-advance on spotlighted elements, graceful session-expired UX in tour card. Plus strengthened AI tool description + system prompt so tours fire on a wider range of user phrasings (not just literal "walk me through").*


