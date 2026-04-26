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

const USER_AGENT = 'Storeveu-POS-CatalogSync/1.0';
const FETCH_TIMEOUT_MS = 15_000;

export interface PackSizeRule {
  maxPrice: number;
  packSize: number;
}

export interface CatalogRow {
  gameNumber: string;
  name: string;
  ticketPrice: number;
  category: string;
  startDate: Date | null;
}

export interface SyncDiff {
  state: string;
  fetched: number;
  created: number;
  updated: number;
  nowInactive: number;
  errors: number;
  durationMs?: number;
  error?: string;
}

interface UnsupportedStateError extends Error {
  code: 'UNSUPPORTED_STATE';
}

/**
 * Default pack-size rules when a state has none configured.
 * Matches MA + most US-state scratch-ticket conventions. Superadmins can
 * override per state via the State.lotteryPackSizeRules JSON field.
 */
export const DEFAULT_PACK_SIZE_RULES: PackSizeRule[] = [
  { maxPrice: 1,    packSize: 300 },
  { maxPrice: 2,    packSize: 200 },
  { maxPrice: 3,    packSize: 200 },
  { maxPrice: 5,    packSize: 100 },
  { maxPrice: 10,   packSize: 50  },
  { maxPrice: 20,   packSize: 30  },
  { maxPrice: 30,   packSize: 20  },
  { maxPrice: 9999, packSize: 10  },
];

/**
 * Guess the pack (book) size for a scratch ticket based on ticket price,
 * optionally using a per-state rule list. State lottery APIs don't expose
 * pack size, so we look it up from an ordered rule list: the first rule
 * whose maxPrice >= ticketPrice wins.
 */
export function guessPackSize(
  ticketPrice: unknown,
  rules: PackSizeRule[] | null = null,
): number {
  const p = Number(ticketPrice);
  if (!Number.isFinite(p) || p <= 0) return 50;
  const ruleList = (Array.isArray(rules) && rules.length > 0) ? rules : DEFAULT_PACK_SIZE_RULES;
  // Rules should already be ordered maxPrice ascending; sort defensively
  // so an admin's unordered edit still resolves correctly.
  const sorted = [...ruleList].sort(
    (a: PackSizeRule, b: PackSizeRule) => Number(a.maxPrice) - Number(b.maxPrice),
  );
  for (const r of sorted) {
    if (p <= Number(r.maxPrice)) return Number(r.packSize);
  }
  // Price exceeds every rule's maxPrice — return the highest-tier size.
  return Number(sorted[sorted.length - 1]?.packSize) || 50;
}

// ── Massachusetts ─────────────────────────────────────────────────────────

interface MAGameRaw {
  id?: string | number;
  name?: string;
  price?: number | string;
  game_type?: string;
  type?: string;
  start_date?: string;
}

/**
 * Hit the MA Lottery's undocumented /api/v1/games endpoint. The `id` in
 * their response matches the 3-digit game number printed in the barcode.
 */
export async function fetchMACatalog(): Promise<CatalogRow[]> {
  // Ask for a large limit; MA currently has ~150 active + historical games.
  const url = 'https://www.masslottery.com/api/v1/games?limit=500';
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`MA feed returned HTTP ${res.status}`);

  const body = (await res.json()) as
    | MAGameRaw[]
    | { games?: MAGameRaw[]; data?: MAGameRaw[]; results?: MAGameRaw[]; items?: MAGameRaw[] };
  const raw: MAGameRaw[] = Array.isArray(body)
    ? body
    : body.games || body.data || body.results || body.items || [];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('MA feed returned no rows (shape may have changed)');
  }

  const out: CatalogRow[] = [];
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

interface ExistingCatalogRow {
  id: string;
  state: string | null;
  gameNumber: string | null;
  name: string | null;
  ticketPrice: unknown;     // Decimal | number
  category: string | null;
  active: boolean | null;
}

/**
 * Detect whether the state's newly-fetched list meaningfully differs from
 * the persisted row. Used to bump `updatedAt` only when something changed.
 */
function rowChanged(existing: ExistingCatalogRow, incoming: CatalogRow): boolean {
  if ((existing.name || '') !== incoming.name) return true;
  if (Number(existing.ticketPrice) !== Number(incoming.ticketPrice)) return true;
  if ((existing.category || '') !== (incoming.category || '')) return true;
  return false;
}

/**
 * Upsert helper. `fetched` is an array of normalized rows for a given state.
 */
async function upsertCatalog(
  { state, fetched }: { state: string; fetched: CatalogRow[] },
): Promise<SyncDiff> {
  if (!fetched || fetched.length === 0) {
    return { state, fetched: 0, created: 0, updated: 0, nowInactive: 0, errors: 0 };
  }

  const now = new Date();
  const twentyFourMonthsAgo = new Date(now);
  twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24);

  // Pull this state's per-state pack-size rules from the State catalog.
  // Falls back to DEFAULT_PACK_SIZE_RULES inside guessPackSize if null.
  const stateRow = await prisma.state.findUnique({
    where: { code: state },
    select: { lotteryPackSizeRules: true },
  }).catch(() => null);
  const packRules = (stateRow?.lotteryPackSizeRules as PackSizeRule[] | null) || null;

  // Load everything currently in the catalog for this state
  const existing = await prisma.lotteryTicketCatalog.findMany({
    where: { state },
  }) as ExistingCatalogRow[];
  const byNumber = new Map<string, ExistingCatalogRow>(
    existing
      .filter((e: ExistingCatalogRow): e is ExistingCatalogRow & { gameNumber: string } => !!e.gameNumber)
      .map((e: ExistingCatalogRow & { gameNumber: string }): [string, ExistingCatalogRow] => [e.gameNumber, e]),
  );

  let created = 0, updated = 0, errors = 0;
  const seen = new Set<string>();

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
            ticketsPerBook: guessPackSize(row.ticketPrice, packRules),
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
            category:    row.category || prior.category || undefined,
          },
        });
        updated += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[catalogSync] upsert failed for ${state}:${row.gameNumber}`, message);
      errors += 1;
    }
  }

  // Any DB row whose gameNumber is missing from the feed → mark inactive.
  // We never delete (FK refs + historical reports).
  const missing = existing.filter(
    (e: ExistingCatalogRow) => e.gameNumber && !seen.has(e.gameNumber) && e.active,
  );
  let nowInactive = 0;
  if (missing.length > 0) {
    const r = await prisma.lotteryTicketCatalog.updateMany({
      where: { id: { in: missing.map((m: ExistingCatalogRow) => m.id) } },
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
export async function syncState(stateCode: string | null | undefined): Promise<SyncDiff> {
  const state = String(stateCode || '').toUpperCase();
  const startedAt = Date.now();

  let fetched: CatalogRow[];
  if (state === 'MA') {
    fetched = await fetchMACatalog();
  } else {
    // Maine (and other states) require per-state scrapers — we only ship MA
    // automation in Phase 3b. Attempting a sync on an unsupported state is
    // an error callers should handle by rendering "Maine sync coming soon".
    const err = new Error(`Automated sync for state ${state} is not supported yet`) as UnsupportedStateError;
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
export async function syncAllSupported(): Promise<SyncDiff[]> {
  const states: string[] = ['MA'];
  const out: SyncDiff[] = [];
  for (const s of states) {
    try {
      out.push(await syncState(s));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.push({ state: s, fetched: 0, created: 0, updated: 0, nowInactive: 0, errors: 1, error: message });
    }
  }
  return out;
}

// ── Exports for testing (pure helpers) ───────────────────────────────────
export const __test = { rowChanged, upsertCatalog };
