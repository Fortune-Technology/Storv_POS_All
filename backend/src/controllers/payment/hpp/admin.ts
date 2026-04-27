/**
 * HPP — admin-only endpoints for managing the per-store webhook secret.
 *
 *   POST /api/admin/payment-merchants/:id/regenerate-hpp-secret
 *     Generate a fresh random webhook secret. Returns it ONCE in the
 *     response body — admin pastes it (and the resulting URL) into the
 *     iPOSpays portal for that merchant's HPP product.
 *
 *   GET /api/admin/payment-merchants/:id/hpp-webhook-url
 *     Returns the current webhook URL (already-known secret embedded in path).
 *     Used by the admin UI to display + copy the URL after the secret was
 *     generated previously. Cannot regenerate the secret here — only display.
 *
 * Both routes are mounted under /api/admin and gated by superadmin.
 */

import type { Request, Response } from 'express';
import prisma from '../../../config/postgres.js';
import { encrypt, decrypt, randomToken, mask } from '../../../utils/cryptoVault.js';
import { buildNotifyUrl } from '../../../services/dejavoo/hpp/index.js';
import { getBackendUrl } from './helpers.js';

/**
 * POST /api/admin/payment-merchants/:id/regenerate-hpp-secret
 *
 * Returns the plaintext secret + URL ONCE in the response body. After the
 * admin closes the modal, the plaintext is gone — only the encrypted blob
 * remains in the DB. (We can re-display the URL via the GET endpoint
 * because the URL = backend host + secret, and we can decrypt the secret
 * back when we need to render the URL — but we never re-display the
 * secret on its own.)
 */
export const regenerateHppWebhookSecret = async (req: Request, res: Response): Promise<void> => {
  try {
    const merchant = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!merchant) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }

    const newSecret = randomToken();
    await prisma.paymentMerchant.update({
      where: { id: merchant.id },
      data: {
        hppWebhookSecret: encrypt(newSecret),
        updatedById:      req.user?.id || null,
      },
    });

    res.json({
      success:       true,
      webhookSecret: newSecret,                                 // plaintext, ONCE
      webhookUrl:    buildNotifyUrl(getBackendUrl(), newSecret),
      preview:       mask(newSecret, 8),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[regenerateHppWebhookSecret]', err);
    res.status(500).json({ success: false, error: message });
  }
};

/**
 * GET /api/admin/payment-merchants/:id/hpp-webhook-url
 *
 * Returns the current webhook URL for display + copy in the admin UI.
 * Returns `configured: false` if no webhook secret has been generated yet.
 */
export const getHppWebhookUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    const merchant = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!merchant) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }
    if (!merchant.hppWebhookSecret) {
      res.json({ success: true, configured: false, webhookUrl: null });
      return;
    }
    const secret = decrypt(merchant.hppWebhookSecret);
    if (!secret) {
      res.status(500).json({ success: false, error: 'Webhook secret could not be decrypted' });
      return;
    }
    res.json({
      success:    true,
      configured: true,
      webhookUrl: buildNotifyUrl(getBackendUrl(), secret),
      preview:    mask(secret, 8),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[getHppWebhookUrl]', err);
    res.status(500).json({ success: false, error: message });
  }
};
