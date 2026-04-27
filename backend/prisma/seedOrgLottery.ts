// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * seedOrgLottery.js — Ensures every non-system store has:
 *   • LotterySettings (enabled, state='ON')
 *   • A handful of LotteryGames (cloned from source org)
 *   • A few active/inventory LotteryBoxes
 *   • ~30 days of sample LotteryTransactions
 *
 * Idempotent. Skips stores that already have lottery games.
 *
 * Run: node prisma/seedOrgLottery.js
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const prisma = new PrismaClient();

const SOURCE_ORG   = 'default';
const SOURCE_STORE = 'default-store';

const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

async function seedForStore(orgId, storeId) {
  // 1. LotterySettings (upsert — store-level)
  await prisma.lotterySettings.upsert({
    where:  { storeId },
    update: {},
    create: {
      orgId, storeId,
      enabled: true, cashOnly: false,
      state: 'ON', commissionRate: 0.054,
      scanRequiredAtShiftEnd: false,
    },
  });

  // 2. Skip if games already seeded
  const existing = await prisma.lotteryGame.count({ where: { orgId, storeId } });
  if (existing > 0) {
    console.log(`    ↳ ${existing} lottery games already exist — skipping`);
    return;
  }

  // 3. Clone games from source store
  const src = await prisma.lotteryGame.findMany({
    where: { orgId: SOURCE_ORG, storeId: SOURCE_STORE, active: true },
    take: 12,
  });
  if (src.length === 0) {
    console.log(`    ⚠ No source games in ${SOURCE_ORG}/${SOURCE_STORE}`);
    return;
  }

  const games = [];
  for (const g of src) {
    const c = await prisma.lotteryGame.create({
      data: {
        orgId, storeId,
        name: g.name, gameNumber: g.gameNumber,
        ticketPrice: g.ticketPrice, ticketsPerBox: g.ticketsPerBox,
        active: true,
      },
    });
    games.push(c);
  }
  console.log(`    ↳ ${games.length} lottery games cloned`);

  // 4. Boxes: 3 active, 4 inventory, 2 depleted
  let boxCount = 0;
  for (let i = 0; i < 3; i++) {
    const g = games[i];
    const sold = rand(50, 300);
    await prisma.lotteryBox.create({
      data: {
        orgId, storeId, gameId: g.id,
        boxNumber: `B${String(i + 1).padStart(3, '0')}`, slotNumber: i + 1,
        totalTickets: g.ticketsPerBox, ticketPrice: g.ticketPrice,
        totalValue: (Number(g.ticketPrice) * g.ticketsPerBox).toFixed(2),
        status: 'active', activatedAt: daysAgo(rand(1, 5)),
        ticketsSold: sold, salesAmount: (sold * Number(g.ticketPrice)).toFixed(2),
      },
    });
    boxCount++;
  }
  for (let i = 0; i < 4; i++) {
    const g = pick(games.slice(3));
    await prisma.lotteryBox.create({
      data: {
        orgId, storeId, gameId: g.id,
        boxNumber: `B${String(i + 10).padStart(3, '0')}`,
        totalTickets: g.ticketsPerBox, ticketPrice: g.ticketPrice,
        totalValue: (Number(g.ticketPrice) * g.ticketsPerBox).toFixed(2),
        status: 'inventory', ticketsSold: 0, salesAmount: 0,
      },
    });
    boxCount++;
  }
  for (let i = 0; i < 2; i++) {
    const g = pick(games);
    await prisma.lotteryBox.create({
      data: {
        orgId, storeId, gameId: g.id,
        boxNumber: `B${String(i + 20).padStart(3, '0')}`,
        totalTickets: g.ticketsPerBox, ticketPrice: g.ticketPrice,
        totalValue: (Number(g.ticketPrice) * g.ticketsPerBox).toFixed(2),
        status: 'depleted', activatedAt: daysAgo(rand(10, 20)), depletedAt: daysAgo(rand(1, 5)),
        ticketsSold: g.ticketsPerBox,
        salesAmount: (Number(g.ticketPrice) * g.ticketsPerBox).toFixed(2),
      },
    });
    boxCount++;
  }
  console.log(`    ↳ ${boxCount} lottery boxes (3 active, 4 inventory, 2 depleted)`);

  // 5. Transactions — 30 days
  const txns = [];
  for (let d = 29; d >= 0; d--) {
    const day = daysAgo(d);
    for (let s = 0; s < rand(3, 12); s++) {
      const g = pick(games);
      txns.push({
        orgId, storeId, type: 'sale',
        amount: Number(g.ticketPrice) * pick([1, 1, 2, 5]),
        gameId: g.id,
        createdAt: new Date(day.getTime() + rand(28800000, 72000000)),
      });
    }
    for (let p = 0; p < rand(0, 2); p++) {
      txns.push({
        orgId, storeId, type: 'payout',
        amount: pick([5, 10, 20, 50]),
        createdAt: new Date(day.getTime() + rand(28800000, 72000000)),
      });
    }
  }
  await prisma.lotteryTransaction.createMany({ data: txns });
  console.log(`    ↳ ${txns.length} lottery transactions`);
}

export async function seedOrgLottery() {
  console.log('\n  🎟️  Ensuring every non-system store has lottery data...');

  const stores = await prisma.store.findMany({
    where: {
      isActive: true,
      organization: { slug: { not: 'system' } },
    },
    select: { id: true, orgId: true, name: true, organization: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  for (const s of stores) {
    console.log(`\n  ↳ ${s.organization?.name || s.orgId} / ${s.name} (${s.id})`);
    await seedForStore(s.orgId, s.id);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedOrgLottery()
    .catch((e) => { console.error('✗ seedOrgLottery failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
