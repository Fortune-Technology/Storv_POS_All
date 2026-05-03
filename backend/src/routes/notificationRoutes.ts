/**
 * Notification routes — split between user-side (any authenticated user)
 * and admin-side (mounted under /api/admin/notifications by adminRoutes).
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  listMyNotifications,
  countUnread,
  markRead,
  markAllRead,
  dismissNotification,
} from '../controllers/notificationController.js';

const router = Router();

router.use(protect);

router.get(   '/',                          listMyNotifications);
router.get(   '/count',                     countUnread);
router.put(   '/read-all',                  markAllRead);
router.put(   '/:deliveryId/read',          markRead);
router.delete('/:deliveryId',               dismissNotification);

export default router;
