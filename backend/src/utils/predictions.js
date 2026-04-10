/**
 * Sales Prediction Utilities
 * Implements Holt-Winters Triple Exponential Smoothing + day-of-week factors
 */

// ─── Holt-Winters Triple Exponential Smoothing ────────────────────────────────
/**
 * @param {number[]} data    - historical values (must be >= 2*period)
 * @param {number}   period  - seasonal period (7 for weekly, 12 for monthly, 4 for quarterly)
 * @param {number}   alpha   - level smoothing coefficient [0,1]
 * @param {number}   beta    - trend smoothing coefficient [0,1]
 * @param {number}   gamma   - seasonal smoothing coefficient [0,1]
 * @param {number}   horizon - number of future periods to forecast
 * @returns {number[]} forecasted values of length `horizon`
 */
export const holtwinters = (
  data,
  period,
  alpha = 0.3,
  beta = 0.1,
  gamma = 0.2,
  horizon = 14
) => {
  const n = data.length;
  if (n < 2 * period) {
    // Not enough data — fall back to simple average projection
    const avg = data.reduce((a, b) => a + b, 0) / n;
    return Array.from({ length: horizon }, () => Math.max(0, avg));
  }

  // ── Initialise ──────────────────────────────────────────────────────────────
  // Level: average of first season
  let level = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Trend: average slope across first two seasons
  let trend = 0;
  for (let i = 0; i < period; i++) {
    trend += (data[i + period] - data[i]) / period;
  }
  trend /= period;

  // Seasonal indices: ratio of each observation to the initial level average
  const seasonal = [];
  for (let i = 0; i < period; i++) {
    seasonal.push(data[i] / level);
  }

  // ── Smooth ──────────────────────────────────────────────────────────────────
  const smoothed = [];
  for (let t = 0; t < n; t++) {
    const s = seasonal[t % period];
    const prevLevel = level;
    const prevTrend = trend;

    level = alpha * (data[t] / s) + (1 - alpha) * (prevLevel + prevTrend);
    trend = beta * (level - prevLevel) + (1 - beta) * prevTrend;
    seasonal[t % period] = gamma * (data[t] / level) + (1 - gamma) * s;
    smoothed.push((prevLevel + prevTrend) * s);
  }

  // ── Forecast ────────────────────────────────────────────────────────────────
  const forecast = [];
  for (let h = 1; h <= horizon; h++) {
    const s = seasonal[(n + h - 1) % period];
    const value = (level + trend * h) * s;
    forecast.push(Math.max(0, value));
  }

  return forecast;
};

// ─── Day-of-Week Adjustment Factors ──────────────────────────────────────────
// Index 0 = Sunday
const DOW_FACTORS = [1.15, 0.90, 0.88, 0.92, 1.00, 1.20, 1.30];

/**
 * Multiply a daily forecast by day-of-week factors.
 * @param {number[]} forecast   - raw daily forecast values
 * @param {Date|string} startDate - date of forecast[0]
 * @returns {number[]} adjusted values
 */
export const applyDOWFactors = (forecast, startDate) => {
  const base = new Date(startDate);
  return forecast.map((val, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const dow = d.getDay(); // 0=Sun … 6=Sat
    return val * DOW_FACTORS[dow];
  });
};

// ─── US Holidays ─────────────────────────────────────────────────────────────
export const US_HOLIDAYS = {
  // 2025
  '2025-01-01': "New Year's Day",
  '2025-01-20': 'Martin Luther King Jr. Day',
  '2025-02-17': "Presidents' Day",
  '2025-05-26': 'Memorial Day',
  '2025-06-19': 'Juneteenth',
  '2025-07-04': 'Independence Day',
  '2025-09-01': 'Labor Day',
  '2025-10-13': 'Columbus Day',
  '2025-11-11': 'Veterans Day',
  '2025-11-27': 'Thanksgiving Day',
  '2025-12-25': 'Christmas Day',
  // 2026
  '2026-01-01': "New Year's Day",
  '2026-01-19': 'Martin Luther King Jr. Day',
  '2026-02-16': "Presidents' Day",
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-04': 'Independence Day (observed 2026-07-03)',
  '2026-07-03': 'Independence Day (observed)',
  '2026-09-07': 'Labor Day',
  '2026-10-12': 'Columbus Day',
  '2026-11-11': 'Veterans Day',
  '2026-11-26': 'Thanksgiving Day',
  '2026-12-25': 'Christmas Day',
};

// ─── Build Prediction Timeline ────────────────────────────────────────────────
/**
 * Annotate raw forecast values with contextual metadata.
 * @param {number[]} forecastValues
 * @param {Date|string} startDate       - date of forecastValues[0]
 * @param {'daily'|'weekly'|'monthly'} period
 * @returns {Array<{date:string, predicted:number, base:number, isHoliday:boolean, holidayName:string|null, dayOfWeek:string}>}
 */
export const buildPredictionTimeline = (forecastValues, startDate, period = 'daily') => {
  const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const base = new Date(startDate);

  return forecastValues.map((val, i) => {
    const d = new Date(base);
    if (period === 'daily') d.setDate(base.getDate() + i);
    else if (period === 'weekly') d.setDate(base.getDate() + i * 7);
    else d.setMonth(base.getMonth() + i);

    const dateStr = d.toISOString().slice(0, 10);
    const holidayName = US_HOLIDAYS[dateStr] || null;

    return {
      date: dateStr,
      predicted: Math.round(val * 100) / 100,
      base: Math.round(val * 100) / 100,
      isHoliday: !!holidayName,
      holidayName,
      dayOfWeek: DOW_NAMES[d.getDay()],
    };
  });
};

// ─── Weather Impact Regression ───────────────────────────────────────────────
/**
 * Compute weather impact coefficients from historical sales + weather data.
 * Returns multipliers: how much rain/temp/etc affects sales vs baseline.
 *
 * @param {{date:string, sales:number, tempMean?:number, precipitation?:number, weatherCode?:number}[]} historicalData
 * @returns {{rainFactor:number, coldFactor:number, hotFactor:number, snowFactor:number, baseline:number}}
 */
export const computeWeatherImpact = (historicalData) => {
  if (!historicalData?.length || historicalData.length < 14) {
    return { rainFactor: -0.12, coldFactor: -0.05, hotFactor: -0.03, snowFactor: -0.25, baseline: 0 };
  }

  const valid = historicalData.filter(d => d.sales > 0 && d.tempMean != null);
  if (valid.length < 7) return { rainFactor: -0.12, coldFactor: -0.05, hotFactor: -0.03, snowFactor: -0.25, baseline: 0 };

  const avgSales = valid.reduce((s, d) => s + d.sales, 0) / valid.length;
  const avgTemp  = valid.reduce((s, d) => s + d.tempMean, 0) / valid.length;

  // Categorize days
  const rainyDays = valid.filter(d => (d.precipitation || 0) > 0.5);
  const coldDays  = valid.filter(d => d.tempMean < 32);
  const hotDays   = valid.filter(d => d.tempMean > 90);
  const snowDays  = valid.filter(d => d.weatherCode >= 71 && d.weatherCode <= 77);
  const normalDays = valid.filter(d => (d.precipitation || 0) <= 0.5 && d.tempMean >= 32 && d.tempMean <= 90);

  const normalAvg = normalDays.length > 3
    ? normalDays.reduce((s, d) => s + d.sales, 0) / normalDays.length
    : avgSales;

  const factor = (days) => {
    if (days.length < 2) return 0;
    const catAvg = days.reduce((s, d) => s + d.sales, 0) / days.length;
    return (catAvg - normalAvg) / normalAvg;
  };

  return {
    rainFactor: Math.max(-0.30, Math.min(0.1, factor(rainyDays) || -0.12)),
    coldFactor: Math.max(-0.30, Math.min(0.1, factor(coldDays) || -0.05)),
    hotFactor:  Math.max(-0.20, Math.min(0.1, factor(hotDays) || -0.03)),
    snowFactor: Math.max(-0.50, Math.min(0, factor(snowDays) || -0.25)),
    baseline: normalAvg,
  };
};

/**
 * Apply weather impact to forecast.
 * @param {Array} predictions - [{date, predicted, ...}]
 * @param {Array} weatherForecast - [{date, tempMax, tempMin, precipitation, weatherCode}]
 * @param {object} impact - from computeWeatherImpact
 * @returns {Array} predictions with weatherAdjusted field + factors
 */
export const applyWeatherToPredictions = (predictions, weatherForecast, impact) => {
  const weatherMap = {};
  for (const w of (weatherForecast || [])) weatherMap[w.date] = w;

  return predictions.map(p => {
    const w = weatherMap[p.date];
    if (!w) return { ...p, weatherAdjusted: p.predicted, factors: { ...p.factors } };

    let multiplier = 1.0;
    const factors = { ...(p.factors || {}) };

    // Rain impact
    if ((w.precipitation || 0) > 2) {
      multiplier += impact.rainFactor;
      factors.rain = { label: 'Rain expected', impact: impact.rainFactor, precipitation: w.precipitation };
    }

    // Snow impact
    if (w.weatherCode >= 71 && w.weatherCode <= 77) {
      multiplier += impact.snowFactor;
      factors.snow = { label: 'Snow expected', impact: impact.snowFactor };
    }

    // Temperature extremes
    const avgTemp = ((w.tempMax || 70) + (w.tempMin || 50)) / 2;
    if (avgTemp < 32) {
      multiplier += impact.coldFactor;
      factors.cold = { label: 'Extreme cold', impact: impact.coldFactor, temp: avgTemp };
    } else if (avgTemp > 90) {
      multiplier += impact.hotFactor;
      factors.heat = { label: 'Extreme heat', impact: impact.hotFactor, temp: avgTemp };
    }

    // Weather metadata
    factors.weather = { temp: avgTemp, condition: w.condition || 'Unknown', icon: w.icon };

    return {
      ...p,
      weatherAdjusted: Math.max(0, Math.round(p.predicted * multiplier * 100) / 100),
      weatherMultiplier: Math.round(multiplier * 1000) / 1000,
      factors,
    };
  });
};

// ─── Holiday Impact Multipliers ──────────────────────────────────────────────
const HOLIDAY_MULTIPLIERS = {
  "New Year's Day":            0.4,   // most stores closed or slow
  'Martin Luther King Jr. Day': 0.85,
  "Presidents' Day":           0.85,
  'Memorial Day':              0.8,
  'Juneteenth':                0.9,
  'Independence Day':          0.5,
  'Independence Day (observed)': 0.6,
  'Independence Day (observed 2026-07-03)': 0.5,
  'Labor Day':                 0.75,
  'Columbus Day':              0.9,
  'Veterans Day':              0.9,
  'Thanksgiving Day':          0.3,
  'Christmas Day':             0.2,
};

/**
 * Apply holiday multipliers to predictions.
 */
export const applyHolidayFactors = (predictions) => {
  return predictions.map(p => {
    if (!p.isHoliday || !p.holidayName) return p;
    const mult = HOLIDAY_MULTIPLIERS[p.holidayName] ?? 0.85;
    const factors = { ...(p.factors || {}), holiday: { label: p.holidayName, impact: mult - 1 } };
    return {
      ...p,
      predicted: Math.max(0, Math.round(p.predicted * mult * 100) / 100),
      factors,
    };
  });
};

// ─── Hourly Distribution ─────────────────────────────────────────────────────
/**
 * Compute hourly sales distribution from historical transactions.
 * Returns array of 24 proportions summing to 1.0.
 *
 * @param {Array<{createdAt:Date|string, grandTotal:number|Decimal}>} transactions
 * @returns {number[]} 24-element array
 */
export const computeHourlyDistribution = (transactions) => {
  const hourTotals = new Array(24).fill(0);
  let total = 0;

  for (const tx of transactions) {
    const h = new Date(tx.createdAt).getHours();
    const amt = Number(tx.grandTotal) || 0;
    hourTotals[h] += amt;
    total += amt;
  }

  if (total === 0) {
    // Default distribution if no data: bell curve centered at 12pm
    const defaults = [0,0,0,0,0,0.01,0.02,0.04,0.06,0.08,0.10,0.12,0.12,0.10,0.08,0.06,0.05,0.04,0.04,0.03,0.02,0.01,0.01,0.01];
    return defaults;
  }

  return hourTotals.map(h => Math.round((h / total) * 10000) / 10000);
};

/**
 * Break a daily prediction into hourly using distribution.
 * @param {number} dailyPrediction
 * @param {number[]} hourlyDistribution - 24 proportions
 * @returns {Array<{hour:number, label:string, predicted:number}>}
 */
export const breakIntoHourly = (dailyPrediction, hourlyDistribution) => {
  return hourlyDistribution.map((pct, h) => ({
    hour: h,
    label: h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`,
    predicted: Math.round(dailyPrediction * pct * 100) / 100,
    pct: Math.round(pct * 10000) / 100,
  }));
};

// ─── Monthly Forecast (aggregate weekly) ─────────────────────────────────────
/**
 * Aggregate daily predictions into monthly buckets.
 * @param {Array<{date:string, predicted:number}>} dailyPredictions
 * @returns {Array<{month:string, predicted:number, days:number, avgDaily:number}>}
 */
export const aggregateToMonthly = (dailyPredictions) => {
  const months = {};
  for (const p of dailyPredictions) {
    const m = p.date.slice(0, 7); // YYYY-MM
    if (!months[m]) months[m] = { total: 0, days: 0 };
    months[m].total += p.weatherAdjusted ?? p.predicted;
    months[m].days += 1;
  }

  return Object.entries(months).map(([month, data]) => ({
    month,
    predicted: Math.round(data.total * 100) / 100,
    days: data.days,
    avgDaily: Math.round((data.total / data.days) * 100) / 100,
  })).sort((a, b) => a.month.localeCompare(b.month));
};

// ─── Velocity Calculator ──────────────────────────────────────────────────────
/**
 * Calculate product velocity and reorder recommendation.
 * @param {number[]} movements - array of weekly sold quantities (oldest first)
 * @returns {{avgWeekly: number, trend: number, recommendation: 'reorder'|'ok'|'overstock'}}
 */
export const calculateVelocity = (movements) => {
  if (!movements || movements.length === 0) {
    return { avgWeekly: 0, trend: 0, recommendation: 'ok' };
  }

  const n = movements.length;
  const avgWeekly = movements.reduce((a, b) => a + b, 0) / n;

  // Simple linear trend via least-squares slope
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += movements[i];
    sumXY += i * movements[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  const trend = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;

  // Most recent week's qty
  const recentWeekly = movements[n - 1] ?? avgWeekly;

  let recommendation;
  if (recentWeekly > avgWeekly * 1.2 || trend > 0.5) {
    recommendation = 'reorder';
  } else if (recentWeekly < avgWeekly * 0.5 || trend < -0.5) {
    recommendation = 'overstock';
  } else {
    recommendation = 'ok';
  }

  return {
    avgWeekly: Math.round(avgWeekly * 100) / 100,
    trend: Math.round(trend * 1000) / 1000,
    recommendation,
  };
};
