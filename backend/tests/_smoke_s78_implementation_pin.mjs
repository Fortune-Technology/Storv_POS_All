/**
 * S78 — Implementation Engineer PIN — pure-function smoke.
 *
 * Verifies the contract WITHOUT requiring a running backend:
 *   1. PIN format validator (6-digit numeric, strict)
 *   2. Prefix mappers — `mostRecentMondayUTC` → correct Monday boundary
 *      across the full week + DST-irrelevant (UTC clock)
 *   3. Constant-time-comparable PIN logic (matches the actual service)
 *
 * Mirror this exactly when changing the engine. If tests start failing
 * after a service-level change, it means either:
 *   (a) the service broke the contract — fix the service, or
 *   (b) the contract changed intentionally — update this test to match.
 */

let pass = 0, fail = 0;
const log = (label, ok, detail = '') => {
  const sym = ok ? '✓' : '✗';
  console.log(`  ${sym} ${label}${detail ? '  — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

console.log('=== S78 IMPLEMENTATION ENGINEER PIN — PURE-FUNCTION SMOKE ===\n');

// ── Mirror of validatePinFormat ─────────────────────────────────────
const PIN_LENGTH = 6;
function validatePinFormat(input) {
  if (typeof input !== 'string') return false;
  if (input.length !== PIN_LENGTH) return false;
  return /^[0-9]+$/.test(input);
}

// ── Mirror of mostRecentMondayUTC ────────────────────────────────────
function mostRecentMondayUTC(now) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

// ── Mirror of pinsEqual constant-time compare ────────────────────────
import crypto from 'crypto';
function pinsEqual(a, b) {
  const aBuf = Buffer.from(a.padEnd(PIN_LENGTH, '\0'));
  const bBuf = Buffer.from(b.padEnd(PIN_LENGTH, '\0'));
  if (aBuf.length !== bBuf.length) return false;
  try {
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

// ── Mirror of prefix mappers (cashEvent uses the same pattern) ───────
function prefixForCashDropTypeMirror(type) {
  return type === 'paid_in' ? 'CI' : 'CD';
}

// ── 1. PIN format validation ─────────────────────────────────────────
console.log('[1] PIN format validation');
{
  log('valid 6-digit numeric',     validatePinFormat('123456') === true);
  log('valid leading zero',         validatePinFormat('000001') === true);
  log('valid all zeros',            validatePinFormat('000000') === true);
  log('valid all nines',            validatePinFormat('999999') === true);

  log('reject 5 digits',            validatePinFormat('12345') === false);
  log('reject 7 digits',            validatePinFormat('1234567') === false);
  log('reject 4 digits',            validatePinFormat('1234') === false);
  log('reject empty',               validatePinFormat('') === false);
  log('reject whitespace',          validatePinFormat('123 56') === false);
  log('reject letters',             validatePinFormat('1234ab') === false);
  log('reject all letters',         validatePinFormat('abcdef') === false);
  log('reject special chars',       validatePinFormat('12-456') === false);

  log('reject null',                validatePinFormat(null) === false);
  log('reject undefined',           validatePinFormat(undefined) === false);
  log('reject number type',         validatePinFormat(123456) === false);
  log('reject object',              validatePinFormat({pin: '123456'}) === false);
}

// ── 2. mostRecentMondayUTC — boundary correctness ────────────────────
console.log('\n[2] mostRecentMondayUTC — Monday boundary');
{
  // Monday 2026-05-04 00:00 UTC → returns itself
  const monday0 = new Date('2026-05-04T00:00:00.000Z');
  const r1 = mostRecentMondayUTC(monday0);
  log('Monday 00:00 → returns itself', r1.toISOString() === monday0.toISOString());

  // Monday 2026-05-04 14:32 UTC → returns Monday 00:00
  const r2 = mostRecentMondayUTC(new Date('2026-05-04T14:32:00.000Z'));
  log('Monday 14:32 → returns Monday 00:00', r2.toISOString() === '2026-05-04T00:00:00.000Z');

  // Tuesday 2026-05-05 → returns previous Monday 2026-05-04
  const r3 = mostRecentMondayUTC(new Date('2026-05-05T08:00:00.000Z'));
  log('Tuesday → previous Monday', r3.toISOString() === '2026-05-04T00:00:00.000Z');

  // Sunday 2026-05-10 → returns Monday 2026-05-04 (6 days back)
  const r4 = mostRecentMondayUTC(new Date('2026-05-10T23:59:00.000Z'));
  log('Sunday → most-recent Monday (6 days back)', r4.toISOString() === '2026-05-04T00:00:00.000Z');

  // Sunday 2026-05-10 23:59:59.999 — edge case, last second before next Monday
  const r5 = mostRecentMondayUTC(new Date('2026-05-10T23:59:59.999Z'));
  log('Sunday last second → previous Monday', r5.toISOString() === '2026-05-04T00:00:00.000Z');

  // Monday 2026-05-11 00:00 — flip to next Monday
  const r6 = mostRecentMondayUTC(new Date('2026-05-11T00:00:00.000Z'));
  log('Next Monday 00:00 → flips to next Monday', r6.toISOString() === '2026-05-11T00:00:00.000Z');

  // Saturday → 5 days back
  const r7 = mostRecentMondayUTC(new Date('2026-05-09T12:00:00.000Z'));
  log('Saturday → 5 days back to Monday', r7.toISOString() === '2026-05-04T00:00:00.000Z');

  // 7-day cycle is exactly 7 days
  const a = mostRecentMondayUTC(new Date('2026-05-04T00:00:00.000Z'));
  const b = mostRecentMondayUTC(new Date('2026-05-11T00:00:00.000Z'));
  const diffDays = (b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000);
  log('Consecutive Monday boundaries are 7 days apart', diffDays === 7);
}

// ── 3. Constant-time PIN comparison ──────────────────────────────────
console.log('\n[3] Constant-time PIN comparison');
{
  log('identical PINs match',       pinsEqual('123456', '123456') === true);
  log('different last digit fails', pinsEqual('123456', '123457') === false);
  log('different first digit fails', pinsEqual('123456', '023456') === false);
  log('different length pads same', pinsEqual('12345', '012345') === false);  // length-mismatch when padded
  log('all zeros',                  pinsEqual('000000', '000000') === true);
  log('zero-vs-different',          pinsEqual('000000', '000001') === false);

  // Edge cases: empty / null inputs
  // Service-layer validate-format check rejects these BEFORE pinsEqual runs,
  // but pinsEqual itself should still not throw.
  log('empty vs valid does not throw', (() => {
    try { pinsEqual('', '123456'); return true; } catch { return false; }
  })());
}

// ── 4. PIN generation distribution (sanity) ───────────────────────────
console.log('\n[4] PIN generation distribution sanity');
{
  function generatePin() {
    const n = crypto.randomInt(0, 1000000);
    return String(n).padStart(PIN_LENGTH, '0');
  }
  const sample = Array.from({ length: 1000 }, () => generatePin());

  log('all PINs are 6 digits',              sample.every(p => p.length === 6));
  log('all PINs are numeric',               sample.every(p => /^\d{6}$/.test(p)));
  log('not all the same (entropy check)',   new Set(sample).size > 950);

  // Roughly uniform: each first-digit bucket gets ~10% of samples
  const buckets = Array(10).fill(0);
  for (const p of sample) buckets[Number(p[0])]++;
  const minBucket = Math.min(...buckets);
  const maxBucket = Math.max(...buckets);
  log(`first-digit distribution roughly uniform (min ${minBucket}, max ${maxBucket})`,
    minBucket >= 60 && maxBucket <= 150,
    `1000 samples / 10 buckets = expect ~100 each ± reasonable variance`,
  );
}

// ── 5. Prefix mapper consistency check (parity with cashEvent) ───────
console.log('\n[5] Prefix mapper sanity (mirrors cashEvent pattern)');
{
  log('CD/CI mapper (parity with C9 helper)',
    prefixForCashDropTypeMirror('drop')    === 'CD' &&
    prefixForCashDropTypeMirror('paid_in') === 'CI');
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`✓ pass: ${pass}`);
console.log(`✗ fail: ${fail}`);
console.log(`total:  ${pass + fail}`);

process.exit(fail > 0 ? 1 : 0);
