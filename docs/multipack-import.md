# Multi-Pack Import Cookbook

How to get products that sell in multiple configurations (single / 6-pack / case) correctly imported into Storeveu POS.

---

## What "multi-pack" means in Storeveu

One physical product, multiple ways to sell it. Three different fields, each with a specific role:

| Field | Purpose | DB target |
|---|---|---|
| `unitPack` + `packInCase` | **Default** pack math (vendor case ↔ what-you-sell) | `MasterProduct.unitPack`, `MasterProduct.packInCase` |
| `packOptions` | **Cashier picker** — "is the customer buying 1, 6, or 12?" | `ProductPackSize[]` rows |
| `additionalUpcs` | **Alternate barcodes** — e.g. the case UPC still scans as the same product | `ProductUpc[]` rows |

They work together. Example: Coca-Cola 12oz can.

- `unitPack = 1`, `packInCase = 24` → vendor case = 24 singles
- `packOptions`:
  ```
  Single@1@1.99;6-Pack@6@9.99*;Case@24@29.99
  ```
  Three sell configurations; `*` marks the default shown first in the cashier's picker.
- `additionalUpcs`:
  ```
  049000028928|049000028935
  ```
  Two alternate barcodes (case UPC, 12-pack UPC). Primary UPC goes in the `upc` column.

At scan time:
1. **Any** of the three barcodes looks up the same product
2. If the product has ≥2 pack sizes, the cashier sees a picker modal
3. Tapping "6-Pack" adds a line with price $9.99, qty 1, unitCount 6

---

## CSV format — the canonical spec

### Minimal multi-pack row

```csv
upc,name,department,pack_options,additional_upcs
049000028911,Coke 12oz,Beverages,Single@1@1.99;6-Pack@6@9.99*;Case@24@29.99,049000028928|049000028935
```

### Field-by-field

| Column | Required? | Format | Example |
|---|---|---|---|
| `upc` | ✅ | Primary barcode | `049000028911` |
| `name` | ✅ | Product name | `Coke 12oz` |
| `additional_upcs` | optional | Pipe-separated alt barcodes | `049000028928\|049000028935` |
| `pack_options` | optional | Semicolon-separated `label@unitCount@price[*]` | `Single@1@1.99;6-Pack@6@9.99*` |
| `unitPack` | optional | Units per sell pack (1 = single, 6 = 6-pack) | `1` |
| `packInCase` | optional | Sell packs per vendor case | `24` |

### Rules

- **Primary UPC goes in `upc`.** Everything else is in `additional_upcs`.
- **Separator in `additional_upcs` is a pipe (`|`)**, because commas collide with CSV.
- **Separator in `pack_options` is a semicolon (`;`)** for the same reason.
- **Default pack size** is marked with a trailing `*` in `pack_options`. Exactly one row may have `*`. If none do, the first row becomes default.
- **UPCs must be unique across all products in your org.** If a pack UPC is already assigned to a different product, the import will fail for that row with a conflict error.

### Reference CSV — three worked examples

```csv
upc,name,department,unitPack,packInCase,defaultRetailPrice,pack_options,additional_upcs
049000028911,Coke 12oz can,Beverages,1,24,1.99,Single@1@1.99*;6-Pack@6@9.99;Case@24@29.99,049000028928|049000028935
611269991000,Red Bull 8.4oz,Beverages,1,24,3.49,Single@1@3.49*;4-Pack@4@13.99;Case@24@74.99,611269991024|611269991048
080660956107,Corona 12oz bottle,Beer,1,24,2.49,Single@1@2.49;6-Pack@6@13.99*;12-Pack@12@25.99;Case@24@45.99,080660956114|080660956121|080660956138
```

---

## Using the Bulk Import dropdown

When you map your CSV headers in the import UI, you'll find the two multi-pack fields under:

- **`Additional UPCs (alternates)`** — in the **Alt Barcodes & Pack Options** group.
- **`Pack Options (multi-SKU picker)`** — same group.

### Multi-source mapping for `Additional UPCs`

If your source data has the alt barcodes in **separate columns** (e.g. `Pack1_UPC`, `Pack2_UPC`, `Case_UPC`) rather than pipe-concatenated into a single column, you can **map the same `Additional UPCs` field on multiple columns**. The import merges them into one pipe-separated list automatically. The dropdown shows a blue `merged ×3` badge once you pick it on a second column.

---

## Importing from other POS systems — gap notes

The existing vendor templates (AGNE, Sante POS, Pine State Monthly Specials) are designed for **pricing + catalog updates**, not catalog migrations. None of them currently ship with a `packOptions` or `additionalUpcs` mapping.

This means: **migrating a multi-pack catalog from another POS requires pre-shaping the CSV into the canonical format above before uploading.**

### Patterns seen in 3rd-party POS exports (and how to reshape them)

| Source pattern | How to convert |
|---|---|
| **Separate SKU row per pack** (e.g. Coke-Single, Coke-6pk, Coke-Case each have their own row with the same product name) | In a spreadsheet: group rows by product name → collapse to one row per product → build `pack_options` from the grouped rows' unitCount + price → keep each row's UPC as an entry in `additional_upcs` (primary = the single-unit row's UPC). |
| **Parent/child SKU hierarchy** (e.g. IT Retail — parent "Coke" with children for each pack size) | Export children with parent linkage → use parent as the product row → build `pack_options` from children → use children UPCs as `additional_upcs`. |
| **Multi-column layout** (e.g. same row has `Single_UPC`, `SixPack_UPC`, `Case_UPC`, `Single_Price`, `SixPack_Price`, `Case_Price`) | Map `Single_UPC` → `upc`; map the other two UPC columns to `additional_upcs` (multi-source); build `pack_options` by concatenating the three size rows (e.g. `=CONCAT("Single@1@",A2,";6-Pack@6@",B2,";Case@24@",C2)` in Excel). |
| **No multi-pack data** (e.g. AGNE pricing CSVs) | Import without pack_options. If the product doesn't already have pack sizes in Storeveu, it'll just sell at the single unit price. You can add pack sizes later from the Product edit page. |

---

## What to ask your old POS vendor for before migrating

- A full product export in CSV or Excel with one row per **physical product** (not per SKU variant).
- Each row should include the **primary UPC** (the one scanned at single-unit sale) plus any **alternate UPCs** (case UPC, 6-pack UPC, etc).
- Each row should include **all pricing tiers** with their pack size and price — ideally in columns like `Single Price`, `6-Pack Price`, `Case Price`.
- If they can only give you a per-SKU export (one row per pack size), get the **product grouping key** (usually an internal product ID or a canonical name field) so you can reshape the data.

---

## Gotchas

- **Don't use the primary UPC in `additional_upcs`.** Primary belongs in `upc`; duplicates there will be silently deduplicated but can cause confusing "UPC already exists" errors on subsequent imports.
- **Pack prices must be per-pack, not per-unit.** `6-Pack@6@9.99` means the 6-pack costs $9.99 total, not $9.99 per unit.
- **`pack_options` is REPLACE semantics on import.** If a product already has pack sizes and your new CSV has a different `pack_options` value, the old pack sizes are deleted and replaced with the new ones. To add without replacing, edit the product manually from the Product page.
- **Default pack size (`*`)** — if your 6-pack is the default sell unit, mark it. The cashier's picker opens with that option pre-selected.
- **Orphan UPCs.** If you import a CSV where product A has alt UPC `X`, then later import another CSV where product B claims `X`, the second import fails. You have to delete the UPC from product A first (from the Barcodes manager on the Product page).

---

## Workflow summary

```
┌──────────────────────────────────────────────────────────────┐
│  Existing catalog in old POS                                 │
│                                                              │
│  Option 1: export in canonical Storeveu format → upload         │
│  Option 2: export in old format → reshape in Excel → upload  │
│  Option 3: no multi-pack data → import basic, add later in UI│
└──────────────────────────────────────────────────────────────┘
                              ↓
              [Bulk Import → Products → pick CSV]
                              ↓
              [Column mapping UI auto-detects fields]
                              ↓
              [Preview shows 5 rows with resolved pack options]
                              ↓
                         [Commit import]
                              ↓
        ✓ MasterProduct rows created/updated
        ✓ ProductUpc rows created from additional_upcs
        ✓ ProductPackSize rows created from pack_options
                              ↓
              [Scan any UPC at cashier → pack picker]
```

---

## Related pages

- `frontend/src/pages/BulkImport.jsx` — the import UI
- `backend/src/services/inventory/import.ts` — alias resolution + post-processing (Session 55 — legacy `services/importService.js` path still works via shim)
- `frontend/src/pages/ProductForm.jsx` — Barcodes + Pack Sizes managers (for manual edits)
- `cashier-app/src/components/modals/PackSizePickerModal.jsx` — what the cashier sees at scan time
