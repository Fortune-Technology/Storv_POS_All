/**
 * reconciliation.ts — Match ack lines back to original tx + redemptions (Session 48).
 *
 * Takes a parsed ack (from ackParsers/index.ts) + the submission row it
 * applies to, and:
 *   1. Persists the per-line ack details to ScanDataSubmission.ackLines (JSON)
 *   2. Updates submission status + acceptedCount + rejectedCount + ackedAt
 *   3. For each rejected line that targets a CouponRedemption (we identify
 *      these by txNumber+upc matching a redemption's qualifyingUpc within
 *      the submission's period), stamps `rejectedAt` + `rejectionReason`
 *   4. For each accepted line that targets a CouponRedemption, stamps
 *      `reimbursedAt` (the actual money landing happens on the next mfr
 *      payment cycle, but reimbursement is now committed)
 *
 * Idempotent: re-processing the same ack file is safe — already-stamped
 * rows aren't re-stamped (we only update where the timestamp is null OR
 * where the status has changed, e.g. a corrected ack arrives later).
 */

import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { sendScanDataAckRejection } from '../emailService.js';
import type { AckResult } from './ackParsers/common.js';

/** ScanDataSubmission row used by the reconciler. */
export interface SubmissionRecord {
  id: string;
  orgId: string;
  storeId: string;
  manufacturerId: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  fileName?: string | null;
  ackFileName?: string | null;
  [extra: string]: unknown;
}

export interface ReconcileOptions {
  skipEmail?: boolean;
}

export interface ReconcileResult {
  submissionId: string;
  status: 'acknowledged' | 'rejected';
  acceptedCount: number;
  rejectedCount: number;
  warningCount: number;
  redemptionsAccepted: number;
  redemptionsRejected: number;
  redemptionsUntouched: number;
  notification: { sent: boolean; reason: string | null };
}

interface RedemptionRow {
  id: string;
  transactionId: string | null;
  qualifyingUpc: string | null;
  reimbursedAt: Date | null;
  rejectedAt: Date | null;
}

/**
 * Reconcile a parsed ack against a submission.
 */
export async function reconcileAck(
  { submission, ack, options = {} }: { submission: SubmissionRecord; ack: AckResult; options?: ReconcileOptions },
): Promise<ReconcileResult> {
  const { acceptedCount, rejectedCount, warningCount } = ack.summary;

  // 1. Determine the submission-level status from the ack outcome
  let nextStatus: 'acknowledged' | 'rejected';
  if (rejectedCount === 0) {
    nextStatus = 'acknowledged';
  } else if (acceptedCount === 0) {
    nextStatus = 'rejected';
  } else {
    nextStatus = 'acknowledged'; // partial success — submission accepted, individual lines flagged
  }

  // 2. Persist ack details on the submission row
  await prisma.scanDataSubmission.update({
    where: { id: submission.id },
    data: {
      ackLines:      ack.lines as unknown as Prisma.InputJsonValue,
      ackContent:    ack.lines.map((l) => l.originalLine).join('\n'),
      ackFileName:   ack.fileName || submission.ackFileName || undefined,
      acceptedCount,
      rejectedCount,
      ackedAt:       new Date(),
      status:        nextStatus,
      errorMessage:  rejectedCount > 0
        ? `${rejectedCount} line(s) rejected by manufacturer.`
        : null,
    },
  });

  // 3. Build a lookup of (txNumber, upc) → CouponRedemption for this submission.
  //    CouponRedemption.transactionId is a plain string column (no relation),
  //    so we manually join via Transaction. Only redemptions stamped against
  //    THIS submission are eligible — keeps the operation idempotent when the
  //    same ack is reprocessed.
  const redemptionsRaw = await prisma.couponRedemption.findMany({
    where: {
      orgId:           submission.orgId,
      storeId:         submission.storeId,
      manufacturerId:  submission.manufacturerId,
      submissionId:    submission.id,
    },
  }) as RedemptionRow[];
  const txIds: string[] = Array.from(
    new Set(
      redemptionsRaw
        .map((r: RedemptionRow) => r.transactionId)
        .filter((id): id is string => !!id),
    ),
  );
  const txs = txIds.length === 0
    ? []
    : await prisma.transaction.findMany({
        where: { id: { in: txIds } },
        select: { id: true, txNumber: true },
      }) as { id: string; txNumber: string }[];
  const txNumberById: Record<string, string> = Object.fromEntries(
    txs.map((t: { id: string; txNumber: string }) => [t.id, t.txNumber]),
  );

  // Build lookup keyed by `${txNumber}|${upc}` → redemption
  const redemptionByRef = new Map<string, RedemptionRow>();
  for (const r of redemptionsRaw) {
    const txNumber = (r.transactionId && txNumberById[r.transactionId]) || '';
    const key = `${txNumber}|${r.qualifyingUpc || ''}`;
    redemptionByRef.set(key, r);
  }

  // 4. Walk ack lines, stamp redemptions
  let redemptionsAccepted = 0;
  let redemptionsRejected = 0;

  for (const line of ack.lines) {
    const r = redemptionByRef.get(line.recordRef);
    if (!r) continue; // not all ack lines map to a coupon redemption — most are line-level reporting

    if (line.status === 'accepted' && !r.reimbursedAt) {
      await prisma.couponRedemption.update({
        where: { id: r.id },
        data: { reimbursedAt: new Date(), rejectedAt: null, rejectionReason: null },
      });
      redemptionsAccepted++;
    } else if (line.status === 'rejected' && !r.rejectedAt) {
      await prisma.couponRedemption.update({
        where: { id: r.id },
        data: {
          rejectedAt:      new Date(),
          rejectionReason: line.reason || line.code || 'Rejected by manufacturer',
          reimbursedAt:    null,
        },
      });
      redemptionsRejected++;
    }
  }

  // 5. Email notification on rejected lines (best-effort; never throws)
  let notification: { sent: boolean; reason: string | null } = { sent: false, reason: null };
  if (rejectedCount > 0 && !options.skipEmail) {
    notification = await notifyOnRejection({ submission, ack }).catch((err: unknown) => ({
      sent: false,
      reason: err instanceof Error ? err.message : String(err),
    }));
  }

  return {
    submissionId: submission.id,
    status:       nextStatus,
    acceptedCount,
    rejectedCount,
    warningCount,
    redemptionsAccepted,
    redemptionsRejected,
    redemptionsUntouched: redemptionsRaw.length - redemptionsAccepted - redemptionsRejected,
    notification,
  };
}

/**
 * Send an email summary to the org's billing/admin contact when an ack
 * comes back with rejected lines. Best-effort — never throws.
 */
async function notifyOnRejection(
  { submission, ack }: { submission: SubmissionRecord; ack: AckResult },
): Promise<{ sent: boolean; reason: string | null }> {
  // Find an admin/owner email for this org
  const admin = await prisma.user.findFirst({
    where: { orgId: submission.orgId, role: { in: ['owner', 'admin'] }, status: 'active' },
    select: { email: true, name: true },
  });
  if (!admin?.email) return { sent: false, reason: 'No org admin email on file.' };

  const mfr = await prisma.tobaccoManufacturer.findUnique({
    where: { id: submission.manufacturerId },
    select: { name: true, shortName: true },
  });

  const sampleRejected = ack.lines
    .filter((l) => l.status === 'rejected')
    .slice(0, 10)
    .map((l) => ({ txNumber: l.txNumber, upc: l.upc, reason: l.reason, code: l.code }));

  try {
    const ok = await sendScanDataAckRejection(admin.email, {
      manufacturerName: mfr?.name || mfr?.shortName || 'manufacturer',
      fileName:         submission.fileName || undefined,
      periodStart:      submission.periodStart,
      periodEnd:        submission.periodEnd,
      acceptedCount:    ack.summary.acceptedCount,
      rejectedCount:    ack.summary.rejectedCount,
      sampleRejected,
    });
    return { sent: !!ok, reason: ok ? null : 'SMTP not configured or send failed' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { sent: false, reason: message };
  }
}
