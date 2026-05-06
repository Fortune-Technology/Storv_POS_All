/**
 * billingScheduler.ts
 * Daily billing cycle — runs at 02:00 UTC.
 *
 * Flow:
 *   1. Trial expiry   → charge first invoice (or suspend if no payment method)
 *   2. New bills      → charge active subs whose billing period ended
 *   3. Retry failed   → retry past_due subs whose nextRetryAt has arrived
 *
 * Retry schedule (RETRY_DELAYS):
 *   Attempt 1 fails → wait 3 days → attempt 2
 *   Attempt 2 fails → wait 4 days → attempt 3
 *   Attempt 3 fails → suspend org
 */

import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import {
  calculateInvoiceAmount,
  chargeSubscription,
  nextInvoiceNumber,
} from './billingService.js';

// Days to wait before each retry attempt
const RETRY_DELAYS: number[] = [3, 4];

// Subscription rows include the plan + addons + organization (matches the
// `SubscriptionLike` shape consumed by `calculateInvoiceAmount`).
type SubscriptionWithPlan = Prisma.OrgSubscriptionGetPayload<{
  include: {
    plan: { include: { addons: true } };
    organization: true;
  };
}>;

type BillingInvoiceRow = Prisma.BillingInvoiceGetPayload<true>;

// ── Scheduler bootstrap ───────────────────────────────────────────────────────
function scheduleDaily(hour: number, minute: number, fn: () => void): void {
  const now  = new Date();
  const next = new Date();
  next.setUTCHours(hour, minute, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next.getTime() - now.getTime();
  setTimeout(() => {
    fn();
    setInterval(fn, 24 * 60 * 60 * 1000);
  }, delay);
}

export function startBillingScheduler(): void {
  console.log('✓ Billing scheduler started — runs daily at 02:00 UTC');
  scheduleDaily(2, 0, runBillingCycle);
}

// ── Main cycle ────────────────────────────────────────────────────────────────
export async function runBillingCycle(): Promise<void> {
  console.log(`[Billing] Cycle start ${new Date().toISOString()}`);
  try {
    await processTrialExpirations();
    await processNewBills();
    await processRetries();
    // S80 Phase 3b — per-store cycle (runs alongside legacy org-level cycle)
    await processStoreSubscriptionCycle();
    console.log('[Billing] Cycle complete');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Billing] Cycle error:', message);
  }
}

// ── Trial expiry ──────────────────────────────────────────────────────────────
async function processTrialExpirations(): Promise<void> {
  const expired: SubscriptionWithPlan[] = await prisma.orgSubscription.findMany({
    where: {
      status: 'trial',
      trialEndsAt: { lte: new Date() },
    },
    include: {
      plan:         { include: { addons: true } },
      organization: true,
    },
  });

  for (const sub of expired) {
    if (!sub.paymentToken) {
      await prisma.orgSubscription.update({
        where: { id: sub.id },
        data:  { status: 'suspended' },
      });
      console.log(`[Billing] Suspended (no payment method post-trial): ${sub.orgId}`);
      continue;
    }
    await billSubscription(sub);
  }
}

// ── New billing period ────────────────────────────────────────────────────────
async function processNewBills(): Promise<void> {
  const today = new Date();
  const subs: SubscriptionWithPlan[] = await prisma.orgSubscription.findMany({
    where: {
      status:           'active',
      currentPeriodEnd: { lte: today },
    },
    include: {
      plan:         { include: { addons: true } },
      organization: true,
    },
  });

  for (const sub of subs) {
    await billSubscription(sub);
  }
}

// ── Retry past_due subs ───────────────────────────────────────────────────────
async function processRetries(): Promise<void> {
  const today = new Date();
  const subs: SubscriptionWithPlan[] = await prisma.orgSubscription.findMany({
    where: {
      status:       'past_due',
      nextRetryAt:  { lte: today },
    },
    include: {
      plan:         { include: { addons: true } },
      organization: true,
    },
  });

  for (const sub of subs) {
    const invoice: BillingInvoiceRow | null = await prisma.billingInvoice.findFirst({
      where:   { subscriptionId: sub.id, status: { in: ['pending', 'failed'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (invoice) await attemptCharge(sub, invoice);
  }
}

// ── Create invoice and attempt charge ────────────────────────────────────────
async function billSubscription(sub: SubscriptionWithPlan): Promise<void> {
  // calculateInvoiceAmount accepts a SubscriptionLike (loose duck type) — the
  // SubscriptionWithPlan shape carries the same fields plus extras.
  const { base, discount, total } = calculateInvoiceAmount(sub as unknown as Parameters<typeof calculateInvoiceAmount>[0]);
  const invoiceNumber = await nextInvoiceNumber();

  const now         = new Date();
  const periodStart = sub.currentPeriodEnd || now;
  const periodEnd   = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const invoice = await prisma.billingInvoice.create({
    data: {
      invoiceNumber,
      subscriptionId: sub.id,
      periodStart,
      periodEnd,
      baseAmount:     base,
      discountAmount: discount,
      totalAmount:    total,
      status:         'pending',
    },
  });

  await attemptCharge(sub, invoice);
}

// ── Attempt to charge a specific invoice ─────────────────────────────────────
async function attemptCharge(sub: SubscriptionWithPlan, invoice: BillingInvoiceRow): Promise<void> {
  try {
    // chargeSubscription always throws today (Dejavoo Transact wiring pending) —
    // the success path below is unreachable until the integration ships.
    const result = await chargeSubscription();

    // ✅ Success (currently unreachable — `result` is `never`)
    await prisma.billingInvoice.update({
      where: { id: invoice.id },
      data:  {
        status:        'paid',
        paidAt:        new Date(),
        retref:        (result as unknown as { retref?: string }).retref,
        authcode:      (result as unknown as { authcode?: string }).authcode,
        attempts:      { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });

    const periodEnd = new Date(invoice.periodEnd);
    await prisma.orgSubscription.update({
      where: { id: sub.id },
      data:  {
        status:             'active',
        currentPeriodStart: invoice.periodStart,
        currentPeriodEnd:   periodEnd,
        retryCount:         0,
        lastFailedAt:       null,
        nextRetryAt:        null,
      },
    });

    console.log(`[Billing] ✓ ${invoice.invoiceNumber} — $${invoice.totalAmount} charged for ${sub.orgId}`);
  } catch (err) {
    // ❌ Failure
    await prisma.billingInvoice.update({
      where: { id: invoice.id },
      data:  {
        status:        'failed',
        attempts:      { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });

    const newRetryCount = sub.retryCount + 1;

    if (newRetryCount > RETRY_DELAYS.length) {
      // Exhausted all retries → suspend
      await prisma.orgSubscription.update({
        where: { id: sub.id },
        data:  {
          status:       'suspended',
          retryCount:   newRetryCount,
          lastFailedAt: new Date(),
          nextRetryAt:  null,
        },
      });
      console.error(`[Billing] ✗ SUSPENDED ${sub.orgId} after ${newRetryCount} failed attempts`);
    } else {
      // Schedule next retry
      const daysUntil = RETRY_DELAYS[newRetryCount - 1] || 3;
      const nextRetry = new Date();
      nextRetry.setDate(nextRetry.getDate() + daysUntil);

      await prisma.orgSubscription.update({
        where: { id: sub.id },
        data:  {
          status:       'past_due',
          retryCount:   newRetryCount,
          lastFailedAt: new Date(),
          nextRetryAt:  nextRetry,
        },
      });
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Billing] ✗ Failed for ${sub.orgId}, retry #${newRetryCount} scheduled ${nextRetry.toISOString()}: ${message}`);
    }
  }
}

// ─────────────────────────────────────────────────
// S80 Phase 3b — Per-store subscription cycle
//
// Runs alongside the legacy org-level cycle. Until Dejavoo integration lands,
// this scheduler does NOT auto-charge. Trial expiry flips status to 'past_due'
// and generates the first invoice (admin marks paid in test mode). Active
// subs whose period ends get the next invoice generated; status flips to
// past_due if previous invoice is still pending.
// ─────────────────────────────────────────────────
async function processStoreSubscriptionCycle(): Promise<void> {
  const now = new Date();

  // 1. Trial expirations → flip to past_due + generate first invoice
  const expiredTrials: any[] = await (prisma as any).storeSubscription.findMany({
    where: { status: 'trial', trialEndsAt: { lte: now } },
    include: {
      plan: { include: { addons: { where: { isActive: true } } } },
      store: { select: { id: true, name: true } },
    },
  });
  for (const sub of expiredTrials) {
    try {
      const { generateStoreInvoice } = await import('./billingService.js');
      await generateStoreInvoice(sub.id);
      await (prisma as any).storeSubscription.update({
        where: { id: sub.id },
        data: { status: 'past_due', lastFailedAt: now },
      });
      console.log(`[Billing/store] Trial expired → past_due for ${sub.store?.name || sub.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Billing/store] ✗ Trial expiry handling failed for ${sub.id}: ${message}`);
    }
  }

  // 2. Period rolls — active subs whose currentPeriodEnd has passed get a new invoice
  const dueForBilling: any[] = await (prisma as any).storeSubscription.findMany({
    where: { status: 'active', currentPeriodEnd: { lte: now } },
    include: {
      plan: { include: { addons: { where: { isActive: true } } } },
      store: { select: { id: true, name: true } },
    },
  });
  for (const sub of dueForBilling) {
    try {
      const { generateStoreInvoice } = await import('./billingService.js');
      const { invoice } = await generateStoreInvoice(sub.id);
      // Advance period (next 30 days). Sub stays 'active' for now — payment
      // bypass means we trust admin to mark paid. When Dejavoo lands, this
      // path will charge and flip to past_due on failure.
      await (prisma as any).storeSubscription.update({
        where: { id: sub.id },
        data: {
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      console.log(`[Billing/store] New invoice ${invoice.invoiceNumber} for ${sub.store?.name || sub.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Billing/store] ✗ Bill generation failed for ${sub.id}: ${message}`);
    }
  }
}
