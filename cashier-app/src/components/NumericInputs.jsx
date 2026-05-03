import React from 'react';
import PriceInput from './PriceInput.jsx';

/**
 * NumericInputs (cashier-app) — mirrors `frontend/src/components/NumericInputs.jsx`.
 *
 *   <MoneyInput />  — money (2 decimals)
 *   <FuelInput />   — fuel quantity / $/gal (3 decimals)
 *   <CountInput />  — integer-only count
 *
 * All three block mouse-wheel + arrow-key increment so a trackpad scroll
 * over a focused input never silently bumps the number — a real bug we hit
 * during early POS testing on touch laptops.
 */

export function MoneyInput(props) {
  return <PriceInput maxDecimals={2} placeholder="0.00" {...props} />;
}

export function FuelInput(props) {
  return <PriceInput maxDecimals={3} placeholder="0.000" {...props} />;
}

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
