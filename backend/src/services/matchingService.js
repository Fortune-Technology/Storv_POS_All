import OpenAI from 'openai';
import prisma from '../config/postgres.js';
import { upcVariants as sharedUpcVariants } from '../utils/upc.js';

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
      sku:          p.sku || p.itemCode || p.plu || '',
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

const buildSKUIndex = (posProducts) => {
  const index = new Map();
  for (const p of posProducts) {
    if (p.sku) index.set(String(p.sku).trim(), p);
    if (p.posProductId) index.set(String(p.posProductId).trim(), p);
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
 * Match all invoice line items against POS products using a 4-tier cascade.
 *
 * Tier 1 — UPC exact + variants      (high confidence, zero cost)
 * Tier 2 — Learned VendorProductMap  (high confidence, zero cost, grows over time)
 * Tier 3 — Local fuzzy text          (medium/low confidence, zero cost)
 * Tier 4 — AI batch (gpt-4o-mini)    (remaining unmatched only, ~$0.01–0.05/invoice)
 *
 * @param {Array}  lineItems    extracted invoice line items
 * @param {Array}  posProducts  normalized POS products
 * @param {string} vendorName   invoice vendor name (for VendorProductMap lookup)
 * @returns {Array} enriched line items with match metadata
 */
export const matchLineItems = async (lineItems, posProducts, vendorName) => {
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
  const upcIndex = buildUPCIndex(posProducts);
  const skuIndex = buildSKUIndex(posProducts);
  const idIndex  = buildIdIndex(posProducts);

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

    // ── Tier 2a: Learned vendor map — by item code ────────────────────────────
    if (item.itemCode) {
      const key = String(item.itemCode).trim().toLowerCase();
      const vm = vendorMapByCode.get(key);
      if (vm) {
        const posProduct = idIndex.get(vm.posProductId);
        if (posProduct) {
          applyMatch(results, i, posProduct, 'vendorMap', 'high');
          continue;
        }
      }
    }

    // ── Tier 2b: Learned vendor map — by description (fuzzy ≥ 0.80) ──────────
    if (item.description && vendorMaps.length > 0) {
      const vmMatch = findVendorMapByDesc(item.description, vendorMaps, idIndex);
      if (vmMatch) {
        applyMatch(results, i, vmMatch.posProduct, 'vendorMap', 'high');
        continue;
      }
    }

    // ── Tier 2c: SKU / PLU exact match ────────────────────────────────────────
    const code = String(item.plu || item.itemCode || '').trim();
    if (code) {
      const match = skuIndex.get(code);
      if (match) {
        applyMatch(results, i, match, 'sku', 'medium');
        continue;
      }
    }

    // ── Tier 3: Local fuzzy text (Jaccard ≥ 0.70) ────────────────────────────
    if (item.description) {
      const fuzzyResult = findBestFuzzyMatch(item.description, posProducts);
      if (fuzzyResult && fuzzyResult.score >= 0.70) {
        const confidence = fuzzyResult.score >= 0.85 ? 'medium' : 'low';
        applyMatch(results, i, fuzzyResult.product, 'fuzzy', confidence);
        continue;
      }
    }

    // ── Queue for AI tier ─────────────────────────────────────────────────────
    unmatchedForAI.push({ item: results[i], index: i });
  }

  // ── Tier 4: AI batch for remaining unmatched ──────────────────────────────
  if (unmatchedForAI.length > 0) {
    console.log(`🤖 AI matching ${unmatchedForAI.length} unmatched items (gpt-4o-mini)...`);
    const aiMatches = await aiBatchMatch(unmatchedForAI, posProducts);
    for (const aiMatch of aiMatches) {
      // Skip low-confidence AI guesses — flag for manual review instead
      if (aiMatch.confidence === 'low') continue;
      const posProduct = idIndex.get(aiMatch.posProductId);
      if (posProduct) {
        applyMatch(results, aiMatch.itemIndex, posProduct, 'ai', aiMatch.confidence);
      }
    }
  }

  // ── Summary log ──────────────────────────────────────────────────────────
  const matched = results.filter((r) => r.mappingStatus === 'matched').length;
  const byTier = results.reduce((acc, r) => {
    const key = r.matchTier || 'unmatched';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  console.log(`✅ Match result: ${matched}/${results.length} matched — breakdown:`, byTier);

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
};
