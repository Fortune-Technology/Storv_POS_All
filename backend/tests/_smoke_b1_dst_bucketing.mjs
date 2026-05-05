// @ts-nocheck
/**
 * B1 DST + non-UTC timezone follow-up — pure-function smoke for
 * `dateTz.ts` helpers across DST boundaries.
 *
 * Background: Session 59 (B9) introduced timezone-aware day-boundary
 * helpers for the lottery report. Session 60 verified UTC-midnight
 * crossing for `/sales/daily` but didn't exercise DST transitions.
 * This smoke covers the missing cases:
 *   - Spring-forward day (23-hour local day; e.g. America/New_York Mar 9 2025)
 *   - Fall-back day (25-hour local day; e.g. America/New_York Nov 2 2025)
 *   - Days adjacent to a DST transition
 *   - Multiple non-UTC timezones (Eastern, Central, Pacific)
 *
 * Failure modes this catches:
 *   - `localDayEndUTC` returning the wrong instant on DST days. Old impl
 *     was `start + 24h - 1ms`, which is wrong on 23h/25h days.
 *   - `localDayStartUTC` failing to resample DST offset.
 *   - `formatLocalDate` returning the wrong calendar date for an instant
 *     near the DST boundary.
 *
 * No DB, no HTTP — pure import + assert. Runs in ~50ms.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatLocalDate,
  localDayStartUTC,
  localDayEndUTC,
  addOneDay,
} from '../src/utils/dateTz.ts';

// ─── Reference offsets (verified manually via Intl) ────────────────────
//
// America/New_York:
//   Standard  (EST) = UTC-5 (Nov 2025 → Mar 2026)
//   Daylight  (EDT) = UTC-4 (Mar 2025 → Nov 2025)
//
// 2025 DST transitions:
//   Spring-forward: Sun Mar  9 2025 02:00 EST → 03:00 EDT (EST → EDT)
//   Fall-back:      Sun Nov  2 2025 02:00 EDT → 01:00 EST (EDT → EST)
//
// 2026 DST transitions:
//   Spring-forward: Sun Mar  8 2026 02:00 EST → 03:00 EDT
//   Fall-back:      Sun Nov  1 2026 02:00 EDT → 01:00 EST
// ─────────────────────────────────────────────────────────────────────────

const NY = 'America/New_York';
const CT = 'America/Chicago';
const PT = 'America/Los_Angeles';
const UTC = 'UTC';

// ─────────────────────────────────────────────────────────────────────────
// 1. localDayStartUTC — resample DST offset per date
// ─────────────────────────────────────────────────────────────────────────
test('B1.1 localDayStartUTC: standard EST day (Mar 8 2025) returns 05:00 UTC', () => {
  const d = localDayStartUTC('2025-03-08', NY);
  assert.equal(d.toISOString(), '2025-03-08T05:00:00.000Z');
});

test('B1.2 localDayStartUTC: spring-forward day (Mar 9 2025) starts in EST = 05:00 UTC', () => {
  // Mar 9 starts at 00:00 EST (still EST until 02:00). Midnight = 05:00 UTC.
  const d = localDayStartUTC('2025-03-09', NY);
  assert.equal(d.toISOString(), '2025-03-09T05:00:00.000Z');
});

test('B1.3 localDayStartUTC: day after spring-forward (Mar 10 2025) starts in EDT = 04:00 UTC', () => {
  const d = localDayStartUTC('2025-03-10', NY);
  assert.equal(d.toISOString(), '2025-03-10T04:00:00.000Z');
});

test('B1.4 localDayStartUTC: standard EDT day (Apr 1 2025) returns 04:00 UTC', () => {
  const d = localDayStartUTC('2025-04-01', NY);
  assert.equal(d.toISOString(), '2025-04-01T04:00:00.000Z');
});

test('B1.5 localDayStartUTC: fall-back day (Nov 2 2025) starts in EDT = 04:00 UTC', () => {
  // Nov 2 starts at 00:00 EDT (still EDT until 02:00). Midnight = 04:00 UTC.
  const d = localDayStartUTC('2025-11-02', NY);
  assert.equal(d.toISOString(), '2025-11-02T04:00:00.000Z');
});

test('B1.6 localDayStartUTC: day after fall-back (Nov 3 2025) starts in EST = 05:00 UTC', () => {
  const d = localDayStartUTC('2025-11-03', NY);
  assert.equal(d.toISOString(), '2025-11-03T05:00:00.000Z');
});

// ─────────────────────────────────────────────────────────────────────────
// 2. localDayEndUTC — DST-aware (the bug this commit fixes)
// ─────────────────────────────────────────────────────────────────────────
test('B1.7 localDayEndUTC: standard EST day (Mar 8 2025) ends just before next midnight = 04:59:59.999 UTC Mar 9', () => {
  // Mar 8 starts 05:00 UTC. Mar 9 starts 05:00 UTC (still EST). Δ = 24h.
  // End = next-start - 1ms = 04:59:59.999 UTC Mar 9.
  const d = localDayEndUTC('2025-03-08', NY);
  assert.equal(d.toISOString(), '2025-03-09T04:59:59.999Z');
});

test('B1.8 localDayEndUTC: spring-forward day (Mar 9 2025) is 23 HOURS LONG, ends 03:59:59.999 UTC Mar 10', () => {
  // Mar 9 starts 05:00 UTC. Mar 10 starts 04:00 UTC (now EDT). Δ = 23h.
  // End = 04:00 UTC Mar 10 - 1ms = 03:59:59.999 UTC Mar 10.
  // BUG before fix: would return 04:59:59.999 UTC Mar 10 (= start + 24h - 1ms),
  //   over-including 1 hour of Mar 10's local time.
  const d = localDayEndUTC('2025-03-09', NY);
  assert.equal(d.toISOString(), '2025-03-10T03:59:59.999Z');
  // Total day length = 23h (in milliseconds: 23 * 3600 * 1000 - 1 = 82,799,999)
  const start = localDayStartUTC('2025-03-09', NY);
  assert.equal(d.getTime() - start.getTime(), 23 * 3600 * 1000 - 1);
});

test('B1.9 localDayEndUTC: fall-back day (Nov 2 2025) is 25 HOURS LONG, ends 04:59:59.999 UTC Nov 3', () => {
  // Nov 2 starts 04:00 UTC (EDT). Nov 3 starts 05:00 UTC (now EST). Δ = 25h.
  // End = 05:00 UTC Nov 3 - 1ms = 04:59:59.999 UTC Nov 3.
  // BUG before fix: would return 03:59:59.999 UTC Nov 3 (= start + 24h - 1ms),
  //   missing the last hour of Nov 2's local time.
  const d = localDayEndUTC('2025-11-02', NY);
  assert.equal(d.toISOString(), '2025-11-03T04:59:59.999Z');
  const start = localDayStartUTC('2025-11-02', NY);
  assert.equal(d.getTime() - start.getTime(), 25 * 3600 * 1000 - 1);
});

test('B1.10 localDayEndUTC: every other 2025 day in NY is exactly 24h - 1ms', () => {
  const sample = ['2025-01-15', '2025-04-01', '2025-06-30', '2025-08-08', '2025-10-15', '2025-12-25'];
  for (const dateStr of sample) {
    const start = localDayStartUTC(dateStr, NY);
    const end   = localDayEndUTC(dateStr, NY);
    assert.equal(end.getTime() - start.getTime(), 24 * 3600 * 1000 - 1, `non-DST day ${dateStr} should be 24h`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 3. formatLocalDate — correct date even at DST boundary instants
// ─────────────────────────────────────────────────────────────────────────
test('B1.11 formatLocalDate: 06:30 UTC Mar 9 2025 = 02:30 EDT (post-jump) = Mar 9 NY', () => {
  // The "spring-forward gap" — between 02:00 and 03:00 EST doesn't exist.
  // 06:30 UTC = pre-EST-to-EDT 01:30 EST OR post-jump 02:30 EDT depending on
  // direction; in 2025 by 06:30 UTC we're already in EDT → 02:30 EDT Mar 9.
  const instant = new Date('2025-03-09T06:30:00.000Z');
  assert.equal(formatLocalDate(instant, NY), '2025-03-09');
});

test('B1.12 formatLocalDate: 03:30 UTC Mar 10 2025 (= 23:30 EDT Mar 9) buckets to Mar 9', () => {
  // Just before next-day-local boundary. EDT now in effect. 23:30 EDT = day still Mar 9.
  const instant = new Date('2025-03-10T03:30:00.000Z');
  assert.equal(formatLocalDate(instant, NY), '2025-03-09');
});

test('B1.13 formatLocalDate: 04:30 UTC Mar 10 2025 (= 00:30 EDT Mar 10) buckets to Mar 10', () => {
  // First half-hour of the day after spring-forward. Should be Mar 10.
  const instant = new Date('2025-03-10T04:30:00.000Z');
  assert.equal(formatLocalDate(instant, NY), '2025-03-10');
});

test('B1.14 formatLocalDate: 05:30 UTC Nov 2 2025 (= 01:30 EDT, the FIRST repeat hour) → Nov 2', () => {
  // Fall-back day: 01:00-02:00 EDT happens, then clock goes back to 01:00 EST.
  // 05:30 UTC = 01:30 EDT (first occurrence on Nov 2).
  const instant = new Date('2025-11-02T05:30:00.000Z');
  assert.equal(formatLocalDate(instant, NY), '2025-11-02');
});

test('B1.15 formatLocalDate: 06:30 UTC Nov 2 2025 (= 01:30 EST, the SECOND repeat hour) → Nov 2', () => {
  // Same wall-clock label as B1.14 but UTC is 1 hour later → EST in effect.
  const instant = new Date('2025-11-02T06:30:00.000Z');
  assert.equal(formatLocalDate(instant, NY), '2025-11-02');
});

test('B1.16 formatLocalDate: 04:30 UTC Nov 3 2025 (= 23:30 EST Nov 2) → Nov 2 (the "extra" hour)', () => {
  // After fall-back, EST is UTC-5. Local 23:30 = 04:30 UTC next day.
  // This is the "extra hour" that exists ONLY on fall-back days.
  // Pre-fix `localDayEndUTC('2025-11-02', NY)` would have RETURNED 03:59 UTC Nov 3,
  //   so a query `tx <= localDayEndUTC` would have MISSED this transaction.
  const instant = new Date('2025-11-03T04:30:00.000Z');
  assert.equal(formatLocalDate(instant, NY), '2025-11-02');
  // ALSO confirm it's covered by the fixed localDayEndUTC.
  const dayEnd = localDayEndUTC('2025-11-02', NY);
  assert.ok(instant.getTime() <= dayEnd.getTime(), 'tx in extra fall-back hour must be ≤ localDayEndUTC');
});

// ─────────────────────────────────────────────────────────────────────────
// 4. Window math: a transaction at every hour of a DST day is covered by
//    exactly ONE day's [start, end] window (no gaps, no overlap)
// ─────────────────────────────────────────────────────────────────────────
test('B1.17 Spring-forward Mar 9 2025: every UTC instant in the local day is inside [start, end]', () => {
  const start = localDayStartUTC('2025-03-09', NY);
  const end   = localDayEndUTC('2025-03-09', NY);
  // Sweep 23 hours' worth of instants
  for (let h = 0; h < 23; h++) {
    const t = new Date(start.getTime() + h * 3600 * 1000 + 30 * 60 * 1000); // mid-hour
    assert.ok(t >= start && t <= end, `Mar 9 hour offset ${h} should be inside [start, end]`);
    assert.equal(formatLocalDate(t, NY), '2025-03-09', `Mar 9 hour offset ${h} should bucket to Mar 9`);
  }
});

test('B1.18 Spring-forward Mar 9: instant 1ms AFTER end is in Mar 10', () => {
  const end = localDayEndUTC('2025-03-09', NY);
  const justAfter = new Date(end.getTime() + 1);
  assert.equal(formatLocalDate(justAfter, NY), '2025-03-10');
});

test('B1.19 Fall-back Nov 2 2025: every UTC instant in the local day is inside [start, end]', () => {
  const start = localDayStartUTC('2025-11-02', NY);
  const end   = localDayEndUTC('2025-11-02', NY);
  // Sweep 25 hours' worth of instants
  for (let h = 0; h < 25; h++) {
    const t = new Date(start.getTime() + h * 3600 * 1000 + 30 * 60 * 1000);
    assert.ok(t >= start && t <= end, `Nov 2 hour offset ${h} should be inside [start, end]`);
    assert.equal(formatLocalDate(t, NY), '2025-11-02', `Nov 2 hour offset ${h} should bucket to Nov 2`);
  }
});

test('B1.20 Fall-back Nov 2: instant 1ms AFTER end is in Nov 3', () => {
  const end = localDayEndUTC('2025-11-02', NY);
  const justAfter = new Date(end.getTime() + 1);
  assert.equal(formatLocalDate(justAfter, NY), '2025-11-03');
});

// ─────────────────────────────────────────────────────────────────────────
// 5. Adjacent days — no overlap, no gap
// ─────────────────────────────────────────────────────────────────────────
test('B1.21 Adjacent days share boundary: localDayEndUTC(d) + 1ms === localDayStartUTC(addOneDay(d))', () => {
  const samples = [
    '2025-03-08', '2025-03-09', '2025-03-10', // around spring-forward
    '2025-11-01', '2025-11-02', '2025-11-03', // around fall-back
    '2025-06-15', // a quiet summer day
  ];
  for (const d of samples) {
    const end       = localDayEndUTC(d, NY);
    const nextStart = localDayStartUTC(addOneDay(d), NY);
    assert.equal(nextStart.getTime() - end.getTime(), 1, `${d} → ${addOneDay(d)} boundary mismatch`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 6. Cross-timezone: same scenarios in Chicago + Los Angeles
// ─────────────────────────────────────────────────────────────────────────
test('B1.22 Chicago spring-forward (Mar 9 2025): 23 hours, ends 04:59:59.999 UTC Mar 10', () => {
  // Chicago: CST (UTC-6) → CDT (UTC-5) on Mar 9 2025.
  // Start: 06:00 UTC. Next day start: 05:00 UTC. Δ = 23h.
  const start = localDayStartUTC('2025-03-09', CT);
  const end   = localDayEndUTC('2025-03-09', CT);
  assert.equal(start.toISOString(), '2025-03-09T06:00:00.000Z');
  assert.equal(end.toISOString(),   '2025-03-10T04:59:59.999Z');
  assert.equal(end.getTime() - start.getTime(), 23 * 3600 * 1000 - 1);
});

test('B1.23 Los Angeles fall-back (Nov 2 2025): 25 hours, ends 07:59:59.999 UTC Nov 3', () => {
  // Los Angeles: PDT (UTC-7) → PST (UTC-8) on Nov 2 2025.
  // Start: 07:00 UTC. Next day start: 08:00 UTC. Δ = 25h.
  const start = localDayStartUTC('2025-11-02', PT);
  const end   = localDayEndUTC('2025-11-02', PT);
  assert.equal(start.toISOString(), '2025-11-02T07:00:00.000Z');
  assert.equal(end.toISOString(),   '2025-11-03T07:59:59.999Z');
  assert.equal(end.getTime() - start.getTime(), 25 * 3600 * 1000 - 1);
});

test('B1.24 UTC tz fast-path: every day is exactly 24h - 1ms (DST never applies)', () => {
  const samples = ['2025-03-09', '2025-11-02', '2025-12-31'];
  for (const d of samples) {
    const start = localDayStartUTC(d, UTC);
    const end   = localDayEndUTC(d, UTC);
    assert.equal(start.toISOString(), `${d}T00:00:00.000Z`);
    assert.equal(end.getTime() - start.getTime(), 24 * 3600 * 1000 - 1);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 7. addOneDay — month/year rollover correctness (used by localDayEndUTC)
// ─────────────────────────────────────────────────────────────────────────
test('B1.25 addOneDay: month rollover (Jan 31 → Feb 1, Feb 28 → Mar 1 non-leap)', () => {
  assert.equal(addOneDay('2025-01-31'), '2025-02-01');
  assert.equal(addOneDay('2025-02-28'), '2025-03-01');
  assert.equal(addOneDay('2025-12-31'), '2026-01-01');
});

test('B1.26 addOneDay: leap-year handling (Feb 28 2024 → Feb 29; Feb 29 → Mar 1)', () => {
  assert.equal(addOneDay('2024-02-28'), '2024-02-29');
  assert.equal(addOneDay('2024-02-29'), '2024-03-01');
});
