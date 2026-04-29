# Storeveu POS — Cashier Terminal (Electron + PWA)

A fast, full-featured, and offline-first Point of Sale terminal designed for high-performance retail checkout. Available as an **Electron desktop app** (Windows) or **Progressive Web App**, with native hardware integration for receipt printers, cash drawers, barcode scanners, scales, and PAX payment terminals.

---

## ⚡ Tech Stack

| Component | Technology |
|---|---|
| **Core** | React 18, Javascript (ESM) |
| **Desktop** | Electron 33 (IPC for USB printing, drawer, app control) |
| **Packaging** | Electron Builder (NSIS installer, Windows x64) |
| **State Management** | Zustand 5 (stores: auth, cart, shift, station, manager, lottery, fuel, sync) |
| **Offline Storage** | **Dexie.js** v5 (IndexedDB — products, tx queue, departments, promotions, cashiers, held carts) |
| **Receipt Printing** | ESC/POS (USB via PowerShell, Network TCP, QZ Tray fallback) |
| **Hardware** | Barcode scanners (HID/Serial), Magellan scales, PAX terminals, ZPL label printers |
| **PWA Readiness** | Manifest.webmanifest, Service Workers (Vite PWA Plugin) |
| **Build Tool** | Vite 5 |

---

## 🏗️ Architecture

The terminal is designed for zero-latency lookups by syncing a snapshot of the **PostgreSQL native catalog** to the device's local memory.

1. **Station Setup:** On first load, the manager registers the browser as a persistent "Station" via the back-office.
2. **Catalog Sync:** The terminal fetches a full catalog snapshot via `/api/pos-terminal/catalog/snapshot` and stores it in **IndexedDB**. Sync cadence: 15 min auto + on login + manual button. Supports **tombstones** (deleted product IDs returned in `deleted[]` for incremental sync) and **replace semantics** for small tables (departments, promotions, tax rules, deposit rules — wiped + bulk-put each sync).
3. **PIN Login:** Cashiers enter their 4–8 digit PIN to authenticate a local session. Backend uses **tiered lookup** — `UserStore.posPin` (per-store override) wins over `User.posPin` (org-wide fallback), so owners can set their own per-store PIN without a duplicate account (Session 36).
4. **Transaction Buffer:** During sales, transactions are stored in a local queue and synced to the server in the background. Backend forces `status: 'complete'` on every accepted sale (Session 28 fix — was previously silently storing cash sales as `pending` and hiding them from reports).

---

## 🛤️ Backend Integration

All communication with the server happens through the **POS Terminal API** (`/api/pos-terminal`):

- `GET /catalog/snapshot` — Full product list for sync.
- `POST /pin-login` — PIN-based authentication.
- `POST /transactions` — Real-time transaction submission.
- `POST /transactions/batch` — Bulk sync for offline transactions.
- `GET /branding` — Dynamic logo and color pallet fetch.

---

## 🛠️ Getting Started

```bash
cd cashier-app
npm install
npm run dev
```
The terminal will start on `http://localhost:5174`.

### Installation
To install as a desktop application on Windows:
1. Open the URL in Google Chrome or Microsoft Edge.
2. Click the **"App available"** icon in the address bar.
3. Select **Install**.

---

## Folder Structure

```
cashier-app/
├── electron/
│   ├── main.cjs            → Electron main process (IPC: printer, drawer, app control)
│   └── preload.cjs         → Context bridge (window.electronAPI)
├── public/                 → PWA assets (manifest, icons)
├── src/
│   ├── api/
│   │   ├── client.js       → Axios instance (Bearer + Station token headers)
│   │   └── pos.js          → All cashier API calls
│   ├── services/
│   │   ├── printerService.js → ESC/POS receipt builder (receipt + EoD report) + printing
│   │   └── qzService.js    → QZ Tray WebSocket client
│   ├── components/
│   │   ├── cart/           → CartItem (on-hand badge, fuel/bottle-return rendering), CartTotals, BagFeeRow
│   │   ├── layout/         → StatusBar (age-check chips), StoreveuLogo
│   │   ├── modals/         → 20+ modals (Tender, Lottery, Fuel, Refund, Void, OpenItem, CustomerLookup,
│   │   │                     EndOfDay, CloseShift, CashDrawer, VendorPayout, BottleRedemption,
│   │   │                     ManagerPin, PackSizePicker, AgeVerification, AddProduct, Discount,
│   │   │                     HoldRecall, TransactionHistory, ReprintReceipt, PriceCheck, Coupon,
│   │   │                     ProductFormModal — full back-office parity, ConfirmModal — themed
│   │   │                     replacement for window.confirm via useConfirmDialog hook)
│   │   ├── pos/            → ActionBar (scrollable), CategoryPanel, NumPad, QuickButtonRenderer,
│   │   │                     ChangeDueOverlay (unified 5s auto-close post-sale screen)
│   │   └── tender/         → TenderModal, ReceiptModal
│   ├── db/
│   │   └── dexie.js        → IndexedDB v5 (products, txQueue, departments, promotions, cashiers, held carts)
│   ├── hooks/              → usePOSConfig, useFuelSettings, useQuickButtonLayout, useCatalogSync,
│   │                         useBranding, useHardware, useScanner, useScale, useOnlineStatus,
│   │                         useBroadcastSync (customer display)
│   ├── screens/            → POSScreen, PinLoginScreen, StationSetupScreen, StoreSelect,
│   │                         LoginScreen, CustomerDisplayScreen (hash route /#/customer-display)
│   ├── stores/             → Zustand: auth, cart, shift, station, manager, lottery, fuel, sync
│   └── utils/              → Tax calc, promo engine, formatters, PDF-417 parser, cash presets,
│                              sound.js (error beep), digitsToDisplay/digitsToNumber cent helpers
├── index.html              → Entry HTML
└── vite.config.js          → PWA and build configuration
```

---

## 🛠️ Setup & Development

### Prerequisites
- Node.js 18+
- Storeveu POS Backend running on `:5000`

### Installation
```bash
cd cashier-app
npm install
```

### Environment Setup
Copy `.env.example` → `.env`:
```env
VITE_API_URL=http://localhost:5000/api
VITE_PORTAL_URL=http://localhost:5173    # used by "Back Office" PIN-SSO into the portal
```
For the production NSIS build use `.env.production` with the cloud URLs.

### Running Locally (Web)
```bash
npm run dev
```
The terminal will be available at **http://localhost:5174**.

### Running as Electron App
```bash
npm run electron:dev     # Dev mode (Vite + Electron concurrent)
```

### Building for Production

**PWA (Web):**
```bash
npm run build            # dist/ folder with service worker
```

**Electron (Windows Desktop):**
```bash
npm run electron:build         # Production NSIS installer — uses .env.production (cloud API)
npm run electron:build:local   # Local installable build — uses .env (localhost API)
npm run electron:pack          # Unpacked app (no installer, for testing)
```

| Script | Env file | API URL baked in | Use for |
|--------|---------|------------------|---------|
| `npm run electron:dev` | `.env` | `http://localhost:5000/api` | Local dev with live reload |
| `npm run electron:build:local` | `.env` | `http://localhost:5000/api` | Local installed build |
| `npm run electron:build` | `.env.production` | `https://api.storeveu.com/api` | Cloud/production deploy |

App ID: `com.storeveu.pos` | Persistent config: `%APPDATA%/storeveu_station.json`

---

## Key Features
- **Fast Scanning:** Optimized for HID-compliant USB/Bluetooth barcode scanners + serial port via QZ Tray. **Scan gating** — scans are rejected (with error beep) while TenderModal is open, and dismiss the ChangeDueOverlay to start a fresh sale.
- **Mobile Camera Scanner:** `BarcodeScannerModal` uses native `BarcodeDetector` API (Chromium) with `@zxing/browser` CDN fallback (iOS Safari). No dependency needed at install time (Session 36).
- **Quick-Cash Bypass:** Quick cash buttons ($10, $20, exact, smart presets, plain CASH) bypass TenderModal entirely — single tap completes the sale, opens drawer, shows `ChangeDueOverlay` with 5-second auto-close.
- **Smart Deposits + Bottle Return:** Per-product deposit calculation; bottle return adds negative cart lines via `addBottleReturnItems` (not a standalone refund tx). TenderModal handles net-negative carts as refunds.
- **EBT Support:** Flags eligible items and separates EBT vs Non-EBT totals.
- **Bag Fee Row:** Configurable bag (+/−) counter pinned above payment buttons; stored as synthetic `isBagFee: true` line item in the Transaction JSON.
- **PIN Security:** Rapid cashier switching via 4–8 digit PIN (offline-capable with cached PIN hashes). Tiered lookup supports per-store PINs via `UserStore.posPin`.
- **Manager PIN Session:** Gated actions (refund, void, no-sale, Back Office, discount ≥ threshold) prompt for manager PIN; session cached 10 min.
- **Back Office PIN-SSO:** "Back Office" action in ActionBar opens the portal in a new tab, authenticated **as the manager who entered the PIN** via `/impersonate?token=JWT` (Session 37b). No stale session hijacking.
- **Lottery Integration:** Unified sale/payout modal with qty-based locked pricing and automated EOD box reconciliation. "Lotto Shift" button + close-shift interception when `scanRequiredAtShiftEnd=true`.
- **Fuel Module (Session 23):** Fuel Sale + Fuel Refund buttons when store has fuel enabled. Amount or Gallons entry mode, 3-decimal $/gallon locked to FuelType config, preview shows the other side live.
- **Quick Buttons Tab (Session 37):** POS home screen supports CATALOG / BUTTONS / FOLDERS tabs. BUTTONS tab renders the per-store WYSIWYG layout (products, 1-level folders, actions, text, images) at exact (x,y,w,h) positions configured from the portal.
- **Store-Level Age Policy:** Tobacco + Alcohol age limits configured per-store in portal StoreSettings (e.g. `{21, 19}` for Ontario). StatusBar shows two age-check date chips (Tobacco 21+ / Alcohol 19+) that override per-product `ageRequired`.
- **Customer Display (second screen):** Hash route `/#/customer-display` renders a read-only customer-facing screen. POS → display sync via `BroadcastChannel('storv-customer-display')` — zero latency. Electron auto-opens fullscreen on secondary monitor.
- **Branded UI:** Dynamically pulls store logos and theme colors from the portal.
- **Receipt + EoD Printing:** Full ESC/POS builder for receipts AND End-of-Day reports. USB (PowerShell/winspool), Network TCP, and QZ Tray transports.
- **Cash Drawer:** Auto-kick on cash tender, manual via No Sale (logs a POS event).
- **Weight Scales:** Magellan/Datalogic serial via Web Serial API; auto-fill quantity on scalable items.
- **PAX Terminals:** Card payment integration via backend API proxy (A920, A35, A80, S300).
- **Multi-UPC Support:** Products can have multiple barcodes via `ProductUpc` table; backend search checks UPC table first.
- **Pack Size Picker:** Products with multiple `ProductPackSize` rows (Single, 6-Pack, 12-Pack) show `PackSizePickerModal` at scan.
- **Hold/Recall:** Unlimited simultaneous parked transactions stored in IndexedDB.
- **Offline Mode:** Full offline sales capability with batch sync on reconnect. Cashier-app transaction queue uses local `status: 'pending'` for sync tracking only — backend forces `status: 'complete'` on write.
- **Promotion Engine:** Client-side evaluation of sales, BOGO, volume, mix & match, and combo deals.
- **Age Verification:** PDF-417 driver's license scanning + manual DOB entry; uses store-level policy.
- **On-Hand Badge:** Cart line items show current stock with colour tiers (green/amber/red) when store-scoped `quantityOnHand` is available.
- **Midnight Shift Handling:** Backend `shiftScheduler` auto-closes shifts past store-local midnight every 10 min (Session 19b). Cashier-app shows an amber banner if a lingering pre-midnight shift is detected.

---

---

## 🖨️ Hardware Integration

The cashier app ships with a full **ESC/POS hardware layer** that works completely offline, without QZ Tray or browser print dialogs. All hardware is configured once per station via **Back Office → Point of Sale → Stations → Hardware**.

---

### How it Works

Hardware configuration is saved to **localStorage** under the key `storv_hardware_config`. On every print/drawer/payment action the app reads this config and routes the command through the correct path:

```
User Action
    │
    ▼
useHardware hook (reads localStorage)
    │
    ├─── Electron desktop app? ──────► window.electronAPI (IPC to main process)
    │                                       ├─ printUSB    → PowerShell → winspool.drv
    │                                       └─ printNetwork → Node.js net.Socket (TCP)
    │
    ├─── Network printer (browser)? ──► POST /api/pos-terminal/print-network
    │                                       └─ Backend → TCP Socket → Printer
    │
    └─── QZ Tray (browser fallback)? ─► QZ Tray bridge → USB driver
```

---

### Supported Hardware

#### Receipt Printers

| Connection Type | How it Prints | Requirements |
|---|---|---|
| **USB (Windows)** | Electron → PowerShell → `winspool.drv` raw print | Windows only. Printer must appear in **Devices and Printers** by exact name. |
| **Network (TCP/IP)** | Electron or Backend → TCP socket on port `9100` | Printer must have a static IP on the local network. |
| **QZ Tray (browser)** | Browser → QZ Tray bridge → USB driver | QZ Tray installed and running. Used as browser fallback only. |

**Supported protocols:** ESC/POS (standard). Works with virtually any thermal receipt printer:
- Epson TM series (TM-T20, TM-T88, etc.)
- Star TSP series
- Bixolon SRP series
- Citizen CT-S series
- Generic 58mm / 80mm thermal printers

**Paper widths:** `80mm` (42 chars) and `58mm` (32 chars) — set per store in Back Office → Receipt Settings.

---

#### Cash Drawer

| Connection | How it Opens |
|---|---|
| **Via receipt printer (USB)** | Electron → PowerShell → ESC/POS `DRAWER_KICK` pulse via winspool |
| **Via receipt printer (Network)** | Electron → TCP socket → ESC/POS `DRAWER_KICK` |
| **QZ Tray** | QZ Tray → USB driver → `DRAWER_KICK` |

Cash drawer kicks automatically on every cash tender. Also available via **No Sale** button (manager PIN required).

---

#### Barcode Scanners

Any **HID-compliant** USB or Bluetooth barcode scanner works without additional configuration — the scanner emulates keyboard input and the app captures it via a global `keydown` listener with timing logic to distinguish scanner input (fast) from human typing (slow).

- 1D barcodes (UPC-A, UPC-E, EAN-13, Code 128, etc.) — fully supported
- 2D barcodes (QR, DataMatrix) — captured as raw string, matched against PLU/UPC
- **Magellan scale scanners** (USB Serial) — integrated via Web Serial API with configurable baud rate

---

#### Weighing Scales

Magellan/Datalogic USB serial scales are supported via **Web Serial API** (Chrome/Edge only):

- Configured in Hardware Settings → Scale → type `magellan`
- Baud rate: typically `9600`
- Auto-reconnects to previously granted serial ports on app start
- Weight automatically fills the quantity field when a scalable item is selected

---

#### PAX Card Terminals

PAX payment terminals integrate via the backend API proxy (no direct browser-to-terminal connection):

| Setting | Value |
|---|---|
| Terminal IP | Local network IP of the PAX device |
| EDC Type | `02` = Credit, `01` = Debit (configurable) |
| Auth flow | Sale initiated via `/api/pos-terminal/pax/sale` → backend polls PAX for result |

Supported PAX models: A920, A35, A80, S300 (any model reachable via local IP).

---

### Station Hardware Setup (Step-by-Step)

1. **Open Back Office** → Point of Sale → Stations
2. Select or create a station for this register
3. Click **Hardware Settings**
4. Configure each section:

```
Receipt Printer
  Type:     [ USB | Network | None ]
  Name:     (USB) Exact printer name from Windows Devices and Printers
  IP:       (Network) e.g. 192.168.1.100
  Port:     (Network) 9100

Cash Drawer
  Type:     [ Via Printer | None ]

Scale
  Type:     [ Magellan | None ]
  Baud:     9600

PAX Terminal
  Enabled:  [ Yes | No ]
  IP:       e.g. 192.168.1.150
```

5. Click **Save** — config writes to localStorage immediately
6. Use **Test Receipt** to verify end-to-end printing

---

### Receipt Settings (Per Store)

Managed in **Back Office → Point of Sale → Receipt Settings**:

| Setting | Options |
|---|---|
| **Print behaviour** | `Always` — auto-print after every sale · `Ask` — prompt cashier · `Never` — no auto-print |
| **Paper width** | `80mm` (default) · `58mm` |
| **Store info** | Name, address, phone, email, website, Tax ID |
| **Header lines** | Two custom lines printed above items |
| **Footer lines** | Two multi-line footer fields (supports `\n` for line breaks) |
| **Return policy** | Optional block printed at the bottom |
| **Show/hide** | Cashier name, Transaction ID, Item count, Tax breakdown, Savings |
| **Theme & branding** | Primary colour, logo text — synced to POS UI |

Receipt settings are stored in the `store.branding` JSON column in PostgreSQL and synced to the cashier app via `/api/pos-terminal/branding`.

---

### Print Performance

**USB printers** use PowerShell + `winspool.drv` raw printing. A compiled C# assembly (`sv_rawprint_v2.dll`) is **cached in the Windows temp folder** after the first print:

| Print job | Time |
|---|---|
| First ever print (compiles DLL) | ~2–3 seconds |
| All subsequent prints (loads cached DLL) | ~200–400 ms |

To reset the cache (e.g. after a Windows update), delete `%TEMP%\sv_rawprint_v2.dll`.

**Network printers** open a fresh TCP connection per job (typically 50–200 ms on LAN).

---

### ESC/POS Receipt Content

The following data is included on every printed receipt (toggleable per store):

```
[Store Name — large bold]
[Address / Phone / Email / Website]
[Tax ID]
[Header Line 1 & 2]
─────────────────────────────────────
Cashier: Jane          Date: ...
Ref: TXN-20260405-000044
─────────────────────────────────────
2× Organic Milk                $7.98
   Discount                   -$1.00
Coca-Cola 2L                   $2.49
─────────────────────────────────────
Subtotal                      $10.47
Tax (6%)                       $0.63
Deposit/CRV                    $0.10
TOTAL                         $11.20
─────────────────────────────────────
CASH                          $15.00
CHANGE                         $3.80
─────────────────────────────────────
[Footer Line 1]
[Footer Line 2]
[Return Policy]
[Item count]
✂ (partial cut)
```

**End of Day Report** also prints directly to the receipt printer (no browser dialog):
- Net Sales (large)
- Gross Sales / Tax / Refunds
- Tender breakdown (Cash, Card, EBT, etc.)
- Sales by cashier
- Clock-in / Clock-out events

---

### Hold & Recall (Multiple Transactions)

The POS supports **unlimited simultaneous parked transactions** stored in IndexedDB (offline-safe):

| Action | How |
|---|---|
| **Park current cart** | Tap **Hold** → optionally type a label (e.g. "Table 4") → tap "Hold Current Cart" |
| **See all parked carts** | Tap **Hold** — badge shows count e.g. `Hold (2)` |
| **Resume any cart** | Tap ▶️ next to the one you want |
| **Serve multiple customers simultaneously** | Hold A → recall B → serve B → hold B → recall A → continue |
| **Delete a hold** | Tap 🗑️ next to it |

Held transactions survive browser refresh and app restarts (stored in IndexedDB via Dexie.js).

---

### Transaction History

Past transactions are accessible from two places:

| Location | How to access | Capabilities |
|---|---|---|
| **Cashier App** | Tap **History** button in bottom action bar | Browse by date, view detail, reprint to hardware |
| **Back Office** | Point of Sale → Transactions | Browse by date, search by TXN#/cashier/item, view full breakdown |

---

## 🚀 Electron Production Deployment (Step-by-Step)

### Prerequisites
- **Node.js 18+** installed on the build machine
- **Windows 10/11 x64** (for building the NSIS installer)
- Backend API deployed and accessible (e.g. `https://api-pos.thefortunetech.com`)

### Step 1: Configure Production API URL

Edit `cashier-app/electron/main.cjs` — update the production URL that the Electron app loads:

```js
// In createWindow(), the production branch:
if (isDev) {
  win.loadURL('http://localhost:5174');  // dev
} else {
  win.loadFile(path.join(__dirname, '../dist/index.html'));  // production
}
```

Ensure `cashier-app/.env` (or `.env.production`) has the correct API base:
```env
VITE_API_URL=https://api-pos.thefortunetech.com/api
```

### Step 2: Install Dependencies

```bash
cd cashier-app
npm install
```

### Step 3: Build the Vite Frontend + Electron Installer

```bash
npm run electron:build
```

This runs two steps sequentially:
1. `vite build` — compiles React app into `cashier-app/dist/`
2. `electron-builder` — packages `dist/` + `electron/` into a Windows NSIS installer

### Step 4: Locate the Installer

After the build completes, find the output in:

```
cashier-app/dist-electron/
├── Storeveu POS Setup 1.0.0.exe    ← NSIS installer (distribute this)
├── win-unpacked/                     ← Unpacked app (for testing)
└── builder-effective-config.yaml     ← Build config used
```

### Step 5: Install on Target POS Machine

1. Copy `Storeveu POS Setup 1.0.0.exe` to the target Windows PC
2. Run the installer — it allows choosing the install directory
3. After installation, a desktop shortcut **"Storeveu POS"** is created
4. Launch the app — it opens fullscreen (kiosk mode) in production

### Step 6: Station Setup (First Launch)

1. App loads the built-in web UI from `dist/index.html`
2. Cashier/manager selects their store and registers the station
3. Hardware settings (printer IP, cash drawer, scale) are configured
4. Config is persisted to `%APPDATA%/storeveu_station.json`

---

### Build Configuration Reference

| Setting | Value |
|---------|-------|
| **App ID** | `com.storeveu.pos` |
| **Product Name** | `Storeveu POS` |
| **Output Dir** | `dist-electron/` |
| **Windows Target** | NSIS installer (x64) |
| **Persistent Config** | `%APPDATA%/storeveu_station.json` |
| **Window** | 1280x800, fullscreen in production |
| **Context Isolation** | Enabled (secure IPC via preload) |
| **Node Integration** | Disabled (all IPC through `window.electronAPI`) |

### Available npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm run dev` | `vite` | Web-only dev server on `:5174` |
| `npm run electron:dev` | `concurrently "vite" "wait-on ... && electron ..."` | Vite + Electron dev mode |
| `npm run electron:build` | `vite build && electron-builder` | Production NSIS installer |
| `npm run electron:pack` | `electron-builder --dir` | Unpacked app (no installer, for testing) |

### Updating a Deployed App

Currently, auto-update is not configured. To update:
1. Build a new installer with `npm run electron:build`
2. Distribute the new `.exe` to each POS machine
3. Run the installer — it overwrites the previous installation

### Troubleshooting

| Issue | Solution |
|-------|---------|
| **Blank screen after build** | Check `VITE_API_URL` in `.env.production`; ensure `base: './'` in `vite.config.js` |
| **Printer not found** | Verify printer name matches exactly in Windows **Devices and Printers** |
| **First USB print slow (~3s)** | Normal — PowerShell compiles `sv_rawprint_v2.dll` on first use; cached after |
| **Network printer timeout** | Confirm printer IP is reachable; check port 9100 not blocked by firewall |
| **App not fullscreen** | In production `fullscreen: true` is set; in dev it's windowed for debugging |

---

## 🔮 Future Expansion Scope

### Hardware
- [ ] **Label / shelf-edge printer** (Zebra ZPL) — ESC/POS builder exists, network path ready; needs UI in Hardware Settings
- [ ] **Customer-facing display (VFD/LCD pole display)** — Serial or network protocol; show item name + price + total
- [ ] **Fingerprint reader** — Replace PIN login with biometric authentication
- [ ] **Weight-based pricing for more scale brands** — Currently Magellan only; extend to Mettler-Toledo, CAS, Accu-Weigh via RS-232
- [ ] **QR code / NFC payment** — Scan-to-pay; open TCP listener or poll payment provider webhook
- [ ] **Integrated scanner-scale combo** — Single USB device handling both barcode scan and weight simultaneously

### Receipt & Printing
- [ ] **Logo on receipt** — ESC/POS supports `GS v 0` raster graphics; add base64 logo → bitmap conversion
- [ ] **QR code on receipt** — Print a QR linking to digital receipt URL using `GS (k)` command
- [ ] **Digital receipt (email/SMS)** — Send PDF or plain-text receipt via backend after transaction
- [ ] **Kitchen printer** — Second receipt printer for kitchen/prep orders; separate ESC/POS stream
- [ ] **Split receipt printing** — Print one receipt per payment method for split tender

### Payments
- [ ] **Stripe Terminal** — Replace PAX with Stripe Reader SDK (web-based, no IP config needed)
- [ ] **Square Reader** — Square Terminal SDK integration
- [ ] **Gift cards** — Scan card → backend checks balance → apply as tender line
- [ ] **Store credit / loyalty points** — Redeem points as partial payment

### POS Operations
- [ ] **Table / order management** — Assign holds to table numbers; visual floor map
- [ ] **Kitchen display system (KDS)** — WebSocket push to kitchen screen on sale complete
- [ ] **Age verification camera** — Webcam + ID scan for age-restricted items
- [ ] **Self-checkout mode** — Customer-facing UI on second monitor; cashier approves remotely
- [ ] **Offline sync retry queue UI** — Show pending offline transactions count with retry button
- [ ] **Multi-language UI** — i18n support for Spanish, French, etc.

### Reporting
- [ ] **Shift report print** — Print close-shift summary to receipt printer
- [ ] **Z-tape / X-tape** — Classic EOD/mid-day drawer count report
- [ ] **Hourly sales graph on receipt** — Sparkline-style bar chart using ESC/POS block chars

---

## Related Documentation
- [Root README](../README.md) — Full project ecosystem
- [Portal Frontend](../frontend/README.md) — Management & Analytics
- [Backend API](../backend/README.md) — Terminal endpoints
- [Project Overview](../ProjectOverview.md) — High-level product overview
- [Engineering Principles](../ENGINEERING_PRINCIPLES.md) — Code standards
