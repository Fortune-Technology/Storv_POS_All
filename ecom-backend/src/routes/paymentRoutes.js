/**
 * paymentRoutes.js
 *
 * Internal endpoints called by the POS backend's HPP webhook handler.
 * Mounted at /api/internal/orders/* — protected by INTERNAL_API_KEY.
 *
 * The POS backend is the source of truth for payment state (it has the
 * encrypted credentials + processes the iPOSpays webhook). After it
 * commits a PaymentTransaction status change, it calls back to us so we
 * can flip the matching EcomOrder's status + send the customer email.
 */

import { Router } from 'express';
import prisma from '../config/postgres.js';
import { requireInternalApiKey } from '../middleware/internalApiKey.js';

const router = Router();

router.use(requireInternalApiKey);

/**
 * POST /api/internal/orders/payment-status
 * Body:
 *   { orderId, storeId, status: 'approved' | 'declined' | 'voided' | 'pending',
 *     paymentTransactionId, amount, last4, cardType, authCode }
 *
 * iPOSpays HPP response-code → our status enum (per
 * https://docs.ipospays.com/hosted-payment-page/apidocs):
 *
 *   200 — approved    → paymentStatus='paid',   status='confirmed'
 *   400 — declined    → paymentStatus='failed', status='cancelled'  (e.g. insufficient funds, CVV mismatch)
 *   401 — cancelled   → paymentStatus='failed', status='cancelled'  (customer aborted on hosted page)
 *   402 — rejected    → paymentStatus='failed', status='cancelled'  (customer rejected on hosted page)
 *   any other         → 'pending'  (no-op — webhook will re-fire when iPOSpays settles)
 *
 * Edge-case coverage:
 *   • Duplicate webhook    — idempotency check on line below short-circuits
 *                            re-processing without re-firing customer email.
 *   • Network timeout      — handled by iPOSpays' built-in retry policy; this
 *                            handler must respond fast (we ack with 200 even
 *                            on idempotent calls so iPOSpays stops retrying).
 *   • Pending limbo        — order shows "Confirming…" on the order page.
 *                            Stays hidden from admin list (see listOrders'
 *                            paymentMethod='card' AND paymentStatus='paid' filter).
 *   • Reversal / refund    — separate iPOSpays endpoint, NOT this webhook.
 *                            When wired, calls a different handler that maps
 *                            to paymentStatus='refunded'.
 */
router.post('/payment-status', async (req, res) => {
  try {
    const {
      orderId,
      storeId,
      status,
      paymentTransactionId,
      amount,
      last4,
      cardType,
      authCode,
    } = req.body;

    if (!orderId || !status) {
      return res.status(400).json({ ok: false, error: 'orderId and status required' });
    }

    const order = await prisma.ecomOrder.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.status(404).json({ ok: false, error: 'EcomOrder not found' });
    }
    if (storeId && order.storeId !== storeId) {
      return res.status(403).json({ ok: false, error: 'Order belongs to a different store' });
    }

    // Idempotency — if we already finalized this order, ack but don't re-update
    if (order.paymentStatus === 'paid' && status === 'approved') {
      return res.json({ ok: true, idempotent: true, orderId, paymentStatus: order.paymentStatus });
    }

    // Map POS-side payment status → ecom payment + order statuses
    let paymentStatus = order.paymentStatus;
    let orderStatus = order.status;
    const updates = {};

    switch (status) {
      case 'approved':
        paymentStatus = 'paid';
        orderStatus = 'confirmed';
        updates.confirmedAt = new Date();
        break;
      case 'declined':
        paymentStatus = 'failed';
        orderStatus = 'cancelled';
        updates.cancelledAt = new Date();
        updates.cancelReason = 'Payment declined';
        break;
      case 'voided':
        paymentStatus = 'failed';
        orderStatus = 'cancelled';
        updates.cancelledAt = new Date();
        updates.cancelReason = 'Payment cancelled by customer';
        break;
      case 'pending':
      default:
        // No-op — leave status as-is
        return res.json({ ok: true, noop: true, orderId, paymentStatus });
    }

    const updated = await prisma.ecomOrder.update({
      where: { id: orderId },
      data: {
        ...updates,
        paymentStatus,
        status: orderStatus,
        paymentExternalId: paymentTransactionId || order.paymentExternalId,
      },
    });

    // Customer email — only on first successful payment confirmation, and
    // only when we just transitioned from pending → paid. Non-blocking.
    if (status === 'approved' && order.paymentStatus !== 'paid') {
      import('../services/emailService.js').then(({ sendOrderConfirmationEmail }) => {
        prisma.ecomStore.findUnique({
          where: { storeId: order.storeId },
          select: { storeName: true },
        }).then(s => {
          sendOrderConfirmationEmail(s?.storeName || 'Store', updated);
        }).catch(() => {});
      }).catch(() => {});
    }

    return res.json({
      ok: true,
      orderId,
      paymentStatus,
      status: orderStatus,
      _meta: { amount, last4, cardType, authCode },   // echoed for caller logging
    });
  } catch (err) {
    console.error('[ecom payment-status]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
