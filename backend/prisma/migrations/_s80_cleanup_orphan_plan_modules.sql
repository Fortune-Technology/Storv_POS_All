-- S80 — Clean up orphan plan_modules rows blocking `prisma db push`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- SAFETY ASSERTION — what this migration does and does NOT touch
-- ─────────────────────────────────────────────────────────────────────────
-- TOUCHES (write):
--   • plan_modules — junction table for SubscriptionPlan ↔ PlatformModule.
--                    Pure metadata. Repopulated idempotently by
--                    seedPlanModules.ts later in the same deploy step.
--                    Contains ZERO customer / business data.
--
-- READS ONLY (no modifications):
--   • subscription_plans  — to identify which planIds are still valid
--   • platform_modules    — to identify which moduleIds are still valid
--
-- DOES NOT TOUCH (zero modifications):
--   • organizations, users, user_orgs, user_stores, user_roles
--   • stores, store_products, master_products, departments, vendors
--   • transactions, line_items, customers, customer_balances
--   • shifts, cash_drops, cash_payouts, vendor_payments
--   • lottery_*, fuel_*, scan_data_*, coupon_*
--   • org_subscriptions  ← critical: each org's plan assignment is preserved
--   • billing_invoices, payment_*
--   • Any other table with operational, financial, or customer data
--
-- WHY it's safe to wipe orphan plan_modules rows:
--   plan_modules is the lookup table answering "does plan X include module Y?"
--   Orphan rows (planId → non-existent plan) are by definition useless —
--   they reference planIds that have already been deleted. Removing them
--   has zero functional impact. seedPlanModules.ts then rebuilds every
--   plan↔module mapping from the canonical source-of-truth in the seed file.
--
-- BLAST RADIUS if this migration ran WHEN IT SHOULD NOT:
--   • plan_modules would be temporarily empty for a few seconds
--   • seedPlanModules.ts immediately repopulates it (same deploy step)
--   • Users wouldn't see any gap — PM2 hasn't restarted yet
--   • Worst case: re-run seedPlanModules.ts manually to restore mappings
--
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  orphan_plan_count INTEGER := 0;
  orphan_module_count INTEGER := 0;
  total_before INTEGER := 0;
  total_after INTEGER := 0;
BEGIN
  -- Defensive guard: skip silently on first-deploy DBs where these tables
  -- don't exist yet (db push will create them with no rows = no orphans).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'plan_modules' AND table_schema = 'public'
  ) THEN
    RAISE NOTICE '[s80] plan_modules table missing — first deploy of S78 schema, nothing to clean.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'subscription_plans' AND table_schema = 'public'
  ) THEN
    RAISE NOTICE '[s80] subscription_plans table missing — schema mid-rollout, skipping.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'platform_modules' AND table_schema = 'public'
  ) THEN
    RAISE NOTICE '[s80] platform_modules table missing — schema mid-rollout, skipping.';
    RETURN;
  END IF;

  -- Count current state for transparency in deploy logs.
  SELECT COUNT(*) INTO total_before FROM plan_modules;

  -- Identify orphans (does NOT delete yet — just counts).
  SELECT COUNT(*) INTO orphan_plan_count FROM plan_modules
    WHERE "planId" NOT IN (SELECT id FROM subscription_plans);

  SELECT COUNT(*) INTO orphan_module_count FROM plan_modules
    WHERE "moduleId" NOT IN (SELECT id FROM platform_modules);

  RAISE NOTICE '[s80] plan_modules state before cleanup: total=%, orphan_planId=%, orphan_moduleId=%',
    total_before, orphan_plan_count, orphan_module_count;

  -- Sanity check: refuse to delete more than 50,000 rows. plan_modules is
  -- a small mapping table (3 plans × ~30 modules = ~90 rows in the canonical
  -- seed). If we're about to delete >50k rows, something is catastrophically
  -- wrong — abort and let a human investigate.
  IF (orphan_plan_count + orphan_module_count) > 50000 THEN
    RAISE EXCEPTION '[s80] ABORT — about to delete >50k orphan rows from plan_modules (planOrphans=%, moduleOrphans=%). This is far beyond expected scale; aborting for human review.',
      orphan_plan_count, orphan_module_count;
  END IF;

  -- Now do the actual cleanup. Both DELETEs are scoped to plan_modules ONLY.
  -- Neither subscription_plans nor platform_modules nor any other table is
  -- modified.
  DELETE FROM plan_modules
    WHERE "planId" NOT IN (SELECT id FROM subscription_plans);

  DELETE FROM plan_modules
    WHERE "moduleId" NOT IN (SELECT id FROM platform_modules);

  SELECT COUNT(*) INTO total_after FROM plan_modules;

  RAISE NOTICE '[s80] plan_modules cleanup complete: before=%, after=%, removed=%',
    total_before, total_after, (total_before - total_after);
  RAISE NOTICE '[s80] seedPlanModules.ts will rebuild correct plan↔module mappings idempotently.';
END $$;
