/**
 * loyaltyScheduler.ts
 *
 * Daily sweep that handles two automated loyalty effects:
 *
 *   1. Birthday bonus  — for any customer whose birthDate's month/day matches
 *      today (UTC), award `LoyaltyProgram.birthdayBonus` points. Idempotent
 *      per calendar year (loyaltyService.awardBirthdayBonus checks
 *      pointsHistory for an existing 'birthday_bonus' entry this year).
 *
 *   2. Points expiry    — for any customer in an org whose program has
 *      `expiryDays > 0`, expire earned points older than the cutoff.
 *      Idempotent — only counts earns since the last 'expired' entry.
 *
 * Cadence: every 6 hours. Two reasons we don't use a strict midnight cron:
 *   - Stores span timezones; "midnight" is ambiguous.
 *   - If the server is down at 00:00 UTC we'd miss the day's birthdays.
 *     A 6-hour sweep catches up within a quarter day at worst.
 *
 * Both helpers are idempotent so re-firing does no harm.
 */

import prisma from '../config/postgres.js';
import { awardBirthdayBonus, expireCustomerPoints, type CustomerForLoyalty } from './loyaltyService.js';

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;  // 6 hours
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

interface BirthdayCandidate extends CustomerForLoyalty {
  orgId: string;
  birthDate: Date | null;
}

async function sweep(): Promise<void> {
  if (running) return;
  running = true;
  const start = Date.now();
  let birthdays = 0;
  let expiredCustomers = 0;
  let expiredPoints = 0;

  try {
    // ── Birthday bonuses ───────────────────────────────────────────────
    const now = new Date();
    const todayMonth = now.getUTCMonth() + 1;
    const todayDay   = now.getUTCDate();

    // Pull customers with a birthDate whose month/day matches today.
    // Postgres EXTRACT() gives us indexable month/day matching without
    // pulling every customer into memory. We use a raw query because Prisma
    // doesn't expose EXTRACT in its DSL.
    const candidates = await prisma.$queryRaw<BirthdayCandidate[]>`
      SELECT id, "orgId", "storeId", "loyaltyPoints", "pointsHistory", "birthDate"
      FROM customers
      WHERE deleted = false
        AND "birthDate" IS NOT NULL
        AND EXTRACT(MONTH FROM "birthDate") = ${todayMonth}
        AND EXTRACT(DAY   FROM "birthDate") = ${todayDay}
    `;

    for (const c of candidates) {
      try {
        const awarded = await awardBirthdayBonus({ orgId: c.orgId, customer: c });
        if (awarded > 0) birthdays++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[LoyaltyScheduler] birthday error for customer ${c.id}:`, message);
      }
    }

    // ── Expiry ─────────────────────────────────────────────────────────
    // Find every program that has expiryDays > 0; for each, sweep its
    // store's customers. We iterate program-by-program so we only load
    // customers that could possibly have expirable points.
    const programs = await prisma.loyaltyProgram.findMany({
      where: { enabled: true, expiryDays: { gt: 0 } },
      select: { storeId: true, orgId: true, expiryDays: true },
    });

    for (const p of programs) {
      const customers = await prisma.customer.findMany({
        where: {
          orgId:   p.orgId,
          storeId: p.storeId,
          deleted: false,
          loyaltyPoints: { gt: 0 },
        },
        select: { id: true, loyaltyPoints: true, pointsHistory: true },
      });

      for (const c of customers) {
        try {
          const lapsed = await expireCustomerPoints({
            orgId: p.orgId,
            customer: c,
            expiryDays: p.expiryDays,
          });
          if (lapsed > 0) {
            expiredCustomers++;
            expiredPoints += lapsed;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[LoyaltyScheduler] expiry error for customer ${c.id}:`, message);
        }
      }
    }

    const elapsed = Date.now() - start;
    if (birthdays > 0 || expiredPoints > 0) {
      console.log(
        `[LoyaltyScheduler] sweep complete in ${elapsed}ms — ` +
        `birthdays=${birthdays}, expiredCustomers=${expiredCustomers}, expiredPoints=${expiredPoints}`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[LoyaltyScheduler] fatal sweep error:', message);
  } finally {
    running = false;
  }
}

export function startLoyaltyScheduler(): void {
  if (timer) return;
  // First sweep: 60s after boot so we don't compete with startup work.
  setTimeout(() => { sweep(); }, 60_000);
  timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  console.log(`[LoyaltyScheduler] started — sweeping every ${SWEEP_INTERVAL_MS / 60000} minutes`);
}

export function stopLoyaltyScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

// Exported for tests / one-off manual invocations
export { sweep as runLoyaltySweepNow };
