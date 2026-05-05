// Small shared building-block components — extracted from LotteryBackOffice
// (May 2026 split). These are tiny presentational helpers used across the
// page and its sub-components.
import React from 'react';
import { ScanLine } from 'lucide-react';

export function Metric({ label, value, big, accent, sub }) {
  return (
    <div className={`lbo-metric ${big ? 'big' : ''} ${accent || ''}`}>
      <div className="lbo-metric-label">{label}</div>
      <div className="lbo-metric-value">{value}</div>
      {sub && <div className="lbo-metric-sub">{sub}</div>}
    </div>
  );
}

export function Section({ title, total, totalAccent, children }) {
  return (
    <div className="lbo-section">
      <div className="lbo-section-head">
        <span>{title}</span>
        {total !== undefined && <strong className={totalAccent || ''}>{total}</strong>}
      </div>
      <div className="lbo-section-body">{children}</div>
    </div>
  );
}

export function EditableField({ label, value, onChange }) {
  return (
    <div className="lbo-kv lbo-kv--edit">
      <span>{label}</span>
      <div className="lbo-kv-input">
        <span>$</span>
        <input
          type="number" step="0.01" min="0"
          value={value}
          onChange={e => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

export function ReadonlyField({ label, value, units, note, accent }) {
  return (
    <div className="lbo-kv lbo-kv--ro">
      <span>{label}</span>
      <strong className={accent || ''}>
        {value}{units ? <small> {units}</small> : null}
      </strong>
      {note && <small className="lbo-kv-note">{note}</small>}
    </div>
  );
}

export function ModeToggle({ scanMode, onChange }) {
  return (
    <div className="lbo-mode">
      <button className={scanMode ? 'sel' : ''} onClick={() => onChange(true)}>
        <ScanLine size={13} /> Scan Mode
      </button>
      <button className={!scanMode ? 'sel' : ''} onClick={() => onChange(false)}>
        ✎ Manual Mode
      </button>
    </div>
  );
}

/**
 * Visual indicator for book face-value. Same neutral pill style for all
 * price points (per user spec — not distinct colors per tier); the $ value
 * displayed inside the pill is the ticket price. A small colored strip on
 * the left edge encodes the price band (low/mid/high) for quick at-a-glance
 * recognition without shouting.
 */
export function PackPill({ price }) {
  const p = Number(price || 0);
  const band = p >= 30 ? 'hi' : p >= 10 ? 'mid' : 'lo';
  return <span className={`lbo-pack-pill lbo-pack-pill--${band}`}>${p}</span>;
}
