// Executes scheduled LotteryBox location moves (e.g. "move to safe starting
// 4/20/2026"). Runs every 15 minutes in production; also called on-demand
// from the cashier-app "Close the Day" action so cashiers see the effect
// immediately without waiting for the cron tick.

import type { Prisma } from '@prisma/client';
import prisma from '../../../config/postgres.js';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 min

export interface RunPendingMoveOpts {
  asOfDate?: Date;
  storeId?: string | null;
}

export interface RunPendingMoveResult {
  executed: number;
  queued?: number;
}

export async function runPendingMoveSweep(
  { asOfDate = new Date(), storeId = null }: RunPendingMoveOpts = {},
): Promise<RunPendingMoveResult> {
  const where: Prisma.LotteryBoxWhereInput = {
    pendingLocation: { not: null },
    pendingLocationEffectiveDate: { lte: asOfDate },
  };
  if (storeId) where.storeId = storeId;

  const due = await prisma.lotteryBox.findMany({ where, select: { id: true, pendingLocation: true } });
  if (due.length === 0) return { executed: 0 };

  let executed = 0;
  for (const row of due) {
    try {
      const updateData: Prisma.LotteryBoxUpdateInput = {
        status: row.pendingLocation as string,
        pendingLocation: null,
        pendingLocationEffectiveDate: null,
        pendingLocationRequestedAt: null,
        updatedAt: new Date(),
      };
      if (row.pendingLocation === 'depleted') updateData.depletedAt = new Date();
      if (row.pendingLocation === 'returned') updateData.returnedAt = new Date();
      if (row.pendingLocation === 'inventory') {
        // Move to Safe → free up the slot
        updateData.slotNumber = null;
      }
      await prisma.lotteryBox.update({ where: { id: row.id }, data: updateData });
      executed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[pendingMover] failed to execute pending move for box', row.id, message);
    }
  }
  console.log(`[pendingMover] executed ${executed}/${due.length} pending lottery box moves`);
  return { executed, queued: due.length };
}

let _timer: ReturnType<typeof setInterval> | null = null;

export function startPendingMoveScheduler(): void {
  if (_timer) return;
  runPendingMoveSweep().catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[pendingMover] initial sweep failed:', message);
  });
  _timer = setInterval(() => {
    runPendingMoveSweep().catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('[pendingMover] sweep failed:', message);
    });
  }, SWEEP_INTERVAL_MS);
  if (_timer && typeof _timer.unref === 'function') _timer.unref();
  console.log(`[pendingMover] scheduler started (every ${SWEEP_INTERVAL_MS / 60000} min)`);
}

export function stopPendingMoveScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
