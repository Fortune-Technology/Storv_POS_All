/**
 * dejavooPaymentController.js
 *
 * REST endpoints for Dejavoo SPIn payment operations.
 * Called by the cashier app's TenderModal when processing card payments.
 *
 * All endpoints:
 *   1. Resolve the store's PaymentMerchant (via stationId → storeId)
 *   2. Decrypt credentials
 *   3. Dispatch to the provider factory
 *   4. Record the PaymentTransaction
 *   5. Return normalized result to the cashier app
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

const getOrgId  = (req) => req.orgId || req.user?.orgId;
const getStoreId = (req) => req.headers['x-store-id'] || req.storeId || req.body?.storeId;

// ── Record a PaymentTransaction in the DB ───────────────────────────────────
async function recordTransaction(orgId, storeId, merchantId, result, opts) {
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
    console.error('[dejavooPaymentController] Failed to record transaction:', err.message);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SALE
// POST /api/payment/dejavoo/sale
// Body: { stationId, amount, paymentType?, invoiceNumber?, posTransactionId? }
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooSale = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStoreId(req);
    const { stationId, amount, paymentType, invoiceNumber, posTransactionId, captureSignature } = req.body;

    if (!stationId || !amount) {
      return res.status(400).json({ success: false, error: 'stationId and amount are required' });
    }

    const { merchant, station } = await loadMerchantByStation(stationId);

    const result = await processSale(merchant, {
      amount:           Number(amount),
      paymentType:      paymentType || 'card',
      invoiceNumber:    invoiceNumber || '',
      registerId:       station.name || stationId,
      captureSignature: captureSignature || false,
    });

    // Record in DB regardless of approval/decline
    const txRecord = await recordTransaction(orgId, storeId || merchant.storeId, merchant.id, result, {
      type: 'sale',
      amount: Number(amount),
      invoiceNumber,
      posTransactionId,
    });

    res.json({
      success: result.approved,
      result,
      paymentTransactionId: txRecord?.id || null,
    });
  } catch (err) {
    console.error('[dejavooSale]', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// REFUND
// POST /api/payment/dejavoo/refund
// Body: { stationId, amount, paymentType?, originalReferenceId?, invoiceNumber? }
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooRefund = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStoreId(req);
    const { stationId, amount, paymentType, originalReferenceId, invoiceNumber } = req.body;

    if (!stationId || !amount) {
      return res.status(400).json({ success: false, error: 'stationId and amount are required' });
    }

    const { merchant, station } = await loadMerchantByStation(stationId);

    const result = await processRefund(merchant, {
      amount:              Number(amount),
      paymentType:         paymentType || 'card',
      originalReferenceId: originalReferenceId || null,
      invoiceNumber:       invoiceNumber || '',
      registerId:          station.name || stationId,
    });

    const txRecord = await recordTransaction(orgId, storeId || merchant.storeId, merchant.id, result, {
      type: 'refund',
      amount: Number(amount),
      originalReferenceId,
      invoiceNumber,
    });

    res.json({
      success: result.approved,
      result,
      paymentTransactionId: txRecord?.id || null,
    });
  } catch (err) {
    console.error('[dejavooRefund]', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// VOID
// POST /api/payment/dejavoo/void
// Body: { stationId, originalReferenceId }
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooVoid = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStoreId(req);
    const { stationId, originalReferenceId } = req.body;

    if (!stationId || !originalReferenceId) {
      return res.status(400).json({ success: false, error: 'stationId and originalReferenceId are required' });
    }

    const { merchant, station } = await loadMerchantByStation(stationId);

    const result = await processVoid(merchant, {
      originalReferenceId,
      registerId: station.name || stationId,
    });

    const txRecord = await recordTransaction(orgId, storeId || merchant.storeId, merchant.id, result, {
      type: 'void',
      amount: 0,
      originalReferenceId,
    });

    res.json({
      success: result.approved,
      result,
      paymentTransactionId: txRecord?.id || null,
    });
  } catch (err) {
    console.error('[dejavooVoid]', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// EBT BALANCE
// POST /api/payment/dejavoo/ebt-balance
// Body: { stationId, paymentType? ('ebt_food' | 'ebt_cash') }
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooEbtBalance = async (req, res) => {
  try {
    const { stationId, paymentType } = req.body;

    if (!stationId) {
      return res.status(400).json({ success: false, error: 'stationId is required' });
    }

    const { merchant, station } = await loadMerchantByStation(stationId);

    const result = await checkEbtBalance(merchant, {
      paymentType: paymentType || 'ebt_food',
      registerId:  station.name || stationId,
    });

    res.json({ success: result.approved, result });
  } catch (err) {
    console.error('[dejavooEbtBalance]', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// CANCEL / ABORT
// POST /api/payment/dejavoo/cancel
// Body: { stationId, referenceId }
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooCancel = async (req, res) => {
  try {
    const { stationId, referenceId } = req.body;

    if (!stationId) {
      return res.status(400).json({ success: false, error: 'stationId is required' });
    }

    const { merchant } = await loadMerchantByStation(stationId);

    const result = await cancelTransaction(merchant, { referenceId });

    res.json({ success: true, result });
  } catch (err) {
    console.error('[dejavooCancel]', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// TERMINAL STATUS (ping)
// POST /api/payment/dejavoo/terminal-status
// Body: { stationId }
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooTerminalStatus = async (req, res) => {
  try {
    const { stationId } = req.body;

    if (!stationId) {
      return res.status(400).json({ success: false, error: 'stationId is required' });
    }

    const { merchant } = await loadMerchantByStation(stationId);

    const result = await checkTerminalStatus(merchant);

    res.json({ success: result.connected, result });
  } catch (err) {
    console.error('[dejavooTerminalStatus]', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// TRANSACTION STATUS
// POST /api/payment/dejavoo/status
// Body: { stationId, referenceId }
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooTransactionStatus = async (req, res) => {
  try {
    const { stationId, referenceId } = req.body;

    if (!stationId || !referenceId) {
      return res.status(400).json({ success: false, error: 'stationId and referenceId are required' });
    }

    const { merchant } = await loadMerchantByStation(stationId);

    const result = await checkTransactionStatus(merchant, { referenceId });

    res.json({ success: true, result });
  } catch (err) {
    console.error('[dejavooTransactionStatus]', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// SETTLE / CLOSE BATCH
// POST /api/payment/dejavoo/settle
// Body: { stationId }
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooSettle = async (req, res) => {
  try {
    const { stationId } = req.body;

    if (!stationId) {
      return res.status(400).json({ success: false, error: 'stationId is required' });
    }

    const { merchant } = await loadMerchantByStation(stationId);

    const result = await settleBatch(merchant);

    res.json({ success: result.approved, result });
  } catch (err) {
    console.error('[dejavooSettle]', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// LOOKUP CUSTOMER BY PHONE (SPIn UserInput → local Customer search)
// POST /api/payment/dejavoo/lookup-customer
// Body: { stationId, title?, prompt?, minLength?, maxLength?, timeoutSec? }
//
// Flow:
//   1. Prompts customer on the terminal: "Enter phone number"
//   2. Customer types their phone on the terminal keypad
//   3. Strip non-digits, normalize to last-10-digit match
//   4. Search Customer table for match
//   5. Return customer if found, or { notFound: true, phone }
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooLookupCustomer = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { stationId, title, prompt, minLength, maxLength, timeoutSec } = req.body;

    if (!stationId) {
      return res.status(400).json({ success: false, error: 'stationId is required' });
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
    });

    if (!result.approved || !result.value) {
      return res.json({
        success: false,
        reason:  result.statusCode === '1012' ? 'cancelled' : 'no_input',
        message: result.message || 'No phone number entered',
      });
    }

    // Normalize — strip everything but digits; keep last 10 for US phone match
    const digits = String(result.value).replace(/\D/g, '');
    if (digits.length < 7) {
      return res.json({
        success: false,
        reason:  'invalid_format',
        message: 'Phone number too short',
        rawValue: result.value,
      });
    }

    const last10 = digits.slice(-10);

    // Search Customer table — match by phone field containing those digits.
    // This handles +1-555-555-0100, (555) 555-0100, 5555550100, etc.
    const candidates = await prisma.customer.findMany({
      where: {
        orgId,
        phone: { not: null },
      },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true, loyaltyPoints: true, balance: true, discount: true },
      take: 50,
    });

    const match = candidates.find(c => {
      const cDigits = String(c.phone || '').replace(/\D/g, '');
      return cDigits.endsWith(last10);
    });

    if (!match) {
      return res.json({
        success:   true,
        notFound:  true,
        phone:     digits,
        message:   'No customer found with this phone — cashier can create a new one',
      });
    }

    return res.json({
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
    console.error('[dejavooLookupCustomer]', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// READ-ONLY MERCHANT STATUS (for portal PaymentSettings page)
// GET /api/payment/dejavoo/merchant-status
// Returns { configured, provider, environment } — NO secrets
// ═════════════════════════════════════════════════════════════════════════════

export const dejavooMerchantStatus = async (req, res) => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId is required (X-Store-Id header)' });

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
      return res.json({ success: true, configured: false });
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
    console.error('[dejavooMerchantStatus]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
