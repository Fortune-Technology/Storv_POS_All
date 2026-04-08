/**
 * Sync status controller — reports on the data sync pipeline health.
 */

import prisma from '../config/postgres.js';

export const getSyncStatus = async (req, res) => {
  try {
    const [pending, failed, lastProcessed, totalProducts, totalDepartments] = await Promise.all([
      prisma.syncEvent.count({ where: { status: 'pending' } }),
      prisma.syncEvent.count({ where: { status: 'failed' } }),
      prisma.syncEvent.findFirst({
        where: { status: 'processed' },
        orderBy: { processedAt: 'desc' },
        select: { processedAt: true, entityType: true },
      }),
      prisma.ecomProduct.count({ where: { storeId: req.storeId } }),
      prisma.ecomDepartment.count({ where: { storeId: req.storeId } }),
    ]);

    res.json({
      success: true,
      data: {
        pendingEvents: pending,
        failedEvents: failed,
        lastSyncedAt: lastProcessed?.processedAt || null,
        totalProducts,
        totalDepartments,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
