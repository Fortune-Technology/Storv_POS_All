/**
 * POS Terminal Controller
 * Handles cashier-facing operations: catalog snapshot, transactions, session.
 */

import prisma from '../config/postgres.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const getOrgId   = (req) => req.orgId   || req.user?.orgId;
const getStoreId = (req) => req.query.storeId || req.body?.storeId;

/**
 * _processLoyaltyPoints
 * Called fire-and-forget after a transaction is saved.
 * Awards earned points and deducts redeemed points for the attached customer.
 */
async function _processLoyaltyPoints({ orgId, storeId, customerId, lineItems, subtotal, txId, txNumber, loyaltyPointsRedeemed }) {
  // Load the loyalty program
  const program = await prisma.loyaltyProgram.findUnique({ where: { storeId } });
  if (!program || !program.enabled) return;

  // Load earn rules for this store
  const earnRules = await prisma.loyaltyEarnRule.findMany({
    where: { storeId, active: true },
  });

  // Build lookup maps
  const excludedDepts    = new Set(earnRules.filter(r => r.targetType === 'department' && r.action === 'exclude').map(r => r.targetId));
  const excludedProducts = new Set(earnRules.filter(r => r.targetType === 'product'    && r.action === 'exclude').map(r => r.targetId));
  const deptMultipliers  = {};
  const prodMultipliers  = {};
  earnRules.filter(r => r.action === 'multiply').forEach(r => {
    if (r.targetType === 'department') deptMultipliers[r.targetId] = Number(r.multiplier);
    else                               prodMultipliers[r.targetId] = Number(r.multiplier);
  });

  // Compute eligible spend from lineItems
  let eligibleSubtotal = 0;
  const items = Array.isArray(lineItems) ? lineItems : [];
  for (const li of items) {
    if (li.isLottery || li.isBottleReturn || li.qty <= 0) continue;
    const deptId = li.departmentId ? String(li.departmentId) : null;
    const prodId = li.productId    ? String(li.productId)    : null;
    // Check exclusions
    if (deptId && excludedDepts.has(deptId))    continue;
    if (prodId && excludedProducts.has(prodId)) continue;
    // Apply multiplier (product takes precedence over department)
    let mult = 1;
    if (prodId && prodMultipliers[prodId] !== undefined) mult = prodMultipliers[prodId];
    else if (deptId && deptMultipliers[deptId] !== undefined) mult = deptMultipliers[deptId];
    eligibleSubtotal += (li.lineTotal || 0) * mult;
  }

  // Calculate points to award
  const ptsPerDollar = Number(program.pointsPerDollar);
  const pointsEarned = Math.floor(eligibleSubtotal * ptsPerDollar);

  // Net points change
  const redeemed      = Math.max(0, loyaltyPointsRedeemed || 0);
  const netPointsDelta = pointsEarned - redeemed;

  if (netPointsDelta === 0 && pointsEarned === 0) return;

  // Fetch current customer
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, orgId },
    select: { id: true, loyaltyPoints: true, pointsHistory: true },
  });
  if (!customer) return;

  const currentPoints  = customer.loyaltyPoints || 0;
  const newPoints      = Math.max(0, currentPoints + netPointsDelta);
  const history        = Array.isArray(customer.pointsHistory) ? customer.pointsHistory : [];

  const historyEntry = {
    date:     new Date().toISOString(),
    txId,
    txNumber,
    earned:   pointsEarned,
    redeemed,
    balance:  newPoints,
  };

  await prisma.customer.update({
    where: { id: customerId },
    data:  {
      loyaltyPoints: newPoints,
      pointsHistory: [...history, historyEntry],
    },
  });
}

// ── GET /api/pos-terminal/catalog/snapshot ─────────────────────────────────
// Returns flat denormalised product list for IndexedDB seeding.
// Supports ?updatedSince=ISO for incremental sync.
export const getCatalogSnapshot = async (req, res) => {
  try {
    const orgId      = getOrgId(req);
    const storeId    = req.query.storeId;
    const since      = req.query.updatedSince ? new Date(req.query.updatedSince) : null;
    const page       = parseInt(req.query.page)  || 1;
    const limit      = Math.min(parseInt(req.query.limit) || 500, 500);
    const skip       = (page - 1) * limit;

    const where = {
      orgId,
      active: true,
      ...(since && { updatedAt: { gte: since } }),
    };

    const [total, products] = await Promise.all([
      prisma.masterProduct.count({ where }),
      prisma.masterProduct.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          department:  { select: { id: true, name: true, color: true, taxClass: true, ebtEligible: true } },
          depositRule: { select: { id: true, name: true, depositAmount: true } },
          storeProducts: storeId ? {
            where:  { storeId, active: true },
            select: { retailPrice: true, costPrice: true, active: true, inStock: true },
            take:   1,
          } : false,
        },
      }),
    ]);

    // Flatten into the shape the POS app caches in IndexedDB
    const flat = products.map(p => {
      const sp = p.storeProducts?.[0];
      return {
        id:             p.id,
        upc:            p.upc,
        name:           p.name,
        brand:          p.brand,
        size:           p.size,
        sizeUnit:       p.sizeUnit,
        sellUnit:       p.sellUnit,
        sellUnitSize:   p.sellUnitSize,
        casePacks:      p.casePacks,
        retailPrice:    sp?.retailPrice != null ? Number(sp.retailPrice) : (p.defaultRetailPrice != null ? Number(p.defaultRetailPrice) : null),
        taxable:        p.taxable,
        taxClass:       p.taxClass || p.department?.taxClass || 'grocery',
        ebtEligible:    p.ebtEligible || p.department?.ebtEligible || false,
        ageRequired:    p.ageRequired,
        // Multiply per-container deposit by number of containers in the sell unit
        // e.g. 6pk 12oz cans: 0.05 × 6 = $0.30 per sell unit
        depositAmount:  p.depositRule
          ? Number(p.depositRule.depositAmount) * (p.sellUnitSize || 1)
          : null,
        depositRuleId:  p.depositRuleId,
        departmentId:   p.departmentId,
        departmentName: p.department?.name || null,
        active:         sp ? sp.active : p.active,
        inStock:        sp ? sp.inStock : true,
        orgId,
        storeId:        storeId || null,
        updatedAt:      p.updatedAt.toISOString(),
      };
    });

    res.json({
      data:  flat,
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/deposit-rules ────────────────────────────────────
export const getDepositRules = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const rules = await prisma.depositRule.findMany({
      where: { orgId, active: true },
      orderBy: { minVolumeOz: 'asc' },
    });
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/tax-rules ───────────────────────────────────────
export const getTaxRules = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const rules = await prisma.taxRule.findMany({
      where: { orgId, active: true },
    });
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/transactions ───────────────────────────────────
export const createTransaction = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      storeId, stationId,
      lineItems, lotteryItems, tenderLines, ageVerifications, notes,
      subtotal, taxTotal, depositTotal, ebtTotal, grandTotal, changeGiven,
      offlineCreatedAt, status,
      shiftId,
      customerId, loyaltyPointsRedeemed,
    } = req.body;

    if (!storeId) return res.status(400).json({ error: 'storeId required' });
    // Allow lottery-only transactions (no regular lineItems)
    if (!lineItems?.length && !lotteryItems?.length) {
      return res.status(400).json({ error: 'lineItems or lotteryItems required' });
    }

    // Generate a human-readable transaction number
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    const count = await prisma.transaction.count({ where: { orgId, storeId } });
    const txNumber = `TXN-${dateStr}-${String(count + 1).padStart(6, '0')}`;

    const tx = await prisma.transaction.create({
      data: {
        orgId,
        storeId,
        cashierId:       req.user.id,
        stationId:       stationId || null,
        txNumber,
        status:          status || 'complete',
        lineItems:       lineItems || [],
        subtotal:        parseFloat(subtotal)     || 0,
        taxTotal:        parseFloat(taxTotal)     || 0,
        depositTotal:    parseFloat(depositTotal) || 0,
        ebtTotal:        parseFloat(ebtTotal)     || 0,
        grandTotal:      parseFloat(grandTotal)   || 0,
        tenderLines:     tenderLines || [],
        changeGiven:     parseFloat(changeGiven)  || 0,
        ageVerifications:ageVerifications || null,
        notes:           notes || null,
        offlineCreatedAt:offlineCreatedAt ? new Date(offlineCreatedAt) : null,
        syncedAt:        new Date(),
      },
    });

    // ── Award / deduct loyalty points (fire-and-forget) ───────────────────
    if (customerId) {
      _processLoyaltyPoints({
        orgId, storeId, customerId,
        lineItems: lineItems || [],
        subtotal:  parseFloat(subtotal) || 0,
        txId:      tx.id, txNumber,
        loyaltyPointsRedeemed: parseInt(loyaltyPointsRedeemed) || 0,
      }).catch(err => console.error('[loyalty] points error:', err.message));
    }

    // ── Save lottery transactions if present ──────────────────────────────
    if (Array.isArray(lotteryItems) && lotteryItems.length) {
      await prisma.lotteryTransaction.createMany({
        data: lotteryItems.map(li => ({
          orgId,
          storeId,
          shiftId:         shiftId || null,
          cashierId:       req.user.id,
          stationId:       stationId || null,
          type:            li.type === 'payout' ? 'payout' : 'sale',
          amount:          Math.abs(parseFloat(li.amount) || 0),
          gameId:          li.gameId || null,
          notes:           li.notes || null,
          posTransactionId: tx.id,
        })),
      });
    }

    // ── Deduct stock for each sold line item (fire-and-forget) ────────────
    // Only deduct for real products (skip lottery, bottle-return, price-override lines without productId)
    if (Array.isArray(lineItems) && lineItems.length) {
      const stockUpdates = lineItems
        .filter(li => li.productId && !li.isLottery && !li.isBottleReturn && li.qty > 0)
        .map(li =>
          prisma.storeProduct.updateMany({
            where: { storeId, masterProductId: li.productId, orgId },
            data:  {
              quantityOnHand: { decrement: li.qty },
              lastStockUpdate: new Date(),
            },
          })
        );
      // Non-blocking — don't hold up the response if stock update fails
      Promise.all(stockUpdates).catch(err =>
        console.error('[createTransaction] stock deduction error:', err.message)
      );
    }

    res.status(201).json(tx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/transactions/batch ─────────────────────────────
// Accepts an array of transactions created offline.
export const batchCreateTransactions = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { transactions } = req.body;

    if (!Array.isArray(transactions) || !transactions.length) {
      return res.status(400).json({ error: 'transactions array required' });
    }

    const results = [];
    const errors  = [];

    for (const tx of transactions) {
      try {
        const today = new Date(tx.offlineCreatedAt || Date.now());
        const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
        const count = await prisma.transaction.count({ where: { orgId, storeId: tx.storeId } });
        const txNumber = tx.txNumber || `TXN-${dateStr}-${String(count + 1).padStart(6, '0')}`;

        const saved = await prisma.transaction.create({
          data: {
            orgId,
            storeId:          tx.storeId,
            cashierId:        req.user.id,
            stationId:        tx.stationId || null,
            txNumber,
            status:           tx.status || 'complete',
            lineItems:        tx.lineItems || [],
            subtotal:         parseFloat(tx.subtotal)     || 0,
            taxTotal:         parseFloat(tx.taxTotal)     || 0,
            depositTotal:     parseFloat(tx.depositTotal) || 0,
            ebtTotal:         parseFloat(tx.ebtTotal)     || 0,
            grandTotal:       parseFloat(tx.grandTotal)   || 0,
            tenderLines:      tx.tenderLines || [],
            changeGiven:      parseFloat(tx.changeGiven)  || 0,
            ageVerifications: tx.ageVerifications || null,
            notes:            tx.notes || null,
            offlineCreatedAt: tx.offlineCreatedAt ? new Date(tx.offlineCreatedAt) : null,
            syncedAt:         new Date(),
          },
        });
        results.push({ localId: tx.localId, id: saved.id, txNumber: saved.txNumber });

        // Deduct stock for this offline transaction
        if (Array.isArray(tx.lineItems) && tx.lineItems.length) {
          const updates = tx.lineItems
            .filter(li => li.productId && !li.isLottery && !li.isBottleReturn && li.qty > 0)
            .map(li =>
              prisma.storeProduct.updateMany({
                where: { storeId: tx.storeId, masterProductId: li.productId, orgId },
                data:  { quantityOnHand: { decrement: li.qty }, lastStockUpdate: new Date() },
              })
            );
          Promise.all(updates).catch(() => {});
        }
      } catch (e) {
        errors.push({ localId: tx.localId, error: e.message });
      }
    }

    res.json({ synced: results.length, errors, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/transactions/:id ────────────────────────────────
export const getTransaction = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const tx = await prisma.transaction.findFirst({
      where: { id: req.params.id, orgId },
    });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/print-network ──────────────────────────────────
// Proxy: receives base64-encoded ESC/POS data and forwards it to a TCP printer.
// Body: { ip: string, port: number, data: string (base64) }
export const printNetworkReceipt = async (req, res) => {
  const { ip, port, data } = req.body;
  if (!ip || !port || !data) {
    return res.status(400).json({ error: 'ip, port, and data are required' });
  }
  try {
    const net = await import('net');
    const buf = Buffer.from(data, 'base64');
    await new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Print timeout — printer unreachable'));
      }, 6000);

      socket.connect(Number(port), ip, () => {
        socket.write(buf, () => {
          socket.end();
          clearTimeout(timeout);
          resolve();
        });
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    res.json({ ok: true });
  } catch (err) {
    const code = err.code;
    if (code === 'ECONNREFUSED')  return res.status(503).json({ error: `Printer refused connection at ${ip}:${port}` });
    if (code === 'ETIMEDOUT')     return res.status(503).json({ error: `Printer timed out at ${ip}:${port}` });
    if (code === 'ENETUNREACH')   return res.status(503).json({ error: `Network unreachable — check IP ${ip}` });
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/branding ────────────────────────────────────────
export const getPosBranding = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = req.query.storeId || req.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId required' });
    const store = await prisma.store.findFirst({
      where:  { id: storeId, orgId },
      select: { name: true, branding: true },
    });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json({ storeName: store.name, ...(store.branding || {}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/config ──────────────────────────────────────────
// Returns store's POS layout config (store.pos) + branding (store.branding).
// Requires X-Station-Token OR valid cashier JWT.
export const getPOSConfig = async (req, res) => {
  try {
    const storeId = req.query.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId required' });
    const store = await prisma.store.findFirst({
      where: { id: storeId },
      select: { pos: true, branding: true },
    });
    // Return pos config merged with branding so front-end gets everything in one call
    const posConfig  = (store?.pos      && typeof store.pos      === 'object') ? store.pos      : {};
    const branding   = (store?.branding && typeof store.branding === 'object') ? store.branding : {};
    res.json({ ...posConfig, branding });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PUT /api/pos-terminal/config ──────────────────────────────────────────
// Saves POS config → store.pos  and optionally branding → store.branding.
// Manager/owner/admin only.
export const savePOSConfig = async (req, res) => {
  try {
    const { storeId, config, branding } = req.body;
    if (!storeId || !config) return res.status(400).json({ error: 'storeId and config required' });

    const orgId = req.tenantId || req.user?.orgId;
    const store = await prisma.store.findFirst({ where: { id: storeId, orgId } });
    if (!store) return res.status(404).json({ error: 'Store not found' });

    // Build update payload — only include branding if provided
    const updateData = { pos: config };
    if (branding && typeof branding === 'object') {
      updateData.branding = branding;
    }

    await prisma.store.update({
      where: { id: storeId },
      data:  updateData,
    });

    res.json({ success: true, config, branding: branding || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/transactions ────────────────────────────────────
// List transactions with filters: date, dateFrom, dateTo, cashierId, stationId,
// status, amountMin, amountMax, limit, offset
export const listTransactions = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      storeId, date, dateFrom, dateTo,
      cashierId, stationId, status,
      amountMin, amountMax,
      limit = 200, offset = 0,
    } = req.query;

    const where = { orgId };
    if (storeId)   where.storeId   = storeId;
    if (cashierId) where.cashierId = cashierId;
    if (stationId) where.stationId = stationId;
    if (status)    where.status    = status;

    // Amount range filter on grandTotal
    if (amountMin || amountMax) {
      where.grandTotal = {};
      if (amountMin) where.grandTotal.gte = parseFloat(amountMin);
      if (amountMax) where.grandTotal.lte = parseFloat(amountMax);
    }

    // Date/time window
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        where.createdAt.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
      }
      if (dateTo) {
        const d = new Date(dateTo);
        where.createdAt.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      }
    } else if (date) {
      const d     = new Date(date);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
      const end   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    }

    const [total, txs] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:    Math.min(parseInt(limit) || 200, 1000),
        skip:    parseInt(offset) || 0,
        select: {
          id: true, txNumber: true, status: true,
          subtotal: true, taxTotal: true, depositTotal: true,
          ebtTotal: true, grandTotal: true,
          tenderLines: true, changeGiven: true,
          lineItems: true, cashierId: true, stationId: true,
          refundOf: true, voidedAt: true, notes: true,
          offlineCreatedAt: true, createdAt: true,
        },
      }),
    ]);

    // Resolve cashier names in one query
    const cashierIds = [...new Set(txs.map(t => t.cashierId).filter(Boolean))];
    const users = cashierIds.length ? await prisma.user.findMany({
      where:  { id: { in: cashierIds } },
      select: { id: true, name: true },
    }) : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

    res.json({
      total,
      transactions: txs.map(t => ({
        ...t,
        subtotal:     Number(t.subtotal     ?? 0),
        taxTotal:     Number(t.taxTotal     ?? 0),
        depositTotal: Number(t.depositTotal ?? 0),
        ebtTotal:     Number(t.ebtTotal     ?? 0),
        grandTotal:   Number(t.grandTotal),
        changeGiven:  Number(t.changeGiven),
        cashierName:  userMap[t.cashierId] || 'Unknown',
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/events ─────────────────────────────────────────
// Logs a business event (No Sale, manager override, etc.) to pos_logs.
// Cashier app sends these fire-and-forget; portal reads them via GET /events.
export const logPosEvent = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      storeId, eventType,
      cashierId, cashierName,
      stationId, stationName,
      note,
    } = req.body;

    if (!eventType) return res.status(400).json({ error: 'eventType required' });

    await prisma.posLog.create({
      data: {
        orgId,
        storeId: storeId || null,
        endpoint:   eventType,           // e.g. 'no_sale'
        method:     'EVENT',             // distinguishes business events from HTTP logs
        status:     'success',
        statusCode: null,
        message:    JSON.stringify({
          cashierId, cashierName,
          stationId, stationName,
          note: note || null,
        }),
      },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/events ──────────────────────────────────────────
// Lists business events for the back-office portal.
// Filters: storeId, eventType, dateFrom, dateTo, limit, offset
export const listPosEvents = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      storeId, eventType,
      dateFrom, dateTo,
      limit = 100, offset = 0,
    } = req.query;

    const where = { orgId, method: 'EVENT' };
    if (storeId)   where.storeId  = storeId;
    if (eventType) where.endpoint = eventType;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        where.createdAt.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
      }
      if (dateTo) {
        const d = new Date(dateTo);
        where.createdAt.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      }
    }

    const [total, rows] = await Promise.all([
      prisma.posLog.count({ where }),
      prisma.posLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:    Math.min(parseInt(limit) || 100, 500),
        skip:    parseInt(offset) || 0,
        include: { store: { select: { id: true, name: true } } },
      }),
    ]);

    res.json({
      total,
      events: rows.map(r => {
        let details = {};
        try { details = r.message ? JSON.parse(r.message) : {}; } catch {}
        return {
          id:          r.id,
          eventType:   r.endpoint,
          storeId:     r.storeId,
          storeName:   r.store?.name || null,
          cashierName: details.cashierName || null,
          cashierId:   details.cashierId   || null,
          stationId:   details.stationId   || null,
          stationName: details.stationName || null,
          note:        details.note        || null,
          createdAt:   r.createdAt,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/transactions/:id/void ──────────────────────────
export const voidTransaction = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { id }   = req.params;
    const { note } = req.body;

    const tx = await prisma.transaction.findFirst({ where: { id, orgId } });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.status === 'voided') return res.status(400).json({ error: 'Transaction already voided' });
    if (tx.status === 'refund') return res.status(400).json({ error: 'Cannot void a refund transaction' });

    const voided = await prisma.transaction.update({
      where: { id },
      data: {
        status:      'voided',
        notes:       note ? `VOID: ${note}` : `VOIDED by ${req.user.name || req.user.email}`,
        voidedAt:    new Date(),
        voidedById:  req.user.id,
      },
    });

    res.json({ ...voided, grandTotal: Number(voided.grandTotal) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/transactions/:id/refund ────────────────────────
export const createRefund = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { id }  = req.params;
    const { lineItems, tenderLines, note, grandTotal, subtotal, taxTotal, depositTotal } = req.body;

    const orig = await prisma.transaction.findFirst({ where: { id, orgId } });
    if (!orig) return res.status(404).json({ error: 'Original transaction not found' });
    if (orig.status === 'voided') return res.status(400).json({ error: 'Cannot refund a voided transaction' });

    // Generate refund transaction number
    const today   = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    const count   = await prisma.transaction.count({ where: { orgId, storeId: orig.storeId } });
    const txNumber = `REF-${dateStr}-${String(count + 1).padStart(6, '0')}`;

    const refund = await prisma.transaction.create({
      data: {
        orgId,
        storeId:      orig.storeId,
        cashierId:    req.user.id,
        stationId:    orig.stationId,
        txNumber,
        status:       'refund',
        refundOf:     id,
        lineItems:    lineItems || orig.lineItems || [],
        subtotal:     -(parseFloat(subtotal)      || Number(orig.subtotal)),
        taxTotal:     -(parseFloat(taxTotal)       || Number(orig.taxTotal)),
        depositTotal: -(parseFloat(depositTotal)   || 0),
        ebtTotal:     0,
        grandTotal:   -(parseFloat(grandTotal)     || Number(orig.grandTotal)),
        tenderLines:  tenderLines || [],
        changeGiven:  0,
        notes:        note || `Refund for ${orig.txNumber}`,
        syncedAt:     new Date(),
      },
    });

    res.status(201).json({ ...refund, grandTotal: Number(refund.grandTotal) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/transactions/open-refund ──────────────────────
// No-receipt refund — creates a standalone refund transaction with no parent.
export const createOpenRefund = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { storeId, lineItems, tenderLines, note, grandTotal, subtotal, taxTotal } = req.body;

    if (!storeId)            return res.status(400).json({ error: 'storeId required' });
    if (!lineItems?.length)  return res.status(400).json({ error: 'lineItems required' });
    if (!grandTotal)         return res.status(400).json({ error: 'grandTotal required' });

    const today   = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    const count   = await prisma.transaction.count({ where: { orgId, storeId } });
    const txNumber = `REF-${dateStr}-${String(count + 1).padStart(6, '0')}`;

    const refund = await prisma.transaction.create({
      data: {
        orgId,
        storeId,
        cashierId:    req.user.id,
        txNumber,
        status:       'refund',
        lineItems:    lineItems || [],
        subtotal:     -(parseFloat(subtotal)  || parseFloat(grandTotal)),
        taxTotal:     -(parseFloat(taxTotal)  || 0),
        depositTotal: 0,
        ebtTotal:     0,
        grandTotal:   -(parseFloat(grandTotal)),
        tenderLines:  tenderLines || [],
        changeGiven:  0,
        notes:        note || 'No-receipt return',
        syncedAt:     new Date(),
      },
    });

    res.status(201).json({ ...refund, grandTotal: Number(refund.grandTotal) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/reports/end-of-day ──────────────────────────────
export const getEndOfDayReport = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = req.query.storeId;
    const date    = req.query.date ? new Date(req.query.date) : new Date();

    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
    const end   = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

    const where = { orgId, ...(storeId && { storeId }), createdAt: { gte: start, lte: end } };

    const [allTxs, voidedCount, clockEvents] = await Promise.all([
      prisma.transaction.findMany({
        where,
        select: { grandTotal: true, subtotal: true, taxTotal: true, tenderLines: true, status: true, cashierId: true },
      }),
      prisma.transaction.count({ where: { ...where, status: 'voided' } }),
      prisma.clockEvent.findMany({
        where: { orgId, ...(storeId && { storeId }), createdAt: { gte: start, lte: end } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const saleTxs = allTxs.filter(t => t.status !== 'voided');

    // Tender breakdown
    const tenderTotals = {};
    let totalSales = 0, totalTax = 0, totalRefunds = 0;

    saleTxs.forEach(tx => {
      const amt = Number(tx.grandTotal);
      if (tx.status === 'refund') { totalRefunds += Math.abs(amt); return; }
      totalSales += amt;
      totalTax   += Number(tx.taxTotal);
      (tx.tenderLines || []).forEach(line => {
        tenderTotals[line.method] = (tenderTotals[line.method] || 0) + Number(line.amount);
      });
    });

    // Per-cashier stats
    const cashierIds = [...new Set(saleTxs.map(t => t.cashierId).filter(Boolean))];
    const users = cashierIds.length ? await prisma.user.findMany({
      where: { id: { in: cashierIds } }, select: { id: true, name: true },
    }) : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

    const byCashier = {};
    saleTxs.filter(t => t.status !== 'refund').forEach(tx => {
      const cid  = tx.cashierId;
      if (!byCashier[cid]) byCashier[cid] = { name: userMap[cid] || 'Unknown', count: 0, total: 0 };
      byCashier[cid].count++;
      byCashier[cid].total += Number(tx.grandTotal);
    });

    // Resolve user names for clock events
    const clockUserIds = [...new Set(clockEvents.map(e => e.userId))];
    const clockUsers = clockUserIds.length ? await prisma.user.findMany({
      where: { id: { in: clockUserIds } }, select: { id: true, name: true },
    }) : [];
    const clockUserMap = Object.fromEntries(clockUsers.map(u => [u.id, u.name]));

    res.json({
      date:             date.toISOString().split('T')[0],
      transactionCount: saleTxs.filter(t => t.status !== 'refund').length,
      refundCount:      saleTxs.filter(t => t.status === 'refund').length,
      voidedCount,
      totalSales:       Math.round(totalSales * 100) / 100,
      totalTax:         Math.round(totalTax * 100) / 100,
      totalRefunds:     Math.round(totalRefunds * 100) / 100,
      netSales:         Math.round((totalSales - totalRefunds) * 100) / 100,
      tenderBreakdown:  tenderTotals,
      cashierBreakdown: Object.values(byCashier).sort((a, b) => b.total - a.total),
      clockEvents: clockEvents.map(e => ({
        type: e.type, userName: clockUserMap[e.userId] || 'Unknown',
        userId: e.userId, createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/clock ──────────────────────────────────────────
// Clock in or out identified by PIN (no JWT needed — uses station token)
export const clockEvent = async (req, res) => {
  try {
    const { pin, type, storeId, stationId } = req.body;

    if (!['in', 'out'].includes(type)) return res.status(400).json({ error: 'type must be "in" or "out"' });
    if (!pin || pin.length < 4) return res.status(400).json({ error: 'PIN required' });

    // Identify user by PIN (same logic as pinLogin)
    const stationToken = req.headers['x-station-token'];
    if (!stationToken) return res.status(401).json({ error: 'Station token required' });

    const station = await prisma.station.findUnique({ where: { token: stationToken } });
    if (!station) return res.status(401).json({ error: 'Invalid station token' });

    const bcrypt = await import('bcryptjs');
    const users  = await prisma.user.findMany({
      where: { orgId: station.orgId, posPin: { not: null } },
      select: { id: true, name: true, posPin: true },
    });

    let matchedUser = null;
    for (const u of users) {
      if (bcrypt.default.compareSync(pin, u.posPin)) { matchedUser = u; break; }
    }
    if (!matchedUser) return res.status(401).json({ error: 'Invalid PIN' });

    const effectiveStoreId = storeId || station.storeId;

    // ── Duplicate state guard ────────────────────────────────────────────────
    // Find the last clock event for this employee at this store
    const lastEvent = await prisma.clockEvent.findFirst({
      where: { orgId: station.orgId, storeId: effectiveStoreId, userId: matchedUser.id },
      orderBy: { createdAt: 'desc' },
      select: { type: true, createdAt: true },
    });

    if (type === 'in' && lastEvent?.type === 'in') {
      // Already clocked in — don't create a duplicate event
      return res.status(200).json({
        alreadyClockedIn: true,
        userName: matchedUser.name,
        since: lastEvent.createdAt,
      });
    }

    if (type === 'out' && (!lastEvent || lastEvent.type === 'out')) {
      // Not clocked in yet — cannot clock out
      return res.status(200).json({
        notClockedIn: true,
        userName: matchedUser.name,
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    const event = await prisma.clockEvent.create({
      data: {
        orgId:     station.orgId,
        storeId:   effectiveStoreId,
        userId:    matchedUser.id,
        stationId: stationId || station.id,
        type,
      },
    });

    res.status(201).json({
      userName:  matchedUser.name,
      type,
      createdAt: event.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/clock/status ───────────────────────────────────
// Returns the last clock event for a given user (to show clocked-in state)
export const getClockStatus = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = req.query.storeId;
    const userId  = req.query.userId || req.user?.id;

    const last = await prisma.clockEvent.findFirst({
      where:   { orgId, ...(storeId && { storeId }), userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ clockedIn: last?.type === 'in', lastEvent: last || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
