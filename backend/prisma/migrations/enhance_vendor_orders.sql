-- ══════════════════════════════════════════════════════════════════════════
-- Vendor Order Management Enhancement Migration
-- Adds: vendor delivery scheduling, PO approval/receiving fields,
--        cost variance tracking, backorder tracking, vendor returns
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Vendor — delivery scheduling fields ────────────────────────────────
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "orderCutoffTime" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "orderCutoffDaysBefore" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "autoOrderEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "preferredServiceLevel" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "vendorNotes" TEXT;

-- ── 2. PurchaseOrder — approval, receiving, communication fields ──────────
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "invoiceId" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "receivedById" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "receiverNotes" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "totalVariance" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "approvalRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "approvalNotes" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "sentToVendor" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "sentMethod" TEXT;

-- ── 3. PurchaseOrderItem — receiving, variance, backorder fields ──────────
ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "qtyDamaged" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "qtyReturned" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "actualUnitCost" DECIMAL(10,4);
ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "actualCaseCost" DECIMAL(10,4);
ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "costVariance" DECIMAL(10,4);
ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "varianceFlag" TEXT;
ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "backorderQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "backorderStatus" TEXT;
ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "receivedNotes" TEXT;

-- ── 4. VendorReturn table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "vendor_returns" (
  "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"           TEXT NOT NULL,
  "storeId"         TEXT NOT NULL,
  "vendorId"        INTEGER NOT NULL,
  "purchaseOrderId" TEXT,
  "returnNumber"    TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'draft',
  "reason"          TEXT NOT NULL,
  "totalAmount"     DECIMAL(10,2) NOT NULL DEFAULT 0,
  "creditReceived"  DECIMAL(10,2) NOT NULL DEFAULT 0,
  "notes"           TEXT,
  "submittedAt"     TIMESTAMP(3),
  "creditedAt"      TIMESTAMP(3),
  "createdById"     TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendor_returns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vendor_returns_returnNumber_key" ON "vendor_returns"("returnNumber");
CREATE INDEX IF NOT EXISTS "vendor_returns_orgId_storeId_status_idx" ON "vendor_returns"("orgId", "storeId", "status");
CREATE INDEX IF NOT EXISTS "vendor_returns_vendorId_idx" ON "vendor_returns"("vendorId");

DO $$ BEGIN
  ALTER TABLE "vendor_returns" ADD CONSTRAINT "vendor_returns_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "vendor_returns" ADD CONSTRAINT "vendor_returns_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. VendorReturnItem table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "vendor_return_items" (
  "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "returnId"        TEXT NOT NULL,
  "masterProductId" INTEGER NOT NULL,
  "qty"             INTEGER NOT NULL,
  "unitCost"        DECIMAL(10,4) NOT NULL,
  "lineTotal"       DECIMAL(10,2) NOT NULL,
  "reason"          TEXT NOT NULL,
  CONSTRAINT "vendor_return_items_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "vendor_return_items" ADD CONSTRAINT "vendor_return_items_returnId_fkey"
    FOREIGN KEY ("returnId") REFERENCES "vendor_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "vendor_return_items" ADD CONSTRAINT "vendor_return_items_masterProductId_fkey"
    FOREIGN KEY ("masterProductId") REFERENCES "master_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
