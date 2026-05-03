/**
 * notificationController.ts
 *
 * Two surfaces:
 *   • Org-side  (/api/notifications/*)       — list / count / markRead / dismiss
 *   • Admin-side (/api/admin/notifications)  — superadmin manual broadcast
 *
 * The org-side endpoints are scoped per-user (req.user.id). Each user only
 * ever sees their own NotificationDelivery rows.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import {
  emitNotification,
  type NotificationAudience,
  type NotificationPriority,
  type NotificationType,
} from '../services/notifications/notify.js';
import { logAudit } from '../services/auditService.js';

// ─────────────────────────────────────────────────────────────
// ORG-SIDE — current user's own deliveries
// ─────────────────────────────────────────────────────────────

/* GET /api/notifications?unreadOnly=&limit=&before= */
export const listMyNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const q = req.query as { unreadOnly?: string; limit?: string; before?: string };
    const limit = Math.min(parseInt(q.limit || '30', 10) || 30, 100);
    const where: Prisma.NotificationDeliveryWhereInput = {
      userId,
      dismissedAt: null,
    };
    if (q.unreadOnly === 'true') where.readAt = null;

    // Cursor pagination by deliveredAt
    if (q.before) {
      const before = new Date(q.before);
      if (!Number.isNaN(before.getTime())) {
        where.deliveredAt = { lt: before };
      }
    }

    // Auto-prune expired notifications at read time
    const now = new Date();

    const deliveries = await prisma.notificationDelivery.findMany({
      where: {
        ...where,
        notification: {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
      },
      include: {
        notification: {
          select: {
            id: true, source: true, title: true, message: true,
            linkUrl: true, iconKey: true, priority: true, type: true,
            audience: true, createdAt: true, expiresAt: true,
            createdById: true,
          },
        },
      },
      orderBy: { deliveredAt: 'desc' },
      take: limit,
    });

    res.json({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: deliveries.map((d: any) => ({
        deliveryId:  d.id,
        readAt:      d.readAt,
        deliveredAt: d.deliveredAt,
        ...d.notification,
      })),
    });
  } catch (err) { next(err); }
};

/* GET /api/notifications/count — unread count for the bell badge */
export const countUnread = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const now = new Date();
    const count = await prisma.notificationDelivery.count({
      where: {
        userId,
        readAt: null,
        dismissedAt: null,
        notification: {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
      },
    });
    res.json({ success: true, count });
  } catch (err) { next(err); }
};

/* PUT /api/notifications/:deliveryId/read */
export const markRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const result = await prisma.notificationDelivery.updateMany({
      where: { id: req.params.deliveryId, userId, readAt: null },
      data:  { readAt: new Date() },
    });
    res.json({ success: true, updated: result.count });
  } catch (err) { next(err); }
};

/* PUT /api/notifications/read-all */
export const markAllRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const now = new Date();
    const result = await prisma.notificationDelivery.updateMany({
      where: { userId, readAt: null, dismissedAt: null },
      data:  { readAt: now },
    });
    res.json({ success: true, updated: result.count });
  } catch (err) { next(err); }
};

/* DELETE /api/notifications/:deliveryId — soft-dismiss */
export const dismissNotification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const now = new Date();
    const result = await prisma.notificationDelivery.updateMany({
      where: { id: req.params.deliveryId, userId },
      data:  { dismissedAt: now, readAt: now },
    });
    res.json({ success: true, dismissed: result.count });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────
// ADMIN-SIDE — superadmin manual broadcast
// ─────────────────────────────────────────────────────────────

interface BroadcastBody {
  title?:         string;
  message?:       string;
  audience?:      NotificationAudience;
  targetOrgId?:   string | null;
  targetStoreId?: string | null;
  targetUserId?:  string | null;
  priority?:      NotificationPriority;
  type?:          NotificationType;
  linkUrl?:       string | null;
  expiresAt?:     string | null;
}

const VALID_AUDIENCE: NotificationAudience[] = ['platform', 'org', 'store', 'user'];
const VALID_PRIORITY: NotificationPriority[] = ['low', 'normal', 'high', 'urgent'];
const VALID_TYPE: NotificationType[]         = ['info', 'success', 'warning', 'error'];

/* POST /api/admin/notifications — superadmin broadcast */
export const adminBroadcastNotification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as BroadcastBody;
    const title   = (body.title || '').trim();
    const message = (body.message || '').trim();
    if (!title)   { res.status(400).json({ error: 'Title is required' });   return; }
    if (!message) { res.status(400).json({ error: 'Message is required' }); return; }

    const audience = body.audience as NotificationAudience;
    if (!VALID_AUDIENCE.includes(audience)) {
      res.status(400).json({ error: `audience must be one of: ${VALID_AUDIENCE.join(', ')}` });
      return;
    }

    // Validate audience targeting
    if (audience === 'org'   && !body.targetOrgId)   { res.status(400).json({ error: 'targetOrgId is required for audience=org' });     return; }
    if (audience === 'store' && !body.targetStoreId) { res.status(400).json({ error: 'targetStoreId is required for audience=store' }); return; }
    if (audience === 'user'  && !body.targetUserId)  { res.status(400).json({ error: 'targetUserId is required for audience=user' });   return; }

    const priority = body.priority && VALID_PRIORITY.includes(body.priority) ? body.priority : 'normal';
    const type     = body.type     && VALID_TYPE.includes(body.type)         ? body.type     : 'info';

    let expiresAt: Date | null = null;
    if (body.expiresAt) {
      const d = new Date(body.expiresAt);
      if (!Number.isNaN(d.getTime())) expiresAt = d;
    }

    const result = await emitNotification({
      source:        'admin',
      createdById:   req.user?.id || null,
      title,
      message,
      linkUrl:       body.linkUrl ?? null,
      priority,
      type,
      audience,
      targetOrgId:   body.targetOrgId   ?? null,
      targetStoreId: body.targetStoreId ?? null,
      targetUserId:  body.targetUserId  ?? null,
      expiresAt,
    });

    if (result.notificationId) {
      logAudit(req, 'broadcast', 'notification', result.notificationId, {
        title, audience,
        targetOrgId: body.targetOrgId ?? null,
        targetStoreId: body.targetStoreId ?? null,
        targetUserId: body.targetUserId ?? null,
        deliveryCount: result.deliveryCount,
      });
    }

    res.status(201).json({ success: true, ...result });
  } catch (err) { next(err); }
};

/* GET /api/admin/notifications — superadmin sent-history */
export const adminListBroadcasts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { page?: string; limit?: string };
    const page  = parseInt(q.page  || '1',  10) || 1;
    const limit = Math.min(parseInt(q.limit || '25', 10) || 25, 100);
    const skip  = (page - 1) * limit;

    const where: Prisma.NotificationWhereInput = { source: { in: ['admin', 'system'] } };

    const [rows, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: { select: { deliveries: true } },
        },
      }),
      prisma.notification.count({ where }),
    ]);

    res.json({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: rows.map((r: any) => ({
        id:            r.id,
        source:        r.source,
        title:         r.title,
        message:       r.message,
        linkUrl:       r.linkUrl,
        priority:      r.priority,
        type:          r.type,
        audience:      r.audience,
        targetOrgId:   r.targetOrgId,
        targetStoreId: r.targetStoreId,
        targetUserId:  r.targetUserId,
        expiresAt:     r.expiresAt,
        createdAt:     r.createdAt,
        deliveryCount: r._count.deliveries,
      })),
      total,
      page,
      limit,
    });
  } catch (err) { next(err); }
};

/* DELETE /api/admin/notifications/:id — recall a broadcast (cascade deletes deliveries) */
export const adminRecallBroadcast = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.notification.delete({ where: { id: req.params.id } });
    logAudit(req, 'recall', 'notification', req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
};
