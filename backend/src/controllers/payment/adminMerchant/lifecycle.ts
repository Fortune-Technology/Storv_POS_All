/**
 * Admin merchant — lifecycle handlers (activate, disable, test) + audit log.
 *
 * Separated from CRUD because these don't change the merchant's data shape —
 * they just transition `status` and log forensic events. Each one has a
 * specific rule the admin can't bypass:
 *
 *   activate → must have passed a test in the last 24h
 *   disable  → no gate (kill-switch by design)
 *   test     → live ping against Dejavoo, updates lastTestedAt + lastTestResult
 */

import type { Request, Response } from 'express';
import prisma from '../../../config/postgres.js';
import { decrypt } from '../../../utils/cryptoVault.js';
import {
  checkTerminalStatus,
  type DecryptedPaymentMerchant,
} from '../../../services/paymentProviderFactory.js';
import { logMerchantAudit } from '../../../services/paymentMerchantAudit.js';
import { sanitize } from './helpers.js';

/**
 * POST /api/admin/payment-merchants/:id/activate
 *
 * Lifts status `pending` → `active`. Gated on a successful test in the last
 * 24 hours — protects against admin clicking Activate on credentials they
 * never verified.
 */
export const activatePaymentMerchant = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }

    const tested = existing.lastTestedAt && existing.lastTestResult === 'ok';
    const recentTest = tested && (Date.now() - new Date(existing.lastTestedAt as Date).getTime()) < 24 * 60 * 60 * 1000;
    if (!recentTest) {
      res.status(400).json({
        success: false,
        error: 'Run a successful Test within the last 24 hours before activating this merchant.',
      });
      return;
    }

    const merchant = await prisma.paymentMerchant.update({
      where: { id: req.params.id },
      data: { status: 'active', updatedById: req.user?.id || null },
    });

    logMerchantAudit({
      merchantId: merchant.id,
      action:     'activated',
      user:       req.user,
      note:       'Merchant activated for live processing',
    });

    res.json({ success: true, merchant: sanitize(merchant as unknown as Record<string, unknown>) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[activatePaymentMerchant]', err);
    res.status(500).json({ success: false, error: message });
  }
};

/**
 * POST /api/admin/payment-merchants/:id/disable
 *
 * Kill-switch — sets status to `disabled`. No gate. The optional reason is
 * captured in the audit log.
 */
export const disablePaymentMerchant = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }

    const merchant = await prisma.paymentMerchant.update({
      where: { id: req.params.id },
      data: { status: 'disabled', updatedById: req.user?.id || null },
    });

    logMerchantAudit({
      merchantId: merchant.id,
      action:     'disabled',
      user:       req.user,
      note:       (req.body as { reason?: string })?.reason || 'Merchant disabled by admin',
    });

    res.json({ success: true, merchant: sanitize(merchant as unknown as Record<string, unknown>) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[disablePaymentMerchant]', err);
    res.status(500).json({ success: false, error: message });
  }
};

/**
 * GET /api/admin/payment-merchants/:id/audit
 *
 * Returns the most recent 100 audit log entries for the merchant. Diff
 * details NEVER include plaintext secrets — they only show `{set: true}` or
 * `{changed: true}` markers when a credential field changed.
 */
export const getPaymentMerchantAudit = async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantId = req.params.id;
    const entries = await prisma.paymentMerchantAudit.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, entries });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[getPaymentMerchantAudit]', err);
    res.status(500).json({ success: false, error: message });
  }
};

/**
 * POST /api/admin/payment-merchants/:id/test
 *
 * Two-step diagnostic: presence check first, then a live ping. Updates the
 * merchant's `lastTestedAt` + `lastTestResult` either way. Returns the
 * (sanitized) merchant so the UI can refresh the row state in one round-trip.
 */
export const testPaymentMerchant = async (req: Request, res: Response): Promise<void> => {
  try {
    const merchant = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!merchant) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }

    // Step 1: credential presence check — short-circuit if anything's missing
    const missing: string[] = [];
    if (merchant.provider === 'dejavoo') {
      if (!merchant.spinTpn)     missing.push('spinTpn');
      if (!merchant.spinAuthKey) missing.push('spinAuthKey');
    }

    if (missing.length) {
      const result = `Missing required credentials: ${missing.join(', ')}`;
      const updated = await prisma.paymentMerchant.update({
        where: { id: merchant.id },
        data: { lastTestedAt: new Date(), lastTestResult: result },
      });
      logMerchantAudit({
        merchantId: merchant.id,
        action:     'tested',
        user:       req.user,
        note:       `Test failed — ${result}`,
      });
      res.json({ success: false, result, merchant: sanitize(updated as unknown as Record<string, unknown>) });
      return;
    }

    // Step 2: live terminal ping. Auth key is decrypted into memory just
    // for the outbound call; nothing about the plaintext is persisted.
    let liveResult = 'ok';
    let connected = false;
    try {
      const decrypted = {
        ...merchant,
        spinAuthKey: merchant.spinAuthKey ? decrypt(merchant.spinAuthKey) : null,
      } as unknown as DecryptedPaymentMerchant;
      const status = await checkTerminalStatus(decrypted) as { connected?: boolean; message?: string };
      connected = !!status.connected;
      liveResult = status.connected ? 'ok' : (status.message || 'Terminal not reachable');
    } catch (err) {
      liveResult = err instanceof Error ? err.message : 'Terminal test failed';
    }

    const updated = await prisma.paymentMerchant.update({
      where: { id: merchant.id },
      data: { lastTestedAt: new Date(), lastTestResult: liveResult },
    });

    logMerchantAudit({
      merchantId: merchant.id,
      action:     'tested',
      user:       req.user,
      note:       connected ? 'Terminal test passed' : `Test failed — ${liveResult}`,
    });

    res.json({
      success:  connected,
      result:   liveResult,
      merchant: sanitize(updated as unknown as Record<string, unknown>),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[testPaymentMerchant]', err);
    res.status(500).json({ success: false, error: message });
  }
};
