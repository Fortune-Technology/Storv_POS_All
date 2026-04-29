import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend
} from 'recharts';
import { TrendingUp, Package, Search, RefreshCw, Download, FileText } from 'lucide-react';
import { downloadCSV, downloadPDF } from '../utils/exportUtils';
import { getTopProducts, getProductsGrouped, getProductMovement } from '../services/api';
import './analytics.css';
import '../styles/portal.css';
import './ProductAnalytics.css';

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
    <div className="pan-tooltip">
      <p className="pan-tooltip-label">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="pan-tooltip-entry" style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? fmt(p.value) : p.value}
        </p>
      ))}
    </div>
  );
};

export default function ProductAnalytics({ embedded }) {
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

  /* ─── Export handlers ─── */
  const productExportColumns = [
    { key: 'Upc', label: 'UPC' },
    { key: '_Description', label: 'Description' },
    { key: '_Department', label: 'Department' },
    { key: 'NetSales', label: 'Net Sales' },
    { key: 'GrossSales', label: 'Gross Sales' },
    { key: 'QtySold', label: 'Units Sold' },
    { key: 'TotalCost', label: 'Total Cost' },
    { key: 'Profit', label: 'Profit' },
  ];

  const exportableSellers = sellers.map((p) => ({
    ...p,
    _Description: p.Sales?.[0]?.Description || '',
    _Department: p.Sales?.[0]?.Department || '',
  }));

  const handleExportCSV = () => {
    downloadCSV(exportableSellers, productExportColumns, 'product_analytics');
  };

  const handleExportPDF = () => {
    downloadPDF({
      title: 'Product Analytics — Best Sellers',
      subtitle: `${range.from} to ${range.to}`,
      data: exportableSellers,
      columns: productExportColumns,
      filename: 'product_analytics',
    });
  };

  const content = (
    <>

        {/* ── Header ── */}
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <TrendingUp size={22} />
            </div>
            <div>
              <h1 className="p-title">Product Analytics</h1>
              <p className="p-subtitle">Best sellers, product movement, and performance metrics</p>
            </div>
          </div>
          <div className="p-header-actions">
            <label>From</label>
            <input type="date" value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            <label>To</label>
            <input type="date" value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            <button className="btn btn-secondary pan-btn-refresh" onClick={fetchSellers}>
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
        {mainError && (
          <div className="analytics-error">
            <span>{mainError}</span>
            <button className="btn btn-secondary pan-btn-retry"
              onClick={() => { fetchTop(); fetchSellers(); }}>
              Retry
            </button>
          </div>
        )}

        {/* ── Top Products + Movement side by side ── */}
        <div className="analytics-grid-2">

          {/* Top Products */}
          <div className="analytics-chart-card pan-chart-card-flush">
            <div className="analytics-chart-title pan-chart-title-between">
              <span className="pan-chart-title-left">
                <TrendingUp size={18} className="pan-icon-accent" />
                Top Products
              </span>
              <div className="pan-top-date-row">
                <input
                  type="date"
                  value={topDate}
                  onChange={(e) => setTopDate(e.target.value)}
                  className="pan-date-input"
                />
                <button className="btn btn-secondary pan-btn-go" onClick={fetchTop}>
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
          <div className="analytics-chart-card pan-chart-card-flush">
            <div className="analytics-chart-title">
              <Search size={18} className="pan-icon-purple" />
              Product Movement History
            </div>
            <div className="upc-search-row">
              <input
                className="form-input"
                placeholder="Enter UPC or product name…"
                value={upcInput}
                onChange={(e) => setUpcInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setUpcSearch(upcInput)}
              />
              <button className="btn btn-primary" onClick={() => setUpcSearch(upcInput)}>Search</button>
            </div>
            {movLoading && <div className="analytics-loading"><div className="analytics-spinner" /><p>Loading…</p></div>}
            {movError && <div className="analytics-error pan-error-flush"><span>{movError}</span></div>}
            {!movLoading && movChart.length > 0 && (
              <>
                <p className="pan-movement-meta">
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
              <p className="pan-no-data">No movement data found for UPC: {upcSearch}</p>
            )}
            {!upcSearch && (
              <div className="analytics-empty pan-empty-pad">
                Enter a UPC code above to view movement history
              </div>
            )}
          </div>
        </div>

        {/* ── Best Sellers Table ── */}
        <div className="glass-card pan-sellers-card">
          <p className="pan-sellers-title">
            <Package size={18} className="pan-icon-accent" />
            Best Sellers (by Net Sales)
          </p>
          {sellersError && <div className="analytics-error pan-sellers-error"><span>{sellersError}</span></div>}
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
                          <td className="pan-td-muted">{sellersPage * PAGE_SIZE + i + 1}</td>
                          <td className="pan-td-mono">{p.Upc}</td>
                          <td className="pan-td-ellipsis">
                            {info.Description || '—'}
                          </td>
                          <td>{info.Department || '—'}</td>
                          <td className="pan-td-accent">{fmt(p.NetSales)}</td>
                          <td>{fmt(p.GrossSales || p.NetSales)}</td>
                          <td>{p.QtySold?.toLocaleString() || '—'}</td>
                          <td>{fmt(p.TotalCost)}</td>
                          <td className="pan-td-success">{fmt(p.Profit)}</td>
                          <td>
                            {margin && <span className="pan-td-margin" style={{ color: marginColor }}>{margin}%</span>}
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
                <button className="btn btn-secondary pan-btn-page"
                  disabled={sellersPage === 0} onClick={() => setSellersPage((p) => p - 1)}>
                  ← Prev
                </button>
                <button className="btn btn-secondary pan-btn-page"
                  disabled={sellers.length < PAGE_SIZE} onClick={() => setSellersPage((p) => p + 1)}>
                  Next →
                </button>
              </div>
            </>
          )}
        </div>

    </>
  );

  if (embedded) return <div className="p-tab-content">{content}</div>;

  return content;
}
