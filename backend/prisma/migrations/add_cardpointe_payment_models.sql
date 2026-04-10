-- Migration: add_cardpointe_payment_models
-- Adds CardPointe merchant credentials, physical payment terminals,
-- PCI-safe payment transaction log, and per-store payment settings.

-- ─────────────────────────────────────────────────────────────────────────────
-- CARDPOINTE MERCHANTS
-- One set of credentials per Organization.
-- apiPassword is AES-256-GCM encrypted at rest.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cardpointe_merchants" (
  "id"          TEXT        NOT NULL,
  "orgId"       TEXT        NOT NULL,
  "merchId"     TEXT        NOT NULL,
  "apiUser"     TEXT        NOT NULL,
  "apiPassword" TEXT        NOT NULL,
  "site"        TEXT        NOT NULL DEFAULT 'fts',
  "baseUrl"     TEXT,
  "isLive"      BOOLEAN     NOT NULL DEFAULT FALSE,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cardpointe_merchants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cardpointe_merchants_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cardpointe_merchants_orgId_key" ON "cardpointe_merchants"("orgId");

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYMENT TERMINALS
-- Physical card readers registered per station.
-- hsn (hardware serial number) is the CardPointe Terminal API identifier.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_terminals" (
  "id"          TEXT        NOT NULL,
  "orgId"       TEXT        NOT NULL,
  "storeId"     TEXT        NOT NULL,
  "stationId"   TEXT,
  "merchantId"  TEXT        NOT NULL,
  "hsn"         TEXT        NOT NULL,
  "name"        TEXT,
  "ipAddress"   TEXT,
  "port"        INTEGER     NOT NULL DEFAULT 6443,
  "model"       TEXT,
  "status"      TEXT        NOT NULL DEFAULT 'unknown',
  "lastSeenAt"  TIMESTAMP(3),
  "lastPingMs"  INTEGER,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_terminals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_terminals_merchantId_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "cardpointe_merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "payment_terminals_stationId_fkey"
    FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_terminals_stationId_key" ON "payment_terminals"("stationId") WHERE "stationId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "payment_terminals_orgId_storeId_idx" ON "payment_terminals"("orgId", "storeId");

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYMENT TRANSACTIONS
-- PCI-safe record of every card charge/void/refund.
-- Raw PAN, CVV and full track data are NEVER stored.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_transactions" (
  "id"                 TEXT           NOT NULL,
  "orgId"              TEXT           NOT NULL,
  "storeId"            TEXT           NOT NULL,
  "terminalId"         TEXT,
  "merchantId"         TEXT           NOT NULL,
  "posTransactionId"   TEXT,

  -- CardPointe Gateway fields
  "retref"             TEXT,
  "authCode"           TEXT,
  "respCode"           TEXT,
  "respText"           TEXT,

  -- Card info (PCI-safe — no raw PAN/CVV)
  "token"              TEXT,
  "lastFour"           TEXT,
  "acctType"           TEXT,
  "expiry"             TEXT,
  "entryMode"          TEXT,

  -- Amounts
  "amount"             DECIMAL(10,2)  NOT NULL,
  "capturedAmount"     DECIMAL(10,2),

  -- Status
  "type"               TEXT           NOT NULL DEFAULT 'sale',
  "status"             TEXT           NOT NULL DEFAULT 'pending',

  -- Signature
  "signatureData"      TEXT,
  "signatureCaptured"  BOOLEAN        NOT NULL DEFAULT FALSE,

  -- Linkage
  "originalRetref"     TEXT,
  "invoiceNumber"      TEXT,
  "orderNote"          TEXT,

  "createdAt"          TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_transactions_merchantId_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "cardpointe_merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_transactions_terminalId_fkey"
    FOREIGN KEY ("terminalId") REFERENCES "payment_terminals"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_retref_key" ON "payment_transactions"("retref") WHERE "retref" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "payment_transactions_orgId_storeId_idx"    ON "payment_transactions"("orgId", "storeId");
CREATE INDEX IF NOT EXISTS "payment_transactions_posTransactionId_idx"  ON "payment_transactions"("posTransactionId");
CREATE INDEX IF NOT EXISTS "payment_transactions_retref_idx"            ON "payment_transactions"("retref");

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYMENT SETTINGS
-- Per-store configuration for card payment behaviour.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_settings" (
  "id"                 TEXT           NOT NULL,
  "orgId"              TEXT           NOT NULL,
  "storeId"            TEXT           NOT NULL,

  "signatureThreshold" DECIMAL(10,2)  NOT NULL DEFAULT 25.00,

  "tipEnabled"         BOOLEAN        NOT NULL DEFAULT FALSE,
  "tipPresets"         JSONB,

  "surchargeEnabled"   BOOLEAN        NOT NULL DEFAULT FALSE,
  "surchargePercent"   DECIMAL(5,4),

  "acceptCreditCards"  BOOLEAN        NOT NULL DEFAULT TRUE,
  "acceptDebitCards"   BOOLEAN        NOT NULL DEFAULT TRUE,
  "acceptAmex"         BOOLEAN        NOT NULL DEFAULT TRUE,
  "acceptContactless"  BOOLEAN        NOT NULL DEFAULT TRUE,

  "createdAt"          TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_settings_storeId_key" ON "payment_settings"("storeId");
CREATE INDEX IF NOT EXISTS "payment_settings_orgId_idx" ON "payment_settings"("orgId");
