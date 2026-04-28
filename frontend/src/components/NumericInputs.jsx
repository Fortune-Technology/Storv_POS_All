import React from 'react';
import PriceInput from './PriceInput.jsx';

/**
 * NumericInputs — three drop-in <input> replacements with consistent
 * formatting + scroll/arrow-proof behavior.
 *
 *   <MoneyInput />  — money (2 decimals)
 *   <FuelInput />   — fuel quantity / $/gal (3 decimals)
 *   <CountInput />  — integer-only count
 *
 * All three:
 *   - Block mouse-wheel scroll (which silently corrupts numbers)
 *   - Block arrow-key increment (same problem)
 *   - Reject scientific notation, leading +, negatives by default
 *   - Use type="text" + inputMode="decimal"/"numeric" so mobile keyboards
 *     still pop the right keypad
 *
 * All accept the same props as PriceInput plus optional `maxValue` and
 * `disabled`. Onchange fires with a string value (never a number) so the
 * caller stays in full control of when to coerce/parse.
 *
 * Backward-compat: existing call sites of <PriceInput maxDecimals={2}>
 * keep working. Migrating them to <MoneyInput /> is purely a readability
 * change — same behavior under the hood.
 */

export function MoneyInput(props) {
  return <PriceInput maxDecimals={2} placeholder="0.00" {...props} />;
}

export function FuelInput(props) {
  return <PriceInput maxDecimals={3} placeholder="0.000" {...props} />;
}

/**
 * Integer-only input — strips any decimal portion at edit time. Backed by
 * its own implementation rather than PriceInput because the regex needs to
 * reject the decimal point outright.
 */
export function CountInput({
  value,
  onChange,
  className,
  placeholder = '0',
  disabled,
  min,
  max,
  ...rest
}) {
  const handleChange = (e) => {
    const raw = e.target.value;
    if (raw === '') {
      onChange('');
      return;
    }
    // Digits only — no decimal, no negative, no scientific notation.
    if (!/^\d+$/.test(raw)) return;

    if (max != null) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > max) return;
    }
    if (min != null) {
      const n = Number(raw);
      if (Number.isFinite(n) && n < min) return;
    }
    onChange(raw);
  };

  // Defensive: blur on wheel so trackpad scroll never silently bumps the
  // value, even though type="text" should already prevent that.
  const handleWheel = (e) => e.currentTarget.blur();

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
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

export default { MoneyInput, FuelInput, CountInput };
