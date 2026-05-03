/**
 * seedUSStates.js — seeds the State catalog with the two v1 lottery states
 * (MA + ME) plus a baseline list of other US states (code/name only) that
 * store admins can pick from but are not yet configured for lottery.
 *
 * Idempotent: skips states that already exist.
 *
 * Run: `node prisma/seedUSStates.js`
 */

import prisma from '../src/config/postgres.js';

// Full US state/territory list (just codes + names; defaults left blank).
// MA + ME are populated with lottery-specific defaults.
const STATES = [
  // ── Fully configured for v1 ──────────────────────────────────────
  {
    code: 'MA', name: 'Massachusetts',
    defaultTaxRate: 0.0625,
    defaultLotteryCommission: 0.054,
    alcoholAgeLimit: 21, tobaccoAgeLimit: 21,
    bottleDepositRules: [
      { containerType: 'bottle', material: 'glass',    minVolumeOz: 0,  maxVolumeOz: 32, depositAmount: 0.05 },
      { containerType: 'bottle', material: 'plastic',  minVolumeOz: 0,  maxVolumeOz: 32, depositAmount: 0.05 },
      { containerType: 'can',    material: 'aluminum', minVolumeOz: 0,  maxVolumeOz: 32, depositAmount: 0.05 },
    ],
    active: true,
  },
  {
    code: 'ME', name: 'Maine',
    defaultTaxRate: 0.055,
    defaultLotteryCommission: 0.05,
    alcoholAgeLimit: 21, tobaccoAgeLimit: 21,
    bottleDepositRules: [
      { containerType: 'bottle', material: 'glass',    minVolumeOz: 0,  maxVolumeOz: 32, depositAmount: 0.05 },
      { containerType: 'bottle', material: 'plastic',  minVolumeOz: 0,  maxVolumeOz: 32, depositAmount: 0.05 },
      { containerType: 'bottle', material: 'glass',    minVolumeOz: 0,  maxVolumeOz: 50, depositAmount: 0.15 }, // wine/liquor
      { containerType: 'can',    material: 'aluminum', minVolumeOz: 0,  maxVolumeOz: 32, depositAmount: 0.05 },
    ],
    active: true,
  },
  // ── Code/name only (admin can configure later) ────────────────────
  { code: 'AL', name: 'Alabama',        country: 'US', active: false },
  { code: 'AK', name: 'Alaska',         country: 'US', active: false },
  { code: 'AZ', name: 'Arizona',        country: 'US', active: false },
  { code: 'AR', name: 'Arkansas',       country: 'US', active: false },
  { code: 'CA', name: 'California',     country: 'US', active: false },
  { code: 'CO', name: 'Colorado',       country: 'US', active: false },
  { code: 'CT', name: 'Connecticut',    country: 'US', active: false },
  { code: 'DE', name: 'Delaware',       country: 'US', active: false },
  { code: 'FL', name: 'Florida',        country: 'US', active: false },
  { code: 'GA', name: 'Georgia',        country: 'US', active: false },
  { code: 'HI', name: 'Hawaii',         country: 'US', active: false },
  { code: 'ID', name: 'Idaho',          country: 'US', active: false },
  { code: 'IL', name: 'Illinois',       country: 'US', active: false },
  { code: 'IN', name: 'Indiana',        country: 'US', active: false },
  { code: 'IA', name: 'Iowa',           country: 'US', active: false },
  { code: 'KS', name: 'Kansas',         country: 'US', active: false },
  { code: 'KY', name: 'Kentucky',       country: 'US', active: false },
  { code: 'LA', name: 'Louisiana',      country: 'US', active: false },
  { code: 'MD', name: 'Maryland',       country: 'US', active: false },
  { code: 'MI', name: 'Michigan',       country: 'US', active: false },
  { code: 'MN', name: 'Minnesota',      country: 'US', active: false },
  { code: 'MS', name: 'Mississippi',    country: 'US', active: false },
  { code: 'MO', name: 'Missouri',       country: 'US', active: false },
  { code: 'MT', name: 'Montana',        country: 'US', active: false },
  { code: 'NE', name: 'Nebraska',       country: 'US', active: false },
  { code: 'NV', name: 'Nevada',         country: 'US', active: false },
  { code: 'NH', name: 'New Hampshire',  country: 'US', active: false },
  { code: 'NJ', name: 'New Jersey',     country: 'US', active: false },
  { code: 'NM', name: 'New Mexico',     country: 'US', active: false },
  { code: 'NY', name: 'New York',       country: 'US', active: false },
  { code: 'NC', name: 'North Carolina', country: 'US', active: false },
  { code: 'ND', name: 'North Dakota',   country: 'US', active: false },
  { code: 'OH', name: 'Ohio',           country: 'US', active: false },
  { code: 'OK', name: 'Oklahoma',       country: 'US', active: false },
  { code: 'OR', name: 'Oregon',         country: 'US', active: false },
  { code: 'PA', name: 'Pennsylvania',   country: 'US', active: false },
  { code: 'RI', name: 'Rhode Island',   country: 'US', active: false },
  { code: 'SC', name: 'South Carolina', country: 'US', active: false },
  { code: 'SD', name: 'South Dakota',   country: 'US', active: false },
  { code: 'TN', name: 'Tennessee',      country: 'US', active: false },
  { code: 'TX', name: 'Texas',          country: 'US', active: false },
  { code: 'UT', name: 'Utah',           country: 'US', active: false },
  { code: 'VT', name: 'Vermont',        country: 'US', active: false },
  { code: 'VA', name: 'Virginia',       country: 'US', active: false },
  { code: 'WA', name: 'Washington',     country: 'US', active: false },
  { code: 'WV', name: 'West Virginia',  country: 'US', active: false },
  { code: 'WI', name: 'Wisconsin',      country: 'US', active: false },
  { code: 'WY', name: 'Wyoming',        country: 'US', active: false },
  { code: 'DC', name: 'Washington DC',  country: 'US', active: false },
];

async function main() {
  let created = 0, skipped = 0;
  for (const s of STATES) {
    const existing = await prisma.state.findUnique({ where: { code: s.code } }).catch(() => null);
    if (existing) { skipped += 1; continue; }
    await prisma.state.create({
      data: {
        code:                     s.code,
        name:                     s.name,
        country:                  s.country || 'US',
        defaultTaxRate:           s.defaultTaxRate ?? null,
        defaultLotteryCommission: s.defaultLotteryCommission ?? null,
        alcoholAgeLimit:          s.alcoholAgeLimit ?? 21,
        tobaccoAgeLimit:          s.tobaccoAgeLimit ?? 21,
        bottleDepositRules:       s.bottleDepositRules || [],
        lotteryGameStubs:         [],
        active:                   s.active !== false,
      },
    });
    created += 1;
  }
  console.log(`[seed] US states: ${created} created, ${skipped} already present. Active: MA + ME.`);
}

main()
  .catch((err) => { console.error(err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
