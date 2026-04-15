/**
 * customerController.js
 *
 * Full CRUD for the Customer model.
 * All routes are org-scoped via req.orgId (set by protect → scopeToTenant).
 *
 * Routes (see customerRoutes.js):
 *   GET    /api/customers           — paginated list; supports q, name, phone, email
 *   GET    /api/customers/:id       — single customer
 *   POST   /api/customers           — create
 *   PUT    /api/customers/:id       — update
 *   DELETE /api/customers/:id       — soft-delete (deleted=true)
 *   POST   /api/customers/check-points — phone-based loyalty lookup
 */

import bcrypt from 'bcryptjs';
import prisma from '../config/postgres.js';
import { validateEmail, validatePhone, parsePrice } from '../utils/validators.js';

/**
 * Normalize a phone number to an E.164-ish canonical form for storage.
 * Strips spaces, dashes, parens, dots. Keeps leading '+'.
 * Returns null for empty/invalid input.
 */
function normalizePhone(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[\s\-().]/g, '');
  if (!/^\+?[0-9]{7,15}$/.test(cleaned)) return null;
  return cleaned;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a combined name from first+last if a standalone name wasn't supplied */
const buildName = ({ name, firstName, lastName }) => {
  if (name) return name.trim() || null;
  const parts = [firstName, lastName].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
};

/** Safely parse a decimal that may be null/undefined */
const dec = (v) => (v != null && v !== '' ? parseFloat(v) : null);

/** Safely parse an integer */
const int = (v, fallback = 0) => (v != null && v !== '' ? parseInt(v) : fallback);

// ── GET /api/customers ────────────────────────────────────────────────────────

export const getCustomers = async (req, res, next) => {
  try {
    const { q, name, phone, email, page = 1, limit = 50 } = req.query;
    const search = (q || name || '').trim();
    const skip   = (parseInt(page) - 1) * parseInt(limit);

    const where = { orgId: req.orgId, deleted: false };

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
        take: parseInt(limit),
      }),
      prisma.customer.count({ where }),
    ]);

    res.json({
      customers,
      total,
      page:       parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/customers/:id ────────────────────────────────────────────────────

export const getCustomerById = async (req, res, next) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (err) {
    next(err);
  }
};

// ── POST /api/customers ───────────────────────────────────────────────────────

export const createCustomer = async (req, res, next) => {
  try {
    const {
      firstName, lastName, name,
      email, phone, cardNo, password,
      loyaltyPoints, discount, balance, balanceLimit,
      instoreChargeEnabled, birthDate, expirationDate,
    } = req.body;

    // ── Validation ─────────────────────────────────────────────────────────
    // Email/phone are optional but when supplied must be well-formed.
    if (email) {
      const emailErr = validateEmail(email);
      if (emailErr) return res.status(400).json({ error: emailErr });
    }
    let normalizedPhone = null;
    if (phone) {
      const phoneErr = validatePhone(phone);
      if (phoneErr) return res.status(400).json({ error: phoneErr });
      normalizedPhone = normalizePhone(phone);
      if (!normalizedPhone) return res.status(400).json({ error: 'Invalid phone format' });
    }
    // Parse monetary fields defensively — reject NaN/Infinity/scientific notation.
    const discountP = parsePrice(discount, { min: 0, max: 100 });
    if (!discountP.ok) return res.status(400).json({ error: `discount: ${discountP.error}` });
    const balanceP = parsePrice(balance, { min: -999999, max: 999999 });
    if (!balanceP.ok) return res.status(400).json({ error: `balance: ${balanceP.error}` });
    const balanceLimitP = parsePrice(balanceLimit, { min: 0, max: 999999 });
    if (!balanceLimitP.ok) return res.status(400).json({ error: `balanceLimit: ${balanceLimitP.error}` });

    const displayName = buildName({ name, firstName, lastName });

    // Hash password if provided (enables storefront login)
    let passwordHash = null;
    if (password && password.length >= 6) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const customer = await prisma.customer.create({
      data: {
        orgId:               req.orgId,
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
        birthDate:           birthDate       ? new Date(birthDate)       : null,
        expirationDate:      expirationDate  ? new Date(expirationDate)  : null,
      },
    });

    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
};

// ── PUT /api/customers/:id ────────────────────────────────────────────────────

export const updateCustomer = async (req, res, next) => {
  try {
    const existing = await prisma.customer.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
    });
    if (!existing) return res.status(404).json({ error: 'Customer not found' });

    const {
      firstName, lastName, name,
      email, phone, cardNo, password,
      loyaltyPoints, discount, balance, balanceLimit,
      instoreChargeEnabled, birthDate, expirationDate,
    } = req.body;

    // Build patch — only overwrite fields that were actually sent
    const data = {};

    // Name: recompute if any name field supplied
    const nameProvided = name !== undefined || firstName !== undefined || lastName !== undefined;
    if (nameProvided) {
      data.name      = buildName({
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
        if (emailErr) return res.status(400).json({ error: emailErr });
        data.email = email.trim().toLowerCase();
      } else {
        data.email = null;
      }
    }
    if (phone               !== undefined) {
      if (phone) {
        const phoneErr = validatePhone(phone);
        if (phoneErr) return res.status(400).json({ error: phoneErr });
        const normalized = normalizePhone(phone);
        if (!normalized) return res.status(400).json({ error: 'Invalid phone format' });
        data.phone = normalized;
      } else {
        data.phone = null;
      }
    }
    if (cardNo              !== undefined) data.cardNo              = cardNo   || null;
    if (loyaltyPoints       !== undefined) data.loyaltyPoints       = int(loyaltyPoints, existing.loyaltyPoints);
    if (discount            !== undefined) {
      const p = parsePrice(discount, { min: 0, max: 100 });
      if (!p.ok) return res.status(400).json({ error: `discount: ${p.error}` });
      data.discount = p.value;
    }
    if (balance             !== undefined) {
      const p = parsePrice(balance, { min: -999999, max: 999999 });
      if (!p.ok) return res.status(400).json({ error: `balance: ${p.error}` });
      data.balance = p.value;
    }
    if (balanceLimit        !== undefined) {
      const p = parsePrice(balanceLimit, { min: 0, max: 999999 });
      if (!p.ok) return res.status(400).json({ error: `balanceLimit: ${p.error}` });
      data.balanceLimit = p.value;
    }
    if (instoreChargeEnabled !== undefined)
      data.instoreChargeEnabled =
        instoreChargeEnabled === true || instoreChargeEnabled === 'true';
    if (birthDate           !== undefined)
      data.birthDate = birthDate ? new Date(birthDate) : null;
    if (expirationDate      !== undefined)
      data.expirationDate = expirationDate ? new Date(expirationDate) : null;

    // Hash new password if provided (enables/updates storefront login)
    if (password && password.length >= 6) {
      data.passwordHash = await bcrypt.hash(password, 10);
    }

    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data,
    });

    res.json(customer);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/customers/:id  (soft delete) ──────────────────────────────────

export const deleteCustomer = async (req, res, next) => {
  try {
    const existing = await prisma.customer.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
    });
    if (!existing) return res.status(404).json({ error: 'Customer not found' });

    await prisma.customer.update({
      where: { id: req.params.id },
      data:  { deleted: true },
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/customers/check-points ─────────────────────────────────────────

export const checkPoints = async (req, res, next) => {
  try {
    const { phone } = req.body;
    const customer = await prisma.customer.findFirst({
      where: { phone, orgId: req.orgId, deleted: false },
    });
    if (!customer) {
      return res.status(404).json({ error: 'Customer with this phone number not found' });
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
