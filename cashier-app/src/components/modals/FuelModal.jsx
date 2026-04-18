/**
 * FuelModal — Fuel sale (or refund) entry.
 *
 * Flow:
 *   1. Cashier picks fuel type from chips (default pre-selected)
 *   2. Toggles "Amount ($)" or "Gallons" entry mode (default from settings)
 *   3. Enters value via numpad
 *   4. Live preview shows BOTH gallons + amount + price-per-gallon
 *   5. "Add to Cart" creates an isFuel cart line item
 *
 * Refund mode (mode='refund') adds a NEGATIVE fuel line.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { X, Fuel as FuelIcon, ArrowLeftRight } from 'lucide-react';
import { useCartStore } from '../../stores/useCartStore.js';
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
}) {
  const addFuelItem = useCartStore(s => s.addFuelItem);

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
  }, [open, initialType, defaultEntryMode]);

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

  const canAdd = !!selectedType && enteredValue > 0 && computed.gallons > 0 && computed.amount > 0;

  const handleAdd = () => {
    if (!canAdd) return;
    const tax = selectedType.isTaxable && selectedType.taxRate
      ? computed.amount * Number(selectedType.taxRate)
      : 0;
    addFuelItem({
      fuelType:        selectedType,
      type:            mode,                          // 'sale' or 'refund'
      gallons:         computed.gallons,
      pricePerGallon:  ppg,
      amount:          computed.amount,
      entryMode,
      taxAmount:       tax,
    });
    setAdded(a => [
      ...a,
      {
        name:    selectedType.name,
        gallons: computed.gallons,
        amount:  computed.amount,
        ppg,
      },
    ]);
    setDigits('');
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

            {/* Fuel type selector */}
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
