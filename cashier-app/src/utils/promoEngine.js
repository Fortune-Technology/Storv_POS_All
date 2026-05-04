/**
 * Promotion Engine — client-side promotion evaluation.
 * Pure functions, no side effects, works fully offline.
 *
 * Promo Types:
 *   sale       — % off / $ off / fixed price on qualifying items
 *   bogo       — Buy X get Y free (or % off)
 *   volume     — Qty tiers: buy more, save more
 *   mix_match  — Any N items from qualifying set for $X
 *   combo      — Buy required product combos, get discount on all
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Main entry point.
 * @param {Array} items  - cart items: { lineId, productId, departmentId, qty, unitPrice, discountEligible }
 * @param {Array} promos - Promotion records from IndexedDB
 * @returns {{ lineAdjustments, totalSaving, appliedPromos }}
 */
export function evaluatePromotions(items, promos) {
  if (!items?.length || !promos?.length) {
    return { lineAdjustments: {}, totalSaving: 0, appliedPromos: [] };
  }

  const now = Date.now();

  // Filter to currently date-valid + active promotions
  const valid = promos.filter(p => {
    if (!p.active) return false;
    if (p.startDate && new Date(p.startDate).getTime() > now) return false;
    if (p.endDate   && new Date(p.endDate).getTime()   < now) return false;
    return true;
  });

  // Sort by priority: combo first, then mix_match, bogo, volume, sale
  const ORDER = { combo: 0, mix_match: 1, bogo: 2, volume: 3, sale: 4 };
  valid.sort((a, b) => (ORDER[a.promoType] ?? 9) - (ORDER[b.promoType] ?? 9));

  const lineAdjustments = {};   // lineId → adjustment object
  const appliedPromos   = [];

  for (const promo of valid) {
    const cfg        = promo.dealConfig || {};
    const qualifying = getQualifyingItems(promo, items);
    if (!qualifying.length) continue;

    // S69 (C11c) — minPurchaseAmount gate. Only fires when present + > 0.
    // Subtotal is computed across the qualifying lines (NOT the whole cart),
    // so "Spend $20 on Beer → 10% off Beer" only counts beer toward the min.
    if (!meetsMinPurchase(qualifying, cfg)) continue;

    let result = null;
    switch (promo.promoType) {
      case 'sale':      result = applySale(promo, qualifying, cfg);      break;
      case 'bogo':      result = applyBOGO(promo, qualifying, cfg);      break;
      case 'volume':    result = applyVolume(promo, qualifying, cfg);    break;
      case 'mix_match': result = applyMixMatch(promo, qualifying, cfg);  break;
      case 'combo':     result = applyCombo(promo, items, cfg);          break;
    }

    if (!result || !Object.keys(result.lineAdjustments || {}).length) continue;

    // Merge: take better discount per line
    for (const [lineId, adj] of Object.entries(result.lineAdjustments)) {
      const existing = lineAdjustments[lineId];
      const item     = items.find(i => i.lineId === lineId);
      if (!item) continue;

      const newSav = calcLineSaving(item, adj);
      const exSav  = existing ? calcLineSaving(item, existing) : -1;

      if (newSav > exSav) lineAdjustments[lineId] = adj;
    }

    appliedPromos.push({ id: promo.id, name: promo.name, promoType: promo.promoType, badgeLabel: promo.badgeLabel, badgeColor: promo.badgeColor });
  }

  // Total saving
  let totalSaving = 0;
  for (const [lineId, adj] of Object.entries(lineAdjustments)) {
    const item = items.find(i => i.lineId === lineId);
    if (item) totalSaving += calcLineSaving(item, adj);
  }

  return { lineAdjustments, totalSaving: round2(totalSaving), appliedPromos };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * S69 (C11c) — minimum purchase gate. Returns false when the promo has a
 * positive `minPurchaseAmount` AND the qualifying-line subtotal is below it.
 * Returns true when the promo has no minimum or the threshold is met.
 *
 * Subtotal uses unitPrice × qty (raw retail), NOT effective price after
 * other promos. Two reasons: (a) the engine evaluates promos in priority
 * order so we don't yet know what "effective" price would be, and (b) the
 * intent is "spend $20 on these items" — what they actually pay isn't the
 * threshold, what they're buying is.
 */
function meetsMinPurchase(qualifying, cfg) {
  const min = Number(cfg?.minPurchaseAmount || 0);
  if (!Number.isFinite(min) || min <= 0) return true;
  let subtotal = 0;
  for (const item of qualifying) {
    subtotal += Number(item.unitPrice || 0) * Number(item.qty || 0);
  }
  return subtotal + Number.EPSILON >= min;
}

function getQualifyingItems(promo, items) {
  return items.filter(item => {
    if (item.discountEligible === false) return false;
    // Session 56b — Three OR'd scope types. Each scope is independent: a
    // line qualifies if its productId is in productIds[], OR its
    // departmentId is in departmentIds[], OR its productGroupId is in
    // productGroupIds[]. When ALL three arrays are empty the promo is
    // org-wide (every line qualifies).
    const hasProductScope = promo.productIds?.length      > 0;
    const hasDeptScope    = promo.departmentIds?.length   > 0;
    const hasGroupScope   = promo.productGroupIds?.length > 0;
    if (!hasProductScope && !hasDeptScope && !hasGroupScope) return true;
    if (hasProductScope && promo.productIds.includes(item.productId)) return true;
    if (hasDeptScope    && promo.departmentIds.includes(item.departmentId)) return true;
    if (hasGroupScope   && item.productGroupId != null
        && promo.productGroupIds.includes(item.productGroupId)) return true;
    return false;
  });
}

function calcLineSaving(item, adj) {
  if (!adj) return 0;
  const lineTotal = item.unitPrice * item.qty;
  if (adj.discountType === 'percent') return round2(lineTotal * (adj.discountValue / 100));
  if (adj.discountType === 'amount')  return round2(Math.min(adj.discountValue * item.qty, lineTotal));
  if (adj.discountType === 'fixed')   return round2(Math.max(0, lineTotal - adj.discountValue * item.qty));
  return 0;
}

function makeAdj(promo, discountType, discountValue) {
  return {
    discountType,
    discountValue: round2(discountValue),
    promoId:    promo.id,
    promoName:  promo.name,
    badgeLabel: promo.badgeLabel || promo.name,
    badgeColor: promo.badgeColor || '#f59e0b',
  };
}

// ─── Sale ───────────────────────────────────────────────────────────────────
function applySale(promo, qualifying, cfg) {
  const lineAdjustments = {};
  for (const item of qualifying) {
    if (item.qty < (cfg.minQty || 1)) continue;
    const discType  = cfg.discountType || 'percent';
    const discVal   = parseFloat(cfg.discountValue) || 0;
    lineAdjustments[item.lineId] = makeAdj(promo, discType, discVal);
  }
  return { lineAdjustments };
}

// ─── BOGO ───────────────────────────────────────────────────────────────────
function applyBOGO(promo, qualifying, cfg) {
  const buyQty      = cfg.buyQty     || 1;
  const getQty      = cfg.getQty     || 1;
  const getDiscount = cfg.getDiscount != null ? cfg.getDiscount : 100; // percent off
  const setSize     = buyQty + getQty;

  // Expand to individual units sorted by price desc (cheapest units get the deal)
  const units = [];
  for (const item of qualifying) {
    for (let i = 0; i < item.qty; i++) {
      units.push({ lineId: item.lineId, price: parseFloat(item.unitPrice) });
    }
  }
  units.sort((a, b) => b.price - a.price);

  let numSets = Math.floor(units.length / setSize);
  if (cfg.maxSets) numSets = Math.min(numSets, cfg.maxSets);
  if (numSets === 0) return { lineAdjustments: {} };

  // For each set, the last getQty units (cheapest in set) are discounted
  const lineDiscAmount = {}; // lineId → total discount amount
  for (let s = 0; s < numSets; s++) {
    const freeUnits = units.slice(s * setSize + buyQty, (s + 1) * setSize);
    for (const u of freeUnits) {
      lineDiscAmount[u.lineId] = (lineDiscAmount[u.lineId] || 0) + u.price * getDiscount / 100;
    }
  }

  const lineAdjustments = {};
  for (const item of qualifying) {
    const total = lineDiscAmount[item.lineId];
    if (!total) continue;
    const perUnit = round2(total / item.qty);
    if (perUnit <= 0) continue;
    lineAdjustments[item.lineId] = makeAdj(
      promo, 'amount', perUnit
    );
    if (!promo.badgeLabel) {
      lineAdjustments[item.lineId].badgeLabel =
        getDiscount === 100
          ? `BUY ${buyQty} GET ${getQty} FREE`
          : `BUY ${buyQty} GET ${getQty} ${getDiscount}% OFF`;
    }
  }
  return { lineAdjustments };
}

// ─── Volume / Qty Tiers ─────────────────────────────────────────────────────
function applyVolume(promo, qualifying, cfg) {
  const totalQty = qualifying.reduce((s, i) => s + i.qty, 0);
  const tiers    = (cfg.tiers || []).slice().sort((a, b) => b.minQty - a.minQty);
  const tier     = tiers.find(t => totalQty >= t.minQty);
  if (!tier) return { lineAdjustments: {} };

  const lineAdjustments = {};
  for (const item of qualifying) {
    lineAdjustments[item.lineId] = makeAdj(
      promo,
      tier.discountType || 'percent',
      parseFloat(tier.discountValue) || 0
    );
    if (!promo.badgeLabel) {
      const suf = tier.discountType === 'percent' ? `${tier.discountValue}% OFF` : `$${tier.discountValue} OFF`;
      lineAdjustments[item.lineId].badgeLabel = `BUY ${tier.minQty}+ ${suf}`;
    }
  }
  return { lineAdjustments };
}

// ─── Mix & Match ─────────────────────────────────────────────────────────────
function applyMixMatch(promo, qualifying, cfg) {
  const groupSize   = cfg.groupSize   || 2;
  const bundlePrice = parseFloat(cfg.bundlePrice) || 0;

  const units = [];
  for (const item of qualifying) {
    for (let i = 0; i < item.qty; i++) {
      units.push({ lineId: item.lineId, price: parseFloat(item.unitPrice) });
    }
  }
  // Sort cheapest first so best items keep their price, cheap ones are in the deal
  units.sort((a, b) => a.price - b.price);

  const numGroups    = Math.floor(units.length / groupSize);
  if (numGroups === 0) return { lineAdjustments: {} };

  const groupUnits   = units.slice(0, numGroups * groupSize);
  const regularTotal = groupUnits.reduce((s, u) => s + u.price, 0);
  const promoTotal   = numGroups * bundlePrice;
  const totalDisc    = Math.max(0, regularTotal - promoTotal);
  if (totalDisc <= 0) return { lineAdjustments: {} };

  // Distribute discount proportionally by price
  const lineDiscTotal = {};
  for (const u of groupUnits) {
    lineDiscTotal[u.lineId] = (lineDiscTotal[u.lineId] || 0) + (u.price / regularTotal) * totalDisc;
  }

  const lineAdjustments = {};
  for (const item of qualifying) {
    if (!lineDiscTotal[item.lineId]) continue;
    const perUnit = round2(lineDiscTotal[item.lineId] / item.qty);
    if (perUnit <= 0) continue;
    lineAdjustments[item.lineId] = {
      ...makeAdj(promo, 'amount', perUnit),
      badgeLabel: promo.badgeLabel || `ANY ${groupSize} FOR $${bundlePrice.toFixed(2)}`,
    };
  }
  return { lineAdjustments };
}

// ─── Combo Deal ──────────────────────────────────────────────────────────────
function applyCombo(promo, items, cfg) {
  const requiredGroups = cfg.requiredGroups || [];
  if (!requiredGroups.length) return { lineAdjustments: {} };

  // Verify all required groups are satisfied
  for (const group of requiredGroups) {
    const ids    = group.productIds || [];
    const minQty = group.minQty    || 1;
    const qty    = items
      .filter(i => ids.includes(i.productId))
      .reduce((s, i) => s + i.qty, 0);
    if (qty < minQty) return { lineAdjustments: {} };
  }

  // All groups satisfied — apply discount to all combo items
  const comboIds = requiredGroups.flatMap(g => g.productIds || []);
  const lineAdjustments = {};
  for (const item of items) {
    if (!comboIds.includes(item.productId)) continue;
    lineAdjustments[item.lineId] = {
      ...makeAdj(promo, cfg.discountType || 'percent', parseFloat(cfg.discountValue) || 0),
      badgeLabel: promo.badgeLabel || 'COMBO DEAL',
      badgeColor: promo.badgeColor || '#f97316',
    };
  }
  return { lineAdjustments };
}
