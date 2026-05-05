// Lottery — AuditMetric (May 2026 split). Compact KPI tile shown inside
// the Shift Audit view.
import React from 'react';

export default function AuditMetric({ label, value, accent, big }) {
  return (
    <div className={`lt-audit-metric lt-audit-metric--${accent} ${big ? 'big' : ''}`}>
      <div className="lt-audit-metric-label">{label}</div>
      <div className="lt-audit-metric-value">{value}</div>
    </div>
  );
}
