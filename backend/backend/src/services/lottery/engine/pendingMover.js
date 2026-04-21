// Executes scheduled LotteryBox location moves (e.g. "move to safe starting
// 4/20/2026"). Runs every 15 minutes in production; also called on-demand
// from the cashier-app "Close the Day" action so cashiers see the effect
// immediately without waiting for the cron tick.

import prisma from '../../../config/postgres.js';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 min

export async function runPendingMoveSweep({ asOfDate = new Date(), storeId = null } = {}) {
  const where = {
    pendingLocation: { not: null },
    pendingLocationEffectiveDate: { lte: asOfDate },
  };
  if (storeId) where.storeId = storeId;

  const due = await prisma.lotteryBox.findMany({ where, select: { id: true, pendingLocation: true } });
  if (due.length === 0) return { executed: 0 };

  let executed = 0;
  for (const row of due) {
    try {
      const updateData = {
        status: row.pendingLocation,
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
      console.warn('[pendingMover] failed to execute pending move for box', row.id, err.message);
    }
  }
  console.log(`[pendingMover] executed ${executed}/${due.length} pending lottery box moves`);
  return { executed, queued: due.length };
}

let _timer = null;
export function startPendingMoveScheduler() {
  if (_timer) return;
  runPendingMoveSweep().catch((e) => console.warn('[pendingMover] initial sweep failed:', e.message));
  _timer = setInterval(() => {
    runPendingMoveSweep().catch((e) => console.warn('[pendingMover] sweep failed:', e.message));
  }, SWEEP_INTERVAL_MS);
  if (_timer && typeof _timer.unref === 'function') _timer.unref();
  console.log(`[pendingMover] scheduler started (every ${SWEEP_INTERVAL_MS / 60000} min)`);
}

export function stopPendingMoveScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
