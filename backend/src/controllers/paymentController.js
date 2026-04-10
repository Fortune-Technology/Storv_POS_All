/**
 * paymentController.js
 *
 * Handles all card-payment operations:
 *   • CardPointe Integrated Terminal (tap / swipe / insert / manual entry)
 *   • CardPointe Gateway (void, refund, inquire)
 *   • PaymentSettings per store
 *   • Merchant credential management
 *   • Terminal management (CRUD)
 *
 * Legacy PAX POSLINK handlers are kept at the bottom for backward compatibility
 * with any stations not yet migrated to CardPointe.
 */

import axios from 'axios';
import prisma from '../config/postgres.js';
import {
  getMerchantConfig,
  encryptCredential,
  decryptCredential,
  terminalConnect,
  terminalDisconnect,
  terminalAuthCard,
  terminalReadSignature,
  terminalCancel,
  terminalPing,
  gatewayVoid,
  gatewayRefund,
  gatewayInquire,
  fmtAmount,
  parseTerminalResult,
} from '../services/cardPointeService.js';

const getOrgId  = (req) => req.orgId  || req.user?.orgId;
const getStore  = (req) => req.headers['x-store-id'] || req.storeId || req.query.storeId || req.body?.storeId;

// ═════════════════════════════════════════════════════════════════════════════
// CARDPOINTE — TERMINAL CHARGE
// POST /payment/cp/charge
//
// Body: { terminalId, amount, invoiceNumber, orderId?, captureSignature? }
// Returns: { approved, retref, lastFour, acctType, entryMode, authCode,
//            signature?, paymentTransactionId }
// ═════════════════════════════════════════════════════════════════════════════
export const cpCharge = async (req, res) => {
  const orgId   = getOrgId(req);
  const storeId = getStore(req);
  const { terminalId, amount, invoiceNumber, orderId, captureSignature = false } = req.body;

  if (!terminalId || !amount) {
    return res.status(400).json({ success: false, error: 'terminalId and amount are required' });
  }

  // Load terminal record
  const terminal = await prisma.paymentTerminal.findFirst({
    where: { id: terminalId, orgId },
  }).catch(() => null);
  if (!terminal) return res.status(404).json({ success: false, error: 'Payment terminal not found' });

  // Load merchant credentials
  const merchant = await getMerchantConfig(orgId);
  if (!merchant) return res.status(400).json({ success: false, error: 'CardPointe merchant credentials not configured for this organization' });

  // Create pending PaymentTransaction record
  const pendingTx = await prisma.paymentTransaction.create({
    data: {
      orgId,
      storeId: storeId || terminal.storeId,
      terminalId: terminal.id,
      merchantId: merchant.id,
      amount:     Number(amount),
      type:       'sale',
      status:     'pending',
      invoiceNumber: invoiceNumber || null,
    },
  });

  try {
    // 1. Connect to terminal
    await terminalConnect(merchant, terminal.hsn);

    // 2. Auth card (tap / swipe / insert — customer interacts with terminal)
    const authResult = await terminalAuthCard(merchant, terminal.hsn, {
      amount:    fmtAmount(amount),
      invokeId:  invoiceNumber || pendingTx.id,
      orderId:   orderId || undefined,
    });

    const parsed = parseTerminalResult(authResult);

    if (!parsed.approved) {
      // Update PaymentTransaction as declined
      await prisma.paymentTransaction.update({
        where: { id: pendingTx.id },
        data: {
          status:   'declined',
          respCode: parsed.respcode,
          respText: parsed.resptext,
          retref:   parsed.retref || undefined,
          token:    parsed.token  || undefined,
          lastFour: parsed.lastFour || undefined,
          acctType: parsed.acctType || undefined,
          entryMode: parsed.entryMode || undefined,
        },
      });

      await terminalDisconnect(merchant, terminal.hsn).catch(() => {});
      return res.status(402).json({
        success:  false,
        approved: false,
        respcode: parsed.respcode,
        resptext: parsed.resptext,
        paymentTransactionId: pendingTx.id,
      });
    }

    // 3. Optionally capture signature
    let signatureData = null;
    if (captureSignature && parsed.approved) {
      try {
        const sigResult = await terminalReadSignature(merchant, terminal.hsn, 'Please sign below');
        signatureData   = sigResult?.signature || null;
      } catch {
        // Non-fatal — proceed without signature
      }
    }

    // 4. Disconnect terminal
    await terminalDisconnect(merchant, terminal.hsn).catch(() => {});

    // 5. Update PaymentTransaction to approved
    const updatedTx = await prisma.paymentTransaction.update({
      where: { id: pendingTx.id },
      data: {
        status:           'approved',
        retref:           parsed.retref   || undefined,
        authCode:         parsed.authCode || undefined,
        respCode:         parsed.respcode,
        respText:         parsed.resptext,
        token:            parsed.token    || undefined,
        lastFour:         parsed.lastFour || undefined,
        acctType:         parsed.acctType || undefined,
        expiry:           parsed.expiry   || undefined,
        entryMode:        parsed.entryMode || undefined,
        capturedAmount:   Number(amount),
        signatureData:    signatureData   || undefined,
        signatureCaptured: !!signatureData,
      },
    });

    // 6. Update terminal last-seen timestamp (fire-and-forget)
    prisma.paymentTerminal.update({
      where: { id: terminal.id },
      data:  { lastSeenAt: new Date(), status: 'active' },
    }).catch(() => {});

    return res.json({
      success:  true,
      approved: true,
      retref:   parsed.retref,
      authCode: parsed.authCode,
      lastFour: parsed.lastFour,
      acctType: parsed.acctType,
      entryMode: parsed.entryMode,
      signatureCaptured: !!signatureData,
      signatureData:     signatureData,
      paymentTransactionId: updatedTx.id,
    });

  } catch (err) {
    // Mark as error in DB
    await prisma.paymentTransaction.update({
      where: { id: pendingTx.id },
      data: { status: 'error', respText: err.message },
    }).catch(() => {});

    // Attempt cleanup disconnect
    terminalDisconnect(merchant, terminal.hsn).catch(() => {});

    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
      return res.status(503).json({ success: false, error: 'Cannot reach payment terminal. Check network connection.' });
    }
    const apiError = err.response?.data?.errorMessage || err.response?.data?.error || err.message;
    return res.status(500).json({ success: false, error: apiError });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// CARDPOINTE — CAPTURE SIGNATURE (standalone — after charge)
// POST /payment/cp/signature
//
// Body: { terminalId, paymentTransactionId }
// ═════════════════════════════════════════════════════════════════════════════
export const cpSignature = async (req, res) => {
  const orgId = getOrgId(req);
  const { terminalId, paymentTransactionId } = req.body;

  const terminal = await prisma.paymentTerminal.findFirst({ where: { id: terminalId, orgId } });
  if (!terminal) return res.status(404).json({ success: false, error: 'Terminal not found' });

  const merchant = await getMerchantConfig(orgId);
  if (!merchant) return res.status(400).json({ success: false, error: 'Merchant credentials not configured' });

  try {
    await terminalConnect(merchant, terminal.hsn);
    const sigResult = await terminalReadSignature(merchant, terminal.hsn, 'Please sign below');
    await terminalDisconnect(merchant, terminal.hsn).catch(() => {});

    const signatureData = sigResult?.signature || null;

    if (paymentTransactionId) {
      await prisma.paymentTransaction.update({
        where: { id: paymentTransactionId },
        data:  { signatureData, signatureCaptured: !!signatureData },
      }).catch(() => {});
    }

    return res.json({ success: true, signature: signatureData });
  } catch (err) {
    terminalDisconnect(merchant, terminal.hsn).catch(() => {});
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// CARDPOINTE — VOID
// POST /payment/cp/void
//
// Body: { paymentTransactionId } OR { retref }
// ═════════════════════════════════════════════════════════════════════════════
export const cpVoid = async (req, res) => {
  const orgId = getOrgId(req);
  const { paymentTransactionId, retref: directRetref } = req.body;

  let payTx = null;
  let retref = directRetref;

  if (paymentTransactionId) {
    payTx  = await prisma.paymentTransaction.findFirst({ where: { id: paymentTransactionId, orgId } });
    if (!payTx) return res.status(404).json({ success: false, error: 'Payment transaction not found' });
    retref = payTx.retref;
  }

  if (!retref) return res.status(400).json({ success: false, error: 'retref or paymentTransactionId required' });

  const merchant = await getMerchantConfig(orgId);
  if (!merchant) return res.status(400).json({ success: false, error: 'Merchant credentials not configured' });

  try {
    const result = await gatewayVoid(merchant, retref);
    const approved = result?.respcode === '00' || result?.respcode === '000';

    if (payTx && approved) {
      await prisma.paymentTransaction.update({
        where: { id: payTx.id },
        data:  { status: 'voided', type: 'void' },
      }).catch(() => {});
    }

    return res.json({ success: approved, approved, retref: result?.retref, resptext: result?.resptext });
  } catch (err) {
    const apiError = err.response?.data?.errorMessage || err.message;
    return res.status(500).json({ success: false, error: apiError });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// CARDPOINTE — REFUND
// POST /payment/cp/refund
//
// Body: { paymentTransactionId?, retref?, amount? }
// amount omitted = full refund
// ═════════════════════════════════════════════════════════════════════════════
export const cpRefund = async (req, res) => {
  const orgId   = getOrgId(req);
  const storeId = getStore(req);
  const { paymentTransactionId, retref: directRetref, amount } = req.body;

  let payTx = null;
  let retref = directRetref;

  if (paymentTransactionId) {
    payTx  = await prisma.paymentTransaction.findFirst({ where: { id: paymentTransactionId, orgId } });
    if (!payTx) return res.status(404).json({ success: false, error: 'Payment transaction not found' });
    retref = payTx.retref;
  }

  if (!retref) return res.status(400).json({ success: false, error: 'retref or paymentTransactionId required' });

  const merchant = await getMerchantConfig(orgId);
  if (!merchant) return res.status(400).json({ success: false, error: 'Merchant credentials not configured' });

  try {
    const result = await gatewayRefund(merchant, retref, amount);
    const approved = result?.respcode === '00' || result?.respcode === '000';

    // Record refund as a separate PaymentTransaction
    if (approved) {
      await prisma.paymentTransaction.create({
        data: {
          orgId,
          storeId: storeId || payTx?.storeId || '',
          merchantId: merchant.id,
          terminalId: payTx?.terminalId || undefined,
          amount:    Number(amount || payTx?.amount || 0),
          type:      'refund',
          status:    'approved',
          retref:    result.retref || undefined,
          authCode:  result.authcode || undefined,
          respCode:  result.respcode,
          respText:  result.resptext || undefined,
          originalRetref: retref,
          lastFour:  payTx?.lastFour || undefined,
          acctType:  payTx?.acctType || undefined,
        },
      }).catch(() => {});

      // Mark original as refunded
      if (payTx) {
        await prisma.paymentTransaction.update({
          where: { id: payTx.id },
          data:  { status: 'refunded' },
        }).catch(() => {});
      }
    }

    return res.json({ success: approved, approved, retref: result?.retref, resptext: result?.resptext });
  } catch (err) {
    const apiError = err.response?.data?.errorMessage || err.message;
    return res.status(500).json({ success: false, error: apiError });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// CARDPOINTE — CANCEL TERMINAL OPERATION
// POST /payment/cp/cancel
//
// Body: { terminalId }
// ═════════════════════════════════════════════════════════════════════════════
export const cpCancel = async (req, res) => {
  const orgId = getOrgId(req);
  const { terminalId } = req.body;

  const terminal = await prisma.paymentTerminal.findFirst({ where: { id: terminalId, orgId } });
  if (!terminal) return res.status(404).json({ success: false, error: 'Terminal not found' });

  const merchant = await getMerchantConfig(orgId);
  if (!merchant) return res.status(400).json({ success: false, error: 'Merchant credentials not configured' });

  try {
    const result = await terminalCancel(merchant, terminal.hsn);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// CARDPOINTE — INQUIRE TRANSACTION
// GET /payment/cp/inquire/:retref
// ═════════════════════════════════════════════════════════════════════════════
export const cpInquire = async (req, res) => {
  const orgId  = getOrgId(req);
  const retref = req.params.retref;

  const merchant = await getMerchantConfig(orgId);
  if (!merchant) return res.status(400).json({ success: false, error: 'Merchant credentials not configured' });

  try {
    const result = await gatewayInquire(merchant, retref);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// MERCHANT CREDENTIALS
// GET  /payment/merchant
// PUT  /payment/merchant
// ═════════════════════════════════════════════════════════════════════════════
export const getMerchant = async (req, res) => {
  const orgId = getOrgId(req);
  const m = await prisma.cardPointeMerchant.findUnique({ where: { orgId } });
  if (!m) return res.json({ success: true, data: null });
  // Never expose raw apiPassword — return a masked version
  return res.json({
    success: true,
    data: {
      id: m.id, orgId: m.orgId, merchId: m.merchId,
      apiUser: m.apiUser,
      apiPasswordMasked: '••••••••',
      site: m.site, baseUrl: m.baseUrl, isLive: m.isLive,
      createdAt: m.createdAt, updatedAt: m.updatedAt,
    },
  });
};

export const saveMerchant = async (req, res) => {
  const orgId = getOrgId(req);
  const { merchId, apiUser, apiPassword, site, baseUrl, isLive } = req.body;

  if (!merchId || !apiUser || !apiPassword) {
    return res.status(400).json({ success: false, error: 'merchId, apiUser, and apiPassword are required' });
  }

  const encPw = encryptCredential(apiPassword);

  const existing = await prisma.cardPointeMerchant.findUnique({ where: { orgId } });

  const data = {
    merchId,
    apiUser,
    apiPassword: encPw,
    site:    site    || 'fts',
    baseUrl: baseUrl || null,
    isLive:  isLive  ?? false,
  };

  let m;
  if (existing) {
    m = await prisma.cardPointeMerchant.update({ where: { orgId }, data });
  } else {
    m = await prisma.cardPointeMerchant.create({ data: { orgId, ...data } });
  }

  return res.json({
    success: true,
    data: { id: m.id, merchId: m.merchId, apiUser: m.apiUser, site: m.site, isLive: m.isLive },
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// PAYMENT TERMINALS CRUD
// GET    /payment/terminals
// POST   /payment/terminals
// PUT    /payment/terminals/:id
// DELETE /payment/terminals/:id
// POST   /payment/terminals/:id/ping
// ═════════════════════════════════════════════════════════════════════════════
export const listTerminals = async (req, res) => {
  const orgId   = getOrgId(req);
  const storeId = getStore(req);
  const where   = { orgId, ...(storeId ? { storeId } : {}) };

  const terminals = await prisma.paymentTerminal.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: { station: { select: { id: true, name: true } } },
  });
  return res.json({ success: true, data: terminals });
};

export const createTerminal = async (req, res) => {
  const orgId   = getOrgId(req);
  const storeId = getStore(req);
  const { hsn, name, ipAddress, port, model, stationId } = req.body;

  if (!hsn) return res.status(400).json({ success: false, error: 'hsn (hardware serial number) is required' });

  const merchant = await prisma.cardPointeMerchant.findUnique({ where: { orgId } });
  if (!merchant) return res.status(400).json({ success: false, error: 'Configure CardPointe merchant credentials first' });

  const terminal = await prisma.paymentTerminal.create({
    data: {
      orgId,
      storeId: storeId || req.body.storeId,
      merchantId: merchant.id,
      hsn, name, ipAddress,
      port:      port || 6443,
      model:     model || null,
      stationId: stationId || null,
    },
  });
  return res.json({ success: true, data: terminal });
};

export const updateTerminal = async (req, res) => {
  const orgId = getOrgId(req);
  const { id } = req.params;
  const { name, hsn, ipAddress, port, model, stationId, status } = req.body;

  const terminal = await prisma.paymentTerminal.findFirst({ where: { id, orgId } });
  if (!terminal) return res.status(404).json({ success: false, error: 'Terminal not found' });

  const updated = await prisma.paymentTerminal.update({
    where: { id },
    data: {
      ...(name      != null ? { name }      : {}),
      ...(hsn       != null ? { hsn }       : {}),
      ...(ipAddress != null ? { ipAddress } : {}),
      ...(port      != null ? { port }      : {}),
      ...(model     != null ? { model }     : {}),
      ...(stationId !== undefined ? { stationId: stationId || null } : {}),
      ...(status    != null ? { status }    : {}),
    },
  });
  return res.json({ success: true, data: updated });
};

export const deleteTerminal = async (req, res) => {
  const orgId = getOrgId(req);
  const { id } = req.params;

  const terminal = await prisma.paymentTerminal.findFirst({ where: { id, orgId } });
  if (!terminal) return res.status(404).json({ success: false, error: 'Terminal not found' });

  await prisma.paymentTerminal.delete({ where: { id } });
  return res.json({ success: true });
};

export const pingTerminal = async (req, res) => {
  const orgId = getOrgId(req);
  const { id } = req.params;

  const terminal = await prisma.paymentTerminal.findFirst({ where: { id, orgId } });
  if (!terminal) return res.status(404).json({ success: false, error: 'Terminal not found' });

  const merchant = await getMerchantConfig(orgId);
  if (!merchant) return res.status(400).json({ success: false, error: 'Merchant credentials not configured' });

  const result = await terminalPing(merchant, terminal.hsn);

  // Update status + ping metrics
  await prisma.paymentTerminal.update({
    where: { id },
    data: {
      status:     result.connected ? 'active' : 'inactive',
      lastSeenAt: result.connected ? new Date() : terminal.lastSeenAt,
      lastPingMs: result.latencyMs,
    },
  }).catch(() => {});

  return res.json({ success: true, ...result });
};

// ═════════════════════════════════════════════════════════════════════════════
// PAYMENT SETTINGS (per store)
// GET /payment/settings/:storeId
// PUT /payment/settings/:storeId
// ═════════════════════════════════════════════════════════════════════════════
export const getPaymentSettings = async (req, res) => {
  const orgId   = getOrgId(req);
  const storeId = req.params.storeId;

  let settings = await prisma.paymentSettings.findUnique({ where: { storeId } });

  // Return defaults if not yet configured
  if (!settings) {
    return res.json({
      success: true,
      data: {
        storeId,
        signatureThreshold: 25.00,
        tipEnabled:         false,
        tipPresets:         [15, 18, 20, 25],
        surchargeEnabled:   false,
        surchargePercent:   null,
        acceptCreditCards:  true,
        acceptDebitCards:   true,
        acceptAmex:         true,
        acceptContactless:  true,
      },
    });
  }

  return res.json({ success: true, data: settings });
};

export const savePaymentSettings = async (req, res) => {
  const orgId   = getOrgId(req);
  const storeId = req.params.storeId;
  const {
    signatureThreshold,
    tipEnabled, tipPresets,
    surchargeEnabled, surchargePercent,
    acceptCreditCards, acceptDebitCards, acceptAmex, acceptContactless,
  } = req.body;

  const data = {
    orgId,
    ...(signatureThreshold != null ? { signatureThreshold: Number(signatureThreshold) } : {}),
    ...(tipEnabled         != null ? { tipEnabled }         : {}),
    ...(tipPresets         != null ? { tipPresets }         : {}),
    ...(surchargeEnabled   != null ? { surchargeEnabled }   : {}),
    ...(surchargePercent   != null ? { surchargePercent: Number(surchargePercent) } : {}),
    ...(acceptCreditCards  != null ? { acceptCreditCards }  : {}),
    ...(acceptDebitCards   != null ? { acceptDebitCards }   : {}),
    ...(acceptAmex         != null ? { acceptAmex }         : {}),
    ...(acceptContactless  != null ? { acceptContactless }  : {}),
  };

  const settings = await prisma.paymentSettings.upsert({
    where:  { storeId },
    create: { storeId, ...data },
    update: data,
  });

  return res.json({ success: true, data: settings });
};

// ═════════════════════════════════════════════════════════════════════════════
// PAYMENT TRANSACTIONS LIST  (manager / portal view)
// GET /payment/transactions
// ═════════════════════════════════════════════════════════════════════════════
export const listPaymentTransactions = async (req, res) => {
  const orgId   = getOrgId(req);
  const storeId = getStore(req) || req.query.storeId;
  const { page = 1, limit = 50, type, status, dateFrom, dateTo } = req.query;

  const where = {
    orgId,
    ...(storeId ? { storeId } : {}),
    ...(type    ? { type }    : {}),
    ...(status  ? { status }  : {}),
    ...(dateFrom || dateTo ? {
      createdAt: {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo   ? { lte: new Date(dateTo)   } : {}),
      },
    } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.paymentTransaction.count({ where }),
    prisma.paymentTransaction.findMany({
      where,
      orderBy:  { createdAt: 'desc' },
      skip:     (Number(page) - 1) * Number(limit),
      take:     Number(limit),
      select: {
        id: true, orgId: true, storeId: true,
        retref: true, authCode: true, respCode: true, respText: true,
        lastFour: true, acctType: true, entryMode: true,
        amount: true, capturedAmount: true,
        type: true, status: true,
        signatureCaptured: true,
        invoiceNumber: true,
        posTransactionId: true,
        originalRetref: true,
        createdAt: true, updatedAt: true,
        // Never expose token or full card data
      },
    }),
  ]);

  return res.json({
    success: true,
    data: rows,
    meta: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// LINK PAYMENT TRANSACTION TO POS TRANSACTION
// PATCH /payment/cp/link
// Body: { paymentTransactionId, posTransactionId }
// Called by TenderModal after the POS transaction is saved.
// ═════════════════════════════════════════════════════════════════════════════
export const linkPaymentTx = async (req, res) => {
  const orgId = getOrgId(req);
  const { paymentTransactionId, posTransactionId } = req.body;

  if (!paymentTransactionId || !posTransactionId) {
    return res.status(400).json({ success: false, error: 'Both IDs required' });
  }

  await prisma.paymentTransaction.updateMany({
    where: { id: paymentTransactionId, orgId },
    data:  { posTransactionId },
  });

  return res.json({ success: true });
};

// ═════════════════════════════════════════════════════════════════════════════
// ECOMMERCE ONLINE CHARGE  (service-to-service, called from ecom-backend)
// POST /payment/ecom/charge
//
// Body: { token, amount, expiry, storeId, orderRef?, cvv? }
// Returns: { approved, retref, authCode, lastFour, acctType, respcode, resptext }
//
// Auth: x-internal-key header must match INTERNAL_API_KEY env var.
// ═════════════════════════════════════════════════════════════════════════════
export const ecomCharge = async (req, res) => {
  // ── Internal API key guard ─────────────────────────────────────────────────
  const internalKey = process.env.INTERNAL_API_KEY;
  if (internalKey && req.headers['x-internal-key'] !== internalKey) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { token, amount, expiry, storeId, orderRef, cvv } = req.body;
  if (!token || !amount || !storeId) {
    return res.status(400).json({ success: false, error: 'token, amount, and storeId are required' });
  }

  // Look up org from storeId
  let orgId;
  try {
    const store = await prisma.store.findFirst({ where: { id: storeId }, select: { orgId: true } });
    if (!store) return res.status(404).json({ success: false, error: 'Store not found' });
    orgId = store.orgId;
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }

  const merchant = await getMerchantConfig(orgId);
  if (!merchant) {
    return res.status(400).json({ success: false, error: 'CardPointe merchant credentials not configured for this store' });
  }

  try {
    const { gatewayAuth } = await import('../services/cardPointeService.js');
    const result = await gatewayAuth(merchant, {
      account:     token,
      amount:      fmtAmount(amount),
      expiry:      expiry  || undefined,
      cvv2:        cvv     || undefined,
      orderid:     orderRef || undefined,
      capture:     'Y',
      ecomind:     'E',   // E = ecommerce / internet transaction
    });

    const approved = result?.respcode === '000' || result?.respcode === '00' || result?.respstat === 'A';

    // Record the transaction
    await prisma.paymentTransaction.create({
      data: {
        orgId,
        storeId,
        merchantId:    merchant.id,
        amount:        Number(amount),
        type:          'sale',
        status:        approved ? 'approved' : 'declined',
        retref:        result?.retref  || undefined,
        authCode:      result?.authcode || undefined,
        respCode:      result?.respcode,
        respText:      result?.resptext || undefined,
        token:         token,
        lastFour:      result?.account ? String(result.account).slice(-4) : undefined,
        acctType:      result?.accttype || undefined,
        invoiceNumber: orderRef || undefined,
        entryMode:     'ECOM',
      },
    }).catch(() => {});

    if (!approved) {
      return res.status(402).json({
        success:  false,
        approved: false,
        respcode: result?.respcode,
        resptext: result?.resptext || 'Declined',
      });
    }

    return res.json({
      success:  true,
      approved: true,
      retref:   result?.retref,
      authCode: result?.authcode,
      lastFour: result?.account ? String(result.account).slice(-4) : null,
      acctType: result?.accttype || null,
      respcode: result?.respcode,
      resptext: result?.resptext,
    });

  } catch (err) {
    const apiError = err.response?.data?.errorMessage || err.response?.data?.error || err.message;
    return res.status(500).json({ success: false, error: apiError });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// HARDWARE CONFIG (unchanged — for receipt printer / cash drawer / scale config)
// ═════════════════════════════════════════════════════════════════════════════
export const saveHardwareConfig = async (req, res) => {
  try {
    const storeId = getStore(req);
    const { stationId, hardwareConfig } = req.body;
    if (!stationId || !hardwareConfig) {
      return res.status(400).json({ success: false, error: 'stationId and hardwareConfig required' });
    }
    const station = await prisma.station.updateMany({
      where: { id: stationId, storeId },
      data:  { hardwareConfig },
    });
    res.json({ success: true, data: station });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getHardwareConfig = async (req, res) => {
  try {
    const storeId   = getStore(req);
    const stationId = req.params.stationId || req.query.stationId;
    const station   = await prisma.station.findFirst({
      where: { id: stationId, storeId },
      include: { paymentTerminal: true },
    });
    if (!station) return res.status(404).json({ success: false, error: 'Station not found' });

    const hw = station.hardwareConfig
      ? (typeof station.hardwareConfig === 'string' ? JSON.parse(station.hardwareConfig) : station.hardwareConfig)
      : null;

    res.json({
      success: true,
      data: hw,
      paymentTerminal: station.paymentTerminal
        ? { id: station.paymentTerminal.id, hsn: station.paymentTerminal.hsn, status: station.paymentTerminal.status }
        : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// LEGACY PAX POSLINK (kept for stations not yet migrated to CardPointe)
// ═════════════════════════════════════════════════════════════════════════════

const toCents = (amount) => Math.round(Number(amount) * 100).toString().padStart(12, '0');
const buildPOSLINK = (params) =>
  Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const parsePAXResponse = (raw) => {
  if (!raw) return { status: 'Error', message: 'No response from terminal' };
  const parts = String(raw).split('|');
  return {
    status:     parts[0] || 'Error',
    resultCode: parts[1] || '',
    message:    parts[2] || '',
    authCode:   parts[3] || '',
    refNum:     parts[4] || '',
    cardType:   parts[5] || '',
    lastFour:   parts[6] || '',
    entryMode:  parts[7] || '',
    hostCode:   parts[8] || '',
  };
};

const getPAXUrl = async (stationId, storeId) => {
  const station = await prisma.station.findFirst({ where: { id: stationId, storeId } });
  if (!station?.hardwareConfig) return null;
  const hw  = typeof station.hardwareConfig === 'string' ? JSON.parse(station.hardwareConfig) : station.hardwareConfig;
  const pax = hw?.paxTerminal;
  if (!pax?.enabled || !pax?.ip) return null;
  return `http://${pax.ip}:${pax.port || 10009}`;
};

export const paxSale = async (req, res) => {
  try {
    const { amount, invoiceNumber, stationId, edcType = '02' } = req.body;
    const storeId = getStore(req);
    if (!amount || !stationId) return res.status(400).json({ success: false, error: 'amount and stationId required' });
    const paxUrl = await getPAXUrl(stationId, storeId);
    if (!paxUrl) return res.status(400).json({ success: false, error: 'PAX terminal not configured for this station' });
    const qs = buildPOSLINK({ EDCType: edcType, TransType: '01', Amount: toCents(amount), InvoiceNumber: invoiceNumber || Date.now().toString(), ECRRefNum: stationId, Timeout: '90' });
    const response = await axios.post(`${paxUrl}/api/pos`, qs, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 120000 });
    const parsed   = parsePAXResponse(response.data);
    const approved = parsed.resultCode === '000000' || parsed.status === 'OK';
    res.json({ success: approved, approved, data: parsed });
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') return res.status(503).json({ success: false, error: 'Cannot reach PAX terminal.' });
    res.status(500).json({ success: false, error: err.message });
  }
};

export const paxVoid = async (req, res) => {
  try {
    const { origRefNum, invoiceNumber, stationId } = req.body;
    const storeId = getStore(req);
    const paxUrl  = await getPAXUrl(stationId, storeId);
    if (!paxUrl) return res.status(400).json({ success: false, error: 'PAX terminal not configured' });
    const qs = buildPOSLINK({ EDCType: '01', TransType: '04', OrigRefNum: origRefNum || '', InvoiceNumber: invoiceNumber || '', ECRRefNum: stationId, Timeout: '60' });
    const response = await axios.post(`${paxUrl}/api/pos`, qs, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 90000 });
    const parsed = parsePAXResponse(response.data);
    res.json({ success: parsed.resultCode === '000000', data: parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const paxRefund = async (req, res) => {
  try {
    const { amount, invoiceNumber, stationId } = req.body;
    const storeId = getStore(req);
    const paxUrl  = await getPAXUrl(stationId, storeId);
    if (!paxUrl) return res.status(400).json({ success: false, error: 'PAX terminal not configured' });
    const qs = buildPOSLINK({ EDCType: '01', TransType: '02', Amount: toCents(amount), InvoiceNumber: invoiceNumber || '', ECRRefNum: stationId, Timeout: '90' });
    const response = await axios.post(`${paxUrl}/api/pos`, qs, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 120000 });
    const parsed = parsePAXResponse(response.data);
    res.json({ success: parsed.resultCode === '000000', data: parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const paxTest = async (req, res) => {
  try {
    const { ip, port = 10009 } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: 'IP required' });
    const qs = buildPOSLINK({ EDCType: '01', TransType: '00', Timeout: '10' });
    const response = await axios.post(`http://${ip}:${port}/api/pos`, qs, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
    res.json({ success: true, message: 'PAX terminal reachable', raw: response.data });
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
      return res.json({ success: false, error: `Cannot reach PAX at ${req.body.ip}:${req.body.port || 10009}.` });
    }
    res.json({ success: false, error: err.message });
  }
};
