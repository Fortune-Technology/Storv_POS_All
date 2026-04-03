import prisma from '../config/postgres.js';

// @desc    List all fee mappings
// @route   GET /api/fees-mappings
// @access  Private
export const getFeeMappings = async (req, res, next) => {
  try {
    const where = {};
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
export const upsertFeeMapping = async (req, res, next) => {
  try {
    const { feeType, mappedValue, description } = req.body;

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
export const deleteFeeMapping = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    if (req.orgId) where.orgId = req.orgId;

    const existing = await prisma.feeMapping.findFirst({ where });
    if (!existing) {
      return res.status(404).json({ error: 'Fee mapping not found' });
    }

    await prisma.feeMapping.delete({ where: { id: existing.id } });
    res.json({ message: 'Fee mapping deleted' });
  } catch (error) {
    next(error);
  }
};
