/**
 * StoreSettings — Central hub for store-level configuration.
 * Manages: Vendor Payment Tender Methods (more sections to be added).
 * Stores config in store's POS JSON via /api/pos-terminal/config.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Settings2, Plus, Trash2, Save, Check, ChevronDown, Ticket, Fuel } from 'lucide-react';
import { toast } from 'react-toastify';
import { getStores, getPOSConfig, updatePOSConfig, getFuelSettings, updateFuelSettings } from '../services/api.js';

import './StoreSettings.css';

const DEFAULT_TENDER_METHODS = [
  { id: 'cash',          label: 'Cash',              enabled: true  },
  { id: 'cheque',        label: 'Cheque',             enabled: true  },
  { id: 'bank_transfer', label: 'Bank Transfer',      enabled: false },
  { id: 'credit_card',   label: 'Credit Card',        enabled: false },
  { id: 'interac',       label: 'Interac e-Transfer', enabled: false },
];

export default function StoreSettings({ embedded }) {
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

  // Load stores
  useEffect(() => {
    getStores().then(r => {
      const list = Array.isArray(r) ? r : (r?.stores || r?.data || []);
      setStores(list);
      if (!storeId && list.length > 0) setStoreId(list[0].id);
    }).catch(() => {});
  }, []);

  // Load config when storeId changes.
  // Lottery enablement lives in the POS config (store.pos JSON) alongside the
  // rest of the store-level toggles. Fuel enablement lives on its own row in
  // the FuelSettings table — so we load both in parallel.
  const loadConfig = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const [cfg, fuelCfg] = await Promise.all([
        getPOSConfig(storeId),
        getFuelSettings(storeId).catch(() => null),
      ]);
      setRawConfig(cfg);
      setTenderMethods(cfg.vendorTenderMethods || DEFAULT_TENDER_METHODS);
      setGroceryEnabled(cfg.groceryEnabled ?? false);
      setEcomEnabled(cfg.ecomEnabled ?? false);
      setLotteryEnabled(cfg.lottery?.enabled ?? true);
      setFuelEnabled(fuelCfg?.enabled ?? false);
      if (cfg.groceryConfig) setGroceryConfig(prev => ({ ...prev, ...cfg.groceryConfig }));
      if (cfg.ageLimits) setAgeLimits(prev => ({ ...prev, ...cfg.ageLimits }));
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
      });
      // Fuel-settings write: dedicated FuelSettings table row.
      const fuelSave = updateFuelSettings({ storeId, enabled: fuelEnabled }).catch(err => {
        // Don't block the rest of the save if fuel is first-time — worker
        // upserts on write so the first save always succeeds.
        console.warn('updateFuelSettings:', err?.response?.data?.error || err.message);
      });
      await Promise.all([posSave, fuelSave]);
      setDirty(false);
      setSaved(true);
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
              {/* Grocery / Scale */}
              <div className="ss-tender-item">
                <div className="ss-tender-info">
                  <span className="ss-tender-label">Enable Grocery & Scale Features</span>
                  <span className="ss-tender-sub">
                    Scale products, tare weights, ingredients, nutrition facts, WIC, PLU types
                  </span>
                </div>
                <label className="ss-toggle">
                  <input type="checkbox" checked={groceryEnabled} onChange={() => { setGroceryEnabled(!groceryEnabled); markDirty(); }} />
                  <span className="ss-toggle-slider" />
                </label>
              </div>

              {/* Grocery sub-settings (only when enabled) */}
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
                      <input className="ss-add-input" style={{ width: '100%' }} type="number" step="0.01" value={groceryConfig.tareWeightDefault} onChange={e => setGC('tareWeightDefault', e.target.value)} placeholder="0.00" />
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

              {/* E-Commerce */}
              <div className="ss-tender-item">
                <div className="ss-tender-info">
                  <span className="ss-tender-label">Enable E-Commerce Module</span>
                  <span className="ss-tender-sub">
                    Online store pricing, sale prices, pack weights, external platform IDs
                  </span>
                </div>
                <label className="ss-toggle">
                  <input type="checkbox" checked={ecomEnabled} onChange={() => { setEcomEnabled(!ecomEnabled); markDirty(); }} />
                  <span className="ss-toggle-slider" />
                </label>
              </div>

              {/* Lottery */}
              <div className="ss-tender-item">
                <div className="ss-tender-info">
                  <span className="ss-tender-label">
                    <Ticket size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
                    Enable Lottery Module
                  </span>
                  <span className="ss-tender-sub">
                    Ticket sales & payouts at the POS, inventory management, shift reconciliation, and commission reports. When disabled, the Lottery button in the cashier app and the Lottery page in the portal are hidden.
                  </span>
                </div>
                <label className="ss-toggle">
                  <input type="checkbox" checked={lotteryEnabled} onChange={() => { setLotteryEnabled(!lotteryEnabled); markDirty(); }} />
                  <span className="ss-toggle-slider" />
                </label>
              </div>

              {/* Fuel */}
              <div className="ss-tender-item">
                <div className="ss-tender-info">
                  <span className="ss-tender-label">
                    <Fuel size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
                    Enable Fuel Module
                  </span>
                  <span className="ss-tender-sub">
                    Fuel grades, pump pricing, pre-authorised pump sales, and end-of-day fuel reports. When disabled, the Fuel button in the cashier app and the Fuel page in the portal are hidden.
                  </span>
                </div>
                <label className="ss-toggle">
                  <input type="checkbox" checked={fuelEnabled} onChange={() => { setFuelEnabled(!fuelEnabled); markDirty(); }} />
                  <span className="ss-toggle-slider" />
                </label>
              </div>
            </div>
          </div>

          {/* ── Section: Age Verification Policy (Tobacco / Alcohol) ── */}
          <div className="ss-section">
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
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={ageLimits.tobacco}
                    onChange={e => setAge('tobacco', e.target.value)}
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
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={ageLimits.alcohol}
                    onChange={e => setAge('alcohol', e.target.value)}
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
