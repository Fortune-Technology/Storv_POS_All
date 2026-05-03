# 📄 Invoice Import & Processing System Architecture

## 1. System Overview

### Purpose
The **Invoice Import & Processing System** is designed to automatically ingest, parse, validate, and store invoice data from uploaded image/PDF files. Leveraging advanced OCR technology and Large Language Models (LLM/GPT), the system extracts granular invoice data, categorizes items, and seamlessly maps it to our internal Point of Sale (POS) structure.

### Key Capabilities
- **Multi-format Support**: Ingests standard document formats (.pdf, .jpg, .png).
- **Intelligent Extraction**: Uses OCR combined with AI to interpret layout-agnostic invoices.
- **Automated Structuring**: Normalizes unstructured text into a predictable schema (Items, Costs, Totals, Deposits).
- **Multi-Invoice Splitting**: Identifies when a single uploaded file contains multiple separate invoices.

### Supported Invoice Types
- Standard Product Invoices
- Credit Memos / Return Invoices
- Multi-page Invoices
- Mixed Consignments (Sale + Credit)

---

## 2. High-Level Architecture

### Backend Components
- **API Gateway / Router**: Receives multipart form data (files) and delegates processing.
- **Processing Controller**: Orchestrates the multi-step extraction/validation pipeline.
- **Storage Layer**: PostgreSQL tables (via Prisma) for normalized invoices and parsed line items.

### Service Layers
- **Upload Service**: Handles file sanity checks, size limits, and temporary storage.
- **Extraction Service (OCR + AI)**: Coordinates the passing of visual/text data to external APIs and parses the raw JSON return.
- **Mapping Service**: Formats extracted fields strictly against the database model.

### External Dependencies
- **OCR Engine**: Extracts raw text coordinates and bounding boxes.
- **AI Extraction (GPT-4o or equivalent)**: Interprets context, identifies columns, classifies line items.
- **Cloud Storage (Optional)**: S3 or similar for storing raw uploaded invoice blobs.

---

## 3. End-to-End Flow (Step-by-Step)

1. **Upload**: User securely uploads an invoice via the frontend portal (`POST /api/invoice/upload` or `/queue`).
2. **Pre-processing**: System creates a stub record with **status: 'processing'** and responds immediately with the ID.
3. **Async Extraction**: The extraction pipeline runs in the background using `setImmediate` to avoid blocking the request cycle.
4. **OCR / AI Extraction**: Document is passed to Azure/GPT layers to pull structured JSON data.
5. **Splitting & Normalization**: JSON is analyzed to split multi-invoice documents and normalize keys.
6. **Business Logic Application**: Deposits, credits, and totals are validated and calculated.
7. **Database Storage**: The stub is updated to **status: 'draft'** with all extracted line items.
8. **User Review**: The user verifies data in the split-pane review UI.
9. **User Review (Session 21 UX)**: Totals recompute live — `totalInvoiceAmount = Σ (caseCost × quantity)` updates on every line edit; per-line `totalAmount` auto-recalculates unless the user manually overrides (`_totalLocked` flag). A top-bar chip shows aggregate received units (`+1,248 units · 23 products`) across all lines.
10. **Cases/Units toggle (Session 21)**: Each line has a `receivedAs: 'cases' | 'units'` segmented control. Live preview strip: *"On confirm, inventory will increase by +240 units (5 cases × 48/case)"*. On confirm, `adjustStoreStock` uses `receivedAs === 'cases' ? qty × packUnits : qty` — fixes the long-standing bug where a 5-case × 24-pack delivery added only 5 units to QOH instead of 120.
11. **POS Synchronization**: On "Confirm", the system upserts the validated products into the native PostgreSQL **MasterProduct** and **StoreProduct** tables (via Prisma). Legacy IT Retail bulk-push (`PUT /pos/products/:id/details`) remains available but native PostgreSQL is now the primary catalog. Invoice status → **'synced'**.
12. **Learning Feedback**: Confirmed matches are recorded in `VendorProductMap` to improve future OCR accuracy.

---

## 4. Processing Pipeline (Core Section)

### OCR Layer (Azure Document Intelligence)
- **Purpose**: Convert images/documents into structured text and layout data.
- **Engine**: `prebuilt-invoice` model (Azure AI Form Recognizer).
- **Output**: Multi-layered JSON containing key-value pairs and table structure.

### AI Extraction Layer (GPT-4o-mini Enrichment)
- **Purpose**: Interpret raw text from Azure to classify specialized columns (DEP, NET, SSP).
- **Engine**: OpenAI `gpt-4o-mini` (Text-only tokens).
- **Key Logic**: High-speed schema mapping to identify pack formats, unit types, and specialized beverage metrics without re-processing images.

### Splitting Engine
- **Purpose**: Handle grouped invoices submitted as one file.
- **Input**: Unstructured JSON.
- **Output**: Array of distinct invoice objects.
- **Key Logic**: Detects changes in invoice numbers, distinct dates, or specific "page 1 of 1" markers per vendor.

### Normalization Engine
- **Purpose**: Standardize string formats, dates, and numbers.
- **Input**: Distinct invoice object strings.
- **Output**: Typed data (Floats, ISODates, Lowercase strings).
- **Key Logic**: Strips currency symbols (`$` -> ``), parses dates to ISO strings, standardizes vendor names.

### Filtering Engine
- **Purpose**: Remove noise (blank lines, header text misclassified as items).
- **Input**: Normalized invoice object.
- **Output**: Cleaned invoice object.
- **Key Logic**: Drops any line item without a valid quantity and unit price.

### Detection Engines (Type, Columns)
- **Purpose**: Identify contextual properties of the invoice and its table.
- **Input**: Cleaned arrays.
- **Output**: Boolean flags (`isCredit`) and mapped keys (`priceColumn`, `qtyColumn`).
- **Key Logic**: If the word "Credit Memo" exists or total is negative, flag as credit. Use heuristics to identify which column represents unit price vs extended price.

### Calculation Engine
- **Purpose**: Determine exact financial totals per item and document.
- **Input**: Mapped line items.
- **Output**: Final financial representation.
- **Key Logic**: `Line Total = Qty * Unit Price`. 

### Validation Engine
- **Purpose**: Ensure mathematical integrity.
- **Input**: Calculated totals.
- **Output**: Pass/Fail or Correction log.
- **Key Logic**: `Sum(Line Totals) + Taxes + Fees == Invoice Total`.

### Deposit Handling
- **Purpose**: Isolate bottle deposits, keg deposits, or environmental fees.
- **Input**: Validated line items.
- **Output**: Separated deposit fees vs product costs.
- **Key Logic**: Identifies keywords like "CRV", "Deposit", "Bottle Tax" and applies them to a separate ledger field instead of total product cost.

### Priority Matching Engine (rewritten in Session 21 — vendor-scoped)

- **Purpose**: Bridge the gap between invoice identifiers and internal POS records.
- **7-tier cascade** (see [`backend/src/services/inventory/matching.ts`](backend/src/services/inventory/matching.ts) — Session 55 moved this from `services/matchingService.ts` into the inventory domain folder; the legacy path still works via a shim):

| # | Tier | Key | Confidence |
|---|------|-----|-----------|
| 1 | UPC (+ variants) | UPC exact | high |
| 2 | **Distributor ItemCode, vendor-scoped** ★ PRIMARY | `vendorId::itemCode` | high |
| 3 | VendorProductMap (learned) | vendor + code / fuzzy desc | high / medium |
| 4 | PLU exact (produce) | `plu` | high |
| 5 | Cross-store GlobalProductMatch | vendor + code | medium |
| 6 | Cost-proximity + composite fuzzy | multiple signals | medium / low |
| 7 | AI batch (gpt-4o-mini) | LLM using top fuzzy candidates | medium only |

- **Internal `MasterProduct.sku` tier removed** — vendor invoices never reference our internal SKU, so this tier caused false positives without ever helping (Session 21).
- **Vendor scoping**: index keyed as `${vendorId}::${itemCode}` prevents Hershey's `2468231329` colliding with Utz's `27149` or Coca-Cola's `115583`. When `invoice.vendorId` is known, fuzzy / cost / AI tiers also narrow to that vendor's products (cutting AI token cost).
- **Org-wide fallback**: when `invoice.vendorId` is null, itemCode lookup falls back at medium confidence (flagged for review, never high).
- **Vendor resolution on upload**: the upload UI has a "Vendor (optional)" dropdown; unresolved vendors get resolved via `resolveVendorId(orgId, vendorName)` (exact name → alias → fuzzy contains → reverse contains). Resolved `vendorId` persisted on the `Invoice` row.
- **Re-match endpoint**: `POST /api/invoice/:id/rematch { vendorId?, force? }` — safe mode preserves manual + high-confidence matches; force mode re-matches everything.
- **Manual tier**: user-link via live POS global search with status badges (High/Medium/Low confidence) and source tier indicators.

### Mapping Engine
- **Purpose**: Finalize structure for POS ingestion and audit.
- **Input**: Fully processed internal structures with POS overrides.
- **Output**: Strict `Invoice` database schema with `mappingStatus` flags and direct POS API updates.
- **Key Logic**: Executes `Promise.allSettled` to push pricing and pack updates to the IT Retail backend for all matched line items.

---

## 5. Data Model

### Invoice Structure (`Invoice`)
```javascript
{
  invoiceNumber: String,
  vendorId: Int?,       // Session 21 — resolved Vendor FK, powers vendor-scoped matching
  date: Date,
  type: Enum['SALE', 'CREDIT'],
  status: Enum['PENDING', 'PROCESSED', 'FAILED'],
  totals: {
    subtotal: Number,
    tax: Number,
    deposits: Number,
    grandTotal: Number   // recomputed live on edit; Σ(caseCost × qty) per line
  },
  aiConfidenceScore: Number
}
// Session 21 index: @@index([orgId, vendorId])
```

### Line Items (`lineItems` in `Invoice`)
- **Structure**:
```javascript
{
  upc: String,
  itemCode: String,
  plu: String,
  description: String,
  quantity: Number,
  receivedAs: String, // 'cases' | 'units' (Session 21) — drives QOH increment
  packUnits: Number,  // units per case, used when receivedAs === 'cases'
  unitType: String,   // 'case' | 'unit' (legacy)
  caseCost: Number,
  unitCost: Number,
  suggestedRetailPrice: Number,
  mappingStatus: Enum['matched', 'unmatched', 'manual', 'new'],
  confidence: Enum['high', 'medium', 'low'],
  linkedProductId: String
}
```

---

## 6. Business Rules & Logic

- **Sale vs Credit Handling**: Standard invoices add to inventory costs; credit memos represent vendor refunds and invert value calculations.
- **Summary vs Line-item Priority**: If `Sum(Line Items) != Document Total`, the line items take precedence, and a warning flag is raised for manual review.
- **Deposit Rules**: Deposits are strictly excluded from "Cost of Goods Sold" margin calculations and placed in temporary holding tables.
- **Total Validation Rules**: A tolerance of ±0.05 is allowed for rounding errors during extraction string manipulation.

---

## 7. Error Handling & Edge Cases

- **OCR Failures**: Reject document gracefully, prompting user for manual entry or clearer re-upload.
- **Missing Fields**: If essential fields (`Invoice Number`, `Total`) are missing, flag status as `NEEDS_ATTENTION` instead of failing entirely.
- **Duplicate Invoices**: Engine queries `Invoice` table by `(vendor, invoiceNumber, orgId)`. If found, prompts user to overwrite or discard.
- **Multi-page Invoices**: Uses page numbering (`1 of 3`) to stitch arrays before passing to mapping engine.

---

## 8. Performance & Scalability

- **Async Processing**: Extraction and saving run asynchronously. Users receive a "Processing..." ticket ID and poll for updates via WebSocket or SSE.
- **Queue System (Future-Ready)**: Implementation of RabbitMQ/Redis Bull to handle thousands of concurrent OCR tasks without blocking the main event loop.
- **Batch Uploads**: Supports uploading ZIP arrays up to 50MB, processing sequentially in background pools.

---

## 9. Logging & Debugging

### What to Log
- Extracted raw JSON (sanitized).
- Time taken per extraction layer dynamically (`console.time`).
- Math discrepancies (`Expected X, Got Y`).

### Debug Strategy
- Use unique trace IDs per upload session.
- Store "failed" raw OCR blobs in a secure `/debug` bucket for prompt tuning.

---

## 10. Security & Validation

- **File Validation**: MIME-type checking (reject `.exe`, `.bash`). Magic number inspection for genuine PDFs/JPEGs.
- **Input Sanitization**: Escape raw strings to prevent SQL/Prompt Injection. Length limits on text fields. Prisma prepared statements prevent SQL injection.

---

## 11. Future Enhancements

- **Confidence Scoring**: Exposing the LLM's certainty per field to highlight questionable entries in yellow on the UI.
- **Vendor-Specific Templates**: Allow saving specific bounding-box templates for recurring major vendors to bypass expensive AI processing.
- **Batch Reconciliation**: Tools to reconcile multiple invoices against a single vendor statement or bank transaction.
