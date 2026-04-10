/**
 * Order Controller — Purchase Order management endpoints
 */

import prisma from '../config/postgres.js';
import { generateOrderSuggestions, nextPONumber } from '../services/orderEngine.js';
import PDFDocument from 'pdfkit';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── GET /api/vendor-orders/suggestions ───────────────────────────────────────
export const getSuggestions = async (req, res, next) => {
  try {
    const result = await generateOrderSuggestions(req.orgId, req.storeId);
    res.json(result);
  } catch (err) { next(err); }
};

// ── POST /api/vendor-orders/generate ─────────────────────────────────────────
// Creates draft POs from suggestion data.
// Body: { vendorIds: [1,2,3] } — which vendor groups to create POs for
// If vendorIds is empty/missing, creates POs for all suggested vendors.
export const generatePOs = async (req, res, next) => {
  try {
    const { vendorIds, suggestions: rawSuggestions } = req.body;
    const orgId = req.orgId;
    const storeId = req.storeId;
    const userId = req.user.id;

    // Re-run algorithm if suggestions not provided
    let data;
    if (rawSuggestions) {
      data = { vendorGroups: rawSuggestions };
    } else {
      data = await generateOrderSuggestions(orgId, storeId);
    }

    const groups = data.vendorGroups || [];
    const targetGroups = vendorIds?.length
      ? groups.filter(g => vendorIds.includes(g.vendorId))
      : groups;

    const createdPOs = [];

    for (const group of targetGroups) {
      if (!group.items?.length) continue;

      const poNumber = await nextPONumber();
      const vendor = await prisma.vendor.findUnique({ where: { id: group.vendorId }, select: { leadTimeDays: true } });
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() + (vendor?.leadTimeDays || 3));

      const subtotal = r2(group.items.reduce((s, i) => s + (i.lineTotal || 0), 0));

      const po = await prisma.purchaseOrder.create({
        data: {
          orgId,
          storeId,
          vendorId:    group.vendorId,
          poNumber,
          status:      'draft',
          expectedDate,
          subtotal,
          grandTotal:  subtotal,
          generatedBy: 'suggestion',
          createdById: userId,
          items: {
            create: group.items.map(item => ({
              masterProductId: item.productId,
              qtyOrdered:      item.orderUnits,
              qtyCases:        item.orderCases,
              unitCost:        item.unitCost,
              caseCost:        item.caseCost,
              lineTotal:       item.lineTotal,
              forecastDemand:  item.forecastDemand,
              safetyStock:     item.safetyStock,
              currentOnHand:   item.onHand,
              avgDailySales:   item.avgDailySales,
              reorderReason:   item.reorderReason,
            })),
          },
        },
        include: { items: { include: { product: { select: { name: true, upc: true, brand: true } } } }, vendor: { select: { name: true, code: true } } },
      });

      createdPOs.push(po);
    }

    // Update vendor lastOrderedAt
    for (const po of createdPOs) {
      await prisma.vendor.update({ where: { id: po.vendorId }, data: { lastOrderedAt: new Date() } }).catch(() => {});
    }

    res.status(201).json({ success: true, purchaseOrders: createdPOs, count: createdPOs.length });
  } catch (err) { next(err); }
};

// ── GET /api/vendor-orders/purchase-orders ───────────────────────────────────
export const listPurchaseOrders = async (req, res, next) => {
  try {
    const { status, vendorId, page = 1, limit = 50 } = req.query;
    const where = { orgId: req.orgId };
    if (req.storeId) where.storeId = req.storeId;
    if (status) where.status = status;
    if (vendorId) where.vendorId = parseInt(vendorId);

    const [orders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          vendor: { select: { id: true, name: true, code: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    res.json({ orders, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
};

// ── GET /api/vendor-orders/purchase-orders/:id ──────────────────────────────
export const getPurchaseOrder = async (req, res, next) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: true,
        items: {
          include: { product: { select: { id: true, name: true, upc: true, brand: true, casePacks: true, department: { select: { name: true } } } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    res.json(po);
  } catch (err) { next(err); }
};

// ── PUT /api/vendor-orders/purchase-orders/:id ──────────────────────────────
export const updatePurchaseOrder = async (req, res, next) => {
  try {
    const { items, notes, expectedDate } = req.body;
    const data = {};
    if (notes !== undefined) data.notes = notes;
    if (expectedDate) data.expectedDate = new Date(expectedDate);

    if (items?.length) {
      // Delete existing items and recreate
      await prisma.purchaseOrderItem.deleteMany({ where: { orderId: req.params.id } });
      const subtotal = r2(items.reduce((s, i) => s + (i.lineTotal || i.qtyOrdered * i.unitCost), 0));
      data.subtotal = subtotal;
      data.grandTotal = subtotal;

      await prisma.purchaseOrderItem.createMany({
        data: items.map(i => ({
          orderId:         req.params.id,
          masterProductId: i.masterProductId || i.productId,
          qtyOrdered:      i.qtyOrdered,
          qtyCases:        i.qtyCases || 0,
          unitCost:        i.unitCost,
          caseCost:        i.caseCost || 0,
          lineTotal:       r2(i.lineTotal || i.qtyOrdered * i.unitCost),
          forecastDemand:  i.forecastDemand,
          safetyStock:     i.safetyStock,
          currentOnHand:   i.currentOnHand,
          avgDailySales:   i.avgDailySales,
          reorderReason:   i.reorderReason,
        })),
      });
    }

    const po = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data,
      include: { vendor: true, items: { include: { product: { select: { name: true, upc: true } } } } },
    });
    res.json(po);
  } catch (err) { next(err); }
};

// ── POST /api/vendor-orders/purchase-orders/:id/submit ──────────────────────
export const submitPurchaseOrder = async (req, res, next) => {
  try {
    const po = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: { status: 'submitted', orderDate: new Date() },
    });

    // Update quantityOnOrder for each item's store product
    const items = await prisma.purchaseOrderItem.findMany({ where: { orderId: po.id } });
    for (const item of items) {
      await prisma.storeProduct.updateMany({
        where: { masterProductId: item.masterProductId, storeId: po.storeId },
        data: { quantityOnOrder: { increment: item.qtyOrdered } },
      }).catch(() => {});
    }

    res.json({ success: true, status: 'submitted' });
  } catch (err) { next(err); }
};

// ── POST /api/vendor-orders/purchase-orders/:id/receive ─────────────────────
// Body: { items: [{ id: itemId, qtyReceived: number }] }
export const receivePurchaseOrder = async (req, res, next) => {
  try {
    const { items } = req.body;
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });

    let allReceived = true;
    for (const recv of (items || [])) {
      const poItem = po.items.find(i => i.id === recv.id);
      if (!poItem) continue;

      const qtyRecv = parseInt(recv.qtyReceived) || 0;
      await prisma.purchaseOrderItem.update({
        where: { id: recv.id },
        data: { qtyReceived: qtyRecv },
      });

      // Update store inventory
      await prisma.storeProduct.updateMany({
        where: { masterProductId: poItem.masterProductId, storeId: po.storeId },
        data: {
          quantityOnHand:  { increment: qtyRecv },
          quantityOnOrder: { decrement: poItem.qtyOrdered },
          lastReceivedAt:  new Date(),
          lastStockUpdate: new Date(),
        },
      }).catch(() => {});

      if (qtyRecv < poItem.qtyOrdered) allReceived = false;
    }

    const status = allReceived ? 'received' : 'partial';
    await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: { status, receivedDate: allReceived ? new Date() : undefined },
    });

    res.json({ success: true, status });
  } catch (err) { next(err); }
};

// ── DELETE /api/vendor-orders/purchase-orders/:id ────────────────────────────
export const deletePurchaseOrder = async (req, res, next) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (po.status !== 'draft') return res.status(400).json({ error: 'Only draft POs can be deleted' });

    await prisma.purchaseOrder.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ── GET /api/vendor-orders/purchase-orders/:id/pdf ──────────────────────────
export const getPurchaseOrderPDF = async (req, res, next) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: true,
        items: { include: { product: { select: { name: true, upc: true, brand: true, casePacks: true } } } },
      },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });

    // Get store info for letterhead
    const store = await prisma.store.findUnique({ where: { id: po.storeId }, select: { name: true, address: true } });

    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${po.poNumber}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text(store?.name || 'Store', { align: 'left' });
    doc.fontSize(10).font('Helvetica').text(store?.address || '', { align: 'left' });
    doc.moveDown();

    // PO Details
    doc.fontSize(16).font('Helvetica-Bold').text('PURCHASE ORDER', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`PO Number: ${po.poNumber}`);
    doc.text(`Date: ${new Date(po.orderDate).toLocaleDateString()}`);
    doc.text(`Expected: ${po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : 'TBD'}`);
    doc.text(`Status: ${po.status.toUpperCase()}`);
    doc.moveDown();

    // Vendor
    doc.font('Helvetica-Bold').text('VENDOR');
    doc.font('Helvetica');
    doc.text(`${po.vendor.name}${po.vendor.code ? ` (${po.vendor.code})` : ''}`);
    if (po.vendor.contactName) doc.text(`Contact: ${po.vendor.contactName}`);
    if (po.vendor.email) doc.text(`Email: ${po.vendor.email}`);
    if (po.vendor.phone) doc.text(`Phone: ${po.vendor.phone}`);
    if (po.vendor.terms) doc.text(`Terms: ${po.vendor.terms}`);
    doc.moveDown();

    // Items table header
    const tableTop = doc.y;
    const cols = [50, 180, 310, 370, 430, 490];
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text('#', cols[0], tableTop);
    doc.text('Product', cols[1], tableTop);
    doc.text('UPC', cols[2], tableTop);
    doc.text('Qty', cols[3], tableTop);
    doc.text('Unit Cost', cols[4], tableTop);
    doc.text('Total', cols[5], tableTop);
    doc.moveTo(50, tableTop + 14).lineTo(560, tableTop + 14).stroke();

    // Items
    doc.font('Helvetica').fontSize(8);
    let y = tableTop + 20;
    po.items.forEach((item, i) => {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.text(String(i + 1), cols[0], y);
      doc.text((item.product?.name || 'Unknown').substring(0, 28), cols[1], y);
      doc.text(item.product?.upc || '', cols[2], y);
      doc.text(String(item.qtyOrdered), cols[3], y);
      doc.text(`$${Number(item.unitCost).toFixed(2)}`, cols[4], y);
      doc.text(`$${Number(item.lineTotal).toFixed(2)}`, cols[5], y);
      y += 16;
    });

    // Totals
    y += 10;
    doc.moveTo(400, y).lineTo(560, y).stroke();
    y += 8;
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Subtotal:', 400, y);
    doc.text(`$${Number(po.subtotal).toFixed(2)}`, 490, y);
    y += 16;
    doc.fontSize(12);
    doc.text('TOTAL:', 400, y);
    doc.text(`$${Number(po.grandTotal).toFixed(2)}`, 490, y);

    // Notes
    if (po.notes) {
      y += 30;
      doc.fontSize(9).font('Helvetica-Bold').text('Notes:', 50, y);
      doc.font('Helvetica').text(po.notes, 50, y + 14, { width: 500 });
    }

    doc.end();
  } catch (err) { next(err); }
};
