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

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: hashed,
        // orgId is required — signup without org creates a pending account
        // The org can be created / linked separately via the onboarding flow.
        // For now we require orgId in the body or default to a placeholder.
        orgId: req.body.orgId ?? 'pending',
      },
    });

    res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
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

    res.json({
      id:               user.id,
      _id:              user.id,   // legacy alias for frontend compatibility
      name:             user.name,
      email:            user.email,
      phone:            user.phone,
      role:             user.role,
      orgId:            user.orgId,
      tenantId:         user.orgId, // legacy alias used by Onboarding page
      marktPOSUsername: user.marktPOSUsername,
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
