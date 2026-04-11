/**
 * Chat Controller — Internal messaging between cashier ↔ back-office.
 *
 * Channels:
 *   "store:{storeId}"              — store-wide chat (all staff in a store)
 *   "direct:{userId1}:{userId2}"   — direct message between two users
 */

import prisma from '../config/postgres.js';

const r = (n) => Math.round(n * 100) / 100;

// ── GET /api/chat/channels — List available channels for the user ──────────
export const getChannels = async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const userId = req.user.id;

    // Get stores this user belongs to
    const userStores = req.user.stores?.map(s => s.storeId) || [];
    const stores = await prisma.store.findMany({
      where: { orgId, ...(userStores.length > 0 && req.user.role !== 'owner' && req.user.role !== 'admin' && req.user.role !== 'superadmin' ? { id: { in: userStores } } : {}) },
      select: { id: true, name: true },
    });

    // Build store channels
    const channels = stores.map(s => ({
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
      where: { orgId, channelId: { startsWith: 'direct:' }, channelId: { contains: userId } },
      select: { channelId: true },
      distinct: ['channelId'],
    });

    const dmChannelIds = [...new Set([...directMessages.map(d => d.channelId), ...receivedDMs.map(d => d.channelId)])];

    // Get latest message + unread count per channel
    for (const ch of channels) {
      const latest = await prisma.chatMessage.findFirst({ where: { orgId, channelId: ch.id }, orderBy: { createdAt: 'desc' }, select: { message: true, senderName: true, createdAt: true } });
      const unread = await prisma.chatMessage.count({ where: { orgId, channelId: ch.id, NOT: { readBy: { has: userId } }, senderId: { not: userId } } });
      ch.lastMessage = latest || null;
      ch.unreadCount = unread;
    }

    // Add DM channels
    for (const chId of dmChannelIds) {
      const parts = chId.split(':');
      const otherUserId = parts[1] === userId ? parts[2] : parts[1];
      const otherUser = await prisma.user.findUnique({ where: { id: otherUserId }, select: { name: true } }).catch(() => null);
      const latest = await prisma.chatMessage.findFirst({ where: { orgId, channelId: chId }, orderBy: { createdAt: 'desc' }, select: { message: true, senderName: true, createdAt: true } });
      const unread = await prisma.chatMessage.count({ where: { orgId, channelId: chId, NOT: { readBy: { has: userId } }, senderId: { not: userId } } });
      channels.push({ id: chId, name: otherUser?.name || 'Unknown', type: 'direct', lastMessage: latest, unreadCount: unread });
    }

    res.json({ channels });
  } catch (err) { next(err); }
};

// ── GET /api/chat/messages?channelId=...&limit=50&before=... ────────────
export const getMessages = async (req, res, next) => {
  try {
    const { channelId, limit = 50, before } = req.query;
    if (!channelId) return res.status(400).json({ error: 'channelId required' });

    const where = { orgId: req.orgId, channelId };
    if (before) where.createdAt = { lt: new Date(before) };

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit), 100),
    });

    res.json({ messages: messages.reverse() });
  } catch (err) { next(err); }
};

// ── POST /api/chat/messages — Send a message ────────────────────────────
export const sendMessage = async (req, res, next) => {
  try {
    const { channelId, message, messageType = 'text' } = req.body;
    if (!channelId || !message?.trim()) return res.status(400).json({ error: 'channelId and message required' });

    const storeId = channelId.startsWith('store:') ? channelId.split(':')[1] : null;

    const msg = await prisma.chatMessage.create({
      data: {
        orgId:       req.orgId,
        storeId,
        channelId,
        senderId:    req.user.id,
        senderName:  req.user.name || req.user.email || 'Unknown',
        senderRole:  req.user.role,
        message:     message.trim(),
        messageType,
        readBy:      [req.user.id],
      },
    });

    res.status(201).json(msg);
  } catch (err) { next(err); }
};

// ── POST /api/chat/read — Mark messages as read ─────────────────────────
export const markRead = async (req, res, next) => {
  try {
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId required' });

    const userId = req.user.id;
    const unread = await prisma.chatMessage.findMany({
      where: { orgId: req.orgId, channelId, NOT: { readBy: { has: userId } } },
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
export const getUnreadCount = async (req, res, next) => {
  try {
    const count = await prisma.chatMessage.count({
      where: { orgId: req.orgId, NOT: { readBy: { has: req.user.id } }, senderId: { not: req.user.id } },
    });
    res.json({ count });
  } catch (err) { next(err); }
};

// ── GET /api/chat/users — List users for starting DMs ───────────────────
export const getChatUsers = async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { orgId: req.orgId, status: 'active', id: { not: req.user.id } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json({ users });
  } catch (err) { next(err); }
};
