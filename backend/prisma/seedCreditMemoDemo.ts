/**
 * seedCreditMemoDemo.js — one-shot script to seed a tiny end-to-end demo
 * for credit-memo verification: 1 vendor, 1 purchase invoice ($12,000),
 * 1 credit memo ($500). Run once, then hit
 * `/api/invoice/vendor-summary?vendorName=Hershey%20Demo%20Co` to confirm
 * the math.
 *
 * Idempotent: skips if the demo rows already exist.
 */

import prisma from '../src/config/postgres.js';

const ORG_ID    = 'default';
const VENDOR_NM = 'Hershey Demo Co';

async function main() {
  // Use the first active org to avoid scope-to-tenant issues
  const org = await prisma.organization.findFirst({ where: { active: true } }).catch(() => null);
  const orgId = org?.id || ORG_ID;

  // 1. Vendor
  let vendor = await prisma.vendor.findFirst({ where: { orgId, name: VENDOR_NM } });
  if (!vendor) {
    vendor = await prisma.vendor.create({
      data: { orgId, name: VENDOR_NM },
    });
    console.log(`[seed] created vendor ${vendor.id} (${VENDOR_NM})`);
  } else {
    console.log(`[seed] vendor ${vendor.id} already exists (${VENDOR_NM})`);
  }

  // 2. Purchase invoice — skip if already seeded
  const purchasedMarker = 'DEMO-PURCHASE-2026-04';
  let purchase = await prisma.invoice.findFirst({ where: { orgId, invoiceNumber: purchasedMarker } });
  if (!purchase) {
    purchase = await prisma.invoice.create({
      data: {
        orgId,
        vendorName:         VENDOR_NM,
        vendorId:           vendor.id,
        invoiceNumber:      purchasedMarker,
        invoiceDate:        new Date('2026-04-10'),
        totalInvoiceAmount: 12000,
        lineItems:          [
          { description: 'Demo Chocolate 48ct Case', qty: 50, unitCost: 240, total: 12000 },
        ],
        invoiceType: 'purchase',
        status:      'synced',
      },
    });
    console.log(`[seed] created purchase invoice ${purchase.id} ($12,000)`);
  } else {
    console.log(`[seed] purchase invoice already seeded (${purchase.id})`);
  }

  // 3. Credit memo (volume rebate) linked to the purchase
  const creditMarker = 'DEMO-CREDIT-2026-04';
  let credit = await prisma.invoice.findFirst({ where: { orgId, invoiceNumber: creditMarker } });
  if (!credit) {
    credit = await prisma.invoice.create({
      data: {
        orgId,
        vendorName:         VENDOR_NM,
        vendorId:           vendor.id,
        invoiceNumber:      creditMarker,
        invoiceDate:        new Date('2026-04-18'),
        totalInvoiceAmount: 500, // positive value; reporter subtracts via invoiceType
        lineItems:          [
          { description: 'Volume rebate — 5%', total: 500 },
        ],
        invoiceType:     'credit_memo',
        linkedInvoiceId: purchase.id, // traceability link
        status:          'synced',
      },
    });
    console.log(`[seed] created credit memo ${credit.id} ($500 rebate)`);
  } else {
    console.log(`[seed] credit memo already seeded (${credit.id})`);
  }

  console.log('\n[seed] demo seeded. Verify with:');
  console.log(`       GET /api/invoice/vendor-summary?vendorId=${vendor.id}`);
  console.log('       → expect { purchases: { count: 1, total: 12000 }, credits: { count: 1, total: 500 }, netCost: 11500 }');
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
