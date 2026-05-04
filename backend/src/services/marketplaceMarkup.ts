/**
 * Marketplace Markup service (Session 71)
 *
 * Pure functions — no DB, no I/O. Used by `inventorySyncService` to translate
 * in-store POS prices into the marked-up prices each marketplace receives.
 *
 * Why per-marketplace: every delivery marketplace charges different commission
 * (DoorDash ~15-30%, UberEats ~15-30%, Instacart ~15-23%, Grubhub ~10-30%).
 * To keep the in-store price stable while still recovering those fees, stores
 * mark up the price they push to each marketplace independently.
 *
 * The settings live on `StoreIntegration.pricingConfig` (Json column) — one
 * row per store + platform, so each marketplace gets its own knobs.
 *
 * Pricing pipeline (called once per product per platform per sync):
 *
 *   basePrice (POS retail or sale price)
 *     → effectiveMarkupPercent(deptId)   (department override > global)
 *     → applyMarkup(base × (1 + pct/100))
 *     → applyRounding(price, mode)        (psychological pricing)
 *     → meetsMarginGuard(markedUp, cost)  (block if margin too thin)
 *
 *   isExcluded(deptId, productId)         (skip product entirely)
 *   passesSyncMode(qoh, hasPromo, mode)   (filter what gets synced)
 *
 * The orchestrator `computeMarketplacePrice()` runs the whole pipeline and
 * returns either a final price or an explanation of why the product was
 * skipped — callers pass the result straight into the platform adapter.
 */

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type RoundingMode =
  | 'none'             // exact penny ($5.27 → $5.27)
  | 'nearest_dollar'   // nearest .00 ($5.27 → $5.00, $5.55 → $6.00)
  | 'nearest_half'     // nearest .00 or .50 ($5.27 → $5.50, $5.20 → $5.00)
  | 'charm_99'         // always up to .99 in same dollar ($5.27 → $5.99)
  | 'charm_95'         // always up to .95 in same dollar ($5.27 → $5.95)
  | 'psych_smart';     // closest of {.00, .50, .99} — picks whichever fits best

export type SyncMode =
  | 'all'                 // every active product (default)
  | 'in_stock_only'       // only products with quantityOnHand > 0
  | 'active_promos_only'; // only products with an active promotion right now

export interface MarketplacePricingConfig {
  /** Global markup percent applied to every product (e.g. 15 = +15%). */
  markupPercent?: number;

  /** Per-department markup overrides keyed by departmentId-as-string. */
  categoryMarkups?: Record<string, number>;

  /** Rounding rule applied AFTER markup. */
  roundingMode?: RoundingMode;

  /** Master toggle — when false, the platform's inventory push is skipped. */
  inventorySyncEnabled?: boolean;

  /** Sync filter — controls which products get sent. */
  syncMode?: SyncMode;

  /** Excluded department IDs (skipped entirely). */
  excludedDepartmentIds?: (string | number)[];

  /** Excluded product IDs (skipped entirely). */
  excludedProductIds?: (string | number)[];

  /**
   * Minimum acceptable margin AFTER markup, as a percent (e.g. 5 = 5%).
   *   margin = (markedUpPrice − costPrice) / markedUpPrice × 100
   * If margin would drop below this, the product is rejected from sync.
   * Set to 0 to disable.
   */
  minMarginPercent?: number;

  /** Whether the marketplace expects tax-inclusive prices. Display-only for now. */
  taxInclusive?: boolean;

  /** Prep time hint to send to the marketplace (display-only for now). */
  prepTimeMinutes?: number;
}

export interface ComputeMarketplacePriceInput {
  basePrice: number;             // retail price BEFORE markup
  costPrice?: number | null;     // for margin guard; null = guard not enforced
  departmentId?: string | number | null;
  productId?: string | number;   // for exclusion check
  hasActivePromo?: boolean;      // for syncMode = active_promos_only
  quantityOnHand?: number;       // for syncMode = in_stock_only
  config: MarketplacePricingConfig;
}

export interface ComputeMarketplacePriceResult {
  /** The price to send to the marketplace, in dollars. Undefined when skipped. */
  price?: number;
  /** Snapshot of the markup percent that was applied (for audit). */
  markupApplied: number;
  /** Where the markup percent came from. */
  markupSource: 'category' | 'global' | 'none';
  /** True when the product should be SKIPPED from this marketplace's sync. */
  skipped: boolean;
  /** Why it was skipped — undefined when not skipped. */
  skipReason?: 'excluded_product' | 'excluded_department'
             | 'sync_mode_filter' | 'margin_too_thin'
             | 'invalid_base_price';
}

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<MarketplacePricingConfig> = {
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
};

/** Coerce stored config (may be partial / from JSON) into a fully-defaulted shape. */
export function normalizeConfig(raw: MarketplacePricingConfig | null | undefined): Required<MarketplacePricingConfig> {
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
  };
}

/**
 * Resolve which markup percent applies for a department:
 *   1. Per-department override in `categoryMarkups[deptId]`
 *   2. Global `markupPercent`
 *   3. Zero
 *
 * Returns 0 + source 'none' when no markup is configured.
 */
export function effectiveMarkupPercent(
  departmentId: string | number | null | undefined,
  config: MarketplacePricingConfig,
): { percent: number; source: 'category' | 'global' | 'none' } {
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

/**
 * Apply a percent markup to a base price.
 *   $10.00 + 15% → $11.50
 *   $10.00 + 0%  → $10.00
 * Negative markups are allowed (e.g. -5% to discount) but typically not used.
 */
export function applyMarkup(basePrice: number, markupPercent: number): number {
  const base = Number(basePrice) || 0;
  const pct  = Number(markupPercent) || 0;
  return round2(base * (1 + pct / 100));
}

/**
 * Round a price per the chosen rounding mode. Used to make marked-up values
 * land on psychologically pleasant points like .99 / .50 / .00.
 *
 *   none           — penny exact
 *   nearest_dollar — nearest .00
 *   nearest_half   — nearest .00 or .50
 *   charm_99       — round UP to next .99 in the current dollar (always)
 *   charm_95       — round UP to next .95 in the current dollar (always)
 *   psych_smart    — pick whichever of {.00, .50, .99} is closest
 */
export function applyRounding(price: number, mode: RoundingMode): number {
  if (!Number.isFinite(price)) return 0;
  const p = price;

  switch (mode) {
    case 'nearest_dollar':
      return round2(Math.round(p));

    case 'nearest_half':
      // round to nearest 0.50
      return round2(Math.round(p * 2) / 2);

    case 'charm_99':
      // floor to dollar, add .99 (always lands at X.99)
      return round2(Math.floor(p) + 0.99);

    case 'charm_95':
      // floor to dollar, add .95
      return round2(Math.floor(p) + 0.95);

    case 'psych_smart': {
      // candidates: floor.00, floor.50, floor.99, ceil.00
      const floor = Math.floor(p);
      const ceil  = Math.ceil(p);
      const candidates = [floor, floor + 0.5, floor + 0.99, ceil];
      let best = candidates[0];
      let bestDist = Math.abs(p - best);
      for (const c of candidates) {
        const d = Math.abs(p - c);
        // Tie-breaker: prefer the higher candidate (charm pricing convention)
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

/**
 * Margin guard — returns true when (markedUpPrice − cost) / markedUpPrice
 * is at least `minMarginPercent`. When cost is null/0 the guard passes
 * (we can't compute a margin without a cost).
 *
 *   meetsMarginGuard($10.00, $7.00, 5)  → margin 30% → true
 *   meetsMarginGuard($10.00, $9.80, 5)  → margin  2% → false
 *   meetsMarginGuard($10.00, null,  5)  → no cost   → true (skip guard)
 */
export function meetsMarginGuard(
  markedUpPrice: number,
  costPrice: number | null | undefined,
  minMarginPercent: number,
): boolean {
  const cost = toNumber(costPrice);
  const min  = Number(minMarginPercent) || 0;
  if (min <= 0) return true;
  if (cost == null || cost <= 0) return true; // no cost data — skip guard
  if (markedUpPrice <= 0) return false;
  const marginPct = ((markedUpPrice - cost) / markedUpPrice) * 100;
  return marginPct >= min;
}

/** True when the product should be SKIPPED based on exclusion lists. */
export function isExcluded(
  departmentId: string | number | null | undefined,
  productId: string | number | null | undefined,
  config: MarketplacePricingConfig,
): { excluded: boolean; reason?: 'product' | 'department' } {
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

/**
 * Sync mode filter — true when the product should be INCLUDED for the chosen mode.
 *
 *   all                 — always true
 *   in_stock_only       — true iff qoh > 0
 *   active_promos_only  — true iff hasActivePromo
 */
export function passesSyncMode(
  quantityOnHand: number | null | undefined,
  hasActivePromo: boolean | null | undefined,
  mode: SyncMode,
): boolean {
  switch (mode) {
    case 'in_stock_only':       return Number(quantityOnHand) > 0;
    case 'active_promos_only':  return !!hasActivePromo;
    case 'all':
    default:                    return true;
  }
}

/**
 * Orchestrator — runs the complete pipeline for one product on one marketplace.
 * Returns a result that the caller can branch on:
 *   - result.skipped === false → push `result.price` to the marketplace
 *   - result.skipped === true  → omit this product from the sync entirely
 *
 * Resolution order:
 *   1. Exclusion list (product, then department)
 *   2. Sync-mode filter
 *   3. Markup (per-dept override → global)
 *   4. Rounding
 *   5. Margin guard
 */
export function computeMarketplacePrice(input: ComputeMarketplacePriceInput): ComputeMarketplacePriceResult {
  const config = input.config;
  const base = Number(input.basePrice) || 0;

  // Exclusion checks first — cheapest filter
  const ex = isExcluded(input.departmentId, input.productId, config);
  if (ex.excluded) {
    return {
      markupApplied: 0,
      markupSource: 'none',
      skipped: true,
      skipReason: ex.reason === 'product' ? 'excluded_product' : 'excluded_department',
    };
  }

  // Sync mode filter
  if (!passesSyncMode(input.quantityOnHand, input.hasActivePromo, config.syncMode ?? 'all')) {
    return {
      markupApplied: 0,
      markupSource: 'none',
      skipped: true,
      skipReason: 'sync_mode_filter',
    };
  }

  if (!Number.isFinite(base) || base <= 0) {
    return {
      markupApplied: 0,
      markupSource: 'none',
      skipped: true,
      skipReason: 'invalid_base_price',
    };
  }

  // Markup
  const { percent, source } = effectiveMarkupPercent(input.departmentId, config);
  const markedUp = applyMarkup(base, percent);

  // Round
  const rounded = applyRounding(markedUp, config.roundingMode ?? 'none');

  // Margin guard (uses ROUNDED price — that's what the customer would pay)
  if (!meetsMarginGuard(rounded, input.costPrice, Number(config.minMarginPercent) || 0)) {
    return {
      markupApplied: percent,
      markupSource: source,
      skipped: true,
      skipReason: 'margin_too_thin',
    };
  }

  return {
    price: rounded,
    markupApplied: percent,
    markupSource: source,
    skipped: false,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────────

function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
