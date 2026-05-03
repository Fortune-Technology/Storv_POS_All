// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * seedOperations.js — Seeds runtime-produced operational data so the Reports
 * & Analytics pages (Transactions, Employee Reports, End-of-Day, Audit Log)
 * show meaningful data on first load.
 *
 * Populates:
 *   • ClockEvent — 2-3 days of clock-in/out per employee
 *   • Shift      — 5-7 past shifts with opening/closing cash + expected totals
 *   • CashDrop   — 1-2 drops per shift
 *   • CashPayout — 0-1 payouts per shift (tied to a vendor)
 *   • AuditLog   — ~40 representative admin actions
 *
 * Idempotent per store.
 *
 * Usage: node prisma/seedOperations.js [orgId] [storeId]
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

const rand    = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const pick    = (a) => a[Math.floor(Math.random() * a.length)];
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

const AUDIT_ACTIONS = [
  { action: 'create',    entity: 'product',     detail: 'Added new product to catalog' },
  { action: 'update',    entity: 'product',     detail: 'Changed retail price' },
  { action: 'delete',    entity: 'product',     detail: 'Removed discontinued SKU' },
  { action: 'create',    entity: 'customer',    detail: 'Enrolled loyalty customer at register' },
  { action: 'update',    entity: 'customer',    detail: 'Updated balance limit' },
  { action: 'create',    entity: 'vendor',      detail: 'Onboarded new supplier' },
  { action: 'update',    entity: 'vendor',      detail: 'Updated lead-time to 3 days' },
  { action: 'create',    entity: 'promotion',   detail: 'Created BOGO promotion' },
  { action: 'update',    entity: 'promotion',   detail: 'Extended promo end date' },
  { action: 'create',    entity: 'purchaseOrder', detail: 'Generated reorder PO from velocity algorithm' },
  { action: 'submit',    entity: 'purchaseOrder', detail: 'Submitted PO to vendor' },
  { action: 'receive',   entity: 'purchaseOrder', detail: 'Recorded received quantities' },
  { action: 'create',    entity: 'department',  detail: 'Added new department' },
  { action: 'login',     entity: 'user',        detail: 'Signed in to back-office' },
  { action: 'logout',    entity: 'user',        detail: 'Signed out' },
  { action: 'pin_login', entity: 'user',        detail: 'Manager PIN unlock' },
  { action: 'create',    entity: 'lotteryGame', detail: 'Added new scratch-ticket game' },
  { action: 'activate',  entity: 'lotteryBox',  detail: 'Activated box B001 at slot 1' },
  { action: 'deplete',   entity: 'lotteryBox',  detail: 'Closed depleted box' },
  { action: 'create',    entity: 'task',        detail: 'Assigned cleaning task to staff' },
  { action: 'complete',  entity: 'task',        detail: 'Marked task as complete' },
  { action: 'create',    entity: 'shift',       detail: 'Opened register drawer' },
  { action: 'close',     entity: 'shift',       detail: 'Closed shift with $0.00 variance' },
  { action: 'drop',      entity: 'cashDrop',    detail: 'Recorded cash drop to safe' },
  { action: 'payout',    entity: 'cashPayout',  detail: 'Recorded vendor payout' },
  { action: 'refund',    entity: 'transaction', detail: 'Approved refund for transaction' },
  { action: 'void',      entity: 'transaction', detail: 'Voided transaction at register' },
  { action: 'update',    entity: 'taxRule',     detail: 'Changed alcohol tax rate' },
  { action: 'update',    entity: 'depositRule', detail: 'Updated CRV deposit amount' },
  { action: 'enable',    entity: 'storeSettings', detail: 'Enabled lottery cash-only mode' },
];

export async function seedOperations(orgId = ORG_ID, storeId = STORE_ID) {
  console.log(`\n  📊 Seeding operations (shifts / clock / audit) for org=${orgId} store=${storeId}...`);

  const users = await prisma.user.findMany({ where: { orgId }, select: { id: true, name: true, role: true } });
  if (users.length === 0) {
    console.log('  ⚠ No users for org — skipping');
    return;
  }
  const cashier = users.find(u => u.role === 'cashier') || users[0];
  const manager = users.find(u => u.role === 'manager') || users.find(u => u.role === 'owner') || users[0];

  /* ── ClockEvent ────────────────────────────────────────────── */
  const ceExisting = await prisma.clockEvent.count({ where: { orgId, storeId } });
  if (ceExisting >= 10) {
    console.log(`  ✓ Clock events already exist (${ceExisting}) — skipping`);
  } else {
    let created = 0;
    // Include all non-superadmin users; if org has only owner/admin seats, we
    // still want them to clock in so Employee Reports isn't empty.
    const clockUsers = users.filter(u => u.role !== 'superadmin');
    const employees  = clockUsers.filter(u => ['cashier','staff','manager'].includes(u.role));
    const whoClocks  = employees.length > 0 ? employees : clockUsers;
    for (let d = 6; d >= 1; d--) {
      for (const u of whoClocks) {
        const base = daysAgo(d);
        base.setHours(8, rand(0, 30), 0, 0);
        await prisma.clockEvent.create({
          data: { orgId, storeId, userId: u.id, type: 'in', createdAt: new Date(base) },
        });
        const out = new Date(base);
        out.setHours(16 + rand(0, 2), rand(0, 59), 0, 0);
        await prisma.clockEvent.create({
          data: { orgId, storeId, userId: u.id, type: 'out', createdAt: out },
        });
        created += 2;
      }
    }
    console.log(`  ✓ ${created} clock events seeded`);
  }

  /* ── Shifts + Cash Drops/Payouts ──────────────────────────── */
  const shiftExisting = await prisma.shift.count({ where: { orgId, storeId } });
  if (shiftExisting >= 5) {
    console.log(`  ✓ Shifts already exist (${shiftExisting}) — skipping`);
  } else {
    const vendors = await prisma.vendor.findMany({ where: { orgId }, take: 3 });
    let sCount = 0, dropCount = 0, payoutCount = 0;
    for (let d = 6; d >= 1; d--) {
      const opened = daysAgo(d);
      opened.setHours(7, rand(30, 59), 0, 0);
      const closed = new Date(opened);
      closed.setHours(19 + rand(0, 3), rand(0, 59), 0, 0);

      const openingAmt = pick([100, 150, 200, 250]);
      const cashSales  = rand(30000, 120000) / 100;      // $300-$1200
      const cashRefunds = rand(0, 500) / 100;            // $0-$5
      const drops      = rand(0, 20000) / 100;           // $0-$200
      const payouts    = rand(0, 15000) / 100;           // $0-$150
      const expected   = openingAmt + cashSales - cashRefunds - drops - payouts;
      const variance   = (Math.random() * 4 - 2);        // -$2 to +$2
      const closingAmt = Math.round((expected + variance) * 100) / 100;

      const shift = await prisma.shift.create({
        data: {
          orgId, storeId,
          cashierId:     cashier.id,
          closedById:    manager.id,
          status:        'closed',
          openedAt:      opened,
          closedAt:      closed,
          openingAmount: openingAmt,
          closingAmount: closingAmt,
          expectedAmount: expected,
          variance:      Math.round(variance * 100) / 100,
          cashSales:     cashSales,
          cashRefunds:   cashRefunds,
          cashDropsTotal: drops,
          payoutsTotal:  payouts,
          openingNote:   'Started shift — counted drawer',
          closingNote:   variance > 1 ? 'Over by $' + variance.toFixed(2) : variance < -1 ? 'Short by $' + Math.abs(variance).toFixed(2) : 'Balanced',
          createdAt:     opened,
          updatedAt:     closed,
        },
      });
      sCount++;

      // Cash drops (1-2 per shift, evenly during the day)
      if (drops > 0) {
        const dropAmt = drops;
        await prisma.cashDrop.create({
          data: {
            orgId, shiftId: shift.id,
            amount: dropAmt,
            note: 'Midday drop to safe',
            createdById: cashier.id,
            createdAt: new Date(opened.getTime() + 5 * 3600000),
          },
        });
        dropCount++;
      }

      // Cash payouts (0-1 per shift, to a vendor)
      if (payouts > 0 && vendors.length > 0) {
        const v = pick(vendors);
        await prisma.cashPayout.create({
          data: {
            orgId, shiftId: shift.id,
            amount: payouts,
            recipient: v.name,
            vendorId: v.id,
            payoutType: pick(['vendor', 'expense']),
            note: 'Paid vendor from drawer',
            createdById: cashier.id,
            createdAt: new Date(opened.getTime() + 8 * 3600000),
          },
        });
        payoutCount++;
      }
    }
    console.log(`  ✓ ${sCount} shifts, ${dropCount} cash drops, ${payoutCount} payouts seeded`);
  }

  /* ── Audit Log ─────────────────────────────────────────────── */
  const alExisting = await prisma.auditLog.count({ where: { orgId, storeId } });
  if (alExisting >= 30) {
    console.log(`  ✓ Audit log entries already exist (${alExisting}) — skipping`);
  } else {
    let created = 0;
    const now = Date.now();
    for (let i = 0; i < 40; i++) {
      const a = pick(AUDIT_ACTIONS);
      const u = pick(users);
      const when = new Date(now - Math.random() * 14 * 86400000);
      await prisma.auditLog.create({
        data: {
          orgId, storeId,
          userId:    u.id,
          userName:  u.name,
          userRole:  u.role,
          action:    a.action,
          entity:    a.entity,
          entityId:  String(rand(1, 500)),
          details:   { summary: a.detail, actor: u.name },
          ipAddress: `192.168.${rand(1, 254)}.${rand(1, 254)}`,
          userAgent: pick(['Mozilla/5.0 Chrome/122.0', 'Mozilla/5.0 Safari/17.2', 'Mozilla/5.0 Firefox/123.0']),
          source:    pick(['portal', 'cashier', 'admin']),
          createdAt: when,
        },
      });
      created++;
    }
    console.log(`  ✓ ${created} audit log entries seeded`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedOperations()
    .catch((e) => { console.error('✗ seedOperations failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
