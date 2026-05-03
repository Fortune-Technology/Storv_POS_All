import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import {
  TrendingUp, Calendar, Clock, BarChart2, Download, FileText,
  AlertCircle, RefreshCw, Target, Sun, CloudRain, Snowflake,
  Thermometer, Flame, Gift, Loader,
} from 'lucide-react';
import {
  getSalesPredictionsDaily,
  getSalesPredictionsWeekly,
  getSalesPredictionsHourly,
  getSalesPredictionsMonthly,
  getSalesPredictionsFactors,
  getSalesPredictionsResiduals,
} from '../services/api';
import '../styles/portal.css';
import './SalesPredictions.css';

/* ================================================================
   Helpers
   ================================================================ */
const fmt  = (n) => n == null ? '\u2014' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmt2 = (n) => n == null ? '\u2014' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct  = (n) => n == null ? '\u2014' : `${Number(n).toFixed(1)}%`;
const fmtAxisK = (v) => (v == null || isNaN(v)) ? '' : v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;

const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const tomorrowISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toISO(d);
};

function accuracyGrade(mape) {
  if (mape == null) return { label: 'N/A', color: 'var(--text-muted)', bg: 'rgba(100,116,139,0.15)' };
  if (mape < 5)  return { label: 'Excellent', color: '#10b981', bg: 'rgba(16,185,129,0.15)' };
  if (mape < 10) return { label: 'Good',      color: 'var(--accent-primary)', bg: 'var(--brand-15)' };
  if (mape < 20) return { label: 'Fair',      color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' };
  return           { label: 'Poor',      color: '#ef4444', bg: 'rgba(239,68,68,0.15)' };
}

/* ================================================================
   Chart Tooltip
   ================================================================ */
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)',
      padding: '0.75rem 1rem',
      boxShadow: 'var(--shadow-md)',
      maxWidth: 300,
    }}>
      <p style={{ fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-primary)', fontSize: '0.85rem' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontSize: '0.8rem', margin: '0.15rem 0' }}>
          {p.name}: {typeof p.value === 'number' ? fmt(p.value) : p.value}
        </p>
      ))}
    </div>
  );
};

/* ================================================================
   Factor Badge Component (Daily tab)
   ================================================================ */
const FactorBadges = ({ row }) => {
  const badges = [];
  const factors = row.factors || {};

  if (row.isHoliday) {
    badges.push(
      <span key="holiday" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: '0.66rem', fontWeight: 700, background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
        <Gift size={11} /> {row.holidayName || 'Holiday'}
      </span>
    );
  }

  const dow = (row.dayOfWeek || '').toLowerCase();
  if (dow === 'saturday' || dow === 'sunday') {
    badges.push(
      <span key="weekend" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: '0.66rem', fontWeight: 700, background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
        <Calendar size={11} /> Weekend
      </span>
    );
  }

  if (factors.rain) {
    badges.push(
      <span key="rain" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: '0.66rem', fontWeight: 700, background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}>
        <CloudRain size={11} /> Rain
      </span>
    );
  }

  if (factors.snow) {
    badges.push(
      <span key="snow" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: '0.66rem', fontWeight: 700, background: 'rgba(147,197,253,0.2)', color: '#60a5fa' }}>
        <Snowflake size={11} /> Snow
      </span>
    );
  }

  if (factors.cold) {
    badges.push(
      <span key="cold" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: '0.66rem', fontWeight: 700, background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }}>
        <Thermometer size={11} /> Cold
      </span>
    );
  }

  if (factors.heat) {
    badges.push(
      <span key="heat" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: '0.66rem', fontWeight: 700, background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
        <Flame size={11} /> Heat
      </span>
    );
  }

  if (badges.length === 0) {
    badges.push(
      <span key="none" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>\u2014</span>
    );
  }

  return <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{badges}</div>;
};

/* ================================================================
   Daily Tooltip (with factors)
   ================================================================ */
const DailyChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)',
      padding: '0.75rem 1rem',
      boxShadow: 'var(--shadow-md)',
      maxWidth: 320,
    }}>
      <p style={{ fontWeight: 600, marginBottom: '0.3rem', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
        {label} {data?.dayOfWeek ? `(${data.dayOfWeek})` : ''}
      </p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontSize: '0.8rem', margin: '0.1rem 0' }}>
          {p.name}: {fmt(p.value)}
        </p>
      ))}
      {data?.factors?.weather && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
          Weather: {data.factors.weather}
        </p>
      )}
      {data?.isHoliday && (
        <p style={{ fontSize: '0.75rem', color: '#f59e0b', marginTop: '0.15rem' }}>
          Holiday: {data.holidayName}
        </p>
      )}
    </div>
  );
};

/* ================================================================
   CSV Export Helper
   ================================================================ */
function downloadCSV(rows, columns, filename) {
  if (!rows?.length) return;
  const header = columns.map(c => c.label).join(',');
  const body = rows.map(row => columns.map(c => {
    const val = typeof c.accessor === 'function' ? c.accessor(row) : row[c.accessor];
    const str = String(val ?? '');
    return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
  }).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ================================================================
   PDF Export Helper (simple printable page)
   ================================================================ */
function downloadPDF(title, rows, columns) {
  if (!rows?.length) return;
  const header = columns.map(c => `<th style="padding:6px 10px;border-bottom:2px solid #333;text-align:left;font-size:12px">${c.label}</th>`).join('');
  const body = rows.map(row => {
    const cells = columns.map(c => {
      const val = typeof c.accessor === 'function' ? c.accessor(row) : row[c.accessor];
      return `<td style="padding:5px 10px;border-bottom:1px solid #ddd;font-size:11px">${val ?? ''}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:Arial,sans-serif;margin:24px}h1{font-size:18px}table{border-collapse:collapse;width:100%}</style></head><body><h1>${title}</h1><p style="color:#666;font-size:12px">Exported ${new Date().toLocaleString()}</p><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></body></html>`;
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.print(); }, 400);
  }
}

/* ================================================================
   Loading Spinner
   ================================================================ */
const LoadingSpinner = ({ text = 'Loading...' }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem', gap: '0.75rem' }}>
    <Loader size={28} style={{ color: 'var(--accent-primary)', animation: 'spin 1s linear infinite' }} />
    <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{text}</p>
  </div>
);

/* ================================================================
   Empty State
   ================================================================ */
const EmptyState = ({ text = 'No data available.' }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem', gap: '0.5rem' }}>
    <BarChart2 size={32} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
    <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{text}</p>
  </div>
);

/* ================================================================
   Error Banner
   ================================================================ */
const ErrorBanner = ({ message, onRetry }) => (
  <div className="p-card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }}>
    <AlertCircle size={18} style={{ color: '#ef4444', flexShrink: 0 }} />
    <span style={{ flex: 1, fontSize: '0.85rem', color: '#ef4444' }}>{message}</span>
    {onRetry && (
      <button className="p-btn p-btn-ghost p-btn-sm" onClick={onRetry}>Retry</button>
    )}
  </div>
);

/* ================================================================
   Toast Helper
   ================================================================ */
function showToast(msg, type = 'error') {
  const div = document.createElement('div');
  div.textContent = msg;
  Object.assign(div.style, {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
    padding: '0.75rem 1.25rem', borderRadius: '8px',
    background: type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6',
    color: '#fff', fontSize: '0.85rem', fontWeight: 600,
    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
    transition: 'opacity 0.3s',
  });
  document.body.appendChild(div);
  setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 300); }, 3500);
}

/* ================================================================
   CHART COLORS
   ================================================================ */
const BRAND  = 'var(--accent-primary)';
const GOLD   = '#f8c01d';
const GREEN  = '#10b981';
const PURPLE = '#8b5cf6';
const BLUE   = '#3b82f6';

/* ================================================================
   MAIN COMPONENT
   ================================================================ */
export default function SalesPredictions({ embedded }) {
  const [activeTab, setActiveTab] = useState('hourly');

  /* ── Hourly State ─────────────────────────────────────────── */
  const [hourlyDate, setHourlyDate]   = useState(tomorrowISO());
  const [hourlyData, setHourlyData]   = useState(null);
  const [hourlyLoading, setHourlyLoading] = useState(false);
  const [hourlyError, setHourlyError] = useState(null);

  /* ── Daily State ──────────────────────────────────────────── */
  const [dailyData, setDailyData]       = useState(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError]     = useState(null);
  const [dailyMAPE, setDailyMAPE]       = useState(null);

  /* ── Weekly State ─────────────────────────────────────────── */
  const [weeklyData, setWeeklyData]       = useState(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyError, setWeeklyError]     = useState(null);

  /* ── Monthly State ────────────────────────────────────────── */
  const [monthlyData, setMonthlyData]       = useState(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyError, setMonthlyError]     = useState(null);

  /* keep track of which tabs we already fetched */
  const fetched = useRef({ hourly: false, daily: false, weekly: false, monthly: false });

  /* ── Fetch: Hourly ────────────────────────────────────────── */
  const fetchHourly = useCallback(async (dateOverride) => {
    const date = dateOverride || hourlyDate;
    setHourlyLoading(true);
    setHourlyError(null);
    try {
      const res = await getSalesPredictionsHourly({ date });
      setHourlyData(res);
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      setHourlyError(msg);
      showToast(msg);
    } finally {
      setHourlyLoading(false);
    }
  }, [hourlyDate]);

  /* ── Fetch: Daily (factors + residuals for MAPE) ──────────── */
  const fetchDaily = useCallback(async () => {
    setDailyLoading(true);
    setDailyError(null);
    try {
      const [factorsRes, residualsRes] = await Promise.all([
        getSalesPredictionsFactors({ days: 30 }),
        getSalesPredictionsResiduals({ testDays: 30 }).catch(() => null),
      ]);
      setDailyData(factorsRes);
      if (residualsRes?.stats?.mape != null) {
        setDailyMAPE(residualsRes.stats.mape);
      }
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      setDailyError(msg);
      showToast(msg);
    } finally {
      setDailyLoading(false);
    }
  }, []);

  /* ── Fetch: Weekly ────────────────────────────────────────── */
  const fetchWeekly = useCallback(async () => {
    setWeeklyLoading(true);
    setWeeklyError(null);
    try {
      const res = await getSalesPredictionsWeekly({ weeks: 12 });
      setWeeklyData(res);
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      setWeeklyError(msg);
      showToast(msg);
    } finally {
      setWeeklyLoading(false);
    }
  }, []);

  /* ── Fetch: Monthly ───────────────────────────────────────── */
  const fetchMonthly = useCallback(async () => {
    setMonthlyLoading(true);
    setMonthlyError(null);
    try {
      const res = await getSalesPredictionsMonthly({ months: 6 });
      setMonthlyData(res);
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      setMonthlyError(msg);
      showToast(msg);
    } finally {
      setMonthlyLoading(false);
    }
  }, []);

  /* ── Auto-fetch on tab switch (once) ──────────────────────── */
  useEffect(() => {
    if (activeTab === 'hourly' && !fetched.current.hourly) {
      fetched.current.hourly = true;
      fetchHourly();
    }
    if (activeTab === 'daily' && !fetched.current.daily) {
      fetched.current.daily = true;
      fetchDaily();
    }
    if (activeTab === 'weekly' && !fetched.current.weekly) {
      fetched.current.weekly = true;
      fetchWeekly();
    }
    if (activeTab === 'monthly' && !fetched.current.monthly) {
      fetched.current.monthly = true;
      fetchMonthly();
    }
  }, [activeTab, fetchHourly, fetchDaily, fetchWeekly, fetchMonthly]);

  /* ── Tab definitions ──────────────────────────────────────── */
  const TABS = [
    { key: 'hourly',  label: 'Hourly',  icon: <Clock size={14} /> },
    { key: 'daily',   label: 'Daily',   icon: <Calendar size={14} /> },
    { key: 'weekly',  label: 'Weekly',  icon: <BarChart2 size={14} /> },
    { key: 'monthly', label: 'Monthly', icon: <TrendingUp size={14} /> },
  ];

  /* ==============================================================
     HOURLY TAB
     ============================================================== */
  const renderHourly = () => {
    const hourly = hourlyData?.hourly || [];
    const dailyPrediction = hourlyData?.dailyPrediction;
    const dayOfWeek = hourlyData?.dayOfWeek;

    const chartData = hourly.map(h => ({
      name: h.label || `${h.hour}:00`,
      Predicted: Math.round(h.predicted || 0),
      pct: h.pct,
    }));

    const hourlyCSVCols = [
      { label: 'Hour', accessor: r => r.label || `${r.hour}:00` },
      { label: 'Predicted Sales', accessor: 'predicted' },
      { label: '% of Day', accessor: 'pct' },
    ];

    const hourlyTableCols = [
      { label: 'Hour', accessor: r => r.label || `${r.hour}:00` },
      { label: 'Predicted Sales', accessor: r => fmt(r.predicted) },
      { label: '% of Day', accessor: r => pct(r.pct) },
    ];

    return (
      <>
        {/* Date picker row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Select Date:</label>
          <input
            type="date"
            value={hourlyDate}
            onChange={(e) => setHourlyDate(e.target.value)}
            style={{
              padding: '0.45rem 0.75rem',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
            }}
          />
          <button className="p-btn p-btn-secondary p-btn-sm" onClick={() => { fetched.current.hourly = true; fetchHourly(hourlyDate); }}>
            <RefreshCw size={14} /> Forecast
          </button>
        </div>

        {hourlyError && <ErrorBanner message={hourlyError} onRetry={() => fetchHourly(hourlyDate)} />}

        {hourlyLoading && <LoadingSpinner text="Generating hourly forecast..." />}

        {!hourlyLoading && !hourlyError && hourlyData && (
          <>
            {/* KPI: Daily total */}
            <div className="p-stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <div className="p-stat-card">
                <div className="p-stat-label">TOTAL DAILY PREDICTION</div>
                <div className="p-stat-value" style={{ color: BRAND }}>{fmt(dailyPrediction)}</div>
                <div className="p-stat-sub">{hourlyData?.date} {dayOfWeek ? `(${dayOfWeek})` : ''}</div>
              </div>
              <div className="p-stat-card">
                <div className="p-stat-label">PEAK HOUR</div>
                <div className="p-stat-value" style={{ color: GOLD }}>
                  {hourly.length ? (hourly.reduce((a, b) => (b.predicted || 0) > (a.predicted || 0) ? b : a).label || '') : '\u2014'}
                </div>
                <div className="p-stat-sub">
                  {hourly.length ? fmt(Math.max(...hourly.map(h => h.predicted || 0))) : '\u2014'}
                </div>
              </div>
              <div className="p-stat-card">
                <div className="p-stat-label">ACTIVE HOURS</div>
                <div className="p-stat-value" style={{ color: GREEN }}>
                  {hourly.filter(h => (h.predicted || 0) > 0).length}
                </div>
                <div className="p-stat-sub">hours with predicted sales</div>
              </div>
            </div>

            {/* Chart */}
            {chartData.length > 0 ? (
              <div className="p-card" style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <Clock size={16} style={{ color: BRAND }} />
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Hourly Sales Forecast</span>
                </div>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval={0} angle={-45} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={fmtAxisK} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="Predicted" name="Predicted Sales" radius={[4, 4, 0, 0]} fill={BRAND}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.Predicted === Math.max(...chartData.map(d => d.Predicted)) ? GOLD : BRAND} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState text="No hourly data for the selected date." />
            )}

            {/* Table */}
            {hourly.length > 0 && (
              <div className="p-card" style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Hourly Breakdown</span>
                  <ExportButtons
                    rows={hourly}
                    csvColumns={hourlyCSVCols}
                    pdfColumns={hourlyTableCols}
                    csvFilename={`hourly-forecast-${hourlyDate}.csv`}
                    pdfTitle={`Hourly Forecast - ${hourlyDate}`}
                  />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                        <th style={thStyle}>Hour</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Predicted</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>% of Day</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hourly.map((h, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={tdStyle}>{h.label || `${h.hour}:00`}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: BRAND }}>{fmt(h.predicted)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-muted)' }}>{pct(h.pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {!hourlyLoading && !hourlyError && !hourlyData && (
          <EmptyState text="Select a date and click Forecast to generate hourly predictions." />
        )}
      </>
    );
  };

  /* ==============================================================
     DAILY TAB
     ============================================================== */
  const renderDaily = () => {
    const forecast = dailyData?.forecast || [];
    const mapeGrade = accuracyGrade(dailyMAPE);

    const chartData = forecast.map(f => ({
      date: f.date,
      Sales: f.weatherAdjusted || f.predicted,
      dayOfWeek: f.dayOfWeek,
      isHoliday: f.isHoliday,
      holidayName: f.holidayName,
      factors: f.factors || {},
    }));

    const totalFcst = forecast.reduce((s, f) => s + (f.weatherAdjusted || f.predicted || 0), 0);
    const avgFcst   = forecast.length ? totalFcst / forecast.length : 0;
    const maxDay    = forecast.length ? forecast.reduce((a, b) => (b.weatherAdjusted || b.predicted || 0) > (a.weatherAdjusted || a.predicted || 0) ? b : a) : null;

    const dailyCSVCols = [
      { label: 'Date', accessor: 'date' },
      { label: 'Day', accessor: 'dayOfWeek' },
      { label: 'Predicted', accessor: r => r.weatherAdjusted || r.predicted },
      { label: 'Holiday', accessor: r => r.isHoliday ? r.holidayName : '' },
      { label: 'Rain', accessor: r => r.factors?.rain ? 'Yes' : '' },
      { label: 'Snow', accessor: r => r.factors?.snow ? 'Yes' : '' },
    ];

    const dailyTableCols = [
      { label: 'Date', accessor: 'date' },
      { label: 'Day', accessor: 'dayOfWeek' },
      { label: 'Predicted', accessor: r => fmt(r.weatherAdjusted || r.predicted) },
      { label: 'Holiday', accessor: r => r.isHoliday ? r.holidayName : '' },
    ];

    return (
      <>
        {dailyError && <ErrorBanner message={dailyError} onRetry={fetchDaily} />}
        {dailyLoading && <LoadingSpinner text="Loading 30-day forecast with factors..." />}

        {!dailyLoading && !dailyError && dailyData && (
          <>
            {/* KPIs */}
            <div className="p-stat-grid">
              <div className="p-stat-card">
                <div className="p-stat-label">30-DAY TOTAL</div>
                <div className="p-stat-value" style={{ color: BRAND }}>{fmt(totalFcst)}</div>
              </div>
              <div className="p-stat-card">
                <div className="p-stat-label">DAILY AVERAGE</div>
                <div className="p-stat-value" style={{ color: PURPLE }}>{fmt(avgFcst)}</div>
              </div>
              <div className="p-stat-card">
                <div className="p-stat-label">PEAK DAY</div>
                <div className="p-stat-value" style={{ color: GOLD }}>{maxDay ? fmt(maxDay.weatherAdjusted || maxDay.predicted) : '\u2014'}</div>
                <div className="p-stat-sub">{maxDay?.date} {maxDay?.dayOfWeek ? `(${maxDay.dayOfWeek})` : ''}</div>
              </div>
              {dailyMAPE != null && (
                <div className="p-stat-card">
                  <div className="p-stat-label">MODEL ACCURACY (MAPE)</div>
                  <div className="p-stat-value" style={{ color: mapeGrade.color }}>{pct(dailyMAPE)}</div>
                  <div className="p-stat-sub" style={{ color: mapeGrade.color }}>{mapeGrade.label}</div>
                </div>
              )}
            </div>

            {/* Area Chart */}
            {chartData.length > 0 ? (
              <div className="p-card" style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <TrendingUp size={16} style={{ color: BRAND }} />
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>30-Day Forecast with Weather Factors</span>
                </div>
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <defs>
                      <linearGradient id="dailyGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={BRAND} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={BRAND} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={fmtAxisK} />
                    <Tooltip content={<DailyChartTooltip />} />
                    <Area type="monotone" dataKey="Sales" stroke={BRAND} strokeWidth={2} fill="url(#dailyGrad)" name="Predicted Sales"
                      dot={(props) => {
                        const d = props.payload;
                        if (d?.isHoliday) return <circle key={props.key} cx={props.cx} cy={props.cy} r={5} fill="#f59e0b" stroke="#fff" strokeWidth={2} />;
                        if (d?.factors?.rain || d?.factors?.snow) return <circle key={props.key} cx={props.cx} cy={props.cy} r={4} fill={BLUE} stroke="#fff" strokeWidth={1.5} />;
                        return null;
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState text="No daily forecast data available." />
            )}

            {/* Table */}
            {forecast.length > 0 && (
              <div className="p-card" style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Daily Forecast Detail</span>
                  <ExportButtons
                    rows={forecast}
                    csvColumns={dailyCSVCols}
                    pdfColumns={dailyTableCols}
                    csvFilename="daily-forecast-30d.csv"
                    pdfTitle="30-Day Sales Forecast"
                  />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                        <th style={thStyle}>Date</th>
                        <th style={thStyle}>Day</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Predicted</th>
                        <th style={thStyle}>Factors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecast.map((f, i) => {
                        const isWeekend = (f.dayOfWeek || '').toLowerCase() === 'saturday' || (f.dayOfWeek || '').toLowerCase() === 'sunday';
                        return (
                          <tr key={i} style={{
                            borderBottom: '1px solid var(--border-color)',
                            background: f.isHoliday ? 'rgba(245,158,11,0.04)' : isWeekend ? 'rgba(16,185,129,0.03)' : 'transparent',
                          }}>
                            <td style={tdStyle}>{f.date}</td>
                            <td style={{ ...tdStyle, color: isWeekend ? GREEN : 'var(--text-secondary)' }}>{f.dayOfWeek}</td>
                            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: BRAND }}>{fmt(f.weatherAdjusted || f.predicted)}</td>
                            <td style={tdStyle}><FactorBadges row={f} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {!dailyLoading && !dailyError && !dailyData && (
          <EmptyState text="No daily forecast data available." />
        )}
      </>
    );
  };

  /* ==============================================================
     WEEKLY TAB
     ============================================================== */
  const renderWeekly = () => {
    const forecast = weeklyData?.forecast || [];

    const chartData = forecast.map(f => ({
      name: f.date,
      Predicted: Math.round(f.predicted || 0),
    }));

    const totalFcst = forecast.reduce((s, f) => s + (f.predicted || 0), 0);
    const avgWeek   = forecast.length ? totalFcst / forecast.length : 0;

    const weeklyCSVCols = [
      { label: 'Week Starting', accessor: 'date' },
      { label: 'Predicted Sales', accessor: 'predicted' },
    ];

    const weeklyTableCols = [
      { label: 'Week Starting', accessor: 'date' },
      { label: 'Predicted Sales', accessor: r => fmt(r.predicted) },
    ];

    return (
      <>
        {weeklyError && <ErrorBanner message={weeklyError} onRetry={fetchWeekly} />}
        {weeklyLoading && <LoadingSpinner text="Loading 12-week forecast..." />}

        {!weeklyLoading && !weeklyError && weeklyData && (
          <>
            {/* KPIs */}
            <div className="p-stat-grid">
              <div className="p-stat-card">
                <div className="p-stat-label">12-WEEK TOTAL</div>
                <div className="p-stat-value" style={{ color: BRAND }}>{fmt(totalFcst)}</div>
              </div>
              <div className="p-stat-card">
                <div className="p-stat-label">WEEKLY AVERAGE</div>
                <div className="p-stat-value" style={{ color: PURPLE }}>{fmt(avgWeek)}</div>
              </div>
              <div className="p-stat-card">
                <div className="p-stat-label">WEEKS FORECAST</div>
                <div className="p-stat-value" style={{ color: GREEN }}>{forecast.length}</div>
              </div>
            </div>

            {/* Chart */}
            {chartData.length > 0 ? (
              <div className="p-card" style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <BarChart2 size={16} style={{ color: BRAND }} />
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Weekly Sales Forecast</span>
                </div>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={fmtAxisK} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="Predicted" name="Predicted Sales" radius={[4, 4, 0, 0]} fill={BRAND} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState text="No weekly forecast data available." />
            )}

            {/* Table */}
            {forecast.length > 0 && (
              <div className="p-card" style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Weekly Breakdown</span>
                  <ExportButtons
                    rows={forecast}
                    csvColumns={weeklyCSVCols}
                    pdfColumns={weeklyTableCols}
                    csvFilename="weekly-forecast-12w.csv"
                    pdfTitle="12-Week Sales Forecast"
                  />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                        <th style={thStyle}>Week Starting</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Predicted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecast.map((f, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={tdStyle}>{f.date}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: BRAND }}>{fmt(f.predicted)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {!weeklyLoading && !weeklyError && !weeklyData && (
          <EmptyState text="No weekly forecast data available." />
        )}
      </>
    );
  };

  /* ==============================================================
     MONTHLY TAB
     ============================================================== */
  const renderMonthly = () => {
    const monthly = monthlyData?.monthly || [];

    const chartData = monthly.map(m => ({
      name: m.month,
      Predicted: Math.round(m.predicted || 0),
      avgDaily: m.avgDaily,
    }));

    const totalFcst = monthly.reduce((s, m) => s + (m.predicted || 0), 0);
    const avgMonth  = monthly.length ? totalFcst / monthly.length : 0;

    const monthlyCSVCols = [
      { label: 'Month', accessor: 'month' },
      { label: 'Predicted Sales', accessor: 'predicted' },
      { label: 'Days', accessor: 'days' },
      { label: 'Avg Daily', accessor: 'avgDaily' },
    ];

    const monthlyTableCols = [
      { label: 'Month', accessor: 'month' },
      { label: 'Predicted Sales', accessor: r => fmt(r.predicted) },
      { label: 'Days', accessor: 'days' },
      { label: 'Avg Daily', accessor: r => fmt(r.avgDaily) },
    ];

    return (
      <>
        {monthlyError && <ErrorBanner message={monthlyError} onRetry={fetchMonthly} />}
        {monthlyLoading && <LoadingSpinner text="Loading 6-month forecast..." />}

        {!monthlyLoading && !monthlyError && monthlyData && (
          <>
            {/* KPIs */}
            <div className="p-stat-grid">
              <div className="p-stat-card">
                <div className="p-stat-label">6-MONTH TOTAL</div>
                <div className="p-stat-value" style={{ color: BRAND }}>{fmt(totalFcst)}</div>
              </div>
              <div className="p-stat-card">
                <div className="p-stat-label">MONTHLY AVERAGE</div>
                <div className="p-stat-value" style={{ color: PURPLE }}>{fmt(avgMonth)}</div>
              </div>
              <div className="p-stat-card">
                <div className="p-stat-label">MONTHS FORECAST</div>
                <div className="p-stat-value" style={{ color: GREEN }}>{monthly.length}</div>
              </div>
            </div>

            {/* Chart */}
            {chartData.length > 0 ? (
              <div className="p-card" style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <TrendingUp size={16} style={{ color: BRAND }} />
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Monthly Sales Forecast</span>
                </div>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={fmtAxisK} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="Predicted" name="Predicted Sales" radius={[4, 4, 0, 0]} fill={BRAND} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState text="No monthly forecast data available." />
            )}

            {/* Table */}
            {monthly.length > 0 && (
              <div className="p-card" style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Monthly Breakdown</span>
                  <ExportButtons
                    rows={monthly}
                    csvColumns={monthlyCSVCols}
                    pdfColumns={monthlyTableCols}
                    csvFilename="monthly-forecast-6m.csv"
                    pdfTitle="6-Month Sales Forecast"
                  />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                        <th style={thStyle}>Month</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Predicted</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Days</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Avg Daily</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthly.map((m, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={tdStyle}>{m.month}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: BRAND }}>{fmt(m.predicted)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-muted)' }}>{m.days}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', color: PURPLE }}>{fmt(m.avgDaily)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {!monthlyLoading && !monthlyError && !monthlyData && (
          <EmptyState text="No monthly forecast data available." />
        )}
      </>
    );
  };

  /* ==============================================================
     RENDER
     ============================================================== */
  const content = (
    <div className="p-page">
      {/* Header */}
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon">
            <TrendingUp size={22} />
          </div>
          <div>
            <h1 className="p-title">Sales Predictions</h1>
            <p className="p-subtitle">AI-powered forecasting across hourly, daily, weekly, and monthly horizons</p>
          </div>
        </div>
        <div className="p-header-actions">
          {/* S66: Period dropdown replaces inner tab bar to avoid tabs-within-tabs
               nested layout under AnalyticsHub. */}
          <label className="sp-period-pill">
            <span className="sp-period-label">Horizon</span>
            <select className="sp-period-select" value={activeTab} onChange={(e) => setActiveTab(e.target.value)}>
              {TABS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'hourly'  && renderHourly()}
      {activeTab === 'daily'   && renderDaily()}
      {activeTab === 'weekly'  && renderWeekly()}
      {activeTab === 'monthly' && renderMonthly()}
    </div>
  );

  if (embedded) return content;

  return content;
}

/* ================================================================
   Export Buttons Component
   ================================================================ */
function ExportButtons({ rows, csvColumns, pdfColumns, csvFilename, pdfTitle }) {
  return (
    <div style={{ display: 'flex', gap: '0.4rem' }}>
      <button
        className="p-btn p-btn-ghost p-btn-sm"
        onClick={() => downloadCSV(rows, csvColumns, csvFilename)}
        title="Export CSV"
      >
        <Download size={13} /> CSV
      </button>
      <button
        className="p-btn p-btn-ghost p-btn-sm"
        onClick={() => downloadPDF(pdfTitle, rows, pdfColumns)}
        title="Export PDF"
      >
        <FileText size={13} /> PDF
      </button>
    </div>
  );
}

/* ================================================================
   Shared table styles
   ================================================================ */
const thStyle = {
  padding: '0.5rem 0.75rem',
  textAlign: 'left',
  fontSize: '0.72rem',
  fontWeight: 700,
  color: 'var(--text-muted)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '0.5rem 0.75rem',
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
};
