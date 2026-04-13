# Storeveu POS — Portal Frontend

A premium, dark-themed management portal for Storeveu POS store owners and managers. Built with **React 19**, **Vite 7**, and **Redux Toolkit**.

---

## ✨ Design Philosophy

- **Glassmorphism:** Frosted glass backgrounds with vibrant accent gradients.
- **Dark Mode First:** Deep charcoal backgrounds for maximum visual comfort.
- **Dynamic Interactions:** Subtle hover micro-animations and smooth transitions.
- **Mobile Responsive:** All modules adapt to tablet and mobile viewports.

---

## ⚡ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Core** | React 19, Javascript (ESM) |
| **Build Tool** | Vite 7 |
| **State Management** | Redux Toolkit (RTK Query) |
| **Routing** | React Router v6 |
| **Charts** | Recharts (Dual-axis charts) |
| **Icons** | Lucide React |
| **Styling** | Vanilla CSS (Glassmorphism design system) |

---

## Folder Structure

```
frontend/
├── public/              → Static assets (favicon, manifest)
├── src/
│   ├── assets/          → Logos and imagery
│   ├── components/      → Shared UI (Sidebar, Layout, Navbar, StoreSwitcher, SetupGuide, SEO)
│   ├── contexts/        → React contexts (StoreContext)
│   ├── pages/           → Module-specific views (45+ pages)
│   │   ├── marketing/   → Home, About, Features, Pricing, Contact
│   │   ├── Lottery.jsx  → Full lottery portal (8 tabs)
│   │   ├── ReceiptSettings.jsx → Per-store receipt configuration
│   │   ├── RealTimeDashboard.jsx
│   │   ├── SalesAnalytics.jsx
│   │   ├── ProductCatalog.jsx
│   │   ├── ProductForm.jsx → Product create/edit
│   │   ├── BulkImport.jsx → CSV/Excel bulk import
│   │   ├── Transactions.jsx → POS audit log
│   │   ├── StoreManagement.jsx
│   │   ├── StoreBranding.jsx
│   │   └── ...
│   ├── services/        → Centralized Axios API instances
│   ├── store/           → Redux slices
│   ├── utils/
│   │   ├── formatters.js  → Shared formatting utilities (currency, dates, percentages)
│   │   └── exportUtils.js → CSV/PDF download helpers
│   ├── App.jsx          → Main router and route definitions
│   └── main.jsx         → Entry point
├── index.html           → Base HTML template
└── package.json         → Frontend dependencies
```

---

## 🚀 Key Modules

### 1. Real-Time Dashboard
A live status board that auto-refreshes every 60 seconds with current sales data, weather conditions, and trend analysis.

### 2. POS Product Catalog
The master management interface for the native PostgreSQL product database. Allows managers to edit pricing, inventory, and compliance flags (EBT, Age Check).

### 3. Invoice OCR Import
A side-by-side review panel that uses Azure Intelligence and GPT-4o-mini to extract line items from PDFs and match them to the POS catalog.

### 4. Sales Predictions
Uses Holt-Winters Triple Exponential Smoothing to forecast future sales based on historical trends, seasonal patterns, and day-of-week factors.

### 5. Lottery & Compliance
A high-integrity management system for scratch-ticket inventory, box activation, and automated EOD reconciliation (8 tabs: Overview, Games, Inventory, Active Tickets, Shift Reports, Reports, Commission, Settings).

### 6. Public Marketing Site
A high-performance promotional site with landing pages and product feature deep-dives, optimized for SEO (Home, About, Features, Pricing, Contact).

### 7. Employee Reports
Comprehensive sales performance analytics per staff member, linked to the native POS transaction logs.

### 8. Receipt Settings
Per-store receipt configuration: print behaviour, paper width, store info, custom header/footer lines, return policy, branding sync.

### 9. Store & Station Management
Multi-store CRUD with branding, location/geo-mapping, and per-station hardware configuration (printers, scales, PAX terminals).

### 10. Bulk Import
CSV/Excel product import pipeline with preview, validation, column mapping, and batch commit.

### 11. Fee & Deposit Management
Service fee mapping (bottle deposit, bag fee, alcohol surcharge) and cross-store deposit rules.

### 12. Shared Layout & Persistent Sidebar
All portal routes are nested under a shared `Layout.jsx` wrapper that renders the `Sidebar` once and uses React Router's `Outlet` for page content. The sidebar persists across all navigation and scrolls independently from the main content area.

### 13. SEO Component
`components/SEO.jsx` provides consistent meta tag management (title, description, Open Graph) across all marketing and portal pages.

### 14. Shared Formatters
`utils/formatters.js` provides centralized currency, date, and percentage formatting utilities used across all portal pages for consistent display.

---

## 🛠️ Getting Started

```bash
cd frontend
npm install
npm run dev
```
Runs the dev server on `http://localhost:5173`.
