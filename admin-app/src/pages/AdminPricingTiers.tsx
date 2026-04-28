/**
 * AdminPricingTiers.tsx — Session 50.
 *
 * Catalog of surcharge rate tiers (Standard / Volume / Enterprise / etc.)
 * referenced by the per-store Payment Models page. Superadmin-only CRUD.
 *
 * Shares CSS with AdminPaymentModels.css (apt- prefix).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Percent, Plus, Edit3, Trash2, RefreshCw, X, Save, AlertTriangle,
} from 'lucide-react';
import { toast } from 'react-toastify';
import {
  listPricingTiers,
  createPricingTier,
  updatePricingTier,
  deletePricingTier,
  type PricingTier,
} from '../services/api';
import './AdminPaymentModels.css';

interface TierForm {
  key:               string;
  name:              string;
  description:       string;
  surchargePercent:  string;
  surchargeFixedFee: string;
  sortOrder:         string;
  active:            boolean;
  isDefault:         boolean;
}

const BLANK: TierForm = {
  key: '',
  name: '',
  description: '',
  surchargePercent: '3.000',
  surchargeFixedFee: '0.30',
  sortOrder: '1',
  active: true,
  isDefault: false,
};

type ModalMode = 'create' | 'edit' | null;

export default function AdminPricingTiers() {
  const [tiers,    setTiers]    = useState<PricingTier[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState<ModalMode>(null);
  const [editing,  setEditing]  = useState<PricingTier | null>(null);
  const [form,     setForm]     = useState<TierForm>(BLANK);
  const [saving,   setSaving]   = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listPricingTiers();
      setTiers(r.tiers || []);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to load tiers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const sortedTiers = useMemo(() => {
    return [...tiers].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [tiers]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...BLANK, sortOrder: String((tiers.length || 0) + 1) });
    setModal('create');
  };
  const openEdit = (t: PricingTier) => {
    setEditing(t);
    setForm({
      key:               t.key,
      name:              t.name,
      description:       t.description || '',
      surchargePercent:  String(t.surchargePercent ?? ''),
      surchargeFixedFee: String(t.surchargeFixedFee ?? ''),
      sortOrder:         String(t.sortOrder ?? 0),
      active:            t.active,
      isDefault:         t.isDefault,
    });
    setModal('edit');
  };
  const close = () => { setModal(null); setEditing(null); };

  const handleSave = async () => {
    if (modal === 'create' && !/^[a-z0-9_-]+$/i.test(form.key)) {
      toast.error('Key must be alphanumeric (a-z, 0-9, _, -)');
      return;
    }
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        key:               modal === 'create' ? form.key.toLowerCase() : undefined,
        name:              form.name.trim(),
        description:       form.description.trim() || null,
        surchargePercent:  Number(form.surchargePercent),
        surchargeFixedFee: Number(form.surchargeFixedFee),
        sortOrder:         Number(form.sortOrder) || 0,
        active:            form.active,
        isDefault:         form.isDefault,
      };
      if (modal === 'create') {
        await createPricingTier(payload);
        toast.success('Tier created');
      } else if (editing) {
        await updatePricingTier(editing.id, payload);
        toast.success('Tier updated');
      }
      close();
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save tier');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t: PricingTier) => {
    if (t.key === 'custom') {
      toast.warn('The "custom" sentinel tier cannot be deleted.');
      return;
    }
    if (!window.confirm(`Delete tier "${t.name}"? Stores currently using it will block this action.`)) return;
    try {
      await deletePricingTier(t.id);
      toast.success('Tier deleted');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete tier');
    }
  };

  return (
    <div className="admin-page apm-page">
      <div className="admin-header">
        <div className="admin-header-left">
          <div className="admin-header-icon"><Percent size={22} /></div>
          <div>
            <h1>Pricing Tiers</h1>
            <p>Surcharge rate presets for dual pricing. Stores reference one tier (or override per-store).</p>
          </div>
        </div>
        <div className="admin-header-actions">
          <button className="admin-btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'apm-spin' : ''} /> Refresh
          </button>
          <button className="admin-btn-primary" onClick={openCreate}>
            <Plus size={13} /> Add Tier
          </button>
        </div>
      </div>

      {loading ? (
        <div className="apm-loading"><RefreshCw size={16} className="apm-spin" /> Loading…</div>
      ) : sortedTiers.length === 0 ? (
        <div className="apm-empty">
          <Percent size={32} className="apm-empty-icon" />
          <p>No tiers yet — add the standard 3% + $0.30 tier to get started.</p>
        </div>
      ) : (
        <div className="apt-tier-grid">
          {sortedTiers.map(t => {
            const isCustomSentinel = t.key === 'custom';
            return (
              <div
                key={t.id}
                className={`apt-tier-card ${t.isDefault ? 'apt-tier-card--default' : ''} ${!t.active ? 'apt-tier-card--inactive' : ''}`}
              >
                <div className="apt-tier-head">
                  <div>
                    <div className="apt-tier-key">{t.key}</div>
                    <div className="apt-tier-name">{t.name}</div>
                  </div>
                  {t.isDefault && <span className="apt-default-pill">Default</span>}
                </div>
                {isCustomSentinel ? (
                  <div className="apt-tier-rate" style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>
                    Sentinel — use Store override
                  </div>
                ) : (
                  <div className="apt-tier-rate">
                    {Number(t.surchargePercent).toFixed(2)}<small style={{ fontSize: '0.7em', fontWeight: 600 }}>%</small>
                    <span className="apt-tier-rate-fee">+ ${Number(t.surchargeFixedFee).toFixed(2)} per tx</span>
                  </div>
                )}
                {t.description && <div className="apt-tier-desc">{t.description}</div>}
                <div className="apt-tier-actions">
                  <button className="admin-btn-icon" title="Edit" onClick={() => openEdit(t)}><Edit3 size={13} /></button>
                  <button className="admin-btn-icon danger" title="Delete" onClick={() => handleDelete(t)} disabled={isCustomSentinel}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <div className="apm-modal-backdrop" onClick={close}>
          <div className="apm-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="apm-modal-head">
              <h2>{modal === 'create' ? 'New Pricing Tier' : `Edit ${editing?.name}`}</h2>
              <button className="admin-btn-icon" onClick={close}><X size={14} /></button>
            </div>
            <div className="apm-modal-body">

              {modal === 'create' && (
                <div className="apm-info-strip">
                  <AlertTriangle size={14} />
                  <div>
                    The <code>custom</code> key is reserved as a sentinel for the per-store override path.
                    Pick a different key like <code>tier_4</code> or <code>partner_rate</code>.
                  </div>
                </div>
              )}

              <div className="apm-grid-2">
                {modal === 'create' && (
                  <div>
                    <label className="apm-label">Key *</label>
                    <input
                      className="apm-input"
                      type="text"
                      value={form.key}
                      onChange={e => setForm({ ...form, key: e.target.value })}
                      placeholder="tier_4"
                    />
                  </div>
                )}
                <div style={modal === 'edit' ? { gridColumn: '1 / -1' } : {}}>
                  <label className="apm-label">Display Name *</label>
                  <input
                    className="apm-input"
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Standard — 3% + $0.30"
                  />
                </div>
              </div>

              <div className="apm-grid-2" style={{ marginTop: 14 }}>
                <div>
                  <label className="apm-label">Surcharge Percent *</label>
                  <div className="apm-input-suffix">
                    <input
                      className="apm-input"
                      type="number"
                      step="0.001"
                      min="0"
                      max="10"
                      value={form.surchargePercent}
                      onChange={e => setForm({ ...form, surchargePercent: e.target.value })}
                    />
                    <span className="apm-suffix">%</span>
                  </div>
                </div>
                <div>
                  <label className="apm-label">Fixed Fee (per tx) *</label>
                  <div className="apm-input-suffix">
                    <span className="apm-suffix">$</span>
                    <input
                      className="apm-input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.surchargeFixedFee}
                      onChange={e => setForm({ ...form, surchargeFixedFee: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <label className="apm-label">Description</label>
                <textarea
                  className="apm-input apm-textarea"
                  rows={2}
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="Internal notes shown in the tier picker."
                />
              </div>

              <div className="apm-grid-2" style={{ marginTop: 14 }}>
                <div>
                  <label className="apm-label">Sort Order</label>
                  <input
                    className="apm-input"
                    type="number"
                    value={form.sortOrder}
                    onChange={e => setForm({ ...form, sortOrder: e.target.value })}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'flex-end' }}>
                  <label className="apm-toggle">
                    <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
                    <span>Active</span>
                  </label>
                  <label className="apm-toggle">
                    <input type="checkbox" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} />
                    <span>Default tier</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="apm-modal-foot">
              <button className="admin-btn-secondary" onClick={close} disabled={saving}>Cancel</button>
              <button className="admin-btn-primary" onClick={handleSave} disabled={saving}>
                <Save size={13} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
