/**
 * Lottery — Ticket Catalog (admin-managed) + Ticket Requests (store-submitted)
 *           + receiveFromCatalog + syncLotteryCatalog (state-side adapter pull).
 * Split from `lotteryController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (11):
 *   Ticket Catalog (5) — admin maintains a state-scoped game catalog so
 *   stores don't have to type ticket prices/numbers from scratch:
 *     - getCatalogTickets    GET    /lottery/catalog?state=
 *     - getAllCatalogTickets GET    /lottery/catalog/all
 *     - createCatalogTicket  POST   /lottery/catalog
 *     - updateCatalogTicket  PUT    /lottery/catalog/:id
 *     - deleteCatalogTicket  DELETE /lottery/catalog/:id
 *
 *   Ticket Requests (4) — stores ask admin to add new tickets to the catalog:
 *     - getTicketRequests       GET   /lottery/ticket-requests
 *     - createTicketRequest     POST  /lottery/ticket-requests
 *     - reviewTicketRequest     POST  /lottery/ticket-requests/:id/review
 *     - getPendingRequestCount  GET   /lottery/ticket-requests/pending-count
 *
 *   Receive (1) — store accepts a delivery referencing a catalog entry:
 *     - receiveFromCatalog   POST /lottery/receive-from-catalog
 *
 *   Catalog Sync (1) — admin pulls the live state lottery list from the state
 *   adapter (MA / RJR / etc.) into the local LotteryTicketCatalog table:
 *     - syncLotteryCatalog   POST /lottery/catalog/sync (?state= or all)
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { errMsg } from '../../utils/typeHelpers.js';
import {
  getAdapter as _getAdapter,
  syncState as _syncState,
  syncAllSupported as _syncAllSupported,
} from '../../services/lottery/index.js';
import { getOrgId, getStore, parseDate } from './helpers.js';
import { resolveOrCreateStoreGame } from './boxes.js';

// ══════════════════════════════════════════════════════════════════════════
// TICKET CATALOG  (superadmin/admin – platform-wide, state-scoped)
// ══════════════════════════════════════════════════════════════════════════

/** Stores call this — returns only tickets for the store's state */
export const getCatalogTickets = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStore(req);
    const { state, all } = req.query;

    let filterState = state as string | undefined;
    if (!filterState && storeId) {
      const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
      filterState = settings?.state ?? undefined;
    }

    const tickets = await prisma.lotteryTicketCatalog.findMany({
      where: {
        active: true,
        ...(filterState && all !== 'true' ? { state: filterState } : {}),
      },
      orderBy: [{ state: 'asc' }, { ticketPrice: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/** Admin calls this — returns ALL tickets (optionally filtered by state) */
export const getAllCatalogTickets = async (req: Request, res: Response): Promise<void> => {
  try {
    const { state } = req.query;
    const tickets = await prisma.lotteryTicketCatalog.findMany({
      where: { ...(state ? { state: state as string } : {}) },
      orderBy: [{ state: 'asc' }, { ticketPrice: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const createCatalogTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, gameNumber, ticketPrice, ticketsPerBook, state, category } = req.body;
    if (!name || !ticketPrice || !state) {
      res
        .status(400)
        .json({ success: false, error: 'name, ticketPrice, and state are required' });
      return;
    }
    const ticket = await prisma.lotteryTicketCatalog.create({
      data: {
        name,
        gameNumber: gameNumber || null,
        ticketPrice: Number(ticketPrice),
        ticketsPerBook: Number(ticketsPerBook || 300),
        state,
        category: category || null,
        createdBy: req.user?.id || null,
      },
    });
    res.json({ success: true, data: ticket });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateCatalogTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, gameNumber, ticketPrice, ticketsPerBook, state, category, active } = req.body;
    const ticket = await prisma.lotteryTicketCatalog.update({
      where: { id },
      data: {
        ...(name != null && { name }),
        ...(gameNumber != null && { gameNumber }),
        ...(ticketPrice != null && { ticketPrice: Number(ticketPrice) }),
        ...(ticketsPerBook != null && { ticketsPerBook: Number(ticketsPerBook) }),
        ...(state != null && { state }),
        ...(category != null && { category }),
        ...(active != null && { active: Boolean(active) }),
      },
    });
    res.json({ success: true, data: ticket });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deleteCatalogTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.lotteryTicketCatalog.update({ where: { id }, data: { active: false } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// TICKET REQUESTS  (stores submit, admins review)
// ══════════════════════════════════════════════════════════════════════════

export const getTicketRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { status } = req.query;
    const isAdmin = ['superadmin', 'admin'].includes(req.user?.role || '');

    const requests = await prisma.lotteryTicketRequest.findMany({
      where: {
        ...(isAdmin ? { orgId } : { orgId, storeId }),
        ...(status ? { status: status as string } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: requests });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const createTicketRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { name, gameNumber, ticketPrice, ticketsPerBook, state, notes, storeName } = req.body;
    if (!name) {
      res.status(400).json({ success: false, error: 'name is required' });
      return;
    }

    const request = await prisma.lotteryTicketRequest.create({
      data: {
        orgId: orgId as string,
        storeId: storeId as string,
        storeName: storeName || null,
        name,
        gameNumber: gameNumber || null,
        ticketPrice: ticketPrice ? Number(ticketPrice) : null,
        ticketsPerBook: ticketsPerBook ? Number(ticketsPerBook) : null,
        state: state || null,
        notes: notes || null,
        status: 'pending',
      },
    });
    res.json({ success: true, data: request });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const reviewTicketRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, adminNotes, addToCatalog, catalogData } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      res.status(400).json({ success: false, error: 'status must be approved or rejected' });
      return;
    }

    let resolvedCatalogId: string | null = null;

    if (status === 'approved' && addToCatalog && catalogData) {
      const cat = await prisma.lotteryTicketCatalog.create({
        data: {
          name: catalogData.name,
          gameNumber: catalogData.gameNumber || null,
          ticketPrice: Number(catalogData.ticketPrice),
          ticketsPerBook: Number(catalogData.ticketsPerBook || 300),
          state: catalogData.state,
          category: catalogData.category || null,
          createdBy: req.user?.id || null,
        },
      });
      resolvedCatalogId = cat.id;
    }

    const updated = await prisma.lotteryTicketRequest.update({
      where: { id },
      data: { status, adminNotes: adminNotes || null, resolvedCatalogId },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const getPendingRequestCount = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const count = await prisma.lotteryTicketRequest.count({
      where: { orgId, status: 'pending' },
    });
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};


// ══════════════════════════════════════════════════════════════════════════
// RECEIVE FROM CATALOG
// ══════════════════════════════════════════════════════════════════════════
// RECEIVE FROM CATALOG
// Store selects a catalog ticket + enters qty → auto-creates a local
// LotteryGame (if none exists) then creates LotteryBox records.
// ══════════════════════════════════════════════════════════════════════════

export const receiveFromCatalog = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const { catalogTicketId, qty, date: dateStr } = req.body;

    if (!catalogTicketId || !qty || Number(qty) < 1) {
      res
        .status(400)
        .json({ success: false, error: 'catalogTicketId and qty (≥1) are required' });
      return;
    }

    // Apr 2026 — accept `date` for retroactive receives (parity with
    // receiveBoxOrder). See that handler for full rationale.
    // May 2026 — store-local-day boundaries (was UTC-end-of-day which
    // misclassified the receive in non-US timezones).
    let receivedAt: Date | null = null;
    if (dateStr) {
      const parsed = parseDate(dateStr);
      if (!parsed) {
        res.status(400).json({ success: false, error: 'Invalid date (expected YYYY-MM-DD)' });
        return;
      }
      const storeRow = await prisma.store.findUnique({
        where: { id: storeId as string },
        select: { timezone: true },
      });
      const tz = storeRow?.timezone || 'UTC';
      const { localDayEndUTC, formatLocalDate } = await import('../../utils/dateTz.js');
      const now = new Date();
      const todayLocal = formatLocalDate(now, tz);
      if (dateStr > todayLocal) {
        res.status(400).json({ success: false, error: 'Receive date cannot be in the future.' });
        return;
      }
      const computed: Date = localDayEndUTC(dateStr, tz);
      receivedAt = computed.getTime() > now.getTime() ? now : computed;
    }

    // Route through the shared resolver — stores the REAL gameNumber on the
    // store-level LotteryGame (fixes the legacy "catalog:xxx" synthetic-ref
    // bug that prevented scan-driven receive from matching the catalog).
    // If a legacy row already exists with the synthetic ref, the resolver
    // returns that existing row unchanged so we don't create a duplicate.
    const game = await resolveOrCreateStoreGame({ orgId, storeId, catalogTicketId });

    const boxes = await Promise.all(
      Array.from({ length: Number(qty) }, () =>
        prisma.lotteryBox.create({
          data: {
            orgId,
            storeId,
            gameId: game.id,
            totalTickets: game.ticketsPerBox,
            ticketPrice: Number(game.ticketPrice),
            totalValue: Number(game.ticketPrice) * game.ticketsPerBox,
            status: 'inventory',
            ...(receivedAt && { createdAt: receivedAt }),
          },
        }),
      ),
    );

    res.json({ success: true, data: boxes, game, count: boxes.length });
  } catch (err) {
    console.error('[lottery.receiveFromCatalog]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// CATALOG SYNC (Phase 3b)
// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/lottery/catalog/sync
 * Body: { state?: 'MA' | 'all' }
 *
 * Only MA is supported today; adding ME will extend this endpoint
 * without a route change. Returns a per-state diff summary.
 */
export const syncLotteryCatalog = async (req: Request, res: Response): Promise<void> => {
  try {
    const state = String(req.body?.state || 'all').toUpperCase();
    if (state === 'ALL') {
      const results = await _syncAllSupported();
      res.json({ success: true, results });
      return;
    }

    interface UnsupportedStateError extends Error {
      code?: string;
    }
    const diff = await _syncState(state).catch((err: UnsupportedStateError) => {
      if (err.code === 'UNSUPPORTED_STATE') return { state, error: err.message, unsupported: true };
      throw err;
    });
    res.json({ success: true, result: diff });
  } catch (err) {
    console.error('[lottery.catalog.sync]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

