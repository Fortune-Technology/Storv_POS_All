// Lottery — LotteryReportsChart (May 2026 split). Multi-line Recharts
// chart used on the Reports tab. Five toggleable series so the user can
// isolate any combination:
//   sales            — instant ticket sales (ticket-math, with POS fallback)
//   payouts          — instant scratch payouts (LotteryTransaction)
//   machineSales     — daily online machine draw sales
//   machineCashing   — daily online machine cashings
//   instantCashing   — daily instant ticket cashings (recorded online)
import React, { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const REPORT_SERIES = [
  { key: 'sales',          label: 'Instant Sales',      color: '#16a34a', defaultOn: true  },
  { key: 'payouts',        label: 'Scratch Payouts',    color: '#d97706', defaultOn: true  },
  { key: 'machineSales',   label: 'Machine Sales',      color: '#0ea5e9', defaultOn: true  },
  { key: 'machineCashing', label: 'Machine Cashing',    color: '#dc2626', defaultOn: false },
  { key: 'instantCashing', label: 'Instant Cashing',    color: '#7c3aed', defaultOn: false },
];

export default function LotteryReportsChart({ data, height = 320 }) {
  const [visible, setVisible] = useState(() =>
    Object.fromEntries(REPORT_SERIES.map(s => [s.key, s.defaultOn]))
  );
  const toggle = (k) => setVisible(v => ({ ...v, [k]: !v[k] }));

  if (!data?.length) {
    return <div className="lt-empty">No data for selected range</div>;
  }

  // Display dates as MM-DD when range > 7 days, else MMM-DD for clarity
  const fmtTickDate = (s) => (s || '').slice(5);
  const fmtTooltip  = (val, name) => [`$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, name];

  return (
    <div>
      {/* Series toggle row — checkbox per series with a colored dot */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14, fontSize: '0.82rem' }}>
        {REPORT_SERIES.map(s => (
          <label
            key={s.key}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              cursor: 'pointer', userSelect: 'none',
              padding: '4px 10px', borderRadius: 999,
              background: visible[s.key] ? 'rgba(0,0,0,0.04)' : 'transparent',
              border: `1px solid ${visible[s.key] ? s.color : 'var(--border-color)'}`,
            }}
          >
            <input
              type="checkbox"
              checked={visible[s.key]}
              onChange={() => toggle(s.key)}
              style={{ accentColor: s.color, cursor: 'pointer' }}
            />
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: s.color }} />
            <span style={{ color: 'var(--text-primary)' }}>{s.label}</span>
          </label>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis
            dataKey="date"
            tickFormatter={fmtTickDate}
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          />
          <YAxis
            tickFormatter={(v) => `$${v}`}
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            width={64}
          />
          <Tooltip
            formatter={fmtTooltip}
            labelStyle={{ color: 'var(--text-primary)', fontWeight: 700 }}
            contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: '0.82rem' }}
          />
          <Legend wrapperStyle={{ fontSize: '0.78rem', paddingTop: 4 }} />
          {REPORT_SERIES.map(s => visible[s.key] && (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
