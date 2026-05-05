/**
 * S79e (C10) — Settlement snapshot-coverage indicator smoke.
 *
 * The lottery weekly settlement engine reads `close_day_snapshot` events
 * to compute per-week sales (S44 ticket-math truth). When some/all days
 * in a week lack snapshots, the settlement amount may be incomplete OR
 * fall back to POS-recorded sales. This test pins the contract for the
 * `snapshotCoverage` field and the UI chip's classification:
 *
 *   1. Day-counting math — distinct UTC YYYY-MM-DD across event timestamps
 *   2. Cap at daysInPeriod (window boundaries can produce stray events)
 *   3. Classification dispatch (mirrors SnapshotCoverageChip):
 *       source='pos_fallback'             → amber
 *       coverage=0/N                      → red
 *       coverage<N/2                      → amber (partial — incomplete)
 *       coverage<N (50–99%)               → amber (gentle)
 *       coverage=N                        → green (full week)
 *   4. Edge cases: missing coverage object, empty event list, eligibleBoxIds=0
 */

let pass = 0, fail = 0;
const log = (label, ok, detail = '') => {
  const sym = ok ? '✓' : '✗';
  console.log(`  ${sym} ${label}${detail ? '  — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

console.log('=== S79e (C10) SNAPSHOT-COVERAGE INDICATOR SMOKE ===\n');

// ── Mirror: settlement engine day-key extraction ───────────────────
function dayKeyForEvent(createdAt) {
  const d = new Date(createdAt);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

function countDaysWithSnapshots(events, daysInPeriod = 7) {
  if (!Array.isArray(events) || events.length === 0) return 0;
  const dayKeys = new Set();
  for (const ev of events) dayKeys.add(dayKeyForEvent(ev.createdAt));
  return Math.min(dayKeys.size, daysInPeriod);
}

// ── Mirror: SnapshotCoverageChip classification logic ──────────────
function classifyChip(source, coverage) {
  if (!coverage || typeof coverage.daysWithSnapshots !== 'number') return null;
  const days = coverage.daysWithSnapshots;
  const total = coverage.daysInPeriod > 0 ? coverage.daysInPeriod : 7;
  if (source === 'pos_fallback') {
    return { tone: 'amber', kind: 'pos_fallback' };
  }
  if (days === 0)              return { tone: 'red',   kind: 'no_snapshots' };
  if (days < total / 2)        return { tone: 'amber', kind: 'partial_low' };
  if (days < total)            return { tone: 'amber', kind: 'partial_high' };
  return                              { tone: 'green', kind: 'full' };
}

// ── 1. Day-counting math ────────────────────────────────────────────
console.log('[1] Distinct UTC-day counting');
{
  // 7 events on 7 different days → 7
  const week = ['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08', '2026-05-09', '2026-05-10']
    .map(d => ({ createdAt: new Date(`${d}T14:00:00Z`) }));
  log('7 events on 7 different days → 7', countDaysWithSnapshots(week, 7) === 7);

  // Multiple events on the same day → counted once
  const sameDay = [
    { createdAt: new Date('2026-05-04T08:00:00Z') },
    { createdAt: new Date('2026-05-04T14:30:00Z') },
    { createdAt: new Date('2026-05-04T22:55:00Z') },
  ];
  log('3 events same day → 1 distinct day', countDaysWithSnapshots(sameDay, 7) === 1);

  // 5 days out of 7 (Mon Tue Wed missing Thu missing Fri Sat Sun)
  const partial = ['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-09', '2026-05-10']
    .map(d => ({ createdAt: new Date(`${d}T14:00:00Z`) }));
  log('5 days of 7 → 5', countDaysWithSnapshots(partial, 7) === 5);

  // Empty input → 0
  log('empty events → 0',  countDaysWithSnapshots([], 7) === 0);
  log('null events → 0',   countDaysWithSnapshots(null, 7) === 0);
  log('undefined events → 0', countDaysWithSnapshots(undefined, 7) === 0);

  // Cap at daysInPeriod (defensive — shouldn't happen but if events leak
  // past the window boundary the count clamps).
  const overcount = ['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08', '2026-05-09', '2026-05-10', '2026-05-11', '2026-05-12']
    .map(d => ({ createdAt: new Date(`${d}T14:00:00Z`) }));
  log('9 distinct days capped at daysInPeriod=7', countDaysWithSnapshots(overcount, 7) === 7);

  // 1-day window (e.g. single-day settlement scope)
  const oneDay = [{ createdAt: new Date('2026-05-04T14:00:00Z') }];
  log('single day window → 1', countDaysWithSnapshots(oneDay, 1) === 1);
}

console.log('\n[2] UTC date keying — events near midnight stay on correct day');
{
  // 23:59:59 UTC on May 4 → "2026-5-4"
  // 00:00:00 UTC on May 5 → "2026-5-5"
  const lateNight = [
    { createdAt: new Date('2026-05-04T23:59:59.999Z') },
    { createdAt: new Date('2026-05-05T00:00:00.000Z') },
  ];
  log('two events 1ms apart across UTC midnight → 2 distinct days',
    countDaysWithSnapshots(lateNight, 7) === 2);

  // Same day, different times → 1
  const sameDayDiffTimes = [
    { createdAt: new Date('2026-05-04T00:00:00.001Z') },
    { createdAt: new Date('2026-05-04T11:59:59.999Z') },
    { createdAt: new Date('2026-05-04T23:59:59.998Z') },
  ];
  log('3 events spanning a single UTC day → 1 distinct day',
    countDaysWithSnapshots(sameDayDiffTimes, 7) === 1);
}

// ── 3. Chip classification ──────────────────────────────────────────
console.log('\n[3] Chip classification — full week (7/7)');
{
  const c = classifyChip('snapshot', { daysWithSnapshots: 7, daysInPeriod: 7 });
  log('green tone',  c.tone === 'green');
  log('kind=full',   c.kind === 'full');
}

console.log('\n[4] Chip classification — partial high (4/7, 5/7, 6/7)');
{
  for (const days of [4, 5, 6]) {
    const c = classifyChip('snapshot', { daysWithSnapshots: days, daysInPeriod: 7 });
    log(`${days}/7 → amber partial_high`, c.tone === 'amber' && c.kind === 'partial_high');
  }
}

console.log('\n[5] Chip classification — partial low (1/7, 2/7, 3/7)');
{
  for (const days of [1, 2, 3]) {
    const c = classifyChip('snapshot', { daysWithSnapshots: days, daysInPeriod: 7 });
    log(`${days}/7 → amber partial_low`, c.tone === 'amber' && c.kind === 'partial_low');
  }
}

console.log('\n[6] Chip classification — zero snapshots');
{
  const c = classifyChip('snapshot', { daysWithSnapshots: 0, daysInPeriod: 7 });
  log('0/7 → red no_snapshots', c.tone === 'red' && c.kind === 'no_snapshots');
}

console.log('\n[7] Chip classification — pos_fallback overrides any day count');
{
  // Even if days=7 (impossible because pos_fallback only fires when 0,
  // but defensive), source='pos_fallback' wins.
  const fallback = classifyChip('pos_fallback', { daysWithSnapshots: 0, daysInPeriod: 7 });
  log('pos_fallback → amber pos_fallback',
    fallback.tone === 'amber' && fallback.kind === 'pos_fallback');

  // Empty source signal (legacy 'empty') still runs through day count
  const empty = classifyChip('empty', { daysWithSnapshots: 0, daysInPeriod: 7 });
  log('source=empty → falls through to day-count path (no_snapshots)',
    empty.kind === 'no_snapshots');
}

console.log('\n[8] Chip classification — missing/null coverage hides chip');
{
  log('null coverage → null (chip hides)',           classifyChip('snapshot', null) === null);
  log('undefined coverage → null',                    classifyChip('snapshot', undefined) === null);
  log('empty object coverage → null',                 classifyChip('snapshot', {}) === null);
  log('coverage with non-number days → null',         classifyChip('snapshot', { daysWithSnapshots: 'X', daysInPeriod: 7 }) === null);
  log('source missing entirely → still classifies',   classifyChip(undefined, { daysWithSnapshots: 7, daysInPeriod: 7 })?.kind === 'full');
}

console.log('\n[9] Chip classification — non-week periods (1-day, 30-day)');
{
  // 1-day settlement: 1/1 = full
  log('1/1 → green full',          classifyChip('snapshot', { daysWithSnapshots: 1, daysInPeriod: 1 }).kind === 'full');
  log('0/1 → red no_snapshots',    classifyChip('snapshot', { daysWithSnapshots: 0, daysInPeriod: 1 }).kind === 'no_snapshots');

  // 30-day settlement window
  log('30/30 → green full',        classifyChip('snapshot', { daysWithSnapshots: 30, daysInPeriod: 30 }).kind === 'full');
  log('22/30 → amber partial_high', classifyChip('snapshot', { daysWithSnapshots: 22, daysInPeriod: 30 }).kind === 'partial_high');
  log('14/30 → amber partial_low',  classifyChip('snapshot', { daysWithSnapshots: 14, daysInPeriod: 30 }).kind === 'partial_low');
  log('0/30 → red',                 classifyChip('snapshot', { daysWithSnapshots: 0, daysInPeriod: 30 }).kind === 'no_snapshots');

  // daysInPeriod = 0 (invalid) → safeTotal defaults to 7
  log('daysInPeriod=0 fallbacks safely',
    classifyChip('snapshot', { daysWithSnapshots: 7, daysInPeriod: 0 }).kind === 'full');
}

console.log('\n[10] End-to-end — events → coverage object → chip tone');
{
  // Real-world scenario: cashier ran wizard Mon/Tue/Wed/Sat/Sun = 5 days,
  // missed Thu/Fri. On a 7-day week.
  const events = ['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-09', '2026-05-10']
    .map(d => ({ createdAt: new Date(`${d}T22:00:00Z`) }));
  const days = countDaysWithSnapshots(events, 7);
  const chip = classifyChip('snapshot', { daysWithSnapshots: days, daysInPeriod: 7 });
  log('5 of 7 days → amber partial_high',
    days === 5 && chip.tone === 'amber' && chip.kind === 'partial_high');

  // Quiet week: 0 events → no_snapshots, but pos_fallback may still
  // produce a non-zero settlement amount (cashier rang up tickets without
  // running the wizard). Chip should reflect 'pos_fallback' priority.
  const empty = countDaysWithSnapshots([], 7);
  const chipFallback = classifyChip('pos_fallback', { daysWithSnapshots: empty, daysInPeriod: 7 });
  log('0 events + source=pos_fallback → amber pos_fallback',
    empty === 0 && chipFallback.tone === 'amber' && chipFallback.kind === 'pos_fallback');

  // Quiet week with no signal at all: 0 events + source=empty
  const chipNothing = classifyChip('empty', { daysWithSnapshots: empty, daysInPeriod: 7 });
  log('0 events + source=empty → red no_snapshots',
    chipNothing.tone === 'red' && chipNothing.kind === 'no_snapshots');
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`✓ pass: ${pass}`);
console.log(`✗ fail: ${fail}`);
console.log(`total:  ${pass + fail}`);

process.exit(fail > 0 ? 1 : 0);
