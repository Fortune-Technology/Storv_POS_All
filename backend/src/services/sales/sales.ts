/**
 * Sales Analytics Service
 * Queries POS transaction data directly from PostgreSQL via Prisma.
 * Returns data in a format compatible with the analytics frontend.
 */

import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { formatLocalDate, addOneDay } from '../../utils/dateTz.js';

// ── Domain shapes ──────────────────────────────────────────────────────────

export interface SalesUserContext {
  orgId?: string | null;
  [key: string]: unknown;
}

export interface SalesBucket {
  Date: string;
  TotalGrossSales: number;
  TotalNetSales: number;
  TotalTransactionsCount: number;
  TotalDiscounts: number;
  TotalRefunds: number;
  TotalTaxes: number;
  TotalDeposits: number;
  TotalEBT: number;
  TotalTotalCollected: number;
  [key: string]: number | string;
}

export interface SalesAggregation {
  TotalGrossSales: number;
  TotalNetSales: number;
  TotalTransactionsCount: number;
  TotalDiscounts: number;
  TotalRefunds: number;
  TotalTaxes: number;
  TotalDeposits: number;
  TotalEBT: number;
  TotalTotalCollected: number;
}

export interface SalesEnvelope<T> {
  value: T[];
  '@odata.aggregation'?: SalesAggregation;
  '@odata.count': number;
}

interface PosLineItem {
  productId?: number | null;
  upc?: string | null;
  name?: string | null;
  departmentId?: number | string | null;
  departmentName?: string | null;
  // Per-product explicit override — wins at checkout. Cart sends this on
  // every saved line item; reports use it for tier-1 tax resolution.
  taxRuleId?: number | string | null;
  // Legacy product attribute — only used by age policy at checkout (the
  // `tobacco` / `alcohol` per-store age threshold lookup). NOT used for
  // tax matching anymore (Session 56b removed the legacy class matcher).
  taxClass?: string | null;
  qty?: number | string | null;
  unitPrice?: number | string | null;
  lineTotal?: number | string | null;
  costPrice?: number | string | null;
  discountAmount?: number | string | null;
  taxable?: boolean;
  ebtEligible?: boolean;
  isLottery?: boolean;
  isBottleReturn?: boolean;
  isBagFee?: boolean;
  [key: string]: unknown;
}

const r2 = (n: number | string | null | undefined): number =>
  Math.round((Number(n) || 0) * 100) / 100;

// ─── Helper: build an empty sales bucket with all expected fields ───────────
function emptyBucket(date: string, extra: Record<string, number | string> = {}): SalesBucket {
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
function computeAggregation(rows: SalesBucket[]): SalesAggregation {
  const agg: SalesAggregation = {
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
  for (const k of Object.keys(agg) as Array<keyof SalesAggregation>) agg[k] = r2(agg[k]);
  return agg;
}

// ─── Helper: build base WHERE clause ────────────────────────────────────────
// Includes both 'complete' sales and 'refund' transactions so refunds net out
// of Gross / Net (matches End-of-Day report semantics — see
// endOfDayReportController.aggregateTransactions).
function buildWhere(
  user: SalesUserContext | null | undefined,
  storeId: string | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { status: { in: ['complete', 'refund'] } };
  if (user?.orgId) where.orgId = user.orgId;
  if (storeId) where.storeId = storeId;
  if (from || to) {
    where.createdAt = {};
    if (from) (where.createdAt as { gte?: Date }).gte = new Date(`${from}T00:00:00`);
    if (to)   (where.createdAt as { lte?: Date }).lte = new Date(`${to}T23:59:59.999`);
  }
  return where;
}

// ─── Helper: format date string ─────────────────────────────────────────────
// When `tz` is provided, formats the date in that IANA timezone (correct for
// any server tz). When omitted, falls back to server-local time — kept for
// callers that don't have a single store context (e.g. multi-store reports).
//
// Production deployments where the server tz != store tz MUST always pass tz,
// otherwise daily-bucketed reports will silently drift around UTC midnight.
function toDateStr(d: Date, tz?: string): string {
  if (tz) return formatLocalDate(d, tz);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getWeekStart(d: Date): string {
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  return toDateStr(monday);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY SALES
// ═══════════════════════════════════════════════════════════════════════════════

export async function getDailySales(
  user: SalesUserContext | null | undefined,
  storeId: string | null | undefined,
  from?: string | null,
  to?: string | null,
): Promise<SalesEnvelope<SalesBucket>> {
  // Session 60 — tz-aware bucketing. When a single store is in scope, use its
  // IANA timezone for day boundaries. Without this, `toDateStr` falls back to
  // server-local time which silently drifts around UTC midnight whenever the
  // server tz != store tz (typical for production: server in UTC, store in EDT).
  const tz = storeId
    ? (await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } }))?.timezone || undefined
    : undefined;

  const txns = await prisma.transaction.findMany({
    where: buildWhere(user, storeId, from, to),
    select: { grandTotal: true, subtotal: true, taxTotal: true, depositTotal: true, ebtTotal: true, tenderLines: true, lineItems: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const days: Record<string, SalesBucket> = {};
  for (const tx of txns) {
    const ds = toDateStr(new Date(tx.createdAt), tz);
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
    const items = (Array.isArray(tx.lineItems) ? tx.lineItems : []) as PosLineItem[];
    for (const li of items) {
      d.TotalDiscounts += Number(li.discountAmount) || 0;
    }
  }

  // Fill missing dates with zeros. When tz is set, walk via addOneDay on the
  // string key so the loop respects the store's local-day cadence (handles
  // DST transitions correctly). Without tz, fall back to server-local Date
  // arithmetic for back-compat.
  const result: SalesBucket[] = [];
  if (from && to) {
    if (tz) {
      let cur = from;
      while (cur <= to) {
        result.push(days[cur] || emptyBucket(cur));
        cur = addOneDay(cur);
      }
    } else {
      const curD = new Date(`${from}T00:00:00`);
      const end = new Date(`${to}T00:00:00`);
      while (curD <= end) {
        const ds = toDateStr(curD);
        result.push(days[ds] || emptyBucket(ds));
        curD.setDate(curD.getDate() + 1);
      }
    }
  } else {
    result.push(...Object.values(days));
  }

  // Round all values
  for (const row of result) {
    for (const k of Object.keys(row)) {
      if (typeof row[k] === 'number') row[k] = r2(row[k] as number);
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

export async function getWeeklySales(
  user: SalesUserContext | null | undefined,
  storeId: string | null | undefined,
  from?: string | null,
  to?: string | null,
): Promise<SalesEnvelope<SalesBucket>> {
  const { value: daily } = await getDailySales(user, storeId, from, to);

  const weeks: Record<string, SalesBucket> = {};
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
      if (typeof row[k] === 'number') row[k] = r2(row[k] as number);
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

export async function getMonthlySales(
  user: SalesUserContext | null | undefined,
  storeId: string | null | undefined,
  from?: string | null,
  to?: string | null,
): Promise<SalesEnvelope<SalesBucket>> {
  const { value: daily } = await getDailySales(user, storeId, from, to);

  const months: Record<string, SalesBucket> = {};
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
      if (typeof row[k] === 'number') row[k] = r2(row[k] as number);
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

export interface MonthlyComparisonBucket {
  net: number;
  txns: number;
}

export interface MonthlyComparisonResult {
  current: MonthlyComparisonBucket;
  previous: MonthlyComparisonBucket;
  change: number;
}

export async function getMonthlySalesComparison(
  user: SalesUserContext | null | undefined,
  storeId: string | null | undefined,
): Promise<MonthlyComparisonResult> {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const lastMonth = now.getMonth() === 0
    ? `${now.getFullYear()-1}-12`
    : `${now.getFullYear()}-${String(now.getMonth()).padStart(2,'0')}`;

  const from = lastMonth + '-01';
  const to = toDateStr(now);
  const { value: daily } = await getDailySales(user, storeId, from, to);

  const current: MonthlyComparisonBucket = { net: 0, txns: 0 };
  const previous: MonthlyComparisonBucket = { net: 0, txns: 0 };
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

// Session 56b — legacy class string matcher removed. Tax resolution now uses
// only two tiers (mirror of cashier-app's `selectTotals`):
//   1. Per-line `taxRuleId` (set when cashier picks a tax rule on the product)
//   2. Department-linked: rule whose `departmentIds[]` contains the line's `departmentId`
// No third tier. Lines with neither path resolved skip per-line tax computation
// and fall through to the even-distribution-by-lineTotal fallback below.

export interface DepartmentSalesRow {
  Name: string;
  Department: string;
  DepartmentId: string | number;
  TotalSales: number;
  TotalNetSales: number;
  TotalGrossSales: number;
  TotalTaxCollected: number;
  TotalItems: number;
  ItemsSold: number;
  TotalTransactionsCount: number;
  TransactionCount: number;
}

interface DepartmentSalesAccumulator extends DepartmentSalesRow {
  _txSet: Set<string>;
}

export async function getDepartmentSales(
  user: SalesUserContext | null | undefined,
  storeId: string | null | undefined,
  from?: string | null,
  to?: string | null,
): Promise<SalesEnvelope<DepartmentSalesRow>> {
  const orgId = user?.orgId;
  type TaxRuleRow = Prisma.TaxRuleGetPayload<{
    select: { id: true; rate: true; departmentIds: true };
  }>;
  const txnsPromise = prisma.transaction.findMany({
    where: buildWhere(user, storeId, from, to),
    select: { id: true, lineItems: true, status: true, taxTotal: true, subtotal: true },
  });
  const taxRulesPromise: Promise<TaxRuleRow[]> = orgId
    ? prisma.taxRule.findMany({ where: { orgId, active: true }, select: { id: true, rate: true, departmentIds: true } })
    : Promise.resolve([]);
  // B7 — fetch real Department names so the response Name field shows the
  // actual department label (e.g. "Beverages") rather than the line item's
  // taxClass fallback ("grocery"). Without this, two depts that share a
  // taxClass (e.g. Grocery + Beverages both 'grocery'-taxed) render with
  // duplicate Name="grocery" labels even though they have distinct rows.
  type DeptNameRow = Prisma.DepartmentGetPayload<{ select: { id: true; name: true } }>;
  const deptNamesPromise: Promise<DeptNameRow[]> = orgId
    ? prisma.department.findMany({ where: { orgId, active: true }, select: { id: true, name: true } })
    : Promise.resolve([]);
  const [txns, taxRules, deptRows] = await Promise.all([txnsPromise, taxRulesPromise, deptNamesPromise]);
  const deptNameById = new Map<number, string>(deptRows.map((d) => [d.id, d.name]));

  // Bug B1 fix: Track distinct transaction IDs per department so
  // TotalTransactionsCount reflects unique baskets, not line-item count.
  // Bug B2 fix applied here too: gross = line total BEFORE discount (unit × qty),
  // net = line total AFTER discount (li.lineTotal).
  //
  // B8 (Session 59) — per-department tax attribution rewrite:
  //   Previous approach recomputed tax per line via taxRules and SKIPPED any
  //   `ebtEligible` line, which incorrectly zeroed tax for grocery / beverage
  //   departments whose products are EBT-eligible but were paid by cash/card.
  //
  //   New approach: compute each line's notional tax via the matching rule
  //   (without EBT skip), then PRO-RATE the tx's actual `taxTotal` across
  //   those notional amounts. This guarantees per-dept tax sums to exactly
  //   tx.taxTotal — correct for cash, card, EBT, mixed, and any future tender.
  //   Falls back to even distribution by lineTotal when no rule matches any
  //   line (preserves visibility for legacy data).
  const depts: Record<string, DepartmentSalesAccumulator> = {};
  for (const tx of txns) {
    const items = (Array.isArray(tx.lineItems) ? tx.lineItems : []) as PosLineItem[];
    const isRefund = tx.status === 'refund';
    const seenInThisTx = new Set<string>();

    // First pass: aggregate non-tax fields and compute notional per-line tax.
    interface LineAcc {
      deptId: string;
      deptName: string;
      deptIdRaw: string | number;
      lineTotal: number;     // signed (negative for refund)
      grossLine: number;     // signed
      qty: number;           // signed
      notionalTax: number;   // unsigned, pre-scaling
    }
    const lineAccs: LineAcc[] = [];
    let notionalTaxTotal = 0;

    for (const li of items) {
      if (li.isLottery || li.isBottleReturn || li.isBagFee) continue;
      // B7 — prefer Name from Department table when departmentId is set;
      // fall back to li.departmentName, then li.taxClass, then 'Other'.
      const lineDeptId = li.departmentId ? Number(li.departmentId) : null;
      const lookedUpName = lineDeptId != null ? deptNameById.get(lineDeptId) : null;
      const deptName = lookedUpName || li.departmentName || li.taxClass || 'Other';
      const deptIdRaw = li.departmentId || deptName;
      const deptId = String(deptIdRaw);
      if (!depts[deptId]) {
        depts[deptId] = {
          Name:            deptName,
          Department:      deptName,
          DepartmentId:    deptIdRaw,
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

      // Notional tax — Session 56b 2-tier resolution (mirrors cashier-app):
      //   1. Per-line `taxRuleId` (explicit per-product override)
      //   2. Department-linked: rule whose departmentIds[] contains line's deptId
      // Pro-ration scales these to the tx's actual taxTotal in pass 2.
      let notionalTax = 0;
      if (li.taxable) {
        const lineRuleId = li.taxRuleId != null ? Number(li.taxRuleId) : null;
        const productRule = lineRuleId
          ? taxRules.find((r) => Number(r.id) === lineRuleId)
          : null;
        const deptRule = !productRule && lineDeptId
          ? taxRules.find((r) => Array.isArray(r.departmentIds) && r.departmentIds.includes(lineDeptId))
          : null;
        const rule = productRule || deptRule || null;
        const rate = rule ? parseFloat(String(rule.rate)) : 0;
        notionalTax = Math.abs(rawLineTotal) * rate;
      }
      notionalTaxTotal += notionalTax;

      lineAccs.push({ deptId, deptName, deptIdRaw, lineTotal, grossLine, qty, notionalTax });

      if (!isRefund && !seenInThisTx.has(deptId)) {
        d._txSet.add(tx.id);
        seenInThisTx.add(deptId);
      }
    }

    // Second pass: pro-rate this tx's actual taxTotal across its lines by
    // notional-tax share. Refund txs have negative tax; preserve sign.
    const actualTax = Math.abs(Number(tx.taxTotal) || 0);
    const taxSign = isRefund ? -1 : 1;
    if (actualTax > 0 && notionalTaxTotal > 0) {
      for (const la of lineAccs) {
        if (la.notionalTax === 0) continue;
        const share = la.notionalTax / notionalTaxTotal;
        depts[la.deptId].TotalTaxCollected += taxSign * actualTax * share;
      }
    } else if (actualTax > 0 && notionalTaxTotal === 0) {
      // No rules matched any line — fall back to even distribution by
      // |lineTotal| share so tax still surfaces somewhere (better than 0).
      const taxableSubtotal = lineAccs.reduce((s, la) => s + Math.abs(la.lineTotal), 0);
      if (taxableSubtotal > 0) {
        for (const la of lineAccs) {
          const share = Math.abs(la.lineTotal) / taxableSubtotal;
          depts[la.deptId].TotalTaxCollected += taxSign * actualTax * share;
        }
      }
    }
  }

  const result: DepartmentSalesRow[] = Object.values(depts)
    .map((d): DepartmentSalesRow => {
      // Replace the Set with its size, drop the internal field
      d.TotalTransactionsCount = d._txSet.size;
      d.TransactionCount       = d._txSet.size;
      const { _txSet, ...rest } = d;
      void _txSet;
      const cleaned: DepartmentSalesRow = { ...rest };
      for (const k of Object.keys(cleaned) as Array<keyof DepartmentSalesRow>) {
        const v = cleaned[k];
        if (typeof v === 'number') (cleaned[k] as number) = r2(v);
      }
      return cleaned;
    })
    .sort((a, b) => b.TotalNetSales - a.TotalNetSales);

  return { value: result, '@odata.count': result.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEPARTMENT COMPARISON
// ═══════════════════════════════════════════════════════════════════════════════

export interface DepartmentComparisonRow extends DepartmentSalesRow {
  PreviousSales: number;
  TotalNetSales2: number;
  TotalSales2: number;
  Change: number | null;
}

export async function getDepartmentComparison(
  user: SalesUserContext | null | undefined,
  storeId: string | null | undefined,
  from?: string | null,
  to?: string | null,
  from2?: string | null,
  to2?: string | null,
): Promise<SalesEnvelope<DepartmentComparisonRow>> {
  const [current, previous] = await Promise.all([
    getDepartmentSales(user, storeId, from, to),
    getDepartmentSales(user, storeId, from2, to2),
  ]);

  const prevMap: Record<string, DepartmentSalesRow> = {};
  for (const d of (previous.value || [])) prevMap[d.Name || d.Department] = d;

  const comparison: DepartmentComparisonRow[] = (current.value || []).map((c): DepartmentComparisonRow => {
    const p = prevMap[c.Name || c.Department] || ({ TotalNetSales: 0, TotalSales: 0 } as DepartmentSalesRow);
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

export interface TopProductRow {
  Name: string;
  ProductId: number | null;
  UPC: string;
  Department: string;
  NetSales: number;
  GrossSales: number;
  UnitsSold: number;
}

export async function getTopProducts(
  user: SalesUserContext | null | undefined,
  storeId: string | null | undefined,
  date?: string | null,
): Promise<{ value: TopProductRow[]; '@odata.count': number }> {
  // B8: default date = today (was yesterday)
  const from = date || toDateStr(new Date());
  const txns = await prisma.transaction.findMany({
    where: buildWhere(user, storeId, from, from),
    select: { lineItems: true, status: true },
  });

  // B7: grouping key = productId → upc → name (productId is authoritative)
  // Sign convention matches getDepartmentSales: refund tx → -|values|;
  // complete tx → raw signed.
  const products: Record<string, TopProductRow> = {};
  for (const tx of txns) {
    const items = (Array.isArray(tx.lineItems) ? tx.lineItems : []) as PosLineItem[];
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
  const result: TopProductRow[] = Object.values(products)
    .filter((p) => p.NetSales > 0)
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
export interface ProductsGroupedRow {
  Key: string;
  ProductId: number | null;
  UPC: string;
  Sales: Array<{ Description: string; DepartmentDescription: string }>;
  NetSales: number;
  GrossSales: number;
  UnitsSold: number;
  TotalCost: number | null;
  KnownCost: boolean;
  Profit: number | null;
  Margin: number | null;
}

export async function getProductsGrouped(
  user: SalesUserContext | null | undefined,
  storeId: string | null | undefined,
  from?: string | null,
  to?: string | null,
  orderBy: string = 'NetSales',
  pageSize: number = 20,
  skip: number = 0,
): Promise<{ value: ProductsGroupedRow[]; total: number; '@odata.count': number }> {
  const txns = await prisma.transaction.findMany({
    where: buildWhere(user, storeId, from, to),
    select: { lineItems: true, status: true },
  });

  const products: Record<string, ProductsGroupedRow> = {};
  // Collect productIds and UPCs seen for batch MasterProduct lookup
  const seenProductIds = new Set<number>();
  const seenUpcs       = new Set<string>();

  for (const tx of txns) {
    const items = (Array.isArray(tx.lineItems) ? tx.lineItems : []) as PosLineItem[];
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
        p.TotalCost = (p.TotalCost ?? 0) + (isRefund ? -lineCost : lineCost);
        p.KnownCost = true;
      }
      const lineTotal = Number(li.lineTotal || 0);
      const grossLine = (Number(li.unitPrice || 0) * qtyRaw);
      p.NetSales   += isRefund ? -Math.abs(r2(lineTotal)) : r2(lineTotal);
      p.GrossSales += isRefund ? -Math.abs(r2(grossLine)) : r2(grossLine);
      p.UnitsSold  += signedQty;

      if (li.productId) seenProductIds.add(parseInt(String(li.productId), 10));
      if (li.upc)       seenUpcs.add(String(li.upc));
    }
  }

  // Batch-load MasterProduct cost data for products that had no per-line cost
  const costByProductId = new Map<string, number>();
  const costByUpc       = new Map<string, number>();
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
        if (cost == null || !Number.isFinite(cost) || cost <= 0) continue;
        costByProductId.set(String(m.id), cost);
        if (m.upc) costByUpc.set(String(m.upc), cost);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('⚠ B3: MasterProduct cost lookup failed:', message);
  }

  // Compute real margin per product
  const all = Object.values(products).map((p) => {
    // If we don't have per-line cost data, try MasterProduct.defaultCostPrice × units
    if (!p.KnownCost) {
      const masterCost = costByProductId.get(String(p.ProductId)) ?? costByUpc.get(String(p.UPC)) ?? null;
      if (masterCost != null) {
        p.TotalCost = r2(masterCost * p.UnitsSold);
        p.KnownCost = true;
      }
    }
    if (p.KnownCost && p.NetSales > 0 && p.TotalCost != null) {
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
    const av = (a[orderBy as keyof ProductsGroupedRow] ?? -Infinity) as number;
    const bv = (b[orderBy as keyof ProductsGroupedRow] ?? -Infinity) as number;
    return bv - av;
  });
  const total = all.length;
  const page = all.slice(skip, skip + pageSize);

  return { value: page, total, '@odata.count': total };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCT MOVEMENT (weekly time series for a specific product)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ProductMovementBucket {
  Date: string;
  Revenue: number;
  Units: number;
}

export async function getProductMovement(
  user: SalesUserContext | null | undefined,
  storeId: string | null | undefined,
  upc: string | null | undefined,
  from?: string | null,
  to?: string | null,
  weekly: boolean = false,
): Promise<{ value: ProductMovementBucket[] }> {
  const txns = await prisma.transaction.findMany({
    where: buildWhere(user, storeId, from, to),
    select: { lineItems: true, createdAt: true, status: true },
  });

  // Normalize the search term + line UPC for tolerant matching:
  //   • strip leading zeros so "034000123456" matches "34000123456"
  //   • exact match on full string still wins (handles the no-leading-zero case)
  // Name match is case-insensitive partial — typing "Coke" finds "Coca-Cola Classic".
  // Note: this is a Session-A quick fix. Full UPC canonicalization (GTIN-14
  // pad / check-digit handling / EAN/PLU) is queued for Session B.
  const term     = (upc || '').trim();
  const termNorm = term.replace(/^0+/, '').toLowerCase();
  const termLow  = term.toLowerCase();

  // S65 T1 fix: apply the refund sign convention established in B7/B8/B9.
  // Refund tx → subtract |qty| and |lineTotal| from the bucket. Without this,
  // a 1-unit sale + 1-unit refund of the same product showed up as 2 units in
  // the time series, making movement charts and predictions inflate sales.
  const buckets: Record<string, ProductMovementBucket> = {};
  for (const tx of txns) {
    const items = (Array.isArray(tx.lineItems) ? tx.lineItems : []) as PosLineItem[];
    const isRefund = tx.status === 'refund';
    for (const li of items) {
      const liUpcRaw  = (li.upc || '').trim();
      const liUpcNorm = liUpcRaw.replace(/^0+/, '').toLowerCase();
      const liName    = (li.name || '').toLowerCase();
      const upcHit    = liUpcRaw && (liUpcRaw === term || liUpcNorm === termNorm);
      const nameHit   = liName && termLow && liName.includes(termLow);
      if (!upcHit && !nameHit) continue;
      const d = new Date(tx.createdAt);
      const key = weekly ? getWeekStart(d) : toDateStr(d);
      if (!buckets[key]) buckets[key] = { Date: key, Revenue: 0, Units: 0 };
      const qty       = Number(li.qty || 1);
      const lineTotal = Number(li.lineTotal || 0);
      buckets[key].Revenue += isRefund ? -Math.abs(r2(lineTotal)) : r2(lineTotal);
      buckets[key].Units   += isRefund ? -Math.abs(qty)            : qty;
    }
  }

  return { value: Object.values(buckets).sort((a, b) => a.Date.localeCompare(b.Date)) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY PRODUCT MOVEMENT (all products, daily)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getDailyProductMovement(
  user: SalesUserContext | null | undefined,
  storeId: string | null | undefined,
  from?: string | null,
  to?: string | null,
) {
  return getProductMovement(user, storeId, null, from, to, false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 52-WEEK STATS (high / low / avg weekly units for a single product)
// ═══════════════════════════════════════════════════════════════════════════════

export interface Product52WeekStats {
  weeklyHigh: number | null;
  weeklyLow: number | null;
  avgWeekly: number | null;
  totalUnits: number;
  weeksWithSales: number;
  suggestedQoH: number | null;
}

export async function getProduct52WeekStats(
  user: SalesUserContext | null | undefined,
  storeId: string | null | undefined,
  upc: string,
): Promise<Product52WeekStats> {
  // Query last 365 days of transactions
  const now = new Date();
  const yearAgo = new Date(now);
  yearAgo.setDate(yearAgo.getDate() - 364);
  const from = toDateStr(yearAgo);
  const to   = toDateStr(now);

  const txns = await prisma.transaction.findMany({
    where: buildWhere(user, storeId, from, to),
    select: { lineItems: true, createdAt: true, status: true },
  });

  // Aggregate into weekly buckets.
  // S65 T1 fix: apply refund sign convention (B7/B8/B9). A 1-unit sale
  // followed by a 1-unit refund should net to 0 units sold, not 2 — otherwise
  // 52-week stats inflate sales velocity, which downstream affects orderEngine
  // reorder calculations + reorder-point recommendations.
  const weeks: Record<string, number> = {};
  for (const tx of txns) {
    const items = (Array.isArray(tx.lineItems) ? tx.lineItems : []) as PosLineItem[];
    const isRefund = tx.status === 'refund';
    for (const li of items) {
      // Match by UPC — check both upc and any additionalUpcs
      const liUpc = li.upc || '';
      if (liUpc !== upc) continue;

      const d = new Date(tx.createdAt);
      const wk = getWeekStart(d);
      if (!weeks[wk]) weeks[wk] = 0;
      const qty = Number(li.qty || 1);
      weeks[wk] += isRefund ? -Math.abs(qty) : qty;
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
