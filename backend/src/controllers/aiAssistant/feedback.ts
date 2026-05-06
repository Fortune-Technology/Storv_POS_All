/**
 * AI Assistant feedback + admin review queue.
 * Split from `aiAssistantController.ts` (S80, refactor pass D, S53 pattern).
 *
 * Handlers (5):
 *   - submitFeedback         POST   /messages/:id/feedback
 *                            (user-facing; auto-escalates on 👎+note)
 *
 * Admin review queue (ai_assistant.manage):
 *   - listReviews            GET    /admin/reviews?status=
 *   - getReviewConversation  GET    /admin/reviews/:id/conversation
 *   - promoteReview          POST   /admin/reviews/:id/promote (creates KB article)
 *   - dismissReview          POST   /admin/reviews/:id/dismiss
 *
 * Auto-escalation flow: when a user marks an assistant message 👎 AND leaves a
 * note, an `AiFeedbackReview` row is upserted into the queue so admins can
 * either promote the corrected answer to the KB or dismiss it.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';

export const submitFeedback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { feedback?: 'helpful' | 'unhelpful' | null; note?: string };
    const { feedback, note } = body;
    if (!['helpful', 'unhelpful', null].includes(feedback as 'helpful' | 'unhelpful' | null)) {
      res.status(400).json({ error: 'feedback must be "helpful", "unhelpful", or null' });
      return;
    }

    // Ownership check — user must own the conversation this message belongs to.
    const msg = await prisma.aiMessage.findFirst({
      where: {
        id: req.params.id,
        role: 'assistant',
        conversation: { userId: req.user!.id },
      },
      include: {
        conversation: { select: { id: true, orgId: true } },
      },
    });
    if (!msg) { res.status(404).json({ error: 'Message not found' }); return; }

    const noteTrimmed = typeof note === 'string' ? note.trim() : null;
    const updated = await prisma.aiMessage.update({
      where: { id: msg.id },
      data: {
        feedback,
        feedbackNote: feedback === 'unhelpful' ? (noteTrimmed || null) : null,
      },
      select: { id: true, feedback: true, feedbackNote: true },
    });

    // Auto-escalation: if 👎 + note, enqueue an AiFeedbackReview row.
    if (feedback === 'unhelpful' && noteTrimmed) {
      const priorUser = await prisma.aiMessage.findFirst({
        where: {
          conversationId: msg.conversationId,
          role: 'user',
          createdAt: { lt: msg.createdAt },
        },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      });

      await prisma.aiFeedbackReview.upsert({
        where: { messageId: msg.id },
        create: {
          orgId:          msg.conversation.orgId,
          messageId:      msg.id,
          conversationId: msg.conversationId,
          question:       priorUser?.content || '(no prior user message)',
          aiResponse:     msg.content,
          userSuggestion: noteTrimmed,
          status:         'pending',
        },
        update: {
          userSuggestion: noteTrimmed,
          status: undefined,
        },
      });
    }

    res.json({ success: true, message: updated });
  } catch (err) { next(err); }
};

/* ── Admin review queue (ai_assistant.manage) ────────────────────────────── */

export const listReviews = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { status?: string };
    const status = q.status || 'pending';
    const where: Prisma.AiFeedbackReviewWhereInput = { status };
    // Scope: admins see their own org's reviews; superadmin sees all.
    if (req.user?.role !== 'superadmin') where.orgId = req.orgId;

    const reviews = await prisma.aiFeedbackReview.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    type ReviewRow = (typeof reviews)[number];

    const articleIds = (reviews as ReviewRow[]).map((r) => r.articleId).filter((x): x is string => !!x);
    const articles = articleIds.length
      ? await prisma.aiKnowledgeArticle.findMany({
          where: { id: { in: articleIds } },
          select: { id: true, title: true },
        })
      : [];
    type ArticleRow = (typeof articles)[number];
    const titleById = Object.fromEntries((articles as ArticleRow[]).map((a) => [a.id, a.title]));

    res.json({
      success: true,
      reviews: (reviews as ReviewRow[]).map((r) => ({
        ...r,
        articleTitle: r.articleId ? (titleById[r.articleId] || null) : null,
      })),
    });
  } catch (err) { next(err); }
};

export const promoteReview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { title?: string; content?: string; category?: string; tags?: string[] };
    const { title, content, category = 'how-to', tags = [] } = body;
    if (!title?.trim() || !content?.trim()) {
      res.status(400).json({ error: 'title and content are required' });
      return;
    }

    const review = await prisma.aiFeedbackReview.findUnique({ where: { id: req.params.id } });
    if (!review) { res.status(404).json({ error: 'Review not found' }); return; }
    if (review.status !== 'pending') {
      res.status(400).json({ error: `Review is already ${review.status}` });
      return;
    }

    // Generate embedding for the new article. Fail cleanly if unavailable.
    const { generateEmbedding } = await import('../../services/kbService.js');
    const embedding = await generateEmbedding(`${title}\n\n${content}`);
    if (!embedding) {
      res.status(503).json({ error: 'Embedding service unavailable. Cannot promote without an embedding.' });
      return;
    }

    const article = await prisma.aiKnowledgeArticle.create({
      data: {
        orgId:       req.user?.role === 'superadmin' ? null : req.orgId,
        category,
        title:       title.trim(),
        content:     content.trim(),
        embedding,
        source:      'admin',
        tags:        Array.isArray(tags) ? tags : [],
        createdById: req.user!.id,
      },
      select: { id: true, title: true, category: true },
    });

    await prisma.aiFeedbackReview.update({
      where: { id: review.id },
      data:  {
        status:       'promoted',
        reviewedById: req.user!.id,
        reviewedAt:   new Date(),
        articleId:    article.id,
      },
    });

    res.json({ success: true, article });
  } catch (err) { next(err); }
};

export const dismissReview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const review = await prisma.aiFeedbackReview.findUnique({ where: { id: req.params.id } });
    if (!review) { res.status(404).json({ error: 'Review not found' }); return; }
    if (review.status !== 'pending') {
      res.status(400).json({ error: `Review is already ${review.status}` });
      return;
    }
    await prisma.aiFeedbackReview.update({
      where: { id: review.id },
      data:  { status: 'dismissed', reviewedById: req.user!.id, reviewedAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
};

export const getReviewConversation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const review = await prisma.aiFeedbackReview.findUnique({ where: { id: req.params.id } });
    if (!review) { res.status(404).json({ error: 'Review not found' }); return; }
    if (req.user?.role !== 'superadmin' && review.orgId !== req.orgId) {
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }
    if (!review.conversationId) {
      res.json({ success: true, messages: [] });
      return;
    }
    const messages = await prisma.aiMessage.findMany({
      where: { conversationId: review.conversationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, feedback: true, createdAt: true },
    });
    res.json({ success: true, review, messages });
  } catch (err) { next(err); }
};
