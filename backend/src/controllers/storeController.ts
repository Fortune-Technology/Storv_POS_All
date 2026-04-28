/**
 * Store Controller  —  /api/stores
 *
 * Pricing model (v2):
 *   $99 / month per store — includes up to 2 registers
 *   +$39 / month for each additional register beyond 2
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma, Store } from '@prisma/client';
import prisma from '../config/postgres.js';
import { logAudit } from '../services/auditService.js';
import { computeDiff, hasChanges } from '../services/auditDiff.js';

const isOwnerOrAdmin = (req: Request): boolean =>
  ['superadmin', 'admin', 'owner', 'manager'].includes(req.user?.role || '');

// How many stores each plan can have (Pro = unlimited in practice)
const PLAN_STORE_LIMITS: Record<string, number> = {
  trial:      1,
  starter:    1,
  pro:        999,
  enterprise: 999,
};

// Compute monthly fee for one store given its register count
const calcStoreMonthly = (registers: number = 1): number => {
  const r = Math.max(1, registers);
  return 99 + Math.max(0, r - 2) * 39;
};

const ALLOWED_FIELDS = [
  'name', 'address', 'latitude', 'longitude', 'timezone',
  'stationCount', 'monthlyRatePerStation', 'pos',
];

type StoreWithExtras = Store & {
  organization?: { id: string; name: string; slug: string } | null;
  _id?: string;
};

// Strip POS credentials from the response and add _id alias for frontend compat
const stripCredentials = (store: StoreWithExtras | null): Record<string, unknown> | null => {
  if (!store) return store;
  const s = { ...store } as Record<string, unknown>;
  const pos = s.pos;
  if (pos && typeof pos === 'object') {
    const { password: _password, apiKey: _apiKey, ...safePos } = pos as Record<string, unknown>;
    s.pos = safePos;
  }
  s._id = (s as { id: string }).id; // legacy alias used throughout frontend
  return s;
};

/* ── POST /api/stores ────────────────────────────────────────────────────── */
export const createStore = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.orgId) {
      res.status(403).json({ error: 'Organisation required before creating a store.' });
      return;
    }

    const [storeCount, org] = await Promise.all([
      prisma.store.count({ where: { orgId: req.orgId, isActive: true } }),
      prisma.organization.findUnique({
        where: { id: req.orgId },
        select: { maxStores: true, plan: true },
      }),
    ]);

    // Use plan-based limits (overrides the legacy DB maxStores column)
    const planLimit = PLAN_STORE_LIMITS[org?.plan || ''] ?? org?.maxStores ?? 1;
    if (storeCount >= planLimit) {
      res.status(402).json({
        error: `Your ${org?.plan || 'current'} plan allows up to ${planLimit} store(s). Please upgrade to add more.`,
        plan:  org?.plan,
        limit: planLimit,
      });
      return;
    }

    const { name, address, latitude, longitude, timezone, stationCount, pos } = req.body as {
      name?: string;
      address?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      timezone?: string;
      stationCount?: number | string;
      pos?: Prisma.InputJsonValue;
    };
    const registers = Math.max(1, parseInt(String(stationCount)) || 1);
    const monthly   = calcStoreMonthly(registers);

    const store = await prisma.store.create({
      data: {
        name:                  name || 'My Store',
        orgId:                 req.orgId,
        ownerId:               req.user!.id,
        address:               address  ?? null,
        latitude:              latitude ?? null,
        longitude:             longitude ?? null,
        timezone:              timezone || 'America/New_York',
        stationCount:          registers,
        monthlyRatePerStation: monthly,   // store total (not per-register) for fast retrieval
        pos:                   pos ?? undefined,
      },
    });

    logAudit(req, 'create', 'store', store.id, {
      name: store.name,
      address: store.address ?? null,
      timezone: store.timezone,
      stationCount: registers,
      monthlyTotal: monthly,
    });

    res.status(201).json({
      ...stripCredentials(store as StoreWithExtras),
      monthlyTotal: monthly,
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/stores ─────────────────────────────────────────────────────── */
export const getStores = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Superadmin with X-Tenant-Id override → just that one org.
    if (req.user?.role === 'superadmin' && req.headers['x-tenant-id']) {
      const stores = await prisma.store.findMany({
        where: { orgId: req.orgId as string, isActive: true },
        orderBy: { createdAt: 'asc' },
        include: { organization: { select: { id: true, name: true, slug: true } } },
      }) as unknown as StoreWithExtras[];
      res.json(stores.map(toResponseStore));
      return;
    }

    // Regular user: union of (a) all orgs they have UserOrg membership in,
    // and (b) stores they have direct UserStore access to. The frontend's
    // StoreSwitcher uses this single response to show stores from every
    // organisation the user belongs to — single login, multi-org access.
    const membershipOrgIds: string[] = (req.orgIds && req.orgIds.length > 0)
      ? req.orgIds
      : (req.user?.orgId ? [req.user.orgId] : []); // legacy fallback

    const directStoreIds: string[] = req.storeIds ?? [];

    // If the user has neither memberships nor direct stores, fall back to
    // the stores they own (for the onboarding window where the org exists
    // but UserOrg hasn't been written yet).
    const orConditions: Prisma.StoreWhereInput[] = [];
    if (membershipOrgIds.length) orConditions.push({ orgId:    { in: membershipOrgIds } });
    if (directStoreIds.length)   orConditions.push({ id:       { in: directStoreIds  } });
    if (!orConditions.length)    orConditions.push({ ownerId:  req.user!.id });

    const stores = await prisma.store.findMany({
      where: { OR: orConditions, isActive: true },
      orderBy: [{ orgId: 'asc' }, { createdAt: 'asc' }],
      include: { organization: { select: { id: true, name: true, slug: true } } },
    }) as unknown as StoreWithExtras[];

    res.json(stores.map(toResponseStore));
  } catch (err) {
    next(err);
  }
};

// Shape a Store row for the response: strip POS credentials, add legacy
// `_id` alias, compute monthly fee, surface the org name for the switcher.
function toResponseStore(s: StoreWithExtras) {
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
export const getStoreById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const where: Prisma.StoreWhereInput = req.orgId
      ? { id: req.params.id, orgId: req.orgId }
      : { id: req.params.id, ownerId: req.user!.id };

    const store = await prisma.store.findFirst({ where });
    if (!store) { res.status(404).json({ error: 'Store not found.' }); return; }

    res.json(stripCredentials(store as StoreWithExtras));
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/stores/:id ─────────────────────────────────────────────────── */
export const updateStore = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isOwnerOrAdmin(req)) {
      res.status(403).json({ error: 'Insufficient permissions to update a store.' });
      return;
    }

    const updates: Record<string, unknown> = Object.fromEntries(
      Object.entries(req.body as Record<string, unknown>).filter(([k]) => ALLOWED_FIELDS.includes(k)),
    );

    // Recalculate monthly total when register count changes
    if (updates.stationCount != null) {
      const sc = Math.max(1, parseInt(String(updates.stationCount)) || 1);
      updates.stationCount          = sc;
      updates.monthlyRatePerStation = calcStoreMonthly(sc);
    }

    const where: Prisma.StoreWhereInput = req.orgId
      ? { id: req.params.id, orgId: req.orgId }
      : { id: req.params.id, ownerId: req.user!.id };

    const existing = await prisma.store.findFirst({ where });
    if (!existing) { res.status(404).json({ error: 'Store not found.' }); return; }

    const store = await prisma.store.update({
      where: { id: existing.id },
      data: updates as Prisma.StoreUpdateInput,
    });

    const diff = computeDiff(existing as unknown as Record<string, unknown>, updates);
    if (hasChanges(diff)) {
      logAudit(req, 'update', 'store', store.id, { name: store.name, changes: diff });
    }

    res.json(stripCredentials(store as StoreWithExtras));
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/stores/:id  (soft deactivate) ───────────────────────────── */
export const deactivateStore = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isOwnerOrAdmin(req)) {
      res.status(403).json({ error: 'Insufficient permissions.' });
      return;
    }

    const where: Prisma.StoreWhereInput = req.orgId
      ? { id: req.params.id, orgId: req.orgId }
      : { id: req.params.id, ownerId: req.user!.id };

    const existing = await prisma.store.findFirst({ where });
    if (!existing) { res.status(404).json({ error: 'Store not found.' }); return; }

    const store = await prisma.store.update({
      where: { id: existing.id },
      data: { isActive: false },
    });

    logAudit(req, 'delete', 'store', store.id, { name: store.name, reason: 'deactivated' });

    res.json({ message: 'Store deactivated.', store: stripCredentials(store as StoreWithExtras) });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/stores/:id/branding ─────────────────────────────────────────── */
export const getStoreBranding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const store = await prisma.store.findFirst({
      where: { id: req.params.id, orgId: req.orgId as string },
      select: { id: true, name: true, branding: true },
    });
    if (!store) { res.status(404).json({ error: 'Store not found' }); return; }
    res.json({ storeName: store.name, ...((store.branding as Record<string, unknown>) || {}) });
  } catch (err) { next(err); }
};

interface BrandingBody {
  theme?: string;
  primaryColor?: string;
  logoText?: string;
  storeAddress?: string;
  storePhone?: string;
  storeEmail?: string;
  storeWebsite?: string;
  storeTaxId?: string;
  taxIdLabel?: string;
  receiptHeaderLine1?: string;
  receiptHeaderLine2?: string;
  receiptShowCashier?: boolean;
  receiptShowTransactionId?: boolean;
  receiptShowItemCount?: boolean;
  receiptShowTaxBreakdown?: boolean;
  receiptShowSavings?: boolean;
  receiptFooterLine1?: string;
  receiptFooterLine2?: string;
  receiptShowReturnPolicy?: boolean;
  receiptReturnPolicy?: string;
  receiptPaperWidth?: string;
  receiptPrintBehavior?: string;
}

/* ── PUT /api/stores/:id/branding ─────────────────────────────────────────── */
export const updateStoreBranding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isOwnerOrAdmin(req)) { res.status(403).json({ error: 'Forbidden' }); return; }
    const body = req.body as BrandingBody;
    const {
      theme, primaryColor, logoText,
      storeAddress, storePhone, storeEmail, storeWebsite,
      storeTaxId, taxIdLabel,
      receiptHeaderLine1, receiptHeaderLine2,
      receiptShowCashier, receiptShowTransactionId, receiptShowItemCount,
      receiptShowTaxBreakdown, receiptShowSavings,
      receiptFooterLine1, receiptFooterLine2,
      receiptShowReturnPolicy, receiptReturnPolicy,
      receiptPaperWidth,
    } = body;

    // Get existing branding to merge (preserve fields not sent)
    const existing = await prisma.store.findFirst({
      where: { id: req.params.id },
      select: { branding: true },
    });
    const prev: Record<string, unknown> = (existing?.branding && typeof existing.branding === 'object')
      ? (existing.branding as Record<string, unknown>)
      : {};

    const branding = {
      ...prev,
      // POS UI branding
      theme:        ['light', 'dark'].includes(theme || '') ? theme : (prev.theme || 'dark'),
      primaryColor: primaryColor && /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : (prev.primaryColor || '#7ac143'),
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
      receiptPaperWidth: ['80mm', '58mm'].includes(receiptPaperWidth || '') ? receiptPaperWidth : (prev.receiptPaperWidth || '80mm'),
      // Print behaviour: 'always' | 'ask' | 'never'
      receiptPrintBehavior: ['always','ask','never'].includes(body.receiptPrintBehavior || '')
        ? body.receiptPrintBehavior
        : (prev.receiptPrintBehavior || 'always'),
    };

    const store = await prisma.store.update({
      where: { id: req.params.id },
      data:  { branding: branding as Prisma.InputJsonValue },
    });

    // Diff branding subkeys so the audit log captures exactly which receipt /
    // logo / store-info field changed. `publishedAt` always changes on save —
    // strip it so an unchanged branding save doesn't write an audit row.
    const { publishedAt: _prevTs, ...prevForDiff } = prev;
    const { publishedAt: _newTs, ...newForDiff } = branding as Record<string, unknown>;
    const diff = computeDiff(prevForDiff, newForDiff);
    if (hasChanges(diff)) {
      logAudit(req, 'update', 'store_branding', store.id, {
        storeName: store.name,
        changes: diff,
      });
    }

    res.json(stripCredentials(store as StoreWithExtras));
  } catch (err) { next(err); }
};

/* ── GET /api/stores/billing-summary ─────────────────────────────────────── */
export const getBillingSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.orgId) {
      res.status(403).json({ error: 'No organisation context.' });
      return;
    }

    const stores = await prisma.store.findMany({
      where: { orgId: req.orgId, isActive: true },
      select: { id: true, name: true, stationCount: true, monthlyRatePerStation: true },
    });

    type StoreSummaryRow = { id: string; name: string; stationCount: number | null; monthlyRatePerStation: Prisma.Decimal | number | null };

    const rows = stores.map((s: StoreSummaryRow) => {
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

    type SummaryRow = (typeof rows)[number];
    const totalStations = rows.reduce((sum: number, r: SummaryRow) => sum + r.stationCount, 0);
    const totalMonthly  = rows.reduce((sum: number, r: SummaryRow) => sum + r.monthlyTotal, 0);
    const totalAnnual   = totalMonthly * 12;

    res.json({ stores: rows, totalStations, totalMonthly, totalAnnual });
  } catch (err) {
    next(err);
  }
};
