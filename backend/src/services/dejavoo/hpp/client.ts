/**
 * Dejavoo HPP — base URL resolution + small helpers.
 *
 * Functions in this module:
 *   resolveBaseUrl(merchant)            → URL for the createSession endpoint
 *   resolveQueryStatusBaseUrl(merchant) → URL for the queryStatus endpoint (different host)
 *   toCents(dollars)                    → "10000" string for $100.00
 *   buildAuthHeaderValue(secret)        → "Bearer <secret>" — what we put into
 *                                         notificationOption.authHeader so iPOSpays
 *                                         echoes it back as the Authorization header
 *                                         on the webhook
 *   generateReferenceId()               → UUID v4 for transactionReferenceId
 *   errMsg(err) / axiosErrMessage(err)  → consistent error→string conversion
 */

import type { AxiosError } from 'axios';
import crypto from 'crypto';
import type { DejavooHppMerchant } from './types.js';
import { HPP_API_SPEC } from './api-spec.js';

/** Pick the right base URL for createSession. Per-merchant override wins. */
export function resolveBaseUrl(merchant: DejavooHppMerchant): string {
  if (merchant.hppBaseUrl) return String(merchant.hppBaseUrl).replace(/\/$/, '');
  const env: 'uat' | 'prod' = merchant.environment === 'prod' ? 'prod' : 'uat';
  return HPP_API_SPEC.envBaseUrls[env].replace(/\/$/, '');
}

/** Pick the right base URL for queryStatus (separate host). */
export function resolveQueryStatusBaseUrl(merchant: DejavooHppMerchant): string {
  const env: 'uat' | 'prod' = merchant.environment === 'prod' ? 'prod' : 'uat';
  return HPP_API_SPEC.queryStatusBaseUrls[env].replace(/\/$/, '');
}

/**
 * iPOSpays expects amounts as STRING in cents, never decimals.
 *   $100.00 → "10000"
 *   $1.50   → "150"
 */
export function toCents(dollars: unknown): string | undefined {
  if (dollars == null) return undefined;
  return String(Math.round(Number(dollars) * 100));
}

/**
 * Build the value we pass as `notificationOption.authHeader` when creating
 * the session. iPOSpays sends that exact value back to us as the
 * `Authorization` request header on the webhook POST. We compare equality
 * (constant-time, in webhook.ts) to verify the inbound webhook is genuine.
 *
 * Convention: prefix the secret with "Bearer " so it looks like a normal
 * Authorization header value to iPOSpays' input validation.
 */
export function buildAuthHeaderValue(secret: string): string {
  return `Bearer ${secret}`;
}

/**
 * Generate a unique transactionReferenceId for one HPP session.
 *
 * iPOSpays caps this field at 20 characters
 * (https://docs.ipospays.com/hosted-payment-page/apidocs). UUIDv4 in its
 * canonical 36-char form exceeds the cap and was being silently truncated
 * by iPOSpays — leaving our PaymentTransaction row keyed on the full UUID
 * unable to correlate the webhook callback (which echoes the truncated
 * value).  We now emit 20 hex chars (≈80 bits of entropy), which iPOSpays
 * accepts verbatim and echoes back unchanged.
 */
export function generateReferenceId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

/** Tiny error → string helper. */
export const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** Best-effort error message extraction from an axios failure. */
export function axiosErrMessage(err: unknown): string {
  const ax = err as AxiosError<{ message?: string; error?: string }> | undefined;
  return ax?.response?.data?.message || ax?.response?.data?.error || errMsg(err);
}
