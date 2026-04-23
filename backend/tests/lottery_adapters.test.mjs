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
    test('sample #1 — fresh book (ticket 0) + pack 100 from barcode', () => {
      const r = MA.parseAny('52900384500001010070000000064');
      assert.equal(r?.type, 'ticket');
      assert.equal(r?.state, 'MA');
      assert.equal(r?.source, 'qr');
      assert.equal(r?.gameNumber, '529');
      assert.equal(r?.bookNumber, '038450');
      assert.equal(r?.ticketNumber, 0);
      assert.equal(r?.packSize, 100);
    });

    test('sample #2 — mid-book (ticket 67) + pack 100 from barcode', () => {
      const r = MA.parseAny('51300481550671010070000000073');
      assert.equal(r?.gameNumber, '513');
      assert.equal(r?.bookNumber, '048155');
      assert.equal(r?.ticketNumber, 67);
      assert.equal(r?.packSize, 100);
    });

    test('sample #3 — ticket 128 + pack 150 from barcode ($5 150-pack)', () => {
      const r = MA.parseAny('49800276321280515060000000088');
      assert.equal(r?.gameNumber, '498');
      assert.equal(r?.bookNumber, '027632');
      assert.equal(r?.ticketNumber, 128);
      assert.equal(r?.packSize, 150);
    });

    test('sample #4 — book-level sentinel (ticket field = 999) + pack 50', () => {
      const r = MA.parseAny('54200075599993005080000000099');
      assert.equal(r?.type, 'book', 'ticket "999" should be treated as book-level');
      assert.equal(r?.gameNumber, '542');
      assert.equal(r?.bookNumber, '007559');
      assert.equal(r?.packSize, 50);
      assert.equal(r?.ticketNumber, undefined, 'book-level scan has no ticket number');
    });

    test('sample #5 — book-level sentinel + pack 150', () => {
      const r = MA.parseAny('49300260289990115030000000090');
      assert.equal(r?.type, 'book');
      assert.equal(r?.gameNumber, '493');
      assert.equal(r?.bookNumber, '026028');
      assert.equal(r?.packSize, 150);
    });

    test('QR ticket-scan agrees with dashed form on game/book/ticket', () => {
      const fromQr  = MA.parseAny('49800276321280515060000000088');
      const fromDash = MA.parseAny('498-027632-128');
      assert.equal(fromQr?.gameNumber,   fromDash?.gameNumber);
      assert.equal(fromQr?.bookNumber,   fromDash?.bookNumber);
      assert.equal(fromQr?.ticketNumber, fromDash?.ticketNumber);
      assert.equal(fromQr?.source, 'qr');
      assert.equal(fromQr?.packSize, 150, 'QR has authoritative pack size');
      assert.equal(fromDash?.packSize, undefined, 'dashed form has no pack size');
    });

    test('book-level scan exposes packSize (key feature — Receive Books gets pack for free)', () => {
      const r = MA.parseAny('54200075599993005080000000099');
      assert.equal(r?.type, 'book');
      assert.equal(r?.packSize, 50);
    });

    test('rejects 29-digit strings without the fixed-0 separator at position 3', () => {
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
      assert.equal(r?.packSize, 150);
    });

    test('parseTicketBarcode accepts ticket-QR but rejects book-QR', () => {
      assert.equal(MA.parseTicketBarcode('52900384500001010070000000064')?.type, 'ticket');
      assert.equal(MA.parseTicketBarcode('54200075599993005080000000099'), null,
        'book sentinel QR should NOT parse as a ticket barcode');
    });

    test('parseBookBarcode accepts book-QR', () => {
      const r = MA.parseBookBarcode('54200075599993005080000000099');
      assert.equal(r?.type, 'book');
      assert.equal(r?.packSize, 50);
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

describe('Smart pack-size inference (ticket-number constraint)', () => {
  // Mirror of inferPackSize in frontend/src/pages/Lottery.jsx
  const PACK_SIZE_CHOICES = [10, 20, 30, 40, 50, 60, 100, 120, 150, 200, 250, 300];
  function inferPackSize(price, scannedTicket, rules = null) {
    const heuristic = guessPackSize(price, rules);
    const t = Number(scannedTicket);
    if (!Number.isFinite(t) || t <= 0) return heuristic;
    if (t < heuristic) return heuristic;
    for (const size of PACK_SIZE_CHOICES) if (size > t) return size;
    return Math.ceil((t + 1) / 50) * 50;
  }

  test('Ticket 0 gives no info → use heuristic unchanged', () => {
    assert.equal(inferPackSize(5, 0), 100);  // $5 heuristic
  });
  test('Ticket within heuristic range → keep heuristic', () => {
    assert.equal(inferPackSize(5, 50), 100);
    assert.equal(inferPackSize(10, 20), 50);
  });
  test('Ticket 128 on $5 game (heuristic 100) → bumps to 150', () => {
    // Key example from the user's scan — game 498 ticket 128 proves pack is 150, not 100
    assert.equal(inferPackSize(5, 128), 150);
  });
  test('Ticket 99 on $5 game → stays at heuristic 100 (99 < 100 fits)', () => {
    assert.equal(inferPackSize(5, 99), 100);
  });
  test('Ticket 100 on $5 game → bumps to 120 (100 needs pack > 100)', () => {
    assert.equal(inferPackSize(5, 100), 120);
  });
  test('Ticket 199 on $5 game → bumps to 200', () => {
    assert.equal(inferPackSize(5, 199), 200);
  });
  test('Ticket 299 on $1 game → stays at heuristic 300', () => {
    assert.equal(inferPackSize(1, 299), 300);
  });
  test('Ticket 301 on $1 game → rounds up to 350 (no standard fits)', () => {
    assert.equal(inferPackSize(1, 301), 350);
  });
  test('Works with per-state rules too — Maine $5 → 60, ticket 100 → bumps to 120', () => {
    const MAINE_RULES = [
      { maxPrice: 5,    packSize: 60 },
      { maxPrice: 9999, packSize: 10 },
    ];
    assert.equal(inferPackSize(5, 100, MAINE_RULES), 120);
  });
});

describe('guessPackSize — per-state rules override the default', () => {
  // Maine uses smaller packs than MA for cheaper tickets; custom rule set
  const MAINE_RULES = [
    { maxPrice: 1,  packSize: 200 },   // ME $1 → 200 not 300
    { maxPrice: 5,  packSize: 60  },   // ME $5 → 60 not 100
    { maxPrice: 10, packSize: 40  },   // ME $10 → 40 not 50
    { maxPrice: 30, packSize: 20  },
    { maxPrice: 9999, packSize: 10 },
  ];

  test('Uses Maine rule set for $5 → 60 (not MA default 100)', () => {
    assert.equal(guessPackSize(5, MAINE_RULES), 60);
  });
  test('Uses Maine rule set for $10 → 40', () => {
    assert.equal(guessPackSize(10, MAINE_RULES), 40);
  });
  test('Uses Maine rule set for $1 → 200', () => {
    assert.equal(guessPackSize(1, MAINE_RULES), 200);
  });
  test('Falls back to last rule when price exceeds every bucket', () => {
    const CAPPED = [
      { maxPrice: 5,  packSize: 100 },
      { maxPrice: 10, packSize: 50  },
    ];
    // $50 exceeds both; return highest-tier (smallest) pack size
    assert.equal(guessPackSize(50, CAPPED), 50);
  });
  test('Null / empty rules → fall back to hardcoded US defaults', () => {
    assert.equal(guessPackSize(5, null), 100);
    assert.equal(guessPackSize(5, []),   100);
  });
  test('Out-of-order rules are sorted defensively', () => {
    const UNORDERED = [
      { maxPrice: 9999, packSize: 10 },
      { maxPrice: 5,    packSize: 100 },
      { maxPrice: 1,    packSize: 300 },
    ];
    assert.equal(guessPackSize(1, UNORDERED), 300);  // $1 matches the maxPrice:1 rule
    assert.equal(guessPackSize(5, UNORDERED), 100);
    assert.equal(guessPackSize(20, UNORDERED), 10);  // $20 exceeds 5, hits the 9999 catch-all
  });
  test('Custom rule set with string values coerces via Number()', () => {
    const WEIRD = [{ maxPrice: '5', packSize: '60' }, { maxPrice: '9999', packSize: '10' }];
    assert.equal(guessPackSize(5, WEIRD),  60);
    assert.equal(guessPackSize(10, WEIRD), 10);
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
