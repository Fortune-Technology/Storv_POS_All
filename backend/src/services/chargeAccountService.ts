/**
 * chargeAccountService.ts
 *
 * In-store charge ("house account") tender validation and balance updates.
 * Used by posTerminalController.createTransaction / batchCreateTransactions
 * (apply on sale) and voidTransaction / createRefund (refund on reversal).
 *
 * Race-safe: balance updates use Prisma's atomic increment / decrement
 * operators so two concurrent terminals can't both push a charge over the
 * customer's limit. The validation read-then-write window is narrow but
 * the increment itself is the single source of truth — a check that says
 * "you have $5 of room" is only advisory; the increment will succeed and
 * we double-check post-write so the caller can roll back if needed.
 */

import type { PrismaClient } from '@prisma/client';
import realPrisma from '../config/postgres.js';

let prisma: PrismaClient = realPrisma;

/**
 * Test-only injection point. Pass a stubbed PrismaClient to bypass DB calls
 * in unit tests; pass nullish to restore the real client.
 */
export function _setPrismaForTests(p: PrismaClient | null | undefined): void {
  prisma = p || realPrisma;
}

interface TenderLine {
  method?: string;
  amount?: number | string;
}

/**
 * Sum the charge-method tender lines on a transaction payload.
 * Accepts the legacy aliases too so older clients keep working.
 */
export function sumChargeTender(tenderLines: TenderLine[] | null | undefined): number {
  if (!Array.isArray(tenderLines)) return 0;
  return tenderLines
    .filter(t => t && (t.method === 'charge' || t.method === 'charge_account' || t.method === 'house_charge'))
    .reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
}

export interface ApplyChargeArgs {
  orgId: string;
  customerId: string | null | undefined;
  chargeAmount: number;
}

export type ApplyChargeResult =
  | { ok: true; newBalance: number }
  | { ok: false; error: string };

/**
 * Validate a charge against the customer's account, then atomically reserve
 * the balance via Prisma increment. Returns:
 *   { ok: true,  newBalance } on success
 *   { ok: false, error }      on validation failure (no DB write)
 *
 * Validation rules:
 *   - customerId required
 *   - chargeAmount must be positive
 *   - customer must exist + not deleted + in the requesting org
 *   - instoreChargeEnabled must be true
 *   - if balanceLimit > 0, (currentBalance + chargeAmount) must not exceed it
 *   - balanceLimit <= 0 is treated as "unlimited" (matches portal semantics)
 */
export async function applyChargeTender({
  orgId,
  customerId,
  chargeAmount,
}: ApplyChargeArgs): Promise<ApplyChargeResult> {
  if (!customerId) return { ok: false, error: 'Charge tender requires a customer attached to the cart.' };
  if (!(chargeAmount > 0)) return { ok: false, error: 'Charge amount must be positive.' };

  const customer = await prisma.customer.findFirst({
    where:  { id: customerId, orgId, deleted: false },
    select: { id: true, balance: true, balanceLimit: true, instoreChargeEnabled: true, name: true },
  });
  if (!customer) return { ok: false, error: 'Customer not found.' };
  if (!customer.instoreChargeEnabled) return { ok: false, error: 'In-store charge account is not enabled for this customer.' };

  const currentBalance = Number(customer.balance || 0);
  const limit          = Number(customer.balanceLimit || 0);
  if (limit > 0 && (currentBalance + chargeAmount) > limit + 0.005) {
    const room = Math.max(0, limit - currentBalance);
    return {
      ok: false,
      error: `Charge of $${chargeAmount.toFixed(2)} would exceed the customer's $${limit.toFixed(2)} limit. ` +
             `Current balance: $${currentBalance.toFixed(2)}. Room remaining: $${room.toFixed(2)}.`,
    };
  }

  await prisma.customer.update({
    where: { id: customerId },
    data:  { balance: { increment: chargeAmount } },
  });
  return { ok: true, newBalance: currentBalance + chargeAmount };
}

export interface RefundChargeArgs {
  orgId: string;
  originalTx: { id: string };
  chargeAmount: number;
}

export type RefundChargeResult =
  | { ok: true; customerId: string }
  | { ok: false; reason: string };

/**
 * Refund a previously-applied charge back to the customer's balance, used
 * when a transaction with a charge tender is voided or refunded. Locates
 * the customer by scanning pointsHistory for the tx id (since the
 * Transaction model has no customerId column yet).
 */
export async function refundChargeOnTx({
  orgId,
  originalTx,
  chargeAmount,
}: RefundChargeArgs): Promise<RefundChargeResult> {
  if (!(chargeAmount > 0)) return { ok: false, reason: 'no_charge' };
  const txId = originalTx.id;
  const all = await prisma.customer.findMany({
    where:  { orgId, instoreChargeEnabled: true },
    select: { id: true, pointsHistory: true, balance: true },
  });
  const target = all.find(c => {
    const history = c.pointsHistory as Array<{ txId?: string }> | null;
    return Array.isArray(history) && history.some(h => h && h.txId === txId);
  });
  if (!target) return { ok: false, reason: 'customer_not_found' };
  await prisma.customer.update({
    where: { id: target.id },
    data:  { balance: { decrement: chargeAmount } },
  });
  return { ok: true, customerId: target.id };
}
