-- Add refund/void fields to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS "refundOf" TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS "voidedById" TEXT;

-- Create clock_events table
CREATE TABLE IF NOT EXISTS clock_events (
  id TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "stationId" TEXT,
  type TEXT NOT NULL,
  note TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS clock_events_org_store_user_created ON clock_events ("orgId", "storeId", "userId", "createdAt");
CREATE INDEX IF NOT EXISTS clock_events_org_store_created ON clock_events ("orgId", "storeId", "createdAt");
