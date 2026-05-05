/**
 * Shift cash movements — drops + payouts.
 *
 * Handlers:
 *   addCashDrop     POST /pos-terminal/shift/:id/drop   — register pickup
 *   addPayout       POST /pos-terminal/shift/:id/payout — vendor payment from drawer
 *   listPayouts     GET  /pos-terminal/payouts          — back-office payout report
 *   listCashDrops   GET  /pos-terminal/cash-drops       — back-office drop report
 *
 * Important distinction:
 *   - Cash DROPS are pickups — money leaving the drawer (going to safe).
 *     They are NOT expenses and don't reduce P&L.
 *   - Cash PAYOUTS are real vendor disbursements — actual expense events.
 *
 * The EoD report and shift reconciliation track these separately so the
 * "drawer expectation" math credits drops as still-on-hand (just moved
 * from drawer → safe) but treats payouts as gone-from-drawer-permanently.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { nanoid } from 'nanoid';

import { getOrgId } from './helpers.js';
import {
  nextCashEventReference,
  prefixForCashDropType,
  prefixForPayoutType,
} from '../../services/cashEvent/reference.js';

// S77 (C9) — allowed CashDrop types:
//   'drop'    = legacy / default — money OUT of drawer to safe (pickup)
//   'paid_in' = NEW — money INTO drawer (petty cash refill, change drop)
const VALID_CASH_DROP_TYPES = ['drop', 'paid_in'] as const;

// S77 (C9) — allowed CashPayout payoutTypes:
//   'expense'              = vendor payout — money OUT (legacy)
//   'merchandise'          = vendor merchandise payment — money OUT (legacy)
//   'loan'                 = NEW — cashier/employee cash advance (money OUT)
//   'received_on_account'  = NEW — charge-account customer settling balance (money IN)
const VALID_PAYOUT_TYPES = ['expense', 'merchandise', 'loan', 'received_on_account'] as const;

// ── POST /shift/:id/drop ─────────────────────────────────────────────────
export const addCashDrop = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id }           = req.params;
    const body = (req.body || {}) as {
      amount?: number | string;
      note?: string | null;
      // S77 (C9) — type defaults to 'drop' for back-compat with existing
      // CashDrawerModal callers. New "Cash In" modal sends 'paid_in'.
      type?: string | null;
    };
    const { amount, note } = body;
    const type = body.type || 'drop';

    if (!amount || parseFloat(String(amount)) <= 0) { res.status(400).json({ error: 'amount must be > 0' }); return; }
    if (!(VALID_CASH_DROP_TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ error: `type must be one of: ${VALID_CASH_DROP_TYPES.join(', ')}` });
      return;
    }

    const shift = await prisma.shift.findFirst({ where: { id, orgId: orgId ?? undefined, status: 'open' } });
    if (!shift) { res.status(404).json({ error: 'Active shift not found' }); return; }

    // S77 (C9) — generate human-readable ref before create.
    const referenceNumber = await nextCashEventReference(
      orgId as string,
      prefixForCashDropType(type),
    );

    const drop = await prisma.cashDrop.create({
      data: {
        id:              nanoid(),
        orgId:           orgId as string,
        shiftId:         id,
        amount:          parseFloat(String(amount)),
        note:            note || null,
        type,
        referenceNumber,
        createdById:     req.user!.id,
      },
    });

    res.status(201).json({ ...drop, amount: Number(drop.amount) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── POST /shift/:id/payout ────────────────────────────────────────────────
export const addPayout = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const body = (req.body || {}) as {
      amount?: number | string;
      recipient?: string | null;
      note?: string | null;
      vendorId?: number | string | null;
      payoutType?: string | null;
      // S77 (C9) — link a Customer for received_on_account events.
      customerId?: string | null;
    };
    const { amount, recipient, note, vendorId, customerId } = body;
    const payoutType = body.payoutType || 'expense';

    if (!amount || parseFloat(String(amount)) <= 0) { res.status(400).json({ error: 'amount must be > 0' }); return; }
    if (!(VALID_PAYOUT_TYPES as readonly string[]).includes(payoutType)) {
      res.status(400).json({ error: `payoutType must be one of: ${VALID_PAYOUT_TYPES.join(', ')}` });
      return;
    }

    const shift = await prisma.shift.findFirst({ where: { id, orgId: orgId ?? undefined, status: 'open' } });
    if (!shift) { res.status(404).json({ error: 'Active shift not found' }); return; }

    // S77 (C9) — generate human-readable ref before create.
    const referenceNumber = await nextCashEventReference(
      orgId as string,
      prefixForPayoutType(payoutType),
    );

    const payout = await prisma.cashPayout.create({
      data: {
        id:              nanoid(),
        orgId:           orgId as string,
        shiftId:         id,
        amount:          parseFloat(String(amount)),
        recipient:       recipient || null,
        vendorId:        vendorId ? parseInt(String(vendorId)) : null,
        payoutType,
        customerId:      customerId || null,
        referenceNumber,
        note:            note || null,
        createdById:     req.user!.id,
      },
    });

    res.status(201).json({ ...payout, amount: Number(payout.amount) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── GET /payouts ──────────────────────────────────────────────────────────────
// List all payouts across shifts for back-office reporting
export const listPayouts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as {
      storeId?: string;
      dateFrom?: string;
      dateTo?: string;
      payoutType?: string;
      vendorId?: string;
      limit?: string;
    };
    const { storeId, dateFrom, dateTo, payoutType, vendorId } = q;
    const limit = q.limit || '100';

    const where: Prisma.CashPayoutWhereInput = { orgId: orgId ?? undefined };
    // CashPayout has no direct storeId column — scope via the parent Shift
    if (storeId)    where.shift      = { storeId };
    if (payoutType) where.payoutType = payoutType;
    if (vendorId)   where.vendorId   = parseInt(vendorId);
    if (dateFrom || dateTo) {
      const range: Prisma.DateTimeFilter = {};
      if (dateFrom) { const d = new Date(dateFrom); range.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
      if (dateTo)   { const d = new Date(dateTo);   range.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
      where.createdAt = range;
    }

    const payouts = await prisma.cashPayout.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit) || 100, 500),
      include: { shift: { select: { storeId: true } } },
    });
    type PayoutRow = (typeof payouts)[number];

    // Resolve cashier names
    const userIds = [...new Set(payouts.map((p: PayoutRow) => p.createdById).filter((x: string | null) => Boolean(x)) as string[])];
    interface UserRow { id: string; name: string }
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const userMap = Object.fromEntries(users.map((u: UserRow) => [u.id, u.name]));

    // Bug B4 fix: summary treats ONLY cash payouts (which are real expenses
    // out of the drawer) as expenses. Cash drops (register pickups) are a
    // separate movement — they do NOT count as expenses and are shown in
    // their own endpoint (/cash-drops). The EoD report presents both
    // separately.
    const totalExpense     = (payouts as PayoutRow[]).filter((p) => p.payoutType !== 'merchandise').reduce((s, p) => s + Number(p.amount), 0);
    const totalMerchandise = (payouts as PayoutRow[]).filter((p) => p.payoutType === 'merchandise').reduce((s, p) => s + Number(p.amount), 0);

    res.json({
      payouts: (payouts as PayoutRow[]).map((p) => ({
        ...p,
        amount:       Number(p.amount),
        cashierName:  userMap[p.createdById] || '',
        storeId:      p.shift?.storeId || storeId,
        shift:        undefined,
      })),
      summary: {
        total:            totalExpense + totalMerchandise,
        totalExpense,
        totalMerchandise,
        count:            payouts.length,
        // Explicit clarification: cash drops are NOT included here
        note: 'Summary includes only cash payouts (expenses + merchandise). Cash drops/pickups are separate — see /cash-drops.',
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── GET /cash-drops ───────────────────────────────────────────────────────────
export const listCashDrops = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as {
      storeId?: string;
      dateFrom?: string;
      dateTo?: string;
      limit?: string;
    };
    const { storeId, dateFrom, dateTo } = q;
    const limit = q.limit || '100';

    const where: Prisma.CashDropWhereInput = { orgId: orgId ?? undefined };
    // CashDrop has no direct storeId column — scope via the parent Shift
    if (storeId) where.shift = { storeId };
    if (dateFrom || dateTo) {
      const range: Prisma.DateTimeFilter = {};
      if (dateFrom) { const d = new Date(dateFrom); range.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
      if (dateTo)   { const d = new Date(dateTo);   range.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
      where.createdAt = range;
    }

    const drops = await prisma.cashDrop.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit) || 100, 500),
    });
    type DropRow = (typeof drops)[number];

    const userIds = [...new Set(drops.map((d: DropRow) => d.createdById).filter((x: string | null) => Boolean(x)) as string[])];
    interface UserRow { id: string; name: string }
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const userMap = Object.fromEntries(users.map((u: UserRow) => [u.id, u.name]));

    res.json({
      drops: (drops as DropRow[]).map((d) => ({ ...d, amount: Number(d.amount), cashierName: userMap[d.createdById] || '' })),
      summary: { total: (drops as DropRow[]).reduce((s, d) => s + Number(d.amount), 0), count: drops.length },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};
