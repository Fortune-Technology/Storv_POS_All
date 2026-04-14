/**
 * Vendor Return Controller
 * Handles creating, managing, and tracking vendor returns/credits.
 */

import prisma from '../config/postgres.js';

// ── Return number generator ───────────────────────────────────────────────
async function nextReturnNumber() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `RET-${today}-`;
  const last = await prisma.vendorReturn.findFirst({
    where: { returnNumber: { startsWith: prefix } },
    orderBy: { returnNumber: 'desc' },
    select: { returnNumber: true },
  });
  const seq = last ? parseInt(last.returnNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// ── GET /api/vendor-returns ───────────────────────────────────────────────
export const listVendorReturns = async (req, res, next) => {
  try {
    const { status, vendorId, from, to, page = 1, limit = 50 } = req.query;
    const where = { orgId: req.orgId };
    if (req.storeId) where.storeId = req.storeId;
    if (status) where.status = status;
    if (vendorId) where.vendorId = parseInt(vendorId);
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to + 'T23:59:59');
    }

    const [returns, total] = await Promise.all([
      prisma.vendorReturn.findMany({
        where,
        include: {
          vendor: { select: { id: true, name: true, code: true } },
          items: { include: { product: { select: { id: true, name: true, upc: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.vendorReturn.count({ where }),
    ]);

    res.json({ returns, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
};

// ── GET /api/vendor-returns/:id ───────────────────────────────────────────
export const getVendorReturn = async (req, res, next) => {
  try {
    const ret = await prisma.vendorReturn.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
      include: {
        vendor: { select: { id: true, name: true, code: true, email: true } },
        items: { include: { product: { select: { id: true, name: true, upc: true } } } },
      },
    });
    if (!ret) return res.status(404).json({ error: 'Return not found' });
    res.json(ret);
  } catch (err) { next(err); }
};

// ── POST /api/vendor-returns ──────────────────────────────────────────────
export const createVendorReturn = async (req, res, next) => {
  try {
    const { vendorId, purchaseOrderId, reason, notes, items } = req.body;
    if (!vendorId || !reason || !items?.length) {
      return res.status(400).json({ error: 'vendorId, reason, and items are required' });
    }

    const returnNumber = await nextReturnNumber();
    const totalAmount = items.reduce((s, i) => s + (Number(i.unitCost) || 0) * (parseInt(i.qty) || 0), 0);

    const ret = await prisma.vendorReturn.create({
      data: {
        orgId: req.orgId,
        storeId: req.storeId || '',
        vendorId: parseInt(vendorId),
        purchaseOrderId: purchaseOrderId || null,
        returnNumber,
        reason,
        notes: notes || null,
        totalAmount: Math.round(totalAmount * 100) / 100,
        createdById: req.user?.id || '',
        items: {
          create: items.map(i => ({
            masterProductId: parseInt(i.masterProductId),
            qty: parseInt(i.qty) || 1,
            unitCost: parseFloat(i.unitCost) || 0,
            lineTotal: Math.round((parseFloat(i.unitCost) || 0) * (parseInt(i.qty) || 1) * 100) / 100,
            reason: i.reason || reason,
          })),
        },
      },
      include: {
        items: { include: { product: { select: { id: true, name: true, upc: true } } } },
        vendor: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(ret);
  } catch (err) { next(err); }
};

// ── POST /api/vendor-returns/:id/submit ───────────────────────────────────
// Submitting deducts inventory
export const submitVendorReturn = async (req, res, next) => {
  try {
    const ret = await prisma.vendorReturn.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
      include: { items: true },
    });
    if (!ret) return res.status(404).json({ error: 'Return not found' });
    if (ret.status !== 'draft') return res.status(400).json({ error: 'Only draft returns can be submitted' });

    // Deduct inventory for returned items
    for (const item of ret.items) {
      await prisma.storeProduct.updateMany({
        where: { masterProductId: item.masterProductId, storeId: ret.storeId },
        data: {
          quantityOnHand: { decrement: item.qty },
          lastStockUpdate: new Date(),
        },
      }).catch(() => {});
    }

    await prisma.vendorReturn.update({
      where: { id: req.params.id },
      data: { status: 'submitted', submittedAt: new Date() },
    });

    res.json({ success: true, status: 'submitted' });
  } catch (err) { next(err); }
};

// ── POST /api/vendor-returns/:id/credit ───────────────────────────────────
// Record credit received from vendor
export const recordVendorCredit = async (req, res, next) => {
  try {
    const { creditAmount } = req.body;
    if (creditAmount == null) return res.status(400).json({ error: 'creditAmount required' });

    await prisma.vendorReturn.update({
      where: { id: req.params.id },
      data: {
        creditReceived: parseFloat(creditAmount),
        status: 'credited',
        creditedAt: new Date(),
      },
    });

    res.json({ success: true, status: 'credited' });
  } catch (err) { next(err); }
};

// ── POST /api/vendor-returns/:id/close ────────────────────────────────────
export const closeVendorReturn = async (req, res, next) => {
  try {
    await prisma.vendorReturn.update({
      where: { id: req.params.id },
      data: { status: 'closed' },
    });
    res.json({ success: true, status: 'closed' });
  } catch (err) { next(err); }
};

// ── DELETE /api/vendor-returns/:id ────────────────────────────────────────
export const deleteVendorReturn = async (req, res, next) => {
  try {
    const ret = await prisma.vendorReturn.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
    });
    if (!ret) return res.status(404).json({ error: 'Return not found' });
    if (ret.status !== 'draft') return res.status(400).json({ error: 'Only draft returns can be deleted' });

    await prisma.vendorReturn.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
};
