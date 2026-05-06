/**
 * Production Seeder Runner — S81
 *
 * Orchestrates running the SEEDER_REGISTRY in order on backend boot,
 * gated by the RUN_PRODUCTION_SEEDER env var. Catalog seeders run
 * idempotently every boot; one-shot seeders run once per (name, version)
 * tracked in the `seeder_executions` table.
 *
 * Why a separate runner instead of importing each seeder's main():
 *   The existing seeder scripts each manage their own Prisma lifecycle
 *   (own client connect, own $disconnect at the end, own process.exit).
 *   Importing them would step on each other's clients. Spawning each as
 *   `npx tsx prisma/seedX.ts` keeps every seeder hermetic — a crash in
 *   one cannot leak state into the next.
 *
 * Boot policy:
 *   The runner is awaited during boot when RUN_PRODUCTION_SEEDER=true,
 *   so the server doesn't start serving traffic until catalog data is
 *   in place and any pending one-shot grants have run. Total cold-start
 *   adds ~10–30s on a fresh DB; warm boots (catalogs are no-ops, all
 *   one-shots already recorded) add ~5s.
 *
 * Failure handling:
 *   Required seeders abort the whole run on failure (RBAC + plan modules
 *   are fundamental — better to refuse to start than serve a broken
 *   platform). Non-required seeders log + continue + record the failure
 *   in seeder_executions so the next boot retries.
 *
 * Manual one-off run (without booting the server):
 *   cd backend && RUN_PRODUCTION_SEEDER=true npx tsx -e "import('./src/services/seeder/runner.js').then(m => m.runProductionSeeders())"
 */
import { spawn } from 'child_process';
import path from 'path';
import prisma from '../../config/postgres.js';
import { SEEDER_REGISTRY, type SeederTask } from './registry.js';

interface RunStats {
  ran: number;
  skipped: number;
  failed: number;
  details: Array<{ name: string; version: number; status: 'ran' | 'skipped' | 'failed'; durationMs: number; error?: string }>;
}

/**
 * Boot-time entry point. Reads RUN_PRODUCTION_SEEDER. Returns stats so the
 * caller can log a summary; never throws (errors are recorded in DB).
 */
export async function runProductionSeeders(): Promise<RunStats> {
  const stats: RunStats = { ran: 0, skipped: 0, failed: 0, details: [] };

  const enabled = process.env.RUN_PRODUCTION_SEEDER === 'true';
  if (!enabled) {
    console.log('[seeder] RUN_PRODUCTION_SEEDER is not "true" — skipping production seeder run.');
    return stats;
  }

  console.log('[seeder] ════════════════════════════════════════════════════════');
  console.log('[seeder]   RUN_PRODUCTION_SEEDER=true — starting production run');
  console.log(`[seeder]   ${SEEDER_REGISTRY.length} seeder(s) registered`);
  console.log('[seeder] ════════════════════════════════════════════════════════');

  const overallStart = Date.now();

  for (const task of SEEDER_REGISTRY) {
    // One-shot tasks: skip if a successful row already exists at this version.
    // Catalog tasks: always run (idempotent), upsert the row at the end.
    if (task.category === 'one_shot') {
      const prev = await prisma.seederExecution.findUnique({
        where: { seederName_version: { seederName: task.name, version: task.version } },
      }).catch(() => null);
      if (prev?.success) {
        console.log(`[seeder] ⊘ ${task.name}@v${task.version} (one-shot) — already ran on ${prev.runAt.toISOString()}`);
        stats.skipped++;
        stats.details.push({ name: task.name, version: task.version, status: 'skipped', durationMs: 0 });
        continue;
      }
    }

    console.log(`[seeder] ▶ ${task.name}@v${task.version} (${task.category}) — ${task.description}`);
    const start = Date.now();
    let success = false;
    let errorMsg: string | null = null;

    try {
      await runScript(task.scriptPath);
      success = true;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[seeder] ✗ ${task.name}@v${task.version} — ${errorMsg}`);
    }

    const durationMs = Date.now() - start;

    // Record execution. Catalog: upsert (newest run reflects current state).
    // One-shot: insert/update by (name, version) — successful row is the gate.
    try {
      await prisma.seederExecution.upsert({
        where: { seederName_version: { seederName: task.name, version: task.version } },
        create: {
          seederName: task.name,
          version: task.version,
          category: task.category,
          success,
          durationMs,
          errorMsg,
        },
        update: {
          runAt: new Date(),
          category: task.category,
          success,
          durationMs,
          errorMsg,
        },
      });
    } catch (recordErr) {
      // Non-fatal: log but don't abort. The seeder did its work; we just
      // failed to write the audit row.
      console.warn(`[seeder] (record write failed for ${task.name}@v${task.version}: ${(recordErr as Error).message})`);
    }

    if (success) {
      console.log(`[seeder] ✓ ${task.name}@v${task.version} (${durationMs}ms)`);
      stats.ran++;
      stats.details.push({ name: task.name, version: task.version, status: 'ran', durationMs });
    } else {
      stats.failed++;
      stats.details.push({ name: task.name, version: task.version, status: 'failed', durationMs, error: errorMsg || undefined });
      if (task.required) {
        console.error(`[seeder] ✗✗ REQUIRED seeder ${task.name} failed — aborting run.`);
        console.error('[seeder]      Server will continue starting, but the platform may be in an inconsistent state.');
        break;
      }
    }
  }

  const totalMs = Date.now() - overallStart;
  console.log('[seeder] ════════════════════════════════════════════════════════');
  console.log(`[seeder]   Run complete in ${totalMs}ms — ran=${stats.ran} skipped=${stats.skipped} failed=${stats.failed}`);
  console.log('[seeder] ════════════════════════════════════════════════════════');

  return stats;
}

/**
 * Spawn `npx tsx <scriptPath>` from the backend root and resolve when
 * it exits with code 0.
 */
function runScript(scriptPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cwd = path.resolve(process.cwd());
    const proc = spawn('npx', ['tsx', scriptPath], {
      cwd,
      stdio: 'inherit',
      shell: true,
      env: process.env,
    });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`exit code ${code}`));
    });
  });
}

/**
 * Read-only summary of every (name, version) row in seeder_executions.
 * Powers the optional admin status endpoint.
 */
export async function listSeederExecutions() {
  return prisma.seederExecution.findMany({
    orderBy: [{ seederName: 'asc' }, { version: 'desc' }],
  });
}
