import prisma from '../config/postgres.js';

// @desc    List all products
// @route   GET /api/products
// @access  Private
export const getProducts = async (req, res, next) => {
  try {
    const where = {};
    if (req.orgId) where.orgId = req.orgId;

    const products = await prisma.masterProduct.findMany({
      where: { ...where, deleted: false },
      orderBy: { name: 'asc' },
    });
    res.json(products);
  } catch (error) {
    next(error);
  }
};

// @desc    Update product price in master catalog
// @route   PUT /api/products/bulk-update
// @access  Private
export const bulkUpdatePrices = async (req, res, next) => {
  try {
    const { updates } = req.body; // [{ id, price }]

    const results = [];
    for (const update of updates) {
      try {
        // Update in master catalog
        await prisma.masterProduct.update({
          where: { id: parseInt(update.id) },
          data:  { defaultRetailPrice: update.price },
        });

        results.push({ id: update.id, status: 'updated' });
      } catch (err) {
        results.push({ id: update.id, status: 'failed', error: err.message });
      }
    }

    res.json({ message: 'Bulk price update processed', results });
  } catch (error) {
    next(error);
  }
};
