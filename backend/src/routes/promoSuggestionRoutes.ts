/**
 * Promo Suggestion routes — F28 / S74
 *
 * AI-driven promo recommendation review queue.
 *
 * RBAC:
 *   - View       → promotions.view
 *   - Generate   → promotions.create  (only managers can pull AI suggestions)
 *   - Approve    → promotions.create  (becomes a real Promotion)
 *   - Reject     → promotions.create
 *   - Edit       → promotions.edit
 *   - Dismiss    → promotions.create
 */
import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  listSuggestions,
  getSuggestion,
  updateSuggestion,
  approveSuggestion,
  rejectSuggestion,
  dismissSuggestion,
  generateSuggestions,
} from '../controllers/promoSuggestionController.js';

const router = Router();

router.use(protect);
router.use(scopeToTenant);

// S75 — switched from generic promotions.* to dedicated promo_suggestions.*
// keys so admins can grant "AI Reviewer" roles without granting full promo
// create access. Approve still implicitly creates a Promotion — the route
// also accepts promotions.create as a fallback for legacy roles, but
// new role configs should use the dedicated keys.
router.get('/',             requirePermission('promo_suggestions.view'),     listSuggestions);
router.get('/:id',          requirePermission('promo_suggestions.view'),     getSuggestion);
router.put('/:id',          requirePermission('promo_suggestions.view'),     updateSuggestion);  // edit while pending
router.post('/generate',    requirePermission('promo_suggestions.generate'), generateSuggestions);
router.post('/:id/approve', requirePermission('promo_suggestions.approve'),  approveSuggestion);
router.post('/:id/reject',  requirePermission('promo_suggestions.reject'),   rejectSuggestion);
router.post('/:id/dismiss', requirePermission('promo_suggestions.reject'),   dismissSuggestion);

export default router;
