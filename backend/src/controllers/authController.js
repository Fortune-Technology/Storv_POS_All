import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../config/postgres.js';
import { sendForgotPassword, sendNewSignupNotifyAdmin, sendPasswordChanged } from '../services/emailService.js';

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

    // Notify admin of new signup (non-blocking)
    sendNewSignupNotifyAdmin(user.name, user.email);

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

// ── @desc    Forgot password — sends reset email
// ── @route   POST /api/auth/forgot-password
// ── @access  Public
export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    // Always return success to avoid email enumeration
    const successMsg = 'If that email is registered, a reset link has been sent.';

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json({ message: successMsg });

    // Generate token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: hashed,
        resetPasswordExpire: new Date(Date.now() + 30 * 60 * 1000), // 30 min
      },
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;
    sendForgotPassword(user.email, user.name, resetUrl);

    res.json({ message: successMsg });
  } catch (error) {
    next(error);
  }
};

// ── @desc    Reset password with token
// ── @route   POST /api/auth/reset-password
// ── @access  Public
export const resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });

    const hashed = crypto.createHash('sha256').update(token).digest('hex');

    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: hashed,
        resetPasswordExpire: { gt: new Date() },
      },
    });

    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });

    const newHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: newHash, resetPasswordToken: null, resetPasswordExpire: null },
    });

    sendPasswordChanged(user.email, user.name);

    res.json({ message: 'Password has been reset successfully' });
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
