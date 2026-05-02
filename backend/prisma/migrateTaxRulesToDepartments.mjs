/**
 * One-shot migration — Session 56b — converts legacy class-based tax rules
 * into department-linked rules so the system can drop `TaxRule.appliesTo`.
 *
 * Why we run this:
 *   The `appliesTo` string matcher is being removed from the entire codebase.
 *   After removal, every TaxRule must specify which departments it applies to
 *   via `departmentIds[]`. Rules that previously matched class-only would
 *   become unreachable.
 *
 * Logic:
 *   For each rule with empty departmentIds[] AND non-empty appliesTo:
 *     - If appliesTo is a wildcard (all / standard / any / *):
 *         → link to EVERY active department in the rule's org
 *     - Otherwise:
 *         → link to active departments in the rule's org whose taxClass
 *           matches the rule's appliesTo (case-insensitive, trimmed)
 *     - If no departments match: leave the rule alone, log a warning. The
 *       admin will need to either manually attach departments OR mark the
 *       rule inactive after schema cleanup.
 *
 * Idempotent: safe to run multiple times. Rules already linked to depts
 * are skipped.
 */

import { PrismaClient } from '@prisma/client';

const WILDCARDS = new Set(['all', 'standard', 'any', '*', 'none', '']);

const prisma = new PrismaClient();

async function main() {
  const rules = await prisma.taxRule.findMany({
    where: { active: true },
    select: { id: true, orgId: true, name: true, appliesTo: true, departmentIds: true },
  });

  console.log(`Scanning ${rules.length} active tax rules…`);
  let updated = 0;
  let skippedNoMatch = 0;
  let alreadyLinked = 0;

  for (const rule of rules) {
    if (Array.isArray(rule.departmentIds) && rule.departmentIds.length > 0) {
      alreadyLinked++;
      continue;
    }

    const appliesTo = String(rule.appliesTo || '').toLowerCase().trim();
    const orgDepts = await prisma.department.findMany({
      where: { orgId: rule.orgId, active: true },
      select: { id: true, name: true, taxClass: true },
    });

    let targetDeptIds;
    if (WILDCARDS.has(appliesTo)) {
      // Wildcard rule — link to every active department in the org
      targetDeptIds = orgDepts.map(d => d.id);
    } else {
      // Class-specific rule — link to departments where taxClass matches
      targetDeptIds = orgDepts
        .filter(d => String(d.taxClass || '').toLowerCase().trim() === appliesTo)
        .map(d => d.id);
    }

    if (targetDeptIds.length === 0) {
      console.warn(
        `  ⚠ Rule #${rule.id} "${rule.name}" (org ${rule.orgId}, appliesTo="${rule.appliesTo}") ` +
        `has NO matching departments in its org. After dropping appliesTo this rule will be unreachable. ` +
        `Consider either attaching departments manually OR marking it inactive.`,
      );
      skippedNoMatch++;
      continue;
    }

    await prisma.taxRule.update({
      where: { id: rule.id },
      data: { departmentIds: targetDeptIds },
    });
    console.log(
      `  ✓ Rule #${rule.id} "${rule.name}" (appliesTo="${rule.appliesTo}") ` +
      `linked to ${targetDeptIds.length} department${targetDeptIds.length === 1 ? '' : 's'}`,
    );
    updated++;
  }

  console.log('\nDone.');
  console.log(`  Updated:        ${updated} rule(s)`);
  console.log(`  Already linked: ${alreadyLinked} rule(s) (skipped — had departmentIds)`);
  console.log(`  No match:       ${skippedNoMatch} rule(s) (left alone — see warnings above)`);
}

main()
  .catch(err => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
