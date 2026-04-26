import axios from 'axios';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

/**
 * Weather Service — Open-Meteo Integration
 *
 * Fetches weather data, caches in PostgreSQL, provides aggregation helpers.
 * Open-Meteo: Free, no API key. archive-api for historical, api for forecast.
 */

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const DAILY_PARAMS = 'temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,weathercode,windspeed_10m_max,relative_humidity_2m_mean';

// ─── Domain shapes ──────────────────────────────────────────────────────────

export interface WeatherCodeInfo {
  condition: string;
  icon: string;
}

export interface WeatherRecord {
  date: string;
  latitude: number;
  longitude: number;
  temperatureMax: number | null;
  temperatureMin: number | null;
  temperatureMean: number | null;
  precipitationSum: number | null;
  weatherCode: number | null;
  condition: string | null;
  windSpeedMax: number | null;
  humidity: number | null;
  source: 'historical' | 'forecast' | string;
  fetchedAt: Date;
}

/** A loose row shape returned by `prisma.weatherCache.findMany` — Prisma's
 * generated type and the runtime upsert input share the same fields, so we
 * accept either when reading. */
type WeatherRow = WeatherRecord | Awaited<ReturnType<typeof prisma.weatherCache.findMany>>[number];

/** Open-Meteo daily payload — only the fields we read are typed. */
interface OpenMeteoDaily {
  time?: string[];
  temperature_2m_max?: Array<number | null>;
  temperature_2m_min?: Array<number | null>;
  temperature_2m_mean?: Array<number | null>;
  precipitation_sum?: Array<number | null>;
  precipitation_probability_max?: Array<number | null>;
  weathercode?: Array<number | null>;
  windspeed_10m_max?: Array<number | null>;
  relative_humidity_2m_mean?: Array<number | null>;
}

interface OpenMeteoCurrent {
  temperature_2m?: number;
  relative_humidity_2m?: number;
  precipitation?: number;
  weathercode?: number;
  windspeed_10m?: number;
}

interface OpenMeteoHourly {
  time?: string[];
  temperature_2m?: Array<number | null>;
  precipitation_probability?: Array<number | null>;
  weathercode?: Array<number | null>;
  windspeed_10m?: Array<number | null>;
  relative_humidity_2m?: Array<number | null>;
}

export interface CurrentWeatherResult {
  current: {
    temperature: number | undefined;
    humidity: number | undefined;
    precipitation: number | undefined;
    weatherCode: number | undefined;
    condition: string;
    icon: string;
    windSpeed: number | undefined;
  };
  forecast: Array<{
    date: string;
    tempMax: number | null | undefined;
    tempMin: number | null | undefined;
    precipitation: number | null | undefined;
    weatherCode: number | null | undefined;
    condition: string;
    icon: string;
  }>;
  fetchedAt: string;
}

export interface HourlyForecastEntry {
  time: string;
  hour: number;
  temperature: number | null | undefined;
  precipitationChance: number;
  weatherCode: number | null | undefined;
  condition: string;
  icon: string;
  windSpeed: number | null | undefined;
  humidity: number | null | undefined;
}

export interface TenDayForecastEntry {
  date: string;
  dayName: string;
  tempMax: number | null | undefined;
  tempMin: number | null | undefined;
  precipitation: number;
  precipitationChance: number;
  weatherCode: number | null | undefined;
  condition: string;
  icon: string;
  windSpeed: number | null | undefined;
  humidity: number | null | undefined;
}

// ═══════════════════════════════════════════════════════
// WMO WEATHER CODE → HUMAN-READABLE
// ═══════════════════════════════════════════════════════

const WEATHER_CODE_MAP: Record<number, WeatherCodeInfo> = {
  0:  { condition: 'Clear',           icon: 'sun' },
  1:  { condition: 'Mainly Clear',    icon: 'sun' },
  2:  { condition: 'Partly Cloudy',   icon: 'cloud-sun' },
  3:  { condition: 'Overcast',        icon: 'cloud' },
  45: { condition: 'Fog',             icon: 'cloud-fog' },
  48: { condition: 'Rime Fog',        icon: 'cloud-fog' },
  51: { condition: 'Light Drizzle',   icon: 'cloud-drizzle' },
  53: { condition: 'Drizzle',         icon: 'cloud-drizzle' },
  55: { condition: 'Heavy Drizzle',   icon: 'cloud-drizzle' },
  56: { condition: 'Freezing Drizzle', icon: 'cloud-snow' },
  57: { condition: 'Heavy Frz. Drizzle', icon: 'cloud-snow' },
  61: { condition: 'Light Rain',      icon: 'cloud-rain' },
  63: { condition: 'Rain',            icon: 'cloud-rain' },
  65: { condition: 'Heavy Rain',      icon: 'cloud-rain' },
  66: { condition: 'Freezing Rain',   icon: 'cloud-snow' },
  67: { condition: 'Heavy Frz. Rain', icon: 'cloud-snow' },
  71: { condition: 'Light Snow',      icon: 'snowflake' },
  73: { condition: 'Snow',            icon: 'snowflake' },
  75: { condition: 'Heavy Snow',      icon: 'snowflake' },
  77: { condition: 'Snow Grains',     icon: 'snowflake' },
  80: { condition: 'Light Showers',   icon: 'cloud-rain' },
  81: { condition: 'Showers',         icon: 'cloud-rain' },
  82: { condition: 'Heavy Showers',   icon: 'cloud-rain' },
  85: { condition: 'Light Snow Showers', icon: 'snowflake' },
  86: { condition: 'Heavy Snow Showers', icon: 'snowflake' },
  95: { condition: 'Thunderstorm',    icon: 'cloud-lightning' },
  96: { condition: 'T-storm w/ Hail', icon: 'cloud-lightning' },
  99: { condition: 'T-storm w/ Heavy Hail', icon: 'cloud-lightning' },
};

export const mapWeatherCode = (code: number | null | undefined): WeatherCodeInfo => {
  if (code == null) return { condition: 'Unknown', icon: 'cloud' };
  return WEATHER_CODE_MAP[code] || { condition: 'Unknown', icon: 'cloud' };
};

// ═══════════════════════════════════════════════════════
// CORE: FETCH WEATHER FOR A DATE RANGE
// ═══════════════════════════════════════════════════════

/**
 * Fetch weather data for a date range at a given location.
 * Checks cache first, fetches missing dates from Open-Meteo, caches results.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate YYYY-MM-DD
 * @param {string} timezone e.g. 'America/New_York'
 * @returns {Array} Sorted array of weather records
 */
export const fetchWeatherRange = async (
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  startDate: string,
  endDate: string,
  timezone: string = 'America/New_York',
): Promise<WeatherRow[]> => {
  if (!latitude || !longitude) {
    console.log('⏭ Weather fetch skipped — no store location configured');
    return [];
  }

  // Round coords to 2 decimal places for cache keying
  const lat = Math.round(latitude * 100) / 100;
  const lng = Math.round(longitude * 100) / 100;

  // 1. Check cache for existing records
  type CachedWeatherRow = Awaited<ReturnType<typeof prisma.weatherCache.findMany>>[number];
  let cached: CachedWeatherRow[] = [];
  try {
    cached = await prisma.weatherCache.findMany({
      where: {
        date:      { gte: startDate, lte: endDate },
        latitude:  lat,
        longitude: lng,
      },
      orderBy: { date: 'asc' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('⚠ Could not load weather cache:', message);
  }

  // Build set of dates we already have
  const cachedDates = new Set(cached.map((r) => r.date));

  // Build full date list
  const allDates: string[] = [];
  const cur = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  while (cur <= end) {
    allDates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  // Determine which dates are missing
  const missingDates = allDates.filter((d) => !cachedDates.has(d));

  if (missingDates.length === 0) {
    console.log(`✓ Weather cache hit: ${cached.length} days for [${startDate} → ${endDate}]`);
    return cached;
  }

  console.log(`🌤 Fetching ${missingDates.length} missing weather days from Open-Meteo...`);

  // 2. Split missing dates into contiguous ranges, then into historical vs forecast
  const todayStr = new Date().toISOString().slice(0, 10);
  const historicalMissing = missingDates.filter((d) => d < todayStr);
  const forecastMissing = missingDates.filter((d) => d >= todayStr);

  const newRecords: WeatherRecord[] = [];

  // Fetch historical data (batch by year to stay within Open-Meteo limits)
  if (historicalMissing.length > 0) {
    const histStart = historicalMissing[0];
    const histEnd = historicalMissing[historicalMissing.length - 1];

    try {
      const resp = await axios.get(ARCHIVE_URL, {
        params: {
          latitude: lat,
          longitude: lng,
          start_date: histStart,
          end_date: histEnd,
          daily: DAILY_PARAMS,
          temperature_unit: 'fahrenheit',
          windspeed_unit: 'mph',
          timezone,
        },
        timeout: 30000,
      });

      const daily = (resp.data as { daily?: OpenMeteoDaily })?.daily;
      if (daily?.time) {
        for (let i = 0; i < daily.time.length; i++) {
          const date = daily.time[i];
          if (!cachedDates.has(date)) {
            const { condition } = mapWeatherCode(daily.weathercode?.[i] ?? null);
            newRecords.push({
              date,
              latitude: lat,
              longitude: lng,
              temperatureMax:   daily.temperature_2m_max?.[i]   ?? null,
              temperatureMin:   daily.temperature_2m_min?.[i]   ?? null,
              temperatureMean:  daily.temperature_2m_mean?.[i]  ?? null,
              precipitationSum: daily.precipitation_sum?.[i]    ?? 0,
              weatherCode:      daily.weathercode?.[i]          ?? null,
              condition,
              windSpeedMax:     daily.windspeed_10m_max?.[i]    ?? null,
              humidity:         daily.relative_humidity_2m_mean?.[i] ?? null,
              source: 'historical',
              fetchedAt: new Date(),
            });
          }
        }
      }
      console.log(`  ✓ Fetched ${newRecords.length} historical weather records`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('⚠ Open-Meteo historical fetch error:', message);
    }
  }

  // Fetch forecast data (today + future)
  if (forecastMissing.length > 0) {
    try {
      const forecastDays = Math.min(
        16,
        Math.ceil((new Date(forecastMissing[forecastMissing.length - 1]).getTime() - Date.now()) / 86400000) + 2,
      );
      const resp = await axios.get(FORECAST_URL, {
        params: {
          latitude: lat,
          longitude: lng,
          daily: DAILY_PARAMS,
          temperature_unit: 'fahrenheit',
          windspeed_unit: 'mph',
          timezone,
          forecast_days: forecastDays,
        },
        timeout: 15000,
      });

      const daily = (resp.data as { daily?: OpenMeteoDaily })?.daily;
      if (daily?.time) {
        for (let i = 0; i < daily.time.length; i++) {
          const date = daily.time[i];
          if (forecastMissing.includes(date) && !cachedDates.has(date)) {
            const { condition } = mapWeatherCode(daily.weathercode?.[i] ?? null);
            newRecords.push({
              date,
              latitude: lat,
              longitude: lng,
              temperatureMax:   daily.temperature_2m_max?.[i]   ?? null,
              temperatureMin:   daily.temperature_2m_min?.[i]   ?? null,
              temperatureMean:  daily.temperature_2m_mean?.[i]  ?? null,
              precipitationSum: daily.precipitation_sum?.[i]    ?? 0,
              weatherCode:      daily.weathercode?.[i]          ?? null,
              condition,
              windSpeedMax:     daily.windspeed_10m_max?.[i]    ?? null,
              humidity:         daily.relative_humidity_2m_mean?.[i] ?? null,
              source: 'forecast',
              fetchedAt: new Date(),
            });
          }
        }
      }
      console.log(`  ✓ Fetched ${forecastMissing.length} forecast weather records`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('⚠ Open-Meteo forecast fetch error:', message);
    }
  }

  // 3. Cache new records
  if (newRecords.length > 0) {
    try {
      for (const r of newRecords) {
        const data: Prisma.WeatherCacheUncheckedCreateInput = {
          date: r.date,
          latitude: r.latitude,
          longitude: r.longitude,
          temperatureMax: r.temperatureMax,
          temperatureMin: r.temperatureMin,
          temperatureMean: r.temperatureMean,
          precipitationSum: r.precipitationSum,
          weatherCode: r.weatherCode,
          condition: r.condition,
          windSpeedMax: r.windSpeedMax,
          humidity: r.humidity,
          source: r.source,
          fetchedAt: r.fetchedAt,
        };
        await prisma.weatherCache.upsert({
          where:  { date_latitude_longitude: { date: r.date, latitude: r.latitude, longitude: r.longitude } },
          update: data,
          create: data,
        });
      }
      console.log(`  ✓ Cached ${newRecords.length} weather records to PostgreSQL`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('⚠ Failed to cache weather records:', message);
    }
  }

  // 4. Return merged + sorted result
  const allRecords: WeatherRow[] = [
    ...cached,
    ...(newRecords as unknown as WeatherRow[]),
  ].sort((a, b) => a.date.localeCompare(b.date));

  // Deduplicate by date
  const seen = new Set<string>();
  return allRecords.filter((r) => {
    if (seen.has(r.date)) return false;
    seen.add(r.date);
    return true;
  });
};

// ═══════════════════════════════════════════════════════
// CURRENT WEATHER (for real-time dashboard)
// ═══════════════════════════════════════════════════════

export const getCurrentWeather = async (
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  timezone: string = 'America/New_York',
): Promise<CurrentWeatherResult | null> => {
  if (!latitude || !longitude) return null;

  const lat = Math.round(latitude * 100) / 100;
  const lng = Math.round(longitude * 100) / 100;

  try {
    const resp = await axios.get(FORECAST_URL, {
      params: {
        latitude: lat,
        longitude: lng,
        current: 'temperature_2m,relative_humidity_2m,precipitation,weathercode,windspeed_10m',
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode',
        temperature_unit: 'fahrenheit',
        windspeed_unit: 'mph',
        timezone,
        forecast_days: 3,
      },
      timeout: 10000,
    });

    const data = resp.data as { current?: OpenMeteoCurrent; daily?: OpenMeteoDaily };
    const current = data?.current;
    const daily = data?.daily;
    const { condition, icon } = mapWeatherCode(current?.weathercode ?? null);

    return {
      current: {
        temperature: current?.temperature_2m,
        humidity: current?.relative_humidity_2m,
        precipitation: current?.precipitation,
        weatherCode: current?.weathercode,
        condition,
        icon,
        windSpeed: current?.windspeed_10m,
      },
      forecast: daily?.time?.map((date, i) => ({
        date,
        tempMax: daily.temperature_2m_max?.[i],
        tempMin: daily.temperature_2m_min?.[i],
        precipitation: daily.precipitation_sum?.[i],
        weatherCode: daily.weathercode?.[i],
        ...mapWeatherCode(daily.weathercode?.[i] ?? null),
      })) || [],
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('⚠ Failed to fetch current weather:', message);
    return null;
  }
};

// ═══════════════════════════════════════════════════════
// HOURLY FORECAST (next 24h)
// ═══════════════════════════════════════════════════════

export const getHourlyForecast = async (
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  timezone: string = 'America/New_York',
): Promise<HourlyForecastEntry[]> => {
  if (!latitude || !longitude) return [];
  const lat = Math.round(latitude * 100) / 100;
  const lng = Math.round(longitude * 100) / 100;

  try {
    const resp = await axios.get(FORECAST_URL, {
      params: {
        latitude: lat, longitude: lng,
        hourly: 'temperature_2m,precipitation_probability,weathercode,windspeed_10m,relative_humidity_2m',
        temperature_unit: 'fahrenheit',
        windspeed_unit: 'mph',
        timezone,
        forecast_days: 2,
      },
      timeout: 10000,
    });

    const h = (resp.data as { hourly?: OpenMeteoHourly })?.hourly;
    if (!h?.time) return [];

    return h.time.slice(0, 48).map((t, i) => ({
      time: t,
      hour: new Date(t).getHours(),
      temperature: h.temperature_2m?.[i],
      precipitationChance: h.precipitation_probability?.[i] ?? 0,
      weatherCode: h.weathercode?.[i],
      ...mapWeatherCode(h.weathercode?.[i] ?? null),
      windSpeed: h.windspeed_10m?.[i],
      humidity: h.relative_humidity_2m?.[i],
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('⚠ Failed to fetch hourly forecast:', message);
    return [];
  }
};

// ═══════════════════════════════════════════════════════
// 10-DAY FORECAST
// ═══════════════════════════════════════════════════════

export const getTenDayForecast = async (
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  timezone: string = 'America/New_York',
): Promise<TenDayForecastEntry[]> => {
  if (!latitude || !longitude) return [];
  const lat = Math.round(latitude * 100) / 100;
  const lng = Math.round(longitude * 100) / 100;

  try {
    const resp = await axios.get(FORECAST_URL, {
      params: {
        latitude: lat, longitude: lng,
        daily: DAILY_PARAMS + ',precipitation_probability_max',
        temperature_unit: 'fahrenheit',
        windspeed_unit: 'mph',
        timezone,
        forecast_days: 10,
      },
      timeout: 10000,
    });

    const d = (resp.data as { daily?: OpenMeteoDaily })?.daily;
    if (!d?.time) return [];

    return d.time.map((date, i) => ({
      date,
      dayName: new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
      tempMax: d.temperature_2m_max?.[i],
      tempMin: d.temperature_2m_min?.[i],
      precipitation: d.precipitation_sum?.[i] ?? 0,
      precipitationChance: d.precipitation_probability_max?.[i] ?? 0,
      weatherCode: d.weathercode?.[i],
      ...mapWeatherCode(d.weathercode?.[i] ?? null),
      windSpeed: d.windspeed_10m_max?.[i],
      humidity: d.relative_humidity_2m_mean?.[i],
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('⚠ Failed to fetch 10-day forecast:', message);
    return [];
  }
};

// ═══════════════════════════════════════════════════════
// AGGREGATION HELPERS
// ═══════════════════════════════════════════════════════

/**
 * Aggregate daily weather into weekly buckets.
 * Weeks start on Monday (ISO week).
 */
export const aggregateWeatherWeekly = (dailyRecords: WeatherRow[]) => {
  const weeks: Record<string, { days: WeatherRow[]; weekStart: string }> = {};
  for (const r of dailyRecords) {
    const d = new Date(r.date + 'T00:00:00');
    // ISO week: Monday-based
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    const weekKey = monday.toISOString().slice(0, 10);

    if (!weeks[weekKey]) {
      weeks[weekKey] = { days: [], weekStart: weekKey };
    }
    weeks[weekKey].days.push(r);
  }

  return Object.values(weeks).map((w) => {
    const days = w.days;
    const sunday = new Date(w.weekStart + 'T00:00:00');
    sunday.setDate(sunday.getDate() + 6);

    return {
      weekStart: w.weekStart,
      weekEnd: sunday.toISOString().slice(0, 10),
      avgTempMax: avg(days.map((d) => d.temperatureMax)),
      avgTempMin: avg(days.map((d) => d.temperatureMin)),
      avgTempMean: avg(days.map((d) => d.temperatureMean)),
      totalPrecipitation: sum(days.map((d) => d.precipitationSum || 0)),
      dominantCondition: mode(days.map((d) => d.condition)),
      dominantIcon: mode(days.map((d) => mapWeatherCode(d.weatherCode)?.icon)),
      daysCount: days.length,
      dailyBreakdown: days,
    };
  }).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
};

/**
 * Aggregate daily weather into monthly buckets.
 */
export const aggregateWeatherMonthly = (dailyRecords: WeatherRow[]) => {
  const months: Record<string, WeatherRow[]> = {};
  for (const r of dailyRecords) {
    const monthKey = r.date.slice(0, 7); // YYYY-MM
    if (!months[monthKey]) months[monthKey] = [];
    months[monthKey].push(r);
  }

  return Object.entries(months).map(([month, days]) => ({
    month,
    avgTempMax: avg(days.map((d) => d.temperatureMax)),
    avgTempMin: avg(days.map((d) => d.temperatureMin)),
    avgTempMean: avg(days.map((d) => d.temperatureMean)),
    totalPrecipitation: sum(days.map((d) => d.precipitationSum || 0)),
    dominantCondition: mode(days.map((d) => d.condition)),
    daysCount: days.length,
  })).sort((a, b) => a.month.localeCompare(b.month));
};

/**
 * Aggregate daily weather into yearly buckets.
 */
export const aggregateWeatherYearly = (dailyRecords: WeatherRow[]) => {
  const years: Record<string, WeatherRow[]> = {};
  for (const r of dailyRecords) {
    const yearKey = r.date.slice(0, 4); // YYYY
    if (!years[yearKey]) years[yearKey] = [];
    years[yearKey].push(r);
  }

  return Object.entries(years).map(([year, days]) => ({
    year,
    avgTempMax: avg(days.map((d) => d.temperatureMax)),
    avgTempMin: avg(days.map((d) => d.temperatureMin)),
    avgTempMean: avg(days.map((d) => d.temperatureMean)),
    totalPrecipitation: sum(days.map((d) => d.precipitationSum || 0)),
    dominantCondition: mode(days.map((d) => d.condition)),
    daysCount: days.length,
  })).sort((a, b) => a.year.localeCompare(b.year));
};

// ═══════════════════════════════════════════════════════
// MERGE HELPERS (combine sales + weather by date)
// ═══════════════════════════════════════════════════════

/** Loose shape of a sales row carrying a `Date` field; everything else
 * is preserved on the returned merged row. */
export interface SalesRowWithDate {
  Date?: string | null;
  [key: string]: unknown;
}

/**
 * Merge daily sales rows with daily weather records by date.
 */
export const mergeSalesAndWeather = (
  salesRows: SalesRowWithDate[],
  weatherRecords: WeatherRow[],
) => {
  const weatherByDate: Record<string, WeatherRow> = {};
  for (const w of weatherRecords) {
    weatherByDate[w.date] = w;
  }

  return salesRows.map((sale) => {
    const dateKey = sale.Date ? sale.Date.slice(0, 10) : '';
    const w = weatherByDate[dateKey];
    return {
      ...sale,
      tempHigh:      w?.temperatureMax   ?? null,
      tempLow:       w?.temperatureMin   ?? null,
      tempMean:      w?.temperatureMean  ?? null,
      precipitation: w?.precipitationSum ?? null,
      weatherCode:   w?.weatherCode      ?? null,
      condition:     w?.condition         ?? null,
      windSpeed:     w?.windSpeedMax     ?? null,
      humidity:      w?.humidity         ?? null,
    };
  });
};

// ─── Utility functions ───

function avg(arr: Array<number | null | undefined>): number | null {
  const nums = arr.filter((n): n is number => n != null);
  return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;
}

function sum(arr: Array<number | null | undefined>): number {
  return Math.round(arr.reduce<number>((a, b) => a + (b || 0), 0) * 10) / 10;
}

function mode<T>(arr: Array<T | null | undefined>): T | undefined {
  const freq: Record<string, number> = {};
  let maxFreq = 0;
  let result: T | undefined = arr[0] ?? undefined;
  for (const val of arr) {
    if (val == null) continue;
    const key = String(val);
    freq[key] = (freq[key] || 0) + 1;
    if (freq[key] > maxFreq) {
      maxFreq = freq[key];
      result = val;
    }
  }
  return result;
}

export default {
  fetchWeatherRange,
  getCurrentWeather,
  getHourlyForecast,
  getTenDayForecast,
  mapWeatherCode,
  aggregateWeatherWeekly,
  aggregateWeatherMonthly,
  aggregateWeatherYearly,
  mergeSalesAndWeather,
};
