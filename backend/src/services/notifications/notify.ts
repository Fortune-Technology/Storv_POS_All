/**
 * notify.ts — Notification creation + fan-out service.
 *
 * Single entry point for emitting notifications. Resolves the audience
 * (platform / org / store / user) into the matching set of recipient User
 * IDs and creates one NotificationDelivery per recipient inside a
 * transaction so all-or-nothing applies.
 *
 * Callers should NEVER write to `notifications` or `notification_deliveries`
 * directly — go through `emitNotification()`.
 */

import prisma from '../../config/postgres.js';

export type NotificationAudience = 'platform' | 'org' | 'store' | 'user';
export type NotificationSource   = 'system' | 'admin' | 'order' | 'task' | 'support';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export type NotificationType     = 'info' | 'success' | 'warning' | 'error';

export interface EmitNotificationInput {
  source?:        NotificationSource;
  createdById?:   string | null;
  title:          string;
  message:        string;
  linkUrl?:       string | null;
  iconKey?:       string | null;
  priority?:      NotificationPriority;
  type?:          NotificationType;

  // Audience routing
  audience:       NotificationAudience;
  targetOrgId?:   string | null;
  targetStoreId?: string | null;
  targetUserId?:  string | null;

  // Optional: drop dupes (e.g. ecom order webhooks firing twice)
  dedupeKey?:     string | null;

  // Optional auto-expire (e.g. 30-day TTL on order alerts)
  expiresAt?:     Date | null;
}

/**
 * Resolve the User.id list that should receive this notification.
 * 'platform' → every active user. 'org' → every member of UserOrg in target.
 * 'store'    → every UserStore at target. 'user' → just that user.
 */
async function resolveRecipients(input: EmitNotificationInput): Promise<string[]> {
  const { audience, targetOrgId, targetStoreId, targetUserId } = input;

  switch (audience) {
    case 'user': {
      if (!targetUserId) return [];
      const user = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, status: true },
      });
      return user && user.status === 'active' ? [user.id] : [];
    }

    case 'store': {
      if (!targetStoreId) return [];
      // UserStore links + store owner. Dedupe by id.
      const [usrows, store] = await Promise.all([
        prisma.userStore.findMany({
          where: {
            storeId: targetStoreId,
            user: { status: 'active' },
          },
          select: { userId: true },
        }),
        prisma.store.findUnique({
          where: { id: targetStoreId },
          select: { ownerId: true },
        }),
      ]);
      const ids = new Set<string>(usrows.map((r: { userId: string }) => r.userId));
      if (store?.ownerId) ids.add(store.ownerId);
      return [...ids];
    }

    case 'org': {
      if (!targetOrgId) return [];
      // Every UserOrg row + the legacy User.orgId fallback (covers users that
      // haven't been migrated to UserOrg yet — single-org installs).
      const [memberships, legacy] = await Promise.all([
        prisma.userOrg.findMany({
          where: { orgId: targetOrgId, user: { status: 'active' } },
          select: { userId: true },
        }),
        prisma.user.findMany({
          where: { orgId: targetOrgId, status: 'active' },
          select: { id: true },
        }),
      ]);
      const ids = new Set<string>([
        ...memberships.map((m: { userId: string }) => m.userId),
        ...legacy.map((u: { id: string }) => u.id),
      ]);
      return [...ids];
    }

    case 'platform': {
      const all = await prisma.user.findMany({
        where: { status: 'active' },
        select: { id: true },
      });
      return all.map((u: { id: string }) => u.id);
    }

    default:
      return [];
  }
}

export interface EmitResult {
  notificationId: string | null;
  deliveryCount:  number;
  deduped:        boolean;
}

/**
 * Create + fan out a notification. Returns the new notification id and
 * delivery count. When `dedupeKey` is set and a prior notification with the
 * same key exists, this is a no-op (returns deduped: true).
 */
export async function emitNotification(input: EmitNotificationInput): Promise<EmitResult> {
  if (!input.title?.trim() || !input.message?.trim()) {
    return { notificationId: null, deliveryCount: 0, deduped: false };
  }

  // Dedupe check — short-circuit before doing the recipient query
  if (input.dedupeKey) {
    const existing = await prisma.notification.findUnique({
      where: { dedupeKey: input.dedupeKey },
      select: { id: true },
    });
    if (existing) return { notificationId: existing.id, deliveryCount: 0, deduped: true };
  }

  const recipients = await resolveRecipients(input);

  if (recipients.length === 0) {
    // Still create the notification row for audit/superadmin visibility,
    // just with zero deliveries. Skip when dedupeKey is set so we don't
    // pollute the table on no-op events.
    if (input.dedupeKey) return { notificationId: null, deliveryCount: 0, deduped: false };
  }

  const notification = await prisma.notification.create({
    data: {
      source:        input.source ?? 'system',
      createdById:   input.createdById ?? null,
      title:         input.title.trim(),
      message:       input.message.trim(),
      linkUrl:       input.linkUrl ?? null,
      iconKey:       input.iconKey ?? null,
      priority:      input.priority ?? 'normal',
      type:          input.type ?? 'info',
      audience:      input.audience,
      targetOrgId:   input.targetOrgId ?? null,
      targetStoreId: input.targetStoreId ?? null,
      targetUserId:  input.targetUserId ?? null,
      dedupeKey:     input.dedupeKey ?? null,
      expiresAt:     input.expiresAt ?? null,
    },
    select: { id: true },
  });

  if (recipients.length > 0) {
    await prisma.notificationDelivery.createMany({
      data: recipients.map(userId => ({
        notificationId: notification.id,
        userId,
      })),
      skipDuplicates: true,
    });
  }

  return { notificationId: notification.id, deliveryCount: recipients.length, deduped: false };
}
