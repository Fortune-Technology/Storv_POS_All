import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

// @desc    List all fee mappings
// @route   GET /api/fees-mappings
// @access  Private
export const getFeeMappings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const where: Prisma.FeeMappingWhereInput = {};
    if (req.orgId) where.orgId = req.orgId;
    if (req.storeId) where.storeId = req.storeId;

    const mappings = await prisma.feeMapping.findMany({
      where,
      orderBy: { feeType: 'asc' },
    });
    res.json(mappings);
  } catch (error) {
    next(error);
  }
};

// @desc    Add / Update fee mapping
// @route   POST /api/fees-mappings
// @access  Private
export const upsertFeeMapping = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { feeType, mappedValue, description } = req.body as {
      feeType: string;
      mappedValue: string;
      description?: string | null;
    };

    const orgId   = req.orgId   ?? 'default';
    const storeId = req.storeId ?? null;

    // upsert on the unique constraint (orgId, storeId, feeType, mappedValue)
    const mapping = await prisma.feeMapping.upsert({
      where: {
        orgId_storeId_feeType_mappedValue: { orgId, storeId, feeType, mappedValue },
      },
      update: { description },
      create: { orgId, storeId, feeType, mappedValue, description },
    });

    res.json({ message: 'Fee mapping saved', mapping });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete fee mapping
// @route   DELETE /api/fees-mappings/:id
// @access  Private
export const deleteFeeMapping = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const where: Prisma.FeeMappingWhereInput = { id: req.params.id };
    if (req.orgId) where.orgId = req.orgId;

    const existing = await prisma.feeMapping.findFirst({ where });
    if (!existing) {
      res.status(404).json({ error: 'Fee mapping not found' });
      return;
    }

    await prisma.feeMapping.delete({ where: { id: existing.id } });
    res.json({ message: 'Fee mapping deleted' });
  } catch (error) {
    next(error);
  }
};
