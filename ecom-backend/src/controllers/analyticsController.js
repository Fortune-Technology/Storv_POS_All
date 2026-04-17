/**
 * Analytics controller — KPIs, charts, top products for the portal dashboard.
 */

import prisma from '../config/postgres.js';
import { posCountCustomers } from '../services/posCustomerAuthService.js';

export const getAnalytics = async (req, res) => {
  try {
    const storeId = req.storeId;
    if (!storeId) return res.status(400).json({ error: 'X-Store-Id required' });

    // Bug B5 fix: accept dateFrom/dateTo and exclude cancelled/pending orders
    // from revenue KPIs (pending orders haven't been confirmed as sales yet).
    const { dateFrom, dateTo } = req.query;
    const dateFilter = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom + 'T00:00:00');
    if (dateTo)   dateFilter.lte = new Date(dateTo   + 'T23:59:59.999');

    const baseWhere  = { storeId };
    const rangeWhere = Object.keys(dateFilter).length ? { ...baseWhere, createdAt: dateFilter } : baseWhere;
    // For revenue: exclude cancelled AND pending (not yet confirmed)
    const revenueWhere = { ...rangeWhere, status: { notIn: ['cancelled', 'pending'] } };

    // KPIs — customer count from POS backend, orders from ecom DB
    let customerCount = 0;
    try {
      const countResult = await posCountCustomers(req.orgId, storeId);
      customerCount = countResult.count || 0;
    } catch { /* POS backend unreachable — use 0 */ }

    const [totalOrderCount, revenueOrders, allOrdersForStatus] = await Promise.all([
      // Count all orders in range (for context, even pending/cancelled)
      prisma.ecomOrder.count({ where: rangeWhere }),
      // Revenue orders — real revenue only
      prisma.ecomOrder.findMany({ where: revenueWhere, select: { grandTotal: true, status: true, createdAt: true, lineItems: true } }),
      // All orders for status-breakdown pie
      prisma.ecomOrder.findMany({ where: rangeWhere, select: { grandTotal: true, status: true, createdAt: true } }),
    ]);

    const orders = revenueOrders;
    const orderCount = orders.length;
    const totalRevenue = orders.reduce((s, o) => s + Number(o.grandTotal || 0), 0);
    const avgOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

    // Orders by status — use ALL orders (including cancelled/pending) for the pie
    const statusCounts = {};
    allOrdersForStatus.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });

    // Revenue last 30 days (daily)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const revenueByDay = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      revenueByDay[d.toISOString().slice(0, 10)] = 0;
    }
    orders.forEach(o => {
      if (new Date(o.createdAt) >= thirtyDaysAgo) {
        const day = new Date(o.createdAt).toISOString().slice(0, 10);
        if (revenueByDay[day] !== undefined) revenueByDay[day] += Number(o.grandTotal || 0);
      }
    });
    const revenueTrend = Object.entries(revenueByDay).sort().map(([date, revenue]) => ({ date, revenue: Math.round(revenue * 100) / 100 }));

    // Top products (from line items)
    const productSales = {};
    orders.forEach(o => {
      const items = Array.isArray(o.lineItems) ? o.lineItems : [];
      items.forEach(it => {
        const key = it.name || it.productId;
        if (!productSales[key]) productSales[key] = { name: key, qty: 0, revenue: 0 };
        productSales[key].qty += it.qty || 0;
        productSales[key].revenue += (it.total || (it.price * it.qty)) || 0;
      });
    });
    const topProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    res.json({
      success: true,
      data: {
        kpis: {
          totalRevenue:  Math.round(totalRevenue * 100) / 100,
          orderCount,                                // count of confirmed/non-cancelled orders
          totalOrderCount,                           // includes pending + cancelled
          customerCount,
          avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        },
        statusCounts,
        revenueTrend,
        topProducts,
        window: { dateFrom: dateFrom || null, dateTo: dateTo || null },
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
