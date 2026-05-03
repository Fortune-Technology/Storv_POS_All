// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * Tax Rule Migration — Phase 2 of the taxClass → taxRuleId strict-FK migration
 * (Session 40).
 *
 * Walks every non-deleted MasterProduct that has a legacy `taxClass` string
 * but no `taxRuleId` FK set, and tries to auto-populate the FK by matching
 * the string against the org's active TaxRule table.
 *
 * Match priority (per product):
 *   1. Exact TaxRule.name match (case-insensitive, trimmed)
 *   2. Exact TaxRule.appliesTo match (case-insensitive)
 *   3. Numeric percentage → TaxRule.rate match (e.g. "6.25%" → rate=0.0625)
 *   4. Zero rules matched → UNMAPPED (admin resolves manually)
 *   5. Multiple rules matched → AMBIGUOUS (admin picks one manually)
 *
 * Unambiguous matches are written; ambiguous + unmapped cases are left alone
 * and dumped into a CSV report the admin can walk through. Stale-FK cases
 * (product has taxRuleId pointing at an inactive/deleted rule) are also
 * reported so they can be re-mapped.
 *
 * USAGE:
 *
 *   Dry-run (report only, no writes):
 *     node prisma/migrateTaxRules.js
 *     node prisma/migrateTaxRules.js --org=<orgId>
 *
 *   Apply (persist the auto-matches):
 *     node prisma/migrateTaxRules.js --apply
 *     node prisma/migrateTaxRules.js --apply --org=<orgId>
 *
 * Output files: `prisma/.migrations/tax-migration-<timestamp>.csv`
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

// ── CLI args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const apply     = argv.includes('--apply');
const orgArg    = argv.find(a => a.startsWith('--org='));
const targetOrg = orgArg ? orgArg.slice(6) : null;

// ── Reporting state ─────────────────────────────────────────────────────────
const stats = {
  scanned:         0,
  alreadyLinked:   0,
  staleFk:         0, // taxRuleId set but rule inactive/missing
  autoMatched:     0,
  ambiguous:       0,
  unmapped:        0,
};
const reportRows = []; // rows for CSV output

function norm(s) {
  return String(s || '').toLowerCase().trim();
}

// Parse a percent-like string into a decimal rate key.
// "6.25%" → "0.0625"  |  "0.055" → "0.0550"  |  "5.5"   → "0.0550"
function percentToRateKey(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[%$,\s]/g, '').trim();
  const n = parseFloat(cleaned);
  if (isNaN(n) || n < 0) return null;
  // If the user wrote "5.5" mean 5.5% — only treat as already-decimal if <= 1
  const dec = n <= 1 ? n : n / 100;
  return dec.toFixed(4);
}

// ── Main migration per org ──────────────────────────────────────────────────
async function migrateOrg(orgId) {
  // 1. Load all active tax rules for this org
  const rules = await prisma.taxRule.findMany({
    where: { orgId, active: true },
    select: { id: true, name: true, appliesTo: true, rate: true },
  });

  const byName      = new Map();  // name (lc)          → rule
  const byAppliesTo = new Map();  // appliesTo (lc)     → rule[] (may have >1)
  const byRate      = new Map();  // rate.toFixed(4)    → rule[]

  for (const r of rules) {
    const nk = norm(r.name);
    if (nk && !byName.has(nk)) byName.set(nk, r);

    const ak = norm(r.appliesTo);
    if (ak) {
      if (!byAppliesTo.has(ak)) byAppliesTo.set(ak, []);
      byAppliesTo.get(ak).push(r);
    }

    const rk = Number(r.rate).toFixed(4);
    if (!byRate.has(rk)) byRate.set(rk, []);
    byRate.get(rk).push(r);
  }

  // 2. Load all non-deleted products in this org
  const products = await prisma.masterProduct.findMany({
    where: { orgId, deleted: false },
    select: { id: true, name: true, upc: true, taxClass: true, taxRuleId: true },
  });
  if (products.length === 0) return;

  // 3. Walk each and decide
  const toWrite = []; // [{ productId, ruleId }]
  for (const p of products) {
    stats.scanned++;

    // Already linked?
    if (p.taxRuleId) {
      const linkedRule = rules.find(r => r.id === p.taxRuleId);
      if (linkedRule) {
        stats.alreadyLinked++;
        continue;
      }
      // Stale FK — rule was deactivated or deleted.
      stats.staleFk++;
      reportRows.push({
        orgId, productId: p.id, name: p.name, upc: p.upc || '',
        taxClass: p.taxClass || '', taxRuleId: p.taxRuleId,
        status: 'STALE_FK',
        suggestedRuleId: '', suggestedRuleName: '',
        reason: `taxRuleId=${p.taxRuleId} points at an inactive or missing rule`,
      });
      continue;
    }

    if (!p.taxClass) {
      // Neither FK nor legacy string — nothing to migrate, skip silently.
      continue;
    }

    const tc = norm(p.taxClass);

    // Tier 1: exact name match
    const byNameHit = byName.get(tc);
    if (byNameHit) {
      toWrite.push({ productId: p.id, ruleId: byNameHit.id });
      stats.autoMatched++;
      reportRows.push({
        orgId, productId: p.id, name: p.name, upc: p.upc || '',
        taxClass: p.taxClass, taxRuleId: '',
        status: 'AUTO_MATCHED',
        suggestedRuleId: byNameHit.id, suggestedRuleName: byNameHit.name,
        reason: 'Exact match on TaxRule.name',
      });
      continue;
    }

    // Tier 2: exact appliesTo match (most common path)
    const byApHits = byAppliesTo.get(tc);
    if (byApHits && byApHits.length === 1) {
      const r = byApHits[0];
      toWrite.push({ productId: p.id, ruleId: r.id });
      stats.autoMatched++;
      reportRows.push({
        orgId, productId: p.id, name: p.name, upc: p.upc || '',
        taxClass: p.taxClass, taxRuleId: '',
        status: 'AUTO_MATCHED',
        suggestedRuleId: r.id, suggestedRuleName: r.name,
        reason: `Exact match on TaxRule.appliesTo="${r.appliesTo}"`,
      });
      continue;
    }
    if (byApHits && byApHits.length > 1) {
      stats.ambiguous++;
      reportRows.push({
        orgId, productId: p.id, name: p.name, upc: p.upc || '',
        taxClass: p.taxClass, taxRuleId: '',
        status: 'AMBIGUOUS',
        suggestedRuleId: byApHits.map(r => r.id).join('|'),
        suggestedRuleName: byApHits.map(r => r.name).join(' OR '),
        reason: `${byApHits.length} rules have appliesTo="${tc}" — admin picks one manually`,
      });
      continue;
    }

    // Tier 3: numeric percentage → rate match
    const rateKey = percentToRateKey(p.taxClass);
    if (rateKey && byRate.has(rateKey)) {
      const rateHits = byRate.get(rateKey);
      if (rateHits.length === 1) {
        const r = rateHits[0];
        toWrite.push({ productId: p.id, ruleId: r.id });
        stats.autoMatched++;
        reportRows.push({
          orgId, productId: p.id, name: p.name, upc: p.upc || '',
          taxClass: p.taxClass, taxRuleId: '',
          status: 'AUTO_MATCHED',
          suggestedRuleId: r.id, suggestedRuleName: r.name,
          reason: `Numeric rate match (${(Number(r.rate) * 100).toFixed(2)}%)`,
        });
        continue;
      }
      stats.ambiguous++;
      reportRows.push({
        orgId, productId: p.id, name: p.name, upc: p.upc || '',
        taxClass: p.taxClass, taxRuleId: '',
        status: 'AMBIGUOUS',
        suggestedRuleId: rateHits.map(r => r.id).join('|'),
        suggestedRuleName: rateHits.map(r => r.name).join(' OR '),
        reason: `${rateHits.length} rules have rate=${rateKey} — admin picks one manually`,
      });
      continue;
    }

    // No match at any tier.
    stats.unmapped++;
    reportRows.push({
      orgId, productId: p.id, name: p.name, upc: p.upc || '',
      taxClass: p.taxClass, taxRuleId: '',
      status: 'UNMAPPED',
      suggestedRuleId: '', suggestedRuleName: '',
      reason: `No active rule matches taxClass="${p.taxClass}" by name, appliesTo, or rate`,
    });
  }

  // 4. Apply (if not dry-run). Chunked to keep prisma happy on large catalogs.
  if (apply && toWrite.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < toWrite.length; i += CHUNK) {
      const chunk = toWrite.slice(i, i + CHUNK);
      await prisma.$transaction(
        chunk.map(({ productId, ruleId }) =>
          prisma.masterProduct.update({
            where: { id: productId },
            data:  { taxRuleId: ruleId },
          })
        )
      );
    }
  }
}

// ── CSV writer ──────────────────────────────────────────────────────────────
function csvEscape(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeReport() {
  if (reportRows.length === 0) return null;
  const dir = path.join(__dirname, '.migrations');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `tax-migration-${ts}.csv`);

  const headers = ['orgId','productId','name','upc','taxClass','taxRuleId','status','suggestedRuleId','suggestedRuleName','reason'];
  const lines = [headers.join(',')];
  for (const r of reportRows) {
    lines.push(headers.map(h => csvEscape(r[h])).join(','));
  }
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Tax Rule Migration — Phase 2 (taxClass → taxRuleId)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Mode:   ${apply ? '\x1b[31mAPPLY (writes)\x1b[0m' : '\x1b[33mDRY-RUN (no writes)\x1b[0m'}`);
  console.log(`  Scope:  ${targetOrg ? `org=${targetOrg}` : 'ALL orgs'}`);
  console.log('');

  // Figure out which orgs to process
  const orgs = targetOrg
    ? [{ id: targetOrg }]
    : await prisma.organization.findMany({ select: { id: true, name: true } });

  for (const org of orgs) {
    const label = org.name ? `${org.name} (${org.id})` : org.id;
    process.stdout.write(`Processing ${label} ... `);
    await migrateOrg(org.id);
    console.log('done');
  }

  console.log('');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  Summary');
  console.log('───────────────────────────────────────────────────────────────');
  console.log(`  Products scanned:        ${stats.scanned.toLocaleString()}`);
  console.log(`  Already linked (FK ok):  ${stats.alreadyLinked.toLocaleString()}`);
  console.log(`  Stale FK (needs re-pick): \x1b[33m${stats.staleFk.toLocaleString()}\x1b[0m`);
  console.log(`  Auto-matched:            \x1b[32m${stats.autoMatched.toLocaleString()}\x1b[0m ${apply ? '(written)' : '(would write)'}`);
  console.log(`  Ambiguous:               \x1b[33m${stats.ambiguous.toLocaleString()}\x1b[0m`);
  console.log(`  Unmapped:                \x1b[33m${stats.unmapped.toLocaleString()}\x1b[0m`);
  console.log('');

  const reportFile = writeReport();
  if (reportFile) {
    console.log(`  Report written to: ${reportFile}`);
  } else {
    console.log('  No rows to report (nothing to migrate).');
  }

  if (!apply && stats.autoMatched > 0) {
    console.log('');
    console.log(`  \x1b[36mRun with --apply to persist ${stats.autoMatched.toLocaleString()} auto-matches.\x1b[0m`);
  }
  if (stats.ambiguous + stats.unmapped + stats.staleFk > 0) {
    console.log('');
    console.log(`  \x1b[33mManual attention needed: ${(stats.ambiguous + stats.unmapped + stats.staleFk).toLocaleString()} products.\x1b[0m`);
    console.log(`  Edit them via the Products page, or review the CSV and bulk-fix.`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
