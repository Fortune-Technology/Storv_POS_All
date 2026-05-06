/**
 * Submission log + manual replay + ack reconciliation + stats.
 * Split from `scanDataController.ts` (S80).
 *
 * Permissions:
 *   scan_data.view     — list, download, getAckLines, stats
 *   scan_data.submit   — regenerate, processAck
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import fs from 'fs';
import prisma from '../../config/postgres.js';
import { generateSubmission, generateForStore } from '../../services/scanData/generator.js';
import { parseAck as parseAckByMfr } from '../../services/scanData/ackParsers/index.js';
import { reconcileAck } from '../../services/scanData/reconciliation.js';
import { getOrgId } from './helpers.js';

// ══════════════════════════════════════════════════════════════════════════
// SUBMISSIONS  (read-only in Session 45 — Session 47 ships file generation)
// ══════════════════════════════════════════════════════════════════════════

export const listSubmissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as { storeId?: string; manufacturerId?: string; status?: string; limit?: string };
    const { storeId, manufacturerId, status, limit } = q;

    const where: Prisma.ScanDataSubmissionWhereInput = { orgId: orgId ?? undefined };
    if (storeId)        where.storeId = String(storeId);
    if (manufacturerId) where.manufacturerId = String(manufacturerId);
    if (status)         where.status = String(status);

    const rows = await prisma.scanDataSubmission.findMany({
      where,
      include: {
        manufacturer: {
          select: { id: true, code: true, name: true, shortName: true, parentMfrCode: true },
        },
      },
      orderBy: [{ submissionDate: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(Number(limit) || 100, 500),
    });

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── POST /scan-data/submissions/regenerate (manager+ via scan_data.submit) ──
//
// Manual replay. Use cases:
//   • A scheduler tick failed and you want to retry now without waiting
//   • You want to dry-run a date range to inspect the file before sending
//   • A manufacturer asks for a re-send of a specific date
//
// Body:
//   { storeId, manufacturerId?, periodStart, periodEnd, dryRun?: bool }
// If `manufacturerId` is omitted, regenerates for every active enrollment
// at this store.
interface RegenBody {
  storeId?: string;
  manufacturerId?: string;
  periodStart?: string | Date;
  periodEnd?: string | Date;
  dryRun?: boolean;
}

export const regenerateSubmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as RegenBody;
    const { storeId, manufacturerId, periodStart, periodEnd, dryRun = false } = body;
    if (!storeId || !periodStart || !periodEnd) {
      res.status(400).json({ success: false, error: 'storeId, periodStart, periodEnd are required' });
      return;
    }

    if (manufacturerId) {
      const r = await generateSubmission({
        orgId: orgId as string, storeId, manufacturerId,
        periodStart: periodStart as string,
        periodEnd: periodEnd as string,
        dryRun: Boolean(dryRun),
      } as Parameters<typeof generateSubmission>[0]);
      // Strip the file body from the response — it's enormous; download via /:id/download instead.
      const { body: fileBody, ...summary } = r as unknown as { body?: string } & Record<string, unknown>;
      res.json({ success: true, data: summary, dryRunBody: dryRun ? fileBody : undefined });
      return;
    }

    const results = await generateForStore({ orgId: orgId as string, storeId, periodStart: periodStart as string, periodEnd: periodEnd as string, dryRun: Boolean(dryRun) } as Parameters<typeof generateForStore>[0]);
    res.json({ success: true, data: { results } });
  } catch (err) {
    console.error('[scanData] regenerate failed:', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── GET /scan-data/submissions/:id/download (manager+ via scan_data.view) ──
//
// Streams the stored submission file. Used during cert to inspect the exact
// bytes that were uploaded — invaluable when the mfr says "your line 47 is
// malformed" and we need to see what we actually sent.
export const downloadSubmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const sub = await prisma.scanDataSubmission.findFirst({ where: { id, orgId: orgId ?? undefined } });
    if (!sub) { res.status(404).json({ success: false, error: 'Submission not found' }); return; }
    if (!sub.fileStoragePath || !fs.existsSync(sub.fileStoragePath)) {
      res.status(410).json({ success: false, error: 'File no longer available on disk.' });
      return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${sub.fileName}"`);
    const stream = fs.createReadStream(sub.fileStoragePath);
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── POST /scan-data/submissions/:id/process-ack (manager+ via scan_data.submit) ──
//
// Manual ack reconciliation. Two body shapes supported:
//   { ackContent: "<raw text>", fileName?: "STORV-001_20260424.csv.ack" }
//     → parse with the manufacturer's parser, run reconciliation
//   { ackLines: [{ recordRef, status, reason?, code?, ... }] }
//     → already-parsed structure, skip parser, run reconciliation directly
//
// Use case: during cert, mfrs often deliver ack files via email or web
// portal rather than SFTP. Admins paste the file body here to drive the
// same reconciliation flow as the automated SFTP poller.
interface AckLine {
  recordRef?: string;
  status?: string;
  reason?: string;
  code?: string;
}

interface ProcessAckBody {
  ackContent?: string;
  fileName?: string;
  ackLines?: AckLine[];
}

export const processSubmissionAck = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const body = (req.body || {}) as ProcessAckBody;
    const { ackContent, fileName, ackLines } = body;
    if (!ackContent && !Array.isArray(ackLines)) {
      res.status(400).json({ success: false, error: 'ackContent (raw text) or ackLines (parsed array) is required.' });
      return;
    }

    const submission = await prisma.scanDataSubmission.findFirst({
      where: { id, orgId: orgId ?? undefined },
      include: { manufacturer: true },
    });
    if (!submission) { res.status(404).json({ success: false, error: 'Submission not found' }); return; }

    type AckResult = ReturnType<typeof parseAckByMfr>;
    let parsed: AckResult;
    if (Array.isArray(ackLines)) {
      // Pre-parsed shape — assume the caller knows what they're doing
      const accepted = ackLines.filter((l) => l.status === 'accepted').length;
      const rejected = ackLines.filter((l) => l.status === 'rejected').length;
      const warning  = ackLines.filter((l) => l.status === 'warning').length;
      parsed = {
        mfrCode: submission.manufacturer.code,
        fileName: fileName || null,
        processedAt: new Date(),
        summary: { acceptedCount: accepted, rejectedCount: rejected, warningCount: warning },
        lines: ackLines,
        parseErrors: [],
      } as unknown as AckResult;
    } else {
      parsed = parseAckByMfr({
        mfrCode:  submission.manufacturer.code,
        content:  ackContent,
        fileName: fileName || null,
      });
    }

    const result = await reconcileAck({ submission, ack: parsed } as Parameters<typeof reconcileAck>[0]);
    res.json({ success: true, data: { ...result, parseErrors: (parsed as { parseErrors: unknown[] }).parseErrors } });
  } catch (err) {
    console.error('[scanData] processSubmissionAck failed:', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── GET /scan-data/submissions/:id/ack-lines (manager+ via scan_data.view) ──
//
// Fetches the ackLines JSON for a submission so the portal SubmissionDetailModal
// can render the per-line status table. Returns the raw array; UI filters/sorts
// client-side.
export const getSubmissionAckLines = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const submission = await prisma.scanDataSubmission.findFirst({
      where: { id, orgId: orgId ?? undefined },
      include: { manufacturer: { select: { id: true, code: true, name: true, shortName: true } } },
    });
    if (!submission) { res.status(404).json({ success: false, error: 'Submission not found' }); return; }
    res.json({
      success: true,
      data: {
        submission: {
          id:             submission.id,
          fileName:       submission.fileName,
          status:         submission.status,
          ackedAt:        submission.ackedAt,
          acceptedCount:  submission.acceptedCount,
          rejectedCount:  submission.rejectedCount,
          txCount:        submission.txCount,
          couponCount:    submission.couponCount,
          totalAmount:    submission.totalAmount,
          periodStart:    submission.periodStart,
          periodEnd:      submission.periodEnd,
          uploadedAt:     submission.uploadedAt,
          errorMessage:   submission.errorMessage,
          manufacturer:   submission.manufacturer,
        },
        ackLines: Array.isArray(submission.ackLines) ? submission.ackLines : [],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const getSubmissionStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as { storeId?: string; days?: string };
    const { storeId, days } = q;

    const since = new Date();
    since.setDate(since.getDate() - (Number(days) || 30));

    const where: Prisma.ScanDataSubmissionWhereInput = { orgId: orgId ?? undefined, createdAt: { gte: since } };
    if (storeId) where.storeId = String(storeId);

    const [total, byStatus] = await Promise.all([
      prisma.scanDataSubmission.count({ where }),
      prisma.scanDataSubmission.groupBy({
        where,
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    type GroupRow = { status: string; _count: { _all: number } };
    res.json({
      success: true,
      data: {
        total,
        byStatus: (byStatus as GroupRow[]).reduce((acc: Record<string, number>, r) => {
          acc[r.status] = r._count._all;
          return acc;
        }, {}),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
