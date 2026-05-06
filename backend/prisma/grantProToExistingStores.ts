// @ts-nocheck — Prisma client may not be regenerated yet at first run; we use
// raw SQL where the new schema fields aren't in the typed surface yet.
/**
 * One-shot grant: every active store gets Pro StoreSubscription.
 *
 * Why this exists:
 *   The S81 work introduced a real plan picker (admin assigns Starter / Pro at
 *   contract activation) and removed the trial concept. Going forward, NEW
 *   onboardings get exactly what admin assigns. But every customer that
 *   already exists in the database was created under the old flow:
 *     • Stores that pre-date StoreSubscription → had no per-store plan at all.
 *     • Stores created during the trial era → got `status: 'trial'` on Starter.
 *     • Stores from the Phase 3 migration block → already on Pro (untouched).
 *
 *   User policy decision (S81): every existing store/org should land on Pro
 *   regardless of which path they came in on. This script makes that true in
 *   one pass without disturbing admin-deliberate edits going forward.
 *
 * What it does:
 *   1. For every active Store, ensure a StoreSubscription exists.
 *      • Missing → create with planId=Pro, status='active'.
 *      • Present → update planId=Pro, status='active', clear trialEndsAt,
 *        clear extraAddons (Pro bundles all add-ons by default), 30-day period.
 *
 *   2. Sets the legacy Organization.plan to 'pro' for parity with any code
 *      still reading the enum field.
 *
 * Sentinel-gated:
 *   The deploy workflow guards this with a server-side sentinel file
 *   `/var/www/Storv_POS_All/.grant-pro-existing-stores-v1.done`. After it
 *   runs once successfully, subsequent deploys skip it — so admin-driven
 *   downgrades (Starter / custom) survive future deployments.
 *
 *   To force a re-run on prod (e.g. after onboarding a wave of beta
 *   customers who all need full access during a migration window):
 *     ssh prod && sudo rm /var/www/Storv_POS_All/.grant-pro-existing-stores-v1.done
 *     git push     # next deploy re-runs the script + creates fresh sentinel
 *
 * Run manually: npx tsx prisma/grantProToExistingStores.ts
 */
import prisma from '../src/config/postgres.js';

async function main() {
  console.log('🌱 grantProToExistingStores — one-shot Pro grant for existing stores\n');

  // ─── 1. Resolve the Pro plan ──────────────────────────────────────────────
  const pro = await prisma.subscriptionPlan.findUnique({
    where: { slug: 'pro' },
    select: { id: true, name: true, basePrice: true, isActive: true },
  });
  if (!pro || !pro.isActive) {
    console.error('❌ Pro plan not found or inactive. Run `seedPlanModules.ts` first.');
    process.exit(1);
  }
  console.log(`  ✓ Found plan: ${pro.name} (id=${pro.id}, basePrice=$${pro.basePrice})`);

  // ─── 2. Walk every active store ───────────────────────────────────────────
  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, orgId: true, name: true, stationCount: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`\n  Processing ${stores.length} active store(s)…`);

  const now = new Date();
  // 30-day billing window — same anchor `createStore` uses.
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

  let created = 0;
  let upgraded = 0;
  let unchanged = 0;

  for (const s of stores) {
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "planId", status FROM store_subscriptions WHERE "storeId"=$1`,
      s.id,
    );

    if (existing.length === 0) {
      // No StoreSubscription → create one on Pro.
      await prisma.$executeRawUnsafe(
        `INSERT INTO store_subscriptions (
           id, "storeId", "orgId", "planId", status,
           "trialEndsAt", "currentPeriodStart", "currentPeriodEnd",
           "registerCount", "extraAddons",
           "retryCount", "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid()::text, $1, $2, $3, 'active',
           NULL, $4, $5,
           $6, '{}'::text[],
           0, NOW(), NOW()
         )`,
        s.id, s.orgId, pro.id, now, periodEnd, s.stationCount ?? 1,
      );
      created++;
      console.log(`    + ${s.name.padEnd(40)} → created Pro sub`);
    } else {
      const sub = existing[0];
      if (sub.planId === pro.id && sub.status === 'active') {
        unchanged++;
        // Don't spam the log for already-Pro stores; tally only.
      } else {
        // Has a StoreSubscription, but on a different plan or status.
        // Flip to Pro / active, clear trialEndsAt + extraAddons (Pro bundles all).
        await prisma.$executeRawUnsafe(
          `UPDATE store_subscriptions
              SET "planId" = $1,
                  status = 'active',
                  "trialEndsAt" = NULL,
                  "extraAddons" = '{}'::text[],
                  "currentPeriodStart" = $2,
                  "currentPeriodEnd" = $3,
                  "updatedAt" = NOW()
            WHERE id = $4`,
          pro.id, now, periodEnd, sub.id,
        );
        upgraded++;
        console.log(`    ↑ ${s.name.padEnd(40)} → upgraded ${sub.planId !== pro.id ? '(plan)' : ''}${sub.status !== 'active' ? ' (status)' : ''}`);
      }
    }
  }

  console.log(`\n  ✓ ${created} created, ${upgraded} upgraded, ${unchanged} already on Pro/active`);

  // ─── 3. Sync legacy Organization.plan = 'pro' ─────────────────────────────
  // Some legacy code still reads this enum field for marketing display.
  // Set everyone to 'pro' for parity. Doesn't affect StoreSubscription gating.
  const orgUpdate = await prisma.$executeRawUnsafe(
    `UPDATE organizations
        SET plan='pro', "updatedAt"=NOW()
      WHERE plan IN ('trial', 'basic') AND "isActive"=true`,
  );
  console.log(`  ✓ Synced legacy Organization.plan='pro' on ${orgUpdate} org(s)`);

  console.log('\n✅ Pro grant complete. Existing customers now have full module access.\n');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
