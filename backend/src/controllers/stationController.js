/**
 * Station Controller
 * Handles POS terminal registration, PIN-based cashier login, and PIN management.
 */

import jwt     from 'jsonwebtoken';
import bcrypt  from 'bcryptjs';
import prisma  from '../config/postgres.js';
import { nanoid } from 'nanoid';

const generateCashierToken = (id, extra = {}) =>
  jwt.sign({ id, ...extra }, process.env.JWT_SECRET, { expiresIn: '24h' });

// ── GET /api/pos-terminal/stations ────────────────────────────────────────
// Lightweight list of stations for the active store, used by the back-office
// "Open Shift" modal to let a manager pick which register a shift is for.
// Returns `{ stations: [{ id, name, isActive }] }`.
export const listStationsForStore = async (req, res) => {
  try {
    const orgId = req.orgId || req.user?.orgId;
    const storeId = req.query.storeId || req.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId required' });
    const stations = await prisma.station.findMany({
      where: { orgId, storeId },
      select: { id: true, name: true, isActive: true, lastSeenAt: true },
      orderBy: { name: 'asc' },
    });
    res.json({ stations });
  } catch (err) {
    console.error('[listStationsForStore]', err);
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/station-register ───────────────────────────────
// Requires: Bearer token (manager / owner / admin)
// Creates a new station record and returns a long-lived station token.
export const registerStation = async (req, res) => {
  try {
    const { storeId, name } = req.body;
    if (!storeId || !name) {
      return res.status(400).json({ error: 'storeId and name are required' });
    }

    const orgId = req.orgId || req.user?.orgId;

    // Verify store belongs to this org
    const store = await prisma.store.findFirst({ where: { id: storeId, orgId } });
    if (!store) return res.status(404).json({ error: 'Store not found' });

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
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/station-verify ─────────────────────────────────
// Requires: X-Station-Token header
// Used by POS on boot to confirm its token is still valid and get store info.
export const verifyStation = async (req, res) => {
  try {
    const stationToken = req.headers['x-station-token'];
    if (!stationToken) return res.status(401).json({ error: 'Station token required' });

    const station = await prisma.station.findUnique({
      where: { token: stationToken },
    });
    if (!station) return res.status(401).json({ error: 'Invalid station token' });

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
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/pin-login ─────────────────────────────────────
// Requires: X-Station-Token header   Body: { pin }
// Tiered lookup (per-store override takes precedence over org-wide PIN):
//   1. UserStore.posPin at station.storeId — any user who has opted into a
//      per-store PIN. Wins even if the same PIN hash exists on User.posPin.
//   2. User.posPin for any active org user — legacy org-wide fallback,
//      preserved for backward compat with cashiers who still rely on the
//      shared PIN. Owners/admins also land here when they haven't set a
//      per-store PIN (effectively: owner's PIN works at every store in
//      their org, matching the requested "highest hierarchy" behavior).
export const pinLogin = async (req, res) => {
  try {
    const stationToken = req.headers['x-station-token'];
    const { pin } = req.body;

    if (!stationToken) return res.status(401).json({ error: 'Station token required' });
    if (!pin)          return res.status(400).json({ error: 'PIN required' });
    if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4–6 digits' });

    const station = await prisma.station.findUnique({ where: { token: stationToken } });
    if (!station) return res.status(401).json({ error: 'Invalid station token' });

    await prisma.station.update({
      where: { id: station.id },
      data:  { lastSeenAt: new Date() },
    });

    let matched = null;

    // Tier 1 — per-store PIN. Authoritative when any UserStore row exists
    // for this station's storeId with a posPin hash that matches the input.
    const storeEntries = await prisma.userStore.findMany({
      where:  { storeId: station.storeId, posPin: { not: null } },
      select: {
        posPin: true,
        user: {
          select: { id: true, name: true, email: true, role: true, orgId: true, status: true },
        },
      },
    });
    for (const entry of storeEntries) {
      if (entry.user?.status === 'active' && bcrypt.compareSync(pin, entry.posPin)) {
        matched = entry.user;
        break;
      }
    }

    // Tier 2 — org-wide PIN fallback (User.posPin). Covers legacy cashier
    // PINs and owner/admin global-access use-case.
    if (!matched) {
      const orgUsers = await prisma.user.findMany({
        where:  {
          orgId:  station.orgId,
          posPin: { not: null },
          status: 'active',
        },
        select: { id: true, name: true, email: true, role: true, orgId: true, posPin: true },
      });
      for (const u of orgUsers) {
        if (bcrypt.compareSync(pin, u.posPin)) { matched = u; break; }
      }
    }

    if (!matched) return res.status(401).json({ error: 'Invalid PIN' });

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
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/users/me/pins ───────────────────────────────────────────────
// Self-service: list stores the user can set a PIN at + whether each is set.
// Owners/admins see every store in their org(s). Others see only stores
// they have UserStore membership in.
export const listMyPins = async (req, res) => {
  try {
    const userId = req.user.id;

    // Resolve all org ids this user has access to via UserOrg
    const memberships = await prisma.userOrg.findMany({
      where: { userId },
      select: { orgId: true, role: true },
    });
    const ownedOrgIds = memberships
      .filter(m => ['owner', 'admin'].includes(m.role))
      .map(m => m.orgId);

    // Stores visible to this user:
    //   a) any store in an org where they have owner/admin role
    //   b) any store they have UserStore membership in
    const [ownerStores, memberStores] = await Promise.all([
      ownedOrgIds.length
        ? prisma.store.findMany({
            // Store model uses `isActive` (NOT `active`). Three lines here
            // and one at the filter below had `active` — caused Prisma
            // validation errors in prod logs whenever any user hit the
            // MyPIN tab.
            where:  { orgId: { in: ownedOrgIds }, isActive: true },
            select: { id: true, name: true, orgId: true },
          })
        : Promise.resolve([]),
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
    const map = new Map();
    for (const s of ownerStores) {
      if (!s) continue;
      map.set(s.id, { storeId: s.id, storeName: s.name, orgId: s.orgId, hasPin: false });
    }
    for (const m of memberStores) {
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
    res.status(500).json({ error: err.message });
  }
};

// ── PUT /api/users/me/pin ────────────────────────────────────────────────
// Self-service: set/update the caller's PIN for a specific store they have
// access to. Owners can set a PIN for any store in their org (auto-creates
// the UserStore row). Others can only set a PIN at stores they're already
// a member of.
export const setMyPin = async (req, res) => {
  try {
    const userId = req.user.id;
    const { storeId, pin } = req.body;

    if (!storeId) return res.status(400).json({ error: 'storeId required' });
    if (!pin) return res.status(400).json({ error: 'PIN required' });
    if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4–6 digits' });

    const store = await prisma.store.findUnique({
      where:  { id: storeId },
      select: { id: true, orgId: true, isActive: true },
    });
    if (!store || !store.isActive) return res.status(404).json({ error: 'Store not found' });

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
      return res.status(403).json({ error: 'You do not have access to this store' });
    }

    const hashed = await bcrypt.hash(pin, 10);

    if (membership) {
      await prisma.userStore.update({
        where: { userId_storeId: { userId, storeId } },
        data:  { posPin: hashed },
      });
    } else {
      // Owner with no existing UserStore — auto-create (highest hierarchy
      // override: owners don't need a manager to "invite" them to a store).
      await prisma.userStore.create({
        data: { userId, storeId, posPin: hashed },
      });
    }

    res.json({ success: true, storeId, hasPin: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── DELETE /api/users/me/pin/:storeId ────────────────────────────────────
// Self-service: clear the caller's per-store PIN (keeps the UserStore row).
export const removeMyPin = async (req, res) => {
  try {
    const userId = req.user.id;
    const storeId = req.params.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId required' });

    const membership = await prisma.userStore.findUnique({
      where: { userId_storeId: { userId, storeId } },
    });
    if (!membership) return res.status(404).json({ error: 'No PIN set at this store' });

    await prisma.userStore.update({
      where: { userId_storeId: { userId, storeId } },
      data:  { posPin: null },
    });
    res.json({ success: true, storeId, hasPin: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PUT /api/users/:id/pin ────────────────────────────────────────────────
// Set or update a cashier's POS PIN. Manager / owner / admin only.
export const setCashierPin = async (req, res) => {
  try {
    const { pin } = req.body;
    const userId  = req.params.id;
    const orgId   = req.orgId || req.user?.orgId;

    if (!pin) return res.status(400).json({ error: 'PIN required' });
    if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4–6 digits' });

    const target = await prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const hashed = await bcrypt.hash(pin, 10);
    await prisma.user.update({ where: { id: userId }, data: { posPin: hashed } });

    res.json({ message: 'PIN updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── DELETE /api/users/:id/pin ─────────────────────────────────────────────
// Remove a cashier's POS PIN.
export const removeCashierPin = async (req, res) => {
  try {
    const userId = req.params.id;
    const orgId  = req.orgId || req.user?.orgId;

    const target = await prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    await prisma.user.update({ where: { id: userId }, data: { posPin: null } });
    res.json({ message: 'PIN removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
