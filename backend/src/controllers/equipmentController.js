/**
 * equipmentController.js
 * Public equipment shop — product listing and order placement.
 * Payments charge through StoreVeu's own CardPointe merchant account (STORV_ORG_ID).
 */

import prisma from '../config/postgres.js';
import {
  chargeEquipmentOrder,
  nextOrderNumber,
  FREE_SHIPPING_THRESHOLD,
  FLAT_SHIPPING,
} from '../services/billingService.js';

/* GET /api/equipment/products */
export const listProducts = async (req, res, next) => {
  try {
    const { category } = req.query;
    const where = { isActive: true };
    if (category) where.category = category;

    const products = await prisma.equipmentProduct.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(products);
  } catch (err) { next(err); }
};

/* GET /api/equipment/products/:slug */
export const getProduct = async (req, res, next) => {
  try {
    const product = await prisma.equipmentProduct.findUnique({
      where: { slug: req.params.slug },
    });
    if (!product || !product.isActive) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) { next(err); }
};

/* POST /api/equipment/orders */
export const createOrder = async (req, res, next) => {
  try {
    const { items, customer, shippingAddress, paymentToken } = req.body;

    if (!items?.length)            return res.status(400).json({ error: 'No items provided' });
    if (!paymentToken)             return res.status(400).json({ error: 'Payment token required' });
    if (!customer?.name)           return res.status(400).json({ error: 'Customer name required' });
    if (!customer?.email)          return res.status(400).json({ error: 'Customer email required' });
    if (!shippingAddress?.street)  return res.status(400).json({ error: 'Shipping address required' });

    // Validate items and compute totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      if (!item.productId || item.qty < 1) return res.status(400).json({ error: 'Invalid item' });

      const product = await prisma.equipmentProduct.findUnique({ where: { id: item.productId } });
      if (!product || !product.isActive) {
        return res.status(400).json({ error: `Product not found: ${item.productId}` });
      }
      if (product.trackStock && product.stockQty < item.qty) {
        return res.status(400).json({ error: `Insufficient stock for "${product.name}" (have ${product.stockQty}, requested ${item.qty})` });
      }

      const lineTotal = Number(product.price) * item.qty;
      subtotal += lineTotal;
      orderItems.push({
        productId: product.id,
        qty:       item.qty,
        unitPrice: Number(product.price),
        lineTotal,
      });
    }

    const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING;
    const total    = subtotal + shipping;

    const orderNumber = await nextOrderNumber();

    // Charge via StoreVeu's CardPointe merchant
    let retref, authcode;
    try {
      const result = await chargeEquipmentOrder(paymentToken, total, orderNumber, customer.name);
      retref   = result.retref;
      authcode = result.authcode;
    } catch (payErr) {
      return res.status(402).json({ error: payErr.message || 'Payment failed' });
    }

    // Create order record
    const order = await prisma.equipmentOrder.create({
      data: {
        orderNumber,
        orgId:           req.user?.orgId || null,
        customerName:    customer.name,
        customerEmail:   customer.email,
        customerPhone:   customer.phone || null,
        shippingAddress,
        subtotal,
        shipping,
        total,
        paymentToken,
        retref,
        authcode,
        paymentStatus:   'paid',
        status:          'processing',
        items: {
          create: orderItems,
        },
      },
      include: {
        items: { include: { product: { select: { name: true, images: true, category: true } } } },
      },
    });

    // Decrement stock for tracked products
    for (const item of orderItems) {
      const product = await prisma.equipmentProduct.findUnique({ where: { id: item.productId } });
      if (product?.trackStock) {
        await prisma.equipmentProduct.update({
          where: { id: item.productId },
          data:  { stockQty: { decrement: item.qty } },
        });
      }
    }

    res.status(201).json(order);
  } catch (err) { next(err); }
};

/* GET /api/equipment/orders/:id */
export const getOrderStatus = async (req, res, next) => {
  try {
    const order = await prisma.equipmentOrder.findUnique({
      where:   { id: req.params.id },
      include: {
        items: {
          include: {
            product: { select: { name: true, images: true } },
          },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) { next(err); }
};
