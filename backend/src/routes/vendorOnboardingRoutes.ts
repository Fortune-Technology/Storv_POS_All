// ─────────────────────────────────────────────────
// Vendor Onboarding routes — S77 Phase 1
// Self-service: /api/vendor-onboarding/me  (any authenticated user)
// Admin:        /api/admin/vendor-onboardings (superadmin)
// ─────────────────────────────────────────────────
import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  getMyOnboarding,
  updateMyOnboarding,
  submitMyOnboarding,
  adminListOnboardings,
  adminGetOnboarding,
  adminGetOnboardingByUser,
  adminUpdateOnboarding,
} from '../controllers/vendorOnboardingController.js';

const router = express.Router();

// ── Vendor-side ──
router.get('/me', protect, getMyOnboarding);
router.put('/me', protect, updateMyOnboarding);
router.post('/me/submit', protect, submitMyOnboarding);

export default router;

// ── Admin-side router (mounted separately at /api/admin/vendor-onboardings) ──
export const adminRouter = express.Router();
adminRouter.get('/', protect, adminListOnboardings);
// `/by-user/:userId` MUST come before `/:id` so Express doesn't match the
// literal "by-user" string against the :id wildcard.
adminRouter.get('/by-user/:userId', protect, adminGetOnboardingByUser);
adminRouter.get('/:id', protect, adminGetOnboarding);
adminRouter.patch('/:id', protect, adminUpdateOnboarding);
