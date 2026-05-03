/**
 * Dejavoo HPP — webhook authentication, response parsing, status mapping,
 * URL building.
 *
 *   verifyWebhookAuthHeader → confirm an inbound webhook is genuine
 *   parseHppResponse        → flatten the iposHPResponse envelope
 *   mapStatus               → ours-enum → PaymentTransaction.status
 *   buildNotifyUrl          → construct the per-store webhook URL we hand
 *                             to iPOSpays as `postAPI`
 */

import crypto from 'crypto';
import { HPP_API_SPEC } from './api-spec.js';
import { buildAuthHeaderValue } from './client.js';

/**
 * Verify an inbound webhook is genuine.
 *
 * iPOSpays HPP doesn't sign webhooks with HMAC. Instead, when we created
 * the session we passed `notificationOption.authHeader = "Bearer <secret>"`.
 * iPOSpays sends that exact value back to us as the `Authorization` HTTP
 * header when posting the webhook. We compare equality (constant-time) to
 * confirm authenticity.
 *
 * @param incomingAuthHeader  req.headers.authorization
 * @param expectedSecret      Decrypted merchant.hppWebhookSecret
 */
export function verifyWebhookAuthHeader(
  incomingAuthHeader: string | null | undefined,
  expectedSecret: string | null | undefined,
): boolean {
  if (!incomingAuthHeader || !expectedSecret) return false;
  const expected = buildAuthHeaderValue(expectedSecret as string);
  const a = Buffer.from(String(incomingAuthHeader).trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Flatten the iPOSpays response shape from a webhook body OR queryStatus
 * response into a normalized object the controller can use.
 *
 * The webhook + query-status both wrap the data in `iposHPResponse`.
 * Defensive: also accept a flat shape in case iPOSpays sends both forms.
 */
export function parseHppResponse(body: unknown): Record<string, unknown> {
  const b = (body as Record<string, unknown>) || {};
  const r = (b.iposHPResponse as Record<string, unknown>) || b || {};

  const numericCode = Number(r.responseCode);
  const responseCodeMap = HPP_API_SPEC.responseCodes as Record<number, string>;
  const status = responseCodeMap[numericCode] || 'pending';

  return {
    status,                                                       // approved | declined | cancelled | rejected | pending
    responseCode:           numericCode || null,
    responseMessage:        r.responseMessage      || null,
    transactionReferenceId: r.transactionReferenceId || null,
    transactionId:          r.transactionId        || null,
    transactionNumber:      r.transactionNumber    || null,
    batchNumber:            r.batchNumber          || null,
    cardType:               r.cardType             || null,
    cardLast4Digit:         r.cardLast4Digit       || null,
    amount:                 r.amount               || null,       // dollars (string)
    totalAmount:            r.totalAmount          || null,
    tips:                   r.tips                 || null,
    customFee:              r.customFee            || null,
    localTax:               r.localTax             || null,
    stateTax:               r.stateTax             || null,
    authCode:               r.responseApprovalCode || null,
    rrn:                    r.rrn                  || null,
    cardToken:              r.cardToken            || null,
    avsRespMsg:             r.avsRespMsg           || null,
    consumerId:             r.consumerId           || null,
    errResponseCode:        r.errResponseCode      || null,
    errResponseMessage:     r.errResponseMessage   || null,
    _raw:                   body,
  };
}

/** Map our parsed status → PaymentTransaction.status enum. */
export function mapStatus(status: unknown): 'approved' | 'declined' | 'voided' | 'pending' {
  switch (String(status || '').toLowerCase()) {
    case 'approved':  return 'approved';
    case 'declined':  return 'declined';
    case 'rejected':  return 'declined';
    case 'cancelled': return 'voided';
    case 'pending':
    default:
      return 'pending';
  }
}

/**
 * Build the per-store webhook URL we hand to iPOSpays as `postAPI`.
 * The opaque secret in the path lets the webhook handler look up the
 * merchant before verifying the Authorization header.
 */
export function buildNotifyUrl(
  backendUrl: string | null | undefined,
  storeWebhookSecret: string,
): string {
  const base = String(backendUrl || '').replace(/\/$/, '');
  return `${base}/api/payment/dejavoo/hpp/webhook/${storeWebhookSecret}`;
}
