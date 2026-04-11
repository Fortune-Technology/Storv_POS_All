-- Add checklist + recurring fields to tasks table
-- Run: npx prisma db execute --file prisma/migrations/add_task_checklist_recurring.sql --schema prisma/schema.prisma

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "checklist"   JSONB NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "isRecurring" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "recurType"   TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "recurDays"   TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "recurTime"   TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "templateId"  TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "nextRunAt"   TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "lastRunAt"   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_recurring ON tasks("orgId", "isRecurring", "nextRunAt");
