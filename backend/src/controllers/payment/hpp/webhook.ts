/**
 * HPP — webhook handler.
 *
 *   POST /api/payment/dejavoo/hpp/webhook/:secret
 *
 * Auth: PUBLIC route (no JWT). Trust comes from two layers:
 *   1. Per-store opaque secret in the URL path → look up the merchant
 *   2. Authorization header echoes "Bearer <secret>" — we set that as
 *      `notificationOption.authHeader` when creating the session, and
 *      iPOSpays sends it back unchanged on the webhook
 *
 * Flow:
 *   1. Find merchant whose webhookSecret matches the URL :secret
 *   2. Verify Authorization header equals "Bearer <secret>"
 *   3. Parse the iposHPResponse envelope
 *   4. Update the matching pending PaymentTransaction (idempotent)
 *   5. Best-effort notify ecom-backend so it can flip its EcomOrder
 *   6. Ack 200 to iPOSpays
 */

import type { Request, Response } from 'express';
import prisma from '../../../config/postgres.js';
import { decrypt } from '../../../utils/cryptoVault.js';
import {
  parseHppResponse,
  verifyWebhookAuthHeader,
  mapStatus,
} from '../../../services/dejavoo/hpp/index.js';
import { notifyEcomBackend, type MerchantRow } from './helpers.js';

interface ParsedHppResponse {
  status?: string;
  transactionReferenceId?: string;
  authCode?: string;
  responseCode?: string | number | null;
  responseMessage?: string;
  cardLast4Digit?: string;
  cardType?: string;
  cardToken?: string;
  amount?: number;
  totalAmount?: number;
}

export const dejavooHppWebhook = async (req: Request, res: Response): Promise<void> => {
  // Temporary debug logs — landing-pad confirmation that iPOSpays' POST
  // actually arrived. Remove after the full HPP round-trip is verified.
  console.log('\n[HPP-WEBHOOK] ─── POST received ───');
  console.log('[HPP-WEBHOOK] secret-fragment=', req.params?.secret?.slice(0, 8) + '...');
  console.log('[HPP-WEBHOOK] auth-header=', (req.get('authorization') || req.get('Authorization') || '(none)').slice(0, 30) + '...');
  console.log('[HPP-WEBHOOK] body=', JSON.stringify(req.body, null, 2));

  try {
    const { secret } = req.params;
    if (!secret) {
      console.log('[HPP-WEBHOOK] REJECT 400 — secret missing in URL');
      res.status(400).json({ ok: false, error: 'Missing secret in URL' });
      return;
    }

    // Find the merchant whose webhook secret decrypts to this URL value.
    // (We can't index by ciphertext, so this is a small linear scan over
    // active hpp-enabled merchants. Fine for a few hundred merchants per
    // server; if scale demands, add an indexed hash column later.)
    const merchants = await prisma.paymentMerchant.findMany({
      where: { hppEnabled: true, hppWebhookSecret: { not: null } },
      select: {
        id: true, orgId: true, storeId: true,
        hppAuthKey: true, hppWebhookSecret: true,
        provider: true, environment: true,
      },
    }) as MerchantRow[];

    const merchant = merchants.find(
      (m: MerchantRow) => m.hppWebhookSecret && decrypt(m.hppWebhookSecret) === secret,
    );
    if (!merchant) {
      console.warn('[HPP-WEBHOOK] REJECT 401 — Unknown webhook secret. Tried secret prefix:', secret.slice(0, 8));
      console.warn('[HPP-WEBHOOK] Number of HPP-enabled merchants scanned:', merchants.length);
      res.status(401).json({ ok: false, error: 'Unknown webhook secret' });
      return;
    }
    console.log('[HPP-WEBHOOK] secret OK — matched merchant', merchant.id);

    // Verify Authorization header matches what we set as `authHeader` when
    // creating the session.
    const incoming = req.get('authorization') || req.get('Authorization') || '';
    if (!verifyWebhookAuthHeader(incoming, secret)) {
      console.warn(`[HPP-WEBHOOK] REJECT 401 — Authorization header mismatch for merchant ${merchant.id}`);
      console.warn('[HPP-WEBHOOK] expected: Bearer <secret>, got:', incoming.slice(0, 30));
      res.status(401).json({ ok: false, error: 'Invalid Authorization' });
      return;
    }
    console.log('[HPP-WEBHOOK] auth header OK');

    // Parse the iposHPResponse envelope
    const payload = parseHppResponse(req.body) as ParsedHppResponse;
    const mappedStatus = mapStatus(payload.status);
    const ref = payload.transactionReferenceId;

    if (!ref) {
      console.warn('[hppWebhook] Missing transactionReferenceId — cannot correlate');
      res.status(400).json({ ok: false, error: 'Webhook missing transactionReferenceId' });
      return;
    }

    // Idempotency: find the pending PaymentTransaction we wrote at create-session
    let tx = await prisma.paymentTransaction.findFirst({
      where: { merchantId: merchant.id, retref: ref, txSource: 'ecom' },
    });

    // If we already finalised this transaction, ack but don't double-update.
    // iPOSpays may retry the webhook on transient network errors.
    if (tx && tx.status !== 'pending') {
      res.json({ ok: true, idempotent: true, paymentTransactionId: tx.id });
      return;
    }

    if (tx) {
      tx = await prisma.paymentTransaction.update({
        where: { id: tx.id },
        data: {
          status:    mappedStatus,
          authCode:  payload.authCode       || tx.authCode,
          respCode:  payload.responseCode != null ? String(payload.responseCode) : tx.respCode,
          respText:  payload.responseMessage || `HPP webhook: ${payload.status}`,
          lastFour:  payload.cardLast4Digit  || tx.lastFour,
          acctType:  payload.cardType        || tx.acctType,
          token:     payload.cardToken       || tx.token,
          capturedAmount: mappedStatus === 'approved'
            ? Number(payload.totalAmount || payload.amount || tx.amount)
            : tx.capturedAmount,
        },
      });
    } else {
      // No pending row found — create one (rare; only happens if the
      // create-session DB write failed but iPOSpays still got the request)
      tx = await prisma.paymentTransaction.create({
        data: {
          orgId:      merchant.orgId,
          storeId:    merchant.storeId,
          merchantId: merchant.id,
          provider:   'dejavoo',
          txSource:   'ecom',
          retref:     ref,
          amount:     Number(payload.amount || payload.totalAmount || 0),
          type:       'sale',
          status:     mappedStatus,
          authCode:   payload.authCode,
          respCode:   payload.responseCode != null ? String(payload.responseCode) : null,
          respText:   payload.responseMessage || `HPP webhook: ${payload.status} (no prior session row)`,
          lastFour:   payload.cardLast4Digit,
          acctType:   payload.cardType,
          token:      payload.cardToken,
        },
      });
    }

    // Best-effort notify ecom-backend (fire-and-forget — don't block the webhook
    // ack on it, since iPOSpays will retry if we don't 200 fast enough)
    if (tx.ecomOrderId) {
      notifyEcomBackend({
        orderId:              tx.ecomOrderId,
        storeId:              merchant.storeId,
        status:               mappedStatus,
        paymentTransactionId: tx.id,
        amount:               payload.totalAmount || payload.amount,
        last4:                payload.cardLast4Digit,
        cardType:             payload.cardType,
        authCode:             payload.authCode,
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[hppWebhook] notify ecom failed:', message);
      });
    }

    res.json({ ok: true, paymentTransactionId: tx.id, status: mappedStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[dejavooHppWebhook]', err);
    res.status(500).json({ ok: false, error: message });
  }
};
