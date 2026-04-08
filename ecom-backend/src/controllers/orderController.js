/**
 * Order controller — handles cart operations, checkout, and order management.
 */

import prisma from '../config/postgres.js';
import { nanoid } from 'nanoid';
import { checkStockWithPOS } from '../services/stockCheckService.js';

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
      paymentMethod,
      scheduledAt,
      notes,
      tipAmount,
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

    // 2. Synchronous stock check with POS backend
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
    const subtotal = items.reduce((sum, i) => sum + (i.price * i.qty), 0);
    const taxTotal = 0; // TODO: implement tax calculation
    const deliveryFee = fulfillmentType === 'delivery' ? 0 : 0; // TODO: from fulfillmentConfig
    const tip = Number(tipAmount) || 0;
    const grandTotal = subtotal + taxTotal + deliveryFee + tip;

    // 4. Create order
    const order = await prisma.ecomOrder.create({
      data: {
        orgId: req.orgId,
        storeId: req.storeId,
        orderNumber: generateOrderNumber(),
        status: 'confirmed',
        fulfillmentType,
        customerName,
        customerEmail,
        customerPhone: customerPhone || null,
        shippingAddress: shippingAddress || null,
        lineItems: items.map(i => ({
          productId: i.productId,
          posProductId: i.posProductId || i.productId,
          name: i.name,
          qty: i.qty,
          price: i.price,
          total: i.price * i.qty,
          imageUrl: i.imageUrl,
        })),
        subtotal,
        taxTotal,
        deliveryFee,
        tipAmount: tip,
        grandTotal,
        paymentStatus: paymentMethod === 'cash_on_pickup' ? 'pending' : 'pending',
        paymentMethod: paymentMethod || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        notes: notes || null,
        confirmedAt: new Date(),
      },
    });

    // 5. Clean up cart
    await prisma.ecomCart.delete({ where: { sessionId } }).catch(() => {});

    res.status(201).json({ success: true, data: order });
  } catch (err) {
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

    const where = { storeId: req.storeId };
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

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
