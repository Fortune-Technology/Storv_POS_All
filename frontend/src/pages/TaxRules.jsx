/**
 * TaxRules — Back-office management of tax slabs per organisation.
 * CRUD via GET/POST/PUT/DELETE /api/catalog/tax-rules
 *
 * Fields per rule:
 *   name, rate (%), ebtExempt, state, departmentIds[], storeId, active
 *
 * Session 56  — `description` and `county` removed (cosmetic only).
 * Session 56b — `appliesTo` (legacy class matcher) removed entirely. Rules
 *               now MUST target one or more departments via `departmentIds[]`.
 *               State is auto-prefilled from Store.stateCode for single-state
 *               orgs and is used only for visual grouping in the rules list
 *               when an org has rules tagged with multiple distinct states.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  getCatalogTaxRules,
  createCatalogTaxRule,
  updateCatalogTaxRule,
  deleteCatalogTaxRule,
  getCatalogDepartments,
  getStores,
} from '../services/api';
import {
  Percent, Plus, Pencil, Trash2, Check, X as XIcon,
  AlertCircle, ChevronDown, ChevronRight, Info,
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

// Session 56b — `APPLIES_TO_OPTIONS` constant removed. Legacy class matcher
// is gone entirely; rules target departments only. Multi-select chips below
// in the form replace the old class dropdown.

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
  name: '', rate: '',
  departmentIds: [],                // The ONLY matcher (Session 56b)
  ebtExempt: true, state: '',
};

// ── Toggle chip ────────────────────────────────────────────────────────────
function ToggleChip({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0.35rem 0.85rem',
        borderRadius: 6,
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
  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    ...initial,
    departmentIds: Array.isArray(initial?.departmentIds) ? initial.departmentIds.map(n => Number(n)) : [],
  }));
  const [err,  setErr]  = useState('');
  const [depts, setDepts] = useState([]);
  const [deptsLoading, setDeptsLoading] = useState(true);
  // Multi-state grouping toggle — collapsed by default. Auto-opens when
  // editing a rule that already has a state set, so the value isn't hidden.
  const [advancedOpen, setAdvancedOpen] = useState(() => Boolean(initial?.state));
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Load departments for the multi-select — Option B's primary matcher.
  useEffect(() => {
    let cancelled = false;
    getCatalogDepartments()
      .then(d => { if (!cancelled) setDepts(Array.isArray(d?.data) ? d.data : (Array.isArray(d) ? d : [])); })
      .catch(() => { if (!cancelled) setDepts([]); })
      .finally(() => { if (!cancelled) setDeptsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const toggleDept = (deptId) => {
    const id = Number(deptId);
    setForm(f => {
      const has = f.departmentIds.includes(id);
      return { ...f, departmentIds: has ? f.departmentIds.filter(x => x !== id) : [...f.departmentIds, id] };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    if (form.rate === '' || isNaN(Number(form.rate)) || Number(form.rate) < 0 || Number(form.rate) > 100) {
      setErr('Rate must be a number between 0 and 100.'); return;
    }
    // Session 56b — a rule MUST target at least one department. Departments
    // are the only matcher now (legacy class matcher removed). For org-wide
    // "tax everything" rules, link to every department in the org.
    if (!form.departmentIds || form.departmentIds.length === 0) {
      setErr('Pick at least one department. Use "Select All" if this rate applies to every department.'); return;
    }
    setErr('');
    // The form collects the rate as a percent (e.g. "5.5" for 5.5%). The DB
    // stores it as a decimal fraction (0.055) because that's how it's applied
    // at checkout: lineTotal × rate. Convert on save; reverse on edit-load.
    // Session 56  — `description` / `county` removed from schema; not sent.
    // Session 56b — `appliesTo` removed from schema; not sent.
    await onSave({
      name:          form.name.trim(),
      rate:          parseFloat(form.rate) / 100,
      departmentIds: form.departmentIds || [],
      ebtExempt:     form.ebtExempt,
      state:         form.state || null,
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

        {/* Departments multi-select — primary matcher (Option B) */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>APPLIES TO DEPARTMENTS *</label>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8 }}>
            Pick the departments this rate applies to. Use your own department names — works across states and countries.
          </div>
          {deptsLoading ? (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0.5rem' }}>Loading departments…</div>
          ) : depts.length === 0 ? (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0.5rem', border: '1px dashed var(--border-color)', borderRadius: 6 }}>
              No departments yet. <a href="/portal/departments" style={{ color: 'var(--accent-primary)' }}>Create one →</a>
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {depts.map(d => {
                const selected = form.departmentIds.includes(Number(d.id));
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggleDept(d.id)}
                    style={{
                      padding: '0.35rem 0.7rem',
                      borderRadius: 7,
                      border: `1px solid ${selected ? 'var(--brand-primary)' : 'var(--border-color)'}`,
                      background: selected ? 'var(--brand-10)' : 'var(--bg-card)',
                      color: selected ? 'var(--brand-primary)' : 'var(--text-secondary)',
                      fontWeight: 600, fontSize: '0.78rem',
                      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
                    }}>
                    {selected && <Check size={10} strokeWidth={3} />}
                    {d.name}
                  </button>
                );
              })}
            </div>
          )}
          {form.departmentIds.length > 0 && (
            <div style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', marginTop: 6 }}>
              ✓ {form.departmentIds.length} department{form.departmentIds.length === 1 ? '' : 's'} selected
            </div>
          )}
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

        {/* ── Advanced options disclosure ─────────────────────────────────
           Collapsed by default. Holds the multi-state grouping picker. State
           is auto-prefilled from Store.stateCode by the parent page so
           single-state orgs never need to open this — it's only useful for
           multi-state chains that want their rules grouped by state in the
           list view. */}
        <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setAdvancedOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '0.4rem 0.6rem',
              background: 'transparent', border: 'none',
              color: 'var(--text-secondary, #9ca3af)',
              fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
              letterSpacing: '0.02em',
            }}
          >
            {advancedOpen
              ? <ChevronDown size={14} />
              : <ChevronRight size={14} />}
            Advanced options
            <span style={{ opacity: 0.55, marginLeft: 4, fontWeight: 500, fontSize: '0.72rem' }}>
              Multi-state grouping
            </span>
          </button>
        </div>

        {advancedOpen && (
          <div>
            <label style={labelStyle}>STATE (MULTI-STATE GROUPING)</label>
            <div style={{ position: 'relative' }}>
              <select style={{ ...inp, paddingRight: '2rem', cursor: 'pointer' }}
                value={form.state} onChange={e => set('state', e.target.value)}>
                <option value="">— None —</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted, #6b7280)' }} />
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Optional. Used only for grouping in the rules list when an org has rules tagged with multiple states.
            </div>
          </div>
        )}
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

      {/* Info — name + matcher chip + EBT exempt chip.
          Description and state/county labels deliberately not rendered:
          • description was redundant with name
          • state/county were misleading — they look like they gate the rule
            but tax matching ignores them entirely. They survive in the
            schema for back-compat but no longer surface here. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary, #e2e8f0)', marginBottom: 4 }}>
          {rule.name}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          {Array.isArray(rule.departmentIds) && rule.departmentIds.length > 0 ? (
            <span style={{
              fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.55rem',
              borderRadius: 8,
              background: 'var(--brand-10)', color: 'var(--brand-primary)',
              border: '1px solid var(--brand-25)',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }} title={`Department IDs: ${rule.departmentIds.join(', ')}`}>
              {rule.departmentIds.length} dept{rule.departmentIds.length === 1 ? '' : 's'}
            </span>
          ) : (
            <span style={{
              fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.55rem',
              borderRadius: 8,
              background: 'rgba(245, 158, 11, 0.15)', color: '#d97706',
              border: '1px solid rgba(245, 158, 11, 0.3)',
            }} title="This rule has no departments — it will not apply to any product. Edit and pick at least one department.">
              ⚠ No departments
            </span>
          )}
          {rule.ebtExempt && (
            <span style={{
              fontSize: '0.68rem', fontWeight: 700, padding: '0.15rem 0.45rem',
              borderRadius: 8, background: 'rgba(52,211,153,.08)', color: '#34d399',
              border: '1px solid rgba(52,211,153,.2)',
            }}>EBT Exempt</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button onClick={() => onEdit(rule)} title="Edit rule" style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'var(--bg-tertiary, #f1f5f9)', border: '1px solid var(--border-color, #e2e8f0)',
          color: 'var(--text-secondary, #475569)', cursor: 'pointer',
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
  // Auto-fill state for new rules — Session 56. When the org has stores in
  // exactly ONE state, prefill the (Advanced) state field with that state
  // code so the rule lands in the right grouping bucket without the admin
  // having to think about it. Multi-state orgs get an empty default and
  // pick manually in Advanced. Falls back to '' (no state) when stores
  // haven't been tagged with a stateCode yet.
  const [defaultStateCode, setDefaultStateCode] = useState('');

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

  // Derive single-state default from the org's stores. If every store with a
  // stateCode shares the same code, that becomes the auto-fill for new rules.
  // Mixed states (or no stateCode set anywhere) → leave default empty.
  useEffect(() => {
    let cancelled = false;
    getStores()
      .then(list => {
        if (cancelled) return;
        const codes = (Array.isArray(list) ? list : [])
          .map(s => s.stateCode)
          .filter(Boolean);
        const unique = Array.from(new Set(codes));
        if (unique.length === 1) setDefaultStateCode(unique[0]);
      })
      .catch(() => { /* silent — auto-fill is a nice-to-have */ });
    return () => { cancelled = true; };
  }, []);

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

  // Group rules by state for display ONLY when the org actually has rules
  // tagged with multiple distinct states. Single-state (or all-org-wide)
  // orgs see a flat list — the "ORG-WIDE (ALL STATES)" group header on a
  // single-state org was just visual noise that implied state-based logic
  // exists when it doesn't.
  const distinctStates = new Set(rules.map(r => r.state).filter(Boolean));
  const showByState    = distinctStates.size >= 2;
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
            <p className="p-subtitle">Tax rates by department</p>
          </div>
        </div>
        <div className="p-header-actions">
          {!showForm && (
            <button className="p-btn p-btn-primary" onClick={() => setShowForm('new')}>
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
          At checkout, each product&apos;s tax is determined by the rule that matches its department. Rules with
          <strong> EBT Exempt</strong> on are waived for EBT-eligible items. Multi-state chains can scope rules to
          specific stores via the per-store override (Advanced).
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
          initial={showForm === 'new' ? { ...EMPTY_FORM, state: defaultStateCode } : {
            name:          showForm.name,
            // DB stores rate as decimal fraction (0.055) — display in the
            // form as percent (5.5) to match the "%" label the user sees.
            rate:          String(+(Number(showForm.rate) * 100).toFixed(4)),
            departmentIds: Array.isArray(showForm.departmentIds) ? showForm.departmentIds : [],
            ebtExempt:     showForm.ebtExempt !== false,
            state:         showForm.state || '',
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
          N/A — no active tax rules configured.<br />
          <span style={{ fontSize: '0.8rem' }}>Click <strong style={{ color: 'var(--text-secondary, #9ca3af)' }}>Add Tax Rule</strong> to create your first slab.</span>
        </div>
      ) : showByState ? (
        // Multi-state org: group by state for clarity
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
                {stateKey === 'Org-wide' ? 'ORG-WIDE' : stateKey}
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
      ) : (
        // Single-state or all-org-wide: flat list
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map(rule => (
            <TaxRuleCard
              key={rule.id}
              rule={rule}
              onEdit={(r) => { setShowForm(r); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              onDelete={(r) => setConfirmDelete(r)}
            />
          ))}
        </div>
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
