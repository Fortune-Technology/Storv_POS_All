/**
 * Pricing Model routes — /api/pricing/*
 *
 * Session 50 — Dual Pricing / Cash Discount management.
 *
 * Permission strategy:
 *   - Tier catalog (list/create/update/delete) — superadmin only
 *   - Per-store config GET — pricing_model.view (manager+) for own org;
 *     superadmin can view any store
 *   - Per-store config PUT — superadmin only (changes payment processing
 *     setup; no org-scope role can flip it)
 *   - Per-store change history — same scope as GET
 *   - All-stores summary (admin index page) — superadmin only
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  listPricingTiers,
  createPricingTier,
  updatePricingTier,
  deletePricingTier,
  getStorePricingConfig,
  updateStorePricingConfig,
  listStorePricingChanges,
  listAllStorePricingConfigs,
} from '../controllers/pricingModelController.js';

const router = Router();

router.use(protect);

// ── Pricing Tier catalog ────────────────────────────────────────────
// Read: any authenticated user with pricing_model.view (so portal can show
//       tier names in the read-only Store Settings panel)
// Write: superadmin only
router.get   ('/tiers',     requirePermission('pricing_model.view', 'admin_pricing_tiers.view'), listPricingTiers);
router.post  ('/tiers',     authorize('superadmin'), createPricingTier);
router.put   ('/tiers/:id', authorize('superadmin'), updatePricingTier);
router.delete('/tiers/:id', authorize('superadmin'), deletePricingTier);

// ── All-stores admin index (superadmin) ─────────────────────────────
router.get('/stores', authorize('superadmin'), listAllStorePricingConfigs);

// ── Per-store config ────────────────────────────────────────────────
// GET — manager+ in their own org OR any superadmin (controller checks scope)
// PUT — superadmin only (changes processor setup)
router.get('/stores/:storeId',         requirePermission('pricing_model.view', 'admin_pricing_model.view'), getStorePricingConfig);
router.put('/stores/:storeId',         authorize('superadmin'),                                              updateStorePricingConfig);
router.get('/stores/:storeId/changes', requirePermission('pricing_model.view', 'admin_pricing_model.view'), listStorePricingChanges);

export default router;
