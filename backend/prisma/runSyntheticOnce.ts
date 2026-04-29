/**
 * runSyntheticOnce.ts — manual one-shot trigger of the synthetic-data scheduler.
 *
 * Bypasses the ENABLE_SYNTHETIC_DATA gate (sets it for this process) and runs
 * a single sweep, then exits. Use to verify the scheduler end-to-end without
 * waiting for the hourly tick.
 *
 * Run: npx tsx prisma/runSyntheticOnce.ts
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Force-enable for this process before importing the scheduler module so
// the top-level `ENABLED` constant reads true.
process.env.ENABLE_SYNTHETIC_DATA = 'true';
// Lower the hour gate to 0 so it fires regardless of when this script runs.
process.env.SYNTHETIC_DATA_HOUR_UTC = '0';

const { runSyntheticSweep } = await import('../src/services/syntheticDataScheduler.js');

console.log('▶ Running synthetic-data sweep (one-shot)…');
const t0 = Date.now();
await runSyntheticSweep();
console.log(`✓ Sweep completed in ${(Date.now() - t0) / 1000}s`);
process.exit(0);
