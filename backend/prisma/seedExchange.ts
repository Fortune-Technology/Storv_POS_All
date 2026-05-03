// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * seedExchange.js — Seeds Storeveu Exchange trading partnerships and wholesale
 * orders between every pair of non-system stores.
 *
 * Populates:
 *   • TradingPartner   — accepted bidirectional partnership per store pair
 *   • WholesaleOrder   — 8 orders spanning draft / sent / confirmed / rejected / cancelled
 *   • WholesaleOrderItem — 3-6 line items per order with realistic product snapshots
 *
 * Idempotent.
 *
 * Usage: node prisma/seedExchange.js
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const prisma = new PrismaClient();

const rand    = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const pick    = (a) => a[Math.floor(Math.random() * a.length)];
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

async function seedPartnership(a, b) {
  // a, b = { id, orgId, name } — bi-directional single row
  const existing = await prisma.tradingPartner.findFirst({
    where: {
      OR: [
        { requesterStoreId: a.id, partnerStoreId: b.id },
        { requesterStoreId: b.id, partnerStoreId: a.id },
      ],
    },
  });
  if (existing) return existing;

  const requester = await prisma.user.findFirst({ where: { orgId: a.orgId, role: { in: ['owner', 'admin', 'manager'] } } });
  const responder = await prisma.user.findFirst({ where: { orgId: b.orgId, role: { in: ['owner', 'admin', 'manager'] } } });
  return prisma.tradingPartner.create({
    data: {
      requesterStoreId: a.id, requesterOrgId: a.orgId,
      partnerStoreId:   b.id, partnerOrgId:   b.orgId,
      status: 'accepted',
      requestNote: `Partnership request from ${a.name} to ${b.name} — mutual wholesale trading`,
      requestedById: requester?.id || '',
      respondedById: responder?.id || null,
      respondedAt: daysAgo(rand(3, 10)),
      createdAt: daysAgo(rand(10, 20)),
    },
  });
}

async function seedWholesaleOrders(sender, receiver) {
  const existing = await prisma.wholesaleOrder.count({
    where: { senderStoreId: sender.id, receiverStoreId: receiver.id },
  });
  if (existing >= 3) {
    console.log(`    ↳ ${existing} wholesale orders ${sender.name}→${receiver.name} already exist — skipping`);
    return 0;
  }

  const senderUsers = await prisma.user.findMany({ where: { orgId: sender.orgId }, take: 5 });
  if (senderUsers.length === 0) return 0;
  const senderProducts = await prisma.masterProduct.findMany({
    where: { orgId: sender.orgId, active: true, deleted: false, defaultCostPrice: { gt: 0 } },
    include: { department: { select: { name: true } } },
    take: 40,
  });
  if (senderProducts.length === 0) return 0;

  const statuses = ['draft', 'sent', 'confirmed', 'confirmed', 'rejected', 'cancelled', 'partially_confirmed'];
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  let orderCount = 0;

  for (let i = 0; i < statuses.length; i++) {
    const status = statuses[i];
    const daysBack = rand(1, 30);
    const orderDate = daysAgo(daysBack);
    const nLines = rand(3, 6);
    const chosen = new Set();
    const items = [];
    let subtotal = 0, depositTotal = 0, taxTotal = 0;

    for (let k = 0; k < nLines; k++) {
      const p = pick(senderProducts);
      if (chosen.has(p.id)) continue;
      chosen.add(p.id);
      const qtySent = rand(6, 48);
      const unitCost = Number(p.defaultCostPrice);
      const lineCost = Math.round(qtySent * unitCost * 100) / 100;
      const dep = p.depositPerUnit ? Number(p.depositPerUnit) : 0;
      const lineDeposit = Math.round(qtySent * dep * 100) / 100;
      const taxable = ['alcohol', 'tobacco'].includes(p.taxClass);
      const taxRate = taxable ? 0.055 : 0;
      const taxAmount = Math.round(lineCost * taxRate * 100) / 100;
      const lineTotal = lineCost + lineDeposit + taxAmount;

      const qtyReceived = status === 'confirmed' ? qtySent
        : status === 'partially_confirmed' ? Math.max(1, Math.floor(qtySent * 0.7))
        : null;

      subtotal += lineCost;
      depositTotal += lineDeposit;
      taxTotal += taxAmount;
      items.push({
        senderProductId: p.id,
        productSnapshot: {
          name: p.name, upc: p.upc, brand: p.brand, size: p.size,
          taxClass: p.taxClass, departmentName: p.department?.name || null,
          packUnits: p.sellUnitSize || 1, packInCase: p.casePacks || null,
          depositPerUnit: dep, ebtEligible: p.ebtEligible,
          ageRequired: p.ageRequired, imageUrl: p.imageUrl,
        },
        qtySent, qtyReceived,
        unitCost, lineCost,
        depositPerUnit: dep || null, lineDeposit,
        taxable, taxRate: taxRate || null, taxAmount,
        lineTotal,
        sortOrder: k,
      });
    }
    if (items.length === 0) continue;

    const grandTotal = subtotal + depositTotal + taxTotal;
    const confirmed = status === 'confirmed' || status === 'partially_confirmed';
    const confirmedRatio = status === 'partially_confirmed' ? 0.7 : 1.0;

    const order = await prisma.wholesaleOrder.create({
      data: {
        orderNumber: `WO-${orderDate.toISOString().slice(0, 10).replace(/-/g, '')}-${stamp}${String(i).padStart(2, '0')}`,
        senderStoreId: sender.id, senderOrgId: sender.orgId,
        receiverStoreId: receiver.id, receiverOrgId: receiver.orgId,
        status,
        subtotal, depositTotal, taxTotal, grandTotal,
        confirmedSubtotal:   confirmed ? Math.round(subtotal * confirmedRatio * 100) / 100 : null,
        confirmedDeposit:    confirmed ? Math.round(depositTotal * confirmedRatio * 100) / 100 : null,
        confirmedTax:        confirmed ? Math.round(taxTotal * confirmedRatio * 100) / 100 : null,
        confirmedGrandTotal: confirmed ? Math.round(grandTotal * confirmedRatio * 100) / 100 : null,
        taxEnabled: true,
        isInternalTransfer: sender.orgId === receiver.orgId,
        hasRestrictedItems: items.some(it => ['alcohol','tobacco'].includes(it.productSnapshot.taxClass)),
        senderNotes: i === 0 ? 'Draft — add more cases before sending.' : null,
        cancelReason: status === 'cancelled' ? 'Duplicate order — already filled by another vendor' : null,
        rejectReason: status === 'rejected' ? 'We are overstocked on most items this week' : null,
        createdById: pick(senderUsers).id,
        sentAt:      status !== 'draft' ? new Date(orderDate.getTime() + 30 * 60000) : null,
        sentById:    status !== 'draft' ? pick(senderUsers).id : null,
        respondedAt: ['confirmed','partially_confirmed','rejected'].includes(status) ? new Date(orderDate.getTime() + 4 * 3600000) : null,
        confirmedAt: confirmed ? new Date(orderDate.getTime() + 4 * 3600000) : null,
        cancelledAt: status === 'cancelled' ? new Date(orderDate.getTime() + 2 * 3600000) : null,
        cancelledById: status === 'cancelled' ? pick(senderUsers).id : null,
        createdAt: orderDate,
        updatedAt: orderDate,
        items: { create: items },
      },
    });
    orderCount++;
  }
  return orderCount;
}

export async function seedExchange() {
  console.log('\n  🤝 Seeding Storeveu Exchange (trading partners + wholesale orders)...');

  const stores = await prisma.store.findMany({
    where: { isActive: true, organization: { slug: { not: 'system' } } },
    select: { id: true, orgId: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  if (stores.length < 2) {
    console.log(`  ⚠ Need at least 2 stores for Exchange — found ${stores.length}. Skipping.`);
    return;
  }

  // Build partnerships between every pair
  let pCount = 0, orderCount = 0;
  for (let i = 0; i < stores.length; i++) {
    for (let j = i + 1; j < stores.length; j++) {
      const a = stores[i], b = stores[j];
      await seedPartnership(a, b);
      pCount++;
      console.log(`\n  ↳ ${a.name}  ⇄  ${b.name}`);
      orderCount += await seedWholesaleOrders(a, b);
      orderCount += await seedWholesaleOrders(b, a);
    }
  }
  console.log(`\n  ✓ ${pCount} trading partnerships, ${orderCount} wholesale orders seeded`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedExchange()
    .catch((e) => { console.error('✗ seedExchange failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
