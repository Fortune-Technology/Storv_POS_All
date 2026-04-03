import prisma from '../config/postgres.js';

// @desc    List all customers
// @route   GET /api/customers
// @access  Private
export const getCustomers = async (req, res, next) => {
  try {
    const { name, phone, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      ...(req.orgId ? { orgId: req.orgId } : {}),
      deleted: false,
    };
    if (name) where.name = { contains: name, mode: 'insensitive' };
    if (phone) where.phone = { contains: phone };

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.customer.count({ where }),
    ]);

    res.json({
      customers,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    View full customer profile
// @route   GET /api/customers/:id
// @access  Private
export const getCustomerById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    if (req.orgId) where.orgId = req.orgId;

    const customer = await prisma.customer.findFirst({ where });
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(customer);
  } catch (error) {
    next(error);
  }
};

// @desc    Check points by phone number
// @route   POST /api/customers/check-points
// @access  Private
export const checkPoints = async (req, res, next) => {
  try {
    const { phone } = req.body;
    const where = { phone };
    if (req.orgId) where.orgId = req.orgId;

    const customer = await prisma.customer.findFirst({ where });
    if (!customer) {
      return res.status(404).json({ error: 'Customer with this phone number not found' });
    }

    res.json({
      name:          customer.name,
      phone:         customer.phone,
      loyaltyPoints: customer.loyaltyPoints,
      pointsHistory: customer.pointsHistory,
    });
  } catch (error) {
    next(error);
  }
};
