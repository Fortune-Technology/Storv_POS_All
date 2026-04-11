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
        email:               email            || null,
        phone:               phone            || null,
        cardNo:              cardNo           || null,
        passwordHash,
        loyaltyPoints:       int(loyaltyPoints, 0),
        discount:            dec(discount),
        balance:             dec(balance),
        balanceLimit:        dec(balanceLimit),
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

    if (email               !== undefined) data.email               = email    || null;
    if (phone               !== undefined) data.phone               = phone    || null;
    if (cardNo              !== undefined) data.cardNo              = cardNo   || null;
    if (loyaltyPoints       !== undefined) data.loyaltyPoints       = int(loyaltyPoints, existing.loyaltyPoints);
    if (discount            !== undefined) data.discount            = dec(discount);
    if (balance             !== undefined) data.balance             = dec(balance);
    if (balanceLimit        !== undefined) data.balanceLimit        = dec(balanceLimit);
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
