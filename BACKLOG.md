# Storv POS — Master Backlog

**Last updated:** 2026-04-29
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
| B1 | `[ ]` | **Reports number sanity** — cross-check Daily / Weekly / Monthly / Live Dashboard / EoD / Commission / Predictions reconcile across stores + multi-day windows | M | Prompt + S20 |
| B2 | `[ ]` | EBT chooser dialog — POSScreen still uses `window.confirm` for SNAP/Cash split; needs themed 2-button modal | S | S54 deferred |
| B3 | `[ ]` | Cashier-app close-shift drawer math — pull lottery `instantSales` from snapshot ticket-math, not `LotteryTransaction` totals | S | S44 follow-up |
| B4 | `[ ]` | Multi-cashier same-day handover — per-shift accountability gap (snapshots only capture daily delta) | M | S44 follow-up |
| B5 | `[ ]` | `Transaction.shiftId` column missing — analytics filter unreliable when 2 shifts overlap | S | S20 Open Bug A |
| B6 | `[ ]` | `CashPayout` vs `VendorPayment` not reconciled — POS payouts invisible in back-office vendor table | M | S20 Open Bug B |

---

## 🧪 Sanity / Testing

| ID | Status | Item | Effort | Source |
|---|---|---|---|---|
| T1 | `[ ]` | **Test all reports** end-to-end with seeded multi-store/multi-day data | M | Prompt |
| T2 | `[ ]` | EBT / Food stamp integration verification — TenderModal split, eligibility flow, FNS-relevant fields | M | Prompt |
| T3 | `[ ]` | eComm integration verification — sync pipeline, BullMQ, ISR, customer auth, full order lifecycle | M | Prompt |
| T4 | `[ ]` | Group discounts + group mapping verification | S | Prompt |
| T5 | `[ ]` | Lottery cert smoke test — 205 unit tests pass; needs station-paired E2E walkthrough | M | S40 deferred |

---

## 🔧 Changes (UI/UX of existing surfaces)

| ID | Status | Item | Effort | Source |
|---|---|---|---|---|
| C1 | `[ ]` | **Product page UI** — better visual hierarchy on ProductForm + ProductCatalog | M | Prompt |
| C2 | `[ ]` | **Lottery page UI** — 10-tab page is dense; needs better information architecture | M | Prompt |
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
| F1 | `[ ]` | **Sante import** templates + tags → ProductGroup mapping | M | Awaiting sample Sante CSV/XLSX from user |
| F2 | `[ ]` | CSV filter files (transform pipeline extension) | M | Prompt |
| F3 | `[ ]` | Tags imports for catalog + groups | S | Prompt |
| F4 | `[ ]` | Packs imports (pack-size CSV import flow) | S | Prompt |
| F5 | `[ ]` | Group prices + group promotions (promo engine extension for ProductGroup-scoped pricing) | M | Prompt |

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

_(empty — flip the first finished item from above into this section)_

---

## How to add a new item

1. Pick the right section (Bug / Sanity / Change / Upgrade / Feature)
2. Use the next available ID in that section's letter (B7, T6, C11, U6, F28, etc.)
3. Add a row with `[ ]` status, short title (bold the noun phrase), effort estimate, and a 1-line source/notes column
4. Don't promote to In Progress until you've got the next session of focus on it

## Suggested order for the next 5 sessions

1. **B1 + T1** — full reports sanity audit + fixes (broken numbers undermine trust in everything else)
2. **F1 + F3 + F4 + F5** — Sante imports / tags / packs / group pricing (one bundle, needs Sante sample first)
3. **C1** — Product page UI redesign
4. **C2** — Lottery page UI redesign
5. From there pick by what's blocking customers

After that the heavy infra items (U1 TypeScript, U2 Tailwind, U4 controller refactor) can be sequenced based on whichever pain point is biggest.
