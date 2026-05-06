/**
 * Lottery — Shift Reports (per-shift reconciliation + history).
 * Split from `lotteryController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (5):
 *   - getLotteryShiftReport      GET  /lottery/shift-reports/:shiftId
 *                                 (compute on-the-fly: tx + boxes + scanned)
 *   - saveLotteryShiftReport     POST /lottery/shift-reports
 *                                 (snapshot per-box ticket positions at shift
 *                                  close; this is the close_day_snapshot
 *                                  source-of-truth event for ticket-math)
 *   - getShiftReports            GET  /lottery/shift-reports?storeId&from&to
 *                                 (history list with sales/payouts/cash totals)
 *   - getPreviousShiftReadings   GET  /lottery/shift-reports/previous-readings
 *                                 (last per-book ticket position before this shift —
 *                                  pre-fills the EoD wizard's start columns)
 *   - getShiftAudit              GET  /lottery/shift-reports/:shiftId/audit
 *                                 (full timeline: transactions + scan events
 *                                  + close snapshot for variance investigation)
 *
 * Source-of-truth contract: `saveLotteryShiftReport` writes a `LotteryScanEvent`
 * with `action='close_day_snapshot'` and the per-box ticket positions in the
 * `parsed` JSON. Every report surface that derives ticket-math sales reads
 * deltas across these snapshot events (S44 reconciliation refactor) — the
 * POS-recorded `LotteryTransaction.amount` is reported as `posSales` audit
 * signal alongside.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { errMsg } from '../../utils/typeHelpers.js';
import {
  bestEffortDailySales,
  rangeSales,
  localDayStartUTC,
  localDayEndUTC,
  formatLocalDate,
} from '../../services/lottery/reporting/index.js';
import { reconcileShift } from '../../services/reconciliation/shift/index.js';
import {
  getOrgId,
  getStore,
  num,
  parseDate,
  type LotteryTxnRow,
  type LotteryGameRow,
  type LotteryBoxLite,
  type LotteryBoxValueRow,
  type LotteryScanEventRow,
  type ScanEventParsed,
} from './helpers.js';

// ══════════════════════════════════════════════════════════════════════════
// SHIFT REPORT
// ══════════════════════════════════════════════════════════════════════════

export const getLotteryShiftReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { shiftId } = req.params;

    const report = await prisma.lotteryShiftReport.findFirst({
      where: { shiftId, orgId, storeId },
    });

    // Compute live totals from transactions
    const txns = (await prisma.lotteryTransaction.findMany({
      where: { shiftId, orgId, storeId },
    })) as LotteryTxnRow[];
    const totalSales = txns
      .filter((t) => t.type === 'sale')
      .reduce((s, t) => s + Number(t.amount), 0);
    const totalPayouts = txns
      .filter((t) => t.type === 'payout')
      .reduce((s, t) => s + Number(t.amount), 0);
    const netAmount = totalSales - totalPayouts;

    if (!report) {
      // Return a computed preview (not yet saved)
      res.json({
        success: true,
        data: { shiftId, orgId, storeId, totalSales, totalPayouts, netAmount, saved: false },
      });
      return;
    }

    const variance =
      report.machineAmount != null || report.digitalAmount != null
        ? (num(report.machineAmount) || 0) + (num(report.digitalAmount) || 0) - netAmount
        : null;

    res.json({
      success: true,
      data: { ...report, totalSales, totalPayouts, netAmount, variance, saved: true },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

interface BoxScanInput {
  boxId?: string | null;
  endTicket?: string | null | 'SO';
  soldout?: boolean;
  gameNumber?: string | null;
  gameName?: string | null;
  slotNumber?: number | null;
  ticketsSold?: number | null;
}

export const saveLotteryShiftReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const {
      shiftId,
      machineAmount,
      digitalAmount,
      scannedTickets,
      scannedAmount,
      boxScans,
      notes,
      closedById,
      // Apr 2026 — cumulative-day readings from the lottery terminal at shift close
      grossSalesReading,
      cancelsReading,
      machineCashingReading,
      couponCashReading,
      discountsReading,
      instantCashingReading,
    } = req.body;
    if (!shiftId) {
      res.status(400).json({ success: false, error: 'shiftId required' });
      return;
    }

    // Compute from transactions
    const txns = (await prisma.lotteryTransaction.findMany({
      where: { shiftId, orgId, storeId },
    })) as LotteryTxnRow[];
    const totalSales = txns
      .filter((t) => t.type === 'sale')
      .reduce((s, t) => s + Number(t.amount), 0);
    const totalPayouts = txns
      .filter((t) => t.type === 'payout')
      .reduce((s, t) => s + Number(t.amount), 0);
    const netAmount = totalSales - totalPayouts;
    const machNum = machineAmount != null ? Number(machineAmount) : null;
    const digNum = digitalAmount != null ? Number(digitalAmount) : null;
    const variance = machNum != null ? machNum + (digNum || 0) - netAmount : null;

    const toDec = (v: unknown): number | null => (v != null && v !== '' ? Number(v) : null);

    const report = await prisma.lotteryShiftReport.upsert({
      where: { shiftId },
      update: {
        machineAmount: machNum,
        digitalAmount: digNum,
        scannedTickets: scannedTickets || undefined,
        scannedAmount: scannedAmount ? Number(scannedAmount) : null,
        boxScans: boxScans || undefined,
        totalSales,
        totalPayouts,
        netAmount,
        variance,
        notes: notes || null,
        closedById: closedById || null,
        closedAt: new Date(),
        // Cumulative-day readings (only update when supplied so EoD wizard
        // can persist them while back-office edits don't clobber them)
        ...(grossSalesReading     !== undefined && { grossSalesReading:     toDec(grossSalesReading) }),
        ...(cancelsReading        !== undefined && { cancelsReading:        toDec(cancelsReading) }),
        ...(machineCashingReading !== undefined && { machineCashingReading: toDec(machineCashingReading) }),
        ...(couponCashReading     !== undefined && { couponCashReading:     toDec(couponCashReading) }),
        ...(discountsReading      !== undefined && { discountsReading:      toDec(discountsReading) }),
        ...(instantCashingReading !== undefined && { instantCashingReading: toDec(instantCashingReading) }),
      },
      create: {
        orgId,
        storeId,
        shiftId,
        machineAmount: machNum,
        digitalAmount: digNum,
        scannedTickets: scannedTickets || undefined,
        scannedAmount: scannedAmount ? Number(scannedAmount) : null,
        boxScans: boxScans || undefined,
        totalSales,
        totalPayouts,
        netAmount,
        variance,
        notes: notes || null,
        closedById: closedById || null,
        closedAt: new Date(),
        grossSalesReading:     toDec(grossSalesReading),
        cancelsReading:        toDec(cancelsReading),
        machineCashingReading: toDec(machineCashingReading),
        couponCashReading:     toDec(couponCashReading),
        discountsReading:      toDec(discountsReading),
        instantCashingReading: toDec(instantCashingReading),
      },
    });

    // Propagate scanned end-tickets to each LotteryBox + emit close_day_snapshot
    // events. Without this, the cashier's EoD scan never reached the box's
    // currentTicket field (so scan engine kept the old position) AND no
    // snapshot existed for the next-day rollover.
    //
    // Apr 2026 — collect per-box failures so the response can surface them
    // to the cashier-app. Previously these were silently swallowed via
    // .catch(...console.warn) which hid the cause of "I scanned but
    // back-office still shows old numbers" — the box update WAS failing
    // (e.g., FK / status mismatch) but cashier saw "Save successful" and
    // walked away. Now we collect every failure into `boxUpdateFailures`
    // and `snapshotInsertFailures` and return them as warnings.
    const boxUpdateFailures: Array<{ boxId: string; error: string; attemptedTicket: string }> = [];
    const snapshotInsertFailures: Array<{ boxId: string; error: string }> = [];
    let boxesUpdated = 0;
    let snapshotsWritten = 0;

    if (Array.isArray(boxScans)) {
      // May 2026 — pre-fetch box metadata + sellDirection ONCE for the whole
      // loop. Used for ticket-position bounds checking + sentinel detection
      // (auto-deplete when cashier types -1 instead of clicking SO).
      const boxIdsInScan = (boxScans as BoxScanInput[])
        .map((b) => b?.boxId)
        .filter((x): x is string => !!x);
      type BoxMeta = { id: string; totalTickets: number | null; status: string };
      const boxMetaList = (await prisma.lotteryBox.findMany({
        where: { id: { in: boxIdsInScan }, orgId, storeId },
        select: { id: true, totalTickets: true, status: true },
      })) as BoxMeta[];
      const boxMetaMap = new Map<string, BoxMeta>(boxMetaList.map((b) => [b.id, b]));
      const sellSettings = await prisma.lotterySettings
        .findUnique({ where: { storeId: storeId as string }, select: { sellDirection: true } })
        .catch(() => null);
      const sellDir = sellSettings?.sellDirection || 'desc';

      for (const bs of boxScans as BoxScanInput[]) {
        if (!bs?.boxId) continue;
        const isSoldout = !!bs.soldout || bs.endTicket === 'SO';
        const endTicket =
          !isSoldout && bs.endTicket != null && bs.endTicket !== '' ? String(bs.endTicket) : null;

        // Bounds check + sentinel detection for typed ticket values.
        // Per user direction (May 2026): only -1 is valid as a negative for
        // desc books. Anything more negative corrupts next-day carry-over
        // because snapshotSales takes |prev - today| × price — if today is
        // -2 instead of -1, "yesterday close = -2" and the next day's math
        // attributes one ticket too many.
        let depleteOnSentinel = false;
        if (endTicket != null) {
          const ticketNum = parseInt(endTicket, 10);
          const meta = boxMetaMap.get(bs.boxId);
          const totalT = Number(meta?.totalTickets || 0);
          const minPos = sellDir === 'asc' ? 0 : -1;
          const maxPos = sellDir === 'asc' ? totalT : Math.max(0, totalT - 1);
          if (!Number.isFinite(ticketNum) || ticketNum < minPos || ticketNum > maxPos) {
            boxUpdateFailures.push({
              boxId: bs.boxId,
              error: `Ticket ${endTicket} out of range ${minPos}..${maxPos} for sellDirection=${sellDir}, pack=${totalT}`,
              attemptedTicket: endTicket,
            });
            continue; // skip this box — don't write a corrupted snapshot
          }
          // Sentinel detection — auto-deplete the box. Mirrors markBoxSoldout
          // so cashier typing -1 produces the same end state as clicking SO.
          const sentinel = sellDir === 'asc' ? totalT : -1;
          if (ticketNum === sentinel && meta?.status === 'active') {
            depleteOnSentinel = true;
          }
        }

        // Update the box if we have a real end ticket
        if (endTicket != null) {
          try {
            await prisma.lotteryBox.update({
              where: { id: bs.boxId },
              data: {
                currentTicket: endTicket,
                lastShiftEndTicket: endTicket,
                updatedAt: new Date(),
                ...(depleteOnSentinel && {
                  status: 'depleted',
                  depletedAt: new Date(),
                  autoSoldoutReason: 'sentinel_typed_via_eod_wizard',
                }),
              },
            });
            boxesUpdated += 1;
          } catch (e) {
            const msg = errMsg(e);
            console.warn('[saveShiftReport] box update failed', bs.boxId, msg);
            boxUpdateFailures.push({
              boxId: bs.boxId,
              error: msg,
              attemptedTicket: endTicket,
            });
          }
        }

        // Create close_day_snapshot event so the next-day rollover works.
        // (Soldout boxes also get an event so the daily-close report
        // includes them — currentTicket: null indicates no specific ticket.)
        try {
          await prisma.lotteryScanEvent.create({
            data: {
              orgId,
              storeId,
              boxId: bs.boxId,
              scannedBy: closedById || null,
              raw: `shift_close:${shiftId}`,
              parsed: {
                gameNumber: bs.gameNumber || null,
                gameName: bs.gameName || null,
                slotNumber: bs.slotNumber ?? null,
                currentTicket: endTicket,
                ticketsSold: bs.ticketsSold ?? null,
                soldout: isSoldout,
              } as unknown as Prisma.InputJsonValue,
              action: 'close_day_snapshot',
              context: 'eod',
            },
          });
          snapshotsWritten += 1;
        } catch (e) {
          const msg = errMsg(e);
          console.warn('[saveShiftReport] snapshot insert failed', bs.boxId, msg);
          snapshotInsertFailures.push({ boxId: bs.boxId, error: msg });
        }
      }
    }

    res.json({
      success: true,
      data: report,
      // Apr 2026 — diagnostic fields. Cashier-app can show these as a
      // warning strip if either failure list is non-empty so the cashier
      // sees that NOT every box committed successfully. Also includes
      // the success counts so any frontend can verify what was saved.
      writeStats: {
        boxesScanned: Array.isArray(boxScans) ? boxScans.length : 0,
        boxesUpdated,
        snapshotsWritten,
      },
      warnings: (boxUpdateFailures.length > 0 || snapshotInsertFailures.length > 0)
        ? {
            boxUpdateFailures,
            snapshotInsertFailures,
            summary:
              `${boxUpdateFailures.length} box update${boxUpdateFailures.length === 1 ? '' : 's'} failed` +
              (snapshotInsertFailures.length > 0
                ? `, ${snapshotInsertFailures.length} snapshot insert${snapshotInsertFailures.length === 1 ? '' : 's'} failed`
                : ''),
          }
        : null,
    });
  } catch (err) {
    console.error('[saveLotteryShiftReport]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};


// ══════════════════════════════════════════════════════════════════════════
// SHIFT HISTORY (list + previous-readings + audit)
// ══════════════════════════════════════════════════════════════════════════
export const getShiftReports = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const reports = await prisma.lotteryShiftReport.findMany({
      where: { orgId, storeId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * GET /api/lottery/previous-shift-readings?excludeShiftId=X
 *
 * Returns the cumulative-day terminal readings recorded by the most recent
 * LotteryShiftReport closed TODAY at this store, EXCLUDING the given shiftId.
 *
 * Used by the cashier-app EoD wizard for Shift 2+ to compute its INCREMENTAL
 * contribution to today's online sales (Apr 2026 — Fix #3). Without this,
 * Shift 2's "Daily Due" would double-count Shift 1's online activity (since
 * the cashier reads cumulative-day totals off the terminal printout).
 *
 * Returns all-zeros if no prior shift report exists today (Shift 1 case).
 */
export const getPreviousShiftReadings = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const excludeShiftId = (req.query?.excludeShiftId as string) || null;

    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const tomorrowUtc = new Date(todayUtc.getTime() + 24 * 3600 * 1000);

    const where: Prisma.LotteryShiftReportWhereInput = {
      orgId,
      storeId,
      closedAt: { gte: todayUtc, lt: tomorrowUtc },
    };
    if (excludeShiftId) where.shiftId = { not: excludeShiftId };

    const prev = await prisma.lotteryShiftReport.findFirst({
      where,
      orderBy: { closedAt: 'desc' },
      select: {
        shiftId: true,
        closedAt: true,
        grossSalesReading: true,
        cancelsReading: true,
        machineCashingReading: true,
        couponCashReading: true,
        discountsReading: true,
        instantCashingReading: true,
      },
    });

    const num = (v: unknown): number => (v != null ? Number(v) : 0);
    res.json({
      success: true,
      hasPrevious: !!prev,
      shiftId: prev?.shiftId ?? null,
      closedAt: prev?.closedAt ?? null,
      readings: {
        grossSales:     num(prev?.grossSalesReading),
        cancels:        num(prev?.cancelsReading),
        machineCashing: num(prev?.machineCashingReading),
        couponCash:     num(prev?.couponCashReading),
        discounts:      num(prev?.discountsReading),
        instantCashing: num(prev?.instantCashingReading),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * GET /api/lottery/shift-audit?date=YYYY-MM-DD
 *
 * Per-day owner audit view. Returns every closed shift on the date in
 * chronological order along with:
 *   - cumulative-day readings off the lottery terminal (snapshotted at
 *     each shift close on LotteryShiftReport)
 *   - per-shift DELTAS computed as `this.reading − previous.reading`
 *     (the lottery terminal shows running daily totals — so cashier 2's
 *     activity = cashier 2's reading − cashier 1's reading)
 *   - full reconcileShift() drawer math per shift (expected vs counted
 *     vs variance, including ticket-math un-rung-cash)
 *   - day-level rollup (last-shift's reading IS the day total for any
 *     cumulative field; per-shift instant scans sum to day total)
 *
 * Powers the back-office Shift Reports drill-down view (Phase D).
 */
export const getShiftAudit = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    if (!orgId || !storeId) {
      res.status(400).json({ success: false, error: 'orgId + storeId required' });
      return;
    }
    // Default + day-boundary math both anchored to STORE-LOCAL time. Pre-fix
    // a Pacific-time store on a UTC server queried "today" using UTC midnight
    // and missed the entire evening of local-day shifts.
    const { getStoreTimezone, formatLocalDate, localDayStartUTC, localDayEndUTC } =
      await import('../../utils/dateTz.js');
    const tz = await getStoreTimezone(storeId, prisma);
    const dateStr = (req.query?.date as string | undefined) || formatLocalDate(new Date(), tz);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      res.status(400).json({ success: false, error: 'date required (YYYY-MM-DD)' });
      return;
    }
    const dayStart = localDayStartUTC(dateStr, tz);
    const dayEnd   = localDayEndUTC(dateStr, tz);

    // 1. Closed shifts opened on this day, chronologically ascending
    interface ShiftLite {
      id: string; cashierId: string; stationId: string | null;
      openedAt: Date; closedAt: Date | null; status: string;
      closingAmount: Prisma.Decimal | null;
    }
    const shifts = (await prisma.shift.findMany({
      where: { orgId, storeId, openedAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { openedAt: 'asc' },
      select: {
        id: true, cashierId: true, stationId: true,
        openedAt: true, closedAt: true, status: true, closingAmount: true,
      },
    })) as ShiftLite[];

    // 2. LotteryShiftReports for those shifts (cumulative readings + box scans)
    const shiftIds = shifts.map((s) => s.id);
    const reports = shiftIds.length
      ? await prisma.lotteryShiftReport.findMany({ where: { shiftId: { in: shiftIds } } })
      : ([] as Awaited<ReturnType<typeof prisma.lotteryShiftReport.findMany>>);
    type LotShiftReport = (typeof reports)[number];
    const reportByShiftId: Record<string, LotShiftReport> = Object.fromEntries(
      reports.map((r: LotShiftReport) => [r.shiftId, r]),
    );

    // 3. Cashier + station name lookups
    const cashierIds = [...new Set(shifts.map((s) => s.cashierId).filter(Boolean))];
    const stationIds = [...new Set(shifts.map((s) => s.stationId).filter((x): x is string => !!x))];
    const [users, stations] = await Promise.all([
      cashierIds.length
        ? prisma.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, name: true } })
        : [],
      stationIds.length
        ? prisma.station.findMany({ where: { id: { in: stationIds } }, select: { id: true, name: true } })
        : [],
    ]);
    interface NameRow { id: string; name: string }
    const userMap: Record<string, string> = Object.fromEntries(
      (users as NameRow[]).map((u) => [u.id, u.name]),
    );
    const stationMap: Record<string, string> = Object.fromEntries(
      (stations as NameRow[]).map((s) => [s.id, s.name]),
    );

    // 4. Per-shift audit row builder
    const r2 = (n: number): number => Math.round(n * 100) / 100;
    const toNum = (v: unknown): number => {
      if (v == null) return 0;
      const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : Number(String(v));
      return Number.isFinite(n) ? n : 0;
    };

    interface Reading {
      grossSales: number; cancels: number; machineCashing: number;
      couponCash: number; discounts: number; instantCashing: number;
    }
    let prev: Reading = {
      grossSales: 0, cancels: 0, machineCashing: 0,
      couponCash: 0, discounts: 0, instantCashing: 0,
    };
    const auditShifts = [] as Array<Record<string, unknown>>;

    for (const s of shifts) {
      const report = reportByShiftId[s.id];
      const readings: Reading = {
        grossSales:     toNum(report?.grossSalesReading),
        cancels:        toNum(report?.cancelsReading),
        machineCashing: toNum(report?.machineCashingReading),
        couponCash:     toNum(report?.couponCashReading),
        discounts:      toNum(report?.discountsReading),
        instantCashing: toNum(report?.instantCashingReading),
      };
      const hasReadings =
        readings.grossSales > 0 || readings.machineCashing > 0 ||
        readings.cancels > 0 || readings.couponCash > 0 ||
        readings.discounts > 0 || readings.instantCashing > 0;

      // Per-shift deltas (this − previous). For the very first shift of the
      // day, prev is all zeros (matches user's "Yes, zero each morning").
      // For shifts where the cashier didn't enter readings, delta is
      // computed from prev = prev (i.e. no movement attributed) — see Q4
      // "missing baseline" handling below.
      const deltas: Reading = {
        grossSales:     hasReadings ? readings.grossSales     - prev.grossSales     : 0,
        cancels:        hasReadings ? readings.cancels        - prev.cancels        : 0,
        machineCashing: hasReadings ? readings.machineCashing - prev.machineCashing : 0,
        couponCash:     hasReadings ? readings.couponCash     - prev.couponCash     : 0,
        discounts:      hasReadings ? readings.discounts      - prev.discounts      : 0,
        instantCashing: hasReadings ? readings.instantCashing - prev.instantCashing : 0,
      };
      const onlineSalesNetShift =
        deltas.grossSales - deltas.cancels - deltas.machineCashing -
        deltas.couponCash - deltas.discounts;

      // Per-shift drawer reconciliation via the unified service.
      // Failures are non-fatal — show an empty reconciliation block instead
      // of failing the whole audit response.
      let reconciliation: Awaited<ReturnType<typeof reconcileShift>> | null = null;
      try {
        reconciliation = await reconcileShift({
          shiftId: s.id,
          closingAmount: s.closingAmount != null ? Number(s.closingAmount) : undefined,
        });
      } catch (e) {
        console.warn('[getShiftAudit] reconcileShift failed for', s.id, errMsg(e));
      }

      // Per-shift instant sales (sum of box scan amounts)
      interface BoxScan { amount?: number | string | null }
      const boxScans = (Array.isArray(report?.boxScans) ? (report?.boxScans as unknown as BoxScan[]) : []) ?? [];
      const instantSalesScan = boxScans.reduce(
        (sum: number, bs) => sum + toNum(bs?.amount),
        0,
      );
      const posRangSales = toNum(report?.totalSales);
      const posRangPayouts = toNum(report?.totalPayouts);

      auditShifts.push({
        shiftId:      s.id,
        cashierId:    s.cashierId,
        cashierName:  userMap[s.cashierId] || 'Unknown',
        stationId:    s.stationId,
        stationName:  s.stationId ? (stationMap[s.stationId] || s.stationId) : 'Unassigned',
        openedAt:     s.openedAt,
        closedAt:     s.closedAt,
        status:       s.status,
        hasReadings,
        readings: {
          grossSales:     r2(readings.grossSales),
          cancels:        r2(readings.cancels),
          machineCashing: r2(readings.machineCashing),
          couponCash:     r2(readings.couponCash),
          discounts:      r2(readings.discounts),
          instantCashing: r2(readings.instantCashing),
        },
        deltas: {
          grossSales:     r2(deltas.grossSales),
          cancels:        r2(deltas.cancels),
          machineCashing: r2(deltas.machineCashing),
          couponCash:     r2(deltas.couponCash),
          discounts:      r2(deltas.discounts),
          instantCashing: r2(deltas.instantCashing),
        },
        onlineSalesNet:    r2(onlineSalesNetShift),
        instantSalesScan:  r2(instantSalesScan),
        posRangSales:      r2(posRangSales),
        posRangPayouts:    r2(posRangPayouts),
        reconciliation,
      });

      // Only roll the prev-readings forward when this shift actually
      // recorded readings — preserves the chain for shifts that skipped
      // entry (their delta becomes 0, next shift's delta picks up from
      // the last-known reading).
      if (hasReadings) prev = readings;
    }

    // 5. Day-level rollup
    const lastWithReadings = [...auditShifts].reverse().find((a) => a.hasReadings);
    const lastReadings = (lastWithReadings?.readings || {
      grossSales: 0, cancels: 0, machineCashing: 0,
      couponCash: 0, discounts: 0, instantCashing: 0,
    }) as Reading;

    const dayInstantSalesTotal = auditShifts.reduce(
      (s: number, a) => s + Number(a.instantSalesScan || 0),
      0,
    );
    const dayOnlineSalesNet =
      lastReadings.grossSales - lastReadings.cancels - lastReadings.machineCashing -
      lastReadings.couponCash - lastReadings.discounts;
    const dailyDue =
      (dayInstantSalesTotal - lastReadings.instantCashing) + dayOnlineSalesNet;

    const expectedDrawerSum = auditShifts.reduce(
      (s: number, a) => s + Number((a.reconciliation as { expectedDrawer?: number } | null)?.expectedDrawer || 0),
      0,
    );
    const countedSum = auditShifts.reduce(
      (s: number, a) => s + Number((a.reconciliation as { closingAmount?: number } | null)?.closingAmount || 0),
      0,
    );
    const varianceSum = auditShifts.reduce(
      (s: number, a) => s + Number((a.reconciliation as { variance?: number } | null)?.variance || 0),
      0,
    );
    const posSalesTotal = auditShifts.reduce(
      (s: number, a) => s + Number(a.posRangSales || 0),
      0,
    );
    const unreportedCashTotal = Math.max(0, dayInstantSalesTotal - posSalesTotal);

    // 6. Lottery settings (variance display preference for the front-end)
    const settings = await prisma.lotterySettings
      .findUnique({ where: { storeId } })
      .catch(() => null);

    res.json({
      date: dateStr,
      shifts: auditShifts,
      day: {
        instantSalesTotal:   r2(dayInstantSalesTotal),
        onlineSalesNet:      r2(dayOnlineSalesNet),
        instantCashingTotal: r2(lastReadings.instantCashing),
        machineCashingTotal: r2(lastReadings.machineCashing),
        grossSalesTotal:     r2(lastReadings.grossSales),
        cancelsTotal:        r2(lastReadings.cancels),
        couponCashTotal:     r2(lastReadings.couponCash),
        discountsTotal:      r2(lastReadings.discounts),
        dailyDue:            r2(dailyDue),
        expectedDrawerSum:   r2(expectedDrawerSum),
        countedSum:          r2(countedSum),
        varianceSum:         r2(varianceSum),
        posSalesTotal:       r2(posSalesTotal),
        unreportedCashTotal: r2(unreportedCashTotal),
      },
      settings: {
        shiftVarianceDisplay:   settings?.shiftVarianceDisplay   || 'always',
        shiftVarianceThreshold: Number(settings?.shiftVarianceThreshold || 0),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

