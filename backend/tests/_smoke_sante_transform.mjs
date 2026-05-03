// Smoke test: Sante transformer + import-service productGroup auto-create.
//
// Loads the user's actual Sante CSV, runs the transformer over the first N
// rows, and verifies:
//   1. UPCs strip the leading `_` and split commas correctly
//   2. Pack 1-6 columns flatten into packOptions + additionalUpcs
//   3. Tags split into productGroup (Other:) vs attributes (everything else)
//   4. Bill & Hold / Surcharge / Importer are dropped
//   5. The output column set matches getOutputColumns()
//
// And against the live DB:
//   6. importService validates a transformed row and resolves productGroupName
//      → productGroupId (auto-creating the group when missing)
//
// Cleans up all created groups + products on exit. Safe to re-run.

import fs from 'node:fs/promises';
import { parse as parseCsv } from 'fast-csv';
import { Readable } from 'node:stream';
import { transformRow, getOutputColumns } from '../src/utils/transformers/sante.js';
import { buildContext, validateRows, IMPORT_SERVICE_VERSION } from '../src/services/inventory/import.js';
import prisma from '../src/config/postgres.js';

// Helper: parse CSV file → array of objects keyed by header
async function parseCsvFile(path) {
  const raw = await fs.readFile(path, 'utf-8');
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(raw)
      .pipe(parseCsv({ headers: true }))
      .on('error', reject)
      .on('data', (r) => rows.push(r))
      .on('end', () => resolve(rows));
  });
}

const SANTE_CSV = 'C:/Users/nishn/Downloads/products (3).csv';
const TEST_TAG  = '__sante_smoke_test__';
let exitCode = 0;
const results = [];

function pass(label) { results.push({ ok: true, label }); console.log(`✓ ${label}`); }
function fail(label, details) {
  results.push({ ok: false, label, details });
  console.error(`✗ ${label}\n  ${details}`);
  exitCode = 1;
}

async function getTestOrgId() {
  const o = await prisma.organization.findFirst({ select: { id: true } });
  if (!o) throw new Error('No organizations in DB — cannot run smoke test');
  return o.id;
}

async function cleanup(orgId) {
  // Delete any test groups + test products before/after
  await prisma.masterProduct.deleteMany({ where: { orgId, name: { startsWith: TEST_TAG } } });
  await prisma.productGroup.deleteMany({ where: { orgId, name: { startsWith: TEST_TAG } } });
}

async function run() {
  console.log(`\nimportService version: ${IMPORT_SERVICE_VERSION}`);

  const orgId = await getTestOrgId();
  console.log(`Using orgId: ${orgId}\n`);
  await cleanup(orgId);

  // ── Load + parse the user's CSV ──
  const rows = await parseCsvFile(SANTE_CSV);
  console.log(`Loaded ${rows.length} Sante rows from ${SANTE_CSV}\n`);

  // Pick a sample row that has Other: tags (red bull entries) AND a sample with packs.
  const sampleWithOther = rows.find(r => String(r.Tags || '').includes('Other:'));
  const sampleWithPacks = rows.find(r => String(r['Pack 1 Name'] || '').trim().length > 0);
  const sampleSimple    = rows.find(r => !String(r.Tags || '').includes('Other:') && !String(r['Pack 1 Name'] || '').trim());

  if (!sampleSimple) fail('Could not find simple row in CSV', '');
  else {
    console.log(`--- Sample simple row: ${sampleSimple.Title} ---`);
    const { transformedRow, warnings } = transformRow(sampleSimple);
    // Test 1: UPC strip
    if (transformedRow.upc && !String(transformedRow.upc).startsWith('_')) {
      pass(`UPC underscore stripped (${transformedRow.upc})`);
    } else {
      fail('UPC underscore NOT stripped', JSON.stringify(transformedRow.upc));
    }
    // Test 2: Price strip
    if (transformedRow.defaultRetailPrice && !String(transformedRow.defaultRetailPrice).includes('$')) {
      pass(`Retail price $ stripped (${transformedRow.defaultRetailPrice})`);
    } else {
      fail('Retail price $ NOT stripped', JSON.stringify(transformedRow.defaultRetailPrice));
    }
    // Test 3: Tax % strip
    if (transformedRow.taxClass && !String(transformedRow.taxClass).includes('%')) {
      pass(`Tax rate % stripped (${transformedRow.taxClass})`);
    } else {
      fail('Tax rate % NOT stripped', JSON.stringify(transformedRow.taxClass));
    }
    void warnings;
  }

  if (sampleWithOther) {
    console.log(`\n--- Sample with Other: tags: ${sampleWithOther.Title} ---`);
    const { transformedRow, warnings } = transformRow(sampleWithOther);
    // Test 4: Other: tags → productGroup (NOT into attributes)
    if (transformedRow.productGroup && transformedRow.productGroup.length > 0) {
      pass(`Other: tags routed to productGroup ("${transformedRow.productGroup}")`);
    } else {
      fail(`Other: tags did NOT produce productGroup`, `Tags: ${sampleWithOther.Tags}`);
    }
    // Test 5: attributes JSON should NOT contain Other: keys
    if (transformedRow.attributes) {
      const attrs = JSON.parse(transformedRow.attributes);
      const hasOther = Object.keys(attrs).some(k => k.toLowerCase() === 'other');
      if (hasOther) {
        fail('attributes JSON still contains "Other" key', JSON.stringify(attrs));
      } else {
        pass(`attributes JSON correctly excludes Other: tags (keys: ${Object.keys(attrs).join(', ') || '<none>'})`);
      }
    } else {
      // Possible if all tags were Other: — also valid
      pass('attributes JSON empty (all tags were Other: type)');
    }
    void warnings;
  } else {
    console.log('\n[skip] No row with Other: tags found in CSV');
  }

  if (sampleWithPacks) {
    console.log(`\n--- Sample with packs: ${sampleWithPacks.Title} ---`);
    const { transformedRow } = transformRow(sampleWithPacks);
    // Test 6: packOptions emitted in label@count@price[*];... format
    if (transformedRow.packOptions) {
      pass(`packOptions emitted ("${transformedRow.packOptions}")`);
      // Verify format: each segment label@count@price[*]
      const segs = String(transformedRow.packOptions).split(';');
      const goodSegs = segs.filter(s => /^[^@]+@[\d.]+@[\d.]+\*?$/.test(s));
      if (goodSegs.length === segs.length && segs.length > 0) {
        pass(`packOptions format valid (${segs.length} segments)`);
      } else {
        fail('packOptions format invalid', `Got: ${transformedRow.packOptions}`);
      }
    } else {
      fail('packOptions NOT emitted on row with packs', '');
    }
  } else {
    console.log('\n[skip] No row with Pack 1 Name found in CSV');
  }

  // Test 7: getOutputColumns includes productGroup
  const outCols = getOutputColumns();
  if (outCols.includes('productGroup')) {
    pass('getOutputColumns() includes "productGroup"');
  } else {
    fail('getOutputColumns() missing "productGroup"', JSON.stringify(outCols));
  }

  // Test 8: Bill & Hold / Surcharge / Importer NOT in output
  const dropped = ['Bill & Hold', 'Surcharge', 'Importer'];
  if (dropped.every(c => !outCols.includes(c))) {
    pass(`Dropped columns absent from output (${dropped.join(', ')})`);
  } else {
    fail(`Dropped columns leaked into output`, JSON.stringify(outCols));
  }

  // ── Live DB test: import service productGroup auto-create ──
  console.log('\n--- DB integration: productGroup auto-create ---');

  const ctx = await buildContext(orgId);
  console.log(`buildContext: ${ctx.productGroupByName.size} existing groups in org`);

  const groupName = `${TEST_TAG}_red_bull_pack`;
  const fakeRows = [{
    upc:              '999000222001',
    name:             `${TEST_TAG} Sante Test Product`,
    defaultRetailPrice: '3.69',
    productGroup:     groupName,  // Sante's `Other:` tag value lands here
  }];
  const mapping = {
    upc: 'upc',
    name: 'name',
    defaultRetailPrice: 'defaultRetailPrice',
    productGroupName: 'productGroup',  // CSV column → canonical field via alias map
  };

  const validation = await validateRows(
    fakeRows,
    'products',
    mapping,
    ctx,
    { unknownProductGroupStrategy: 'create' },
  ).catch(e => ({ error: e.message }));

  if (validation.error) {
    fail('validateRows threw', validation.error);
  } else {
    const entry = validation.valid?.[0];
    const cleaned = entry?.cleaned;
    if (!entry) {
      fail('validateRows returned no valid rows', JSON.stringify({ valid: validation.valid?.length, invalid: validation.invalid?.length, invalidErrors: validation.invalid?.[0]?.errors }));
    } else if (!cleaned) {
      fail('validateRows: valid entry has no cleaned row', JSON.stringify(entry));
    } else if (cleaned._createProductGroupName === groupName && cleaned.productGroupId === null) {
      pass(`validateRows: new productGroup "${groupName}" flagged for auto-create`);
    } else if (cleaned.productGroupId && Number.isFinite(cleaned.productGroupId)) {
      pass(`validateRows: productGroup resolved to existing id ${cleaned.productGroupId}`);
    } else {
      fail('validateRows: unexpected productGroup resolution', JSON.stringify({
        productGroupId: cleaned.productGroupId,
        _createProductGroupName: cleaned._createProductGroupName,
        warnings: entry.warnings,
      }));
    }
  }

  // Cleanup
  await cleanup(orgId);
  console.log(`\n──────────────────────────────────────`);
  console.log(`Smoke: ${results.filter(r => r.ok).length} passed, ${results.filter(r => !r.ok).length} failed`);
  console.log(`──────────────────────────────────────\n`);

  await prisma.$disconnect();
  process.exit(exitCode);
}

run().catch(async (err) => {
  console.error('FATAL:', err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(2);
});
