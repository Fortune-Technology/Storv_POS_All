/**
 * Lottery — Analytics reports (dashboard + range report + commission).
 * Split from `lotteryController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (3):
 *   - getLotteryDashboard       GET /lottery/dashboard?storeId
 *                                (today + month KPIs + active boxes + top games)
 *   - getLotteryReport          GET /lottery/report?from&to&storeId
 *                                (per-day chart data + per-game breakdown)
 *   - getLotteryCommissionReport GET /lottery/commission?from&to&storeId
 *                                (commission earned per game using
 *                                 store-level LotterySettings.commissionRate;
 *                                 ticket-math truth from snapshot deltas)
 *
 * All three surfaces use the ticket-math source-of-truth model (S44):
 *   - `totalSales` = ticket-math from close_day_snapshot deltas (authoritative)
 *   - `posSales`   = sum of LotteryTransaction.amount (audit signal — what
 *                     cashiers actually rang up)
 *   - `unreported` = max(0, totalSales − posSales) (the "didn't ring up" gap)
 *
 * Timezone: every range walk uses store-local boundaries via `_realSalesRange`
 * + `formatLocalDate` from the lottery reporting service (S59 timezone fix).
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { errMsg } from '../../utils/typeHelpers.js';
import {
  rangeSales,
  localDayStartUTC,
  localDayEndUTC,
  formatLocalDate,
} from '../../services/lottery/reporting/index.js';

// Local alias preserved from the original — handlers call _realSalesRange.
const _realSalesRange = rangeSales;
import {
  getOrgId,
  getStore,
  type LotteryTxnRow,
  type LotteryGameRow,
  type LotteryBoxValueRow,
  type LotteryOnlineTotalRow,
  type DayBucket,
  type GameBucket,
} from './helpers.js';

// REPORTS
// ══════════════════════════════════════════════════════════════════════════

export const getLotteryDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;

    // B9 — month-to-date window in store-local timezone (NOT UTC). For a
    // store in EDT, "April MTD" means April 1 00:00 EDT = April 1 04:00 UTC,
    // not April 1 00:00 UTC. Snapshots written at local 22:00 land in the
    // correct local-day bucket only when day boundaries respect tz.
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } });
    const tz = store?.timezone || 'UTC';
    const todayLocalStr = formatLocalDate(new Date(), tz);
    const monthStartLocalStr = `${todayLocalStr.slice(0, 7)}-01`;
    const monthStart = localDayStartUTC(monthStartLocalStr, tz);
    const monthEnd = new Date();

    const [monthTxnsRaw, activeBoxes, inventoryBoxes, real] = await Promise.all([
      // Payouts + posSales come from LotteryTransaction (audit signal only)
      prisma.lotteryTransaction.findMany({
        where: { orgId, storeId, createdAt: { gte: monthStart, lte: monthEnd } },
        select: { type: true, amount: true },
      }),
      prisma.lotteryBox.count({ where: { orgId, storeId, status: 'active' } }),
      prisma.lotteryBox.count({ where: { orgId, storeId, status: 'inventory' } }),
      // Authoritative sales come from ticket-math snapshots (the cashier
      // doesn't have to ring up every ticket — close_day_snapshot deltas are truth)
      _realSalesRange({ orgId, storeId, from: monthStart, to: monthEnd, timezone: tz }),
    ]);
    const monthTxns = monthTxnsRaw as LotteryTxnRow[];

    const totalSales = real.totalSales; // ticket-math truth
    const posSales = monthTxns
      .filter((t) => t.type === 'sale')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const totalPayouts = monthTxns
      .filter((t) => t.type === 'payout')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    // Round all currency math to 2dp so floating-point noise (eg .9500000005)
    // doesn't leak into the response. Compare-then-round: keeps unreported
    // semantics intact while presenting clean values to the UI.
    const unreported = Math.max(0, Math.round((totalSales - posSales) * 100) / 100);
    const netRevenue = Math.round((totalSales - totalPayouts) * 100) / 100;

    const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
    const commissionRate = settings?.commissionRate ? Number(settings.commissionRate) : 0.05;
    const commission = Math.round(totalSales * commissionRate * 100) / 100;

    res.json({
      totalSales,
      posSales: Math.round(posSales * 100) / 100,
      unreported,
      totalPayouts: Math.round(totalPayouts * 100) / 100,
      netRevenue,
      commission,
      activeBoxes,
      inventoryBoxes,
      salesSource: real.source, // 'snapshot' | 'live' | 'pos_fallback' | 'mixed' | 'empty'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const getLotteryReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const { period = 'day', from, to } = req.query;

    // B9 — date-string parsing must respect store timezone. A `from=2026-04-23`
    // query for an EDT store means "starting at local midnight on Apr 23",
    // which is 04:00 UTC the same day — NOT 00:00 UTC. Otherwise close_day_snapshot
    // events written at local 22:00 (= UTC 02:00 next day) land in the wrong bucket
    // and per-day sales drift by one day across the whole window.
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } });
    const tz = store?.timezone || 'UTC';

    const now = new Date();
    const todayLocal = formatLocalDate(now, tz);
    let startDate: Date;
    if (from) {
      startDate = localDayStartUTC(from as string, tz);
    } else if (period === 'week') {
      // 7 days ago in store-local terms
      const seven = new Date(localDayStartUTC(todayLocal, tz).getTime() - 7 * 24 * 3600 * 1000);
      startDate = localDayStartUTC(formatLocalDate(seven, tz), tz);
    } else if (period === 'month') {
      // 30 days ago in store-local terms
      const thirty = new Date(localDayStartUTC(todayLocal, tz).getTime() - 30 * 24 * 3600 * 1000);
      startDate = localDayStartUTC(formatLocalDate(thirty, tz), tz);
    } else {
      startDate = localDayStartUTC(todayLocal, tz);
    }
    const endDate = to ? localDayEndUTC(to as string, tz) : new Date();

    // Ticket-math (authoritative) sales — walks close_day_snapshot deltas day by day
    const real = await _realSalesRange({ orgId, storeId, from: startDate, to: endDate, timezone: tz });
    const totalSales = real.totalSales;

    // POS-side data (audit signal): payouts + ringed-up sales
    const txns = (await prisma.lotteryTransaction.findMany({
      where: { orgId, storeId, createdAt: { gte: startDate, lte: endDate } },
      orderBy: { createdAt: 'asc' },
      select: { type: true, amount: true, gameId: true, createdAt: true },
    })) as LotteryTxnRow[];

    const posSales =
      Math.round(
        txns.filter((t) => t.type === 'sale').reduce((s, t) => s + Number(t.amount || 0), 0) * 100,
      ) / 100;
    const totalPayouts =
      Math.round(
        txns.filter((t) => t.type === 'payout').reduce((s, t) => s + Number(t.amount || 0), 0) *
          100,
      ) / 100;
    const unreported = Math.max(0, Math.round((totalSales - posSales) * 100) / 100);
    const netAmount = Math.round((totalSales - totalPayouts) * 100) / 100;

    // Chart: per-day buckets with FIVE series so the UI can render a
    // multi-line graph with checkbox toggles.
    const dayMap: Record<string, DayBucket> = {};
    real.byDay.forEach((d) => {
      dayMap[d.date] = {
        date: d.date,
        sales: d.sales,
        payouts: 0,
        net: d.sales,
        machineSales: 0,
        machineCashing: 0,
        instantCashing: 0,
      };
    });
    txns
      .filter((t) => t.type === 'payout')
      .forEach((t) => {
        // B9 — bucket payouts by store-local date (not UTC) so they line up
        // with rangeSales' tz-aware day buckets.
        const key = formatLocalDate(t.createdAt, tz);
        if (!dayMap[key])
          dayMap[key] = {
            date: key,
            sales: 0,
            payouts: 0,
            net: 0,
            machineSales: 0,
            machineCashing: 0,
            instantCashing: 0,
          };
        dayMap[key].payouts += Number(t.amount || 0);
        dayMap[key].net = dayMap[key].sales - dayMap[key].payouts;
      });

    // Online totals (machine draws + cashings) — one row per day
    const onlineRows = (await prisma.lotteryOnlineTotal.findMany({
      where: { orgId, storeId, date: { gte: startDate, lte: endDate } },
      select: { date: true, machineSales: true, machineCashing: true, instantCashing: true },
    })) as LotteryOnlineTotalRow[];
    onlineRows.forEach((o) => {
      const key = o.date.toISOString().slice(0, 10);
      if (!dayMap[key])
        dayMap[key] = {
          date: key,
          sales: 0,
          payouts: 0,
          net: 0,
          machineSales: 0,
          machineCashing: 0,
          instantCashing: 0,
        };
      dayMap[key].machineSales = Number(o.machineSales || 0);
      dayMap[key].machineCashing = Number(o.machineCashing || 0);
      dayMap[key].instantCashing = Number(o.instantCashing || 0);
    });

    const chart = Object.values(dayMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date,
        sales: Math.round(d.sales * 100) / 100,
        payouts: Math.round(d.payouts * 100) / 100,
        net: Math.round(d.net * 100) / 100,
        machineSales: Math.round(d.machineSales * 100) / 100,
        machineCashing: Math.round(d.machineCashing * 100) / 100,
        instantCashing: Math.round(d.instantCashing * 100) / 100,
      }));

    // Per-game breakdown — sales from ticket math (real.byGame), payouts from txns
    const gameMap: Record<string, GameBucket> = {};
    for (const [gameId, info] of real.byGame.entries()) {
      gameMap[gameId] = {
        gameId,
        gameName: null,
        sales: info.sales,
        payouts: 0,
        net: info.sales,
        count: info.count,
      };
    }
    txns.forEach((t) => {
      const key = t.gameId || '_unknown';
      if (!gameMap[key])
        gameMap[key] = { gameId: key, gameName: null, sales: 0, payouts: 0, net: 0, count: 0 };
      if (t.type === 'payout') {
        gameMap[key].payouts += Number(t.amount || 0);
        gameMap[key].net = gameMap[key].sales - gameMap[key].payouts;
      }
    });
    const gameIds = Object.keys(gameMap).filter((k) => k !== '_unknown');
    if (gameIds.length) {
      const games = (await prisma.lotteryGame.findMany({
        where: { id: { in: gameIds } },
        select: { id: true, name: true },
      })) as LotteryGameRow[];
      games.forEach((g) => {
        if (gameMap[g.id]) gameMap[g.id].gameName = g.name;
      });
    }
    const byGame = Object.values(gameMap).map((g) => ({ ...g, gameName: g.gameName || 'Other' }));

    res.json({
      totalSales,
      posSales,
      unreported,
      totalPayouts,
      netRevenue: netAmount,
      transactionCount: txns.length,
      byGame,
      chart,
      salesSource: real.source, // 'snapshot' | 'live' | 'pos_fallback' | 'mixed' | 'empty'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const getLotteryCommissionReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const { from, to, period = 'month' } = req.query;

    // B9 — same tz-aware date parsing as getLotteryReport. Without this,
    // commission rates × snapshot sales for non-UTC stores produce numbers
    // that drift by one day every day across the window.
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } });
    const tz = store?.timezone || 'UTC';
    const todayLocal = formatLocalDate(new Date(), tz);

    let startDate: Date;
    if (from) {
      startDate = localDayStartUTC(from as string, tz);
    } else if (period === 'week') {
      const seven = new Date(localDayStartUTC(todayLocal, tz).getTime() - 7 * 24 * 3600 * 1000);
      startDate = localDayStartUTC(formatLocalDate(seven, tz), tz);
    } else if (period === 'day') {
      startDate = localDayStartUTC(todayLocal, tz);
    } else {
      // Default 'month' = MTD (first of current local month)
      const monthStartLocal = `${todayLocal.slice(0, 7)}-01`;
      startDate = localDayStartUTC(monthStartLocal, tz);
    }
    const endDate = to ? localDayEndUTC(to as string, tz) : new Date();

    // Authoritative sales from ticket math — already grouped by gameId
    const real = await _realSalesRange({ orgId, storeId, from: startDate, to: endDate, timezone: tz });

    // Game catalog for naming + ensure inactive games still show with $0 sales
    const games = (await prisma.lotteryGame.findMany({
      where: { orgId, storeId, deleted: false },
      select: { id: true, name: true },
    })) as LotteryGameRow[];

    // Get store commission rate from settings
    const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
    const storeCommissionRate = settings?.commissionRate ? Number(settings.commissionRate) : 0.05;

    interface CommissionAccumulator {
      gameName: string;
      gameId: string;
      sales: number;
    }

    // Merge real sales with the game catalog. A game with no sales in the
    // window still appears with $0 so the UI doesn't have a sparse row count.
    const gameById = new Map<string, CommissionAccumulator>(
      games.map((g) => [g.id, { gameName: g.name, gameId: g.id, sales: 0 }]),
    );
    for (const [gameId, info] of real.byGame.entries()) {
      const existing = gameById.get(gameId) || { gameName: 'Other', gameId, sales: 0 };
      existing.sales += info.sales;
      gameById.set(gameId, existing);
    }

    const commissionRows = [...gameById.values()].map((g) => {
      const earned = g.sales * storeCommissionRate;
      return {
        gameName: g.gameName,
        commissionRate: storeCommissionRate,
        totalSales: g.sales,
        commission: earned,
      };
    });

    const totalCommission = commissionRows.reduce((s, c) => s + c.commission, 0);
    const totalSalesAll = commissionRows.reduce((s, c) => s + c.totalSales, 0);
    const avgRate = totalSalesAll > 0 ? totalCommission / totalSalesAll : 0;
    const byGame = commissionRows.map((c) => ({
      gameName: c.gameName,
      rate: c.commissionRate,
      sales: c.totalSales,
      commission: c.commission,
    }));
    res.json({ totalCommission, totalSales: totalSalesAll, avgRate, byGame });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

