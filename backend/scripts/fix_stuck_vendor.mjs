// One-shot helper to retro-apply the S77 Phase 2 activation fix to vendors
// who were activated BEFORE the contract controller was patched to promote
// their role + clear placeholder orgId.
//
// Run after deploying the Phase 2 hot-fix:
//   node scripts/fix_stuck_vendor.mjs
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const p = new PrismaClient();

const placeholderOrg = await p.organization.findFirst({ where: { slug: 'default' } });
if (!placeholderOrg) {
  console.log('No placeholder "default" org found — nothing to fix.');
  process.exit(0);
}

const stuck = await p.user.findMany({
  where: {
    vendorApproved: true,
    role: 'staff',
    orgId: placeholderOrg.id,
  },
  select: { id: true, email: true, name: true },
});

console.log(`Found ${stuck.length} stuck vendor(s):`);
for (const u of stuck) {
  await p.user.update({
    where: { id: u.id },
    data: { role: 'owner', orgId: null },
  });
  console.log(`  ✓ Patched ${u.email} (${u.name}) → role=owner, orgId=null`);
}

console.log('\nDone. Affected vendors must log out + log back in to refresh their JWT/localStorage.');
await p.$disconnect();
