-- ══════════════════════════════════════════════════════════════════
--  Fix tax rule rate scale
--
--  The TaxRule.rate column is Decimal(6,4) and is applied directly at
--  checkout as `lineTotal * rate`. The correct storage format is a
--  decimal fraction (0.0550 = 5.5%).
--
--  A bug in the portal's TaxRules form submitted the percent value as-is
--  (5.5 instead of 0.055), which caused a 100× over-tax at checkout
--  (example: $8.99 item showed $54.67 tax = $8.99 × 5.5 / some rate).
--
--  This backfill divides any rate > 1 by 100, because no legitimate
--  sales tax exceeds 100%. Rates already in [0, 1) are left alone.
--
--  Safe to re-run: once a rate is < 1 it's skipped.
-- ══════════════════════════════════════════════════════════════════

UPDATE "tax_rules"
SET "rate" = "rate" / 100
WHERE "rate" > 1;
