import React from 'react';

/**
 * PriceInput — copied from portal/frontend/src/components/PriceInput.jsx
 * in Session 39 Round 3 so the cashier-app ProductFormModal matches the
 * back-office ProductForm's input behaviour 1:1.
 *
 * See that file for full docs. Behaviour:
 *   - No scientific notation / negatives / leading zero nonsense
 *   - Caret-preserving; caller always receives a plain decimal string
 *   - Wheel scroll blocked (prevents invisible price corruption on trackpads)
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
    if (raw === '') { onChange(''); return; }
    const decimalRe = new RegExp(`^\\d*(?:\\.\\d{0,${maxDecimals}})?$`);
    if (!decimalRe.test(raw)) return;
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
