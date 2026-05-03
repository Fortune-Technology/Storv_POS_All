/**
 * ticketController.ts
 * Store-side support ticket operations.
 * Scoped strictly to the authenticated user's orgId.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { sendTicketReplyToAssignee } from '../services/emailService.js';

interface TicketResponse {
  by: string;
  byType: 'store' | 'admin' | string;
  message: string;
  date: string;
}

/* ── GET /api/tickets ────────────────────────────────────────────────────── */
export const listOrgTickets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const { status, page = 1, limit = 20 } = req.query as { status?: string; page?: string | number; limit?: string | number };
    const skip  = (parseInt(String(page)) - 1) * parseInt(String(limit));
    const where: Prisma.SupportTicketWhereInput = { orgId };
    if (status) where.status = status;

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(String(limit)),
      }),
      prisma.supportTicket.count({ where }),
    ]);

    res.json({ success: true, data: tickets, total, page: parseInt(String(page)) });
  } catch (err) { next(err); }
};

/* ── POST /api/tickets ───────────────────────────────────────────────────── */
export const createOrgTicket = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const { subject, body, priority = 'normal' } = req.body as {
      subject?: string;
      body?: string;
      priority?: string;
    };

    if (!subject?.trim()) { res.status(400).json({ error: 'subject is required' }); return; }
    if (!body?.trim())    { res.status(400).json({ error: 'body is required' }); return; }

    const ticket = await prisma.supportTicket.create({
      data: {
        email:    req.user!.email,
        name:     req.user!.name,
        subject:  subject.trim(),
        body:     body.trim(),
        priority,
        orgId,
        userId:   req.user!.id,
        status:   'open',
        responses: [],
      },
    });

    res.status(201).json({ success: true, data: ticket });
  } catch (err) { next(err); }
};

/* ── GET /api/tickets/:id ────────────────────────────────────────────────── */
export const getOrgTicket = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId  = req.orgId as string;
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, orgId },
    });
    if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }
    res.json({ success: true, data: ticket });
  } catch (err) { next(err); }
};

/* ── POST /api/tickets/:id/reply ─────────────────────────────────────────── */
export const addStoreTicketReply = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId   = req.orgId as string;
    const { message } = req.body as { message?: string };
    if (!message?.trim()) { res.status(400).json({ error: 'message is required' }); return; }

    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, orgId },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
    });
    if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }
    if (ticket.status === 'closed') {
      res.status(400).json({ error: 'Cannot reply to a closed ticket' });
      return;
    }

    const responses: TicketResponse[] = Array.isArray(ticket.responses)
      ? [...(ticket.responses as unknown as TicketResponse[])]
      : [];
    responses.push({
      by:     req.user!.name || req.user!.email,
      byType: 'store',
      message: message.trim(),
      date:   new Date().toISOString(),
    });

    const updated = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data:  { responses: responses as unknown as Prisma.InputJsonValue },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
    });

    // Notify the assigned admin/superadmin so they see the org user's reply.
    if (updated.assignedTo) {
      sendTicketReplyToAssignee(updated.assignedTo.email, {
        ticket: {
          id: updated.id,
          subject: updated.subject,
          status: updated.status,
          priority: updated.priority,
          email: updated.email,
          name: updated.name,
        },
        assigneeName:  updated.assignedTo.name || 'there',
        replyFromName: req.user!.name || req.user!.email,
        replyText:     message.trim(),
      }).catch((err: Error) => console.warn('sendTicketReplyToAssignee:', err.message));
    }

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
};
