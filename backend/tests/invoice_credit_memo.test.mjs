// Phase 3c — Credit-memo invoice math + validation invariants.
//
// The controller logic that parses invoiceType is straightforward, so we
// just lock the math + type-validation rules here. The live smoke test
// (create a credit memo via the admin UI) covers the end-to-end flow.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Invoice type validation', () => {
  const valid = ['purchase', 'credit_memo'];

  test('purchase and credit_memo are the only allowed types', () => {
    assert.equal(valid.length, 2);
    assert.ok(valid.includes('purchase'));
    assert.ok(valid.includes('credit_memo'));
  });

  test('default invoiceType when client omits the field is "purchase"', () => {
    // Mirrors the default in schema.prisma @default("purchase")
    const incoming = undefined;
    const existing = undefined;
    const resolved = (incoming || existing || 'purchase').toString().toLowerCase();
    assert.equal(resolved, 'purchase');
  });

  test('existing type wins over default when client omits', () => {
    const incoming = undefined;
    const existing = 'credit_memo';
    const resolved = (incoming || existing || 'purchase').toString().toLowerCase();
    assert.equal(resolved, 'credit_memo');
  });

  test('client override wins over existing type', () => {
    const incoming = 'purchase';
    const existing = 'credit_memo';
    const resolved = (incoming || existing || 'purchase').toString().toLowerCase();
    assert.equal(resolved, 'purchase');
  });

  test('invalid type string is rejected (guards P&L math)', () => {
    const incoming = 'return'; // typo / wrong value
    const resolved = incoming.toString().toLowerCase();
    assert.equal(valid.includes(resolved), false);
  });

  test('case-insensitive: "CREDIT_MEMO" normalises to credit_memo', () => {
    const resolved = 'CREDIT_MEMO'.toLowerCase();
    assert.equal(resolved, 'credit_memo');
  });
});

describe('linkedInvoiceId discipline', () => {
  test('credit memo may carry a linkedInvoiceId (traceability)', () => {
    const type = 'credit_memo';
    const linked = type === 'credit_memo' ? 'inv-12345' : null;
    assert.equal(linked, 'inv-12345');
  });

  test('purchase invoice ALWAYS drops linkedInvoiceId (kept null)', () => {
    const type = 'purchase';
    const incoming = 'should-be-ignored';
    const linked = type === 'credit_memo' ? incoming : null;
    assert.equal(linked, null);
  });

  test('credit memo without linkedInvoiceId is legal (standalone rebate)', () => {
    const type = 'credit_memo';
    const linked = type === 'credit_memo' ? (null || null) : null;
    assert.equal(linked, null);
  });
});

describe('Inventory side-effect guard', () => {
  test('credit memo never triggers PO-receive (no inventory movement)', () => {
    const type = 'credit_memo';
    const clientWantsPO = true;
    const linkedPO = 'po-789';
    // Mirrors the guard in confirmInvoice: skip if credit, even if client tried
    const shouldReceive = type !== 'credit_memo' && clientWantsPO && !!linkedPO;
    assert.equal(shouldReceive, false);
  });

  test('purchase invoice with PO match receives normally', () => {
    const type = 'purchase';
    const clientWantsPO = true;
    const linkedPO = 'po-789';
    const shouldReceive = type !== 'credit_memo' && clientWantsPO && !!linkedPO;
    assert.equal(shouldReceive, true);
  });

  test('purchase invoice with PO match but client opts out does NOT receive', () => {
    const type = 'purchase';
    const clientWantsPO = false;
    const linkedPO = 'po-789';
    const shouldReceive = type !== 'credit_memo' && clientWantsPO && !!linkedPO;
    assert.equal(shouldReceive, false);
  });
});

describe('Vendor P&L math — net cost formula', () => {
  // The endpoint sums each invoiceType separately, then computes
  //   netCost = purchases.total − credits.total.

  function netCost(purchases, credits) {
    return Math.round((purchases - credits) * 100) / 100;
  }

  test('Pure purchases, no credits → netCost = purchases', () => {
    assert.equal(netCost(12000, 0), 12000);
  });

  test('Standard rebate case: $12k purchases, $500 rebate → $11,500', () => {
    assert.equal(netCost(12000, 500), 11500);
  });

  test('Multiple credits sum correctly: $10k purchases, 3 credits $100+$200+$50 → $9,650', () => {
    const creditsTotal = 100 + 200 + 50;
    assert.equal(netCost(10000, creditsTotal), 9650);
  });

  test('Negative netCost edge case: credit exceeds purchase window', () => {
    // Unusual but valid — a big rebate landed in this window while the
    // purchase it applied to was earlier. Still reported transparently.
    assert.equal(netCost(500, 1000), -500);
  });

  test('Floating point: .84 + .85 handled by round-to-cent', () => {
    assert.equal(netCost(12.84, 0.85), 11.99);
  });

  test('Both zero → 0', () => {
    assert.equal(netCost(0, 0), 0);
  });
});

describe('Bucket allocation invariants', () => {
  function bucketInvoice(type, amount) {
    if (type === 'credit_memo') return { purchasesDelta: 0, creditsDelta: amount };
    return { purchasesDelta: amount, creditsDelta: 0 };
  }

  test('credit memo row adds to credits, never to purchases', () => {
    const r = bucketInvoice('credit_memo', 500);
    assert.equal(r.purchasesDelta, 0);
    assert.equal(r.creditsDelta, 500);
  });

  test('purchase row adds to purchases, never to credits', () => {
    const r = bucketInvoice('purchase', 12000);
    assert.equal(r.purchasesDelta, 12000);
    assert.equal(r.creditsDelta, 0);
  });
});
