/**
 * POS SPIn — cashier-side merchant setup (GET + PATCH).
 *
 * Lets the cashier-app's Hardware Settings modal read + update the active
 * store's Dejavoo SPIn credentials WITHOUT going through the admin panel.
 *
 * The existing admin endpoints (under /api/admin/payment-merchants) require
 * superadmin and target an arbitrary merchant by id. These endpoints are
 * scoped to `req.storeId` (set by the X-Store-Id header from station context)
 * and gated to admin/superadmin via `authorize()` in the route file. The
 * Hardware Settings modal additionally re-prompts for admin email + password
 * before showing the form — that's the user-facing security boundary.
 *
 * Reuses the same `buildWriteData` (trim + encrypt) and `sanitize` (mask
 * secrets in response) helpers as the admin path so encryption semantics +
 * "credentials changed → status=pending" gate stay identical.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../../config/postgres.js';
import { logMerchantAudit, buildChangeDiff } from '../../../services/paymentMerchantAudit.js';
import { sanitize, buildWriteData } from '../adminMerchant/helpers.js';
import { getOrgId, getStoreId } from './helpers.js';

/**
 * GET /api/payment/dejavoo/merchant-setup
 *
 * Returns the active store's full merchant config (with secrets masked) so
 * the modal can pre-populate fields. When no merchant exists yet for the
 * store, returns `{ configured: false }` with empty defaults so the form
 * renders cleanly.
 */
export const dejavooGetMerchantSetup = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) {
      res.status(400).json({ success: false, error: 'No active store — set X-Store-Id header.' });
      return;
    }

    const merchant = await prisma.paymentMerchant.findUnique({ where: { storeId } });

    if (!merchant) {
      res.json({
        success:    true,
        configured: false,
        merchant: {
          provider:        'dejavoo',
          environment:     'production',
          status:          'pending',
          spinTpn:         '',
          spinRegisterId:  '',
          spinBaseUrl:     '',
          ebtEnabled:      false,
          debitEnabled:    true,
          spinAuthKeySet:     false,
          spinAuthKeyPreview: '',
        },
      });
      return;
    }

    res.json({
      success:    true,
      configured: true,
      merchant:   sanitize(merchant as unknown as Record<string, unknown>),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[dejavooGetMerchantSetup]', err);
    res.status(500).json({ success: false, error: message });
  }
};

/**
 * PATCH /api/payment/dejavoo/merchant-setup
 *
 * Upserts the active store's merchant row from the cashier-app modal.
 * Body accepts: spinTpn, spinAuthKey, spinRegisterId, spinBaseUrl,
 *               environment, ebtEnabled, debitEnabled.
 *
 * - First-time save creates the row in `pending` status.
 * - Subsequent saves that touch TPN / auth key / env / base URL on an
 *   `active` merchant drop it back to `pending` (matches admin behavior).
 * - Audit log entry written via `logMerchantAudit`.
 */
export const dejavooSaveMerchantSetup = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStoreId(req);
    if (!orgId || !storeId) {
      res.status(400).json({ success: false, error: 'orgId + storeId required.' });
      return;
    }

    // Confirm the store really belongs to this org (defense-in-depth)
    const store = await prisma.store.findFirst({ where: { id: storeId, orgId } });
    if (!store) {
      res.status(403).json({ success: false, error: 'Store does not belong to this organization.' });
      return;
    }

    const data = buildWriteData(req.body as Record<string, unknown>);
    // Always force scope — body can't redirect to a different org/store
    data.orgId   = orgId;
    data.storeId = storeId;
    if (!data.provider) data.provider = 'dejavoo';
    data.updatedById = req.user?.id || null;

    const existing = await prisma.paymentMerchant.findUnique({ where: { storeId } });

    if (!existing) {
      // First-time save — create new merchant in pending status
      data.status = 'pending';
      const merchant = await prisma.paymentMerchant.create({
        data: data as Prisma.PaymentMerchantUncheckedCreateInput,
      });
      logMerchantAudit({
        merchantId: merchant.id,
        action:     'created',
        user:       req.user,
        note:       `Merchant created via cashier-app Hardware Settings for store ${store.name || storeId}`,
        changes: {
          provider:    { from: null, to: merchant.provider },
          environment: { from: null, to: merchant.environment },
          status:      { from: null, to: merchant.status },
          spinTpn:     { changed: true, wasSet: false, isSet: !!merchant.spinTpn },
          spinAuthKey: { changed: true, wasSet: false, isSet: !!merchant.spinAuthKey },
        },
      });
      res.status(201).json({
        success:  true,
        merchant: sanitize(merchant as unknown as Record<string, unknown>),
      });
      return;
    }

    // Update existing — re-test gate when sensitive credentials change
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
      where: { id: existing.id },
      data: data as Prisma.PaymentMerchantUncheckedUpdateInput,
    });

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
        note:       sensitiveChanged
          ? 'Sensitive credentials changed via cashier-app — status reset to pending'
          : 'Updated via cashier-app Hardware Settings',
      });
    }

    res.json({
      success:  true,
      merchant: sanitize(merchant as unknown as Record<string, unknown>),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[dejavooSaveMerchantSetup]', err);
    res.status(500).json({ success: false, error: message });
  }
};
