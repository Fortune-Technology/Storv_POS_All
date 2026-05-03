/**
 * Dejavoo SPIn — customer-facing display methods.
 *
 *   pushCart      — Update the cart shown on the customer-facing terminal
 *                   screen (live, while the device is in idle/listening mode).
 *                   Used to show line items as they're scanned.
 *
 *   pushReceipt   — Send formatted text/markup to the device's built-in
 *                   thermal printer. Useful for branded customer receipts
 *                   with logos, QR codes, and thank-you messages.
 *
 *   clearCart     — Reset the customer-facing cart display to empty.
 *                   Called between transactions or on shift end.
 *
 * These are SEPARATE from the transactional `sale` / `refund` endpoints —
 * they mutate display state without moving money. Failures are non-fatal:
 * the device falling back to its default screen is fine, while a failed
 * sale isn't. So callers should swallow errors here and just log.
 *
 * Endpoints used (per Theneo SPIn REST API spec):
 *   POST /v2/Payment/Cart   — live cart push (customer display)
 *   POST /v2/Common/Printer — push markup to physical receipt printer
 */
import type { AxiosError } from 'axios';
import type { DejavooSpinMerchant, SpinOpts } from './types.js';
import { createClient, getBaseUrl, errMsg } from './client.js';
import { buildBasePayload } from './payload.js';

/**
 * Cart object structure expected by Dejavoo's /v2/Payment/Cart endpoint.
 * Field-name casing is mandatory — Dejavoo's API is case-sensitive.
 */
export interface DejavooCart {
  Amounts?: Array<{ Name: string; Value: number | null }>;
  CashPrices?: Array<{ Name: string; Value: number | null }>;
  Items?: Array<{
    Name: string;
    Price?: number | null;
    UnitPrice?: number | null;
    Quantity?: number | null;
    AdditionalInfo?: string;
    CustomInfos?: Array<{ Name: string; Value: number | null }>;
    Modifiers?: Array<unknown>;
  }>;
}

/** Standard response shape across customer-display methods. */
export interface DisplayResult {
  success:    boolean;
  message:    string;
  statusCode: string;
  resultCode: string;
  _raw:       unknown;
}

/** Map a SPIn response into our flat DisplayResult shape. */
function normalizeDisplayResponse(
  data: unknown,
  context: string,
): DisplayResult {
  const r   = (data as Record<string, unknown>) || {};
  const gen = (r.GeneralResponse as Record<string, unknown>) || {};
  const code = (gen.ResultCode as string) || '';
  const status = (gen.StatusCode as string) || '';
  // ResultCode '0' or StatusCode '0000' → success
  const success = code === '0' || code === 'Ok' || status === '0000';
  return {
    success,
    message:    (gen.Message as string) || (gen.DetailedMessage as string) || (success ? 'OK' : `${context} failed`),
    statusCode: status,
    resultCode: code,
    _raw:       data,
  };
}

/** Best-effort error → DisplayResult conversion. */
function handleDisplayError(err: unknown, context: string): DisplayResult {
  const ax = err as AxiosError;
  if (ax?.response?.data) {
    return normalizeDisplayResponse(ax.response.data, context);
  }
  return {
    success:    false,
    message:    errMsg(err) || `${context} — network error`,
    statusCode: ax?.code === 'ECONNABORTED' ? '2007' : '9999',
    resultCode: '2',
    _raw:       null,
  };
}

/**
 * Push a cart update to the customer-facing terminal screen.
 *
 * The device shows the items + totals on its display while in idle/
 * listening mode, so the customer can verify the order in real time as
 * the cashier scans. Pass `null` / empty cart to clear the display.
 *
 * Per Theneo spec POST /v2/Payment/Cart accepts the same Cart shape as
 * the embedded `Cart` parameter on /v2/Payment/Sale, but as a standalone
 * push (no charge initiated). Cart object is required by the spec, even
 * if its arrays are empty — that's how we "clear" the display.
 *
 * @returns DisplayResult — non-throwing; check `success`. Caller should
 *   swallow failures — a flaky display push must never block a sale.
 */
export async function pushCart(
  merchant: DejavooSpinMerchant,
  cart: DejavooCart,
  opts: SpinOpts = {},
): Promise<DisplayResult> {
  const client = createClient(merchant);
  const body = {
    ...buildBasePayload(merchant, opts),
    Cart: cart,
  };
  // Verbose log so we can correlate "cart pushed" with what the customer saw.
  console.warn(
    '[dejavooSpin.pushCart] →',
    getBaseUrl(merchant), '/v2/Payment/Cart items:', cart?.Items?.length ?? 0,
    'amounts:', cart?.Amounts?.length ?? 0,
  );
  try {
    const { data, status: httpStatus } = await client.post('/v2/Payment/Cart', body);
    const result = normalizeDisplayResponse(data, 'pushCart');
    console.warn(
      '[dejavooSpin.pushCart] ← HTTP', httpStatus,
      'success:', result.success,
      'message:', result.message,
    );
    return result;
  } catch (err) {
    const result = handleDisplayError(err, 'pushCart');
    console.warn('[dejavooSpin.pushCart] ✗', result.message);
    return result;
  }
}

/**
 * Send formatted markup to the device's built-in thermal printer.
 *
 * Markup syntax (subset, per Theneo docs):
 *   <L>...</L>     left-aligned line
 *   <C>...</C>     centered line
 *   <R>...</R>     right-aligned line
 *   <LG>...</LG>   large text wrapper
 *   <B>...</B>     bold text wrapper
 *   <INV>...</INV> inverted (white-on-black) wrapper
 *   <CD>...</CD>   condensed text wrapper
 *   <BR/>          line break
 *   <IMG>base64</IMG>  PNG image, base64-encoded
 *   <QR>text</QR>      QR code containing text
 *
 * Wrappers can nest: `<LG><B><L>Big bold left</L></B></LG>`.
 *
 * Use cases for us:
 *   - Branded merchant header on every receipt
 *   - "Thank you for shopping at <store>!" footer
 *   - QR code linking to return policy / loyalty signup
 *   - Welcome / promotional message between transactions
 *
 * @returns DisplayResult — non-throwing; check `success`.
 */
export async function pushReceipt(
  merchant: DejavooSpinMerchant,
  printerMarkup: string,
  opts: SpinOpts = {},
): Promise<DisplayResult> {
  const client = createClient(merchant);
  const body = {
    ...buildBasePayload(merchant, opts),
    Printer: printerMarkup,
  };
  console.warn(
    '[dejavooSpin.pushReceipt] →',
    getBaseUrl(merchant), '/v2/Common/Printer length:', printerMarkup.length,
  );
  try {
    const { data, status: httpStatus } = await client.post('/v2/Common/Printer', body);
    const result = normalizeDisplayResponse(data, 'pushReceipt');
    console.warn(
      '[dejavooSpin.pushReceipt] ← HTTP', httpStatus,
      'success:', result.success,
      'message:', result.message,
    );
    return result;
  } catch (err) {
    const result = handleDisplayError(err, 'pushReceipt');
    console.warn('[dejavooSpin.pushReceipt] ✗', result.message);
    return result;
  }
}

/**
 * Reset the customer-facing display by pushing an empty cart.
 *
 * Convenience wrapper around `pushCart({})`. Called between transactions
 * to clear residual line items from the previous customer.
 */
export async function clearCart(
  merchant: DejavooSpinMerchant,
  opts: SpinOpts = {},
): Promise<DisplayResult> {
  return pushCart(merchant, { Items: [], Amounts: [], CashPrices: [] }, opts);
}
