-- Add showInPOS flag to departments
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "showInPOS" BOOLEAN NOT NULL DEFAULT true;
