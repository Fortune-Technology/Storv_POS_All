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

import axios, { AxiosError, type AxiosInstance } from 'axios';
import crypto from 'crypto';

// ── Public types ────────────────────────────────────────────────────────────

export interface DejavooSpinMerchant {
  spinTpn: string;
  spinAuthKey: string;
  spinBaseUrl?: string | null;
  // RegisterId from iPOSpays portal: TPN → Edit Parameter → Integration.
  // Required by /v2/Payment/Status, /v2/Payment/Sale, etc. — Dejavoo returns
  // 400 without it. One TPN can have multiple lanes; each lane has its own RegisterId.
  spinRegisterId?: string | null;
  spinTimeout?: number;
  environment?: 'uat' | 'prod' | string;
}

export interface SpinOpts {
  registerId?: string;
  printReceipt?: string;
  getReceipt?: string;
  proxyTimeout?: number;
  amount?: number | string;
  paymentType?: string;
  referenceId?: string;
  invoiceNumber?: string;
  captureSignature?: boolean;
  originalReferenceId?: string;
  tipAmount?: number | string;
  title?: string;
  prompt?: string;
  inputType?: string;
  minLength?: number;
  maxLength?: number;
  timeoutSec?: number;
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// ── Base URL resolution ─────────────────────────────────────────────────────

const UAT_BASE  = process.env.DEJAVOO_SPIN_BASE_UAT  || 'https://test.spinpos.net/spin';
const PROD_BASE = process.env.DEJAVOO_SPIN_BASE_PROD || 'https://api.spinpos.net';

function getBaseUrl(merchant: DejavooSpinMerchant): string {
  if (merchant.spinBaseUrl) return merchant.spinBaseUrl.replace(/\/$/, '');
  return merchant.environment === 'prod' ? PROD_BASE : UAT_BASE;
}

// ── Generate secure ReferenceId ─────────────────────────────────────────────
// UUID v4 — unpredictable, no information leakage, no collision risk.
// The human-readable POS tx number goes in InvoiceNumber instead.

export function generateReferenceId(): string {
  return crypto.randomUUID();
}

// ── HTTP client factory ─────────────────────────────────────────────────────

function createClient(merchant: DejavooSpinMerchant): AxiosInstance {
  const baseURL = getBaseUrl(merchant);
  return axios.create({
    baseURL,
    timeout: (merchant.spinTimeout || 120) * 1000, // default 2 min (terminal may prompt user)
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Build common request body ───────────────────────────────────────────────

function buildBasePayload(merchant: DejavooSpinMerchant, opts: SpinOpts = {}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    Tpn:       merchant.spinTpn,
    Authkey:   merchant.spinAuthKey, // decrypted by caller
  };

  // RegisterId — per-call override wins, then per-merchant default, then env fallback.
  // Required by most v2 endpoints; Dejavoo returns 400 without it.
  const registerId = opts.registerId
    || merchant.spinRegisterId
    || process.env.DEJAVOO_TEST_REGISTER_ID;
  if (registerId) payload.RegisterId = registerId;

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

function normalizeResponse(raw: unknown, transactionType: string): Record<string, unknown> {
  const r = (raw as Record<string, unknown>) || {};
  const gen   = (r.GeneralResponse as Record<string, unknown>) || {};
  const card  = (r.CardData as Record<string, unknown>) || {};
  const amts  = (r.Amounts as Record<string, unknown>) || {};
  const emv   = (r.EMVData as Record<string, unknown>) || {};
  const receipt = (r.Receipt as Record<string, unknown>) || {};

  const statusCode = (gen.StatusCode as string) || '';
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
    paymentType:    r.PaymentType      || null,        // 'Credit', 'Debit', 'EBT_Food', etc.
    authCode:       r.AuthCode         || null,
    referenceId:    r.ReferenceId      || null,
    batchNumber:    r.BatchNumber      || null,
    serialNumber:   r.SerialNumber     || null,

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
    merchantReceipt: receipt.MerchantReceipt || null,
    customerReceipt: receipt.CustomerReceipt || null,

    // ── Signature ──
    signatureData:  r.SignatureData  || null,

    // ── Raw (for audit/debug) ──
    _raw: raw,
  };
}

// ── Error handler ───────────────────────────────────────────────────────────

function handleError(err: unknown, transactionType: string): Record<string, unknown> {
  const ax = err as AxiosError;
  if (ax?.response?.data) {
    // Dejavoo returned an error response with body
    return normalizeResponse(ax.response.data, transactionType);
  }
  // Network / timeout error
  return {
    approved: false,
    resultCode: 'NetworkError',
    statusCode: ax?.code === 'ECONNABORTED' ? '2007' : '9999',
    message: errMsg(err) || 'Network error communicating with payment terminal',
    detailedMessage: ax?.code || null,
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
export async function sale(merchant: DejavooSpinMerchant, opts: SpinOpts): Promise<Record<string, unknown>> {
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
export async function refund(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts,
): Promise<Record<string, unknown>> {
  const client = createClient(merchant);
  const body: Record<string, unknown> = {
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
export async function voidTransaction(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts,
): Promise<Record<string, unknown>> {
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
export async function tipAdjust(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts,
): Promise<Record<string, unknown>> {
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
export async function balance(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts,
): Promise<Record<string, unknown>> {
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

/**
 * Abort an in-flight transaction.
 * Call this when the cashier cancels while the terminal is prompting.
 */
export async function abort(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts,
): Promise<Record<string, unknown>> {
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
export async function settle(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts = {},
): Promise<Record<string, unknown>> {
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
export async function status(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts,
): Promise<Record<string, unknown>> {
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
export async function userInput(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts,
): Promise<Record<string, unknown>> {
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
    const d = (data as Record<string, unknown>) || {};
    const gen = (d.GeneralResponse as Record<string, unknown>) || {};
    const approved = gen.StatusCode === '0000' || gen.ResultCode === 'Ok';
    return {
      approved,
      statusCode: gen.StatusCode || null,
      message:    gen.Message    || null,
      // Customer's typed input — lives on the top-level response
      value:      d.Value || d.UserInput || d.Input || null,
      referenceId: opts.referenceId,
      transactionType: 'userInput',
      _raw: data,
    };
  } catch (err) {
    return handleError(err, 'userInput');
  }
}

/**
 * Check if the terminal is reachable and credentials are valid.
 *
 * Dejavoo's SPIn REST API doesn't expose a dedicated "ping" / "terminal-status"
 * endpoint. The accepted way to verify connectivity is to call POST /v2/Payment/Status
 * with a randomly-generated ReferenceId — Dejavoo will respond with a structured
 * "transaction not found" payload, which proves: (1) base URL is correct,
 * (2) TPN + AuthKey are valid, (3) Dejavoo cloud is reachable.
 *
 * We treat any structured 2xx response as "connected", regardless of whether
 * the (fake) transaction was found.
 */
export async function terminalStatus(
  merchant: DejavooSpinMerchant,
): Promise<{ connected: boolean; message: string; _raw: unknown }> {
  const client = createClient(merchant);
  const probeRef = generateReferenceId();
  const body: Record<string, unknown> = {
    ...buildBasePayload(merchant),
    // PaymentType is REQUIRED by /v2/Payment/Status (Dejavoo returns 400
    // with "Invalid request data : For PaymentType field required values
    // are [...]" if missing). 'Card' is a no-op probe value — we're not
    // actually charging anything; the call just round-trips to validate
    // credentials.
    PaymentType: 'Card',
    ReferenceId: probeRef,
  };

  // Log the OUTGOING request (with credentials redacted) so we can see what
  // we actually sent to Dejavoo — invaluable during initial cert.
  const redacted = { ...body, Authkey: body.Authkey ? '••••' : '(missing)' };
  console.warn('[dejavooSpin.terminalStatus] →', getBaseUrl(merchant), '/v2/Payment/Status body:', JSON.stringify(redacted));

  try {
    const { data, status: httpStatus } = await client.post('/v2/Payment/Status', body);

    // 2xx with a body that has the SPIn shape — Dejavoo accepted us
    if (httpStatus >= 200 && httpStatus < 300 && data) {
      const d = (data as Record<string, unknown>) || {};
      const gen = (d.GeneralResponse as Record<string, unknown>) || {};
      const code = (gen.ResultCode as string) || '';
      const msg  = (gen.Message as string) || (gen.DetailedMessage as string) || '';

      // 'Ok' or 'ApiError: transaction not found' both mean the API is talking to us.
      // Treat as connected; surface the message so the admin can see what came back.
      const looksAuthOk = code === 'Ok' || /not found|no.*reference|invalid.*reference/i.test(msg);

      return {
        connected: looksAuthOk || code !== 'AuthError',
        message: looksAuthOk
          ? 'Terminal reachable — credentials valid'
          : (msg || `Dejavoo response: ${code || 'unknown'}`),
        _raw: data,
      };
    }

    return {
      connected: false,
      message: `Unexpected response from Dejavoo (HTTP ${httpStatus})`,
      _raw: data,
    };
  } catch (err) {
    // Map common HTTP errors to plain-language causes. For 4xx responses we
    // surface Dejavoo's body verbatim because their error messages are
    // actually informative ("Invalid TPN", "Authentication failed",
    // "Terminal not paired"). The default axios message just says
    // "Request failed with status code 400" which is useless for diagnosis.
    const ax = err as AxiosError;
    const httpStatus = ax?.response?.status;
    const respBody  = ax?.response?.data as Record<string, unknown> | undefined;
    const respGen   = (respBody?.GeneralResponse as Record<string, unknown>) || {};
    // Build a rich diagnostic string from all three Dejavoo fields. Their
    // top-level Message is often a generic "Error"; the useful info is in
    // ResultCode + DetailedMessage.
    const resultCode = (respGen.ResultCode as string) || (respGen.StatusCode as string) || '';
    const message1   = (respGen.Message  as string) || '';
    const detailed   = (respGen.DetailedMessage as string) || '';
    const fallback   = (respBody?.message as string)
                    || (respBody?.error   as string)
                    || (typeof respBody === 'string' ? respBody : '');
    const parts: string[] = [];
    if (resultCode) parts.push(`[${resultCode}]`);
    if (message1 && message1 !== 'Error') parts.push(message1);
    if (detailed && detailed !== message1) parts.push(detailed);
    if (!parts.length && fallback) parts.push(fallback);
    const respText = parts.join(' ');

    let message: string;
    if (httpStatus === 404) {
      message = 'Endpoint not found — check your provider base URL (DEJAVOO_SPIN_BASE_UAT / _PROD env).';
    } else if (httpStatus === 401 || httpStatus === 403) {
      message = `Auth rejected — check your TPN and Auth Key.${respText ? ` Dejavoo: ${respText}` : ''}`;
    } else if (httpStatus === 400) {
      message = respText
        ? `Dejavoo rejected the request (HTTP 400): ${respText}`
        : 'Dejavoo rejected the request (HTTP 400). Most common cause: TPN/Auth Key/RegisterId mismatch.';
    } else if (ax?.code === 'ECONNREFUSED' || ax?.code === 'ENOTFOUND') {
      message = 'Cannot reach Dejavoo — DNS or network unreachable.';
    } else if (ax?.code === 'ECONNABORTED') {
      message = 'Request timed out before Dejavoo responded.';
    } else {
      message = errMsg(err) || 'Terminal unreachable';
    }

    // Always log a forensic line — even if respBody is empty / undefined.
    // No conditional: we want a visible "← HTTP X" entry for every failed test.
    console.warn(
      '[dejavooSpin.terminalStatus] ← HTTP', httpStatus,
      'body:', respBody ? JSON.stringify(respBody).slice(0, 1000) : '(empty)',
      'headers:', JSON.stringify(ax?.response?.headers ?? {}).slice(0, 300),
      'url:', ax?.config?.url ?? ax?.config?.baseURL ?? '(unknown)',
    );

    return { connected: false, message, _raw: respBody ?? null };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PAYMENT TYPE HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/** Map StoreVeu tender methods to Dejavoo PaymentType enum */
export const PAYMENT_TYPE_MAP: Record<string, string> = {
  card:      'Card',      // terminal decides credit vs debit based on card
  credit:    'Credit',
  debit:     'Debit',
  ebt_food:  'EBT_Food',
  ebt_cash:  'EBT_Cash',
  gift:      'Gift',
};

/** Map Dejavoo StatusCode to human-readable message */
export const STATUS_MESSAGES: Record<string, string> = {
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
