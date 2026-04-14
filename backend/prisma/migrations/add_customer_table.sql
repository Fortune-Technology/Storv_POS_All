-- Create Customer table if it doesn't exist
CREATE TABLE IF NOT EXISTS "Customer" (
  "id"                    TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"                 TEXT NOT NULL,
  "storeId"               TEXT,
  "name"                  TEXT,
  "firstName"             TEXT,
  "lastName"              TEXT,
  "email"                 TEXT,
  "phone"                 TEXT,
  "passwordHash"          TEXT,
  "addresses"             JSONB NOT NULL DEFAULT '[]',
  "loyaltyPoints"         INTEGER NOT NULL DEFAULT 0,
  "pointsHistory"         JSONB NOT NULL DEFAULT '[]',
  "posCustomerId"         TEXT,
  "cardNo"                TEXT,
  "discount"              DECIMAL(5,4),
  "balance"               DECIMAL(10,2),
  "balanceLimit"          DECIMAL(10,2),
  "instoreChargeEnabled"  BOOLEAN NOT NULL DEFAULT false,
  "birthDate"             TIMESTAMP(3),
  "expirationDate"        TIMESTAMP(3),
  "deleted"               BOOLEAN NOT NULL DEFAULT false,
  "posSyncedAt"           TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "Customer_orgId_storeId_deleted_idx" ON "Customer"("orgId", "storeId", "deleted");

-- Foreign key to Store (if not already exists)
DO $$ BEGIN
  ALTER TABLE "Customer" ADD CONSTRAINT "Customer_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
