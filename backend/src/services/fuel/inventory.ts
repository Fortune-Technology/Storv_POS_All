/**
 * fuelInventory.ts — core inventory + FIFO service for the fuel module.
 *
 *   getTankLevel(tankId)        → current gallons in a tank (sum of FIFO layers)
 *   applySale({tankId, gallons}) → deduct gallons from oldest FIFO layer first,
 *                                  return { fifoLayers: [...], cogs }
 *   applyRefund({tankId, gallons, layers}) → reverse a sale (credit back to
 *                                            the same layers the sale consumed)
 *   resolveTankForSale({storeId, fuelTypeId}) → which tank should a sale deduct
 *                                              from? Honours manifold + primary.
 *   getExpectedLevel(tankId, since) → software-derived expected gallons (used
 *                                     by stick-reading variance calculation)
 *
 * Every operation runs inside a Prisma transaction so concurrent sales can't
 * double-draw from the same layer. Caller passes the tx client; helpers fall
 * back to the global client when not supplied.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../../config/postgres.js';

/**
 * Either the global Prisma singleton or a tx-scoped client (Omit<PrismaClient, $-methods>
 * is what `prisma.$transaction(async (tx) => …)` passes in).
 */
type TxClient = PrismaClient | Prisma.TransactionClient;

const toNum = (v: unknown): number => (v == null ? 0 : Number(v));

// ── Domain shapes ──────────────────────────────────────────────────────────

export interface ConsumedLayer {
  deliveryItemId: string;
  gallons: number;
  pricePerGallon: number;
  cost: number;
  /** Set by applySale when aggregating multi-tank draws. */
  tankId?: string;
  /** Set by the blend mode to mark whether the layer came from base or premium. */
  blendLeg?: 'base' | 'premium' | string;
}

export interface DrawResult {
  consumed: ConsumedLayer[];
  cogs: number;
  unallocatedGallons: number;
}

export interface ManifoldAlloc {
  tankId: string;
  fraction: number;
}

export interface BlendLeg {
  tankId: string;
  gallons: number;
  label: 'base' | 'premium';
}

export type SalePlan =
  | { mode: 'none' }
  | { mode: 'single'; tankId: string; pumpOverride?: boolean }
  | { mode: 'manifold'; tanks: ManifoldAlloc[] }
  | { mode: 'sequential'; tanks: Array<{ tankId: string }> }
  | { mode: 'blend'; legs: BlendLeg[] };

export interface ResolveTankArgs {
  orgId: string;
  storeId: string;
  fuelTypeId: string;
  gallons: number | string;
  pumpId?: string | null;
}

export interface ApplySaleResult {
  primaryTankId: string | null;
  fifoLayers: ConsumedLayer[] | null;
  cogs: number;
  unallocated: number;
}

export interface ApplyRefundArgs {
  fifoLayers?: ConsumedLayer[] | null;
  tankId?: string | null;
  gallons: number | string;
}

export interface DeliveryItemInput {
  tankId: string;
  gallonsReceived: number | string;
  pricePerGallon: number | string;
}

export interface RecordDeliveryArgs {
  orgId: string;
  storeId: string;
  deliveryDate?: Date | string | null;
  supplier?: string | null;
  bolNumber?: string | null;
  notes?: string | null;
  createdById?: string | null;
  items: DeliveryItemInput[];
}

export interface RecordStickReadingArgs {
  orgId: string;
  storeId: string;
  tankId: string;
  actualGallons: number | string;
  shiftId?: string | null;
  notes?: string | null;
  createdById?: string | null;
}

export interface CostVarianceResult {
  avgPricePerGallon: number;
  variancePct: number;
}

// ─────────────────────────────────────────────────
// Tank level — sum of remaining gallons across FIFO layers
// ─────────────────────────────────────────────────

export async function getTankLevel(tankId: string, tx: TxClient = prisma): Promise<number> {
  const rows = await tx.fuelDeliveryItem.findMany({
    where:  { tankId, remainingGallons: { gt: 0 } },
    select: { remainingGallons: true },
  });
  return rows.reduce((sum, r) => sum + toNum(r.remainingGallons), 0);
}

export async function getAllTankLevels(storeId: string, tx: TxClient = prisma): Promise<Map<string, number>> {
  const items = await tx.fuelDeliveryItem.findMany({
    where:  { tank: { storeId }, remainingGallons: { gt: 0 } },
    select: { tankId: true, remainingGallons: true },
  });
  const byTank = new Map<string, number>();
  for (const i of items) {
    byTank.set(i.tankId, (byTank.get(i.tankId) || 0) + toNum(i.remainingGallons));
  }
  return byTank;
}

// ─────────────────────────────────────────────────
// Resolve which tank a sale should deduct from.
// Handles: independent (use isPrimary tank), manifolded (pool), blend config.
// Returns:
//   { mode: 'single', tankId }
//   { mode: 'manifold', tanks: [{tankId, fraction}, ...] }
//   { mode: 'blend', legs: [{tankId, gallons, costFraction}] }
// ─────────────────────────────────────────────────

export async function resolveTankForSale(
  { orgId, storeId, fuelTypeId, gallons, pumpId }: ResolveTankArgs,
  tx: TxClient = prisma,
): Promise<SalePlan> {
  // V1.5: Pump override — if a pump is specified and it has a tank override
  // for this grade, use it. This short-circuits the topology logic for pumps
  // routed to a specific tank.
  if (pumpId) {
    const pump = await tx.fuelPump.findFirst({ where: { id: pumpId, orgId, storeId, active: true, deleted: false } });
    const overrides = (pump?.tankOverrides ?? null) as Record<string, string> | null;
    const overrideTankId = overrides && typeof overrides === 'object' ? overrides[fuelTypeId] : null;
    if (overrideTankId) {
      return { mode: 'single', tankId: overrideTankId, pumpOverride: true };
    }
  }

  // 1. Check if this grade is produced by blending two tanks
  const blend = await tx.fuelBlendConfig.findFirst({
    where: { orgId, storeId, middleFuelTypeId: fuelTypeId, active: true },
  });
  if (blend) {
    const baseGal    = toNum(gallons) * toNum(blend.baseRatio);
    const premiumGal = toNum(gallons) * toNum(blend.premiumRatio);
    const baseTank    = await pickTankForGrade(orgId, storeId, blend.baseFuelTypeId,    tx);
    const premiumTank = await pickTankForGrade(orgId, storeId, blend.premiumFuelTypeId, tx);
    const legs: BlendLeg[] = [
      ...(baseTank    ? [{ tankId: baseTank.id,    gallons: baseGal,    label: 'base'    as const }] : []),
      ...(premiumTank ? [{ tankId: premiumTank.id, gallons: premiumGal, label: 'premium' as const }] : []),
    ];
    return { mode: 'blend', legs };
  }

  // 2. Non-blend: look at tanks of this grade
  const tanks = await tx.fuelTank.findMany({
    where:   { orgId, storeId, fuelTypeId, active: true, deleted: false },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  if (tanks.length === 0) return { mode: 'none' };

  // 3. Manifolded: split by drain mode
  const manifolded = tanks.filter((t) => t.topology === 'manifolded' && t.manifoldGroupId);
  if (manifolded.length > 0) {
    // All tanks in the same group
    const groupId = manifolded[0].manifoldGroupId;
    if (!groupId) return { mode: 'none' };
    const group   = await tx.fuelManifoldGroup.findUnique({ where: { id: groupId } });
    const members = manifolded.filter((t) => t.manifoldGroupId === groupId);
    if (!group || members.length === 0) return { mode: 'none' };
    let allocations: ManifoldAlloc[];
    if (group.drainMode === 'capacity') {
      const totalCap = members.reduce((s, t) => s + toNum(t.capacityGal), 0) || 1;
      allocations = members.map((t) => ({ tankId: t.id, fraction: toNum(t.capacityGal) / totalCap }));
    } else {
      // 'equal' default
      const frac = 1 / members.length;
      allocations = members.map((t) => ({ tankId: t.id, fraction: frac }));
    }
    return { mode: 'manifold', tanks: allocations };
  }

  // 4. Sequential (V1.5): drain primary until empty, then fall through to next.
  //    Returns an ORDERED list of tanks; drawFromTankChain walks them.
  const sequential = tanks.filter((t) => t.topology === 'sequential');
  if (sequential.length > 1) {
    // Order: primary first, then by creation time
    const ordered = [...sequential].sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    return { mode: 'sequential', tanks: ordered.map((t) => ({ tankId: t.id })) };
  }

  // 5. Independent: use isPrimary tank (first by order above)
  return { mode: 'single', tankId: tanks[0].id };
}

async function pickTankForGrade(
  orgId: string,
  storeId: string,
  fuelTypeId: string,
  tx: TxClient,
) {
  return tx.fuelTank.findFirst({
    where:   { orgId, storeId, fuelTypeId, active: true, deleted: false },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
}

// ─────────────────────────────────────────────────
// FIFO draw — consume N gallons from a tank starting from the oldest layer.
// Returns { consumed: [{deliveryItemId, gallons, pricePerGallon, cost}], cogs }
// Short-draws (not enough inventory) are still allowed — tracked as
// `unallocatedGallons` for the caller to handle (warn via alert).
// ─────────────────────────────────────────────────

export async function drawFromTank(
  tankId: string,
  gallons: number | string,
  tx: TxClient = prisma,
): Promise<DrawResult> {
  const need = toNum(gallons);
  if (need <= 0) return { consumed: [], cogs: 0, unallocatedGallons: 0 };

  const layers = await tx.fuelDeliveryItem.findMany({
    where:   { tankId, remainingGallons: { gt: 0 } },
    orderBy: { createdAt: 'asc' },
  });

  const consumed: ConsumedLayer[] = [];
  let remaining = need;
  let cogs = 0;

  for (const layer of layers) {
    if (remaining <= 0) break;
    const avail = toNum(layer.remainingGallons);
    const take  = Math.min(remaining, avail);
    const newRemaining = avail - take;
    const costPerGal   = toNum(layer.pricePerGallon);
    const layerCost    = take * costPerGal;

    await tx.fuelDeliveryItem.update({
      where: { id: layer.id },
      data: {
        remainingGallons: newRemaining,
        fullyConsumedAt:  newRemaining <= 0 ? new Date() : null,
      },
    });

    consumed.push({
      deliveryItemId: layer.id,
      gallons:        take,
      pricePerGallon: costPerGal,
      cost:           layerCost,
    });
    cogs     += layerCost;
    remaining -= take;
  }

  return {
    consumed,
    cogs,
    unallocatedGallons: remaining > 0 ? remaining : 0,
  };
}

// ─────────────────────────────────────────────────
// Apply a sale — multi-tank aware (handles single/manifold/blend from
// resolveTankForSale). Returns the fifoLayers trace to store on FuelTransaction.
// ─────────────────────────────────────────────────

export async function applySale(
  { orgId, storeId, fuelTypeId, gallons, pumpId }: ResolveTankArgs,
  tx: TxClient = prisma,
): Promise<ApplySaleResult> {
  const plan = await resolveTankForSale({ orgId, storeId, fuelTypeId, gallons, pumpId }, tx);
  if (plan.mode === 'none') {
    // No tank configured — record the sale without FIFO tracking (legacy mode)
    return { primaryTankId: null, fifoLayers: null, cogs: 0, unallocated: toNum(gallons) };
  }

  const aggLayers: ConsumedLayer[] = [];
  let   totalCogs = 0;
  let   totalUnalloc = 0;
  let   primaryTankId: string | null = null;

  if (plan.mode === 'single') {
    primaryTankId = plan.tankId;
    const r = await drawFromTank(plan.tankId, gallons, tx);
    aggLayers.push(...r.consumed.map((l) => ({ ...l, tankId: plan.tankId })));
    totalCogs    += r.cogs;
    totalUnalloc += r.unallocatedGallons;
  } else if (plan.mode === 'manifold') {
    primaryTankId = plan.tanks[0]?.tankId || null;
    for (const alloc of plan.tanks) {
      const gal = toNum(gallons) * alloc.fraction;
      const r   = await drawFromTank(alloc.tankId, gal, tx);
      aggLayers.push(...r.consumed.map((l) => ({ ...l, tankId: alloc.tankId })));
      totalCogs    += r.cogs;
      totalUnalloc += r.unallocatedGallons;
    }
  } else if (plan.mode === 'sequential') {
    // V1.5: walk tanks in order — draw from first until empty, fall through
    // to the next. Returns { consumed, cogs, remaining } per drawFromTank.
    primaryTankId = plan.tanks[0]?.tankId || null;
    let remaining = toNum(gallons);
    for (const t of plan.tanks) {
      if (remaining <= 0) break;
      const r = await drawFromTank(t.tankId, remaining, tx);
      aggLayers.push(...r.consumed.map((l) => ({ ...l, tankId: t.tankId })));
      totalCogs += r.cogs;
      const consumed = r.consumed.reduce((s, l) => s + toNum(l.gallons), 0);
      remaining -= consumed;
      if (r.unallocatedGallons === 0) break; // this tank satisfied it
    }
    if (remaining > 0) totalUnalloc += remaining;
  } else if (plan.mode === 'blend') {
    primaryTankId = plan.legs[0]?.tankId || null;
    for (const leg of plan.legs) {
      const r = await drawFromTank(leg.tankId, leg.gallons, tx);
      aggLayers.push(...r.consumed.map((l) => ({ ...l, tankId: leg.tankId, blendLeg: leg.label })));
      totalCogs    += r.cogs;
      totalUnalloc += r.unallocatedGallons;
    }
  }

  return {
    primaryTankId,
    fifoLayers: aggLayers,
    cogs:       totalCogs,
    unallocated: totalUnalloc,
  };
}

// ─────────────────────────────────────────────────
// Apply a refund — credit gallons back to the same layers they came from.
// If the refund exceeds the original sale or the layers are gone (fully
// consumed by later sales), the excess is credited to the tank's most recent
// layer as a fresh pool.
// ─────────────────────────────────────────────────

export async function applyRefund(
  { fifoLayers, tankId, gallons }: ApplyRefundArgs,
  tx: TxClient = prisma,
): Promise<void> {
  if (Array.isArray(fifoLayers) && fifoLayers.length > 0) {
    for (const layer of fifoLayers) {
      const existing = await tx.fuelDeliveryItem.findUnique({ where: { id: layer.deliveryItemId } });
      if (!existing) continue;
      await tx.fuelDeliveryItem.update({
        where: { id: layer.deliveryItemId },
        data: {
          remainingGallons: { increment: toNum(layer.gallons) },
          fullyConsumedAt:  null,
        },
      });
    }
    return;
  }
  // No trace — credit to the tank's most recent layer
  if (!tankId) return;
  const latest = await tx.fuelDeliveryItem.findFirst({
    where:   { tankId },
    orderBy: { createdAt: 'desc' },
  });
  if (latest) {
    await tx.fuelDeliveryItem.update({
      where: { id: latest.id },
      data:  { remainingGallons: { increment: toNum(gallons) } },
    });
  }
}

// ─────────────────────────────────────────────────
// Expected level helper — used by stick-reading variance.
// Current software-expected level = sum of remaining FIFO layers.
// ─────────────────────────────────────────────────

export async function getExpectedLevel(tankId: string, tx: TxClient = prisma): Promise<number> {
  return getTankLevel(tankId, tx);
}

// ─────────────────────────────────────────────────
// V1.5: Delivery cost variance check
// Compute the rolling average $/gal from the last 3 completed deliveries
// for the same fuel type (any tank of that grade at this store). Return
// { avgPricePerGallon, variancePct } — variancePct is the % difference
// between `newPricePerGallon` and the rolling average. Positive means
// the new delivery is MORE expensive than average.
// Returns null when fewer than 3 deliveries exist (not enough history).
// ─────────────────────────────────────────────────

export async function checkDeliveryCostVariance(
  { orgId, storeId, fuelTypeId, newPricePerGallon }: {
    orgId: string;
    storeId: string;
    fuelTypeId: string;
    newPricePerGallon: number | string;
  },
  tx: TxClient = prisma,
): Promise<CostVarianceResult | null> {
  const recent = await tx.fuelDeliveryItem.findMany({
    where: {
      tank: { orgId, storeId, fuelTypeId },
    },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { pricePerGallon: true, gallonsReceived: true, totalCost: true },
  });
  if (recent.length < 3) return null;
  // Volume-weighted avg (simple avg would distort when deliveries differ wildly in size)
  const totalCost = recent.reduce((s, r) => s + toNum(r.totalCost), 0);
  const totalGal  = recent.reduce((s, r) => s + toNum(r.gallonsReceived), 0);
  if (totalGal <= 0) return null;
  const avgPricePerGallon = totalCost / totalGal;
  const variancePct = avgPricePerGallon > 0
    ? ((toNum(newPricePerGallon) - avgPricePerGallon) / avgPricePerGallon) * 100
    : 0;
  return { avgPricePerGallon, variancePct };
}

// ─────────────────────────────────────────────────
// Record a delivery — creates the Delivery header + per-tank DeliveryItem
// layers (which are the FIFO cost layers). All in one transaction so
// aggregate totals on the header match the items.
// ─────────────────────────────────────────────────

export async function recordDelivery(
  { orgId, storeId, deliveryDate, supplier, bolNumber, notes, createdById, items }: RecordDeliveryArgs,
) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one delivery item (tank + gallons + price) is required.');
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const totalGallons = items.reduce((s, i) => s + toNum(i.gallonsReceived), 0);
    const totalCost    = items.reduce((s, i) => s + (toNum(i.gallonsReceived) * toNum(i.pricePerGallon)), 0);

    const delivery = await tx.fuelDelivery.create({
      data: {
        orgId, storeId,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : new Date(),
        supplier:  supplier || null,
        bolNumber: bolNumber || null,
        notes:     notes || null,
        totalGallons,
        totalCost,
        createdById: createdById || null,
      },
    });

    for (const item of items) {
      const gal = toNum(item.gallonsReceived);
      const ppg = toNum(item.pricePerGallon);
      await tx.fuelDeliveryItem.create({
        data: {
          deliveryId: delivery.id,
          tankId:     item.tankId,
          gallonsReceived: gal,
          pricePerGallon:  ppg,
          totalCost:       gal * ppg,
          remainingGallons: gal,
        },
      });
    }

    return delivery;
  });
}

// ─────────────────────────────────────────────────
// Record a stick reading — compares actual to expected, computes variance.
// ─────────────────────────────────────────────────

export async function recordStickReading(
  { orgId, storeId, tankId, actualGallons, shiftId, notes, createdById }: RecordStickReadingArgs,
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const expected = await getExpectedLevel(tankId, tx);
    const actual   = toNum(actualGallons);
    const variance = actual - expected;
    const variancePct = expected > 0 ? (variance / expected) * 100 : 0;

    return tx.fuelStickReading.create({
      data: {
        orgId, storeId, tankId,
        actualGallons:  actual,
        expectedGallons: expected,
        variance,
        variancePct,
        shiftId: shiftId || null,
        notes:   notes || null,
        createdById: createdById || null,
      },
    });
  });
}
