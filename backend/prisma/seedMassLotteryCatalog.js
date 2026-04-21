/**
 * seedMassLotteryCatalog.js
 *
 * Seeds Massachusetts scratch + draw games into LotteryTicketCatalog.
 *
 * Data retrieved 2026-04-21 from masslottery.com's internal /api/v1/games
 * endpoint (undocumented). The `id` field in that response is the
 * 3-digit game number that appears in the barcode GGG-BBBBBB-TTT —
 * confirmed by cross-referencing sample ticket "498-027632-128"
 * ($1,000,000 GO FOR THE GREEN, id=498).
 *
 * Default ticketsPerBook set to 50 — MA's most common pack size.
 * Admin can adjust individually via Admin → Lottery → Edit.
 *
 * Idempotent: skips on (state='MA', gameNumber).
 *
 * Run: `node prisma/seedMassLotteryCatalog.js`
 */

import prisma from '../src/config/postgres.js';

// ── Draw & terminal games (7) ──────────────────────────────────────────────
const MA_DRAW_GAMES = [
  { id: 17, name: 'The Numbers Game',  price: 0.25 },
  { id: 12, name: 'Mass Cash',         price: 1 },
  { id: 11, name: 'Megabucks',         price: 2 },
  { id: 10, name: 'Powerball',         price: 2 },
  { id: 13, name: 'Mega Millions',     price: 5 },
  { id: 15, name: 'Keno',              price: 1 },
  { id: 16, name: 'Wheel of Luck',     price: 1 },
];

// ── Scratch games — pulled from masslottery.com/api/v1/games?type=Scratch ─
// Format: [id, name, price, startDate]
const MA_SCRATCH_GAMES = [
  [525, '$50,000 Star Cashword',                     2,  '2026-04-10'],
  [542, '$15,000,000 MAGNIFICENT MILLIONS',          30, '2026-03-31'],
  [541, '$4,000,000 EXTREME Cash',                   10, '2026-03-31'],
  [539, 'EXTREME GREEN',                             5,  '2026-03-31'],
  [540, '$250,000 JACKPOT',                          5,  '2026-03-31'],
  [538, '777 SLOTS',                                 2,  '2026-03-31'],
  [537, '$10,000 SILVER STRIKE',                     1,  '2026-03-31'],
  [536, '$2,000,000 STACKED',                        20, '2026-02-17'],
  [535, '$4,000,000 CASH DOUBLER',                   10, '2026-02-17'],
  [533, 'LOTERIA™',                                  5,  '2026-02-17'],
  [534, '$1,000,000 HIGH ROLLER',                    5,  '2026-02-17'],
  [532, 'WIN IT ALL BONUS',                          2,  '2026-02-17'],
  [531, '2 FOR $1',                                  1,  '2026-02-17'],
  [522, '$50 in a Flash',                            1,  '2026-01-15'],
  [520, '$25, $50 and $250 CELEBRATION BLOWOUT',     5,  '2026-01-15'],
  [530, '$10,000,000 CASHWORD',                      30, '2026-01-06'],
  [529, '$4,000,000 IN THE MONEY',                   10, '2026-01-06'],
  [498, '$1,000,000 GO FOR THE GREEN',               5,  '2026-01-06'],
  [528, 'RUBY MINE 50X',                             5,  '2026-01-06'],
  [527, '$100,000 MULTIPLIER MANIA',                 2,  '2026-01-06'],
  [493, '$10,000 DOUBLE WIN',                        1,  '2026-01-06'],
  [524, 'Power Play™ Cashword',                      2,  '2025-12-29'],
  [546, 'WINNER WINNER CHICKEN DINNER',              2,  '2025-12-26'],
  [523, '$5,000,000 100X CASHWORD',                  20, '2025-12-11'],
  [519, '$250,000 WINTER WINNINGS',                  20, '2025-10-14'],
  [518, 'MERRY-MINT BLOWOUT',                        10, '2025-10-14'],
  [517, '$200,000 ELF CASHWORD',                     5,  '2025-10-14'],
  [516, '$1,000,000 WINTER WINNINGS',                5,  '2025-10-14'],
  [515, '$100,000 WINTER WINNINGS',                  2,  '2025-10-14'],
  [514, '$10,000 WINTER WINNINGS',                   1,  '2025-10-14'],
  [521, '$2,000,000 50X CASHWORD 2025',              10, '2025-10-03'],
  [513, '$500 MANIA',                                10, '2025-09-09'],
  [512, '$200,000 HALLOWEEN',                        5,  '2025-09-09'],
  [510, 'GHOSTBUSTERS™',                             5,  '2025-09-09'],
  [511, '$100,000 BONUS SCRATCH',                    2,  '2025-09-09'],
  [509, '$10,000,000 INSTANT MILLIONS',              20, '2025-08-12'],
  [508, '$100,000 MAX WINNINGS',                     10, '2025-08-12'],
  [504, '$1,000,000 BIG MONEY',                      5,  '2025-08-12'],
  [507, '$100,000 TWO FOR THE MONEY',                2,  '2025-08-12'],
  [494, '$10,000 BONUS PLAY',                        1,  '2025-08-12'],
  [497, '$1,000,000 BONUS WINS',                     5,  '2025-07-15'],
  [496, '$500 CA$H',                                 5,  '2025-07-15'],
  [495, '$100 STACKED',                              2,  '2025-07-15'],
  [505, 'WINNER WINNER CHICKEN DINNER',              2,  '2025-07-15'],
  [506, '$25, $50 and $250 CELEBRATION BLOWOUT',     5,  '2025-06-20'],
  [489, '200X',                                      20, '2025-06-10'],
  [488, '100X',                                      10, '2025-06-10'],
  [487, '50X',                                       5,  '2025-06-10'],
  [486, '20X',                                       2,  '2025-06-10'],
  [485, '10X',                                       1,  '2025-06-10'],
  [490, '$25,000,000 MEGA MONEY',                    50, '2025-05-13'],
  [381, '$500,000 CASHWORD CORNERS',                 5,  '2025-05-05'],
  [477, '$50, $100 and $500 BLOWOUT',                10, '2025-04-18'],
  [491, '$15,000,000 COLOSSAL MILLIONS',             30, '2025-04-15'],
  [483, '$4,000,000 CASH KING DOUBLER',              10, '2025-04-15'],
  [474, 'TRIPLE 777',                                5,  '2025-04-15'],
  [481, '$100,000 DOUBLE MATCH',                     2,  '2025-04-15'],
  [482, '$25, $50 and $250 CELEBRATION BLOWOUT',     5,  '2025-03-04'],
  [471, '$50,000 Star Cashword',                     2,  '2025-02-20'],
  [484, '$2,500 A WEEK FOR LIFE',                    10, '2025-02-18'],
  [480, '$1,000 A WEEK FOR LIFE',                    5,  '2025-02-18'],
  [479, '$200 A WEEK FOR LIFE',                      2,  '2025-02-18'],
  [478, '$100 A WEEK FOR LIFE',                      1,  '2025-02-18'],
  [472, 'Big Blue Bonus Cashword 2025',              5,  '2025-02-04'],
  [470, '$2,000,000 DIAMOND CASHWORD',               10, '2025-01-07'],
  [469, '$4,000,000 GOLD 50X',                       10, '2025-01-07'],
  [467, 'EMERALD MINE 50X',                          5,  '2025-01-06'],
  [465, '$25, $50 and $250 CELEBRATION BLOWOUT',     5,  '2025-01-07'],
  [468, '$100,000 TRIPLE 333',                       2,  '2025-01-06'],
  [476, 'LUCK OF THE IRISH TRIPLER',                 1,  '2025-01-06'],
  [453, '$50 in a Flash',                            1,  '2025-01-03'],
  [466, 'CELTICS BANNER 18',                         10, '2024-11-19'],
  [463, 'MERRY & BRIGHT BLOWOUT',                    10, '2024-10-15'],
  [462, '$2,500,000 MERRY & BRIGHT',                 10, '2024-10-15'],
  [461, '$1,000,000 MERRY & BRIGHT',                 5,  '2024-10-15'],
  [460, '$100,000 MERRY & BRIGHT',                   2,  '2024-10-15'],
  [464, 'NAUGHTY OR NICE CASHWORD',                  2,  '2024-10-15'],
  [459, '$10,000 MERRY & BRIGHT',                    1,  '2024-10-15'],
  [458, 'DIAMOND DELUXE',                            30, '2024-09-10'],
  [457, '$4,000,000 BONUS MONEY',                    10, '2024-09-10'],
  [456, '$1,000,000 ULTIMATE 7',                     5,  '2024-09-10'],
  [455, 'LUCKY 13',                                  5,  '2024-09-10'],
  [454, '$100,000 WINNING 7s',                       2,  '2024-09-10'],
  [452, '$10,000,000 BONANZA',                       20, '2024-08-06'],
  [451, '$50, $100 and $500 BLOWOUT',                10, '2024-08-06'],
  [450, 'GAME OF THRONES™',                          5,  '2024-08-06'],
  [448, '$100,000 CASH EXTRA',                       2,  '2024-08-06'],
  [447, '$10,000 WIN ALL',                           1,  '2024-08-06'],
  [437, '$2,000,000 50X CASHWORD 2024',              10, '2024-06-25'],
  [438, '$5,000,000 100X CASHWORD 2024',             20, '2024-06-13'],
  [445, 'BONUS 100X',                                10, '2024-06-04'],
  [444, 'BONUS 50X',                                 5,  '2024-06-04'],
  [443, 'BONUS 20X',                                 2,  '2024-06-04'],
  [442, 'BONUS 10X',                                 1,  '2024-06-04'],
  [446, '$50 in a Flash',                            1,  '2024-05-29'],
  [439, '$100,000 POWER SHOT',                       2,  '2024-05-07'],
  [441, '$4,000,000 LION\'S SHARE',                  10, '2024-04-16'],
  [440, '$1,000,000 STACKS OF CASH',                 5,  '2024-04-11'],
  [431, '$4,000,000 Monopoly Doubler',               10, '2024-02-20'],
  [430, '$1,000,000 Monopoly Doubler',               5,  '2024-02-20'],
  [429, '$100,000 MONOPOLY Doubler',                 2,  '2024-02-20'],
  [428, '$10,000 MONOPOLY Doubler',                  1,  '2024-02-20'],
  [433, 'Lifetime Millions',                         50, '2024-02-06'],
  [434, '$50 In a Flash',                            1,  '2024-01-16'],
  [427, '$4,000,000 BONUS BUCKS',                    10, '2024-01-09'],
  [386, 'Gold Mine 50X',                             5,  '2024-01-09'],
  [426, 'Quick $100s',                               2,  '2024-01-09'],
  [425, 'Hot 7s',                                    1,  '2024-01-09'],
  [424, 'Cold Cash Blowout',                         10, '2023-10-17'],
  [423, '$50,000 Winter Green',                      10, '2023-10-17'],
  [416, '$5,000 Snow Much Money',                    1,  '2023-10-17'],
  [409, '$10,000,000 Cash Blast',                    20, '2023-09-12'],
  [419, '777',                                       10, '2023-09-12'],
  [405, 'Diamonds and Dollars',                      5,  '2023-09-12'],
  [407, 'Universal Monsters ™',                      5,  '2023-09-12'],
  [418, 'Double Cash',                               2,  '2023-09-12'],
  [417, 'Triple Tripler',                            1,  '2023-09-12'],
  [396, 'BIG BLUE BONUS CASHWORD 2023',              5,  '2023-08-28'],
  [414, '$50,000 Star Cashword',                     2,  '2023-08-23'],
  [415, 'Bingo',                                     2,  '2023-08-07'],
  [413, '$4,000,000 Bonus Loot',                     10, '2023-08-01'],
  [408, 'Instant $500s',                             10, '2023-08-01'],
  [412, 'Waves of Cash',                             5,  '2023-08-01'],
  [411, '$100,000 Extra Play',                       2,  '2023-08-01'],
  [410, '$50 in a Flash',                            1,  '2023-08-01'],
  [404, '300X',                                      30, '2023-06-13'],
  [403, '100X CASH',                                 10, '2023-06-13'],
  [397, '$2,000,000 50X Cashword',                   10, '2023-06-27'],
  [394, 'BATTLESHIP™',                               2,  '2023-05-09'],
  [393, '$10,000,000 PREMIER CASH',                  20, '2023-04-18'],
  [392, '$4,000,000 DIAMONDS',                       10, '2023-04-18'],
  [382, '$5,000,000 100X CASHWORD',                  20, '2023-02-28'],
  [390, '$10 DECADE OF DOLLARS',                     10, '2023-02-21'],
  [387, 'BILLION DOLLAR EXTRAVAGANZA',               50, '2023-02-07'],
  [356, '$500,000 CASHWORD CORNERS 2023',            5,  '2023-01-30'],
  [385, '$10,000,000 LUCKY BUCKS',                   20, '2023-01-10'],
  [368, '$4,000,000 PLATINUM JACKPOT',               10, '2023-01-10'],
  [383, 'POWER PLAY® CASHWORD',                      2,  '2023-01-09'],
  [375, '$10,000,000 CASH KING',                     20, '2022-09-13'],
  [365, 'EMERALDS 50X',                              10, '2022-09-13'],
  [373, 'MILLIONS',                                  30, '2022-08-02'],
  [364, '$4,000,000 MONEY BAGS',                     10, '2022-08-02'],
  [374, '$1,000,000 WINNING 7',                      5,  '2022-08-02'],
];

// Games older than this date are seeded but marked inactive — they've
// generally ended and are only kept for historical reference.
const ACTIVE_CUTOFF = new Date('2024-01-01');

async function main() {
  let created = 0, skipped = 0;

  // Draw games
  for (const g of MA_DRAW_GAMES) {
    const existing = await prisma.lotteryTicketCatalog.findFirst({
      where: { state: 'MA', gameNumber: String(g.id) },
    });
    if (existing) { skipped += 1; continue; }
    await prisma.lotteryTicketCatalog.create({
      data: {
        name:           g.name,
        gameNumber:     String(g.id),
        ticketPrice:    g.price,
        ticketsPerBook: 1,              // draw games aren't packs
        state:          'MA',
        category:       'draw',
        active:         true,
      },
    });
    created += 1;
  }

  // Scratch games
  for (const [id, name, price, startDate] of MA_SCRATCH_GAMES) {
    const existing = await prisma.lotteryTicketCatalog.findFirst({
      where: { state: 'MA', gameNumber: String(id) },
    });
    if (existing) { skipped += 1; continue; }
    const isActive = new Date(startDate) >= ACTIVE_CUTOFF;
    await prisma.lotteryTicketCatalog.create({
      data: {
        name,
        gameNumber:     String(id),
        ticketPrice:    price,
        ticketsPerBook: 50,             // MA most common pack size; admin can adjust
        state:          'MA',
        category:       'instant',
        active:         isActive,
      },
    });
    created += 1;
  }

  console.log(`[seed] MA catalog: ${created} created, ${skipped} already present.`);
  console.log(`  - ${MA_DRAW_GAMES.length} draw games + ${MA_SCRATCH_GAMES.length} scratch games sourced from masslottery.com.`);
  console.log(`  - Scratch games launched before ${ACTIVE_CUTOFF.toISOString().slice(0, 10)} are seeded INACTIVE (historical).`);
  console.log(`  - Verify the 3-digit gameNumber against a sample ticket barcode before production rollout.`);
}

main()
  .catch((err) => { console.error(err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
