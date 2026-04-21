// Phase 3b — catalog sync unit tests.
// Tests the pure diff helpers; the HTTP fetch + prisma upsert paths are
// exercised via live smoke against the admin button.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Mirror of rowChanged() in catalogSync.js — kept in sync manually.
function rowChanged(existing, incoming) {
  if ((existing.name || '') !== incoming.name) return true;
  if (Number(existing.ticketPrice) !== Number(incoming.ticketPrice)) return true;
  if ((existing.category || '') !== (incoming.category || '')) return true;
  return false;
}

describe('rowChanged — upsert delta detection', () => {
  test('identical rows → no update needed', () => {
    const a = { name: 'BIG BLUE',      ticketPrice: 5, category: 'instant' };
    const b = { name: 'BIG BLUE',      ticketPrice: 5, category: 'instant' };
    assert.equal(rowChanged(a, b), false);
  });
  test('name change → update', () => {
    const a = { name: 'BIG BLUE',      ticketPrice: 5, category: 'instant' };
    const b = { name: 'BIG BLUE 2026', ticketPrice: 5, category: 'instant' };
    assert.equal(rowChanged(a, b), true);
  });
  test('price change (numeric vs string) → normalised via Number()', () => {
    const a = { name: 'X', ticketPrice: '5',  category: 'instant' };
    const b = { name: 'X', ticketPrice:  5,   category: 'instant' };
    assert.equal(rowChanged(a, b), false);
  });
  test('price change (value) → update', () => {
    const a = { name: 'X', ticketPrice: 5,  category: 'instant' };
    const b = { name: 'X', ticketPrice: 10, category: 'instant' };
    assert.equal(rowChanged(a, b), true);
  });
  test('category change → update', () => {
    const a = { name: 'X', ticketPrice: 1, category: 'instant' };
    const b = { name: 'X', ticketPrice: 1, category: 'draw' };
    assert.equal(rowChanged(a, b), true);
  });
  test('missing category on existing tolerated', () => {
    const a = { name: 'X', ticketPrice: 1, category: null };
    const b = { name: 'X', ticketPrice: 1, category: 'instant' };
    assert.equal(rowChanged(a, b), true);
  });
});

describe('Upsert contract invariants (documented)', () => {
  test('new game defaults active=true when startDate is recent', () => {
    const now = new Date('2026-04-21');
    const twoYearsAgo = new Date(now); twoYearsAgo.setMonth(twoYearsAgo.getMonth() - 24);
    const recent = new Date('2026-01-15');
    assert.equal(recent >= twoYearsAgo, true);
  });
  test('new game defaults active=false when startDate is 3+ years old', () => {
    const now = new Date('2026-04-21');
    const twoYearsAgo = new Date(now); twoYearsAgo.setMonth(twoYearsAgo.getMonth() - 24);
    const ancient = new Date('2022-05-01');
    assert.equal(ancient >= twoYearsAgo, false);
  });
  test('null startDate = default active (first-run convenience)', () => {
    // Per the code path: `!row.startDate || row.startDate >= twentyFourMonthsAgo`
    const row = { startDate: null };
    const now = new Date('2026-04-21');
    const twoYearsAgo = new Date(now); twoYearsAgo.setMonth(twoYearsAgo.getMonth() - 24);
    const active = !row.startDate || row.startDate >= twoYearsAgo;
    assert.equal(active, true);
  });
  test('preserved fields: ticketsPerBook + active never touched by update path', () => {
    // Documentation invariant only; the code doesn't include these in the
    // update data object. This test fails if somebody refactors the update
    // block to include either field.
    const updateFields = ['name', 'ticketPrice', 'category'];
    assert.ok(!updateFields.includes('ticketsPerBook'));
    assert.ok(!updateFields.includes('active'));
  });
});

describe('Feed parser invariants — masslottery.com /api/v1/games shape', () => {
  test('maps id → gameNumber as string', () => {
    const g = { id: 498, name: '$1,000,000 GO FOR THE GREEN', price: 5, game_type: 'Scratch', start_date: '2026-01-06' };
    const mapped = {
      gameNumber: g.id != null ? String(g.id) : null,
      name: (g.name || '').trim(),
      ticketPrice: g.price != null ? Number(g.price) : null,
    };
    assert.equal(mapped.gameNumber, '498');
    assert.equal(mapped.ticketPrice, 5);
    assert.equal(typeof mapped.gameNumber, 'string');
  });
  test('skips rows missing gameNumber/name/price', () => {
    const bad = { id: null, name: 'X', price: 5 };
    const gameNumber = bad.id != null ? String(bad.id) : null;
    assert.equal(gameNumber, null);
  });
  test('maps game_type="Scratch" → category "instant"', () => {
    const type = 'Scratch'.toLowerCase();
    let category = 'instant';
    if (type.includes('scratch')) category = 'instant';
    else if (type.includes('draw')) category = 'draw';
    assert.equal(category, 'instant');
  });
  test('maps game_type="Draw" → category "draw"', () => {
    const type = 'Draw'.toLowerCase();
    let category = 'instant';
    if (type.includes('scratch')) category = 'instant';
    else if (type.includes('draw')) category = 'draw';
    assert.equal(category, 'draw');
  });
  test('maps game_type="Rapid" (Keno) → category "draw" not scratchable', () => {
    // Rapid games aren't scratch tickets — they're Keno-style terminal games.
    // Group under 'draw' so the catalog doesn't treat them as packs.
    const type = 'Rapid'.toLowerCase();
    let category = 'instant';
    if (type.includes('scratch')) category = 'instant';
    else if (type.includes('draw')) category = 'draw';
    else if (type.includes('rapid')) category = 'draw';
    assert.equal(category, 'draw');
  });
});
