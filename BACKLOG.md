# Storv POS — Master Backlog

**Last updated:** 2026-05-03 (S70 — C11 shipped (Option C); C9/C10 + remaining items open)
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
| T4 | `[ ]` | Group discounts + group mapping verification | S | Prompt |
| T5 | `[ ]` | Lottery cert smoke test — 205 unit tests pass; needs station-paired E2E walkthrough | M | S40 deferred |

---

## 🔧 Changes (UI/UX of existing surfaces)

| ID | Status | Item | Effort | Source |
|---|---|---|---|---|
| C1 | `[~]` | **Product page UI** — better visual hierarchy on ProductForm + ProductCatalog. **Blocked on Figma comps from designer.** | M | Prompt |
| C2 | `[~]` | **Lottery page UI** — 10-tab page is dense; needs better information architecture. **Blocked on Figma comps from designer.** | M | Prompt |
| C3 | `[ ]` | Customer display → Light UI option (POS config toggle: dark \| light) | S | Prompt |
| C4 | `[ ]` | Cashier-app dark-fonts / light-theme alternative | S | Prompt |
| C5 | `[ ]` | Label Printer designer UI in back-office (better visuals + preview) | S | Prompt |
| C6 | `[ ]` | eComm price markup with smart rounding (.99 / .95 / .49 per tier, per platform) | S | Prompt |
| C7 | `[ ]` | Department → product details "force push" action (apply department defaults to all products in dept) | S | Prompt |
| C8 | `[ ]` | Sweep remaining `window.alert(...)` → themed toast/modal | S | S54 deferred |
| C9 | `[ ]` | Cash drop / payout dedicated receipt format (currently uses tx receipt) | S | S3 deferred |
| C10 | `[ ]` | Settlement snapshot-coverage indicator ("5/7 days have snapshots") | S | S44 follow-up |

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

### Multi-org & Reporting

| ID | Status | Item | Effort | Notes |
|---|---|---|---|---|
| F16 | `[ ]` | Multi-org Phase 4 — Group/Brand cross-org rollup reporting | XL | Plan documented in CLAUDE.md "Deferred Work" section |
| F17 | `[ ]` | Multi-store lottery dashboard (superadmin aggregated view) | M | |
| F18 | `[ ]` | Lottery camera-based ticket scan for EOD reconciliation | S | |
| F19 | `[ ]` | Commission report PDF export | S | |

### AI Assistant

| ID | Status | Item | Effort |
|---|---|---|---|
| F20 | `[ ]` | Streaming responses (SSE replaces 3-dot wait) | M |
| F21 | `[ ]` | Voice / phone agent (Twilio + ElevenLabs) | XL |
| F22 | `[ ]` | Tour authoring UI (click-to-author tours, no JSON editing) | M |
| F23 | `[ ]` | Cashier-app TourRunner (close-shift, refund, bottle-return tours) | M |
| F24 | `[ ]` | Conversation export to .txt / .md | S |

### Fuel V2

| ID | Status | Item | Effort |
|---|---|---|---|
| F25 | `[ ]` | ATG integration (Veeder-Root TLS-4, Franklin Fueling EVO) | XL |
| F26 | `[ ]` | Temperature-compensated measurements (ATC) | M |
| F27 | `[ ]` | Pump-level sales reports (per-pump breakdown) | S |

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

---

## How to add a new item

1. Pick the right section (Bug / Sanity / Change / Upgrade / Feature)
2. Use the next available ID in that section's letter (B7, T6, C11, U6, F28, etc.)
3. Add a row with `[ ]` status, short title (bold the noun phrase), effort estimate, and a 1-line source/notes column
4. Don't promote to In Progress until you've got the next session of focus on it

## Suggested order for the next 5 sessions

C1 + C2 (product + lottery UI redesigns) are queued behind the designer's Figma comps. While we wait, here are options that don't depend on visual spec:

1. **F5** — Group prices + group promotions (promo engine ProductGroup-scope extension) — pure backend + minor UI surface
2. **T5** — Lottery cert smoke test (station-paired E2E walkthrough)
3. **T2 + T3** — EBT/eComm integration verification (separate sessions)
4. **C3 / C4** — Customer display light-theme + cashier-app dark-fonts toggles (small, no Figma needed)
5. **C7** — Department → product details "force push" action (apply department defaults to all products in dept)

When the Figma comps arrive, C1 + C2 jump back to the top.

After that the heavy infra items (U1 TypeScript, U2 Tailwind, U4 controller refactor) can be sequenced based on whichever pain point is biggest.
