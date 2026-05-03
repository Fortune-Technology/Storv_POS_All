// @ts-nocheck — Phase 4: seed scripts kept untyped for now.

/**
 * seedPricingTiers.ts — Session 50.
 *
 * Seeds the platform PricingTier catalog with 3 surcharge tiers used for
 * dual pricing. Stores reference one tier via Store.pricingTierId, OR
 * override per-store via Store.customSurchargePercent + customSurchargeFixedFee.
 *
 * Also creates a sentinel "custom" tier so any UI/code that needs a stable
 * key for the override path has a row to reference. No store should set
 * pricingTierId='custom' directly — the override fields on Store are the
 * proper signal. The sentinel row exists purely for catalog completeness.
 *
 * Idempotent — safe to re-run. Updates existing tiers in place if metadata
 * changes; doesn't touch stores' tier references.
 *
 * Run: `npx tsx prisma/seedPricingTiers.ts`
 */

import prisma from '../src/config/postgres.js';

const TIERS = [
  {
    key:               'tier_1',
    name:              'Standard — 3% + $0.30',
    description:       'Baseline tier suitable for most independent retailers. The default option presented to new dual-pricing stores.',
    surchargePercent:  3.000,
    surchargeFixedFee: 0.30,
    sortOrder:         1,
    active:            true,
    isDefault:         true,
  },
  {
    key:               'tier_2',
    name:              'Volume — 2.75% + $0.25',
    description:       'Reduced rate for stores doing more than $50K/month in card volume. Negotiated SaaS margin.',
    surchargePercent:  2.750,
    surchargeFixedFee: 0.25,
    sortOrder:         2,
    active:            true,
    isDefault:         false,
  },
  {
    key:               'tier_3',
    name:              'Enterprise — 2.5% + $0.20',
    description:       'Lowest surcharge tier reserved for multi-store enterprise accounts.',
    surchargePercent:  2.500,
    surchargeFixedFee: 0.20,
    sortOrder:         3,
    active:            true,
    isDefault:         false,
  },
  {
    key:               'custom',
    name:              'Custom (per-store override)',
    description:       'Sentinel for the per-store override path. Stores using this tier should populate customSurchargePercent + customSurchargeFixedFee on the Store row directly.',
    surchargePercent:  0.000,
    surchargeFixedFee: 0.00,
    sortOrder:         99,
    active:            false,
    isDefault:         false,
  },
];

async function main() {
  let created = 0, updated = 0;
  for (const t of TIERS) {
    const existing = await prisma.pricingTier.findUnique({ where: { key: t.key } });
    if (existing) {
      await prisma.pricingTier.update({
        where: { id: existing.id },
        data:  {
          name:              t.name,
          description:       t.description,
          surchargePercent:  t.surchargePercent,
          surchargeFixedFee: t.surchargeFixedFee,
          sortOrder:         t.sortOrder,
          active:            t.active,
          isDefault:         t.isDefault,
        },
      });
      updated++;
    } else {
      await prisma.pricingTier.create({ data: t });
      created++;
    }
  }
  console.log(`[seed] Pricing tiers: ${created} created, ${updated} updated. Default = tier_1.`);
}

main()
  .catch((err) => { console.error(err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
