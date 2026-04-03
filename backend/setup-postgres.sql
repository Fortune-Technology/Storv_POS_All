-- Future Foods Portal — PostgreSQL initial setup
-- Run this once after starting PostgreSQL for the first time

-- Create application user
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'futurefoods') THEN
    CREATE USER futurefoods WITH PASSWORD 'futurefoods123';
  END IF;
END
$$;

-- Create database (cannot run inside DO block, run separately)
-- CREATE DATABASE futurefoods_portal OWNER futurefoods;
-- GRANT ALL PRIVILEGES ON DATABASE futurefoods_portal TO futurefoods;
