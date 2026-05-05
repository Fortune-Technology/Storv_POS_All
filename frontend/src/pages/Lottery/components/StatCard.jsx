// Lottery — StatCard (May 2026 split). KPI card used on Overview tab.
import React from 'react';

export default function StatCard({ label, value, sub, color = 'var(--accent-primary)' }) {
  return (
    <div className="lt-stat-card">
      <div className="lt-stat-label">{label}</div>
      <div className="lt-stat-value" style={{ color }}>{value}</div>
      {sub && <div className="lt-stat-sub">{sub}</div>}
    </div>
  );
}
