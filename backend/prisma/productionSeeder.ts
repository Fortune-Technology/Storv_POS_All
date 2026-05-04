// @ts-nocheck — Phase 4: seed scripts kept untyped for now.

/**
 * productionSeeder.ts — single-command seed for a fresh production database.
 *
 * Runs the platform-level catalog seeders sequentially in dependency order:
 *
 *   1.  seedAdmin                 superadmin user (admin@storeveu.com)
 *   2.  seedRbac                  permission catalog + 6 built-in system roles
 *   3.  seedDeptAttributes        department-attribute presets (alcohol/wine/tobacco)
 *   4.  seedVendorTemplates       3 wholesale-CSV import templates (AGNE / etc.)
 *   5.  seedTobaccoManufacturers  ITG / Altria / RJR scan-data feed catalog
 *   6.  seedUSStates              State catalog (codes + names + lottery defaults)
 *   7.  seedStateSurchargeRules   dual-pricing policy fields per state (NEEDS #6)
 *   8.  seedPricingTiers          PricingTier rows for dual-pricing surcharge
 *   9.  seedProductTours          5 narrated AI walkthroughs (add-product, etc.)
 *   10. seedLotteryCatalog        per-state scratch ticket catalog
 *   11. seedAiKnowledge           AI Assistant KB (40 articles + embeddings)
 *
 * All seeders are idempotent — safe to re-run on an already-seeded production
 * DB. seedAiKnowledge requires OPENAI_API_KEY (warning logged + step skipped
 * if absent); every other step works without external API keys.
 *
 * Dependency notes:
 *   • #7 (StateSurchargeRules) updates rows created by #6 (USStates) — must
 *     run after.
 *   • #2 (RBAC) writes UserRole rows that reference the superadmin from #1
 *     via syncUserDefaultRole — must run after.
 *   • Everything else is independent and only the listed order is preserved
 *     for predictable logs.
 *
 * Usage:
 *   cd backend
 *   npx tsx prisma/productionSeeder.ts
 *   npx tsx prisma/productionSeeder.ts --continue-on-error    # don't stop on first failure
 *   npx tsx prisma/productionSeeder.ts --dry-run              # print plan only
 *
 * Or via npm:
 *   npm run db:seed:production
 *
 * Exit codes:
 *   0  — every step succeeded (or skipped intentionally)
 *   1  — at least one step failed
 *   2  — couldn't locate the tsx binary or a seed file
 */

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ── ANSI colour helpers (graceful degrade when stdout isn't a TTY) ─────────
const tty = process.stdout.isTTY;
const c = {
  reset:  tty ? '\x1b[0m'  : '',
  bold:   tty ? '\x1b[1m'  : '',
  dim:    tty ? '\x1b[2m'  : '',
  red:    tty ? '\x1b[31m' : '',
  green:  tty ? '\x1b[32m' : '',
  yellow: tty ? '\x1b[33m' : '',
  blue:   tty ? '\x1b[34m' : '',
  cyan:   tty ? '\x1b[36m' : '',
  grey:   tty ? '\x1b[90m' : '',
};

// ── CLI flags ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const CONTINUE_ON_ERROR = args.includes('--continue-on-error');
const DRY_RUN           = args.includes('--dry-run');

// ── Seed plan ──────────────────────────────────────────────────────────────
// Each entry is a single seed file run via tsx. `requires` is a list of env
// vars that MUST be set for the step to succeed; if missing, the step is
// SKIPPED with a warning rather than failing — keeps non-AI deploys green.
const STEPS = [
  { file: 'seedAdmin.ts',                label: 'Superadmin user' },
  { file: 'seedRbac.ts',                 label: 'RBAC permissions + system roles' },
  { file: 'seedDeptAttributes.ts',       label: 'Department attribute presets' },
  { file: 'seedVendorTemplates.ts',      label: 'Vendor CSV import templates' },
  { file: 'seedTobaccoManufacturers.ts', label: 'Tobacco manufacturer catalog (Altria/RJR/ITG)' },
  { file: 'seedUSStates.ts',             label: 'US State catalog' },
  { file: 'seedStateSurchargeRules.ts',  label: 'Dual-pricing rules per state' },
  { file: 'seedPricingTiers.ts',         label: 'Dual-pricing surcharge tiers' },
  { file: 'seedProductTours.ts',         label: 'AI Assistant product tours' },
  { file: 'seedLotteryCatalog.ts',       label: 'Lottery ticket catalog' },
  { file: 'seedAiKnowledge.ts',          label: 'AI Assistant knowledge base', requires: ['OPENAI_API_KEY'] },
];

// ── Resolve `tsx` binary ───────────────────────────────────────────────────
// Use the local node_modules/.bin/tsx so we don't depend on a global install.
// `.cmd` shim is needed on Windows when spawning directly without a shell.
function resolveTsx(): string | null {
  const binDir = path.join(__dirname, '..', 'node_modules', '.bin');
  const candidates = process.platform === 'win32'
    ? ['tsx.cmd', 'tsx.CMD', 'tsx.exe', 'tsx']
    : ['tsx'];
  for (const name of candidates) {
    const full = path.join(binDir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// ── Run one step, return { ok, durationMs, reason? } ───────────────────────
function runStep(tsxBin: string, file: string): { ok: boolean; durationMs: number; reason?: string } {
  const t0 = Date.now();
  const full = path.join(__dirname, file);
  if (!fs.existsSync(full)) {
    return { ok: false, durationMs: 0, reason: `Seed file not found: ${file}` };
  }
  // shell:true on Windows lets the .cmd shim resolve correctly without us
  // having to escape the path. On macOS/Linux the binary is a symlink/executable
  // and shell:false is fine. The overhead of shell:true is irrelevant for a
  // task that takes seconds.
  const useShell = process.platform === 'win32';
  const res = spawnSync(tsxBin, [full], {
    stdio: 'inherit',
    env:   process.env,
    shell: useShell,
  });
  const durationMs = Date.now() - t0;
  if (res.error) return { ok: false, durationMs, reason: res.error.message };
  if (res.status !== 0) return { ok: false, durationMs, reason: `exit code ${res.status}` };
  return { ok: true, durationMs };
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Header / footer banners ────────────────────────────────────────────────
function banner(): void {
  const env = process.env.NODE_ENV || 'unknown';
  console.log('');
  console.log(`${c.cyan}${c.bold}╔══════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.cyan}${c.bold}║       Storeveu POS — Production Seeder                  ║${c.reset}`);
  console.log(`${c.cyan}${c.bold}╚══════════════════════════════════════════════════════════╝${c.reset}`);
  console.log(`${c.dim}  NODE_ENV: ${env}${c.reset}`);
  console.log(`${c.dim}  Plan:     ${STEPS.length} seeders, ${CONTINUE_ON_ERROR ? 'continue on error' : 'stop on first error'}${c.reset}`);
  if (DRY_RUN) console.log(`${c.yellow}  Mode:     DRY RUN — no DB writes${c.reset}`);
  console.log('');
}

function summary(results: Array<{ file: string; status: 'ok' | 'fail' | 'skip'; durationMs: number; reason?: string }>) {
  const total = results.reduce((s, r) => s + r.durationMs, 0);
  const ok    = results.filter(r => r.status === 'ok').length;
  const skip  = results.filter(r => r.status === 'skip').length;
  const fail  = results.filter(r => r.status === 'fail').length;

  console.log('');
  console.log(`${c.cyan}${c.bold}─── Summary ──────────────────────────────────────────────${c.reset}`);
  for (const r of results) {
    const icon = r.status === 'ok' ? `${c.green}✓${c.reset}` : r.status === 'skip' ? `${c.yellow}⊘${c.reset}` : `${c.red}✗${c.reset}`;
    const dur  = `${c.grey}${fmtDuration(r.durationMs).padStart(7)}${c.reset}`;
    const tag  = r.reason ? `${c.dim} (${r.reason})${c.reset}` : '';
    console.log(`  ${icon}  ${dur}  ${r.file}${tag}`);
  }
  console.log(`${c.cyan}─────────────────────────────────────────────────────────${c.reset}`);
  const totalLine = `  ${c.green}${ok} succeeded${c.reset}` +
    (skip > 0 ? `  ${c.yellow}${skip} skipped${c.reset}` : '') +
    (fail > 0 ? `  ${c.red}${fail} failed${c.reset}` : '') +
    `   ${c.dim}total ${fmtDuration(total)}${c.reset}`;
  console.log(totalLine);
  console.log('');
  return { ok, skip, fail };
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  banner();

  if (DRY_RUN) {
    for (let i = 0; i < STEPS.length; i++) {
      const s = STEPS[i];
      const num = `${i + 1}`.padStart(2);
      const requires = s.requires ? ` ${c.dim}(requires ${s.requires.join(', ')})${c.reset}` : '';
      console.log(`  ${c.dim}${num}.${c.reset} ${s.file.padEnd(34)} ${c.dim}— ${s.label}${requires}${c.reset}`);
    }
    console.log('');
    process.exit(0);
  }

  const tsxBin = resolveTsx();
  if (!tsxBin) {
    console.error(`${c.red}✗ tsx binary not found in node_modules/.bin/.${c.reset}`);
    console.error(`${c.dim}  Run \`npm install\` first.${c.reset}`);
    process.exit(2);
  }

  const results: Array<{ file: string; status: 'ok' | 'fail' | 'skip'; durationMs: number; reason?: string }> = [];

  for (let i = 0; i < STEPS.length; i++) {
    const s   = STEPS[i];
    const num = `${i + 1}/${STEPS.length}`;

    // Header for this step
    console.log('');
    console.log(`${c.cyan}${c.bold}━━━ [${num}] ${s.file} ${c.reset}${c.dim}— ${s.label}${c.reset}`);

    // Skip step if a required env var is missing
    const missing = (s.requires || []).filter(k => !process.env[k]);
    if (missing.length) {
      console.log(`${c.yellow}⊘ Skipped — missing env: ${missing.join(', ')}${c.reset}`);
      results.push({ file: s.file, status: 'skip', durationMs: 0, reason: `missing ${missing.join(', ')}` });
      continue;
    }

    const { ok, durationMs, reason } = runStep(tsxBin, s.file);
    if (ok) {
      console.log(`${c.green}✓ ${s.file} completed in ${fmtDuration(durationMs)}${c.reset}`);
      results.push({ file: s.file, status: 'ok', durationMs });
    } else {
      console.log(`${c.red}✗ ${s.file} failed (${reason}) after ${fmtDuration(durationMs)}${c.reset}`);
      results.push({ file: s.file, status: 'fail', durationMs, reason });
      if (!CONTINUE_ON_ERROR) {
        // Print summary up to the failure point so ops can see exactly where things stopped
        const { fail } = summary(results);
        console.error(`${c.red}${c.bold}Aborting — pass --continue-on-error to keep going past failures.${c.reset}`);
        process.exit(fail > 0 ? 1 : 2);
      }
    }
  }

  const { fail } = summary(results);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`${c.red}${c.bold}Fatal:${c.reset}`, e?.message || e);
  process.exit(2);
});
