/**
 * StoreVeu Exchange — store code + trading partner handshake.
 */

import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import prisma from '../config/postgres.js';
import {
  sendPartnerHandshakeRequest,
  sendPartnerHandshakeAccepted,
} from '../services/emailService.js';

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const getOrgId   = (req: Request): string | null | undefined => req.orgId || req.user?.orgId;
const getStoreId = (req: Request): string | null | undefined =>
  (req.headers['x-store-id'] as string | undefined) || req.storeId || (req.query.storeId as string | undefined);

// ═══════════════════════════════════════════════════════════════
// STORE CODE
// ═══════════════════════════════════════════════════════════════

const CODE_RX = /^[A-Z0-9][A-Z0-9\-]{2,23}$/;
const RESERVED = new Set(['ADMIN', 'STORV', 'STOREVEU', 'SYSTEM', 'SUPPORT', 'TEST', 'DEMO']);

interface ValidateCodeResult {
  ok: boolean;
  code?: string;
  error?: string;
}

function validateCode(raw: unknown): ValidateCodeResult {
  if (!raw) return { ok: false, error: 'Code is required.' };
  const code = String(raw).trim().toUpperCase().replace(/\s+/g, '-');
  if (!CODE_RX.test(code)) {
    return { ok: false, error: 'Use 3–24 chars: letters, numbers, dashes. Must start with a letter or number.' };
  }
  if (RESERVED.has(code)) return { ok: false, error: 'This code is reserved. Please pick another.' };
  return { ok: true, code };
}

/** GET /api/exchange/store-code */
export const getMyStoreCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: {
        id: true, name: true, orgId: true,
        storeCode: true, storeCodeLockedAt: true,
        address: true, latitude: true, longitude: true, timezone: true,
      },
    });
    if (!store || store.orgId !== getOrgId(req)) {
      res.status(404).json({ success: false, error: 'Store not found' });
      return;
    }
    res.json({ success: true, data: { ...store, locked: !!store.storeCodeLockedAt } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

/** GET /api/exchange/store-code/check?code=STORV-MAIN */
export const checkCodeAvailability = async (req: Request, res: Response): Promise<void> => {
  try {
    const v = validateCode(req.query.code);
    if (!v.ok) { res.json({ success: true, data: { available: false, reason: v.error } }); return; }

    const storeId = getStoreId(req);
    const existing = await prisma.store.findUnique({ where: { storeCode: v.code as string } });
    const available = !existing || existing.id === storeId;

    let suggestion: string | null = null;
    if (!available) {
      // Suggest a nearby available variant
      for (let i = 2; i <= 20; i++) {
        const candidate = `${v.code}-${i}`;
        if (candidate.length > 24) break;
        const hit = await prisma.store.findUnique({ where: { storeCode: candidate } });
        if (!hit) { suggestion = candidate; break; }
      }
    }
    res.json({ success: true, data: { available, code: v.code, suggestion } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

/** PUT /api/exchange/store-code  body { code } */
export const setMyStoreCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStoreId(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }

    const v = validateCode((req.body as { code?: string })?.code);
    if (!v.ok) { res.status(400).json({ success: false, error: v.error }); return; }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, orgId: true, storeCode: true, storeCodeLockedAt: true },
    });
    if (!store || store.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Store not found' });
      return;
    }
    if (store.storeCodeLockedAt) {
      res.status(409).json({
        success: false,
        error: 'Store code is locked — first trading partnership or PO has already been created. Contact support to change.',
      });
      return;
    }

    // Uniqueness check
    const taken = await prisma.store.findUnique({ where: { storeCode: v.code as string } });
    if (taken && taken.id !== storeId) {
      res.status(409).json({ success: false, error: 'This code is already taken.' });
      return;
    }

    const updated = await prisma.store.update({
      where: { id: storeId },
      data: { storeCode: v.code },
      select: { id: true, name: true, storeCode: true, storeCodeLockedAt: true },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

/** GET /api/exchange/lookup/:code */
export const lookupByCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const v = validateCode(req.params.code);
    if (!v.ok) { res.status(400).json({ success: false, error: v.error }); return; }

    const store = await prisma.store.findUnique({
      where: { storeCode: v.code as string },
      select: {
        id: true, name: true, storeCode: true,
        address: true, timezone: true, isActive: true,
        organization: { select: { name: true } },
      },
    });
    if (!store || !store.isActive) {
      res.status(404).json({ success: false, error: 'No active store with that code.' });
      return;
    }
    const myStoreId = getStoreId(req);
    const isSelf = store.id === myStoreId;

    // Check if partnership already exists (either direction)
    let partnership = null;
    if (!isSelf && myStoreId) {
      partnership = await prisma.tradingPartner.findFirst({
        where: {
          OR: [
            { requesterStoreId: myStoreId, partnerStoreId: store.id },
            { requesterStoreId: store.id, partnerStoreId: myStoreId },
          ],
        },
        select: { id: true, status: true, requesterStoreId: true },
      });
    }

    res.json({
      success: true,
      data: {
        storeId: store.id,
        name: store.name,
        storeCode: store.storeCode,
        address: store.address,
        timezone: store.timezone,
        orgName: store.organization?.name || null,
        isSelf,
        partnership,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ═══════════════════════════════════════════════════════════════
// TRADING PARTNERS — handshake
// ═══════════════════════════════════════════════════════════════

/** Mark a store's code as locked — called after first partnership or first PO. */
export async function lockStoreCode(storeId: string, tx: TxClient | typeof prisma = prisma): Promise<void> {
  await tx.store.updateMany({
    where: { id: storeId, storeCodeLockedAt: null },
    data: { storeCodeLockedAt: new Date() },
  });
}

/** GET /api/exchange/partners */
export const listPartners = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }

    const partnerships = await prisma.tradingPartner.findMany({
      where: {
        OR: [{ requesterStoreId: storeId }, { partnerStoreId: storeId }],
      },
      include: {
        requesterStore: {
          select: {
            id: true, name: true, storeCode: true, address: true,
            organization: { select: { name: true } },
          },
        },
        partnerStore: {
          select: {
            id: true, name: true, storeCode: true, address: true,
            organization: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    type PartnershipRow = (typeof partnerships)[number];

    // Annotate each partnership with the "other" store
    const annotated = partnerships.map((p: PartnershipRow) => {
      const otherStore = p.requesterStoreId === storeId ? p.partnerStore : p.requesterStore;
      const direction = p.requesterStoreId === storeId ? 'outgoing' : 'incoming';
      return {
        id: p.id,
        status: p.status,
        direction,
        requestNote: p.requestNote,
        requestedAt: p.createdAt,
        respondedAt: p.respondedAt,
        revokedAt: p.revokedAt,
        partner: otherStore,
      };
    });

    res.json({ success: true, data: annotated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

/** POST /api/exchange/partners */
export const sendPartnerRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStoreId(req);
    const userId = req.user?.id;
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }

    const { partnerStoreId, requestNote } = (req.body || {}) as { partnerStoreId?: string; requestNote?: string };
    if (!partnerStoreId) { res.status(400).json({ success: false, error: 'partnerStoreId required' }); return; }
    if (partnerStoreId === storeId) { res.status(400).json({ success: false, error: "You can't partner with yourself." }); return; }

    const partnerStore = await prisma.store.findUnique({
      where: { id: partnerStoreId },
      select: { id: true, name: true, orgId: true, isActive: true, storeCode: true },
    });
    if (!partnerStore || !partnerStore.isActive) {
      res.status(404).json({ success: false, error: 'Partner store not found.' });
      return;
    }

    // Check existing partnership (either direction)
    const existing = await prisma.tradingPartner.findFirst({
      where: {
        OR: [
          { requesterStoreId: storeId, partnerStoreId },
          { requesterStoreId: partnerStoreId, partnerStoreId: storeId },
        ],
      },
    });
    if (existing) {
      if (existing.status === 'accepted') {
        res.status(409).json({ success: false, error: 'Already partnered.' });
        return;
      }
      if (existing.status === 'pending') {
        res.status(409).json({ success: false, error: 'A pending request already exists.' });
        return;
      }
      // Rejected/revoked → allow re-request by updating
      const reset = await prisma.tradingPartner.update({
        where: { id: existing.id },
        data: {
          requesterStoreId: storeId,
          requesterOrgId: orgId as string,
          partnerStoreId,
          partnerOrgId: partnerStore.orgId,
          status: 'pending',
          requestNote: requestNote || null,
          requestedById: userId,
          respondedAt: null,
          respondedById: null,
          revokedAt: null,
          revokedById: null,
          revokeReason: null,
        },
      });
      await notifyPartnerRequest(reset.id).catch(() => { /* non-blocking */ });
      res.json({ success: true, data: reset });
      return;
    }

    const created = await prisma.tradingPartner.create({
      data: {
        requesterStoreId: storeId,
        requesterOrgId: orgId as string,
        partnerStoreId,
        partnerOrgId: partnerStore.orgId,
        status: 'pending',
        requestNote: requestNote || null,
        requestedById: userId,
      },
    });
    await notifyPartnerRequest(created.id).catch(() => { /* non-blocking */ });
    res.json({ success: true, data: created });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

async function notifyPartnerRequest(partnershipId: string): Promise<void> {
  const p = await prisma.tradingPartner.findUnique({
    where: { id: partnershipId },
    include: {
      requesterStore: { select: { name: true, storeCode: true } },
      partnerStore: {
        select: {
          name: true,
          organization: { select: { billingEmail: true } },
        },
      },
    },
  });
  if (!p?.partnerStore?.organization?.billingEmail) return;
  await sendPartnerHandshakeRequest(p.partnerStore.organization.billingEmail, {
    requesterName: p.requesterStore.name,
    requesterCode: p.requesterStore.storeCode || undefined,
    partnerName: p.partnerStore.name,
    requestNote: p.requestNote || undefined,
  });
}

/** POST /api/exchange/partners/:id/accept */
export const acceptPartnerRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;

    const p = await prisma.tradingPartner.findUnique({ where: { id } });
    if (!p) { res.status(404).json({ success: false, error: 'Request not found.' }); return; }
    if (p.partnerStoreId !== storeId) {
      res.status(403).json({ success: false, error: 'Only the recipient can accept.' });
      return;
    }
    if (p.status !== 'pending') {
      res.status(400).json({ success: false, error: `Cannot accept — current status: ${p.status}.` });
      return;
    }

    const updated = await prisma.$transaction(async (tx: TxClient) => {
      const u = await tx.tradingPartner.update({
        where: { id },
        data: { status: 'accepted', respondedAt: new Date(), respondedById: userId },
      });
      await lockStoreCode(p.requesterStoreId, tx);
      await lockStoreCode(p.partnerStoreId, tx);
      return u;
    });
    notifyPartnerAccepted(id).catch(() => { /* non-blocking */ });
    res.json({ success: true, data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

async function notifyPartnerAccepted(partnershipId: string): Promise<void> {
  const p = await prisma.tradingPartner.findUnique({
    where: { id: partnershipId },
    include: {
      requesterStore: {
        select: { name: true, organization: { select: { billingEmail: true } } },
      },
      partnerStore: { select: { name: true, storeCode: true } },
    },
  });
  if (!p?.requesterStore?.organization?.billingEmail) return;
  await sendPartnerHandshakeAccepted(p.requesterStore.organization.billingEmail, {
    requesterName: p.requesterStore.name,
    partnerName: p.partnerStore.name,
    partnerCode: p.partnerStore.storeCode || undefined,
  });
}

/** POST /api/exchange/partners/:id/reject  body { reason? } */
export const rejectPartnerRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;
    const reason = (req.body as { reason?: string })?.reason || null;

    const p = await prisma.tradingPartner.findUnique({ where: { id } });
    if (!p) { res.status(404).json({ success: false, error: 'Request not found.' }); return; }
    if (p.partnerStoreId !== storeId) {
      res.status(403).json({ success: false, error: 'Only the recipient can reject.' });
      return;
    }
    if (p.status !== 'pending') {
      res.status(400).json({ success: false, error: `Cannot reject — current status: ${p.status}.` });
      return;
    }

    const updated = await prisma.tradingPartner.update({
      where: { id },
      data: {
        status: 'rejected',
        respondedAt: new Date(),
        respondedById: userId,
        revokeReason: reason,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

/** POST /api/exchange/partners/:id/revoke  body { reason? } */
export const revokePartnership = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;
    const reason = (req.body as { reason?: string })?.reason || null;

    const p = await prisma.tradingPartner.findUnique({ where: { id } });
    if (!p) { res.status(404).json({ success: false, error: 'Partnership not found.' }); return; }
    if (p.requesterStoreId !== storeId && p.partnerStoreId !== storeId) {
      res.status(403).json({ success: false, error: 'Not your partnership.' });
      return;
    }
    if (p.status === 'revoked') {
      res.status(400).json({ success: false, error: 'Already revoked.' });
      return;
    }

    const updated = await prisma.tradingPartner.update({
      where: { id },
      data: {
        status: 'revoked',
        revokedAt: new Date(),
        revokedById: userId,
        revokeReason: reason,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

/** GET /api/exchange/partners/pending-incoming */
export const pendingIncoming = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const items = await prisma.tradingPartner.findMany({
      where: { partnerStoreId: storeId, status: 'pending' },
      include: {
        requesterStore: {
          select: {
            id: true, name: true, storeCode: true, address: true,
            organization: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: items, count: items.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

/** GET /api/exchange/partners/accepted */
export const listAcceptedPartners = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const partnerships = await prisma.tradingPartner.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterStoreId: storeId }, { partnerStoreId: storeId }],
      },
      include: {
        requesterStore: {
          select: { id: true, name: true, storeCode: true, address: true,
            organization: { select: { id: true, name: true } } },
        },
        partnerStore: {
          select: { id: true, name: true, storeCode: true, address: true,
            organization: { select: { id: true, name: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    type PartnershipRow = (typeof partnerships)[number];
    const partners = partnerships.map((p: PartnershipRow) => {
      const s = p.requesterStoreId === storeId ? p.partnerStore : p.requesterStore;
      return {
        partnershipId: p.id,
        storeId: s.id,
        name: s.name,
        storeCode: s.storeCode,
        address: s.address,
        orgId: s.organization?.id,
        orgName: s.organization?.name,
      };
    });
    res.json({ success: true, data: partners });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};
