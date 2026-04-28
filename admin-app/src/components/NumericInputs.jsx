import React from 'react';

/**
 * NumericInputs (admin-app) — drop-in <input> replacements with
 * consistent precision + scroll/arrow-proof behavior.
 *
 *   <MoneyInput />  — money (2 decimals)
 *   <FuelInput />   — fuel (3 decimals)
 *   <CountInput />  — integer
 *
 * Self-contained — admin-app doesn't ship `PriceInput` so the decimal
 * implementation lives here directly. Behavior is identical to the
 * portal/cashier-app components.
 */

function DecimalInput({
  value,
  onChange,
  className,
  placeholder,
  disabled,
  maxDecimals,
  maxValue,
  ...rest
}) {
  const handleChange = (e) => {
    const raw = e.target.value;
    if (raw === '') {
      onChange('');
      return;
    }
    const re = new RegExp(`^\\d*(?:\\.\\d{0,${maxDecimals}})?$`);
    if (!re.test(raw)) return;
    if (maxValue != null && raw !== '' && raw !== '.') {
      const n = Number(raw);
      if (Number.isFinite(n) && n > maxValue) return;
    }
    onChange(raw);
  };
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

export function MoneyInput(props) {
  return <DecimalInput maxDecimals={2} placeholder="0.00" {...props} />;
}

export function FuelInput(props) {
  return <DecimalInput maxDecimals={3} placeholder="0.000" {...props} />;
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
