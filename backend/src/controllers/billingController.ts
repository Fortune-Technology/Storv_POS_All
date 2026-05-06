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

// ─────────────────────────────────────────────────
// S80 Phase 3 — per-store subscriptions
// One subscription per store. Org owner can list/manage every sub for their org.
// ─────────────────────────────────────────────────

/* GET /api/billing/store-subscriptions
   Lists every store's subscription for the active org. */
export const listMyStoreSubscriptions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    if (!orgId) { res.status(400).json({ error: 'No active org.' }); return; }

    const subs = await (prisma as any).storeSubscription.findMany({
      where: { orgId },
      include: {
        store: { select: { id: true, name: true, isActive: true } },
        plan: { include: { addons: { where: { isActive: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Surface a clean per-row view + computed monthly cost
    const rows = subs.map((s: any) => {
      const purchased: string[] = Array.isArray(s.extraAddons) ? s.extraAddons : [];
      const purchasedAddons = (s.plan?.addons || []).filter((a: any) => purchased.includes(a.key));
      const baseCost = Number(s.basePriceOverride ?? s.plan?.basePrice ?? 0);
      const addonsCost = purchasedAddons.reduce((acc: number, a: any) => acc + Number(a.price || 0), 0);
      return {
        id: s.id,
        storeId: s.storeId,
        storeName: s.store?.name || '',
        storeActive: !!s.store?.isActive,
        plan: s.plan ? {
          id: s.plan.id, slug: s.plan.slug, name: s.plan.name,
          basePrice: Number(s.plan.basePrice ?? 0),
          tagline: s.plan.tagline,
        } : null,
        availableAddons: (s.plan?.addons || []).map((a: any) => ({
          key: a.key, label: a.label, price: Number(a.price || 0),
          description: a.description, moduleKeys: a.moduleKeys || [],
        })),
        purchasedAddons: purchasedAddons.map((a: any) => a.key),
        status: s.status,
        trialEndsAt: s.trialEndsAt,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        registerCount: s.registerCount,
        monthlyTotal: Number((baseCost + addonsCost).toFixed(2)),
      };
    });

    res.json({ subscriptions: rows });
  } catch (err) { next(err); }
};

/* PUT /api/billing/store-subscriptions/:storeId
   Body: { planSlug?, addonKeys? }
   Org admins can change plan + toggle addons for any store in their org. */
export const updateStoreSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const { storeId } = req.params;
    const { planSlug, addonKeys } = req.body as { planSlug?: string; addonKeys?: string[] };

    if (!orgId) { res.status(400).json({ error: 'No active org.' }); return; }
    if (!storeId) { res.status(400).json({ error: 'storeId required.' }); return; }

    // Verify the store belongs to the active org (and optionally that the
    // caller has org-scope edit perms — we delegate to the route guard).
    const store = await prisma.store.findFirst({ where: { id: storeId, orgId } });
    if (!store) { res.status(404).json({ error: 'Store not found in this org.' }); return; }

    const sub = await (prisma as any).storeSubscription.findUnique({
      where: { storeId },
      include: { plan: { include: { addons: { where: { isActive: true } } } } },
    });
    if (!sub) { res.status(404).json({ error: 'No subscription for this store.' }); return; }

    const data: any = {};
    let planForAddonValidation = sub.plan;

    // Plan switch (by slug for human-readable input)
    if (planSlug && planSlug !== sub.plan?.slug) {
      const newPlan = await prisma.subscriptionPlan.findFirst({
        where: { slug: planSlug, isActive: true },
        include: { addons: { where: { isActive: true } } },
      });
      if (!newPlan) { res.status(400).json({ error: `Plan '${planSlug}' not found or inactive.` }); return; }
      data.planId = newPlan.id;
      planForAddonValidation = newPlan;
      // When switching plans, reset addons to the intersection of caller-
      // requested keys and the new plan's addon catalog (or [] if none given).
      // This avoids carrying over orphaned addon keys.
      const newAddonKeys = Array.isArray(addonKeys) ? addonKeys : [];
      const validKeys = new Set(newPlan.addons.map((a: any) => a.key));
      data.extraAddons = newAddonKeys.filter(k => validKeys.has(k));
    } else if (Array.isArray(addonKeys)) {
      // Pure addon update on same plan
      const validKeys = new Set((planForAddonValidation?.addons || []).map((a: any) => a.key));
      data.extraAddons = addonKeys.filter(k => validKeys.has(k));
    }

    if (Object.keys(data).length === 0) {
      res.json({ ok: true, unchanged: true });
      return;
    }

    await (prisma as any).storeSubscription.update({
      where: { storeId },
      data,
    });

    res.json({ ok: true, ...data });
  } catch (err) { next(err); }
};

/* GET /api/billing/store-invoices?storeId=...
   Lists invoices for a single store's subscription (S80 Phase 3b). */
export const listMyStoreInvoices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const storeId = req.query.storeId as string | undefined;
    if (!orgId || !storeId) { res.status(400).json({ error: 'orgId + storeId required.' }); return; }

    // Verify the store belongs to the active org
    const store = await prisma.store.findFirst({ where: { id: storeId, orgId } });
    if (!store) { res.status(404).json({ error: 'Store not found in this org.' }); return; }

    // Find this store's subscription, then list its invoices via raw SQL
    // (typed client may not yet know about storeSubscriptionId).
    const sub: any = await (prisma as any).storeSubscription.findUnique({
      where: { storeId },
      select: { id: true },
    });
    if (!sub) { res.json([]); return; }

    const invoices: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "invoiceNumber", "periodStart", "periodEnd",
              "baseAmount", "discountAmount", "totalAmount",
              status, "paidAt", "createdAt", notes
         FROM billing_invoices
        WHERE "storeSubscriptionId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 36`,
      sub.id,
    );
    res.json(invoices);
  } catch (err) { next(err); }
};
