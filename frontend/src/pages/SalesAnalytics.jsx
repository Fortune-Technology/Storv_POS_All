import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ComposedChart, Line, Area, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, AreaChart, BarChart
} from 'recharts';
import {
  TrendingUp, DollarSign, ShoppingCart, Tag, RefreshCw,
  AlertCircle, ReceiptText, Wallet, MapPin, X, ChevronRight,
  Cloud, Sun, Thermometer, Droplets, Wind, LayoutDashboard,
  BarChart2
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import DatePicker from '../components/DatePicker';
import {
  getSalesDailyWithWeather,
  getSalesWeeklyWithWeather,
  getSalesMonthlyWithWeather,
  getSalesYearlyWithWeather,
  getStoreLocation,
  updateStoreLocation,
} from '../services/api';
import { getWeatherInfo, getTempColor, getPrecipLabel } from '../utils/weatherIcons';
import { toast } from 'react-toastify';
import './analytics.css';

/* ─── Helpers ─── */
const fmtCurrency = (n) =>
  n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN  = (n) => (n == null ? '—' : Number(n).toLocaleString());
const fmtT  = (n) => (n == null ? '—' : `${Math.round(n)}°F`);
const toISO = (d) => d.toISOString().slice(0, 10);
// Safe axis tick formatters — return '' (blank) instead of "$NaN" when Recharts
// passes null/NaN during chart layout calculation
const fmtAxisK   = (v) => (v == null || isNaN(v)) ? '' : `$${(v / 1000).toFixed(0)}k`;
const fmtAxisDeg = (v) => (v == null || isNaN(v)) ? '' : `${v}°`;
const fmtAxisMm  = (v) => (v == null || isNaN(v)) ? '' : `${v}mm`;
// Safe date helper — returns null if the string is missing/invalid
const safeDate = (str) => {
  if (!str) return null;
  const d = new Date(str + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
};
const daysAgo   = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); };
const weeksAgo  = (n) => { const d = new Date(); d.setDate(d.getDate() - n * 7); return toISO(d); };
const monthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return toISO(d); };
const yearsAgo  = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return toISO(d); };

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const formatDateLabel = (dateStr, tab) => {
  if (!dateStr) return '';
  const d = safeDate(dateStr);
  if (!d) return dateStr.slice(0, 10); // fallback: show raw string
  if (tab === 'Monthly') return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  if (tab === 'Yearly')  return String(d.getFullYear());
  if (tab === 'Weekly')  return `Wk ${dateStr.slice(5, 10)}`;
  return dateStr.slice(5); // MM-DD for daily
};

const TABS = ['Daily', 'Weekly', 'Monthly', 'Yearly'];

const defaultRange = (tab) => {
  if (tab === 'Daily')   return { from: daysAgo(30),    to: toISO(new Date()) };
  if (tab === 'Weekly')  return { from: weeksAgo(12),   to: toISO(new Date()) };
  if (tab === 'Monthly') return { from: monthsAgo(24),  to: toISO(new Date()) };
  return                        { from: yearsAgo(5),    to: toISO(new Date()) };
};

/* ─── CHART TYPES ─── */
const CHART_TYPES = [
  { id: 'master',   label: 'Master View',   icon: <LayoutDashboard size={14} /> },
  { id: 'sales',    label: 'Sales Trend',   icon: <TrendingUp size={14} /> },
  { id: 'weather',  label: 'Weather',       icon: <Cloud size={14} /> },
  { id: 'txn',      label: 'Transactions',  icon: <ShoppingCart size={14} /> },
];

/* ─── METRIC TOGGLES for master chart ─── */
const METRICS = [
  { key: 'NetSales',     label: 'Net Sales',      color: 'var(--accent-primary)' },
  { key: 'GrossSales',   label: 'Gross Sales',    color: '#3b82f6' },
  { key: 'Transactions', label: 'Transactions',   color: '#8b5cf6' },
  { key: 'tempHigh',     label: 'Temp High',      color: '#ef4444' },
  { key: 'tempLow',      label: 'Temp Low',       color: '#60a5fa' },
];

/* ─── CUSTOM TOOLTIP ─── */
const ChartTooltip = ({ active, payload, label, tab }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)',
      padding: '0.75rem 1rem',
      boxShadow: 'var(--shadow-md)',
      fontSize: '0.8rem',
      maxWidth: 220,
    }}>
      <p style={{ fontWeight: 700, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>
        {formatDateLabel(label, tab)}
      </p>
      {payload.map((p, i) => {
        const isMoney = ['Net Sales','Gross Sales','Discounts','Refunds','Taxes','Collected'].some(k => p.name?.includes(k));
        const isTemp  = p.name?.includes('Temp');
        const val = isMoney ? fmtCurrency(p.value) : isTemp ? fmtT(p.value) : fmtN(p.value);
        return (
          <p key={i} style={{ color: p.color, margin: '0.1rem 0' }}>
            {p.name}: {val}
          </p>
        );
      })}
    </div>
  );
};

/* ─── LOCATION MODAL ─── */
const LocationModal = ({ onClose, onSaved }) => {
  const [lat, setLat]     = useState('');
  const [lng, setLng]     = useState('');
  const [tz, setTz]       = useState('America/New_York');
  const [addr, setAddr]   = useState('');
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const detectLocation = () => {
    if (!navigator.geolocation) return;
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setDetecting(false);
      },
      () => { toast.error('Could not detect location'); setDetecting(false); }
    );
  };

  const save = async () => {
    if (!lat || !lng) return toast.error('Latitude and longitude are required');
    setSaving(true);
    try {
      await updateStoreLocation({ latitude: parseFloat(lat), longitude: parseFloat(lng), timezone: tz, address: addr });
      toast.success('Store location saved!');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
          <h2 className="modal-title">Set Store Location</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>
        <p className="modal-subtitle">Required for weather integration and sales predictions.</p>

        <button className="btn btn-secondary" onClick={detectLocation} disabled={detecting}
          style={{ width: '100%', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
          <MapPin size={15} /> {detecting ? 'Detecting…' : 'Auto-detect My Location'}
        </button>

        <div className="modal-row">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Latitude *</label>
            <input className="form-input" type="number" step="0.000001" placeholder="44.8016" value={lat} onChange={e => setLat(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Longitude *</label>
            <input className="form-input" type="number" step="0.000001" placeholder="-68.7712" value={lng} onChange={e => setLng(e.target.value)} />
          </div>
        </div>

        <div className="form-group" style={{ marginTop: '0.75rem' }}>
          <label className="form-label">Timezone</label>
          <select className="form-select" value={tz} onChange={e => setTz(e.target.value)}>
            <option value="America/New_York">Eastern (ET)</option>
            <option value="America/Chicago">Central (CT)</option>
            <option value="America/Denver">Mountain (MT)</option>
            <option value="America/Los_Angeles">Pacific (PT)</option>
            <option value="America/Anchorage">Alaska (AKT)</option>
            <option value="Pacific/Honolulu">Hawaii (HST)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Store Address (optional)</label>
          <input className="form-input" type="text" placeholder="123 Main St, Bangor, ME" value={addr} onChange={e => setAddr(e.target.value)} />
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Location'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════ */
export default function SalesAnalytics() {
  const [tab, setTab]         = useState('Daily');
  const [range, setRange]     = useState(defaultRange('Daily'));
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const [chartType, setChartType]         = useState('master');
  const [activeMetrics, setActiveMetrics] = useState(new Set(METRICS.map(m => m.key)));
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [weatherEnabled, setWeatherEnabled] = useState(false);
  const [locationChecked, setLocationChecked] = useState(false);

  const chartRef = useRef(null);

  /* ─── Check if store location is set ─── */
  const checkLocation = useCallback(async () => {
    try {
      const loc = await getStoreLocation();
      setWeatherEnabled(!!(loc.storeLatitude && loc.storeLongitude));
    } catch {
      setWeatherEnabled(false);
    } finally {
      setLocationChecked(true);
    }
  }, []);

  useEffect(() => { checkLocation(); }, [checkLocation]);

  /* ─── Fetch data ─── */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let result;
      if (tab === 'Daily')   result = await getSalesDailyWithWeather(range);
      else if (tab === 'Weekly')  result = await getSalesWeeklyWithWeather(range);
      else if (tab === 'Monthly') result = await getSalesMonthlyWithWeather(range);
      else                        result = await getSalesYearlyWithWeather(range);
      setData(result);
      if (result.weatherEnabled !== undefined) setWeatherEnabled(result.weatherEnabled);
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [tab, range]);

  useEffect(() => { if (locationChecked) fetchData(); }, [fetchData, locationChecked]);

  const handleTabChange = (t) => {
    setTab(t);
    setRange(defaultRange(t));
    setExpandedWeeks(new Set());
  };

  const toggleMetric = (key) => {
    setActiveMetrics(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  /* ─── Derived data ─── */
  const rows = data?.value || [];
  const agg  = data?.['@odata.aggregation'] || {};

  const avgOrderValue = agg.TotalNetSales && agg.TotalTransactionsCount
    ? agg.TotalNetSales / agg.TotalTransactionsCount : null;

  const chartData = rows.map((r) => ({
    date:         r.Date ? r.Date.slice(0, 10) : (r.Year || ''),
    NetSales:     r.TotalNetSales          || 0,
    GrossSales:   r.TotalGrossSales        || 0,
    Transactions: r.TotalTransactionsCount || 0,
    Discounts:    r.TotalDiscounts         || 0,
    Refunds:      r.TotalRefunds           || 0,
    tempHigh:     r.tempHigh,
    tempLow:      r.tempLow,
    precipitation: r.precipitation,
    condition:    r.condition,
    weekStart:    r.weekStart,
    weekEnd:      r.weekEnd,
  }));

  /* Determine scroll width for 200+ data points */
  const needsScroll  = chartData.length > 90;
  const chartWidth   = needsScroll ? Math.max(900, chartData.length * 18) : '100%';

  /* ─── KPIs ─── */
  const kpis = [
    { label: 'Total Gross Sales',  value: fmtCurrency(agg.TotalGrossSales),        icon: <DollarSign size={22} />,  iconBg: 'var(--brand-15)',  iconColor: 'var(--accent-primary)' },
    { label: 'Total Net Sales',    value: fmtCurrency(agg.TotalNetSales),           icon: <TrendingUp size={22} />,  iconBg: 'rgba(59,130,246,0.15)',  iconColor: '#3b82f6' },
    { label: 'Total Transactions', value: fmtN(agg.TotalTransactionsCount),         icon: <ShoppingCart size={22} />,iconBg: 'rgba(139,92,246,0.15)', iconColor: '#8b5cf6' },
    { label: 'Avg Order Value',    value: fmtCurrency(avgOrderValue),               icon: <Wallet size={22} />,      iconBg: 'rgba(16,185,129,0.15)', iconColor: '#10b981' },
    { label: 'Total Discounts',    value: fmtCurrency(agg.TotalDiscounts),          icon: <Tag size={22} />,         iconBg: 'rgba(248,192,29,0.15)', iconColor: '#f8c01d' },
    { label: 'Total Refunds',      value: fmtCurrency(agg.TotalRefunds),            icon: <ReceiptText size={22} />, iconBg: 'var(--error)',   iconColor: 'var(--error)' },
    { label: 'Total Taxes',        value: fmtCurrency(agg.TotalTaxes),              icon: <DollarSign size={22} />,  iconBg: 'rgba(59,130,246,0.1)',  iconColor: '#3b82f6' },
    { label: 'Total Collected',    value: fmtCurrency(agg.TotalTotalCollected),     icon: <Wallet size={22} />,      iconBg: 'rgba(16,185,129,0.15)', iconColor: '#10b981' },
  ];

  /* ─── Week label formatter ─── */
  const weekLabel = (row) => {
    if (!row.weekStart || !row.weekEnd) return row.Date?.slice(0, 10) || '';
    const s = new Date(row.weekStart + 'T00:00:00');
    const e = new Date(row.weekEnd   + 'T00:00:00');
    return `${DAY_NAMES[s.getDay()]} ${MONTH_NAMES[s.getMonth()]} ${s.getDate()} – ${DAY_NAMES[e.getDay()]} ${MONTH_NAMES[e.getMonth()]} ${e.getDate()}`;
  };

  /* ─── Chart inner ─── */
  const ChartInner = ({ children, height = 280 }) => (
    <div className={needsScroll ? 'chart-scroll-wrapper' : ''}>
      <div className="chart-scroll-inner" style={{ width: chartWidth, height }}>
        <ResponsiveContainer width="100%" height={height}>
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );

  const xAxisProps = {
    dataKey: 'date',
    tick: { fill: 'var(--text-muted)', fontSize: 10 },
    tickFormatter: (v) => formatDateLabel(v, tab),
    interval: needsScroll ? Math.floor(chartData.length / 20) : 'preserveStartEnd',
  };

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">

        {/* ── Header ── */}
        <div className="analytics-header">
          <div>
            <h1 className="analytics-title">Sales Analytics</h1>
            <p className="analytics-subtitle">Revenue trends, weather correlation, and transaction summaries</p>
          </div>
          <div className="analytics-controls">
            <DatePicker label="From" value={range.from}
              onChange={(v) => setRange(r => ({ ...r, from: v }))} maxDate={range.to} />
            <DatePicker label="To" value={range.to}
              onChange={(v) => setRange(r => ({ ...r, to: v }))} minDate={range.from} maxDate={toISO(new Date())} />
            <button className="btn btn-secondary" onClick={fetchData} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <RefreshCw size={15} /> Refresh
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="analytics-tabs">
          {TABS.map((t) => (
            <button key={t} className={`analytics-tab${tab === t ? ' active' : ''}`} onClick={() => handleTabChange(t)}>
              {t}
            </button>
          ))}
        </div>

        {/* ── Weather setup banner ── */}
        {locationChecked && !weatherEnabled && (
          <div className="weather-setup-banner">
            <MapPin size={16} />
            <span>Set your store location to enable weather data and sales correlation.</span>
            <button className="btn btn-secondary" onClick={() => setShowLocationModal(true)}>Set Location</button>
          </div>
        )}

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
          {kpis.map(({ label, value, icon, iconBg, iconColor }) => (
            <div key={label} className="analytics-stat-card">
              <div className="analytics-stat-icon" style={{ background: iconBg, color: iconColor }}>{icon}</div>
              <div>
                <span className="analytics-stat-value">{value}</span>
                <span className="analytics-stat-label">{label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div className="analytics-loading">
            <div className="analytics-spinner" />
            <p>Loading {tab.toLowerCase()} data…</p>
          </div>
        )}

        {/* ── Charts + Table ── */}
        {!loading && !error && chartData.length > 0 && (
          <>
            {/* Chart type selector */}
            <div className="chart-selector">
              {CHART_TYPES.filter(c => c.id !== 'weather' || weatherEnabled).map(c => (
                <button key={c.id}
                  className={`chart-selector-btn${chartType === c.id ? ' active' : ''}`}
                  onClick={() => setChartType(c.id)}>
                  {c.icon}{c.label}
                </button>
              ))}
              {weatherEnabled && (
                <button className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                  onClick={() => setShowLocationModal(true)}>
                  <MapPin size={13} /> Edit Location
                </button>
              )}
            </div>

            {/* ── MASTER CHART ── */}
            {chartType === 'master' && (
              <div className="analytics-chart-card">
                <div className="analytics-chart-title">
                  <LayoutDashboard size={18} style={{ color: 'var(--accent-primary)' }} />
                  Master View — All Metrics
                  {needsScroll && (
                    <span style={{ marginLeft: 'auto', fontSize: '0.73rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                      ← Scroll to explore {chartData.length} {tab.toLowerCase()} periods →
                    </span>
                  )}
                </div>
                {/* Metric toggles */}
                <div className="metric-toggles">
                  {METRICS.filter(m => m.key !== 'tempHigh' && m.key !== 'tempLow' || weatherEnabled).map(m => (
                    <button key={m.key}
                      className={`metric-toggle${activeMetrics.has(m.key) ? '' : ' off'}`}
                      style={{ borderColor: m.color, color: m.color }}
                      onClick={() => toggleMetric(m.key)}>
                      <span className="metric-toggle-dot" style={{ background: m.color }} />
                      {m.label}
                    </button>
                  ))}
                </div>
                <ChartInner height={320}>
                  <ComposedChart data={chartData} margin={{ top: 5, right: 40, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis {...xAxisProps} />
                    {/* Left Y: money */}
                    <YAxis yAxisId="money" orientation="left"
                      tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                      tickFormatter={fmtAxisK} />
                    {/* Right Y: temperature */}
                    {weatherEnabled && (
                      <YAxis yAxisId="temp" orientation="right"
                        tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                        tickFormatter={fmtAxisDeg} domain={['auto', 'auto']} />
                    )}
                    <Tooltip content={<ChartTooltip tab={tab} />} />
                    <Legend wrapperStyle={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }} />
                    {activeMetrics.has('GrossSales') && (
                      <Area yAxisId="money" type="monotone" dataKey="GrossSales"
                        stroke="#3b82f6" fill="rgba(59,130,246,0.08)" strokeWidth={1.5}
                        name="Gross Sales" dot={false} />
                    )}
                    {activeMetrics.has('NetSales') && (
                      <Area yAxisId="money" type="monotone" dataKey="NetSales"
                        stroke="var(--accent-primary)" fill="var(--brand-10)" strokeWidth={2.5}
                        name="Net Sales" dot={false} />
                    )}
                    {activeMetrics.has('Transactions') && (
                      <Bar yAxisId="money" dataKey="Transactions"
                        fill="rgba(139,92,246,0.35)" radius={[2,2,0,0]}
                        name="Transactions" maxBarSize={12} />
                    )}
                    {weatherEnabled && activeMetrics.has('tempHigh') && (
                      <Line yAxisId="temp" type="monotone" dataKey="tempHigh"
                        stroke="#ef4444" strokeWidth={1.5} dot={false}
                        name="Temp High" strokeDasharray="4 2" />
                    )}
                    {weatherEnabled && activeMetrics.has('tempLow') && (
                      <Line yAxisId="temp" type="monotone" dataKey="tempLow"
                        stroke="#60a5fa" strokeWidth={1.5} dot={false}
                        name="Temp Low" strokeDasharray="4 2" />
                    )}
                  </ComposedChart>
                </ChartInner>
              </div>
            )}

            {/* ── SALES TREND CHART ── */}
            {chartType === 'sales' && (
              <div className="analytics-grid-2">
                <div className="analytics-chart-card" style={{ marginBottom: 0 }}>
                  <div className="analytics-chart-title">
                    <TrendingUp size={18} style={{ color: 'var(--accent-primary)' }} /> Net Sales Trend
                  </div>
                  <ChartInner height={240}>
                    <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                      <defs>
                        <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="var(--accent-primary)" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                      <XAxis {...xAxisProps} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip content={<ChartTooltip tab={tab} />} />
                      <Area type="monotone" dataKey="NetSales" stroke="var(--accent-primary)" fill="url(#netGrad)" strokeWidth={2.5} name="Net Sales" dot={false} />
                    </AreaChart>
                  </ChartInner>
                </div>

                <div className="analytics-chart-card" style={{ marginBottom: 0 }}>
                  <div className="analytics-chart-title">
                    <DollarSign size={18} style={{ color: '#3b82f6' }} /> Gross vs Net
                  </div>
                  <ChartInner height={240}>
                    <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                      <defs>
                        <linearGradient id="grossGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                      <XAxis {...xAxisProps} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip content={<ChartTooltip tab={tab} />} />
                      <Legend wrapperStyle={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }} />
                      <Area type="monotone" dataKey="GrossSales" stroke="#3b82f6" fill="url(#grossGrad)" strokeWidth={2} name="Gross Sales" dot={false} />
                      <Area type="monotone" dataKey="NetSales"   stroke="var(--accent-primary)" fill="var(--brand-10)" strokeWidth={2} name="Net Sales" dot={false} />
                    </AreaChart>
                  </ChartInner>
                </div>
              </div>
            )}

            {/* ── WEATHER CHART ── */}
            {chartType === 'weather' && weatherEnabled && (
              <div className="analytics-grid-2">
                <div className="analytics-chart-card" style={{ marginBottom: 0 }}>
                  <div className="analytics-chart-title">
                    <Thermometer size={18} style={{ color: '#ef4444' }} /> Temperature Range
                  </div>
                  <ChartInner height={240}>
                    <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                      <defs>
                        <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                      <XAxis {...xAxisProps} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickFormatter={(v) => `${v}°F`} domain={['auto', 'auto']} />
                      <Tooltip content={<ChartTooltip tab={tab} />} />
                      <Legend wrapperStyle={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }} />
                      <Area type="monotone" dataKey="tempHigh" stroke="#ef4444" fill="url(#tempGrad)" strokeWidth={2} name="Temp High" dot={false} />
                      <Line type="monotone" dataKey="tempLow"  stroke="#60a5fa" strokeWidth={2} name="Temp Low" dot={false} />
                    </ComposedChart>
                  </ChartInner>
                </div>

                <div className="analytics-chart-card" style={{ marginBottom: 0 }}>
                  <div className="analytics-chart-title">
                    <Droplets size={18} style={{ color: '#3b82f6' }} /> Precipitation (mm)
                  </div>
                  <ChartInner height={240}>
                    <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                      <XAxis {...xAxisProps} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickFormatter={fmtAxisMm} />
                      <Tooltip content={<ChartTooltip tab={tab} />} />
                      <Bar dataKey="precipitation" fill="#3b82f6" radius={[3,3,0,0]} name="Precipitation" maxBarSize={20} opacity={0.7} />
                    </BarChart>
                  </ChartInner>
                </div>
              </div>
            )}

            {/* ── TRANSACTIONS CHART ── */}
            {chartType === 'txn' && (
              <div className="analytics-chart-card">
                <div className="analytics-chart-title">
                  <ShoppingCart size={18} style={{ color: '#8b5cf6' }} /> Transaction Count
                </div>
                <ChartInner height={260}>
                  <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis {...xAxisProps} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip tab={tab} />} />
                    <Bar dataKey="Transactions" fill="#8b5cf6" radius={[3,3,0,0]} name="Transactions" />
                  </BarChart>
                </ChartInner>
              </div>
            )}

            {/* ── DATA TABLE ── */}
            <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
              <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
                Detailed Records
                {needsScroll && <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>({chartData.length} periods)</span>}
              </p>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      {/* Daily columns */}
                      {tab === 'Daily' && <>
                        <th>Date</th>
                        {weatherEnabled && <><th>High</th><th>Low</th><th>Condition</th></>}
                        <th>Gross Sales</th><th>Net Sales</th><th>Discounts</th>
                        <th>Refunds</th><th>Taxes</th><th>Transactions</th><th>Collected</th>
                      </>}
                      {/* Weekly columns */}
                      {tab === 'Weekly' && <>
                        <th style={{ width: 20 }}></th>
                        <th>Week</th>
                        {weatherEnabled && <><th>Avg High</th><th>Avg Low</th><th>Condition</th></>}
                        <th>Gross Sales</th><th>Net Sales</th><th>Transactions</th><th>Collected</th>
                      </>}
                      {/* Monthly columns */}
                      {tab === 'Monthly' && <>
                        <th>Month</th>
                        {weatherEnabled && <><th>Avg High</th><th>Avg Low</th><th>Condition</th></>}
                        <th>Gross Sales</th><th>Net Sales</th><th>Discounts</th>
                        <th>Transactions</th><th>Collected</th>
                      </>}
                      {/* Yearly columns */}
                      {tab === 'Yearly' && <>
                        <th>Year</th>
                        {weatherEnabled && <><th>Avg High</th><th>Avg Low</th></>}
                        <th>Gross Sales</th><th>Net Sales</th><th>Discounts</th>
                        <th>Refunds</th><th>Transactions</th><th>Collected</th>
                      </>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const weatherInfo = r.weatherCode != null ? getWeatherInfo(r.weatherCode) : null;
                      const isExpanded = expandedWeeks.has(i);

                      /* ─── Daily Row ─── */
                      if (tab === 'Daily') return (
                        <tr key={i}>
                          <td style={{ fontWeight: 500 }}>{r.Date?.slice(0, 10)}</td>
                          {weatherEnabled && <>
                            <td className="weather-temp-badge">
                              <span className="weather-temp-high">{fmtT(r.tempHigh)}</span>
                            </td>
                            <td className="weather-temp-badge">
                              <span className="weather-temp-low">{fmtT(r.tempLow)}</span>
                            </td>
                            <td>
                              <span className="weather-condition">
                                {weatherInfo && <span>{weatherInfo.emoji}</span>}
                                {r.condition || '—'}
                              </span>
                            </td>
                          </>}
                          <td>{fmtCurrency(r.TotalGrossSales)}</td>
                          <td style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{fmtCurrency(r.TotalNetSales)}</td>
                          <td style={{ color: 'var(--warning)' }}>{fmtCurrency(r.TotalDiscounts)}</td>
                          <td style={{ color: 'var(--error)' }}>{fmtCurrency(r.TotalRefunds)}</td>
                          <td>{fmtCurrency(r.TotalTaxes)}</td>
                          <td>{fmtN(r.TotalTransactionsCount)}</td>
                          <td style={{ color: 'var(--success)', fontWeight: 600 }}>{fmtCurrency(r.TotalTotalCollected)}</td>
                        </tr>
                      );

                      /* ─── Weekly Row (expandable) ─── */
                      if (tab === 'Weekly') return (
                        <React.Fragment key={i}>
                          <tr
                            className={`table-row-expandable${isExpanded ? ' table-row-expanded' : ''}`}
                            onClick={() => setExpandedWeeks(prev => {
                              const next = new Set(prev);
                              next.has(i) ? next.delete(i) : next.add(i);
                              return next;
                            })}
                          >
                            <td style={{ width: 20, paddingRight: 0 }}>
                              <span className={`expand-chevron${isExpanded ? ' open' : ''}`}>
                                <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                              </span>
                            </td>
                            <td style={{ fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                              {weekLabel(r)}
                            </td>
                            {weatherEnabled && <>
                              <td className="weather-temp-badge">
                                <span className="weather-temp-high">{fmtT(r.tempHigh)}</span>
                              </td>
                              <td className="weather-temp-badge">
                                <span className="weather-temp-low">{fmtT(r.tempLow)}</span>
                              </td>
                              <td>
                                <span className="weather-condition">
                                  {r.condition || '—'}
                                </span>
                              </td>
                            </>}
                            <td>{fmtCurrency(r.TotalGrossSales)}</td>
                            <td style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{fmtCurrency(r.TotalNetSales)}</td>
                            <td>{fmtN(r.TotalTransactionsCount)}</td>
                            <td style={{ color: 'var(--success)', fontWeight: 600 }}>{fmtCurrency(r.TotalTotalCollected)}</td>
                          </tr>
                          {/* Expanded daily breakdown */}
                          {isExpanded && r.dailyWeather && r.dailyWeather.length > 0 && r.dailyWeather.map((day, di) => (
                            <tr key={`day-${i}-${di}`} className="table-sub-row">
                              <td></td>
                              <td style={{ color: 'var(--text-secondary)', paddingLeft: '2rem' }}>
                                {(() => {
                                  const d = safeDate(day.date);
                                  if (!d) return day.date || '';
                                  return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
                                })()}
                              </td>
                              {weatherEnabled && <>
                                <td className="weather-temp-badge"><span className="weather-temp-high">{fmtT(day.temperatureMax)}</span></td>
                                <td className="weather-temp-badge"><span className="weather-temp-low">{fmtT(day.temperatureMin)}</span></td>
                                <td>
                                  <span className="weather-condition">
                                    {day.weatherCode != null ? getWeatherInfo(day.weatherCode).emoji : ''} {day.condition || '—'}
                                  </span>
                                </td>
                              </>}
                              <td colSpan={4} style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                                {getPrecipLabel(day.precipitationSum)} precipitation
                                {day.precipitationSum > 0 ? ` (${day.precipitationSum}mm)` : ''}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );

                      /* ─── Monthly Row ─── */
                      if (tab === 'Monthly') {
                        const d = r.Date ? new Date(r.Date + 'T00:00:00') : null;
                        const monthLabel = d ? `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` : r.Date?.slice(0, 7);
                        return (
                          <tr key={i}>
                            <td style={{ fontWeight: 500 }}>{monthLabel}</td>
                            {weatherEnabled && <>
                              <td className="weather-temp-badge"><span className="weather-temp-high">{fmtT(r.tempHigh)}</span></td>
                              <td className="weather-temp-badge"><span className="weather-temp-low">{fmtT(r.tempLow)}</span></td>
                              <td><span className="weather-condition">{r.condition || '—'}</span></td>
                            </>}
                            <td>{fmtCurrency(r.TotalGrossSales)}</td>
                            <td style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{fmtCurrency(r.TotalNetSales)}</td>
                            <td style={{ color: 'var(--warning)' }}>{fmtCurrency(r.TotalDiscounts)}</td>
                            <td>{fmtN(r.TotalTransactionsCount)}</td>
                            <td style={{ color: 'var(--success)', fontWeight: 600 }}>{fmtCurrency(r.TotalTotalCollected)}</td>
                          </tr>
                        );
                      }

                      /* ─── Yearly Row ─── */
                      return (
                        <tr key={i}>
                          <td style={{ fontWeight: 700, fontSize: '1rem' }}>{r.Year || r.Date?.slice(0, 4)}</td>
                          {weatherEnabled && <>
                            <td className="weather-temp-badge"><span className="weather-temp-high">{fmtT(r.tempHigh)}</span></td>
                            <td className="weather-temp-badge"><span className="weather-temp-low">{fmtT(r.tempLow)}</span></td>
                          </>}
                          <td>{fmtCurrency(r.TotalGrossSales)}</td>
                          <td style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{fmtCurrency(r.TotalNetSales)}</td>
                          <td style={{ color: 'var(--warning)' }}>{fmtCurrency(r.TotalDiscounts)}</td>
                          <td style={{ color: 'var(--error)' }}>{fmtCurrency(r.TotalRefunds)}</td>
                          <td>{fmtN(r.TotalTransactionsCount)}</td>
                          <td style={{ color: 'var(--success)', fontWeight: 600 }}>{fmtCurrency(r.TotalTotalCollected)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && chartData.length === 0 && data && (
          <div className="glass-card">
            <div className="analytics-empty">No data found for this period.</div>
          </div>
        )}

        {/* ── Location Modal ── */}
        {showLocationModal && (
          <LocationModal
            onClose={() => setShowLocationModal(false)}
            onSaved={() => { checkLocation(); fetchData(); }}
          />
        )}

      </main>
    </div>
  );
}
