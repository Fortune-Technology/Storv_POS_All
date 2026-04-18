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
    // Superadmin with X-Tenant-Id override → just that one org.
    if (req.user?.role === 'superadmin' && req.headers['x-tenant-id']) {
      const stores = await prisma.store.findMany({
        where: { orgId: req.orgId, isActive: true },
        orderBy: { createdAt: 'asc' },
        include: { organization: { select: { id: true, name: true, slug: true } } },
      });
      return res.json(stores.map(toResponseStore));
    }

    // Regular user: union of (a) all orgs they have UserOrg membership in,
    // and (b) stores they have direct UserStore access to. The frontend's
    // StoreSwitcher uses this single response to show stores from every
    // organisation the user belongs to — single login, multi-org access.
    const membershipOrgIds = (req.orgIds && req.orgIds.length > 0)
      ? req.orgIds
      : (req.user?.orgId ? [req.user.orgId] : []); // legacy fallback

    const directStoreIds = req.storeIds ?? [];

    // If the user has neither memberships nor direct stores, fall back to
    // the stores they own (for the onboarding window where the org exists
    // but UserOrg hasn't been written yet).
    const orConditions = [];
    if (membershipOrgIds.length) orConditions.push({ orgId:    { in: membershipOrgIds } });
    if (directStoreIds.length)   orConditions.push({ id:       { in: directStoreIds  } });
    if (!orConditions.length)    orConditions.push({ ownerId:  req.user.id });

    const stores = await prisma.store.findMany({
      where: { OR: orConditions, isActive: true },
      orderBy: [{ orgId: 'asc' }, { createdAt: 'asc' }],
      include: { organization: { select: { id: true, name: true, slug: true } } },
    });

    res.json(stores.map(toResponseStore));
  } catch (err) {
    next(err);
  }
};

// Shape a Store row for the response: strip POS credentials, add legacy
// `_id` alias, compute monthly fee, surface the org name for the switcher.
function toResponseStore(s) {
  const monthly = calcStoreMonthly(s.stationCount ?? 1);
  const stripped = stripCredentials(s);
  return {
    ...stripped,
    orgName:               s.organization?.name ?? null,
    orgSlug:               s.organization?.slug ?? null,
    monthlyTotal:          monthly,
    monthlyRatePerStation: monthly,
  };
}

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
    const {
      theme, primaryColor, logoText,
      // Store info shown on receipt
      storeAddress, storePhone, storeEmail, storeWebsite,
      storeTaxId, taxIdLabel,
      // Header
      receiptHeaderLine1, receiptHeaderLine2,
      // Body toggles
      receiptShowCashier, receiptShowTransactionId, receiptShowItemCount,
      receiptShowTaxBreakdown, receiptShowSavings,
      // Footer
      receiptFooterLine1, receiptFooterLine2,
      receiptShowReturnPolicy, receiptReturnPolicy,
      // Paper
      receiptPaperWidth,
    } = req.body;

    // Get existing branding to merge (preserve fields not sent)
    const existing = await prisma.store.findFirst({
      where: { id: req.params.id },
      select: { branding: true },
    });
    const prev = (existing?.branding && typeof existing.branding === 'object') ? existing.branding : {};

    const branding = {
      ...prev,
      // POS UI branding
      theme:        ['light', 'dark'].includes(theme) ? theme : (prev.theme || 'dark'),
      primaryColor: /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : (prev.primaryColor || '#7ac143'),
      logoText:     logoText !== undefined ? (logoText || '') : (prev.logoText || ''),
      publishedAt:  new Date().toISOString(),
      // Store info
      storeAddress:  storeAddress  !== undefined ? storeAddress  : (prev.storeAddress  || ''),
      storePhone:    storePhone    !== undefined ? storePhone    : (prev.storePhone    || ''),
      storeEmail:    storeEmail    !== undefined ? storeEmail    : (prev.storeEmail    || ''),
      storeWebsite:  storeWebsite  !== undefined ? storeWebsite  : (prev.storeWebsite  || ''),
      storeTaxId:    storeTaxId    !== undefined ? storeTaxId    : (prev.storeTaxId    || ''),
      taxIdLabel:    taxIdLabel    !== undefined ? taxIdLabel    : (prev.taxIdLabel    || 'Tax ID'),
      // Header lines
      receiptHeaderLine1: receiptHeaderLine1 !== undefined ? receiptHeaderLine1 : (prev.receiptHeaderLine1 || ''),
      receiptHeaderLine2: receiptHeaderLine2 !== undefined ? receiptHeaderLine2 : (prev.receiptHeaderLine2 || ''),
      // Body toggles
      receiptShowCashier:       receiptShowCashier       !== undefined ? Boolean(receiptShowCashier)       : (prev.receiptShowCashier       !== false),
      receiptShowTransactionId: receiptShowTransactionId !== undefined ? Boolean(receiptShowTransactionId) : (prev.receiptShowTransactionId !== false),
      receiptShowItemCount:     receiptShowItemCount     !== undefined ? Boolean(receiptShowItemCount)     : Boolean(prev.receiptShowItemCount),
      receiptShowTaxBreakdown:  receiptShowTaxBreakdown  !== undefined ? Boolean(receiptShowTaxBreakdown)  : Boolean(prev.receiptShowTaxBreakdown),
      receiptShowSavings:       receiptShowSavings       !== undefined ? Boolean(receiptShowSavings)       : (prev.receiptShowSavings !== false),
      // Footer
      receiptFooterLine1:      receiptFooterLine1      !== undefined ? receiptFooterLine1      : (prev.receiptFooterLine1      || 'Thank you for your purchase!'),
      receiptFooterLine2:      receiptFooterLine2      !== undefined ? receiptFooterLine2      : (prev.receiptFooterLine2      || 'Please come again.'),
      receiptShowReturnPolicy: receiptShowReturnPolicy !== undefined ? Boolean(receiptShowReturnPolicy) : Boolean(prev.receiptShowReturnPolicy),
      receiptReturnPolicy:     receiptReturnPolicy     !== undefined ? receiptReturnPolicy     : (prev.receiptReturnPolicy || ''),
      // Paper
      receiptPaperWidth: ['80mm', '58mm'].includes(receiptPaperWidth) ? receiptPaperWidth : (prev.receiptPaperWidth || '80mm'),
      // Print behaviour: 'always' | 'ask' | 'never'
      receiptPrintBehavior: ['always','ask','never'].includes(req.body.receiptPrintBehavior)
        ? req.body.receiptPrintBehavior
        : (prev.receiptPrintBehavior || 'always'),
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
