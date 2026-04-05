/**
 * Departments — Manage POS department catalog.
 * Features: drag-to-reorder, showInPOS toggle, inline active toggle, CRUD.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-toastify';
import Sidebar from '../components/Sidebar';
import {
  getCatalogDepartments,
  createCatalogDepartment,
  updateCatalogDepartment,
  deleteCatalogDepartment,
} from '../services/api';
import {
  Plus, Edit2, Trash2, RotateCcw, X, Check,
  ShieldAlert, Leaf, Tag, Layers, GripVertical,
  Search, ToggleLeft, ToggleRight, Package, Monitor, Copy,
} from 'lucide-react';

// ─── ID Chip (click to copy) ──────────────────────────────────────────────────
function IdChip({ id }) {
  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(String(id));
    import('react-toastify').then(({ toast }) => toast.success(`Dept ID ${id} copied`, { autoClose: 1500 }));
  };
  return (
    <div
      onClick={copy}
      title="Click to copy Department ID"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700,
        color: '#7c3aed', background: 'rgba(124,58,237,0.1)',
        border: '1px solid rgba(124,58,237,0.22)',
        padding: '3px 7px', borderRadius: 5, cursor: 'pointer',
        userSelect: 'none', whiteSpace: 'nowrap',
        transition: 'background .15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(124,58,237,0.18)'}
      onMouseLeave={e => e.currentTarget.style.background = 'rgba(124,58,237,0.1)'}
    >
      #{id} <Copy size={9} />
    </div>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TAX_CLASSES = [
  { value: '',             label: 'None / Default' },
  { value: 'grocery',     label: 'Grocery' },
  { value: 'alcohol',     label: 'Alcohol' },
  { value: 'tobacco',     label: 'Tobacco' },
  { value: 'hot_food',    label: 'Hot Food' },
  { value: 'standard',    label: 'Standard' },
  { value: 'non_taxable', label: 'Non-Taxable' },
];

const TAX_COLORS = {
  grocery: '#10b981', alcohol: '#6366f1', tobacco: '#64748b',
  hot_food: '#f97316', standard: '#3b82f6', non_taxable: '#94a3b8', '': '#475569',
};

const PRESET_COLORS = [
  'var(--accent-primary)','#3b82f6','#8b5cf6','#ec4899',
  '#f59e0b','#ef4444','#14b8a6','#f97316',
  '#64748b','#0ea5e9','#a78bfa','#fb7185',
];

const EMPTY_FORM = {
  name: '', code: '', description: '',
  ageRequired: '', ebtEligible: false,
  taxClass: '', bottleDeposit: false,
  showInPOS: true, color: 'var(--accent-primary)', active: true,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function TaxBadge({ tc }) {
  const color = TAX_COLORS[tc] || TAX_COLORS[''];
  const label = TAX_CLASSES.find(t => t.value === tc)?.label || '—';
  return (
    <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: color + '22', color }}>
      {label}
    </span>
  );
}

function Toggle({ checked, onChange, size = 'md' }) {
  const w = size === 'sm' ? 28 : 34;
  const h = size === 'sm' ? 16 : 18;
  const r = size === 'sm' ? 8 : 9;
  const tw = size === 'sm' ? 12 : 14;
  const on = size === 'sm' ? 13 : 15;
  return (
    <div
      onClick={e => { e.stopPropagation(); onChange(!checked); }}
      style={{
        width: w, height: h, borderRadius: r, flexShrink: 0,
        background: checked ? 'var(--green, var(--accent-primary))' : 'var(--bg-tertiary, #2a2a3a)',
        position: 'relative', cursor: 'pointer',
        border: `1px solid ${checked ? 'var(--green, var(--accent-primary))' : 'var(--border-color, #3a3a4a)'}`,
        transition: 'background .2s',
      }}
    >
      <div style={{
        position: 'absolute', top: 1,
        left: checked ? on : 1,
        width: tw, height: tw, borderRadius: '50%',
        background: '#fff', transition: 'left .15s',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)',
      }} />
    </div>
  );
}

// ─── Department Form ───────────────────────────────────────────────────────────

function DeptForm({ dept, onSave, onClose, saving }) {
  const [form, setForm] = useState(dept ? {
    name:          dept.name || '',
    code:          dept.code || '',
    description:   dept.description || '',
    ageRequired:   dept.ageRequired ?? '',
    ebtEligible:   dept.ebtEligible ?? false,
    taxClass:      dept.taxClass || '',
    bottleDeposit: dept.bottleDeposit ?? false,
    showInPOS:     dept.showInPOS ?? true,
    color:         dept.color || 'var(--accent-primary)',
    active:        dept.active ?? true,
  } : { ...EMPTY_FORM });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const inputStyle = {
    width: '100%', padding: '0.55rem 0.75rem', borderRadius: 8,
    border: '1px solid var(--border-color, #2a2a3a)',
    background: 'var(--bg-tertiary, #1a1a2e)',
    color: 'var(--text-primary, #e2e8f0)',
    fontSize: '0.875rem', boxSizing: 'border-box',
  };
  const labelStyle = {
    fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)',
    letterSpacing: '0.05em', marginBottom: 5, display: 'block',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)' }} />
      <div style={{
        position: 'relative', zIndex: 1,
        width: 480, height: '100vh', overflowY: 'auto',
        background: 'var(--bg-secondary, #111827)',
        borderLeft: '1px solid var(--border-color, #2a2a3a)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,.4)',
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color, #2a2a3a)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, position: 'sticky', top: 0, zIndex: 2,
          background: 'var(--bg-secondary, #111827)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 8, height: 28, borderRadius: 4, background: form.color || 'var(--accent-primary)' }} />
            <div>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary, #e2e8f0)' }}>
                {dept ? 'Edit Department' : 'New Department'}
              </div>
              {dept && (
                <div
                  onClick={() => { navigator.clipboard.writeText(String(dept.id)); import('react-toastify').then(({ toast }) => toast.success(`Dept ID ${dept.id} copied`, { autoClose: 1500 })); }}
                  title="Click to copy Department ID"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 700, color: '#7c3aed', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.22)', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', userSelect: 'none' }}
                >
                  ID #{dept.id} <Copy size={9} />
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted, #6b7280)', padding: 4, display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem', flex: 1 }}>

          {/* Name + Code */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: '1rem' }}>
            <div>
              <label style={labelStyle}>DEPARTMENT NAME *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Alcohol, Grocery, Tobacco" style={inputStyle} />
            </div>
            <div style={{ width: 100 }}>
              <label style={labelStyle}>CODE</label>
              <input value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="ALCOH" maxLength={10}
                style={{ ...inputStyle, fontFamily: 'monospace', letterSpacing: '0.05em' }} />
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>DESCRIPTION</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="Optional description…" rows={2} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          {/* Color */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>COLOR (POS display)</label>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => set('color', c)} style={{
                  width: 28, height: 28, borderRadius: '50%', border: 'none',
                  background: c, cursor: 'pointer', flexShrink: 0,
                  outline: form.color === c ? `3px solid ${c}` : '3px solid transparent', outlineOffset: 2,
                  transform: form.color === c ? 'scale(1.2)' : 'scale(1)', transition: 'transform .12s',
                }} />
              ))}
              <input type="color" value={form.color} onChange={e => set('color', e.target.value)}
                style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--border-color, #2a2a3a)', background: 'none', cursor: 'pointer', padding: 0 }} title="Custom color" />
            </div>
          </div>

          {/* Tax Class */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>TAX CLASS</label>
            <select value={form.taxClass} onChange={e => set('taxClass', e.target.value)} style={inputStyle}>
              {TAX_CLASSES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Age */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>AGE RESTRICTION</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{ value: '', label: 'None' }, { value: '18', label: '18+' }, { value: '21', label: '21+' }].map(opt => (
                <button key={opt.value} onClick={() => set('ageRequired', opt.value)} style={{
                  flex: 1, padding: '0.55rem', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                  border: `1.5px solid ${form.ageRequired === opt.value ? '#f59e0b' : 'var(--border-color, #2a2a3a)'}`,
                  background: form.ageRequired === opt.value ? 'rgba(245,158,11,.1)' : 'var(--bg-tertiary, #1a1a2e)',
                  color: form.ageRequired === opt.value ? '#f59e0b' : 'var(--text-secondary, #9ca3af)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, transition: 'all .12s',
                }}>
                  {opt.value !== '' && <ShieldAlert size={13} />}{opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Flags box */}
          <div style={{ padding: '1rem', borderRadius: 10, border: '1px solid var(--border-color, #2a2a3a)', background: 'var(--bg-tertiary, #1a1a2e)', marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)', letterSpacing: '0.05em', marginBottom: '0.875rem' }}>DEPARTMENT FLAGS</div>
            {[
              { key: 'ebtEligible',   label: 'EBT / SNAP Eligible', desc: 'Products in this dept can be paid with EBT',  icon: Leaf,    color: '#10b981' },
              { key: 'bottleDeposit', label: 'Bottle Deposit',       desc: 'Auto-apply bottle deposit fees',              icon: Tag,     color: '#3b82f6' },
              { key: 'showInPOS',     label: 'Show in POS',          desc: 'Display this dept as a category in the POS',  icon: Monitor, color: 'var(--accent-primary)' },
            ].map(({ key, label, desc, icon: Icon, color }, idx, arr) => (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0',
                borderBottom: idx < arr.length - 1 ? '1px solid var(--border-color, #2a2a3a)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={15} color={color} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary, #e2e8f0)' }}>{label}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #6b7280)' }}>{desc}</div>
                  </div>
                </div>
                <Toggle checked={!!form[key]} onChange={v => set(key, v)} />
              </div>
            ))}
          </div>

          {/* Status */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>STATUS</label>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0.55rem 0.75rem', borderRadius: 8,
              border: '1px solid var(--border-color, #2a2a3a)',
              background: 'var(--bg-tertiary, #1a1a2e)', cursor: 'pointer',
            }} onClick={() => set('active', !form.active)}>
              <Toggle checked={form.active} onChange={v => set('active', v)} />
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: form.active ? 'var(--green, var(--accent-primary))' : 'var(--text-muted, #6b7280)' }}>
                {form.active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color, #2a2a3a)',
          display: 'flex', gap: 8, flexShrink: 0, position: 'sticky', bottom: 0,
          background: 'var(--bg-secondary, #111827)',
        }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '0.75rem', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
            border: '1px solid var(--border-color, #2a2a3a)', background: 'var(--bg-tertiary, #1a1a2e)', color: 'var(--text-secondary, #9ca3af)',
          }}>Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving || !form.name.trim()} style={{
            flex: 2, padding: '0.75rem', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '0.875rem',
            background: saving || !form.name.trim() ? 'var(--bg-tertiary, #2a2a3a)' : 'var(--green, var(--accent-primary))',
            color: saving || !form.name.trim() ? 'var(--text-muted, #6b7280)' : '#0f1117',
            cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Check size={15} />
            {saving ? 'Saving…' : dept ? 'Save Changes' : 'Create Department'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Draggable Row ─────────────────────────────────────────────────────────────

function DeptRow({ dept, index, onDragStart, onDragOver, onDrop, onDragEnd, draggingIdx, onEdit, onToggleActive, onTogglePOS, onDeactivate, onReactivate }) {
  const isDragging = draggingIdx === index;
  const isTarget   = draggingIdx !== null && draggingIdx !== index;

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={e => { e.preventDefault(); onDragOver(index); }}
      onDrop={() => onDrop(index)}
      onDragEnd={onDragEnd}
      style={{
        display: 'grid',
        gridTemplateColumns: '28px 60px 2fr 1fr 80px 60px 80px 90px',
        gap: '0 8px',
        padding: '0.75rem 1rem',
        alignItems: 'center',
        borderBottom: '1px solid var(--border-color, #1f2937)',
        opacity: isDragging ? 0.35 : dept.active ? 1 : 0.5,
        background: isDragging ? 'var(--brand-05)' : 'transparent',
        cursor: 'default',
        transition: 'opacity .15s, background .1s',
        outline: isTarget ? '2px dashed var(--brand-30)' : 'none',
        outlineOffset: -2,
      }}
    >
      {/* Drag handle */}
      <div
        title="Drag to reorder"
        style={{ cursor: 'grab', color: 'var(--text-muted, #475569)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}
        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
        onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
      >
        <GripVertical size={15} />
      </div>

      {/* ID chip */}
      <div><IdChip id={dept.id} /></div>

      {/* Name + Code */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: dept.color || '#475569', flexShrink: 0 }} />
          <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary, #e2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {dept.name}
          </span>
          {dept.code && (
            <span style={{ fontSize: '0.62rem', fontWeight: 800, fontFamily: 'monospace', padding: '1px 5px', borderRadius: 3, background: 'rgba(255,255,255,.06)', color: 'var(--text-muted, #6b7280)', letterSpacing: '0.05em', flexShrink: 0 }}>
              {dept.code}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, paddingLeft: 17 }}>
          <TaxBadge tc={dept.taxClass} />
          {dept.ebtEligible && <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(16,185,129,.15)', color: '#10b981' }}>EBT</span>}
          {dept.bottleDeposit && <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(59,130,246,.15)', color: '#3b82f6' }}>DEP</span>}
          {dept.ageRequired && (
            <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(245,158,11,.15)', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 2 }}>
              <ShieldAlert size={9} />{dept.ageRequired}+
            </span>
          )}
        </div>
      </div>

      {/* Description truncated */}
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {dept.description || '—'}
      </div>

      {/* Show in POS toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Toggle checked={dept.showInPOS !== false} onChange={v => onTogglePOS(dept, v)} size="sm" />
        <span style={{ fontSize: '0.68rem', color: dept.showInPOS !== false ? 'var(--green, var(--accent-primary))' : 'var(--text-muted, #6b7280)', fontWeight: 600 }}>
          {dept.showInPOS !== false ? 'Yes' : 'No'}
        </span>
      </div>

      {/* Active toggle */}
      <div>
        <Toggle checked={dept.active} onChange={v => v ? onReactivate(dept) : onDeactivate(dept.id)} size="sm" />
      </div>

      {/* Status badge */}
      <div>
        <span style={{
          fontSize: '0.68rem', fontWeight: 700, padding: '3px 8px', borderRadius: 4,
          background: dept.active ? 'var(--brand-12)' : 'rgba(100,116,139,.1)',
          color: dept.active ? 'var(--accent-primary)' : '#64748b',
        }}>
          {dept.active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button onClick={() => onEdit(dept)} title="Edit" style={{
          padding: 6, borderRadius: 6, border: 'none', background: 'rgba(255,255,255,.04)',
          cursor: 'pointer', color: 'var(--text-muted, #6b7280)', display: 'flex', alignItems: 'center',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-12)'; e.currentTarget.style.color = 'var(--accent-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.04)'; e.currentTarget.style.color = 'var(--text-muted, #6b7280)'; }}
        >
          <Edit2 size={13} />
        </button>
        <button onClick={() => onDeactivate(dept.id)} title="Deactivate" style={{
          padding: 6, borderRadius: 6, border: 'none', background: 'rgba(255,255,255,.04)',
          cursor: 'pointer', color: 'var(--text-muted, #6b7280)', display: 'flex', alignItems: 'center',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(224,63,63,.12)'; e.currentTarget.style.color = '#e03f3f'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.04)'; e.currentTarget.style.color = 'var(--text-muted, #6b7280)'; }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Departments() {
  const [depts,        setDepts]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [panelDept,    setPanelDept]    = useState(undefined);
  const [saving,       setSaving]       = useState(false);
  const [deleteId,     setDeleteId]     = useState(null);
  const [draggingIdx,  setDraggingIdx]  = useState(null);
  const [orderDirty,   setOrderDirty]   = useState(false);
  const [savingOrder,  setSavingOrder]  = useState(false);
  const dragOver = useRef(null);

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCatalogDepartments({ includeInactive: showInactive ? 'true' : 'false' });
      const list = res?.data || res || [];
      setDepts(Array.isArray(list) ? list : []);
      setOrderDirty(false);
    } catch {
      toast.error('Failed to load departments');
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => { load(); }, [load]);

  // ── Filtered (search applies only when not reordering) ────────────────────
  const filtered = search.trim()
    ? depts.filter(d => {
        const q = search.toLowerCase();
        return d.name?.toLowerCase().includes(q) || d.code?.toLowerCase().includes(q) || d.description?.toLowerCase().includes(q);
      })
    : depts;

  // ── Drag and drop ──────────────────────────────────────────────────────────
  const handleDragStart = (idx) => {
    setDraggingIdx(idx);
    dragOver.current = idx;
  };

  const handleDragOver = (idx) => {
    dragOver.current = idx;
  };

  const handleDrop = () => {
    if (draggingIdx === null || dragOver.current === null || draggingIdx === dragOver.current) return;
    const reordered = [...depts];
    const [moved] = reordered.splice(draggingIdx, 1);
    reordered.splice(dragOver.current, 0, moved);
    setDepts(reordered);
    setOrderDirty(true);
  };

  const handleDragEnd = () => {
    setDraggingIdx(null);
    dragOver.current = null;
  };

  // Save the new order
  const saveOrder = async () => {
    setSavingOrder(true);
    try {
      await Promise.all(
        depts.map((d, i) => updateCatalogDepartment(d.id, { sortOrder: i }))
      );
      toast.success('Sort order saved');
      setOrderDirty(false);
    } catch {
      toast.error('Failed to save order');
    } finally {
      setSavingOrder(false);
    }
  };

  // ── Save form ──────────────────────────────────────────────────────────────
  const handleSave = async (form) => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        ageRequired: form.ageRequired === '' ? null : parseInt(form.ageRequired),
        code:        form.code?.toUpperCase() || null,
      };
      if (panelDept?.id) {
        await updateCatalogDepartment(panelDept.id, payload);
        toast.success(`"${form.name}" updated`);
      } else {
        await createCatalogDepartment(payload);
        toast.success(`"${form.name}" created`);
      }
      setPanelDept(undefined);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save department');
    } finally {
      setSaving(false);
    }
  };

  // ── Inline toggles ─────────────────────────────────────────────────────────
  const togglePOS = async (dept, val) => {
    setDepts(d => d.map(x => x.id === dept.id ? { ...x, showInPOS: val } : x));
    try {
      await updateCatalogDepartment(dept.id, { showInPOS: val });
      toast.success(`"${dept.name}" ${val ? 'shown' : 'hidden'} in POS`);
    } catch {
      setDepts(d => d.map(x => x.id === dept.id ? { ...x, showInPOS: !val } : x));
      toast.error('Failed to update');
    }
  };

  const toggleActive = async (dept, val) => {
    setDepts(d => d.map(x => x.id === dept.id ? { ...x, active: val } : x));
    try {
      await updateCatalogDepartment(dept.id, { active: val });
      toast.success(`"${dept.name}" ${val ? 'activated' : 'deactivated'}`);
    } catch {
      setDepts(d => d.map(x => x.id === dept.id ? { ...x, active: !val } : x));
      toast.error('Failed to update');
    }
  };

  const handleDeactivate = async (id) => {
    const dept = depts.find(d => d.id === id);
    await toggleActive(dept, false);
    setDeleteId(null);
  };

  const handleReactivate = async (dept) => {
    await toggleActive(dept, true);
  };

  const cardStyle = {
    background: 'var(--bg-secondary, #111827)',
    border: '1px solid var(--border-color, #1f2937)',
    borderRadius: 12, overflow: 'hidden',
  };

  return (
    <div className="layout-container">
      <Sidebar />
      <div className="main-content" style={{ padding: '2rem', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--brand-12)', border: '1px solid var(--brand-20)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Layers size={20} color="var(--accent-primary)" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary, #e2e8f0)' }}>Departments</h1>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)' }}>Manage product categories · drag rows to reorder</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Save order button — only shown when order changed */}
            {orderDirty && (
              <button onClick={saveOrder} disabled={savingOrder} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 0.875rem', borderRadius: 8, border: 'none',
                background: '#f59e0b', color: '#0f1117', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
              }}>
                <Check size={13} />
                {savingOrder ? 'Saving…' : 'Save Order'}
              </button>
            )}
            <button onClick={() => setShowInactive(v => !v)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 0.875rem', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${showInactive ? 'var(--brand-30)' : 'var(--border-color, #2a2a3a)'}`,
              background: showInactive ? 'var(--brand-08)' : 'var(--bg-tertiary, #1a1a2e)',
              color: showInactive ? 'var(--accent-primary)' : 'var(--text-muted, #6b7280)', fontSize: '0.8rem', fontWeight: 600,
            }}>
              {showInactive ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
              {showInactive ? 'Showing All' : 'Show Inactive'}
            </button>
            <button onClick={() => setPanelDept(null)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '0.55rem 1.1rem', borderRadius: 8, border: 'none',
              background: 'var(--accent-primary)', color: '#0f1117', fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer',
            }}>
              <Plus size={15} /> New Department
            </button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: '1.5rem' }}>
          {[
            { label: 'Total',          value: depts.length,                              color: 'var(--accent-primary)', bg: 'var(--brand-08)' },
            { label: 'Active',         value: depts.filter(d => d.active).length,        color: '#10b981', bg: 'rgba(16,185,129,.08)' },
            { label: 'Shown in POS',   value: depts.filter(d => d.showInPOS !== false && d.active).length, color: '#3b82f6', bg: 'rgba(59,130,246,.08)' },
            { label: 'Age Restricted', value: depts.filter(d => d.ageRequired).length,   color: '#f59e0b', bg: 'rgba(245,158,11,.08)' },
          ].map(s => (
            <div key={s.label} style={{ padding: '0.875rem 1rem', borderRadius: 10, background: s.bg, border: `1px solid ${s.bg.replace('.08)', '.2)')}` }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)', marginTop: 3, letterSpacing: '0.04em' }}>{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: '1.25rem', maxWidth: 400 }}>
          <Search size={15} color="var(--text-muted, #6b7280)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search departments…" style={{
            width: '100%', paddingLeft: '2.25rem', paddingRight: '0.75rem', height: 38, borderRadius: 8, boxSizing: 'border-box',
            border: '1px solid var(--border-color, #2a2a3a)', background: 'var(--bg-tertiary, #1a1a2e)',
            color: 'var(--text-primary, #e2e8f0)', fontSize: '0.875rem',
          }} />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted, #6b7280)', padding: 2 }}>
              <X size={13} />
            </button>
          )}
        </div>

        {/* Table */}
        <div style={cardStyle}>
          {/* Header row */}
          <div style={{
            display: 'grid', gridTemplateColumns: '28px 60px 2fr 1fr 80px 60px 80px 90px',
            gap: '0 8px', padding: '0.5rem 1rem',
            borderBottom: '1px solid var(--border-color, #1f2937)',
            fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)',
            letterSpacing: '0.07em', background: 'var(--bg-tertiary, #0f172a)',
          }}>
            <span title="Drag to reorder" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <GripVertical size={11} />
            </span>
            <span style={{ color: '#7c3aed' }}>ID</span>
            <span>DEPARTMENT</span>
            <span>DESCRIPTION</span>
            <span>SHOW IN POS</span>
            <span>ACTIVE</span>
            <span>STATUS</span>
            <span />
          </div>

          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted, #6b7280)' }}>Loading departments…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <Package size={36} color="var(--text-muted, #6b7280)" style={{ opacity: 0.3, marginBottom: 10 }} />
              <div style={{ color: 'var(--text-muted, #6b7280)', fontWeight: 600 }}>
                {search ? 'No departments match your search.' : 'No departments yet — create your first one!'}
              </div>
            </div>
          ) : (
            filtered.map((dept, i) => (
              <DeptRow
                key={dept.id}
                dept={dept}
                index={i}
                draggingIdx={draggingIdx}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                onEdit={setPanelDept}
                onTogglePOS={togglePOS}
                onToggleActive={toggleActive}
                onDeactivate={id => setDeleteId(id)}
                onReactivate={handleReactivate}
              />
            ))
          )}
        </div>

        {/* Drag hint */}
        {!loading && filtered.length > 1 && !search && (
          <div style={{ marginTop: 8, fontSize: '0.72rem', color: 'var(--text-muted, #6b7280)', textAlign: 'center' }}>
            ↕ Drag rows to reorder · click <strong>Save Order</strong> to persist
          </div>
        )}

        {/* Deactivate confirm */}
        {deleteId && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.6)' }}>
            <div style={{ background: 'var(--bg-secondary, #111827)', border: '1px solid var(--border-color, #2a2a3a)', borderRadius: 14, padding: '1.5rem', maxWidth: 360, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary, #e2e8f0)', marginBottom: 8 }}>Deactivate Department?</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                This department will be hidden from the POS. Products won't be deleted. You can reactivate it anytime.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setDeleteId(null)} style={{ flex: 1, padding: '0.7rem', borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border-color, #2a2a3a)', background: 'var(--bg-tertiary, #1a1a2e)', color: 'var(--text-secondary, #9ca3af)', fontWeight: 600 }}>Cancel</button>
                <button onClick={() => handleDeactivate(deleteId)} style={{ flex: 1, padding: '0.7rem', borderRadius: 8, cursor: 'pointer', border: 'none', background: '#e03f3f', color: '#fff', fontWeight: 700 }}>Deactivate</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Form panel */}
      {panelDept !== undefined && (
        <DeptForm dept={panelDept} onSave={handleSave} onClose={() => setPanelDept(undefined)} saving={saving} />
      )}
    </div>
  );
}
