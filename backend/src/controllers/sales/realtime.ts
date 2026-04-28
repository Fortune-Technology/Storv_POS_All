/**
 * Realtime Sales — backs the Live Dashboard.
 *
 * One mega-endpoint that returns:
 *   - Today's sales totals (net/gross/tax/deposits/EBT) + tender breakdown
 *   - Top products today (by revenue, top 8)
 *   - Recent 15 transactions for the live feed
 *   - 24-hour distribution
 *   - Today's lottery summary (sales, payouts, commission, active boxes)
 *   - 14-day trend for the headline chart
 *   - Margin (when cost data exists) + cost-coverage % so the UI knows when
 *     to display "—" vs a real margin
 *   - Inventory grade (A-F based on fill rate)
 *   - Weather (current + hourly + 10-day or historical for past dates)
 *
 * Polled every 15s by the dashboard. Heavy single-shot query that pulls a
 * lot of data in parallel — intentionally one round-trip so the UI can
 * cleanly show one timestamp ("last updated").
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';

import { toISO, r2 } from './helpers.js';

interface TenderLineLite {
  method?: string;
  amount?: number | string | null;
}

interface LineItemLite {
  name?: string;
  productId?: string | number | null;
  upc?: string | null;
  qty?: number | string | null;
  totalPrice?: number | string | null;
  lineTotal?: number | string | null;
  costPrice?: number | string | null;
  isLottery?: boolean;
  isBottleReturn?: boolean;
  isBagFee?: boolean;
}

interface ProductMapEntry {
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  productId: string | number | null;
  upc: string | null;
  hasLineCost: boolean;
}

export const realtimeSales = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = req.orgId;
    const storeId = req.storeId || null;

    // ── Date: support ?date=YYYY-MM-DD for historical, default to today ─────
    const now      = new Date();
    const nowStr   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayStr = (req.query as { date?: string }).date || nowStr;
    const isToday  = todayStr === nowStr;
    const todayStart = new Date(`${todayStr}T00:00:00`);
    const todayEnd   = new Date(`${todayStr}T23:59:59.999`);

    // ── Fetch today's completed transactions + refunds ────────────────────────
    const todayWhere: Prisma.TransactionWhereInput = {
      orgId: orgId ?? undefined,
      status: { in: ['complete', 'refund'] },
      createdAt: { gte: todayStart, lte: todayEnd },
    };
    if (storeId) todayWhere.storeId = storeId;

    const txns = await prisma.transaction.findMany({
      where: todayWhere,
      select: {
        id: true,
        txNumber: true,
        grandTotal: true,
        subtotal: true,
        taxTotal: true,
        depositTotal: true,
        ebtTotal: true,
        tenderLines: true,
        lineItems: true,
        status: true,
        createdAt: true,
        stationId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    type TxnRow = (typeof txns)[number];

    // ── Aggregate totals ──────────────────────────────────────────────────────
    let netSales = 0, grossSales = 0, taxTotal = 0, depositTotal = 0, ebtTotal = 0;
    let cashTotal = 0, cardTotal = 0, ebtTender = 0;
    let totalCost = 0, totalRevenue = 0, knownCostItems = 0, totalItems = 0;
    let bagFeeTotal = 0, bagFeeCount = 0;
    const productMap: Record<string, ProductMapEntry> = {};
    const hourlyMap: Record<number, { sales: number; count: number }> = {};

    const seenProductIds = new Set<number>();
    const seenUpcs       = new Set<string>();

    for (const tx of txns as TxnRow[]) {
      const isRefund = tx.status === 'refund';
      const gt = isRefund ? -Math.abs(Number(tx.grandTotal)   || 0) : (Number(tx.grandTotal)   || 0);
      const st = isRefund ? -Math.abs(Number(tx.subtotal)     || 0) : (Number(tx.subtotal)     || 0);
      const tt = isRefund ? -Math.abs(Number(tx.taxTotal)     || 0) : (Number(tx.taxTotal)     || 0);
      const dt = isRefund ? -Math.abs(Number(tx.depositTotal) || 0) : (Number(tx.depositTotal) || 0);
      const et = isRefund ? -Math.abs(Number(tx.ebtTotal)     || 0) : (Number(tx.ebtTotal)     || 0);

      netSales     += st;
      grossSales   += gt;
      taxTotal     += tt;
      depositTotal += dt;
      ebtTotal     += et;

      // Tender breakdown
      const tenders: TenderLineLite[] = Array.isArray(tx.tenderLines) ? (tx.tenderLines as unknown as TenderLineLite[]) : [];
      for (const t of tenders) {
        const amt = (isRefund ? -1 : 1) * Math.abs(Number(t.amount) || 0);
        const m   = String(t.method || '').toLowerCase();
        if (m === 'cash')                          cashTotal  += amt;
        else if (['card', 'credit', 'debit'].includes(m)) cardTotal  += amt;
        else if (m === 'ebt' || m === 'ebt_cash' || m === 'efs') ebtTender  += amt;
      }

      // Bag fees tally — sweep across complete AND refund so refund qty subtracts
      const liAll: LineItemLite[] = Array.isArray(tx.lineItems) ? (tx.lineItems as unknown as LineItemLite[]) : [];
      for (const li of liAll) {
        if (li.isBagFee) {
          const amt = Number(li.lineTotal) || 0;
          const q   = Number(li.qty) || 1;
          if (isRefund) { bagFeeTotal -= Math.abs(amt); bagFeeCount -= Math.abs(q); }
          else           { bagFeeTotal += amt;          bagFeeCount += q; }
        }
      }

      // Top products from lineItems. Skip refunds (returns shouldn't appear as
      // top products).
      const items: LineItemLite[] = (tx.status === 'refund') ? [] : (Array.isArray(tx.lineItems) ? (tx.lineItems as unknown as LineItemLite[]) : []);
      for (const li of items) {
        if (!li.name || li.isLottery || li.isBottleReturn || li.isBagFee) continue;
        const key = li.name;
        const qty = Number(li.qty) || 1;
        const rev = Number(li.totalPrice ?? li.lineTotal ?? 0);
        const perLineCost = Number(li.costPrice);
        const hasLineCost = Number.isFinite(perLineCost) && perLineCost > 0;

        if (!productMap[key]) productMap[key] = {
          name: key, qty: 0, revenue: 0, cost: 0,
          productId: li.productId ?? null, upc: li.upc ?? null,
          hasLineCost: false,
        };
        productMap[key].qty     += qty;
        productMap[key].revenue += rev;
        totalRevenue += rev;
        totalItems   += qty;

        if (hasLineCost) {
          const lineCost = perLineCost * qty;
          productMap[key].cost += lineCost;
          productMap[key].hasLineCost = true;
          totalCost      += lineCost;
          knownCostItems += qty;
        } else {
          if (li.productId) seenProductIds.add(parseInt(String(li.productId), 10));
          if (li.upc)       seenUpcs.add(String(li.upc));
        }
      }

      // Hourly buckets — use gross (grandTotal) for "money through register per hour"
      const h = new Date(tx.createdAt).getHours();
      if (!hourlyMap[h]) hourlyMap[h] = { sales: 0, count: 0 };
      hourlyMap[h].sales += gt;
      hourlyMap[h].count += 1;
    }

    // Batch MasterProduct cost lookup for items without per-line cost
    if (seenProductIds.size || seenUpcs.size) {
      try {
        const orFilters: Prisma.MasterProductWhereInput[] = [];
        if (seenProductIds.size) orFilters.push({ id: { in: [...seenProductIds] } });
        if (seenUpcs.size)       orFilters.push({ upc: { in: [...seenUpcs] } });
        const mps = await prisma.masterProduct.findMany({
          where: {
            orgId: orgId ?? undefined,
            OR: orFilters,
          },
          select: { id: true, upc: true, defaultCostPrice: true },
        });
        type MpRow = (typeof mps)[number];
        const costById  = new Map<string, number>();
        const costByUpc = new Map<string, number>();
        for (const m of mps as MpRow[]) {
          const c = m.defaultCostPrice != null ? Number(m.defaultCostPrice) : null;
          if (!Number.isFinite(c) || (c as number) <= 0) continue;
          costById.set(String(m.id), c as number);
          if (m.upc) costByUpc.set(String(m.upc), c as number);
        }
        for (const p of Object.values(productMap)) {
          if (p.hasLineCost) continue;
          const mc = costById.get(String(p.productId)) ?? costByUpc.get(String(p.upc)) ?? null;
          if (mc != null) {
            const addCost = mc * p.qty;
            p.cost += addCost;
            totalCost      += addCost;
            knownCostItems += p.qty;
          }
        }
      } catch (err) {
        console.warn('⚠ B3 live dashboard cost lookup failed:', (err as Error).message);
      }
    }

    // txCount = completed sales only (refunds reported separately)
    const completedTxns = (txns as TxnRow[]).filter((t) => t.status !== 'refund');
    const refundedTxns  = (txns as TxnRow[]).filter((t) => t.status === 'refund');
    const txCount       = completedTxns.length;
    const refundCount   = refundedTxns.length;
    const grossPreRefund = grossSales + refundedTxns.reduce((s, t) => s + Math.abs(Number(t.grandTotal) || 0), 0);
    const avgTx          = (txCount + refundCount) ? grossPreRefund / (txCount + refundCount) : 0;

    // Hourly array (full 24)
    const hourly = Array.from({ length: 24 }, (_, h) => {
      const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
      return { hour: h, label, sales: hourlyMap[h]?.sales ?? 0, count: hourlyMap[h]?.count ?? 0 };
    });

    // Top 8 products by revenue
    const topProductsList = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    // Recent 15 transactions for live feed
    const recentTx = (txns as TxnRow[]).slice(0, 15).map((tx) => ({
      id:         tx.id,
      txNumber:   tx.txNumber,
      grandTotal: Number(tx.grandTotal),
      createdAt:  tx.createdAt,
      tenderLines: tx.tenderLines,
      stationId:  tx.stationId,
    }));

    // ── Today's lottery ───────────────────────────────────────────────────────
    const lotteryWhere: Prisma.LotteryTransactionWhereInput = {
      orgId: orgId ?? undefined,
      createdAt: { gte: todayStart, lte: todayEnd },
    };
    if (storeId) lotteryWhere.storeId = storeId;

    const [lotteryTxns, lotterySettings, activeBoxes] = await Promise.all([
      prisma.lotteryTransaction.findMany({
        where: lotteryWhere,
        select: { type: true, amount: true, ticketCount: true, gameId: true },
      }),
      storeId
        ? prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null)
        : Promise.resolve(null),
      prisma.lotteryBox.count({
        where: { orgId: orgId ?? undefined, ...(storeId ? { storeId } : {}), status: 'active' },
      }),
    ]);
    type LotRow = (typeof lotteryTxns)[number];

    let lotterySales = 0, lotteryPayouts = 0, lotteryTickets = 0;
    interface GameAgg { gameId: string; sales: number; payouts: number }
    const gameMap: Record<string, GameAgg> = {};
    for (const lt of lotteryTxns as LotRow[]) {
      const amt = Number(lt.amount) || 0;
      if (lt.type === 'sale') {
        lotterySales   += amt;
        lotteryTickets += lt.ticketCount || 0;
        if (lt.gameId) {
          if (!gameMap[lt.gameId]) gameMap[lt.gameId] = { gameId: lt.gameId, sales: 0, payouts: 0 };
          gameMap[lt.gameId].sales += amt;
        }
      } else if (lt.type === 'payout') {
        lotteryPayouts += amt;
        if (lt.gameId) {
          if (!gameMap[lt.gameId]) gameMap[lt.gameId] = { gameId: lt.gameId, sales: 0, payouts: 0 };
          gameMap[lt.gameId].payouts += amt;
        }
      }
    }

    const commissionRate = lotterySettings?.commissionRate ? Number(lotterySettings.commissionRate) : 0.05;
    const lotteryNet        = lotterySales - lotteryPayouts;
    const lotteryCommission = lotterySales * commissionRate;

    const lottery = {
      sales:      lotterySales,
      payouts:    lotteryPayouts,
      net:        lotteryNet,
      tickets:    lotteryTickets,
      commission: lotteryCommission,
      commissionRate,
      activeBoxes,
      txCount:    (lotteryTxns as LotRow[]).filter((t) => t.type === 'sale').length,
      payoutCount: (lotteryTxns as LotRow[]).filter((t) => t.type === 'payout').length,
    };

    // ── 14-day trend ──────────────────────────────────────────────────────────
    const from14 = new Date();
    from14.setDate(from14.getDate() - 13);
    const from14Str = toISO(from14);

    const trendWhere: Prisma.TransactionWhereInput = {
      orgId: orgId ?? undefined,
      status: 'complete',
      createdAt: { gte: new Date(`${from14Str}T00:00:00`) },
    };
    if (storeId) trendWhere.storeId = storeId;

    const allTxns = await prisma.transaction.findMany({
      where: trendWhere,
      select: { grandTotal: true, createdAt: true },
    });
    type AllTxnRow = (typeof allTxns)[number];

    // Group by local date
    const dateMap: Record<string, { date: string; netSales: number; txCount: number }> = {};
    for (const tx of allTxns as AllTxnRow[]) {
      const d = new Date(tx.createdAt);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!dateMap[ds]) dateMap[ds] = { date: ds, netSales: 0, txCount: 0 };
      dateMap[ds].netSales += Number(tx.grandTotal) || 0;
      dateMap[ds].txCount  += 1;
    }

    const trend: Array<{ date: string; netSales: number; txCount: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      trend.push(dateMap[ds] || { date: ds, netSales: 0, txCount: 0 });
    }

    // ── Margin calculation ──────────────────────────────────────────────────────
    const costCoverage = totalItems > 0 ? Math.round((knownCostItems / totalItems) * 100) : 0;
    const hasCostData  = knownCostItems > 0;
    const grossProfit  = hasCostData ? totalRevenue - totalCost : null;
    const avgMargin    = (hasCostData && totalRevenue > 0)
      ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 10000) / 100
      : null;

    // ── Inventory grade (non-blocking) ───────────────────────────────────────
    let inventoryGrade: { grade: string; fillRate: number; inStock: number; outOfStock: number; totalTracked: number } | null = null;
    try {
      const invWhere: Prisma.MasterProductWhereInput = { orgId: orgId ?? undefined, active: true, deleted: false, trackInventory: true };
      const [, storeProducts] = await Promise.all([
        prisma.masterProduct.count({ where: invWhere }),
        prisma.storeProduct.findMany({
          where: { orgId: orgId ?? undefined, ...(storeId ? { storeId } : {}) },
          select: { quantityOnHand: true },
        }),
      ]);
      type SpRow = (typeof storeProducts)[number];
      const inStock = (storeProducts as SpRow[]).filter((sp) => Number(sp.quantityOnHand) > 0).length;
      const outOfStock = (storeProducts as SpRow[]).filter((sp) => Number(sp.quantityOnHand) <= 0).length;
      const fillRate = storeProducts.length > 0 ? Math.round((inStock / storeProducts.length) * 100) : 0;
      const grade = fillRate >= 95 ? 'A' : fillRate >= 85 ? 'B' : fillRate >= 70 ? 'C' : fillRate >= 50 ? 'D' : 'F';
      inventoryGrade = { grade, fillRate, inStock, outOfStock, totalTracked: storeProducts.length };
    } catch { /* non-fatal */ }

    // ── Weather data (non-blocking) ──────────────────────────────────────────
    let weather: unknown = null;
    try {
      const store = storeId ? await prisma.store.findUnique({ where: { id: storeId }, select: { latitude: true, longitude: true, timezone: true } }) : null;
      if (store?.latitude && store?.longitude) {
        const tz = store.timezone || 'America/New_York';
        const { getCurrentWeather, getHourlyForecast, getTenDayForecast, fetchWeatherRange: fetchWR } = await import('../../services/weatherService.js');

        if (isToday) {
          const [current, hourlyForecast, tenDay] = await Promise.all([
            getCurrentWeather(store.latitude as unknown as number, store.longitude as unknown as number, tz),
            getHourlyForecast(store.latitude as unknown as number, store.longitude as unknown as number, tz),
            getTenDayForecast(store.latitude as unknown as number, store.longitude as unknown as number, tz),
          ]);
          weather = { current: (current as { current?: unknown } | null)?.current || null, hourly: hourlyForecast, tenDay, historical: null };
        } else {
          const dayWeather = await fetchWR(store.latitude as unknown as number, store.longitude as unknown as number, todayStr, todayStr, tz);
          weather = { current: null, hourly: [], tenDay: [], historical: (dayWeather as unknown[])?.[0] || null };
        }
      }
    } catch (wErr) {
      console.warn('⚠ Weather fetch for dashboard failed (non-fatal):', (wErr as Error).message);
    }

    res.json({
      todaySales: {
        netSales:     r2(netSales),
        grossSales:   r2(grossSales),
        txCount,
        refundCount,
        avgTx:        r2(avgTx),
        taxTotal:     r2(taxTotal),
        depositTotal: r2(depositTotal),
        bagFeeTotal:  r2(bagFeeTotal),
        bagFeeCount,
        ebtTotal:     r2(ebtTotal),
        cashTotal:    r2(cashTotal),
        cardTotal:    r2(cardTotal),
        ebtTender:    r2(ebtTender),
        avgMargin,
        grossProfit:  grossProfit != null ? Math.round(grossProfit * 100) / 100 : null,
        costCoverage,
        hasCostData,
      },
      inventoryGrade,
      lottery,
      hourly,
      topProducts: topProductsList,
      recentTx,
      trend,
      weather,
      weatherError: weather === null ? 'unavailable' : null,
      isToday,
      dataDate: todayStr,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[realtimeSales]', err);
    res.status(500).json({ error: (err as Error).message });
  }
};
