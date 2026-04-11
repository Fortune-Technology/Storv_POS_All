-- Multi-platform delivery integration (DoorDash, UberEats, Instacart, GrubHub)
-- Run: npx prisma db execute --file prisma/migrations/add_delivery_integration.sql --schema prisma/schema.prisma

-- Store integrations (credentials per store+platform)
CREATE TABLE IF NOT EXISTS store_integrations (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orgId"           TEXT NOT NULL,
  "storeId"         TEXT NOT NULL,
  "platform"        TEXT NOT NULL,
  "credentials"     JSONB NOT NULL DEFAULT '{}',
  "config"          JSONB NOT NULL DEFAULT '{}',
  "inventoryConfig" JSONB NOT NULL DEFAULT '{}',
  "status"          TEXT NOT NULL DEFAULT 'inactive',
  "storeName"       TEXT,
  "lastSyncAt"      TIMESTAMPTZ,
  "lastError"       TEXT,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_integration_unique ON store_integrations("storeId", "platform");
CREATE INDEX IF NOT EXISTS idx_store_integration_org ON store_integrations("orgId", "status");

-- Platform orders (delivery orders from all platforms)
CREATE TABLE IF NOT EXISTS platform_orders (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orgId"           TEXT NOT NULL,
  "storeId"         TEXT NOT NULL,
  "platform"        TEXT NOT NULL,
  "platformOrderId" TEXT NOT NULL,
  "shortCode"       TEXT,
  "status"          TEXT NOT NULL DEFAULT 'new',
  "fulfillmentType" TEXT,
  "items"           JSONB NOT NULL DEFAULT '[]',
  "customerName"    TEXT,
  "customerPhone"   TEXT,
  "subtotal"        NUMERIC(10,2) NOT NULL DEFAULT 0,
  "tax"             NUMERIC(10,2) NOT NULL DEFAULT 0,
  "deliveryFee"     NUMERIC(10,2) NOT NULL DEFAULT 0,
  "tip"             NUMERIC(10,2) NOT NULL DEFAULT 0,
  "grandTotal"      NUMERIC(10,2) NOT NULL DEFAULT 0,
  "estimatedPickup" TIMESTAMPTZ,
  "confirmedAt"     TIMESTAMPTZ,
  "readyAt"         TIMESTAMPTZ,
  "pickedUpAt"      TIMESTAMPTZ,
  "deliveredAt"     TIMESTAMPTZ,
  "cancelledAt"     TIMESTAMPTZ,
  "cancelReason"    TEXT,
  "dasherStatus"    TEXT,
  "webhookData"     JSONB,
  "notes"           TEXT,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_order_unique ON platform_orders("platform", "platformOrderId");
CREATE INDEX IF NOT EXISTS idx_platform_order_store ON platform_orders("orgId", "storeId", "status");
CREATE INDEX IF NOT EXISTS idx_platform_order_date ON platform_orders("orgId", "platform", "createdAt");
