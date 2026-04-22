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

import prisma from '../config/postgres.js';

// ── 1. Portal submits a ZPL job ───────────────────────────────────────────
export async function submitPrintJob(req, res) {
  try {
    const { zpl, storeId, stationId, printerName, source, labelCount, metadata } = req.body || {};

    if (!zpl || typeof zpl !== 'string' || zpl.trim().length === 0) {
      return res.status(400).json({ error: 'zpl is required' });
    }
    if (zpl.length > 2_000_000) {
      return res.status(413).json({ error: 'ZPL payload too large (>2MB)' });
    }

    const job = await prisma.labelPrintJob.create({
      data: {
        orgId:             req.orgId,
        storeId:           storeId || req.storeId || null,
        stationId:         stationId || null,
        zpl,
        printerName:       printerName || null,
        source:            source || 'manual',
        labelCount:        Number.isFinite(labelCount) ? parseInt(labelCount) : 1,
        metadata:          metadata || null,
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
    console.error('[LabelPrintJob:submit]', err);
    res.status(500).json({ error: err.message });
  }
}

// ── 2. Station atomically claims up to N pending jobs ─────────────────────
// Called by the cashier-app poller. Uses findMany → updateMany → findMany
// inside a $transaction so two stations polling simultaneously never grab
// the same job. updateMany's `status: 'pending'` filter is the real guard;
// only the station that successfully flipped a row will see it in the
// returned set.
export async function claimPrintJobs(req, res) {
  try {
    const limit = Math.max(1, Math.min(10, parseInt(req.body?.limit) || 5));
    const stationId = req.stationId || req.body?.stationId;

    if (!stationId) {
      return res.status(400).json({ error: 'stationId required (either via station token or request body)' });
    }

    const claimed = await prisma.$transaction(async (tx) => {
      const eligible = await tx.labelPrintJob.findMany({
        where: {
          orgId:   req.orgId,
          storeId: req.storeId || undefined,
          status:  'pending',
          OR: [{ stationId: null }, { stationId }],
        },
        take:    limit,
        orderBy: { createdAt: 'asc' },
        select:  { id: true },
      });
      if (eligible.length === 0) return [];

      const ids = eligible.map(e => e.id);
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
    console.error('[LabelPrintJob:claim]', err);
    res.status(500).json({ error: err.message });
  }
}

// ── 3. Station reports completion (success or failure) ────────────────────
export async function completePrintJob(req, res) {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const { success = true, error = null } = req.body || {};
    const stationId = req.stationId || req.body?.stationId;

    const job = await prisma.labelPrintJob.findUnique({
      where: { id },
      select: { id: true, orgId: true, claimedByStationId: true, status: true },
    });
    if (!job)               return res.status(404).json({ error: 'job not found' });
    if (job.orgId !== req.orgId) return res.status(403).json({ error: 'forbidden' });

    // Only the claiming station (or the submitter from the portal) can complete it.
    const isOwner = stationId && job.claimedByStationId === stationId;
    if (!isOwner && !req.user?.id) {
      return res.status(403).json({ error: 'only the claiming station can complete this job' });
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
    console.error('[LabelPrintJob:complete]', err);
    res.status(500).json({ error: err.message });
  }
}

// ── 4. Portal lists recent jobs (for status panel) ────────────────────────
export async function listRecentPrintJobs(req, res) {
  try {
    const limit  = Math.min(100, parseInt(req.query.limit) || 25);
    const status = req.query.status; // optional filter

    const where = { orgId: req.orgId };
    if (req.storeId) where.storeId = { in: [req.storeId, null] };
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
    console.error('[LabelPrintJob:list]', err);
    res.status(500).json({ error: err.message });
  }
}

// ── 5. Get one job's status (for UI polling after submit) ─────────────────
export async function getPrintJobStatus(req, res) {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const job = await prisma.labelPrintJob.findUnique({
      where: { id },
      select: {
        id: true, orgId: true, status: true, source: true, labelCount: true,
        printerName: true, claimedByStationId: true, error: true,
        createdAt: true, claimedAt: true, completedAt: true,
      },
    });
    if (!job)                    return res.status(404).json({ error: 'not found' });
    if (job.orgId !== req.orgId) return res.status(403).json({ error: 'forbidden' });

    const { orgId, ...safe } = job;
    res.json({ job: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── 6. Retry a failed job ─────────────────────────────────────────────────
export async function retryPrintJob(req, res) {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const job = await prisma.labelPrintJob.findUnique({ where: { id } });
    if (!job)                     return res.status(404).json({ error: 'not found' });
    if (job.orgId !== req.orgId)  return res.status(403).json({ error: 'forbidden' });
    if (job.status === 'pending' || job.status === 'claimed') {
      return res.status(400).json({ error: 'job is already in flight' });
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
    res.status(500).json({ error: err.message });
  }
}

// ── 7. Cleanup — remove old completed/failed jobs ─────────────────────────
export async function cleanupPrintJobs(req, res) {
  try {
    const days = Math.max(1, parseInt(req.query.days) || 7);
    const cutoff = new Date(Date.now() - days * 86_400_000);

    const result = await prisma.labelPrintJob.deleteMany({
      where: {
        orgId:   req.orgId,
        status:  { in: ['completed', 'failed'] },
        createdAt: { lt: cutoff },
      },
    });
    res.json({ deleted: result.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
