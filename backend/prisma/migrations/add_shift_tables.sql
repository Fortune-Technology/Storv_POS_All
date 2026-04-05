-- Cash Drawer Shift Management
-- Run: npx prisma db push  (or apply manually)

CREATE TABLE IF NOT EXISTS "shifts" (
  "id"                   TEXT         NOT NULL PRIMARY KEY,
  "orgId"                TEXT         NOT NULL,
  "storeId"              TEXT         NOT NULL,
  "stationId"            TEXT,
  "cashierId"            TEXT         NOT NULL,
  "closedById"           TEXT,
  "status"               TEXT         NOT NULL DEFAULT 'open',
  "openedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"             TIMESTAMP(3),
  "openingAmount"        DECIMAL(10,4) NOT NULL,
  "openingDenominations" JSONB,
  "openingNote"          TEXT,
  "closingAmount"        DECIMAL(10,4),
  "closingDenominations" JSONB,
  "closingNote"          TEXT,
  "expectedAmount"       DECIMAL(10,4),
  "variance"             DECIMAL(10,4),
  "cashSales"            DECIMAL(10,4),
  "cashRefunds"          DECIMAL(10,4),
  "cashDropsTotal"       DECIMAL(10,4),
  "payoutsTotal"         DECIMAL(10,4),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "cash_drops" (
  "id"          TEXT         NOT NULL PRIMARY KEY,
  "orgId"       TEXT         NOT NULL,
  "shiftId"     TEXT         NOT NULL,
  "amount"      DECIMAL(10,4) NOT NULL,
  "note"        TEXT,
  "createdById" TEXT         NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_drops_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "cash_payouts" (
  "id"          TEXT         NOT NULL PRIMARY KEY,
  "orgId"       TEXT         NOT NULL,
  "shiftId"     TEXT         NOT NULL,
  "amount"      DECIMAL(10,4) NOT NULL,
  "recipient"   TEXT,
  "vendorId"    INTEGER,
  "payoutType"  TEXT,
  "note"        TEXT,
  "createdById" TEXT         NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_payouts_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Add new columns to existing deployments (idempotent)
ALTER TABLE "cash_payouts" ADD COLUMN IF NOT EXISTS "vendorId"   INTEGER;
ALTER TABLE "cash_payouts" ADD COLUMN IF NOT EXISTS "payoutType" TEXT;

CREATE INDEX IF NOT EXISTS "shifts_orgId_storeId_status_idx"   ON "shifts"("orgId", "storeId", "status");
CREATE INDEX IF NOT EXISTS "shifts_orgId_storeId_openedAt_idx" ON "shifts"("orgId", "storeId", "openedAt");
CREATE INDEX IF NOT EXISTS "cash_drops_orgId_shiftId_idx"      ON "cash_drops"("orgId", "shiftId");
CREATE INDEX IF NOT EXISTS "cash_payouts_orgId_shiftId_idx"    ON "cash_payouts"("orgId", "shiftId");
