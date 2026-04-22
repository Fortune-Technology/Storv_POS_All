/**
 * Audit Service — Immutable action logging.
 *
 * Every mutation (create/update/delete) by any user is logged.
 * Logs CANNOT be deleted through the application — only direct DB access.
 *
 * Usage in controllers:
 *   import { logAudit } from '../services/auditService.js';
 *   await logAudit(req, 'update', 'product', product.id, { field: 'retailPrice', oldValue: 4.99, newValue: 5.49 });
 */

import prisma from '../config/postgres.js';

/**
 * Log an audit event. Fire-and-forget — never blocks the main request.
 *
 * @param {object} req — Express request (extracts user, org, IP)
 * @param {string} action — "create"|"update"|"delete"|"void"|"refund"|"login"|"logout"|"shift_open"|"shift_close"|"price_change"|"settings_change"
 * @param {string} entity — "product"|"transaction"|"shift"|"user"|"store"|"order"|"customer"|"label"|"settings"
 * @param {string|null} entityId — ID of the affected record
 * @param {object|null} details — { field, oldValue, newValue } or any JSON context
 * @param {string} source — "portal"|"cashier"|"admin"|"api"
 */
export async function logAudit(req, action, entity, entityId = null, details = null, source = 'portal') {
  try {
    await prisma.auditLog.create({
      data: {
        orgId:     req.orgId || req.user?.orgId || 'unknown',
        storeId:   req.storeId || null,
        userId:    req.user?.id || 'system',
        userName:  req.user?.name || req.user?.email || 'System',
        userRole:  req.user?.role || null,
        action,
        entity,
        entityId:  entityId ? String(entityId) : null,
        details:   details || undefined,
        ipAddress: req.ip || req.headers?.['x-forwarded-for'] || null,
        userAgent: req.headers?.['user-agent']?.substring(0, 200) || null,
        source,
      },
    });
  } catch (err) {
    // Never let audit logging break the main flow
    console.warn('[AuditLog] Failed to write:', err.message);
  }
}

/**
 * Query audit logs with filters.
 *
 * Supported filters:
 *   userId, entity, action, source, module  (exact match)
 *   from / to                               (ISO date strings)
 *   search                                  (OR across userName/entity/action/entityId)
 *   page                                    (1-based; computes skip)
 *   skip                                    (explicit offset; overrides page)
 *   limit                                   (default 50, max 500)
 */
export async function queryAuditLogs(orgId, filters = {}) {
  const where = { orgId };

  if (filters.userId) where.userId = filters.userId;
  if (filters.entity) where.entity = filters.entity;
  if (filters.action) where.action = filters.action;
  if (filters.source) where.source = filters.source;

  // Module filter is stored inside the JSON `details.module` field for rows
  // written by autoAudit. Use Prisma's `path`/`equals` JSON query.
  if (filters.module) {
    where.details = { path: ['module'], equals: filters.module };
  }

  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = new Date(`${filters.from}T00:00:00`);
    if (filters.to)   where.createdAt.lte = new Date(`${filters.to}T23:59:59.999`);
  }
  if (filters.search) {
    where.OR = [
      { userName: { contains: filters.search, mode: 'insensitive' } },
      { entity:   { contains: filters.search, mode: 'insensitive' } },
      { action:   { contains: filters.search, mode: 'insensitive' } },
      { entityId: { contains: filters.search } },
    ];
  }

  const limit = Math.min(parseInt(filters.limit) || 50, 500);
  // Prefer explicit skip; otherwise compute from 1-based page.
  let skip = 0;
  if (filters.skip != null) {
    skip = parseInt(filters.skip) || 0;
  } else if (filters.page != null) {
    const page = Math.max(1, parseInt(filters.page) || 1);
    skip = (page - 1) * limit;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, total, limit, skip };
}

export default { logAudit, queryAuditLogs };
