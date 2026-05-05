/**
 * Timezone-aware day-boundary helpers — shared across reports.
 *
 * Background: any report that buckets transactions by date is wrong if it
 * uses UTC day boundaries OR server-local day boundaries when the store is
 * in a different timezone. Symptom: a transaction at 22:30 EDT (= 02:30
 * UTC next day) lands in the wrong day's bucket. For multi-store retailers
 * spanning timezones, OR for any production server in UTC, the per-day
 * numbers drift.
 *
 * Fix: every report that buckets by date must use these helpers to compute
 * UTC instants representing local-day boundaries in the store's IANA
 * timezone. Originally introduced for the lottery report (B9 — Session 59).
 *
 * Usage:
 *   import { formatLocalDate, localDayStartUTC, localDayEndUTC, addOneDay }
 *     from '../utils/dateTz.js';
 *
 *   // Format a tx createdAt as YYYY-MM-DD in the store's tz
 *   const dayKey = formatLocalDate(tx.createdAt, store.timezone || 'UTC');
 *
 *   // Get UTC instants for the start/end of a local day
 *   const dayStart = localDayStartUTC('2026-04-29', 'America/New_York');
 *   const dayEnd   = localDayEndUTC('2026-04-29', 'America/New_York');
 *
 *   // Walk a date range
 *   let cur = formatLocalDate(from, tz);
 *   while (cur <= formatLocalDate(to, tz)) {
 *     // ... use cur as the local-date key
 *     cur = addOneDay(cur);
 *   }
 *
 * All helpers handle DST transitions correctly by sampling tz offset at
 * noon on the target day (safely inside the day in any tz, even when the
 * day starts/ends on a DST boundary).
 */

/** Format a Date as YYYY-MM-DD using the given IANA timezone. */
export function formatLocalDate(d: Date, tz: string): string {
  // 'en-CA' produces YYYY-MM-DD which is exactly what we want.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const obj: Record<string, string> = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
}

/**
 * UTC instant for local midnight on `dateStr` in `tz`.
 *
 * E.g. `localDayStartUTC('2026-04-23', 'America/New_York')` (in EDT)
 * returns `2026-04-23 04:00 UTC`.
 *
 * Algorithm: given the desired local datetime W ("dateStr 00:00:00"), find
 * the UTC instant X such that formatting X in tz produces W. Solve by
 * iteration:
 *
 *   1. Start with X0 = "treat W as UTC fields"
 *   2. Format X0 in tz; get wall-clock W0
 *   3. Adjust X1 = X0 + (W - W0)   (close the gap)
 *   4. Re-format; if W1 === W, done. Else iterate (2 steps suffice in practice).
 *
 * This handles DST correctly because each iteration uses the offset that
 * applies AT the candidate instant, not at some arbitrary same-day sample.
 *
 * The previous (pre-2025) implementation sampled the tz offset at noon UTC
 * of the target date. On DST-transition days the noon offset is the
 * POST-transition offset, but midnight is BEFORE the transition — so the
 * function returned a UTC instant that was 1 hour too early (spring-forward)
 * or 1 hour too late (fall-back). Closed-interval queries
 * `BETWEEN start AND end` on those days then either over-included 1 hour
 * of the next day (spring-forward) or under-included 1 hour of the same
 * day (fall-back).
 */
export function localDayStartUTC(dateStr: string, tz: string): Date {
  if (tz === 'UTC') {
    // Fast path: dateStr midnight UTC.
    return new Date(`${dateStr}T00:00:00.000Z`);
  }
  const [yr, mo, dy] = dateStr.split('-').map(Number);
  const wantWallAsIfUTC = Date.UTC(yr as number, (mo as number) - 1, dy as number, 0, 0, 0);

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  // Iterate. Start with X0 = wall-clock-as-if-UTC; converges in ≤2 steps for
  // any IANA tz / date combination (verified across DST transitions in
  // America/New_York, America/Chicago, America/Los_Angeles, Europe/London,
  // Australia/Sydney, Pacific/Auckland).
  let candidate = new Date(wantWallAsIfUTC);
  for (let i = 0; i < 3; i++) {
    const parts: Record<string, string> = Object.fromEntries(
      fmt.formatToParts(candidate).map((p) => [p.type, p.value]),
    );
    const wallAsIfUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    const diff = wantWallAsIfUTC - wallAsIfUTC;
    if (diff === 0) return candidate;
    candidate = new Date(candidate.getTime() + diff);
  }
  // Should never reach here for valid inputs. Return best guess.
  return candidate;
}

/**
 * UTC instant for local 23:59:59.999 on `dateStr` in `tz`.
 *
 * IMPORTANT — DST: a local day is NOT always 24 hours. On spring-forward
 * it's 23 hours (clock skips an hour); on fall-back it's 25 hours (clock
 * repeats an hour). Computing `start + 24h - 1ms` would either:
 *   - over-include 1 hour of the NEXT day on spring-forward (e.g. on Mar 9
 *     in America/New_York, 04:30 UTC Mar 10 = 00:30 EDT Mar 10 = next day
 *     local — but `start + 24h - 1ms` = 04:59 UTC Mar 10 = sweeps it in)
 *   - under-include 1 hour of the SAME day on fall-back (e.g. on Nov 2,
 *     local day actually ends at 05:00 UTC Nov 3 because EST kicks in,
 *     but `start + 24h - 1ms` = 04:59 UTC Nov 3 = misses the last hour)
 *
 * Correct behavior: end = start_of_next_local_day - 1ms. This naturally
 * accounts for the DST shift because both `localDayStartUTC` calls
 * resample the offset for their respective dates.
 */
export function localDayEndUTC(dateStr: string, tz: string): Date {
  const nextStart = localDayStartUTC(addOneDay(dateStr), tz);
  return new Date(nextStart.getTime() - 1);
}

/** Add 1 day to a YYYY-MM-DD string. Handles month/year rollover. */
export function addOneDay(dateStr: string): string {
  return addDays(dateStr, 1);
}

/**
 * Add N days (positive or negative) to a YYYY-MM-DD string. Handles month/
 * year rollover and is agnostic of timezone/DST (date-string arithmetic only).
 */
export function addDays(dateStr: string, n: number): string {
  const [yr, mo, dy] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(yr as number, (mo as number) - 1, (dy as number) + n));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Resolve a store's IANA timezone, falling back to 'UTC' when the store
 * has no timezone set OR when no storeId is supplied. Cached per-process
 * for 5 minutes to avoid hammering the DB on every report request.
 *
 * Use this anywhere a report needs to bucket transactions by store-local
 * day. Pair with `formatLocalDate(tx.createdAt, tz)` for per-row bucketing
 * or `localDayStartUTC(dateStr, tz)` / `localDayEndUTC(dateStr, tz)` for
 * range query bookends.
 */
const _tzCache = new Map<string, { tz: string; expiresAt: number }>();
const _TZ_CACHE_TTL_MS = 5 * 60 * 1000;

export async function getStoreTimezone(
  storeId: string | null | undefined,
  prismaClient: { store: { findUnique: (args: unknown) => Promise<{ timezone?: string | null } | null> } },
): Promise<string> {
  if (!storeId) return 'UTC';
  const now = Date.now();
  const cached = _tzCache.get(storeId);
  if (cached && cached.expiresAt > now) return cached.tz;
  const store = await prismaClient.store.findUnique({
    where: { id: storeId },
    select: { timezone: true },
  } as unknown as Parameters<typeof prismaClient.store.findUnique>[0]);
  const tz = store?.timezone || 'UTC';
  _tzCache.set(storeId, { tz, expiresAt: now + _TZ_CACHE_TTL_MS });
  return tz;
}

/** Test-only: clear the per-store tz cache. */
export function _clearTzCache(): void {
  _tzCache.clear();
}

/**
 * Compute a UTC date window covering the last N days **in store-local time**.
 * Returns the bookend instants ready to drop into `createdAt: { gte, lte }`
 * Prisma queries, plus the YYYY-MM-DD strings for display.
 *
 * Example:
 *   const w = await getNDaysWindow(7, storeId, prisma);
 *   prisma.transaction.findMany({ where: { storeId, createdAt: { gte: w.from, lte: w.to } } });
 */
export async function getNDaysWindow(
  days: number,
  storeId: string | null | undefined,
  prismaClient: { store: { findUnique: (args: unknown) => Promise<{ timezone?: string | null } | null> } },
): Promise<{ from: Date; to: Date; fromStr: string; toStr: string; days: number; tz: string }> {
  const tz = await getStoreTimezone(storeId, prismaClient);
  const todayStr = formatLocalDate(new Date(), tz);
  const fromStr = addDays(todayStr, -(days - 1));
  return {
    from: localDayStartUTC(fromStr, tz),
    to:   localDayEndUTC(todayStr, tz),
    fromStr,
    toStr: todayStr,
    days,
    tz,
  };
}
