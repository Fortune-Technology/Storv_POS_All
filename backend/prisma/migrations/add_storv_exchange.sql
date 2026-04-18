-- ══════════════════════════════════════════════════════════════════
--  Storv Exchange  —  B2B wholesale between stores
--
--  Creates:
--    • stores.storeCode + stores.storeCodeLockedAt (new columns)
--    • trading_partners          — two-party handshake
--    • wholesale_orders          — draft → sent → confirmed state machine
--    • wholesale_order_items     — line items with product snapshot JSON
--    • wholesale_order_events    — immutable audit log
--    • partner_balances          — canonicalized net balance per pair
--    • partner_ledger_entries    — immutable balance-change log
--    • partner_settlements       — recorded payments with 7-day dispute window
--
--  Safe to re-run: uses IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Add columns to stores ─────────────────────────────────────
ALTER TABLE "stores"
  ADD COLUMN IF NOT EXISTS "storeCode"         TEXT,
  ADD COLUMN IF NOT EXISTS "storeCodeLockedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "stores_storeCode_key"  ON "stores" ("storeCode");
CREATE INDEX        IF NOT EXISTS "stores_storeCode_idx"  ON "stores" ("storeCode");

-- ── 2. trading_partners ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "trading_partners" (
  "id"               TEXT         NOT NULL,
  "requesterStoreId" TEXT         NOT NULL,
  "requesterOrgId"   TEXT         NOT NULL,
  "partnerStoreId"   TEXT         NOT NULL,
  "partnerOrgId"     TEXT         NOT NULL,
  "status"           TEXT         NOT NULL DEFAULT 'pending',
  "requestNote"      TEXT,
  "requestedById"    TEXT         NOT NULL,
  "respondedById"    TEXT,
  "respondedAt"      TIMESTAMP(3),
  "revokedAt"        TIMESTAMP(3),
  "revokedById"      TEXT,
  "revokeReason"     TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trading_partners_pkey"                    PRIMARY KEY ("id"),
  CONSTRAINT "trading_partners_requesterStoreId_fkey"   FOREIGN KEY ("requesterStoreId") REFERENCES "stores"("id") ON DELETE CASCADE,
  CONSTRAINT "trading_partners_partnerStoreId_fkey"     FOREIGN KEY ("partnerStoreId")   REFERENCES "stores"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "trading_partners_pair_key"
  ON "trading_partners" ("requesterStoreId", "partnerStoreId");
CREATE INDEX IF NOT EXISTS "trading_partners_partnerStoreId_status_idx"   ON "trading_partners" ("partnerStoreId", "status");
CREATE INDEX IF NOT EXISTS "trading_partners_requesterStoreId_status_idx" ON "trading_partners" ("requesterStoreId", "status");
CREATE INDEX IF NOT EXISTS "trading_partners_partnerOrgId_status_idx"     ON "trading_partners" ("partnerOrgId", "status");
CREATE INDEX IF NOT EXISTS "trading_partners_requesterOrgId_status_idx"   ON "trading_partners" ("requesterOrgId", "status");

-- ── 3. wholesale_orders ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wholesale_orders" (
  "id"                  TEXT          NOT NULL,
  "orderNumber"         TEXT          NOT NULL,
  "senderStoreId"       TEXT          NOT NULL,
  "senderOrgId"         TEXT          NOT NULL,
  "receiverStoreId"     TEXT          NOT NULL,
  "receiverOrgId"       TEXT          NOT NULL,
  "status"              TEXT          NOT NULL DEFAULT 'draft',

  "subtotal"            DECIMAL(12,4) NOT NULL DEFAULT 0,
  "depositTotal"        DECIMAL(12,4) NOT NULL DEFAULT 0,
  "taxTotal"            DECIMAL(12,4) NOT NULL DEFAULT 0,
  "grandTotal"          DECIMAL(12,4) NOT NULL DEFAULT 0,
  "confirmedSubtotal"   DECIMAL(12,4),
  "confirmedDeposit"    DECIMAL(12,4),
  "confirmedTax"        DECIMAL(12,4),
  "confirmedGrandTotal" DECIMAL(12,4),

  "taxEnabled"          BOOLEAN       NOT NULL DEFAULT FALSE,
  "isInternalTransfer"  BOOLEAN       NOT NULL DEFAULT FALSE,
  "hasRestrictedItems"  BOOLEAN       NOT NULL DEFAULT FALSE,

  "senderNotes"         TEXT,
  "cancelReason"        TEXT,
  "rejectReason"        TEXT,

  "createdById"         TEXT          NOT NULL,
  "sentAt"              TIMESTAMP(3),
  "sentById"            TEXT,
  "expiresAt"           TIMESTAMP(3),
  "respondedAt"         TIMESTAMP(3),
  "respondedById"       TEXT,
  "confirmedAt"         TIMESTAMP(3),
  "cancelledAt"         TIMESTAMP(3),
  "cancelledById"       TEXT,
  "editedAt"            TIMESTAMP(3),
  "editedById"          TEXT,

  "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wholesale_orders_pkey"                  PRIMARY KEY ("id"),
  CONSTRAINT "wholesale_orders_senderStoreId_fkey"    FOREIGN KEY ("senderStoreId")   REFERENCES "stores"("id") ON DELETE RESTRICT,
  CONSTRAINT "wholesale_orders_receiverStoreId_fkey"  FOREIGN KEY ("receiverStoreId") REFERENCES "stores"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "wholesale_orders_orderNumber_key"             ON "wholesale_orders" ("orderNumber");
CREATE INDEX        IF NOT EXISTS "wholesale_orders_senderStoreId_status_idx"    ON "wholesale_orders" ("senderStoreId", "status");
CREATE INDEX        IF NOT EXISTS "wholesale_orders_receiverStoreId_status_idx"  ON "wholesale_orders" ("receiverStoreId", "status");
CREATE INDEX        IF NOT EXISTS "wholesale_orders_senderOrgId_createdAt_idx"   ON "wholesale_orders" ("senderOrgId", "createdAt");
CREATE INDEX        IF NOT EXISTS "wholesale_orders_receiverOrgId_createdAt_idx" ON "wholesale_orders" ("receiverOrgId", "createdAt");
CREATE INDEX        IF NOT EXISTS "wholesale_orders_status_expiresAt_idx"        ON "wholesale_orders" ("status", "expiresAt");

-- ── 4. wholesale_order_items ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wholesale_order_items" (
  "id"                TEXT          NOT NULL,
  "orderId"           TEXT          NOT NULL,
  "senderProductId"   INTEGER,
  "receiverProductId" INTEGER,
  "productSnapshot"   JSONB         NOT NULL,
  "qtySent"           INTEGER       NOT NULL,
  "qtyReceived"       INTEGER,
  "unitCost"          DECIMAL(10,4) NOT NULL,
  "lineCost"          DECIMAL(12,4) NOT NULL,
  "depositPerUnit"    DECIMAL(10,4),
  "lineDeposit"       DECIMAL(12,4) NOT NULL DEFAULT 0,
  "taxable"           BOOLEAN       NOT NULL DEFAULT FALSE,
  "taxRate"           DECIMAL(6,4),
  "taxAmount"         DECIMAL(12,4) NOT NULL DEFAULT 0,
  "lineTotal"         DECIMAL(12,4) NOT NULL DEFAULT 0,
  "disputeNote"       TEXT,
  "sortOrder"         INTEGER       NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wholesale_order_items_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "wholesale_order_items_orderId_fkey"  FOREIGN KEY ("orderId") REFERENCES "wholesale_orders"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "wholesale_order_items_orderId_idx" ON "wholesale_order_items" ("orderId");

-- ── 5. wholesale_order_events ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wholesale_order_events" (
  "id"          TEXT         NOT NULL,
  "orderId"     TEXT         NOT NULL,
  "eventType"   TEXT         NOT NULL,
  "description" TEXT,
  "actorId"     TEXT,
  "actorName"   TEXT,
  "payload"     JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wholesale_order_events_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "wholesale_order_events_orderId_fkey"  FOREIGN KEY ("orderId") REFERENCES "wholesale_orders"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "wholesale_order_events_orderId_createdAt_idx"
  ON "wholesale_order_events" ("orderId", "createdAt");

-- ── 6. partner_balances ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "partner_balances" (
  "id"             TEXT          NOT NULL,
  "storeAId"       TEXT          NOT NULL,
  "storeBId"       TEXT          NOT NULL,
  "balance"        DECIMAL(14,4) NOT NULL DEFAULT 0,
  "lastActivityAt" TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "partner_balances_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "partner_balances_storeAId_fkey" FOREIGN KEY ("storeAId") REFERENCES "stores"("id") ON DELETE CASCADE,
  CONSTRAINT "partner_balances_storeBId_fkey" FOREIGN KEY ("storeBId") REFERENCES "stores"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_balances_pair_key" ON "partner_balances" ("storeAId", "storeBId");
CREATE INDEX        IF NOT EXISTS "partner_balances_storeAId_idx" ON "partner_balances" ("storeAId");
CREATE INDEX        IF NOT EXISTS "partner_balances_storeBId_idx" ON "partner_balances" ("storeBId");

-- ── 7. partner_settlements ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "partner_settlements" (
  "id"                  TEXT          NOT NULL,
  "storeAId"            TEXT          NOT NULL,
  "storeBId"            TEXT          NOT NULL,
  "payerStoreId"        TEXT          NOT NULL,
  "payeeStoreId"        TEXT          NOT NULL,
  "amount"              DECIMAL(12,4) NOT NULL,
  "method"              TEXT          NOT NULL,
  "methodRef"           TEXT,
  "note"                TEXT,
  "status"              TEXT          NOT NULL DEFAULT 'pending',
  "disputeWindowEndsAt" TIMESTAMP(3)  NOT NULL,
  "recordedById"        TEXT          NOT NULL,
  "recordedAt"          TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disputedAt"          TIMESTAMP(3),
  "disputedById"        TEXT,
  "disputeReason"       TEXT,
  "resolvedAt"          TIMESTAMP(3),
  "resolvedById"        TEXT,

  CONSTRAINT "partner_settlements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "partner_settlements_pair_recordedAt_idx" ON "partner_settlements" ("storeAId", "storeBId", "recordedAt");
CREATE INDEX IF NOT EXISTS "partner_settlements_status_window_idx"   ON "partner_settlements" ("status", "disputeWindowEndsAt");

-- ── 8. partner_ledger_entries ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "partner_ledger_entries" (
  "id"               TEXT          NOT NULL,
  "storeAId"         TEXT          NOT NULL,
  "storeBId"         TEXT          NOT NULL,
  "direction"        TEXT          NOT NULL,
  "amount"           DECIMAL(14,4) NOT NULL,
  "balanceAfter"     DECIMAL(14,4) NOT NULL,
  "entryType"        TEXT          NOT NULL,
  "wholesaleOrderId" TEXT,
  "settlementId"     TEXT,
  "description"      TEXT,
  "createdById"      TEXT          NOT NULL,
  "createdAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "partner_ledger_entries_pkey"                   PRIMARY KEY ("id"),
  CONSTRAINT "partner_ledger_entries_wholesaleOrderId_fkey"  FOREIGN KEY ("wholesaleOrderId") REFERENCES "wholesale_orders"("id")     ON DELETE SET NULL,
  CONSTRAINT "partner_ledger_entries_settlementId_fkey"      FOREIGN KEY ("settlementId")     REFERENCES "partner_settlements"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "partner_ledger_entries_pair_createdAt_idx" ON "partner_ledger_entries" ("storeAId", "storeBId", "createdAt");
CREATE INDEX IF NOT EXISTS "partner_ledger_entries_wholesaleOrderId_idx" ON "partner_ledger_entries" ("wholesaleOrderId");
CREATE INDEX IF NOT EXISTS "partner_ledger_entries_settlementId_idx"     ON "partner_ledger_entries" ("settlementId");
