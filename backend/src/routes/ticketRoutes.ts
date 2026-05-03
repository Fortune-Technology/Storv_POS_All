/**
 * ticketRoutes.js  — /api/tickets
 * Store-side support ticket routes (manager+ required).
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { requireTenant }      from '../middleware/scopeToTenant.js';
import {
  listOrgTickets,
  createOrgTicket,
  getOrgTicket,
  addStoreTicketReply,
} from '../controllers/ticketController.js';

const router = Router();

const guard = [protect, requireTenant, authorize('manager', 'owner', 'admin', 'superadmin')];

router.get('/',           ...guard, listOrgTickets);
router.post('/',          ...guard, createOrgTicket);
router.get('/:id',        ...guard, getOrgTicket);
router.post('/:id/reply', ...guard, addStoreTicketReply);

export default router;
