import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend
} from 'recharts';
import { TrendingUp, Package, Search, RefreshCw } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { getTopProducts, getProductsGrouped, getProductMovement } from '../services/api';
import './analytics.css';

/* ─── Helpers ─── */
const fmt = (n) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtAxisDollar = (v) => (v == null || isNaN(v)) ? '' : `$${v.toFixed(0)}`;
const toISO = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); };
const yesterday = () => daysAgo(1);

const PAGE_SIZE = 20;

/* ─── Custom Tooltip ─── */
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

export default function ProductAnalytics() {
  const [range, setRange]       = useState({ from: daysAgo(30), to: toISO(new Date()) });
  const [topDate, setTopDate]   = useState(yesterday());

  // Top products
  const [topProds, setTopProds]   = useState([]);
  const [topLoading, setTopLoading] = useState(false);

  // Best sellers (grouped)
  const [sellers, setSellers]           = useState([]);
  const [sellersTotal, setSellersTotal] = useState(0);
  const [sellersPage, setSellersPage]   = useState(0);
  const [sellersLoading, setSellersLoading] = useState(false);
  const [sellersError, setSellersError]     = useState(null);

  // Product movement search
  const [upcInput, setUpcInput]       = useState('');
  const [upcSearch, setUpcSearch]     = useState('');
  const [movementData, setMovementData] = useState(null);
  const [movLoading, setMovLoading]   = useState(false);
  const [movError, setMovError]       = useState(null);

  const [mainError, setMainError] = useState(null);

  const fetchTop = useCallback(async () => {
    setTopLoading(true);
    try {
      const d = await getTopProducts({ date: topDate });
      setTopProds(Array.isArray(d) ? d : []);
    } catch (e) {
      setMainError(e.response?.data?.error || e.message);
    } finally {
      setTopLoading(false);
    }
  }, [topDate]);

  const fetchSellers = useCallback(async () => {
    setSellersLoading(true);
    setSellersError(null);
    try {
      const d = await getProductsGrouped({
        ...range,
        orderBy: 'NetSales',
        pageSize: PAGE_SIZE,
        skip: sellersPage * PAGE_SIZE,
      });
      const arr = Array.isArray(d) ? d : (d?.value || []);
      setSellers(arr);
      setSellersTotal(d?.['@odata.count'] || arr.length);
    } catch (e) {
      setSellersError(e.response?.data?.error || e.message);
    } finally {
      setSellersLoading(false);
    }
  }, [range, sellersPage]);

  const fetchMovement = useCallback(async () => {
    if (!upcSearch) return;
    setMovLoading(true);
    setMovError(null);
    setMovementData(null);
    try {
      const d = await getProductMovement({ upc: upcSearch, dateStart: daysAgo(365), dateFinish: toISO(new Date()), weekly: false });
      setMovementData(d);
    } catch (e) {
      setMovError(e.response?.data?.error || e.message);
    } finally {
      setMovLoading(false);
    }
  }, [upcSearch]);

  useEffect(() => { fetchTop(); }, [fetchTop]);
  useEffect(() => { fetchSellers(); }, [fetchSellers]);
  useEffect(() => { fetchMovement(); }, [fetchMovement]);

  const movRows  = movementData?.value || [];
  const movChart = movRows.map((r) => ({
    period:  r.PeriodChart || r.PeriodGrid || '',
    Revenue: r.Revenue     || 0,
    Units:   r.SoldAmount  || 0,
    Profit:  r.Profit      || 0,
  }));

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">

        {/* ── Header ── */}
        <div className="analytics-header">
          <div>
            <h1 className="analytics-title">Product Analytics</h1>
            <p className="analytics-subtitle">Best sellers, product movement, and performance metrics</p>
          </div>
          <div className="analytics-controls">
            <label>From</label>
            <input type="date" value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            <label>To</label>
            <input type="date" value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            <button className="btn btn-secondary" onClick={fetchSellers} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <RefreshCw size={15} /> Refresh
            </button>
          </div>
        </div>

        {/* ── Error ── */}
        {mainError && (
          <div className="analytics-error">
            <span>{mainError}</span>
            <button className="btn btn-secondary" style={{ marginLeft: 'auto', fontSize: '0.8rem', padding: '0.35rem 0.9rem' }}
              onClick={() => { fetchTop(); fetchSellers(); }}>
              Retry
            </button>
          </div>
        )}

        {/* ── Top Products + Movement side by side ── */}
        <div className="analytics-grid-2">

          {/* Top Products */}
          <div className="analytics-chart-card" style={{ marginBottom: 0 }}>
            <div className="analytics-chart-title" style={{ justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <TrendingUp size={18} style={{ color: 'var(--accent-primary)' }} />
                Top Products
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="date"
                  value={topDate}
                  onChange={(e) => setTopDate(e.target.value)}
                  style={{
                    padding: '0.35rem 0.6rem',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-primary)',
                    fontSize: '0.8rem',
                  }}
                />
                <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }} onClick={fetchTop}>
                  Go
                </button>
              </div>
            </div>
            {topLoading ? (
              <div className="analytics-loading"><div className="analytics-spinner" /><p>Loading…</p></div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topProds.slice(0, 15)} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 140 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={fmtAxisDollar} />
                  <YAxis type="category" dataKey="productName" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={130} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="sales" fill="var(--accent-primary)" radius={[0, 4, 4, 0]} name="Sales" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Product Movement Search */}
          <div className="analytics-chart-card" style={{ marginBottom: 0 }}>
            <div className="analytics-chart-title">
              <Search size={18} style={{ color: '#8b5cf6' }} />
              Product Movement History
            </div>
            <div className="upc-search-row">
              <input
                className="form-input"
                placeholder="Enter UPC code…"
                value={upcInput}
                onChange={(e) => setUpcInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setUpcSearch(upcInput)}
              />
              <button className="btn btn-primary" onClick={() => setUpcSearch(upcInput)}>Search</button>
            </div>
            {movLoading && <div className="analytics-loading"><div className="analytics-spinner" /><p>Loading…</p></div>}
            {movError && <div className="analytics-error" style={{ marginBottom: 0 }}><span>{movError}</span></div>}
            {!movLoading && movChart.length > 0 && (
              <>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  UPC: {upcSearch} — {movRows.length} periods
                </p>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={movChart} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }} />
                    <Line type="monotone" dataKey="Revenue" stroke="var(--accent-primary)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Units"   stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Profit"  stroke="#f8c01d" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}
            {!movLoading && !movError && upcSearch && movChart.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No movement data found for UPC: {upcSearch}</p>
            )}
            {!upcSearch && (
              <div className="analytics-empty" style={{ padding: '2rem' }}>
                Enter a UPC code above to view movement history
              </div>
            )}
          </div>
        </div>

        {/* ── Best Sellers Table ── */}
        <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Package size={18} style={{ color: 'var(--accent-primary)' }} />
            Best Sellers (by Net Sales)
          </p>
          {sellersError && <div className="analytics-error" style={{ marginBottom: '1rem' }}><span>{sellersError}</span></div>}
          {sellersLoading ? (
            <div className="analytics-loading"><div className="analytics-spinner" /><p>Loading…</p></div>
          ) : (
            <>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>UPC</th>
                      <th>Description</th>
                      <th>Department</th>
                      <th>Net Sales</th>
                      <th>Gross Sales</th>
                      <th>Units Sold</th>
                      <th>Total Cost</th>
                      <th>Profit</th>
                      <th>Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sellers.map((p, i) => {
                      const info   = p.Sales?.[0] || {};
                      const margin = p.NetSales && p.TotalCost ? ((p.Profit / p.NetSales) * 100).toFixed(1) : null;
                      const marginColor = margin >= 30 ? 'var(--success)' : margin >= 15 ? 'var(--warning)' : 'var(--error)';
                      return (
                        <tr key={i}>
                          <td style={{ color: 'var(--text-muted)' }}>{sellersPage * PAGE_SIZE + i + 1}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{p.Upc}</td>
                          <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {info.Description || '—'}
                          </td>
                          <td>{info.Department || '—'}</td>
                          <td style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{fmt(p.NetSales)}</td>
                          <td>{fmt(p.GrossSales || p.NetSales)}</td>
                          <td>{p.QtySold?.toLocaleString() || '—'}</td>
                          <td>{fmt(p.TotalCost)}</td>
                          <td style={{ color: 'var(--success)', fontWeight: 600 }}>{fmt(p.Profit)}</td>
                          <td>
                            {margin && <span style={{ color: marginColor, fontWeight: 600 }}>{margin}%</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="analytics-pagination">
                <span className="analytics-pagination-info">
                  Page {sellersPage + 1}{sellersTotal > 0 ? ` of ${Math.ceil(sellersTotal / PAGE_SIZE)}` : ''}
                </span>
                <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.35rem 0.9rem' }}
                  disabled={sellersPage === 0} onClick={() => setSellersPage((p) => p - 1)}>
                  ← Prev
                </button>
                <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.35rem 0.9rem' }}
                  disabled={sellers.length < PAGE_SIZE} onClick={() => setSellersPage((p) => p + 1)}>
                  Next →
                </button>
              </div>
            </>
          )}
        </div>

      </main>
    </div>
  );
}
