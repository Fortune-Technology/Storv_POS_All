/**
 * Lottery — Weekly Settlement (Phase 2).
 * Split from `lotteryController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (5):
 *   - listLotterySettlements      GET    /lottery/settlements
 *                                  (history list with sales/payouts/commission)
 *   - getLotterySettlement        GET    /lottery/settlements/:id
 *                                  (full breakdown for one settlement window)
 *   - upsertLotterySettlement     PUT    /lottery/settlements
 *                                  (snapshot + edit for one weekStart date)
 *   - finalizeLotterySettlement   POST   /lottery/settlements/:id/finalize
 *                                  (lock + write SnapshotCoverage badge data)
 *   - markLotterySettlementPaid   POST   /lottery/settlements/:id/mark-paid
 *                                  (record commission payment from state)
 *
 * Settlement engine (`_computeSettlement`) reads close_day_snapshot deltas
 * across the per-week window — `instantSales` is the per-week sum of
 * |yesterday_close - today_close| × ticketPrice across every active book.
 * The `snapshotCoverage` field flags when the engine was missing snapshots
 * for some days in the window (S79e — green/amber/red chip in the UI).
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { errMsg } from '../../utils/typeHelpers.js';
import {
  weekRangeFor as _weekRangeFor,
  computeSettlement as _computeSettlement,
  getAdapter as _getAdapter,
} from '../../services/lottery/index.js';
import { getOrgId, getStore, parseDate } from './helpers.js';

// WEEKLY SETTLEMENT (Phase 2)
// ══════════════════════════════════════════════════════════════════════════

interface SettlementParams {
  stateCode: string | null;
  weekStartDay: number;
  commissionRate: number;
}

/**
 * Resolve the settlement parameters for the active store.
 * Precedence for weekStartDay / settlement rules:
 *   1. LotterySettings override fields (manager set these to override state)
 *   2. State adapter defaults
 *   3. Sunday start / null rules
 */
async function _settlementParams(_orgId: string, storeId: string): Promise<SettlementParams> {
  const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
  const adapter = _getAdapter(settings?.state ?? null);
  const weekStartDay = settings?.weekStartDay ?? adapter?.weekStartDay ?? 0;
  return {
    stateCode: settings?.state || null,
    weekStartDay,
    commissionRate: Number(settings?.commissionRate || 0),
  };
}

/**
 * GET /api/lottery/settlements?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Lists settlement rows in the date window. Rows that don't yet exist in
 * the DB are computed on the fly and returned as 'draft' (not persisted).
 */
export const listLotterySettlements = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const { stateCode, weekStartDay, commissionRate } = await _settlementParams(orgId, storeId);

    const toDate = req.query.to ? new Date((req.query.to as string) + 'T23:59:59Z') : new Date();
    const fromDate = req.query.from
      ? new Date((req.query.from as string) + 'T00:00:00Z')
      : (() => {
          const d = new Date(toDate);
          d.setUTCMonth(d.getUTCMonth() - 3);
          return d;
        })();

    // Build ordered list of week ranges in the window
    interface WeekEntry {
      start: Date;
      end: Date;
      due: Date;
    }
    const weeks: WeekEntry[] = [];
    const { start: firstStart } = _weekRangeFor(toDate, weekStartDay);
    let cursor = new Date(firstStart);
    while (cursor >= fromDate) {
      const { start, end, due } = _weekRangeFor(cursor, weekStartDay);
      weeks.push({ start, end, due });
      cursor = new Date(start);
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    // Fetch any persisted rows for the window
    type SettlementRow = {
      id: string;
      weekStart: Date;
      [k: string]: unknown;
    };
    const persisted = (await prisma.lotteryWeeklySettlement.findMany({
      where: {
        orgId,
        storeId,
        weekStart: { in: weeks.map((w) => w.start) },
      },
    })) as SettlementRow[];
    const byStart = new Map<string, SettlementRow>(
      persisted.map((r) => [r.weekStart.toISOString().slice(0, 10), r]),
    );

    // Merge — persisted rows win, otherwise compute lightweight preview
    const results = await Promise.all(
      weeks.map(async (w) => {
        const key = w.start.toISOString().slice(0, 10);
        const existing = byStart.get(key);
        if (existing) return existing;
        // Lightweight preview — just totals, no book-ids arrays
        const snapshot = await _computeSettlement({
          orgId,
          storeId,
          weekStart: w.start,
          weekEnd: w.end,
          stateCode: stateCode as Parameters<typeof _computeSettlement>[0]['stateCode'],
          commissionRate,
        }).catch(() => null);
        return {
          id: null,
          orgId,
          storeId,
          weekStart: w.start,
          weekEnd: w.end,
          dueDate: w.due,
          ...snapshot,
          bonus: 0,
          serviceCharge: 0,
          adjustments: 0,
          notes: null,
          status: 'draft',
          computedAt: new Date(),
          persisted: false,
        };
      }),
    );

    res.json({
      success: true,
      data: results,
      from: fromDate,
      to: toDate,
      weekStartDay,
      stateCode,
    });
  } catch (err) {
    console.error('[lottery.settlements.list]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * GET /api/lottery/settlements/:weekStart
 * weekStart is YYYY-MM-DD. Computes + returns (but does not persist) a fresh
 * snapshot merged with any saved adjustments.
 */
export const getLotterySettlement = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const { stateCode, weekStartDay, commissionRate } = await _settlementParams(orgId, storeId);
    const { weekStart: raw } = req.params;
    const ws = new Date(raw + 'T00:00:00Z');
    if (Number.isNaN(ws.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid weekStart' });
      return;
    }

    // Snap to actual week boundaries in case caller passed a mid-week date
    const { start, end, due } = _weekRangeFor(ws, weekStartDay);

    const existing = await prisma.lotteryWeeklySettlement.findUnique({
      where: { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
    });

    const snapshot = await _computeSettlement({
      orgId,
      storeId,
      weekStart: start,
      weekEnd: end,
      stateCode: stateCode as Parameters<typeof _computeSettlement>[0]['stateCode'],
      commissionRate,
    });

    // If finalized/paid, return as-is (don't re-compute over the frozen numbers)
    if (existing && existing.status !== 'draft') {
      res.json({ success: true, data: existing, snapshot });
      return;
    }

    // Merge persisted adjustments onto the fresh snapshot.
    const bonus = Number(existing?.bonus || 0);
    const serviceCharge = Number(existing?.serviceCharge || 0);
    const adjustments = Number(existing?.adjustments || 0);

    const weeklyNet =
      snapshot.grossBeforeCommission - snapshot.returnsDeduction - snapshot.totalCommission;
    const weeklyPayable = weeklyNet - bonus + serviceCharge - adjustments;

    const merged = {
      id: existing?.id || null,
      orgId,
      storeId,
      weekStart: start,
      weekEnd: end,
      dueDate: due,
      ...snapshot,
      bonus,
      serviceCharge,
      adjustments,
      notes: existing?.notes || null,
      status: existing?.status || 'draft',
      persisted: !!existing,

      // Explicit totals — frontend displays both with/without commission
      weeklyGross: Math.round(snapshot.grossBeforeCommission * 100) / 100,
      weeklyNet: Math.round(weeklyNet * 100) / 100,
      weeklyPayable: Math.round(weeklyPayable * 100) / 100,
      totalDue: Math.round(weeklyPayable * 100) / 100, // canonical
    };

    res.json({ success: true, data: merged });
  } catch (err) {
    console.error('[lottery.settlements.get]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * PUT /api/lottery/settlements/:weekStart
 * Body: { bonus?, serviceCharge?, adjustments?, notes?, saveComputedSnapshot? }
 *
 * Upserts the adjustments. If `saveComputedSnapshot` is true, also saves
 * the freshly-computed sales/commission numbers (locks them in).
 */
export const upsertLotterySettlement = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const { stateCode, weekStartDay, commissionRate } = await _settlementParams(orgId, storeId);
    const { weekStart: raw } = req.params;
    const ws = new Date(raw + 'T00:00:00Z');
    if (Number.isNaN(ws.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid weekStart' });
      return;
    }
    const { start, end, due } = _weekRangeFor(ws, weekStartDay);

    const existing = await prisma.lotteryWeeklySettlement.findUnique({
      where: { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
    });
    if (existing && existing.status !== 'draft') {
      res
        .status(409)
        .json({ success: false, error: `Cannot edit a ${existing.status} settlement` });
      return;
    }

    const { bonus, serviceCharge, adjustments, notes, saveComputedSnapshot } = req.body || {};

    const snap = saveComputedSnapshot
      ? await _computeSettlement({
          orgId,
          storeId,
          weekStart: start,
          weekEnd: end,
          stateCode: stateCode as Parameters<typeof _computeSettlement>[0]['stateCode'],
          commissionRate,
        })
      : null;

    // Cast to permissive shape because computed snapshot has more fields
    // than the persisted row, and we accept both via the same code path.
    const totalSnapshot = (snap || {
      onlineGross: Number(existing?.onlineGross || 0),
      onlineCashings: Number(existing?.onlineCashings || 0),
      onlineCommission: Number(existing?.onlineCommission || 0),
      instantSales: Number(existing?.instantSales || 0),
      instantSalesComm: Number(existing?.instantSalesComm || 0),
      instantCashingComm: Number(existing?.instantCashingComm || 0),
      returnsDeduction: Number(existing?.returnsDeduction || 0),
      settledBookIds: existing?.settledBookIds || [],
      returnedBookIds: existing?.returnedBookIds || [],
      unsettledBookIds: existing?.unsettledBookIds || [],
    }) as Record<string, unknown>;

    const b = bonus != null ? Number(bonus) : Number(existing?.bonus || 0);
    const s = serviceCharge != null ? Number(serviceCharge) : Number(existing?.serviceCharge || 0);
    const a = adjustments != null ? Number(adjustments) : Number(existing?.adjustments || 0);

    // Match the unified formula — user spec:
    //   Weekly Payable = Σ daily − bonus + service − adjustments − returns − commissions
    const snapGross =
      Number(totalSnapshot.instantSales || 0) -
      Number(totalSnapshot.instantPayouts || totalSnapshot.instantCashingComm || 0) +
      (Number(totalSnapshot.onlineGross || 0) - Number(totalSnapshot.onlineCashings || 0));
    const snapCommission =
      Number(totalSnapshot.instantSalesComm || 0) +
      Number(totalSnapshot.instantCashingComm || 0) +
      Number(totalSnapshot.machineSalesComm || 0) +
      Number(totalSnapshot.machineCashingComm || 0);
    const snapReturns = Number(totalSnapshot.returnsDeduction || 0);

    const totalDue =
      Math.round((snapGross - snapReturns - snapCommission - b + s - a) * 100) / 100;

    const data = {
      orgId,
      storeId,
      weekStart: start,
      weekEnd: end,
      dueDate: due,
      onlineGross: totalSnapshot.onlineGross as number,
      onlineCashings: totalSnapshot.onlineCashings as number,
      onlineCommission: totalSnapshot.onlineCommission as number,
      instantSales: totalSnapshot.instantSales as number,
      instantSalesComm: totalSnapshot.instantSalesComm as number,
      instantCashingComm: totalSnapshot.instantCashingComm as number,
      returnsDeduction: totalSnapshot.returnsDeduction as number,
      settledBookIds: (totalSnapshot.settledBookIds as string[]) || [],
      returnedBookIds: (totalSnapshot.returnedBookIds as string[]) || [],
      unsettledBookIds: (totalSnapshot.unsettledBookIds as string[]) || [],
      bonus: b,
      serviceCharge: s,
      adjustments: a,
      notes: notes != null ? notes : existing?.notes || null,
      totalDue,
      computedAt: snap ? new Date() : existing?.computedAt || null,
    };

    const row = await prisma.lotteryWeeklySettlement.upsert({
      where: { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
      update: data,
      create: { ...data, status: 'draft' },
    });

    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[lottery.settlements.upsert]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * POST /api/lottery/settlements/:weekStart/finalize
 * Body: { paidRef? }
 *
 * Locks the row (status='finalized'). Also flips every book in
 * settledBookIds from their current status to 'settled' so they don't
 * re-appear in next week's candidate list.
 */
export const finalizeLotterySettlement = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const userId = req.user?.id || null;
    const { weekStartDay } = await _settlementParams(orgId, storeId);
    const { weekStart: raw } = req.params;
    const ws = new Date(raw + 'T00:00:00Z');
    if (Number.isNaN(ws.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid weekStart' });
      return;
    }
    const { start } = _weekRangeFor(ws, weekStartDay);

    const existing = await prisma.lotteryWeeklySettlement.findUnique({
      where: { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Save the settlement first' });
      return;
    }
    if (existing.status !== 'draft') {
      res
        .status(409)
        .json({ success: false, error: `Settlement already ${existing.status}` });
      return;
    }

    const ids = Array.isArray(existing.settledBookIds) ? (existing.settledBookIds as string[]) : [];
    const [row] = await prisma.$transaction([
      prisma.lotteryWeeklySettlement.update({
        where: { id: existing.id },
        data: { status: 'finalized', finalizedAt: new Date(), finalizedById: userId },
      }),
      ...(ids.length > 0
        ? [
            prisma.lotteryBox.updateMany({
              where: { id: { in: ids }, orgId, storeId, status: { in: ['active', 'depleted'] } },
              data: { status: 'settled' },
            }),
          ]
        : []),
    ]);

    res.json({ success: true, data: row, settledBooksUpdated: ids.length });
  } catch (err) {
    console.error('[lottery.settlements.finalize]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * POST /api/lottery/settlements/:weekStart/mark-paid
 * Body: { paidRef? }
 */
export const markLotterySettlementPaid = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const { weekStartDay } = await _settlementParams(orgId, storeId);
    const { weekStart: raw } = req.params;
    const ws = new Date(raw + 'T00:00:00Z');
    if (Number.isNaN(ws.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid weekStart' });
      return;
    }
    const { start } = _weekRangeFor(ws, weekStartDay);

    const existing = await prisma.lotteryWeeklySettlement.findUnique({
      where: { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Settlement not found' });
      return;
    }
    if (existing.status === 'paid') {
      res.json({ success: true, data: existing, alreadyPaid: true });
      return;
    }
    if (existing.status !== 'finalized') {
      res
        .status(409)
        .json({ success: false, error: 'Finalize the settlement before marking paid' });
      return;
    }

    const row = await prisma.lotteryWeeklySettlement.update({
      where: { id: existing.id },
      data: { status: 'paid', paidAt: new Date(), paidRef: req.body?.paidRef || null },
    });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[lottery.settlements.mark-paid]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ══════════════════════════════════════════════════════════════════════════
