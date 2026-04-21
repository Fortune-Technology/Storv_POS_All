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
// Includes both 'complete' sales and 'refund' transactions so refunds net out
// of Gross / Net (matches End-of-Day report semantics — see
// endOfDayReportController.aggregateTransactions).
function buildWhere(user, storeId, from, to) {
  const where = { status: { in: ['complete', 'refund'] } };
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
    select: { grandTotal: true, subtotal: true, taxTotal: true, depositTotal: true, ebtTotal: true, tenderLines: true, lineItems: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const days = {};
  for (const tx of txns) {
    const ds = toDateStr(new Date(tx.createdAt));
    if (!days[ds]) days[ds] = emptyBucket(ds);
    const d = days[ds];
    // Sign convention (matches EoD aggregateTransactions):
    //   • status='complete' → use RAW signed values. grandTotal can be negative
    //     for net-negative carts (e.g. bottle returns > sales) and that should
    //     subtract from gross.
    //   • status='refund'   → grandTotal stored as POSITIVE amount of refund;
    //     subtract via -Math.abs() (refund money going out).
    const isRefund = tx.status === 'refund';
    const sub   = isRefund ? -Math.abs(Number(tx.subtotal)     || 0) : (Number(tx.subtotal)     || 0);
    const tax   = isRefund ? -Math.abs(Number(tx.taxTotal)     || 0) : (Number(tx.taxTotal)     || 0);
    const grand = isRefund ? -Math.abs(Number(tx.grandTotal)   || 0) : (Number(tx.grandTotal)   || 0);
    const dep   = isRefund ? -Math.abs(Number(tx.depositTotal) || 0) : (Number(tx.depositTotal) || 0);
    const ebt   = isRefund ? -Math.abs(Number(tx.ebtTotal)     || 0) : (Number(tx.ebtTotal)     || 0);

    // ── Bug B2 fix: Gross vs Net definitions ──────────────────────────────
    // Per user clarification:
    //   Gross Sales = what the customer paid = Σ grandTotal (INCLUDES tax, deposits)
    //                 Must match the total of tender collected.
    //   Net Sales   = Σ subtotal (after discount, BEFORE tax)
    //   Tax / Deposit / EBT are tracked as separate columns.
    d.TotalGrossSales        += grand;         // B2: total collected (incl. tax)
    d.TotalNetSales          += sub;           // pre-tax, post-discount
    d.TotalTaxes             += tax;
    d.TotalDeposits          += dep;
    d.TotalEBT               += ebt;
    d.TotalTotalCollected    += grand;         // alias for Gross (kept for back-compat)
    if (isRefund) {
      d.TotalRefunds         += Math.abs(Number(tx.grandTotal) || 0);
      // Refund tx itself is not counted as a "sale" in the count column
    } else {
      d.TotalTransactionsCount += 1;
    }

    // Compute discounts from lineItems (if present)
    const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
    for (const li of items) {
      d.TotalDiscounts += Number(li.discountAmount) || 0;
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

// Rule-match wildcards — mirror of cashier-app's `matchTax` in useCartStore.js
// so report-time tax attribution matches cart-time calculation.
const TAX_RULE_WILDCARDS = new Set(['', 'all', 'any', '*', 'standard', 'none']);
function matchTaxRule(appliesTo, taxClass) {
  const applied = String(appliesTo || '').toLowerCase().trim();
  if (TAX_RULE_WILDCARDS.has(applied)) return true;
  const list = applied.split(',').map(s => s.trim()).filter(Boolean);
  const cls = String(taxClass || '').toLowerCase().trim();
  if (list.includes(cls)) return true;
  return list.some(x => TAX_RULE_WILDCARDS.has(x));
}

export async function getDepartmentSales(user, storeId, from, to) {
  const orgId = user?.orgId;
  const [txns, taxRules] = await Promise.all([
    prisma.transaction.findMany({
      where: buildWhere(user, storeId, from, to),
      select: { id: true, lineItems: true, status: true, taxTotal: true, subtotal: true },
    }),
    // Load active tax rules once. They're small (<20 rows typically).
    orgId
      ? prisma.taxRule.findMany({ where: { orgId, active: true }, select: { appliesTo: true, rate: true, departmentIds: true } })
      : Promise.resolve([]),
  ]);

  // Bug B1 fix: Track distinct transaction IDs per department so
  // TotalTransactionsCount reflects unique baskets, not line-item count.
  // Bug B2 fix applied here too: gross = line total BEFORE discount (unit × qty),
  // net = line total AFTER discount (li.lineTotal).
  //
  // Session 20 enhancement — per-department tax attribution:
  // Tax is NOT stored per line, so we recompute it at report time by matching
  // each line's taxClass against the store's active tax rules (same matchTax
  // logic the cashier uses). When rules haven't changed between save-time and
  // report-time, the aggregate tax matches tx.taxTotal exactly. If rules HAVE
  // changed since sales were recorded, numbers may drift — to avoid that we'd
  // need per-line taxAmount stored at save-time (not done yet).
  const depts = {};
  for (const tx of txns) {
    const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
    const isRefund = tx.status === 'refund';
    const seenInThisTx = new Set();
    for (const li of items) {
      if (li.isLottery || li.isBottleReturn || li.isBagFee) continue;
      const deptName = li.departmentName || li.taxClass || 'Other';
      const deptId = li.departmentId || deptName;
      if (!depts[deptId]) {
        depts[deptId] = {
          Name:            deptName,
          Department:      deptName,
          DepartmentId:    deptId,
          TotalSales:      0,
          TotalNetSales:   0,
          TotalGrossSales: 0,
          TotalTaxCollected: 0,
          TotalItems:      0,
          ItemsSold:       0,
          TotalTransactionsCount: 0,
          TransactionCount: 0,
          _txSet: new Set(),
        };
      }
      const d = depts[deptId];
      const rawLineTotal = Number(li.lineTotal) || 0;
      const rawGrossLine = (Number(li.unitPrice || 0) * Number(li.qty || 1));
      const rawQty       = Number(li.qty) || 1;
      const lineTotal = isRefund ? -Math.abs(rawLineTotal) : rawLineTotal;
      const grossLine = isRefund ? -Math.abs(rawGrossLine) : rawGrossLine;
      const qty       = isRefund ? -Math.abs(rawQty)       : rawQty;

      d.TotalSales      += lineTotal;
      d.TotalNetSales   += lineTotal;
      d.TotalGrossSales += grossLine;
      d.TotalItems      += qty;
      d.ItemsSold       += qty;

      // Per-line tax match — Option B (dept-linked rules win, class matcher
      // is the legacy fallback). Skip EBT-eligible / non-taxable lines.
      if (li.taxable && !li.ebtEligible) {
        const lineDeptId = li.departmentId ? Number(li.departmentId) : null;
        const deptRule = lineDeptId
          ? taxRules.find(r => Array.isArray(r.departmentIds) && r.departmentIds.includes(lineDeptId))
          : null;
        const rule = deptRule || taxRules.find(r => (!r.departmentIds || r.departmentIds.length === 0) && matchTaxRule(r.appliesTo, li.taxClass));
        const rate = rule ? parseFloat(rule.rate) : 0;
        d.TotalTaxCollected += lineTotal * rate;
      }

      if (!isRefund && !seenInThisTx.has(deptId)) {
        d._txSet.add(tx.id);
        seenInThisTx.add(deptId);
      }
    }
  }

  const result = Object.values(depts)
    .map(d => {
      // Replace the Set with its size, drop the internal field
      d.TotalTransactionsCount = d._txSet.size;
      d.TransactionCount       = d._txSet.size;
      delete d._txSet;
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
  // B8: default date = today (was yesterday)
  const from = date || toDateStr(new Date());
  const txns = await prisma.transaction.findMany({
    where: buildWhere(user, storeId, from, from),
    select: { lineItems: true, status: true },
  });

  // B7: grouping key = productId → upc → name (productId is authoritative)
  // Sign convention matches getDepartmentSales: refund tx → -|values|;
  // complete tx → raw signed.
  const products = {};
  for (const tx of txns) {
    const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
    const isRefund = tx.status === 'refund';
    for (const li of items) {
      if (li.isLottery || li.isBottleReturn || li.isBagFee) continue;
      const key = String(li.productId || li.upc || li.name || 'Unknown');
      if (!products[key]) products[key] = {
        Name: li.name || li.upc || 'Unknown',
        ProductId: li.productId || null,
        UPC: li.upc || '',
        Department: li.departmentName || li.taxClass || '',
        NetSales: 0, GrossSales: 0, UnitsSold: 0,
      };
      const lineTotal = Number(li.lineTotal || 0);
      const grossLine = (Number(li.unitPrice || 0) * Number(li.qty || 1));
      const qty       = Number(li.qty || 1);
      products[key].NetSales   += isRefund ? -Math.abs(r2(lineTotal)) : r2(lineTotal);
      products[key].GrossSales += isRefund ? -Math.abs(r2(grossLine)) : r2(grossLine);
      products[key].UnitsSold  += isRefund ? -Math.abs(qty)            : qty;
    }
  }

  // After refunds net out, products with non-positive net sales drop off the
  // top-products list (they're net returns, not top sellers).
  const result = Object.values(products)
    .filter(p => p.NetSales > 0)
    .sort((a, b) => b.NetSales - a.NetSales)
    .slice(0, 20);
  return { value: result, '@odata.count': result.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTS GROUPED (paginated best-sellers)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Bug B3 fix: margin is NO LONGER hardcoded to 35%.
// 1. Prefer per-line cost (li.costPrice) recorded at sale time.
// 2. Fallback to MasterProduct.defaultCostPrice by batch lookup (productId or UPC).
// 3. If neither exists → return TotalCost=null, Profit=null, Margin=null (UI shows "—").
//    This honors the user's point that margin changes over time with cost changes.
// Bug B7 fix: grouping key = productId → upc → name (productId is authoritative).
//
export async function getProductsGrouped(user, storeId, from, to, orderBy = 'NetSales', pageSize = 20, skip = 0) {
  const txns = await prisma.transaction.findMany({
    where: buildWhere(user, storeId, from, to),
    select: { lineItems: true, status: true },
  });

  const products = {};
  // Collect productIds and UPCs seen for batch MasterProduct lookup
  const seenProductIds = new Set();
  const seenUpcs       = new Set();

  for (const tx of txns) {
    const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
    const isRefund = tx.status === 'refund';
    for (const li of items) {
      if (li.isLottery || li.isBottleReturn || li.isBagFee) continue;
      // B7 fix: productId > upc > name
      const key = String(li.productId || li.upc || li.name || 'Unknown');
      if (!products[key]) products[key] = {
        Key:          key,
        ProductId:    li.productId || null,
        UPC:          li.upc || '',
        Sales:        [{ Description: li.name || '', DepartmentDescription: li.departmentName || li.taxClass || '' }],
        NetSales:     0,
        GrossSales:   0,
        UnitsSold:    0,
        TotalCost:    0,   // accumulated from real cost data
        KnownCost:    false, // false until we find ANY cost for this product
        Profit:       null,
        Margin:       null,
      };
      const p = products[key];
      const qtyRaw   = Number(li.qty || 1);
      const signedQty= isRefund ? -Math.abs(qtyRaw) : qtyRaw;
      const lineCost = Number(li.costPrice) * Math.abs(qtyRaw);
      if (Number.isFinite(lineCost) && lineCost > 0) {
        p.TotalCost += isRefund ? -lineCost : lineCost;
        p.KnownCost  = true;
      }
      const lineTotal = Number(li.lineTotal || 0);
      const grossLine = (Number(li.unitPrice || 0) * qtyRaw);
      p.NetSales   += isRefund ? -Math.abs(r2(lineTotal)) : r2(lineTotal);
      p.GrossSales += isRefund ? -Math.abs(r2(grossLine)) : r2(grossLine);
      p.UnitsSold  += signedQty;

      if (li.productId) seenProductIds.add(parseInt(li.productId, 10));
      if (li.upc)       seenUpcs.add(String(li.upc));
    }
  }

  // Batch-load MasterProduct cost data for products that had no per-line cost
  const costByProductId = new Map();
  const costByUpc       = new Map();
  try {
    if (user?.orgId && (seenProductIds.size || seenUpcs.size)) {
      const mps = await prisma.masterProduct.findMany({
        where: {
          orgId: user.orgId,
          OR: [
            ...(seenProductIds.size ? [{ id: { in: [...seenProductIds] } }] : []),
            ...(seenUpcs.size       ? [{ upc: { in: [...seenUpcs] } }]       : []),
          ],
        },
        select: { id: true, upc: true, defaultCostPrice: true },
      });
      for (const m of mps) {
        const cost = m.defaultCostPrice != null ? Number(m.defaultCostPrice) : null;
        if (!Number.isFinite(cost) || cost <= 0) continue;
        costByProductId.set(String(m.id), cost);
        if (m.upc) costByUpc.set(String(m.upc), cost);
      }
    }
  } catch (err) {
    console.warn('⚠ B3: MasterProduct cost lookup failed:', err.message);
  }

  // Compute real margin per product
  const all = Object.values(products).map(p => {
    // If we don't have per-line cost data, try MasterProduct.defaultCostPrice × units
    if (!p.KnownCost) {
      const masterCost = costByProductId.get(String(p.ProductId)) ?? costByUpc.get(String(p.UPC)) ?? null;
      if (masterCost != null) {
        p.TotalCost = r2(masterCost * p.UnitsSold);
        p.KnownCost = true;
      }
    }
    if (p.KnownCost && p.NetSales > 0) {
      p.TotalCost = r2(p.TotalCost);
      p.Profit    = r2(p.NetSales - p.TotalCost);
      p.Margin    = r2((p.Profit / p.NetSales) * 100);
    } else {
      // Unknown — frontend should render "—" / "not available"
      p.TotalCost = null;
      p.Profit    = null;
      p.Margin    = null;
    }
    return p;
  });

  all.sort((a, b) => {
    const av = a[orderBy] ?? -Infinity;
    const bv = b[orderBy] ?? -Infinity;
    return bv - av;
  });
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
  // Bug B11 fix: divide by max(weeksWithSales, 4) for new/seasonal products.
  // Avoids undercounting brand-new products that haven't been around for 52 weeks.
  const avgWeekly      = r2(totalUnits / Math.max(weeksWithSales, 4));
  const suggestedQoH   = Math.ceil(avgWeekly * 2); // 2-week cover

  return { weeklyHigh, weeklyLow, avgWeekly, totalUnits, weeksWithSales, suggestedQoH };
}
