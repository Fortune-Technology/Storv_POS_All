// Daily Sale — back-office unified daily reconciliation (Phase 3d).
//
// Endpoints under /api/daily-sale:
//   GET    /:date?    → computed snapshot (auto + saved adjustments)
//   PUT    /:date     → save user-entered adjustments + manual values
//   POST   /:date/close → flip status to 'closed' (irreversible)

import type { Request, Response } from 'express';
import prisma from '../config/postgres.js';
import {
  computeDailySale,
  saveDailySaleAdjustments,
  closeDailySale,
} from '../services/dailySaleService.js';

function getOrg(req: Request): string | null | undefined {
  return req.orgId || req.user?.orgId;
}
function getStore(req: Request): string | null | undefined {
  return (req.headers['x-store-id'] as string | undefined)
    || req.storeId
    || (req.query.storeId as string | undefined);
}

// Validate-only — caller computes the default in store-local tz.
function validateDateParam(raw: unknown): string | null {
  if (!raw) return null;  // caller must default
  if (typeof raw !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

// "Today" in the store's timezone (not the server's). Without this, a
// Pacific-time admin opening the daily-sale page at 9pm PT sees the next
// day by default.
async function _todayInStoreTz(storeId: string): Promise<string> {
  const { getStoreTimezone, formatLocalDate } = await import('../utils/dateTz.js');
  const tz = await getStoreTimezone(storeId, prisma);
  return formatLocalDate(new Date(), tz);
}

export const getDailySale = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrg(req) as string;
    const storeId = getStore(req) as string;
    if (!storeId) { res.status(400).json({ success: false, error: 'X-Store-Id header is required' }); return; }

    const raw = req.params.date || req.query.date;
    let dateStr = validateDateParam(raw);
    if (!dateStr && raw) { res.status(400).json({ success: false, error: 'Invalid date (expect YYYY-MM-DD)' }); return; }
    if (!dateStr) dateStr = await _todayInStoreTz(storeId);

    const data = await computeDailySale({ orgId, storeId, dateStr });
    res.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[daily-sale.get]', err);
    res.status(500).json({ success: false, error: message });
  }
};

export const saveDailySale = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrg(req) as string;
    const storeId = getStore(req) as string;
    if (!storeId) { res.status(400).json({ success: false, error: 'X-Store-Id header is required' }); return; }

    const raw = req.params.date || req.query.date;
    let dateStr = validateDateParam(raw);
    if (!dateStr && raw) { res.status(400).json({ success: false, error: 'Invalid date (expect YYYY-MM-DD)' }); return; }
    if (!dateStr) dateStr = await _todayInStoreTz(storeId);

    const data = await saveDailySaleAdjustments({
      orgId, storeId, dateStr,
      userId: req.user?.id || null,
      body: req.body || {},
    });
    res.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[daily-sale.save]', err);
    res.status(500).json({ success: false, error: message });
  }
};

export const closeDailySaleReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrg(req) as string;
    const storeId = getStore(req) as string;
    if (!storeId) { res.status(400).json({ success: false, error: 'X-Store-Id header is required' }); return; }

    const raw = req.params.date || req.query.date;
    let dateStr = validateDateParam(raw);
    if (!dateStr && raw) { res.status(400).json({ success: false, error: 'Invalid date (expect YYYY-MM-DD)' }); return; }
    if (!dateStr) dateStr = await _todayInStoreTz(storeId);

    const data = await closeDailySale({ orgId, storeId, dateStr, userId: req.user?.id || null });
    res.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[daily-sale.close]', err);
    res.status(500).json({ success: false, error: message });
  }
};
