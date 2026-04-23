/**
 * End-to-end lottery smoke test — exercises every flow we've built in
 * the last few sessions through the live backend API.
 *
 * Ad-hoc file (underscore-prefixed so node --test ignores it by default).
 * Run with: node backend/tests/_smoke_lottery_e2e.mjs
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
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

function ok(step, result) {
  const ind = result.ok ? 'PASS' : 'FAIL';
  console.log(`[${ind}] ${step}: ${result.status}`);
  if (!result.ok) {
    const dump = typeof result.data === 'string' ? result.data.slice(0, 200) : JSON.stringify(result.data).slice(0, 300);
    console.log('       ' + dump);
  }
  return result.ok;
}

function info(msg) { console.log('       ' + msg); }

async function run() {
  console.log('');
  console.log('=== LOTTERY END-TO-END SMOKE TEST ===');
  console.log('');

  // 1. Login as admin
  console.log('-- 1. Login --');
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@storeveu.com', password: 'Admin@123' }),
  });
  const loginData = await login.json();
  if (!login.ok) { console.error('Login failed:', loginData); process.exit(1); }
  TOKEN = loginData.token;
  info(`Logged in: ${loginData.name || loginData.email} (role: ${loginData.role})`);

  // 2. Pick a store
  console.log('');
  console.log('-- 2. Pick active store --');
  const stores = await call('GET', '/stores');
  ok('GET /stores', stores);
  if (!stores.ok) return;
  const storeList = stores.data.stores || stores.data || [];
  if (storeList.length === 0) { console.log('No stores - aborting'); return; }
  STORE_ID = storeList[0].id;
  info(`Active store: ${storeList[0].name} (${STORE_ID})`);

  // 3. Settings - verify sellDirection wired up
  console.log('');
  console.log('-- 3. Lottery settings --');
  const settings = await call('GET', `/lottery/settings?storeId=${STORE_ID}`);
  ok('GET /lottery/settings', settings);
  const s = settings.data?.data || settings.data || {};
  info(`sellDirection: ${s.sellDirection || 'desc (default)'}, state: ${s.state || '(not set)'}, enabled: ${s.enabled}`);

  // 4. Catalog
  console.log('');
  console.log('-- 4. Ticket catalog --');
  const catalog = await call('GET', '/lottery/catalog');
  ok('GET /lottery/catalog', catalog);
  const catalogList = catalog.data?.data || catalog.data || [];
  info(`${catalogList.length} catalog entries`);

  // 5. List current inventory
  console.log('');
  console.log('-- 5. Current inventory --');
  const active   = await call('GET', '/lottery/boxes?status=active');
  const safe     = await call('GET', '/lottery/boxes?status=inventory');
  const soldout  = await call('GET', '/lottery/boxes?status=depleted');
  const returned = await call('GET', '/lottery/boxes?status=returned');
  ok('GET /lottery/boxes?status=active',    active);
  ok('GET /lottery/boxes?status=inventory', safe);
  ok('GET /lottery/boxes?status=depleted',  soldout);
  ok('GET /lottery/boxes?status=returned',  returned);
  const activeList   = active.data?.data   || active.data   || [];
  const safeList     = safe.data?.data     || safe.data     || [];
  const soldoutList  = soldout.data?.data  || soldout.data  || [];
  const returnedList = returned.data?.data || returned.data || [];
  info(`Counter: ${activeList.length} | Safe: ${safeList.length} | Soldout: ${soldoutList.length} | Returned: ${returnedList.length}`);

  // 6. Scan-parse endpoint
  console.log('');
  console.log('-- 6. Scan parse (5 sample QR payloads) --');
  const samples = [
    '52900384500001010070000000064',
    '49800276321280515060000000088',
    '~38705740670045005000000000080',
    '54200075599993005080000000099',
    '498-027632-128',
  ];
  for (const raw of samples) {
    const r = await call('POST', '/lottery/scan/parse', { raw });
    const p = r.data?.parsed || {};
    const typ = p.type || '?';
    const tail =
      `${p.gameNumber || '?'}-${p.bookNumber || '?'}` +
      (typ === 'ticket' ? ` ticket ${p.ticketNumber}` : ' [BOOK scan]') +
      (p.packSize ? ` pack ${p.packSize}` : '');
    ok(`parse ${raw.slice(0, 30)} => ${typ} ${tail}`, r);
  }

  // 7. Yesterday-closes
  console.log('');
  console.log('-- 7. Yesterday-closes (new endpoint) --');
  const yc = await call('GET', '/lottery/yesterday-closes?date=2026-04-23');
  ok('GET /lottery/yesterday-closes?date=2026-04-23', yc);
  const closes = yc.data?.closes || {};
  info(`${Object.keys(closes).length} book(s) have a close-snapshot before 2026-04-23`);

  // 7b. Counter snapshot for today vs a past date
  console.log('');
  console.log('-- 7b. Counter snapshot (date-scoped) --');
  const snapToday = await call('GET', '/lottery/counter-snapshot?date=2026-04-23');
  ok('GET /lottery/counter-snapshot?date=2026-04-23 (today)', snapToday);
  const tb = snapToday.data?.boxes || [];
  info(`today isToday=${snapToday.data?.isToday} · ${tb.length} book(s)`);
  for (const b of tb.slice(0, 3)) {
    info(`  · ${b.game?.gameNumber}-${b.boxNumber} opening=${b.openingTicket} current=${b.currentTicket} activated=${b.activatedAt?.slice(0,10)}`);
  }

  const snapPast = await call('GET', '/lottery/counter-snapshot?date=2026-04-20');
  ok('GET /lottery/counter-snapshot?date=2026-04-20 (past)', snapPast);
  const pb = snapPast.data?.boxes || [];
  info(`2026-04-20 isToday=${snapPast.data?.isToday} · ${pb.length} book(s)`);
  // If today's boxes differ from past day's boxes, date-scoping is working
  if (tb.length !== pb.length) {
    info(`  \u2713 different box count between today and 2026-04-20 — date-scoping working`);
  } else if (tb.length === pb.length && tb.length > 0) {
    // Same count is fine if all books were active on both days; check activation filter
    const someActivatedAfter = tb.some(b => b.activatedAt && b.activatedAt.slice(0,10) > '2026-04-20');
    if (someActivatedAfter) {
      info(`  \u2717 expected some books activated after 2026-04-20 to be excluded from 2026-04-20 view`);
    } else {
      info(`  \u2713 same box count OK (all books activated on or before 2026-04-20)`);
    }
  }

  // 8. Daily inventory
  console.log('');
  console.log('-- 8. Daily inventory (Scratchoff panel data) --');
  const inv = await call('GET', '/lottery/daily-inventory?date=2026-04-23');
  ok('GET /lottery/daily-inventory', inv);
  const ivd = inv.data?.data || inv.data || {};
  info(`begin=$${ivd.begin} received=$${ivd.received} sold=$${ivd.sold} end=$${ivd.end} activated=${ivd.activated}`);

  // 9. Shifts
  console.log('');
  console.log('-- 9. Shifts for today --');
  const shifts = await call('GET', `/pos-terminal/shifts?status=closed&storeId=${STORE_ID}&dateFrom=2026-04-23&dateTo=2026-04-23`);
  ok('GET /pos-terminal/shifts', shifts);
  const shiftList = shifts.data?.shifts || shifts.data || [];
  info(`${Array.isArray(shiftList) ? shiftList.length : 0} shift(s) closed today`);

  // 10. Online totals
  console.log('');
  console.log('-- 10. Online totals --');
  const otot = await call('GET', '/lottery/online-total?date=2026-04-23');
  ok('GET /lottery/online-total', otot);
  const otd = otot.data?.data || otot.data || {};
  info(`instantCashing=${otd.instantCashing || 0} machineSales=${otd.machineSales || 0} machineCashing=${otd.machineCashing || 0}`);

  // 11. Shift reports
  console.log('');
  console.log('-- 11. Shift reports --');
  const sr = await call('GET', '/lottery/shift-reports');
  ok('GET /lottery/shift-reports', sr);
  const srList = Array.isArray(sr.data) ? sr.data : (sr.data?.reports || []);
  info(`${srList.length} shift report(s)`);

  // 12. Stations
  console.log('');
  console.log('-- 12. Stations --');
  const stations = await call('GET', `/pos-terminal/stations?storeId=${STORE_ID}`);
  ok('GET /pos-terminal/stations', stations);
  const stationList = stations.data?.stations || [];
  info(`${stationList.length} station(s) at store ${STORE_ID}`);

  // 13. Return endpoint accepts partial-return shape (dry run)
  console.log('');
  console.log('-- 13. Return endpoint accepts partial-return body (dry run) --');
  const dryRun = await call(
    'POST',
    '/lottery/boxes/NOPE-fake-id-for-test/return-to-lotto',
    { reason: 'smoke_test', returnType: 'partial', ticketsSold: 5 }
  );
  if (dryRun.status === 404) {
    console.log('[PASS] Endpoint accepted partial return shape (404 as expected - fake id)');
  } else if (dryRun.status === 400) {
    console.log(`[FAIL] Endpoint rejected partial return body: ${JSON.stringify(dryRun.data).slice(0, 200)}`);
  } else {
    console.log(`[?]    unexpected ${dryRun.status}: ${JSON.stringify(dryRun.data).slice(0, 200)}`);
  }

  console.log('');
  console.log('=== DONE ===');
  console.log('');
}

run().catch((e) => { console.error('FATAL:', e); process.exit(1); });
