-- S80 Phase 2: per-store module overrides
-- Idempotent: only adds the column if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='stores' AND column_name='featureModules'
  ) THEN
    ALTER TABLE "stores" ADD COLUMN "featureModules" JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;
