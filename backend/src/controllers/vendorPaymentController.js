/**
 * Vendor Payment Controller
 * Back-office managed vendor payments (not tied to cashier shifts).
 *
 * Routes:
 *   GET  /api/catalog/vendor-payments         → listVendorPayments
 *   POST /api/catalog/vendor-payments         → createVendorPayment
 *   PUT  /api/catalog/vendor-payments/:id     → updateVendorPayment
 */

import prisma from '../config/postgres.js';

const getOrgId = (req) => req.orgId || req.user?.orgId;

// ── GET /vendor-payments ──────────────────────────────────────────────────
export const listVendorPayments = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { storeId, dateFrom, dateTo, paymentType, vendorId, limit = 200 } = req.query;

    const where = { orgId };
    if (storeId)     where.storeId     = storeId;
    if (paymentType) where.paymentType = paymentType;
    if (vendorId)    where.vendorId    = parseInt(vendorId);

    if (dateFrom || dateTo) {
      where.paymentDate = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        where.paymentDate.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      }
      if (dateTo) {
        const d = new Date(dateTo);
        where.paymentDate.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      }
    }

    const payments = await prisma.vendorPayment.findMany({
      where,
      orderBy: { paymentDate: 'desc' },
      take: Math.min(parseInt(limit) || 200, 1000),
    });

    // Resolve creator names
    const userIds = [...new Set(payments.map(p => p.createdById).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

    const totalExpense     = payments.filter(p => p.paymentType !== 'merchandise').reduce((s, p) => s + Number(p.amount), 0);
    const totalMerchandise = payments.filter(p => p.paymentType === 'merchandise').reduce((s, p) => s + Number(p.amount), 0);

    res.json({
      success: true,
      payments: payments.map(p => ({
        ...p,
        amount:      Number(p.amount),
        createdByName: userMap[p.createdById] || '',
      })),
      summary: {
        total:             totalExpense + totalMerchandise,
        totalExpense,
        totalMerchandise,
        count:             payments.length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── POST /vendor-payments ─────────────────────────────────────────────────
export const createVendorPayment = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      storeId, vendorId, vendorName,
      amount, paymentType, tenderMethod, notes, paymentDate,
    } = req.body;

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'Amount must be a positive number' });
    }
    if (!paymentType || !['expense', 'merchandise'].includes(paymentType)) {
      return res.status(400).json({ success: false, error: 'paymentType must be expense or merchandise' });
    }

    const payment = await prisma.vendorPayment.create({
      data: {
        orgId,
        storeId:     storeId   || null,
        vendorId:    vendorId  ? parseInt(vendorId)   : null,
        vendorName:  vendorName || null,
        amount:      parseFloat(amount),
        paymentType,
        tenderMethod: tenderMethod || 'cash',
        notes:       notes || null,
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        createdById: req.user.id,
      },
    });

    res.status(201).json({ success: true, data: { ...payment, amount: Number(payment.amount) } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── PUT /vendor-payments/:id ──────────────────────────────────────────────
export const updateVendorPayment = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const { vendorId, vendorName, amount, paymentType, tenderMethod, notes, paymentDate } = req.body;

    const data = {};
    if (vendorId      !== undefined) data.vendorId      = vendorId ? parseInt(vendorId) : null;
    if (vendorName    !== undefined) data.vendorName    = vendorName || null;
    if (amount        !== undefined) data.amount        = parseFloat(amount);
    if (paymentType   !== undefined) data.paymentType   = paymentType;
    if (tenderMethod  !== undefined) data.tenderMethod  = tenderMethod;
    if (notes         !== undefined) data.notes         = notes || null;
    if (paymentDate   !== undefined) data.paymentDate   = new Date(paymentDate);

    const payment = await prisma.vendorPayment.update({
      where: { id, orgId },
      data,
    });

    res.json({ success: true, data: { ...payment, amount: Number(payment.amount) } });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Payment not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};
