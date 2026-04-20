/**
 * seedVendorTemplates.js — Session 5
 *
 * Seeds the 3 vendor templates shipped with the platform. Idempotent via
 * `slug` unique constraint. Superadmins can edit the mappings via the admin
 * UI at /admin/vendor-templates — seed NEVER overwrites active edits; set
 * `active: false` and re-seed to refresh a template from scratch.
 *
 * Run: node prisma/seedVendorTemplates.js
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// ─── AGNE (Associated Grocers New England) — Wholesale CSV ──────────────────
// File: WHS11209 (2).csv. 38 columns. UPC is 14-digit with leading zeros.
// Dates in YYYYMMDD format. Has 4 price tiers: REG / SALE / TPR / FUTURE.
const AGNE = {
  name: 'AGNE — Wholesale',
  slug: 'agne',
  description: 'Associated Grocers New England weekly wholesale CSV. 14-digit UPC with leading zeros, YYYYMMDD dates, REG/SALE/TPR/FUTURE price tiers.',
  target: 'products',
  vendorHint: 'AGNE, Associated Grocers of New England, WHS11209',
  mappings: [
    // Identity
    { vendorColumn: 'UPC',          targetField: 'upc',                transform: 'trim_leading_zero' },
    { vendorColumn: 'Item',         targetField: 'itemCode' },
    { vendorColumn: 'CaseUPC',      targetField: 'linkedUpc',          transform: 'trim_leading_zero' },
    { vendorColumn: 'Description',  targetField: 'name',               transform: 'trim' },
    { vendorColumn: 'BRAND',        targetField: 'brand' },

    // Classification
    { vendorColumn: 'Department',   targetField: 'departmentId' },
    { vendorColumn: 'MANUFACTURER', targetField: 'vendorId' },

    // Product specs
    { vendorColumn: 'ITEM_SIZE',    targetField: 'size' },
    { vendorColumn: 'ITEM_UOM',     targetField: 'sizeUnit' },
    { vendorColumn: 'PACK',         targetField: 'packInCase',         transform: 'parse_integer' },

    // Pricing tier 1 — REG
    { vendorColumn: 'REG_RETAIL',   targetField: 'defaultRetailPrice', transform: 'parse_currency' },
    { vendorColumn: 'REG_MULTIPLE', targetField: 'regMultiple',        transform: 'parse_integer' },
    { vendorColumn: 'REGULARCOST',  targetField: 'defaultCasePrice',   transform: 'parse_currency' },
    { vendorColumn: 'CASE_RETAIL',  skip: true }, // we derive this

    // Deposits (per-unit wins; case deposit auto-derived later)
    { vendorColumn: 'BOTTLE_DEPOSIT', targetField: 'depositPerUnit',   transform: 'parse_currency' },
    { vendorColumn: 'CASE_DEPOSIT',   targetField: 'caseDeposit',      transform: 'parse_currency' },

    // Compliance flags
    { vendorColumn: 'TAX1',         targetField: 'taxable',            transform: 'parse_boolean' },
    { vendorColumn: 'FOOD_STAMP',   targetField: 'ebtEligible',        transform: 'parse_boolean' },
    { vendorColumn: 'WIC',          targetField: 'wicEligible',        transform: 'parse_boolean' },

    // SALE promo slot (primary promo)
    { vendorColumn: 'SALE_RETAIL',     targetField: 'specialPrice',   transform: 'parse_currency' },
    { vendorColumn: 'SALE_COST',       targetField: 'specialCost',    transform: 'parse_currency' },
    { vendorColumn: 'SALE_MULTIPLE',   targetField: 'saleMultiple',   transform: 'parse_integer' },
    { vendorColumn: 'SALE_START_DATE', targetField: 'startDate',      transform: 'yyyymmdd_to_date' },
    { vendorColumn: 'SALE_END_DATE',   targetField: 'endDate',        transform: 'yyyymmdd_to_date' },

    // TPR promo slot (secondary)
    { vendorColumn: 'TPR_RETAIL',     targetField: 'tprRetail',       transform: 'parse_currency' },
    { vendorColumn: 'TPR_COST',       targetField: 'tprCost',         transform: 'parse_currency' },
    { vendorColumn: 'TPR_MULTIPLE',   targetField: 'tprMultiple',     transform: 'parse_integer' },
    { vendorColumn: 'TPR_START_DATE', targetField: 'tprStartDate',    transform: 'yyyymmdd_to_date' },
    { vendorColumn: 'TPR_END_DATE',   targetField: 'tprEndDate',      transform: 'yyyymmdd_to_date' },

    // Future scheduled price change
    { vendorColumn: 'FUTURE_RETAIL',      targetField: 'futureRetail',     transform: 'parse_currency' },
    { vendorColumn: 'FUTURE_COST',        targetField: 'futureCost',       transform: 'parse_currency' },
    { vendorColumn: 'FUTURE_ACTIVE_DATE', targetField: 'futureActiveDate', transform: 'yyyymmdd_to_date' },
    { vendorColumn: 'FUTURE_MULTIPLE',    targetField: 'futureMultiple',   transform: 'parse_integer' },

    // Misc AGNE-specific (skip or park in attributes)
    { vendorColumn: 'Status',  skip: true },
    { vendorColumn: 'PRC_GRP', targetField: 'priceMethod' },
    { vendorColumn: 'CLASS',   skip: true },
    { vendorColumn: 'PBHN',    skip: true },
    { vendorColumn: 'TAX2',    skip: true },
    { vendorColumn: 'TAX3',    skip: true },
  ],
};

// ─── Sante POS — Export CSV ─────────────────────────────────────────────────
// File: products (3).csv. 81 columns. UPC has `_` prefix. Has Pack 1..Pack 6
// repeated column sets. Tags field is "Key: Value / Key: Value / …" compound.
const SANTE = {
  name: 'Sante POS — Export',
  slug: 'sante-pos',
  description: 'Sante POS product catalog export. `_`-prefixed UPC, multi-pack (Pack 1..Pack 6), Tags compound field parsed into attributes.',
  target: 'products',
  vendorHint: 'Sante POS, publicId',
  mappings: [
    // Identity (strip Sante's `_` prefix, then clean to digits only)
    { vendorColumn: 'UPC',         targetField: 'upc',                transform: 'strip_prefix', transformArgs: { prefix: '_' } },
    { vendorColumn: 'SKU',         targetField: 'sku' },
    { vendorColumn: 'Item number', targetField: 'itemCode' },
    { vendorColumn: 'publicId',    targetField: 'ecomExternalId' },

    // Product info
    { vendorColumn: 'Title',       targetField: 'name' },
    { vendorColumn: 'Pack Size',   targetField: 'size' }, // free-form like "750 ML"

    // Classification
    { vendorColumn: 'Category',    targetField: 'departmentId' },
    { vendorColumn: 'Distributor', targetField: 'vendorId' },
    { vendorColumn: 'Importer',    skip: true }, // dup info

    // Pricing
    { vendorColumn: 'Price',       targetField: 'defaultRetailPrice', transform: 'parse_currency' },
    { vendorColumn: 'Promo Price', targetField: 'specialPrice',       transform: 'parse_currency' },
    { vendorColumn: 'Unit Cost',   targetField: 'defaultCostPrice',   transform: 'parse_currency' },
    { vendorColumn: 'Case Cost',   targetField: 'defaultCasePrice',   transform: 'parse_currency' },
    { vendorColumn: 'Units Per Case', targetField: 'packInCase',      transform: 'parse_integer' },

    // Deposits
    { vendorColumn: 'Bottle Deposit', targetField: 'depositPerUnit',  transform: 'parse_currency' },
    { vendorColumn: 'Surcharge',      skip: true },

    // Tax
    { vendorColumn: 'Tax Rate',    targetField: 'taxClass' }, // rate string — our importer resolves to TaxRule

    // Inventory
    { vendorColumn: 'In Stock',           targetField: 'quantityOnHand', transform: 'parse_number' },
    { vendorColumn: 'Reorder Threshold',  targetField: 'reorderPoint',   transform: 'parse_integer' },
    { vendorColumn: 'Bill & Hold',        skip: true },

    // E-commerce
    { vendorColumn: 'Images',      targetField: 'imageUrl' },

    // Compound "Tags" → attributes JSON
    // "Type: Import / Size: 24 OZ / Container: Can / Brand: Modelo / …"
    { vendorColumn: 'Tags',        targetField: 'attributes',
      transform: 'parse_kv_pairs', transformArgs: { pairSep: ' / ', kvSep: ': ' } },

    // Shipping — park in attributes so nothing is lost
    { vendorColumn: 'Shipping Weight (lb)', targetField: 'ecomPackWeight', transform: 'parse_number' },
    { vendorColumn: 'Shipping Width (in)',  skip: true },
    { vendorColumn: 'Shipping Length (in)', skip: true },
    { vendorColumn: 'Shipping Height (in)', skip: true },

    // Created on — no canonical target
    { vendorColumn: 'Created on',  skip: true },

    // Pack 1..Pack 6 repeated sets — kept as additional UPCs (pipes)
    // For now we keep it simple: Pack 1 UPC becomes the `linkedUpc`; the rest
    // are skipped. Admin can extend the mapping via the UI to pipe-join them
    // into `additional_upcs` if their catalog actually uses all 6 packs.
    { vendorColumn: 'Pack 1 UPC',  targetField: 'linkedUpc',          transform: 'strip_prefix', transformArgs: { prefix: '_' } },
    { vendorColumn: 'Pack 1 Name', skip: true },
    { vendorColumn: 'Pack 1 SKU',  skip: true },
    { vendorColumn: 'Pack 1 Size', skip: true },
    { vendorColumn: 'Pack 1 Unit Cost', skip: true },
    { vendorColumn: 'Pack 1 Price',     skip: true },
    { vendorColumn: 'Pack 1 Promo Price', skip: true },
    { vendorColumn: 'Pack 1 Sold Online', skip: true },
    { vendorColumn: 'Pack 1 Ecom Primary', skip: true },
  ],
};

// ─── Pine State — Monthly Specials XLSX ─────────────────────────────────────
// Pure promo file, 14 cols, Excel-serial dates, 1200+ rows.
// Matches existing products by UPC; never creates new products.
const PINE_STATE = {
  name: 'Pine State — Monthly Specials',
  slug: 'pine-state-specials',
  description: 'Pine State monthly liquor specials. Promo-only file — matches existing products by UPC, never creates new ones. Excel serial dates converted.',
  target: 'promotions',
  vendorHint: 'Pine State Beverages, Maine liquor specials, Monthly',
  mappings: [
    // Match existing product by UPC
    { vendorColumn: 'UPC',             targetField: 'product_upcs',   transform: 'trim_leading_zero' },

    // Promo identity + type
    { vendorColumn: 'Description',     targetField: 'name' },
    { vendorColumn: 'Item #',          targetField: 'itemCode' },

    // Pricing
    { vendorColumn: 'Retail',          targetField: 'originalPrice',  transform: 'parse_currency' },
    { vendorColumn: 'Sale Price',      targetField: 'discountValue', transform: 'parse_currency' },

    // Dates — Excel serials (e.g. 46113 = Apr 1 2026)
    { vendorColumn: 'Effective Start', targetField: 'startDate',      transform: 'excel_serial_to_date' },
    { vendorColumn: 'Effective End',   targetField: 'endDate',        transform: 'excel_serial_to_date' },

    // Metadata — park in attributes / skip
    { vendorColumn: 'Size',              skip: true },
    { vendorColumn: 'Unit',              skip: true },
    { vendorColumn: 'Proof',             skip: true },
    { vendorColumn: 'Retail Savings',    skip: true },
    { vendorColumn: 'Agency Cost',       skip: true },
    { vendorColumn: 'Agency Sale Cost',  skip: true },
    { vendorColumn: 'Agency Savings',    skip: true },

    // Constants — treat every row as a fixed-price sale promo
    { vendorColumn: '__promo_type',     targetField: 'promo_type',     constantValue: 'sale' },
    { vendorColumn: '__discount_type',  targetField: 'discount_type',  constantValue: 'fixed' },
    { vendorColumn: '__active',         targetField: 'active',         constantValue: 'true' },
  ],
};

async function upsertTemplate(preset) {
  const existing = await prisma.vendorImportTemplate.findUnique({
    where: { slug: preset.slug },
    include: { mappings: true },
  });

  if (existing) {
    console.log(`  ↻ ${preset.slug} already exists (${existing.mappings.length} mappings) — skipping`);
    return { id: existing.id, skipped: true };
  }

  const created = await prisma.vendorImportTemplate.create({
    data: {
      name: preset.name,
      slug: preset.slug,
      description: preset.description,
      target: preset.target,
      vendorHint: preset.vendorHint,
      mappings: {
        create: preset.mappings.map((m, i) => ({
          vendorColumn:  m.vendorColumn || '',
          targetField:   m.targetField  || null,
          transform:     m.transform    || null,
          transformArgs: m.transformArgs || null,
          constantValue: m.constantValue || null,
          skip:          !!m.skip,
          sortOrder:     i,
        })),
      },
    },
  });
  console.log(`  + ${preset.slug} created with ${preset.mappings.length} mappings`);
  return { id: created.id, skipped: false };
}

async function main() {
  console.log('[seedVendorTemplates] Seeding 3 built-in templates…');
  await upsertTemplate(AGNE);
  await upsertTemplate(SANTE);
  await upsertTemplate(PINE_STATE);

  const total = await prisma.vendorImportTemplate.count();
  console.log(`[seedVendorTemplates] Done. Total templates in DB: ${total}.`);
}

main()
  .catch((e) => { console.error('[seedVendorTemplates] FAILED:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
