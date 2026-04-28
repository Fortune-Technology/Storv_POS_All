/**
 * Sales-with-weather endpoints — daily / weekly / monthly / yearly variants
 * that join sales aggregations with cached weather data for the store's
 * lat/lng. Weather is fetched lazily — when a store has no coordinates set,
 * the response falls back to plain sales data with `weatherEnabled: false`.
 */

import type { Request, Response } from 'express';

import {
  getDailySales,
  getWeeklySales,
  getMonthlySales,
} from '../../services/salesService.js';

import {
  fetchWeatherRange,
  mergeSalesAndWeather,
  aggregateWeatherWeekly,
  aggregateWeatherMonthly,
  aggregateWeatherYearly,
} from '../../services/weatherService.js';

import {
  daysAgo,
  weeksAgo,
  monthsAgo,
  today,
  userFor,
  userWithLatLng,
  detailedErrorMessage,
  type SalesEnvelope,
} from './helpers.js';

// ─── Daily + Weather ──────────────────────────────────────────────────────

export const dailyWithWeather = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as { from?: string; to?: string };
    const from = q.from || daysAgo(30);
    const to = q.to || today();
    const salesData = (await getDailySales(userFor(req), req.storeId, from, to)) as unknown as SalesEnvelope;
    const salesRows = salesData.value || [];

    // Fetch weather if user has location set
    const u = userWithLatLng(req);
    let weather: unknown[] = [];
    if (u.storeLatitude && u.storeLongitude) {
      weather = await fetchWeatherRange(
        u.storeLatitude,
        u.storeLongitude,
        from,
        to,
        u.storeTimezone || 'America/New_York',
      );
    }

    const merged = mergeSalesAndWeather(salesRows, weather as Parameters<typeof mergeSalesAndWeather>[1]);

    res.json({
      ...salesData,                         // preserves @odata.aggregation + @odata.count
      value: merged,
      weather,
      weatherEnabled: !!(u.storeLatitude && u.storeLongitude),
    });
  } catch (err) {
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};

interface WeeklyWeatherBucket {
  weekStart?: string;
  weekEnd?: string;
  avgTempMax?: number | null;
  avgTempMin?: number | null;
  avgTempMean?: number | null;
  totalPrecipitation?: number | null;
  dominantCondition?: string | null;
  dailyBreakdown?: unknown[];
}

// ─── Weekly + Weather ─────────────────────────────────────────────────────

export const weeklyWithWeather = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as { from?: string; to?: string };
    const from = q.from || weeksAgo(12);
    const to = q.to || today();
    const salesData = (await getWeeklySales(userFor(req), req.storeId, from, to)) as unknown as SalesEnvelope;

    const u = userWithLatLng(req);
    let weather: unknown[] = [];
    let weeklyWeather: WeeklyWeatherBucket[] = [];
    if (u.storeLatitude && u.storeLongitude) {
      weather = await fetchWeatherRange(
        u.storeLatitude,
        u.storeLongitude,
        from,
        to,
        u.storeTimezone || 'America/New_York',
      );
      weeklyWeather = aggregateWeatherWeekly(weather as Parameters<typeof aggregateWeatherWeekly>[0]) as unknown as WeeklyWeatherBucket[];
    }

    // Merge weekly sales with weekly weather by matching week start dates
    const salesRows = salesData.value || [];
    const mergedRows = salesRows.map((sale) => {
      const saleDate = sale.Date ? sale.Date.slice(0, 10) : '';
      // Find the closest weekly weather bucket
      const ww = weeklyWeather.find((w) => {
        return saleDate >= (w.weekStart || '') && saleDate <= (w.weekEnd || '');
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
      weatherEnabled: !!(u.storeLatitude && u.storeLongitude),
    });
  } catch (err) {
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};

interface MonthlyWeatherBucket {
  month?: string;
  avgTempMax?: number | null;
  avgTempMin?: number | null;
  avgTempMean?: number | null;
  totalPrecipitation?: number | null;
  dominantCondition?: string | null;
}

// ─── Monthly + Weather ────────────────────────────────────────────────────

export const monthlyWithWeather = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as { from?: string; to?: string };
    const from = q.from || monthsAgo(24);
    const to = q.to || today();
    const salesData = (await getMonthlySales(userFor(req), req.storeId, from, to)) as unknown as SalesEnvelope;

    const u = userWithLatLng(req);
    let weather: unknown[] = [];
    let monthlyWeather: MonthlyWeatherBucket[] = [];
    if (u.storeLatitude && u.storeLongitude) {
      weather = await fetchWeatherRange(
        u.storeLatitude,
        u.storeLongitude,
        from,
        to,
        u.storeTimezone || 'America/New_York',
      );
      monthlyWeather = aggregateWeatherMonthly(weather as Parameters<typeof aggregateWeatherMonthly>[0]) as unknown as MonthlyWeatherBucket[];
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
      weatherEnabled: !!(u.storeLatitude && u.storeLongitude),
    });
  } catch (err) {
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};

interface YearlyMapEntry {
  Date: string;
  Year: string;
  TotalGrossSales: number;
  TotalNetSales: number;
  TotalTransactionsCount: number;
  TotalDiscounts: number;
  TotalRefunds: number;
  TotalTaxes: number;
  TotalTotalCollected: number;
  monthCount: number;
}

interface YearlyWeatherBucket {
  year?: string;
  avgTempMax?: number | null;
  avgTempMin?: number | null;
  avgTempMean?: number | null;
  totalPrecipitation?: number | null;
  dominantCondition?: string | null;
}

// ─── Yearly + Weather ─────────────────────────────────────────────────────

export const yearlyWithWeather = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as { from?: string; to?: string };
    const from = q.from || monthsAgo(60);
    const to = q.to || today();
    // Use monthly data and aggregate to yearly
    const salesData = (await getMonthlySales(userFor(req), req.storeId, from, to)) as unknown as SalesEnvelope;
    const monthlyRows = salesData.value || [];

    // Aggregate monthly sales into yearly
    const yearlyMap: Record<string, YearlyMapEntry> = {};
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
      y.TotalGrossSales += Number(row.TotalGrossSales) || 0;
      y.TotalNetSales += Number(row.TotalNetSales) || 0;
      y.TotalTransactionsCount += Number(row.TotalTransactionsCount) || 0;
      y.TotalDiscounts += Number(row.TotalDiscounts) || 0;
      y.TotalRefunds += Number(row.TotalRefunds) || 0;
      y.TotalTaxes += Number(row.TotalTaxes) || 0;
      y.TotalTotalCollected += Number(row.TotalTotalCollected) || 0;
      y.monthCount++;
    }

    const yearlySales = Object.values(yearlyMap).sort((a, b) => a.Year.localeCompare(b.Year));

    // Yearly weather
    const u = userWithLatLng(req);
    let yearlyWeather: YearlyWeatherBucket[] = [];
    if (u.storeLatitude && u.storeLongitude) {
      const weather = await fetchWeatherRange(
        u.storeLatitude,
        u.storeLongitude,
        from,
        to,
        u.storeTimezone || 'America/New_York',
      );
      yearlyWeather = aggregateWeatherYearly(weather as Parameters<typeof aggregateWeatherYearly>[0]) as unknown as YearlyWeatherBucket[];
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
      weatherEnabled: !!(u.storeLatitude && u.storeLongitude),
    });
  } catch (err) {
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};
