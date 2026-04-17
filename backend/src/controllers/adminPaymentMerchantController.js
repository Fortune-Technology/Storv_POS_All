/**
 * adminPaymentMerchantController.js
 *
 * Superadmin-only CRUD for Dejavoo / iPOSpays payment merchant credentials.
 * One PaymentMerchant per store. Credentials encrypted at rest via cryptoVault.
 *
 * All responses mask secret fields — plaintext credentials never leave the backend.
 *
 * Routes (mounted at /api/admin/payment-merchants, superadmin required):
 *   GET    /                  — list all merchants (with optional org/store filter)
 *   GET    /:id               — get single merchant (secrets masked)
 *   POST   /                  — create (per-store, enforced unique)
 *   PUT    /:id               — update (empty secret fields = unchanged)
 *   DELETE /:id               — delete
 *   POST   /:id/test          — credential presence + terminal connectivity check
 */

import prisma from '../config/postgres.js';
import { encrypt, decrypt, mask } from '../utils/cryptoVault.js';
import { loadMerchant, checkTerminalStatus } from '../services/paymentProviderFactory.js';
import { buildChangeDiff, logMerchantAudit } from '../services/paymentMerchantAudit.js';

// Fields that hold encrypted secrets. Stripped from list/get responses.
const SECRET_FIELDS = ['spinAuthKey', 'hppAuthKey', 'transactApiKey'];

/** Replace encrypted secret fields with `{fieldSet, fieldPreview}` markers. */
function sanitize(merchant) {
  if (!merchant) return null;
  const out = { ...merchant };
  for (const f of SECRET_FIELDS) {
    if (out[f]) {
      out[`${f}Preview`] = mask(decrypt(out[f]));
      out[`${f}Set`] = true;
    } else {
      out[`${f}Preview`] = '';
      out[`${f}Set`] = false;
    }
    delete out[f];
  }
  return out;
}

/**
 * Build Prisma write data from request body.
 * Secret behavior:
 *   undefined or '' → leave unchanged (don't include in update)
 *   explicit null   → clear the field
 *   non-empty value → encrypt and store
 */
function buildWriteData(body) {
  const data = {};
  const passthrough = [
    'orgId', 'storeId', 'provider', 'environment',
    'spinTpn', 'spinBaseUrl',
    'hppMerchantId', 'hppBaseUrl',
    'transactBaseUrl',
    'ebtEnabled', 'debitEnabled', 'tokenizeEnabled',
    'status', 'notes',
  ];
  for (const f of passthrough) {
    if (body[f] !== undefined) data[f] = body[f];
  }
  for (const f of SECRET_FIELDS) {
    const val = body[f];
    if (val === null) data[f] = null;
    else if (val !== undefined && val !== '') data[f] = encrypt(String(val));
  }
  return data;
}

// ── GET /api/admin/payment-merchants ────────────────────────────────────────
export const listPaymentMerchants = async (req, res) => {
  try {
    const { orgId, storeId, provider } = req.query;
    const where = {};
    if (orgId)    where.orgId    = orgId;
    if (storeId)  where.storeId  = storeId;
    if (provider) where.provider = provider;

    const rows = await prisma.paymentMerchant.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });

    // Join store + org names for UI display
    const storeIds = [...new Set(rows.map(r => r.storeId))];
    const orgIds   = [...new Set(rows.map(r => r.orgId))];
    const [stores, orgs] = await Promise.all([
      prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } }),
      prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }),
    ]);
    const storeMap = Object.fromEntries(stores.map(s => [s.id, s]));
    const orgMap   = Object.fromEntries(orgs.map(o => [o.id, o]));

    const merchants = rows.map(r => ({
      ...sanitize(r),
      storeName: storeMap[r.storeId]?.name || null,
      orgName:   orgMap[r.orgId]?.name     || null,
    }));

    res.json({ success: true, merchants });
  } catch (err) {
    console.error('[listPaymentMerchants]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── GET /api/admin/payment-merchants/:id ────────────────────────────────────
export const getPaymentMerchant = async (req, res) => {
  try {
    const merchant = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!merchant) return res.status(404).json({ success: false, error: 'Merchant not found' });
    res.json({ success: true, merchant: sanitize(merchant) });
  } catch (err) {
    console.error('[getPaymentMerchant]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── POST /api/admin/payment-merchants ───────────────────────────────────────
export const createPaymentMerchant = async (req, res) => {
  try {
    const { orgId, storeId } = req.body;
    if (!orgId || !storeId) {
      return res.status(400).json({ success: false, error: 'orgId and storeId are required' });
    }

    const store = await prisma.store.findFirst({ where: { id: storeId, orgId } });
    if (!store) return res.status(400).json({ success: false, error: 'Store not found for this organization' });

    const existing = await prisma.paymentMerchant.findUnique({ where: { storeId } });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'This store already has a payment merchant configured — edit the existing one.',
      });
    }

    const data = buildWriteData(req.body);
    data.orgId = orgId;
    data.storeId = storeId;
    data.updatedById = req.user?.id || null;
    // ── Activation workflow: new merchants start as "pending" until tested ──
    // Explicit caller-supplied status can only be 'pending' or 'disabled' on create.
    if (!data.status || data.status === 'active') data.status = 'pending';

    const merchant = await prisma.paymentMerchant.create({ data });

    // Audit (non-blocking)
    logMerchantAudit({
      merchantId: merchant.id,
      action:     'created',
      user:       req.user,
      note:       `New merchant for store ${store.name || storeId}`,
      changes: {
        provider:    merchant.provider,
        environment: merchant.environment,
        status:      merchant.status,
        spinTpn:     merchant.spinTpn ? { set: true } : { set: false },
        spinAuthKey: merchant.spinAuthKey ? { set: true } : { set: false },
      },
    });

    res.status(201).json({ success: true, merchant: sanitize(merchant) });
  } catch (err) {
    console.error('[createPaymentMerchant]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── PUT /api/admin/payment-merchants/:id ────────────────────────────────────
export const updatePaymentMerchant = async (req, res) => {
  try {
    const existing = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Merchant not found' });

    const data = buildWriteData(req.body);
    data.updatedById = req.user?.id || null;

    // ── Activation workflow: changing sensitive fields drops status back to pending ──
    // The merchant must be re-tested before processing again.
    const sensitiveChanged =
      (data.spinTpn !== undefined && data.spinTpn !== existing.spinTpn) ||
      (data.spinAuthKey !== undefined) ||
      (data.environment !== undefined && data.environment !== existing.environment) ||
      (data.spinBaseUrl !== undefined && data.spinBaseUrl !== existing.spinBaseUrl);

    if (sensitiveChanged && existing.status === 'active') {
      data.status = 'pending';
      data.lastTestedAt = null;
      data.lastTestResult = 'Credentials changed — must be re-tested before processing';
    }

    const merchant = await prisma.paymentMerchant.update({
      where: { id: req.params.id },
      data,
    });

    // Audit (non-blocking) — safe diff only, no plaintext secrets
    const diff = buildChangeDiff(existing, { ...existing, ...data });
    if (diff) {
      logMerchantAudit({
        merchantId: merchant.id,
        action:     sensitiveChanged && data.status === 'pending' ? 'updated-deactivated' : 'updated',
        user:       req.user,
        changes:    diff,
        note:       sensitiveChanged ? 'Sensitive credentials changed — status reset to pending' : null,
      });
    }

    res.json({ success: true, merchant: sanitize(merchant) });
  } catch (err) {
    console.error('[updatePaymentMerchant]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── DELETE /api/admin/payment-merchants/:id ─────────────────────────────────
export const deletePaymentMerchant = async (req, res) => {
  try {
    const existing = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Merchant not found' });

    // Audit BEFORE delete (so FK cascade deletes audit too, but we log the deletion)
    logMerchantAudit({
      merchantId: existing.id,
      action:     'deleted',
      user:       req.user,
      note:       `Merchant removed for store ${existing.storeId}`,
    });

    await prisma.paymentMerchant.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('[deletePaymentMerchant]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── POST /api/admin/payment-merchants/:id/activate ──────────────────────────
// Explicit activation (after test passes, superadmin clicks Activate).
// Moves status pending → active.
export const activatePaymentMerchant = async (req, res) => {
  try {
    const existing = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Merchant not found' });

    // Safety: require a successful test within the last 24 hours before allowing activation.
    // This prevents "create and activate immediately without testing" mistakes.
    const tested = existing.lastTestedAt && existing.lastTestResult === 'ok';
    const recentTest = tested && (Date.now() - new Date(existing.lastTestedAt).getTime()) < 24 * 60 * 60 * 1000;
    if (!recentTest) {
      return res.status(400).json({
        success: false,
        error: 'Run a successful Test within the last 24 hours before activating this merchant.',
      });
    }

    const merchant = await prisma.paymentMerchant.update({
      where: { id: req.params.id },
      data: { status: 'active', updatedById: req.user?.id || null },
    });

    logMerchantAudit({
      merchantId: merchant.id,
      action:     'activated',
      user:       req.user,
      note:       'Merchant activated for live processing',
    });

    res.json({ success: true, merchant: sanitize(merchant) });
  } catch (err) {
    console.error('[activatePaymentMerchant]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── POST /api/admin/payment-merchants/:id/disable ───────────────────────────
// Emergency kill-switch. Moves status → disabled. Processing stops immediately.
export const disablePaymentMerchant = async (req, res) => {
  try {
    const existing = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Merchant not found' });

    const merchant = await prisma.paymentMerchant.update({
      where: { id: req.params.id },
      data: { status: 'disabled', updatedById: req.user?.id || null },
    });

    logMerchantAudit({
      merchantId: merchant.id,
      action:     'disabled',
      user:       req.user,
      note:       req.body?.reason || 'Merchant disabled by admin',
    });

    res.json({ success: true, merchant: sanitize(merchant) });
  } catch (err) {
    console.error('[disablePaymentMerchant]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── GET /api/admin/payment-merchants/:id/audit ──────────────────────────────
// Returns the full change history for a merchant.
export const getPaymentMerchantAudit = async (req, res) => {
  try {
    const merchantId = req.params.id;
    const entries = await prisma.paymentMerchantAudit.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, entries });
  } catch (err) {
    console.error('[getPaymentMerchantAudit]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── POST /api/admin/payment-merchants/:id/test ──────────────────────────────
// Verifies required credentials are present, then pings the Dejavoo terminal.
// Updates lastTestedAt + lastTestResult on the merchant record.
export const testPaymentMerchant = async (req, res) => {
  try {
    const merchant = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!merchant) return res.status(404).json({ success: false, error: 'Merchant not found' });

    // Step 1: credential presence check
    const missing = [];
    if (merchant.provider === 'dejavoo') {
      if (!merchant.spinTpn)     missing.push('spinTpn');
      if (!merchant.spinAuthKey) missing.push('spinAuthKey');
    }

    if (missing.length) {
      const result = `Missing required credentials: ${missing.join(', ')}`;
      const updated = await prisma.paymentMerchant.update({
        where: { id: merchant.id },
        data: { lastTestedAt: new Date(), lastTestResult: result },
      });
      logMerchantAudit({
        merchantId: merchant.id,
        action:     'tested',
        user:       req.user,
        note:       `Test failed — ${result}`,
      });
      return res.json({ success: false, result, merchant: sanitize(updated) });
    }

    // Step 2: live terminal ping
    let liveResult = 'ok';
    let connected = false;
    try {
      // checkTerminalStatus requires an 'active' merchant; bypass the gate during admin testing
      // by loading directly and calling the provider.
      const decrypted = {
        ...merchant,
        spinAuthKey: merchant.spinAuthKey ? decrypt(merchant.spinAuthKey) : null,
      };
      const status = await checkTerminalStatus(decrypted);
      connected = status.connected;
      liveResult = status.connected ? 'ok' : (status.message || 'Terminal not reachable');
    } catch (err) {
      liveResult = err.message || 'Terminal test failed';
    }

    const updated = await prisma.paymentMerchant.update({
      where: { id: merchant.id },
      data: { lastTestedAt: new Date(), lastTestResult: liveResult },
    });

    logMerchantAudit({
      merchantId: merchant.id,
      action:     'tested',
      user:       req.user,
      note:       connected ? 'Terminal test passed' : `Test failed — ${liveResult}`,
    });

    res.json({ success: connected, result: liveResult, merchant: sanitize(updated) });
  } catch (err) {
    console.error('[testPaymentMerchant]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
