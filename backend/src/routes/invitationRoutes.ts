/**
 * Invitation routes  —  /api/invitations
 *
 *   GET    /                    (protected, users.view)   — list org's invitations
 *   POST   /                    (protected, users.create) — send new invitation
 *   GET    /:token              (public)                  — lookup for accept page
 *   POST   /:token/accept       (public)                  — accept (creates account if new)
 *   POST   /:id/resend          (protected, users.create) — resend (new 7-day window)
 *   DELETE /:id                 (protected, users.delete) — revoke pending invitation
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { requireTenant } from '../middleware/scopeToTenant.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  invitationLookupLimiter,
  invitationAcceptLimiter,
} from '../middleware/rateLimit.js';
import {
  createInvitation,
  listInvitations,
  getInvitationByToken,
  acceptInvitation,
  resendInvitation,
  revokeInvitation,
} from '../controllers/invitationController.js';

const router = Router();

// ─── Public routes (no protect) ──────────────────────────────────────────────
// The token itself is the auth credential for these. Rate-limited to cut off
// brute-force / DoS against the lookup + account-creation endpoints.
router.get ('/:token',        invitationLookupLimiter, getInvitationByToken);
router.post('/:token/accept', invitationAcceptLimiter, acceptInvitation);

// ─── Protected routes ────────────────────────────────────────────────────────
router.get   ('/',            protect, requireTenant, requirePermission('users.view'),   listInvitations);
router.post  ('/',            protect, requireTenant, requirePermission('users.create'), createInvitation);
router.post  ('/:id/resend',  protect, requireTenant, requirePermission('users.create'), resendInvitation);
router.delete('/:id',         protect, requireTenant, requirePermission('users.delete'), revokeInvitation);

export default router;
