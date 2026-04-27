// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * seedOrgCatalog.js — Ensures every non-system org has a baseline catalog
 * (departments + tax rules + deposit rules + products), by cloning from the
 * 'default' (Fortune Technology) org if missing.
 *
 * Idempotent: orgs that already have products are skipped.
 *
 * Run: node prisma/seedOrgCatalog.js
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const prisma = new PrismaClient();

const SOURCE_ORG = 'default';

async function cloneCatalog(targetOrgId) {
  const existingProducts = await prisma.masterProduct.count({ where: { orgId: targetOrgId, active: true } });
  if (existingProducts > 0) {
    console.log(`  ✓ org=${targetOrgId} already has ${existingProducts} products — skipping`);
    return;
  }

  // 1. Clone departments
  const srcDepts = await prisma.department.findMany({ where: { orgId: SOURCE_ORG } });
  const deptMap = {}; // sourceId → targetId
  for (const d of srcDepts) {
    const existing = await prisma.department.findFirst({ where: { orgId: targetOrgId, code: d.code } });
    let targetId;
    if (existing) {
      targetId = existing.id;
      // Backfill description from source if the existing row is missing one
      if (!existing.description && d.description) {
        await prisma.department.update({ where: { id: existing.id }, data: { description: d.description } });
      }
    } else {
      const clone = await prisma.department.create({
        data: {
          orgId: targetOrgId,
          code: d.code, name: d.name, description: d.description, taxClass: d.taxClass,
          ageRequired: d.ageRequired, ebtEligible: d.ebtEligible,
          bottleDeposit: d.bottleDeposit, sortOrder: d.sortOrder, color: d.color,
        },
      });
      targetId = clone.id;
    }
    deptMap[d.id] = targetId;
  }
  console.log(`    ↳ ${srcDepts.length} departments cloned`);

  // 2. Clone tax rules
  const srcTax = await prisma.taxRule.findMany({ where: { orgId: SOURCE_ORG } });
  let taxCreated = 0;
  for (const t of srcTax) {
    const exists = await prisma.taxRule.findFirst({ where: { orgId: targetOrgId, name: t.name } });
    if (exists) continue;
    await prisma.taxRule.create({
      data: {
        orgId: targetOrgId,
        name: t.name, description: t.description, rate: t.rate,
        appliesTo: t.appliesTo, ebtExempt: t.ebtExempt, state: t.state,
      },
    });
    taxCreated++;
  }
  console.log(`    ↳ ${taxCreated} tax rules cloned`);

  // 3. Clone deposit rules
  const srcDep = await prisma.depositRule.findMany({ where: { orgId: SOURCE_ORG } });
  const depMap = {};
  for (const d of srcDep) {
    const existing = await prisma.depositRule.findFirst({ where: { orgId: targetOrgId, name: d.name } });
    if (existing) { depMap[d.id] = existing.id; continue; }
    const clone = await prisma.depositRule.create({
      data: {
        orgId: targetOrgId,
        name: d.name, description: d.description,
        minVolumeOz: d.minVolumeOz, maxVolumeOz: d.maxVolumeOz,
        containerTypes: d.containerTypes, depositAmount: d.depositAmount, state: d.state,
      },
    });
    depMap[d.id] = clone.id;
  }
  console.log(`    ↳ ${srcDep.length} deposit rules cloned`);

  // 4. Clone products (without relations — we'll translate FK ids)
  const srcProducts = await prisma.masterProduct.findMany({
    where: { orgId: SOURCE_ORG, active: true, deleted: false },
  });

  const BATCH = 50;
  let created = 0;
  for (let i = 0; i < srcProducts.length; i += BATCH) {
    const chunk = srcProducts.slice(i, i + BATCH);
    for (const p of chunk) {
      await prisma.masterProduct.create({
        data: {
          orgId: targetOrgId,
          name: p.name, brand: p.brand, upc: p.upc, plu: p.plu, size: p.size,
          departmentId: deptMap[p.departmentId] ?? null,
          taxClass: p.taxClass, taxable: p.taxable,
          ageRequired: p.ageRequired, ebtEligible: p.ebtEligible,
          defaultRetailPrice: p.defaultRetailPrice,
          defaultCostPrice: p.defaultCostPrice,
          depositRuleId: p.depositRuleId ? depMap[p.depositRuleId] ?? null : null,
          sellUnitSize: p.sellUnitSize, byWeight: p.byWeight,
          active: true,
        },
      });
      created++;
    }
  }
  console.log(`    ↳ ${created} products cloned`);
}

export async function seedOrgCatalog() {
  console.log('\n  📦 Ensuring every non-system org has a baseline catalog...');

  const srcCount = await prisma.masterProduct.count({ where: { orgId: SOURCE_ORG, active: true } });
  if (srcCount === 0) {
    console.log(`  ⚠ Source org '${SOURCE_ORG}' has no products — run seed.js first`);
    return;
  }

  const orgs = await prisma.organization.findMany({
    where: { slug: { not: 'system' } },
    select: { id: true, slug: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const o of orgs) {
    if (o.id === SOURCE_ORG) continue;
    console.log(`\n  ↳ Cloning catalog into '${o.name}' (${o.id})`);
    await cloneCatalog(o.id);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedOrgCatalog()
    .catch((e) => { console.error('✗ seedOrgCatalog failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
