/**
 * RealTimeDashboard.jsx — Live sales dashboard powered by native Prisma transactions.
 *
 * Sections:
 *  • KPI cards: Net Sales, Transactions, Avg Transaction, Tax Collected
 *  • Payment breakdown bar (Cash / Card / EBT)
 *  • Hourly sales bar chart (today)
 *  • Live transaction feed (last 15)
 *  • Top products by revenue (today)
 *  • 14-day trend (area + bar)
 *
 * CSS: ./RealTimeDashboard.css  (rtd- prefix)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from '../components/Sidebar';
import './RealTimeDashboard.css';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Activity, DollarSign, ShoppingCart, TrendingUp, RefreshCw,
  AlertCircle, Calendar, Zap, Package, CreditCard, Banknote,
  Clock, Receipt, Ticket, ArrowDownCircle, ArrowUpCircle, Star,
} from 'lucide-react';
import { getRealtimeSales } from '../services/api';

/* ── Formatters ───────────────────────────────────────────────────────────── */
const fmt   = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSh = (n) => { if (n == null) return '—'; if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k'; return '$' + Number(n).toFixed(0); };
const fmtN  = (n) => n == null ? '—' : Number(n).toLocaleString();
const fmtT  = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };

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

/* ── Custom bar chart tooltip ─────────────────────────────────────────────── */
function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rtd-tooltip">
      <div className="rtd-tooltip-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="rtd-tooltip-row" style={{ color: p.color || p.fill }}>
          <span>{p.name}:</span>
          <span>{p.name === 'Sales' ? fmtSh(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function RealTimeDashboard() {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [countdown,   setCountdown]   = useState(60);
  const intervalRef  = useRef(null);
  const cntRef       = useRef(null);

  /* ── Fetch ──────────────────────────────────────────────────────────────── */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await getRealtimeSales();
      setData(res);
      setLastUpdated(new Date());
      setCountdown(60);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Auto-refresh every 60 s ────────────────────────────────────────────── */
  useEffect(() => {
    load();
    intervalRef.current = setInterval(() => load(true), 60_000);
    cntRef.current      = setInterval(() => setCountdown(c => (c <= 1 ? 60 : c - 1)), 1_000);
    return () => { clearInterval(intervalRef.current); clearInterval(cntRef.current); };
  }, [load]);

  /* ── Derived ────────────────────────────────────────────────────────────── */
  const ts       = data?.todaySales;
  const netSales = ts?.netSales    ?? null;
  const txCount  = ts?.txCount     ?? null;
  const avgTx    = ts?.avgTx       ?? null;
  const taxTotal = ts?.taxTotal    ?? null;
  const cashT    = ts?.cashTotal   ?? 0;
  const cardT    = ts?.cardTotal   ?? 0;
  const ebtT     = ts?.ebtTender   ?? 0;
  const tenderSum = cashT + cardT + ebtT || 1; // avoid /0

  const kpis = [
    { label: 'Net Sales — Today',  value: fmt(netSales),  icon: <DollarSign size={20} />, color: 'var(--accent-primary)', bg: 'var(--brand-12)' },
    { label: 'Transactions',        value: fmtN(txCount),  icon: <ShoppingCart size={20} />, color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
    { label: 'Avg Transaction',     value: fmt(avgTx),     icon: <TrendingUp size={20} />, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    { label: 'Tax Collected',       value: fmt(taxTotal),  icon: <Activity size={20} />,   color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  ];

  // Lottery
  const lt = data?.lottery;

  /* ── Chart data ─────────────────────────────────────────────────────────── */
  // Hourly — only show 5 AM – 11 PM for readability
  const hourlyAll  = data?.hourly || [];
  const hourly     = hourlyAll.filter(h => h.hour >= 5 && h.hour <= 23);

  // 14-day trend
  const trend = (data?.trend || []).map(r => ({
    date:   new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    Sales:  r.netSales ?? 0,
    Txns:   r.txCount  ?? 0,
  }));

  // Top products
  const topProducts = data?.topProducts || [];

  // Recent transactions
  const recentTx = data?.recentTx || [];

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content rtd-page">

        {/* Header */}
        <div className="rtd-header">
          <div className="rtd-header-left">
            <span className="pulse-dot" />
            <div>
              <h1 className="rtd-title">Live Dashboard</h1>
              <p className="rtd-subtitle">{today}</p>
            </div>
          </div>
          <div className="rtd-header-right">
            {lastUpdated && (
              <span className="rtd-refresh-info">
                Updated {lastUpdated.toLocaleTimeString()} · {countdown}s
              </span>
            )}
            <button className="rtd-btn" onClick={() => load()} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'rtd-spin' : ''} />
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rtd-error">
            <AlertCircle size={15} /> {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !data && (
          <div className="rtd-loading">
            <div className="rtd-loading-spinner" />
            Loading live data…
          </div>
        )}

        {/* KPI Cards */}
        <div className="rtd-kpi-row">
          {kpis.map(k => (
            <div key={k.label} className="rtd-kpi-card">
              <div className="rtd-kpi-icon" style={{ background: k.bg, color: k.color }}>
                {k.icon}
              </div>
              <div>
                <div className="rtd-kpi-label">{k.label}</div>
                <div className="rtd-kpi-value" style={{ color: k.color }}>
                  {loading && !data ? '…' : k.value}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Payment breakdown + Today summary */}
        {ts && (
          <div className="rtd-row2">

            {/* Payment breakdown */}
            <div className="rtd-card">
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

            {/* Today summary numbers */}
            <div className="rtd-card">
              <div className="rtd-card-title">
                <Zap size={15} style={{ color: '#8b5cf6' }} />
                Today's Summary
              </div>
              <div className="rtd-summary-grid">
                {[
                  { label: 'Subtotal',      value: fmt((ts.netSales || 0) - (ts.taxTotal || 0) - (ts.depositTotal || 0)) },
                  { label: 'Tax',           value: fmt(ts.taxTotal) },
                  { label: 'Deposits',      value: fmt(ts.depositTotal) },
                  { label: 'EBT Sales',     value: fmt(ts.ebtTotal) },
                  { label: 'Net Sales',     value: fmt(ts.netSales), accent: true },
                  { label: 'Transactions',  value: fmtN(ts.txCount) },
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

        {/* Hourly chart */}
        <div className="rtd-card rtd-wide" style={{ marginBottom: '1.25rem' }}>
          <div className="rtd-card-title">
            <Clock size={15} style={{ color: 'var(--accent-primary)' }} />
            Hourly Sales — Today
          </div>
          {hourly.length === 0 ? (
            <div className="rtd-empty">No transactions yet today.</div>
          ) : (
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} interval={1} />
                  <YAxis tickFormatter={fmtSh} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={52} />
                  <Tooltip content={<BarTooltip />} />
                  <Bar dataKey="sales" name="Sales" fill="var(--accent-primary)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Lottery Today */}
        {lt && (
          <div className="rtd-card rtd-wide rtd-lottery-card" style={{ marginBottom: '1.25rem' }}>
            <div className="rtd-card-title">
              <Ticket size={15} style={{ color: '#f59e0b' }} />
              Lottery — Today
              {lt.activeBoxes > 0 && (
                <span className="rtd-lottery-active-badge">{lt.activeBoxes} active {lt.activeBoxes === 1 ? 'box' : 'boxes'}</span>
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
                  <div className="rtd-lottery-stat-sub">{fmtN(lt.txCount)} {lt.txCount === 1 ? 'sale' : 'sales'} · {fmtN(lt.tickets)} tickets</div>
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
                <div className="rtd-lottery-stat-icon" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}>
                  <DollarSign size={18} />
                </div>
                <div>
                  <div className="rtd-lottery-stat-label">Net Lottery</div>
                  <div className="rtd-lottery-stat-value" style={{ color: lt.net >= 0 ? '#6366f1' : '#ef4444' }}>{fmt(lt.net)}</div>
                  <div className="rtd-lottery-stat-sub">Sales − Payouts</div>
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
                  <div
                    className="rtd-lottery-bar-sales"
                    style={{ width: '100%' }}
                    title={`Sales: ${fmt(lt.sales)}`}
                  />
                  <div
                    className="rtd-lottery-bar-payouts"
                    style={{ width: `${Math.min(100, (lt.payouts / lt.sales) * 100).toFixed(1)}%` }}
                    title={`Payouts: ${fmt(lt.payouts)}`}
                  />
                </div>
                <div className="rtd-lottery-bar-legend">
                  <span style={{ color: '#10b981' }}>■ Sales {fmt(lt.sales)}</span>
                  <span style={{ color: '#ef4444' }}>■ Payouts {fmt(lt.payouts)}</span>
                  <span style={{ color: '#f59e0b' }}>■ Commission {fmt(lt.commission)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Live feed + Top products */}
        <div className="rtd-row2" style={{ marginBottom: '1.25rem' }}>

          {/* Live transaction feed */}
          <div className="rtd-card rtd-feed-card">
            <div className="rtd-card-title">
              <Activity size={15} style={{ color: '#10b981' }} />
              Recent Transactions
              <span className="rtd-live-dot" />
            </div>
            {recentTx.length === 0 ? (
              <div className="rtd-empty">No transactions yet.</div>
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
                        <div className="rtd-feed-time">{fmtT(tx.createdAt)}{tx.stationId ? ` · ${tx.stationId}` : ''}</div>
                      </div>
                      <div className="rtd-feed-amount">{fmt(tx.grandTotal)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top products */}
          <div className="rtd-card rtd-feed-card">
            <div className="rtd-card-title">
              <Package size={15} style={{ color: '#f59e0b' }} />
              Top Products — Today
            </div>
            {topProducts.length === 0 ? (
              <div className="rtd-empty">No product data yet.</div>
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

        {/* 14-Day Sales trend */}
        <div className="rtd-card rtd-wide" style={{ marginBottom: '1.25rem' }}>
          <div className="rtd-card-title">
            <Calendar size={15} style={{ color: 'var(--accent-primary)' }} />
            Last 14 Days — Net Sales
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
                  <Tooltip content={<BarTooltip />} />
                  <Area type="monotone" dataKey="Sales" stroke="var(--accent-primary)" strokeWidth={2}
                    fill="url(#rtdSalesGrad)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 14-Day Transactions */}
        {trend.length > 0 && (
          <div className="rtd-card rtd-wide">
            <div className="rtd-card-title">
              <ShoppingCart size={15} style={{ color: '#3b82f6' }} />
              Last 14 Days — Transactions
            </div>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} />
                  <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={36} />
                  <Tooltip content={<BarTooltip />} />
                  <Bar dataKey="Txns" name="Transactions" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
