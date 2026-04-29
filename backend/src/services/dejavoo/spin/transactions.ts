/**
 * Dejavoo SPIn — transaction methods (the money-moving ones).
 *
 *   sale            — Card-present sale
 *   refund          — Linked or standalone return
 *   voidTransaction — Void by reference (no money was actually moved yet)
 *   tipAdjust       — Add a tip to a completed sale
 *   balance         — EBT balance inquiry
 *   getCard         — Read card data without charging (for tokenization)
 *
 * Each method follows the same pattern: build the payload, POST it, normalize
 * the response. Errors get caught and returned as a normal response shape so
 * callers don't need a try/catch.
 */

import type { DejavooSpinMerchant, SpinOpts } from './types.js';
import { createClient, getBaseUrl } from './client.js';
import { buildBasePayload, normalizeResponse, handleError } from './payload.js';

/**
 * Card-present sale.
 *
 * @param merchant Decrypted PaymentMerchant
 * @param opts
 *   amount           — Sale amount in dollars (e.g. 49.80)
 *   paymentType      — 'Credit' | 'Debit' | 'EBT_Food' | 'EBT_Cash' | 'Card' (default 'Card')
 *   referenceId      — Unique UUID (use generateReferenceId())
 *   invoiceNumber    — POS transaction number (cross-reference, optional)
 *   registerId       — Station/register identifier (optional override)
 *   captureSignature — Request signature capture above threshold
 */
export async function sale(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts,
): Promise<Record<string, unknown>> {
  const client = createClient(merchant);
  // PaymentType enum (per Theneo SPIn REST API spec, case-sensitive):
  //   Credit | Debit | EBT_Food | EBT_Cash | Card | Cash | Check | Gift
  //
  // We default to 'Credit' rather than 'Card' because:
  //   1. The official sample payload in the docs uses Credit for a card sale
  //   2. 'Card' is the generic "let the terminal prompt for type" option which
  //      requires the terminal to have MULTIPLE payment applications installed
  //      (Credit + Debit + …) so it can offer a chooser. UAT merchant profiles
  //      typically only have ONE app installed.
  //   3. When 'Card' is requested but no generic Card app exists, DVSPIn
  //      returns StatusCode 1003 "Not Supported — could not find a proper
  //      payment application" with Message "This feature is not available
  //      now." — exactly the error we were getting in UAT.
  // Caller can still override via opts.paymentType (e.g. 'EBT_Food', 'Debit').
  // We normalize case so callers passing 'credit' or 'ebt_food' don't break:
  //   credit/card     → Credit
  //   debit           → Debit
  //   ebt_food/ebt    → EBT_Food
  //   ebt_cash        → EBT_Cash
  //   gift/check/cash → preserve casing
  const normalizePaymentType = (raw?: string | null): string => {
    if (!raw) return 'Credit';
    const v = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (v === 'credit' || v === 'card')         return 'Credit';
    if (v === 'debit')                          return 'Debit';
    if (v === 'ebt_food' || v === 'ebt' ||
        v === 'snap'     || v === 'food_stamp') return 'EBT_Food';
    if (v === 'ebt_cash')                       return 'EBT_Cash';
    if (v === 'cash')                           return 'Cash';
    if (v === 'check')                          return 'Check';
    if (v === 'gift')                           return 'Gift';
    return raw; // unknown — pass through and let Dejavoo reject with a clear error
  };
  // Cart object — when provided, Dejavoo shows the itemised cart on the
  // P17 screen during the card prompt. Full customer transparency: they
  // see the line items + amounts + totals before tapping. Per Theneo spec,
  // the Cart object goes alongside Amount/PaymentType/etc. The opts.cart
  // shape we accept is already in Dejavoo's expected case-sensitive format
  // (built by the caller — see helpers in posSpin/transactions.ts).
  const cart = (opts as Record<string, unknown>).cart;

  const body: Record<string, unknown> = {
    ...buildBasePayload(merchant, opts),
    Amount:           opts.amount,
    PaymentType:      normalizePaymentType(opts.paymentType),
    ReferenceId:      opts.referenceId,
    InvoiceNumber:    opts.invoiceNumber || '',
    CaptureSignature: opts.captureSignature || false,
    GetExtendedData:  true,
    ...(cart && typeof cart === 'object' ? { Cart: cart } : {}),
  };

  // Verbose log — same pattern as terminalStatus. Lets us see in PM2 logs
  // exactly what TPN / RegisterId / Amount / PaymentType went out, so when
  // the device "stays on Listening" we can confirm whether the cloud
  // rejected our routing fields or whether the push made it to the device.
  // Authkey redacted; everything else is non-sensitive.
  const redacted = { ...body, Authkey: body.Authkey ? '••••' : '(missing)' };
  console.warn(
    '[dejavooSpin.sale] →',
    getBaseUrl(merchant), '/v2/Payment/Sale body:',
    JSON.stringify(redacted),
  );

  try {
    const { data, status: httpStatus } = await client.post('/v2/Payment/Sale', body);
    // Log response shape so we can correlate "device didn't react" with the
    // ResultCode / Message coming back from the cloud.
    const respGen = ((data as Record<string, unknown>)?.GeneralResponse as Record<string, unknown>) || {};
    console.warn(
      '[dejavooSpin.sale] ← HTTP', httpStatus,
      'ResultCode:', respGen.ResultCode,
      'StatusCode:', respGen.StatusCode,
      'Message:',    respGen.Message,
      'DetailedMessage:', respGen.DetailedMessage,
    );
    return normalizeResponse(data, 'sale');
  } catch (err) {
    return handleError(err, 'sale');
  }
}

/**
 * Return / refund. Can be linked (with original ReferenceId) or standalone.
 */
export async function refund(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts,
): Promise<Record<string, unknown>> {
  const client = createClient(merchant);
  const body: Record<string, unknown> = {
    ...buildBasePayload(merchant, opts),
    Amount:          opts.amount,
    PaymentType:     opts.paymentType || 'Card',
    ReferenceId:     opts.referenceId,
    InvoiceNumber:   opts.invoiceNumber || '',
    GetExtendedData: true,
  };
  if (opts.originalReferenceId) {
    body.OriginalReferenceId = opts.originalReferenceId;
  }
  try {
    const { data } = await client.post('/v2/Payment/Return', body);
    return normalizeResponse(data, 'refund');
  } catch (err) {
    return handleError(err, 'refund');
  }
}

/**
 * Void a previous transaction by reference. Use this for transactions that
 * haven't been settled yet — for settled transactions use `refund` instead.
 */
export async function voidTransaction(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts,
): Promise<Record<string, unknown>> {
  const client = createClient(merchant);
  const body = {
    ...buildBasePayload(merchant, opts),
    ReferenceId:         opts.referenceId,
    OriginalReferenceId: opts.originalReferenceId,
  };
  try {
    const { data } = await client.post('/v2/Payment/Void', body);
    return normalizeResponse(data, 'void');
  } catch (err) {
    return handleError(err, 'void');
  }
}

/**
 * Tip adjust on a completed sale. Used post-sale (e.g. restaurant flow where
 * the customer signs the slip and writes a tip amount).
 */
export async function tipAdjust(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts,
): Promise<Record<string, unknown>> {
  const client = createClient(merchant);
  const body = {
    ...buildBasePayload(merchant, opts),
    TipAmount:           opts.tipAmount,
    ReferenceId:         opts.referenceId,
    OriginalReferenceId: opts.originalReferenceId,
  };
  try {
    const { data } = await client.post('/v2/Payment/TipAdjust', body);
    return normalizeResponse(data, 'tipAdjust');
  } catch (err) {
    return handleError(err, 'tipAdjust');
  }
}

/**
 * EBT balance inquiry. PaymentType must be 'EBT_Food' or 'EBT_Cash'.
 * Returns the customer's available balance — no money moves.
 *
 * Verbose logging mirrors the sale() pattern so when EBT click fails we
 * can see exactly what TPN / PaymentType / referenceId went out and what
 * StatusCode / Message came back. Was previously silent — diagnosing live
 * errors required adding logs ad-hoc, which slowed down the cert loop.
 */
export async function balance(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts,
): Promise<Record<string, unknown>> {
  const client = createClient(merchant);
  // Defensive normalization — the factory already maps via PAYMENT_TYPE_MAP
  // so opts.paymentType arrives as 'EBT_Food' / 'EBT_Cash' (proper case).
  // But accept lowercase here too so the function works standalone.
  const rawPt = opts.paymentType || 'EBT_Food';
  const lc = String(rawPt).toLowerCase();
  const paymentType =
    lc === 'ebt_food' || lc === 'ebt' || lc === 'snap' || lc === 'food_stamp' ? 'EBT_Food' :
    lc === 'ebt_cash' ? 'EBT_Cash' :
    rawPt;
  const body: Record<string, unknown> = {
    ...buildBasePayload(merchant, opts),
    PaymentType: paymentType,
    ReferenceId: opts.referenceId,
  };

  const redacted = { ...body, Authkey: body.Authkey ? '••••' : '(missing)' };
  console.warn(
    '[dejavooSpin.balance] →',
    getBaseUrl(merchant), '/v2/Payment/Balance body:',
    JSON.stringify(redacted),
  );

  try {
    const { data, status: httpStatus } = await client.post('/v2/Payment/Balance', body);
    const respGen = ((data as Record<string, unknown>)?.GeneralResponse as Record<string, unknown>) || {};
    console.warn(
      '[dejavooSpin.balance] ← HTTP', httpStatus,
      'ResultCode:', respGen.ResultCode,
      'StatusCode:', respGen.StatusCode,
      'Message:',    respGen.Message,
      'DetailedMessage:', respGen.DetailedMessage,
    );
    return normalizeResponse(data, 'balance');
  } catch (err) {
    const result = handleError(err, 'balance');
    console.warn('[dejavooSpin.balance] ✗', JSON.stringify(result).slice(0, 400));
    return result;
  }
}

/**
 * GetCard — prompt the customer to insert/tap/swipe their card on the
 * terminal WITHOUT charging anything. Used for tokenizing a card for
 * future card-on-file charges.
 */
export async function getCard(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts,
): Promise<Record<string, unknown>> {
  const client = createClient(merchant);
  const body = {
    ...buildBasePayload(merchant, opts),
    ReferenceId: opts.referenceId,
  };
  try {
    const { data } = await client.post('/v2/Payment/GetCard', body);
    return normalizeResponse(data, 'getCard');
  } catch (err) {
    return handleError(err, 'getCard');
  }
}
