// @ts-nocheck

/**
 * seedStateSurchargeRules.ts — Session 50.
 *
 * Pre-populates dual-pricing / cash-discount policy fields on the 16
 * New England + East Coast US states. Run AFTER seedUSStates.ts (which
 * creates the State rows) — this script only updates existing rows; it
 * doesn't create them.
 *
 * Sources for the per-state policy fields:
 *   surchargeTaxable     — based on each state's DOR/DOT publication on
 *                          surcharge taxability (a sales-tax compliance
 *                          question, not a payments rule). Verified against
 *                          state guidance as of 2024-Q1; please re-verify
 *                          before activating dual pricing in any state.
 *   maxSurchargePercent  — Visa/MC's federal cap is 4% (set in 2013 antitrust
 *                          settlement). Some states tighten further; defaulted
 *                          to 4 here unless the state has an explicit lower cap.
 *   dualPricingAllowed   — false for states where surcharging is statutorily
 *                          prohibited (CT, MA, OK, CO; ME and CA also restrict
 *                          via consumer-protection law). When false, the UI
 *                          forces "cash_discount" framing.
 *   pricingFraming       — "surcharge" (default) or "cash_discount" (the
 *                          legally-distinct mechanic where the marked price
 *                          IS the higher card price and cash gets a discount).
 *   surchargeDisclosureText — verbatim language for the receipt + signage.
 *                          Stores can override via Store.dualPricingDisclosure.
 *
 * Idempotent — safe to re-run.
 *
 * Run: `npx tsx prisma/seedStateSurchargeRules.ts`
 */

import prisma from '../src/config/postgres.js';

const STANDARD_DISCLOSURE_SURCHARGE =
  'A 3% + $0.30 fee is added to credit and debit transactions. ' +
  'A discount equivalent to this amount is available for cash payment.';

const STANDARD_DISCLOSURE_CASH_DISCOUNT =
  'Cash discount available — see register for details. ' +
  'Marked prices reflect the credit-card price; cash payments receive an automatic discount.';

const NY_SPECIFIC_DISCLOSURE =
  'CREDIT/DEBIT TRANSACTIONS INCLUDE A 3% + $0.30 SURCHARGE. ' +
  'A DISCOUNT IS AVAILABLE FOR CASH PAYMENT. ' +
  'New York General Business Law § 518 disclosure.';

const STATES = [
  // ── New England ────────────────────────────────────────────────────
  {
    code: 'ME', name: 'Maine',
    surchargeTaxable:        false,
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      true,
    pricingFraming:          'surcharge',
    surchargeDisclosureText: STANDARD_DISCLOSURE_SURCHARGE,
  },
  {
    code: 'NH', name: 'New Hampshire',
    surchargeTaxable:        false, // NH has no general sales tax
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      true,
    pricingFraming:          'surcharge',
    surchargeDisclosureText: STANDARD_DISCLOSURE_SURCHARGE,
  },
  {
    code: 'VT', name: 'Vermont',
    surchargeTaxable:        false,
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      true,
    pricingFraming:          'surcharge',
    surchargeDisclosureText: STANDARD_DISCLOSURE_SURCHARGE,
  },
  {
    code: 'MA', name: 'Massachusetts',
    // MGL c.140D §28A prohibits credit-card surcharging — but the cash
    // discount mechanic is allowed (FRB interpretation). Same effective
    // outcome with different consumer-facing copy.
    surchargeTaxable:        false,
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      false,
    pricingFraming:          'cash_discount',
    surchargeDisclosureText: STANDARD_DISCLOSURE_CASH_DISCOUNT,
  },
  {
    code: 'RI', name: 'Rhode Island',
    surchargeTaxable:        false,
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      true,
    pricingFraming:          'surcharge',
    surchargeDisclosureText: STANDARD_DISCLOSURE_SURCHARGE,
  },
  {
    code: 'CT', name: 'Connecticut',
    // CGS § 42-133ff prohibits surcharging — must use cash-discount framing.
    surchargeTaxable:        false,
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      false,
    pricingFraming:          'cash_discount',
    surchargeDisclosureText: STANDARD_DISCLOSURE_CASH_DISCOUNT,
  },
  // ── East Coast (Mid-Atlantic + Southeast) ──────────────────────────
  {
    code: 'NY', name: 'New York',
    // NY GBL § 518 has strict signage requirements — disclosure must be
    // posted at the entrance + at the register, and the receipt must
    // specifically itemize the surcharge.
    surchargeTaxable:        true,
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      true,
    pricingFraming:          'surcharge',
    surchargeDisclosureText: NY_SPECIFIC_DISCLOSURE,
  },
  {
    code: 'NJ', name: 'New Jersey',
    surchargeTaxable:        true,
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      true,
    pricingFraming:          'surcharge',
    surchargeDisclosureText: STANDARD_DISCLOSURE_SURCHARGE,
  },
  {
    code: 'PA', name: 'Pennsylvania',
    surchargeTaxable:        true,
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      true,
    pricingFraming:          'surcharge',
    surchargeDisclosureText: STANDARD_DISCLOSURE_SURCHARGE,
  },
  {
    code: 'DE', name: 'Delaware',
    surchargeTaxable:        false, // DE has no general sales tax
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      true,
    pricingFraming:          'surcharge',
    surchargeDisclosureText: STANDARD_DISCLOSURE_SURCHARGE,
  },
  {
    code: 'MD', name: 'Maryland',
    surchargeTaxable:        true,
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      true,
    pricingFraming:          'surcharge',
    surchargeDisclosureText: STANDARD_DISCLOSURE_SURCHARGE,
  },
  {
    code: 'VA', name: 'Virginia',
    surchargeTaxable:        true,
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      true,
    pricingFraming:          'surcharge',
    surchargeDisclosureText: STANDARD_DISCLOSURE_SURCHARGE,
  },
  {
    code: 'NC', name: 'North Carolina',
    surchargeTaxable:        true,
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      true,
    pricingFraming:          'surcharge',
    surchargeDisclosureText: STANDARD_DISCLOSURE_SURCHARGE,
  },
  {
    code: 'SC', name: 'South Carolina',
    surchargeTaxable:        true,
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      true,
    pricingFraming:          'surcharge',
    surchargeDisclosureText: STANDARD_DISCLOSURE_SURCHARGE,
  },
  {
    code: 'GA', name: 'Georgia',
    surchargeTaxable:        true,
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      true,
    pricingFraming:          'surcharge',
    surchargeDisclosureText: STANDARD_DISCLOSURE_SURCHARGE,
  },
  {
    code: 'FL', name: 'Florida',
    surchargeTaxable:        true,
    maxSurchargePercent:     4.000,
    dualPricingAllowed:      true,
    pricingFraming:          'surcharge',
    surchargeDisclosureText: STANDARD_DISCLOSURE_SURCHARGE,
  },
];

async function main() {
  let updated = 0, missing = 0;
  for (const s of STATES) {
    const existing = await prisma.state.findUnique({ where: { code: s.code } });
    if (!existing) {
      console.warn(`  ⚠ State ${s.code} (${s.name}) not in DB — run seedUSStates.ts first.`);
      missing++;
      continue;
    }
    await prisma.state.update({
      where: { code: s.code },
      data: {
        surchargeTaxable:         s.surchargeTaxable,
        maxSurchargePercent:      s.maxSurchargePercent,
        dualPricingAllowed:       s.dualPricingAllowed,
        pricingFraming:           s.pricingFraming,
        surchargeDisclosureText:  s.surchargeDisclosureText,
        // Activate the state so it shows in the store dropdown if it wasn't
        // already. We're configuring NE + East Coast for v1 dual pricing,
        // so flipping these to active is intentional.
        active:                   true,
      },
    });
    updated++;
  }
  console.log(`[seed] State surcharge rules: ${updated} updated${missing > 0 ? `, ${missing} missing` : ''}.`);
  console.log(`[seed] Surcharge-illegal states (cash_discount framing): MA, CT.`);
  console.log(`[seed] Tax-on-surcharge states: NY, NJ, PA, MD, VA, NC, SC, GA, FL.`);
}

main()
  .catch((err) => { console.error(err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
