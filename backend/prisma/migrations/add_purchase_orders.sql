-- ═══════════════════════════════════════════════════════════════
-- Add Purchase Order system + extend Vendor/Product for ordering
-- Run: npx prisma db execute --file prisma/migrations/add_purchase_orders.sql --schema prisma/schema.prisma
-- ═══════════════════════════════════════════════════════════════

-- ── Extend vendors with ordering fields ─────────────────────────
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS "leadTimeDays"   INT NOT NULL DEFAULT 3;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS "minOrderAmount" NUMERIC(10,2);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS "orderFrequency" TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS "deliveryDays"   TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS "lastOrderedAt"  TIMESTAMPTZ;

-- ── Extend master_products with ordering fields ─────────────────
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "shelfLifeDays" INT;
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "serviceLevel"  TEXT NOT NULL DEFAULT 'standard';

-- ── purchase_orders ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orgId"        TEXT NOT NULL REFERENCES organizations("id"),
  "storeId"      TEXT NOT NULL,
  "vendorId"     INT NOT NULL REFERENCES vendors("id"),
  "poNumber"     TEXT NOT NULL UNIQUE,
  "status"       TEXT NOT NULL DEFAULT 'draft',

  "orderDate"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expectedDate" TIMESTAMPTZ,
  "receivedDate" TIMESTAMPTZ,

  "subtotal"     NUMERIC(10,2) NOT NULL,
  "taxTotal"     NUMERIC(10,2) NOT NULL DEFAULT 0,
  "grandTotal"   NUMERIC(10,2) NOT NULL,

  "notes"        TEXT,
  "generatedBy"  TEXT NOT NULL DEFAULT 'manual',
  "createdById"  TEXT NOT NULL,

  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_org_store_status ON purchase_orders("orgId", "storeId", "status");
CREATE INDEX IF NOT EXISTS idx_po_vendor ON purchase_orders("vendorId");

-- ── purchase_order_items ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_items (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orderId"         TEXT NOT NULL REFERENCES purchase_orders("id") ON DELETE CASCADE,
  "masterProductId" INT NOT NULL REFERENCES master_products("id"),

  "qtyOrdered"      INT NOT NULL,
  "qtyCases"        INT NOT NULL DEFAULT 0,
  "qtyReceived"     INT NOT NULL DEFAULT 0,

  "unitCost"        NUMERIC(10,4) NOT NULL,
  "caseCost"        NUMERIC(10,4) NOT NULL DEFAULT 0,
  "lineTotal"       NUMERIC(10,2) NOT NULL,

  "forecastDemand"  NUMERIC(10,2),
  "safetyStock"     NUMERIC(10,2),
  "currentOnHand"   NUMERIC(10,2),
  "avgDailySales"   NUMERIC(10,4),
  "reorderReason"   TEXT,

  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);
