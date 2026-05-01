/**
 * Shift lifecycle — the cash-drawer state machine.
 *
 * Handlers:
 *   getActiveShift      GET  /pos-terminal/shift/active   — currently-open shift for store
 *   openShift           POST /pos-terminal/shift/open     — start a new shift
 *   closeShift          POST /pos-terminal/shift/:id/close — reconcile + close
 *   updateShiftBalance  PUT  /pos-terminal/shift/:id/balance — back-office cash adjustment
 *
 * `closeShift` is the heaviest — it delegates the cash-flow math to
 * `services/reconciliation/shift` (single source of truth for drawer
 * expectation incl. lottery cash flow) and then writes a `close_day_snapshot`
 * audit trail per active lottery box so reporting always has data.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { nanoid } from 'nanoid';
import { reconcileShift } from '../../services/reconciliation/shift/index.js';

import { getOrgId } from './helpers.js';

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

    // ── B4 (Session 62) — shift-boundary lottery snapshots ────────────
    // Capture each active box's `currentTicket` at the moment this shift
    // opens. Pairs with the close_day_snapshot the closeShift handler
    // writes at end of shift to bracket the shift's lottery activity.
    //
    // Without this, multi-cashier days attribute the WHOLE day's lottery
    // delta to whichever cashier was on at end-of-day (because windowSales
    // walks day-by-day and snapshotSales only finds end-of-day snapshots).
    // The boundary event is the missing "starting position" reference for
    // the shift's `shiftSales` calc.
    //
    // Trustingly uses `box.currentTicket` (no cashier prompt) — the EoD
    // wizard already prompts the cashier at close. Fire-and-forget: a
    // snapshot insert failure must not block the shift-open response.
    try {
      const settings = await prisma.lotterySettings.findUnique({
        where: { storeId },
        select: { enabled: true },
      });
      if (settings?.enabled) {
        const activeBoxes = await prisma.lotteryBox.findMany({
          where: { orgId: orgId ?? undefined, storeId, status: 'active' },
          select: {
            id: true, currentTicket: true,
            game: { select: { id: true, name: true, gameNumber: true } },
          },
        });
        for (const b of activeBoxes) {
          await prisma.lotteryScanEvent.create({
            data: {
              orgId:     orgId as string,
              storeId,
              boxId:     b.id,
              scannedBy: effectiveCashierId,
              raw:       `shift_open:${shift.id}:auto`,
              parsed: {
                gameNumber:    b.game?.gameNumber ?? null,
                gameName:      b.game?.name       ?? null,
                currentTicket: b.currentTicket    ?? null,
                shiftId:       shift.id,
                source:        'auto-on-open',
              } as Prisma.InputJsonValue,
              action:  'shift_boundary',
              context: 'shift',
            },
          }).catch((e: Error) => console.warn('[openShift] boundary insert failed', b.id, e.message));
        }
      }
    } catch (boundaryErr) {
      console.warn('[openShift] boundary capture failed:', (boundaryErr as Error).message);
    }

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
