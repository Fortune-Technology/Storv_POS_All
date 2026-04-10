/**
 * billingController.js
 * Org-facing billing endpoints.
 * Protected routes require the `protect` middleware (req.user.orgId available).
 */

import prisma from '../config/postgres.js';

// ── Public ────────────────────────────────────────────────────────────────────

/* GET /api/billing/plans */
export const getPublicPlans = async (req, res, next) => {
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
export const getMySubscription = async (req, res, next) => {
  try {
    const orgId = req.user.orgId;
    const sub   = await prisma.orgSubscription.findUnique({
      where:   { orgId },
      include: { plan: { include: { addons: { where: { isActive: true } } } } },
    });
    res.json(sub || null);
  } catch (err) { next(err); }
};

/* GET /api/billing/invoices */
export const getMyInvoices = async (req, res, next) => {
  try {
    const orgId = req.user.orgId;
    const sub   = await prisma.orgSubscription.findUnique({ where: { orgId } });
    if (!sub) return res.json([]);

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
export const savePaymentMethod = async (req, res, next) => {
  try {
    const orgId = req.user.orgId;
    const { token, masked, method } = req.body;
    if (!token || !masked) return res.status(400).json({ error: 'token and masked are required' });

    const sub = await prisma.orgSubscription.findUnique({ where: { orgId } });
    if (!sub) return res.status(404).json({ error: 'No subscription found for this org' });

    await prisma.orgSubscription.update({
      where: { orgId },
      data:  { paymentToken: token, paymentMasked: masked, paymentMethod: method || 'card' },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
};
