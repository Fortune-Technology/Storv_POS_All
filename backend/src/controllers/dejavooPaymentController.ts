/**
 * dejavooPaymentController.ts
 *
 * REST endpoints for Dejavoo SPIn payment operations.
 * Called by the cashier app's TenderModal when processing card payments.
 *
 * Routes (mounted at /api/payment/dejavoo):
 *   POST /sale           — Card-present sale
 *   POST /refund         — Return / refund
 *   POST /void           — Void a previous transaction
 *   POST /ebt-balance    — EBT balance inquiry
 *   POST /cancel         — Abort in-flight terminal transaction
 *   POST /status         — Check transaction status
 *   POST /terminal-status — Check terminal connectivity
 *   POST /settle         — Close batch
 */

import type { Request, Response } from 'express';
import prisma from '../config/postgres.js';
import {
  loadMerchantByStation,
  processSale,
  processRefund,
  processVoid,
  checkEbtBalance,
  cancelTransaction,
  checkTerminalStatus,
  settleBatch,
  checkTransactionStatus,
  promptUserInput,
} from '../services/paymentProviderFactory.js';

const getOrgId  = (req: Request): string | null | undefined => req.orgId || req.user?.orgId;
const getStoreId = (req: Request): string | null | undefined =>
  (req.headers['x-store-id'] as string | undefined)
  || req.storeId
  || (req.body as { storeId?: string } | undefined)?.storeId;

interface ProviderResult {
  approved?: boolean;
  referenceId?: string | null;
  authCode?: string | null;
  statusCode?: string | null;
  message?: string | null;
  last4?: string | null;
  cardType?: string | null;
  expiry?: string | null;
  entryType?: string | null;
  totalAmount?: number;
  signatureData?: string | null;
  connected?: boolean;
  value?: string | null;
}

interface RecordTxOpts {
  type?: string;
  amount?: number;
  invoiceNumber?: string | null;
  posTransactionId?: string | null;
  originalReferenceId?: string | null;
}

// ── Record a PaymentTransaction in the DB ───────────────────────────────────
async function recordTransaction(
  orgId: string,
  storeId: string,
  merchantId: string,
  result: ProviderResult,
  opts: RecordTxOpts,
) {
  try {
    return await prisma.paymentTransaction.create({
      data: {
        orgId,
        storeId,
        merchantId,
        // Transaction details
        type:           opts.type || 'sale',
        status:         result.approved ? 'approved' : 'declined',
        amount:         opts.amount || 0,
        // Provider response
        retref:         result.referenceId || null,
        authCode:       result.authCode    || null,
        respCode:       result.statusCode  || null,
        respText:       result.message     || null,
        // Card info (PCI-safe)
        token:          null, // Dejavoo doesn't return tokens via SPIn (use GetCard separately)
        lastFour:       result.last4       || null,
        acctType:       result.cardType    || null,
        expiry:         result.expiry      || null,
        entryMode:      result.entryType   || null,
        // Amounts
        capturedAmount: result.approved ? (result.totalAmount ?? opts.amount) : null,
        // Linkage
        originalRetref: opts.originalReferenceId || null,
        invoiceNumber:  opts.invoiceNumber       || null,
        posTransactionId: opts.posTransactionId  || null,
        // Signature
        signatureData:    result.signatureData   || null,
        signatureCaptured: !!result.signatureData,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[dejavooPaymentController] Failed to record transaction:', message);
    return null;
  }
}

interface SaleBody {
  stationId?: string;
  amount?: number | string;
  paymentType?: string;
  invoiceNumber?: string | null;
  posTransactionId?: string | null;
  captureSignature?: boolean;
}

// ═════════════════════════════════════════════════════════════════════════════
// SALE
// POST /api/payment/dejavoo/sale
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooSale = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req) as string;
    const storeId = getStoreId(req);
    const { stationId, amount, paymentType, invoiceNumber, posTransactionId, captureSignature } = req.body as SaleBody;

    if (!stationId || !amount) {
      res.status(400).json({ success: false, error: 'stationId and amount are required' });
      return;
    }

    const { merchant, station } = await loadMerchantByStation(stationId);

    const result = await processSale(merchant, {
      amount:           Number(amount),
      paymentType:      paymentType || 'card',
      invoiceNumber:    invoiceNumber || '',
      registerId:       station.name || stationId,
      captureSignature: captureSignature || false,
    } as Parameters<typeof processSale>[1]) as ProviderResult;

    // Record in DB regardless of approval/decline
    const txRecord = await recordTransaction(orgId, storeId || merchant.storeId, merchant.id, result, {
      type: 'sale',
      amount: Number(amount),
      invoiceNumber,
      posTransactionId,
    });

    res.json({
      success: !!result.approved,
      result,
      paymentTransactionId: txRecord?.id || null,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooSale]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};

interface RefundBody {
  stationId?: string;
  amount?: number | string;
  paymentType?: string;
  originalReferenceId?: string | null;
  invoiceNumber?: string | null;
}

// ═════════════════════════════════════════════════════════════════════════════
// REFUND
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooRefund = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req) as string;
    const storeId = getStoreId(req);
    const { stationId, amount, paymentType, originalReferenceId, invoiceNumber } = req.body as RefundBody;

    if (!stationId || !amount) {
      res.status(400).json({ success: false, error: 'stationId and amount are required' });
      return;
    }

    const { merchant, station } = await loadMerchantByStation(stationId);

    const result = await processRefund(merchant, {
      amount:              Number(amount),
      paymentType:         paymentType || 'card',
      originalReferenceId: originalReferenceId || null,
      invoiceNumber:       invoiceNumber || '',
      registerId:          station.name || stationId,
    } as Parameters<typeof processRefund>[1]) as ProviderResult;

    const txRecord = await recordTransaction(orgId, storeId || merchant.storeId, merchant.id, result, {
      type: 'refund',
      amount: Number(amount),
      originalReferenceId,
      invoiceNumber,
    });

    res.json({
      success: !!result.approved,
      result,
      paymentTransactionId: txRecord?.id || null,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooRefund]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};

interface VoidBody {
  stationId?: string;
  originalReferenceId?: string;
}

// ═════════════════════════════════════════════════════════════════════════════
// VOID
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooVoid = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req) as string;
    const storeId = getStoreId(req);
    const { stationId, originalReferenceId } = req.body as VoidBody;

    if (!stationId || !originalReferenceId) {
      res.status(400).json({ success: false, error: 'stationId and originalReferenceId are required' });
      return;
    }

    const { merchant, station } = await loadMerchantByStation(stationId);

    const result = await processVoid(merchant, {
      originalReferenceId,
      registerId: station.name || stationId,
    } as Parameters<typeof processVoid>[1]) as ProviderResult;

    const txRecord = await recordTransaction(orgId, storeId || merchant.storeId, merchant.id, result, {
      type: 'void',
      amount: 0,
      originalReferenceId,
    });

    res.json({
      success: !!result.approved,
      result,
      paymentTransactionId: txRecord?.id || null,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooVoid]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};

interface EbtBalanceBody {
  stationId?: string;
  paymentType?: string;
}

// ═════════════════════════════════════════════════════════════════════════════
// EBT BALANCE
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooEbtBalance = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId, paymentType } = req.body as EbtBalanceBody;

    if (!stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }

    const { merchant, station } = await loadMerchantByStation(stationId);

    const result = await checkEbtBalance(merchant, {
      paymentType: paymentType || 'ebt_food',
      registerId:  station.name || stationId,
    } as Parameters<typeof checkEbtBalance>[1]) as ProviderResult;

    res.json({ success: !!result.approved, result });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooEbtBalance]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};

interface CancelBody {
  stationId?: string;
  referenceId?: string;
}

// ═════════════════════════════════════════════════════════════════════════════
// CANCEL / ABORT
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooCancel = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId, referenceId } = req.body as CancelBody;

    if (!stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }

    const { merchant } = await loadMerchantByStation(stationId);

    const result = await cancelTransaction(merchant, { referenceId } as Parameters<typeof cancelTransaction>[1]);

    res.json({ success: true, result });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooCancel]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// TERMINAL STATUS (ping)
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooTerminalStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId } = req.body as { stationId?: string };

    if (!stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }

    const { merchant } = await loadMerchantByStation(stationId);

    const result = await checkTerminalStatus(merchant) as ProviderResult;

    res.json({ success: !!result.connected, result });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooTerminalStatus]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// TRANSACTION STATUS
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooTransactionStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId, referenceId } = req.body as { stationId?: string; referenceId?: string };

    if (!stationId || !referenceId) {
      res.status(400).json({ success: false, error: 'stationId and referenceId are required' });
      return;
    }

    const { merchant } = await loadMerchantByStation(stationId);

    const result = await checkTransactionStatus(merchant, { referenceId } as Parameters<typeof checkTransactionStatus>[1]);

    res.json({ success: true, result });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooTransactionStatus]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// SETTLE / CLOSE BATCH
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooSettle = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId } = req.body as { stationId?: string };

    if (!stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }

    const { merchant } = await loadMerchantByStation(stationId);

    const result = await settleBatch(merchant) as ProviderResult;

    res.json({ success: !!result.approved, result });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooSettle]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};

interface LookupCustomerBody {
  stationId?: string;
  title?: string;
  prompt?: string;
  minLength?: number;
  maxLength?: number;
  timeoutSec?: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// LOOKUP CUSTOMER BY PHONE
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooLookupCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const { stationId, title, prompt, minLength, maxLength, timeoutSec } = req.body as LookupCustomerBody;

    if (!stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }

    const { merchant } = await loadMerchantByStation(stationId);

    // Prompt customer on the terminal for phone input
    const result = await promptUserInput(merchant, {
      title:      title     || 'Loyalty Lookup',
      prompt:     prompt    || 'Enter phone number',
      inputType:  'Numeric',
      minLength:  minLength ?? 7,
      maxLength:  maxLength ?? 15,
      timeoutSec: timeoutSec ?? 45,
    } as Parameters<typeof promptUserInput>[1]) as ProviderResult;

    if (!result.approved || !result.value) {
      res.json({
        success: false,
        reason:  result.statusCode === '1012' ? 'cancelled' : 'no_input',
        message: result.message || 'No phone number entered',
      });
      return;
    }

    // Normalize — strip everything but digits; keep last 10 for US phone match
    const digits = String(result.value).replace(/\D/g, '');
    if (digits.length < 7) {
      res.json({
        success: false,
        reason:  'invalid_format',
        message: 'Phone number too short',
        rawValue: result.value,
      });
      return;
    }

    const last10 = digits.slice(-10);

    // Search Customer table — match by phone field containing those digits.
    const candidates = await prisma.customer.findMany({
      where: {
        orgId,
        phone: { not: null },
      },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true, loyaltyPoints: true, balance: true, discount: true },
      take: 50,
    });

    type CandidateRow = (typeof candidates)[number];
    const match = candidates.find((c: CandidateRow) => {
      const cDigits = String(c.phone || '').replace(/\D/g, '');
      return cDigits.endsWith(last10);
    });

    if (!match) {
      res.json({
        success:   true,
        notFound:  true,
        phone:     digits,
        message:   'No customer found with this phone — cashier can create a new one',
      });
      return;
    }

    res.json({
      success: true,
      customer: {
        id:            match.id,
        firstName:     match.firstName,
        lastName:      match.lastName,
        phone:         match.phone,
        email:         match.email,
        loyaltyPoints: match.loyaltyPoints,
        balance:       match.balance,
        discount:      match.discount,
      },
      phoneEntered: digits,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooLookupCustomer]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// READ-ONLY MERCHANT STATUS
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooMerchantStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) {
      res.status(400).json({ success: false, error: 'storeId is required (X-Store-Id header)' });
      return;
    }

    const merchant = await prisma.paymentMerchant.findUnique({
      where: { storeId },
      select: {
        provider: true,
        environment: true,
        status: true,
        ebtEnabled: true,
        debitEnabled: true,
        spinTpn: true,
        lastTestedAt: true,
        lastTestResult: true,
        updatedAt: true,
      },
    });

    if (!merchant) {
      res.json({ success: true, configured: false });
      return;
    }

    res.json({
      success: true,
      configured: true,
      provider:       merchant.provider,
      environment:    merchant.environment,
      status:         merchant.status,
      ebtEnabled:     merchant.ebtEnabled,
      debitEnabled:   merchant.debitEnabled,
      hasTpn:         !!merchant.spinTpn,
      lastTestedAt:   merchant.lastTestedAt,
      lastTestResult: merchant.lastTestResult,
      updatedAt:      merchant.updatedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[dejavooMerchantStatus]', err);
    res.status(500).json({ success: false, error: message });
  }
};
