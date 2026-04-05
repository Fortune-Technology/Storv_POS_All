import prisma from '../config/postgres.js';
import * as gptService from '../services/gptService.js';
// extractMultiplePages is accessed via gptService.extractMultiplePages
import {
  matchLineItems,
  saveConfirmedMappings,
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

    console.log(`✅ Invoice ${invoiceId} processing complete`);
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

    await saveConfirmedMappings(lineItems, vendorName, req.orgId);

    res.json({ message: 'Invoice synchronized with system', invoice });
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
