/**
 * billingController.ts
 * Org-facing billing endpoints.
 * Protected routes require the `protect` middleware (req.user.orgId available).
 */

import type { Request, Response, NextFunction } from 'express';
import prisma from '../config/postgres.js';

// ── Public ────────────────────────────────────────────────────────────────────

/* GET /api/billing/plans */
export const getPublicPlans = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      where:   { isPublic: true, isActive: true },
      include: { addons: { where: { isActive: true }, orderBy: { label: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(plans);
  } catch (err) { next(err); }
};

// ── Protected (org users) ─────────────────────────────────────────────────────

/* GET /api/billing/subscription */
export const getMySubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.user!.orgId as string;
    const sub   = await prisma.orgSubscription.findUnique({
      where:   { orgId },
      include: { plan: { include: { addons: { where: { isActive: true } } } } },
    });
    res.json(sub || null);
  } catch (err) { next(err); }
};

/* GET /api/billing/invoices */
export const getMyInvoices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.user!.orgId as string;
    const sub   = await prisma.orgSubscription.findUnique({ where: { orgId } });
    if (!sub) { res.json([]); return; }

    const invoices = await prisma.billingInvoice.findMany({
      where:   { subscriptionId: sub.id },
      orderBy: { createdAt: 'desc' },
      take:    36,
    });
    res.json(invoices);
  } catch (err) { next(err); }
};

/* POST /api/billing/payment-method
   Body: { token, masked, method }  — CardPointe tokenized card/ACH */
export const savePaymentMethod = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.user!.orgId as string;
    const { token, masked, method } = req.body as {
      token?: string;
      masked?: string;
      method?: string;
    };
    if (!token || !masked) { res.status(400).json({ error: 'token and masked are required' }); return; }

    const sub = await prisma.orgSubscription.findUnique({ where: { orgId } });
    if (!sub) { res.status(404).json({ error: 'No subscription found for this org' }); return; }

    await prisma.orgSubscription.update({
      where: { orgId },
      data:  { paymentToken: token, paymentMasked: masked, paymentMethod: method || 'card' },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
};
