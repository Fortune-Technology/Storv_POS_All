/**
 * Dejavoo SPIn — payload helpers: build outgoing requests, normalize incoming
 * responses to a unified shape, and turn axios errors into something useful.
 *
 * Every transaction module (transactions.ts, terminal.ts) uses these helpers
 * so we have a single source of truth for what gets sent and how the
 * Dejavoo-specific response fields map to our flat result object.
 */

import type { AxiosError } from 'axios';
import type { DejavooSpinMerchant, SpinOpts } from './types.js';
import { errMsg } from './client.js';

/**
 * Build the common request body sent to every SPIn endpoint. All POST bodies
 * start with `{Tpn, Authkey, RegisterId, PrintReceipt, GetReceipt}` — the
 * specific endpoint adds Amount / ReferenceId / OriginalReferenceId / etc.
 *
 * `RegisterId` resolution order: per-call override → per-merchant default →
 * env fallback (DEJAVOO_TEST_REGISTER_ID — handy for local dev). Most v2
 * endpoints reject with HTTP 400 if RegisterId is missing.
 */
export function buildBasePayload(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    Tpn:     merchant.spinTpn,
    Authkey: merchant.spinAuthKey,
  };

  const registerId = opts.registerId
    || merchant.spinRegisterId
    || process.env.DEJAVOO_TEST_REGISTER_ID;
  if (registerId) payload.RegisterId = registerId;

  // Receipt handling — let the POS handle receipts; don't auto-print on the terminal
  payload.PrintReceipt = opts.printReceipt || 'No';
  payload.GetReceipt   = opts.getReceipt   || 'Both'; // get receipt data in response

  if (opts.proxyTimeout) payload.SPInProxyTimeout = opts.proxyTimeout;

  return payload;
}

/**
 * Map Dejavoo's nested response shape to a flat result object the rest of
 * the codebase consumes. Keeps `_raw` for forensics + audit logs.
 *
 * Shape returned to controller / cashier-app:
 *   { approved, resultCode, statusCode, message, detailedMessage,
 *     authCode, referenceId, batchNumber, last4, cardType, entryType, expiry,
 *     totalAmount, amount, tipAmount, feeAmount, taxAmount,
 *     emvAppName, emvAID, emvTVR,
 *     merchantReceipt, customerReceipt, signatureData,
 *     hostResponseCode, hostResponseMessage,
 *     transactionType, _raw }
 */
export function normalizeResponse(raw: unknown, transactionType: string): Record<string, unknown> {
  const r = (raw as Record<string, unknown>) || {};
  const gen     = (r.GeneralResponse as Record<string, unknown>) || {};
  const card    = (r.CardData        as Record<string, unknown>) || {};
  const amts    = (r.Amounts         as Record<string, unknown>) || {};
  const emv     = (r.EMVData         as Record<string, unknown>) || {};
  const receipt = (r.Receipt         as Record<string, unknown>) || {};

  const statusCode = (gen.StatusCode as string) || '';
  const approved   = statusCode === '0000' || gen.ResultCode === 'Ok';

  return {
    // Status
    approved,
    resultCode:          gen.ResultCode      || null,    // 'Ok' | 'TerminalError' | 'ApiError'
    statusCode,                                          // '0000' approved, '1015' declined, etc.
    message:             gen.Message         || null,
    detailedMessage:     gen.DetailedMessage || null,
    hostResponseCode:    gen.HostResponseCode    || null,
    hostResponseMessage: gen.HostResponseMessage || null,

    // Transaction info
    transactionType,
    paymentType:  r.PaymentType  || null,                // 'Credit' | 'Debit' | 'EBT_Food' | etc.
    authCode:     r.AuthCode     || null,
    referenceId:  r.ReferenceId  || null,
    batchNumber:  r.BatchNumber  || null,
    serialNumber: r.SerialNumber || null,

    // Amounts
    totalAmount: amts.TotalAmount ?? null,
    amount:      amts.Amount      ?? null,
    tipAmount:   amts.TipAmount   ?? null,
    feeAmount:   amts.FeeAmount   ?? null,
    taxAmount:   amts.TaxAmount   ?? null,

    // Card data (PCI-safe — no full PAN)
    cardType:  card.CardType       || null,              // 'Visa' | 'Mastercard' | 'Amex' | etc.
    entryType: card.EntryType      || null,              // 'Chip' | 'Swipe' | 'Contactless' | 'Manual'
    last4:     card.Last4          || null,
    first4:    card.First4         || null,
    bin:       card.BIN            || null,
    expiry:    card.ExpirationDate || null,              // 'MMYY'

    // EMV
    emvAppName: emv.ApplicationName || null,
    emvAID:     emv.AID             || null,
    emvTVR:     emv.TVR             || null,

    // Receipt
    merchantReceipt: receipt.MerchantReceipt || null,
    customerReceipt: receipt.CustomerReceipt || null,

    // Signature
    signatureData: r.SignatureData || null,

    // Raw — only used for audit / debug; never sent to clients
    _raw: raw,
  };
}

/**
 * Convert a thrown axios error into the same flat shape as a normal response,
 * so callers don't need a separate code path for network failures vs Dejavoo
 * declines.
 */
export function handleError(err: unknown, transactionType: string): Record<string, unknown> {
  const ax = err as AxiosError;
  if (ax?.response?.data) {
    // Dejavoo returned a structured error payload — normalize it like a regular response
    return normalizeResponse(ax.response.data, transactionType);
  }
  // True network error / timeout — synthesize a consistent shape
  return {
    approved:        false,
    resultCode:      'NetworkError',
    statusCode:      ax?.code === 'ECONNABORTED' ? '2007' : '9999',
    message:         errMsg(err) || 'Network error communicating with payment terminal',
    detailedMessage: ax?.code || null,
    transactionType,
    _raw:            null,
  };
}
