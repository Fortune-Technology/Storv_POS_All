/**
 * Departments — Manage POS department catalog.
 * Features: drag-to-reorder, showInPOS toggle, inline active toggle, CRUD.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-toastify';

import './Departments.css';
import {
  getCatalogDepartments,
  createCatalogDepartment,
  updateCatalogDepartment,
  deleteCatalogDepartment,
} from '../services/api';
import {
  Plus, Edit2, Trash2, RotateCcw, X, Check,
  ShieldAlert, AlertTriangle, Leaf, Layers, GripVertical,
  Search, ToggleLeft, ToggleRight, Package, Monitor, Copy,
} from 'lucide-react';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';

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

// Last-resort fallback ONLY when the store has zero TaxRules configured —
// renders so the dropdown isn't empty during first-time setup. Once the
// user creates TaxRules in Rules & Fees, the dropdown reads from those
// and this list is ignored.
const TAX_CLASS_FALLBACK = [
  { value: '',             label: 'None / Default' },
  { value: 'grocery',      label: 'Grocery' },
  { value: 'alcohol',      label: 'Alcohol' },
  { value: 'tobacco',      label: 'Tobacco' },
  { value: 'hot_food',     label: 'Hot Food' },
  { value: 'standard',     label: 'Standard' },
  { value: 'non_taxable',  label: 'Non-Taxable' },
];

// Session 56b — `Department.taxClass` is now purely an age-policy hint
// (tobacco / alcohol detection at checkout). It is no longer used for tax
// matching. The dropdown options below are the canonical small set of
// age-relevant categories. Previous version built options dynamically from
// `TaxRule.appliesTo` strings — that column was removed.
const CATEGORY_LABEL = {
  grocery: 'Grocery', alcohol: 'Alcohol', tobacco: 'Tobacco',
  hot_food: 'Hot Food', standard: 'Standard', non_taxable: 'Non-Taxable',
};
const prettyCategory = (key) => CATEGORY_LABEL[key] || key.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

function buildTaxClassOptionsFromRules() {
  return [
    { value: '',            label: 'None / Default' },
    { value: 'grocery',     label: 'Grocery' },
    { value: 'alcohol',     label: 'Alcohol (21+)' },
    { value: 'tobacco',     label: 'Tobacco (21+)' },
    { value: 'hot_food',    label: 'Hot Food / Prepared' },
    { value: 'standard',    label: 'Standard' },
    { value: 'non_taxable', label: 'Non-Taxable' },
  ];
}

const TAX_COLORS = {
  grocery: '#10b981', alcohol: 'var(--accent-primary)', tobacco: '#64748b',
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
  category: '',
};

const CATEGORY_OPTIONS = [
  { value: '',        label: '— Not set —' },
  { value: 'general', label: 'General (no standard fields)' },
  { value: 'wine',    label: 'Wine (Vintage, Varietal, ABV…)' },
  { value: 'liquor',  label: 'Liquor / Spirits (Type, Proof, ABV…)' },
  { value: 'beer',    label: 'Beer (Style, Container, ABV…)' },
  { value: 'tobacco', label: 'Tobacco / Vape (Type, Nicotine, Flavour…)' },
];

// Cascadable fields = fields that exist on BOTH Department and MasterProduct
// and are safe to overwrite at the product level when an admin opts in via
// the cascade-edit modal. Mirror of the backend allowlist in
// `catalogController.CASCADABLE_DEPT_FIELDS` — keep in sync.
const CASCADABLE_FIELDS = [
  { key: 'taxClass',    label: 'Category (age policy)' },
  { key: 'ageRequired', label: 'Age Required' },
  { key: 'ebtEligible', label: 'EBT Eligible' },
];

// Detect which cascadable fields changed between the existing dept record
// and the form payload. Used to drive the cascade-prompt modal.
function detectCascadableChanges(prev, next) {
  const out = [];
  for (const { key, label } of CASCADABLE_FIELDS) {
    const a = prev?.[key];
    const b = next?.[key];
    // Normalize empty/null/undefined so "" === null comparisons work.
    const norm = (v) => (v === '' || v === undefined || v === null) ? null : v;
    if (norm(a) !== norm(b)) {
      out.push({ field: key, label, before: norm(a), after: norm(b) });
    }
  }
  return out;
}

// Same auto-guess as the backend — used to suggest a category when the user
// types a dept name so retailers get a sensible default without clicking.
function guessDeptCategory(name = '', code = '') {
  const n = name.toLowerCase();
  const c = code.toLowerCase();
  if (c === 'wine' || n.includes('wine') || n.includes('champagne') || n.includes('vino')) return 'wine';
  if (c === 'beer' || n.includes('beer') || n.includes('cerveza') || n.includes('cider') || n.includes('malt')) return 'beer';
  if (['liquor','spirits','spirit','liq','spir'].includes(c) || n.includes('liquor') || n.includes('spirit') || n.includes('whiskey') || n.includes('licor')) return 'liquor';
  if (['tobac','tobacco','vape','smoke'].some(t => c.includes(t)) || n.includes('tobacco') || n.includes('vape') || n.includes('cigar') || n.includes('smoke')) return 'tobacco';
  return '';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function TaxBadge({ tc }) {
  const color = TAX_COLORS[tc] || TAX_COLORS[''];
  const label = tc ? prettyCategory(tc) : 'N/A';
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

function DeptForm({ dept, onSave, onClose, saving, taxClassOptions }) {
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
    category:      dept.category || '',
  } : { ...EMPTY_FORM });

  // Flag if the user has ever manually touched the category dropdown,
  // so we don't overwrite their explicit choice while they're still typing.
  const [categoryTouched, setCategoryTouched] = useState(!!(dept?.category));

  const set = (k, v) => setForm(f => {
    const next = { ...f, [k]: v };
    // Auto-guess category from name/code (only for NEW depts where the
    // retailer hasn't made an explicit choice). Keeps the dropdown lively.
    if (!dept && !categoryTouched && (k === 'name' || k === 'code')) {
      const guess = guessDeptCategory(next.name, next.code);
      next.category = guess;
    }
    return next;
  });

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

          {/* Category — drives the preset attributes (Wine/Liquor/Beer/Tobacco) */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>CATEGORY <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>(drives standard fields on products)</span></label>
            <select
              value={form.category}
              onChange={e => { setCategoryTouched(true); set('category', e.target.value); }}
              style={inputStyle}
            >
              {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {form.category && form.category !== 'general' && (
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Products in this department will show the standard {form.category} fields on their form (Vintage, ABV, etc.). You can customize them via <em>Manage Attributes</em>.
              </div>
            )}
          </div>

          {/* Tax Class — options come from the store's actual Tax Rules.
              Each option's label is "Category — rate%" pulled from the
              matching TaxRule. Falls back to a default category list when
              no rules exist yet. */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>TAX CLASS</label>
            <select value={form.taxClass} onChange={e => set('taxClass', e.target.value)} style={inputStyle}>
              {(taxClassOptions || TAX_CLASS_FALLBACK).map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Tax rates are managed in <em>Rules &amp; Fees → Tax</em>. Add a rule there and it appears here.
            </div>
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
            // Primary save button: indigo brand bg with white text. Disabled state
            // uses tertiary bg + muted text. Previously the text was hardcoded to
            // near-black (#0f1117) which was unreadable against the indigo accent
            // — kept from a dark-theme-era green button. White is the right
            // contrast against any brand-coloured background we'd swap in.
            background: saving || !form.name.trim() ? 'var(--bg-tertiary, #2a2a3a)' : 'var(--accent-primary, var(--brand-primary))',
            color: saving || !form.name.trim() ? 'var(--text-muted, #6b7280)' : '#ffffff',
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

function DeptRow({ dept, index, onDragStart, onDragOver, onDrop, onDragEnd, draggingIdx, onEdit, onManageAttrs, onToggleActive, onTogglePOS, onDeactivate, onReactivate }) {
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
          {dept.ageRequired && (
            <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(245,158,11,.15)', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 2 }}>
              <ShieldAlert size={9} />{dept.ageRequired}+
            </span>
          )}
        </div>
      </div>

      {/* Description truncated */}
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {dept.description || 'N/A'}
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
        <button onClick={() => onManageAttrs(dept)} title="Manage Attributes" style={{
          padding: 6, borderRadius: 6, border: 'none', background: 'rgba(255,255,255,.04)',
          cursor: 'pointer', color: 'var(--text-muted, #6b7280)', display: 'flex', alignItems: 'center',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,.12)'; e.currentTarget.style.color = '#7c3aed'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.04)'; e.currentTarget.style.color = 'var(--text-muted, #6b7280)'; }}
        >
          <Layers size={13} />
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

// ─── Cascade Modal ─────────────────────────────────────────────────────────
// Shown when the admin saves a dept edit that changed one of the cascadable
// fields (taxClass / ageRequired / ebtEligible). Three outcomes:
//   • Cancel             — back out of save entirely (admin keeps editing)
//   • Save dept only     — persist dept changes, leave products untouched
//   • Apply to all       — persist dept changes AND overwrite the changed
//                          fields on every product in the dept
function CascadePromptModal({ deptName, productCount, changes, onCancel, onSaveOnly, onApplyAll, saving }) {
  // Pretty-print a single field's before/after value
  const formatVal = (v) => {
    if (v === null || v === undefined || v === '') return <em style={{ color: 'var(--text-muted)' }}>none</em>;
    if (v === true)  return 'Yes';
    if (v === false) return 'No';
    return String(v);
  };

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(540px, 100%)',
          background: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--border-color, #e5e7eb)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(245, 158, 11, 0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <ShieldAlert size={18} color="#d97706" />
          </div>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
              Apply changes to all products?
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
              Department: <strong>{deptName}</strong> · {productCount} product{productCount === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.85rem', color: '#334155', marginBottom: 10 }}>
            You changed these fields on this department:
          </div>

          {/* Field changes table */}
          <div style={{
            border: '1px solid #e2e8f0', borderRadius: 8,
            background: '#f8fafc', overflow: 'hidden',
          }}>
            {changes.map((c, i) => (
              <div key={c.field} style={{
                padding: '0.55rem 0.85rem',
                borderTop: i === 0 ? 'none' : '1px solid #e2e8f0',
                display: 'grid',
                gridTemplateColumns: '1fr auto 16px auto',
                alignItems: 'center', gap: 10,
                fontSize: '0.82rem',
              }}>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{c.label}</span>
                <span style={{ color: '#94a3b8', fontFamily: 'ui-monospace, monospace', textDecoration: 'line-through' }}>
                  {formatVal(c.before)}
                </span>
                <span style={{ color: '#94a3b8' }}>→</span>
                <span style={{ color: '#0f172a', fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
                  {formatVal(c.after)}
                </span>
              </div>
            ))}
          </div>

          {/* Warning */}
          <div style={{
            marginTop: 12,
            padding: '0.6rem 0.85rem',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            borderRadius: 8,
            fontSize: '0.78rem',
            color: '#92400e',
            display: 'flex', alignItems: 'flex-start', gap: 6,
          }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Choosing <strong>Apply to all products</strong> overwrites these fields on every product in this
              department — including products where these fields were customised individually.
            </span>
          </div>
        </div>

        {/* Actions — visual hierarchy: SAFE choice is loud, destructive
            choice is subtle. Layout right-to-left: Cancel (most subtle) is
            leftmost, "Save department only" (PRIMARY — solid brand colour
            with default focus) is rightmost so it's where the user's hand
            lands. "Apply to all products" sits in the middle as an amber
            outlined button — clearly a deliberate choice, not the default. */}
        <div style={{
          padding: '0.85rem 1.25rem',
          borderTop: '1px solid var(--border-color, #e5e7eb)',
          display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap',
        }}>
          {/* Cancel — most subtle, leftmost */}
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={{
              padding: '0.5rem 1rem', borderRadius: 8,
              background: 'transparent', border: '1px solid #cbd5e1',
              color: '#475569', fontWeight: 600, fontSize: '0.85rem',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          {/* Apply to all — destructive, amber outlined ghost so it never
              looks like the default action. Smaller, lower-contrast text. */}
          <button
            type="button"
            onClick={onApplyAll}
            disabled={saving}
            style={{
              padding: '0.5rem 0.9rem', borderRadius: 8,
              background: 'transparent',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              color: '#b45309', fontWeight: 600, fontSize: '0.8rem',
              cursor: saving ? 'not-allowed' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}
          >
            {saving ? 'Applying…' : <><AlertTriangle size={12} /> Apply to all products</>}
          </button>
          {/* Save department only — DEFAULT, primary brand button. autoFocus
              so a stray Enter keypress hits the safe action, not the cascade. */}
          <button
            type="button"
            onClick={onSaveOnly}
            disabled={saving}
            autoFocus
            style={{
              padding: '0.55rem 1.4rem', borderRadius: 8,
              background: saving ? '#94a3b8' : 'var(--accent-primary, #3d56b5)',
              border: 'none',
              color: '#fff', fontWeight: 800, fontSize: '0.9rem',
              cursor: saving ? 'not-allowed' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              boxShadow: saving ? 'none' : '0 2px 8px rgba(61, 86, 181, 0.35)',
            }}
          >
            {saving ? 'Saving…' : <><Check size={14} strokeWidth={3} /> Save department only</>}
          </button>
        </div>
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
  const [attrsDept,    setAttrsDept]    = useState(null); // dept currently shown in Manage Attributes panel
  const [saving,       setSaving]       = useState(false);
  const [deleteId,     setDeleteId]     = useState(null);
  const [draggingIdx,  setDraggingIdx]  = useState(null);
  const [orderDirty,   setOrderDirty]   = useState(false);
  const [savingOrder,  setSavingOrder]  = useState(false);
  // Tax-class dropdown options are derived from the store's actual TaxRules
  // (Rules & Fees page → Tax tab). Falls back to TAX_CLASS_FALLBACK when
  // the store has zero rules configured — same names the cashier-app uses
  // as defaults so first-time setup doesn't break.
  const [taxClassOptions, setTaxClassOptions] = useState(TAX_CLASS_FALLBACK);
  const dragOver = useRef(null);

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Session 56b — taxClass dropdown options are now a static canonical
      // set (age-policy categories), so we no longer fetch tax rules here.
      const deptRes = await getCatalogDepartments({ includeInactive: showInactive ? 'true' : 'false' });
      const list = deptRes?.data || deptRes || [];
      setDepts(Array.isArray(list) ? list : []);
      setOrderDirty(false);
      setTaxClassOptions(buildTaxClassOptionsFromRules());
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

  // Cascade-prompt state — set when the admin saves a dept edit and one of
  // the three fields that exist on both Department and MasterProduct
  // (taxClass / ageRequired / ebtEligible) actually changed. The 3-button
  // modal asks: cancel / save dept only / save AND apply to all products.
  const [cascadePrompt, setCascadePrompt] = useState(null);
  // Shape: { payload, changes: [{ field, label, before, after }], productCount }

  // ── Save form ──────────────────────────────────────────────────────────────
  const handleSave = async (form) => {
    if (!form.name.trim()) return;
    const payload = {
      ...form,
      ageRequired: form.ageRequired === '' ? null : parseInt(form.ageRequired),
      code:        form.code?.toUpperCase() || null,
    };

    // CREATE — no cascade question (no products linked yet by definition).
    if (!panelDept?.id) {
      await persistDeptSave(payload, false);
      return;
    }

    // EDIT — detect which cascadable fields changed. If any did AND the dept
    // has products, prompt the admin. Otherwise save silently.
    const changes = detectCascadableChanges(panelDept, payload);
    const productCount = panelDept._count?.products ?? 0;
    if (changes.length > 0 && productCount > 0) {
      setCascadePrompt({ payload, changes, productCount, deptName: form.name });
      return;
    }

    // No cascadable change OR dept has zero products — save plain.
    await persistDeptSave(payload, false);
  };

  // Actually hits the API. `cascade` true = also overwrite the changed fields
  // on every product in this dept. Always called via either `handleSave`
  // directly (no cascade) or via the cascade modal's confirm path.
  const persistDeptSave = async (payload, cascade) => {
    setSaving(true);
    try {
      if (panelDept?.id) {
        const fields = cascade
          ? detectCascadableChanges(panelDept, payload).map(c => c.field)
          : [];
        const res = await updateCatalogDepartment(panelDept.id, {
          ...payload,
          ...(cascade && fields.length > 0 ? { cascadeToProducts: true, cascadedFields: fields } : {}),
        });
        const productsUpdated = res?.productsUpdated || res?.data?.productsUpdated || 0;
        toast.success(
          cascade && productsUpdated > 0
            ? `"${payload.name}" updated · ${productsUpdated} product${productsUpdated === 1 ? '' : 's'} cascaded`
            : `"${payload.name}" updated`,
        );
      } else {
        await createCatalogDepartment(payload);
        toast.success(`"${payload.name}" created`);
      }
      setPanelDept(undefined);
      setCascadePrompt(null);
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
    borderRadius: 12,
    overflowX: 'auto',    // enable horizontal scroll for small viewports
    overflowY: 'hidden',
  };
  // Inner width floor: columns sum ≈ 28+60+(2fr)+(1fr)+80+60+80+90+gaps ≈ 650px min.
  const tableMinWidth = { minWidth: 860 };

  return (
      <div className="p-page">

        {/* Header */}
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <Layers size={22} />
            </div>
            <div>
              <h1 className="p-title">Departments</h1>
              <p className="p-subtitle">Manage product categories · drag rows to reorder</p>
            </div>
          </div>
          <div className="p-header-actions">
            {orderDirty && (
              <button onClick={saveOrder} disabled={savingOrder} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 0.875rem', borderRadius: 8, border: 'none',
                background: '#f59e0b', color: '#ffffff', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
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
              background: 'var(--accent-primary)', color: '#ffffff', fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer',
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
         <div style={tableMinWidth}>
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
                {search ? 'N/A — no departments match your search.' : 'N/A — no departments found. Create your first one!'}
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
                onManageAttrs={setAttrsDept}
                onTogglePOS={togglePOS}
                onToggleActive={toggleActive}
                onDeactivate={id => setDeleteId(id)}
                onReactivate={handleReactivate}
              />
            ))
          )}
         </div>
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
        {/* Form panel */}
        {panelDept !== undefined && (
          <DeptForm dept={panelDept} onSave={handleSave} onClose={() => setPanelDept(undefined)} saving={saving} taxClassOptions={taxClassOptions} />
        )}
        {/* Manage Attributes panel */}
        {attrsDept && (
          <AttrsPanel dept={attrsDept} onClose={() => setAttrsDept(null)} />
        )}
        {/* Cascade-edit prompt — fires when a dept edit changes a field that
            also exists on its products (taxClass / ageRequired / ebtEligible)
            and the dept has at least one product. Three outcomes: cancel /
            save dept only / save AND apply to all products. */}
        {cascadePrompt && (
          <CascadePromptModal
            deptName={cascadePrompt.deptName}
            productCount={cascadePrompt.productCount}
            changes={cascadePrompt.changes}
            saving={saving}
            onCancel={() => setCascadePrompt(null)}
            onSaveOnly={() => persistDeptSave(cascadePrompt.payload, false)}
            onApplyAll={() => persistDeptSave(cascadePrompt.payload, true)}
          />
        )}
      </div>
  );
}

// ─── Manage Attributes side panel ─────────────────────────────────────────────

function AttrsPanel({ dept, onClose }) {
  const confirm = useConfirm();
  const [attrs, setAttrs]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [addForm, setAddForm] = useState({ key: '', label: '', dataType: 'text', unit: '', placeholder: '', options: '', required: false });
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await import('../services/api').then(m => m.getDepartmentAttributes({ departmentId: dept.id }));
      // Filter to this dept only (exclude org-wide attrs to keep the UI focused)
      const rows = (res?.data ?? []).filter(a => a.departmentId === dept.id);
      setAttrs(rows);
    } catch {
      setAttrs([]);
    } finally {
      setLoading(false);
    }
  }, [dept.id]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!addForm.key.trim() || !addForm.label.trim()) {
      import('react-toastify').then(({ toast }) => toast.error('Key and label are required'));
      return;
    }
    setSaving(true);
    try {
      const api = await import('../services/api');
      await api.createDepartmentAttribute({
        departmentId: dept.id,
        key:          addForm.key.trim(),
        label:        addForm.label.trim(),
        dataType:     addForm.dataType,
        unit:         addForm.unit.trim() || null,
        placeholder:  addForm.placeholder.trim() || null,
        required:     addForm.required,
        options:      addForm.options ? addForm.options.split(',').map(s => s.trim()).filter(Boolean) : [],
      });
      setAddForm({ key: '', label: '', dataType: 'text', unit: '', placeholder: '', options: '', required: false });
      await load();
      import('react-toastify').then(({ toast }) => toast.success('Attribute added'));
    } catch (e) {
      import('react-toastify').then(({ toast }) => toast.error(e.response?.data?.error || 'Failed to add'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!await confirm({
      title: 'Delete attribute?',
      message: 'Any values already stored on products will become freeform "Other Details".',
      confirmLabel: 'Delete',
      danger: true,
    })) return;
    try {
      const api = await import('../services/api');
      await api.deleteDepartmentAttribute(id);
      setAttrs(as => as.filter(a => a.id !== id));
    } catch (e) {
      import('react-toastify').then(({ toast }) => toast.error(e.response?.data?.error || 'Failed to delete'));
    }
  };

  const handleSaveEdit = async () => {
    if (!editDraft) return;
    setSaving(true);
    try {
      const api = await import('../services/api');
      await api.updateDepartmentAttribute(editDraft.id, {
        label:       editDraft.label,
        dataType:    editDraft.dataType,
        unit:        editDraft.unit || null,
        placeholder: editDraft.placeholder || null,
        required:    editDraft.required,
        options:     Array.isArray(editDraft.options) ? editDraft.options : String(editDraft.options || '').split(',').map(s => s.trim()).filter(Boolean),
        sortOrder:   editDraft.sortOrder,
      });
      setEditingId(null); setEditDraft(null);
      await load();
      import('react-toastify').then(({ toast }) => toast.success('Attribute updated'));
    } catch (e) {
      import('react-toastify').then(({ toast }) => toast.error(e.response?.data?.error || 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const handleApplyStandard = async () => {
    if (!dept.category || dept.category === 'general') {
      import('react-toastify').then(({ toast }) => toast.error('Set a category (Wine/Liquor/Beer/Tobacco) on the department first'));
      return;
    }
    setSaving(true);
    try {
      const api = await import('../services/api');
      const res = await api.applyStandardDeptAttributes(dept.id);
      await load();
      import('react-toastify').then(({ toast }) => toast.success(`Applied ${res.applied} of ${res.total} standard fields`));
    } catch (e) {
      import('react-toastify').then(({ toast }) => toast.error(e.response?.data?.error || 'Failed'));
    } finally {
      setSaving(false);
    }
  };

  const rowStyle = {
    display: 'grid', gridTemplateColumns: '1.2fr 1.5fr 0.8fr 0.6fr 80px',
    gap: 8, padding: '0.55rem 0.75rem', alignItems: 'center',
    background: 'var(--bg-tertiary)', borderRadius: 7, border: '1px solid var(--border-color)',
  };
  const inpStyle = { padding: '0.4rem 0.55rem', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-secondary, #fff)', color: 'var(--text-primary)', fontSize: '0.78rem' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)' }} />
      <div style={{ position: 'relative', zIndex: 1, width: 620, height: '100vh', overflowY: 'auto', background: 'var(--bg-secondary, #fff)', borderLeft: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,.2)' }}>
        {/* Header */}
        <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--bg-secondary, #fff)', zIndex: 2 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>Manage Attributes</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {dept.name}
              {dept.category && (
                <span style={{ marginLeft: 8, fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(124,58,237,.12)', color: '#7c3aed' }}>
                  {dept.category}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.25rem 1.5rem', flex: 1 }}>
          {dept.category && dept.category !== 'general' && (
            <button onClick={handleApplyStandard} disabled={saving}
              style={{ width: '100%', padding: '0.6rem', marginBottom: '1rem', borderRadius: 8, border: '1px solid rgba(124,58,237,.3)', background: 'rgba(124,58,237,.08)', color: '#7c3aed', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
              + Apply Standard {dept.category.charAt(0).toUpperCase() + dept.category.slice(1)} Fields
            </button>
          )}

          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>
            CURRENT FIELDS ({attrs.length})
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>Loading…</div>
          ) : attrs.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem', border: '1px dashed var(--border-color)', borderRadius: 7 }}>
              No attributes yet. {dept.category && dept.category !== 'general' ? 'Click "Apply Standard Fields" above to seed the defaults, or ' : ''}add your own below.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: '1rem' }}>
              {attrs.map(a => editingId === a.id ? (
                <div key={a.id} style={{ ...rowStyle, background: 'rgba(124,58,237,.06)', borderColor: 'rgba(124,58,237,.35)' }}>
                  <input style={inpStyle} value={editDraft.label} onChange={e => setEditDraft(d => ({ ...d, label: e.target.value }))} placeholder="Label" />
                  <input style={inpStyle} value={editDraft.options.join ? editDraft.options.join(',') : editDraft.options} onChange={e => setEditDraft(d => ({ ...d, options: e.target.value }))} placeholder="Options (comma-sep, for dropdown)" />
                  <select style={inpStyle} value={editDraft.dataType} onChange={e => setEditDraft(d => ({ ...d, dataType: e.target.value }))}>
                    {['text','decimal','integer','boolean','date','dropdown'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input style={inpStyle} value={editDraft.unit || ''} onChange={e => setEditDraft(d => ({ ...d, unit: e.target.value }))} placeholder="Unit" />
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={handleSaveEdit} disabled={saving} style={{ padding: 6, border: 'none', borderRadius: 6, background: 'var(--brand-primary)', color: '#fff', cursor: 'pointer' }}><Check size={13} /></button>
                    <button onClick={() => { setEditingId(null); setEditDraft(null); }} style={{ padding: 6, border: 'none', borderRadius: 6, background: 'rgba(0,0,0,.05)', cursor: 'pointer' }}><X size={13} /></button>
                  </div>
                </div>
              ) : (
                <div key={a.id} style={rowStyle}>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{a.label}{a.required ? ' *' : ''}</div>
                    <div style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{a.key}</div>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {a.dataType === 'dropdown' && a.options?.length ? a.options.join(' / ') : <em>—</em>}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{a.dataType}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{a.unit || '—'}</div>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setEditingId(a.id); setEditDraft({ ...a, options: a.options || [] }); }} title="Edit" style={{ padding: 5, border: 'none', borderRadius: 5, background: 'rgba(0,0,0,.05)', cursor: 'pointer', display: 'flex' }}><Edit2 size={12} /></button>
                    <button onClick={() => handleDelete(a.id)} title="Delete" style={{ padding: 5, border: 'none', borderRadius: 5, background: 'rgba(0,0,0,.05)', cursor: 'pointer', display: 'flex', color: '#ef4444' }}><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>
            ADD NEW FIELD
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <input style={inpStyle} value={addForm.key} onChange={e => setAddForm(f => ({ ...f, key: e.target.value }))} placeholder="Key (e.g. farm_origin)" />
            <input style={inpStyle} value={addForm.label} onChange={e => setAddForm(f => ({ ...f, label: e.target.value }))} placeholder="Label (e.g. Farm Origin)" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <select style={inpStyle} value={addForm.dataType} onChange={e => setAddForm(f => ({ ...f, dataType: e.target.value }))}>
              <option value="text">Text</option>
              <option value="decimal">Decimal</option>
              <option value="integer">Integer</option>
              <option value="boolean">Yes/No</option>
              <option value="date">Date</option>
              <option value="dropdown">Dropdown</option>
            </select>
            <input style={inpStyle} value={addForm.unit} onChange={e => setAddForm(f => ({ ...f, unit: e.target.value }))} placeholder="Unit (e.g. %, mg, °)" />
          </div>
          {addForm.dataType === 'dropdown' && (
            <input style={{ ...inpStyle, width: '100%', marginBottom: 8 }} value={addForm.options} onChange={e => setAddForm(f => ({ ...f, options: e.target.value }))} placeholder="Options, comma-separated (e.g. Red, White, Rosé)" />
          )}
          <input style={{ ...inpStyle, width: '100%', marginBottom: 8 }} value={addForm.placeholder} onChange={e => setAddForm(f => ({ ...f, placeholder: e.target.value }))} placeholder="Placeholder (e.g. 2019)" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', marginBottom: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={addForm.required} onChange={e => setAddForm(f => ({ ...f, required: e.target.checked }))} />
            Required field
          </label>
          <button onClick={handleAdd} disabled={saving || !addForm.key.trim() || !addForm.label.trim()}
            style={{ width: '100%', padding: '0.6rem', borderRadius: 8, border: 'none', background: 'var(--brand-primary)', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', opacity: (!addForm.key.trim() || !addForm.label.trim()) ? 0.5 : 1 }}>
            <Plus size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
            Add Attribute
          </button>
        </div>
      </div>
    </div>
  );
}
