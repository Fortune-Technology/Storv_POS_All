// @ts-nocheck — Phase 4: ts-nocheck while Prisma client types catch up.

/**
 * saasMarginController.ts — Session 52.
 *
 * SaaS margin tracking for superadmin:
 *
 *   surchargeCollected        — what the merchant charged customers (revenue
 *                                in their POS)
 *   processorCost (estimate)  — what the merchant pays Dejavoo per agreement
 *                                (configurable per-org via PaymentMerchant.notes
 *                                or future ProcessorCost table; for now uses
 *                                a flat 2.6% + $0.10 default — the typical
 *                                Dejavoo retail rate)
 *   spread                    — surchargeCollected − processorCost
 *   storeveuShare             — configurable revenue share % (default 30%)
 *
 * Mounted at GET /api/admin/saas-margin — superadmin-only.
 *
 * NOTE: this is an estimate today because actual processor costs aren't
 * captured per-tx in PaymentTransaction yet. Tracking real cost requires
 * pulling Dejavoo settlement reports (next phase). The estimate is good
 * enough for monthly margin tracking with a documented assumption.
 */

import type { Request, Response } from 'express';
import prisma from '../config/postgres.js';
import { errMsg } from '../utils/typeHelpers.js';

// Default Dejavoo retail rate. Overridable via env var if a specific deal
// is in place. This is the cost the MERCHANT pays Dejavoo per card tx.
const DEFAULT_PROCESSOR_PCT = parseFloat(process.env.DEJAVOO_DEFAULT_PCT  || '2.6');
const DEFAULT_PROCESSOR_FEE = parseFloat(process.env.DEJAVOO_DEFAULT_FEE  || '0.10');
// Default Storeveu rev-share (% of spread that goes to the platform).
const DEFAULT_STOREVEU_SHARE = parseFloat(process.env.STOREVEU_REVSHARE_PCT || '30');

const r2 = (n: number): number => Math.round(n * 100) / 100;

const startOfLocalDay = (str: string): Date => {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
};
const endOfLocalDay = (str: string): Date => {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
};

/**
 * GET /api/admin/saas-margin?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns per-org rollup with surcharge collected, estimated processor cost,
 * spread, and Storeveu rev-share.
 */
export const getSaasMarginReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) {
      res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
      return;
    }

    const txns = await prisma.transaction.findMany({
      where: {
        pricingModel: 'dual_pricing',
        status: 'complete',
        surchargeAmount: { gt: 0 },
        createdAt: { gte: startOfLocalDay(from), lte: endOfLocalDay(to) },
      },
      select: {
        orgId: true, storeId: true, baseSubtotal: true, taxTotal: true,
        surchargeAmount: true, surchargeTaxAmount: true, grandTotal: true,
      },
    });

    // Per-org aggregation
    const byOrg: Record<string, {
      orgId: string;
      surchargeCollected:    number;
      surchargeTaxCollected: number;
      processorCost:         number;
      cardVolume:            number;
      txCount:               number;
    }> = {};

    for (const tx of txns) {
      if (!byOrg[tx.orgId]) {
        byOrg[tx.orgId] = {
          orgId: tx.orgId,
          surchargeCollected: 0, surchargeTaxCollected: 0,
          processorCost: 0, cardVolume: 0, txCount: 0,
        };
      }
      const row = byOrg[tx.orgId];
      const sa  = Number(tx.surchargeAmount    || 0);
      const sat = Number(tx.surchargeTaxAmount || 0);
      const gt  = Number(tx.grandTotal || 0);
      row.surchargeCollected    += sa;
      row.surchargeTaxCollected += sat;
      row.cardVolume            += gt;
      row.txCount               += 1;
      // Processor cost is calculated against the FULL card-inclusive amount
      // because Dejavoo charges on the gross they authorize.
      row.processorCost += (gt * DEFAULT_PROCESSOR_PCT / 100) + DEFAULT_PROCESSOR_FEE;
    }

    // Resolve org names + tier names + assigned rev-share (if customised in
    // future Org.settings JSON; for now use the env default)
    const orgIds = Object.keys(byOrg);
    const orgs = orgIds.length > 0
      ? await prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true, settings: true },
        })
      : [];
    const orgMap: Record<string, { id: string; name: string; settings: unknown }> = {};
    for (const o of orgs) orgMap[o.id] = o;

    const rows = orgIds.map(orgId => {
      const r = byOrg[orgId];
      const spread = r.surchargeCollected - r.processorCost;
      // Storeveu share — overridable per-org via Organization.settings.storeveuMarginShare
      const orgSettings = (orgMap[orgId]?.settings as Record<string, unknown>) || {};
      const sharePct = Number(orgSettings.storeveuMarginShare ?? DEFAULT_STOREVEU_SHARE);
      const storeveuShare = spread * sharePct / 100;
      return {
        orgId,
        orgName:                orgMap[orgId]?.name || 'Unknown',
        cardVolume:             r2(r.cardVolume),
        txCount:                r.txCount,
        surchargeCollected:     r2(r.surchargeCollected),
        surchargeTaxCollected:  r2(r.surchargeTaxCollected),
        processorCost:          r2(r.processorCost),
        spread:                 r2(spread),
        sharePct:               r2(sharePct),
        storeveuShare:          r2(storeveuShare),
        merchantNet:            r2(spread - storeveuShare),
      };
    }).sort((a, b) => b.spread - a.spread);

    // Aggregate totals
    const total = rows.reduce((acc, r) => ({
      cardVolume:         acc.cardVolume         + r.cardVolume,
      txCount:            acc.txCount            + r.txCount,
      surchargeCollected: acc.surchargeCollected + r.surchargeCollected,
      processorCost:      acc.processorCost      + r.processorCost,
      spread:             acc.spread             + r.spread,
      storeveuShare:      acc.storeveuShare      + r.storeveuShare,
    }), {
      cardVolume: 0, txCount: 0,
      surchargeCollected: 0, processorCost: 0,
      spread: 0, storeveuShare: 0,
    });

    res.json({
      from, to,
      assumptions: {
        processorPct: DEFAULT_PROCESSOR_PCT,
        processorFee: DEFAULT_PROCESSOR_FEE,
        defaultStoreveuShare: DEFAULT_STOREVEU_SHARE,
        notice: 'Processor cost is an estimate based on Dejavoo retail rates. Override per-org via Organization.settings.storeveuMarginShare.',
      },
      summary: {
        cardVolume:         r2(total.cardVolume),
        txCount:            total.txCount,
        surchargeCollected: r2(total.surchargeCollected),
        processorCost:      r2(total.processorCost),
        spread:             r2(total.spread),
        storeveuShare:      r2(total.storeveuShare),
        merchantNet:        r2(total.spread - total.storeveuShare),
      },
      rows,
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};
