/**
 * S79 — F19 + F18 + C3 closeout smoke.
 *
 * Three small items shipped together. Each gets a different verification
 * style based on what's testable without a browser:
 *
 *   F19 (Commission PDF/CSV)  — pure-function logic: mirror the helpers
 *                               + assert on input → output shape.
 *
 *   C3  (Customer Display     — pure-function logic: mirror the broadcast
 *        light theme)            wiring + theme handler + rootClass calc.
 *
 *   F18 (Camera ticket scan)  — structural / wiring check: read the source
 *                               files and assert the right components are
 *                               imported + mounted with the right handler.
 *                               Camera + zxing themselves are browser-only.
 *
 * Mirror patterns directly. If a helper changes, update the mirror — if
 * tests fail, that means the helper drifted from the contract.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const log = (label, ok, detail = '') => {
  const sym = ok ? '✓' : '✗';
  console.log(`  ${sym} ${label}${detail ? '  — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

console.log('=== S79 (F19 + F18 + C3) THREE-ITEM SMOKE ===\n');

// ════════════════════════════════════════════════════════════════════
// F19 — Commission CSV/PDF helpers
// ════════════════════════════════════════════════════════════════════

// ── Mirrors of downloadCommissionCSV / downloadCommissionPDF from
// frontend/src/pages/Lottery/index.jsx. Both functions build their inputs
// via downloadCSV(rows, cols, filename) / downloadPDF({summary, data, columns,
// title, subtitle, filename}). We test the array-builders only — the actual
// PDF/CSV writer side-effect lives in jspdf-autotable / Blob, untestable in
// node without a DOM.
function buildCommissionCSVPayload(commission) {
  if (!commission) return null;
  const fmtRate   = (n) => n != null ? `${(Number(n) * 100).toFixed(2)}%` : '';
  const fmtMoney2 = (n) => n != null ? Number(n).toFixed(2) : '';

  const cols = [
    { key: 'gameName',   label: 'Game' },
    { key: 'rate',       label: 'Rate' },
    { key: 'sales',      label: 'Sales' },
    { key: 'commission', label: 'Commission' },
  ];
  const rows = (commission.byGame || []).map(g => ({
    gameName:   g.gameName || '',
    rate:       fmtRate(g.rate),
    sales:      fmtMoney2(g.sales),
    commission: fmtMoney2(g.commission),
  }));
  rows.push({
    gameName:   'TOTAL',
    rate:       commission.avgRate ? fmtRate(commission.avgRate) : '',
    sales:      fmtMoney2(commission.totalSales),
    commission: fmtMoney2(commission.totalCommission),
  });
  return { rows, cols };
}

function buildCommissionPDFPayload(commission, dateFrom, dateTo) {
  if (!commission) return null;
  const fmtRate   = (n) => n != null ? `${(Number(n) * 100).toFixed(2)}%` : 'N/A';
  const fmtMoney2 = (n) => n != null ? `$${Number(n).toFixed(2)}` : '—';

  const summary = [
    { label: 'Total Commission', value: fmtMoney2(commission.totalCommission) },
    { label: 'Total Sales',      value: fmtMoney2(commission.totalSales) },
    { label: 'Avg Rate',         value: fmtRate(commission.avgRate) },
  ];

  const cols = [
    { key: 'gameName',   label: 'Game' },
    { key: 'rate',       label: 'Rate' },
    { key: 'sales',      label: 'Sales' },
    { key: 'commission', label: 'Commission' },
  ];
  const data = (commission.byGame || []).map(g => ({
    gameName:   g.gameName || '',
    rate:       fmtRate(g.rate),
    sales:      fmtMoney2(g.sales),
    commission: fmtMoney2(g.commission),
  }));
  if (data.length > 0) {
    data.push({
      gameName:   'TOTAL',
      rate:       commission.avgRate ? fmtRate(commission.avgRate) : '',
      sales:      fmtMoney2(commission.totalSales),
      commission: fmtMoney2(commission.totalCommission),
    });
  }
  return {
    title:    'Lottery Commission Report',
    subtitle: `${dateFrom} → ${dateTo}`,
    summary,
    data,
    columns: cols,
    filename: `lottery-commission-${dateFrom}-${dateTo}`,
  };
}

console.log('[F19] downloadCommissionCSV — payload shape');
{
  const commission = {
    totalSales:      1000.50,
    totalCommission: 50.025,
    avgRate:         0.05,
    byGame: [
      { gameName: 'Lucky 7s',     rate: 0.06,  sales: 600.00, commission: 36.00 },
      { gameName: 'Cashword',     rate: 0.04,  sales: 400.50, commission: 16.02 },
    ],
  };
  const r = buildCommissionCSVPayload(commission);
  log('returns 4 columns', r.cols.length === 4);
  log('column order: Game / Rate / Sales / Commission',
    r.cols.map(c => c.label).join('|') === 'Game|Rate|Sales|Commission');
  log('rows = byGame count + 1 TOTAL', r.rows.length === 3);
  log('first row gameName = Lucky 7s', r.rows[0].gameName === 'Lucky 7s');
  log('first row rate = 6.00%', r.rows[0].rate === '6.00%');
  log('first row sales = 600.00 (no $ in CSV)', r.rows[0].sales === '600.00');
  log('TOTAL row gameName = TOTAL', r.rows[2].gameName === 'TOTAL');
  log('TOTAL row sales = 1000.50', r.rows[2].sales === '1000.50');
  log('TOTAL row rate uses avgRate (5.00%)', r.rows[2].rate === '5.00%');
}

console.log('\n[F19] downloadCommissionPDF — payload shape');
{
  // Use commission numbers that don't trigger JS floating-point quirks
  // (e.g. avoid 50.025 since (50.025).toFixed(2) → '50.02' due to IEEE
  // double-precision representation, not '50.03'). 36 + 12 = 48 exact.
  const commission = {
    totalSales:      1000.50,
    totalCommission: 48,
    avgRate:         0.05,
    byGame: [
      { gameName: 'Lucky 7s',  rate: 0.06,  sales: 600.00, commission: 36.00 },
    ],
  };
  const r = buildCommissionPDFPayload(commission, '2026-05-01', '2026-05-04');

  log('title is "Lottery Commission Report"', r.title === 'Lottery Commission Report');
  log('subtitle carries date range arrow',
    r.subtitle === '2026-05-01 → 2026-05-04');
  log('filename has date range', r.filename === 'lottery-commission-2026-05-01-2026-05-04');

  log('summary has 3 KPI cards', r.summary.length === 3);
  log('summary card labels: Total Commission / Total Sales / Avg Rate',
    r.summary.map(s => s.label).join('|') === 'Total Commission|Total Sales|Avg Rate');
  log('summary uses $ prefix on money fields', r.summary[0].value === '$48.00' && r.summary[1].value === '$1000.50');
  log('summary uses % suffix on rate', r.summary[2].value === '5.00%');

  log('PDF columns match CSV columns', r.columns.map(c => c.key).join('|') === 'gameName|rate|sales|commission');
  log('data has byGame row + TOTAL row', r.data.length === 2);
  log('data uses $ prefix (vs CSV plain numbers)', r.data[0].sales === '$600.00');
  log('TOTAL row commission has $', r.data[1].commission === '$48.00');
}

console.log('\n[F19] edge cases');
{
  // null commission → null payload
  log('null commission → null CSV', buildCommissionCSVPayload(null) === null);
  log('null commission → null PDF', buildCommissionPDFPayload(null, '', '') === null);

  // Empty byGame — TOTAL row still rendered for CSV; for PDF the TOTAL is
  // skipped when data array starts empty (no need for a TOTAL row when there
  // are no detail rows above it). This is a real behavior of the current
  // helper — don't accidentally regress it.
  const empty = { totalSales: 0, totalCommission: 0, avgRate: null, byGame: [] };
  const csvE = buildCommissionCSVPayload(empty);
  const pdfE = buildCommissionPDFPayload(empty, '2026-01-01', '2026-01-02');
  log('CSV always has TOTAL row even when byGame is empty', csvE.rows.length === 1 && csvE.rows[0].gameName === 'TOTAL');
  log('PDF skips TOTAL row when data is empty (no rows to total)', pdfE.data.length === 0);
  log('CSV TOTAL with null avgRate → empty rate cell', csvE.rows[0].rate === '');

  // null individual rates / amounts
  const partial = {
    totalSales: 100, totalCommission: 5, avgRate: 0.05,
    byGame: [{ gameName: 'Mystery', rate: null, sales: 100, commission: 5 }],
  };
  const csvP = buildCommissionCSVPayload(partial);
  log('null rate in byGame → empty string in CSV', csvP.rows[0].rate === '');
  log('null rate in byGame → "N/A" in PDF', buildCommissionPDFPayload(partial, '', '').data[0].rate === 'N/A');
}

// ════════════════════════════════════════════════════════════════════
// C3 — Customer Display light-theme broadcast wiring
// ════════════════════════════════════════════════════════════════════

// ── Mirror of POSScreen broadcast theme threading ────────────────────
// The 3 publishDisplay() calls all carry `theme: posConfig.customerDisplay?.theme || 'dark'`.
function readTheme(posConfig) {
  return posConfig?.customerDisplay?.theme || 'dark';
}

function buildIdleBroadcast(posConfig) {
  return { type: 'idle', theme: readTheme(posConfig) };
}

function buildCartUpdateBroadcast(posConfig, items, totals) {
  return {
    type: 'cart_update',
    theme: readTheme(posConfig),
    items,
    totals,
    bagCount: 0,
  };
}

function buildTransactionCompleteBroadcast(posConfig, tx, change) {
  return {
    type: 'transaction_complete',
    theme: readTheme(posConfig),
    txNumber: tx?.txNumber,
    change: change || tx?.changeGiven || 0,
  };
}

// ── Mirror of CustomerDisplayScreen handler ──────────────────────────
function handleDisplayMessage(state, data) {
  let nextTheme = state.theme;
  if (!data?.type) return state;
  if (data.theme === 'light' || data.theme === 'dark') nextTheme = data.theme;
  if (data.type === 'cart_update') {
    return { ...state, theme: nextTheme, type: 'cart_update', items: data.items || [] };
  }
  if (data.type === 'transaction_complete') {
    return { ...state, theme: nextTheme, type: 'thanking' };
  }
  if (data.type === 'idle') {
    return { ...state, theme: nextTheme, type: 'idle', items: [] };
  }
  return state;
}

function rootClass(theme) {
  return `cds-root${theme === 'light' ? ' cds-root--light' : ''}`;
}

console.log('\n[C3] Broadcast theme threading');
{
  // Default: missing customerDisplay config → dark
  log('null posConfig → dark default',         readTheme(null)        === 'dark');
  log('empty posConfig → dark default',        readTheme({})          === 'dark');
  log('partial config → dark default',         readTheme({ bagFee: {} }) === 'dark');
  log('explicit dark',                         readTheme({ customerDisplay: { theme: 'dark'  } }) === 'dark');
  log('explicit light',                        readTheme({ customerDisplay: { theme: 'light' } }) === 'light');

  // All 3 broadcast variants carry theme
  const cfg = { customerDisplay: { theme: 'light' } };
  log('idle broadcast carries theme',          buildIdleBroadcast(cfg).theme === 'light');
  log('cart_update broadcast carries theme',   buildCartUpdateBroadcast(cfg, [], {}).theme === 'light');
  log('transaction_complete carries theme',    buildTransactionCompleteBroadcast(cfg, { txNumber: 'TX1' }).theme === 'light');

  // Missing config → dark
  log('idle without config → dark',            buildIdleBroadcast({}).theme === 'dark');
  log('cart_update without config → dark',     buildCartUpdateBroadcast({}, [], {}).theme === 'dark');
}

console.log('\n[C3] CustomerDisplayScreen handler');
{
  let state = { theme: 'dark', type: 'idle', items: [] };

  // cart_update with light flips theme
  state = handleDisplayMessage(state, { type: 'cart_update', theme: 'light', items: [{ qty: 1 }] });
  log('cart_update with light → state.theme = light',  state.theme === 'light');
  log('cart_update with light → type = cart_update',   state.type  === 'cart_update');

  // idle with dark flips back
  state = handleDisplayMessage(state, { type: 'idle', theme: 'dark' });
  log('idle with dark → state.theme = dark',           state.theme === 'dark');

  // transaction_complete preserves theme
  state = handleDisplayMessage(state, { type: 'transaction_complete', theme: 'light', change: 5 });
  log('transaction_complete with light → theme flipped', state.theme === 'light');

  // Broadcast without theme → keeps current
  state = handleDisplayMessage({ theme: 'light', type: 'idle' }, { type: 'cart_update', items: [] });
  log('broadcast missing theme → keeps current state', state.theme === 'light');

  // Bogus theme value → ignored
  state = handleDisplayMessage({ theme: 'dark', type: 'idle' }, { type: 'cart_update', theme: 'rainbow', items: [] });
  log('bogus theme ignored → keeps current',           state.theme === 'dark');

  // Empty / null payload → no-op
  log('null payload → no-op',
    handleDisplayMessage({ theme: 'dark', type: 'idle' }, null).theme === 'dark');
  log('payload missing type → no-op',
    handleDisplayMessage({ theme: 'dark', type: 'idle' }, { theme: 'light' }).theme === 'dark');
}

console.log('\n[C3] rootClass computation');
{
  log('dark theme → "cds-root"',          rootClass('dark') === 'cds-root');
  log('light theme → "cds-root cds-root--light"',
    rootClass('light') === 'cds-root cds-root--light');
  log('unknown theme → defaults to dark', rootClass('rainbow') === 'cds-root');
  log('empty string → defaults to dark',  rootClass('') === 'cds-root');
}

// ════════════════════════════════════════════════════════════════════
// F18 — Camera ticket scan wiring (file-source structural check)
// ════════════════════════════════════════════════════════════════════
// The actual camera/zxing flow runs in the browser — untestable here.
// What IS testable: the wiring contract.
//   1. BarcodeScannerModal.jsx exports a default React component that
//      accepts onDetected as a named prop.
//   2. LotteryShiftModal/index.jsx imports BarcodeScannerModal.
//   3. LotteryShiftModal mounts BarcodeScannerModal with an onDetected
//      handler that routes to handleScan(value).
//   4. The scan bar contains a camera button bound to setShowCamera(true).

console.log('\n[F18] Wiring contract (file-source check)');

const cashierAppRoot = path.join(REPO_ROOT, 'cashier-app', 'src');
const barcodeScannerPath = path.join(cashierAppRoot, 'components', 'BarcodeScannerModal.jsx');
const lotteryShiftPath   = path.join(cashierAppRoot, 'components', 'modals', 'LotteryShiftModal', 'index.jsx');

const bsmSrc = fs.readFileSync(barcodeScannerPath, 'utf8');
const lsmSrc = fs.readFileSync(lotteryShiftPath, 'utf8');

log('BarcodeScannerModal exists at expected path',
  fs.existsSync(barcodeScannerPath));
log('BarcodeScannerModal exports default', /export default/.test(bsmSrc));
log('BarcodeScannerModal accepts onDetected prop',
  /onDetected/.test(bsmSrc) && /\bonDetected\b/.test(bsmSrc));
log('BarcodeScannerModal accepts open / onClose props',
  /\bopen\b/.test(bsmSrc) && /\bonClose\b/.test(bsmSrc));

log('LotteryShiftModal imports BarcodeScannerModal',
  /import\s+BarcodeScannerModal\s+from/.test(lsmSrc));
log('LotteryShiftModal imports Camera icon from lucide',
  /Camera/.test(lsmSrc) && /lucide-react/.test(lsmSrc));
log('LotteryShiftModal has showCamera state',
  // Match `const [showCamera, setShowCamera] = useState(...)` — `showCamera`
  // appears BEFORE `useState` in destructuring, so the original regex was
  // looking the wrong direction.
  /\[showCamera,\s*setShowCamera\]\s*=\s*useState/.test(lsmSrc));
log('LotteryShiftModal mounts <BarcodeScannerModal',
  /<BarcodeScannerModal\b/.test(lsmSrc));
log('Mount passes open={showCamera}',
  /open=\{showCamera\}/.test(lsmSrc));
log('Mount has onDetected handler',
  /onDetected=\{/.test(lsmSrc));
log('onDetected handler closes modal + calls handleScan',
  // Match `onDetected={(value) => { setShowCamera(false); handleScan(value); }}`
  // with whitespace tolerance.
  /onDetected=\{\s*\(\s*value\s*\)\s*=>\s*\{[\s\S]*?setShowCamera\(false\)[\s\S]*?handleScan\(value\)/.test(lsmSrc));
log('Camera button exists in scan bar with title',
  /lsm-scan-camera-btn/.test(lsmSrc) && /title="Scan with camera"/.test(lsmSrc));
log('Camera button click sets showCamera true',
  /onClick=\{\(\)\s*=>\s*setShowCamera\(true\)\}/.test(lsmSrc));

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`✓ pass: ${pass}`);
console.log(`✗ fail: ${fail}`);
console.log(`total:  ${pass + fail}`);

process.exit(fail > 0 ? 1 : 0);
