/**
 * Sales predictions — Holt-Winters forecasting + factor explanations.
 *
 * Endpoints:
 *   predictionsDaily     — N-day forecast with DOW-factor adjustment
 *   predictionsResiduals — walk-forward validation: actual vs predicted on last N test days
 *   predictionsWeekly    — N-week forecast (period=4 for monthly seasonality)
 *   predictionsHourly    — break a single day's prediction into 24 hourly buckets
 *   predictionsMonthly   — multi-month with weather + holiday adjustments
 *   predictionsFactors   — per-day breakdown of which factors are driving the forecast
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';

import {
  getDailySales,
  getWeeklySales,
} from '../../services/salesService.js';

import {
  holtwinters,
  applyDOWFactors,
  buildPredictionTimeline,
  computeWeatherImpact,
  applyWeatherToPredictions,
  applyHolidayFactors,
  computeHourlyDistribution,
  breakIntoHourly,
  aggregateToMonthly,
} from '../../utils/predictions.js';

import {
  daysAgo,
  weeksAgo,
  today,
  userFor,
  detailedErrorMessage,
  type SalesEnvelope,
  type SalesEnvelopeRow,
} from './helpers.js';

// ─── Daily Predictions ────────────────────────────────────────────────────

export const predictionsDaily = async (req: Request, res: Response): Promise<void> => {
  try {
    const days = Number((req.query as { days?: string }).days) || 30;

    // Fetch last 90 days of daily sales history
    const from = daysAgo(90);
    const to = today();
    const rawData = (await getDailySales(userFor(req), req.storeId, from, to)) as unknown as SalesEnvelope;
    const series = (rawData.value || []).map((r) => Number(r.TotalNetSales) || 0);

    if (series.length < 7) {
      res.status(422).json({ error: 'Not enough historical data for prediction (need >= 7 days)' });
      return;
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
    let mape: number | null = null;
    if (series.length >= 14) {
      const last14 = series.slice(-14);
      const validateForecast = holtwinters(series.slice(0, -14), 7, 0.3, 0.1, 0.2, 14) as number[];
      const errors = last14.map((actual: number, i: number) =>
        actual !== 0 ? Math.abs((actual - validateForecast[i]) / actual) : 0,
      );
      mape = Math.round((errors.reduce((a: number, b: number) => a + b, 0) / errors.length) * 10000) / 100;
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
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};

// ─── Residual Analysis ────────────────────────────────────────────────────
/**
 * Walk-forward validation: for the last N test days, compare Holt-Winters
 * prediction (trained on all prior data) vs actual sales.
 * Returns per-day residuals + MAE, RMSE, MAPE, Bias summary stats.
 */
interface ResidualRow {
  date: string | undefined;
  dayOfWeek: string;
  actual: number;
  predicted: number;
  residual: number;
  pctError: number;
}

export const predictionsResiduals = async (req: Request, res: Response): Promise<void> => {
  try {
    const testDays = Math.min(Number((req.query as { testDays?: string }).testDays) || 30, 60);

    // Fetch enough history: test window + training buffer (min 90 days training)
    const totalDays = testDays + 90;
    const rawData = (await getDailySales(userFor(req), req.storeId, daysAgo(totalDays), today())) as unknown as SalesEnvelope;
    const rows: SalesEnvelopeRow[] = (rawData.value || []).filter((r) => r.Date && r.TotalNetSales != null);

    if (rows.length < testDays + 14) {
      res.status(422).json({
        error: `Not enough data — need at least ${testDays + 14} days of history.`,
      });
      return;
    }

    // Split: training = everything before the last testDays rows
    const trainRows = rows.slice(0, rows.length - testDays);
    const testRows  = rows.slice(-testDays);
    const trainSeries = trainRows.map((r) => Number(r.TotalNetSales) || 0);

    // Predict exactly testDays periods from end of training
    const raw = holtwinters(trainSeries, 7, 0.3, 0.1, 0.2, testDays) as number[];

    // Apply DOW factors — start date = date of first test row
    const startDate = (testRows[0].Date as string);
    const adjusted  = applyDOWFactors(raw, startDate + 'T00:00:00') as number[];

    // Build residuals array
    const residuals: ResidualRow[] = testRows.map((row, i) => {
      const actual    = Number(row.TotalNetSales) || 0;
      const predicted = Math.round(adjusted[i] * 100) / 100;
      const residual  = actual - predicted;                          // + = under-forecast
      const pctError  = actual !== 0 ? (Math.abs(residual) / actual) * 100 : 0;
      return {
        date:      row.Date,
        dayOfWeek: new Date((row.Date as string) + 'T12:00:00')
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
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};

// ─── Weekly Predictions ───────────────────────────────────────────────────

export const predictionsWeekly = async (req: Request, res: Response): Promise<void> => {
  try {
    const weeks = Number((req.query as { weeks?: string }).weeks) || 12;

    // Fetch last 52 weeks
    const from = weeksAgo(52);
    const to = today();
    const rawData = (await getWeeklySales(userFor(req), req.storeId, from, to)) as unknown as SalesEnvelope;
    const series = (rawData.value || []).map((r) => Number(r.TotalNetSales) || 0);

    if (series.length < 8) {
      res.status(422).json({ error: 'Not enough historical data for weekly prediction (need >= 8 weeks)' });
      return;
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
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};

// ─── Hourly Predictions ───────────────────────────────────────────────────

export const predictionsHourly = async (req: Request, res: Response): Promise<void> => {
  try {
    const targetDate = (req.query as { date?: string }).date || (() => {
      const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10);
    })();
    const orgId = req.orgId;
    const storeId = req.storeId || null;

    // Get daily prediction for that date first (reuse daily prediction logic)
    const from90 = daysAgo(90);
    const toStr = today();
    const rawData = (await getDailySales(userFor(req), req.storeId, from90, toStr)) as unknown as SalesEnvelope;
    const series = (rawData.value || []).map((r) => Number(r.TotalNetSales) || 0);

    if (series.length < 7) {
      res.status(422).json({ error: 'Not enough data for hourly prediction (need >= 7 days)' });
      return;
    }

    // Predict enough days to cover the target date
    const daysFromNow = Math.max(1, Math.ceil((new Date(targetDate).getTime() - new Date().getTime()) / 86400000) + 1);
    const rawForecast = holtwinters(series, 7, 0.3, 0.1, 0.2, Math.max(daysFromNow, 1)) as number[];
    const startDate = new Date(); startDate.setDate(startDate.getDate() + 1);
    const adjusted = applyDOWFactors(rawForecast, startDate) as number[];
    const dailyPrediction = adjusted[daysFromNow - 1] || adjusted[adjusted.length - 1] || 0;

    // Compute hourly distribution from recent 30 days of transactions
    const txWhere: Prisma.TransactionWhereInput = { orgId: orgId ?? undefined, status: 'complete', createdAt: { gte: new Date(from90 + 'T00:00:00') } };
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
    res.status(500).json({ error: (err as Error).message });
  }
};

// ─── Monthly Predictions ──────────────────────────────────────────────────

export const predictionsMonthly = async (req: Request, res: Response): Promise<void> => {
  try {
    const months = Number((req.query as { months?: string }).months) || 6;
    const daysNeeded = months * 31;

    const from = daysAgo(180);
    const to = today();
    const rawData = (await getDailySales(userFor(req), req.storeId, from, to)) as unknown as SalesEnvelope;
    const series = (rawData.value || []).map((r) => Number(r.TotalNetSales) || 0);

    if (series.length < 14) {
      res.status(422).json({ error: 'Not enough data for monthly prediction (need >= 14 days)' });
      return;
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
        const { getTenDayForecast } = await import('../../services/weatherService.js');
        const tenDay = await getTenDayForecast(store.latitude as unknown as number, store.longitude as unknown as number, store.timezone || 'America/New_York');

        // Build sales+weather history for regression
        const salesWithWeather = (rawData.value || []).map((r) => ({
          date: r.Date, sales: Number(r.TotalNetSales) || 0,
          tempMean: r.tempMean ?? null, precipitation: r.precipitation ?? null, weatherCode: r.weatherCode ?? null,
        }));
        const impact = computeWeatherImpact(salesWithWeather as unknown as Parameters<typeof computeWeatherImpact>[0]);
        timeline = applyWeatherToPredictions(timeline, tenDay, impact);
      } catch { /* weather enhancement failed, continue without */ }
    }

    const monthly = aggregateToMonthly(timeline);

    res.json({
      monthly,
      dailyDetail: (timeline as unknown[]).slice(0, 60), // first 60 days detail
      modelInfo: { type: 'Holt-Winters + Weather + Holiday', monthsForecasted: months },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ─── Factor Breakdown ─────────────────────────────────────────────────────

interface ForecastEntry {
  date: string;
  forecast?: number;
  factors?: Record<string, unknown>;
  [k: string]: unknown;
}

export const predictionsFactors = async (req: Request, res: Response): Promise<void> => {
  try {
    const days = Number((req.query as { days?: string }).days) || 30;
    const from = daysAgo(90);
    const to = today();
    const rawData = (await getDailySales(userFor(req), req.storeId, from, to)) as unknown as SalesEnvelope;
    const series = (rawData.value || []).map((r) => Number(r.TotalNetSales) || 0);

    if (series.length < 7) {
      res.status(422).json({ error: 'Not enough data' });
      return;
    }

    const rawForecast = holtwinters(series, 7, 0.3, 0.1, 0.2, days);
    const startDate = new Date(); startDate.setDate(startDate.getDate() + 1);
    const adjusted = applyDOWFactors(rawForecast, startDate);
    let timeline = buildPredictionTimeline(adjusted, startDate, 'daily') as unknown as ForecastEntry[];

    // Add factors
    timeline = timeline.map((p) => ({ ...p, factors: {} }));

    // Day-of-week factors
    const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const DOW_FACTORS = [1.15, 0.90, 0.88, 0.92, 1.00, 1.20, 1.30];
    timeline = timeline.map((p) => {
      const dow = new Date((p.date) + 'T12:00:00').getDay();
      return { ...p, factors: { ...(p.factors || {}), dayOfWeek: { label: DOW_NAMES[dow], impact: DOW_FACTORS[dow] - 1 } } };
    });

    // Holiday factors
    timeline = applyHolidayFactors(timeline) as unknown as ForecastEntry[];

    // Weather factors
    const store = req.storeId ? await prisma.store.findUnique({ where: { id: req.storeId }, select: { latitude: true, longitude: true, timezone: true } }) : null;
    if (store?.latitude && store?.longitude) {
      try {
        const { getTenDayForecast } = await import('../../services/weatherService.js');
        const tenDay = await getTenDayForecast(store.latitude as unknown as number, store.longitude as unknown as number, store.timezone || 'America/New_York');

        const salesWithWeather = (rawData.value || []).map((r) => ({
          date: r.Date, sales: Number(r.TotalNetSales) || 0,
          tempMean: r.tempMean ?? null, precipitation: r.precipitation ?? null, weatherCode: r.weatherCode ?? null,
        }));
        const impact = computeWeatherImpact(salesWithWeather as unknown as Parameters<typeof computeWeatherImpact>[0]);
        timeline = applyWeatherToPredictions(timeline, tenDay, impact) as unknown as ForecastEntry[];
      } catch { /* non-fatal */ }
    }

    res.json({ forecast: timeline, days });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};
