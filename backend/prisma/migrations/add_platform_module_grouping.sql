-- S80 Phase 3 Cleanup — grouped business-module architecture
-- Idempotent: only adds columns if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='platform_modules' AND column_name='isBusinessModule'
  ) THEN
    ALTER TABLE "platform_modules" ADD COLUMN "isBusinessModule" BOOLEAN NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='platform_modules' AND column_name='parentKey'
  ) THEN
    ALTER TABLE "platform_modules" ADD COLUMN "parentKey" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename='platform_modules' AND indexname='platform_modules_parentKey_idx'
  ) THEN
    CREATE INDEX "platform_modules_parentKey_idx" ON "platform_modules" ("parentKey");
  END IF;
END $$;
