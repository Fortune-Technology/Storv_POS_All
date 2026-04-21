/**
 * seedMaineLotteryCatalog.js
 *
 * Seeds Maine scratch ticket game names into LotteryTicketCatalog.
 *
 * Data scraped from https://www.mainelottery.com/instant/scratch{N}dollar.html
 * on 2026-04-21. Names only — the state publishes thumbnail graphics but does
 * not publish 3-digit game numbers or tickets-per-book on the public site.
 * Once the admin has the Maine Lottery retailer bulletin, they fill the
 * `gameNumber` via Admin → Lottery → Ticket Catalog (inline edit).
 *
 * Idempotent: skips rows that already exist for (state, name, ticketPrice).
 *
 * Run: `node prisma/seedMaineLotteryCatalog.js`
 */

import prisma from '../src/config/postgres.js';

// ── Scraped from mainelottery.com on 2026-04-21 ───────────────────────────
const MAINE_GAMES = [
  // $1
  { price: 1, names: ['Ca$h In', 'Easy Money'] },
  // $2
  { price: 2, names: ['Electric 8\'s', '10X The Win', 'Ace in the Hole', 'Count \'Em Up', 'Tic Tac Multiplier'] },
  // $3
  { price: 3, names: ['Leap for Loot', 'Skee-Ball', 'Cash Line Bingo', 'Maine Crossword'] },
  // $5
  { price: 5, names: [
    'Hi or Lo', 'Money Vault Multiplier', '$500 Ca$h!', 'Ca$h Bla$t',
    '$60,000 Cashword', 'Double Your Dollars', 'Silver 7\'s', '20X The Win',
    'Power Spot', 'Winning Streak', 'Lady Luck',
  ] },
  // $10
  { price: 10, names: ['Hamilton', '25X The Win', '$50 or $100', 'Blazing Bucks', 'Jurassic Park', 'Cash Times 10'] },
  // $20
  { price: 20, names: ['Cash Bonanza', '$50,000 Bankroll', 'Royal Cash'] },
  // $30
  { price: 30, names: ['$70 Million Supreme'] },
];

async function main() {
  const rows = [];
  for (const tier of MAINE_GAMES) {
    for (const name of tier.names) {
      rows.push({
        name,
        gameNumber:     null,   // fill in via admin UI after cross-referencing the retailer bulletin
        ticketPrice:    tier.price,
        ticketsPerBook: 30,     // Maine standard for most games; admin can adjust per-game
        state:          'ME',
        category:       'instant',
        active:         true,
      });
    }
  }

  console.log(`[seed] ${rows.length} Maine games to check/insert…`);
  let created = 0, skipped = 0;

  for (const row of rows) {
    const existing = await prisma.lotteryTicketCatalog.findFirst({
      where: {
        state: row.state,
        name: row.name,
        ticketPrice: row.ticketPrice,
      },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    await prisma.lotteryTicketCatalog.create({ data: row });
    created += 1;
  }

  console.log(`[seed] done. ${created} created, ${skipped} already present.`);
  console.log('\nNext step: open Admin → Lottery → Ticket Catalog and fill in the 3-digit Game Numbers from the Maine Lottery retailer bulletin. Without Game Numbers, scan matching will not find these games — but they are visible to ME stores for manual selection.');
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
