-- Global Product Match — cross-store learning database
-- Run: npx prisma db execute --file prisma/migrations/add_global_match.sql --schema prisma/schema.prisma

CREATE TABLE IF NOT EXISTS global_product_matches (
  "id"                SERIAL PRIMARY KEY,
  "vendorName"        TEXT NOT NULL,
  "vendorItemCode"    TEXT NOT NULL,
  "vendorDescription" TEXT,
  "matchedUPC"        TEXT NOT NULL,
  "matchedName"       TEXT NOT NULL,
  "confirmedCount"    INT NOT NULL DEFAULT 1,
  "orgCount"          INT NOT NULL DEFAULT 1,
  "orgs"              TEXT[] NOT NULL DEFAULT '{}',
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_global_match_vendor ON global_product_matches("vendorName", "vendorItemCode");
CREATE INDEX IF NOT EXISTS idx_global_match_name ON global_product_matches("vendorName");

-- Add matchStats to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS "matchStats" JSONB;
