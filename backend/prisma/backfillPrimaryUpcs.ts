// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

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
 * Batched: Postgres prepared statements have a ~32767 bind-variable limit,
 * and loading all products + their upcs relation in one query can exceed it
 * on large catalogs. We fetch IDs first (tiny payload), then walk chunks.
 *
 * Run: node prisma/backfillPrimaryUpcs.js
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const CHUNK_SIZE = 500;

async function main() {
  console.log('[backfill] Scanning products with a primary UPC…');

  // First pass: just the minimal fields we need. No relation fetch, so the
  // response is tiny (~64 bytes/row × 10k rows = ~640 KB, well under any limit).
  const products = await prisma.masterProduct.findMany({
    where:  { upc: { not: null }, deleted: false },
    select: { id: true, orgId: true, upc: true },
    orderBy: { id: 'asc' },
  });

  console.log(`[backfill] Found ${products.length} products with a primary UPC.`);

  let created    = 0;
  let skipped    = 0;
  let mismatched = 0;
  let conflicts  = 0;
  const warnings = []; // capped at 20 to avoid log flood

  for (let i = 0; i < products.length; i += CHUNK_SIZE) {
    const chunk    = products.slice(i, i + CHUNK_SIZE);
    const chunkIds = chunk.map(p => p.id);

    // For this chunk only: existing default ProductUpc rows.
    const defaults = await prisma.productUpc.findMany({
      where:  { masterProductId: { in: chunkIds }, isDefault: true },
      select: { masterProductId: true, upc: true },
    });
    const defaultByProductId = new Map(defaults.map(d => [d.masterProductId, d]));

    for (const p of chunk) {
      const primaryUpc      = p.upc;
      const existingDefault = defaultByProductId.get(p.id);

      if (existingDefault && existingDefault.upc === primaryUpc) {
        skipped++;
        continue;
      }

      if (existingDefault && existingDefault.upc !== primaryUpc) {
        // The ProductUpc default points at a different barcode than the
        // MasterProduct.upc column — data divergence. Log and skip.
        mismatched++;
        if (warnings.length < 20) {
          warnings.push(
            `product ${p.id} (orgId=${p.orgId}): MasterProduct.upc=${primaryUpc} ` +
            `but ProductUpc default=${existingDefault.upc}`
          );
        }
        continue;
      }

      // No default yet. Check for UPC conflict across products.
      const conflict = await prisma.productUpc.findUnique({
        where:  { orgId_upc: { orgId: p.orgId, upc: primaryUpc } },
        select: { id: true, masterProductId: true, label: true },
      });

      if (conflict && conflict.masterProductId !== p.id) {
        conflicts++;
        if (warnings.length < 20) {
          warnings.push(
            `product ${p.id}: UPC ${primaryUpc} is already in ProductUpc for ` +
            `product ${conflict.masterProductId}`
          );
        }
        continue;
      }

      if (conflict && conflict.masterProductId === p.id) {
        // Already an alternate for this product — promote to default.
        await prisma.productUpc.update({
          where: { id: conflict.id },
          data:  { isDefault: true, label: conflict.label || 'Primary' },
        });
      } else {
        await prisma.productUpc.create({
          data: {
            orgId:           p.orgId,
            masterProductId: p.id,
            upc:             primaryUpc,
            isDefault:       true,
            label:           'Primary',
          },
        });
      }
      created++;
    }

    const done = Math.min(i + CHUNK_SIZE, products.length);
    if (done % 2500 === 0 || done === products.length) {
      console.log(`[backfill] Processed ${done} / ${products.length}`);
    }
  }

  console.log('[backfill] Summary:');
  console.log(`  created:    ${created}`);
  console.log(`  skipped:    ${skipped} (already in sync)`);
  console.log(`  mismatched: ${mismatched} (manual review)`);
  console.log(`  conflicts:  ${conflicts} (manual review)`);
  if (warnings.length > 0) {
    console.log(`[backfill] First ${warnings.length} warnings:`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
}

main()
  .catch((e) => { console.error('[backfill] FAILED:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
