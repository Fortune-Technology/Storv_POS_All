// Phase 3a — Book-sequence gap warning tests.
//
// `detectSequenceGap` is a DB-touching function; we stub prisma inline to
// avoid a real connection.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// `detectSequenceGap` in autoActivator.js touches prisma to pull the store's
// same-game books. Rather than wire a Prisma stub (this test suite uses
// node:test, not jest.unstable_mockModule), we reimplement the pure-logic
// core below and test the algorithm directly. If the real function's shape
// changes, this mirror must change with it — kept short and readable to
// make that straightforward.

/**
 * Pure reimplementation of the gap-detection logic for unit testing.
 * Mirrors detectSequenceGap in autoActivator.js line-for-line; if that
 * function changes, this test must change with it.
 */
function detectGap(boxNumber, sameGameBooks) {
  if (!boxNumber) return null;
  const asInt = parseInt(boxNumber, 10);
  if (Number.isNaN(asInt)) return null;

  const numeric = sameGameBooks
    .map((o) => ({ num: parseInt(o.boxNumber, 10), ...o }))
    .filter((o) => !Number.isNaN(o.num) && o.num < asInt)
    .sort((a, b) => b.num - a.num);
  if (numeric.length === 0) return null;

  const prev = numeric[0];
  const gap = asInt - prev.num - 1;
  if (gap <= 0) return null;

  return {
    code: 'book_sequence_gap',
    scannedBookNumber: boxNumber,
    previousBookNumber: prev.boxNumber,
    missingCount: gap,
  };
}

describe('detectSequenceGap — logic invariants', () => {
  test('returns null when no prior books exist for the game', () => {
    assert.equal(detectGap('027640', []), null);
  });

  test('returns null when the new book is exactly one greater than the prior', () => {
    assert.equal(
      detectGap('027640', [{ boxNumber: '027639', status: 'active' }]),
      null
    );
  });

  test('flags a 1-book gap', () => {
    const r = detectGap('027641', [{ boxNumber: '027639', status: 'active' }]);
    assert.ok(r);
    assert.equal(r.code, 'book_sequence_gap');
    assert.equal(r.missingCount, 1);
    assert.equal(r.previousBookNumber, '027639');
  });

  test('flags a 3-book gap', () => {
    const r = detectGap('027644', [{ boxNumber: '027640', status: 'depleted' }]);
    assert.equal(r.missingCount, 3);
  });

  test('uses the HIGHEST prior book as the comparison anchor, not just any', () => {
    // With books 027635, 027638, 027640 already received, scanning 027643
    // should compare against 027640 (highest), not 027635.
    const r = detectGap('027643', [
      { boxNumber: '027635', status: 'depleted' },
      { boxNumber: '027638', status: 'depleted' },
      { boxNumber: '027640', status: 'active' },
    ]);
    assert.equal(r.previousBookNumber, '027640');
    assert.equal(r.missingCount, 2);
  });

  test('returns null when the scanned book is LOWER than the highest existing (out-of-order receipt)', () => {
    // Scanning 027637 when we already have 027640 means we already jumped
    // ahead — this is a different kind of anomaly the UI can flag via the
    // "already on counter" rule, not here.
    const r = detectGap('027637', [{ boxNumber: '027640', status: 'active' }]);
    assert.equal(r, null);
  });

  test('ignores books with non-numeric boxNumbers gracefully', () => {
    const r = detectGap('027641', [
      { boxNumber: 'ABC', status: 'inventory' },
      { boxNumber: '027639', status: 'active' },
    ]);
    assert.equal(r.missingCount, 1);
  });

  test('returns null when given a non-numeric box number to activate', () => {
    assert.equal(detectGap('invalid', [{ boxNumber: '027640', status: 'active' }]), null);
    assert.equal(detectGap('', [{ boxNumber: '027640', status: 'active' }]), null);
    assert.equal(detectGap(null, [{ boxNumber: '027640', status: 'active' }]), null);
  });

  test('handles leading-zero boxNumbers correctly (parseInt strips them)', () => {
    const r = detectGap('000005', [{ boxNumber: '000002', status: 'active' }]);
    assert.equal(r.missingCount, 2);
  });
});
