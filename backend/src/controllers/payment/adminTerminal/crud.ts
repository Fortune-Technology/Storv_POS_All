/**
 * Admin terminal — CRUD handlers + station picker.
 *
 *   listTerminals          → GET /payment-terminals (filterable by store/merchant)
 *   listStationsForStore   → GET /payment-terminals/stations?storeId=...
 *                            cross-org station picker for the Add Terminal modal
 *   createTerminal         → POST /payment-terminals
 *   updateTerminal         → PUT /payment-terminals/:id
 *   deleteTerminal         → DELETE /payment-terminals/:id
 *
 * Live-connectivity check (`pingTerminal`) lives in ./ping.ts.
 *
 * Pairing rule enforced in createTerminal + updateTerminal: a station can
 * own AT MOST one terminal. Reassigning to an already-paired station
 * returns 409. Stations from a different store than the merchant return 400.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../../config/postgres.js';

/** GET /api/admin/payment-terminals */
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

    type TerminalRow = (typeof terminals)[number];
    // Join station name for UI display
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

/** POST /api/admin/payment-terminals */
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

/** PUT /api/admin/payment-terminals/:id */
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

/** DELETE /api/admin/payment-terminals/:id */
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

/**
 * GET /api/admin/payment-terminals/stations?storeId=...
 *
 * Cross-org station listing for the Add Terminal modal's Station picker.
 * Different from `/api/pos-terminal/stations` which scopes by `req.orgId` —
 * this one lets superadmin pick stations in any store.
 *
 * Also surfaces which stations are already paired with a terminal so the UI
 * can disable those options (a station can only own one terminal at a time).
 */
export const listStationsForStore = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = (req.query.storeId as string | undefined) || '';
    if (!storeId) {
      res.status(400).json({ success: false, error: 'storeId query param required' });
      return;
    }

    // Resolve the store first so we can:
    //   1. Return 404 cleanly if the storeId is bogus (vs returning empty list)
    //   2. Double-scope the station query by `orgId` AS WELL — explicit org
    //      filter is defense in depth. Station.storeId already implies orgId
    //      under normal data, but explicit `orgId + storeId` filtering means
    //      any cross-org data mishap (e.g. a station accidentally relocated)
    //      can't surface to the wrong org's terminal modal.
    //   3. Echo the store name + orgId in the response so the admin UI can
    //      verify it scoped correctly.
    const store = await prisma.store.findUnique({
      where:  { id: storeId },
      select: { id: true, orgId: true, name: true },
    });
    if (!store) {
      res.status(404).json({ success: false, error: 'Store not found' });
      return;
    }

    type StationRow = {
      id: string; name: string; lastSeenAt: Date | null; orgId: string;
    };
    type PairedRow = {
      id: string; stationId: string | null; nickname: string | null; deviceModel: string | null;
    };

    const [stations, paired]: [StationRow[], PairedRow[]] = await Promise.all([
      prisma.station.findMany({
        // Explicit org + store filter. orgId is enforced server-side here
        // even though it's redundant under correct data — frontend should
        // never get to see stations from a different org.
        where:   { orgId: store.orgId, storeId: store.id },
        select:  { id: true, name: true, lastSeenAt: true, orgId: true },
        orderBy: { name: 'asc' },
      }) as unknown as Promise<StationRow[]>,
      prisma.paymentTerminal.findMany({
        where:  { orgId: store.orgId, storeId: store.id, stationId: { not: null } },
        select: { id: true, stationId: true, nickname: true, deviceModel: true },
      }) as unknown as Promise<PairedRow[]>,
    ]);

    const pairedByStation = new Map<string, PairedRow>();
    for (const p of paired) {
      if (p.stationId) pairedByStation.set(p.stationId, p);
    }

    res.json({
      success: true,
      // Echo back the resolved scope so the admin UI can render a header
      // like "Stations for store ‘Main Street’" — and so the implementation
      // engineer can sanity-check what scope the dropdown is showing.
      scope: {
        storeId:   store.id,
        storeName: store.name,
        orgId:     store.orgId,
      },
      stations: stations.map((s: StationRow) => {
        const t = pairedByStation.get(s.id);
        return {
          id:          s.id,
          name:        s.name,
          orgId:       s.orgId,                      // included for verification
          lastSeenAt:  s.lastSeenAt,
          paired:      !!t,
          pairedTerminalId:       t?.id          ?? null,
          pairedTerminalNickname: t?.nickname    ?? null,
          pairedTerminalModel:    t?.deviceModel ?? null,
        };
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[listStationsForStore]', err);
    res.status(500).json({ success: false, error: message });
  }
};
