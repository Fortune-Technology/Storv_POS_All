import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import { Store, TrendingUp, BarChart2, RefreshCw, AlertCircle, Download, FileText } from 'lucide-react';
import { downloadCSV, downloadPDF } from '../utils/exportUtils';
import Sidebar from '../components/Sidebar';
import { getDepartmentSales, getDepartmentComparison } from '../services/api';
import './analytics.css';
import '../styles/portal.css';

/* ─── Constants ─── */
const COLORS = [
  'var(--accent-primary)', 'var(--error)', '#3b82f6', '#f8c01d', '#10b981',
  '#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#a855f7',
];

/* ─── Helpers ─── */
const fmt = (n) =>
  n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtInt   = (n) => (n == null || isNaN(Number(n))) ? '—' : Number(n).toLocaleString();
const fmtPct   = (n) => (n == null || isNaN(Number(n))) ? '—' : `${Number(n).toFixed(1)}%`;
const fmtAxisK = (v) => (v == null || isNaN(v)) ? '' : `$${(v / 1000).toFixed(0)}k`;
const toISO = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); };

/* ─── Custom tooltip ─── */
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)',
      padding: '0.75rem 1rem',
      boxShadow: 'var(--shadow-md)',
    }}>
      <p style={{ fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-primary)', fontSize: '0.875rem' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontSize: '0.8rem', margin: '0.1rem 0' }}>
          {p.name}: {typeof p.value === 'number' ? fmt(p.value) : p.value}
        </p>
      ))}
    </div>
  );
};

/* ─── Pie label renderer ─── */
const CustomPieLabel = ({ cx, cy, midAngle, outerRadius, name, percent }) => {
  if (percent == null || isNaN(percent) || percent < 0.04) return null;
  const RADIAN = Math.PI / 180;
  const r = outerRadius + 22;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x} y={y}
      fill="var(--text-muted)"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={11}
    >
      {name} ({isNaN(percent) ? '?' : (percent * 100).toFixed(0)}%)
    </text>
  );
};

export default function DepartmentAnalytics({ embedded }) {
  const [range, setRange]         = useState({ from: daysAgo(30), to: toISO(new Date()) });
  const [prevRange, setPrevRange] = useState({ from2: daysAgo(60), to2: daysAgo(31) });
  const [deptData, setDeptData]   = useState(null);
  const [compData, setCompData]   = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, c] = await Promise.all([
        getDepartmentSales(range),
        getDepartmentComparison({ ...range, ...prevRange }),
      ]);
      setDeptData(d);
      setCompData(c);
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [range, prevRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const depts     = deptData?.value || [];
  const compDepts = compData?.value || [];

  /* Chart data */
  const barData = depts
    .map((d) => ({ name: d.Name, Revenue: d.TotalSales || 0, Items: d.TotalItems || 0 }))
    .sort((a, b) => b.Revenue - a.Revenue)
    .slice(0, 15);

  const pieData = barData.map((d) => ({ name: d.name, value: d.Revenue }));

  /* KPIs */
  const totalRevenue = depts.reduce((s, d) => s + (d.TotalSales || 0), 0);
  const topDept      = barData[0]?.name || '—';
  const avgRevenue   = depts.length ? totalRevenue / depts.length : 0;

  /* ─── Export handlers ─── */
  const deptExportColumns = [
    { key: 'Name', label: 'Department' },
    { key: 'TotalSales', label: 'Total Sales' },
    { key: 'TotalGrossSales', label: 'Gross Sales' },
    { key: 'TotalItems', label: 'Items Sold' },
    { key: 'TotalTransactionsCount', label: 'Transactions' },
    { key: 'TotalAvgPrice', label: 'Avg Price' },
    { key: 'TotalPercent', label: '% of Total' },
  ];

  const handleExportCSV = () => {
    downloadCSV(depts, deptExportColumns, 'department_analytics');
  };

  const handleExportPDF = () => {
    downloadPDF({
      title: 'Department Analytics',
      subtitle: `${range.from} to ${range.to}`,
      summary: [
        { label: 'Total Revenue', value: fmt(totalRevenue) },
        { label: 'Top Department', value: topDept },
        { label: 'Avg Dept Revenue', value: fmt(avgRevenue) },
        { label: 'Departments', value: String(depts.length) },
      ],
      data: depts,
      columns: deptExportColumns,
      filename: 'department_analytics',
    });
  };

  const content = (
    <>

        {/* ── Header ── */}
        <div className="analytics-header">
          <div>
            <h1 className="analytics-title">Department Analytics</h1>
            <p className="analytics-subtitle">Sales breakdown and period comparisons by department</p>
          </div>
          <div className="analytics-controls">
            <label>From</label>
            <input type="date" value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            <label>To</label>
            <input type="date" value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            <label>Prev From</label>
            <input type="date" value={prevRange.from2}
              onChange={(e) => setPrevRange((r) => ({ ...r, from2: e.target.value }))} />
            <label>Prev To</label>
            <input type="date" value={prevRange.to2}
              onChange={(e) => setPrevRange((r) => ({ ...r, to2: e.target.value }))} />
            <button className="btn btn-secondary" onClick={fetchData} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button className="p-btn p-btn-ghost p-btn-sm" onClick={handleExportCSV}>
              <Download size={13} /> CSV
            </button>
            <button className="p-btn p-btn-ghost p-btn-sm" onClick={handleExportPDF}>
              <FileText size={13} /> PDF
            </button>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="analytics-error">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button className="btn btn-secondary" style={{ marginLeft: 'auto', fontSize: '0.8rem', padding: '0.35rem 0.9rem' }} onClick={fetchData}>
              Retry
            </button>
          </div>
        )}

        {/* ── KPI Row ── */}
        <div className="analytics-stats-row">
          <div className="analytics-stat-card">
            <div className="analytics-stat-icon" style={{ background: 'var(--brand-15)', color: 'var(--accent-primary)' }}>
              <TrendingUp size={22} />
            </div>
            <div>
              <span className="analytics-stat-value">{fmt(totalRevenue)}</span>
              <span className="analytics-stat-label">Total Revenue</span>
            </div>
          </div>
          <div className="analytics-stat-card">
            <div className="analytics-stat-icon" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' }}>
              <Store size={22} />
            </div>
            <div>
              <span className="analytics-stat-value" style={{ fontSize: '1rem' }}>{topDept}</span>
              <span className="analytics-stat-label">Top Department</span>
            </div>
          </div>
          <div className="analytics-stat-card">
            <div className="analytics-stat-icon" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#8b5cf6' }}>
              <BarChart2 size={22} />
            </div>
            <div>
              <span className="analytics-stat-value">{fmt(avgRevenue)}</span>
              <span className="analytics-stat-label">Avg Dept Revenue</span>
            </div>
          </div>
          <div className="analytics-stat-card">
            <div className="analytics-stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
              <Store size={22} />
            </div>
            <div>
              <span className="analytics-stat-value">{depts.length}</span>
              <span className="analytics-stat-label">Departments</span>
            </div>
          </div>
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div className="analytics-loading">
            <div className="analytics-spinner" />
            <p>Loading department data…</p>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* ── Bar + Pie ── */}
            <div className="analytics-grid-2">
              <div className="analytics-chart-card" style={{ marginBottom: 0 }}>
                <div className="analytics-chart-title">
                  Revenue by Department (Top 15)
                </div>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 120 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                      tickFormatter={fmtAxisK} />
                    <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} width={110} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="Revenue" radius={[0, 4, 4, 0]} name="Revenue">
                      {barData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="analytics-chart-card" style={{ marginBottom: 0 }}>
                <div className="analytics-chart-title">Department Revenue Share</div>
                <ResponsiveContainer width="100%" height={400}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%" cy="50%"
                      outerRadius={130}
                      dataKey="value"
                      labelLine={false}
                      label={CustomPieLabel}
                    >
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ── Comparison Table ── */}
            {compDepts.length > 0 && (
              <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
                  Period Comparison — Current vs Previous
                </p>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Department</th>
                        <th>Current Period</th>
                        <th>Previous Period</th>
                        <th>Difference</th>
                        <th>Change %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compDepts.map((d, i) => {
                        const diff = d.TotalDifference || 0;
                        const pct  = d.TotalNetSales2 ? ((diff / d.TotalNetSales2) * 100).toFixed(1) : null;
                        const up   = diff >= 0;
                        return (
                          <tr key={i}>
                            <td style={{ fontWeight: 600 }}>{d.Name}</td>
                            <td style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{fmt(d.TotalNetSales)}</td>
                            <td>{fmt(d.TotalNetSales2)}</td>
                            <td style={{ color: up ? 'var(--success)' : 'var(--error)', fontWeight: 600 }}>
                              {up ? '+' : ''}{fmt(diff)}
                            </td>
                            <td>
                              {pct && (
                                <span className={`badge ${up ? 'badge-success' : 'badge-danger'}`}>
                                  {up ? '+' : ''}{pct}%
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Full Dept Breakdown ── */}
            {depts.length > 0 && (
              <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
                  Full Department Breakdown
                </p>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Department</th>
                        <th>Total Sales</th>
                        <th>Gross Sales</th>
                        <th>Items Sold</th>
                        <th>Transactions</th>
                        <th>Avg Price</th>
                        <th>% of Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {depts.map((d, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>
                            <span className="color-dot" style={{ background: COLORS[i % COLORS.length] }} />
                            {d.Name}
                          </td>
                          <td style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{fmt(d.TotalSales)}</td>
                          <td>{fmt(d.TotalGrossSales)}</td>
                          <td>{fmtInt(d.TotalItems)}</td>
                          <td>{fmtInt(d.TotalTransactionsCount)}</td>
                          <td>{fmt(d.TotalAvgPrice)}</td>
                          <td>
                            <div className="dept-progress-wrap">
                              <div className="dept-progress-bar">
                                <div
                                  className="dept-progress-fill"
                                  style={{
                                    width: `${Math.min(100, d.TotalPercent || 0)}%`,
                                    background: COLORS[i % COLORS.length],
                                  }}
                                />
                              </div>
                              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                {fmtPct(d.TotalPercent)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Section detail for top 3 depts ── */}
            {depts.slice(0, 3).map((dept, di) =>
              dept.Details && dept.Details.length > 0 ? (
                <div key={di} className="glass-card" style={{ marginBottom: '1.5rem' }}>
                  <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
                    {dept.Name} — Section Breakdown
                  </p>
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Section</th>
                          <th>Sales</th>
                          <th>Gross Sales</th>
                          <th>Last Year Sales</th>
                          <th>Items</th>
                          <th>Avg Price</th>
                          <th>%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dept.Details.map((sec, si) => (
                          <tr key={si}>
                            <td>{sec.Name}</td>
                            <td style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{fmt(sec.Sales)}</td>
                            <td>{fmt(sec.GrossSales)}</td>
                            <td style={{ color: 'var(--text-muted)' }}>{fmt(sec.LastYearSales)}</td>
                            <td>{fmtInt(sec.Items)}</td>
                            <td>{fmt(sec.AveragePrice)}</td>
                            <td>{fmtPct(sec.Percent)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null
            )}

            {depts.length === 0 && (
              <div className="glass-card">
                <div className="analytics-empty">No department data available for this period.</div>
              </div>
            )}
          </>
        )}

    </>
  );

  if (embedded) return <div className="p-tab-content">{content}</div>;

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">
        {content}
      </main>
    </div>
  );
}
