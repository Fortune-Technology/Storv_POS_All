/**
 * StoreVeu Exchange — store code + trading partner handshake.
 *
 *   Store Code   claimable human-friendly identifier per store.
 *                Editable while no partnerships are accepted AND no wholesale
 *                order has been sent/received. Locks after first commitment.
 *   Discovery    GET /api/exchange/lookup/:code  → minimal profile (no PII).
 *   Partners     two-party handshake before POs can flow.
 *                Either side can initiate; the other must accept.
 *
 * Every endpoint is org/store-scoped via protect + scopeToTenant. Handshake
 * flip-sides on accept: the receiver of a request can see it in the
 * "incoming" list; the sender sees "outgoing".
 */

import prisma from '../config/postgres.js';
import {
  sendPartnerHandshakeRequest,
  sendPartnerHandshakeAccepted,
} from '../services/emailService.js';

const getOrgId = (req) => req.orgId || req.user?.orgId;
const getStoreId = (req) => req.headers['x-store-id'] || req.storeId || req.query.storeId;

// ═══════════════════════════════════════════════════════════════
// STORE CODE — claim, update, check availability, public lookup
// ═══════════════════════════════════════════════════════════════

const CODE_RX = /^[A-Z0-9][A-Z0-9\-]{2,23}$/; // 3-24 chars, uppercase alphanumeric + dashes
const RESERVED = new Set(['ADMIN', 'STORV', 'STOREVEU', 'SYSTEM', 'SUPPORT', 'TEST', 'DEMO']);

/** Normalize and validate a candidate code. Returns { ok, code?, error? } */
function validateCode(raw) {
  if (!raw) return { ok: false, error: 'Code is required.' };
  const code = String(raw).trim().toUpperCase().replace(/\s+/g, '-');
  if (!CODE_RX.test(code)) {
    return { ok: false, error: 'Use 3–24 chars: letters, numbers, dashes. Must start with a letter or number.' };
  }
  if (RESERVED.has(code)) return { ok: false, error: 'This code is reserved. Please pick another.' };
  return { ok: true, code };
}

/** GET /api/exchange/store-code  → current code + lock status for active store */
export const getMyStoreCode = async (req, res) => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: {
        id: true, name: true, orgId: true,
        storeCode: true, storeCodeLockedAt: true,
        address: true, latitude: true, longitude: true, timezone: true,
      },
    });
    if (!store || store.orgId !== getOrgId(req)) {
      return res.status(404).json({ success: false, error: 'Store not found' });
    }
    res.json({ success: true, data: { ...store, locked: !!store.storeCodeLockedAt } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/** GET /api/exchange/store-code/check?code=STORV-MAIN  → { available, suggestion? } */
export const checkCodeAvailability = async (req, res) => {
  try {
    const v = validateCode(req.query.code);
    if (!v.ok) return res.json({ success: true, data: { available: false, reason: v.error } });

    const storeId = getStoreId(req);
    const existing = await prisma.store.findUnique({ where: { storeCode: v.code } });
    const available = !existing || existing.id === storeId;

    let suggestion = null;
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
    res.status(500).json({ success: false, error: err.message });
  }
};

/** PUT /api/exchange/store-code  body { code }  → claim or change code (while unlocked) */
export const setMyStoreCode = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });

    const v = validateCode(req.body?.code);
    if (!v.ok) return res.status(400).json({ success: false, error: v.error });

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, orgId: true, storeCode: true, storeCodeLockedAt: true },
    });
    if (!store || store.orgId !== orgId) {
      return res.status(404).json({ success: false, error: 'Store not found' });
    }
    if (store.storeCodeLockedAt) {
      return res.status(409).json({
        success: false,
        error: 'Store code is locked — first trading partnership or PO has already been created. Contact support to change.',
      });
    }

    // Uniqueness check
    const taken = await prisma.store.findUnique({ where: { storeCode: v.code } });
    if (taken && taken.id !== storeId) {
      return res.status(409).json({ success: false, error: 'This code is already taken.' });
    }

    const updated = await prisma.store.update({
      where: { id: storeId },
      data: { storeCode: v.code },
      select: { id: true, name: true, storeCode: true, storeCodeLockedAt: true },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/** GET /api/exchange/lookup/:code  → minimal public profile (no PII) */
export const lookupByCode = async (req, res) => {
  try {
    const v = validateCode(req.params.code);
    if (!v.ok) return res.status(400).json({ success: false, error: v.error });

    const store = await prisma.store.findUnique({
      where: { storeCode: v.code },
      select: {
        id: true, name: true, storeCode: true,
        address: true, timezone: true, isActive: true,
        organization: { select: { name: true } },
      },
    });
    if (!store || !store.isActive) {
      return res.status(404).json({ success: false, error: 'No active store with that code.' });
    }
    // Strip anything that could be PII beyond name/address/org
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
        partnership, // null | { id, status, requesterStoreId }
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// TRADING PARTNERS — handshake
// ═══════════════════════════════════════════════════════════════

/** Mark a store's code as locked — called after first partnership or first PO. */
export async function lockStoreCode(storeId, tx = prisma) {
  await tx.store.updateMany({
    where: { id: storeId, storeCodeLockedAt: null },
    data: { storeCodeLockedAt: new Date() },
  });
}

/** GET /api/exchange/partners  → all partnerships involving my store */
export const listPartners = async (req, res) => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });

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

    // Annotate each partnership with the "other" store (from my perspective)
    const annotated = partnerships.map((p) => {
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
    res.status(500).json({ success: false, error: err.message });
  }
};

/** POST /api/exchange/partners  body { partnerStoreId, requestNote? }  → send handshake request */
export const sendPartnerRequest = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStoreId(req);
    const userId = req.user?.id;
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });

    const { partnerStoreId, requestNote } = req.body || {};
    if (!partnerStoreId) return res.status(400).json({ success: false, error: 'partnerStoreId required' });
    if (partnerStoreId === storeId) return res.status(400).json({ success: false, error: "You can't partner with yourself." });

    const partnerStore = await prisma.store.findUnique({
      where: { id: partnerStoreId },
      select: { id: true, name: true, orgId: true, isActive: true, storeCode: true },
    });
    if (!partnerStore || !partnerStore.isActive) {
      return res.status(404).json({ success: false, error: 'Partner store not found.' });
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
        return res.status(409).json({ success: false, error: 'Already partnered.' });
      }
      if (existing.status === 'pending') {
        return res.status(409).json({ success: false, error: 'A pending request already exists.' });
      }
      // Rejected/revoked → allow re-request by updating
      const reset = await prisma.tradingPartner.update({
        where: { id: existing.id },
        data: {
          requesterStoreId: storeId,
          requesterOrgId: orgId,
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
      await notifyPartnerRequest(reset.id).catch(() => {});
      return res.json({ success: true, data: reset });
    }

    const created = await prisma.tradingPartner.create({
      data: {
        requesterStoreId: storeId,
        requesterOrgId: orgId,
        partnerStoreId,
        partnerOrgId: partnerStore.orgId,
        status: 'pending',
        requestNote: requestNote || null,
        requestedById: userId,
      },
    });
    await notifyPartnerRequest(created.id).catch(() => {});
    res.json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

async function notifyPartnerRequest(partnershipId) {
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
    requesterCode: p.requesterStore.storeCode,
    partnerName: p.partnerStore.name,
    requestNote: p.requestNote,
  });
}

/** POST /api/exchange/partners/:id/accept */
export const acceptPartnerRequest = async (req, res) => {
  try {
    const storeId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;

    const p = await prisma.tradingPartner.findUnique({ where: { id } });
    if (!p) return res.status(404).json({ success: false, error: 'Request not found.' });
    if (p.partnerStoreId !== storeId) {
      return res.status(403).json({ success: false, error: 'Only the recipient can accept.' });
    }
    if (p.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Cannot accept — current status: ${p.status}.` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.tradingPartner.update({
        where: { id },
        data: { status: 'accepted', respondedAt: new Date(), respondedById: userId },
      });
      await lockStoreCode(p.requesterStoreId, tx);
      await lockStoreCode(p.partnerStoreId, tx);
      return u;
    });
    notifyPartnerAccepted(id).catch(() => {});
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

async function notifyPartnerAccepted(partnershipId) {
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
    partnerCode: p.partnerStore.storeCode,
  });
}

/** POST /api/exchange/partners/:id/reject  body { reason? } */
export const rejectPartnerRequest = async (req, res) => {
  try {
    const storeId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;
    const reason = req.body?.reason || null;

    const p = await prisma.tradingPartner.findUnique({ where: { id } });
    if (!p) return res.status(404).json({ success: false, error: 'Request not found.' });
    if (p.partnerStoreId !== storeId) {
      return res.status(403).json({ success: false, error: 'Only the recipient can reject.' });
    }
    if (p.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Cannot reject — current status: ${p.status}.` });
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
    res.status(500).json({ success: false, error: err.message });
  }
};

/** POST /api/exchange/partners/:id/revoke  body { reason? }  → either side can revoke */
export const revokePartnership = async (req, res) => {
  try {
    const storeId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;
    const reason = req.body?.reason || null;

    const p = await prisma.tradingPartner.findUnique({ where: { id } });
    if (!p) return res.status(404).json({ success: false, error: 'Partnership not found.' });
    if (p.requesterStoreId !== storeId && p.partnerStoreId !== storeId) {
      return res.status(403).json({ success: false, error: 'Not your partnership.' });
    }
    if (p.status === 'revoked') {
      return res.status(400).json({ success: false, error: 'Already revoked.' });
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
    res.status(500).json({ success: false, error: err.message });
  }
};

/** GET /api/exchange/partners/pending-incoming  → badge count + list */
export const pendingIncoming = async (req, res) => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
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
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// ACCEPTED PARTNERS QUICK-LIST (used by PO builder's recipient picker)
// ═══════════════════════════════════════════════════════════════

/** GET /api/exchange/partners/accepted  → stores I can currently trade with */
export const listAcceptedPartners = async (req, res) => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
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
    const partners = partnerships.map((p) => {
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
    res.status(500).json({ success: false, error: err.message });
  }
};
