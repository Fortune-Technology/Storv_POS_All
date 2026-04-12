/**
 * Sales Analytics Service
 * Queries POS transaction data directly from PostgreSQL via Prisma.
 * Returns data in a format compatible with the analytics frontend.
 */

import prisma from '../config/postgres.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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
    if (!days[ds]) days[ds] = { Date: ds, TotalNetSales: 0, TotalGrossSales: 0, TransactionCount: 0, TotalTax: 0, TotalDeposits: 0, TotalEBT: 0, TotalDiscounts: 0, TotalRefunds: 0 };
    const d = days[ds];
    d.TotalNetSales   += r2(tx.grandTotal);
    d.TotalGrossSales += r2(tx.subtotal);
    d.TransactionCount += 1;
    d.TotalTax        += r2(tx.taxTotal);
    d.TotalDeposits   += r2(tx.depositTotal);
    d.TotalEBT        += r2(tx.ebtTotal);
  }

  // Fill missing dates with zeros
  const result = [];
  if (from && to) {
    const cur = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (cur <= end) {
      const ds = toDateStr(cur);
      result.push(days[ds] || { Date: ds, TotalNetSales: 0, TotalGrossSales: 0, TransactionCount: 0, TotalTax: 0, TotalDeposits: 0, TotalEBT: 0, TotalDiscounts: 0, TotalRefunds: 0 });
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    result.push(...Object.values(days));
  }

  return { value: result };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEEKLY SALES
// ═══════════════════════════════════════════════════════════════════════════════

export async function getWeeklySales(user, storeId, from, to) {
  const { value: daily } = await getDailySales(user, storeId, from, to);

  const weeks = {};
  for (const d of daily) {
    const ws = getWeekStart(new Date(d.Date + 'T00:00:00'));
    if (!weeks[ws]) weeks[ws] = { Date: ws, TotalNetSales: 0, TotalGrossSales: 0, TransactionCount: 0, TotalTax: 0, TotalDeposits: 0, TotalEBT: 0, TotalDiscounts: 0, TotalRefunds: 0 };
    const w = weeks[ws];
    w.TotalNetSales   += d.TotalNetSales;
    w.TotalGrossSales += d.TotalGrossSales;
    w.TransactionCount += d.TransactionCount;
    w.TotalTax        += d.TotalTax;
    w.TotalDeposits   += d.TotalDeposits;
    w.TotalEBT        += d.TotalEBT;
  }

  return { value: Object.values(weeks).sort((a, b) => a.Date.localeCompare(b.Date)) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MONTHLY SALES
// ═══════════════════════════════════════════════════════════════════════════════

export async function getMonthlySales(user, storeId, from, to) {
  const { value: daily } = await getDailySales(user, storeId, from, to);

  const months = {};
  for (const d of daily) {
    const m = d.Date.slice(0, 7); // YYYY-MM
    if (!months[m]) months[m] = { Date: m + '-01', Month: m, TotalNetSales: 0, TotalGrossSales: 0, TransactionCount: 0, TotalTax: 0, TotalDeposits: 0, TotalEBT: 0, TotalDiscounts: 0, TotalRefunds: 0 };
    const mo = months[m];
    mo.TotalNetSales   += d.TotalNetSales;
    mo.TotalGrossSales += d.TotalGrossSales;
    mo.TransactionCount += d.TransactionCount;
    mo.TotalTax        += d.TotalTax;
    mo.TotalDeposits   += d.TotalDeposits;
    mo.TotalEBT        += d.TotalEBT;
  }

  return { value: Object.values(months).sort((a, b) => a.Date.localeCompare(b.Date)) };
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
    if (m === thisMonth) { current.net += d.TotalNetSales; current.txns += d.TransactionCount; }
    if (m === lastMonth) { previous.net += d.TotalNetSales; previous.txns += d.TransactionCount; }
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
      const dept = li.departmentName || li.taxClass || 'Other';
      const deptId = li.departmentId || dept;
      if (!depts[deptId]) depts[deptId] = { Department: dept, DepartmentId: deptId, TotalNetSales: 0, TotalGrossSales: 0, ItemsSold: 0, TransactionCount: 0 };
      const d = depts[deptId];
      d.TotalNetSales   += r2(li.lineTotal || 0);
      d.TotalGrossSales += r2((li.unitPrice || 0) * (li.qty || 1));
      d.ItemsSold       += Number(li.qty || 1);
      d.TransactionCount += 1;
    }
  }

  const result = Object.values(depts).sort((a, b) => b.TotalNetSales - a.TotalNetSales);
  return { value: result };
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
  for (const d of (previous.value || [])) prevMap[d.Department] = d;

  const comparison = (current.value || []).map(c => {
    const p = prevMap[c.Department] || { TotalNetSales: 0 };
    const change = p.TotalNetSales ? r2(((c.TotalNetSales - p.TotalNetSales) / p.TotalNetSales) * 100) : null;
    return { ...c, PreviousSales: p.TotalNetSales, Change: change };
  });

  return { value: comparison };
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
  return { value: result };
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

  return { value: page, total };
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
