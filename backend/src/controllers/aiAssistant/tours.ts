/**
 * AI Assistant product tours — public read + admin CRUD.
 * Split from `aiAssistantController.ts` (S80, refactor pass D, S53 pattern).
 *
 * Public handlers (any chat user — `ai_assistant.view`):
 *   - listPublicTours  GET    /tours       — list active tours scoped to caller
 *   - getTourBySlug    GET    /tours/:slug — full tour incl. steps array
 *
 * Admin handlers (`ai_assistant.manage`):
 *   - listTours        GET    /admin/tours?category=&active=
 *   - getTour          GET    /admin/tours/:id
 *   - createTour       POST   /admin/tours
 *   - updateTour       PUT    /admin/tours/:id
 *   - deleteTour       DELETE /admin/tours/:id (soft-delete by flipping active=false)
 *
 * Cross-tenant: same model as KB articles — non-superadmin admins see
 * `orgId=null` (platform-wide) plus their own org. Superadmin sees all + can
 * create platform-wide tours (orgId=null).
 *
 * Tour data shape: each tour stores a `steps` JSON array consumed by the
 * portal's TourRunner overlay. Schema validated at write-time only (steps
 * must be a non-empty array on create).
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';

export const listPublicTours = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tours = await prisma.productTour.findMany({
      where: {
        active: true,
        OR: [{ orgId: null }, ...(req.orgId ? [{ orgId: req.orgId }] : [])],
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true, slug: true, name: true, description: true,
        category: true, steps: true,
      },
    });
    type TourRow = (typeof tours)[number];
    res.json({
      success: true,
      tours: (tours as TourRow[]).map((t) => ({
        slug: t.slug, name: t.name, description: t.description,
        category: t.category, stepCount: Array.isArray(t.steps) ? t.steps.length : 0,
      })),
    });
  } catch (err) { next(err); }
};

export const getTourBySlug = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tour = await prisma.productTour.findFirst({
      where: {
        slug: req.params.slug,
        active: true,
        OR: [{ orgId: null }, ...(req.orgId ? [{ orgId: req.orgId }] : [])],
      },
      select: {
        id: true, slug: true, name: true, description: true,
        category: true, steps: true,
      },
    });
    if (!tour) { res.status(404).json({ error: 'Tour not found or inactive' }); return; }
    res.json({ success: true, tour });
  } catch (err) { next(err); }
};

export const listTours = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { category?: string; active?: string };
    const { category, active } = q;
    const where: Prisma.ProductTourWhereInput = {};
    if (req.user?.role !== 'superadmin') {
      where.OR = [{ orgId: null }, { orgId: req.orgId }];
    }
    if (category) where.category = category;
    if (active === 'true')  where.active = true;
    if (active === 'false') where.active = false;

    const tours = await prisma.productTour.findMany({
      where,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: {
        id: true, orgId: true, slug: true, name: true, description: true,
        category: true, triggers: true, steps: true, active: true,
        createdAt: true, updatedAt: true,
      },
    });
    res.json({ success: true, tours });
  } catch (err) { next(err); }
};

export const getTour = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tour = await prisma.productTour.findUnique({ where: { id: req.params.id } });
    if (!tour) { res.status(404).json({ error: 'Tour not found' }); return; }
    if (tour.orgId && tour.orgId !== req.orgId && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }
    res.json({ success: true, tour });
  } catch (err) { next(err); }
};

interface CreateTourBody {
  slug?: string;
  name?: string;
  description?: string;
  category?: string;
  triggers?: string[];
  steps?: unknown[];
}

export const createTour = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as CreateTourBody;
    const { slug, name, description, category = 'onboarding', triggers = [], steps = [] } = body;
    if (!slug?.trim() || !name?.trim()) {
      res.status(400).json({ error: 'slug and name are required' });
      return;
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      res.status(400).json({ error: 'steps must be a non-empty array' });
      return;
    }

    const tour = await prisma.productTour.create({
      data: {
        orgId:       req.user?.role === 'superadmin' ? null : req.orgId,
        slug:        slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        name:        name.trim(),
        description: description?.trim() || null,
        category,
        triggers:    Array.isArray(triggers) ? triggers : [],
        steps:       steps as Prisma.InputJsonValue,
        createdById: req.user!.id,
      },
      select: { id: true, slug: true, name: true },
    });
    res.status(201).json({ success: true, tour });
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === 'P2002') { res.status(409).json({ error: 'A tour with this slug already exists.' }); return; }
    next(err);
  }
};

export const updateTour = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const existing = await prisma.productTour.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Tour not found' }); return; }
    if (existing.orgId && existing.orgId !== req.orgId && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }

    const body = (req.body || {}) as Partial<CreateTourBody> & { active?: boolean };
    const { name, description, category, triggers, steps, active } = body;
    const data: Prisma.ProductTourUpdateInput = {};
    if (name        !== undefined) data.name        = String(name).trim();
    if (description !== undefined) data.description = description?.trim() || null;
    if (category    !== undefined) data.category    = category;
    if (Array.isArray(triggers))   data.triggers    = triggers;
    if (Array.isArray(steps))      data.steps       = steps as Prisma.InputJsonValue;
    if (typeof active === 'boolean') data.active    = active;

    const updated = await prisma.productTour.update({
      where: { id: req.params.id },
      data,
      select: { id: true, slug: true, name: true, active: true, updatedAt: true },
    });
    res.json({ success: true, tour: updated });
  } catch (err) { next(err); }
};

export const deleteTour = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const existing = await prisma.productTour.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Tour not found' }); return; }
    if (existing.orgId && existing.orgId !== req.orgId && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }
    await prisma.productTour.update({
      where: { id: req.params.id },
      data:  { active: false },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
};
