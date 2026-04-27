/**
 * Shift Controller — Cash drawer open/close management
 *
 * Routes:
 *   GET  /api/pos-terminal/shift/active        → getActiveShift
 *   POST /api/pos-terminal/shift/open          → openShift
 *   POST /api/pos-terminal/shift/:id/close     → closeShift
 *   POST /api/pos-terminal/shift/:id/drop      → addCashDrop
 *   POST /api/pos-terminal/shift/:id/payout    → addPayout
 *   GET  /api/pos-terminal/shift/:id/report    → getShiftReport
 *   GET  /api/pos-terminal/shifts              → listShifts
 *   GET  /api/pos-terminal/payouts             → listPayouts
 *   GET  /api/pos-terminal/cash-drops          → listCashDrops
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { nanoid } from 'nanoid';
import { reconcileShift } from '../services/reconciliation/shift/index.js';

const getOrgId = (req: Request): string | null | undefined =>
  req.orgId || req.user?.orgId;

interface TenderLine {
  method?: string | null;
  amount?: number | string | null;
}

// ── GET /shift/active ─────────────────────────────────────────────────────
export const getActiveShift = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const q = req.query as { storeId?: string };
    const { storeId } = q;

    const shift = await prisma.shift.findFirst({
      where:   { orgId: orgId ?? undefined, storeId, status: 'open' },
      include: { drops: { orderBy: { createdAt: 'asc' } }, payouts: { orderBy: { createdAt: 'asc' } } },
      orderBy: { openedAt: 'desc' },
    });

    if (!shift) { res.json({ shift: null }); return; }

    // Resolve cashier name
    const cashier = await prisma.user.findUnique({ where: { id: shift.cashierId }, select: { name: true } });

    type DropRow = (typeof shift.drops)[number];
    type PayoutRow = (typeof shift.payouts)[number];
    res.json({
      shift: {
        ...shift,
        cashierName:   cashier?.name || 'Unknown',
        openingAmount: Number(shift.openingAmount),
        drops:   shift.drops.map((d: DropRow) => ({ ...d, amount: Number(d.amount) })),
        payouts: shift.payouts.map((p: PayoutRow) => ({ ...p, amount: Number(p.amount) })),
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── POST /shift/open ──────────────────────────────────────────────────────
export const openShift = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as {
      storeId?: string;
      stationId?: string | null;
      openingAmount?: number | string;
      openingDenominations?: unknown;
      openingNote?: string | null;
      cashierId?: string;
    };
    const { storeId, stationId, openingAmount, openingDenominations, openingNote, cashierId } = body;

    if (!storeId)             { res.status(400).json({ error: 'storeId required' }); return; }
    if (openingAmount == null) { res.status(400).json({ error: 'openingAmount required' }); return; }

    // Guard: only one open shift per store at a time
    const existing = await prisma.shift.findFirst({ where: { orgId: orgId ?? undefined, storeId, status: 'open' } });
    if (existing) {
      res.status(409).json({
        error: 'A shift is already open for this store',
        shiftId: existing.id,
        openedAt: existing.openedAt,
      });
      return;
    }

    // Back-office open-on-behalf: manager can supply a specific cashierId.
    // Validate that user belongs to this org. Defaults to the caller (the
    // cashier themselves when called from cashier-app).
    let effectiveCashierId = req.user!.id;
    if (cashierId && cashierId !== req.user?.id) {
      const target = await prisma.user.findFirst({ where: { id: cashierId, orgId: orgId ?? undefined } });
      if (!target) { res.status(400).json({ error: 'Invalid cashierId' }); return; }
      effectiveCashierId = target.id;
    }

    const shift = await prisma.shift.create({
      data: {
        id:                   nanoid(),
        orgId:                orgId as string,
        storeId,
        stationId:            stationId || null,
        cashierId:            effectiveCashierId,
        openingAmount:        parseFloat(String(openingAmount)),
        openingDenominations: (openingDenominations || null) as Prisma.InputJsonValue | null,
        openingNote:          openingNote || null,
        status:               'open',
      },
    });

    res.status(201).json({ ...shift, openingAmount: Number(shift.openingAmount) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── POST /shift/:id/close ─────────────────────────────────────────────────
export const closeShift = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id }  = req.params;
    const body = (req.body || {}) as {
      closingAmount?: number | string;
      closingDenominations?: unknown;
      closingNote?: string | null;
    };
    const { closingAmount, closingDenominations, closingNote } = body;

    if (closingAmount == null) { res.status(400).json({ error: 'closingAmount required' }); return; }

    const shift = await prisma.shift.findFirst({
      where:   { id, orgId: orgId ?? undefined },
      include: { drops: true, payouts: true },
    });
    if (!shift)              { res.status(404).json({ error: 'Shift not found' }); return; }
    if (shift.status !== 'open') { res.status(400).json({ error: 'Shift is already closed' }); return; }

    // ── Single source of truth: reconcileShift() ──
    // Replaces the prior inline math (cashSales / cashRefunds / drops /
    // payouts / expectedAmount). The service ALSO includes lottery cash
    // flow (un-rung instant tickets, machine draw sales, machine + instant
    // cashings) that the inline version was missing.
    //
    // `windowEnd: new Date()` because we're reconciling AT the moment of
    // close, before we've persisted closedAt — the service would otherwise
    // see closedAt=null and re-derive `now` itself, which is the same
    // value, but being explicit makes intent obvious in the diff.
    const closedAtMoment = new Date();
    const recon = await reconcileShift({
      shiftId: id,
      closingAmount: parseFloat(String(closingAmount)),
      windowEnd: closedAtMoment,
    });

    const closed = await prisma.shift.update({
      where: { id },
      data: {
        status:               'closed',
        closedAt:             closedAtMoment,
        closedById:           req.user!.id,
        closingAmount:        parseFloat(String(closingAmount)),
        closingDenominations: (closingDenominations || null) as Prisma.InputJsonValue | null,
        closingNote:          closingNote || null,
        expectedAmount:       recon.expectedDrawer,
        variance:             recon.variance ?? 0,
        cashSales:            recon.cashSales,
        cashRefunds:          recon.cashRefunds,
        cashDropsTotal:       recon.cashDropsTotal,
        // payoutsTotal kept for back-compat with existing UIs that read it;
        // we store cashOut (drawer-out total) since that's the meaningful
        // number for variance calc. cashIn is captured in lotteryReconciliation
        // alongside the rest of the breakdown.
        payoutsTotal:         recon.cashOut,
        lotteryReconciliation: (recon.lottery as unknown) as Prisma.InputJsonValue,
      },
    });

    // ── Guarantee close_day_snapshot trail (Item 5 / Session 44b) ─────
    // Without this, stores that don't run the EoD wizard end up with an
    // empty snapshot trail → ticket-math reports return $0 for every
    // day. We auto-write a snapshot per active box using the box's live
    // currentTicket so reports always have data. This is idempotent —
    // if the EoD wizard already wrote a snapshot for this box today,
    // we skip (the wizard's scan-derived end ticket is more accurate).
    //
    // Fire-and-forget: a snapshot insert failure must not block the
    // shift-close response.
    try {
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd   = new Date(); dayEnd.setUTCHours(23, 59, 59, 999);
      const activeBoxes = await prisma.lotteryBox.findMany({
        where: { orgId: orgId ?? undefined, storeId: shift.storeId, status: 'active' },
        select: {
          id: true, boxNumber: true, currentTicket: true,
          game: { select: { id: true, name: true, gameNumber: true, ticketPrice: true } },
        },
      });
      type ActiveBoxRow = (typeof activeBoxes)[number];
      if (activeBoxes.length) {
        // Find which boxes ALREADY have a snapshot today (skip those —
        // the EoD wizard wrote them with scan-derived numbers).
        const todaySnapshots = await prisma.lotteryScanEvent.findMany({
          where: {
            orgId: orgId ?? undefined, storeId: shift.storeId,
            action: 'close_day_snapshot',
            createdAt: { gte: dayStart, lte: dayEnd },
            boxId: { in: activeBoxes.map((b: ActiveBoxRow) => b.id) },
          },
          select: { boxId: true },
        });
        type SnapRow = (typeof todaySnapshots)[number];
        const haveSnapshot = new Set(todaySnapshots.map((s: SnapRow) => s.boxId));

        for (const b of activeBoxes as ActiveBoxRow[]) {
          if (haveSnapshot.has(b.id)) continue;
          await prisma.lotteryScanEvent.create({
            data: {
              orgId: orgId as string,
              storeId:   shift.storeId,
              boxId:     b.id,
              scannedBy: req.user?.id || null,
              raw:       `shift_close:${id}:auto`,
              parsed: {
                gameNumber:    b.game?.gameNumber ?? null,
                gameName:      b.game?.name       ?? null,
                currentTicket: b.currentTicket    ?? null,
                ticketsSold:   null,   // unknown without scan; reports use deltas
                source:        'auto-on-close',
              } as Prisma.InputJsonValue,
              action:  'close_day_snapshot',
              context: 'eod',
            },
          }).catch((e: Error) => console.warn('[closeShift] auto-snapshot insert failed', b.id, e.message));
        }
      }
    } catch (snapErr) {
      console.warn('[closeShift] snapshot guarantee failed:', (snapErr as Error).message);
    }

    // Count transactions in the shift window for the response (used by the
    // "X transactions" hint shown in the shift report). Same query as the
    // reconciliation service uses internally — duplicated here only for
    // count, not for any math.
    const completeTxCount = await prisma.transaction.count({
      where: {
        orgId: orgId ?? undefined,
        storeId: shift.storeId,
        createdAt: { gte: shift.openedAt, lte: closedAtMoment },
        status: 'complete',
      },
    });

    res.json({
      ...closed,
      openingAmount:  Number(closed.openingAmount),
      closingAmount:  Number(closed.closingAmount),
      expectedAmount: Number(closed.expectedAmount),
      variance:       Number(closed.variance),
      // Surface the same fields the old response had for back-compat
      cashSales:      recon.cashSales,
      cashRefunds:    recon.cashRefunds,
      cashDropsTotal: recon.cashDropsTotal,
      payoutsTotal:   recon.cashPayoutsTotal,
      transactionCount: completeTxCount,
      // NEW — full reconciliation, including the lottery breakdown and
      // pre-rendered line-items the UI can render directly.
      reconciliation: recon,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── POST /shift/:id/drop ─────────────────────────────────────────────────
export const addCashDrop = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id }           = req.params;
    const body = (req.body || {}) as { amount?: number | string; note?: string | null };
    const { amount, note } = body;

    if (!amount || parseFloat(String(amount)) <= 0) { res.status(400).json({ error: 'amount must be > 0' }); return; }

    const shift = await prisma.shift.findFirst({ where: { id, orgId: orgId ?? undefined, status: 'open' } });
    if (!shift) { res.status(404).json({ error: 'Active shift not found' }); return; }

    const drop = await prisma.cashDrop.create({
      data: {
        id:          nanoid(),
        orgId:       orgId as string,
        shiftId:     id,
        amount:      parseFloat(String(amount)),
        note:        note || null,
        createdById: req.user!.id,
      },
    });

    res.status(201).json({ ...drop, amount: Number(drop.amount) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── POST /shift/:id/payout ────────────────────────────────────────────────
export const addPayout = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const body = (req.body || {}) as {
      amount?: number | string;
      recipient?: string | null;
      note?: string | null;
      vendorId?: number | string | null;
      payoutType?: string | null;
    };
    const { amount, recipient, note, vendorId, payoutType } = body;

    if (!amount || parseFloat(String(amount)) <= 0) { res.status(400).json({ error: 'amount must be > 0' }); return; }

    const shift = await prisma.shift.findFirst({ where: { id, orgId: orgId ?? undefined, status: 'open' } });
    if (!shift) { res.status(404).json({ error: 'Active shift not found' }); return; }

    const payout = await prisma.cashPayout.create({
      data: {
        id:          nanoid(),
        orgId:       orgId as string,
        shiftId:     id,
        amount:      parseFloat(String(amount)),
        recipient:   recipient || null,
        vendorId:    vendorId ? parseInt(String(vendorId)) : null,
        payoutType:  payoutType || null,
        note:        note || null,
        createdById: req.user!.id,
      },
    });

    res.status(201).json({ ...payout, amount: Number(payout.amount) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── GET /shift/:id/report ────────────────────────────────────────────────
export const getShiftReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id }  = req.params;

    const shift = await prisma.shift.findFirst({
      where:   { id, orgId: orgId ?? undefined },
      include: { drops: { orderBy: { createdAt: 'asc' } }, payouts: { orderBy: { createdAt: 'asc' } } },
    });
    if (!shift) { res.status(404).json({ error: 'Shift not found' }); return; }

    const [cashier, closer] = await Promise.all([
      prisma.user.findUnique({ where: { id: shift.cashierId }, select: { name: true } }),
      shift.closedById ? prisma.user.findUnique({ where: { id: shift.closedById }, select: { name: true } }) : null,
    ]);

    interface UserRow { id: string; name: string }
    interface CreatedItem { createdById: string | null }
    const resolveUsers = async (items: CreatedItem[]): Promise<Record<string, string>> => {
      const ids = [...new Set(items.map((i) => i.createdById).filter((x): x is string => Boolean(x)))];
      if (!ids.length) return {};
      const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      return Object.fromEntries(users.map((u: UserRow) => [u.id, u.name]));
    };

    const userMap = await resolveUsers([...shift.drops, ...shift.payouts] as unknown as CreatedItem[]);
    type ShiftReportDrop = (typeof shift.drops)[number];
    type ShiftReportPayout = (typeof shift.payouts)[number];

    // Surface the unified reconciliation (line-items + lottery breakdown)
    // alongside the legacy summary fields. The cashier-app re-views past
    // shifts via this endpoint after close — without `reconciliation`, the
    // lottery cash-flow rows wouldn't appear when viewing yesterday's shift.
    //
    // For closed shifts: reconcileShift is called with the persisted
    //   closingAmount → variance recomputes against current data. If
    //   nothing has drifted (the typical case) the variance will match
    //   what's persisted on the row.
    // For open shifts: closingAmount is null → variance comes back null
    //   (preview mode), expectedDrawer is live.
    let reconciliation = null;
    try {
      reconciliation = await reconcileShift({
        shiftId: shift.id,
        closingAmount: shift.closingAmount != null ? Number(shift.closingAmount) : null,
        windowEnd: shift.closedAt ?? new Date(),
      });
    } catch (e) {
      // Non-fatal — the legacy summary fields are still returned.
      console.warn('[getShiftReport] reconcileShift failed:', (e as Error).message);
    }

    res.json({
      ...shift,
      cashierName:    cashier?.name  || 'Unknown',
      closedByName:   closer?.name   || null,
      openingAmount:  Number(shift.openingAmount),
      closingAmount:  shift.closingAmount  ? Number(shift.closingAmount)  : null,
      expectedAmount: shift.expectedAmount ? Number(shift.expectedAmount) : null,
      variance:       shift.variance       ? Number(shift.variance)       : null,
      cashSales:      shift.cashSales      ? Number(shift.cashSales)      : null,
      cashRefunds:    shift.cashRefunds    ? Number(shift.cashRefunds)    : null,
      cashDropsTotal: shift.cashDropsTotal ? Number(shift.cashDropsTotal) : null,
      payoutsTotal:   shift.payoutsTotal   ? Number(shift.payoutsTotal)   : null,
      drops:   shift.drops.map((d: ShiftReportDrop) => ({ ...d, amount: Number(d.amount), createdByName: userMap[d.createdById] || '' })),
      payouts: shift.payouts.map((p: ShiftReportPayout) => ({ ...p, amount: Number(p.amount), createdByName: userMap[p.createdById] || '' })),
      reconciliation,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── GET /shifts ───────────────────────────────────────────────────────────
interface ShiftSalesAgg {
  totalSales: number;
  totalTax: number;
  cashAmount: number;
  cardAmount: number;
  ebtAmount: number;
  otherAmount: number;
  txCount: number;
}

export const listShifts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as {
      storeId?: string;
      dateFrom?: string;
      dateTo?: string;
      status?: string;
      limit?: string;
    };
    const { storeId, dateFrom, dateTo, status } = q;
    const limit = q.limit || '30';

    const where: Prisma.ShiftWhereInput = { orgId: orgId ?? undefined };
    if (storeId) where.storeId = storeId;
    if (status)  where.status  = status;
    if (dateFrom || dateTo) {
      const range: Prisma.DateTimeFilter = {};
      if (dateFrom) { const d = new Date(dateFrom); range.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
      if (dateTo)   { const d = new Date(dateTo);   range.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
      where.openedAt = range;
    }

    const shifts = await prisma.shift.findMany({
      where,
      orderBy:  { openedAt: 'desc' },
      take:     Math.min(parseInt(limit) || 30, 200),
      include:  { drops: { select: { amount: true } }, payouts: { select: { amount: true } } },
    });
    type ShiftRow = (typeof shifts)[number];

    const cashierIds = [...new Set(shifts.map((s: ShiftRow) => s.cashierId).filter(Boolean))];
    const stationIds = [...new Set(shifts.map((s: ShiftRow) => s.stationId).filter((x: string | null) => Boolean(x)) as string[])];
    const [users, stations] = await Promise.all([
      cashierIds.length ? prisma.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, name: true } }) : [],
      stationIds.length ? prisma.station.findMany({ where: { id: { in: stationIds } }, select: { id: true, name: true } }) : [],
    ]);
    interface UserRow { id: string; name: string }
    interface StationRow { id: string; name: string }
    const userMap = Object.fromEntries(users.map((u: UserRow) => [u.id, u.name]));
    const stationMap = Object.fromEntries((stations as StationRow[]).map((s) => [s.id, s.name]));

    // Fetch transactions for the same period to compute tender breakdown per shift
    const txWhere: Prisma.TransactionWhereInput = { orgId: orgId ?? undefined, status: 'complete' };
    if (storeId) txWhere.storeId = storeId;
    if (dateFrom || dateTo) {
      const range: Prisma.DateTimeFilter = {};
      if (dateFrom) { const d = new Date(dateFrom); range.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
      if (dateTo)   { const d = new Date(dateTo);   range.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
      txWhere.createdAt = range;
    }

    const transactions = await prisma.transaction.findMany({
      where: txWhere,
      select: { grandTotal: true, taxTotal: true, tenderLines: true, stationId: true, createdAt: true },
    });

    // Build per-shift sales summary
    const shiftSalesMap: Record<string, ShiftSalesAgg> = {};
    for (const s of shifts as ShiftRow[]) {
      const openT = new Date(s.openedAt).getTime();
      const closeT = s.closedAt ? new Date(s.closedAt).getTime() : Date.now();
      const key = s.id;
      shiftSalesMap[key] = { totalSales: 0, totalTax: 0, cashAmount: 0, cardAmount: 0, ebtAmount: 0, otherAmount: 0, txCount: 0 };

      for (const tx of transactions) {
        const txTime = new Date(tx.createdAt).getTime();
        const matchStation = !s.stationId || !tx.stationId || s.stationId === tx.stationId;
        if (txTime >= openT && txTime <= closeT && matchStation) {
          const sm = shiftSalesMap[key];
          sm.totalSales += Number(tx.grandTotal) || 0;
          sm.totalTax += Number(tx.taxTotal) || 0;
          sm.txCount += 1;
          const tenders: TenderLine[] = Array.isArray(tx.tenderLines) ? (tx.tenderLines as unknown as TenderLine[]) : [];
          for (const t of tenders) {
            const amt = Number(t.amount) || 0;
            const m = String(t.method || '').toLowerCase();
            if (m === 'cash') sm.cashAmount += amt;
            else if (['card', 'credit', 'debit'].includes(m)) sm.cardAmount += amt;
            else if (m === 'ebt') sm.ebtAmount += amt;
            else sm.otherAmount += amt;
          }
        }
      }
    }

    const r2 = (n: number): number => Math.round(n * 100) / 100;

    res.json({
      shifts: (shifts as ShiftRow[]).map((s) => {
        const sales = shiftSalesMap[s.id] || ({} as Partial<ShiftSalesAgg>);
        return {
          ...s,
          cashierName:    userMap[s.cashierId] || 'Unknown',
          stationName:    (s.stationId ? stationMap[s.stationId] : null) || s.stationId || 'Unassigned',
          openingAmount:  Number(s.openingAmount),
          closingAmount:  s.closingAmount  ? Number(s.closingAmount)  : null,
          expectedAmount: s.expectedAmount ? Number(s.expectedAmount) : null,
          variance:       s.variance       ? Number(s.variance)       : null,
          cashSales:      s.cashSales ? Number(s.cashSales) : r2(sales.cashAmount || 0),
          cashRefunds:    s.cashRefunds ? Number(s.cashRefunds) : 0,
          dropsCount:     s.drops.length,
          payoutsCount:   s.payouts.length,
          cashDropsTotal: s.cashDropsTotal ? Number(s.cashDropsTotal) : r2(s.drops.reduce((sum: number, d: { amount: unknown }) => sum + Number(d.amount), 0)),
          payoutsTotal:   s.payoutsTotal ? Number(s.payoutsTotal) : r2(s.payouts.reduce((sum: number, p: { amount: unknown }) => sum + Number(p.amount), 0)),
          // Tender breakdown
          salesSummary: {
            totalSales: r2(sales.totalSales || 0),
            totalTax:   r2(sales.totalTax || 0),
            txCount:    sales.txCount || 0,
            cash:       r2(sales.cashAmount || 0),
            card:       r2(sales.cardAmount || 0),
            ebt:        r2(sales.ebtAmount || 0),
            other:      r2(sales.otherAmount || 0),
          },
          drops:   undefined,
          payouts: undefined,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── GET /payouts ──────────────────────────────────────────────────────────────
// List all payouts across shifts for back-office reporting
export const listPayouts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as {
      storeId?: string;
      dateFrom?: string;
      dateTo?: string;
      payoutType?: string;
      vendorId?: string;
      limit?: string;
    };
    const { storeId, dateFrom, dateTo, payoutType, vendorId } = q;
    const limit = q.limit || '100';

    const where: Prisma.CashPayoutWhereInput = { orgId: orgId ?? undefined };
    // CashPayout has no direct storeId column — scope via the parent Shift
    if (storeId)    where.shift      = { storeId };
    if (payoutType) where.payoutType = payoutType;
    if (vendorId)   where.vendorId   = parseInt(vendorId);
    if (dateFrom || dateTo) {
      const range: Prisma.DateTimeFilter = {};
      if (dateFrom) { const d = new Date(dateFrom); range.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
      if (dateTo)   { const d = new Date(dateTo);   range.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
      where.createdAt = range;
    }

    const payouts = await prisma.cashPayout.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit) || 100, 500),
      include: { shift: { select: { storeId: true } } },
    });
    type PayoutRow = (typeof payouts)[number];

    // Resolve cashier names
    const userIds = [...new Set(payouts.map((p: PayoutRow) => p.createdById).filter((x: string | null) => Boolean(x)) as string[])];
    interface UserRow { id: string; name: string }
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const userMap = Object.fromEntries(users.map((u: UserRow) => [u.id, u.name]));

    // Bug B4 fix: summary treats ONLY cash payouts (which are real expenses
    // out of the drawer) as expenses. Cash drops (register pickups) are a
    // separate movement — they do NOT count as expenses and are shown in
    // their own endpoint (/cash-drops). The EoD report presents both
    // separately.
    const totalExpense     = (payouts as PayoutRow[]).filter((p) => p.payoutType !== 'merchandise').reduce((s, p) => s + Number(p.amount), 0);
    const totalMerchandise = (payouts as PayoutRow[]).filter((p) => p.payoutType === 'merchandise').reduce((s, p) => s + Number(p.amount), 0);

    res.json({
      payouts: (payouts as PayoutRow[]).map((p) => ({
        ...p,
        amount:       Number(p.amount),
        cashierName:  userMap[p.createdById] || '',
        storeId:      p.shift?.storeId || storeId,
        shift:        undefined,
      })),
      summary: {
        total:            totalExpense + totalMerchandise,
        totalExpense,
        totalMerchandise,
        count:            payouts.length,
        // Explicit clarification: cash drops are NOT included here
        note: 'Summary includes only cash payouts (expenses + merchandise). Cash drops/pickups are separate — see /cash-drops.',
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── GET /cash-drops ───────────────────────────────────────────────────────────
export const listCashDrops = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as {
      storeId?: string;
      dateFrom?: string;
      dateTo?: string;
      limit?: string;
    };
    const { storeId, dateFrom, dateTo } = q;
    const limit = q.limit || '100';

    const where: Prisma.CashDropWhereInput = { orgId: orgId ?? undefined };
    // CashDrop has no direct storeId column — scope via the parent Shift
    if (storeId) where.shift = { storeId };
    if (dateFrom || dateTo) {
      const range: Prisma.DateTimeFilter = {};
      if (dateFrom) { const d = new Date(dateFrom); range.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
      if (dateTo)   { const d = new Date(dateTo);   range.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
      where.createdAt = range;
    }

    const drops = await prisma.cashDrop.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit) || 100, 500),
    });
    type DropRow = (typeof drops)[number];

    const userIds = [...new Set(drops.map((d: DropRow) => d.createdById).filter((x: string | null) => Boolean(x)) as string[])];
    interface UserRow { id: string; name: string }
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const userMap = Object.fromEntries(users.map((u: UserRow) => [u.id, u.name]));

    res.json({
      drops: (drops as DropRow[]).map((d) => ({ ...d, amount: Number(d.amount), cashierName: userMap[d.createdById] || '' })),
      summary: { total: (drops as DropRow[]).reduce((s, d) => s + Number(d.amount), 0), count: drops.length },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── PUT /api/pos-terminal/shift/:id/balance — Back-office cash adjustment ────
// Allows managers to edit the closing cash amount after a shift is closed.
// Recalculates variance. Only works on closed shifts.
export const updateShiftBalance = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const body = (req.body || {}) as { closingAmount?: number | string; closingNote?: string | null };
    const { closingAmount, closingNote } = body;

    if (closingAmount == null) { res.status(400).json({ error: 'closingAmount is required' }); return; }

    const shift = await prisma.shift.findFirst({ where: { id, orgId: orgId ?? undefined } });
    if (!shift) { res.status(404).json({ error: 'Shift not found' }); return; }
    if (shift.status !== 'closed') { res.status(400).json({ error: 'Can only adjust closed shifts' }); return; }

    const newClosing = parseFloat(String(closingAmount));
    const expected = shift.expectedAmount ? Number(shift.expectedAmount) : 0;
    const newVariance = Math.round((newClosing - expected) * 10000) / 10000;

    const updated = await prisma.shift.update({
      where: { id },
      data: {
        closingAmount: newClosing,
        variance: newVariance,
        ...(closingNote !== undefined ? { closingNote } : {}),
      },
    });

    res.json({
      success: true,
      shift: {
        ...updated,
        openingAmount:  Number(updated.openingAmount),
        closingAmount:  Number(updated.closingAmount),
        expectedAmount: updated.expectedAmount ? Number(updated.expectedAmount) : null,
        variance:       Number(updated.variance),
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};
