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

import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

/**
 * Log an audit event. Fire-and-forget — never blocks the main request.
 *
 * `req` is the Express request (extracts user, org, IP). The augmented
 * properties (`req.orgId`, `req.storeId`, `req.user`) are typed via
 * global.d.ts so this signature stays clean.
 */
export async function logAudit(
  req: Request,
  action: string,
  entity: string,
  entityId: string | number | null = null,
  details: Record<string, unknown> | null = null,
  source: string = 'portal',
): Promise<void> {
  try {
    const userAgent = req.headers?.['user-agent'];
    const userAgentSample = typeof userAgent === 'string' ? userAgent.substring(0, 200) : null;
    const xForwardedFor = req.headers?.['x-forwarded-for'];
    const ipFromHeader = typeof xForwardedFor === 'string' ? xForwardedFor : null;

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
        details:   (details || undefined) as Prisma.InputJsonValue | undefined,
        ipAddress: req.ip || ipFromHeader || null,
        userAgent: userAgentSample,
        source,
      },
    });
  } catch (err) {
    // Never let audit logging break the main flow
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[AuditLog] Failed to write:', message);
  }
}

export interface AuditLogFilters {
  userId?: string;
  entity?: string;
  action?: string;
  source?: string;
  module?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: string | number;
  skip?: string | number;
  limit?: string | number;
}

interface AuditWhereClause {
  orgId: string;
  userId?: string;
  entity?: string;
  action?: string;
  source?: string;
  details?: { path: string[]; equals: unknown };
  createdAt?: { gte?: Date; lte?: Date };
  OR?: Array<Record<string, unknown>>;
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
export async function queryAuditLogs(orgId: string, filters: AuditLogFilters = {}) {
  const where: AuditWhereClause = { orgId };

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

  const rawLimit = typeof filters.limit === 'string' ? parseInt(filters.limit) : filters.limit;
  const limit = Math.min((rawLimit && Number.isFinite(rawLimit) ? rawLimit : 50), 500);

  // Prefer explicit skip; otherwise compute from 1-based page.
  let skip = 0;
  if (filters.skip != null) {
    const rawSkip = typeof filters.skip === 'string' ? parseInt(filters.skip) : filters.skip;
    skip = (rawSkip && Number.isFinite(rawSkip)) ? rawSkip : 0;
  } else if (filters.page != null) {
    const rawPage = typeof filters.page === 'string' ? parseInt(filters.page) : filters.page;
    const page = Math.max(1, (rawPage && Number.isFinite(rawPage)) ? rawPage : 1);
    skip = (page - 1) * limit;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: where as Prisma.AuditLogWhereInput,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip,
    }),
    prisma.auditLog.count({ where: where as Prisma.AuditLogWhereInput }),
  ]);

  return { logs, total, limit, skip };
}

export default { logAudit, queryAuditLogs };
