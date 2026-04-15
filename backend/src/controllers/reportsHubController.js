/**
 * Reports Hub Controller — Comprehensive P&L + Tender + Operations reports.
 * Single endpoint that returns everything for a date range — fast, pre-aggregated.
 */

import prisma from '../config/postgres.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/hub/summary — Full P&L summary for a date range
// ═══════════════════════════════════════════════════════════════════════════

export const getSummaryReport = async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const storeId = req.storeId;
    const from = req.query.from;
    const to = req.query.to;

    if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });

    const dateFrom = new Date(`${from}T00:00:00`);
    const dateTo = new Date(`${to}T23:59:59.999`);
    const where = { orgId, status: 'complete', createdAt: { gte: dateFrom, lte: dateTo } };
    if (storeId) where.storeId = storeId;

    // ── Fetch all transactions ───────────────────────────────────────────
    const txns = await prisma.transaction.findMany({
      where,
      select: {
        grandTotal: true, subtotal: true, taxTotal: true, depositTotal: true,
        ebtTotal: true, tenderLines: true, lineItems: true, createdAt: true,
        cashierId: true, stationId: true, status: true, refundOf: true,
      },
    });

    // Fetch refunds/voids separately
    const voidWhere = { orgId, status: 'voided', createdAt: { gte: dateFrom, lte: dateTo } };
    if (storeId) voidWhere.storeId = storeId;
    const voidCount = await prisma.transaction.count({ where: voidWhere });

    const refundWhere = { orgId, status: 'refund', createdAt: { gte: dateFrom, lte: dateTo } };
    if (storeId) refundWhere.storeId = storeId;
    const refunds = await prisma.transaction.findMany({
      where: refundWhere,
      select: { grandTotal: true },
    });
    const refundTotal = r2(refunds.reduce((s, r) => s + Math.abs(Number(r.grandTotal) || 0), 0));

    // ── Sales aggregation ────────────────────────────────────────────────
    let grossSales = 0, netSales = 0, taxTotal = 0, depositTotal = 0, ebtTotal = 0;
    let cashTotal = 0, cardTotal = 0, ebtTender = 0, otherTender = 0;
    let totalDiscount = 0, bagFeeTotal = 0;
    const deptMap = {};
    const cashierMap = {};
    const stationMap = {};
    const hourlyMap = {};
    const dailyMap = {};
    const tenderMethodMap = {};

    for (const tx of txns) {
      const gt = Number(tx.grandTotal) || 0;
      const st = Number(tx.subtotal) || 0;
      const tt = Number(tx.taxTotal) || 0;
      const dt = Number(tx.depositTotal) || 0;
      const et = Number(tx.ebtTotal) || 0;

      grossSales += st;
      netSales += gt;
      taxTotal += tt;
      depositTotal += dt;
      ebtTotal += et;

      // Tender breakdown
      const tenders = Array.isArray(tx.tenderLines) ? tx.tenderLines : [];
      for (const t of tenders) {
        const amt = Number(t.amount) || 0;
        const m = (t.method || '').toLowerCase();
        if (!tenderMethodMap[m]) tenderMethodMap[m] = { method: m, count: 0, total: 0 };
        tenderMethodMap[m].count += 1;
        tenderMethodMap[m].total += amt;

        if (m === 'cash') cashTotal += amt;
        else if (['card', 'credit', 'debit'].includes(m)) cardTotal += amt;
        else if (m === 'ebt') ebtTender += amt;
        else otherTender += amt;
      }

      // Line items — department, bag fees, discounts
      const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
      for (const li of items) {
        if (li.isBagFee) { bagFeeTotal += Number(li.lineTotal) || 0; continue; }
        if (li.isLottery || li.isBottleReturn) continue;

        const dept = li.departmentName || li.taxClass || 'Other';
        if (!deptMap[dept]) deptMap[dept] = { name: dept, sales: 0, cost: 0, qty: 0, txCount: 0 };
        deptMap[dept].sales += Number(li.lineTotal) || 0;
        deptMap[dept].cost += (Number(li.costPrice) || Number(li.unitPrice) * 0.65) * (Number(li.qty) || 1);
        deptMap[dept].qty += Number(li.qty) || 1;
        deptMap[dept].txCount += 1;

        // Discounts
        if (li.discountType || li.promoAdjustment) {
          const origPrice = (Number(li.unitPrice) || 0) * (Number(li.qty) || 1);
          const actualPrice = Number(li.lineTotal) || 0;
          if (origPrice > actualPrice) totalDiscount += origPrice - actualPrice;
        }
      }

      // Cashier breakdown
      const cid = tx.cashierId || 'unknown';
      if (!cashierMap[cid]) cashierMap[cid] = { cashierId: cid, sales: 0, txCount: 0 };
      cashierMap[cid].sales += gt;
      cashierMap[cid].txCount += 1;

      // Station breakdown
      const sid = tx.stationId || 'unknown';
      if (!stationMap[sid]) stationMap[sid] = { stationId: sid, sales: 0, txCount: 0 };
      stationMap[sid].sales += gt;
      stationMap[sid].txCount += 1;

      // Hourly breakdown
      const h = new Date(tx.createdAt).getHours();
      if (!hourlyMap[h]) hourlyMap[h] = { hour: h, sales: 0, count: 0 };
      hourlyMap[h].sales += gt;
      hourlyMap[h].count += 1;

      // Daily breakdown
      const ds = new Date(tx.createdAt).toISOString().slice(0, 10);
      if (!dailyMap[ds]) dailyMap[ds] = { date: ds, sales: 0, tax: 0, count: 0 };
      dailyMap[ds].sales += gt;
      dailyMap[ds].tax += tt;
      dailyMap[ds].count += 1;
    }

    // ── Lottery ───────────────────────────────────────────────────────────
    const lotteryWhere = { orgId, createdAt: { gte: dateFrom, lte: dateTo } };
    if (storeId) lotteryWhere.storeId = storeId;
    const lotteryTxns = await prisma.lotteryTransaction.findMany({
      where: lotteryWhere,
      select: { type: true, amount: true, ticketCount: true },
    });
    let lotterySales = 0, lotteryPayouts = 0, lotteryTickets = 0;
    for (const lt of lotteryTxns) {
      const amt = Number(lt.amount) || 0;
      if (lt.type === 'sale') { lotterySales += amt; lotteryTickets += lt.ticketCount || 0; }
      else if (lt.type === 'payout') lotteryPayouts += amt;
    }

    // ── Cash drops + Payouts (expenses/merchandise) ──────────────────────
    const [cashPayouts, vendorPayments] = await Promise.all([
      prisma.cashPayout.findMany({
        where: { orgId, createdAt: { gte: dateFrom, lte: dateTo } },
        select: { amount: true, payoutType: true, recipient: true },
      }).catch(() => []),
      prisma.vendorPayment.findMany({
        where: { orgId, ...(storeId ? { storeId } : {}), paymentDate: { gte: dateFrom, lte: dateTo } },
        select: { amount: true, paymentType: true, vendorName: true },
      }).catch(() => []),
    ]);

    let expensePayouts = 0, merchandisePayouts = 0;
    for (const p of cashPayouts) {
      const amt = Number(p.amount) || 0;
      if (p.payoutType === 'expense') expensePayouts += amt;
      else merchandisePayouts += amt;
    }
    for (const v of vendorPayments) {
      const amt = Number(v.amount) || 0;
      if (v.paymentType === 'expense') expensePayouts += amt;
      else merchandisePayouts += amt;
    }

    // ── Department summary with margin ───────────────────────────────────
    const departments = Object.values(deptMap).map(d => ({
      ...d,
      sales: r2(d.sales),
      cost: r2(d.cost),
      margin: d.sales > 0 ? r2(((d.sales - d.cost) / d.sales) * 100) : 0,
      profit: r2(d.sales - d.cost),
    })).sort((a, b) => b.sales - a.sales);

    // ── Compile result ───────────────────────────────────────────────────
    const txCount = txns.length;
    const avgTransaction = txCount > 0 ? r2(netSales / txCount) : 0;
    const totalCost = r2(departments.reduce((s, d) => s + d.cost, 0));
    const grossProfit = r2(grossSales - totalCost);
    const grossMargin = grossSales > 0 ? r2((grossProfit / grossSales) * 100) : 0;

    // ── Response — FLATTENED for frontend ───────────────────────────────
    // Frontend does `const s = summary; s.grossSales; s.departments`
    // so we put everything at top-level (not nested under `summary`)
    res.json({
      period: { from, to },
      from, to,

      // P&L Summary (flat fields for ReportsHub KPI cards)
      grossSales:      r2(grossSales),
      netSales:        r2(netSales),
      taxCollected:    r2(taxTotal),   // ReportsHub uses `taxCollected`
      taxTotal:        r2(taxTotal),   // Alias
      depositTotal:    r2(depositTotal),
      ebtTotal:        r2(ebtTotal),
      totalDiscount:   r2(totalDiscount),
      bagFeeTotal:     r2(bagFeeTotal),
      refunds:         refundTotal,    // Alias
      refundTotal,
      voids:           voidCount,      // Alias
      voidCount,
      transactions:    txCount,        // Alias
      txCount,
      avgTransaction,
      totalCost,
      grossProfit,
      grossMarginPct:  grossMargin,    // Alias for ReportsHub
      grossMargin,

      // Nested summary (backward compat — some pages may use this)
      summary: {
        grossSales: r2(grossSales),
        netSales: r2(netSales),
        taxTotal: r2(taxTotal),
        depositTotal: r2(depositTotal),
        ebtTotal: r2(ebtTotal),
        totalDiscount: r2(totalDiscount),
        bagFeeTotal: r2(bagFeeTotal),
        refundTotal,
        voidCount,
        txCount,
        avgTransaction,
        totalCost,
        grossProfit,
        grossMargin,
      },

      // Tender breakdown
      tender: {
        cash: r2(cashTotal),
        card: r2(cardTotal),
        ebt: r2(ebtTender),
        other: r2(otherTender),
        methods: Object.values(tenderMethodMap).map(m => ({ ...m, total: r2(m.total) })),
      },

      // Lottery
      lottery: {
        sales: r2(lotterySales),
        payouts: r2(lotteryPayouts),
        net: r2(lotterySales - lotteryPayouts),
        tickets: lotteryTickets,
      },

      // Expenses
      expenses: {
        expensePayouts: r2(expensePayouts),
        merchandisePayouts: r2(merchandisePayouts),
        totalPayouts: r2(expensePayouts + merchandisePayouts),
      },

      // Breakdowns — ReportsHub uses `department` as the key field on each row
      departments: departments.map(d => ({
        ...d,
        department: d.name, // alias for ReportsHub frontend
        pctTotal: grossSales > 0 ? r2((d.sales / grossSales) * 100) : 0,
      })),
      byCashier: Object.values(cashierMap).map(c => ({ ...c, sales: r2(c.sales) })),
      byStation: Object.values(stationMap).map(s => ({ ...s, sales: r2(s.sales) })),
      hourly: Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        label: h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`,
        sales: r2(hourlyMap[h]?.sales || 0),
        count: hourlyMap[h]?.count || 0,
      })),
      daily: Object.values(dailyMap).map(d => ({ ...d, sales: r2(d.sales), tax: r2(d.tax) })).sort((a, b) => a.date.localeCompare(b.date)),
    });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/hub/tax — Tax breakdown by class
// ═══════════════════════════════════════════════════════════════════════════

export const getTaxReport = async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const storeId = req.storeId;
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    const where = { orgId, status: 'complete', createdAt: { gte: new Date(`${from}T00:00:00`), lte: new Date(`${to}T23:59:59.999`) } };
    if (storeId) where.storeId = storeId;

    const txns = await prisma.transaction.findMany({ where, select: { lineItems: true, taxTotal: true } });

    const taxClasses = {};
    for (const tx of txns) {
      const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
      for (const li of items) {
        if (li.isLottery || li.isBottleReturn || li.isBagFee) continue;
        const cls = li.taxClass || 'other';
        if (!taxClasses[cls]) taxClasses[cls] = { taxClass: cls, taxableSales: 0, itemCount: 0 };
        if (li.taxable !== false) taxClasses[cls].taxableSales += Number(li.lineTotal) || 0;
        taxClasses[cls].itemCount += 1;
      }
    }

    // Get tax rules to show rates
    const rules = await prisma.taxRule.findMany({ where: { orgId, active: true } });
    const ruleMap = {};
    for (const r of rules) ruleMap[r.appliesTo || 'all'] = Number(r.rate);

    const breakdown = Object.values(taxClasses).map(tc => {
      const rate = ruleMap[tc.taxClass] || ruleMap['all'] || 0;
      return { ...tc, taxableSales: r2(tc.taxableSales), rate: r4(rate), taxAmount: r2(tc.taxableSales * rate) };
    }).sort((a, b) => b.taxableSales - a.taxableSales);

    const totalTax = r2(txns.reduce((s, t) => s + (Number(t.taxTotal) || 0), 0));

    res.json({ breakdown, totalTax, period: { from, to } });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/hub/inventory — Stock levels + dead/over/low stock
// ═══════════════════════════════════════════════════════════════════════════

export const getInventoryReport = async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const storeId = req.storeId;
    const { type = 'all' } = req.query; // 'all', 'low', 'dead', 'over'

    const products = await prisma.masterProduct.findMany({
      where: { orgId, active: true, deleted: false, trackInventory: true },
      select: {
        id: true, name: true, upc: true, brand: true,
        defaultRetailPrice: true, defaultCostPrice: true,
        reorderPoint: true, reorderQty: true,
        department: { select: { name: true } },
        storeProducts: storeId
          ? { where: { storeId }, select: { quantityOnHand: true, quantityOnOrder: true, lastReceivedAt: true, lastStockUpdate: true } }
          : { select: { quantityOnHand: true, quantityOnOrder: true, lastReceivedAt: true, lastStockUpdate: true } },
      },
    });

    // Get 30-day sales for velocity
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const txWhere = { orgId, status: 'complete', createdAt: { gte: thirtyDaysAgo } };
    if (storeId) txWhere.storeId = storeId;
    const recentTxns = await prisma.transaction.findMany({ where: txWhere, select: { lineItems: true } });

    const salesMap = {};
    for (const tx of recentTxns) {
      const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
      for (const li of items) {
        if (!li.productId || li.isLottery || li.isBottleReturn) continue;
        salesMap[li.productId] = (salesMap[li.productId] || 0) + (Number(li.qty) || 1);
      }
    }

    const inventory = products.map(p => {
      const sp = p.storeProducts[0];
      const onHand = Number(sp?.quantityOnHand) || 0;
      const onOrder = Number(sp?.quantityOnOrder) || 0;
      const sold30d = salesMap[p.id] || 0;
      const avgDaily = r4(sold30d / 30);
      const daysOfSupply = avgDaily > 0 ? r2(onHand / avgDaily) : onHand > 0 ? 999 : 0;
      const retailValue = r2(onHand * (Number(p.defaultRetailPrice) || 0));
      const costValue = r2(onHand * (Number(p.defaultCostPrice) || Number(p.defaultRetailPrice) * 0.65 || 0));

      let stockStatus = 'ok';
      if (onHand <= 0 && sold30d > 0) stockStatus = 'out';
      else if (daysOfSupply < 7 && sold30d > 0) stockStatus = 'low';
      else if (sold30d === 0 && onHand > 0) stockStatus = 'dead';
      else if (daysOfSupply > 90 && onHand > 20) stockStatus = 'over';

      return {
        id: p.id, name: p.name, upc: p.upc, brand: p.brand,
        department: p.department?.name || '',
        onHand, onOrder, sold30d, avgDaily, daysOfSupply,
        retailValue, costValue,
        reorderPoint: p.reorderPoint, reorderQty: p.reorderQty,
        stockStatus,
        lastReceived: sp?.lastReceivedAt || null,
      };
    }).filter(p => {
      if (type === 'low') return p.stockStatus === 'low' || p.stockStatus === 'out';
      if (type === 'dead') return p.stockStatus === 'dead';
      if (type === 'over') return p.stockStatus === 'over';
      return true;
    }).sort((a, b) => a.daysOfSupply - b.daysOfSupply);

    const stats = {
      totalProducts: inventory.length,
      outOfStock: inventory.filter(p => p.stockStatus === 'out').length,
      lowStock: inventory.filter(p => p.stockStatus === 'low').length,
      deadStock: inventory.filter(p => p.stockStatus === 'dead').length,
      overStock: inventory.filter(p => p.stockStatus === 'over').length,
      totalRetailValue: r2(inventory.reduce((s, p) => s + p.retailValue, 0)),
      totalCostValue: r2(inventory.reduce((s, p) => s + p.costValue, 0)),
    };

    res.json({ inventory, stats });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/hub/compare — Period comparison
// ═══════════════════════════════════════════════════════════════════════════

export const getCompareReport = async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const storeId = req.storeId;
    const { from1, to1, from2, to2 } = req.query;
    if (!from1 || !to1 || !from2 || !to2) return res.status(400).json({ error: 'from1, to1, from2, to2 required' });

    const aggregate = async (from, to) => {
      const where = { orgId, status: 'complete', createdAt: { gte: new Date(`${from}T00:00:00`), lte: new Date(`${to}T23:59:59.999`) } };
      if (storeId) where.storeId = storeId;
      const txns = await prisma.transaction.findMany({ where, select: { grandTotal: true, subtotal: true, taxTotal: true, tenderLines: true } });

      let net = 0, gross = 0, tax = 0, cash = 0, card = 0, ebt = 0;
      for (const tx of txns) {
        net += Number(tx.grandTotal) || 0;
        gross += Number(tx.subtotal) || 0;
        tax += Number(tx.taxTotal) || 0;
        const tenders = Array.isArray(tx.tenderLines) ? tx.tenderLines : [];
        for (const t of tenders) {
          const m = (t.method || '').toLowerCase();
          const a = Number(t.amount) || 0;
          if (m === 'cash') cash += a;
          else if (['card', 'credit', 'debit'].includes(m)) card += a;
          else if (m === 'ebt') ebt += a;
        }
      }
      return { netSales: r2(net), grossSales: r2(gross), taxTotal: r2(tax), txCount: txns.length, avgTx: txns.length ? r2(net / txns.length) : 0, cash: r2(cash), card: r2(card), ebt: r2(ebt) };
    };

    const [period1, period2] = await Promise.all([aggregate(from1, to1), aggregate(from2, to2)]);

    const pctChange = (a, b) => b !== 0 ? r2(((a - b) / b) * 100) : a > 0 ? 100 : 0;

    res.json({
      period1: { ...period1, from: from1, to: to1 },
      period2: { ...period2, from: from2, to: to2 },
      changes: {
        netSales: pctChange(period1.netSales, period2.netSales),
        txCount: pctChange(period1.txCount, period2.txCount),
        avgTx: pctChange(period1.avgTx, period2.avgTx),
        cash: pctChange(period1.cash, period2.cash),
        card: pctChange(period1.card, period2.card),
      },
    });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/hub/notes — Transaction notes
// ═══════════════════════════════════════════════════════════════════════════

export const getNotesReport = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    const where = {
      orgId: req.orgId, status: 'complete',
      notes: { not: null },
      createdAt: { gte: new Date(`${from}T00:00:00`), lte: new Date(`${to}T23:59:59.999`) },
    };
    if (req.storeId) where.storeId = req.storeId;

    const txns = await prisma.transaction.findMany({
      where,
      select: { id: true, txNumber: true, notes: true, grandTotal: true, cashierId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    // Filter out empty strings
    const notes = txns.filter(t => t.notes && t.notes.trim().length > 0).map(t => ({
      txNumber: t.txNumber,
      notes: t.notes,
      total: r2(t.grandTotal),
      cashierId: t.cashierId,
      date: t.createdAt,
    }));

    res.json({ notes, total: notes.length, period: { from, to } });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/hub/events — POS event log (logins, voids, refunds, etc.)
// ═══════════════════════════════════════════════════════════════════════════

export const getEventsReport = async (req, res, next) => {
  try {
    const { from, to, type } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    const where = {
      orgId: req.orgId,
      createdAt: { gte: new Date(`${from}T00:00:00`), lte: new Date(`${to}T23:59:59.999`) },
    };
    if (req.storeId) where.storeId = req.storeId;
    if (type) where.type = type;

    const events = await prisma.posLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    // Group by type for summary
    const byType = {};
    for (const e of events) {
      const t = e.type || 'unknown';
      if (!byType[t]) byType[t] = { type: t, count: 0 };
      byType[t].count += 1;
    }

    res.json({
      events,
      summary: Object.values(byType).sort((a, b) => b.count - a.count),
      total: events.length,
      period: { from, to },
    });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/hub/receive — Received purchase orders
// ═══════════════════════════════════════════════════════════════════════════

export const getReceiveReport = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    const where = {
      orgId: req.orgId,
      status: { in: ['received', 'partial'] },
      receivedDate: { gte: new Date(`${from}T00:00:00`), lte: new Date(`${to}T23:59:59.999`) },
    };
    if (req.storeId) where.storeId = req.storeId;

    const orders = await prisma.purchaseOrder.findMany({
      where,
      include: {
        vendor: { select: { name: true, code: true } },
        items: {
          include: { product: { select: { name: true, upc: true } } },
        },
      },
      orderBy: { receivedDate: 'desc' },
    });

    const summary = {
      totalOrders: orders.length,
      totalItems: orders.reduce((s, o) => s + o.items.length, 0),
      totalValue: r2(orders.reduce((s, o) => s + (Number(o.grandTotal) || 0), 0)),
    };

    res.json({ orders, summary, period: { from, to } });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/hub/house-accounts — Customer balances / store credit
// ═══════════════════════════════════════════════════════════════════════════

export const getHouseAccountReport = async (req, res, next) => {
  try {
    const where = { orgId: req.orgId, deleted: false };
    if (req.storeId) where.storeId = req.storeId;

    const customers = await prisma.customer.findMany({
      where: {
        ...where,
        OR: [
          { balance: { not: null, gt: 0 } },
          { instoreChargeEnabled: true },
        ],
      },
      select: {
        id: true, name: true, firstName: true, lastName: true,
        email: true, phone: true, cardNo: true,
        balance: true, balanceLimit: true, discount: true,
        instoreChargeEnabled: true, loyaltyPoints: true,
      },
      orderBy: { balance: 'desc' },
    });

    const totalBalance = r2(customers.reduce((s, c) => s + (Number(c.balance) || 0), 0));
    const totalLimit = r2(customers.reduce((s, c) => s + (Number(c.balanceLimit) || 0), 0));

    res.json({
      customers: customers.map(c => ({
        ...c,
        name: c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || 'Unknown',
        balance: r2(c.balance),
        balanceLimit: r2(c.balanceLimit),
        discount: c.discount ? r2(Number(c.discount) * 100) : null,
      })),
      summary: {
        totalAccounts: customers.length,
        totalBalance,
        totalLimit,
        activeChargeAccounts: customers.filter(c => c.instoreChargeEnabled).length,
      },
    });
  } catch (err) { next(err); }
};
