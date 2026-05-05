import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
const p = new PrismaClient();

const events = await p.contractEvent.findMany({
  where: { contractId: 'cmor3pc8p000mvdekfkpzj9g9' },
  orderBy: { createdAt: 'asc' },
});
console.log(`Events (${events.length}):`);
for (const e of events) {
  console.log(`  ${e.createdAt.toISOString()}  [${e.eventType}]  actor=${e.actorRole || '—'}  meta=${JSON.stringify(e.meta)}`);
}

const c = await p.contract.findUnique({
  where: { id: 'cmor3pc8p000mvdekfkpzj9g9' },
  select: { signedAt: true, signedPdfPath: true, signerName: true, status: true, activatedAt: true },
});
console.log('\nContract:', c);
await p.$disconnect();
