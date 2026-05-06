/**
 * Lottery — Game catalog (per-store ticket types + price + commission).
 * Split from `lotteryController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (4):
 *   - getLotteryGames    GET    /lottery/games
 *   - createLotteryGame  POST   /lottery/games
 *   - updateLotteryGame  PUT    /lottery/games/:id
 *   - deleteLotteryGame  DELETE /lottery/games/:id (soft delete — flips active)
 *
 * Game-vs-Box: a Game is the SKU/price catalog ($1 / $2 / $5 / $10 / $20
 * scratch-off SKUs). A Box (next module) is one physical pack of that game
 * delivered by the lottery distributor.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { errMsg } from '../../utils/typeHelpers.js';
import { getOrgId, getStore } from './helpers.js';

// ══════════════════════════════════════════════════════════════════════════
// GAMES
// ══════════════════════════════════════════════════════════════════════════

export const getLotteryGames = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    // Get store's state from LotterySettings (if set)
    const settings = storeId
      ? await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null)
      : null;
    const storeState = settings?.state;

    const games = await prisma.lotteryGame.findMany({
      where: {
        deleted: false,
        OR: [
          // Store-specific games
          { orgId, storeId },
          // Global games matching this store's state (managed by admin)
          ...(storeState ? [{ orgId, isGlobal: true, state: storeState }] : []),
        ],
      },
      include: {
        boxes: {
          where: { status: { in: ['inventory', 'active'] } },
          select: { id: true, status: true, ticketsSold: true, totalTickets: true },
        },
      },
      orderBy: { ticketPrice: 'asc' },
    });
    res.json({ success: true, data: games });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const createLotteryGame = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { name, gameNumber, ticketPrice, ticketsPerBox, state, isGlobal } = req.body;
    if (!name || !ticketPrice) {
      res.status(400).json({ success: false, error: 'name and ticketPrice are required' });
      return;
    }
    const game = await prisma.lotteryGame.create({
      data: {
        orgId: orgId as string,
        storeId: storeId as string,
        name,
        gameNumber,
        ticketPrice: Number(ticketPrice),
        ticketsPerBox: Number(ticketsPerBox || 300),
        state: state || null,
        isGlobal: isGlobal ? true : false,
      },
    });
    res.json({ success: true, data: game });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateLotteryGame = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const game = await prisma.lotteryGame.findFirst({ where: { id, orgId } });
    if (!game) {
      res.status(404).json({ success: false, error: 'Game not found' });
      return;
    }
    const { name, gameNumber, ticketPrice, ticketsPerBox, active, state, isGlobal } = req.body;
    const updated = await prisma.lotteryGame.update({
      where: { id },
      data: {
        ...(name != null && { name }),
        ...(gameNumber != null && { gameNumber }),
        ...(ticketPrice != null && { ticketPrice: Number(ticketPrice) }),
        ...(ticketsPerBox != null && { ticketsPerBox: Number(ticketsPerBox) }),
        ...(active != null && { active: Boolean(active) }),
        ...(state != null && { state }),
        ...(isGlobal != null && { isGlobal: Boolean(isGlobal) }),
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deleteLotteryGame = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    await prisma.lotteryGame.updateMany({
      where: { id, orgId, storeId },
      data: { deleted: true, active: false },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

