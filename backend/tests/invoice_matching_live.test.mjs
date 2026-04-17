// Live test for matchLineItems — runs against the rewritten cascade with
// fixtures built from the 5 real sample invoices attached by the user.
// Stubs prisma lookups so no DB is touched.

import { jest } from '@jest/globals';

// Stub the prisma module before the matching service imports it.
// (Prisma accesses only vendorProductMap.findMany + globalProductMatch.findUnique here.)
jest.unstable_mockModule('../src/config/postgres.js', () => ({
  default: {
    vendorProductMap: { findMany: async () => [] },
    globalProductMatch: { findUnique: async () => null },
    masterProduct: { findMany: async () => [] },
  },
}));

// Also stub the OpenAI client used by the AI tier — so tests don't hit the network.
jest.unstable_mockModule('openai', () => ({
  default: class { chat = { completions: { create: async () => ({ choices: [{ message: { content: '{"matches":[]}' } }] }) } }; },
}));

const svc = await import('../src/services/matchingService.js');

// Catalog shaped like the 5 real sample invoices we were shown:
//   vendorId 1 = Hershey Creamery Co  (10-digit itemCodes)
//   vendorId 2 = Jeremy's Snacks/Utz  (5-digit itemCodes + UPCs)
//   vendorId 3 = Coca-Cola Beverages  (6-digit MAT codes + UPCs)
const catalog = [
  { posProductId: '101', name: 'Polar Chocolate Chip Sandwich 24/CT',  upc: '',              itemCode: '2468231280', plu: '',     sku: 'INT-POLAR-CC', retailPrice: 3.99, costPrice: 2.33, pack: 24, departmentId: '5', vendorId: '1' },
  { posProductId: '102', name: 'Giant Andes Mint IC Sandwich 24/CS',   upc: '',              itemCode: '2468231329', plu: '',     sku: 'INT-ANDES',    retailPrice: 2.99, costPrice: 1.48, pack: 24, departmentId: '5', vendorId: '1' },
  { posProductId: '103', name: 'Shains Red Raspberry Chip Quart',      upc: '',              itemCode: '1483530691', plu: '',     sku: 'INT-RRCHIP',   retailPrice: 7.99, costPrice: 22.95, pack: 1, departmentId: '5', vendorId: '1' },
  { posProductId: '201', name: '12.5oz Utz Rip Chip',                  upc: '004178027149',  itemCode: '27149',      plu: '',     sku: 'INT-UTZ-RIP',  retailPrice: 5.99, costPrice: 4.37, pack: 9, departmentId: '3', vendorId: '2' },
  { posProductId: '202', name: 'Utz 7.75oz Honey BBQ Chip',            upc: '004178027176',  itemCode: '27176',      plu: '',     sku: 'INT-UTZ-HBBQ', retailPrice: 4.99, costPrice: 3.64, pack: 4, departmentId: '3', vendorId: '2' },
  { posProductId: '301', name: '12 oz 12-Pk Coke',                     upc: '049000028904',  itemCode: '115583',     plu: '',     sku: 'INT-COKE12',   retailPrice: 6.99, costPrice: 3.925, pack: 4, departmentId: '2', vendorId: '3' },
  { posProductId: '302', name: '2 LTR Coke',                           upc: '049000050103',  itemCode: '132530',     plu: '',     sku: 'INT-COKE2L',   retailPrice: 2.99, costPrice: 19.30, pack: 8, departmentId: '2', vendorId: '3' },
  // Cross-vendor collision trap — Hershey ALSO has itemCode "27149"
  { posProductId: '901', name: 'Fake Hershey Collision Item',          upc: '',              itemCode: '27149',      plu: '',     sku: 'INT-COLLIDE',  retailPrice: 1.00, costPrice: 0.50, pack: 1, departmentId: '5', vendorId: '1' },
  // Produce item with PLU (no vendor)
  { posProductId: '701', name: 'Organic Bananas',                      upc: '',              itemCode: '',           plu: '4011', sku: 'INT-BANANA',   retailPrice: 0.79, costPrice: 0.45, pack: 1, departmentId: '1', vendorId: null },
];

describe('matchLineItems — Session 20: vendor-scoped itemCode cascade', () => {

  test('T1 Hershey invoice with vendorId=1 matches all 3 known codes via itemCode tier', async () => {
    const items = [
      { itemCode: '2468231280', description: 'POLAR CHOCOLATE CHIP SANDWICH 24/CT', caseCost: 55.86, quantity: 1 },
      { itemCode: '2468231329', description: 'GIANT ANDES MINT IC SANDWICH 24/CS',  caseCost: 35.52, quantity: 1 },
      { itemCode: '1483530691', description: 'SHAINS RED RASPBERRY CHIP QUART',     caseCost: 22.95, quantity: 1 },
      { itemCode: '9999999999', description: 'UNKNOWN PRODUCT',                     caseCost: 10.00, quantity: 1 },
    ];
    const out = await svc.matchLineItems(items, catalog, 'Hershey Creamery Co', { vendorId: 1 });

    expect(out[0].linkedProductId).toBe('101');
    expect(out[0].matchTier).toBe('itemCode');
    expect(out[0].confidence).toBe('high');

    expect(out[1].linkedProductId).toBe('102');
    expect(out[1].matchTier).toBe('itemCode');

    expect(out[2].linkedProductId).toBe('103');
    expect(out[2].matchTier).toBe('itemCode');

    // Unknown code — no match (or at most a low-confidence fuzzy attempt).
    // Important: it must NOT be forced onto a wrong product.
    if (out[3].linkedProductId) {
      expect(out[3].confidence).not.toBe('high');
    }
  });

  test('T2 Utz invoice with vendorId=2 avoids the Hershey collision (itemCode 27149)', async () => {
    const items = [
      { itemCode: '27149', description: '12.5 oz Utz Rip Chip',     caseCost: 39.33, quantity: 9 },
      { itemCode: '27176', description: '7.75 oz Utz Hny BBQ Chip', caseCost: 14.56, quantity: 4 },
    ];
    const out = await svc.matchLineItems(items, catalog, "Jeremy's Snacks", { vendorId: 2 });

    // Must match to Utz product 201, NOT to collision trap 901
    expect(out[0].linkedProductId).toBe('201');
    expect(out[0].linkedProductId).not.toBe('901');
    expect(out[0].matchTier).toBe('itemCode');
    expect(out[0].confidence).toBe('high');

    expect(out[1].linkedProductId).toBe('202');
  });

  test('T3 Utz invoice WITHOUT vendorId falls back to org-wide itemCode at medium confidence', async () => {
    const items = [
      { itemCode: '27149', description: '12.5 oz Utz Rip Chip', caseCost: 39.33, quantity: 9 },
    ];
    const out = await svc.matchLineItems(items, catalog, "Jeremy's Snacks", {});
    // Either matched at medium confidence (acceptable fallback) OR unmatched.
    // In both cases it must NOT be high-confidence — that would be dangerous.
    if (out[0].linkedProductId) {
      expect(out[0].confidence).not.toBe('high');
    }
  });

  test('T4 UPC tier fires BEFORE itemCode tier', async () => {
    const items = [
      { itemCode: '115583', upc: '049000028904', description: '12ZCAN12FP COKE', caseCost: 62.80, quantity: 4 },
    ];
    const out = await svc.matchLineItems(items, catalog, 'Coca-Cola Beverages', { vendorId: 3 });
    expect(out[0].linkedProductId).toBe('301');
    expect(out[0].matchTier).toBe('upc');
  });

  test('T5 PLU tier fires for produce codes regardless of vendor', async () => {
    const items = [
      { plu: '4011', description: 'BANANAS ORG', quantity: 25 },
    ];
    const out = await svc.matchLineItems(items, catalog, 'Farm Co', {});
    expect(out[0].linkedProductId).toBe('701');
    expect(out[0].matchTier).toBe('plu');
    expect(out[0].confidence).toBe('high');
  });

  test('T6 Internal SKU must NOT be used for matching', async () => {
    // If the invoice accidentally carries our internal SKU as the itemCode,
    // it must NOT match — vendor invoices never reference our internal SKU.
    const items = [
      { itemCode: 'INT-POLAR-CC', description: 'Random desc with nothing in common', quantity: 1 },
    ];
    const out = await svc.matchLineItems(items, catalog, 'Hershey Creamery Co', { vendorId: 1 });
    expect(out[0].matchTier).not.toBe('sku');
    // If it matched via some other tier, that's fine, but it must NOT be 'sku'.
  });

  test('T7 results expose matchStats for reporting', async () => {
    const items = [
      { itemCode: '2468231280', description: 'POLAR CHOC CHIP', caseCost: 55.86, quantity: 1 },
      { itemCode: 'UNKNOWN',     description: 'MYSTERY ITEM',    caseCost: 10.00, quantity: 1 },
    ];
    const out = await svc.matchLineItems(items, catalog, 'Hershey Creamery Co', { vendorId: 1 });
    expect(out._matchStats).toBeDefined();
    expect(out._matchStats.total).toBe(2);
    expect(out._matchStats.matched).toBeGreaterThanOrEqual(1);
  });
});
