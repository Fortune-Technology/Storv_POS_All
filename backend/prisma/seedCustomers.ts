// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * Seed Customers — realistic customer records with loyalty points history.
 * Run via: node prisma/seedCustomers.js [orgId] [storeId]
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

const ORG_ID   = process.argv[2] || 'default';
const STORE_ID = process.argv[3] || 'default-store';

// Every customer has ALL optional fields populated so the UI doesn't show N/A
// for displayed columns (contact, discount, balance, balanceLimit, cardNo).
const CUSTOMERS = [
  { firstName: 'Emily',    lastName: 'Anderson',  email: 'emily.anderson@example.com',   phone: '+12075551001', cardNo: 'LY10001', discount: 0.05, balance:   0.00, balanceLimit: 100, points:  850, charge: true,  birthDate: '1988-03-14' },
  { firstName: 'Michael',  lastName: 'Brown',     email: 'michael.brown@example.com',    phone: '+12075551002', cardNo: 'LY10002', discount: 0.05, balance:   0.00, balanceLimit: 150, points:  340, charge: true,  birthDate: '1975-11-02' },
  { firstName: 'Sarah',    lastName: 'Clark',     email: 'sarah.clark@example.com',      phone: '+12075551003', cardNo: 'LY10003', discount: 0.10, balance:  42.50, balanceLimit: 200, points: 1240, charge: true,  birthDate: '1992-07-21' },
  { firstName: 'David',    lastName: 'Davis',     email: 'david.davis@example.com',      phone: '+12075551004', cardNo: 'LY10004', discount: 0.03, balance:   0.00, balanceLimit: 100, points:  120, charge: true,  birthDate: '1981-09-08' },
  { firstName: 'Jessica',  lastName: 'Evans',     email: 'jessica.evans@example.com',    phone: '+12075551005', cardNo: 'LY10005', discount: 0.05, balance:  12.00, balanceLimit:  75, points:   50, charge: true,  birthDate: '1996-12-30' },
  { firstName: 'James',    lastName: 'Foster',    email: 'james.foster@example.com',     phone: '+12075551006', cardNo: 'LY10006', discount: 0.10, balance:   0.00, balanceLimit: 250, points: 2100, charge: true,  birthDate: '1968-04-17' },
  { firstName: 'Linda',    lastName: 'Garcia',    email: 'linda.garcia@example.com',     phone: '+12075551007', cardNo: 'LY10007', discount: 0.15, balance:  15.00, balanceLimit: 150, points:  680, charge: true,  birthDate: '1985-06-25' },
  { firstName: 'Robert',   lastName: 'Hernandez', email: 'robert.hernandez@example.com', phone: '+12075551008', cardNo: 'LY10008', discount: 0.05, balance:   0.00, balanceLimit: 100, points:    0, charge: true,  birthDate: '1990-01-11' },
  { firstName: 'Patricia', lastName: 'Iverson',   email: 'patricia.iverson@example.com', phone: '+12075551009', cardNo: 'LY10009', discount: 0.05, balance:   0.00, balanceLimit:  75, points:  415, charge: true,  birthDate: '1978-10-05' },
  { firstName: 'John',     lastName: 'Johnson',   email: 'john.johnson@example.com',     phone: '+12075551010', cardNo: 'LY10010', discount: 0.07, balance:  22.75, balanceLimit: 125, points:  930, charge: true,  birthDate: '1984-02-19' },
  { firstName: 'Barbara',  lastName: 'Kim',       email: 'barbara.kim@example.com',      phone: '+12075551011', cardNo: 'LY10011', discount: 0.10, balance:   0.00, balanceLimit: 100, points: 1505, charge: true,  birthDate: '1994-08-03' },
  { firstName: 'William',  lastName: 'Lopez',     email: 'william.lopez@example.com',    phone: '+12075551012', cardNo: 'LY10012', discount: 0.05, balance:   0.00, balanceLimit: 100, points:   75, charge: true,  birthDate: '1972-05-28' },
  { firstName: 'Susan',    lastName: 'Martinez',  email: 'susan.martinez@example.com',   phone: '+12075551013', cardNo: 'LY10013', discount: 0.05, balance:   0.00, balanceLimit: 100, points:  260, charge: true,  birthDate: '1987-11-16' },
  { firstName: 'Thomas',   lastName: 'Nguyen',    email: 'thomas.nguyen@example.com',    phone: '+12075551014', cardNo: 'LY10014', discount: 0.08, balance:   5.50, balanceLimit: 200, points:  590, charge: true,  birthDate: '1980-07-09' },
  { firstName: 'Karen',    lastName: 'Olson',     email: 'karen.olson@example.com',      phone: '+12075551015', cardNo: 'LY10015', discount: 0.10, balance:   8.25, balanceLimit:  50, points: 1875, charge: true,  birthDate: '1991-03-22' },
];

function buildHistory(totalPoints) {
  // Build a plausible earning history summing to totalPoints
  if (totalPoints <= 0) return [];
  const history = [];
  let remaining = totalPoints;
  let running = 0;
  const reasons = ['Purchase reward', 'Birthday bonus', 'Signup bonus', 'Referral bonus'];
  while (remaining > 0) {
    const chunk = Math.min(remaining, Math.max(10, Math.floor(Math.random() * 150) + 25));
    remaining -= chunk;
    running += chunk;
    const daysAgo = Math.floor(Math.random() * 120) + 1;
    history.push({
      date: new Date(Date.now() - daysAgo * 86400000).toISOString(),
      points: chunk,
      reason: reasons[Math.floor(Math.random() * reasons.length)],
      balance: running,
    });
  }
  // Sort chronologically and fix running balance
  history.sort((a, b) => new Date(a.date) - new Date(b.date));
  let bal = 0;
  for (const h of history) { bal += h.points; h.balance = bal; }
  return history;
}

export async function seedCustomers(orgId = ORG_ID, storeId = STORE_ID) {
  console.log(`\n  👥 Seeding customers for org=${orgId} store=${storeId}...`);
  const existing = await prisma.customer.count({ where: { orgId, storeId, deleted: false } });
  const pwHash = await bcrypt.hash('Customer@123', 10);

  if (existing >= CUSTOMERS.length) {
    // Backfill any missing optional fields on existing seeded customers
    console.log(`  ✓ Customers already exist (${existing}) — backfilling missing fields`);
    let backfilled = 0;
    for (const c of CUSTOMERS) {
      const row = await prisma.customer.findFirst({
        where: { orgId, storeId, firstName: c.firstName, lastName: c.lastName, deleted: false },
      });
      if (!row) continue;
      const patch = {};
      if (row.discount == null)       patch.discount = c.discount;
      if (row.balance == null)        patch.balance = c.balance;
      if (row.balanceLimit == null)   patch.balanceLimit = c.balanceLimit;
      if (!row.cardNo)                patch.cardNo = c.cardNo;
      if (!row.phone)                 patch.phone = c.phone;
      if (!row.email)                 patch.email = c.email;
      if (!row.birthDate && c.birthDate) patch.birthDate = new Date(c.birthDate);
      if (!row.instoreChargeEnabled)  patch.instoreChargeEnabled = c.charge;
      if (Object.keys(patch).length > 0) {
        await prisma.customer.update({ where: { id: row.id }, data: patch });
        backfilled++;
      }
    }
    if (backfilled > 0) console.log(`    ↳ Backfilled fields on ${backfilled} customers`);
    return;
  }

  let created = 0;
  for (const c of CUSTOMERS) {
    await prisma.customer.create({
      data: {
        orgId,
        storeId,
        name:                 `${c.firstName} ${c.lastName}`,
        firstName:            c.firstName,
        lastName:             c.lastName,
        email:                c.email,
        phone:                c.phone,
        passwordHash:         pwHash,
        cardNo:               c.cardNo,
        discount:             c.discount,
        balance:              c.balance,
        balanceLimit:         c.balanceLimit,
        instoreChargeEnabled: c.charge,
        loyaltyPoints:        c.points,
        pointsHistory:        buildHistory(c.points),
        birthDate:            c.birthDate ? new Date(c.birthDate) : null,
      },
    });
    created++;
  }
  console.log(`  ✓ ${created} customers seeded`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedCustomers()
    .catch((e) => { console.error('✗ seedCustomers failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
