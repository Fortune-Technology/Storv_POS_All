// Catalog sync — pulls state-lottery game lists from each state's public
// feed and upserts into LotteryTicketCatalog. Called on demand from the
// Admin UI; can also be wired into a cron later.
//
// Upsert rules:
//   - Key:        (state, gameNumber)
//   - Refreshed:  name, ticketPrice, category, startDate
//   - Preserved:  ticketsPerBook (admin-managed), active (admin-managed)
//                 EXCEPT: on first insert, active defaults to
//                 (startDate is within the last 24 months)
//   - Missing games (present in DB but absent from feed):
//                 marked active=false, NEVER deleted (preserves
//                 LotteryBox FK references and historical reports).
//
// Returns a diff summary: { state, fetched, created, updated, nowInactive, errors }.

import prisma from '../../config/postgres.js';

const USER_AGENT = 'Storv-POS-CatalogSync/1.0';
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Guess the pack (book) size for a scratch ticket based on ticket price.
 *
 * State lottery feeds (MA's /api/v1/games specifically) do NOT include the
 * pack size in their response — the field simply doesn't exist in the JSON.
 * The pack size is printed on the physical book and published in each game's
 * rules PDF, but not exposed via API. Since every book at the receive stage
 * needs a valid pack size (to compute startTicket for sell-direction-aware
 * activation and to validate scanned ticket numbers), we fall back to the
 * industry-standard sizing that MA + most US state lotteries follow:
 *
 *   $1 tickets  → 300/pack    (high-volume cheap stock)
 *   $2 tickets  → 200/pack
 *   $3 tickets  → 200/pack
 *   $5 tickets  → 100/pack    (sometimes 150 in newer games)
 *   $10 tickets → 50/pack
 *   $20 tickets → 30/pack
 *   $25 tickets → 30/pack
 *   $30 tickets → 20/pack
 *   $50 tickets → 10/pack
 *
 * Falls back to 50 for unrecognised prices (mid-range safe default).
 * Admins MUST be able to override per-game — both via Lottery Catalog edit in
 * the admin-app (preserved on re-sync) and per-book in the Receive Books
 * scan flow (before Confirm).
 */
export function guessPackSize(ticketPrice) {
  const p = Number(ticketPrice);
  if (!Number.isFinite(p) || p <= 0) return 50;
  if (p <= 1)  return 300;
  if (p <= 2)  return 200;
  if (p <= 3)  return 200;
  if (p <= 5)  return 100;
  if (p <= 10) return 50;
  if (p <= 20) return 30;
  if (p <= 30) return 20;
  return 10;   // $50 and up
}

// ── Massachusetts ─────────────────────────────────────────────────────────

/**
 * Hit the MA Lottery's undocumented /api/v1/games endpoint. The `id` in
 * their response matches the 3-digit game number printed in the barcode.
 *
 * Returns an array of `{ gameNumber, name, price, category, startDate }`.
 */
export async function fetchMACatalog() {
  // Ask for a large limit; MA currently has ~150 active + historical games.
  const url = 'https://www.masslottery.com/api/v1/games?limit=500';
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`MA feed returned HTTP ${res.status}`);

  const body = await res.json();
  const raw = Array.isArray(body)
    ? body
    : body.games || body.data || body.results || body.items || [];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('MA feed returned no rows (shape may have changed)');
  }

  const out = [];
  for (const g of raw) {
    const gameNumber = g.id != null ? String(g.id) : null;
    const name = (g.name || '').trim();
    const price = g.price != null ? Number(g.price) : null;
    const type = (g.game_type || g.type || '').toLowerCase();
    if (!gameNumber || !name || price == null) continue;

    let category = 'instant';
    if (type.includes('scratch')) category = 'instant';
    else if (type.includes('draw')) category = 'draw';
    else if (type.includes('rapid')) category = 'draw'; // Keno-style; not scratchable
    else if (type) category = type.slice(0, 16);

    out.push({
      gameNumber,
      name,
      ticketPrice: price,
      category,
      startDate: g.start_date ? new Date(g.start_date) : null,
    });
  }

  return out;
}

// ── Upsert / diff ─────────────────────────────────────────────────────────

/**
 * Detect whether the state's newly-fetched list meaningfully differs from
 * the persisted row. Used to bump `updatedAt` only when something changed.
 */
function rowChanged(existing, incoming) {
  if ((existing.name || '') !== incoming.name) return true;
  if (Number(existing.ticketPrice) !== Number(incoming.ticketPrice)) return true;
  if ((existing.category || '') !== (incoming.category || '')) return true;
  return false;
}

/**
 * Upsert helper. `fetched` is an array of normalized rows for a given state.
 */
async function upsertCatalog({ state, fetched }) {
  if (!fetched || fetched.length === 0) {
    return { state, fetched: 0, created: 0, updated: 0, nowInactive: 0, errors: 0 };
  }

  const now = new Date();
  const twentyFourMonthsAgo = new Date(now);
  twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24);

  // Load everything currently in the catalog for this state
  const existing = await prisma.lotteryTicketCatalog.findMany({
    where: { state },
  });
  const byNumber = new Map(
    existing.filter((e) => e.gameNumber).map((e) => [e.gameNumber, e])
  );

  let created = 0, updated = 0, errors = 0;
  const seen = new Set();

  for (const row of fetched) {
    seen.add(row.gameNumber);
    const prior = byNumber.get(row.gameNumber);
    try {
      if (!prior) {
        // First insert — default active if the game started within 24 months
        const shouldBeActive = !row.startDate || row.startDate >= twentyFourMonthsAgo;
        await prisma.lotteryTicketCatalog.create({
          data: {
            state,
            gameNumber:     row.gameNumber,
            name:           row.name,
            ticketPrice:    row.ticketPrice,
            ticketsPerBook: guessPackSize(row.ticketPrice),
            category:       row.category || 'instant',
            active:         shouldBeActive,
          },
        });
        created += 1;
      } else if (rowChanged(prior, row)) {
        // Update refreshable fields only — preserve ticketsPerBook + active
        await prisma.lotteryTicketCatalog.update({
          where: { id: prior.id },
          data: {
            name:        row.name,
            ticketPrice: row.ticketPrice,
            category:    row.category || prior.category,
          },
        });
        updated += 1;
      }
    } catch (err) {
      console.warn(`[catalogSync] upsert failed for ${state}:${row.gameNumber}`, err.message);
      errors += 1;
    }
  }

  // Any DB row whose gameNumber is missing from the feed → mark inactive.
  // We never delete (FK refs + historical reports).
  const missing = existing.filter((e) => e.gameNumber && !seen.has(e.gameNumber) && e.active);
  let nowInactive = 0;
  if (missing.length > 0) {
    const r = await prisma.lotteryTicketCatalog.updateMany({
      where: { id: { in: missing.map((m) => m.id) } },
      data:  { active: false },
    });
    nowInactive = r.count;
  }

  return { state, fetched: fetched.length, created, updated, nowInactive, errors };
}

// ── Public entrypoint ─────────────────────────────────────────────────────

/**
 * Sync a single state's catalog. Throws on feed failure; partial upsert
 * errors are tallied in the return value.
 */
export async function syncState(stateCode) {
  const state = String(stateCode || '').toUpperCase();
  const startedAt = Date.now();

  let fetched;
  if (state === 'MA') {
    fetched = await fetchMACatalog();
  } else {
    // Maine (and other states) require per-state scrapers — we only ship MA
    // automation in Phase 3b. Attempting a sync on an unsupported state is
    // an error callers should handle by rendering "Maine sync coming soon".
    const err = new Error(`Automated sync for state ${state} is not supported yet`);
    err.code = 'UNSUPPORTED_STATE';
    throw err;
  }

  const diff = await upsertCatalog({ state, fetched });
  diff.durationMs = Date.now() - startedAt;
  return diff;
}

/**
 * Sync multiple states (only 'MA' supported for now). Collects per-state
 * diffs. Errors on one state don't abort the rest.
 */
export async function syncAllSupported() {
  const states = ['MA'];
  const out = [];
  for (const s of states) {
    try {
      out.push(await syncState(s));
    } catch (err) {
      out.push({ state: s, error: err.message });
    }
  }
  return out;
}

// ── Exports for testing (pure helpers) ───────────────────────────────────
export const __test = { rowChanged, upsertCatalog };
