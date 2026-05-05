/**
 * Marketplace Markup helpers (S71d / F32) — JavaScript port of the canonical
 * TypeScript source at backend/src/services/marketplaceMarkup.ts.
 *
 * Pure functions, no DB. Used by ecom-backend's syncRoutes.js to apply the
 * storefront's pricingConfig to incoming POS product payloads before writing
 * EcomProduct. The same logic also runs on the POS side for marketplace pushes.
 *
 * KEEP IN SYNC with backend/src/services/marketplaceMarkup.ts. If the rules
 * change there, mirror them here.
 */

// ── Defaults (mirrors DEFAULT_CONFIG in the TS source) ────────────────
const DEFAULT_CONFIG = {
  markupPercent: 0,
  categoryMarkups: {},
  roundingMode: 'none',
  inventorySyncEnabled: true,
  syncMode: 'all',
  excludedDepartmentIds: [],
  excludedProductIds: [],
  minMarginPercent: 0,
  taxInclusive: false,
  prepTimeMinutes: 0,
  velocityWindowDays: 14,
  velocityWindowByDepartment: {},
  unknownStockBehavior: 'send_zero',
  unknownStockDefaultQty: 0,
  unknownStockDaysOfCover: 2,
};

// ── Helpers ───────────────────────────────────────────────────────────

function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Coerce stored config (may be partial / from JSON) into a fully-defaulted shape. */
export function normalizeConfig(raw) {
  const c = raw ?? {};
  return {
    markupPercent:        toNumber(c.markupPercent) ?? DEFAULT_CONFIG.markupPercent,
    categoryMarkups:      c.categoryMarkups ?? {},
    roundingMode:         c.roundingMode ?? DEFAULT_CONFIG.roundingMode,
    inventorySyncEnabled: c.inventorySyncEnabled ?? DEFAULT_CONFIG.inventorySyncEnabled,
    syncMode:             c.syncMode ?? DEFAULT_CONFIG.syncMode,
    excludedDepartmentIds: c.excludedDepartmentIds ?? [],
    excludedProductIds:   c.excludedProductIds ?? [],
    minMarginPercent:     toNumber(c.minMarginPercent) ?? DEFAULT_CONFIG.minMarginPercent,
    taxInclusive:         c.taxInclusive ?? DEFAULT_CONFIG.taxInclusive,
    prepTimeMinutes:      toNumber(c.prepTimeMinutes) ?? DEFAULT_CONFIG.prepTimeMinutes,
    velocityWindowDays:        toNumber(c.velocityWindowDays) ?? DEFAULT_CONFIG.velocityWindowDays,
    velocityWindowByDepartment: c.velocityWindowByDepartment ?? {},
    unknownStockBehavior:      c.unknownStockBehavior ?? DEFAULT_CONFIG.unknownStockBehavior,
    unknownStockDefaultQty:    toNumber(c.unknownStockDefaultQty) ?? DEFAULT_CONFIG.unknownStockDefaultQty,
    unknownStockDaysOfCover:   toNumber(c.unknownStockDaysOfCover) ?? DEFAULT_CONFIG.unknownStockDaysOfCover,
  };
}

/** Resolve the markup percent that applies for a department. */
export function effectiveMarkupPercent(departmentId, config) {
  const cat = config.categoryMarkups ?? {};
  if (departmentId != null) {
    const key = String(departmentId);
    const override = toNumber(cat[key]);
    if (override != null && override !== 0) {
      return { percent: override, source: 'category' };
    }
  }
  const global = toNumber(config.markupPercent);
  if (global != null && global !== 0) {
    return { percent: global, source: 'global' };
  }
  return { percent: 0, source: 'none' };
}

/** Apply a percent markup to a base price. */
export function applyMarkup(basePrice, markupPercent) {
  const base = Number(basePrice) || 0;
  const pct  = Number(markupPercent) || 0;
  return round2(base * (1 + pct / 100));
}

/** Round a price per the chosen rounding mode. */
export function applyRounding(price, mode) {
  if (!Number.isFinite(price)) return 0;
  const p = price;

  switch (mode) {
    case 'nearest_dollar':
      return round2(Math.round(p));
    case 'nearest_half':
      return round2(Math.round(p * 2) / 2);
    case 'charm_99':
      return round2(Math.floor(p) + 0.99);
    case 'charm_95':
      return round2(Math.floor(p) + 0.95);
    case 'psych_smart': {
      const floor = Math.floor(p);
      const ceil  = Math.ceil(p);
      const candidates = [floor, floor + 0.5, floor + 0.99, ceil];
      let best = candidates[0];
      let bestDist = Math.abs(p - best);
      for (const c of candidates) {
        const d = Math.abs(p - c);
        if (d < bestDist || (d === bestDist && c > best)) {
          best = c;
          bestDist = d;
        }
      }
      return round2(best);
    }
    case 'none':
    default:
      return round2(p);
  }
}

/** Margin guard — true when the marked-up price keeps margin >= minMarginPercent. */
export function meetsMarginGuard(markedUpPrice, costPrice, minMarginPercent) {
  const cost = toNumber(costPrice);
  const min  = Number(minMarginPercent) || 0;
  if (min <= 0) return true;
  if (cost == null || cost <= 0) return true; // no cost data — skip guard
  if (markedUpPrice <= 0) return false;
  const marginPct = ((markedUpPrice - cost) / markedUpPrice) * 100;
  return marginPct >= min;
}

/** True when the product should be SKIPPED based on exclusion lists. */
export function isExcluded(departmentId, productId, config) {
  const deptIds = (config.excludedDepartmentIds ?? []).map(String);
  const prodIds = (config.excludedProductIds ?? []).map(String);

  if (productId != null && prodIds.includes(String(productId))) {
    return { excluded: true, reason: 'product' };
  }
  if (departmentId != null && deptIds.includes(String(departmentId))) {
    return { excluded: true, reason: 'department' };
  }
  return { excluded: false };
}

/** Sync mode filter — true when the product should be included for the chosen mode. */
export function passesSyncMode(quantityOnHand, hasActivePromo, mode) {
  switch (mode) {
    case 'in_stock_only':       return Number(quantityOnHand) > 0;
    case 'active_promos_only':  return !!hasActivePromo;
    case 'all':
    default:                    return true;
  }
}

/**
 * Resolve which velocity window (in days) applies for a department.
 * Per-dept override > global default > null.
 */
export function effectiveVelocityWindow(departmentId, config) {
  const byDept = config.velocityWindowByDepartment ?? {};
  if (departmentId != null) {
    const override = toNumber(byDept[String(departmentId)]);
    if (override != null && override > 0) return Math.round(override);
  }
  const global = toNumber(config.velocityWindowDays);
  if (global != null && global > 0) return Math.round(global);
  return null;
}

/** Compute the qty to push when stock is unknown / non-positive. */
export function computeUnknownStockQty(config, avgDaily) {
  const behavior = config.unknownStockBehavior ?? 'send_zero';
  switch (behavior) {
    case 'send_default':
      return Math.max(0, Math.round(Number(config.unknownStockDefaultQty) || 0));
    case 'estimate_from_velocity': {
      const v = Number(avgDaily) || 0;
      const days = Number(config.unknownStockDaysOfCover) || 0;
      if (v <= 0 || days <= 0) return 0;
      return Math.max(0, Math.ceil(v * days));
    }
    case 'send_zero':
    default:
      return 0;
  }
}

/**
 * Orchestrator — runs the complete pipeline for one product on one storefront/marketplace.
 *
 * Returns either { price, qty, markupApplied, markupSource, skipped: false }
 * or { skipped: true, skipReason } for products that should be hidden / dropped.
 *
 *   skipped: true → caller sets EcomProduct.visible = false
 *   skipped: false → caller writes result.price as retailPrice + result.qty as quantityOnHand
 *
 * The qty in the return is the smart QoH: actual stock if positive, else
 * computed from unknownStockBehavior policy.
 */
export function computeMarketplacePrice(input) {
  const config = input.config || {};
  const base = Number(input.basePrice) || 0;
  const qoh = Number(input.quantityOnHand ?? 0);
  const productId = input.productId;
  const departmentId = input.departmentId;
  const avgDaily = Number(input.avgDaily ?? 0);

  // 1. Exclusion checks first — cheapest filter
  const ex = isExcluded(departmentId, productId, config);
  if (ex.excluded) {
    return {
      skipped: true,
      skipReason: ex.reason === 'product' ? 'excluded_product' : 'excluded_department',
    };
  }

  // 2. Sync mode filter
  if (!passesSyncMode(qoh, input.hasActivePromo, config.syncMode ?? 'all')) {
    return { skipped: true, skipReason: 'sync_mode_filter' };
  }

  if (!Number.isFinite(base) || base <= 0) {
    return { skipped: true, skipReason: 'invalid_base_price' };
  }

  // 3. Markup
  const { percent, source } = effectiveMarkupPercent(departmentId, config);
  const markedUp = applyMarkup(base, percent);

  // 4. Round
  const rounded = applyRounding(markedUp, config.roundingMode ?? 'none');

  // 5. Margin guard
  if (!meetsMarginGuard(rounded, input.costPrice, Number(config.minMarginPercent) || 0)) {
    return { skipped: true, skipReason: 'margin_too_thin' };
  }

  // 6. Smart qty: actual stock if positive, otherwise apply unknown-stock policy
  const smartQty = qoh > 0 ? qoh : computeUnknownStockQty(config, avgDaily);

  return {
    skipped: false,
    price: rounded,
    qty: smartQty,
    markupApplied: percent,
    markupSource: source,
  };
}
