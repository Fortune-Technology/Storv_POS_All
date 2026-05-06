# Production Seeder System

Long-term-safe seeding strategy for the Storeveu POS platform.

## Goals

1. **Re-runnable in production without harm.** Adding a new seeder file or
   updating an existing one cannot corrupt live customer data, duplicate
   records, or overwrite admin edits to user-editable fields.
2. **Versioned mutations.** Mutations to customer data run exactly once per
   `(seederName, version)`. Bumping a version is the explicit, git-tracked
   gesture for "I want this to run again."
3. **Single source of truth.** Every seeder the runner knows about lives in
   `registry.ts`. The runner doesn't auto-discover scripts on disk.
4. **Hermetic execution.** Each seeder spawns as its own subprocess so a
   crash in one cannot leak state into the next.
5. **Auditable.** Every run writes a row to `seeder_executions` —
   `runAt`, `durationMs`, `success`, `errorMsg`. Admins can see what ran
   when, what failed, and why.

## Two Categories

### Catalog (idempotent reference data)

Examples: RBAC permissions, plan + addon catalog, equipment products,
contract templates, vendor templates, US states, pricing tiers.

- Runs on **every boot** when `RUN_PRODUCTION_SEEDER=true`.
- Each write is an `upsert` keyed on a stable identifier (slug, key, etc.)
- Existing rows that admins have customized are NOT clobbered — seeders
  only write fields that are catalog-controlled (e.g. seed updates the
  default Merchant Services Agreement HTML, but doesn't touch
  `additionalNotes` if an admin set one).
- The `seeder_executions` row at `(name, version)` is upserted on every
  successful run so the latest `runAt` reflects the most recent execution.

### One-shot (mutates customer data)

Examples: `grantEnterpriseToExistingOrgs`, `grantProToExistingStores`,
`backfillPrimaryUpcs`.

- Runs **exactly once** per `(name, version)`.
- Successful row in `seeder_executions` is the gate. The runner queries
  for it before invoking the script — if `success=true`, skip.
- To re-run: bump `version` in `registry.ts`. The runner sees no row at
  the new version and runs it.
- Failures keep `success=false` and the next boot retries.

## Adding a New Seeder

1. Create the script under `backend/prisma/seedFoo.ts`. It must:
   - Be a self-contained TypeScript file invokable via `npx tsx prisma/seedFoo.ts`
   - Manage its own Prisma lifecycle (`$disconnect()` at the end)
   - Use `upsert` keyed on stable identifiers (catalog) OR check for
     prior state before inserting (one-shot)
   - `process.exit(0)` on success, `process.exit(1)` on failure
2. Append an entry to `SEEDER_REGISTRY` in `registry.ts`:
   ```ts
   {
     name: 'foo',
     version: 1,
     category: 'catalog', // or 'one_shot'
     description: 'What this seeder does, one line',
     scriptPath: 'prisma/seedFoo.ts',
     required: false, // true only for boot-blocking essentials like RBAC
   }
   ```
3. Commit. Next deploy / boot picks it up automatically.

## Updating an Existing Seeder

### Catalog

Just edit the script. The runner will pick up the change on the next boot
(catalog seeders re-run every time). The `seeder_executions` row stays at
`version: 1`; only `runAt` updates.

### One-shot

Two options:

- **Bump the version.** Change `version: 1` → `version: 2` in the
  registry entry. The runner sees no row at v2, runs the (now-updated)
  script, records v2. Old v1 row stays as audit history.
- **Delete the row.** For one-off ad-hoc re-runs (e.g., DB restored from
  a backup that pre-dates the seeder run):
  ```sql
  DELETE FROM seeder_executions WHERE "seederName"='foo' AND version=1;
  ```
  Next boot re-runs at v1.

## Boot Flow

When `RUN_PRODUCTION_SEEDER=true`:

```
server boot
  ├─ connect Postgres
  ├─ runProductionSeeders() ─────────────┐
  │   ├─ for each task in registry:      │
  │   │   ├─ if one_shot + already ran   │
  │   │   │     → skip                    │
  │   │   ├─ spawn `npx tsx <path>`      │
  │   │   ├─ on success → upsert row     │
  │   │   ├─ on failure → record failure │
  │   │   │     ├─ if required → break    │
  │   │   │     └─ else → continue       │
  │   └─ log summary                      │
  ├─ start schedulers ───────────────────┘
  └─ app.listen()
```

When `RUN_PRODUCTION_SEEDER=false` (default):

```
server boot
  ├─ connect Postgres
  ├─ log "skipping production seeder run"
  ├─ start schedulers
  └─ app.listen()
```

## Operational Playbook

### "I added a new module/feature with default config"

If config is platform-wide reference data:
- Update the relevant catalog seeder (e.g., add to `seedPlanModules.ts`)
- Don't bump version — catalog re-runs every boot
- Re-deploy

If config requires data migration on existing rows:
- Create a new one-shot seeder script
- Add to registry with `version: 1`
- Re-deploy → runs once on every existing customer

### "I need to re-grant Pro to a wave of existing customers"

```bash
# Option A: bump the version
# In registry.ts, change grantProToExistingStores `version: 1` → `version: 2`
# Commit + deploy → runs against current DB state

# Option B: ad-hoc on prod
ssh prod
psql $DATABASE_URL -c "DELETE FROM seeder_executions WHERE \"seederName\"='grantProToExistingStores' AND version=1"
# Restart backend → re-runs at v1
```

### "I want to inspect what's run"

```sql
SELECT "seederName", version, category, "runAt", "durationMs", success, "errorMsg"
FROM seeder_executions
ORDER BY "runAt" DESC;
```

### "Existing seeder is buggy in production"

- Fix the script
- Catalog: redeploy → next boot picks up the fix; `seeder_executions.runAt`
  updates but version stays
- One-shot: bump version → fixed code runs against current DB state; old
  row stays as audit history of the bug

## Why Subprocesses?

Every seeder script in `prisma/` predates the runner and manages its own
Prisma client (`prisma.$disconnect()` at the end). Importing them would
cause one seeder's disconnect to break the next seeder's queries. Spawning
each as `npx tsx <path>` gives every seeder a fresh process, fresh Prisma
client, fresh exit code — and crucially, a crashed seeder cannot leak
half-committed state into the next.

The cost: ~500-1000ms of subprocess overhead per seeder. With ~10
seeders, that's ~10s of pure overhead on a warm boot. Acceptable.

## Deploy Workflow vs. Boot-Time Runner

The platform has two separate seeding mechanisms:

1. **`.github/workflows/deploy.yml`** — explicit per-seeder steps. Used
   for the main GitHub Actions deploy to `pos.storeveu.com`. Sentinel-
   gated for one-shots via filesystem files (`.grant-*.done`).
2. **`RUN_PRODUCTION_SEEDER=true`** — the runner in this folder. Used
   for container-based / non-GHA deploys. DB-table-gated for one-shots.

Both are safe to use simultaneously — the underlying scripts are
idempotent and the gating is independent. Most installs will pick one or
the other based on infrastructure.
