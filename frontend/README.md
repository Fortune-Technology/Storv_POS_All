# 🎨 Future Foods Portal — Frontend

A premium, dark-themed management portal for Future Foods store owners and managers. Built with **React 19**, **Vite 7**, and **Redux Toolkit**.

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

## 📁 Folder Structure

```
frontend/
├── public/              → Static assets (favicon, manifest)
├── src/
│   ├── assets/          → Logos and imagery
│   ├── components/      → Shared UI elements (Sidebar, Layout, DatePicker)
│   ├── pages/           → Module-specific views
│   │   ├── RealTimeDashboard.jsx
│   │   ├── SalesAnalytics.jsx
│   │   ├── ProductCatalog.jsx
│   │   ├── EmployeeReports.jsx
│   │   └── ...
│   ├── services/        → Centralized Axios API instances
│   ├── store/           → Redux slices and RTK Query hooks
│   ├── utils/           → Helpers (weather icons, formatters)
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
A high-integrity management system for scratch-ticket inventory, box activation, and automated EOD reconciliation.

### 6. Public Marketing Site
A high-performance promotional site with landing pages and product feature deep-dives, optimized for SEO.

### 7. Employee Reports
Comprehensive sales performance analytics per staff member, linked to the native POS transaction logs.

---

## 🛠️ Getting Started

```bash
cd frontend
npm install
npm run dev
```
Runs the dev server on `http://localhost:5173`.
