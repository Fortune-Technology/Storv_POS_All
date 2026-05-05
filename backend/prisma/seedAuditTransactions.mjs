/**
 * Audit Store Seed — Stage 2 (Transactions)
 *
 * Seeds 5 days of transactions with known totals, plus lottery activity,
 * fuel sales, cash drops/payouts, and vendor payments. Emits
 * `audit-expected.json` with the ground-truth totals every report should
 * reflect for this store.
 *
 * Data design:
 *   • 5 days: Day -4 (oldest) → Day 0 (today)
 *   • Day -1 has overlapping shifts (Alice morning, Bob afternoon, 30-min
 *     handover overlap) for multi-cashier per-shift accountability tests
 *   • Day -2 deliberately rings up FEWER lottery $ at register than the
 *     ticket-math snapshot reports — tests "unreported lottery" detection
 *   • Other days have 1 cashier + 1 shift with simple totals
 *
 * Run after: prisma/seedAuditStore.mjs
 * Reads:     audit-fixtures.json (created by Stage 1)
 * Writes:    audit-expected.json
 */
import { PrismaClient, Prisma } from '@prisma/client';
import fs from 'node:fs';

const p = new PrismaClient();

// ── Read Stage 1 fixtures ──────────────────────────────────────────────
const F = JSON.parse(fs.readFileSync('audit-fixtures.json', 'utf8'));
console.log('=== AUDIT STORE SEED — STAGE 2 (TRANSACTIONS) ===\n');
console.log(`Org:   ${F.orgId}`);
console.log(`Store: ${F.storeId}\n`);

// ── Wipe Stage 2 data only (transactions, shifts, lottery activity, fuel
//    transactions, cash drops/payouts, vendor payments). Stage 1 fixtures
//    untouched so we can re-run Stage 2 quickly. ───────────────────────
console.log('Wiping prior Stage 2 data...');
const prevShiftIds = (await p.shift.findMany({ where: { orgId: F.orgId }, select: { id: true } })).map(s => s.id);
await p.fuelTransaction.deleteMany({ where: { orgId: F.orgId } });
await p.lotteryTransaction.deleteMany({ where: { orgId: F.orgId } });
await p.lotteryScanEvent.deleteMany({ where: { orgId: F.orgId } });
await p.lotteryShiftReport.deleteMany({ where: { orgId: F.orgId } });
await p.lotteryOnlineTotal.deleteMany({ where: { orgId: F.orgId } });
if (prevShiftIds.length) {
  await p.cashDrop.deleteMany({ where: { shiftId: { in: prevShiftIds } } });
  await p.cashPayout.deleteMany({ where: { shiftId: { in: prevShiftIds } } });
}
await p.shift.deleteMany({ where: { orgId: F.orgId } });
await p.transaction.deleteMany({ where: { orgId: F.orgId } });
await p.vendorPayment.deleteMany({ where: { orgId: F.orgId } });
// Reset lottery box state to the Stage-1 fresh values
await p.lotteryBox.update({ where: { id: F.lottery.box5.id  }, data: { startTicket: '149', currentTicket: '149', ticketsSold: 0, salesAmount: 0, status: 'active' } });
await p.lotteryBox.update({ where: { id: F.lottery.box10.id }, data: { startTicket: '74',  currentTicket: '74',  ticketsSold: 0, salesAmount: 0, status: 'active' } });
// Reset fuel delivery item remaining to 5000
const fuelItems = await p.fuelDeliveryItem.findMany({ where: { delivery: { orgId: F.orgId } } });
for (const fi of fuelItems) {
  await p.fuelDeliveryItem.update({ where: { id: fi.id }, data: { remainingGallons: fi.gallonsReceived, fullyConsumedAt: null } });
}
console.log('Wiped. Stage 1 fixtures preserved.\n');

// ── Helpers ────────────────────────────────────────────────────────────
const dayStart = (offset) => {
  // Returns midnight (local-time approx) for `today + offset days`
  // We use UTC math for predictability, then add 9h to land at "9am"
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};
const at = (offset, hour, minute = 0) => {
  const d = dayStart(offset);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

// ── Expected totals tracker ────────────────────────────────────────────
const expected = {
  storeId: F.storeId,
  orgId: F.orgId,
  generatedAt: new Date().toISOString(),
  byDay: {},          // 'YYYY-MM-DD' → { gross, net, tax, deposits, ebt, txCount, refundCount, voidCount, cashCollected }
  byShift: [],        // [{ shiftId, cashierId, openedAt, closedAt, gross, net, cashSales, cashRefunds, cashDrops, cashPayouts, expectedDrawer, openingFloat, closingFloat }]
  byDept: {},         // 'GROC'/'BEV'/'TOBAC' → { netSales, txCount, lineCount }
  byCashier: {},      // userId → { netSales, txCount, refundCount }
  byProduct: {},      // productKey → { unitsSold, revenue, refundUnits }
  byProductByDay: {}, // 'YYYY-MM-DD' → { productKey: { units, revenue } } (S65 T1 — for product-movement audit)
  lottery: {
    byDay: {},        // 'YYYY-MM-DD' → { instantSales, payouts, ticketsSold, posRecorded }
    snapshotTrail: [],// list of close_day_snapshot events (boxId, currentTicket, date)
    onlineTotals: [], // [{ date, instantCashing, machineSales, machineCashing }]
    commission: 0,    // total commission expected (= netSales × 0.05)
  },
  fuel: {
    byDay: {},        // 'YYYY-MM-DD' → { gallons, revenue, cogs, profit }
    totalGallonsSold: 0,
    totalRevenue: 0,
    totalCOGS: 0,
  },
  cashMovements: {
    drops: [],        // [{ shiftId, amount, note, createdAt }]
    payouts: [],      // [{ shiftId, amount, recipient, createdAt }]
    vendorPayments: [], // [{ amount, vendor, tenderMethod, paymentDate }]
  },
};

const dateKey = (d) => {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
};

// ── Build a transaction with explicit math ────────────────────────────
let txCounter = 1;
function buildTx({ items, tender = 'cash', cashierId, stationId, shiftId, createdAt, dayOffset, refundOf = null, void: isVoid = false }) {
  // items: [{ productKey, qty }]
  // Each product: lookup price, compute lineTotal = price * qty
  const lineItems = items.map((i, idx) => {
    const prod = F.products[i.productKey];
    if (!prod) throw new Error(`Unknown product: ${i.productKey}`);
    const dept = Object.entries(F.departments).find(([k, did]) => did === prod.deptId)[0];
    const lineTotal = round2(prod.retail * i.qty);
    // Tax rate: 5% for grocery/beverages, 8.875% for tobacco/alcohol, 0 for none
    let taxRate = 0;
    let taxClass = 'none';
    if (['grocery', 'beverages'].includes(dept)) { taxRate = 0.05; taxClass = 'grocery'; }
    else if (['tobacco', 'alcohol'].includes(dept)) { taxRate = 0.08875; taxClass = dept; }
    return {
      lineId: `tx${txCounter}-l${idx}`,
      productId: String(prod.id),
      productKey: i.productKey,                  // for audit tracking
      departmentKey: dept,                       // for audit tracking
      // Match production cashier-app — line items carry the FK to the
      // Department row + its name. Without these the per-dept report falls
      // back to li.taxClass which collapses Beverages → Grocery.
      departmentId: prod.deptId,
      departmentName: dept.charAt(0).toUpperCase() + dept.slice(1),
      name: i.productKey,
      upc: prod.upc,
      qty: i.qty,
      unitPrice: prod.retail,
      effectivePrice: prod.retail,
      lineTotal,
      taxable: taxRate > 0,
      taxClass,
      taxRate,
      ebtEligible: prod.ebt,
      depositAmount: 0,    // computed below per-line
      discountEligible: true,
    };
  });

  // Apply deposit per-line (containers)
  for (const li of lineItems) {
    const prod = F.products[li.productKey];
    // Containers from beverages + alcohol have deposits
    if (li.departmentKey === 'beverages' || li.departmentKey === 'alcohol') {
      // 12oz can = $0.05; 32oz bottle = $0.10
      // Reading from product.upc isn't direct — use product key
      if (li.productKey.endsWith('12')) li.depositAmount = 0.05;
      else if (li.productKey === 'water32') li.depositAmount = 0.10;
    }
  }

  const subtotal = round2(lineItems.reduce((s, l) => s + l.lineTotal, 0));
  const taxTotal = round2(lineItems.reduce((s, l) => s + (l.taxable ? l.lineTotal * l.taxRate : 0), 0));
  const depositTotal = round2(lineItems.reduce((s, l) => s + (l.depositAmount * l.qty), 0));
  const ebtTotal = round2(lineItems.reduce((s, l) => s + (l.ebtEligible ? l.lineTotal : 0), 0));
  const grandTotal = round2(subtotal + taxTotal + depositTotal);

  // Tender lines
  let tenderLines;
  let changeGiven = 0;
  if (refundOf) {
    // Refund: tenderLines reflect money going OUT to customer
    tenderLines = [{ method: 'cash', amount: grandTotal, note: 'Refund' }];
  } else if (tender === 'cash') {
    tenderLines = [{ method: 'cash', amount: grandTotal }];
  } else if (tender === 'card') {
    tenderLines = [{ method: 'credit_card', amount: grandTotal }];
  } else if (tender === 'ebt') {
    tenderLines = [{ method: 'ebt_food', amount: ebtTotal }];
    if (grandTotal > ebtTotal) tenderLines.push({ method: 'cash', amount: round2(grandTotal - ebtTotal) });
  } else if (tender === 'mixed') {
    // Half cash, half card
    const cashPart = round2(grandTotal / 2);
    tenderLines = [
      { method: 'cash', amount: cashPart },
      { method: 'credit_card', amount: round2(grandTotal - cashPart) },
    ];
  }

  const txNumber = `TXN-AUDIT-${String(txCounter).padStart(6, '0')}`;
  txCounter++;

  // For refunds: subtotal/taxTotal/grandTotal are negative
  const sign = refundOf ? -1 : 1;
  const status = isVoid ? 'voided' : (refundOf ? 'refund' : 'complete');

  return {
    insert: {
      orgId: F.orgId,
      storeId: F.storeId,
      cashierId,
      stationId,
      shiftId,
      txNumber,
      status,
      lineItems: refundOf ? lineItems.map(li => ({ ...li, lineTotal: -Math.abs(li.lineTotal) })) : lineItems,
      subtotal: round4(sign * subtotal),
      taxTotal: round4(sign * taxTotal),
      depositTotal: round4(sign * depositTotal),
      ebtTotal: refundOf ? 0 : round4(ebtTotal),
      grandTotal: round4(sign * grandTotal),
      tenderLines,
      changeGiven: round4(changeGiven),
      refundOf,
      voidedAt: isVoid ? createdAt : null,
      createdAt,
      syncedAt: createdAt,
      pricingModel: 'interchange',
    },
    audit: {
      txNumber,
      dayOffset,
      gross: sign * grandTotal,
      net: sign * subtotal,
      tax: sign * taxTotal,
      deposit: sign * depositTotal,
      ebt: refundOf ? 0 : ebtTotal,
      tender,
      status,
      cashierId,
      lineItems,
      sign,
    },
  };
}

// ── Generate transactions across 5 days ────────────────────────────────
const { cashierAlice, cashierBob, station1, station2 } = F;

console.log('Generating transactions...\n');

// Helper: open a shift, return { id, openingFloat }
//
// B4 (Session 62) — also writes a `shift_boundary` LotteryScanEvent for each
// active box at this exact moment, mimicking what the prod openShift handler
// does. `boxStateAtOpen` is an object keyed by box-key with the currentTicket
// values to capture (caller knows the state at this moment).
async function openShift({ cashierId, stationId, openedAt, openingFloat = 200, boxStateAtOpen = null, shiftLabel = null }) {
  const shift = await p.shift.create({
    data: {
      orgId: F.orgId,
      storeId: F.storeId,
      cashierId,
      stationId,
      status: 'open',
      openedAt,
      openingAmount: openingFloat,
    },
  });

  if (boxStateAtOpen) {
    for (const [boxKey, currentTicket] of Object.entries(boxStateAtOpen)) {
      const boxId = F.lottery[boxKey].id;
      await p.lotteryScanEvent.create({
        data: {
          orgId: F.orgId, storeId: F.storeId, boxId,
          scannedBy: cashierId,
          raw: `shift_open:${shift.id}:audit-seed`,
          parsed: { currentTicket: String(currentTicket), shiftId: shift.id, source: 'auto-on-open' },
          action: 'shift_boundary',
          context: 'shift',
          createdAt: openedAt,
        },
      });
    }
  }

  return { id: shift.id, openingFloat, cashierId, stationId, openedAt, label: shiftLabel };
}

// Helper: close a shift with computed expected drawer
//
// B4 — also writes a `close_day_snapshot` LotteryScanEvent for each active
// box at the close instant, mimicking what the prod closeShift handler does.
async function closeShift(shift, closedAt, txList, cashDrops, cashPayouts, boxStateAtClose = null) {
  if (boxStateAtClose) {
    for (const [boxKey, currentTicket] of Object.entries(boxStateAtClose)) {
      const boxId = F.lottery[boxKey].id;
      await p.lotteryScanEvent.create({
        data: {
          orgId: F.orgId, storeId: F.storeId, boxId,
          scannedBy: shift.cashierId,
          raw: `shift_close:${shift.id}:audit-seed`,
          parsed: { currentTicket: String(currentTicket), shiftId: shift.id, source: 'auto-on-close' },
          action: 'close_day_snapshot',
          context: 'shift',
          createdAt: closedAt,
        },
      });
    }
  }
  // Cash sales = sum of positive transactions paid in cash (or cash portion of mixed)
  // Cash refunds = sum of refund transactions paid in cash
  let cashSales = 0;
  let cashRefunds = 0;
  for (const tx of txList) {
    for (const tl of tx.audit.lineItems ? tx.insert.tenderLines : []) {
      if (tl.method !== 'cash') continue;
      if (tx.audit.status === 'refund') cashRefunds += tl.amount;
      else if (tx.audit.status === 'complete') cashSales += tl.amount;
    }
  }
  const cashDropsTotal = cashDrops.reduce((s, d) => s + d.amount, 0);
  const cashPayoutsTotal = cashPayouts.reduce((s, d) => s + d.amount, 0);
  const expectedAmount = round4(shift.openingFloat + cashSales - cashRefunds - cashDropsTotal - cashPayoutsTotal);
  const closingAmount = expectedAmount; // perfect drawer for audit purposes

  await p.shift.update({
    where: { id: shift.id },
    data: {
      status: 'closed',
      closedAt,
      closedById: shift.cashierId,
      closingAmount,
      expectedAmount,
      variance: 0,
      cashSales: round4(cashSales),
      cashRefunds: round4(cashRefunds),
      cashDropsTotal: round4(cashDropsTotal),
      payoutsTotal: round4(cashPayoutsTotal),
    },
  });

  expected.byShift.push({
    shiftId: shift.id,
    cashierId: shift.cashierId,
    openedAt: shift.openedAt.toISOString(),
    closedAt: closedAt.toISOString(),
    openingFloat: shift.openingFloat,
    cashSales: round2(cashSales),
    cashRefunds: round2(cashRefunds),
    cashDropsTotal: round2(cashDropsTotal),
    cashPayoutsTotal: round2(cashPayoutsTotal),
    expectedDrawer: round2(expectedAmount),
    closingFloat: round2(closingAmount),
  });
}

// Save tx list helper — also populates expected totals
async function saveTx(tx) {
  await p.transaction.create({ data: tx.insert });

  const dKey = dateKey(new Date(tx.insert.createdAt));
  if (!expected.byDay[dKey]) {
    expected.byDay[dKey] = {
      gross: 0, net: 0, tax: 0, deposits: 0, ebt: 0,
      txCount: 0, refundCount: 0, voidCount: 0,
    };
  }
  const D = expected.byDay[dKey];
  if (tx.audit.status === 'complete') {
    D.gross += tx.audit.gross;
    D.net += tx.audit.net;
    D.tax += tx.audit.tax;
    D.deposits += tx.audit.deposit;
    D.ebt += tx.audit.ebt;
    D.txCount += 1;
  } else if (tx.audit.status === 'refund') {
    D.gross += tx.audit.gross;     // negative
    D.net += tx.audit.net;
    D.tax += tx.audit.tax;
    D.deposits += tx.audit.deposit;
    D.refundCount += 1;
  } else if (tx.audit.status === 'voided') {
    D.voidCount += 1;
  }

  // Per-dept — completes ADD, refunds SUBTRACT (matches controller behavior:
  // "Net Sales" = revenue after refunds reversed). Voids contribute 0 (excluded).
  if (tx.audit.status === 'complete' || tx.audit.status === 'refund') {
    const sign = tx.audit.status === 'refund' ? -1 : 1;
    for (const li of tx.audit.lineItems) {
      const k = li.departmentKey.toUpperCase();
      if (!expected.byDept[k]) expected.byDept[k] = { netSales: 0, txCount: 0, lineCount: 0 };
      expected.byDept[k].netSales += sign * li.lineTotal;
      expected.byDept[k].lineCount += 1;
    }
  }

  // Per-cashier
  const cKey = tx.audit.cashierId;
  if (!expected.byCashier[cKey]) expected.byCashier[cKey] = { netSales: 0, txCount: 0, refundCount: 0 };
  if (tx.audit.status === 'complete') {
    expected.byCashier[cKey].netSales += tx.audit.net;
    expected.byCashier[cKey].txCount += 1;
  } else if (tx.audit.status === 'refund') {
    expected.byCashier[cKey].refundCount += 1;
  }

  // Per-product (completes ADD, refunds SUBTRACT).
  // S65 T1: matches the refund sign convention used by the 3 controllers
  // that report per-product totals — getProductsGrouped, getProductMovement,
  // getProduct52WeekStats. Voids contribute nothing.
  if (tx.audit.status === 'complete' || tx.audit.status === 'refund') {
    const sign = tx.audit.status === 'refund' ? -1 : 1;
    for (const li of tx.audit.lineItems) {
      const k = li.productKey;
      if (!expected.byProduct[k]) expected.byProduct[k] = { unitsSold: 0, revenue: 0 };
      expected.byProduct[k].unitsSold += sign * Math.abs(li.qty);
      expected.byProduct[k].revenue   += sign * Math.abs(li.lineTotal);

      // Per-product per-day (S65 T1 — for product-movement audit)
      if (!expected.byProductByDay[dKey]) expected.byProductByDay[dKey] = {};
      if (!expected.byProductByDay[dKey][k]) expected.byProductByDay[dKey][k] = { units: 0, revenue: 0 };
      expected.byProductByDay[dKey][k].units   += sign * Math.abs(li.qty);
      expected.byProductByDay[dKey][k].revenue += sign * Math.abs(li.lineTotal);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// DAY -4
// Single shift, Alice all day. Simple mix.
// ─────────────────────────────────────────────────────────────────────
{
  const shift = await openShift({
    cashierId: cashierAlice, stationId: station1,
    openedAt: at(-4, 9, 0), openingFloat: 200,
  });
  const txs = [];
  // Tx 1: 2 bread + 1 milk + 2 coke12 (taxable, EBT eligible, cash)
  let tx = buildTx({
    items: [{ productKey: 'bread', qty: 2 }, { productKey: 'milk', qty: 1 }, { productKey: 'coke12', qty: 2 }],
    tender: 'cash', cashierId: cashierAlice, stationId: station1, shiftId: shift.id,
    createdAt: at(-4, 9, 30), dayOffset: -4,
  });
  await saveTx(tx); txs.push(tx);
  // Tx 2: 1 marlboro (tobacco, age, card)
  tx = buildTx({
    items: [{ productKey: 'marlboro', qty: 1 }],
    tender: 'card', cashierId: cashierAlice, stationId: station1, shiftId: shift.id,
    createdAt: at(-4, 11, 15), dayOffset: -4,
  });
  await saveTx(tx); txs.push(tx);
  // Tx 3: 3 budlight (alcohol + deposit, age, mixed)
  tx = buildTx({
    items: [{ productKey: 'budlight', qty: 3 }],
    tender: 'mixed', cashierId: cashierAlice, stationId: station1, shiftId: shift.id,
    createdAt: at(-4, 14, 0), dayOffset: -4,
  });
  await saveTx(tx); txs.push(tx);
  // Tx 4: 1 eggs + 1 apples (EBT)
  tx = buildTx({
    items: [{ productKey: 'eggs', qty: 1 }, { productKey: 'apples', qty: 2 }],
    tender: 'ebt', cashierId: cashierAlice, stationId: station1, shiftId: shift.id,
    createdAt: at(-4, 16, 0), dayOffset: -4,
  });
  await saveTx(tx); txs.push(tx);

  await closeShift(shift, at(-4, 17, 0), txs, [], []);
  console.log(`Day -4: 1 shift (Alice), ${txs.length} transactions`);
}

// ─────────────────────────────────────────────────────────────────────
// DAY -3
// Single shift, Bob all day. Includes 1 refund.
// ─────────────────────────────────────────────────────────────────────
{
  const shift = await openShift({
    cashierId: cashierBob, stationId: station1,
    openedAt: at(-3, 9, 0), openingFloat: 200,
  });
  const txs = [];
  // Tx 1
  let tx = buildTx({
    items: [{ productKey: 'bread', qty: 1 }, { productKey: 'pepsi12', qty: 4 }],
    tender: 'cash', cashierId: cashierBob, stationId: station1, shiftId: shift.id,
    createdAt: at(-3, 10, 0), dayOffset: -3,
  });
  await saveTx(tx); txs.push(tx);
  const txToRefund = tx; // we'll refund this one later

  // Tx 2
  tx = buildTx({
    items: [{ productKey: 'marlboro', qty: 2 }],
    tender: 'card', cashierId: cashierBob, stationId: station1, shiftId: shift.id,
    createdAt: at(-3, 12, 0), dayOffset: -3,
  });
  await saveTx(tx); txs.push(tx);

  // Tx 3 — refund of tx 1 (full)
  tx = buildTx({
    items: [{ productKey: 'bread', qty: 1 }, { productKey: 'pepsi12', qty: 4 }],
    tender: 'cash', cashierId: cashierBob, stationId: station1, shiftId: shift.id,
    createdAt: at(-3, 13, 0), dayOffset: -3,
    refundOf: txToRefund.insert.txNumber,
  });
  await saveTx(tx); txs.push(tx);

  // Tx 4
  tx = buildTx({
    items: [{ productKey: 'water32', qty: 2 }, { productKey: 'milk', qty: 1 }],
    tender: 'cash', cashierId: cashierBob, stationId: station1, shiftId: shift.id,
    createdAt: at(-3, 15, 30), dayOffset: -3,
  });
  await saveTx(tx); txs.push(tx);

  await closeShift(shift, at(-3, 17, 0), txs, [], []);
  console.log(`Day -3: 1 shift (Bob), ${txs.length} transactions (1 refund)`);
}

// ─────────────────────────────────────────────────────────────────────
// DAY -2
// Single shift, Alice. Includes a void + cash drop.
// ─────────────────────────────────────────────────────────────────────
{
  const shift = await openShift({
    cashierId: cashierAlice, stationId: station1,
    openedAt: at(-2, 8, 0), openingFloat: 200,
  });
  const txs = [];
  let tx = buildTx({
    items: [{ productKey: 'eggs', qty: 2 }, { productKey: 'milk', qty: 2 }],
    tender: 'card', cashierId: cashierAlice, stationId: station1, shiftId: shift.id,
    createdAt: at(-2, 9, 30), dayOffset: -2,
  });
  await saveTx(tx); txs.push(tx);

  // Tx that gets voided
  tx = buildTx({
    items: [{ productKey: 'budlight', qty: 6 }],
    tender: 'cash', cashierId: cashierAlice, stationId: station1, shiftId: shift.id,
    createdAt: at(-2, 11, 0), dayOffset: -2,
  });
  // Void it: change status to 'voided'
  tx.insert.status = 'voided';
  tx.insert.voidedAt = at(-2, 11, 5);
  tx.insert.voidedById = cashierAlice;
  tx.audit.status = 'voided';
  await saveTx(tx); txs.push(tx);

  tx = buildTx({
    items: [{ productKey: 'apples', qty: 3 }, { productKey: 'bread', qty: 2 }, { productKey: 'coke12', qty: 6 }],
    tender: 'cash', cashierId: cashierAlice, stationId: station1, shiftId: shift.id,
    createdAt: at(-2, 14, 0), dayOffset: -2,
  });
  await saveTx(tx); txs.push(tx);

  // Cash drop $100 mid-shift
  const drop = await p.cashDrop.create({
    data: {
      orgId: F.orgId, shiftId: shift.id, amount: 100, note: 'Mid-shift safe drop',
      createdById: cashierAlice, createdAt: at(-2, 13, 0),
    },
  });
  expected.cashMovements.drops.push({ shiftId: shift.id, amount: 100, note: 'Mid-shift safe drop', createdAt: at(-2, 13, 0).toISOString() });

  await closeShift(shift, at(-2, 17, 0), txs, [{ amount: 100 }], []);
  console.log(`Day -2: 1 shift (Alice), ${txs.length} transactions (1 void), 1 cash drop $100`);
}

// ─────────────────────────────────────────────────────────────────────
// DAY -1
// TWO shifts (Alice morning, Bob afternoon, 30-min handover overlap)
// ─────────────────────────────────────────────────────────────────────
{
  // B4 — Day -1 split lottery $40 across Alice + Bob with shift boundary
  // events. Day -1 totals: 6×$5 + 1×$10 = $40.
  //   Alice (7am-3pm): sells 2×$5 = $10 → box5: 128→126, box10: 69 unchanged
  //   Bob (2:30pm-11pm): sells 4×$5 + 1×$10 = $30 → box5: 126→122, box10: 69→68
  // Box state at start of Day -1 = end of Day -2 (per lotteryDays table):
  //   box5End=128, box10End=69
  //
  // Alice shift: 7am-3pm
  const aliceShift = await openShift({
    cashierId: cashierAlice, stationId: station1,
    openedAt: at(-1, 7, 0), openingFloat: 200,
    boxStateAtOpen: { box5: 128, box10: 69 }, // start-of-day
    shiftLabel: 'alice-day-1',
  });
  const aliceTxs = [];
  let tx;

  tx = buildTx({
    items: [{ productKey: 'bread', qty: 3 }, { productKey: 'milk', qty: 2 }, { productKey: 'eggs', qty: 1 }],
    tender: 'ebt', cashierId: cashierAlice, stationId: station1, shiftId: aliceShift.id,
    createdAt: at(-1, 8, 30), dayOffset: -1,
  });
  await saveTx(tx); aliceTxs.push(tx);

  tx = buildTx({
    items: [{ productKey: 'marlboro', qty: 1 }, { productKey: 'coke12', qty: 2 }],
    tender: 'cash', cashierId: cashierAlice, stationId: station1, shiftId: aliceShift.id,
    createdAt: at(-1, 10, 0), dayOffset: -1,
  });
  await saveTx(tx); aliceTxs.push(tx);

  tx = buildTx({
    items: [{ productKey: 'water32', qty: 4 }],
    tender: 'card', cashierId: cashierAlice, stationId: station1, shiftId: aliceShift.id,
    createdAt: at(-1, 13, 0), dayOffset: -1,
  });
  await saveTx(tx); aliceTxs.push(tx);

  // Bob shift: 2:30pm - 11pm (overlaps Alice 2:30-3:00)
  // At Bob's open, Alice has already sold her 2×$5 → box5=126, box10=69
  const bobShift = await openShift({
    cashierId: cashierBob, stationId: station2,
    openedAt: at(-1, 14, 30), openingFloat: 200,
    boxStateAtOpen: { box5: 126, box10: 69 }, // Alice's morning sales applied
    shiftLabel: 'bob-day-1',
  });
  const bobTxs = [];

  // 2:45pm — during overlap, on station 2 (Bob)
  tx = buildTx({
    items: [{ productKey: 'pepsi12', qty: 2 }, { productKey: 'apples', qty: 2 }],
    tender: 'cash', cashierId: cashierBob, stationId: station2, shiftId: bobShift.id,
    createdAt: at(-1, 14, 45), dayOffset: -1,
  });
  await saveTx(tx); bobTxs.push(tx);

  // Alice closes at 3pm — she sold 2×$5 lottery during her shift
  await closeShift(aliceShift, at(-1, 15, 0), aliceTxs, [], [], {
    box5: 126, box10: 69, // her ending position = post-morning-sales
  });

  // Bob continues
  tx = buildTx({
    items: [{ productKey: 'budlight', qty: 6 }, { productKey: 'marlboro', qty: 1 }],
    tender: 'card', cashierId: cashierBob, stationId: station2, shiftId: bobShift.id,
    createdAt: at(-1, 16, 30), dayOffset: -1,
  });
  await saveTx(tx); bobTxs.push(tx);

  tx = buildTx({
    items: [{ productKey: 'milk', qty: 1 }, { productKey: 'bread', qty: 1 }, { productKey: 'eggs', qty: 1 }],
    tender: 'mixed', cashierId: cashierBob, stationId: station2, shiftId: bobShift.id,
    createdAt: at(-1, 19, 0), dayOffset: -1,
  });
  await saveTx(tx); bobTxs.push(tx);

  // Cash payout $40 (cash to a vendor)
  await p.cashPayout.create({
    data: {
      orgId: F.orgId, shiftId: bobShift.id, amount: 40,
      recipient: 'Audit Bread Vendor', payoutType: 'merchandise',
      note: 'Cash payment to bread vendor',
      createdById: cashierBob, createdAt: at(-1, 18, 0),
    },
  });
  expected.cashMovements.payouts.push({ shiftId: bobShift.id, amount: 40, recipient: 'Audit Bread Vendor', createdAt: at(-1, 18, 0).toISOString() });

  // ── B9 follow-up — late-evening tx at 22:30 local. Crosses UTC midnight
  // in EDT (22:30 EDT = 02:30 UTC next day). Tests that /sales/daily and
  // EoD bucket this tx under the LOCAL day (Day -1), not the UTC day.
  // Without the Session 60 tz-aware bucketing, this tx would silently land
  // in next-day's totals on a UTC-tz server.
  tx = buildTx({
    items: [{ productKey: 'marlboro', qty: 1 }, { productKey: 'budlight', qty: 2 }],
    tender: 'cash', cashierId: cashierBob, stationId: station2, shiftId: bobShift.id,
    createdAt: at(-1, 22, 30), dayOffset: -1,
  });
  await saveTx(tx); bobTxs.push(tx);

  // Bob closes at 11pm — Bob sold 4×$5 + 1×$10 during his shift = $30
  await closeShift(bobShift, at(-1, 23, 0), bobTxs, [], [{ amount: 40 }], {
    box5: 122, box10: 68, // matches existing 22:00 EoD snapshot from lotteryDays
  });

  // B4 — track per-shift expected lottery sales for audit verification
  expected.lottery.byShift = expected.lottery.byShift || {};
  expected.lottery.byShift[aliceShift.id] = {
    cashierId: cashierAlice,
    label: 'alice-day-1',
    instantSales: 10, // 2×$5 box5 morning sales
    openedAt: at(-1, 7, 0).toISOString(),
    closedAt: at(-1, 15, 0).toISOString(),
  };
  expected.lottery.byShift[bobShift.id] = {
    cashierId: cashierBob,
    label: 'bob-day-1',
    instantSales: 30, // 4×$5 box5 + 1×$10 box10
    openedAt: at(-1, 14, 30).toISOString(),
    closedAt: at(-1, 23, 0).toISOString(),
  };

  console.log(`Day -1: 2 shifts (Alice 7am-3pm $10 lottery, Bob 2:30pm-11pm $30 lottery, 30-min overlap), ${aliceTxs.length + bobTxs.length} transactions (1 late-evening 22:30 tx tests UTC-midnight crossing), 1 cash payout`);
}

// ─────────────────────────────────────────────────────────────────────
// DAY 0 (TODAY)
// Single shift, Alice (still open).
// ─────────────────────────────────────────────────────────────────────
{
  const shift = await openShift({
    cashierId: cashierAlice, stationId: station1,
    openedAt: at(0, 9, 0), openingFloat: 200,
  });
  const txs = [];

  let tx = buildTx({
    items: [{ productKey: 'milk', qty: 1 }, { productKey: 'bread', qty: 1 }],
    tender: 'cash', cashierId: cashierAlice, stationId: station1, shiftId: shift.id,
    createdAt: at(0, 9, 30), dayOffset: 0,
  });
  await saveTx(tx); txs.push(tx);

  tx = buildTx({
    items: [{ productKey: 'marlboro', qty: 1 }, { productKey: 'pepsi12', qty: 2 }],
    tender: 'card', cashierId: cashierAlice, stationId: station1, shiftId: shift.id,
    createdAt: at(0, 11, 0), dayOffset: 0,
  });
  await saveTx(tx); txs.push(tx);

  tx = buildTx({
    items: [{ productKey: 'water32', qty: 1 }, { productKey: 'apples', qty: 1 }],
    tender: 'ebt', cashierId: cashierAlice, stationId: station1, shiftId: shift.id,
    createdAt: at(0, 12, 30), dayOffset: 0,
  });
  await saveTx(tx); txs.push(tx);

  // ── S77 (C9) — exercise all 5 cash drawer event types on Day 0 ────────
  // Each one produces a referenceNumber via the new generator and writes
  // through addCashDrop / addPayout (extended endpoints). The audit harness
  // verifies the EoD report buckets these correctly and the drawer math
  // honors the in/out direction per type.

  // Cash Drop $100 — money OUT to safe (legacy default)
  await p.cashDrop.create({
    data: {
      orgId: F.orgId, shiftId: shift.id, amount: 100,
      type: 'drop',
      referenceNumber: `CD-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-001`,
      note: 'Mid-shift safe drop',
      createdById: cashierAlice, createdAt: at(0, 13, 0),
    },
  });

  // Cash In $50 — petty cash refill, money INTO drawer (S77 NEW)
  await p.cashDrop.create({
    data: {
      orgId: F.orgId, shiftId: shift.id, amount: 50,
      type: 'paid_in',
      referenceNumber: `CI-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-001`,
      note: 'Petty cash refill',
      createdById: cashierAlice, createdAt: at(0, 14, 0),
    },
  });

  // Vendor Payout $35 — paid out to a vendor (legacy)
  await p.cashPayout.create({
    data: {
      orgId: F.orgId, shiftId: shift.id, amount: 35,
      payoutType: 'expense', recipient: 'Audit Cleaning Co.',
      referenceNumber: `VP-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-001`,
      note: 'Janitor cash payment',
      createdById: cashierAlice, createdAt: at(0, 15, 0),
    },
  });

  // Loan $20 — cashier cash advance, money OUT (S77 NEW)
  await p.cashPayout.create({
    data: {
      orgId: F.orgId, shiftId: shift.id, amount: 20,
      payoutType: 'loan', recipient: 'Alice Smith — register loan',
      referenceNumber: `LN-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-001`,
      note: 'Cash advance, repay Friday',
      createdById: cashierAlice, createdAt: at(0, 15, 30),
    },
  });

  // Received on Account $75 — charge-account customer pays balance (S77 NEW)
  await p.cashPayout.create({
    data: {
      orgId: F.orgId, shiftId: shift.id, amount: 75,
      payoutType: 'received_on_account', recipient: 'House Customer',
      referenceNumber: `RA-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-001`,
      note: 'House charge payment',
      createdById: cashierAlice, createdAt: at(0, 16, 0),
    },
  });

  // Today's shift stays OPEN — don't close it. Closes at end of business.
  console.log(`Day 0 (today): 1 shift (Alice, still open), ${txs.length} transactions, 5 cash drawer events (drop $100, cash in $50, vendor payout $35, loan $20, received-on-acct $75)`);

  // Track the open shift for expected totals
  let cashSales = 0;
  for (const t of txs) {
    for (const tl of t.insert.tenderLines) {
      if (tl.method === 'cash') cashSales += tl.amount;
    }
  }
  // S77 (C9) drawer math:
  //   expected = opening + cashSales - cashRefunds
  //            + cashIn       (paid_in drops + RA payouts)
  //            - cashOut      (vendor + loan payouts)
  //            - cashDropsTotal (drop-type CashDrop only)
  // Day 0: opening=$200, cashSales=cash sale total,
  //        cashIn = 50 (paid_in) + 75 (RA) = 125,
  //        cashOut = 35 (vendor) + 20 (loan) = 55,
  //        cashDropsTotal = 100 (drop-type)
  const c9CashIn  = 50 + 75;   // paid_in CashDrop + received_on_account CashPayout
  const c9CashOut = 35 + 20;   // expense + loan CashPayouts
  const c9DropsTotal = 100;    // drop-type CashDrop only
  expected.byShift.push({
    shiftId: shift.id,
    cashierId: cashierAlice,
    openedAt: shift.openedAt.toISOString(),
    closedAt: null,
    openingFloat: shift.openingFloat,
    cashSales: round2(cashSales),
    cashRefunds: 0,
    cashDropsTotal: c9DropsTotal,
    cashIn:  c9CashIn,
    cashOut: c9CashOut,
    cashPayoutsTotal: c9CashOut + c9CashIn, // legacy total = sum of all CashPayout amounts
    expectedDrawer: round2(shift.openingFloat + cashSales + c9CashIn - c9CashOut - c9DropsTotal),
    closingFloat: null,
    open: true,
  });

  // S77 (C9) — explicit EoD bucket expectations for the new types. Audit
  // verifies the back-office EoD endpoint returns these counts/amounts.
  expected.cashEventBuckets = {
    pickups:          { count: 1, amount: 100 },
    paid_in:          { count: 1, amount: 50  },
    paid_out:         { count: 1, amount: 35  },
    loans:            { count: 1, amount: 20  },
    received_on_acct: { count: 1, amount: 75  },
  };
}

// ─────────────────────────────────────────────────────────────────────
// LOTTERY ACTIVITY
// Day -7 (boxes already activated). Daily ticket sales + payouts +
// snapshot trail. Day -2 deliberately rings up FEWER $ than tickets sold.
// ─────────────────────────────────────────────────────────────────────
console.log('\nGenerating lottery activity...');

// Helper: write close_day_snapshot LotteryScanEvent for each box at end of day
async function lotterySnapshot({ boxId, currentTicket, dayOffset, scannedBy }) {
  const ts = at(dayOffset, 22, 0);
  await p.lotteryScanEvent.create({
    data: {
      orgId: F.orgId, storeId: F.storeId, boxId,
      scannedBy: scannedBy || cashierAlice,
      raw: `manual:close_day_snapshot:${currentTicket}`,
      parsed: { currentTicket },
      action: 'close_day_snapshot',
      context: 'eod',
      notes: `Stage 2 audit seed snapshot for box ${boxId}`,
      createdAt: ts,
    },
  });
  expected.lottery.snapshotTrail.push({ boxId, currentTicket, day: dateKey(at(dayOffset, 0, 0)) });
}

// Lottery game prices
const TICKET_PRICE_5 = 5;
const TICKET_PRICE_10 = 10;
const COMMISSION_RATE = 0.05;

// Day-by-day: tickets sold = startTicket - currentTicket (descending)
// Track separately for box5 (start=149) and box10 (start=74)
const lotteryDays = [
  // dayOffset, box5End, box5POSAmt, box10End, box10POSAmt, instantPayout, machineSales, machineCashing
  { day: -7, box5End: 149, box10End: 74, posSold: 0,  payout: 0,  machineSales: 0, machineCashing: 0 },
  { day: -6, box5End: 144, box10End: 73, posSold: 35, payout: 0,  machineSales: 50, machineCashing: 20 }, // 5×$5 + 1×$10 = $35
  { day: -5, box5End: 140, box10End: 72, posSold: 30, payout: 10, machineSales: 80, machineCashing: 30 }, // 4×$5 + 1×$10 = $30
  { day: -4, box5End: 137, box10End: 71, posSold: 25, payout: 0,  machineSales: 60, machineCashing: 15 }, // 3×$5 + 1×$10 = $25
  { day: -3, box5End: 132, box10End: 70, posSold: 35, payout: 50, machineSales: 75, machineCashing: 100 }, // 5×$5 + 1×$10 = $35
  { day: -2, box5End: 128, box10End: 69, posSold: 25, payout: 0,  machineSales: 65, machineCashing: 20 }, // ⚠ unreported gap! actual = 4×$5 + 1×$10 = $30, posSold=$25 → unreported=$5
  { day: -1, box5End: 122, box10End: 68, posSold: 40, payout: 20, machineSales: 90, machineCashing: 30 }, // 6×$5 + 1×$10 = $40
  { day:  0, box5End: 120, box10End: 67, posSold: 20, payout: 0,  machineSales: 30, machineCashing: 0  }, // 2×$5 + 1×$10 = $20 (today, no machine cashings yet)
];

// Snapshot for Day -8 (the "yesterday" before our window starts) so Day -7's delta = 0.
// Actually Day -7 is when activatedAt was set, so we use that as the implicit baseline.
// Snapshot at end of each day with the box's currentTicket.

let prevBox5 = 149, prevBox10 = 74;
for (const lot of lotteryDays) {
  // Compute tickets sold this day
  const t5 = prevBox5 - lot.box5End;
  const t10 = prevBox10 - lot.box10End;
  const instantSales = round2(t5 * TICKET_PRICE_5 + t10 * TICKET_PRICE_10);
  const dKey = dateKey(at(lot.day, 0, 0));

  // Snapshot at end of day (or activation moment for Day -7)
  if (lot.day === -7) {
    // Day -7: snapshot is just startTicket (no sales yet)
    await lotterySnapshot({ boxId: F.lottery.box5.id,  currentTicket: '149', dayOffset: -7 });
    await lotterySnapshot({ boxId: F.lottery.box10.id, currentTicket: '74',  dayOffset: -7 });
  } else {
    await lotterySnapshot({ boxId: F.lottery.box5.id,  currentTicket: String(lot.box5End),  dayOffset: lot.day });
    await lotterySnapshot({ boxId: F.lottery.box10.id, currentTicket: String(lot.box10End), dayOffset: lot.day });
  }

  // POS-recorded lottery transactions (these may UNDER-report on Day -2)
  if (lot.posSold > 0) {
    await p.lotteryTransaction.create({
      data: {
        orgId: F.orgId, storeId: F.storeId,
        type: 'sale', amount: lot.posSold,
        gameId: F.lottery.game5.id, // attribute to $5 game (simplification)
        boxId: F.lottery.box5.id,
        cashierId: lot.day < 0 ? cashierAlice : cashierAlice,
        stationId: station1,
        notes: `Audit seed POS-recorded lottery sales for ${dKey}`,
        createdAt: at(lot.day, 12, 0),
      },
    });
  }
  if (lot.payout > 0) {
    await p.lotteryTransaction.create({
      data: {
        orgId: F.orgId, storeId: F.storeId,
        type: 'payout', amount: lot.payout,
        gameId: F.lottery.game5.id,
        cashierId: cashierAlice,
        stationId: station1,
        notes: `Audit seed instant payout for ${dKey}`,
        createdAt: at(lot.day, 13, 0),
      },
    });
  }

  // Online totals (only if any non-zero)
  if (lot.machineSales > 0 || lot.machineCashing > 0) {
    await p.lotteryOnlineTotal.upsert({
      where: { orgId_storeId_date: { orgId: F.orgId, storeId: F.storeId, date: at(lot.day, 0, 0) } },
      update: {
        machineSales: lot.machineSales,
        machineCashing: lot.machineCashing,
        instantCashing: lot.payout,
      },
      create: {
        orgId: F.orgId, storeId: F.storeId, date: at(lot.day, 0, 0),
        machineSales: lot.machineSales,
        machineCashing: lot.machineCashing,
        instantCashing: lot.payout,
      },
    });
    expected.lottery.onlineTotals.push({
      date: dKey,
      machineSales: lot.machineSales,
      machineCashing: lot.machineCashing,
      instantCashing: lot.payout,
    });
  }

  // Track in expected
  expected.lottery.byDay[dKey] = {
    instantSales,                   // ticket-math truth
    posRecorded: lot.posSold,        // what POS rang up
    unreported: round2(Math.max(0, instantSales - lot.posSold)),
    instantPayouts: lot.payout,
    machineSales: lot.machineSales,
    machineCashing: lot.machineCashing,
    ticketsSold: t5 + t10,
  };

  prevBox5 = lot.box5End;
  prevBox10 = lot.box10End;
}

// Update box currentTicket to final values
await p.lotteryBox.update({
  where: { id: F.lottery.box5.id },
  data: { currentTicket: String(prevBox5), ticketsSold: 149 - prevBox5, salesAmount: round2((149 - prevBox5) * 5) },
});
await p.lotteryBox.update({
  where: { id: F.lottery.box10.id },
  data: { currentTicket: String(prevBox10), ticketsSold: 74 - prevBox10, salesAmount: round2((74 - prevBox10) * 10) },
});

// Total commission expected
const totalLotterySales = Object.values(expected.lottery.byDay).reduce((s, d) => s + d.instantSales, 0);
expected.lottery.commission = round2(totalLotterySales * COMMISSION_RATE);
console.log(`Lottery: 8 days of activity, total ticket-math sales = $${totalLotterySales.toFixed(2)}, expected commission = $${expected.lottery.commission.toFixed(2)}`);

// ─────────────────────────────────────────────────────────────────────
// FUEL TRANSACTIONS
// Spread across days. Each consumes from FIFO layer at $3.20 cost.
// Sells at $3.999/gal.
// ─────────────────────────────────────────────────────────────────────
console.log('\nGenerating fuel transactions...');

const fuelDays = [
  { day: -4, gallons: 12.501, station: station1, cashier: cashierAlice },
  { day: -3, gallons: 8.752,  station: station1, cashier: cashierBob },
  { day: -2, gallons: 15.003, station: station1, cashier: cashierAlice },
  { day: -1, gallons: 10.000, station: station2, cashier: cashierBob },
  { day:  0, gallons: 6.250,  station: station1, cashier: cashierAlice },
];

const FUEL_PRICE = 3.999;
const FUEL_COST = 3.20;
let fuelLayerRemaining = 5000;
const fuelDeliveryItem = await p.fuelDeliveryItem.findFirst({ where: { delivery: { orgId: F.orgId } } });

for (const fd of fuelDays) {
  const amount = round2(fd.gallons * FUEL_PRICE);
  const cogs   = round2(fd.gallons * FUEL_COST);
  const profit = round2(amount - cogs);
  fuelLayerRemaining -= fd.gallons;

  await p.fuelTransaction.create({
    data: {
      orgId: F.orgId, storeId: F.storeId,
      cashierId: fd.cashier, stationId: fd.station,
      type: 'sale',
      fuelTypeId: F.fuel.typeReg.id,
      fuelTypeName: 'Regular',
      gallons: fd.gallons,
      pricePerGallon: FUEL_PRICE,
      amount,
      entryMode: 'gallons',
      tankId: F.fuel.tankA.id,
      fifoLayers: [{ deliveryItemId: fuelDeliveryItem.id, gallons: fd.gallons, pricePerGallon: FUEL_COST, cost: cogs }],
      createdAt: at(fd.day, 11, 30),
    },
  });

  const dKey = dateKey(at(fd.day, 0, 0));
  if (!expected.fuel.byDay[dKey]) expected.fuel.byDay[dKey] = { gallons: 0, revenue: 0, cogs: 0, profit: 0 };
  expected.fuel.byDay[dKey].gallons = round4(expected.fuel.byDay[dKey].gallons + fd.gallons);
  expected.fuel.byDay[dKey].revenue = round2(expected.fuel.byDay[dKey].revenue + amount);
  expected.fuel.byDay[dKey].cogs    = round2(expected.fuel.byDay[dKey].cogs + cogs);
  expected.fuel.byDay[dKey].profit  = round2(expected.fuel.byDay[dKey].profit + profit);

  expected.fuel.totalGallonsSold = round4(expected.fuel.totalGallonsSold + fd.gallons);
  expected.fuel.totalRevenue     = round2(expected.fuel.totalRevenue + amount);
  expected.fuel.totalCOGS        = round2(expected.fuel.totalCOGS + cogs);
}

// Decrement FIFO layer's remaining
await p.fuelDeliveryItem.update({
  where: { id: fuelDeliveryItem.id },
  data: { remainingGallons: round4(fuelLayerRemaining) },
});
console.log(`Fuel: 5 sales, ${expected.fuel.totalGallonsSold} gal total, $${expected.fuel.totalRevenue} revenue, $${expected.fuel.totalCOGS} COGS, $${round2(expected.fuel.totalRevenue - expected.fuel.totalCOGS)} profit`);

// ─────────────────────────────────────────────────────────────────────
// VENDOR PAYMENT
// 1 cash payment, 1 cheque payment, both today.
// Cash one should reduce drawer expectation for any report that
// reconciles VendorPayment vs CashPayout.
// ─────────────────────────────────────────────────────────────────────
console.log('\nGenerating vendor payments...');

await p.vendorPayment.create({
  data: {
    orgId: F.orgId, storeId: F.storeId,
    vendorName: 'Audit Bread Vendor',
    amount: 60,
    paymentType: 'merchandise',
    tenderMethod: 'cash',
    notes: 'Audit seed cash vendor payment',
    paymentDate: at(0, 14, 0),
    createdById: cashierAlice,
  },
});
expected.cashMovements.vendorPayments.push({
  amount: 60, vendor: 'Audit Bread Vendor', tenderMethod: 'cash', paymentDate: at(0, 14, 0).toISOString(),
});

await p.vendorPayment.create({
  data: {
    orgId: F.orgId, storeId: F.storeId,
    vendorName: 'Audit Beverage Distributor',
    amount: 250,
    paymentType: 'merchandise',
    tenderMethod: 'cheque',
    notes: 'Audit seed cheque vendor payment',
    paymentDate: at(0, 15, 0),
    createdById: cashierAlice,
  },
});
expected.cashMovements.vendorPayments.push({
  amount: 250, vendor: 'Audit Beverage Distributor', tenderMethod: 'cheque', paymentDate: at(0, 15, 0).toISOString(),
});
console.log(`Vendor payments: 1 cash ($60), 1 cheque ($250)`);

// ──────────────────────────────────────────────────────────────────────
// DST BOUNDARY TRANSACTIONS (B1 follow-up)
// ──────────────────────────────────────────────────────────────────────
// Fixed historical dates that exercise the spring-forward (Mar 9 2025)
// and fall-back (Nov 2 2025) transitions in the audit store's tz
// (America/New_York). Each tx is inserted at a UTC instant chosen to
// land on a specific local-clock label that ONLY parses correctly with
// the tz-aware `dateTz.ts` helpers.
//
// Pre-fix: `localDayStartUTC('2025-11-02', NY)` returned 05:00 UTC (post-
// DST EST offset). A tx at 04:30 UTC Nov 2 (= 00:30 EDT, the FIRST
// half-hour of local Nov 2) would have been excluded from `/sales/daily?
// from=2025-11-02&to=2025-11-02`. Same shape on the fall-back "extra
// hour" at 04:30 UTC Nov 3 (= 23:30 EST Nov 2 — exists ONLY on fall-back
// days). Old `localDayEndUTC` cut it off.
//
// Post-fix: every tx below is correctly bucketed to its STORE-LOCAL day.
// REPORT 18 in seedAuditAudit.mjs verifies all four show up under Nov 2,
// and the spring-forward txs verify Mar 8/9 boundary.
expected.dst = {
  // 'YYYY-MM-DD' (store-local) → { txCount, expectedNetTotal }
  '2025-11-02': { txCount: 4, expectedNetTotal: 0 },  // fall-back day, 4 txs in 25h local
  '2025-03-08': { txCount: 1, expectedNetTotal: 0 },  // 23:30 EST Mar 8 (= 04:30 UTC Mar 9, just before spring-forward day's local midnight)
  '2025-03-09': { txCount: 1, expectedNetTotal: 0 },  // mid-day Mar 9, post-jump local
};

// Helper to insert a single tx at an exact UTC instant.
async function insertDSTTx(utcIsoStr, dayKey) {
  const txn = buildTx({
    items: [{ productKey: 'milk', qty: 1 }],  // grocery, $4.99 + 5% tax = $5.24 grandTotal
    tender: 'cash', cashierId: cashierAlice, stationId: station1,
    shiftId: null, createdAt: new Date(utcIsoStr), dayOffset: 0,
  });
  // Don't track in byDay (these are FIXED dates outside the relative-date harness)
  // but track in expected.dst and create the DB row.
  await p.transaction.create({ data: txn.insert });
  expected.dst[dayKey].expectedNetTotal = round2(
    expected.dst[dayKey].expectedNetTotal + Number(txn.insert.subtotal),
  );
  return txn;
}

console.log('\nDST boundary txs (fixed dates 2025-11-02 + 2025-03-09):');

// Fall-back day (Nov 2 2025, America/New_York is in EDT until 02:00 EDT,
// then falls back to 01:00 EST. Local day is 25 hours.)
//   04:30 UTC Nov 2  =  00:30 EDT Nov 2 (start of local day)
//   05:30 UTC Nov 2  =  01:30 EDT Nov 2 (first occurrence of 1:30 AM)
//   06:30 UTC Nov 2  =  01:30 EST Nov 2 (second occurrence — post-fall-back)
//   04:30 UTC Nov 3  =  23:30 EST Nov 2 (the "extra" 25th hour — pre-fix
//                                        localDayEndUTC missed this)
await insertDSTTx('2025-11-02T04:30:00.000Z', '2025-11-02');
await insertDSTTx('2025-11-02T05:30:00.000Z', '2025-11-02');
await insertDSTTx('2025-11-02T06:30:00.000Z', '2025-11-02');
await insertDSTTx('2025-11-03T04:30:00.000Z', '2025-11-02');  // <-- the killer regression test

// Spring-forward (Mar 9 2025, EST → EDT at 02:00 local. Local day is 23h.)
//   04:30 UTC Mar 9  =  23:30 EST Mar 8 (NOT Mar 9 — pre-fix would have
//                                        wrongly bucketed this into Mar 9)
//   16:30 UTC Mar 9  =  12:30 EDT Mar 9 (clearly mid-day Mar 9 post-jump)
await insertDSTTx('2025-03-09T04:30:00.000Z', '2025-03-08');
await insertDSTTx('2025-03-09T16:30:00.000Z', '2025-03-09');

console.log('  ✓ 4 txs on 2025-11-02 (fall-back, 25-hour local day)');
console.log('  ✓ 1 tx on 2025-03-08 (23:30 EST = 04:30 UTC Mar 9 — should bucket to Mar 8)');
console.log('  ✓ 1 tx on 2025-03-09 (post-spring-forward mid-day)');

// ── Round all expected totals to 2dp for clean comparison ─────────────
for (const day of Object.values(expected.byDay)) {
  for (const k of Object.keys(day)) {
    if (typeof day[k] === 'number') day[k] = round2(day[k]);
  }
}
for (const dept of Object.values(expected.byDept)) {
  for (const k of Object.keys(dept)) {
    if (typeof dept[k] === 'number') dept[k] = round2(dept[k]);
  }
}
for (const csh of Object.values(expected.byCashier)) {
  for (const k of Object.keys(csh)) {
    if (typeof csh[k] === 'number') csh[k] = round2(csh[k]);
  }
}

// ── Save expected_totals.json ─────────────────────────────────────────
const expectedPath = 'audit-expected.json';
fs.writeFileSync(expectedPath, JSON.stringify(expected, null, 2));

console.log(`\n✓ Expected totals saved to ${expectedPath}`);
console.log('\n=== STAGE 2 COMPLETE ===');
console.log(`Transactions:   ${txCounter - 1}`);
console.log(`Shifts:         ${expected.byShift.length}`);
console.log(`Days covered:   ${Object.keys(expected.byDay).length}`);
console.log(`Departments:    ${Object.keys(expected.byDept).length}`);
console.log(`Cashiers:       ${Object.keys(expected.byCashier).length}`);
console.log(`Lottery days:   ${Object.keys(expected.lottery.byDay).length}`);
console.log(`Fuel days:      ${Object.keys(expected.fuel.byDay).length}`);
console.log(`Vendor payments:${expected.cashMovements.vendorPayments.length}`);
console.log('\nNext: audit reports against audit-expected.json');

await p.$disconnect();
