/**
 * Lottery — Transactions (per-shift sale + payout recording).
 * Split from `lotteryController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (3):
 *   - getLotteryTransactions       GET  /lottery/transactions
 *   - createLotteryTransaction     POST /lottery/transactions
 *   - bulkCreateLotteryTransactions POST /lottery/transactions/bulk
 *                                  (used by EoD wizard to save reconciled
 *                                   transactions in one batch)
 *
 * `LotteryTransaction.amount` is the POS-ringed-up audit signal — NOT the
 * authoritative sales total. The authoritative number is the close_day_snapshot
 * delta (S44 ticket-math). The `posSales` vs `unreported` columns in reports
 * surface the gap when cashiers don't ring up every ticket.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { errMsg } from '../../utils/typeHelpers.js';
import { getOrgId, getStore, type LotteryTxnRow } from './helpers.js';

// ══════════════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ══════════════════════════════════════════════════════════════════════════

export const getLotteryTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { shiftId, type, limit = 50, offset = 0, from, to } = req.query;
    const where: Prisma.LotteryTransactionWhereInput = {
      orgId,
      storeId,
      ...(shiftId && { shiftId: shiftId as string }),
      ...(type && { type: type as string }),
      ...((from || to) && {
        createdAt: {
          ...(from && { gte: new Date(from as string) }),
          ...(to && { lte: new Date(to as string) }),
        },
      }),
    };
    const [txns, total] = await Promise.all([
      prisma.lotteryTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: Number(offset),
        take: Number(limit),
      }),
      prisma.lotteryTransaction.count({ where }),
    ]);
    res.json({ success: true, data: txns, total });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const createLotteryTransaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const {
      type,
      amount,
      shiftId,
      cashierId,
      stationId,
      gameId,
      boxId,
      ticketCount,
      notes,
      posTransactionId,
    } = req.body;
    if (!type || !amount) {
      res.status(400).json({ success: false, error: 'type and amount are required' });
      return;
    }
    if (!['sale', 'payout'].includes(type)) {
      res.status(400).json({ success: false, error: 'type must be sale or payout' });
      return;
    }

    const txn = await prisma.lotteryTransaction.create({
      data: {
        orgId: orgId as string,
        storeId: storeId as string,
        type,
        amount: Number(amount),
        shiftId: shiftId || null,
        cashierId: cashierId || null,
        stationId: stationId || null,
        gameId: gameId || null,
        boxId: boxId || null,
        ticketCount: ticketCount ? Number(ticketCount) : null,
        notes: notes || null,
        posTransactionId: posTransactionId || null,
      },
    });

    // Update box running totals if a boxId was provided
    if (boxId && type === 'sale') {
      await prisma.lotteryBox.updateMany({
        where: { id: boxId, orgId, storeId },
        data: {
          ticketsSold: { increment: ticketCount ? Number(ticketCount) : 1 },
          salesAmount: { increment: Number(amount) },
        },
      });
    }

    res.json({ success: true, data: txn });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

interface BulkLotteryTransactionInput {
  type: string;
  amount: number | string;
  shiftId?: string | null;
  cashierId?: string | null;
  gameId?: string | null;
  boxId?: string | null;
  ticketCount?: number | string | null;
  notes?: string | null;
}

// Bulk — record multiple sales/payouts in one request (used at shift end scan)
export const bulkCreateLotteryTransactions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { transactions } = req.body;
    if (!Array.isArray(transactions) || !transactions.length) {
      res.status(400).json({ success: false, error: 'transactions array required' });
      return;
    }
    const created = await prisma.lotteryTransaction.createMany({
      data: transactions.map((t: BulkLotteryTransactionInput) => ({
        orgId: orgId as string,
        storeId: storeId as string,
        type: t.type,
        amount: Number(t.amount),
        shiftId: t.shiftId || null,
        cashierId: t.cashierId || null,
        gameId: t.gameId || null,
        boxId: t.boxId || null,
        ticketCount: t.ticketCount ? Number(t.ticketCount) : null,
        notes: t.notes || null,
      })),
    });
    res.json({ success: true, count: created.count });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

