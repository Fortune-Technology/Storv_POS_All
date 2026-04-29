/**
 * Weather — Open-Meteo client + cache.
 *
 *   weather.ts — fetchWeatherRange (historical + forecast with PG cache),
 *                getCurrentWeather, getHourlyForecast (48h), getTenDayForecast,
 *                aggregateWeatherWeekly/Monthly/Yearly, mergeSalesAndWeather,
 *                WMO weathercode → human label mapping.
 *
 * Consumers:
 *   • controllers/sales/weather.ts  — sales × weather joined endpoints
 *   • controllers/sales/realtime.ts — Live Dashboard current/forecast/historical
 *   • controllers/weatherController.ts — /api/weather public endpoints
 *   • services/inventory/orderEngine.ts (dynamic) — weather-impact regression
 *
 * Provider: Open-Meteo (no API key). 2-decimal-rounded lat/lng cache key.
 */

export * from './weather.js';
