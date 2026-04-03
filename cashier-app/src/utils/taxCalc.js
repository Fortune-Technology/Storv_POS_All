/**
 * Pure tax calculation utilities.
 * No side effects — safe to unit test.
 */

export function computeTax(items, taxRules = []) {
  let tax = 0;
  for (const item of items) {
    if (!item.taxable) continue;
    if (item.ebtEligible) continue; // EBT items are tax-exempt
    const rule = taxRules.find(r =>
      r.active && matchesTaxClass(r.appliesTo, item.taxClass)
    );
    const rate = rule ? parseFloat(rule.rate) : 0;
    tax += item.lineTotal * rate;
  }
  return round2(tax);
}

function matchesTaxClass(appliesTo, taxClass) {
  if (!appliesTo || appliesTo === 'all') return true;
  return appliesTo.split(',').map(s => s.trim()).includes(taxClass);
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}
