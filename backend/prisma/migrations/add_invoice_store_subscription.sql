-- S80 Phase 3b — per-store invoice linkage (additive, idempotent)
DO $$
BEGIN
  -- 1. Make subscriptionId nullable on billing_invoices (was NOT NULL)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='billing_invoices'
      AND column_name='subscriptionId'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "billing_invoices" ALTER COLUMN "subscriptionId" DROP NOT NULL;
  END IF;

  -- 2. Add storeSubscriptionId column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='billing_invoices' AND column_name='storeSubscriptionId'
  ) THEN
    ALTER TABLE "billing_invoices" ADD COLUMN "storeSubscriptionId" TEXT;

    ALTER TABLE "billing_invoices"
      ADD CONSTRAINT "billing_invoices_storeSubscriptionId_fkey"
      FOREIGN KEY ("storeSubscriptionId") REFERENCES "store_subscriptions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- 3. Index for fast per-store lookup
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename='billing_invoices'
      AND indexname='billing_invoices_storeSubscriptionId_status_idx'
  ) THEN
    CREATE INDEX "billing_invoices_storeSubscriptionId_status_idx"
      ON "billing_invoices" ("storeSubscriptionId", "status");
  END IF;

  -- 4. Compound index on store_subscriptions for trial scheduler (status, currentPeriodEnd)
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename='store_subscriptions'
      AND indexname='store_subscriptions_status_currentPeriodEnd_idx'
  ) THEN
    CREATE INDEX "store_subscriptions_status_currentPeriodEnd_idx"
      ON "store_subscriptions" ("status", "currentPeriodEnd");
  END IF;
END $$;
