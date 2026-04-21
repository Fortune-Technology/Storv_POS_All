// Heart of the "less clicks" UX.
//
// A ticket/book barcode comes in; this module decides what happens:
//
//   1. Resolve the parsed scan against LotteryBox inventory.
//   2. If the matched book is on the Counter (status=active):
//        - update currentTicket, return { action: 'update_current' }
//      If on Counter + also a different same-game book exists → shouldn't
//      happen with allowMultipleActivePerGame=false; caller handles the
//      clash.
//   3. If the matched book is in the Safe (status=inventory):
//        - if same game already has an active book AND !allowMultipleActivePerGame:
//            auto-soldout the old one
//        - activate the new one with currentTicket = scanned ticket value
//        - return { action: 'activate', autoSoldout: <box|null> }
//   4. If soldout/returned/settled → return { action: 'rejected', reason }
//   5. Not found → return { action: 'rejected', reason: 'not_in_inventory' }
//
// The function does NOT write a LotteryScanEvent row itself — that's the
// caller's job so it can attach user/context metadata.

import prisma from '../../../config/postgres.js';

/**
 * Auto-pick the next free slot number for this store.
 * Returns the smallest positive integer not currently in use on a book with
 * status='active' at this store.
 */
export async function nextFreeSlot(orgId, storeId) {
  const rows = await prisma.lotteryBox.findMany({
    where: {
      orgId,
      storeId,
      status: 'active',
      slotNumber: { not: null },
    },
    select: { slotNumber: true },
  });
  const used = new Set(rows.map((r) => r.slotNumber).filter((n) => n != null));
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

/**
 * Resolve a parsed scan to a LotteryBox row.
 * MA and ME's ticket formats both expose { gameNumber, bookNumber } — we use
 * those against LotteryGame.gameNumber + LotteryBox.boxNumber.
 *
 * For a Maine EAN-13 book code (bookCode field only), fall back to a lookup
 * on LotteryBox.boxNumber matching the bookCode segment.
 */
export async function findBox(orgId, storeId, parsed) {
  if (parsed.gameNumber && parsed.bookNumber) {
    return prisma.lotteryBox.findFirst({
      where: {
        orgId,
        storeId,
        boxNumber: parsed.bookNumber,
        game: { gameNumber: parsed.gameNumber },
      },
      include: { game: true },
    });
  }
  if (parsed.bookCode) {
    return prisma.lotteryBox.findFirst({
      where: {
        orgId,
        storeId,
        boxNumber: { contains: parsed.bookCode },
      },
      include: { game: true },
    });
  }
  return null;
}

/**
 * Auto-activate / update based on a parsed scan.
 *
 * @returns {Promise<{
 *   action: 'update_current' | 'activate' | 'rejected',
 *   box?: object,
 *   autoSoldout?: object,
 *   reason?: string,
 * }>}
 */
export async function processScan({
  orgId,
  storeId,
  parsed,
  allowMultipleActivePerGame = false,
  userId = null,
}) {
  const box = await findBox(orgId, storeId, parsed);
  if (!box) {
    return { action: 'rejected', reason: 'not_in_inventory' };
  }

  if (['depleted', 'returned', 'settled'].includes(box.status)) {
    return { action: 'rejected', reason: `book_already_${box.status}`, box };
  }

  const ticketNumber = parsed.type === 'ticket' ? String(parsed.ticketNumber) : null;

  if (box.status === 'active') {
    if (ticketNumber != null) {
      const updated = await prisma.lotteryBox.update({
        where: { id: box.id },
        data: { currentTicket: ticketNumber, updatedAt: new Date() },
        include: { game: true },
      });
      return { action: 'update_current', box: updated };
    }
    return { action: 'update_current', box };
  }

  let autoSoldout = null;
  if (box.status === 'inventory') {
    if (!allowMultipleActivePerGame) {
      const peer = await prisma.lotteryBox.findFirst({
        where: {
          orgId,
          storeId,
          gameId: box.gameId,
          status: 'active',
          id: { not: box.id },
        },
      });
      if (peer) {
        autoSoldout = await prisma.lotteryBox.update({
          where: { id: peer.id },
          data: {
            status: 'depleted',
            depletedAt: new Date(),
            autoSoldoutReason: 'new_book_scanned',
            updatedAt: new Date(),
          },
          include: { game: true },
        });
      }
    }

    const slot = await nextFreeSlot(orgId, storeId);
    const activated = await prisma.lotteryBox.update({
      where: { id: box.id },
      data: {
        status: 'active',
        activatedAt: new Date(),
        slotNumber: box.slotNumber || slot,
        currentTicket: ticketNumber || box.startTicket,
        startTicket: box.startTicket || (ticketNumber ?? null),
        lastShiftStartTicket: ticketNumber || box.startTicket,
        autoSoldoutReason: null,
        updatedAt: new Date(),
      },
      include: { game: true },
    });
    return { action: 'activate', box: activated, autoSoldout };
  }

  return { action: 'rejected', reason: `unhandled_status_${box.status}`, box };
}
