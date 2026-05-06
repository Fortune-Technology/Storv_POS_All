/**
 * AI Assistant KB article management (ai_assistant.manage).
 * Split from `aiAssistantController.ts` (S80, refactor pass D, S53 pattern).
 *
 * Handlers (5):
 *   - listKbArticles    GET    /admin/articles?category=&active=&source=&search=&limit=
 *   - getKbArticle      GET    /admin/articles/:id (strips embedding from response)
 *   - createKbArticle   POST   /admin/articles    (auto-generates embedding)
 *   - updateKbArticle   PUT    /admin/articles/:id (regenerates embedding on title/content change)
 *   - deleteKbArticle   DELETE /admin/articles/:id (soft-delete by flipping active=false)
 *
 * Cross-tenant: org admins see/edit `orgId=null` (platform-wide) + their own org's
 * articles. Superadmin sees all + can create platform-wide articles.
 *
 * Seed protection: articles with `source='seed'` can only be hard-deleted by
 * superadmin — protects the curated initial KB from accidental deletion.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

export const listKbArticles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { category?: string; active?: string; source?: string; search?: string; limit?: string };
    const { category, active, source, search } = q;
    const limit = q.limit || '100';
    const where: Prisma.AiKnowledgeArticleWhereInput = {};
    if (req.user?.role !== 'superadmin') {
      where.OR = [{ orgId: null }, { orgId: req.orgId }];
    }
    if (category) where.category = category;
    if (source)   where.source   = source;
    if (active === 'true')  where.active = true;
    if (active === 'false') where.active = false;
    if (search)   where.OR = [
      { title:   { contains: search, mode: 'insensitive' } },
      { content: { contains: search, mode: 'insensitive' } },
    ];

    const articles = await prisma.aiKnowledgeArticle.findMany({
      where,
      orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
      take: clamp(parseInt(limit, 10), 1, 500),
      select: {
        id: true, orgId: true, category: true, title: true, content: true,
        tags: true, source: true, helpfulCount: true, unhelpfulCount: true,
        createdById: true, active: true, createdAt: true, updatedAt: true,
      },
    });
    res.json({ success: true, articles });
  } catch (err) { next(err); }
};

export const getKbArticle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const article = await prisma.aiKnowledgeArticle.findUnique({
      where: { id: req.params.id },
    });
    if (!article) { res.status(404).json({ error: 'Article not found' }); return; }
    if (article.orgId && article.orgId !== req.orgId && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }
    // Strip embedding from response — huge, not useful to clients.
    const { embedding: _emb, ...rest } = article;
    res.json({ success: true, article: rest });
  } catch (err) { next(err); }
};

export const createKbArticle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { title?: string; content?: string; category?: string; tags?: string[]; orgId?: string | null };
    const { title, content, category = 'how-to', tags = [], orgId: orgOverride } = body;
    if (!title?.trim() || !content?.trim()) {
      res.status(400).json({ error: 'title and content are required' });
      return;
    }
    const { generateEmbedding } = await import('../../services/kbService.js');
    const embedding = await generateEmbedding(`${title}\n\n${content}`);
    if (!embedding) {
      res.status(503).json({ error: 'Embedding service unavailable. Cannot create article.' });
      return;
    }
    const article = await prisma.aiKnowledgeArticle.create({
      data: {
        orgId: req.user?.role === 'superadmin' ? (orgOverride ?? null) : req.orgId,
        category,
        title:       title.trim().slice(0, 300),
        content:     content.trim(),
        embedding,
        source:      'admin',
        tags:        Array.isArray(tags) ? tags : [],
        createdById: req.user!.id,
      },
      select: { id: true, title: true, category: true, orgId: true },
    });
    res.status(201).json({ success: true, article });
  } catch (err) { next(err); }
};

export const updateKbArticle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const existing = await prisma.aiKnowledgeArticle.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Article not found' }); return; }
    if (existing.orgId && existing.orgId !== req.orgId && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }

    const body = (req.body || {}) as { title?: string; content?: string; category?: string; tags?: string[]; active?: boolean };
    const { title, content, category, tags, active } = body;
    const data: Prisma.AiKnowledgeArticleUpdateInput = {};
    if (title   !== undefined) data.title   = String(title).trim().slice(0, 300);
    if (content !== undefined) data.content = String(content).trim();
    if (category !== undefined) data.category = category;
    if (Array.isArray(tags))   data.tags = tags;
    if (typeof active === 'boolean') data.active = active;

    // Regenerate embedding if title or content changed.
    if (data.title !== undefined || data.content !== undefined) {
      const { generateEmbedding } = await import('../../services/kbService.js');
      const newTitle   = (data.title as string | undefined)   ?? existing.title;
      const newContent = (data.content as string | undefined) ?? existing.content;
      const embedding = await generateEmbedding(`${newTitle}\n\n${newContent}`);
      if (!embedding) {
        res.status(503).json({ error: 'Embedding service unavailable. Cannot update.' });
        return;
      }
      data.embedding = embedding;
    }

    const updated = await prisma.aiKnowledgeArticle.update({
      where: { id: req.params.id },
      data,
      select: { id: true, title: true, category: true, active: true, updatedAt: true },
    });
    res.json({ success: true, article: updated });
  } catch (err) { next(err); }
};

export const deleteKbArticle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const existing = await prisma.aiKnowledgeArticle.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Article not found' }); return; }
    if (existing.orgId && existing.orgId !== req.orgId && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }
    if (existing.source === 'seed' && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Seed articles can only be hard-deleted by superadmin.' });
      return;
    }
    await prisma.aiKnowledgeArticle.update({
      where: { id: req.params.id },
      data:  { active: false },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
};
