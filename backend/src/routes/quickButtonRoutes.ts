/**
 * Quick Button Layout routes — /api/quick-buttons
 *
 * All routes require auth + tenant scope. Write routes require
 * `pos_config.edit` (manager+) — same permission gate as POS Settings.
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  getLayout, saveLayout, uploadImage, clearLayout, listActions, uploadMiddleware,
} from '../controllers/quickButtonController.js';

const router = Router();
router.use(protect);

// Static whitelist (doesn't need perms — just lets the builder know what actions exist)
router.get('/actions', listActions);

router.get   ('/',         requirePermission('pos_config.view'), getLayout);
router.put   ('/',         requirePermission('pos_config.edit'), saveLayout);
router.delete('/',         requirePermission('pos_config.edit'), clearLayout);
router.post  ('/upload',   requirePermission('pos_config.edit'), uploadMiddleware, uploadImage);

export default router;
