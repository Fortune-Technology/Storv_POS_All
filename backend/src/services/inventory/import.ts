/**
 * importService.ts
 * ─────────────────────────────────────────────────────────────
 * Bulk import pipeline for Storeveu catalog entities.
 *
 * Public API:
 *   parseFile(buffer, mimeType, originalName)  → { headers, rows }
 *   detectColumns(headers)                     → mapping { schemaField → rawHeader }
 *   buildContext(orgId)                        → lookup maps for dept/vendor resolution
 *   validateRows(rows, type, mapping, ctx, opts) → { valid, invalid, warnings }
 *   importRows(valid, type, orgId, storeId, opts) → { created, updated, skipped, errors }
 *   generateTemplate(type)                     → Buffer (CSV)
 *
 * Supported types: products | departments | vendors | promotions | deposits | invoice_costs
 */

import XLSX from 'xlsx';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { batchUpsertGlobalImages } from '../globalImageService.js';

// ── Public domain shapes ────────────────────────────────────────────────────

/** All entity types this import pipeline understands. */
export type ImportType =
  | 'products'
  | 'departments'
  | 'vendors'
  | 'promotions'
  | 'deposits'
  | 'invoice_costs';

/** Mapping schemaField → raw CSV header (set by detectColumns or user). */
export type ImportMapping = Record<string, string>;

/** A raw row coming from CSV/XLSX — keys are user-supplied headers. */
export type RawImportRow = Record<string, unknown>;

/** A small dept/vendor record carried in the lookup maps. */
interface NamedRecord { id: number; name: string; code?: string | null }
interface NamedStrIdRecord { id: string; name: string }
interface TaxRuleLookupRow {
  id: string; name: string;
  rate: unknown;
  appliesTo: string | null;
}

/** Lookup context built once per import — built by `buildContext`. */
export interface ImportContext {
  deptById: Map<number, NamedRecord>;
  deptByName: Map<string, NamedRecord>;
  deptByCode: Map<string, NamedRecord>;
  vendorById: Map<number, NamedRecord>;
  vendorByName: Map<string, NamedRecord>;
  vendorByCode: Map<string, NamedRecord>;
  depositById: Map<string, NamedStrIdRecord>;
  depositByName: Map<string, NamedStrIdRecord>;
  taxRules: TaxRuleLookupRow[];
  taxByRate: Map<string, TaxRuleLookupRow>;
  taxByClassName: Map<string, TaxRuleLookupRow>;
  taxByRuleName: Map<string, TaxRuleLookupRow>;
  // ProductGroup lookup — populated lazily from existing groups in the org.
  // Used by Sante's `Other:`-tag-driven productGroup column to link products
  // to existing groups by name and (with strategy='create') to flag missing
  // ones for auto-creation in the write phase.
  productGroupByName: Map<string, NamedRecord>;
}

/** Per-row validation result. */
export interface ValidationError {
  rowNumber: number;
  errors: string[];
  raw?: RawImportRow;
}

export interface ValidationWarning {
  rowNumber: number;
  message: string;
}

export interface ValidationOutcome<TRow = Record<string, unknown>> {
  valid: TRow[];
  invalid: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ rowNumber?: number; message: string }>;
}

export interface ParsedFile {
  headers: string[];
  rows: RawImportRow[];
}

export interface ValidateRowsOpts {
  duplicateStrategy?: 'skip' | 'update' | 'error';
  // Pass-through extras for caller-provided knobs (e.g. dept-creation strategy)
  [key: string]: unknown;
}

export interface ImportRowsOpts {
  duplicateStrategy?: 'skip' | 'update' | 'error';
  [key: string]: unknown;
}

// Marker so you can tell from logs which version of the mapping code is loaded.
// Bump IMPORT_SERVICE_VERSION whenever you change ALIASES or detectColumns.
export const IMPORT_SERVICE_VERSION = '2026-04-24-v5-product-group-auto-create';
console.log('[importService] loaded version:', IMPORT_SERVICE_VERSION);

// ─── Column alias maps ───────────────────────────────────────────────────────
// Keys = Prisma field names.  Values = all known column header variants
// (lowercased, stripped of spaces/underscores/hyphens).
const ALIASES: Record<string, string[]> = {
  // Product identifiers
  upc:                ['upc','barcode','ean','gtin','upccode','scancode','itemcode_upc'],
  plu:                ['plu','plunumber','producelookup'],
  // (sku alias removed per product decision — internal SKU is not user-facing
  //  and the schema column is preserved but no longer mapped from CSV.)
  itemCode:           ['itemcode','item','vendoritemcode','mfrcode','vendorcode','distitemno','itemnumber','itemno','item#'],

  // Product display — 'description' maps to name (product name), NOT long description
  name:               ['name','title','description','productname','itemdesc','itemdescription','proddesc','itemname','prodname','producttitle'],
  brand:              ['brand','brandname','mfrname'],
  size:               ['size','itemsize','productsize'],
  sizeUnit:           ['sizeunit','unit','uom','unitofmeasure','itemuom','item_uom'],
  // ── Pack fields (fix for Case Packs / Pack size collision) ─────────────
  // IMPORTANT: `packInCase` and `unitPack` are listed BEFORE `pack` so
  // detectColumns claims "Case Packs" and "Pack size" to the specific
  // fields first, leaving `pack` as a generic total-units alias.
  packInCase:         ['packincase','pack_in_case','casepacks','case_packs','casepack','innerpack','packspercase','unitspercase'],
  unitPack:           ['unitpack','packsize','pack_size','unitsize','unit_size','unitspersellunit','sellunitsize','sell_unit_size','unitsperpack','countperpack'],
  casePacks:          ['casepacksraw','innerpackraw'],   // kept for manual mapping; aliased by packInCase above
  sellUnitSize:       ['sellunitsizeraw','unitsperpackraw'], // kept for manual mapping; aliased by unitPack above
  pack:               ['pack','totalpack','casesizecf','totalunitspercase','totalunits','units'],

  // Pricing — aliases ordered by priority (first alias in list wins)
  defaultCostPrice:   ['unitcost','cost','invoicecost','eachcost','purchaseprice','ourcost','costprice','unitprice'],
  defaultRetailPrice: ['price','retail','sellprice','retailprice','suggestedretail','msrp','srp','regprice','regretail','reg_retail','normalretail','normal_price'],
  // Prefer "casecost" (real cost) over "caseprice" (MSRP) so Case Cost wins when both present
  defaultCasePrice:   ['casecost','case_cost','costpercase','invoicecasecost','caseprice','case_price','regularcost','reg_cost'],
  regMultiple:        ['regmultiple','reg_multiple','regularmultiple'],

  // Classification
  departmentId:       ['dept','department','deptid','deptno','departmentid','category','deptcode','deptnumber','dept_no'],
  vendorId:           ['vendor','supplier','vendorid','vendorno','supplierid','distributor','vendorname','vendor_name','importer'],
  // ProductGroup — single column, value is the group's display name. Multiple
  // groups can be encoded pipe-separated (only the first wins for productGroupId
  // since the schema is single-belongs-to). Auto-created when missing if the
  // import is run with unknownProductGroupStrategy='create' (default).
  // Sante's `Other:` tag values land here via the Sante transformer.
  productGroupName:   ['productgroup','productgroupname','group','groupname','product_group','product_group_name'],
  // Session 40 Phase 1 (strict FK migration): `taxRuleName` is the preferred
  // field — resolved to MasterProduct.taxRuleId by name lookup against the
  // org's TaxRule table. `taxClass` is the legacy free-text column kept for
  // backward compat. Mapping both is fine; taxRuleName wins when it resolves.
  taxRuleName:        ['taxrulename','taxrule','taxname'],
  taxClass:           ['taxclass','tax1','taxtype','taxcategory','taxcode','taxrate'],

  // Compliance
  ageRequired:        ['agerequired','minage','age','agerestriction','ageverification','validage'],
  // EBT / SNAP / Food Stamp — all route to ebtEligible (the schema keeps a
  // `foodstamp` mirror column, but it's populated from this same flag — there
  // is no separate foodstamp alias entry, which prevents non-deterministic
  // mapping when a CSV header like "EBT" could match either field.
  ebtEligible:        ['ebt','ebteligible','foodstamp','food_stamp','snap','ebtsnap','snapeligible'],
  discountEligible:   ['discount','discounteligible','discountable','allowdiscount'],
  taxable:            ['taxable','istaxable','taxed'],
  active:             ['active','status','enabled','isenabled','isactive'],

  // Inventory
  reorderPoint:       ['reorderpoint','minstock','reorderat','minimumstock','minqtyonhand','reorderthreshold','reordermin'],
  reorderQty:         ['reorderqty','reorderquantity','orderqty','suggestedorderqty','reorderamt'],

  // Dept-specific
  code:               ['code','deptcode','shortcode','abbreviation','abbrev'],
  color:              ['color','colour','hexcolor','deptcolor'],
  sortOrder:          ['sortorder','sort','order','sequence','displayorder'],
  showInPOS:          ['showinpos','posvisible','visible','showonpos'],
  // FIXED: removed 'bottledeposit' and 'deposit' from here — those aliases
  // were colliding with depositPerUnit and depositAmount (dollar amounts).
  // A CSV column "Bottle Deposit" with "$0.05" was being parsed as boolean true
  // instead of a dollar value. Now the boolean dept flag uses unique aliases only.
  bottleDeposit:      ['deptdeposit','depositrequired','crv','crvapplicable','hasdeposit'],
  description:        ['longdesc','longdescription','notes','comments','productdescription','fulldescription'],

  // Vendor-specific
  contactName:        ['contactname','contact','repname','salesrep','contactperson'],
  email:              ['email','emailaddress','contactemail','vendoremail'],
  phone:              ['phone','phonenumber','telephone','contactphone','vendorphone'],
  website:            ['website','url','web','vendorwebsite'],
  terms:              ['terms','paymentterms','net','vendorterms'],
  accountNo:          ['accountno','accountnumber','acctno','accountid','ouraccount'],

  // Promotion-specific
  promoType:          ['promotype','dealtype','promotiontype','type','promokind'],
  discountType:       ['discounttype','discountmethod','discountmode'],
  discountValue:      ['discountvalue','discountamount','savingsamount','offamount','promodiscount'],
  minQty:             ['minqty','minimumqty','minimumquantity','minunits','minpurchase'],
  buyQty:             ['buyqty','buyquantity','buy','buyx'],
  getQty:             ['getqty','getquantity','get','gety'],
  badgeLabel:         ['badge','badgelabel','badgetext','promotionlabel','poslabel'],
  // FIXED: startDate/endDate were defined TWICE (here + line 140). JavaScript
  // silently uses the last definition. Merged into one combined list each.
  startDate:          ['startdate','start','validfrom','effectivedate','promostart','salestartdate','sale_start_date'],
  endDate:            ['enddate','end','validto','expirydate','expiredate','promoend','saleenddate','sale_end_date'],

  // Deposit-specific
  // FIXED: 'bottledeposit' moved here from the dept-specific section so a CSV
  // column "Bottle Deposit" with dollar values maps to the decimal amount, not the boolean.
  // 'bottledeposit' deliberately NOT here — it's claimed by depositPerUnit (product imports).
  // depositAmount is only used by the 'deposits' import type for deposit RULES.
  depositAmount:      ['depositamount','crvamount','depositvalue','ruledeposit'],
  minVolumeOz:        ['minvolumeoz','minvolume','minimumvolume','minoz'],
  maxVolumeOz:        ['maxvolumeoz','maxvolume','maximumvolume','maxoz'],
  containerTypes:     ['containertypes','containertype','containers','bottletype'],
  state:              ['state','statecode','province'],

  // Invoice cost update
  receivedQty:        ['receivedqty','casesordered','qtyreceived','casesreceived','cases'],

  // ── Grocery / Scale features ──
  wicEligible:        ['wicable','wic','wiceligible','wicapproved'],
  tareWeight:         ['tareweight','tare','tarewt','tarelbs'],
  scaleByCount:       ['scalebycount','countscale','bycount'],
  scalePluType:       ['scaleplutype','casscaleplutype','plutype'],
  ingredients:        ['ingredients','casscaleingredients','ingredientlist','scaleingredients'],
  nutritionFacts:     ['nutritionfacts','casscalenutrition','nutrition','scalenutrition','nutritionfact'],
  certCode:           ['certcode','certification','certificationcode','cert','organic','kosher','pbhn'],
  sectionId:          ['sectionid','section','subsection','subcategory','subcatid','class'],
  sectionName:        ['sectionname','section_name','subsectionname'],
  expirationDate:     ['expirationdate','expiration','expiry','bestby','usebydate','expdate'],
  labelFormatId:      ['labelformatid','eplumlabelformatno','eplumformat','labelformat'],

  // ── Product Image ──
  imageUrl:           ['imageurl','image','images','imagelink','productimage','photourl','photo','pictureurl','picture','thumbnailurl','thumbnail','imgurl','img'],

  // ── E-commerce extended ──
  ecomExternalId:     ['ecommerceid','ecomid','ecomexternalid','externalid','shopifyid'],
  ecomPackWeight:     ['ecommercepackweight','ecomweight','packweight','shippingweight'],
  ecomPrice:          ['ecommerceprice','ecomprice','onlineprice','webprice'],
  ecomSalePrice:      ['ecommercesaleprice','ecomsaleprice','onlinesaleprice'],
  ecomOnSale:         ['ecommerceonsale','ecomonsale','onlineonsale'],
  // (ecomSummary alias removed — redundant with ecomDescription. Legacy
  //  aliases `ecommercesummary`, `onlinesummary` now route into ecomDescription
  //  below. Storefront derives the card summary from the first N chars of
  //  ecomDescription if no dedicated summary is stored.)
  // Canonical long-form SEO description for the storefront product page.
  // Also folds in legacy `ecomsummary` / `onlinesummary` aliases so CSVs
  // written for the old two-field model still import without a mapping change.
  ecomDescription:    ['ecommercedescription','ecomdescription','onlinedescription','ecommerceunitdescription',
                       'ecommercesummary','ecomsummary','onlinesummary'],
  hideFromEcom:       ['hidefromecommerce','hidefromecom','hidefromweb','excludeecom'],

  // ── Pricing method / group pricing (for SALE promotion) ──
  priceMethod:        ['pricemethod','pricingmethod','pricetype','prc_grp','prcgrp'],
  groupPrice:         ['groupprice','grouppricingamt','mixmatchprice'],
  groupQty:           ['groupqty','groupquantity','mixmatchqty','quantity'],
  specialPrice:       ['specialprice','special_price','saleprice','promoprice','saleretail','sale_retail'],
  specialCost:        ['specialcost','promotioncost','promocost','salecost','sale_cost'],
  saleMultiple:       ['salemultiple','sale_multiple','salemult'],
  // startDate/endDate — NOT duplicated here. Already defined above (line ~97-98)
  // with all sale + promo aliases combined into one entry each.

  // ── TPR (Temporary Price Reduction) — second promotion slot ──
  tprMultiple:        ['tprmultiple','tpr_multiple','tprmult'],
  tprRetail:          ['tprretail','tpr_retail','tprprice'],
  tprCost:            ['tprcost','tpr_cost'],
  tprStartDate:       ['tprstartdate','tpr_start_date','tprstart'],
  tprEndDate:         ['tprenddate','tpr_end_date','tprend'],

  // ── Future pricing (scheduled price change) ──
  futureRetail:       ['futureretail','future_retail','futureprice'],
  futureCost:         ['futurecost','future_cost'],
  futureActiveDate:   ['futureactivedate','future_active_date','futuredate'],
  futureMultiple:     ['futuremultiple','future_multiple'],

  // ── Deposits ──
  depositPerUnit:     ['depositperunit','unitdeposit','bottledeposit','bottle_deposit','bottledep'],
  // `casebottledeposit` added so the common "Case Bottle Deposit" column maps correctly
  caseDeposit:        ['casedeposit','case_deposit','casedep','casebottledeposit','case_bottle_deposit','casedeposittotal'],

  // (linkedUpc removed — redundant with `additionalUpcs` which handles any
  //  number of alternate barcodes via pipe-separated or multi-source mapping.
  //  Legacy aliases `caseupc`, `case_upc`, `altbarcode`, etc. are folded into
  //  the `additionalUpcs` alias list below so existing CSVs still import.)

  // ── Multi-UPC via pipe-separated list (matches the export format) ──
  // Example cell value: "0055555555555|0044444444444"
  // Folded in from the removed linkedUpc alias set for backward compatibility.
  additionalUpcs:     ['additionalupcs','alternateupcs','extraupcs','otherupcs','altupcs','secondaryupcs',
                       'linkedupc','caseupc','case_upc','relatedupc','altbarcode','altupc','secondaryupc'],

  // ── Pack size options compressed into ONE cell ──
  // Format: "label@unitCount@price[*];label@unitCount@price[*];…"
  // The asterisk marks the default selection shown first in the cashier picker.
  // Example: "Single@1@1.99;6-Pack@6@9.99*;Case@24@32.00"
  packOptions:        ['packoptions','packsizes','pack_size_options','packsizelist','multipack','packpicker'],

  // ── Legacy / misc ──
  quantityOnHand:     ['quantityonhand','qoh','stockqty','onhand','currentstock','inventoryqty','instock','stockcount','inventory'],
  byWeight:           ['scale','byweight','soldbyweight','scalable','weightitem'],
  // (foodstamp alias removed — see ebtEligible above. DB column stays in sync
  // via the row builder, which mirrors ebtEligible → foodstamp.)
  // (productCode alias removed — was never persisted to a MasterProduct column;
  // manufacturer codes should map to `itemCode` or a custom attribute instead.)
  trackInventory:     ['trackinventory','track_inventory','deductstock','inventorytracked'],
  // `weight` is the ship weight in lbs (used by ecom storefront + carriers).
  // It moved from the Inventory group to the E-Commerce group in the dropdown.
  weight:             ['weight','productweight','itemweight','lbs','pounds','shipweight','shippingweight'],
  // Shipping package dimensions (imperial: inches)
  shipLengthIn:       ['shiplength','length','shippinglength','boxlength','boxlen','packagelength','pkglength'],
  shipWidthIn:        ['shipwidth','width','shippingwidth','boxwidth','packagewidth','pkgwidth'],
  shipHeightIn:       ['shipheight','height','shippingheight','boxheight','packageheight','pkgheight'],
};

// ─── Valid enum values ───────────────────────────────────────────────────────
const VALID_TAX_CLASSES   = ['grocery','alcohol','tobacco','hot_food','standard','non_taxable','none'];
const VALID_PROMO_TYPES   = ['sale','bogo','volume','mix_match','combo'];
const VALID_DISCOUNT_TYPES = ['percent','amount','fixed'];

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeHeader(h: string | null | undefined): string {
  // Also strips `*` so a template header like `upc*` (marking the field
  // as required in the downloadable template) still matches the alias `upc`.
  return String(h || '').toLowerCase().trim().replace(/[\s_\-\.#\/\\()\[\]\*]+/g, '');
}

function parseBool(v: unknown, def: boolean = false): boolean {
  if (v === null || v === undefined || v === '') return def;
  if (typeof v === 'boolean') return v;
  return ['true','yes','1','y','x'].includes(String(v).toLowerCase().trim());
}

function parseDecimal(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isNaN(n) ? null : n;
}

function parseIntVal(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = parseInt(String(v).trim(), 10);
  return isNaN(n) ? null : n;
}

function parseDate(v: unknown): Date | null {
  if (!v || String(v).trim() === '') return null;
  // Handle Excel serial dates
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(v).trim());
  return isNaN(d.getTime()) ? null : d;
}

// ─── File Parsing ─────────────────────────────────────────────────────────────
/**
 * Parse a CSV or XLSX buffer into { headers: string[], rows: object[] }
 */
export function parseFile(
  buffer: Buffer,
  mimeType: string = '',
  originalName: string = '',
): ParsedFile {
  const ext = (originalName.split('.').pop() || '').toLowerCase();
  const isExcel = ['xlsx', 'xls'].includes(ext) ||
    mimeType.includes('spreadsheetml') ||
    mimeType.includes('ms-excel');

  let workbook: XLSX.WorkBook;
  if (isExcel) {
    workbook = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: false });
  } else {
    // CSV or TSV — convert to string first
    const str = buffer.toString('utf8').replace(/^\uFEFF/, ''); // strip BOM
    const sep = ext === 'tsv' || mimeType === 'text/tab-separated-values' ? '\t' : ',';
    workbook = XLSX.read(str, { type: 'string', FS: sep, raw: false });
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };

  const sheet = workbook.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][];

  if (!aoa || aoa.length < 2) return { headers: [], rows: [] };

  // Find first non-empty row as headers
  let headerIdx = 0;
  while (headerIdx < aoa.length && !aoa[headerIdx].some((c) => String(c).trim())) headerIdx++;

  const rawHeaders = aoa[headerIdx].map((h) => String(h || '').trim());
  const dataRows: RawImportRow[] = aoa.slice(headerIdx + 1)
    .filter((row) => row.some((cell) => String(cell).trim() !== ''))
    .map((row, rowIndex): RawImportRow => {
      const obj: RawImportRow = { __rowNum: headerIdx + 2 + rowIndex }; // 1-based row number in file
      rawHeaders.forEach((h, i) => {
        obj[h] = row[i] !== undefined && row[i] !== null ? String(row[i]).trim() : '';
      });
      return obj;
    });

  return { headers: rawHeaders, rows: dataRows };
}

// ─── Column Detection ─────────────────────────────────────────────────────────
/**
 * Auto-map raw CSV headers to Prisma schema field names.
 * Returns: { [schemaField]: rawHeader }
 */
export function detectColumns(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const normalizedHeaders = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));

  // A raw header can only be claimed by ONE schema field so we don't
  // double-map (e.g. "Case Packs" was being claimed by both `pack` and
  // `casePacks`, causing unpredictable collisions).
  const claimedHeaders = new Set<string>();

  // Fields are iterated in the order they appear in the ALIASES object.
  // Within each field, aliases are tried in order so the FIRST alias in
  // the list has priority (e.g. `defaultCasePrice` tries `casecost`
  // before `caseprice` so real cost wins over MSRP case price).
  for (const [field, aliases] of Object.entries(ALIASES)) {
    if (mapping[field]) continue;
    for (const alias of aliases) {
      const match = normalizedHeaders.find(
        (h) => h.norm === alias && !claimedHeaders.has(h.raw)
      );
      if (match) {
        mapping[field] = match.raw;
        claimedHeaders.add(match.raw);
        break;
      }
    }
  }
  return mapping;
}

// ─── Context Builder ──────────────────────────────────────────────────────────
/**
 * Pre-load lookup data from DB to resolve dept/vendor references during validation.
 */
export async function buildContext(orgId: string): Promise<ImportContext> {
  const [departments, vendors, depositRules, taxRules, productGroups] = await Promise.all([
    prisma.department.findMany({
      where: { orgId, active: true },
      select: { id: true, name: true, code: true },
    }),
    prisma.vendor.findMany({
      where: { orgId, active: true },
      select: { id: true, name: true, code: true },
    }),
    prisma.depositRule.findMany({
      where: { orgId, active: true },
      select: { id: true, name: true },
    }),
    prisma.taxRule.findMany({
      where: { orgId, active: true },
      select: { id: true, name: true, rate: true, appliesTo: true },
    }) as Promise<TaxRuleLookupRow[]>,
    // ProductGroups — used for `productGroup` column resolution. Includes all
    // groups (no `active` filter; the schema doesn't have one). Match is
    // case-insensitive name lookup, same pattern as Department / Vendor.
    prisma.productGroup.findMany({
      where: { orgId },
      select: { id: true, name: true },
    }),
  ]);

  // Build a lookup map for tax rules by rounded rate so imports can match
  // a "6.25%" column value directly against the store's real TaxRule table.
  // Key = 4-decimal string ("0.0625") for stable equality across Prisma's Decimal.
  const taxByRate = new Map<string, TaxRuleLookupRow>();
  const taxByClassName = new Map<string, TaxRuleLookupRow>();
  // Session 40 Phase 1 — map by rule NAME (case-insensitive, trimmed). Used
  // to resolve the new `taxRuleName` CSV field → `MasterProduct.taxRuleId`.
  const taxByRuleName = new Map<string, TaxRuleLookupRow>();
  for (const r of taxRules) {
    const rateNum = Number(r.rate);
    if (!isNaN(rateNum)) {
      const key = rateNum.toFixed(4);
      if (!taxByRate.has(key)) taxByRate.set(key, r);
    }
    if (r.appliesTo) {
      const key = String(r.appliesTo).toLowerCase().trim();
      if (!taxByClassName.has(key)) taxByClassName.set(key, r);
    }
    if (r.name) {
      const key = String(r.name).toLowerCase().trim();
      if (!taxByRuleName.has(key)) taxByRuleName.set(key, r);
    }
  }

  type DeptRow = (typeof departments)[number];
  type VendorRow = (typeof vendors)[number];
  type DepositRow = (typeof depositRules)[number];
  return {
    deptById:     new Map<number, NamedRecord>(departments.map((d: DeptRow) => [d.id, d])),
    deptByName:   new Map<string, NamedRecord>(departments.map((d: DeptRow) => [d.name.toLowerCase(), d])),
    deptByCode:   new Map<string, NamedRecord>(
      departments.filter((d: DeptRow): d is DeptRow & { code: string } => Boolean(d.code))
        .map((d: DeptRow & { code: string }): [string, NamedRecord] => [d.code.toLowerCase(), d]),
    ),
    vendorById:   new Map<number, NamedRecord>(vendors.map((v: VendorRow) => [v.id, v])),
    vendorByName: new Map<string, NamedRecord>(vendors.map((v: VendorRow) => [v.name.toLowerCase(), v])),
    vendorByCode: new Map<string, NamedRecord>(
      vendors.filter((v: VendorRow): v is VendorRow & { code: string } => Boolean(v.code))
        .map((v: VendorRow & { code: string }): [string, NamedRecord] => [v.code.toLowerCase(), v]),
    ),
    depositById:  new Map<string, NamedStrIdRecord>(depositRules.map((r: DepositRow) => [r.id, r])),
    depositByName:new Map<string, NamedStrIdRecord>(depositRules.map((r: DepositRow) => [r.name.toLowerCase(), r])),
    taxRules,      // full list for warnings/debugging
    taxByRate,
    taxByClassName,
    taxByRuleName,
    productGroupByName: new Map<string, NamedRecord>(
      productGroups.map((g: { id: number; name: string }) => [g.name.toLowerCase().trim(), g as NamedRecord]),
    ),
  };
}

// Resolve a taxClass string from a CSV cell against the store's real TaxRule
// table. Input can be:
//   "6.25%"       → lookup by rate 0.0625 → returns rule.appliesTo
//   "alcohol"     → lookup by class name → returns rule.appliesTo ("alcohol")
//   "Maine Food"  → lookup by rule name → returns rule.appliesTo
//   invalid/missing → returns null so caller can fall back to enum defaults
interface TaxClassResolution { resolved: string | null; rule: TaxRuleLookupRow | null }

function resolveTaxClassFromRules(value: unknown, ctx: ImportContext | null | undefined): TaxClassResolution {
  if (!value || !ctx?.taxByRate) return { resolved: null, rule: null };
  const str = String(value).toLowerCase().trim();

  // Try percentage/decimal rate match first
  const num = parseFloat(str.replace(/[%$,\s]/g, ''));
  if (!isNaN(num)) {
    // If value looks like a percent (e.g. "6.25"), divide by 100
    const rate = str.includes('%') || num > 1 ? num / 100 : num;
    const key = rate.toFixed(4);
    const hit = ctx.taxByRate.get(key);
    if (hit) return { resolved: hit.appliesTo, rule: hit };
  }

  // Try class name match
  const byClass = ctx.taxByClassName?.get(str);
  if (byClass) return { resolved: byClass.appliesTo, rule: byClass };

  // Try rule name match (case-insensitive)
  const byName = ctx.taxRules?.find((r) => r.name?.toLowerCase() === str);
  if (byName) return { resolved: byName.appliesTo, rule: byName };

  return { resolved: null, rule: null };
}

// ─── Department/Vendor resolvers ──────────────────────────────────────────────
//
// unknownDeptStrategy / unknownVendorStrategy:
//   'skip'   — import product with no dept/vendor, show warning (default)
//   'error'  — reject the row entirely if dept/vendor not found
//   'create' — auto-create a minimal dept/vendor and link it (happens at import time)
//
type ResolverStrategy = 'skip' | 'error' | 'create';
interface ResolverResult { id: number | null; warn: string | null; err: string | null; createName: string | null }

function resolveDept(value: unknown, ctx: ImportContext, strategy: ResolverStrategy = 'skip'): ResolverResult {
  if (!value || String(value).trim() === '') return { id: null, warn: null, err: null, createName: null };

  // Numeric → treat as ID
  const asNum = parseInt(String(value).trim(), 10);
  if (!isNaN(asNum) && asNum > 0) {
    if (ctx.deptById.has(asNum)) return { id: asNum, warn: null, err: null, createName: null };
    const msg = `Department ID ${asNum} not found`;
    return strategy === 'error'
      ? { id: null, warn: null, err: msg, createName: null }
      : { id: null, warn: msg + ' — will be skipped', err: null, createName: null };
  }

  // Text → try name match then code match (case-insensitive)
  const norm = String(value).toLowerCase().trim();
  const byName = ctx.deptByName.get(norm) || ctx.deptByCode.get(norm);
  if (byName) return { id: byName.id, warn: null, err: null, createName: null };

  // Not found — apply strategy
  if (strategy === 'error') {
    return { id: null, warn: null, err: `Department "${value}" not found`, createName: null };
  }
  if (strategy === 'create') {
    return { id: null, warn: `Department "${value}" not found — will be auto-created`, err: null, createName: String(value).trim() };
  }
  // skip (default)
  return { id: null, warn: `Department "${value}" not found — no department assigned`, err: null, createName: null };
}

function resolveVendor(value: unknown, ctx: ImportContext, strategy: ResolverStrategy = 'skip'): ResolverResult {
  if (!value || String(value).trim() === '') return { id: null, warn: null, err: null, createName: null };

  const asNum = parseInt(String(value).trim(), 10);
  if (!isNaN(asNum) && asNum > 0) {
    if (ctx.vendorById.has(asNum)) return { id: asNum, warn: null, err: null, createName: null };
    const msg = `Vendor ID ${asNum} not found`;
    return strategy === 'error'
      ? { id: null, warn: null, err: msg, createName: null }
      : { id: null, warn: msg + ' — will be skipped', err: null, createName: null };
  }

  const norm = String(value).toLowerCase().trim();
  const byName = ctx.vendorByName.get(norm) || ctx.vendorByCode.get(norm);
  if (byName) return { id: byName.id, warn: null, err: null, createName: null };

  if (strategy === 'error') {
    return { id: null, warn: null, err: `Vendor "${value}" not found`, createName: null };
  }
  if (strategy === 'create') {
    return { id: null, warn: `Vendor "${value}" not found — will be auto-created`, err: null, createName: String(value).trim() };
  }
  return { id: null, warn: `Vendor "${value}" not found — no vendor assigned`, err: null, createName: null };
}

/**
 * Resolve a productGroup name to a ProductGroup id.
 *
 * Input shapes:
 *   "12 OZ CAN BEER"             — single group, looked up by name
 *   "Variant A|Variant B"        — pipe-separated; only the FIRST is honoured
 *                                  (schema is single-valued). Caller decides
 *                                  whether the trailing names warrant a warning.
 *
 * Strategy:
 *   • 'create' (default): auto-create the group if it doesn't exist.
 *   • 'skip':             leave the product without a group + emit warning.
 *   • 'error':            fail validation.
 *
 * The resolver doesn't actually create the group — it returns `createName`
 * so the write phase (importProductRows) can do the create + cache the new
 * row in ctx for subsequent rows that reference the same group name.
 */
function resolveProductGroup(value: unknown, ctx: ImportContext, strategy: ResolverStrategy = 'create'): ResolverResult {
  if (!value || String(value).trim() === '') return { id: null, warn: null, err: null, createName: null };

  // Multi-value: split on pipe, take the first non-empty segment.
  const segments = String(value).split('|').map((s) => s.trim()).filter((s) => s.length > 0);
  if (segments.length === 0) return { id: null, warn: null, err: null, createName: null };
  const primary = segments[0];

  const norm = primary.toLowerCase().trim();
  const hit = ctx.productGroupByName.get(norm);
  if (hit) {
    // Numeric ids only (ProductGroup.id is Int) — defensive cast guards against
    // a stray non-numeric value sneaking in via NamedRecord.
    const idNum = typeof hit.id === 'number' ? hit.id : parseInt(String(hit.id), 10);
    return { id: Number.isFinite(idNum) ? idNum : null, warn: null, err: null, createName: null };
  }

  if (strategy === 'error') {
    return { id: null, warn: null, err: `ProductGroup "${primary}" not found`, createName: null };
  }
  if (strategy === 'create') {
    return {
      id: null,
      warn: `ProductGroup "${primary}" not found — will be auto-created`,
      err: null,
      createName: primary,
    };
  }
  // skip
  return { id: null, warn: `ProductGroup "${primary}" not found — no group assigned`, err: null, createName: null };
}

// ─── Row Validators ───────────────────────────────────────────────────────────

interface ValidateProductOpts {
  unknownDeptStrategy?: ResolverStrategy;
  unknownVendorStrategy?: ResolverStrategy;
  unknownProductGroupStrategy?: ResolverStrategy;
  unknownUpcStrategy?: 'skip' | 'reject';
  [key: string]: unknown;
}

interface FieldError { field: string; message: string }
interface RowValidationResult {
  valid: boolean;
  errors: FieldError[];
  warnings: FieldError[];
  cleaned: Record<string, unknown> | null;
  upc?: string;
}

function validateProductRow(
  raw: RawImportRow,
  mapping: ImportMapping | Record<string, string | string[]>,
  ctx: ImportContext,
  opts: ValidateProductOpts = {},
): RowValidationResult {
  const errors: FieldError[] = [];
  const warnings: FieldError[] = [];
  // Single-source lookup: mapping[field] is a column name
  const get = (field: string): string => {
    const m = (mapping as Record<string, string | string[]>)[field];
    if (!m) return '';
    if (Array.isArray(m)) {
      // Multi-source mapping — pick the first non-empty value so regular
      // single-value lookups (get('name') etc.) still behave sanely. Use
      // getMulti below to collect ALL values.
      for (const col of m) {
        const v = String(raw[col] || '').trim();
        if (v) return v;
      }
      return '';
    }
    return String(raw[m] || '').trim();
  };
  // Multi-source lookup: for fields like additionalUpcs where a single canonical
  // field is fed by several vendor columns (Sante's Pack 1 UPC … Pack 6 UPC).
  // Returns the joined non-empty values separated by `joinWith`.
  const getMulti = (field: string, joinWith: string = '|'): string => {
    const m = (mapping as Record<string, string | string[]>)[field];
    if (!m) return '';
    const cols = Array.isArray(m) ? m : [m];
    const parts: string[] = [];
    for (const col of cols) {
      const v = String(raw[col] || '').trim();
      if (v) parts.push(v);
    }
    return parts.join(joinWith);
  };
  const hasMapping = (field: string): boolean => {
    const m = (mapping as Record<string, string | string[]>)[field];
    if (Array.isArray(m)) return m.length > 0;
    return !!m;
  };
  const deptStrategy: ResolverStrategy   = (opts.unknownDeptStrategy   || 'skip') as ResolverStrategy;
  const vendorStrategy: ResolverStrategy = (opts.unknownVendorStrategy || 'skip') as ResolverStrategy;

  let upc       = get('upc');
  let name      = get('name');

  // Clean UPC — strip leading underscores/spaces, remove non-numeric chars (keep digits only for standard barcodes)
  if (upc) {
    upc = upc.replace(/^[_\s]+/, ''); // strip leading _ or spaces
    // If it looks like a numeric barcode, strip any remaining non-digits
    if (/^\d/.test(upc)) upc = upc.replace(/[^0-9]/g, '');
  }

  // Fallback: if no product name, use UPC or SKU as name (common in liquor/beer store exports)
  if (!name && upc) {
    name = upc;
    warnings.push({ field: 'name', message: `No product name — using UPC "${upc}" as name` });
  } else if (!name && get('sku')) {
    name = get('sku');
    warnings.push({ field: 'name', message: `No product name — using SKU as name` });
  }

  if (!name)               errors.push({ field: 'name',  message: 'Product name is required' });
  if (!upc && !get('sku') && !get('plu')) {
    errors.push({ field: 'upc', message: 'At least one identifier (upc, sku, plu) is required' });
  }

  // Prices
  const costRaw    = get('defaultCostPrice');
  const retailRaw  = get('defaultRetailPrice');
  const caseRaw    = get('defaultCasePrice');
  const cost   = parseDecimal(costRaw);
  const retail = parseDecimal(retailRaw);
  const caseP  = parseDecimal(caseRaw);

  if (costRaw   && cost   === null) errors.push({ field: 'defaultCostPrice',   message: `Invalid cost: "${costRaw}"` });
  if (retailRaw && retail === null) errors.push({ field: 'defaultRetailPrice', message: `Invalid retail: "${retailRaw}"` });
  if (caseRaw   && caseP  === null) errors.push({ field: 'defaultCasePrice',   message: `Invalid case price: "${caseRaw}"` });

  // Dept / Vendor — apply resolution strategies
  const deptRes   = resolveDept(get('departmentId'),   ctx, deptStrategy);
  const vendorRes = resolveVendor(get('vendorId'),     ctx, vendorStrategy);
  if (deptRes.err)    errors.push({ field: 'departmentId', message: deptRes.err });
  if (vendorRes.err)  errors.push({ field: 'vendorId',     message: vendorRes.err });
  if (deptRes.warn)   warnings.push({ field: 'departmentId', message: deptRes.warn });
  if (vendorRes.warn) warnings.push({ field: 'vendorId',     message: vendorRes.warn });

  // ProductGroup — same resolution pattern as vendor/dept. Default strategy
  // is 'create' so Sante imports auto-build groups from `Other:` tag values.
  // The CSV column may be pipe-separated to encode multiple group memberships
  // (e.g. "RED BULL 12 OZ CN|RED BULL 8 OZ CN") — schema currently supports
  // only one group per product, so the first segment wins. The resolver emits
  // a warning when the full string includes additional segments.
  const productGroupStrategy: ResolverStrategy = (opts.unknownProductGroupStrategy || 'create') as ResolverStrategy;
  const productGroupRaw = get('productGroupName');
  const productGroupRes = resolveProductGroup(productGroupRaw, ctx, productGroupStrategy);
  if (productGroupRes.err)  errors.push({ field: 'productGroupName', message: productGroupRes.err });
  if (productGroupRes.warn) warnings.push({ field: 'productGroupName', message: productGroupRes.warn });
  // Pipe-separated multi-value warning — emit once per row when there's >1 segment.
  if (productGroupRaw && productGroupRaw.includes('|')) {
    const segs = productGroupRaw.split('|').map((s) => s.trim()).filter(Boolean);
    if (segs.length > 1) {
      warnings.push({
        field: 'productGroupName',
        message: `Multiple product groups (${segs.length}) — only "${segs[0]}" will be assigned (schema is single-belongs-to).`,
      });
    }
  }

  // Tax class — priority order:
  //   1. Try to match against the store's REAL TaxRule table (by rate, class
  //      name, or rule name) — this is what the merchant configured in
  //      Portal → Tax Rules. Matching by rate lets a CSV with "6.25%" find
  //      the right tax rule automatically.
  //   2. Fall back to the hardcoded VALID_TAX_CLASSES enum if no tax rules
  //      exist yet for this org (first-time setup).
  //   3. Last resort: "standard" with a warning.
  //
  // Session 40 Phase 1: if the CSV also maps `taxRuleName` and it matches a
  // live TaxRule by name, set `taxRuleId` on the cleaned row AND auto-mirror
  // that rule's appliesTo into taxClass. `taxRuleName` wins over `taxClass`
  // when both are present (the FK is authoritative).
  let taxRuleId: string | null = null;
  const ruleNameRaw = get('taxRuleName');
  if (ruleNameRaw) {
    const key = String(ruleNameRaw).toLowerCase().trim();
    const hit = ctx.taxByRuleName?.get(key);
    if (hit) {
      taxRuleId = hit.id;
      // Mirror appliesTo into taxClass if the column isn't separately mapped.
      // This keeps legacy cashier-app builds (which only read taxClass) correct.
      if (!(mapping as Record<string, unknown>).taxClass) {
        // get('taxClass') below reads the mapped column; synthesize one here.
        (raw as Record<string, unknown>).__syntheticTaxClass = hit.appliesTo;
      }
    } else {
      warnings.push({ field: 'taxRuleName', message: `Tax rule "${ruleNameRaw}" not found — will try taxClass fallback` });
    }
  }

  let taxClass: string = get('taxClass') || String((raw as Record<string, unknown>).__syntheticTaxClass || '') || '';
  if (taxClass) {
    const raw = taxClass;
    const tcLower = taxClass.toLowerCase().trim();

    // STEP 1: match against store TaxRules
    const ruleHit = resolveTaxClassFromRules(raw, ctx);
    if (ruleHit.resolved) {
      taxClass = ruleHit.resolved;
    } else if (VALID_TAX_CLASSES.includes(tcLower)) {
      // STEP 2a: known enum class
      taxClass = tcLower;
    } else {
      // STEP 2b: try to parse as a percentage rate and infer class
      const pct = parseFloat(tcLower.replace(/[%$,\s]/g, ''));
      if (!isNaN(pct)) {
        if (pct === 0) {
          taxClass = 'non_taxable';
        } else {
          taxClass = 'standard';
          warnings.push({
            field: 'taxClass',
            message: `Tax "${raw}" — no matching rule at that rate, treated as "standard". Create a Tax Rule with this rate to link it.`,
          });
        }
      } else {
        // STEP 2c: common text variants
        const TAX_TEXT_MAP: Record<string, string> = {
          'none': 'none', 'no': 'non_taxable', 'notaxable': 'non_taxable', 'nontaxable': 'non_taxable',
          'yes': 'standard', 'taxable': 'standard', 'general': 'standard', 'default': 'standard',
          'beer': 'alcohol', 'wine': 'alcohol', 'liquor': 'alcohol', 'spirits': 'alcohol', 'alc': 'alcohol',
          'cig': 'tobacco', 'cigarette': 'tobacco', 'tob': 'tobacco',
          'hot': 'hot_food', 'hotfood': 'hot_food', 'prepared': 'hot_food', 'deli': 'hot_food',
          'food': 'grocery', 'groc': 'grocery',
        };
        const mapped = TAX_TEXT_MAP[tcLower.replace(/[\s_\-]/g, '')];
        if (mapped) {
          taxClass = mapped;
        } else {
          taxClass = 'standard';
          warnings.push({ field: 'taxClass', message: `Tax "${raw}" treated as "standard"` });
        }
      }
    }
  }

  // Age
  const ageRaw = get('ageRequired');
  const age    = parseIntVal(ageRaw);
  if (ageRaw && age !== null && age !== 18 && age !== 21) {
    warnings.push({ field: 'ageRequired', message: `Age must be 18 or 21 (got "${ageRaw}") — will be ignored` });
  }

  // Pack sizes — read new simplified fields first, fall back to legacy
  const packRaw        = get('pack');
  const packInCaseRaw  = get('packInCase');
  const unitPackRaw    = get('unitPack');
  const casePacksRaw   = get('casePacks');
  const sellUnitSizeRaw = get('sellUnitSize');

  let packInCase  = parseIntVal(packInCaseRaw) ?? parseIntVal(casePacksRaw);
  let unitPack    = parseIntVal(unitPackRaw)   ?? parseIntVal(sellUnitSizeRaw);
  let pack        = parseIntVal(packRaw);

  if (packRaw && pack === null)              warnings.push({ field: 'pack',       message: `Invalid pack size "${packRaw}" — will be ignored` });
  if (packInCaseRaw && packInCase === null)  warnings.push({ field: 'packInCase', message: `Invalid packInCase "${packInCaseRaw}" — will be ignored` });
  if (unitPackRaw && unitPack === null)      warnings.push({ field: 'unitPack',   message: `Invalid unitPack "${unitPackRaw}" — will be ignored` });

  // Compute pack (total units/case) if missing but we know the two parts
  if (pack === null && packInCase != null && unitPack != null) {
    pack = packInCase * unitPack;
  }
  // Default unitPack to 1 when only packInCase is known (common for "12 singles per case")
  if (packInCase != null && unitPack === null) unitPack = 1;

  if (errors.length > 0) return { valid: false, errors, warnings, cleaned: null };

  return {
    valid: true,
    errors: [],
    warnings,
    cleaned: {
      upc:                upc || null,
      plu:                get('plu') || null,
      // (sku intentionally not written from CSV — column kept in schema for
      //  legacy data but no longer mappable via the import dropdown.)
      itemCode:           get('itemCode') || null,
      name,
      brand:              get('brand') || null,
      description:        get('description') || null,
      size:               get('size') || null,
      sizeUnit:           get('sizeUnit') || null,
      // Legacy pack columns — mirror the new fields for backward compat
      pack:               pack,
      casePacks:          packInCase,
      sellUnitSize:       unitPack,
      // New v2 simplified pack fields — these are what the ProductForm UI reads
      packInCase:         packInCase,
      unitPack:           unitPack,
      departmentId:       deptRes.id,
      vendorId:           vendorRes.id,
      // ProductGroup — single-valued FK on MasterProduct. When the lookup hit
      // an existing group we set the id directly; otherwise importProductRows
      // creates the group from `_createProductGroupName` and back-fills the id.
      productGroupId:     productGroupRes.id,
      // Internal fields stripped before DB write — used by importProductRows for auto-create
      _createDeptName:           deptRes.createName         || null,
      _createVendorName:         vendorRes.createName       || null,
      _createProductGroupName:   productGroupRes.createName || null,
      defaultCostPrice:   cost,
      defaultRetailPrice: retail,
      defaultCasePrice:   caseP,
      // Session 40 Phase 1 — strict FK + legacy mirror
      taxRuleId:          taxRuleId,
      taxClass:           taxClass || null,
      ageRequired:        (age === 18 || age === 21) ? age : null,
      ebtEligible:        parseBool(get('ebtEligible')),
      discountEligible:   parseBool(get('discountEligible'), true),
      taxable:            parseBool(get('taxable'), true),
      trackInventory:     parseBool(get('trackInventory') || 'true', true),
      reorderPoint:       parseIntVal(get('reorderPoint')),
      reorderQty:         parseIntVal(get('reorderQty')),
      active:             parseBool(get('active') || 'true', true),

      // ── Grocery / Scale fields ──
      wicEligible:        parseBool(get('wicEligible')),
      tareWeight:         parseDecimal(get('tareWeight')),
      scaleByCount:       parseBool(get('scaleByCount')),
      scalePluType:       get('scalePluType') || null,
      ingredients:        get('ingredients') || null,
      nutritionFacts:     get('nutritionFacts') || null,
      certCode:           get('certCode') || null,
      sectionId:          parseIntVal(get('sectionId')),
      expirationDate:     get('expirationDate') ? new Date(get('expirationDate')) : null,
      labelFormatId:      parseIntVal(get('labelFormatId')),
      byWeight:           parseBool(get('byWeight')),
      // `foodstamp` schema column mirrors `ebtEligible` — the CSV never maps
      // to foodstamp directly anymore (alias collision removed), so we derive
      // it from the ebtEligible value to keep the mirror column in sync.
      foodstamp:          parseBool(get('ebtEligible')),

      // ── E-commerce extended ──
      hideFromEcom:       parseBool(get('hideFromEcom')),
      ecomExternalId:     get('ecomExternalId') || null,
      ecomPackWeight:     parseDecimal(get('ecomPackWeight')),
      ecomPrice:          parseDecimal(get('ecomPrice')),
      ecomSalePrice:      parseDecimal(get('ecomSalePrice')),
      ecomOnSale:         parseBool(get('ecomOnSale')),
      ecomDescription:    get('ecomDescription') || null,
      // (ecomSummary no longer populated — legacy aliases merge into
      //  ecomDescription via the alias table; column stays in schema for
      //  rollback but is not written from CSV imports anymore.)
      // Physical weight (lbs) — used for shipping. Moved to the E-Commerce
      // group in the dropdown; stored in MasterProduct.weight.
      weight:             parseDecimal(get('weight')),
      // Shipping package dimensions (imperial: inches).
      shipLengthIn:       parseDecimal(get('shipLengthIn')),
      shipWidthIn:        parseDecimal(get('shipWidthIn')),
      shipHeightIn:       parseDecimal(get('shipHeightIn')),

      // ── Product Image ──
      imageUrl:           get('imageUrl') || null,

      // (Legacy single-linked-UPC staging removed — if the CSV still maps a
      //  column with a legacy `linkedupc` / `caseupc` header, the alias
      //  table above now routes it into `additionalUpcs` and the multi-UPC
      //  post-processor handles it.)

      // ── Multi-UPC / multi-pack (Session 3) ─────────────────────────────
      // `_has*` flags distinguish "column absent" (undefined) from "column present
      // but empty" (''), so REPLACE semantics only fire when the column was
      // explicitly supplied in the CSV.
      //
      // additionalUpcs supports MULTI-SOURCE mapping — one canonical field
      // can be fed by many vendor columns (e.g. Sante's Pack 1 UPC … Pack 6
      // UPC). `getMulti` joins all non-empty values with '|' so the existing
      // downstream splitter keeps working unchanged.
      _hasAdditionalUpcs: hasMapping('additionalUpcs'),
      _additionalUpcs:    getMulti('additionalUpcs', '|') || '',
      _hasPackOptions:    hasMapping('packOptions'),
      _packOptions:       get('packOptions') || '',

      // ── Deposits ──
      depositPerUnit:     parseDecimal(get('depositPerUnit')),
      caseDeposit:        parseDecimal(get('caseDeposit')),

      // ── For SALE promotion (processed in importProductRows) ──
      _specialPrice:      parseDecimal(get('specialPrice')),
      _specialCost:       parseDecimal(get('specialCost')),
      _priceMethod:       get('priceMethod') || null,
      _groupPrice:        parseDecimal(get('groupPrice')),
      _groupQty:          parseIntVal(get('groupQty')),
      _saleMultiple:      parseIntVal(get('saleMultiple')),
      _startDate:         get('startDate') || null,
      _endDate:           get('endDate') || null,
      _regMultiple:       parseIntVal(get('regMultiple')),

      // ── For TPR promotion (second promo slot) ──
      _tprRetail:         parseDecimal(get('tprRetail')),
      _tprCost:           parseDecimal(get('tprCost')),
      _tprMultiple:       parseIntVal(get('tprMultiple')),
      _tprStartDate:      get('tprStartDate') || null,
      _tprEndDate:        get('tprEndDate') || null,

      // ── Future pricing (scheduled price change) ──
      _futureRetail:      parseDecimal(get('futureRetail')),
      _futureCost:        parseDecimal(get('futureCost')),
      _futureActiveDate:  get('futureActiveDate') || null,
      _futureMultiple:    parseIntVal(get('futureMultiple')),

      // ── Stock quantity (processed in importProductRows for StoreProduct) ──
      _quantityOnHand:    parseDecimal(get('quantityOnHand')),
      _sectionName:       get('sectionName') || null,
    },
  };
}

function validateDepartmentRow(
  raw: RawImportRow,
  mapping: ImportMapping,
): RowValidationResult {
  const errors: FieldError[] = [];
  const warnings: FieldError[] = [];
  const get = (field: string): string => (mapping[field] ? String(raw[mapping[field]] || '').trim() : '');

  const name = get('name');
  if (!name) errors.push({ field: 'name', message: 'Department name is required' });

  const taxClass = get('taxClass');
  if (taxClass && !VALID_TAX_CLASSES.includes(taxClass.toLowerCase())) {
    warnings.push({ field: 'taxClass', message: `Unknown tax class "${taxClass}" — valid: ${VALID_TAX_CLASSES.join(', ')}` });
  }

  const ageRaw = get('ageRequired');
  const age    = parseIntVal(ageRaw);
  if (ageRaw && age !== null && age !== 18 && age !== 21) {
    warnings.push({ field: 'ageRequired', message: `Age must be 18 or 21 (got "${ageRaw}") — ignored` });
  }

  const existingId = parseIntVal(get('id'));

  if (errors.length > 0) return { valid: false, errors, warnings, cleaned: null };

  return {
    valid: true,
    errors: [],
    warnings,
    cleaned: {
      _existingId:  existingId,
      name,
      code:         get('code') || null,
      description:  get('description') || null,
      taxClass:     (taxClass && VALID_TAX_CLASSES.includes(taxClass.toLowerCase())) ? taxClass.toLowerCase() : null,
      ageRequired:  (age === 18 || age === 21) ? age : null,
      ebtEligible:  parseBool(get('ebtEligible')),
      bottleDeposit:parseBool(get('bottleDeposit')),
      sortOrder:    parseIntVal(get('sortOrder')) ?? 0,
      color:        get('color') || null,
      showInPOS:    parseBool(get('showInPOS') || 'true', true),
      active:       parseBool(get('active') || 'true', true),
    },
  };
}

function validateVendorRow(
  raw: RawImportRow,
  mapping: ImportMapping,
): RowValidationResult {
  const errors: FieldError[] = [];
  const warnings: FieldError[] = [];
  const get = (field: string): string => (mapping[field] ? String(raw[mapping[field]] || '').trim() : '');

  const name = get('name');
  if (!name) errors.push({ field: 'name', message: 'Vendor name is required' });

  const email = get('email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    warnings.push({ field: 'email', message: `Invalid email "${email}" — will be imported as-is` });
  }

  const existingId = parseIntVal(get('id'));

  if (errors.length > 0) return { valid: false, errors, warnings, cleaned: null };

  return {
    valid: true,
    errors: [],
    warnings,
    cleaned: {
      _existingId: existingId,
      name,
      code:        get('code') || null,
      contactName: get('contactName') || null,
      email:       email || null,
      phone:       get('phone') || null,
      website:     get('website') || null,
      terms:       get('terms') || null,
      accountNo:   get('accountNo') || null,
      active:      parseBool(get('active') || 'true', true),
    },
  };
}

function validatePromotionRow(
  raw: RawImportRow,
  mapping: ImportMapping,
  ctx: ImportContext,
): RowValidationResult {
  const errors: FieldError[] = [];
  const warnings: FieldError[] = [];
  const get = (field: string): string => (mapping[field] ? String(raw[mapping[field]] || '').trim() : '');

  const name      = get('name');
  const promoType = get('promoType').toLowerCase();

  if (!name)                                        errors.push({ field: 'name',      message: 'Promotion name is required' });
  if (!promoType)                                   errors.push({ field: 'promoType', message: 'Promo type is required' });
  else if (!VALID_PROMO_TYPES.includes(promoType))  errors.push({ field: 'promoType', message: `Invalid type "${promoType}". Valid: ${VALID_PROMO_TYPES.join(', ')}` });

  const discountValue = parseDecimal(get('discountValue'));

  if (promoType === 'sale' && discountValue === null) {
    errors.push({ field: 'discountValue', message: 'discountValue is required for sale type' });
  }
  if (promoType === 'bogo') {
    if (!parseIntVal(get('buyQty'))) errors.push({ field: 'buyQty', message: 'buyQty is required for bogo type' });
    if (!parseIntVal(get('getQty'))) errors.push({ field: 'getQty', message: 'getQty is required for bogo type' });
  }

  // Resolve product UPCs → IDs (pipe-separated)
  const productUpcs = get('productIds') ? get('productIds').split('|').map(s => s.trim()).filter(Boolean) : [];
  const deptIds     = get('departmentId') ? get('departmentId').split('|').map(s => s.trim()).filter(Boolean) : [];

  const resolvedDeptIds = deptIds.map(v => resolveDept(v, ctx)).filter(r => r.id).map(r => r.id);

  const discountType = get('discountType') || 'percent';
  if (!VALID_DISCOUNT_TYPES.includes(discountType)) {
    warnings.push({ field: 'discountType', message: `Unknown discountType "${discountType}" — defaulting to "percent"` });
  }

  if (errors.length > 0) return { valid: false, errors, warnings, cleaned: null };

  // Build dealConfig from promoType
  let dealConfig = {};
  switch (promoType) {
    case 'sale':
      dealConfig = { discountType: discountType || 'percent', discountValue };
      break;
    case 'bogo':
      dealConfig = {
        buyQty:      parseIntVal(get('buyQty')),
        getQty:      parseIntVal(get('getQty')),
        getDiscount: discountValue ?? 100,
      };
      break;
    case 'volume':
      dealConfig = { tiers: [] }; // Tiers require manual config; import sets up the shell
      break;
    case 'mix_match':
      dealConfig = { minQty: parseIntVal(get('minQty')) || 2, comboPrice: discountValue };
      break;
    case 'combo':
      dealConfig = { comboPrice: discountValue };
      break;
  }

  return {
    valid: true,
    errors: [],
    warnings,
    cleaned: {
      name,
      promoType,
      description:  get('description') || null,
      dealConfig,
      departmentIds: resolvedDeptIds,
      badgeLabel:   get('badgeLabel') || null,
      badgeColor:   get('color') || '#f59e0b',
      startDate:    parseDate(get('startDate')),
      endDate:      parseDate(get('endDate')),
      active:       parseBool(get('active') || 'true', true),
      _productUpcs: productUpcs, // resolved to IDs at import time
    },
  };
}

function validateDepositRow(
  raw: RawImportRow,
  mapping: ImportMapping,
): RowValidationResult {
  const errors: FieldError[] = [];
  const get = (field: string): string => (mapping[field] ? String(raw[mapping[field]] || '').trim() : '');

  const name          = get('name');
  const depositAmount = parseDecimal(get('depositAmount'));

  if (!name)             errors.push({ field: 'name',          message: 'Deposit name is required' });
  if (depositAmount === null) errors.push({ field: 'depositAmount', message: 'Deposit amount is required and must be numeric' });

  if (errors.length > 0) return { valid: false, errors, warnings: [], cleaned: null };

  return {
    valid: true,
    errors: [],
    warnings: [],
    cleaned: {
      name,
      depositAmount,
      minVolumeOz:    parseDecimal(get('minVolumeOz')),
      maxVolumeOz:    parseDecimal(get('maxVolumeOz')),
      containerTypes: get('containerTypes') || 'bottle,can',
      state:          get('state') || null,
    },
  };
}

function validateInvoiceCostRow(
  raw: RawImportRow,
  mapping: ImportMapping,
  ctx: ImportContext,
): RowValidationResult {
  const errors: FieldError[] = [];
  const warnings: FieldError[] = [];
  const get = (field: string): string => (mapping[field] ? String(raw[mapping[field]] || '').trim() : '');

  const upc     = get('upc');
  const costRaw = get('defaultCostPrice');
  const cost    = parseDecimal(costRaw);

  if (!upc)        errors.push({ field: 'upc',  message: 'UPC is required' });
  if (cost === null) errors.push({ field: 'cost', message: `Invalid cost "${costRaw}" — must be a number` });

  const vendorRes = resolveVendor(get('vendorId'), ctx);
  if (vendorRes.warn) warnings.push({ field: 'vendorId', message: vendorRes.warn });

  if (errors.length > 0) return { valid: false, errors, warnings, cleaned: null };

  return {
    valid: true,
    errors: [],
    warnings,
    cleaned: {
      upc,
      cost,
      casePrice:   parseDecimal(get('defaultCasePrice')),
      receivedQty: parseIntVal(get('receivedQty')),
      vendorId:    vendorRes.id,
    },
  };
}

// ─── Main validateRows ────────────────────────────────────────────────────────
/**
 * Validate all rows for a given type.
 * Returns: { valid: object[], invalid: object[], warnings: object[] }
 *
 * Each item in valid/invalid has:
 *   { rowNum, raw, cleaned, errors, warnings }
 */
export interface ValidatedEntry {
  rowNum: number | string;
  raw: RawImportRow;
  cleaned: Record<string, unknown> | null;
  errors: FieldError[];
  warnings: FieldError[];
}

export async function validateRows(
  rows: RawImportRow[],
  type: ImportType,
  mapping: ImportMapping,
  ctx: ImportContext,
  opts: ValidateRowsOpts = {},
): Promise<{ valid: ValidatedEntry[]; invalid: ValidatedEntry[]; warnings: ValidatedEntry[] }> {
  const valid: ValidatedEntry[]    = [];
  const invalid: ValidatedEntry[]  = [];
  const warnings: ValidatedEntry[] = [];

  for (const raw of rows) {
    const rowNum = (raw.__rowNum as number | string | undefined) ?? '?';
    let result: RowValidationResult;

    switch (type) {
      case 'products':      result = validateProductRow(raw, mapping, ctx, opts as ValidateProductOpts); break;
      case 'departments':   result = validateDepartmentRow(raw, mapping);        break;
      case 'vendors':       result = validateVendorRow(raw, mapping);            break;
      case 'promotions':    result = validatePromotionRow(raw, mapping, ctx);   break;
      case 'deposits':      result = validateDepositRow(raw, mapping);           break;
      case 'invoice_costs': result = validateInvoiceCostRow(raw, mapping, ctx); break;
      default:
        invalid.push({ rowNum, raw, cleaned: null, errors: [{ field: 'type', message: `Unknown type: ${String(type)}` }], warnings: [] });
        continue;
    }

    if (!result.valid) {
      invalid.push({ rowNum, raw, cleaned: null, errors: result.errors, warnings: result.warnings });
    } else {
      const entry: ValidatedEntry = { rowNum, raw, cleaned: result.cleaned, errors: [], warnings: result.warnings };
      valid.push(entry);
      if (result.warnings.length > 0) warnings.push(entry);
    }
  }

  return { valid, invalid, warnings };
}

// ─── Import Rows ──────────────────────────────────────────────────────────────

interface ImportProductOpts extends ValidateProductOpts {
  unknownUpcStrategy?: 'skip' | 'reject';
}

async function importProductRows(
  validRows: ValidatedEntry[],
  orgId: string,
  storeId: string | null | undefined,
  duplicateStrategy: 'skip' | 'update' | 'error',
  opts: ImportProductOpts = {},
): Promise<ImportResult> {
  let created = 0, updated = 0, skipped = 0;
  const errors: ImportResult['errors'] = [];

  // ── Step 0: Auto-create missing departments ─────────────────────────────────
  const pendingDeptNames: string[] = [...new Set(
    validRows.map((r) => r.cleaned?._createDeptName as string | undefined).filter((v): v is string => Boolean(v))
  )];
  const newDeptIdByName = new Map<string, number>();
  if (pendingDeptNames.length > 0) {
    for (const name of pendingDeptNames) {
      try {
        // Department has no unique(orgId,name) constraint — check then create
        const existing = await prisma.department.findFirst({ where: { orgId, name } });
        if (existing) {
          newDeptIdByName.set(name.toLowerCase(), existing.id);
        } else {
          const dept = await prisma.department.create({ data: { orgId, name, active: true, showInPOS: true } });
          newDeptIdByName.set(name.toLowerCase(), dept.id);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ message: `Could not auto-create department "${name}": ${message}` });
      }
    }
  }

  // ── Step 0b: Auto-create missing vendors ────────────────────────────────────
  const pendingVendorNames: string[] = [...new Set(
    validRows.map((r) => r.cleaned?._createVendorName as string | undefined).filter((v): v is string => Boolean(v))
  )];
  const newVendorIdByName = new Map<string, number>();
  if (pendingVendorNames.length > 0) {
    for (const name of pendingVendorNames) {
      try {
        const vendor = await prisma.vendor.upsert({
          where:  { orgId_name: { orgId, name } },
          create: { orgId, name, active: true },
          update: {},
        });
        newVendorIdByName.set(name.toLowerCase(), vendor.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ message: `Could not auto-create vendor "${name}": ${message}` });
      }
    }
  }

  // ── Step 0c: Auto-create missing product groups ─────────────────────────────
  // Same pattern as departments/vendors. ProductGroup has no compound-unique
  // constraint on (orgId, name), so we findFirst-then-create. Errors are
  // collected per-row but never fail the whole import.
  const pendingProductGroupNames: string[] = [...new Set(
    validRows
      .map((r) => (r.cleaned as Record<string, unknown> | null)?._createProductGroupName as string | undefined)
      .filter((v): v is string => Boolean(v))
  )];
  const newProductGroupIdByName = new Map<string, number>();
  if (pendingProductGroupNames.length > 0) {
    for (const name of pendingProductGroupNames) {
      try {
        const existing = await prisma.productGroup.findFirst({ where: { orgId, name } });
        if (existing) {
          newProductGroupIdByName.set(name.toLowerCase(), existing.id);
        } else {
          const grp = await prisma.productGroup.create({ data: { orgId, name } });
          newProductGroupIdByName.set(name.toLowerCase(), grp.id);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ message: `Could not auto-create product group "${name}": ${message}` });
      }
    }
  }

  // Loose type for cleaned row — index access via [key] works generically;
  // named `_internal` fields used during the import-only pipeline are read
  // through this same shape.
  type CleanedRow = Record<string, unknown> & {
    upc?: string; departmentId?: number | null; vendorId?: number | null;
    productGroupId?: number | null;
    _existingId?: unknown; _createDeptName?: string; _createVendorName?: string;
    _createProductGroupName?: string;
    _specialPrice?: unknown; _specialCost?: unknown; _priceMethod?: unknown;
    _groupPrice?: unknown; _groupQty?: unknown; _saleMultiple?: unknown;
    _startDate?: unknown; _endDate?: unknown; _regMultiple?: unknown;
    _tprRetail?: unknown; _tprCost?: unknown; _tprMultiple?: unknown;
    _tprStartDate?: unknown; _tprEndDate?: unknown;
    _futureRetail?: unknown; _futureCost?: unknown; _futureActiveDate?: unknown; _futureMultiple?: unknown;
    _quantityOnHand?: unknown; _sectionName?: unknown;
    _hasAdditionalUpcs?: unknown; _additionalUpcs?: unknown;
    _hasPackOptions?: unknown; _packOptions?: unknown;
  };

  const upcs: string[] = validRows
    .map((r) => (r.cleaned as CleanedRow | null)?.upc)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);

  // Pre-fetch existing by UPC to determine creates vs updates
  const existing = await prisma.masterProduct.findMany({
    where: { orgId, upc: { in: upcs } },
    select: { id: true, upc: true },
  });
  type ExistingRow = (typeof existing)[number];
  const existingByUpc = new Map<string, ExistingRow>(
    existing
      .filter((p: ExistingRow): p is ExistingRow & { upc: string } => Boolean(p.upc))
      .map((p: ExistingRow & { upc: string }): [string, ExistingRow] => [p.upc, p]),
  );

  interface UpdateRecord { id: number; data: Record<string, unknown> }
  const toCreate: Record<string, unknown>[] = [];
  const toUpdate: UpdateRecord[] = [];

  for (const entry of validRows) {
    if (!entry.cleaned) continue;
    const cleaned = entry.cleaned as CleanedRow;
    // Strip internal tracking fields before DB write
    // (_linkedUpc removed — legacy alias values now route into _additionalUpcs.)
    const {
      _existingId, _createDeptName, _createVendorName, _createProductGroupName,
      _specialPrice, _specialCost, _priceMethod, _groupPrice, _groupQty,
      _saleMultiple, _startDate, _endDate, _regMultiple,
      _tprRetail, _tprCost, _tprMultiple, _tprStartDate, _tprEndDate,
      _futureRetail, _futureCost, _futureActiveDate, _futureMultiple,
      _quantityOnHand, _sectionName,
      _hasAdditionalUpcs, _additionalUpcs, _hasPackOptions, _packOptions,
      ...data
    } = cleaned;
    void _existingId;
    void _specialPrice; void _specialCost; void _priceMethod; void _groupPrice; void _groupQty;
    void _saleMultiple; void _startDate; void _endDate; void _regMultiple;
    void _tprRetail; void _tprCost; void _tprMultiple; void _tprStartDate; void _tprEndDate;
    void _futureRetail; void _futureCost; void _futureActiveDate; void _futureMultiple;
    void _quantityOnHand; void _sectionName;
    void _hasAdditionalUpcs; void _additionalUpcs; void _hasPackOptions; void _packOptions;

    // Re-resolve auto-created dept/vendor/group IDs
    if (_createDeptName && !data.departmentId) {
      data.departmentId = newDeptIdByName.get(String(_createDeptName).toLowerCase()) || null;
    }
    if (_createVendorName && !data.vendorId) {
      data.vendorId = newVendorIdByName.get(String(_createVendorName).toLowerCase()) || null;
    }
    if (_createProductGroupName && !data.productGroupId) {
      data.productGroupId = newProductGroupIdByName.get(String(_createProductGroupName).toLowerCase()) || null;
    }

    const upc = (data.upc as string | undefined) || '';
    const exists = upc ? existingByUpc.get(upc) : null;

    if (exists) {
      if (duplicateStrategy === 'skip') {
        skipped++;
      } else if (duplicateStrategy === 'error') {
        errors.push({ message: `Duplicate UPC ${upc} — already exists` });
      } else {
        toUpdate.push({ id: exists.id, data: { ...data, orgId } });
      }
    } else {
      // Session 5 — honor the caller-selected strategy for rows whose UPC
      // doesn't match any existing catalog entry. Default ('create') preserves
      // the historical behavior; template-driven imports default to 'fail'
      // server-side so vendor files can't accidentally mint products.
      const unknownStrat = opts?.unknownUpcStrategy || 'create';
      if ((unknownStrat as string) === 'fail') {
        errors.push({ message: `Unknown UPC ${upc || '(blank)'} — no existing product to update` });
      } else if (unknownStrat === 'skip') {
        skipped++;
      } else {
        toCreate.push({ ...data, orgId });
      }
    }
  }

  // Batch create
  if (toCreate.length > 0) {
    try {
      const result = await prisma.masterProduct.createMany({ data: toCreate as Prisma.MasterProductCreateManyInput[] });
      created += result.count;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ message: `Batch create failed: ${message}` });
    }
  }

  // Batch update in chunks
  for (const chunk of chunkArray(toUpdate, 100)) {
    try {
      await prisma.$transaction(
        chunk.map(({ id, data }: UpdateRecord) => prisma.masterProduct.update({ where: { id }, data: data as Prisma.MasterProductUpdateInput })),
      );
      updated += chunk.length;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ message: `Batch update failed: ${message}` });
    }
  }

  // If storeId provided, also upsert StoreProduct + set stock quantities
  if (storeId && (created > 0 || updated > 0)) {
    const allProducts = await prisma.masterProduct.findMany({
      where: { orgId, upc: { in: upcs } },
      select: { id: true, upc: true },
    });
    type AllProductRow = (typeof allProducts)[number];
    const productByUpc = new Map<string, AllProductRow>(
      allProducts
        .filter((p: AllProductRow): p is AllProductRow & { upc: string } => Boolean(p.upc))
        .map((p: AllProductRow & { upc: string }): [string, AllProductRow] => [p.upc, p]),
    );

    for (const chunk of chunkArray(allProducts, 100)) {
      try {
        await prisma.$transaction(
          chunk.map(({ id }: AllProductRow) => prisma.storeProduct.upsert({
            where: { storeId_masterProductId: { storeId, masterProductId: id } },
            create: { storeId, orgId, masterProductId: id },
            update: {},
          }))
        );
      } catch (_) { /* best-effort */ }
    }

    // Set stock quantities from CSV
    for (const { cleaned: cleanedRaw } of validRows) {
      const cleaned = cleanedRaw as CleanedRow | null;
      if (!cleaned) continue;
      if (cleaned._quantityOnHand != null && cleaned.upc) {
        const prod = productByUpc.get(cleaned.upc);
        if (prod) {
          try {
            await prisma.storeProduct.updateMany({
              where: { storeId, masterProductId: prod.id },
              data: { quantityOnHand: cleaned._quantityOnHand as number, lastStockUpdate: new Date() },
            });
          } catch { /* best-effort */ }
        }
      }
    }
  }

  // ── Post-import: Create linked UPC entries ──────────────────────────────────
  const allProductsFinal = await prisma.masterProduct.findMany({
    where: { orgId, upc: { in: upcs } },
    select: { id: true, upc: true },
  });
  type FinalProductRow = (typeof allProductsFinal)[number];
  const productByUpcFinal = new Map<string, FinalProductRow>(
    allProductsFinal
      .filter((p: FinalProductRow): p is FinalProductRow & { upc: string } => Boolean(p.upc))
      .map((p: FinalProductRow & { upc: string }): [string, FinalProductRow] => [p.upc, p]),
  );

  // ── Session 1 dedup: sync primary UPC → ProductUpc (isDefault=true) ─────────
  // The Product Form's unified Barcodes list reads from ProductUpc exclusively,
  // so every product's primary barcode must have a matching default row. This
  // also mirrors the behaviour of catalogController.createMasterProduct /
  // updateMasterProduct via their syncPrimaryUpc helper.
  type ProductWithUpc = FinalProductRow & { upc: string };
  const primarySyncTargets: ProductWithUpc[] = allProductsFinal.filter(
    (p: FinalProductRow): p is ProductWithUpc => Boolean(p.upc),
  );
  for (const chunk of chunkArray(primarySyncTargets, 100)) {
    try {
      await prisma.$transaction(
        chunk.map((p: ProductWithUpc) => prisma.productUpc.upsert({
          where:  { orgId_upc: { orgId, upc: p.upc } },
          create: { orgId, masterProductId: p.id, upc: p.upc, isDefault: true, label: 'Primary' },
          update: { masterProductId: p.id, isDefault: true },
        }))
      );
    } catch { /* best-effort — conflicts surface at product-create time */ }
  }

  let promosCreated = 0, altUpcsCreated = 0, packSizesCreated = 0, productVendorsUpserted = 0;

  // Late-bind the ProductVendor upsert helper so importService remains agnostic
  // of catalog internals when used from contexts where the helper isn't loaded.
  type UpsertProductVendor = (
    orgId: string, productId: number, vendorId: number, opts: Record<string, unknown>,
  ) => Promise<unknown>;
  let upsertProductVendor: UpsertProductVendor | null = null;
  try {
    ({ upsertProductVendor } = (await import('../../controllers/catalogController.js')) as unknown as {
      upsertProductVendor: UpsertProductVendor;
    });
  } catch { /* fall through — per-vendor sync is best-effort */ }

  for (const { cleaned: cleanedRaw } of validRows) {
    const cleaned = cleanedRaw as CleanedRow | null;
    if (!cleaned) continue;
    const product = cleaned.upc ? productByUpcFinal.get(cleaned.upc) : null;
    if (!product) continue;

    // (Linked UPC post-process removed — legacy `linkedupc`/`caseupc` CSV
    //  headers now route into `_additionalUpcs` via the alias table, and the
    //  multi-UPC post-processor below handles all alternate barcodes in one
    //  unified path.)

    // ── Session 40: per-vendor item code + cost → ProductVendor ────────────
    // When the CSV row carries both a vendorId (resolved during preview)
    // AND an itemCode, record it as an authoritative ProductVendor mapping.
    // First vendor for a product auto-flagged primary (handled inside
    // upsertProductVendor) — matches the "first invoice wins" rule used by
    // confirmInvoice. Import is best-effort; main row write already succeeded.
    if (upsertProductVendor && cleaned.vendorId && cleaned.itemCode) {
      try {
        await upsertProductVendor(orgId, product.id, parseInt(String(cleaned.vendorId)), {
          vendorItemCode: cleaned.itemCode,
          description:    cleaned.description || null,
          priceCost:      cleaned.defaultCostPrice != null ? cleaned.defaultCostPrice : null,
          caseCost:       cleaned.defaultCasePrice != null ? cleaned.defaultCasePrice : null,
          packInCase:     cleaned.packInCase != null ? cleaned.packInCase : null,
        });
        productVendorsUpserted++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[importProductRows] ProductVendor upsert failed for product', product.id, '-', msg);
      }
    }

    // ── Session 3: additional_upcs (pipe-separated) → ProductUpc alternates
    // REPLACE semantics — the CSV cell defines the full set of alternates for
    // this product. Existing non-default ProductUpc rows are cleared first so
    // a cell of "A|B" leaves exactly {A, B} as alternates. An empty cell with
    // the column present wipes alternates. Column absent → untouched.
    if (cleaned._hasAdditionalUpcs) {
      const raw = String(cleaned._additionalUpcs || '');
      const newUpcs = raw.split('|').map(s => s.replace(/\D/g, '').trim()).filter(Boolean);
      try {
        await prisma.productUpc.deleteMany({
          where: { orgId, masterProductId: product.id, isDefault: false },
        });
        for (const u of newUpcs) {
          if (u === product.upc) continue; // skip primary (lives as default row)
          try {
            await prisma.productUpc.upsert({
              where:  { orgId_upc: { orgId, upc: u } },
              create: { orgId, masterProductId: product.id, upc: u, isDefault: false, label: 'Alternate' },
              update: { masterProductId: product.id, isDefault: false },
            });
            altUpcsCreated++;
          } catch { /* UPC owned by another product — skip silently */ }
        }
      } catch { /* best-effort */ }
    }

    // ── Session 3: pack_options compressed → ProductPackSize rows ──────────
    // Format: "label@unitCount@price[*];label@unitCount@price[*];…"
    // `*` marks the default size. REPLACE semantics same as additional_upcs.
    if (cleaned._hasPackOptions) {
      const raw = String(cleaned._packOptions || '');
      const entries = raw.split(';').map(s => s.trim()).filter(Boolean);
      const parsed = [];
      for (const entry of entries) {
        const isDefault = entry.endsWith('*');
        const core = isDefault ? entry.slice(0, -1) : entry;
        const parts = core.split('@').map(s => s.trim());
        if (parts.length < 3) continue; // malformed → skip this entry
        const [label, unitCountStr, priceStr] = parts;
        const unitCount = parseInt(unitCountStr, 10);
        const retailPrice = parseDecimal(priceStr);
        if (!label || !unitCount || retailPrice === null) continue;
        parsed.push({ label, unitCount, retailPrice, isDefault });
      }
      try {
        await prisma.productPackSize.deleteMany({
          where: { orgId, masterProductId: product.id },
        });
        for (let i = 0; i < parsed.length; i++) {
          const pk = parsed[i];
          await prisma.productPackSize.create({
            data: {
              orgId, masterProductId: product.id,
              label: pk.label, unitCount: pk.unitCount,
              retailPrice: pk.retailPrice, isDefault: pk.isDefault,
              sortOrder: i,
            },
          });
          packSizesCreated++;
        }
      } catch { /* best-effort */ }
    }

    // Helper: parse YYYYMMDD dates from wholesale files
    const parseWholesaleDate = (d: unknown): Date | null => {
      if (!d) return null;
      const s = String(d).trim();
      if (s.length === 8 && /^\d{8}$/.test(s)) return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`);
      return new Date(s);
    };

    // ── SALE Promotion (Promo #1) ──────────────────────────────────────────
    const salePrice = Number(cleaned._specialPrice || 0);
    const saleMult  = Number(cleaned._saleMultiple || 1);
    if (salePrice && salePrice > 0) {
      try {
        const isMult = saleMult > 1;
        await prisma.promotion.create({
          data: {
            orgId,
            name: isMult
              ? `Sale: ${saleMult} for $${salePrice} — ${cleaned.name || cleaned.upc}`
              : `Sale: $${salePrice} — ${cleaned.name || cleaned.upc}`,
            promoType: isMult ? 'volume' : 'sale',
            dealConfig: isMult
              ? { minQty: saleMult, fixedPrice: salePrice, vendorCost: cleaned._specialCost || null }
              : { salePrice, vendorCost: cleaned._specialCost || null },
            productIds: [String(product.id)],
            startDate: parseWholesaleDate(cleaned._startDate) || new Date(),
            endDate: parseWholesaleDate(cleaned._endDate) || null,
            active: true,
          },
        });
        promosCreated++;
      } catch { /* best-effort */ }
    }

    // ── Group pricing (REG_MULTIPLE > 1) ───────────────────────────────────
    const regMult = Number(cleaned._regMultiple || 0);
    if (!salePrice && regMult > 1 && cleaned.defaultRetailPrice) {
      try {
        await prisma.promotion.create({
          data: {
            orgId,
            name: `Reg: ${regMult} for $${cleaned.defaultRetailPrice} — ${cleaned.name || cleaned.upc}`,
            promoType: 'volume',
            dealConfig: { minQty: regMult, fixedPrice: cleaned.defaultRetailPrice as number },
            productIds: [String(product.id)],
            active: true,
          },
        });
        promosCreated++;
      } catch { /* best-effort */ }
    }

    // ── TPR Promotion (Promo #2 — Temporary Price Reduction) ───────────────
    const tprRetail = Number(cleaned._tprRetail || 0);
    if (tprRetail > 0) {
      try {
        const tprMult = Number(cleaned._tprMultiple || 1);
        const isMult = tprMult > 1;
        await prisma.promotion.create({
          data: {
            orgId,
            name: isMult
              ? `TPR: ${tprMult} for $${tprRetail} — ${cleaned.name || cleaned.upc}`
              : `TPR: $${tprRetail} — ${cleaned.name || cleaned.upc}`,
            promoType: isMult ? 'volume' : 'sale',
            dealConfig: isMult
              ? { minQty: tprMult, fixedPrice: tprRetail, vendorCost: cleaned._tprCost || null }
              : { salePrice: tprRetail, vendorCost: cleaned._tprCost || null },
            productIds: [String(product.id)],
            startDate: parseWholesaleDate(cleaned._tprStartDate) || new Date(),
            endDate: parseWholesaleDate(cleaned._tprEndDate) || null,
            active: true,
            badgeLabel: 'TPR',
          },
        });
        promosCreated++;
      } catch { /* best-effort */ }
    }

    // ── Future Pricing (scheduled price change, not a promo) ───────────────
    // Creates a scheduled promotion that activates on futureActiveDate
    const futureRetail = Number(cleaned._futureRetail || 0);
    if (futureRetail > 0 && cleaned._futureActiveDate) {
      try {
        const futMult = Number(cleaned._futureMultiple || 1);
        await prisma.promotion.create({
          data: {
            orgId,
            name: `Future: $${futureRetail} — ${cleaned.name || cleaned.upc}`,
            promoType: futMult > 1 ? 'volume' : 'sale',
            dealConfig: futMult > 1
              ? { minQty: futMult, fixedPrice: futureRetail, vendorCost: cleaned._futureCost || null }
              : { salePrice: futureRetail, vendorCost: cleaned._futureCost || null },
            productIds: [String(product.id)],
            startDate: parseWholesaleDate(cleaned._futureActiveDate),
            endDate: null, // permanent until next update
            active: true,
            badgeLabel: 'FUTURE',
          },
        });
        promosCreated++;
      } catch { /* best-effort */ }
    }
  }

  if (altUpcsCreated > 0)         console.log(`🔗 Created ${altUpcsCreated} alternate UPCs from additional_upcs column`);
  if (packSizesCreated > 0)       console.log(`📦 Created ${packSizesCreated} pack-size rows from pack_options column`);
  if (promosCreated > 0)          console.log(`🏷️ Created ${promosCreated} promotion entries from import`);
  if (productVendorsUpserted > 0) console.log(`🏭 Upserted ${productVendorsUpserted} per-vendor item-code mappings`);

  // ── Post-import: populate global image cache ────────────────────────────────
  const imageItems = validRows
    .filter((r): r is ValidatedEntry & { cleaned: CleanedRow } => {
      const c = r.cleaned as CleanedRow | null;
      return Boolean(c && c.upc && c.imageUrl);
    })
    .map((r) => {
      const c = r.cleaned as CleanedRow;
      return {
        upc:      String(c.upc || ''),
        imageUrl: String(c.imageUrl || ''),
        name:     c.name as string | null | undefined,
        brand:    c.brand as string | null | undefined,
      };
    });

  let globalImagesInserted = 0;
  if (imageItems.length > 0) {
    try {
      const imgResult = await batchUpsertGlobalImages(imageItems);
      globalImagesInserted = imgResult.inserted;
      if (globalImagesInserted > 0) console.log(`🖼️ Added ${globalImagesInserted} images to global cache (${imgResult.skipped} already existed)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[importProductRows] global image cache population failed:', message);
    }
  }

  return {
    created, updated, skipped, errors,
    // Extension fields (consumed by the controller for status messages).
    // ImportResult covers the canonical four; these stats are passthrough.
    alternateUPCs: altUpcsCreated,
    packSizes: packSizesCreated,
    promotions: promosCreated,
    productVendorMappings: productVendorsUpserted,
    globalImages: globalImagesInserted,
  } as ImportResult & Record<string, number | unknown[]>;
}

async function importDepartmentRows(
  validRows: ValidatedEntry[],
  orgId: string,
  duplicateStrategy: 'skip' | 'update' | 'error',
): Promise<ImportResult> {
  let created = 0, updated = 0, skipped = 0;
  const errors: ImportResult['errors'] = [];

  for (const chunk of chunkArray(validRows, 100)) {
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        for (const { cleaned: cleanedRaw } of chunk) {
          if (!cleanedRaw) continue;
          const cleaned = cleanedRaw as Record<string, unknown> & { _existingId?: number; name?: string };
          const { _existingId, ...rest } = cleaned;
          const data = rest as Prisma.DepartmentUpdateInput;
          if (_existingId) {
            // Update by ID
            const exists = await tx.department.findUnique({ where: { id: _existingId } });
            if (exists && exists.orgId === orgId) {
              await tx.department.update({ where: { id: _existingId }, data });
              updated++;
            } else {
              errors.push({ message: `Department ID ${_existingId} not found for this org` });
            }
          } else {
            // Upsert by orgId+name (departments don't have a unique name constraint, so we check manually)
            const name = String(data.name || '');
            const existing = await tx.department.findFirst({ where: { orgId, name } });
            if (existing) {
              if (duplicateStrategy === 'skip') { skipped++; }
              else if (duplicateStrategy === 'error') { errors.push({ message: `Department "${name}" already exists` }); }
              else { await tx.department.update({ where: { id: existing.id }, data }); updated++; }
            } else {
              await tx.department.create({ data: { ...rest, orgId } as Prisma.DepartmentUncheckedCreateInput });
              created++;
            }
          }
        }
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ message: `Chunk failed: ${message}` });
    }
  }

  return { created, updated, skipped, errors };
}

async function importVendorRows(
  validRows: ValidatedEntry[],
  orgId: string,
  duplicateStrategy: 'skip' | 'update' | 'error',
): Promise<ImportResult> {
  let created = 0, updated = 0, skipped = 0;
  const errors: ImportResult['errors'] = [];

  for (const chunk of chunkArray(validRows, 100)) {
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        for (const { cleaned: cleanedRaw } of chunk) {
          if (!cleanedRaw) continue;
          const cleaned = cleanedRaw as Record<string, unknown> & { _existingId?: number; name?: string };
          const { _existingId, ...rest } = cleaned;
          const data = rest as Prisma.VendorUpdateInput;
          const name = String(data.name || '');
          if (_existingId) {
            const exists = await tx.vendor.findUnique({ where: { id: _existingId } });
            if (exists && exists.orgId === orgId) {
              await tx.vendor.update({ where: { id: _existingId }, data });
              updated++;
            } else {
              errors.push({ message: `Vendor ID ${_existingId} not found` });
            }
          } else {
            // Vendor has @@unique([orgId, name])
            try {
              await tx.vendor.upsert({
                where: { orgId_name: { orgId, name } },
                create: { ...rest, orgId } as Prisma.VendorUncheckedCreateInput,
                update: duplicateStrategy === 'skip' ? {} : data,
              });
              if (duplicateStrategy === 'skip') skipped++; else { created++; /* rough count */ }
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              errors.push({ message: `Vendor "${name}": ${message}` });
            }
          }
        }
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ message: `Chunk failed: ${message}` });
    }
  }

  return { created, updated, skipped, errors };
}

async function importPromotionRows(
  validRows: ValidatedEntry[],
  orgId: string,
  duplicateStrategy: 'skip' | 'update' | 'error',
): Promise<ImportResult> {
  let created = 0, updated = 0, skipped = 0;
  const errors: ImportResult['errors'] = [];

  // Resolve product UPCs → IDs for all rows at once
  const allUpcs: string[] = [...new Set(validRows.flatMap((r) => {
    const list = (r.cleaned as Record<string, unknown> | null)?._productUpcs as string[] | undefined;
    return list || [];
  }))];
  const products = allUpcs.length > 0
    ? await prisma.masterProduct.findMany({
        where: { orgId, upc: { in: allUpcs } },
        select: { id: true, upc: true },
      })
    : [];
  type ProdRow = { id: number; upc: string | null };
  const productIdByUpc = new Map<string, number>(
    (products as ProdRow[])
      .filter((p): p is ProdRow & { upc: string } => Boolean(p.upc))
      .map((p): [string, number] => [p.upc, p.id]),
  );

  for (const { cleaned: cleanedRaw } of validRows) {
    if (!cleanedRaw) continue;
    const cleaned = cleanedRaw as Record<string, unknown> & { _productUpcs?: string[]; name?: string };
    const { _productUpcs, ...rest } = cleaned;
    const data = rest as Prisma.PromotionUpdateInput;
    const productIds = (_productUpcs || [])
      .map((u: string) => productIdByUpc.get(u))
      .filter((v): v is number => typeof v === 'number');

    try {
      const name = String(data.name || '');
      const existing = await prisma.promotion.findFirst({ where: { orgId, name } });
      if (existing) {
        if (duplicateStrategy === 'skip') { skipped++; continue; }
        if (duplicateStrategy === 'error') { errors.push({ message: `Promotion "${name}" already exists` }); continue; }
        await prisma.promotion.update({ where: { id: existing.id }, data: { ...rest, productIds, orgId } as unknown as Prisma.PromotionUpdateInput });
        updated++;
      } else {
        await prisma.promotion.create({ data: { ...rest, productIds, orgId } as unknown as Prisma.PromotionUncheckedCreateInput });
        created++;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ message: `Promotion "${String(data.name || '')}": ${message}` });
    }
  }

  return { created, updated, skipped, errors };
}

async function importDepositRows(
  validRows: ValidatedEntry[],
  orgId: string,
  duplicateStrategy: 'skip' | 'update' | 'error',
): Promise<ImportResult> {
  let created = 0, updated = 0, skipped = 0;
  const errors: ImportResult['errors'] = [];

  for (const { cleaned: cleanedRaw } of validRows) {
    if (!cleanedRaw) continue;
    const cleaned = cleanedRaw as Record<string, unknown> & { name?: string };
    const name = String(cleaned.name || '');
    try {
      const existing = await prisma.depositRule.findFirst({ where: { orgId, name } });
      if (existing) {
        if (duplicateStrategy === 'skip') { skipped++; continue; }
        await prisma.depositRule.update({ where: { id: existing.id }, data: cleaned as Prisma.DepositRuleUpdateInput });
        updated++;
      } else {
        await prisma.depositRule.create({ data: { ...cleaned, orgId } as Prisma.DepositRuleUncheckedCreateInput });
        created++;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ message: `Deposit "${name}": ${message}` });
    }
  }

  return { created, updated, skipped, errors };
}

async function importInvoiceCostRows(
  validRows: ValidatedEntry[],
  orgId: string,
  storeId: string | null | undefined,
): Promise<ImportResult> {
  let updated = 0, skipped = 0;
  const errors: ImportResult['errors'] = [];

  type InvoiceCleaned = Record<string, unknown> & {
    upc: string;
    cost?: number | null;
    casePrice?: number | null;
    receivedQty?: number | null;
  };
  const upcs: string[] = validRows
    .map((r) => (r.cleaned as InvoiceCleaned | null)?.upc)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  const products = await prisma.masterProduct.findMany({
    where: { orgId, upc: { in: upcs } },
    select: { id: true, upc: true },
  });
  type ProductRow = (typeof products)[number];
  const productByUpc = new Map<string, ProductRow>(
    products
      .filter((p: ProductRow): p is ProductRow & { upc: string } => Boolean(p.upc))
      .map((p: ProductRow & { upc: string }): [string, ProductRow] => [p.upc, p]),
  );

  for (const chunk of chunkArray(validRows, 100)) {
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        for (const { cleaned: cleanedRaw } of chunk) {
          const cleaned = cleanedRaw as InvoiceCleaned | null;
          if (!cleaned) continue;
          const product = cleaned.upc ? productByUpc.get(cleaned.upc) : undefined;
          if (!product) {
            errors.push({ message: `Product with UPC ${cleaned.upc} not found in catalog` });
            skipped++;
            continue;
          }

          // Update master product cost
          await tx.masterProduct.update({
            where: { id: product.id },
            data: {
              defaultCostPrice:  cleaned.cost ?? undefined,
              ...(cleaned.casePrice && { defaultCasePrice: cleaned.casePrice }),
            },
          });

          // Update store product if storeId provided
          if (storeId) {
            await tx.storeProduct.upsert({
              where: { storeId_masterProductId: { storeId, masterProductId: product.id } },
              create: {
                storeId, orgId, masterProductId: product.id,
                costPrice:  cleaned.cost ?? undefined,
                casePrice:  cleaned.casePrice ?? undefined,
                lastReceivedAt: new Date(),
                ...(cleaned.receivedQty && { quantityOnOrder: cleaned.receivedQty }),
              },
              update: {
                costPrice:  cleaned.cost ?? undefined,
                ...(cleaned.casePrice && { casePrice: cleaned.casePrice }),
                lastReceivedAt: new Date(),
                ...(cleaned.receivedQty && { quantityOnOrder: cleaned.receivedQty }),
              },
            });
          }
          updated++;
        }
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ message: `Chunk failed: ${message}` });
    }
  }

  return { created: 0, updated, skipped, errors };
}

// ─── Public: importRows dispatcher ───────────────────────────────────────────
export async function importRows(
  validRows: ValidatedEntry[],
  type: ImportType,
  orgId: string,
  storeId: string | null | undefined,
  opts: ImportRowsOpts = {},
): Promise<ImportResult> {
  const strategy = (opts.duplicateStrategy || 'update') as 'skip' | 'update' | 'error';
  switch (type) {
    case 'products':      return importProductRows(validRows, orgId, storeId, strategy, opts as ImportProductOpts);
    case 'departments':   return importDepartmentRows(validRows, orgId, strategy);
    case 'vendors':       return importVendorRows(validRows, orgId, strategy);
    case 'promotions':    return importPromotionRows(validRows, orgId, strategy);
    case 'deposits':      return importDepositRows(validRows, orgId, strategy);
    case 'invoice_costs': return importInvoiceCostRows(validRows, orgId, storeId);
    default: throw new Error(`Unknown import type: ${String(type)}`);
  }
}

// ─── CSV Template Generator ───────────────────────────────────────────────────
export function generateTemplate(type: ImportType): Buffer {
  // Headers ending in `*` are required. `normalizeHeader` strips the asterisk
  // at import time so the alias match still succeeds. All other fields are
  // optional — the importer leaves them unchanged when blank on update, and
  // uses sensible defaults on create.
  const TEMPLATES = {
    products: {
      headers: [
        // Identity
        'upc*','additional_upcs','sku','item_code','plu',
        // Product
        'name*','brand','size','size_unit','description','image_url',
        // Classification
        'department','vendor','tax_class','product_group',
        // Pack
        'unit_pack','packs_per_case','pack','pack_options',
        // Pricing
        'cost','retail','case_cost',
        // Deposit
        'deposit_per_unit','case_deposit',
        // Compliance
        'ebt_eligible','age_required','taxable','discount_eligible','wic_eligible',
        // Inventory
        'quantity_on_hand','reorder_point','reorder_qty','track_inventory',
        // Inline SALE promo (primary slot)
        'sale_retail','sale_cost','sale_start_date','sale_end_date',
        // Inline TPR (second slot)
        'tpr_retail','tpr_cost','tpr_start_date','tpr_end_date',
        // Scheduled future price
        'future_retail','future_cost','future_active_date',
        // E-commerce
        'hide_from_ecom','ecom_description','ecom_summary','ecom_price','ecom_sale_price','ecom_on_sale',
        // Status
        'active',
      ],
      notes: [
        // Identity
        '* primary UPC/barcode','pipe-separated extra UPCs (e.g. 123|456)','internal SKU','vendor item code','produce PLU',
        // Product
        '* product name','manufacturer or brand name','numeric part of size e.g. "12"','oz|ml|L|lb|g|each|ct|pk','long description','full URL to product image',
        // Classification
        'dept name OR ID (1,2,3…) — auto-creates if unknown','vendor name OR ID — auto-creates if unknown','grocery|alcohol|tobacco|hot_food|none|standard','product group name OR ID',
        // Pack
        'units per sell-unit (e.g. 6 for a 6-pack)','sell-units per vendor case','legacy total units per case — blank if unit_pack/packs_per_case set','multi-pack picker: label@count@price[*]; — * = default',
        // Pricing
        'unit cost $','retail price $','cost per full case $',
        // Deposit
        '$ per unit (e.g. 0.05 CRV)','$ per full case — auto-computed if blank',
        // Compliance
        'true/false','18 or 21','true/false','true/false','true/false',
        // Inventory
        'current on-hand at active store','reorder when stock ≤ this','qty to order','true/false',
        // SALE promo
        'sale price $','sale cost $','YYYY-MM-DD','YYYY-MM-DD',
        // TPR
        'temporary price reduction $','TPR cost $','YYYY-MM-DD','YYYY-MM-DD',
        // Future
        'scheduled new retail $','scheduled new cost $','YYYY-MM-DD effective date',
        // E-commerce
        'true/false','long description for storefront','short tagline for storefront','retail $ for storefront','storefront sale $','true/false',
        // Status
        'true/false',
      ],
      example: [
        '012345678901','012345678918|012345678925','SKU-001','FL-4201','',
        'Example Chips','Frito-Lay','1','oz','Crunchy potato chips','',
        'Grocery','Frito-Lay','grocery','Snacks',
        '1','48','','Single@1@0.99;Box@12@9.99*',
        '0.45','0.99','21.60',
        '','',
        'false','','true','true','false',
        '120','24','48','true',
        '0.79','','2026-04-20','2026-04-26',
        '','','','',
        '','','',
        'false','Delicious crunchy chips','','','','false',
        'true',
      ],
    },

    departments: {
      headers: ['id','name*','code','description','tax_class','ebt_eligible','age_required','sort_order','color','show_in_pos','active'],
      notes:   ['blank = create new; fill = update existing dept','* department name','short code e.g. BEER GROC TOBAC','','grocery|alcohol|tobacco|hot_food|none','true/false','18 or 21 or blank','number — display order','hex color e.g. #3d56b5','true/false','true/false'],
      example: ['','Beer & Wine','BEER','Domestic and imported beer','alcohol','false','21','1','#3d56b5','true','true'],
    },

    vendors: {
      headers: ['id','name*','code','contact_name','email','phone','website','terms','account_no','active'],
      notes:   ['blank = create new; fill = update by ID','* vendor name','short identifier','','','','','Net 30 / Net 14 / COD','your account # with this vendor','true/false'],
      example: ['','Pine State Beverages','PSB','John Smith','jsmith@pinestate.com','207-555-0100','https://pinestate.com','Net 30','ACC-4892','true'],
    },

    promotions: {
      headers: ['name*','promo_type*','discount_type','discount_value','min_qty','buy_qty','get_qty','product_upcs','department_ids','badge_label','badge_color','start_date','end_date','active'],
      notes:   ['* promo name','* sale|bogo|volume|mix_match|combo','percent|amount|fixed','discount %/$/price','for volume/mix_match','for bogo: buy X','for bogo: get Y','pipe-separated UPCs','pipe-separated dept IDs (1|3|5)','badge text on POS tile','hex color','YYYY-MM-DD','YYYY-MM-DD','true/false'],
      example: ['Coke 6pk Deal','sale','percent','10','','','','012345678901|098765432109','1|3','10% OFF','#ef4444','2026-01-01','2026-12-31','true'],
    },

    deposits: {
      headers: ['name*','deposit_amount*','min_volume_oz','max_volume_oz','container_types','state','active'],
      notes:   ['* rule name','* $ amount e.g. 0.05','inclusive min oz — blank = no min','exclusive max oz — blank = no max','comma-separated: bottle,can,carton,jug','state code e.g. ME NH VT','true/false'],
      example: ['Maine CRV Small','0.05','','24','bottle,can','ME','true'],
    },

    invoice_costs: {
      headers: ['upc*','cost*','case_cost','case_qty','received_qty','vendor_id'],
      notes:   ['* matches existing product','* new unit cost','cost per full case','units per case','cases received this delivery','Vendor ID (optional)'],
      example: ['012345678901','1.89','45.36','24','10','1'],
    },
  };

  const tmpl = (TEMPLATES as Record<string, { headers: string[]; notes: string[]; example: string[] }>)[type];
  if (!tmpl) {
    throw new Error(`Unknown import type: ${String(type)}`);
  }

  const aoa = [tmpl.headers, tmpl.notes, tmpl.example];
  const ws  = XLSX.utils.aoa_to_sheet(aoa);
  const wb  = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Import Template');
  return XLSX.write(wb, { type: 'buffer', bookType: 'csv' }) as Buffer;
}
