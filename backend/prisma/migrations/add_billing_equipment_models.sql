-- ═══════════════════════════════════════════════════════════════
-- Billing & Equipment tables — Release 3
-- Run: npx prisma db execute --file prisma/migrations/add_billing_equipment_models.sql --schema prisma/schema.prisma
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS subscription_plans (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  description         TEXT,
  base_price          NUMERIC(10,2) NOT NULL,
  price_per_store     NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_per_register  NUMERIC(10,2) NOT NULL DEFAULT 0,
  included_stores     INT NOT NULL DEFAULT 1,
  included_registers  INT NOT NULL DEFAULT 1,
  trial_days          INT NOT NULL DEFAULT 14,
  is_public           BOOLEAN NOT NULL DEFAULT true,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  sort_order          INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_addons (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plan_id     TEXT NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  price       NUMERIC(10,2) NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(plan_id, key)
);

CREATE TABLE IF NOT EXISTS org_subscriptions (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id                  TEXT NOT NULL UNIQUE REFERENCES organizations(id),
  plan_id                 TEXT NOT NULL REFERENCES subscription_plans(id),
  status                  TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at           TIMESTAMPTZ,
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  store_count             INT NOT NULL DEFAULT 1,
  register_count          INT NOT NULL DEFAULT 1,
  extra_addons            TEXT[] NOT NULL DEFAULT '{}',
  base_price_override     NUMERIC(10,2),
  discount_type           TEXT,
  discount_value          NUMERIC(10,2),
  discount_note           TEXT,
  discount_expiry         TIMESTAMPTZ,
  payment_token           TEXT,
  payment_masked          TEXT,
  payment_method          TEXT,
  retry_count             INT NOT NULL DEFAULT 0,
  last_failed_at          TIMESTAMPTZ,
  next_retry_at           TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_number  TEXT NOT NULL UNIQUE,
  subscription_id TEXT NOT NULL REFERENCES org_subscriptions(id),
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  base_amount     NUMERIC(10,2) NOT NULL,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(10,2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  retref          TEXT,
  authcode        TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_sub_status ON billing_invoices(subscription_id, status);

CREATE TABLE IF NOT EXISTS equipment_products (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL,
  description TEXT,
  price       NUMERIC(10,2) NOT NULL,
  images      TEXT[] NOT NULL DEFAULT '{}',
  specs       JSONB,
  stock_qty   INT NOT NULL DEFAULT 0,
  track_stock BOOLEAN NOT NULL DEFAULT true,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipment_orders (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_number     TEXT NOT NULL UNIQUE,
  org_id           TEXT,
  customer_name    TEXT NOT NULL,
  customer_email   TEXT NOT NULL,
  customer_phone   TEXT,
  shipping_address JSONB NOT NULL,
  subtotal         NUMERIC(10,2) NOT NULL,
  shipping         NUMERIC(10,2) NOT NULL,
  total            NUMERIC(10,2) NOT NULL,
  payment_token    TEXT,
  retref           TEXT,
  authcode         TEXT,
  payment_status   TEXT NOT NULL DEFAULT 'pending',
  status           TEXT NOT NULL DEFAULT 'pending',
  tracking_carrier TEXT,
  tracking_number  TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipment_order_items (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id    TEXT NOT NULL REFERENCES equipment_orders(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES equipment_products(id),
  qty         INT NOT NULL,
  unit_price  NUMERIC(10,2) NOT NULL,
  line_total  NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
