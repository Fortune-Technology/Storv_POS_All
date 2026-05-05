// Quick verification helper for S77 — confirms the bypass migration applied.
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const u = await p.user.findMany({
  select: { email: true, role: true, status: true, onboardingSubmitted: true, contractSigned: true, vendorApproved: true },
  orderBy: { createdAt: 'asc' },
  take: 20,
});
console.log(`Found ${u.length} users:`);
console.table(u);
await p.$disconnect();
