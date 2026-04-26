/**
 * adminPaymentMerchantController.ts
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

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { encrypt, decrypt, mask } from '../utils/cryptoVault.js';
import { checkTerminalStatus, type DecryptedPaymentMerchant } from '../services/paymentProviderFactory.js';
import { buildChangeDiff, logMerchantAudit } from '../services/paymentMerchantAudit.js';

// Fields that hold encrypted secrets.
const SECRET_FIELDS = ['spinAuthKey', 'hppAuthKey', 'hppWebhookSecret', 'transactApiKey'];

// Subset of SECRET_FIELDS that admin can set/update via the create-edit modal.
const USER_WRITABLE_SECRETS = new Set(['spinAuthKey', 'hppAuthKey', 'transactApiKey']);

/** Replace encrypted secret fields with `{fieldSet, fieldPreview}` markers. */
function sanitize(merchant: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!merchant) return null;
  const out: Record<string, unknown> = { ...merchant };
  for (const f of SECRET_FIELDS) {
    if (out[f]) {
      out[`${f}Preview`] = mask(decrypt(String(out[f])));
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
 */
function buildWriteData(body: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const passthrough = [
    'orgId', 'storeId', 'provider', 'environment',
    'spinTpn', 'spinBaseUrl',
    'hppMerchantId', 'hppBaseUrl', 'hppEnabled',
    'transactBaseUrl',
    'ebtEnabled', 'debitEnabled', 'tokenizeEnabled',
    'status', 'notes',
  ];
  for (const f of passthrough) {
    if (body[f] !== undefined) data[f] = body[f];
  }
  // Only encrypt + write the secrets that are user-settable via the modal.
  for (const f of SECRET_FIELDS) {
    if (!USER_WRITABLE_SECRETS.has(f)) continue;
    const val = body[f];
    if (val === null) data[f] = null;
    else if (val !== undefined && val !== '') data[f] = encrypt(String(val));
  }
  return data;
}

// ── GET /api/admin/payment-merchants ────────────────────────────────────────
export const listPaymentMerchants = async (req: Request, res: Response): Promise<void> => {
  try {
    const { orgId, storeId, provider } = req.query as { orgId?: string; storeId?: string; provider?: string };
    const where: Prisma.PaymentMerchantWhereInput = {};
    if (orgId)    where.orgId    = orgId;
    if (storeId)  where.storeId  = storeId;
    if (provider) where.provider = provider;

    const rows = await prisma.paymentMerchant.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });

    type MerchantRow = (typeof rows)[number];
    // Join store + org names for UI display
    const storeIds = Array.from(new Set(rows.map((r: MerchantRow) => r.storeId)));
    const orgIds   = Array.from(new Set(rows.map((r: MerchantRow) => r.orgId)));
    const [stores, orgs] = await Promise.all([
      prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } }),
      prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }),
    ]);
    const storeMap: Record<string, { id: string; name: string }> = Object.fromEntries(
      stores.map((s: { id: string; name: string }) => [s.id, s]),
    );
    const orgMap: Record<string, { id: string; name: string }> = Object.fromEntries(
      orgs.map((o: { id: string; name: string }) => [o.id, o]),
    );

    const merchants = rows.map((r: MerchantRow) => ({
      ...sanitize(r as unknown as Record<string, unknown>),
      storeName: storeMap[r.storeId]?.name || null,
      orgName:   orgMap[r.orgId]?.name     || null,
    }));

    res.json({ success: true, merchants });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[listPaymentMerchants]', err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── GET /api/admin/payment-merchants/:id ────────────────────────────────────
export const getPaymentMerchant = async (req: Request, res: Response): Promise<void> => {
  try {
    const merchant = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!merchant) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }
    res.json({ success: true, merchant: sanitize(merchant as unknown as Record<string, unknown>) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[getPaymentMerchant]', err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── POST /api/admin/payment-merchants ───────────────────────────────────────
export const createPaymentMerchant = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const orgId = body.orgId as string | undefined;
    const storeId = body.storeId as string | undefined;
    if (!orgId || !storeId) {
      res.status(400).json({ success: false, error: 'orgId and storeId are required' });
      return;
    }

    const store = await prisma.store.findFirst({ where: { id: storeId, orgId } });
    if (!store) { res.status(400).json({ success: false, error: 'Store not found for this organization' }); return; }

    const existing = await prisma.paymentMerchant.findUnique({ where: { storeId } });
    if (existing) {
      res.status(409).json({
        success: false,
        error: 'This store already has a payment merchant configured — edit the existing one.',
      });
      return;
    }

    const data = buildWriteData(body);
    data.orgId = orgId;
    data.storeId = storeId;
    data.updatedById = req.user?.id || null;
    // ── Activation workflow: new merchants start as "pending" until tested ──
    if (!data.status || data.status === 'active') data.status = 'pending';

    const merchant = await prisma.paymentMerchant.create({ data: data as Prisma.PaymentMerchantUncheckedCreateInput });

    // Audit (non-blocking)
    logMerchantAudit({
      merchantId: merchant.id,
      action:     'created',
      user:       req.user,
      note:       `New merchant for store ${store.name || storeId}`,
      changes: {
        provider:    { from: null, to: merchant.provider },
        environment: { from: null, to: merchant.environment },
        status:      { from: null, to: merchant.status },
        spinTpn:     { changed: true, wasSet: false, isSet: !!merchant.spinTpn },
        spinAuthKey: { changed: true, wasSet: false, isSet: !!merchant.spinAuthKey },
      },
    });

    res.status(201).json({ success: true, merchant: sanitize(merchant as unknown as Record<string, unknown>) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[createPaymentMerchant]', err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── PUT /api/admin/payment-merchants/:id ────────────────────────────────────
export const updatePaymentMerchant = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }

    const data = buildWriteData(req.body as Record<string, unknown>);
    data.updatedById = req.user?.id || null;

    // ── Activation workflow: changing sensitive fields drops status back to pending ──
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
      data: data as Prisma.PaymentMerchantUncheckedUpdateInput,
    });

    // Audit (non-blocking) — safe diff only, no plaintext secrets
    const diff = buildChangeDiff(
      existing as unknown as Record<string, unknown>,
      { ...(existing as unknown as Record<string, unknown>), ...data },
    );
    if (diff) {
      logMerchantAudit({
        merchantId: merchant.id,
        action:     sensitiveChanged && data.status === 'pending' ? 'updated-deactivated' : 'updated',
        user:       req.user,
        changes:    diff,
        note:       sensitiveChanged ? 'Sensitive credentials changed — status reset to pending' : null,
      });
    }

    res.json({ success: true, merchant: sanitize(merchant as unknown as Record<string, unknown>) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[updatePaymentMerchant]', err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── DELETE /api/admin/payment-merchants/:id ─────────────────────────────────
export const deletePaymentMerchant = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }

    // Audit BEFORE delete
    logMerchantAudit({
      merchantId: existing.id,
      action:     'deleted',
      user:       req.user,
      note:       `Merchant removed for store ${existing.storeId}`,
    });

    await prisma.paymentMerchant.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[deletePaymentMerchant]', err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── POST /api/admin/payment-merchants/:id/activate ──────────────────────────
export const activatePaymentMerchant = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }

    // Safety: require a successful test within the last 24 hours before allowing activation.
    const tested = existing.lastTestedAt && existing.lastTestResult === 'ok';
    const recentTest = tested && (Date.now() - new Date(existing.lastTestedAt as Date).getTime()) < 24 * 60 * 60 * 1000;
    if (!recentTest) {
      res.status(400).json({
        success: false,
        error: 'Run a successful Test within the last 24 hours before activating this merchant.',
      });
      return;
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

    res.json({ success: true, merchant: sanitize(merchant as unknown as Record<string, unknown>) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[activatePaymentMerchant]', err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── POST /api/admin/payment-merchants/:id/disable ───────────────────────────
export const disablePaymentMerchant = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }

    const merchant = await prisma.paymentMerchant.update({
      where: { id: req.params.id },
      data: { status: 'disabled', updatedById: req.user?.id || null },
    });

    logMerchantAudit({
      merchantId: merchant.id,
      action:     'disabled',
      user:       req.user,
      note:       (req.body as { reason?: string })?.reason || 'Merchant disabled by admin',
    });

    res.json({ success: true, merchant: sanitize(merchant as unknown as Record<string, unknown>) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[disablePaymentMerchant]', err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── GET /api/admin/payment-merchants/:id/audit ──────────────────────────────
export const getPaymentMerchantAudit = async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantId = req.params.id;
    const entries = await prisma.paymentMerchantAudit.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, entries });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[getPaymentMerchantAudit]', err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── POST /api/admin/payment-merchants/:id/test ──────────────────────────────
export const testPaymentMerchant = async (req: Request, res: Response): Promise<void> => {
  try {
    const merchant = await prisma.paymentMerchant.findUnique({ where: { id: req.params.id } });
    if (!merchant) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }

    // Step 1: credential presence check
    const missing: string[] = [];
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
      res.json({ success: false, result, merchant: sanitize(updated as unknown as Record<string, unknown>) });
      return;
    }

    // Step 2: live terminal ping
    let liveResult = 'ok';
    let connected = false;
    try {
      const decrypted = {
        ...merchant,
        spinAuthKey: merchant.spinAuthKey ? decrypt(merchant.spinAuthKey) : null,
      } as unknown as DecryptedPaymentMerchant;
      const status = await checkTerminalStatus(decrypted) as { connected?: boolean; message?: string };
      connected = !!status.connected;
      liveResult = status.connected ? 'ok' : (status.message || 'Terminal not reachable');
    } catch (err) {
      liveResult = err instanceof Error ? err.message : 'Terminal test failed';
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

    res.json({ success: connected, result: liveResult, merchant: sanitize(updated as unknown as Record<string, unknown>) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[testPaymentMerchant]', err);
    res.status(500).json({ success: false, error: message });
  }
};
