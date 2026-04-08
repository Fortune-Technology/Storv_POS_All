/**
 * ticketController.js
 * Store-side support ticket operations.
 * Scoped strictly to the authenticated user's orgId.
 */

import prisma from '../config/postgres.js';

/* ── GET /api/tickets ────────────────────────────────────────────────────── */
export const listOrgTickets = async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { status, page = 1, limit = 20 } = req.query;
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const where = { orgId };
    if (status) where.status = status;

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.supportTicket.count({ where }),
    ]);

    res.json({ success: true, data: tickets, total, page: parseInt(page) });
  } catch (err) { next(err); }
};

/* ── POST /api/tickets ───────────────────────────────────────────────────── */
export const createOrgTicket = async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { subject, body, priority = 'normal' } = req.body;

    if (!subject?.trim()) return res.status(400).json({ error: 'subject is required' });
    if (!body?.trim())    return res.status(400).json({ error: 'body is required' });

    const ticket = await prisma.supportTicket.create({
      data: {
        email:    req.user.email,
        name:     req.user.name,
        subject:  subject.trim(),
        body:     body.trim(),
        priority,
        orgId,
        userId:   req.user.id,
        status:   'open',
        responses: [],
      },
    });

    res.status(201).json({ success: true, data: ticket });
  } catch (err) { next(err); }
};

/* ── GET /api/tickets/:id ────────────────────────────────────────────────── */
export const getOrgTicket = async (req, res, next) => {
  try {
    const orgId  = req.orgId;
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, orgId },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ success: true, data: ticket });
  } catch (err) { next(err); }
};

/* ── POST /api/tickets/:id/reply ─────────────────────────────────────────── */
export const addStoreTicketReply = async (req, res, next) => {
  try {
    const orgId   = req.orgId;
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, orgId },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.status === 'closed') {
      return res.status(400).json({ error: 'Cannot reply to a closed ticket' });
    }

    const responses = Array.isArray(ticket.responses) ? [...ticket.responses] : [];
    responses.push({
      by:     req.user.name || req.user.email,
      byType: 'store',
      message: message.trim(),
      date:   new Date().toISOString(),
    });

    const updated = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data:  { responses },
    });

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
};
