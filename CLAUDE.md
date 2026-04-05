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
| `backend/prisma/schema.prisma` | Full DB schema (35 models) |
| `backend/src/middleware/auth.js` | JWT `protect` + `authorize()` |
| `backend/src/middleware/scopeToTenant.js` | `req.orgId`, `req.storeId` injection |
| `backend/src/controllers/lotteryController.js` | Full lottery module logic |
| `backend/src/controllers/posTerminalController.js` | Cashier app API (creates transactions, handles lottery items) |
| `backend/src/controllers/feeMappingController.js` | Service fees and delivery charges |
| `backend/src/controllers/catalogController.js` | Product catalog CRUD |
| `backend/src/controllers/salesController.js` | Analytics + Holt-Winters predictions |

### Portal (frontend/)
| File | Purpose |
|------|---------|
| `frontend/src/App.jsx` | All route (portal + marketing) definitions |
| `frontend/src/components/Sidebar.jsx` | Nav links — add new pages here |
| `frontend/src/services/api.js` | Single source of truth for ALL API calls |
| `frontend/src/pages/marketing/` | Public site: Home, About, Features, Pricing, Contact |
| `frontend/src/pages/Lottery.jsx` | Full lottery management (8 tabs) |
| `frontend/src/pages/FeesMappings.jsx` | Service fees and tax mapping |
| `frontend/src/pages/POSSettings.jsx` | Per-station POS config (saved to IndexedDB) |
| `frontend/src/pages/ProductCatalog.jsx` | Native PG catalog management |

### Cashier App (cashier-app/)
| File | Purpose |
|------|---------|
| `cashier-app/src/screens/POSScreen.jsx` | Main POS screen — 3-zone layout |
| `cashier-app/src/stores/useCartStore.js` | Cart state (Zustand) — add item types here |
| `cashier-app/src/stores/useShiftStore.js` | Shift open/close state |
| `cashier-app/src/stores/useLotteryStore.js` | Lottery session tracking |
| `cashier-app/src/components/pos/ActionBar.jsx` | Bottom action bar (all quick-action buttons) |
| `cashier-app/src/components/tender/TenderModal.jsx` | Checkout / payment processing |
| `cashier-app/src/components/modals/LotteryModal.jsx` | Combined Sale+Payout modal (latest) |
| `cashier-app/src/components/modals/LotteryShiftModal.jsx` | EOD ticket scan reconciliation |
| `cashier-app/src/hooks/usePOSConfig.js` | POS settings from IndexedDB |
| `cashier-app/src/api/pos.js` | All cashier-app API calls |
| `cashier-app/src/db/dexie.js` | IndexedDB schema for offline catalog |

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
- `MasterProduct` — org-level product catalog
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
- Inline styles throughout (no CSS modules, no Tailwind in cashier-app)

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

### Dev Start
```bash
# All apps at once (from root)
npm run dev

# Or individually
npm run dev:backend
npm run dev:frontend
npm run dev:cashier
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
3. **Inline styles in cashier-app** — no CSS files, no Tailwind, inline only
4. **Portal modals use explicit `#ffffff`** — CSS vars go transparent in overlay modals
5. **Respect multi-tenancy** — every DB query must filter by `orgId` and `storeId`
6. **Lottery price is sacred** — never allow manual override of ticket price in the cashier flow
7. **Activated boxes are immutable** — never delete or allow UI to delete active/depleted boxes
8. **Commission is store-level** — never store commission on individual games
9. **State-scoped games** — global games (isGlobal=true) are visible only to stores whose `LotterySettings.state` matches the game's `state` field
10. **Ask before big refactors** — this is a production-adjacent system; discuss before restructuring

---

*Last updated: April 2026 — Lottery Module complete*
