/**
 * FuelModal — Fuel sale (or refund) entry.
 *
 * Sale flow:
 *   1. Cashier picks fuel type from chips (default pre-selected)
 *   2. V1.5 — if pumps are configured, cashier picks the pump (icon tiles)
 *   3. Toggles "Amount ($)" or "Gallons" entry mode (default from settings)
 *   4. Enters value via numpad → live preview shows both + $/gal
 *   5. "Add to Cart" creates an isFuel cart line item (with pumpId)
 *
 * Refund flow (V1.5 — original-transaction-aware):
 *   1. Modal lists recent fuel sales at this store (with Pump # + amount)
 *   2. Cashier picks the original sale → grade/pump auto-populate
 *   3. Cashier enters the actual dispensed gallons OR the refund amount;
 *      the system auto-computes the other side
 *   4. "Add Refund to Cart" creates a NEGATIVE fuel line with refundsOf
 *      pointing at the original sale. FIFO layers reverse correctly.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { X, Fuel as FuelIcon, ArrowLeftRight, RefreshCw, Check } from 'lucide-react';
import { useCartStore } from '../../stores/useCartStore.js';
import { getRecentFuelSales } from '../../api/pos.js';
import FuelPumpIcon from '../fuel/FuelPumpIcon.jsx';
import './FuelModal.css';

const NUMPAD     = ['7','8','9','4','5','6','1','2','3','C','0','⌫'];
const MAX_DIGITS = 8;          // up to 8 digits — handles $999,999.99 or 9,999.999 gal

// ── Cent-based digit buffer helpers (3 decimals for gallons, 2 for amount) ──
const digitsToValue = (digits, decimals) => {
  if (!digits) return 0;
  const div = Math.pow(10, decimals);
  return Number(digits) / div;
};
const formatDigits = (digits, decimals) => {
  const padded = (digits || '').padStart(decimals + 1, '0');
  const whole  = padded.slice(0, padded.length - decimals);
  const frac   = padded.slice(-decimals);
  return whole.replace(/^0+(?=\d)/, '') + '.' + frac;
};

export default function FuelModal({
  open, onClose, mode = 'sale',
  fuelTypes = [],
  defaultEntryMode = 'amount',
  defaultFuelTypeId = null,
  pumps = [],           // V1.5: when non-empty, cashier must pick one for each fuel item
  storeId = null,       // V1.5: used by refund flow to fetch recent sales
}) {
  const addFuelItem = useCartStore(s => s.addFuelItem);
  const [selectedPump, setSelectedPump] = useState(null); // V1.5

  // V1.5 — refund flow state: the recent sale being refunded
  const [recentSales, setRecentSales]           = useState([]);
  const [recentLoading, setRecentLoading]       = useState(false);
  const [selectedRefundTx, setSelectedRefundTx] = useState(null);

  // Pick initial fuel type: explicit defaultFuelTypeId → isDefault flag → first
  const initialType = useMemo(() => {
    if (!fuelTypes.length) return null;
    if (defaultFuelTypeId) {
      const m = fuelTypes.find(t => t.id === defaultFuelTypeId);
      if (m) return m;
    }
    const dflt = fuelTypes.find(t => t.isDefault);
    return dflt || fuelTypes[0];
  }, [fuelTypes, defaultFuelTypeId]);

  const [selectedType, setSelectedType] = useState(initialType);
  const [entryMode,    setEntryMode]    = useState(defaultEntryMode);  // 'amount' | 'gallons'
  const [digits,       setDigits]       = useState('');
  const [added,        setAdded]        = useState([]);

  // Reset when modal re-opens or types/defaults change
  useEffect(() => {
    if (!open) return;
    setSelectedType(initialType);
    setEntryMode(defaultEntryMode);
    setDigits('');
    setAdded([]);
    setSelectedPump(null);
    setSelectedRefundTx(null);
  }, [open, initialType, defaultEntryMode]);

  // V1.5: load recent sales for the refund picker when modal opens in refund mode
  const loadRecentSales = () => {
    if (!storeId) return;
    setRecentLoading(true);
    getRecentFuelSales(storeId, { limit: 30 })
      .then(rows => setRecentSales(Array.isArray(rows) ? rows : []))
      .catch(() => setRecentSales([]))
      .finally(() => setRecentLoading(false));
  };
  useEffect(() => {
    if (open && mode === 'refund') loadRecentSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, storeId]);

  // When a refund tx is selected: snap to that grade/pump + pre-fill numpad
  // with the FULL remaining refundable amount so cashier can just edit down.
  useEffect(() => {
    if (!selectedRefundTx) return;
    // Pre-select the same grade
    const grade = fuelTypes.find(t => t.id === selectedRefundTx.fuelTypeId);
    if (grade) setSelectedType(grade);
    // Default entry mode → amount (easier to reason about remaining $)
    setEntryMode('amount');
    // Pre-fill with full remaining amount (cashier adjusts down for partial refund)
    const remaining = Number(selectedRefundTx.remainingAmount || 0);
    if (remaining > 0) {
      // remaining = 13.00 → digits = "1300"
      const cents = Math.round(remaining * 100);
      setDigits(String(cents));
    } else {
      setDigits('');
    }
  }, [selectedRefundTx, fuelTypes]);

  const decimals = entryMode === 'gallons' ? 3 : 2;
  const enteredValue = digitsToValue(digits, decimals);
  const ppg = Number(selectedType?.pricePerGallon) || 0;

  // Compute the OTHER side from entered value
  const computed = useMemo(() => {
    if (!ppg || !enteredValue) return { gallons: 0, amount: 0 };
    if (entryMode === 'gallons') {
      const amt = enteredValue * ppg;
      return { gallons: enteredValue, amount: amt };
    } else {
      const gal = enteredValue / ppg;
      return { gallons: gal, amount: enteredValue };
    }
  }, [enteredValue, ppg, entryMode]);

  if (!open) return null;

  const handleKey = (k) => {
    setDigits(prev => {
      if (k === 'C')  return '';
      if (k === '⌫') return prev.slice(0, -1);
      if (prev.length >= MAX_DIGITS) return prev;
      if (prev === '' && k === '0')  return '';
      return prev + k;
    });
  };

  const switchMode = () => {
    setEntryMode(em => em === 'amount' ? 'gallons' : 'amount');
    setDigits('');
  };

  const pumpRequired     = pumps.length > 0 && mode === 'sale';
  const refundRequiresTx = mode === 'refund';
  // Refund amount must not exceed what's remaining refundable on the original tx
  const refundExceedsRemaining = refundRequiresTx && selectedRefundTx
    ? computed.amount > Number(selectedRefundTx.remainingAmount || 0) + 0.005
    : false;

  const canAdd = !!selectedType
    && enteredValue > 0
    && computed.gallons > 0
    && computed.amount > 0
    && (!pumpRequired    || !!selectedPump)
    && (!refundRequiresTx || !!selectedRefundTx)
    && !refundExceedsRemaining;

  const handleAdd = () => {
    if (!canAdd) return;
    const tax = selectedType.isTaxable && selectedType.taxRate
      ? computed.amount * Number(selectedType.taxRate)
      : 0;

    // V1.5 refund path: inherit pump from the original tx being refunded.
    // The backend will scale the original's FIFO layers proportionally.
    const refundPumpId = refundRequiresTx && selectedRefundTx ? selectedRefundTx.pumpId : null;
    const refundPumpNum = refundRequiresTx && selectedRefundTx ? selectedRefundTx.pump?.pumpNumber : null;

    addFuelItem({
      fuelType:        selectedType,
      type:            mode,                          // 'sale' or 'refund'
      gallons:         computed.gallons,
      pricePerGallon:  ppg,
      amount:          computed.amount,
      entryMode,
      taxAmount:       tax,
      pumpId:          selectedPump?.id || refundPumpId || null,         // V1.5
      pumpNumber:      selectedPump?.pumpNumber || refundPumpNum || null,
      refundsOf:       refundRequiresTx && selectedRefundTx ? selectedRefundTx.id : null,
    });
    setAdded(a => [
      ...a,
      {
        name:      selectedType.name,
        gallons:   computed.gallons,
        amount:    computed.amount,
        ppg,
        pumpNum:   selectedPump?.pumpNumber || refundPumpNum || null,
        isRefund:  mode === 'refund',
      },
    ]);
    setDigits('');
    // Clear the selected refund tx after adding (next refund needs a fresh pick)
    if (refundRequiresTx) {
      setSelectedRefundTx(null);
      // Refresh recent-sales so the remaining amount is correct for next pick
      loadRecentSales();
    }
    // Don't clear selectedPump on sale mode — common to ring multiple items on the same pump
  };

  const handleDone = () => {
    setAdded([]);
    setDigits('');
    onClose();
  };

  const isRefund = mode === 'refund';
  const accentColor = isRefund ? '#f59e0b' : '#dc2626';

  // Display strings
  const dispEntered = digits ? formatDigits(digits, decimals) : '0.' + '0'.repeat(decimals);
  const otherLabel  = entryMode === 'gallons' ? 'Amount' : 'Gallons';
  const otherValue  = entryMode === 'gallons'
    ? `$${computed.amount.toFixed(2)}`
    : `${computed.gallons.toFixed(3)} gal`;
  const enteredLabel = entryMode === 'gallons' ? 'Gallons' : 'Amount ($)';
  const enteredDisp  = entryMode === 'gallons' ? `${dispEntered} gal` : `$${dispEntered}`;

  return (
    <div className="fm-backdrop" onClick={handleDone}>
      <div className="fm-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="fm-header" style={{ background: accentColor }}>
          <div className="fm-header-left">
            <FuelIcon size={22} />
            <h2 className="fm-title">{isRefund ? 'Fuel Refund' : 'Fuel Sale'}</h2>
          </div>
          <button onClick={handleDone} className="fm-close-btn"><X size={18} /></button>
        </div>

        {/* Body — left form, right numpad */}
        <div className="fm-body">

          {/* LEFT: Form */}
          <div className="fm-left">

            {/* V1.5: Refund mode — "pick original sale" picker OR summary */}
            {isRefund && !selectedRefundTx && (
              <div className="fm-section">
                <div className="fm-section-label-row">
                  <div className="fm-section-label">Pick the sale to refund</div>
                  <button onClick={loadRecentSales} className="fm-refresh-btn" title="Refresh">
                    <RefreshCw size={12} />
                  </button>
                </div>
                {recentLoading && <div className="fm-empty">Loading recent sales…</div>}
                {!recentLoading && recentSales.length === 0 && (
                  <div className="fm-empty">No recent fuel sales to refund.</div>
                )}
                {!recentLoading && recentSales.length > 0 && (
                  <div className="fm-refund-list">
                    {recentSales.map(tx => {
                      const remaining = Number(tx.remainingAmount);
                      const already = Number(tx.refundedAmount);
                      const fullyRefunded = remaining < 0.005;
                      return (
                        <button
                          key={tx.id}
                          className={'fm-refund-row' + (fullyRefunded ? ' fm-refund-row--done' : '')}
                          disabled={fullyRefunded}
                          onClick={() => !fullyRefunded && setSelectedRefundTx(tx)}
                        >
                          <div className="fm-refund-row-left">
                            {tx.pump ? (
                              <span className="fm-refund-pump">Pump {tx.pump.pumpNumber}</span>
                            ) : (
                              <span className="fm-refund-pump fm-refund-pump--none">No pump</span>
                            )}
                            <div className="fm-refund-grade">
                              <span className="fm-type-dot" style={{ background: tx.fuelType?.color || '#94a3b8' }} />
                              {tx.fuelType?.name || tx.fuelTypeName}
                            </div>
                            <div className="fm-refund-time">{new Date(tx.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                          </div>
                          <div className="fm-refund-row-right">
                            <div className="fm-refund-amount">${Number(tx.amount).toFixed(2)}</div>
                            <div className="fm-refund-sub">
                              {Number(tx.gallons).toFixed(3)} gal
                              {already > 0 && (
                                <span className="fm-refund-already"> · ${already.toFixed(2)} refunded</span>
                              )}
                              {fullyRefunded && <span className="fm-refund-done-tag"> · FULLY REFUNDED</span>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* V1.5: Refund mode — summary of selected original sale */}
            {isRefund && selectedRefundTx && (
              <div className="fm-section">
                <div className="fm-refund-selected">
                  <div className="fm-refund-selected-title">
                    <Check size={14} /> Refunding sale
                  </div>
                  <div className="fm-refund-selected-body">
                    <div className="fm-refund-selected-row">
                      <span>Pump</span>
                      <b>{selectedRefundTx.pump ? `#${selectedRefundTx.pump.pumpNumber}` : 'None'}</b>
                    </div>
                    <div className="fm-refund-selected-row">
                      <span>Grade</span>
                      <b>{selectedRefundTx.fuelType?.name || selectedRefundTx.fuelTypeName}</b>
                    </div>
                    <div className="fm-refund-selected-row">
                      <span>Original</span>
                      <b>${Number(selectedRefundTx.amount).toFixed(2)} ({Number(selectedRefundTx.gallons).toFixed(3)} gal)</b>
                    </div>
                    <div className="fm-refund-selected-row">
                      <span>Already refunded</span>
                      <b>${Number(selectedRefundTx.refundedAmount || 0).toFixed(2)}</b>
                    </div>
                    <div className="fm-refund-selected-row fm-refund-selected-row--highlight">
                      <span>Remaining refundable</span>
                      <b>${Number(selectedRefundTx.remainingAmount || 0).toFixed(2)}</b>
                    </div>
                  </div>
                  <button
                    onClick={() => { setSelectedRefundTx(null); setDigits(''); }}
                    className="fm-refund-change-btn"
                  >
                    Change selected sale
                  </button>
                </div>
                {refundExceedsRemaining && (
                  <div className="fm-warn">
                    ⚠ Refund amount exceeds the remaining refundable balance. Lower the amount or pick a different sale.
                  </div>
                )}
              </div>
            )}

            {/* Fuel type selector — hidden in refund mode (inherited from original tx) */}
            {!isRefund && (
              <div className="fm-section">
                <div className="fm-section-label">Fuel Type</div>
                {fuelTypes.length === 0 ? (
                  <div className="fm-empty">No fuel types configured. Add some in Portal &rsaquo; Fuel.</div>
                ) : (
                  <div className="fm-type-grid">
                    {fuelTypes.map(t => (
                      <button
                        key={t.id}
                        className={'fm-type-chip' + (selectedType?.id === t.id ? ' fm-type-chip--active' : '')}
                        style={{ borderColor: selectedType?.id === t.id ? (t.color || accentColor) : 'transparent' }}
                        onClick={() => { setSelectedType(t); setDigits(''); }}
                      >
                        <span className="fm-type-dot" style={{ background: t.color || '#94a3b8' }} />
                        <span className="fm-type-info">
                          <span className="fm-type-name">{t.name}</span>
                          {t.gradeLabel && <span className="fm-type-grade">{t.gradeLabel}</span>}
                        </span>
                        <span className="fm-type-price">${Number(t.pricePerGallon).toFixed(3)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* V1.5: Pump picker — sale mode only, only when pumpTracking is on */}
            {!isRefund && pumps.length > 0 && (
              <div className="fm-section">
                <div className="fm-section-label">Pump</div>
                <div className="fm-pump-grid">
                  {pumps.map(p => (
                    <button
                      key={p.id}
                      className="fm-pump-btn"
                      onClick={() => setSelectedPump(p)}
                    >
                      <FuelPumpIcon
                        pumpNumber={p.pumpNumber}
                        label={p.label}
                        color={p.color || selectedType?.color || '#16a34a'}
                        size={84}
                        showLabel
                        selected={selectedPump?.id === p.id}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Mode toggle */}
            <div className="fm-section">
              <div className="fm-section-label">Enter</div>
              <div className="fm-mode-row">
                <button
                  className={'fm-mode-btn' + (entryMode === 'amount' ? ' fm-mode-btn--active' : '')}
                  onClick={() => { setEntryMode('amount'); setDigits(''); }}
                >Amount ($)</button>
                <button className="fm-mode-swap" onClick={switchMode} title="Swap">
                  <ArrowLeftRight size={14} />
                </button>
                <button
                  className={'fm-mode-btn' + (entryMode === 'gallons' ? ' fm-mode-btn--active' : '')}
                  onClick={() => { setEntryMode('gallons'); setDigits(''); }}
                >Gallons</button>
              </div>
            </div>

            {/* Live preview */}
            <div className="fm-preview">
              <div className="fm-preview-row">
                <span className="fm-preview-label">{enteredLabel}</span>
                <span className="fm-preview-value fm-preview-value--main" style={{ color: accentColor }}>
                  {enteredDisp}
                </span>
              </div>
              <div className="fm-preview-row">
                <span className="fm-preview-label">{otherLabel}</span>
                <span className="fm-preview-value">{otherValue}</span>
              </div>
              <div className="fm-preview-row fm-preview-row--small">
                <span className="fm-preview-label">Price per gallon</span>
                <span className="fm-preview-value">${ppg.toFixed(3)}</span>
              </div>
              {selectedType?.isTaxable && (
                <div className="fm-preview-row fm-preview-row--small">
                  <span className="fm-preview-label">Estimated tax</span>
                  <span className="fm-preview-value">
                    ${(computed.amount * Number(selectedType.taxRate || 0)).toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            {/* Add button */}
            <button
              className="fm-add-btn"
              style={{ background: canAdd ? accentColor : '#94a3b8' }}
              disabled={!canAdd}
              onClick={handleAdd}
            >
              {isRefund ? 'Add Refund to Cart' : 'Add to Cart'}
              {canAdd && <span className="fm-add-amt"> · ${computed.amount.toFixed(2)}</span>}
            </button>

            {/* Pump instruction */}
            {canAdd && (
              <div className="fm-pump-note">
                ⚠ Set pump to <strong>{computed.gallons.toFixed(3)} gallons</strong> (≈ ${computed.amount.toFixed(2)})
              </div>
            )}

            {/* Session list */}
            {added.length > 0 && (
              <div className="fm-session">
                <div className="fm-session-head">Added this session ({added.length})</div>
                {added.map((a, i) => (
                  <div key={i} className="fm-session-row">
                    <span>⛽ {a.name}</span>
                    <span>{a.gallons.toFixed(3)} gal × ${a.ppg.toFixed(3)}</span>
                    <span className="fm-session-amt" style={{ color: accentColor }}>
                      {isRefund ? '-' : ''}${a.amount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT: Numpad */}
          <div className="fm-right">
            <div className="fm-display">{enteredDisp}</div>
            <div className="fm-numpad">
              {NUMPAD.map(k => (
                <button
                  key={k}
                  className={'fm-key' + (k === 'C' ? ' fm-key-clear' : k === '⌫' ? ' fm-key-back' : '')}
                  onClick={() => handleKey(k)}
                >{k}</button>
              ))}
            </div>
            <button className="fm-done-btn" onClick={handleDone}>
              Done
              {added.length > 0 && (
                <span className="fm-done-count"> ({added.length} added)</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
