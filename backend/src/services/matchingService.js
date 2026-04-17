import OpenAI from 'openai';
import prisma from '../config/postgres.js';
import { upcVariants as sharedUpcVariants, extractSizeFromDescription } from '../utils/upc.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── POS PRODUCT CACHE ────────────────────────────────────────────────────────
// Avoids re-fetching the full product list on every invoice upload.
// Keyed by userId, invalidated after TTL.

const POS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const posCache = new Map(); // userId → { products, fetchedAt }

export const setPOSCache = (userId, products) => {
  posCache.set(String(userId), { products, fetchedAt: Date.now() });
};

export const getPOSCache = (userId) => {
  const entry = posCache.get(String(userId));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > POS_CACHE_TTL_MS) {
    posCache.delete(String(userId));
    return null;
  }
  return entry.products;
};

export const clearPOSCache = (userId) => {
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
export const loadCatalogProductsForMatching = async (orgId) => {
  if (!orgId || orgId === 'unknown') return [];
  try {
    const products = await prisma.masterProduct.findMany({
      where: { orgId, deleted: false },
      select: {
        id: true, name: true, upc: true,
        sku: true, itemCode: true, plu: true,
        defaultRetailPrice: true, defaultCostPrice: true,
        casePacks: true, unitsPerPack: true, pack: true,
        departmentId: true, vendorId: true,
      },
      take: 10000,
    });
    console.log(`📦 Loaded ${products.length} catalog products for matching (org: ${orgId})`);
    return products.map(p => ({
      posProductId: String(p.id),
      name:         p.name,
      upc:          p.upc        || '',
      itemCode:     p.itemCode   || '',   // vendor/distributor code (primary key for Tier 2)
      plu:          p.plu        || '',   // PLU / produce code (Tier 4)
      // `sku` retained for debugging/display only — NOT used in matching
      sku:          p.sku        || '',
      retailPrice:  p.defaultRetailPrice != null ? Number(p.defaultRetailPrice) : null,
      costPrice:    p.defaultCostPrice   != null ? Number(p.defaultCostPrice)   : null,
      pack:         p.casePacks || p.unitsPerPack || p.pack || 1,
      departmentId: p.departmentId != null ? String(p.departmentId) : '',
      vendorId:     p.vendorId    != null ? String(p.vendorId)      : '',
    }));
  } catch (err) {
    console.error('❌ Failed to load catalog products for matching:', err.message);
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
const buildUPCIndex = (posProducts) => {
  const index = new Map();
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
const matchByUPC = (invoiceUPC, upcIndex) => {
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
const ABBREV = {
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

const tokenize = (str) =>
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
const fuzzyScore = (a, b) => {
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

/**
 * Find the highest-scoring fuzzy match from posProducts.
 * Returns { product, score } or null.
 */
const findBestFuzzyMatch = (description, posProducts) => {
  if (!description) return null;
  let best = null;
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
const brandMatch = (desc, productName) => {
  const descTokens = tokenize(desc);
  const prodTokens = tokenize(productName);
  // Check if any significant token (brand word) appears in both
  const brandWords = descTokens.filter(t => t.length > 3); // brand names are usually >3 chars
  for (const w of brandWords) {
    if (prodTokens.includes(w)) return 1.0;
  }
  return 0;
};

/**
 * Compare sizes extracted from descriptions.
 * Returns 1.0 if sizes match, 0.5 if close, 0 if different.
 */
const sizeMatch = (desc1, desc2) => {
  const s1 = extractSizeFromDescription(desc1);
  const s2 = extractSizeFromDescription(desc2);
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
const costProximity = (itemCost, productCost) => {
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
const compositeScore = (invoiceItem, posProduct) => {
  const desc = invoiceItem.originalVendorDescription || invoiceItem.description || '';
  const nameScore  = fuzzyScore(desc, posProduct.name);
  const brand      = brandMatch(desc, posProduct.name);
  const size       = sizeMatch(desc, posProduct.name);
  const cost       = costProximity(
    invoiceItem.caseCost || invoiceItem.netCost,
    posProduct.costPrice || posProduct.retailPrice
  );
  const dept = (invoiceItem.departmentId && posProduct.departmentId &&
    String(invoiceItem.departmentId) === String(posProduct.departmentId)) ? 1.0 : 0;

  return (0.40 * nameScore) + (0.15 * brand) + (0.15 * size) + (0.20 * cost) + (0.10 * dept);
};

/**
 * Find best composite match from posProducts.
 * Returns { product, score } or null.
 */
const findBestCompositeMatch = (invoiceItem, posProducts) => {
  let best = null;
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
const matchByCostProximity = (invoiceItem, posProducts) => {
  const itemCost = invoiceItem.caseCost || invoiceItem.netCost;
  if (!itemCost || itemCost <= 0) return null;

  let best = null;
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
const aiBatchMatch = async (unmatchedItems, posProducts) => {
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

    const parsed = JSON.parse(response.choices[0].message.content);
    return Array.isArray(parsed.matches) ? parsed.matches : [];
  } catch (err) {
    console.error('⚠ AI batch match failed:', err.message);
    return [];
  }
};

// ─── INDEX BUILDERS ───────────────────────────────────────────────────────────

/**
 * Build a vendor-scoped index of distributor itemCode → product.
 * Key format: `${vendorId}::${normalizedItemCode}` — prevents cross-vendor
 * collisions (Hershey's 2468231280 vs Jeremy's 27149 vs Coca-Cola 115583).
 *
 * Also builds an org-wide fallback index `*::${normalizedItemCode}` used as a
 * low-confidence fallback when the invoice has no resolved vendorId.
 */
const buildItemCodeIndex = (posProducts) => {
  const vendorScoped = new Map();
  const orgWide      = new Map();
  for (const p of posProducts) {
    if (!p.itemCode) continue;
    const code = String(p.itemCode).trim().toLowerCase();
    if (!code) continue;
    // Vendor-scoped (only if product has a vendor assigned)
    if (p.vendorId) {
      vendorScoped.set(`${p.vendorId}::${code}`, p);
    }
    // Org-wide fallback — first match wins
    if (!orgWide.has(code)) orgWide.set(code, p);
  }
  return { vendorScoped, orgWide };
};

/**
 * Build a PLU index — PLUs are numeric produce codes (e.g. 4011 = banana)
 * and are globally standardized, so no vendor scoping is needed.
 */
const buildPluIndex = (posProducts) => {
  const index = new Map();
  for (const p of posProducts) {
    if (!p.plu) continue;
    const key = String(p.plu).trim();
    if (key) index.set(key, p);
  }
  return index;
};

const buildIdIndex = (posProducts) => {
  const index = new Map();
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
const filterByVendor = (posProducts, vendorId) => {
  if (!vendorId) return posProducts;
  const vId = String(vendorId);
  return posProducts.filter(p => p.vendorId && String(p.vendorId) === vId);
};

// ─── APPLY MATCH ──────────────────────────────────────────────────────────────

const applyMatch = (results, index, posProduct, tier, confidence) => {
  const item = results[index];
  const caseCost = item.caseCost || item.netCost || 0;
  const packSize = posProduct.pack || item.unitsPerPack || item.packUnits || 1;

  results[index] = {
    ...item,
    mappingStatus: 'matched',
    confidence,
    matchTier: tier,
    linkedProductId: posProduct.posProductId,
    description: posProduct.name,                        // override with POS canonical name
    suggestedRetailPrice: posProduct.retailPrice,
    packUnits: packSize,
    unitCost: caseCost / packSize,
    depositAmount: posProduct.deposit || item.depositAmount,
    upc: posProduct.upc || item.upc,
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

const findVendorMapByDesc = (description, vendorMaps, idIndex) => {
  let best = null;
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
export const matchLineItems = async (lineItems, posProducts, vendorName, opts = {}) => {
  const vendorId = opts.vendorId != null ? String(opts.vendorId) : null;

  if (!posProducts || posProducts.length === 0) {
    return lineItems.map((item) => ({
      ...item,
      originalVendorDescription: item.description,
      originalItemCode: item.itemCode,
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
  let vendorMaps = [];
  try {
    if (vendorName) {
      vendorMaps = await prisma.vendorProductMap.findMany({
        where: { vendorName: { contains: vendorName, mode: 'insensitive' } },
      });
      if (vendorMaps.length > 0) {
        console.log(`📚 Loaded ${vendorMaps.length} vendor map entries for "${vendorName}"`);
      }
    }
  } catch (err) {
    console.warn('⚠ Could not load vendor product map:', err.message);
  }

  // Build a fast code-keyed lookup from the vendor map
  const vendorMapByCode = new Map(
    vendorMaps
      .filter((m) => m.vendorItemCode)
      .map((m) => [String(m.vendorItemCode).trim().toLowerCase(), m])
  );

  // Preserve original vendor fields before we overwrite description/upc with POS data
  const results = lineItems.map((item) => ({
    ...item,
    originalVendorDescription: item.description,
    originalItemCode: item.itemCode || item.plu || null,
    mappingStatus: 'unmatched',
    confidence: null,
    matchTier: null,
  }));

  const unmatchedForAI = [];

  for (let i = 0; i < results.length; i++) {
    const item = results[i];

    // ── Tier 1: UPC exact + variants ──────────────────────────────────────────
    if (item.upc) {
      const match = matchByUPC(item.upc, upcIndex);
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
    if (item.itemCode) {
      const code = String(item.itemCode).trim().toLowerCase();
      if (code) {
        // Vendor-scoped exact match — highest confidence
        if (vendorId) {
          const vendorHit = itemCodeIdx.vendorScoped.get(`${vendorId}::${code}`);
          if (vendorHit) {
            applyMatch(results, i, vendorHit, 'itemCode', 'high');
            continue;
          }
        }
        // Org-wide fallback — only when vendorId is unknown (safer to leave
        // unmatched when vendorId IS known but scoped lookup missed)
        if (!vendorId) {
          const orgHit = itemCodeIdx.orgWide.get(code);
          if (orgHit) {
            applyMatch(results, i, orgHit, 'itemCode', 'medium');
            continue;
          }
        }
      }
    }

    // ── Tier 3a: Learned vendor map — by item code ───────────────────────────
    if (item.itemCode) {
      const key = String(item.itemCode).trim().toLowerCase();
      const vm = vendorMapByCode.get(key);
      if (vm) {
        const posProduct = idIndex.get(vm.posProductId);
        if (posProduct) {
          const conf = (vm.confirmedCount || 0) >= 2 ? 'high' : 'medium';
          applyMatch(results, i, posProduct, 'vendorMap', conf);
          continue;
        }
      }
    }

    // ── Tier 3b: Learned vendor map — by description (fuzzy ≥ 0.80) ──────────
    if (item.description && vendorMaps.length > 0) {
      const vmMatch = findVendorMapByDesc(item.description, vendorMaps, idIndex);
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
            const conf = globalMatch.orgCount >= 3 ? 'high' : 'medium';
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
        const confidence = compResult.score >= 0.80 ? 'medium' : 'low';
        applyMatch(results, i, compResult.product, 'fuzzy', confidence);
        continue;
      }
      // Fallback to simple Jaccard if composite didn't find anything
      const fuzzyResult = findBestFuzzyMatch(item.description, vendorScopedProducts);
      if (fuzzyResult && fuzzyResult.score >= 0.70) {
        const confidence = fuzzyResult.score >= 0.85 ? 'medium' : 'low';
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
  const byTier = results.reduce((acc, r) => {
    const key = r.matchTier || 'unmatched';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  // Calculate average confidence
  const confScores = { high: 3, medium: 2, low: 1 };
  const confSum = results.reduce((s, r) => s + (confScores[r.confidence] || 0), 0);
  const avgConfidence = results.length > 0 ? Math.round((confSum / results.length) * 100) / 100 : 0;

  console.log(`✅ Match result: ${matched}/${results.length} matched — breakdown:`, byTier);

  // Attach stats to the results array for invoice persistence
  results._matchStats = {
    total: results.length,
    matched,
    unmatched,
    matchRate: results.length > 0 ? Math.round((matched / results.length) * 10000) / 100 : 0,
    byTier,
    avgConfidence,
    timestamp: new Date().toISOString(),
  };

  return results;
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
export const saveConfirmedMappings = async (lineItems, vendorName, orgId = 'unknown') => {
  if (!vendorName || !lineItems?.length) return;

  const operations = [];

  for (const item of lineItems) {
    if (!['matched', 'manual'].includes(item.mappingStatus)) continue;
    if (!item.linkedProductId) continue;
    if (!item.originalItemCode && !item.originalVendorDescription) continue;

    // Prefer item-code-based key; fall back to description-based
    const filter = item.originalItemCode
      ? { vendorName, vendorItemCode: String(item.originalItemCode).trim() }
      : { vendorName, vendorDescription: item.originalVendorDescription };

    operations.push({
      updateOne: {
        filter,
        update: {
          $set: {
            posProductId: item.linkedProductId,
            posUPC: item.upc,
            posName: item.description,
            vendorDescription: item.originalVendorDescription,
            vendorItemCode: item.originalItemCode || undefined,
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
              vendorDescription: u.vendorDescription,
              vendorItemCode:    u.vendorItemCode || existing.vendorItemCode,
              matchTier:         u.matchTier,
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
              vendorDescription: u.vendorDescription,
              posProductId:      u.posProductId,
              posUPC:            u.posUPC,
              posName:           u.posName,
              matchTier:         u.matchTier,
              lastSeenAt:        u.lastSeenAt,
              confirmedCount:    1,
            },
          });
        }
        saved++;
      } catch (err) {
        console.warn('⚠ Failed to save vendor map entry:', err.message);
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
    console.warn('⚠ Failed to save global matches:', err.message);
  }
};

// ─── NEGATIVE FEEDBACK ──────────────────────────────────────────────────────
/**
 * Decrement confidence on a wrong mapping when user overrides a match.
 * If confirmedCount drops to 0 or below, remove the mapping entirely.
 */
export const decrementMapping = async (orgId, vendorName, vendorItemCode, wrongProductId) => {
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
    console.warn('⚠ Failed to decrement mapping:', err.message);
  }
};
