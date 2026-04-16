/**
 * importService.js
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
import prisma from '../config/postgres.js';

// Marker so you can tell from logs which version of the mapping code is loaded.
// Bump IMPORT_SERVICE_VERSION whenever you change ALIASES or detectColumns.
export const IMPORT_SERVICE_VERSION = '2026-04-16-v3-packInCase-priority';
console.log('[importService] loaded version:', IMPORT_SERVICE_VERSION);

// ─── Column alias maps ───────────────────────────────────────────────────────
// Keys = Prisma field names.  Values = all known column header variants
// (lowercased, stripped of spaces/underscores/hyphens).
const ALIASES = {
  // Product identifiers
  upc:                ['upc','barcode','ean','gtin','upccode','scancode','itemcode_upc'],
  plu:                ['plu','plunumber','producelookup'],
  sku:                ['sku','internalsku','publicid'],
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
  taxClass:           ['taxclass','tax1','taxtype','taxcategory','taxcode','taxrate'],

  // Compliance
  ageRequired:        ['agerequired','minage','age','agerestriction','ageverification','validage'],
  ebtEligible:        ['ebt','ebteligible','foodstamp','food_stamp','snap','ebtsnap'],
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
  bottleDeposit:      ['bottledeposit','deposit','crv','depositrequired'],
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
  startDate:          ['startdate','start','validfrom','effectivedate','promostart'],
  endDate:            ['enddate','end','validto','expirydate','expiredate','promoend'],

  // Deposit-specific
  depositAmount:      ['depositamount','deposit','crvamount','depositvalue','bottledeposit'],
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

  // ── E-commerce extended ──
  ecomExternalId:     ['ecommerceid','ecomid','ecomexternalid','externalid','shopifyid'],
  ecomPackWeight:     ['ecommercepackweight','ecomweight','packweight','shippingweight'],
  ecomPrice:          ['ecommerceprice','ecomprice','onlineprice','webprice'],
  ecomSalePrice:      ['ecommercesaleprice','ecomsaleprice','onlinesaleprice'],
  ecomOnSale:         ['ecommerceonsale','ecomonsale','onlineonsale'],
  ecomSummary:        ['ecommercesummary','ecomsummary','onlinesummary'],
  ecomDescription:    ['ecommercedescription','ecomdescription','onlinedescription','ecommerceunitdescription'],
  hideFromEcom:       ['hidefromecommerce','hidefromecom','hidefromweb','excludeecom'],

  // ── Pricing method / group pricing (for SALE promotion) ──
  priceMethod:        ['pricemethod','pricingmethod','pricetype','prc_grp','prcgrp'],
  groupPrice:         ['groupprice','grouppricingamt','mixmatchprice'],
  groupQty:           ['groupqty','groupquantity','mixmatchqty','quantity'],
  specialPrice:       ['specialprice','special_price','saleprice','promoprice','saleretail','sale_retail'],
  specialCost:        ['specialcost','promotioncost','promocost','salecost','sale_cost'],
  saleMultiple:       ['salemultiple','sale_multiple','salemult'],
  startDate:          ['startdate','start','validfrom','effectivedate','promostart','salestartdate','sale_start_date'],
  endDate:            ['enddate','end','validto','expirydate','expiredate','promoend','saleenddate','sale_end_date'],

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

  // ── Linked UPC ──
  linkedUpc:          ['linkedupc','caseupc','case_upc','relatedupc','altbarcode','altupc','secondaryupc'],

  // ── Legacy / misc ──
  quantityOnHand:     ['quantityonhand','qoh','stockqty','onhand','currentstock','inventoryqty','instock','stockcount','inventory'],
  byWeight:           ['scale','byweight','soldbyweight','scalable','weightitem'],
  foodstamp:          ['foodstamp','food_stamp','snap','ebt','snapeligible'],
  productCode:        ['productcode','mfrcode','manufacturercode'],
};

// ─── Valid enum values ───────────────────────────────────────────────────────
const VALID_TAX_CLASSES   = ['grocery','alcohol','tobacco','hot_food','standard','non_taxable','none'];
const VALID_PROMO_TYPES   = ['sale','bogo','volume','mix_match','combo'];
const VALID_DISCOUNT_TYPES = ['percent','amount','fixed'];

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeHeader(h) {
  return String(h || '').toLowerCase().trim().replace(/[\s_\-\.#\/\\()\[\]]+/g, '');
}

function parseBool(v, def = false) {
  if (v === null || v === undefined || v === '') return def;
  if (typeof v === 'boolean') return v;
  return ['true','yes','1','y','x'].includes(String(v).toLowerCase().trim());
}

function parseDecimal(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isNaN(n) ? null : n;
}

function parseIntVal(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = parseInt(String(v).trim(), 10);
  return isNaN(n) ? null : n;
}

function parseDate(v) {
  if (!v || String(v).trim() === '') return null;
  // Handle Excel serial dates
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d) ? null : d;
  }
  const d = new Date(String(v).trim());
  return isNaN(d.getTime()) ? null : d;
}

// ─── File Parsing ─────────────────────────────────────────────────────────────
/**
 * Parse a CSV or XLSX buffer into { headers: string[], rows: object[] }
 */
export function parseFile(buffer, mimeType = '', originalName = '') {
  const ext = (originalName.split('.').pop() || '').toLowerCase();
  const isExcel = ['xlsx', 'xls'].includes(ext) ||
    mimeType.includes('spreadsheetml') ||
    mimeType.includes('ms-excel');

  let workbook;
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
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  if (!aoa || aoa.length < 2) return { headers: [], rows: [] };

  // Find first non-empty row as headers
  let headerIdx = 0;
  while (headerIdx < aoa.length && !aoa[headerIdx].some(c => String(c).trim())) headerIdx++;

  const rawHeaders = aoa[headerIdx].map(h => String(h || '').trim());
  const dataRows = aoa.slice(headerIdx + 1)
    .filter(row => row.some(cell => String(cell).trim() !== ''))
    .map((row, rowIndex) => {
      const obj = { __rowNum: headerIdx + 2 + rowIndex }; // 1-based row number in file
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
export function detectColumns(headers) {
  const mapping = {};
  const normalizedHeaders = headers.map(h => ({ raw: h, norm: normalizeHeader(h) }));

  // A raw header can only be claimed by ONE schema field so we don't
  // double-map (e.g. "Case Packs" was being claimed by both `pack` and
  // `casePacks`, causing unpredictable collisions).
  const claimedHeaders = new Set();

  // Fields are iterated in the order they appear in the ALIASES object.
  // Within each field, aliases are tried in order so the FIRST alias in
  // the list has priority (e.g. `defaultCasePrice` tries `casecost`
  // before `caseprice` so real cost wins over MSRP case price).
  for (const [field, aliases] of Object.entries(ALIASES)) {
    if (mapping[field]) continue;
    for (const alias of aliases) {
      const match = normalizedHeaders.find(
        h => h.norm === alias && !claimedHeaders.has(h.raw)
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
export async function buildContext(orgId) {
  const [departments, vendors, depositRules, taxRules] = await Promise.all([
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
    }),
  ]);

  // Build a lookup map for tax rules by rounded rate so imports can match
  // a "6.25%" column value directly against the store's real TaxRule table.
  // Key = 4-decimal string ("0.0625") for stable equality across Prisma's Decimal.
  const taxByRate = new Map();
  const taxByClassName = new Map();
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
  }

  return {
    deptById:     new Map(departments.map(d => [d.id, d])),
    deptByName:   new Map(departments.map(d => [d.name.toLowerCase(), d])),
    deptByCode:   new Map(departments.filter(d => d.code).map(d => [d.code.toLowerCase(), d])),
    vendorById:   new Map(vendors.map(v => [v.id, v])),
    vendorByName: new Map(vendors.map(v => [v.name.toLowerCase(), v])),
    vendorByCode: new Map(vendors.filter(v => v.code).map(v => [v.code.toLowerCase(), v])),
    depositById:  new Map(depositRules.map(r => [r.id, r])),
    depositByName:new Map(depositRules.map(r => [r.name.toLowerCase(), r])),
    taxRules,      // full list for warnings/debugging
    taxByRate,
    taxByClassName,
  };
}

// Resolve a taxClass string from a CSV cell against the store's real TaxRule
// table. Input can be:
//   "6.25%"       → lookup by rate 0.0625 → returns rule.appliesTo
//   "alcohol"     → lookup by class name → returns rule.appliesTo ("alcohol")
//   "Maine Food"  → lookup by rule name → returns rule.appliesTo
//   invalid/missing → returns null so caller can fall back to enum defaults
function resolveTaxClassFromRules(value, ctx) {
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
  const byName = ctx.taxRules?.find(r => r.name?.toLowerCase() === str);
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
function resolveDept(value, ctx, strategy = 'skip') {
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

function resolveVendor(value, ctx, strategy = 'skip') {
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

// ─── Row Validators ───────────────────────────────────────────────────────────

function validateProductRow(raw, mapping, ctx, opts = {}) {
  const errors = [];
  const warnings = [];
  const get = (field) => (mapping[field] ? String(raw[mapping[field]] || '').trim() : '');
  const deptStrategy   = opts.unknownDeptStrategy   || 'skip';
  const vendorStrategy = opts.unknownVendorStrategy || 'skip';

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

  // Tax class — priority order:
  //   1. Try to match against the store's REAL TaxRule table (by rate, class
  //      name, or rule name) — this is what the merchant configured in
  //      Portal → Tax Rules. Matching by rate lets a CSV with "6.25%" find
  //      the right tax rule automatically.
  //   2. Fall back to the hardcoded VALID_TAX_CLASSES enum if no tax rules
  //      exist yet for this org (first-time setup).
  //   3. Last resort: "standard" with a warning.
  let taxClass = get('taxClass');
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
        const TAX_TEXT_MAP = {
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
      sku:                get('sku') || null,
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
      // Internal fields stripped before DB write — used by importProductRows for auto-create
      _createDeptName:    deptRes.createName   || null,
      _createVendorName:  vendorRes.createName || null,
      defaultCostPrice:   cost,
      defaultRetailPrice: retail,
      defaultCasePrice:   caseP,
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
      foodstamp:          parseBool(get('foodstamp')),

      // ── E-commerce extended ──
      hideFromEcom:       parseBool(get('hideFromEcom')),
      ecomExternalId:     get('ecomExternalId') || null,
      ecomPackWeight:     parseDecimal(get('ecomPackWeight')),
      ecomPrice:          parseDecimal(get('ecomPrice')),
      ecomSalePrice:      parseDecimal(get('ecomSalePrice')),
      ecomOnSale:         parseBool(get('ecomOnSale')),
      ecomDescription:    get('ecomDescription') || null,
      ecomSummary:        get('ecomSummary') || null,

      // ── For linked UPC (processed in importProductRows) ──
      _linkedUpc:         get('linkedUpc') || null,

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

function validateDepartmentRow(raw, mapping) {
  const errors = [];
  const warnings = [];
  const get = (field) => (mapping[field] ? String(raw[mapping[field]] || '').trim() : '');

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

function validateVendorRow(raw, mapping) {
  const errors = [];
  const warnings = [];
  const get = (field) => (mapping[field] ? String(raw[mapping[field]] || '').trim() : '');

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

function validatePromotionRow(raw, mapping, ctx) {
  const errors = [];
  const warnings = [];
  const get = (field) => (mapping[field] ? String(raw[mapping[field]] || '').trim() : '');

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

function validateDepositRow(raw, mapping) {
  const errors = [];
  const get = (field) => (mapping[field] ? String(raw[mapping[field]] || '').trim() : '');

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

function validateInvoiceCostRow(raw, mapping, ctx) {
  const errors = [];
  const warnings = [];
  const get = (field) => (mapping[field] ? String(raw[mapping[field]] || '').trim() : '');

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
export async function validateRows(rows, type, mapping, ctx, opts = {}) {
  const valid    = [];
  const invalid  = [];
  const warnings = [];

  for (const raw of rows) {
    const rowNum = raw.__rowNum || '?';
    let result;

    switch (type) {
      case 'products':      result = validateProductRow(raw, mapping, ctx, opts); break;
      case 'departments':   result = validateDepartmentRow(raw, mapping);        break;
      case 'vendors':       result = validateVendorRow(raw, mapping);            break;
      case 'promotions':    result = validatePromotionRow(raw, mapping, ctx);   break;
      case 'deposits':      result = validateDepositRow(raw, mapping);           break;
      case 'invoice_costs': result = validateInvoiceCostRow(raw, mapping, ctx); break;
      default:
        invalid.push({ rowNum, raw, errors: [{ field: 'type', message: `Unknown type: ${type}` }], warnings: [] });
        continue;
    }

    if (!result.valid) {
      invalid.push({ rowNum, raw, cleaned: null, errors: result.errors, warnings: result.warnings });
    } else {
      const entry = { rowNum, raw, cleaned: result.cleaned, errors: [], warnings: result.warnings };
      valid.push(entry);
      if (result.warnings.length > 0) warnings.push(entry);
    }
  }

  return { valid, invalid, warnings };
}

// ─── Import Rows ──────────────────────────────────────────────────────────────

async function importProductRows(validRows, orgId, storeId, duplicateStrategy) {
  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  // ── Step 0: Auto-create missing departments ─────────────────────────────────
  const pendingDeptNames = [...new Set(
    validRows.map(r => r.cleaned._createDeptName).filter(Boolean)
  )];
  const newDeptIdByName = new Map();
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
        errors.push({ message: `Could not auto-create department "${name}": ${e.message}` });
      }
    }
  }

  // ── Step 0b: Auto-create missing vendors ────────────────────────────────────
  const pendingVendorNames = [...new Set(
    validRows.map(r => r.cleaned._createVendorName).filter(Boolean)
  )];
  const newVendorIdByName = new Map();
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
        errors.push({ message: `Could not auto-create vendor "${name}": ${e.message}` });
      }
    }
  }

  const upcs = validRows.map(r => r.cleaned.upc).filter(Boolean);

  // Pre-fetch existing by UPC to determine creates vs updates
  const existing = await prisma.masterProduct.findMany({
    where: { orgId, upc: { in: upcs } },
    select: { id: true, upc: true },
  });
  const existingByUpc = new Map(existing.map(p => [p.upc, p]));

  const toCreate = [];
  const toUpdate = [];

  for (const { cleaned } of validRows) {
    // Strip internal tracking fields before DB write
    const {
      _existingId, _createDeptName, _createVendorName,
      _linkedUpc, _specialPrice, _specialCost, _priceMethod, _groupPrice, _groupQty,
      _saleMultiple, _startDate, _endDate, _regMultiple,
      _tprRetail, _tprCost, _tprMultiple, _tprStartDate, _tprEndDate,
      _futureRetail, _futureCost, _futureActiveDate, _futureMultiple,
      _quantityOnHand, _sectionName,
      ...data
    } = cleaned;

    // Re-resolve auto-created dept/vendor IDs
    if (_createDeptName && !data.departmentId) {
      data.departmentId = newDeptIdByName.get(_createDeptName.toLowerCase()) || null;
    }
    if (_createVendorName && !data.vendorId) {
      data.vendorId = newVendorIdByName.get(_createVendorName.toLowerCase()) || null;
    }

    const exists = data.upc ? existingByUpc.get(data.upc) : null;

    if (exists) {
      if (duplicateStrategy === 'skip') {
        skipped++;
      } else if (duplicateStrategy === 'error') {
        errors.push({ field: 'upc', message: `Duplicate UPC ${data.upc} — already exists` });
      } else {
        toUpdate.push({ id: exists.id, data: { ...data, orgId } });
      }
    } else {
      toCreate.push({ ...data, orgId });
    }
  }

  // Batch create
  if (toCreate.length > 0) {
    try {
      const result = await prisma.masterProduct.createMany({ data: toCreate });
      created += result.count;
    } catch (e) {
      errors.push({ message: `Batch create failed: ${e.message}` });
    }
  }

  // Batch update in chunks
  for (const chunk of chunkArray(toUpdate, 100)) {
    try {
      await prisma.$transaction(
        chunk.map(({ id, data }) => prisma.masterProduct.update({ where: { id }, data }))
      );
      updated += chunk.length;
    } catch (e) {
      errors.push({ message: `Batch update failed: ${e.message}` });
    }
  }

  // If storeId provided, also upsert StoreProduct + set stock quantities
  if (storeId && (created > 0 || updated > 0)) {
    const allProducts = await prisma.masterProduct.findMany({
      where: { orgId, upc: { in: upcs } },
      select: { id: true, upc: true },
    });
    const productByUpc = new Map(allProducts.map(p => [p.upc, p]));

    for (const chunk of chunkArray(allProducts, 100)) {
      try {
        await prisma.$transaction(
          chunk.map(({ id }) => prisma.storeProduct.upsert({
            where: { storeId_masterProductId: { storeId, masterProductId: id } },
            create: { storeId, orgId, masterProductId: id },
            update: {},
          }))
        );
      } catch (_) { /* best-effort */ }
    }

    // Set stock quantities from CSV
    for (const { cleaned } of validRows) {
      if (cleaned._quantityOnHand != null && cleaned.upc) {
        const prod = productByUpc.get(cleaned.upc);
        if (prod) {
          try {
            await prisma.storeProduct.updateMany({
              where: { storeId, masterProductId: prod.id },
              data: { quantityOnHand: cleaned._quantityOnHand, lastStockUpdate: new Date() },
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
  const productByUpcFinal = new Map(allProductsFinal.map(p => [p.upc, p]));

  let linkedCreated = 0, promosCreated = 0;

  for (const { cleaned } of validRows) {
    const product = cleaned.upc ? productByUpcFinal.get(cleaned.upc) : null;
    if (!product) continue;

    // ── Linked UPC → ProductUpc ────────────────────────────────────────────
    if (cleaned._linkedUpc) {
      try {
        await prisma.productUpc.upsert({
          where: { orgId_upc: { orgId, upc: cleaned._linkedUpc } },
          create: { orgId, masterProductId: product.id, upc: cleaned._linkedUpc, label: 'Linked from import' },
          update: { masterProductId: product.id },
        });
        linkedCreated++;
      } catch { /* dupe OK */ }
    }

    // Helper: parse YYYYMMDD dates from wholesale files
    const parseWholesaleDate = (d) => {
      if (!d) return null;
      const s = String(d).trim();
      if (s.length === 8 && /^\d{8}$/.test(s)) return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`);
      return new Date(s);
    };

    // ── SALE Promotion (Promo #1) ──────────────────────────────────────────
    const salePrice = cleaned._specialPrice;
    const saleMult  = cleaned._saleMultiple || 1;
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
    if (!salePrice && cleaned._regMultiple && cleaned._regMultiple > 1 && cleaned.defaultRetailPrice) {
      try {
        await prisma.promotion.create({
          data: {
            orgId,
            name: `Reg: ${cleaned._regMultiple} for $${cleaned.defaultRetailPrice} — ${cleaned.name || cleaned.upc}`,
            promoType: 'volume',
            dealConfig: { minQty: cleaned._regMultiple, fixedPrice: cleaned.defaultRetailPrice },
            productIds: [String(product.id)],
            active: true,
          },
        });
        promosCreated++;
      } catch { /* best-effort */ }
    }

    // ── TPR Promotion (Promo #2 — Temporary Price Reduction) ───────────────
    if (cleaned._tprRetail && cleaned._tprRetail > 0) {
      try {
        const tprMult = cleaned._tprMultiple || 1;
        const isMult = tprMult > 1;
        await prisma.promotion.create({
          data: {
            orgId,
            name: isMult
              ? `TPR: ${tprMult} for $${cleaned._tprRetail} — ${cleaned.name || cleaned.upc}`
              : `TPR: $${cleaned._tprRetail} — ${cleaned.name || cleaned.upc}`,
            promoType: isMult ? 'volume' : 'sale',
            dealConfig: isMult
              ? { minQty: tprMult, fixedPrice: cleaned._tprRetail, vendorCost: cleaned._tprCost || null }
              : { salePrice: cleaned._tprRetail, vendorCost: cleaned._tprCost || null },
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
    if (cleaned._futureRetail && cleaned._futureRetail > 0 && cleaned._futureActiveDate) {
      try {
        const futMult = cleaned._futureMultiple || 1;
        await prisma.promotion.create({
          data: {
            orgId,
            name: `Future: $${cleaned._futureRetail} — ${cleaned.name || cleaned.upc}`,
            promoType: futMult > 1 ? 'volume' : 'sale',
            dealConfig: futMult > 1
              ? { minQty: futMult, fixedPrice: cleaned._futureRetail, vendorCost: cleaned._futureCost || null }
              : { salePrice: cleaned._futureRetail, vendorCost: cleaned._futureCost || null },
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

  if (linkedCreated > 0) console.log(`🔗 Created ${linkedCreated} linked UPC entries`);
  if (promosCreated > 0) console.log(`🏷️ Created ${promosCreated} promotion entries from import`);

  return { created, updated, skipped, errors, linkedUPCs: linkedCreated, promotions: promosCreated };
}

async function importDepartmentRows(validRows, orgId, duplicateStrategy) {
  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  for (const chunk of chunkArray(validRows, 100)) {
    try {
      await prisma.$transaction(async (tx) => {
        for (const { cleaned } of chunk) {
          const { _existingId, ...data } = cleaned;
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
            const existing = await tx.department.findFirst({ where: { orgId, name: data.name } });
            if (existing) {
              if (duplicateStrategy === 'skip') { skipped++; }
              else if (duplicateStrategy === 'error') { errors.push({ message: `Department "${data.name}" already exists` }); }
              else { await tx.department.update({ where: { id: existing.id }, data }); updated++; }
            } else {
              await tx.department.create({ data: { ...data, orgId } });
              created++;
            }
          }
        }
      });
    } catch (e) {
      errors.push({ message: `Chunk failed: ${e.message}` });
    }
  }

  return { created, updated, skipped, errors };
}

async function importVendorRows(validRows, orgId, duplicateStrategy) {
  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  for (const chunk of chunkArray(validRows, 100)) {
    try {
      await prisma.$transaction(async (tx) => {
        for (const { cleaned } of chunk) {
          const { _existingId, ...data } = cleaned;
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
                where: { orgId_name: { orgId, name: data.name } },
                create: { ...data, orgId },
                update: duplicateStrategy === 'skip' ? {} : data,
              });
              if (duplicateStrategy === 'skip') skipped++; else { created++; /* rough count */ }
            } catch (e) {
              errors.push({ message: `Vendor "${data.name}": ${e.message}` });
            }
          }
        }
      });
    } catch (e) {
      errors.push({ message: `Chunk failed: ${e.message}` });
    }
  }

  return { created, updated, skipped, errors };
}

async function importPromotionRows(validRows, orgId, duplicateStrategy) {
  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  // Resolve product UPCs → IDs for all rows at once
  const allUpcs = [...new Set(validRows.flatMap(r => r.cleaned._productUpcs || []))];
  const products = allUpcs.length > 0
    ? await prisma.masterProduct.findMany({
        where: { orgId, upc: { in: allUpcs } },
        select: { id: true, upc: true },
      })
    : [];
  const productIdByUpc = new Map(products.map(p => [p.upc, p.id]));

  for (const { cleaned } of validRows) {
    const { _productUpcs, ...data } = cleaned;
    const productIds = (_productUpcs || []).map(u => productIdByUpc.get(u)).filter(Boolean);

    try {
      const existing = await prisma.promotion.findFirst({ where: { orgId, name: data.name } });
      if (existing) {
        if (duplicateStrategy === 'skip') { skipped++; continue; }
        if (duplicateStrategy === 'error') { errors.push({ message: `Promotion "${data.name}" already exists` }); continue; }
        await prisma.promotion.update({ where: { id: existing.id }, data: { ...data, productIds, orgId } });
        updated++;
      } else {
        await prisma.promotion.create({ data: { ...data, productIds, orgId } });
        created++;
      }
    } catch (e) {
      errors.push({ message: `Promotion "${data.name}": ${e.message}` });
    }
  }

  return { created, updated, skipped, errors };
}

async function importDepositRows(validRows, orgId, duplicateStrategy) {
  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  for (const { cleaned } of validRows) {
    try {
      const existing = await prisma.depositRule.findFirst({ where: { orgId, name: cleaned.name } });
      if (existing) {
        if (duplicateStrategy === 'skip') { skipped++; continue; }
        await prisma.depositRule.update({ where: { id: existing.id }, data: cleaned });
        updated++;
      } else {
        await prisma.depositRule.create({ data: { ...cleaned, orgId } });
        created++;
      }
    } catch (e) {
      errors.push({ message: `Deposit "${cleaned.name}": ${e.message}` });
    }
  }

  return { created, updated, skipped, errors };
}

async function importInvoiceCostRows(validRows, orgId, storeId) {
  let updated = 0, skipped = 0;
  const errors = [];

  const upcs = validRows.map(r => r.cleaned.upc);
  const products = await prisma.masterProduct.findMany({
    where: { orgId, upc: { in: upcs } },
    select: { id: true, upc: true },
  });
  const productByUpc = new Map(products.map(p => [p.upc, p]));

  for (const chunk of chunkArray(validRows, 100)) {
    try {
      await prisma.$transaction(async (tx) => {
        for (const { cleaned } of chunk) {
          const product = productByUpc.get(cleaned.upc);
          if (!product) {
            errors.push({ field: 'upc', message: `Product with UPC ${cleaned.upc} not found in catalog` });
            skipped++;
            continue;
          }

          // Update master product cost
          await tx.masterProduct.update({
            where: { id: product.id },
            data: {
              defaultCostPrice:  cleaned.cost,
              ...(cleaned.casePrice && { defaultCasePrice: cleaned.casePrice }),
            },
          });

          // Update store product if storeId provided
          if (storeId) {
            await tx.storeProduct.upsert({
              where: { storeId_masterProductId: { storeId, masterProductId: product.id } },
              create: {
                storeId, orgId, masterProductId: product.id,
                costPrice:  cleaned.cost,
                casePrice:  cleaned.casePrice,
                lastReceivedAt: new Date(),
                ...(cleaned.receivedQty && { quantityOnOrder: cleaned.receivedQty }),
              },
              update: {
                costPrice:  cleaned.cost,
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
      errors.push({ message: `Chunk failed: ${e.message}` });
    }
  }

  return { created: 0, updated, skipped, errors };
}

// ─── Public: importRows dispatcher ───────────────────────────────────────────
export async function importRows(validRows, type, orgId, storeId, opts = {}) {
  const strategy = opts.duplicateStrategy || 'overwrite';
  switch (type) {
    case 'products':      return importProductRows(validRows, orgId, storeId, strategy);
    case 'departments':   return importDepartmentRows(validRows, orgId, strategy);
    case 'vendors':       return importVendorRows(validRows, orgId, strategy);
    case 'promotions':    return importPromotionRows(validRows, orgId, strategy);
    case 'deposits':      return importDepositRows(validRows, orgId, strategy);
    case 'invoice_costs': return importInvoiceCostRows(validRows, orgId, storeId);
    default: throw new Error(`Unknown import type: ${type}`);
  }
}

// ─── CSV Template Generator ───────────────────────────────────────────────────
export function generateTemplate(type) {
  const TEMPLATES = {
    products: {
      headers: ['upc','name','brand','size','size_unit','pack','dept_id','vendor_id','cost','retail','case_cost','tax_class','ebt_eligible','age_required','discount_eligible','sku','item_code','active'],
      example: ['012345678901','Example Chips','Frito-Lay','1oz','oz','48','1','1','0.45','0.99','21.60','grocery','false','','true','SKU-001','FL-4201','true'],
      notes:   ['required — UPC/barcode','required','','e.g. 12oz 750ml 1lb','oz ml L lb g each','units per case','Dept ID (1,2,3…) or dept name','Vendor ID or vendor name','unit cost','retail price','cost per full case','grocery|alcohol|tobacco|hot_food|none','true/false','18 or 21 only','true/false','internal SKU','vendor item code','true/false'],
    },
    departments: {
      headers: ['id','name','code','description','tax_class','ebt_eligible','age_required','bottle_deposit','sort_order','color','show_in_pos','active'],
      example: ['','Beer & Wine','BEER','Domestic and imported beer','alcohol','false','21','true','1','#3d56b5','true','true'],
      notes:   ['leave blank = create new; fill = update existing dept','required','short code e.g. BEER GROC TOBAC','','grocery|alcohol|tobacco|hot_food|none','true/false','21 or blank','true/false','number — display order','hex color #rrggbb','true/false','true/false'],
    },
    vendors: {
      headers: ['id','name','code','contact_name','email','phone','website','terms','account_no','active'],
      example: ['','Pine State Beverages','PSB','John Smith','jsmith@pinesstate.com','207-555-0100','https://pinestate.com','Net 30','ACC-4892','true'],
      notes:   ['leave blank = create new; fill = update by ID','required','short identifier','','','','','Net 30 / Net 14 / COD','your account # with this vendor','true/false'],
    },
    promotions: {
      headers: ['name','promo_type','discount_type','discount_value','min_qty','buy_qty','get_qty','product_upcs','department_ids','badge_label','badge_color','start_date','end_date','active'],
      example: ['Coke 6pk Deal','sale','percent','10','','','','012345678901|098765432109','1|3','10% OFF','#ef4444','2025-01-01','2025-12-31','true'],
      notes:   ['required','required: sale|bogo|volume|mix_match|combo','percent|amount|fixed','discount %/$/price','for volume/mix_match','for bogo: buy X','for bogo: get Y','pipe-separated UPCs','pipe-separated dept IDs (1|3|5)','badge shown on POS item tile','hex color','YYYY-MM-DD','YYYY-MM-DD','true/false'],
    },
    deposits: {
      headers: ['name','deposit_amount','min_volume_oz','max_volume_oz','container_types','state','active'],
      example: ['Maine CRV Small','0.05','','24','bottle,can','ME','true'],
      notes:   ['required','required — $ amount e.g. 0.05','inclusive min oz — leave blank = no min','exclusive max oz — leave blank = no max','comma-separated: bottle,can,carton,jug','state code e.g. ME NH VT','true/false'],
    },
    invoice_costs: {
      headers: ['upc','cost','case_cost','case_qty','received_qty','vendor_id'],
      example: ['012345678901','1.89','45.36','24','10','1'],
      notes:   ['required — matches existing product','required — new unit cost','cost per full case','units per case','cases received this delivery','Vendor ID (optional)'],
    },
  };

  const tmpl = TEMPLATES[type];
  if (!tmpl) return null;

  const aoa = [tmpl.headers, tmpl.notes, tmpl.example];
  const ws  = XLSX.utils.aoa_to_sheet(aoa);
  const wb  = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Import Template');
  return XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
}
