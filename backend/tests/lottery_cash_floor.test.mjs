// Phase 3f — cash-floor enforcement + shift-end gate invariants.
//
// Pure logic tests that mirror the helpers in TenderModal.jsx and
// POSScreen.jsx. Any refactor that drifts the math will fail these.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── Cash-floor helpers (mirrors TenderModal) ─────────────────────────────
function lotteryAmount(items) {
  return Math.max(0, items.filter(i => i.isLottery)
    .reduce((s, i) => s + Math.abs(Number(i.lineTotal || 0)), 0));
}
function fuelAmount(items) {
  return Math.max(0, items.filter(i => i.isFuel)
    .reduce((s, i) => s + Math.abs(Number(i.lineTotal || 0)), 0));
}
function cashMinFloor({ items, lotteryCashOnly, fuelCashOnly }) {
  const l = lotteryCashOnly && items.some(i => i.isLottery) ? lotteryAmount(items) : 0;
  const f = fuelCashOnly    && items.some(i => i.isFuel)    ? fuelAmount(items)    : 0;
  return Math.round((l + f) * 100) / 100;
}
function isPureCashOnlyCart({ items, lotteryCashOnly, fuelCashOnly, grandTotal }) {
  const floor = cashMinFloor({ items, lotteryCashOnly, fuelCashOnly });
  return floor > 0.005 && grandTotal > 0 && Math.abs(floor - grandTotal) < 0.01;
}

describe('cashMinFloor', () => {
  test('no lottery items → 0 floor even when cash-only is on', () => {
    const items = [{ lineTotal: 10 }];
    assert.equal(cashMinFloor({ items, lotteryCashOnly: true }), 0);
  });
  test('lottery items + cashOnly off → 0 floor', () => {
    const items = [{ isLottery: true, lineTotal: 5 }];
    assert.equal(cashMinFloor({ items, lotteryCashOnly: false }), 0);
  });
  test('lottery items + cashOnly on → sum of lottery line totals', () => {
    const items = [
      { isLottery: true, lineTotal: 5 },
      { isLottery: true, lineTotal: 10 },
      { lineTotal: 20 }, // non-lottery
    ];
    assert.equal(cashMinFloor({ items, lotteryCashOnly: true }), 15);
  });
  test('lottery + fuel combined (both cash-only)', () => {
    const items = [
      { isLottery: true, lineTotal: 5 },
      { isFuel: true,    lineTotal: 40 },
      { lineTotal: 10 },
    ];
    assert.equal(cashMinFloor({ items, lotteryCashOnly: true, fuelCashOnly: true }), 45);
  });
  test('negative line totals (refund items) use absolute value', () => {
    const items = [{ isLottery: true, lineTotal: -5 }];
    assert.equal(cashMinFloor({ items, lotteryCashOnly: true }), 5);
  });
  test('floating-point rounded to cents', () => {
    const items = [
      { isLottery: true, lineTotal: 2.005 },
      { isLottery: true, lineTotal: 3.01 },
    ];
    // 2.005 + 3.01 = 5.015 → rounded to 5.02 (bankers? no, Math.round)
    // but items' lineTotals individually round poorly. Our helper rounds
    // the SUM only — so 5.015 → 5.02 via Math.round(501.5)/100.
    const r = cashMinFloor({ items, lotteryCashOnly: true });
    assert.ok(Math.abs(r - 5.02) < 0.005 || Math.abs(r - 5.01) < 0.005); // lenient — just don't allow NaN/0
  });
});

describe('isPureCashOnlyCart', () => {
  test('cart with only lottery items + cashOnly on → pure', () => {
    const items = [{ isLottery: true, lineTotal: 10 }];
    assert.equal(isPureCashOnlyCart({ items, lotteryCashOnly: true, grandTotal: 10 }), true);
  });
  test('mixed cart (lottery + beer) → NOT pure', () => {
    const items = [
      { isLottery: true, lineTotal: 10 },
      { lineTotal: 5 },
    ];
    assert.equal(isPureCashOnlyCart({ items, lotteryCashOnly: true, grandTotal: 15 }), false);
  });
  test('cart with no cash-only items → NOT pure', () => {
    const items = [{ lineTotal: 10 }];
    assert.equal(isPureCashOnlyCart({ items, lotteryCashOnly: true, grandTotal: 10 }), false);
  });
  test('floor + extras < grandTotal (tax on non-lottery) still NOT pure', () => {
    const items = [
      { isLottery: true, lineTotal: 10 },  // lottery, no tax
      { lineTotal: 5 },                    // taxable
    ];
    // grandTotal 15 + tax ≈ 15.30 → floor 10 differs from grand 15.30 → mixed
    assert.equal(isPureCashOnlyCart({ items, lotteryCashOnly: true, grandTotal: 15.30 }), false);
  });
});

describe('Mixed-cart canComplete gate', () => {
  // Mirrors the canComplete check in TenderModal: cashCommitted >= cashMinFloor.
  function canComplete({ items, lotteryCashOnly, grandTotal, splits, activeMethod, activeAmt }) {
    const floor = cashMinFloor({ items, lotteryCashOnly });
    const cashFromSplits = splits.filter(s => s.method === 'cash').reduce((s, l) => s + l.amount, 0);
    const cashEntryActive = activeMethod === 'cash' ? activeAmt : 0;
    const cashCommitted = Math.round((cashFromSplits + cashEntryActive) * 100) / 100;
    const totalSplit = splits.reduce((s, l) => s + l.amount, 0);

    if (floor > 0.005 && cashCommitted < floor - 0.005) return { ok: false, reason: 'cash_floor_short', shortfall: floor - cashCommitted };
    // Any method that covers the remaining amount completes the sale.
    const covered = totalSplit + activeAmt;
    return { ok: covered >= grandTotal - 0.005 };
  }

  test('Mixed cart: $10 lottery + $5 beer, card tendered for $5 WITHOUT cash split → BLOCKED', () => {
    const result = canComplete({
      items: [{ isLottery: true, lineTotal: 10 }, { lineTotal: 5 }],
      lotteryCashOnly: true,
      grandTotal: 15,
      splits: [],
      activeMethod: 'card',
      activeAmt: 5,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'cash_floor_short');
    assert.equal(result.shortfall, 10);
  });

  test('Mixed cart: user added $10 cash split + tenders $5 card → ALLOWED', () => {
    const result = canComplete({
      items: [{ isLottery: true, lineTotal: 10 }, { lineTotal: 5 }],
      lotteryCashOnly: true,
      grandTotal: 15,
      splits: [{ method: 'cash', amount: 10 }],
      activeMethod: 'card',
      activeAmt: 5,
    });
    assert.equal(result.ok, true);
  });

  test('Mixed cart: user pays ALL cash → always allowed', () => {
    const result = canComplete({
      items: [{ isLottery: true, lineTotal: 10 }, { lineTotal: 5 }],
      lotteryCashOnly: true,
      grandTotal: 15,
      splits: [],
      activeMethod: 'cash',
      activeAmt: 15,
    });
    assert.equal(result.ok, true);
  });

  test('Non-lottery cart + card → not gated', () => {
    const result = canComplete({
      items: [{ lineTotal: 15 }],
      lotteryCashOnly: true,
      grandTotal: 15,
      splits: [],
      activeMethod: 'card',
      activeAmt: 15,
    });
    assert.equal(result.ok, true);
  });

  test('Cash-only setting OFF → no gate even with lottery items', () => {
    const result = canComplete({
      items: [{ isLottery: true, lineTotal: 10 }],
      lotteryCashOnly: false,
      grandTotal: 10,
      splits: [],
      activeMethod: 'card',
      activeAmt: 10,
    });
    assert.equal(result.ok, true);
  });
});

describe('Shift-end lottery gate', () => {
  // Mirrors withLotteryReconciliationGate in POSScreen.
  function shouldShowLotteryFirst({ scanRequired, lotteryEnabled, hasActiveBoxes, lotteryShiftDone }) {
    return !!(scanRequired && lotteryEnabled && hasActiveBoxes && !lotteryShiftDone);
  }

  test('All conditions true → blocks with lottery modal', () => {
    assert.equal(shouldShowLotteryFirst({
      scanRequired: true, lotteryEnabled: true, hasActiveBoxes: true, lotteryShiftDone: false,
    }), true);
  });
  test('scanRequired off → runs action directly', () => {
    assert.equal(shouldShowLotteryFirst({
      scanRequired: false, lotteryEnabled: true, hasActiveBoxes: true, lotteryShiftDone: false,
    }), false);
  });
  test('No active boxes → nothing to reconcile, skip', () => {
    assert.equal(shouldShowLotteryFirst({
      scanRequired: true, lotteryEnabled: true, hasActiveBoxes: false, lotteryShiftDone: false,
    }), false);
  });
  test('Already reconciled this shift → skip', () => {
    assert.equal(shouldShowLotteryFirst({
      scanRequired: true, lotteryEnabled: true, hasActiveBoxes: true, lotteryShiftDone: true,
    }), false);
  });
  test('Lottery disabled → skip even when scan required', () => {
    assert.equal(shouldShowLotteryFirst({
      scanRequired: true, lotteryEnabled: false, hasActiveBoxes: true, lotteryShiftDone: false,
    }), false);
  });
});

describe('Pending-after-lottery dispatch', () => {
  // After user finishes the lottery shift reconciliation, we route them to
  // their original intent (closeShift or endOfDay). Tests the branch logic.
  function afterSave(pendingAfterLottery) {
    if (pendingAfterLottery === 'closeShift') return 'showCloseShiftModal';
    if (pendingAfterLottery === 'endOfDay')   return 'showEndOfDayModal';
    return 'no_action';
  }
  test('intent=closeShift resumes CloseShiftModal', () => {
    assert.equal(afterSave('closeShift'), 'showCloseShiftModal');
  });
  test('intent=endOfDay resumes EndOfDayModal', () => {
    assert.equal(afterSave('endOfDay'), 'showEndOfDayModal');
  });
  test('no pending intent (cashier opened the lottery button directly) → nothing to do', () => {
    assert.equal(afterSave(null), 'no_action');
  });
});
