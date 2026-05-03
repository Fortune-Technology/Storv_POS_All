/**
 * POS SPIn — shared helpers used by every cashier-app SPIn handler.
 *
 *   getOrgId / getStoreId   — pull org/store identifier from the request,
 *                              with fallbacks (header, body, decoded JWT)
 *   recordTransaction       — write a PaymentTransaction row in the DB after
 *                              every Dejavoo round-trip (approved or declined)
 *
 * Type definitions (`ProviderResult`, `RecordTxOpts`) live here too because
 * every transaction handler in this directory uses them.
 */

import type { Request } from 'express';
import prisma from '../../../config/postgres.js';

/** Pull orgId from the authenticated user (or the request itself). */
export const getOrgId = (req: Request): string | null | undefined =>
  req.orgId || req.user?.orgId;

/** Pull storeId from header → middleware-injected → body, in that order. */
export const getStoreId = (req: Request): string | null | undefined =>
  (req.headers['x-store-id'] as string | undefined)
  || req.storeId
  || (req.body as { storeId?: string } | undefined)?.storeId;

/** Flat result shape returned by paymentProviderFactory.* methods. */
export interface ProviderResult {
  approved?: boolean;
  referenceId?: string | null;
  authCode?: string | null;
  statusCode?: string | null;
  message?: string | null;
  last4?: string | null;
  cardType?: string | null;
  expiry?: string | null;
  entryType?: string | null;
  totalAmount?: number;
  signatureData?: string | null;
  connected?: boolean;
  value?: string | null;
}

/** Options passed to recordTransaction(). */
export interface RecordTxOpts {
  type?: string;
  amount?: number;
  invoiceNumber?: string | null;
  posTransactionId?: string | null;
  originalReferenceId?: string | null;
}

/**
 * Write a `PaymentTransaction` row capturing the outcome of one SPIn call.
 *
 * Always called regardless of approval/decline so we have a forensic trail.
 * Returns null on error (the caller continues — recording is best-effort).
 */
export async function recordTransaction(
  orgId: string,
  storeId: string,
  merchantId: string,
  result: ProviderResult,
  opts: RecordTxOpts,
) {
  try {
    return await prisma.paymentTransaction.create({
      data: {
        orgId,
        storeId,
        merchantId,
        // Transaction details
        type:             opts.type   || 'sale',
        status:           result.approved ? 'approved' : 'declined',
        amount:           opts.amount || 0,
        // Provider response
        retref:           result.referenceId || null,
        authCode:         result.authCode    || null,
        respCode:         result.statusCode  || null,
        respText:         result.message     || null,
        // Card info (PCI-safe — no full PAN)
        token:            null, // Dejavoo doesn't return tokens via SPIn (use GetCard separately)
        lastFour:         result.last4     || null,
        acctType:         result.cardType  || null,
        expiry:           result.expiry    || null,
        entryMode:        result.entryType || null,
        // Amounts
        capturedAmount:   result.approved ? (result.totalAmount ?? opts.amount) : null,
        // Linkage
        originalRetref:   opts.originalReferenceId || null,
        invoiceNumber:    opts.invoiceNumber       || null,
        posTransactionId: opts.posTransactionId    || null,
        // Signature
        signatureData:     result.signatureData || null,
        signatureCaptured: !!result.signatureData,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[posSpin/helpers.recordTransaction] Failed:', message);
    return null;
  }
}
