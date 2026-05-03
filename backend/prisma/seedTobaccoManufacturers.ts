/**
 * Seed the TobaccoManufacturer platform catalog (Session 45).
 *
 * Idempotent — safe to re-run after spec updates. Uses upsert keyed by `code`.
 *
 * Usage: node prisma/seedTobaccoManufacturers.js
 *
 * What this seeds:
 *   ALTRIA — 3 sub-feeds (PMUSA cigarettes, USSTC smokeless, Middleton cigars)
 *   RJR    — 3 programs (EDLP funded promos, Scan Data POS reporting, VAP)
 *   ITG    — 1 single feed (Winston/Kool/Salem/Maverick/USA Gold/etc.)
 *
 * Brand families per feed are best-effort based on publicly known mfr
 * portfolios. Admins can extend the brandFamilies[] per row from the
 * Admin → ScanData Platform Config page (Session 48).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MANUFACTURERS = [
  // ── ALTRIA ──────────────────────────────────────────────────────────────
  {
    code: 'altria_pmusa',
    parentMfrCode: 'altria',
    name: 'Altria PMUSA (Cigarettes)',
    shortName: 'PMUSA',
    fileFormat: 'pipe_delimited',
    fileExtension: 'txt',
    brandFamilies: [
      'Marlboro', 'L&M', 'Parliament', 'Virginia Slims', 'Basic', 'Chesterfield',
      'Benson & Hedges', 'Merit', 'English Ovals', 'Cambridge',
    ],
    cadence: 'daily',
    submissionHour: 2,
    specVersion: 'Altria Retail Leaders v3.x',
    specUrl: 'https://www.altria-retailtrade.com/',
    notes: 'Most rigorous spec. Rejects entire batch on any single bad record. ' +
           'Cert is 2-4 weeks in UAT. Per-store retailer ID assigned by Altria.',
  },
  {
    code: 'altria_usstc',
    parentMfrCode: 'altria',
    name: 'Altria USSTC (Smokeless)',
    shortName: 'USSTC',
    fileFormat: 'pipe_delimited',
    fileExtension: 'txt',
    brandFamilies: ['Copenhagen', 'Skoal', 'Husky', 'Red Seal', 'Revel'],
    cadence: 'daily',
    submissionHour: 2,
    specVersion: 'Altria USSTC Spec v3.x',
    notes: 'Separate cert from PMUSA. Smokeless tobacco only.',
  },
  {
    code: 'altria_middleton',
    parentMfrCode: 'altria',
    name: 'Altria John Middleton (Cigars)',
    shortName: 'Middleton',
    fileFormat: 'pipe_delimited',
    fileExtension: 'txt',
    brandFamilies: ['Black & Mild'],
    cadence: 'daily',
    submissionHour: 2,
    specVersion: 'Middleton Spec v2.x',
    notes: 'Cigar feed. Single-brand portfolio.',
  },

  // ── RJR / RAI ───────────────────────────────────────────────────────────
  {
    code: 'rjr_edlp',
    parentMfrCode: 'rjr',
    name: 'RJR Every Day Low Price (Funded Promos)',
    shortName: 'EDLP',
    fileFormat: 'fixed_width',
    fileExtension: 'dat',
    brandFamilies: [
      'Camel', 'Newport', 'Pall Mall', 'Doral', 'Misty', 'Capri',
      'Kent', 'True', 'Eclipse', 'Vantage',
    ],
    cadence: 'daily',
    submissionHour: 2,
    specVersion: 'RJR EDLP Spec v4.x',
    notes: 'Funded promotion program. EDLP discounts must be reported here ' +
           'to claim retailer reimbursement.',
  },
  {
    code: 'rjr_scandata',
    parentMfrCode: 'rjr',
    name: 'RJR Scan Data Reporting',
    shortName: 'ScanData',
    fileFormat: 'fixed_width',
    fileExtension: 'dat',
    brandFamilies: [
      'Camel', 'Newport', 'Pall Mall', 'Doral', 'Misty', 'Capri',
      'Kent', 'True', 'Eclipse', 'Vantage',
    ],
    cadence: 'daily',
    submissionHour: 2,
    specVersion: 'RJR Scan Data v4.x',
    notes: 'POS sales reporting (no funded promos). Used for category insight ' +
           'and shelf placement decisions.',
  },
  {
    code: 'rjr_vap',
    parentMfrCode: 'rjr',
    name: 'RJR VAP (Valued Adult Program)',
    shortName: 'VAP',
    fileFormat: 'fixed_width',
    fileExtension: 'dat',
    brandFamilies: ['Grizzly', 'Camel Snus'],
    cadence: 'daily',
    submissionHour: 2,
    specVersion: 'RJR VAP Spec v3.x',
    notes: 'Smokeless / pouch program. Separate cert from cigarettes.',
  },

  // ── ITG BRANDS ──────────────────────────────────────────────────────────
  {
    code: 'itg',
    parentMfrCode: 'itg',
    name: 'ITG Brands Retailer Incentive',
    shortName: 'ITG',
    fileFormat: 'pipe_delimited',
    fileExtension: 'csv',
    brandFamilies: [
      'Winston', 'Kool', 'Salem', 'Maverick', 'USA Gold', 'Sonoma',
      'Crowns', 'Edgefield', 'Montclair', 'Tourney', 'Davidoff',
    ],
    cadence: 'daily',
    submissionHour: 2,
    specVersion: 'ITG Retailer Incentive v2.x',
    specUrl: 'https://www.itgbrandsretailer.com/',
    notes: 'Single feed for all ITG products. Most forgiving spec — line-level ' +
           'errors do not reject the whole batch. Recommended first cert target.',
  },
];

async function main() {
  console.log('→ Seeding TobaccoManufacturer platform catalog…');

  let created = 0, updated = 0;
  for (const mfr of MANUFACTURERS) {
    const existing = await prisma.tobaccoManufacturer.findUnique({
      where: { code: mfr.code },
    });
    if (existing) {
      await prisma.tobaccoManufacturer.update({
        where: { code: mfr.code },
        data: { ...mfr, active: true },
      });
      updated++;
      console.log(`  ↻ Updated: ${mfr.code} — ${mfr.name}`);
    } else {
      await prisma.tobaccoManufacturer.create({ data: mfr });
      created++;
      console.log(`  + Created: ${mfr.code} — ${mfr.name}`);
    }
  }

  console.log(`\n✓ Done. ${created} created, ${updated} updated.`);
  console.log(`  Total feeds: ${MANUFACTURERS.length}`);
  console.log(`  Parent mfrs: ${[...new Set(MANUFACTURERS.map(m => m.parentMfrCode))].join(', ')}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
