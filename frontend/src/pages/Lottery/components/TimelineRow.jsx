// Lottery — TimelineRow (May 2026 split). Single row inside the Book
// Timeline modal. Shows a colored dot + label + formatted timestamp.
import React from 'react';

export default function TimelineRow({ label, at, active }) {
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString() + ' · ' + new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Not yet';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <div style={{
        width: 12, height: 12, borderRadius: '50%',
        background: active ? 'var(--brand-primary, #3d56b5)' : 'var(--border-color)',
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, fontSize: '0.88rem', fontWeight: active ? 600 : 400, color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{fmtDate(at)}</div>
    </div>
  );
}
