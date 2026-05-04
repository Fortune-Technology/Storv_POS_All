/**
 * MarketplacePricingDrawer — Session 71
 *
 * Slide-in drawer for configuring per-marketplace pricing on a single
 * platform integration (DoorDash, UberEats, Instacart, etc.).
 *
 * Sections:
 *   1. Markup (global % + per-department overrides)
 *   2. Price Rounding (with live preview)
 *   3. Inventory Sync (master toggle + sync mode)
 *   4. Exclusions (departments + products)
 *   5. Margin Guard (refuse to sync if margin too thin)
 *   6. Misc (prep time, tax-inclusive)
 *
 * Reads/writes via the existing /api/integrations/settings/:platform endpoint
 * (PUT body: { pricingConfig: {...} }). Backend validates + persists.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'react-toastify';
import {
  X, DollarSign, Sparkles, Boxes, Ban, ShieldCheck, Settings2,
  Loader2, Save, Plus, Trash2, Search, Info, Eye, RefreshCw, AlertTriangle,
} from 'lucide-react';
import {
  getIntegrationSettings, updateIntegrationSettings, syncIntegrationInventory,
  previewIntegrationImpact, getCatalogDepartments, searchCatalogProducts,
} from '../services/api';
import { MoneyInput } from './NumericInputs';
import './MarketplacePricingDrawer.css';

// ── Constants ────────────────────────────────────────────────────────────────

const ROUNDING_OPTIONS = [
  { value: 'none',           label: 'Penny exact',        hint: 'Show exact marked-up price' },
  { value: 'nearest_dollar', label: 'Nearest dollar',     hint: 'Round to .00 (e.g. $5.27 → $5.00)' },
  { value: 'nearest_half',   label: 'Nearest .50 / .00',  hint: 'Closest half (e.g. $5.27 → $5.50)' },
  { value: 'charm_99',       label: 'Always X.99',        hint: 'Charm pricing (e.g. $5.27 → $5.99)' },
  { value: 'charm_95',       label: 'Always X.95',        hint: 'Charm pricing (e.g. $5.27 → $5.95)' },
  { value: 'psych_smart',    label: 'Smart psych',        hint: 'Closest of .00 / .50 / .99' },
];

const SYNC_MODE_OPTIONS = [
  { value: 'all',                 label: 'All active products',   hint: 'Sync every active product (default)' },
  { value: 'in_stock_only',       label: 'In-stock only',         hint: 'Only push products with quantity > 0' },
  { value: 'active_promos_only',  label: 'On-sale only',          hint: 'Only push products with an active sale price' },
];

// Sample prices for the live preview strip
const PREVIEW_BASES = [1.99, 5.99, 12.49, 29.95];

// S71b — pretty-print skip stats from the backend
function skipBreakdown(s) {
  if (!s) return '';
  const parts = [];
  if (s.excludedProduct)    parts.push(`${s.excludedProduct} excluded`);
  if (s.excludedDepartment) parts.push(`${s.excludedDepartment} dept-excluded`);
  if (s.syncModeFilter)     parts.push(`${s.syncModeFilter} sync filter`);
  if (s.marginTooThin)      parts.push(`${s.marginTooThin} margin guard`);
  if (s.invalidPrice)       parts.push(`${s.invalidPrice} invalid`);
  return parts.join(', ');
}

// ── Pure helpers (mirror backend marketplaceMarkup.ts for live preview) ─────

function applyMarkupClient(base, pct) {
  return Math.round(base * (1 + (pct || 0) / 100) * 100) / 100;
}

function applyRoundingClient(price, mode) {
  if (!Number.isFinite(price)) return 0;
  const r2 = (n) => Math.round(n * 100) / 100;
  switch (mode) {
    case 'nearest_dollar': return r2(Math.round(price));
    case 'nearest_half':   return r2(Math.round(price * 2) / 2);
    case 'charm_99':       return r2(Math.floor(price) + 0.99);
    case 'charm_95':       return r2(Math.floor(price) + 0.95);
    case 'psych_smart': {
      const fl = Math.floor(price), ce = Math.ceil(price);
      const cands = [fl, fl + 0.5, fl + 0.99, ce];
      let best = cands[0], bestD = Math.abs(price - best);
      for (const c of cands) {
        const d = Math.abs(price - c);
        if (d < bestD || (d === bestD && c > best)) { best = c; bestD = d; }
      }
      return r2(best);
    }
    case 'none':
    default: return r2(price);
  }
}

// ── Main component ──────────────────────────────────────────────────────────

export default function MarketplacePricingDrawer({ open, onClose, platformKey, platformMeta = {}, onSaved }) {
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [config, setConfig]     = useState(null);
  const [departments, setDepts] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState([]);
  const [productLookup, setProductLookup]   = useState({}); // id → name (for excluded display)
  const [error, setError] = useState('');

  // ── Load on open ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !platformKey) return;
    setLoading(true);
    setError('');

    Promise.all([
      getIntegrationSettings(platformKey).catch(() => null),
      getCatalogDepartments().catch(() => []),
    ]).then(([settings, depts]) => {
      const pc = settings?.pricingConfig || {};
      setConfig({
        markupPercent:        Number(pc.markupPercent || 0),
        categoryMarkups:      pc.categoryMarkups || {},
        roundingMode:         pc.roundingMode || 'none',
        inventorySyncEnabled: pc.inventorySyncEnabled !== false,
        syncMode:             pc.syncMode || 'all',
        excludedDepartmentIds: (pc.excludedDepartmentIds || []).map(String),
        excludedProductIds:    (pc.excludedProductIds || []).map(String),
        minMarginPercent:     Number(pc.minMarginPercent || 0),
        taxInclusive:         pc.taxInclusive === true,
        prepTimeMinutes:      Number(pc.prepTimeMinutes || 0),
      });
      const deptList = Array.isArray(depts) ? depts : depts?.departments || [];
      setDepts(deptList);
      // Pre-warm productLookup for already-excluded products
      const excludedIds = (pc.excludedProductIds || []).map(String);
      if (excludedIds.length > 0) {
        // We don't have a "get by ids" endpoint, so leave names blank — they'll fill in on search
        const lookup = {};
        for (const id of excludedIds) lookup[id] = `Product #${id}`;
        setProductLookup(lookup);
      }
    }).catch((err) => {
      setError(err?.response?.data?.error || 'Failed to load pricing config');
    }).finally(() => setLoading(false));
  }, [open, platformKey]);

  // ── Product search (debounced) ────────────────────────────────────────────
  useEffect(() => {
    if (!productSearch || productSearch.length < 2) { setProductResults([]); return; }
    const t = setTimeout(() => {
      searchCatalogProducts(productSearch, { limit: 10 })
        .then((data) => {
          const items = Array.isArray(data) ? data : data?.products || data?.data || [];
          setProductResults(items.slice(0, 10));
          // Update lookup for display
          const lookup = { ...productLookup };
          for (const p of items) lookup[String(p.id)] = p.name || `Product #${p.id}`;
          setProductLookup(lookup);
        })
        .catch(() => setProductResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [productSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Field setters ─────────────────────────────────────────────────────────
  const upd = useCallback((key, val) => setConfig((prev) => ({ ...prev, [key]: val })), []);

  const setCategoryMarkup = (deptId, val) => {
    const key = String(deptId);
    setConfig((prev) => {
      const next = { ...(prev.categoryMarkups || {}) };
      const n = Number(val);
      if (val === '' || val == null) delete next[key];
      else next[key] = Number.isFinite(n) ? n : 0;  // S71b — keep 0 when explicitly toggled on
      return { ...prev, categoryMarkups: next };
    });
  };

  /** S71b — explicit toggle: ON = override (with current or 0 value), OFF = inherit (delete key) */
  const toggleCategoryOverride = (deptId, on) => {
    const key = String(deptId);
    setConfig((prev) => {
      const next = { ...(prev.categoryMarkups || {}) };
      if (on) {
        // Default the override to the current global markup for clarity
        if (next[key] == null) next[key] = Number(prev.markupPercent) || 0;
      } else {
        delete next[key];
      }
      return { ...prev, categoryMarkups: next };
    });
  };

  const toggleExcludedDept = (deptId) => {
    const id = String(deptId);
    setConfig((prev) => {
      const arr = prev.excludedDepartmentIds || [];
      return {
        ...prev,
        excludedDepartmentIds: arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id],
      };
    });
  };

  const addExcludedProduct = (productId, name) => {
    const id = String(productId);
    setConfig((prev) => {
      const arr = prev.excludedProductIds || [];
      if (arr.includes(id)) return prev;
      return { ...prev, excludedProductIds: [...arr, id] };
    });
    if (name) setProductLookup((prev) => ({ ...prev, [id]: name }));
    setProductSearch('');
    setProductResults([]);
  };

  const removeExcludedProduct = (productId) => {
    const id = String(productId);
    setConfig((prev) => ({
      ...prev,
      excludedProductIds: (prev.excludedProductIds || []).filter((x) => x !== id),
    }));
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const buildPayload = () => ({
    pricingConfig: {
      markupPercent:         Number(config.markupPercent) || 0,
      categoryMarkups:       config.categoryMarkups || {},
      roundingMode:          config.roundingMode,
      inventorySyncEnabled:  !!config.inventorySyncEnabled,
      syncMode:              config.syncMode,
      excludedDepartmentIds: config.excludedDepartmentIds || [],
      excludedProductIds:    config.excludedProductIds || [],
      minMarginPercent:      Number(config.minMarginPercent) || 0,
      taxInclusive:          !!config.taxInclusive,
      prepTimeMinutes:       Number(config.prepTimeMinutes) || 0,
    },
  });

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await updateIntegrationSettings(platformKey, buildPayload());
      toast.success(`${platformMeta.name || platformKey} pricing saved`);
      onSaved && onSaved();
      onClose && onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save pricing config');
    } finally {
      setSaving(false);
    }
  };

  // S71b — Save then immediately push the new prices to the marketplace
  const [syncing, setSyncing] = useState(false);
  const handleSaveAndSync = async () => {
    if (!config) return;
    setSyncing(true);
    try {
      await updateIntegrationSettings(platformKey, buildPayload());
      const result = await syncIntegrationInventory({ platform: platformKey });
      const skipped = result?.skipped?.total || 0;
      const synced = result?.synced || 0;
      const skipDetail = skipped > 0 ? skipBreakdown(result.skipped) : '';
      toast.success(
        `${platformMeta.name || platformKey}: ${synced} synced` +
        (skipped > 0 ? ` · ${skipped} skipped (${skipDetail})` : ''),
      );
      onSaved && onSaved();
      onClose && onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save + sync');
    } finally {
      setSyncing(false);
    }
  };

  // S71b — Preview impact (dry-run with current edits, no save)
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const handlePreview = async () => {
    if (!config) return;
    setPreviewing(true);
    setPreview(null);
    try {
      const result = await previewIntegrationImpact({
        platform: platformKey,
        storeId:  platformMeta.storeId || undefined,  // backend uses X-Store-Id header
        pricingConfig: buildPayload().pricingConfig,
      });
      setPreview(result);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  // ── Live preview (uses current edits, not saved values) ───────────────────
  const previewRows = useMemo(() => {
    if (!config) return [];
    return PREVIEW_BASES.map((base) => {
      const marked = applyMarkupClient(base, config.markupPercent);
      const rounded = applyRoundingClient(marked, config.roundingMode);
      return { base, rounded, delta: rounded - base };
    });
  }, [config]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (!open) return null;

  return (
    <>
      <div className="mpd-backdrop" onClick={onClose} />
      <aside className="mpd-drawer" role="dialog" aria-label="Marketplace pricing">
        {/* Header */}
        <header className="mpd-header" style={{ borderTopColor: platformMeta.color || '#3d56b5' }}>
          <div className="mpd-header-left">
            <div className="mpd-platform-dot" style={{ background: platformMeta.color || '#3d56b5' }}>
              {platformMeta.initial || platformKey?.[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <div className="mpd-header-title">{platformMeta.name || platformKey}</div>
              <div className="mpd-header-sub">Pricing &amp; sync settings</div>
            </div>
          </div>
          <button className="mpd-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        {/* Body */}
        {loading ? (
          <div className="mpd-loading"><Loader2 size={20} /> Loading…</div>
        ) : error ? (
          <div className="mpd-error">{error}</div>
        ) : config && (
          <div className="mpd-body">
            {/* Live preview strip */}
            <div className="mpd-preview-card">
              <div className="mpd-section-title-row">
                <Sparkles size={14} />
                <span>Preview — your store price → {platformMeta.name || platformKey} price</span>
              </div>
              <div className="mpd-preview-grid">
                {previewRows.map((r) => (
                  <div key={r.base} className="mpd-preview-item">
                    <div className="mpd-preview-base">${r.base.toFixed(2)}</div>
                    <div className="mpd-preview-arrow">→</div>
                    <div className="mpd-preview-final">${r.rounded.toFixed(2)}</div>
                    {r.delta !== 0 && (
                      <div className={`mpd-preview-delta ${r.delta > 0 ? 'pos' : 'neg'}`}>
                        {r.delta > 0 ? '+' : ''}${r.delta.toFixed(2)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 1. Markup */}
            <Section icon={<DollarSign size={16} />} title="Markup">
              <p className="mpd-section-desc">
                Increase the price sent to {platformMeta.name || platformKey} to recover their commission.
                Common range: 10–25%.
              </p>
              <div className="mpd-field">
                <label>Global markup (%)</label>
                <MoneyInput
                  value={config.markupPercent}
                  onChange={(v) => upd('markupPercent', v)}
                  placeholder="0.00"
                  maxValue={1000}
                  minValue={-100}
                  className="mpd-input"
                />
              </div>

              {/* S71b — per-department overrides with explicit toggle */}
              {departments.length > 0 && (
                <details className="mpd-details">
                  <summary>
                    Per-department overrides
                    {' ('}
                    {Object.keys(config.categoryMarkups || {}).length}
                    {' of '}
                    {departments.length}
                    {' overridden)'}
                  </summary>
                  <div className="mpd-dept-table">
                    {departments.map((d) => {
                      const key = String(d.id);
                      const overridden = config.categoryMarkups?.[key] != null;
                      const value = overridden ? config.categoryMarkups[key] : '';
                      return (
                        <div key={d.id} className={`mpd-dept-row ${overridden ? 'mpd-dept-row--on' : ''}`}>
                          <label className="mpd-dept-toggle" title={overridden ? 'Click to inherit global' : 'Click to override'}>
                            <input
                              type="checkbox"
                              checked={overridden}
                              onChange={(e) => toggleCategoryOverride(d.id, e.target.checked)}
                            />
                            <span className="mpd-dept-toggle-slider" />
                          </label>
                          <span className="mpd-dept-name">{d.name}</span>
                          {overridden ? (
                            <>
                              <MoneyInput
                                value={value}
                                onChange={(v) => setCategoryMarkup(d.id, v)}
                                placeholder="0.00"
                                maxValue={1000}
                                minValue={-100}
                                className="mpd-input mpd-input-sm"
                              />
                              <span className="mpd-dept-suffix">%</span>
                            </>
                          ) : (
                            <span className="mpd-dept-inherit">
                              {Number(config.markupPercent || 0).toFixed(2)}% (global)
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </Section>

            {/* 2. Rounding */}
            <Section icon={<Sparkles size={16} />} title="Price rounding">
              <p className="mpd-section-desc">Make marked-up prices land on psychologically pleasant numbers.</p>
              <div className="mpd-radio-list">
                {ROUNDING_OPTIONS.map((opt) => (
                  <label key={opt.value} className={`mpd-radio ${config.roundingMode === opt.value ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="roundingMode"
                      value={opt.value}
                      checked={config.roundingMode === opt.value}
                      onChange={() => upd('roundingMode', opt.value)}
                    />
                    <div>
                      <div className="mpd-radio-label">{opt.label}</div>
                      <div className="mpd-radio-hint">{opt.hint}</div>
                    </div>
                  </label>
                ))}
              </div>
            </Section>

            {/* 3. Inventory Sync */}
            <Section icon={<Boxes size={16} />} title="Inventory sync">
              <div className="mpd-toggle-row">
                <div>
                  <div className="mpd-toggle-label">Sync inventory to this marketplace</div>
                  <div className="mpd-toggle-hint">When OFF, the marketplace keeps showing &quot;out of stock&quot; for everything.</div>
                </div>
                <label className="mpd-toggle">
                  <input
                    type="checkbox"
                    checked={!!config.inventorySyncEnabled}
                    onChange={(e) => upd('inventorySyncEnabled', e.target.checked)}
                  />
                  <span className="mpd-toggle-slider" />
                </label>
              </div>

              {config.inventorySyncEnabled && (
                <div className="mpd-field">
                  <label>What to sync</label>
                  <select
                    className="mpd-input"
                    value={config.syncMode}
                    onChange={(e) => upd('syncMode', e.target.value)}
                  >
                    {SYNC_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <div className="mpd-field-hint">
                    {SYNC_MODE_OPTIONS.find((o) => o.value === config.syncMode)?.hint}
                  </div>
                </div>
              )}
            </Section>

            {/* 4. Exclusions */}
            <Section icon={<Ban size={16} />} title="Exclusions">
              <p className="mpd-section-desc">
                Skip these from this marketplace entirely (e.g. tobacco / alcohol on platforms that don&apos;t allow them).
              </p>

              {departments.length > 0 && (
                <details className="mpd-details">
                  <summary>Excluded departments ({(config.excludedDepartmentIds || []).length})</summary>
                  <div className="mpd-checkbox-grid">
                    {departments.map((d) => (
                      <label key={d.id} className="mpd-checkbox">
                        <input
                          type="checkbox"
                          checked={(config.excludedDepartmentIds || []).includes(String(d.id))}
                          onChange={() => toggleExcludedDept(d.id)}
                        />
                        <span>{d.name}</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}

              <details className="mpd-details">
                <summary>Excluded products ({(config.excludedProductIds || []).length})</summary>

                {/* Search to add */}
                <div className="mpd-product-search">
                  <Search size={14} />
                  <input
                    type="text"
                    className="mpd-input"
                    placeholder="Search products to exclude…"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                </div>
                {productResults.length > 0 && (
                  <div className="mpd-product-results">
                    {productResults.map((p) => {
                      const id = String(p.id);
                      const already = (config.excludedProductIds || []).includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          className="mpd-product-result"
                          disabled={already}
                          onClick={() => addExcludedProduct(p.id, p.name)}
                        >
                          <Plus size={12} />
                          {p.name}
                          {already && <span className="mpd-already">already excluded</span>}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Currently excluded list */}
                {(config.excludedProductIds || []).length > 0 && (
                  <div className="mpd-excluded-list">
                    {config.excludedProductIds.map((id) => (
                      <div key={id} className="mpd-excluded-row">
                        <span>{productLookup[id] || `Product #${id}`}</span>
                        <button
                          type="button"
                          className="mpd-icon-btn mpd-icon-btn-danger"
                          onClick={() => removeExcludedProduct(id)}
                          aria-label="Remove"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </details>
            </Section>

            {/* 5. Margin Guard */}
            <Section icon={<ShieldCheck size={16} />} title="Min margin guard">
              <p className="mpd-section-desc">
                Refuse to sync if (marked-up price − cost) / marked-up price falls below this.
                Set to 0 to disable. Skipped when no cost data is available.
              </p>
              <div className="mpd-field">
                <label>Min margin (%)</label>
                <MoneyInput
                  value={config.minMarginPercent}
                  onChange={(v) => upd('minMarginPercent', v)}
                  placeholder="0.00"
                  maxValue={100}
                  minValue={0}
                  className="mpd-input"
                />
              </div>
            </Section>

            {/* 6. Misc */}
            <Section icon={<Settings2 size={16} />} title="Other">
              <div className="mpd-toggle-row">
                <div>
                  <div className="mpd-toggle-label">Tax-inclusive prices</div>
                  <div className="mpd-toggle-hint">Some marketplaces expect prices that already include sales tax.</div>
                </div>
                <label className="mpd-toggle">
                  <input
                    type="checkbox"
                    checked={!!config.taxInclusive}
                    onChange={(e) => upd('taxInclusive', e.target.checked)}
                  />
                  <span className="mpd-toggle-slider" />
                </label>
              </div>
              <div className="mpd-field">
                <label>Prep time (minutes)</label>
                <input
                  type="number"
                  min="0"
                  max="240"
                  step="1"
                  className="mpd-input"
                  value={config.prepTimeMinutes}
                  onChange={(e) => upd('prepTimeMinutes', Number(e.target.value) || 0)}
                />
                <div className="mpd-field-hint">How long this marketplace should quote for fulfillment.</div>
              </div>
            </Section>

            {/* S71b — Preview impact (dry-run) */}
            <Section icon={<Eye size={16} />} title="Preview impact">
              <p className="mpd-section-desc">
                Run the current settings against your full catalog without pushing.
                Shows how many products would sync vs be filtered out + 5 sample marked-up prices.
              </p>
              <button
                className="mpd-btn mpd-btn-ghost mpd-btn-block"
                onClick={handlePreview}
                disabled={previewing || loading}
              >
                {previewing ? <><Loader2 size={14} /> Computing…</> : <><Eye size={14} /> Preview impact</>}
              </button>

              {preview && (
                <div className="mpd-preview-result">
                  <div className="mpd-preview-stats">
                    <div className="mpd-preview-stat mpd-preview-stat--ok">
                      <div className="mpd-preview-stat-num">{preview.wouldSync}</div>
                      <div className="mpd-preview-stat-label">would sync</div>
                    </div>
                    <div className="mpd-preview-stat">
                      <div className="mpd-preview-stat-num">{preview.totalActive}</div>
                      <div className="mpd-preview-stat-label">active total</div>
                    </div>
                    {preview.skipped?.total > 0 && (
                      <div className="mpd-preview-stat mpd-preview-stat--warn">
                        <div className="mpd-preview-stat-num">{preview.skipped.total}</div>
                        <div className="mpd-preview-stat-label">skipped</div>
                      </div>
                    )}
                  </div>

                  {preview.skipped?.total > 0 && (
                    <div className="mpd-preview-skips">
                      <AlertTriangle size={13} />
                      <span>
                        Skipped: {skipBreakdown(preview.skipped)}
                      </span>
                    </div>
                  )}

                  {preview.sampleItems?.length > 0 && (
                    <details className="mpd-details" open>
                      <summary>Sample marked-up prices ({preview.sampleItems.length})</summary>
                      <div className="mpd-preview-samples">
                        {preview.sampleItems.map((s) => (
                          <div key={s.productId} className="mpd-preview-sample">
                            <span className="mpd-preview-sample-name" title={s.name}>
                              {s.name || `#${s.productId}`}
                            </span>
                            <span className="mpd-preview-sample-base">${s.basePrice.toFixed(2)}</span>
                            <span className="mpd-preview-arrow">→</span>
                            <span className="mpd-preview-sample-final">${s.marketPrice.toFixed(2)}</span>
                            <span className={`mpd-preview-delta ${s.delta >= 0 ? 'pos' : 'neg'}`}>
                              {s.delta >= 0 ? '+' : ''}{s.deltaPct.toFixed(1)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </Section>

            <div className="mpd-info-strip">
              <Info size={14} />
              <span>
                <strong>Save</strong> persists settings (next scheduled sync picks them up).
                <strong> Save &amp; Sync Now</strong> immediately pushes the new prices.
              </span>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mpd-footer">
          <button className="mpd-btn mpd-btn-ghost" onClick={onClose} disabled={saving || syncing}>Cancel</button>
          <button className="mpd-btn mpd-btn-secondary" onClick={handleSave} disabled={saving || syncing || loading || !config}>
            {saving ? <><Loader2 size={14} /> Saving…</> : <><Save size={14} /> Save</>}
          </button>
          <button className="mpd-btn mpd-btn-primary" onClick={handleSaveAndSync} disabled={saving || syncing || loading || !config}>
            {syncing ? <><Loader2 size={14} /> Syncing…</> : <><RefreshCw size={14} /> Save &amp; Sync Now</>}
          </button>
        </footer>
      </aside>
    </>
  );
}

// ── Section helper ──────────────────────────────────────────────────────────
function Section({ icon, title, children }) {
  return (
    <section className="mpd-section">
      <h3 className="mpd-section-title">
        {icon}
        <span>{title}</span>
      </h3>
      {children}
    </section>
  );
}
