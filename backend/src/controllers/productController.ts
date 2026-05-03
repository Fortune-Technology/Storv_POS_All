import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

// @desc    List all products
// @route   GET /api/products
// @access  Private
export const getProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const where: Prisma.MasterProductWhereInput = { deleted: false };
    if (req.orgId) where.orgId = req.orgId;

    const products = await prisma.masterProduct.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    res.json(products);
  } catch (error) {
    next(error);
  }
};

interface BulkUpdateEntry {
  id: string | number;
  price: number;
}

// @desc    Update product price in master catalog
// @route   PUT /api/products/bulk-update
// @access  Private
export const bulkUpdatePrices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { updates } = req.body as { updates: BulkUpdateEntry[] };

    const results: { id: string | number; status: 'updated' | 'failed'; error?: string }[] = [];
    for (const update of updates) {
      try {
        // Update in master catalog
        await prisma.masterProduct.update({
          where: { id: parseInt(String(update.id)) },
          data:  { defaultRetailPrice: update.price },
        });

        results.push({ id: update.id, status: 'updated' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ id: update.id, status: 'failed', error: message });
      }
    }

    res.json({ message: 'Bulk price update processed', results });
  } catch (error) {
    next(error);
  }
};
