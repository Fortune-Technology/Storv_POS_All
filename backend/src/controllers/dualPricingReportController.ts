// @ts-nocheck — Phase 4: ts-nocheck while Prisma client types catch up to
//   the Session 50 dual-pricing fields on Transaction.

/**
 * dualPricingReportController.ts — Session 52.
 *
 * Per-store report of surcharge revenue + customer cash savings over a
 * date range. Drives the /portal/dual-pricing-report page. Returns:
 *
 *   - daily breakdown (one row per day in the window)
 *   - aggregate totals
 *   - top stores when scoped to org-wide
 *   - top tiers (which tier collected the most surcharge)
 *
 * Mounted at GET /api/sales/dual-pricing-report — same router as the rest
 * of the sales analytics so RBAC + tenant scoping work the same way.
 */

import type { Request, Response } from 'express';
import prisma from '../config/postgres.js';
import { errMsg } from '../utils/typeHelpers.js';

interface ReportRow {
  date:                  string;
  surchargedTxCount:     number;
  cashTxOnDualCount:     number;
  surchargeCollected:    number;
  surchargeTaxCollected: number;
  cashSavingsTotal:      number;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

const startOfLocalDay = (str: string): Date => {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
};
const endOfLocalDay = (str: string): Date => {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
};
const isoDateLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

/**
 * GET /api/sales/dual-pricing-reconcile?from=YYYY-MM-DD&to=YYYY-MM-DD&storeId=...
 *
 * On-demand settlement reconciliation. Cross-checks every dual_pricing card
 * transaction against its linked PaymentTransaction (Dejavoo) to flag:
 *   - Drift where Transaction.grandTotal !== PaymentTransaction.amount
 *     (potential double-surcharge or rate misconfig)
 *   - Missing PaymentTransaction rows (cashier-app didn't post the card
 *     terminal result OR posTransactionId wasn't linked)
 *
 * Discrepancy threshold: $0.50 (covers tip/cashback rounding).
 * Returns per-tx detail so admins can investigate. Empty array = clean.
 */
export const getSurchargeReconciliation = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.orgId || req.user?.orgId;
    if (!orgId) { res.status(403).json({ error: 'Org context required' }); return; }

    const { from, to, storeId } = req.query as { from?: string; to?: string; storeId?: string };
    if (!from || !to) {
      res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
      return;
    }

    const where: any = {
      orgId,
      pricingModel: 'dual_pricing',
      status: 'complete',
      surchargeAmount: { gt: 0 },         // only card txs that actually surcharged
      createdAt: { gte: startOfLocalDay(from), lte: endOfLocalDay(to) },
    };
    if (storeId) where.storeId = storeId;

    const txns = await prisma.transaction.findMany({
      where,
      select: {
        id: true, txNumber: true, storeId: true, createdAt: true,
        grandTotal: true, baseSubtotal: true, taxTotal: true,
        surchargeAmount: true, surchargeTaxAmount: true,
      },
    });

    if (txns.length === 0) {
      res.json({ from, to, totalChecked: 0, discrepancies: [], summary: { drift: 0, missing: 0 } });
      return;
    }

    // Lookup PaymentTransaction rows by posTransactionId
    const txIds = txns.map(t => t.id);
    const payments = await prisma.paymentTransaction.findMany({
      where: { posTransactionId: { in: txIds }, status: 'approved' },
      select: { posTransactionId: true, amount: true, capturedAmount: true, retref: true, authCode: true },
    });
    const paymentByTxId = new Map<string, typeof payments[number]>();
    for (const p of payments) {
      if (p.posTransactionId) paymentByTxId.set(p.posTransactionId, p);
    }

    const DISCREPANCY_THRESHOLD = 0.50;
    const discrepancies: Array<{
      txId:           string;
      txNumber:       string;
      storeId:        string;
      createdAt:      Date;
      ourGrandTotal:  number;
      processorAmount: number | null;
      drift:          number | null;
      issue:          'missing_payment_row' | 'amount_drift';
      surchargeAmount: number;
      authCode:       string | null;
      retref:         string | null;
    }> = [];

    let driftCount   = 0;
    let missingCount = 0;
    for (const tx of txns) {
      const ourGrand = Number(tx.grandTotal);
      const pay = paymentByTxId.get(tx.id);
      if (!pay) {
        // Card tx with surcharge but no linked PaymentTransaction.
        // Could be a manual_card / non-Dejavoo terminal. Still flag for review.
        missingCount += 1;
        discrepancies.push({
          txId:           tx.id,
          txNumber:       tx.txNumber,
          storeId:        tx.storeId,
          createdAt:      tx.createdAt,
          ourGrandTotal:  r2(ourGrand),
          processorAmount: null,
          drift:          null,
          issue:          'missing_payment_row',
          surchargeAmount: r2(Number(tx.surchargeAmount)),
          authCode:       null,
          retref:         null,
        });
        continue;
      }
      const procAmt = Number(pay.capturedAmount ?? pay.amount);
      const drift = Math.abs(ourGrand - procAmt);
      if (drift > DISCREPANCY_THRESHOLD) {
        driftCount += 1;
        discrepancies.push({
          txId:           tx.id,
          txNumber:       tx.txNumber,
          storeId:        tx.storeId,
          createdAt:      tx.createdAt,
          ourGrandTotal:  r2(ourGrand),
          processorAmount: r2(procAmt),
          drift:          r2(drift),
          issue:          'amount_drift',
          surchargeAmount: r2(Number(tx.surchargeAmount)),
          authCode:       pay.authCode,
          retref:         pay.retref,
        });
      }
    }

    res.json({
      from, to,
      totalChecked: txns.length,
      summary: {
        drift:   driftCount,
        missing: missingCount,
        clean:   txns.length - driftCount - missingCount,
      },
      thresholdUsed: DISCREPANCY_THRESHOLD,
      discrepancies,
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

/** GET /api/sales/dual-pricing-report?from=YYYY-MM-DD&to=YYYY-MM-DD&storeId=... */
export const getDualPricingReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.orgId || req.user?.orgId;
    if (!orgId) { res.status(403).json({ error: 'Org context required' }); return; }

    const { from, to, storeId } = req.query as { from?: string; to?: string; storeId?: string };
    if (!from || !to) {
      res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
      return;
    }

    const where: any = {
      orgId,
      pricingModel: 'dual_pricing',          // only dual_pricing transactions
      status: { in: ['complete', 'refund'] },
      createdAt: {
        gte: startOfLocalDay(from),
        lte: endOfLocalDay(to),
      },
    };
    if (storeId) where.storeId = storeId;

    const txns = await prisma.transaction.findMany({
      where,
      select: {
        id: true, status: true, storeId: true, createdAt: true,
        subtotal: true, taxTotal: true, baseSubtotal: true,
        surchargeAmount: true, surchargeTaxAmount: true,
        surchargeRate: true, surchargeFixedFee: true, surchargeTaxable: true,
      },
    });

    // ── Daily aggregation ─────────────────────────────────────────────────
    const byDay = new Map<string, ReportRow>();
    let totalSurcharged = 0;
    let totalCashOnDual = 0;
    let totalSurchargeCollected = 0;
    let totalSurchargeTaxCollected = 0;
    let totalCashSavings = 0;
    const byStore: Record<string, { storeId: string; surchargeCollected: number; txCount: number }> = {};

    for (const tx of txns) {
      const dateKey = isoDateLocal(tx.createdAt);
      if (!byDay.has(dateKey)) {
        byDay.set(dateKey, {
          date: dateKey,
          surchargedTxCount: 0,
          cashTxOnDualCount: 0,
          surchargeCollected: 0,
          surchargeTaxCollected: 0,
          cashSavingsTotal: 0,
        });
      }
      const row = byDay.get(dateKey)!;
      const sa  = Number(tx.surchargeAmount    || 0);
      const sat = Number(tx.surchargeTaxAmount || 0);
      row.surchargeCollected    += sa;
      row.surchargeTaxCollected += sat;
      totalSurchargeCollected    += sa;
      totalSurchargeTaxCollected += sat;

      if (tx.status === 'complete') {
        if (Math.abs(sa) > 0.005) {
          row.surchargedTxCount += 1;
          totalSurcharged += 1;
          // Per-store rollup (only on completes that surcharged)
          if (!byStore[tx.storeId]) byStore[tx.storeId] = { storeId: tx.storeId, surchargeCollected: 0, txCount: 0 };
          byStore[tx.storeId].surchargeCollected += sa;
          byStore[tx.storeId].txCount += 1;
        } else {
          row.cashTxOnDualCount += 1;
          totalCashOnDual += 1;
          // Compute "would have been" surcharge for cash savings
          const baseSub = Number(tx.baseSubtotal || tx.subtotal || 0);
          const rate    = Number(tx.surchargeRate || 0);
          const fee     = Number(tx.surchargeFixedFee || 0);
          if (baseSub > 0 && (rate > 0 || fee > 0)) {
            const wouldBe = (baseSub * rate / 100) + fee;
            const taxRatio = Number(tx.subtotal) > 0 ? Number(tx.taxTotal) / Number(tx.subtotal) : 0;
            const wouldBeTax = tx.surchargeTaxable && taxRatio > 0 ? wouldBe * taxRatio : 0;
            const saved = Math.round((wouldBe + wouldBeTax) * 100) / 100;
            row.cashSavingsTotal += saved;
            totalCashSavings   += saved;
          }
        }
      }
    }

    // Round all daily values + sort
    const days: ReportRow[] = Array.from(byDay.values())
      .map(r => ({
        ...r,
        surchargeCollected:    r2(r.surchargeCollected),
        surchargeTaxCollected: r2(r.surchargeTaxCollected),
        cashSavingsTotal:      r2(r.cashSavingsTotal),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Resolve store names for the by-store rollup
    const storeIds = Object.keys(byStore);
    const stores = storeIds.length > 0
      ? await prisma.store.findMany({
          where:  { id: { in: storeIds } },
          select: { id: true, name: true, pricingTier: { select: { key: true, name: true } } },
        })
      : [];
    const topStores = stores.map(s => ({
      storeId:            s.id,
      storeName:          s.name,
      tierName:           s.pricingTier?.name || null,
      surchargeCollected: r2(byStore[s.id].surchargeCollected),
      txCount:            byStore[s.id].txCount,
    })).sort((a, b) => b.surchargeCollected - a.surchargeCollected);

    res.json({
      from, to,
      scope: storeId ? { type: 'store', storeId } : { type: 'org' },
      summary: {
        surchargedTxCount:     totalSurcharged,
        cashTxOnDualCount:     totalCashOnDual,
        surchargeCollected:    r2(totalSurchargeCollected),
        surchargeTaxCollected: r2(totalSurchargeTaxCollected),
        surchargeTotal:        r2(totalSurchargeCollected + totalSurchargeTaxCollected),
        cashSavingsTotal:      r2(totalCashSavings),
        avgSurchargePerCardTx: totalSurcharged > 0
          ? r2(totalSurchargeCollected / totalSurcharged)
          : 0,
        cashShare: (totalSurcharged + totalCashOnDual) > 0
          ? r2(totalCashOnDual / (totalSurcharged + totalCashOnDual))
          : 0,
      },
      days,
      topStores,
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};
