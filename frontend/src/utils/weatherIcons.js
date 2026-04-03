/**
 * Weather Icon Utility
 * Maps WMO weather codes to Lucide icon names and labels.
 * Used by SalesAnalytics and RealTimeDashboard.
 */

// Map of weather code → { icon (Lucide name string), label, emoji }
const WEATHER_MAP = {
  0:  { icon: 'Sun',           label: 'Clear',              emoji: '☀️' },
  1:  { icon: 'Sun',           label: 'Mainly Clear',       emoji: '🌤️' },
  2:  { icon: 'CloudSun',      label: 'Partly Cloudy',      emoji: '⛅' },
  3:  { icon: 'Cloud',         label: 'Overcast',           emoji: '☁️' },
  45: { icon: 'CloudFog',      label: 'Fog',                emoji: '🌫️' },
  48: { icon: 'CloudFog',      label: 'Rime Fog',           emoji: '🌫️' },
  51: { icon: 'CloudDrizzle',  label: 'Light Drizzle',      emoji: '🌦️' },
  53: { icon: 'CloudDrizzle',  label: 'Drizzle',            emoji: '🌦️' },
  55: { icon: 'CloudDrizzle',  label: 'Heavy Drizzle',      emoji: '🌧️' },
  56: { icon: 'Snowflake',     label: 'Freezing Drizzle',   emoji: '🌨️' },
  57: { icon: 'Snowflake',     label: 'Heavy Frz. Drizzle', emoji: '🌨️' },
  61: { icon: 'CloudRain',     label: 'Light Rain',         emoji: '🌦️' },
  63: { icon: 'CloudRain',     label: 'Rain',               emoji: '🌧️' },
  65: { icon: 'CloudRain',     label: 'Heavy Rain',         emoji: '🌧️' },
  66: { icon: 'Snowflake',     label: 'Freezing Rain',      emoji: '🌨️' },
  67: { icon: 'Snowflake',     label: 'Heavy Frz. Rain',    emoji: '🌨️' },
  71: { icon: 'Snowflake',     label: 'Light Snow',         emoji: '🌨️' },
  73: { icon: 'Snowflake',     label: 'Snow',               emoji: '❄️' },
  75: { icon: 'Snowflake',     label: 'Heavy Snow',         emoji: '❄️' },
  77: { icon: 'Snowflake',     label: 'Snow Grains',        emoji: '❄️' },
  80: { icon: 'CloudRain',     label: 'Light Showers',      emoji: '🌦️' },
  81: { icon: 'CloudRain',     label: 'Showers',            emoji: '🌧️' },
  82: { icon: 'CloudRain',     label: 'Heavy Showers',      emoji: '🌧️' },
  85: { icon: 'Snowflake',     label: 'Light Snow Showers', emoji: '🌨️' },
  86: { icon: 'Snowflake',     label: 'Heavy Snow Showers', emoji: '🌨️' },
  95: { icon: 'CloudLightning', label: 'Thunderstorm',      emoji: '⛈️' },
  96: { icon: 'CloudLightning', label: 'T-storm w/ Hail',   emoji: '⛈️' },
  99: { icon: 'CloudLightning', label: 'T-storm w/ Heavy Hail', emoji: '⛈️' },
};

/**
 * Get weather info from a WMO weather code
 * @param {number} code - WMO weather code
 * @returns {{ icon: string, label: string, emoji: string }}
 */
export const getWeatherInfo = (code) => {
  return WEATHER_MAP[code] || { icon: 'Cloud', label: 'Unknown', emoji: '🌡️' };
};

/**
 * Get just the condition string (e.g., from backend 'condition' field)
 * Falls back to code lookup if condition is null/undefined.
 */
export const getConditionLabel = (condition, code) => {
  if (condition) return condition;
  return getWeatherInfo(code).label;
};

/**
 * Get a color for temperature
 */
export const getTempColor = (tempF) => {
  if (tempF == null) return 'var(--text-muted)';
  if (tempF >= 90) return '#ef4444'; // Hot
  if (tempF >= 75) return '#f97316'; // Warm
  if (tempF >= 60) return '#f59e0b'; // Mild warm
  if (tempF >= 45) return '#3b82f6'; // Cool
  if (tempF >= 32) return '#6366f1'; // Cold
  return '#8b5cf6';                  // Freezing
};

/**
 * Get a precipitation descriptor
 */
export const getPrecipLabel = (mm) => {
  if (mm == null || mm === 0) return 'None';
  if (mm < 2.5) return 'Light';
  if (mm < 7.6) return 'Moderate';
  if (mm < 15)  return 'Heavy';
  return 'Very Heavy';
};

export default {
  getWeatherInfo,
  getConditionLabel,
  getTempColor,
  getPrecipLabel,
};
