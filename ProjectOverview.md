# 🚀 Future Foods Business Portal — Project Overview

The Future Foods Business Portal is a comprehensive, multi-tenant POS and management ecosystem designed for retail and gas station operations. It bridges the gap between traditional IT Retail systems and modern cloud-based analytics, providing real-time visibility and advanced forecasting.

---

## 🗺️ System Map (Sidebar Navigation)

| Category | Module | Status | Description |
| :--- | :--- | :--- | :--- |
| **Operations** | `Live Dashboard` | ✅ Active | Today's sales + weather (Auto-refresh) |
| | `Customers` | ✅ Active | CRM, Loyalty points, House Accounts |
| | `Invoice Import` | ✅ Active | AI-powered PDF/Image OCR processing |
| | `CSV Transformer`| ✅ Active | Legacy vendor file format conversion |
| **Catalog** | `Products` | ✅ Active | **Native PostgreSQL Catalog** management |
| | `Departments` | ✅ Active | Sales & Tax class groupings |
| **Analytics** | `Sales` | ✅ Active | Daily/Weekly/Monthly/Yearly charts |
| | `Products` | ✅ Active | Movement analysis & top-sellers |
| | `Predictions` | ✅ Active | Holt-Winters triple exponential forecasting |
| | `Residuals` | ✅ Active | Forecasting model validation & MAPE/RMSE |
| **Integrations** | `POS API` | ✅ Active | MarktPOS v2 live search & credentials |
| | `Vendor Orders` | ✅ Active | Automated reordering recommendations |
| | `eComm` | ⏳ Planned | Online storefront & delivery integration |
| **Point of Sale** | `POS Settings` | ✅ Active | Terminal layout, Quick-keys, & behavior |
| | `Branding` | ✅ Active | Logo, Colors, & Themes for PWA app |
| | `Stations` | ✅ Active | Register terminal registration & heartbeat |
| | `Transactions` | ✅ Active | Real-time POS log audit trail |
| **Account** | `Employee Reports`| ✅ Active | Comprehensive sales stats per staff member |
| | `Organisation` | ✅ Active | Multi-tenant billing & global settings |
| | `Users` | ✅ Active | Role-based access control (RBAC) |
| | `Stores` | ✅ Active | Multi-location setup & geo-mapping |

---

## 🛠️ Feature Breakdown

### 1. Operations: Native POS Catalog
The system maintains a high-performance **PostgreSQL** shadow catalog of the entire store inventory. This enables instant search, bulk pricing updates, and rich metadata (EBT eligible, Bottle deposits) that may be missing from the primary POS system.

### 2. Operations: Invoice OCR Import
A custom-built hybrid OCR pipeline. Azure Document Intelligence handles the initial layout extraction from vendor PDFs, while GPT-4o-mini Vision identifies complex column headers and matches them to the POS catalog using a 6-tier matching algorithm.

### 3. Analytics: Weather-Correlated Sales
The only retail portal that merges historical weather data (temp, precipitation, WMO code) with sales figures. This helps managers understand why sales fluctuated (e.g., "Beer sales dropped 30% because of the storm") and prepare for upcoming weather events.

### 4. Analytics: Holt-Winters Predictions
Advanced time-series forecasting. The triple exponential smoothing model accounts for level, trend, and seasonality, boosted by Day-of-Week (DOW) adjustment factors to handle weekend surges accurately.

### 5. Point of Sale: Cashier PWA
A lightweight, offline-first Progressive Web App designed for the retail checkout lane.
- **Offline Sync:** Uses Dexie (IndexedDB) to store thousands of products locally.
- **PIN Login:** Fast cashier switching via 6-digit PIN.
- **PWA Manifest:** Can be "installed" on Windows/Android tablets for full-screen use.

---

## 🛣️ Roadmap & Future Work

### ✅ Completed (Q1 2026)
- **PostgreSQL Migration:** Moved core data from MongoDB to PostgreSQL for performance and relational integrity.
- **Multi-Terminal API:** Built the backend infrastructure for the native PWA Cashier.
- **Employee Reporting:** Added sub-module for per-cashier sales performance.
- **100-Product Seed:** Complete baseline catalog for testing and development.

### ⏳ In Progress (Q2 2026)
- **Offline Batch Sync:** Finalizing the conflict-resolution logic for transactions taken during internet outages.
- **Print Service:** Integration with Star Micronics and EPSON thermal printers for receipt generation.

### 🔮 Planned (Q3 2026)
- **eComm Integration:** Syncing the PostgreSQL catalog to a customer-facing online shop.
- **Inventory Variance:** "Theoretical vs. Actual" stock level reporting from invoice data.
