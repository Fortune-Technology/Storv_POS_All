import prisma from '../config/postgres.js';
import * as gptService from '../services/gptService.js';
// extractMultiplePages is accessed via gptService.extractMultiplePages
import {
  matchLineItems,
  saveConfirmedMappings,
  decrementMapping,
  getPOSCache,
  setPOSCache,
  clearPOSCache,
  loadCatalogProductsForMatching,
} from '../services/matchingService.js';
import fs from 'fs/promises';


// ─────────────────────────────────────────────────────────────────────────────
// Internal: background processing (called after HTTP response is sent)
// ─────────────────────────────────────────────────────────────────────────────
async function processInvoiceBackground(invoiceId, file, user, storeId, orgId) {
  try {
    let posProducts = getPOSCache(user.id);
    if (!posProducts || posProducts.length === 0) {
      posProducts = await loadCatalogProductsForMatching(orgId);
      if (posProducts.length > 0) setPOSCache(user.id, posProducts);
    }
    posProducts = posProducts || [];

    const buffer = await fs.readFile(file.path);
    const result = await gptService.extractInvoiceData(buffer, file.mimetype);
    const { data, pages } = result;

    const enrichedItems = await matchLineItems(data.lineItems, posProducts, data.vendor.vendorName);

    // ── Auto-match to Purchase Order ──────────────────────────────────
    let poMatchResult = null;
    let linkedPurchaseOrderId = null;
    try {
      const { matchInvoiceToPO } = await import('../services/poInvoiceMatchService.js');
      // Save enriched items first so the PO matcher can read them
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { lineItems: enrichedItems, vendorName: data.vendor.vendorName },
      });
      const poMatch = await matchInvoiceToPO(orgId, storeId, invoiceId);
      if (poMatch.matchedPO) {
        linkedPurchaseOrderId = poMatch.matchedPO.id;
        poMatchResult = poMatch;
      }
    } catch (poErr) {
      console.warn(`[Invoice ${invoiceId}] PO matching skipped:`, poErr.message);
    }

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status:             'draft',
        vendorName:         data.vendor.vendorName,
        customerNumber:     data.vendor.customerNumber,
        invoiceNumber:      data.vendor.invoiceNumber,
        invoiceDate:        data.vendor.invoiceDate ? new Date(data.vendor.invoiceDate) : null,
        paymentDueDate:     data.vendor.paymentDueDate ? new Date(data.vendor.paymentDueDate) : null,
        paymentType:        data.vendor.paymentType,
        checkNumber:        data.vendor.checkNumber,
        totalInvoiceAmount: data.vendor.totalInvoiceAmount,
        tax:                data.vendor.tax,
        totalDiscount:      data.vendor.totalDiscount,
        totalDeposit:       data.vendor.totalDeposit,
        otherFees:          data.vendor.otherFees,
        totalCasesReceived: data.vendor.totalCasesReceived,
        totalUnitsReceived: data.vendor.totalUnitsReceived,
        driverName:         data.vendor.driverName,
        salesRepName:       data.vendor.salesRepName,
        loadNumber:         data.vendor.loadNumber,
        lineItems:          enrichedItems,
        pages,
        rawText:            JSON.stringify(data),
        processingError:    null,
        linkedPurchaseOrderId,
        poMatchResult,
      },
    });

    console.log(`✅ Invoice ${invoiceId} processing complete${linkedPurchaseOrderId ? ` (matched PO: ${poMatchResult.matchedPO.poNumber})` : ''}`);
  } catch (err) {
    console.error(`❌ Invoice ${invoiceId} processing failed:`, err.message);
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'failed', processingError: err.message },
    });
  } finally {
    try { await fs.unlink(file.path); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Queue invoice for background processing — responds immediately
// @route   POST /api/invoice/queue
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const queueUpload = async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const stubs = [];

    for (const file of files) {
      const stub = await prisma.invoice.create({
        data: {
          fileName: file.originalname,
          fileType: file.mimetype,
          status:   'processing',
          orgId:    req.orgId   ?? 'unknown',
          storeId:  req.storeId ?? null,
          userId:   req.user.id ?? null,
        },
      });

      stubs.push(stub);

      setImmediate(() =>
        processInvoiceBackground(stub.id, file, req.user, req.storeId, req.orgId).catch(err =>
          console.error('Background processing error:', err)
        )
      );
    }

    res.json({ message: 'Queued for processing', invoices: stubs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal: background processing for multi-page invoices (multiple files = 1 invoice)
// ─────────────────────────────────────────────────────────────────────────────
async function processMultipageBackground(invoiceId, files, user, storeId, orgId) {
  try {
    let posProducts = getPOSCache(user.id);
    if (!posProducts || posProducts.length === 0) {
      posProducts = await loadCatalogProductsForMatching(orgId);
      if (posProducts.length > 0) setPOSCache(user.id, posProducts);
    }
    posProducts = posProducts || [];

    // Read all file buffers
    const fileData = await Promise.all(
      files.map(async (f) => ({ buffer: await fs.readFile(f.path), mimetype: f.mimetype }))
    );

    const { data, pages } = await gptService.extractMultiplePages(fileData);
    const enrichedItems = await matchLineItems(data.lineItems, posProducts, data.vendor.vendorName);

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status:             'draft',
        vendorName:         data.vendor.vendorName,
        customerNumber:     data.vendor.customerNumber,
        invoiceNumber:      data.vendor.invoiceNumber,
        invoiceDate:        data.vendor.invoiceDate ? new Date(data.vendor.invoiceDate) : null,
        paymentDueDate:     data.vendor.paymentDueDate ? new Date(data.vendor.paymentDueDate) : null,
        paymentType:        data.vendor.paymentType,
        checkNumber:        data.vendor.checkNumber,
        totalInvoiceAmount: data.vendor.totalInvoiceAmount,
        tax:                data.vendor.tax,
        totalDiscount:      data.vendor.totalDiscount,
        totalDeposit:       data.vendor.totalDeposit,
        otherFees:          data.vendor.otherFees,
        totalCasesReceived: data.vendor.totalCasesReceived,
        totalUnitsReceived: data.vendor.totalUnitsReceived,
        driverName:         data.vendor.driverName,
        salesRepName:       data.vendor.salesRepName,
        loadNumber:         data.vendor.loadNumber,
        lineItems:          enrichedItems,
        pages,
        rawText:            JSON.stringify(data),
        processingError:    null,
      },
    });

    console.log(`✅ Multi-page invoice ${invoiceId} complete — ${enrichedItems.length} items from ${files.length} pages`);
  } catch (err) {
    console.error(`❌ Multi-page invoice ${invoiceId} failed:`, err.message);
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'failed', processingError: err.message },
    });
  } finally {
    // Clean up all temp files
    await Promise.all(files.map(f => fs.unlink(f.path).catch(() => {})));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Queue multiple files as ONE multi-page invoice
// @route   POST /api/invoice/queue-multipage
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const queueMultipageUpload = async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const fileName = files.map(f => f.originalname).join(', ');

    // Create ONE invoice stub for all pages
    const stub = await prisma.invoice.create({
      data: {
        fileName,
        fileType: 'multipage',
        status:   'processing',
        orgId:    req.orgId   ?? 'unknown',
        storeId:  req.storeId ?? null,
        userId:   req.user.id ?? null,
      },
    });

    setImmediate(() =>
      processMultipageBackground(stub.id, files, req.user, req.storeId, req.orgId).catch(err =>
        console.error('Multi-page background processing error:', err)
      )
    );

    res.json({ message: 'Multi-page invoice queued for processing', invoices: [stub] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Upload invoices — legacy synchronous endpoint
// @route   POST /api/invoice/upload
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const uploadInvoices = async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    let posProducts = getPOSCache(req.user.id);
    if (!posProducts || posProducts.length === 0) {
      posProducts = await loadCatalogProductsForMatching(req.orgId);
      if (posProducts.length > 0) setPOSCache(req.user.id, posProducts);
    }
    posProducts = posProducts || [];

    const results = [];

    for (const file of files) {
      try {
        const buffer = await fs.readFile(file.path);
        const result = await gptService.extractInvoiceData(buffer, file.mimetype);
        const { data, pages } = result;

        const enrichedItems = await matchLineItems(data.lineItems, posProducts, data.vendor.vendorName);

        const invoice = await prisma.invoice.create({
          data: {
            fileName:           file.originalname,
            fileType:           file.mimetype,
            status:             'draft',
            orgId:              req.orgId   ?? 'unknown',
            storeId:            req.storeId ?? null,
            userId:             req.user.id ?? null,
            vendorName:         data.vendor.vendorName,
            customerNumber:     data.vendor.customerNumber,
            invoiceNumber:      data.vendor.invoiceNumber,
            invoiceDate:        data.vendor.invoiceDate ? new Date(data.vendor.invoiceDate) : null,
            paymentDueDate:     data.vendor.paymentDueDate ? new Date(data.vendor.paymentDueDate) : null,
            paymentType:        data.vendor.paymentType,
            checkNumber:        data.vendor.checkNumber,
            totalInvoiceAmount: data.vendor.totalInvoiceAmount,
            tax:                data.vendor.tax,
            totalDiscount:      data.vendor.totalDiscount,
            totalDeposit:       data.vendor.totalDeposit,
            otherFees:          data.vendor.otherFees,
            totalCasesReceived: data.vendor.totalCasesReceived,
            totalUnitsReceived: data.vendor.totalUnitsReceived,
            driverName:         data.vendor.driverName,
            salesRepName:       data.vendor.salesRepName,
            loadNumber:         data.vendor.loadNumber,
            lineItems:          enrichedItems,
            pages,
            rawText:            JSON.stringify(data),
          },
        });

        results.push(invoice);
        await fs.unlink(file.path);
      } catch (err) {
        console.error(`Error processing ${file.originalname}:`, err);
        results.push({ fileName: file.originalname, status: 'failed', error: err.message });
      }
    }

    res.json({ message: 'Upload processed', results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get a single invoice by ID
// @route   GET /api/invoice/:id
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const getInvoiceById = async (req, res) => {
  try {
    const where = { id: req.params.id };
    if (req.orgId) where.orgId = req.orgId;

    const invoice = await prisma.invoice.findFirst({ where });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get all non-synced invoices (processing, draft, failed)
// @route   GET /api/invoice/drafts
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const getInvoiceDrafts = async (req, res) => {
  try {
    const where = {
      status: { in: ['processing', 'draft', 'failed'] },
    };
    if (req.orgId) where.orgId = req.orgId;

    const drafts = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json(drafts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Delete a draft / failed / processing invoice
// @route   DELETE /api/invoice/drafts/:id
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const deleteDraft = async (req, res) => {
  try {
    const where = { id: req.params.id };
    if (req.orgId) where.orgId = req.orgId;

    const invoice = await prisma.invoice.findFirst({ where });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    if (invoice.status === 'synced') {
      return res.status(400).json({ message: 'Synced invoices cannot be deleted' });
    }

    await prisma.invoice.delete({ where: { id: invoice.id } });
    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Confirm and sync a draft invoice
// @route   POST /api/invoice/confirm
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const confirmInvoice = async (req, res) => {
  try {
    const { id, lineItems, vendorName, invoiceNumber, invoiceDate, totalInvoiceAmount } = req.body;

    const where = { id };
    if (req.orgId) where.orgId = req.orgId;

    const existing = await prisma.invoice.findFirst({ where });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    const invoice = await prisma.invoice.update({
      where: { id: existing.id },
      data: {
        lineItems,
        vendorName,
        invoiceNumber,
        invoiceDate:        invoiceDate ? new Date(invoiceDate) : null,
        totalInvoiceAmount: totalInvoiceAmount ? Number(totalInvoiceAmount) : null,
        customerNumber:     req.body.customerNumber,
        paymentDueDate:     req.body.paymentDueDate ? new Date(req.body.paymentDueDate) : null,
        paymentType:        req.body.paymentType,
        checkNumber:        req.body.checkNumber,
        tax:                req.body.tax ? Number(req.body.tax) : null,
        totalDiscount:      req.body.totalDiscount ? Number(req.body.totalDiscount) : null,
        totalDeposit:       req.body.totalDeposit  ? Number(req.body.totalDeposit)  : null,
        otherFees:          req.body.otherFees      ? Number(req.body.otherFees)      : null,
        driverName:         req.body.driverName,
        salesRepName:       req.body.salesRepName,
        loadNumber:         req.body.loadNumber,
        status:             'synced',
      },
    });

    // ── Negative feedback: detect overridden matches ─────────────────────────
    // Compare confirmed lineItems against the original draft to find where
    // the user changed the linked product (corrected a wrong match).
    try {
      const originalItems = Array.isArray(existing.lineItems) ? existing.lineItems : [];
      for (const confirmed of (lineItems || [])) {
        if (!confirmed.originalItemCode || !confirmed.linkedProductId) continue;
        // Find the same item in the original draft
        const original = originalItems.find(o =>
          o.originalItemCode === confirmed.originalItemCode &&
          o.originalVendorDescription === confirmed.originalVendorDescription
        );
        // If the user changed the linked product → decrement the wrong mapping
        if (original && original.linkedProductId && original.linkedProductId !== confirmed.linkedProductId) {
          await decrementMapping(req.orgId, vendorName, confirmed.originalItemCode, original.linkedProductId);
        }
      }
    } catch { /* non-fatal — negative feedback is a bonus, not critical */ }

    // ── Save confirmed mappings (store-specific + global) ────────────────────
    await saveConfirmedMappings(lineItems, vendorName, req.orgId);

    // ── Compute and save match stats ─────────────────────────────────────────
    try {
      const matched = (lineItems || []).filter(i => i.mappingStatus === 'matched' || i.mappingStatus === 'manual').length;
      const total = (lineItems || []).length;
      const byTier = (lineItems || []).reduce((acc, r) => {
        const key = r.matchTier || 'unmatched';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      await prisma.invoice.update({
        where: { id: existing.id },
        data: { matchStats: { total, matched, unmatched: total - matched, matchRate: total > 0 ? Math.round((matched / total) * 10000) / 100 : 0, byTier } },
      });
    } catch { /* non-fatal */ }

    // ── PO Receiving — if user accepted the PO match ──────────────────────────
    let poReceiveResult = null;
    if (req.body.acceptPOMatch && existing.linkedPurchaseOrderId) {
      try {
        const poMatchData = existing.poMatchResult || {};
        const matchedItems = poMatchData.matchedItems || [];
        if (matchedItems.length > 0) {
          const poId = existing.linkedPurchaseOrderId;
          const receiveItems = matchedItems.map(m => ({
            id: m.poItemId,
            qtyReceived: parseInt(m.qtyFromInvoice) || 0,
            actualUnitCost: m.invoiceUnitCost || undefined,
          }));

          // Receive the PO using same logic as receivePurchaseOrder
          const po = await prisma.purchaseOrder.findUnique({
            where: { id: poId },
            include: { items: true },
          });

          if (po) {
            let allReceived = true;
            let totalVariance = 0;
            for (const recv of receiveItems) {
              const poItem = po.items.find(i => i.id === recv.id);
              if (!poItem) continue;
              const qtyRecv = parseInt(recv.qtyReceived) || 0;
              const actualUnitCost = recv.actualUnitCost != null ? parseFloat(recv.actualUnitCost) : null;
              let costVariance = null, varianceFlag = null;
              if (actualUnitCost != null && Number(poItem.unitCost) > 0) {
                costVariance = Math.round((actualUnitCost - Number(poItem.unitCost)) * 10000) / 10000;
                const pct = Math.abs(costVariance) / Number(poItem.unitCost) * 100;
                varianceFlag = pct < 5 ? 'none' : pct < 15 ? 'minor' : 'major';
                totalVariance += Math.abs(costVariance) * qtyRecv;
              }
              const backorderQty = Math.max(0, poItem.qtyOrdered - qtyRecv);
              await prisma.purchaseOrderItem.update({
                where: { id: recv.id },
                data: { qtyReceived: qtyRecv, actualUnitCost, costVariance, varianceFlag, backorderQty, backorderStatus: backorderQty > 0 ? 'pending' : null },
              });
              await prisma.storeProduct.updateMany({
                where: { masterProductId: poItem.masterProductId, storeId: po.storeId },
                data: { quantityOnHand: { increment: qtyRecv }, quantityOnOrder: { decrement: poItem.qtyOrdered }, lastReceivedAt: new Date(), lastStockUpdate: new Date() },
              }).catch(() => {});
              if (qtyRecv < poItem.qtyOrdered) allReceived = false;
            }
            const poStatus = allReceived ? 'received' : 'partial';
            await prisma.purchaseOrder.update({
              where: { id: poId },
              data: { status: poStatus, receivedDate: allReceived ? new Date() : undefined, invoiceId: existing.id, invoiceNumber, totalVariance: Math.round(totalVariance * 100) / 100 },
            });
            poReceiveResult = { poId, status: poStatus, itemsReceived: receiveItems.length, totalVariance: Math.round(totalVariance * 100) / 100 };
          }
        }
      } catch (poErr) {
        console.warn('[Invoice confirm] PO receive failed:', poErr.message);
      }
    }

    // ── Auto-detect returns (credit memos / negative quantities) ────────────
    let autoReturnResult = null;
    try {
      const CREDIT_PATTERNS = /credit|return|adjustment|cr\s?memo|refund/i;
      const returnItems = (lineItems || []).filter(li => {
        const qty = Number(li.quantity || li.qty || li.unitQty || 0);
        const desc = li.description || li.originalVendorDescription || '';
        return qty < 0 || CREDIT_PATTERNS.test(desc);
      });

      if (returnItems.length > 0 && vendorName) {
        // Find vendor
        const vendor = await prisma.vendor.findFirst({
          where: { orgId: req.orgId, OR: [{ name: { contains: vendorName, mode: 'insensitive' } }] },
          select: { id: true },
        });
        if (vendor) {
          const retNumber = `RET-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-INV`;
          const retItems = returnItems.map(li => ({
            masterProductId: parseInt(li.linkedProductId || li.posProductId) || 0,
            qty: Math.abs(Number(li.quantity || li.qty || li.unitQty || 1)),
            unitCost: Math.abs(Number(li.unitCost || li.caseCost || 0)),
            lineTotal: Math.abs(Number(li.total || li.lineTotal || 0)),
            reason: 'credit_memo',
          })).filter(i => i.masterProductId > 0);

          if (retItems.length > 0) {
            const ret = await prisma.vendorReturn.create({
              data: {
                orgId: req.orgId,
                storeId: req.storeId || '',
                vendorId: vendor.id,
                returnNumber: retNumber + '-' + String(Date.now()).slice(-4),
                reason: 'credit_memo',
                status: 'credited',
                totalAmount: retItems.reduce((s, i) => s + i.lineTotal, 0),
                creditReceived: retItems.reduce((s, i) => s + i.lineTotal, 0),
                creditedAt: new Date(),
                notes: `Auto-created from invoice ${invoiceNumber || existing.id}`,
                createdById: req.user?.id || '',
                items: { create: retItems },
              },
            });
            autoReturnResult = { returnId: ret.id, returnNumber: ret.returnNumber, itemCount: retItems.length, total: ret.totalAmount };
          }
        }
      }
    } catch (retErr) {
      console.warn('[Invoice confirm] Return detection failed:', retErr.message);
    }

    res.json({
      message: 'Invoice synchronized with system',
      invoice,
      poReceiveResult,
      autoReturnResult,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Save draft changes without syncing to POS
// @route   PATCH /api/invoice/:id/draft
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const saveDraft = async (req, res) => {
  try {
    const { id } = req.params;
    const where = { id };
    if (req.orgId) where.orgId = req.orgId;

    const invoice = await prisma.invoice.findFirst({ where });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    if (invoice.status === 'synced') {
      return res.status(400).json({ message: 'Synced invoices cannot be edited' });
    }

    const ALLOWED = [
      'lineItems', 'vendorName', 'invoiceNumber', 'invoiceDate',
      'paymentDueDate', 'paymentType', 'checkNumber', 'customerNumber',
      'totalInvoiceAmount', 'tax', 'totalDiscount', 'totalDeposit',
      'otherFees', 'driverName', 'salesRepName', 'loadNumber',
    ];
    const patch = {};
    for (const field of ALLOWED) {
      if (req.body[field] !== undefined) patch[field] = req.body[field];
    }

    const updated = await prisma.invoice.update({ where: { id }, data: patch });
    res.json({ message: 'Draft saved', invoice: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get synced invoice history
// @route   GET /api/invoice/history
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const getInvoiceHistory = async (req, res) => {
  try {
    const where = { status: 'synced' };
    if (req.orgId) where.orgId = req.orgId;

    const history = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Clear the POS product cache
// @route   POST /api/invoice/clear-pos-cache
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const clearInvoicePOSCache = async (req, res) => {
  try {
    clearPOSCache(req.user.id);
    res.json({
      success: true,
      message: 'POS product cache cleared',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get match accuracy analytics
// @route   GET /api/invoice/accuracy
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const getMatchAccuracy = async (req, res) => {
  try {
    const where = { status: 'synced', matchStats: { not: null } };
    if (req.orgId) where.orgId = req.orgId;

    const invoices = await prisma.invoice.findMany({
      where,
      select: { vendorName: true, matchStats: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    // Aggregate by vendor
    const byVendor = {};
    let totalMatched = 0, totalItems = 0;
    const tierTotals = {};
    const timeline = [];

    for (const inv of invoices) {
      const stats = inv.matchStats;
      if (!stats) continue;

      totalMatched += stats.matched || 0;
      totalItems += stats.total || 0;

      // By tier
      if (stats.byTier) {
        for (const [tier, count] of Object.entries(stats.byTier)) {
          tierTotals[tier] = (tierTotals[tier] || 0) + count;
        }
      }

      // By vendor
      const v = inv.vendorName || 'Unknown';
      if (!byVendor[v]) byVendor[v] = { vendor: v, invoices: 0, totalItems: 0, matched: 0 };
      byVendor[v].invoices += 1;
      byVendor[v].totalItems += stats.total || 0;
      byVendor[v].matched += stats.matched || 0;

      // Timeline
      timeline.push({
        date: inv.createdAt?.toISOString().slice(0, 10),
        matchRate: stats.matchRate || 0,
        vendor: v,
      });
    }

    // Vendor match rates
    const vendors = Object.values(byVendor).map(v => ({
      ...v,
      matchRate: v.totalItems > 0 ? Math.round((v.matched / v.totalItems) * 10000) / 100 : 0,
    })).sort((a, b) => a.matchRate - b.matchRate);

    res.json({
      overall: {
        totalInvoices: invoices.length,
        totalItems,
        totalMatched,
        overallMatchRate: totalItems > 0 ? Math.round((totalMatched / totalItems) * 10000) / 100 : 0,
      },
      tierBreakdown: tierTotals,
      byVendor: vendors,
      timeline: timeline.slice(0, 50),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
