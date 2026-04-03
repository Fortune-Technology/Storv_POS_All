import React, { useState, useEffect, useCallback } from 'react';
import {
  ComposedChart, Line, Area, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell,
  ScatterChart, Scatter, ZAxis,
} from 'recharts';
import {
  TrendingUp, Calendar, BarChart2, AlertCircle, RefreshCw,
  Target, Activity, Sigma, ArrowUpRight, ArrowDownRight, Minus,
  CheckCircle, Info,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import {
  getSalesPredictionsDaily,
  getSalesPredictionsWeekly,
  getSalesPredictionsResiduals,
} from '../services/api';
import './analytics.css';

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const fmt  = (n) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmt2 = (n) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct  = (n) => n == null ? '—' : `${Number(n).toFixed(1)}%`;
const fmtAxisK = (v) => (v == null || isNaN(v)) ? '' : `$${(v / 1000).toFixed(0)}k`;

const DAILY_HORIZONS  = [7, 14, 30];
const WEEKLY_HORIZONS = [4, 8, 12];
const TEST_WINDOWS    = [14, 30, 60];

/* ─── Tooltip ──────────────────────────────────────────────────────────────── */
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="analytics-tooltip">
      <div className="tooltip-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="tooltip-row" style={{ color: p.color }}>
          <span>{p.name}:</span>
          <span>
            {p.name === 'Residual' || p.name === 'Error %'
              ? p.name === 'Error %' ? pct(p.value) : fmt(p.value)
              : fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

/* ─── Accuracy grade ───────────────────────────────────────────────────────── */
function accuracyGrade(mape) {
  if (mape == null) return { label: 'N/A', color: 'var(--text-muted)', bg: 'rgba(100,116,139,0.15)' };
  if (mape < 5)  return { label: 'Excellent', color: '#10b981', bg: 'rgba(16,185,129,0.15)' };
  if (mape < 10) return { label: 'Good',      color: '#7ac143', bg: 'rgba(122,193,67,0.15)' };
  if (mape < 20) return { label: 'Fair',      color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' };
  return           { label: 'Poor',      color: '#ef4444', bg: 'rgba(239,68,68,0.15)' };
}

/* ─── Bias icon ────────────────────────────────────────────────────────────── */
function BiasIcon({ bias }) {
  if (bias == null) return <Minus size={16} />;
  if (bias > 50)  return <ArrowUpRight  size={16} style={{ color: '#3b82f6' }} />;
  if (bias < -50) return <ArrowDownRight size={16} style={{ color: '#f97316' }} />;
  return <Minus size={16} style={{ color: '#7ac143' }} />;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function SalesPredictions() {
  /* ── Forecast tab state ──────────────────────────────────────────────────── */
  const [tab,          setTab]          = useState('forecast'); // 'forecast' | 'accuracy'
  const [mode,         setMode]         = useState('daily');
  const [dailyDays,    setDailyDays]    = useState(14);
  const [weeklyWeeks,  setWeeklyWeeks]  = useState(8);
  const [forecastData, setForecastData] = useState(null);
  const [fLoading,     setFLoading]     = useState(false);
  const [fError,       setFError]       = useState(null);

  /* ── Accuracy tab state ──────────────────────────────────────────────────── */
  const [testDays,     setTestDays]     = useState(30);
  const [residData,    setResidData]    = useState(null);
  const [rLoading,     setRLoading]     = useState(false);
  const [rError,       setRError]       = useState(null);

  /* ── Fetch forecast ──────────────────────────────────────────────────────── */
  const fetchForecast = useCallback(async () => {
    setFLoading(true); setFError(null);
    try {
      const result = mode === 'daily'
        ? await getSalesPredictionsDaily({ days: dailyDays })
        : await getSalesPredictionsWeekly({ weeks: weeklyWeeks });
      setForecastData(result);
    } catch (e) { setFError(e.response?.data?.error || e.message); }
    finally { setFLoading(false); }
  }, [mode, dailyDays, weeklyWeeks]);

  /* ── Fetch residuals ─────────────────────────────────────────────────────── */
  const fetchResiduals = useCallback(async () => {
    setRLoading(true); setRError(null);
    try {
      const result = await getSalesPredictionsResiduals({ testDays });
      setResidData(result);
    } catch (e) { setRError(e.response?.data?.error || e.message); }
    finally { setRLoading(false); }
  }, [testDays]);

  useEffect(() => { fetchForecast(); }, [fetchForecast]);
  useEffect(() => { if (tab === 'accuracy') fetchResiduals(); }, [tab, fetchResiduals]);

  /* ────────────────────────────────────────────────────────────────────────── */
  /* FORECAST TAB DERIVED DATA                                                  */
  /* ────────────────────────────────────────────────────────────────────────── */
  const forecast   = forecastData?.forecast        || [];
  const historical = forecastData?.historicalSeries || [];
  const mape       = forecastData?.mape;
  const modelInfo  = forecastData?.modelInfo        || {};

  const histSlice = historical.slice(-30).map((r, i, arr) => {
    const offset = arr.length - 1 - i;
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return { date: d.toISOString().slice(0, 10), Actual: r.TotalNetSales || r, Predicted: null, Upper: null, Lower: null };
  });

  const forecastChart = forecast.map((f) => ({
    date: f.date, Actual: null,
    Predicted: f.predicted,
    Upper: Math.round(f.predicted * 1.15),
    Lower: Math.round(f.predicted * 0.85),
    isHoliday: f.isHoliday, holidayName: f.holidayName, dayOfWeek: f.dayOfWeek,
  }));

  const chartData  = [...histSlice, ...forecastChart];
  const splitDate  = forecastChart[0]?.date;
  const holidays   = forecast.filter((f) => f.isHoliday);
  const totalFcst  = forecast.reduce((s, f) => s + (f.predicted || 0), 0);
  const avgFcst    = forecast.length ? totalFcst / forecast.length : 0;
  const maxFcst    = forecast.reduce((m, f) => Math.max(m, f.predicted || 0), 0);
  const minFcst    = forecast.reduce((m, f) => Math.min(m, f.predicted || Infinity), Infinity);
  const mapeGrade  = accuracyGrade(mape);

  const fKpis = [
    { label: `Total Forecast (${mode === 'daily' ? dailyDays + 'd' : weeklyWeeks + 'w'})`, value: fmt(totalFcst),     iconBg: 'rgba(122,193,67,0.15)', iconColor: '#7ac143', icon: <TrendingUp size={22} /> },
    { label: 'Avg Per Period',  value: fmt(avgFcst),     iconBg: 'rgba(139,92,246,0.15)', iconColor: '#8b5cf6', icon: <BarChart2 size={22} /> },
    { label: 'Peak Period',     value: fmt(maxFcst),     iconBg: 'rgba(16,185,129,0.15)', iconColor: '#10b981', icon: <TrendingUp size={22} /> },
    { label: 'Slowest Period',  value: fmt(minFcst === Infinity ? null : minFcst), iconBg: 'rgba(248,192,29,0.15)', iconColor: '#f8c01d', icon: <BarChart2 size={22} /> },
    { label: 'MAPE',            value: mape != null ? `${mape}%` : 'N/A', iconBg: mapeGrade.bg, iconColor: mapeGrade.color, icon: <Target size={22} /> },
    { label: 'Upcoming Holidays', value: holidays.length, iconBg: holidays.length > 0 ? 'rgba(248,192,29,0.15)' : 'rgba(100,116,139,0.15)', iconColor: holidays.length > 0 ? '#f8c01d' : 'var(--text-muted)', icon: <Calendar size={22} /> },
  ];

  /* ────────────────────────────────────────────────────────────────────────── */
  /* ACCURACY TAB DERIVED DATA                                                  */
  /* ────────────────────────────────────────────────────────────────────────── */
  const residuals = residData?.residuals     || [];
  const stats     = residData?.stats         || {};
  const errDist   = residData?.errorDistribution || {};
  const rGrade    = accuracyGrade(stats.mape);

  // Predicted vs Actual chart
  const paChart = residuals.map((r) => ({
    date:      r.date.slice(5), // MM-DD
    Actual:    r.actual,
    Predicted: r.predicted,
  }));

  // Residual bar chart
  const residChart = residuals.map((r) => ({
    date:     r.date.slice(5),
    Residual: r.residual,
    'Error %': r.pctError,
  }));

  // Scatter: predicted (x) vs actual (y)
  const scatterData = residuals.map((r) => ({ x: r.predicted, y: r.actual, name: r.date }));
  const scatterMax  = Math.max(...residuals.map((r) => Math.max(r.actual, r.predicted)), 0);

  const rKpis = [
    {
      label: 'MAPE', sublabel: 'Mean Abs % Error',
      value: pct(stats.mape), grade: rGrade,
      icon: <Target size={20} />,
    },
    {
      label: 'MAE', sublabel: 'Mean Abs Error ($/day)',
      value: fmt2(stats.mae), grade: { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
      icon: <Activity size={20} />,
    },
    {
      label: 'RMSE', sublabel: 'Root Mean Sq Error',
      value: fmt2(stats.rmse), grade: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
      icon: <Sigma size={20} />,
    },
    {
      label: 'Bias', sublabel: stats.bias > 50 ? 'Under-forecasting' : stats.bias < -50 ? 'Over-forecasting' : 'Well calibrated',
      value: fmt2(stats.bias),
      grade: {
        color: Math.abs(stats.bias || 0) < 50 ? '#10b981' : '#f59e0b',
        bg:    Math.abs(stats.bias || 0) < 50 ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
      },
      icon: <BiasIcon bias={stats.bias} />,
    },
  ];

  /* ── Render ──────────────────────────────────────────────────────────────── */
  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="analytics-header">
          <div>
            <h1 className="analytics-title">Sales Predictions</h1>
            <p className="analytics-subtitle">Holt-Winters forecasting · residual analysis · walk-forward validation</p>
          </div>

          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            <button
              className={`analytics-tab${tab === 'forecast' ? ' active' : ''}`}
              onClick={() => setTab('forecast')}
              style={{ marginBottom: 0 }}
            >
              <TrendingUp size={14} /> Forecast
            </button>
            <button
              className={`analytics-tab${tab === 'accuracy' ? ' active' : ''}`}
              onClick={() => setTab('accuracy')}
              style={{ marginBottom: 0 }}
            >
              <Target size={14} /> Model Accuracy
            </button>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* FORECAST TAB                                                        */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {tab === 'forecast' && (
          <>
            {/* Controls */}
            <div className="analytics-controls" style={{ marginBottom: '1.5rem' }}>
              <label>Mode</label>
              <div style={{ display: 'flex', gap: '0.375rem' }}>
                {['daily', 'weekly'].map((m) => (
                  <button key={m} className={`analytics-tab${mode === m ? ' active' : ''}`}
                    style={{ marginBottom: 0, textTransform: 'capitalize' }}
                    onClick={() => setMode(m)}>{m}</button>
                ))}
              </div>
              <label>Horizon</label>
              {mode === 'daily' ? (
                <select value={dailyDays} onChange={(e) => setDailyDays(Number(e.target.value))}
                  style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                  {DAILY_HORIZONS.map((d) => <option key={d} value={d}>{d} days</option>)}
                </select>
              ) : (
                <select value={weeklyWeeks} onChange={(e) => setWeeklyWeeks(Number(e.target.value))}
                  style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                  {WEEKLY_HORIZONS.map((w) => <option key={w} value={w}>{w} weeks</option>)}
                </select>
              )}
              <button className="btn btn-secondary" onClick={fetchForecast} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <RefreshCw size={15} /> Refresh
              </button>
            </div>

            {fError && (
              <div className="analytics-error">
                <AlertCircle size={18} /><span>{fError}</span>
                <button className="btn btn-secondary" style={{ marginLeft: 'auto', fontSize: '0.8rem', padding: '0.35rem 0.9rem' }} onClick={fetchForecast}>Retry</button>
              </div>
            )}

            {/* KPIs */}
            <div className="analytics-stats-row">
              {fKpis.map(({ label, value, icon, iconBg, iconColor }) => (
                <div key={label} className="analytics-stat-card">
                  <div className="analytics-stat-icon" style={{ background: iconBg, color: iconColor }}>{icon}</div>
                  <div>
                    <span className="analytics-stat-value">{value}</span>
                    <span className="analytics-stat-label">{label}</span>
                  </div>
                </div>
              ))}
            </div>

            {fLoading && <div className="analytics-loading"><div className="analytics-loading-spinner" /><p>Generating forecast…</p></div>}

            {!fLoading && holidays.length > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Upcoming holidays:</span>
                {holidays.map((h) => (
                  <span key={h.date} className="badge badge-warning">{h.holidayName} ({h.date})</span>
                ))}
              </div>
            )}

            {!fLoading && !fError && chartData.length > 0 && (
              <>
                {/* Forecast Chart */}
                <div className="analytics-chart-card">
                  <div className="analytics-chart-title">
                    <TrendingUp size={18} style={{ color: 'var(--accent-primary)' }} />
                    Forecast vs Actuals
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.75rem' }}>
                      Solid = actuals · Dashed = forecast · Shaded = ±15% confidence
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                      <defs>
                        <linearGradient id="confGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#7ac143" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#7ac143" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                      <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={fmtAxisK} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }} />
                      {splitDate && (
                        <ReferenceLine x={splitDate} stroke="var(--border-color)" strokeDasharray="6 3"
                          label={{ value: 'Forecast Start', fill: 'var(--text-muted)', fontSize: 11 }} />
                      )}
                      <Area type="monotone" dataKey="Upper" fill="url(#confGrad)" stroke="none" legendType="none" />
                      <Area type="monotone" dataKey="Lower" fill="var(--bg-primary)" stroke="none" legendType="none" />
                      <Line type="monotone" dataKey="Actual" stroke="#7ac143" strokeWidth={2} dot={false} name="Actual Net Sales" connectNulls={false} />
                      <Line type="monotone" dataKey="Predicted" stroke="#f8c01d" strokeWidth={2} strokeDasharray="6 3"
                        dot={(props) => props.payload?.isHoliday
                          ? <circle key={props.key} cx={props.cx} cy={props.cy} r={5} fill="#e30613" stroke="var(--bg-secondary)" strokeWidth={2} />
                          : null}
                        name="Predicted Sales" connectNulls={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Forecast Table */}
                <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                  <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>Forecast Detail</p>
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th><th>Day</th><th>Predicted</th>
                          <th>Low (−15%)</th><th>High (+15%)</th><th>Context</th>
                        </tr>
                      </thead>
                      <tbody>
                        {forecast.map((f, i) => {
                          const isWeekend = f.dayOfWeek === 'Saturday' || f.dayOfWeek === 'Sunday';
                          return (
                            <tr key={i} style={{ background: f.isHoliday ? 'rgba(248,192,29,0.05)' : isWeekend ? 'rgba(139,92,246,0.05)' : 'transparent' }}>
                              <td>{f.date}</td>
                              <td style={{ color: isWeekend ? '#8b5cf6' : 'var(--text-primary)' }}>{f.dayOfWeek}</td>
                              <td style={{ color: '#f8c01d', fontWeight: 600 }}>{fmt(f.predicted)}</td>
                              <td style={{ color: 'var(--text-muted)' }}>{fmt(Math.round(f.predicted * 0.85))}</td>
                              <td style={{ color: 'var(--text-muted)' }}>{fmt(Math.round(f.predicted * 1.15))}</td>
                              <td>
                                {f.isHoliday && <span className="badge badge-danger">{f.holidayName}</span>}
                                {isWeekend && !f.isHoliday && <span className="badge" style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}>Weekend</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Model Info */}
                <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                  <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>About This Model</p>
                  <div className="model-info-card">
                    <strong style={{ color: 'var(--text-primary)' }}>Holt-Winters Triple Exponential Smoothing</strong>
                    <ul style={{ marginTop: '0.5rem' }}>
                      <li><strong style={{ color: 'var(--accent-primary)' }}>Level (α={modelInfo.alpha})</strong> — baseline value, smoothed over time</li>
                      <li><strong style={{ color: 'var(--success)' }}>Trend (β={modelInfo.beta})</strong> — direction and rate of change</li>
                      <li><strong style={{ color: 'var(--warning)' }}>Seasonality (γ={modelInfo.gamma})</strong> — repeating patterns with period {modelInfo.period} ({mode === 'daily' ? 'weekly cycle' : 'quarterly cycle'})</li>
                    </ul>
                    <p style={{ marginTop: '0.5rem' }}>
                      <strong style={{ color: 'var(--text-primary)' }}>Day-of-Week Factors:</strong>{' '}
                      Sun ×1.15, Mon ×0.90, Tue ×0.88, Wed ×0.92, Thu ×1.00, Fri ×1.20, Sat ×1.30
                    </p>
                    {mape != null && (
                      <p style={{ marginTop: '0.5rem' }}>
                        <strong style={{ color: 'var(--text-primary)' }}>MAPE:</strong> {mape}%
                        {mape < 10 && ' — Excellent accuracy.'}
                        {mape >= 10 && mape < 20 && ' — Good accuracy.'}
                        {mape >= 20 && ' — Consider extending the training window for better accuracy.'}
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* ACCURACY TAB                                                        */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {tab === 'accuracy' && (
          <>
            {/* Controls */}
            <div className="analytics-controls" style={{ marginBottom: '1.5rem' }}>
              <label>Test Window</label>
              <div style={{ display: 'flex', gap: '0.375rem' }}>
                {TEST_WINDOWS.map((d) => (
                  <button key={d} className={`analytics-tab${testDays === d ? ' active' : ''}`}
                    style={{ marginBottom: 0 }}
                    onClick={() => setTestDays(d)}>{d} days</button>
                ))}
              </div>
              <button className="btn btn-secondary" onClick={fetchResiduals} disabled={rLoading}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <RefreshCw size={15} style={{ animation: rLoading ? 'spin 1s linear infinite' : 'none' }} />
                Recalculate
              </button>
              {stats.trainSize && (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                  <Info size={12} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />
                  Trained on {stats.trainSize} days · tested on {stats.testSize} days
                </span>
              )}
            </div>

            {rError && (
              <div className="analytics-error">
                <AlertCircle size={18} /><span>{rError}</span>
                <button className="btn btn-secondary" style={{ marginLeft: 'auto', fontSize: '0.8rem', padding: '0.35rem 0.9rem' }} onClick={fetchResiduals}>Retry</button>
              </div>
            )}

            {rLoading && <div className="analytics-loading"><div className="analytics-loading-spinner" /><p>Running walk-forward validation…</p></div>}

            {!rLoading && !rError && residData && (
              <>
                {/* Accuracy grade banner */}
                <div style={{
                  background: rGrade.bg,
                  border: `1px solid ${rGrade.color}40`,
                  borderRadius: 'var(--radius-lg)',
                  padding: '0.875rem 1.25rem',
                  marginBottom: '1.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                }}>
                  <CheckCircle size={18} style={{ color: rGrade.color, flexShrink: 0 }} />
                  <div>
                    <span style={{ fontWeight: 700, color: rGrade.color, fontSize: '0.95rem' }}>
                      Model Accuracy: {rGrade.label}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginLeft: '0.75rem' }}>
                      MAPE = {pct(stats.mape)} · tested against last {stats.testSize} days of actuals
                    </span>
                  </div>
                </div>

                {/* Stat cards */}
                <div className="analytics-stats-row" style={{ marginBottom: '1.75rem' }}>
                  {rKpis.map(({ label, sublabel, value, grade, icon }) => (
                    <div key={label} className="analytics-stat-card">
                      <div className="analytics-stat-icon" style={{ background: grade.bg, color: grade.color }}>{icon}</div>
                      <div>
                        <span className="analytics-stat-value" style={{ color: grade.color }}>{value}</span>
                        <span className="analytics-stat-label">{label}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>{sublabel}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Error Distribution */}
                <div className="analytics-chart-card" style={{ marginBottom: '1.75rem' }}>
                  <div className="analytics-chart-title" style={{ marginBottom: '1rem' }}>
                    <CheckCircle size={16} style={{ color: '#10b981' }} />
                    Prediction Accuracy Distribution
                    <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                      % of days within each error threshold
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                    {[
                      { label: 'Within ±5%',  pct: errDist.within5,  color: '#10b981' },
                      { label: 'Within ±10%', pct: errDist.within10, color: '#7ac143' },
                      { label: 'Within ±15%', pct: errDist.within15, color: '#f59e0b' },
                      { label: 'Within ±20%', pct: errDist.within20, color: '#f97316' },
                    ].map((band) => (
                      <div key={band.label} style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        padding: '1rem',
                        textAlign: 'center',
                      }}>
                        {/* Progress bar */}
                        <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, marginBottom: '0.75rem', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${band.pct ?? 0}%`, background: band.color, borderRadius: 3, transition: 'width 0.6s ease' }} />
                        </div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: band.color }}>{band.pct ?? 0}%</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{band.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Predicted vs Actual Chart */}
                <div className="analytics-chart-card" style={{ marginBottom: '1.75rem' }}>
                  <div className="analytics-chart-title" style={{ marginBottom: '1.25rem' }}>
                    <TrendingUp size={16} style={{ color: '#7ac143' }} />
                    Predicted vs Actual Sales
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.75rem' }}>
                      Green = actual · Yellow dashed = model prediction
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={paChart} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                      <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={fmtAxisK} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }} />
                      <Line type="monotone" dataKey="Actual"    stroke="#7ac143" strokeWidth={2} dot={{ r: 3 }} name="Actual" />
                      <Line type="monotone" dataKey="Predicted" stroke="#f8c01d" strokeWidth={2} strokeDasharray="5 3" dot={false} name="Predicted" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Residual Bar Chart */}
                <div className="analytics-chart-card" style={{ marginBottom: '1.75rem' }}>
                  <div className="analytics-chart-title" style={{ marginBottom: '1.25rem' }}>
                    <Activity size={16} style={{ color: '#3b82f6' }} />
                    Daily Residuals (Actual − Predicted)
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.75rem' }}>
                      Green bar = under-forecast (actual was higher) · Red = over-forecast
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={residChart} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                      <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={fmtAxisK} />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine y={0} stroke="var(--border-color)" strokeWidth={1.5} />
                      <Bar dataKey="Residual" name="Residual" radius={[3, 3, 0, 0]}>
                        {residChart.map((entry, i) => (
                          <Cell key={i} fill={entry.Residual >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Per-Day Residual Table */}
                <div className="analytics-chart-card">
                  <div className="analytics-chart-title" style={{ marginBottom: '1rem' }}>
                    <BarChart2 size={16} style={{ color: '#8b5cf6' }} />
                    Per-Day Residual Detail
                  </div>
                  <div className="analytics-table-wrap">
                    <table className="analytics-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Day</th>
                          <th style={{ textAlign: 'right' }}>Actual</th>
                          <th style={{ textAlign: 'right' }}>Predicted</th>
                          <th style={{ textAlign: 'right' }}>Residual</th>
                          <th style={{ textAlign: 'right' }}>Error %</th>
                          <th>Direction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {residuals.map((r, i) => (
                          <tr key={i}>
                            <td>{r.date}</td>
                            <td style={{ color: 'var(--text-secondary)' }}>{r.dayOfWeek}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600, color: '#7ac143' }}>{fmt(r.actual)}</td>
                            <td style={{ textAlign: 'right', color: '#f8c01d' }}>{fmt(r.predicted)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600, color: r.residual >= 0 ? '#10b981' : '#ef4444' }}>
                              {r.residual >= 0 ? '+' : ''}{fmt(r.residual)}
                            </td>
                            <td style={{ textAlign: 'right', color: r.pctError <= 10 ? '#10b981' : r.pctError <= 20 ? '#f59e0b' : '#ef4444' }}>
                              {pct(r.pctError)}
                            </td>
                            <td>
                              {r.residual >= 0
                                ? <span style={{ fontSize: '0.75rem', color: '#10b981' }}>↑ Under-forecast</span>
                                : <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>↓ Over-forecast</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </>
        )}

      </main>
    </div>
  );
}
