/**
 * DepositRules — Back-office management of bottle/can deposit rules per organisation.
 * CRUD via GET/POST/PUT /api/catalog/deposit-rules
 *
 * Fields per rule:
 *   name, description, depositAmount, containerTypes, minVolumeOz, maxVolumeOz, state, active
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  getCatalogDepositRules,
  createCatalogDepositRule,
  updateCatalogDepositRule,
} from '../services/api';
import {
  Recycle, Plus, Pencil, Trash2, Check, X as XIcon,
  AlertCircle, ChevronDown,
} from 'lucide-react';

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt$(n) {
  return '$' + (Number(n) || 0).toFixed(4).replace(/\.?0+$/, '') || '$0';
}
// Format deposit nicely: $0.05, $0.10, etc.
function fmtDeposit(n) {
  const v = Number(n) || 0;
  return '$' + v.toFixed(v < 0.1 ? 4 : 2).replace(/0+$/, '').replace(/\.$/, '');
}

const US_DEPOSIT_STATES = [
  'CA', 'CT', 'HI', 'IA', 'ME', 'MA', 'MI', 'NY', 'OR', 'VT',
];

const CONTAINER_OPTIONS = ['bottle', 'can', 'glass', 'plastic', 'aluminum', 'carton', 'jug', 'pouch'];

// ── Shared input styles ────────────────────────────────────────────────────
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

// ── Empty form state ───────────────────────────────────────────────────────
const EMPTY_FORM = {
  name: '',
  description: '',
  depositAmount: '',
  containerTypes: 'bottle,can',
  minVolumeOz: '',
  maxVolumeOz: '',
  state: '',
};

// ── ContainerTypeToggle ────────────────────────────────────────────────────
function ContainerTypeToggle({ value, onChange }) {
  const selected = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
  const toggle = (opt) => {
    const next = selected.includes(opt)
      ? selected.filter(s => s !== opt)
      : [...selected, opt];
    onChange(next.join(','));
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {CONTAINER_OPTIONS.map(opt => {
        const on = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            style={{
              padding: '0.3rem 0.7rem',
              borderRadius: 20,
              border: `1px solid ${on ? 'rgba(52,211,153,.4)' : 'var(--border-color, #2a2a3a)'}`,
              background: on ? 'rgba(52,211,153,.12)' : 'var(--bg-card, #1a1a2a)',
              color: on ? '#34d399' : 'var(--text-muted, #6b7280)',
              fontSize: '0.75rem', fontWeight: 700,
              cursor: 'pointer', transition: 'all .12s',
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ── RuleForm (create / edit panel) ────────────────────────────────────────
function RuleForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [err, setErr] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    if (!form.depositAmount || isNaN(Number(form.depositAmount)) || Number(form.depositAmount) <= 0) {
      setErr('Deposit amount must be a positive number.'); return;
    }
    setErr('');
    await onSave({
      name:           form.name.trim(),
      description:    form.description.trim() || null,
      depositAmount:  parseFloat(form.depositAmount),
      containerTypes: form.containerTypes || 'bottle,can',
      minVolumeOz:    form.minVolumeOz !== '' ? parseFloat(form.minVolumeOz) : null,
      maxVolumeOz:    form.maxVolumeOz !== '' ? parseFloat(form.maxVolumeOz) : null,
      state:          form.state || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{
      background: 'var(--bg-secondary, #111827)',
      border: '1px solid rgba(52,211,153,.25)',
      borderRadius: 14, padding: '1.25rem 1.5rem',
      marginBottom: '1rem',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

        {/* Name */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>RULE NAME *</label>
          <input style={inp} value={form.name} onChange={e => set('name', e.target.value)}
            placeholder="e.g. Standard Bottle Deposit – MI" />
        </div>

        {/* Deposit amount */}
        <div>
          <label style={labelStyle}>DEPOSIT AMOUNT (per container) *</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted, #6b7280)', fontWeight: 700 }}>$</span>
            <input style={{ ...inp, paddingLeft: 24 }} type="number" step="0.01" min="0.01"
              value={form.depositAmount} onChange={e => set('depositAmount', e.target.value)}
              placeholder="0.05" />
          </div>
        </div>

        {/* State */}
        <div>
          <label style={labelStyle}>STATE (optional)</label>
          <div style={{ position: 'relative' }}>
            <select style={{ ...inp, paddingRight: '2rem', cursor: 'pointer' }}
              value={form.state} onChange={e => set('state', e.target.value)}>
              <option value="">All / Not state-specific</option>
              {US_DEPOSIT_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted, #6b7280)' }} />
          </div>
        </div>

        {/* Min volume */}
        <div>
          <label style={labelStyle}>MIN VOLUME (oz, optional)</label>
          <input style={inp} type="number" step="0.1" min="0"
            value={form.minVolumeOz} onChange={e => set('minVolumeOz', e.target.value)}
            placeholder="e.g. 0" />
        </div>

        {/* Max volume */}
        <div>
          <label style={labelStyle}>MAX VOLUME (oz, optional)</label>
          <input style={inp} type="number" step="0.1" min="0"
            value={form.maxVolumeOz} onChange={e => set('maxVolumeOz', e.target.value)}
            placeholder="e.g. 128" />
        </div>

        {/* Container types */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>CONTAINER TYPES</label>
          <ContainerTypeToggle value={form.containerTypes} onChange={v => set('containerTypes', v)} />
        </div>

        {/* Description */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>DESCRIPTION (optional)</label>
          <input style={inp} value={form.description} onChange={e => set('description', e.target.value)}
            placeholder="Additional notes…" />
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
        }}>
          Cancel
        </button>
        <button type="submit" disabled={saving} style={{
          padding: '0.5rem 1.5rem', borderRadius: 8,
          background: saving ? 'var(--bg-input, #2a2a3a)' : 'rgba(52,211,153,.9)',
          border: 'none',
          color: saving ? 'var(--text-muted, #6b7280)' : '#0f1117',
          fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.875rem',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {saving ? 'Saving…' : <><Check size={14} /> Save Rule</>}
        </button>
      </div>
    </form>
  );
}

// ── RuleCard ───────────────────────────────────────────────────────────────
function RuleCard({ rule, onEdit, onDeactivate }) {
  const types = rule.containerTypes ? rule.containerTypes.split(',').map(s => s.trim()).filter(Boolean) : [];
  const volRange = rule.minVolumeOz != null || rule.maxVolumeOz != null
    ? `${rule.minVolumeOz ?? '0'} – ${rule.maxVolumeOz ?? '∞'} oz`
    : null;

  return (
    <div style={{
      background: 'var(--bg-secondary, #111827)',
      border: '1px solid var(--border-color, #1f2937)',
      borderRadius: 12, padding: '0.875rem 1rem',
      display: 'flex', alignItems: 'center', gap: 12,
      transition: 'border-color .12s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(52,211,153,.3)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color, #1f2937)'}
    >
      {/* Deposit amount badge */}
      <div style={{
        width: 52, height: 52, borderRadius: 12, flexShrink: 0,
        background: 'rgba(52,211,153,.1)',
        border: '1px solid rgba(52,211,153,.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column',
      }}>
        <span style={{ fontSize: '0.62rem', color: '#34d399', fontWeight: 700 }}>each</span>
        <span style={{ fontSize: '0.88rem', fontWeight: 900, color: '#34d399' }}>
          {fmtDeposit(rule.depositAmount)}
        </span>
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary, #e2e8f0)', marginBottom: 3 }}>
          {rule.name}
          {rule.state && (
            <span style={{
              marginLeft: 8, fontSize: '0.65rem', fontWeight: 700,
              padding: '0.15rem 0.5rem', borderRadius: 10,
              background: 'rgba(99,102,241,.15)', color: '#818cf8',
              border: '1px solid rgba(99,102,241,.25)',
            }}>{rule.state}</span>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {types.map(t => (
            <span key={t} style={{
              fontSize: '0.68rem', fontWeight: 700, padding: '0.15rem 0.45rem',
              borderRadius: 8, background: 'rgba(52,211,153,.08)', color: '#34d399',
              border: '1px solid rgba(52,211,153,.2)',
            }}>{t}</span>
          ))}
          {volRange && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted, #6b7280)', marginLeft: 4 }}>
              · {volRange}
            </span>
          )}
          {rule.description && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #6b7280)', marginLeft: 4 }}>
              · {rule.description}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          onClick={() => onEdit(rule)}
          title="Edit rule"
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'var(--bg-card, #1a1a2a)', border: '1px solid var(--border-color, #2a2a3a)',
            color: 'var(--text-secondary, #9ca3af)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={() => onDeactivate(rule)}
          title="Deactivate rule"
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)',
            color: '#f87171', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function DepositRules() {
  const [rules,   setRules]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [showForm, setShowForm] = useState(false);   // 'new' | rule object for edit | false
  const [confirmDeactivate, setConfirmDeactivate] = useState(null); // rule to deactivate

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getCatalogDepositRules();
      const list = Array.isArray(res) ? res : (res?.data || []);
      setRules(list);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load deposit rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (data) => {
    setSaving(true);
    try {
      if (showForm === 'new') {
        await createCatalogDepositRule(data);
      } else {
        await updateCatalogDepositRule(showForm.id, data);
      }
      setShowForm(false);
      await load();
    } catch (err) {
      // Let the form handle error display by rethrowing — but for now just alert
      setError(err.response?.data?.error || 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (rule) => {
    setSaving(true);
    setConfirmDeactivate(null);
    try {
      await updateCatalogDepositRule(rule.id, { active: false });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to deactivate rule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '1.5rem 2rem', maxWidth: 900, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'rgba(52,211,153,.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Recycle size={18} color="#34d399" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary, #e2e8f0)' }}>
              Deposit Rules
            </h1>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)' }}>
              Manage bottle &amp; can deposit amounts accepted at your store
            </p>
          </div>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm('new')}
            style={{
              height: 38, padding: '0 1.25rem',
              background: 'rgba(52,211,153,.9)', border: 'none',
              borderRadius: 8, color: '#0f1117',
              fontWeight: 800, fontSize: '0.875rem',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Plus size={15} /> Add Rule
          </button>
        )}
      </div>

      {/* ── Error banner ── */}
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

      {/* ── Create / Edit form ── */}
      {showForm && (
        <RuleForm
          initial={showForm === 'new' ? EMPTY_FORM : {
            name:           showForm.name,
            description:    showForm.description || '',
            depositAmount:  showForm.depositAmount,
            containerTypes: showForm.containerTypes || '',
            minVolumeOz:    showForm.minVolumeOz ?? '',
            maxVolumeOz:    showForm.maxVolumeOz ?? '',
            state:          showForm.state || '',
          }}
          onSave={handleSave}
          onCancel={() => setShowForm(false)}
          saving={saving}
        />
      )}

      {/* ── Deactivate confirmation ── */}
      {confirmDeactivate && (
        <div style={{
          padding: '1rem 1.25rem', borderRadius: 12, marginBottom: '1rem',
          background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-primary, #e2e8f0)' }}>
            Deactivate <strong>{confirmDeactivate.name}</strong>? It will no longer appear in the cashier app.
          </span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => setConfirmDeactivate(null)} style={{
              padding: '0.4rem 1rem', borderRadius: 8,
              background: 'var(--bg-card, #1a1a2a)', border: '1px solid var(--border-color, #2a2a3a)',
              color: 'var(--text-secondary, #9ca3af)', fontWeight: 700, cursor: 'pointer', fontSize: '0.82rem',
            }}>Cancel</button>
            <button onClick={() => handleDeactivate(confirmDeactivate)} disabled={saving} style={{
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
          Loading deposit rules…
        </div>
      ) : rules.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '3rem 2rem',
          background: 'var(--bg-secondary, #111827)',
          border: '1px solid var(--border-color, #1f2937)',
          borderRadius: 12, color: 'var(--text-muted, #6b7280)', fontSize: '0.875rem',
        }}>
          <Recycle size={32} style={{ marginBottom: 10, opacity: 0.25 }} /><br />
          No active deposit rules yet.<br />
          <span style={{ fontSize: '0.8rem' }}>Click <strong style={{ color: 'var(--text-secondary, #9ca3af)' }}>Add Rule</strong> to create your first one.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map(rule => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onEdit={(r) => { setShowForm(r); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              onDeactivate={(r) => setConfirmDeactivate(r)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
