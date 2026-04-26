/**
 * Label Print Job Controller — routed Zebra printing via cashier-app
 *
 * The portal (served on public HTTPS at storeveu.com) cannot call
 * https://localhost:9101 directly — Chrome 138+ blocks public → loopback
 * via Local Network Access. Workaround: portal POSTs ZPL here, cashier-app
 * (Electron at the register) polls, prints via its Node runtime, reports back.
 *
 * Lifecycle:   pending → claimed → completed (or failed)
 */

import type { Request, Response } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../config/postgres.js';

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** Type alias for routes attached after attachStation middleware. */
type RequestWithStation = Request & { stationId?: string | null };

interface SubmitJobBody {
  zpl?: string;
  storeId?: string | null;
  stationId?: string | null;
  printerName?: string | null;
  source?: string;
  labelCount?: number | string;
  metadata?: Record<string, unknown> | null;
}

// ── 1. Portal submits a ZPL job ───────────────────────────────────────────
export async function submitPrintJob(req: Request, res: Response): Promise<void> {
  try {
    const { zpl, storeId, stationId, printerName, source, labelCount, metadata } = (req.body || {}) as SubmitJobBody;

    if (!zpl || typeof zpl !== 'string' || zpl.trim().length === 0) {
      res.status(400).json({ error: 'zpl is required' });
      return;
    }
    if (zpl.length > 2_000_000) {
      res.status(413).json({ error: 'ZPL payload too large (>2MB)' });
      return;
    }

    const job = await prisma.labelPrintJob.create({
      data: {
        orgId:             req.orgId as string,
        storeId:           storeId || req.storeId || null,
        stationId:         stationId || null,
        zpl,
        printerName:       printerName || null,
        source:            source || 'manual',
        labelCount:        Number.isFinite(Number(labelCount)) ? parseInt(String(labelCount)) : 1,
        metadata:          (metadata as Prisma.InputJsonValue | null) || undefined,
        status:            'pending',
        submittedByUserId: req.user?.id || null,
      },
      select: {
        id: true, status: true, createdAt: true, storeId: true, stationId: true,
        labelCount: true, source: true,
      },
    });

    res.status(201).json({ success: true, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[LabelPrintJob:submit]', err);
    res.status(500).json({ error: message });
  }
}

// ── 2. Station atomically claims up to N pending jobs ─────────────────────
// Called by the cashier-app poller. Uses findMany → updateMany → findMany
// inside a $transaction so two stations polling simultaneously never grab
// the same job. updateMany's `status: 'pending'` filter is the real guard;
// only the station that successfully flipped a row will see it in the
// returned set.
export async function claimPrintJobs(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body || {}) as { limit?: number | string; stationId?: string | null };
    const limit = Math.max(1, Math.min(10, parseInt(String(body.limit)) || 5));
    const sReq = req as RequestWithStation;
    const stationId = sReq.stationId || body.stationId;

    if (!stationId) {
      res.status(400).json({ error: 'stationId required (either via station token or request body)' });
      return;
    }

    const claimed = await prisma.$transaction(async (tx: TxClient) => {
      const eligible = await tx.labelPrintJob.findMany({
        where: {
          orgId:   req.orgId as string,
          storeId: req.storeId || undefined,
          status:  'pending',
          OR: [{ stationId: null }, { stationId }],
        },
        take:    limit,
        orderBy: { createdAt: 'asc' },
        select:  { id: true },
      });
      if (eligible.length === 0) return [];

      const ids = eligible.map((e: { id: number }) => e.id);
      await tx.labelPrintJob.updateMany({
        where: { id: { in: ids }, status: 'pending' },
        data: {
          status:             'claimed',
          claimedByStationId: stationId,
          claimedAt:          new Date(),
          attempts:           { increment: 1 },
        },
      });

      return tx.labelPrintJob.findMany({
        where: {
          id: { in: ids },
          claimedByStationId: stationId,
          status: 'claimed',
        },
        orderBy: { createdAt: 'asc' },
      });
    });

    res.json({ jobs: claimed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[LabelPrintJob:claim]', err);
    res.status(500).json({ error: message });
  }
}

interface CompleteJobBody {
  success?: boolean;
  error?: string | null;
  stationId?: string | null;
}

// ── 3. Station reports completion (success or failure) ────────────────────
export async function completePrintJob(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return; }

    const { success = true, error = null } = (req.body || {}) as CompleteJobBody;
    const sReq = req as RequestWithStation;
    const stationId = sReq.stationId || (req.body || {}).stationId;

    const job = await prisma.labelPrintJob.findUnique({
      where: { id },
      select: { id: true, orgId: true, claimedByStationId: true, status: true },
    });
    if (!job)               { res.status(404).json({ error: 'job not found' }); return; }
    if (job.orgId !== req.orgId) { res.status(403).json({ error: 'forbidden' }); return; }

    // Only the claiming station (or the submitter from the portal) can complete it.
    const isOwner = stationId && job.claimedByStationId === stationId;
    if (!isOwner && !req.user?.id) {
      res.status(403).json({ error: 'only the claiming station can complete this job' });
      return;
    }

    const updated = await prisma.labelPrintJob.update({
      where: { id },
      data: {
        status:      success ? 'completed' : 'failed',
        completedAt: new Date(),
        error:       success ? null : String(error || 'unknown error').slice(0, 2000),
      },
      select: { id: true, status: true, completedAt: true, error: true },
    });

    res.json({ success: true, job: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[LabelPrintJob:complete]', err);
    res.status(500).json({ error: message });
  }
}

// ── 4. Portal lists recent jobs (for status panel) ────────────────────────
export async function listRecentPrintJobs(req: Request, res: Response): Promise<void> {
  try {
    const limit  = Math.min(100, parseInt(String(req.query.limit)) || 25);
    const status = req.query.status as string | undefined; // optional filter

    const where: Prisma.LabelPrintJobWhereInput = { orgId: req.orgId as string };
    if (req.storeId) where.OR = [{ storeId: req.storeId }, { storeId: null }];
    if (status)      where.status = status;

    const jobs = await prisma.labelPrintJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, status: true, source: true, labelCount: true,
        printerName: true, stationId: true, claimedByStationId: true,
        error: true, createdAt: true, claimedAt: true, completedAt: true,
        submittedByUserId: true, metadata: true,
      },
    });

    res.json({ jobs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[LabelPrintJob:list]', err);
    res.status(500).json({ error: message });
  }
}

// ── 5. Get one job's status (for UI polling after submit) ─────────────────
export async function getPrintJobStatus(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return; }

    const job = await prisma.labelPrintJob.findUnique({
      where: { id },
      select: {
        id: true, orgId: true, status: true, source: true, labelCount: true,
        printerName: true, claimedByStationId: true, error: true,
        createdAt: true, claimedAt: true, completedAt: true,
      },
    });
    if (!job)                    { res.status(404).json({ error: 'not found' }); return; }
    if (job.orgId !== req.orgId) { res.status(403).json({ error: 'forbidden' }); return; }

    const { orgId: _orgId, ...safe } = job;
    res.json({ job: safe });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}

// ── 6. Retry a failed job ─────────────────────────────────────────────────
export async function retryPrintJob(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return; }

    const job = await prisma.labelPrintJob.findUnique({ where: { id } });
    if (!job)                     { res.status(404).json({ error: 'not found' }); return; }
    if (job.orgId !== req.orgId)  { res.status(403).json({ error: 'forbidden' }); return; }
    if (job.status === 'pending' || job.status === 'claimed') {
      res.status(400).json({ error: 'job is already in flight' });
      return;
    }

    const updated = await prisma.labelPrintJob.update({
      where: { id },
      data: {
        status:             'pending',
        claimedByStationId: null,
        claimedAt:          null,
        completedAt:        null,
        error:              null,
      },
      select: { id: true, status: true, createdAt: true },
    });
    res.json({ success: true, job: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}

// ── 7. Cleanup — remove old completed/failed jobs ─────────────────────────
export async function cleanupPrintJobs(req: Request, res: Response): Promise<void> {
  try {
    const days = Math.max(1, parseInt(String(req.query.days)) || 7);
    const cutoff = new Date(Date.now() - days * 86_400_000);

    const result = await prisma.labelPrintJob.deleteMany({
      where: {
        orgId:   req.orgId as string,
        status:  { in: ['completed', 'failed'] },
        createdAt: { lt: cutoff },
      },
    });
    res.json({ deleted: result.count });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
