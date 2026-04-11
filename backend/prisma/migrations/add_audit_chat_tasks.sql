-- Audit Log + Chat Messages + Tasks
-- Run: npx prisma db execute --file prisma/migrations/add_audit_chat_tasks.sql --schema prisma/schema.prisma

-- ── Audit Log (IMMUTABLE — no DELETE allowed at app level) ──
CREATE TABLE IF NOT EXISTS audit_logs (
  "id"          SERIAL PRIMARY KEY,
  "orgId"       TEXT NOT NULL,
  "storeId"     TEXT,
  "userId"      TEXT NOT NULL,
  "userName"    TEXT,
  "userRole"    TEXT,
  "action"      TEXT NOT NULL,
  "entity"      TEXT NOT NULL,
  "entityId"    TEXT,
  "details"     JSONB,
  "ipAddress"   TEXT,
  "userAgent"   TEXT,
  "source"      TEXT NOT NULL DEFAULT 'portal',
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_org_date ON audit_logs("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_audit_org_user ON audit_logs("orgId", "userId");
CREATE INDEX IF NOT EXISTS idx_audit_org_entity ON audit_logs("orgId", "entity", "action");

-- ── Chat Messages ──
CREATE TABLE IF NOT EXISTS chat_messages (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orgId"       TEXT NOT NULL,
  "storeId"     TEXT,
  "channelId"   TEXT NOT NULL,
  "senderId"    TEXT NOT NULL,
  "senderName"  TEXT NOT NULL,
  "senderRole"  TEXT,
  "message"     TEXT NOT NULL,
  "messageType" TEXT NOT NULL DEFAULT 'text',
  "readBy"      TEXT[] NOT NULL DEFAULT '{}',
  "pinned"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_messages("orgId", "channelId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_chat_store ON chat_messages("orgId", "storeId", "createdAt");

-- ── Tasks ──
CREATE TABLE IF NOT EXISTS tasks (
  "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orgId"        TEXT NOT NULL,
  "storeId"      TEXT,
  "title"        TEXT NOT NULL,
  "description"  TEXT,
  "priority"     TEXT NOT NULL DEFAULT 'normal',
  "status"       TEXT NOT NULL DEFAULT 'open',
  "category"     TEXT,
  "assignedTo"   TEXT,
  "assignedBy"   TEXT NOT NULL,
  "assigneeName" TEXT,
  "assignerName" TEXT,
  "dueDate"      TIMESTAMPTZ,
  "completedAt"  TIMESTAMPTZ,
  "completedBy"  TEXT,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_org_status ON tasks("orgId", "storeId", "status");
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks("orgId", "assignedTo", "status");
