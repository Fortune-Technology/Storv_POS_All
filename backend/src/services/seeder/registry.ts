/**
 * Seeder Registry — S81
 *
 * Single source of truth for every seeder the production runner knows about.
 * Adding a new seeder = appending a row here. Updating an existing seeder
 * (changing what it writes) = bumping its `version` so the runner picks
 * it up again on the next boot.
 *
 * Two categories:
 *
 *   1. catalog
 *      Idempotent reference data (RBAC permissions, plan + addon catalog,
 *      department attribute presets, equipment products, contract templates,
 *      vendor templates). Re-runs every boot when the env var is on. Each
 *      successful run upserts the same execution row by (name, version).
 *      Safe to re-run any time — no customer data affected.
 *
 *   2. one_shot
 *      Mutates customer data once (grants, backfills). Runs once per
 *      (name, version). The unique constraint on `seeder_executions` is
 *      the gate. To re-run after a successful execution: bump the version
 *      number here. The runner sees no row for the new version, runs it,
 *      and records a new row. Old version rows stay in the table as audit
 *      history.
 *
 * Versioning rules of thumb:
 *
 *   • New seeder file → version: 1.
 *   • Same seeder, same effect, just bug-fixed code → keep version: 1.
 *     The catalog runner will pick up the fix on the next boot.
 *   • Same seeder, mutating customer data differently → bump version
 *     and document the change in the description.
 *
 * Each entry's `scriptPath` is relative to the backend project root and
 * gets executed as `npx tsx <path>`. Scripts must be self-contained
 * (own Prisma lifecycle) — the runner spawns them as subprocesses so a
 * failure in one cannot cascade or leak state into another.
 */

export type SeederCategory = 'catalog' | 'one_shot';

export interface SeederTask {
  /** Stable identifier — never change this once a row exists in the DB. */
  name: string;
  /** Bump to force a re-run for one-shot tasks. */
  version: number;
  category: SeederCategory;
  /** One-line summary shown in logs. */
  description: string;
  /** Path to the seeder script, relative to backend/. */
  scriptPath: string;
  /** When true, a non-zero exit aborts the whole runner. Default: false. */
  required?: boolean;
}

export const SEEDER_REGISTRY: SeederTask[] = [
  // ── Catalog: idempotent reference data — runs every boot when enabled. ──
  {
    name: 'rbac',
    version: 1,
    category: 'catalog',
    description: 'RBAC permissions catalog + system roles + user role sync',
    scriptPath: 'prisma/seedRbac.ts',
    required: true, // login + permission checks need this
  },
  {
    name: 'planModules',
    version: 1,
    category: 'catalog',
    description: 'PlatformModule + SubscriptionPlan + PlanAddon + PlanModule mappings',
    scriptPath: 'prisma/seedPlanModules.ts',
    required: true, // module gating + billing depend on this
  },
  {
    name: 'deptAttributes',
    version: 1,
    category: 'catalog',
    description: 'Department attribute presets (alcohol, tobacco, beer, liquor)',
    scriptPath: 'prisma/seedDeptAttributes.ts',
  },
  {
    name: 'vendorTemplates',
    version: 1,
    category: 'catalog',
    description: 'Vendor import templates (AGNE / Sante POS / Pine State)',
    scriptPath: 'prisma/seedVendorTemplates.ts',
  },
  {
    name: 'contractTemplates',
    version: 1,
    category: 'catalog',
    description: 'Default Merchant Services Agreement template + merge fields',
    scriptPath: 'prisma/seedContractTemplates.ts',
  },
  {
    name: 'equipment',
    version: 1,
    category: 'catalog',
    description: 'Equipment product catalog (POS terminal, printer, drawer, etc.)',
    scriptPath: 'prisma/seedEquipment.ts',
  },
  {
    name: 'pricingTiers',
    version: 1,
    category: 'catalog',
    description: 'Payment processing pricing tiers (Standard / Volume / Enterprise / Custom)',
    scriptPath: 'prisma/seedPricingTiers.ts',
  },
  {
    name: 'usStates',
    version: 1,
    category: 'catalog',
    description: 'US states catalog (tax rates, alcohol/tobacco age limits, deposit rules)',
    scriptPath: 'prisma/seedUSStates.ts',
  },

  // ── One-shot: mutates customer data, gated by (name, version). ──
  {
    name: 'backfillPrimaryUpcs',
    version: 1,
    category: 'one_shot',
    description: 'Sync MasterProduct.upc → ProductUpc default rows for legacy products',
    scriptPath: 'prisma/backfillPrimaryUpcs.ts',
  },
  {
    name: 'grantEnterpriseToExistingOrgs',
    version: 1,
    category: 'one_shot',
    description: 'Grant Enterprise plan to every active org (legacy plan-gating rollout)',
    scriptPath: 'prisma/grantEnterpriseToExistingOrgs.ts',
  },
  {
    name: 'grantProToExistingStores',
    version: 1,
    category: 'one_shot',
    description: 'Grant Pro StoreSubscription to every active store (S81 access policy)',
    scriptPath: 'prisma/grantProToExistingStores.ts',
  },
];

/**
 * Quick lookup by name for status/admin endpoints.
 */
export function findSeederTask(name: string): SeederTask | undefined {
  return SEEDER_REGISTRY.find(t => t.name === name);
}
