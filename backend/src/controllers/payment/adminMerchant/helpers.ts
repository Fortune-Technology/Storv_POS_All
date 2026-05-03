/**
 * Admin merchant — shared helpers used by every CRUD/lifecycle handler.
 *
 *   SECRET_FIELDS / USER_WRITABLE_SECRETS — which DB columns hold encrypted
 *     credentials, and which of them the admin can set via the form (vs
 *     ones that are auto-generated like hppWebhookSecret)
 *   sanitize(merchant)        — strip ciphertext fields from a response, replace
 *                                with `{fieldSet, fieldPreview}` markers
 *   cleanString(val)          — trim user-pasted strings (whitespace from
 *                                the iPOSpays portal is the #1 cause of "auth
 *                                failed")
 *   buildWriteData(body)      — turn a request body into a Prisma write input,
 *                                handling: trim, secret encryption, and skipping
 *                                undefined fields
 */

import { encrypt, decrypt, mask } from '../../../utils/cryptoVault.js';

/** DB columns that hold encrypted secrets. */
export const SECRET_FIELDS = ['spinAuthKey', 'hppAuthKey', 'hppWebhookSecret', 'transactApiKey'];

/**
 * Subset of SECRET_FIELDS that admin can set/update via the create-edit modal.
 * `hppWebhookSecret` is NOT in this list — it's only set via the dedicated
 * `regenerateHppWebhookSecret` endpoint, which generates a fresh random value.
 */
export const USER_WRITABLE_SECRETS = new Set(['spinAuthKey', 'hppAuthKey', 'transactApiKey']);

/**
 * Replace encrypted secret fields with `{fieldSet, fieldPreview}` markers
 * before sending a merchant to the admin UI. Plaintext credentials never
 * leave the server.
 *
 *   spinAuthKey: <ciphertext> →
 *     spinAuthKeySet: true,
 *     spinAuthKeyPreview: "••••last4"
 *
 * Decryption uses cryptoVault.decrypt() — if the master key is wrong (e.g.
 * left over ciphertext from before a key rotation), `mask(null)` returns
 * empty string and the caller still gets a response, just without a preview.
 */
export function sanitize(merchant: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!merchant) return null;
  const out: Record<string, unknown> = { ...merchant };
  for (const f of SECRET_FIELDS) {
    if (out[f]) {
      out[`${f}Preview`] = mask(decrypt(String(out[f])));
      out[`${f}Set`]     = true;
    } else {
      out[`${f}Preview`] = '';
      out[`${f}Set`]     = false;
    }
    delete out[f];
  }
  return out;
}

/**
 * Normalize a string value pasted from an admin form.
 *
 *   undefined → undefined  (skip — don't include in update)
 *   null      → null       (clear the field)
 *   string    → trimmed string (or null if empty after trim)
 *   other     → as-is
 *
 * Whitespace from copy-paste (iPOSpays portal cells often have leading
 * spaces) is the #1 source of "auth failed" 400s. Strip server-side so the
 * admin UI doesn't have to be careful.
 */
export function cleanString(val: unknown): unknown {
  if (val === undefined) return undefined;
  if (val === null) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed === '' ? null : trimmed;
  }
  return val;
}

/**
 * Build Prisma write data from a request body.
 *
 *   - String fields are trimmed via cleanString()
 *   - Secret fields (in USER_WRITABLE_SECRETS) are trimmed + encrypted
 *   - Empty strings collapse to null (so admin can clear a field)
 *   - undefined values are skipped (not included in the update)
 */
export function buildWriteData(body: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  // Pass-through fields (most are credential-adjacent — TPN, merchant ID,
  // base URLs — where stray whitespace causes auth failures).
  const passthrough = [
    'orgId', 'storeId', 'provider', 'environment',
    'spinTpn', 'spinBaseUrl', 'spinRegisterId',
    'hppMerchantId', 'hppBaseUrl', 'hppEnabled',
    'transactBaseUrl',
    'ebtEnabled', 'debitEnabled', 'tokenizeEnabled',
    'status', 'notes',
  ];
  for (const f of passthrough) {
    if (body[f] !== undefined) data[f] = cleanString(body[f]);
  }

  // Only encrypt + write secrets the admin can set via the modal. Trim
  // before encrypting so a stray trailing newline doesn't poison the cipher.
  for (const f of SECRET_FIELDS) {
    if (!USER_WRITABLE_SECRETS.has(f)) continue;
    const val = body[f];
    if (val === null) {
      data[f] = null;
    } else if (val !== undefined && val !== '') {
      const trimmed = String(val).trim();
      if (trimmed) data[f] = encrypt(trimmed);
    }
  }
  return data;
}
