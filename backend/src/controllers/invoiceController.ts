import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';
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
// Session 40: parallel writes to the clean per-vendor-cost mapping table.
// VendorProductMap above is for OCR fuzzy-matching memory (vendorName string).
// ProductVendor is for the user-facing authoritative (vendor, product) mapping
// with real FK IDs.
import { upsertProductVendor } from './catalogController.js';
import fs from 'fs/promises';
import type { AuthedUser } from '../../global.js';

/** Multer file shape used by every upload endpoint. */
interface UploadedFile {
  path: string;
  originalname: string;
  mimetype: string;
}

/** Vendor section of the gpt-extracted invoice payload. */
interface InvoiceVendorData {
  vendorName?: string | null;
  customerNumber?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | Date | null;
  paymentDueDate?: string | Date | null;
  paymentType?: string | null;
  checkNumber?: string | null;
  totalInvoiceAmount?: number | string | null;
  tax?: number | string | null;
  totalDiscount?: number | string | null;
  totalDeposit?: number | string | null;
  otherFees?: number | string | null;
  totalCasesReceived?: number | string | null;
  totalUnitsReceived?: number | string | null;
  driverName?: string | null;
  salesRepName?: string | null;
  loadNumber?: string | null;
}

/** One line item as produced by the gpt extractor / matching cascade. */
interface InvoiceLineItem {
  description?: string | null;
  itemCode?: string | null;
  upc?: string | null;
  unitPack?: number | string | null;
  packUnits?: number | string | null;
  quantity?: number | string | null;
  qty?: number | string | null;
  unitQty?: number | string | null;
  unitCost?: number | string | null;
  caseCost?: number | string | null;
  netCost?: number | string | null;
  actualCost?: number | string | null;
  total?: number | string | null;
  lineTotal?: number | string | null;
  mappingStatus?: 'matched' | 'manual' | 'unmatched' | string;
  matchTier?: string | null;
  confidence?: 'high' | 'medium' | 'low' | string | null;
  linkedProductId?: number | string | null;
  posProductId?: number | string | null;
  originalItemCode?: string | null;
  originalVendorDescription?: string | null;
}

/** Shape returned by gptService.extractInvoiceData / extractMultiplePages. */
interface InvoiceExtractionResult {
  data: {
    vendor: InvoiceVendorData;
    lineItems: InvoiceLineItem[];
  };
  pages: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: resolve invoice vendorName → Vendor.id for vendor-scoped matching.
// Tries, in order:
//   1. Exact active vendor with same orgId and name (case-insensitive)
//   2. Vendor where `aliases[]` contains the OCR name
//   3. Fuzzy contains match on vendor name
// Returns vendorId (Int) or null if nothing resolved.
// ─────────────────────────────────────────────────────────────────────────────
async function resolveVendorId(orgId: string | null | undefined, vendorName: string | null | undefined): Promise<number | null> {
  if (!orgId || orgId === 'unknown' || !vendorName) return null;
  const q = String(vendorName).trim();
  if (!q) return null;
  try {
    // 1. Exact (case-insensitive)
    const exact = await prisma.vendor.findFirst({
      where: { orgId, active: true, name: { equals: q, mode: 'insensitive' } },
      select: { id: true },
    });
    if (exact) return exact.id;

    // 2. Alias match
    const byAlias = await prisma.vendor.findFirst({
      where: { orgId, active: true, aliases: { has: q } },
      select: { id: true },
    });
    if (byAlias) return byAlias.id;

    // 3. Fuzzy contains — both directions (vendor.name contains OCR, OCR contains vendor.name)
    const fuzzy = await prisma.vendor.findFirst({
      where: { orgId, active: true, name: { contains: q, mode: 'insensitive' } },
      select: { id: true },
    });
    if (fuzzy) return fuzzy.id;

    // 4. Reverse: iterate active vendors and check if their name is contained in the OCR string
    //    (covers OCR variants like "HERSHEY CREAMERY CO." → vendor "Hershey Creamery")
    const candidates = await prisma.vendor.findMany({
      where: { orgId, active: true },
      select: { id: true, name: true },
      take: 200,
    });
    type CandidateRow = (typeof candidates)[number];
    const lower = q.toLowerCase();
    for (const v of candidates as CandidateRow[]) {
      if (v.name && lower.includes(v.name.toLowerCase())) return v.id;
    }
  } catch (err) {
    console.warn('[resolveVendorId] failed:', (err as Error).message);
  }
  return null;
}


// ─────────────────────────────────────────────────────────────────────────────
// Internal: background processing (called after HTTP response is sent)
// ─────────────────────────────────────────────────────────────────────────────
async function processInvoiceBackground(
  invoiceId: string,
  file: UploadedFile,
  user: AuthedUser,
  storeId: string | null | undefined,
  orgId: string | null | undefined,
  preselectedVendorId: number | null = null,
): Promise<void> {
  try {
    let posProducts = getPOSCache(user.id);
    if (!posProducts || posProducts.length === 0) {
      posProducts = await loadCatalogProductsForMatching(orgId as string);
      if (posProducts.length > 0) setPOSCache(user.id, posProducts);
    }
    posProducts = posProducts || [];

    const buffer = await fs.readFile(file.path);
    const result = (await gptService.extractInvoiceData(buffer, file.mimetype)) as unknown as InvoiceExtractionResult;
    const { data, pages } = result;

    // Resolve vendor — either the user picked one at upload time, or we
    // try to match data.vendor.vendorName to an existing Vendor record.
    const resolvedVendorId = preselectedVendorId || await resolveVendorId(orgId, data.vendor.vendorName);
    if (resolvedVendorId) {
      console.log(`🏷 Invoice ${invoiceId} resolved to vendorId=${resolvedVendorId} (${data.vendor.vendorName})`);
    }

    const enrichedItems = await matchLineItems(
      data.lineItems as unknown as Parameters<typeof matchLineItems>[0],
      posProducts,
      data.vendor.vendorName as string,
      { vendorId: resolvedVendorId } as Parameters<typeof matchLineItems>[3],
    );

    // ── Auto-match to Purchase Order ──────────────────────────────────
    let poMatchResult: unknown = null;
    let linkedPurchaseOrderId: string | null = null;
    try {
      const { matchInvoiceToPO } = await import('../services/poInvoiceMatchService.js');
      // Save enriched items first so the PO matcher can read them
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          lineItems: enrichedItems as unknown as Prisma.InputJsonValue,
          vendorName: data.vendor.vendorName,
          vendorId: resolvedVendorId,
        },
      });
      const poMatch = await matchInvoiceToPO(orgId as string, storeId as string, invoiceId);
      const pm = poMatch as { matchedPO?: { id: string } | null };
      if (pm.matchedPO) {
        linkedPurchaseOrderId = pm.matchedPO.id;
        poMatchResult = poMatch;
      }
    } catch (poErr) {
      console.warn(`[Invoice ${invoiceId}] PO matching skipped:`, (poErr as Error).message);
    }

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status:             'draft',
        vendorName:         data.vendor.vendorName,
        vendorId:           resolvedVendorId,
        customerNumber:     data.vendor.customerNumber,
        invoiceNumber:      data.vendor.invoiceNumber,
        invoiceDate:        data.vendor.invoiceDate ? new Date(data.vendor.invoiceDate) : null,
        paymentDueDate:     data.vendor.paymentDueDate ? new Date(data.vendor.paymentDueDate) : null,
        paymentType:        data.vendor.paymentType,
        checkNumber:        data.vendor.checkNumber,
        totalInvoiceAmount: data.vendor.totalInvoiceAmount as Prisma.Decimal | number | null,
        tax:                data.vendor.tax as Prisma.Decimal | number | null,
        totalDiscount:      data.vendor.totalDiscount as Prisma.Decimal | number | null,
        totalDeposit:       data.vendor.totalDeposit as Prisma.Decimal | number | null,
        otherFees:          data.vendor.otherFees as Prisma.Decimal | number | null,
        totalCasesReceived: data.vendor.totalCasesReceived as number | null,
        totalUnitsReceived: data.vendor.totalUnitsReceived as number | null,
        driverName:         data.vendor.driverName,
        salesRepName:       data.vendor.salesRepName,
        loadNumber:         data.vendor.loadNumber,
        lineItems:          enrichedItems as unknown as Prisma.InputJsonValue,
        pages:              pages as Prisma.InputJsonValue,
        rawText:            JSON.stringify(data),
        processingError:    null,
        linkedPurchaseOrderId,
        poMatchResult:      poMatchResult as Prisma.InputJsonValue,
      },
    });

    const matched = poMatchResult as { matchedPO?: { poNumber?: string } } | null;
    console.log(`✅ Invoice ${invoiceId} processing complete${linkedPurchaseOrderId ? ` (matched PO: ${matched?.matchedPO?.poNumber})` : ''}`);
  } catch (err) {
    console.error(`❌ Invoice ${invoiceId} processing failed:`, (err as Error).message);
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'failed', processingError: (err as Error).message },
    });
  } finally {
    try { await fs.unlink(file.path); } catch (_) { /* best-effort cleanup */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Queue invoice for background processing — responds immediately
// @route   POST /api/invoice/queue
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const queueUpload = async (req: Request, res: Response): Promise<void> => {
  try {
    const files = (req as Request & { files?: UploadedFile[] }).files;
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    // Optional vendorId sent from the upload UI — when present, vendor-scoped
    // matching kicks in on the first pass (skip the name-resolution heuristic).
    const preVendorIdRaw = (req.body as { vendorId?: string | number } | undefined)?.vendorId;
    const preselectedVendorId = preVendorIdRaw ? parseInt(String(preVendorIdRaw), 10) : NaN;
    const validVendorId = Number.isFinite(preselectedVendorId) ? preselectedVendorId : null;

    const stubs: unknown[] = [];

    for (const file of files) {
      const stub = await prisma.invoice.create({
        data: {
          fileName: file.originalname,
          fileType: file.mimetype,
          status:   'processing',
          orgId:    req.orgId   ?? 'unknown',
          storeId:  req.storeId ?? null,
          userId:   req.user?.id ?? null,
          vendorId: validVendorId,
        },
      });

      stubs.push(stub);

      setImmediate(() =>
        processInvoiceBackground((stub as { id: string }).id, file, req.user as AuthedUser, req.storeId, req.orgId, validVendorId).catch((err) =>
          console.error('Background processing error:', err),
        ),
      );
    }

    res.json({ message: 'Queued for processing', invoices: stubs });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal: background processing for multi-page invoices (multiple files = 1 invoice)
// ─────────────────────────────────────────────────────────────────────────────
async function processMultipageBackground(
  invoiceId: string,
  files: UploadedFile[],
  user: AuthedUser,
  storeId: string | null | undefined,
  orgId: string | null | undefined,
  preselectedVendorId: number | null = null,
): Promise<void> {
  try {
    let posProducts = getPOSCache(user.id);
    if (!posProducts || posProducts.length === 0) {
      posProducts = await loadCatalogProductsForMatching(orgId as string);
      if (posProducts.length > 0) setPOSCache(user.id, posProducts);
    }
    posProducts = posProducts || [];

    // Read all file buffers
    const fileData = await Promise.all(
      files.map(async (f) => ({ buffer: await fs.readFile(f.path), mimetype: f.mimetype })),
    );

    const { data, pages } = (await gptService.extractMultiplePages(fileData)) as unknown as InvoiceExtractionResult;

    const resolvedVendorId = preselectedVendorId || await resolveVendorId(orgId, data.vendor.vendorName);
    if (resolvedVendorId) {
      console.log(`🏷 Multi-page invoice ${invoiceId} resolved to vendorId=${resolvedVendorId} (${data.vendor.vendorName})`);
    }

    const enrichedItems = await matchLineItems(
      data.lineItems as unknown as Parameters<typeof matchLineItems>[0],
      posProducts,
      data.vendor.vendorName as string,
      { vendorId: resolvedVendorId } as Parameters<typeof matchLineItems>[3],
    );

    // storeId is implicit on the existing invoice — nothing to write here besides
    // the enriched data itself. Quiet the unused-var lint by referencing it.
    void storeId;

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status:             'draft',
        vendorName:         data.vendor.vendorName,
        vendorId:           resolvedVendorId,
        customerNumber:     data.vendor.customerNumber,
        invoiceNumber:      data.vendor.invoiceNumber,
        invoiceDate:        data.vendor.invoiceDate ? new Date(data.vendor.invoiceDate) : null,
        paymentDueDate:     data.vendor.paymentDueDate ? new Date(data.vendor.paymentDueDate) : null,
        paymentType:        data.vendor.paymentType,
        checkNumber:        data.vendor.checkNumber,
        totalInvoiceAmount: data.vendor.totalInvoiceAmount as Prisma.Decimal | number | null,
        tax:                data.vendor.tax as Prisma.Decimal | number | null,
        totalDiscount:      data.vendor.totalDiscount as Prisma.Decimal | number | null,
        totalDeposit:       data.vendor.totalDeposit as Prisma.Decimal | number | null,
        otherFees:          data.vendor.otherFees as Prisma.Decimal | number | null,
        totalCasesReceived: data.vendor.totalCasesReceived as number | null,
        totalUnitsReceived: data.vendor.totalUnitsReceived as number | null,
        driverName:         data.vendor.driverName,
        salesRepName:       data.vendor.salesRepName,
        loadNumber:         data.vendor.loadNumber,
        lineItems:          enrichedItems as unknown as Prisma.InputJsonValue,
        pages:              pages as Prisma.InputJsonValue,
        rawText:            JSON.stringify(data),
        processingError:    null,
      },
    });

    console.log(`✅ Multi-page invoice ${invoiceId} complete — ${enrichedItems.length} items from ${files.length} pages`);
  } catch (err) {
    console.error(`❌ Multi-page invoice ${invoiceId} failed:`, (err as Error).message);
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'failed', processingError: (err as Error).message },
    });
  } finally {
    // Clean up all temp files
    await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => {})));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Queue multiple files as ONE multi-page invoice
// @route   POST /api/invoice/queue-multipage
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const queueMultipageUpload = async (req: Request, res: Response): Promise<void> => {
  try {
    const files = (req as Request & { files?: UploadedFile[] }).files;
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    const preVendorIdRaw = (req.body as { vendorId?: string | number } | undefined)?.vendorId;
    const preselectedVendorId = preVendorIdRaw ? parseInt(String(preVendorIdRaw), 10) : NaN;
    const validVendorId = Number.isFinite(preselectedVendorId) ? preselectedVendorId : null;

    const fileName = files.map((f) => f.originalname).join(', ');

    // Create ONE invoice stub for all pages
    const stub = await prisma.invoice.create({
      data: {
        fileName,
        fileType: 'multipage',
        status:   'processing',
        orgId:    req.orgId   ?? 'unknown',
        storeId:  req.storeId ?? null,
        userId:   req.user?.id ?? null,
        vendorId: validVendorId,
      },
    });

    setImmediate(() =>
      processMultipageBackground((stub as { id: string }).id, files, req.user as AuthedUser, req.storeId, req.orgId, validVendorId).catch((err) =>
        console.error('Multi-page background processing error:', err),
      ),
    );

    res.json({ message: 'Multi-page invoice queued for processing', invoices: [stub] });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Upload invoices — legacy synchronous endpoint
// @route   POST /api/invoice/upload
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const uploadInvoices = async (req: Request, res: Response): Promise<void> => {
  try {
    const files = (req as Request & { files?: UploadedFile[] }).files;
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    let posProducts = getPOSCache(req.user!.id);
    if (!posProducts || posProducts.length === 0) {
      posProducts = await loadCatalogProductsForMatching(req.orgId as string);
      if (posProducts.length > 0) setPOSCache(req.user!.id, posProducts);
    }
    posProducts = posProducts || [];

    const preVendorIdRaw = (req.body as { vendorId?: string | number } | undefined)?.vendorId;
    const preselectedVendorId = preVendorIdRaw ? parseInt(String(preVendorIdRaw), 10) : NaN;
    const validVendorId = Number.isFinite(preselectedVendorId) ? preselectedVendorId : null;

    const results: unknown[] = [];

    for (const file of files) {
      try {
        const buffer = await fs.readFile(file.path);
        const result = (await gptService.extractInvoiceData(buffer, file.mimetype)) as unknown as InvoiceExtractionResult;
        const { data, pages } = result;

        const resolvedVendorId = validVendorId || await resolveVendorId(req.orgId, data.vendor.vendorName);
        const enrichedItems = await matchLineItems(
          data.lineItems as unknown as Parameters<typeof matchLineItems>[0],
          posProducts,
          data.vendor.vendorName as string,
          { vendorId: resolvedVendorId } as Parameters<typeof matchLineItems>[3],
        );

        const invoice = await prisma.invoice.create({
          data: {
            fileName:           file.originalname,
            fileType:           file.mimetype,
            status:             'draft',
            orgId:              req.orgId   ?? 'unknown',
            storeId:            req.storeId ?? null,
            userId:             req.user?.id ?? null,
            vendorName:         data.vendor.vendorName,
            vendorId:           resolvedVendorId,
            customerNumber:     data.vendor.customerNumber,
            invoiceNumber:      data.vendor.invoiceNumber,
            invoiceDate:        data.vendor.invoiceDate ? new Date(data.vendor.invoiceDate) : null,
            paymentDueDate:     data.vendor.paymentDueDate ? new Date(data.vendor.paymentDueDate) : null,
            paymentType:        data.vendor.paymentType,
            checkNumber:        data.vendor.checkNumber,
            totalInvoiceAmount: data.vendor.totalInvoiceAmount as Prisma.Decimal | number | null,
            tax:                data.vendor.tax as Prisma.Decimal | number | null,
            totalDiscount:      data.vendor.totalDiscount as Prisma.Decimal | number | null,
            totalDeposit:       data.vendor.totalDeposit as Prisma.Decimal | number | null,
            otherFees:          data.vendor.otherFees as Prisma.Decimal | number | null,
            totalCasesReceived: data.vendor.totalCasesReceived as number | null,
            totalUnitsReceived: data.vendor.totalUnitsReceived as number | null,
            driverName:         data.vendor.driverName,
            salesRepName:       data.vendor.salesRepName,
            loadNumber:         data.vendor.loadNumber,
            lineItems:          enrichedItems as unknown as Prisma.InputJsonValue,
            pages:              pages as Prisma.InputJsonValue,
            rawText:            JSON.stringify(data),
          },
        });

        results.push(invoice);
        await fs.unlink(file.path);
      } catch (err) {
        console.error(`Error processing ${file.originalname}:`, err);
        results.push({ fileName: file.originalname, status: 'failed', error: (err as Error).message });
      }
    }

    res.json({ message: 'Upload processed', results });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get a single invoice by ID
// @route   GET /api/invoice/:id
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const getInvoiceById = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Prisma.InvoiceWhereInput = { id: req.params.id };
    if (req.orgId) where.orgId = req.orgId;

    const invoice = await prisma.invoice.findFirst({ where });
    if (!invoice) { res.status(404).json({ message: 'Invoice not found' }); return; }
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get all non-synced invoices (processing, draft, failed)
// @route   GET /api/invoice/drafts
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const getInvoiceDrafts = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Prisma.InvoiceWhereInput = {
      status: { in: ['processing', 'draft', 'failed'] },
    };
    if (req.orgId) where.orgId = req.orgId;

    const drafts = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json(drafts);
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Delete a draft / failed / processing invoice
// @route   DELETE /api/invoice/drafts/:id
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const deleteDraft = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Prisma.InvoiceWhereInput = { id: req.params.id };
    if (req.orgId) where.orgId = req.orgId;

    const invoice = await prisma.invoice.findFirst({ where });
    if (!invoice) { res.status(404).json({ message: 'Invoice not found' }); return; }
    if (invoice.status === 'synced') {
      res.status(400).json({ message: 'Synced invoices cannot be deleted' });
      return;
    }

    await prisma.invoice.delete({ where: { id: invoice.id } });
    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
};

interface ConfirmInvoiceBody {
  id?: string;
  lineItems?: InvoiceLineItem[];
  vendorName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | Date | null;
  totalInvoiceAmount?: number | string | null;
  invoiceType?: string;
  linkedInvoiceId?: string | null;
  customerNumber?: string | null;
  paymentDueDate?: string | Date | null;
  paymentType?: string | null;
  checkNumber?: string | null;
  tax?: number | string | null;
  totalDiscount?: number | string | null;
  totalDeposit?: number | string | null;
  otherFees?: number | string | null;
  driverName?: string | null;
  salesRepName?: string | null;
  loadNumber?: string | null;
  acceptPOMatch?: boolean;
}

interface CostSyncAuditEntry {
  productId: number;
  productName: string | null;
  invoiceCaseCost: number;
  actualCost: number;
  invoiceNetCost: number | null;
  invoiceGrossCost: number | null;
  decision: 'sync' | 'skip' | 'error';
  reason: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Confirm and sync a draft invoice
// @route   POST /api/invoice/confirm
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const confirmInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body || {}) as ConfirmInvoiceBody;
    const { id, lineItems, vendorName, invoiceNumber, invoiceDate, totalInvoiceAmount } = body;

    const where: Prisma.InvoiceWhereInput = { id };
    if (req.orgId) where.orgId = req.orgId;

    const existing = await prisma.invoice.findFirst({ where });
    if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }

    // Validate invoiceType — default to 'purchase' if omitted; reject anything
    // other than the two supported values so bad client input doesn't silently
    // corrupt P&L math.
    const rawType = String(body.invoiceType || existing.invoiceType || 'purchase').toLowerCase();
    if (!['purchase', 'credit_memo'].includes(rawType)) {
      res.status(400).json({ error: `invoiceType must be 'purchase' or 'credit_memo' (got: ${rawType})` });
      return;
    }

    // linkedInvoiceId is only meaningful on credit memos. Clear it on purchase
    // invoices so the data stays tidy.
    const linkedInvoiceId = rawType === 'credit_memo'
      ? (body.linkedInvoiceId || existing.linkedInvoiceId || null)
      : null;

    const invoice = await prisma.invoice.update({
      where: { id: existing.id },
      data: {
        lineItems: lineItems as unknown as Prisma.InputJsonValue,
        vendorName,
        invoiceNumber,
        invoiceType:        rawType,
        linkedInvoiceId,
        invoiceDate:        invoiceDate ? new Date(invoiceDate) : null,
        totalInvoiceAmount: totalInvoiceAmount ? Number(totalInvoiceAmount) : null,
        customerNumber:     body.customerNumber,
        paymentDueDate:     body.paymentDueDate ? new Date(body.paymentDueDate) : null,
        paymentType:        body.paymentType,
        checkNumber:        body.checkNumber,
        tax:                body.tax           ? Number(body.tax)           : null,
        totalDiscount:      body.totalDiscount ? Number(body.totalDiscount) : null,
        totalDeposit:       body.totalDeposit  ? Number(body.totalDeposit)  : null,
        otherFees:          body.otherFees      ? Number(body.otherFees)      : null,
        driverName:         body.driverName,
        salesRepName:       body.salesRepName,
        loadNumber:         body.loadNumber,
        status:             'synced',
      },
    });

    // ── Negative feedback: detect overridden matches ─────────────────────────
    // Compare confirmed lineItems against the original draft to find where
    // the user changed the linked product (corrected a wrong match).
    try {
      const originalItems: InvoiceLineItem[] = Array.isArray(existing.lineItems)
        ? (existing.lineItems as unknown as InvoiceLineItem[])
        : [];
      for (const confirmed of (lineItems || [])) {
        if (!confirmed.originalItemCode || !confirmed.linkedProductId) continue;
        // Find the same item in the original draft
        const original = originalItems.find((o) =>
          o.originalItemCode === confirmed.originalItemCode &&
          o.originalVendorDescription === confirmed.originalVendorDescription,
        );
        // If the user changed the linked product → decrement the wrong mapping
        if (original && original.linkedProductId && original.linkedProductId !== confirmed.linkedProductId) {
          await decrementMapping(req.orgId as string, vendorName as string, confirmed.originalItemCode, String(original.linkedProductId));
        }
      }
    } catch { /* non-fatal — negative feedback is a bonus, not critical */ }

    // ── Save confirmed mappings (store-specific + global) ────────────────────
    await saveConfirmedMappings(
      lineItems as unknown as Parameters<typeof saveConfirmedMappings>[0],
      vendorName as string,
      req.orgId as string,
    );

    // ── Parallel write: authoritative ProductVendor mappings (Session 40) ────
    // The saveConfirmedMappings call above writes to VendorProductMap for OCR
    // fuzzy-match memory. Here we populate the clean ProductVendor table keyed
    // on real FKs so the ProductForm's per-vendor cost table stays in sync.
    // First invoice to reference a product auto-sets it primary.
    //
    // At the same time, run the Invoice Cost Sync decision tree — for each
    // matched line we may also update MasterProduct.defaultCasePrice so the
    // store's active cost tracks what they're actually paying.
    const costSyncAudit: CostSyncAuditEntry[] = [];
    try {
      const vId = existing.vendorId || null;
      if (vId) {
        // Load vendor + store settings once for the decision tree.
        const [vendor, store] = await Promise.all([
          prisma.vendor.findFirst({
            where: { id: vId, orgId: req.orgId },
            select: { id: true, name: true, autoSyncCostFromInvoice: true },
          }),
          existing.storeId
            ? prisma.store.findFirst({ where: { id: existing.storeId }, select: { pos: true } })
            : Promise.resolve(null),
        ]);
        const posCfg: Record<string, unknown> = (store?.pos && typeof store.pos === 'object') ? (store.pos as Record<string, unknown>) : {};
        const invoiceCostSync = (posCfg?.invoiceCostSync || {}) as { mode?: string };
        const storeSyncMode =
          invoiceCostSync.mode === 'never'      ? 'never' :
          invoiceCostSync.mode === 'per-vendor' ? 'per-vendor' :
                                                  'always';  // default = always

        for (const item of (lineItems || [])) {
          if (!item.mappingStatus || !['matched', 'manual'].includes(item.mappingStatus)) continue;
          if (!item.linkedProductId) continue;
          const mpId = parseInt(String(item.linkedProductId));
          if (!mpId) continue;
          // Pull unit cost from the confirmed line: prefer `unitCost` else derive
          // from caseCost / packUnits; fall back to originalUnitCost if present.
          const unitCost = item.unitCost != null ? Number(item.unitCost)
                         : (item.caseCost && Number(item.packUnits) > 0 ? Number(item.caseCost) / Number(item.packUnits) : null);

          // (a) Always write the per-vendor mapping (this is catalog data, not
          // cost-sync — useful even when cost sync is off).
          await upsertProductVendor(req.orgId as string, mpId, vId, {
            vendorItemCode: item.originalItemCode || null,
            description:    item.originalVendorDescription || null,
            priceCost:      unitCost,
            caseCost:       item.caseCost != null ? Number(item.caseCost) : null,
            packInCase:     item.packUnits ? parseInt(String(item.packUnits)) : null,
            lastReceivedAt: invoiceDate ? new Date(invoiceDate) : new Date(),
          }).catch((e: Error) => {
            console.warn('[confirmInvoice] ProductVendor upsert failed:', e.message);
          });

          // (b) Cost-sync decision tree.
          // Semantic split (Invoice Scanning spec):
          //   • item.actualCost   — editable "Actual Cost" field from the UI.
          //   • item.netCost      — NET value from the invoice (post-discount, pre-deposit).
          //   • item.caseCost     — GROSS value from the invoice (pre-discount).
          const actualCost = item.actualCost != null && Number(item.actualCost) > 0
                           ? Number(item.actualCost)
                           : (item.netCost != null && Number(item.netCost) > 0
                              ? Number(item.netCost)
                              : (item.caseCost != null && Number(item.caseCost) > 0
                                 ? Number(item.caseCost)
                                 : null));
          if (actualCost == null) {
            // Nothing to sync — skip silently, no audit entry.
            continue;
          }

          let decision: 'sync' | 'skip' | 'error' = 'sync';
          let reason = '';
          if (storeSyncMode === 'never') {
            decision = 'skip';
            reason = `Store auto-sync mode is 'never'`;
          } else if (storeSyncMode === 'per-vendor' && vendor && vendor.autoSyncCostFromInvoice === false) {
            decision = 'skip';
            reason = `Vendor "${vendor.name}" has auto-sync disabled`;
          } else {
            // Still a candidate — check per-product lock.
            const product = await prisma.masterProduct.findFirst({
              where: { id: mpId, orgId: req.orgId },
              select: { id: true, name: true, lockManualCaseCost: true, defaultCasePrice: true, unitPack: true, packInCase: true },
            });
            if (!product) {
              decision = 'skip';
              reason = `Product ${mpId} not found`;
            } else if (product.lockManualCaseCost) {
              decision = 'skip';
              reason = `Product "${product.name}" has manual cost lock`;
            } else {
              // SYNC. Also derive defaultCostPrice from pack math if available.
              const upd: Prisma.MasterProductUpdateInput = { defaultCasePrice: actualCost };
              const units = (Number(product.unitPack) || 0) * (Number(product.packInCase) || 0);
              if (units > 0) {
                // Round to 4 decimals to match Prisma Decimal(10,4).
                upd.defaultCostPrice = Math.round((actualCost / units) * 10000) / 10000;
              }
              await prisma.masterProduct.update({
                where: { id: mpId },
                data:  upd,
              }).catch((e: Error) => {
                decision = 'error';
                reason = `Write failed: ${e.message}`;
              });
            }
          }

          costSyncAudit.push({
            productId:   mpId,
            productName: item.description || null,
            // Keep `invoiceCaseCost` key for back-compat with historical audit
            // records; add explicit `actualCost` + `invoiceNetCost` so admins can
            // see both numbers when auditing what synced.
            invoiceCaseCost:  actualCost,
            actualCost,
            invoiceNetCost:   item.netCost != null ? Number(item.netCost) : null,
            invoiceGrossCost: item.caseCost != null ? Number(item.caseCost) : null,
            decision,
            reason: reason || null,
          });
        }
      }
    } catch (e) {
      // Never let this block invoice confirmation — OCR path is primary.
      console.warn('[confirmInvoice] ProductVendor sync pass error:', (e as Error).message);
    }

    // Persist the cost-sync audit trail on the invoice for admin review later.
    if (costSyncAudit.length > 0) {
      await prisma.invoice.update({
        where: { id: existing.id },
        data:  { costSyncAudit: costSyncAudit as unknown as Prisma.InputJsonValue },
      }).catch(() => { /* audit is best-effort — don't block confirm */ });
    }

    // ── Compute and save match stats ─────────────────────────────────────────
    try {
      const matched = (lineItems || []).filter((i) => i.mappingStatus === 'matched' || i.mappingStatus === 'manual').length;
      const total = (lineItems || []).length;
      const byTier = (lineItems || []).reduce<Record<string, number>>((acc, r) => {
        const key = r.matchTier || 'unmatched';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      await prisma.invoice.update({
        where: { id: existing.id },
        data: {
          matchStats: {
            total,
            matched,
            unmatched: total - matched,
            matchRate: total > 0 ? Math.round((matched / total) * 10000) / 100 : 0,
            byTier,
          } as Prisma.InputJsonValue,
        },
      });
    } catch { /* non-fatal */ }

    // ── PO Receiving — if user accepted the PO match ──────────────────────────
    // Credit memos never move inventory — a supplier rebate or volume-bonus
    // credit doesn't correspond to a physical receipt. Skip PO receiving
    // even if the client accidentally sent acceptPOMatch=true.
    let poReceiveResult: {
      poId: string;
      status: string;
      itemsReceived: number;
      totalVariance: number;
    } | null = null;
    if (rawType !== 'credit_memo' && body.acceptPOMatch && existing.linkedPurchaseOrderId) {
      try {
        interface POMatchedItem {
          poItemId: string;
          qtyFromInvoice?: number | string;
          invoiceUnitCost?: number | null;
        }
        const poMatchData = (existing.poMatchResult || {}) as { matchedItems?: POMatchedItem[] };
        const matchedItems = poMatchData.matchedItems || [];
        if (matchedItems.length > 0) {
          const poId = existing.linkedPurchaseOrderId;
          const receiveItems = matchedItems.map((m) => ({
            id: m.poItemId,
            qtyReceived: parseInt(String(m.qtyFromInvoice)) || 0,
            actualUnitCost: m.invoiceUnitCost ?? undefined,
          }));

          // Receive the PO using same logic as receivePurchaseOrder
          const po = await prisma.purchaseOrder.findUnique({
            where: { id: poId },
            include: { items: true },
          });

          if (po) {
            type PoItemRow = (typeof po.items)[number];
            let allReceived = true;
            let totalVariance = 0;
            for (const recv of receiveItems) {
              const poItem = (po.items as PoItemRow[]).find((i) => i.id === recv.id);
              if (!poItem) continue;
              const qtyRecv = parseInt(String(recv.qtyReceived)) || 0;
              const actualUnitCost = recv.actualUnitCost != null ? parseFloat(String(recv.actualUnitCost)) : null;
              let costVariance: number | null = null;
              let varianceFlag: string | null = null;
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
                where: { masterProductId: poItem.masterProductId, storeId: po.storeId as string },
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
        console.warn('[Invoice confirm] PO receive failed:', (poErr as Error).message);
      }
    }

    // ── Auto-detect returns (credit memos / negative quantities) ────────────
    let autoReturnResult: {
      returnId: string;
      returnNumber: string;
      itemCount: number;
      total: number;
    } | null = null;
    try {
      const CREDIT_PATTERNS = /credit|return|adjustment|cr\s?memo|refund/i;
      const returnItems = (lineItems || []).filter((li) => {
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
          const retItems = returnItems.map((li) => ({
            masterProductId: parseInt(String(li.linkedProductId || li.posProductId || 0)) || 0,
            qty: Math.abs(Number(li.quantity || li.qty || li.unitQty || 1)),
            unitCost: Math.abs(Number(li.unitCost || li.caseCost || 0)),
            lineTotal: Math.abs(Number(li.total || li.lineTotal || 0)),
            reason: 'credit_memo',
          })).filter((i) => i.masterProductId > 0);

          if (retItems.length > 0) {
            const totalCredit = retItems.reduce((s, i) => s + i.lineTotal, 0);
            const ret = await prisma.vendorReturn.create({
              data: {
                orgId: req.orgId as string,
                storeId: req.storeId || '',
                vendorId: vendor.id,
                returnNumber: retNumber + '-' + String(Date.now()).slice(-4),
                reason: 'credit_memo',
                status: 'credited',
                totalAmount: totalCredit,
                creditReceived: totalCredit,
                creditedAt: new Date(),
                notes: `Auto-created from invoice ${invoiceNumber || existing.id}`,
                createdById: req.user?.id || '',
                items: { create: retItems },
              },
            });
            autoReturnResult = { returnId: ret.id, returnNumber: ret.returnNumber, itemCount: retItems.length, total: Number(ret.totalAmount) };
          }
        }
      }
    } catch (retErr) {
      console.warn('[Invoice confirm] Return detection failed:', (retErr as Error).message);
    }

    res.json({
      message: 'Invoice synchronized with system',
      invoice,
      poReceiveResult,
      autoReturnResult,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Save draft changes without syncing to POS
// @route   PATCH /api/invoice/:id/draft
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const saveDraft = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const where: Prisma.InvoiceWhereInput = { id };
    if (req.orgId) where.orgId = req.orgId;

    const invoice = await prisma.invoice.findFirst({ where });
    if (!invoice) { res.status(404).json({ message: 'Invoice not found' }); return; }
    if (invoice.status === 'synced') {
      res.status(400).json({ message: 'Synced invoices cannot be edited' });
      return;
    }

    const ALLOWED = [
      'lineItems', 'vendorName', 'vendorId', 'invoiceNumber', 'invoiceDate',
      'paymentDueDate', 'paymentType', 'checkNumber', 'customerNumber',
      'totalInvoiceAmount', 'tax', 'totalDiscount', 'totalDeposit',
      'otherFees', 'driverName', 'salesRepName', 'loadNumber',
    ] as const;
    const body = (req.body || {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const field of ALLOWED) {
      if (body[field] !== undefined) patch[field] = body[field];
    }
    // Normalize vendorId to Int? | null
    if (patch.vendorId !== undefined) {
      const v = parseInt(String(patch.vendorId), 10);
      patch.vendorId = Number.isFinite(v) ? v : null;
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: patch as Prisma.InvoiceUpdateInput,
    });
    res.json({ message: 'Draft saved', invoice: updated });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get synced invoice history
// @route   GET /api/invoice/history
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const getInvoiceHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Prisma.InvoiceWhereInput = { status: 'synced' };
    if (req.orgId) where.orgId = req.orgId;

    const history = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Clear the POS product cache
// @route   POST /api/invoice/clear-pos-cache
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const clearInvoicePOSCache = async (req: Request, res: Response): Promise<void> => {
  try {
    clearPOSCache(req.user!.id);
    res.json({
      success: true,
      message: 'POS product cache cleared',
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get match accuracy analytics
// @route   GET /api/invoice/accuracy
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
interface MatchStats {
  total?: number;
  matched?: number;
  unmatched?: number;
  matchRate?: number;
  byTier?: Record<string, number>;
}

interface VendorAcc {
  vendor: string;
  invoices: number;
  totalItems: number;
  matched: number;
}

export const getMatchAccuracy = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Prisma.InvoiceWhereInput = { status: 'synced', matchStats: { not: PrismaNS.JsonNull } };
    if (req.orgId) where.orgId = req.orgId;

    const invoices = await prisma.invoice.findMany({
      where,
      select: { vendorName: true, matchStats: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    // Aggregate by vendor
    const byVendor: Record<string, VendorAcc> = {};
    let totalMatched = 0, totalItems = 0;
    const tierTotals: Record<string, number> = {};
    interface TimelineEntry { date: string | undefined; matchRate: number; vendor: string }
    const timeline: TimelineEntry[] = [];

    type InvoiceRow = (typeof invoices)[number];
    for (const inv of invoices as InvoiceRow[]) {
      const stats = inv.matchStats as MatchStats | null;
      if (!stats) continue;

      totalMatched += stats.matched || 0;
      totalItems += stats.total || 0;

      // By tier
      if (stats.byTier) {
        for (const [tier, count] of Object.entries(stats.byTier)) {
          tierTotals[tier] = (tierTotals[tier] || 0) + Number(count);
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
    const vendors = Object.values(byVendor).map((v) => ({
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
    res.status(500).json({ error: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Re-run the matching cascade on a draft invoice, scoped to a vendor.
//          Preserves any user-made manual matches; only re-matches items that
//          are currently unmatched or low-confidence.
// @route   POST /api/invoice/:id/rematch
// @body    { vendorId?: number, force?: boolean }
//          - vendorId: override invoice vendor (also persisted)
//          - force: if true, re-matches ALL items (including user-confirmed ones)
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
export const rematchInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const body = (req.body || {}) as { vendorId?: number | string; force?: boolean };
    const { vendorId: newVendorId, force } = body;

    const where: Prisma.InvoiceWhereInput = { id };
    if (req.orgId) where.orgId = req.orgId;

    const invoice = await prisma.invoice.findFirst({ where });
    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
    if (invoice.status === 'synced') {
      res.status(400).json({ error: 'Synced invoices cannot be re-matched' });
      return;
    }

    // Resolve final vendorId: explicit body value wins, else existing invoice value
    let targetVendorId = invoice.vendorId;
    if (newVendorId !== undefined) {
      const parsed = parseInt(String(newVendorId), 10);
      targetVendorId = Number.isFinite(parsed) ? parsed : null;
    }

    // Load catalog
    let posProducts = getPOSCache(req.user!.id);
    if (!posProducts || posProducts.length === 0) {
      posProducts = await loadCatalogProductsForMatching(req.orgId as string);
      if (posProducts.length > 0) setPOSCache(req.user!.id, posProducts);
    }
    posProducts = posProducts || [];

    const existingItems: InvoiceLineItem[] = Array.isArray(invoice.lineItems)
      ? (invoice.lineItems as unknown as InvoiceLineItem[])
      : [];

    // Split items into "preserve" (user-confirmed manual matches) vs "rematch".
    // Preserved items keep their mapping; only the rest go through the cascade.
    const toRematch: InvoiceLineItem[] = [];
    const preserved: InvoiceLineItem[] = [];
    for (const item of existingItems) {
      const isManual = item.mappingStatus === 'manual';
      const isHighConfidenceMatched = item.mappingStatus === 'matched' && item.confidence === 'high';
      if (!force && (isManual || isHighConfidenceMatched)) {
        preserved.push(item);
      } else {
        // Strip previous match metadata so the cascade sees a clean slate.
        // Keep the ORIGINAL vendor fields (description / itemCode / upc) not the POS-overwritten ones.
        toRematch.push({
          ...item,
          description: item.originalVendorDescription || item.description,
          itemCode:    item.originalItemCode          || item.itemCode,
          mappingStatus: 'unmatched',
          confidence:    null,
          matchTier:     null,
          linkedProductId: undefined,
        });
      }
    }

    let newlyMatched: InvoiceLineItem[] = [];
    if (toRematch.length > 0) {
      newlyMatched = (await matchLineItems(
        toRematch as unknown as Parameters<typeof matchLineItems>[0],
        posProducts,
        invoice.vendorName as string,
        { vendorId: targetVendorId } as Parameters<typeof matchLineItems>[3],
      )) as unknown as InvoiceLineItem[];
    }

    // Merge: preserved items keep their original position, newly-matched fill in.
    const rematchedQueue: InvoiceLineItem[] = [...newlyMatched];
    const merged: InvoiceLineItem[] = existingItems.map((orig) => {
      const isManual = orig.mappingStatus === 'manual';
      const isHighConfidenceMatched = orig.mappingStatus === 'matched' && orig.confidence === 'high';
      if (!force && (isManual || isHighConfidenceMatched)) return orig;
      return rematchedQueue.shift() || orig;
    });

    // Recompute matchStats
    const matchedCount = merged.filter((r) => r.mappingStatus === 'matched' || r.mappingStatus === 'manual').length;
    const total = merged.length;
    const byTier = merged.reduce<Record<string, number>>((acc, r) => {
      const key = r.matchTier || 'unmatched';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        vendorId:   targetVendorId,
        lineItems:  merged as unknown as Prisma.InputJsonValue,
        matchStats: {
          total,
          matched: matchedCount,
          unmatched: total - matchedCount,
          matchRate: total > 0 ? Math.round((matchedCount / total) * 10000) / 100 : 0,
          byTier,
          rematchedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    res.json({
      message: `Re-matched ${toRematch.length} item${toRematch.length === 1 ? '' : 's'} (${preserved.length} preserved)`,
      invoice: updated,
      stats: {
        total,
        matched: matchedCount,
        preserved: preserved.length,
        rematched: toRematch.length,
        matchRate: total > 0 ? Math.round((matchedCount / total) * 10000) / 100 : 0,
      },
    });
  } catch (error) {
    console.error('[rematchInvoice] failed:', error);
    res.status(500).json({ error: (error as Error).message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// VENDOR INVOICE SUMMARY (credit-memo aware)
// ══════════════════════════════════════════════════════════════════════════
export const getVendorInvoiceSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.orgId;
    const q = req.query as { vendorId?: string; vendorName?: string; from?: string; to?: string };
    const { vendorId, vendorName, from, to } = q;
    if (!vendorId && !vendorName) {
      res.status(400).json({ error: 'vendorId or vendorName is required' });
      return;
    }

    const now = new Date();
    const fromDate = from ? new Date(from + 'T00:00:00Z')
                         : new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to + 'T23:59:59Z') : now;

    const where: Prisma.InvoiceWhereInput = {
      orgId: orgId ?? undefined,
      status: 'synced',
      invoiceDate: { gte: fromDate, lte: toDate },
    };
    if (vendorId) where.vendorId = Number(vendorId);
    else where.vendorName = vendorName;

    const invoices = await prisma.invoice.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalInvoiceAmount: true,
        invoiceType: true,
        linkedInvoiceId: true,
      },
      orderBy: { invoiceDate: 'desc' },
    });
    type InvoiceSummaryRow = (typeof invoices)[number];

    let purchasesTotal = 0, purchasesCount = 0;
    let creditsTotal   = 0, creditsCount   = 0;
    const recentCredits: InvoiceSummaryRow[] = [];

    for (const inv of invoices as InvoiceSummaryRow[]) {
      const amt = Number(inv.totalInvoiceAmount || 0);
      if (inv.invoiceType === 'credit_memo') {
        creditsTotal += amt;
        creditsCount += 1;
        if (recentCredits.length < 10) recentCredits.push(inv);
      } else {
        purchasesTotal += amt;
        purchasesCount += 1;
      }
    }

    const netCost = Math.round((purchasesTotal - creditsTotal) * 100) / 100;

    res.json({
      vendor:   vendorName || null,
      vendorId: vendorId ? Number(vendorId) : null,
      from:     fromDate.toISOString().slice(0, 10),
      to:       toDate.toISOString().slice(0, 10),
      purchases: { count: purchasesCount, total: Math.round(purchasesTotal * 100) / 100 },
      credits:   { count: creditsCount,   total: Math.round(creditsTotal   * 100) / 100 },
      netCost,
      recentCredits,
    });
  } catch (error) {
    console.error('[getVendorInvoiceSummary] failed:', error);
    res.status(500).json({ error: (error as Error).message });
  }
};
