/**
 * Customer management controller — portal-side customer list + detail.
 * Proxies to POS backend for customer data, enriches with ecom order history.
 */

import prisma from '../config/postgres.js';
import { posListCustomers, posGetProfile } from '../services/posCustomerAuthService.js';

export const listCustomers = async (req, res) => {
  try {
    const { search, page, limit } = req.query;

    const result = await posListCustomers(req.orgId, req.storeId, { search, page, limit });
    res.json(result);
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.error || 'Failed to load customers';
    res.status(status).json({ error: message });
  }
};

export const getCustomerDetail = async (req, res) => {
  try {
    const result = await posGetProfile(req.params.id);
    if (!result?.data) return res.status(404).json({ error: 'Customer not found' });

    const customer = result.data;

    // Enrich with order history from ecom database
    const orders = await prisma.ecomOrder.findMany({
      where: { customerEmail: customer.email, storeId: req.storeId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Compute order stats
    const orderCount = orders.length;
    const totalSpent = orders.reduce((s, o) => s + Number(o.grandTotal || 0), 0);

    res.json({
      success: true,
      data: { ...customer, orderCount, totalSpent, orders },
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.error || 'Failed to load customer';
    res.status(status).json({ error: message });
  }
};
