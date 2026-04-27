// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * seedLotteryActivity.js — populate 7 days of realistic lottery activity
 * for the default test store so the back-office reports / settlement /
 * dashboard pages have non-zero numbers to render.
 *
 * What it creates per active book:
 *   - 7 close_day_snapshot LotteryScanEvent rows (today−6 .. today−1)
 *     Each closes at a lower ticket number than the previous (descending
 *     sell direction) — simulates a few tickets sold per day.
 *   - For some days, also creates LotteryTransaction (sale) rows that
 *     match the day's ticket-math sales — but for one of the 7 days
 *     INTENTIONALLY skips creating transactions, simulating a cashier
 *     who didn't ring up sales (so we can verify the variance audit).
 *   - Also creates daily LotteryOnlineTotal rows (machine numbers) for
 *     each of the 7 days — gives reports something to chart.
 *
 * Run: cd backend && node prisma/seedLotteryActivity.js
 *
 * Idempotent-ish — drops only the close_day_snapshot rows it created
 * (matched by `raw='seed:lottery_activity'`) and the test-marked
 * online-totals before re-creating. Real shift data is preserved.
 */

import prisma from '../src/config/postgres.js';
import { nanoid } from 'nanoid';

const DAYS = 7;
const TICKETS_PER_DAY = 5;   // each book sells ~5 tickets/day on average
const SKIP_DAY_INDEX  = 3;   // 3 days back: cashier "forgot" to ring up sales

function utcMidnight(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

async function main() {
  console.log('Seeding lottery activity for back-office report verification...\n');

  // Find any (org, store) pair with at least one active LotteryBox
  const sampleBox = await prisma.lotteryBox.findFirst({
    where: { status: 'active' },
    select: { orgId: true, storeId: true },
  });
  if (!sampleBox) {
    console.log('No active lottery books anywhere. Activate at least one book first.');
    process.exit(1);
  }
  const storeRow = await prisma.store.findUnique({
    where: { id: sampleBox.storeId },
    select: { id: true, name: true },
  });
  const store = { id: sampleBox.storeId, orgId: sampleBox.orgId, name: storeRow?.name || sampleBox.storeId };
  console.log(`Target store: ${store.name} (orgId=${store.orgId}, storeId=${store.id})\n`);

  // Find active books at this store
  const books = await prisma.lotteryBox.findMany({
    where: { orgId: store.orgId, storeId: store.id, status: 'active' },
    include: { game: true },
  });
  console.log(`Active books: ${books.length}`);
  for (const b of books) {
    console.log(`  · ${b.game?.name} Book ${b.boxNumber} · current=${b.currentTicket} · price=$${b.ticketPrice}`);
  }
  console.log('');

  // Wipe prior seeded events so re-running is idempotent
  const wipedEvents = await prisma.lotteryScanEvent.deleteMany({
    where: { orgId: store.orgId, storeId: store.id, raw: 'seed:lottery_activity' },
  });
  const wipedTotals = await prisma.lotteryOnlineTotal.deleteMany({
    where: { orgId: store.orgId, storeId: store.id, notes: 'seed:lottery_activity' },
  });
  console.log(`Wiped ${wipedEvents.count} prior seed events + ${wipedTotals.count} prior seed online totals\n`);

  const today = utcMidnight(new Date());
  let totalSnapshots = 0;
  let totalTxns      = 0;
  let totalUnrung    = 0;

  // For each book, simulate a starting position and walk it down day by day
  for (const b of books) {
    const totalTickets = Number(b.totalTickets || 150);
    // Start each book DAYS days ago from a position near full (book opened
    // recently). E.g. for a 150-pack: start at 149 - some_initial_sales.
    const initialPos = Math.max(totalTickets - 1 - 5, totalTickets - 30);  // sold 5-30 before our window
    let currentPos = initialPos;
    const ticketPrice = Number(b.ticketPrice || 0);
    let totalSoldForBook = 0;   // running total of tickets sold across the 7 days

    // Day -7 close: position pre-day-1 (= initialPos)
    // Day -6 close: position after day -6 sales (= initialPos - tickets_sold_day_-6)
    // ... etc
    // Day -0 (today): live currentTicket on the box (NOT a snapshot)

    for (let i = DAYS - 1; i >= 0; i--) {
      const dayDate = new Date(today);
      dayDate.setUTCDate(dayDate.getUTCDate() - (i + 1));   // i+1 because we don't snapshot today
      // Close happens at end of day (23:59:59 UTC)
      const closeAt = new Date(dayDate);
      closeAt.setUTCHours(23, 59, 59, 0);

      // Tickets sold THIS day
      const sold = Math.max(1, Math.round(TICKETS_PER_DAY + (Math.random() * 4 - 2)));
      const newPos = Math.max(0, currentPos - sold);
      currentPos = newPos;
      totalSoldForBook += sold;

      // Create the close_day_snapshot event
      await prisma.lotteryScanEvent.create({
        data: {
          orgId:     store.orgId,
          storeId:   store.id,
          boxId:     b.id,
          scannedBy: null,
          raw:       'seed:lottery_activity',
          parsed: {
            gameNumber:    b.game?.gameNumber ?? null,
            gameName:      b.game?.name ?? null,
            currentTicket: String(newPos),
            ticketsSold:   sold,
          },
          action:    'close_day_snapshot',
          context:   'eod',
          createdAt: closeAt,
        },
      });
      totalSnapshots += 1;

      // For most days, ALSO create LotteryTransaction sale rows that match
      // the day's ticket sales. For SKIP_DAY_INDEX, deliberately skip to
      // simulate the cashier not ringing up — we should see this as an
      // "unreported" variance in reports.
      const skipThisDay = (i === SKIP_DAY_INDEX);
      if (!skipThisDay) {
        // Create one tx per ticket sold (rough simulation)
        for (let t = 0; t < sold; t++) {
          // Spread tx times across the business day
          const txAt = new Date(dayDate);
          txAt.setUTCHours(8 + Math.floor((t / sold) * 12), Math.floor(Math.random() * 60), 0);
          await prisma.lotteryTransaction.create({
            data: {
              orgId:    store.orgId,
              storeId:  store.id,
              type:     'sale',
              gameId:   b.gameId,
              amount:   ticketPrice,
              shiftId:  null,        // not tied to a real shift in seed data
              createdAt: txAt,
            },
          });
          totalTxns += 1;
        }
      } else {
        totalUnrung += sold * ticketPrice;
      }
    }

    // Sync the LotteryBox aggregates with the simulated activity. Settlement,
    // Counter cards, and Active-tickets reports all read from these fields so
    // they need to reflect the seeded ticket-math truth. (In real ops this
    // happens automatically inside saveLotteryShiftReport when the cashier
    // closes the shift via the EoD wizard.)
    await prisma.lotteryBox.update({
      where: { id: b.id },
      data: {
        currentTicket: String(currentPos),
        ticketsSold:   totalSoldForBook,
        salesAmount:   Math.round(totalSoldForBook * ticketPrice * 100) / 100,
        // startTicket = where the book began at the start of our 7-day window.
        // Without this, future _realSalesFromSnapshots calls would assume a
        // fresh-from-the-pack opening and overstate the very first day.
        startTicket:   String(initialPos),
      },
    });
  }

  // Online totals for each of the 7 days (machine sales + cashings)
  for (let i = DAYS - 1; i >= 0; i--) {
    const dayDate = new Date(today);
    dayDate.setUTCDate(dayDate.getUTCDate() - (i + 1));
    const dateStr = dayDate.toISOString().slice(0, 10);
    const machineSales   = 50 + Math.floor(Math.random() * 100);    // $50-150
    const machineCashing = Math.floor(Math.random() * 60);           // $0-60
    const instantCashing = Math.floor(Math.random() * 40);           // $0-40
    await prisma.lotteryOnlineTotal.create({
      data: {
        orgId:           store.orgId,
        storeId:         store.id,
        date:            dayDate,
        machineSales,
        machineCashing,
        instantCashing,
        notes:           'seed:lottery_activity',
      },
    });
  }

  console.log('=== Seed complete ===');
  console.log(`Created ${totalSnapshots} close_day_snapshot events across ${books.length} books × ${DAYS} days`);
  console.log(`Created ${totalTxns} LotteryTransaction sale rows (matching ticket math except day -${SKIP_DAY_INDEX})`);
  console.log(`Day -${SKIP_DAY_INDEX} intentionally has $${totalUnrung.toFixed(2)} of "unreported" sales (cashier skipped ringing up)`);
  console.log(`Created 7 LotteryOnlineTotal rows (machine numbers per day)`);
  console.log(`Updated ${books.length} LotteryBox.currentTicket / ticketsSold / salesAmount / startTicket aggregates\n`);
  console.log('Now load the back-office Lottery page — Reports / Weekly Settlement / Daily Inventory should show real numbers.');
}

main()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
