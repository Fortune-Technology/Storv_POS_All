# StoreVeu POS — Cashier Terminal (Electron + PWA)

A fast, full-featured, and offline-first Point of Sale terminal designed for high-performance retail checkout. Available as an **Electron desktop app** (Windows) or **Progressive Web App**, with native hardware integration for receipt printers, cash drawers, barcode scanners, scales, and PAX payment terminals.

---

## ⚡ Tech Stack

| Component | Technology |
|---|---|
| **Core** | React 18, Javascript (ESM) |
| **Desktop** | Electron 33 (IPC for USB printing, drawer, app control) |
| **Packaging** | Electron Builder (NSIS installer, Windows x64) |
| **State Management** | Zustand 5 (7 stores: auth, cart, shift, station, manager, lottery, sync) |
| **Offline Storage** | **Dexie.js** v4 (IndexedDB — products, tx queue, departments, promotions, cashiers) |
| **Receipt Printing** | ESC/POS (USB via PowerShell, Network TCP, QZ Tray fallback) |
| **Hardware** | Barcode scanners (HID/Serial), Magellan scales, PAX terminals, ZPL label printers |
| **PWA Readiness** | Manifest.webmanifest, Service Workers (Vite PWA Plugin) |
| **Build Tool** | Vite 5 |

---

## 🏗️ Architecture

The terminal is designed for zero-latency lookups by syncing a snapshot of the **PostgreSQL native catalog** to the device's local memory.

1. **Station Setup:** On first load, the manager registers the browser as a persistent "Station" via the back-office.
2. **Catalog Sync:** The terminal fetches a full catalog snapshot via `/api/pos-terminal/catalog/snapshot` and stores it in **IndexedDB**.
3. **PIN Login:** Cashiers enter their 6-digit PIN to authenticate a local session.
4. **Transaction Buffer:** During sales, transactions are stored in a local queue and synced to the server in the background.

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
│   │   ├── printerService.js → ESC/POS receipt builder + printing
│   │   └── qzService.js    → QZ Tray WebSocket client
│   ├── components/
│   │   ├── cart/            → CartItem, CartTotals
│   │   ├── layout/         → StatusBar, StoreveuLogo
│   │   ├── modals/         → 15+ modals (Lottery, Tender, Refund, Void, etc.)
│   │   ├── pos/            → ActionBar, CategoryPanel, NumPad
│   │   └── tender/         → TenderModal, ReceiptModal
│   ├── db/
│   │   └── dexie.js        → IndexedDB v5 (products, txQueue, departments, promotions, cashiers)
│   ├── hooks/              → 8 hooks (scanner, scale, hardware, catalog sync, branding, etc.)
│   ├── screens/            → POSScreen, PinLogin, StationSetup, StoreSelect, Login
│   ├── stores/             → 7 Zustand stores (auth, cart, shift, station, manager, lottery, sync)
│   └── utils/              → Tax calc, promo engine, formatters, PDF-417 parser, cash presets
├── index.html              → Entry HTML
└── vite.config.js          → PWA and build configuration
```

---

## 🛠️ Setup & Development

### Prerequisites
- Node.js 18+
- Future Foods Portal Backend running on `:5000`

### Installation
```bash
cd cashier-app
npm install
```

### Environment Setup
Create a `.env` file:
```env
VITE_API_URL=http://localhost:5000/api
```

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
npm run electron:build   # NSIS installer in dist-electron/
npm run electron:pack    # Unpacked app (no installer)
```

App ID: `com.storeveu.pos` | Persistent config: `%APPDATA%/storeveu_station.json`

---

## Key Features
- **Fast Scanning:** Optimized for HID-compliant USB/Bluetooth barcode scanners + serial port via QZ Tray.
- **Smart Deposits:** Automatically calculates bottle deposits based on product size and container type.
- **EBT Support:** Flags eligible items and separates EBT vs Non-EBT totals.
- **PIN Security:** Rapid cashier switching via 4-6 digit PIN (offline-capable with cached PIN hashes).
- **Lottery Integration:** Unified sale/payout modal with qty-based pricing and automated EOD box reconciliation.
- **Branded UI:** Dynamically pulls store logos and theme colors from the portal.
- **Receipt Printing:** Full ESC/POS receipt builder with USB (PowerShell), Network TCP, and QZ Tray support.
- **Cash Drawer:** Auto-kick on cash tender via ESC/POS command, manual via No Sale button.
- **Weight Scales:** Magellan/Datalogic serial scales via Web Serial API with auto-fill quantity.
- **PAX Terminals:** Card payment integration via backend API proxy (A920, A35, A80, S300).
- **Hold/Recall:** Unlimited simultaneous parked transactions stored in IndexedDB.
- **Offline Mode:** Full offline sales capability with batch sync on reconnect.
- **Promotion Engine:** Client-side evaluation of sales, BOGO, volume, mix & match, and combo deals.
- **Age Verification:** PDF-417 driver's license scanning + manual DOB entry.

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
