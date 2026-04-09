/**
 * Loyalty Controller
 * Manages LoyaltyProgram settings, LoyaltyEarnRules, and LoyaltyRewards.
 * Points earning is handled inside posTerminalController → createTransaction.
 */

import prisma from '../config/postgres.js';

const getOrgId   = (req) => req.orgId || req.user?.orgId;
const dec        = (v)   => v !== undefined && v !== null && v !== '' ? parseFloat(v) : undefined;
const int        = (v)   => v !== undefined && v !== null && v !== '' ? parseInt(v)   : undefined;

// ── GET /api/loyalty/program ───────────────────────────────────────────────
// Returns the loyalty program for the store, or null if not configured.
export const getProgram = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = req.query.storeId;

    if (!storeId) return res.status(400).json({ error: 'storeId required' });

    const program = await prisma.loyaltyProgram.findUnique({
      where: { storeId },
    });
    res.json(program || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PUT /api/loyalty/program ───────────────────────────────────────────────
// Upsert the loyalty program for a store.
export const upsertProgram = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const {
      storeId, enabled, programName,
      pointsPerDollar, redeemPointsPerDollar, minPointsToRedeem,
      maxRedemptionPerTx, welcomeBonus, birthdayBonus, expiryDays,
    } = req.body;

    if (!storeId) return res.status(400).json({ error: 'storeId required' });

    const data = {
      orgId,
      storeId,
      enabled:              enabled !== undefined ? Boolean(enabled) : undefined,
      programName:          programName !== undefined ? String(programName).trim() : undefined,
      pointsPerDollar:      dec(pointsPerDollar),
      redeemPointsPerDollar:dec(redeemPointsPerDollar),
      minPointsToRedeem:    int(minPointsToRedeem),
      maxRedemptionPerTx:   maxRedemptionPerTx !== undefined && maxRedemptionPerTx !== '' && maxRedemptionPerTx !== null
                              ? parseFloat(maxRedemptionPerTx)
                              : null,
      welcomeBonus:         int(welcomeBonus),
      birthdayBonus:        int(birthdayBonus),
      expiryDays:           expiryDays !== undefined && expiryDays !== '' && expiryDays !== null
                              ? parseInt(expiryDays)
                              : null,
    };

    // Remove undefined values so Prisma doesn't try to set them
    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

    const program = await prisma.loyaltyProgram.upsert({
      where:  { storeId },
      create: { ...data, orgId, storeId },
      update: data,
    });
    res.json(program);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/loyalty/earn-rules ───────────────────────────────────────────
export const getEarnRules = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = req.query.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId required' });

    const rules = await prisma.loyaltyEarnRule.findMany({
      where:   { orgId, storeId },
      orderBy: [{ targetType: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/loyalty/earn-rules ──────────────────────────────────────────
export const createEarnRule = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { storeId, targetType, targetId, targetName, action, multiplier } = req.body;

    if (!storeId)     return res.status(400).json({ error: 'storeId required' });
    if (!targetType)  return res.status(400).json({ error: 'targetType required' });
    if (!targetId)    return res.status(400).json({ error: 'targetId required' });
    if (!['department','product'].includes(targetType))
      return res.status(400).json({ error: 'targetType must be "department" or "product"' });
    if (!['exclude','multiply'].includes(action))
      return res.status(400).json({ error: 'action must be "exclude" or "multiply"' });

    // Prevent duplicate rule for the same target
    const existing = await prisma.loyaltyEarnRule.findFirst({
      where: { orgId, storeId, targetType, targetId },
    });
    if (existing) return res.status(409).json({ error: 'A rule for this target already exists.' });

    const rule = await prisma.loyaltyEarnRule.create({
      data: {
        orgId,
        storeId,
        targetType,
        targetId,
        targetName: targetName || null,
        action,
        multiplier: dec(multiplier) ?? 1,
        active:     true,
      },
    });
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PUT /api/loyalty/earn-rules/:id ──────────────────────────────────────
export const updateEarnRule = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { action, multiplier, active, targetName } = req.body;

    const rule = await prisma.loyaltyEarnRule.findFirst({
      where: { id: req.params.id, orgId },
    });
    if (!rule) return res.status(404).json({ error: 'Rule not found' });

    const updated = await prisma.loyaltyEarnRule.update({
      where: { id: req.params.id },
      data:  {
        action:     action      !== undefined ? action           : undefined,
        multiplier: multiplier  !== undefined ? dec(multiplier)  : undefined,
        active:     active      !== undefined ? Boolean(active)  : undefined,
        targetName: targetName  !== undefined ? targetName       : undefined,
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── DELETE /api/loyalty/earn-rules/:id ───────────────────────────────────
export const deleteEarnRule = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const rule = await prisma.loyaltyEarnRule.findFirst({
      where: { id: req.params.id, orgId },
    });
    if (!rule) return res.status(404).json({ error: 'Rule not found' });

    await prisma.loyaltyEarnRule.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/loyalty/rewards ──────────────────────────────────────────────
export const getRewards = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = req.query.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId required' });

    const rewards = await prisma.loyaltyReward.findMany({
      where:   { orgId, storeId },
      orderBy: [{ sortOrder: 'asc' }, { pointsCost: 'asc' }],
    });
    res.json(rewards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/loyalty/rewards ─────────────────────────────────────────────
export const createReward = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { storeId, name, description, pointsCost, rewardType, rewardValue, sortOrder } = req.body;

    if (!storeId)    return res.status(400).json({ error: 'storeId required' });
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    if (!pointsCost) return res.status(400).json({ error: 'pointsCost required' });
    if (!rewardValue) return res.status(400).json({ error: 'rewardValue required' });

    const reward = await prisma.loyaltyReward.create({
      data: {
        orgId,
        storeId,
        name:        name.trim(),
        description: description?.trim() || null,
        pointsCost:  parseInt(pointsCost),
        rewardType:  rewardType || 'dollar_off',
        rewardValue: parseFloat(rewardValue),
        active:      true,
        sortOrder:   int(sortOrder) ?? 0,
      },
    });
    res.status(201).json(reward);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PUT /api/loyalty/rewards/:id ──────────────────────────────────────────
export const updateReward = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { name, description, pointsCost, rewardType, rewardValue, active, sortOrder } = req.body;

    const reward = await prisma.loyaltyReward.findFirst({
      where: { id: req.params.id, orgId },
    });
    if (!reward) return res.status(404).json({ error: 'Reward not found' });

    const updated = await prisma.loyaltyReward.update({
      where: { id: req.params.id },
      data:  {
        name:        name        !== undefined ? name.trim()          : undefined,
        description: description !== undefined ? description.trim()   : undefined,
        pointsCost:  pointsCost  !== undefined ? parseInt(pointsCost) : undefined,
        rewardType:  rewardType  !== undefined ? rewardType           : undefined,
        rewardValue: rewardValue !== undefined ? parseFloat(rewardValue) : undefined,
        active:      active      !== undefined ? Boolean(active)      : undefined,
        sortOrder:   sortOrder   !== undefined ? parseInt(sortOrder)  : undefined,
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── DELETE /api/loyalty/rewards/:id ──────────────────────────────────────
export const deleteReward = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const reward = await prisma.loyaltyReward.findFirst({
      where: { id: req.params.id, orgId },
    });
    if (!reward) return res.status(404).json({ error: 'Reward not found' });

    await prisma.loyaltyReward.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/loyalty/config (POS-facing — returns program + rules + rewards) ─
// Used by the cashier app to know how to award/redeem points.
export const getPOSLoyaltyConfig = async (req, res) => {
  try {
    const storeId = req.query.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId required' });

    const [program, earnRules, rewards] = await Promise.all([
      prisma.loyaltyProgram.findUnique({ where: { storeId } }),
      prisma.loyaltyEarnRule.findMany({ where: { storeId, active: true } }),
      prisma.loyaltyReward.findMany({
        where:   { storeId, active: true },
        orderBy: [{ sortOrder: 'asc' }, { pointsCost: 'asc' }],
      }),
    ]);

    if (!program || !program.enabled) {
      return res.json({ enabled: false, program: null, earnRules: [], rewards: [] });
    }

    res.json({ enabled: true, program, earnRules, rewards });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
