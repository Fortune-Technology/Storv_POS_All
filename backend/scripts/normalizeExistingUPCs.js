/**
 * normalizeExistingUPCs.js — One-time migration
 *
 * Normalizes all UPC values in MasterProduct and ProductUpc tables to EAN-13
 * (13-digit, zero-padded) format so existing data matches what the updated
 * normalizeUPC() function will produce on new saves.
 *
 * Safe to re-run — skips anything already 13 digits and already normalized.
 *
 * Run via:
 *   node scripts/normalizeExistingUPCs.js
 *
 * Add --dry-run to preview changes without writing:
 *   node scripts/normalizeExistingUPCs.js --dry-run
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { normalizeUPC } from '../src/utils/upc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma  = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

if (DRY_RUN) console.log('\n⚠️  DRY RUN — no changes will be written.\n');

async function migrateTable(label, findMany, doUpdate) {
  const records = await findMany();
  console.log(`\n📦 ${label}: ${records.length} records with UPC values`);

  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  const conflicts = [];

  for (const record of records) {
    const raw  = record.upc;
    const norm = normalizeUPC(raw);

    if (!norm) {
      skipped++;
      console.log(`  ⚠️  Skipping unparseable UPC: "${raw}" (id: ${record.id})`);
      continue;
    }

    if (norm === raw) {
      unchanged++;
      continue;
    }

    console.log(`  ${DRY_RUN ? '[DRY]' : '✏️ '} ${raw.padEnd(20)} → ${norm}  (id: ${record.id})`);

    if (!DRY_RUN) {
      try {
        await doUpdate(record.id, norm);
        updated++;
      } catch (err) {
        if (err.code === 'P2002') {
          // Unique constraint: another product already has this normalized UPC
          conflicts.push({ id: record.id, raw, norm, err: 'Duplicate — already exists' });
          console.log(`  ❌ Conflict: "${norm}" already used by another product (id: ${record.id})`);
        } else {
          throw err;
        }
      }
    } else {
      updated++;
    }
  }

  console.log(`  ✅ Updated:   ${updated}`);
  console.log(`  ⏭️  Unchanged: ${unchanged}`);
  console.log(`  ⚠️  Skipped:  ${skipped}`);
  if (conflicts.length) {
    console.log(`  ❌ Conflicts: ${conflicts.length} (manual review needed)`);
    for (const c of conflicts) {
      console.log(`     id=${c.id}  "${c.raw}" → "${c.norm}"  (${c.err})`);
    }
  }
  return { updated, unchanged, skipped, conflicts: conflicts.length };
}

async function main() {
  console.log('\n🔄 UPC Normalization Migration');
  console.log('   Normalizing all UPC values to EAN-13 (13-digit zero-padded)\n');

  // ── MasterProduct.upc ──────────────────────────────────────────────────────
  const mpStats = await migrateTable(
    'MasterProduct.upc',
    () => prisma.masterProduct.findMany({
      where: { upc: { not: null } },
      select: { id: true, upc: true },
    }),
    (id, norm) => prisma.masterProduct.update({ where: { id }, data: { upc: norm } }),
  );

  // ── ProductUpc.upc (alternate UPCs) ───────────────────────────────────────
  const puStats = await migrateTable(
    'ProductUpc.upc',
    () => prisma.productUpc.findMany({
      where: { upc: { not: null } },
      select: { id: true, upc: true },
    }),
    (id, norm) => prisma.productUpc.update({ where: { id }, data: { upc: norm } }),
  );

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalUpdated = mpStats.updated + puStats.updated;
  const totalConflicts = mpStats.conflicts + puStats.conflicts;

  console.log('\n══════════════════════════════════');
  console.log('  Migration complete');
  console.log(`  Records updated:   ${totalUpdated}`);
  console.log(`  Conflicts:         ${totalConflicts}`);
  if (DRY_RUN) console.log('  (Dry run — nothing was written)');
  if (totalConflicts > 0) {
    console.log('\n  ⚠️  Some UPCs could not be normalized due to duplicates.');
    console.log('  Review the conflicts above and resolve manually.');
  }
  console.log('══════════════════════════════════\n');
}

main()
  .catch(e => { console.error('\n❌ Migration failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
