-- ══════════════════════════════════════════════════════════════════
--  Make users.orgId nullable + re-point FK to ON DELETE SET NULL
--  (Session 34 — Phase 3 Store Ownership Transfer)
--
--  Why: after an ownership transfer, the seller's UserOrg rows for the
--  transferred org are deleted. Without this, `users.orgId` would still
--  point at the transferred org (non-null FK), so scopeToTenant's
--  home-org fallback would keep granting access.
--
--  Approach:
--    1. Drop the existing NOT NULL constraint.
--    2. Drop the existing FK (Prisma named it users_orgId_fkey).
--    3. Re-add the FK with ON DELETE SET NULL so orgless users survive
--       organisation deletion without being cascade-deleted.
--
--  Idempotent: the DROP CONSTRAINT is wrapped in a DO block so re-running
--  on a DB that already has the column nullable + the correct FK is a
--  no-op. Safe to leave in the migrations dir forever.
-- ══════════════════════════════════════════════════════════════════

-- Step 1: make column nullable
ALTER TABLE "users" ALTER COLUMN "orgId" DROP NOT NULL;

-- Step 2 & 3: drop and re-add the FK with SET NULL
DO $$
BEGIN
  -- Drop if it exists under any common Prisma naming
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_orgId_fkey'
      AND table_name = 'users'
  ) THEN
    ALTER TABLE "users" DROP CONSTRAINT "users_orgId_fkey";
  END IF;
END$$;

ALTER TABLE "users"
  ADD CONSTRAINT "users_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
