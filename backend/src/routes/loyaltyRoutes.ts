/**
 * Loyalty Routes
 * /api/loyalty/...
 */

import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  getProgram, upsertProgram,
  getEarnRules, createEarnRule, updateEarnRule, deleteEarnRule,
  getRewards, createReward, updateReward, deleteReward,
  getPOSLoyaltyConfig,
} from '../controllers/loyaltyController.js';

const router = express.Router();

// All loyalty routes require authentication + tenant scoping
router.use(protect, scopeToTenant);

// ── Program settings ────────────────────────────────────────────────────────
router.get('/program',    authorize('superadmin','admin','owner','manager','cashier','store'), getProgram);
router.put('/program',    authorize('superadmin','admin','owner','manager'), upsertProgram);

// ── Earn rules ──────────────────────────────────────────────────────────────
router.get('/earn-rules',       authorize('superadmin','admin','owner','manager','cashier','store'), getEarnRules);
router.post('/earn-rules',      authorize('superadmin','admin','owner','manager'), createEarnRule);
router.put('/earn-rules/:id',   authorize('superadmin','admin','owner','manager'), updateEarnRule);
router.delete('/earn-rules/:id',authorize('superadmin','admin','owner','manager'), deleteEarnRule);

// ── Rewards ─────────────────────────────────────────────────────────────────
router.get('/rewards',        authorize('superadmin','admin','owner','manager','cashier','store'), getRewards);
router.post('/rewards',       authorize('superadmin','admin','owner','manager'), createReward);
router.put('/rewards/:id',    authorize('superadmin','admin','owner','manager'), updateReward);
router.delete('/rewards/:id', authorize('superadmin','admin','owner','manager'), deleteReward);

// ── POS-facing config (program + rules + rewards in one call) ───────────────
router.get('/config', authorize('superadmin','admin','owner','manager','cashier','store'), getPOSLoyaltyConfig);

export default router;
