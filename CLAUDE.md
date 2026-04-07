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
| `backend/prisma/schema.prisma` | Full DB schema (36+ models) |
| `backend/src/middleware/auth.js` | JWT `protect` + `authorize()` |
| `backend/src/middleware/scopeToTenant.js` | `req.orgId`, `req.storeId` injection |
| `backend/src/controllers/lotteryController.js` | Full lottery module logic |
| `backend/src/controllers/posTerminalController.js` | Cashier app API (creates transactions, handles lottery items) |
| `backend/src/controllers/feeMappingController.js` | Service fees and delivery charges |
| `backend/src/controllers/catalogController.js` | Product catalog CRUD |
| `backend/src/controllers/salesController.js` | Analytics + Holt-Winters predictions |
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

*Last updated: April 2026 — Session 6: Clock-in/out duplicate state guard, Employee Timesheet tab with PDF export, Sidebar scroll persistence fix*

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

- [ ] **Electron desktop build (.exe)**
  ```bash
  cd cashier-app
  npm run electron:dev      # dev mode (Vite + Electron together)
  npm run electron:build    # produces dist-electron/StoreVeu POS Setup.exe
  ```
  Ensure `package.json` has `electron`, `electron-builder` deps and `main` entry. Build target: Windows NSIS installer.

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
