// Lottery state-adapter parse tests.
// Pure unit tests — no DB, no prisma. Verifies the barcode regexes against
// the real samples we captured from MA + ME tickets.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import MA from '../src/services/lottery/adapters/MA.js';
import ME from '../src/services/lottery/adapters/ME.js';
import { getAdapter, supportedStates } from '../src/services/lottery/adapters/_registry.js';
import { parseScan } from '../src/services/lottery/engine/scanParser.js';
import { guessPackSize } from '../src/services/lottery/catalogSync.js';

describe('State adapter registry', () => {
  test('exposes MA and ME', () => {
    assert.deepEqual(supportedStates().sort(), ['MA', 'ME']);
  });
  test('getAdapter is case-insensitive', () => {
    assert.equal(getAdapter('ma')?.code, 'MA');
    assert.equal(getAdapter('Me')?.code, 'ME');
  });
  test('getAdapter returns null for unsupported', () => {
    assert.equal(getAdapter('XX'), null);
    assert.equal(getAdapter(null), null);
    assert.equal(getAdapter(''), null);
  });
});

describe('Massachusetts adapter', () => {
  test('parses canonical ticket format GGG-BBBBBB-TTT', () => {
    assert.deepEqual(MA.parseAny('498-027632-128'), {
      type: 'ticket',
      gameNumber: '498',
      bookNumber: '027632',
      ticketNumber: 128,
      state: 'MA',
    });
  });
  test('parses dashless form (scanner stripped dashes)', () => {
    const r = MA.parseAny('498027632128');
    assert.equal(r?.type, 'ticket');
    assert.equal(r?.gameNumber, '498');
    assert.equal(r?.bookNumber, '027632');
    assert.equal(r?.ticketNumber, 128);
  });
  test('parses book-level format GGG-BBBBBB (no ticket)', () => {
    const r = MA.parseAny('498-027632');
    assert.equal(r?.type, 'book');
    assert.equal(r?.state, 'MA');
  });
  test('tolerates whitespace', () => {
    assert.equal(MA.parseAny('  498-027632-128 \n')?.ticketNumber, 128);
  });
  test('rejects obviously wrong format', () => {
    assert.equal(MA.parseAny('hello world'), null);
    assert.equal(MA.parseAny('12-345-678'), null);
    assert.equal(MA.parseAny(''), null);
    assert.equal(MA.parseAny(null), null);
  });
  test('parseTicketBarcode / parseBookBarcode filter by type', () => {
    assert.equal(MA.parseTicketBarcode('498-027632-128')?.type, 'ticket');
    assert.equal(MA.parseTicketBarcode('498-027632'), null);
    assert.equal(MA.parseBookBarcode('498-027632')?.type, 'book');
    assert.equal(MA.parseBookBarcode('498-027632-128'), null);
  });
  test('settlement rules + weekStartDay exposed', () => {
    assert.equal(MA.weekStartDay, 0);
    assert.equal(MA.settlementRules.pctThreshold, 80);
    assert.equal(MA.settlementRules.maxDaysActive, 180);
  });

  describe('QR code payload (29-digit, new 2025+ stock)', () => {
    test('sample #1 — fresh book (ticket 000)', () => {
      const r = MA.parseAny('52900384500001010070000000064');
      assert.equal(r?.type, 'ticket');
      assert.equal(r?.state, 'MA');
      assert.equal(r?.source, 'qr');
      assert.equal(r?.gameNumber, '529');
      assert.equal(r?.bookNumber, '038450');
      assert.equal(r?.ticketNumber, 0);
    });

    test('sample #2 — mid-book (ticket 067)', () => {
      const r = MA.parseAny('51300481550671010070000000073');
      assert.equal(r?.gameNumber, '513');
      assert.equal(r?.bookNumber, '048155');
      assert.equal(r?.ticketNumber, 67);
    });

    test('sample #3 — matches documented adapter sample (498-027632-128)', () => {
      const r = MA.parseAny('49800276321280515060000000088');
      assert.equal(r?.gameNumber, '498');
      assert.equal(r?.bookNumber, '027632');
      assert.equal(r?.ticketNumber, 128);
    });

    test('QR scan agrees with the equivalent canonical scan for the same ticket', () => {
      const fromQr  = MA.parseAny('49800276321280515060000000088');
      const fromDash = MA.parseAny('498-027632-128');
      // Same logical ticket; only the source marker differs
      assert.equal(fromQr?.gameNumber,   fromDash?.gameNumber);
      assert.equal(fromQr?.bookNumber,   fromDash?.bookNumber);
      assert.equal(fromQr?.ticketNumber, fromDash?.ticketNumber);
      assert.equal(fromQr?.source, 'qr');
      assert.equal(fromDash?.source, undefined);
    });

    test('rejects 29-digit strings without the fixed-0 separator at position 3', () => {
      // Swap the '0' separator for a '5' — should fail because the QR regex
      // requires the literal '0' at position 3.
      const bad = '52950384500001010070000000064';
      assert.equal(MA.parseAny(bad), null);
    });

    test('rejects 28-digit (too short) and 30-digit (too long)', () => {
      assert.equal(MA.parseAny('5290038450000101007000000006'), null);
      assert.equal(MA.parseAny('529003845000010100700000000064'), null);
    });

    test('whitespace tolerated before / after QR payload', () => {
      const r = MA.parseAny('  49800276321280515060000000088\n');
      assert.equal(r?.ticketNumber, 128);
    });

    test('parseTicketBarcode accepts the QR form', () => {
      assert.equal(MA.parseTicketBarcode('52900384500001010070000000064')?.type, 'ticket');
    });
  });
});

describe('Maine adapter', () => {
  test('parses canonical ticket format GGG-BBBBBB-C-TTT', () => {
    assert.deepEqual(ME.parseAny('710-015744-8-074'), {
      type: 'ticket',
      gameNumber: '710',
      bookNumber: '015744',
      checkDigit: '8',
      ticketNumber: 74,
      state: 'ME',
    });
  });
  test('parses all three ticket samples from real packs', () => {
    assert.equal(ME.parseAny('667-046569-6-000')?.gameNumber, '667');
    assert.equal(ME.parseAny('717-005166-6-000')?.gameNumber, '717');
    assert.equal(ME.parseAny('710-015744-8-074')?.ticketNumber, 74);
  });
  test('parses UPC-A book-level barcode (12 digits)', () => {
    const r = ME.parseAny('653491507178');
    assert.equal(r?.type, 'book');
    assert.equal(r?.state, 'ME');
    assert.equal(r?.bookCode, '50717');
    assert.equal(r?.checkDigit, '8');
  });
  test('parses EAN-13 representation (13 digits with leading 0)', () => {
    const r = ME.parseAny('0653491507178');
    assert.equal(r?.type, 'book');
    assert.equal(r?.bookCode, '50717');
  });
  test('tolerates embedded spaces in pack code (many scanners add them)', () => {
    const r = ME.parseAny('6 53491 50717 8');
    assert.equal(r?.type, 'book');
    assert.equal(r?.bookCode, '50717');
  });
  test('parses book format GGG-BBBBBB-C (without ticket)', () => {
    const r = ME.parseAny('710-015744-8');
    assert.equal(r?.type, 'book');
    assert.equal(r?.gameNumber, '710');
    assert.equal(r?.bookNumber, '015744');
    assert.equal(r?.checkDigit, '8');
  });
  test('rejects malformed Maine codes', () => {
    assert.equal(ME.parseAny('710-015744'), null);
    assert.equal(ME.parseAny(''), null);
    assert.equal(ME.parseAny('not a barcode'), null);
  });
});

describe('guessPackSize — price-based heuristic (MA feed omits pack size)', () => {
  test('$1 ticket → 300 pack', () => assert.equal(guessPackSize(1), 300));
  test('$2 ticket → 200 pack', () => assert.equal(guessPackSize(2), 200));
  test('$3 ticket → 200 pack', () => assert.equal(guessPackSize(3), 200));
  test('$5 ticket → 100 pack (MA common size)', () => assert.equal(guessPackSize(5), 100));
  test('$10 ticket → 50 pack (MA common size)', () => assert.equal(guessPackSize(10), 50));
  test('$20 ticket → 30 pack', () => assert.equal(guessPackSize(20), 30));
  test('$25 ticket → 20 pack (fallback from >20 bucket)', () => assert.equal(guessPackSize(25), 20));
  test('$30 ticket → 20 pack', () => assert.equal(guessPackSize(30), 20));
  test('$50 ticket → 10 pack', () => assert.equal(guessPackSize(50), 10));
  test('$100 ticket → 10 pack (highest tier)', () => assert.equal(guessPackSize(100), 10));

  test('Price between buckets rounds UP (e.g. $1.50 → 200 pack, not 300)', () => {
    assert.equal(guessPackSize(1.5), 200);
  });
  test('Invalid input (NaN/negative/zero) → safe default 50', () => {
    assert.equal(guessPackSize(NaN),       50);
    assert.equal(guessPackSize(-5),        50);
    assert.equal(guessPackSize(0),         50);
    assert.equal(guessPackSize(null),      50);
    assert.equal(guessPackSize(undefined), 50);
    assert.equal(guessPackSize('banana'),  50);
  });
  test('String price coerces via Number()', () => {
    assert.equal(guessPackSize('5'),  100);
    assert.equal(guessPackSize('10'), 50);
  });
});

describe('parseScan (registry router)', () => {
  test('uses preferred state first', () => {
    const r = parseScan('498-027632-128', 'MA');
    assert.equal(r?.adapter.code, 'MA');
    assert.equal(r?.parsed.ticketNumber, 128);
  });
  test('falls back to other adapters when preferred fails', () => {
    const r = parseScan('710-015744-8-074', 'MA'); // MA can't parse ME format
    assert.equal(r?.adapter.code, 'ME');
    assert.equal(r?.parsed.state, 'ME');
  });
  test('works with no state hint', () => {
    assert.equal(parseScan('498-027632-128')?.adapter.code, 'MA');
    assert.equal(parseScan('710-015744-8-074')?.adapter.code, 'ME');
  });
  test('returns null for unrecognised formats in any adapter', () => {
    assert.equal(parseScan('12345'), null);
    assert.equal(parseScan(''), null);
    assert.equal(parseScan(null), null);
  });
  test('MA ticket codes do NOT accidentally match ME regex', () => {
    const r = parseScan('498-027632-128');
    assert.equal(r?.adapter.code, 'MA');
  });
});
