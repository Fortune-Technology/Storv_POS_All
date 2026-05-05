/**
 * Shift reconciliation — DB readers.
 *
 * Pure read-only Prisma queries. No business logic — that lives in
 * compute.ts. Splitting this out keeps compute.ts unit-testable with
 * mock inputs.
 */

import prisma from '../../../config/postgres.js';
import { windowSales, shiftSales } from '../../lottery/reporting/realSales.js';
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
  // B6 (Session 63) — back-office VendorPayment rows where tenderMethod='cash'
  // and paymentDate falls in the shift window. These reduce drawer cash but
  // live in their own table (not CashPayout). Without including them, drawer
  // expectation overshoots by every cash vendor payment recorded outside
  // the register flow.
  backOfficeCashPayments: number;
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
export async function readPayoutBuckets(args: {
  shiftId: string;
  /** B6 (Session 63) — needed for the cross-table VendorPayment query. */
  orgId: string;
  storeId: string;
  windowStart: Date;
  windowEnd: Date;
}): Promise<PayoutBuckets> {
  const { shiftId, orgId, storeId, windowStart, windowEnd } = args;

  type DropRow = { amount: number | string; type?: string | null };
  type PayoutRow = { amount: number | string; payoutType?: string | null };
  type VendorPayRow = { amount: number | string };

  const [drops, payouts, vendorCashPays] = await Promise.all([
    prisma.cashDrop.findMany({
      where: { shiftId },
      // S77 (C9) — read `type` so paid_in drops are routed to cashIn instead
      // of cashDropsTotal. Legacy rows have type=null → treated as 'drop'.
      select: { amount: true, type: true },
    }) as Promise<DropRow[]>,
    prisma.cashPayout.findMany({
      where: { shiftId },
      select: { amount: true, payoutType: true },
    }) as Promise<PayoutRow[]>,
    // B6 — back-office VendorPayments paid in cash that fall in this shift's
    // window for this store. These reduce drawer cash even though they're
    // recorded via the back-office portal (not the register's "Paid Out"
    // button which writes CashPayout). Filter by paymentDate (the date the
    // user said the payment happened, which may or may not equal createdAt).
    prisma.vendorPayment.findMany({
      where: {
        orgId,
        storeId,
        tenderMethod: 'cash',
        paymentDate: { gte: windowStart, lte: windowEnd },
      },
      select: { amount: true },
    }) as Promise<VendorPayRow[]>,
  ]);

  // S77 (C9) — split CashDrops by type. Legacy rows have type=null → 'drop'.
  let cashDropsTotal = 0;
  let cashInPaidInDrops = 0;
  for (const d of drops) {
    const amt = Number(d.amount || 0);
    const t = String(d.type || 'drop').toLowerCase().trim();
    if (t === 'paid_in') {
      cashInPaidInDrops += amt;
    } else {
      cashDropsTotal += amt;
    }
  }

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
    } else if (
      // S77 (C9) — accept canonical 'received_on_account' (full word) plus
      // legacy abbreviated forms for back-compat with any older data.
      t === 'received_on_account' ||
      t === 'received_on_acct' ||
      t === 'on_account' ||
      t === 'house_payment'
    ) {
      cashInReceivedOnAcct += amt;
    } else if (t === 'tip' || t === 'tips') {
      // skip — informational, doesn't affect drawer
    } else {
      cashOutPaidOut += amt; // default to paid_out
    }
  }
  const cashIn = cashInPaidInDrops + cashInPaidIn + cashInReceivedOnAcct;
  const cashOut = cashOutPaidOut + cashOutLoans;
  // Legacy `cashPayoutsTotal` field — historical surfaces summed every
  // payout regardless of bucket. Keep that semantic for back-compat.
  const cashPayoutsTotal = cashOut + cashIn;

  const backOfficeCashPayments = vendorCashPays.reduce(
    (s, v) => s + Number(v.amount || 0),
    0,
  );

  return {
    cashDropsTotal,
    cashIn,
    cashOut,
    cashPayoutsTotal,
    backOfficeCashPayments,
  };
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

  // B3 (Session 61) — short-circuit when the store has lottery disabled
  // (or never enabled it). Skips 3 unnecessary queries per shift close /
  // EoD load AND prevents historic lottery values from leaking into the
  // drawer math after a store toggles the module off. Behaviour the user
  // explicitly specified: "if lottery module is disabled then the lottery
  // section won't be there in the end of the day report or in calculation".
  //
  // Returns all-zero raw values so compute.ts produces an empty
  // LotteryCashFlow that contributes nothing to expectedDrawer and emits
  // no line items.
  const settings = await prisma.lotterySettings.findUnique({
    where: { storeId },
    select: { enabled: true },
  });
  if (!settings?.enabled) {
    return {
      ticketMathSales: 0,
      ticketMathSource: 'empty',
      posLotterySales: 0,
      machineDrawSales: 0,
      machineCashings: 0,
      instantCashings: 0,
    };
  }

  // B4 (Session 62) — per-shift ticket-math sales using bracketing snapshot
  // events (shift open + close). When the shift was opened AFTER the
  // openShift handler started writing shift_boundary events, this gives a
  // CORRECT per-shift delta. For multi-cashier days, this prevents the
  // whole-day's lottery sales from being attributed to whichever cashier
  // closed last.
  //
  // Falls back to `windowSales` (day-by-day delta) when shiftSales returns
  // empty — covers legacy shifts that lack a starting boundary event.
  const shiftRes = await shiftSales({
    orgId,
    storeId,
    openedAt: windowStart,
    closedAt: windowEnd,
  });
  const ticket = shiftRes.totalSales > 0
    ? shiftRes
    : await windowSales({ orgId, storeId, windowStart, windowEnd });

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
