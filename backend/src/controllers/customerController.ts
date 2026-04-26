/**
 * customerController.ts
 *
 * Full CRUD for the Customer model.
 * All routes are org-scoped via req.orgId (set by protect → scopeToTenant).
 *
 * Routes (see customerRoutes.ts):
 *   GET    /api/customers           — paginated list; supports q, name, phone, email
 *   GET    /api/customers/:id       — single customer
 *   POST   /api/customers           — create
 *   PUT    /api/customers/:id       — update
 *   DELETE /api/customers/:id       — soft-delete (deleted=true)
 *   POST   /api/customers/check-points — phone-based loyalty lookup
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import prisma from '../config/postgres.js';
import { validateEmail, validatePhone, parsePrice } from '../utils/validators.js';
import { tryParseDate } from '../utils/safeDate.js';
import { logAudit } from '../services/auditService.js';
import { awardWelcomeBonus } from '../services/loyaltyService.js';

/**
 * Normalize a phone number to an E.164-ish canonical form for storage.
 */
function normalizePhone(raw: unknown): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[\s\-().]/g, '');
  if (!/^\+?[0-9]{7,15}$/.test(cleaned)) return null;
  return cleaned;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface NameInput { name?: string | null; firstName?: string | null; lastName?: string | null }

/** Build a combined name from first+last if a standalone name wasn't supplied */
const buildName = ({ name, firstName, lastName }: NameInput): string | null => {
  if (name) return name.trim() || null;
  const parts = [firstName, lastName].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
};

/** Safely parse an integer */
const int = (v: unknown, fallback: number = 0): number =>
  (v != null && v !== '' ? parseInt(String(v)) : fallback);

// ── GET /api/customers ────────────────────────────────────────────────────────

export const getCustomers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { q, name, phone, email, page = 1, limit = 50 } = req.query as {
      q?: string; name?: string; phone?: string; email?: string;
      page?: string | number; limit?: string | number;
    };
    const search = (q || name || '').trim();
    const skip   = (parseInt(String(page)) - 1) * parseInt(String(limit));

    const where: Prisma.CustomerWhereInput = { orgId: req.orgId as string, deleted: false };

    if (search) {
      where.OR = [
        { name:      { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName:  { contains: search, mode: 'insensitive' } },
        { phone:     { contains: search } },
        { email:     { contains: search, mode: 'insensitive' } },
        { cardNo:    { contains: search } },
      ];
    } else {
      if (phone) where.phone = { contains: phone };
      if (email) where.email = { contains: email, mode: 'insensitive' };
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: [{ name: 'asc' }, { firstName: 'asc' }],
        skip,
        take: parseInt(String(limit)),
      }),
      prisma.customer.count({ where }),
    ]);

    res.json({
      customers,
      total,
      page:       parseInt(String(page)),
      totalPages: Math.ceil(total / parseInt(String(limit))),
    });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/customers/:id ────────────────────────────────────────────────────

export const getCustomerById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, orgId: req.orgId as string },
    });
    if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }
    res.json(customer);
  } catch (err) {
    next(err);
  }
};

interface CustomerBody {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  cardNo?: string | null;
  password?: string;
  loyaltyPoints?: number | string;
  discount?: number | string | null;
  balance?: number | string | null;
  balanceLimit?: number | string | null;
  instoreChargeEnabled?: boolean | string;
  birthDate?: string | Date | null;
  expirationDate?: string | Date | null;
}

// ── POST /api/customers ───────────────────────────────────────────────────────

export const createCustomer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      firstName, lastName, name,
      email, phone, cardNo, password,
      loyaltyPoints, discount, balance, balanceLimit,
      instoreChargeEnabled, birthDate, expirationDate,
    } = req.body as CustomerBody;

    // ── Validation ─────────────────────────────────────────────────────────
    if (email) {
      const emailErr = validateEmail(email);
      if (emailErr) { res.status(400).json({ error: emailErr }); return; }
    }
    let normalizedPhone: string | null = null;
    if (phone) {
      const phoneErr = validatePhone(phone);
      if (phoneErr) { res.status(400).json({ error: phoneErr }); return; }
      normalizedPhone = normalizePhone(phone);
      if (!normalizedPhone) { res.status(400).json({ error: 'Invalid phone format' }); return; }
    }
    const discountP = parsePrice(discount, { min: 0, max: 100 });
    if (!discountP.ok) { res.status(400).json({ error: `discount: ${discountP.error}` }); return; }
    const balanceP = parsePrice(balance, { min: -999999, max: 999999 });
    if (!balanceP.ok) { res.status(400).json({ error: `balance: ${balanceP.error}` }); return; }
    const balanceLimitP = parsePrice(balanceLimit, { min: 0, max: 999999 });
    if (!balanceLimitP.ok) { res.status(400).json({ error: `balanceLimit: ${balanceLimitP.error}` }); return; }

    const bd = tryParseDate(res, birthDate,      'birthDate');      if (!bd.ok) return;
    const ed = tryParseDate(res, expirationDate, 'expirationDate'); if (!ed.ok) return;

    const displayName = buildName({ name, firstName, lastName });

    // Hash password if provided (enables storefront login)
    let passwordHash: string | null = null;
    if (password && password.length >= 6) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const customer = await prisma.customer.create({
      data: {
        orgId:               req.orgId as string,
        storeId:             req.storeId || null,
        name:                displayName,
        firstName:           firstName        || null,
        lastName:            lastName         || null,
        email:               email ? email.trim().toLowerCase() : null,
        phone:               normalizedPhone,
        cardNo:              cardNo           || null,
        passwordHash,
        loyaltyPoints:       int(loyaltyPoints, 0),
        discount:            discountP.value,
        balance:             balanceP.value,
        balanceLimit:        balanceLimitP.value,
        instoreChargeEnabled:
          instoreChargeEnabled === true || instoreChargeEnabled === 'true',
        birthDate:           bd.value,
        expirationDate:      ed.value,
      },
    });

    logAudit(req, 'create', 'customer', customer.id, {
      name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.email || customer.phone,
      email: customer.email, phone: customer.phone,
    });

    if (!loyaltyPoints && customer.storeId) {
      try {
        const awarded = await awardWelcomeBonus({
          orgId: req.orgId as string, customerId: customer.id, storeId: customer.storeId,
        });
        if (awarded > 0) {
          const fresh = await prisma.customer.findUnique({ where: { id: customer.id } });
          res.status(201).json(fresh);
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[loyalty] welcome bonus error:', message);
      }
    }

    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
};

// ── PUT /api/customers/:id ────────────────────────────────────────────────────

export const updateCustomer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const existing = await prisma.customer.findFirst({
      where: { id: req.params.id, orgId: req.orgId as string },
    });
    if (!existing) { res.status(404).json({ error: 'Customer not found' }); return; }

    const {
      firstName, lastName, name,
      email, phone, cardNo, password,
      loyaltyPoints, discount, balance, balanceLimit,
      instoreChargeEnabled, birthDate, expirationDate,
    } = req.body as CustomerBody;

    // Build patch — only overwrite fields that were actually sent
    const data: Prisma.CustomerUpdateInput = {};

    // Name: recompute if any name field supplied
    const nameProvided = name !== undefined || firstName !== undefined || lastName !== undefined;
    if (nameProvided) {
      data.name = buildName({
        name,
        firstName: firstName ?? existing.firstName,
        lastName:  lastName  ?? existing.lastName,
      });
      if (firstName !== undefined) data.firstName = firstName || null;
      if (lastName  !== undefined) data.lastName  = lastName  || null;
    }

    if (email               !== undefined) {
      if (email) {
        const emailErr = validateEmail(email);
        if (emailErr) { res.status(400).json({ error: emailErr }); return; }
        data.email = email.trim().toLowerCase();
      } else {
        data.email = null;
      }
    }
    if (phone               !== undefined) {
      if (phone) {
        const phoneErr = validatePhone(phone);
        if (phoneErr) { res.status(400).json({ error: phoneErr }); return; }
        const normalized = normalizePhone(phone);
        if (!normalized) { res.status(400).json({ error: 'Invalid phone format' }); return; }
        data.phone = normalized;
      } else {
        data.phone = null;
      }
    }
    if (cardNo              !== undefined) data.cardNo              = cardNo   || null;
    if (loyaltyPoints       !== undefined) data.loyaltyPoints       = int(loyaltyPoints, existing.loyaltyPoints);
    if (discount            !== undefined) {
      const p = parsePrice(discount, { min: 0, max: 100 });
      if (!p.ok) { res.status(400).json({ error: `discount: ${p.error}` }); return; }
      data.discount = p.value;
    }
    if (balance             !== undefined) {
      const p = parsePrice(balance, { min: -999999, max: 999999 });
      if (!p.ok) { res.status(400).json({ error: `balance: ${p.error}` }); return; }
      data.balance = p.value;
    }
    if (balanceLimit        !== undefined) {
      const p = parsePrice(balanceLimit, { min: 0, max: 999999 });
      if (!p.ok) { res.status(400).json({ error: `balanceLimit: ${p.error}` }); return; }
      data.balanceLimit = p.value;
    }
    if (instoreChargeEnabled !== undefined)
      data.instoreChargeEnabled =
        instoreChargeEnabled === true || instoreChargeEnabled === 'true';
    if (birthDate !== undefined) {
      const r = tryParseDate(res, birthDate, 'birthDate'); if (!r.ok) return;
      data.birthDate = r.value;
    }
    if (expirationDate !== undefined) {
      const r = tryParseDate(res, expirationDate, 'expirationDate'); if (!r.ok) return;
      data.expirationDate = r.value;
    }

    // Hash new password if provided (enables/updates storefront login)
    if (password && password.length >= 6) {
      data.passwordHash = await bcrypt.hash(password, 10);
    }

    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data,
    });

    // Emit field-level before/after diff so the audit log shows what changed.
    try {
      const diff: Record<string, { before: unknown; after: unknown }> = {};
      const existingRec = existing as unknown as Record<string, unknown>;
      const dataRec = data as unknown as Record<string, unknown>;
      for (const k of Object.keys(dataRec)) {
        if (k === 'passwordHash') { diff[k] = { before: '***', after: '***' }; continue; }
        const before = existingRec[k];
        const after  = dataRec[k];
        const same = (before == null && after == null) || String(before ?? '') === String(after ?? '');
        if (!same) diff[k] = { before, after };
      }
      if (Object.keys(diff).length > 0) {
        logAudit(req, 'update', 'customer', customer.id, {
          name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.email,
          changes: diff,
        });
      }
    } catch { /* ignore audit-log emission errors */ }

    res.json(customer);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/customers/:id  (soft delete) ──────────────────────────────────

export const deleteCustomer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const existing = await prisma.customer.findFirst({
      where: { id: req.params.id, orgId: req.orgId as string },
    });
    if (!existing) { res.status(404).json({ error: 'Customer not found' }); return; }

    await prisma.customer.update({
      where: { id: req.params.id },
      data:  { deleted: true },
    });

    logAudit(req, 'delete', 'customer', req.params.id, {
      name: `${existing.firstName || ''} ${existing.lastName || ''}`.trim() || existing.email || existing.phone,
      email: existing.email, phone: existing.phone,
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/customers/check-points ─────────────────────────────────────────

export const checkPoints = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { phone } = req.body as { phone?: string };
    const customer = await prisma.customer.findFirst({
      where: { phone, orgId: req.orgId as string, deleted: false },
    });
    if (!customer) {
      res.status(404).json({ error: 'Customer with this phone number not found' });
      return;
    }
    res.json({
      name:          customer.name,
      phone:         customer.phone,
      loyaltyPoints: customer.loyaltyPoints,
      pointsHistory: customer.pointsHistory,
    });
  } catch (err) {
    next(err);
  }
};
