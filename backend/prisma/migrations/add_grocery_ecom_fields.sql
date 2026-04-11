-- Add grocery/scale features + extended ecommerce fields to master_products
-- Run: npx prisma db execute --file prisma/migrations/add_grocery_ecom_fields.sql --schema prisma/schema.prisma

-- Grocery / Scale features
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "wicEligible"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "tareWeight"     NUMERIC(10,4);
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "scaleByCount"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "scalePluType"   TEXT;
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "ingredients"    TEXT;
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "nutritionFacts" TEXT;
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "certCode"       TEXT;
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "sectionId"      INT;
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "expirationDate" TIMESTAMPTZ;
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "labelFormatId"  INT;

-- E-commerce extended
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "ecomExternalId"  TEXT;
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "ecomPackWeight"  NUMERIC(10,4);
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "ecomPrice"       NUMERIC(10,4);
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "ecomSalePrice"   NUMERIC(10,4);
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "ecomOnSale"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_products ADD COLUMN IF NOT EXISTS "ecomSummary"     TEXT;
