/**
 * TaxRules — Back-office management of tax slabs per organisation.
 * CRUD via GET/POST/PUT/DELETE /api/catalog/tax-rules
 *
 * Fields per rule:
 *   name, description, rate (%), appliesTo, ebtExempt, state, county, storeId, active
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  getCatalogTaxRules,
  createCatalogTaxRule,
  updateCatalogTaxRule,
  deleteCatalogTaxRule,
} from '../services/api';
import {
  Percent, Plus, Pencil, Trash2, Check, X as XIcon,
  AlertCircle, ChevronDown, Info,
} from 'lucide-react';
import './TaxRules.css';

// ── Helpers ────────────────────────────────────────────────────────────────
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC',
];

const APPLIES_TO_OPTIONS = [
  { value: 'all',            label: 'All Products' },
  { value: 'grocery',        label: 'Grocery' },
  { value: 'prepared_food',  label: 'Prepared Food' },
  { value: 'beverage',       label: 'Beverage' },
  { value: 'alcohol',        label: 'Alcohol' },
  { value: 'tobacco',        label: 'Tobacco' },
  { value: 'cannabis',       label: 'Cannabis' },
  { value: 'general',        label: 'General Merchandise' },
  { value: 'health',         label: 'Health & Beauty' },
  { value: 'service',        label: 'Service' },
];

// ── Shared styles ──────────────────────────────────────────────────────────
const inp = {
  padding: '0.5rem 0.75rem',
  borderRadius: 8,
  border: '1px solid var(--border-color, #2a2a3a)',
  background: 'var(--bg-tertiary, #1a1a2a)',
  color: 'var(--text-primary, #e2e8f0)',
  fontSize: '0.875rem',
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
};
const labelStyle = {
  fontSize: '0.7rem', fontWeight: 700,
  color: 'var(--text-muted, #6b7280)',
  letterSpacing: '0.06em',
  marginBottom: 4, display: 'block',
};
const EMPTY_FORM = {
  name: '', description: '', rate: '', appliesTo: 'all',
  ebtExempt: true, state: '', county: '',
};

// ── AppliesTo label ────────────────────────────────────────────────────────
function AppliesToBadge({ value }) {
  const opt = APPLIES_TO_OPTIONS.find(o => o.value === value);
  return (
    <span style={{
      fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.55rem',
      borderRadius: 8,
      background: 'var(--brand-10)', color: 'var(--accent-secondary)',
      border: '1px solid var(--brand-25)',
    }}>
      {opt?.label || value}
    </span>
  );
}

// ── Toggle chip ────────────────────────────────────────────────────────────
function ToggleChip({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0.35rem 0.85rem',
        borderRadius: 20,
        border: `1px solid ${checked ? 'rgba(52,211,153,.4)' : 'var(--border-color, #2a2a3a)'}`,
        background: checked ? 'rgba(52,211,153,.1)' : 'var(--bg-card, #1a1a2a)',
        color: checked ? '#34d399' : 'var(--text-muted, #6b7280)',
        fontWeight: 700, fontSize: '0.8rem',
        cursor: 'pointer', transition: 'all .12s',
      }}
    >
      <span style={{
        width: 14, height: 14, borderRadius: '50%',
        background: checked ? '#34d399' : 'var(--bg-input, #2a2a3a)',
        border: checked ? '2px solid #34d399' : '2px solid var(--border-color, #3a3a4a)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {checked && <Check size={8} strokeWidth={3} color="#0f1117" />}
      </span>
      {label}
    </button>
  );
}

// ── TaxRuleForm ────────────────────────────────────────────────────────────
function TaxRuleForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const [err,  setErr]  = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    if (form.rate === '' || isNaN(Number(form.rate)) || Number(form.rate) < 0 || Number(form.rate) > 100) {
      setErr('Rate must be a number between 0 and 100.'); return;
    }
    if (!form.appliesTo) { setErr('Applies-to category is required.'); return; }
    setErr('');
    // The form collects the rate as a percent (e.g. "5.5" for 5.5%). The DB
    // stores it as a decimal fraction (0.055) because that's how it's applied
    // at checkout: lineTotal × rate. Convert on save; reverse on edit-load.
    await onSave({
      name:        form.name.trim(),
      description: form.description.trim() || null,
      rate:        parseFloat(form.rate) / 100,
      appliesTo:   form.appliesTo,
      ebtExempt:   form.ebtExempt,
      state:       form.state || null,
      county:      form.county.trim() || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{
      background: 'var(--bg-secondary, #111827)',
      border: '1px solid var(--brand-30)',
      borderRadius: 14, padding: '1.25rem 1.5rem',
      marginBottom: '1rem',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

        {/* Name */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>RULE NAME *</label>
          <input style={inp} value={form.name} onChange={e => set('name', e.target.value)}
            placeholder="e.g. California Sales Tax – Prepared Food" />
        </div>

        {/* Rate */}
        <div>
          <label style={labelStyle}>TAX RATE (%) *</label>
          <div style={{ position: 'relative' }}>
            <input style={{ ...inp, paddingRight: 28 }} type="number" step="0.001" min="0" max="100"
              value={form.rate} onChange={e => set('rate', e.target.value)}
              placeholder="8.25" />
            <Percent size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted, #6b7280)', pointerEvents: 'none' }} />
          </div>
        </div>

        {/* Applies to */}
        <div>
          <label style={labelStyle}>APPLIES TO *</label>
          <div style={{ position: 'relative' }}>
            <select style={{ ...inp, paddingRight: '2rem', cursor: 'pointer' }}
              value={form.appliesTo} onChange={e => set('appliesTo', e.target.value)}>
              {APPLIES_TO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted, #6b7280)' }} />
          </div>
        </div>

        {/* State */}
        <div>
          <label style={labelStyle}>STATE (optional)</label>
          <div style={{ position: 'relative' }}>
            <select style={{ ...inp, paddingRight: '2rem', cursor: 'pointer' }}
              value={form.state} onChange={e => set('state', e.target.value)}>
              <option value="">All / Org-wide</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted, #6b7280)' }} />
          </div>
        </div>

        {/* County */}
        <div>
          <label style={labelStyle}>COUNTY / MUNICIPALITY (optional)</label>
          <input style={inp} value={form.county} onChange={e => set('county', e.target.value)}
            placeholder="e.g. Los Angeles County" />
        </div>

        {/* EBT exempt toggle */}
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10 }}>
          <ToggleChip
            checked={form.ebtExempt}
            onChange={v => set('ebtExempt', v)}
            label="EBT / SNAP Exempt"
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #6b7280)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Info size={11} /> Tax is waived for EBT-eligible items when this is on
          </span>
        </div>

        {/* Description */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>DESCRIPTION (optional)</label>
          <input style={inp} value={form.description} onChange={e => set('description', e.target.value)}
            placeholder="Internal notes…" />
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 10, padding: '0.5rem 0.75rem', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: '0.8rem', fontWeight: 600 }}>
          {err}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={{
          padding: '0.5rem 1.25rem', borderRadius: 8,
          background: 'var(--bg-card, #1a1a2a)', border: '1px solid var(--border-color, #2a2a3a)',
          color: 'var(--text-secondary, #9ca3af)', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem',
        }}>Cancel</button>
        <button type="submit" disabled={saving} style={{
          padding: '0.5rem 1.5rem', borderRadius: 8,
          background: saving ? 'var(--bg-input, #2a2a3a)' : 'var(--accent-primary)',
          border: 'none',
          color: saving ? 'var(--text-muted, #6b7280)' : '#fff',
          fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.875rem',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {saving ? 'Saving…' : <><Check size={14} /> Save Rule</>}
        </button>
      </div>
    </form>
  );
}

// ── TaxRuleCard ────────────────────────────────────────────────────────────
function TaxRuleCard({ rule, onEdit, onDelete }) {
  return (
    <div style={{
      background: 'var(--bg-secondary, #111827)',
      border: '1px solid var(--border-color, #1f2937)',
      borderRadius: 12, padding: '0.875rem 1rem',
      display: 'flex', alignItems: 'center', gap: 12,
      transition: 'border-color .12s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--brand-30)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color, #1f2937)'}
    >
      {/* Rate badge */}
      <div style={{
        width: 52, height: 52, borderRadius: 12, flexShrink: 0,
        background: 'var(--brand-10)',
        border: '1px solid var(--brand-25)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: '0.95rem', fontWeight: 900, color: 'var(--accent-secondary)', lineHeight: 1 }}>
          {(() => {
            const pct = Number(rule.rate) * 100;
            return pct.toFixed(pct % 1 === 0 ? 0 : 3).replace(/0+$/, '').replace(/\.$/, '');
          })()}%
        </span>
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary, #e2e8f0)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {rule.name}
          {rule.state && (
            <span style={{
              fontSize: '0.65rem', fontWeight: 700, padding: '0.15rem 0.5rem',
              borderRadius: 10, background: 'rgba(52,211,153,.12)', color: '#34d399',
              border: '1px solid rgba(52,211,153,.25)',
            }}>{rule.state}{rule.county ? ` · ${rule.county}` : ''}</span>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <AppliesToBadge value={rule.appliesTo} />
          {rule.ebtExempt && (
            <span style={{
              fontSize: '0.68rem', fontWeight: 700, padding: '0.15rem 0.45rem',
              borderRadius: 8, background: 'rgba(52,211,153,.08)', color: '#34d399',
              border: '1px solid rgba(52,211,153,.2)',
            }}>EBT Exempt</span>
          )}
          {rule.description && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #6b7280)' }}>
              · {rule.description}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button onClick={() => onEdit(rule)} title="Edit rule" style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'var(--bg-card, #1a1a2a)', border: '1px solid var(--border-color, #2a2a3a)',
          color: 'var(--text-secondary, #9ca3af)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Pencil size={13} />
        </button>
        <button onClick={() => onDelete(rule)} title="Deactivate rule" style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)',
          color: '#f87171', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function TaxRules({ embedded }) {
  const [rules,    setRules]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [saving,   setSaving]   = useState(false);
  const [showForm, setShowForm] = useState(false);   // 'new' | rule object | false
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getCatalogTaxRules();
      const list = Array.isArray(res) ? res : (res?.data || []);
      setRules(list);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load tax rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (data) => {
    setSaving(true);
    setError('');
    try {
      if (showForm === 'new') {
        await createCatalogTaxRule(data);
      } else {
        await updateCatalogTaxRule(showForm.id, data);
      }
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save tax rule');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rule) => {
    setSaving(true);
    setConfirmDelete(null);
    try {
      await deleteCatalogTaxRule(rule.id);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to deactivate tax rule');
    } finally {
      setSaving(false);
    }
  };

  // Group rules by state for display
  const byState = rules.reduce((acc, r) => {
    const key = r.state || 'Org-wide';
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  const content = (
    <>

      {/* ── Header ── */}
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon">
            <Percent size={22} />
          </div>
          <div>
            <h1 className="p-title">Tax Rules</h1>
            <p className="p-subtitle">Define tax slabs by category, state, and county</p>
          </div>
        </div>
        <div className="p-header-actions">
          {!showForm && (
            <button
              onClick={() => setShowForm('new')}
              style={{
                height: 38, padding: '0 1.25rem',
                background: 'var(--accent-primary)', border: 'none',
                borderRadius: 8, color: '#fff',
                fontWeight: 800, fontSize: '0.875rem',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Plus size={15} /> Add Tax Rule
            </button>
          )}
        </div>
      </div>

      {/* ── Info note ── */}
      <div style={{
        padding: '0.75rem 1rem', borderRadius: 10, marginBottom: '1.25rem',
        background: 'var(--brand-05)', border: '1px solid var(--brand-20)',
        fontSize: '0.78rem', color: 'var(--text-secondary, #9ca3af)',
        display: 'flex', alignItems: 'flex-start', gap: 8,
      }}>
        <Info size={14} color="var(--accent-secondary)" style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Tax rules are applied at checkout based on product category. State-specific rules override org-wide rules
          for stores in matching states. Rules are automatically inherited by all stores unless a store-specific
          override exists.
        </span>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem',
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
          color: '#f87171', fontSize: '0.85rem', fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={15} /> {error}
          </span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0 }}>
            <XIcon size={14} />
          </button>
        </div>
      )}

      {/* ── Form ── */}
      {showForm && (
        <TaxRuleForm
          initial={showForm === 'new' ? EMPTY_FORM : {
            name:        showForm.name,
            description: showForm.description || '',
            // DB stores rate as decimal fraction (0.055) — display in the
            // form as percent (5.5) to match the "%" label the user sees.
            rate:        String(+(Number(showForm.rate) * 100).toFixed(4)),
            appliesTo:   showForm.appliesTo,
            ebtExempt:   showForm.ebtExempt !== false,
            state:       showForm.state || '',
            county:      showForm.county || '',
          }}
          onSave={handleSave}
          onCancel={() => setShowForm(false)}
          saving={saving}
        />
      )}

      {/* ── Delete confirmation ── */}
      {confirmDelete && (
        <div style={{
          padding: '1rem 1.25rem', borderRadius: 12, marginBottom: '1rem',
          background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-primary, #e2e8f0)' }}>
            Deactivate <strong>{confirmDelete.name}</strong>? It will no longer be applied at checkout.
          </span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => setConfirmDelete(null)} style={{
              padding: '0.4rem 1rem', borderRadius: 8,
              background: 'var(--bg-card, #1a1a2a)', border: '1px solid var(--border-color, #2a2a3a)',
              color: 'var(--text-secondary, #9ca3af)', fontWeight: 700, cursor: 'pointer', fontSize: '0.82rem',
            }}>Cancel</button>
            <button onClick={() => handleDelete(confirmDelete)} disabled={saving} style={{
              padding: '0.4rem 1rem', borderRadius: 8,
              background: '#ef4444', border: 'none',
              color: '#fff', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.82rem',
            }}>Deactivate</button>
          </div>
        </div>
      )}

      {/* ── Rules list ── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted, #6b7280)', fontSize: '0.875rem' }}>
          Loading tax rules…
        </div>
      ) : rules.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '3rem 2rem',
          background: 'var(--bg-secondary, #111827)',
          border: '1px solid var(--border-color, #1f2937)',
          borderRadius: 12, color: 'var(--text-muted, #6b7280)', fontSize: '0.875rem',
        }}>
          <Percent size={32} style={{ marginBottom: 10, opacity: 0.25 }} /><br />
          No active tax rules yet.<br />
          <span style={{ fontSize: '0.8rem' }}>Click <strong style={{ color: 'var(--text-secondary, #9ca3af)' }}>Add Tax Rule</strong> to create your first slab.</span>
        </div>
      ) : (
        // Grouped by state
        Object.entries(byState).map(([stateKey, stateRules]) => (
          <div key={stateKey} style={{ marginBottom: '1.5rem' }}>
            <div style={{
              fontSize: '0.72rem', fontWeight: 800,
              color: 'var(--text-muted, #6b7280)',
              letterSpacing: '0.07em',
              marginBottom: 8,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{
                padding: '0.15rem 0.6rem', borderRadius: 6,
                background: 'var(--bg-tertiary, #0f172a)',
                border: '1px solid var(--border-color, #1f2937)',
              }}>
                {stateKey === 'Org-wide' ? 'ORG-WIDE (ALL STATES)' : stateKey}
              </span>
              <span style={{ fontSize: '0.68rem', fontWeight: 600 }}>
                {stateRules.length} rule{stateRules.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stateRules.map(rule => (
                <TaxRuleCard
                  key={rule.id}
                  rule={rule}
                  onEdit={(r) => { setShowForm(r); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  onDelete={(r) => setConfirmDelete(r)}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );

  if (embedded) return <div className="p-tab-content">{content}</div>;

  return (
    <div className="tr-container">
      {content}
    </div>
  );
}
