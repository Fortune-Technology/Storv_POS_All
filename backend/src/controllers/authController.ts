import type { Request, Response, NextFunction } from 'express';
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
const generateToken = (id: string, extra: Record<string, unknown> = {}): string =>
  jwt.sign({ id, ...extra }, process.env.JWT_SECRET as string, { expiresIn: ACCESS_TOKEN_TTL } as jwt.SignOptions);

/**
 * Build a Request-shaped audit context from a non-protect-guarded path
 * (login failures, forgotPassword, etc.) so logAudit can still record.
 * Cast through `unknown as Request` because we're synthesising a partial.
 */
function auditCtx(req: Request, user: { id: string; name?: string | null; email?: string | null; role?: string | null } | null, orgId: string): Request {
  return {
    user: user ? { id: user.id, name: user.name, email: user.email, role: user.role } : { id: 'anonymous', name: null, email: null },
    orgId,
    ip: req.ip,
    headers: req.headers,
  } as unknown as Request;
}

interface SignupBody {
  name?: string;
  email?: string;
  phone?: string | null;
  password?: string;
}

// ── @desc    Register user
// ── @route   POST /api/auth/signup
// ── @access  Public
export const signup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, email, phone, password } = req.body as SignupBody;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    const vErr = runValidators([
      validateEmail(email),
      validatePassword(password),
      validatePhone(phone),
    ]);
    if (vErr) { res.status(400).json({ error: vErr }); return; }

    const existing = await prisma.user.findUnique({ where: { email: (email as string).trim().toLowerCase() } });
    if (existing) {
      res.status(400).json({ error: 'User already exists' });
      return;
    }

    const hashed = await bcrypt.hash(password as string, 12);

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
        name: (name as string).trim(),
        email: (email as string).trim().toLowerCase(),
        phone: phone ? phone.trim() : null,
        password: hashed,
        orgId:    defaultOrg.id,
        role:     'staff',
        status:   'pending',   // public signups require superadmin approval
      },
    });

    // Auto-assign the default system role (staff) to the new user
    await syncUserDefaultRole(user.id).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('syncUserDefaultRole:', message);
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
      // S77 — gate flags so the Signup page can route into the questionnaire.
      onboardingSubmitted: user.onboardingSubmitted,
      contractSigned:      user.contractSigned,
      vendorApproved:      user.vendorApproved,
      token: generateToken(user.id, { name: user.name, email: user.email, role: user.role, orgId: user.orgId }),
    });
  } catch (error) {
    next(error);
  }
};

// ── @desc    Authenticate user
// ── @route   POST /api/auth/login
// ── @access  Public
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      // Synthesize a minimal req-shape so logAudit can still record the attempt
      await logAudit(
        auditCtx(req, { id: 'anonymous', name: normalizedEmail, email: normalizedEmail }, 'unknown'),
        'login_failed', 'auth', null,
        { email: normalizedEmail, reason: 'user_not_found' },
      );
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await logAudit(
        auditCtx(req, { id: user.id, name: user.name, email: user.email, role: user.role }, user.orgId || 'unknown'),
        'login_failed', 'auth', user.id,
        { email: normalizedEmail, reason: 'bad_password' },
      );
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Check user account status.
    // S77 — pending users are NO LONGER blocked at login; they need to log
    // back in to reach the vendor onboarding wizard / awaiting screen. The
    // protect middleware still gates them away from the actual portal API.
    // Suspended users are still blocked here.
    if (user.status === 'pending') {
      await logAudit(
        auditCtx(req, { id: user.id, name: user.name, email: user.email, role: user.role }, user.orgId || 'unknown'),
        'login', 'auth', user.id,
        { email: user.email, role: user.role, note: 'pending_user_login' },
      );
      // Fall through and issue a token — the frontend ProtectedRoute will
      // redirect to /vendor-onboarding or /vendor-awaiting based on flags.
    }
    if (user.status === 'suspended') {
      await logAudit(
        auditCtx(req, { id: user.id, name: user.name, email: user.email, role: user.role }, user.orgId || 'unknown'),
        'login_blocked', 'auth', user.id, { reason: 'suspended' },
      );
      res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });
      return;
    }

    const permissions = await computeUserPermissions(user as Parameters<typeof computeUserPermissions>[0]);

    // Successful login
    await logAudit(
      auditCtx(req, { id: user.id, name: user.name, email: user.email, role: user.role }, user.orgId || 'unknown'),
      'login', 'auth', user.id,
      { email: user.email, role: user.role },
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
      // S77 — vendor onboarding gate flags. Frontend ProtectedRoute uses these
      // to redirect into the questionnaire / awaiting-review screens before
      // the portal is reachable.
      onboardingSubmitted: user.onboardingSubmitted,
      contractSigned:      user.contractSigned,
      vendorApproved:      user.vendorApproved,
      token: generateToken(user.id, { name: user.name, email: user.email, role: user.role, orgId: user.orgId }),
    });
  } catch (error) {
    next(error);
  }
};

// ── @desc    Forgot password — sends reset email
// ── @route   POST /api/auth/forgot-password
// ── @access  Public
export const forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, app } = req.body as { email?: string; app?: string };
    // Always return success to avoid email enumeration
    const successMsg = 'If that email is registered, a reset link has been sent.';

    // Silently ignore obviously invalid emails (no DB lookup — same response).
    if (validateEmail(email)) { res.json({ message: successMsg }); return; }

    const user = await prisma.user.findUnique({ where: { email: (email as string).trim().toLowerCase() } });
    if (!user) { res.json({ message: successMsg }); return; }

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

    // `app` selects the redirect target. 'admin' → admin-app, anything
    // else (default 'portal') → main portal. Superadmins reset through the
    // admin-app login page and should land back there.
    const isAdminApp = app === 'admin';
    const baseUrl = isAdminApp
      ? (process.env.ADMIN_URL || 'http://localhost:5175')
      : (process.env.FRONTEND_URL || 'http://localhost:5173');
    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;
    sendForgotPassword(user.email, user.name, resetUrl);

    res.json({ message: successMsg });
  } catch (error) {
    next(error);
  }
};

// ── @desc    Reset password with token
// ── @route   POST /api/auth/reset-password
// ── @access  Public
export const resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { token, password } = req.body as { token?: string; password?: string };
    if (!token || !password) { res.status(400).json({ error: 'Token and new password are required' }); return; }

    const pwErr = validatePassword(password);
    if (pwErr) { res.status(400).json({ error: pwErr }); return; }

    const hashed = crypto.createHash('sha256').update(token).digest('hex');

    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: hashed,
        resetPasswordExpire: { gt: new Date() },
      },
    });

    if (!user) { res.status(400).json({ error: 'Invalid or expired reset token' }); return; }

    const newHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: newHash, resetPasswordToken: null, resetPasswordExpire: null },
    });

    sendPasswordChanged(user.email, user.name);

    await logAudit(
      auditCtx(req, { id: user.id, name: user.name, email: user.email, role: user.role }, user.orgId || 'unknown'),
      'password_reset', 'auth', user.id,
      { method: 'reset_token' },
    );

    res.json({ message: 'Password has been reset successfully' });
  } catch (error) {
    next(error);
  }
};

// ── @desc    Verify the current user's password (used by InactivityLock unlock)
// ── @route   POST /api/auth/verify-password
// ── @access  Private (JWT required)
export const verifyPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { password } = req.body as { password?: string };
    if (!password) { res.status(400).json({ error: 'Password required' }); return; }
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) { res.status(401).json({ error: 'User not found' }); return; }
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) { res.status(401).json({ error: 'Incorrect password' }); return; }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

// ── @desc    Lookup account by phone number
// ── @route   POST /api/auth/phone-lookup
// ── @access  Public
export const phoneLookup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { phone } = req.body as { phone?: string };
    const user = await prisma.user.findFirst({ where: { phone } });

    if (!user) {
      res.status(404).json({ error: 'Account with this phone number not found' });
      return;
    }

    res.json({ name: user.name, email: user.email, phone: user.phone });
  } catch (error) {
    next(error);
  }
};
