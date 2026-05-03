/**
 * Vendor Credit Controller
 *
 * Tracks free-case receipts, mix-and-match bonuses, damaged-goods allowances,
 * and other non-cash credits from vendors. Distinct from VendorPayment
 * (cash going OUT) — credits are value coming IN without charge.
 *
 * Routes (mounted under /api/catalog):
 *   GET    /vendor-credits          → listVendorCredits
 *   POST   /vendor-credits          → createVendorCredit
 *   PUT    /vendor-credits/:id      → updateVendorCredit
 *   DELETE /vendor-credits/:id      → deleteVendorCredit
 */

import type { Request, Response } from 'express';
import prisma from '../config/postgres.js';
import { errMsg, errCode } from '../utils/typeHelpers.js';

const getOrgId = (req: Request): string | undefined => req.orgId || req.user?.orgId || undefined;

const VALID_TYPES = ['free_case', 'mix_match', 'damaged_return', 'adjustment', 'other'];

// ── GET /vendor-credits ───────────────────────────────────────────────────
export const listVendorCredits = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const {
      storeId, dateFrom, dateTo, creditType, vendorId, limit = 200,
    } = req.query;

    const where: Record<string, unknown> = { orgId };
    if (storeId)    where.storeId    = storeId;
    if (creditType) where.creditType = creditType;
    if (vendorId)   where.vendorId   = parseInt(vendorId as string);

    if (dateFrom || dateTo) {
      const range: Record<string, Date> = {};
      if (dateFrom) {
        const d = new Date(dateFrom as string);
        range.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      }
      if (dateTo) {
        const d = new Date(dateTo as string);
        range.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      }
      where.creditDate = range;
    }

    type CreditRow = {
      id: string;
      creditType: string | null;
      amount: number | string;
      casesReceived: number | null;
      createdById: string | null;
      creditDate: Date;
      [k: string]: unknown;
    };
    const credits = (await prisma.vendorCredit.findMany({
      where,
      orderBy: { creditDate: 'desc' },
      take: Math.min(parseInt(limit as string) || 200, 1000),
    })) as CreditRow[];

    // Resolve creator names for UI display
    const userIds = [...new Set(credits.map((c) => c.createdById).filter(Boolean))] as string[];
    type UserRow = { id: string; name: string | null };
    const users = userIds.length
      ? ((await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })) as UserRow[])
      : [];
    const userMap: Record<string, string> = Object.fromEntries(users.map((u) => [u.id, u.name || '']));

    // Summary totals — grouped by creditType so the UI can show a breakdown
    const byType: Record<string, number> = {};
    let totalValue = 0;
    let totalCases = 0;
    for (const c of credits) {
      const amt = Number(c.amount);
      totalValue += amt;
      totalCases += c.casesReceived || 0;
      const t = c.creditType || 'other';
      byType[t] = (byType[t] || 0) + amt;
    }

    // Current-month total (per Q2 — monthly totals shown on vendor detail)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthTotal = credits
      .filter((c) => new Date(c.creditDate) >= monthStart)
      .reduce((s, c) => s + Number(c.amount), 0);

    res.json({
      success: true,
      credits: credits.map((c) => ({
        ...c,
        amount: Number(c.amount),
        createdByName: c.createdById ? userMap[c.createdById] || '' : '',
      })),
      summary: {
        total: totalValue,
        monthTotal,
        count: credits.length,
        totalCases,
        byType,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ── POST /vendor-credits ──────────────────────────────────────────────────
export const createVendorCredit = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authorized' });
      return;
    }
    const {
      storeId, vendorId, vendorName,
      amount, creditType, reason, casesReceived, productRef, notes, creditDate,
    } = req.body;

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      res.status(400).json({ success: false, error: 'Amount must be a positive number' });
      return;
    }
    if (creditType && !VALID_TYPES.includes(creditType)) {
      res.status(400).json({ success: false, error: `creditType must be one of: ${VALID_TYPES.join(', ')}` });
      return;
    }

    const credit = await prisma.vendorCredit.create({
      data: {
        orgId,
        storeId:        storeId  || null,
        vendorId:       vendorId ? parseInt(vendorId) : null,
        vendorName:     vendorName || null,
        amount:         parseFloat(amount),
        creditType:     creditType || 'free_case',
        reason:         reason || null,
        casesReceived:  casesReceived != null && casesReceived !== '' ? parseInt(casesReceived) : null,
        productRef:     productRef || null,
        notes:          notes || null,
        creditDate:     creditDate ? new Date(creditDate) : new Date(),
        createdById:    req.user.id,
      },
    });

    res.status(201).json({ success: true, data: { ...credit, amount: Number(credit.amount) } });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ── PUT /vendor-credits/:id ───────────────────────────────────────────────
export const updateVendorCredit = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const {
      vendorId, vendorName, amount, creditType, reason,
      casesReceived, productRef, notes, creditDate,
    } = req.body;

    const data: Record<string, unknown> = {};
    if (vendorId       !== undefined) data.vendorId      = vendorId ? parseInt(vendorId) : null;
    if (vendorName     !== undefined) data.vendorName    = vendorName || null;
    if (amount         !== undefined) data.amount        = parseFloat(amount);
    if (creditType     !== undefined) {
      if (!VALID_TYPES.includes(creditType)) {
        res.status(400).json({ success: false, error: `creditType must be one of: ${VALID_TYPES.join(', ')}` });
        return;
      }
      data.creditType = creditType;
    }
    if (reason         !== undefined) data.reason        = reason || null;
    if (casesReceived  !== undefined) data.casesReceived = casesReceived !== '' && casesReceived != null ? parseInt(casesReceived) : null;
    if (productRef     !== undefined) data.productRef    = productRef || null;
    if (notes          !== undefined) data.notes         = notes || null;
    if (creditDate     !== undefined) data.creditDate    = new Date(creditDate);

    const credit = await prisma.vendorCredit.update({
      where: { id, orgId },
      data,
    });

    res.json({ success: true, data: { ...credit, amount: Number(credit.amount) } });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Credit not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ── DELETE /vendor-credits/:id ────────────────────────────────────────────
export const deleteVendorCredit = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    await prisma.vendorCredit.delete({ where: { id, orgId } });
    res.json({ success: true });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Credit not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};
