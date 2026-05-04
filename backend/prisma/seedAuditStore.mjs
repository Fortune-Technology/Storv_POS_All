/**
 * Audit Store Seed — Stage 1 (Fixtures)
 *
 * Creates a brand-new isolated "Audit Org" + "Audit Store" with all the
 * fixtures needed to test reports against known totals:
 *   • 6 departments (Grocery, Beverages, Tobacco, Alcohol, Lottery, Fuel)
 *   • 9 products spanning departments — some with deposits, EBT, age gates
 *   • Tax rules (5%, 8.875%) + Deposit rules ($0.05, $0.10)
 *   • 2 cashier users (Alice, Bob) with PINs
 *   • 2 stations (Register 1, Register 2)
 *   • Lottery: settings + 2 games + 2 active boxes
 *   • Fuel: settings + 1 type + 1 tank + 1 delivery (FIFO layer)
 *
 * Idempotent — deleting and re-creating the audit org wipes everything
 * scoped to it without touching any other org.
 *
 * Stage 2 will seed historical transactions with known totals.
 * Stage 3 will emit audit-expected.json (ground truth for the audit).
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';

const p = new PrismaClient();

const AUDIT_ORG_SLUG = 'audit-org';
const AUDIT_STORE_NAME = 'Audit Store';
const AUDIT_STORE_CODE = 'AUDIT-001';

console.log('=== AUDIT STORE SEED — STAGE 1 (FIXTURES) ===\n');

// ── Wipe prior audit org if it exists ──────────────────────────────────
const existingOrg = await p.organization.findFirst({ where: { slug: AUDIT_ORG_SLUG } });

if (existingOrg) {
  console.log(`Found existing audit org [${existingOrg.id}] — wiping...`);
  const orgId = existingOrg.id;

  const storeIds = (await p.store.findMany({ where: { orgId }, select: { id: true } })).map(s => s.id);
  const shiftIds = (await p.shift.findMany({ where: { orgId }, select: { id: true } })).map(s => s.id);
  const userIds  = (await p.user.findMany({ where: { orgId }, select: { id: true } })).map(u => u.id);

  // Fuel
  await p.fuelTransaction.deleteMany({ where: { orgId } });
  await p.fuelStickReading.deleteMany({ where: { orgId } });
  await p.fuelDeliveryItem.deleteMany({ where: { delivery: { orgId } } });
  await p.fuelDelivery.deleteMany({ where: { orgId } });
  await p.fuelTank.deleteMany({ where: { orgId } });
  await p.fuelType.deleteMany({ where: { orgId } });
  await p.fuelSettings.deleteMany({ where: { orgId } });

  // Lottery
  await p.lotteryTransaction.deleteMany({ where: { orgId } });
  await p.lotteryScanEvent.deleteMany({ where: { orgId } });
  await p.lotteryShiftReport.deleteMany({ where: { orgId } });
  await p.lotteryOnlineTotal.deleteMany({ where: { orgId } });
  await p.lotteryBox.deleteMany({ where: { orgId } });
  await p.lotteryGame.deleteMany({ where: { orgId } });
  await p.lotterySettings.deleteMany({ where: { orgId } });

  // Shift-related
  if (shiftIds.length) {
    await p.cashDrop.deleteMany({ where: { shiftId: { in: shiftIds } } });
    await p.cashPayout.deleteMany({ where: { shiftId: { in: shiftIds } } });
  }
  await p.shift.deleteMany({ where: { orgId } });
  await p.transaction.deleteMany({ where: { orgId } });

  // Catalog
  await p.storeProduct.deleteMany({ where: { orgId } });
  await p.masterProduct.deleteMany({ where: { orgId } });
  await p.departmentAttribute.deleteMany({ where: { orgId } });
  await p.department.deleteMany({ where: { orgId } });
  await p.depositRule.deleteMany({ where: { orgId } });
  await p.taxRule.deleteMany({ where: { orgId } });
  await p.vendorPayment.deleteMany({ where: { orgId } });
  await p.station.deleteMany({ where: { orgId } });

  // Users
  if (userIds.length) {
    await p.userStore.deleteMany({ where: { userId: { in: userIds } } });
    await p.userOrg.deleteMany({ where: { userId: { in: userIds } } });
    await p.user.deleteMany({ where: { id: { in: userIds } } });
  }

  // Store + Org last
  await p.store.deleteMany({ where: { orgId } });
  await p.organization.delete({ where: { id: orgId } });
  console.log('Wiped.\n');
}

// ── 1. Org ─────────────────────────────────────────────────────────────
const org = await p.organization.create({
  data: { name: 'Audit Org', slug: AUDIT_ORG_SLUG, isActive: true },
});
console.log(`✓ Org created [${org.id}]`);

// ── 2. Store ───────────────────────────────────────────────────────────
const store = await p.store.create({
  data: {
    orgId: org.id,
    name: AUDIT_STORE_NAME,
    storeCode: AUDIT_STORE_CODE,
    timezone: 'America/New_York',
    stateCode: 'MA',
    isActive: true,
    stationCount: 2,
  },
});
console.log(`✓ Store created [${store.id}] code=${AUDIT_STORE_CODE}`);

// ── 3. Cashiers ────────────────────────────────────────────────────────
const passwordHash  = await bcrypt.hash('Audit@1234!', 10);
const alicePinHash  = await bcrypt.hash('1111', 10);
const bobPinHash    = await bcrypt.hash('2222', 10);

const alice = await p.user.create({
  data: {
    name: 'Alice (Audit)',
    email: 'alice@audit.test',
    password: passwordHash,
    posPin: alicePinHash,
    role: 'cashier',
    organization: { connect: { id: org.id } },
    status: 'active',
    // S77 — bypass vendor onboarding gate for audit-test cashiers
    onboardingSubmitted: true,
    contractSigned: true,
    vendorApproved: true,
  },
});

const bob = await p.user.create({
  data: {
    name: 'Bob (Audit)',
    email: 'bob@audit.test',
    password: passwordHash,
    posPin: bobPinHash,
    role: 'cashier',
    organization: { connect: { id: org.id } },
    status: 'active',
    // S77 — bypass vendor onboarding gate for audit-test cashiers
    onboardingSubmitted: true,
    contractSigned: true,
    vendorApproved: true,
  },
});

await p.userOrg.create({ data: { userId: alice.id, orgId: org.id, role: 'cashier', isPrimary: true } });
await p.userOrg.create({ data: { userId: bob.id,   orgId: org.id, role: 'cashier', isPrimary: true } });
await p.userStore.create({ data: { userId: alice.id, storeId: store.id } });
await p.userStore.create({ data: { userId: bob.id,   storeId: store.id } });
console.log(`✓ Cashiers created — Alice [${alice.id.slice(-6)}] PIN=1111, Bob [${bob.id.slice(-6)}] PIN=2222`);

// ── 4. Stations ────────────────────────────────────────────────────────
const station1 = await p.station.create({
  data: { orgId: org.id, storeId: store.id, name: 'Register 1', token: `audit-r1-${Date.now()}` },
});
const station2 = await p.station.create({
  data: { orgId: org.id, storeId: store.id, name: 'Register 2', token: `audit-r2-${Date.now()}` },
});
console.log(`✓ Stations created — Register 1 [${station1.id.slice(-6)}], Register 2 [${station2.id.slice(-6)}]`);

// ── 5. Departments (S65: created BEFORE tax rules so departmentIds can link) ──
async function dept(d) {
  return p.department.create({ data: { orgId: org.id, ...d } });
}
const deptGrocery   = await dept({ name: 'Grocery',    code: 'GROC',  category: 'general',  ageRequired: null, ebtEligible: true,  taxClass: 'grocery', defaultTaxRate: 0.05,    bottleDeposit: false, sortOrder: 1, color: '#10b981', active: true });
const deptBeverages = await dept({ name: 'Beverages',  code: 'BEV',   category: 'general',  ageRequired: null, ebtEligible: true,  taxClass: 'grocery', defaultTaxRate: 0.05,    bottleDeposit: true,  sortOrder: 2, color: '#3b82f6', active: true });
const deptTobacco   = await dept({ name: 'Tobacco',    code: 'TOBAC', category: 'tobacco',  ageRequired: 21,   ebtEligible: false, taxClass: 'tobacco', defaultTaxRate: 0.08875, bottleDeposit: false, sortOrder: 3, color: '#dc2626', active: true });
const deptAlcohol   = await dept({ name: 'Alcohol',    code: 'ALCO',  category: 'beer',     ageRequired: 21,   ebtEligible: false, taxClass: 'alcohol', defaultTaxRate: 0.08875, bottleDeposit: true,  sortOrder: 4, color: '#f59e0b', active: true });
const deptLottery   = await dept({ name: 'Lottery',    code: 'LOTTO', category: 'general',  ageRequired: 18,   ebtEligible: false, taxClass: 'none',    defaultTaxRate: 0,       bottleDeposit: false, sortOrder: 5, color: '#a855f7', active: true });
const deptFuel      = await dept({ name: 'Fuel',       code: 'FUEL',  category: 'general',  ageRequired: null, ebtEligible: false, taxClass: 'none',    defaultTaxRate: 0,       bottleDeposit: false, sortOrder: 6, color: '#06b6d4', active: true });

// ── 6. Tax rules (Session 56b: link via departmentIds, no more appliesTo) ──
const tax5 = await p.taxRule.create({
  data: {
    orgId: org.id, storeId: store.id,
    name: 'Audit 5% Sales Tax',
    rate: 0.05,
    departmentIds: [deptGrocery.id, deptBeverages.id],
    ebtExempt: true, state: 'MA', active: true,
  },
});
const tax8875 = await p.taxRule.create({
  data: {
    orgId: org.id, storeId: store.id,
    name: 'Audit 8.875% Tobacco/Alcohol',
    rate: 0.08875,
    departmentIds: [deptTobacco.id, deptAlcohol.id],
    ebtExempt: true, state: 'MA', active: true,
  },
});
console.log(`✓ Tax rules created — 5% [${tax5.id}], 8.875% [${tax8875.id}]`);

// ── 7. Deposit rules ───────────────────────────────────────────────────
const deposit5c = await p.depositRule.create({
  data: {
    orgId: org.id, name: 'Audit 12oz Container Deposit',
    minVolumeOz: 0, maxVolumeOz: 24, containerTypes: 'bottle,can',
    depositAmount: 0.05, state: 'MA', active: true,
  },
});
const deposit10c = await p.depositRule.create({
  data: {
    orgId: org.id, name: 'Audit 32oz+ Container Deposit',
    minVolumeOz: 24, maxVolumeOz: null, containerTypes: 'bottle,can',
    depositAmount: 0.10, state: 'MA', active: true,
  },
});
console.log(`✓ Deposit rules created — $0.05 [${deposit5c.id}], $0.10 [${deposit10c.id}]`);
console.log(`✓ Departments created — 6 (Grocery, Beverages, Tobacco, Alcohol, Lottery, Fuel)`);

// ── 8. Products ────────────────────────────────────────────────────────
let upcSeed = 99000000001;
async function product(name, deptObj, retail, opts = {}) {
  const upc = (upcSeed++).toString();
  return p.masterProduct.create({
    data: {
      orgId: org.id,
      departmentId: deptObj.id,
      name,
      upc,
      defaultRetailPrice: retail,
      defaultCostPrice: opts.cost ?? Math.round(retail * 0.6 * 100) / 100,
      taxClass: deptObj.taxClass,
      taxable: deptObj.taxClass !== 'none',
      ageRequired: deptObj.ageRequired,
      ebtEligible: opts.ebt ?? deptObj.ebtEligible,
      depositRuleId: opts.depositRuleId || null,
      containerType: opts.containerType || null,
      containerVolumeOz: opts.containerVolumeOz || null,
      taxRuleId: opts.taxRuleId || null,
      trackInventory: false,
      discountEligible: true,
    },
  });
}

const products = {
  // Grocery (5% tax, EBT eligible)
  bread:    await product('Bread Loaf',          deptGrocery,   3.99, { ebt: true, taxRuleId: tax5.id }),
  apples:   await product('Apples 1lb',          deptGrocery,   1.99, { ebt: true, taxRuleId: tax5.id }),
  milk:     await product('Milk Half Gallon',    deptGrocery,   4.49, { ebt: true, taxRuleId: tax5.id }),
  eggs:     await product('Eggs Dozen',          deptGrocery,   5.99, { ebt: true, taxRuleId: tax5.id }),
  // Beverages (5% tax + deposit, EBT eligible)
  coke12:   await product('Coke Can 12oz',       deptBeverages, 1.50, { ebt: true,  taxRuleId: tax5.id, depositRuleId: deposit5c.id,  containerType: 'can',    containerVolumeOz: 12 }),
  pepsi12:  await product('Pepsi Can 12oz',      deptBeverages, 1.50, { ebt: true,  taxRuleId: tax5.id, depositRuleId: deposit5c.id,  containerType: 'can',    containerVolumeOz: 12 }),
  water32:  await product('Water Bottle 32oz',   deptBeverages, 1.99, { ebt: true,  taxRuleId: tax5.id, depositRuleId: deposit10c.id, containerType: 'bottle', containerVolumeOz: 32 }),
  // Tobacco (8.875% tax, age 21+)
  marlboro: await product('Marlboro Pack',       deptTobacco,  11.99, { ebt: false, taxRuleId: tax8875.id }),
  // Alcohol (8.875% tax + deposit, age 21+)
  budlight: await product('Bud Light Can 12oz',  deptAlcohol,   2.99, { ebt: false, taxRuleId: tax8875.id, depositRuleId: deposit5c.id, containerType: 'can', containerVolumeOz: 12 }),
};
console.log(`✓ Products created — ${Object.keys(products).length} (4 grocery, 3 beverages, 1 tobacco, 1 alcohol)`);

// ── 9. StoreProduct (per-store inventory + price overrides; here just plain) ──
for (const prod of Object.values(products)) {
  await p.storeProduct.create({
    data: {
      orgId: org.id,
      storeId: store.id,
      masterProductId: prod.id,
      retailPrice: prod.defaultRetailPrice,
      costPrice: prod.defaultCostPrice,
      quantityOnHand: 100,
      active: true,
      inStock: true,
    },
  });
}
console.log(`✓ StoreProduct rows created (qty 100 each)`);

// ── 10. Lottery ────────────────────────────────────────────────────────
await p.lotterySettings.create({
  data: {
    orgId: org.id, storeId: store.id,
    enabled: true, cashOnly: false, state: 'MA',
    commissionRate: 0.05,
    scanRequiredAtShiftEnd: false,
    sellDirection: 'desc',
    allowMultipleActivePerGame: false,
  },
});

const lottoGame5 = await p.lotteryGame.create({
  data: {
    orgId: org.id, storeId: store.id,
    name: '$5 Scratch', ticketPrice: 5, ticketsPerBox: 150,
    state: 'MA', isGlobal: false, active: true,
  },
});
const lottoGame10 = await p.lotteryGame.create({
  data: {
    orgId: org.id, storeId: store.id,
    name: '$10 Big Winner', ticketPrice: 10, ticketsPerBox: 75,
    state: 'MA', isGlobal: false, active: true,
  },
});

const eightDaysAgo = new Date(Date.now() - 8 * 86400000);

const box5 = await p.lotteryBox.create({
  data: {
    orgId: org.id, storeId: store.id, gameId: lottoGame5.id,
    boxNumber: 'B5-001', totalTickets: 150, ticketPrice: 5, totalValue: 750,
    status: 'active', activatedAt: eightDaysAgo,
    startTicket: '149', currentTicket: '149',
  },
});
const box10 = await p.lotteryBox.create({
  data: {
    orgId: org.id, storeId: store.id, gameId: lottoGame10.id,
    boxNumber: 'B10-001', totalTickets: 75, ticketPrice: 10, totalValue: 750,
    status: 'active', activatedAt: eightDaysAgo,
    startTicket: '74', currentTicket: '74',
  },
});
console.log(`✓ Lottery created — settings + 2 games + 2 active boxes (each totalValue $750)`);

// ── 11. Fuel ───────────────────────────────────────────────────────────
await p.fuelSettings.create({
  data: {
    orgId: org.id, storeId: store.id,
    enabled: true, cashOnly: false, allowRefunds: true,
    defaultEntryMode: 'amount',
    reconciliationCadence: 'shift',
    varianceAlertThreshold: 2.0,
    blendingEnabled: false,
    pumpTrackingEnabled: false,
  },
});

const fuelTypeReg = await p.fuelType.create({
  data: {
    orgId: org.id, storeId: store.id,
    name: 'Regular', gradeLabel: '87 Octane',
    pricePerGallon: 3.999, color: '#16a34a',
    isDefault: true, isTaxable: false, sortOrder: 1, active: true,
  },
});

const fuelTank = await p.fuelTank.create({
  data: {
    orgId: org.id, storeId: store.id,
    name: 'Tank A - Regular 87', tankCode: 'A1',
    fuelTypeId: fuelTypeReg.id,
    capacityGal: 10000, diameterInches: 96, lengthInches: 240,
    topology: 'independent', isPrimary: true, active: true,
  },
});

const fuelDelivery = await p.fuelDelivery.create({
  data: {
    orgId: org.id, storeId: store.id,
    deliveryDate: eightDaysAgo,
    supplier: 'Audit Fuel Distributor',
    bolNumber: 'AUDIT-BOL-001',
    totalGallons: 5000, totalCost: 16000, // 5000 × $3.20
  },
});

await p.fuelDeliveryItem.create({
  data: {
    deliveryId: fuelDelivery.id,
    tankId: fuelTank.id,
    gallonsReceived: 5000, pricePerGallon: 3.20, totalCost: 16000,
    remainingGallons: 5000,
  },
});
console.log(`✓ Fuel created — settings + 1 type + 1 tank (10,000 gal cap) + 1 delivery (5,000 gal @ $3.20)`);

// ── Save reference IDs for Stage 2 ─────────────────────────────────────
const fixturesPath = 'audit-fixtures.json';
fs.writeFileSync(fixturesPath, JSON.stringify({
  orgId: org.id,
  storeId: store.id,
  cashierAlice: alice.id,
  cashierBob: bob.id,
  station1: station1.id,
  station2: station2.id,
  taxRules: { tax5: tax5.id, tax8875: tax8875.id },
  depositRules: { d5: deposit5c.id, d10: deposit10c.id },
  departments: {
    grocery:   deptGrocery.id,
    beverages: deptBeverages.id,
    tobacco:   deptTobacco.id,
    alcohol:   deptAlcohol.id,
    lottery:   deptLottery.id,
    fuel:      deptFuel.id,
  },
  products: Object.fromEntries(
    Object.entries(products).map(([k, v]) => [k, {
      id: v.id, upc: v.upc,
      retail: Number(v.defaultRetailPrice),
      deptId: v.departmentId,
      ebt: v.ebtEligible,
      ageRequired: v.ageRequired,
    }])
  ),
  lottery: {
    game5:  { id: lottoGame5.id,  ticketPrice: 5,  ticketsPerBox: 150 },
    game10: { id: lottoGame10.id, ticketPrice: 10, ticketsPerBox: 75 },
    box5:  { id: box5.id,  totalTickets: 150, startTicket: '149' },
    box10: { id: box10.id, totalTickets: 75,  startTicket: '74'  },
    commissionRate: 0.05,
  },
  fuel: {
    typeReg:    { id: fuelTypeReg.id, pricePerGallon: 3.999 },
    tankA:      { id: fuelTank.id,    capacityGal: 10000 },
    delivery1:  { id: fuelDelivery.id, gallons: 5000, costPerGal: 3.20 },
  },
}, null, 2));

console.log(`\n✓ Reference IDs saved to ${fixturesPath}`);
console.log('\n=== STAGE 1 COMPLETE ===');
console.log(`Org:    ${org.id}  (Audit Org)`);
console.log(`Store:  ${store.id}  (Audit Store, code=${AUDIT_STORE_CODE})`);
console.log(`Cashiers: Alice/PIN=1111, Bob/PIN=2222`);
console.log('Next: run seedAuditTransactions.mjs (Stage 2)');

await p.$disconnect();
