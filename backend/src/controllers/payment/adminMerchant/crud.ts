/**
 * Admin merchant — CRUD handlers (list, get, create, update, delete).
 *
 * Lifecycle actions (activate / disable / test / audit log) live in
 * ./lifecycle.ts to keep this file focused on the basic resource shape.
 *
 * All routes require superadmin (mounted under /api/admin/payment-merchants
 * with the `authorize('superadmin')` middleware in adminRoutes).
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../../config/postgres.js';
import { logMerchantAudit, buildChangeDiff } from '../../../services/paymentMerchantAudit.js';
import { sanitize, buildWriteData } from './helpers.js';

/** GET /api/admin/payment-merchants */
export const listPaymentMerchants = async (req: Request, res: Response): Promise<void> => {
  try {
    const { orgId, storeId, provider } = req.query as { orgId?: string; storeId?: string; provider?: string };
    const where: Prisma.PaymentMerchantWhereInput = {};
    if (orgId)    where.orgId    = orgId;
    if (storeId)  where.storeId  = storeId;
    if (provider) where.provider = provider;

    const rows = await prisma.paymentMerchant.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });

    type MerchantRow = (typeof rows)[number];
    // Join store + org names for UI display
    const storeIds = Array.from(new Set(rows.map((r: MerchantRow) => r.storeId)));
    const orgIds   = Array.from(new Set(rows.map((r: MerchantRow) => r.orgId)));
    const [stores, orgs] = await Promise.all([
      prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } }),
      prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }),
    ]);
    const storeMap: Record<string, { id: string; name: string }> = Object.fromEntries(
      stores.map((s: { id: string; name: string }) => [s.id, s]),
    );
    const orgMap: Record<string, { id: string; name: string }> = Object.fromEntries(
      orgs.map((o: { id: string; name: string }) => [o.id, o]),
    );

    const merchants = rows.map((r: MerchantRow) => ({
      ...sanitize(r as unknown as Record<string, unknown>),
      storeName: storeMap[r.storeId]?.name || null,
      orgName:   orgMap[r.orgId]?.name     || null,
    }));

    res.json({ success: true, merchants });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[listPaymentMerchants]', err);
    res.status(500).json({ success: false, error: message });
  }
};

/** GET /api/admin/payment-merchants/:id */
export const getPaymentMerchant = async (req: Request, res: Response): Promise<void> => {
  try {
    const merchant = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!merchant) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }
    res.json({ success: true, merchant: sanitize(merchant as unknown as Record<string, unknown>) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[getPaymentMerchant]', err);
    res.status(500).json({ success: false, error: message });
  }
};

/**
 * POST /api/admin/payment-merchants
 *
 * Activation workflow: new merchants always start as `pending`, regardless
 * of what the admin form submitted, until a successful `test` lifts them to
 * `active`. This is enforced server-side so the form can't skip it.
 */
export const createPaymentMerchant = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const orgId = body.orgId as string | undefined;
    const storeId = body.storeId as string | undefined;
    if (!orgId || !storeId) {
      res.status(400).json({ success: false, error: 'orgId and storeId are required' });
      return;
    }

    const store = await prisma.store.findFirst({ where: { id: storeId, orgId } });
    if (!store) { res.status(400).json({ success: false, error: 'Store not found for this organization' }); return; }

    const existing = await prisma.paymentMerchant.findUnique({ where: { storeId } });
    if (existing) {
      res.status(409).json({
        success: false,
        error: 'This store already has a payment merchant configured — edit the existing one.',
      });
      return;
    }

    const data = buildWriteData(body);
    data.orgId = orgId;
    data.storeId = storeId;
    data.updatedById = req.user?.id || null;
    if (!data.status || data.status === 'active') data.status = 'pending';

    const merchant = await prisma.paymentMerchant.create({
      data: data as Prisma.PaymentMerchantUncheckedCreateInput,
    });

    // Audit (non-blocking)
    logMerchantAudit({
      merchantId: merchant.id,
      action:     'created',
      user:       req.user,
      note:       `New merchant for store ${store.name || storeId}`,
      changes: {
        provider:    { from: null, to: merchant.provider },
        environment: { from: null, to: merchant.environment },
        status:      { from: null, to: merchant.status },
        spinTpn:     { changed: true, wasSet: false, isSet: !!merchant.spinTpn },
        spinAuthKey: { changed: true, wasSet: false, isSet: !!merchant.spinAuthKey },
      },
    });

    res.status(201).json({ success: true, merchant: sanitize(merchant as unknown as Record<string, unknown>) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[createPaymentMerchant]', err);
    res.status(500).json({ success: false, error: message });
  }
};

/**
 * PUT /api/admin/payment-merchants/:id
 *
 * Re-test gate: changing TPN, AuthKey, environment, or base URL on an
 * active merchant drops it back to `pending` and clears the last test
 * result. Forces a fresh test before live processing resumes — protects
 * against an admin pasting bad credentials and sending a card sale through
 * before catching the typo.
 */
export const updatePaymentMerchant = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }

    const data = buildWriteData(req.body as Record<string, unknown>);
    data.updatedById = req.user?.id || null;

    const sensitiveChanged =
      (data.spinTpn !== undefined && data.spinTpn !== existing.spinTpn) ||
      (data.spinAuthKey !== undefined) ||
      (data.environment !== undefined && data.environment !== existing.environment) ||
      (data.spinBaseUrl !== undefined && data.spinBaseUrl !== existing.spinBaseUrl);

    if (sensitiveChanged && existing.status === 'active') {
      data.status         = 'pending';
      data.lastTestedAt   = null;
      data.lastTestResult = 'Credentials changed — must be re-tested before processing';
    }

    const merchant = await prisma.paymentMerchant.update({
      where: { id: req.params.id },
      data: data as Prisma.PaymentMerchantUncheckedUpdateInput,
    });

    // Audit (non-blocking) — safe diff only, no plaintext secrets
    const diff = buildChangeDiff(
      existing as unknown as Record<string, unknown>,
      { ...(existing as unknown as Record<string, unknown>), ...data },
    );
    if (diff) {
      logMerchantAudit({
        merchantId: merchant.id,
        action:     sensitiveChanged && data.status === 'pending' ? 'updated-deactivated' : 'updated',
        user:       req.user,
        changes:    diff,
        note:       sensitiveChanged ? 'Sensitive credentials changed — status reset to pending' : null,
      });
    }

    res.json({ success: true, merchant: sanitize(merchant as unknown as Record<string, unknown>) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[updatePaymentMerchant]', err);
    res.status(500).json({ success: false, error: message });
  }
};

/** DELETE /api/admin/payment-merchants/:id */
export const deletePaymentMerchant = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }

    // Audit BEFORE delete (so we have a record even if the row is gone)
    logMerchantAudit({
      merchantId: existing.id,
      action:     'deleted',
      user:       req.user,
      note:       `Merchant removed for store ${existing.storeId}`,
    });

    await prisma.paymentMerchant.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[deletePaymentMerchant]', err);
    res.status(500).json({ success: false, error: message });
  }
};
