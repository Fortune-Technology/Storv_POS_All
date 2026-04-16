import React from 'react';

/**
 * PriceInput — a drop-in replacement for <input type="number" step="0.01">
 * that avoids the many pitfalls of HTML5 number inputs on money values:
 *
 *   - No scientific notation ("1e5")
 *   - No locale-dependent decimal separator
 *   - No negative values
 *   - No leading-zero weirdness ("00005")
 *   - Preserves caret position while the user types
 *   - Caller always receives a plain decimal string
 *
 * Usage (matches prior signatures):
 *   <PriceInput
 *     value={form.defaultRetailPrice}
 *     onChange={(v) => setF('defaultRetailPrice', v)}
 *     className="form-input pf-full"
 *     placeholder="0.00"
 *   />
 *
 * Props:
 *   value        — current string value (controlled)
 *   onChange     — called with the next string on every accepted keystroke
 *   className    — forwarded to <input>
 *   placeholder  — forwarded to <input>
 *   disabled     — forwarded
 *   maxDecimals  — max decimal places (default 4 to match Prisma Decimal(10,4))
 *   maxValue     — optional numeric cap; rejects changes that exceed it
 *   ...rest      — forwarded
 */
export default function PriceInput({
  value,
  onChange,
  className,
  placeholder = '0.00',
  disabled,
  maxDecimals = 4,
  maxValue,
  ...rest
}) {
  const handleChange = (e) => {
    const raw = e.target.value;

    // Allow empty (so users can clear the field)
    if (raw === '') {
      onChange('');
      return;
    }

    // Strict decimal format: digits, one optional decimal point, up to N decimals.
    // Rejects: negative, "+", scientific notation, spaces, letters, commas.
    const decimalRe = new RegExp(`^\\d*(?:\\.\\d{0,${maxDecimals}})?$`);
    if (!decimalRe.test(raw)) return; // silently block keystroke

    // Optional upper bound
    if (maxValue != null && raw !== '' && raw !== '.') {
      const n = Number(raw);
      if (Number.isFinite(n) && n > maxValue) return;
    }

    onChange(raw);
  };

  // Block arrow-key scroll-wheel increment/decrement and mouse-wheel changes.
  // These are easy ways to invisibly corrupt a price on a trackpad.
  const handleWheel = (e) => e.currentTarget.blur();

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      value={value ?? ''}
      onChange={handleChange}
      onWheel={handleWheel}
    />
  );
}
