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
