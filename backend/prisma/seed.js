/**
 * Prisma Seed — Storv POS Portal
 *
 * Seeds org-agnostic defaults for a new organization.
 * Run via: node prisma/seed.js <orgId>
 *
 * Includes:
 *   - Maine-specific tax rules (food 0%, alcohol 5.5%, tobacco)
 *   - Maine CRV deposit rules ($0.05 <24oz, $0.15 ≥24oz)
 *   - Standard retail departments
 *   - 100 realistic c-store / liquor-store products
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

const ORG_ID = process.argv[2] || 'default';

// ─────────────────────────────────────────────────────────
// DEPARTMENTS
// ─────────────────────────────────────────────────────────
const DEPARTMENTS = [
  { code: 'BEER',    name: 'Beer & Malt',          taxClass: 'alcohol',  ageRequired: 21,   ebtEligible: false, bottleDeposit: true,  sortOrder: 10,  color: '#f59e0b' },
  { code: 'WINE',    name: 'Wine',                 taxClass: 'alcohol',  ageRequired: 21,   ebtEligible: false, bottleDeposit: true,  sortOrder: 20,  color: '#8b5cf6' },
  { code: 'SPIRITS', name: 'Spirits & Liquor',     taxClass: 'alcohol',  ageRequired: 21,   ebtEligible: false, bottleDeposit: true,  sortOrder: 30,  color: '#ec4899' },
  { code: 'CIDER',   name: 'Cider & Hard Seltzer', taxClass: 'alcohol',  ageRequired: 21,   ebtEligible: false, bottleDeposit: true,  sortOrder: 40,  color: '#10b981' },
  { code: 'TOBAC',   name: 'Tobacco',              taxClass: 'tobacco',  ageRequired: 21,   ebtEligible: false, bottleDeposit: false, sortOrder: 50,  color: '#6b7280' },
  { code: 'VAPE',    name: 'Vape & E-Cig',         taxClass: 'tobacco',  ageRequired: 21,   ebtEligible: false, bottleDeposit: false, sortOrder: 60,  color: '#374151' },
  { code: 'LOTTERY', name: 'Lottery',              taxClass: 'none',     ageRequired: 18,   ebtEligible: false, bottleDeposit: false, sortOrder: 70,  color: '#fbbf24' },
  { code: 'GROC',    name: 'Grocery',              taxClass: 'grocery',  ageRequired: null, ebtEligible: true,  bottleDeposit: false, sortOrder: 80,  color: '#22c55e' },
  { code: 'DAIRY',   name: 'Dairy & Eggs',         taxClass: 'grocery',  ageRequired: null, ebtEligible: true,  bottleDeposit: false, sortOrder: 90,  color: '#60a5fa' },
  { code: 'PRODUCE', name: 'Produce',              taxClass: 'grocery',  ageRequired: null, ebtEligible: true,  bottleDeposit: false, sortOrder: 100, color: '#4ade80' },
  { code: 'MEAT',    name: 'Meat & Seafood',       taxClass: 'grocery',  ageRequired: null, ebtEligible: true,  bottleDeposit: false, sortOrder: 110, color: '#f87171' },
  { code: 'DELI',    name: 'Deli',                 taxClass: 'grocery',  ageRequired: null, ebtEligible: true,  bottleDeposit: false, sortOrder: 120, color: '#fb923c' },
  { code: 'FROZEN',  name: 'Frozen Foods',         taxClass: 'grocery',  ageRequired: null, ebtEligible: true,  bottleDeposit: false, sortOrder: 130, color: '#93c5fd' },
  { code: 'BAKED',   name: 'Bakery',               taxClass: 'grocery',  ageRequired: null, ebtEligible: true,  bottleDeposit: false, sortOrder: 140, color: '#fde68a' },
  { code: 'SNACKS',  name: 'Snacks & Candy',       taxClass: 'grocery',  ageRequired: null, ebtEligible: true,  bottleDeposit: false, sortOrder: 150, color: '#f9a8d4' },
  { code: 'BVNALC',  name: 'Beverages (Non-Alc)',  taxClass: 'grocery',  ageRequired: null, ebtEligible: true,  bottleDeposit: true,  sortOrder: 160, color: '#34d399' },
  { code: 'WATER',   name: 'Water & Sparkling',    taxClass: 'grocery',  ageRequired: null, ebtEligible: true,  bottleDeposit: true,  sortOrder: 170, color: '#7dd3fc' },
  { code: 'HOTFOOD', name: 'Hot Food / Prepared',  taxClass: 'hot_food', ageRequired: null, ebtEligible: false, bottleDeposit: false, sortOrder: 180, color: '#f97316' },
  { code: 'COFFEE',  name: 'Coffee & Hot Drinks',  taxClass: 'hot_food', ageRequired: null, ebtEligible: false, bottleDeposit: false, sortOrder: 190, color: '#92400e' },
  { code: 'HBA',     name: 'Health & Beauty',      taxClass: 'none',     ageRequired: null, ebtEligible: false, bottleDeposit: false, sortOrder: 200, color: '#c084fc' },
  { code: 'PHARMA',  name: 'Pharmacy / OTC',       taxClass: 'none',     ageRequired: null, ebtEligible: false, bottleDeposit: false, sortOrder: 210, color: '#a78bfa' },
  { code: 'MERCH',   name: 'General Merchandise',  taxClass: 'none',     ageRequired: null, ebtEligible: false, bottleDeposit: false, sortOrder: 220, color: '#d1d5db' },
  { code: 'AUTO',    name: 'Automotive',           taxClass: 'none',     ageRequired: null, ebtEligible: false, bottleDeposit: false, sortOrder: 230, color: '#9ca3af' },
  { code: 'GIFT',    name: 'Gift Cards',           taxClass: 'none',     ageRequired: null, ebtEligible: false, bottleDeposit: false, sortOrder: 240, color: '#fcd34d' },
  { code: 'FOOD_RX', name: 'Food (Restaurant)',    taxClass: 'hot_food', ageRequired: null, ebtEligible: false, bottleDeposit: false, sortOrder: 250, color: '#fb923c' },
  { code: 'DRINK_RX',name: 'Drinks (Restaurant)',  taxClass: 'hot_food', ageRequired: null, ebtEligible: false, bottleDeposit: false, sortOrder: 260, color: '#38bdf8' },
  { code: 'ALCO_RX', name: 'Bar / Alcohol Service',taxClass: 'alcohol',  ageRequired: 21,   ebtEligible: false, bottleDeposit: false, sortOrder: 270, color: '#818cf8' },
];

// ─────────────────────────────────────────────────────────
// TAX RULES — Maine defaults
// ─────────────────────────────────────────────────────────
const TAX_RULES = [
  { name: 'Maine Grocery (Tax Exempt)',     description: 'Unprepared food items are exempt from Maine sales tax', rate: 0.0000, appliesTo: 'grocery',  ebtExempt: true,  state: 'ME' },
  { name: 'Maine General Sales Tax',        description: 'Maine standard sales tax on non-food tangible goods',  rate: 0.0550, appliesTo: 'none',     ebtExempt: false, state: 'ME' },
  { name: 'Maine Prepared Food Tax',        description: 'Maine tax on prepared food and restaurant meals',       rate: 0.0800, appliesTo: 'hot_food', ebtExempt: false, state: 'ME' },
  { name: 'Maine Alcohol Tax',              description: 'Maine sales tax applied to beer, wine, and spirits',    rate: 0.0550, appliesTo: 'alcohol',  ebtExempt: false, state: 'ME' },
  { name: 'Maine Tobacco Tax',              description: 'Maine sales tax applied to tobacco products',           rate: 0.0550, appliesTo: 'tobacco',  ebtExempt: false, state: 'ME' },
  { name: 'Maine Lodging Tax',              description: 'Maine lodging/rental tax',                              rate: 0.0900, appliesTo: 'lodging',  ebtExempt: false, state: 'ME' },
];

// ─────────────────────────────────────────────────────────
// DEPOSIT RULES — Maine CRV
// ─────────────────────────────────────────────────────────
const DEPOSIT_RULES = [
  {
    name: 'Maine CRV — Small (< 24 oz)',
    description: 'Maine bottle deposit for beverage containers under 24 oz',
    minVolumeOz: null, maxVolumeOz: 24.0,
    containerTypes: 'bottle,can,carton',
    depositAmount: 0.05, state: 'ME',
  },
  {
    name: 'Maine CRV — Large (≥ 24 oz)',
    description: 'Maine bottle deposit for beverage containers 24 oz and over',
    minVolumeOz: 24.0, maxVolumeOz: null,
    containerTypes: 'bottle,can,jug',
    depositAmount: 0.15, state: 'ME',
  },
];

// ─────────────────────────────────────────────────────────
// PRODUCTS (100 items)
//
// sellUnitSize = number of individual containers per sell unit.
// The catalog snapshot multiplies depositRule.depositAmount × sellUnitSize
// to give the correct per-sell-unit deposit at the POS:
//   6pk 12oz   → sellUnitSize: 6  → 6 × $0.05 = $0.30
//   12pk 12oz  → sellUnitSize: 12 → 12 × $0.05 = $0.60
//   24pk 12oz  → sellUnitSize: 24 → 24 × $0.05 = $1.20
//   750ml btl  → sellUnitSize: 1  → 1 × $0.15 = $0.15
//   single can → sellUnitSize: 1  → 1 × $0.05 = $0.05
//   24pk 16.9oz water → sellUnitSize: 24 → 24 × $0.05 = $1.20
//
// depositRule: 'small' (<24oz, $0.05) | 'large' (≥24oz, $0.15) | null
// upc: 12-digit EAN/UPC-A; plu used for produce/PLU items without UPC
// ─────────────────────────────────────────────────────────
const PRODUCTS = [
  // ─── BEER (15) ──────────────────────────────────────────────────────────
  { dept: 'BEER', upc: '018200359448', name: 'Bud Light 12pk Cans',            brand: 'Anheuser-Busch', size: '12pk 12oz',  retail: 14.99, cost: 10.49, sellUnitSize: 12, depositRule: 'small', ageRequired: 21 },
  { dept: 'BEER', upc: '018200359479', name: 'Budweiser 12pk Cans',             brand: 'Anheuser-Busch', size: '12pk 12oz',  retail: 14.99, cost: 10.49, sellUnitSize: 12, depositRule: 'small', ageRequired: 21 },
  { dept: 'BEER', upc: '070400024018', name: 'Coors Light 12pk Cans',           brand: 'Molson Coors',   size: '12pk 12oz',  retail: 14.99, cost: 10.49, sellUnitSize: 12, depositRule: 'small', ageRequired: 21 },
  { dept: 'BEER', upc: '070400024032', name: 'Miller Lite 12pk Cans',           brand: 'Molson Coors',   size: '12pk 12oz',  retail: 14.99, cost: 10.49, sellUnitSize: 12, depositRule: 'small', ageRequired: 21 },
  { dept: 'BEER', upc: '018200640405', name: 'Michelob Ultra 12pk Cans',        brand: 'Anheuser-Busch', size: '12pk 12oz',  retail: 16.99, cost: 11.99, sellUnitSize: 12, depositRule: 'small', ageRequired: 21 },
  { dept: 'BEER', upc: '030200079025', name: 'Corona Extra 6pk Bottles',        brand: 'Constellation',  size: '6pk 12oz',   retail: 10.99, cost:  7.49, sellUnitSize:  6, depositRule: 'small', ageRequired: 21 },
  { dept: 'BEER', upc: '072617003018', name: 'Heineken 6pk Bottles',            brand: 'Heineken',       size: '6pk 12oz',   retail: 10.99, cost:  7.49, sellUnitSize:  6, depositRule: 'small', ageRequired: 21 },
  { dept: 'BEER', upc: '091008000183', name: 'Samuel Adams Boston Lager 6pk',   brand: 'Boston Beer',    size: '6pk 12oz',   retail: 10.99, cost:  7.49, sellUnitSize:  6, depositRule: 'small', ageRequired: 21 },
  { dept: 'BEER', upc: '081080000067', name: 'Stella Artois 6pk Bottles',       brand: 'AB InBev',       size: '6pk 12oz',   retail: 10.99, cost:  7.49, sellUnitSize:  6, depositRule: 'small', ageRequired: 21 },
  { dept: 'BEER', upc: '030200869000', name: 'Modelo Especial 6pk Cans',        brand: 'Constellation',  size: '6pk 12oz',   retail: 10.99, cost:  7.49, sellUnitSize:  6, depositRule: 'small', ageRequired: 21 },
  { dept: 'BEER', upc: '085387001104', name: 'Blue Moon Belgian White 6pk',     brand: 'Blue Moon',      size: '6pk 12oz',   retail: 10.99, cost:  7.49, sellUnitSize:  6, depositRule: 'small', ageRequired: 21 },
  { dept: 'BEER', upc: '081033600127', name: 'Dogfish Head 60 Min IPA 6pk',     brand: 'Dogfish Head',   size: '6pk 12oz',   retail: 11.99, cost:  8.49, sellUnitSize:  6, depositRule: 'small', ageRequired: 21 },
  { dept: 'BEER', upc: '051750113218', name: 'Guinness Draught 6pk',            brand: 'Guinness',       size: '6pk 14.9oz', retail: 11.99, cost:  8.49, sellUnitSize:  6, depositRule: 'small', ageRequired: 21 },
  { dept: 'BEER', upc: '041208103015', name: 'Pabst Blue Ribbon 24pk Cans',     brand: 'Pabst',          size: '24pk 12oz',  retail: 22.99, cost: 15.99, sellUnitSize: 24, depositRule: 'small', ageRequired: 21 },
  { dept: 'BEER', upc: '072949100178', name: 'Bud Light Seltzer Variety 12pk',  brand: 'Anheuser-Busch', size: '12pk 12oz',  retail: 16.99, cost: 11.49, sellUnitSize: 12, depositRule: 'small', ageRequired: 21 },

  // ─── WINE (8) ───────────────────────────────────────────────────────────
  { dept: 'WINE', upc: '085000052490', name: 'Barefoot Cabernet Sauvignon',     brand: 'Barefoot',       size: '750ml',  retail:  7.99, cost:  4.49, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },
  { dept: 'WINE', upc: '085000061447', name: 'Barefoot Pinot Grigio',           brand: 'Barefoot',       size: '750ml',  retail:  7.99, cost:  4.49, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },
  { dept: 'WINE', upc: '085000034694', name: 'Barefoot Moscato',                brand: 'Barefoot',       size: '750ml',  retail:  7.99, cost:  4.49, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },
  { dept: 'WINE', upc: '021832007153', name: 'Josh Cellars Cabernet Sauvignon', brand: 'Josh Cellars',   size: '750ml',  retail: 12.99, cost:  8.99, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },
  { dept: 'WINE', upc: '069404917012', name: 'Apothic Red Blend',               brand: 'Apothic',        size: '750ml',  retail:  9.99, cost:  6.99, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },
  { dept: 'WINE', upc: '085000083012', name: 'Kim Crawford Sauvignon Blanc',    brand: 'Kim Crawford',   size: '750ml',  retail: 13.99, cost:  9.49, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },
  { dept: 'WINE', upc: '811367010018', name: 'Meiomi Pinot Noir',               brand: 'Meiomi',         size: '750ml',  retail: 12.99, cost:  8.99, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },
  { dept: 'WINE', upc: '085000051005', name: 'La Marca Prosecco',               brand: 'La Marca',       size: '750ml',  retail: 14.99, cost: 10.49, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },

  // ─── SPIRITS (8) ────────────────────────────────────────────────────────
  { dept: 'SPIRITS', upc: '085785300018', name: "Tito's Handmade Vodka",        brand: "Tito's",         size: '750ml',  retail: 22.99, cost: 15.99, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },
  { dept: 'SPIRITS', upc: '080480280071', name: 'Absolut Vodka',                brand: 'Absolut',        size: '750ml',  retail: 19.99, cost: 13.99, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },
  { dept: 'SPIRITS', upc: '082184090206', name: "Jack Daniel's Old No. 7",      brand: "Jack Daniel's",  size: '750ml',  retail: 26.99, cost: 18.99, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },
  { dept: 'SPIRITS', upc: '080432101773', name: 'Jameson Irish Whiskey',        brand: 'Jameson',        size: '750ml',  retail: 24.99, cost: 17.99, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },
  { dept: 'SPIRITS', upc: '087000003055', name: 'Captain Morgan Spiced Rum',    brand: 'Captain Morgan', size: '750ml',  retail: 18.99, cost: 12.99, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },
  { dept: 'SPIRITS', upc: '018537014020', name: 'Jose Cuervo Gold Tequila',     brand: 'Jose Cuervo',    size: '750ml',  retail: 18.99, cost: 12.99, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },
  { dept: 'SPIRITS', upc: '080571300003', name: 'Bacardi Superior Rum',         brand: 'Bacardi',        size: '750ml',  retail: 13.99, cost:  9.49, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },
  { dept: 'SPIRITS', upc: '082000750021', name: 'Crown Royal Canadian Whisky',  brand: 'Crown Royal',    size: '750ml',  retail: 29.99, cost: 21.99, sellUnitSize: 1, depositRule: 'large', ageRequired: 21 },

  // ─── CIDER & HARD SELTZER (5) ───────────────────────────────────────────
  { dept: 'CIDER', upc: '019014802059', name: 'White Claw Black Cherry 6pk',    brand: 'White Claw',    size: '6pk 12oz', retail: 10.99, cost:  7.49, sellUnitSize: 6, depositRule: 'small', ageRequired: 21 },
  { dept: 'CIDER', upc: '019014802080', name: 'White Claw Mango 6pk',           brand: 'White Claw',    size: '6pk 12oz', retail: 10.99, cost:  7.49, sellUnitSize: 6, depositRule: 'small', ageRequired: 21 },
  { dept: 'CIDER', upc: '040700690012', name: 'Truly Wild Berry 6pk',           brand: 'Truly',         size: '6pk 12oz', retail: 10.99, cost:  7.49, sellUnitSize: 6, depositRule: 'small', ageRequired: 21 },
  { dept: 'CIDER', upc: '087116001066', name: 'Angry Orchard Crisp Apple 6pk',  brand: 'Angry Orchard', size: '6pk 12oz', retail:  9.99, cost:  6.99, sellUnitSize: 6, depositRule: 'small', ageRequired: 21 },
  { dept: 'CIDER', upc: '072949100109', name: 'Twisted Tea Original 6pk',       brand: 'Twisted Tea',   size: '6pk 12oz', retail: 10.99, cost:  7.49, sellUnitSize: 6, depositRule: 'small', ageRequired: 21 },

  // ─── TOBACCO (5) ────────────────────────────────────────────────────────
  { dept: 'TOBAC', upc: '028000883041', name: 'Marlboro Red Box King',          brand: 'Philip Morris', size: '20ct', retail: 11.99, cost:  8.99, sellUnitSize: null, depositRule: null, ageRequired: 21 },
  { dept: 'TOBAC', upc: '028000883058', name: 'Marlboro Gold Box King',         brand: 'Philip Morris', size: '20ct', retail: 11.99, cost:  8.99, sellUnitSize: null, depositRule: null, ageRequired: 21 },
  { dept: 'TOBAC', upc: '036000280806', name: 'Newport Menthol Box King',       brand: 'Lorillard',     size: '20ct', retail: 11.99, cost:  8.99, sellUnitSize: null, depositRule: null, ageRequired: 21 },
  { dept: 'TOBAC', upc: '026017040018', name: 'Camel Blue Box King',            brand: 'RJ Reynolds',   size: '20ct', retail: 11.99, cost:  8.99, sellUnitSize: null, depositRule: null, ageRequired: 21 },
  { dept: 'TOBAC', upc: '070000051012', name: 'Marlboro Menthol Box King',      brand: 'Philip Morris', size: '20ct', retail: 11.99, cost:  8.99, sellUnitSize: null, depositRule: null, ageRequired: 21 },

  // ─── SNACKS & CANDY (10) ────────────────────────────────────────────────
  { dept: 'SNACKS', upc: '028400090407', name: "Lay's Classic Potato Chips",    brand: "Lay's",          size: '8oz',    retail: 4.99, cost: 2.99, sellUnitSize: null, depositRule: null },
  { dept: 'SNACKS', upc: '028400090537', name: 'Doritos Nacho Cheese',          brand: 'Doritos',        size: '9.25oz', retail: 4.99, cost: 2.99, sellUnitSize: null, depositRule: null },
  { dept: 'SNACKS', upc: '028400421621', name: "Cheetos Flamin' Hot",           brand: 'Cheetos',        size: '8.5oz',  retail: 4.99, cost: 2.99, sellUnitSize: null, depositRule: null },
  { dept: 'SNACKS', upc: '037600051798', name: 'Pringles Original',             brand: 'Pringles',       size: '5.2oz',  retail: 2.99, cost: 1.69, sellUnitSize: null, depositRule: null },
  { dept: 'SNACKS', upc: '040000001201', name: 'Snickers Bar',                  brand: 'Mars',           size: '1.86oz', retail: 1.89, cost: 0.99, sellUnitSize: null, depositRule: null },
  { dept: 'SNACKS', upc: '034000002481', name: "Reese's Peanut Butter Cups",    brand: "Reese's",        size: '1.5oz',  retail: 1.79, cost: 0.89, sellUnitSize: null, depositRule: null },
  { dept: 'SNACKS', upc: '602652160035', name: 'KIND Dark Chocolate Nuts',      brand: 'KIND',           size: '1.4oz',  retail: 1.99, cost: 1.19, sellUnitSize: null, depositRule: null },
  { dept: 'SNACKS', upc: '016000496071', name: 'Chex Mix Traditional',          brand: 'Chex Mix',       size: '3.75oz', retail: 3.49, cost: 1.99, sellUnitSize: null, depositRule: null },
  { dept: 'SNACKS', upc: '026200011022', name: 'Slim Jim Original',             brand: 'Slim Jim',       size: '0.97oz', retail: 1.49, cost: 0.79, sellUnitSize: null, depositRule: null },
  { dept: 'SNACKS', upc: '029000018372', name: 'Planters Honey Roasted Peanuts',brand: 'Planters',       size: '6oz',    retail: 4.49, cost: 2.49, sellUnitSize: null, depositRule: null },

  // ─── BEVERAGES NON-ALC (8) ──────────────────────────────────────────────
  { dept: 'BVNALC', upc: '049000028904', name: 'Coca-Cola',                     brand: 'Coca-Cola', size: '20oz',  retail: 2.29, cost: 1.09, sellUnitSize: 1, depositRule: 'small' },
  { dept: 'BVNALC', upc: '049000028911', name: 'Diet Coke',                     brand: 'Coca-Cola', size: '20oz',  retail: 2.29, cost: 1.09, sellUnitSize: 1, depositRule: 'small' },
  { dept: 'BVNALC', upc: '012000001055', name: 'Pepsi',                         brand: 'PepsiCo',   size: '20oz',  retail: 2.19, cost: 1.09, sellUnitSize: 1, depositRule: 'small' },
  { dept: 'BVNALC', upc: '012000001086', name: 'Mountain Dew',                  brand: 'PepsiCo',   size: '20oz',  retail: 2.19, cost: 1.09, sellUnitSize: 1, depositRule: 'small' },
  { dept: 'BVNALC', upc: '611269991000', name: 'Red Bull Energy Drink',         brand: 'Red Bull',  size: '8.4oz', retail: 3.49, cost: 1.99, sellUnitSize: 1, depositRule: 'small' },
  { dept: 'BVNALC', upc: '070847004619', name: 'Monster Energy Original',       brand: 'Monster',   size: '16oz',  retail: 3.29, cost: 1.89, sellUnitSize: 1, depositRule: 'small' },
  { dept: 'BVNALC', upc: '052000030016', name: 'Gatorade Fruit Punch',          brand: 'Gatorade',  size: '32oz',  retail: 2.49, cost: 1.19, sellUnitSize: 1, depositRule: 'large' },
  { dept: 'BVNALC', upc: '613008715119', name: 'Arizona Green Tea',             brand: 'Arizona',   size: '23oz',  retail: 1.29, cost: 0.69, sellUnitSize: 1, depositRule: 'large' },

  // ─── WATER (5) ──────────────────────────────────────────────────────────
  { dept: 'WATER', upc: '048500000052', name: 'Poland Spring Water',            brand: 'Poland Spring', size: '16.9oz',      retail: 1.99, cost: 0.79, sellUnitSize:  1, depositRule: 'small' },
  { dept: 'WATER', upc: '048500000069', name: 'Poland Spring 24pk',             brand: 'Poland Spring', size: '24pk 16.9oz', retail: 5.99, cost: 3.49, sellUnitSize: 24, depositRule: 'small' },
  { dept: 'WATER', upc: '021000619313', name: 'Deer Park Spring Water',         brand: 'Deer Park',     size: '16.9oz',      retail: 1.89, cost: 0.75, sellUnitSize:  1, depositRule: 'small' },
  { dept: 'WATER', upc: '076760020038', name: 'Evian Natural Spring Water',     brand: 'Evian',         size: '1L',          retail: 2.99, cost: 1.49, sellUnitSize:  1, depositRule: 'large' },
  { dept: 'WATER', upc: '818490010023', name: 'Sparkling Ice Black Raspberry',  brand: 'Sparkling Ice', size: '17oz',        retail: 1.99, cost: 0.99, sellUnitSize:  1, depositRule: 'small' },

  // ─── DAIRY & EGGS (5) ───────────────────────────────────────────────────
  { dept: 'DAIRY', upc: '018743000007', name: 'Hood Whole Milk',                brand: 'Hood',        size: '1 Gallon', retail: 4.99, cost: 3.29, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'DAIRY', upc: '078354600152', name: 'Cabot Sharp Cheddar Cheese',     brand: 'Cabot',       size: '8oz',      retail: 5.99, cost: 3.79, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'DAIRY', upc: '046100009291', name: 'Sargento Sliced Colby Jack',     brand: 'Sargento',    size: '12oz',     retail: 4.99, cost: 3.29, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'DAIRY', upc: '818290016029', name: 'Chobani Vanilla Greek Yogurt',   brand: 'Chobani',     size: '5.3oz',    retail: 1.79, cost: 0.99, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'DAIRY', upc: '036800000919', name: 'Grade A Large Eggs Dozen',       brand: 'Store Brand', size: '12ct',     retail: 3.99, cost: 2.49, sellUnitSize: null, depositRule: null, ebtEligible: true },

  // ─── GROCERY (5) ────────────────────────────────────────────────────────
  { dept: 'GROC', upc: '072250011001', name: 'Wonder Classic White Bread',      brand: 'Wonder',         size: '20oz',    retail: 3.49, cost: 1.99, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'GROC', upc: '013000006408', name: 'Heinz Tomato Ketchup',            brand: 'Heinz',          size: '32oz',    retail: 4.99, cost: 3.09, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'GROC', upc: '048001213434', name: "Hellmann's Real Mayonnaise",      brand: "Hellmann's",     size: '30oz',    retail: 6.49, cost: 3.99, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'GROC', upc: '051000012197', name: "Campbell's Chicken Noodle Soup",  brand: "Campbell's",     size: '10.75oz', retail: 1.99, cost: 1.09, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'GROC', upc: '016000275287', name: 'Cheerios Original',               brand: 'General Mills',  size: '8.9oz',   retail: 3.99, cost: 2.49, sellUnitSize: null, depositRule: null, ebtEligible: true },

  // ─── FROZEN (5) ─────────────────────────────────────────────────────────
  { dept: 'FROZEN', upc: '076840100063', name: "Ben & Jerry's Choc Chip Cookie Dough", brand: "Ben & Jerry's", size: '16oz',   retail: 6.49, cost: 4.29, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'FROZEN', upc: '071921007882', name: 'DiGiorno Pepperoni Rising Crust',       brand: 'DiGiorno',      size: '27.5oz', retail: 8.99, cost: 5.49, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'FROZEN', upc: '044700072530', name: 'Hot Pockets Ham & Cheese 2pk',         brand: 'Hot Pockets',   size: '9oz',    retail: 3.99, cost: 2.29, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'FROZEN', upc: '013800308016', name: "Stouffer's Mac & Cheese",              brand: "Stouffer's",    size: '12oz',   retail: 3.99, cost: 2.29, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'FROZEN', upc: '074570851775', name: 'Häagen-Dazs Vanilla',                  brand: 'Häagen-Dazs',   size: '14oz',   retail: 5.99, cost: 3.79, sellUnitSize: null, depositRule: null, ebtEligible: true },

  // ─── BAKERY (3) ─────────────────────────────────────────────────────────
  { dept: 'BAKED', upc: '072250063603', name: 'Thomas English Muffins 6pk',      brand: 'Thomas',          size: '12oz',  retail: 3.99, cost: 2.29, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'BAKED', upc: '040000519256', name: "Entenmann's Glazed Donut 8pk",    brand: "Entenmann's",     size: '13oz',  retail: 4.99, cost: 2.99, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'BAKED', upc: '072012006701', name: 'Pepperidge Farm Goldfish Cheddar',brand: 'Pepperidge Farm', size: '6.6oz', retail: 3.49, cost: 1.99, sellUnitSize: null, depositRule: null, ebtEligible: true },

  // ─── PRODUCE (4) ────────────────────────────────────────────────────────
  { dept: 'PRODUCE', upc: null, plu: '4011', name: 'Banana',              brand: null, size: 'per lb', retail: 0.59, cost: 0.29, sellUnitSize: null, depositRule: null, ebtEligible: true, byWeight: true },
  { dept: 'PRODUCE', upc: null, plu: '4016', name: 'Fuji Apple',          brand: null, size: 'each',   retail: 0.99, cost: 0.49, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'PRODUCE', upc: null, plu: '4046', name: 'Avocado',             brand: null, size: 'each',   retail: 1.49, cost: 0.79, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'PRODUCE', upc: null, plu: '3085', name: 'Organic Baby Spinach',brand: null, size: '5oz',    retail: 3.99, cost: 2.29, sellUnitSize: null, depositRule: null, ebtEligible: true },

  // ─── MEAT & SEAFOOD (3) ─────────────────────────────────────────────────
  { dept: 'MEAT', upc: '070700070108', name: 'Bar-S Classic Franks 8ct',       brand: 'Bar-S',      size: '1lb',  retail: 3.49, cost: 1.99, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'MEAT', upc: '044700045237', name: 'Hormel Natural Choice Ham Slices',brand: 'Hormel',     size: '9oz',  retail: 5.99, cost: 3.49, sellUnitSize: null, depositRule: null, ebtEligible: true },
  { dept: 'MEAT', upc: '017000024042', name: "Jimmy Dean Sausage Patties 8ct", brand: 'Jimmy Dean', size: '12oz', retail: 6.99, cost: 4.29, sellUnitSize: null, depositRule: null, ebtEligible: true },

  // ─── DELI (2) ───────────────────────────────────────────────────────────
  { dept: 'DELI', upc: null, plu: '9010', name: 'Deli Ham Sliced (lb)',           brand: null, size: 'per lb', retail: 7.99, cost: 4.99, sellUnitSize: null, depositRule: null, ebtEligible: true, byWeight: true },
  { dept: 'DELI', upc: null, plu: '9011', name: 'Deli Turkey Breast Sliced (lb)',brand: null, size: 'per lb', retail: 8.99, cost: 5.49, sellUnitSize: null, depositRule: null, ebtEligible: true, byWeight: true },

  // ─── HEALTH & BEAUTY (5) ────────────────────────────────────────────────
  { dept: 'HBA', upc: '305731153014', name: 'Advil Ibuprofen 200mg 24ct',      brand: 'Advil',      size: '24ct',   retail: 7.99, cost: 4.99, sellUnitSize: null, depositRule: null },
  { dept: 'HBA', upc: '300450445513', name: 'Tylenol Extra Strength 24ct',     brand: 'Tylenol',    size: '24ct',   retail: 8.99, cost: 5.49, sellUnitSize: null, depositRule: null },
  { dept: 'HBA', upc: '381370034628', name: 'Band-Aid Flexible Fabric 30ct',   brand: 'Band-Aid',   size: '30ct',   retail: 5.99, cost: 3.49, sellUnitSize: null, depositRule: null },
  { dept: 'HBA', upc: '041520024207', name: 'ChapStick Classic Original 2pk',  brand: 'ChapStick',  size: '2pk',    retail: 3.99, cost: 2.19, sellUnitSize: null, depositRule: null },
  { dept: 'HBA', upc: '312547204506', name: 'Listerine Cool Mint Mouthwash',   brand: 'Listerine',  size: '33.8oz', retail: 8.99, cost: 5.49, sellUnitSize: null, depositRule: null },

  // ─── HOT FOOD / PREPARED (4) ────────────────────────────────────────────
  { dept: 'HOTFOOD', upc: null, plu: '5001', name: 'Hot Dog (Roller Grill)',           brand: null, size: 'each', retail: 2.49, cost: 0.89, sellUnitSize: null, depositRule: null },
  { dept: 'HOTFOOD', upc: null, plu: '5002', name: 'Breakfast Sandwich Egg & Cheese', brand: null, size: 'each', retail: 3.99, cost: 1.49, sellUnitSize: null, depositRule: null },
  { dept: 'HOTFOOD', upc: null, plu: '5003', name: 'Slice of Pizza',                  brand: null, size: 'each', retail: 2.99, cost: 0.99, sellUnitSize: null, depositRule: null },
  { dept: 'HOTFOOD', upc: null, plu: '5004', name: 'Mozzarella Sticks 5pc',           brand: null, size: '5pc',  retail: 3.99, cost: 1.49, sellUnitSize: null, depositRule: null },

  // ─── COFFEE & HOT DRINKS (4) ────────────────────────────────────────────
  { dept: 'COFFEE', upc: null, plu: '6001', name: 'Regular Coffee Small 12oz', brand: null, size: '12oz', retail: 1.99, cost: 0.45, sellUnitSize: null, depositRule: null },
  { dept: 'COFFEE', upc: null, plu: '6002', name: 'Regular Coffee Large 20oz', brand: null, size: '20oz', retail: 2.49, cost: 0.55, sellUnitSize: null, depositRule: null },
  { dept: 'COFFEE', upc: null, plu: '6003', name: 'Cappuccino 12oz',           brand: null, size: '12oz', retail: 2.99, cost: 0.79, sellUnitSize: null, depositRule: null },
  { dept: 'COFFEE', upc: null, plu: '6004', name: 'Hot Chocolate 12oz',        brand: null, size: '12oz', retail: 2.49, cost: 0.59, sellUnitSize: null, depositRule: null },

  // ─── GENERAL MERCHANDISE (3) ────────────────────────────────────────────
  { dept: 'MERCH', upc: '041333802022', name: 'Energizer AA Batteries 4pk', brand: 'Energizer', size: '4pk',   retail: 6.99, cost: 3.99, sellUnitSize: null, depositRule: null },
  { dept: 'MERCH', upc: '650290003026', name: 'Reusable Shopping Bag',      brand: null,        size: 'each',  retail: 0.99, cost: 0.29, sellUnitSize: null, depositRule: null },
  { dept: 'MERCH', upc: '046677179038', name: 'Zippo Lighter Fluid 5.9oz',  brand: 'Zippo',     size: '5.9oz', retail: 5.99, cost: 3.29, sellUnitSize: null, depositRule: null },

  // ─── LOTTERY (2) ────────────────────────────────────────────────────────
  { dept: 'LOTTERY', upc: null, plu: '7001', name: 'Scratch Ticket $1', brand: 'Maine Lottery', size: 'each', retail: 1.00, cost: 1.00, sellUnitSize: null, depositRule: null, ageRequired: 18 },
  { dept: 'LOTTERY', upc: null, plu: '7005', name: 'Scratch Ticket $5', brand: 'Maine Lottery', size: 'each', retail: 5.00, cost: 5.00, sellUnitSize: null, depositRule: null, ageRequired: 18 },
];

// ─────────────────────────────────────────────────────────
// SEED
// ─────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🌱 Seeding PostgreSQL for orgId: ${ORG_ID}\n`);

  // ── Organization ─────────────────────────────────────────
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: { name: 'Fortune Technology' },
    create: {
      id: ORG_ID,
      name: 'Fortune Technology',
      slug: 'fortune-tech',
      plan: 'pro',
    },
  });
  console.log(`  ✓ Organization '${ORG_ID}' created/verified`);

  // ── Store ───────────────────────────────────────────────
  const storeId = 'default-store';
  await prisma.store.upsert({
    where: { id: storeId },
    update: { name: 'Main Street Marketplace' },
    create: {
      id: storeId,
      orgId: ORG_ID,
      name: 'Main Street Marketplace',
      address: '123 Main St, Portland, ME 04101',
      timezone: 'America/New_York',
      isActive: true,
    },
  });
  console.log(`  ✓ Default store '${storeId}' created/verified`);

  // ── Departments ──────────────────────────────────────────
  let deptCount = 0;
  for (const dept of DEPARTMENTS) {
    await prisma.department.upsert({
      where:  { orgId_code: { orgId: ORG_ID, code: dept.code } },
      update: {
        name: dept.name, taxClass: dept.taxClass,
        ageRequired: dept.ageRequired ?? null,
        ebtEligible: dept.ebtEligible, bottleDeposit: dept.bottleDeposit,
        sortOrder: dept.sortOrder, color: dept.color,
      },
      create: { orgId: ORG_ID, ...dept, ageRequired: dept.ageRequired ?? null },
    });
    deptCount++;
  }
  console.log(`  ✓ ${deptCount} departments seeded`);

  // Build dept code → id map
  const deptRows = await prisma.department.findMany({ where: { orgId: ORG_ID }, select: { id: true, code: true } });
  const deptMap  = Object.fromEntries(deptRows.map(d => [d.code, d.id]));

  // ── Tax Rules ────────────────────────────────────────────
  for (const rule of TAX_RULES) {
    const existing = await prisma.taxRule.findFirst({ where: { orgId: ORG_ID, name: rule.name } });
    if (!existing) await prisma.taxRule.create({ data: { orgId: ORG_ID, ...rule } });
  }
  console.log(`  ✓ ${TAX_RULES.length} tax rules seeded`);

  // ── Deposit Rules ────────────────────────────────────────
  const depositRuleMap = {}; // 'small' | 'large' → { id, depositAmount }
  for (const rule of DEPOSIT_RULES) {
    let row = await prisma.depositRule.findFirst({ where: { orgId: ORG_ID, name: rule.name } });
    if (!row) row = await prisma.depositRule.create({ data: { orgId: ORG_ID, ...rule } });
    const key = rule.name.includes('Small') ? 'small' : 'large';
    depositRuleMap[key] = { id: row.id, depositAmount: Number(rule.depositAmount) };
  }
  console.log(`  ✓ ${DEPOSIT_RULES.length} deposit rules seeded`);

  // ── Products ─────────────────────────────────────────────
  let created = 0, updated = 0, skipped = 0;

  for (const p of PRODUCTS) {
    const deptId = deptMap[p.dept];
    if (!deptId) { console.warn(`  ⚠ No dept found for code ${p.dept} — skipping ${p.name}`); skipped++; continue; }

    // Resolve deposit rule
    const drId  = p.depositRule ? depositRuleMap[p.depositRule]?.id ?? null : null;

    // Determine taxClass from department
    const deptDef   = DEPARTMENTS.find(d => d.code === p.dept);
    const taxClass  = deptDef?.taxClass || 'grocery';
    const ageReq    = p.ageRequired ?? deptDef?.ageRequired ?? null;
    const ebtElig   = p.ebtEligible ?? deptDef?.ebtEligible ?? false;

    const data = {
      orgId:              ORG_ID,
      name:               p.name,
      brand:              p.brand        || null,
      upc:                p.upc          || null,
      plu:                p.plu          || null,
      size:               p.size         || null,
      departmentId:       deptId,
      taxClass,
      ageRequired:        ageReq,
      ebtEligible:        ebtElig,
      // Grocery EBT items are tax-exempt; alcohol/tobacco/etc. are taxable
      taxable:            taxClass !== 'grocery' || !ebtElig,
      defaultRetailPrice: p.retail,
      defaultCostPrice:   p.cost,
      depositRuleId:      drId,
      // sellUnitSize = # of individual containers per sell unit
      // Used by catalog snapshot to compute per-sell-unit deposit:
      //   depositAmount = depositRule.depositAmount × sellUnitSize
      sellUnitSize:       p.sellUnitSize ?? null,
      byWeight:           p.byWeight ?? false,
      active:             true,
    };

    // Upsert by orgId + upc (only when upc is present)
    if (p.upc) {
      const existing = await prisma.masterProduct.findFirst({
        where: { orgId: ORG_ID, upc: p.upc },
      });
      if (existing) {
        await prisma.masterProduct.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.masterProduct.create({ data });
        created++;
      }
    } else {
      // PLU-only item — upsert by orgId + name (no unique key available without UPC)
      const existing = await prisma.masterProduct.findFirst({
        where: { orgId: ORG_ID, name: p.name },
      });
      if (existing) {
        await prisma.masterProduct.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.masterProduct.create({ data });
        created++;
      }
    }
  }

  console.log(`  ✓ Products — ${created} created, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}`);

  // ── Seed Users (one per role) ───────────────────────────────
  // System org for superadmin
  let systemOrg = await prisma.organization.findFirst({ where: { slug: 'system' } });
  if (!systemOrg) {
    systemOrg = await prisma.organization.create({
      data: { name: 'System Administration', slug: 'system', plan: 'enterprise', maxStores: 999, maxUsers: 999, isActive: true },
    });
  }

  const SEED_USERS = [
    { name: 'System Admin',   email: 'admin@storeveu.com',   role: 'superadmin', orgId: systemOrg.id },
    { name: 'Store Owner',    email: 'owner@storeveu.com',   role: 'owner',      orgId: ORG_ID },
    { name: 'Store Manager',  email: 'manager@storeveu.com', role: 'manager',    orgId: ORG_ID },
    { name: 'Front Cashier',  email: 'cashier@storeveu.com', role: 'cashier',    orgId: ORG_ID },
    { name: 'Staff Member',   email: 'staff@storeveu.com',   role: 'staff',      orgId: ORG_ID },
  ];

  const defaultPassword = 'Admin@123';
  const hashed = await bcrypt.hash(defaultPassword, 12);
  let userCount = 0;

  for (const u of SEED_USERS) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing) continue;

    const user = await prisma.user.create({
      data: { name: u.name, email: u.email, password: hashed, role: u.role, status: 'active', orgId: u.orgId },
    });

    // Link non-superadmin users to the default store
    if (u.role !== 'superadmin') {
      await prisma.userStore.create({ data: { userId: user.id, storeId } }).catch(() => {});
    }

    userCount++;
  }

  if (userCount > 0) {
    console.log(`  ✓ ${userCount} users created`);
    console.log(`    (See prisma/.seed-credentials for default passwords — gitignored)`);
    SEED_USERS.forEach(u => console.log(`      ${u.role.padEnd(12)} → ${u.email}`));
    // Write passwords to a gitignored file instead of logging to console.
    try {
      const fs = await import('fs');
      const path = await import('path');
      const out = path.resolve(process.cwd(), 'prisma', '.seed-credentials');
      const lines = [
        `# Seed credentials — DO NOT COMMIT`,
        `# Generated ${new Date().toISOString()}`,
        `default_password=${defaultPassword}`,
        ...SEED_USERS.map(u => `${u.email}=${defaultPassword}`),
      ];
      fs.writeFileSync(out, lines.join('\n'), { mode: 0o600 });
    } catch { /* best-effort */ }
  } else {
    console.log(`  ✓ All seed users already exist`);
  }

  // ── Lottery Games & Data ──────────────────────────────────
  await seedLottery(ORG_ID, storeId);

  console.log(`\n✅ Seed complete! ${created + updated} / ${PRODUCTS.length} products in catalog.\n`);
}

// ─────────────────────────────────────────────────────────
// LOTTERY SEED (inline)
// ─────────────────────────────────────────────────────────
const ONTARIO_GAMES = [
  { name: '$100,000 Jackpot',   gameNumber: '3001', ticketPrice: 5.00,  ticketsPerBox: 600 },
  { name: '$500,000 Jackpot',   gameNumber: '3002', ticketPrice: 10.00, ticketsPerBox: 500 },
  { name: '$1,000,000 Jackpot', gameNumber: '3003', ticketPrice: 20.00, ticketsPerBox: 300 },
  { name: '$2,000,000 Jackpot', gameNumber: '3004', ticketPrice: 30.00, ticketsPerBox: 200 },
  { name: 'Lucky Lines',        gameNumber: '2201', ticketPrice: 2.00,  ticketsPerBox: 600 },
  { name: 'Crossword',          gameNumber: '2202', ticketPrice: 3.00,  ticketsPerBox: 600 },
  { name: 'Wheel of Fortune',   gameNumber: '2203', ticketPrice: 5.00,  ticketsPerBox: 600 },
  { name: '7, 11, 21',          gameNumber: '2204', ticketPrice: 1.00,  ticketsPerBox: 600 },
  { name: 'Break the Bank',     gameNumber: '2205', ticketPrice: 3.00,  ticketsPerBox: 600 },
  { name: 'Gold Rush',          gameNumber: '2206', ticketPrice: 2.00,  ticketsPerBox: 600 },
  { name: 'Instant Bingo',      gameNumber: '2207', ticketPrice: 3.00,  ticketsPerBox: 600 },
  { name: 'Bonus Cashword',     gameNumber: '2208', ticketPrice: 5.00,  ticketsPerBox: 600 },
  { name: 'Fast Cash',          gameNumber: '2209', ticketPrice: 2.00,  ticketsPerBox: 600 },
  { name: 'Bigger Bucks',       gameNumber: '2210', ticketPrice: 5.00,  ticketsPerBox: 600 },
  { name: 'Lucky 7s',           gameNumber: '2211', ticketPrice: 2.00,  ticketsPerBox: 600 },
  { name: 'Diamond 7s',         gameNumber: '2212', ticketPrice: 3.00,  ticketsPerBox: 600 },
  { name: 'Triple 777',         gameNumber: '2213', ticketPrice: 5.00,  ticketsPerBox: 600 },
  { name: 'Merry Money',        gameNumber: '2214', ticketPrice: 3.00,  ticketsPerBox: 600 },
  { name: 'Extra Cash',         gameNumber: '2215', ticketPrice: 1.00,  ticketsPerBox: 600 },
  { name: 'Cash Blitz',         gameNumber: '2216', ticketPrice: 5.00,  ticketsPerBox: 600 },
];

const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const rand    = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick    = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function seedLottery(orgId, storeId) {
  // Check if lottery data already exists
  const existingGames = await prisma.lotteryGame.count({ where: { orgId, storeId } });
  if (existingGames > 0) {
    console.log(`  ✓ Lottery data already exists (${existingGames} games) — skipping`);
    return;
  }

  console.log('\n  🎟️  Seeding lottery data...');

  // Games
  const gameRecords = [];
  for (const g of ONTARIO_GAMES) {
    const game = await prisma.lotteryGame.create({
      data: {
        orgId, storeId,
        name: g.name, gameNumber: g.gameNumber,
        ticketPrice: g.ticketPrice, ticketsPerBox: g.ticketsPerBox,
        active: true,
      },
    });
    gameRecords.push(game);
  }
  console.log(`  ✓ ${gameRecords.length} lottery games (Ontario OLGC)`);

  // Boxes: 4 active, 6 inventory, 3 depleted
  let boxCount = 0;
  for (let i = 0; i < 4; i++) {
    const game = gameRecords[i];
    const ticketsSold = rand(50, 400);
    await prisma.lotteryBox.create({
      data: {
        orgId, storeId, gameId: game.id,
        boxNumber: `B${String(i + 1).padStart(3, '0')}`, slotNumber: i + 1,
        totalTickets: game.ticketsPerBox, ticketPrice: game.ticketPrice,
        totalValue: (Number(game.ticketPrice) * game.ticketsPerBox).toFixed(2),
        status: 'active', activatedAt: daysAgo(rand(1, 7)),
        ticketsSold, salesAmount: (ticketsSold * Number(game.ticketPrice)).toFixed(2),
      },
    });
    boxCount++;
  }
  for (let i = 0; i < 6; i++) {
    const game = pick(gameRecords.slice(4));
    await prisma.lotteryBox.create({
      data: {
        orgId, storeId, gameId: game.id,
        boxNumber: `B${String(i + 10).padStart(3, '0')}`,
        totalTickets: game.ticketsPerBox, ticketPrice: game.ticketPrice,
        totalValue: (Number(game.ticketPrice) * game.ticketsPerBox).toFixed(2),
        status: 'inventory', ticketsSold: 0, salesAmount: 0,
      },
    });
    boxCount++;
  }
  for (let i = 0; i < 3; i++) {
    const game = pick(gameRecords.slice(0, 5));
    await prisma.lotteryBox.create({
      data: {
        orgId, storeId, gameId: game.id,
        boxNumber: `B${String(i + 20).padStart(3, '0')}`,
        totalTickets: game.ticketsPerBox, ticketPrice: game.ticketPrice,
        totalValue: (Number(game.ticketPrice) * game.ticketsPerBox).toFixed(2),
        status: 'depleted', activatedAt: daysAgo(rand(7, 21)), depletedAt: daysAgo(rand(1, 6)),
        ticketsSold: game.ticketsPerBox,
        salesAmount: (Number(game.ticketPrice) * game.ticketsPerBox).toFixed(2),
      },
    });
    boxCount++;
  }
  console.log(`  ✓ ${boxCount} lottery boxes (4 active, 6 inventory, 3 depleted)`);

  // Transactions (30 days)
  const txns = [];
  for (let day = 29; day >= 0; day--) {
    const date = daysAgo(day);
    for (let s = 0; s < rand(5, 20); s++) {
      const game = pick(gameRecords);
      txns.push({
        orgId, storeId, type: 'sale',
        amount: pick([Number(game.ticketPrice), Number(game.ticketPrice) * 2, Number(game.ticketPrice) * 5]),
        gameId: game.id,
        createdAt: new Date(date.getTime() + rand(28800000, 72000000)),
      });
    }
    for (let p = 0; p < rand(1, 4); p++) {
      txns.push({
        orgId, storeId, type: 'payout',
        amount: pick([5, 10, 20, 50, 100, 200, 500]),
        createdAt: new Date(date.getTime() + rand(28800000, 72000000)),
      });
    }
  }
  await prisma.lotteryTransaction.createMany({ data: txns });
  console.log(`  ✓ ${txns.length} lottery transactions (30 days)`);

  // Shift reports (14 days)
  let reportCount = 0;
  for (let day = 13; day >= 1; day--) {
    const date = daysAgo(day);
    const dayStart = new Date(date); dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(date); dayEnd.setHours(23,59,59,999);
    const dayTxns = txns.filter(t => t.createdAt >= dayStart && t.createdAt <= dayEnd);
    const totalSales = dayTxns.filter(t => t.type === 'sale').reduce((s, t) => s + Number(t.amount), 0);
    const totalPayouts = dayTxns.filter(t => t.type === 'payout').reduce((s, t) => s + Number(t.amount), 0);
    const netAmount = totalSales - totalPayouts;
    const varPct = Math.random() * 0.04 - 0.02;
    const actual = netAmount * (1 + varPct);
    await prisma.lotteryShiftReport.create({
      data: {
        orgId, storeId, shiftId: `shift-demo-day${day}`,
        machineAmount: parseFloat((actual * 0.8).toFixed(2)),
        digitalAmount: parseFloat((actual * 0.2).toFixed(2)),
        totalSales: parseFloat(totalSales.toFixed(2)),
        totalPayouts: parseFloat(totalPayouts.toFixed(2)),
        netAmount: parseFloat(netAmount.toFixed(2)),
        variance: parseFloat((actual - netAmount).toFixed(2)),
        closedAt: dayEnd, createdAt: dayEnd, updatedAt: dayEnd,
      },
    });
    reportCount++;
  }
  console.log(`  ✓ ${reportCount} lottery shift reports`);
}

main()
  .catch((e) => {
    console.error('✗ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
