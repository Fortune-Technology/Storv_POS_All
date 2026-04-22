/**
 * Vendor Credit Controller
 *
 * Tracks free-case receipts, mix-and-match bonuses, damaged-goods allowances,
 * and other non-cash credits from vendors. Distinct from VendorPayment
 * (cash going OUT) — credits are value coming IN without charge.
 *
 * Routes (mounted under /api/catalog):
 *   GET    /vendor-credits          → listVendorCredits
 *   POST   /vendor-credits          → createVendorCredit
 *   PUT    /vendor-credits/:id      → updateVendorCredit
 *   DELETE /vendor-credits/:id      → deleteVendorCredit
 */

import prisma from '../config/postgres.js';

const getOrgId = (req) => req.orgId || req.user?.orgId;

const VALID_TYPES = ['free_case', 'mix_match', 'damaged_return', 'adjustment', 'other'];

// ── GET /vendor-credits ───────────────────────────────────────────────────
export const listVendorCredits = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      storeId, dateFrom, dateTo, creditType, vendorId, limit = 200,
    } = req.query;

    const where = { orgId };
    if (storeId)    where.storeId    = storeId;
    if (creditType) where.creditType = creditType;
    if (vendorId)   where.vendorId   = parseInt(vendorId);

    if (dateFrom || dateTo) {
      where.creditDate = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        where.creditDate.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      }
      if (dateTo) {
        const d = new Date(dateTo);
        where.creditDate.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      }
    }

    const credits = await prisma.vendorCredit.findMany({
      where,
      orderBy: { creditDate: 'desc' },
      take: Math.min(parseInt(limit) || 200, 1000),
    });

    // Resolve creator names for UI display
    const userIds = [...new Set(credits.map(c => c.createdById).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

    // Summary totals — grouped by creditType so the UI can show a breakdown
    const byType = {};
    let totalValue = 0;
    let totalCases = 0;
    for (const c of credits) {
      const amt = Number(c.amount);
      totalValue += amt;
      totalCases += c.casesReceived || 0;
      const t = c.creditType || 'other';
      byType[t] = (byType[t] || 0) + amt;
    }

    // Current-month total (per Q2 — monthly totals shown on vendor detail)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthTotal = credits
      .filter(c => new Date(c.creditDate) >= monthStart)
      .reduce((s, c) => s + Number(c.amount), 0);

    res.json({
      success: true,
      credits: credits.map(c => ({
        ...c,
        amount:        Number(c.amount),
        createdByName: userMap[c.createdById] || '',
      })),
      summary: {
        total:        totalValue,
        monthTotal,
        count:        credits.length,
        totalCases,
        byType,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── POST /vendor-credits ──────────────────────────────────────────────────
export const createVendorCredit = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      storeId, vendorId, vendorName,
      amount, creditType, reason, casesReceived, productRef, notes, creditDate,
    } = req.body;

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'Amount must be a positive number' });
    }
    if (creditType && !VALID_TYPES.includes(creditType)) {
      return res.status(400).json({ success: false, error: `creditType must be one of: ${VALID_TYPES.join(', ')}` });
    }

    const credit = await prisma.vendorCredit.create({
      data: {
        orgId,
        storeId:        storeId  || null,
        vendorId:       vendorId ? parseInt(vendorId) : null,
        vendorName:     vendorName || null,
        amount:         parseFloat(amount),
        creditType:     creditType || 'free_case',
        reason:         reason || null,
        casesReceived:  casesReceived != null && casesReceived !== '' ? parseInt(casesReceived) : null,
        productRef:     productRef || null,
        notes:          notes || null,
        creditDate:     creditDate ? new Date(creditDate) : new Date(),
        createdById:    req.user.id,
      },
    });

    res.status(201).json({ success: true, data: { ...credit, amount: Number(credit.amount) } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── PUT /vendor-credits/:id ───────────────────────────────────────────────
export const updateVendorCredit = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const {
      vendorId, vendorName, amount, creditType, reason,
      casesReceived, productRef, notes, creditDate,
    } = req.body;

    const data = {};
    if (vendorId       !== undefined) data.vendorId      = vendorId ? parseInt(vendorId) : null;
    if (vendorName     !== undefined) data.vendorName    = vendorName || null;
    if (amount         !== undefined) data.amount        = parseFloat(amount);
    if (creditType     !== undefined) {
      if (!VALID_TYPES.includes(creditType)) {
        return res.status(400).json({ success: false, error: `creditType must be one of: ${VALID_TYPES.join(', ')}` });
      }
      data.creditType = creditType;
    }
    if (reason         !== undefined) data.reason        = reason || null;
    if (casesReceived  !== undefined) data.casesReceived = casesReceived !== '' && casesReceived != null ? parseInt(casesReceived) : null;
    if (productRef     !== undefined) data.productRef    = productRef || null;
    if (notes          !== undefined) data.notes         = notes || null;
    if (creditDate     !== undefined) data.creditDate    = new Date(creditDate);

    const credit = await prisma.vendorCredit.update({
      where: { id, orgId },
      data,
    });

    res.json({ success: true, data: { ...credit, amount: Number(credit.amount) } });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Credit not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── DELETE /vendor-credits/:id ────────────────────────────────────────────
export const deleteVendorCredit = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    await prisma.vendorCredit.delete({ where: { id, orgId } });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Credit not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};
