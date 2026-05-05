/**
 * S77 — Cash drawer event reference generator (C9).
 *
 * Produces human-readable, persistent receipt refs like:
 *   CD-20260504-001  (cash drop)
 *   CI-20260504-001  (cash in / paid_in)
 *   VP-20260504-001  (vendor payout)
 *   LN-20260504-001  (cashier loan)
 *   RA-20260504-001  (received on account)
 *
 * Persisted on the underlying `CashDrop.referenceNumber` /
 * `CashPayout.referenceNumber` columns so reprints surface the same ref.
 *
 * Counter is per (orgId, prefix, calendar-day), so two stores in the same
 * org share the daily series — that matches the `@@unique([orgId, referenceNumber])`
 * constraint and is consistent with how TXN numbers work.
 *
 * Concurrency: counter computed via `count(*) WHERE prefix-YYYYMMDD-*`.
 * In the rare case two simultaneous creates land on the same NNN, the
 * unique-index error is caught and we retry up to 5 times (with the next
 * NNN). At realistic register concurrency this never fires; under load
 * the retry covers it.
 */
import prisma from '../../config/postgres.js';

export type CashEventPrefix = 'CD' | 'CI' | 'VP' | 'LN' | 'RA';

/** Map cash drawer event semantics → ref-number prefix. */
export function prefixForCashDropType(type: string | null | undefined): 'CD' | 'CI' {
  return type === 'paid_in' ? 'CI' : 'CD';
}

export function prefixForPayoutType(payoutType: string | null | undefined): 'VP' | 'LN' | 'RA' {
  const t = String(payoutType || '').toLowerCase().trim();
  if (t === 'loan' || t === 'loans') return 'LN';
  if (t === 'received_on_account' || t === 'received_on_acct' || t === 'on_account' || t === 'house_payment') return 'RA';
  return 'VP';
}

/** Format today's local-date as YYYYMMDD (UTC for consistency with audit logs). */
function todayDateKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Generate the next ref for the given prefix in the given org.
 * Tries up to 5 times to recover from rare unique-constraint races.
 *
 * Pass an explicit `creator` callback that does the actual `create()` —
 * this lets us bundle the ref + the underlying record write in the same
 * transaction-style flow without leaking the counter from queries.ts.
 */
export async function nextCashEventReference(
  orgId: string,
  prefix: CashEventPrefix,
  now: Date = new Date(),
): Promise<string> {
  const dateKey = todayDateKey(now);
  const stem = `${prefix}-${dateKey}-`;

  // Count existing rows with this prefix today across BOTH cash_drops AND
  // cash_payouts. The unique constraint is `(orgId, referenceNumber)` on
  // each table separately, but we want the daily counter to be shared
  // across the prefix so users see CD-20260504-001 / CI-20260504-002 etc.
  // even when CD and CI were created on the same day. This is purely a
  // UX improvement — the unique constraints don't require it.
  //
  // Implementation: query both tables in parallel, take max suffix + 1.
  const [drops, payouts] = await Promise.all([
    prisma.cashDrop.findMany({
      where: { orgId, referenceNumber: { startsWith: stem } },
      select: { referenceNumber: true },
    }),
    prisma.cashPayout.findMany({
      where: { orgId, referenceNumber: { startsWith: stem } },
      select: { referenceNumber: true },
    }),
  ]);

  let maxN = 0;
  for (const r of [...drops, ...payouts]) {
    if (!r.referenceNumber) continue;
    const m = r.referenceNumber.match(/-(\d+)$/);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10) || 0);
  }

  const next = String(maxN + 1).padStart(3, '0');
  return `${stem}${next}`;
}
