/**
 * OpenShiftModal — Count the opening cash drawer and start a new shift.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { X, DollarSign, Delete, LogOut } from 'lucide-react';
import { useShiftStore }   from '../../stores/useShiftStore.js';
import { useStationStore } from '../../stores/useStationStore.js';
import { useAuthStore }    from '../../stores/useAuthStore.js';
import './OpenShiftModal.css';

const BILLS = [
  { value: 100, label: '$100' }, { value: 50, label: '$50' }, { value: 20, label: '$20' },
  { value: 10, label: '$10' }, { value: 5, label: '$5' }, { value: 2, label: '$2' }, { value: 1, label: '$1' },
];
const COINS = [
  { value: 1, label: '$1 coin' }, { value: 0.25, label: '25c' },
  { value: 0.10, label: '10c' }, { value: 0.05, label: '5c' }, { value: 0.01, label: '1c' },
];
const ALL = [...BILLS, ...COINS];
const initCounts = () => { const m = {}; ALL.forEach(d => { m[String(d.value)] = ''; }); return m; };
const NUMPAD = [['7','8','9'],['4','5','6'],['1','2','3'],['C','0','⌫']];

function DenomRow({ denom, count, active, onClick }) {
  const qty = parseInt(count) || 0;
  const subtotal = denom.value * qty;
  return (
    <div className={`osm-denom-row${active ? ' osm-denom-row--active' : qty > 0 ? ' osm-denom-row--has-qty' : ''}`} onClick={onClick}>
      <span className={`osm-denom-label${active ? ' osm-denom-label--active' : ' osm-denom-label--default'}`}>{denom.label}</span>
      <div className={`osm-denom-count${qty > 0 ? ' osm-denom-count--has-qty' : ' osm-denom-count--empty'}`}>{count || '0'}</div>
      <span className={`osm-denom-subtotal${qty > 0 ? ' osm-denom-subtotal--has-qty' : ' osm-denom-subtotal--empty'}`}>
        {qty > 0 ? `$${subtotal.toFixed(subtotal % 1 ? 2 : 0)}` : '--'}
      </span>
    </div>
  );
}

export default function OpenShiftModal({ storeId, onClose, onOpened }) {
  const { openShift, loading, error, clearError } = useShiftStore();
  const stationId = useStationStore(s => s.station?.id);
  const logout = useAuthStore(s => s.logout);

  const [mode, setMode] = useState('denominations');
  const [counts, setCounts] = useState(initCounts);
  const [activeKey, setActiveKey] = useState(null);
  const [digits, setDigits] = useState('');
  const [note, setNote] = useState('');

  const denomTotal = useMemo(() => ALL.reduce((sum, d) => sum + d.value * (parseInt(counts[String(d.value)]) || 0), 0), [counts]);
  const manualAmount = parseInt(digits || '0') / 100;
  const openingAmount = mode === 'manual' ? manualAmount : denomTotal;

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

  const handleOpen = async () => {
    clearError();
    const denominations = mode === 'denominations'
      ? Object.fromEntries(Object.entries(counts).filter(([, v]) => parseInt(v) > 0).map(([k, v]) => [k, parseInt(v)]))
      : null;
    const result = await openShift({ storeId, stationId: stationId || undefined, openingAmount, openingDenominations: denominations, openingNote: note.trim() || undefined });
    if (result.ok) { onOpened?.(result.shift); onClose?.(); }
  };

  const numpadDisplay = mode === 'manual'
    ? `$${(parseInt(digits || '0') / 100).toFixed(2)}`
    : activeKey
      ? `${counts[activeKey] || '0'} x ${parseFloat(activeKey) >= 1 ? `$${parseFloat(activeKey).toFixed(0)}` : `$${parseFloat(activeKey).toFixed(2)}`}`
      : 'Select a denomination';

  return (
    <div className="osm-backdrop">
      <div className="osm-modal">
        <div className="osm-header">
          <div className="osm-header-left">
            <DollarSign size={18} color="var(--green)" />
            <div>
              <div className="osm-header-title">Open Cash Drawer</div>
              <div className="osm-header-sub">Count your starting float to begin the shift</div>
            </div>
          </div>
          {onClose && <button className="osm-close-btn" onClick={onClose}><X size={16} /></button>}
        </div>

        <div className="osm-mode-tabs">
          {[['denominations', 'Count by Denomination'], ['manual', 'Enter Total']].map(([m, label]) => (
            <button key={m} className={`osm-mode-tab${mode === m ? ' osm-mode-tab--active' : ' osm-mode-tab--inactive'}`}
              onClick={() => { setMode(m); setActiveKey(null); }}>{label}</button>
          ))}
        </div>

        <div className="osm-body">
          <div className="osm-left">
            {mode === 'manual' ? (
              <div className="osm-manual-section">
                <div className="osm-manual-label">OPENING AMOUNT</div>
                <div className="osm-manual-display">
                  <div className="osm-manual-amount">${manualAmount.toFixed(2)}</div>
                  <div className="osm-manual-hint">Use the numpad to enter the amount</div>
                </div>
                <div className="osm-manual-tip">Tip: type 5 8 9 to enter $5.89</div>
              </div>
            ) : (
              <div className="osm-denom-grid">
                <div>
                  <div className="osm-denom-col-label">BILLS</div>
                  {BILLS.map(d => <DenomRow key={d.value} denom={d} count={counts[String(d.value)]} active={activeKey === String(d.value)} onClick={() => setActiveKey(String(d.value))} />)}
                </div>
                <div>
                  <div className="osm-denom-col-label">COINS</div>
                  {COINS.map(d => <DenomRow key={d.value} denom={d} count={counts[String(d.value)]} active={activeKey === String(d.value)} onClick={() => setActiveKey(String(d.value))} />)}
                </div>
              </div>
            )}
            <div className="osm-note-section">
              <div className="osm-note-label">OPENING NOTE (optional)</div>
              <input className="osm-note-input" type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Counted by John" />
            </div>
            {error && <div className="osm-error">{error}</div>}
          </div>

          <div className="osm-right">
            <div className={`osm-numpad-display${mode === 'manual' ? ' osm-numpad-display--manual' : ' osm-numpad-display--denom'}`}>
              {numpadDisplay}
            </div>
            {NUMPAD.map((row, ri) => (
              <div key={ri} className="osm-numpad-row">
                {row.map(key => {
                  const isAction = key === 'C' || key === '⌫';
                  const dim = mode === 'denominations' && !activeKey && key !== 'C';
                  return (
                    <button key={key}
                      className={`osm-numpad-btn${key === 'C' ? ' osm-numpad-btn--clear' : key === '⌫' ? ' osm-numpad-btn--back' : ' osm-numpad-btn--digit'}${dim ? ' osm-numpad-btn--dim' : ''}`}
                      onClick={() => handleNumpad(key)}
                      disabled={dim}
                    >
                      {key === '⌫' ? <Delete size={16} /> : key}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="osm-footer">
          <div className="osm-footer-total">
            <div className="osm-footer-label">OPENING FLOAT</div>
            <div className="osm-footer-amount">${openingAmount.toFixed(2)}</div>
          </div>
          <button
            className="osm-signout-btn"
            onClick={logout}
            title="Sign out and return to PIN login"
          >
            <LogOut size={14} /> Sign Out
          </button>
          <button className={`osm-open-btn${loading ? ' osm-open-btn--loading' : ' osm-open-btn--active'}`} onClick={handleOpen} disabled={loading}>
            {loading ? 'Opening...' : 'Open Shift'}
          </button>
        </div>
      </div>
    </div>
  );
}
