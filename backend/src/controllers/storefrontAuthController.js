/**
 * Storefront Auth Controller
 * Server-to-server endpoints called by ecom-backend.
 * Uses the POS Customer table as single source of truth.
 * No POS JWT middleware — secured by server-to-server trust (same as ecom-stock-check).
 */

import bcrypt from 'bcryptjs';
import prisma from '../config/postgres.js';

// ── Signup ───────────────────────────────────────────────────────────────────

export const signup = async (req, res) => {
  try {
    const { orgId, storeId, email, password, firstName, lastName, name, phone } = req.body;

    if (!orgId || !storeId) {
      return res.status(400).json({ error: 'orgId and storeId are required' });
    }
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const emailLower = email.toLowerCase().trim();

    // Check for existing customer at this store
    const existing = await prisma.customer.findFirst({
      where: { orgId, storeId, email: emailLower, deleted: false },
    });

    if (existing) {
      if (existing.passwordHash) {
        // Already has an online account
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      // Existing POS customer claiming their online account — add password
      const passwordHash = await bcrypt.hash(password, 10);
      const updated = await prisma.customer.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          firstName: firstName || existing.firstName,
          lastName: lastName || existing.lastName,
          name: name || existing.name || `${firstName || ''} ${lastName || ''}`.trim(),
          phone: phone || existing.phone,
        },
      });

      return res.status(200).json({
        success: true,
        claimed: true,
        customer: sanitize(updated),
      });
    }

    // New customer — create with password
    const fName = firstName || (name ? name.split(' ')[0] : '');
    const lName = lastName || (name ? name.split(' ').slice(1).join(' ') : '');
    const passwordHash = await bcrypt.hash(password, 10);

    const customer = await prisma.customer.create({
      data: {
        orgId,
        storeId,
        email: emailLower,
        passwordHash,
        firstName: fName,
        lastName: lName,
        name: name || `${fName} ${lName}`.trim(),
        phone: phone || null,
      },
    });

    res.status(201).json({ success: true, customer: sanitize(customer) });
  } catch (err) {
    console.error('[storefront-auth] signup error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Login ────────────────────────────────────────────────────────────────────

export const login = async (req, res) => {
  try {
    const { orgId, storeId, email, password } = req.body;

    if (!orgId || !storeId || !email || !password) {
      return res.status(400).json({ error: 'orgId, storeId, email, and password are required' });
    }

    const customer = await prisma.customer.findFirst({
      where: { orgId, storeId, email: email.toLowerCase().trim(), deleted: false },
    });

    if (!customer || !customer.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, customer.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.json({ success: true, customer: sanitize(customer) });
  } catch (err) {
    console.error('[storefront-auth] login error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Get Profile ──────────────────────────────────────────────────────────────

export const getProfile = async (req, res) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.customerId, deleted: false },
    });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({ success: true, data: sanitize(customer) });
  } catch (err) {
    console.error('[storefront-auth] getProfile error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Update Profile ───────────────────────────────────────────────────────────

export const updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, name, phone, addresses } = req.body;
    const data = {};

    if (firstName !== undefined) data.firstName = firstName;
    if (lastName !== undefined) data.lastName = lastName;
    if (firstName !== undefined || lastName !== undefined) {
      data.name = `${firstName || ''} ${lastName || ''}`.trim();
    }
    if (name !== undefined && !firstName && !lastName) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (addresses !== undefined) data.addresses = addresses;

    const customer = await prisma.customer.update({
      where: { id: req.params.customerId },
      data,
    });

    res.json({ success: true, data: sanitize(customer) });
  } catch (err) {
    console.error('[storefront-auth] updateProfile error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Change Password ──────────────────────────────────────────────────────────

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const { customerId } = req.params;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, deleted: false },
    });

    if (!customer || !customer.passwordHash) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const valid = await bcrypt.compare(currentPassword, customer.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.customer.update({
      where: { id: customerId },
      data: { passwordHash },
    });

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('[storefront-auth] changePassword error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── List Customers (for portal management) ───────────────────────────────────

export const listCustomers = async (req, res) => {
  try {
    const { orgId, storeId, search, page: p, limit: l } = req.query;

    if (!orgId || !storeId) {
      return res.status(400).json({ error: 'orgId and storeId are required' });
    }

    const page = Math.max(1, parseInt(p) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(l) || 20));
    const skip = (page - 1) * limit;

    const where = { orgId, storeId, deleted: false, passwordHash: { not: null } };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, name: true, firstName: true, lastName: true,
          email: true, phone: true, loyaltyPoints: true,
          addresses: true, createdAt: true,
        },
      }),
      prisma.customer.count({ where }),
    ]);

    res.json({ success: true, data: customers, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[storefront-auth] listCustomers error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Customer Count (for analytics) ──────────────────────────────────────────

export const countCustomers = async (req, res) => {
  try {
    const { orgId, storeId } = req.query;
    if (!orgId || !storeId) {
      return res.status(400).json({ error: 'orgId and storeId required' });
    }

    const count = await prisma.customer.count({
      where: { orgId, storeId, deleted: false, passwordHash: { not: null } },
    });

    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitize(customer) {
  return {
    id: customer.id,
    orgId: customer.orgId,
    storeId: customer.storeId,
    name: customer.name,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    addresses: customer.addresses,
    loyaltyPoints: customer.loyaltyPoints,
    discount: customer.discount,
    balance: customer.balance,
    createdAt: customer.createdAt,
  };
}
