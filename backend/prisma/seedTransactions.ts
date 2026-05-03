// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * Seed Transactions — Storeveu POS Portal
 *
 * Generates ~2,500-4,000 realistic POS transactions spread across the last 90 days.
 * Run via: node prisma/seedTransactions.js
 *
 * Patterns:
 *   - Weekday: 25-40 txns/day, Weekend (Fri-Sun): 40-65 txns/day
 *   - Peak hours 11am-1pm and 5pm-7pm, minimal 12am-6am
 *   - Average transaction ~$35, range $5-$150
 *   - 55% card, 30% cash, 10% EBT, 5% mixed
 *   - ~2% voided, ~1% refund
 *   - Gradual sales growth over 90 days
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────
// SEEDED RANDOM (deterministic for reproducibility)
// ─────────────────────────────────────────────────────────
let _seed = 42;
function seededRandom() {
  _seed = (_seed * 16807 + 0) % 2147483647;
  return (_seed - 1) / 2147483646;
}
function randInt(min, max) {
  return Math.floor(seededRandom() * (max - min + 1)) + min;
}
function randFloat(min, max) {
  return seededRandom() * (max - min) + min;
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function weightedPick(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = seededRandom() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ─────────────────────────────────────────────────────────
// PRODUCT CATALOG (matches seed.js products)
// ─────────────────────────────────────────────────────────
const PRODUCTS = [
  // BEER
  { name: 'Bud Light 12pk Cans',            dept: 'BEER',    price: 14.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.60,  weight: 3 },
  { name: 'Budweiser 12pk Cans',             dept: 'BEER',    price: 14.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.60,  weight: 2 },
  { name: 'Coors Light 12pk Cans',           dept: 'BEER',    price: 14.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.60,  weight: 2 },
  { name: 'Miller Lite 12pk Cans',           dept: 'BEER',    price: 14.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.60,  weight: 1 },
  { name: 'Corona Extra 6pk Bottles',        dept: 'BEER',    price: 10.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.30,  weight: 2 },
  { name: 'Modelo Especial 6pk Cans',        dept: 'BEER',    price: 10.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.30,  weight: 2 },
  { name: 'Blue Moon Belgian White 6pk',     dept: 'BEER',    price: 10.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.30,  weight: 1 },
  { name: 'Pabst Blue Ribbon 24pk Cans',     dept: 'BEER',    price: 22.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 1.20,  weight: 1 },

  // WINE
  { name: 'Barefoot Cabernet Sauvignon',     dept: 'WINE',    price:  7.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.15,  weight: 2 },
  { name: 'Barefoot Pinot Grigio',           dept: 'WINE',    price:  7.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.15,  weight: 2 },
  { name: 'Josh Cellars Cabernet Sauvignon', dept: 'WINE',    price: 12.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.15,  weight: 1 },
  { name: 'Apothic Red Blend',               dept: 'WINE',    price:  9.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.15,  weight: 1 },

  // SPIRITS
  { name: "Tito's Handmade Vodka",           dept: 'SPIRITS', price: 22.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.15,  weight: 2 },
  { name: "Jack Daniel's Old No. 7",         dept: 'SPIRITS', price: 26.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.15,  weight: 1 },
  { name: 'Jameson Irish Whiskey',           dept: 'SPIRITS', price: 24.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.15,  weight: 1 },
  { name: 'Captain Morgan Spiced Rum',       dept: 'SPIRITS', price: 18.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.15,  weight: 1 },

  // CIDER / SELTZER
  { name: 'White Claw Black Cherry 6pk',     dept: 'CIDER',   price: 10.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.30,  weight: 3 },
  { name: 'White Claw Mango 6pk',            dept: 'CIDER',   price: 10.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.30,  weight: 2 },
  { name: 'Truly Wild Berry 6pk',            dept: 'CIDER',   price: 10.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.30,  weight: 1 },
  { name: 'Twisted Tea Original 6pk',        dept: 'CIDER',   price: 10.99, taxClass: 'alcohol',  ebtEligible: false, depositAmt: 0.30,  weight: 2 },

  // TOBACCO
  { name: 'Marlboro Red Box King',           dept: 'TOBAC',   price: 11.99, taxClass: 'tobacco',  ebtEligible: false, depositAmt: 0,     weight: 4 },
  { name: 'Marlboro Gold Box King',          dept: 'TOBAC',   price: 11.99, taxClass: 'tobacco',  ebtEligible: false, depositAmt: 0,     weight: 3 },
  { name: 'Newport Menthol Box King',        dept: 'TOBAC',   price: 11.99, taxClass: 'tobacco',  ebtEligible: false, depositAmt: 0,     weight: 3 },
  { name: 'Camel Blue Box King',             dept: 'TOBAC',   price: 11.99, taxClass: 'tobacco',  ebtEligible: false, depositAmt: 0,     weight: 2 },

  // SNACKS
  { name: "Lay's Classic Potato Chips",      dept: 'SNACKS',  price:  4.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 5 },
  { name: 'Doritos Nacho Cheese',            dept: 'SNACKS',  price:  4.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 5 },
  { name: "Cheetos Flamin' Hot",             dept: 'SNACKS',  price:  4.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 3 },
  { name: 'Pringles Original',               dept: 'SNACKS',  price:  2.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 3 },
  { name: 'Snickers Bar',                    dept: 'SNACKS',  price:  1.89, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 6 },
  { name: "Reese's Peanut Butter Cups",      dept: 'SNACKS',  price:  1.79, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 5 },
  { name: 'KIND Dark Chocolate Nuts',        dept: 'SNACKS',  price:  1.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 2 },
  { name: 'Slim Jim Original',               dept: 'SNACKS',  price:  1.49, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 4 },

  // NON-ALC BEVERAGES
  { name: 'Coca-Cola',                       dept: 'BVNALC',  price:  2.29, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0.05,  weight: 8 },
  { name: 'Diet Coke',                       dept: 'BVNALC',  price:  2.29, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0.05,  weight: 4 },
  { name: 'Pepsi',                           dept: 'BVNALC',  price:  2.19, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0.05,  weight: 4 },
  { name: 'Mountain Dew',                    dept: 'BVNALC',  price:  2.19, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0.05,  weight: 3 },
  { name: 'Red Bull Energy Drink',           dept: 'BVNALC',  price:  3.49, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0.05,  weight: 5 },
  { name: 'Monster Energy Original',         dept: 'BVNALC',  price:  3.29, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0.05,  weight: 4 },
  { name: 'Gatorade Fruit Punch',            dept: 'BVNALC',  price:  2.49, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0.15,  weight: 3 },
  { name: 'Arizona Green Tea',               dept: 'BVNALC',  price:  1.29, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0.15,  weight: 4 },

  // WATER
  { name: 'Poland Spring Water',             dept: 'WATER',   price:  1.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0.05,  weight: 5 },
  { name: 'Poland Spring 24pk',              dept: 'WATER',   price:  5.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 1.20,  weight: 2 },

  // DAIRY
  { name: 'Hood Whole Milk',                 dept: 'DAIRY',   price:  4.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 4 },
  { name: 'Cabot Sharp Cheddar Cheese',      dept: 'DAIRY',   price:  5.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 2 },
  { name: 'Chobani Vanilla Greek Yogurt',    dept: 'DAIRY',   price:  1.79, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 3 },
  { name: 'Grade A Large Eggs Dozen',        dept: 'DAIRY',   price:  3.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 4 },

  // GROCERY
  { name: 'Wonder Classic White Bread',      dept: 'GROC',    price:  3.49, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 5 },
  { name: 'Heinz Tomato Ketchup',            dept: 'GROC',    price:  4.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 2 },
  { name: "Campbell's Chicken Noodle Soup",  dept: 'GROC',    price:  1.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 3 },
  { name: 'Cheerios Original',               dept: 'GROC',    price:  3.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 3 },

  // FROZEN
  { name: "Ben & Jerry's Choc Chip Cookie Dough", dept: 'FROZEN', price: 6.49, taxClass: 'grocery', ebtEligible: true, depositAmt: 0, weight: 3 },
  { name: 'DiGiorno Pepperoni Rising Crust',      dept: 'FROZEN', price: 8.99, taxClass: 'grocery', ebtEligible: true, depositAmt: 0, weight: 2 },
  { name: 'Hot Pockets Ham & Cheese 2pk',         dept: 'FROZEN', price: 3.99, taxClass: 'grocery', ebtEligible: true, depositAmt: 0, weight: 3 },

  // BAKERY
  { name: 'Thomas English Muffins 6pk',      dept: 'BAKED',   price:  3.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 2 },
  { name: "Entenmann's Glazed Donut 8pk",    dept: 'BAKED',   price:  4.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 3 },

  // PRODUCE
  { name: 'Banana',                          dept: 'PRODUCE', price:  0.59, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 5 },
  { name: 'Fuji Apple',                      dept: 'PRODUCE', price:  0.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 3 },
  { name: 'Avocado',                         dept: 'PRODUCE', price:  1.49, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 3 },
  { name: 'Organic Baby Spinach',            dept: 'PRODUCE', price:  3.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 2 },

  // MEAT
  { name: 'Bar-S Classic Franks 8ct',        dept: 'MEAT',    price:  3.49, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 2 },
  { name: "Jimmy Dean Sausage Patties 8ct",  dept: 'MEAT',    price:  6.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 2 },

  // DELI
  { name: 'Deli Ham Sliced (lb)',            dept: 'DELI',    price:  7.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 1 },
  { name: 'Deli Turkey Breast Sliced (lb)',  dept: 'DELI',    price:  8.99, taxClass: 'grocery',  ebtEligible: true,  depositAmt: 0,     weight: 1 },

  // HOT FOOD (prepared — taxable, not EBT)
  { name: 'Hot Dog (Roller Grill)',          dept: 'HOTFOOD', price:  2.49, taxClass: 'hot_food', ebtEligible: false, depositAmt: 0,     weight: 5 },
  { name: 'Breakfast Sandwich Egg & Cheese', dept: 'HOTFOOD', price:  3.99, taxClass: 'hot_food', ebtEligible: false, depositAmt: 0,     weight: 4 },
  { name: 'Slice of Pizza',                  dept: 'HOTFOOD', price:  2.99, taxClass: 'hot_food', ebtEligible: false, depositAmt: 0,     weight: 4 },
  { name: 'Mozzarella Sticks 5pc',           dept: 'HOTFOOD', price:  3.99, taxClass: 'hot_food', ebtEligible: false, depositAmt: 0,     weight: 2 },

  // COFFEE
  { name: 'Regular Coffee Small 12oz',       dept: 'COFFEE',  price:  1.99, taxClass: 'hot_food', ebtEligible: false, depositAmt: 0,     weight: 7 },
  { name: 'Regular Coffee Large 20oz',       dept: 'COFFEE',  price:  2.49, taxClass: 'hot_food', ebtEligible: false, depositAmt: 0,     weight: 5 },
  { name: 'Cappuccino 12oz',                 dept: 'COFFEE',  price:  2.99, taxClass: 'hot_food', ebtEligible: false, depositAmt: 0,     weight: 2 },

  // HBA (non-food, taxable, not EBT)
  { name: 'Advil Ibuprofen 200mg 24ct',     dept: 'HBA',     price:  7.99, taxClass: 'none',     ebtEligible: false, depositAmt: 0,     weight: 1 },
  { name: 'ChapStick Classic Original 2pk',  dept: 'HBA',     price:  3.99, taxClass: 'none',     ebtEligible: false, depositAmt: 0,     weight: 2 },

  // MERCH
  { name: 'Energizer AA Batteries 4pk',     dept: 'MERCH',   price:  6.99, taxClass: 'none',     ebtEligible: false, depositAmt: 0,     weight: 1 },
  { name: 'Reusable Shopping Bag',           dept: 'MERCH',   price:  0.99, taxClass: 'none',     ebtEligible: false, depositAmt: 0,     weight: 2 },

  // LOTTERY
  { name: 'Scratch Ticket $1',              dept: 'LOTTERY', price:  1.00, taxClass: 'none',     ebtEligible: false, depositAmt: 0,     weight: 4 },
  { name: 'Scratch Ticket $5',              dept: 'LOTTERY', price:  5.00, taxClass: 'none',     ebtEligible: false, depositAmt: 0,     weight: 2 },
];

// Build weighted selection arrays
const productWeights = PRODUCTS.map(p => p.weight);

// Tax rates by class (Maine)
const TAX_RATES = {
  grocery:  0.0000,  // Maine: unprepared food is exempt
  alcohol:  0.0550,
  tobacco:  0.0550,
  hot_food: 0.0800,
  none:     0.0550,  // general sales tax
};

// Dept code -> department name mapping
const DEPT_NAMES = {
  BEER: 'Beer & Malt', WINE: 'Wine', SPIRITS: 'Spirits & Liquor', CIDER: 'Cider & Hard Seltzer',
  TOBAC: 'Tobacco', SNACKS: 'Snacks & Candy', BVNALC: 'Beverages (Non-Alc)', WATER: 'Water & Sparkling',
  DAIRY: 'Dairy & Eggs', GROC: 'Grocery', FROZEN: 'Frozen Foods', BAKED: 'Bakery',
  PRODUCE: 'Produce', MEAT: 'Meat & Seafood', DELI: 'Deli', HOTFOOD: 'Hot Food / Prepared',
  COFFEE: 'Coffee & Hot Drinks', HBA: 'Health & Beauty', MERCH: 'General Merchandise', LOTTERY: 'Lottery',
};

// ─────────────────────────────────────────────────────────
// HOURLY DISTRIBUTION WEIGHTS (0-23)
// Peak: 11am-1pm, 5pm-7pm. Minimal: 12am-6am
// ─────────────────────────────────────────────────────────
const HOUR_WEIGHTS = [
  1,   // 0  (12am)
  0.5, // 1
  0.3, // 2
  0.2, // 3
  0.2, // 4
  0.5, // 5
  2,   // 6  (early commuters)
  5,   // 7
  7,   // 8
  6,   // 9
  5,   // 10
  9,   // 11 (lunch rush start)
  10,  // 12 (noon peak)
  8,   // 13 (1pm)
  5,   // 14
  5,   // 15
  6,   // 16
  9,   // 17 (5pm dinner rush)
  10,  // 18 (6pm peak)
  7,   // 19 (7pm)
  5,   // 20
  4,   // 21
  3,   // 22
  2,   // 23
];

function pickHour() {
  return weightedPick(
    Array.from({ length: 24 }, (_, i) => i),
    HOUR_WEIGHTS
  );
}

// ─────────────────────────────────────────────────────────
// GENERATE LINE ITEMS
// ─────────────────────────────────────────────────────────
function generateLineItems(deptMap) {
  const numItems = weightedPick(
    [1, 2, 3, 4, 5, 6, 7, 8],
    [10, 20, 25, 20, 12, 7, 4, 2]
  );

  const items = [];
  for (let i = 0; i < numItems; i++) {
    const product = weightedPick(PRODUCTS, productWeights);
    const qty = product.price > 10 ? 1 : weightedPick([1, 2, 3], [70, 25, 5]);
    const lineTotal = Math.round(product.price * qty * 100) / 100;
    const taxable = product.taxClass !== 'grocery';
    const depositAmount = Math.round(product.depositAmt * qty * 100) / 100;

    items.push({
      name:          product.name,
      qty,
      unitPrice:     product.price,
      lineTotal,
      taxable,
      ebtEligible:   product.ebtEligible,
      departmentId:  deptMap[product.dept] || null,
      department:    DEPT_NAMES[product.dept] || product.dept,
      taxClass:      product.taxClass,
      depositAmount,
    });
  }

  return items;
}

// ─────────────────────────────────────────────────────────
// COMPUTE TOTALS
// ─────────────────────────────────────────────────────────
function computeTotals(lineItems) {
  let subtotal = 0;
  let taxTotal = 0;
  let depositTotal = 0;
  let ebtEligibleTotal = 0;

  for (const item of lineItems) {
    subtotal += item.lineTotal;
    depositTotal += item.depositAmount;

    if (item.taxable) {
      const rate = TAX_RATES[item.taxClass] || 0;
      taxTotal += item.lineTotal * rate;
    }

    if (item.ebtEligible) {
      ebtEligibleTotal += item.lineTotal;
    }
  }

  subtotal     = Math.round(subtotal * 100) / 100;
  taxTotal     = Math.round(taxTotal * 100) / 100;
  depositTotal = Math.round(depositTotal * 100) / 100;
  const grandTotal = Math.round((subtotal + taxTotal + depositTotal) * 100) / 100;

  return { subtotal, taxTotal, depositTotal, ebtEligibleTotal, grandTotal };
}

// ─────────────────────────────────────────────────────────
// GENERATE TENDER LINES
// ─────────────────────────────────────────────────────────
function generateTenderLines(grandTotal, ebtEligibleTotal) {
  // 55% card, 30% cash, 10% EBT, 5% mixed
  const roll = seededRandom();
  let method;
  if (roll < 0.55)       method = 'card';
  else if (roll < 0.85)  method = 'cash';
  else if (roll < 0.95)  method = 'ebt';
  else                    method = 'mixed';

  const tenderLines = [];
  let changeGiven = 0;
  let ebtTotal = 0;

  if (method === 'card') {
    tenderLines.push({ method: 'card', amount: grandTotal });
  } else if (method === 'cash') {
    // Round up to nearest dollar or 5 for change
    const cashTendered = grandTotal <= 20
      ? Math.ceil(grandTotal)
      : Math.ceil(grandTotal / 5) * 5;
    changeGiven = Math.round((cashTendered - grandTotal) * 100) / 100;
    tenderLines.push({ method: 'cash', amount: cashTendered });
  } else if (method === 'ebt') {
    // EBT covers eligible items only; rest on card
    ebtTotal = Math.min(ebtEligibleTotal, grandTotal);
    ebtTotal = Math.round(ebtTotal * 100) / 100;
    const remainder = Math.round((grandTotal - ebtTotal) * 100) / 100;
    if (ebtTotal > 0) tenderLines.push({ method: 'ebt', amount: ebtTotal });
    if (remainder > 0) tenderLines.push({ method: 'card', amount: remainder });
    if (ebtTotal <= 0) {
      // No EBT-eligible items, fall back to card
      tenderLines.push({ method: 'card', amount: grandTotal });
    }
  } else {
    // mixed: EBT for eligible portion, cash for rest
    ebtTotal = Math.min(ebtEligibleTotal, grandTotal);
    ebtTotal = Math.round(ebtTotal * 100) / 100;
    const remainder = Math.round((grandTotal - ebtTotal) * 100) / 100;
    if (ebtTotal > 0) tenderLines.push({ method: 'ebt', amount: ebtTotal });
    if (remainder > 0) {
      const cashTendered = remainder <= 20
        ? Math.ceil(remainder)
        : Math.ceil(remainder / 5) * 5;
      changeGiven = Math.round((cashTendered - remainder) * 100) / 100;
      tenderLines.push({ method: 'cash', amount: cashTendered });
    }
  }

  return { tenderLines, changeGiven, ebtTotal };
}

// ─────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────
async function main() {
  console.log('\nSeed Transactions — Generating 90 days of POS data...\n');

  // Find the first non-system org that actually has a store (some stale orgs
  // in dev DBs have no stores — skip those so the seed works out of the box).
  const candidates = await prisma.organization.findMany({
    where: { slug: { not: 'system' } },
    include: { stores: { take: 1 } },
    orderBy: { createdAt: 'asc' },
  });
  const org = candidates.find(o => o.stores.length > 0);
  if (!org) throw new Error('No organization with a store found. Run seed.js first.');

  const store = org.stores[0];
  if (!store) throw new Error('No store found. Run seed.js first.');

  const user = await prisma.user.findFirst({ where: { orgId: org.id, role: 'cashier' } });
  const fallbackUser = user || await prisma.user.findFirst({ where: { orgId: org.id } });
  if (!fallbackUser) throw new Error('No user found. Run seed.js first.');

  // Also find a manager for voided-by
  const manager = await prisma.user.findFirst({ where: { orgId: org.id, role: 'manager' } });
  const voidUserId = manager?.id || fallbackUser.id;

  // Build department code -> id map
  const deptRows = await prisma.department.findMany({
    where: { orgId: org.id },
    select: { id: true, code: true },
  });
  const deptMap = Object.fromEntries(deptRows.map(d => [d.code, d.id]));

  const orgId     = org.id;
  const storeId   = store.id;
  const cashierId = fallbackUser.id;
  const stations  = ['REG-1', 'REG-2'];

  // Date range: last 90 days
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 90);
  startDate.setHours(0, 0, 0, 0);

  const transactions = [];
  let txSeq = 1;
  let totalVoided = 0;
  let totalRefunded = 0;
  const completedTxIds = []; // track for refunds

  for (let dayOffset = 0; dayOffset < 90; dayOffset++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + dayOffset);

    const dayOfWeek = date.getDay(); // 0=Sun, 5=Fri, 6=Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;

    // Growth factor: 1.0 at day 0, ~1.15 at day 90
    const growthFactor = 1.0 + (dayOffset / 90) * 0.15;

    // Daily transaction count
    let baseTxCount;
    if (isWeekend) {
      baseTxCount = randInt(40, 65);
    } else {
      baseTxCount = randInt(25, 40);
    }
    const txCount = Math.round(baseTxCount * growthFactor);

    for (let t = 0; t < txCount; t++) {
      const hour = pickHour();
      const minute = randInt(0, 59);
      const second = randInt(0, 59);

      const createdAt = new Date(date);
      createdAt.setHours(hour, minute, second, randInt(0, 999));

      const lineItems = generateLineItems(deptMap);
      const { subtotal, taxTotal, depositTotal, ebtEligibleTotal, grandTotal } = computeTotals(lineItems);
      const { tenderLines, changeGiven, ebtTotal } = generateTenderLines(grandTotal, ebtEligibleTotal);

      const dateStr = `${createdAt.getFullYear()}${String(createdAt.getMonth() + 1).padStart(2, '0')}${String(createdAt.getDate()).padStart(2, '0')}`;
      const txNumber = `TXN-${dateStr}-${String(txSeq).padStart(6, '0')}`;
      txSeq++;

      // ~2% voided, ~1% refund
      const statusRoll = seededRandom();
      let status = 'complete';
      let voidedAt = null;
      let voidedById = null;
      let refundOf = null;
      let notes = null;

      if (statusRoll < 0.02) {
        status = 'voided';
        voidedAt = new Date(createdAt.getTime() + randInt(60000, 600000)); // 1-10 min after
        voidedById = voidUserId;
        notes = pick([
          'Customer changed mind',
          'Wrong items scanned',
          'Price dispute',
          'Duplicate transaction',
          'Customer left without paying',
        ]);
        totalVoided++;
      } else if (statusRoll < 0.03 && completedTxIds.length > 10) {
        // Refund of a previous completed transaction
        status = 'complete';
        refundOf = pick(completedTxIds.slice(-50)); // refund from recent txns
        notes = pick([
          'Customer return - defective product',
          'Customer return - wrong item purchased',
          'Customer return - receipt present',
          'Return/exchange - manager approved',
        ]);
        totalRefunded++;
      }

      const tx = {
        orgId,
        storeId,
        cashierId,
        stationId: pick(stations),
        txNumber,
        status,
        lineItems,
        subtotal,
        taxTotal,
        depositTotal,
        ebtTotal,
        grandTotal,
        tenderLines,
        changeGiven,
        voidedAt,
        voidedById,
        refundOf,
        notes,
        createdAt,
        updatedAt: createdAt,
      };

      transactions.push(tx);

      if (status === 'complete' && !refundOf) {
        completedTxIds.push(txNumber);
      }
    }
  }

  // Delete existing seeded transactions (optional -- clear old runs)
  const deleted = await prisma.transaction.deleteMany({
    where: { orgId, storeId },
  });
  if (deleted.count > 0) {
    console.log(`  Cleared ${deleted.count} existing transactions for this org/store.`);
  }

  // Insert in batches of 100
  const BATCH_SIZE = 100;
  let inserted = 0;
  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);
    await prisma.transaction.createMany({ data: batch });
    inserted += batch.length;
    if (inserted % 500 === 0 || inserted === transactions.length) {
      console.log(`  Inserted ${inserted} / ${transactions.length} transactions...`);
    }
  }

  // Summary statistics
  const totalGrand = transactions.reduce((s, t) => s + t.grandTotal, 0);
  const avgTx = totalGrand / transactions.length;
  const cardTx = transactions.filter(t => t.tenderLines.some(tl => tl.method === 'card')).length;
  const cashTx = transactions.filter(t => t.tenderLines.length === 1 && t.tenderLines[0].method === 'cash').length;
  const ebtTx  = transactions.filter(t => t.tenderLines.some(tl => tl.method === 'ebt')).length;

  console.log(`\n  Seeded ${transactions.length} transactions across 90 days`);
  console.log(`  Total revenue: $${totalGrand.toFixed(2)}`);
  console.log(`  Average transaction: $${avgTx.toFixed(2)}`);
  console.log(`  Payment breakdown: ${cardTx} card, ${cashTx} cash, ${ebtTx} EBT-involved`);
  console.log(`  Voided: ${totalVoided}, Refunds: ${totalRefunded}`);
  console.log(`  Org: ${org.name} (${orgId})`);
  console.log(`  Store: ${store.name} (${storeId})`);
  console.log(`  Cashier: ${fallbackUser.name} (${cashierId})\n`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
