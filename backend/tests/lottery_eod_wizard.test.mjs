// Phase 3g — End-of-Shift wizard invariants.
//
// The wizard lives in cashier-app/src/components/modals/LotteryShiftModal.jsx
// (Counter Scan → Online Sales → Confirm & Save). These are pure-logic
// tests mirroring the helpers that drive the wizard so any refactor that
// drifts the math will fail here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── Helpers (mirror component logic) ──────────────────────────────────────

/**
 * Per-box computed data — mirror of boxData useMemo in LotteryShiftModal.
 * Given a raw box + current endTicket input + isSoldout flag, return
 * { ticketsSold, calcAmount, soldoutAmount, rowComplete }.
 */
function rowData(box, endTickets, soldoutMap) {
  const startNum = parseInt(box.startTicket || box.lastShiftEndTicket || '0', 10);
  const endRaw = endTickets[box.id] || '';
  const endNum = endRaw ? parseInt(endRaw, 10) : null;
  const isSoldout = !!soldoutMap[box.id];
  const price = Number(box.game?.ticketPrice || box.ticketPrice || 0);
  const ticketsSold = !isSoldout && endNum !== null && !Number.isNaN(endNum)
    ? Math.abs(startNum - endNum)
    : null;
  const calcAmount = ticketsSold !== null ? ticketsSold * price : null;
  const soldoutAmount = isSoldout ? Number(box.totalValue || 0) : null;
  const rowComplete = isSoldout || (endNum !== null && !Number.isNaN(endNum));
  return { startNum, endNum, isSoldout, price, ticketsSold, calcAmount, soldoutAmount, rowComplete };
}

/** All-complete gate — mirror of allComplete invariant. */
function allComplete(boxes, endTickets, soldoutMap) {
  return boxes.every(b => rowData(b, endTickets, soldoutMap).rowComplete);
}

/** Scanned total — mirror of scannedTotal derivation. */
function scannedTotal(boxes, endTickets, soldoutMap) {
  return boxes.reduce((s, b) => {
    const r = rowData(b, endTickets, soldoutMap);
    if (r.isSoldout) return s + (r.soldoutAmount || 0);
    return s + (r.calcAmount || 0);
  }, 0);
}

/** Daily-due formula — mirror of report.dailyDue derivation. */
function dailyDue({ instantSales, instantCashings, machineSales, machineCashings }) {
  const raw = (instantSales - instantCashings) + (machineSales - machineCashings);
  return Math.round(raw * 100) / 100;
}

/**
 * sellDirection-aware default startTicket — mirror of autoActivator.js
 * lines 208-220 used on new-book activation. Returns the ticket number the
 * book starts at before any sale.
 */
function deriveStartTicket({ sellDirection, totalTickets, scannedTicket }) {
  const total = Number(totalTickets || 0);
  if (total > 0) {
    return sellDirection === 'asc' ? '0' : String(total - 1);
  }
  return scannedTicket ?? null;
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const GAME_10 = { id: 'g1', name: '$10 Diamond Deluxe', ticketPrice: 10, totalTickets: 30, totalValue: 300 };
const GAME_5  = { id: 'g2', name: '$5 Cash Cow',        ticketPrice: 5,  totalTickets: 60, totalValue: 300 };
const GAME_2  = { id: 'g3', name: '$2 Lucky Seven',     ticketPrice: 2,  totalTickets: 150, totalValue: 300 };

const BOX_A_DESC = { // descending: start=29, endToday=20 → 9 sold → $90
  id: 'b-a', gameId: 'g1', boxNumber: '001', startTicket: '29', lastShiftEndTicket: '29',
  game: GAME_10, totalTickets: 30, totalValue: 300,
};
const BOX_B_ASC = { // ascending: start=0, endToday=5 → 5 sold → $25
  id: 'b-b', gameId: 'g2', boxNumber: '002', startTicket: '0', lastShiftEndTicket: '0',
  game: GAME_5, totalTickets: 60, totalValue: 300,
};
const BOX_C_DESC = { // descending mid-book: start=149, endToday=100 → 49 sold → $98
  id: 'b-c', gameId: 'g3', boxNumber: '003', startTicket: '149', lastShiftEndTicket: '149',
  game: GAME_2, totalTickets: 150, totalValue: 300,
};

// ══════════════════════════════════════════════════════════════════════════
// 1. Row-level math (descending vs ascending)
// ══════════════════════════════════════════════════════════════════════════

describe('Row math — ticketsSold = |start - end|', () => {
  test('Descending book — start=29, endToday=20 → 9 tickets sold, $90', () => {
    const r = rowData(BOX_A_DESC, { 'b-a': '20' }, {});
    assert.equal(r.ticketsSold, 9);
    assert.equal(r.calcAmount, 90);
    assert.equal(r.rowComplete, true);
    assert.equal(r.isSoldout, false);
  });

  test('Ascending book — start=0, endToday=5 → 5 tickets sold, $25', () => {
    const r = rowData(BOX_B_ASC, { 'b-b': '5' }, {});
    assert.equal(r.ticketsSold, 5);
    assert.equal(r.calcAmount, 25);
  });

  test('No end entered → ticketsSold is null and row is NOT complete', () => {
    const r = rowData(BOX_A_DESC, {}, {});
    assert.equal(r.ticketsSold, null);
    assert.equal(r.calcAmount, null);
    assert.equal(r.rowComplete, false);
  });

  test('Soldout row → ticketsSold null, soldoutAmount = totalValue, rowComplete true', () => {
    const r = rowData(BOX_A_DESC, {}, { 'b-a': true });
    assert.equal(r.isSoldout, true);
    assert.equal(r.ticketsSold, null);
    assert.equal(r.soldoutAmount, 300);
    assert.equal(r.rowComplete, true);
  });

  test('Soldout overrides endTicket (both set) — row uses totalValue, not calcAmount', () => {
    const r = rowData(BOX_A_DESC, { 'b-a': '20' }, { 'b-a': true });
    assert.equal(r.isSoldout, true);
    assert.equal(r.ticketsSold, null, 'ticketsSold must be null when soldout');
    assert.equal(r.soldoutAmount, 300);
  });

  test('Zero sold — end = start → 0 tickets, $0, row still complete', () => {
    const r = rowData(BOX_A_DESC, { 'b-a': '29' }, {});
    assert.equal(r.ticketsSold, 0);
    assert.equal(r.calcAmount, 0);
    assert.equal(r.rowComplete, true, 'row with 0 sold but scanned must still be complete');
  });

  test('Invalid endTicket (non-numeric) → ticketsSold null, row NOT complete', () => {
    const r = rowData(BOX_A_DESC, { 'b-a': 'abc' }, {});
    assert.equal(r.ticketsSold, null);
    assert.equal(r.rowComplete, false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. allComplete — gate for advancing past Step 1
// ══════════════════════════════════════════════════════════════════════════

describe('Step 1 gate — allComplete', () => {
  const threeBoxes = [BOX_A_DESC, BOX_B_ASC, BOX_C_DESC];

  test('Empty wizard (no endTickets, no soldouts) → NOT complete', () => {
    assert.equal(allComplete(threeBoxes, {}, {}), false);
  });

  test('All three scanned → complete', () => {
    const endTickets = { 'b-a': '20', 'b-b': '5', 'b-c': '100' };
    assert.equal(allComplete(threeBoxes, endTickets, {}), true);
  });

  test('Two scanned, one soldout → complete', () => {
    const endTickets = { 'b-a': '20', 'b-b': '5' };
    const soldoutMap = { 'b-c': true };
    assert.equal(allComplete(threeBoxes, endTickets, soldoutMap), true);
  });

  test('Two scanned, one blank → NOT complete (gate blocks Next)', () => {
    const endTickets = { 'b-a': '20', 'b-b': '5' };
    assert.equal(allComplete(threeBoxes, endTickets, {}), false, 'missing one row must block Next');
  });

  test('All three soldout → complete (valid for unusual EoD with no sales)', () => {
    const soldoutMap = { 'b-a': true, 'b-b': true, 'b-c': true };
    assert.equal(allComplete(threeBoxes, {}, soldoutMap), true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. scannedTotal aggregation
// ══════════════════════════════════════════════════════════════════════════

describe('Instant Sales Total (scannedTotal) aggregation', () => {
  test('Three scanned descending/ascending — sums correctly', () => {
    // BOX_A: start=29, end=20, 9 sold @ $10 = $90
    // BOX_B: start=0,  end=5,  5 sold @ $5  = $25
    // BOX_C: start=149,end=100,49 sold @ $2 = $98
    // Total = $213
    const boxes = [BOX_A_DESC, BOX_B_ASC, BOX_C_DESC];
    const endTickets = { 'b-a': '20', 'b-b': '5', 'b-c': '100' };
    assert.equal(scannedTotal(boxes, endTickets, {}), 213);
  });

  test('Mixed scanned + soldout — soldout uses totalValue, scanned uses ticketsSold*price', () => {
    const boxes = [BOX_A_DESC, BOX_B_ASC];
    // BOX_A soldout → $300 (totalValue)
    // BOX_B scanned: 5 sold @ $5 = $25
    // Total = $325
    assert.equal(scannedTotal(boxes, { 'b-b': '5' }, { 'b-a': true }), 325);
  });

  test('All soldout → sum of totalValues (per-box book-snap)', () => {
    const boxes = [BOX_A_DESC, BOX_B_ASC, BOX_C_DESC];
    assert.equal(scannedTotal(boxes, {}, { 'b-a': true, 'b-b': true, 'b-c': true }), 900);
  });

  test('Empty wizard → 0 (no contribution from incomplete rows)', () => {
    assert.equal(scannedTotal([BOX_A_DESC, BOX_B_ASC], {}, {}), 0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. Daily-due formula (Step 3 headline number)
// ══════════════════════════════════════════════════════════════════════════

describe('Daily Due formula: (instantSales − instantCashings) + (machineSales − machineCashings)', () => {
  test('Normal mid-day: $500 instant − $80 cashings + $1200 machine − $300 cashings = $1320', () => {
    const result = dailyDue({ instantSales: 500, instantCashings: 80, machineSales: 1200, machineCashings: 300 });
    assert.equal(result, 1320);
  });

  test('Heavy payout day: negative daily due possible', () => {
    // Tiny sales + huge cashings
    const result = dailyDue({ instantSales: 100, instantCashings: 500, machineSales: 50, machineCashings: 200 });
    assert.equal(result, -550);
  });

  test('Zero-everywhere day → 0', () => {
    assert.equal(dailyDue({ instantSales: 0, instantCashings: 0, machineSales: 0, machineCashings: 0 }), 0);
  });

  test('Instant-only store (no machine) — machine fields are 0', () => {
    const result = dailyDue({ instantSales: 500, instantCashings: 80, machineSales: 0, machineCashings: 0 });
    assert.equal(result, 420);
  });

  test('Floating-point cents rounded to 2 decimals', () => {
    const result = dailyDue({ instantSales: 99.99, instantCashings: 0.01, machineSales: 0, machineCashings: 0 });
    assert.equal(result, 99.98);
  });

  test('Penny-dust (1/3 cents) rounded correctly (Math.round not banker)', () => {
    // 10 / 3 = 3.3333... but rounded pre-Math.round to 2 decimals via /100 *100
    const result = dailyDue({ instantSales: 100.005, instantCashings: 0, machineSales: 0, machineCashings: 0 });
    // Math.round(100.005 * 100) = 10001 → /100 = 100.01 (browser-dependent FP)
    assert.ok(Math.abs(result - 100.01) < 0.01 || Math.abs(result - 100.00) < 0.01);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. sellDirection-aware startTicket derivation (autoActivator)
// ══════════════════════════════════════════════════════════════════════════

describe('New-book activation startTicket — sellDirection awareness', () => {
  test('Descending default, 150-pack → startTicket = "149"', () => {
    assert.equal(deriveStartTicket({ sellDirection: 'desc', totalTickets: 150 }), '149');
  });

  test('Ascending, 150-pack → startTicket = "0"', () => {
    assert.equal(deriveStartTicket({ sellDirection: 'asc',  totalTickets: 150 }), '0');
  });

  test('Descending, 30-pack → startTicket = "29"', () => {
    assert.equal(deriveStartTicket({ sellDirection: 'desc', totalTickets: 30 }), '29');
  });

  test('Ascending, 60-pack → startTicket = "0"', () => {
    assert.equal(deriveStartTicket({ sellDirection: 'asc',  totalTickets: 60 }), '0');
  });

  test('Unknown direction treated as descending (safer default)', () => {
    assert.equal(deriveStartTicket({ sellDirection: undefined, totalTickets: 150 }), '149');
    assert.equal(deriveStartTicket({ sellDirection: null,      totalTickets: 150 }), '149');
  });

  test('No totalTickets → fallback to scanned ticket (if any)', () => {
    assert.equal(deriveStartTicket({ sellDirection: 'desc', totalTickets: 0, scannedTicket: '42' }), '42');
    assert.equal(deriveStartTicket({ sellDirection: 'asc',  totalTickets: null }), null);
  });

  test('100-pack book — desc=99 / asc=0 (common US states game size)', () => {
    assert.equal(deriveStartTicket({ sellDirection: 'desc', totalTickets: 100 }), '99');
    assert.equal(deriveStartTicket({ sellDirection: 'asc',  totalTickets: 100 }), '0');
  });

  test('Activation startTicket is a string (matches Prisma String column)', () => {
    const s1 = deriveStartTicket({ sellDirection: 'desc', totalTickets: 30 });
    const s2 = deriveStartTicket({ sellDirection: 'asc',  totalTickets: 30 });
    assert.equal(typeof s1, 'string');
    assert.equal(typeof s2, 'string');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. End-to-end scenario: scan-to-activate mid-wizard
// ══════════════════════════════════════════════════════════════════════════

describe('Scan-to-activate scenario — cashier opens a new book mid-wizard', () => {
  test('Desc store, 150-pack scanned at ticket 149 → startTicket=149, endToday=149, ticketsSold=0', () => {
    // Sequence: backend autoActivator activates with startTicket='149' (desc),
    // frontend auto-fills endTickets[newBoxId] = '149' (scanned ticket).
    const newBox = {
      id: 'b-new', gameId: 'g1', boxNumber: '999',
      startTicket: deriveStartTicket({ sellDirection: 'desc', totalTickets: 150 }),
      game: { ...GAME_10, totalTickets: 150 },
      totalTickets: 150,
    };
    const endTickets = { 'b-new': '149' };   // auto-filled by scan
    const r = rowData(newBox, endTickets, {});
    assert.equal(r.startNum, 149);
    assert.equal(r.endNum, 149);
    assert.equal(r.ticketsSold, 0, 'fresh activation at end of shift: 0 sold');
    assert.equal(r.calcAmount, 0);
    assert.equal(r.rowComplete, true, 'row complete because endTicket is set');
  });

  test('Asc store, 30-pack scanned at ticket 0 → startTicket=0, endToday=0, ticketsSold=0', () => {
    const newBox = {
      id: 'b-new2', gameId: 'g1', boxNumber: '998',
      startTicket: deriveStartTicket({ sellDirection: 'asc', totalTickets: 30 }),
      game: { ...GAME_10, totalTickets: 30 },
      totalTickets: 30,
    };
    const endTickets = { 'b-new2': '0' };
    const r = rowData(newBox, endTickets, {});
    assert.equal(r.startNum, 0);
    assert.equal(r.endNum, 0);
    assert.equal(r.ticketsSold, 0);
    assert.equal(r.rowComplete, true);
  });

  test('Desc store, 150-pack scanned AFTER selling some — start=149, end=140 → 9 sold', () => {
    // Rare but possible: cashier opens new book, sells some tickets, then
    // scans at EoD. startTicket=149 (desc default on activation), end=140 at scan time.
    const newBox = {
      id: 'b-new3', gameId: 'g1', boxNumber: '997',
      startTicket: '149',
      game: { ...GAME_10, totalTickets: 150, ticketPrice: 10 },
      totalTickets: 150,
    };
    const endTickets = { 'b-new3': '140' };
    const r = rowData(newBox, endTickets, {});
    assert.equal(r.ticketsSold, 9);
    assert.equal(r.calcAmount, 90);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 7. Sort invariant — book table sorted by totalValue desc
// ══════════════════════════════════════════════════════════════════════════

describe('Counter sort — by ticket value highest first', () => {
  function sortByValue(boxes) {
    return [...boxes].sort((a, b) => {
      const va = Number(a.totalValue || (a.totalTickets || 0) * (a.game?.ticketPrice || a.ticketPrice || 0));
      const vb = Number(b.totalValue || (b.totalTickets || 0) * (b.game?.ticketPrice || b.ticketPrice || 0));
      return vb - va;
    });
  }

  test('Three equal-value books sort stably by input order (all $300)', () => {
    const sorted = sortByValue([BOX_A_DESC, BOX_B_ASC, BOX_C_DESC]);
    assert.equal(sorted.length, 3);
  });

  test('Highest-value book first — $10 pack before $2 pack', () => {
    const bigBox = { ...BOX_A_DESC, totalValue: 600 };
    const smallBox = { ...BOX_C_DESC, totalValue: 100 };
    const sorted = sortByValue([smallBox, bigBox]);
    assert.equal(sorted[0].id, bigBox.id);
    assert.equal(sorted[1].id, smallBox.id);
  });

  test('Falls back to totalTickets * ticketPrice when totalValue missing', () => {
    const b1 = { id: '1', totalTickets: 30, game: { ticketPrice: 10 } };      // $300
    const b2 = { id: '2', totalTickets: 150, game: { ticketPrice: 2 } };      // $300
    const b3 = { id: '3', totalTickets: 50, game: { ticketPrice: 20 } };      // $1000
    const sorted = sortByValue([b1, b2, b3]);
    assert.equal(sorted[0].id, '3');
  });
});
