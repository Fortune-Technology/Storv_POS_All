/**
 * Shift reconciliation — DB readers.
 *
 * Pure read-only Prisma queries. No business logic — that lives in
 * compute.ts. Splitting this out keeps compute.ts unit-testable with
 * mock inputs.
 */

import prisma from '../../../config/postgres.js';
import { windowSales } from '../../lottery/reporting/realSales.js';
import type { SalesSource } from '../../lottery/reporting/types.js';

interface TenderLine {
  method?: string;
  amount?: number | string;
}

export interface ShiftRow {
  id: string;
  orgId: string;
  storeId: string;
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  openingAmount: unknown; // Prisma Decimal — caller normalises
  closingAmount: unknown | null;
  variance: unknown | null;
}

export interface CashFlowsFromTransactions {
  cashSales: number;
  cashRefunds: number;
}

export interface PayoutBuckets {
  cashDropsTotal: number; // pickups
  cashIn: number; // paid_in + received_on_acct
  cashOut: number; // paid_out + loans
  cashPayoutsTotal: number; // legacy: paid_out alone (kept for back-compat surfaces)
}

export interface LotteryShiftRaw {
  ticketMathSales: number;
  ticketMathSource: SalesSource;
  posLotterySales: number;
  machineDrawSales: number;
  machineCashings: number;
  instantCashings: number;
}

/**
 * Load the shift row + its CashDrop / CashPayout joins. Throws when the
 * shift doesn't exist — callers should catch and return 404.
 */
export async function loadShift(shiftId: string): Promise<ShiftRow> {
  const row = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!row) throw new Error(`Shift ${shiftId} not found`);
  return row as ShiftRow;
}

/**
 * Sum cash sales + cash refunds from the POS Transaction table for the
 * shift window. Mirrors what `closeShift` already does — we keep the math
 * here so closeShift collapses to one service call.
 */
export async function readCashFlowsFromTransactions(args: {
  orgId: string;
  storeId: string;
  windowStart: Date;
  windowEnd: Date;
}): Promise<CashFlowsFromTransactions> {
  const { orgId, storeId, windowStart, windowEnd } = args;
  const txs = await prisma.transaction.findMany({
    where: {
      orgId,
      storeId,
      createdAt: { gte: windowStart, lte: windowEnd },
      status: { in: ['complete', 'refund'] },
    },
    select: { tenderLines: true, status: true, changeGiven: true },
  });

  let cashSales = 0;
  let cashRefunds = 0;
  for (const tx of txs) {
    const tenders: TenderLine[] = Array.isArray(tx.tenderLines)
      ? (tx.tenderLines as unknown as TenderLine[])
      : [];
    const cashLines = tenders.filter((l) => l.method === 'cash');
    const cashIn = cashLines.reduce((s, l) => s + Number(l.amount || 0), 0);
    if (tx.status === 'complete') {
      cashSales += cashIn - Number(tx.changeGiven || 0);
    } else if (tx.status === 'refund') {
      cashRefunds += cashIn;
    }
  }
  return { cashSales, cashRefunds };
}

/**
 * Bucket the shift's CashPayout rows by `payoutType`. Mirrors the back-
 * office EoD report logic exactly (see endOfDayReportController.ts):
 *   pickups            = CashDrop sum  (drawer drops)
 *   paid_in            = CashPayout where payoutType ∈ {paid_in, received}
 *   received_on_acct   = CashPayout where payoutType ∈ {received_on_acct,
 *                                                       on_account,
 *                                                       house_payment}
 *   loans              = CashPayout where payoutType ∈ {loan, loans}
 *   paid_out           = CashPayout where payoutType = anything else (default)
 *   tips               = CashPayout where payoutType ∈ {tip, tips}
 *                          → informational; doesn't affect drawer
 *
 * cashIn  = paid_in + received_on_acct      (drawer GAINS)
 * cashOut = paid_out + loans                 (drawer LOSES)
 */
export async function readPayoutBuckets(shiftId: string): Promise<PayoutBuckets> {
  type DropRow = { amount: number | string };
  type PayoutRow = { amount: number | string; payoutType?: string | null };

  const drops = (await prisma.cashDrop.findMany({
    where: { shiftId },
    select: { amount: true },
  })) as DropRow[];
  const payouts = (await prisma.cashPayout.findMany({
    where: { shiftId },
    select: { amount: true, payoutType: true },
  })) as PayoutRow[];

  const cashDropsTotal = drops.reduce((s, d) => s + Number(d.amount || 0), 0);

  let cashInPaidIn = 0;
  let cashInReceivedOnAcct = 0;
  let cashOutPaidOut = 0;
  let cashOutLoans = 0;
  // (tips don't enter the drawer math; we just don't track them here)
  for (const p of payouts) {
    const amt = Number(p.amount || 0);
    const t = String(p.payoutType || '').toLowerCase().trim();
    if (t === 'loan' || t === 'loans') {
      cashOutLoans += amt;
    } else if (t === 'paid_in' || t === 'received') {
      cashInPaidIn += amt;
    } else if (t === 'received_on_acct' || t === 'on_account' || t === 'house_payment') {
      cashInReceivedOnAcct += amt;
    } else if (t === 'tip' || t === 'tips') {
      // skip — informational, doesn't affect drawer
    } else {
      cashOutPaidOut += amt; // default to paid_out
    }
  }
  const cashIn = cashInPaidIn + cashInReceivedOnAcct;
  const cashOut = cashOutPaidOut + cashOutLoans;
  // Legacy `cashPayoutsTotal` field — historical surfaces summed every
  // payout regardless of bucket. Keep that semantic for back-compat.
  const cashPayoutsTotal = cashOut + cashIn;

  return { cashDropsTotal, cashIn, cashOut, cashPayoutsTotal };
}

/**
 * Read all the lottery cash-flow signals for the shift window:
 *   - ticket-math sales (the authoritative figure from snapshots/live/POS-fallback)
 *   - LotteryTransaction sales (what the cashier rang up at POS)
 *   - LotteryOnlineTotal machine + instant numbers (back-office daily entry)
 *
 * Composer (compute.ts) decides how to combine these into the cash flow.
 */
export async function readLotteryShiftRaw(args: {
  orgId: string;
  storeId: string;
  windowStart: Date;
  windowEnd: Date;
}): Promise<LotteryShiftRaw> {
  const { orgId, storeId, windowStart, windowEnd } = args;

  // Ticket-math sales for the window — uses the shared reporting service.
  const ticket = await windowSales({
    orgId,
    storeId,
    windowStart,
    windowEnd,
  });

  // POS-recorded lottery sales for the window. Different from ticket-math
  // when the cashier skipped ringing up some tickets.
  type PosSaleRow = { amount: number | string };
  const posSaleRows = (await prisma.lotteryTransaction.findMany({
    where: {
      orgId,
      storeId,
      type: 'sale',
      createdAt: { gte: windowStart, lte: windowEnd },
    },
    select: { amount: true },
  })) as PosSaleRow[];
  const posLotterySales = posSaleRows.reduce(
    (s: number, r: PosSaleRow) => s + Number(r.amount || 0),
    0,
  );

  // Online totals — daily rows. A shift typically maps to one calendar day,
  // but we conservatively pull every row whose `date` falls in the window
  // (handles cross-midnight shifts; minor over-count if multiple shifts
  // reconcile the same day, but that's an existing reporting limitation).
  const dayFloor = new Date(windowStart);
  dayFloor.setUTCHours(0, 0, 0, 0);
  const dayCeil = new Date(windowEnd);
  dayCeil.setUTCHours(23, 59, 59, 999);

  type OnlineRow = {
    machineSales: number | string | null;
    machineCashing: number | string | null;
    instantCashing: number | string | null;
  };
  const onlineRows = (await prisma.lotteryOnlineTotal.findMany({
    where: {
      orgId,
      storeId,
      date: { gte: dayFloor, lte: dayCeil },
    },
    select: { machineSales: true, machineCashing: true, instantCashing: true },
  })) as OnlineRow[];
  const machineDrawSales = onlineRows.reduce(
    (s: number, r: OnlineRow) => s + Number(r.machineSales || 0),
    0,
  );
  const machineCashings = onlineRows.reduce(
    (s: number, r: OnlineRow) => s + Number(r.machineCashing || 0),
    0,
  );
  const instantCashings = onlineRows.reduce(
    (s: number, r: OnlineRow) => s + Number(r.instantCashing || 0),
    0,
  );

  return {
    ticketMathSales: Math.round(ticket.totalSales * 100) / 100,
    ticketMathSource: ticket.source,
    posLotterySales: Math.round(posLotterySales * 100) / 100,
    machineDrawSales: Math.round(machineDrawSales * 100) / 100,
    machineCashings: Math.round(machineCashings * 100) / 100,
    instantCashings: Math.round(instantCashings * 100) / 100,
  };
}
