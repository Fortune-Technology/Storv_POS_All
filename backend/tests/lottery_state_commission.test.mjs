// Phase 3e — state-scoped commission rate invariants.
//
// The settlement engine now reads 4 per-stream rates from the State model:
//   instantSalesCommRate, instantCashingCommRate,
//   machineSalesCommRate, machineCashingCommRate
// with a cascade: state per-stream → state.defaultLotteryCommission →
// LotterySettings.commissionRate → 0.
//
// These tests verify the math that falls out of that cascade without
// touching the DB — we mirror the resolver + formula inline.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Mirror of the rate resolver from settlement.js
function resolveRate(stateRow, streamField, legacyRate) {
  const v = stateRow?.[streamField];
  return v != null ? Number(v) : Number(legacyRate || 0);
}

describe('Rate resolver cascade', () => {
  test('per-stream state rate wins over legacy + per-store', () => {
    const state = { instantSalesCommRate: 0.054, defaultLotteryCommission: 0.05 };
    const storeRate = 0.03;
    assert.equal(resolveRate(state, 'instantSalesCommRate', state.defaultLotteryCommission ?? storeRate), 0.054);
  });
  test('falls back to state.defaultLotteryCommission when per-stream is null', () => {
    const state = { instantSalesCommRate: null, defaultLotteryCommission: 0.05 };
    const storeRate = 0.03;
    const legacy = state.defaultLotteryCommission ?? storeRate;
    assert.equal(resolveRate(state, 'instantSalesCommRate', legacy), 0.05);
  });
  test('falls back to per-store commissionRate when state has nothing', () => {
    const state = { instantSalesCommRate: null, defaultLotteryCommission: null };
    const storeRate = 0.03;
    const legacy = state?.defaultLotteryCommission ?? storeRate;
    assert.equal(resolveRate(state, 'instantSalesCommRate', legacy), 0.03);
  });
  test('zero explicit rate is honoured (not overridden by fallback)', () => {
    const state = { instantSalesCommRate: 0, defaultLotteryCommission: 0.05 };
    // 0 is a real value — explicit "no commission" should not cascade.
    assert.equal(resolveRate(state, 'instantSalesCommRate', state.defaultLotteryCommission), 0);
  });
});

describe('Weekly formula — user spec', () => {
  // User specified:
  //   Daily    = Instant sales − Instant cashings + Machine sales − Machine cashings
  //   Weekly   = Σ daily − bonus + service charge − adjustments − returns − commissions
  function weeklyPayable({ instantSales, instantPayouts, machineSales, machineCashings,
                          returns, commission, bonus, service, adjustments }) {
    const gross = (instantSales - instantPayouts) + (machineSales - machineCashings);
    const net   = gross - returns - commission;
    return Math.round((net - bonus + service - adjustments) * 100) / 100;
  }

  test('Clean week: 10k instant sales, 4k instant payouts, 2k machine sales, 800 machine cashing, 100 commission → 7,100', () => {
    const r = weeklyPayable({
      instantSales: 10000, instantPayouts: 4000,
      machineSales: 2000, machineCashings: 800,
      returns: 0, commission: 100,
      bonus: 0, service: 0, adjustments: 0,
    });
    // gross = (10000-4000) + (2000-800) = 6000 + 1200 = 7200
    // net = 7200 - 0 - 100 = 7100
    assert.equal(r, 7100);
  });

  test('Bonus reduces payable, service increases, adjustment reduces', () => {
    const r = weeklyPayable({
      instantSales: 10000, instantPayouts: 4000,
      machineSales: 0, machineCashings: 0,
      returns: 0, commission: 0,
      bonus: 500, service: 21, adjustments: 100,
    });
    // gross = 6000, net = 6000
    // payable = 6000 - 500 + 21 - 100 = 5421
    assert.equal(r, 5421);
  });

  test('Returns subtract from net (store owes less when books are returned)', () => {
    const r = weeklyPayable({
      instantSales: 10000, instantPayouts: 4000,
      machineSales: 0, machineCashings: 0,
      returns: 300, commission: 0,
      bonus: 0, service: 0, adjustments: 0,
    });
    assert.equal(r, 5700);
  });

  test('Negative payable when commission + returns + bonus > gross (store has credit)', () => {
    const r = weeklyPayable({
      instantSales: 100, instantPayouts: 50,
      machineSales: 0, machineCashings: 0,
      returns: 20, commission: 30,
      bonus: 10, service: 0, adjustments: 0,
    });
    // gross = 50, net = 50 - 20 - 30 = 0
    // payable = 0 - 10 + 0 - 0 = -10  (commission owes store more than it owes lottery)
    assert.equal(r, -10);
  });
});

describe('Per-source commission split', () => {
  // Test that the 4-rate breakdown produces the same total as a single flat
  // rate when all 4 streams use the same rate.
  function totalCommission4({ instantSales, instantPayouts, machineSales, machineCashings, rates }) {
    return (
      instantSales     * rates.instantSales +
      instantPayouts   * rates.instantCashing +
      machineSales     * rates.machineSales +
      machineCashings  * rates.machineCashing
    );
  }

  test('Uniform 5.4% applied to all streams matches single-rate math', () => {
    const rates = { instantSales: 0.054, instantCashing: 0.054, machineSales: 0.054, machineCashing: 0.054 };
    const inputs = { instantSales: 10000, instantPayouts: 4000, machineSales: 2000, machineCashings: 800 };
    const split = totalCommission4({ ...inputs, rates });
    const single = (inputs.instantSales + inputs.instantPayouts + inputs.machineSales + inputs.machineCashings) * 0.054;
    assert.equal(Math.round(split * 100) / 100, Math.round(single * 100) / 100);
  });

  test('Differentiated rates (5.4% sales, 1% cashing) produce expected breakdown', () => {
    const rates = { instantSales: 0.054, instantCashing: 0.01, machineSales: 0.054, machineCashing: 0.01 };
    const split = totalCommission4({
      instantSales: 10000, instantPayouts: 4000, machineSales: 2000, machineCashings: 800,
      rates,
    });
    // = 10000*0.054 + 4000*0.01 + 2000*0.054 + 800*0.01
    // = 540 + 40 + 108 + 8 = 696
    assert.equal(Math.round(split * 100) / 100, 696);
  });

  test('Zero rate on one stream zeroes out that component only', () => {
    const rates = { instantSales: 0.054, instantCashing: 0, machineSales: 0.054, machineCashing: 0 };
    const split = totalCommission4({
      instantSales: 1000, instantPayouts: 9999, machineSales: 1000, machineCashings: 9999,
      rates,
    });
    // = 1000*0.054 + 0 + 1000*0.054 + 0 = 108
    assert.equal(Math.round(split * 100) / 100, 108);
  });
});
