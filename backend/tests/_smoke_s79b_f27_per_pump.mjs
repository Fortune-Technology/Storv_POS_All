/**
 * S79b (F27) — Per-pump fuel reports + alphanumeric pumpNumber smoke.
 *
 * Pure-function verification:
 *   1. Pump-number validator (mirrors fuelController.normalizePumpNumber):
 *      - Accepts alphanumeric labels: "1", "A1", "Diesel-1", "Out_front"
 *      - Rejects spaces, punctuation, empty, > 16 chars
 *      - Coerces legacy integer input ("5" or 5 → "5")
 *   2. Per-pump aggregation (mirrors getFuelReport's byPump grouping):
 *      - Groups FuelTransaction rows by pumpId
 *      - Splits sales / refunds correctly per pump
 *      - Computes net = sales − refunds
 *      - avgPrice = netAmount / netGallons (or 0 when no net gallons)
 *      - Sorts by netAmount desc
 *      - Skips null pumpId rows but increments unattributedCount
 *      - Empty input → empty pumpRows + unattributedCount=0
 *
 * Mirror exactly. If a controller change breaks the contract, either fix
 * the controller OR update this test — both are explicit signals.
 */

let pass = 0, fail = 0;
const log = (label, ok, detail = '') => {
  const sym = ok ? '✓' : '✗';
  console.log(`  ${sym} ${label}${detail ? '  — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

console.log('=== S79b (F27) PER-PUMP REPORTS + ALPHANUMERIC PUMP NUMBER SMOKE ===\n');

// ── Mirror of fuelController.normalizePumpNumber ─────────────────────
const PUMP_NUMBER_RE = /^[A-Za-z0-9_-]{1,16}$/;
function normalizePumpNumber(input) {
  if (input === null || input === undefined || input === '') {
    return { ok: false, error: 'pumpNumber required' };
  }
  const raw = typeof input === 'number' ? String(input) : String(input).trim();
  if (!PUMP_NUMBER_RE.test(raw)) {
    return { ok: false, error: 'pumpNumber must be 1–16 alphanumeric chars (letters, digits, dash, underscore)' };
  }
  return { ok: true, value: raw };
}

// ── 1. Pump number validation ───────────────────────────────────────
console.log('[1] Pump number validation');
{
  // Accepted forms
  log('integer "1"',                normalizePumpNumber('1').ok            && normalizePumpNumber('1').value === '1');
  log('two-digit "12"',              normalizePumpNumber('12').ok           && normalizePumpNumber('12').value === '12');
  log('alpha-prefix "A1"',           normalizePumpNumber('A1').ok           && normalizePumpNumber('A1').value === 'A1');
  log('lowercase "diesel"',          normalizePumpNumber('diesel').ok       && normalizePumpNumber('diesel').value === 'diesel');
  log('with dash "Diesel-1"',        normalizePumpNumber('Diesel-1').ok     && normalizePumpNumber('Diesel-1').value === 'Diesel-1');
  log('with underscore "Out_front"', normalizePumpNumber('Out_front').ok    && normalizePumpNumber('Out_front').value === 'Out_front');
  log('mixed alphanumeric "P12B"',   normalizePumpNumber('P12B').ok         && normalizePumpNumber('P12B').value === 'P12B');
  log('exactly 16 chars',            normalizePumpNumber('a'.repeat(16)).ok && normalizePumpNumber('a'.repeat(16)).value.length === 16);

  // Coercion of legacy callers
  log('integer literal 5 → "5"',     normalizePumpNumber(5).ok              && normalizePumpNumber(5).value === '5');
  log('integer literal 1 → "1"',     normalizePumpNumber(1).ok              && normalizePumpNumber(1).value === '1');
  log('integer literal 100 → "100"', normalizePumpNumber(100).ok            && normalizePumpNumber(100).value === '100');

  // Whitespace trimming
  log('trims leading/trailing space "  A1  "',
    normalizePumpNumber('  A1  ').ok && normalizePumpNumber('  A1  ').value === 'A1');

  // Rejected forms
  log('reject empty string',          !normalizePumpNumber('').ok);
  log('reject null',                  !normalizePumpNumber(null).ok);
  log('reject undefined',             !normalizePumpNumber(undefined).ok);
  log('reject only spaces',           !normalizePumpNumber('   ').ok);
  log('reject space inside "A 1"',    !normalizePumpNumber('A 1').ok);
  log('reject slash "Diesel/1"',      !normalizePumpNumber('Diesel/1').ok);
  log('reject dot "1.0"',             !normalizePumpNumber('1.0').ok);
  log('reject quote "\\"A1\\""',      !normalizePumpNumber('"A1"').ok);
  log('reject 17 chars',              !normalizePumpNumber('a'.repeat(17)).ok);
  log('reject special char @',        !normalizePumpNumber('A@1').ok);
  log('reject emoji',                 !normalizePumpNumber('🚗').ok);
}

// ── Mirror of getFuelReport's byPump aggregation ─────────────────────
function aggregateByPump(transactions) {
  const byPump = new Map();
  let unattributedCount = 0;

  for (const t of transactions) {
    if (!t.pumpId) {
      unattributedCount += 1;
      continue;
    }
    if (!byPump.has(t.pumpId)) {
      byPump.set(t.pumpId, {
        pumpId:        t.pumpId,
        pumpNumber:    t.pump?.pumpNumber ?? null,
        label:         t.pump?.label ?? null,
        color:         t.pump?.color ?? null,
        salesGallons:  0, salesAmount:  0, salesCount:  0,
        refundsGallons:0, refundsAmount:0, refundsCount:0,
        netGallons:    0, netAmount:    0,
        avgPrice:      0,
      });
    }
    const row = byPump.get(t.pumpId);
    const gal = Number(t.gallons);
    const amt = Number(t.amount);
    if (t.type === 'refund') {
      row.refundsGallons += gal;
      row.refundsAmount  += amt;
      row.refundsCount   += 1;
    } else {
      row.salesGallons   += gal;
      row.salesAmount    += amt;
      row.salesCount     += 1;
    }
  }

  const rows = Array.from(byPump.values()).map((r) => {
    r.netGallons = r.salesGallons - r.refundsGallons;
    r.netAmount  = r.salesAmount  - r.refundsAmount;
    r.avgPrice   = r.netGallons > 0 ? r.netAmount / r.netGallons : 0;
    return r;
  }).sort((a, b) => b.netAmount - a.netAmount);

  return { rows, unattributedCount };
}

// ── 2. Per-pump aggregation — happy path ────────────────────────────
console.log('\n[2] Per-pump aggregation — basic sales');
{
  const txs = [
    { pumpId: 'p1', pump: { pumpNumber: '1', label: 'Front',  color: '#dc2626' }, gallons: 10, amount: 35.00, type: 'sale' },
    { pumpId: 'p1', pump: { pumpNumber: '1', label: 'Front',  color: '#dc2626' }, gallons:  5, amount: 17.50, type: 'sale' },
    { pumpId: 'p2', pump: { pumpNumber: 'A1',label: 'Side',   color: '#16a34a' }, gallons:  8, amount: 28.00, type: 'sale' },
    { pumpId: 'p2', pump: { pumpNumber: 'A1',label: 'Side',   color: '#16a34a' }, gallons:  2, amount:  7.00, type: 'refund' },
  ];
  const { rows, unattributedCount } = aggregateByPump(txs);

  log('2 pumps in result',         rows.length === 2);
  log('zero unattributed',          unattributedCount === 0);

  // Pump 1 — 2 sales, 0 refunds, total 15 gal / $52.50
  const p1 = rows.find(r => r.pumpId === 'p1');
  log('Pump 1: pumpNumber="1"',    p1.pumpNumber === '1');
  log('Pump 1: salesGallons = 15', p1.salesGallons === 15);
  log('Pump 1: salesAmount = 52.5',p1.salesAmount === 52.5);
  log('Pump 1: salesCount = 2',    p1.salesCount === 2);
  log('Pump 1: refundsCount = 0',  p1.refundsCount === 0);
  log('Pump 1: netGallons = 15',   p1.netGallons === 15);
  log('Pump 1: netAmount = 52.5',  p1.netAmount === 52.5);
  log('Pump 1: avgPrice = 3.50',   Math.abs(p1.avgPrice - 3.50) < 0.001);

  // Pump 2 (alphanumeric ID) — 1 sale + 1 refund
  const p2 = rows.find(r => r.pumpId === 'p2');
  log('Pump 2: pumpNumber="A1"',     p2.pumpNumber === 'A1');
  log('Pump 2: salesGallons = 8',    p2.salesGallons === 8);
  log('Pump 2: refundsGallons = 2',  p2.refundsGallons === 2);
  log('Pump 2: netGallons = 6',      p2.netGallons === 6);
  log('Pump 2: netAmount = 21',      p2.netAmount === 21);
  log('Pump 2: avgPrice = 3.50',     Math.abs(p2.avgPrice - 3.50) < 0.001);

  // Sort order: descending netAmount → Pump 1 ($52.50) before Pump 2 ($21)
  log('sorted by netAmount desc',  rows[0].pumpId === 'p1' && rows[1].pumpId === 'p2');
}

// ── 3. unattributedCount ─────────────────────────────────────────────
console.log('\n[3] Unattributed transactions (pumpId = null)');
{
  const txs = [
    { pumpId: null, pump: null, gallons: 10, amount: 35, type: 'sale' },
    { pumpId: null, pump: null, gallons:  5, amount: 17.50, type: 'sale' },
    { pumpId: 'p1', pump: { pumpNumber: '1' }, gallons: 8, amount: 28, type: 'sale' },
  ];
  const { rows, unattributedCount } = aggregateByPump(txs);
  log('unattributed count = 2', unattributedCount === 2);
  log('1 pump row (only attributed tx)', rows.length === 1);
  log('attributed tx total = 8 gal',     rows[0].salesGallons === 8);
}

// ── 4. Edge: only refunds → negative net ────────────────────────────
console.log('\n[4] Net-negative pump (refunds exceed sales)');
{
  const txs = [
    { pumpId: 'p1', pump: { pumpNumber: '1' }, gallons: 5, amount: 20, type: 'refund' },
    { pumpId: 'p1', pump: { pumpNumber: '1' }, gallons: 2, amount:  8, type: 'sale' },
  ];
  const { rows } = aggregateByPump(txs);
  log('netGallons = -3',  rows[0].netGallons === -3);
  log('netAmount = -12',  rows[0].netAmount === -12);
  log('avgPrice = 0 when netGallons <= 0', rows[0].avgPrice === 0);
}

// ── 5. Edge: empty input ─────────────────────────────────────────────
console.log('\n[5] Empty + null edge cases');
{
  const e1 = aggregateByPump([]);
  log('empty array → empty rows',                       e1.rows.length === 0);
  log('empty array → unattributedCount = 0',            e1.unattributedCount === 0);

  const e2 = aggregateByPump([{ pumpId: null, gallons: 0, amount: 0, type: 'sale' }]);
  log('all null pumpId → empty rows + unattributedCount=1',
    e2.rows.length === 0 && e2.unattributedCount === 1);
}

// ── 6. Sort stability — ties broken by insertion order ──────────────
console.log('\n[6] Sort by netAmount descending');
{
  const txs = [
    { pumpId: 'big',    pump: { pumpNumber: '99' }, gallons: 100, amount: 350, type: 'sale' },
    { pumpId: 'small',  pump: { pumpNumber: '1'  }, gallons:  10, amount:  35, type: 'sale' },
    { pumpId: 'medium', pump: { pumpNumber: 'A1' }, gallons:  50, amount: 175, type: 'sale' },
  ];
  const { rows } = aggregateByPump(txs);
  log('biggest first',   rows[0].pumpId === 'big');
  log('medium second',   rows[1].pumpId === 'medium');
  log('smallest last',   rows[2].pumpId === 'small');
}

// ── 7. Mixed pumpNumber formats coexist ──────────────────────────────
console.log('\n[7] Mixed alphanumeric pumpNumber formats coexist');
{
  // Real-world scenario: store has pumps "1", "2", "A1", "Diesel-1"
  const txs = [
    { pumpId: 'p1', pump: { pumpNumber: '1' },        gallons: 5, amount: 17.50, type: 'sale' },
    { pumpId: 'p2', pump: { pumpNumber: '2' },        gallons: 5, amount: 17.50, type: 'sale' },
    { pumpId: 'p3', pump: { pumpNumber: 'A1' },       gallons: 5, amount: 17.50, type: 'sale' },
    { pumpId: 'p4', pump: { pumpNumber: 'Diesel-1' }, gallons: 5, amount: 17.50, type: 'sale' },
  ];
  const { rows } = aggregateByPump(txs);
  log('4 pumps in result', rows.length === 4);
  log('all 4 pumpNumbers preserved as strings',
    rows.map(r => r.pumpNumber).sort().join('|') === '1|2|A1|Diesel-1');

  // No NaN / no implicit numeric coercion
  log('no row has NaN netAmount', rows.every(r => Number.isFinite(r.netAmount)));
  log('alphanumeric pumpNumber "Diesel-1" preserved verbatim',
    rows.find(r => r.pumpId === 'p4').pumpNumber === 'Diesel-1');
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`✓ pass: ${pass}`);
console.log(`✗ fail: ${fail}`);
console.log(`total:  ${pass + fail}`);

process.exit(fail > 0 ? 1 : 0);
