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
 * Handles DST correctly by sampling the offset at noon on the target day.
 */
export function localDayStartUTC(dateStr: string, tz: string): Date {
  if (tz === 'UTC') {
    // Fast path: dateStr midnight UTC.
    return new Date(`${dateStr}T00:00:00.000Z`);
  }
  const [yr, mo, dy] = dateStr.split('-').map(Number);
  // Sample tz offset at noon on the target day (safely inside the day in any tz).
  const sample = new Date(Date.UTC(yr as number, (mo as number) - 1, dy as number, 12, 0, 0));
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = Object.fromEntries(
    fmt.formatToParts(sample).map((p) => [p.type, p.value]),
  );
  // tz offset = (wall-clock as-if-UTC) - (real UTC instant)
  const wallAsIfUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  const offsetMs = wallAsIfUTC - sample.getTime();
  // Local midnight as-if-UTC, then subtract offset to get the true UTC instant.
  const localMidnightAsIfUTC = Date.UTC(yr as number, (mo as number) - 1, dy as number, 0, 0, 0);
  return new Date(localMidnightAsIfUTC - offsetMs);
}

/** UTC instant for local 23:59:59.999 on `dateStr` in `tz`. */
export function localDayEndUTC(dateStr: string, tz: string): Date {
  return new Date(localDayStartUTC(dateStr, tz).getTime() + 24 * 3600 * 1000 - 1);
}

/** Add 1 day to a YYYY-MM-DD string. Handles month/year rollover. */
export function addOneDay(dateStr: string): string {
  const [yr, mo, dy] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(yr as number, (mo as number) - 1, (dy as number) + 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
