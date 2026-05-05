// Single label / value row used on the Step 3 confirm summary.
import React from 'react';

export default function ReportRow({ label, value, good, warn }) {
  return (
    <div className={`lsm-report-row ${good ? 'lsm-report-row--good' : ''} ${warn ? 'lsm-report-row--warn' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
