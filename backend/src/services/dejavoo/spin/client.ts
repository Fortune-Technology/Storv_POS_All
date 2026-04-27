/**
 * Dejavoo SPIn — HTTP client + base URL resolution + reference ID generation.
 *
 * Splitting these out so the higher-level transaction modules don't need to
 * know about axios or env vars. The `createClient(merchant)` function returns
 * an axios instance pre-configured with the right base URL and headers for
 * that merchant's environment (UAT vs Prod, or per-merchant override).
 */

import axios, { type AxiosInstance } from 'axios';
import crypto from 'crypto';
import type { DejavooSpinMerchant } from './types.js';

// Defaults pulled from env at module load. Per-merchant override
// (`merchant.spinBaseUrl`) wins over these.
//
// Source: https://app.theneo.io/dejavoo/spin/spin-rest-api-methods
//   Production: https://spinpos.net
//   Sandbox:    https://test.spinpos.net
//
// The historical `https://api.spinpos.net` value worked for some legacy
// integrations but the canonical PROD host per Theneo docs is the bare
// domain. Env var still wins so we can override per-deployment if Dejavoo
// hands us a regional / legacy host.
const UAT_BASE  = process.env.DEJAVOO_SPIN_BASE_UAT  || 'https://test.spinpos.net/spin';
const PROD_BASE = process.env.DEJAVOO_SPIN_BASE_PROD || 'https://spinpos.net';

/** Trim trailing slash + pick UAT/Prod default. Per-merchant override wins. */
export function getBaseUrl(merchant: DejavooSpinMerchant): string {
  if (merchant.spinBaseUrl) return merchant.spinBaseUrl.replace(/\/$/, '');
  return merchant.environment === 'prod' ? PROD_BASE : UAT_BASE;
}

/**
 * Generate a unique ReferenceId for one SPIn transaction.
 * UUID v4 — unpredictable, no information leakage, no collision risk.
 * The human-readable POS tx number goes in InvoiceNumber instead.
 */
export function generateReferenceId(): string {
  return crypto.randomUUID();
}

/**
 * Build an axios client for one SPIn call.
 * `spinTimeout` is in seconds (Dejavoo's terminals can take a couple of
 * minutes to prompt the customer + read the card).
 */
export function createClient(merchant: DejavooSpinMerchant): AxiosInstance {
  const baseURL = getBaseUrl(merchant);
  return axios.create({
    baseURL,
    timeout: (merchant.spinTimeout || 120) * 1000,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Tiny error → string helper used everywhere errors get logged. */
export const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
