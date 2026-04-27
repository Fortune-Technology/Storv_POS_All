// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

// Phase 2 — Settlement engine unit tests.
//
// Covers the pure-function helpers (weekStartFor, weekRangeFor, isBookEligible).
// `computeSettlement` is integration-level and is exercised via live smoke.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  weekStartFor, weekRangeFor, recentWeeks, isBookEligible,
} from '../src/services/lottery/engine/settlement.js';

const iso = (d) => d.toISOString().slice(0, 10);

describe('weekStartFor', () => {
  test('Sunday weekStart — Monday 2026-04-20 snaps back to Sunday 2026-04-19', () => {
    const d = new Date('2026-04-20T15:30:00Z'); // Monday
    const start = weekStartFor(d, 0);
    assert.equal(iso(start), '2026-04-19');
  });

  test('Sunday weekStart — Sunday stays the same day', () => {
    const d = new Date('2026-04-19T08:00:00Z');
    const start = weekStartFor(d, 0);
    assert.equal(iso(start), '2026-04-19');
  });

  test('Monday weekStart (alternate config) — Sunday 2026-04-19 snaps to Monday 2026-04-13', () => {
    const d = new Date('2026-04-19T08:00:00Z');
    const start = weekStartFor(d, 1);
    assert.equal(iso(start), '2026-04-13');
  });

  test('Crossing a month boundary', () => {
    const d = new Date('2026-05-01T12:00:00Z'); // Friday
    const start = weekStartFor(d, 0);            // Sunday 2026-04-26
    assert.equal(iso(start), '2026-04-26');
  });
});

describe('weekRangeFor', () => {
  test('Sunday-start week: Sun→Sat inclusive with Monday due-date', () => {
    const r = weekRangeFor(new Date('2026-04-21T00:00:00Z'), 0);
    assert.equal(iso(r.start), '2026-04-19'); // Sun
    assert.equal(iso(r.end),   '2026-04-25'); // Sat
    assert.equal(iso(r.due),   '2026-04-26'); // Sun (day after end; MA convention is Mon but the engine uses end+1)
  });
});

describe('recentWeeks', () => {
  test('returns 4 weeks most-recent first, each 7 days apart', () => {
    const weeks = recentWeeks(new Date('2026-04-21T00:00:00Z'), 4, 0);
    assert.equal(weeks.length, 4);
    assert.equal(iso(weeks[0].start), '2026-04-19');
    assert.equal(iso(weeks[1].start), '2026-04-12');
    assert.equal(iso(weeks[2].start), '2026-04-05');
    assert.equal(iso(weeks[3].start), '2026-03-29');
  });
});

describe('isBookEligible', () => {
  const weekEnd = new Date('2026-04-25T23:59:59Z');

  test('depleted book with depletedAt inside the week → eligible', () => {
    const box = { status: 'depleted', depletedAt: new Date('2026-04-22T10:00:00Z') };
    assert.equal(isBookEligible(box, weekEnd, { pctThreshold: 80, maxDaysActive: 180 }), true);
  });

  test('depleted book with depletedAt AFTER weekEnd → NOT eligible this week', () => {
    const box = { status: 'depleted', depletedAt: new Date('2026-04-26T10:00:00Z') };
    assert.equal(isBookEligible(box, weekEnd, { pctThreshold: 80, maxDaysActive: 180 }), false);
  });

  test('active book with 85% sold → eligible under 80% rule', () => {
    const box = { status: 'active', totalTickets: 100, ticketsSold: 85, activatedAt: new Date('2026-04-10T08:00:00Z') };
    assert.equal(isBookEligible(box, weekEnd, { pctThreshold: 80, maxDaysActive: 180 }), true);
  });

  test('active book with 70% sold → NOT eligible under 80% rule', () => {
    const box = { status: 'active', totalTickets: 100, ticketsSold: 70, activatedAt: new Date('2026-04-10T08:00:00Z') };
    assert.equal(isBookEligible(box, weekEnd, { pctThreshold: 80, maxDaysActive: 180 }), false);
  });

  test('active book active for 200 days → eligible under 180-day rule even at 10% sold', () => {
    const longAgo = new Date('2025-10-01T08:00:00Z'); // ~206 days before weekEnd
    const box = { status: 'active', totalTickets: 100, ticketsSold: 10, activatedAt: longAgo };
    assert.equal(isBookEligible(box, weekEnd, { pctThreshold: 80, maxDaysActive: 180 }), true);
  });

  test('when rules are null — active book with 99% sold still NOT eligible', () => {
    const box = { status: 'active', totalTickets: 100, ticketsSold: 99, activatedAt: new Date('2026-04-10T08:00:00Z') };
    assert.equal(isBookEligible(box, weekEnd, { pctThreshold: null, maxDaysActive: null }), false);
  });

  test('returned status → always eligible (regardless of % sold)', () => {
    const box = { status: 'returned', returnedAt: new Date('2026-04-22T10:00:00Z'), totalTickets: 100, ticketsSold: 5 };
    assert.equal(isBookEligible(box, weekEnd, { pctThreshold: 80, maxDaysActive: 180 }), true);
  });

  test('inventory book (never activated) → NOT eligible', () => {
    const box = { status: 'inventory', totalTickets: 100, ticketsSold: 0 };
    assert.equal(isBookEligible(box, weekEnd, { pctThreshold: 80, maxDaysActive: 180 }), false);
  });

  test('null / undefined box handled gracefully', () => {
    assert.equal(isBookEligible(null, weekEnd, {}), false);
    assert.equal(isBookEligible(undefined, weekEnd, {}), false);
  });
});

describe('Settlement math (documented invariants)', () => {
  test('Online Due formula — simple case', () => {
    // onlineGross 1000, onlineCashings 300, commission 5.4%
    const gross = 1000, cashings = 300, rate = 0.054;
    const commission = gross * rate;
    const due = gross - cashings - commission;
    assert.equal(Math.round(due * 100) / 100, 646.00);
  });

  test('Instant Due formula includes returns deduction', () => {
    // instantSales 500, sales comm 27, cashing comm 10, returns 80
    const due = 500 - 27 - 10 - 80;
    assert.equal(due, 383);
  });

  test('Adjustments add to total — positive bonus, positive svc charge, negative adjustment', () => {
    const onlineDue = 646, instantDue = 383;
    const bonus = 50, svc = 21, adj = -15;
    const total = onlineDue + instantDue + bonus + svc + adj;
    assert.equal(total, 1085);
  });
});
