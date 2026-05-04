/**
 * Promo Suggestions — F28 / S74
 *
 * AI-or-stub-generated promo recommendations awaiting manager review.
 * Approve flow CREATES a Promotion record from the suggestion. Rejected
 * suggestions stay around for AI training feedback.
 *
 * Endpoints:
 *   GET    /api/promo-suggestions                — list with status filter
 *   GET    /api/promo-suggestions/:id            — single suggestion detail
 *   POST   /api/promo-suggestions/generate       — stub generator (will call Claude later)
 *   PUT    /api/promo-suggestions/:id            — edit before approve
 *   POST   /api/promo-suggestions/:id/approve    — approve → create Promotion
 *   POST   /api/promo-suggestions/:id/reject     — reject with reason
 *   POST   /api/promo-suggestions/:id/dismiss    — quick dismiss without reason
 *
 * The stub generator queries existing /catalog/dead-stock + /catalog/expiry
 * endpoints (S74) and synthesises suggestions. When real-AI generation lands,
 * the same endpoints stay but `generatedBy` flips from 'stub' to 'claude'.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '../config/postgres.js';
import { tryParseDate } from '../utils/safeDate.js';

// ── Anthropic client ──────────────────────────────────────────────────
// Real Claude generator activates when ANTHROPIC_API_KEY is set. Otherwise
// the stub fallback runs (deterministic, no external API). Same wire format
// either way — the page UI shows "AI (stub)" vs "AI suggestion" so admins
// can tell which generator produced each suggestion.
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const CLAUDE_MAX_TOKENS = 2048;
const CLAUDE_MAX_TOOL_ITERATIONS = 6;
const CLAUDE_TOOL_TIMEOUT_MS = 12_000;
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

function getOrgId(req: Request): string {
  return (req.orgId || req.user?.orgId) as string;
}

function getStoreId(req: Request): string | null {
  return req.storeId
    || (req.headers['x-store-id'] as string | undefined)
    || (req.query.storeId as string | undefined)
    || null;
}

// Permissive shape — Prisma types come back as `any` from the JS wrapper.
type SuggestionRow = {
  id: number;
  orgId: string;
  storeId: string | null;
  status: string;
  promoType: string;
  title: string;
  proposedScope: unknown;
  proposedConfig: unknown;
  proposedStartDate: Date | null;
  proposedEndDate: Date | null;
  rationale: unknown;
  estImpact: unknown;
  generatedBy: string;
  reviewedById: string | null;
  reviewedAt: Date | null;
  rejectReason: string | null;
  createdPromoId: number | null;
  generatedAt: Date;
  updatedAt: Date;
};

// ─────────────────────────────────────────────────────────────────────
// GET /promo-suggestions  — list with status + storeId filters
// ─────────────────────────────────────────────────────────────────────
export const listSuggestions = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStoreId(req);
    const status = (req.query.status as string | undefined) || 'pending';

    const where: Prisma.PromoSuggestionWhereInput = { orgId };
    if (status !== 'all') where.status = status;
    if (storeId) where.OR = [{ storeId }, { storeId: null }]; // org-wide + store-specific

    const rows = await prisma.promoSuggestion.findMany({
      where,
      orderBy: [{ status: 'asc' }, { generatedAt: 'desc' }],
      take: 200,
    });

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
};

// ─────────────────────────────────────────────────────────────────────
// GET /promo-suggestions/:id
// ─────────────────────────────────────────────────────────────────────
export const getSuggestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid suggestion id.' });
      return;
    }
    const row = await prisma.promoSuggestion.findFirst({ where: { id, orgId } });
    if (!row) {
      res.status(404).json({ success: false, error: 'Suggestion not found.' });
      return;
    }
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
};

// ─────────────────────────────────────────────────────────────────────
// PUT /promo-suggestions/:id  — edit (only when status=pending)
// ─────────────────────────────────────────────────────────────────────
export const updateSuggestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid suggestion id.' });
      return;
    }
    const existing = await prisma.promoSuggestion.findFirst({ where: { id, orgId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Suggestion not found.' });
      return;
    }
    if (existing.status !== 'pending') {
      res.status(400).json({ success: false, error: 'Only pending suggestions can be edited.' });
      return;
    }

    const data: Prisma.PromoSuggestionUpdateInput = {};
    const { title, promoType, proposedScope, proposedConfig, proposedStartDate, proposedEndDate } = req.body;
    if (title !== undefined) data.title = title;
    if (promoType !== undefined) data.promoType = promoType;
    if (proposedScope !== undefined) data.proposedScope = proposedScope as Prisma.InputJsonValue;
    if (proposedConfig !== undefined) data.proposedConfig = proposedConfig as Prisma.InputJsonValue;
    if (proposedStartDate !== undefined) {
      const r = tryParseDate(res, proposedStartDate, 'proposedStartDate');
      if (!r.ok) return;
      data.proposedStartDate = r.value;
    }
    if (proposedEndDate !== undefined) {
      const r = tryParseDate(res, proposedEndDate, 'proposedEndDate');
      if (!r.ok) return;
      data.proposedEndDate = r.value;
    }

    const updated = await prisma.promoSuggestion.update({ where: { id }, data });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
};

// ─────────────────────────────────────────────────────────────────────
// POST /promo-suggestions/:id/approve  → create Promotion + mark approved
// ─────────────────────────────────────────────────────────────────────
export const approveSuggestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.user?.id as string;
    const id = parseInt(req.params.id);

    const existing = await prisma.promoSuggestion.findFirst({ where: { id, orgId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Suggestion not found.' });
      return;
    }
    if (existing.status !== 'pending') {
      res.status(400).json({ success: false, error: `Cannot approve: status is ${existing.status}.` });
      return;
    }

    const scope = (existing.proposedScope || {}) as Record<string, unknown>;
    const productIds = Array.isArray(scope.productIds) ? (scope.productIds as number[]) : [];
    const departmentIds = Array.isArray(scope.departmentIds) ? (scope.departmentIds as number[]) : [];
    const productGroupIds = Array.isArray(scope.productGroupIds) ? (scope.productGroupIds as number[]) : [];

    // Atomic: create Promotion, link back to suggestion
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const promo = await tx.promotion.create({
        data: {
          orgId,
          name: existing.title,
          promoType: existing.promoType,
          description: `Approved from AI suggestion #${existing.id}`,
          productIds,
          departmentIds,
          productGroupIds,
          dealConfig: (existing.proposedConfig || {}) as Prisma.InputJsonValue,
          startDate: existing.proposedStartDate,
          endDate: existing.proposedEndDate,
          active: true,
          badgeLabel: req.body.badgeLabel ?? null,
          badgeColor: req.body.badgeColor ?? null,
        },
      });

      const updatedSugg = await tx.promoSuggestion.update({
        where: { id },
        data: {
          status: 'approved',
          reviewedById: userId,
          reviewedAt: new Date(),
          createdPromoId: promo.id,
        },
      });

      return { promo, suggestion: updatedSugg };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
};

// ─────────────────────────────────────────────────────────────────────
// POST /promo-suggestions/:id/reject — reject with feedback
// ─────────────────────────────────────────────────────────────────────
export const rejectSuggestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.user?.id as string;
    const id = parseInt(req.params.id);
    const reason = (req.body?.reason as string | undefined)?.slice(0, 500) || null;

    const existing = await prisma.promoSuggestion.findFirst({ where: { id, orgId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Suggestion not found.' });
      return;
    }
    if (existing.status !== 'pending') {
      res.status(400).json({ success: false, error: `Cannot reject: status is ${existing.status}.` });
      return;
    }

    const updated = await prisma.promoSuggestion.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewedById: userId,
        reviewedAt: new Date(),
        rejectReason: reason,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
};

// ─────────────────────────────────────────────────────────────────────
// POST /promo-suggestions/:id/dismiss — quick dismiss
// ─────────────────────────────────────────────────────────────────────
export const dismissSuggestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.user?.id as string;
    const id = parseInt(req.params.id);

    const existing = await prisma.promoSuggestion.findFirst({ where: { id, orgId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Suggestion not found.' });
      return;
    }
    if (existing.status !== 'pending') {
      res.status(400).json({ success: false, error: `Cannot dismiss: status is ${existing.status}.` });
      return;
    }
    const updated = await prisma.promoSuggestion.update({
      where: { id },
      data: {
        status: 'dismissed',
        reviewedById: userId,
        reviewedAt: new Date(),
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
};

// ─────────────────────────────────────────────────────────────────────
// POST /promo-suggestions/generate
// Stub generator — pulls real data from existing dead-stock + expiry
// queries and synthesises plausible promo suggestions. Will be replaced
// with Anthropic tool-use call in a follow-up session; the wire format
// stays the same.
// ─────────────────────────────────────────────────────────────────────

interface DeadStockProduct {
  id: number;
  name: string;
  upc?: string | null;
  department: { id: number; name: string } | null;
  productGroupId: number | null;
  retailPrice: number | null;
  costPrice: number | null;
  onHand: number;
  daysSinceSold: number | null;
  retailValueAtRisk: number;
}
interface ExpiryRow {
  productId: number;
  name: string;
  upc?: string | null;
  department: { id: number; name: string } | null;
  productGroupId: number | null;
  retailPrice: number | null;
  onHand: number;
  expiryDate: string | Date | null;
  daysUntilExpiry: number | null;
  status: string;
  retailValue: number;
}

// HTTP handler — dispatches to the real Claude generator when ANTHROPIC_API_KEY
// is set, otherwise to the deterministic stub. Both paths return the same
// `{ data, meta }` shape so the UI doesn't care which one ran.
export const generateSuggestions = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStoreId(req);
    if (!storeId) {
      res.status(400).json({ success: false, error: 'storeId required (X-Store-Id header).' });
      return;
    }

    if (anthropic) {
      // Real Claude path — uses tool-use to query data + propose promos.
      // Falls back to stub if Claude errors out (network, rate limit, etc.)
      try {
        const result = await runClaudeGenerator(orgId, storeId);
        res.json({ success: true, data: result.created, meta: result.meta });
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[PromoSuggestions] Claude generator failed, falling back to stub:', msg);
        // fall through to stub
      }
    }

    const stub = await runStubGenerator(orgId, storeId);
    res.json({ success: true, data: stub.created, meta: { ...stub.meta, generator: 'stub' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
};

// ── Stub generator ────────────────────────────────────────────────────
// Pure-server, deterministic. Pulls from S74 expiry + dead-stock data.
async function runStubGenerator(orgId: string, storeId: string): Promise<{
  created: SuggestionRow[];
  meta: { created: number; skipped: number; sources: { expiring: number; deadCandidates: number } };
}> {
  const created: SuggestionRow[] = [];
  const skipped: string[] = [];

    // ── Source 1: Expiring soon (within 7 days) ──────────────────
    // Skip if a non-rejected suggestion already exists for this product
    // in the last 7 days (avoid duplicate spam on every Generate click).
    const expiryRows = await prisma.storeProduct.findMany({
      where: {
        orgId,
        storeId,
        expiryDate: {
          not: null,
          lte: new Date(Date.now() + 7 * 86_400_000),  // within 7 days OR already expired
        },
        masterProduct: { active: true, deleted: false },
      },
      take: 20,
      include: {
        masterProduct: {
          select: {
            id: true, name: true, upc: true,
            defaultRetailPrice: true,
            departmentId: true,
            department: { select: { id: true, name: true } },
            productGroupId: true,
          },
        },
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const row of expiryRows) {
      const r = row as unknown as {
        masterProductId: number;
        quantityOnHand: Prisma.Decimal | null;
        expiryDate: Date | null;
        masterProduct: {
          id: number; name: string; upc: string | null;
          defaultRetailPrice: Prisma.Decimal | null;
          departmentId: number | null;
          department: { id: number; name: string } | null;
          productGroupId: number | null;
        };
      };
      const onHand = Number(r.quantityOnHand) || 0;
      if (onHand <= 0) continue;
      if (!r.expiryDate) continue;

      const days = Math.floor((r.expiryDate.getTime() - today.getTime()) / 86_400_000);
      const retailPrice = Number(r.masterProduct.defaultRetailPrice) || 0;
      const valueAtRisk = onHand * retailPrice;

      // Skip if a recent pending suggestion already covers this product
      const recent = await prisma.promoSuggestion.findFirst({
        where: {
          orgId,
          status: 'pending',
          generatedAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
          // raw JSON path query simulated via fetching all + filtering
        },
        select: { id: true, proposedScope: true },
      });
      if (recent) {
        const scope = (recent.proposedScope || {}) as { productIds?: number[] };
        if (Array.isArray(scope.productIds) && scope.productIds.includes(r.masterProduct.id)) {
          skipped.push(`expiring-${r.masterProduct.id}`);
          continue;
        }
      }

      // Discount level based on urgency
      const discount = days < 0 ? 50 : days <= 1 ? 40 : days <= 3 ? 30 : 20;

      // 7-day promo window starting today
      const startDate = new Date(today);
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + 7);

      const sugg = await prisma.promoSuggestion.create({
        data: {
          orgId,
          storeId,
          status: 'pending',
          promoType: 'sale',
          title: days < 0
            ? `Expired: ${r.masterProduct.name} → ${discount}% clearance`
            : `Expires in ${days}d: ${r.masterProduct.name} → ${discount}% off`,
          proposedScope: { productIds: [r.masterProduct.id], departmentIds: [], productGroupIds: [] },
          proposedConfig: {
            discountType: 'percent',
            discountValue: discount,
            minQty: 1,
          },
          proposedStartDate: startDate,
          proposedEndDate: endDate,
          rationale: {
            source: 'expiring',
            citations: [
              {
                kind: 'expiry',
                productId: r.masterProduct.id,
                expiryDate: r.expiryDate,
                daysUntilExpiry: days,
                onHand,
                retailValueAtRisk: Math.round(valueAtRisk * 100) / 100,
              },
            ],
            reasoning: days < 0
              ? `Already expired with ${onHand.toFixed(0)} units on hand. Suggest aggressive ${discount}% clearance to recover any value before disposal.`
              : `Expires in ${days} days with ${onHand.toFixed(0)} units on hand ($${valueAtRisk.toFixed(2)} at risk). Suggest ${discount}% off to move stock before expiry.`,
          },
          estImpact: {
            expectedSales: Math.round(valueAtRisk * (1 - discount / 100) * 0.6 * 100) / 100,
            unitsCleared: Math.floor(onHand * 0.6),
            valueAtRisk: Math.round(valueAtRisk * 100) / 100,
          },
          generatedBy: 'stub',
        },
      });
      created.push(sugg as unknown as SuggestionRow);
    }

    // ── Source 2: Dead stock (no sales in 30+ days) ─────────────
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const candidates = await prisma.masterProduct.findMany({
      where: {
        orgId, active: true, deleted: false, trackInventory: true,
        storeProducts: {
          some: { storeId, quantityOnHand: { gt: 0 } },
        },
      },
      take: 50,
      select: {
        id: true, name: true, upc: true,
        defaultRetailPrice: true, defaultCostPrice: true,
        department: { select: { id: true, name: true } },
        productGroupId: true,
        storeProducts: {
          where: { storeId },
          select: { quantityOnHand: true },
          take: 1,
        },
      },
    });

    // Pull recent transactions to identify which products HAVE moved
    const txns = await prisma.transaction.findMany({
      where: { orgId, storeId, status: 'complete', createdAt: { gte: cutoff } },
      select: { lineItems: true },
    });
    const movedProductIds = new Set<number>();
    for (const tx of txns) {
      const items = Array.isArray(tx.lineItems) ? (tx.lineItems as unknown as Array<{ productId?: number }>) : [];
      for (const li of items) {
        if (li.productId) movedProductIds.add(Number(li.productId));
      }
    }

    type CandidateRow = (typeof candidates)[number];
    type DeadCandidate = { p: CandidateRow; onHand: number; retailValueAtRisk: number };
    const deadCandidates: DeadCandidate[] = candidates
      .filter((p: CandidateRow) => !movedProductIds.has(p.id))
      .map((p: CandidateRow) => {
        const sp = (p as unknown as { storeProducts: Array<{ quantityOnHand: Prisma.Decimal | null }> }).storeProducts[0];
        const onHand = Number(sp?.quantityOnHand) || 0;
        const retailPrice = Number(p.defaultRetailPrice) || 0;
        return { p, onHand, retailValueAtRisk: onHand * retailPrice };
      })
      .filter((c: DeadCandidate) => c.retailValueAtRisk >= 20)  // ≥ $20 worth
      .sort((a: DeadCandidate, b: DeadCandidate) => b.retailValueAtRisk - a.retailValueAtRisk)
      .slice(0, 5); // top 5 by $-at-risk

    for (const c of deadCandidates) {
      // De-dup: skip if pending suggestion already exists for this product
      const existing = await prisma.promoSuggestion.findFirst({
        where: {
          orgId,
          status: 'pending',
          generatedAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
        },
        select: { id: true, proposedScope: true },
      });
      if (existing) {
        const scope = (existing.proposedScope || {}) as { productIds?: number[] };
        if (Array.isArray(scope.productIds) && scope.productIds.includes(c.p.id)) {
          skipped.push(`dead-${c.p.id}`);
          continue;
        }
      }

      const discount = 25;
      const startDate = new Date(today);
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + 14);

      const sugg = await prisma.promoSuggestion.create({
        data: {
          orgId,
          storeId,
          status: 'pending',
          promoType: 'sale',
          title: `Slow-mover: ${c.p.name} → ${discount}% off`,
          proposedScope: { productIds: [c.p.id], departmentIds: [], productGroupIds: [] },
          proposedConfig: {
            discountType: 'percent',
            discountValue: discount,
            minQty: 1,
          },
          proposedStartDate: startDate,
          proposedEndDate: endDate,
          rationale: {
            source: 'dead_stock',
            citations: [
              {
                kind: 'dead_stock',
                productId: c.p.id,
                onHand: c.onHand,
                retailValueAtRisk: Math.round(c.retailValueAtRisk * 100) / 100,
                daysWithoutSale: 30,
              },
            ],
            reasoning: `No sales in last 30 days. ${c.onHand.toFixed(0)} units on hand worth $${c.retailValueAtRisk.toFixed(2)}. Suggest ${discount}% off for 14 days to clear shelf space and free up working capital.`,
          },
          estImpact: {
            expectedSales: Math.round(c.retailValueAtRisk * (1 - discount / 100) * 0.4 * 100) / 100,
            unitsCleared: Math.floor(c.onHand * 0.4),
            valueAtRisk: Math.round(c.retailValueAtRisk * 100) / 100,
          },
          generatedBy: 'stub',
        },
      });
      created.push(sugg as unknown as SuggestionRow);
    }

    return {
      created,
      meta: {
        created: created.length,
        skipped: skipped.length,
        sources: { expiring: expiryRows.length, deadCandidates: deadCandidates.length },
      },
    };
}

// ── Claude generator ──────────────────────────────────────────────────
// Real AI path. Anthropic SDK with tool-use:
//   1. Claude can call tool_get_expiring_products(daysWindow) — returns
//      list of products with expiry ≤ N days at this store
//   2. Claude can call tool_get_dead_stock(daysWithoutSale, minOnHand,
//      minValueAtRisk) — products with no sales + significant inventory
//   3. Claude calls tool_propose_promo(...) for each suggestion it wants
//      to register. Each propose_promo call writes a PromoSuggestion row
//      with generatedBy='claude' and full provenance from tool results.
//
// 6-iteration cap + 12s per-tool timeout. Errors propagate to the HTTP
// handler, which falls back to the stub.

interface ClaudeProposal {
  title: string;
  promoType: 'sale' | 'bogo' | 'volume' | 'mix_match' | 'combo';
  productIds?: number[];
  departmentIds?: number[];
  productGroupIds?: number[];
  discountType: 'percent' | 'amount' | 'fixed';
  discountValue: number;
  minQty?: number;
  durationDays?: number;
  reasoning: string;
  source: 'expiring' | 'dead_stock' | 'seasonal' | 'top_mover' | 'other';
  citations?: Array<Record<string, unknown>>;
  estImpact?: Record<string, unknown>;
}

const CLAUDE_TOOLS = [
  {
    name: 'get_expiring_products',
    description: 'Query products with expiry dates within the specified window at the active store. Returns: productId, name, upc, departmentId, departmentName, productGroupId, retailPrice, onHand, expiryDate, daysUntilExpiry, retailValueAtRisk. Use this to find expiring stock that might warrant a clearance promo. Already-expired items have negative daysUntilExpiry.',
    input_schema: {
      type: 'object',
      properties: {
        daysWindow: { type: 'integer', description: 'Look this many days into the future for expiries. Use 7 for typical weekly clearance review, 14 for slower-moving categories.', default: 7 },
      },
    },
  },
  {
    name: 'get_dead_stock',
    description: 'Query products with positive inventory but no sales in the past N days. Returns: productId, name, upc, departmentId, departmentName, productGroupId, retailPrice, onHand, daysSinceSold, retailValueAtRisk, lastSoldAt. Use this to find slow-movers worth clearing with a promo.',
    input_schema: {
      type: 'object',
      properties: {
        daysWithoutSale: { type: 'integer', description: 'How many days back to consider "no sales".', default: 30 },
        minOnHand: { type: 'number', description: 'Skip products below this on-hand quantity.', default: 1 },
        minValueAtRisk: { type: 'number', description: 'Skip products whose retailValueAtRisk is below this $ threshold (so we focus on $20+ stuck on shelf, not pennies).', default: 20 },
      },
    },
  },
  {
    name: 'propose_promo',
    description: 'Register a single promo suggestion for the manager to review. Call this once per promo you want to recommend. Each call creates a draft PromoSuggestion row that the manager will see in the review queue. Be specific in title and reasoning so the manager has full context.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short human-readable label for the suggestion. Examples: "Slow-mover: Heady Topper IPA → 25% off", "Expires in 2d: Greek Yogurt Sampler → 35% clearance".' },
        promoType: { type: 'string', enum: ['sale', 'bogo', 'volume', 'mix_match', 'combo'], description: 'Use "sale" for percent-off / dollar-off / fixed-price, the other types only when you have a clear reason.' },
        productIds: { type: 'array', items: { type: 'integer' }, description: 'Specific products this promo targets. Leave empty if scoping by department/group instead.' },
        departmentIds: { type: 'array', items: { type: 'integer' }, description: 'Departments this promo targets (broader scope).' },
        productGroupIds: { type: 'array', items: { type: 'integer' }, description: 'Product groups this promo targets (broadest curated scope).' },
        discountType: { type: 'string', enum: ['percent', 'amount', 'fixed'], description: 'percent = % off retail, amount = $ off retail, fixed = override sell price.' },
        discountValue: { type: 'number', description: 'Number paired with discountType. For 25% off, discountType=percent, discountValue=25.' },
        minQty: { type: 'integer', description: 'Minimum units in cart for promo to apply. Default 1.', default: 1 },
        durationDays: { type: 'integer', description: 'How many days the promo runs starting today. 7 for clearance, 14 for slow-mover, 1-2 for expiring-tomorrow.', default: 7 },
        reasoning: { type: 'string', description: 'Plain-English justification for this specific promo. Cite the exact data you saw: "12 units expire in 2 days at $4.99 = $59.88 at risk; 35% off targets a 60% sell-through to recover $23.40." Keep it 1-3 sentences.' },
        source: { type: 'string', enum: ['expiring', 'dead_stock', 'seasonal', 'top_mover', 'other'], description: 'Which data source motivated this suggestion.' },
        citations: { type: 'array', description: 'Structured data references for the manager. Each entry should include the productId + the specific metrics you considered (daysUntilExpiry, daysSinceSold, onHand, retailValueAtRisk).' },
        estImpact: { type: 'object', description: 'Your estimate: { expectedSales, unitsCleared, valueAtRisk } in dollars/units.' },
      },
      required: ['title', 'promoType', 'discountType', 'discountValue', 'reasoning', 'source'],
    },
  },
];

async function tool_get_expiring_products(orgId: string, storeId: string, args: { daysWindow?: number }): Promise<unknown> {
  const daysWindow = Math.max(1, Math.min(60, Number(args.daysWindow ?? 7)));
  const cutoff = new Date(Date.now() + daysWindow * 86_400_000);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = await prisma.storeProduct.findMany({
    where: {
      orgId, storeId,
      expiryDate: { not: null, lte: cutoff },
      quantityOnHand: { gt: 0 },
      masterProduct: { active: true, deleted: false },
    },
    take: 50,
    include: {
      masterProduct: {
        select: {
          id: true, name: true, upc: true,
          defaultRetailPrice: true,
          departmentId: true,
          department: { select: { id: true, name: true } },
          productGroupId: true,
        },
      },
    },
  });

  type ExpiryRow = (typeof rows)[number];
  return rows.map((r: ExpiryRow) => {
    const r2 = r as unknown as {
      quantityOnHand: Prisma.Decimal | null;
      expiryDate: Date | null;
      masterProduct: {
        id: number; name: string; upc: string | null;
        defaultRetailPrice: Prisma.Decimal | null;
        departmentId: number | null;
        department: { id: number; name: string } | null;
        productGroupId: number | null;
      };
    };
    const onHand = Number(r2.quantityOnHand) || 0;
    const retailPrice = Number(r2.masterProduct.defaultRetailPrice) || 0;
    const days = r2.expiryDate
      ? Math.floor((r2.expiryDate.getTime() - today.getTime()) / 86_400_000)
      : null;
    return {
      productId: r2.masterProduct.id,
      name: r2.masterProduct.name,
      upc: r2.masterProduct.upc,
      departmentId: r2.masterProduct.departmentId,
      departmentName: r2.masterProduct.department?.name || null,
      productGroupId: r2.masterProduct.productGroupId,
      retailPrice,
      onHand,
      expiryDate: r2.expiryDate?.toISOString() || null,
      daysUntilExpiry: days,
      retailValueAtRisk: Math.round(onHand * retailPrice * 100) / 100,
    };
  });
}

async function tool_get_dead_stock(orgId: string, storeId: string, args: {
  daysWithoutSale?: number; minOnHand?: number; minValueAtRisk?: number;
}): Promise<unknown> {
  const days = Math.max(7, Math.min(180, Number(args.daysWithoutSale ?? 30)));
  const minOnHand = Math.max(0, Number(args.minOnHand ?? 1));
  const minValue = Math.max(0, Number(args.minValueAtRisk ?? 20));
  const cutoff = new Date(Date.now() - days * 86_400_000);

  // Products with stock at this store
  const products = await prisma.masterProduct.findMany({
    where: {
      orgId, active: true, deleted: false, trackInventory: true,
      storeProducts: { some: { storeId, quantityOnHand: { gt: 0 } } },
    },
    take: 100,
    select: {
      id: true, name: true, upc: true,
      defaultRetailPrice: true,
      department: { select: { id: true, name: true } },
      productGroupId: true,
      storeProducts: {
        where: { storeId },
        select: { quantityOnHand: true, lastReceivedAt: true },
        take: 1,
      },
    },
  });

  // Map: productId → most recent sale date (within past year)
  const wayBack = new Date(Date.now() - 365 * 86_400_000);
  const txns = await prisma.transaction.findMany({
    where: { orgId, storeId, status: 'complete', createdAt: { gte: wayBack } },
    select: { lineItems: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const lastSold: Record<string, Date> = {};
  const soldInWindow = new Set<number>();
  for (const tx of txns) {
    const items = Array.isArray(tx.lineItems) ? (tx.lineItems as unknown as Array<{ productId?: number; isLottery?: boolean; isBottleReturn?: boolean }>) : [];
    for (const li of items) {
      if (!li.productId || li.isLottery || li.isBottleReturn) continue;
      const k = String(li.productId);
      if (!lastSold[k]) lastSold[k] = tx.createdAt;
      if (tx.createdAt >= cutoff) soldInWindow.add(li.productId);
    }
  }

  type ProductRow = (typeof products)[number];
  type DeadStockRow = {
    productId: number; name: string; upc: string | null;
    departmentId: number | null; departmentName: string | null;
    productGroupId: number | null;
    retailPrice: number; onHand: number;
    daysSinceSold: number | null; lastSoldAt: string | null;
    retailValueAtRisk: number;
  };
  const today = new Date();
  return products
    .map((p: ProductRow): DeadStockRow => {
      const sp = (p as unknown as { storeProducts: Array<{ quantityOnHand: Prisma.Decimal | null }> }).storeProducts[0];
      const onHand = Number(sp?.quantityOnHand) || 0;
      const retailPrice = Number(p.defaultRetailPrice) || 0;
      const last = lastSold[String(p.id)];
      const daysSinceSold = last
        ? Math.floor((today.getTime() - last.getTime()) / 86_400_000)
        : null;
      return {
        productId: p.id,
        name: p.name,
        upc: p.upc,
        departmentId: p.department?.id || null,
        departmentName: p.department?.name || null,
        productGroupId: p.productGroupId,
        retailPrice,
        onHand,
        daysSinceSold,
        lastSoldAt: last?.toISOString() || null,
        retailValueAtRisk: Math.round(onHand * retailPrice * 100) / 100,
      };
    })
    .filter((p: DeadStockRow) => p.onHand >= minOnHand
      && p.retailValueAtRisk >= minValue
      && !soldInWindow.has(p.productId))
    .sort((a: DeadStockRow, b: DeadStockRow) => b.retailValueAtRisk - a.retailValueAtRisk)
    .slice(0, 30);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Tool ${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function runClaudeGenerator(orgId: string, storeId: string): Promise<{
  created: SuggestionRow[];
  meta: Record<string, unknown>;
}> {
  if (!anthropic) throw new Error('Anthropic client not configured');

  const proposals: ClaudeProposal[] = [];
  const toolCalls: Array<{ name: string; input: unknown; durationMs: number }> = [];

  const systemPrompt = `You are a retail merchandising AI. Your job is to propose promotional discounts for a single store, focused on slow-moving and expiring inventory. You have access to tools that query the store's real data.

Process:
1. Call get_expiring_products to find stock with imminent expiry. Discount more aggressively as the date approaches (e.g., 50% if already expired, 40% for 1-day, 30% for 2-3 days, 20% for 4-7 days).
2. Call get_dead_stock to find products that haven't moved. A 25% discount over 14 days is usually enough.
3. Call propose_promo once for each promo you want the manager to review. Aim for 3-8 high-quality suggestions, not a flood of low-value ones.

Quality bar:
- Only propose promos with retailValueAtRisk ≥ $20 (don't waste the manager's time on $5 of stuck stock)
- Cite specific data in your reasoning ("12 units × $4.99 = $59.88 at risk")
- For expiring items, set durationDays to match the expiry window (don't propose a 14-day promo on something that expires tomorrow)
- Include citations[] with the productId + the metrics you considered

Stop calling tools and end your response when you've proposed all the promos you want. Don't write a summary — just call the tools.`;

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: 'Analyse this store\'s inventory and propose 3-8 promo suggestions.' },
  ];

  for (let iter = 0; iter < CLAUDE_MAX_TOOL_ITERATIONS; iter++) {
    const resp = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      system: systemPrompt,
      tools: CLAUDE_TOOLS as Anthropic.Tool[],
      messages,
    });

    if (resp.stop_reason !== 'tool_use') {
      // Claude is done — either text-only response (no proposals) or all tools have run
      messages.push({ role: 'assistant', content: resp.content });
      break;
    }

    // Process tool_use blocks in this turn
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue;
      const t0 = Date.now();
      try {
        let result: unknown;
        if (block.name === 'get_expiring_products') {
          result = await withTimeout(tool_get_expiring_products(orgId, storeId, block.input as { daysWindow?: number }), CLAUDE_TOOL_TIMEOUT_MS, block.name);
        } else if (block.name === 'get_dead_stock') {
          result = await withTimeout(tool_get_dead_stock(orgId, storeId, block.input as Record<string, number>), CLAUDE_TOOL_TIMEOUT_MS, block.name);
        } else if (block.name === 'propose_promo') {
          // Don't execute — just record the proposal
          proposals.push(block.input as ClaudeProposal);
          result = { ok: true, recorded: true };
        } else {
          result = { error: `Unknown tool: ${block.name}` };
        }
        toolCalls.push({ name: block.name, input: block.input, durationMs: Date.now() - t0 });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ error: msg }),
          is_error: true,
        });
      }
    }

    messages.push({ role: 'assistant', content: resp.content });
    messages.push({ role: 'user', content: toolResults });
  }

  // ── Persist proposals as PromoSuggestion rows ───────────────
  const created: SuggestionRow[] = [];
  for (const p of proposals) {
    // Skip duplicates: any pending suggestion in the past 7 days for the same product
    const productIds = Array.isArray(p.productIds) ? p.productIds : [];
    if (productIds.length > 0) {
      const recentDup = await prisma.promoSuggestion.findFirst({
        where: {
          orgId,
          status: 'pending',
          generatedAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
        },
        select: { proposedScope: true },
      });
      if (recentDup) {
        const existingScope = (recentDup.proposedScope || {}) as { productIds?: number[] };
        if (Array.isArray(existingScope.productIds)
          && productIds.some((id) => existingScope.productIds!.includes(id))) {
          continue;
        }
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.max(1, Math.min(90, Number(p.durationDays || 7)));
    const startDate = new Date(today);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + days);

    try {
      const sugg = await prisma.promoSuggestion.create({
        data: {
          orgId,
          storeId,
          status: 'pending',
          promoType: p.promoType,
          title: p.title,
          proposedScope: {
            productIds: productIds,
            departmentIds: Array.isArray(p.departmentIds) ? p.departmentIds : [],
            productGroupIds: Array.isArray(p.productGroupIds) ? p.productGroupIds : [],
          },
          proposedConfig: {
            discountType: p.discountType,
            discountValue: p.discountValue,
            minQty: p.minQty || 1,
          },
          proposedStartDate: startDate,
          proposedEndDate: endDate,
          rationale: {
            source: p.source,
            citations: Array.isArray(p.citations) ? p.citations : [],
            reasoning: p.reasoning,
          },
          estImpact: p.estImpact || null,
          generatedBy: 'claude',
        },
      });
      created.push(sugg as unknown as SuggestionRow);
    } catch (err) {
      console.warn('[PromoSuggestions] Skipped invalid Claude proposal:', err instanceof Error ? err.message : err);
    }
  }

  return {
    created,
    meta: {
      created: created.length,
      proposed: proposals.length,
      skipped: proposals.length - created.length,
      generator: 'claude',
      toolCalls: toolCalls.length,
      iterations: Math.min(CLAUDE_MAX_TOOL_ITERATIONS, toolCalls.length),
    },
  };
}
