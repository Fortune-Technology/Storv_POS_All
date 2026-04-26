/**
 * Station Controller
 * Handles POS terminal registration, PIN-based cashier login, and PIN management.
 */

import type { Request, Response } from 'express';
import jwt     from 'jsonwebtoken';
import bcrypt  from 'bcryptjs';
import prisma  from '../config/postgres.js';
import { nanoid } from 'nanoid';

const generateCashierToken = (id: string, extra: Record<string, unknown> = {}): string =>
  jwt.sign({ id, ...extra }, process.env.JWT_SECRET as string, { expiresIn: '24h' } as jwt.SignOptions);

// ── GET /api/pos-terminal/stations ────────────────────────────────────────
export const listStationsForStore = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.orgId || req.user?.orgId;
    const storeId = (req.query.storeId as string | undefined) || req.storeId;
    if (!storeId) { res.status(400).json({ error: 'storeId required' }); return; }
    const stations = await prisma.station.findMany({
      where: { orgId: orgId as string, storeId },
      select: { id: true, name: true, lastSeenAt: true },
      orderBy: { name: 'asc' },
    });
    res.json({ stations });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[listStationsForStore]', err);
    res.status(500).json({ error: message });
  }
};

// ── POST /api/pos-terminal/station-register ───────────────────────────────
export const registerStation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { storeId, name } = req.body as { storeId?: string; name?: string };
    if (!storeId || !name) {
      res.status(400).json({ error: 'storeId and name are required' });
      return;
    }

    const orgId = (req.orgId || req.user?.orgId) as string;

    // Verify store belongs to this org
    const store = await prisma.store.findFirst({ where: { id: storeId, orgId } });
    if (!store) { res.status(404).json({ error: 'Store not found' }); return; }

    // Generate a unique, opaque station token
    const token = `stn_${nanoid(40)}`;

    const station = await prisma.station.create({
      data: { orgId, storeId, name: name.trim(), token, lastSeenAt: new Date() },
    });

    res.status(201).json({
      stationId:    station.id,
      stationToken: station.token,
      stationName:  station.name,
      storeId:      store.id,
      storeName:    store.name,
      orgId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

// ── GET /api/pos-terminal/station-verify ─────────────────────────────────
export const verifyStation = async (req: Request, res: Response): Promise<void> => {
  try {
    const stationToken = req.headers['x-station-token'] as string | undefined;
    if (!stationToken) { res.status(401).json({ error: 'Station token required' }); return; }

    const station = await prisma.station.findUnique({
      where: { token: stationToken },
    });
    if (!station) { res.status(401).json({ error: 'Invalid station token' }); return; }

    const store = await prisma.store.findFirst({
      where:  { id: station.storeId, orgId: station.orgId },
      select: { name: true, branding: true },
    });

    await prisma.station.update({
      where: { id: station.id },
      data:  { lastSeenAt: new Date() },
    });

    res.json({
      stationId:    station.id,
      stationName:  station.name,
      storeId:      station.storeId,
      storeName:    store?.name,
      orgId:        station.orgId,
      branding:     store?.branding || {},
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

interface MatchedUser {
  id: string;
  name: string;
  email: string;
  role: string;
  orgId: string | null;
  status?: string;
}

// ── POST /api/pos-terminal/pin-login ─────────────────────────────────────
export const pinLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const stationToken = req.headers['x-station-token'] as string | undefined;
    const { pin } = req.body as { pin?: string };

    if (!stationToken) { res.status(401).json({ error: 'Station token required' }); return; }
    if (!pin)          { res.status(400).json({ error: 'PIN required' }); return; }
    if (!/^\d{4,6}$/.test(pin)) { res.status(400).json({ error: 'PIN must be 4–6 digits' }); return; }

    const station = await prisma.station.findUnique({ where: { token: stationToken } });
    if (!station) { res.status(401).json({ error: 'Invalid station token' }); return; }

    await prisma.station.update({
      where: { id: station.id },
      data:  { lastSeenAt: new Date() },
    });

    let matched: MatchedUser | null = null;

    // Tier 1 — per-store PIN.
    const storeEntries = await prisma.userStore.findMany({
      where:  { storeId: station.storeId, posPin: { not: null } },
      select: {
        posPin: true,
        user: {
          select: { id: true, name: true, email: true, role: true, orgId: true, status: true },
        },
      },
    });
    type StoreEntryRow = (typeof storeEntries)[number];
    for (const entry of storeEntries as StoreEntryRow[]) {
      if (entry.user?.status === 'active' && entry.posPin && bcrypt.compareSync(pin, entry.posPin)) {
        matched = entry.user as MatchedUser;
        break;
      }
    }

    // Tier 2 — org-wide PIN fallback (User.posPin).
    if (!matched) {
      const orgUsers = await prisma.user.findMany({
        where:  {
          orgId:  station.orgId,
          posPin: { not: null },
          status: 'active',
        },
        select: { id: true, name: true, email: true, role: true, orgId: true, posPin: true },
      });
      type OrgUserRow = (typeof orgUsers)[number];
      for (const u of orgUsers as OrgUserRow[]) {
        if (u.posPin && bcrypt.compareSync(pin, u.posPin)) {
          matched = u as MatchedUser;
          break;
        }
      }
    }

    if (!matched) { res.status(401).json({ error: 'Invalid PIN' }); return; }

    const token = generateCashierToken(matched.id, {
      name:  matched.name,
      email: matched.email,
      role:  matched.role,
      orgId: matched.orgId,
    });

    res.json({
      id:          matched.id,
      name:        matched.name,
      email:       matched.email,
      role:        matched.role,
      orgId:       matched.orgId,
      storeId:     station.storeId,
      stationId:   station.id,
      stationName: station.name,
      token,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

// ── GET /api/users/me/pins ───────────────────────────────────────────────
export const listMyPins = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    // Resolve all org ids this user has access to via UserOrg
    const memberships = await prisma.userOrg.findMany({
      where: { userId },
      select: { orgId: true, role: true },
    });
    type MembershipRow = (typeof memberships)[number];
    const ownedOrgIds = (memberships as MembershipRow[])
      .filter((m: MembershipRow) => ['owner', 'admin'].includes(m.role))
      .map((m: MembershipRow) => m.orgId);

    // Stores visible to this user.
    const [ownerStores, memberStores] = await Promise.all([
      ownedOrgIds.length
        ? prisma.store.findMany({
            where:  { orgId: { in: ownedOrgIds }, isActive: true },
            select: { id: true, name: true, orgId: true },
          })
        : Promise.resolve([] as { id: string; name: string; orgId: string }[]),
      prisma.userStore.findMany({
        where:  { userId },
        select: {
          posPin:  true,
          store:   { select: { id: true, name: true, orgId: true, isActive: true } },
        },
      }),
    ]);

    // Build a merged map keyed by storeId (member stores override owner list
    // because they already carry a posPin value we want to preserve).
    interface StoreEntry { storeId: string; storeName: string; orgId: string; hasPin: boolean }
    const map = new Map<string, StoreEntry>();
    type OwnerStoreRow = { id: string; name: string; orgId: string };
    type MemberStoreRow = { posPin: string | null; store: { id: string; name: string; orgId: string; isActive: boolean } | null };
    for (const s of ownerStores as OwnerStoreRow[]) {
      if (!s) continue;
      map.set(s.id, { storeId: s.id, storeName: s.name, orgId: s.orgId, hasPin: false });
    }
    for (const m of memberStores as MemberStoreRow[]) {
      if (!m.store || !m.store.isActive) continue;
      map.set(m.store.id, {
        storeId:   m.store.id,
        storeName: m.store.name,
        orgId:     m.store.orgId,
        hasPin:    !!m.posPin,
      });
    }

    const stores = Array.from(map.values()).sort((a, b) => a.storeName.localeCompare(b.storeName));
    res.json({ stores });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

// ── PUT /api/users/me/pin ────────────────────────────────────────────────
export const setMyPin = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { storeId, pin } = req.body as { storeId?: string; pin?: string };

    if (!storeId) { res.status(400).json({ error: 'storeId required' }); return; }
    if (!pin) { res.status(400).json({ error: 'PIN required' }); return; }
    if (!/^\d{4,6}$/.test(pin)) { res.status(400).json({ error: 'PIN must be 4–6 digits' }); return; }

    const store = await prisma.store.findUnique({
      where:  { id: storeId },
      select: { id: true, orgId: true, isActive: true },
    });
    if (!store || !store.isActive) { res.status(404).json({ error: 'Store not found' }); return; }

    // Authorise: must be either UserStore member, or owner/admin in store's org
    const [membership, orgMembership] = await Promise.all([
      prisma.userStore.findUnique({
        where: { userId_storeId: { userId, storeId } },
      }),
      prisma.userOrg.findUnique({
        where: { userId_orgId: { userId, orgId: store.orgId } },
      }),
    ]);

    const isOwner = orgMembership && ['owner', 'admin'].includes(orgMembership.role);
    if (!membership && !isOwner) {
      res.status(403).json({ error: 'You do not have access to this store' });
      return;
    }

    const hashed = await bcrypt.hash(pin, 10);

    if (membership) {
      await prisma.userStore.update({
        where: { userId_storeId: { userId, storeId } },
        data:  { posPin: hashed },
      });
    } else {
      // Owner with no existing UserStore — auto-create.
      await prisma.userStore.create({
        data: { userId, storeId, posPin: hashed },
      });
    }

    res.json({ success: true, storeId, hasPin: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

// ── DELETE /api/users/me/pin/:storeId ────────────────────────────────────
export const removeMyPin = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const storeId = req.params.storeId;
    if (!storeId) { res.status(400).json({ error: 'storeId required' }); return; }

    const membership = await prisma.userStore.findUnique({
      where: { userId_storeId: { userId, storeId } },
    });
    if (!membership) { res.status(404).json({ error: 'No PIN set at this store' }); return; }

    await prisma.userStore.update({
      where: { userId_storeId: { userId, storeId } },
      data:  { posPin: null },
    });
    res.json({ success: true, storeId, hasPin: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

// ── PUT /api/users/:id/pin ────────────────────────────────────────────────
export const setCashierPin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { pin } = req.body as { pin?: string };
    const userId  = req.params.id;
    const orgId   = (req.orgId || req.user?.orgId) as string;

    if (!pin) { res.status(400).json({ error: 'PIN required' }); return; }
    if (!/^\d{4,6}$/.test(pin)) { res.status(400).json({ error: 'PIN must be 4–6 digits' }); return; }

    const target = await prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!target) { res.status(404).json({ error: 'User not found' }); return; }

    const hashed = await bcrypt.hash(pin, 10);
    await prisma.user.update({ where: { id: userId }, data: { posPin: hashed } });

    res.json({ message: 'PIN updated' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

// ── DELETE /api/users/:id/pin ─────────────────────────────────────────────
export const removeCashierPin = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.params.id;
    const orgId  = (req.orgId || req.user?.orgId) as string;

    const target = await prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!target) { res.status(404).json({ error: 'User not found' }); return; }

    await prisma.user.update({ where: { id: userId }, data: { posPin: null } });
    res.json({ message: 'PIN removed' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};
