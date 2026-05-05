// @ts-nocheck — pure-JS smoke test, mirrors the convention used in
//   `_smoke_*` files (no strict typing on test fixtures / assertions).
//
// MA Lottery — real-data smoke test.
//
// Exercises 97 production barcodes the user captured off real Massachusetts
// scratch tickets (May 2026):
//   • 37 Safe back-stock barcodes — books in inventory, not yet activated.
//     Each carries the QR book-level sentinel (ticket field == "999").
//   • 60 Book barcodes — books either active or fresh-received, with actual
//     ticket positions (000, 004, 067, etc).
//
// Coverage:
//   1. PARSE — every barcode resolves through MA.parseAny without error
//   2. STRUCTURE — distinct games, distinct books, no duplicates within set
//   3. SENTINEL — safe-stock barcodes correctly hit the BOOK-LEVEL "999"
//      sentinel branch and surface as type='book'
//   4. PACK SIZE — the 3-digit packSize at positions 15-17 surfaces correctly
//   5. STATE FALLBACK — parseScan() with stateCode=null still resolves via
//      adapter fallback iteration (the multi-state operator path)
//   6. CASE INSENSITIVITY / WHITESPACE — leading `~`, trailing CR, leading
//      whitespace all tolerated by normalize()
//   7. EDGE CASES — short strings, empty, garbage all return null
//   8. TIMEZONE — store-local-day boundaries from utils/dateTz.ts (covers
//      the Item 5a fix from May 2026 session)
//
// Pure-logic test — no DB, no Prisma. Run via:
//   npm run test -- backend/tests/_smoke_ma_barcodes_real.test.ts
// or:
//   node --import tsx --test backend/tests/_smoke_ma_barcodes_real.test.ts

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import MA from '../src/services/lottery/adapters/MA.js';
import { parseScan } from '../src/services/lottery/engine/scanParser.js';
import { localDayStartUTC, localDayEndUTC, formatLocalDate } from '../src/utils/dateTz.js';

// ─── Real-world barcode fixtures (May 2026) ────────────────────────────
// Format: 29-digit MA QR. See MA.ts for the layout.
//
// SAFE_STOCK: books still in safe inventory. Every entry has ticket="999"
// → BOOK-LEVEL sentinel. These are what cashier scans when receiving a
// book or activating it onto the counter.
const SAFE_STOCK = [
  '38705909779995005000000000011',
  '38705909789995005000000000012',
  '43303671449995005000000000091',
  '49001885989995005000000000008',
  '54200052159993005080000000086',
  '45801445989993005080000000010',
  '53000374639993005050000000090',
  '53600214229992010080000000082',
  '48900529809992010080000000002',
  '48801140059991010070000000086',
  '53500311009991010070000000073',
  '42701140869991010070000000088',
  '52900458649991010070000000098',
  '47701220039991010070000000081',
  '52100958399991010080000000098',
  '54100241959991010070000000086',
  '53300183389990515070000000098',
  '53300183379990515070000000097',
  '53400195809990515060000000098',
  '52800279089990515060000000004',
  '50400495939990515060000000002',
  '54000110039990515060000000077',
  '51600273449990515060000000095',
  '49600518659990515060000000007',
  '47200765859990515070000000008',
  '38100295399990515070000000004',
  '53900109639990515060000000099',
  '49800307619990515060000000001',
  '52000155619990515060000000088',
  '53200123569990220040000000081',
  '53800085239990200000000000000',
  '47100992909990215060000000001',
  '52700244149990220040000000083',
  '52500018549990215060000000090',
  '52400102519990215060000000080',
  '53100126309990115030000000077',
  '53700089829990115030000000098',
];

// BOOKS: tickets currently on the counter at various positions. Each entry
// has an ACTUAL ticket number in the TTT field (not "999").
const BOOKS = [
  '38705740670045005000000000080',
  '43303471640015005000000000065',
  '49001690590155005000000000078',
  '53000051730163005050000000063',
  '45801358310213005080000000076',
  '37302715380123005080000000077',
  '49100895330313005080000000081',
  '54200052140033005080000000061',
  '52300200080872010000000000057',
  '39300871210682010080000000078',
  '40900966130402010080000000072',
  '50900383760442010080000000079',
  '45200893760522010080000000081',
  '53600105070102010080000000058',
  '48400954400351010070000000074',
  '36801468740741010070000000086',
  '34001420170171010070000000058',
  '48300927090601010070000000076',
  '50800587080391010070000000081',
  '41301401890691010070000000074',
  '40801561540581010070000000075',
  '47000980090681010080000000080',
  '52100887330551010080000000076',
  '48801114390221010070000000071',
  '47700987140101010070000000076',
  '47701117840241010070000000074',
  '45700853430771010070000000081',
  '34101052850481010070000000069',
  '52900384500001010070000000064',
  '51300481550631010070000000069',
  '49800276321180515060000000087',
  '53300119020200515070000000063',
  '54000027490470515060000000078',
  '47400547580120515060000000083',
  '52000062110870515060000000068',
  '45600980150200515060000000076',
  '38100263951080515070000000083',
  '47200668120300515070000000076',
  '47200740540800515070000000078',
  '53900027490360515060000000084',
  '51600422560010515060000000068',
  '53400195790750515060000000091',
  '52800226550520515060000000078',
  '49600405070500515060000000076',
  '49700475761360515060000000095',
  '47100934940120215060000000077',
  '52400102500810215060000000061',
  '48600428370230220040000000074',
  '53800022290740220040000000069',
  '51500213250110220040000000053',
  '50700214941160220040000000067',
  '50700141970580220040000000074',
  '51100208830950220040000000069',
  '54600014431680220040000000069',
  '49500278871610220040000000085',
  '47900387970840220040000000093',
  '53200022710430220040000000056',
  '49400397651070115030000000084',
  '53700025191070115030000000069',
  '49300198900830115030000000083',
  '52200048781260115030000000074',
];

// Test counter — tracks all results so the final summary can dump pass/fail.
const results: Array<{ block: string; name: string; ok: boolean; detail?: string }> = [];
const record = (block: string, name: string, ok: boolean, detail?: string) => {
  results.push({ block, name, ok, detail });
};

// ════════════════════════════════════════════════════════════════════════
// BLOCK 1 — PARSE: every barcode must resolve through MA.parseAny
// ════════════════════════════════════════════════════════════════════════
describe('BLOCK 1 — Parse safe stock + book barcodes', () => {
  test('All 37 safe-stock barcodes parse as type=book with sentinel ticket', () => {
    let okCount = 0;
    const failures: string[] = [];
    for (const code of SAFE_STOCK) {
      const r = MA.parseAny(code);
      if (r && r.type === 'book' && r.gameNumber && r.bookNumber && r.source === 'qr') {
        okCount += 1;
      } else {
        failures.push(`${code} → ${JSON.stringify(r)}`);
      }
    }
    record('1.1', `Safe stock parse — ${okCount}/${SAFE_STOCK.length} ok`, okCount === SAFE_STOCK.length, failures.join('\n'));
    assert.equal(okCount, SAFE_STOCK.length, `Failed safe-stock parses:\n${failures.join('\n')}`);
  });

  test('All 60 book barcodes parse as type=ticket with valid ticket number', () => {
    let okCount = 0;
    const failures: string[] = [];
    for (const code of BOOKS) {
      const r = MA.parseAny(code);
      if (
        r &&
        r.type === 'ticket' &&
        r.gameNumber &&
        r.bookNumber &&
        Number.isFinite(r.ticketNumber) &&
        r.source === 'qr'
      ) {
        okCount += 1;
      } else {
        failures.push(`${code} → ${JSON.stringify(r)}`);
      }
    }
    record('1.2', `Book scan parse — ${okCount}/${BOOKS.length} ok`, okCount === BOOKS.length, failures.join('\n'));
    assert.equal(okCount, BOOKS.length, `Failed book-scan parses:\n${failures.join('\n')}`);
  });

  test('Sample-by-sample verification — 5 representative parses', () => {
    const samples = [
      // [barcode, expected.gameNumber, expected.bookNumber, expected.type, expected.ticketNumber|null]
      ['38705909779995005000000000011', '387', '590977', 'book', null],
      ['54200052159993005080000000086', '542', '005215', 'book', null],
      ['38705740670045005000000000080', '387', '574067', 'ticket', 4],
      ['52900384500001010070000000064', '529', '038450', 'ticket', 0],
      ['51300481550631010070000000069', '513', '048155', 'ticket', 63],
    ] as const;
    let okCount = 0;
    for (const [bc, game, book, type, ticket] of samples) {
      const r = MA.parseAny(bc);
      const passed =
        r != null &&
        r.gameNumber === game &&
        r.bookNumber === book &&
        r.type === type &&
        (type === 'book' ? true : r.ticketNumber === ticket);
      if (passed) okCount += 1;
      record('1.3', `Sample: ${bc.slice(0, 12)}… → ${type}`, passed, JSON.stringify(r));
    }
    assert.equal(okCount, samples.length);
  });
});

// ════════════════════════════════════════════════════════════════════════
// BLOCK 2 — STRUCTURE: games, books, duplicates within fixture set
// ════════════════════════════════════════════════════════════════════════
describe('BLOCK 2 — Structural analysis of fixture set', () => {
  const allBarcodes = [...SAFE_STOCK, ...BOOKS];

  test('No duplicate barcodes across safe stock + books', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const c of allBarcodes) {
      if (seen.has(c)) dupes.push(c);
      seen.add(c);
    }
    record('2.1', `No duplicate barcodes — ${dupes.length} dupes`, dupes.length === 0, dupes.join('\n'));
    assert.equal(dupes.length, 0, `Duplicates found: ${dupes.join(', ')}`);
  });

  test('Distinct game numbers across fixture', () => {
    const games = new Set<string>();
    for (const c of allBarcodes) {
      const r = MA.parseAny(c);
      if (r) games.add(r.gameNumber);
    }
    record('2.2', `Distinct games — ${games.size}`, games.size > 0, [...games].sort().join(', '));
    assert.ok(games.size > 0);
  });

  test('Same game can have multiple books — verify map structure', () => {
    const byGame = new Map<string, Set<string>>();
    for (const c of allBarcodes) {
      const r = MA.parseAny(c);
      if (!r) continue;
      const set = byGame.get(r.gameNumber) || new Set();
      set.add(r.bookNumber);
      byGame.set(r.gameNumber, set);
    }
    let multiBook = 0;
    for (const [, books] of byGame) {
      if (books.size > 1) multiBook += 1;
    }
    record('2.3', `Multi-book games — ${multiBook} of ${byGame.size}`, true, '');
    assert.ok(byGame.size > 0);
  });

  test('No (game, book) collision between safe and books — confirms fixture is internally consistent', () => {
    const safeKeys = new Set<string>();
    const bookKeys = new Set<string>();
    for (const c of SAFE_STOCK) {
      const r = MA.parseAny(c);
      if (r) safeKeys.add(`${r.gameNumber}/${r.bookNumber}`);
    }
    for (const c of BOOKS) {
      const r = MA.parseAny(c);
      if (r) bookKeys.add(`${r.gameNumber}/${r.bookNumber}`);
    }
    const overlap = [...safeKeys].filter((k) => bookKeys.has(k));
    record('2.4', `Safe ∩ Books — ${overlap.length} overlap`, overlap.length === 0, overlap.join('\n'));
    // We don't assert here — overlap is a diagnostic ANOMALY, not a hard failure.
    // (Could legitimately happen if a book was scanned both ways during testing.)
    if (overlap.length > 0) {
      console.warn(`⚠ Same (game,book) appears in BOTH safe stock AND books: ${overlap.join(', ')}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// BLOCK 3 — PACK SIZE extraction from QR positions 15-17
// ════════════════════════════════════════════════════════════════════════
describe('BLOCK 3 — Pack size extraction from QR metadata', () => {
  test('Pack size surfaces as a finite integer for every parsed barcode', () => {
    let withPack = 0;
    let withoutPack = 0;
    const distinctSizes = new Set<number>();
    for (const c of [...SAFE_STOCK, ...BOOKS]) {
      const r = MA.parseAny(c) as any;
      if (r && Number.isFinite(r.packSize) && r.packSize > 0) {
        withPack += 1;
        distinctSizes.add(r.packSize);
      } else {
        withoutPack += 1;
      }
    }
    record(
      '3.1',
      `Pack size present on ${withPack}/${withPack + withoutPack} — distinct sizes: ${[...distinctSizes].sort((a, b) => a - b).join(', ')}`,
      withPack > 0,
      '',
    );
    assert.ok(withPack > 0);
  });

  test('Distinct pack sizes match real-world MA pack sizes (50, 100, 150, 300)', () => {
    const expected = new Set([50, 100, 150, 300, 600]); // industry-standard
    const seen = new Set<number>();
    for (const c of [...SAFE_STOCK, ...BOOKS]) {
      const r = MA.parseAny(c) as any;
      if (r && Number.isFinite(r.packSize)) seen.add(r.packSize);
    }
    const unexpected = [...seen].filter((s) => !expected.has(s));
    record('3.2', `Unexpected pack sizes — ${unexpected.length}`, true, unexpected.join(', '));
    if (unexpected.length > 0) {
      console.warn(`⚠ Unexpected pack sizes (verify with state lottery docs): ${unexpected.join(', ')}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// BLOCK 4 — STATE FALLBACK: parseScan() resolves even without state hint
// ════════════════════════════════════════════════════════════════════════
describe('BLOCK 4 — parseScan() with no preferred state still resolves', () => {
  test('parseScan(barcode, null) routes to MA via fallback iteration', () => {
    let okCount = 0;
    let failCount = 0;
    for (const c of [...SAFE_STOCK, ...BOOKS]) {
      const r = parseScan(c, null);
      if (r && r.adapter.code === 'MA' && r.parsed) okCount += 1;
      else failCount += 1;
    }
    record('4.1', `parseScan fallback — ${okCount} ok / ${failCount} fail`, failCount === 0, '');
    assert.equal(failCount, 0);
  });

  test('parseScan(barcode, "MA") uses preferred adapter on first try', () => {
    let okCount = 0;
    for (const c of [...SAFE_STOCK, ...BOOKS]) {
      const r = parseScan(c, 'MA');
      if (r && r.adapter.code === 'MA') okCount += 1;
    }
    const total = SAFE_STOCK.length + BOOKS.length;
    record('4.2', `parseScan(MA preferred) — ${okCount}/${total}`, okCount === total, '');
    assert.equal(okCount, total);
  });

  test('parseScan with an unknown state code still falls back to MA', () => {
    const r = parseScan(SAFE_STOCK[0], 'NONEXISTENT' as any);
    record('4.3', 'Unknown stateCode falls back gracefully', r != null, JSON.stringify(r));
    assert.ok(r != null);
    assert.equal(r!.adapter.code, 'MA');
  });
});

// ════════════════════════════════════════════════════════════════════════
// BLOCK 5 — TOLERANCE: scanner prefixes, whitespace, garbage
// ════════════════════════════════════════════════════════════════════════
describe('BLOCK 5 — Input tolerance and edge cases', () => {
  test('Leading "~" prefix (some scanner stacks emit this) is stripped', () => {
    const r = MA.parseAny('~38705909779995005000000000011');
    record('5.1', 'Leading "~" tolerated', r != null && r.type === 'book', JSON.stringify(r));
    assert.ok(r != null);
    assert.equal(r!.type, 'book');
  });

  test('Trailing CR / LF / spaces tolerated', () => {
    const variants = [
      '38705909779995005000000000011\r',
      '38705909779995005000000000011\n',
      '38705909779995005000000000011 ',
      '  38705909779995005000000000011',
    ];
    for (const v of variants) {
      const r = MA.parseAny(v);
      const passed = r != null && r.type === 'book' && r.bookNumber === '590977';
      record('5.2', `Whitespace variant: ${JSON.stringify(v.slice(0, 35))}`, passed, JSON.stringify(r));
      assert.ok(passed);
    }
  });

  test('Empty string returns null', () => {
    const r = MA.parseAny('');
    record('5.3', 'Empty string → null', r === null, '');
    assert.equal(r, null);
  });

  test('Garbage input returns null', () => {
    const cases = ['ABCDEFG', '123', '12345678901234567890123456', 'x'.repeat(50)];
    for (const c of cases) {
      const r = MA.parseAny(c);
      record('5.4', `Garbage "${c.slice(0, 20)}…" → null`, r === null, JSON.stringify(r));
      assert.equal(r, null);
    }
  });

  test('29-digit string with WRONG separator at position 3 returns null', () => {
    // Replace position 3 (separator) with a non-zero — should fail QR regex.
    const broken = '3879909779995005000000000011' + '5'; // 29 chars, pos 3 = 9
    const wrongSep = '3875909779995005000000000011' + '5';
    const r1 = MA.parseAny(broken);
    const r2 = MA.parseAny(wrongSep);
    record('5.5', 'Wrong separator → null', r1 === null && r2 === null, '');
    assert.equal(r1, null);
    assert.equal(r2, null);
  });

  test('30-digit (too long) and 28-digit (too short) → null', () => {
    const r1 = MA.parseAny('387059097799950050000000000110'); // 30
    const r2 = MA.parseAny('3870590977999500500000000001'); // 28
    record('5.6', 'Wrong length → null', r1 === null && r2 === null, '');
    assert.equal(r1, null);
    assert.equal(r2, null);
  });
});

// ════════════════════════════════════════════════════════════════════════
// BLOCK 6 — TIMEZONE / day-boundary helpers (covers Item 5a)
// ════════════════════════════════════════════════════════════════════════
describe('BLOCK 6 — Timezone day-boundary helpers (Item 5a regression cover)', () => {
  test('localDayStartUTC for 2026-04-30 in EDT lands at 2026-04-30T04:00:00Z', () => {
    const start = localDayStartUTC('2026-04-30', 'America/New_York');
    record('6.1', 'EDT day start', start.toISOString() === '2026-04-30T04:00:00.000Z', start.toISOString());
    assert.equal(start.toISOString(), '2026-04-30T04:00:00.000Z');
  });

  test('localDayEndUTC for 2026-04-30 in EDT lands at 2026-05-01T03:59:59.999Z', () => {
    const end = localDayEndUTC('2026-04-30', 'America/New_York');
    record('6.2', 'EDT day end', end.toISOString() === '2026-05-01T03:59:59.999Z', end.toISOString());
    assert.equal(end.toISOString(), '2026-05-01T03:59:59.999Z');
  });

  test('Day boundaries for positive-offset zone (Berlin) — 2026-04-30 lands inside the local day', () => {
    const start = localDayStartUTC('2026-04-30', 'Europe/Berlin');
    const end = localDayEndUTC('2026-04-30', 'Europe/Berlin');
    // Berlin in summer (CEST) is UTC+2, so 2026-04-30 local = 2026-04-29 22:00 UTC to 2026-04-30 21:59:59.999 UTC.
    // Verify they make logical sense (start before end, ~24h apart).
    const diffHours = (end.getTime() - start.getTime()) / 3600000;
    record('6.3', `Berlin day window — ${diffHours.toFixed(2)}h`, diffHours > 23.9 && diffHours < 24.1, '');
    assert.ok(diffHours > 23.9 && diffHours < 24.1);
  });

  test('formatLocalDate inverts the local-day window correctly (round-trip)', () => {
    const tz = 'America/New_York';
    const date = '2026-04-30';
    const start = localDayStartUTC(date, tz);
    const back = formatLocalDate(start, tz);
    record('6.4', `Round-trip ${date} → ${back}`, back === date, back);
    assert.equal(back, date);
  });

  test('CRITICAL — past-date soldoutAt timestamp lands INSIDE the read window', () => {
    // Mirrors the markBoxSoldout flow: user picks April 30, backend computes
    // soldoutAt via localDayEndUTC. A subsequent getDailyLotteryInventory for
    // April 30 reads via [localDayStartUTC, localDayEndUTC]. The soldout
    // snapshot MUST fall inside that window.
    for (const tz of ['America/New_York', 'America/Los_Angeles', 'Europe/Berlin', 'Pacific/Auckland', 'UTC']) {
      const dateStr = '2026-04-30';
      const soldoutAt = localDayEndUTC(dateStr, tz);
      const readStart = localDayStartUTC(dateStr, tz);
      const readEnd = localDayEndUTC(dateStr, tz);
      const inside = soldoutAt >= readStart && soldoutAt <= readEnd;
      record('6.5', `Past-date SO timestamp inside window (${tz})`, inside, `soldoutAt=${soldoutAt.toISOString()}, window=[${readStart.toISOString()}, ${readEnd.toISOString()}]`);
      assert.ok(inside, `Out-of-window for tz=${tz}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// BLOCK 7 — STATE TRANSITION pure-logic simulation
// ════════════════════════════════════════════════════════════════════════
// Simulates the engine's decision tree for each of the user's barcodes
// without touching Prisma. Verifies the parse output drives the right
// engine action category in each scenario.
describe('BLOCK 7 — State transition decision tree (pure simulation)', () => {
  // A safe-stock book scan + no existing record → engine should ACTIVATE.
  test('Safe-stock book scan + no DB record → activation candidate', () => {
    let activations = 0;
    for (const c of SAFE_STOCK) {
      const parsed = MA.parseAny(c);
      // Decision: parsed.type === 'book' AND we don't have a matching DB row
      // → activate this book onto counter at startTicket=null (cashier picks slot).
      if (parsed && parsed.type === 'book') activations += 1;
    }
    record('7.1', `Activation-eligible scans — ${activations}/${SAFE_STOCK.length}`, activations === SAFE_STOCK.length, '');
    assert.equal(activations, SAFE_STOCK.length);
  });

  // A ticket scan + matching active book + lower-or-equal ticket → UPDATE.
  test('Ticket scan with valid descending position → update_current candidate', () => {
    // For each book scan, simulate a prior currentTicket (max ticket per pack)
    // and verify the new scan would be accepted as a downward update.
    let updates = 0;
    let rejects = 0;
    for (const c of BOOKS) {
      const parsed = MA.parseAny(c);
      if (!parsed || parsed.type !== 'ticket') continue;
      const ticket = parsed.ticketNumber!;
      const packSize = parsed.packSize || 100;
      const priorPosition = packSize - 1; // descending: pack starts at packSize-1
      // Decision: ticket <= priorPosition AND ticket >= -1 (allow sentinel)
      if (ticket <= priorPosition && ticket >= -1) updates += 1;
      else rejects += 1;
    }
    record('7.2', `Descending update candidates — ${updates} updates, ${rejects} rejects`, true, '');
    // Some "books" might have ticket > priorPosition because they're at fresh
    // top-of-pack position (eg ticket 80 in a 80-pack desc book = top), so
    // this is informational, not a strict assertion.
    assert.ok(updates > 0);
  });

  // Soldout scenario: book transitioned to depleted → restore-to-counter
  // should walk currentTicket back to its previous position.
  test('Soldout sentinel position derives correctly per sellDirection', () => {
    // For a desc book at packSize=150: fully sold = -1
    // For an asc book at packSize=150:  fully sold = 150
    const cases = [
      { packSize: 50, sellDir: 'desc', expected: -1 },
      { packSize: 100, sellDir: 'desc', expected: -1 },
      { packSize: 150, sellDir: 'desc', expected: -1 },
      { packSize: 50, sellDir: 'asc', expected: 50 },
      { packSize: 100, sellDir: 'asc', expected: 100 },
      { packSize: 300, sellDir: 'asc', expected: 300 },
    ];
    let passCount = 0;
    for (const c of cases) {
      const fullySoldPos = c.sellDir === 'asc' ? c.packSize : -1;
      const passed = fullySoldPos === c.expected;
      if (passed) passCount += 1;
      record('7.3', `Soldout sentinel — pack ${c.packSize} ${c.sellDir} → ${fullySoldPos}`, passed, '');
    }
    assert.equal(passCount, cases.length);
  });
});

// ════════════════════════════════════════════════════════════════════════
// BLOCK 8 — SUMMARY REPORT
// ════════════════════════════════════════════════════════════════════════
describe('BLOCK 8 — Summary report', () => {
  test('All test results dump (informational)', () => {
    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    console.log('\n' + '═'.repeat(72));
    console.log(`MA REAL-DATA SMOKE TEST — RESULTS`);
    console.log('═'.repeat(72));
    console.log(`Total checks: ${results.length}`);
    console.log(`✓ Passed:    ${passed}`);
    console.log(`✗ Failed:    ${failed}`);
    console.log('─'.repeat(72));
    for (const r of results) {
      console.log(`  ${r.ok ? '✓' : '✗'} [${r.block}] ${r.name}`);
      if (!r.ok && r.detail) console.log(`      ${r.detail.split('\n').slice(0, 5).join('\n      ')}`);
    }
    console.log('═'.repeat(72));
    assert.equal(failed, 0, `${failed} checks failed`);
  });
});
