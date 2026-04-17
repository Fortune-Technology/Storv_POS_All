/**
 * adminPaymentTerminalController.js
 *
 * Superadmin CRUD for physical PaymentTerminal devices.
 * A store may have multiple P17/Z8/Z11 terminals — one per station/register.
 * Each terminal is bound to its parent PaymentMerchant and optionally overrides
 * the merchant's default TPN (when the processor assigns per-lane TPNs).
 *
 * Routes (mounted at /api/admin/payment-terminals, superadmin required):
 *   GET    /                   — list terminals (optional storeId / merchantId filter)
 *   POST   /                   — create terminal (assigns to station)
 *   PUT    /:id                — update
 *   DELETE /:id                — delete
 *   POST   /:id/ping           — live connectivity check
 */

import prisma from '../config/postgres.js';
import { loadMerchant, checkTerminalStatus } from '../services/paymentProviderFactory.js';
import { decrypt } from '../utils/cryptoVault.js';

// ── GET /api/admin/payment-terminals ────────────────────────────────────────
export const listTerminals = async (req, res) => {
  try {
    const { storeId, merchantId, orgId } = req.query;
    const where = {};
    if (orgId)      where.orgId      = orgId;
    if (storeId)    where.storeId    = storeId;
    if (merchantId) where.merchantId = merchantId;

    const terminals = await prisma.paymentTerminal.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }],
      include: {
        merchant: { select: { id: true, storeId: true, provider: true, environment: true, spinTpn: true, status: true } },
      },
    });

    // Join station name for UI display
    const stationIds = [...new Set(terminals.map(t => t.stationId).filter(Boolean))];
    const stations = stationIds.length
      ? await prisma.station.findMany({ where: { id: { in: stationIds } }, select: { id: true, name: true } })
      : [];
    const stationMap = Object.fromEntries(stations.map(s => [s.id, s.name]));

    const data = terminals.map(t => ({
      ...t,
      stationName:  t.stationId ? stationMap[t.stationId] : null,
      effectiveTpn: t.overrideTpn || t.merchant?.spinTpn || null,
    }));

    res.json({ success: true, terminals: data });
  } catch (err) {
    console.error('[listTerminals]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── POST /api/admin/payment-terminals ───────────────────────────────────────
export const createTerminal = async (req, res) => {
  try {
    const { merchantId, stationId, nickname, deviceSerialNumber, deviceModel, overrideTpn, notes } = req.body;
    if (!merchantId) return res.status(400).json({ success: false, error: 'merchantId is required' });

    const merchant = await prisma.paymentMerchant.findUnique({ where: { id: merchantId } });
    if (!merchant) return res.status(404).json({ success: false, error: 'Merchant not found' });

    // If a station is specified, make sure it belongs to the same store and isn't already paired.
    if (stationId) {
      const station = await prisma.station.findUnique({ where: { id: stationId } });
      if (!station) return res.status(400).json({ success: false, error: 'Station not found' });
      if (station.storeId !== merchant.storeId) {
        return res.status(400).json({ success: false, error: 'Station belongs to a different store' });
      }
      const paired = await prisma.paymentTerminal.findUnique({ where: { stationId } });
      if (paired) {
        return res.status(409).json({ success: false, error: 'This station already has a terminal paired' });
      }
    }

    const terminal = await prisma.paymentTerminal.create({
      data: {
        orgId:              merchant.orgId,
        storeId:            merchant.storeId,
        merchantId,
        stationId:          stationId || null,
        nickname:           nickname || null,
        deviceSerialNumber: deviceSerialNumber || null,
        deviceModel:        deviceModel || 'P17',
        overrideTpn:        overrideTpn || null,
        notes:              notes || null,
      },
    });

    res.status(201).json({ success: true, terminal });
  } catch (err) {
    console.error('[createTerminal]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── PUT /api/admin/payment-terminals/:id ────────────────────────────────────
export const updateTerminal = async (req, res) => {
  try {
    const existing = await prisma.paymentTerminal.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Terminal not found' });

    const { nickname, deviceSerialNumber, deviceModel, overrideTpn, stationId, status, notes } = req.body;

    // Station reassignment requires same-store check + uniqueness.
    if (stationId !== undefined && stationId !== existing.stationId) {
      if (stationId) {
        const station = await prisma.station.findUnique({ where: { id: stationId } });
        if (!station) return res.status(400).json({ success: false, error: 'Station not found' });
        if (station.storeId !== existing.storeId) {
          return res.status(400).json({ success: false, error: 'Station belongs to a different store' });
        }
        const paired = await prisma.paymentTerminal.findUnique({ where: { stationId } });
        if (paired && paired.id !== existing.id) {
          return res.status(409).json({ success: false, error: 'That station already has a terminal paired' });
        }
      }
    }

    const terminal = await prisma.paymentTerminal.update({
      where: { id: req.params.id },
      data: {
        ...(nickname           !== undefined ? { nickname:           nickname || null }           : {}),
        ...(deviceSerialNumber !== undefined ? { deviceSerialNumber: deviceSerialNumber || null } : {}),
        ...(deviceModel        !== undefined ? { deviceModel:        deviceModel || null }        : {}),
        ...(overrideTpn        !== undefined ? { overrideTpn:        overrideTpn || null }        : {}),
        ...(stationId          !== undefined ? { stationId:          stationId || null }          : {}),
        ...(status             !== undefined ? { status }                                          : {}),
        ...(notes              !== undefined ? { notes:              notes || null }              : {}),
      },
    });

    res.json({ success: true, terminal });
  } catch (err) {
    console.error('[updateTerminal]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── DELETE /api/admin/payment-terminals/:id ─────────────────────────────────
export const deleteTerminal = async (req, res) => {
  try {
    const existing = await prisma.paymentTerminal.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Terminal not found' });
    await prisma.paymentTerminal.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('[deleteTerminal]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── POST /api/admin/payment-terminals/:id/ping ──────────────────────────────
export const pingTerminal = async (req, res) => {
  try {
    const terminal = await prisma.paymentTerminal.findUnique({
      where: { id: req.params.id },
      include: { merchant: true },
    });
    if (!terminal) return res.status(404).json({ success: false, error: 'Terminal not found' });
    if (!terminal.merchant) return res.status(400).json({ success: false, error: 'Terminal has no merchant' });

    // Use the terminal's overrideTpn if set, else fall back to merchant's
    const decrypted = {
      ...terminal.merchant,
      spinAuthKey: terminal.merchant.spinAuthKey ? decrypt(terminal.merchant.spinAuthKey) : null,
      spinTpn:     terminal.overrideTpn || terminal.merchant.spinTpn,
    };

    const status = await checkTerminalStatus(decrypted);

    const updated = await prisma.paymentTerminal.update({
      where: { id: terminal.id },
      data: {
        status:         status.connected ? 'active' : 'inactive',
        lastPingedAt:   new Date(),
        lastPingResult: status.connected ? 'ok' : (status.message || 'Not connected'),
      },
    });

    res.json({ success: status.connected, message: status.message, terminal: updated });
  } catch (err) {
    console.error('[pingTerminal]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
