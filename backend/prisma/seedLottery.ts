// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * Lottery Seed — Storeveu POS Portal
 *
 * Seeds Ontario OLGC scratch ticket games + demo boxes, transactions & shift reports.
 *
 * Run via:
 *   node prisma/seedLottery.js <orgId> <storeId>
 *
 * Or auto-detect first org/store:
 *   node prisma/seedLottery.js
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

// ── Ontario OLGC Scratch Ticket Games ─────────────────────────────────────────
// Real game names & prices from OLG (Ontario Lottery and Gaming Corporation)
const ONTARIO_GAMES = [
  { name: '$100,000 Jackpot',    gameNumber: '3001', ticketPrice: 5.00, ticketsPerBox: 600,  commissionRate: 0.05 },
  { name: '$500,000 Jackpot',    gameNumber: '3002', ticketPrice: 10.00, ticketsPerBox: 500, commissionRate: 0.05 },
  { name: '$1,000,000 Jackpot',  gameNumber: '3003', ticketPrice: 20.00, ticketsPerBox: 300, commissionRate: 0.05 },
  { name: '$2,000,000 Jackpot',  gameNumber: '3004', ticketPrice: 30.00, ticketsPerBox: 200, commissionRate: 0.05 },
  { name: 'Lucky Lines',         gameNumber: '2201', ticketPrice: 2.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: 'Crossword',           gameNumber: '2202', ticketPrice: 3.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: 'Wheel of Fortune',    gameNumber: '2203', ticketPrice: 5.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: '7, 11, 21',           gameNumber: '2204', ticketPrice: 1.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: 'Break the Bank',      gameNumber: '2205', ticketPrice: 3.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: 'Gold Rush',           gameNumber: '2206', ticketPrice: 2.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: 'Instant Bingo',       gameNumber: '2207', ticketPrice: 3.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: 'Bonus Cashword',      gameNumber: '2208', ticketPrice: 5.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: 'Fast Cash',           gameNumber: '2209', ticketPrice: 2.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: 'Bigger Bucks',        gameNumber: '2210', ticketPrice: 5.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: 'Lucky 7s',            gameNumber: '2211', ticketPrice: 2.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: 'Diamond 7s',          gameNumber: '2212', ticketPrice: 3.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: 'Triple 777',          gameNumber: '2213', ticketPrice: 5.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: 'Merry Money',         gameNumber: '2214', ticketPrice: 3.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: 'Extra Cash',          gameNumber: '2215', ticketPrice: 1.00,  ticketsPerBox: 600, commissionRate: 0.05 },
  { name: 'Cash Blitz',          gameNumber: '2216', ticketPrice: 5.00,  ticketsPerBox: 600, commissionRate: 0.05 },
];

// ── Utility ───────────────────────────────────────────────────────────────────
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const rand    = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick    = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function main() {
  // ── Resolve org + store ───────────────────────────────────────────────────
  let orgId   = process.argv[2];
  let storeId = process.argv[3];

  if (!orgId) {
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!org) throw new Error('No organization found. Run main seed first or pass orgId as arg.');
    orgId = org.id;
    console.log(`Auto-detected orgId: ${orgId} (${org.name})`);
  }

  if (!storeId) {
    const store = await prisma.store.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } });
    if (!store) throw new Error('No store found for org. Pass storeId as second arg.');
    storeId = store.id;
    console.log(`Auto-detected storeId: ${storeId} (${store.name})`);
  }

  // ── Clear existing lottery data for this store ────────────────────────────
  console.log('\n🎟️  Seeding lottery data...\n');
  await prisma.lotteryShiftReport.deleteMany({ where: { orgId, storeId } });
  await prisma.lotteryTransaction.deleteMany({ where: { orgId, storeId } });
  await prisma.lotteryBox.deleteMany({ where: { orgId, storeId } });
  await prisma.lotteryGame.deleteMany({ where: { orgId, storeId } });
  console.log('  Cleared existing lottery data.');

  // ── Seed Games ────────────────────────────────────────────────────────────
  const gameRecords = [];
  for (const g of ONTARIO_GAMES) {
    const game = await prisma.lotteryGame.create({
      data: {
        orgId,
        storeId,
        name:           g.name,
        gameNumber:     g.gameNumber,
        ticketPrice:    g.ticketPrice,
        ticketsPerBox:  g.ticketsPerBox,
        commissionRate: g.commissionRate,
        active:         true,
      },
    });
    gameRecords.push(game);
  }
  console.log(`  ✓ Created ${gameRecords.length} lottery games (Ontario OLGC)`);

  // ── Seed Boxes ────────────────────────────────────────────────────────────
  const boxData = [];

  // 4 active boxes (in machine)
  const activeGames = gameRecords.slice(0, 6);
  for (let i = 0; i < 4; i++) {
    const game        = activeGames[i];
    const ticketsSold = rand(50, 400);
    const salesAmt    = (ticketsSold * Number(game.ticketPrice)).toFixed(2);
    const box = await prisma.lotteryBox.create({
      data: {
        orgId,
        storeId,
        gameId:       game.id,
        boxNumber:    `B${String(i + 1).padStart(3, '0')}`,
        slotNumber:   i + 1,
        totalTickets: game.ticketsPerBox,
        ticketPrice:  game.ticketPrice,
        totalValue:   (Number(game.ticketPrice) * game.ticketsPerBox).toFixed(2),
        status:       'active',
        activatedAt:  daysAgo(rand(1, 7)),
        ticketsSold,
        salesAmount:  salesAmt,
      },
    });
    boxData.push(box);
  }

  // 6 boxes in inventory
  for (let i = 0; i < 6; i++) {
    const game = pick(gameRecords.slice(4));
    const box = await prisma.lotteryBox.create({
      data: {
        orgId,
        storeId,
        gameId:       game.id,
        boxNumber:    `B${String(i + 10).padStart(3, '0')}`,
        totalTickets: game.ticketsPerBox,
        ticketPrice:  game.ticketPrice,
        totalValue:   (Number(game.ticketPrice) * game.ticketsPerBox).toFixed(2),
        status:       'inventory',
        ticketsSold:  0,
        salesAmount:  0,
      },
    });
    boxData.push(box);
  }

  // 3 depleted boxes
  for (let i = 0; i < 3; i++) {
    const game = pick(gameRecords.slice(0, 5));
    const box = await prisma.lotteryBox.create({
      data: {
        orgId,
        storeId,
        gameId:       game.id,
        boxNumber:    `B${String(i + 20).padStart(3, '0')}`,
        totalTickets: game.ticketsPerBox,
        ticketPrice:  game.ticketPrice,
        totalValue:   (Number(game.ticketPrice) * game.ticketsPerBox).toFixed(2),
        status:       'depleted',
        activatedAt:  daysAgo(rand(7, 21)),
        depletedAt:   daysAgo(rand(1, 6)),
        ticketsSold:  game.ticketsPerBox,
        salesAmount:  (Number(game.ticketPrice) * game.ticketsPerBox).toFixed(2),
      },
    });
    boxData.push(box);
  }

  console.log(`  ✓ Created ${boxData.length} boxes (4 active, 6 inventory, 3 depleted)`);

  // ── Seed Transactions (last 30 days) ──────────────────────────────────────
  const txns = [];

  for (let day = 29; day >= 0; day--) {
    const date = daysAgo(day);
    const salesCount   = rand(5, 20);
    const payoutCount  = rand(1, 4);

    // Sales
    for (let s = 0; s < salesCount; s++) {
      const game   = pick(gameRecords.filter(g => g.active));
      const amount = pick([Number(game.ticketPrice), Number(game.ticketPrice) * 2, Number(game.ticketPrice) * 5]);
      txns.push({
        orgId, storeId,
        type:      'sale',
        amount,
        gameId:    game.id,
        createdAt: new Date(date.getTime() + rand(28800000, 72000000)), // 8am–8pm
      });
    }

    // Payouts
    for (let p = 0; p < payoutCount; p++) {
      const amount = pick([5, 10, 20, 50, 100, 200, 500]);
      txns.push({
        orgId, storeId,
        type:      'payout',
        amount,
        createdAt: new Date(date.getTime() + rand(28800000, 72000000)),
      });
    }
  }

  // Batch insert
  await prisma.lotteryTransaction.createMany({ data: txns });
  const salesTxns  = txns.filter(t => t.type === 'sale');
  const payoutTxns = txns.filter(t => t.type === 'payout');
  console.log(`  ✓ Created ${txns.length} transactions (${salesTxns.length} sales, ${payoutTxns.length} payouts)`);

  // ── Seed Shift Reports (last 14 days) ────────────────────────────────────
  for (let day = 13; day >= 1; day--) {
    const date = daysAgo(day);
    // Aggregate that day's txns
    const dayStart = new Date(date); dayStart.setHours(0,0,0,0);
    const dayEnd   = new Date(date); dayEnd.setHours(23,59,59,999);
    const dayTxns  = txns.filter(t => t.createdAt >= dayStart && t.createdAt <= dayEnd);

    const totalSales   = dayTxns.filter(t => t.type === 'sale').reduce((s, t) => s + Number(t.amount), 0);
    const totalPayouts = dayTxns.filter(t => t.type === 'payout').reduce((s, t) => s + Number(t.amount), 0);
    const netAmount    = totalSales - totalPayouts;
    // Simulate a small variance (±5%)
    const varPct     = (Math.random() * 0.04 - 0.02); // -2% to +2%
    const actual     = netAmount * (1 + varPct);
    const machine    = actual * 0.8;
    const digital    = actual * 0.2;
    const variance   = actual - netAmount;

    await prisma.lotteryShiftReport.create({
      data: {
        orgId,
        storeId,
        shiftId:       `shift-demo-day${day}`,
        machineAmount: parseFloat(machine.toFixed(2)),
        digitalAmount: parseFloat(digital.toFixed(2)),
        totalSales:    parseFloat(totalSales.toFixed(2)),
        totalPayouts:  parseFloat(totalPayouts.toFixed(2)),
        netAmount:     parseFloat(netAmount.toFixed(2)),
        variance:      parseFloat(variance.toFixed(2)),
        closedAt:      dayEnd,
        createdAt:     dayEnd,
        updatedAt:     dayEnd,
      },
    });
  }
  console.log('  ✓ Created 13 shift reports (last 14 days)');

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalSalesAll   = salesTxns.reduce((s, t) => s + Number(t.amount), 0);
  const totalPayoutsAll = payoutTxns.reduce((s, t) => s + Number(t.amount), 0);
  const commEarned      = totalSalesAll * 0.05;

  console.log('\n✅ Lottery seed complete!');
  console.log(`   Games:        ${gameRecords.length} (Ontario OLGC scratch tickets)`);
  console.log(`   Boxes:        ${boxData.length} (4 active, 6 in storage, 3 depleted)`);
  console.log(`   Transactions: ${txns.length} over 30 days`);
  console.log(`   Total Sales:  $${totalSalesAll.toFixed(2)}`);
  console.log(`   Total Payout: $${totalPayoutsAll.toFixed(2)}`);
  console.log(`   Commission:   $${commEarned.toFixed(2)} (5%)\n`);
}

main()
  .catch(e => { console.error('❌ Seed failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
