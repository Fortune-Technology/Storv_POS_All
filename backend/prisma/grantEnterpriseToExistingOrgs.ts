// @ts-nocheck — Same pattern as other seed files. Prisma types are dynamic
// after `db push`; tsc's strictness pegs unresolved generic params here as
// implicit-any. The runtime is correct and verified manually.
/**
 * One-shot migration — grant the Enterprise plan to every EXISTING organisation
 * so they retain full sidebar access (Lottery, Fuel, eCom, Exchange, etc.) after
 * the plan-gating rollout.
 *
 * Idempotent — safe to re-run.
 *
 * Behaviour:
 *   - For every Organization in the DB
 *   - Upsert an OrgSubscription pointing at the Enterprise plan
 *   - status='active', trial cleared, store/register counts preserved
 *
 * NEW orgs created AFTER this script runs will continue to receive whatever
 * plan is marked `isDefault: true` in seedPlanModules.ts (currently Starter).
 *
 * Usage (run once after deploy):
 *   cd backend && npx tsx prisma/grantEnterpriseToExistingOrgs.ts
 */
import prisma from '../src/config/postgres.js';

async function main(): Promise<void> {
  const enterprise = await prisma.subscriptionPlan.findUnique({
    where: { slug: 'enterprise' },
    select: { id: true, name: true, slug: true },
  });

  if (!enterprise) {
    console.error('[grantEnterprise] Enterprise plan not found. Run `npx tsx prisma/seedPlanModules.ts` first.');
    process.exit(1);
  }

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, slug: true },
  });

  console.log(`[grantEnterprise] Found ${orgs.length} organisation(s). Granting Enterprise plan to all...`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const org of orgs) {
    const existing = await prisma.orgSubscription.findUnique({
      where: { orgId: org.id },
      select: { id: true, planId: true, status: true },
    });

    if (existing && existing.planId === enterprise.id && existing.status === 'active') {
      skipped++;
      continue;
    }

    await prisma.orgSubscription.upsert({
      where: { orgId: org.id },
      create: {
        orgId: org.id,
        planId: enterprise.id,
        status: 'active',
        storeCount: 1,
        registerCount: 1,
      },
      update: {
        planId: enterprise.id,
        status: 'active',
        trialEndsAt: null,
      },
    });

    if (existing) {
      updated++;
      console.log(`  ↻ Updated  ${org.slug || org.id} (${org.name})`);
    } else {
      created++;
      console.log(`  + Created  ${org.slug || org.id} (${org.name})`);
    }
  }

  console.log(`[grantEnterprise] Done. created=${created}  updated=${updated}  already_enterprise=${skipped}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect && prisma.$disconnect());
