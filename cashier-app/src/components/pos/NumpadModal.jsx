/**
 * NumpadModal — touch-screen-friendly numpad for quantity and price entry.
 *
 * Props:
 *   value     {string}   current string value shown in the display
 *   onChange  {fn}       called with new string on every key press
 *   onConfirm {fn}       called with parsed number (int for qty, float for price)
 *   onCancel  {fn}       called when user cancels
 *   mode      {string}   'qty' | 'price'
 *   title     {string}   heading text, e.g. "Set Quantity" or "Override Price"
 */

import React, { useState, useCallback } from 'react';
import { Delete } from 'lucide-react';

// ── Single numpad key ─────────────────────────────────────────────────────────
function Key({ label, onPress, disabled, variant }) {
  const [pressed, setPressed] = useState(false);

  const baseStyle = {
    minHeight: 72,
    borderRadius: 10,
    border: '1px solid var(--border-light)',
    background: pressed
      ? 'rgba(122,193,67,.15)'
      : variant === 'backspace'
      ? (pressed ? 'rgba(224,63,63,.18)' : 'var(--bg-card)')
      : 'var(--bg-card)',
    borderColor: pressed ? 'rgba(122,193,67,.4)' : 'var(--border-light)',
    fontSize: '1.5rem',
    fontWeight: 700,
    color: disabled
      ? 'var(--text-muted)'
      : variant === 'backspace'
      ? 'var(--red)'
      : 'var(--text-primary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    transition: 'background .08s, border-color .08s, transform .08s',
    transform: pressed && !disabled ? 'scale(0.94)' : 'scale(1)',
  };

  const backspaceHoverStyle = variant === 'backspace' && !disabled && !pressed
    ? { background: 'rgba(224,63,63,.08)', borderColor: 'rgba(224,63,63,.25)' }
    : {};

  return (
    <button
      style={{ ...baseStyle, ...backspaceHoverStyle }}
      disabled={disabled}
      onMouseDown={() => { if (!disabled) setPressed(true); }}
      onMouseUp={() => {
        if (!disabled) { setPressed(false); onPress(); }
      }}
      onMouseLeave={() => setPressed(false)}
      onTouchStart={(e) => {
        e.preventDefault();
        if (!disabled) setPressed(true);
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        if (!disabled) { setPressed(false); onPress(); }
      }}
    >
      {label}
    </button>
  );
}

// ── NumpadModal ───────────────────────────────────────────────────────────────
export default function NumpadModal({ value = '', onChange, onConfirm, onCancel, mode = 'qty', title = 'Enter Value' }) {
  const isQty   = mode === 'qty';

  const handleDigit = useCallback((digit) => {
    // Prevent leading zeros (e.g. "007" → just use "7")
    const next = value === '0' ? digit : value + digit;
    onChange(next);
  }, [value, onChange]);

  const handleDot = useCallback(() => {
    if (isQty) return; // disabled for qty mode
    if (value.includes('.')) return; // only one dot
    const next = value === '' ? '0.' : value + '.';
    onChange(next);
  }, [isQty, value, onChange]);

  const handleBackspace = useCallback(() => {
    onChange(value.slice(0, -1));
  }, [value, onChange]);

  const handleConfirm = useCallback(() => {
    if (isQty) {
      const parsed = parseInt(value, 10);
      onConfirm(isNaN(parsed) || parsed <= 0 ? 1 : parsed);
    } else {
      const parsed = parseFloat(value);
      onConfirm(isNaN(parsed) ? 0 : parsed);
    }
  }, [isQty, value, onConfirm]);

  const displayValue = value === '' ? '0' : value;

  return (
    /* Backdrop */
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,.55)',
        zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Card — stop propagation so clicking inside doesn't close */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 340,
          background: 'var(--bg-card)',
          borderRadius: 16,
          border: '1px solid var(--border-light)',
          boxShadow: '0 24px 64px rgba(0,0,0,.55)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Title */}
        <div style={{
          padding: '0.875rem 1.25rem 0.625rem',
          borderBottom: '1px solid var(--border)',
          fontSize: '0.78rem', fontWeight: 800,
          color: 'var(--text-muted)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          {title}
        </div>

        {/* Display */}
        <div style={{
          padding: '0.75rem 1.25rem',
          textAlign: 'right',
          fontSize: '2.25rem',
          fontWeight: 800,
          color: 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
          background: 'var(--bg-base)',
          borderBottom: '1px solid var(--border)',
          minHeight: 76,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        }}>
          {!isQty && <span style={{ fontSize: '1.25rem', color: 'var(--text-muted)', marginRight: 4 }}>$</span>}
          {displayValue}
        </div>

        {/* Key grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          padding: '12px 12px 8px',
        }}>
          {/* Row 1: 7 8 9 */}
          <Key label="7" onPress={() => handleDigit('7')} />
          <Key label="8" onPress={() => handleDigit('8')} />
          <Key label="9" onPress={() => handleDigit('9')} />

          {/* Row 2: 4 5 6 */}
          <Key label="4" onPress={() => handleDigit('4')} />
          <Key label="5" onPress={() => handleDigit('5')} />
          <Key label="6" onPress={() => handleDigit('6')} />

          {/* Row 3: 1 2 3 */}
          <Key label="1" onPress={() => handleDigit('1')} />
          <Key label="2" onPress={() => handleDigit('2')} />
          <Key label="3" onPress={() => handleDigit('3')} />

          {/* Row 4: . 0 ⌫ */}
          <Key
            label="."
            onPress={handleDot}
            disabled={isQty}
          />
          <Key label="0" onPress={() => handleDigit('0')} />
          <Key
            label={<Delete size={22} />}
            onPress={handleBackspace}
            disabled={value === ''}
            variant="backspace"
          />
        </div>

        {/* Action buttons */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 8, padding: '4px 12px 14px',
        }}>
          {/* Cancel */}
          <button
            onClick={onCancel}
            style={{
              height: 52, borderRadius: 10,
              background: 'var(--bg-input)',
              border: '1px solid var(--border-light)',
              color: 'var(--text-secondary)',
              fontWeight: 700, fontSize: '0.875rem',
              cursor: 'pointer',
              transition: 'background .1s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.06)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-input)'}
          >
            Cancel
          </button>

          {/* Confirm */}
          <button
            onClick={handleConfirm}
            style={{
              height: 52, borderRadius: 10,
              background: 'var(--green)',
              border: '1px solid var(--green)',
              color: '#0f1117',
              fontWeight: 800, fontSize: '0.9rem',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'opacity .1s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            Confirm ✓
          </button>
        </div>
      </div>
    </div>
  );
}
