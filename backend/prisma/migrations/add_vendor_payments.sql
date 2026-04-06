-- Migration: add_vendor_payments_table
-- Adds back-office vendor payment tracking (not tied to shifts)

CREATE TABLE IF NOT EXISTS "vendor_payments" (
  "id"            TEXT             NOT NULL,
  "orgId"         TEXT             NOT NULL,
  "storeId"       TEXT,
  "vendorId"      INTEGER,
  "vendorName"    TEXT,
  "amount"        DECIMAL(10,4)    NOT NULL,
  "paymentType"   TEXT             NOT NULL DEFAULT 'expense',
  "notes"         TEXT,
  "paymentDate"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById"   TEXT             NOT NULL,
  "createdAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vendor_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vendor_payments_orgId_storeId_idx"    ON "vendor_payments"("orgId", "storeId");
CREATE INDEX IF NOT EXISTS "vendor_payments_orgId_paymentDate_idx" ON "vendor_payments"("orgId", "paymentDate");
