/**
 * Storv Exchange — partner balances, ledger, settlements.
 *
 * Balances are canonicalized (storeAId < storeBId alphabetically).
 * From a caller's perspective, we always return:
 *   netBalance       — signed amount from YOUR perspective
 *                      positive = partner owes you
 *                      negative = you owe partner
 *                      zero     = settled
 *
 * Settlements have a 7-day dispute window. After that they're locked in
 * ("accepted"). Either party can dispute within the window. Disputes must
 * be resolved manually by one party marking resolved.
 */

import prisma from '../config/postgres.js';
import {
  sendSettlementRecorded, sendSettlementDisputed, sendSettlementConfirmed,
} from '../services/emailService.js';

const getStoreId = (req) => req.headers['x-store-id'] || req.storeId || req.query.storeId;

function canonPair(a, b) {
  return a < b ? { storeAId: a, storeBId: b, swapped: false } : { storeAId: b, storeBId: a, swapped: true };
}

/** Convert canonical `balance` (positive = B owes A) into a signed value from
 *  the caller's perspective. */
function balanceFromPerspective(canonical, myStoreId) {
  // if myStoreId === storeAId: positive balance = partner(B) owes me → return +balance
  // if myStoreId === storeBId: positive balance = I owe partner(A) → return -balance
  return canonical.storeAId === myStoreId ? Number(canonical.balance) : -Number(canonical.balance);
}

// ═══════════════════════════════════════════════════════════════
// BALANCES
// ═══════════════════════════════════════════════════════════════

/** GET /api/exchange/balances  → list of all my partner balances */
export const listBalances = async (req, res) => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });

    const rows = await prisma.partnerBalance.findMany({
      where: { OR: [{ storeAId: storeId }, { storeBId: storeId }] },
      include: {
        storeA: { select: { id: true, name: true, storeCode: true,
          organization: { select: { name: true } } } },
        storeB: { select: { id: true, name: true, storeCode: true,
          organization: { select: { name: true } } } },
      },
      orderBy: { lastActivityAt: 'desc' },
    });

    const annotated = rows.map((r) => {
      const partner = r.storeAId === storeId ? r.storeB : r.storeA;
      const netBalance = balanceFromPerspective(r, storeId);
      return {
        id: r.id,
        partnerStoreId: partner.id,
        partnerName: partner.name,
        partnerStoreCode: partner.storeCode,
        partnerOrgName: partner.organization?.name,
        netBalance,                        // signed from my perspective
        direction: netBalance > 0.005 ? 'partner_owes_me' :
                   netBalance < -0.005 ? 'i_owe_partner' : 'settled',
        lastActivityAt: r.lastActivityAt,
        updatedAt: r.updatedAt,
      };
    });

    // Summary totals
    const totalOwedToMe = annotated.filter(a => a.netBalance > 0).reduce((s, a) => s + a.netBalance, 0);
    const totalIOwe = annotated.filter(a => a.netBalance < 0).reduce((s, a) => s + Math.abs(a.netBalance), 0);

    res.json({
      success: true,
      data: annotated,
      summary: {
        partnerCount: annotated.length,
        totalOwedToMe: +totalOwedToMe.toFixed(2),
        totalIOwe: +totalIOwe.toFixed(2),
        netPosition: +(totalOwedToMe - totalIOwe).toFixed(2),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/** GET /api/exchange/balances/:partnerStoreId/ledger  → full ledger for one pair */
export const getLedger = async (req, res) => {
  try {
    const storeId = getStoreId(req);
    const partnerStoreId = req.params.partnerStoreId;
    if (!storeId || !partnerStoreId) {
      return res.status(400).json({ success: false, error: 'storeId and partnerStoreId required' });
    }

    const { storeAId, storeBId } = canonPair(storeId, partnerStoreId);

    const [balanceRow, entries, partnerStore] = await Promise.all([
      prisma.partnerBalance.findUnique({ where: { storeAId_storeBId: { storeAId, storeBId } } }),
      prisma.ledgerEntry.findMany({
        where: { storeAId, storeBId },
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: {
          wholesaleOrder: { select: { id: true, orderNumber: true, status: true } },
          settlement: { select: { id: true, method: true, status: true } },
        },
      }),
      prisma.store.findUnique({
        where: { id: partnerStoreId },
        select: { id: true, name: true, storeCode: true, address: true,
          organization: { select: { name: true } } },
      }),
    ]);

    // Translate each entry to caller's perspective
    const myLedger = entries.map((e) => {
      const iAmA = storeAId === storeId;
      // direction "B_OWES_A" → amount increased (someone owes A more)
      // if I'm A, positive delta = partner owes me more
      // if I'm B, positive delta = I owe partner more (reverse sign)
      const canonicalDelta = e.direction === 'B_OWES_A' ? Number(e.amount) : -Number(e.amount);
      const myDelta = iAmA ? canonicalDelta : -canonicalDelta;
      const balanceAfterForMe = iAmA ? Number(e.balanceAfter) : -Number(e.balanceAfter);
      return {
        id: e.id,
        entryType: e.entryType,
        description: e.description,
        amount: Math.abs(myDelta),
        signedAmount: myDelta,          // positive = partner owes me more; negative = I owe partner more
        balanceAfter: balanceAfterForMe,
        wholesaleOrder: e.wholesaleOrder,
        settlement: e.settlement,
        createdAt: e.createdAt,
      };
    });

    const netBalance = balanceRow ? balanceFromPerspective(balanceRow, storeId) : 0;

    res.json({
      success: true,
      data: {
        partner: partnerStore,
        netBalance,
        direction: netBalance > 0.005 ? 'partner_owes_me' :
                   netBalance < -0.005 ? 'i_owe_partner' : 'settled',
        lastActivityAt: balanceRow?.lastActivityAt || null,
        entries: myLedger,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// SETTLEMENTS
// ═══════════════════════════════════════════════════════════════

const METHODS = new Set(['cash', 'check', 'bank_transfer', 'zelle', 'venmo', 'other']);

/**
 * POST /api/exchange/settlements
 *   body { partnerStoreId, amount, method, methodRef?, note?, paidByMe?: boolean }
 *
 * Creates a Settlement with status='pending' and notifies the other party.
 *
 * NO ledger entry and NO balance change happen yet — those are written only
 * when the OTHER party calls POST /settlements/:id/confirm. This ensures
 * both sides explicitly agree a payment changed hands before the books
 * reflect it.
 */
export const recordSettlement = async (req, res) => {
  try {
    const myStoreId = getStoreId(req);
    const userId = req.user?.id;
    const { partnerStoreId, amount, method, methodRef, note, paidByMe } = req.body || {};
    if (!myStoreId) return res.status(400).json({ success: false, error: 'storeId required' });
    if (!partnerStoreId) return res.status(400).json({ success: false, error: 'partnerStoreId required' });
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'amount must be > 0' });
    if (!METHODS.has(method)) return res.status(400).json({ success: false, error: 'invalid method' });

    const partnerStore = await prisma.store.findUnique({
      where: { id: partnerStoreId },
      select: { id: true, name: true, isActive: true,
        organization: { select: { billingEmail: true } } },
    });
    if (!partnerStore?.isActive) return res.status(404).json({ success: false, error: 'Partner store not found.' });

    const payerStoreId = paidByMe ? myStoreId : partnerStoreId;
    const payeeStoreId = paidByMe ? partnerStoreId : myStoreId;

    const { storeAId, storeBId } = canonPair(myStoreId, partnerStoreId);

    // Use far-future date so the legacy disputeWindowEndsAt column (NOT NULL
    // in schema) stays valid. It's no longer load-bearing — confirmation is
    // explicit, not time-based.
    const sentinelWindow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const settlement = await prisma.settlement.create({
      data: {
        storeAId, storeBId,
        payerStoreId, payeeStoreId,
        amount: amt, method, methodRef: methodRef || null, note: note || null,
        status: 'pending', disputeWindowEndsAt: sentinelWindow,
        recordedById: userId,
      },
    });

    // Notify the other party that action is required
    if (partnerStore.organization?.billingEmail) {
      sendSettlementRecorded(partnerStore.organization.billingEmail, {
        method, amount: amt, methodRef, note,
        paidByMe: !paidByMe,                    // from partner's POV
        needsConfirmation: true,
      }).catch(() => {});
    }

    res.json({ success: true, data: settlement });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/exchange/settlements/:id/confirm
 *
 * Called by the party who DIDN'T record the settlement to confirm they actually
 * received (or paid) the amount. This is where the ledger entry + balance
 * update happen. Only the counterparty can confirm.
 */
export const confirmSettlement = async (req, res) => {
  try {
    const myStoreId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;

    const s = await prisma.settlement.findUnique({ where: { id } });
    if (!s) return res.status(404).json({ success: false, error: 'Settlement not found.' });
    if (s.storeAId !== myStoreId && s.storeBId !== myStoreId) {
      return res.status(403).json({ success: false, error: 'Not your settlement.' });
    }
    if (s.recordedById === userId) {
      return res.status(400).json({ success: false, error: 'The other party must confirm — you recorded this.' });
    }
    if (s.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Already ${s.status}.` });
    }

    const amt = Number(s.amount);
    const payerIsA = s.payerStoreId === s.storeAId;
    const direction = payerIsA ? 'B_OWES_A' : 'A_OWES_B';
    const delta     = payerIsA ? amt : -amt;

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.settlement.update({
        where: { id },
        data:  { status: 'accepted', resolvedAt: new Date(), resolvedById: userId },
      });

      const pb = await tx.partnerBalance.upsert({
        where:  { storeAId_storeBId: { storeAId: s.storeAId, storeBId: s.storeBId } },
        update: { balance: { increment: delta }, lastActivityAt: new Date() },
        create: { storeAId: s.storeAId, storeBId: s.storeBId, balance: delta, lastActivityAt: new Date() },
      });

      await tx.ledgerEntry.create({
        data: {
          storeAId: s.storeAId, storeBId: s.storeBId, direction, amount: amt,
          balanceAfter: Number(pb.balance),
          entryType: 'settlement',
          settlementId: s.id,
          description: `Settlement confirmed: ${s.method}${s.methodRef ? ' #' + s.methodRef : ''} — ${amt.toFixed(2)}`,
          createdById: userId,
        },
      });
      return u;
    });

    // Notify the original recorder that it was confirmed
    const recorderStoreId = s.payerStoreId === myStoreId ? s.payeeStoreId : s.payerStoreId;
    const other = await prisma.store.findUnique({
      where: { id: recorderStoreId },
      select: { name: true, organization: { select: { billingEmail: true } } },
    });
    if (other?.organization?.billingEmail) {
      sendSettlementConfirmed(other.organization.billingEmail, {
        amount: amt, method: s.method, methodRef: s.methodRef,
      }).catch(() => {});
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/** GET /api/exchange/settlements?partnerStoreId=... */
export const listSettlements = async (req, res) => {
  try {
    const myStoreId = getStoreId(req);
    const partnerStoreId = req.query.partnerStoreId;
    if (!myStoreId) return res.status(400).json({ success: false, error: 'storeId required' });

    const where = {};
    if (partnerStoreId) {
      const { storeAId, storeBId } = canonPair(myStoreId, partnerStoreId);
      where.storeAId = storeAId; where.storeBId = storeBId;
    } else {
      where.OR = [{ storeAId: myStoreId }, { storeBId: myStoreId }];
    }

    const rows = await prisma.settlement.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take: 200,
    });

    // Annotate from my perspective + flag whose turn it is to act
    const userId = req.user?.id;
    const annotated = rows.map((s) => ({
      ...s,
      paidByMe: s.payerStoreId === myStoreId,
      recordedByMe: s.recordedById === userId,
      needsMyConfirmation: s.status === 'pending' && s.recordedById !== userId,
    }));

    res.json({ success: true, data: annotated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/** POST /api/exchange/settlements/:id/dispute  body { reason } */
export const disputeSettlement = async (req, res) => {
  try {
    const myStoreId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;
    const reason = req.body?.reason;
    if (!reason) return res.status(400).json({ success: false, error: 'reason required' });

    const s = await prisma.settlement.findUnique({ where: { id } });
    if (!s) return res.status(404).json({ success: false, error: 'Settlement not found.' });
    if (s.storeAId !== myStoreId && s.storeBId !== myStoreId) {
      return res.status(403).json({ success: false, error: 'Not your settlement.' });
    }
    if (s.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Cannot dispute — status: ${s.status}` });
    }
    if (new Date() > s.disputeWindowEndsAt) {
      return res.status(400).json({ success: false, error: 'Dispute window has closed.' });
    }

    const updated = await prisma.settlement.update({
      where: { id },
      data: { status: 'disputed', disputedAt: new Date(), disputedById: userId, disputeReason: reason },
    });

    // Notify the recorder
    const otherStoreId = s.storeAId === myStoreId ? s.storeBId : s.storeAId;
    const other = await prisma.store.findUnique({
      where: { id: otherStoreId },
      select: { organization: { select: { billingEmail: true } } },
    });
    if (other?.organization?.billingEmail) {
      sendSettlementDisputed(other.organization.billingEmail, {
        amount: Number(s.amount), method: s.method, reason,
      }).catch(() => {});
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/** POST /api/exchange/settlements/:id/resolve  → mark a disputed settlement resolved */
export const resolveSettlement = async (req, res) => {
  try {
    const myStoreId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;

    const s = await prisma.settlement.findUnique({ where: { id } });
    if (!s) return res.status(404).json({ success: false, error: 'Settlement not found.' });
    if (s.storeAId !== myStoreId && s.storeBId !== myStoreId) {
      return res.status(403).json({ success: false, error: 'Not your settlement.' });
    }
    if (s.status !== 'disputed') {
      return res.status(400).json({ success: false, error: `Not disputed (status: ${s.status})` });
    }
    const updated = await prisma.settlement.update({
      where: { id },
      data: { status: 'accepted', resolvedAt: new Date(), resolvedById: userId },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// REPORT (one unified table of all orders + ledger + settlements)
// ═══════════════════════════════════════════════════════════════

/** GET /api/exchange/report  ?dateFrom&dateTo&partnerStoreId&type=all|credits|debits */
export const exchangeReport = async (req, res) => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const { dateFrom, dateTo, partnerStoreId, type = 'all' } = req.query;

    const where = {
      OR: [{ senderStoreId: storeId }, { receiverStoreId: storeId }],
      status: { in: ['confirmed', 'partially_confirmed'] },
    };
    if (dateFrom) where.confirmedAt = { ...(where.confirmedAt || {}), gte: new Date(dateFrom + 'T00:00:00') };
    if (dateTo)   where.confirmedAt = { ...(where.confirmedAt || {}), lte: new Date(dateTo + 'T23:59:59.999') };
    if (partnerStoreId) {
      where.AND = [{ OR: [{ senderStoreId: partnerStoreId }, { receiverStoreId: partnerStoreId }] }];
    }

    const orders = await prisma.wholesaleOrder.findMany({
      where,
      include: {
        senderStore: { select: { id: true, name: true, storeCode: true } },
        receiverStore: { select: { id: true, name: true, storeCode: true } },
      },
      orderBy: { confirmedAt: 'desc' },
    });

    let totalOutgoing = 0, totalIncoming = 0;
    const rows = orders.map((o) => {
      const direction = o.senderStoreId === storeId ? 'outgoing' : 'incoming';
      const amount = Number(o.confirmedGrandTotal || o.grandTotal);
      if (direction === 'outgoing') totalOutgoing += amount;
      else totalIncoming += amount;
      return {
        type: 'order',
        id: o.id,
        orderNumber: o.orderNumber,
        direction,                      // outgoing = credit to me; incoming = debit
        partner: direction === 'outgoing' ? o.receiverStore : o.senderStore,
        amount,
        status: o.status,
        at: o.confirmedAt,
        isInternalTransfer: o.isInternalTransfer,
      };
    });

    let filtered = rows;
    if (type === 'credits') filtered = rows.filter(r => r.direction === 'outgoing');
    if (type === 'debits')  filtered = rows.filter(r => r.direction === 'incoming');

    res.json({
      success: true,
      data: filtered,
      summary: {
        totalOutgoing: +totalOutgoing.toFixed(2),   // I shipped to partners (credits to me)
        totalIncoming: +totalIncoming.toFixed(2),   // partners shipped to me (debits to me)
        netPosition: +(totalOutgoing - totalIncoming).toFixed(2),
        orderCount: rows.length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
