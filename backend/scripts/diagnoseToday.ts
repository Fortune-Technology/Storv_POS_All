// @ts-nocheck
/**
 * diagnoseToday.ts — One-shot lottery sales diagnostic
 *
 * Pulls every piece of data that contributes to today's "Today Sold"
 * aggregate on the back-office Daily page, so we can pinpoint exactly
 * which book/event/transaction is causing a mystery number.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/diagnoseToday.ts [--date YYYY-MM-DD] [--store storeId]
 *
 * If --date and --store are omitted, defaults to today + the only enabled
 * lottery store in the DB. If multiple stores have lottery enabled, you
 * must pass --store explicitly.
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  const dateStr = arg('date') || todayISO();
  let storeId = arg('store');

  if (!storeId) {
    const stores = await prisma.lotterySettings.findMany({
      where: { enabled: true },
      select: { storeId: true, state: true },
    });
    if (stores.length === 0) {
      console.error('No stores with lottery enabled. Pass --store <storeId>.');
      process.exit(1);
    }
    if (stores.length > 1) {
      console.error('Multiple stores with lottery enabled — pass --store <storeId>:');
      for (const s of stores) console.error(`  ${s.storeId} (${s.state || 'no state'})`);
      process.exit(1);
    }
    storeId = stores[0].storeId;
  }

  const dayStartUTC = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEndUTC = new Date(`${dateStr}T23:59:59.999Z`);

  // ── Fetch the store's tz so we can also show local-day window
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { name: true, timezone: true },
  });
  const tz = store?.timezone || 'UTC';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Diagnostic — ${dateStr}`);
  console.log(`  Store:    ${store?.name || storeId}`);
  console.log(`  Timezone: ${tz}`);
  console.log(`  UTC win:  ${dayStartUTC.toISOString()} → ${dayEndUTC.toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── A. close_day_snapshot events landing in today's UTC window
  // (boxId is a plain string FK, not a relation, so we fetch boxes separately)
  const todayEvents = await prisma.lotteryScanEvent.findMany({
    where: {
      storeId,
      action: 'close_day_snapshot',
      createdAt: { gte: dayStartUTC, lte: dayEndUTC },
    },
    orderBy: { createdAt: 'desc' },
  });
  const eventBoxIds = [...new Set(todayEvents.map((e) => e.boxId).filter(Boolean))] as string[];
  const eventBoxes = eventBoxIds.length
    ? await prisma.lotteryBox.findMany({
        where: { id: { in: eventBoxIds } },
        select: {
          id: true,
          boxNumber: true,
          slotNumber: true,
          status: true,
          ticketPrice: true,
          totalTickets: true,
          startTicket: true,
          currentTicket: true,
          lastShiftEndTicket: true,
          game: { select: { gameNumber: true, name: true } },
        },
      })
    : [];
  const eventBoxMap = Object.fromEntries(eventBoxes.map((b) => [b.id, b]));

  console.log('─── A. close_day_snapshot events created TODAY (UTC) ───');
  if (todayEvents.length === 0) {
    console.log('  (none — no snapshots created today)\n');
  } else {
    console.log(`  Found ${todayEvents.length} event(s):\n`);
    for (const ev of todayEvents) {
      const parsed = ev.parsed as any;
      const box = ev.boxId ? eventBoxMap[ev.boxId] : null;
      console.log(`  • ${ev.createdAt.toISOString()}`);
      console.log(`    boxId:        ${ev.boxId}`);
      console.log(`    box:          ${box?.game?.name || '?'} #${box?.boxNumber || '?'} (slot ${box?.slotNumber ?? '—'}, status=${box?.status})`);
      console.log(`    ticketPrice:  $${box?.ticketPrice}`);
      console.log(`    parsed.currentTicket: ${JSON.stringify(parsed?.currentTicket)}`);
      console.log(`    parsed.source:        ${JSON.stringify(parsed?.source)}`);
      console.log(`    raw:          ${ev.raw}`);
      console.log('');
    }
  }

  // ── B. For each box that has a snapshot today, find prev snapshot + compute delta
  if (todayEvents.length > 0) {
    console.log('─── B. snapshotSales delta per box ───');
    const boxIds = [...new Set(todayEvents.map((e) => e.boxId).filter(Boolean))] as string[];
    for (const boxId of boxIds) {
      const todayEv = todayEvents.find((e) => e.boxId === boxId);
      const todayParsed = todayEv?.parsed as any;
      const todayCT = todayParsed?.currentTicket;

      const prevEv = await prisma.lotteryScanEvent.findFirst({
        where: {
          storeId,
          action: 'close_day_snapshot',
          boxId,
          createdAt: { lt: dayStartUTC },
        },
        orderBy: { createdAt: 'desc' },
      });
      const prevParsed = prevEv?.parsed as any;

      const box = eventBoxMap[boxId];
      const price = Number(box?.ticketPrice || 0);

      // priorPosition fallback chain (post-Phase 1)
      let prev = prevParsed?.currentTicket;
      let prevSource = 'snapshot (yesterday or before)';
      if (prev == null) {
        prev = box?.lastShiftEndTicket;
        prevSource = 'box.lastShiftEndTicket';
      }
      if (prev == null) {
        prev = box?.startTicket;
        prevSource = 'box.startTicket';
      }
      if (prev == null && box?.totalTickets) {
        prev = String(Number(box.totalTickets) - 1);
        prevSource = 'direction-fallback (desc)';
      }

      const prevNum = parseInt(prev, 10);
      const todayNum = parseInt(todayCT, 10);
      const sold = !Number.isNaN(prevNum) && !Number.isNaN(todayNum)
        ? Math.abs(prevNum - todayNum)
        : null;
      const amount = sold != null ? sold * price : null;

      console.log(`  • ${box?.game?.name || '?'} #${box?.boxNumber || '?'} (boxId ${boxId})`);
      console.log(`      ticketPrice = $${price}`);
      console.log(`      prev = ${JSON.stringify(prev)}  (source: ${prevSource})`);
      console.log(`      today = ${JSON.stringify(todayCT)}`);
      console.log(`      sold = ${sold} tickets  →  amount = $${amount}`);
      console.log('');
    }
  }

  // ── C. LotteryTransactions today (Tier 3 fallback)
  const txns = await prisma.lotteryTransaction.findMany({
    where: {
      storeId,
      type: 'sale',
      createdAt: { gte: dayStartUTC, lte: dayEndUTC },
    },
    select: {
      id: true,
      amount: true,
      gameId: true,
      boxId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log('─── C. LotteryTransaction (POS-rang) today ───');
  if (txns.length === 0) {
    console.log('  (none — no POS lottery sales today)\n');
  } else {
    let posTotal = 0;
    for (const t of txns) {
      posTotal += Number(t.amount || 0);
      console.log(`  • ${t.createdAt.toISOString()}  $${t.amount}  game=${t.gameId} box=${t.boxId}`);
    }
    console.log(`  POS total: $${posTotal.toFixed(2)}\n`);
  }

  // ── D. Live-tier candidates: active boxes whose currentTicket differs
  // from their latest pre-today snapshot
  const activeBoxes = await prisma.lotteryBox.findMany({
    where: { storeId, status: 'active' },
    select: {
      id: true,
      boxNumber: true,
      slotNumber: true,
      ticketPrice: true,
      totalTickets: true,
      startTicket: true,
      currentTicket: true,
      lastShiftEndTicket: true,
      game: { select: { gameNumber: true, name: true } },
    },
  });

  console.log('─── D. Live-tier candidates (currentTicket vs prev snapshot) ───');
  let liveTotal = 0;
  let liveCount = 0;
  for (const b of activeBoxes) {
    const prevEv = await prisma.lotteryScanEvent.findFirst({
      where: {
        storeId,
        action: 'close_day_snapshot',
        boxId: b.id,
        createdAt: { lt: dayStartUTC },
      },
      orderBy: { createdAt: 'desc' },
    });
    const prevParsed = prevEv?.parsed as any;
    let prev = prevParsed?.currentTicket;
    if (prev == null) prev = b.lastShiftEndTicket;
    if (prev == null) prev = b.startTicket;
    if (prev == null && b.totalTickets) prev = String(Number(b.totalTickets) - 1);

    const prevNum = parseInt(prev, 10);
    const curNum = b.currentTicket != null ? parseInt(b.currentTicket, 10) : NaN;

    if (!Number.isFinite(prevNum) || !Number.isFinite(curNum)) continue;
    const sold = Math.abs(prevNum - curNum);
    if (sold === 0) continue;
    const amount = sold * Number(b.ticketPrice || 0);
    liveTotal += amount;
    liveCount += 1;
    console.log(`  • ${b.game?.name || '?'} #${b.boxNumber || '?'} (slot ${b.slotNumber ?? '—'})`);
    console.log(`      ticketPrice = $${b.ticketPrice}`);
    console.log(`      prev = ${prev}  →  current = ${b.currentTicket}`);
    console.log(`      sold = ${sold} tickets  →  amount = $${amount}`);
    console.log('');
  }
  if (liveCount === 0) console.log('  (none — no live-tier deltas)\n');
  else console.log(`  Live tier total: $${liveTotal.toFixed(2)} across ${liveCount} book(s)\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  close_day_snapshot events today: ${todayEvents.length}`);
  console.log(`  POS lottery txns today:          ${txns.length}`);
  console.log(`  Live-tier delta candidates:      ${liveCount}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
