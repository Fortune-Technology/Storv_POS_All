/**
 * HPP — create-checkout-session handler.
 *
 *   POST /api/payment/dejavoo/hpp/create-session
 *
 * Auth: server-to-server only (X-Internal-Api-Key middleware enforces this).
 *       Called by ecom-backend when the storefront kicks off checkout.
 *
 * Flow:
 *   1. Look up merchant by storeId
 *   2. Decrypt HPP credentials in-memory
 *   3. Call iPOSpays HPP API to create the hosted-page URL
 *   4. Log a `pending` PaymentTransaction so the webhook can find + finalise it
 *   5. Return the paymentUrl to ecom-backend, which forwards it to the storefront
 */

import type { Request, Response } from 'express';
import prisma from '../../../config/postgres.js';
import {
  createCheckoutSession,
  generateReferenceId,
  buildNotifyUrl,
} from '../../../services/dejavoo/hpp/index.js';
import {
  decryptForHpp,
  getBackendUrl,
  type MerchantRow,
  type DecryptedHppMerchant,
} from './helpers.js';

interface CreateSessionBody {
  storeId?: string;
  orderId?: string;
  amount?: number;
  customerEmail?: string;
  customerName?: string;
  customerPhone?: string;
  description?: string;
  returnUrl?: string;
  failureUrl?: string;
  cancelUrl?: string;
  merchantName?: string;
  logoUrl?: string;
  themeColor?: string;
  notifyUrl?: string;
}

interface CheckoutSessionResult {
  approved?: boolean;
  paymentUrl?: string;
  message?: string;
  _raw?: unknown;
}

export const dejavooHppCreateSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      storeId, orderId, amount,
      customerEmail, customerName, customerPhone,
      description,
      returnUrl, failureUrl, cancelUrl,
      merchantName, logoUrl, themeColor,
      notifyUrl: overrideNotifyUrl,
    } = req.body as CreateSessionBody;

    if (!storeId)   { res.status(400).json({ success: false, error: 'storeId is required' }); return; }
    if (!orderId)   { res.status(400).json({ success: false, error: 'orderId is required' }); return; }
    if (!amount || amount <= 0) {
      res.status(400).json({ success: false, error: 'amount must be > 0' });
      return;
    }
    if (!returnUrl) { res.status(400).json({ success: false, error: 'returnUrl is required' }); return; }

    const merchantRow = await prisma.paymentMerchant.findUnique({ where: { storeId } }) as MerchantRow | null;
    if (!merchantRow) {
      res.status(404).json({ success: false, error: 'No payment merchant configured for this store' });
      return;
    }

    let merchant: DecryptedHppMerchant;
    try {
      merchant = decryptForHpp(merchantRow);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ success: false, error: message });
      return;
    }

    // Generate the unique reference we'll send to iPOSpays. They echo it
    // back in both the redirect query and the webhook, which is how we
    // correlate the payment to our PaymentTransaction.
    const transactionReferenceId = generateReferenceId();
    const notifyUrl = overrideNotifyUrl || buildNotifyUrl(getBackendUrl(), merchant.hppWebhookSecret);

    const result = await createCheckoutSession(
      merchant as unknown as Parameters<typeof createCheckoutSession>[0],
      {
        transactionReferenceId,
        amount,
        customerEmail, customerName, customerPhone,
        description,
        returnUrl, failureUrl, cancelUrl,
        merchantName, logoUrl, themeColor,
        notifyUrl,
      } as Parameters<typeof createCheckoutSession>[1],
    ) as CheckoutSessionResult;

    if (!result.approved || !result.paymentUrl) {
      res.status(502).json({
        success: false,
        error:   result.message || 'iPOSpays did not return a payment URL',
        raw:     result._raw,
      });
      return;
    }

    // Log the pending transaction so the webhook can find + finalise it.
    const paymentTx = await prisma.paymentTransaction.create({
      data: {
        orgId:         merchant.orgId,
        storeId:       merchant.storeId,
        merchantId:    merchant.id,
        provider:      'dejavoo',
        txSource:      'ecom',
        ecomOrderId:   orderId,
        retref:        transactionReferenceId,
        amount,
        type:          'sale',
        status:        'pending',
        respText:      'HPP session created — awaiting payment',
        invoiceNumber: orderId,
      },
    });

    res.json({
      success:                true,
      paymentUrl:             result.paymentUrl,
      transactionReferenceId,
      paymentTransactionId:   paymentTx.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[dejavooHppCreateSession]', err);
    res.status(500).json({ success: false, error: message });
  }
};
