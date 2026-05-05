/**
 * S78 — Weekly Implementation Engineer PIN rotation scheduler.
 *
 * Runs once at boot + every 60 minutes thereafter. Each tick:
 *   1. Find users with canConfigureHardware=true whose PIN was set BEFORE
 *      the most-recent Monday 00:00 UTC (or never set).
 *   2. Generate a fresh 6-digit PIN for each, encrypt + persist.
 *   3. Email the new PIN with reason='rotated'.
 *
 * The "older than last Monday" check is naturally idempotent — re-ticking
 * mid-week is a no-op for already-rotated users. A late-deployed scheduler
 * (e.g. server was down all weekend) catches up on the next tick.
 *
 * Telemetry: every tick that rotates >0 users logs to console; quiet
 * otherwise.
 */

import { rotateAllStalePins } from './service.js';
import { sendImplementationPinEmail } from '../notifications/email.js';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 60 min

let intervalHandle: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  try {
    const rotated = await rotateAllStalePins(new Date());
    if (rotated.length === 0) return;

    console.log(`[ImplementationPinScheduler] Rotated ${rotated.length} PIN(s).`);

    for (const u of rotated) {
      try {
        await sendImplementationPinEmail(u.email, u.name, u.pin, 'rotated');
      } catch (err) {
        // Email failure is non-fatal — the user can still see the PIN
        // via the admin panel ("My Implementation PIN" page).
        console.warn(
          `[ImplementationPinScheduler] Email failed for ${u.email}:`,
          (err as Error).message,
        );
      }
    }
  } catch (err) {
    console.error('[ImplementationPinScheduler] Tick failed:', (err as Error).message);
  }
}

export function startImplementationPinScheduler(): void {
  if (intervalHandle) return; // already running
  console.log('[ImplementationPinScheduler] Started — sweep every 60 min, rotates weekly on Monday 00:00 UTC.');
  // First sweep happens at boot, so a server that was down over the
  // weekend catches up immediately on restart.
  void tick();
  intervalHandle = setInterval(() => { void tick(); }, SWEEP_INTERVAL_MS);
}

/** Test hook — exposed so a smoke test can trigger one tick deterministically. */
export async function runImplementationPinSchedulerTickForTest(): Promise<void> {
  await tick();
}
