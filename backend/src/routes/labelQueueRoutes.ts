/**
 * Label Queue Routes — /api/label-queue
 */

import express from 'express';
import type { Request, Response } from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  getLabelQueue,
  getQueueCount,
  addManualItem,
  markAsPrinted,
  dismissItems,
  clearOldItems,
} from '../services/labelQueueService.js';
import { errMsg } from '../utils/typeHelpers.js';

const router = express.Router();

router.use(protect);
router.use(scopeToTenant);

// GET / — Fetch pending label queue
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await getLabelQueue(req.orgId as string, req.storeId, {
      reason: (req.query.reason as string) || undefined,
      search: (req.query.search as string) || undefined,
      status: (req.query.status as string) || 'pending',
    });
    res.json(result);
  } catch (err) {
    console.error('[LabelQueue GET]', errMsg(err));
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /count — Pending count (for badge)
router.get('/count', async (req: Request, res: Response) => {
  try {
    const count = await getQueueCount(req.orgId as string, req.storeId);
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /add — Manually add products to queue
router.post('/add', async (req: Request, res: Response) => {
  try {
    const { productIds } = req.body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      res.status(400).json({ error: 'productIds array is required' });
      return;
    }
    const results = [];
    for (const pid of productIds) {
      const item = await addManualItem(req.orgId as string, req.storeId, String(parseInt(pid)));
      results.push(item);
    }
    res.json({ added: results.length, data: results });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /print — Mark items as printed
router.post('/print', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids array is required' });
      return;
    }
    const result = await markAsPrinted(ids, req.user?.id || (null as unknown as string));
    res.json({ updated: result.count });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /dismiss — Dismiss items
router.post('/dismiss', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids array is required' });
      return;
    }
    const result = await dismissItems(ids);
    res.json({ updated: result.count });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// DELETE /clear — Remove old printed/dismissed items
router.delete('/clear', async (req: Request, res: Response) => {
  try {
    const result = await clearOldItems(
      req.orgId as string,
      parseInt(req.query.days as string) || 30,
    );
    res.json({ deleted: result.count });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

export default router;
