/**
 * AI Assistant conversations — user-facing chat CRUD + send-message + escalate.
 * Split from `aiAssistantController.ts` (S80, refactor pass D, S53 pattern).
 *
 * Handlers (5 + 1 escalate):
 *   - listConversations    GET    /conversations
 *   - getConversation      GET    /conversations/:id
 *   - createConversation   POST   /conversations
 *   - sendMessage          POST   /conversations/:id/messages
 *   - deleteConversation   DELETE /conversations/:id
 *   - escalateConversation POST   /conversations/:id/escalate
 *
 * Ownership: all handlers scope by `userId: req.user.id`. A user can only
 * see/modify their own conversations.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { truncateTitle } from './helpers.js';
import { runToolLoop, anthropic, MODEL, type ToolCallTraceEntry } from './runner.js';

export const listConversations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const conversations = await prisma.aiConversation.findMany({
      where: { userId: req.user!.id },
      orderBy: { lastMessageAt: 'desc' },
      take: 30,
      select: {
        id: true, title: true, lastMessageAt: true, createdAt: true,
      },
    });
    res.json({ success: true, conversations });
  } catch (err) { next(err); }
};

export const getConversation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const conv = await prisma.aiConversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, role: true, content: true, feedback: true,
            feedbackNote: true, ticketId: true, createdAt: true,
          },
        },
      },
    });
    if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return; }
    res.json({ success: true, conversation: conv });
  } catch (err) { next(err); }
};

export const createConversation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const conv = await prisma.aiConversation.create({
      data: {
        orgId:    req.orgId || null,
        storeId:  req.storeId || null,
        userId:   req.user!.id,
        userRole: req.role || req.user?.role || null,
        userName: req.user?.name || null,
      },
      select: { id: true, title: true, lastMessageAt: true, createdAt: true },
    });
    res.status(201).json({ success: true, conversation: conv });
  } catch (err) { next(err); }
};

export const sendMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { content?: string };
    const { content } = body;
    if (!content?.trim()) { res.status(400).json({ error: 'content is required' }); return; }
    if (content.length > 4000) { res.status(400).json({ error: 'Message too long (max 4000 chars)' }); return; }

    const conv = await prisma.aiConversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return; }

    if (!anthropic) {
      res.status(503).json({
        error: 'AI assistant is not configured on this server. Contact support.',
      });
      return;
    }

    // Save the user message first so it's persisted even if Claude fails.
    const userMsg = await prisma.aiMessage.create({
      data: { conversationId: conv.id, role: 'user', content: content.trim() },
    });

    // Run the tool loop.
    let finalText = '';
    let toolCallsTrace: ToolCallTraceEntry[] = [];
    let totalTokens = 0;
    let ticketIdCreated: string | null = null;
    try {
      const r = await runToolLoop(conv, content.trim(), req);
      finalText = r.finalText;
      toolCallsTrace = r.toolCallsTrace;
      totalTokens = r.totalTokens;
      ticketIdCreated = r.ticketIdCreated;
    } catch (err) {
      console.error('[AiAssistant] tool loop error:', err);

      const msg = String((err as Error)?.message || '').toLowerCase();
      let friendly = 'I ran into an error processing your request. Please try again, or file a support ticket if the problem persists.';
      if (msg.includes('credit balance is too low') || msg.includes('insufficient_credit')) {
        friendly = '⚠ The AI service is temporarily unavailable — the provider account is out of credits. Please notify your StoreVeu administrator; service will resume once credits are topped up.';
      } else if (msg.includes('invalid x-api-key') || msg.includes('invalid api key') || msg.includes('authentication_error')) {
        friendly = '⚠ The AI service is misconfigured (invalid API key). Please contact your StoreVeu administrator.';
      } else if (msg.includes('rate_limit') || msg.includes('rate limit') || msg.includes('too many requests')) {
        friendly = '⚠ The AI service is being rate-limited. Please try again in a minute.';
      } else if (msg.includes('overloaded') || msg.includes('service_unavailable')) {
        friendly = '⚠ Anthropic\'s service is temporarily overloaded. Please try again in a moment.';
      }

      const errorMsg = await prisma.aiMessage.create({
        data: {
          conversationId: conv.id,
          role: 'assistant',
          content: friendly,
          model: MODEL,
        },
      });
      res.json({
        success: false,
        error: (err as Error).message,
        userMessage: userMsg,
        assistantMessage: errorMsg,
      });
      return;
    }

    // Save the assistant response.
    const assistantMsg = await prisma.aiMessage.create({
      data: {
        conversationId: conv.id,
        role: 'assistant',
        content: finalText,
        toolCalls: toolCallsTrace.length ? (toolCallsTrace as unknown as Prisma.InputJsonValue) : PrismaNS.JsonNull,
        tokenCount: totalTokens || null,
        model: MODEL,
        ticketId: ticketIdCreated || null,
      },
    });

    // Update conversation metadata (title + lastMessageAt).
    await prisma.aiConversation.update({
      where: { id: conv.id },
      data: {
        lastMessageAt: new Date(),
        title: conv.title || truncateTitle(content.trim()),
      },
    });

    res.json({
      success: true,
      userMessage: userMsg,
      assistantMessage: assistantMsg,
    });
  } catch (err) { next(err); }
};

export const deleteConversation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await prisma.aiConversation.deleteMany({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (result.count === 0) { res.status(404).json({ error: 'Conversation not found' }); return; }
    res.json({ success: true });
  } catch (err) { next(err); }
};

/**
 * User-initiated escalation — "File a ticket about this conversation".
 * Bundles the last ~10 messages as the ticket body for context.
 */
export const escalateConversation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { subject?: string; priority?: string };
    const { subject, priority = 'normal' } = body;
    if (!subject?.trim()) { res.status(400).json({ error: 'subject is required' }); return; }

    const conv = await prisma.aiConversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return; }

    const recent = await prisma.aiMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { role: true, content: true, createdAt: true },
    });
    type RecentMsg = (typeof recent)[number];
    const transcript = (recent as RecentMsg[])
      .reverse()
      .map((m) => `[${m.role.toUpperCase()}] ${m.content}`)
      .join('\n\n');

    const ticket = await prisma.supportTicket.create({
      data: {
        email:    req.user!.email,
        name:     req.user!.name,
        subject:  subject.trim().slice(0, 300),
        body:     `Escalated from AI Assistant conversation ${conv.id}.\n\n--- Transcript (last 10 messages) ---\n\n${transcript}`,
        priority: ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
        orgId:    req.orgId,
        userId:   req.user!.id,
        status:   'open',
        responses: [] as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, subject: true, status: true, priority: true, createdAt: true },
    });

    // Tack a system-style assistant message onto the conversation.
    const note = await prisma.aiMessage.create({
      data: {
        conversationId: conv.id,
        role: 'assistant',
        content: `✓ Support ticket **#${ticket.id.slice(-6)}** filed. The StoreVeu team will respond in **Support & Billing → Support Tickets**.`,
        ticketId: ticket.id,
      },
    });

    res.status(201).json({ success: true, ticket, message: note });
  } catch (err) { next(err); }
};
