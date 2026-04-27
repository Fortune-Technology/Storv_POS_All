/**
 * POS SPIn — read-only merchant-status endpoint for the portal.
 *
 * Returns a NON-credentialed view of the merchant's configuration so the
 * portal's Payment Settings page can show what's wired up without exposing
 * secrets. Plain-text response — no decryption.
 */

import type { Request, Response } from 'express';
import prisma from '../../../config/postgres.js';
import { getStoreId } from './helpers.js';

/**
 * GET /api/payment/dejavoo/merchant-status
 *
 * Returns:
 *   { success, configured: false }                     ← no merchant for this store
 *   { success, configured: true, provider, env, status, ebtEnabled, debitEnabled,
 *     hasTpn, lastTestedAt, lastTestResult, updatedAt }
 *
 * `hasTpn: true` only confirms a TPN exists — it doesn't return the value.
 */
export const dejavooMerchantStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) {
      // No active store on the calling page — return a friendly empty state
      // instead of 400. The portal's PaymentSettings page polls this on
      // every render; bouncing 400 spams the console + DevTools network
      // tab without telling the user anything actionable.
      res.json({
        success:    true,
        configured: false,
        reason:     'no_active_store',
      });
      return;
    }

    const merchant = await prisma.paymentMerchant.findUnique({
      where: { storeId },
      select: {
        provider:       true,
        environment:    true,
        status:         true,
        ebtEnabled:     true,
        debitEnabled:   true,
        spinTpn:        true,
        lastTestedAt:   true,
        lastTestResult: true,
        updatedAt:      true,
      },
    });

    if (!merchant) {
      res.json({ success: true, configured: false });
      return;
    }

    res.json({
      success:        true,
      configured:     true,
      provider:       merchant.provider,
      environment:    merchant.environment,
      status:         merchant.status,
      ebtEnabled:     merchant.ebtEnabled,
      debitEnabled:   merchant.debitEnabled,
      hasTpn:         !!merchant.spinTpn,    // boolean only — never the actual value
      lastTestedAt:   merchant.lastTestedAt,
      lastTestResult: merchant.lastTestResult,
      updatedAt:      merchant.updatedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[dejavooMerchantStatus]', err);
    res.status(500).json({ success: false, error: message });
  }
};
