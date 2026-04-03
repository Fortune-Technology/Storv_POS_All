/**
 * NumPadInline — phone-style on-screen numpad for touchscreen POS.
 *
 * ENTRY MODEL: digits push in from the right (like a credit-card terminal).
 *   Enter "589"  → displays "$5.89"
 *   Backspace    → "$0.58"
 *   Enter "1"    → displays "$0.01"
 *   Enter "10000"→ displays "$100.00"
 *
 * Keys:  7  8  9
 *        4  5  6
 *        1  2  3
 *        00  0  ⌫
 *
 * Props:
 *   value       {string}  raw digit string, e.g. "589"
 *   onChange    {fn}      receives new raw digit string
 *   accentColor {string}  color for the prefix sign & active state
 *   prefix      {string}  "$" (default) | "%" | any symbol
 *   decimals    {number}  2 = implied cents (default), 0 = integer (% discount)
 *   maxDigits   {number}  max digit count, default 7 ($99,999.99)
 */

import React, { useState } from 'react';
import { Delete } from 'lucide-react';

// ── Helpers (exported so parents can derive numeric values) ───────────────────

/** "589" → "5.89"  |  decimals=0 → "589" */
export function digitsToDisplay(digits, decimals = 2) {
  if (decimals === 0) return digits || '0';
  const n = parseInt(digits || '0', 10);
  return (n / Math.pow(10, decimals)).toFixed(decimals);
}

/** "589" → 5.89  |  decimals=0 → 589 */
export function digitsToNumber(digits, decimals = 2) {
  if (!digits) return 0;
  if (decimals === 0) return parseInt(digits, 10) || 0;
  return parseInt(digits, 10) / Math.pow(10, decimals);
}

/** dollar number → digit string: 26.94 → "2694" */
export function numberToDigits(n, decimals = 2) {
  return String(Math.round(n * Math.pow(10, decimals)));
}

// ── Single key ────────────────────────────────────────────────────────────────
export function NKey({ label, onPress, disabled = false, variant }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      disabled={disabled}
      onMouseDown={() => !disabled && setPressed(true)}
      onMouseUp={() => { if (!disabled) { setPressed(false); onPress(); } }}
      onMouseLeave={() => setPressed(false)}
      onTouchStart={e => { e.preventDefault(); if (!disabled) setPressed(true); }}
      onTouchEnd={e => { e.preventDefault(); if (!disabled) { setPressed(false); onPress(); } }}
      style={{
        height: 62,
        borderRadius: 8,
        border: `1px solid ${
          pressed ? 'rgba(122,193,67,.55)' :
          variant === 'back' ? 'rgba(224,63,63,.22)' : 'var(--border)'}`,
        background: pressed
          ? 'rgba(122,193,67,.22)'
          : variant === 'back' ? 'rgba(224,63,63,.07)'
          : 'var(--bg-card)',
        color: disabled ? 'var(--text-muted)'
          : variant === 'back' ? '#f87171'
          : 'var(--text-primary)',
        fontSize: '1.4rem', fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        userSelect: 'none', WebkitUserSelect: 'none',
        transform: pressed && !disabled ? 'scale(0.91)' : 'scale(1)',
        transition: 'background .06s, transform .07s, border-color .06s',
      }}
    >
      {label}
    </button>
  );
}

// ── NumPadInline ──────────────────────────────────────────────────────────────
export default function NumPadInline({
  value       = '',
  onChange,
  accentColor = 'var(--green)',
  prefix      = '$',
  decimals    = 2,
  maxDigits   = 7,
}) {
  const appendDigit = (d) => {
    if (value.length >= maxDigits) return;
    onChange(value + d);
  };

  const appendDoubleZero = () => {
    if (!value) return;                          // no leading 00
    if (value.length + 2 > maxDigits) return;   // overflow guard
    onChange(value + '00');
  };

  const backspace = () => onChange(value.slice(0, -1));

  const display = digitsToDisplay(value, decimals);
  const isEmpty = !value || parseInt(value, 10) === 0;

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', width: '100%' }}>
      {/* Display */}
      <div style={{
        padding: '0.65rem 1rem',
        background: 'var(--bg-base)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 3,
        minHeight: 68,
      }}>
        <span style={{
          fontSize: '1.25rem', fontWeight: 800, lineHeight: 1,
          color: isEmpty ? 'var(--text-muted)' : accentColor,
        }}>
          {prefix}
        </span>
        <span style={{
          fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-0.03em',
          fontVariantNumeric: 'tabular-nums', lineHeight: 1,
          color: isEmpty ? 'var(--text-muted)' : 'var(--text-primary)',
        }}>
          {display}
        </span>
      </div>

      {/* Key grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 4, padding: 4,
        background: 'var(--bg-base)',
      }}>
        {['7','8','9','4','5','6','1','2','3'].map(d => (
          <NKey key={d} label={d} onPress={() => appendDigit(d)} />
        ))}
        <NKey label="00" onPress={appendDoubleZero} disabled={!value} />
        <NKey label="0"  onPress={() => appendDigit('0')} />
        <NKey label={<Delete size={20} />} onPress={backspace} disabled={!value} variant="back" />
      </div>
    </div>
  );
}
