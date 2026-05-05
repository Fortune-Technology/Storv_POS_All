// Lottery — ReadingRow (May 2026 split). Single row in the Shift Audit
// readings table. Displays a label + ticket reading + delta with
// color-coded sign.
import React from 'react';
import { fmt } from '../utils.js';

export default function ReadingRow({ label, reading, delta }) {
  const dCls = delta > 0.005 ? 'lt-audit-delta-pos'
             : delta < -0.005 ? 'lt-audit-delta-neg'
                              : 'lt-audit-delta-zero';
  return (
    <tr>
      <td>{label}</td>
      <td>{fmt(reading)}</td>
      <td className={dCls}>{delta > 0 ? '+' : ''}{fmt(delta)}</td>
    </tr>
  );
}
