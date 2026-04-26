/**
 * Vendor Performance Service
 * Calculates performance metrics from PO history.
 */

import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

const r2 = (n: number | string | null | undefined): number =>
  Math.round((Number(n) || 0) * 100) / 100;

export type VendorGrade = 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A';

export interface VendorPerformance {
  vendorId: number;
  vendorName?: string | null;
  vendorCode?: string | null;
  statedLeadTime?: number | null;
  totalPOs: number;
  onTimePercent: number | null;
  fillRatePercent: number | null;
  costAccuracyPercent: number | null;
  avgLeadTime: number | null;
  returnRatePercent: number | null;
  grade: VendorGrade;
  totalOrdered?: number;
  totalReceived?: number;
  totalReturned?: number;
  metrics?: unknown[];
}

/**
 * Get performance metrics for a specific vendor.
 */
export async function getVendorPerformance(
  orgId: string,
  vendorId: number | string,
  from?: string | null,
  to?: string | null,
): Promise<VendorPerformance> {
  const where: Prisma.PurchaseOrderWhereInput = {
    orgId,
    vendorId: parseInt(String(vendorId)),
    status: { in: ['received', 'partial'] },
  };
  if (from || to) {
    where.receivedDate = {};
    if (from) (where.receivedDate as { gte?: Date }).gte = new Date(from);
    if (to)   (where.receivedDate as { lte?: Date }).lte = new Date(to + 'T23:59:59');
  }

  const pos = await prisma.purchaseOrder.findMany({
    where,
    include: {
      items: true,
      vendor: { select: { leadTimeDays: true, name: true } },
    },
    orderBy: { orderDate: 'asc' },
  });

  if (pos.length === 0) {
    return {
      vendorId: parseInt(String(vendorId)),
      totalPOs: 0, onTimePercent: null, fillRatePercent: null,
      costAccuracyPercent: null, avgLeadTime: null, returnRatePercent: null,
      grade: 'N/A', metrics: [],
    };
  }

  // On-time delivery %
  let onTimeCount = 0;
  let totalWithExpected = 0;
  let totalLeadDays = 0;

  // Fill rate
  let totalOrdered = 0;
  let totalReceived = 0;

  // Cost accuracy
  let poWithNoVariance = 0;

  for (const po of pos) {
    // On-time check
    if (po.expectedDate && po.receivedDate) {
      totalWithExpected++;
      if (new Date(po.receivedDate) <= new Date(po.expectedDate)) onTimeCount++;
    }

    // Actual lead time
    if (po.receivedDate && po.orderDate) {
      totalLeadDays += Math.round((new Date(po.receivedDate).getTime() - new Date(po.orderDate).getTime()) / 86400000);
    }

    // Fill rate + cost accuracy
    let hasVariance = false;
    for (const item of po.items) {
      totalOrdered += item.qtyOrdered;
      totalReceived += item.qtyReceived;
      if (item.varianceFlag && item.varianceFlag !== 'none') hasVariance = true;
    }
    if (!hasVariance) poWithNoVariance++;
  }

  // Return rate
  const returnWhere: Prisma.VendorReturnWhereInput = {
    orgId,
    vendorId: parseInt(String(vendorId)),
    status: { in: ['submitted', 'credited', 'closed'] },
  };
  if (from || to) {
    returnWhere.createdAt = {};
    if (from) (returnWhere.createdAt as { gte?: Date }).gte = new Date(from);
    if (to)   (returnWhere.createdAt as { lte?: Date }).lte = new Date(to + 'T23:59:59');
  }
  let returns: Array<{ items: Array<{ qty: number }> }> = [];
  try {
    returns = await prisma.vendorReturn.findMany({
      where: returnWhere,
      include: { items: true },
    });
  } catch {
    returns = [];
  }
  const totalReturned = returns.reduce(
    (s, r) => s + r.items.reduce((s2, i) => s2 + i.qty, 0),
    0,
  );

  const onTimePercent = totalWithExpected > 0 ? r2(onTimeCount / totalWithExpected * 100) : null;
  const fillRatePercent = totalOrdered > 0 ? r2(totalReceived / totalOrdered * 100) : null;
  const costAccuracyPercent = pos.length > 0 ? r2(poWithNoVariance / pos.length * 100) : null;
  const avgLeadTime = pos.length > 0 ? r2(totalLeadDays / pos.length) : null;
  const returnRatePercent = totalReceived > 0 ? r2(totalReturned / totalReceived * 100) : null;

  // Overall grade
  const scores = [onTimePercent, fillRatePercent, costAccuracyPercent].filter(
    (v): v is number => v != null,
  );
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const grade: VendorGrade =
    avgScore >= 95 ? 'A' :
    avgScore >= 85 ? 'B' :
    avgScore >= 75 ? 'C' :
    avgScore >= 60 ? 'D' : 'F';

  return {
    vendorId: parseInt(String(vendorId)),
    vendorName: pos[0]?.vendor?.name,
    statedLeadTime: pos[0]?.vendor?.leadTimeDays,
    totalPOs: pos.length,
    onTimePercent,
    fillRatePercent,
    costAccuracyPercent,
    avgLeadTime,
    returnRatePercent,
    grade,
    totalOrdered,
    totalReceived,
    totalReturned,
  };
}

/**
 * Get performance summary across all vendors.
 */
export async function getAllVendorPerformance(
  orgId: string,
  from?: string | null,
  to?: string | null,
): Promise<VendorPerformance[]> {
  const vendors = await prisma.vendor.findMany({
    where: { orgId, active: true },
    select: { id: true, name: true, code: true },
  });

  const results: VendorPerformance[] = [];
  for (const v of vendors) {
    const perf = await getVendorPerformance(orgId, v.id, from, to);
    if (perf.totalPOs > 0) {
      results.push({ ...perf, vendorCode: v.code });
    }
  }

  return results.sort((a, b) => {
    const gradeOrder: Record<VendorGrade, number> = { A: 0, B: 1, C: 2, D: 3, F: 4, 'N/A': 5 };
    return (gradeOrder[a.grade] ?? 5) - (gradeOrder[b.grade] ?? 5);
  });
}
