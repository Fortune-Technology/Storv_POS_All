// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * seedVendors.js — Seeds Vendors, VendorPayments, and Purchase Orders for a
 * given org/store. Idempotent — skips if data already exists.
 *
 * Usage: node prisma/seedVendors.js [orgId] [storeId]
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

const rand   = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const pick   = (a) => a[Math.floor(Math.random() * a.length)];
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

const VENDORS = [
  { name: 'ABACUS Distributing',  code: 'ABACUS', contactName: 'Tom Fischer',   email: 'orders@abacus.example.com',   phone: '+12075552001', website: 'https://abacus.example.com',    terms: 'Net 30', leadTimeDays: 3, minOrderAmount: 250, orderFrequency: 'weekly',   deliveryDays: ['Monday', 'Thursday'],       address: { street: '142 Industrial Blvd', city: 'Portland', state: 'ME', zip: '04103', country: 'USA' }, accountNo: 'ABC-5521', aliases: ['Abacus Dist', 'ABACUS'], vendorNotes: 'Primary back-office paper goods + convenience dry goods supplier. Invoices emailed weekly.' },
  { name: 'Coca-Cola Bottling',   code: 'COKE',   contactName: 'Rita Alvarez',  email: 'rep@cocacola.example.com',    phone: '+12075552002', website: 'https://www.coca-cola.com',     terms: 'Net 30', leadTimeDays: 2, minOrderAmount: 500, orderFrequency: 'weekly',   deliveryDays: ['Tuesday', 'Friday'],        address: { street: '3800 Cumberland Pkwy', city: 'Atlanta', state: 'GA', zip: '30339', country: 'USA' },  accountNo: 'KO-88142', aliases: ['Coca Cola', 'Coke Bottling'], vendorNotes: 'Direct-store-delivery (DSD). Driver re-stocks cooler door each visit; invoices are electronic.' },
  { name: 'Hershey Foods',        code: 'HRSH',   contactName: 'James Bennett', email: 'orders@hershey.example.com',  phone: '+12075552003', website: 'https://hersheys.com',          terms: 'Net 15', leadTimeDays: 4, minOrderAmount: 300, orderFrequency: 'biweekly', deliveryDays: ['Wednesday'],                 address: { street: '19 East Chocolate Ave', city: 'Hershey', state: 'PA', zip: '17033', country: 'USA' },  accountNo: 'HSY-2245', aliases: ['Hershey', 'Hersheys'], vendorNotes: 'Candy + snack assortments. Runs promo windows every other month — watch for AP debits.' },
  { name: 'Pepsi Beverages',      code: 'PEPSI',  contactName: 'Nicole Greene', email: 'rep@pepsi.example.com',       phone: '+12075552004', website: 'https://pepsi.com',             terms: 'Net 30', leadTimeDays: 2, minOrderAmount: 400, orderFrequency: 'weekly',   deliveryDays: ['Monday', 'Thursday'],       address: { street: '700 Anderson Hill Rd', city: 'Purchase', state: 'NY', zip: '10577', country: 'USA' },  accountNo: 'PEP-1183', aliases: ['PepsiCo', 'Pepsi-Cola'], vendorNotes: 'DSD route — driver handles shelf/cooler resets. Pepsi + Gatorade + Mountain Dew lines covered.' },
  { name: 'Frito-Lay',            code: 'FRITO',  contactName: 'Mark Robinson', email: 'orders@fritolay.example.com', phone: '+12075552005', website: 'https://fritolay.com',          terms: 'Net 30', leadTimeDays: 3, minOrderAmount: 350, orderFrequency: 'weekly',   deliveryDays: ['Tuesday'],                   address: { street: '7701 Legacy Dr', city: 'Plano', state: 'TX', zip: '75024', country: 'USA' },        accountNo: 'FL-4422',  aliases: ['Frito Lay'], vendorNotes: 'Chips and salty-snack DSD. Heavy stocking every Tuesday — prep shelves Monday evening.' },
  { name: 'Core-Mark',            code: 'CORE',   contactName: 'Patricia Liu',  email: 'info@coremark.example.com',   phone: '+12075552006', website: 'https://core-mark.com',         terms: 'Net 15', leadTimeDays: 2, minOrderAmount: 1000,orderFrequency: 'weekly',   deliveryDays: ['Wednesday', 'Saturday'],    address: { street: '395 Oyster Point Blvd', city: 'South San Francisco', state: 'CA', zip: '94080', country: 'USA' }, accountNo: 'CM-77301', aliases: ['Core Mark'], vendorNotes: 'Wholesale multi-category distributor — tobacco, candy, and packaged food. Two delivery windows per week.' },
  { name: 'Anheuser-Busch',       code: 'ABINB',  contactName: 'Derek Klein',   email: 'orders@ab.example.com',       phone: '+12075552007', website: 'https://anheuser-busch.com',    terms: 'Net 30', leadTimeDays: 3, minOrderAmount: 500, orderFrequency: 'weekly',   deliveryDays: ['Friday'],                    address: { street: '1 Busch Pl', city: 'St. Louis', state: 'MO', zip: '63118', country: 'USA' },       accountNo: 'AB-90012', aliases: ['AB InBev', 'ABInBev'], vendorNotes: 'Beer + hard-seltzer portfolio. Requires 21+ sign-off on receiving slip for every delivery.' },
  { name: 'Local Produce Co-op',  code: 'LOCAL',  contactName: 'Sarah Tran',    email: 'hello@localcoop.example.com', phone: '+12075552008', website: null,                             terms: 'COD',     leadTimeDays: 1, minOrderAmount: 100, orderFrequency: 'daily',    deliveryDays: ['Monday','Wednesday','Friday'], address: { street: '47 Riverside Rd', city: 'Portland', state: 'ME', zip: '04102', country: 'USA' },      accountNo: 'LPC-018', aliases: ['Local Co-op', 'Maine Produce Coop'], vendorNotes: 'Farm-direct produce. COD cheque issued at delivery. Order locked 24 hours in advance.' },
];

const PAYMENT_NOTES = [
  'Weekly restock invoice',
  'Back-order fill',
  'Promotional allowance',
  'End-of-month settlement',
  'Cash on delivery',
  'Credit card auth',
  'Monthly terms settlement',
];

export async function seedVendors(orgId = ORG_ID, storeId = STORE_ID) {
  console.log(`\n  🏭 Seeding vendors for org=${orgId} store=${storeId}...`);

  /* ── Vendors ────────────────────────────────────────────────── */
  const existingCount = await prisma.vendor.count({ where: { orgId } });
  let vendors;
  if (existingCount >= VENDORS.length) {
    console.log(`  ✓ Vendors already exist (${existingCount}) — backfilling missing optional fields`);
    vendors = await prisma.vendor.findMany({ where: { orgId } });
    // Backfill any missing address/accountNo/aliases/notes on existing rows
    let backfilled = 0;
    for (const row of vendors) {
      const spec = VENDORS.find(v => v.name === row.name);
      if (!spec) continue;
      const patch = {};
      if (!row.address && spec.address)           patch.address     = spec.address;
      if (!row.accountNo && spec.accountNo)       patch.accountNo   = spec.accountNo;
      if ((!row.aliases || row.aliases.length === 0) && spec.aliases?.length) patch.aliases = spec.aliases;
      if (!row.vendorNotes && spec.vendorNotes)   patch.vendorNotes = spec.vendorNotes;
      if (!row.website && spec.website)           patch.website     = spec.website;
      if (!row.contactName && spec.contactName)   patch.contactName = spec.contactName;
      if (Object.keys(patch).length > 0) {
        await prisma.vendor.update({ where: { id: row.id }, data: patch });
        backfilled++;
      }
    }
    if (backfilled > 0) console.log(`    ↳ Backfilled fields on ${backfilled} vendors`);
  } else {
    vendors = [];
    for (const v of VENDORS) {
      const exists = await prisma.vendor.findFirst({ where: { orgId, name: v.name } });
      if (exists) { vendors.push(exists); continue; }
      const row = await prisma.vendor.create({
        data: {
          orgId,
          name: v.name, code: v.code, contactName: v.contactName,
          email: v.email, phone: v.phone, website: v.website, terms: v.terms,
          address: v.address ?? null,
          accountNo: v.accountNo ?? null,
          aliases: v.aliases ?? [],
          vendorNotes: v.vendorNotes ?? null,
          leadTimeDays: v.leadTimeDays, minOrderAmount: v.minOrderAmount,
          orderFrequency: v.orderFrequency, deliveryDays: v.deliveryDays,
          active: true,
        },
      });
      vendors.push(row);
    }
    console.log(`  ✓ ${vendors.length} vendors seeded`);
  }

  /* ── Vendor Payments ───────────────────────────────────────── */
  const payExisting = await prisma.vendorPayment.count({ where: { orgId, storeId } });
  if (payExisting >= 10) {
    console.log(`  ✓ Vendor payments already exist (${payExisting}) — skipping`);
  } else {
    const creator = await prisma.user.findFirst({ where: { orgId } });
    if (creator) {
      let pCount = 0;
      for (let i = 0; i < 12; i++) {
        const v = pick(vendors);
        await prisma.vendorPayment.create({
          data: {
            orgId, storeId,
            vendorId: v.id,
            vendorName: v.name,
            amount: rand(5000, 150000) / 100, // $50-$1500
            paymentType: pick(['expense', 'merchandise', 'expense']),
            tenderMethod: pick(['cash', 'cheque', 'bank_transfer', 'credit_card']),
            notes: pick(PAYMENT_NOTES),
            paymentDate: daysAgo(rand(0, 45)),
            createdById: creator.id,
          },
        });
        pCount++;
      }
      console.log(`  ✓ ${pCount} vendor payments seeded`);
    }
  }

  /* ── Purchase Orders + Items ───────────────────────────────── */
  const poExisting = await prisma.purchaseOrder.count({ where: { orgId, storeId } });
  if (poExisting >= 8) {
    console.log(`  ✓ Purchase orders already exist (${poExisting}) — skipping`);
  } else {
    const creator = await prisma.user.findFirst({ where: { orgId } });
    const products = await prisma.masterProduct.findMany({
      where: { orgId, active: true, deleted: false, defaultCostPrice: { gt: 0 } },
      take: 60,
    });
    if (!creator || products.length === 0) {
      console.log('  ⚠ Cannot seed POs — no users or products for this org');
    } else {
      const statuses = ['draft', 'draft', 'submitted', 'submitted', 'partial', 'received', 'received', 'received', 'received', 'received', 'cancelled'];
      const stamp = Date.now().toString(36).slice(-4).toUpperCase();
      let poCount = 0, itemCount = 0;

      for (let i = 0; i < 12; i++) {
        const v = pick(vendors);
        const status = statuses[i] || 'draft';
        const daysBack = rand(1, 40);
        const orderDate = daysAgo(daysBack);
        const expectedDate = new Date(orderDate.getTime() + (v.leadTimeDays || 3) * 86400000);
        const receivedDate = ['received', 'partial'].includes(status) ? new Date(expectedDate.getTime() + rand(-1, 1) * 86400000) : null;

        // Build line items
        const lineCount = rand(3, 6);
        const chosen = new Set();
        const items = [];
        let subtotal = 0;

        for (let k = 0; k < lineCount; k++) {
          const p = pick(products);
          if (chosen.has(p.id)) continue;
          chosen.add(p.id);
          const qtyCases = rand(1, 8);
          const casePack = 12;
          const qtyOrdered = qtyCases * casePack;
          const unitCost = Number(p.defaultCostPrice || 1);
          const lineTotal = Math.round(unitCost * qtyOrdered * 100) / 100;
          subtotal += lineTotal;
          const qtyReceived = status === 'received' ? qtyOrdered : status === 'partial' ? Math.floor(qtyOrdered * 0.7) : 0;
          items.push({
            masterProductId: p.id,
            qtyOrdered, qtyCases, qtyReceived,
            unitCost, caseCost: unitCost * casePack,
            lineTotal,
          });
        }

        const taxTotal = Math.round(subtotal * 0.055 * 100) / 100;
        const grandTotal = subtotal + taxTotal;

        const po = await prisma.purchaseOrder.create({
          data: {
            orgId, storeId, vendorId: v.id,
            poNumber: `PO-${orderDate.toISOString().slice(0, 10).replace(/-/g, '')}-${stamp}${String(i + 1).padStart(2, '0')}`,
            status,
            orderDate, expectedDate, receivedDate,
            subtotal, taxTotal, grandTotal,
            notes: i % 3 === 0 ? 'Auto-suggested reorder based on velocity' : null,
            generatedBy: i % 4 === 0 ? 'auto' : 'manual',
            createdById: creator.id,
            receivedById: receivedDate ? creator.id : null,
          },
        });

        for (const item of items) {
          await prisma.purchaseOrderItem.create({
            data: { orderId: po.id, ...item },
          });
          itemCount++;
        }
        poCount++;
      }
      console.log(`  ✓ ${poCount} purchase orders with ${itemCount} line items seeded`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedVendors()
    .catch((e) => { console.error('✗ seedVendors failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
