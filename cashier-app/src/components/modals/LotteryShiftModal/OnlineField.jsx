// Single-input row for one of the 6 cumulative-day terminal readings on
// Step 2 of the EoD wizard (grossSales / cancels / machineCashing /
// couponCash / discounts / instantCashing).
import React from 'react';

export default function OnlineField({ label, hint, value, onChange }) {
  return (
    <div className="lsm-online-field">
      <label>{label}</label>
      <div className="lsm-online-input">
        <span>$</span>
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      </div>
      <small>{hint}</small>
    </div>
  );
}
