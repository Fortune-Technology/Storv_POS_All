/**
 * Order controller — handles cart operations, checkout, and order management.
 *
 * Card payments use Dejavoo / iPOSpays HPP (Hosted Payment Page). Flow:
 *   1. Storefront → checkout()      → create EcomOrder (pending) + ask POS to start HPP session
 *   2. checkout() returns paymentUrl → storefront redirects shopper to iPOSpays
 *   3. Shopper enters card on iPOSpays' hosted page (PCI scope is theirs)
 *   4. iPOSpays redirects shopper back to our returnUrl (the order page)
 *   5. iPOSpays POSTs webhook → POS backend → ecom-backend /api/internal/orders/payment-status
 *   6. EcomOrder flips to confirmed; confirmation email sent
 *   7. Order page polls /store/:slug/order/:id until paymentStatus !== 'pending'
 */

import prisma from '../config/postgres.js';
import { nanoid } from 'nanoid';
import { checkStockWithPOS } from '../services/stockCheckService.js';
import { createHppSession } from '../services/paymentService.js';

/* ── Helpers ────────────────────────────────────────────────────────────── */

function generateOrderNumber() {
  const d = new Date();
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = nanoid(6).toUpperCase();
  return `ORD-${dateStr}-${seq}`;
}

/* ── Cart ────────────────────────────────────────────────────────────────── */

export const getCart = async (req, res) => {
  try {
    const cart = await prisma.ecomCart.findUnique({
      where: { sessionId: req.params.sessionId },
    });

    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    res.json({ success: true, data: cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createOrUpdateCart = async (req, res) => {
  try {
    const { sessionId, items } = req.body;

    if (!sessionId || !Array.isArray(items)) {
      return res.status(400).json({ error: 'sessionId and items[] required' });
    }

    // Calculate subtotal
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.qty), 0);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const cart = await prisma.ecomCart.upsert({
      where: { sessionId },
      update: { items, subtotal, expiresAt },
      create: {
        orgId: req.orgId,
        storeId: req.storeId,
        sessionId,
        items,
        subtotal,
        expiresAt,
      },
    });

    res.json({ success: true, data: cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Checkout ───────────────────────────────────────────────────────────── */

export const checkout = async (req, res) => {
  try {
    const {
      sessionId,
      customerName,
      customerEmail,
      customerPhone,
      fulfillmentType,
      shippingAddress,
      paymentMethod,        // 'card' (HPP redirect) | 'cash_on_pickup'
      scheduledAt,
      notes,
      tipAmount,
      // Storefront origin so we can build the return URL iPOSpays redirects
      // the shopper to after payment. Storefront passes window.location.origin.
      returnBaseUrl,
    } = req.body;

    if (!sessionId || !customerName || !customerEmail || !fulfillmentType) {
      return res.status(400).json({ error: 'sessionId, customerName, customerEmail, fulfillmentType required' });
    }

    // 1. Load cart
    const cart = await prisma.ecomCart.findUnique({ where: { sessionId } });
    if (!cart || !cart.items?.length) {
      return res.status(400).json({ error: 'Cart is empty or expired' });
    }
    const items = cart.items;

    // 2. Stock check with POS backend
    const stockItems = items.map(i => ({
      posProductId: i.posProductId || i.productId,
      requestedQty: i.qty,
    }));
    const stockResult = await checkStockWithPOS(req.storeId, stockItems);
    if (!stockResult.available) {
      const outOfStock = stockResult.items.filter(i => !i.available);
      return res.status(409).json({
        error: 'Some items are out of stock',
        outOfStock: outOfStock.map(i => ({
          posProductId: i.posProductId,
          requestedQty: i.requestedQty,
          quantityOnHand: i.quantityOnHand,
        })),
      });
    }

    // 3. Calculate totals
    const subtotal    = items.reduce((sum, i) => sum + (i.price * i.qty), 0);
    const taxTotal    = 0;                                                  // TODO: tax calculation
    const deliveryFee = fulfillmentType === 'delivery' ? 0 : 0;             // TODO: from fulfillmentConfig
    const tip         = Number(tipAmount) || 0;
    const grandTotal  = subtotal + taxTotal + deliveryFee + tip;

    // 4. Create the EcomOrder up front. For card payments we leave it
    //    `pending` until the HPP webhook confirms; for cash-on-pickup we
    //    confirm immediately (the cashier collects payment in person).
    const orderNumber = generateOrderNumber();
    const isCard = paymentMethod === 'card';

    const orderData = {
      orgId:          req.orgId,
      storeId:        req.storeId,
      orderNumber,
      status:         isCard ? 'pending'  : 'confirmed',
      fulfillmentType,
      customerName,
      customerEmail,
      customerPhone:  customerPhone || null,
      shippingAddress: shippingAddress || null,
      lineItems: items.map(i => ({
        productId:    i.productId,
        posProductId: i.posProductId || i.productId,
        name:  i.name,
        qty:   i.qty,
        price: i.price,
        total: i.price * i.qty,
        imageUrl: i.imageUrl,
      })),
      subtotal, taxTotal, deliveryFee,
      tipAmount: tip,
      grandTotal,
      paymentStatus: 'pending',
      paymentMethod: paymentMethod || 'cash_on_pickup',
      scheduledAt:   scheduledAt ? new Date(scheduledAt) : null,
      notes:         notes || null,
      confirmedAt:   isCard ? null : new Date(),
    };

    const order = await prisma.ecomOrder.create({ data: orderData });

    // 5a. Card payment → ask POS backend to create an HPP session.
    //     We DO NOT clear the cart yet — keep it until payment succeeds so
    //     the user can retry without re-entering everything if iPOSpays fails.
    if (isCard) {
      // Build the URL iPOSpays will redirect the shopper to after payment.
      const slug    = req.ecomStore?.slug;
      const baseUrl = (returnBaseUrl || '').replace(/\/$/, '');
      if (!baseUrl || !slug) {
        // Roll back the order so we don't leave a half-baked one in the DB
        await prisma.ecomOrder.delete({ where: { id: order.id } }).catch(() => {});
        return res.status(400).json({
          error: 'returnBaseUrl is required for card checkout',
        });
      }
      const returnUrl = `${baseUrl}/order/${order.id}?store=${encodeURIComponent(slug)}&email=${encodeURIComponent(customerEmail)}`;

      const hpp = await createHppSession({
        storeId:       req.storeId,
        orderId:       order.id,
        amount:        grandTotal,
        returnUrl,
        failureUrl:    returnUrl,                    // same page; it polls payment status
        cancelUrl:     `${baseUrl}/checkout?store=${encodeURIComponent(slug)}&cancelled=1`,
        customerEmail,
        customerName,
        customerPhone: customerPhone || undefined,
        description:   `Order ${orderNumber}`,
        merchantName:  req.ecomStore?.storeName || undefined,
        logoUrl:       req.ecomStore?.branding?.logoUrl || undefined,
        themeColor:    req.ecomStore?.branding?.primaryColor || undefined,
      });

      if (!hpp.success || !hpp.paymentUrl) {
        // Roll back the pending order — it was never paid for
        await prisma.ecomOrder.delete({ where: { id: order.id } }).catch(() => {});
        return res.status(502).json({
          error: hpp.error || 'Could not start payment session — please try again',
        });
      }

      // Stash the iPOSpays reference on the order so support can correlate
      // logs across systems if anything goes wrong.
      await prisma.ecomOrder.update({
        where: { id: order.id },
        data:  { paymentExternalId: hpp.transactionReferenceId },
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        data: {
          id:           order.id,
          orderNumber:  order.orderNumber,
          status:       order.status,
          paymentStatus: order.paymentStatus,
          paymentUrl:   hpp.paymentUrl,        // ← storefront redirects here
        },
      });
    }

    // 5b. Cash on pickup → no online payment; just confirm the order.
    await prisma.ecomCart.delete({ where: { sessionId } }).catch(() => {});

    // Confirmation email (non-blocking)
    import('../services/emailService.js').then(({ sendOrderConfirmationEmail }) => {
      const storeName = req.ecomStore?.storeName || 'Store';
      sendOrderConfirmationEmail(storeName, order);
    }).catch(() => {});

    return res.status(201).json({ success: true, data: order });
  } catch (err) {
    console.error('[checkout]', err);
    res.status(500).json({ error: err.message });
  }
};

/* ── Order Management (Portal) ──────────────────────────────────────────── */

export const listOrders = async (req, res) => {
  try {
    const { status, from, to, page: p, limit: l } = req.query;
    const page = Math.max(1, parseInt(p) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(l) || 20));
    const skip = (page - 1) * limit;

    // Admin-list visibility rule:
    //   • Cash-on-pickup orders → always visible (no online payment to wait for)
    //   • Card orders → only visible once paymentStatus === 'paid'
    //
    // This keeps the back-office list clean of pending/declined/cancelled
    // card attempts. Per spec from
    // https://docs.ipospays.com/hosted-payment-page/apidocs the iPOSpays
    // webhook lifecycle goes:
    //   pending → approved (200) → paid here
    //           → declined (400) → failed here
    //           → cancelled (401, by customer) → failed here
    //           → rejected (402, by customer) → failed here
    // Anything that isn't 'paid' on a card order represents an attempt that
    // didn't complete — admins shouldn't see those clogging the order list.
    const where = {
      storeId: req.storeId,
      OR: [
        // Non-card orders (cash on pickup, future cash on delivery, etc.)
        { paymentMethod: { not: 'card' } },
        // Legacy orders without a paymentMethod set — still show
        { paymentMethod: null },
        // Card orders that completed successfully
        { AND: [{ paymentMethod: 'card' }, { paymentStatus: 'paid' }] },
      ],
    };
    if (status) where.status = status;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from + 'T00:00:00.000Z');
      if (to) where.createdAt.lte = new Date(to + 'T23:59:59.999Z');
    }

    const [orders, total] = await Promise.all([
      prisma.ecomOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.ecomOrder.count({ where }),
    ]);

    res.json({ success: true, data: orders, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getOrder = async (req, res) => {
  try {
    const order = await prisma.ecomOrder.findUnique({
      where: { id: req.params.id },
    });

    if (!order || order.storeId !== req.storeId) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateOrderStatus = async (req, res) => {
  try {
    const { status, cancelReason } = req.body;
    const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled', 'refunded'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const data = { status };
    if (status === 'completed') data.completedAt = new Date();
    if (status === 'cancelled') {
      data.cancelledAt = new Date();
      data.cancelReason = cancelReason || null;
    }

    const order = await prisma.ecomOrder.update({
      where: { id: req.params.id },
      data,
    });

    // Send status update email (non-blocking)
    if (['preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'].includes(status)) {
      import('../services/emailService.js').then(({ sendOrderStatusEmail }) => {
        sendOrderStatusEmail('Store', order);
      }).catch(() => { });
    }

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
