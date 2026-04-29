import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const prisma = new PrismaClient({ log: [] });

const d = new Date();
const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const prefix = `SYN-${dateStr}-`;

const txs = await prisma.transaction.findMany({
  where: { txNumber: { startsWith: prefix } },
  select: { orgId: true, storeId: true, cashierId: true, grandTotal: true, createdAt: true, notes: true },
});

console.log(`\n  Total synthetic txs today: ${txs.length}\n`);

// Per-org rollup
const byOrg: Record<string, { count: number; total: number; stores: Set<string>; cashiers: Set<string>; withCustomer: number }> = {};
for (const t of txs) {
  const k = t.orgId;
  byOrg[k] ??= { count: 0, total: 0, stores: new Set(), cashiers: new Set(), withCustomer: 0 };
  byOrg[k].count++;
  byOrg[k].total += Number(t.grandTotal);
  byOrg[k].stores.add(t.storeId);
  byOrg[k].cashiers.add(t.cashierId);
  if (t.notes?.startsWith('Loyalty:')) byOrg[k].withCustomer++;
}

for (const [orgId, s] of Object.entries(byOrg)) {
  console.log(`  org=${orgId.slice(0, 16)}…`);
  console.log(`    txs:           ${s.count}`);
  console.log(`    total:         $${s.total.toFixed(2)}`);
  console.log(`    avg / tx:      $${(s.total / s.count).toFixed(2)}`);
  console.log(`    stores hit:    ${s.stores.size}`);
  console.log(`    cashiers hit:  ${s.cashiers.size}`);
  console.log(`    w/ customer:   ${s.withCustomer} (${Math.round(100 * s.withCustomer / s.count)}%)`);
}

// Hourly spread for Fortune
const hours: number[] = new Array(24).fill(0);
txs.forEach(t => { hours[new Date(t.createdAt).getUTCHours()]++; });
console.log('\n  Hour-of-day distribution (UTC):');
for (let h = 0; h < 24; h++) {
  if (hours[h] > 0) console.log(`    ${String(h).padStart(2, '0')}:00  ${'█'.repeat(hours[h])} (${hours[h]})`);
}

process.exit(0);
