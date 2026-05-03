// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

/**
 * Live HTTP smoke test for the unified reconciliation flow.
 *
 *   1. Login as admin@futurefoodsme.com (Weymouth org)
 *   2. Find the most-recent CLOSED shift via GET /pos-terminal/shifts
 *   3. GET /pos-terminal/shift/:id/report
 *   4. Verify the response contains:
 *        - the legacy summary fields (cashSales, cashRefunds, etc.)
 *        - the new `reconciliation` object with lineItems + lottery
 *
 * Underscore-prefixed so node --test ignores it. Run manually:
 *   node tests/_smoke_reconcile_live.mjs
 */

const BASE = 'http://localhost:5000/api';

let TOKEN = null;
let STORE_ID = null;

const H = () => ({
  'Content-Type': 'application/json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  ...(STORE_ID ? { 'X-Store-Id': STORE_ID } : {}),
});

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: H(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

async function main() {
  console.log('\n=== Live HTTP smoke — unified shift reconciliation ===\n');

  // 1. Login (uses the dev password set in Session 44 sessions)
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@futurefoodsme.com', password: 'LotteryTest@2026' }),
  });
  const ld = await login.json();
  if (!login.ok) {
    console.error('Login failed:', ld);
    process.exit(1);
  }
  TOKEN = ld.token;
  console.log(`✓ Logged in as ${ld.email} (role: ${ld.role})`);

  // 2. Pick the Weymouth store
  const stores = await call('GET', '/stores');
  const list = stores.data.stores || stores.data || [];
  const weymouth = list.find(s => s.name?.includes('Weymouth')) || list[0];
  STORE_ID = weymouth.id;
  console.log(`✓ Using store: ${weymouth.name} (${STORE_ID})`);

  // 3. Find the most recent closed shift
  const shifts = await call('GET', `/pos-terminal/shifts?status=closed&storeId=${STORE_ID}&limit=5`);
  if (!shifts.ok) { console.error('Shifts list failed:', shifts.data); process.exit(1); }
  const shiftList = shifts.data.shifts || shifts.data || [];
  if (!shiftList.length) {
    console.error('No closed shifts at this store — close one in the cashier app first.');
    process.exit(1);
  }
  const target = shiftList[0];
  console.log(`✓ Most recent closed shift: ${target.id} (closed ${target.closedAt?.slice(0, 16)})`);

  // 4. Get the shift report
  const report = await call('GET', `/pos-terminal/shift/${target.id}/report`);
  assert(report.ok,                                     'GET /shift/:id/report → 200');
  assert(report.data.id === target.id,                  'response.id matches the requested shift');

  // ── Legacy summary fields (back-compat) ──
  assert(typeof report.data.openingAmount  === 'number', 'legacy: openingAmount  is a number');
  assert(report.data.cashSales      !== undefined,       'legacy: cashSales      present');
  assert(report.data.cashRefunds    !== undefined,       'legacy: cashRefunds    present');
  assert(report.data.cashDropsTotal !== undefined,       'legacy: cashDropsTotal present');
  assert(report.data.payoutsTotal   !== undefined,       'legacy: payoutsTotal   present');
  assert(report.data.expectedAmount !== undefined,       'legacy: expectedAmount present');

  // ── NEW: reconciliation object with lineItems + lottery ──
  const recon = report.data.reconciliation;
  assert(recon !== undefined,                           'NEW: reconciliation object is present');
  if (recon == null) {
    console.error('  reconciliation came back null — check backend logs for reconcileShift errors');
    process.exit(1);
  }
  assert(Array.isArray(recon.lineItems),                'reconciliation.lineItems is an array');
  assert(recon.lineItems.length >= 6,                   `reconciliation.lineItems has ≥6 entries (got ${recon.lineItems.length})`);
  assert(recon.lottery && typeof recon.lottery === 'object', 'reconciliation.lottery is an object');
  assert(typeof recon.lottery.netLotteryCash === 'number',  'reconciliation.lottery.netLotteryCash is a number');
  assert(typeof recon.expectedDrawer       === 'number',    'reconciliation.expectedDrawer is a number');
  assert(typeof recon.openingFloat         === 'number',    'reconciliation.openingFloat is a number');

  const expectedKeys = recon.lineItems.map(li => li.key);
  assert(expectedKeys.includes('opening'),              'lineItems contains "opening"');
  assert(expectedKeys.includes('cashSales'),            'lineItems contains "cashSales"');
  assert(expectedKeys.includes('expected'),             'lineItems contains "expected"');
  assert(recon.lineItems[expectedKeys.indexOf('expected')]?.kind === 'subtotal',
                                                       '"expected" line is kind=subtotal');

  // Print a brief summary of the response
  console.log('\n── Reconciliation summary ──');
  console.log(`  Opening:        $${recon.openingFloat.toFixed(2)}`);
  console.log(`  Cash sales:     $${recon.cashSales.toFixed(2)}`);
  console.log(`  Cash refunds:   $${recon.cashRefunds.toFixed(2)}`);
  console.log(`  Cash drops:     $${recon.cashDropsTotal.toFixed(2)}`);
  console.log(`  Cash in:        $${recon.cashIn.toFixed(2)}`);
  console.log(`  Cash out:       $${recon.cashOut.toFixed(2)}`);
  console.log(`  ── Lottery ──`);
  console.log(`  Ticket-math:    $${recon.lottery.ticketMathSales.toFixed(2)} (source: ${recon.lottery.source})`);
  console.log(`  POS rang:       $${recon.lottery.posLotterySales.toFixed(2)}`);
  console.log(`  Un-rung cash:   $${recon.lottery.unreportedCash.toFixed(2)}`);
  console.log(`  Machine sales:  $${recon.lottery.machineDrawSales.toFixed(2)}`);
  console.log(`  Machine cash:   $${recon.lottery.machineCashings.toFixed(2)}`);
  console.log(`  Instant cash:   $${recon.lottery.instantCashings.toFixed(2)}`);
  console.log(`  Net lottery:    $${recon.lottery.netLotteryCash.toFixed(2)}`);
  console.log(`  ── Final ──`);
  console.log(`  Expected:       $${recon.expectedDrawer.toFixed(2)}`);
  console.log(`  Counted:        $${(recon.closingAmount ?? 0).toFixed(2)}`);
  console.log(`  Variance:       ${recon.variance != null ? '$' + recon.variance.toFixed(2) : '(null)'}`);
  console.log(`  Line items:     ${expectedKeys.join(', ')}`);

  console.log('\n✅ All assertions passed.\n');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
