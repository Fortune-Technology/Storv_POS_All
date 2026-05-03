/**
 * HPP — shared helpers used by every HPP controller.
 *
 *   getBackendUrl()       → resolve our public URL for embedding in webhook URLs
 *   decryptForHpp(row)    → decrypt all HPP credentials in-memory (throws if
 *                            HPP isn't fully configured for this merchant)
 *   notifyEcomBackend()   → best-effort callback to ecom-backend after a webhook
 *                            updates a PaymentTransaction
 *
 * Type definitions (`MerchantRow`, `DecryptedHppMerchant`, etc.) live here
 * so the createSession + webhook handlers don't have to redeclare them.
 */

import { decrypt } from '../../../utils/cryptoVault.js';

/** PaymentMerchant row shape used by HPP handlers (non-exhaustive). */
export interface MerchantRow {
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

/** A merchant row with HPP secrets decrypted into plaintext (memory only). */
export interface DecryptedHppMerchant extends MerchantRow {
  hppAuthKey: string;
  hppWebhookSecret: string;
}

/**
 * Resolve our backend's public URL — used to embed in iPOSpays' `postAPI`
 * webhook URL. Defaults to localhost:5000 for dev. In prod the deployment
 * env should set `BACKEND_URL=https://api.yoursite.com`.
 */
export function getBackendUrl(): string {
  return (
    process.env.BACKEND_URL ||
    process.env.API_BASE_URL ||
    'http://localhost:5000'
  ).replace(/\/$/, '');
}

/**
 * Decrypt a merchant's HPP credentials in-memory. Plaintext is never
 * persisted — it lives only inside the request that called this function.
 *
 * Throws (with a specific message) if the merchant isn't ready for HPP:
 *   - merchant doesn't exist
 *   - status !== 'active'
 *   - hppEnabled is false
 *   - any of hppMerchantId / hppAuthKey / hppWebhookSecret missing
 *   - decrypt() returned null (vault key mismatch — usually means env
 *     was rotated without re-encrypting existing rows)
 *
 * Caller: try/catch and surface the error to the client.
 */
export function decryptForHpp(merchant: MerchantRow | null): DecryptedHppMerchant {
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

/** Args to `notifyEcomBackend()`. */
export interface NotifyEcomArgs {
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
 * Best-effort callback to ecom-backend after the webhook updates a
 * PaymentTransaction. Lets ecom-backend mark the EcomOrder as paid
 * before its own polling kicks in.
 *
 * Authenticated by the shared `INTERNAL_API_KEY` env var (must match between
 * pos-backend and ecom-backend). Failure is logged but never throws — the
 * webhook needs to ack iPOSpays even if our internal callback fails.
 */
export async function notifyEcomBackend(args: NotifyEcomArgs): Promise<void> {
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
        'Content-Type':       'application/json',
        'X-Internal-Api-Key': internalKey,
      },
      body: JSON.stringify(args),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[hppController] notifyEcomBackend failed:', message);
  }
}
