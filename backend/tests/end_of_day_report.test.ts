// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

// End-of-Day Report — tests for tender-mapping, payout categorization, and
// reconciliation math. Stubs prisma so no DB is needed.

import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/config/postgres.js', () => ({
  default: {
    shift:        { findFirst: async () => null },
    store:        { findUnique: async () => null },
    user:         { findUnique: async () => null },
    station:      { findUnique: async () => null },
    transaction:  { findMany: async () => [] },
    cashPayout:   { findMany: async () => [] },
    cashDrop:     { findMany: async () => [] },
  },
}));

const svc = await import('../src/controllers/endOfDayReportController.js');

describe('EoD report — tender + payout categorization', () => {

  test('TENDER_CATEGORIES expose 9 categories in the spec order', () => {
    expect(svc.TENDER_CATEGORIES.length).toBe(9);
    expect(svc.TENDER_CATEGORIES.map(c => c.key)).toEqual([
      'cash', 'ebt_cash', 'check', 'debit', 'credit',
      'efs', 'paper_fs', 'house_charge', 'gift_card',
    ]);
  });

  test('PAYOUT_CATEGORIES expose 9 categories in the spec order', () => {
    expect(svc.PAYOUT_CATEGORIES.length).toBe(9);
    expect(svc.PAYOUT_CATEGORIES.map(c => c.key)).toEqual([
      'cashback', 'loans', 'pickups', 'paid_in', 'paid_out',
      'received_on_acct', 'refunds', 'tips', 'voids',
    ]);
  });
});
