/**
 * CloseShiftModal — Count the closing cash drawer, review variance, and close shift.
 *
 * Layout: denomination list (left) + POS numpad (right) — same as OpenShiftModal.
 * On success: shows variance report → "Done & Sign Out" logs the cashier out.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { X, Lock, TrendingDown, TrendingUp, Minus, Printer, CheckCircle, Delete } from 'lucide-react';
import { useShiftStore } from '../../stores/useShiftStore.js';
import { useAuthStore }  from '../../stores/useAuthStore.js';

const fmt = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);

const BILLS = [
  { value: 100,  label: '$100' },
  { value: 50,   label: '$50'  },
  { value: 20,   label: '$20'  },
  { value: 10,   label: '$10'  },
  { value: 5,    label: '$5'   },
  { value: 2,    label: '$2'   },
  { value: 1,    label: '$1'   },
];
const COINS = [
  { value: 1,    label: '$1 coin' },
  { value: 0.25, label: '25¢'    },
  { value: 0.10, label: '10¢'    },
  { value: 0.05, label: '5¢'     },
  { value: 0.01, label: '1¢'     },
];
const ALL = [...BILLS, ...COINS];

const initCounts = () => {
  const m = {};
  ALL.forEach(d => { m[String(d.value)] = ''; });
  return m;
};

const NUMPAD = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['C', '0', '⌫'],
];

const BACKDROP = {
  position: 'fixed', inset: 0, zIndex: 250,
  background: 'rgba(0,0,0,.85)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '0.75rem',
};

export default function CloseShiftModal({ onClose, onClosed }) {
  const { shift, closeShift, loading, error, clearError } = useShiftStore();
  const logout = useAuthStore(s => s.logout);

  const [mode,      setMode]      = useState('denominations');
  const [counts,    setCounts]    = useState(initCounts);
  const [activeKey, setActiveKey] = useState(null);
  const [digits,    setDigits]    = useState('');   // manual mode cents
  const [note,      setNote]      = useState('');
  const [report,    setReport]    = useState(null);

  // ── Computed totals ────────────────────────────────────────────────────
  const denomTotal = useMemo(() =>
    ALL.reduce((s, d) => s + d.value * (parseInt(counts[String(d.value)]) || 0), 0),
  [counts]);

  const manualAmount   = parseInt(digits || '0') / 100;
  const closingAmount  = mode === 'manual' ? manualAmount : denomTotal;

  // ── Numpad handler ─────────────────────────────────────────────────────
  const handleNumpad = useCallback((key) => {
    if (mode === 'manual') {
      if (key === 'C') { setDigits(''); return; }
      if (key === '⌫') { setDigits(d => d.slice(0, -1)); return; }
      setDigits(d => (d + key).replace(/^0+/, '').slice(0, 7));
    } else {
      if (!activeKey) return;
      if (key === 'C') { setCounts(prev => ({ ...prev, [activeKey]: '' })); return; }
      if (key === '⌫') { setCounts(prev => ({ ...prev, [activeKey]: String(prev[activeKey]).slice(0, -1) })); return; }
      setCounts(prev => {
        const next = (String(prev[activeKey] || '') + key).replace(/^0+/, '').slice(0, 4);
        return { ...prev, [activeKey]: next };
      });
    }
  }, [mode, activeKey]);

  // ── Close shift ────────────────────────────────────────────────────────
  const handleClose = async () => {
    clearError();
    const denominations = mode === 'denominations'
      ? Object.fromEntries(Object.entries(counts).filter(([, v]) => parseInt(v) > 0).map(([k, v]) => [k, parseInt(v)]))
      : null;
    const result = await closeShift({
      closingAmount,
      closingDenominations: denominations,
      closingNote: note.trim() || undefined,
    });
    if (result.ok) setReport(result.report);
  };

  // ── Numpad display ─────────────────────────────────────────────────────
  const numpadDisplay = mode === 'manual'
    ? `$${manualAmount.toFixed(2)}`
    : activeKey
      ? `${counts[activeKey] || '0'} × ${parseFloat(activeKey) >= 1 ? `$${parseFloat(activeKey).toFixed(0)}` : `$${parseFloat(activeKey).toFixed(2)}`}`
      : 'Tap a row';

  const numpadBtnStyle = (key) => ({
    height: 52, borderRadius: 10,
    fontSize: (key === 'C' || key === '⌫') ? '0.75rem' : '1.2rem',
    fontWeight: (key === 'C' || key === '⌫') ? 700 : 800,
    cursor: 'pointer', border: 'none',
    background: (key === 'C' || key === '⌫') ? 'var(--bg-card)' : 'var(--bg-input)',
    color: key === 'C' ? 'var(--red)' : key === '⌫' ? 'var(--amber)' : 'var(--text-primary)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: (mode === 'denominations' && !activeKey && key !== 'C') ? 0.35 : 1,
  });

  // ── REPORT VIEW (after successful close) ──────────────────────────────
  if (report) {
    return (
      <>
        <div className="shift-report-print" style={{ display: 'none' }}>
          <ShiftReportPrintable report={report} />
        </div>
        <div style={BACKDROP}>
          <div style={{
            width: '100%', maxWidth: 460,
            background: 'var(--bg-panel)', borderRadius: 20,
            border: '1px solid rgba(122,193,67,.25)',
            display: 'flex', flexDirection: 'column',
            maxHeight: '92vh', overflow: 'hidden',
            boxShadow: '0 32px 80px rgba(0,0,0,.7)',
          }}>
            <div style={{ padding: '1rem 1.25rem', flexShrink: 0, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(122,193,67,.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle size={18} color="var(--green)" />
                <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--green)' }}>Shift Closed</span>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
              <ShiftReportBody report={report} />
            </div>
            <div style={{ borderTop: '1px solid var(--border)', padding: '1rem 1.25rem', display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => window.print()}
                style={{ flex: 1, padding: '0.75rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-secondary)', fontWeight: 700, cursor: 'pointer', fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <Printer size={15} /> Print
              </button>
              <button
                onClick={() => { onClosed?.(report); onClose(); logout(); }}
                style={{ flex: 2, padding: '0.75rem', background: 'var(--green)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: '0.875rem' }}
              >
                Done &amp; Sign Out
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── COUNT FORM ────────────────────────────────────────────────────────
  return (
    <div style={BACKDROP}>
      <div style={{
        width: '100%', maxWidth: 680,
        background: 'var(--bg-panel)', borderRadius: 20,
        border: '1px solid rgba(224,63,63,.25)',
        display: 'flex', flexDirection: 'column',
        maxHeight: '95vh', overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,.75)',
      }}>

        {/* Header */}
        <div style={{ padding: '0.875rem 1.25rem', flexShrink: 0, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(224,63,63,.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lock size={18} color="var(--red)" />
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--red)' }}>Close Cash Drawer</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 1 }}>Count your drawer to close the shift</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 6, display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        {/* Shift summary strip */}
        {shift && (
          <div style={{ padding: '0.5rem 1.25rem', flexShrink: 0, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 24, fontSize: '0.78rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Cashier: <strong style={{ color: 'var(--text-primary)' }}>{shift.cashierName || '—'}</strong></span>
            <span style={{ color: 'var(--text-muted)' }}>Opened: <strong style={{ color: 'var(--text-primary)' }}>{new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></span>
            <span style={{ color: 'var(--text-muted)' }}>Float: <strong style={{ color: 'var(--green)' }}>{fmt(shift.openingAmount)}</strong></span>
          </div>
        )}

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 8, padding: '0.75rem 1.25rem 0', flexShrink: 0 }}>
          {[['denominations', 'Count by Denomination'], ['manual', 'Enter Total']].map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m); setActiveKey(null); }} style={{
              flex: 1, padding: '0.45rem', borderRadius: 8, fontSize: '0.78rem', fontWeight: 700,
              cursor: 'pointer', border: 'none',
              background: mode === m ? 'var(--red)' : 'var(--bg-input)',
              color: mode === m ? '#fff' : 'var(--text-secondary)',
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Main body: left list + right numpad ── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* LEFT */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem' }}>

            {mode === 'manual' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>CLOSING AMOUNT</div>
                <div style={{ padding: '1rem', borderRadius: 12, background: 'var(--bg-input)', border: '2px solid var(--red)', textAlign: 'right' }}>
                  <div style={{ fontSize: '2.2rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                    ${manualAmount.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>Use the numpad → to enter the amount</div>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Tip: type 5 8 9 to enter $5.89</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
                {/* Bills — left column */}
                <div>
                  <div style={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 4 }}>BILLS</div>
                  {BILLS.map(d => (
                    <DenomRow key={d.value} denom={d}
                      count={counts[String(d.value)]}
                      active={activeKey === String(d.value)}
                      onClick={() => setActiveKey(String(d.value))}
                      accent="var(--red)"
                      accentBg="rgba(224,63,63,.06)"
                      accentBorder="var(--red)"
                    />
                  ))}
                </div>
                {/* Coins — right column */}
                <div>
                  <div style={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 4 }}>COINS</div>
                  {COINS.map(d => (
                    <DenomRow key={d.value} denom={d}
                      count={counts[String(d.value)]}
                      active={activeKey === String(d.value)}
                      onClick={() => setActiveKey(String(d.value))}
                      accent="var(--red)"
                      accentBg="rgba(224,63,63,.06)"
                      accentBorder="var(--red)"
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Note */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>CLOSING NOTE (optional)</div>
              <input
                type="text" value={note} onChange={e => setNote(e.target.value)}
                placeholder="e.g. End of day count"
                style={{ width: '100%', padding: '0.55rem 0.75rem', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.825rem', boxSizing: 'border-box', outline: 'none' }}
              />
            </div>

            {error && (
              <div style={{ marginTop: 8, padding: '0.625rem', borderRadius: 8, background: 'rgba(224,63,63,.08)', border: '1px solid rgba(224,63,63,.25)', color: 'var(--red)', fontSize: '0.78rem', fontWeight: 600 }}>
                {error}
              </div>
            )}
          </div>

          {/* RIGHT: numpad */}
          <div style={{ width: 200, flexShrink: 0, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: '0.75rem', gap: 6 }}>

            {/* Display */}
            <div style={{ padding: '0.625rem 0.75rem', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontSize: mode === 'manual' ? '1.3rem' : '1rem', fontWeight: 800, color: 'var(--red)', textAlign: 'right', wordBreak: 'break-all' }}>
              {numpadDisplay}
            </div>

            {NUMPAD.map((row, ri) => (
              <div key={ri} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                {row.map(key => (
                  <button
                    key={key}
                    onClick={() => handleNumpad(key)}
                    disabled={mode === 'denominations' && !activeKey && key !== 'C'}
                    style={numpadBtnStyle(key)}
                    onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = (key === 'C' || key === '⌫') ? 'var(--bg-card)' : 'var(--bg-input)'; }}
                  >
                    {key === '⌫' ? <Delete size={16} /> : key}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '0.875rem 1.25rem', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>COUNTED TOTAL</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1.1 }}>
              ${closingAmount.toFixed(2)}
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            style={{ padding: '0.875rem 1.5rem', background: loading ? 'var(--bg-input)' : 'var(--red)', border: 'none', borderRadius: 12, color: loading ? 'var(--text-muted)' : '#fff', fontWeight: 800, fontSize: '0.9rem', cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? 'Calculating…' : 'Close Shift & See Variance'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DenomRow ──────────────────────────────────────────────────────────────
function DenomRow({ denom, count, active, onClick, accent = 'var(--red)', accentBg = 'rgba(224,63,63,.06)', accentBorder = 'var(--red)' }) {
  const qty      = parseInt(count) || 0;
  const subtotal = denom.value * qty;

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0.4rem 0.625rem', marginBottom: 3,
        borderRadius: 8, cursor: 'pointer',
        background: active ? accentBg : qty > 0 ? 'rgba(255,255,255,.03)' : 'transparent',
        border: active ? `1.5px solid ${accentBorder}` : '1.5px solid transparent',
        transition: 'all .12s',
      }}
    >
      <span style={{ width: 58, fontSize: '0.875rem', fontWeight: 700, color: active ? accent : 'var(--text-primary)', flexShrink: 0 }}>
        {denom.label}
      </span>
      <div style={{ flex: 1, padding: '0.2rem 0.5rem', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', textAlign: 'center', fontSize: '0.9rem', fontWeight: 800, color: qty > 0 ? 'var(--text-primary)' : 'var(--text-muted)', minWidth: 36 }}>
        {count || '0'}
      </div>
      <span style={{ width: 52, fontSize: '0.825rem', fontWeight: 700, textAlign: 'right', flexShrink: 0, color: qty > 0 ? accent : 'var(--text-muted)' }}>
        {qty > 0 ? `$${subtotal.toFixed(subtotal % 1 ? 2 : 0)}` : '—'}
      </span>
    </div>
  );
}

// ── ShiftReportBody ───────────────────────────────────────────────────────
export function ShiftReportBody({ report }) {
  if (!report) return null;
  const variance = Number(report.variance) || 0;
  const balanced = Math.abs(variance) < 0.005;
  const over     = variance > 0;

  const rows = [
    { label: 'Opening Float',  value: report.openingAmount,  color: 'var(--text-primary)' },
    { label: '+ Cash Sales',   value: report.cashSales,      color: 'var(--green)' },
    { label: '− Cash Refunds', value: report.cashRefunds,    color: 'var(--red)' },
    { label: '− Cash Drops',   value: report.cashDropsTotal, color: 'var(--amber)' },
    { label: '− Paid Outs',    value: report.payoutsTotal,   color: 'var(--amber)' },
    { label: 'Expected Total', value: report.expectedAmount, color: 'var(--text-primary)', bold: true },
    { label: 'Counted Total',  value: report.closingAmount,  color: 'var(--text-primary)', bold: true },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Variance badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.875rem 1rem', borderRadius: 12, background: balanced ? 'rgba(122,193,67,.1)' : over ? 'rgba(59,130,246,.1)' : 'rgba(224,63,63,.1)', border: `1px solid ${balanced ? 'rgba(122,193,67,.3)' : over ? 'rgba(59,130,246,.3)' : 'rgba(224,63,63,.3)'}` }}>
        {balanced ? <Minus size={22} color="var(--green)" /> : over ? <TrendingUp size={22} color="var(--blue)" /> : <TrendingDown size={22} color="var(--red)" />}
        <div>
          <div style={{ fontWeight: 800, fontSize: '1.15rem', color: balanced ? 'var(--green)' : over ? 'var(--blue)' : 'var(--red)' }}>
            Variance: {variance >= 0 ? '+' : ''}{fmt(variance)}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            {balanced ? 'Drawer balanced ✓' : over ? 'Drawer is over' : 'Drawer is short'}
          </div>
        </div>
      </div>

      {/* Breakdown */}
      <div style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
        {rows.map((r, i) => r.value != null && (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.875rem', background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-panel)', borderTop: r.bold && i > 0 ? '1px solid var(--border)' : 'none' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: r.bold ? 700 : 500 }}>{r.label}</span>
            <span style={{ fontSize: '0.85rem', fontWeight: r.bold ? 800 : 600, color: r.color }}>{fmt(r.value)}</span>
          </div>
        ))}
      </div>

      {/* Drops */}
      {report.drops?.length > 0 && (
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 5 }}>CASH DROPS</div>
          {report.drops.map((d, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{new Date(d.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{d.note ? ` — ${d.note}` : ''}</span>
              <span style={{ fontWeight: 700, color: 'var(--amber)' }}>−{fmt(d.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Payouts */}
      {report.payouts?.length > 0 && (
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 5 }}>PAID OUTS</div>
          {report.payouts.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                {new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {p.recipient ? ` — ${p.recipient}` : ''}{p.note ? ` (${p.note})` : ''}
                {p.payoutType && <span style={{ marginLeft: 4, fontSize: '0.68rem', padding: '1px 5px', borderRadius: 4, background: p.payoutType === 'expense' ? 'rgba(59,130,246,.15)' : 'rgba(122,193,67,.15)', color: p.payoutType === 'expense' ? 'var(--blue)' : 'var(--green)' }}>{p.payoutType}</span>}
              </span>
              <span style={{ fontWeight: 700, color: 'var(--amber)' }}>−{fmt(p.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        <div>Opened: {new Date(report.openedAt).toLocaleString()}</div>
        {report.closedAt && <div>Closed: {new Date(report.closedAt).toLocaleString()}</div>}
        {report.closingNote && <div>Note: {report.closingNote}</div>}
      </div>
    </div>
  );
}

// ── Printable report ──────────────────────────────────────────────────────
function ShiftReportPrintable({ report }) {
  const variance = Number(report.variance) || 0;
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 12, width: 300, padding: 16 }}>
      <h2 style={{ textAlign: 'center', marginBottom: 8 }}>SHIFT REPORT</h2>
      <p style={{ textAlign: 'center', marginBottom: 2 }}>{new Date(report.openedAt).toLocaleDateString()}</p>
      <p style={{ textAlign: 'center', marginBottom: 8 }}>Cashier: {report.cashierName || '—'}</p>
      <hr />
      <table style={{ width: '100%', marginTop: 8 }}>
        <tbody>
          {[
            ['Opening Float', report.openingAmount],
            ['Cash Sales',    report.cashSales],
            ['Cash Refunds',  report.cashRefunds],
            ['Cash Drops',    report.cashDropsTotal],
            ['Paid Outs',     report.payoutsTotal],
            ['Expected',      report.expectedAmount],
            ['Counted',       report.closingAmount],
            ['VARIANCE',      variance],
          ].map(([label, val], i) => val != null && (
            <tr key={i}>
              <td style={{ paddingTop: 3 }}>{label}</td>
              <td style={{ textAlign: 'right', paddingTop: 3 }}>${Number(val).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr style={{ marginTop: 8 }} />
      <p style={{ textAlign: 'center', marginTop: 8, fontWeight: 'bold' }}>
        {Math.abs(variance) < 0.005 ? '✓ BALANCED' : variance > 0 ? `OVER $${variance.toFixed(2)}` : `SHORT $${Math.abs(variance).toFixed(2)}`}
      </p>
      {report.closedAt && <p style={{ textAlign: 'center', marginTop: 4, fontSize: 10 }}>Closed: {new Date(report.closedAt).toLocaleString()}</p>}
    </div>
  );
}
