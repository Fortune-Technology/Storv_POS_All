/**
 * StoreSettings — Central hub for store-level configuration.
 * Manages: Vendor Payment Tender Methods (more sections to be added).
 * Stores config in store's POS JSON via /api/pos-terminal/config.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Settings2, Plus, Trash2, Save, Check, ChevronDown, Ticket, Fuel, MapPin, Wand2 } from 'lucide-react';
import { toast } from 'react-toastify';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import {
  getStores, getPOSConfig, updatePOSConfig, getFuelSettings, updateFuelSettings,
  listStatesPublic, setStoreStateCode, applyStoreStateDefaults,
  getStoreFeatureModules, updateStoreFeatureModules,
  // Session C: lottery sellDirection + cashOnly + scanRequired moved to
  // Lottery > Settings tab. Master enable/disable lives in store.pos JSON
  // and is written via updatePOSConfig — no direct LotterySettings RPC here.
} from '../services/api.js';
import { MoneyInput, CountInput } from '../components/NumericInputs';
import usePlanModules from '../hooks/usePlanModules.js';

import './StoreSettings.css';

const DEFAULT_TENDER_METHODS = [
  { id: 'cash',          label: 'Cash',              enabled: true  },
  { id: 'cheque',        label: 'Cheque',             enabled: true  },
  { id: 'bank_transfer', label: 'Bank Transfer',      enabled: false },
  { id: 'credit_card',   label: 'Credit Card',        enabled: false },
  { id: 'interac',       label: 'Interac e-Transfer', enabled: false },
];

export default function StoreSettings({ embedded }) {
  const confirm = useConfirm();
  const user    = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
  const [stores,      setStores]      = useState([]);
  const [storeId,     setStoreId]     = useState(localStorage.getItem('activeStoreId') || '');
  const [loading,     setLoading]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [dirty,       setDirty]       = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [rawConfig,   setRawConfig]   = useState({});

  // Tender method state
  const [tenderMethods, setTenderMethods] = useState(DEFAULT_TENDER_METHODS);
  const [newTender,     setNewTender]     = useState('');

  // Feature toggles
  const [groceryEnabled, setGroceryEnabled] = useState(false);
  const [ecomEnabled,    setEcomEnabled]    = useState(false);
  const [lotteryEnabled, setLotteryEnabled] = useState(true);
  const [fuelEnabled,    setFuelEnabled]    = useState(false);

  // S80 Phase 3 — per-store overrides keyed by BUSINESS MODULE key only.
  // Each toggle controls one parent business module; sidebar children
  // (e.g. ecom_setup, ecom_orders) cascade automatically via parentKey.
  const [featureModules, setFeatureModules] = useState({});
  const { businessModules, refresh: refreshEntitlements } = usePlanModules();

  // Grocery settings (only relevant when groceryEnabled)
  const [groceryConfig, setGroceryConfig] = useState({
    scaleWeightUnit: 'lbs',       // 'lbs' | 'kg'
    defaultScaleType: 'weight',   // 'weight' | 'count'
    pluFormat: 'standard',        // 'standard' | 'upc-prefix'
    tareWeightDefault: '0.00',
    requireIngredients: false,
    requireNutrition: false,
  });
  const setGC = (k, v) => { setGroceryConfig(prev => ({ ...prev, [k]: v })); markDirty(); };

  // Age verification limits — store-level overrides for tobacco + alcohol items.
  // State/province laws differ (US: tobacco 21, alcohol 21; Canada Ontario: 19).
  const [ageLimits, setAgeLimits] = useState({ tobacco: 21, alcohol: 21 });
  const setAge = (k, v) => {
    setAgeLimits(prev => ({ ...prev, [k]: v === '' ? '' : Math.max(0, Math.min(99, parseInt(v, 10) || 0)) }));
    markDirty();
  };

  // Session 52 — Dual Pricing read-only mirror + refund-surcharge policy
  // toggle. The pricing model itself is superadmin-only (changes the merchant
  // processor setup). Managers can flip the refund-surcharge policy here
  // since it's operational, not pricing-model authority.
  const [dualPricingMirror, setDualPricingMirror] = useState(null);
  const [refundSurcharge,   setRefundSurcharge]   = useState(false);

  // ── State (US state catalog for auto-populate defaults) ──
  const [states,       setStates]       = useState([]);
  const [stateCode,    setStateCode]    = useState('');
  const [stateDirty,   setStateDirty]   = useState(false);
  const [applying,     setApplying]     = useState(false);

  // Lottery sellDirection + cashOnly + scanRequired moved to Lottery > Settings
  // tab in Session C. The master enable toggle below still writes to
  // store.pos.lottery.enabled via updatePOSConfig (single source of truth).

  // Load stores + state catalog
  useEffect(() => {
    getStores().then(r => {
      const list = Array.isArray(r) ? r : (r?.stores || r?.data || []);
      setStores(list);
      if (!storeId && list.length > 0) setStoreId(list[0].id);
    }).catch(() => {});
    listStatesPublic().then(r => {
      setStates(r.states || []);
    }).catch(() => {});
  }, []);

  // Sync stateCode selection when storeId changes (pulls from the Store record).
  useEffect(() => {
    if (!storeId || !stores.length) return;
    const current = stores.find(s => s.id === storeId);
    setStateCode(current?.stateCode || '');
    setStateDirty(false);
  }, [storeId, stores]);

  // (LotterySettings load + save moved to Lottery > Settings tab — Session C.)

  const saveStateCode = async () => {
    if (!storeId) return;
    try {
      await setStoreStateCode(storeId, stateCode || null);
      toast.success(stateCode ? 'State saved' : 'State cleared');
      setStateDirty(false);
      // Refresh store list so the new stateCode is reflected
      const r = await getStores();
      const list = Array.isArray(r) ? r : (r?.stores || r?.data || []);
      setStores(list);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save state');
    }
  };

  const applyDefaults = async () => {
    if (!storeId || !stateCode) return;
    if (!await confirm({
      title: 'Apply state defaults?',
      message: `Apply ${states.find(s => s.code === stateCode)?.name || stateCode} defaults to this store? ` +
        `This will overwrite the Default Sales Tax rule, bottle-deposit rules for this state, ` +
        `lottery settings (state + commission), and tobacco/alcohol age limits.`,
      confirmLabel: 'Apply Defaults',
      danger: true,
    })) return;
    setApplying(true);
    try {
      const res = await applyStoreStateDefaults(storeId);
      const bits = [];
      if (res.applied?.taxRate != null) bits.push(`tax rate ${(res.applied.taxRate * 100).toFixed(2)}%`);
      if (res.applied?.depositRules) bits.push(`${res.applied.depositRules} deposit rule(s)`);
      if (res.applied?.lotteryState) bits.push(`lottery (${res.applied.lotteryState})`);
      if (res.applied?.ageLimits) bits.push(`age limits`);
      toast.success(`Applied: ${bits.join(', ') || 'no changes'}`);
      loadConfig();  // refresh the UI with new defaults
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to apply defaults');
    } finally { setApplying(false); }
  };

  // Load config when storeId changes.
  // Lottery enablement lives in the POS config (store.pos JSON) alongside the
  // rest of the store-level toggles. Fuel enablement lives on its own row in
  // the FuelSettings table — so we load both in parallel.
  const loadConfig = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const [cfg, fuelCfg, fmRes] = await Promise.all([
        getPOSConfig(storeId),
        getFuelSettings(storeId).catch(() => null),
        getStoreFeatureModules(storeId).catch(() => ({ featureModules: {} })),
      ]);
      setRawConfig(cfg);
      setTenderMethods(cfg.vendorTenderMethods || DEFAULT_TENDER_METHODS);
      setGroceryEnabled(cfg.groceryEnabled ?? false);
      setEcomEnabled(cfg.ecomEnabled ?? false);
      setLotteryEnabled(cfg.lottery?.enabled ?? true);
      setFuelEnabled(fuelCfg?.enabled ?? false);
      setFeatureModules(fmRes?.featureModules || {});
      if (cfg.groceryConfig) setGroceryConfig(prev => ({ ...prev, ...cfg.groceryConfig }));
      if (cfg.ageLimits) setAgeLimits(prev => ({ ...prev, ...cfg.ageLimits }));
      // Session 52 — Dual Pricing config (read-only mirror + refund toggle)
      setDualPricingMirror(cfg.dualPricing || null);
      setRefundSurcharge(!!cfg.dualPricing?.refundSurcharge);
      setDirty(false);
    } catch {
      setTenderMethods(DEFAULT_TENDER_METHODS);
    } finally { setLoading(false); }
  }, [storeId]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const markDirty = () => { setDirty(true); setSaved(false); };

  const toggleTender = (id) => {
    setTenderMethods(prev => prev.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t));
    markDirty();
  };

  const removeTender = (id) => {
    setTenderMethods(prev => prev.filter(t => t.id !== id));
    markDirty();
  };

  const addCustomTender = () => {
    const label = newTender.trim();
    if (!label) return;
    const id = 'custom_' + label.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
    setTenderMethods(prev => [...prev, { id, label, enabled: true }]);
    setNewTender('');
    markDirty();
  };

  const handleSave = async () => {
    if (!storeId) { toast.error('Select a store first'); return; }
    setSaving(true);
    try {
      // POS-config write: carries lottery.enabled alongside the rest of
      // the store-scoped JSON. Spread `rawConfig.lottery` first so we keep
      // sibling keys (cashOnly, scanRequiredAtShiftEnd) intact.
      const posSave = updatePOSConfig({
        storeId,
        config: {
          ...rawConfig,
          vendorTenderMethods: tenderMethods,
          groceryEnabled,
          ecomEnabled,
          groceryConfig,
          ageLimits,
          lottery: { ...(rawConfig.lottery || {}), enabled: lotteryEnabled },
        },
        // Session 52 — refundSurcharge toggle (manager-editable, savePOSConfig
        // accepts it as a top-level body field and writes Store.refundSurcharge)
        refundSurcharge,
      });
      // Fuel-settings write: dedicated FuelSettings table row.
      const fuelSave = updateFuelSettings({ storeId, enabled: fuelEnabled }).catch(err => {
        // Don't block the rest of the save if fuel is first-time — worker
        // upserts on write so the first save always succeeds.
        console.warn('updateFuelSettings:', err?.response?.data?.error || err.message);
      });
      // S80 — per-store module overrides save
      const fmSave = updateStoreFeatureModules(storeId, featureModules).catch(err => {
        console.warn('updateStoreFeatureModules:', err?.response?.data?.error || err.message);
      });
      await Promise.all([posSave, fuelSave, fmSave]);
      setDirty(false);
      setSaved(true);
      // Tell every mounted useStoreModules() consumer (Sidebar in particular)
      // to refetch immediately so module-gated nav items show/hide without a
      // page reload after the user toggles the feature flags.
      window.dispatchEvent(new CustomEvent('storv:modules-changed', { detail: { storeId } }));
      // Bust the entitlements cache so <Gate> components re-render with new overrides
      window.dispatchEvent(new CustomEvent('storv:plan-change', { detail: { storeId } }));
      try { refreshEntitlements?.(); } catch { /* swallow */ }
      toast.success('Store settings saved');
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save settings');
    } finally { setSaving(false); }
  };

  const content = (
    <>
        <div className="ss-page">

          {/* Header */}
          <div className="ss-header">
            <div className="ss-header-left">
              <div className="ss-header-icon">
                <Settings2 size={18} color="#14b8a6" />
              </div>
              <div>
                <h1>Store Settings</h1>
                <p>Configure store-level options for payments, operations, and more</p>
              </div>
            </div>
          </div>

          {/* Store selector */}
          <div className="ss-store-bar">
            <span className="ss-store-label">Store</span>
            <div style={{ position: 'relative' }}>
              <select
                className="ss-store-select"
                value={storeId}
                onChange={e => setStoreId(e.target.value)}
              >
                <option value="">— Select Store —</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
            {loading && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading…</span>}
          </div>

          {/* ── Section: State (auto-populate defaults) ── */}
          <div className="ss-section">
            <div className="ss-section-title">
              <MapPin size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              State
            </div>
            <div className="ss-section-desc">
              Selecting a state lets you apply the platform-curated defaults for sales tax, bottle-deposit rules, tobacco/alcohol age limits, and lottery commission in one click. You can still edit each of those settings manually afterwards.
            </div>

            <div className="ss-state-row">
              <div className="ss-state-select-wrap">
                <select
                  className="ss-store-select"
                  value={stateCode}
                  onChange={e => { setStateCode(e.target.value); setStateDirty(true); }}
                  disabled={!storeId}
                >
                  <option value="">— No state —</option>
                  {states.map(s => (
                    <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="ss-state-chev" />
              </div>

              <button
                className="ss-btn-primary"
                onClick={saveStateCode}
                disabled={!stateDirty || !storeId}
                title={stateDirty ? 'Save state selection' : 'No change'}
              >
                <Save size={13} /> Save
              </button>

              <button
                className="ss-btn-secondary"
                onClick={applyDefaults}
                disabled={!stateCode || applying || stateDirty || !storeId}
                title={stateDirty ? 'Save the state selection first' : 'Overwrite tax / deposit / lottery / age defaults from this state'}
              >
                <Wand2 size={13} /> {applying ? 'Applying…' : 'Apply State Defaults'}
              </button>
            </div>

            {stateCode && (() => {
              const s = states.find(x => x.code === stateCode);
              if (!s) return null;
              return (
                <div className="ss-state-preview">
                  <div><strong>{s.name}</strong> defaults:</div>
                  <div>Sales tax: {s.defaultTaxRate != null ? `${(Number(s.defaultTaxRate) * 100).toFixed(2)}%` : '—'}</div>
                  <div>Lottery comm: {s.defaultLotteryCommission != null ? `${(Number(s.defaultLotteryCommission) * 100).toFixed(2)}%` : '—'}</div>
                  <div>Alcohol {s.alcoholAgeLimit}+, Tobacco {s.tobaccoAgeLimit}+</div>
                  <div>{(s.bottleDepositRules || []).length} bottle-deposit rule(s)</div>
                </div>
              );
            })()}
          </div>

          {/* Lottery section moved to Lottery > Settings tab in Session C.
              The master enable/disable toggle for the Lottery module remains
              in the "Modules" row below (writes to store.pos.lottery.enabled).
              Per-store lottery configs (sellDirection, cashOnly, scanRequired)
              are managed in the Lottery page's Settings tab. State + commission
              rate are inherited automatically from Account → State + the
              platform State catalog. */}

          {/* ── Session 52 — Payment Pricing Model (read-only mirror) ── */}
          {/* Always rendered so the manager can see the active config; the
              actual model toggle is superadmin-only via the admin-app. The
              ONE editable field here is refund-surcharge policy — that's
              operational, not pricing-model authority. */}
          <div className="ss-section">
            <div className="ss-section-title">Payment Pricing Model</div>
            <div className="ss-section-desc">
              {dualPricingMirror?.pricingModel === 'dual_pricing' ? (
                <>
                  This store runs the <strong>{dualPricingMirror?.state?.pricingFraming === 'cash_discount' ? 'Cash Discount' : 'Dual Pricing'}</strong>{' '}
                  model. Card and debit transactions add a surcharge; cash and EBT pay base price.
                </>
              ) : (
                <>This store runs the <strong>Interchange</strong> (standard) model. Contact your account manager to enable dual pricing.</>
              )}
            </div>

            <div className="ss-dp-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
              <div className="ss-dp-cell" style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 8 }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>MODEL</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {dualPricingMirror?.pricingModel === 'dual_pricing' ? 'Dual Pricing' : 'Interchange'}
                </div>
              </div>
              {dualPricingMirror?.pricingModel === 'dual_pricing' && (
                <div className="ss-dp-cell" style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 8 }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>SURCHARGE RATE</div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {(() => {
                      const tier = dualPricingMirror.pricingTier;
                      const customPct = dualPricingMirror.customSurchargePercent;
                      const customFee = dualPricingMirror.customSurchargeFixedFee;
                      if (customPct != null && customFee != null) {
                        return `${Number(customPct).toFixed(2)}% + $${Number(customFee).toFixed(2)} (custom)`;
                      }
                      if (tier) {
                        return `${Number(tier.surchargePercent).toFixed(2)}% + $${Number(tier.surchargeFixedFee).toFixed(2)} (${tier.name})`;
                      }
                      return '— (no rate configured)';
                    })()}
                  </div>
                </div>
              )}
              {dualPricingMirror?.state && (
                <>
                  <div className="ss-dp-cell" style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 8 }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>STATE POLICY</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {dualPricingMirror.state.code}
                      {dualPricingMirror.state.surchargeTaxable && ' · taxable'}
                      {!dualPricingMirror.state.dualPricingAllowed && ' · cash-discount only'}
                    </div>
                  </div>
                  {dualPricingMirror.state.maxSurchargePercent != null && (
                    <div className="ss-dp-cell" style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 8 }}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>STATE CAP</div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {Number(dualPricingMirror.state.maxSurchargePercent).toFixed(2)}% maximum
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {dualPricingMirror?.pricingModel === 'dual_pricing' && (
              <>
                <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(99, 102, 241, 0.06)', border: '1px solid rgba(99, 102, 241, 0.2)', borderRadius: 8 }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>RECEIPT DISCLOSURE</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.5, fontStyle: 'italic' }}>
                    {dualPricingMirror.dualPricingDisclosure
                      || dualPricingMirror.state?.surchargeDisclosureText
                      || 'A cash discount is available on this transaction. Credit and debit transactions include a processing fee.'}
                  </div>
                </div>

                {/* The ONE editable toggle on this card — refund-surcharge policy */}
                <div className="ss-tender-item" style={{ marginTop: 14 }}>
                  <div className="ss-tender-info">
                    <span className="ss-tender-label">Refund includes surcharge</span>
                    <span className="ss-tender-sub">
                      When ON, a refund of a card transaction returns the original surcharge proportionally.
                      When OFF (default), only the principal is refunded — surcharge stays with the merchant.
                    </span>
                  </div>
                  <label className="ss-toggle">
                    <input
                      type="checkbox"
                      checked={refundSurcharge}
                      onChange={(e) => { setRefundSurcharge(e.target.checked); markDirty(); }}
                    />
                    <span className="ss-toggle-slider" />
                  </label>
                </div>
              </>
            )}
          </div>

          {/* ── Section: Vendor Payment Tender Methods ── */}
          <div className="ss-section">
            <div className="ss-section-title">Vendor Payment Tender Methods</div>
            <div className="ss-section-desc">
              Select which payment methods cashiers and back-office staff can choose when recording a vendor payout. Disabled methods are hidden from the payout form.
            </div>

            <div className="ss-tender-list">
              {tenderMethods.map(t => (
                <div key={t.id} className="ss-tender-item">
                  <div className="ss-tender-info">
                    <span className="ss-tender-label">{t.label}</span>
                    {t.id.startsWith('custom_') && (
                      <span className="ss-tender-sub">Custom method</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <label className="ss-toggle">
                      <input
                        type="checkbox"
                        checked={t.enabled}
                        onChange={() => toggleTender(t.id)}
                      />
                      <span className="ss-toggle-slider" />
                    </label>
                    {t.id.startsWith('custom_') && (
                      <button className="ss-btn-remove" onClick={() => removeTender(t.id)} title="Remove">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add custom tender */}
            <div className="ss-add-tender">
              <input
                className="ss-add-input"
                placeholder="Add custom method (e.g. Wire Transfer)…"
                value={newTender}
                onChange={e => setNewTender(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustomTender()}
              />
              <button className="ss-btn-add" onClick={addCustomTender}>
                <Plus size={14} /> Add
              </button>
            </div>
          </div>

          {/* ── Section: Store Feature Modules ── */}
          <div className="ss-section">
            <div className="ss-section-title">Store Feature Modules</div>
            <div className="ss-section-desc">
              Enable or disable feature modules for this store. Disabled modules hide related UI sections from the product form and POS.
            </div>

            <div className="ss-tender-list">
              {/* S80 Phase 3 — Grocery toggle is now part of the dynamic
                  business-modules list below (12+1 = 13 add-ons including
                  grocery). The legacy `groceryEnabled` flag stays as the
                  source of truth for the sub-config block (scale weight unit,
                  PLU format, etc.) — mirrored on save for back-compat with
                  cashier-app readers. */}

              {/* Grocery sub-settings (only when enabled — hidden when grocery
                  business-module is off OR not subscribed) */}
              {groceryEnabled && (
                <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-tertiary)', borderRadius: 8, margin: '0 0 0.5rem' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem' }}>
                    Scale & Grocery Configuration
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.6rem' }}>
                    <div>
                      <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Weight Unit</label>
                      <select className="ss-add-input" style={{ width: '100%' }} value={groceryConfig.scaleWeightUnit} onChange={e => setGC('scaleWeightUnit', e.target.value)}>
                        <option value="lbs">Pounds (lbs)</option>
                        <option value="kg">Kilograms (kg)</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Default Scale Type</label>
                      <select className="ss-add-input" style={{ width: '100%' }} value={groceryConfig.defaultScaleType} onChange={e => setGC('defaultScaleType', e.target.value)}>
                        <option value="weight">By Weight</option>
                        <option value="count">By Count</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>PLU Format</label>
                      <select className="ss-add-input" style={{ width: '100%' }} value={groceryConfig.pluFormat} onChange={e => setGC('pluFormat', e.target.value)}>
                        <option value="standard">Standard (4-5 digit)</option>
                        <option value="upc-prefix">UPC with prefix (02xxxxx)</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Default Tare Weight</label>
                      <MoneyInput className="ss-add-input" style={{ width: '100%' }} value={groceryConfig.tareWeightDefault} onChange={(v) => setGC('tareWeightDefault', v)} placeholder="0.00" />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={groceryConfig.requireIngredients} onChange={e => setGC('requireIngredients', e.target.checked)} style={{ accentColor: 'var(--accent-primary)' }} />
                      Require ingredients for scale items
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={groceryConfig.requireNutrition} onChange={e => setGC('requireNutrition', e.target.checked)} style={{ accentColor: 'var(--accent-primary)' }} />
                      Require nutrition facts
                    </label>
                  </div>
                </div>
              )}

              {/* S80 Phase 3 — Grouped business-module toggles.
                  One row per BUSINESS MODULE only (12 max). When admin toggles
                  off "E-Commerce", all 3 sidebar items under it (Store Setup /
                  Online Orders / eCom Analytics) hide automatically via the
                  parentKey cascade. No more confusing per-sidebar-item toggles.
                  Pro plan = all 12 visible. Starter = only purchased addons. */}
              {(() => {
                const toggleable = (businessModules || []).filter(m => m.active !== false);

                if (toggleable.length === 0) {
                  return (
                    <div style={{ padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      No add-on modules subscribed yet. Visit{' '}
                      <a href="/portal/billing" style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>Billing &amp; Plan</a>{' '}
                      to add Lottery, Fuel, E-Commerce, and other features.
                    </div>
                  );
                }

                return toggleable.map(m => {
                  const enabled = featureModules[m.key] !== false;
                  return (
                    <div className="ss-tender-item" key={m.key}>
                      <div className="ss-tender-info">
                        <span className="ss-tender-label">Enable {m.name}</span>
                        {m.description && <span className="ss-tender-sub">{m.description}</span>}
                      </div>
                      <label className="ss-toggle">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={() => {
                            setFeatureModules(prev => ({ ...prev, [m.key]: !enabled }));
                            // Mirror to legacy locations for transition. Retired in Phase 3b.
                            if (m.key === 'lottery')   setLotteryEnabled(!enabled);
                            if (m.key === 'fuel')      setFuelEnabled(!enabled);
                            if (m.key === 'ecommerce') setEcomEnabled(!enabled);
                            if (m.key === 'grocery')   setGroceryEnabled(!enabled);
                            markDirty();
                          }}
                        />
                        <span className="ss-toggle-slider" />
                      </label>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* ── Section: Age Verification Policy (Tobacco / Alcohol) ── */}
          <div className="ss-section" data-tour="age-verification-section">
            <div className="ss-section-title">Age Verification Policy</div>
            <div className="ss-section-desc">
              Set the minimum age required to purchase tobacco and alcohol items at this store.
              Laws differ by state/province (US: tobacco 21, alcohol 21; ON: 19; AB/QC/MB: 18).
              These overrides apply to any product with the matching tax class — overriding
              per-product age settings — so cashiers always enforce the store-wide policy.
            </div>

            <div className="ss-age-grid">
              <div className="ss-age-card">
                <div className="ss-age-label">
                  <span className="ss-age-tag ss-age-tag--tobacco">TOBACCO</span>
                  <span>Minimum Age</span>
                </div>
                <div className="ss-age-input-wrap">
                  <CountInput
                    min={0}
                    max={99}
                    value={ageLimits.tobacco}
                    onChange={(v) => setAge('tobacco', v)}
                    className="ss-age-input"
                  />
                  <span className="ss-age-suffix">+</span>
                </div>
                <div className="ss-age-hint">Common: 18, 19, or 21</div>
              </div>

              <div className="ss-age-card">
                <div className="ss-age-label">
                  <span className="ss-age-tag ss-age-tag--alcohol">ALCOHOL</span>
                  <span>Minimum Age</span>
                </div>
                <div className="ss-age-input-wrap">
                  <CountInput
                    min={0}
                    max={99}
                    value={ageLimits.alcohol}
                    onChange={(v) => setAge('alcohol', v)}
                    className="ss-age-input"
                  />
                  <span className="ss-age-suffix">+</span>
                </div>
                <div className="ss-age-hint">Common: 18, 19, or 21</div>
              </div>
            </div>
          </div>

          {/* Save bar */}
          <div className="ss-save-bar">
            {saved && (
              <div className="ss-success-msg">
                <Check size={15} /> Settings saved
              </div>
            )}
            <button className="ss-btn-save" onClick={handleSave} disabled={saving || !dirty}>
              {saving ? 'Saving…' : <><Save size={15} /> Save Changes{dirty ? <span className="ss-unsaved-dot" /> : ''}</>}
            </button>
          </div>

        </div>
    </>
  );

  if (embedded) return <div className="p-tab-content">{content}</div>;

  return (
      <div className="p-page">
        {content}
      </div>
  );
}
