/**
 * Sante POS — product export transformer
 *
 * Source: Sante POS exports a single "products.csv" with 80 columns:
 *   - 26 product-level columns (Title, Price, UPC, SKU, Distributor, etc.)
 *   - 9 columns × 6 pack variants (Pack 1-6 Name, UPC, SKU, Size, Unit Cost,
 *     Price, Promo Price, Sold Online, Ecom Primary)
 *
 * The output is a Storeveu-format CSV ready for /portal/bulk-import. The
 * importer's existing alias table already routes most Sante column names
 * (Distributor → vendorId, Category → departmentId, In Stock → quantityOnHand,
 * Unit Cost → defaultCostPrice, etc.) so this transformer mostly normalises
 * Sante's specific quirks:
 *
 *   1. UPC is prefixed with `_` (e.g. "_01235401615") — strip the underscore
 *   2. Prices include `$` and tax rate includes `%` — strip both
 *   3. `Pack Size` is the per-sell-unit count (defaults to 1 when blank/0)
 *   4. Pack 1-6 variants flatten into:
 *        - `additionalUpcs` (pipe-separated UPCs)
 *        - `packOptions` (semicolon-separated `label@count@price`)
 *   5. `Tags` are free-form `key: value / key: value` pairs — parsed and
 *      split by KIND:
 *        - `Other: <name>` entries are sibling-product cross-references
 *          (e.g. RED BULL 8 OZ tagged with "Other: RED BULL 12 OZ CN" links
 *          it to the 12 OZ variant). These become productGroup memberships.
 *          When a row has multiple Other: tags, all values are emitted to
 *          `productGroup` pipe-separated; the first one wins for
 *          productGroupId in the importer.
 *        - All non-Other pairs (Brand, ABV, Container, Vintage, Region, …)
 *          serialise into `attributes` JSON for round-trip storage on
 *          MasterProduct.attributes.
 */

import { getColumnValue } from './helpers.js';

export const santeConfig = {
  vendorId: 'SANTE',
  vendorName: 'Sante POS — Product Export',
  description:
    'Transforms Sante POS product CSV exports into Storeveu bulk-import format. ' +
    'Handles UPC underscore prefix, currency-symbol prices, and 6-pack-variant flattening.',
  supportedFormats: ['csv'],
  transformationRules: {
    columnsRemoved: [
      'Created on',
      'publicId',
      'Surcharge',
      'Importer',
      'Bill & Hold',
      'Shipping Weight (lb)',
      'Shipping Width (in)',
      'Shipping Length (in)',
      'Shipping Height (in)',
      'Pack 1-6 Sold Online',
      'Pack 1-6 Ecom Primary',
    ],
    transformations: [
      'UPC: strip leading `_` prefix',
      'Price / Promo Price / Bottle Deposit: strip `$` symbol',
      'Tax Rate: strip `%` symbol',
      'Pack Size: default to 1 when blank or 0',
      'Pack 1-6 variants: flatten UPCs into additionalUpcs (pipe-separated)',
      'Pack 1-6 variants: flatten into packOptions (label@unitCount@price;…)',
      'Tags: parse "key: value / key: value" → productGroup + attributes JSON',
    ],
  },
};

/* ───────────────────── helpers ───────────────────── */

/** Strip Sante's leading underscore from a single UPC. Returns digits-only. */
function cleanSanteUpc(raw: unknown): string {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  // Sante prefixes every UPC with `_`, e.g. "_01235401615". Strip it then
  // keep only digits (defensive — some Sante exports include spaces).
  return s.replace(/^_/, '').replace(/\D/g, '');
}

/**
 * Sante's `UPC` field can hold MULTIPLE UPCs comma-separated, e.g.:
 *   "_8800407224,8800407236"   ← two-pack with two distinct barcodes
 * The leading `_` only prefixes the first value; subsequent values come bare.
 * Split, clean each, drop empties — first non-empty becomes the primary scan
 * key, the rest fold into additionalUpcs.
 *
 * Returns `[primary, ...alternates]` — all empty array means no UPCs at all.
 */
function splitSanteUpcs(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  return String(raw)
    .split(',')
    .map((v) => cleanSanteUpc(v))
    .filter((v) => v.length > 0);
}

/** Strip $/€/£ + commas, return numeric string with up to 4 decimals. */
function cleanCurrency(raw: unknown): string {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim().replace(/[$€£,]/g, '');
  if (s === '') return '';
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return '';
  // Preserve precision — most Sante prices are 2 decimals but Bottle Deposit
  // can be 4 (e.g. 0.0500). Use toString so trailing zeros aren't lost.
  return String(n);
}

/** Strip `%` from "6.25%" → "6.25". Empty stays empty. */
function cleanPercent(raw: unknown): string {
  if (raw == null || raw === '') return '';
  return String(raw).trim().replace(/%/g, '').trim();
}

/**
 * Parse Sante's free-form Tags string into a structured pair list.
 *
 * Format: `Key: Value / Key: Value` (slash-separated, colon-delimited).
 * Examples:
 *   ""                                    → []
 *   "Container: Bottle"                   → [{key:'Container', value:'Bottle'}]
 *   "Container: Bottle / Size: 750 ML"    → [{key:'Container', value:'Bottle'}, {key:'Size', value:'750 ML'}]
 *
 * Falls back gracefully — anything unrecognised is preserved as-is in `value`
 * with `key` left empty.
 */
function parseSanteTags(raw: unknown): Array<{ key: string; value: string }> {
  if (raw == null || raw === '') return [];
  const s = String(raw).trim();
  if (!s) return [];
  return s.split('/').map((part) => {
    const [keyRaw, ...valueParts] = part.split(':');
    const key   = (keyRaw || '').trim();
    const value = valueParts.join(':').trim();
    return value ? { key, value } : { key: '', value: key };
  });
}

/**
 * Flatten Sante's Pack 1-6 variants into Storeveu's `packOptions` format.
 *
 * Output format (per importService.ts:288):
 *   "label@unitCount@price[*];label@unitCount@price[*];…"
 *   (asterisk marks the cashier-picker default — Sante's `Pack 1` is treated
 *    as default when present.)
 *
 * Sante columns per pack:
 *   - Pack N Name        → label
 *   - Pack N Size        → unitCount (numeric — count of base units in this pack)
 *   - Pack N Price       → price (retail)
 *   - Pack N UPC         → goes into additionalUpcs separately
 *   - Pack N SKU / Promo / Sold Online / Ecom Primary → ignored
 *
 * Skips empty packs (every field blank). Returns an empty string when no
 * pack rows are populated — caller can simply omit the column.
 */
function buildPackOptions(row: Record<string, unknown>): string {
  const get = (k: string) => getColumnValue(row, k);
  const segments: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const name  = get(`Pack ${i} Name`);
    const size  = get(`Pack ${i} Size`);
    const price = get(`Pack ${i} Price`);
    if (!name && !size && !price) continue;       // pack i not populated
    const label = (name ? String(name).trim() : `Pack ${i}`) || `Pack ${i}`;
    const count = String(size ?? '').trim() || '1';
    const cost  = cleanCurrency(price);
    if (!cost) continue;                          // skip if no usable price
    // Mark Pack 1 as cashier-picker default when present.
    const star  = i === 1 ? '*' : '';
    // The format is positional — the helper at importer-side splits on `@`,
    // so any `@` inside a label would break parsing. Strip them defensively.
    const safeLabel = label.replace(/@/g, ' ');
    segments.push(`${safeLabel}@${count}@${cost}${star}`);
  }
  return segments.join(';');
}

/**
 * Return the cleaned UPCs from Pack 1-6 columns (each may itself be
 * comma-separated, though that's rare). Caller dedupes + joins.
 */
function buildAdditionalUpcsFromPacks(row: Record<string, unknown>): string[] {
  const get = (k: string) => getColumnValue(row, k);
  const upcs: string[] = [];
  for (let i = 1; i <= 6; i++) {
    for (const u of splitSanteUpcs(get(`Pack ${i} UPC`))) {
      upcs.push(u);
    }
  }
  return upcs;
}

/* ───────────────────── public API ───────────────────── */

/**
 * Transform a single Sante row into Storeveu bulk-import format.
 * Column names emitted match the importer's `FIELD_ALIASES` table so the
 * downstream Bulk Import auto-maps without user intervention.
 */
export function transformRow(
  row: Record<string, unknown>,
  _depositMapping: Record<string, unknown> = {},
  _options: Record<string, unknown> = {},
): { transformedRow: Record<string, unknown>; warnings: string[] } {
  const get = (k: string) => getColumnValue(row, k);
  const warnings: string[] = [];
  const out: Record<string, unknown> = {};

  /* — Identity — */
  out.name = get('Title') || '';
  // The UPC column may hold a comma-separated list (multi-pack, parent+inner
  // barcode, etc.). First value becomes the primary scan key; the rest fold
  // into additionalUpcs alongside Pack 1-6 UPCs further down. This handles
  // ~2.5K of Donovan's ~7.7K rows and ~14 of Sullivan's; original Sante
  // single-UPC rows are unaffected because the helper just returns one value.
  const titleUpcs = splitSanteUpcs(get('UPC'));
  out.upc  = titleUpcs[0] || '';
  out.sku  = get('SKU') || '';
  if (!out.name) warnings.push('Missing Title');
  if (!out.upc && !out.sku) warnings.push(`Missing both UPC and SKU for "${out.name}"`);

  /* — Pricing — */
  out.defaultRetailPrice = cleanCurrency(get('Price'));
  out.defaultCostPrice   = cleanCurrency(get('Unit Cost'));
  out.defaultCasePrice   = cleanCurrency(get('Case Cost'));
  out.specialPrice       = cleanCurrency(get('Promo Price'));
  out.depositPerUnit     = cleanCurrency(get('Bottle Deposit'));

  /* — Pack config — */
  // Sante's "Units Per Case" is the inner pack count (e.g. 12 cans per case).
  out.packInCase = String(get('Units Per Case') ?? '').trim() || '';
  // "Pack Size" is per-sell-unit count. Sante leaves this blank for single
  // units — the user explicitly asked for default=1 when blank/zero.
  const packSizeRaw = String(get('Pack Size') ?? '').trim();
  const packSizeNum = parseFloat(packSizeRaw);
  out.unitPack = !packSizeRaw || !Number.isFinite(packSizeNum) || packSizeNum <= 0
    ? '1'
    : String(packSizeNum);

  /* — Classification — */
  out.vendorName     = get('Distributor') || '';
  out.itemCode       = get('Item number') || '';
  out.departmentName = get('Category') || '';
  // Tax Rate is a percentage string like "6.25%" — strip and pass through;
  // the importer's `taxClass` alias accepts it as a free-text class today.
  // When the org migrates to taxRule-by-name, this still feeds the correct
  // column via the alias table.
  out.taxClass = cleanPercent(get('Tax Rate'));

  /* — Inventory — */
  out.quantityOnHand = String(get('In Stock') ?? '').trim();
  out.reorderPoint   = String(get('Reorder Threshold') ?? '').trim();

  /* — Image — */
  // Sante's Images is a comma-separated URL list. The importer alias
  // accepts the first URL via `imageurl`/`images` aliases — pass through
  // verbatim and let the importer pick the first.
  out.imageUrl = get('Images') || '';

  /* — Multi-pack variants — */
  const packOptions = buildPackOptions(row);
  if (packOptions) out.packOptions = packOptions;

  // Combine extra UPCs from two sources:
  //   • trailing values in the comma-separated primary UPC field (skip [0],
  //     which already became `out.upc`)
  //   • Pack 1-6 UPC columns
  // De-duped against the primary upc + against each other so the importer's
  // `@@unique([orgId, upc])` constraint doesn't blow up on the same value
  // appearing in multiple slots.
  const seen = new Set<string>();
  if (out.upc) seen.add(out.upc as string);
  const extras: string[] = [];
  for (const u of titleUpcs.slice(1)) {
    if (!seen.has(u)) { seen.add(u); extras.push(u); }
  }
  for (const u of buildAdditionalUpcsFromPacks(row)) {
    if (!seen.has(u)) { seen.add(u); extras.push(u); }
  }
  if (extras.length > 0) out.additionalUpcs = extras.join('|');

  /* — Tags → productGroup + attributes —
     Sante's Tags field carries TWO different kinds of data interleaved:
       (a) "Other: <product name>"  — product-group memberships. These are
           cross-references between sibling products (e.g. RED BULL 8 OZ
           tagged with "Other: RED BULL 12 OZ CN" means it's grouped with
           the 12 OZ variant). MasterProduct.productGroupId is single-valued
           so we use the FIRST Other: tag's value as the group name and
           let the importer auto-create / link by name.
       (b) "Brand: Smirnoff", "ABV: 5%", "Container: Bottle", etc.
           — real attribute key/value pairs that go into MasterProduct.attributes
           as JSON. NOT used for grouping.

     Splitting them avoids the previous behavior where the FIRST tag (often
     "Color: Sparkling" or similar) was stuffed into productGroup, which
     produced meaningless one-of-a-kind groups like "Color: Sparkling". */
  const tags = parseSanteTags(get('Tags'));
  if (tags.length > 0) {
    // Case-insensitive split — Sante users write "Other:", "OTHER:", etc.
    const isOtherTag = (t: { key: string; value: string }) =>
      (t.key || '').trim().toLowerCase() === 'other';
    const groupTags = tags.filter(isOtherTag);
    const attrTags  = tags.filter((t) => !isOtherTag(t));

    if (groupTags.length > 0) {
      // First Other: value becomes the productGroup name. When multiple are
      // present, we pipe-separate them so a future multi-group importer can
      // use them all; today the importer will use only the first segment.
      const groupNames = groupTags
        .map((t) => (t.value || '').trim())
        .filter((v) => v.length > 0);
      if (groupNames.length > 0) {
        out.productGroup = groupNames.join('|');
        if (groupNames.length > 1) {
          warnings.push(
            `"${out.name}" has ${groupNames.length} Other: group memberships; importer will use the first ("${groupNames[0]}") for productGroupId`,
          );
        }
      }
    }

    if (attrTags.length > 0) {
      const obj: Record<string, string> = {};
      for (const t of attrTags) {
        // Sante always sends real key:value pairs here (Brand, ABV, Container,
        // etc.). When the parser couldn't find a colon, t.key is empty and
        // t.value holds the raw text — store under "_" so we don't lose it.
        const k = t.key || '_';
        let key = k, n = 1;
        while (Object.prototype.hasOwnProperty.call(obj, key)) {
          key = `${k}_${++n}`;
        }
        obj[key] = t.value;
      }
      out.attributes = JSON.stringify(obj);
    }
  }

  return { transformedRow: out, warnings };
}

export function getOutputColumns(): string[] {
  return [
    // Identity
    'name', 'upc', 'sku',
    // Pricing
    'defaultRetailPrice', 'defaultCostPrice', 'defaultCasePrice',
    'specialPrice', 'depositPerUnit',
    // Pack
    'packInCase', 'unitPack',
    // Classification
    'vendorName', 'itemCode', 'departmentName', 'taxClass',
    // Inventory
    'quantityOnHand', 'reorderPoint',
    // Media
    'imageUrl',
    // Multi-pack flatten
    'packOptions', 'additionalUpcs',
    // Sante tags
    'productGroup', 'attributes',
  ];
}
