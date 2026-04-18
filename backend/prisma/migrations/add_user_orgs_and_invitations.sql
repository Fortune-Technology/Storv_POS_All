-- ══════════════════════════════════════════════════════════════════
--  Multi-Org Access + Invitations  (Session 21)
--
--  Creates:
--    • user_orgs   — many-to-many User ↔ Organization with per-org role
--    • invitations — onboarding + store-transfer flow
--
--  Backfill:
--    One row per existing user → UserOrg pointing at the user's legacy
--    `orgId` with role copied from `users.role`. isPrimary=true.
--
--  Cleanup:
--    Removes the legacy `orgId = 'detached'` placeholder so those users
--    become effectively orgless (no UserOrg row). Admin can re-invite.
--
--  Safe to re-run: uses IF NOT EXISTS + ON CONFLICT DO NOTHING.
-- ══════════════════════════════════════════════════════════════════

-- ── user_orgs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_orgs" (
  "userId"      TEXT        NOT NULL,
  "orgId"       TEXT        NOT NULL,
  "role"        TEXT        NOT NULL,
  "isPrimary"   BOOLEAN     NOT NULL DEFAULT FALSE,
  "invitedById" TEXT,
  "invitedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_orgs_pkey"          PRIMARY KEY ("userId", "orgId"),
  CONSTRAINT "user_orgs_userId_fkey"   FOREIGN KEY ("userId") REFERENCES "users"("id")          ON DELETE CASCADE,
  CONSTRAINT "user_orgs_orgId_fkey"    FOREIGN KEY ("orgId")  REFERENCES "organizations"("id")  ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "user_orgs_orgId_role_idx"       ON "user_orgs" ("orgId", "role");
CREATE INDEX IF NOT EXISTS "user_orgs_userId_isPrimary_idx" ON "user_orgs" ("userId", "isPrimary");

-- ── invitations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "invitations" (
  "id"                TEXT         NOT NULL,
  "token"             TEXT         NOT NULL,
  "email"             TEXT         NOT NULL,
  "phone"             TEXT,
  "orgId"             TEXT         NOT NULL,
  "storeIds"          TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "role"              TEXT         NOT NULL,
  "invitedById"       TEXT         NOT NULL,
  "transferOwnership" BOOLEAN      NOT NULL DEFAULT FALSE,
  "status"            TEXT         NOT NULL DEFAULT 'pending',
  "expiresAt"         TIMESTAMP(3) NOT NULL,
  "acceptedAt"        TIMESTAMP(3),
  "acceptedByUserId"  TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invitations_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "invitations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "invitations_token_key"       ON "invitations" ("token");
CREATE INDEX        IF NOT EXISTS "invitations_email_status_idx" ON "invitations" ("email", "status");
CREATE INDEX        IF NOT EXISTS "invitations_orgId_status_idx" ON "invitations" ("orgId", "status");

-- ── Backfill: one UserOrg row per existing active user ──────────
-- Skip obvious placeholders ('default', 'detached') that were legacy workarounds.
INSERT INTO "user_orgs" ("userId", "orgId", "role", "isPrimary", "invitedAt", "acceptedAt")
SELECT
  u."id",
  u."orgId",
  u."role",
  TRUE,
  COALESCE(u."createdAt", CURRENT_TIMESTAMP),
  COALESCE(u."createdAt", CURRENT_TIMESTAMP)
FROM "users" u
JOIN "organizations" o ON o."id" = u."orgId"
WHERE u."orgId" NOT IN ('default', 'detached')
ON CONFLICT ("userId", "orgId") DO NOTHING;
