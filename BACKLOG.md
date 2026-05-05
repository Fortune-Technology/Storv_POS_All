# Storv POS — Master Backlog

**Last updated:** 2026-05-04 (S71f — F31 vendor cover-day soft floor (Factor #15) shipped; preview/sync storeId-from-header fix)
**Owner:** nishant@future
**Companion file:** [CLAUDE.md](CLAUDE.md) — long-form historical record of completed work

---

## Working agreement

1. Pick one item from this file
2. Flip its status to `[~]` In Progress
3. Ship end-to-end (code + verify + update CLAUDE.md per the existing "Recent Feature Additions" pattern)
4. Flip to `[x]` Done and move the row to "Recently Completed" at the bottom of this file
5. Repeat — one item at a time

## Status legend
- `[ ]` Open
- `[~]` In Progress
- `[x]` Done (move to Recently Completed)

## Effort key
- **S** = <½ session (a few hours)
- **M** = 1 full session
- **L** = 2–3 sessions
- **XL** = 4+ sessions, multi-week scope

---

## 🐛 Bugs

| ID | Status | Item | Effort | Source |
|---|---|---|---|---|

---

## 🧪 Sanity / Testing

| ID | Status | Item | Effort | Source |
|---|---|---|---|---|
| T2 | `[ ]` | EBT / Food stamp integration verification — TenderModal split, eligibility flow, FNS-relevant fields | M | Prompt |
| T3 | `[ ]` | eComm integration verification — sync pipeline, BullMQ, ISR, customer auth, full order lifecycle | M | Prompt |
| T5 | `[ ]` | Lottery cert smoke test — 205 unit tests pass; needs station-paired E2E walkthrough | M | S40 deferred |
| T6 | `[ ]` | **Marketplace pricing drawer — browser walkthrough.** Static checks + 88 unit + 70 HTTP smokes pass. Needs human eyes on the new "Untracked stock policy" section (3-radio with conditional fields), per-dept window-override toggle UX, "Pricing & Sync" / "Save & Sync Now" footer flow, Preview-impact KPI cards + sample-products list, Analytics-tab pricing snapshot panel. Spin up `npm run dev`, open `/portal/integrations`, connect a marketplace, click "Pricing & Sync". | S | S71/S71b/S71c deferred — Chrome extension was disconnected during agent session |
| T7 | `[ ]` | **DoorDash UAT smoke — marketplace markup pipeline.** Wiring is mechanical (`syncIntegrationInventory` → `pushInventory` → `mapToPlatformItem` → `computeMarketplacePrice`); verified end-to-end via dry-run + 70 live HTTP smokes. Only a real `adapter.syncInventory` call against UAT credentials confirms the marketplace receives the marked-up `base_price` + correct estimated qty in untracked-stock mode. Needs user-side DoorDash UAT keys. | S | S71/S71b/S71c deferred — requires user-supplied DoorDash UAT credentials |
| T8 | `[ ]` | **Per-report manual deep-review.** S65 audit harness covers 15 reports with assertion-level coverage on totals, but each report's *display* (column choice, sorting, filters, drill-downs, export buttons, mobile layout) hasn't been eyeballed by a human in months. Walk through every report surface in turn: Live Dashboard, Daily/Weekly/Monthly/Yearly sales, Department/Product analytics, Predictions, Top Products, Product Movement, 52-week stats, EoD report (back-office + cashier-app + thermal print), Daily Sale, Dual Pricing, Employee timesheets, Payouts, Audit Log, Stock Levels, Notes, Period Compare, Inventory Status, Fuel P&L, Lottery Dashboard/Report/Commission/Settlement. For each: (a) confirm the page calls the correct endpoint, (b) data flows + renders correctly, (c) filters work, (d) exports (CSV/PDF) match what's on screen, (e) mobile layout doesn't break, (f) empty states are sensible. Flag any drift as new C-items. | M | Prompt |

---

## 🔧 Changes (UI/UX of existing surfaces)

| ID | Status | Item | Effort | Source |
|---|---|---|---|---|
| C1 | `[~]` | **Product page UI** — better visual hierarchy on ProductForm + ProductCatalog. **Blocked on Figma comps from designer.** | M | Prompt |
| C2 | `[~]` | **Lottery page UI** — 10-tab page is dense; needs better information architecture. **Blocked on Figma comps from designer.** | M | Prompt |
| C3 | `[x]` | Customer display → Light UI option (POS config toggle: dark \| light) | S | S79 — `customerDisplay.theme` in posConfig; POSScreen broadcasts on every cart_update / idle / transaction_complete; CustomerDisplayScreen applies `cds-root--light` modifier overriding CSS vars; Store Settings dark/light toggle in POSSettings |
| C4 | `[x]` | Cashier-app dark-fonts / light-theme alternative | S | S79f — infrastructure was already in place from prior sessions (`utils/branding.js` with `THEMES.dark` + `THEMES.light` × 25 CSS vars each, `applyBranding()` mutates `:root` + sets `data-pos-theme` attribute, `useBranding` hook fetches from `/pos-terminal/branding`, portal `StoreBranding.jsx` has Dark/Light toggle UI). Work shifted to fixing hardcoded color bypasses that broke in light mode: App.css boot screen → CSS vars; ActionBar.css manager-button + scroll bar + action/hold hover → `[data-pos-theme="light"]` slate overrides; NumpadModal cancel-hover; QuickButtonRenderer back-button. Existing light overrides on POSScreen age-policy strip + StatusBar AI button + age chips + 21+ chip already in place. Modals like BarcodeScanner / FuelModal / ManagerPin / ImplementationPin intentionally stay dark for visual focus. 51/51 pure smoke pins THEMES key-parity + chrome-surface differentiation + applyBranding mutation logic + invalid-input fallbacks. Cashier-app `vite build` clean. |
| C5 | `[x]` | Label Printer designer UI in back-office (better visuals + preview) | S | S79d — focused on the user's stated pain (preview accuracy, not editor UX): replaced hardcoded `scale = 3` with DPI-driven math (`labelInches × DPI × scale`) so dimensions match what prints; replaced fake `j % 3 === 0 ? '#000' : 'transparent'` barcode stripes with real JsBarcode SVG (UPC-A / EAN-13 / EAN-8 / CODE128 dispatched by data shape); added 7-step zoom control (25/40/50/75/100%/150/200) with "actual size" 1:1 dot mapping at 100%; live `dots × screen-px` indicator. 74/74 math smoke pins the contract. |
| C8 | `[x]` | Sweep remaining `window.alert(...)` → themed toast/modal | S | S54 deferred — verified S77: 0 callsites in frontend/cashier-app/admin-app; effectively no-op |
| C9 | `[x]` | Cash drop / payout dedicated receipt format (currently uses tx receipt) | M | S3 deferred — closed S77: dedicated builder + unified modal for 5 event types (cash_drop / cash_in / vendor_payout / loan / received_on_account); 32/32 pure smoke green |
| C10 | `[x]` | Settlement snapshot-coverage indicator ("5/7 days have snapshots") | S | S79e — settlement engine returns `snapshotCoverage: { daysWithSnapshots, daysInPeriod }` (computed from the same `lotteryScanEvent` query the engine already runs — no extra DB round-trip); 3-tone chip on each settlement card distinguishes a quiet week from a missed-EoD-wizard week (green = full coverage, amber = partial / POS fallback, red = zero snapshots); 36/36 pure-function smoke pins the classification logic. |

---

## ⬆️ Upgrades (tech stack / infra)

| ID | Status | Item | Effort | Notes |
|---|---|---|---|---|
| U1 | `[ ]` | **Frontend → TypeScript** (portal + cashier + admin + storefront) | XL | Backend already TS; massive sweep |
| U2 | `[ ]` | **CSS → Tailwind migration** | XL | Replaces ~250 prefixed CSS files |
| U3 | `[ ]` | Microsoft code-signing cert for Electron (Windows SmartScreen trust) | M | Prompt |
| U4 | `[ ]` | **Refactor Pass D** — split 9 remaining large controllers | L per pair | catalog 4339L · lottery 3202L · aiAssistant 2036L · admin 1628L · posTerminal 1450L · fuel 1369L · invoice 1366L · wholesaleOrder 1166L · scanData 837L. Pattern documented in S53. |
| U5 | `[ ]` | Service-layer Pass 2 — billing / loyalty / payment / image domain folders | M | S55 pattern |

---

## ✨ Features

### Imports & Data

| ID | Status | Item | Effort | Notes |
|---|---|---|---|---|
| F2 | `[ ]` | CSV filter files (transform pipeline extension) | M | Prompt |

### Vendor Management

| ID | Status | Item | Effort | Notes |
|---|---|---|---|---|

### Storefront pricing follow-up

| ID | Status | Item | Effort | Notes |
|---|---|---|---|---|

### Reports & Analytics

| ID | Status | Item | Effort | Notes |
|---|---|---|---|---|
| F33 | `[ ]` | **Custom reports + per-section toggles for EoD and long reports.** Currently S67 ships per-store toggles in `store.pos.eodReport` for 3 EoD sections (department breakdown / lottery-separate-from-drawer / hide-zero-rows). Expand into a dedicated "Reports Settings" surface where admins can: **(a)** toggle which sections render on each long-running report (EoD, Daily, Weekly, Monthly, Employee timesheets, Payouts, Dual Pricing, Lottery, Fuel P&L) per-store, **(b)** build truly custom reports by composing existing sections (Tender Details + Department Breakdown + Fuel + Pass-through Fees + …) into a saved layout that can be triggered manually or scheduled. Schema either extends `store.pos.reportsConfig` JSON OR introduces `ReportLayout` table (probably the latter — keeps `store.pos` from getting unwieldy). UI lives at `/portal/account?tab=reports-settings` or under a new sidebar entry. Affects EoD modal in cashier-app + back-office page + thermal-print template (all of which need to honour the section toggles). | M | Prompt |

### Grocery Module (gated, across all apps)

| ID | Status | Item | Effort |
|---|---|---|---|
| F6 | `[ ]` | Scale integration (Bizerba / CAS / Mettler) | L |
| F7 | `[ ]` | Recipe management + cost tracking (BOM with ingredient cost + sell price + margin) | L |
| F8 | `[ ]` | Meal pricing based on cuts (beef/pork/poultry cut catalog) | M |
| F9 | `[ ]` | Deli slicing price management (per-pound vs per-slice pricing) | M |
| F10 | `[ ]` | Random / fixed weight shrink management | M |
| F11 | `[ ]` | Meat packages + ecom orders integration | L |

### Marketing & Engagement

| ID | Status | Item | Effort | Notes |
|---|---|---|---|---|
| F12 | `[ ]` | Social media marketing integrations (FB/IG post scheduler with product cards) | M | Prompt |
| F13 | `[ ]` | Customer email / SMS bulk campaigns | M | P4 in old roadmap |

### Mobile & Hardware

| ID | Status | Item | Effort | Notes |
|---|---|---|---|---|
| F14 | `[ ]` | **#7 Capacitor mobile app** — manager-focused MVP (Live Dashboard, Transactions, Chat, Online Orders) | L | Architecture documented in CLAUDE.md S36 |
| F15 | `[ ]` | **#8 Transaction video POC** — Reolink RTSP → ffmpeg buffer → Cloudflare R2 → portal player | XL | Architecture documented in CLAUDE.md S36 |
| F38 | `[x]` | **Implementation Engineer PIN gate for cashier-app Hardware Settings** | M | S78 — `User.canConfigureHardware` flag + auto-rotated weekly 6-digit PIN (`User.implementationPinEnc`, AES-256-GCM via cryptoVault); cashier-app gates Hardware Settings behind a separate 1-hour session via `useImplementationStore` + `ImplementationPinModal`; admin-app User edit toggle + AdminProfile "My Implementation PIN" card; weekly scheduler rotates Monday 00:00 UTC + emails fresh PIN. Future scope: extend gate to Station Setup re-pair, printer IP edits, etc. 36/36 pure smoke green. |

### Multi-org & Reporting

| ID | Status | Item | Effort | Notes |
|---|---|---|---|---|
| F16 | `[ ]` | Multi-org Phase 4 — Group/Brand cross-org rollup reporting | XL | Plan documented in CLAUDE.md "Deferred Work" section |
| F17 | `[ ]` | Multi-store lottery dashboard (superadmin aggregated view) | M | |
| F18 | `[x]` | Lottery camera-based ticket scan for EOD reconciliation | S | S79 — `<BarcodeScannerModal>` mounted in `LotteryShiftModal` step 1 with new camera button next to existing keyboard scan submit; detected codes route through the same `handleScan` (so per-row routing + activation + scan-log all work identically). |
| F19 | `[x]` | Commission report PDF export | S | S79 — `downloadCommissionPDF` + `downloadCommissionCSV` helpers using `exportUtils.downloadPDF` (jspdf-autotable lazy-loaded). Two new ⬇ buttons next to Apply in the Commission tab. PDF carries 3 KPI summary cards (Total Commission / Total Sales / Avg Rate) + per-game table with TOTAL row. |

### AI Assistant

| ID | Status | Item | Effort |
|---|---|---|---|
| F20 | `[ ]` | Streaming responses (SSE replaces 3-dot wait) | M |
| F21 | `[ ]` | Voice / phone agent (Twilio + ElevenLabs) | XL |
| F22 | `[ ]` | Tour authoring UI (click-to-author tours, no JSON editing) | M |
| F23 | `[ ]` | Cashier-app TourRunner (close-shift, refund, bottle-return tours) | M |
| F24 | `[x]` | Conversation export to .txt / .md | S | S79c — Download button in all 3 widgets (portal/admin/cashier) wired to a `buildConversationMarkdown()` helper. Export carries title + per-message User/Assistant heading + content + tool calls + ticket ref + feedback. Markdown-by-default since Claude already emits markdown; `.md` opens cleanly in any editor. 68/68 pure-function smoke covers shape, edge cases (empty conv, missing content, bogus feedback), tool-label fallback, special-char preservation, filename builder. |

### AI Automation (merchandising + marketing)

| ID | Status | Item | Effort | Notes |
|---|---|---|---|---|
| F29 | `[ ]` | **AI competitive / market / area research for pricing** — assistant pulls in competitor pricing (web-scrape or NACS-style data), local-area demographics (median income, household density), and commodity trends (tobacco/dairy/produce wholesale indices) to recommend retail price adjustments per product. Output is a price-update suggestion with per-product margin impact + market-context citation. Can also recommend promo-price floors on top of F28. **Open questions before starting:** acceptable competitor data sources (legal/TOS), whether scraping goes through a 3rd-party API (e.g. ScrapingBee) or direct, where market signals live (Census, BLS, etc.). | XL | New — research-heavy; legal review needed for competitor data sources |
| F30 | `[ ]` | **AI content generation + social-media posting** — auto-generate Facebook / Instagram / X posts from real store data: new arrivals, hot sellers this week, current promos, seasonal callouts. Each post = generated image (DALL-E / SDXL) + caption + hashtags + suggested posting time. Manager reviews drafts in the portal, approves → schedule → post via Meta Graph API + X v2 API (or Buffer integration). Supersedes / extends **F12** (Social media integrations) by adding the AI generation layer; can be shipped before or with F12. Tied to F28's promo draft system (when a promo is published, automatically generate a launch post). | L | New — extends F12 |

### Fuel V2

| ID | Status | Item | Effort |
|---|---|---|---|
| F25 | `[ ]` | ATG integration (Veeder-Root TLS-4, Franklin Fueling EVO) | XL |
| F26 | `[ ]` | Temperature-compensated measurements (ATC) | M |
| F27 | `[x]` | Pump-level sales reports (per-pump breakdown) | S | S79b — `getFuelReport` extended with `byPump` aggregation grouped by `pumpId`; per-pump table renders below "By Fuel Type" in the Reports tab; `unattributedCount` surfaced when transactions lack pumpId. Plus: `pumpNumber` migrated `Int → String` to allow alphanumeric labels ("A1", "Diesel-1", "Out_front"); validator regex `[A-Za-z0-9_-]{1,16}` matches frontend pattern. 56/56 pure-function smoke green. |

---

## ✅ Recently Completed

> Items move here when shipped. For the historical record before 2026-04-29 see [CLAUDE.md](CLAUDE.md) "Recent Feature Additions" sections (Sessions 1–56).

| ID | Shipped | Item | Effort | Where to read more |
|---|---|---|---|---|
| B2 | 2026-04-30 | EBT chooser dialog — replaced `window.confirm('OK = SNAP / Cancel = Cash Benefit')` with reusable `<ChooserModal>` + themed `<EbtBalanceOverlay>` (loading / success / error states + Check-Other-Account + Try-Again paths) | S | CLAUDE.md S57 |
| B5 | 2026-04-30 | `Transaction.shiftId` column added + populated on all 4 create paths (createTransaction / batchCreateTransactions / createRefund / createOpenRefund) + RefundModal now passes shiftId. Strictly additive — no read path changes, no backfill, zero recalc risk. Unblocks B4. | S | CLAUDE.md S58 |
| B1 | 2026-04-30 | **Reports number sanity** — built reusable 3-stage audit harness (`seedAuditStore.mjs` + `seedAuditTransactions.mjs` + `seedAuditAudit.mjs`) that creates an isolated Audit Org/Store, seeds 20 transactions + lottery + fuel + cash movements with known totals, then HTTP-audits 8 critical reports. Final state: **43/43 checks pass**. Spawned + fixed B7, B8, B9. | M | CLAUDE.md S59 |
| B9 | 2026-04-30 | `/lottery/report` + `/lottery/dashboard` + `/lottery/commission` now use store-local IANA timezone for day-bucket boundaries (was UTC, which placed local-22:00 snapshots into the wrong UTC day). New `localDayStartUTC` / `localDayEndUTC` / `formatLocalDate` helpers in `realSales.ts`; `rangeSales` accepts optional `timezone` param (UTC default for backward compat). | S | CLAUDE.md S59 |
| B7 | 2026-04-30 | `/sales/departments` Name field now resolves real department name from DB by `departmentId` (was falling through to `li.taxClass` for both Grocery + Beverages → both rows labeled "grocery"). | M | CLAUDE.md S59 |
| B8 | 2026-04-30 | `/sales/departments` per-dept tax attribution rewritten — pro-rates `tx.taxTotal` across notional per-line tax (handles EBT exemption automatically). Was incorrectly skipping all `ebtEligible` lines, zeroing tax for whole grocery + alcohol dept aggregations. | M | CLAUDE.md S59 |
| B3 | 2026-04-30 | Cashier-app close-shift drawer math — ticket-math truth was already wired in S44 reconciliation service. Remaining piece (per user spec): explicit `LotterySettings.enabled=false` gating in `readLotteryShiftRaw` so lottery rows + cash math disappear entirely when module disabled. Verified: enabled→4 lottery rows + $140 contribution; disabled→0 rows + $0 contribution. | S | CLAUDE.md S61 |
| B4 | 2026-04-30 | Multi-cashier same-day handover — `openShift` now writes `shift_boundary` LotteryScanEvent per active box (closeShift already writes `close_day_snapshot` from S44b). New `shiftSales()` in realSales.ts uses bracketing snapshots for per-shift ticket-math; reconciliation service uses it instead of day-by-day `windowSales` for shift-scoped queries. Verified: Day -1 with Alice $10 + Bob $30 split correctly (was attributing whole $40 to one cashier before). | M | CLAUDE.md S62 |
| B6 | 2026-04-30 | `CashPayout` vs `VendorPayment` reconciliation — `readPayoutBuckets` now also queries `VendorPayment WHERE tenderMethod='cash' AND paymentDate IN [shift.openedAt, shift.closedAt]` and subtracts from `expectedDrawer`. New "Back-Office Vendor Cash Payments" line item in EoD recon. Verified: today's open shift correctly subtracts the seeded $60 cash vendor payment ($209.20 expected drawer); older shifts with no cash VPs unaffected. | M | CLAUDE.md S63 |
| Reports Cleanup | 2026-05-02 | **ReportsHub deletion + tab distribution** — surveyed the 13-tab ReportsHub (1,482-line jsx + 216-line css), identified 10 of 13 tabs as duplicates of EoD/AnalyticsHub/EmployeeReports/PayoutsReport. Extracted the 3 keepers into `pages/reports/` (`InventoryStatus.jsx` → InventoryCount tab, `PeriodCompare.jsx` → AnalyticsHub tab, `TxNotes.jsx` → POSReports tab) with a trimmed `reports-shared.css`. Deleted ReportsHub files; removed sidebar entry; replaced `/portal/reports` route with `<Navigate to="/portal/analytics">`; removed RBAC entry; dropped 5 unused API helpers. Vite build clean (3,446 modules, 17.29s, 0 errors). | M | CLAUDE.md S64 |
| B10 | 2026-05-02 | **Orphaned backend report routes cleanup** — verified zero callers across portal + cashier-app + admin-app + ecom-backend + storefront for the 5 dropped paths. Trimmed `reportsHubController.ts` (766 → 230 lines) keeping only `getInventoryReport` + `getCompareReport` + `getNotesReport`; trimmed `reportsHubRoutes.ts` to match. Backend `tsc --noEmit` clean (zero new errors in either file). | S | CLAUDE.md S65 / S64 follow-up |
| T1 | 2026-05-02 | **Audit harness extension — 6 new reports + 3 bug fixes** — extended `seedAuditAudit.mjs` with 6 new audit blocks (REPORTS 10-15: weekly/monthly aggregation, top products, products grouped, product movement, 52-week stats); added `byProductByDay` to seed expected. Surfaced 3 real bugs in `getProductMovement` + `getProduct52WeekStats` (raw qty sum across complete + refund txs, no sign convention) and fixed both controllers to apply the B7/B8/B9 refund sign convention (refund qty/lineTotal subtract). Final state: **63/63 checks pass**. Drift now covers 15 reports. | M | CLAUDE.md S65 |
| Reports IA | 2026-05-02 | **Reports navigation reorg** — fixed nested tabs-within-tabs visual on AnalyticsHub by replacing SalesAnalytics' inner Daily/Weekly/Monthly/Yearly tab bar + SalesPredictions' Hourly/Daily/Weekly/Monthly tab bar with `<select>` Period/Horizon dropdowns in the header actions row. Created `DailyReports` hub at `/portal/daily-reports` consolidating End of Day / Daily Sale / Dual Pricing into 3 tabs. Sidebar shrunk from 7 → 5 entries under Reports & Analytics. Old URLs preserved as React Router `<Navigate>` redirects to the appropriate hub tab. Vite build clean. | M | CLAUDE.md S66 |
| F1 | pre-BACKLOG | **Sante import** — full Sante POS product CSV transformer at `backend/src/utils/transformers/sante.ts` (363 lines), wired into `vendorRegistry.ts`, exposed via the existing `UploadPage` vendor selector. Handles UPC `_` prefix, `$`/`%` symbol stripping, multi-UPC comma splits. Verified by `tests/_smoke_sante_transform.mjs` — **10/10 tests pass** against a real 7,771-row Sante export. Audited in S66 follow-up. | M | Discovered already shipped during S66 audit |
| F3 | pre-BACKLOG | **Tags imports for catalog + groups** — Sante's `Tags` field (free-form `key: value / key: value`) is parsed into `attributes` JSON for non-routing pairs and into `productGroup` (pipe-separated) for `Other:` cross-references. ProductGroup auto-create at validation step verified by smoke test. | S | Bundled into the F1 Sante work |
| F4 | pre-BACKLOG | **Packs imports** — Sante Pack 1-6 columns flatten into Storeveu's `packOptions` format (`label@unitCount@price[*]`). Pack 1 marked as cashier-picker default with `*`. Verified by smoke test against real SURFSIDE LEMON VP 12 PK CN row. | S | Bundled into the F1 Sante work |
| EoD Config | 2026-05-02 | **Configurable EoD report** — 3 new `store.pos.eodReport` toggles drive (1) Department Breakdown section across back-office + cashier-app + thermal print, (2) `lotterySeparateFromDrawer` flag pulls lottery cash OUT of drawer math + renders as standalone section, (3) `hideZeroRows` server-side filter on payouts/tenders/fees/departments. Backend reconciliation engine extended to support the lottery-separate flag without disturbing existing math. Audit harness clean (63/63), end-to-end verified: $100 net lottery cash exactly removed from drawer when toggle ON. | M | CLAUDE.md S67 |
| F5 | 2026-05-03 | **Group prices + group promotions — smoke-tested + bug fixed.** Audit confirmed end-to-end wiring across schema, backend (CRUD, autoSync cascade, route gating), portal UI (ProductGroups page, ProductForm group picker, Promotions scope picker), and cashier-app (Dexie persist, cart-line carry, promo engine OR-logic). Found and fixed POSScreen.jsx bug where the promo re-evaluation `useEffect` stripped `productGroupId` from cart items before calling `evaluatePromotions` — silently disabling every group-scoped promotion at the POS even though all upstream wiring was correct. Now: 21/21 HTTP smoke + 6/6 engine tests pass; cashier-app build clean. Surfaced 3 follow-up items (**C11** salePrice dead-code, **C12** bulk member UI, **C13** group form MoneyInput migration). | M | CLAUDE.md S68 |
| C12 | 2026-05-03 | **Bulk member management on Product Groups page** — new `MembersTab` inside `GroupDetailModal` with: top section "Current Members (N)" multi-select + "Remove N" button + Select-all/Clear links; bottom section "Add Members" debounced search (≥2 chars via `searchCatalogProducts`) + non-member-filtered results + multi-select + "Apply template on add" toggle (default ON) + "Add N to group" button. After add/remove, parent re-fetches group + reloads page table so counts stay accurate without closing the modal. Drives the long-standing `/groups/:id/add-products` and `/groups/:id/remove-products` endpoints. | S | CLAUDE.md S69 |
| C13 | 2026-05-03 | **ProductGroups pricing inputs → `<MoneyInput>`** — 4 raw `<input type="number" step="0.01">` fields in GroupForm (defaultRetailPrice / defaultCostPrice / defaultCasePrice / salePrice) replaced with the standardized typed input from S52. Closes the silent mouse-wheel data-corruption hazard where admin scrolling the page over a focused price input would bump the value, then autoSync cascade pushed the wrong price to every member product. | S | CLAUDE.md S69 |
| ProductGroups Split | 2026-05-03 | **`pages/ProductGroups.jsx` (612L, 4 components) → `pages/ProductGroups/` folder** — index.jsx (page) + GroupForm.jsx + GroupDetailModal.jsx + MembersTab.jsx (new) + ProductGroups.css. Bundled with C12/C13 because adding C12 would have pushed the file past 900 lines. App.jsx import path unchanged (`./pages/ProductGroups` resolves to `index.jsx`). Same pattern as the Session 53 controller splits. | S | CLAUDE.md S69, user directive |
| C11 | 2026-05-03 | **Promotion enhancements — Option C delivered.** Three sub-items: **(C11a)** New `<InheritedPromosBanner>` on ProductForm shows dept/group-level promos affecting the product (indigo card, dismissible, hidden when no inherited promos). **(C11b)** New `ProductGroup.allowMixMatch` flag (default true). Backend rejects mix_match promo create/update when scope includes a group with the flag off, AND rejects flip-to-false when active mix_match promos still target the group — both with helpful 400 + offending-name lists. UI: GroupForm checkbox + "no mix-match" chip on table + Details section. **(C11c)** New `dealConfig.minPurchaseAmount` field on Promotion. Backend `validateDealConfig` rejects negative values, values > $1M, and presence-without-dept/group-scope. Cashier-app `meetsMinPurchase` guard in `evaluatePromotions` checks qualifying-line subtotal (not whole cart) ≥ threshold. UI: amber-bordered field appears on Promotions form when scope has dept or group. Tests: 31/31 HTTP + 11/11 engine pass. | M | CLAUDE.md S70 |
| T4 | 2026-05-04 | **Group discount + group mapping verification — end-to-end.** New `_smoke_t4_group_scenarios.mjs` exercises both back-office HTTP (real `POST /catalog/promotions`) AND cashier-app engine (real `evaluatePromotions` from `cashier-app/src/utils/promoEngine.js`) in the same script. 8 scenarios × 32 assertions: group sale, group sale + minPurchase, group BOGO, group volume tiers, group mix_match, allowMixMatch enforcement, cross-scope lowest-wins, catalog snapshot mapping. Self-cleaning fixture (1 group + 4 products + 1 negative-control). Final state: **74/74** combined across F5 engine smoke (11) + F5 HTTP smoke (31) + T4 e2e smoke (32). | S | CLAUDE.md S72 |
| C7 | 2026-05-04 | **Department force-push action.** New `POST /catalog/departments/:id/apply` endpoint cascades non-null `ageRequired` / `ebtEligible` / `taxClass` from a department onto every active product in that dept. Optional `fields` array allows selective push. UI: `<Zap>` button on every Departments row with confirmation dialog listing fields to be pushed + result toast. Complements the existing on-update cascade modal (which only fires when a saving edit changes a cascadable field) — C7 covers the after-the-fact cleanup case. 12/12 smoke tests + portal vite build clean. | S | CLAUDE.md S73 |
| Expiry + Dead-Stock | 2026-05-04 | **Per-store expiry tracking + configurable dead-stock query + inventory report audit.** Schema: 3 new fields on `StoreProduct` (expiryDate, expiryUpdatedAt, expiryNotes). Backend: 5 endpoints under `/catalog/expiry/*` (list with filter buckets, summary with valueAtRisk, set/clear) + `/catalog/dead-stock?days=N` complementary to existing `/reports/hub/inventory` 30-day classifier. Portal: NEW `/portal/expiry-tracker` separate page with scan-to-add (camera barcode), manual product search + date pick, inline date editing, status-bucket summary cards as filter chips. Audit confirms `/reports/hub/inventory` dead/low/over/out classifier works correctly with `?type=` filter. 23/23 new smoke + 86/86 regression across F5/T4/C7. **Unblocks F28** — gives AI Assistant the expiry + dead-stock data inputs needed to suggest "this dairy expires in 3 days, run 25% off". | M | CLAUDE.md S74 |
| F28 | 2026-05-04 | **AI promo suggestions (stub-AI ship).** New `PromoSuggestion` schema with `pending → approved/rejected/dismissed` lifecycle. 7 backend endpoints under `/api/promo-suggestions` (list/get/edit/generate/approve/reject/dismiss) + stub generator that pulls real data from S74 dead-stock + expiry endpoints, synthesises plausible promos with full provenance (`rationale.citations`, `estImpact`, `generatedBy: 'stub'`). Portal page at `/portal/promo-suggestions` under Catalog group: status filter tabs with counts, "Generate Suggestions" purple-gradient button, suggestion cards with deal preview, scope summary, value-at-risk impact strip, collapsible "Why?" rationale, action row (Approve & Publish / Reject with reason / Dismiss). Approve creates a real Promotion atomically. **AI marker convention** — `nav-ai-badge` (purple sparkle) added to `Sidebar.jsx` for nav items with `ai: true`. Same gradient (`#7c3aed → #6366f1`) reused on Generate button, page-header icon, card ribbons. 22/22 smoke + 131/131 combined regression. Real Claude tool-use queued as follow-up — same UI + wire format. | L | CLAUDE.md S75 |
| C6 + Marketplace Markup (S71 / S71b / S71c) | 2026-05-04 | **Per-marketplace markup, rounding, exclusions, sync mode, margin guard, untracked-stock policy.** Three sessions on `feature-39/ecommerceandMarketplaceMarkup` branch shipped together. **S71** — schema (`StoreIntegration.pricingConfig` JSON), pure-function pipeline `marketplaceMarkup.ts` (markup → 6 rounding modes incl. `charm_99` / `psych_smart` → exclusions → sync mode → margin guard), drawer UI with live preview strip, validation with field-specific 400 errors. **S71b** — skip-stat tracking on every sync result, `/preview-impact` dry-run endpoint, drawer per-category override toggle + "Save & Sync Now" footer + Preview-impact KPI cards, analytics-tab pricing-snapshot panel, drive-by fixes for two pre-existing Prisma schema-drift bugs (`weeklyVelocity` + `status` were broken in `pushInventory`, masked by short-circuit). **S71c** — per-marketplace velocity computed live from Transaction history, store-wide window default + per-department overrides, three `unknownStockBehavior` modes (`send_zero` / `send_default` / `estimate_from_velocity`), drawer "Untracked stock policy" section with conditional fields. Final state: **88/88** unit tests + **70/70** live HTTP smokes pass; tsc + vite clean. Commit `9dc2016`. **Closes long-standing C6** ("eComm smart rounding per tier per platform") — per-tier (per-dept) overrides, per-platform settings, charm_99 / charm_95 / psych_smart rounding all shipped. **Pending verification** — T6 (browser walkthrough) + T7 (DoorDash UAT smoke) carry the remaining user-side checks. | L | CLAUDE.md S71 / S71b / S71c |
| F32 + S71d Option B + BullMQ fix | 2026-05-04 | **Storefront pricing transform at sync time + marketplace pricing accessible before connect + BullMQ producer signature fix.** **F32 — runtime application** of S71d's settings. POS backend exposes `GET /api/internal/storefront-pricing/:storeId` (X-Internal-Api-Key auth) returning normalized `pricingConfig` + `velocityMap` + `windowDays`. ecom-backend's `syncRoutes.js` now applies `computeMarketplacePrice` per-store in BOTH `/sync` and `/sync/full` paths: marked-up `retailPrice` → `EcomProduct`, excluded products → `visible: false`, smart QoH from velocity when `unknownStockBehavior='estimate_from_velocity'`. JS port of pure helpers in `ecom-backend/src/utils/marketplaceMarkup.js` (mirrors canonical `backend/src/services/marketplaceMarkup.ts`); `services/storefrontPricingClient.js` wraps the internal HTTP call with 60s in-memory cache. Cache invalidation: POS-side `updateSettings` fires `POST /api/internal/sync/invalidate-pricing` on ecom-backend after the admin saves storefront config — config edits propagate immediately, no 60s wait. **S71d Option B** — `getSettings` lazy auto-init now extends to ANY live platform (was storefront-only). Marketplaces auto-create empty rows on first GET so admins can configure markup BEFORE entering credentials. Drawer + "Pricing & Sync" button rendered on disconnected cards too. **BullMQ producer signature fix** — `packages/queue/producers.js` now takes positional args `(orgId, productId, action, payload)` matching `catalogController` call sites; previously single-arg `(payload)` silently dropped everything but `orgId`. Latent until Redis lands; HTTP fallback path was the actual runtime channel. **51/51** F32 transform smoke (pure functions, ecom-backend) + **88/88** marketplace unit + tsc + vite all clean. **Pending live HTTP verification** — POS dev backend's port-bind hung in agent session; the user can re-run existing smokes against their running stack. | M | CLAUDE.md S71e |
| F31 + storeId-fallback fix | 2026-05-04 | **Vendor cover-day soft floor (Factor #15) + Preview/Sync `storeId` from header.** Schema (`Vendor.targetCoverageDays Int?`) + create/update validation (1-180 days) + Vendor edit form input were already in place pre-session — what was missing was the actual algorithmic FLOOR mechanic the spec called for. Added Factor #15 to `orderEngine.ts`: `coverFloor = max(0, targetCoverDays × avgDaily + safetyStock - onHand - onOrder)`. Take `max(rawOrderQty, coverFloor)` BEFORE case-pack rounding. Surfaced in `OrderFactors.vendorCoverFloor` with `{ targetDays, floorUnits, binding }` so UI can show why a particular order qty was raised. New `'vendor_cover_floor'` reorder reason that fires when binding AND no higher-priority reason already won (`out_of_stock` / `below_lead_time` / `below_reorder_point` / `low_days_supply` keep their precedence; only overrides `forecast_demand` / `trending_up`). Distinct from the existing `targetCoverageDays`-as-forecast-window-extender — the window controls forecast SIZING, the floor protects against forecast valleys (slow weekday, holiday dip) where the forecast-driven qty would otherwise drop below the buyer's preferred cover. Both can coexist. **VendorOrderSheet UI** — new Truck-icon factor badge (`#0ea5e9`) appears on rows where `factors.vendorCoverFloor.binding === true`; tooltip shows the floor math (`10d × 5/d = 50 units (raised order qty)`). Also normalized `FactorBadges` to read both nested and flat factor shapes for forward compat. **Drive-by fix** — `previewSyncImpact` and `syncInventory` now accept `storeId` from `X-Store-Id` header as fallback when body's `storeId` is missing. Unblocks the Preview button in EcomSetup → Pricing tab where the drawer doesn't have the storeId in its props. **19/19** F31 smoke + **88/88** marketplace unit + tsc + portal vite all clean. | S | CLAUDE.md S71f |
| C4 | 2026-05-04 | **Cashier-app light-theme.** Mirror of C3 but for the cashier's own POS screen. Discovery: 95% of the infrastructure already shipped in prior sessions — `utils/branding.js` defines `THEMES.dark` + `THEMES.light` with 25 CSS vars each, `applyBranding()` mutates `:root` + sets `data-pos-theme` attribute, `useBranding()` hook polls every 5min, portal `StoreBranding.jsx` has Dark/Light toggle UI wired. The work was finding + fixing **hardcoded color bypasses** that don't respect the CSS-var cascade. Fixed: App.css boot screen (was hardcoded `#0f1117 / #7ac143` → CSS vars); ActionBar.css manager-button bg + action/hold hover + scrollbar (`rgba(255,255,255,X)` → `[data-pos-theme="light"]` slate overrides); NumpadModal cancel hover; QuickButtonRenderer back-button. Existing light overrides on POSScreen age-policy strip + StatusBar AI button + age chips were already in place from prior sessions. Modals like BarcodeScanner / FuelModal / ManagerPin / ImplementationPin intentionally stay dark for visual focus / camera UX. **51/51** pure-function smoke pins THEMES key-parity (dark + light expose identical 25-key set) + chrome-surface differentiation (bg-base / bg-panel / bg-card / statusbar-bg flip correctly) + applyBranding mutation logic + invalid-input fallbacks (unknown theme → dark, malformed primaryColor → brand green). Cashier-app `vite build` clean (4.89s). Combined regression now **415/415** across all 8 active smokes. | S | CLAUDE.md S79f |

---

## How to add a new item

1. Pick the right section (Bug / Sanity / Change / Upgrade / Feature)
2. Use the next available ID in that section's letter (B7, T6, C11, U6, F28, etc.)
3. Add a row with `[ ]` status, short title (bold the noun phrase), effort estimate, and a 1-line source/notes column
4. Don't promote to In Progress until you've got the next session of focus on it

## Suggested order for the next 5 sessions

C1 + C2 (product + lottery UI redesigns) are queued behind the designer's Figma comps. While we wait, here are options that don't depend on visual spec:

1. **T5** — Lottery cert smoke test (station-paired E2E walkthrough)
2. **T2 + T3** — EBT/eComm integration verification (separate sessions)
3. **U4** — Refactor Pass D (split 9 remaining large controllers — pattern documented in S53)
4. **U5** — Service-layer Pass 2 (billing / loyalty / payment / image domain folders — S55 pattern)
5. **F2** — CSV filter files (transform pipeline extension)

When the Figma comps arrive, C1 + C2 jump back to the top.

After that the heavy infra items (U1 TypeScript, U2 Tailwind, U4 controller refactor) can be sequenced based on whichever pain point is biggest.
