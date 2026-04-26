import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { upcVariants } from '../utils/upc.js';

/**
 * posController.ts
 * IT Retail / MarktPOS integration has been removed.
 * All functions that previously proxied to the external POS API now return
 * 410 Gone so existing routes stay registered without crashing.
 */

const REMOVED = (res: Response): Response =>
  res.status(410).json({ error: 'IT Retail integration has been removed.' });

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

/** @route   POST /api/pos/connect */
export const connectPOS: Handler = async (_req, res) => { REMOVED(res); };

/** @route   GET /api/pos/status */
export const getStatus: Handler = async (_req, res) => { REMOVED(res); };

/** @route   GET /api/pos/products */
export const fetchProducts: Handler = async (_req, res) => { REMOVED(res); };

/** @route   POST /api/pos/products/sync */
export const syncAllProducts: Handler = async (_req, res) => { REMOVED(res); };

/** @route   GET /api/pos/debug/reference-data */
export const debugReferenceData: Handler = async (_req, res) => { REMOVED(res); };

/** @route   GET /api/pos/debug/products-raw */
export const debugProductsRaw: Handler = async (_req, res) => { REMOVED(res); };

/** @route   PUT /api/pos/products/:id/price */
export const updateProductPrice: Handler = async (_req, res) => { REMOVED(res); };

/** @route   POST /api/pos/products/bulk-price-update */
export const bulkPriceUpdate: Handler = async (_req, res) => { REMOVED(res); };

/** @route   GET /api/pos/customers */
export const fetchCustomers: Handler = async (_req, res) => { REMOVED(res); };

/** @route   POST /api/pos/customers/sync */
export const syncPOSCustomers: Handler = async (_req, res) => { REMOVED(res); };

/** @route   GET /api/pos/departments */
export const fetchDepartments: Handler = async (_req, res) => { REMOVED(res); };

/**
 * @desc    Get recent POS API logs
 * @route   GET /api/pos/logs
 * @access  Private
 */
export const getLogs: Handler = async (req, res, next) => {
  try {
    const where: Prisma.PosLogWhereInput = {};
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
export const getLocalProducts: Handler = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, search = '', category = '' } = req.query as {
      page?: string | number;
      limit?: string | number;
      search?: string;
      category?: string;
    };
    const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));

    const where: Prisma.MasterProductWhereInput = {
      deleted: false,
      ...(req.orgId ? { orgId: req.orgId } : {}),
    };

    if (search) {
      const digitsOnly = search.replace(/[\s\-\.]/g, '').replace(/\D/g, '');
      const isUpcLike  = digitsOnly.length >= 6 && digitsOnly.length <= 14;
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        ...(isUpcLike
          ? [{ upc: { in: upcVariants(digitsOnly) } }]
          : [{ upc: { contains: search } }]
        ),
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (category) {
      where.taxClass = { contains: category, mode: 'insensitive' };
    }

    const [products, total] = await Promise.all([
      prisma.masterProduct.findMany({ where, orderBy: { name: 'asc' }, skip, take: parseInt(String(limit)) }),
      prisma.masterProduct.count({ where }),
    ]);

    res.json({
      success: true,
      products,
      total,
      page: parseInt(String(page)),
      totalPages: Math.ceil(total / parseInt(String(limit))),
    });
  } catch (error) {
    next(error);
  }
};

/** @route   GET /api/pos/products/search */
export const globalProductSearch: Handler = async (_req, res) => { REMOVED(res); };

/** @route   GET /api/pos/vendors */
export const getAllVendors: Handler = async (_req, res) => { REMOVED(res); };

/** @route   GET /api/pos/taxes-fees */
export const getTaxesFees: Handler = async (_req, res) => { REMOVED(res); };

/** @route   PUT /api/pos/products/:id/details */
export const updatePOSProductDetails: Handler = async (_req, res) => { REMOVED(res); };

/** @route   POST /api/pos/products/create */
export const createPOSProduct: Handler = async (_req, res) => { REMOVED(res); };
