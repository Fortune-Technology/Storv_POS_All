/**
 * dejavooSpinService.js
 *
 * SPIn REST API client for Dejavoo / iPOSpays payment terminals.
 * Handles all in-person card-present transactions: sale, return, void,
 * tip adjust, EBT balance, get card (tokenize), abort, settle, and status.
 *
 * Multi-tenant: every call requires a `merchant` object (from PaymentMerchant
 * table) containing the store's TPN + auth key. The service never stores
 * credentials — they're passed in per-call and decrypted by the caller.
 *
 * Docs: https://app.theneo.io/dejavoo/spin/spin-rest-api-methods
 *
 * Base URLs:
 *   UAT:  https://test.spinpos.net/spin
 *   Prod: https://api.spinpos.net
 */

import axios from 'axios';
import crypto from 'crypto';

// ── Base URL resolution ─────────────────────────────────────────────────────

const UAT_BASE  = process.env.DEJAVOO_SPIN_BASE_UAT  || 'https://test.spinpos.net/spin';
const PROD_BASE = process.env.DEJAVOO_SPIN_BASE_PROD || 'https://api.spinpos.net';

function getBaseUrl(merchant) {
  if (merchant.spinBaseUrl) return merchant.spinBaseUrl.replace(/\/$/, '');
  return merchant.environment === 'prod' ? PROD_BASE : UAT_BASE;
}

// ── Generate secure ReferenceId ─────────────────────────────────────────────
// UUID v4 — unpredictable, no information leakage, no collision risk.
// The human-readable POS tx number goes in InvoiceNumber instead.

export function generateReferenceId() {
  return crypto.randomUUID();
}

// ── HTTP client factory ─────────────────────────────────────────────────────

function createClient(merchant) {
  const baseURL = getBaseUrl(merchant);
  return axios.create({
    baseURL,
    timeout: (merchant.spinTimeout || 120) * 1000, // default 2 min (terminal may prompt user)
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Build common request body ───────────────────────────────────────────────

function buildBasePayload(merchant, opts = {}) {
  const payload = {
    Tpn:       merchant.spinTpn,
    Authkey:   merchant.spinAuthKey, // decrypted by caller
  };

  // Optional: RegisterId (station identifier — helps Dejavoo route to correct terminal)
  if (opts.registerId) payload.RegisterId = opts.registerId;

  // Receipt handling — let POS handle receipts, don't print on terminal
  payload.PrintReceipt = opts.printReceipt || 'No';
  payload.GetReceipt   = opts.getReceipt   || 'Both'; // get receipt data in response

  // Timeout for the SPIn proxy (seconds)
  if (opts.proxyTimeout) payload.SPInProxyTimeout = opts.proxyTimeout;

  return payload;
}

// ── Normalize Dejavoo response → unified shape ──────────────────────────────
// All service methods return this shape so the controller/cashier-app
// doesn't need to know Dejavoo-specific field names.

function normalizeResponse(raw, transactionType) {
  const gen   = raw?.GeneralResponse || {};
  const card  = raw?.CardData || {};
  const amts  = raw?.Amounts || {};
  const emv   = raw?.EMVData || {};

  const statusCode = gen.StatusCode || '';
  const approved   = statusCode === '0000' || gen.ResultCode === 'Ok';

  return {
    // ── Status ──
    approved,
    resultCode:     gen.ResultCode      || null,       // 'Ok' | 'TerminalError' | 'ApiError'
    statusCode,                                         // '0000' = approved, '1015' = declined, etc.
    message:        gen.Message         || null,
    detailedMessage:gen.DetailedMessage || null,
    hostResponseCode:   gen.HostResponseCode    || null,
    hostResponseMessage:gen.HostResponseMessage || null,

    // ── Transaction info ──
    transactionType,
    paymentType:    raw?.PaymentType    || null,        // 'Credit', 'Debit', 'EBT_Food', etc.
    authCode:       raw?.AuthCode       || null,
    referenceId:    raw?.ReferenceId    || null,
    batchNumber:    raw?.BatchNumber    || null,
    serialNumber:   raw?.SerialNumber   || null,

    // ── Amounts ──
    totalAmount:    amts.TotalAmount    ?? null,
    amount:         amts.Amount         ?? null,
    tipAmount:      amts.TipAmount      ?? null,
    feeAmount:      amts.FeeAmount      ?? null,
    taxAmount:      amts.TaxAmount      ?? null,

    // ── Card data (PCI-safe — no full PAN) ──
    cardType:       card.CardType       || null,        // 'Visa', 'Mastercard', 'Amex', etc.
    entryType:      card.EntryType      || null,        // 'Chip', 'Swipe', 'Contactless', 'Manual'
    last4:          card.Last4          || null,
    first4:         card.First4         || null,
    bin:            card.BIN            || null,
    expiry:         card.ExpirationDate || null,        // 'MMYY'

    // ── EMV data ──
    emvAppName:     emv.ApplicationName || null,
    emvAID:         emv.AID             || null,
    emvTVR:         emv.TVR             || null,

    // ── Receipt ──
    merchantReceipt: raw?.Receipt?.MerchantReceipt || null,
    customerReceipt: raw?.Receipt?.CustomerReceipt || null,

    // ── Signature ──
    signatureData:  raw?.SignatureData  || null,

    // ── Raw (for audit/debug) ──
    _raw: raw,
  };
}

// ── Error handler ───────────────────────────────────────────────────────────

function handleError(err, transactionType) {
  if (err.response?.data) {
    // Dejavoo returned an error response with body
    return normalizeResponse(err.response.data, transactionType);
  }
  // Network / timeout error
  return {
    approved: false,
    resultCode: 'NetworkError',
    statusCode: err.code === 'ECONNABORTED' ? '2007' : '9999',
    message: err.message || 'Network error communicating with payment terminal',
    detailedMessage: err.code || null,
    transactionType,
    _raw: null,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// TRANSACTION METHODS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Card-present sale.
 *
 * @param {object} merchant   Decrypted PaymentMerchant (spinTpn, spinAuthKey, environment)
 * @param {object} opts
 * @param {number} opts.amount        Sale amount in dollars (e.g. 49.80)
 * @param {string} opts.paymentType   'Credit'|'Debit'|'EBT_Food'|'EBT_Cash'|'Card' (default 'Card')
 * @param {string} opts.referenceId   Unique UUID (use generateReferenceId())
 * @param {string} [opts.invoiceNumber] POS transaction number for cross-reference
 * @param {string} [opts.registerId]  Station/register identifier
 * @param {boolean} [opts.captureSignature] Request signature capture
 */
export async function sale(merchant, opts) {
  const client = createClient(merchant);
  const body = {
    ...buildBasePayload(merchant, opts),
    Amount:           opts.amount,
    PaymentType:      opts.paymentType || 'Card',
    ReferenceId:      opts.referenceId,
    InvoiceNumber:    opts.invoiceNumber || '',
    CaptureSignature: opts.captureSignature || false,
    GetExtendedData:  true,
  };

  try {
    const { data } = await client.post('/v2/Payment/Sale', body);
    return normalizeResponse(data, 'sale');
  } catch (err) {
    return handleError(err, 'sale');
  }
}

/**
 * Return / refund.
 * Can be linked (with original ReferenceId) or standalone.
 */
export async function refund(merchant, opts) {
  const client = createClient(merchant);
  const body = {
    ...buildBasePayload(merchant, opts),
    Amount:           opts.amount,
    PaymentType:      opts.paymentType || 'Card',
    ReferenceId:      opts.referenceId,
    InvoiceNumber:    opts.invoiceNumber || '',
    GetExtendedData:  true,
  };
  // Link to original transaction if provided
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
 * Void a previous transaction.
 */
export async function voidTransaction(merchant, opts) {
  const client = createClient(merchant);
  const body = {
    ...buildBasePayload(merchant, opts),
    ReferenceId:          opts.referenceId,
    OriginalReferenceId:  opts.originalReferenceId,
  };

  try {
    const { data } = await client.post('/v2/Payment/Void', body);
    return normalizeResponse(data, 'void');
  } catch (err) {
    return handleError(err, 'void');
  }
}

/**
 * Tip adjust on a completed sale.
 */
export async function tipAdjust(merchant, opts) {
  const client = createClient(merchant);
  const body = {
    ...buildBasePayload(merchant, opts),
    TipAmount:            opts.tipAmount,
    ReferenceId:          opts.referenceId,
    OriginalReferenceId:  opts.originalReferenceId,
  };

  try {
    const { data } = await client.post('/v2/Payment/TipAdjust', body);
    return normalizeResponse(data, 'tipAdjust');
  } catch (err) {
    return handleError(err, 'tipAdjust');
  }
}

/**
 * EBT balance inquiry.
 * PaymentType must be 'EBT_Food' or 'EBT_Cash'.
 */
export async function balance(merchant, opts) {
  const client = createClient(merchant);
  const body = {
    ...buildBasePayload(merchant, opts),
    PaymentType: opts.paymentType || 'EBT_Food',
    ReferenceId: opts.referenceId,
  };

  try {
    const { data } = await client.post('/v2/Payment/Balance', body);
    return normalizeResponse(data, 'balance');
  } catch (err) {
    return handleError(err, 'balance');
  }
}

/**
 * Get Card — read card data and optionally tokenize for later use.
 * The terminal prompts the customer to insert/tap/swipe without charging.
 */
export async function getCard(merchant, opts) {
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

/**
 * Abort an in-flight transaction.
 * Call this when the cashier cancels while the terminal is prompting.
 */
export async function abort(merchant, opts) {
  const client = createClient(merchant);
  const body = {
    ...buildBasePayload(merchant, opts),
    ReferenceId: opts.referenceId,
  };

  try {
    const { data } = await client.post('/v2/Payment/AbortTransaction', body);
    return normalizeResponse(data, 'abort');
  } catch (err) {
    return handleError(err, 'abort');
  }
}

/**
 * Settle / close the current batch on the terminal.
 */
export async function settle(merchant, opts = {}) {
  const client = createClient(merchant);
  const body = buildBasePayload(merchant, opts);

  try {
    const { data } = await client.post('/v2/Payment/Settle', body);
    return normalizeResponse(data, 'settle');
  } catch (err) {
    return handleError(err, 'settle');
  }
}

/**
 * Check transaction status by ReferenceId.
 */
export async function status(merchant, opts) {
  const client = createClient(merchant);
  const body = {
    ...buildBasePayload(merchant, opts),
    ReferenceId: opts.referenceId,
  };

  try {
    const { data } = await client.post('/v2/Payment/Status', body);
    return normalizeResponse(data, 'status');
  } catch (err) {
    return handleError(err, 'status');
  }
}

/**
 * Prompt the customer on the terminal for input — used for phone number
 * lookup, loyalty code, zip code, etc.
 *
 * Docs: POST /v2/Common/UserInput
 *
 * @param {object} opts
 * @param {string} opts.title      Prompt line 1 (e.g. "Phone Number")
 * @param {string} opts.prompt     Prompt line 2 (e.g. "Enter 10-digit phone")
 * @param {string} opts.inputType  'Numeric' | 'Alphanumeric' | 'Password'
 * @param {number} opts.minLength  Min characters required
 * @param {number} opts.maxLength  Max characters allowed
 * @param {number} opts.timeoutSec How long to wait for customer input (default 60s)
 * @param {string} opts.referenceId Unique UUID (use generateReferenceId())
 */
export async function userInput(merchant, opts) {
  const client = createClient(merchant);
  const body = {
    ...buildBasePayload(merchant, opts),
    ReferenceId: opts.referenceId,
    Title:       opts.title     || 'Input',
    Prompt:      opts.prompt    || 'Please enter:',
    InputType:   opts.inputType || 'Numeric',
    MinLength:   opts.minLength ?? 1,
    MaxLength:   opts.maxLength ?? 20,
    TimeoutSec:  opts.timeoutSec ?? 60,
  };

  try {
    const { data } = await client.post('/v2/Common/UserInput', body);
    const gen = data?.GeneralResponse || {};
    const approved = gen.StatusCode === '0000' || gen.ResultCode === 'Ok';
    return {
      approved,
      statusCode: gen.StatusCode || null,
      message:    gen.Message    || null,
      // Customer's typed input — lives on the top-level response
      value:      data?.Value || data?.UserInput || data?.Input || null,
      referenceId: opts.referenceId,
      transactionType: 'userInput',
      _raw: data,
    };
  } catch (err) {
    return handleError(err, 'userInput');
  }
}

/**
 * Check if the terminal is connected and reachable.
 * Uses GET (unlike other endpoints which are POST).
 */
export async function terminalStatus(merchant) {
  const client = createClient(merchant);
  try {
    const { data } = await client.get('/v2/Common/TerminalStatus', {
      params: { Tpn: merchant.spinTpn, Authkey: merchant.spinAuthKey },
    });
    return {
      connected: data?.Connected === true || data?.GeneralResponse?.ResultCode === 'Ok',
      message: data?.GeneralResponse?.Message || (data?.Connected ? 'Connected' : 'Not connected'),
      _raw: data,
    };
  } catch (err) {
    return {
      connected: false,
      message: err.message || 'Terminal unreachable',
      _raw: null,
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PAYMENT TYPE HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/** Map Storv tender methods to Dejavoo PaymentType enum */
export const PAYMENT_TYPE_MAP = {
  card:      'Card',      // terminal decides credit vs debit based on card
  credit:    'Credit',
  debit:     'Debit',
  ebt_food:  'EBT_Food',
  ebt_cash:  'EBT_Cash',
  gift:      'Gift',
};

/** Map Dejavoo StatusCode to human-readable message */
export const STATUS_MESSAGES = {
  '0000': 'Approved',
  '1000': 'Terminal busy — try again',
  '1001': 'Terminal not found',
  '1011': 'Duplicate transaction reference',
  '1012': 'Transaction canceled by customer',
  '1015': 'Declined',
  '2001': 'Terminal not connected',
  '2007': 'Transaction timed out',
  '2008': 'Terminal in use — wait and retry',
};
