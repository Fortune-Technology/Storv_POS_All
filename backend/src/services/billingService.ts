/**
 * billingService.ts
 * Core billing calculations and charge execution.
 * Storeveu acts as the merchant for subscription and equipment payments.
 */

import prisma from '../config/postgres.js';

// Renamed to STOREVEU_ORG_ID for brand consistency. Falls back to the legacy
// STORV_ORG_ID env var so existing production deploys keep working until the
// server's .env file is updated.
const _STOREVEU_ORG_ID = process.env.STOREVEU_ORG_ID || process.env.STORV_ORG_ID;
export const FREE_SHIPPING_THRESHOLD = 500;
export const FLAT_SHIPPING = 25;

// ── Invoice number sequence ──────────────────────────────────────────────────
export async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.billingInvoice.count({
    where: { invoiceNumber: { startsWith: `INV-${year}-` } },
  });
  return `INV-${year}-${String(count + 1).padStart(5, '0')}`;
}

// ── Equipment order number sequence ──────────────────────────────────────────
export async function nextOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.equipmentOrder.count({
    where: { orderNumber: { startsWith: `EQ-${year}-` } },
  });
  return `EQ-${year}-${String(count + 1).padStart(5, '0')}`;
}

interface PlanLike {
  basePrice: number | string;
  pricePerStore: number | string;
  pricePerRegister: number | string;
  includedStores: number;
  includedRegisters: number;
  addons?: Array<{ key: string; price: number | string }> | null;
}

interface SubscriptionLike {
  plan: PlanLike;
  basePriceOverride?: number | string | null;
  storeCount: number;
  registerCount: number;
  extraAddons?: string[] | null;
  discountType?: string | null;
  discountValue?: number | string | null;
  discountExpiry?: Date | string | null;
}

export interface InvoiceAmount {
  base: number;
  discount: number;
  total: number;
}

// ── Calculate monthly invoice amount ─────────────────────────────────────────
export function calculateInvoiceAmount(subscription: SubscriptionLike): InvoiceAmount {
  const plan = subscription.plan;

  // Base price (per-org override or plan default)
  let base = Number(subscription.basePriceOverride ?? plan.basePrice);

  // Extra stores/registers beyond plan included counts
  const extraStores = Math.max(0, subscription.storeCount - plan.includedStores);
  const extraRegs   = Math.max(0, subscription.registerCount - plan.includedRegisters);
  base += extraStores * Number(plan.pricePerStore);
  base += extraRegs   * Number(plan.pricePerRegister);

  // Add-ons selected by this org
  const addonTotal = (subscription.extraAddons || []).reduce((sum, key) => {
    const addon = (plan.addons || []).find(a => a.key === key);
    return sum + (addon ? Number(addon.price) : 0);
  }, 0);
  base += addonTotal;

  // Discount (fixed or percent, optionally time-limited)
  let discount = 0;
  if (subscription.discountType && subscription.discountValue) {
    const expiry = subscription.discountExpiry;
    if (!expiry || new Date(expiry) > new Date()) {
      if (subscription.discountType === 'fixed') {
        discount = Math.min(Number(subscription.discountValue), base);
      } else if (subscription.discountType === 'percent') {
        discount = base * (Number(subscription.discountValue) / 100);
      }
    }
  }

  const total = Math.max(0, base - discount);
  return { base, discount, total };
}

// ── Subscription + equipment charging ───────────────────────────────────────
// Platform billing (Storeveu-level, not merchant-level) is now unimplemented.
// These were previously wired to CardPointe; will be replaced with Dejavoo
// iPOS Transact (tokenized card-on-file) in a future sprint.
// Throwing explicit "not configured" so callers fail loudly instead of silently.

export async function chargeSubscription(): Promise<never> {
  throw new Error('Platform billing not configured — Dejavoo Transact integration pending');
}

export async function chargeEquipmentOrder(): Promise<never> {
  throw new Error('Platform billing not configured — Dejavoo Transact integration pending');
}

// ─────────────────────────────────────────────────
// S80 Phase 3b — per-store invoice generation
// ─────────────────────────────────────────────────

/**
 * Compute monthly amount for a StoreSubscription. Same shape as
 * `calculateInvoiceAmount` but adapted to per-store sub field set:
 *   base = (basePriceOverride ?? plan.basePrice)
 *        + extra registers (registerCount - includedRegisters) * pricePerRegister
 *        + sum of purchased addon prices
 *   discount applied last (fixed or %, optional expiry)
 *
 * NOTE: includedStores doesn't apply per-store (each store is its own sub).
 */
export interface StoreSubscriptionForInvoice {
  basePriceOverride?: number | string | null;
  registerCount: number;
  extraAddons: string[];
  discountType?: string | null;
  discountValue?: number | string | null;
  discountExpiry?: Date | string | null;
  plan: {
    basePrice: number | string;
    pricePerRegister: number | string;
    includedRegisters: number;
    addons: Array<{ key: string; price: number | string }>;
  };
}

export function calculateStoreInvoiceAmount(sub: StoreSubscriptionForInvoice): InvoiceAmount {
  const plan = sub.plan;
  let base = Number(sub.basePriceOverride ?? plan.basePrice);

  const extraRegs = Math.max(0, sub.registerCount - plan.includedRegisters);
  base += extraRegs * Number(plan.pricePerRegister);

  const addonTotal = (sub.extraAddons || []).reduce((sum, key) => {
    const addon = plan.addons.find(a => a.key === key);
    return sum + (addon ? Number(addon.price) : 0);
  }, 0);
  base += addonTotal;

  let discount = 0;
  if (sub.discountType && sub.discountValue) {
    const expiry = sub.discountExpiry;
    if (!expiry || new Date(expiry) > new Date()) {
      if (sub.discountType === 'fixed') {
        discount = Math.min(Number(sub.discountValue), base);
      } else if (sub.discountType === 'percent') {
        discount = base * (Number(sub.discountValue) / 100);
      }
    }
  }

  const total = Math.max(0, base - discount);
  return { base, discount, total };
}

/**
 * Generate one BillingInvoice for a StoreSubscription's current period.
 * Idempotent on (storeSubscriptionId, periodStart) — won't double-issue.
 *
 * Called by:
 *   1. Trial-end transitions (scheduler flips trial → active and issues first invoice)
 *   2. Period roll (scheduler advances currentPeriodStart/End and issues next invoice)
 *   3. Admin "Generate Now" (test mode)
 */
export async function generateStoreInvoice(storeSubscriptionId: string): Promise<{ invoice: any; amount: InvoiceAmount }> {
  // Use raw query to fetch sub + plan + addons since the typed Prisma client
  // may not yet include the new fields (DLL lock during dev). We just need
  // the right data to pass to calculateStoreInvoiceAmount.
  const sub: any = await (prisma as any).storeSubscription.findUnique({
    where: { id: storeSubscriptionId },
    include: {
      plan: { include: { addons: { where: { isActive: true } } } },
    },
  });
  if (!sub) throw new Error('StoreSubscription not found.');

  const periodStart = sub.currentPeriodStart || new Date();
  const periodEnd = sub.currentPeriodEnd || new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Idempotency: if an invoice already exists for this period, return it.
  // Raw SQL because the Prisma client may not have been regenerated yet
  // after adding `storeSubscriptionId` to BillingInvoice (DLL lock).
  const existingRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, "invoiceNumber", "baseAmount", "discountAmount", "totalAmount", status, "periodStart", "periodEnd", "paidAt", "createdAt"
       FROM billing_invoices
      WHERE "storeSubscriptionId" = $1
        AND "periodStart" >= $2 AND "periodEnd" <= $3
      LIMIT 1`,
    storeSubscriptionId,
    new Date(periodStart.getTime() - 1000),
    new Date(periodEnd.getTime() + 1000),
  );
  if (existingRows.length > 0) {
    const existing = existingRows[0];
    return {
      invoice: existing,
      amount: {
        base: Number(existing.baseAmount),
        discount: Number(existing.discountAmount),
        total: Number(existing.totalAmount),
      },
    };
  }

  const amount = calculateStoreInvoiceAmount({
    basePriceOverride: sub.basePriceOverride,
    registerCount: sub.registerCount,
    extraAddons: sub.extraAddons || [],
    discountType: sub.discountType,
    discountValue: sub.discountValue,
    discountExpiry: sub.discountExpiry,
    plan: {
      basePrice: sub.plan.basePrice,
      pricePerRegister: sub.plan.pricePerRegister,
      includedRegisters: sub.plan.includedRegisters,
      addons: sub.plan.addons || [],
    },
  });

  const invoiceNumber = await nextInvoiceNumber();
  // Raw INSERT to support the new column without typed-client regen.
  const inserted: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO billing_invoices (
       id, "invoiceNumber", "storeSubscriptionId", "subscriptionId",
       "periodStart", "periodEnd",
       "baseAmount", "discountAmount", "totalAmount",
       status, attempts,
       "createdAt", "updatedAt"
     ) VALUES (
       gen_random_uuid()::text, $1, $2, NULL,
       $3, $4,
       $5, $6, $7,
       'pending', 0,
       NOW(), NOW()
     )
     RETURNING id, "invoiceNumber", "baseAmount", "discountAmount", "totalAmount", status, "periodStart", "periodEnd", "paidAt", "createdAt"`,
    invoiceNumber, storeSubscriptionId,
    periodStart, periodEnd,
    amount.base, amount.discount, amount.total,
  );
  const invoice = inserted[0];

  return { invoice, amount };
}

/**
 * "Mark Paid" — test-mode payment bypass. Flips invoice status to 'paid'
 * and (if needed) flips the subscription from trial → active. Used during
 * onboarding QA before Dejavoo integration lands.
 *
 * Returns the updated invoice + the (possibly updated) subscription state.
 */
export async function markInvoicePaidTestMode(invoiceId: string, note?: string): Promise<{ invoice: any; subscription: any }> {
  // Raw SELECT to read the new storeSubscriptionId column even when the
  // typed Prisma client hasn't been regenerated.
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, status, attempts, notes, "storeSubscriptionId", "subscriptionId"
       FROM billing_invoices
      WHERE id = $1
      LIMIT 1`,
    invoiceId,
  );
  const inv = rows[0];
  if (!inv) throw new Error('Invoice not found.');
  if (inv.status === 'paid') {
    return { invoice: inv, subscription: null };
  }

  const newNote = note
    ? `${inv.notes ? inv.notes + ' · ' : ''}TEST-MODE: ${note}`
    : `${inv.notes ? inv.notes + ' · ' : ''}TEST-MODE: marked paid`;

  const updatedRows: any[] = await prisma.$queryRawUnsafe(
    `UPDATE billing_invoices
        SET status='paid', "paidAt"=NOW(), attempts=$1, "lastAttemptAt"=NOW(), notes=$2, "updatedAt"=NOW()
      WHERE id=$3
      RETURNING id, "invoiceNumber", status, "paidAt", "totalAmount", "storeSubscriptionId"`,
    (inv.attempts || 0) + 1, newNote, invoiceId,
  );
  const updatedInvoice = updatedRows[0];

  // If linked to a StoreSubscription and that sub is in trial/past_due, flip to active
  let updatedSub: any = null;
  if (updatedInvoice.storeSubscriptionId) {
    const sub = await (prisma as any).storeSubscription.findUnique({
      where: { id: updatedInvoice.storeSubscriptionId },
    });
    if (sub && (sub.status === 'trial' || sub.status === 'past_due')) {
      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      updatedSub = await (prisma as any).storeSubscription.update({
        where: { id: updatedInvoice.storeSubscriptionId },
        data: {
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          retryCount: 0,
          nextRetryAt: null,
          lastFailedAt: null,
        },
      });
    }
  }

  return { invoice: updatedInvoice, subscription: updatedSub };
}
