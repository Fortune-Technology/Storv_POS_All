/**
 * Loyalty Controller
 * Manages LoyaltyProgram settings, LoyaltyEarnRules, and LoyaltyRewards.
 * Points earning is handled inside posTerminalController → createTransaction.
 */

import type { Request, Response } from 'express';
import prisma from '../config/postgres.js';
import { errMsg } from '../utils/typeHelpers.js';

const getOrgId = (req: Request): string | undefined => req.orgId || req.user?.orgId || undefined;
const dec = (v: unknown): number | undefined =>
  v !== undefined && v !== null && v !== '' ? parseFloat(String(v)) : undefined;
const int = (v: unknown): number | undefined =>
  v !== undefined && v !== null && v !== '' ? parseInt(String(v)) : undefined;

// ── GET /api/loyalty/program ───────────────────────────────────────────────
// Returns the loyalty program for the store, or null if not configured.
export const getProgram = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = req.query.storeId as string | undefined;

    if (!storeId) {
      res.status(400).json({ error: 'storeId required' });
      return;
    }

    const program = await prisma.loyaltyProgram.findUnique({
      where: { storeId },
    });
    res.json(program || null);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── PUT /api/loyalty/program ───────────────────────────────────────────────
// Upsert the loyalty program for a store.
export const upsertProgram = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const {
      storeId,
      enabled,
      programName,
      pointsPerDollar,
      redeemPointsPerDollar,
      minPointsToRedeem,
      maxRedemptionPerTx,
      welcomeBonus,
      birthdayBonus,
      expiryDays,
    } = req.body;

    if (!storeId) {
      res.status(400).json({ error: 'storeId required' });
      return;
    }

    const data: Record<string, unknown> = {
      orgId,
      storeId,
      enabled: enabled !== undefined ? Boolean(enabled) : undefined,
      programName: programName !== undefined ? String(programName).trim() : undefined,
      pointsPerDollar: dec(pointsPerDollar),
      redeemPointsPerDollar: dec(redeemPointsPerDollar),
      minPointsToRedeem: int(minPointsToRedeem),
      maxRedemptionPerTx:
        maxRedemptionPerTx !== undefined &&
        maxRedemptionPerTx !== '' &&
        maxRedemptionPerTx !== null
          ? parseFloat(maxRedemptionPerTx)
          : null,
      welcomeBonus: int(welcomeBonus),
      birthdayBonus: int(birthdayBonus),
      expiryDays:
        expiryDays !== undefined && expiryDays !== '' && expiryDays !== null
          ? parseInt(expiryDays)
          : null,
    };

    // Remove undefined values so Prisma doesn't try to set them
    Object.keys(data).forEach((k) => {
      if (data[k] === undefined) delete data[k];
    });

    const program = await prisma.loyaltyProgram.upsert({
      where: { storeId },
      create: { ...data, orgId, storeId },
      update: data,
    });
    res.json(program);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── GET /api/loyalty/earn-rules ───────────────────────────────────────────
export const getEarnRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = req.query.storeId as string | undefined;
    if (!storeId) {
      res.status(400).json({ error: 'storeId required' });
      return;
    }

    const rules = await prisma.loyaltyEarnRule.findMany({
      where: { orgId, storeId },
      orderBy: [{ targetType: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── POST /api/loyalty/earn-rules ──────────────────────────────────────────
export const createEarnRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { storeId, targetType, targetId, targetName, action, multiplier } = req.body;

    if (!storeId) {
      res.status(400).json({ error: 'storeId required' });
      return;
    }
    if (!targetType) {
      res.status(400).json({ error: 'targetType required' });
      return;
    }
    if (!targetId) {
      res.status(400).json({ error: 'targetId required' });
      return;
    }
    if (!['department', 'product'].includes(targetType)) {
      res.status(400).json({ error: 'targetType must be "department" or "product"' });
      return;
    }
    if (!['exclude', 'multiply'].includes(action)) {
      res.status(400).json({ error: 'action must be "exclude" or "multiply"' });
      return;
    }

    // Prevent duplicate rule for the same target
    const existing = await prisma.loyaltyEarnRule.findFirst({
      where: { orgId, storeId, targetType, targetId },
    });
    if (existing) {
      res.status(409).json({ error: 'A rule for this target already exists.' });
      return;
    }

    const rule = await prisma.loyaltyEarnRule.create({
      data: {
        orgId,
        storeId,
        targetType,
        targetId,
        targetName: targetName || null,
        action,
        multiplier: dec(multiplier) ?? 1,
        active: true,
      },
    });
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── PUT /api/loyalty/earn-rules/:id ──────────────────────────────────────
export const updateEarnRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { action, multiplier, active, targetName } = req.body;

    const rule = await prisma.loyaltyEarnRule.findFirst({
      where: { id: req.params.id, orgId },
    });
    if (!rule) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    const updated = await prisma.loyaltyEarnRule.update({
      where: { id: req.params.id },
      data: {
        action: action !== undefined ? action : undefined,
        multiplier: multiplier !== undefined ? dec(multiplier) : undefined,
        active: active !== undefined ? Boolean(active) : undefined,
        targetName: targetName !== undefined ? targetName : undefined,
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── DELETE /api/loyalty/earn-rules/:id ───────────────────────────────────
export const deleteEarnRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const rule = await prisma.loyaltyEarnRule.findFirst({
      where: { id: req.params.id, orgId },
    });
    if (!rule) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    await prisma.loyaltyEarnRule.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── GET /api/loyalty/rewards ──────────────────────────────────────────────
export const getRewards = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = req.query.storeId as string | undefined;
    if (!storeId) {
      res.status(400).json({ error: 'storeId required' });
      return;
    }

    const rewards = await prisma.loyaltyReward.findMany({
      where: { orgId, storeId },
      orderBy: [{ sortOrder: 'asc' }, { pointsCost: 'asc' }],
    });
    res.json(rewards);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── POST /api/loyalty/rewards ─────────────────────────────────────────────
export const createReward = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const {
      storeId,
      name,
      description,
      pointsCost,
      rewardType,
      rewardValue,
      sortOrder,
    } = req.body;

    if (!storeId) {
      res.status(400).json({ error: 'storeId required' });
      return;
    }
    if (!name?.trim()) {
      res.status(400).json({ error: 'name required' });
      return;
    }
    if (!pointsCost) {
      res.status(400).json({ error: 'pointsCost required' });
      return;
    }
    if (!rewardValue) {
      res.status(400).json({ error: 'rewardValue required' });
      return;
    }

    const reward = await prisma.loyaltyReward.create({
      data: {
        orgId,
        storeId,
        name: name.trim(),
        description: description?.trim() || null,
        pointsCost: parseInt(pointsCost),
        rewardType: rewardType || 'dollar_off',
        rewardValue: parseFloat(rewardValue),
        active: true,
        sortOrder: int(sortOrder) ?? 0,
      },
    });
    res.status(201).json(reward);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── PUT /api/loyalty/rewards/:id ──────────────────────────────────────────
export const updateReward = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const {
      name,
      description,
      pointsCost,
      rewardType,
      rewardValue,
      active,
      sortOrder,
    } = req.body;

    const reward = await prisma.loyaltyReward.findFirst({
      where: { id: req.params.id, orgId },
    });
    if (!reward) {
      res.status(404).json({ error: 'Reward not found' });
      return;
    }

    const updated = await prisma.loyaltyReward.update({
      where: { id: req.params.id },
      data: {
        name: name !== undefined ? name.trim() : undefined,
        description: description !== undefined ? description.trim() : undefined,
        pointsCost: pointsCost !== undefined ? parseInt(pointsCost) : undefined,
        rewardType: rewardType !== undefined ? rewardType : undefined,
        rewardValue: rewardValue !== undefined ? parseFloat(rewardValue) : undefined,
        active: active !== undefined ? Boolean(active) : undefined,
        sortOrder: sortOrder !== undefined ? parseInt(sortOrder) : undefined,
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── DELETE /api/loyalty/rewards/:id ──────────────────────────────────────
export const deleteReward = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const reward = await prisma.loyaltyReward.findFirst({
      where: { id: req.params.id, orgId },
    });
    if (!reward) {
      res.status(404).json({ error: 'Reward not found' });
      return;
    }

    await prisma.loyaltyReward.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── GET /api/loyalty/config (POS-facing — returns program + rules + rewards) ─
// Used by the cashier app to know how to award/redeem points.
export const getPOSLoyaltyConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = req.query.storeId as string | undefined;
    if (!storeId) {
      res.status(400).json({ error: 'storeId required' });
      return;
    }

    const [program, earnRules, rewards] = await Promise.all([
      prisma.loyaltyProgram.findUnique({ where: { storeId } }),
      prisma.loyaltyEarnRule.findMany({ where: { storeId, active: true } }),
      prisma.loyaltyReward.findMany({
        where: { storeId, active: true },
        orderBy: [{ sortOrder: 'asc' }, { pointsCost: 'asc' }],
      }),
    ]);

    if (!program || !program.enabled) {
      res.json({ enabled: false, program: null, earnRules: [], rewards: [] });
      return;
    }

    res.json({ enabled: true, program, earnRules, rewards });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};
