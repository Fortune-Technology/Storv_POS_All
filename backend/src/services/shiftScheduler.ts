/**
 * shiftScheduler.ts
 * Auto-closes any open Shift that has crossed the store's calendar-day boundary.
 *
 * Why: cashiers sometimes forget to close the drawer at end of day. Without this,
 * the next morning's sign-in still shows the previous day's shift as active,
 * which corrupts daily reporting and silently rolls cash counts into yesterday.
 *
 * Run cadence: every 10 minutes. The 23:55 sweep catches shifts before midnight;
 * the rest of the day catches anything that drifted past midnight (e.g. server
 * was offline at 23:55, or a shift was opened after midnight in a tz the
 * scheduler didn't visit at the right minute).
 *
 * Strategy:
 *   - For each open Shift, look up its Store.timezone (default UTC).
 *   - Compute "today's local midnight" in that timezone.
 *   - If shift.openedAt < that midnight → auto-close.
 *   - Auto-close uses the same expected-cash math as the manual close path.
 *     closingAmount := expectedAmount, variance := 0.
 *   - Mark closingNote='[AUTO] Closed by system at end of day.' so reports
 *     can distinguish auto-closed shifts from manually-counted ones.
 */

import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/** Returns the UTC instant corresponding to the most recent local midnight in `tz`. */
function localMidnightUTC(tz: string): Date {
  const now = new Date();
  // en-CA gives YYYY-MM-DD which is what we need to construct a date string
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );
  // Local midnight in `tz`, expressed as a UTC instant.
  // Trick: treat the local-time wall-clock as if it were UTC, then subtract
  // the timezone offset to get the true UTC instant.
  const localAsIfUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    0, 0, 0, 0,
  );
  // Compute the offset between `tz` and UTC at this moment by comparing
  // formatted local time vs the UTC clock.
  const localWallClockMs = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  const tzOffsetMs = localWallClockMs - now.getTime();
  return new Date(localAsIfUTC - tzOffsetMs);
}

/** Tender line as stored in Transaction.tenderLines JSON. */
interface TenderLine {
  method: string;
  amount: number | string;
  [key: string]: unknown;
}

/** A Shift row carrying drops + payouts (the include shape used in runShiftSweep). */
type ShiftWithMoves = Prisma.ShiftGetPayload<{ include: { drops: true; payouts: true } }>;

interface ExpectedCash {
  expectedAmount: number;
  cashSales: number;
  cashRefunds: number;
  cashDropsTotal: number;
  payoutsTotal: number;
  transactionCount: number;
}

/**
 * Compute expected cash for a shift using the same algorithm as
 * closeShift in the controller.
 */
async function computeExpectedCash(shift: ShiftWithMoves): Promise<ExpectedCash> {
  type TxRow = Prisma.TransactionGetPayload<{
    select: { grandTotal: true; tenderLines: true; status: true; changeGiven: true };
  }>;
  const txs: TxRow[] = await prisma.transaction.findMany({
    where: {
      orgId:     shift.orgId,
      storeId:   shift.storeId,
      createdAt: { gte: shift.openedAt },
      status:    { in: ['complete', 'refund'] },
    },
    select: { grandTotal: true, tenderLines: true, status: true, changeGiven: true },
  });

  let cashSales = 0;
  let cashRefunds = 0;
  txs.forEach((tx) => {
    const tenderLines = (tx.tenderLines as unknown as TenderLine[] | null) || [];
    const cashLines = tenderLines.filter((l) => l.method === 'cash');
    const cashIn = cashLines.reduce((s, l) => s + Number(l.amount), 0);
    if (tx.status === 'complete') {
      cashSales += cashIn - Number(tx.changeGiven || 0);
    }
    if (tx.status === 'refund') {
      cashRefunds += cashLines.reduce((s, l) => s + Number(l.amount), 0);
    }
  });

  const cashDropsTotal = (shift.drops    || []).reduce((s, d) => s + Number(d.amount), 0);
  const payoutsTotal   = (shift.payouts  || []).reduce((s, p) => s + Number(p.amount), 0);

  const expectedAmount = Number(shift.openingAmount) + cashSales - cashRefunds - cashDropsTotal - payoutsTotal;
  return {
    expectedAmount: Math.round(expectedAmount * 10000) / 10000,
    cashSales:      Math.round(cashSales * 10000) / 10000,
    cashRefunds:    Math.round(cashRefunds * 10000) / 10000,
    cashDropsTotal: Math.round(cashDropsTotal * 10000) / 10000,
    payoutsTotal:   Math.round(payoutsTotal * 10000) / 10000,
    transactionCount: txs.filter((t) => t.status === 'complete').length,
  };
}

/** Auto-close a single shift. Idempotent — safe to re-run. */
async function autoCloseShift(shift: ShiftWithMoves): Promise<void> {
  const computed = await computeExpectedCash(shift);
  await prisma.shift.update({
    where: { id: shift.id },
    data: {
      status:               'closed',
      closedAt:             new Date(),
      closedById:           null,                // system close
      closingAmount:        computed.expectedAmount,
      closingDenominations: null,
      closingNote:          '[AUTO] Closed by system at end of day. No physical cash count was recorded.',
      expectedAmount:       computed.expectedAmount,
      variance:             0,
      cashSales:            computed.cashSales,
      cashRefunds:          computed.cashRefunds,
      cashDropsTotal:       computed.cashDropsTotal,
      payoutsTotal:         computed.payoutsTotal,
    },
  });
  console.log(
    `[ShiftScheduler] Auto-closed shift ${shift.id} (store=${shift.storeId})`
    + ` expected=$${computed.expectedAmount.toFixed(2)} txs=${computed.transactionCount}`,
  );
}

/** One sweep over every open shift. */
export async function runShiftSweep(): Promise<void> {
  const openShifts: ShiftWithMoves[] = await prisma.shift.findMany({
    where:   { status: 'open' },
    include: { drops: true, payouts: true },
  });

  if (!openShifts.length) return;

  type StoreRow = Prisma.StoreGetPayload<{ select: { id: true; timezone: true } }>;

  // Fetch each shift's store timezone in one round-trip
  const storeIds = [...new Set(openShifts.map((s) => s.storeId))];
  const stores: StoreRow[] = await prisma.store.findMany({
    where:  { id: { in: storeIds } },
    select: { id: true, timezone: true },
  });
  const tzByStoreId: Record<string, string> = Object.fromEntries(
    stores.map((s) => [s.id, s.timezone || 'UTC']),
  );

  let closed = 0;
  for (const shift of openShifts) {
    try {
      const tz       = tzByStoreId[shift.storeId] || 'UTC';
      const midnight = localMidnightUTC(tz);
      if (new Date(shift.openedAt) < midnight) {
        await autoCloseShift(shift);
        closed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ShiftScheduler] Failed to auto-close shift ${shift.id}: ${message}`);
    }
  }
  if (closed > 0) {
    console.log(`[ShiftScheduler] Sweep complete — auto-closed ${closed}/${openShifts.length} stale shift(s).`);
  }
}

/** Wire the scheduler into the running server. Call once from server.js. */
export function startShiftScheduler(): void {
  console.log('✓ Shift auto-close scheduler started — sweeps every 10 min, closes stale shifts past local midnight');
  const onError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ShiftScheduler] sweep error:', message);
  };
  // Initial sweep ~30s after boot so we don't slow startup or stomp on
  // requests during cold start.
  setTimeout(() => { runShiftSweep().catch(onError); }, 30 * 1000);
  setInterval(() => { runShiftSweep().catch(onError); }, SWEEP_INTERVAL_MS);
}
