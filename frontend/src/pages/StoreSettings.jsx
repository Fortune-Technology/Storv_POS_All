/**
 * StoreSettings — Central hub for store-level configuration.
 * Manages: Vendor Payment Tender Methods (more sections to be added).
 * Stores config in store's POS JSON via /api/pos-terminal/config.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Settings2, Plus, Trash2, Save, Check, ChevronDown } from 'lucide-react';
import { toast } from 'react-toastify';
import { getStores, getPOSConfig, updatePOSConfig } from '../services/api.js';

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

  // Load stores
  useEffect(() => {
    getStores().then(r => {
      const list = Array.isArray(r) ? r : (r?.stores || r?.data || []);
      setStores(list);
      if (!storeId && list.length > 0) setStoreId(list[0].id);
    }).catch(() => {});
  }, []);

  // Load config when storeId changes
  const loadConfig = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const cfg = await getPOSConfig(storeId);
      setRawConfig(cfg);
      setTenderMethods(cfg.vendorTenderMethods || DEFAULT_TENDER_METHODS);
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
      await updatePOSConfig({ storeId, ...rawConfig, vendorTenderMethods: tenderMethods });
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
