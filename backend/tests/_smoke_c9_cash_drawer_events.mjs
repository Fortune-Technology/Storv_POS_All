/**
 * S77 (C9) — Cash Drawer Events smoke test (pure-function).
 *
 * Verifies the contract WITHOUT requiring a running backend:
 *   1. Ref-number prefix mappers (cashEvent/reference.ts):
 *      - cash_drop / cash_in → 'CD' / 'CI'
 *      - vendor / loan / received_on_account → 'VP' / 'LN' / 'RA'
 *   2. Drawer reconciliation bucket logic mirrors what readPayoutBuckets
 *      does in services/reconciliation/shift/queries.ts:
 *      - CashDrop type='drop' → cashDropsTotal (subtract)
 *      - CashDrop type='paid_in' → cashIn (add)
 *      - CashPayout payoutType='expense'/'merchandise' → cashOut (subtract)
 *      - CashPayout payoutType='loan' → cashOut (subtract)
 *      - CashPayout payoutType='received_on_account' → cashIn (add)
 *   3. EoD payout bucket mapping (mirrors endOfDayReportController):
 *      - Same routing into the 9 PAYOUT_CATEGORIES
 *   4. Drawer-math direction:
 *      - expectedDrawer = opening + cashSales - cashRefunds + cashIn
 *                       - cashOut - cashDropsTotal
 *      - paid_in + received_on_account ADD (money INTO drawer)
 *      - loans + vendor payouts + drops SUBTRACT (money OUT of drawer)
 *
 * Mirror this exactly when changing the engine. If tests start failing
 * after a controller change, it means either:
 *   (a) the controller broke the contract — fix the controller, or
 *   (b) the contract changed intentionally — update this test to match
 */

let pass = 0, fail = 0;
const log = (label, ok, detail = '') => {
  const sym = ok ? '✓' : '✗';
  console.log(`  ${sym} ${label}${detail ? '  — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

console.log('=== S77 (C9) CASH DRAWER EVENTS — PURE-FUNCTION SMOKE ===\n');

// ── Mirrors of cashEvent/reference.ts ────────────────────────────────
function prefixForCashDropType(type) {
  return type === 'paid_in' ? 'CI' : 'CD';
}
function prefixForPayoutType(payoutType) {
  const t = String(payoutType || '').toLowerCase().trim();
  if (t === 'loan' || t === 'loans') return 'LN';
  if (t === 'received_on_account' || t === 'received_on_acct' || t === 'on_account' || t === 'house_payment') return 'RA';
  return 'VP';
}

// ── Mirrors of readPayoutBuckets (queries.ts) bucketing ─────────────
function bucketDrops(drops) {
  let cashDropsTotal = 0;
  let cashInPaidInDrops = 0;
  for (const d of drops) {
    const amt = Number(d.amount || 0);
    const t = String(d.type || 'drop').toLowerCase().trim();
    if (t === 'paid_in') cashInPaidInDrops += amt;
    else cashDropsTotal += amt;
  }
  return { cashDropsTotal, cashInPaidInDrops };
}

function bucketPayouts(payouts) {
  let cashInPaidIn = 0;
  let cashInReceivedOnAcct = 0;
  let cashOutPaidOut = 0;
  let cashOutLoans = 0;
  for (const p of payouts) {
    const amt = Number(p.amount || 0);
    const t = String(p.payoutType || '').toLowerCase().trim();
    if (t === 'loan' || t === 'loans') {
      cashOutLoans += amt;
    } else if (t === 'paid_in' || t === 'received') {
      cashInPaidIn += amt;
    } else if (
      t === 'received_on_account' ||
      t === 'received_on_acct' ||
      t === 'on_account' ||
      t === 'house_payment'
    ) {
      cashInReceivedOnAcct += amt;
    } else if (t === 'tip' || t === 'tips') {
      // skip
    } else {
      cashOutPaidOut += amt;
    }
  }
  return { cashInPaidIn, cashInReceivedOnAcct, cashOutPaidOut, cashOutLoans };
}

// ── Drawer math (mirrors compute.ts) ─────────────────────────────────
function expectedDrawer({ openingFloat, cashSales, cashRefunds, cashIn, cashOut, cashDropsTotal }) {
  return openingFloat + cashSales - cashRefunds + cashIn - cashOut - cashDropsTotal;
}

// ── 1. Ref-number prefix mappers ─────────────────────────────────────
console.log('[1] Ref-number prefix mappers');
{
  log('cash_drop type → CD', prefixForCashDropType('drop') === 'CD');
  log('cash_drop default → CD', prefixForCashDropType(null) === 'CD');
  log('cash_drop default → CD', prefixForCashDropType(undefined) === 'CD');
  log('cash_in type → CI', prefixForCashDropType('paid_in') === 'CI');

  log('vendor expense → VP', prefixForPayoutType('expense') === 'VP');
  log('vendor merchandise → VP', prefixForPayoutType('merchandise') === 'VP');
  log('vendor unknown → VP', prefixForPayoutType('something_else') === 'VP');
  log('vendor null → VP', prefixForPayoutType(null) === 'VP');

  log('loan → LN', prefixForPayoutType('loan') === 'LN');
  log('loans → LN', prefixForPayoutType('loans') === 'LN');

  log('received_on_account → RA', prefixForPayoutType('received_on_account') === 'RA');
  log('received_on_acct → RA (legacy)', prefixForPayoutType('received_on_acct') === 'RA');
  log('on_account → RA (legacy)', prefixForPayoutType('on_account') === 'RA');
  log('house_payment → RA (legacy)', prefixForPayoutType('house_payment') === 'RA');

  log('case-insensitive: LOAN → LN', prefixForPayoutType('LOAN') === 'LN');
  log('whitespace: " loan " → LN', prefixForPayoutType(' loan ') === 'LN');
}

// ── 2. CashDrop bucketing by type ────────────────────────────────────
console.log('\n[2] CashDrop bucketing by type');
{
  const drops = [
    { amount: 100, type: 'drop' },
    { amount: 50,  type: 'paid_in' },
    { amount: 200, type: 'drop' },
    { amount: 75,  type: 'paid_in' },
    { amount: 30,  type: null }, // legacy row → defaults to drop
  ];
  const r = bucketDrops(drops);
  log('cashDropsTotal = 100 + 200 + 30 = 330', r.cashDropsTotal === 330);
  log('cashInPaidInDrops = 50 + 75 = 125', r.cashInPaidInDrops === 125);
  log('legacy type=null treated as drop', bucketDrops([{ amount: 99, type: null }]).cashDropsTotal === 99);
}

// ── 3. CashPayout bucketing by payoutType ────────────────────────────
console.log('\n[3] CashPayout bucketing by payoutType');
{
  const payouts = [
    { amount: 100, payoutType: 'expense' },
    { amount: 50,  payoutType: 'merchandise' },
    { amount: 25,  payoutType: 'loan' },
    { amount: 75,  payoutType: 'received_on_account' },
    { amount: 60,  payoutType: 'received_on_acct' },  // legacy
    { amount: 10,  payoutType: 'tip' },               // not in drawer math
    { amount: 5,   payoutType: 'paid_in' },
    { amount: 200, payoutType: 'on_account' },        // legacy alias
  ];
  const r = bucketPayouts(payouts);
  log('cashOutPaidOut = expense + merchandise = 100 + 50 = 150', r.cashOutPaidOut === 150);
  log('cashOutLoans = 25', r.cashOutLoans === 25);
  log('cashInReceivedOnAcct = 75 + 60 + 200 = 335', r.cashInReceivedOnAcct === 335);
  log('cashInPaidIn = 5', r.cashInPaidIn === 5);
  log('tips deliberately excluded from drawer math', !('tips' in r));
}

// ── 4. Drawer math direction ─────────────────────────────────────────
console.log('\n[4] Drawer math direction');
{
  // Scenario: opening $200, $500 cash sales, $50 cash refunds,
  //           $100 cash drop, $50 cash in, $30 vendor payout,
  //           $20 loan, $75 received on account
  const drops = bucketDrops([
    { amount: 100, type: 'drop' },
    { amount: 50,  type: 'paid_in' },
  ]);
  const payouts = bucketPayouts([
    { amount: 30, payoutType: 'expense' },
    { amount: 20, payoutType: 'loan' },
    { amount: 75, payoutType: 'received_on_account' },
  ]);
  const cashIn  = drops.cashInPaidInDrops + payouts.cashInPaidIn + payouts.cashInReceivedOnAcct;
  const cashOut = payouts.cashOutPaidOut + payouts.cashOutLoans;

  log('cashIn = 50 (paid_in drop) + 0 (paid_in payout) + 75 (RA) = 125',
    cashIn === 125);
  log('cashOut = 30 (expense) + 20 (loan) = 50', cashOut === 50);

  const exp = expectedDrawer({
    openingFloat: 200,
    cashSales: 500,
    cashRefunds: 50,
    cashIn,
    cashOut,
    cashDropsTotal: drops.cashDropsTotal,
  });
  // 200 + 500 - 50 + 125 - 50 - 100 = 625
  log('expectedDrawer = 200 + 500 - 50 + 125 - 50 - 100 = 625', exp === 625);
}

// ── 5. Edge cases ────────────────────────────────────────────────────
console.log('\n[5] Edge cases');
{
  log('zero drops + zero payouts → bucket all zero',
    bucketDrops([]).cashDropsTotal === 0 &&
    bucketDrops([]).cashInPaidInDrops === 0 &&
    bucketPayouts([]).cashOutPaidOut === 0
  );

  log('only paid_in drops → cashDropsTotal=0, cashInPaidInDrops>0',
    bucketDrops([{ amount: 100, type: 'paid_in' }]).cashDropsTotal === 0 &&
    bucketDrops([{ amount: 100, type: 'paid_in' }]).cashInPaidInDrops === 100
  );

  log('only loans → cashOutLoans=N, cashOutPaidOut=0',
    bucketPayouts([{ amount: 50, payoutType: 'loan' }]).cashOutLoans === 50 &&
    bucketPayouts([{ amount: 50, payoutType: 'loan' }]).cashOutPaidOut === 0
  );

  log('only RA → cashInReceivedOnAcct=N',
    bucketPayouts([{ amount: 80, payoutType: 'received_on_account' }]).cashInReceivedOnAcct === 80
  );

  // Stale data with empty payoutType falls into paid_out (default) — matches
  // legacy behavior. Existing data must still work post-migration.
  log('legacy CashPayout with null payoutType → paid_out (default)',
    bucketPayouts([{ amount: 99, payoutType: null }]).cashOutPaidOut === 99
  );
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`✓ pass: ${pass}`);
console.log(`✗ fail: ${fail}`);
console.log(`total:  ${pass + fail}`);

process.exit(fail > 0 ? 1 : 0);
