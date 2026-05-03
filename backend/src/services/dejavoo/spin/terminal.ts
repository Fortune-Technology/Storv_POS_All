/**
 * Dejavoo SPIn — terminal control + status methods.
 *
 *   abort           — Cancel an in-flight transaction (cashier hit Cancel
 *                     while terminal was prompting the customer)
 *   settle          — Close the day's batch on the terminal
 *   status          — Query a single transaction by ReferenceId
 *   userInput       — Show a custom prompt on the terminal (e.g. phone lookup)
 *   terminalStatus  — Liveness probe — verifies TPN+Auth+RegisterId at Dejavoo
 *
 * `terminalStatus` is the most-loaded function in this file because it's
 * called from the admin "Test" button. We intentionally make it noisy (logs
 * the outgoing request + the response body) so first-time setup is easy to
 * debug.
 */

import type { AxiosError } from 'axios';
import type { DejavooSpinMerchant, SpinOpts } from './types.js';
import { createClient, getBaseUrl, generateReferenceId, errMsg } from './client.js';
import { buildBasePayload, normalizeResponse, handleError } from './payload.js';

/**
 * Abort an in-flight transaction. Cashier-facing: when the cashier taps
 * Cancel while the terminal is prompting the customer, this tells Dejavoo to
 * release the terminal back to idle.
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
 * Settle / close the current batch. Typically called once per day at
 * end-of-shift. Settles all approved transactions and zeroes the open batch.
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
 * Check transaction status by ReferenceId. Used both as a direct lookup
 * (e.g. cashier wants to confirm a tx that timed out client-side) AND
 * internally by `terminalStatus` as a probe.
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
 * lookup, loyalty code, zip code, etc. The customer types on the terminal's
 * keypad; we get the value back when they hit Confirm.
 *
 * Docs: POST /v2/Common/UserInput
 *
 * @param opts
 *   title       Prompt line 1 (e.g. "Phone Number")
 *   prompt      Prompt line 2 (e.g. "Enter 10-digit phone")
 *   inputType   'Numeric' | 'Alphanumeric' | 'Password'
 *   minLength   Min chars required
 *   maxLength   Max chars allowed
 *   timeoutSec  How long to wait for input (default 60s)
 *   referenceId Unique UUID (use generateReferenceId())
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
    const d   = (data as Record<string, unknown>) || {};
    const gen = (d.GeneralResponse as Record<string, unknown>) || {};
    const approved = gen.StatusCode === '0000' || gen.ResultCode === 'Ok';
    return {
      approved,
      statusCode:      gen.StatusCode || null,
      message:         gen.Message    || null,
      // Customer's typed input — lives on the top-level response
      value:           d.Value || d.UserInput || d.Input || null,
      referenceId:     opts.referenceId,
      transactionType: 'userInput',
      _raw:            data,
    };
  } catch (err) {
    return handleError(err, 'userInput');
  }
}

/**
 * Liveness / auth probe.
 *
 * Dejavoo's SPIn REST API doesn't expose a dedicated "ping" / "terminal-status"
 * endpoint. The accepted way to verify connectivity is to call POST
 * /v2/Payment/Status with a randomly-generated ReferenceId — Dejavoo will
 * respond with a structured "transaction not found" payload, which proves:
 *   1. Base URL is correct
 *   2. TPN + AuthKey are valid
 *   3. RegisterId is valid (or not required for that endpoint)
 *   4. Dejavoo cloud is reachable
 *
 * `PaymentType: 'Card'` is REQUIRED — Dejavoo returns 400 with
 *   "Invalid request data : For PaymentType field required values are [...]"
 * if missing. 'Card' is a no-op probe value — we're not actually charging
 * anything.
 *
 * Logs both the outgoing request (with credentials redacted) and the
 * response body unconditionally so first-time setup against a new TPN is
 * easy to debug.
 */
export async function terminalStatus(
  merchant: DejavooSpinMerchant,
): Promise<{ connected: boolean; message: string; _raw: unknown }> {
  const client = createClient(merchant);
  const probeRef = generateReferenceId();
  const body: Record<string, unknown> = {
    ...buildBasePayload(merchant),
    PaymentType: 'Card',
    ReferenceId: probeRef,
  };

  // Outgoing request log — credentials redacted
  const redacted = { ...body, Authkey: body.Authkey ? '••••' : '(missing)' };
  console.warn(
    '[dejavooSpin.terminalStatus] →',
    getBaseUrl(merchant), '/v2/Payment/Status body:',
    JSON.stringify(redacted),
  );

  try {
    const { data, status: httpStatus } = await client.post('/v2/Payment/Status', body);

    // 2xx with a body that has the SPIn shape → Dejavoo accepted us
    if (httpStatus >= 200 && httpStatus < 300 && data) {
      const d = (data as Record<string, unknown>) || {};
      const gen = (d.GeneralResponse as Record<string, unknown>) || {};
      const code = (gen.ResultCode as string) || '';
      const msg  = (gen.Message as string) || (gen.DetailedMessage as string) || '';

      // 'Ok' or 'transaction not found' both mean the API is talking to us.
      // Treat as connected; surface the message so admin can see what came back.
      const looksAuthOk = code === 'Ok' || /not found|no.*reference|invalid.*reference/i.test(msg);

      return {
        connected: looksAuthOk || code !== 'AuthError',
        // IMPORTANT: this probe only validates credentials (TPN + Auth + RegisterId)
        // and the cloud connection. It does NOT verify the physical P17 is online —
        // /v2/Payment/Status is a cloud-only DB lookup, it never pushes to the
        // device. The first real /v2/Payment/Sale will tell us if the terminal is
        // actually reachable. The wording reflects this so admins don't think a
        // green "Test Connection" means the device itself is ready.
        message: looksAuthOk
          ? 'Credentials valid — Dejavoo cloud reachable. (Run a test card sale to verify the P17 device itself is online.)'
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
    // surface Dejavoo's body verbatim — their error messages are actually
    // informative ("Invalid TPN", "Authentication failed", "Terminal not
    // paired"). The default axios message just says "Request failed with
    // status code 400" which is useless.
    const ax = err as AxiosError;
    const httpStatus = ax?.response?.status;
    const respBody  = ax?.response?.data as Record<string, unknown> | undefined;
    const respGen   = (respBody?.GeneralResponse as Record<string, unknown>) || {};

    // Build a rich diagnostic string from all three Dejavoo fields. Their
    // top-level Message is often a generic "Error"; the useful info is in
    // ResultCode + DetailedMessage.
    const resultCode = (respGen.ResultCode as string) || (respGen.StatusCode as string) || '';
    const message1   = (respGen.Message as string) || '';
    const detailed   = (respGen.DetailedMessage as string) || '';
    const fallback   = (respBody?.message as string)
                    || (respBody?.error   as string)
                    || (typeof respBody === 'string' ? respBody : '');
    const parts: string[] = [];
    if (resultCode)                                     parts.push(`[${resultCode}]`);
    if (message1 && message1 !== 'Error')               parts.push(message1);
    if (detailed && detailed !== message1)              parts.push(detailed);
    if (!parts.length && fallback)                      parts.push(fallback);
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

    // Forensic log — even when respBody is empty/undefined. Helps support
    // diagnose without asking the merchant to reproduce.
    console.warn(
      '[dejavooSpin.terminalStatus] ← HTTP', httpStatus,
      'body:',    respBody ? JSON.stringify(respBody).slice(0, 1000) : '(empty)',
      'headers:', JSON.stringify(ax?.response?.headers ?? {}).slice(0, 300),
      'url:',     ax?.config?.url ?? ax?.config?.baseURL ?? '(unknown)',
    );

    return { connected: false, message, _raw: respBody ?? null };
  }
}
