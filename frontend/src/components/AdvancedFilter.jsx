/**
 * AdvancedFilter — collapsible multi-criteria filter drawer.
 *
 * Caller provides a `fields` config describing the searchable columns:
 *   [{ key, label, type: 'string'|'number'|'date'|'enum'|'boolean', options? }]
 *
 * Component emits an array of `{ field, op, value }` via `onChange`.
 * The caller applies the filter locally (or sends to backend). A small
 * pure helper `applyAdvancedFilters(rows, filters, fields)` is exported
 * below — use it for local in-memory filtering.
 *
 * Session 39 Round 3 — user requested "very advanced filter and search
 * which search for all the data and attributes" on Products + Transactions.
 */

import React, { useState } from 'react';
import { Filter, X, Plus, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import './AdvancedFilter.css';

// Operator catalogue per field type. Pure config — no logic here.
const OPS = {
  string:  [
    { op: 'contains',    label: 'contains' },
    { op: 'not_contains',label: 'does not contain' },
    { op: 'equals',      label: '=' },
    { op: 'not_equals',  label: '≠' },
    { op: 'starts_with', label: 'starts with' },
    { op: 'ends_with',   label: 'ends with' },
    { op: 'is_empty',    label: 'is empty' },
    { op: 'is_set',      label: 'is set' },
  ],
  number:  [
    { op: 'eq',    label: '=' },
    { op: 'neq',   label: '≠' },
    { op: 'gt',    label: '>' },
    { op: 'gte',   label: '≥' },
    { op: 'lt',    label: '<' },
    { op: 'lte',   label: '≤' },
    { op: 'between', label: 'between' },
  ],
  date:    [
    { op: 'on',     label: 'on' },
    { op: 'before', label: 'before' },
    { op: 'after',  label: 'after' },
    { op: 'between',label: 'between' },
    { op: 'is_empty', label: 'is empty' },
    { op: 'is_set',   label: 'is set' },
  ],
  enum:    [
    { op: 'is',     label: 'is' },
    { op: 'is_not', label: 'is not' },
    { op: 'in',     label: 'any of' },
    { op: 'is_empty', label: 'is empty' },
    { op: 'is_set',   label: 'is set' },
  ],
  boolean: [
    { op: 'is_true',  label: 'is true' },
    { op: 'is_false', label: 'is false' },
  ],
};

export default function AdvancedFilter({ fields, filters, onChange, defaultOpen = false, summary = true }) {
  const [open, setOpen] = useState(defaultOpen);

  const addRow = () => {
    const first = fields[0];
    const defaultOp = OPS[first.type]?.[0]?.op;
    onChange([...(filters || []), { id: Math.random().toString(36).slice(2, 9), field: first.key, op: defaultOp, value: '' }]);
    setOpen(true);
  };

  const updateRow = (id, patch) => {
    onChange((filters || []).map(f => f.id === id ? { ...f, ...patch } : f));
  };

  const removeRow = (id) => {
    onChange((filters || []).filter(f => f.id !== id));
  };

  const clearAll = () => onChange([]);

  const activeCount = (filters || []).length;

  return (
    <div className={`af-root${open ? ' af-root--open' : ''}`}>
      <div className="af-header">
        <button className="af-toggle" onClick={() => setOpen(v => !v)}>
          <Filter size={13} />
          <span>Filters</span>
          {activeCount > 0 && <span className="af-badge">{activeCount}</span>}
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {summary && activeCount > 0 && !open && (
          <span className="af-summary">
            {activeCount} active — click to expand
          </span>
        )}
        {activeCount > 0 && (
          <button className="af-clear" onClick={clearAll} title="Clear all filters">
            <RotateCcw size={11} /> Clear
          </button>
        )}
      </div>

      {open && (
        <div className="af-body">
          {activeCount === 0 && (
            <div className="af-empty">No filters yet. Tap <strong>+ Add filter</strong> below to build one.</div>
          )}
          {(filters || []).map((row) => {
            const field = fields.find(f => f.key === row.field) || fields[0];
            const ops = OPS[field.type] || [];
            const needsValue = !['is_empty', 'is_set', 'is_true', 'is_false'].includes(row.op);
            const isBetween = row.op === 'between';
            return (
              <div key={row.id} className="af-row">
                <select
                  className="af-select af-field"
                  value={row.field}
                  onChange={e => {
                    const nextField = fields.find(f => f.key === e.target.value);
                    const nextOp = OPS[nextField.type]?.[0]?.op || 'eq';
                    updateRow(row.id, { field: e.target.value, op: nextOp, value: '' });
                  }}
                >
                  {fields.map(f => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>

                <select
                  className="af-select af-op"
                  value={row.op}
                  onChange={e => updateRow(row.id, { op: e.target.value, value: '' })}
                >
                  {ops.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>

                {needsValue && (
                  <div className="af-value-wrap">
                    <ValueInput field={field} op={row.op} value={row.value} onChange={v => updateRow(row.id, { value: v })} />
                    {isBetween && <span className="af-between-and">and</span>}
                    {isBetween && (
                      <ValueInput field={field} op={row.op} value={row.value2 || ''} onChange={v => updateRow(row.id, { value2: v })} />
                    )}
                  </div>
                )}

                <button className="af-row-remove" onClick={() => removeRow(row.id)} title="Remove">
                  <X size={12} />
                </button>
              </div>
            );
          })}
          <button className="af-add" onClick={addRow}>
            <Plus size={12} /> Add filter
          </button>
        </div>
      )}
    </div>
  );
}

// ── Input controls per field type ─────────────────────────────────────────

function ValueInput({ field, op, value, onChange }) {
  if (field.type === 'boolean') return null; // boolean ops carry their own value
  if (field.type === 'date') {
    return <input type="date" className="af-input af-input--date" value={value || ''} onChange={e => onChange(e.target.value)} />;
  }
  if (field.type === 'number') {
    return <input type="number" className="af-input af-input--num" value={value || ''} step={field.step || 'any'} onChange={e => onChange(e.target.value)} placeholder={field.placeholder || 'value'} />;
  }
  if (field.type === 'enum') {
    if (op === 'in') {
      // Comma-separated multi-pick; rendered as a simple text field for now
      return <input type="text" className="af-input" value={value || ''} onChange={e => onChange(e.target.value)} placeholder="a, b, c" />;
    }
    return (
      <select className="af-select af-input" value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">—</option>
        {(field.options || []).map(o => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? o.label : String(o);
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    );
  }
  // string
  return <input type="text" className="af-input" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={field.placeholder || 'value'} />;
}

// ── Pure helper: apply filters locally to an array ────────────────────────
//
// Usage:
//   const visible = applyAdvancedFilters(rows, filters, fieldConfig);
//
// `fieldConfig` lets you customise how a value is extracted per field
// (default is r[key]). Supports every op defined in OPS. AND-joined.

export function applyAdvancedFilters(rows, filters, fieldConfig = {}) {
  if (!Array.isArray(rows) || !filters || filters.length === 0) return rows;
  const accessor = (key) => fieldConfig[key]?.accessor || ((r) => r?.[key]);

  return rows.filter(row => filters.every(f => matchFilter(row, f, accessor(f.field))));
}

function matchFilter(row, f, get) {
  const raw = get(row);
  const op  = f.op;

  // Empty / set checks first — they ignore value
  if (op === 'is_empty') return raw == null || raw === '';
  if (op === 'is_set')   return raw != null && raw !== '';
  if (op === 'is_true')  return !!raw;
  if (op === 'is_false') return !raw;

  // String ops
  if (['contains','not_contains','equals','not_equals','starts_with','ends_with'].includes(op)) {
    const s = raw == null ? '' : String(raw).toLowerCase();
    const needle = String(f.value || '').toLowerCase();
    if (op === 'contains')     return s.includes(needle);
    if (op === 'not_contains') return !s.includes(needle);
    if (op === 'equals')       return s === needle;
    if (op === 'not_equals')   return s !== needle;
    if (op === 'starts_with')  return s.startsWith(needle);
    if (op === 'ends_with')    return s.endsWith(needle);
  }

  // Number ops
  if (['eq','neq','gt','gte','lt','lte','between'].includes(op)) {
    const n = raw == null || raw === '' ? null : Number(raw);
    if (n == null || Number.isNaN(n)) return false;
    const v1 = f.value === '' ? null : Number(f.value);
    const v2 = f.value2 === '' ? null : Number(f.value2);
    if (op === 'eq')   return v1 != null && n === v1;
    if (op === 'neq')  return v1 != null && n !== v1;
    if (op === 'gt')   return v1 != null && n >  v1;
    if (op === 'gte')  return v1 != null && n >= v1;
    if (op === 'lt')   return v1 != null && n <  v1;
    if (op === 'lte')  return v1 != null && n <= v1;
    if (op === 'between') {
      if (v1 == null || v2 == null) return false;
      const [lo, hi] = v1 <= v2 ? [v1, v2] : [v2, v1];
      return n >= lo && n <= hi;
    }
  }

  // Date ops
  if (['on','before','after','between'].includes(op)) {
    if (raw == null || raw === '') return false;
    const d = new Date(raw); if (isNaN(d)) return false;
    const toDay = (v) => { const x = new Date(v); x.setHours(0,0,0,0); return x; };
    const day = toDay(d);
    if (op === 'on')     return f.value  && day.getTime() === toDay(f.value).getTime();
    if (op === 'before') return f.value  && day <  toDay(f.value);
    if (op === 'after')  return f.value  && day >  toDay(f.value);
    if (op === 'between') {
      if (!f.value || !f.value2) return false;
      const lo = toDay(f.value), hi = toDay(f.value2);
      return day >= (lo <= hi ? lo : hi) && day <= (lo <= hi ? hi : lo);
    }
  }

  // Enum ops
  if (op === 'is')     return String(raw ?? '') === String(f.value ?? '');
  if (op === 'is_not') return String(raw ?? '') !== String(f.value ?? '');
  if (op === 'in') {
    if (!f.value) return false;
    const list = String(f.value).split(',').map(s => s.trim()).filter(Boolean);
    return list.some(v => String(raw ?? '') === v);
  }

  return true;
}
