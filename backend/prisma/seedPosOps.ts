// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * seedPosOps.js — Seeds POS operational + account-level modules:
 *   • QuickButtonLayout  — sample 6-tile starter grid
 *   • SupportTicket      — 5 tickets across statuses + admin replies
 *   • SubscriptionPlan   — 3 plans (global)
 *   • OrgSubscription    — 1 subscription per non-system org
 *   • BillingInvoice     — 3 past invoices per subscription
 *   • Invitation         — 2 invitations per org (pending + accepted)
 *
 * Idempotent. Plans are seeded once globally.
 *
 * Usage: node prisma/seedPosOps.js [orgId] [storeId]
 */
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const prisma = new PrismaClient();

const ORG_ID   = process.argv[2] || 'default';
const STORE_ID = process.argv[3] || 'default-store';

const rand    = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const pick    = (a) => a[Math.floor(Math.random() * a.length)];
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const daysFromNow = (n) => new Date(Date.now() + n * 86400000);

/* ── Global Subscription Plans (seeded once) ────────────────────── */
async function seedPlans() {
  const plans = [
    {
      slug: 'starter',
      name: 'Starter',
      description: 'Perfect for single-register c-stores getting online. Includes full POS, 1 register, daily analytics, basic support.',
      basePrice: 49,
      pricePerStore: 0,
      pricePerRegister: 25,
      includedStores: 1,
      includedRegisters: 1,
      trialDays: 14,
      isPublic: true,
      sortOrder: 10,
    },
    {
      slug: 'pro',
      name: 'Pro',
      description: 'For growing retailers: up to 3 stores, unlimited registers, e-commerce storefront, vendor auto-ordering, full analytics.',
      basePrice: 149,
      pricePerStore: 40,
      pricePerRegister: 15,
      includedStores: 3,
      includedRegisters: 5,
      trialDays: 14,
      isPublic: true,
      sortOrder: 20,
    },
    {
      slug: 'enterprise',
      name: 'Enterprise',
      description: 'Multi-location chains with custom requirements. Includes API access, priority support, and dedicated onboarding.',
      basePrice: 499,
      pricePerStore: 25,
      pricePerRegister: 10,
      includedStores: 10,
      includedRegisters: 25,
      trialDays: 30,
      isPublic: true,
      sortOrder: 30,
    },
  ];

  let created = 0;
  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where:  { slug: plan.slug },
      update: plan,
      create: plan,
    });
    created++;
  }
  console.log(`  ✓ ${created} subscription plans upserted (global)`);
}

/* ── Per-Store Seeds ────────────────────────────────────────────── */
export async function seedPosOps(orgId = ORG_ID, storeId = STORE_ID) {
  console.log(`\n  🎛️  Seeding POS ops / support / billing for org=${orgId} store=${storeId}...`);

  await seedPlans();

  /* ── Quick Button Layout ────────────────────────────────────── */
  const qbExisting = await prisma.quickButtonLayout.findUnique({ where: { storeId } });
  if (qbExisting && (qbExisting.tree?.length ?? 0) > 0) {
    console.log(`  ✓ Quick button layout already exists (${qbExisting.tree.length} tiles) — skipping`);
  } else {
    const products = await prisma.masterProduct.findMany({
      where: { orgId, active: true, defaultRetailPrice: { gt: 0 } },
      take: 6,
      select: { id: true, name: true, upc: true, defaultRetailPrice: true },
    });
    const tree = products.map((p, i) => ({
      id: 'tile-' + (i + 1),
      type: 'product',
      x: (i % 3) * 2,
      y: Math.floor(i / 3) * 2,
      w: 2,
      h: 2,
      productId: p.id,
      name: p.name,
      price: Number(p.defaultRetailPrice),
      upc: p.upc,
      backgroundColor: pick(['#3d56b5', '#16a34a', '#f59e0b', '#8b5cf6', '#ec4899', '#0891b2']),
      textColor: '#ffffff',
    }));
    // Add one action tile
    tree.push({
      id: 'tile-open-drawer',
      type: 'action',
      x: 0, y: 4, w: 2, h: 2,
      actionKey: 'open_drawer',
      label: 'Open Drawer',
      backgroundColor: '#475569',
      textColor: '#ffffff',
    });

    await prisma.quickButtonLayout.upsert({
      where:  { storeId },
      update: { tree, gridCols: 6, rowHeight: 56 },
      create: { orgId, storeId, name: 'Main Screen', gridCols: 6, rowHeight: 56, tree },
    });
    console.log(`  ✓ Quick button layout seeded (${tree.length} tiles)`);
  }

  /* ── Support Tickets ────────────────────────────────────────── */
  const stExisting = await prisma.supportTicket.count({ where: { orgId } });
  if (stExisting >= 5) {
    console.log(`  ✓ Support tickets already exist (${stExisting}) — skipping`);
  } else {
    const owner = await prisma.user.findFirst({ where: { orgId, role: { in: ['owner', 'admin'] } } });
    if (owner) {
      const tickets = [
        {
          subject: 'Lottery shift report variance',
          body:    'We are seeing a consistent $2-$3 variance on our lottery EoD reports across multiple shifts. Can someone take a look?',
          status:  'open',
          priority:'high',
          responses: [],
        },
        {
          subject: 'Bulk import CSV column mapping question',
          body:    'When importing a vendor invoice, is there a way to auto-map the "PackSize" column from our distributor to our cases field?',
          status:  'in_progress',
          priority:'normal',
          responses: [
            { by: 'Storeveu Support', byType: 'admin', message: 'Yes — under Invoice Import > CSV Transform, save a mapping template. We are working on auto-detecting it.', date: daysAgo(1).toISOString() },
          ],
        },
        {
          subject: 'Requesting feature: auto-order based on weather',
          body:    'Our ice cream sales jump 30% on hot days — it would be great if auto-order could factor in the 10-day forecast.',
          status:  'open',
          priority:'low',
          responses: [],
        },
        {
          subject: 'Printer not pulling thermal receipts',
          body:    'Epson TM-T88 stopped printing after last update. Works for test pages but not transactions.',
          status:  'resolved',
          priority:'urgent',
          responses: [
            { by: 'Storeveu Support', byType: 'admin', message: 'This was a config issue — reinstalled the QZ-Tray driver and re-paired the printer. Resolved.', date: daysAgo(3).toISOString() },
            { by: 'Store Owner',      byType: 'store', message: 'Confirmed working again. Thanks for the fast fix!', date: daysAgo(3).toISOString() },
          ],
        },
        {
          subject: 'How do I add a new department?',
          body:    'Cannot find where to add a new department for "Prepared Hot Foods". Do I need to call support?',
          status:  'closed',
          priority:'normal',
          responses: [
            { by: 'Storeveu Support', byType: 'admin', message: 'Portal > Catalog > Departments > New Department. You can set age requirement, EBT flag, and tax class there.', date: daysAgo(7).toISOString() },
          ],
        },
      ];

      let created = 0;
      for (const t of tickets) {
        await prisma.supportTicket.create({
          data: {
            orgId,
            userId: owner.id,
            email:  owner.email,
            name:   owner.name,
            subject: t.subject,
            body:    t.body,
            status:  t.status,
            priority:t.priority,
            responses: t.responses,
            createdAt: daysAgo(rand(1, 30)),
          },
        });
        created++;
      }
      console.log(`  ✓ ${created} support tickets seeded`);
    }
  }

  /* ── OrgSubscription + BillingInvoices ──────────────────────── */
  const subExisting = await prisma.orgSubscription.findUnique({ where: { orgId } });
  if (subExisting) {
    const invCount = await prisma.billingInvoice.count({ where: { subscriptionId: subExisting.id } });
    if (invCount >= 3) {
      console.log(`  ✓ Subscription + ${invCount} invoices already exist — skipping`);
    } else {
      await seedInvoices(subExisting);
    }
  } else {
    // Pick a plan based on org slug (simple heuristic)
    const proPlan = await prisma.subscriptionPlan.findUnique({ where: { slug: 'pro' } });
    if (proPlan) {
      const periodStart = daysAgo(15);
      const periodEnd   = daysFromNow(15);
      const sub = await prisma.orgSubscription.create({
        data: {
          orgId,
          planId: proPlan.id,
          status: 'active',
          trialEndsAt: daysAgo(30),
          currentPeriodStart: periodStart,
          currentPeriodEnd:   periodEnd,
          storeCount: 1,
          registerCount: 2,
          extraAddons: [],
        },
      });
      console.log(`  ✓ Organization subscription created (Pro plan)`);
      await seedInvoices(sub);
    }
  }

  /* ── Invitations ────────────────────────────────────────────── */
  const invExisting = await prisma.invitation.count({ where: { orgId } });
  if (invExisting >= 2) {
    console.log(`  ✓ Invitations already exist (${invExisting}) — skipping`);
  } else {
    const inviter = await prisma.user.findFirst({ where: { orgId, role: { in: ['owner', 'admin'] } } });
    if (inviter) {
      const rows = [
        {
          email:       'new.manager@example.com',
          role:        'manager',
          status:      'pending',
          expiresAt:   daysFromNow(7),
          token:       crypto.randomBytes(24).toString('base64url'),
          transferOwnership: false,
        },
        {
          email:       'accepted.cashier@example.com',
          role:        'cashier',
          status:      'accepted',
          expiresAt:   daysAgo(2),
          acceptedAt:  daysAgo(5),
          token:       crypto.randomBytes(24).toString('base64url'),
          transferOwnership: false,
        },
        {
          email:       'expired.invite@example.com',
          role:        'cashier',
          status:      'expired',
          expiresAt:   daysAgo(3),
          token:       crypto.randomBytes(24).toString('base64url'),
          transferOwnership: false,
        },
      ];
      let created = 0;
      for (const r of rows) {
        await prisma.invitation.create({
          data: { ...r, orgId, storeIds: [], invitedById: inviter.id, createdAt: daysAgo(rand(1, 10)) },
        });
        created++;
      }
      console.log(`  ✓ ${created} invitations seeded`);
    }
  }
}

async function seedInvoices(sub) {
  let created = 0;
  const basePrice = 149;
  for (let i = 3; i >= 1; i--) {
    const periodStart = daysAgo(i * 30 + 15);
    const periodEnd   = daysAgo(i * 30 - 15);
    await prisma.billingInvoice.create({
      data: {
        invoiceNumber: `INV-${periodEnd.toISOString().slice(0, 7).replace('-', '')}-${sub.id.slice(-4)}-${String(i).padStart(4, '0')}`,
        subscriptionId: sub.id,
        periodStart, periodEnd,
        baseAmount:     basePrice,
        discountAmount: 0,
        totalAmount:    basePrice,
        status:         i === 1 ? 'pending' : 'paid',
        attempts:       1,
        lastAttemptAt:  periodEnd,
        paidAt:         i === 1 ? null : new Date(periodEnd.getTime() + 86400000),
        authcode:       i === 1 ? null : 'AUTH-' + String(rand(100000, 999999)),
        retref:         i === 1 ? null : 'RET-' + String(rand(10000, 99999)),
      },
    });
    created++;
  }
  console.log(`  ✓ ${created} billing invoices seeded`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedPosOps()
    .catch((e) => { console.error('✗ seedPosOps failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
