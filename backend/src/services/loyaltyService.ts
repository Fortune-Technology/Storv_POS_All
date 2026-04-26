/**
 * loyaltyService.ts
 *
 * Shared loyalty engine used by:
 *   - posTerminalController.createTransaction / batchCreateTransactions  (earn + redeem)
 *   - posTerminalController.voidTransaction                              (reverse)
 *   - posTerminalController.createRefund                                 (reverse)
 *   - customerController.createCustomer                                  (welcomeBonus)
 *   - services/loyaltyScheduler.js                                       (birthday, expiry)
 *
 * All operations append a structured entry to Customer.pointsHistory so the
 * portal can show a full audit trail. Reasons used in pointsHistory entries:
 *   'earn' | 'redeem' | 'void_reverse' | 'refund_reverse'
 *   'welcome_bonus' | 'birthday_bonus' | 'expired'
 */

import type { PrismaClient } from '@prisma/client';
import realPrisma from '../config/postgres.js';

// Mutable prisma reference so tests can inject an in-memory mock without
// touching the production singleton. Production code never calls setPrisma.
let prisma: PrismaClient = realPrisma;
export function _setPrismaForTests(p: PrismaClient | null | undefined): void {
  prisma = p || realPrisma;
}

// ─── Domain shapes ──────────────────────────────────────────────────────────
export type PointsReason =
  | 'earn'
  | 'redeem'
  | 'void_reverse'
  | 'refund_reverse'
  | 'welcome_bonus'
  | 'birthday_bonus'
  | 'expired';

export interface PointsHistoryEntry {
  date: string;
  reason: PointsReason | string;
  delta: number;
  balance: number;
  txId?: string | null;
  txNumber?: string | null;
  meta?: Record<string, unknown>;
}

export interface LineItemForLoyalty {
  productId?: string | number | null;
  departmentId?: string | number | null;
  qty?: number | null;
  lineTotal?: number | null;
  isLottery?: boolean;
  isFuel?: boolean;
  isBottleReturn?: boolean;
  isBagFee?: boolean;
}

/**
 * Compute the points that would be earned from a given line-item array under
 * the store's current loyalty program + earn rules. Pure function — no DB write.
 * Returns 0 when program is disabled or customer is null.
 */
export async function computePointsEarned(
  { storeId, lineItems }: { storeId: string; lineItems: LineItemForLoyalty[] | null | undefined },
): Promise<number> {
  const program = await prisma.loyaltyProgram.findUnique({ where: { storeId } });
  if (!program || !program.enabled) return 0;

  const earnRules = await prisma.loyaltyEarnRule.findMany({
    where: { storeId, active: true },
  });

  const excludedDepts    = new Set(earnRules.filter((r) => r.targetType === 'department' && r.action === 'exclude').map((r) => r.targetId));
  const excludedProducts = new Set(earnRules.filter((r) => r.targetType === 'product'    && r.action === 'exclude').map((r) => r.targetId));
  const deptMultipliers: Record<string, number> = {};
  const prodMultipliers: Record<string, number> = {};
  earnRules.filter((r) => r.action === 'multiply').forEach((r) => {
    if (r.targetType === 'department') deptMultipliers[r.targetId] = Number(r.multiplier);
    else                               prodMultipliers[r.targetId] = Number(r.multiplier);
  });

  let eligibleSubtotal = 0;
  const items: LineItemForLoyalty[] = Array.isArray(lineItems) ? lineItems : [];
  for (const li of items) {
    const qty = li.qty ?? 0;
    if (li.isLottery || li.isFuel || li.isBottleReturn || li.isBagFee || qty <= 0) continue;
    // Don't earn points on the synthetic refund/return lines.
    if ((li.lineTotal || 0) <= 0) continue;
    const deptId = li.departmentId ? String(li.departmentId) : null;
    const prodId = li.productId    ? String(li.productId)    : null;
    if (deptId && excludedDepts.has(deptId))    continue;
    if (prodId && excludedProducts.has(prodId)) continue;
    let mult = 1;
    if (prodId && prodMultipliers[prodId] !== undefined)      mult = prodMultipliers[prodId];
    else if (deptId && deptMultipliers[deptId] !== undefined) mult = deptMultipliers[deptId];
    eligibleSubtotal += (li.lineTotal || 0) * mult;
  }

  const ptsPerDollar = Number(program.pointsPerDollar);
  return Math.floor(eligibleSubtotal * ptsPerDollar);
}

interface WriteHistoryArgs {
  orgId: string;
  customerId: string;
  delta: number;
  reason: PointsReason | string;
  txId?: string | null;
  txNumber?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Append a points-history entry and update the customer's running balance.
 * Always clamps the new balance to >= 0 (never negative).
 */
async function _writeHistory(
  { orgId, customerId, delta, reason, txId, txNumber, meta }: WriteHistoryArgs,
): Promise<{ newBalance: number; delta: number } | null> {
  const customer = await prisma.customer.findFirst({
    where:  { id: customerId, orgId },
    select: { id: true, loyaltyPoints: true, pointsHistory: true },
  });
  if (!customer) return null;

  const current = customer.loyaltyPoints || 0;
  const newBal  = Math.max(0, current + delta);
  const history: PointsHistoryEntry[] = Array.isArray(customer.pointsHistory)
    ? (customer.pointsHistory as unknown as PointsHistoryEntry[])
    : [];

  const entry: PointsHistoryEntry = {
    date:    new Date().toISOString(),
    reason,
    delta,
    balance: newBal,
    ...(txId ? { txId } : {}),
    ...(txNumber ? { txNumber } : {}),
    ...(meta ? { meta } : {}),
  };

  await prisma.customer.update({
    where: { id: customerId },
    data:  { loyaltyPoints: newBal, pointsHistory: [...history, entry] as unknown as object[] },
  });
  return { newBalance: newBal, delta };
}

/**
 * Award earn + apply redeem for a completed transaction.
 * Net delta = pointsEarned − pointsRedeemed. Records two history entries
 * (earn, redeem) when both are non-zero so the audit trail is granular.
 *
 * Called fire-and-forget from createTransaction / batchCreateTransactions.
 */
export interface ProcessTransactionPointsArgs {
  orgId: string;
  storeId: string;
  customerId: string | null | undefined;
  lineItems: LineItemForLoyalty[] | null | undefined;
  txId: string;
  txNumber?: string | null;
  loyaltyPointsRedeemed?: number | string | null;
}

export async function processTransactionPoints({
  orgId, storeId, customerId, lineItems, txId, txNumber, loyaltyPointsRedeemed,
}: ProcessTransactionPointsArgs): Promise<void> {
  if (!customerId) return;
  const earned   = await computePointsEarned({ storeId, lineItems });
  const redeemed = Math.max(0, parseInt(String(loyaltyPointsRedeemed ?? '0')) || 0);

  if (earned > 0) {
    await _writeHistory({
      orgId, customerId, delta: earned, reason: 'earn', txId, txNumber,
    });
  }
  if (redeemed > 0) {
    await _writeHistory({
      orgId, customerId, delta: -redeemed, reason: 'redeem', txId, txNumber,
    });
  }
}

/**
 * Reverse the loyalty effects of a previously-completed transaction.
 * Used by voidTransaction and createRefund. Reads the original tx's
 * lineItems + customerId + loyaltyPointsRedeemed (stored in tenderLines or
 * a top-level field) and inverts them.
 *
 * Idempotent: looks at pointsHistory and only reverses if the tx isn't
 * already reversed. Guards against double-void / void-then-refund.
 */
export interface OriginalTxLike {
  orgId: string;
  storeId?: string | null;
  lineItems?: LineItemForLoyalty[] | null;
  id: string;
  txNumber?: string | null;
}

export async function reverseTransactionPoints(
  { originalTx, reason = 'void_reverse' }:
    { originalTx: OriginalTxLike | null | undefined; reason?: PointsReason | string },
): Promise<void> {
  if (!originalTx) return;
  const { orgId, id: txId, txNumber } = originalTx;

  // We stored customerId on Transaction via the request body, but the
  // Transaction model itself has no customerId column (yet). The cashier-app
  // sends it in the request and we use it for points processing only. To
  // reverse we need to find the customer via pointsHistory entries that
  // reference this txId.
  const candidates = await prisma.customer.findMany({
    where: {
      orgId,
      pointsHistory: { array_contains: [{ txId }] },
    },
    select: { id: true, pointsHistory: true },
  });

  // Prisma `array_contains` on JSONB doesn't reliably match nested fields
  // with extra keys, so fall back to a scan if zero matches.
  type LoyaltyTargetRow = (typeof candidates)[number];
  let target: LoyaltyTargetRow | undefined = candidates[0];
  if (!target) {
    const all = await prisma.customer.findMany({
      where:  { orgId, deleted: false },
      select: { id: true, pointsHistory: true },
    });
    target = all.find((c) =>
      Array.isArray(c.pointsHistory) &&
      (c.pointsHistory as unknown as PointsHistoryEntry[]).some((h) => h && h.txId === txId)
    );
  }
  if (!target) return; // No customer was attached to this tx — nothing to reverse.

  const history: PointsHistoryEntry[] = Array.isArray(target.pointsHistory)
    ? (target.pointsHistory as unknown as PointsHistoryEntry[])
    : [];
  // Idempotency: skip if any reversal entry already exists for this tx.
  const alreadyReversed = history.some(
    (h) => h && h.txId === txId && (h.reason === 'void_reverse' || h.reason === 'refund_reverse')
  );
  if (alreadyReversed) return;

  // Sum the original net points from this tx.
  const earnedEntry  = history.find((h) => h.txId === txId && h.reason === 'earn');
  const redeemEntry  = history.find((h) => h.txId === txId && h.reason === 'redeem');
  const earnedPts    = earnedEntry?.delta  || 0;   // positive
  const redeemedPts  = Math.abs(redeemEntry?.delta || 0); // positive (originally stored negative)

  if (earnedPts === 0 && redeemedPts === 0) return;

  // Reverse: subtract earned, refund redeemed.
  const netReversal = -earnedPts + redeemedPts;
  await _writeHistory({
    orgId, customerId: target.id, delta: netReversal, reason, txId, txNumber,
    meta: { earnedReversed: earnedPts, redeemedRefunded: redeemedPts },
  });
}

/**
 * Award the welcome bonus when a new customer is created.
 * Looks up the program for the customer's home store; if welcomeBonus > 0,
 * sets the initial points + history entry. Safe to call from createCustomer.
 */
export async function awardWelcomeBonus(
  { orgId, customerId, storeId }: { orgId: string; customerId: string; storeId?: string | null },
): Promise<number> {
  if (!storeId) return 0;
  const program = await prisma.loyaltyProgram.findUnique({ where: { storeId } });
  if (!program || !program.enabled || (program.welcomeBonus || 0) <= 0) return 0;

  await _writeHistory({
    orgId, customerId, delta: program.welcomeBonus,
    reason: 'welcome_bonus', txId: null, txNumber: null,
  });
  return program.welcomeBonus;
}

/**
 * Award the birthday bonus. Idempotent per calendar year — checks
 * pointsHistory for an existing birthday_bonus entry whose ISO date starts
 * with this year, and skips if found.
 */
export interface CustomerForLoyalty {
  id: string;
  storeId?: string | null;
  loyaltyPoints?: number | null;
  pointsHistory?: unknown;
}

export async function awardBirthdayBonus(
  { orgId, customer }: { orgId: string; customer: CustomerForLoyalty },
): Promise<number> {
  if (!customer.storeId) return 0;
  const program = await prisma.loyaltyProgram.findUnique({ where: { storeId: customer.storeId } });
  if (!program || !program.enabled || (program.birthdayBonus || 0) <= 0) return 0;

  const yearKey = new Date().getUTCFullYear();
  const history: PointsHistoryEntry[] = Array.isArray(customer.pointsHistory)
    ? (customer.pointsHistory as unknown as PointsHistoryEntry[])
    : [];
  const already = history.some(
    (h) => h && h.reason === 'birthday_bonus' &&
         typeof h.date === 'string' && h.date.startsWith(String(yearKey))
  );
  if (already) return 0;

  await _writeHistory({
    orgId, customerId: customer.id, delta: program.birthdayBonus,
    reason: 'birthday_bonus', txId: null, txNumber: null,
    meta: { year: yearKey },
  });
  return program.birthdayBonus;
}

/**
 * Expire points older than the program's expiryDays. Walks the customer's
 * pointsHistory, sums positive deltas (earn, welcome, birthday) older than
 * the cutoff that haven't already been redeemed/expired, and writes a
 * single 'expired' entry deducting the lapsed amount.
 *
 * Called per-customer by the loyaltyScheduler.
 */
export async function expireCustomerPoints(
  { orgId, customer, expiryDays }: { orgId: string; customer: CustomerForLoyalty; expiryDays: number | null | undefined },
): Promise<number> {
  if (!expiryDays || expiryDays <= 0) return 0;
  const cutoff = new Date(Date.now() - expiryDays * 24 * 60 * 60 * 1000);
  const history: PointsHistoryEntry[] = Array.isArray(customer.pointsHistory)
    ? (customer.pointsHistory as unknown as PointsHistoryEntry[])
    : [];

  // Sum positive earnings older than cutoff that haven't been counted toward
  // an existing 'expired' entry. We track the most recent expired entry's
  // date and only consider earns BEFORE that date.
  const lastExpired = history
    .filter((h) => h.reason === 'expired')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  const lookbackStart = lastExpired ? new Date(lastExpired.date) : new Date(0);

  let lapsed = 0;
  for (const h of history) {
    if (!h.date) continue;
    const t = new Date(h.date);
    if (t > cutoff) continue;            // still inside the validity window
    if (t <= lookbackStart) continue;    // already expired in a prior sweep
    if (h.delta > 0 && (h.reason === 'earn' || h.reason === 'welcome_bonus' || h.reason === 'birthday_bonus')) {
      lapsed += h.delta;
    }
    // Subtract redemptions/reversals in the same window to avoid expiring
    // points the customer already used.
    if (h.delta < 0 && (h.reason === 'redeem' || h.reason === 'void_reverse' || h.reason === 'refund_reverse')) {
      lapsed = Math.max(0, lapsed + h.delta);
    }
  }

  // Cap at current balance — never expire more than they currently hold.
  const current = customer.loyaltyPoints || 0;
  const toExpire = Math.min(lapsed, current);
  if (toExpire <= 0) return 0;

  await _writeHistory({
    orgId, customerId: customer.id, delta: -toExpire,
    reason: 'expired', meta: { expiryDays, cutoff: cutoff.toISOString() },
  });
  return toExpire;
}
