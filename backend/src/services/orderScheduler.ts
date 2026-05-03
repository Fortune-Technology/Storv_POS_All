/**
 * Order Scheduler — Auto-generates draft POs for vendors with autoOrderEnabled.
 *
 * Runs daily at 6 AM. For each store + vendor with auto-order:
 *   1. Check if the vendor's order cutoff is today or tomorrow
 *   2. Run generateOrderSuggestions filtered to that vendor
 *   3. If suggestions exist → create draft PO
 *   4. Send notification to store managers via ChatMessage
 */

import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { generateOrderSuggestions, nextPONumber, type VendorGroup, type OrderSuggestion } from './orderEngine.js';

const r2 = (n: number | string | null | undefined): number =>
  Math.round((Number(n) || 0) * 100) / 100;

/**
 * Run auto-order for all stores.
 * Call this from a cron job or scheduler.
 */
export async function runAutoOrders(): Promise<{ created: number }> {
  console.log('[OrderScheduler] Running auto-order check...');

  const stores = await prisma.store.findMany({
    where: { active: true },
    select: { id: true, orgId: true, name: true },
  });

  let totalPOsCreated = 0;

  for (const store of stores) {
    try {
      // Get vendors with auto-order enabled
      const vendors = await prisma.vendor.findMany({
        where: { orgId: store.orgId, active: true, autoOrderEnabled: true },
        select: { id: true, name: true, deliveryDays: true, orderCutoffDaysBefore: true, orderCutoffTime: true },
      });

      if (vendors.length === 0) continue;

      // Generate suggestions for this store
      const { vendorGroups } = await generateOrderSuggestions(store.orgId, store.id);

      type VendorRow = (typeof vendors)[number];
      for (const group of vendorGroups as VendorGroup[]) {
        const vendor = vendors.find((v: VendorRow) => v.id === group.vendorId);
        if (!vendor) continue; // vendor not auto-order enabled

        // Check if order cutoff is today or tomorrow
        if (group.daysUntilCutoff != null && group.daysUntilCutoff > 1) continue; // not urgent yet
        if (group.pastCutoff) continue; // already past cutoff, skip

        // Only create PO if there are items to order
        if (!group.items || group.items.length === 0) continue;

        // Check if there's already a draft/pending PO for this vendor this week
        const existingPO = await prisma.purchaseOrder.findFirst({
          where: {
            orgId: store.orgId,
            storeId: store.id,
            vendorId: group.vendorId,
            status: { in: ['draft', 'pending_approval', 'approved', 'submitted'] },
            orderDate: { gte: new Date(Date.now() - 7 * 86400000) }, // within last 7 days
          },
        });
        if (existingPO) continue; // already have a recent PO

        // Create draft PO
        const poNumber = await nextPONumber();
        const items: Prisma.PurchaseOrderItemUncheckedCreateWithoutOrderInput[] =
          group.items.map((item: OrderSuggestion) => ({
            masterProductId: item.productId,
            qtyOrdered: item.orderUnits || 1,
            qtyCases: item.orderCases || 0,
            unitCost: item.unitCost || 0,
            caseCost: item.caseCost || 0,
            lineTotal: item.lineTotal || 0,
            forecastDemand: item.forecastDemand,
            safetyStock: item.safetyStock,
            currentOnHand: item.onHand,
            avgDailySales: item.avgDailySales,
            reorderReason: item.reorderReason || item.urgency,
          }));

        await prisma.purchaseOrder.create({
          data: {
            orgId: store.orgId,
            storeId: store.id,
            vendorId: group.vendorId,
            poNumber,
            status: 'draft',
            subtotal: r2(group.subtotal),
            grandTotal: r2(group.subtotal),
            generatedBy: 'auto',
            createdById: 'system',
            expectedDate: group.nextDeliveryDate ? new Date(group.nextDeliveryDate) : null,
            items: { create: items },
          },
        });

        totalPOsCreated++;

        // Send notification via chat (store channel)
        const channelId = `store:${store.id}`;
        await prisma.chatMessage.create({
          data: {
            orgId: store.orgId,
            storeId: store.id,
            channelId,
            senderId: 'system',
            senderName: 'Auto-Order',
            senderRole: 'system',
            message: `📦 Auto-generated PO ${poNumber} for ${vendor.name} — ${items.length} items, $${r2(group.subtotal)}. Review and submit in Vendor Orders.`,
            messageType: 'system',
            readBy: [],
          },
        }).catch(() => {});

        console.log(`[OrderScheduler] Created PO ${poNumber} for ${vendor.name} at ${store.name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[OrderScheduler] Error for store ${store.name}:`, message);
    }
  }

  console.log(`[OrderScheduler] Done. Created ${totalPOsCreated} POs.`);
  return { created: totalPOsCreated };
}

/**
 * Start the daily scheduler (call once on server startup).
 */
export function startOrderScheduler(): void {
  // Run at 6:00 AM daily
  const checkAndRun = () => {
    const now = new Date();
    if (now.getHours() === 6 && now.getMinutes() === 0) {
      runAutoOrders().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[OrderScheduler] Failed:', message);
      });
    }
  };

  // Check every minute
  setInterval(checkAndRun, 60000);
  console.log('✓ Order scheduler started — auto-orders run daily at 6:00 AM');
}
