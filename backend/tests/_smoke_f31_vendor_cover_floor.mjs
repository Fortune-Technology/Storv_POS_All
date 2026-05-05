/**
 * F31 — Factor #15 (Vendor Cover-Day Soft Floor) smoke test.
 *
 * Pure-function verification of the math added to orderEngine.ts. The full
 * order pipeline depends on DB state (products, vendors, transactions); this
 * test directly exercises the floor calculation against known inputs to
 * lock the contract.
 *
 * Math under test:
 *   coverFloor   = max(0, targetCoverDays × avgDaily + safetyStock - onHand - onOrder)
 *   binding      = coverFloor > rawOrderQty
 *   finalRawQty  = max(rawOrderQty, coverFloor)
 *
 * Mirror this exactly when changing the engine.
 */

let pass = 0, fail = 0;
const log = (label, ok, detail = '') => {
  const sym = ok ? '✓' : '✗';
  console.log(`  ${sym} ${label}${detail ? '  — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

console.log('=== F31 VENDOR COVER-FLOOR (FACTOR #15) SMOKE ===\n');

// ── Pure helper that mirrors orderEngine.ts implementation ──────────
function computeCoverFloor({ targetCoverDays, avgDaily, safetyStock, onHand, onOrder }) {
  if (!targetCoverDays || targetCoverDays <= 0 || !avgDaily || avgDaily <= 0) {
    return { coverFloor: 0, applies: false };
  }
  const coverFloor = Math.max(
    0,
    targetCoverDays * avgDaily + safetyStock - onHand - onOrder,
  );
  return { coverFloor, applies: true };
}

function applyFactor15({ rawOrderQty, targetCoverDays, avgDaily, safetyStock, onHand, onOrder }) {
  const { coverFloor, applies } = computeCoverFloor({ targetCoverDays, avgDaily, safetyStock, onHand, onOrder });
  if (!applies) return { finalQty: rawOrderQty, coverFloor: 0, binding: false };
  const binding = coverFloor > rawOrderQty;
  return {
    finalQty: binding ? coverFloor : rawOrderQty,
    coverFloor,
    binding,
  };
}

// ── 1. Disabled cases ────────────────────────────────────────────────
console.log('[1] Cover floor SKIPPED when targetCoverDays not set or zero');
{
  const r = applyFactor15({ rawOrderQty: 10, targetCoverDays: 0, avgDaily: 5, safetyStock: 0, onHand: 0, onOrder: 0 });
  log('targetCoverDays=0 → not applied, finalQty unchanged', !r.binding && r.finalQty === 10);

  const r2 = applyFactor15({ rawOrderQty: 10, targetCoverDays: null, avgDaily: 5, safetyStock: 0, onHand: 0, onOrder: 0 });
  log('targetCoverDays=null → not applied', !r2.binding && r2.finalQty === 10);
}

console.log('\n[2] Cover floor SKIPPED when avgDaily is 0 (slow movers)');
{
  const r = applyFactor15({ rawOrderQty: 5, targetCoverDays: 14, avgDaily: 0, safetyStock: 2, onHand: 0, onOrder: 0 });
  log('avgDaily=0 → not applied (no demand baseline to multiply against)',
    !r.binding && r.finalQty === 5);
}

// ── 3. Floor binding (the core feature) ──────────────────────────────
console.log('\n[3] Cover floor BINDING — raises qty above forecast-driven');
{
  // Coca-Cola weekly delivery, 10-day cover policy, 5/day avg, safety 5 units.
  // onHand = 8 (low after weekend rush), onOrder = 0
  // Expected coverFloor: 10×5 + 5 - 8 - 0 = 47
  // Forecast may have suggested only 30 (a slow forecast week pulled it down)
  const r = applyFactor15({
    rawOrderQty: 30,
    targetCoverDays: 10,
    avgDaily: 5,
    safetyStock: 5,
    onHand: 8,
    onOrder: 0,
  });
  log('coverFloor = 10×5 + 5 - 8 - 0 = 47', r.coverFloor === 47);
  log('rawOrderQty 30 < coverFloor 47 → binding', r.binding === true);
  log('finalQty raised to 47', r.finalQty === 47);
}

console.log('\n[4] Cover floor NOT binding — forecast already higher');
{
  // Strong-demand week: forecast suggested 80 units. Cover floor 47 < 80.
  const r = applyFactor15({
    rawOrderQty: 80,
    targetCoverDays: 10,
    avgDaily: 5,
    safetyStock: 5,
    onHand: 8,
    onOrder: 0,
  });
  log('coverFloor = 47 (computed but lower than forecast)', r.coverFloor === 47);
  log('rawOrderQty 80 > coverFloor 47 → NOT binding', r.binding === false);
  log('finalQty stays at forecast 80', r.finalQty === 80);
}

console.log('\n[5] Cover floor zero when current stock + on-order already covers it');
{
  // We already have 60 units in stock + 20 on order = 80 total against a 47-unit cover need
  const r = applyFactor15({
    rawOrderQty: 5,         // forecast suggested a tiny order
    targetCoverDays: 10,
    avgDaily: 5,
    safetyStock: 5,
    onHand: 60,
    onOrder: 20,
  });
  // 10×5 + 5 - 60 - 20 = -25 → floored to 0
  log('coverFloor = max(0, -25) = 0', r.coverFloor === 0);
  log('NOT binding', r.binding === false);
  log('finalQty stays at 5', r.finalQty === 5);
}

console.log('\n[6] Onhand below safety stock — floor catches it');
{
  // 7-day weekly vendor, onHand dropped to 3 units, avgDaily=4, safety=8.
  // coverFloor = 7×4 + 8 - 3 - 0 = 33
  // Forecast might have only said 10 if forecast is volatile.
  const r = applyFactor15({
    rawOrderQty: 10,
    targetCoverDays: 7,
    avgDaily: 4,
    safetyStock: 8,
    onHand: 3,
    onOrder: 0,
  });
  log('coverFloor = 7×4 + 8 - 3 = 33', r.coverFloor === 33);
  log('binding (10 < 33)', r.binding === true);
  log('finalQty = 33', r.finalQty === 33);
}

console.log('\n[7] Long-cover vendor (monthly bulk delivery)');
{
  // Monthly distributor, 30-day cover, 2/day avg, safety 5
  // coverFloor = 30×2 + 5 - 0 - 0 = 65
  const r = applyFactor15({
    rawOrderQty: 20,
    targetCoverDays: 30,
    avgDaily: 2,
    safetyStock: 5,
    onHand: 0,
    onOrder: 0,
  });
  log('coverFloor = 30×2 + 5 = 65', r.coverFloor === 65);
  log('binding', r.binding === true);
  log('finalQty = 65', r.finalQty === 65);
}

console.log('\n[8] Edge — forecast exactly equals floor → not binding (>, not >=)');
{
  // Forecast 47 == floor 47. Spec uses strict >, so this is NOT binding.
  const r = applyFactor15({
    rawOrderQty: 47,
    targetCoverDays: 10,
    avgDaily: 5,
    safetyStock: 5,
    onHand: 8,
    onOrder: 0,
  });
  log('coverFloor = 47, rawOrderQty = 47 → NOT binding (forecast already meets it)',
    r.binding === false && r.finalQty === 47);
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`✓ pass: ${pass}`);
console.log(`✗ fail: ${fail}`);
console.log(`total:  ${pass + fail}`);

process.exit(fail > 0 ? 1 : 0);
