/**
 * Price Scenario Controller — superadmin-only.
 *
 * Stores saved Interchange-plus pricing scenarios that the sales team uses
 * to pitch the StoreVeu processing model to prospective merchants. Not
 * tenant-scoped — these live at the platform level and are managed from the
 * admin panel. All routes require role === 'superadmin'.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

// ── GET /api/price-scenarios ─────────────────────────────────────────────
export const listPriceScenarios = async (req: Request, res: Response): Promise<void> => {
  try {
    const { search } = req.query as { search?: string };
    const where: Prisma.PriceScenarioWhereInput = {};
    if (search) {
      where.OR = [
        { storeName: { contains: search, mode: 'insensitive' } },
        { location:  { contains: search, mode: 'insensitive' } },
      ];
    }
    const scenarios = await prisma.priceScenario.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
    res.json({ scenarios });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

// ── GET /api/price-scenarios/:id ─────────────────────────────────────────
export const getPriceScenario = async (req: Request, res: Response): Promise<void> => {
  try {
    const scenario = await prisma.priceScenario.findUnique({
      where: { id: req.params.id },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
    if (!scenario) { res.status(404).json({ error: 'Scenario not found' }); return; }
    res.json(scenario);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

interface ScenarioBody {
  storeName?: string;
  location?: string | null;
  mcc?: string | null;
  notes?: string | null;
  inputs?: Record<string, unknown>;
  results?: Record<string, unknown>;
}

// ── POST /api/price-scenarios ────────────────────────────────────────────
export const createPriceScenario = async (req: Request, res: Response): Promise<void> => {
  try {
    const { storeName, location, mcc, notes, inputs, results } = req.body as ScenarioBody;
    if (!storeName || !String(storeName).trim()) {
      res.status(400).json({ error: 'storeName is required' });
      return;
    }
    if (!inputs || typeof inputs !== 'object') {
      res.status(400).json({ error: 'inputs object is required' });
      return;
    }
    if (!results || typeof results !== 'object') {
      res.status(400).json({ error: 'results object is required' });
      return;
    }

    const scenario = await prisma.priceScenario.create({
      data: {
        storeName:   String(storeName).trim(),
        location:    location ? String(location).trim() : null,
        mcc:         mcc ? String(mcc).trim() : null,
        notes:       notes ? String(notes) : null,
        inputs:      inputs as Prisma.InputJsonValue,
        results:     results as Prisma.InputJsonValue,
        createdById: req.user?.id || null,
      },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
    res.status(201).json(scenario);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

// ── PUT /api/price-scenarios/:id ─────────────────────────────────────────
export const updatePriceScenario = async (req: Request, res: Response): Promise<void> => {
  try {
    const { storeName, location, mcc, notes, inputs, results } = req.body as ScenarioBody;

    const existing = await prisma.priceScenario.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Scenario not found' }); return; }

    const data: Prisma.PriceScenarioUpdateInput = {};
    if (storeName !== undefined) data.storeName = String(storeName).trim();
    if (location  !== undefined) data.location  = location ? String(location).trim() : null;
    if (mcc       !== undefined) data.mcc       = mcc ? String(mcc).trim() : null;
    if (notes     !== undefined) data.notes     = notes ? String(notes) : null;
    if (inputs    !== undefined) data.inputs    = inputs as Prisma.InputJsonValue;
    if (results   !== undefined) data.results   = results as Prisma.InputJsonValue;

    const scenario = await prisma.priceScenario.update({
      where: { id: req.params.id },
      data,
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
    res.json(scenario);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

// ── DELETE /api/price-scenarios/:id ──────────────────────────────────────
export const deletePriceScenario = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.priceScenario.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Scenario not found' }); return; }

    await prisma.priceScenario.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};
