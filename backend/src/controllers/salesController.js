/**
 * Sales Analytics Controller
 * Handles all /api/sales/* routes.
 */

import prisma from '../config/postgres.js';

import {
  getDailySales,
  getWeeklySales,
  getMonthlySales,
  getMonthlySalesComparison,
  getDepartmentSales,
  getDepartmentComparison,
  getTopProducts,
  getProductsGrouped,
  getProductMovement,
  getDailyProductMovement,
  getProduct52WeekStats,
} from '../services/salesService.js';

import {
  holtwinters,
  applyDOWFactors,
  buildPredictionTimeline,
  calculateVelocity,
  computeWeatherImpact,
  applyWeatherToPredictions,
  applyHolidayFactors,
  computeHourlyDistribution,
  breakIntoHourly,
  aggregateToMonthly,
} from '../utils/predictions.js';

import {
  fetchWeatherRange,
  getCurrentWeather,
  mergeSalesAndWeather,
  aggregateWeatherWeekly,
  aggregateWeatherMonthly,
  aggregateWeatherYearly,
} from '../services/weatherService.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const toISO = (d) => d.toISOString().slice(0, 10);

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISO(d);
};

const weeksAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return toISO(d);
};

const monthsAgo = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return toISO(d);
};

const yesterday = () => daysAgo(1);
const today = () => toISO(new Date());

// ─── Sales Summary ────────────────────────────────────────────────────────────

export const daily = async (req, res) => {
  try {
    const { from = daysAgo(30), to = today() } = req.query;
    const data = await getDailySales(req.posUser ?? req.user, req.storeId, from, to);
    res.json(data);
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

export const weekly = async (req, res) => {
  try {
    const { from = weeksAgo(12), to = today() } = req.query;
    const data = await getWeeklySales(req.posUser ?? req.user, req.storeId, from, to);
    res.json(data);
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

export const monthly = async (req, res) => {
  try {
    const { from = monthsAgo(24), to = today() } = req.query;
    const data = await getMonthlySales(req.posUser ?? req.user, req.storeId, from, to);
    res.json(data);
  } catch (err) {
    console.error('❌ Sales Controller Error [monthly]:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch monthly sales data' });
  }
};

export const monthlyComparison = async (req, res) => {
  try {
    const data = await getMonthlySalesComparison(req.posUser ?? req.user, req.storeId);
    res.json(data);
  } catch (err) {
    console.error('❌ Sales Controller Error [monthlyComparison]:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch monthly comparison data' });
  }
};

// ─── Departments ──────────────────────────────────────────────────────────────

export const departments = async (req, res) => {
  try {
    const { from = daysAgo(30), to = today() } = req.query;
    const data = await getDepartmentSales(req.posUser ?? req.user, req.storeId, from, to);
    res.json(data);
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

export const departmentComparison = async (req, res) => {
  try {
    const {
      from = daysAgo(30),
      to = today(),
      from2 = daysAgo(60),
      to2 = daysAgo(31),
    } = req.query;
    const data = await getDepartmentComparison(req.posUser ?? req.user, req.storeId, from, to, from2, to2);
    res.json(data);
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

// ─── Products ─────────────────────────────────────────────────────────────────

export const topProducts = async (req, res) => {
  try {
    const { date = yesterday() } = req.query;
    const data = await getTopProducts(req.posUser ?? req.user, req.storeId, date);
    res.json(data);
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

export const productsGrouped = async (req, res) => {
  try {
    const {
      from = daysAgo(30),
      to = today(),
      orderBy = 'NetSales',
      pageSize = 20,
      skip = 0,
    } = req.query;
    const data = await getProductsGrouped(req.posUser ?? req.user, req.storeId, from, to, orderBy, Number(pageSize), Number(skip));
    res.json(data);
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

export const productMovement = async (req, res) => {
  try {
    const {
      upc,
      dateStart = daysAgo(365),
      dateFinish = today(),
      weekly = false,
    } = req.query;
    if (!upc) return res.status(400).json({ error: 'upc is required' });
    const data = await getProductMovement(req.posUser ?? req.user, req.storeId, upc, dateStart, dateFinish, weekly === 'true');
    res.json(data);
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

export const dailyProductMovement = async (req, res) => {
  try {
    const { startDate = daysAgo(30), endDate = today() } = req.query;
    const data = await getDailyProductMovement(req.posUser ?? req.user, req.storeId, startDate, endDate);
    res.json(data);
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

export const product52WeekStats = async (req, res) => {
  try {
    const { upc } = req.query;
    if (!upc) return res.status(400).json({ error: 'upc is required' });
    const data = await getProduct52WeekStats(req.posUser ?? req.user, req.storeId, upc);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Predictions ──────────────────────────────────────────────────────────────

export const predictionsDaily = async (req, res) => {
  try {
    const days = Number(req.query.days) || 30;

    // Fetch last 90 days of daily sales history
    const from = daysAgo(90);
    const to = today();
    const rawData = await getDailySales(req.posUser ?? req.user, req.storeId, from, to);
    const series = (rawData.value || []).map((r) => r.TotalNetSales || 0);

    if (series.length < 7) {
      return res.status(422).json({ error: 'Not enough historical data for prediction (need >= 7 days)' });
    }

    // Run Holt-Winters with weekly seasonality
    const rawForecast = holtwinters(series, 7, 0.3, 0.1, 0.2, days);

    // Apply day-of-week factors
    const startForecastDate = new Date();
    startForecastDate.setDate(startForecastDate.getDate() + 1);
    const adjustedForecast = applyDOWFactors(rawForecast, startForecastDate);

    // Build annotated timeline
    const timeline = buildPredictionTimeline(adjustedForecast, startForecastDate, 'daily');

    // Calculate MAPE on last 14 days if available
    let mape = null;
    if (series.length >= 14) {
      const last14 = series.slice(-14);
      const validateForecast = holtwinters(series.slice(0, -14), 7, 0.3, 0.1, 0.2, 14);
      const errors = last14.map((actual, i) =>
        actual !== 0 ? Math.abs((actual - validateForecast[i]) / actual) : 0
      );
      mape = Math.round((errors.reduce((a, b) => a + b, 0) / errors.length) * 10000) / 100;
    }

    res.json({
      forecast: timeline,
      historicalSeries: rawData.value || [],
      mape,
      modelInfo: {
        type: 'Holt-Winters Triple Exponential Smoothing',
        period: 7,
        alpha: 0.3,
        beta: 0.1,
        gamma: 0.2,
        dowFactorsApplied: true,
      },
    });
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

// ─── Residual Analysis ────────────────────────────────────────────────────────
/**
 * GET /api/sales/predictions/residuals
 * Walk-forward validation: for the last N test days, compare Holt-Winters
 * prediction (trained on all prior data) vs actual sales.
 * Returns per-day residuals + MAE, RMSE, MAPE, Bias summary stats.
 */
export const predictionsResiduals = async (req, res) => {
  try {
    const testDays = Math.min(Number(req.query.testDays) || 30, 60);

    // Fetch enough history: test window + training buffer (min 90 days training)
    const totalDays = testDays + 90;
    const rawData = await getDailySales(req.posUser ?? req.user, req.storeId, daysAgo(totalDays), today());
    const rows = (rawData.value || []).filter((r) => r.Date && r.TotalNetSales != null);

    if (rows.length < testDays + 14) {
      return res.status(422).json({
        error: `Not enough data — need at least ${testDays + 14} days of history.`,
      });
    }

    // Split: training = everything before the last testDays rows
    const trainRows = rows.slice(0, rows.length - testDays);
    const testRows  = rows.slice(-testDays);
    const trainSeries = trainRows.map((r) => r.TotalNetSales || 0);

    // Predict exactly testDays periods from end of training
    const raw = holtwinters(trainSeries, 7, 0.3, 0.1, 0.2, testDays);

    // Apply DOW factors — start date = date of first test row
    const startDate = testRows[0].Date;
    const adjusted  = applyDOWFactors(raw, startDate + 'T00:00:00');

    // Build residuals array
    const residuals = testRows.map((row, i) => {
      const actual    = row.TotalNetSales || 0;
      const predicted = Math.round(adjusted[i] * 100) / 100;
      const residual  = actual - predicted;                          // + = under-forecast
      const pctError  = actual !== 0 ? (Math.abs(residual) / actual) * 100 : 0;
      return {
        date:      row.Date,
        dayOfWeek: new Date(row.Date + 'T12:00:00')
          .toLocaleDateString('en-US', { weekday: 'short' }),
        actual:    Math.round(actual * 100) / 100,
        predicted,
        residual:  Math.round(residual * 100) / 100,
        pctError:  Math.round(pctError * 100) / 100,
      };
    });

    // Summary statistics
    const n    = residuals.length;
    const mae  = residuals.reduce((s, r) => s + Math.abs(r.residual), 0) / n;
    const mape = residuals.reduce((s, r) => s + r.pctError, 0) / n;
    const rmse = Math.sqrt(residuals.reduce((s, r) => s + r.residual ** 2, 0) / n);
    const bias = residuals.reduce((s, r) => s + r.residual, 0) / n; // + = we under-forecast

    // Error distribution buckets
    const within5  = residuals.filter((r) => r.pctError <= 5).length;
    const within10 = residuals.filter((r) => r.pctError <= 10).length;
    const within15 = residuals.filter((r) => r.pctError <= 15).length;
    const within20 = residuals.filter((r) => r.pctError <= 20).length;

    res.json({
      residuals,
      stats: {
        mae:   Math.round(mae * 100) / 100,
        mape:  Math.round(mape * 100) / 100,
        rmse:  Math.round(rmse * 100) / 100,
        bias:  Math.round(bias * 100) / 100,
        n,
        trainSize: trainRows.length,
        testSize:  testRows.length,
      },
      errorDistribution: {
        within5:  Math.round((within5  / n) * 100),
        within10: Math.round((within10 / n) * 100),
        within15: Math.round((within15 / n) * 100),
        within20: Math.round((within20 / n) * 100),
      },
      modelInfo: { alpha: 0.3, beta: 0.1, gamma: 0.2, period: 7, dowFactorsApplied: true },
    });
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

export const predictionsWeekly = async (req, res) => {
  try {
    const weeks = Number(req.query.weeks) || 12;

    // Fetch last 52 weeks
    const from = weeksAgo(52);
    const to = today();
    const rawData = await getWeeklySales(req.posUser ?? req.user, req.storeId, from, to);
    const series = (rawData.value || []).map((r) => r.TotalNetSales || 0);

    if (series.length < 8) {
      return res.status(422).json({ error: 'Not enough historical data for weekly prediction (need >= 8 weeks)' });
    }

    const rawForecast = holtwinters(series, 4, 0.3, 0.1, 0.2, weeks);

    const startForecastDate = new Date();
    startForecastDate.setDate(startForecastDate.getDate() + 7);
    const timeline = buildPredictionTimeline(rawForecast, startForecastDate, 'weekly');

    res.json({
      forecast: timeline,
      historicalSeries: rawData.value || [],
      modelInfo: {
        type: 'Holt-Winters Triple Exponential Smoothing',
        period: 4,
        alpha: 0.3,
        beta: 0.1,
        gamma: 0.2,
      },
    });
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

// ─── Enhanced Predictions: Hourly ────────────────────────────────────────────

export const predictionsHourly = async (req, res) => {
  try {
    const targetDate = req.query.date || (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
    const orgId = req.orgId;
    const storeId = req.storeId || null;

    // Get daily prediction for that date first (reuse daily prediction logic)
    const from90 = daysAgo(90);
    const toStr = today();
    const rawData = await getDailySales(req.posUser ?? req.user, req.storeId, from90, toStr);
    const series = (rawData.value || []).map(r => r.TotalNetSales || 0);

    if (series.length < 7) {
      return res.status(422).json({ error: 'Not enough data for hourly prediction (need >= 7 days)' });
    }

    // Predict enough days to cover the target date
    const daysFromNow = Math.max(1, Math.ceil((new Date(targetDate) - new Date()) / 86400000) + 1);
    const rawForecast = holtwinters(series, 7, 0.3, 0.1, 0.2, Math.max(daysFromNow, 1));
    const startDate = new Date(); startDate.setDate(startDate.getDate() + 1);
    const adjusted = applyDOWFactors(rawForecast, startDate);
    const dailyPrediction = adjusted[daysFromNow - 1] || adjusted[adjusted.length - 1] || 0;

    // Compute hourly distribution from recent 30 days of transactions
    const txWhere = { orgId, status: 'complete', createdAt: { gte: new Date(from90 + 'T00:00:00') } };
    if (storeId) txWhere.storeId = storeId;
    const recentTxns = await prisma.transaction.findMany({
      where: txWhere,
      select: { createdAt: true, grandTotal: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const distribution = computeHourlyDistribution(recentTxns);
    const hourly = breakIntoHourly(dailyPrediction, distribution);

    res.json({
      date: targetDate,
      dayOfWeek: new Date(targetDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }),
      dailyPrediction: Math.round(dailyPrediction * 100) / 100,
      hourly,
      distribution,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Enhanced Predictions: Monthly ───────────────────────────────────────────

export const predictionsMonthly = async (req, res) => {
  try {
    const months = Number(req.query.months) || 6;
    const daysNeeded = months * 31;

    const from = daysAgo(180);
    const to = today();
    const rawData = await getDailySales(req.posUser ?? req.user, req.storeId, from, to);
    const series = (rawData.value || []).map(r => r.TotalNetSales || 0);

    if (series.length < 14) {
      return res.status(422).json({ error: 'Not enough data for monthly prediction (need >= 14 days)' });
    }

    const rawForecast = holtwinters(series, 7, 0.3, 0.1, 0.2, daysNeeded);
    const startDate = new Date(); startDate.setDate(startDate.getDate() + 1);
    const adjusted = applyDOWFactors(rawForecast, startDate);
    let timeline = buildPredictionTimeline(adjusted, startDate, 'daily');
    timeline = applyHolidayFactors(timeline);

    // Weather: try to get 10-day forecast for near-term adjustments
    const store = req.storeId ? await prisma.store.findUnique({ where: { id: req.storeId }, select: { latitude: true, longitude: true, timezone: true } }) : null;
    if (store?.latitude && store?.longitude) {
      try {
        const { getTenDayForecast } = await import('../services/weatherService.js');
        const tenDay = await getTenDayForecast(store.latitude, store.longitude, store.timezone || 'America/New_York');

        // Build sales+weather history for regression
        const salesWithWeather = (rawData.value || []).map(r => ({
          date: r.Date, sales: r.TotalNetSales || 0,
          tempMean: r.tempMean ?? null, precipitation: r.precipitation ?? null, weatherCode: r.weatherCode ?? null,
        }));
        const impact = computeWeatherImpact(salesWithWeather);
        timeline = applyWeatherToPredictions(timeline, tenDay, impact);
      } catch { /* weather enhancement failed, continue without */ }
    }

    const monthly = aggregateToMonthly(timeline);

    res.json({
      monthly,
      dailyDetail: timeline.slice(0, 60), // first 60 days detail
      modelInfo: { type: 'Holt-Winters + Weather + Holiday', monthsForecasted: months },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Enhanced Predictions: Factors (what's influencing each day) ─────────────

export const predictionsFactors = async (req, res) => {
  try {
    const days = Number(req.query.days) || 30;
    const from = daysAgo(90);
    const to = today();
    const rawData = await getDailySales(req.posUser ?? req.user, req.storeId, from, to);
    const series = (rawData.value || []).map(r => r.TotalNetSales || 0);

    if (series.length < 7) {
      return res.status(422).json({ error: 'Not enough data' });
    }

    const rawForecast = holtwinters(series, 7, 0.3, 0.1, 0.2, days);
    const startDate = new Date(); startDate.setDate(startDate.getDate() + 1);
    const adjusted = applyDOWFactors(rawForecast, startDate);
    let timeline = buildPredictionTimeline(adjusted, startDate, 'daily');

    // Add factors
    timeline = timeline.map(p => ({ ...p, factors: {} }));

    // Day-of-week factors
    const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const DOW_FACTORS = [1.15, 0.90, 0.88, 0.92, 1.00, 1.20, 1.30];
    timeline = timeline.map(p => {
      const dow = new Date(p.date + 'T12:00:00').getDay();
      return { ...p, factors: { ...p.factors, dayOfWeek: { label: DOW_NAMES[dow], impact: DOW_FACTORS[dow] - 1 } } };
    });

    // Holiday factors
    timeline = applyHolidayFactors(timeline);

    // Weather factors
    const store = req.storeId ? await prisma.store.findUnique({ where: { id: req.storeId }, select: { latitude: true, longitude: true, timezone: true } }) : null;
    if (store?.latitude && store?.longitude) {
      try {
        const { getTenDayForecast, fetchWeatherRange: fetchWR } = await import('../services/weatherService.js');
        const tenDay = await getTenDayForecast(store.latitude, store.longitude, store.timezone || 'America/New_York');

        const salesWithWeather = (rawData.value || []).map(r => ({
          date: r.Date, sales: r.TotalNetSales || 0,
          tempMean: r.tempMean ?? null, precipitation: r.precipitation ?? null, weatherCode: r.weatherCode ?? null,
        }));
        const impact = computeWeatherImpact(salesWithWeather);
        timeline = applyWeatherToPredictions(timeline, tenDay, impact);
      } catch { /* non-fatal */ }
    }

    res.json({ forecast: timeline, days });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Sales + Weather Combined ────────────────────────────────────────────────

export const dailyWithWeather = async (req, res) => {
  try {
    const { from = daysAgo(30), to = today() } = req.query;
    const salesData = await getDailySales(req.posUser ?? req.user, req.storeId, from, to);
    const salesRows = salesData.value || [];

    // Fetch weather if user has location set
    let weather = [];
    if (req.user?.storeLatitude && req.user?.storeLongitude) {
      weather = await fetchWeatherRange(
        req.user.storeLatitude,
        req.user.storeLongitude,
        from,
        to,
        req.user.storeTimezone || 'America/New_York',
      );
    }

    const merged = mergeSalesAndWeather(salesRows, weather);

    res.json({
      ...salesData,                         // preserves @odata.aggregation + @odata.count
      value: merged,
      weather,
      weatherEnabled: !!(req.user?.storeLatitude && req.user?.storeLongitude),
    });
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

export const weeklyWithWeather = async (req, res) => {
  try {
    const { from = weeksAgo(12), to = today() } = req.query;
    const salesData = await getWeeklySales(req.posUser ?? req.user, req.storeId, from, to);

    let weather = [];
    let weeklyWeather = [];
    if (req.user?.storeLatitude && req.user?.storeLongitude) {
      weather = await fetchWeatherRange(
        req.user.storeLatitude,
        req.user.storeLongitude,
        from,
        to,
        req.user.storeTimezone || 'America/New_York',
      );
      weeklyWeather = aggregateWeatherWeekly(weather);
    }

    // Merge weekly sales with weekly weather by matching week start dates
    const salesRows = salesData.value || [];
    const mergedRows = salesRows.map((sale) => {
      const saleDate = sale.Date ? sale.Date.slice(0, 10) : '';
      // Find the closest weekly weather bucket
      const ww = weeklyWeather.find((w) => {
        return saleDate >= w.weekStart && saleDate <= w.weekEnd;
      });
      return {
        ...sale,
        tempHigh:      ww?.avgTempMax    ?? null,
        tempLow:       ww?.avgTempMin    ?? null,
        tempMean:      ww?.avgTempMean   ?? null,
        precipitation: ww?.totalPrecipitation ?? null,
        condition:     ww?.dominantCondition  ?? null,
        weekStart:     ww?.weekStart     ?? null,
        weekEnd:       ww?.weekEnd       ?? null,
        dailyWeather:  ww?.dailyBreakdown ?? [],
      };
    });

    res.json({
      ...salesData,
      value: mergedRows,
      weeklyWeather,
      weatherEnabled: !!(req.user?.storeLatitude && req.user?.storeLongitude),
    });
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

export const monthlyWithWeather = async (req, res) => {
  try {
    const { from = monthsAgo(24), to = today() } = req.query;
    const salesData = await getMonthlySales(req.posUser ?? req.user, req.storeId, from, to);

    let weather = [];
    let monthlyWeather = [];
    if (req.user?.storeLatitude && req.user?.storeLongitude) {
      weather = await fetchWeatherRange(
        req.user.storeLatitude,
        req.user.storeLongitude,
        from,
        to,
        req.user.storeTimezone || 'America/New_York',
      );
      monthlyWeather = aggregateWeatherMonthly(weather);
    }

    const salesRows = salesData.value || [];
    const mergedRows = salesRows.map((sale) => {
      const saleMonth = sale.Date ? sale.Date.slice(0, 7) : '';
      const mw = monthlyWeather.find((m) => m.month === saleMonth);
      return {
        ...sale,
        tempHigh:      mw?.avgTempMax         ?? null,
        tempLow:       mw?.avgTempMin         ?? null,
        tempMean:      mw?.avgTempMean        ?? null,
        precipitation: mw?.totalPrecipitation ?? null,
        condition:     mw?.dominantCondition  ?? null,
      };
    });

    res.json({
      ...salesData,
      value: mergedRows,
      monthlyWeather,
      weatherEnabled: !!(req.user?.storeLatitude && req.user?.storeLongitude),
    });
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

export const yearlyWithWeather = async (req, res) => {
  try {
    const { from = monthsAgo(60), to = today() } = req.query;
    // Use monthly data and aggregate to yearly
    const salesData = await getMonthlySales(req.posUser ?? req.user, req.storeId, from, to);
    const monthlyRows = salesData.value || [];

    // Aggregate monthly sales into yearly
    const yearlyMap = {};
    for (const row of monthlyRows) {
      const year = row.Date ? row.Date.slice(0, 4) : '';
      if (!year) continue;
      if (!yearlyMap[year]) {
        yearlyMap[year] = {
          Date: `${year}-01-01`,
          Year: year,
          TotalGrossSales: 0,
          TotalNetSales: 0,
          TotalTransactionsCount: 0,
          TotalDiscounts: 0,
          TotalRefunds: 0,
          TotalTaxes: 0,
          TotalTotalCollected: 0,
          monthCount: 0,
        };
      }
      const y = yearlyMap[year];
      y.TotalGrossSales += row.TotalGrossSales || 0;
      y.TotalNetSales += row.TotalNetSales || 0;
      y.TotalTransactionsCount += row.TotalTransactionsCount || 0;
      y.TotalDiscounts += row.TotalDiscounts || 0;
      y.TotalRefunds += row.TotalRefunds || 0;
      y.TotalTaxes += row.TotalTaxes || 0;
      y.TotalTotalCollected += row.TotalTotalCollected || 0;
      y.monthCount++;
    }

    const yearlySales = Object.values(yearlyMap).sort((a, b) => a.Year.localeCompare(b.Year));

    // Yearly weather
    let yearlyWeather = [];
    if (req.user?.storeLatitude && req.user?.storeLongitude) {
      const weather = await fetchWeatherRange(
        req.user.storeLatitude,
        req.user.storeLongitude,
        from,
        to,
        req.user.storeTimezone || 'America/New_York',
      );
      yearlyWeather = aggregateWeatherYearly(weather);
    }

    const mergedRows = yearlySales.map((sale) => {
      const yw = yearlyWeather.find((y) => y.year === sale.Year);
      return {
        ...sale,
        tempHigh:      yw?.avgTempMax         ?? null,
        tempLow:       yw?.avgTempMin         ?? null,
        tempMean:      yw?.avgTempMean        ?? null,
        precipitation: yw?.totalPrecipitation ?? null,
        condition:     yw?.dominantCondition  ?? null,
      };
    });

    // Compute aggregation
    const agg = {
      TotalGrossSales: yearlySales.reduce((s, r) => s + r.TotalGrossSales, 0),
      TotalNetSales: yearlySales.reduce((s, r) => s + r.TotalNetSales, 0),
      TotalTransactionsCount: yearlySales.reduce((s, r) => s + r.TotalTransactionsCount, 0),
      TotalDiscounts: yearlySales.reduce((s, r) => s + r.TotalDiscounts, 0),
      TotalRefunds: yearlySales.reduce((s, r) => s + r.TotalRefunds, 0),
      TotalTaxes: yearlySales.reduce((s, r) => s + r.TotalTaxes, 0),
      TotalTotalCollected: yearlySales.reduce((s, r) => s + r.TotalTotalCollected, 0),
    };

    res.json({
      value: mergedRows,
      '@odata.aggregation': agg,
      yearlyWeather,
      weatherEnabled: !!(req.user?.storeLatitude && req.user?.storeLongitude),
    });
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};

export const realtimeSales = async (req, res) => {
  try {
    const orgId   = req.orgId;
    const storeId = req.storeId || null;

    // ── Date: support ?date=YYYY-MM-DD for historical, default to today ─────
    const now      = new Date();
    const nowStr   = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const todayStr = req.query.date || nowStr;
    const isToday  = todayStr === nowStr;
    const todayStart = new Date(`${todayStr}T00:00:00`);
    const todayEnd   = new Date(`${todayStr}T23:59:59.999`);

    // ── Fetch today's completed transactions ──────────────────────────────────
    const todayWhere = {
      orgId,
      status: 'complete',
      createdAt: { gte: todayStart, lte: todayEnd },
    };
    if (storeId) todayWhere.storeId = storeId;

    const txns = await prisma.transaction.findMany({
      where: todayWhere,
      select: {
        id: true,
        txNumber: true,
        grandTotal: true,
        subtotal: true,
        taxTotal: true,
        depositTotal: true,
        ebtTotal: true,
        tenderLines: true,
        lineItems: true,
        createdAt: true,
        stationId: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // ── Aggregate totals ──────────────────────────────────────────────────────
    let netSales = 0, taxTotal = 0, depositTotal = 0, ebtTotal = 0;
    let cashTotal = 0, cardTotal = 0, ebtTender = 0;
    let totalCost = 0, totalRevenue = 0;
    const productMap = {};
    const hourlyMap  = {};

    for (const tx of txns) {
      const gt = Number(tx.grandTotal)   || 0;
      const tt = Number(tx.taxTotal)     || 0;
      const dt = Number(tx.depositTotal) || 0;
      const et = Number(tx.ebtTotal)     || 0;

      netSales     += gt;
      taxTotal     += tt;
      depositTotal += dt;
      ebtTotal     += et;

      // Tender breakdown
      const tenders = Array.isArray(tx.tenderLines) ? tx.tenderLines : [];
      for (const t of tenders) {
        const amt = Number(t.amount) || 0;
        const m   = (t.method || '').toLowerCase();
        if (m === 'cash')                          cashTotal  += amt;
        else if (['card','credit','debit'].includes(m)) cardTotal  += amt;
        else if (m === 'ebt')                      ebtTender  += amt;
      }

      // Top products from lineItems + cost tracking for margin
      const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
      for (const li of items) {
        if (!li.name || li.isLottery || li.isBottleReturn || li.isBagFee) continue;
        const key = li.name;
        const rev = Number(li.totalPrice ?? li.lineTotal ?? 0);
        const cost = (Number(li.costPrice) || Number(li.unitPrice) * 0.65) * (Number(li.qty) || 1);
        if (!productMap[key]) productMap[key] = { name: key, qty: 0, revenue: 0, cost: 0 };
        productMap[key].qty     += Number(li.qty || 1);
        productMap[key].revenue += rev;
        productMap[key].cost    += cost;
        totalRevenue += rev;
        totalCost    += cost;
      }

      // Hourly buckets
      const h = new Date(tx.createdAt).getHours();
      if (!hourlyMap[h]) hourlyMap[h] = { sales: 0, count: 0 };
      hourlyMap[h].sales += gt;
      hourlyMap[h].count += 1;
    }

    const txCount = txns.length;
    const avgTx   = txCount ? netSales / txCount : 0;

    // Hourly array covering store hours (6 AM – 11 PM)
    const hourly = Array.from({ length: 24 }, (_, h) => {
      const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
      return { hour: h, label, sales: hourlyMap[h]?.sales ?? 0, count: hourlyMap[h]?.count ?? 0 };
    });

    // Top 8 products by revenue
    const topProducts = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    // Recent 15 transactions for live feed
    const recentTx = txns.slice(0, 15).map(tx => ({
      id:         tx.id,
      txNumber:   tx.txNumber,
      grandTotal: Number(tx.grandTotal),
      createdAt:  tx.createdAt,
      tenderLines: tx.tenderLines,
      stationId:  tx.stationId,
    }));

    // ── Today's lottery ───────────────────────────────────────────────────────
    const lotteryWhere = {
      orgId,
      createdAt: { gte: todayStart, lte: todayEnd },
    };
    if (storeId) lotteryWhere.storeId = storeId;

    const [lotteryTxns, lotterySettings, activeBoxes] = await Promise.all([
      prisma.lotteryTransaction.findMany({
        where: lotteryWhere,
        select: { type: true, amount: true, ticketCount: true, gameId: true },
      }),
      storeId
        ? prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null)
        : Promise.resolve(null),
      prisma.lotteryBox.count({
        where: { orgId, ...(storeId ? { storeId } : {}), status: 'active' },
      }),
    ]);

    let lotterySales = 0, lotteryPayouts = 0, lotteryTickets = 0;
    const gameMap = {};
    for (const lt of lotteryTxns) {
      const amt = Number(lt.amount) || 0;
      if (lt.type === 'sale') {
        lotterySales   += amt;
        lotteryTickets += lt.ticketCount || 0;
        if (lt.gameId) {
          if (!gameMap[lt.gameId]) gameMap[lt.gameId] = { gameId: lt.gameId, sales: 0, payouts: 0 };
          gameMap[lt.gameId].sales += amt;
        }
      } else if (lt.type === 'payout') {
        lotteryPayouts += amt;
        if (lt.gameId) {
          if (!gameMap[lt.gameId]) gameMap[lt.gameId] = { gameId: lt.gameId, sales: 0, payouts: 0 };
          gameMap[lt.gameId].payouts += amt;
        }
      }
    }

    const commissionRate = lotterySettings?.commissionRate ? Number(lotterySettings.commissionRate) : 0.05;
    const lotteryNet        = lotterySales - lotteryPayouts;
    const lotteryCommission = lotterySales * commissionRate;

    const lottery = {
      sales:      lotterySales,
      payouts:    lotteryPayouts,
      net:        lotteryNet,
      tickets:    lotteryTickets,
      commission: lotteryCommission,
      commissionRate,
      activeBoxes,
      txCount:    lotteryTxns.filter(t => t.type === 'sale').length,
      payoutCount:lotteryTxns.filter(t => t.type === 'payout').length,
    };

    // ── 14-day trend ──────────────────────────────────────────────────────────
    const from14 = new Date();
    from14.setDate(from14.getDate() - 13);
    const from14Str = toISO(from14);

    const trendWhere = {
      orgId,
      status: 'complete',
      createdAt: { gte: new Date(`${from14Str}T00:00:00`) },
    };
    if (storeId) trendWhere.storeId = storeId;

    const allTxns = await prisma.transaction.findMany({
      where: trendWhere,
      select: { grandTotal: true, createdAt: true },
    });

    // Group by local date
    const dateMap = {};
    for (const tx of allTxns) {
      const d = new Date(tx.createdAt);
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (!dateMap[ds]) dateMap[ds] = { date: ds, netSales: 0, txCount: 0 };
      dateMap[ds].netSales += Number(tx.grandTotal) || 0;
      dateMap[ds].txCount  += 1;
    }

    const trend = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      trend.push(dateMap[ds] || { date: ds, netSales: 0, txCount: 0 });
    }

    // ── Margin calculation ──────────────────────────────────────────────────────
    const grossProfit  = totalRevenue - totalCost;
    const avgMargin    = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 10000) / 100 : 0;

    // ── Inventory grade (non-blocking) ───────────────────────────────────────
    let inventoryGrade = null;
    try {
      const invWhere = { orgId, active: true, deleted: false, trackInventory: true };
      const [totalProducts, storeProducts] = await Promise.all([
        prisma.masterProduct.count({ where: invWhere }),
        prisma.storeProduct.findMany({
          where: { orgId, ...(storeId ? { storeId } : {}) },
          select: { quantityOnHand: true },
        }),
      ]);
      const inStock = storeProducts.filter(sp => Number(sp.quantityOnHand) > 0).length;
      const outOfStock = storeProducts.filter(sp => Number(sp.quantityOnHand) <= 0).length;
      const fillRate = storeProducts.length > 0 ? Math.round((inStock / storeProducts.length) * 100) : 0;
      // Grade: A (95%+), B (85-94%), C (70-84%), D (50-69%), F (<50%)
      const grade = fillRate >= 95 ? 'A' : fillRate >= 85 ? 'B' : fillRate >= 70 ? 'C' : fillRate >= 50 ? 'D' : 'F';
      inventoryGrade = { grade, fillRate, inStock, outOfStock, totalTracked: storeProducts.length };
    } catch { /* non-fatal */ }

    // ── Weather data (non-blocking — don't fail if weather is unavailable) ────
    let weather = null;
    try {
      const store = storeId ? await prisma.store.findUnique({ where: { id: storeId }, select: { latitude: true, longitude: true, timezone: true } }) : null;
      if (store?.latitude && store?.longitude) {
        const tz = store.timezone || 'America/New_York';
        const { getCurrentWeather, getHourlyForecast, getTenDayForecast, fetchWeatherRange } = await import('../services/weatherService.js');

        if (isToday) {
          // Live weather: current + hourly + 10-day
          const [current, hourlyForecast, tenDay] = await Promise.all([
            getCurrentWeather(store.latitude, store.longitude, tz),
            getHourlyForecast(store.latitude, store.longitude, tz),
            getTenDayForecast(store.latitude, store.longitude, tz),
          ]);
          weather = { current: current?.current || null, hourly: hourlyForecast, tenDay, historical: null };
        } else {
          // Historical date: pull cached/archive weather for that day
          const dayWeather = await fetchWeatherRange(store.latitude, store.longitude, todayStr, todayStr, tz);
          weather = { current: null, hourly: [], tenDay: [], historical: dayWeather?.[0] || null };
        }
      }
    } catch (wErr) {
      console.warn('⚠ Weather fetch for dashboard failed (non-fatal):', wErr.message);
    }

    res.json({
      todaySales: { netSales, grossSales: netSales, txCount, avgTx, taxTotal, depositTotal, ebtTotal, cashTotal, cardTotal, ebtTender, avgMargin, grossProfit: Math.round(grossProfit * 100) / 100 },
      inventoryGrade,
      lottery,
      hourly,
      topProducts,
      recentTx,
      trend,
      weather,
      isToday,
      dataDate: todayStr,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[realtimeSales]', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── Vendor Orders ────────────────────────────────────────────────────────────

export const vendorOrders = async (req, res) => {
  try {
    const startDate = daysAgo(60);
    const endDate = today();

    const rawMovement = await getDailyProductMovement(req.posUser ?? req.user, req.storeId, startDate, endDate);

    // Group by UPC
    const byUpc = {};
    for (const row of rawMovement) {
      const upc = row.Upc;
      if (!byUpc[upc]) {
        byUpc[upc] = {
          upc,
          description: row.Description || upc,
          department: row.Department || '',
          dailyQty: [],
          dailyRevenue: [],
          qtyOnHand: row.QuantityOnHand ?? null,
        };
      }
      byUpc[upc].dailyQty.push(row.QuantitySold || 0);
      byUpc[upc].dailyRevenue.push(row.Revenue || 0);
      // keep most recent QoH
      if (row.QuantityOnHand !== undefined && row.QuantityOnHand !== null) {
        byUpc[upc].qtyOnHand = row.QuantityOnHand;
      }
    }

    // Aggregate into weekly buckets and compute velocity
    const results = Object.values(byUpc).map((item) => {
      const { dailyQty, dailyRevenue } = item;

      // Sum last 30 days
      const last30days = dailyQty.slice(-30);
      const sales30 = last30days.reduce((a, b) => a + b, 0);
      const revenue30 = dailyRevenue.slice(-30).reduce((a, b) => a + b, 0);

      // Build weekly buckets (7-day chunks from the end)
      const weeklyQty = [];
      for (let w = 0; w < Math.min(8, Math.floor(dailyQty.length / 7)); w++) {
        const start = dailyQty.length - (w + 1) * 7;
        const end = dailyQty.length - w * 7;
        weeklyQty.unshift(dailyQty.slice(start, end).reduce((a, b) => a + b, 0));
      }

      const velocity = calculateVelocity(weeklyQty);

      return {
        upc: item.upc,
        description: item.description,
        department: item.department,
        qtyOnHand: item.qtyOnHand,
        sales30,
        revenue30: Math.round(revenue30 * 100) / 100,
        avgWeeklySales: velocity.avgWeekly,
        velocityTrend: velocity.trend,
        recommendation: velocity.recommendation,
        weeklyHistory: weeklyQty,
      };
    });

    // Sort: reorder first, then ok, then overstock
    const priority = { reorder: 0, ok: 1, overstock: 2 };
    results.sort((a, b) => (priority[a.recommendation] ?? 1) - (priority[b.recommendation] ?? 1));

    res.json({
      analysisWindow: { startDate, endDate },
      products: results,
      summary: {
        total: results.length,
        reorder: results.filter((r) => r.recommendation === 'reorder').length,
        ok: results.filter((r) => r.recommendation === 'ok').length,
        overstock: results.filter((r) => r.recommendation === 'overstock').length,
      },
    });
  } catch (err) {
    const detailedError = err.response?.data?.message || err.response?.data?.Message || err.message;
    res.status(500).json({ error: detailedError });
  }
};
