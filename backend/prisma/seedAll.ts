// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * seedAll.js — one-command seed for the entire platform.
 *
 * Auto-discovers every (org, store) in the DB (except the 'system' org)
 * and seeds Customers / Loyalty / Chat / Tasks / today-transactions into
 * each of them, so it doesn't matter which store the user logs into —
 * the dashboard, customers, lottery, chat, and tasks pages all have data.
 *
 * Steps:
 *   1. seed.js                 — core (org/store/depts/tax/deposits/products/users/lottery)
 *   2. seedRbac.js             — permissions + system roles
 *   3. seedPlanModules         — [S78] sidebar-module catalog + 3 default plans
 *                                (Starter/Growth/Enterprise) with module entitlements.
 *                                Required for /pricing page + sidebar gating.
 *   4. seedContractTemplates   — [S77] default merchant agreement template +
 *                                v1 published version.
 *   5. seedLotteryCatalog      — multi-state lottery catalog
 *   6. seedTransactions.js     — 90 days of historical POS transactions
 *   7. For every non-system store:
 *      • seedCustomers      — 15 demo customers w/ loyalty points history
 *      • seedLoyalty        — program config, earn rules, reward tiers
 *      • seedChat           — store-wide chat thread
 *      • seedTasks          — 8 representative tasks
 *   8. seedToday               — ~50 transactions TODAY for every store
 *
 * Usage:  node prisma/seedAll.js [orgId] [storeId]
 * npm:    npm run db:seed:all
 */
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const prisma = new PrismaClient();

const ORG_ID   = process.argv[2] || 'default';
const STORE_ID = process.argv[3] || 'default-store';

const PER_STORE_SEEDS = [
  'seedCustomers.ts',
  'seedLoyalty.ts',
  'seedChat.ts',
  'seedTasks.ts',
  'seedCatalogExtras.ts',  // product groups, promos, inventory, label queue
  'seedVendors.ts',        // vendors, vendor payments, purchase orders
  'seedOperations.ts',     // shifts, clock events, cash drops/payouts, audit log
  'seedIntegrations.ts',   // delivery-platform credentials
  'seedPosOps.ts',         // quick buttons, support tickets, billing, invitations
];

// Global (cross-store) seeders that run after per-store seeds
const GLOBAL_POST_SEEDS = [
  { file: 'seedExchange.ts', label: 'Storeveu Exchange: partnerships + wholesale orders' },
];

// Phase 4 TS migration: every seed file is now `.ts` and run via tsx.
// runScript() resolves the local tsx binary (same approach as productionSeeder.ts).
const CORE_STEPS = [
  { file: 'seed.ts',                  args: [ORG_ID],        label: 'core (org/store/depts/users/products/lottery)' },
  { file: 'seedRbac.ts',              args: [],              label: 'RBAC permissions + system roles' },
  // S78 — drives the marketing /pricing page + plan-based sidebar gating.
  { file: 'seedPlanModules.ts',       args: [],              label: 'sidebar modules + 3 default subscription plans (S78)' },
  // S77 — default merchant agreement template for the vendor-onboarding flow.
  { file: 'seedContractTemplates.ts', args: [],              label: 'default contract template (S77)' },
  { file: 'seedLotteryCatalog.ts',    args: [],              label: 'multi-state lottery catalog' },
  { file: 'seedTransactions.ts',      args: [],              label: '90 days of historical POS transactions' },
  { file: 'seedOrgCatalog.ts',        args: [],              label: 'clone catalog into every non-system org' },
  { file: 'seedOrgLottery.ts',        args: [],              label: 'lottery settings/games/boxes/txns per store' },
];

// Resolve local tsx binary so we don't depend on a global install.
// Same approach as productionSeeder.ts.
function resolveTsx() {
  const fs = require('fs');
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

function runScript(file, args) {
  const full = path.join(__dirname, file);
  console.log(`\n\x1b[36m▶ ${file}\x1b[0m ${args.length ? '(' + args.join(', ') + ')' : ''}`);

  // .ts files run via tsx (Phase 4 TS migration); .js or .mjs go through node.
  const isTs = file.endsWith('.ts');
  const tsxBin = isTs ? resolveTsx() : null;
  if (isTs && !tsxBin) {
    throw new Error(`tsx binary not found in node_modules/.bin — run "npm install" first.`);
  }

  const cmd  = isTs ? tsxBin! : process.execPath;
  const argv = [full, ...args];
  // shell:true on Windows for the .cmd shim; harmless on POSIX.
  const useShell = isTs && process.platform === 'win32';
  const res = spawnSync(cmd, argv, {
    stdio: 'inherit',
    env:   process.env,
    shell: useShell,
  });
  if (res.status !== 0) {
    throw new Error(`${file} exited with code ${res.status}`);
  }
}

async function main() {
  console.log(`\n🌱🌱🌱  Storeveu POS — seed:all  🌱🌱🌱\n`);
  const t0 = Date.now();

  // 1-4. Core platform seeds (org, RBAC, lottery catalog, historical txns)
  for (const step of CORE_STEPS) runScript(step.file, step.args);

  // Discover every non-system store
  const stores = await prisma.store.findMany({
    where: {
      isActive: true,
      organization: { slug: { not: 'system' } },
    },
    select: { id: true, orgId: true, name: true, organization: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\n\x1b[36m▶ Per-store seeds\x1b[0m — discovered ${stores.length} store${stores.length === 1 ? '' : 's'}`);
  for (const s of stores) {
    console.log(`\n   ↳ ${s.organization?.name || s.orgId} / ${s.name} (${s.id})`);
    for (const file of PER_STORE_SEEDS) {
      runScript(file, [s.orgId, s.id]);
    }
  }

  // Global post-seeds that need multiple stores (e.g. trading partners)
  for (const g of GLOBAL_POST_SEEDS) {
    console.log(`\n\x1b[36m▶ ${g.file}\x1b[0m — ${g.label}`);
    runScript(g.file, []);
  }

  // Today's transactions for every store (so Live Dashboard is non-zero)
  runScript('seedToday.ts', []);

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n\x1b[32m✅ seed:all complete in ${secs}s\x1b[0m`);
  console.log(`   Seeded ${stores.length} store${stores.length === 1 ? '' : 's'} across the platform.\n`);
}

main()
  .catch((e) => { console.error('\x1b[31m✗ seedAll fatal:\x1b[0m', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
