/**
 * backfillPrimaryUpcs.js — One-time data fix for Session 1 of the Bulk
 * Import / Product Form dedup migration.
 *
 * Prior to this change, a product's primary UPC was stored on
 *   MasterProduct.upc   (single denormalized column)
 * and any alternate UPCs lived in
 *   ProductUpc          (multi-row table with isDefault flag)
 * but ProductUpc rows were only ever written for ALTERNATES. The primary
 * had no matching row, which forced two lookup paths across the code.
 *
 * Going forward, the Product Form and bulk import keep ProductUpc in sync
 * via `syncPrimaryUpc` in catalogController.js. This script backfills the
 * missing default rows for existing products so the two sources line up.
 *
 * Safe to re-run — it only creates rows that don't exist, and it won't
 * overwrite an existing default ProductUpc row.
 *
 * Run: node prisma/backfillPrimaryUpcs.js
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('[backfill] Scanning products with a primary UPC…');

  const products = await prisma.masterProduct.findMany({
    where: {
      upc: { not: null },
      deleted: false,
    },
    select: {
      id: true,
      orgId: true,
      upc: true,
      upcs: { where: { isDefault: true }, select: { id: true, upc: true } },
    },
  });

  console.log(`[backfill] Found ${products.length} products with a primary UPC.`);

  let created = 0;
  let skipped = 0;
  let mismatched = 0;
  let conflicts = 0;

  for (const p of products) {
    const primaryUpc = p.upc;
    const existingDefault = p.upcs[0];

    if (existingDefault && existingDefault.upc === primaryUpc) {
      skipped++;
      continue;
    }

    if (existingDefault && existingDefault.upc !== primaryUpc) {
      // This product's ProductUpc default points at a different barcode than
      // the MasterProduct.upc column. That's a data divergence — flag it.
      mismatched++;
      console.warn(
        `[backfill] product ${p.id} (orgId=${p.orgId}): MasterProduct.upc=${primaryUpc} ` +
        `but ProductUpc default=${existingDefault.upc}. Skipping — inspect manually.`
      );
      continue;
    }

    // No default ProductUpc yet. Check if the primary UPC already exists
    // under a different product (shouldn't happen with the MasterProduct unique
    // constraint, but defensive).
    const conflict = await prisma.productUpc.findUnique({
      where: { orgId_upc: { orgId: p.orgId, upc: primaryUpc } },
    });
    if (conflict && conflict.masterProductId !== p.id) {
      conflicts++;
      console.warn(
        `[backfill] product ${p.id}: UPC ${primaryUpc} is already in ProductUpc for ` +
        `product ${conflict.masterProductId}. Skipping — resolve manually.`
      );
      continue;
    }

    if (conflict && conflict.masterProductId === p.id) {
      // Already an alternate for this product — promote it to default.
      await prisma.productUpc.update({
        where: { id: conflict.id },
        data:  { isDefault: true, label: conflict.label || 'Primary' },
      });
    } else {
      await prisma.productUpc.create({
        data: {
          orgId: p.orgId,
          masterProductId: p.id,
          upc: primaryUpc,
          isDefault: true,
          label: 'Primary',
        },
      });
    }
    created++;
    if (created % 500 === 0) console.log(`[backfill] … created ${created} so far`);
  }

  console.log('[backfill] Summary:');
  console.log(`  created:    ${created}`);
  console.log(`  skipped:    ${skipped} (already in sync)`);
  console.log(`  mismatched: ${mismatched} (manual review)`);
  console.log(`  conflicts:  ${conflicts} (manual review)`);
}

main()
  .catch((e) => { console.error('[backfill] FAILED:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
