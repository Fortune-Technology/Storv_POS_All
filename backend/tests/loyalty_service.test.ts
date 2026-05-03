// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

/**
 * loyalty_service.test.mjs
 *
 * Pure-logic tests for the loyalty engine. Mocks the Prisma client so we can
 * exercise the earn/reverse/expire/welcome/birthday code paths without a DB.
 *
 * Run: node --test tests/loyalty_service.test.mjs
 */

import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

// ─── In-memory Prisma mock ────────────────────────────────────────────────
const state = {
  programs:  new Map(),  // storeId → program
  earnRules: [],         // [{ storeId, targetType, targetId, action, multiplier, active }]
  customers: new Map(),  // id     → customer row
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
    findFirst: async ({ where: { id, orgId }, select }) => {
      const c = state.customers.get(id);
      if (!c || c.orgId !== orgId) return null;
      return { ...c };
    },
    findMany: async ({ where, select }) => {
      const all = [...state.customers.values()].filter(c => {
        if (where.orgId && c.orgId !== where.orgId) return false;
        if (where.deleted === false && c.deleted) return false;
        if (where.instoreChargeEnabled === true && !c.instoreChargeEnabled) return false;
        if (where.storeId && c.storeId !== where.storeId) return false;
        if (where.loyaltyPoints?.gt != null && (c.loyaltyPoints || 0) <= where.loyaltyPoints.gt) return false;
        return true;
      });
      return all.map(c => ({ ...c }));
    },
    update: async ({ where: { id }, data }) => {
      const c = state.customers.get(id);
      if (!c) throw new Error('not found');
      if (data.loyaltyPoints !== undefined) c.loyaltyPoints = data.loyaltyPoints;
      if (data.pointsHistory !== undefined) c.pointsHistory = data.pointsHistory;
      if (data.balance?.increment != null) c.balance = (c.balance || 0) + data.balance.increment;
      if (data.balance?.decrement != null) c.balance = (c.balance || 0) - data.balance.decrement;
      return { ...c };
    },
  },
};

// Inject our in-memory mock into the service via its testing hook.
const {
  computePointsEarned,
  processTransactionPoints,
  reverseTransactionPoints,
  awardWelcomeBonus,
  awardBirthdayBonus,
  expireCustomerPoints,
  _setPrismaForTests,
} = await import('../src/services/loyaltyService.js');

_setPrismaForTests(prismaMock);

// ─── Helpers ───────────────────────────────────────────────────────────────
function reset() {
  state.programs.clear();
  state.earnRules.length = 0;
  state.customers.clear();
}

function setProgram(storeId, p = {}) {
  state.programs.set(storeId, {
    storeId, enabled: true, pointsPerDollar: 1, redeemPointsPerDollar: 100,
    minPointsToRedeem: 100, welcomeBonus: 0, birthdayBonus: 0, expiryDays: null,
    ...p,
  });
}

function addCustomer(c) {
  const row = {
    id: c.id, orgId: 'org1', storeId: 'store1',
    loyaltyPoints: 0, pointsHistory: [],
    balance: 0, balanceLimit: 0, instoreChargeEnabled: false,
    deleted: false,
    ...c,
  };
  state.customers.set(row.id, row);
  return row;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('computePointsEarned', () => {
  beforeEach(reset);

  test('base accrual: $10 at 1 pt/$1 → 10 points', async () => {
    setProgram('store1', { pointsPerDollar: 1 });
    const pts = await computePointsEarned({
      storeId: 'store1',
      lineItems: [{ qty: 1, lineTotal: 10 }],
    });
    assert.equal(pts, 10);
  });

  test('rounds DOWN — $9.99 at 1 pt/$1 → 9 points', async () => {
    setProgram('store1', { pointsPerDollar: 1 });
    const pts = await computePointsEarned({
      storeId: 'store1',
      lineItems: [{ qty: 1, lineTotal: 9.99 }],
    });
    assert.equal(pts, 9);
  });

  test('disabled program → 0 points', async () => {
    setProgram('store1', { enabled: false });
    const pts = await computePointsEarned({
      storeId: 'store1',
      lineItems: [{ qty: 1, lineTotal: 100 }],
    });
    assert.equal(pts, 0);
  });

  test('excluded department → those items skip', async () => {
    setProgram('store1');
    state.earnRules.push({ storeId: 'store1', targetType: 'department', targetId: '5', action: 'exclude', multiplier: 1, active: true });
    const pts = await computePointsEarned({
      storeId: 'store1',
      lineItems: [
        { qty: 1, lineTotal: 10 },                        // counted
        { qty: 1, lineTotal: 10, departmentId: 5 },       // excluded
      ],
    });
    assert.equal(pts, 10);
  });

  test('department × 2 multiplier doubles those items', async () => {
    setProgram('store1');
    state.earnRules.push({ storeId: 'store1', targetType: 'department', targetId: '7', action: 'multiply', multiplier: 2, active: true });
    const pts = await computePointsEarned({
      storeId: 'store1',
      lineItems: [
        { qty: 1, lineTotal: 5 },                         // 5
        { qty: 1, lineTotal: 5, departmentId: 7 },        // 10
      ],
    });
    assert.equal(pts, 15);
  });

  test('product multiplier in an excluded department → still excluded (dept wins for exclusion)', async () => {
    setProgram('store1');
    state.earnRules.push({ storeId: 'store1', targetType: 'department', targetId: '5', action: 'exclude', multiplier: 1, active: true });
    state.earnRules.push({ storeId: 'store1', targetType: 'product',    targetId: 'p1', action: 'multiply', multiplier: 3, active: true });
    const pts = await computePointsEarned({
      storeId: 'store1',
      lineItems: [
        { qty: 1, lineTotal: 5, departmentId: 5, productId: 'p1' },
      ],
    });
    // Behaviour we ship today: department exclusion is checked before any
    // product multiplier, so a product in an excluded dept earns 0 even if
    // it has its own multiplier rule. The "product precedence" rule only
    // applies WITHIN multipliers (when both a dept × and product × match).
    // If a future product owner wants product-multiply to override
    // dept-exclude, switch the check order in computePointsEarned.
    assert.equal(pts, 0);
  });

  test('product multiplier wins over a smaller department multiplier', async () => {
    setProgram('store1');
    state.earnRules.push({ storeId: 'store1', targetType: 'department', targetId: '5', action: 'multiply', multiplier: 2, active: true });
    state.earnRules.push({ storeId: 'store1', targetType: 'product',    targetId: 'p1', action: 'multiply', multiplier: 3, active: true });
    const pts = await computePointsEarned({
      storeId: 'store1',
      lineItems: [
        { qty: 1, lineTotal: 5, departmentId: 5, productId: 'p1' }, // 5 × 3
      ],
    });
    assert.equal(pts, 15);
  });

  test('lottery / fuel / bottle return / bag-fee / negative lines → ignored', async () => {
    setProgram('store1');
    const pts = await computePointsEarned({
      storeId: 'store1',
      lineItems: [
        { qty: 1, lineTotal: 10 },                  // 10
        { qty: 1, lineTotal: 5, isLottery: true },  // skip
        { qty: 1, lineTotal: 5, isFuel: true },     // skip
        { qty: 1, lineTotal: 5, isBottleReturn: true }, // skip
        { qty: 1, lineTotal: 5, isBagFee: true },   // skip
        { qty: 1, lineTotal: -5 },                  // skip (negative)
        { qty: 0, lineTotal: 5 },                   // skip (zero qty)
      ],
    });
    assert.equal(pts, 10);
  });

  test('fractional pointsPerDollar still floors', async () => {
    setProgram('store1', { pointsPerDollar: 1.5 });
    const pts = await computePointsEarned({
      storeId: 'store1',
      lineItems: [{ qty: 1, lineTotal: 10 }],
    });
    assert.equal(pts, 15);
  });
});

describe('processTransactionPoints', () => {
  beforeEach(reset);

  test('happy path: earn + history entry written', async () => {
    setProgram('store1');
    addCustomer({ id: 'c1', loyaltyPoints: 100 });
    await processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'c1',
      lineItems: [{ qty: 1, lineTotal: 25 }],
      txId: 'tx1', txNumber: 'TXN-1', loyaltyPointsRedeemed: 0,
    });
    const c = state.customers.get('c1');
    assert.equal(c.loyaltyPoints, 125);
    assert.equal(c.pointsHistory.length, 1);
    assert.equal(c.pointsHistory[0].reason, 'earn');
    assert.equal(c.pointsHistory[0].delta, 25);
  });

  test('redeem reduces balance and writes a separate history entry', async () => {
    setProgram('store1');
    addCustomer({ id: 'c1', loyaltyPoints: 600 });
    await processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'c1',
      lineItems: [{ qty: 1, lineTotal: 10 }],
      txId: 'tx1', txNumber: 'TXN-1', loyaltyPointsRedeemed: 500,
    });
    const c = state.customers.get('c1');
    // 600 + 10 (earn) - 500 (redeem) = 110
    assert.equal(c.loyaltyPoints, 110);
    assert.equal(c.pointsHistory.length, 2);
    assert.deepEqual(c.pointsHistory.map(h => h.reason).sort(), ['earn', 'redeem']);
  });

  test('no customer attached → no error, no-op', async () => {
    setProgram('store1');
    await processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: null,
      lineItems: [{ qty: 1, lineTotal: 10 }],
      txId: 'tx1', txNumber: 'TXN-1',
    });
    // Should not throw.
  });

  test('balance never goes negative even if redeemed > earned + balance', async () => {
    setProgram('store1');
    addCustomer({ id: 'c1', loyaltyPoints: 50 });
    await processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'c1',
      lineItems: [{ qty: 1, lineTotal: 10 }],
      txId: 'tx1', txNumber: 'TXN-1', loyaltyPointsRedeemed: 200,
    });
    const c = state.customers.get('c1');
    assert.equal(c.loyaltyPoints, 0);  // clamped
  });
});

describe('reverseTransactionPoints (void / refund)', () => {
  beforeEach(reset);

  test('reverses earn — customer points subtracted', async () => {
    setProgram('store1');
    addCustomer({ id: 'c1', loyaltyPoints: 0 });
    // First, process a tx that earns 25 pts
    await processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'c1',
      lineItems: [{ qty: 1, lineTotal: 25 }],
      txId: 'tx1', txNumber: 'TXN-1', loyaltyPointsRedeemed: 0,
    });
    assert.equal(state.customers.get('c1').loyaltyPoints, 25);

    // Now void the original tx
    await reverseTransactionPoints({
      originalTx: { id: 'tx1', txNumber: 'TXN-1', orgId: 'org1', storeId: 'store1' },
      reason: 'void_reverse',
    });
    const c = state.customers.get('c1');
    assert.equal(c.loyaltyPoints, 0);
    // 3 entries: earn, void_reverse
    assert.equal(c.pointsHistory.length, 2);
    assert.equal(c.pointsHistory[1].reason, 'void_reverse');
    assert.equal(c.pointsHistory[1].delta, -25);
  });

  test('refunds redeemed points back to customer', async () => {
    setProgram('store1');
    addCustomer({ id: 'c1', loyaltyPoints: 600 });
    await processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'c1',
      lineItems: [{ qty: 1, lineTotal: 10 }],
      txId: 'tx1', txNumber: 'TXN-1', loyaltyPointsRedeemed: 500,
    });
    // 600 + 10 - 500 = 110
    assert.equal(state.customers.get('c1').loyaltyPoints, 110);

    await reverseTransactionPoints({
      originalTx: { id: 'tx1', txNumber: 'TXN-1', orgId: 'org1', storeId: 'store1' },
      reason: 'refund_reverse',
    });
    const c = state.customers.get('c1');
    // Reverse: -10 earned + 500 redeemed refunded = +490, so 110 + 490 = 600
    assert.equal(c.loyaltyPoints, 600);
  });

  test('idempotent — calling reverse twice does nothing the second time', async () => {
    setProgram('store1');
    addCustomer({ id: 'c1', loyaltyPoints: 0 });
    await processTransactionPoints({
      orgId: 'org1', storeId: 'store1', customerId: 'c1',
      lineItems: [{ qty: 1, lineTotal: 25 }],
      txId: 'tx1', txNumber: 'TXN-1', loyaltyPointsRedeemed: 0,
    });
    await reverseTransactionPoints({
      originalTx: { id: 'tx1', txNumber: 'TXN-1', orgId: 'org1' },
      reason: 'void_reverse',
    });
    const before = state.customers.get('c1').pointsHistory.length;
    await reverseTransactionPoints({
      originalTx: { id: 'tx1', txNumber: 'TXN-1', orgId: 'org1' },
      reason: 'void_reverse',
    });
    const after = state.customers.get('c1').pointsHistory.length;
    assert.equal(before, after);
  });

  test('no customer attached → no-op', async () => {
    setProgram('store1');
    await reverseTransactionPoints({
      originalTx: { id: 'tx-nope', orgId: 'org1' },
      reason: 'void_reverse',
    });
    // Should not throw.
  });
});

describe('awardWelcomeBonus', () => {
  beforeEach(reset);

  test('awards configured welcome bonus + writes history', async () => {
    setProgram('store1', { welcomeBonus: 50 });
    addCustomer({ id: 'c1', loyaltyPoints: 0 });
    const awarded = await awardWelcomeBonus({ orgId: 'org1', customerId: 'c1', storeId: 'store1' });
    assert.equal(awarded, 50);
    const c = state.customers.get('c1');
    assert.equal(c.loyaltyPoints, 50);
    assert.equal(c.pointsHistory[0].reason, 'welcome_bonus');
  });

  test('returns 0 when welcomeBonus is 0', async () => {
    setProgram('store1', { welcomeBonus: 0 });
    addCustomer({ id: 'c1', loyaltyPoints: 0 });
    const awarded = await awardWelcomeBonus({ orgId: 'org1', customerId: 'c1', storeId: 'store1' });
    assert.equal(awarded, 0);
    assert.equal(state.customers.get('c1').loyaltyPoints, 0);
  });

  test('disabled program → 0', async () => {
    setProgram('store1', { enabled: false, welcomeBonus: 100 });
    addCustomer({ id: 'c1', loyaltyPoints: 0 });
    const awarded = await awardWelcomeBonus({ orgId: 'org1', customerId: 'c1', storeId: 'store1' });
    assert.equal(awarded, 0);
  });
});

describe('awardBirthdayBonus', () => {
  beforeEach(reset);

  test('awards once per year — second call same year is a no-op', async () => {
    setProgram('store1', { birthdayBonus: 25 });
    const customer = addCustomer({ id: 'c1', loyaltyPoints: 0 });
    const a1 = await awardBirthdayBonus({ orgId: 'org1', customer });
    assert.equal(a1, 25);
    const a2 = await awardBirthdayBonus({
      orgId: 'org1',
      customer: state.customers.get('c1'),  // pass updated row
    });
    assert.equal(a2, 0);
    assert.equal(state.customers.get('c1').loyaltyPoints, 25);
  });
});

describe('expireCustomerPoints', () => {
  beforeEach(reset);

  test('expires earned points older than expiryDays cutoff', async () => {
    setProgram('store1');
    const oldDate = new Date(Date.now() - 100 * 86400_000).toISOString();  // 100 days ago
    addCustomer({
      id: 'c1', loyaltyPoints: 50,
      pointsHistory: [
        { date: oldDate, reason: 'earn', delta: 50, balance: 50 },
      ],
    });
    const lapsed = await expireCustomerPoints({
      orgId: 'org1',
      customer: state.customers.get('c1'),
      expiryDays: 90,
    });
    assert.equal(lapsed, 50);
    const c = state.customers.get('c1');
    assert.equal(c.loyaltyPoints, 0);
    // Last entry is the expiry record
    assert.equal(c.pointsHistory[c.pointsHistory.length - 1].reason, 'expired');
  });

  test('does not double-expire — second sweep is a no-op', async () => {
    setProgram('store1');
    const oldDate = new Date(Date.now() - 100 * 86400_000).toISOString();
    addCustomer({
      id: 'c1', loyaltyPoints: 50,
      pointsHistory: [{ date: oldDate, reason: 'earn', delta: 50, balance: 50 }],
    });
    await expireCustomerPoints({ orgId: 'org1', customer: state.customers.get('c1'), expiryDays: 90 });
    const lapsed2 = await expireCustomerPoints({ orgId: 'org1', customer: state.customers.get('c1'), expiryDays: 90 });
    assert.equal(lapsed2, 0);
  });

  test('respects expiryDays=null / 0 → no expiry', async () => {
    setProgram('store1');
    addCustomer({
      id: 'c1', loyaltyPoints: 50,
      pointsHistory: [{ date: new Date(Date.now() - 1000 * 86400_000).toISOString(), reason: 'earn', delta: 50, balance: 50 }],
    });
    const lapsed = await expireCustomerPoints({ orgId: 'org1', customer: state.customers.get('c1'), expiryDays: null });
    assert.equal(lapsed, 0);
  });
});
