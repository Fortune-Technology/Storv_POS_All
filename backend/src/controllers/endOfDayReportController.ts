/**
 * End-of-Day Report Controller
 *
 * Produces the store-level EoD reconciliation report with three sections:
 *   1. PAYOUTS       (Cashback, Loans, Pickups, Paid-ins, Paid-outs,
 *                     Received on Acct, Refunds, Tips, Voids)
 *   2. TENDER        (Cash, EBT Cash, Check, Debit Card, Credit Card,
 *                     EFS, Paper FS, In-store charge, Store Giftcard)
 *   3. TRANSACTIONS  (Avg Tx, Net Sales, Gross Sales, Cash Collected)
 *
 * Usage:
 *   GET /api/reports/end-of-day
 *     ?shiftId=...                        (single shift — cashier app default)
 *     OR
 *     ?date=YYYY-MM-DD                    (single day)
 *     ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 *     Additional filters:
 *     ?storeId=...
 *     ?cashierId=...
 *     ?stationId=...
 *
 * Response shape matches what both the back-office EndOfDayReport.jsx page
 * and the cashier-app thermal-printer template need to render.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma, Shift, CashPayout, CashDrop } from '@prisma/client';
import prisma from '../config/postgres.js';
import { reconcileShift } from '../services/reconciliation/shift/index.js';
import type { ShiftReconciliation } from '../services/reconciliation/shift/index.js';

const r2 = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n: unknown): number => Math.round((Number(n) || 0) * 1000) / 1000;

// ─── Local-day window helpers (same as listTransactions fix) ────────────────
const startOfLocalDay = (str: string): Date => {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};
const endOfLocalDay = (str: string): Date => {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
};

// ─── Tender method normalization (maps to the 9 report categories) ─────────
// Accepts the variety of method strings that tenderLines can have in the
// wild (legacy 'card' / 'credit' / 'debit' / 'ebt' etc.) and maps them to
// a stable label used in the report.
interface TenderCategory {
  key: string;
  label: string;
}

export const TENDER_CATEGORIES: TenderCategory[] = [
  { key: 'cash',          label: 'Cash'                  },
  { key: 'ebt_cash',      label: 'EBT Cash'              },
  { key: 'check',         label: 'Check'                 },
  { key: 'debit',         label: 'Debit Card'            },
  { key: 'credit',        label: 'Credit Card'           },
  { key: 'efs',           label: 'Electronic Food Stamp' },
  { key: 'paper_fs',      label: 'Paper Food Stamp'      },
  { key: 'house_charge',  label: 'In-store Charge'       },
  { key: 'gift_card',     label: 'Store Gift Card'       },
];

function mapTenderMethod(method: unknown): string | null {
  const m = String(method || '').toLowerCase().trim();
  if (!m) return null;
  if (m === 'cash')                                      return 'cash';
  if (m === 'ebt_cash' || m === 'ebtcash')               return 'ebt_cash';
  if (m === 'check' || m === 'cheque')                   return 'check';
  if (m === 'debit' || m === 'debit_card')               return 'debit';
  if (m === 'credit' || m === 'credit_card' || m === 'card') return 'credit';
  if (m === 'efs' || m === 'ebt' || m === 'ebt_food' || m === 'snap') return 'efs';
  if (m === 'paper_fs' || m === 'paper_food_stamp' || m === 'wic') return 'paper_fs';
  if (m === 'charge' || m === 'house' || m === 'house_charge' || m === 'account' || m === 'house_account') return 'house_charge';
  if (m === 'gift' || m === 'gift_card' || m === 'giftcard' || m === 'store_credit') return 'gift_card';
  return null;
}

// ─── Payout/event category mapping (9 categories) ───────────────────────────
// Covers every cash-movement event the user wants reported.
interface PayoutCategory {
  key: string;
  label: string;
}

export const PAYOUT_CATEGORIES: PayoutCategory[] = [
  { key: 'cashback',         label: 'Cashback'             }, // cashback given on card purchases
  { key: 'loans',            label: 'Loans'                }, // CashPayout.payoutType='loan'
  { key: 'pickups',          label: 'Pickups'              }, // CashDrop (cash removed for safety)
  { key: 'paid_in',          label: 'Paid-in'              }, // CashPayout.payoutType='paid_in' (rare)
  { key: 'paid_out',         label: 'Paid-out'             }, // generic expense CashPayout
  { key: 'received_on_acct', label: 'Received on Account'  }, // house-charge payments (tender=house_charge on refund-flow)
  { key: 'refunds',          label: 'Refunds'              }, // Transaction.status='refund'
  { key: 'tips',             label: 'Tips'                 }, // lineItem.isTip or tenderLines 'tip'
  { key: 'voids',            label: 'Voids'                }, // Transaction.status='voided'
];

// Shift with the included relations used by resolveScope
type ShiftWithEvents = Shift & {
  drops: CashDrop[];
  payouts: CashPayout[];
};

interface Scope {
  orgId: string;
  storeId: string | null;
  cashierId: string | null;
  stationId: string | null;
  cashierName: string | null;
  stationName: string | null;
  from: Date;
  to: Date;
  shift: ShiftWithEvents | null;
}

// ─── Build where clauses for a given scope ──────────────────────────────────
async function resolveScope(req: Request): Promise<Scope> {
  const orgId = req.orgId || req.user?.orgId;
  if (!orgId) throw Object.assign(new Error('orgId not resolved'), { statusCode: 400 });

  const q = (req.query || {}) as {
    shiftId?: string;
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    storeId?: string;
    cashierId?: string;
    stationId?: string;
  };
  const { shiftId, date, dateFrom, dateTo, storeId, cashierId, stationId } = q;

  // 1. If shiftId provided — use the shift's time window and cashier
  if (shiftId) {
    const shift = await prisma.shift.findFirst({
      where: { id: shiftId, orgId },
      include: { drops: true, payouts: true },
    });
    if (!shift) {
      const e = Object.assign(new Error('Shift not found'), { statusCode: 404 });
      throw e;
    }
    const [cashier, station] = await Promise.all([
      prisma.user.findUnique({ where: { id: shift.cashierId }, select: { name: true } }),
      shift.stationId ? prisma.station.findUnique({ where: { id: shift.stationId }, select: { name: true } }) : null,
    ]);
    return {
      orgId,
      storeId: shift.storeId,
      cashierId: shift.cashierId,
      stationId: shift.stationId,
      cashierName: cashier?.name || 'Unknown',
      stationName: (station as { name?: string } | null)?.name || null,
      from: shift.openedAt,
      to:   shift.closedAt || new Date(),
      shift: shift as unknown as ShiftWithEvents,
    };
  }

  // 2. Otherwise explicit date window + optional cashier/station/store filters
  const effectiveStoreId = storeId || req.storeId || null;
  let from: Date;
  let to: Date;
  if (dateFrom || dateTo) {
    from = dateFrom ? startOfLocalDay(dateFrom) : startOfLocalDay(dateTo as string);
    to   = dateTo   ? endOfLocalDay(dateTo)   : endOfLocalDay(dateFrom as string);
  } else if (date) {
    from = startOfLocalDay(date);
    to   = endOfLocalDay(date);
  } else {
    // Default: today
    const nowStr = new Date().toISOString().slice(0, 10);
    from = startOfLocalDay(nowStr);
    to   = endOfLocalDay(nowStr);
  }

  // Resolve names for the header
  const [cashier, station] = await Promise.all([
    cashierId ? prisma.user.findUnique({ where: { id: cashierId }, select: { name: true } }) : null,
    stationId ? prisma.station.findUnique({ where: { id: stationId }, select: { name: true } }) : null,
  ]);

  const stationName = (station as { name?: string } | null)?.name || null;

  return {
    orgId,
    storeId: effectiveStoreId,
    cashierId: cashierId || null,
    stationId: stationId || null,
    cashierName: cashier?.name || null,
    stationName,
    from, to,
    shift: null,
  };
}

// ─── Aggregate transactions (tender, gross/net, cash collected) ─────────────
interface TenderRow {
  key: string;
  label: string;
  count: number;
  amount: number;
}

interface TxAgg {
  tenderMap: Record<string, TenderRow>;
  completeCount: number;
  refundCount: number;
  refundAmount: number;
  voidCount: number;
  voidAmount: number;
  grossSales: number;
  netSales: number;
  taxCollected: number;
  cashCollected: number;
  cashBackCount: number;
  cashBackTotal: number;
  tipsCount: number;
  tipsTotal: number;
  depositsCollected: number;
  depositsRefunded: number;
  bagFeeTotal: number;
  bagFeeQty: number;
  // Session 52 — Dual Pricing aggregation
  // Drives the EoD "DUAL PRICING SUMMARY" section. Helps managers reconcile
  // what was collected on cards (incl. surcharge) vs cash (incl. potential
  // savings) when the store runs the dual_pricing model.
  dualPricingActive: boolean;
  surchargeCollected: number;       // Σ surchargeAmount (positive on completes, negative on refunds)
  surchargeTaxCollected: number;    // Σ surchargeTaxAmount
  surchargedTxCount: number;        // # of completes with surchargeAmount > 0 (card txs)
  cashTxOnDualCount: number;        // # of completes on dual_pricing with surchargeAmount = 0 (cash + EBT)
  cashSavingsTotal: number;         // Σ "what cash customers saved" — sum of surcharge that WOULD have applied
}

interface TenderLineEntry {
  method?: string | null;
  amount?: number | string | null;
  isTip?: boolean;
}

interface LineItemEntry {
  isBagFee?: boolean;
  isTip?: boolean;
  isCashback?: boolean;
  qty?: number | string | null;
  lineTotal?: number | string | null;
}

async function aggregateTransactions(scope: Scope): Promise<TxAgg> {
  const where: Prisma.TransactionWhereInput = {
    orgId: scope.orgId,
    createdAt: { gte: scope.from, lte: scope.to },
  };
  if (scope.storeId)   where.storeId   = scope.storeId;
  if (scope.cashierId) where.cashierId = scope.cashierId;
  if (scope.stationId) where.stationId = scope.stationId;
  // Include complete + refund + voided — report counts each separately
  where.status = { in: ['complete', 'refund', 'voided'] };

  const txns = await prisma.transaction.findMany({
    where,
    select: {
      id: true, status: true, subtotal: true, taxTotal: true, depositTotal: true, grandTotal: true,
      changeGiven: true, tenderLines: true, lineItems: true, createdAt: true,
      // Session 52 — Dual Pricing snapshot fields persisted on every tx since Session 51
      pricingModel: true, baseSubtotal: true, surchargeAmount: true, surchargeTaxAmount: true,
      surchargeRate: true, surchargeFixedFee: true, surchargeTaxable: true,
    },
  });

  // Initialise tender counters
  const tenderMap: Record<string, TenderRow> = {};
  for (const c of TENDER_CATEGORIES) tenderMap[c.key] = { key: c.key, label: c.label, count: 0, amount: 0 };

  // Tx counters
  let completeCount  = 0;
  let refundCount    = 0, refundAmount    = 0;
  let voidCount      = 0, voidAmount      = 0;
  let grossSales     = 0;   // Σ grandTotal (B2: tender total, incl. tax)
  let netSales       = 0;   // Σ subtotal   (B2: pre-tax, post-discount)
  let taxCollected   = 0;
  let cashCollected  = 0;   // Σ cash tenderLines.amount − Σ changeGiven
  let cashBackTotal  = 0, cashBackCount = 0;
  let tipsTotal      = 0, tipsCount = 0;

  // Pass-through fees — NOT revenue, NOT profit. Reported separately so the
  // retailer can reconcile what they collected on behalf of the state (deposits)
  // vs what they charged for disposable bags. Both are already baked into
  // grandTotal, so nothing else needs to change in the math.
  let depositsCollected = 0;   // Σ Transaction.depositTotal
  let depositsRefunded  = 0;   // tracked on refund txs
  let bagFeeTotal       = 0;   // Σ lineItems where isBagFee
  let bagFeeQty         = 0;   // Σ bag counts

  // Session 52 — Dual Pricing aggregation
  let dualPricingActive   = false;
  let surchargeCollected    = 0;
  let surchargeTaxCollected = 0;
  let surchargedTxCount     = 0;
  let cashTxOnDualCount     = 0;
  let cashSavingsTotal      = 0;

  for (const tx of txns) {
    const gt = Number(tx.grandTotal) || 0;
    const st = Number(tx.subtotal)   || 0;
    const tt = Number(tx.taxTotal)   || 0;
    const dt = Number(tx.depositTotal) || 0;
    const ch = Number(tx.changeGiven) || 0;

    if (tx.status === 'voided') {
      voidCount += 1;
      voidAmount += Math.abs(gt);
      continue;
    }
    if (tx.status === 'refund') {
      refundCount += 1;
      refundAmount += Math.abs(gt);
      // Refunds reduce gross/net
      grossSales -= Math.abs(gt);
      netSales   -= Math.abs(st);
      taxCollected -= Math.abs(tt);
      depositsRefunded += Math.abs(dt);
    } else {
      completeCount += 1;
      grossSales   += gt;
      netSales     += st;
      taxCollected += tt;
      depositsCollected += dt;
    }

    // Session 52 — Dual Pricing per-tx aggregation
    // Surcharge fields are stored signed (positive on completes, negative on
    // refunds), so summing across statuses naturally nets out.
    if (tx.pricingModel === 'dual_pricing') {
      dualPricingActive = true;
      const sa  = Number(tx.surchargeAmount    || 0);
      const sat = Number(tx.surchargeTaxAmount || 0);
      surchargeCollected    += sa;
      surchargeTaxCollected += sat;
      if (tx.status === 'complete') {
        if (Math.abs(sa) > 0.005) {
          surchargedTxCount += 1;
        } else {
          // Cash/EBT tender on a dual_pricing store. The surcharge that WOULD
          // have applied to a card payment is what the customer "saved".
          cashTxOnDualCount += 1;
          const baseSub = Number(tx.baseSubtotal || tx.subtotal || 0);
          const rate    = Number(tx.surchargeRate || 0);
          const fee     = Number(tx.surchargeFixedFee || 0);
          if (baseSub > 0 && (rate > 0 || fee > 0)) {
            // What card-tender would have charged: base × pct + fixed (+ tax if taxable)
            const wouldBe = (baseSub * rate / 100) + fee;
            const wouldBeTax = tx.surchargeTaxable && tt > 0 && st > 0
              ? wouldBe * (tt / st)   // mirror tax rate from this tx
              : 0;
            cashSavingsTotal += Math.round((wouldBe + wouldBeTax) * 100) / 100;
          }
        }
      }
    }

    // Bag fees — stored as synthetic line items with isBagFee:true
    const liArr: LineItemEntry[] = Array.isArray(tx.lineItems) ? (tx.lineItems as unknown as LineItemEntry[]) : [];
    for (const li of liArr) {
      if (li.isBagFee) {
        const amt = Number(li.lineTotal) || 0;
        const q   = Number(li.qty) || 1;
        if (tx.status === 'refund') { bagFeeTotal -= Math.abs(amt); bagFeeQty -= Math.abs(q); }
        else                         { bagFeeTotal += amt;          bagFeeQty += q; }
      }
    }

    // Tender breakdown per tenderLines entry
    const tenders: TenderLineEntry[] = Array.isArray(tx.tenderLines) ? (tx.tenderLines as unknown as TenderLineEntry[]) : [];
    let cashLineAmt = 0;
    for (const t of tenders) {
      const cat = mapTenderMethod(t.method);
      const amt = Number(t.amount) || 0;
      if (cat && tenderMap[cat]) {
        tenderMap[cat].count  += 1;
        tenderMap[cat].amount += amt;
      }
      if (cat === 'cash') cashLineAmt += amt;
      // Tips may be denoted with method='tip' or a separate tip field
      if (t.method === 'tip' || t.isTip) {
        tipsCount += 1;
        tipsTotal += amt;
      }
    }

    // Cash collected (what actually stayed in the drawer from cash tender):
    // For sales: cashLineAmt − changeGiven
    // For refunds: cash paid OUT goes negative
    if (tx.status === 'refund') {
      cashCollected -= cashLineAmt;   // cash refunded = cash leaving drawer
    } else {
      cashCollected += cashLineAmt - ch;
      // Cashback tender method — occasionally stored as method='cashback'
      for (const t of tenders) {
        if (String(t.method || '').toLowerCase() === 'cashback') {
          cashBackCount += 1;
          cashBackTotal += Number(t.amount) || 0;
        }
      }
      // Line-item fallback for tips / cashback
      const items: LineItemEntry[] = Array.isArray(tx.lineItems) ? (tx.lineItems as unknown as LineItemEntry[]) : [];
      for (const li of items) {
        if (li.isTip) { tipsCount += 1; tipsTotal += Number(li.lineTotal) || 0; }
        if (li.isCashback) { cashBackCount += 1; cashBackTotal += Math.abs(Number(li.lineTotal) || 0); }
      }
    }
  }

  return {
    tenderMap,
    completeCount, refundCount, refundAmount, voidCount, voidAmount,
    grossSales, netSales, taxCollected, cashCollected,
    cashBackCount, cashBackTotal, tipsCount, tipsTotal,
    depositsCollected, depositsRefunded, bagFeeTotal, bagFeeQty,
    // Session 52 — Dual Pricing
    dualPricingActive,
    surchargeCollected, surchargeTaxCollected,
    surchargedTxCount, cashTxOnDualCount, cashSavingsTotal,
  };
}

// ─── Aggregate fuel transactions for the scope window ──────────────────────
interface FuelRow {
  fuelTypeId: string | null;
  name: string;
  gradeLabel: string | null;
  color: string | null;
  salesGallons: number;
  salesAmount: number;
  salesCount: number;
  refundGallons: number;
  refundAmount: number;
  refundCount: number;
  netGallons: number;
  netAmount: number;
  avgPrice: number;
}

interface FuelAgg {
  rows: FuelRow[];
  totals: {
    gallons: number;
    amount: number;
    salesGallons: number;
    salesAmount: number;
    refundGallons: number;
    refundAmount: number;
    salesCount: number;
    refundCount: number;
    avgPrice: number;
  };
}

async function aggregateFuel(scope: Scope): Promise<FuelAgg> {
  const where: Prisma.FuelTransactionWhereInput = {
    orgId:     scope.orgId,
    createdAt: { gte: scope.from, lte: scope.to },
  };
  if (scope.storeId)   where.storeId   = scope.storeId;
  if (scope.cashierId) where.cashierId = scope.cashierId;
  if (scope.stationId) where.stationId = scope.stationId;
  if (scope.shift)     where.shiftId   = scope.shift.id;

  const txs = await prisma.fuelTransaction.findMany({
    where,
    include: { fuelType: { select: { name: true, gradeLabel: true, color: true } } },
  });

  const byType = new Map<string, FuelRow>();
  let totalSalesGallons = 0, totalSalesAmount = 0;
  let totalRefundGallons = 0, totalRefundAmount = 0;
  let salesCount = 0, refundCount = 0;

  type FuelTxRow = (typeof txs)[number];
  for (const t of txs as FuelTxRow[]) {
    const tt = t as unknown as { fuelTypeId?: string | null; fuelTypeName?: string | null; fuelType?: { name?: string; gradeLabel?: string | null; color?: string | null } | null; type?: string; gallons?: number | string | null; amount?: number | string | null };
    const id = tt.fuelTypeId || `__${tt.fuelTypeName || 'unknown'}`;
    if (!byType.has(id)) {
      byType.set(id, {
        fuelTypeId: tt.fuelTypeId || null,
        name:       tt.fuelType?.name || tt.fuelTypeName || 'Fuel',
        gradeLabel: tt.fuelType?.gradeLabel || null,
        color:      tt.fuelType?.color || null,
        salesGallons: 0, salesAmount: 0, salesCount: 0,
        refundGallons: 0, refundAmount: 0, refundCount: 0,
        netGallons: 0, netAmount: 0,
        avgPrice: 0,
      });
    }
    const row = byType.get(id) as FuelRow;
    const gal = Number(tt.gallons) || 0;
    const amt = Number(tt.amount)  || 0;
    if (tt.type === 'refund') {
      row.refundGallons += gal;
      row.refundAmount  += amt;
      row.refundCount   += 1;
      totalRefundGallons += gal; totalRefundAmount += amt; refundCount += 1;
    } else {
      row.salesGallons += gal;
      row.salesAmount  += amt;
      row.salesCount   += 1;
      totalSalesGallons += gal; totalSalesAmount += amt; salesCount += 1;
    }
  }

  const rows: FuelRow[] = Array.from(byType.values()).map(r => {
    r.netGallons = r.salesGallons - r.refundGallons;
    r.netAmount  = r.salesAmount  - r.refundAmount;
    r.avgPrice   = r.netGallons > 0 ? r.netAmount / r.netGallons : 0;
    r.salesGallons  = r3(r.salesGallons);
    r.salesAmount   = r2(r.salesAmount);
    r.refundGallons = r3(r.refundGallons);
    r.refundAmount  = r2(r.refundAmount);
    r.netGallons    = r3(r.netGallons);
    r.netAmount     = r2(r.netAmount);
    r.avgPrice      = r3(r.avgPrice);
    return r;
  }).sort((a, b) => b.netAmount - a.netAmount);

  const totalGallons = totalSalesGallons - totalRefundGallons;
  const totalAmount  = totalSalesAmount  - totalRefundAmount;

  return {
    rows,
    totals: {
      gallons:        r3(totalGallons),
      amount:         r2(totalAmount),
      salesGallons:   r3(totalSalesGallons),
      salesAmount:    r2(totalSalesAmount),
      refundGallons:  r3(totalRefundGallons),
      refundAmount:   r2(totalRefundAmount),
      salesCount,
      refundCount,
      avgPrice:       r3(totalGallons > 0 ? totalAmount / totalGallons : 0),
    },
  };
}

// ─── Lottery summary (sales / payouts / net cash) ──────────────────────────
// Mirror of the fuel block — per-game rows + overall totals — for the
// "ledger view" of lottery activity in the EoD report. Distinct from the
// `reconciliation.lottery` cash-flow detail (which exists for cash-drawer
// math and tracks ticket-math truth, machine flow, unreported instants,
// etc.). This block is the simple accountant-friendly view:
//   • Lottery sale     = Σ amount where type='sale'
//   • Lottery payouts  = Σ amount where type='payout'
//   • Lottery cash     = sale − payouts (net cash retained from lottery)
//
// Uses the existing LotteryTransaction table directly — no dependency on
// the snapshot-based reconciliation engine. Source of truth for what was
// actually rung up at the register; if a cashier under-reports tickets,
// the reconciliation block in the receipt surfaces the gap separately.
interface LotteryRow {
  gameId: string | null;
  gameName: string;
  saleAmount: number;
  saleCount: number;
  payoutAmount: number;
  payoutCount: number;
  netCash: number;
}

interface LotteryAgg {
  rows: LotteryRow[];
  totals: {
    saleAmount: number;
    saleCount: number;
    payoutAmount: number;
    payoutCount: number;
    netCash: number;
  };
}

async function aggregateLottery(scope: Scope): Promise<LotteryAgg> {
  const where: Prisma.LotteryTransactionWhereInput = {
    orgId:     scope.orgId,
    createdAt: { gte: scope.from, lte: scope.to },
  };
  if (scope.storeId)   where.storeId   = scope.storeId;
  if (scope.cashierId) where.cashierId = scope.cashierId;
  if (scope.stationId) where.stationId = scope.stationId;
  if (scope.shift)     where.shiftId   = scope.shift.id;

  // Fetch transactions + the games they reference so we can label the rows
  // with human game names. Using `include` keeps it to one query.
  const txs = await prisma.lotteryTransaction.findMany({
    where,
    select: {
      type: true, amount: true, gameId: true,
    },
  });

  // Pre-fetch game names for any gameIds we saw, in one round trip.
  type LotteryTxRow = { type: string; amount: unknown; gameId: string | null };
  type LotteryGameRow = { id: string; name: string };
  const gameIds = Array.from(
    new Set((txs as LotteryTxRow[]).map((t) => t.gameId).filter(Boolean) as string[]),
  );
  const games: LotteryGameRow[] = gameIds.length
    ? await prisma.lotteryGame.findMany({
        where: { id: { in: gameIds } },
        select: { id: true, name: true },
      })
    : [];
  const gameNameById = new Map<string, string>(games.map((g: LotteryGameRow) => [g.id, g.name]));

  const byGame = new Map<string, LotteryRow>();
  let totalSaleAmount = 0, totalPayoutAmount = 0;
  let totalSaleCount = 0, totalPayoutCount = 0;

  for (const t of txs) {
    const key = t.gameId || '__no_game__';
    if (!byGame.has(key)) {
      byGame.set(key, {
        gameId:   t.gameId || null,
        gameName: t.gameId ? (gameNameById.get(t.gameId) || `Game ${t.gameId.slice(0, 6)}`) : 'Unspecified',
        saleAmount:   0, saleCount:   0,
        payoutAmount: 0, payoutCount: 0,
        netCash:      0,
      });
    }
    const row = byGame.get(key) as LotteryRow;
    const amt = Number(t.amount) || 0;
    if (t.type === 'payout') {
      row.payoutAmount += amt;
      row.payoutCount  += 1;
      totalPayoutAmount += amt;
      totalPayoutCount  += 1;
    } else {
      row.saleAmount += amt;
      row.saleCount  += 1;
      totalSaleAmount += amt;
      totalSaleCount  += 1;
    }
  }

  const rows: LotteryRow[] = Array.from(byGame.values()).map(r => {
    r.netCash      = r.saleAmount - r.payoutAmount;
    r.saleAmount   = r2(r.saleAmount);
    r.payoutAmount = r2(r.payoutAmount);
    r.netCash      = r2(r.netCash);
    return r;
  }).sort((a, b) => b.saleAmount - a.saleAmount);

  return {
    rows,
    totals: {
      saleAmount:   r2(totalSaleAmount),
      saleCount:    totalSaleCount,
      payoutAmount: r2(totalPayoutAmount),
      payoutCount:  totalPayoutCount,
      netCash:      r2(totalSaleAmount - totalPayoutAmount),
    },
  };
}

// ─── Department breakdown (S67 — opt-in via store.pos.eodReport.showDepartmentBreakdown) ──
//
// Pulls every transaction in scope window and bucket-sums net revenue +
// tx-count per department. Refunds subtract (B7/B8/B9 sign convention).
// Lottery + Fuel transactions get their own synthetic rows so the breakdown
// is a complete revenue picture, not just non-lottery / non-fuel sales.
interface DepartmentRow {
  departmentId: number | string | null;
  name: string;
  netSales: number;
  txCount: number;
  lineCount: number;
}

interface LineForDept {
  productId?: string | number | null;
  departmentId?: number | string | null;
  departmentName?: string | null;
  taxClass?: string | null;
  qty?: number | string | null;
  lineTotal?: number | string | null;
  isLottery?: boolean;
  isBottleReturn?: boolean;
  isBagFee?: boolean;
  isFuel?: boolean;
}

async function aggregateDepartments(scope: Scope): Promise<{ rows: DepartmentRow[]; total: number }> {
  // Department name lookup — line items only carry departmentId; many older
  // rows have null departmentName so we resolve from the live Department table.
  const depts = await prisma.department.findMany({
    where: { orgId: scope.orgId, active: true },
    select: { id: true, name: true },
  });
  const deptNameById = new Map<number, string>(depts.map((d: { id: number; name: string }) => [d.id, d.name]));

  const txWhere: Prisma.TransactionWhereInput = {
    orgId:     scope.orgId,
    status:    { in: ['complete', 'refund'] },
    createdAt: { gte: scope.from, lte: scope.to },
  };
  if (scope.storeId)   txWhere.storeId   = scope.storeId;
  if (scope.cashierId) txWhere.cashierId = scope.cashierId;
  if (scope.stationId) txWhere.stationId = scope.stationId;
  if (scope.shift)     txWhere.shiftId   = scope.shift.id;

  const txs = await prisma.transaction.findMany({
    where: txWhere,
    select: { id: true, status: true, lineItems: true },
  });

  const buckets = new Map<string, DepartmentRow>();
  const txCountByBucket = new Map<string, Set<string>>();

  for (const tx of txs) {
    const items = (Array.isArray(tx.lineItems) ? tx.lineItems : []) as LineForDept[];
    const isRefund = tx.status === 'refund';
    for (const li of items) {
      if (li.isBagFee) continue;     // bag fees are pass-through, skip
      if (li.isBottleReturn) continue; // bottle returns are pass-through, skip
      // Pick a synthetic bucket key + name for lottery/fuel; otherwise use deptId
      let key: string;
      let name: string;
      let deptId: number | string | null = null;
      if (li.isLottery) {
        key  = '__lottery__';
        name = 'Lottery';
      } else if (li.isFuel) {
        key  = '__fuel__';
        name = 'Fuel';
      } else {
        const did = li.departmentId != null ? Number(li.departmentId) : null;
        deptId = did;
        key = did == null ? '__nodept__' : String(did);
        name = (did != null && deptNameById.get(did)) || li.departmentName || li.taxClass || 'Other';
      }
      if (!buckets.has(key)) {
        buckets.set(key, { departmentId: deptId, name, netSales: 0, txCount: 0, lineCount: 0 });
      }
      const row = buckets.get(key)!;
      const qty       = Number(li.qty || 1);
      const lineTotal = Number(li.lineTotal || 0);
      row.netSales  += isRefund ? -Math.abs(lineTotal) : lineTotal;
      row.lineCount += isRefund ? -Math.abs(qty)       : qty;
      // Track unique tx ids per bucket for txCount
      if (!txCountByBucket.has(key)) txCountByBucket.set(key, new Set<string>());
      txCountByBucket.get(key)!.add(tx.id);
    }
  }

  // Finalise + round
  const rows: DepartmentRow[] = Array.from(buckets.entries()).map(([key, row]) => ({
    ...row,
    netSales: r2(row.netSales),
    txCount:  txCountByBucket.get(key)?.size || 0,
  })).sort((a, b) => b.netSales - a.netSales);

  const total = r2(rows.reduce((s, r) => s + r.netSales, 0));
  return { rows, total };
}

// ─── Aggregate shift-scoped payouts and drops ───────────────────────────────
// When scope has a specific shift, we pull the shift's drops[] / payouts[]
// directly. Otherwise we query CashPayout / CashDrop by date range.
interface CashEvents {
  payouts: CashPayout[];
  drops: CashDrop[];
}

async function aggregateCashEvents(scope: Scope): Promise<CashEvents> {
  if (scope.shift) {
    return {
      payouts: scope.shift.payouts || [],
      drops:   scope.shift.drops   || [],
    };
  }

  // CashDrop / CashPayout don't have a direct storeId column — they're scoped via shift.
  // Filter by shift.storeId when a storeId is provided.
  const baseWhere = {
    orgId:     scope.orgId,
    createdAt: { gte: scope.from, lte: scope.to },
    ...(scope.storeId ? { shift: { storeId: scope.storeId } } : {}),
  };

  const [payouts, drops] = await Promise.all([
    prisma.cashPayout.findMany({ where: baseWhere as Prisma.CashPayoutWhereInput, orderBy: { createdAt: 'asc' } }),
    prisma.cashDrop  .findMany({ where: baseWhere as Prisma.CashDropWhereInput,  orderBy: { createdAt: 'asc' } }),
  ]);

  return { payouts, drops };
}

// ─── MAIN ENDPOINT ──────────────────────────────────────────────────────────
interface PayoutRow {
  key: string;
  label: string;
  count: number;
  amount: number;
}

export const getEndOfDayReport = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const scope = await resolveScope(req);

    // ── S67: read store-level EoD report settings ───────────────────────────
    // Stored in store.pos.eodReport JSON. Defaults are conservative — keep
    // current behavior unchanged for stores that haven't opted in.
    interface EoDSettings {
      showDepartmentBreakdown: boolean;
      lotterySeparateFromDrawer: boolean;
      hideZeroRows: boolean;
    }
    const eodSettings: EoDSettings = {
      showDepartmentBreakdown: true,    // default ON — most stores want to see it
      lotterySeparateFromDrawer: false, // default OFF — preserves S44/S61 drawer math
      hideZeroRows: true,               // default ON — cleaner reports
    };
    if (scope.storeId) {
      const storeRow = await prisma.store.findUnique({
        where: { id: scope.storeId },
        select: { pos: true },
      });
      const posJson = (storeRow?.pos || {}) as { eodReport?: Partial<EoDSettings> };
      const ovr = posJson.eodReport || {};
      if (typeof ovr.showDepartmentBreakdown === 'boolean')   eodSettings.showDepartmentBreakdown   = ovr.showDepartmentBreakdown;
      if (typeof ovr.lotterySeparateFromDrawer === 'boolean') eodSettings.lotterySeparateFromDrawer = ovr.lotterySeparateFromDrawer;
      if (typeof ovr.hideZeroRows === 'boolean')              eodSettings.hideZeroRows              = ovr.hideZeroRows;
    }

    const [txAgg, cashEvents, _openingRow, fuelAgg, lotteryAgg, deptAgg] = await Promise.all([
      aggregateTransactions(scope),
      aggregateCashEvents(scope),
      // Opening cash amount — only meaningful for single-shift scope
      scope.shift ? Promise.resolve({ openingAmount: Number(scope.shift.openingAmount || 0) })
                  : Promise.resolve(null),
      aggregateFuel(scope),
      aggregateLottery(scope),
      eodSettings.showDepartmentBreakdown ? aggregateDepartments(scope) : Promise.resolve(null),
    ]);

    // ── PAYOUTS section (9 categories) ───────────────────────────────────────
    const payoutMap: Record<string, PayoutRow> = {};
    for (const c of PAYOUT_CATEGORIES) payoutMap[c.key] = { key: c.key, label: c.label, count: 0, amount: 0 };

    // CashPayout rows → map by payoutType
    for (const p of cashEvents.payouts) {
      const amt = Number(p.amount) || 0;
      const ptype = String((p as unknown as { payoutType?: string }).payoutType || '').toLowerCase().trim();
      let bucket = 'paid_out'; // default
      if (ptype === 'loan' || ptype === 'loans')             bucket = 'loans';
      else if (ptype === 'paid_in' || ptype === 'received')  bucket = 'paid_in';
      // S77 (C9) — accept full-word 'received_on_account' (canonical for new
      // code) alongside legacy abbreviated forms.
      else if (
        ptype === 'received_on_account' ||
        ptype === 'received_on_acct' ||
        ptype === 'on_account' ||
        ptype === 'house_payment'
      ) bucket = 'received_on_acct';
      else if (ptype === 'tip' || ptype === 'tips')          bucket = 'tips';
      else                                                   bucket = 'paid_out';
      payoutMap[bucket].count  += 1;
      payoutMap[bucket].amount += amt;
    }

    // CashDrop rows → Pickups (default) OR Paid-in (S77 type='paid_in').
    // Legacy rows with type=null are treated as 'drop' → Pickups.
    for (const d of cashEvents.drops) {
      const amt = Number(d.amount) || 0;
      const dtype = String((d as unknown as { type?: string }).type || 'drop').toLowerCase().trim();
      const bucket = dtype === 'paid_in' ? 'paid_in' : 'pickups';
      payoutMap[bucket].count  += 1;
      payoutMap[bucket].amount += amt;
    }

    // Cashback from transactions
    payoutMap.cashback.count  = txAgg.cashBackCount;
    payoutMap.cashback.amount = txAgg.cashBackTotal;

    // Tips from transactions (merged with any payout-based tips)
    payoutMap.tips.count  += txAgg.tipsCount;
    payoutMap.tips.amount += txAgg.tipsTotal;

    // Refunds + Voids from transactions (already computed in aggregator)
    payoutMap.refunds.count  = txAgg.refundCount;
    payoutMap.refunds.amount = txAgg.refundAmount;
    payoutMap.voids.count    = txAgg.voidCount;
    payoutMap.voids.amount   = txAgg.voidAmount;

    // Round
    for (const k of Object.keys(payoutMap)) payoutMap[k].amount = r2(payoutMap[k].amount);
    for (const k of Object.keys(txAgg.tenderMap)) txAgg.tenderMap[k].amount = r2(txAgg.tenderMap[k].amount);

    // ── TRANSACTIONS section ─────────────────────────────────────────────────
    // Average tx uses GROSS *before* refund-subtraction over total successful
    // tickets (completes + refunds), so a $40 sale + a $10 refund averages
    // ~$25 not $30. This is the standard convention for POS daily-summary reports.
    const grossBeforeRefunds = txAgg.grossSales + txAgg.refundAmount;
    const allTxCount         = txAgg.completeCount + txAgg.refundCount;
    const avgTxAmount        = allTxCount > 0 ? grossBeforeRefunds / allTxCount : 0;
    const transactionSection = [
      { key: 'avgTransaction', label: 'Average Transaction', count: allTxCount,           amount: r2(avgTxAmount) },
      { key: 'netSales',       label: 'Net Sales',           count: txAgg.completeCount,  amount: r2(txAgg.netSales) },
      { key: 'grossSales',     label: 'Gross Sales',         count: txAgg.completeCount,  amount: r2(txAgg.grossSales) },
      { key: 'tax',            label: 'Tax Collected',       count: txAgg.completeCount,  amount: r2(txAgg.taxCollected) },
      { key: 'cashCollected',  label: 'Cash Collected',      count: txAgg.tenderMap.cash?.count || 0, amount: r2(txAgg.cashCollected) },
    ];

    // Pass-through fees — collected on behalf of the state (deposits) or
    // as a flat charge per bag. Both are already baked into Gross Sales
    // (which mirrors customer-facing tender total), so this section is purely
    // a breakdown for accounting — it does NOT affect profit or revenue math.
    const feesSection = [
      { key: 'bagFees',        label: 'Bag Fees (pass-through)',           count: txAgg.bagFeeQty,      amount: r2(txAgg.bagFeeTotal),        passThrough: true },
      { key: 'bottleDeposits', label: 'Bottle Deposits Collected',         count: txAgg.completeCount,  amount: r2(txAgg.depositsCollected),  passThrough: true },
      { key: 'depositsRefunded', label: 'Bottle Deposits Refunded',        count: txAgg.refundCount,    amount: r2(txAgg.depositsRefunded),   passThrough: true },
    ];

    // ── Reconciliation (only if shift-scope) ────────────────────────────────
    //
    // Single source of truth: services/reconciliation/shift/. The same
    // function `reconcileShift` is called by `closeShift` (which persists
    // the result) and here (which displays it). Lottery cash flow — un-rung
    // instant tickets, machine draw sales, machine + instant cashings — is
    // baked into `expectedDrawer` so variance is correct for stores that
    // sell lottery.
    //
    // Back-compat: the response shape preserves every field the existing
    // back-office EoD UI reads (`openingAmount`, `cashCollected`, `cashIn`,
    // `cashOut`, `cashDropsTotal`, `cashPayoutsTotal`, `expectedInDrawer`,
    // `closingAmount`, `variance`) so callers don't break. New fields are
    // additive: `lottery` (cash-flow detail) + `lineItems` (pre-rendered
    // breakdown).
    let reconciliation: (ShiftReconciliation & {
      // Legacy aliases retained for the existing back-office UI to read
      // without code changes. Same numbers, just additional names.
      openingAmount: number;
      cashCollected: number;
      cashPayoutsTotal: number;
      expectedInDrawer: number;
    }) | null = null;
    if (scope.shift) {
      const recon = await reconcileShift({
        shiftId: scope.shift.id,
        closingAmount: scope.shift.closingAmount != null ? Number(scope.shift.closingAmount) : null,
        windowEnd: scope.shift.closedAt ?? new Date(),
        lotterySeparateFromDrawer: eodSettings.lotterySeparateFromDrawer,
      });
      reconciliation = {
        ...recon,
        // Legacy field aliases — same numbers, names the old UI consumes:
        openingAmount:    recon.openingFloat,
        cashCollected:    r2(recon.cashSales - recon.cashRefunds),
        cashPayoutsTotal: recon.cashOut,
        expectedInDrawer: recon.expectedDrawer,
      };
    }

    // ── Build header ─────────────────────────────────────────────────────────
    const storeName = scope.storeId ? (await prisma.store.findUnique({
      where: { id: scope.storeId }, select: { name: true },
    })) : null;

    // S67 — `hideZeroRows` filter: drop rows where both count + amount are 0.
    // Applied at response time so cashier-app + back-office + thermal print
    // all stay consistent. The transactionSection always renders (Net/Gross
    // are signal even at $0). Fees rows only ever non-trivial when they fire.
    const filterZero = <T extends { count?: number; amount?: number }>(rows: T[]): T[] =>
      eodSettings.hideZeroRows
        ? rows.filter(r => (r.amount ?? 0) !== 0 || (r.count ?? 0) !== 0)
        : rows;

    res.json({
      header: {
        reportType:   scope.shift ? 'shift' : 'date-range',
        storeId:      scope.storeId,
        storeName:    storeName?.name || null,
        storeAddress: null,
        storePhone:   null,
        cashierId:    scope.cashierId,
        cashierName:  scope.cashierName,
        stationId:    scope.stationId,
        stationName:  scope.stationName,
        shiftId:      scope.shift?.id || null,
        from:         scope.from,
        to:           scope.to,
        printedAt:    new Date().toISOString(),
      },
      // S67 — surface settings so renderers know which optional sections to show
      // and whether they should also client-side-filter zero rows (defense in depth).
      settings:     eodSettings,
      payouts:      filterZero(PAYOUT_CATEGORIES.map(c => payoutMap[c.key])),
      tenders:      filterZero(TENDER_CATEGORIES.map(c => txAgg.tenderMap[c.key])),
      transactions: transactionSection,
      fees:         filterZero(feesSection),
      fuel:         fuelAgg,
      // Lottery summary (sale / payouts / net cash) — accountant-friendly
      // ledger view. Distinct from `reconciliation.lottery` which is the
      // cash-drawer-math detail (ticket-math truth, machine flow, etc.).
      lottery:      lotteryAgg,
      // S67 — Department breakdown (opt-in via settings.showDepartmentBreakdown)
      departments:  deptAgg ? { rows: filterZero(deptAgg.rows.map(r => ({ ...r, count: r.txCount, amount: r.netSales }))).map(r => ({ departmentId: r.departmentId, name: r.name, netSales: r.netSales, txCount: r.txCount, lineCount: r.lineCount })), total: deptAgg.total } : null,
      // Session 52 — Dual Pricing summary. Null when no transaction in the
      // window came from a dual_pricing store, so the UI can hide the
      // section entirely without an empty card eating screen real estate.
      dualPricing:  txAgg.dualPricingActive ? {
        surchargeCollected:    r2(txAgg.surchargeCollected),
        surchargeTaxCollected: r2(txAgg.surchargeTaxCollected),
        surchargeTotal:        r2(txAgg.surchargeCollected + txAgg.surchargeTaxCollected),
        surchargedTxCount:     txAgg.surchargedTxCount,
        cashTxOnDualCount:     txAgg.cashTxOnDualCount,
        cashSavingsTotal:      r2(txAgg.cashSavingsTotal),
        avgSurchargePerCardTx: txAgg.surchargedTxCount > 0
          ? r2(txAgg.surchargeCollected / txAgg.surchargedTxCount)
          : 0,
      } : null,
      reconciliation,
      totals: {
        grossSales:       r2(txAgg.grossSales),
        netSales:         r2(txAgg.netSales),
        taxCollected:     r2(txAgg.taxCollected),
        cashCollected:    r2(txAgg.cashCollected),
        completeTxns:     txAgg.completeCount,
        refundCount:      txAgg.refundCount,
        refundAmount:     r2(txAgg.refundAmount),
        voidCount:        txAgg.voidCount,
        voidAmount:       r2(txAgg.voidAmount),
      },
    });
  } catch (err: unknown) {
    console.error('[getEndOfDayReport]', err);
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode || 500).json({ error: e.message || 'Internal server error' });
  }
};
