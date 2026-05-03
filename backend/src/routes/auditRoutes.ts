import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requirePermission } from '../rbac/permissionService.js';
import { queryAuditLogs } from '../services/auditService.js';

const router = Router();
router.use(protect);
router.use(scopeToTenant);

// GET /api/audit — Query audit logs (read-only, NO delete endpoint)
router.get('/', requirePermission('audit.view'), async (req, res, next) => {
  try {
    const result = await queryAuditLogs(req.orgId as string, req.query);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
