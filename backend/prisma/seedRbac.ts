// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * Seed RBAC permission catalog + built-in system roles.
 *
 * Idempotent: safe to re-run after adding new permission keys or updating
 * system-role grants. Existing custom org roles are untouched.
 *
 * Usage: node prisma/seedRbac.js
 */

import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, SYSTEM_ROLES, expandPermissionGrants } from '../src/rbac/permissionCatalog.js';
import { syncUserDefaultRole } from '../src/rbac/permissionService.js';

const prisma = new PrismaClient();

async function main() {
  console.log('→ Seeding RBAC permissions + system roles…');

  // 1. Upsert the global permission catalog
  let permCreated = 0, permUpdated = 0;
  for (const p of ALL_PERMISSIONS) {
    const existing = await prisma.permission.findUnique({ where: { key: p.key } });
    if (existing) {
      await prisma.permission.update({
        where: { id: existing.id },
        data:  { module: p.module, action: p.action, label: p.label, description: p.description, scope: p.scope },
      });
      permUpdated++;
    } else {
      // Permission catalog includes display-only fields (moduleLabel, surface)
      // that aren't columns on the Permission model — strip to model fields.
      await prisma.permission.create({
        data: { key: p.key, module: p.module, action: p.action, label: p.label, description: p.description, scope: p.scope },
      });
      permCreated++;
    }
  }
  console.log(`  ✓ Permissions: ${permCreated} created, ${permUpdated} updated (${ALL_PERMISSIONS.length} total)`);

  // 2. Build a key→id lookup for permissions
  const allPerms = await prisma.permission.findMany({ select: { id: true, key: true } });
  const permIdByKey = Object.fromEntries(allPerms.map(p => [p.key, p.id]));

  // 3. Upsert built-in system roles (orgId=null, isSystem=true)
  for (const r of SYSTEM_ROLES) {
    const desiredKeys = expandPermissionGrants(r.permissions);

    let role = await prisma.role.findFirst({
      where: { orgId: null, key: r.key, isSystem: true },
    });

    if (!role) {
      role = await prisma.role.create({
        data: {
          orgId: null,
          key: r.key,
          name: r.name,
          description: r.description,
          scope: r.scope,
          status: 'active',
          isSystem: true,
        },
      });
      console.log(`  + Created system role: ${r.key}`);
    } else if (!role.isCustomized) {
      // Keep baseline metadata in sync — but only if the role hasn't been
      // customized by an admin. Respect user edits.
      await prisma.role.update({
        where: { id: role.id },
        data:  { name: r.name, description: r.description, scope: r.scope },
      });
    }

    // If the role has been customized by an admin, skip permission resync
    // entirely so their changes stick.
    if (role.isCustomized) {
      console.log(`    • ${r.key}: customized — skipping resync`);
      continue;
    }

    // Sync the role's permissions. System roles are always "source of truth"
    // until they've been customized (tracked via role.isCustomized).
    const desiredIds = new Set(
      desiredKeys.map(k => permIdByKey[k]).filter(Boolean)
    );
    const current = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permissionId: true },
    });
    const currentIds = new Set(current.map(c => c.permissionId));

    const toAdd = [...desiredIds].filter(id => !currentIds.has(id));
    const toRemove = [...currentIds].filter(id => !desiredIds.has(id));

    if (toAdd.length) {
      await prisma.rolePermission.createMany({
        data: toAdd.map(permissionId => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
    if (toRemove.length) {
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { in: toRemove } },
      });
    }

    console.log(`    • ${r.key}: +${toAdd.length} / -${toRemove.length} (total ${desiredIds.size})`);
  }

  // 4. Backfill — ensure every existing user has a UserRole row matching
  //    their legacy `User.role`. This is what populates the "X users" count
  //    you see on each role card in the portal / admin.
  console.log('→ Backfilling user default roles…');
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true },
  });

  let synced = 0, skipped = 0, unmapped = 0;
  const perRole = {};
  for (const u of users) {
    if (!u.role) { skipped++; continue; }
    const changed = await syncUserDefaultRole(u.id);
    if (changed) synced++;
    else skipped++;
    perRole[u.role] = (perRole[u.role] || 0) + 1;

    // Detect users whose legacy role has no matching system role
    const roleExists = SYSTEM_ROLES.some(r => r.key === u.role);
    if (!roleExists) unmapped++;
  }

  console.log(`  ✓ Users processed: ${users.length} total`);
  console.log(`    • ${synced} newly assigned, ${skipped} already in sync`);
  if (unmapped > 0) {
    console.log(`    ⚠ ${unmapped} user(s) have a legacy role that doesn't match any system role`);
  }
  console.log('  ✓ Distribution by role:');
  for (const [role, count] of Object.entries(perRole).sort()) {
    console.log(`      ${role.padEnd(12)} → ${count} user${count !== 1 ? 's' : ''}`);
  }

  // 5. S(rbac-hardware) — backfill: every user with canConfigureHardware=true
  //    needs a UserRole row pointing at the "Hardware Configurator" role so
  //    runtime permission checks line up with the legacy direct-flag state.
  //    Without this, the JIT sync on /me/implementation-pin would compute
  //    "no permission" → wipe their PIN on next admin-panel visit.
  console.log('→ Backfilling Hardware Configurator role for legacy flag holders…');
  const hwRole = await prisma.role.findFirst({
    where: { orgId: null, key: 'hardware-configurator', isSystem: true },
    select: { id: true },
  });
  if (!hwRole) {
    console.log('  ⚠ Hardware Configurator role missing — backfill skipped');
  } else {
    const flagHolders = await prisma.user.findMany({
      where: { canConfigureHardware: true },
      select: { id: true, email: true },
    });
    let added = 0, alreadyHeld = 0;
    for (const u of flagHolders) {
      const existing = await prisma.userRole.findUnique({
        where: { userId_roleId: { userId: u.id, roleId: hwRole.id } },
      });
      if (existing) { alreadyHeld++; continue; }
      await prisma.userRole.create({
        data: { userId: u.id, roleId: hwRole.id },
      });
      added++;
    }
    console.log(`  ✓ Hardware Configurator backfill: ${added} added, ${alreadyHeld} already held (${flagHolders.length} legacy flag holders)`);
  }

  console.log('✓ RBAC seed complete.');
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
