/**
 * Sales Analytics Service
 * Queries POS transaction data directly from PostgreSQL via Prisma.
 * Returns data in a format compatible with the analytics frontend.
 */

import prisma from '../config/postgres.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ─── Helper: build an empty sales bucket with all expected fields ───────────
function emptyBucket(date, extra = {}) {
  return {
    Date: date,
    TotalGrossSales:        0,
    TotalNetSales:          0,
    TotalTransactionsCount: 0,
    TotalDiscounts:         0,
    TotalRefunds:           0,
    TotalTaxes:             0,
    TotalDeposits:          0,
    TotalEBT:               0,
    TotalTotalCollected:    0,
    ...extra,
  };
}

// ─── Helper: compute aggregation totals across buckets ─────────────────────
function computeAggregation(rows) {
  const agg = {
    TotalGrossSales:        0,
    TotalNetSales:          0,
    TotalTransactionsCount: 0,
    TotalDiscounts:         0,
    TotalRefunds:           0,
    TotalTaxes:             0,
    TotalDeposits:          0,
    TotalEBT:               0,
    TotalTotalCollected:    0,
  };
  for (const r of rows) {
    agg.TotalGrossSales        += Number(r.TotalGrossSales)        || 0;
    agg.TotalNetSales          += Number(r.TotalNetSales)          || 0;
    agg.TotalTransactionsCount += Number(r.TotalTransactionsCount) || 0;
    agg.TotalDiscounts         += Number(r.TotalDiscounts)         || 0;
    agg.TotalRefunds           += Number(r.TotalRefunds)           || 0;
    agg.TotalTaxes             += Number(r.TotalTaxes)             || 0;
    agg.TotalDeposits          += Number(r.TotalDeposits)          || 0;
    agg.TotalEBT               += Number(r.TotalEBT)               || 0;
    agg.TotalTotalCollected    += Number(r.TotalTotalCollected)    || 0;
  }
  // Round all values
  for (const k of Object.keys(agg)) agg[k] = r2(agg[k]);
  return agg;
}

// ─── Helper: build base WHERE clause ────────────────────────────────────────
function buildWhere(user, storeId, from, to) {
  const where = { status: 'complete' };
  if (user?.orgId) where.orgId = user.orgId;
  if (storeId) where.storeId = storeId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00`);
    if (to)   where.createdAt.lte = new Date(`${to}T23:59:59.999`);
  }
  return where;
}

// ─── Helper: format date string ─────────────────────────────────────────────
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getWeekStart(d) {
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  return toDateStr(monday);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY SALES
// ═══════════════════════════════════════════════════════════════════════════════

export async function getDailySales(user, storeId, from, to) {
  const txns = await prisma.transaction.findMany({
    where: buildWhere(user, storeId, from, to),
    select: { grandTotal: true, subtotal: true, taxTotal: true, depositTotal: true, ebtTotal: true, tenderLines: true, lineItems: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const days = {};
  for (const tx of txns) {
    const ds = toDateStr(new Date(tx.createdAt));
    if (!days[ds]) days[ds] = emptyBucket(ds);
    const d = days[ds];
    const sub   = Number(tx.subtotal)     || 0;
    const tax   = Number(tx.taxTotal)     || 0;
    const grand = Number(tx.grandTotal)   || 0;
    const dep   = Number(tx.depositTotal) || 0;
    const ebt   = Number(tx.ebtTotal)     || 0;

    d.TotalNetSales          += sub;           // pre-tax, post-discount line totals
    d.TotalGrossSales        += sub;           // gross of sales (alias for now)
    d.TotalTaxes             += tax;
    d.TotalDeposits          += dep;
    d.TotalEBT               += ebt;
    d.TotalTotalCollected    += grand;         // what customer paid
    d.TotalTransactionsCount += 1;

    // Compute discounts from lineItems (if present)
    const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
    for (const li of items) {
      d.TotalDiscounts += Number(li.discountAmount) || 0;
      if (li.isRefund) d.TotalRefunds += Math.abs(Number(li.lineTotal) || 0);
    }
  }

  // Fill missing dates with zeros
  const result = [];
  if (from && to) {
    const cur = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (cur <= end) {
      const ds = toDateStr(cur);
      result.push(days[ds] || emptyBucket(ds));
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    result.push(...Object.values(days));
  }

  // Round all values
  for (const row of result) {
    for (const k of Object.keys(row)) {
      if (typeof row[k] === 'number') row[k] = r2(row[k]);
    }
  }

  return {
    value: result,
    '@odata.aggregation': computeAggregation(result),
    '@odata.count': result.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEEKLY SALES
// ═══════════════════════════════════════════════════════════════════════════════

export async function getWeeklySales(user, storeId, from, to) {
  const { value: daily } = await getDailySales(user, storeId, from, to);

  const weeks = {};
  for (const d of daily) {
    const ws = getWeekStart(new Date(d.Date + 'T00:00:00'));
    if (!weeks[ws]) weeks[ws] = emptyBucket(ws);
    const w = weeks[ws];
    w.TotalNetSales          += d.TotalNetSales;
    w.TotalGrossSales        += d.TotalGrossSales;
    w.TotalTransactionsCount += d.TotalTransactionsCount;
    w.TotalTaxes             += d.TotalTaxes;
    w.TotalDiscounts         += d.TotalDiscounts;
    w.TotalRefunds           += d.TotalRefunds;
    w.TotalDeposits          += d.TotalDeposits;
    w.TotalEBT               += d.TotalEBT;
    w.TotalTotalCollected    += d.TotalTotalCollected;
  }

  const result = Object.values(weeks).sort((a, b) => a.Date.localeCompare(b.Date));
  for (const row of result) {
    for (const k of Object.keys(row)) {
      if (typeof row[k] === 'number') row[k] = r2(row[k]);
    }
  }

  return {
    value: result,
    '@odata.aggregation': computeAggregation(result),
    '@odata.count': result.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MONTHLY SALES
// ═══════════════════════════════════════════════════════════════════════════════

export async function getMonthlySales(user, storeId, from, to) {
  const { value: daily } = await getDailySales(user, storeId, from, to);

  const months = {};
  for (const d of daily) {
    const m = d.Date.slice(0, 7); // YYYY-MM
    if (!months[m]) months[m] = { ...emptyBucket(m + '-01'), Month: m };
    const mo = months[m];
    mo.TotalNetSales          += d.TotalNetSales;
    mo.TotalGrossSales        += d.TotalGrossSales;
    mo.TotalTransactionsCount += d.TotalTransactionsCount;
    mo.TotalTaxes             += d.TotalTaxes;
    mo.TotalDiscounts         += d.TotalDiscounts;
    mo.TotalRefunds           += d.TotalRefunds;
    mo.TotalDeposits          += d.TotalDeposits;
    mo.TotalEBT               += d.TotalEBT;
    mo.TotalTotalCollected    += d.TotalTotalCollected;
  }

  const result = Object.values(months).sort((a, b) => a.Date.localeCompare(b.Date));
  for (const row of result) {
    for (const k of Object.keys(row)) {
      if (typeof row[k] === 'number') row[k] = r2(row[k]);
    }
  }

  return {
    value: result,
    '@odata.aggregation': computeAggregation(result),
    '@odata.count': result.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MONTHLY COMPARISON
// ═══════════════════════════════════════════════════════════════════════════════

export async function getMonthlySalesComparison(user, storeId) {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const lastMonth = now.getMonth() === 0
    ? `${now.getFullYear()-1}-12`
    : `${now.getFullYear()}-${String(now.getMonth()).padStart(2,'0')}`;

  const from = lastMonth + '-01';
  const to = toDateStr(now);
  const { value: daily } = await getDailySales(user, storeId, from, to);

  let current = { net: 0, txns: 0 }, previous = { net: 0, txns: 0 };
  for (const d of daily) {
    const m = d.Date.slice(0, 7);
    if (m === thisMonth) { current.net += d.TotalNetSales; current.txns += d.TotalTransactionsCount; }
    if (m === lastMonth) { previous.net += d.TotalNetSales; previous.txns += d.TotalTransactionsCount; }
  }

  return { current, previous, change: previous.net ? r2(((current.net - previous.net) / previous.net) * 100) : 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEPARTMENT SALES
// ═══════════════════════════════════════════════════════════════════════════════

export async function getDepartmentSales(user, storeId, from, to) {
  const txns = await prisma.transaction.findMany({
    where: buildWhere(user, storeId, from, to),
    select: { lineItems: true },
  });

  const depts = {};
  for (const tx of txns) {
    const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
    for (const li of items) {
      if (li.isLottery || li.isBottleReturn || li.isBagFee) continue;
      const deptName = li.departmentName || li.taxClass || 'Other';
      const deptId = li.departmentId || deptName;
      if (!depts[deptId]) {
        depts[deptId] = {
          // All the field name variants the frontend might use
          Name:           deptName,
          Department:     deptName,
          DepartmentId:   deptId,
          TotalSales:     0,
          TotalNetSales:  0,
          TotalGrossSales: 0,
          TotalItems:     0,
          ItemsSold:      0,
          TotalTransactionsCount: 0,
          TransactionCount: 0,
        };
      }
      const d = depts[deptId];
      const lineTotal = Number(li.lineTotal) || 0;
      const grossLine = Number(li.unitPrice || 0) * Number(li.qty || 1);
      const qty       = Number(li.qty) || 1;

      d.TotalSales     += lineTotal;
      d.TotalNetSales  += lineTotal;
      d.TotalGrossSales += grossLine;
      d.TotalItems     += qty;
      d.ItemsSold      += qty;
      d.TotalTransactionsCount += 1;
      d.TransactionCount += 1;
    }
  }

  const result = Object.values(depts)
    .map(d => {
      for (const k of Object.keys(d)) {
        if (typeof d[k] === 'number') d[k] = r2(d[k]);
      }
      return d;
    })
    .sort((a, b) => b.TotalNetSales - a.TotalNetSales);

  return { value: result, '@odata.count': result.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEPARTMENT COMPARISON
// ═══════════════════════════════════════════════════════════════════════════════

export async function getDepartmentComparison(user, storeId, from, to, from2, to2) {
  const [current, previous] = await Promise.all([
    getDepartmentSales(user, storeId, from, to),
    getDepartmentSales(user, storeId, from2, to2),
  ]);

  const prevMap = {};
  for (const d of (previous.value || [])) prevMap[d.Name || d.Department] = d;

  const comparison = (current.value || []).map(c => {
    const p = prevMap[c.Name || c.Department] || { TotalNetSales: 0, TotalSales: 0 };
    const change = p.TotalNetSales ? r2(((c.TotalNetSales - p.TotalNetSales) / p.TotalNetSales) * 100) : null;
    return {
      ...c,
      PreviousSales: p.TotalNetSales,
      TotalNetSales2: p.TotalNetSales,
      TotalSales2:    p.TotalSales,
      Change: change,
    };
  });

  return { value: comparison, '@odata.count': comparison.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOP PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getTopProducts(user, storeId, date) {
  const from = date || toDateStr(new Date());
  const txns = await prisma.transaction.findMany({
    where: buildWhere(user, storeId, from, from),
    select: { lineItems: true },
  });

  const products = {};
  for (const tx of txns) {
    const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
    for (const li of items) {
      if (li.isLottery || li.isBottleReturn || li.isBagFee) continue;
      const key = li.name || li.upc || 'Unknown';
      if (!products[key]) products[key] = { Name: key, UPC: li.upc || '', Department: li.departmentName || li.taxClass || '', NetSales: 0, GrossSales: 0, UnitsSold: 0 };
      products[key].NetSales   += r2(li.lineTotal || 0);
      products[key].GrossSales += r2((li.unitPrice || 0) * (li.qty || 1));
      products[key].UnitsSold  += Number(li.qty || 1);
    }
  }

  const result = Object.values(products).sort((a, b) => b.NetSales - a.NetSales).slice(0, 20);
  return { value: result, '@odata.count': result.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTS GROUPED (paginated best-sellers)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getProductsGrouped(user, storeId, from, to, orderBy = 'NetSales', pageSize = 20, skip = 0) {
  const txns = await prisma.transaction.findMany({
    where: buildWhere(user, storeId, from, to),
    select: { lineItems: true },
  });

  const products = {};
  for (const tx of txns) {
    const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
    for (const li of items) {
      if (li.isLottery || li.isBottleReturn || li.isBagFee) continue;
      const key = li.upc || li.name || 'Unknown';
      if (!products[key]) products[key] = {
        UPC: li.upc || '', Sales: [{ Description: li.name || '', DepartmentDescription: li.departmentName || li.taxClass || '' }],
        NetSales: 0, GrossSales: 0, UnitsSold: 0, TotalCost: 0, Profit: 0, Margin: 0,
      };
      const p = products[key];
      p.NetSales   += r2(li.lineTotal || 0);
      p.GrossSales += r2((li.unitPrice || 0) * (li.qty || 1));
      p.UnitsSold  += Number(li.qty || 1);
    }
  }

  // Compute profit (estimate 30% margin if no cost data)
  const all = Object.values(products).map(p => {
    p.TotalCost = r2(p.NetSales * 0.65);
    p.Profit = r2(p.NetSales - p.TotalCost);
    p.Margin = p.NetSales ? r2((p.Profit / p.NetSales) * 100) : 0;
    return p;
  });

  all.sort((a, b) => b[orderBy] - a[orderBy]);
  const total = all.length;
  const page = all.slice(skip, skip + pageSize);

  return { value: page, total, '@odata.count': total };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCT MOVEMENT (weekly time series for a specific product)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getProductMovement(user, storeId, upc, from, to, weekly = false) {
  const txns = await prisma.transaction.findMany({
    where: buildWhere(user, storeId, from, to),
    select: { lineItems: true, createdAt: true },
  });

  const buckets = {};
  for (const tx of txns) {
    const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
    for (const li of items) {
      if ((li.upc || li.name) !== upc) continue;
      const d = new Date(tx.createdAt);
      const key = weekly ? getWeekStart(d) : toDateStr(d);
      if (!buckets[key]) buckets[key] = { Date: key, Revenue: 0, Units: 0 };
      buckets[key].Revenue += r2(li.lineTotal || 0);
      buckets[key].Units   += Number(li.qty || 1);
    }
  }

  return { value: Object.values(buckets).sort((a, b) => a.Date.localeCompare(b.Date)) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY PRODUCT MOVEMENT (all products, daily)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getDailyProductMovement(user, storeId, from, to) {
  return getProductMovement(user, storeId, null, from, to, false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 52-WEEK STATS (high / low / avg weekly units for a single product)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getProduct52WeekStats(user, storeId, upc) {
  // Query last 365 days of transactions
  const now = new Date();
  const yearAgo = new Date(now);
  yearAgo.setDate(yearAgo.getDate() - 364);
  const from = toDateStr(yearAgo);
  const to   = toDateStr(now);

  const txns = await prisma.transaction.findMany({
    where: buildWhere(user, storeId, from, to),
    select: { lineItems: true, createdAt: true },
  });

  // Aggregate into weekly buckets
  const weeks = {};
  for (const tx of txns) {
    const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
    for (const li of items) {
      // Match by UPC — check both upc and any additionalUpcs
      const liUpc = li.upc || '';
      if (liUpc !== upc) continue;

      const d = new Date(tx.createdAt);
      const wk = getWeekStart(d);
      if (!weeks[wk]) weeks[wk] = 0;
      weeks[wk] += Number(li.qty || 1);
    }
  }

  const weeklyValues = Object.values(weeks);
  if (weeklyValues.length === 0) {
    return { weeklyHigh: null, weeklyLow: null, avgWeekly: null, totalUnits: 0, weeksWithSales: 0, suggestedQoH: null };
  }

  const totalUnits     = weeklyValues.reduce((s, v) => s + v, 0);
  const weeksWithSales = weeklyValues.length;
  const weeklyHigh     = Math.max(...weeklyValues);
  const weeklyLow      = Math.min(...weeklyValues);
  const avgWeekly      = r2(totalUnits / 52); // avg over full 52 weeks, not just weeks with sales
  const suggestedQoH   = Math.ceil(avgWeekly * 2); // 2-week cover

  return { weeklyHigh, weeklyLow, avgWeekly, totalUnits, weeksWithSales, suggestedQoH };
}
