/**
 * Vendor Return Controller
 * Handles creating, managing, and tracking vendor returns/credits.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

interface ReturnItemInput {
  masterProductId: string | number;
  qty: string | number;
  unitCost: string | number;
  reason?: string;
}

// ── Return number generator ───────────────────────────────────────────────
async function nextReturnNumber(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `RET-${today}-`;
  const last = await prisma.vendorReturn.findFirst({
    where: { returnNumber: { startsWith: prefix } },
    orderBy: { returnNumber: 'desc' },
    select: { returnNumber: true },
  });
  const seq = last ? parseInt(last.returnNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// ── GET /api/vendor-returns ───────────────────────────────────────────────
export const listVendorReturns = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, vendorId, from, to, page = 1, limit = 50 } = req.query as {
      status?: string;
      vendorId?: string;
      from?: string;
      to?: string;
      page?: string | number;
      limit?: string | number;
    };
    const where: Prisma.VendorReturnWhereInput = { orgId: req.orgId as string };
    if (req.storeId) where.storeId = req.storeId;
    if (status) where.status = status;
    if (vendorId) where.vendorId = parseInt(vendorId);
    if (from || to) {
      const range: Prisma.DateTimeFilter = {};
      if (from) range.gte = new Date(from);
      if (to) range.lte = new Date(to + 'T23:59:59');
      where.createdAt = range;
    }

    const [returns, total] = await Promise.all([
      prisma.vendorReturn.findMany({
        where,
        include: {
          vendor: { select: { id: true, name: true, code: true } },
          items: { include: { product: { select: { id: true, name: true, upc: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(String(page)) - 1) * parseInt(String(limit)),
        take: parseInt(String(limit)),
      }),
      prisma.vendorReturn.count({ where }),
    ]);

    res.json({
      returns,
      total,
      page: parseInt(String(page)),
      totalPages: Math.ceil(total / parseInt(String(limit))),
    });
  } catch (err) { next(err); }
};

// ── GET /api/vendor-returns/:id ───────────────────────────────────────────
export const getVendorReturn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ret = await prisma.vendorReturn.findFirst({
      where: { id: req.params.id, orgId: req.orgId as string },
      include: {
        vendor: { select: { id: true, name: true, code: true, email: true } },
        items: { include: { product: { select: { id: true, name: true, upc: true } } } },
      },
    });
    if (!ret) { res.status(404).json({ error: 'Return not found' }); return; }
    res.json(ret);
  } catch (err) { next(err); }
};

interface CreateVendorReturnBody {
  vendorId: string | number;
  purchaseOrderId?: string | null;
  reason: string;
  notes?: string | null;
  items: ReturnItemInput[];
}

// ── POST /api/vendor-returns ──────────────────────────────────────────────
export const createVendorReturn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { vendorId, purchaseOrderId, reason, notes, items } = req.body as CreateVendorReturnBody;
    if (!vendorId || !reason || !items?.length) {
      res.status(400).json({ error: 'vendorId, reason, and items are required' });
      return;
    }

    const returnNumber = await nextReturnNumber();
    const totalAmount = items.reduce(
      (s: number, i: ReturnItemInput) => s + (Number(i.unitCost) || 0) * (parseInt(String(i.qty)) || 0),
      0,
    );

    const ret = await prisma.vendorReturn.create({
      data: {
        orgId: req.orgId as string,
        storeId: req.storeId || '',
        vendorId: parseInt(String(vendorId)),
        purchaseOrderId: purchaseOrderId || null,
        returnNumber,
        reason,
        notes: notes || null,
        totalAmount: Math.round(totalAmount * 100) / 100,
        createdById: req.user?.id || '',
        items: {
          create: items.map((i: ReturnItemInput) => ({
            masterProductId: parseInt(String(i.masterProductId)),
            qty: parseInt(String(i.qty)) || 1,
            unitCost: parseFloat(String(i.unitCost)) || 0,
            lineTotal: Math.round((parseFloat(String(i.unitCost)) || 0) * (parseInt(String(i.qty)) || 1) * 100) / 100,
            reason: i.reason || reason,
          })),
        },
      },
      include: {
        items: { include: { product: { select: { id: true, name: true, upc: true } } } },
        vendor: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(ret);
  } catch (err) { next(err); }
};

// ── POST /api/vendor-returns/:id/submit ───────────────────────────────────
// Submitting deducts inventory
export const submitVendorReturn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ret = await prisma.vendorReturn.findFirst({
      where: { id: req.params.id, orgId: req.orgId as string },
      include: { items: true },
    });
    if (!ret) { res.status(404).json({ error: 'Return not found' }); return; }
    if (ret.status !== 'draft') {
      res.status(400).json({ error: 'Only draft returns can be submitted' });
      return;
    }

    // Deduct inventory for returned items
    for (const item of ret.items) {
      await prisma.storeProduct.updateMany({
        where: { masterProductId: item.masterProductId, storeId: ret.storeId },
        data: {
          quantityOnHand: { decrement: item.qty },
          lastStockUpdate: new Date(),
        },
      }).catch(() => { /* ignore individual missing rows */ });
    }

    await prisma.vendorReturn.update({
      where: { id: req.params.id },
      data: { status: 'submitted', submittedAt: new Date() },
    });

    res.json({ success: true, status: 'submitted' });
  } catch (err) { next(err); }
};

// ── POST /api/vendor-returns/:id/credit ───────────────────────────────────
// Record credit received from vendor
export const recordVendorCredit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { creditAmount } = req.body as { creditAmount?: number | string };
    if (creditAmount == null) { res.status(400).json({ error: 'creditAmount required' }); return; }

    await prisma.vendorReturn.update({
      where: { id: req.params.id },
      data: {
        creditReceived: parseFloat(String(creditAmount)),
        status: 'credited',
        creditedAt: new Date(),
      },
    });

    res.json({ success: true, status: 'credited' });
  } catch (err) { next(err); }
};

// ── POST /api/vendor-returns/:id/close ────────────────────────────────────
export const closeVendorReturn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.vendorReturn.update({
      where: { id: req.params.id },
      data: { status: 'closed' },
    });
    res.json({ success: true, status: 'closed' });
  } catch (err) { next(err); }
};

// ── DELETE /api/vendor-returns/:id ────────────────────────────────────────
export const deleteVendorReturn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ret = await prisma.vendorReturn.findFirst({
      where: { id: req.params.id, orgId: req.orgId as string },
    });
    if (!ret) { res.status(404).json({ error: 'Return not found' }); return; }
    if (ret.status !== 'draft') {
      res.status(400).json({ error: 'Only draft returns can be deleted' });
      return;
    }

    await prisma.vendorReturn.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
};
