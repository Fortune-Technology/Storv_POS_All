/**
 * Order Engine — Multi-Factor Demand-Driven Reorder System
 *
 * 14-Factor Algorithm:
 * ┌────────────────────────────────────────────────────────────┐
 * │  1. Sales Velocity        8. Lead Time                     │
 * │  2. Trend Direction       9. Safety Stock (Z × σ × √LT)   │
 * │  3. Holt-Winters Forecast 10. Pack/Case Size               │
 * │  4. Day-of-Week Pattern   11. Minimum Order                │
 * │  5. Holiday Calendar      12. Shelf Life / Perishability   │
 * │  6. Weather Forecast      13. Demand Variability (CV)      │
 * │  7. Current Inventory     14. Stockout History             │
 * └────────────────────────────────────────────────────────────┘
 *
 * Core Formula:
 *   dailyDemand    = HW(90d) × DOW × holiday × weather
 *   forecastDemand = Σ dailyDemand[today → today + leadTime + reviewPeriod]
 *   safetyStock    = Z(serviceLevel) × σ(dailyDemand) × √(leadTime)
 *   orderQty       = max(0, forecastDemand - onHand + safetyStock - onOrder)
 *   orderQty       = roundUpToCaseQty(orderQty, casePacks)
 *   orderQty       = max(orderQty, minOrderQty)
 */

import prisma from '../config/postgres.js';
import {
  holtwinters,
  applyDOWFactors,
  US_HOLIDAYS,
  computeWeatherImpact,
} from '../utils/predictions.js';

// ── Service Level Z-scores ──────────────────────────────────────────────────
const Z_SCORES = { critical: 2.33, standard: 1.65, low: 1.28 };
const DEFAULT_REVIEW_PERIOD = 7; // days between order reviews

// ── Holiday multipliers for demand adjustment ───────────────────────────────
const HOLIDAY_MULT = {
  "New Year's Day": 0.4, 'Martin Luther King Jr. Day': 0.85,
  "Presidents' Day": 0.85, 'Memorial Day': 0.8, 'Juneteenth': 0.9,
  'Independence Day': 0.5, 'Labor Day': 0.75, 'Columbus Day': 0.9,
  'Veterans Day': 0.9, 'Thanksgiving Day': 0.3, 'Christmas Day': 0.2,
};

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

// ═════════════════════════════════════════════════════════════════════════════
// MAIN: Generate order suggestions for all products
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @param {string} orgId
 * @param {string} storeId
 * @param {object} [options]
 * @param {number} [options.forecastDays=14] — how far ahead to forecast
 * @param {object} [options.weatherForecast] — 10-day forecast array
 * @param {object} [options.weatherImpact] — pre-computed weather coefficients
 * @returns {Promise<{suggestions: Array, vendorGroups: Object, stats: Object}>}
 */
export async function generateOrderSuggestions(orgId, storeId, options = {}) {
  const { forecastDays = 14 } = options;

  // ── 1. Fetch products with inventory + vendor info ─────────────────────
  const products = await prisma.masterProduct.findMany({
    where: { orgId, active: true, deleted: false, trackInventory: true, vendorId: { not: null } },
    include: {
      department: { select: { id: true, name: true, code: true } },
      storeProducts: { where: { storeId }, select: { quantityOnHand: true, quantityOnOrder: true, lastReceivedAt: true } },
    },
  });

  const vendors = await prisma.vendor.findMany({
    where: { orgId, active: true },
    select: { id: true, name: true, code: true, leadTimeDays: true, minOrderAmount: true, orderFrequency: true, deliveryDays: true, terms: true },
  });
  const vendorMap = {};
  for (const v of vendors) vendorMap[v.id] = v;

  // ── 2. Fetch 90-day sales data for all products at once ────────────────
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const transactions = await prisma.transaction.findMany({
    where: {
      orgId, status: 'complete',
      ...(storeId ? { storeId } : {}),
      createdAt: { gte: ninetyDaysAgo },
    },
    select: { lineItems: true, createdAt: true },
  });

  // Build product → daily sales map
  const productDailySales = buildProductDailySales(transactions, 90);

  // ── 3. Get weather forecast + impact (if available) ────────────────────
  let weatherImpact = options.weatherImpact || null;
  let weatherForecast = options.weatherForecast || [];

  if (!weatherImpact) {
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { latitude: true, longitude: true, timezone: true } });
    if (store?.latitude && store?.longitude) {
      try {
        const { getTenDayForecast, fetchWeatherRange } = await import('./weatherService.js');
        weatherForecast = await getTenDayForecast(store.latitude, store.longitude, store.timezone || 'America/New_York');

        // Build weather impact from last 90 days sales + weather
        const todayStr = new Date().toISOString().slice(0, 10);
        const fromStr = ninetyDaysAgo.toISOString().slice(0, 10);
        const historicalWeather = await fetchWeatherRange(store.latitude, store.longitude, fromStr, todayStr, store.timezone || 'America/New_York');

        // Aggregate daily sales with weather for regression
        const dailySalesTotals = {};
        for (const tx of transactions) {
          const ds = new Date(tx.createdAt).toISOString().slice(0, 10);
          const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
          const total = items.reduce((s, li) => s + (Number(li.lineTotal) || 0), 0);
          dailySalesTotals[ds] = (dailySalesTotals[ds] || 0) + total;
        }

        const weatherMap = {};
        for (const w of historicalWeather) weatherMap[w.date] = w;

        const salesWeather = Object.entries(dailySalesTotals).map(([date, sales]) => ({
          date, sales,
          tempMean: weatherMap[date]?.temperatureMean ?? null,
          precipitation: weatherMap[date]?.precipitationSum ?? null,
          weatherCode: weatherMap[date]?.weatherCode ?? null,
        }));

        weatherImpact = computeWeatherImpact(salesWeather);
      } catch (e) {
        console.warn('⚠ Weather data unavailable for order engine:', e.message);
      }
    }
  }

  // ── 4. Analyze each product ────────────────────────────────────────────
  const suggestions = [];

  for (const product of products) {
    const vendor = vendorMap[product.vendorId];
    if (!vendor) continue;

    const sp = product.storeProducts[0];
    const onHand = Number(sp?.quantityOnHand) || 0;
    const onOrder = Number(sp?.quantityOnOrder) || 0;
    const leadTime = vendor.leadTimeDays || 3;
    const reviewPeriod = DEFAULT_REVIEW_PERIOD;
    const casePacks = product.casePacks || product.packInCase || 1;
    const unitCost = Number(product.defaultCostPrice) || 0;
    const caseCost = Number(product.defaultCasePrice) || unitCost * casePacks;

    // ── Factor 1-3: Sales velocity + trend + Holt-Winters forecast ───
    const dailySeries = productDailySales[product.id] || [];
    const unitsSeries = dailySeries.map(d => d.units);

    if (unitsSeries.length < 7) {
      // Not enough data — skip or use simple average
      if (unitsSeries.length === 0) continue;
    }

    let forecastValues;
    if (unitsSeries.length >= 14) {
      forecastValues = holtwinters(unitsSeries, 7, 0.3, 0.1, 0.2, forecastDays);
    } else {
      // Simple average projection
      const avg = unitsSeries.reduce((a, b) => a + b, 0) / unitsSeries.length;
      forecastValues = Array(forecastDays).fill(Math.max(0, avg));
    }

    // ── Factor 4: Day-of-week adjustment ─────────────────────────────
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    forecastValues = applyDOWFactors(forecastValues, tomorrow);

    // ── Factor 5: Holiday adjustment ─────────────────────────────────
    forecastValues = forecastValues.map((val, i) => {
      const d = new Date(tomorrow);
      d.setDate(tomorrow.getDate() + i);
      const ds = d.toISOString().slice(0, 10);
      const holiday = US_HOLIDAYS[ds];
      if (holiday) {
        const mult = HOLIDAY_MULT[holiday] ?? 0.85;
        return val * mult;
      }
      return val;
    });

    // ── Factor 6: Weather adjustment ─────────────────────────────────
    if (weatherImpact && weatherForecast.length > 0) {
      const wMap = {};
      for (const w of weatherForecast) wMap[w.date] = w;

      forecastValues = forecastValues.map((val, i) => {
        const d = new Date(tomorrow);
        d.setDate(tomorrow.getDate() + i);
        const ds = d.toISOString().slice(0, 10);
        const w = wMap[ds];
        if (!w) return val;

        let mult = 1.0;
        if ((w.precipitation || 0) > 2) mult += weatherImpact.rainFactor;
        if (w.weatherCode >= 71 && w.weatherCode <= 77) mult += weatherImpact.snowFactor;
        const avgTemp = ((w.tempMax || 70) + (w.tempMin || 50)) / 2;
        if (avgTemp < 32) mult += weatherImpact.coldFactor;
        if (avgTemp > 90) mult += weatherImpact.hotFactor;
        return val * mult;
      });
    }

    // ── Factor 7: Current inventory ──────────────────────────────────
    // (used in order qty calculation below)

    // ── Factor 2 (cont): Trend direction ─────────────────────────────
    const recentWeeks = [];
    for (let w = 0; w < Math.min(8, Math.floor(unitsSeries.length / 7)); w++) {
      const weekSlice = unitsSeries.slice(w * 7, (w + 1) * 7);
      recentWeeks.push(weekSlice.reduce((a, b) => a + b, 0));
    }
    const trend = linearTrend(recentWeeks);

    // ── Factor 13: Demand variability (coefficient of variation) ─────
    const avgDaily = unitsSeries.length > 0 ? unitsSeries.reduce((a, b) => a + b, 0) / unitsSeries.length : 0;
    const stdDev = standardDeviation(unitsSeries);
    const cv = avgDaily > 0 ? stdDev / avgDaily : 0; // coefficient of variation

    // ── Factor 9: Safety stock ───────────────────────────────────────
    const serviceLevel = product.serviceLevel || 'standard';
    const z = Z_SCORES[serviceLevel] || Z_SCORES.standard;
    const safetyStock = Math.ceil(z * stdDev * Math.sqrt(leadTime));

    // ── Factor 8: Lead time coverage ─────────────────────────────────
    const coverageDays = leadTime + reviewPeriod;
    const forecastDemand = forecastValues.slice(0, coverageDays).reduce((a, b) => a + b, 0);

    // ── Factor 12: Shelf life constraint ─────────────────────────────
    let maxOrderQty = Infinity;
    if (product.shelfLifeDays) {
      // Don't order more than can be sold within shelf life
      const shelfLifeDemand = forecastValues.slice(0, product.shelfLifeDays).reduce((a, b) => a + b, 0);
      maxOrderQty = Math.ceil(shelfLifeDemand * 1.1); // 10% buffer
    }

    // ── Factor 14: Stockout penalty ──────────────────────────────────
    // Count days with zero sales when avg > 0.5/day (likely stockout, not low demand)
    const stockoutDays = avgDaily > 0.5 ? unitsSeries.filter(d => d === 0).length : 0;
    const stockoutPenalty = stockoutDays > 5 ? 1.15 : stockoutDays > 2 ? 1.08 : 1.0;

    // ── CORE CALCULATION ─────────────────────────────────────────────
    let rawOrderQty = Math.max(0, (forecastDemand * stockoutPenalty) - onHand + safetyStock - onOrder);

    // ── Factor 10: Round up to case quantity ─────────────────────────
    let orderUnits = casePacks > 1 ? Math.ceil(rawOrderQty / casePacks) * casePacks : Math.ceil(rawOrderQty);
    let orderCases = casePacks > 1 ? Math.ceil(rawOrderQty / casePacks) : orderUnits;

    // ── Factor 12 (cont): Cap at shelf life max ──────────────────────
    if (orderUnits > maxOrderQty) {
      orderUnits = casePacks > 1 ? Math.floor(maxOrderQty / casePacks) * casePacks : Math.floor(maxOrderQty);
      orderCases = casePacks > 1 ? Math.floor(maxOrderQty / casePacks) : orderUnits;
    }

    // Skip if nothing to order
    if (orderUnits <= 0) continue;

    // ── Days of supply ───────────────────────────────────────────────
    const daysOfSupply = avgDaily > 0 ? r2(onHand / avgDaily) : 999;
    const reorderPoint = Math.ceil(avgDaily * leadTime) + safetyStock;

    // ── Determine urgency + reason ───────────────────────────────────
    let urgency, reorderReason;
    if (onHand <= 0) { urgency = 'critical'; reorderReason = 'out_of_stock'; }
    else if (daysOfSupply < leadTime) { urgency = 'critical'; reorderReason = 'below_lead_time'; }
    else if (onHand <= reorderPoint) { urgency = 'high'; reorderReason = 'below_reorder_point'; }
    else if (daysOfSupply < leadTime + reviewPeriod) { urgency = 'medium'; reorderReason = 'low_days_supply'; }
    else if (trend > 0.3) { urgency = 'low'; reorderReason = 'trending_up'; }
    else { urgency = 'low'; reorderReason = 'forecast_demand'; }

    suggestions.push({
      productId:      product.id,
      productName:    product.name,
      upc:            product.upc,
      brand:          product.brand,
      department:     product.department?.name || 'Unknown',
      departmentCode: product.department?.code || '',
      vendorId:       vendor.id,
      vendorName:     vendor.name,
      vendorCode:     vendor.code,

      // Inventory state
      onHand:         r2(onHand),
      onOrder:        r2(onOrder),
      daysOfSupply:   r2(daysOfSupply),
      reorderPoint,

      // Demand analysis
      avgDailySales:  r4(avgDaily),
      avgWeeklySales: r2(avgDaily * 7),
      trend:          r4(trend),
      stdDev:         r4(stdDev),
      cv:             r4(cv),
      forecastDemand: r2(forecastDemand),
      safetyStock:    r2(safetyStock),

      // Order recommendation
      orderUnits,
      orderCases,
      casePacks,
      unitCost:       r4(unitCost),
      caseCost:       r4(caseCost),
      lineTotal:      r2(orderUnits * unitCost),

      // Metadata
      urgency,
      reorderReason,
      serviceLevel,
      leadTime,
      shelfLifeDays:  product.shelfLifeDays,
      stockoutDays,

      // Factor breakdown for UI
      factors: {
        velocity:       { avgDaily: r4(avgDaily), trend: r4(trend) },
        seasonality:    { applied: unitsSeries.length >= 14 },
        dayOfWeek:      { applied: true },
        holiday:        { applied: true },
        weather:        { applied: !!weatherImpact },
        safetyStock:    { z, stdDev: r4(stdDev), leadTime, value: r2(safetyStock) },
        shelfLife:      { applied: !!product.shelfLifeDays, days: product.shelfLifeDays },
        stockoutPenalty:{ applied: stockoutPenalty > 1, days: stockoutDays, multiplier: stockoutPenalty },
        demandCV:       { value: r4(cv), level: cv > 1 ? 'high' : cv > 0.5 ? 'medium' : 'low' },
      },
    });
  }

  // ── Sort by urgency ────────────────────────────────────────────────────
  const URGENCY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  suggestions.sort((a, b) => (URGENCY_ORDER[a.urgency] ?? 9) - (URGENCY_ORDER[b.urgency] ?? 9));

  // ── Group by vendor ────────────────────────────────────────────────────
  const vendorGroups = {};
  for (const s of suggestions) {
    if (!vendorGroups[s.vendorId]) {
      const v = vendorMap[s.vendorId];
      vendorGroups[s.vendorId] = {
        vendorId: s.vendorId, vendorName: s.vendorName, vendorCode: s.vendorCode,
        leadTime: v.leadTimeDays, minOrderAmount: Number(v.minOrderAmount) || 0,
        terms: v.terms, items: [], subtotal: 0, itemCount: 0,
      };
    }
    const g = vendorGroups[s.vendorId];
    g.items.push(s);
    g.subtotal += s.lineTotal;
    g.itemCount += 1;
  }

  // ── Factor 11: Flag vendors below minimum order ────────────────────────
  for (const g of Object.values(vendorGroups)) {
    g.subtotal = r2(g.subtotal);
    g.belowMinimum = g.minOrderAmount > 0 && g.subtotal < g.minOrderAmount;
    g.shortfall = g.belowMinimum ? r2(g.minOrderAmount - g.subtotal) : 0;
  }

  // ── Stats ──────────────────────────────────────────────────────────────
  const stats = {
    totalProducts:    products.length,
    needsReorder:     suggestions.length,
    criticalCount:    suggestions.filter(s => s.urgency === 'critical').length,
    highCount:        suggestions.filter(s => s.urgency === 'high').length,
    mediumCount:      suggestions.filter(s => s.urgency === 'medium').length,
    lowCount:         suggestions.filter(s => s.urgency === 'low').length,
    vendorCount:      Object.keys(vendorGroups).length,
    estimatedTotal:   r2(suggestions.reduce((s, i) => s + i.lineTotal, 0)),
    weatherAdjusted:  !!weatherImpact,
  };

  return { suggestions, vendorGroups: Object.values(vendorGroups), stats };
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build per-product daily sales from transaction line items.
 * Returns { [productId]: [{ date, units, revenue }] } sorted by date.
 */
function buildProductDailySales(transactions, daysBack) {
  const map = {}; // productId → { date → { units, revenue } }
  const today = new Date();

  for (const tx of transactions) {
    const ds = new Date(tx.createdAt).toISOString().slice(0, 10);
    const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
    for (const li of items) {
      if (li.isLottery || li.isBottleReturn || li.isBagFee) continue;
      const pid = li.productId;
      if (!pid) continue;
      if (!map[pid]) map[pid] = {};
      if (!map[pid][ds]) map[pid][ds] = { units: 0, revenue: 0 };
      map[pid][ds].units += Number(li.qty || 1);
      map[pid][ds].revenue += Number(li.lineTotal || 0);
    }
  }

  // Convert to sorted arrays with zero-fill
  const result = {};
  for (const [pid, dateMap] of Object.entries(map)) {
    const series = [];
    for (let i = daysBack - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      series.push({ date: ds, units: dateMap[ds]?.units || 0, revenue: dateMap[ds]?.revenue || 0 });
    }
    result[pid] = series;
  }

  return result;
}

/**
 * Compute linear trend slope from a series of values.
 */
function linearTrend(values) {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += values[i]; sumXY += i * values[i]; sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  return denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
}

/**
 * Standard deviation of an array.
 */
function standardDeviation(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// ═════════════════════════════════════════════════════════════════════════════
// PO NUMBER GENERATOR
// ═════════════════════════════════════════════════════════════════════════════

export async function nextPONumber() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `PO-${today}-`;

  const last = await prisma.purchaseOrder.findFirst({
    where: { poNumber: { startsWith: prefix } },
    orderBy: { poNumber: 'desc' },
    select: { poNumber: true },
  });

  const seq = last ? parseInt(last.poNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}
