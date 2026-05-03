/**
 * Chat Controller — Internal messaging between cashier ↔ back-office.
 *
 * Channels:
 *   "store:{storeId}"              — store-wide chat (all staff in a store)
 *   "direct:{userId1}:{userId2}"   — direct message between two users
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

interface ChannelEntry {
  id: string;
  name: string;
  type: 'store' | 'direct' | 'partner';
  storeId?: string;
  partnershipId?: string;
  partner?: {
    storeId: string;
    name: string;
    storeCode: string | null;
    orgName?: string;
  };
  mine?: { storeId: string; name: string };
  lastMessage?: { message: string; senderName: string; createdAt: Date } | null;
  unreadCount?: number;
}

// ── GET /api/chat/channels — List available channels for the user ──────────
export const getChannels = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const userId = req.user!.id;

    // Get stores this user belongs to
    const userStores = req.user?.stores?.map((s) => s.storeId) || [];
    const role = req.user?.role || '';
    const stores = await prisma.store.findMany({
      where: {
        orgId,
        ...(userStores.length > 0 && role !== 'owner' && role !== 'admin' && role !== 'superadmin'
          ? { id: { in: userStores } }
          : {}),
      },
      select: { id: true, name: true },
    });

    // Build store channels
    const channels: ChannelEntry[] = stores.map((s: { id: string; name: string }) => ({
      id: `store:${s.id}`,
      name: s.name,
      type: 'store',
      storeId: s.id,
    }));

    // Get direct message channels this user is part of
    const directMessages = await prisma.chatMessage.findMany({
      where: { orgId, channelId: { startsWith: 'direct:' }, senderId: userId },
      select: { channelId: true },
      distinct: ['channelId'],
    });
    const receivedDMs = await prisma.chatMessage.findMany({
      where: {
        orgId,
        AND: [
          { channelId: { startsWith: 'direct:' } },
          { channelId: { contains: userId } },
        ],
      },
      select: { channelId: true },
      distinct: ['channelId'],
    });

    const dmChannelIds = Array.from(new Set([
      ...directMessages.map((d: { channelId: string }) => d.channelId),
      ...receivedDMs.map((d: { channelId: string }) => d.channelId),
    ]));

    // Get latest message + unread count per channel
    for (const ch of channels) {
      const latest = await prisma.chatMessage.findFirst({
        where: { orgId, channelId: ch.id },
        orderBy: { createdAt: 'desc' },
        select: { message: true, senderName: true, createdAt: true },
      });
      const unread = await prisma.chatMessage.count({
        where: { orgId, channelId: ch.id, NOT: { readBy: { has: userId } }, senderId: { not: userId } },
      });
      ch.lastMessage = latest || null;
      ch.unreadCount = unread;
    }

    // Add DM channels
    for (const chId of dmChannelIds) {
      const parts = chId.split(':');
      const otherUserId = parts[1] === userId ? parts[2] : parts[1];
      const otherUser = await prisma.user.findUnique({
        where: { id: otherUserId },
        select: { name: true },
      }).catch(() => null);
      const latest = await prisma.chatMessage.findFirst({
        where: { orgId, channelId: chId },
        orderBy: { createdAt: 'desc' },
        select: { message: true, senderName: true, createdAt: true },
      });
      const unread = await prisma.chatMessage.count({
        where: { orgId, channelId: chId, NOT: { readBy: { has: userId } }, senderId: { not: userId } },
      });
      channels.push({
        id: chId,
        name: otherUser?.name || 'Unknown',
        type: 'direct',
        lastMessage: latest,
        unreadCount: unread,
      });
    }

    res.json({ channels });
  } catch (err) { next(err); }
};

// ── GET /api/chat/messages?channelId=...&limit=50&before=... ────────────
export const getMessages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { channelId, limit = 50, before } = req.query as {
      channelId?: string;
      limit?: string | number;
      before?: string;
    };
    if (!channelId) { res.status(400).json({ error: 'channelId required' }); return; }

    const where: Prisma.ChatMessageWhereInput = { orgId: req.orgId as string, channelId };
    if (before) where.createdAt = { lt: new Date(before) };

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(String(limit)), 100),
    });

    res.json({ messages: messages.reverse() });
  } catch (err) { next(err); }
};

interface SendMessageBody {
  channelId?: string;
  recipientId?: string;
  message?: string;
  messageType?: string;
}

// ── POST /api/chat/messages — Send a message ────────────────────────────
export const sendMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as SendMessageBody;
    let { channelId } = body;
    const { recipientId, message, messageType = 'text' } = body;

    // If frontend sent `recipientId` instead of `channelId` (e.g. starting a
    // new DM), build the canonical sorted DM channelId ourselves.
    if (!channelId && recipientId) {
      const [a, b] = [req.user!.id, recipientId].sort();
      channelId = `direct:${a}:${b}`;
    }

    if (!channelId || !message?.trim()) {
      res.status(400).json({ error: 'channelId and message required' });
      return;
    }

    const storeId = channelId.startsWith('store:') ? channelId.split(':')[1] : null;

    const msg = await prisma.chatMessage.create({
      data: {
        orgId:       req.orgId as string,
        storeId,
        channelId,
        senderId:    req.user!.id,
        senderName:  req.user!.name || req.user!.email || 'Unknown',
        senderRole:  req.user!.role || '',
        message:     message.trim(),
        messageType,
        readBy:      [req.user!.id],
      },
    });

    res.status(201).json(msg);
  } catch (err) { next(err); }
};

// ── POST /api/chat/read — Mark messages as read ─────────────────────────
export const markRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { channelId } = req.body as { channelId?: string };
    if (!channelId) { res.status(400).json({ error: 'channelId required' }); return; }

    const userId = req.user!.id;
    const unread = await prisma.chatMessage.findMany({
      where: { orgId: req.orgId as string, channelId, NOT: { readBy: { has: userId } } },
      select: { id: true, readBy: true },
    });

    for (const msg of unread) {
      await prisma.chatMessage.update({
        where: { id: msg.id },
        data: { readBy: [...msg.readBy, userId] },
      });
    }

    res.json({ marked: unread.length });
  } catch (err) { next(err); }
};

// ── GET /api/chat/unread — Total unread count ───────────────────────────
export const getUnreadCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const count = await prisma.chatMessage.count({
      where: { orgId: req.orgId as string, NOT: { readBy: { has: req.user!.id } }, senderId: { not: req.user!.id } },
    });
    res.json({ count });
  } catch (err) { next(err); }
};

// ── GET /api/chat/users — List users for starting DMs ───────────────────
export const getChatUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { orgId: req.orgId as string, status: 'active', id: { not: req.user!.id } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json({ users });
  } catch (err) { next(err); }
};

// ── Partner (cross-org) chat ────────────────────────────────────────────

interface PartnershipInfo {
  tp: {
    id: string;
    status: string;
    requesterStoreId: string;
    partnerStoreId: string;
    requesterStore: { id: string; name: string; storeCode: string | null; organization: { id: string; name: string } | null };
    partnerStore:   { id: string; name: string; storeCode: string | null; organization: { id: string; name: string } | null };
  };
  mine:  { id: string; name: string; storeCode: string | null };
  other: { id: string; name: string; storeCode: string | null; organization?: { id: string; name: string } | null };
  activeStore: string | null;
}

// Helper — verify the caller is a party to the partnership.
async function loadPartnershipForUser(req: Request, partnershipId: string): Promise<PartnershipInfo | null> {
  const userStoreIds = (req.user?.stores || []).map((s) => s.storeId);
  const activeStore  = req.storeId || (userStoreIds[0] || null);

  // All orgs this user has any membership in.
  const userOrgIds = Array.isArray(req.orgIds) && req.orgIds.length > 0
    ? req.orgIds
    : ([req.user?.orgId].filter(Boolean) as string[]);

  const tp = await prisma.tradingPartner.findUnique({
    where: { id: partnershipId },
    select: {
      id: true, status: true,
      requesterStoreId: true, partnerStoreId: true,
      requesterStore: { select: { id: true, name: true, storeCode: true, organization: { select: { id: true, name: true } } } },
      partnerStore:   { select: { id: true, name: true, storeCode: true, organization: { select: { id: true, name: true } } } },
    },
  });
  if (!tp || tp.status !== 'accepted') return null;

  const requesterOrgId = tp.requesterStore.organization?.id;
  const partnerOrgId   = tp.partnerStore.organization?.id;

  const isOwnerAdmin = ['owner', 'admin', 'superadmin'].includes(req.user?.role || '');
  const ownsStore    = userStoreIds.includes(tp.requesterStoreId) || userStoreIds.includes(tp.partnerStoreId);
  const adminsOrg    = isOwnerAdmin && (
    (requesterOrgId && userOrgIds.includes(requesterOrgId)) ||
    (partnerOrgId && userOrgIds.includes(partnerOrgId))
  );

  if (!ownsStore && !adminsOrg) return null;

  const minesRequester =
    userStoreIds.includes(tp.requesterStoreId) ||
    Boolean(adminsOrg && requesterOrgId && userOrgIds.includes(requesterOrgId));
  const mine  = minesRequester ? tp.requesterStore : tp.partnerStore;
  const other = mine.id === tp.requesterStore.id ? tp.partnerStore : tp.requesterStore;
  return { tp, mine, other, activeStore };
}

// GET /api/chat/partner/channels
export const getPartnerChannels = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId       = req.user!.id;
    const userStoreIds = (req.user?.stores || []).map((s) => s.storeId);
    const isOwnerAdmin = ['owner', 'admin', 'superadmin'].includes(req.user?.role || '');
    const userOrgIds   = Array.isArray(req.orgIds) && req.orgIds.length > 0
      ? req.orgIds
      : ([req.user?.orgId].filter(Boolean) as string[]);

    const orConditions: Prisma.TradingPartnerWhereInput[] = [];
    if (userStoreIds.length > 0) orConditions.push({ requesterStoreId: { in: userStoreIds } });
    if (userStoreIds.length > 0) orConditions.push({ partnerStoreId:   { in: userStoreIds } });
    if (isOwnerAdmin && userOrgIds.length > 0) orConditions.push({ requesterStore: { orgId: { in: userOrgIds } } });
    if (isOwnerAdmin && userOrgIds.length > 0) orConditions.push({ partnerStore:   { orgId: { in: userOrgIds } } });

    const partnerships = await prisma.tradingPartner.findMany({
      where: { status: 'accepted', OR: orConditions },
      include: {
        requesterStore: { select: { id: true, name: true, storeCode: true, organization: { select: { id: true, name: true } } } },
        partnerStore:   { select: { id: true, name: true, storeCode: true, organization: { select: { id: true, name: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    type PartnershipRow = (typeof partnerships)[number];
    const channels: ChannelEntry[] = [];
    for (const p of partnerships as PartnershipRow[]) {
      const isRequesterSide =
        userStoreIds.includes(p.requesterStoreId) ||
        (p.requesterStore.organization?.id ? userOrgIds.includes(p.requesterStore.organization.id) : false);
      const mine  = isRequesterSide ? p.requesterStore : p.partnerStore;
      const other = isRequesterSide ? p.partnerStore   : p.requesterStore;

      const channelId = `partner:${p.id}`;
      const latest = await prisma.chatMessage.findFirst({
        where: { channelId },
        orderBy: { createdAt: 'desc' },
        select: { message: true, senderName: true, createdAt: true },
      });
      const unread = await prisma.chatMessage.count({
        where: { channelId, NOT: { readBy: { has: userId } }, senderId: { not: userId } },
      });
      channels.push({
        id: channelId,
        name: other.name,
        type: 'partner',
        partnershipId: p.id,
        partner: {
          storeId: other.id,
          name: other.name,
          storeCode: other.storeCode,
          orgName: other.organization?.name,
        },
        mine: { storeId: mine.id, name: mine.name },
        lastMessage: latest || null,
        unreadCount: unread,
      });
    }
    res.json({ channels });
  } catch (err) { next(err); }
};

// GET /api/chat/partner/messages?partnershipId=X
export const getPartnerMessages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { partnershipId, limit = 50, before } = req.query as {
      partnershipId?: string;
      limit?: string | number;
      before?: string;
    };
    if (!partnershipId) { res.status(400).json({ error: 'partnershipId required' }); return; }
    const info = await loadPartnershipForUser(req, partnershipId);
    if (!info) { res.status(403).json({ error: 'Not a party to this partnership' }); return; }

    const where: Prisma.ChatMessageWhereInput = { channelId: `partner:${partnershipId}` };
    if (before) where.createdAt = { lt: new Date(before) };

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(String(limit)), 100),
    });
    res.json({
      messages: messages.reverse(),
      partnership: { id: info.tp.id, mine: info.mine, other: info.other },
    });
  } catch (err) { next(err); }
};

// POST /api/chat/partner/messages { partnershipId, message }
export const sendPartnerMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { partnershipId, message, messageType = 'text' } = req.body as {
      partnershipId?: string;
      message?: string;
      messageType?: string;
    };
    if (!partnershipId || !message?.trim()) {
      res.status(400).json({ error: 'partnershipId and message required' });
      return;
    }
    const info = await loadPartnershipForUser(req, partnershipId);
    if (!info) { res.status(403).json({ error: 'Not a party to this partnership' }); return; }

    const channelId = `partner:${partnershipId}`;
    const msg = await prisma.chatMessage.create({
      data: {
        orgId:       req.orgId as string,
        storeId:     info.mine.id,
        channelId,
        senderId:    req.user!.id,
        senderName:  req.user!.name || req.user!.email || 'Unknown',
        senderRole:  req.user!.role || '',
        message:     message.trim(),
        messageType,
        readBy:      [req.user!.id],
      },
    });
    res.status(201).json(msg);
  } catch (err) { next(err); }
};

// POST /api/chat/partner/read { partnershipId }
export const markPartnerRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { partnershipId } = req.body as { partnershipId?: string };
    if (!partnershipId) { res.status(400).json({ error: 'partnershipId required' }); return; }
    const info = await loadPartnershipForUser(req, partnershipId);
    if (!info) { res.status(403).json({ error: 'Not a party to this partnership' }); return; }

    const userId = req.user!.id;
    const unread = await prisma.chatMessage.findMany({
      where: { channelId: `partner:${partnershipId}`, NOT: { readBy: { has: userId } } },
      select: { id: true, readBy: true },
    });
    for (const m of unread) {
      await prisma.chatMessage.update({ where: { id: m.id }, data: { readBy: [...m.readBy, userId] } });
    }
    res.json({ marked: unread.length });
  } catch (err) { next(err); }
};
