import OpenAI from 'openai';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { upcVariants as sharedUpcVariants, extractSizeFromDescription } from '../utils/upc.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Domain shapes ──────────────────────────────────────────────────────────

export interface POSProduct {
  posProductId: string;
  name: string;
  upc: string;
  itemCode: string;
  plu: string;
  sku: string;
  retailPrice: number | null;
  costPrice: number | null;
  casePrice: number | null;
  lockManualCaseCost: boolean;
  pack: number;
  departmentId: string;
  vendorId: string;
  /** Optional fields some callers attach for the review UI. */
  deposit?: number | null;
  taxes?: string | null;
  fees?: string | null;
}

/** A vendor invoice line item as it enters the matching cascade. Most fields
 * come from gptService extraction; matching enriches them in-place. */
export interface LineItemForMatch {
  description?: string | null;
  upc?: string | null;
  itemCode?: string | null;
  plu?: string | null;
  caseCost?: number | string | null;
  netCost?: number | string | null;
  discount?: number | string | null;
  depositAmount?: number | string | null;
  packUnits?: number | null | undefined;
  unitsPerPack?: number | null | undefined;
  /** Set during matchLineItems to preserve the original vendor description before overwrite. */
  originalVendorDescription?: string | null;
  originalItemCode?: string | null;
  /** Per-item bookkeeping for the review UI. */
  departmentId?: string | null;
  vendorId?: string | null;
  taxes?: string | null;
  fees?: string | null;
  taxesId?: string | null;
  feesId?: string | null;
  [key: string]: unknown;
}

export type MatchTier =
  | 'upc'
  | 'itemCode'
  | 'vendorMap'
  | 'plu'
  | 'global'
  | 'costProx'
  | 'fuzzy'
  | 'ai';

export type MatchConfidence = 'high' | 'medium' | 'low';

export interface MatchedLineItem extends LineItemForMatch {
  mappingStatus: 'matched' | 'manual' | 'unmatched';
  confidence: MatchConfidence | null;
  matchTier: MatchTier | null;
  linkedProductId?: string;
  description: string;
  suggestedRetailPrice?: number | null;
  packUnits?: number | null;
  unitCost?: number;
  actualCost?: number;
  linkedProduct?: {
    id: string;
    name: string;
    defaultCasePrice: number | null;
    defaultCostPrice: number | null;
    defaultRetailPrice: number | null;
    lockManualCaseCost: boolean;
  };
  costDelta?: CostDelta | null;
}

export interface CostDelta {
  direction: 'new' | 'up' | 'down' | 'same';
  pct: number | null;
  prevUnitCost: number | null;
  newUnitCost: number;
}

export interface MatchStats {
  total: number;
  matched: number;
  unmatched: number;
  matchRate: number;
  byTier: Record<string, number>;
  avgConfidence: number;
  timestamp: string;
}

export interface MatchOptions {
  vendorId?: string | number | null;
}

interface ItemCodeIndex {
  vendorScoped: Map<string, POSProduct>;
  orgWide: Map<string, POSProduct>;
}

interface VendorMapRow {
  id: string;
  vendorName: string;
  vendorItemCode: string | null;
  vendorDescription: string | null;
  posProductId: string;
  posUPC: string | null;
  posName: string | null;
  matchTier: string | null;
  lastSeenAt: Date | null;
  confirmedCount: number;
  orgId: string;
}

// ─── POS PRODUCT CACHE ────────────────────────────────────────────────────────
// Avoids re-fetching the full product list on every invoice upload.
// Keyed by userId, invalidated after TTL.

const POS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
interface PosCacheEntry { products: POSProduct[]; fetchedAt: number }
const posCache = new Map<string, PosCacheEntry>(); // userId → { products, fetchedAt }

export const setPOSCache = (userId: string | number, products: POSProduct[]): void => {
  posCache.set(String(userId), { products, fetchedAt: Date.now() });
};

export const getPOSCache = (userId: string | number): POSProduct[] | null => {
  const entry = posCache.get(String(userId));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > POS_CACHE_TTL_MS) {
    posCache.delete(String(userId));
    return null;
  }
  return entry.products;
};

export const clearPOSCache = (userId: string | number): void => {
  posCache.delete(String(userId));
};

// ─── CATALOG PRODUCT LOADER ───────────────────────────────────────────────────

/**
 * Load catalog master products and normalise them for the matching engine.
 * Called when the POS cache is empty (first upload after restart/TTL expiry).
 *
 * IMPORTANT: we keep `itemCode` (distributor/vendor-assigned item number) separate
 * from our internal `sku` so the matching cascade can use itemCode as the
 * primary identifier and ignore our internal SKU (which vendor invoices never
 * reference).
 *
 * @param {string} orgId
 * @returns {Array} normalised products
 */
export const loadCatalogProductsForMatching = async (orgId: string): Promise<POSProduct[]> => {
  if (!orgId || orgId === 'unknown') return [];
  try {
    type MasterProductRow = Prisma.MasterProductGetPayload<{
      select: {
        id: true; name: true; upc: true;
        sku: true; itemCode: true; plu: true;
        defaultRetailPrice: true; defaultCostPrice: true; defaultCasePrice: true;
        lockManualCaseCost: true;
        casePacks: true; unitsPerPack: true; pack: true;
        departmentId: true; vendorId: true;
      };
    }>;
    const products: MasterProductRow[] = await prisma.masterProduct.findMany({
      where: { orgId, deleted: false },
      select: {
        id: true, name: true, upc: true,
        sku: true, itemCode: true, plu: true,
        defaultRetailPrice: true, defaultCostPrice: true, defaultCasePrice: true,
        lockManualCaseCost: true,
        casePacks: true, unitsPerPack: true, pack: true,
        departmentId: true, vendorId: true,
      },
      take: 10000,
    });
    console.log(`📦 Loaded ${products.length} catalog products for matching (org: ${orgId})`);
    return products.map((p: MasterProductRow): POSProduct => ({
      posProductId: String(p.id),
      name:         p.name,
      upc:          p.upc        || '',
      itemCode:     p.itemCode   || '',   // vendor/distributor code (primary key for Tier 2)
      plu:          p.plu        || '',   // PLU / produce code (Tier 4)
      // `sku` retained for debugging/display only — NOT used in matching
      sku:          p.sku        || '',
      retailPrice:  p.defaultRetailPrice != null ? Number(p.defaultRetailPrice) : null,
      costPrice:    p.defaultCostPrice   != null ? Number(p.defaultCostPrice)   : null,
      // Product's currently-stored case cost — used to seed item.actualCost on match
      // so the review UI shows "what the product cost is today" as the default Actual
      // Cost. User can adjust before confirming; sync then replaces defaultCasePrice.
      casePrice:    p.defaultCasePrice   != null ? Number(p.defaultCasePrice)   : null,
      // When true, the cost-sync decision tree skips this product entirely and
      // the review UI shows an amber 🔒 hint next to the Actual Cost field.
      lockManualCaseCost: !!p.lockManualCaseCost,
      pack:         p.casePacks || p.unitsPerPack || (p.pack ? Number(p.pack) : 0) || 1,
      departmentId: p.departmentId != null ? String(p.departmentId) : '',
      vendorId:     p.vendorId    != null ? String(p.vendorId)      : '',
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('❌ Failed to load catalog products for matching:', message);
    return [];
  }
};

// ─── UPC NORMALIZATION ────────────────────────────────────────────────────────
// Delegates to the shared utility which handles spaces, dashes, UPC-E expansion,
// EAN-8/UPC-A/EAN-13/ITF-14 normalization, and check-digit truncation.

const upcVariants = sharedUpcVariants;

/**
 * Build a map from every UPC variant of every POS product → product.
 * This is built once per invoice batch, not per line item.
 */
const buildUPCIndex = (posProducts: POSProduct[]): Map<string, POSProduct> => {
  const index = new Map<string, POSProduct>();
  for (const p of posProducts) {
    if (!p.upc) continue;
    for (const v of upcVariants(p.upc)) {
      if (!index.has(v)) index.set(v, p);
    }
  }
  return index;
};

/**
 * Look up a product by trying all UPC variants of the invoice UPC.
 */
const matchByUPC = (invoiceUPC: string, upcIndex: Map<string, POSProduct>): POSProduct | null => {
  for (const v of upcVariants(invoiceUPC)) {
    const match = upcIndex.get(v);
    if (match) return match;
  }
  return null;
};

// ─── FUZZY TEXT MATCHING ──────────────────────────────────────────────────────

// Words that carry no product identity — strip these before comparing
const STOPWORDS = new Set([
  'pk', 'pack', 'oz', 'fl', 'ct', 'can', 'cans', 'bottle', 'bottles',
  'btl', 'btls', 'ltr', 'litre', 'liter', 'ml', 'gal', 'gallon',
  'cs', 'case', 'ea', 'each', 'single', 'and', 'the', 'a', 'an',
  'nr', 'bn', 'original', 'classic', 'premium', 'new', 'old',
  'regular', 'reg', 'std', 'standard',
]);

// Common beverage / grocery abbreviations found on vendor invoices
const ABBREV: Record<string, string> = {
  'lt': 'light',   'lte': 'light',  'lite': 'light',
  'bl': 'blue',    'bud': 'budweiser',
  'mgd': 'miller', 'mgl': 'miller', 'mlr': 'miller',
  'nat': 'natural', 'natl': 'natural', 'naty': 'natural',
  'crs': 'coors',  'cr': 'coors',
  'mk': 'mike',    'mikes': 'mike',
  'hrd': 'hard',   'slt': 'seltzer', 'sltz': 'seltzer',
  'wht': 'white',  'blk': 'black',   'wld': 'wild',
  'hny': 'honey',  'strw': 'strawberry', 'lmn': 'lemon',
  'drft': 'draft', 'dft': 'draft',
  'ice': 'ice',    'dry': 'dry',
  'org': 'organic', 'rgn': 'origin',
};

const tokenize = (str: string | null | undefined): string[] =>
  String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => ABBREV[t] || t)
    .filter((t) => !STOPWORDS.has(t));

/**
 * Jaccard similarity: intersection / union of token sets.
 * Returns 0–1 (1 = identical after normalization).
 */
const fuzzyScore = (a: string | null | undefined, b: string | null | undefined): number => {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection++;
  }
  const union = ta.size + tb.size - intersection;
  return intersection / union;
};

interface FuzzyMatchResult { product: POSProduct; score: number }

/**
 * Find the highest-scoring fuzzy match from posProducts.
 * Returns { product, score } or null.
 */
const findBestFuzzyMatch = (
  description: string | null | undefined,
  posProducts: POSProduct[],
): FuzzyMatchResult | null => {
  if (!description) return null;
  let best: POSProduct | null = null;
  let bestScore = 0;

  for (const p of posProducts) {
    const score = fuzzyScore(description, p.name);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best && bestScore > 0 ? { product: best, score: bestScore } : null;
};

// ─── COMPOSITE SCORING (Enhanced Tier 3) ─────────────────────────────────────
// Multi-factor match scoring: name + brand + size + cost + department

/**
 * Match brand from description against product name/brand.
 * Returns 1.0 if brand matches, 0 otherwise.
 */
const brandMatch = (desc: string, productName: string): number => {
  const descTokens = tokenize(desc);
  const prodTokens = tokenize(productName);
  // Check if any significant token (brand word) appears in both
  const brandWords = descTokens.filter((t) => t.length > 3); // brand names are usually >3 chars
  for (const w of brandWords) {
    if (prodTokens.includes(w)) return 1.0;
  }
  return 0;
};

/**
 * Compare sizes extracted from descriptions.
 * Returns 1.0 if sizes match, 0.5 if close, 0 if different.
 */
const sizeMatch = (desc1: string, desc2: string): number => {
  const s1 = extractSizeFromDescription(desc1) as { packSize?: number; size?: number; unit?: string } | null;
  const s2 = extractSizeFromDescription(desc2) as { packSize?: number; size?: number; unit?: string } | null;
  if (!s1 || !s2) return 0;

  let score = 0;
  // Pack size match
  if (s1.packSize && s2.packSize && s1.packSize === s2.packSize) score += 0.5;
  // Volume/weight match
  if (s1.size && s2.size && s1.unit === s2.unit) {
    const ratio = Math.min(s1.size, s2.size) / Math.max(s1.size, s2.size);
    if (ratio > 0.95) score += 0.5;
    else if (ratio > 0.80) score += 0.25;
  }
  return Math.min(1.0, score);
};

/**
 * Cost proximity score.
 * Returns 1.0 if within 5%, 0.5 if within 15%, 0 otherwise.
 */
const costProximity = (
  itemCost: number | null | undefined,
  productCost: number | null | undefined,
): number => {
  if (!itemCost || !productCost || productCost === 0) return 0;
  const ratio = Math.abs(itemCost - productCost) / productCost;
  if (ratio <= 0.05) return 1.0;
  if (ratio <= 0.10) return 0.7;
  if (ratio <= 0.15) return 0.5;
  if (ratio <= 0.25) return 0.3;
  return 0;
};

/**
 * Multi-factor composite score for matching.
 * Weighs: name similarity (40%), brand (15%), size (15%), cost (20%), department (10%)
 */
const compositeScore = (invoiceItem: LineItemForMatch, posProduct: POSProduct): number => {
  const desc = invoiceItem.originalVendorDescription || invoiceItem.description || '';
  const nameScore  = fuzzyScore(desc, posProduct.name);
  const brand      = brandMatch(desc, posProduct.name);
  const size       = sizeMatch(desc, posProduct.name);
  const cost       = costProximity(
    Number(invoiceItem.caseCost || invoiceItem.netCost || 0),
    posProduct.costPrice || posProduct.retailPrice,
  );
  const dept = (invoiceItem.departmentId && posProduct.departmentId &&
    String(invoiceItem.departmentId) === String(posProduct.departmentId)) ? 1.0 : 0;

  return (0.40 * nameScore) + (0.15 * brand) + (0.15 * size) + (0.20 * cost) + (0.10 * dept);
};

/**
 * Find best composite match from posProducts.
 * Returns { product, score } or null.
 */
const findBestCompositeMatch = (
  invoiceItem: LineItemForMatch,
  posProducts: POSProduct[],
): FuzzyMatchResult | null => {
  let best: POSProduct | null = null;
  let bestScore = 0;

  for (const p of posProducts) {
    const score = compositeScore(invoiceItem, p);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best && bestScore > 0.55 ? { product: best, score: bestScore } : null;
};

// ─── COST-PROXIMITY TIER (2.5) ───────────────────────────────────────────────

/**
 * Match by cost + weak name similarity.
 * For items where we know the case cost but UPC/code didn't match.
 */
const matchByCostProximity = (
  invoiceItem: LineItemForMatch,
  posProducts: POSProduct[],
): FuzzyMatchResult | null => {
  // Session 39 Round 5 — prefer NET (post-discount) cost when available.
  // Previously used raw caseCost which often holds Azure's GROSS-price read
  // and made this tier pick the wrong catalog product on invoices with a
  // separate DISC column (beer distributors, grocery distributors, etc.).
  // Fall back chain:
  //   1. explicit netCost
  //   2. caseCost - discount (computed when only gross + disc are known)
  //   3. caseCost (no discount info → assume gross IS the cost)
  const explicitNet = Number(invoiceItem.netCost || 0);
  const gross       = Number(invoiceItem.caseCost || 0);
  const disc        = Number(invoiceItem.discount || 0);
  const itemCost = explicitNet > 0 ? explicitNet
    : (gross > 0 && disc > 0) ? Math.max(0, gross - disc)
    : gross;
  if (!itemCost || itemCost <= 0) return null;

  let best: POSProduct | null = null;
  let bestCombined = 0;

  for (const p of posProducts) {
    const pCost = p.costPrice || (p.retailPrice ? p.retailPrice * 0.65 : 0);
    if (!pCost) continue;

    const costScore = costProximity(itemCost, pCost);
    if (costScore < 0.5) continue; // must be within ~15%

    const nameScore = fuzzyScore(
      invoiceItem.originalVendorDescription || invoiceItem.description || '',
      p.name
    );
    if (nameScore < 0.40) continue; // must have SOME name similarity

    const combined = (0.55 * nameScore) + (0.45 * costScore);
    if (combined > bestCombined) {
      bestCombined = combined;
      best = p;
    }
  }

  return best && bestCombined >= 0.60 ? { product: best, score: bestCombined } : null;
};

// ─── AI BATCH MATCHING (Tier 4) ───────────────────────────────────────────────

/**
 * Uses gpt-4o-mini to match the remaining unmatched items.
 * Cost control:
 *   - Only called for items that survived all local tiers
 *   - Pre-filters to top-8 candidates per item using fuzzy score
 *   - All items batched into a single API call
 *   - Only accepts high/medium confidence AI suggestions
 *
 * @param {Array} unmatchedItems  [{ item, index }]
 * @param {Array} posProducts     normalized POS products
 * @returns {Array}               [{ itemIndex, posProductId, confidence, reason }]
 */
interface UnmatchedForAI { item: MatchedLineItem; index: number }
interface AIBatchMatchEntry {
  itemIndex: number;
  posProductId: string;
  confidence: MatchConfidence;
  reason: string;
}

const aiBatchMatch = async (
  unmatchedItems: UnmatchedForAI[],
  posProducts: POSProduct[],
): Promise<AIBatchMatchEntry[]> => {
  if (unmatchedItems.length === 0) return [];

  // Pre-score: top 8 candidates per item
  const withCandidates = unmatchedItems.map(({ item, index }) => {
    const scored = posProducts
      .map((p) => ({ p, score: fuzzyScore(item.originalVendorDescription || item.description, p.name) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    return { index, item, candidates: scored.map((s) => s.p) };
  });

  const itemLines = withCandidates
    .map(
      ({ index, item }) =>
        `${index}: "${item.originalVendorDescription || item.description}" | UPC:${item.upc || 'none'} | Code:${item.originalItemCode || item.itemCode || 'none'} | CaseCost:$${item.caseCost || 0}`
    )
    .join('\n');

  const candidateLines = withCandidates
    .map(({ index, candidates }) => {
      const lines = candidates
        .map((p) => `  id:"${p.posProductId}" name:"${p.name}" upc:"${p.upc || ''}" cost:$${p.costPrice || 0}`)
        .join('\n');
      return `Item ${index}:\n${lines}`;
    })
    .join('\n\n');

  const prompt = `You are matching vendor invoice line items to store POS products.

INVOICE ITEMS:
${itemLines}

TOP POS CANDIDATES PER ITEM:
${candidateLines}

Rules:
- Match based on product name, brand, size, and pack format
- UPC match overrides everything — if UPCs align, it is always high confidence
- Cost proximity (within 10%) is a positive signal but not required
- Only return matches you are genuinely confident about; omit items you cannot match
- Confidence: "high" = very certain, "medium" = likely but not 100%, "low" = weak guess

Return JSON only:
{"matches": [{"itemIndex": 0, "posProductId": "...", "confidence": "high|medium|low", "reason": "brief reason"}]}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a product matching engine. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
    });

    const parsed = JSON.parse(response.choices[0].message.content || '{}') as { matches?: AIBatchMatchEntry[] };
    return Array.isArray(parsed.matches) ? parsed.matches : [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('⚠ AI batch match failed:', message);
    return [];
  }
};

// ─── INDEX BUILDERS ───────────────────────────────────────────────────────────

/**
 * Parse a cell that may contain multiple vendor item codes separated by
 * common delimiters. Examples:
 *   "112107"                  → ["112107"]
 *   "112107 / 144615 / 144620"→ ["112107", "144615", "144620"]
 *   "A-123/B-456"             → ["a-123", "b-456"]   (dashes inside codes preserved)
 *   "47-123,92-44"            → ["47-123", "92-44"]
 *   ""  / null                → []
 *
 * Session 39 Round 5 — many real-world catalogs concatenate multiple
 * distributor codes in one `itemCode` cell (different case sizes, old +
 * new codes after a vendor restructure, etc.). Parsing this at the matching
 * layer lets Tier 2 hit any of the codes without requiring store cleanup.
 *
 * Deliberate choices:
 *   - Splits on  /  ,  ;  |  newline  and runs-of-2+-whitespace.
 *   - Does NOT split on single space or dash — some codes legitimately
 *     contain those (e.g. "47-123" as a hyphenated code).
 */
const parseItemCodeCell = (rawCell: unknown): string[] => {
  if (rawCell == null) return [];
  const s = String(rawCell).trim();
  if (!s) return [];
  // Split on delimiters but preserve internal dashes/single-spaces
  const tokens = s.split(/\s*[\/,;|]\s*|\n|\s{2,}/g);
  return tokens
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
};

/**
 * Build a vendor-scoped index of distributor itemCode → product.
 * Key format: `${vendorId}::${normalizedItemCode}` — prevents cross-vendor
 * collisions (Hershey's 2468231280 vs Jeremy's 27149 vs Coca-Cola 115583).
 *
 * Also builds an org-wide fallback index `*::${normalizedItemCode}` used as a
 * low-confidence fallback when the invoice has no resolved vendorId.
 *
 * Multi-code cells (e.g. "112107 / 144615 / 144620") are split into
 * separate index entries so any one of them matches an incoming invoice.
 */
const buildItemCodeIndex = (posProducts: POSProduct[]): ItemCodeIndex => {
  const vendorScoped = new Map<string, POSProduct>();
  const orgWide      = new Map<string, POSProduct>();
  for (const p of posProducts) {
    const codes = parseItemCodeCell(p.itemCode);
    if (codes.length === 0) continue;
    for (const code of codes) {
      // Vendor-scoped (only if product has a vendor assigned)
      if (p.vendorId) {
        const key = `${p.vendorId}::${code}`;
        if (!vendorScoped.has(key)) vendorScoped.set(key, p);
      }
      // Org-wide fallback — first match wins
      if (!orgWide.has(code)) orgWide.set(code, p);
    }
  }
  return { vendorScoped, orgWide };
};

/**
 * Session 39 Round 5 — Merge learned VendorProductMap codes into the
 * item-code index. Previously Tier 2 only consulted `MasterProduct.itemCode`,
 * so a match learned on invoice #1 (written as a VendorProductMap row) only
 * hit via the slower Tier 3 on invoice #2. Now every confirmed match on
 * invoice #1 gives invoice #2 a zero-cost Tier 2 hit. Keeps multi-vendor
 * products correct since VendorProductMap is already keyed by vendorId.
 */
const mergeVendorProductMapIntoItemCodeIndex = (
  index: ItemCodeIndex,
  vendorMaps: Array<VendorMapRow & { vendorId?: string | number | null }>,
  idIndex: Map<string, POSProduct>,
): void => {
  for (const vm of vendorMaps) {
    if (!vm.vendorItemCode || !vm.vendorId || !vm.posProductId) continue;
    const posProduct = idIndex.get(String(vm.posProductId));
    if (!posProduct) continue; // product deleted since map was written
    const codes = parseItemCodeCell(vm.vendorItemCode);
    for (const code of codes) {
      const key = `${vm.vendorId}::${code}`;
      if (!index.vendorScoped.has(key)) index.vendorScoped.set(key, posProduct);
    }
  }
};

/**
 * Build a PLU index — PLUs are numeric produce codes (e.g. 4011 = banana)
 * and are globally standardized, so no vendor scoping is needed.
 */
const buildPluIndex = (posProducts: POSProduct[]): Map<string, POSProduct> => {
  const index = new Map<string, POSProduct>();
  for (const p of posProducts) {
    if (!p.plu) continue;
    const key = String(p.plu).trim();
    if (key) index.set(key, p);
  }
  return index;
};

const buildIdIndex = (posProducts: POSProduct[]): Map<string, POSProduct> => {
  const index = new Map<string, POSProduct>();
  for (const p of posProducts) {
    if (p.posProductId) index.set(String(p.posProductId).trim(), p);
  }
  return index;
};

/**
 * Filter the POS product list down to only products tagged to a specific vendor.
 * Used to restrict composite / fuzzy / AI matching when an invoice vendor is known —
 * this drastically reduces false positives and cuts AI tier cost.
 */
const filterByVendor = (posProducts: POSProduct[], vendorId: string | null | undefined): POSProduct[] => {
  if (!vendorId) return posProducts;
  const vId = String(vendorId);
  return posProducts.filter((p) => p.vendorId && String(p.vendorId) === vId);
};

// ─── APPLY MATCH ──────────────────────────────────────────────────────────────

// Session 39 Round 5 — compute a cost-change indicator between the invoice's
// per-unit cost and the catalog's stored per-unit cost. Consumed by the
// review UI to render a green ↓ / red ↑ / grey = / muted — badge per line.
//
// Returns { direction, pct, prevUnitCost, newUnitCost } or null when there
// is no prior cost to compare against (first time this product is priced).
//
// Threshold: ±5% is treated as no material change. Anything outside that
// is flagged so the store owner notices supplier price changes early.
const COST_CHANGE_THRESHOLD = 0.05; // 5%
const buildCostDelta = (
  posProduct: POSProduct,
  newUnitCost: number | null | undefined,
): CostDelta | null => {
  const prev = Number(posProduct.costPrice || 0);
  const next = Number(newUnitCost || 0);
  if (!next) return null;
  if (!prev) return { direction: 'new', pct: null, prevUnitCost: null, newUnitCost: next };
  const pct = (next - prev) / prev;
  let direction: CostDelta['direction'] = 'same';
  if      (pct >  COST_CHANGE_THRESHOLD) direction = 'up';
  else if (pct < -COST_CHANGE_THRESHOLD) direction = 'down';
  return { direction, pct, prevUnitCost: prev, newUnitCost: next };
};

const applyMatch = (
  results: MatchedLineItem[],
  index: number,
  posProduct: POSProduct,
  tier: MatchTier,
  confidence: MatchConfidence,
): void => {
  const item = results[index];
  // Session 39 Round 5 — use NET (post-discount) cost for unitCost math
  // so the store's effective per-unit cost is accurate when the invoice
  // has a discount column. Falls back to gross caseCost when no net is
  // available. Matches the priority order in matchByCostProximity.
  const explicitNet = Number(item.netCost || 0);
  const gross       = Number(item.caseCost || 0);
  const disc        = Number(item.discount || 0);
  const caseCost = explicitNet > 0 ? explicitNet
    : (gross > 0 && disc > 0) ? Math.max(0, gross - disc)
    : gross || 0;
  const packSize = posProduct.pack || item.unitsPerPack || item.packUnits || 1;
  const unitCost = caseCost / packSize;

  // Seed the editable "Actual Cost" field with the product's currently-stored
  // case cost (defaultCasePrice). If the product has no stored cost yet (new
  // product, never received before), fall back to the invoice's computed caseCost
  // so the review UI never shows an empty field. The user can always adjust
  // before confirming — this is just a sensible default.
  const actualCost = posProduct.casePrice != null && posProduct.casePrice > 0
    ? posProduct.casePrice
    : caseCost;

  results[index] = {
    ...item,
    mappingStatus: 'matched',
    confidence,
    matchTier: tier,
    linkedProductId: posProduct.posProductId,
    description: posProduct.name,                        // override with POS canonical name
    suggestedRetailPrice: posProduct.retailPrice,
    packUnits: packSize,
    unitCost,
    // Editable product-facing case cost. On confirm, may replace MasterProduct.defaultCasePrice.
    actualCost,
    // Mini view of the matched product for the UI (🔒 lock indicator,
    // cost-diff badges, etc.). Minimal — we don't need the whole product row.
    linkedProduct: {
      id:                 posProduct.posProductId,
      name:               posProduct.name,
      defaultCasePrice:   posProduct.casePrice,
      defaultCostPrice:   posProduct.costPrice,
      defaultRetailPrice: posProduct.retailPrice,
      lockManualCaseCost: !!posProduct.lockManualCaseCost,
    },
    depositAmount: posProduct.deposit ?? item.depositAmount,
    upc: posProduct.upc || item.upc || '',
    // Session 39 Round 5 — cost change indicator for the review UI
    costDelta: buildCostDelta(posProduct, unitCost),
    // Pre-populate POS metadata so the review UI shows correct dropdowns immediately
    departmentId: posProduct.departmentId != null ? String(posProduct.departmentId) : (item.departmentId || ''),
    vendorId:     posProduct.vendorId     != null ? String(posProduct.vendorId)     : (item.vendorId     || ''),
    taxes:        posProduct.taxes        || item.taxes        || '',
    fees:         posProduct.fees         || item.fees         || '',
    taxesId:      posProduct.taxes        || item.taxesId      || '',
    feesId:       posProduct.fees         || item.feesId       || '',
  };
};

// ─── VENDOR MAP HELPERS ───────────────────────────────────────────────────────

const findVendorMapByDesc = (
  description: string,
  vendorMaps: VendorMapRow[],
  idIndex: Map<string, POSProduct>,
): { posProduct: POSProduct; score: number } | null => {
  let best: VendorMapRow | null = null;
  let bestScore = 0;

  for (const vm of vendorMaps) {
    if (!vm.vendorDescription) continue;
    const score = fuzzyScore(description, vm.vendorDescription);
    if (score > bestScore) {
      bestScore = score;
      best = vm;
    }
  }

  if (best && bestScore >= 0.8) {
    const posProduct = idIndex.get(best.posProductId);
    return posProduct ? { posProduct, score: bestScore } : null;
  }
  return null;
};

// ─── MAIN: matchLineItems ─────────────────────────────────────────────────────

/**
 * Match all invoice line items against POS products using a 7-tier cascade.
 *
 * Tier 1   — UPC exact + variants              (high  / zero cost)
 * Tier 2   — Distributor ItemCode, vendor-scoped ★ NEW primary tier (high / zero cost)
 *            Falls back to org-wide itemCode match at medium confidence if vendorId is null
 * Tier 3   — Learned VendorProductMap          (high/medium / zero cost, grows over time)
 * Tier 4   — PLU exact (produce codes only)    (high / zero cost)
 * Tier 5   — Cross-store GlobalProductMatch    (medium / zero cost)
 * Tier 6   — Cost-proximity + fuzzy composite  (medium/low / zero cost)
 * Tier 7   — AI batch (gpt-4o-mini)            (remaining unmatched only, ~$0.01–0.05/invoice)
 *
 * The internal `sku` field is intentionally NOT used anywhere in the cascade —
 * vendor invoices reference distributor item numbers, never our internal SKU.
 *
 * @param {Array}  lineItems    extracted invoice line items
 * @param {Array}  posProducts  normalized POS products (from loadCatalogProductsForMatching)
 * @param {string} vendorName   invoice vendor name (for VendorProductMap + global match lookup)
 * @param {Object} opts         optional: { vendorId } — enables vendor-scoped tiers
 * @returns {Array} enriched line items with match metadata
 */
export interface MatchLineItemsResult extends Array<MatchedLineItem> {
  /** Stats blob attached as a non-iterable expando for downstream consumers. */
  _matchStats?: MatchStats;
}

export const matchLineItems = async (
  lineItems: LineItemForMatch[],
  posProducts: POSProduct[],
  vendorName: string | null | undefined,
  opts: MatchOptions = {},
): Promise<MatchLineItemsResult> => {
  const vendorId = opts.vendorId != null ? String(opts.vendorId) : null;

  if (!posProducts || posProducts.length === 0) {
    return lineItems.map((item): MatchedLineItem => ({
      ...item,
      description: String(item.description || ''),
      originalVendorDescription: item.description ?? null,
      originalItemCode: item.itemCode ?? null,
      mappingStatus: 'unmatched',
      confidence: null,
      matchTier: null,
    }));
  }

  // Build lookup indexes once for the whole batch
  const upcIndex      = buildUPCIndex(posProducts);
  const itemCodeIdx   = buildItemCodeIndex(posProducts);
  const pluIndex      = buildPluIndex(posProducts);
  const idIndex       = buildIdIndex(posProducts);

  // When invoice vendor is known, narrow the search surface for fuzzy / cost / AI tiers.
  // This dramatically cuts false positives and AI token cost.
  const vendorScopedProducts = vendorId ? filterByVendor(posProducts, vendorId) : posProducts;
  const useVendorScope = vendorId && vendorScopedProducts.length > 0;
  if (useVendorScope) {
    console.log(`🔒 Vendor-scoped matching: ${vendorScopedProducts.length}/${posProducts.length} products for vendorId=${vendorId}`);
  }

  // Load learned vendor mappings for this vendor
  let vendorMaps: VendorMapRow[] = [];
  try {
    if (vendorName) {
      vendorMaps = (await prisma.vendorProductMap.findMany({
        where: { vendorName: { contains: vendorName, mode: 'insensitive' } },
      })) as unknown as VendorMapRow[];
      if (vendorMaps.length > 0) {
        console.log(`📚 Loaded ${vendorMaps.length} vendor map entries for "${vendorName}"`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('⚠ Could not load vendor product map:', message);
  }

  // Build a fast code-keyed lookup from the vendor map.
  // Session 39 Round 5 — splits multi-code cells so each token is its own key.
  const vendorMapByCode = new Map<string, VendorMapRow>();
  for (const m of vendorMaps) {
    const codes = parseItemCodeCell(m.vendorItemCode);
    for (const code of codes) {
      if (!vendorMapByCode.has(code)) vendorMapByCode.set(code, m);
    }
  }

  // Session 39 Round 5 — fold learned VendorProductMap codes into the
  // Tier 2 index so invoice #2+ hits Tier 2 directly (zero AI / zero cost)
  // instead of falling through to Tier 3.
  mergeVendorProductMapIntoItemCodeIndex(itemCodeIdx, vendorMaps, idIndex);

  // Preserve original vendor fields before we overwrite description/upc with POS data
  const results: MatchedLineItem[] = lineItems.map((item): MatchedLineItem => ({
    ...item,
    description: String(item.description || ''),
    originalVendorDescription: item.description ?? null,
    originalItemCode: item.itemCode || item.plu || null,
    mappingStatus: 'unmatched',
    confidence: null,
    matchTier: null,
  }));

  const unmatchedForAI: UnmatchedForAI[] = [];

  for (let i = 0; i < results.length; i++) {
    const item = results[i];

    // ── Tier 1: UPC exact + variants ──────────────────────────────────────────
    if (item.upc) {
      const match = matchByUPC(String(item.upc), upcIndex);
      if (match) {
        applyMatch(results, i, match, 'upc', 'high');
        continue;
      }
    }

    // ── Tier 2: Distributor ItemCode — vendor-scoped (PRIMARY MAPPING) ───────
    // Example: Hershey's "2468231280", Jeremy's "27149", Coca-Cola "115583".
    // With a known vendorId this is near-perfect; without one we still try an
    // org-wide lookup but downgrade to medium confidence to avoid cross-vendor
    // collisions (e.g. "01328" could mean different things to two distributors).
    // Session 39 Round 5 — also parses multi-code invoice cells ("112107 /
    // 144615") so any token can match — usually just one but defensive.
    if (item.itemCode) {
      const invoiceCodes = parseItemCodeCell(item.itemCode);
      let tier2Hit: { product: POSProduct; conf: MatchConfidence } | null = null;
      for (const code of invoiceCodes) {
        if (vendorId) {
          const hit = itemCodeIdx.vendorScoped.get(`${vendorId}::${code}`);
          if (hit) { tier2Hit = { product: hit, conf: 'high' }; break; }
        } else {
          const hit = itemCodeIdx.orgWide.get(code);
          if (hit) { tier2Hit = { product: hit, conf: 'medium' }; break; }
        }
      }
      if (tier2Hit) {
        applyMatch(results, i, tier2Hit.product, 'itemCode', tier2Hit.conf);
        continue;
      }
    }

    // ── Tier 3a: Learned vendor map — by item code ───────────────────────────
    // Session 39 Round 5 — tries each token from a multi-code invoice cell.
    if (item.itemCode) {
      const invoiceCodes = parseItemCodeCell(item.itemCode);
      let vmHit: VendorMapRow | null = null;
      for (const code of invoiceCodes) {
        const vm = vendorMapByCode.get(code);
        if (vm) { vmHit = vm; break; }
      }
      if (vmHit) {
        const posProduct = idIndex.get(vmHit.posProductId);
        if (posProduct) {
          const conf: MatchConfidence = (vmHit.confirmedCount || 0) >= 2 ? 'high' : 'medium';
          applyMatch(results, i, posProduct, 'vendorMap', conf);
          continue;
        }
      }
    }

    // ── Tier 3b: Learned vendor map — by description (fuzzy ≥ 0.80) ──────────
    if (item.description && vendorMaps.length > 0) {
      const vmMatch = findVendorMapByDesc(String(item.description), vendorMaps, idIndex);
      if (vmMatch) {
        applyMatch(results, i, vmMatch.posProduct, 'vendorMap', 'high');
        continue;
      }
    }

    // ── Tier 4: PLU exact match (produce codes) ──────────────────────────────
    // PLUs are numeric 4-5 digit codes (e.g. 4011 = banana) and are globally
    // standardized — no vendor scoping needed.
    if (item.plu) {
      const pluKey = String(item.plu).trim();
      if (pluKey) {
        const pluHit = pluIndex.get(pluKey);
        if (pluHit) {
          applyMatch(results, i, pluHit, 'plu', 'high');
          continue;
        }
      }
    }

    // ── Tier 5: Cross-store global matches ───────────────────────────────────
    if (item.itemCode && vendorName) {
      try {
        const globalMatch = await prisma.globalProductMatch.findUnique({
          where: { vendorName_vendorItemCode: { vendorName: vendorName.toLowerCase().trim(), vendorItemCode: String(item.itemCode).trim() } },
        });
        if (globalMatch && globalMatch.matchedUPC) {
          const globalPosMatch = matchByUPC(globalMatch.matchedUPC, upcIndex);
          if (globalPosMatch) {
            const conf: MatchConfidence = globalMatch.orgCount >= 3 ? 'high' : 'medium';
            applyMatch(results, i, globalPosMatch, 'global', conf);
            continue;
          }
        }
      } catch { /* non-fatal */ }
    }

    // ── Tier 6a: Cost-proximity matching (vendor-scoped if available) ────────
    if (item.caseCost || item.netCost) {
      const costMatch = matchByCostProximity(item, vendorScopedProducts);
      if (costMatch) {
        applyMatch(results, i, costMatch.product, 'costProx', costMatch.score >= 0.75 ? 'medium' : 'low');
        continue;
      }
    }

    // ── Tier 6b: Composite scoring (name + brand + size + cost + dept) ───────
    if (item.description) {
      const compResult = findBestCompositeMatch(item, vendorScopedProducts);
      if (compResult && compResult.score >= 0.55) {
        const confidence: MatchConfidence = compResult.score >= 0.80 ? 'medium' : 'low';
        applyMatch(results, i, compResult.product, 'fuzzy', confidence);
        continue;
      }
      // Fallback to simple Jaccard if composite didn't find anything
      const fuzzyResult = findBestFuzzyMatch(item.description, vendorScopedProducts);
      if (fuzzyResult && fuzzyResult.score >= 0.70) {
        const confidence: MatchConfidence = fuzzyResult.score >= 0.85 ? 'medium' : 'low';
        applyMatch(results, i, fuzzyResult.product, 'fuzzy', confidence);
        continue;
      }
    }

    // ── Queue for AI tier ─────────────────────────────────────────────────────
    unmatchedForAI.push({ item: results[i], index: i });
  }

  // ── Tier 7: AI batch for remaining unmatched ──────────────────────────────
  if (unmatchedForAI.length > 0) {
    console.log(`🤖 AI matching ${unmatchedForAI.length} unmatched items (gpt-4o-mini)${useVendorScope ? ` [vendor-scoped: ${vendorScopedProducts.length} products]` : ''}...`);
    const aiMatches = await aiBatchMatch(unmatchedForAI, vendorScopedProducts);
    for (const aiMatch of aiMatches) {
      // Skip low-confidence AI guesses — flag for manual review instead
      if (aiMatch.confidence === 'low') continue;
      const posProduct = idIndex.get(aiMatch.posProductId);
      if (posProduct) {
        applyMatch(results, aiMatch.itemIndex, posProduct, 'ai', aiMatch.confidence);
      }
    }
  }

  // ── Summary + matchStats ─────────────────────────────────────────────────
  const matched = results.filter((r) => r.mappingStatus === 'matched').length;
  const unmatched = results.length - matched;
  const byTier = results.reduce<Record<string, number>>((acc, r) => {
    const key = r.matchTier || 'unmatched';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  // Calculate average confidence
  const confScores: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const confSum = results.reduce((s, r) => s + (r.confidence ? confScores[r.confidence] : 0), 0);
  const avgConfidence = results.length > 0 ? Math.round((confSum / results.length) * 100) / 100 : 0;

  console.log(`✅ Match result: ${matched}/${results.length} matched — breakdown:`, byTier);

  // Post-processing: ensure every line item has an `actualCost` value so the
  // review UI's Actual Cost field always has a sensible default. Matched
  // items were already seeded from defaultCasePrice in applyMatch; this pass
  // covers unmatched items that never ran through applyMatch.
  // Fallback chain: netCost → caseCost − discount → caseCost → 0.
  for (const r of results) {
    if (r.actualCost != null && Number(r.actualCost) > 0) continue;
    const explicitNet = Number(r.netCost || 0);
    const gross       = Number(r.caseCost || 0);
    const disc        = Number(r.discount || 0);
    r.actualCost = explicitNet > 0 ? explicitNet
      : (gross > 0 && disc > 0) ? Math.max(0, gross - disc)
      : (gross > 0 ? gross : 0);
  }

  // Attach stats to the results array for invoice persistence
  const out = results as MatchLineItemsResult;
  out._matchStats = {
    total: results.length,
    matched,
    unmatched,
    matchRate: results.length > 0 ? Math.round((matched / results.length) * 10000) / 100 : 0,
    byTier,
    avgConfidence,
    timestamp: new Date().toISOString(),
  };

  return out;
};

// ─── SAVE CONFIRMED MAPPINGS ──────────────────────────────────────────────────

/**
 * Persist confirmed invoice matches to VendorProductMap.
 * Called after the user clicks Confirm on an invoice.
 *
 * For every matched/manual line item that has original vendor data,
 * we upsert a VendorProductMap entry so future invoices from the
 * same vendor get an instant Tier 2 hit.
 *
 * @param {Array}  lineItems   confirmed line items (with originalItemCode/originalVendorDescription)
 * @param {string} vendorName  invoice vendor name
 */
export const saveConfirmedMappings = async (
  lineItems: MatchedLineItem[],
  vendorName: string | null | undefined,
  orgId: string = 'unknown',
): Promise<void> => {
  if (!vendorName || !lineItems?.length) return;

  interface UpsertOp {
    updateOne: {
      filter: { vendorName: string; vendorItemCode?: string; vendorDescription?: string };
      update: {
        $set: {
          posProductId: string;
          posUPC: string;
          posName: string;
          vendorDescription: string | null | undefined;
          vendorItemCode: string | undefined;
          matchTier: MatchTier | null;
          lastSeenAt: Date;
        };
        $inc: { confirmedCount: number };
      };
      upsert: boolean;
    };
  }

  const operations: UpsertOp[] = [];

  for (const item of lineItems) {
    if (!['matched', 'manual'].includes(item.mappingStatus)) continue;
    if (!item.linkedProductId) continue;
    if (!item.originalItemCode && !item.originalVendorDescription) continue;

    // Prefer item-code-based key; fall back to description-based
    const filter: UpsertOp['updateOne']['filter'] = item.originalItemCode
      ? { vendorName, vendorItemCode: String(item.originalItemCode).trim() }
      : { vendorName, vendorDescription: item.originalVendorDescription ?? undefined };

    operations.push({
      updateOne: {
        filter,
        update: {
          $set: {
            posProductId: item.linkedProductId,
            posUPC: String(item.upc || ''),
            posName: item.description,
            vendorDescription: item.originalVendorDescription,
            vendorItemCode: item.originalItemCode ? String(item.originalItemCode) : undefined,
            matchTier: item.matchTier,
            lastSeenAt: new Date(),
          },
          $inc: { confirmedCount: 1 },
        },
        upsert: true,
      },
    });
  }

  if (operations.length > 0) {
    let saved = 0;
    for (const op of operations) {
      try {
        const f = op.updateOne.filter;
        const u = op.updateOne.update.$set;
        const existing = await prisma.vendorProductMap.findFirst({
          where: {
            vendorName:    f.vendorName,
            ...(f.vendorItemCode    ? { vendorItemCode: f.vendorItemCode }       : {}),
            ...(f.vendorDescription ? { vendorDescription: f.vendorDescription } : {}),
          },
        });
        if (existing) {
          await prisma.vendorProductMap.update({
            where: { id: existing.id },
            data: {
              posProductId:      u.posProductId,
              posUPC:            u.posUPC,
              posName:           u.posName,
              vendorDescription: u.vendorDescription ?? null,
              vendorItemCode:    u.vendorItemCode || existing.vendorItemCode,
              matchTier:         u.matchTier ?? null,
              lastSeenAt:        u.lastSeenAt,
              confirmedCount:    { increment: 1 },
            },
          });
        } else {
          await prisma.vendorProductMap.create({
            data: {
              orgId:             orgId || 'unknown',
              vendorName:        f.vendorName,
              vendorItemCode:    f.vendorItemCode || u.vendorItemCode || '',
              vendorDescription: u.vendorDescription ?? null,
              posProductId:      u.posProductId,
              posUPC:            u.posUPC,
              posName:           u.posName,
              matchTier:         u.matchTier ?? null,
              lastSeenAt:        u.lastSeenAt,
              confirmedCount:    1,
            },
          });
        }
        saved++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('⚠ Failed to save vendor map entry:', message);
      }
    }
    console.log(`💾 Saved/updated ${saved} vendor map entries for "${vendorName}"`);
  }

  // ── Save to global cross-store database ────────────────────────────────────
  try {
    const normalizedVendor = vendorName.toLowerCase().trim();
    let globalSaved = 0;

    for (const item of lineItems) {
      if (!['matched', 'manual'].includes(item.mappingStatus)) continue;
      if (!item.linkedProductId || !item.upc || !item.originalItemCode) continue;

      try {
        const existing = await prisma.globalProductMatch.findUnique({
          where: { vendorName_vendorItemCode: { vendorName: normalizedVendor, vendorItemCode: String(item.originalItemCode).trim() } },
        });

        if (existing) {
          const isNewOrg = !existing.orgs.includes(orgId);
          await prisma.globalProductMatch.update({
            where: { id: existing.id },
            data: {
              matchedUPC:     item.upc,
              matchedName:    item.description || existing.matchedName,
              confirmedCount: { increment: 1 },
              ...(isNewOrg ? {
                orgCount: { increment: 1 },
                orgs: { push: orgId },
              } : {}),
              updatedAt: new Date(),
            },
          });
        } else {
          await prisma.globalProductMatch.create({
            data: {
              vendorName:        normalizedVendor,
              vendorItemCode:    String(item.originalItemCode).trim(),
              vendorDescription: item.originalVendorDescription || null,
              matchedUPC:        item.upc,
              matchedName:       item.description || '',
              confirmedCount:    1,
              orgCount:          1,
              orgs:              [orgId],
            },
          });
        }
        globalSaved++;
      } catch { /* non-fatal — unique constraint race is OK */ }
    }

    if (globalSaved > 0) console.log(`🌐 Saved ${globalSaved} global match entries for "${vendorName}"`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('⚠ Failed to save global matches:', message);
  }
};

// ─── NEGATIVE FEEDBACK ──────────────────────────────────────────────────────
/**
 * Decrement confidence on a wrong mapping when user overrides a match.
 * If confirmedCount drops to 0 or below, remove the mapping entirely.
 */
export const decrementMapping = async (
  orgId: string,
  vendorName: string,
  vendorItemCode: string,
  wrongProductId: string,
): Promise<void> => {
  if (!vendorName || !vendorItemCode) return;
  try {
    const existing = await prisma.vendorProductMap.findFirst({
      where: {
        orgId,
        vendorName: { contains: vendorName, mode: 'insensitive' },
        vendorItemCode: String(vendorItemCode).trim(),
        posProductId: wrongProductId,
      },
    });
    if (!existing) return;

    if (existing.confirmedCount <= 1) {
      // Remove the bad mapping entirely
      await prisma.vendorProductMap.delete({ where: { id: existing.id } });
      console.log(`🗑 Removed bad vendor map: "${vendorName}" / "${vendorItemCode}" → ${wrongProductId}`);
    } else {
      // Decrement confidence
      await prisma.vendorProductMap.update({
        where: { id: existing.id },
        data: { confirmedCount: { decrement: 1 } },
      });
      console.log(`📉 Decremented vendor map confidence: "${vendorName}" / "${vendorItemCode}" (now ${existing.confirmedCount - 1})`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('⚠ Failed to decrement mapping:', message);
  }
};
