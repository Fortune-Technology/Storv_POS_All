/**
 * Lottery — Per-store LotterySettings (state, commissionRate, mandates).
 * Split from `lotteryController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (2):
 *   - getLotterySettings    GET /lottery/settings?storeId
 *   - updateLotterySettings PUT /lottery/settings
 *                            (state, commissionRate, cashOnly, scanRequiredAtShiftEnd,
 *                             enabled, sellDirection, weekStartDay)
 *
 * `LotterySettings.enabled` gates every reconciliation surface (S61) so
 * disabled-lottery stores get zero lottery cash flow contribution to the
 * cash-drawer math + no rows in EoD/CloseShiftModal.
 */

import type { Request, Response } from 'express';
import prisma from '../../config/postgres.js';
import { errMsg } from '../../utils/typeHelpers.js';
import { getOrgId, getStore } from './helpers.js';

// ══════════════════════════════════════════════════════════════════════════
// LOTTERY SETTINGS (store-level)
// ══════════════════════════════════════════════════════════════════════════

export const getLotterySettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    let settings = storeId ? await prisma.lotterySettings.findUnique({ where: { storeId } }) : null;
    if (!settings) {
      // Return defaults without creating
      settings = {
        orgId: orgId as string,
        storeId: storeId as string,
        enabled: true,
        cashOnly: false,
        state: null,
        commissionRate: null,
        scanRequiredAtShiftEnd: false,
      } as unknown as Awaited<ReturnType<typeof prisma.lotterySettings.findUnique>>;
    }
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};


// ── updateLotterySettings ─────────────────────────────────────────────
export const updateLotterySettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const {
      enabled,
      cashOnly,
      state,
      commissionRate,
      scanRequiredAtShiftEnd,
      sellDirection,
      allowMultipleActivePerGame,
      weekStartDay,
      settlementPctThreshold,
      settlementMaxDaysActive,
      // Apr 2026 — per-shift variance display preference
      shiftVarianceDisplay,
      shiftVarianceThreshold,
    } = req.body;

    const normalizedDirection =
      sellDirection === 'asc' || sellDirection === 'desc' ? sellDirection : undefined;

    const ALLOWED_VARIANCE_DISPLAY = new Set(['always', 'threshold', 'hidden']);
    const normalizedVarianceDisplay =
      typeof shiftVarianceDisplay === 'string' && ALLOWED_VARIANCE_DISPLAY.has(shiftVarianceDisplay)
        ? shiftVarianceDisplay
        : undefined;

    const settings = await prisma.lotterySettings.upsert({
      where: { storeId },
      update: {
        ...(enabled != null && { enabled: Boolean(enabled) }),
        ...(cashOnly != null && { cashOnly: Boolean(cashOnly) }),
        ...(state != null && { state }),
        ...(commissionRate != null && { commissionRate: Number(commissionRate) }),
        ...(scanRequiredAtShiftEnd != null && {
          scanRequiredAtShiftEnd: Boolean(scanRequiredAtShiftEnd),
        }),
        ...(normalizedDirection && { sellDirection: normalizedDirection }),
        ...(allowMultipleActivePerGame != null && {
          allowMultipleActivePerGame: Boolean(allowMultipleActivePerGame),
        }),
        ...(weekStartDay != null && { weekStartDay: Number(weekStartDay) }),
        ...(settlementPctThreshold != null && {
          settlementPctThreshold: Number(settlementPctThreshold),
        }),
        ...(settlementMaxDaysActive != null && {
          settlementMaxDaysActive: Number(settlementMaxDaysActive),
        }),
        ...(normalizedVarianceDisplay && { shiftVarianceDisplay: normalizedVarianceDisplay }),
        ...(shiftVarianceThreshold != null && {
          shiftVarianceThreshold: Number(shiftVarianceThreshold),
        }),
      },
      create: {
        orgId,
        storeId,
        enabled: enabled != null ? Boolean(enabled) : true,
        cashOnly: cashOnly != null ? Boolean(cashOnly) : false,
        state: state || null,
        commissionRate: commissionRate != null ? Number(commissionRate) : null,
        scanRequiredAtShiftEnd:
          scanRequiredAtShiftEnd != null ? Boolean(scanRequiredAtShiftEnd) : false,
        sellDirection: normalizedDirection || 'desc',
        allowMultipleActivePerGame:
          allowMultipleActivePerGame != null ? Boolean(allowMultipleActivePerGame) : false,
        weekStartDay: weekStartDay != null ? Number(weekStartDay) : null,
        settlementPctThreshold:
          settlementPctThreshold != null ? Number(settlementPctThreshold) : null,
        settlementMaxDaysActive:
          settlementMaxDaysActive != null ? Number(settlementMaxDaysActive) : null,
        shiftVarianceDisplay: normalizedVarianceDisplay || 'always',
        shiftVarianceThreshold:
          shiftVarianceThreshold != null ? Number(shiftVarianceThreshold) : 0,
      },
    });
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

