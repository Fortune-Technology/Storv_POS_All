-- S80 Phase 3 — VendorOnboarding plan picker fields (additive, idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='vendor_onboardings' AND column_name='selectedPlanSlug'
  ) THEN
    ALTER TABLE "vendor_onboardings" ADD COLUMN "selectedPlanSlug" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='vendor_onboardings' AND column_name='selectedAddonKeys'
  ) THEN
    ALTER TABLE "vendor_onboardings" ADD COLUMN "selectedAddonKeys" TEXT[] NOT NULL DEFAULT '{}'::text[];
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='vendor_onboardings' AND column_name='estimatedMonthlyTotal'
  ) THEN
    ALTER TABLE "vendor_onboardings" ADD COLUMN "estimatedMonthlyTotal" NUMERIC(10, 2);
  END IF;
END $$;
