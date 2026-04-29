/**
 * weatherService.ts — backward-compat shim.
 *
 * Implementation lives in `./weather/weather.ts` (Session 55 service-layer
 * domain refactor). This file exists so existing imports keep working:
 *   import { fetchWeatherRange } from '../services/weatherService.js';
 *   const { getTenDayForecast } = await import('../services/weatherService.js');
 *
 * New code should prefer `./weather/weather.js` directly.
 */

export * from './weather/weather.js';
