// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

/**
 * Probe the seeded data — hits the inventory + yesterday-closes + reports
 * endpoints for the actual past dates where we wrote data.
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
    method, headers: H(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

(async () => {
  // Login + pick store
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@futurefoodsme.com', password: 'LotteryTest@2026' }),
  });
  const ld = await login.json();
  TOKEN = ld.token;
  const stores = await call('GET', '/stores');
  const storeList = stores.data.stores || stores.data || [];
  // The seed targets the store that has active LotteryBoxes — match that
  const seededStore = storeList.find(s => s.name?.includes('Weymouth')) || storeList[0];
  STORE_ID = seededStore.id;
  console.log(`Store: ${seededStore.name} (${STORE_ID})\n`);

  // Build the past-7-day window matching the seed
  const today = new Date(); today.setUTCHours(0,0,0,0);
  console.log('=== Daily inventory across the seeded 7-day window ===\n');
  for (let i = 7; i >= 1; i--) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - i);
    const ds = isoDate(d);
    const r = await call('GET', `/lottery/daily-inventory?date=${ds}`);
    if (!r.ok) { console.log(`${ds}: ERROR ${r.status}`); continue; }
    const x = r.data?.data || r.data;
    const sold      = (x.sold      ?? 0).toFixed(2);
    const posSold   = (x.posSold   ?? 0).toFixed(2);
    const unreport  = (x.unreported ?? 0).toFixed(2);
    const begin     = (x.begin     ?? 0).toFixed(2);
    const end       = (x.end       ?? 0).toFixed(2);
    const flag = parseFloat(unreport) > 0 ? '  ⚠ UNREPORTED' : '';
    console.log(`  ${ds} (T-${i}): begin=$${begin} end=$${end} sold=$${sold} posSold=$${posSold} unreported=$${unreport}${flag}`);
  }
  console.log('\n=== Yesterday-closes for each seeded day ===\n');
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - i);
    const ds = isoDate(d);
    const r = await call('GET', `/lottery/yesterday-closes?date=${ds}`);
    const closes = r.data?.closes || {};
    const n = Object.keys(closes).length;
    console.log(`  ${ds} (T-${i}): ${n} book(s) with prior close snapshot`);
    Object.entries(closes).slice(0, 2).forEach(([boxId, snap]) => {
      console.log(`     ${boxId.slice(0, 12)}... → ticket=${snap.ticket} ticketsSold=${snap.ticketsSold} closedAt=${snap.closedAt?.slice(0,16)}`);
    });
  }

  console.log('\n=== Counter snapshot for past days ===\n');
  for (let i = 6; i >= 1; i--) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - i);
    const ds = isoDate(d);
    const r = await call('GET', `/lottery/counter-snapshot?date=${ds}`);
    const boxes = r.data?.boxes || [];
    console.log(`  ${ds} (T-${i}): ${boxes.length} book(s) on counter`);
    boxes.slice(0, 3).forEach(b => {
      console.log(`     ${b.game?.gameNumber}-${b.boxNumber}: opening=${b.openingTicket} current=${b.currentTicket}`);
    });
  }

  console.log('\n=== Online totals across the seeded window ===\n');
  for (let i = 7; i >= 1; i--) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - i);
    const ds = isoDate(d);
    const r = await call('GET', `/lottery/online-total?date=${ds}`);
    const o = r.data?.data || {};
    if (!o.id) { console.log(`  ${ds}: (no record)`); continue; }
    console.log(`  ${ds}: machineSales=$${o.machineSales} machineCashing=$${o.machineCashing} instantCashing=$${o.instantCashing}`);
  }

  console.log('\n=== Report endpoint (/lottery/report) over seeded window ===\n');
  const from = isoDate(new Date(today.getTime() - 7 * 86400000));
  const to   = isoDate(new Date(today.getTime() - 86400000));
  const rep  = await call('GET', `/lottery/report?from=${from}&to=${to}`);
  if (rep.ok) {
    const d = rep.data;
    console.log(`  Range: ${from} → ${to}`);
    console.log(`  totalSales=$${d.totalSales} posSales=$${d.posSales} unreported=$${d.unreported} totalPayouts=$${d.totalPayouts} netRevenue=$${d.netRevenue}`);
    if (Array.isArray(d.chart)) {
      console.log(`  ${d.chart.length} daily bucket(s) returned:`);
      d.chart.forEach(x => console.log(`     ${x.date}: sales=$${x.sales} payouts=$${x.payouts}`));
    }
    if (Array.isArray(d.byGame)) {
      console.log(`  ${d.byGame.length} game(s) in breakdown:`);
      d.byGame.forEach(g => console.log(`     ${g.gameName}: sales=$${g.sales} count=${g.count}`));
    }
  } else {
    console.log(`  ERROR ${rep.status}: ${JSON.stringify(rep.data).slice(0, 200)}`);
  }

  console.log('\n=== Dashboard endpoint (/lottery/dashboard) — month-to-date ===\n');
  const dash = await call('GET', '/lottery/dashboard');
  if (dash.ok) {
    const d = dash.data;
    console.log(`  totalSales=$${d.totalSales} posSales=$${d.posSales} unreported=$${d.unreported} payouts=$${d.totalPayouts}`);
    console.log(`  netRevenue=$${d.netRevenue} commission=$${d.commission?.toFixed(2)} activeBoxes=${d.activeBoxes} inventoryBoxes=${d.inventoryBoxes}`);
  } else {
    console.log(`  ERROR ${dash.status}: ${JSON.stringify(dash.data).slice(0, 200)}`);
  }

  console.log('\n=== Weekly settlement endpoint (/lottery/settlements/:weekStart) ===\n');
  const recent = await call('GET', '/lottery/settlements');
  const weeks  = (recent.ok && recent.data?.data) ? recent.data.data : [];
  console.log(`  ${weeks.length} recent week(s) returned (status ${recent.status})`);
  weeks.slice(0, 4).forEach(w => {
    const ws = (typeof w.weekStart === 'string' ? w.weekStart : w.weekStart.toISOString()).slice(0, 10);
    const we = (typeof w.weekEnd   === 'string' ? w.weekEnd   : w.weekEnd.toISOString()).slice(0, 10);
    console.log(`     ${ws} → ${we}: instantSales=$${w.instantSales || 0} machineSales=$${w.onlineGross || 0} commission=$${w.totalCommission || 0} payable=$${w.weeklyPayable || 0}`);
  });
  // Drill into the week with the seeded data
  const target = weeks.find(w => Number(w.instantSales || 0) > 0) || weeks[0];
  if (target) {
    const ws = (typeof target.weekStart === 'string' ? target.weekStart : target.weekStart.toISOString()).slice(0, 10);
    const detail = await call('GET', `/lottery/settlements/${ws}`);
    if (detail.ok) {
      const d = detail.data?.data || detail.data;
      console.log(`  --- detail for week ${ws} ---`);
      console.log(`     instantSales=$${d.instantSales} scratchPayouts=$${d.scratchPayouts}`);
      console.log(`     onlineGross=$${d.onlineGross} machineCashing=$${d.machineCashing} instantCashingDrawer=$${d.instantCashingDrawer}`);
      console.log(`     totalCommission=$${d.totalCommission} returnsDeduction=$${d.returnsDeduction}`);
      console.log(`     weeklyGross=$${d.weeklyGross} weeklyNet=$${d.weeklyNet} weeklyPayable=$${d.weeklyPayable}`);
      console.log(`     status=${d.status} persisted=${d.persisted}`);
    } else {
      console.log(`     ERROR ${detail.status}: ${JSON.stringify(detail.data).slice(0, 200)}`);
    }
  }

  console.log('\n=== Commission endpoint (/lottery/commission) — month-to-date ===\n');
  const com = await call('GET', `/lottery/commission?from=${from}&to=${to}`);
  if (com.ok) {
    const d = com.data;
    console.log(`  totalSales=$${d.totalSales?.toFixed(2)} totalCommission=$${d.totalCommission?.toFixed(2)} avgRate=${(d.avgRate * 100).toFixed(2)}%`);
    if (Array.isArray(d.byGame)) {
      const non0 = d.byGame.filter(g => g.sales > 0);
      console.log(`  ${non0.length} game(s) with sales (of ${d.byGame.length} total):`);
      non0.forEach(g => console.log(`     ${g.gameName}: sales=$${g.sales} commission=$${g.commission?.toFixed(2)} rate=${(g.rate * 100).toFixed(1)}%`));
    }
  } else {
    console.log(`  ERROR ${com.status}: ${JSON.stringify(com.data).slice(0, 200)}`);
  }
})();
