/**
 * Vendor Payment Controller
 * Back-office managed vendor payments (not tied to cashier shifts).
 *
 * Routes:
 *   GET  /api/catalog/vendor-payments         → listVendorPayments
 *   POST /api/catalog/vendor-payments         → createVendorPayment
 *   PUT  /api/catalog/vendor-payments/:id     → updateVendorPayment
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

const getOrgId = (req: Request): string | null | undefined => req.orgId || req.user?.orgId;

interface VendorPaymentRow {
  id: string;
  amount: Prisma.Decimal | number;
  createdById: string | null;
  paymentType: string;
  [extra: string]: unknown;
}

// ── GET /vendor-payments ──────────────────────────────────────────────────
export const listVendorPayments = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const { storeId, dateFrom, dateTo, paymentType, vendorId, limit = 200 } = req.query as {
      storeId?: string;
      dateFrom?: string;
      dateTo?: string;
      paymentType?: string;
      vendorId?: string;
      limit?: string | number;
    };

    const where: Prisma.VendorPaymentWhereInput = { orgId };
    if (storeId)     where.storeId     = storeId;
    if (paymentType) where.paymentType = paymentType;
    if (vendorId)    where.vendorId    = parseInt(vendorId);

    if (dateFrom || dateTo) {
      const range: Prisma.DateTimeFilter = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        range.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      }
      if (dateTo) {
        const d = new Date(dateTo);
        range.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      }
      where.paymentDate = range;
    }

    const payments = await prisma.vendorPayment.findMany({
      where,
      orderBy: { paymentDate: 'desc' },
      take: Math.min(parseInt(String(limit)) || 200, 1000),
    }) as unknown as VendorPaymentRow[];

    // Resolve creator names
    const userIds = Array.from(
      new Set(payments.map((p: VendorPaymentRow) => p.createdById).filter((id): id is string => !!id)),
    );
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const userMap: Record<string, string> = Object.fromEntries(
      users.map((u: { id: string; name: string }) => [u.id, u.name]),
    );

    const totalExpense     = payments.filter((p: VendorPaymentRow) => p.paymentType !== 'merchandise').reduce((s: number, p: VendorPaymentRow) => s + Number(p.amount), 0);
    const totalMerchandise = payments.filter((p: VendorPaymentRow) => p.paymentType === 'merchandise').reduce((s: number, p: VendorPaymentRow) => s + Number(p.amount), 0);

    res.json({
      success: true,
      payments: payments.map((p: VendorPaymentRow) => ({
        ...p,
        amount:      Number(p.amount),
        createdByName: (p.createdById && userMap[p.createdById]) || '',
      })),
      summary: {
        total:             totalExpense + totalMerchandise,
        totalExpense,
        totalMerchandise,
        count:             payments.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

interface CreateVendorPaymentBody {
  storeId?: string | null;
  vendorId?: string | number | null;
  vendorName?: string | null;
  amount: string | number;
  paymentType: 'expense' | 'merchandise';
  tenderMethod?: string;
  notes?: string | null;
  paymentDate?: string | Date;
}

// ── POST /vendor-payments ─────────────────────────────────────────────────
export const createVendorPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const {
      storeId, vendorId, vendorName,
      amount, paymentType, tenderMethod, notes, paymentDate,
    } = req.body as CreateVendorPaymentBody;

    if (!amount || isNaN(parseFloat(String(amount))) || parseFloat(String(amount)) <= 0) {
      res.status(400).json({ success: false, error: 'Amount must be a positive number' });
      return;
    }
    if (!paymentType || !['expense', 'merchandise'].includes(paymentType)) {
      res.status(400).json({ success: false, error: 'paymentType must be expense or merchandise' });
      return;
    }

    const payment = await prisma.vendorPayment.create({
      data: {
        orgId,
        storeId:     storeId   || null,
        vendorId:    vendorId  ? parseInt(String(vendorId))   : null,
        vendorName:  vendorName || null,
        amount:      parseFloat(String(amount)),
        paymentType,
        tenderMethod: tenderMethod || 'cash',
        notes:       notes || null,
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        createdById: req.user!.id,
      },
    });

    res.status(201).json({ success: true, data: { ...payment, amount: Number(payment.amount) } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── PUT /vendor-payments/:id ──────────────────────────────────────────────
export const updateVendorPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const { id } = req.params;
    const { vendorId, vendorName, amount, paymentType, tenderMethod, notes, paymentDate } = req.body as Partial<CreateVendorPaymentBody>;

    const data: Prisma.VendorPaymentUpdateInput = {};
    if (vendorId      !== undefined) data.vendorId      = vendorId ? parseInt(String(vendorId)) : null;
    if (vendorName    !== undefined) data.vendorName    = vendorName || null;
    if (amount        !== undefined) data.amount        = parseFloat(String(amount));
    if (paymentType   !== undefined) data.paymentType   = paymentType;
    if (tenderMethod  !== undefined) data.tenderMethod  = tenderMethod;
    if (notes         !== undefined) data.notes         = notes || null;
    if (paymentDate   !== undefined) data.paymentDate   = new Date(paymentDate);

    const payment = await prisma.vendorPayment.update({
      where: { id, orgId },
      data,
    });

    res.json({ success: true, data: { ...payment, amount: Number(payment.amount) } });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'P2025') { res.status(404).json({ success: false, error: 'Payment not found' }); return; }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};
