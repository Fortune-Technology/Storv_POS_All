/**
 * Seed Loyalty — program config, earn rules, and reward tiers.
 * Run via: node prisma/seedLoyalty.js [orgId] [storeId]
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const prisma = new PrismaClient();

const ORG_ID   = process.argv[2] || 'default';
const STORE_ID = process.argv[3] || 'default-store';

export async function seedLoyalty(orgId = ORG_ID, storeId = STORE_ID) {
  console.log(`\n  🎁 Seeding loyalty for org=${orgId} store=${storeId}...`);

  // Program config (upsert — single per store)
  await prisma.loyaltyProgram.upsert({
    where:  { storeId },
    update: {},
    create: {
      orgId, storeId,
      enabled:               true,
      programName:           'Storeveu Rewards',
      pointsPerDollar:       1,
      redeemPointsPerDollar: 100,
      minPointsToRedeem:     100,
      maxRedemptionPerTx:    25.00,
      welcomeBonus:          50,
      birthdayBonus:         100,
      expiryDays:            365,
    },
  });
  console.log('  ✓ Loyalty program config seeded');

  // Earn rules — exclude tobacco/alcohol/lottery, 2× on coffee
  const earnRules = [
    { targetType: 'department', targetCode: 'TOBAC',   targetName: 'Tobacco',         action: 'exclude',  multiplier: 1   },
    { targetType: 'department', targetCode: 'VAPE',    targetName: 'Vape & E-Cig',    action: 'exclude',  multiplier: 1   },
    { targetType: 'department', targetCode: 'LOTTERY', targetName: 'Lottery',         action: 'exclude',  multiplier: 1   },
    { targetType: 'department', targetCode: 'SPIRITS', targetName: 'Spirits & Liquor',action: 'exclude',  multiplier: 1   },
    { targetType: 'department', targetCode: 'COFFEE',  targetName: 'Coffee & Hot Drinks', action: 'multiply', multiplier: 2 },
    { targetType: 'department', targetCode: 'DELI',    targetName: 'Deli',            action: 'multiply', multiplier: 1.5 },
  ];

  const depts = await prisma.department.findMany({ where: { orgId }, select: { id: true, code: true } });
  const deptByCode = Object.fromEntries(depts.map(d => [d.code, d.id]));

  let earnCreated = 0;
  for (const r of earnRules) {
    const targetIdRaw = deptByCode[r.targetCode];
    if (targetIdRaw == null) continue;
    const targetId = String(targetIdRaw); // LoyaltyEarnRule.targetId is String
    const exists = await prisma.loyaltyEarnRule.findFirst({
      where: { orgId, storeId, targetType: r.targetType, targetId },
    });
    if (exists) continue;
    await prisma.loyaltyEarnRule.create({
      data: {
        orgId, storeId,
        targetType: r.targetType,
        targetId,
        targetName: r.targetName,
        action:     r.action,
        multiplier: r.multiplier,
        active:     true,
      },
    });
    earnCreated++;
  }
  console.log(`  ✓ ${earnCreated} loyalty earn rules seeded`);

  // Reward tiers
  const rewards = [
    { name: '$1 Off',        pointsCost: 100,  rewardType: 'dollar_off', rewardValue: 1,  sortOrder: 10 },
    { name: '$5 Off',        pointsCost: 500,  rewardType: 'dollar_off', rewardValue: 5,  sortOrder: 20 },
    { name: '$10 Off',       pointsCost: 1000, rewardType: 'dollar_off', rewardValue: 10, sortOrder: 30 },
    { name: '$25 Off',       pointsCost: 2500, rewardType: 'dollar_off', rewardValue: 25, sortOrder: 40 },
    { name: '10% Off Order', pointsCost: 800,  rewardType: 'pct_off',    rewardValue: 10, sortOrder: 50 },
  ];

  let rewardCreated = 0;
  for (const r of rewards) {
    const exists = await prisma.loyaltyReward.findFirst({ where: { orgId, storeId, name: r.name } });
    if (exists) continue;
    await prisma.loyaltyReward.create({
      data: {
        orgId, storeId,
        name:        r.name,
        description: `Redeem ${r.pointsCost} points for ${r.name}`,
        pointsCost:  r.pointsCost,
        rewardType:  r.rewardType,
        rewardValue: r.rewardValue,
        sortOrder:   r.sortOrder,
        active:      true,
      },
    });
    rewardCreated++;
  }
  console.log(`  ✓ ${rewardCreated} loyalty rewards seeded`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedLoyalty()
    .catch((e) => { console.error('✗ seedLoyalty failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
