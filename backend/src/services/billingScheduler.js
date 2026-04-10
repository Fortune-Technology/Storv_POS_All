/**
 * billingScheduler.js
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

import prisma from '../config/postgres.js';
import {
  calculateInvoiceAmount,
  chargeSubscription,
  nextInvoiceNumber,
} from './billingService.js';

// Days to wait before each retry attempt
const RETRY_DELAYS = [3, 4];

// ── Scheduler bootstrap ───────────────────────────────────────────────────────
function scheduleDaily(hour, minute, fn) {
  const now  = new Date();
  const next = new Date();
  next.setUTCHours(hour, minute, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next - now;
  setTimeout(() => {
    fn();
    setInterval(fn, 24 * 60 * 60 * 1000);
  }, delay);
}

export function startBillingScheduler() {
  console.log('✓ Billing scheduler started — runs daily at 02:00 UTC');
  scheduleDaily(2, 0, runBillingCycle);
}

// ── Main cycle ────────────────────────────────────────────────────────────────
export async function runBillingCycle() {
  console.log(`[Billing] Cycle start ${new Date().toISOString()}`);
  try {
    await processTrialExpirations();
    await processNewBills();
    await processRetries();
    console.log('[Billing] Cycle complete');
  } catch (err) {
    console.error('[Billing] Cycle error:', err.message);
  }
}

// ── Trial expiry ──────────────────────────────────────────────────────────────
async function processTrialExpirations() {
  const expired = await prisma.orgSubscription.findMany({
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
async function processNewBills() {
  const today = new Date();
  const subs  = await prisma.orgSubscription.findMany({
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
async function processRetries() {
  const today = new Date();
  const subs  = await prisma.orgSubscription.findMany({
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
    const invoice = await prisma.billingInvoice.findFirst({
      where:   { subscriptionId: sub.id, status: { in: ['pending', 'failed'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (invoice) await attemptCharge(sub, invoice);
  }
}

// ── Create invoice and attempt charge ────────────────────────────────────────
async function billSubscription(sub) {
  const { base, discount, total } = calculateInvoiceAmount(sub);
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
async function attemptCharge(sub, invoice) {
  try {
    const result = await chargeSubscription(
      sub,
      Number(invoice.totalAmount),
      invoice.invoiceNumber,
    );

    // ✅ Success
    await prisma.billingInvoice.update({
      where: { id: invoice.id },
      data:  {
        status:        'paid',
        paidAt:        new Date(),
        retref:        result.retref,
        authcode:      result.authcode,
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
      console.error(`[Billing] ✗ Failed for ${sub.orgId}, retry #${newRetryCount} scheduled ${nextRetry.toISOString()}: ${err.message}`);
    }
  }
}
