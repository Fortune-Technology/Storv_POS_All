import prisma from './config/postgres.js';
import bcrypt from 'bcryptjs';

/**
 * Seed catalog defaults (departments, tax rules, deposit rules) for an org.
 * Safe to call multiple times — skips records that already exist.
 */
export const seedCatalogDefaults = async (orgId) => {
  // ── Departments ─────────────────────────────────────────────────────────
  const deptDefs = [
    { code: 'BEER',    name: 'Beer',             taxClass: 'alcohol',   ageRequired: 21, bottleDeposit: true,  sortOrder: 1,  color: '#f59e0b' },
    { code: 'WINE',    name: 'Wine',             taxClass: 'alcohol',   ageRequired: 21, bottleDeposit: true,  sortOrder: 2,  color: '#8b5cf6' },
    { code: 'SPIRITS', name: 'Spirits / Liquor', taxClass: 'alcohol',   ageRequired: 21, bottleDeposit: true,  sortOrder: 3,  color: '#6366f1' },
    { code: 'HARD',    name: 'Hard Seltzer',     taxClass: 'alcohol',   ageRequired: 21, bottleDeposit: true,  sortOrder: 4,  color: '#06b6d4' },
    { code: 'TOBAC',   name: 'Tobacco',          taxClass: 'tobacco',   ageRequired: 21,                       sortOrder: 5,  color: '#64748b' },
    { code: 'VAPE',    name: 'Vape / E-Cigs',    taxClass: 'tobacco',   ageRequired: 21,                       sortOrder: 6,  color: '#475569' },
    { code: 'GROC',    name: 'Grocery',          taxClass: 'grocery',   ebtEligible: true,                     sortOrder: 7,  color: '#10b981' },
    { code: 'DAIRY',   name: 'Dairy',            taxClass: 'grocery',   ebtEligible: true,                     sortOrder: 8,  color: '#3b82f6' },
    { code: 'FROZEN',  name: 'Frozen Foods',     taxClass: 'grocery',   ebtEligible: true,                     sortOrder: 9,  color: '#0ea5e9' },
    { code: 'DELI',    name: 'Deli / Hot Food',  taxClass: 'hot_food',                                         sortOrder: 10, color: '#f97316' },
    { code: 'BAKED',   name: 'Bakery',           taxClass: 'grocery',   ebtEligible: true,                     sortOrder: 11, color: '#d97706' },
    { code: 'SNACK',   name: 'Snacks / Chips',   taxClass: 'grocery',   ebtEligible: true,                     sortOrder: 12, color: '#84cc16' },
    { code: 'BEVER',   name: 'Beverages (NA)',   taxClass: 'grocery',   ebtEligible: true,  bottleDeposit: true, sortOrder: 13, color: '#22c55e' },
    { code: 'CANDY',   name: 'Candy',            taxClass: 'grocery',   ebtEligible: true,                     sortOrder: 14, color: '#ec4899' },
    { code: 'HEALTH',  name: 'Health & Beauty',  taxClass: 'standard',                                         sortOrder: 15, color: '#f43f5e' },
    { code: 'CLEAN',   name: 'Household / Cleaning', taxClass: 'standard',                                    sortOrder: 16, color: '#94a3b8' },
    { code: 'LOTTERY', name: 'Lottery',          taxClass: 'none',                                             sortOrder: 17, color: '#eab308' },
    { code: 'MISC',    name: 'Miscellaneous',    taxClass: 'standard',                                         sortOrder: 18, color: '#94a3b8' },
  ];

  for (const d of deptDefs) {
    await prisma.department.upsert({
      where:  { orgId_code: { orgId, code: d.code } },
      update: {},
      create: { orgId, ...d },
    });
  }
  console.log(`  ✓ ${deptDefs.length} departments`);

  // ── Tax Rules (Maine) ────────────────────────────────────────────────────
  const existingTax = await prisma.taxRule.count({ where: { orgId, state: 'ME' } });
  if (existingTax === 0) {
    await prisma.taxRule.createMany({
      data: [
        { orgId, name: 'Maine General Sales Tax',    rate: 0.0550, appliesTo: 'standard',  ebtExempt: true,  state: 'ME', description: '5.5% Maine sales tax on general merchandise' },
        { orgId, name: 'Maine Grocery Exemption',    rate: 0.0000, appliesTo: 'grocery',   ebtExempt: false, state: 'ME', description: 'Grocery food items are tax-exempt in Maine' },
        { orgId, name: 'Maine Alcohol Tax',          rate: 0.0550, appliesTo: 'alcohol',   ebtExempt: false, state: 'ME', description: '5.5% on beer and wine' },
        { orgId, name: 'Maine Tobacco Tax',          rate: 0.0550, appliesTo: 'tobacco',   ebtExempt: false, state: 'ME', description: '5.5% plus state excise on tobacco' },
        { orgId, name: 'Maine Prepared Food Tax',    rate: 0.0800, appliesTo: 'hot_food',  ebtExempt: false, state: 'ME', description: '8% on prepared / hot food' },
        { orgId, name: 'EBT / SNAP Exempt',          rate: 0.0000, appliesTo: 'non_taxable', ebtExempt: false, state: 'ME', description: 'Zero tax when purchased with EBT/SNAP benefits' },
      ],
    });
    console.log('  ✓ 6 Maine tax rules');
  }

  // ── Deposit Rules (Maine CRV) ────────────────────────────────────────────
  const existingDep = await prisma.depositRule.count({ where: { orgId, state: 'ME' } });
  if (existingDep === 0) {
    await prisma.depositRule.createMany({
      data: [
        {
          orgId,
          name:           'Maine CRV — Under 24oz',
          description:    'Maine bottle deposit for containers under 24 fluid ounces',
          minVolumeOz:    0,
          maxVolumeOz:    24,
          containerTypes: 'can,bottle,glass,plastic',
          depositAmount:  0.05,
          state:          'ME',
        },
        {
          orgId,
          name:           'Maine CRV — 24oz and Over',
          description:    'Maine bottle deposit for containers 24 fluid ounces and above',
          minVolumeOz:    24,
          maxVolumeOz:    null,
          containerTypes: 'can,bottle,glass,plastic,jug',
          depositAmount:  0.15,
          state:          'ME',
        },
      ],
    });
    console.log('  ✓ 2 Maine CRV deposit rules');
  }
};

/**
 * Seed initial data if the database is empty.
 * Only runs when there are no users in the database.
 */
export const seedData = async () => {
  try {
    const userCount = await prisma.user.count();

    if (userCount > 0) {
      console.log('ℹ Database already has data - skipping seeding');
      return;
    }

    console.log('🌱 Starting conditional seeding...');

    // Create a default org first
    const org = await prisma.organization.create({
      data: {
        name:         'Demo Store',
        slug:         'demo-store',
        plan:         'pro',
        billingEmail: 'admin@storeveu.com',
      },
    });

    // Seed users
    const adminHash = await bcrypt.hash('password123', 12);
    await prisma.user.createMany({
      data: [
        {
          name:     'Storv Admin',
          email:    'admin@storeveu.com',
          phone:    '1234567890',
          password: adminHash,
          role:     'admin',
          orgId:    org.id,
        },
      ],
    });

    // Seed fee mappings
    await prisma.feeMapping.createMany({
      data: [
        { orgId: org.id, feeType: 'Credit Card Surcharge', mappedValue: 'CC_SURCH_01', description: 'Standard CC fee mapping' },
        { orgId: org.id, feeType: 'Late Payment Fee',      mappedValue: 'LATE_FEE_99', description: 'Billing late fee' },
      ],
    });

    // Seed catalog defaults
    console.log('  Seeding catalog defaults...');
    await seedCatalogDefaults(org.id);

    console.log('✅ Seeding complete!');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
  }
};

// Run when executed directly
seedData().then(() => process.exit(0)).catch(() => process.exit(1));
