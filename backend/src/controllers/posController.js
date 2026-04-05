import prisma from '../config/postgres.js';

/**
 * posController.js
 * IT Retail / MarktPOS integration has been removed.
 * All functions that previously proxied to the external POS API now return
 * 410 Gone so existing routes stay registered without crashing.
 */

const REMOVED = (res) =>
  res.status(410).json({ error: 'IT Retail integration has been removed.' });

/**
 * @desc    Connect / authenticate with POS
 * @route   POST /api/pos/connect
 * @access  Private
 */
export const connectPOS = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Check POS connection status
 * @route   GET /api/pos/status
 * @access  Private
 */
export const getStatus = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Fetch products from POS
 * @route   GET /api/pos/products
 * @access  Private
 */
export const fetchProducts = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Sync all POS products to local PostgreSQL
 * @route   POST /api/pos/products/sync
 * @access  Private
 */
export const syncAllProducts = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Debug endpoint — inspect raw reference data response
 * @route   GET /api/pos/debug/reference-data
 * @access  Private
 */
export const debugReferenceData = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Debug endpoint — inspect raw products response
 * @route   GET /api/pos/debug/products-raw
 * @access  Private
 */
export const debugProductsRaw = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Update price of a single product in POS
 * @route   PUT /api/pos/products/:id/price
 * @access  Private
 */
export const updateProductPrice = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Bulk update prices for multiple products in POS
 * @route   POST /api/pos/products/bulk-price-update
 * @access  Private
 */
export const bulkPriceUpdate = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Fetch customers from POS
 * @route   GET /api/pos/customers
 * @access  Private
 */
export const fetchCustomers = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Sync all POS customers to local PostgreSQL
 * @route   POST /api/pos/customers/sync
 * @access  Private
 */
export const syncPOSCustomers = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Fetch departments from POS
 * @route   GET /api/pos/departments
 * @access  Private
 */
export const fetchDepartments = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Get recent POS API logs
 * @route   GET /api/pos/logs
 * @access  Private
 */
export const getLogs = async (req, res, next) => {
  try {
    const where = {};
    if (req.orgId) where.orgId = req.orgId;

    const logs = await prisma.posLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    res.json({ success: true, logs });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get synced products from local DB
 * @route   GET /api/pos/products/local
 * @access  Private
 */
export const getLocalProducts = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, search = '', category = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      deleted: false,
      ...(req.orgId ? { orgId: req.orgId } : {}),
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { upc:  { contains: search } },
        { sku:  { contains: search } },
      ];
    }

    if (category) {
      where.taxClass = { contains: category, mode: 'insensitive' };
    }

    const [products, total] = await Promise.all([
      prisma.masterProduct.findMany({ where, orderBy: { name: 'asc' }, skip, take: parseInt(limit) }),
      prisma.masterProduct.count({ where }),
    ]);

    res.json({ success: true, products, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Global product search (local DB fallback only)
 * @route   GET /api/pos/products/search
 */
export const globalProductSearch = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Get all vendors
 * @route   GET /api/pos/vendors
 * @access  Private
 */
export const getAllVendors = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Fetch all Taxes and Fees
 * @route   GET /api/pos/taxes-fees
 * @access  Private
 */
export const getTaxesFees = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Update an existing POS product's details
 * @route   PUT /api/pos/products/:id/details
 * @access  Private
 */
export const updatePOSProductDetails = async (req, res, next) => {
  return REMOVED(res);
};

/**
 * @desc    Create a new product in POS
 * @route   POST /api/pos/products/create
 * @access  Private
 */
export const createPOSProduct = async (req, res, next) => {
  return REMOVED(res);
};
