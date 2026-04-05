import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from '../components/Sidebar';
import './analytics.css';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ComposedChart, Line,
} from 'recharts';
import {
  Activity, DollarSign, ShoppingCart, TrendingUp, RefreshCw,
  Thermometer, Droplets, Wind, MapPin, AlertCircle, Sun,
  Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog,
  CloudDrizzle, CloudSun, Zap, Calendar,
} from 'lucide-react';
import { getRealtimeSales, getCurrentWeather, getSalesDailyWithWeather } from '../services/api';

/* ── Weather icon renderer ───────────────────────────────────────── */
const ICON_MAP = {
  Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain,
  Snowflake: CloudSnow, CloudLightning,
};
function WeatherIcon({ name, size = 24, color }) {
  const Comp = ICON_MAP[name] || Cloud;
  return <Comp size={size} color={color} />;
}

/* ── Formatters ──────────────────────────────────────────────────── */
const fmt = (n) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtShort = (n) => {
  if (n == null) return '—';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
  return '$' + Number(n).toFixed(0);
};
const fmtNum = (n) => n == null ? '—' : Number(n).toLocaleString();

/* ── Temp colour ─────────────────────────────────────────────────── */
function tempColor(f) {
  if (f == null) return 'var(--text-muted)';
  if (f >= 90) return '#ef4444';
  if (f >= 75) return '#f97316';
  if (f >= 60) return '#f59e0b';
  if (f >= 45) return '#3b82f6';
  if (f >= 32) return '#6366f1';
  return '#8b5cf6';
}

/* ── Custom Tooltip ──────────────────────────────────────────────── */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="analytics-tooltip">
      <div className="tooltip-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="tooltip-row" style={{ color: p.color }}>
          <span>{p.name}:</span>
          <span>{p.name.includes('Sales') ? fmtShort(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Forecast Day Card ───────────────────────────────────────────── */
function ForecastCard({ day }) {
  const label = day.date
    ? new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      })
    : '—';
  // weatherService.getCurrentWeather uses tempMax/tempMin in forecast items
  const hi   = day.tempMax ?? day.temperatureMax ?? null;
  const lo   = day.tempMin ?? day.temperatureMin ?? null;
  const prec = day.precipitation ?? day.precipitationSum ?? null;
  return (
    <div className="forecast-day">
      <div className="forecast-day-label">{label}</div>
      <WeatherIcon name={day.icon || 'Cloud'} size={26} color="var(--accent-primary)" />
      <div className="forecast-day-condition">{day.condition || '—'}</div>
      <div className="forecast-day-temps">
        <span style={{ color: tempColor(hi) }}>
          {hi != null ? Math.round(hi) + '°' : '—'}
        </span>
        <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>/</span>
        <span style={{ color: tempColor(lo) }}>
          {lo != null ? Math.round(lo) + '°' : '—'}
        </span>
      </div>
      {prec != null && !isNaN(Number(prec)) && (
        <div className="forecast-day-precip">
          <Droplets size={12} style={{ opacity: 0.6 }} />
          <span>{Number(prec).toFixed(1)} mm</span>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
export default function RealTimeDashboard() {
  const [todaySales,   setTodaySales]   = useState(null);
  const [isToday,      setIsToday]      = useState(true);
  const [dataDate,     setDataDate]     = useState(null);
  const [weatherData,  setWeatherData]  = useState(null);
  const [recentSales,  setRecentSales]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [lastUpdated,  setLastUpdated]  = useState(null);
  const [countdown,    setCountdown]    = useState(60);
  const intervalRef   = useRef(null);
  const countdownRef  = useRef(null);

  /* ── Date helpers ───────────────────────────────────────────────── */
  const toISO = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); };

  /* ── Fetch ──────────────────────────────────────────────────────── */
  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [realtimeRes, weatherRes, recentRes] = await Promise.allSettled([
        getRealtimeSales(),
        getCurrentWeather(),
        getSalesDailyWithWeather({ from: daysAgo(14), to: toISO(new Date()) }),
      ]);

      if (realtimeRes.status === 'fulfilled') {
        const r = realtimeRes.value;
        setTodaySales(r?.todaySales ?? null);
        setIsToday(r?.isToday ?? true);
        setDataDate(r?.dataDate ?? null);
      }
      if (weatherRes.status === 'fulfilled') {
        setWeatherData(weatherRes.value);
      }
      if (recentRes.status === 'fulfilled') {
        const rows = recentRes.value?.value || [];
        setRecentSales(rows.slice(-14)); // last 14 days
      }

      if (
        realtimeRes.status === 'rejected' &&
        weatherRes.status === 'rejected' &&
        recentRes.status === 'rejected'
      ) {
        setError('Failed to load data. Check your connection.');
      }

      setLastUpdated(new Date());
      setCountdown(60);
    } catch (e) {
      setError(e.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line

  /* ── Auto-refresh every 60 s ────────────────────────────────────── */
  useEffect(() => {
    fetchAll();
    intervalRef.current  = setInterval(() => fetchAll(true), 60_000);
    countdownRef.current = setInterval(() => setCountdown(c => (c <= 1 ? 60 : c - 1)), 1_000);
    return () => {
      clearInterval(intervalRef.current);
      clearInterval(countdownRef.current);
    };
  }, [fetchAll]);

  /* ── Derived ────────────────────────────────────────────────────── */
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const netSales   = todaySales?.TotalNetSales   ?? null;
  const grossSales = todaySales?.TotalGrossSales ?? null;
  const txCount    = todaySales?.TotalTransactionsCount ?? null;
  const avgTx      = netSales != null && txCount ? netSales / txCount : null;

  const salesLabel = isToday ? 'Today' : 'Latest Day';
  const kpis = [
    { label: `Net Sales — ${salesLabel}`,  value: fmt(netSales),   icon: <DollarSign size={20} />, color: 'var(--accent-primary)', bg: 'var(--brand-12)' },
    { label: 'Transactions',               value: fmtNum(txCount), icon: <ShoppingCart size={20} />, color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
    { label: 'Avg Transaction',            value: fmt(avgTx),      icon: <TrendingUp size={20} />, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    { label: `Gross Sales — ${salesLabel}`, value: fmt(grossSales), icon: <Activity size={20} />,  color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  ];

  /* ── Recent sales chart data ────────────────────────────────────── */
  const chartData = recentSales.map(r => ({
    date: r.Date
      ? new Date(r.Date.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '—',
    'Net Sales': r.TotalNetSales ?? 0,
    Transactions: r.TotalTransactionsCount ?? 0,
    TempHigh: r.tempHigh ?? null,
  }));

  const currentW  = weatherData?.current;
  const forecast  = weatherData?.forecast || [];
  // First forecast day = today's high/low
  const todayFcst = forecast[0] ?? null;
  const todayHi   = todayFcst?.tempMax ?? todayFcst?.temperatureMax ?? null;
  const todayLo   = todayFcst?.tempMin ?? todayFcst?.temperatureMin ?? null;
  const weatherEnabled = weatherData && currentW;

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">

        {/* Header */}
        <div className="analytics-header">
          <div>
            <h1 className="analytics-title" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span className="pulse-dot" style={{ display: 'inline-block', flexShrink: 0 }} />
              Live Dashboard
            </h1>
            <p className="analytics-subtitle">{today}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {lastUpdated && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Updated {lastUpdated.toLocaleTimeString()} · refreshes in {countdown}s
              </span>
            )}
            <button
              className="filter-btn"
              onClick={() => fetchAll()}
              disabled={loading}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              Refresh
            </button>
          </div>
        </div>

        {/* Stale data notice */}
        {!loading && !isToday && dataDate && (
          <div className="weather-setup-banner" style={{ marginBottom: '1.5rem', borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.08)' }}>
            <Calendar size={15} style={{ color: '#f59e0b' }} />
            <span style={{ color: '#f59e0b' }}>
              Today's data not yet available — showing most recent: <strong>
                {new Date(dataDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              </strong>
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="analytics-error" style={{ marginBottom: '1.5rem' }}>
            <AlertCircle size={16} /><span>{error}</span>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !todaySales && (
          <div className="analytics-loading">
            <div className="analytics-loading-spinner" />
            <span>Loading live data…</span>
          </div>
        )}

        {/* No Location Warning */}
        {!loading && !weatherEnabled && (
          <div className="weather-setup-banner" style={{ marginBottom: '1.5rem' }}>
            <MapPin size={16} />
            <span>
              Store location not configured — weather unavailable.
              Set it on the <strong>Sales Analytics</strong> page.
            </span>
          </div>
        )}

        {/* KPI Cards */}
        <div className="analytics-stats-row" style={{ marginBottom: '1.75rem' }}>
          {kpis.map(k => (
            <div key={k.label} className="analytics-stat-card">
              <div className="analytics-stat-icon" style={{ background: k.bg, color: k.color }}>
                {k.icon}
              </div>
              <div>
                <span className="analytics-stat-label">{k.label}</span>
                <span className="analytics-stat-value" style={{ color: k.color }}>
                  {loading && !todaySales ? '…' : k.value}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Weather + Forecast */}
        {weatherEnabled && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(180px, 240px) 1fr',
            gap: '1.5rem',
            marginBottom: '1.75rem',
            alignItems: 'stretch',
          }}>

            {/* Current Weather Hero */}
            <div className="weather-hero-card">
              <div className="weather-hero-icon">
                <WeatherIcon name={currentW.icon || 'Cloud'} size={52} color="var(--accent-primary)" />
              </div>
              <div className="weather-hero-temp" style={{ color: tempColor(currentW.temperature) }}>
                {currentW.temperature != null ? Math.round(currentW.temperature) + '°F' : '—'}
              </div>
              <div className="weather-hero-condition">{currentW.condition || '—'}</div>
              <div className="weather-hero-meta">
                {currentW.windSpeed != null && (
                  <span><Wind size={12} /> {Math.round(currentW.windSpeed)} mph</span>
                )}
                {currentW.humidity != null && (
                  <span><Droplets size={12} /> {currentW.humidity}%</span>
                )}
              </div>
              {(todayHi != null || todayLo != null) && (
                <div className="weather-hero-range">
                  <span style={{ color: tempColor(todayHi) }}>
                    H: {todayHi != null ? Math.round(todayHi) + '°' : '—'}
                  </span>
                  <span style={{ color: tempColor(todayLo) }}>
                    L: {todayLo != null ? Math.round(todayLo) + '°' : '—'}
                  </span>
                </div>
              )}
            </div>

            {/* 3-Day Forecast */}
            <div className="analytics-chart-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="analytics-chart-title" style={{ marginBottom: '1rem' }}>
                <Sun size={16} style={{ color: '#f59e0b' }} />
                3-Day Forecast
              </div>
              <div className="forecast-strip" style={{ flex: 1, alignItems: 'stretch', marginBottom: 0 }}>
                {forecast.length === 0
                  ? <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No forecast data.</p>
                  : forecast.map((d, i) => <ForecastCard key={i} day={d} />)
                }
              </div>
            </div>
          </div>
        )}

        {/* 14-Day Sales Trend */}
        <div className="analytics-chart-card" style={{ marginBottom: '1.75rem' }}>
          <div className="analytics-chart-title" style={{ marginBottom: '1.25rem' }}>
            <Calendar size={16} style={{ color: 'var(--accent-primary)' }} />
            Last 14 Days — Net Sales
            <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              Daily trend
            </span>
          </div>
          {chartData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              <Activity size={32} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
              <p>No recent sales data available.</p>
            </div>
          ) : (
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rtSalesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--accent-primary)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={fmtShort}
                    tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                    width={60}
                  />
                  {weatherEnabled && chartData.some(d => d.TempHigh != null) && (
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tickFormatter={v => v + '°'}
                      tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                      width={40}
                      domain={['auto', 'auto']}
                    />
                  )}
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="Net Sales"
                    stroke="var(--accent-primary)"
                    strokeWidth={2}
                    fill="url(#rtSalesGrad)"
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                  {weatherEnabled && chartData.some(d => d.TempHigh != null) && (
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="TempHigh"
                      name="Temp High"
                      stroke="#f97316"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 14-Day Transactions Bar Chart */}
        {chartData.length > 0 && (
          <div className="analytics-chart-card" style={{ marginBottom: '1.75rem' }}>
            <div className="analytics-chart-title" style={{ marginBottom: '1.25rem' }}>
              <ShoppingCart size={16} style={{ color: '#3b82f6' }} />
              Last 14 Days — Transactions
            </div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} width={40} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="Transactions" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Today's details */}
        {todaySales && (
          <div className="analytics-chart-card">
            <div className="analytics-chart-title" style={{ marginBottom: '1rem' }}>
              <Zap size={16} style={{ color: '#8b5cf6' }} />
              Today's Summary
            </div>
            <div className="analytics-stats-row" style={{ marginBottom: 0 }}>
              {[
                { label: 'Discounts',    value: fmt(todaySales.TotalDiscounts),   color: '#ef4444' },
                { label: 'Refunds',      value: fmt(todaySales.TotalRefunds),     color: '#f97316' },
                { label: 'Tax Collected', value: fmt(todaySales.TotalTaxes),      color: '#f59e0b' },
                { label: 'Total Collected', value: fmt(todaySales.TotalTotalCollected), color: 'var(--accent-primary)' },
              ].map(item => (
                <div key={item.label} className="analytics-stat-card" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                  <span className="analytics-stat-label">{item.label}</span>
                  <span style={{ fontSize: '1.1rem', fontWeight: 700, color: item.color }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
