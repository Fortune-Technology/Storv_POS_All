/**
 * Enrollment management — per-store × manufacturer-feed configuration.
 * Split from `scanDataController.ts` (S80).
 *
 * Permissions:
 *   scan_data.view    — list / get
 *   scan_data.enroll  — upsert / status / delete / test-connection
 *
 * SFTP password storage: encrypted via cryptoVault.encrypt(). Never returned
 * in plaintext from any endpoint — list/get show `sftpPasswordSet: true|false`
 * + the masked last-4 of the username only.
 */

import type { Request, Response } from 'express';
import type { Prisma, ScanDataEnrollment } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { encrypt, mask } from '../../utils/cryptoVault.js';
import { testConnection } from '../../services/scanData/sftpService.js';
import { getOrgId } from './helpers.js';

// Strip sftpPasswordEnc from any response and add a `sftpPasswordSet` boolean
// so the UI can render "•••• (set)" vs "Not set" without ever seeing plaintext.
function safeEnrollment<T extends Partial<ScanDataEnrollment>>(e: T | null): (Omit<T, 'sftpPasswordEnc'> & { sftpPasswordSet: boolean; sftpUsernameMasked: string | null }) | null {
  if (!e) return null;
  const { sftpPasswordEnc, ...rest } = e;
  return {
    ...rest,
    sftpPasswordSet: Boolean(sftpPasswordEnc),
    sftpUsernameMasked: e.sftpUsername ? mask(e.sftpUsername, 3) : null,
  } as Omit<T, 'sftpPasswordEnc'> & { sftpPasswordSet: boolean; sftpUsernameMasked: string | null };
}

// ══════════════════════════════════════════════════════════════════════════
// ENROLLMENTS
// ══════════════════════════════════════════════════════════════════════════

export const listEnrollments = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as { storeId?: string };
    const { storeId } = q;
    const where: Prisma.ScanDataEnrollmentWhereInput = { orgId: orgId ?? undefined };
    if (storeId) where.storeId = String(storeId);

    const rows = await prisma.scanDataEnrollment.findMany({
      where,
      include: {
        manufacturer: {
          select: {
            id: true, code: true, parentMfrCode: true, name: true,
            shortName: true, fileFormat: true, brandFamilies: true,
          },
        },
      },
      orderBy: [{ storeId: 'asc' }, { createdAt: 'asc' }],
    });
    type EnrollmentRow = (typeof rows)[number];
    res.json({ success: true, data: (rows as EnrollmentRow[]).map((r) => safeEnrollment(r)) });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const getEnrollment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const row = await prisma.scanDataEnrollment.findFirst({
      where: { id, orgId: orgId ?? undefined },
      include: { manufacturer: true },
    });
    if (!row) { res.status(404).json({ success: false, error: 'Enrollment not found' }); return; }
    res.json({ success: true, data: safeEnrollment(row) });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

interface UpsertEnrollmentBody {
  storeId?: string;
  manufacturerId?: string;
  mfrRetailerId?: string | null;
  mfrChainId?: string | null;
  sftpHost?: string | null;
  sftpPort?: number | string | null;
  sftpUsername?: string | null;
  sftpPassword?: string;    // plaintext — encrypted before persist
  clearPassword?: boolean;  // explicit "remove the stored password" flag
  sftpPath?: string | null;
  environment?: string;
  status?: string;
  notes?: string | null;
}

export const upsertEnrollment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as UpsertEnrollmentBody;
    const {
      storeId,
      manufacturerId,
      mfrRetailerId,
      mfrChainId,
      sftpHost,
      sftpPort,
      sftpUsername,
      sftpPassword,    // plaintext — encrypted before persist
      clearPassword,   // explicit "remove the stored password" flag
      sftpPath,
      environment,
      status,
      notes,
    } = body;

    if (!storeId || !manufacturerId) {
      res.status(400).json({ success: false, error: 'storeId and manufacturerId are required' });
      return;
    }

    const mfr = await prisma.tobaccoManufacturer.findUnique({ where: { id: manufacturerId } });
    if (!mfr) { res.status(400).json({ success: false, error: 'Unknown manufacturer feed' }); return; }

    const existing = await prisma.scanDataEnrollment.findUnique({
      where: { storeId_manufacturerId: { storeId, manufacturerId } },
    });

    // Build the data payload, only encrypting password when one is supplied.
    const data: Record<string, unknown> = {
      orgId,
      storeId,
      manufacturerId,
      mfrRetailerId: mfrRetailerId ?? null,
      mfrChainId:    mfrChainId ?? null,
      sftpHost:      sftpHost ?? null,
      sftpPort:      sftpPort ? Number(sftpPort) : 22,
      sftpUsername:  sftpUsername ?? null,
      sftpPath:      sftpPath ?? '/upload/',
      environment:   environment === 'production' ? 'production' : 'uat',
      status:        status || (existing?.status ?? 'draft'),
      notes:         notes ?? null,
    };

    if (sftpPassword) {
      data.sftpPasswordEnc = encrypt(sftpPassword);
    } else if (clearPassword) {
      data.sftpPasswordEnc = null;
    }

    const row = existing
      ? await prisma.scanDataEnrollment.update({
          where: { id: existing.id },
          data: data as Prisma.ScanDataEnrollmentUpdateInput,
          include: { manufacturer: true },
        })
      : await prisma.scanDataEnrollment.create({
          data: { ...data, enrolledAt: new Date() } as unknown as Prisma.ScanDataEnrollmentCreateInput,
          include: { manufacturer: true },
        });

    res.json({ success: true, data: safeEnrollment(row) });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const updateEnrollmentStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const body = (req.body || {}) as { status?: string };
    const { status } = body;
    const valid = ['draft', 'certifying', 'active', 'suspended', 'rejected'];
    if (!status || !valid.includes(status)) {
      res.status(400).json({ success: false, error: 'Invalid status' });
      return;
    }
    const row = await prisma.scanDataEnrollment.findFirst({ where: { id, orgId: orgId ?? undefined } });
    if (!row) { res.status(404).json({ success: false, error: 'Enrollment not found' }); return; }

    const data: Prisma.ScanDataEnrollmentUpdateInput = { status };
    if (status === 'active' && !row.certifiedAt) data.certifiedAt = new Date();
    if (status === 'suspended') data.suspendedAt = new Date();

    const updated = await prisma.scanDataEnrollment.update({
      where: { id },
      data,
      include: { manufacturer: true },
    });
    res.json({ success: true, data: safeEnrollment(updated) });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const deleteEnrollment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const row = await prisma.scanDataEnrollment.findFirst({ where: { id, orgId: orgId ?? undefined } });
    if (!row) { res.status(404).json({ success: false, error: 'Enrollment not found' }); return; }

    // Block deletion if any submissions exist for this enrollment
    const subCount = await prisma.scanDataSubmission.count({
      where: { orgId: orgId ?? undefined, storeId: row.storeId, manufacturerId: row.manufacturerId },
    });
    if (subCount > 0) {
      res.status(409).json({
        success: false,
        error: `Cannot delete — ${subCount} historical submissions reference this enrollment. Suspend instead.`,
      });
      return;
    }

    await prisma.scanDataEnrollment.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── POST /scan-data/enrollments/:id/test-connection (owner+ via scan_data.enroll) ──
//
// SFTP smoke test for a single enrollment. Connects, lists the upload dir,
// reports success or the exact error. Useful before flipping cert→active.
export const testEnrollmentConnection = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const enrollment = await prisma.scanDataEnrollment.findFirst({ where: { id, orgId: orgId ?? undefined } });
    if (!enrollment) { res.status(404).json({ success: false, error: 'Enrollment not found' }); return; }

    const result = await testConnection(enrollment as Parameters<typeof testConnection>[0]);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
