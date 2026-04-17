/**
 * paymentProviderFactory.js
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

import * as dejavooSpin from './dejavooSpinService.js';
import { decrypt } from '../utils/cryptoVault.js';
import prisma from '../config/postgres.js';

// ── Merchant loader ─────────────────────────────────────────────────────────
// Fetches + decrypts the PaymentMerchant for a given store.
// Cached per-request (not globally) to avoid stale credentials.

export async function loadMerchant(storeId) {
  if (!storeId) throw Object.assign(new Error('storeId is required to load payment merchant'), { status: 400 });

  const merchant = await prisma.paymentMerchant.findUnique({ where: { storeId } });
  if (!merchant) throw Object.assign(new Error('No payment merchant configured for this store. Contact your administrator.'), { status: 404 });
  if (merchant.status !== 'active') throw Object.assign(new Error('Payment merchant is disabled for this store.'), { status: 403 });

  // Decrypt secret fields
  return {
    ...merchant,
    spinAuthKey:    merchant.spinAuthKey    ? decrypt(merchant.spinAuthKey)    : null,
    hppAuthKey:     merchant.hppAuthKey     ? decrypt(merchant.hppAuthKey)     : null,
    transactApiKey: merchant.transactApiKey ? decrypt(merchant.transactApiKey) : null,
  };
}

// ── Load merchant by station (looks up station → storeId → merchant) ────────
// Also picks up any PaymentTerminal bound to that station and applies its
// per-device TPN override (used when processor assigns per-lane TPNs).

export async function loadMerchantByStation(stationId) {
  if (!stationId) throw Object.assign(new Error('stationId is required'), { status: 400 });

  const station = await prisma.station.findUnique({
    where: { id: stationId },
    select: { id: true, storeId: true, name: true },
  });
  if (!station) throw Object.assign(new Error('Station not found'), { status: 404 });

  const merchant = await loadMerchant(station.storeId);

  // Check for a per-station PaymentTerminal with an overrideTpn
  const terminal = await prisma.paymentTerminal.findUnique({ where: { stationId } });
  if (terminal) {
    if (terminal.status === 'inactive') {
      throw Object.assign(
        new Error('The terminal for this station is marked inactive. Contact your administrator.'),
        { status: 403 }
      );
    }
    if (terminal.overrideTpn) {
      merchant.spinTpn = terminal.overrideTpn;
    }
  }

  return { merchant, station, terminal };
}

// ── Provider dispatcher ─────────────────────────────────────────────────────

function getProvider(merchant) {
  switch (merchant.provider) {
    case 'dejavoo':
      return dejavooSpin;
    default:
      throw Object.assign(
        new Error(`Unsupported payment provider: "${merchant.provider}"`),
        { status: 400 }
      );
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC API — these are what the payment controller calls
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Process a card-present sale.
 *
 * @param {object} merchant  Decrypted PaymentMerchant
 * @param {object} opts
 * @param {number} opts.amount
 * @param {string} opts.paymentType  'card'|'credit'|'debit'|'ebt_food'|'ebt_cash'
 * @param {string} opts.invoiceNumber  POS transaction number
 * @param {string} [opts.registerId]   Station name
 * @returns {object} Normalized response
 */
export async function processSale(merchant, opts) {
  const provider = getProvider(merchant);
  const referenceId = provider.generateReferenceId();
  const paymentType = dejavooSpin.PAYMENT_TYPE_MAP[opts.paymentType?.toLowerCase()] || 'Card';

  return provider.sale(merchant, {
    ...opts,
    referenceId,
    paymentType,
  });
}

/**
 * Process a refund / return.
 */
export async function processRefund(merchant, opts) {
  const provider = getProvider(merchant);
  const referenceId = provider.generateReferenceId();
  const paymentType = dejavooSpin.PAYMENT_TYPE_MAP[opts.paymentType?.toLowerCase()] || 'Card';

  return provider.refund(merchant, {
    ...opts,
    referenceId,
    paymentType,
  });
}

/**
 * Void a previous transaction.
 */
export async function processVoid(merchant, opts) {
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
export async function checkEbtBalance(merchant, opts) {
  const provider = getProvider(merchant);
  const referenceId = provider.generateReferenceId();
  const paymentType = dejavooSpin.PAYMENT_TYPE_MAP[opts.paymentType?.toLowerCase()] || 'EBT_Food';

  return provider.balance(merchant, {
    ...opts,
    referenceId,
    paymentType,
  });
}

/**
 * Abort an in-flight terminal transaction.
 */
export async function cancelTransaction(merchant, opts) {
  const provider = getProvider(merchant);
  return provider.abort(merchant, opts);
}

/**
 * Check terminal connectivity.
 */
export async function checkTerminalStatus(merchant) {
  const provider = getProvider(merchant);
  return provider.terminalStatus(merchant);
}

/**
 * Settle / close batch.
 */
export async function settleBatch(merchant, opts = {}) {
  const provider = getProvider(merchant);
  return provider.settle(merchant, opts);
}

/**
 * Look up a transaction's status.
 */
export async function checkTransactionStatus(merchant, opts) {
  const provider = getProvider(merchant);
  return provider.status(merchant, opts);
}

/**
 * Prompt the customer on the terminal for input (phone number, loyalty code, etc.).
 * Auto-generates a secure UUID for the referenceId.
 */
export async function promptUserInput(merchant, opts) {
  const provider = getProvider(merchant);
  const referenceId = provider.generateReferenceId();
  return provider.userInput(merchant, { ...opts, referenceId });
}
