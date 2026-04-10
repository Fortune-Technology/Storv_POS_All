/**
 * WeatherWidget — displays current weather, hourly strip, and 10-day forecast.
 * Used in the Live Dashboard.
 */

import React from 'react';
import {
  Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudDrizzle, CloudFog,
  CloudSun, Wind, Droplets, Thermometer,
} from 'lucide-react';

const ICON_MAP = {
  'sun':             Sun,
  'cloud-sun':       CloudSun,
  'cloud':           Cloud,
  'cloud-rain':      CloudRain,
  'cloud-drizzle':   CloudDrizzle,
  'cloud-snow':      CloudSnow,
  'cloud-lightning':  CloudLightning,
  'cloud-fog':       CloudFog,
  'snowflake':       CloudSnow,
};

function WeatherIcon({ icon, size = 20, color }) {
  const Icon = ICON_MAP[icon] || Cloud;
  return <Icon size={size} color={color} />;
}

// ─── Current Conditions Card ────────────────────────────────────────────────

function CurrentWeather({ data }) {
  if (!data) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(99,179,237,0.04) 100%)',
      border: '1px solid rgba(59,130,246,0.15)',
      borderRadius: 'var(--radius-md)',
      padding: '1rem 1.25rem',
      display: 'flex', alignItems: 'center', gap: '1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <WeatherIcon icon={data.icon} size={36} color="#3b82f6" />
        <div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, fontFamily: 'var(--font-heading)' }}>
            {Math.round(data.temperature || 0)}°F
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500 }}>
            {data.condition || 'Unknown'}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '1rem', marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Droplets size={13} color="var(--info)" />
          <span>{data.humidity ?? '--'}%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Wind size={13} color="var(--text-muted)" />
          <span>{Math.round(data.windSpeed || 0)} mph</span>
        </div>
      </div>
    </div>
  );
}

// ─── Hourly Forecast Strip ──────────────────────────────────────────────────

function HourlyStrip({ data }) {
  if (!data?.length) return null;

  // Show next 24 hours from current hour
  const nowHour = new Date().getHours();
  const visible = data.filter(h => h.hour >= nowHour).slice(0, 24);
  if (visible.length < 12) visible.push(...data.filter(h => h.hour < nowHour).slice(0, 24 - visible.length));

  return (
    <div style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
      <div style={{ display: 'flex', gap: 2, minWidth: 'max-content', padding: '0.5rem 0' }}>
        {visible.map((h, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: '0.4rem 0.6rem', borderRadius: 'var(--radius-sm)',
            background: i === 0 ? 'rgba(59,130,246,0.08)' : 'transparent',
            minWidth: 48,
          }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {h.hour === 0 ? '12a' : h.hour < 12 ? `${h.hour}a` : h.hour === 12 ? '12p' : `${h.hour - 12}p`}
            </span>
            <WeatherIcon icon={h.icon} size={16} color="var(--text-secondary)" />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {Math.round(h.temperature || 0)}°
            </span>
            {h.precipitationChance > 20 && (
              <span style={{ fontSize: '0.6rem', color: 'var(--info)', fontWeight: 600 }}>
                {h.precipitationChance}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 10-Day Forecast ────────────────────────────────────────────────────────

function TenDayForecast({ data }) {
  if (!data?.length) return null;

  return (
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', padding: '0.25rem 0' }}>
      {data.map((d, i) => (
        <div key={i} style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          padding: '0.5rem 0.6rem', borderRadius: 'var(--radius-sm)',
          background: i === 0 ? 'rgba(59,130,246,0.06)' : 'var(--bg-secondary)',
          border: '1px solid var(--border-light)',
          minWidth: 64, flexShrink: 0,
        }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: i === 0 ? 'var(--info)' : 'var(--text-muted)' }}>
            {i === 0 ? 'Today' : d.dayName}
          </span>
          <WeatherIcon icon={d.icon} size={18} color="var(--text-secondary)" />
          <div style={{ display: 'flex', gap: 4, fontSize: '0.75rem' }}>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{Math.round(d.tempMax || 0)}°</span>
            <span style={{ color: 'var(--text-muted)' }}>{Math.round(d.tempMin || 0)}°</span>
          </div>
          {d.precipitationChance > 20 && (
            <span style={{ fontSize: '0.6rem', color: 'var(--info)', fontWeight: 600 }}>
              <Droplets size={9} style={{ marginRight: 2, verticalAlign: 'middle' }} />{d.precipitationChance}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Historical Day Weather (for past dates) ────────────────────────────────

function HistoricalWeather({ data }) {
  if (!data) return null;

  return (
    <div style={{
      background: 'rgba(245,158,11,0.06)',
      border: '1px solid rgba(245,158,11,0.15)',
      borderRadius: 'var(--radius-md)',
      padding: '0.75rem 1rem',
      display: 'flex', alignItems: 'center', gap: '0.75rem',
    }}>
      <WeatherIcon icon={data.icon || 'cloud'} size={28} color="#d97706" />
      <div>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {data.condition || 'Unknown'} — High {Math.round(data.temperatureMax || 0)}°F / Low {Math.round(data.temperatureMin || 0)}°F
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          Precip: {(data.precipitationSum || 0).toFixed(1)} in | Wind: {Math.round(data.windSpeedMax || 0)} mph | Humidity: {data.humidity || '--'}%
        </div>
      </div>
    </div>
  );
}

// ─── Main Widget ────────────────────────────────────────────────────────────

export default function WeatherWidget({ weather, isToday }) {
  if (!weather) return null;

  if (!isToday && weather.historical) {
    return <HistoricalWeather data={weather.historical} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <CurrentWeather data={weather.current} />
      <HourlyStrip data={weather.hourly} />
      <TenDayForecast data={weather.tenDay} />
    </div>
  );
}

export { CurrentWeather, HourlyStrip, TenDayForecast, HistoricalWeather, WeatherIcon };
