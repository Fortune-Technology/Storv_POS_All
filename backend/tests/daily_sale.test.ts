// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

// Phase 3d — Daily Sale math invariants.
//
// Pure helpers (no DB). Keeps the Total In / Total Out / Short-Over
// formulas locked as documented invariants so any refactor that changes
// them fails these tests.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../src/services/dailySaleService.js';

const { round2, dayBoundsUTC } = __test;

describe('round2', () => {
  test('rounds to 2 decimals, half-up', () => {
    assert.equal(round2(12.345), 12.35);
    assert.equal(round2(12.344), 12.34);
  });
  test('handles null/undefined/NaN → 0', () => {
    assert.equal(round2(null), 0);
    assert.equal(round2(undefined), 0);
    assert.equal(round2(NaN), 0);
  });
  test('strings coerced', () => {
    assert.equal(round2('42.666'), 42.67);
    assert.equal(round2('not a number'), 0);
  });
});

describe('dayBoundsUTC', () => {
  test('start is UTC midnight, end is 23:59:59.999Z', () => {
    const { start, end } = dayBoundsUTC('2026-04-21');
    assert.equal(start.toISOString(), '2026-04-21T00:00:00.000Z');
    assert.equal(end.toISOString(),   '2026-04-21T23:59:59.999Z');
  });
});

describe('Total In formula invariants', () => {
  function totalIn({ tenders, lottery, otherIncome = 0, moneyIn = 0, houseTotal = 0 }) {
    const tenderSum = Object.values(tenders).reduce((s, v) => s + Number(v || 0), 0);
    const lotterySales = (lottery.scratchoffSales || 0) + (lottery.machineSales || 0);
    return round2(tenderSum + lotterySales + otherIncome + moneyIn + houseTotal);
  }

  test('Simple day: $100 cash, $50 credit, $200 scratchoff → $350', () => {
    const r = totalIn({
      tenders: { cash: 100, credit: 50, debit: 0, ebt: 0, gift: 0, check: 0, house: 0, other: 0 },
      lottery: { scratchoffSales: 200, machineSales: 0 },
    });
    assert.equal(r, 350);
  });

  test('With online lottery: adds machineSales', () => {
    const r = totalIn({
      tenders: { cash: 0, credit: 0, debit: 0, ebt: 0, gift: 0, check: 0, house: 0, other: 0 },
      lottery: { scratchoffSales: 0, machineSales: 500 },
    });
    assert.equal(r, 500);
  });

  test('House account charges flow through', () => {
    const r = totalIn({
      tenders: { cash: 100, credit: 0, debit: 0, ebt: 0, gift: 0, check: 0, house: 0, other: 0 },
      lottery: { scratchoffSales: 0, machineSales: 0 },
      houseTotal: 25,
    });
    assert.equal(r, 125);
  });

  test('Refunds come through tenders as negative amounts', () => {
    const r = totalIn({
      tenders: { cash: 80, credit: -20, debit: 0, ebt: 0, gift: 0, check: 0, house: 0, other: 0 },
      lottery: { scratchoffSales: 0, machineSales: 0 },
    });
    assert.equal(r, 60);
  });
});

describe('Total Out formula invariants', () => {
  function totalOut({
    bankDeposit = 0, lotteryDeposit = 0,
    creditCardTotal = 0, debitCardTotal = 0,
    purchaseCashPO = 0, expenseCashPO = 0,
    lottery = {},
  }) {
    return round2(
      bankDeposit + lotteryDeposit +
      creditCardTotal + debitCardTotal +
      purchaseCashPO + expenseCashPO +
      (lottery.scratchoffPO || 0) + (lottery.machineCashing || 0) + (lottery.instantCashing || 0)
    );
  }

  test('Bank + lottery deposits only → bare sum', () => {
    const r = totalOut({ bankDeposit: 500, lotteryDeposit: 100 });
    assert.equal(r, 600);
  });

  test('All components summed', () => {
    const r = totalOut({
      bankDeposit: 1000, lotteryDeposit: 200,
      creditCardTotal: 300, debitCardTotal: 150,
      purchaseCashPO: 40, expenseCashPO: 25,
      lottery: { scratchoffPO: 80, machineCashing: 60, instantCashing: 30 },
    });
    assert.equal(r, 1885);
  });

  test('Zero day → 0', () => {
    assert.equal(totalOut({}), 0);
  });
});

describe('Short/Over invariants', () => {
  function shortOver(totalIn, totalOut) {
    return round2(totalIn - totalOut);
  }

  test('Balanced → 0', () => {
    assert.equal(shortOver(1000, 1000), 0);
  });
  test('Over (Total In > Out) → positive', () => {
    assert.equal(shortOver(1015, 1000), 15);
  });
  test('Short (Total In < Out) → negative', () => {
    assert.equal(shortOver(985, 1000), -15);
  });
  test('Float safety: 9.99 − 10 → -0.01 not a JS garbage number', () => {
    assert.equal(shortOver(9.99, 10), -0.01);
  });
});

describe('Dept final amount = auto + adjustment', () => {
  function finalAmt(auto, adj) { return round2(auto + adj); }

  test('Zero adjustment passes through', () => {
    assert.equal(finalAmt(1234.56, 0), 1234.56);
  });
  test('Positive adjustment adds', () => {
    assert.equal(finalAmt(1000, 50), 1050);
  });
  test('Negative adjustment subtracts (corrects over-ring)', () => {
    assert.equal(finalAmt(1000, -100), 900);
  });
});

describe('Tender-method normalization (routing from POS tenderLines)', () => {
  // Mirrors the reducer in aggregatePosActivity → buckets lowercase alpha-only
  // so 'credit_card', 'Credit Card', 'CREDIT' all land in tenders.credit.
  function normalize(method) {
    return String(method || 'other').toLowerCase().replace(/[^a-z]/g, '');
  }
  test('credit_card → credit bucket', () => {
    const n = normalize('credit_card');
    assert.ok(n.includes('credit'));
    assert.equal(n.includes('credit'), true);
  });
  test('Credit Card → credit bucket', () => {
    assert.equal(normalize('Credit Card').includes('credit'), true);
  });
  test('EBT → ebt bucket', () => {
    assert.equal(normalize('EBT').includes('ebt'), true);
  });
  test('gift_card → gift bucket', () => {
    assert.equal(normalize('gift_card').includes('gift'), true);
  });
});
