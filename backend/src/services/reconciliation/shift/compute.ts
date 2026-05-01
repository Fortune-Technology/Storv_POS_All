/**
 * Shift reconciliation — pure calculation.
 *
 * Takes the raw inputs (already gathered by queries.ts) and produces the
 * final reconciliation shape — including the breakdown line-items the UI
 * renders. ZERO database access here so it's trivially unit-testable.
 *
 * The math:
 *
 *   expectedDrawer = openingFloat
 *                  + cashSales                  POS cash tendered (complete tx)
 *                  − cashRefunds                POS cash refunded (refund tx)
 *                  + cashIn                     CashPayout: paid_in + received_on_acct
 *                  − cashOut                    CashPayout: paid_out + loans
 *                  − cashDropsTotal             CashDrop ("pickups")
 *                  + lottery.unreportedCash     un-rung instant tickets (cashier skipped POS)
 *                  + lottery.machineDrawSales   machine sales (online totals)
 *                  − lottery.machineCashings    machine cashings (online totals)
 *                  − lottery.instantCashings    instant cashings (online totals)
 *
 * The key Session 44 fix: the four `lottery.*` lines were missing
 * entirely. Drawer expectations ignored every form of lottery cash flow.
 */

import type {
  ShiftReconciliation,
  LotteryCashFlow,
  ReconciliationLine,
} from './types.js';
import type { ShiftRow, CashFlowsFromTransactions, PayoutBuckets, LotteryShiftRaw } from './queries.js';

const r2 = (n: number): number => Math.round(Number(n || 0) * 100) / 100;

export interface ComputeArgs {
  shift: ShiftRow;
  cash: CashFlowsFromTransactions;
  payouts: PayoutBuckets;
  lottery: LotteryShiftRaw;
  /** Cashier-counted closing amount. Pass null when computing pre-close preview. */
  closingAmount?: number | null;
}

export function computeShiftReconciliation(args: ComputeArgs): ShiftReconciliation {
  const { shift, cash, payouts, lottery, closingAmount = null } = args;

  const openingFloat = Number(shift.openingAmount) || 0;

  // Lottery cash-flow detail. unreportedCash captures un-rung instant
  // sales (cashier sold tickets without ringing them through the POS so
  // they're absent from cashSales).
  const unreportedCash = Math.max(0, lottery.ticketMathSales - lottery.posLotterySales);
  const netLotteryCash =
    unreportedCash + lottery.machineDrawSales - lottery.machineCashings - lottery.instantCashings;

  const lotteryCashFlow: LotteryCashFlow = {
    ticketMathSales: r2(lottery.ticketMathSales),
    posLotterySales: r2(lottery.posLotterySales),
    unreportedCash:  r2(unreportedCash),
    machineDrawSales: r2(lottery.machineDrawSales),
    machineCashings:  r2(lottery.machineCashings),
    instantCashings:  r2(lottery.instantCashings),
    source: lottery.ticketMathSource,
    netLotteryCash:   r2(netLotteryCash),
  };

  // Final expected drawer figure.
  //
  // B6 (Session 63) — `payouts.backOfficeCashPayments` is the new term:
  // back-office VendorPayments paid in cash within this shift's window.
  // These reduce drawer cash even though they're recorded outside the
  // register flow. Without it, drawer expectation overshoots by every
  // back-office cash vendor payment recorded against this shift's day.
  const expectedDrawer =
    openingFloat
    + cash.cashSales
    - cash.cashRefunds
    + payouts.cashIn
    - payouts.cashOut
    - payouts.cashDropsTotal
    - payouts.backOfficeCashPayments
    + netLotteryCash;

  const variance =
    closingAmount != null ? r2(closingAmount - expectedDrawer) : null;

  // Pre-render the line-items so the UI is dumb. Order matches the math
  // above. `passThrough: true` would mark a row as informational; we don't
  // use that here but the shape supports it.
  const lineItems: ReconciliationLine[] = [
    { key: 'opening',         label: 'Opening Float',                 amount: r2(openingFloat),                  kind: 'opening' },
    { key: 'cashSales',       label: '+ Cash Sales',                  amount: r2(cash.cashSales),                kind: 'incoming' },
    { key: 'cashRefunds',     label: '- Cash Refunds',                amount: r2(cash.cashRefunds),              kind: 'outgoing' },
    { key: 'cashIn',          label: '+ Paid In / Received on Acct',  amount: r2(payouts.cashIn),                kind: 'incoming' },
    { key: 'cashOut',         label: '- Paid Out / Loans',            amount: r2(payouts.cashOut),               kind: 'outgoing' },
    { key: 'cashDrops',       label: '- Cash Drops (Pickups)',        amount: r2(payouts.cashDropsTotal),        kind: 'outgoing' },
    // B6 — emit only when non-zero so stores without back-office vendor
    // cash flow don't see an empty row.
    ...(payouts.backOfficeCashPayments > 0
      ? [{
          key: 'backOfficeCashPayments',
          label: '- Back-Office Vendor Cash Payments',
          amount: r2(payouts.backOfficeCashPayments),
          kind: 'outgoing' as const,
          hint: 'VendorPayment rows where tenderMethod=cash within shift window',
        }]
      : []),
    // Lottery section — only emit the rows that have non-zero amounts so
    // the UI doesn't render a wall of zeros for stores without lottery.
    ...(unreportedCash > 0
      ? [{
          key: 'lotteryUnreported',
          label: '+ Lottery Sales (un-rung)',
          amount: r2(unreportedCash),
          kind: 'incoming' as const,
          hint: `Ticket-math ${r2(lottery.ticketMathSales)} − rung-up ${r2(lottery.posLotterySales)}`,
        }]
      : []),
    ...(lottery.machineDrawSales > 0
      ? [{
          key: 'machineDrawSales',
          label: '+ Machine Draw Sales',
          amount: r2(lottery.machineDrawSales),
          kind: 'incoming' as const,
        }]
      : []),
    ...(lottery.machineCashings > 0
      ? [{
          key: 'machineCashings',
          label: '- Machine Draw Cashings',
          amount: r2(lottery.machineCashings),
          kind: 'outgoing' as const,
        }]
      : []),
    ...(lottery.instantCashings > 0
      ? [{
          key: 'instantCashings',
          label: '- Instant Cashings (online)',
          amount: r2(lottery.instantCashings),
          kind: 'outgoing' as const,
        }]
      : []),
    { key: 'expected', label: 'Expected in Drawer', amount: r2(expectedDrawer), kind: 'subtotal' },
  ];

  return {
    shiftId:         shift.id,
    storeId:         shift.storeId,
    orgId:           shift.orgId,
    openedAt:        shift.openedAt,
    closedAt:        shift.closedAt,
    openingFloat:    r2(openingFloat),
    cashSales:       r2(cash.cashSales),
    cashRefunds:     r2(cash.cashRefunds),
    cashDropsTotal:  r2(payouts.cashDropsTotal),
    cashPayoutsTotal: r2(payouts.cashPayoutsTotal),
    cashIn:          r2(payouts.cashIn),
    cashOut:         r2(payouts.cashOut),
    lottery:         lotteryCashFlow,
    expectedDrawer:  r2(expectedDrawer),
    closingAmount:   closingAmount != null ? r2(closingAmount) : null,
    variance,
    lineItems,
  };
}
