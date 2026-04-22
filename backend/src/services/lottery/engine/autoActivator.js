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
 * Detect a gap in the book-number sequence for the game being activated.
 *
 * Books arrive from the state lottery in strict numeric order within a
 * given game. If the store's latest book for game 498 was 027633 and we
 * just received 027636, we skipped 027634 and 027635 — either they're
 * still in transit or missing. We surface this as a warning (non-blocking).
 *
 * Returns a warning descriptor `{ code, message, details }` or null if
 * the scanned book is adjacent/identical/lower than the last-received.
 *
 * Pure, cheap lookup — only runs on activate (not on every scan).
 */
export async function detectSequenceGap({ orgId, storeId, gameId, boxNumber }) {
  if (!boxNumber || !gameId) return null;
  const asInt = parseInt(boxNumber, 10);
  if (Number.isNaN(asInt)) return null;

  // Find the highest numeric book for this game at this store, excluding
  // the one we're activating right now.
  const others = await prisma.lotteryBox.findMany({
    where: { orgId, storeId, gameId, NOT: { boxNumber } },
    select: { boxNumber: true, status: true, createdAt: true },
  });
  if (others.length === 0) return null; // first book for this game; nothing to compare

  const numeric = others
    .map((o) => ({ num: parseInt(o.boxNumber, 10), ...o }))
    .filter((o) => !Number.isNaN(o.num) && o.num < asInt)
    .sort((a, b) => b.num - a.num);
  if (numeric.length === 0) return null; // no smaller predecessor — new game starting range

  const prev = numeric[0];
  const gap = asInt - prev.num - 1;
  if (gap <= 0) return null;

  return {
    code: 'book_sequence_gap',
    message: `Book ${boxNumber} activates after ${prev.boxNumber} — ${gap} book number${gap === 1 ? '' : 's'} in between are not in your inventory. Either they haven't arrived yet or may be missing.`,
    details: {
      scannedBookNumber: boxNumber,
      previousBookNumber: prev.boxNumber,
      missingCount: gap,
    },
  };
}

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
 * Normalise a book number for forgiving comparison.
 * Strips leading zeros so that "27632" and "027632" and "0027632" all
 * collapse to "27632". MA ticket QR codes always emit 6-digit zero-padded
 * book numbers, but a store admin receiving via the UI may type the book
 * without the leading zero. This helper lets findBox match either way.
 */
function normBook(bn) {
  if (bn == null) return '';
  return String(bn).replace(/^0+/, '') || '0';
}

/**
 * Resolve a parsed scan to a LotteryBox row.
 * MA and ME's ticket formats both expose { gameNumber, bookNumber } — we use
 * those against LotteryGame.gameNumber + LotteryBox.boxNumber.
 *
 * For a Maine EAN-13 book code (bookCode field only), fall back to a lookup
 * on LotteryBox.boxNumber matching the bookCode segment.
 *
 * Lookup strategy (game + book case):
 *   1. Exact boxNumber match (fast, typical case).
 *   2. If no hit, fall back to a leading-zero-tolerant match — fetch all
 *      boxes for the game at this store and compare normalised book
 *      numbers. Handles the case where the book was received with a
 *      differently-padded number than what the QR scan produces.
 */
export async function findBox(orgId, storeId, parsed) {
  if (parsed.gameNumber && parsed.bookNumber) {
    // 1. Fast path: exact match
    const exact = await prisma.lotteryBox.findFirst({
      where: {
        orgId,
        storeId,
        boxNumber: parsed.bookNumber,
        game: { gameNumber: parsed.gameNumber },
      },
      include: { game: true },
    });
    if (exact) return exact;

    // 2. Tolerant match: strip leading zeros on both sides
    const target = normBook(parsed.bookNumber);
    const candidates = await prisma.lotteryBox.findMany({
      where: {
        orgId,
        storeId,
        game: { gameNumber: parsed.gameNumber },
      },
      include: { game: true },
    });
    return candidates.find((c) => normBook(c.boxNumber) === target) || null;
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
  // Human-friendly book reference for rejection messages (e.g. "498-027632")
  const bookRef = parsed?.gameNumber && parsed?.bookNumber
    ? `${parsed.gameNumber}-${parsed.bookNumber}`
    : parsed?.bookCode || 'this book';

  const box = await findBox(orgId, storeId, parsed);
  if (!box) {
    return {
      action: 'rejected',
      reason: 'not_in_inventory',
      message: `Book ${bookRef} is not in your store's inventory. Receive it first via Lottery → Counter → Receive Order.`,
    };
  }

  if (['depleted', 'returned', 'settled'].includes(box.status)) {
    return {
      action: 'rejected',
      reason: `book_already_${box.status}`,
      message: `Book ${bookRef} is already ${box.status} and cannot be scanned at end of shift.`,
      box,
    };
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
  const warnings = [];
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

    // Book-sequence gap detection. Books for a given game are issued by the
    // state lottery in numeric order; scanning a book that skips one or more
    // in the expected sequence is a soft warning — either the skipped book
    // hasn't been received yet (inventory mistake) or is missing/stolen.
    // We don't block the activation; we return a warning for the UI to show.
    const gapWarning = await detectSequenceGap({ orgId, storeId, gameId: box.gameId, boxNumber: box.boxNumber });
    if (gapWarning) warnings.push(gapWarning);

    const slot = await nextFreeSlot(orgId, storeId);

    // 3g — derive startTicket from store's sellDirection when the box
    // hasn't been activated before. Descending (default) → book starts at
    // totalTickets-1 (e.g. 149 for a 150-pack) and counts DOWN as sold.
    // Ascending → book starts at 0 and counts UP. The currentTicket reflects
    // where the cashier scanned, which is the next-to-sell position.
    let resolvedStartTicket = box.startTicket;
    if (!resolvedStartTicket) {
      const settings = await prisma.lotterySettings.findUnique({
        where: { storeId },
        select: { sellDirection: true },
      }).catch(() => null);
      const dir = settings?.sellDirection || 'desc';
      const total = Number(box.totalTickets || 0);
      if (total > 0) {
        resolvedStartTicket = dir === 'asc' ? '0' : String(total - 1);
      } else {
        resolvedStartTicket = ticketNumber ?? null;
      }
    }

    const activated = await prisma.lotteryBox.update({
      where: { id: box.id },
      data: {
        status: 'active',
        activatedAt: new Date(),
        slotNumber: box.slotNumber || slot,
        currentTicket: ticketNumber || resolvedStartTicket,
        startTicket: resolvedStartTicket,
        lastShiftStartTicket: ticketNumber || resolvedStartTicket,
        autoSoldoutReason: null,
        updatedAt: new Date(),
      },
      include: { game: true },
    });
    return { action: 'activate', box: activated, autoSoldout, warnings };
  }

  return { action: 'rejected', reason: `unhandled_status_${box.status}`, box };
}
