/**
 * Dejavoo HPP — checkout-session lifecycle.
 *
 *   createCheckoutSession  → POST to iPOSpays, returns the hosted-page URL
 *                            we redirect the shopper to
 *   queryPaymentStatus     → look up a payment by transactionReferenceId
 *                            (used by the storefront return-URL handler when
 *                            the webhook hasn't arrived yet)
 */

import axios, { AxiosError } from 'axios';
import type { DejavooHppMerchant, CreateCheckoutOpts, CreateCheckoutResult } from './types.js';
import { HPP_API_SPEC } from './api-spec.js';
import {
  resolveBaseUrl,
  resolveQueryStatusBaseUrl,
  toCents,
  buildAuthHeaderValue,
  errMsg,
  axiosErrMessage,
} from './client.js';
import { parseHppResponse } from './webhook.js';

/**
 * Create a hosted checkout session.
 *
 * Returns `paymentUrl` — the iPOSpays hosted page URL the storefront
 * redirects the shopper to. Returns `paymentUrl: null` + an error message
 * when iPOSpays rejects the request (e.g. invalid token, malformed body).
 *
 * @param merchant All credentials must already be DECRYPTED by the caller
 *                 (see decryptForHpp in controllers/payment/hpp/helpers.ts).
 * @param opts     See CreateCheckoutOpts in ./types.ts for full field list
 */
export async function createCheckoutSession(
  merchant: DejavooHppMerchant,
  opts: CreateCheckoutOpts,
): Promise<CreateCheckoutResult> {
  if (!merchant.hppMerchantId)    throw new Error('hppMerchantId (TPN) is required on merchant');
  if (!merchant.hppAuthKey)       throw new Error('hppAuthKey (token) is required on merchant (decrypt before passing)');
  if (!merchant.hppWebhookSecret) throw new Error('hppWebhookSecret is required on merchant (used as webhook auth)');
  if (!opts.amount || opts.amount <= 0) throw new Error('amount must be > 0');
  if (!opts.transactionReferenceId) throw new Error('transactionReferenceId is required');
  if (!opts.notifyUrl) throw new Error('notifyUrl is required');
  if (!opts.returnUrl) throw new Error('returnUrl is required');

  const failureUrl = opts.failureUrl || opts.returnUrl;
  const cancelUrl  = opts.cancelUrl  || opts.returnUrl;
  const expiry     = Math.max(1, Math.min(60, opts.expiryMinutes || 5));

  // Build the iPOSpays HPP request body. Field names + structure match the
  // iPOSpays HPP API doc. The `token` here is iPOSpays' API auth token (the
  // JWT from the merchant's iPOSpays portal), passed in the BODY (not header).
  // Loose record-typed so the conditional property additions below compile.
  const body: Record<string, unknown> & {
    transactionRequest: Record<string, unknown>;
    preferences: Record<string, unknown>;
    personalization?: Record<string, unknown>;
  } = {
    token: merchant.hppAuthKey,

    merchantAuthentication: {
      merchantId:             merchant.hppMerchantId,                   // TPN
      transactionReferenceId: opts.transactionReferenceId,
    },

    transactionRequest: {
      transactionType: HPP_API_SPEC.txType.SALE,                        // 1 = SALE
      amount:          toCents(opts.amount),                            // string cents
      calculateFee:    !!opts.fees,
      calculateTax:    !!opts.taxes,
      tipsInputPrompt: false,
      expiry,
    },

    notificationOption: {
      // Browser redirects after the shopper completes the hosted page
      notifyByRedirect: true,
      returnUrl:        opts.returnUrl,
      failureUrl,
      cancelUrl,

      // Server-to-server webhook for asynchronous status confirmation.
      // The authHeader value will be sent BACK to us by iPOSpays as the
      // `Authorization` HTTP header on the webhook POST. We compare equality
      // to verify the call is genuine.
      notifyByPOST: true,
      postAPI:      opts.notifyUrl,
      authHeader:   buildAuthHeaderValue(merchant.hppWebhookSecret),

      notifyBySMS:  false,
    },

    preferences: {
      integrationType:     1,                          // 1 = redirect-based HPP
      avsVerification:     false,
      eReceipt:            !!opts.customerEmail,
      eReceiptInputPrompt: false,
      requestCardToken:    !!opts.requestCardToken,
      shortenURL:          false,
      sendPaymentLink:     false,
      integrationVersion:  'v2',
    },
  };

  // Optional customer info — iPOSpays uses these for receipts + AVS
  if (opts.customerName)  body.preferences.customerName   = opts.customerName;
  if (opts.customerEmail) body.preferences.customerEmail  = opts.customerEmail;
  if (opts.customerPhone) body.preferences.customerMobile = opts.customerPhone;

  // Optional fee + tax breakdown
  if (opts.fees?.feeAmount) {
    body.transactionRequest.feeAmount = toCents(opts.fees.feeAmount);
    body.transactionRequest.feeLabel  = opts.fees.feeLabel || 'Processing Fee';
  }
  if (opts.taxes?.lTax?.amount) {
    body.transactionRequest.lTaxAmount = toCents(opts.taxes.lTax.amount);
    body.transactionRequest.lTaxLabel  = opts.taxes.lTax.label || 'Local Tax';
  }
  if (opts.taxes?.gTax?.amount) {
    body.transactionRequest.gTaxAmount = toCents(opts.taxes.gTax.amount);
    body.transactionRequest.gTaxLabel  = opts.taxes.gTax.label || 'State Tax';
  }

  // Optional storefront branding (merchantName/logo show up on hosted page)
  if (opts.merchantName || opts.logoUrl || opts.themeColor || opts.description) {
    body.personalization = {};
    if (opts.merchantName) body.personalization.merchantName = opts.merchantName;
    if (opts.logoUrl)      body.personalization.logoUrl      = opts.logoUrl;
    if (opts.themeColor)   body.personalization.themeColor   = opts.themeColor;
    if (opts.description)  body.personalization.description  = opts.description;
  }

  const baseURL = resolveBaseUrl(merchant);
  const url = `${baseURL}${HPP_API_SPEC.paths.createSession}`;

  // Debug logging — temporary, remove after diagnosing the 401.
  // Mask the JWT: print first 12 + last 6 chars only so we can verify which
  // token is being sent without leaking the full secret to logs.
  const tokenMasked = merchant.hppAuthKey
    ? `${merchant.hppAuthKey.slice(0, 12)}...${merchant.hppAuthKey.slice(-6)} (len=${merchant.hppAuthKey.length})`
    : '(empty)';
  console.log('\n[HPP-DEBUG] ─── createCheckoutSession ───');
  console.log('[HPP-DEBUG] env=', merchant.environment, 'url=', url);
  console.log('[HPP-DEBUG] merchantId=', merchant.hppMerchantId);
  console.log('[HPP-DEBUG] token=', tokenMasked);
  console.log('[HPP-DEBUG] amount=', opts.amount, 'ref=', opts.transactionReferenceId);
  console.log('[HPP-DEBUG] notifyUrl=', opts.notifyUrl);
  console.log('[HPP-DEBUG] returnUrl=', opts.returnUrl);
  // Send a redacted copy of the body so we can see the exact shape iPOSpays sees
  const bodyDebug = JSON.parse(JSON.stringify(body));
  if (typeof bodyDebug.token === 'string') {
    bodyDebug.token = `${bodyDebug.token.slice(0, 12)}...${bodyDebug.token.slice(-6)}`;
  }
  console.log('[HPP-DEBUG] body=', JSON.stringify(bodyDebug, null, 2));

  try {
    const { data, status, headers: respHeaders } = await axios.post(url, body, {
      timeout: 30 * 1000,
      headers: { 'Content-Type': 'application/json' },
    });
    console.log('[HPP-DEBUG] iPOSpays status=', status);
    console.log('[HPP-DEBUG] iPOSpays content-type=', respHeaders['content-type']);
    console.log('[HPP-DEBUG] iPOSpays response=', JSON.stringify(data, null, 2));
    // Successful response shape: { message: "Url generated successfully", information: "<url>" }
    const paymentUrl = data?.information || null;
    return {
      approved:               paymentUrl != null,
      paymentUrl,
      transactionReferenceId: opts.transactionReferenceId,
      message:                data?.message || null,
      _raw:                   data,
    };
  } catch (err) {
    const ax = err as AxiosError<{ message?: string; error?: string }>;
    console.log('[HPP-DEBUG] iPOSpays ERROR status=', ax.response?.status);
    console.log('[HPP-DEBUG] iPOSpays ERROR headers=', ax.response?.headers);
    console.log('[HPP-DEBUG] iPOSpays ERROR body=', JSON.stringify(ax.response?.data, null, 2));
    console.log('[HPP-DEBUG] iPOSpays ERROR message=', errMsg(err));
    return {
      approved:               false,
      paymentUrl:             null,
      transactionReferenceId: opts.transactionReferenceId,
      message:                ax.response?.data?.message
                           || ax.response?.data?.error
                           || errMsg(err)
                           || 'Failed to create checkout session',
      _raw:                   ax.response?.data ?? null,
    };
  }
}

/**
 * Query an existing payment's status. Used by the return-url handler when
 * the storefront wants to confirm payment state synchronously even if the
 * webhook is slightly delayed.
 *
 * @param transactionReferenceId The reference we sent to iPOSpays in createSession
 */
export async function queryPaymentStatus(
  merchant: DejavooHppMerchant,
  transactionReferenceId: string,
): Promise<Record<string, unknown>> {
  if (!transactionReferenceId) throw new Error('transactionReferenceId is required');

  const baseURL = resolveQueryStatusBaseUrl(merchant);
  try {
    const { data } = await axios.get(`${baseURL}${HPP_API_SPEC.paths.queryStatus}`, {
      params: {
        merchantId:             merchant.hppMerchantId,
        transactionReferenceId,
      },
      headers: {
        'Content-Type': 'application/json',
        token:          merchant.hppAuthKey,    // queryStatus uses header token (per iPOSpays spec)
      },
      timeout: 15 * 1000,
    });
    return { ok: true, ...parseHppResponse(data), _raw: data };
  } catch (err) {
    return {
      ok:      false,
      message: axiosErrMessage(err),
      _raw:    (err as AxiosError)?.response?.data ?? null,
    };
  }
}
