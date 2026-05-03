// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

/**
 * loyalty_phases_6_9.test.mjs
 *
 * Targeted coverage of the manual test plan Phases 6 → 9 with one
 * automated check per scenario. Read alongside the manual cheat sheet
 * we shipped with the same test plan.
 *
 *   Phase 6 — Edge cases (insufficient / single-active / detach /
 *             no-customer / lottery / sub-dollar / bottle return /
 *             disable mid-shift / unlimited limit)
 *   Phase 7 — Audit trail invariants
 *   Phase 8 — Void reverses points (idempotent)
 *   Phase 9 — Refund reverses points + charge balance
 *
 * Uses the same in-memory Prisma mock as loyalty_phases.test.mjs so
 * you can run both files together without conflict.
 *
 * Run: node --test tests/loyalty_phases_6_9.test.mjs
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ─── In-memory Prisma mock (shared with loyalty service + charge service) ──
const state = {
  programs:  new Map(),
  earnRules: [],
  customers: new Map(),
};

const prismaMock = {
  loyaltyProgram: {
    findUnique: async ({ where: { storeId } }) => state.programs.get(storeId) || null,
  },
  loyaltyEarnRule: {
    findMany: async ({ where: { storeId, active } }) =>
      state.earnRules.filter(r => r.storeId === storeId && r.active === active),
  },
  customer: {
    findFirst: async ({ where }) => {
      const c = [...state.customers.values()].find(c =>
        (where.id ? c.id === where.id : true) &&
        (where.orgId ? c.orgId === where.orgId : true) &&
        (where.deleted === false ? !c.deleted : true)
      );
      return c ? { ...c } : null;
    },
    findMany: async ({ where }) =>
      [...state.customers.values()].filter(c => {
        if (where.orgId && c.orgId !== where.orgId) return false;
        if (where.deleted === false && c.deleted) return false;
        if (where.instoreChargeEnabled === true && !c.instoreChargeEnabled) return false;
        if (where.storeId && c.storeId !== where.storeId) return false;
        if (where.loyaltyPoints?.gt != null && (c.loyaltyPoints || 0) <= where.loyaltyPoints.gt) return false;
        return true;
      }).map(c => ({ ...c })),
    update: async ({ where: { id }, data }) => {
      const c = state.customers.get(id);
      if (!c) throw new Error('not found');
      if (data.loyaltyPoints !== undefined) c.loyaltyPoints = data.loyaltyPoints;
      if (data.pointsHistory !== undefined) c.pointsHistory = data.pointsHistory;
      if (data.balance?.increment != null) c.balance = (Number(c.balance) || 0) + data.balance.increment;
      if (data.balance?.decrement != null) c.balance = (Number(c.balance) || 0) - data.balance.decrement;
      return { ...c };
    },
  },
};

const loyalty = await import('../src/services/loyaltyService.js');
const charge  = await import('../src/services/chargeAccountService.js');
loyalty._setPrismaForTests(prismaMock);
charge._setPrismaForTests(prismaMock);

// ─── Helpers ───────────────────────────────────────────────────────────────
function reset() {
  state.programs.clear();
  state.earnRules.length = 0;
  state.customers.clear();
}

function setProgram(storeId, p = {}) {
  state.programs.set(storeId, {
    storeId, orgId: 'org1',
    enabled: true,
    pointsPerDollar: 1, redeemPointsPerDollar: 100,
    minPointsToRedeem: 100,
    welcomeBonus: 0, birthdayBonus: 0, expiryDays: null,
    ...p,
  });
}

function addCustomer(c) {
  const row = {
    id: c.id, orgId: 'org1', storeId: 'store1',
    loyaltyPoints: 0, pointsHistory: [],
    balance: 0, balanceLimit: 0, instoreChargeEnabled: false,
    discount: null, deleted: false,
    ...c,
  };
  state.customers.set(row.id, row);
  return row;
}

function getCustomer(id) { return state.customers.get(id); }

// Mirrors the cashier-app's reward-affordability filter
function affordableRewards(rewards, customerPoints) {
  return rewards.filter(r => r.active && r.pointsCost <= customerPoints);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6 — Edge cases
// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 6 — Edge cases', () => {
  beforeEach(reset);

  // 6.1 — Rewards filtering on the cashier side (affordability)
  test('6.1 — 50pts customer sees BOTH rewards locked when costs are 300/500', () => {
    const rewards = [
      { id: 'r1', name: '$5 off',  pointsCost: 500, active: true },
      { id: 'r2', name: '10% off', pointsCost: 300, active: true },
    ];
    const filtered = affordableRewards(rewards, 50);
    assert.equal(filtered.length, 0); // none affordable
  });

  test('6.1b — 731pts customer sees BOTH rewards unlocked', () => {
    const rewards = [
      { id: 'r1', name: '$5 off',  pointsCost: 500, active: true },
      { id: 'r2', name: '10% off', pointsCost: 300, active: true },
    ];
    const filtered = affordableRewards(rewards, 731);
    assert.equal(filtered.length, 2);
  });

  // 6.2 — Single active redemption (cart store overwrite semantics)
  test('6.2 — Applying a second reward REPLACES the first (not stacked)', () => {
    // Cart store mirror: applyLoyaltyRedemption is set, not append
    let cart = { loyaltyRedemption: null };
    const apply = (r) => { cart.loyaltyRedemption = r; };
    apply({ rewardId: 'r1', rewardName: '$5 off',  pointsCost: 500 });
    apply({ rewardId: 'r2', rewardName: '10% off', pointsCost: 300 });
    assert.equal(cart.loyaltyRedemption.rewardId, 'r2');
    assert.equal(cart.loyaltyRedemption.rewardName, '10% off');
    // r1 is gone — it was replaced, not added alongside
  });

  // 6.3 — Detach customer auto-clears any active redemption
  test('6.3 — clearCustomer also clears loyaltyRedemption', () => {
    let cart = {
      customer: { id: 'c1', name: 'Alice' },
      loyaltyRedemption: { rewardId: 'r1', pointsCost: 500 },
    };
    const clearCustomer = () => { cart.customer = null; cart.loyaltyRedemption = null; };
    clearCustomer();
    assert.equal(cart.customer, null);
    assert.equal(cart.loyaltyRedemption, null);
  });

  // 6.4 — No customer attached → no DB write
  test('6.4 — No customer = no points awarded, no errors', async () => {
    setProgram('store1');
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: null,
      lineItems: [{ qty: 1, lineTotal: 25 }],
      txId: 't', txNumber: 'TXN-1',
    });
    assert.equal(state.customers.size, 0);
  });

  // 6.5 — Lottery items skip earning
  test('6.5 — Lottery sale earns 0 pts', async () => {
    setProgram('store1');
    addCustomer({ id: 'a', loyaltyPoints: 100 });
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 1, lineTotal: 5, isLottery: true }],
      txId: 't', txNumber: 'TXN-1',
    });
    assert.equal(getCustomer('a').loyaltyPoints, 100); // unchanged
  });

  // 6.6 — Sub-dollar floors to 0
  test('6.6 — $0.50 cart → 0 pts (Math.floor)', async () => {
    setProgram('store1', { pointsPerDollar: 1 });
    addCustomer({ id: 'a', loyaltyPoints: 0 });
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 1, lineTotal: 0.50 }],
      txId: 't', txNumber: 'TXN-1',
    });
    assert.equal(getCustomer('a').loyaltyPoints, 0);
  });

  // 6.7 — Bottle returns / negative lines skipped
  test('6.7 — Bottle return (negative line + isBottleReturn flag) earns 0 pts', async () => {
    setProgram('store1');
    addCustomer({ id: 'a', loyaltyPoints: 50 });
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 5, lineTotal: -2.50, isBottleReturn: true }],
      txId: 't', txNumber: 'TXN-1',
    });
    assert.equal(getCustomer('a').loyaltyPoints, 50);
  });

  // 6.8 — Disable program mid-shift
  test('6.8 — Disabled program → 0 pts on next sale, no history entry', async () => {
    setProgram('store1', { enabled: false });
    addCustomer({ id: 'a', loyaltyPoints: 100 });
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 1, lineTotal: 50 }],
      txId: 't', txNumber: 'TXN-1',
    });
    assert.equal(getCustomer('a').loyaltyPoints, 100);
    assert.equal(getCustomer('a').pointsHistory.length, 0);
  });

  // 6.9 — Unlimited limit (balanceLimit = 0)
  test('6.9 — balanceLimit=0 = unlimited; large charge approved', async () => {
    addCustomer({ id: 'vip', balance: 5000, balanceLimit: 0, instoreChargeEnabled: true });
    const r = await charge.applyChargeTender({
      orgId: 'org1', customerId: 'vip', chargeAmount: 999999,
    });
    assert.equal(r.ok, true);
    assert.equal(getCustomer('vip').balance, 5000 + 999999);
  });

  // 6.10 — Charge of $0 rejected
  test('6.10 — Charge $0 → rejected (must be positive)', async () => {
    addCustomer({ id: 'a', balance: 0, balanceLimit: 100, instoreChargeEnabled: true });
    const r = await charge.applyChargeTender({
      orgId: 'org1', customerId: 'a', chargeAmount: 0,
    });
    assert.equal(r.ok, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7 — Audit trail invariants
// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 7 — Audit trail', () => {
  beforeEach(reset);

  test('7.1 — Every mutation writes a structured history entry with date/reason/delta/balance', async () => {
    setProgram('store1', { welcomeBonus: 50 });
    addCustomer({ id: 'a', loyaltyPoints: 0 });
    await loyalty.awardWelcomeBonus({ orgId: 'org1', customerId: 'a', storeId: 'store1' });
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 1, lineTotal: 30 }],
      txId: 't1', txNumber: 'TXN-1', loyaltyPointsRedeemed: 10,
    });
    const h = getCustomer('a').pointsHistory;
    for (const e of h) {
      assert.ok(e.date,                       `entry missing date: ${e.reason}`);
      assert.equal(typeof e.delta,   'number', `entry missing delta: ${e.reason}`);
      assert.equal(typeof e.balance, 'number', `entry missing balance: ${e.reason}`);
      assert.ok(e.reason,                     'entry missing reason');
    }
  });

  test('7.2 — Final balance == seed + sum of deltas (sanity invariant)', async () => {
    setProgram('store1');
    addCustomer({ id: 'a', loyaltyPoints: 200 });
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 1, lineTotal: 50 }],
      txId: 't1', txNumber: 'TXN-1', loyaltyPointsRedeemed: 100,
    });
    const c = getCustomer('a');
    const sumDeltas = c.pointsHistory.reduce((s, h) => s + h.delta, 0);
    assert.equal(c.loyaltyPoints, 200 + sumDeltas);
  });

  test('7.3 — Each tx writes earn AND redeem as SEPARATE entries when both apply', async () => {
    setProgram('store1');
    addCustomer({ id: 'a', loyaltyPoints: 600 });
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 1, lineTotal: 10 }],
      txId: 't1', txNumber: 'TXN-1', loyaltyPointsRedeemed: 500,
    });
    const reasons = getCustomer('a').pointsHistory.map(h => h.reason).sort();
    assert.deepEqual(reasons, ['earn', 'redeem']);
  });

  test('7.4 — pointsHistory is chronological (each entry timestamp >= previous)', async () => {
    setProgram('store1');
    addCustomer({ id: 'a', loyaltyPoints: 0 });
    for (let i = 0; i < 3; i++) {
      await loyalty.processTransactionPoints({
        orgId: 'org1', storeId: 'store1', customerId: 'a',
        lineItems: [{ qty: 1, lineTotal: 5 }],
        txId: `t${i}`, txNumber: `TXN-${i}`,
      });
      // Force a tiny gap so ISO timestamps differ
      await new Promise(r => setTimeout(r, 5));
    }
    const dates = getCustomer('a').pointsHistory.map(h => new Date(h.date).getTime());
    for (let i = 1; i < dates.length; i++) {
      assert.ok(dates[i] >= dates[i - 1], `entry ${i} out of order`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8 — Void reverses points
// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 8 — Void reverses points', () => {
  beforeEach(reset);

  test('8.1 — Void of an earn-only tx subtracts the earned points', async () => {
    setProgram('store1');
    addCustomer({ id: 'a', loyaltyPoints: 0 });
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 1, lineTotal: 25 }],
      txId: 'tx-void', txNumber: 'TXN-void',
    });
    assert.equal(getCustomer('a').loyaltyPoints, 25);

    await loyalty.reverseTransactionPoints({
      originalTx: { id: 'tx-void', txNumber: 'TXN-void', orgId: 'org1' },
      reason: 'void_reverse',
    });
    assert.equal(getCustomer('a').loyaltyPoints, 0);
  });

  test('8.2 — Void of a tx with both earn+redeem reverses both correctly', async () => {
    setProgram('store1');
    addCustomer({ id: 'a', loyaltyPoints: 600 });
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 1, lineTotal: 10 }],
      txId: 'tx-void2', txNumber: 'TXN-void2',
      loyaltyPointsRedeemed: 500,
    });
    // 600 + 10 − 500 = 110
    assert.equal(getCustomer('a').loyaltyPoints, 110);

    await loyalty.reverseTransactionPoints({
      originalTx: { id: 'tx-void2', orgId: 'org1' },
      reason: 'void_reverse',
    });
    // Reverse: −10 + 500 = +490 → 110 + 490 = 600 (restored)
    assert.equal(getCustomer('a').loyaltyPoints, 600);
  });

  test('8.3 — Double-void is idempotent (no double-deduction)', async () => {
    setProgram('store1');
    addCustomer({ id: 'a', loyaltyPoints: 0 });
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 1, lineTotal: 50 }],
      txId: 't-dbl', txNumber: 'TXN-dbl',
    });
    await loyalty.reverseTransactionPoints({
      originalTx: { id: 't-dbl', orgId: 'org1' }, reason: 'void_reverse',
    });
    const balanceAfterFirst = getCustomer('a').loyaltyPoints;
    const historyLen        = getCustomer('a').pointsHistory.length;

    await loyalty.reverseTransactionPoints({
      originalTx: { id: 't-dbl', orgId: 'org1' }, reason: 'void_reverse',
    });
    assert.equal(getCustomer('a').loyaltyPoints, balanceAfterFirst);
    assert.equal(getCustomer('a').pointsHistory.length, historyLen);
  });

  test('8.4 — Void of a tx with no attached customer = no-op (no error)', async () => {
    setProgram('store1');
    await loyalty.reverseTransactionPoints({
      originalTx: { id: 'orphan-tx', orgId: 'org1' }, reason: 'void_reverse',
    });
    // Should not throw
    assert.equal(state.customers.size, 0);
  });

  test('8.5 — Void records void_reverse history entry with negative delta + meta', async () => {
    setProgram('store1');
    addCustomer({ id: 'a', loyaltyPoints: 0 });
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 1, lineTotal: 30 }],
      txId: 't', txNumber: 'TXN',
    });
    await loyalty.reverseTransactionPoints({
      originalTx: { id: 't', orgId: 'org1' }, reason: 'void_reverse',
    });
    const last = getCustomer('a').pointsHistory.at(-1);
    assert.equal(last.reason, 'void_reverse');
    assert.equal(last.delta, -30);
    assert.equal(last.balance, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9 — Refund reverses points + charge balance
// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 9 — Refund reverses points + charge', () => {
  beforeEach(reset);

  test('9.1 — Refund subtracts earned points (refund_reverse entry)', async () => {
    setProgram('store1');
    addCustomer({ id: 'a', loyaltyPoints: 0 });
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 1, lineTotal: 40 }],
      txId: 'tx-r', txNumber: 'TXN-r',
    });
    await loyalty.reverseTransactionPoints({
      originalTx: { id: 'tx-r', orgId: 'org1' }, reason: 'refund_reverse',
    });
    assert.equal(getCustomer('a').loyaltyPoints, 0);
    assert.equal(getCustomer('a').pointsHistory.at(-1).reason, 'refund_reverse');
  });

  test('9.2 — Refund of a charge sale credits the customer balance back', async () => {
    setProgram('store1');
    addCustomer({
      id: 'a', loyaltyPoints: 0, balance: 50,
      balanceLimit: 100, instoreChargeEnabled: true,
    });
    // Earn entry tags this tx so refundChargeOnTx can locate the customer
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 1, lineTotal: 30 }],
      txId: 'tx-charged', txNumber: 'TXN-charged',
    });
    const r = await charge.refundChargeOnTx({
      orgId: 'org1', originalTx: { id: 'tx-charged' }, chargeAmount: 30,
    });
    assert.equal(r.ok, true);
    assert.equal(getCustomer('a').balance, 20); // 50 − 30
  });

  test('9.3 — Refund + charge refund: BOTH points and balance reverse together', async () => {
    setProgram('store1');
    addCustomer({
      id: 'a', loyaltyPoints: 0, balance: 0,
      balanceLimit: 100, instoreChargeEnabled: true,
    });
    // 1) Apply charge tender
    await charge.applyChargeTender({
      orgId: 'org1', customerId: 'a', chargeAmount: 45,
    });
    // 2) Award points for the same tx
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 1, lineTotal: 45 }],
      txId: 'tx-combo', txNumber: 'TXN-combo',
    });
    assert.equal(getCustomer('a').balance, 45);
    assert.equal(getCustomer('a').loyaltyPoints, 45);

    // 3) Refund: both balance + points roll back
    await loyalty.reverseTransactionPoints({
      originalTx: { id: 'tx-combo', orgId: 'org1' }, reason: 'refund_reverse',
    });
    await charge.refundChargeOnTx({
      orgId: 'org1', originalTx: { id: 'tx-combo' }, chargeAmount: 45,
    });
    assert.equal(getCustomer('a').balance, 0);
    assert.equal(getCustomer('a').loyaltyPoints, 0);
  });

  test('9.4 — refundChargeOnTx with no matching customer = ok:false reason:customer_not_found', async () => {
    addCustomer({
      id: 'a', balance: 0, balanceLimit: 100, instoreChargeEnabled: true,
      pointsHistory: [],
    });
    const r = await charge.refundChargeOnTx({
      orgId: 'org1', originalTx: { id: 'unknown-tx' }, chargeAmount: 10,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'customer_not_found');
  });

  test('9.5 — Refund a tx with both earn+redeem inverts both correctly', async () => {
    setProgram('store1');
    addCustomer({ id: 'a', loyaltyPoints: 700 });
    await loyalty.processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'a',
      lineItems: [{ qty: 1, lineTotal: 25 }],
      txId: 'tx', txNumber: 'TXN',
      loyaltyPointsRedeemed: 200,
    });
    // 700 + 25 − 200 = 525
    assert.equal(getCustomer('a').loyaltyPoints, 525);

    await loyalty.reverseTransactionPoints({
      originalTx: { id: 'tx', orgId: 'org1' }, reason: 'refund_reverse',
    });
    // Reverse: −25 + 200 = +175 → 525 + 175 = 700 (back to seed)
    assert.equal(getCustomer('a').loyaltyPoints, 700);
  });
});
