// Lottery — Badge (May 2026 split). Tiny pill-shaped status label.
import React from 'react';

export default function Badge({ label, cls = 'lt-badge-gray' }) {
  return <span className={`lt-badge ${cls}`}>{label}</span>;
}
