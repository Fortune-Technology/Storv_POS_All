-- Add station assignment + monthly day to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "stationId" TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "stationName" TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "recurDayOfMonth" INT;
