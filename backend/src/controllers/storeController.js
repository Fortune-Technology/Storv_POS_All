/**
 * Store Controller  —  /api/stores
 *
 * Pricing model (v2):
 *   $99 / month per store — includes up to 2 registers
 *   +$39 / month for each additional register beyond 2
 */

import prisma from '../config/postgres.js';

const isOwnerOrAdmin = (req) =>
  ['superadmin', 'admin', 'owner', 'manager'].includes(req.user?.role);

// How many stores each plan can have (Pro = unlimited in practice)
const PLAN_STORE_LIMITS = {
  trial:      1,
  starter:    1,
  pro:        999,
  enterprise: 999,
};

// Compute monthly fee for one store given its register count
const calcStoreMonthly = (registers = 1) => {
  const r = Math.max(1, registers);
  return 99 + Math.max(0, r - 2) * 39;
};

const ALLOWED_FIELDS = [
  'name', 'address', 'latitude', 'longitude', 'timezone',
  'stationCount', 'monthlyRatePerStation', 'pos',
  'itRetailStoreId', 'itRetailTenantId',
];

// Strip POS credentials from the response and add _id alias for frontend compat
const stripCredentials = (store) => {
  if (!store) return store;
  const s = { ...store };
  if (s.pos) {
    const { password, apiKey, ...safePos } = s.pos;
    s.pos = safePos;
  }
  s._id = s.id; // legacy alias used throughout frontend
  return s;
};

/* ── POST /api/stores ────────────────────────────────────────────────────── */
export const createStore = async (req, res, next) => {
  try {
    if (!req.orgId) {
      return res.status(403).json({ error: 'Organisation required before creating a store.' });
    }

    const [storeCount, org] = await Promise.all([
      prisma.store.count({ where: { orgId: req.orgId, isActive: true } }),
      prisma.organization.findUnique({
        where: { id: req.orgId },
        select: { maxStores: true, plan: true },
      }),
    ]);

    // Use plan-based limits (overrides the legacy DB maxStores column)
    const planLimit = PLAN_STORE_LIMITS[org?.plan] ?? org?.maxStores ?? 1;
    if (storeCount >= planLimit) {
      return res.status(402).json({
        error: `Your ${org?.plan || 'current'} plan allows up to ${planLimit} store(s). Please upgrade to add more.`,
        plan:  org?.plan,
        limit: planLimit,
      });
    }

    const { name, address, latitude, longitude, timezone, stationCount, pos } = req.body;
    const registers = Math.max(1, parseInt(stationCount) || 1);
    const monthly   = calcStoreMonthly(registers);

    const store = await prisma.store.create({
      data: {
        name:                  name || 'My Store',
        orgId:                 req.orgId,
        ownerId:               req.user.id,
        address:               address  ?? null,
        latitude:              latitude ?? null,
        longitude:             longitude ?? null,
        timezone:              timezone || 'America/New_York',
        stationCount:          registers,
        monthlyRatePerStation: monthly,   // store total (not per-register) for fast retrieval
        pos:                   pos ?? undefined,
      },
    });

    res.status(201).json({
      ...stripCredentials(store),
      monthlyTotal: monthly,
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/stores ─────────────────────────────────────────────────────── */
export const getStores = async (req, res, next) => {
  try {
    const where = req.orgId
      ? { orgId: req.orgId, isActive: true }
      : { ownerId: req.user.id, isActive: true };

    const stores = await prisma.store.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    const withBilling = stores.map((s) => {
      const monthly = calcStoreMonthly(s.stationCount ?? 1);
      return {
        ...stripCredentials(s),
        monthlyTotal:          monthly,
        monthlyRatePerStation: monthly, // keep field name for frontend compat
      };
    });

    res.json(withBilling);
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/stores/:id ─────────────────────────────────────────────────── */
export const getStoreById = async (req, res, next) => {
  try {
    const where = req.orgId
      ? { id: req.params.id, orgId: req.orgId }
      : { id: req.params.id, ownerId: req.user.id };

    const store = await prisma.store.findFirst({ where });
    if (!store) return res.status(404).json({ error: 'Store not found.' });

    res.json(stripCredentials(store));
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/stores/:id ─────────────────────────────────────────────────── */
export const updateStore = async (req, res, next) => {
  try {
    if (!isOwnerOrAdmin(req)) {
      return res.status(403).json({ error: 'Insufficient permissions to update a store.' });
    }

    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => ALLOWED_FIELDS.includes(k))
    );

    // Recalculate monthly total when register count changes
    if (updates.stationCount != null) {
      updates.stationCount          = Math.max(1, parseInt(updates.stationCount) || 1);
      updates.monthlyRatePerStation = calcStoreMonthly(updates.stationCount);
    }

    const where = req.orgId
      ? { id: req.params.id, orgId: req.orgId }
      : { id: req.params.id, ownerId: req.user.id };

    const existing = await prisma.store.findFirst({ where });
    if (!existing) return res.status(404).json({ error: 'Store not found.' });

    const store = await prisma.store.update({
      where: { id: existing.id },
      data: updates,
    });

    res.json(stripCredentials(store));
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/stores/:id  (soft deactivate) ───────────────────────────── */
export const deactivateStore = async (req, res, next) => {
  try {
    if (!isOwnerOrAdmin(req)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }

    const where = req.orgId
      ? { id: req.params.id, orgId: req.orgId }
      : { id: req.params.id, ownerId: req.user.id };

    const existing = await prisma.store.findFirst({ where });
    if (!existing) return res.status(404).json({ error: 'Store not found.' });

    const store = await prisma.store.update({
      where: { id: existing.id },
      data: { isActive: false },
    });

    res.json({ message: 'Store deactivated.', store: stripCredentials(store) });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/stores/:id/branding ─────────────────────────────────────────── */
export const getStoreBranding = async (req, res, next) => {
  try {
    const store = await prisma.store.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
      select: { id: true, name: true, branding: true },
    });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json({ storeName: store.name, ...(store.branding || {}) });
  } catch (err) { next(err); }
};

/* ── PUT /api/stores/:id/branding ─────────────────────────────────────────── */
export const updateStoreBranding = async (req, res, next) => {
  try {
    if (!isOwnerOrAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { theme, primaryColor, logoText } = req.body;
    const branding = {
      theme:        ['light', 'dark'].includes(theme) ? theme : 'dark',
      primaryColor: /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#7ac143',
      logoText:     logoText || '',
      publishedAt:  new Date().toISOString(),
    };
    const store = await prisma.store.update({
      where: { id: req.params.id },
      data:  { branding },
    });
    res.json(stripCredentials(store));
  } catch (err) { next(err); }
};

/* ── GET /api/stores/billing-summary ─────────────────────────────────────── */
export const getBillingSummary = async (req, res, next) => {
  try {
    if (!req.orgId) {
      return res.status(403).json({ error: 'No organisation context.' });
    }

    const stores = await prisma.store.findMany({
      where: { orgId: req.orgId, isActive: true },
      select: { id: true, name: true, stationCount: true, monthlyRatePerStation: true },
    });

    const rows = stores.map((s) => {
      const registers = s.stationCount ?? 1;
      const monthly   = calcStoreMonthly(registers);
      return {
        storeId:           s.id,
        name:              s.name,
        registers,
        stationCount:      registers,     // legacy alias
        baseMonthly:       99,
        extraRegisters:    Math.max(0, registers - 2),
        extraMonthly:      Math.max(0, registers - 2) * 39,
        monthlyTotal:      monthly,
      };
    });

    const totalStations = rows.reduce((sum, r) => sum + r.stationCount, 0);
    const totalMonthly  = rows.reduce((sum, r) => sum + r.monthlyTotal, 0);
    const totalAnnual   = totalMonthly * 12;

    res.json({ stores: rows, totalStations, totalMonthly, totalAnnual });
  } catch (err) {
    next(err);
  }
};
