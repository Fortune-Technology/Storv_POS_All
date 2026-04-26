/**
 * Invitation Controller  —  /api/invitations
 *
 * Drives two flows, one table:
 *   1. User onboarding        → invite a new/existing user into an org
 *   2. Store ownership transfer → invitation with transferOwnership=true
 *
 * On accept:
 *   • New user     → creates User + UserOrg + (optional) UserStore rows, auto-logs in
 *   • Existing user → creates/updates UserOrg membership, org appears in their switcher
 *   • Transfer     → swaps owner role + revokes seller's UserOrg rows for that org
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma, User, Invitation } from '@prisma/client';
import crypto from 'crypto';
import bcrypt  from 'bcryptjs';
import jwt     from 'jsonwebtoken';

import prisma from '../config/postgres.js';
import {
  sendInvitation,
  sendTransferInvitation,
  sendInvitationAccepted,
  sendTransferCompleted,
} from '../services/emailService.js';
import { sendInvitationSms, sendTransferSms } from '../services/smsService.js';
import { syncUserDefaultRole } from '../rbac/permissionService.js';
import { validateEmail, validatePassword, validatePhone } from '../utils/validators.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const TTL_DAYS  = 7;
const TTL_MS    = TTL_DAYS * 24 * 60 * 60 * 1000;
const JWT_TTL: string   = process.env.JWT_ACCESS_TTL || '2h';

// Roles the portal UI is allowed to hand out via invitation. Matches the
// legacy inviteUser restrictions; owner is only assignable via transfer.
const ASSIGNABLE_ROLES = new Set(['admin', 'manager', 'cashier']);
const SINGLE_STORE_ROLES = new Set(['cashier']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateToken(): string {
  // 32 bytes → 43 urlsafe base64 chars. Invitation links use this opaque
  // token so knowing an email isn't enough to accept.
  return crypto.randomBytes(32).toString('base64url');
}

function buildAcceptUrl(token: string): string {
  const base = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${base.replace(/\/+$/, '')}/invite/${token}`;
}

type InvitationWithOrg = Invitation & {
  organization?: { name?: string | null; slug?: string | null } | null;
};

interface SanitizedInvitation {
  id: string;
  token: string;
  email: string;
  phone: string | null;
  orgId: string;
  orgName: string | null;
  storeIds: string[];
  role: string;
  status: string;
  transferOwnership: boolean;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function sanitizeInvitation(inv: InvitationWithOrg): SanitizedInvitation {
  // Shape shown to org admins — includes the token so they can copy the
  // accept link. Admins can already revoke an invite, so exposing the token
  // in their own list is safe. The public /:token lookup never surfaces it.
  return {
    id:                inv.id,
    token:             inv.token,
    email:             inv.email,
    phone:             inv.phone,
    orgId:             inv.orgId,
    orgName:           inv.organization?.name ?? null,
    storeIds:          inv.storeIds,
    role:              inv.role,
    status:            inv.status,
    transferOwnership: inv.transferOwnership,
    expiresAt:         inv.expiresAt,
    acceptedAt:        inv.acceptedAt,
    createdAt:         inv.createdAt,
    updatedAt:         inv.updatedAt,
  };
}

async function maybeExpire<T extends Invitation>(inv: T): Promise<T> {
  // Lazy expiry — avoids a cron. If a pending invitation is past its date
  // the first time anyone reads it, flip it to 'expired' and return that.
  if (inv.status === 'pending' && inv.expiresAt < new Date()) {
    await prisma.invitation.update({
      where: { id: inv.id },
      data:  { status: 'expired' },
    });
    return { ...inv, status: 'expired' } as T;
  }
  return inv;
}

function signToken(userId: string, extra: Record<string, unknown> = {}): string {
  return jwt.sign({ id: userId, ...extra }, process.env.JWT_SECRET as jwt.Secret, { expiresIn: JWT_TTL } as jwt.SignOptions);
}

// ─── POST /api/invitations  — create ────────────────────────────────────────
// Scoped to req.orgId via scopeToTenant. Caller must be manager+.
export const createInvitation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.orgId) {
      res.status(403).json({ error: 'No organisation context.' });
      return;
    }

    const body = req.body as {
      email?: string;
      phone?: string | null;
      role?: string;
      storeIds?: string[];
      transferOwnership?: boolean;
    } | undefined;
    const { email, phone, role, storeIds, transferOwnership } = body || {};

    // ─── Validation ────────────────────────────────────────────────────────
    const emailErr = validateEmail(email);
    if (emailErr) { res.status(400).json({ error: emailErr }); return; }

    if (phone) {
      const phoneErr = validatePhone(phone);
      if (phoneErr) { res.status(400).json({ error: phoneErr }); return; }
    }

    const normalizedEmail = (email as string).trim().toLowerCase();

    let effectiveRole = role || 'cashier';
    const isTransfer = transferOwnership === true;

    if (isTransfer) {
      // Only an org owner can transfer, and transfers always grant owner role.
      if (req.role !== 'owner' && req.user?.role !== 'superadmin') {
        res.status(403).json({ error: 'Only the organisation owner can transfer ownership.' });
        return;
      }
      effectiveRole = 'owner';
    } else {
      if (!ASSIGNABLE_ROLES.has(effectiveRole)) {
        res.status(400).json({ error: `Role "${effectiveRole}" cannot be assigned via invitation.` });
        return;
      }
    }

    const storeList: string[] = Array.isArray(storeIds) ? storeIds.filter(Boolean) : [];
    if (!isTransfer && SINGLE_STORE_ROLES.has(effectiveRole) && storeList.length !== 1) {
      res.status(400).json({ error: 'Cashiers must be assigned to exactly one store.' });
      return;
    }

    // Don't let a stale pending invite pile up — if one exists for this
    // (email, org) pair, revoke it before creating the new one.
    await prisma.invitation.updateMany({
      where:  { email: normalizedEmail, orgId: req.orgId, status: 'pending' },
      data:   { status: 'revoked', updatedAt: new Date() },
    });

    // Check if the invitee already has an account — purely informational so
    // the email copy can say "sign in to accept" instead of "create account".
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    const token = generateToken();
    const invitation = await prisma.invitation.create({
      data: {
        token,
        email:             normalizedEmail,
        phone:             phone ? phone.trim() : null,
        orgId:             req.orgId,
        storeIds:          storeList,
        role:              effectiveRole,
        invitedById:       req.user!.id,
        transferOwnership: isTransfer,
        status:            'pending',
        expiresAt:         new Date(Date.now() + TTL_MS),
      },
      include: { organization: { select: { name: true } } },
    });

    // Fire-and-forget notifications. We don't want a 500 from SMTP to
    // break invite creation.
    const acceptUrl = buildAcceptUrl(token);
    const inviterName = req.user?.name || req.user?.email || '';
    const orgName = (invitation as InvitationWithOrg).organization?.name || 'your organisation';

    if (isTransfer) {
      sendTransferInvitation(normalizedEmail, { inviterName, orgName, acceptUrl });
      if (invitation.phone) sendTransferSms(invitation.phone, inviterName, orgName, acceptUrl);
    } else {
      sendInvitation(normalizedEmail, {
        inviterName,
        orgName,
        role: effectiveRole,
        acceptUrl,
        existingAccount: !!existing,
      });
      if (invitation.phone) sendInvitationSms(invitation.phone, inviterName, orgName, acceptUrl);
    }

    res.status(201).json({
      invitation: sanitizeInvitation(invitation as InvitationWithOrg),
      acceptUrl,                            // included so admin can copy/share manually
      existingAccount: !!existing,          // UI can show "user already has an account"
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/invitations  — list for active org ────────────────────────────
export const listInvitations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.orgId) {
      res.status(403).json({ error: 'No organisation context.' });
      return;
    }

    const q = req.query as { status?: string };
    const { status } = q;

    const where: Prisma.InvitationWhereInput = {
      orgId:  req.orgId,
      ...(status ? { status: String(status) } : {}),
    };

    const invitations = await prisma.invitation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { organization: { select: { name: true } } },
    });

    // Bulk expire pending invitations whose TTL has passed (no per-row write — just filter).
    const now = new Date();
    const mapped = invitations.map((inv: InvitationWithOrg) => ({
      ...sanitizeInvitation(inv),
      status: (inv.status === 'pending' && inv.expiresAt < now) ? 'expired' : inv.status,
    }));

    res.json(mapped);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/invitations/:token  — public lookup (for accept page) ─────────
// NOT protected — the token is the authentication.
export const getInvitationByToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { token } = req.params;
    if (!token) { res.status(400).json({ error: 'Invitation token required.' }); return; }

    const inv = await prisma.invitation.findUnique({
      where:   { token },
      include: { organization: { select: { name: true, slug: true } } },
    });
    if (!inv) { res.status(404).json({ error: 'Invitation not found.' }); return; }

    const fresh = await maybeExpire(inv as InvitationWithOrg);

    if (fresh.status !== 'pending') {
      res.status(410).json({
        error:  `Invitation ${fresh.status}.`,
        status: fresh.status,
      });
      return;
    }

    // Slim payload — only the fields the accept page needs. Hide inviter
    // user-details (just show their name).
    const inviter = await prisma.user.findUnique({
      where:  { id: fresh.invitedById },
      select: { name: true },
    });
    const existing = await prisma.user.findUnique({
      where:  { email: fresh.email },
      select: { id: true, name: true },
    });

    res.json({
      email:             fresh.email,
      phone:             fresh.phone,
      orgId:             fresh.orgId,
      orgName:           fresh.organization?.name || null,
      role:              fresh.role,
      transferOwnership: fresh.transferOwnership,
      expiresAt:         fresh.expiresAt,
      inviterName:       inviter?.name || null,
      existingAccount:   !!existing,
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/invitations/:token/accept  — accept (public) ─────────────────
// Behaviours:
//   • logged-in user whose email matches   → attach UserOrg, done
//   • new email                            → create account from body { name, password }, attach UserOrg
//   • transferOwnership=true               → also revoke previous owner's UserOrg rows
export const acceptInvitation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { token } = req.params;
    const body = req.body as { name?: string; password?: string } | undefined;
    const { name, password } = body || {};

    const inv = await prisma.invitation.findUnique({
      where:   { token },
      include: { organization: { select: { id: true, name: true } } },
    });
    if (!inv) { res.status(404).json({ error: 'Invitation not found.' }); return; }

    const fresh = await maybeExpire(inv as InvitationWithOrg);
    if (fresh.status !== 'pending') {
      res.status(410).json({ error: `Invitation ${fresh.status}.`, status: fresh.status });
      return;
    }

    // ── Resolve the accepting user ─────────────────────────────────────────
    // Priority: authenticated user (if their JWT matches the invitation email)
    // → existing user by email → brand new user from body.
    let user: User | null = null;

    // Optional: if caller passed a Bearer token, trust the id inside it.
    const authHeader = (req.headers.authorization as string) || '';
    if (authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET as jwt.Secret) as { id: string };
        const claimed = await prisma.user.findUnique({ where: { id: decoded.id } });
        if (claimed && claimed.email.toLowerCase() === fresh.email) {
          user = claimed;
        }
      } catch { /* invalid token → fall through to email lookup */ }
    }

    if (!user) {
      user = await prisma.user.findUnique({ where: { email: fresh.email } });
    }

    if (!user) {
      // New user signup. Require name + valid password.
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        res.status(400).json({ error: 'Full name is required.', reason: 'name_required' });
        return;
      }
      const pwErr = validatePassword(password);
      if (pwErr) { res.status(400).json({ error: pwErr, reason: 'password_invalid' }); return; }

      const hashed = await bcrypt.hash(password as string, 12);
      user = await prisma.user.create({
        data: {
          name:     name.trim(),
          email:    fresh.email,
          phone:    fresh.phone || null,
          password: hashed,
          // Legacy home-org role follows the invitation role on first signup
          role:     fresh.role,
          orgId:    fresh.orgId,
          status:   'active',
        },
      });
    }

    // After this point user is definitely non-null. Reassign through a const
    // alias so TS stops widening it back to `User | null` across awaits.
    const acceptingUser: User = user!;

    // ── Apply the org membership + transfer semantics ──────────────────────
    const transactionOps: Prisma.PrismaPromise<unknown>[] = [];

    if (fresh.transferOwnership) {
      // Revoke every other UserOrg for this org. Ownership is singular.
      transactionOps.push(
        prisma.userOrg.deleteMany({
          where: { orgId: fresh.orgId, userId: { not: acceptingUser.id } },
        }),
      );
      // Move the seller's UserStore rows too (remove their store access).
      transactionOps.push(
        prisma.userStore.deleteMany({
          where: { user: { id: { not: acceptingUser.id } }, store: { orgId: fresh.orgId } },
        }),
      );
      // Reset the seller's legacy `User.orgId` if it points at the transferred
      // org. Without this, `scopeToTenant`'s home-org fallback would still
      // resolve `req.orgId` to the transferred org even after the UserOrg row
      // is gone. Re-point it at one of their remaining UserOrg memberships if
      // they have any, else null (orgless — can still sign in but sees nothing
      // until invited somewhere).
      const stuckSellers = await prisma.user.findMany({
        where:  { id: { not: acceptingUser.id }, orgId: fresh.orgId },
        select: { id: true, orgs: { where: { orgId: { not: fresh.orgId } }, select: { orgId: true, isPrimary: true } } },
      });
      type StuckSellerRow = (typeof stuckSellers)[number];
      for (const s of stuckSellers as StuckSellerRow[]) {
        const otherOrg = s.orgs.find((o: { orgId: string; isPrimary: boolean }) => o.isPrimary)?.orgId ?? s.orgs[0]?.orgId ?? null;
        transactionOps.push(
          prisma.user.update({ where: { id: s.id }, data: { orgId: otherOrg } }),
        );
      }
    }

    // Upsert the accepting user's UserOrg row. isPrimary=true when this is
    // their first membership, false otherwise — so existing users keep their
    // current primary org.
    const existingMemberships = await prisma.userOrg.count({ where: { userId: acceptingUser.id } });
    transactionOps.push(
      prisma.userOrg.upsert({
        where:  { userId_orgId: { userId: acceptingUser.id, orgId: fresh.orgId } },
        create: {
          userId:      acceptingUser.id,
          orgId:       fresh.orgId,
          role:        fresh.role,
          isPrimary:   existingMemberships === 0,
          invitedById: fresh.invitedById,
          acceptedAt:  new Date(),
        },
        update: {
          role:       fresh.role,
          acceptedAt: new Date(),
        },
      }),
    );

    // Per-store scoping. Only applies for non-transfer invitations with storeIds.
    if (!fresh.transferOwnership && fresh.storeIds.length > 0) {
      transactionOps.push(
        prisma.userStore.deleteMany({
          where: { userId: acceptingUser.id, store: { orgId: fresh.orgId } },
        }),
      );
      transactionOps.push(
        prisma.userStore.createMany({
          data:           fresh.storeIds.map((storeId: string) => ({ userId: acceptingUser.id, storeId })),
          skipDuplicates: true,
        }),
      );
    }

    // Transfer: new owner's legacy User.role + User.orgId become this org
    // (so back-office UIs that still read user.role show 'owner').
    if (fresh.transferOwnership) {
      transactionOps.push(
        prisma.user.update({
          where: { id: acceptingUser.id },
          data:  { role: 'owner', orgId: fresh.orgId },
        }),
      );
      // Mark the store(s) as owned by the new owner.
      transactionOps.push(
        prisma.store.updateMany({
          where: { orgId: fresh.orgId },
          data:  { ownerId: acceptingUser.id },
        }),
      );
    }

    // Mark invitation as accepted.
    transactionOps.push(
      prisma.invitation.update({
        where: { id: fresh.id },
        data:  {
          status:           'accepted',
          acceptedAt:       new Date(),
          acceptedByUserId: acceptingUser.id,
        },
      }),
    );

    // For ownership transfer: collect outgoing-owner emails BEFORE we delete
    // their UserOrg rows so we can notify them after the transaction.
    type OutgoingOwner = { user: { email: string | null; name: string | null } | null };
    let outgoingOwners: OutgoingOwner[] = [];
    if (fresh.transferOwnership) {
      outgoingOwners = await prisma.userOrg.findMany({
        where:  { orgId: fresh.orgId, userId: { not: acceptingUser.id }, role: 'owner' },
        select: { user: { select: { email: true, name: true } } },
      }) as unknown as OutgoingOwner[];
    }

    await prisma.$transaction(transactionOps);

    // Keep the RBAC UserRole junction in sync with the user's effective role
    // for this accept (new users get `fresh.role` as their User.role above;
    // transfers also change it to 'owner'). No-op for existing users whose
    // User.role is unchanged.
    if (fresh.transferOwnership || existingMemberships === 0) {
      await syncUserDefaultRole(acceptingUser.id).catch((err: Error) => console.warn('syncUserDefaultRole:', err.message));
    }

    // Fire-and-forget post-acceptance notifications.
    try {
      const inviter = await prisma.user.findUnique({
        where:  { id: fresh.invitedById },
        select: { email: true, name: true },
      });
      if (inviter?.email) {
        sendInvitationAccepted(inviter.email, {
          inviterName: inviter.name || '',
          inviteeName: acceptingUser.name || '',
          orgName:     fresh.organization?.name || 'your organisation',
          role:        fresh.role,
        });
      }
      if (fresh.transferOwnership) {
        for (const prev of outgoingOwners) {
          if (prev.user?.email) {
            sendTransferCompleted(prev.user.email, {
              formerOwnerName: prev.user.name || '',
              newOwnerName:    acceptingUser.name || '',
              orgName:         fresh.organization?.name || 'your organisation',
            });
          }
        }
      }
    } catch (e) {
      console.warn('[Invitation] post-accept notify failed:', (e as Error).message);
    }

    const jwtToken = signToken(acceptingUser.id, {
      name: acceptingUser.name, email: acceptingUser.email, role: fresh.role, orgId: fresh.orgId,
    });

    res.json({
      user: {
        id:    acceptingUser.id,
        _id:   acceptingUser.id,
        name:  acceptingUser.name,
        email: acceptingUser.email,
        role:  fresh.role,
        orgId: fresh.orgId,
      },
      orgId:    fresh.orgId,
      role:     fresh.role,
      storeIds: fresh.storeIds,
      transferOwnership: fresh.transferOwnership,
      token:    jwtToken,
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/invitations/:id/resend ────────────────────────────────────────
export const resendInvitation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.orgId) { res.status(403).json({ error: 'No organisation context.' }); return; }

    const inv = await prisma.invitation.findFirst({
      where:   { id: req.params.id, orgId: req.orgId },
      include: { organization: { select: { name: true } } },
    });
    if (!inv) { res.status(404).json({ error: 'Invitation not found.' }); return; }
    if (inv.status === 'accepted') {
      res.status(400).json({ error: 'Invitation has already been accepted.' });
      return;
    }

    // Push the expiry out another 7 days + flip back to pending if it expired.
    const updated = await prisma.invitation.update({
      where: { id: inv.id },
      data:  {
        status:    'pending',
        expiresAt: new Date(Date.now() + TTL_MS),
      },
      include: { organization: { select: { name: true } } },
    }) as InvitationWithOrg;

    const existing = await prisma.user.findUnique({ where: { email: updated.email } });
    const acceptUrl = buildAcceptUrl(updated.token);
    const inviterName = req.user?.name || req.user?.email || '';
    const orgName = updated.organization?.name || 'your organisation';

    if (updated.transferOwnership) {
      sendTransferInvitation(updated.email, { inviterName, orgName, acceptUrl });
      if (updated.phone) sendTransferSms(updated.phone, inviterName, orgName, acceptUrl);
    } else {
      sendInvitation(updated.email, { inviterName, orgName, role: updated.role, acceptUrl, existingAccount: !!existing });
      if (updated.phone) sendInvitationSms(updated.phone, inviterName, orgName, acceptUrl);
    }

    res.json({ invitation: sanitizeInvitation(updated), acceptUrl });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/invitations/:id  — revoke ──────────────────────────────────
export const revokeInvitation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.orgId) { res.status(403).json({ error: 'No organisation context.' }); return; }

    const inv = await prisma.invitation.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
    });
    if (!inv) { res.status(404).json({ error: 'Invitation not found.' }); return; }
    if (inv.status !== 'pending') {
      res.status(400).json({ error: `Cannot revoke a ${inv.status} invitation.` });
      return;
    }

    await prisma.invitation.update({
      where: { id: inv.id },
      data:  { status: 'revoked' },
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

export default {
  createInvitation,
  listInvitations,
  getInvitationByToken,
  acceptInvitation,
  resendInvitation,
  revokeInvitation,
};
