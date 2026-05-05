/**
 * fuel/transactions.ts
 *
 * Read-side queries against FuelTransaction (writes happen in
 * posTerminalController during the cashier's tender flow).
 *
 *   listFuelTransactions  — generic filterable list (date / type / shift / cashier / fuelType)
 *   listRecentFuelSales   — sale-only feed enriched with cumulative refund totals
 *                           per parent tx; powers the cashier-app pump-aware
 *                           refund picker. Prevents over-refunds via remainingAmount.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { getOrgId, getStore } from './helpers.js';

export const listFuelTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const q = req.query as {
      from?: string; to?: string; fuelTypeId?: string; type?: string;
      shiftId?: string; cashierId?: string; limit?: string;
    };
    const { from, to, fuelTypeId, type, shiftId, cashierId } = q;
    const limit = q.limit || '200';

    const where: Prisma.FuelTransactionWhereInput = { orgId: orgId ?? undefined, ...(storeId && { storeId }) };
    if (fuelTypeId) where.fuelTypeId = fuelTypeId;
    if (type)       where.type = type;
    if (shiftId)    where.shiftId = shiftId;
    if (cashierId)  where.cashierId = cashierId;
    if (from || to) {
      const range: Prisma.DateTimeFilter = {};
      if (from) range.gte = new Date(from);
      if (to)   range.lte = new Date(to);
      where.createdAt = range;
    }

    const txs = await prisma.fuelTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    Math.min(Number(limit) || 200, 1000),
      include: { fuelType: { select: { id: true, name: true, gradeLabel: true, color: true } } },
    });
    res.json({ success: true, data: txs });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// RECENT FUEL SALES — powers pump-aware refund picker in cashier-app
// Returns sales only (not refunds), with cumulative already-refunded amounts
// so the UI can show "Refunded $X of $Y" + prevent over-refunds.
// ══════════════════════════════════════════════════════════════════════════

export const listRecentFuelSales = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const q = req.query as { limit?: string; pumpId?: string; shiftId?: string };
    const { pumpId, shiftId } = q;
    const limit = q.limit || '30';

    const where: Prisma.FuelTransactionWhereInput = { orgId: orgId ?? undefined, storeId, type: 'sale' };
    if (pumpId)  where.pumpId  = pumpId;
    if (shiftId) where.shiftId = shiftId;

    const rows = await prisma.fuelTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 30, 200),
      include: {
        fuelType: { select: { id: true, name: true, gradeLabel: true, color: true } },
        pump:     { select: { id: true, pumpNumber: true, label: true } },
      },
    });
    type SaleRow = (typeof rows)[number];

    const saleIds = (rows as SaleRow[]).map((r) => r.id);
    const refunds = saleIds.length > 0 ? await prisma.fuelTransaction.findMany({
      where: { refundsOf: { in: saleIds } },
      select: { refundsOf: true, amount: true, gallons: true },
    }) : [];
    const refundedByTx = new Map<string, { amount: number; gallons: number }>();
    type RefundRow = (typeof refunds)[number];
    for (const r of refunds as RefundRow[]) {
      if (!r.refundsOf) continue;
      const prev = refundedByTx.get(r.refundsOf) || { amount: 0, gallons: 0 };
      refundedByTx.set(r.refundsOf, {
        amount:  prev.amount  + Number(r.amount),
        gallons: prev.gallons + Number(r.gallons),
      });
    }

    const enriched = (rows as SaleRow[]).map((r) => ({
      ...r,
      refundedAmount:  refundedByTx.get(r.id)?.amount  || 0,
      refundedGallons: refundedByTx.get(r.id)?.gallons || 0,
      remainingAmount:  Number(r.amount)  - (refundedByTx.get(r.id)?.amount  || 0),
      remainingGallons: Number(r.gallons) - (refundedByTx.get(r.id)?.gallons || 0),
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
