/**
 * State catalog routes — /api/states
 *
 * - GET /public       → any authenticated user (for Store Settings dropdown)
 * - GET /             → superadmin: full catalog incl. inactive
 * - POST /            → superadmin: create
 * - GET /:code        → any authenticated user (details for inline preview)
 * - PUT /:code        → superadmin: update
 * - DELETE /:code     → superadmin: delete (blocked when in use)
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  listStates,
  getState,
  createState,
  updateState,
  deleteState,
} from '../controllers/stateController.js';

const router = Router();

router.use(protect);

// Public (any authed user)
router.get('/public', (req, res) => {
  req.query.active = 'true';
  return listStates(req, res);
});
router.get('/:code', getState);

// Superadmin-only
router.get   ('/',      authorize('superadmin'), listStates);
router.post  ('/',      authorize('superadmin'), createState);
router.put   ('/:code', authorize('superadmin'), updateState);
router.delete('/:code', authorize('superadmin'), deleteState);

export default router;
