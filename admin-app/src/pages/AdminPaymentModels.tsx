/**
 * AdminPaymentModels.tsx — Session 50.
 *
 * Per-store dual pricing / cash discount configuration. Lists every active
 * store across orgs with its current pricing model + tier + effective rate;
 * clicking a row opens the edit modal that flips the model, picks a tier or
 * sets a custom override, and writes a PricingModelChange audit row.
 *
 * Superadmin-only. Manager+ in the org sees a read-only mirror in
 * /portal/store-settings (Session 51 work).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Percent, RefreshCw, Search, Edit3, X, Save, Info, AlertTriangle,
  CheckCircle, Clock, History,
} from 'lucide-react';
import { toast } from 'react-toastify';
import {
  listStorePricingConfigs,
  getStorePricingConfig,
  updateStorePricingConfig,
  listPricingTiers,
  type StorePricingSummary,
  type StorePricingDetail,
  type PricingTier,
} from '../services/api';
import './AdminPaymentModels.css';

const MODEL_LABELS: Record<string, string> = {
  interchange:  'Interchange',
  dual_pricing: 'Dual Pricing',
};

export default function AdminPaymentModels() {
  const [stores,   setStores]   = useState<StorePricingSummary[]>([]);
  const [tiers,    setTiers]    = useState<PricingTier[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState<'all' | 'interchange' | 'dual_pricing'>('all');
  const [editing,  setEditing]  = useState<StorePricingDetail | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        listStorePricingConfigs(),
        listPricingTiers(),
      ]);
      setStores(s.stores || []);
      setTiers((t.tiers || []).filter(x => x.active && x.key !== 'custom'));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to load pricing config');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const visible = useMemo(() => {
    let rows = stores;
    if (filter !== 'all') rows = rows.filter(s => s.pricingModel === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(s =>
        (s.storeName || '').toLowerCase().includes(q) ||
        (s.orgName   || '').toLowerCase().includes(q) ||
        (s.stateCode || '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [stores, search, filter]);

  const counts = useMemo(() => {
    const interchange = stores.filter(s => s.pricingModel === 'interchange').length;
    const dual        = stores.filter(s => s.pricingModel === 'dual_pricing').length;
    return { all: stores.length, interchange, dual_pricing: dual };
  }, [stores]);

  const openEdit = async (storeId: string) => {
    try {
      const detail = await getStorePricingConfig(storeId);
      setEditing(detail);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to load store config');
    }
  };

  return (
    <div className="admin-page apm-page">
      <div className="admin-header">
        <div className="admin-header-left">
          <div className="admin-header-icon"><Percent size={22} /></div>
          <div>
            <h1>Payment Models</h1>
            <p>Per-store dual pricing / cash discount configuration. Toggle changes processor setup.</p>
          </div>
        </div>
        <div className="admin-header-actions">
          <button className="admin-btn-secondary" onClick={loadAll} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'apm-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stat strip */}
      <div className="apm-stats">
        <button className={`apm-stat ${filter === 'all' ? 'apm-stat--active' : ''}`} onClick={() => setFilter('all')}>
          <span className="apm-stat-num">{counts.all}</span>
          <span className="apm-stat-lbl">All Stores</span>
        </button>
        <button className={`apm-stat ${filter === 'interchange' ? 'apm-stat--active' : ''}`} onClick={() => setFilter('interchange')}>
          <span className="apm-stat-num">{counts.interchange}</span>
          <span className="apm-stat-lbl">Interchange</span>
        </button>
        <button className={`apm-stat apm-stat--accent ${filter === 'dual_pricing' ? 'apm-stat--active' : ''}`} onClick={() => setFilter('dual_pricing')}>
          <span className="apm-stat-num">{counts.dual_pricing}</span>
          <span className="apm-stat-lbl">Dual Pricing</span>
        </button>
      </div>

      <div className="apm-search-wrap">
        <Search size={13} className="apm-search-icon" />
        <input
          className="apm-search"
          placeholder="Search by store, organization, or state…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="apm-loading"><RefreshCw size={16} className="apm-spin" /> Loading…</div>
      ) : visible.length === 0 ? (
        <div className="apm-empty">
          <Percent size={32} className="apm-empty-icon" />
          <p>No stores match the current filter.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Store</th>
                <th>State</th>
                <th>Model</th>
                <th>Tier</th>
                <th>Effective Rate</th>
                <th>Activated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(s => (
                <tr key={s.storeId} className="apm-row" onClick={() => openEdit(s.storeId)}>
                  <td className="apm-org-cell">{s.orgName || '—'}</td>
                  <td className="apm-store-cell">{s.storeName}</td>
                  <td>{s.stateCode || '—'}</td>
                  <td>
                    <span className={`apm-badge apm-badge--${s.pricingModel}`}>
                      {MODEL_LABELS[s.pricingModel] || s.pricingModel}
                    </span>
                  </td>
                  <td>{s.pricingTierName || (s.effectiveSource === 'custom' ? <em className="apm-em">Custom</em> : '—')}</td>
                  <td>
                    {s.effectivePercent === 0 && s.effectiveFixedFee === 0
                      ? <span className="apm-muted">—</span>
                      : (<>
                          <strong>{Number(s.effectivePercent).toFixed(2)}%</strong>
                          <span className="apm-muted"> + ${Number(s.effectiveFixedFee).toFixed(2)}</span>
                          {s.effectiveSource === 'custom' && <span className="apm-tag apm-tag--custom">override</span>}
                        </>)
                    }
                  </td>
                  <td className="apm-muted">
                    {s.dualPricingActivatedAt ? new Date(s.dualPricingActivatedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="apm-actions">
                    <button className="admin-btn-icon" title="Configure" onClick={(e) => { e.stopPropagation(); openEdit(s.storeId); }}>
                      <Edit3 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PaymentModelEditor
          detail={editing}
          tiers={tiers}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadAll(); }}
        />
      )}
    </div>
  );
}

// ─── Edit modal ────────────────────────────────────────────────────────

interface EditorProps {
  detail: StorePricingDetail;
  tiers:  PricingTier[];
  onClose: () => void;
  onSaved: () => void;
}

function PaymentModelEditor({ detail, tiers, onClose, onSaved }: EditorProps) {
  const [model,        setModel]         = useState(detail.pricingModel);
  const [tierId,       setTierId]        = useState<string>(detail.pricingTierId || '');
  const [useCustom,    setUseCustom]     = useState(detail.effectiveRate.source === 'custom');
  const [customPct,    setCustomPct]     = useState(detail.customSurchargePercent ? String(detail.customSurchargePercent) : '');
  const [customFee,    setCustomFee]     = useState(detail.customSurchargeFixedFee ? String(detail.customSurchargeFixedFee) : '');
  const [disclosure,   setDisclosure]    = useState(detail.dualPricingDisclosure || '');
  const [reason,       setReason]        = useState('');
  const [saving,       setSaving]        = useState(false);
  const [showAudit,    setShowAudit]     = useState(false);

  const stateCap = detail.stateConstraints?.maxSurchargePercent ?? null;
  const stateForcesCashDiscount = detail.stateConstraints?.dualPricingAllowed === false;

  const previewRate = useMemo(() => {
    if (model !== 'dual_pricing') return null;
    if (useCustom) {
      const pct = Number(customPct);
      const fee = Number(customFee);
      if (Number.isFinite(pct) && Number.isFinite(fee)) {
        return { source: 'custom', percent: pct, fixedFee: fee };
      }
      return null;
    }
    const tier = tiers.find(t => t.id === tierId);
    if (tier) {
      return { source: 'tier', percent: Number(tier.surchargePercent), fixedFee: Number(tier.surchargeFixedFee), tierName: tier.name };
    }
    return null;
  }, [model, useCustom, customPct, customFee, tierId, tiers]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        pricingModel: model,
        pricingTierId: useCustom ? null : (tierId || null),
        customSurchargePercent: useCustom ? (customPct === '' ? null : Number(customPct)) : null,
        customSurchargeFixedFee: useCustom ? (customFee === '' ? null : Number(customFee)) : null,
        dualPricingDisclosure: disclosure.trim() || null,
        reason: reason.trim() || null,
      };
      const res = await updateStorePricingConfig(detail.storeId, payload);
      if (res.auditWritten) {
        toast.success('Pricing model updated — audit logged');
      } else {
        toast.info('No changes to save');
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to update pricing model');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="apm-modal-backdrop" onClick={onClose}>
      <div className="apm-modal" onClick={e => e.stopPropagation()}>
        <div className="apm-modal-head">
          <div>
            <h2>{detail.storeName}</h2>
            <p className="apm-muted">{detail.orgId} · {detail.stateCode || 'No state set'}</p>
          </div>
          <button className="admin-btn-icon" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="apm-modal-body">

          {/* Superadmin-only banner */}
          <div className="apm-info-strip">
            <Info size={14} />
            <div>
              <strong>Superadmin only.</strong> Switching the pricing model changes how transactions are processed.
              Dual pricing adds a customer-facing surcharge (default 3% + $0.30) on every credit/debit transaction.
              Cash and EBT pay the base price. State-level rules (taxability, disclosure, max %) apply automatically.
              Switching mid-shift is blocked — the change takes effect at the next shift open.
            </div>
          </div>

          {/* State constraint warnings */}
          {stateForcesCashDiscount && model === 'dual_pricing' && (
            <div className="apm-warn-strip">
              <AlertTriangle size={14} />
              <div>
                <strong>{detail.stateCode}</strong> prohibits credit-card surcharging.
                Cash-discount framing will be used on receipts and signage instead. Same math, different consumer-facing copy.
              </div>
            </div>
          )}
          {stateCap != null && (
            <div className="apm-info-strip">
              <Info size={14} />
              <div><strong>{detail.stateCode}</strong> caps surcharge at <strong>{stateCap}%</strong>.</div>
            </div>
          )}
          {detail.stateConstraints?.surchargeTaxable && (
            <div className="apm-info-strip">
              <Info size={14} />
              <div><strong>{detail.stateCode}</strong> applies sales tax to the surcharge.</div>
            </div>
          )}

          {/* Pricing model toggle */}
          <div className="apm-section">
            <h3>Pricing Model</h3>
            <div className="apm-radio-group">
              <label className={`apm-radio ${model === 'interchange' ? 'apm-radio--active' : ''}`}>
                <input type="radio" checked={model === 'interchange'} onChange={() => setModel('interchange')} />
                <div>
                  <strong>Interchange</strong>
                  <p>Standard pricing — one price per item, no customer-facing surcharge.</p>
                </div>
              </label>
              <label className={`apm-radio ${model === 'dual_pricing' ? 'apm-radio--active' : ''}`}>
                <input type="radio" checked={model === 'dual_pricing'} onChange={() => setModel('dual_pricing')} />
                <div>
                  <strong>Dual Pricing</strong>
                  <p>Card / debit pay surcharge; cash + EBT pay base. Receipt + label disclosure auto-printed.</p>
                </div>
              </label>
            </div>
          </div>

          {/* Tier picker — only when dual_pricing */}
          {model === 'dual_pricing' && (
            <>
              <div className="apm-section">
                <div className="apm-section-head">
                  <h3>Surcharge Rate</h3>
                  <label className="apm-toggle">
                    <input type="checkbox" checked={useCustom} onChange={e => setUseCustom(e.target.checked)} />
                    <span>Override tier with custom rate</span>
                  </label>
                </div>

                {!useCustom ? (
                  <div>
                    <select className="apm-input" value={tierId} onChange={e => setTierId(e.target.value)}>
                      <option value="">— Select a tier —</option>
                      {tiers.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({Number(t.surchargePercent).toFixed(2)}% + ${Number(t.surchargeFixedFee).toFixed(2)})
                          {t.isDefault ? ' — default' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="apm-grid-2">
                    <div>
                      <label className="apm-label">Surcharge Percent</label>
                      <div className="apm-input-suffix">
                        <input
                          className="apm-input"
                          type="number"
                          step="0.001"
                          min="0"
                          max={stateCap ?? undefined}
                          value={customPct}
                          onChange={e => setCustomPct(e.target.value)}
                          placeholder="3.000"
                        />
                        <span className="apm-suffix">%</span>
                      </div>
                    </div>
                    <div>
                      <label className="apm-label">Fixed Fee (per transaction)</label>
                      <div className="apm-input-suffix">
                        <span className="apm-suffix">$</span>
                        <input
                          className="apm-input"
                          type="number"
                          step="0.01"
                          min="0"
                          value={customFee}
                          onChange={e => setCustomFee(e.target.value)}
                          placeholder="0.30"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {previewRate && (
                  <div className="apm-preview">
                    <CheckCircle size={14} />
                    <span>
                      Effective rate:&nbsp;
                      <strong>{previewRate.percent.toFixed(2)}%</strong> + <strong>${previewRate.fixedFee.toFixed(2)}</strong>&nbsp;
                      <span className="apm-muted">
                        from {previewRate.source === 'custom' ? 'custom override' : ('tier' in previewRate ? previewRate.tierName : 'tier')}
                      </span>
                    </span>
                  </div>
                )}
              </div>

              {/* Disclosure */}
              <div className="apm-section">
                <h3>Receipt Disclosure</h3>
                <p className="apm-help">
                  Leave blank to use the state default. Most states require specific verbatim language —
                  consult your state's payment-card law before customizing.
                </p>
                <textarea
                  className="apm-input apm-textarea"
                  placeholder={detail.effectiveDisclosure || 'Default disclosure will print…'}
                  rows={3}
                  value={disclosure}
                  onChange={e => setDisclosure(e.target.value)}
                />
                {!disclosure.trim() && (
                  <div className="apm-preview-disclosure">
                    <strong>Preview:</strong> {detail.effectiveDisclosure}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Reason for change */}
          <div className="apm-section">
            <h3>Reason for Change <span className="apm-muted apm-help-inline">(optional, logged in audit)</span></h3>
            <input
              className="apm-input"
              type="text"
              placeholder="e.g. Merchant onboarded to dual pricing per signed agreement 2026-04-30"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>

          {/* Recent changes */}
          <div className="apm-section">
            <button className="apm-collapsible" onClick={() => setShowAudit(s => !s)}>
              <History size={13} /> Recent changes ({detail.recentChanges.length})
            </button>
            {showAudit && (
              <div className="apm-audit-list">
                {detail.recentChanges.length === 0 ? (
                  <p className="apm-muted">No prior changes recorded.</p>
                ) : (
                  detail.recentChanges.map(c => (
                    <div key={c.id} className="apm-audit-row">
                      <Clock size={12} className="apm-muted" />
                      <div>
                        <strong>{MODEL_LABELS[c.fromModel] || c.fromModel} → {MODEL_LABELS[c.toModel] || c.toModel}</strong>
                        {c.toPercent != null && (
                          <span className="apm-muted">
                            &nbsp;· {Number(c.toPercent).toFixed(2)}% + ${Number(c.toFixedFee || 0).toFixed(2)}
                          </span>
                        )}
                        <div className="apm-muted apm-tiny">
                          {new Date(c.createdAt).toLocaleString()} · {c.changedByName || c.changedById}
                          {c.reason && <> · "{c.reason}"</>}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

        </div>

        <div className="apm-modal-foot">
          <button className="admin-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="admin-btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={13} /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
