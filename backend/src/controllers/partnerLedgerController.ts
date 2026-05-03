/**
 * StoreVeu Exchange — partner balances, ledger, settlements.
 *
 * Balances are canonicalized (storeAId < storeBId alphabetically).
 * From a caller's perspective, we always return:
 *   netBalance       — signed amount from YOUR perspective
 *                      positive = partner owes you
 *                      negative = you owe partner
 *                      zero     = settled
 *
 * Settlements have a 7-day dispute window. After that they're locked in
 * ("accepted"). Either party can dispute within the window.
 */

import type { Request, Response } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../config/postgres.js';
import {
  sendSettlementRecorded, sendSettlementDisputed, sendSettlementConfirmed,
} from '../services/emailService.js';

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const getStoreId = (req: Request): string | undefined =>
  (req.headers['x-store-id'] as string | undefined) || req.storeId || (req.query.storeId as string | undefined);

interface CanonPair {
  storeAId: string;
  storeBId: string;
  swapped: boolean;
}

function canonPair(a: string, b: string): CanonPair {
  return a < b ? { storeAId: a, storeBId: b, swapped: false } : { storeAId: b, storeBId: a, swapped: true };
}

interface CanonicalBalance {
  storeAId: string;
  storeBId: string;
  balance: Prisma.Decimal | number;
}

/** Convert canonical `balance` into a signed value from caller's perspective. */
function balanceFromPerspective(canonical: CanonicalBalance, myStoreId: string): number {
  return canonical.storeAId === myStoreId ? Number(canonical.balance) : -Number(canonical.balance);
}

// ═══════════════════════════════════════════════════════════════
// BALANCES
// ═══════════════════════════════════════════════════════════════

/** GET /api/exchange/balances  → list of all my partner balances */
export const listBalances = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }

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

    type RowWithStores = (typeof rows)[number];

    const annotated = rows.map((r: RowWithStores) => {
      const partner = r.storeAId === storeId ? r.storeB : r.storeA;
      const netBalance = balanceFromPerspective(r as unknown as CanonicalBalance, storeId);
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

    type Annotated = (typeof annotated)[number];

    // Summary totals
    const totalOwedToMe = annotated.filter((a: Annotated) => a.netBalance > 0)
      .reduce((s: number, a: Annotated) => s + a.netBalance, 0);
    const totalIOwe = annotated.filter((a: Annotated) => a.netBalance < 0)
      .reduce((s: number, a: Annotated) => s + Math.abs(a.netBalance), 0);

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
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

/** GET /api/exchange/balances/:partnerStoreId/ledger  → full ledger for one pair */
export const getLedger = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    const partnerStoreId = req.params.partnerStoreId;
    if (!storeId || !partnerStoreId) {
      res.status(400).json({ success: false, error: 'storeId and partnerStoreId required' });
      return;
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

    type LedgerEntryRow = (typeof entries)[number];

    // Translate each entry to caller's perspective
    const myLedger = entries.map((e: LedgerEntryRow) => {
      const iAmA = storeAId === storeId;
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

    const netBalance = balanceRow ? balanceFromPerspective(balanceRow as unknown as CanonicalBalance, storeId) : 0;

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
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ═══════════════════════════════════════════════════════════════
// SETTLEMENTS
// ═══════════════════════════════════════════════════════════════

const METHODS = new Set(['cash', 'check', 'bank_transfer', 'zelle', 'venmo', 'other']);

interface RecordSettlementBody {
  partnerStoreId?: string;
  amount?: number | string;
  method?: string;
  methodRef?: string | null;
  note?: string | null;
  paidByMe?: boolean;
}

/**
 * POST /api/exchange/settlements
 */
export const recordSettlement = async (req: Request, res: Response): Promise<void> => {
  try {
    const myStoreId = getStoreId(req);
    const userId = req.user?.id;
    const { partnerStoreId, amount, method, methodRef, note, paidByMe } = (req.body || {}) as RecordSettlementBody;
    if (!myStoreId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    if (!partnerStoreId) { res.status(400).json({ success: false, error: 'partnerStoreId required' }); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { res.status(400).json({ success: false, error: 'amount must be > 0' }); return; }
    if (!method || !METHODS.has(method)) { res.status(400).json({ success: false, error: 'invalid method' }); return; }

    const partnerStore = await prisma.store.findUnique({
      where: { id: partnerStoreId },
      select: { id: true, name: true, isActive: true,
        organization: { select: { billingEmail: true } } },
    });
    if (!partnerStore?.isActive) { res.status(404).json({ success: false, error: 'Partner store not found.' }); return; }

    const payerStoreId = paidByMe ? myStoreId : partnerStoreId;
    const payeeStoreId = paidByMe ? partnerStoreId : myStoreId;

    const { storeAId, storeBId } = canonPair(myStoreId, partnerStoreId);

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
        method, amount: amt, methodRef: methodRef || undefined, note: note || undefined,
        paidByMe: !paidByMe,                    // from partner's POV
        needsConfirmation: true,
      }).catch(() => { /* non-blocking */ });
    }

    res.json({ success: true, data: settlement });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

/**
 * POST /api/exchange/settlements/:id/confirm
 */
export const confirmSettlement = async (req: Request, res: Response): Promise<void> => {
  try {
    const myStoreId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;

    const s = await prisma.settlement.findUnique({ where: { id } });
    if (!s) { res.status(404).json({ success: false, error: 'Settlement not found.' }); return; }
    if (s.storeAId !== myStoreId && s.storeBId !== myStoreId) {
      res.status(403).json({ success: false, error: 'Not your settlement.' });
      return;
    }
    if (s.recordedById === userId) {
      res.status(400).json({ success: false, error: 'The other party must confirm — you recorded this.' });
      return;
    }
    if (s.status !== 'pending') {
      res.status(400).json({ success: false, error: `Already ${s.status}.` });
      return;
    }

    const amt = Number(s.amount);
    const payerIsA = s.payerStoreId === s.storeAId;
    const direction = payerIsA ? 'B_OWES_A' : 'A_OWES_B';
    const delta     = payerIsA ? amt : -amt;

    const updated = await prisma.$transaction(async (tx: TxClient) => {
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
          createdById: userId as string,
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
        amount: amt, method: s.method, methodRef: s.methodRef || undefined,
      }).catch(() => { /* non-blocking */ });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

/** GET /api/exchange/settlements?partnerStoreId=... */
export const listSettlements = async (req: Request, res: Response): Promise<void> => {
  try {
    const myStoreId = getStoreId(req);
    const partnerStoreId = req.query.partnerStoreId as string | undefined;
    if (!myStoreId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }

    const where: Prisma.SettlementWhereInput = {};
    if (partnerStoreId) {
      const { storeAId, storeBId } = canonPair(myStoreId, partnerStoreId);
      where.storeAId = storeAId;
      where.storeBId = storeBId;
    } else {
      where.OR = [{ storeAId: myStoreId }, { storeBId: myStoreId }];
    }

    const rows = await prisma.settlement.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take: 200,
    });

    type SettlementRow = (typeof rows)[number];

    // Annotate from my perspective + flag whose turn it is to act
    const userId = req.user?.id;
    const annotated = rows.map((s: SettlementRow) => ({
      ...s,
      paidByMe: s.payerStoreId === myStoreId,
      recordedByMe: s.recordedById === userId,
      needsMyConfirmation: s.status === 'pending' && s.recordedById !== userId,
    }));

    res.json({ success: true, data: annotated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

/** POST /api/exchange/settlements/:id/dispute  body { reason } */
export const disputeSettlement = async (req: Request, res: Response): Promise<void> => {
  try {
    const myStoreId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;
    const reason = (req.body as { reason?: string })?.reason;
    if (!reason) { res.status(400).json({ success: false, error: 'reason required' }); return; }

    const s = await prisma.settlement.findUnique({ where: { id } });
    if (!s) { res.status(404).json({ success: false, error: 'Settlement not found.' }); return; }
    if (s.storeAId !== myStoreId && s.storeBId !== myStoreId) {
      res.status(403).json({ success: false, error: 'Not your settlement.' });
      return;
    }
    // Multi-round dispute loop: only 'accepted' is terminal.
    if (s.status === 'accepted') {
      res.status(400).json({ success: false, error: 'Settlement already accepted. Ask the other party to re-open if you want to dispute.' });
      return;
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
      }).catch(() => { /* non-blocking */ });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

/** POST /api/exchange/settlements/:id/resolve  → mark a disputed settlement resolved */
export const resolveSettlement = async (req: Request, res: Response): Promise<void> => {
  try {
    const myStoreId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;

    const s = await prisma.settlement.findUnique({ where: { id } });
    if (!s) { res.status(404).json({ success: false, error: 'Settlement not found.' }); return; }
    if (s.storeAId !== myStoreId && s.storeBId !== myStoreId) {
      res.status(403).json({ success: false, error: 'Not your settlement.' });
      return;
    }
    if (s.status !== 'disputed') {
      res.status(400).json({ success: false, error: `Not disputed (status: ${s.status})` });
      return;
    }
    const updated = await prisma.settlement.update({
      where: { id },
      data: { status: 'accepted', resolvedAt: new Date(), resolvedById: userId },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ═══════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════

/** GET /api/exchange/report  ?dateFrom&dateTo&partnerStoreId&type=all|credits|debits */
export const exchangeReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const { dateFrom, dateTo, partnerStoreId, type = 'all' } = req.query as {
      dateFrom?: string;
      dateTo?: string;
      partnerStoreId?: string;
      type?: string;
    };

    const where: Prisma.WholesaleOrderWhereInput = {
      OR: [{ senderStoreId: storeId }, { receiverStoreId: storeId }],
      status: { in: ['confirmed', 'partially_confirmed'] },
    };
    const dateFilter: Prisma.DateTimeNullableFilter = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom + 'T00:00:00');
    if (dateTo)   dateFilter.lte = new Date(dateTo + 'T23:59:59.999');
    if (Object.keys(dateFilter).length) where.confirmedAt = dateFilter;
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

    type OrderRow = (typeof orders)[number];

    let totalOutgoing = 0, totalIncoming = 0;
    const rows = orders.map((o: OrderRow) => {
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

    type ReportRow = (typeof rows)[number];

    let filtered = rows;
    if (type === 'credits') filtered = rows.filter((r: ReportRow) => r.direction === 'outgoing');
    if (type === 'debits')  filtered = rows.filter((r: ReportRow) => r.direction === 'incoming');

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
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};
