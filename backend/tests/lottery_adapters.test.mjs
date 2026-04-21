// Lottery state-adapter parse tests.
// Pure unit tests — no DB, no prisma. Verifies the barcode regexes against
// the real samples we captured from MA + ME tickets.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import MA from '../src/services/lottery/adapters/MA.js';
import ME from '../src/services/lottery/adapters/ME.js';
import { getAdapter, supportedStates } from '../src/services/lottery/adapters/_registry.js';
import { parseScan } from '../src/services/lottery/engine/scanParser.js';

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
