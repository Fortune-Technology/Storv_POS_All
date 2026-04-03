# 🏧 Future Foods — Cashier Terminal (PWA)

A fast, lightweight, and offline-first Point of Sale interface designed for high-performance retail checkout. Built as a **Progressive Web App** leveraging the **Future Foods Backend API**.

---

## ⚡ Tech Stack

| Component | Technology |
|---|---|
| **Core** | React 18, Javascript (ESM) |
| **State Management** | Zustand (Global App State) |
| **Offline Storage** | **Dexie.js** (IndexedDB wrapper for Catalog Sync) |
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

## 📁 Folder Structure

```
cashier-app/
├── public/                 → PWA assets (manifest, icons)
├── src/
│   ├── api/                → Axios interceptors and terminal endpoints
│   ├── components/         → UI elements (Numpad, Cart, ProductCards)
│   ├── db/                 → Dexie database schema and sync logic
│   ├── hooks/              → Custom hooks for scanning and pricing
│   ├── screens/            → POSScreen, PinLogin, StationSetup
│   ├── stores/             → Zustand stores (useCartStore, useAuthStore)
│   └── utils/              → Formatting, tax calculations, and barcode helpers
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

### Running Locally
```bash
npm run dev
```
The terminal will be available at **http://localhost:5174**.

### Building for Production (PWA)
```bash
npm run build
```
The `dist/` folder will contain the production-ready PWA with a generated service worker.

---

## 🔑 Key Features
- **Fast Scanning:** Optimized for HID-compliant USB/Bluetooth barcode scanners.
- **Smart Deposits:** Automatically calculates Maine-specific bottle deposits based on product size.
- **EBT Support:** Flags eligible items and separates EBT vs Non-EBT totals.
- **PIN Security:** Rapid cashier switching without full credential entry.
- **Branded UI:** Dynamically pulls store logos and theme colors from the portal.

---

## 📄 Related Documentation
- [Root README](../README.md) — Full project ecosystem
- [Portal Frontend](../frontend/README.md) — Management & Analytics
- [Backend API](../backend/README.md) — Terminal endpoints
