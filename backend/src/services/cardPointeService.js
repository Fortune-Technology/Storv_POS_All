/**
 * cardPointeService.js
 *
 * Wraps two CardPointe APIs:
 *   1. CardPointe Gateway  — cloud REST API for auth / void / refund / inquire
 *   2. CardPointe Terminal — local HTTPS REST API on each physical pin pad
 *
 * All calls are tenant-scoped (mechId comes from the org's CardPointeMerchant record).
 * No raw PAN / CVV ever passes through this service — terminals tokenise at the hardware
 * level and only return a CardPointe token + masked card info.
 *
 * ── Gateway base URL format ──────────────────────────────────────────────────
 *   UAT:  https://{site}-uat.cardpointe.com/cardconnect/rest
 *   LIVE: https://{site}.cardpointe.com/cardconnect/rest
 *
 * ── Terminal base URL format ─────────────────────────────────────────────────
 *   Direct: https://{terminal-ip}:{port}   (store LAN — requires mTLS cert bypass or signed cert)
 *   Relay:  https://{site}-uat.cardpointe.com  (same host as Gateway — CardPointe hosts relay)
 *
 * All Terminal API calls use the relay path (hosted), so the backend never needs
 * network access to the store LAN — the terminal calls home to CardPointe.
 */

import axios from 'axios';
import crypto from 'crypto';
import prisma  from '../config/postgres.js';

// ── Encryption helpers (AES-256-GCM) ─────────────────────────────────────────
// Key is derived from APP_SECRET env var so credentials survive restarts.
const ALGO = 'aes-256-gcm';
const KEY  = crypto.createHash('sha256').update(process.env.APP_SECRET || 'storeveu-default-key').digest();

export function encryptCredential(plaintext) {
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptCredential(ciphertext) {
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(dataHex, 'hex')) + decipher.final('utf8');
}

// ── Build base URLs from merchant config ──────────────────────────────────────
export function gatewayBaseUrl({ site = 'fts', isLive = false, baseUrl } = {}) {
  if (baseUrl) return baseUrl.replace(/\/$/, '');
  const host = isLive ? `${site}.cardpointe.com` : `${site}-uat.cardpointe.com`;
  return `https://${host}/cardconnect/rest`;
}

export function terminalBaseUrl({ site = 'fts', isLive = false, baseUrl } = {}) {
  if (baseUrl) return baseUrl.replace(/\/$/, '');
  const host = isLive ? `${site}.cardpointe.com` : `${site}-uat.cardpointe.com`;
  return `https://${host}`;
}

// ── Load merchant config from DB ──────────────────────────────────────────────
export async function getMerchantConfig(orgId) {
  const m = await prisma.cardPointeMerchant.findUnique({ where: { orgId } });
  if (!m) return null;
  return {
    ...m,
    apiPasswordDecrypted: decryptCredential(m.apiPassword),
  };
}

// ── HTTP clients ──────────────────────────────────────────────────────────────

/** Basic-auth header for Gateway API */
function gwAuthHeader(apiUser, apiPassword) {
  return 'Basic ' + Buffer.from(`${apiUser}:${apiPassword}`).toString('base64');
}

/** Shared axios config for Gateway calls */
function gwAxios(merchant) {
  return axios.create({
    baseURL: gatewayBaseUrl(merchant),
    headers: {
      'Content-Type': 'application/json',
      Authorization: gwAuthHeader(merchant.apiUser, merchant.apiPasswordDecrypted),
    },
    timeout: 30000,
  });
}

/** Shared axios config for Terminal API calls (relay path — no LAN access needed) */
function termAxios(merchant) {
  return axios.create({
    baseURL: terminalBaseUrl(merchant),
    headers: { 'Content-Type': 'application/json' },
    timeout: 90000, // terminals can take 60–90 s while customer interacts
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// GATEWAY API
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /auth — authorize (and optionally capture) a card transaction.
 *
 * @param {object} merchant  - loaded from getMerchantConfig()
 * @param {object} body      - CardPointe /auth request payload
 * @returns CardPointe auth response
 *
 * Minimum required fields:
 *   { account (token), amount, expiry, currency, merchid }
 * Optional:
 *   { capture: 'Y', orderid, name, address, city, region, country, postal }
 */
export async function gatewayAuth(merchant, body) {
  const client = gwAxios(merchant);
  const payload = {
    merchid:  merchant.merchId,
    currency: 'USD',
    capture:  'Y',       // auto-capture — single-message auth+capture for retail
    ...body,
  };
  const resp = await client.put('/auth', payload);
  return resp.data;
}

/**
 * POST /void — void an open (not-yet-settled) authorization.
 *
 * @param {object} merchant
 * @param {string} retref   - retrieval reference from original auth
 */
export async function gatewayVoid(merchant, retref) {
  const client = gwAxios(merchant);
  const resp = await client.post('/void', {
    merchid: merchant.merchId,
    retref,
  });
  return resp.data;
}

/**
 * POST /refund — refund a settled transaction.
 *
 * @param {object} merchant
 * @param {string} retref   - original retref
 * @param {string} amount   - partial refund amount, or omit for full refund
 */
export async function gatewayRefund(merchant, retref, amount) {
  const client = gwAxios(merchant);
  const payload = { merchid: merchant.merchId, retref };
  if (amount != null) payload.amount = String(amount);
  const resp = await client.post('/refund', payload);
  return resp.data;
}

/**
 * GET /inquire/:retref/:merchid — look up a transaction by retref.
 */
export async function gatewayInquire(merchant, retref) {
  const client = gwAxios(merchant);
  const resp = await client.get(`/inquire/${retref}/${merchant.merchId}`);
  return resp.data;
}

// ═════════════════════════════════════════════════════════════════════════════
// TERMINAL API  (CardPointe Integrated Terminal — cloud relay)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v2/connect — establish a session with the terminal.
 * Must be called before authCard / readSignature.
 *
 * @param {object} merchant
 * @param {string} hsn      - hardware serial number of terminal
 */
export async function terminalConnect(merchant, hsn) {
  const client = termAxios(merchant);
  const resp = await client.post('/api/v2/connect', {
    merchantId: merchant.merchId,
    hsn,
  });
  return resp.data; // { connected: true }
}

/**
 * POST /api/v2/disconnect — release the terminal session.
 */
export async function terminalDisconnect(merchant, hsn) {
  const client = termAxios(merchant);
  try {
    const resp = await client.post('/api/v2/disconnect', {
      merchantId: merchant.merchId,
      hsn,
    });
    return resp.data;
  } catch {
    // Disconnect errors are non-fatal — the session expires automatically
    return { disconnected: true };
  }
}

/**
 * POST /api/v4/authCard — present amount to terminal, customer taps/swipes/inserts,
 * terminal tokenises and calls the Gateway, returns auth result.
 *
 * This is the main "charge" operation. On success:
 *   resp.respcode === "00"  → approved
 *   resp.token              → CardPointe token (for future use)
 *   resp.account            → masked PAN (e.g. "41XXXXXXXXXX1111")
 *   resp.authcode           → approval code
 *   resp.retref             → retrieval reference
 *
 * @param {object} merchant
 * @param {string} hsn
 * @param {object} opts     - { amount, invoiceId, capture, includeSignature, printReceipt }
 */
export async function terminalAuthCard(merchant, hsn, opts = {}) {
  const client = termAxios(merchant);
  const resp = await client.post('/api/v4/authCard', {
    merchantId:       merchant.merchId,
    hsn,
    amount:           String(opts.amount),
    includeSignature: opts.includeSignature ?? false,
    printReceipt:     opts.printReceipt ?? 'NO',  // 'NO' — cashier app prints its own
    capture:          opts.capture ?? 'Y',         // auto-capture for retail
    ...(opts.invoiceId ? { invoiceId: opts.invoiceId } : {}),
    ...(opts.orderId   ? { orderId:   opts.orderId   } : {}),
  });
  return resp.data;
}

/**
 * POST /api/v2/readSignature — prompt customer for a signature on the terminal.
 * Returns a base64-encoded SVG.
 *
 * @param {object} merchant
 * @param {string} hsn
 * @param {string} [prompt]  - optional on-screen instruction
 */
export async function terminalReadSignature(merchant, hsn, prompt) {
  const client = termAxios(merchant);
  const resp = await client.post('/api/v2/readSignature', {
    merchantId: merchant.merchId,
    hsn,
    ...(prompt ? { prompt } : {}),
  });
  return resp.data; // { signature: '<base64-SVG>' }
}

/**
 * POST /api/v2/cancel — cancel a pending terminal operation.
 * Safe to call at any time.
 */
export async function terminalCancel(merchant, hsn) {
  const client = termAxios(merchant);
  try {
    const resp = await client.post('/api/v2/cancel', {
      merchantId: merchant.merchId,
      hsn,
    });
    return resp.data;
  } catch {
    return { cancelled: true };
  }
}

/**
 * POST /api/v2/ping — check terminal reachability (does NOT require connect first).
 * Returns { connected: true/false, status: 'Online'/'Offline' }.
 */
export async function terminalPing(merchant, hsn) {
  const client = termAxios(merchant);
  const start = Date.now();
  try {
    const resp = await client.post('/api/v2/ping', {
      merchantId: merchant.merchId,
      hsn,
    });
    return { connected: true, latencyMs: Date.now() - start, raw: resp.data };
  } catch (err) {
    return { connected: false, latencyMs: Date.now() - start, error: err.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// HIGH-LEVEL HELPERS  (used by paymentController)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Resolve amount to cents-free string: "26.94" (CardPointe uses decimal strings)
 */
export function fmtAmount(raw) {
  return Number(raw).toFixed(2);
}

/**
 * Map CardPointe Terminal API respcode to human-readable status.
 * "00" = approved; everything else = declined/error.
 */
export function parseTerminalResult(data) {
  const respcode = data?.respcode ?? data?.respCode ?? '';
  const approved = respcode === '00' || respcode === '000';
  return {
    approved,
    respcode,
    resptext:   data?.resptext ?? data?.respText ?? '',
    retref:     data?.retref   ?? null,
    token:      data?.token    ?? null,
    lastFour:   data?.account ? data.account.slice(-4) : null,
    acctType:   data?.accttype ?? data?.acctType ?? null,
    expiry:     data?.expiry   ?? null,
    entryMode:  data?.entrymode ?? data?.entryMode ?? null,
    authCode:   data?.authcode  ?? data?.authCode  ?? null,
    signature:  data?.signature ?? null,
  };
}
