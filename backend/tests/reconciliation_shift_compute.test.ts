// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

/**
 * Unit tests for services/reconciliation/shift/compute.ts.
 *
 * compute.ts is a PURE function (no DB, no I/O). We feed it raw inputs
 * (mock ShiftRow, CashFlowsFromTransactions, PayoutBuckets, LotteryShiftRaw)
 * and assert on the resulting reconciliation shape + math.
 *
 * Run with:
 *   node --import tsx --test tests/reconciliation_shift_compute.test.mjs
 *
 * (`--import tsx` lets node resolve .ts files referenced by import.)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { computeShiftReconciliation } from '../src/services/reconciliation/shift/compute.ts';

// ── Test fixtures ──────────────────────────────────────────────────────────

/** Build a fresh shift fixture with sensible defaults. */
const mkShift = (overrides = {}) => ({
  id:             'shift-test-1',
  orgId:          'org-1',
  storeId:        'store-1',
  status:         'open',
  openedAt:       new Date('2026-04-22T08:00:00Z'),
  closedAt:       null,
  openingAmount:  100,
  closingAmount:  null,
  variance:       null,
  ...overrides,
});

const mkCash = (overrides = {}) => ({
  cashSales:   0,
  cashRefunds: 0,
  ...overrides,
});

const mkPayouts = (overrides = {}) => ({
  cashDropsTotal:   0,
  cashIn:           0,
  cashOut:          0,
  cashPayoutsTotal: 0,
  ...overrides,
});

const mkLottery = (overrides = {}) => ({
  ticketMathSales:  0,
  ticketMathSource: 'empty',
  posLotterySales:  0,
  machineDrawSales: 0,
  machineCashings:  0,
  instantCashings:  0,
  ...overrides,
});

// ──────────────────────────────────────────────────────────────────────────

describe('computeShiftReconciliation — core math', () => {
  test('happy-path: opening + cash sales − refunds − drops − payouts = expected', () => {
    const recon = computeShiftReconciliation({
      shift:    mkShift({ openingAmount: 100 }),
      cash:     mkCash({ cashSales: 500, cashRefunds: 25 }),
      payouts:  mkPayouts({ cashDropsTotal: 50, cashOut: 30, cashIn: 0 }),
      lottery:  mkLottery(),
    });

    // 100 + 500 − 25 + 0 − 30 − 50 = 495
    assert.equal(recon.expectedDrawer, 495);
    assert.equal(recon.openingFloat,  100);
    assert.equal(recon.cashSales,     500);
    assert.equal(recon.cashRefunds,    25);
    assert.equal(recon.cashOut,        30);
    assert.equal(recon.cashDropsTotal, 50);
  });

  test('cashIn (paid_in + received_on_acct) adds to expected drawer', () => {
    const recon = computeShiftReconciliation({
      shift:    mkShift({ openingAmount: 100 }),
      cash:     mkCash({ cashSales: 200 }),
      payouts:  mkPayouts({ cashIn: 75 }),
      lottery:  mkLottery(),
    });

    // 100 + 200 + 75 = 375
    assert.equal(recon.expectedDrawer, 375);
  });

  test('variance = closing − expected when closing supplied', () => {
    const recon = computeShiftReconciliation({
      shift:         mkShift({ openingAmount: 100 }),
      cash:          mkCash({ cashSales: 200 }),
      payouts:       mkPayouts(),
      lottery:       mkLottery(),
      closingAmount: 305,
    });
    // expected = 300; counted = 305; variance = +5 (drawer over)
    assert.equal(recon.expectedDrawer, 300);
    assert.equal(recon.closingAmount,  305);
    assert.equal(recon.variance,         5);
  });

  test('variance is null when closingAmount is omitted (preview mode)', () => {
    const recon = computeShiftReconciliation({
      shift:    mkShift(),
      cash:     mkCash(),
      payouts:  mkPayouts(),
      lottery:  mkLottery(),
    });
    assert.equal(recon.variance,      null);
    assert.equal(recon.closingAmount, null);
  });
});

describe('computeShiftReconciliation — lottery cash flow', () => {
  test('un-rung instant cash adds to expected drawer when ticket-math > POS', () => {
    const recon = computeShiftReconciliation({
      shift:    mkShift({ openingAmount: 100 }),
      cash:     mkCash({ cashSales: 0 }),
      payouts:  mkPayouts(),
      lottery:  mkLottery({
        ticketMathSales:  195,    // physical tickets sold
        posLotterySales:    0,    // cashier didn't ring any
        ticketMathSource: 'snapshot',
      }),
    });

    // 100 + 0 + 195 (un-rung) = 295
    assert.equal(recon.lottery.unreportedCash, 195);
    assert.equal(recon.lottery.netLotteryCash, 195);
    assert.equal(recon.expectedDrawer,         295);
  });

  test('un-rung is zero when posSales >= ticketMath (no missing cash)', () => {
    const recon = computeShiftReconciliation({
      shift:    mkShift({ openingAmount: 100 }),
      cash:     mkCash({ cashSales: 200 }),  // cashier rang it all up
      payouts:  mkPayouts(),
      lottery:  mkLottery({
        ticketMathSales:  150,
        posLotterySales:  200,    // rang up MORE than ticket-math (over-ringing)
      }),
    });

    // un-rung clamps to 0 (max(0, 150 − 200))
    assert.equal(recon.lottery.unreportedCash, 0);
    assert.equal(recon.lottery.netLotteryCash, 0);
    assert.equal(recon.expectedDrawer,       300); // 100 + 200
  });

  test('machine draw sales add; machine + instant cashings subtract', () => {
    const recon = computeShiftReconciliation({
      shift:   mkShift({ openingAmount: 100 }),
      cash:    mkCash(),
      payouts: mkPayouts(),
      lottery: mkLottery({
        machineDrawSales: 183,
        machineCashings:   80,
        instantCashings:   50,
      }),
    });

    // netLottery = 0 (no un-rung) + 183 − 80 − 50 = 53
    assert.equal(recon.lottery.netLotteryCash, 53);
    assert.equal(recon.expectedDrawer,        153); // 100 + 53
  });

  test('full lottery scenario from the dev-DB probe', () => {
    // Real shift: $195 un-rung instant + $183 machine sales − $80 + $50 cashings
    // Pre-fix expected was $0; new expected should be $248.
    const recon = computeShiftReconciliation({
      shift:    mkShift({ openingAmount: 0 }),
      cash:     mkCash(),  // no POS cash sales (cashier didn't ring)
      payouts:  mkPayouts(),
      lottery:  mkLottery({
        ticketMathSales:  195,
        posLotterySales:    0,   // un-rung
        machineDrawSales: 183,
        machineCashings:   80,
        instantCashings:   50,
        ticketMathSource: 'snapshot',
      }),
      closingAmount: 0, // cashier counted nothing because they don't realize
    });

    assert.equal(recon.lottery.unreportedCash, 195);
    assert.equal(recon.lottery.netLotteryCash, 248);
    assert.equal(recon.expectedDrawer,         248);
    assert.equal(recon.variance,              -248); // drawer is $248 short
  });

  test('netLottery can go NEGATIVE when cashings exceed sales', () => {
    // Heavy cashing day, light sales — drawer net loses lottery cash
    const recon = computeShiftReconciliation({
      shift:    mkShift({ openingAmount: 100 }),
      cash:     mkCash({ cashSales: 200 }),
      payouts:  mkPayouts(),
      lottery:  mkLottery({
        machineDrawSales:  20,
        machineCashings:  100,
        instantCashings:   50,
      }),
    });

    // netLottery = 0 + 20 − 100 − 50 = -130
    assert.equal(recon.lottery.netLotteryCash, -130);
    // expected = 100 + 200 − 130 = 170
    assert.equal(recon.expectedDrawer, 170);
  });
});

describe('computeShiftReconciliation — line items', () => {
  test('lineItems include opening + 5 core POS rows + Expected when no lottery', () => {
    const recon = computeShiftReconciliation({
      shift:   mkShift({ openingAmount: 100 }),
      cash:    mkCash({ cashSales: 200, cashRefunds: 10 }),
      payouts: mkPayouts({ cashDropsTotal: 30, cashIn: 5, cashOut: 15 }),
      lottery: mkLottery(),
    });

    const keys = recon.lineItems.map(li => li.key);
    assert.deepEqual(keys, [
      'opening',
      'cashSales',
      'cashRefunds',
      'cashIn',
      'cashOut',
      'cashDrops',
      'expected', // no lottery rows because all amounts are 0
    ]);
  });

  test('lineItems include lottery rows ONLY when amounts non-zero', () => {
    const recon = computeShiftReconciliation({
      shift:   mkShift(),
      cash:    mkCash(),
      payouts: mkPayouts(),
      lottery: mkLottery({
        ticketMathSales:   50,
        posLotterySales:    0,    // un-rung = $50 (>0, row appears)
        machineDrawSales:   0,    // (=0, no row)
        machineCashings:   25,    // (>0, row appears)
        instantCashings:    0,    // (=0, no row)
      }),
    });

    const keys = recon.lineItems.map(li => li.key);
    assert.ok(keys.includes('lotteryUnreported'),
      'unreported cash row should appear when un-rung > 0');
    assert.ok(!keys.includes('machineDrawSales'),
      'machine draw row should be hidden when amount is 0');
    assert.ok(keys.includes('machineCashings'),
      'machine cashing row should appear when > 0');
    assert.ok(!keys.includes('instantCashings'),
      'instant cashing row should be hidden when amount is 0');
  });

  test('Expected line is always last and marked subtotal', () => {
    const recon = computeShiftReconciliation({
      shift:   mkShift(),
      cash:    mkCash(),
      payouts: mkPayouts(),
      lottery: mkLottery(),
    });
    const last = recon.lineItems[recon.lineItems.length - 1];
    assert.equal(last.key,  'expected');
    assert.equal(last.kind, 'subtotal');
  });

  test('opening row is marked kind=opening; outflows kind=outgoing', () => {
    const recon = computeShiftReconciliation({
      shift:   mkShift({ openingAmount: 100 }),
      cash:    mkCash({ cashSales: 50, cashRefunds: 5 }),
      payouts: mkPayouts({ cashDropsTotal: 10, cashOut: 5 }),
      lottery: mkLottery(),
    });
    const byKey = Object.fromEntries(recon.lineItems.map(li => [li.key, li]));
    assert.equal(byKey.opening.kind,     'opening');
    assert.equal(byKey.cashSales.kind,   'incoming');
    assert.equal(byKey.cashRefunds.kind, 'outgoing');
    assert.equal(byKey.cashDrops.kind,   'outgoing');
    assert.equal(byKey.cashOut.kind,     'outgoing');
  });
});

describe('computeShiftReconciliation — rounding', () => {
  test('all currency fields rounded to 2 decimals', () => {
    const recon = computeShiftReconciliation({
      shift:   mkShift({ openingAmount: 100.123 }),
      cash:    mkCash({ cashSales: 50.456, cashRefunds: 5.999 }),
      payouts: mkPayouts({ cashDropsTotal: 10.111 }),
      lottery: mkLottery({
        ticketMathSales: 33.337,
        machineDrawSales: 12.345,
      }),
    });
    // No NaN, no extra decimals
    for (const key of ['openingFloat', 'cashSales', 'cashRefunds', 'cashDropsTotal', 'expectedDrawer']) {
      const v = recon[key];
      assert.ok(Number.isFinite(v), `${key} should be finite, got ${v}`);
      // 2-decimal-place check: v * 100 should be integer-ish within fp tolerance
      assert.ok(Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
        `${key} = ${v} should be 2-decimal-place rounded`);
    }
  });
});
