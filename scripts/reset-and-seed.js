/**
 * Master Reset & Seed Script
 *
 * Drops and recreates both databases, then seeds demo data.
 *
 * Usage:
 *   node scripts/reset-and-seed.js
 *
 * What it does:
 *   1. Resets POS database (prisma db push --force-reset)
 *   2. Resets Ecom database (prisma db push --force-reset)
 *   3. Seeds POS with org, store, users, departments, products
 *   4. Seeds Ecom with store, synced products, CMS pages, test customer
 *
 * WARNING: This DESTROYS all data in both databases!
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function run(cmd, cwd) {
  console.log(`\n  $ ${cmd}`);
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
  } catch (err) {
    console.error(`  ✗ Command failed: ${cmd}`);
    throw err;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  STORV — Full Database Reset & Seed          ║');
  console.log('║  WARNING: This destroys ALL existing data!   ║');
  console.log('╚══════════════════════════════════════════════╝');

  // Step 1: Reset POS database
  console.log('\n━━━ Step 1: Reset POS Database ━━━');
  run('npx prisma db push --force-reset --accept-data-loss', path.join(ROOT, 'backend'));

  // Step 2: Reset Ecom database
  console.log('\n━━━ Step 2: Reset E-Commerce Database ━━━');
  run('npx prisma db push --force-reset --accept-data-loss', path.join(ROOT, 'ecom-backend'));

  // Step 3: Seed POS data
  // Phase 4 TS migration: backend/prisma/seed.js was renamed to seed.ts.
  // Run via tsx so the new TypeScript imports resolve cleanly.
  console.log('\n━━━ Step 3: Seed POS Data ━━━');
  run('npx tsx prisma/seed.ts', path.join(ROOT, 'backend'));

  // Step 3b: Seed default contract template (S77 Phase 2)
  console.log('\n━━━ Step 3b: Seed Default Contract Template ━━━');
  run('npx tsx prisma/seedContractTemplates.ts', path.join(ROOT, 'backend'));

  // Step 3c: Seed plan ↔ module catalog (S78)
  console.log('\n━━━ Step 3c: Seed Plan Modules System ━━━');
  run('npx tsx prisma/seedPlanModules.ts', path.join(ROOT, 'backend'));

  // Step 4: Seed Ecom data (auto-detects org/store from POS database)
  // ecom-backend seed is still plain JS — keep node invocation.
  console.log('\n━━━ Step 4: Seed E-Commerce Data ━━━');
  run('node prisma/seed.js', path.join(ROOT, 'ecom-backend'));

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  ✅ Reset & Seed Complete!                    ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║                                              ║');
  console.log('║  POS Portal:   http://localhost:5173         ║');
  console.log('║  Storefront:   http://localhost:3000         ║');
  console.log('║  Ecom API:     http://localhost:5005         ║');
  console.log('║                                              ║');
  console.log('║  Portal login: (check backend seed output)   ║');
  console.log('║  Ecom login:   test@example.com / test123    ║');
  console.log('║                                              ║');
  console.log('║  Run: npm run dev                            ║');
  console.log('╚══════════════════════════════════════════════╝\n');
}

main().catch(() => process.exit(1));
