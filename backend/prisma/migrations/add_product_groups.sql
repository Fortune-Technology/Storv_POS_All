-- ══════════════════════════════════════════════════════════════════════════
-- Product Groups — template/price groups for shared classification & pricing
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. ProductGroup table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "product_groups" (
  "id"                 SERIAL NOT NULL,
  "orgId"              TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "description"        TEXT,
  "color"              TEXT,

  -- Classification template
  "departmentId"       INTEGER,
  "vendorId"           INTEGER,
  "taxClass"           TEXT,
  "ageRequired"        INTEGER,
  "ebtEligible"        BOOLEAN,
  "discountEligible"   BOOLEAN,
  "taxable"            BOOLEAN,
  "depositRuleId"      INTEGER,
  "containerType"      TEXT,
  "containerVolumeOz"  DECIMAL(10,2),

  -- Size / Pack template
  "size"               TEXT,
  "sizeUnit"           TEXT,
  "pack"               INTEGER,
  "casePacks"          INTEGER,
  "sellUnitSize"       INTEGER,

  -- Pricing template
  "defaultCostPrice"   DECIMAL(10,4),
  "defaultRetailPrice" DECIMAL(10,4),
  "defaultCasePrice"   DECIMAL(10,4),

  -- Sale pricing
  "salePrice"          DECIMAL(10,4),
  "saleStart"          TIMESTAMP(3),
  "saleEnd"            TIMESTAMP(3),

  "autoSync"           BOOLEAN NOT NULL DEFAULT true,
  "active"             BOOLEAN NOT NULL DEFAULT true,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_groups_orgId_name_key" ON "product_groups"("orgId", "name");
CREATE INDEX IF NOT EXISTS "product_groups_orgId_active_idx" ON "product_groups"("orgId", "active");
CREATE INDEX IF NOT EXISTS "product_groups_orgId_departmentId_idx" ON "product_groups"("orgId", "departmentId");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_depositRuleId_fkey"
    FOREIGN KEY ("depositRuleId") REFERENCES "deposit_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. MasterProduct — add productGroupId column ────────────────────────
ALTER TABLE "master_products" ADD COLUMN IF NOT EXISTS "productGroupId" INTEGER;

CREATE INDEX IF NOT EXISTS "master_products_orgId_productGroupId_idx" ON "master_products"("orgId", "productGroupId");

DO $$ BEGIN
  ALTER TABLE "master_products" ADD CONSTRAINT "master_products_productGroupId_fkey"
    FOREIGN KEY ("productGroupId") REFERENCES "product_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
