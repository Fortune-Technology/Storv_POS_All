/**
 * scanDataScheduler.ts — Nightly tobacco scan-data submission cron (Session 47).
 *
 * Runs every 15 minutes. On each tick:
 *   1. Find every Store with at least one active/certifying ScanDataEnrollment
 *   2. For each store, check if local-time hour matches the enrollment's
 *      submission window (default 02:00 store-local, settable per mfr feed)
 *   3. If we haven't already submitted for that (store × feed × today),
 *      generate + upload the file
 *   4. Failures get retried on subsequent ticks via exponential backoff
 *      (sftpService handles intra-tick retries; the next cron tick handles
 *      inter-tick retries up to nextRetryAt).
 *
 * Why every 15min and not once at 2am: covers timezone variation across
 * stores in the same org, recovers from server restarts, and gives a wider
 * window for SFTP transient outages without losing the day.
 *
 * To force a regeneration outside the cron window: use
 *   POST /api/scan-data/submissions/regenerate
 * with `{ storeId, manufacturerId?, periodStart, periodEnd }` (Session 48).
 */

import prisma from '../../config/postgres.js';
import { generateSubmission } from './generator.js';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

interface SchedulerEnrollment {
  orgId: string;
  storeId: string;
  manufacturerId: string;
  manufacturer: { code: string; submissionHour?: number | null; [extra: string]: unknown };
}

interface SchedulerStore {
  id: string;
  timezone: string | null;
  name: string;
}

/** Compute the store's local-time hour (0-23) for the current instant. */
function localHourFor(tz: string | null | undefined): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'UTC', hour: '2-digit', hour12: false,
    });
    return Number(fmt.format(new Date()));
  } catch {
    return new Date().getUTCHours();
  }
}

/** Get the local-date string ("YYYY-MM-DD") for the store's tz. Used for "yesterday" range. */
function localDate(tz: string | null | undefined, offsetDays = 0): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const now = new Date();
  if (offsetDays) now.setDate(now.getDate() + offsetDays);
  return fmt.format(now);
}

async function shouldSubmit(
  { enrollment, store }: { enrollment: SchedulerEnrollment; store: SchedulerStore },
): Promise<boolean> {
  const tz = store?.timezone || 'UTC';
  const hour = localHourFor(tz);
  const targetHour = enrollment.manufacturer?.submissionHour ?? 2;

  // Allow a 4-hour window from targetHour onwards. e.g. target=2am → window 2-6am.
  // This handles servers that miss the exact tick or had transient SFTP outages.
  const inWindow = hour >= targetHour && hour < targetHour + 4;
  if (!inWindow) return false;

  // Did we already successfully submit for this (store × feed × yesterday)?
  // periodStart for tonight's submission = yesterday-local-midnight
  const yesterday = localDate(tz, -1);
  const since = new Date(`${yesterday}T00:00:00.000Z`);
  since.setHours(since.getHours() - 12); // safety buffer

  const recentOk = await prisma.scanDataSubmission.findFirst({
    where: {
      orgId:          enrollment.orgId,
      storeId:        enrollment.storeId,
      manufacturerId: enrollment.manufacturerId,
      status:         { in: ['uploaded', 'acknowledged'] },
      createdAt:      { gte: since },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (recentOk) return false;

  // Has there been a failed submission whose nextRetryAt is in the future?
  const blockedRetry = await prisma.scanDataSubmission.findFirst({
    where: {
      orgId:          enrollment.orgId,
      storeId:        enrollment.storeId,
      manufacturerId: enrollment.manufacturerId,
      status:         'failed',
      nextRetryAt:    { gt: new Date() },
    },
  });
  if (blockedRetry) return false;

  return true;
}

async function tick(): Promise<void> {
  try {
    const enrollments = await prisma.scanDataEnrollment.findMany({
      where: { status: { in: ['active', 'certifying'] } },
      include: { manufacturer: true },
    }) as unknown as SchedulerEnrollment[];

    if (enrollments.length === 0) return;

    // Cache stores once per tick
    const storeIds = Array.from(new Set(enrollments.map((e: SchedulerEnrollment) => e.storeId)));
    const stores = await prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: { id: true, timezone: true, name: true },
    }) as unknown as SchedulerStore[];
    const storeById: Record<string, SchedulerStore> = Object.fromEntries(
      stores.map((s: SchedulerStore) => [s.id, s]),
    );

    let submitted = 0;
    let skipped = 0;
    let failed = 0;

    for (const e of enrollments) {
      const store = storeById[e.storeId];
      if (!store) continue;

      const ok = await shouldSubmit({ enrollment: e, store });
      if (!ok) { skipped++; continue; }

      const tz = store.timezone || 'UTC';
      const yesterdayStr = localDate(tz, -1);
      const periodStart = new Date(`${yesterdayStr}T00:00:00`);
      const periodEnd   = new Date(`${yesterdayStr}T23:59:59.999`);

      try {
        const r = await generateSubmission({
          orgId:          e.orgId,
          storeId:        e.storeId,
          manufacturerId: e.manufacturerId,
          periodStart, periodEnd,
          dryRun: false,
        });
        if (r.uploaded) submitted++;
        else if (r.skipped) skipped++;
        else failed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ScanDataScheduler] ${e.manufacturer.code} for ${store.name}:`, message);
        failed++;
      }
    }

    if (submitted + failed > 0) {
      console.log(`[ScanDataScheduler] tick — submitted=${submitted} skipped=${skipped} failed=${failed}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ScanDataScheduler] tick failed:', message);
  }
}

let _started = false;

export function startScanDataScheduler(): void {
  if (_started) return;
  _started = true;
  console.log(`[ScanDataScheduler] started — sweep every ${SWEEP_INTERVAL_MS / 60000}min, target submission window 02:00-06:00 store-local.`);
  // First tick after a short delay so the rest of the server boots first
  setTimeout(() => { tick().catch(() => { /* noop */ }); }, 30 * 1000);
  setInterval(() => { tick().catch(() => { /* noop */ }); }, SWEEP_INTERVAL_MS);
}
