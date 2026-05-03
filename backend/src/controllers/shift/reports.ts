/**
 * Shift reporting — single-shift detail + multi-shift list.
 *
 * Handlers:
 *   getShiftReport  GET /pos-terminal/shift/:id/report  — full reconciliation + drops/payouts/cashier names
 *   listShifts      GET /pos-terminal/shifts            — back-office shift history with per-shift sales summary
 *
 * Both endpoints denormalize cashier + station names so the cashier-app
 * and back-office UIs don't have to make follow-up requests just to render
 * a list.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { reconcileShift } from '../../services/reconciliation/shift/index.js';

import { getOrgId, type TenderLine } from './helpers.js';

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
