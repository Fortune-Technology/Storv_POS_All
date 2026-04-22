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
    let { channelId, recipientId, message, messageType = 'text' } = req.body;

    // If frontend sent `recipientId` instead of `channelId` (e.g. starting a
    // new DM), build the canonical sorted DM channelId ourselves.
    if (!channelId && recipientId) {
      const [a, b] = [req.user.id, recipientId].sort();
      channelId = `direct:${a}:${b}`;
    }

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

// ── Partner (cross-org) chat ────────────────────────────────────────────
// Uses existing ChatMessage with a `partner:{partnershipId}` channelId.
// orgId is still stored (sender's org), but queries for partner channels
// skip the orgId filter so both partner stores can read the same thread.

// Helper — verify caller's active store is a party to the partnership.
async function loadPartnershipForUser(req, partnershipId) {
  const userStoreIds = (req.user.stores || []).map(s => s.storeId);
  const activeStore = req.storeId || (userStoreIds[0] || null);
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
  // Allow if caller has access to either side's store via UserStore, or is owner/admin in either side's org.
  const isOwnerAdmin = ['owner', 'admin', 'superadmin'].includes(req.user.role);
  const ownsStore = userStoreIds.includes(tp.requesterStoreId) || userStoreIds.includes(tp.partnerStoreId);
  const isSameOrg = isOwnerAdmin && (
    req.user.orgId === tp.requesterStore.organization?.id ||
    req.user.orgId === tp.partnerStore.organization?.id
  );
  if (!ownsStore && !isSameOrg) return null;

  const mine = userStoreIds.includes(tp.requesterStoreId) || req.user.orgId === tp.requesterStore.organization?.id
    ? tp.requesterStore : tp.partnerStore;
  const other = mine.id === tp.requesterStore.id ? tp.partnerStore : tp.requesterStore;
  return { tp, mine, other, activeStore };
}

// GET /api/chat/partner/channels
export const getPartnerChannels = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userStoreIds = (req.user.stores || []).map(s => s.storeId);
    const isOwnerAdmin = ['owner', 'admin', 'superadmin'].includes(req.user.role);
    const orgId = req.orgId;

    // Partnerships this user can see: either their store participates OR they
    // are owner/admin of one of the parties' orgs.
    const partnerships = await prisma.tradingPartner.findMany({
      where: {
        status: 'accepted',
        OR: [
          userStoreIds.length > 0 ? { requesterStoreId: { in: userStoreIds } } : undefined,
          userStoreIds.length > 0 ? { partnerStoreId:   { in: userStoreIds } } : undefined,
          isOwnerAdmin ? { requesterStore: { orgId } } : undefined,
          isOwnerAdmin ? { partnerStore:   { orgId } } : undefined,
        ].filter(Boolean),
      },
      include: {
        requesterStore: { select: { id: true, name: true, storeCode: true, organization: { select: { id: true, name: true } } } },
        partnerStore:   { select: { id: true, name: true, storeCode: true, organization: { select: { id: true, name: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const channels = [];
    for (const p of partnerships) {
      const isRequesterSide = userStoreIds.includes(p.requesterStoreId) ||
        req.user.orgId === p.requesterStore.organization?.id;
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
export const getPartnerMessages = async (req, res, next) => {
  try {
    const { partnershipId, limit = 50, before } = req.query;
    if (!partnershipId) return res.status(400).json({ error: 'partnershipId required' });
    const info = await loadPartnershipForUser(req, partnershipId);
    if (!info) return res.status(403).json({ error: 'Not a party to this partnership' });

    const where = { channelId: `partner:${partnershipId}` };
    if (before) where.createdAt = { lt: new Date(before) };

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit), 100),
    });
    res.json({
      messages: messages.reverse(),
      partnership: { id: info.tp.id, mine: info.mine, other: info.other },
    });
  } catch (err) { next(err); }
};

// POST /api/chat/partner/messages { partnershipId, message }
export const sendPartnerMessage = async (req, res, next) => {
  try {
    const { partnershipId, message, messageType = 'text' } = req.body;
    if (!partnershipId || !message?.trim()) {
      return res.status(400).json({ error: 'partnershipId and message required' });
    }
    const info = await loadPartnershipForUser(req, partnershipId);
    if (!info) return res.status(403).json({ error: 'Not a party to this partnership' });

    const channelId = `partner:${partnershipId}`;
    const msg = await prisma.chatMessage.create({
      data: {
        orgId:       req.orgId,
        storeId:     info.mine.id,
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

// POST /api/chat/partner/read { partnershipId }
export const markPartnerRead = async (req, res, next) => {
  try {
    const { partnershipId } = req.body;
    if (!partnershipId) return res.status(400).json({ error: 'partnershipId required' });
    const info = await loadPartnershipForUser(req, partnershipId);
    if (!info) return res.status(403).json({ error: 'Not a party to this partnership' });

    const userId = req.user.id;
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
