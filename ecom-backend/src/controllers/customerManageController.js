/**
 * Customer management controller — portal-side customer list + detail.
 */

import prisma from '../config/postgres.js';

export const listCustomers = async (req, res) => {
  try {
    const storeId = req.storeId;
    const { search, page: p, limit: l } = req.query;
    const page = Math.max(1, parseInt(p) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(l) || 20));
    const skip = (page - 1) * limit;

    const where = { storeId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const [customers, total] = await Promise.all([
      prisma.ecomCustomer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: { id: true, name: true, firstName: true, lastName: true, email: true, phone: true, orderCount: true, totalSpent: true, createdAt: true },
      }),
      prisma.ecomCustomer.count({ where }),
    ]);

    res.json({ success: true, data: customers, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getCustomerDetail = async (req, res) => {
  try {
    const customer = await prisma.ecomCustomer.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, firstName: true, lastName: true, email: true, phone: true, addresses: true, orderCount: true, totalSpent: true, createdAt: true },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const orders = await prisma.ecomOrder.findMany({
      where: { customerEmail: customer.email, storeId: req.storeId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    res.json({ success: true, data: { ...customer, orders } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
