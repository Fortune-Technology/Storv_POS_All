/**
 * seedDeptAttributes.js — Session 4
 *
 * Seeds sensible default DepartmentAttribute rows for alcohol / liquor /
 * beer / tobacco departments across EVERY org in the DB. Matches departments
 * by code (BEER, WINE, LIQUOR/SPIRITS, TOBAC/TOBACCO) or by name (case-insensitive
 * contains). Safe to re-run — idempotent via (orgId, departmentId, key) unique.
 *
 * Run: node prisma/seedDeptAttributes.js
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Preset attribute sets — keyed by a category that we match against the
// department's name or code.
const PRESETS = {
  wine: [
    { key: 'vintage',  label: 'Vintage Year',  dataType: 'integer', placeholder: 'e.g. 2019', sortOrder: 1 },
    { key: 'country',  label: 'Country',       dataType: 'text',    placeholder: 'e.g. France', sortOrder: 2 },
    { key: 'region',   label: 'Region',        dataType: 'text',    placeholder: 'e.g. Napa Valley', sortOrder: 3 },
    { key: 'varietal', label: 'Varietal',      dataType: 'text',    placeholder: 'e.g. Cabernet Sauvignon', sortOrder: 4 },
    { key: 'colour',   label: 'Colour',        dataType: 'dropdown', options: ['Red','White','Rosé','Sparkling','Dessert'], sortOrder: 5 },
    { key: 'abv',      label: 'ABV',           dataType: 'decimal', unit: '%', placeholder: 'e.g. 13.5', sortOrder: 6 },
    { key: 'bottle_size', label: 'Bottle Size', dataType: 'text',  placeholder: 'e.g. 750ml', sortOrder: 7 },
  ],
  liquor: [
    { key: 'type',     label: 'Type',      dataType: 'dropdown', options: ['Whiskey','Vodka','Gin','Rum','Tequila','Brandy','Liqueur','Other'], sortOrder: 1 },
    { key: 'country',  label: 'Country',   dataType: 'text',    placeholder: 'e.g. Scotland', sortOrder: 2 },
    { key: 'proof',    label: 'Proof',     dataType: 'decimal', unit: '°',  placeholder: 'e.g. 80', sortOrder: 3 },
    { key: 'abv',      label: 'ABV',       dataType: 'decimal', unit: '%',  placeholder: 'e.g. 40.0', sortOrder: 4 },
    { key: 'bottle_size', label: 'Bottle Size', dataType: 'text', placeholder: 'e.g. 750ml', sortOrder: 5 },
  ],
  beer: [
    { key: 'style',       label: 'Style',     dataType: 'dropdown', options: ['Lager','IPA','Stout','Wheat','Pilsner','Sour','Ale','Cider','Other'], sortOrder: 1 },
    { key: 'container',   label: 'Container', dataType: 'dropdown', options: ['Can','Bottle','Keg'], sortOrder: 2 },
    { key: 'abv',         label: 'ABV',       dataType: 'decimal', unit: '%', placeholder: 'e.g. 5.0', sortOrder: 3 },
    { key: 'country',     label: 'Country',   dataType: 'text',    placeholder: 'e.g. Mexico', sortOrder: 4 },
    { key: 'pack_count',  label: 'Pack Count', dataType: 'integer', placeholder: 'e.g. 6', sortOrder: 5 },
  ],
  tobacco: [
    { key: 'type',             label: 'Type',             dataType: 'dropdown', options: ['Cigarette','Cigar','Pipe','Smokeless','Vape','E-Liquid','Rolling Paper','Other'], sortOrder: 1 },
    { key: 'nicotine_strength',label: 'Nicotine Strength', dataType: 'text',    placeholder: 'e.g. 6mg', sortOrder: 2 },
    { key: 'flavour',          label: 'Flavour',          dataType: 'text',    placeholder: 'e.g. Menthol', sortOrder: 3 },
    { key: 'country',          label: 'Country',          dataType: 'text',    placeholder: 'e.g. USA', sortOrder: 4 },
  ],
};

// Match a department to a preset category. Explicit `dept.category` wins;
// otherwise fall back to a fuzzy name/code match. Fuzzy matches also BACKFILL
// `dept.category` so subsequent runs (and the Product Form) are reliable.
function categorize(dept) {
  if (dept.category && ['wine','liquor','beer','tobacco'].includes(dept.category)) {
    return { cat: dept.category, backfilled: false };
  }
  const name = String(dept.name || '').toLowerCase();
  const code = String(dept.code || '').toLowerCase();
  let cat = null;
  if (code === 'wine' || name.includes('wine') || name.includes('champagne') || name.includes('vino')) cat = 'wine';
  else if (code === 'beer' || name.includes('beer') || name.includes('cerveza') || name.includes('cider') || name.includes('malt')) cat = 'beer';
  else if (['liquor','spirits','spirit','liq','spir'].includes(code) || name.includes('liquor') || name.includes('spirit') || name.includes('whiskey') || name.includes('licor')) cat = 'liquor';
  else if (['tobac','tobacco','vape','smoke'].some(c => code.includes(c)) || name.includes('tobacco') || name.includes('vape') || name.includes('cigar') || name.includes('smoke')) cat = 'tobacco';
  return { cat, backfilled: !!cat };
}

async function main() {
  const depts = await prisma.department.findMany({ where: { active: true } });
  console.log(`[seedDeptAttributes] Scanning ${depts.length} departments…`);

  let inserted = 0;
  let matched = 0;
  let categoriesBackfilled = 0;

  for (const dept of depts) {
    const { cat, backfilled } = categorize(dept);
    if (!cat) continue;
    matched++;

    // Backfill the dept's `category` column when we auto-guessed.
    // The UI can then surface it and the retailer can correct if wrong.
    if (backfilled) {
      try {
        await prisma.department.update({ where: { id: dept.id }, data: { category: cat } });
        categoriesBackfilled++;
      } catch (e) {
        console.warn(`  backfill category failed for ${dept.name}: ${e.message}`);
      }
    }

    const preset = PRESETS[cat];
    for (const a of preset) {
      try {
        await prisma.departmentAttribute.upsert({
          where:  { orgId_departmentId_key: { orgId: dept.orgId, departmentId: dept.id, key: a.key } },
          create: {
            orgId: dept.orgId,
            departmentId: dept.id,
            key: a.key,
            label: a.label,
            dataType: a.dataType,
            options: a.options || [],
            unit: a.unit || null,
            placeholder: a.placeholder || null,
            sortOrder: a.sortOrder || 0,
          },
          update: {}, // never overwrite operator customizations
        });
        inserted++;
      } catch (e) {
        console.warn(`  ${dept.name} / ${a.key}: ${e.message}`);
      }
    }
    console.log(`  ✓ ${dept.orgId}/${dept.name} (${cat}${backfilled ? ' — backfilled' : ''}) — ${preset.length} attrs`);
  }

  console.log(`[seedDeptAttributes] Done. ${matched} depts matched, ${categoriesBackfilled} categories backfilled, ${inserted} attribute rows upserted.`);
}

main()
  .catch((e) => { console.error('[seedDeptAttributes] FAILED:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
