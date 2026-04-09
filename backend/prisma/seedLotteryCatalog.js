/**
 * seedLotteryCatalog.js — Platform-wide Lottery Ticket Catalog Seed
 *
 * Populates the `lottery_ticket_catalog` table with realistic scratch ticket
 * entries for multiple US states and Canadian provinces.
 *
 * These are superadmin-managed entries visible to stores in the matching state.
 *
 * Run via:
 *   node prisma/seedLotteryCatalog.js
 *
 * To wipe & re-seed:
 *   node prisma/seedLotteryCatalog.js --reset
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();
const RESET  = process.argv.includes('--reset');

// ─────────────────────────────────────────────────────────────────────────────
// CATALOG DATA — keyed by state code
// Each entry: { name, gameNumber, ticketPrice, ticketsPerBook, category }
// ─────────────────────────────────────────────────────────────────────────────

const CATALOG = [

  // ── ONTARIO (ON) — OLG Instant Tickets ──────────────────────────────────
  { state: 'ON', name: '$100,000 Jackpot',        gameNumber: 'OLG-3001', ticketPrice: 5.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: '$500,000 Jackpot',        gameNumber: 'OLG-3002', ticketPrice: 10.00, ticketsPerBook: 500, category: 'instant' },
  { state: 'ON', name: '$1,000,000 Jackpot',      gameNumber: 'OLG-3003', ticketPrice: 20.00, ticketsPerBook: 300, category: 'instant' },
  { state: 'ON', name: '$2,000,000 Jackpot',      gameNumber: 'OLG-3004', ticketPrice: 30.00, ticketsPerBook: 200, category: 'instant' },
  { state: 'ON', name: 'Lucky Lines',             gameNumber: 'OLG-2201', ticketPrice: 2.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: 'Crossword',               gameNumber: 'OLG-2202', ticketPrice: 3.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: 'Wheel of Fortune',        gameNumber: 'OLG-2203', ticketPrice: 5.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: '7, 11, 21',               gameNumber: 'OLG-2204', ticketPrice: 1.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: 'Break the Bank',          gameNumber: 'OLG-2205', ticketPrice: 3.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: 'Gold Rush',               gameNumber: 'OLG-2206', ticketPrice: 2.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: 'Instant Bingo',           gameNumber: 'OLG-2207', ticketPrice: 3.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: 'Bonus Cashword',          gameNumber: 'OLG-2208', ticketPrice: 5.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: 'Fast Cash',               gameNumber: 'OLG-2209', ticketPrice: 2.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: 'Lucky 7s',                gameNumber: 'OLG-2211', ticketPrice: 2.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: 'Diamond 7s',              gameNumber: 'OLG-2212', ticketPrice: 3.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: 'Triple 777',              gameNumber: 'OLG-2213', ticketPrice: 5.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: 'Extra Cash',              gameNumber: 'OLG-2215', ticketPrice: 1.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: 'Cash Blitz',              gameNumber: 'OLG-2216', ticketPrice: 5.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'ON', name: 'POKER Lotto',             gameNumber: 'OLG-5001', ticketPrice: 2.00,  ticketsPerBook: 600, category: 'draw'    },
  { state: 'ON', name: 'KENO',                    gameNumber: 'OLG-5002', ticketPrice: 1.00,  ticketsPerBook: 600, category: 'draw'    },

  // ── BRITISH COLUMBIA (BC) — BC Lottery Corp ───────────────────────────────
  { state: 'BC', name: 'Lucky Lines BC',          gameNumber: 'BCLC-101', ticketPrice: 2.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'BC', name: 'Crossword BC',            gameNumber: 'BCLC-102', ticketPrice: 3.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'BC', name: 'Cash for Life',           gameNumber: 'BCLC-103', ticketPrice: 5.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'BC', name: 'Decade of Dollars',       gameNumber: 'BCLC-104', ticketPrice: 10.00, ticketsPerBook: 500, category: 'instant' },
  { state: 'BC', name: 'Keno BC',                 gameNumber: 'BCLC-201', ticketPrice: 1.00,  ticketsPerBook: 600, category: 'draw'    },
  { state: 'BC', name: 'Gold Rush BC',            gameNumber: 'BCLC-105', ticketPrice: 2.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'BC', name: 'Super 7s BC',             gameNumber: 'BCLC-106', ticketPrice: 5.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'BC', name: '$500,000 BC Winner',      gameNumber: 'BCLC-107', ticketPrice: 10.00, ticketsPerBook: 500, category: 'instant' },

  // ── ALBERTA (AB) ──────────────────────────────────────────────────────────
  { state: 'AB', name: 'Instant Millions AB',     gameNumber: 'ALC-501',  ticketPrice: 5.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'AB', name: 'Crossword AB',            gameNumber: 'ALC-502',  ticketPrice: 3.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'AB', name: 'Lucky Lines AB',          gameNumber: 'ALC-503',  ticketPrice: 2.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'AB', name: 'Cash 7s AB',              gameNumber: 'ALC-504',  ticketPrice: 2.00,  ticketsPerBook: 600, category: 'instant' },
  { state: 'AB', name: 'Keno AB',                 gameNumber: 'ALC-601',  ticketPrice: 1.00,  ticketsPerBook: 600, category: 'draw'    },
  { state: 'AB', name: '$1,000,000 Jackpot AB',   gameNumber: 'ALC-505',  ticketPrice: 20.00, ticketsPerBook: 300, category: 'instant' },

  // ── TEXAS (TX) — Texas Lottery ────────────────────────────────────────────
  { state: 'TX', name: '$1 Gold Rush',            gameNumber: 'TX-1001',  ticketPrice: 1.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'TX', name: '$2 Cash Money',           gameNumber: 'TX-2001',  ticketPrice: 2.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'TX', name: '$5 Loteria™',             gameNumber: 'TX-5001',  ticketPrice: 5.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'TX', name: '$5 100X the Cash',        gameNumber: 'TX-5002',  ticketPrice: 5.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'TX', name: '$10 Black',               gameNumber: 'TX-1001A', ticketPrice: 10.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'TX', name: '$10 Maximum Millions',    gameNumber: 'TX-1002A', ticketPrice: 10.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'TX', name: '$20 Gold Bullion',        gameNumber: 'TX-2001A', ticketPrice: 20.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'TX', name: '$20 High Roller',         gameNumber: 'TX-2002A', ticketPrice: 20.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'TX', name: '$30 Colossal Cashword',   gameNumber: 'TX-3001A', ticketPrice: 30.00, ticketsPerBook: 100, category: 'instant' },
  { state: 'TX', name: '$50 Grand Slam of Cash',  gameNumber: 'TX-5001A', ticketPrice: 50.00, ticketsPerBook: 60,  category: 'instant' },
  { state: 'TX', name: 'Pick 3',                  gameNumber: 'TX-P3',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'TX', name: 'Daily 4',                 gameNumber: 'TX-D4',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'TX', name: 'Cash Five',               gameNumber: 'TX-CF',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },

  // ── FLORIDA (FL) — Florida Lottery ───────────────────────────────────────
  { state: 'FL', name: '$1 Hit $100',             gameNumber: 'FL-1001',  ticketPrice: 1.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'FL', name: '$2 Gold Rush Classic',    gameNumber: 'FL-2001',  ticketPrice: 2.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'FL', name: '$5 Cash Spectacular',     gameNumber: 'FL-5001',  ticketPrice: 5.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'FL', name: '$10 Millionaire',         gameNumber: 'FL-1002A', ticketPrice: 10.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'FL', name: '$20 Florida Riches',      gameNumber: 'FL-2001A', ticketPrice: 20.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'FL', name: '$30 300X',                gameNumber: 'FL-3001A', ticketPrice: 30.00, ticketsPerBook: 100, category: 'instant' },
  { state: 'FL', name: 'Pick 2',                  gameNumber: 'FL-P2',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'FL', name: 'Pick 3',                  gameNumber: 'FL-P3',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'FL', name: 'Pick 4',                  gameNumber: 'FL-P4',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'FL', name: 'Lucky Money',             gameNumber: 'FL-LM',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },

  // ── NEW YORK (NY) — NY Lottery ────────────────────────────────────────────
  { state: 'NY', name: '$1 Take 5',               gameNumber: 'NY-T5',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'NY', name: '$1 Cash 4 Life',          gameNumber: 'NY-C4L',   ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'NY', name: '$2 Win 4',                gameNumber: 'NY-W4',    ticketPrice: 2.00,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'NY', name: '$3 Holiday Luck',         gameNumber: 'NY-HL',    ticketPrice: 3.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'NY', name: '$5 Gold Rush NY',         gameNumber: 'NY-GR',    ticketPrice: 5.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'NY', name: '$10 Millionaire',         gameNumber: 'NY-M10',   ticketPrice: 10.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'NY', name: '$20 Super Cashword',      gameNumber: 'NY-SC20',  ticketPrice: 20.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'NY', name: '$30 Platinum Payout',     gameNumber: 'NY-PP30',  ticketPrice: 30.00, ticketsPerBook: 100, category: 'instant' },
  { state: 'NY', name: '$1 Numbers',              gameNumber: 'NY-N1',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },

  // ── CALIFORNIA (CA) — California Lottery ─────────────────────────────────
  { state: 'CA', name: '$1 Lucky',                gameNumber: 'CA-1001',  ticketPrice: 1.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'CA', name: '$2 Holiday Joy',          gameNumber: 'CA-2001',  ticketPrice: 2.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'CA', name: '$3 Monopoly',             gameNumber: 'CA-3001',  ticketPrice: 3.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'CA', name: '$5 Big Spin',             gameNumber: 'CA-5001',  ticketPrice: 5.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'CA', name: '$10 Fortune Wheel',       gameNumber: 'CA-1001A', ticketPrice: 10.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'CA', name: '$20 Diamond Riches',      gameNumber: 'CA-2001A', ticketPrice: 20.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'CA', name: '$30 Ultimate',            gameNumber: 'CA-3001A', ticketPrice: 30.00, ticketsPerBook: 100, category: 'instant' },
  { state: 'CA', name: 'Fantasy 5',               gameNumber: 'CA-F5',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'CA', name: 'Daily 3',                 gameNumber: 'CA-D3',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'CA', name: 'Daily 4',                 gameNumber: 'CA-D4',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'CA', name: 'SuperLotto Plus',         gameNumber: 'CA-SL',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },

  // ── ILLINOIS (IL) — Illinois Lottery ─────────────────────────────────────
  { state: 'IL', name: '$1 Instant Millions IL',  gameNumber: 'IL-1001',  ticketPrice: 1.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'IL', name: '$2 Jumbo Bucks IL',       gameNumber: 'IL-2001',  ticketPrice: 2.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'IL', name: '$5 Big Money IL',         gameNumber: 'IL-5001',  ticketPrice: 5.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'IL', name: '$10 Super Cashword IL',   gameNumber: 'IL-1001A', ticketPrice: 10.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'IL', name: '$20 Grand IL',            gameNumber: 'IL-2001A', ticketPrice: 20.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'IL', name: 'Pick 3 IL',               gameNumber: 'IL-P3',    ticketPrice: 0.50,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'IL', name: 'Pick 4 IL',               gameNumber: 'IL-P4',    ticketPrice: 0.50,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'IL', name: 'Lotto IL',                gameNumber: 'IL-LT',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },

  // ── PENNSYLVANIA (PA) — PA Lottery ───────────────────────────────────────
  { state: 'PA', name: '$1 Wild 7s PA',           gameNumber: 'PA-1001',  ticketPrice: 1.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'PA', name: '$2 Double Dough PA',      gameNumber: 'PA-2001',  ticketPrice: 2.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'PA', name: '$5 Cash in Hand PA',      gameNumber: 'PA-5001',  ticketPrice: 5.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'PA', name: '$10 Gold Rush PA',        gameNumber: 'PA-1001A', ticketPrice: 10.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'PA', name: '$20 Millionaire PA',      gameNumber: 'PA-2001A', ticketPrice: 20.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'PA', name: 'Cash 5 PA',               gameNumber: 'PA-C5',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'PA', name: 'Pick 2 PA',               gameNumber: 'PA-P2',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'PA', name: 'Pick 3 PA',               gameNumber: 'PA-P3',    ticketPrice: 0.50,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'PA', name: 'Pick 4 PA',               gameNumber: 'PA-P4',    ticketPrice: 0.50,  ticketsPerBook: 300, category: 'draw'    },

  // ── OHIO (OH) — Ohio Lottery ──────────────────────────────────────────────
  { state: 'OH', name: '$1 Lucky for Life OH',    gameNumber: 'OH-1001',  ticketPrice: 1.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'OH', name: '$2 Cash Explosion OH',    gameNumber: 'OH-2001',  ticketPrice: 2.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'OH', name: '$5 Hit $500 OH',          gameNumber: 'OH-5001',  ticketPrice: 5.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'OH', name: '$10 Millionaire OH',      gameNumber: 'OH-1001A', ticketPrice: 10.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'OH', name: '$20 Super Jackpot OH',    gameNumber: 'OH-2001A', ticketPrice: 20.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'OH', name: 'Pick 3 OH',               gameNumber: 'OH-P3',    ticketPrice: 0.50,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'OH', name: 'Pick 4 OH',               gameNumber: 'OH-P4',    ticketPrice: 0.50,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'OH', name: 'Rolling Cash 5 OH',       gameNumber: 'OH-RC5',   ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },

  // ── MICHIGAN (MI) — Michigan Lottery ─────────────────────────────────────
  { state: 'MI', name: '$1 Lucky 7s MI',          gameNumber: 'MI-1001',  ticketPrice: 1.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'MI', name: '$2 Bingo MI',             gameNumber: 'MI-2001',  ticketPrice: 2.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'MI', name: '$3 Triple Play MI',       gameNumber: 'MI-3001',  ticketPrice: 3.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'MI', name: '$5 Fast $500 MI',         gameNumber: 'MI-5001',  ticketPrice: 5.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'MI', name: '$10 Big Cash MI',         gameNumber: 'MI-1001A', ticketPrice: 10.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'MI', name: '$20 Blue MI',             gameNumber: 'MI-2001A', ticketPrice: 20.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'MI', name: 'Club Keno MI',            gameNumber: 'MI-CK',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'MI', name: 'Fantasy 5 MI',            gameNumber: 'MI-F5',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },

  // ── GEORGIA (GA) — Georgia Lottery ───────────────────────────────────────
  { state: 'GA', name: '$1 Jumbo Bucks GA',       gameNumber: 'GA-1001',  ticketPrice: 1.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'GA', name: '$2 Gold Rush GA',         gameNumber: 'GA-2001',  ticketPrice: 2.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'GA', name: '$5 100X GA',              gameNumber: 'GA-5001',  ticketPrice: 5.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'GA', name: '$10 Hit $1000 GA',        gameNumber: 'GA-1001A', ticketPrice: 10.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'GA', name: '$20 Millionaire GA',      gameNumber: 'GA-2001A', ticketPrice: 20.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'GA', name: 'Cash 3 GA',               gameNumber: 'GA-C3',    ticketPrice: 0.50,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'GA', name: 'Cash 4 GA',               gameNumber: 'GA-C4',    ticketPrice: 0.50,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'GA', name: 'Fantasy 5 GA',            gameNumber: 'GA-F5',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },

  // ── MAINE (ME) — Maine State Lottery ─────────────────────────────────────
  { state: 'ME', name: '$1 Lucky Stars ME',       gameNumber: 'ME-1001',  ticketPrice: 1.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'ME', name: '$2 Wild Cash ME',         gameNumber: 'ME-2001',  ticketPrice: 2.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'ME', name: '$3 Triple 7s ME',         gameNumber: 'ME-3001',  ticketPrice: 3.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'ME', name: '$5 Lucky Times 10 ME',    gameNumber: 'ME-5001',  ticketPrice: 5.00,  ticketsPerBook: 300, category: 'instant' },
  { state: 'ME', name: '$10 Big Tens ME',         gameNumber: 'ME-1001A', ticketPrice: 10.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'ME', name: '$20 Fast $20s ME',        gameNumber: 'ME-2001A', ticketPrice: 20.00, ticketsPerBook: 150, category: 'instant' },
  { state: 'ME', name: 'Pick 3 ME',               gameNumber: 'ME-P3',    ticketPrice: 0.50,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'ME', name: 'Pick 4 ME',               gameNumber: 'ME-P4',    ticketPrice: 0.50,  ticketsPerBook: 300, category: 'draw'    },
  { state: 'ME', name: 'Megabucks Plus ME',       gameNumber: 'ME-MB',    ticketPrice: 1.00,  ticketsPerBook: 300, category: 'draw'    },

];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const stateCount = [...new Set(CATALOG.map(c => c.state))].length;
  console.log(`\n🎟️  Seeding Lottery Ticket Catalog…`);
  console.log(`   ${CATALOG.length} tickets across ${stateCount} states/provinces\n`);

  if (RESET) {
    const deleted = await prisma.lotteryTicketCatalog.deleteMany({});
    console.log(`   🗑️  Cleared ${deleted.count} existing catalog entries.`);
  }

  let created = 0;
  let skipped = 0;

  for (const entry of CATALOG) {
    // Skip duplicates (idempotent re-runs without --reset)
    const existing = await prisma.lotteryTicketCatalog.findFirst({
      where: { gameNumber: entry.gameNumber, state: entry.state },
    });
    if (existing) { skipped++; continue; }

    await prisma.lotteryTicketCatalog.create({
      data: {
        name:           entry.name,
        gameNumber:     entry.gameNumber,
        ticketPrice:    entry.ticketPrice,
        ticketsPerBook: entry.ticketsPerBook,
        state:          entry.state,
        category:       entry.category,
        active:         true,
        createdBy:      'superadmin-seed',
      },
    });
    created++;
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const byState = {};
  for (const e of CATALOG) {
    byState[e.state] = (byState[e.state] || 0) + 1;
  }

  console.log('✅ Catalog seed complete!\n');
  console.log(`   Created : ${created}`);
  console.log(`   Skipped : ${skipped} (already existed)`);
  console.log('\n   Tickets by state:');
  for (const [state, count] of Object.entries(byState)) {
    console.log(`     ${state.padEnd(4)} → ${count} tickets`);
  }
  console.log('');
}

main()
  .catch(e => { console.error('❌ Catalog seed failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
