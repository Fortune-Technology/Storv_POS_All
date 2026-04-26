/**
 * adminPaymentTerminalController.ts
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

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { checkTerminalStatus, type DecryptedPaymentMerchant } from '../services/paymentProviderFactory.js';
import { decrypt } from '../utils/cryptoVault.js';

// ── GET /api/admin/payment-terminals ────────────────────────────────────────
export const listTerminals = async (req: Request, res: Response): Promise<void> => {
  try {
    const { storeId, merchantId, orgId } = req.query as {
      storeId?: string;
      merchantId?: string;
      orgId?: string;
    };
    const where: Prisma.PaymentTerminalWhereInput = {};
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
    type TerminalRow = (typeof terminals)[number];
    const stationIds = Array.from(
      new Set(terminals.map((t: TerminalRow) => t.stationId).filter((id: string | null): id is string => !!id)),
    );
    const stations = stationIds.length
      ? await prisma.station.findMany({ where: { id: { in: stationIds } }, select: { id: true, name: true } })
      : [];
    const stationMap: Record<string, string> = Object.fromEntries(
      stations.map((s: { id: string; name: string }) => [s.id, s.name]),
    );

    const data = terminals.map((t: TerminalRow) => ({
      ...t,
      stationName:  t.stationId ? stationMap[t.stationId] : null,
      effectiveTpn: t.overrideTpn || t.merchant?.spinTpn || null,
    }));

    res.json({ success: true, terminals: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[listTerminals]', err);
    res.status(500).json({ success: false, error: message });
  }
};

interface CreateTerminalBody {
  merchantId?: string;
  stationId?: string | null;
  nickname?: string | null;
  deviceSerialNumber?: string | null;
  deviceModel?: string | null;
  overrideTpn?: string | null;
  notes?: string | null;
}

// ── POST /api/admin/payment-terminals ───────────────────────────────────────
export const createTerminal = async (req: Request, res: Response): Promise<void> => {
  try {
    const { merchantId, stationId, nickname, deviceSerialNumber, deviceModel, overrideTpn, notes } = req.body as CreateTerminalBody;
    if (!merchantId) { res.status(400).json({ success: false, error: 'merchantId is required' }); return; }

    const merchant = await prisma.paymentMerchant.findUnique({ where: { id: merchantId } });
    if (!merchant) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }

    // If a station is specified, make sure it belongs to the same store and isn't already paired.
    if (stationId) {
      const station = await prisma.station.findUnique({ where: { id: stationId } });
      if (!station) { res.status(400).json({ success: false, error: 'Station not found' }); return; }
      if (station.storeId !== merchant.storeId) {
        res.status(400).json({ success: false, error: 'Station belongs to a different store' });
        return;
      }
      const paired = await prisma.paymentTerminal.findUnique({ where: { stationId } });
      if (paired) {
        res.status(409).json({ success: false, error: 'This station already has a terminal paired' });
        return;
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
    const message = err instanceof Error ? err.message : String(err);
    console.error('[createTerminal]', err);
    res.status(500).json({ success: false, error: message });
  }
};

interface UpdateTerminalBody {
  nickname?: string | null;
  deviceSerialNumber?: string | null;
  deviceModel?: string | null;
  overrideTpn?: string | null;
  stationId?: string | null;
  status?: string;
  notes?: string | null;
}

// ── PUT /api/admin/payment-terminals/:id ────────────────────────────────────
export const updateTerminal = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.paymentTerminal.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ success: false, error: 'Terminal not found' }); return; }

    const { nickname, deviceSerialNumber, deviceModel, overrideTpn, stationId, status, notes } = req.body as UpdateTerminalBody;

    // Station reassignment requires same-store check + uniqueness.
    if (stationId !== undefined && stationId !== existing.stationId) {
      if (stationId) {
        const station = await prisma.station.findUnique({ where: { id: stationId } });
        if (!station) { res.status(400).json({ success: false, error: 'Station not found' }); return; }
        if (station.storeId !== existing.storeId) {
          res.status(400).json({ success: false, error: 'Station belongs to a different store' });
          return;
        }
        const paired = await prisma.paymentTerminal.findUnique({ where: { stationId } });
        if (paired && paired.id !== existing.id) {
          res.status(409).json({ success: false, error: 'That station already has a terminal paired' });
          return;
        }
      }
    }

    const data: Prisma.PaymentTerminalUpdateInput = {};
    if (nickname           !== undefined) data.nickname           = nickname || null;
    if (deviceSerialNumber !== undefined) data.deviceSerialNumber = deviceSerialNumber || null;
    if (deviceModel        !== undefined) data.deviceModel        = deviceModel || null;
    if (overrideTpn        !== undefined) data.overrideTpn        = overrideTpn || null;
    if (stationId          !== undefined) data.stationId          = stationId || null;
    if (status             !== undefined) data.status             = status;
    if (notes              !== undefined) data.notes              = notes || null;

    const terminal = await prisma.paymentTerminal.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ success: true, terminal });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[updateTerminal]', err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── DELETE /api/admin/payment-terminals/:id ─────────────────────────────────
export const deleteTerminal = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.paymentTerminal.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ success: false, error: 'Terminal not found' }); return; }
    await prisma.paymentTerminal.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[deleteTerminal]', err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── POST /api/admin/payment-terminals/:id/ping ──────────────────────────────
export const pingTerminal = async (req: Request, res: Response): Promise<void> => {
  try {
    const terminal = await prisma.paymentTerminal.findUnique({
      where: { id: req.params.id },
      include: { merchant: true },
    });
    if (!terminal) { res.status(404).json({ success: false, error: 'Terminal not found' }); return; }
    if (!terminal.merchant) { res.status(400).json({ success: false, error: 'Terminal has no merchant' }); return; }

    // Use the terminal's overrideTpn if set, else fall back to merchant's
    const decrypted = {
      ...terminal.merchant,
      spinAuthKey: terminal.merchant.spinAuthKey ? decrypt(terminal.merchant.spinAuthKey) : null,
      spinTpn:     terminal.overrideTpn || terminal.merchant.spinTpn,
    } as unknown as DecryptedPaymentMerchant;

    const status = await checkTerminalStatus(decrypted) as { connected?: boolean; message?: string };

    const updated = await prisma.paymentTerminal.update({
      where: { id: terminal.id },
      data: {
        status:         status.connected ? 'active' : 'inactive',
        lastPingedAt:   new Date(),
        lastPingResult: status.connected ? 'ok' : (status.message || 'Not connected'),
      },
    });

    res.json({ success: !!status.connected, message: status.message, terminal: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pingTerminal]', err);
    res.status(500).json({ success: false, error: message });
  }
};
