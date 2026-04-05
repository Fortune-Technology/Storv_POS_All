import React, { useState, useEffect, useCallback } from 'react';
import { Package, AlertCircle, RefreshCw, Download, Filter } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { getVendorOrders } from '../services/api';
import './analytics.css';

/* ─── Constants ─── */
const REC_COLORS = { reorder: 'var(--error)', ok: '#10b981', overstock: '#f8c01d' };
const REC_LABELS = { reorder: 'Reorder', ok: 'On Track', overstock: 'Overstock' };

/* ─── Helpers ─── */
const fmt2 = (n) => n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/* ─── Sparkline ─── */
const Sparkline = ({ data, color }) => {
  if (!data || data.length < 2) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const max = Math.max(...data, 1);
  const w = 60, h = 22;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (w - 4) + 2;
    const y = h - 2 - ((v / max) * (h - 4));
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <polyline points={pts} fill="none" stroke={color || 'var(--accent-primary)'} strokeWidth="1.5" />
    </svg>
  );
};

/* ─── Trend Arrow ─── */
const TrendArrow = ({ trend }) => {
  if (trend > 0.3)  return <span style={{ color: 'var(--success)', fontWeight: 700 }}>↑</span>;
  if (trend < -0.3) return <span style={{ color: 'var(--error)',   fontWeight: 700 }}>↓</span>;
  return <span style={{ color: 'var(--text-muted)' }}>→</span>;
};

export default function VendorOrderSheet() {
  const [rawData, setRawData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [filter, setFilter]   = useState('all');
  const [sortKey, setSortKey] = useState('recommendation');
  const [sortDir, setSortDir] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await getVendorOrders();
      setRawData(d);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const products = rawData?.products       || [];
  const summary  = rawData?.summary        || {};
  const win      = rawData?.analysisWindow || {};

  /* Filter */
  const filtered = filter === 'all' ? products : products.filter((p) => p.recommendation === filter);

  /* Sort */
  const REC_ORDER = { reorder: 0, ok: 1, overstock: 2 };
  const sorted = [...filtered].sort((a, b) => {
    let av, bv;
    if      (sortKey === 'recommendation')  { av = REC_ORDER[a.recommendation] ?? 1;  bv = REC_ORDER[b.recommendation] ?? 1; }
    else if (sortKey === 'avgWeeklySales')  { av = a.avgWeeklySales;  bv = b.avgWeeklySales; }
    else if (sortKey === 'sales30')         { av = a.sales30;         bv = b.sales30; }
    else if (sortKey === 'qtyOnHand')       { av = a.qtyOnHand ?? -1; bv = b.qtyOnHand ?? -1; }
    else { av = a[sortKey] ?? ''; bv = b[sortKey] ?? ''; }
    if (av < bv) return -sortDir;
    if (av > bv) return sortDir;
    return 0;
  });

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(1); }
  };
  const sortIcon = (key) => sortKey === key ? (sortDir === 1 ? ' ↑' : ' ↓') : '';

  /* CSV Export */
  const exportCSV = () => {
    const headers = ['UPC', 'Description', 'Department', 'Avg Weekly Sales', '30-Day Sales', 'Qty On Hand', 'Velocity Trend', 'Recommendation'];
    const rows = sorted.map((p) => [
      p.upc,
      `"${(p.description || '').replace(/"/g, '""')}"`,
      `"${(p.department  || '').replace(/"/g, '""')}"`,
      p.avgWeeklySales, p.sales30, p.qtyOnHand ?? '', p.velocityTrend, p.recommendation,
    ].join(','));
    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `vendor-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">

        {/* ── Header ── */}
        <div className="analytics-header">
          <div>
            <h1 className="analytics-title">Vendor Order Sheet</h1>
            <p className="analytics-subtitle">
              Based on last 60 days of product movement
              {win.startDate && ` (${win.startDate} → ${win.endDate})`}
            </p>
          </div>
          <div className="analytics-controls">
            <button className="btn btn-secondary" onClick={fetchData} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button className="btn btn-primary" onClick={exportCSV} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Download size={15} /> Download CSV
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

        {/* ── KPI Cards ── */}
        <div className="analytics-stats-row">
          {[
            { label: 'Products Analyzed', value: summary.total    || 0, iconBg: 'rgba(59,130,246,0.15)',  iconColor: '#3b82f6' },
            { label: 'Need Reorder',      value: summary.reorder  || 0, iconBg: 'var(--error)',    iconColor: 'var(--error)' },
            { label: 'On Track',          value: summary.ok       || 0, iconBg: 'rgba(16,185,129,0.15)',  iconColor: 'var(--success)' },
            { label: 'Overstocked',       value: summary.overstock || 0, iconBg: 'rgba(248,192,29,0.15)', iconColor: 'var(--warning)' },
          ].map(({ label, value, iconBg, iconColor }) => (
            <div key={label} className="analytics-stat-card">
              <div className="analytics-stat-icon" style={{ background: iconBg, color: iconColor }}>
                <Package size={22} />
              </div>
              <div>
                <span className="analytics-stat-value">{value}</span>
                <span className="analytics-stat-label">{label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── Filter Buttons ── */}
        <div className="vendor-sort-row">
          <Filter size={15} style={{ color: 'var(--text-muted)' }} />
          <div className="filter-btn-group">
            {[
              { key: 'all',       label: 'All' },
              { key: 'reorder',   label: 'Reorder' },
              { key: 'ok',        label: 'On Track' },
              { key: 'overstock', label: 'Overstock' },
            ].map(({ key, label }) => (
              <button
                key={key}
                className={`filter-btn${filter === key ? ' active' : ''}`}
                onClick={() => setFilter(key)}
              >
                {label} ({key === 'all' ? products.length : products.filter((p) => p.recommendation === key).length})
              </button>
            ))}
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: 'auto' }}>
            Showing {sorted.length} products
          </span>
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div className="analytics-loading">
            <div className="analytics-spinner" />
            <p>Analyzing product movement…</p>
          </div>
        )}

        {/* ── Table ── */}
        {!loading && !error && sorted.length > 0 && (
          <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    {[
                      { key: 'upc',            label: 'UPC' },
                      { key: 'description',    label: 'Description' },
                      { key: 'department',     label: 'Dept' },
                      { key: 'avgWeeklySales', label: 'Avg Weekly Units' },
                      { key: 'sales30',        label: '30-Day Units' },
                      { key: 'qtyOnHand',      label: 'Qty On Hand' },
                      { key: 'velocityTrend',  label: 'Trend' },
                      { key: 'recommendation', label: 'Recommendation' },
                    ].map(({ key, label }) => (
                      <th key={key} className="sortable" onClick={() => handleSort(key)}>
                        {label}{sortIcon(key)}
                      </th>
                    ))}
                    <th>History</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p, i) => {
                    const color  = REC_COLORS[p.recommendation] || '#64748b';
                    const rowBg  = p.recommendation === 'reorder'
                      ? 'var(--error-bg)'
                      : p.recommendation === 'overstock'
                      ? 'rgba(248,192,29,0.03)'
                      : 'transparent';
                    return (
                      <tr key={i} style={{ background: rowBg }}>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{p.upc}</td>
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.description || p.upc}
                        </td>
                        <td style={{ color: 'var(--text-secondary)' }}>{p.department || '—'}</td>
                        <td style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{fmt2(p.avgWeeklySales)}</td>
                        <td>{p.sales30?.toLocaleString() || '—'}</td>
                        <td style={{ color: p.qtyOnHand == null ? 'var(--text-muted)' : p.qtyOnHand <= 0 ? 'var(--error)' : 'var(--text-primary)' }}>
                          {p.qtyOnHand != null ? p.qtyOnHand : '—'}
                        </td>
                        <td>
                          <TrendArrow trend={p.velocityTrend} />
                          <span style={{ marginLeft: '0.25rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                            {p.velocityTrend == null || isNaN(p.velocityTrend)
                              ? '—'
                              : `${p.velocityTrend > 0 ? '+' : ''}${p.velocityTrend.toFixed(2)}`}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            background:   color + '22',
                            color,
                            border:       `1px solid ${color}`,
                            borderRadius: 'var(--radius-sm)',
                            padding:      '0.2rem 0.6rem',
                            fontSize:     '0.75rem',
                            fontWeight:   700,
                          }}>
                            {REC_LABELS[p.recommendation] || p.recommendation}
                          </span>
                        </td>
                        <td>
                          <Sparkline data={p.weeklyHistory} color={color} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && !error && sorted.length === 0 && rawData && (
          <div className="glass-card">
            <div className="analytics-empty">No products found for this filter.</div>
          </div>
        )}

      </main>
    </div>
  );
}
