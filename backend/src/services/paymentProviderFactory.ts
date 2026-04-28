/**
 * paymentProviderFactory.ts
 *
 * Routes payment operations to the provider service configured on the
 * store's PaymentMerchant. Currently Dejavoo SPIn only; designed to accept
 * additional providers behind the same interface in the future.
 *
 * The cashier app and payment controller call this factory instead of
 * importing provider-specific services directly. This keeps the API
 * contract identical regardless of which terminal brand the store uses.
 *
 * Multi-tenant flow:
 *   1. Controller receives request with stationId or storeId
 *   2. Looks up PaymentMerchant for that store
 *   3. Decrypts credentials via cryptoVault
 *   4. Passes decrypted merchant object to this factory
 *   5. Factory dispatches to the correct provider service
 *   6. Returns a normalized response shape
 */

// SPIn API surface is split across `./dejavoo/spin/{transactions,terminal,…}`;
// `./dejavoo/spin/index.ts` is the barrel that re-exports every public symbol.
// We use a namespace import here because this factory consumes the full
// surface (sale / refund / void / tipAdjust / balance / getCard / abort /
// settle / status / userInput / terminalStatus / generateReferenceId) and
// proxies them through provider-agnostic wrappers.
import * as dejavooSpin from './dejavoo/spin/index.js';
import { decrypt } from '../utils/cryptoVault.js';
import prisma from '../config/postgres.js';
import { statusError } from '../utils/typeHelpers.js';

/** A PaymentMerchant row with its encrypted secrets decrypted in-place. */
export type DecryptedPaymentMerchant = Awaited<
  ReturnType<typeof prisma.paymentMerchant.findUnique>
> & {
  spinAuthKey: string | null;
  hppAuthKey: string | null;
  transactApiKey: string | null;
  spinTpn?: string | null;
};

// Errors thrown from the factory carry an HTTP status hint for the controller.
// `StatusError` + `statusError` are shared utilities — see utils/typeHelpers.

// ── Merchant loader ─────────────────────────────────────────────────────────
// Fetches + decrypts the PaymentMerchant for a given store.
// Cached per-request (not globally) to avoid stale credentials.

export async function loadMerchant(storeId: string | null | undefined): Promise<DecryptedPaymentMerchant> {
  if (!storeId) throw statusError('storeId is required to load payment merchant', 400);

  const merchant = await prisma.paymentMerchant.findUnique({ where: { storeId } });
  if (!merchant) throw statusError('No payment merchant configured for this store. Contact your administrator.', 404);
  if (merchant.status !== 'active') throw statusError('Payment merchant is disabled for this store.', 403);

  // Decrypt secret fields
  return {
    ...merchant,
    spinAuthKey:    merchant.spinAuthKey    ? decrypt(merchant.spinAuthKey)    : null,
    hppAuthKey:     merchant.hppAuthKey     ? decrypt(merchant.hppAuthKey)     : null,
    transactApiKey: merchant.transactApiKey ? decrypt(merchant.transactApiKey) : null,
  } as DecryptedPaymentMerchant;
}

// ── Load merchant by station (looks up station → storeId → merchant) ────────
// Also picks up any PaymentTerminal bound to that station and applies its
// per-device TPN override (used when processor assigns per-lane TPNs).

export async function loadMerchantByStation(stationId: string | null | undefined) {
  if (!stationId) throw statusError('stationId is required', 400);

  const station = await prisma.station.findUnique({
    where: { id: stationId },
    select: { id: true, storeId: true, name: true },
  });
  if (!station) throw statusError('Station not found', 404);

  const merchant = await loadMerchant(station.storeId);

  // Check for a per-station PaymentTerminal with an overrideTpn
  const terminal = await prisma.paymentTerminal.findUnique({ where: { stationId } });
  if (terminal) {
    if (terminal.status === 'inactive') {
      throw statusError(
        'The terminal for this station is marked inactive. Contact your administrator.',
        403,
      );
    }
    if (terminal.overrideTpn) {
      merchant.spinTpn = terminal.overrideTpn;
    }
  }

  return { merchant, station, terminal };
}

// ── Provider dispatcher ─────────────────────────────────────────────────────

/**
 * Provider services share a duck-typed surface. Untyped here so each
 * provider implementation can evolve its argument shapes independently —
 * the factory only forwards calls through.
 */
type ProviderModule = typeof dejavooSpin;

function getProvider(merchant: DecryptedPaymentMerchant): ProviderModule {
  switch (merchant.provider) {
    case 'dejavoo':
      return dejavooSpin;
    default:
      throw statusError(`Unsupported payment provider: "${merchant.provider}"`, 400);
  }
}

// ── Common shapes for the public API ────────────────────────────────────────

export interface SaleOpts {
  amount: number;
  paymentType?: string;
  invoiceNumber: string;
  registerId?: string;
  [key: string]: unknown;
}

export interface RefundOpts extends SaleOpts {
  originalReferenceId?: string;
}

export interface VoidOpts {
  invoiceNumber?: string;
  referenceId?: string;
  [key: string]: unknown;
}

export interface BalanceOpts {
  amount?: number;
  paymentType?: string;
  [key: string]: unknown;
}

export interface TransactionStatusOpts {
  referenceId: string;
  [key: string]: unknown;
}

export interface UserInputOpts {
  prompt?: string;
  inputType?: string;
  [key: string]: unknown;
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC API — these are what the payment controller calls
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Process a card-present sale.
 *
 * `paymentType`: 'card' | 'credit' | 'debit' | 'ebt_food' | 'ebt_cash'
 */
export async function processSale(merchant: DecryptedPaymentMerchant, opts: SaleOpts) {
  const provider = getProvider(merchant);
  // Honor a caller-provided referenceId when present — the cashier-app
  // pre-mints one so it can query Dejavoo Status with the SAME id if the
  // HTTP round-trip times out. This is what enables timeout reconciliation
  // for orphan-approved sales (terminal approved, client gave up).
  // Without a caller value, we still mint our own (legacy behaviour).
  const referenceId =
    (typeof opts.referenceId === 'string' && opts.referenceId.length >= 1 && opts.referenceId.length <= 50)
      ? opts.referenceId
      : provider.generateReferenceId();
  const paymentType = (dejavooSpin.PAYMENT_TYPE_MAP as Record<string, string>)[opts.paymentType?.toLowerCase() ?? ''] || 'Card';

  return provider.sale(merchant, {
    ...opts,
    referenceId,
    paymentType,
  });
}

/**
 * Process a refund / return.
 */
export async function processRefund(merchant: DecryptedPaymentMerchant, opts: RefundOpts) {
  const provider = getProvider(merchant);
  const referenceId = provider.generateReferenceId();
  const paymentType = (dejavooSpin.PAYMENT_TYPE_MAP as Record<string, string>)[opts.paymentType?.toLowerCase() ?? ''] || 'Card';

  return provider.refund(merchant, {
    ...opts,
    referenceId,
    paymentType,
  });
}

/**
 * Void a previous transaction.
 */
export async function processVoid(merchant: DecryptedPaymentMerchant, opts: VoidOpts) {
  const provider = getProvider(merchant);
  const referenceId = provider.generateReferenceId();

  return provider.voidTransaction(merchant, {
    ...opts,
    referenceId,
  });
}

/**
 * EBT balance inquiry.
 */
export async function checkEbtBalance(merchant: DecryptedPaymentMerchant, opts: BalanceOpts) {
  const provider = getProvider(merchant);
  const referenceId = provider.generateReferenceId();
  const paymentType = (dejavooSpin.PAYMENT_TYPE_MAP as Record<string, string>)[opts.paymentType?.toLowerCase() ?? ''] || 'EBT_Food';

  return provider.balance(merchant, {
    ...opts,
    referenceId,
    paymentType,
  });
}

/**
 * Abort an in-flight terminal transaction.
 */
export async function cancelTransaction(
  merchant: DecryptedPaymentMerchant,
  opts: Record<string, unknown>,
) {
  const provider = getProvider(merchant);
  return provider.abort(merchant, opts);
}

/**
 * Check terminal connectivity.
 */
export async function checkTerminalStatus(merchant: DecryptedPaymentMerchant) {
  const provider = getProvider(merchant);
  return provider.terminalStatus(merchant);
}

/**
 * Settle / close batch.
 */
export async function settleBatch(
  merchant: DecryptedPaymentMerchant,
  opts: Record<string, unknown> = {},
) {
  const provider = getProvider(merchant);
  return provider.settle(merchant, opts);
}

/**
 * Look up a transaction's status.
 */
export async function checkTransactionStatus(
  merchant: DecryptedPaymentMerchant,
  opts: TransactionStatusOpts,
) {
  const provider = getProvider(merchant);
  return provider.status(merchant, opts);
}

/**
 * Prompt the customer on the terminal for input (phone number, loyalty code, etc.).
 * Auto-generates a secure UUID for the referenceId.
 */
export async function promptUserInput(merchant: DecryptedPaymentMerchant, opts: UserInputOpts) {
  const provider = getProvider(merchant);
  const referenceId = provider.generateReferenceId();
  // The dejavoo-side userInput defaults every prompt field, so we forward the
  // factory-public opts shape verbatim and rely on those defaults at the
  // boundary — TS infers the JS function signature stricter than the runtime
  // requires.
  return provider.userInput(
    merchant,
    { ...opts, referenceId } as Parameters<typeof provider.userInput>[1],
  );
}
