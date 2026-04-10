-- ═══════════════════════════════════════════════════════════════
-- Fix: Drop snake_case tables, recreate with camelCase columns
-- Prisma expects column names to match schema field names exactly
-- Run: npx prisma db execute --file prisma/migrations/fix_billing_column_names.sql --schema prisma/schema.prisma
-- ═══════════════════════════════════════════════════════════════

-- Drop in reverse dependency order
DROP TABLE IF EXISTS equipment_order_items CASCADE;
DROP TABLE IF EXISTS equipment_orders CASCADE;
DROP TABLE IF EXISTS equipment_products CASCADE;
DROP TABLE IF EXISTS billing_invoices CASCADE;
DROP TABLE IF EXISTS org_subscriptions CASCADE;
DROP TABLE IF EXISTS plan_addons CASCADE;
DROP TABLE IF EXISTS subscription_plans CASCADE;

-- ── subscription_plans ───────────────────────────────────────────────────────
CREATE TABLE subscription_plans (
  "id"                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"              TEXT NOT NULL,
  "slug"              TEXT NOT NULL UNIQUE,
  "description"       TEXT,
  "basePrice"         NUMERIC(10,2) NOT NULL,
  "pricePerStore"     NUMERIC(10,2) NOT NULL DEFAULT 0,
  "pricePerRegister"  NUMERIC(10,2) NOT NULL DEFAULT 0,
  "includedStores"    INT NOT NULL DEFAULT 1,
  "includedRegisters" INT NOT NULL DEFAULT 1,
  "trialDays"         INT NOT NULL DEFAULT 14,
  "isPublic"          BOOLEAN NOT NULL DEFAULT true,
  "isActive"          BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"         INT NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── plan_addons ──────────────────────────────────────────────────────────────
CREATE TABLE plan_addons (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "planId"      TEXT NOT NULL REFERENCES subscription_plans("id") ON DELETE CASCADE,
  "key"         TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "price"       NUMERIC(10,2) NOT NULL,
  "description" TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE("planId", "key")
);

-- ── org_subscriptions ────────────────────────────────────────────────────────
CREATE TABLE org_subscriptions (
  "id"                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orgId"                TEXT NOT NULL UNIQUE REFERENCES organizations("id"),
  "planId"               TEXT NOT NULL REFERENCES subscription_plans("id"),
  "status"               TEXT NOT NULL DEFAULT 'trial',
  "trialEndsAt"          TIMESTAMPTZ,
  "currentPeriodStart"   TIMESTAMPTZ,
  "currentPeriodEnd"     TIMESTAMPTZ,
  "storeCount"           INT NOT NULL DEFAULT 1,
  "registerCount"        INT NOT NULL DEFAULT 1,
  "extraAddons"          TEXT[] NOT NULL DEFAULT '{}',
  "basePriceOverride"    NUMERIC(10,2),
  "discountType"         TEXT,
  "discountValue"        NUMERIC(10,2),
  "discountNote"         TEXT,
  "discountExpiry"       TIMESTAMPTZ,
  "paymentToken"         TEXT,
  "paymentMasked"        TEXT,
  "paymentMethod"        TEXT,
  "retryCount"           INT NOT NULL DEFAULT 0,
  "lastFailedAt"         TIMESTAMPTZ,
  "nextRetryAt"          TIMESTAMPTZ,
  "createdAt"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── billing_invoices ─────────────────────────────────────────────────────────
CREATE TABLE billing_invoices (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "invoiceNumber"  TEXT NOT NULL UNIQUE,
  "subscriptionId" TEXT NOT NULL REFERENCES org_subscriptions("id"),
  "periodStart"    TIMESTAMPTZ NOT NULL,
  "periodEnd"      TIMESTAMPTZ NOT NULL,
  "baseAmount"     NUMERIC(10,2) NOT NULL,
  "discountAmount" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "totalAmount"    NUMERIC(10,2) NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "attempts"       INT NOT NULL DEFAULT 0,
  "lastAttemptAt"  TIMESTAMPTZ,
  "paidAt"         TIMESTAMPTZ,
  "retref"         TEXT,
  "authcode"       TEXT,
  "notes"          TEXT,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_sub_status ON billing_invoices("subscriptionId", "status");

-- ── equipment_products ───────────────────────────────────────────────────────
CREATE TABLE equipment_products (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"        TEXT NOT NULL,
  "slug"        TEXT NOT NULL UNIQUE,
  "category"    TEXT NOT NULL,
  "description" TEXT,
  "price"       NUMERIC(10,2) NOT NULL,
  "images"      TEXT[] NOT NULL DEFAULT '{}',
  "specs"       JSONB,
  "stockQty"    INT NOT NULL DEFAULT 0,
  "trackStock"  BOOLEAN NOT NULL DEFAULT true,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"   INT NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── equipment_orders ─────────────────────────────────────────────────────────
CREATE TABLE equipment_orders (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orderNumber"     TEXT NOT NULL UNIQUE,
  "orgId"           TEXT,
  "customerName"    TEXT NOT NULL,
  "customerEmail"   TEXT NOT NULL,
  "customerPhone"   TEXT,
  "shippingAddress" JSONB NOT NULL,
  "subtotal"        NUMERIC(10,2) NOT NULL,
  "shipping"        NUMERIC(10,2) NOT NULL,
  "total"           NUMERIC(10,2) NOT NULL,
  "paymentToken"    TEXT,
  "retref"          TEXT,
  "authcode"        TEXT,
  "paymentStatus"   TEXT NOT NULL DEFAULT 'pending',
  "status"          TEXT NOT NULL DEFAULT 'pending',
  "trackingCarrier" TEXT,
  "trackingNumber"  TEXT,
  "notes"           TEXT,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── equipment_order_items ────────────────────────────────────────────────────
CREATE TABLE equipment_order_items (
  "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orderId"   TEXT NOT NULL REFERENCES equipment_orders("id") ON DELETE CASCADE,
  "productId" TEXT NOT NULL REFERENCES equipment_products("id"),
  "qty"       INT NOT NULL,
  "unitPrice" NUMERIC(10,2) NOT NULL,
  "lineTotal" NUMERIC(10,2) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
