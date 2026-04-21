// Daily Sale — back-office unified daily reconciliation (Phase 3d).
//
// Endpoints under /api/daily-sale:
//   GET    /:date?    → computed snapshot (auto + saved adjustments)
//   PUT    /:date     → save user-entered adjustments + manual values
//   POST   /:date/close → flip status to 'closed' (irreversible)

import {
  computeDailySale,
  saveDailySaleAdjustments,
  closeDailySale,
} from '../services/dailySaleService.js';

function getOrg(req) { return req.orgId || req.user?.orgId; }
function getStore(req) { return req.headers['x-store-id'] || req.storeId || req.query.storeId; }

function parseDateParam(raw) {
  if (!raw) {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  }
  // Accept YYYY-MM-DD; reject anything else
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

export const getDailySale = async (req, res) => {
  try {
    const orgId = getOrg(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'X-Store-Id header is required' });

    const dateStr = parseDateParam(req.params.date || req.query.date);
    if (!dateStr) return res.status(400).json({ success: false, error: 'Invalid date (expect YYYY-MM-DD)' });

    const data = await computeDailySale({ orgId, storeId, dateStr });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[daily-sale.get]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const saveDailySale = async (req, res) => {
  try {
    const orgId = getOrg(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'X-Store-Id header is required' });

    const dateStr = parseDateParam(req.params.date || req.query.date);
    if (!dateStr) return res.status(400).json({ success: false, error: 'Invalid date (expect YYYY-MM-DD)' });

    const data = await saveDailySaleAdjustments({
      orgId, storeId, dateStr,
      userId: req.user?.id || null,
      body: req.body || {},
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[daily-sale.save]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const closeDailySaleReport = async (req, res) => {
  try {
    const orgId = getOrg(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'X-Store-Id header is required' });

    const dateStr = parseDateParam(req.params.date || req.query.date);
    if (!dateStr) return res.status(400).json({ success: false, error: 'Invalid date (expect YYYY-MM-DD)' });

    const data = await closeDailySale({ orgId, storeId, dateStr, userId: req.user?.id || null });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[daily-sale.close]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
