/**
 * dejavooHppController.ts
 *
 * HTTP handlers for Dejavoo / iPOSpays HPP — online checkout.
 * Mounted at /api/payment/dejavoo/hpp/*.
 *
 * ─── Endpoints ────────────────────────────────────────────────────────
 *   POST /api/payment/dejavoo/hpp/create-session   — internal (X-Internal-Api-Key)
 *   POST /api/payment/dejavoo/hpp/webhook/:secret  — public  (Authorization header verified)
 *   POST /api/admin/payment-merchants/:id/regenerate-hpp-secret — superadmin
 *   GET  /api/admin/payment-merchants/:id/hpp-webhook-url       — superadmin
 *
 * ─── Auth model ───────────────────────────────────────────────────────
 *   create-session  — server-to-server. Auth via shared INTERNAL_API_KEY.
 *   webhook         — public, no JWT. Trust comes from (a) per-store opaque
 *                     secret in URL path, (b) Authorization header set to
 *                     "Bearer <secret>" by iPOSpays (we set that value when
 *                     creating the session, iPOSpays echoes it on the webhook).
 *   regenerate /
 *   webhook-url     — superadmin only (router-level guard).
 */

import type { Request, Response } from 'express';
import prisma from '../config/postgres.js';
import { encrypt, decrypt, randomToken, mask } from '../utils/cryptoVault.js';
import {
  createCheckoutSession,
  parseHppResponse,
  verifyWebhookAuthHeader,
  mapStatus,
  buildNotifyUrl,
  generateReferenceId,
} from '../services/dejavooHppService.js';

interface MerchantRow {
  id: string;
  orgId: string;
  storeId: string;
  status?: string;
  hppEnabled?: boolean;
  hppMerchantId?: string | null;
  hppAuthKey?: string | null;
  hppWebhookSecret?: string | null;
  provider?: string;
  environment?: string;
  [extra: string]: unknown;
}

interface DecryptedHppMerchant extends MerchantRow {
  hppAuthKey: string;
  hppWebhookSecret: string;
}

// ═════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════

function getBackendUrl(): string {
  return (
    process.env.BACKEND_URL ||
    process.env.API_BASE_URL ||
    'http://localhost:5000'
  ).replace(/\/$/, '');
}

/**
 * Decrypt a merchant's HPP credentials in-memory. Never persists plaintext.
 */
function decryptForHpp(merchant: MerchantRow | null): DecryptedHppMerchant {
  if (!merchant) throw new Error('Merchant not found');
  if (merchant.status !== 'active') {
    throw new Error(`Merchant is ${merchant.status}; HPP processing blocked`);
  }
  if (!merchant.hppEnabled) {
    throw new Error('HPP is not enabled for this merchant');
  }
  if (!merchant.hppMerchantId || !merchant.hppAuthKey) {
    throw new Error('HPP credentials not configured');
  }
  if (!merchant.hppWebhookSecret) {
    throw new Error('HPP webhook secret not configured (regenerate from admin panel)');
  }

  const hppAuthKey = decrypt(merchant.hppAuthKey);
  if (!hppAuthKey) throw new Error('HPP auth key decrypt failed');

  const hppWebhookSecret = decrypt(merchant.hppWebhookSecret);
  if (!hppWebhookSecret) throw new Error('HPP webhook secret decrypt failed');

  return { ...merchant, hppAuthKey, hppWebhookSecret };
}

interface NotifyEcomArgs {
  orderId: string;
  storeId: string;
  status: string;
  paymentTransactionId: string;
  amount?: number;
  last4?: string;
  cardType?: string;
  authCode?: string;
}

/**
 * Best-effort callback to ecom-backend.
 */
async function notifyEcomBackend(args: NotifyEcomArgs): Promise<void> {
  const ecomUrl     = process.env.ECOM_BACKEND_URL;
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!ecomUrl || !internalKey) {
    console.warn('[hppController] ECOM_BACKEND_URL or INTERNAL_API_KEY not set — skipping ecom notify');
    return;
  }
  try {
    await fetch(`${ecomUrl.replace(/\/$/, '')}/api/internal/orders/payment-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': internalKey,
      },
      body: JSON.stringify(args),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[hppController] notifyEcomBackend failed:', message);
  }
}

interface CreateSessionBody {
  storeId?: string;
  orderId?: string;
  amount?: number;
  customerEmail?: string;
  customerName?: string;
  customerPhone?: string;
  description?: string;
  returnUrl?: string;
  failureUrl?: string;
  cancelUrl?: string;
  merchantName?: string;
  logoUrl?: string;
  themeColor?: string;
  notifyUrl?: string;
}

interface CheckoutSessionResult {
  approved?: boolean;
  paymentUrl?: string;
  message?: string;
  _raw?: unknown;
}

interface ParsedHppResponse {
  status?: string;
  transactionReferenceId?: string;
  authCode?: string;
  responseCode?: string | number | null;
  responseMessage?: string;
  cardLast4Digit?: string;
  cardType?: string;
  cardToken?: string;
  amount?: number;
  totalAmount?: number;
}

// ═════════════════════════════════════════════════════════════════════════
// POST /api/payment/dejavoo/hpp/create-session
// ═════════════════════════════════════════════════════════════════════════

export const dejavooHppCreateSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      storeId,
      orderId,
      amount,
      customerEmail,
      customerName,
      customerPhone,
      description,
      returnUrl,
      failureUrl,
      cancelUrl,
      merchantName,
      logoUrl,
      themeColor,
      notifyUrl: overrideNotifyUrl,
    } = req.body as CreateSessionBody;

    if (!storeId)   { res.status(400).json({ success: false, error: 'storeId is required' }); return; }
    if (!orderId)   { res.status(400).json({ success: false, error: 'orderId is required' }); return; }
    if (!amount || amount <= 0) {
      res.status(400).json({ success: false, error: 'amount must be > 0' });
      return;
    }
    if (!returnUrl) { res.status(400).json({ success: false, error: 'returnUrl is required' }); return; }

    const merchantRow = await prisma.paymentMerchant.findUnique({ where: { storeId } }) as MerchantRow | null;
    if (!merchantRow) {
      res.status(404).json({ success: false, error: 'No payment merchant configured for this store' });
      return;
    }

    let merchant: DecryptedHppMerchant;
    try {
      merchant = decryptForHpp(merchantRow);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ success: false, error: message });
      return;
    }

    const transactionReferenceId = generateReferenceId();
    const notifyUrl = overrideNotifyUrl || buildNotifyUrl(getBackendUrl(), merchant.hppWebhookSecret);

    const result = await createCheckoutSession(merchant as unknown as Parameters<typeof createCheckoutSession>[0], {
      transactionReferenceId,
      amount,
      customerEmail, customerName, customerPhone,
      description,
      returnUrl, failureUrl, cancelUrl,
      merchantName, logoUrl, themeColor,
      notifyUrl,
    } as Parameters<typeof createCheckoutSession>[1]) as CheckoutSessionResult;

    if (!result.approved || !result.paymentUrl) {
      res.status(502).json({
        success: false,
        error:   result.message || 'iPOSpays did not return a payment URL',
        raw:     result._raw,
      });
      return;
    }

    // Log the pending transaction so the webhook can find + finalise it.
    const paymentTx = await prisma.paymentTransaction.create({
      data: {
        orgId:         merchant.orgId,
        storeId:       merchant.storeId,
        merchantId:    merchant.id,
        provider:      'dejavoo',
        txSource:      'ecom',
        ecomOrderId:   orderId,
        retref:        transactionReferenceId,
        amount,
        type:          'sale',
        status:        'pending',
        respText:      'HPP session created — awaiting payment',
        invoiceNumber: orderId,
      },
    });

    res.json({
      success:                true,
      paymentUrl:             result.paymentUrl,
      transactionReferenceId,
      paymentTransactionId:   paymentTx.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[dejavooHppCreateSession]', err);
    res.status(500).json({ success: false, error: message });
  }
};

// ═════════════════════════════════════════════════════════════════════════
// POST /api/payment/dejavoo/hpp/webhook/:secret
// ═════════════════════════════════════════════════════════════════════════

export const dejavooHppWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const { secret } = req.params;
    if (!secret) { res.status(400).json({ ok: false, error: 'Missing secret in URL' }); return; }

    // Find the merchant whose webhook secret decrypts to this URL value.
    const merchants = await prisma.paymentMerchant.findMany({
      where: { hppEnabled: true, hppWebhookSecret: { not: null } },
      select: {
        id: true, orgId: true, storeId: true,
        hppAuthKey: true, hppWebhookSecret: true,
        provider: true, environment: true,
      },
    }) as MerchantRow[];

    const merchant = merchants.find((m: MerchantRow) => m.hppWebhookSecret && decrypt(m.hppWebhookSecret) === secret);
    if (!merchant) {
      console.warn('[hppWebhook] Unknown webhook secret — possible probe or rotated secret');
      res.status(401).json({ ok: false, error: 'Unknown webhook secret' });
      return;
    }

    // Verify Authorization header matches what we set as `authHeader` when
    // creating the session.
    const incoming = req.get('authorization') || req.get('Authorization') || '';
    if (!verifyWebhookAuthHeader(incoming, secret)) {
      console.warn(`[hppWebhook] Authorization mismatch for merchant ${merchant.id} — rejecting`);
      res.status(401).json({ ok: false, error: 'Invalid Authorization' });
      return;
    }

    // Parse the iposHPResponse envelope
    const payload = parseHppResponse(req.body) as ParsedHppResponse;
    const mappedStatus = mapStatus(payload.status);
    const ref = payload.transactionReferenceId;

    if (!ref) {
      console.warn('[hppWebhook] Missing transactionReferenceId — cannot correlate');
      res.status(400).json({ ok: false, error: 'Webhook missing transactionReferenceId' });
      return;
    }

    // Idempotency: find the pending PaymentTransaction we wrote at create-session
    let tx = await prisma.paymentTransaction.findFirst({
      where: { merchantId: merchant.id, retref: ref, txSource: 'ecom' },
    });

    // If we already finalised this transaction, ack but don't double-update
    if (tx && tx.status !== 'pending') {
      res.json({ ok: true, idempotent: true, paymentTransactionId: tx.id });
      return;
    }

    if (tx) {
      tx = await prisma.paymentTransaction.update({
        where: { id: tx.id },
        data: {
          status:        mappedStatus,
          authCode:      payload.authCode       || tx.authCode,
          respCode:      payload.responseCode != null ? String(payload.responseCode) : tx.respCode,
          respText:      payload.responseMessage || `HPP webhook: ${payload.status}`,
          lastFour:      payload.cardLast4Digit  || tx.lastFour,
          acctType:      payload.cardType        || tx.acctType,
          token:         payload.cardToken       || tx.token,
          capturedAmount: mappedStatus === 'approved' ? Number(payload.totalAmount || payload.amount || tx.amount) : tx.capturedAmount,
        },
      });
    } else {
      // No pending row found — write one (rare; only if create-session DB write failed)
      tx = await prisma.paymentTransaction.create({
        data: {
          orgId:         merchant.orgId,
          storeId:       merchant.storeId,
          merchantId:    merchant.id,
          provider:      'dejavoo',
          txSource:      'ecom',
          retref:        ref,
          amount:        Number(payload.amount || payload.totalAmount || 0),
          type:          'sale',
          status:        mappedStatus,
          authCode:      payload.authCode,
          respCode:      payload.responseCode != null ? String(payload.responseCode) : null,
          respText:      payload.responseMessage || `HPP webhook: ${payload.status} (no prior session row)`,
          lastFour:      payload.cardLast4Digit,
          acctType:      payload.cardType,
          token:         payload.cardToken,
        },
      });
    }

    // Best-effort notify ecom-backend (don't block the webhook on it)
    if (tx.ecomOrderId) {
      notifyEcomBackend({
        orderId:              tx.ecomOrderId,
        storeId:              merchant.storeId,
        status:               mappedStatus,
        paymentTransactionId: tx.id,
        amount:               payload.totalAmount || payload.amount,
        last4:                payload.cardLast4Digit,
        cardType:             payload.cardType,
        authCode:             payload.authCode,
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[hppWebhook] notify ecom failed:', message);
      });
    }

    res.json({ ok: true, paymentTransactionId: tx.id, status: mappedStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[dejavooHppWebhook]', err);
    res.status(500).json({ ok: false, error: message });
  }
};

// ═════════════════════════════════════════════════════════════════════════
// POST /api/admin/payment-merchants/:id/regenerate-hpp-secret
// Returns plaintext secret + URL ONCE. Admin pastes URL into iPOSpays.
// ═════════════════════════════════════════════════════════════════════════

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
      webhookSecret: newSecret,                                     // plaintext, ONCE
      webhookUrl:    buildNotifyUrl(getBackendUrl(), newSecret),
      preview:       mask(newSecret, 8),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[regenerateHppWebhookSecret]', err);
    res.status(500).json({ success: false, error: message });
  }
};

// ═════════════════════════════════════════════════════════════════════════
// GET /api/admin/payment-merchants/:id/hpp-webhook-url
// ═════════════════════════════════════════════════════════════════════════

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
