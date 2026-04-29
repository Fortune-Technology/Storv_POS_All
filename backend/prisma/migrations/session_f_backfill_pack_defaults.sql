-- ─────────────────────────────────────────────────────────────────────────
-- Session F — Backfill nulls on master_products.unitPack + packInCase to 1
-- ─────────────────────────────────────────────────────────────────────────
--
-- Run BEFORE `npx prisma db push` switches the columns to NOT NULL with a
-- @default(1). Idempotent — re-running is safe.
--
-- Why: every real product is at least 1 unit / 1 pack-per-case. Null was the
-- source of the silent-zero-deposit bug — the catalog snapshot's deposit
-- math (caseDeposit ÷ packsPerCase ÷ unitPack) returned null when either
-- field was null. After this backfill + the schema default, the math always
-- resolves and the cart shows the correct deposit per pack.
--
-- For products with caseDeposit set but null packs, this migration shows
-- the cashier "loud-wrong" $1.20-per-bottle math instead of "silent-zero"
-- — the loud failure forces a manual fix; silent zero never gets noticed.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- Snapshot the count before so we can verify the change
SELECT
  COUNT(*) FILTER (WHERE "unitPack"   IS NULL) AS unitpack_nulls,
  COUNT(*) FILTER (WHERE "packInCase" IS NULL) AS packincase_nulls
FROM master_products;

UPDATE master_products
SET    "unitPack" = 1
WHERE  "unitPack" IS NULL;

UPDATE master_products
SET    "packInCase" = 1
WHERE  "packInCase" IS NULL;

-- Verify zero remain
SELECT
  COUNT(*) FILTER (WHERE "unitPack"   IS NULL) AS unitpack_nulls_after,
  COUNT(*) FILTER (WHERE "packInCase" IS NULL) AS packincase_nulls_after
FROM master_products;

COMMIT;
