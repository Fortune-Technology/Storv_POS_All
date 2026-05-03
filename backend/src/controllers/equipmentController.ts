/**
 * equipmentController.ts
 * Public equipment shop — product listing and order placement.
 * Payments charge through Storeveu's own CardPointe merchant account (STOREVEU_ORG_ID).
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import {
  chargeEquipmentOrder,
  nextOrderNumber,
  FREE_SHIPPING_THRESHOLD,
  FLAT_SHIPPING,
} from '../services/billingService.js';

/* GET /api/equipment/products */
export const listProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { category } = req.query as { category?: string };
    const where: Prisma.EquipmentProductWhereInput = { isActive: true };
    if (category) where.category = category;

    const products = await prisma.equipmentProduct.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(products);
  } catch (err) { next(err); }
};

/* GET /api/equipment/products/:slug */
export const getProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const product = await prisma.equipmentProduct.findUnique({
      where: { slug: req.params.slug },
    });
    if (!product || !product.isActive) { res.status(404).json({ error: 'Product not found' }); return; }
    res.json(product);
  } catch (err) { next(err); }
};

interface OrderItemInput {
  productId: string;
  qty: number;
}

interface CreateOrderBody {
  items?: OrderItemInput[];
  customer?: { name?: string; email?: string; phone?: string | null };
  shippingAddress?: { street?: string; [extra: string]: unknown };
  paymentToken?: string;
}

interface PreparedOrderItem {
  productId: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

/* POST /api/equipment/orders */
export const createOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { items, customer, shippingAddress, paymentToken } = req.body as CreateOrderBody;

    if (!items?.length)            { res.status(400).json({ error: 'No items provided' }); return; }
    if (!paymentToken)             { res.status(400).json({ error: 'Payment token required' }); return; }
    if (!customer?.name)           { res.status(400).json({ error: 'Customer name required' }); return; }
    if (!customer?.email)          { res.status(400).json({ error: 'Customer email required' }); return; }
    if (!shippingAddress?.street)  { res.status(400).json({ error: 'Shipping address required' }); return; }

    // Validate items and compute totals
    let subtotal = 0;
    const orderItems: PreparedOrderItem[] = [];

    for (const item of items) {
      if (!item.productId || item.qty < 1) { res.status(400).json({ error: 'Invalid item' }); return; }

      const product = await prisma.equipmentProduct.findUnique({ where: { id: item.productId } });
      if (!product || !product.isActive) {
        res.status(400).json({ error: `Product not found: ${item.productId}` });
        return;
      }
      if (product.trackStock && product.stockQty < item.qty) {
        res.status(400).json({ error: `Insufficient stock for "${product.name}" (have ${product.stockQty}, requested ${item.qty})` });
        return;
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
    let retref: string | undefined;
    let authcode: string | undefined;
    try {
      // chargeEquipmentOrder is a "not configured" stub today — preserved
      // call signature for when it's wired to the real Dejavoo Transact API.
      const charge = chargeEquipmentOrder as unknown as (
        token: string, amount: number, orderNumber: string, customerName: string,
      ) => Promise<{ retref?: string; authcode?: string }>;
      const result = await charge(paymentToken, total, orderNumber, customer.name);
      retref   = result.retref;
      authcode = result.authcode;
    } catch (payErr) {
      const message = payErr instanceof Error ? payErr.message : 'Payment failed';
      res.status(402).json({ error: message });
      return;
    }

    // Create order record
    const order = await prisma.equipmentOrder.create({
      data: {
        orderNumber,
        orgId:           req.user?.orgId || null,
        customerName:    customer.name,
        customerEmail:   customer.email,
        customerPhone:   customer.phone || null,
        shippingAddress: shippingAddress as Prisma.InputJsonValue,
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
export const getOrderStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    res.json(order);
  } catch (err) { next(err); }
};
