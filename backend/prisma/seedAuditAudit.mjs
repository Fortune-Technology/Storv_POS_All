/**
 * Audit Store — Stage 3 (Run audit + drift matrix)
 *
 * Hits each major report endpoint against the audit store and compares
 * the response to audit-expected.json (ground-truth totals from Stage 2).
 *
 * Output: drift matrix printed to console + saved to audit-drift.json.
 *
 * Pre-reqs:
 *   • Backend dev server running on localhost:5000
 *   • Stage 1 (seedAuditStore.mjs) + Stage 2 (seedAuditTransactions.mjs) run
 *
 * Read-only against the DB except for upserting the audit admin user.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';

const p = new PrismaClient();

const F = JSON.parse(fs.readFileSync('audit-fixtures.json', 'utf8'));
const E = JSON.parse(fs.readFileSync('audit-expected.json',  'utf8'));

const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_to_a_long_random_secret';

console.log('=== AUDIT STORE SEED — STAGE 3 (DRIFT AUDIT) ===\n');

// ── Upsert audit admin user ────────────────────────────────────────────
let admin = await p.user.findUnique({ where: { email: 'audit-admin@audit.test' } });
if (!admin) {
  admin = await p.user.create({
    data: {
      name: 'Audit Admin',
      email: 'audit-admin@audit.test',
      password: await bcrypt.hash('Audit@1234!', 10),
      role: 'owner',
      organization: { connect: { id: F.orgId } },
      status: 'active',
      // S77 — bypass vendor onboarding gate for audit admin
      onboardingSubmitted: true,
      contractSigned: true,
      vendorApproved: true,
    },
  });
  await p.userOrg.create({ data: { userId: admin.id, orgId: F.orgId, role: 'owner', isPrimary: true } });
  await p.userStore.create({ data: { userId: admin.id, storeId: F.storeId } });
  console.log(`✓ Created audit admin [${admin.id}]`);
} else {
  // Ensure UserOrg + UserStore exist (idempotent)
  const uo = await p.userOrg.findUnique({ where: { userId_orgId: { userId: admin.id, orgId: F.orgId } } });
  if (!uo) await p.userOrg.create({ data: { userId: admin.id, orgId: F.orgId, role: 'owner', isPrimary: true } });
  const us = await p.userStore.findUnique({ where: { userId_storeId: { userId: admin.id, storeId: F.storeId } } });
  if (!us) await p.userStore.create({ data: { userId: admin.id, storeId: F.storeId } });
  console.log(`✓ Audit admin exists [${admin.id}]`);
}

const TOKEN = jwt.sign({ id: admin.id }, JWT_SECRET, { expiresIn: '2h' });
console.log(`✓ JWT signed (2h ttl)`);

// ── HTTP helpers ───────────────────────────────────────────────────────
async function GET(path, params = {}) {
  const url = new URL(`${BACKEND}/api${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'X-Store-Id':  F.storeId,
    'Content-Type': 'application/json',
  };
  const res = await fetch(url.toString(), { headers });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json, url: url.toString() };
}

const drift = [];
const pad = (s, n) => String(s ?? '').padEnd(n);
const padNum = (n, w = 9) => (n == null ? '—'.padStart(w) : Number(n).toFixed(2).padStart(w));

function diffNumbers(label, expectedVal, actualVal, opts = {}) {
  const tolerance = opts.tolerance ?? 0.01; // pennies
  const expected = expectedVal == null ? null : Number(expectedVal);
  const actual   = actualVal == null   ? null : Number(actualVal);
  const matches  = expected == null && actual == null
    ? true
    : (expected != null && actual != null && Math.abs(expected - actual) <= tolerance);
  const status = matches ? '✓' : '✗';
  drift.push({ label, expected, actual, matches });
  return `  ${status} ${pad(label, 38)} expected=${padNum(expected)}  actual=${padNum(actual)}${matches ? '' : '  ⚠ DRIFT'}`;
}

// ── Date helpers ────────────────────────────────────────────────────────
const today = new Date(); today.setHours(0,0,0,0);
const dKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const offsetDay = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
const TODAY     = dKey(today);
const YESTERDAY = dKey(offsetDay(-1));
const D_MINUS_2 = dKey(offsetDay(-2));
const D_MINUS_3 = dKey(offsetDay(-3));
const D_MINUS_4 = dKey(offsetDay(-4));
const SEVEN_AGO = dKey(offsetDay(-6));   // last-7d window starts today-6
const THIRTY_AGO = dKey(offsetDay(-29));

console.log(`\nWindows: today=${TODAY} | yesterday=${YESTERDAY} | 7d=${SEVEN_AGO}..${TODAY} | 30d=${THIRTY_AGO}..${TODAY}\n`);

// ════════════════════════════════════════════════════════════════════════
// REPORT 1: /sales/realtime — Live Dashboard
// ════════════════════════════════════════════════════════════════════════
console.log('────────────────────────────────────────────────────────────────');
console.log('REPORT 1 — /sales/realtime (Live Dashboard, "today")');
console.log('────────────────────────────────────────────────────────────────');
{
  const r = await GET('/sales/realtime', { storeId: F.storeId });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    const expDay = E.byDay[TODAY] || { gross: 0, net: 0, tax: 0, txCount: 0 };
    const actToday = r.body.todaySales || {};      // ← real key is `todaySales`
    console.log(diffNumbers('today.netSales',     expDay.net,     actToday.netSales));
    console.log(diffNumbers('today.grossSales',   expDay.gross,   actToday.grossSales));
    console.log(diffNumbers('today.tax',          expDay.tax,     actToday.taxTotal));   // ← `taxTotal`
    console.log(diffNumbers('today.txCount',      expDay.txCount, actToday.txCount, { tolerance: 0 }));
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 2: /sales/daily — daily buckets
// ════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 2 — /sales/daily (5-day window)');
console.log('────────────────────────────────────────────────────────────────');
{
  const r = await GET('/sales/daily', { from: D_MINUS_4, to: TODAY, storeId: F.storeId });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    const rows = r.body.value || [];               // ← real shape is `{ value: [...] }`
    for (const d of [D_MINUS_4, D_MINUS_3, D_MINUS_2, YESTERDAY, TODAY]) {
      const exp = E.byDay[d] || { gross: 0, net: 0, tax: 0, txCount: 0 };
      const row = rows.find(x => x.Date === d);
      console.log(diffNumbers(`  net (${d})`,     exp.net,    row?.TotalNetSales));
      console.log(diffNumbers(`  gross (${d})`,   exp.gross,  row?.TotalGrossSales));
      console.log(diffNumbers(`  tax (${d})`,     exp.tax,    row?.TotalTaxes));
      console.log(diffNumbers(`  txCount (${d})`, exp.txCount, row?.TotalTransactionsCount, { tolerance: 0 }));
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 3: /reports/end-of-day — date scope
// ════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 3 — /reports/end-of-day (single-day scope, yesterday)');
console.log('────────────────────────────────────────────────────────────────');
{
  const r = await GET('/reports/end-of-day', { date: YESTERDAY, storeId: F.storeId });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    const exp = E.byDay[YESTERDAY] || { gross: 0, net: 0, tax: 0, txCount: 0 };
    // transactions is an ARRAY of { key, label, count, amount }
    const tx = (r.body.transactions || []).reduce((m, t) => { m[t.key] = t; return m; }, {});
    console.log(diffNumbers('eod.tx.netSales',   exp.net,    tx.netSales?.amount));
    console.log(diffNumbers('eod.tx.grossSales', exp.gross,  tx.grossSales?.amount));
    console.log(diffNumbers('eod.tx.tax',        exp.tax,    tx.tax?.amount));
    console.log(diffNumbers('eod.tx.completeCount', exp.txCount, tx.netSales?.count, { tolerance: 0 }));
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 4: /sales/departments
// ════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 4 — /sales/departments (5-day window)');
console.log('────────────────────────────────────────────────────────────────');
{
  const r = await GET('/sales/departments', { from: D_MINUS_4, to: TODAY, storeId: F.storeId });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    const rows = r.body.value || [];
    // Build a map by lowercase Name for easy lookup
    const byName = {};
    for (const row of rows) byName[(row.Name || '').toLowerCase()] = row;
    for (const [deptKey, expDept] of Object.entries(E.byDept)) {
      const lower = deptKey.toLowerCase();
      const row = byName[lower];
      console.log(diffNumbers(`dept.${deptKey} netSales`, expDept.netSales, row?.TotalNetSales));
    }
    // Also note if Beverages is missing entirely (B7 bug) — explicit check
    const beverages = byName['beverages'];
    if (!beverages) {
      drift.push({ label: 'dept.BEVERAGES present?', expected: 'present', actual: 'missing', matches: false });
      console.log('  ✗ dept.BEVERAGES present?                      expected=  present  actual=  missing  ⚠ DRIFT (B7)');
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 5: /lottery/report — date range  (singular, not /reports!)
// ════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 5 — /lottery/report (8-day window)');
console.log('────────────────────────────────────────────────────────────────');
{
  const r = await GET('/lottery/report', { from: dKey(offsetDay(-7)), to: TODAY, storeId: F.storeId });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    const totalExp = Object.values(E.lottery.byDay).reduce((s, d) => s + d.instantSales, 0);
    const totalPosExp = Object.values(E.lottery.byDay).reduce((s, d) => s + d.posRecorded, 0);
    console.log(diffNumbers('lottery.totalSales (ticket-math)', totalExp, r.body.totalSales));
    console.log(diffNumbers('lottery.posSales (POS-recorded)',  totalPosExp, r.body.posSales));
    console.log(diffNumbers('lottery.unreported',               Math.max(0, totalExp - totalPosExp), r.body.unreported));
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 6: /lottery/commission
// ════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 6 — /lottery/commission');
console.log('────────────────────────────────────────────────────────────────');
{
  const r = await GET('/lottery/commission', { from: dKey(offsetDay(-7)), to: TODAY, storeId: F.storeId });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    console.log(diffNumbers('lottery.totalCommission (5%)', E.lottery.commission, r.body.totalCommission));
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 7: /fuel/report — date range  (singular!)
// ════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 7 — /fuel/report (5-day window)');
console.log('────────────────────────────────────────────────────────────────');
{
  const r = await GET('/fuel/report', { from: D_MINUS_4, to: TODAY, storeId: F.storeId });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    const totals = r.body?.data?.totals || {};
    console.log(diffNumbers('fuel.totalGallons',  E.fuel.totalGallonsSold, totals.gallons));
    console.log(diffNumbers('fuel.totalRevenue',  E.fuel.totalRevenue,     totals.amount));
    console.log(diffNumbers('fuel.txCount',       5,                       totals.txCount, { tolerance: 0 }));
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 8: /fuel/pnl-report — FIFO P&L
// ════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 8 — /fuel/pnl-report (5-day, daily granularity)');
console.log('────────────────────────────────────────────────────────────────');
{
  const r = await GET('/fuel/pnl-report', { from: D_MINUS_4, to: TODAY, granularity: 'daily', storeId: F.storeId });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    // Sum the per-day rows for an apples-to-apples total comparison
    const rows = r.body?.data?.rows || [];
    const sumGal = rows.reduce((s, x) => s + (x.gallons || 0), 0);
    const sumRev = rows.reduce((s, x) => s + (x.revenue || 0), 0);
    const sumCog = rows.reduce((s, x) => s + (x.cogs || 0), 0);
    const sumPro = rows.reduce((s, x) => s + (x.profit || 0), 0);
    console.log(diffNumbers('fuel.pnl.gallons', E.fuel.totalGallonsSold, sumGal));
    console.log(diffNumbers('fuel.pnl.revenue', E.fuel.totalRevenue, sumRev));
    console.log(diffNumbers('fuel.pnl.cogs',    E.fuel.totalCOGS,    sumCog));
    console.log(diffNumbers('fuel.pnl.profit',  E.fuel.totalRevenue - E.fuel.totalCOGS, sumPro));
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 9: per-shift lottery sales (B4 — multi-cashier handover)
// Day -1 has 2 shifts (Alice 7am-3pm + Bob 2:30pm-11pm with 30-min overlap)
// Total Day -1 lottery = $40. Alice should get $10, Bob should get $30.
// Without B4 fix, both shifts would each show ~$40 (whole-day attribution).
// ════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 9 — per-shift lottery (B4 multi-cashier handover)');
console.log('────────────────────────────────────────────────────────────────');
{
  const byShift = E.lottery.byShift || {};
  const shiftIds = Object.keys(byShift);
  if (shiftIds.length === 0) {
    console.log('  ⚠ No expected.lottery.byShift in audit-expected.json — skipping');
  } else {
    let dailyTotal = 0;
    for (const shiftId of shiftIds) {
      const exp = byShift[shiftId];
      const r = await GET(`/pos-terminal/shift/${shiftId}/eod-report`);
      if (r.status !== 200) {
        console.log(`  ✗ HTTP ${r.status} for shift ${exp.label} — ${JSON.stringify(r.body).slice(0, 150)}`);
        continue;
      }
      const actSales = r.body.reconciliation?.lottery?.ticketMathSales;
      console.log(diffNumbers(`shift.${exp.label} lottery ticketMathSales`, exp.instantSales, actSales));
      dailyTotal += Number(actSales || 0);
    }
    // Sum check — should match the day's total ($40)
    console.log(diffNumbers('shifts day-total (sum check)', 40, dailyTotal));
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 10: /sales/weekly — weekly aggregation (S60 timezone fix inherited)
// ════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 10 — /sales/weekly (5-day window, expect 1-2 weeks)');
console.log('────────────────────────────────────────────────────────────────');
{
  const r = await GET('/sales/weekly', { from: D_MINUS_4, to: TODAY, storeId: F.storeId });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    const rows = r.body.value || [];
    // Sum across ALL weekly rows should equal sum across daily — weekly is just rolled-up daily
    const sumNet   = rows.reduce((a, w) => a + (w.TotalNetSales   || 0), 0);
    const sumGross = rows.reduce((a, w) => a + (w.TotalGrossSales || 0), 0);
    const sumTax   = rows.reduce((a, w) => a + (w.TotalTaxes      || 0), 0);
    const sumTx    = rows.reduce((a, w) => a + (w.TotalTransactionsCount || 0), 0);

    let expNet = 0, expGross = 0, expTax = 0, expTx = 0;
    for (const d of [D_MINUS_4, D_MINUS_3, D_MINUS_2, YESTERDAY, TODAY]) {
      const x = E.byDay[d] || { gross: 0, net: 0, tax: 0, txCount: 0 };
      expNet += x.net; expGross += x.gross; expTax += x.tax; expTx += x.txCount;
    }
    console.log(diffNumbers('weekly.sum(net)',   expNet,   sumNet));
    console.log(diffNumbers('weekly.sum(gross)', expGross, sumGross));
    console.log(diffNumbers('weekly.sum(tax)',   expTax,   sumTax));
    console.log(diffNumbers('weekly.sum(txs)',   expTx,    sumTx, { tolerance: 0 }));
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 11: /sales/monthly — monthly aggregation
// ════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 11 — /sales/monthly (5-day window)');
console.log('────────────────────────────────────────────────────────────────');
{
  const r = await GET('/sales/monthly', { from: D_MINUS_4, to: TODAY, storeId: F.storeId });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    const rows = r.body.value || [];
    const sumNet   = rows.reduce((a, m) => a + (m.TotalNetSales   || 0), 0);
    const sumGross = rows.reduce((a, m) => a + (m.TotalGrossSales || 0), 0);
    const sumTx    = rows.reduce((a, m) => a + (m.TotalTransactionsCount || 0), 0);

    let expNet = 0, expGross = 0, expTx = 0;
    for (const d of [D_MINUS_4, D_MINUS_3, D_MINUS_2, YESTERDAY, TODAY]) {
      const x = E.byDay[d] || { gross: 0, net: 0, txCount: 0 };
      expNet += x.net; expGross += x.gross; expTx += x.txCount;
    }
    console.log(diffNumbers('monthly.sum(net)',   expNet,   sumNet));
    console.log(diffNumbers('monthly.sum(gross)', expGross, sumGross));
    console.log(diffNumbers('monthly.sum(txs)',   expTx,    sumTx, { tolerance: 0 }));
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 12: /sales/products/top — top sellers for a specific day
// ════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 12 — /sales/products/top (yesterday)');
console.log('────────────────────────────────────────────────────────────────');
{
  // Sum all per-product units across ALL days, find the leader.
  // Then verify that yesterday's top-product list returns rows whose unit + revenue
  // sums match the per-day expectation in byProductByDay.
  const r = await GET('/sales/products/top', { date: YESTERDAY, storeId: F.storeId });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    const rows = r.body.value || [];
    const expDay = E.byProductByDay?.[YESTERDAY] || {};
    const expProductCount = Object.keys(expDay).length;
    const expTotalUnits = Object.values(expDay).reduce((a, p) => a + (p.units || 0), 0);
    const expTotalRev   = Object.values(expDay).reduce((a, p) => a + (p.revenue || 0), 0);

    const actUnits = rows.reduce((a, p) => a + (p.UnitsSold || 0), 0);
    const actRev   = rows.reduce((a, p) => a + (p.NetSales  || 0), 0);

    console.log(diffNumbers('top.products.count', expProductCount, rows.length, { tolerance: 0 }));
    console.log(diffNumbers('top.sum(units)',    expTotalUnits,   actUnits,    { tolerance: 0 }));
    console.log(diffNumbers('top.sum(revenue)', expTotalRev,     actRev));
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 13: /sales/products/grouped — paginated best sellers (5-day window)
// ════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 13 — /sales/products/grouped (5-day window)');
console.log('────────────────────────────────────────────────────────────────');
{
  const r = await GET('/sales/products/grouped', { from: D_MINUS_4, to: TODAY, storeId: F.storeId, pageSize: 100 });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    const rows = r.body.value || [];
    // expected.byProduct totals span the full 5-day window
    const expProductCount = Object.keys(E.byProduct || {}).length;
    const expTotalUnits = Object.values(E.byProduct || {}).reduce((a, p) => a + (p.unitsSold || 0), 0);
    const expTotalRev   = Object.values(E.byProduct || {}).reduce((a, p) => a + (p.revenue   || 0), 0);

    const actUnits = rows.reduce((a, p) => a + (p.UnitsSold || 0), 0);
    const actRev   = rows.reduce((a, p) => a + (p.NetSales  || 0), 0);

    // Page-size 100 should return all distinct products in this small audit dataset
    console.log(diffNumbers('grouped.products.count', expProductCount, rows.length, { tolerance: 0 }));
    console.log(diffNumbers('grouped.sum(units)',     expTotalUnits,   actUnits,    { tolerance: 0 }));
    console.log(diffNumbers('grouped.sum(revenue)',   expTotalRev,     actRev));
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 14: /sales/products/movement — single-product daily series
// ════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 14 — /sales/products/movement (bread, 5-day series)');
console.log('────────────────────────────────────────────────────────────────');
{
  // Pick "bread" as the canary — used in multiple seeded transactions
  const breadUpc = F.products?.bread?.upc || '99000000001';
  const r = await GET('/sales/products/movement', {
    upc: breadUpc, dateStart: D_MINUS_4, dateFinish: TODAY, storeId: F.storeId,
  });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    const rows = r.body.value || [];
    const dayMap = rows.reduce((m, b) => { m[b.Date] = b; return m; }, {});
    let totalActUnits = 0, totalActRev = 0, totalExpUnits = 0, totalExpRev = 0;
    for (const d of [D_MINUS_4, D_MINUS_3, D_MINUS_2, YESTERDAY, TODAY]) {
      const exp = E.byProductByDay?.[d]?.bread || { units: 0, revenue: 0 };
      const act = dayMap[d] || {};
      totalExpUnits += exp.units;       totalExpRev  += exp.revenue;
      totalActUnits += act.Units || 0;  totalActRev += act.Revenue || 0;
    }
    console.log(diffNumbers('movement.bread.sum(units)',   totalExpUnits, totalActUnits, { tolerance: 0 }));
    console.log(diffNumbers('movement.bread.sum(revenue)', totalExpRev,   totalActRev));
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 15: /sales/products/52week-stats — divisor floor (max(weeks, 4))
// ════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 15 — /sales/products/52week-stats (bread)');
console.log('────────────────────────────────────────────────────────────────');
{
  const breadUpc = F.products?.bread?.upc || '99000000001';
  const r = await GET('/sales/products/52week-stats', { upc: breadUpc, storeId: F.storeId });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    const stats = r.body || {};
    const expBread = E.byProduct?.bread || { unitsSold: 0 };
    // S22 B11: avg divisor floor → max(weeksWithSales, 4)
    // Audit only seeded 5 days of activity → weeksWithSales = 1, divisor = max(1,4) = 4
    // So expected avgWeekly = totalUnits / 4
    const expAvg = expBread.unitsSold / 4;
    console.log(diffNumbers('52week.bread.totalUnits',    expBread.unitsSold, stats.totalUnits, { tolerance: 0 }));
    console.log(diffNumbers('52week.bread.avgWeekly(/4)', expAvg,             stats.avgWeekly));
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 16: S77 (C9) — EoD payout buckets for the 5 cash drawer event types
// ════════════════════════════════════════════════════════════════════════
// Verifies all 5 cash event types land in the correct EoD bucket on Day 0:
//   pickups          ← CashDrop type='drop'
//   paid_in          ← CashDrop type='paid_in'
//   paid_out         ← CashPayout payoutType='expense'/'merchandise'
//   loans            ← CashPayout payoutType='loan'
//   received_on_acct ← CashPayout payoutType='received_on_account'
//
// Also verifies referenceNumber is persisted with the correct prefix.
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 16 — S77 (C9) cash drawer event EoD buckets (today)');
console.log('────────────────────────────────────────────────────────────────');
{
  const r = await GET('/reports/end-of-day', { date: TODAY, storeId: F.storeId });
  if (r.status !== 200) {
    console.log(`✗ HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    const expBuckets = E.cashEventBuckets || {};
    const payoutMap = (r.body.payouts || []).reduce((m, p) => { m[p.key] = p; return m; }, {});

    for (const [bucketKey, exp] of Object.entries(expBuckets)) {
      const actual = payoutMap[bucketKey];
      console.log(diffNumbers(`eod.bucket.${bucketKey}.count`,  exp.count,  actual?.count,  { tolerance: 0 }));
      console.log(diffNumbers(`eod.bucket.${bucketKey}.amount`, exp.amount, actual?.amount));
    }

    // Reconciliation: verify all 5 event types contribute correctly to drawer
    const todayShift = (E.byShift || []).find(s => s.open && !s.closedAt);
    if (todayShift) {
      const recon = r.body.reconciliation || {};
      console.log(diffNumbers('eod.recon.cashDropsTotal',      todayShift.cashDropsTotal,    recon.cashDropsTotal));
      console.log(diffNumbers('eod.recon.cashIn (paid_in+RA)', todayShift.cashIn,            recon.cashIn));
      console.log(diffNumbers('eod.recon.cashOut (vendor+loan)', todayShift.cashOut,          recon.cashOut));
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// REPORT 17: S77 (C9) — referenceNumber persistence + format check
// ════════════════════════════════════════════════════════════════════════
// Verifies each of the 5 cash events on Day 0 got a referenceNumber stamped
// with the correct prefix (CD / CI / VP / LN / RA). Reads via the back-office
// /payouts and /cash-drops endpoints which return the raw rows.
console.log('\n────────────────────────────────────────────────────────────────');
console.log('REPORT 17 — S77 (C9) referenceNumber prefix check');
console.log('────────────────────────────────────────────────────────────────');
{
  const today = new Date().toISOString().slice(0, 10);
  const [drops, payouts] = await Promise.all([
    GET('/pos-terminal/cash-drops', { storeId: F.storeId, dateFrom: today, dateTo: today, limit: 50 }),
    GET('/pos-terminal/payouts',    { storeId: F.storeId, dateFrom: today, dateTo: today, limit: 50 }),
  ]);
  const dropRows   = drops.body?.drops    || [];
  const payoutRows = payouts.body?.payouts || [];

  const cdCount = dropRows.filter(d => d.referenceNumber?.startsWith('CD-')).length;
  const ciCount = dropRows.filter(d => d.referenceNumber?.startsWith('CI-')).length;
  const vpCount = payoutRows.filter(p => p.referenceNumber?.startsWith('VP-')).length;
  const lnCount = payoutRows.filter(p => p.referenceNumber?.startsWith('LN-')).length;
  const raCount = payoutRows.filter(p => p.referenceNumber?.startsWith('RA-')).length;

  console.log(diffNumbers('ref.CD count',  1, cdCount, { tolerance: 0 }));
  console.log(diffNumbers('ref.CI count',  1, ciCount, { tolerance: 0 }));
  console.log(diffNumbers('ref.VP count',  1, vpCount, { tolerance: 0 }));
  console.log(diffNumbers('ref.LN count',  1, lnCount, { tolerance: 0 }));
  console.log(diffNumbers('ref.RA count',  1, raCount, { tolerance: 0 }));
}

// ── Drift summary ──────────────────────────────────────────────────────
const totalChecks = drift.length;
const matches = drift.filter(d => d.matches).length;
const fails   = drift.filter(d => !d.matches).length;

console.log('\n════════════════════════════════════════════════════════════════');
console.log('DRIFT SUMMARY');
console.log('════════════════════════════════════════════════════════════════');
console.log(`Total checks: ${totalChecks}`);
console.log(`✓ Match:     ${matches}`);
console.log(`✗ Drift:     ${fails}`);

if (fails > 0) {
  console.log('\nDRIFT DETAILS:');
  for (const d of drift) {
    if (d.matches) continue;
    console.log(`  ✗ ${d.label}: expected=${d.expected}, actual=${d.actual}`);
  }
}

fs.writeFileSync('audit-drift.json', JSON.stringify({
  totalChecks, matches, fails,
  details: drift,
  generatedAt: new Date().toISOString(),
}, null, 2));
console.log('\n✓ Drift report saved to audit-drift.json');

await p.$disconnect();
