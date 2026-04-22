import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../config/postgres.js';
import { sendForgotPassword, sendNewSignupNotifyAdmin, sendPasswordChanged } from '../services/emailService.js';
import { validateEmail, validatePassword, validatePhone, runValidators } from '../utils/validators.js';
import { computeUserPermissions, syncUserDefaultRole } from '../rbac/permissionService.js';
import { logAudit } from '../services/auditService.js';

// ── Token generation ──────────────────────────────────────────────────────────
// Short-lived access token. A 30-day token combined with XSS or leaked
// localStorage results in long-lived account takeover. Keep access tokens
// short and rely on frontend re-login / (future) refresh token rotation.
const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_TTL || '2h';
const generateToken = (id, extra = {}) =>
  jwt.sign({ id, ...extra }, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });

// ── @desc    Register user
// ── @route   POST /api/auth/signup
// ── @access  Public
export const signup = async (req, res, next) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const vErr = runValidators([
      validateEmail(email),
      validatePassword(password),
      validatePhone(phone),
    ]);
    if (vErr) return res.status(400).json({ error: vErr });

    const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
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
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone ? phone.trim() : null,
        password: hashed,
        orgId:    defaultOrg.id,
        role:     'staff',
        status:   'pending',   // public signups require superadmin approval
      },
    });

    // Auto-assign the default system role (staff) to the new user
    await syncUserDefaultRole(user.id).catch(err => console.warn('syncUserDefaultRole:', err.message));

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
      token: generateToken(user.id, { name: user.name, email: user.email, role: user.role, orgId: user.orgId }),
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
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      // Synthesize a minimal req-shape so logAudit can still record the attempt
      await logAudit(
        { user: { id: 'anonymous', name: normalizedEmail, email: normalizedEmail }, orgId: 'unknown', ip: req.ip, headers: req.headers },
        'login_failed', 'auth', null,
        { email: normalizedEmail, reason: 'user_not_found' }
      );
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await logAudit(
        { user: { id: user.id, name: user.name, email: user.email, role: user.role }, orgId: user.orgId || 'unknown', ip: req.ip, headers: req.headers },
        'login_failed', 'auth', user.id,
        { email: normalizedEmail, reason: 'bad_password' }
      );
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check user account status
    if (user.status === 'pending') {
      await logAudit(
        { user: { id: user.id, name: user.name, email: user.email, role: user.role }, orgId: user.orgId || 'unknown', ip: req.ip, headers: req.headers },
        'login_blocked', 'auth', user.id, { reason: 'pending_approval' }
      );
      return res.status(403).json({ error: 'Your account is pending approval. Please wait for an administrator to activate your account.' });
    }
    if (user.status === 'suspended') {
      await logAudit(
        { user: { id: user.id, name: user.name, email: user.email, role: user.role }, orgId: user.orgId || 'unknown', ip: req.ip, headers: req.headers },
        'login_blocked', 'auth', user.id, { reason: 'suspended' }
      );
      return res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });
    }

    const permissions = await computeUserPermissions(user);

    // Successful login
    await logAudit(
      { user: { id: user.id, name: user.name, email: user.email, role: user.role }, orgId: user.orgId || 'unknown', ip: req.ip, headers: req.headers },
      'login', 'auth', user.id,
      { email: user.email, role: user.role }
    );

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
      permissions,                  // effective permission keys (union of all roles)
      token: generateToken(user.id, { name: user.name, email: user.email, role: user.role, orgId: user.orgId }),
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

    // Silently ignore obviously invalid emails (no DB lookup — same response).
    if (validateEmail(email)) return res.json({ message: successMsg });

    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
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

    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });

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

    await logAudit(
      { user: { id: user.id, name: user.name, email: user.email, role: user.role }, orgId: user.orgId || 'unknown', ip: req.ip, headers: req.headers },
      'password_reset', 'auth', user.id,
      { method: 'reset_token' }
    );

    res.json({ message: 'Password has been reset successfully' });
  } catch (error) {
    next(error);
  }
};

// ── @desc    Verify the current user's password (used by InactivityLock unlock)
// ── @route   POST /api/auth/verify-password
// ── @access  Private (JWT required)
export const verifyPassword = async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Incorrect password' });
    res.json({ success: true });
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
