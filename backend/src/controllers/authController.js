import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import prisma from '../config/postgres.js';

// ── Token generation ──────────────────────────────────────────────────────────
const generateToken = (id, extra = {}) =>
  jwt.sign({ id, ...extra }, process.env.JWT_SECRET, { expiresIn: '30d' });

// ── @desc    Register user
// ── @route   POST /api/auth/signup
// ── @access  Public
export const signup = async (req, res, next) => {
  try {
    const { name, email, phone, password } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashed = await bcrypt.hash(password, 12);

    // All new signups start under a placeholder org (role = 'staff').
    // The role is promoted to 'owner' in POST /api/tenants when the user creates their organisation.
    // Find or create a default placeholder org for new signups.
    let defaultOrg = await prisma.organization.findFirst({ where: { slug: 'default' } });
    if (!defaultOrg) {
      defaultOrg = await prisma.organization.create({
        data: { name: 'Default', slug: 'default', plan: 'trial', isActive: true },
      });
    }

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: hashed,
        orgId:    defaultOrg.id,
        role:     'staff',
        status:   'pending',   // public signups require superadmin approval
      },
    });

    // Return JWT so user can complete onboarding (org + store setup).
    // The protect middleware will allow pending users to access onboarding endpoints only.
    res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      token: generateToken(user.id, { name: user.name, email: user.email, role: user.role }),
    });
  } catch (error) {
    next(error);
  }
};

// ── @desc    Authenticate user
// ── @route   POST /api/auth/login
// ── @access  Public
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check user account status
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending approval. Please wait for an administrator to activate your account.' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });
    }

    res.json({
      id:               user.id,
      _id:              user.id,   // legacy alias for frontend compatibility
      name:             user.name,
      email:            user.email,
      phone:            user.phone,
      role:             user.role,
      status:           user.status,
      orgId:            user.orgId,
      tenantId:         user.orgId, // legacy alias used by Onboarding page
      token: generateToken(user.id, { name: user.name, email: user.email, role: user.role }),
    });
  } catch (error) {
    next(error);
  }
};

// ── @desc    Forgot password (stub — wire up email sender when ready)
// ── @route   POST /api/auth/forgot-password
// ── @access  Public
export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // TODO: generate reset token, store hash + expiry, send email
    res.json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (error) {
    next(error);
  }
};

// ── @desc    Lookup account by phone number
// ── @route   POST /api/auth/phone-lookup
// ── @access  Public
export const phoneLookup = async (req, res, next) => {
  try {
    const { phone } = req.body;
    const user = await prisma.user.findFirst({ where: { phone } });

    if (!user) {
      return res.status(404).json({ error: 'Account with this phone number not found' });
    }

    res.json({ name: user.name, email: user.email, phone: user.phone });
  } catch (error) {
    next(error);
  }
};
