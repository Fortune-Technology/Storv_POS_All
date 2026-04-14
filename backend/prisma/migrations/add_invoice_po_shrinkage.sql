-- ══════════════════════════════════════════════════════════════════════════
-- Invoice-PO linkage + Inventory Adjustments (Shrinkage Tracking)
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Invoice — PO linkage fields ────────────────────────────────────────
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "linkedPurchaseOrderId" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "poMatchResult" JSONB;

-- ── 2. InventoryAdjustment table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_adjustments" (
  "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"           TEXT NOT NULL,
  "storeId"         TEXT NOT NULL,
  "masterProductId" INTEGER NOT NULL,
  "adjustmentQty"   INTEGER NOT NULL,
  "previousQty"     INTEGER NOT NULL DEFAULT 0,
  "newQty"          INTEGER NOT NULL DEFAULT 0,
  "reason"          TEXT NOT NULL,
  "notes"           TEXT,
  "createdById"     TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inventory_adjustments_orgId_storeId_createdAt_idx"
  ON "inventory_adjustments"("orgId", "storeId", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_adjustments_masterProductId_idx"
  ON "inventory_adjustments"("masterProductId");

DO $$ BEGIN
  ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_masterProductId_fkey"
    FOREIGN KEY ("masterProductId") REFERENCES "master_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
