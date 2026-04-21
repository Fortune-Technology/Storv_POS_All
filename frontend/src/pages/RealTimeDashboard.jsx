/**
 * RealTimeDashboard.jsx — Live sales dashboard powered by native Prisma transactions.
 *
 * Sections:
 *  - Weather widget (current + hourly + 10-day)
 *  - KPI cards: Net Sales, Transactions, Avg Transaction, Tax Collected
 *  - Payment breakdown bar + PieChart (Cash / Card / EBT)
 *  - Hourly sales bar chart (24 hours, zero-filled)
 *  - Live transaction feed (last 15)
 *  - Top products by revenue
 *  - 14-day trend (area + bar)
 *  - Lottery stats
 *
 * Features:
 *  - Date picker (defaults to today; auto-refresh only for today)
 *  - CSV / PDF export buttons
 *  - Embedded mode for AnalyticsHub tab context
 *  - Uses shared portal.css `p-` class system
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import WeatherWidget from '../components/WeatherWidget';
import { getRealtimeSales } from '../services/api';
import { downloadCSV, downloadPDF } from '../utils/exportUtils';
import '../styles/portal.css';
import './RealTimeDashboard.css';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Activity, DollarSign, ShoppingCart, TrendingUp, RefreshCw,
  AlertCircle, Calendar, Zap, Package, CreditCard, Banknote,
  Clock, Receipt, Ticket, ArrowDownCircle, ArrowUpCircle, Star,
  Download, FileText, FileSpreadsheet,
} from 'lucide-react';

/* ── Formatters ───────────────────────────────────────────────────────────── */
const fmt   = (n) => n == null ? 'N/A' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSh = (n) => { if (n == null) return 'N/A'; if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k'; return '$' + Number(n).toFixed(0); };
const fmtN  = (n) => n == null ? 'N/A' : Number(n).toLocaleString();
const fmtT  = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return 'N/A'; } };

/** Today in YYYY-MM-DD local time */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Format date string for display */
function formatDisplayDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

/* ── Hour labels for 24-hour zero-fill ────────────────────────────────────── */
function buildHourlyData(rawHourly) {
  const map = {};
  (rawHourly || []).forEach(h => { map[h.hour] = h; });
  const result = [];
  for (let hr = 0; hr < 24; hr++) {
    const existing = map[hr];
    const suffix = hr === 0 ? '12a' : hr < 12 ? `${hr}a` : hr === 12 ? '12p' : `${hr - 12}p`;
    result.push({
      hour: hr,
      label: existing?.label || suffix,
      sales: existing?.sales ?? 0,
      txns: existing?.txns ?? 0,
    });
  }
  return result;
}

/* ── Tender icon ─────────────────────────────────────────────────────────── */
function TenderIcon({ method }) {
  const m = (method || '').toLowerCase();
  if (m === 'cash') return <Banknote size={12} />;
  if (m === 'ebt')  return <Receipt size={12} />;
  return <CreditCard size={12} />;
}

/* ── Tender label ────────────────────────────────────────────────────────── */
function tenderLabel(method) {
  const m = (method || '').toLowerCase();
  if (m === 'cash') return 'Cash';
  if (m === 'ebt')  return 'EBT';
  if (m === 'credit') return 'Credit';
  if (m === 'debit')  return 'Debit';
  return method || 'Other';
}

/* ── Custom chart tooltip ────────────────────────────────────────────────── */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rtd-tooltip">
      <div className="rtd-tooltip-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="rtd-tooltip-row" style={{ color: p.color || p.fill }}>
          <span>{p.name}:</span>
          <span>{p.name === 'Sales' || p.name === 'Net Sales' ? fmtSh(p.value) : fmtN(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Custom PieChart tooltip ─────────────────────────────────────────────── */
function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="rtd-tooltip">
      <div className="rtd-tooltip-label">{d.name}</div>
      <div className="rtd-tooltip-row" style={{ color: d.payload?.fill }}>
        <span>Amount:</span>
        <span>{fmt(d.value)}</span>
      </div>
    </div>
  );
}

/* ── Payment colors ──────────────────────────────────────────────────────── */
const PAYMENT_COLORS = { Cash: '#10b981', Card: '#3b82f6', EBT: '#f59e0b' };

/* ══════════════════════════════════════════════════════════════════════════ */
export default function RealTimeDashboard({ embedded = false }) {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [countdown,   setCountdown]   = useState(60);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const intervalRef  = useRef(null);
  const cntRef       = useRef(null);

  const isToday = selectedDate === todayISO();

  /* ── Fetch ──────────────────────────────────────────────────────────────── */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const params = {};
      if (selectedDate && selectedDate !== todayISO()) {
        params.date = selectedDate;
      }
      const res = await getRealtimeSales(params);
      setData(res);
      setLastUpdated(new Date());
      setCountdown(60);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  /* ── Auto-refresh every 60s (only when viewing today) ───────────────────── */
  useEffect(() => {
    load();

    // Clear previous intervals
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (cntRef.current) clearInterval(cntRef.current);

    if (isToday) {
      intervalRef.current = setInterval(() => load(true), 60_000);
      cntRef.current      = setInterval(() => setCountdown(c => (c <= 1 ? 60 : c - 1)), 1_000);
    }

    return () => {
      clearInterval(intervalRef.current);
      clearInterval(cntRef.current);
    };
  }, [load, isToday]);

  /* ── Date change handler ────────────────────────────────────────────────── */
  const handleDateChange = useCallback((e) => {
    const val = e.target.value;
    if (val) {
      setSelectedDate(val);
      setCountdown(60);
    }
  }, []);

  /* ── Derived data ──────────────────────────────────────────────────────── */
  const ts       = data?.todaySales;
  const netSales = ts?.netSales    ?? null;
  const txCount  = ts?.txCount     ?? null;
  const avgTx    = ts?.avgTx       ?? null;
  const taxTotal = ts?.taxTotal    ?? null;
  const cashT    = ts?.cashTotal   ?? 0;
  const cardT    = ts?.cardTotal   ?? 0;
  const ebtT     = ts?.ebtTender   ?? 0;
  const tenderSum = cashT + cardT + ebtT || 1;

  const avgMargin = ts?.avgMargin ?? null;
  const invGrade  = data?.inventoryGrade;

  const kpis = [
    { label: 'Net Sales',        value: fmt(netSales),  icon: <DollarSign size={20} />, color: 'var(--accent-primary)', bg: 'var(--brand-12)' },
    { label: 'Transactions',     value: fmtN(txCount),  icon: <ShoppingCart size={20} />, color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
    { label: 'Avg Transaction',  value: fmt(avgTx),     icon: <TrendingUp size={20} />, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    { label: 'Avg Margin',       value: avgMargin != null ? `${avgMargin}%` : 'N/A', icon: <Activity size={20} />, color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
    { label: 'Tax Collected',    value: fmt(taxTotal),  icon: <Activity size={20} />,   color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
    { label: 'Inventory Grade',  value: invGrade ? `${invGrade.grade} (${invGrade.fillRate}%)` : 'N/A', icon: <Package size={20} />, color: invGrade?.grade === 'A' ? '#10b981' : invGrade?.grade === 'B' ? '#3b82f6' : invGrade?.grade === 'C' ? '#f59e0b' : '#ef4444', bg: invGrade?.grade === 'A' ? 'rgba(16,185,129,0.12)' : invGrade?.grade === 'B' ? 'rgba(59,130,246,0.12)' : 'rgba(245,158,11,0.12)' },
  ];

  /* Weather data */
  const weather = data?.weather || null;

  /* Lottery */
  const lt = data?.lottery;

  /* Hourly -- full 24 hours zero-filled */
  const hourly = useMemo(() => buildHourlyData(data?.hourly), [data?.hourly]);

  /* 14-day trend */
  const trend = useMemo(() => (data?.trend || []).map(r => ({
    date:   new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    Sales:  r.netSales ?? 0,
    Txns:   r.txCount  ?? 0,
  })), [data?.trend]);

  /* Top products */
  const topProducts = data?.topProducts || [];

  /* Recent transactions */
  const recentTx = data?.recentTx || [];

  /* Payment pie data */
  const paymentPieData = useMemo(() => [
    { name: 'Cash', value: cashT },
    { name: 'Card', value: cardT },
    { name: 'EBT',  value: ebtT },
  ].filter(d => d.value > 0), [cashT, cardT, ebtT]);

  const displayDate = formatDisplayDate(selectedDate);

  /* ── Export handlers ────────────────────────────────────────────────────── */
  const handleExportCSV = useCallback(() => {
    if (!data) return;
    const rows = [];
    // KPI summary row
    rows.push({
      metric: 'Net Sales', value: netSales ?? 0,
      transactions: txCount ?? 0, avgTransaction: avgTx ?? 0, tax: taxTotal ?? 0,
    });
    // Hourly rows
    hourly.forEach(h => {
      rows.push({ metric: `Hour ${h.label}`, value: h.sales, transactions: h.txns, avgTransaction: '', tax: '' });
    });
    // Top products
    topProducts.forEach((p, i) => {
      rows.push({ metric: `#${i + 1} ${p.name}`, value: p.revenue, transactions: p.qty, avgTransaction: '', tax: '' });
    });

    downloadCSV(rows, [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Amount ($)' },
      { key: 'transactions', label: 'Count' },
      { key: 'avgTransaction', label: 'Avg Transaction' },
      { key: 'tax', label: 'Tax' },
    ], `live-dashboard-${selectedDate}`);
  }, [data, netSales, txCount, avgTx, taxTotal, hourly, topProducts, selectedDate]);

  const handleExportPDF = useCallback(async () => {
    if (!data) return;
    const tableData = hourly.map(h => ({
      hour: h.label, sales: fmt(h.sales), txns: h.txns,
    }));

    await downloadPDF({
      title: 'Live Dashboard Report',
      subtitle: `Date: ${displayDate}`,
      summary: kpis.map(k => ({ label: k.label, value: k.value })),
      data: tableData,
      columns: [
        { key: 'hour', label: 'Hour' },
        { key: 'sales', label: 'Sales' },
        { key: 'txns', label: 'Transactions' },
      ],
      filename: `live-dashboard-${selectedDate}`,
    });
  }, [data, hourly, displayDate, kpis, selectedDate]);

  /* ── Content ────────────────────────────────────────────────────────────── */
  const content = (
    <div className="p-page">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon">
            <Activity size={22} />
          </div>
          <div>
            <h1 className="p-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isToday && <span className="pulse-dot" />}
              Live Dashboard
            </h1>
            <p className="p-subtitle">{displayDate}</p>
          </div>
        </div>

        <div className="p-header-actions">
          {/* Date picker */}
          <input
            type="date"
            className="p-input"
            style={{ width: 160 }}
            value={selectedDate}
            max={todayISO()}
            onChange={handleDateChange}
          />

          {/* Export buttons */}
          <button className="p-btn p-btn-ghost p-btn-sm" onClick={handleExportCSV} disabled={!data} title="Export CSV">
            <FileSpreadsheet size={14} />
            CSV
          </button>
          <button className="p-btn p-btn-ghost p-btn-sm" onClick={handleExportPDF} disabled={!data} title="Export PDF">
            <FileText size={14} />
            PDF
          </button>

          {/* Refresh info + button */}
          {isToday && lastUpdated && (
            <span className="rtd-refresh-info">
              Updated {lastUpdated.toLocaleTimeString()} &middot; {countdown}s
            </span>
          )}
          {!isToday && lastUpdated && (
            <span className="rtd-refresh-info">
              Loaded {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button className="p-btn p-btn-primary p-btn-sm" onClick={() => load()} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'rtd-spin' : ''} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="rtd-error">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {/* ── Loading skeleton ─────────────────────────────────────────────── */}
      {loading && !data && (
        <div className="rtd-loading">
          <div className="rtd-loading-spinner" />
          Loading dashboard data...
        </div>
      )}

      {/* ── Weather Widget ───────────────────────────────────────────────── */}
      {weather && (
        <div style={{ marginBottom: '1.5rem' }}>
          <WeatherWidget weather={weather} />
        </div>
      )}

      {/* ── KPI Cards ────────────────────────────────────────────────────── */}
      <div className="p-stat-grid">
        {kpis.map(k => (
          <div key={k.label} className="p-stat-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div
                className="rtd-kpi-icon"
                style={{ background: k.bg, color: k.color }}
              >
                {k.icon}
              </div>
              <span className="p-stat-label" style={{ marginBottom: 0 }}>{k.label}</span>
            </div>
            <div className="p-stat-value" style={{ color: k.color }}>
              {loading && !data ? '...' : k.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Payment Breakdown + Pie Chart + Today Summary ────────────────── */}
      {ts && (
        <div className="p-grid-3" style={{ marginBottom: '1.25rem' }}>

          {/* Payment breakdown bars */}
          <div className="p-card">
            <div className="rtd-card-title">
              <CreditCard size={15} style={{ color: '#3b82f6' }} />
              Payment Breakdown
            </div>
            <div className="rtd-tender-bars">
              {[
                { label: 'Cash',  value: cashT, color: '#10b981' },
                { label: 'Card',  value: cardT, color: '#3b82f6' },
                { label: 'EBT',   value: ebtT,  color: '#f59e0b' },
              ].map(t => (
                <div key={t.label} className="rtd-tender-row">
                  <div className="rtd-tender-label">
                    <span style={{ color: t.color }}>{t.label}</span>
                    <span>{fmt(t.value)}</span>
                  </div>
                  <div className="rtd-tender-track">
                    <div
                      className="rtd-tender-fill"
                      style={{ width: `${(t.value / tenderSum * 100).toFixed(1)}%`, background: t.color }}
                    />
                  </div>
                  <span className="rtd-tender-pct">{(t.value / tenderSum * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Payment pie chart */}
          <div className="p-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div className="rtd-card-title" style={{ width: '100%' }}>
              <CreditCard size={15} style={{ color: '#8b5cf6' }} />
              Payment Split
            </div>
            {paymentPieData.length > 0 ? (
              <div style={{ width: '100%', height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={paymentPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {paymentPieData.map((entry) => (
                        <Cell key={entry.name} fill={PAYMENT_COLORS[entry.name] || '#6b7280'} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      iconSize={8}
                      formatter={(value) => (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="rtd-empty">No payment data.</div>
            )}
          </div>

          {/* Today summary numbers */}
          <div className="p-card">
            <div className="rtd-card-title">
              <Zap size={15} style={{ color: '#8b5cf6' }} />
              Day Summary
            </div>
            <div className="rtd-summary-grid">
              {[
                { label: 'Net Sales',                     value: fmt(ts.netSales),     accent: true },
                { label: 'Gross Sales',                   value: fmt(ts.grossSales) },
                { label: 'Tax Collected',                 value: fmt(ts.taxTotal) },
                { label: 'Bottle Deposits (pass-through)',value: fmt(ts.depositTotal) },
                { label: 'Bag Fees (pass-through)',       value: fmt(ts.bagFeeTotal ?? 0) },
                { label: 'EBT Sales',                     value: fmt(ts.ebtTotal) },
                { label: 'Transactions',                  value: fmtN(ts.txCount) },
              ].map(item => (
                <div key={item.label} className="rtd-summary-item">
                  <div className="rtd-summary-label">{item.label}</div>
                  <div className={`rtd-summary-value${item.accent ? ' accent' : ''}`}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Hourly Sales Chart (24h zero-filled) ─────────────────────────── */}
      <div className="p-card" style={{ marginBottom: '1.25rem' }}>
        <div className="rtd-card-title">
          <Clock size={15} style={{ color: 'var(--accent-primary)' }} />
          Hourly Sales {isToday ? '--- Today' : `--- ${selectedDate}`}
        </div>
        {hourly.every(h => h.sales === 0) ? (
          <div className="rtd-empty">No transactions recorded for this date.</div>
        ) : (
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourly} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
                  interval={1}
                />
                <YAxis tickFormatter={fmtSh} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={52} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="sales" name="Sales" fill="var(--accent-primary)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Lottery ──────────────────────────────────────────────────────── */}
      {lt && (
        <div className="p-card rtd-lottery-card" style={{ marginBottom: '1.25rem' }}>
          <div className="rtd-card-title">
            <Ticket size={15} style={{ color: '#f59e0b' }} />
            Lottery {isToday ? '--- Today' : `--- ${selectedDate}`}
            {lt.activeBoxes > 0 && (
              <span className="p-badge p-badge-amber" style={{ marginLeft: 8 }}>
                {lt.activeBoxes} active {lt.activeBoxes === 1 ? 'box' : 'boxes'}
              </span>
            )}
          </div>

          <div className="rtd-lottery-grid">
            {/* Sales */}
            <div className="rtd-lottery-stat">
              <div className="rtd-lottery-stat-icon" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>
                <ArrowDownCircle size={18} />
              </div>
              <div>
                <div className="rtd-lottery-stat-label">Ticket Sales</div>
                <div className="rtd-lottery-stat-value" style={{ color: '#10b981' }}>{fmt(lt.sales)}</div>
                <div className="rtd-lottery-stat-sub">{fmtN(lt.txCount)} {lt.txCount === 1 ? 'sale' : 'sales'} &middot; {fmtN(lt.tickets)} tickets</div>
              </div>
            </div>

            {/* Payouts */}
            <div className="rtd-lottery-stat">
              <div className="rtd-lottery-stat-icon" style={{ background: 'rgba(239,68,68,0.10)', color: '#ef4444' }}>
                <ArrowUpCircle size={18} />
              </div>
              <div>
                <div className="rtd-lottery-stat-label">Payouts</div>
                <div className="rtd-lottery-stat-value" style={{ color: '#ef4444' }}>{fmt(lt.payouts)}</div>
                <div className="rtd-lottery-stat-sub">{fmtN(lt.payoutCount)} {lt.payoutCount === 1 ? 'payout' : 'payouts'}</div>
              </div>
            </div>

            {/* Net */}
            <div className="rtd-lottery-stat">
              <div className="rtd-lottery-stat-icon" style={{ background: 'var(--brand-12)', color: 'var(--accent-primary)' }}>
                <DollarSign size={18} />
              </div>
              <div>
                <div className="rtd-lottery-stat-label">Net Lottery</div>
                <div className="rtd-lottery-stat-value" style={{ color: lt.net >= 0 ? 'var(--accent-primary)' : 'var(--error)' }}>{fmt(lt.net)}</div>
                <div className="rtd-lottery-stat-sub">Sales - Payouts</div>
              </div>
            </div>

            {/* Commission */}
            <div className="rtd-lottery-stat">
              <div className="rtd-lottery-stat-icon" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                <Star size={18} />
              </div>
              <div>
                <div className="rtd-lottery-stat-label">Commission Earned</div>
                <div className="rtd-lottery-stat-value" style={{ color: '#f59e0b' }}>{fmt(lt.commission)}</div>
                <div className="rtd-lottery-stat-sub">{(lt.commissionRate * 100).toFixed(1)}% of ticket sales</div>
              </div>
            </div>
          </div>

          {/* Net bar */}
          {lt.sales > 0 && (
            <div className="rtd-lottery-bar-wrap">
              <div className="rtd-lottery-bar-track">
                <div className="rtd-lottery-bar-sales" style={{ width: '100%' }} title={`Sales: ${fmt(lt.sales)}`} />
                <div
                  className="rtd-lottery-bar-payouts"
                  style={{ width: `${Math.min(100, (lt.payouts / lt.sales) * 100).toFixed(1)}%` }}
                  title={`Payouts: ${fmt(lt.payouts)}`}
                />
              </div>
              <div className="rtd-lottery-bar-legend">
                <span style={{ color: '#10b981' }}>Sales {fmt(lt.sales)}</span>
                <span style={{ color: '#ef4444' }}>Payouts {fmt(lt.payouts)}</span>
                <span style={{ color: '#f59e0b' }}>Commission {fmt(lt.commission)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Live Feed + Top Products ─────────────────────────────────────── */}
      <div className="p-grid-2" style={{ marginBottom: '1.25rem' }}>

        {/* Live transaction feed */}
        <div className="p-card rtd-feed-card">
          <div className="rtd-card-title">
            <Activity size={15} style={{ color: '#10b981' }} />
            Recent Transactions
            {isToday && <span className="rtd-live-dot" />}
          </div>
          {recentTx.length === 0 ? (
            <div className="rtd-empty">N/A — no transactions recorded</div>
          ) : (
            <div className="rtd-feed">
              {recentTx.map(tx => {
                const tenders = Array.isArray(tx.tenderLines) ? tx.tenderLines : [];
                const primary = tenders[0] || {};
                return (
                  <div key={tx.id} className="rtd-feed-row">
                    <div className="rtd-feed-icon">
                      <TenderIcon method={primary.method} />
                    </div>
                    <div className="rtd-feed-info">
                      <div className="rtd-feed-txnum">{tx.txNumber || tx.id.slice(-8)}</div>
                      <div className="rtd-feed-time">{fmtT(tx.createdAt)}{tx.stationId ? ` \u00b7 ${tx.stationId}` : ''}</div>
                    </div>
                    <div className="rtd-feed-amount">{fmt(tx.grandTotal)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top products */}
        <div className="p-card rtd-feed-card">
          <div className="rtd-card-title">
            <Package size={15} style={{ color: '#f59e0b' }} />
            Top Products {isToday ? '--- Today' : ''}
          </div>
          {topProducts.length === 0 ? (
            <div className="rtd-empty">N/A — no product data available</div>
          ) : (
            <div className="rtd-products">
              {topProducts.map((p, i) => {
                const maxRev = topProducts[0]?.revenue || 1;
                return (
                  <div key={p.name} className="rtd-product-row">
                    <div className="rtd-product-rank">{i + 1}</div>
                    <div className="rtd-product-info">
                      <div className="rtd-product-name">{p.name}</div>
                      <div className="rtd-product-bar-track">
                        <div
                          className="rtd-product-bar-fill"
                          style={{ width: `${(p.revenue / maxRev * 100).toFixed(1)}%` }}
                        />
                      </div>
                    </div>
                    <div className="rtd-product-meta">
                      <div className="rtd-product-rev">{fmt(p.revenue)}</div>
                      <div className="rtd-product-qty">{fmtN(p.qty)} sold</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── 14-Day Sales Trend ───────────────────────────────────────────── */}
      <div className="p-card" style={{ marginBottom: '1.25rem' }}>
        <div className="rtd-card-title">
          <Calendar size={15} style={{ color: 'var(--accent-primary)' }} />
          Last 14 Days --- Net Sales
        </div>
        {trend.length === 0 ? (
          <div className="rtd-empty">No recent sales data.</div>
        ) : (
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rtdSalesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--accent-primary)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} />
                <YAxis tickFormatter={fmtSh} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={52} />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone" dataKey="Sales" name="Net Sales"
                  stroke="var(--accent-primary)" strokeWidth={2}
                  fill="url(#rtdSalesGrad)" dot={false} activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── 14-Day Transactions ──────────────────────────────────────────── */}
      {trend.length > 0 && (
        <div className="p-card" style={{ marginBottom: '1.25rem' }}>
          <div className="rtd-card-title">
            <ShoppingCart size={15} style={{ color: '#3b82f6' }} />
            Last 14 Days --- Transactions
          </div>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={36} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="Txns" name="Transactions" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );

  return content;
}
