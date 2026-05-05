// Lottery — SimpleBarChart (May 2026 split). Legacy SVG bar chart kept
// for back-compat where the Recharts version isn't a fit.
import React from 'react';

export default function SimpleBarChart({ data, width = 600, height = 200 }) {
  if (!data?.length) return <div className="lt-empty">No data for selected range</div>;
  const maxVal = Math.max(...data.map(d => Math.max(d.sales || 0, d.payouts || 0)), 1);
  const barW = Math.max(8, Math.floor((width - 60) / (data.length * 2 + data.length)));
  const chartH = height - 40;
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={Math.max(width, data.length * (barW * 2 + 10) + 60)} height={height} style={{ fontFamily: 'inherit' }}>
        {data.map((d, i) => {
          const x = 40 + i * (barW * 2 + 10);
          const saleH = Math.round((d.sales / maxVal) * chartH);
          const payH = Math.round((d.payouts / maxVal) * chartH);
          return (
            <g key={d.date}>
              <rect x={x} y={chartH - saleH + 10} width={barW} height={saleH} fill="#16a34a" rx={2} />
              <rect x={x + barW + 2} y={chartH - payH + 10} width={barW} height={payH} fill="#d97706" rx={2} />
              <text x={x + barW} y={height - 2} textAnchor="middle" fontSize={9} fill="#9ca3af">
                {d.date?.slice(5)}
              </text>
            </g>
          );
        })}
        <text x={10} y={20} fontSize={9} fill="#9ca3af">$</text>
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#16a34a', borderRadius: 2, marginRight: 4 }} />Sales</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#d97706', borderRadius: 2, marginRight: 4 }} />Payouts</span>
      </div>
    </div>
  );
}
