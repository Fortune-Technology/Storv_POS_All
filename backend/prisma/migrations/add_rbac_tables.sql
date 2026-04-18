-- ══════════════════════════════════════════════════════════════════
--  RBAC Tables — retroactive migration for PR #95 (Role Module)
--
--  The role module shipped without an SQL migration file, relying on
--  `prisma db push` during development. CI only runs *.sql files, so
--  production has been missing these tables since PR #95 merged.
--
--  Symptoms this was causing on prod:
--    • /api/roles/me/permissions → 404 / 500 (Prisma query throws on
--      non-existent `roles` / `user_roles` / `role_permissions` tables)
--    • All users see a near-empty sidebar — permissions resolve to []
--    • Owner / admin accounts cannot access their own orgs
--
--  Idempotent: uses IF NOT EXISTS + unique indexes. Safe to re-run on
--  any environment (dev, staging, prod) without side effects.
--
--  After this runs, seedRbac.js will populate the rows. The deploy
--  workflow already runs `node prisma/seedRbac.js` right after this
--  migration loop (added in the multi-org PR).
-- ══════════════════════════════════════════════════════════════════

-- ── permissions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "permissions" (
  "id"          SERIAL        PRIMARY KEY,
  "key"         TEXT          NOT NULL,
  "module"      TEXT          NOT NULL,
  "action"      TEXT          NOT NULL,
  "label"       TEXT          NOT NULL,
  "description" TEXT,
  "scope"       TEXT          NOT NULL DEFAULT 'org',
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "permissions_key_key"  ON "permissions" ("key");
CREATE INDEX        IF NOT EXISTS "permissions_module_idx" ON "permissions" ("module");
CREATE INDEX        IF NOT EXISTS "permissions_scope_idx"  ON "permissions" ("scope");

-- ── roles ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "roles" (
  "id"           TEXT          NOT NULL,
  "orgId"        TEXT,
  "key"          TEXT          NOT NULL,
  "name"         TEXT          NOT NULL,
  "description"  TEXT,
  "status"       TEXT          NOT NULL DEFAULT 'active',
  "isSystem"     BOOLEAN       NOT NULL DEFAULT FALSE,
  "isCustomized" BOOLEAN       NOT NULL DEFAULT FALSE,
  "scope"        TEXT          NOT NULL DEFAULT 'org',
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- Add FK only if it isn't already there (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'roles_orgId_fkey' AND table_name = 'roles'
  ) THEN
    ALTER TABLE "roles"
      ADD CONSTRAINT "roles_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "roles_orgId_key_key" ON "roles" ("orgId", "key");
CREATE INDEX        IF NOT EXISTS "roles_orgId_idx"     ON "roles" ("orgId");
CREATE INDEX        IF NOT EXISTS "roles_scope_idx"     ON "roles" ("scope");

-- ── role_permissions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "role_permissions" (
  "roleId"       TEXT         NOT NULL,
  "permissionId" INTEGER      NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId", "permissionId")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'role_permissions_roleId_fkey' AND table_name = 'role_permissions'
  ) THEN
    ALTER TABLE "role_permissions"
      ADD CONSTRAINT "role_permissions_roleId_fkey"
      FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'role_permissions_permissionId_fkey' AND table_name = 'role_permissions'
  ) THEN
    ALTER TABLE "role_permissions"
      ADD CONSTRAINT "role_permissions_permissionId_fkey"
      FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "role_permissions_permissionId_idx" ON "role_permissions" ("permissionId");

-- ── user_roles ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_roles" (
  "userId"    TEXT         NOT NULL,
  "roleId"    TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId", "roleId")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'user_roles_userId_fkey' AND table_name = 'user_roles'
  ) THEN
    ALTER TABLE "user_roles"
      ADD CONSTRAINT "user_roles_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'user_roles_roleId_fkey' AND table_name = 'user_roles'
  ) THEN
    ALTER TABLE "user_roles"
      ADD CONSTRAINT "user_roles_roleId_fkey"
      FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "user_roles_roleId_idx" ON "user_roles" ("roleId");
