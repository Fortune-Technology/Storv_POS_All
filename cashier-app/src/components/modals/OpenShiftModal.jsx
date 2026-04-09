/**
 * OpenShiftModal — Count the opening cash drawer and start a new shift.
 *
 * Layout: denomination list (left) + POS numpad (right)
 *
 * Modes:
 *   denominations — click a row to select, numpad sets its count (integer)
 *   manual        — numpad builds a cents-based dollar amount (589 → $5.89)
 */

import React, { useState, useMemo, useCallback } from 'react';
import { X, DollarSign, Delete } from 'lucide-react';
import { useShiftStore }   from '../../stores/useShiftStore.js';
import { useStationStore } from '../../stores/useStationStore.js';

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

// Numpad button layout
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

export default function OpenShiftModal({ storeId, onClose, onOpened }) {
  const { openShift, loading, error, clearError } = useShiftStore();
  const stationId = useStationStore(s => s.station?.id);

  const [mode,       setMode]       = useState('denominations');
  // Denom mode: counts are strings of digits
  const [counts,     setCounts]     = useState(initCounts);
  const [activeKey,  setActiveKey]  = useState(null); // which denomination is "focused"
  // Manual mode: digits string → (parseInt / 100) = dollar amount
  const [digits,     setDigits]     = useState('');
  const [note,       setNote]       = useState('');

  // ── Computed totals ────────────────────────────────────────────────────
  const denomTotal = useMemo(() =>
    ALL.reduce((sum, d) => sum + d.value * (parseInt(counts[String(d.value)]) || 0), 0),
  [counts]);

  const manualAmount = parseInt(digits || '0') / 100;

  const openingAmount = mode === 'manual' ? manualAmount : denomTotal;

  // ── Numpad press handler ───────────────────────────────────────────────
  const handleNumpad = useCallback((key) => {
    if (mode === 'manual') {
      // Cent-based input: max 7 digits (max $99,999.99)
      if (key === 'C') { setDigits(''); return; }
      if (key === '⌫') { setDigits(d => d.slice(0, -1)); return; }
      setDigits(d => (d + key).replace(/^0+/, '').slice(0, 7));
    } else {
      // Denomination count: integer, no leading zeros, max 4 digits
      if (!activeKey) return;
      if (key === 'C') { setCounts(prev => ({ ...prev, [activeKey]: '' })); return; }
      if (key === '⌫') {
        setCounts(prev => ({ ...prev, [activeKey]: String(prev[activeKey]).slice(0, -1) }));
        return;
      }
      setCounts(prev => {
        const cur = String(prev[activeKey] || '');
        const next = (cur + key).replace(/^0+/, '').slice(0, 4);
        return { ...prev, [activeKey]: next };
      });
    }
  }, [mode, activeKey]);

  // ── Open shift ─────────────────────────────────────────────────────────
  const handleOpen = async () => {
    clearError();
    const denominations = mode === 'denominations'
      ? Object.fromEntries(Object.entries(counts).filter(([, v]) => parseInt(v) > 0).map(([k, v]) => [k, parseInt(v)]))
      : null;

    const result = await openShift({
      storeId,
      stationId: stationId || undefined,
      openingAmount,
      openingDenominations: denominations,
      openingNote: note.trim() || undefined,
    });
    if (result.ok) { onOpened?.(result.shift); onClose?.(); }
  };

  // ── Styles ─────────────────────────────────────────────────────────────
  const numpadBtn = (key) => {
    const isAction = key === 'C' || key === '⌫';
    return {
      height: 52, borderRadius: 10, fontSize: isAction ? '0.75rem' : '1.2rem',
      fontWeight: isAction ? 700 : 800, cursor: 'pointer', border: 'none',
      background: isAction ? 'var(--bg-card)' : 'var(--bg-input)',
      color: key === 'C' ? 'var(--red)' : key === '⌫' ? 'var(--amber)' : 'var(--text-primary)',
      transition: 'background .1s',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    };
  };

  // ── Numpad display value ───────────────────────────────────────────────
  const numpadDisplay = mode === 'manual'
    ? `$${(parseInt(digits || '0') / 100).toFixed(2)}`
    : activeKey
      ? `${counts[activeKey] || '0'} × ${activeKey.startsWith('0') ? `$${parseFloat(activeKey).toFixed(2)}` : activeKey.length <= 3 ? `$${parseFloat(activeKey).toFixed(0)}` : `$${parseFloat(activeKey).toFixed(2)}`}`
      : 'Select a denomination';

  return (
    <div style={BACKDROP}>
      <div style={{
        width: '100%', maxWidth: 680,
        background: 'var(--bg-panel)', borderRadius: 20,
        border: '1px solid rgba(122,193,67,.25)',
        display: 'flex', flexDirection: 'column',
        maxHeight: '95vh', overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,.75)',
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: '0.875rem 1.25rem', flexShrink: 0,
          borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'rgba(122,193,67,.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DollarSign size={18} color="var(--green)" />
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--green)' }}>Open Cash Drawer</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 1 }}>Count your starting float to begin the shift</div>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 6, display: 'flex' }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* ── Mode tabs ── */}
        <div style={{ display: 'flex', gap: 8, padding: '0.75rem 1.25rem 0', flexShrink: 0 }}>
          {[['denominations', 'Count by Denomination'], ['manual', 'Enter Total']].map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m); setActiveKey(null); }} style={{
              flex: 1, padding: '0.45rem', borderRadius: 8, fontSize: '0.78rem', fontWeight: 700,
              cursor: 'pointer', border: 'none',
              background: mode === m ? 'var(--green)' : 'var(--bg-input)',
              color: mode === m ? '#fff' : 'var(--text-secondary)',
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Main body: left list + right numpad ── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', gap: 0 }}>

          {/* ── LEFT: denomination list or total display ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem' }}>

            {mode === 'manual' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>OPENING AMOUNT</div>
                <div style={{
                  padding: '1rem', borderRadius: 12,
                  background: 'var(--bg-input)', border: '2px solid var(--green)',
                  textAlign: 'right',
                }}>
                  <div style={{ fontSize: '2.2rem', fontWeight: 900, color: 'var(--green)', letterSpacing: '-0.02em' }}>
                    ${manualAmount.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    Use the numpad → to enter the amount
                  </div>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Tip: type 5 8 9 to enter $5.89
                </div>
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
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Note */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>OPENING NOTE (optional)</div>
              <input
                type="text" value={note} onChange={e => setNote(e.target.value)}
                placeholder="e.g. Counted by John"
                style={{
                  width: '100%', padding: '0.55rem 0.75rem',
                  background: 'var(--bg-input)', border: '1px solid var(--border)',
                  borderRadius: 8, color: 'var(--text-primary)',
                  fontSize: '0.825rem', boxSizing: 'border-box', outline: 'none',
                }}
              />
            </div>

            {error && (
              <div style={{ marginTop: 8, padding: '0.625rem', borderRadius: 8, background: 'rgba(224,63,63,.08)', border: '1px solid rgba(224,63,63,.25)', color: 'var(--red)', fontSize: '0.78rem', fontWeight: 600 }}>
                {error}
              </div>
            )}
          </div>

          {/* ── RIGHT: numpad ── */}
          <div style={{
            width: 200, flexShrink: 0,
            borderLeft: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column',
            padding: '0.75rem',
            gap: 6,
          }}>
            {/* Display */}
            <div style={{
              padding: '0.625rem 0.75rem', borderRadius: 8,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              fontSize: mode === 'manual' ? '1.3rem' : '1rem',
              fontWeight: 800, color: 'var(--green)',
              textAlign: 'right', wordBreak: 'break-all',
            }}>
              {numpadDisplay}
            </div>

            {/* Numpad grid */}
            {NUMPAD.map((row, ri) => (
              <div key={ri} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                {row.map(key => (
                  <button
                    key={key}
                    onClick={() => handleNumpad(key)}
                    disabled={mode === 'denominations' && !activeKey && key !== 'C'}
                    style={{
                      ...numpadBtn(key),
                      opacity: (mode === 'denominations' && !activeKey && key !== 'C') ? 0.35 : 1,
                    }}
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

        {/* ── Footer ── */}
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '0.875rem 1.25rem',
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>OPENING FLOAT</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--green)', lineHeight: 1.1 }}>
              ${openingAmount.toFixed(2)}
            </div>
          </div>
          <button
            onClick={handleOpen}
            disabled={loading}
            style={{
              padding: '0.875rem 2rem',
              background: loading ? 'var(--bg-input)' : 'var(--green)',
              border: 'none', borderRadius: 12,
              color: loading ? 'var(--text-muted)' : '#fff',
              fontWeight: 800, fontSize: '0.95rem',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Opening…' : '✓ Open Shift'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DenomRow ──────────────────────────────────────────────────────────────
function DenomRow({ denom, count, active, onClick }) {
  const qty      = parseInt(count) || 0;
  const subtotal = denom.value * qty;

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0.4rem 0.625rem', marginBottom: 3,
        borderRadius: 8, cursor: 'pointer',
        background: active ? 'rgba(122,193,67,.12)' : qty > 0 ? 'rgba(122,193,67,.04)' : 'transparent',
        border: active ? '1.5px solid var(--green)' : '1.5px solid transparent',
        transition: 'all .12s',
      }}
    >
      {/* Denomination label */}
      <span style={{ width: 58, fontSize: '0.875rem', fontWeight: 700, color: active ? 'var(--green)' : 'var(--text-primary)', flexShrink: 0 }}>
        {denom.label}
      </span>

      {/* Count display */}
      <div style={{
        flex: 1, padding: '0.2rem 0.5rem', borderRadius: 6,
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        textAlign: 'center', fontSize: '0.9rem', fontWeight: 800,
        color: qty > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
        minWidth: 36,
      }}>
        {count || '0'}
      </div>

      {/* Subtotal */}
      <span style={{
        width: 52, fontSize: '0.825rem', fontWeight: 700, textAlign: 'right', flexShrink: 0,
        color: qty > 0 ? 'var(--green)' : 'var(--text-muted)',
      }}>
        {qty > 0 ? `$${subtotal.toFixed(subtotal % 1 ? 2 : 0)}` : '—'}
      </span>
    </div>
  );
}
