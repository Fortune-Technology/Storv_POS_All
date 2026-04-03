import {
  getMarktPOSToken,
  marktPOSRequest,
  clearUserToken,
  getTokenExpiry,
  normalizeProduct,
  resetNormalizeLogging,
  fetchMarktPOSProducts,
  extractProductArray,
  getDebugProductsRaw,
} from '../services/marktPOSService.js';
import prisma from '../config/postgres.js';

/**
 * @desc    Connect / authenticate with IT Retail (MarktPOS)
 * @route   POST /api/pos/connect
 * @access  Private
 */
export const connectPOS = async (req, res, next) => {
  try {
    let { username, password } = req.body;

    if ((!username || !password) && req.storeId) {
      const store = await prisma.store.findUnique({
        where: { id: req.storeId },
        select: { pos: true },
      });
      const pos = store?.pos;
      if (pos?.type === 'itretail' && pos.username && pos.password) {
        username = pos.username;
        password = pos.password;
      }
    }

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'No IT Retail credentials found. Add them in Store Settings → POS System tab.',
        hint: 'stores_settings',
      });
    }

    const token = await getMarktPOSToken(req.posUser ?? req.user, { username, password });
    const expiresAt = await getTokenExpiry(req.user.id);

    res.json({
      success: true,
      message: 'Connected to IT Retail / MarktPOS',
      username,
      expiresAt,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Check POS connection status
 * @route   GET /api/pos/status
 * @access  Private
 */
export const getStatus = async (req, res, next) => {
  try {
    const posUser = req.posUser ?? req.user;
    const displayUsername = posUser?.marktPOSUsername || process.env.MARKTPOS_USERNAME;

    const stored = await prisma.posToken.findFirst({
      where: { userId: req.user.id },
    });

    if (!stored) {
      return res.json({ connected: false, expiresAt: null, username: displayUsername });
    }

    const isValid = stored.expiresAt > new Date();

    const productCount = await prisma.masterProduct.count({
      where: {
        itRetailUpc: { not: null },
        ...(req.orgId ? { orgId: req.orgId } : {}),
      },
    });

    res.json({
      connected:   isValid,
      expiresAt:   stored.expiresAt,
      lastUpdated: stored.updatedAt,
      username:    displayUsername,
      productCount,
    });
  } catch (error) {
    res.json({ connected: false, expiresAt: null, error: error.message });
  }
};

/**
 * @desc    Fetch products from MarktPOS (with endpoint discovery)
 * @route   GET /api/pos/products
 * @access  Private
 */
export const fetchProducts = async (req, res, next) => {
  try {
    console.log('🔄 Fetching products from MarktPOS...');

    const { endpoint, data: rawData } = await fetchMarktPOSProducts(req.posUser ?? req.user);
    const productList = extractProductArray(rawData);

    if (!productList || productList.length === 0) {
      return res.json({
        success: true,
        count: 0,
        savedToDb: 0,
        products: [],
        message: 'MarktPOS returned 0 products',
        endpoint,
      });
    }

    resetNormalizeLogging();
    const normalized = productList.map(normalizeProduct);

    const orgId = req.orgId ?? 'default';
    let savedCount = 0;
    const failedItems = [];

    for (const product of normalized) {
      if (!product.posProductId || product.posProductId === '' || product.posProductId === 'undefined') {
        failedItems.push({ product, reason: 'No valid posProductId' });
        continue;
      }
      try {
        await prisma.masterProduct.upsert({
          where: { orgId_upc: { orgId, upc: product.posProductId } },
          update: {
            name:          product.name  ?? 'Unknown',
            itRetailUpc:   product.posProductId,
            posLastSyncAt: new Date(),
          },
          create: {
            orgId,
            upc:           product.posProductId,
            name:          product.name ?? 'Unknown',
            itRetailUpc:   product.posProductId,
            posLastSyncAt: new Date(),
          },
        });
        savedCount++;
      } catch (dbErr) {
        console.warn(`⚠ Failed to save product ${product.posProductId}:`, dbErr.message);
        failedItems.push({ posProductId: product.posProductId, reason: dbErr.message });
      }
    }

    res.json({
      success:   true,
      count:     normalized.length,
      savedToDb: savedCount,
      failed:    failedItems.length,
      failedItems: failedItems.length > 0 ? failedItems.slice(0, 5) : undefined,
      endpoint,
      products:  normalized,
    });
  } catch (error) {
    console.error('❌ Fetch products error:', error.message);
    res.status(500).json({ success: false, error: error.message, details: error.response?.data });
  }
};

/**
 * @desc    Sync all MarktPOS products to local PostgreSQL
 * @route   POST /api/pos/products/sync
 * @access  Private
 */
export const syncAllProducts = async (req, res, next) => {
  try {
    console.log('🔄 Starting MarktPOS full product sync...');

    const { endpoint, data: rawData } = await fetchMarktPOSProducts(req.posUser ?? req.user);
    const productList = extractProductArray(rawData);

    if (!productList || productList.length === 0) {
      return res.json({ success: true, message: 'MarktPOS returned 0 products', endpoint, total: 0, synced: 0, updated: 0, failed: 0 });
    }

    console.log(`✅ Found ${productList.length} products from MarktPOS`);
    resetNormalizeLogging();

    const orgId   = req.orgId   ?? 'default';
    const now     = new Date();
    let skipped   = 0;
    let synced    = 0;
    let updated   = 0;
    let failed    = 0;

    // Process in batches of 100 to avoid overwhelming the DB
    const BATCH = 100;
    const items = productList.filter(r => {
      if (r.Deleted === true) { skipped++; return false; }
      return true;
    });

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(async (rawItem) => {
        const product = normalizeProduct(rawItem);
        if (!product.posProductId || product.posProductId === 'undefined') {
          skipped++;
          return;
        }
        try {
          const result = await prisma.masterProduct.upsert({
            where: { orgId_upc: { orgId, upc: product.posProductId } },
            update: {
              name:            product.name ?? 'Unknown',
              itRetailUpc:     product.posProductId,
              posLastSyncAt:   now,
              defaultRetailPrice: product.retailPrice ?? undefined,
              defaultCostPrice:   product.costPrice   ?? undefined,
            },
            create: {
              orgId,
              upc:               product.posProductId,
              name:              product.name ?? 'Unknown',
              itRetailUpc:       product.posProductId,
              posLastSyncAt:     now,
              defaultRetailPrice: product.retailPrice ?? undefined,
              defaultCostPrice:   product.costPrice   ?? undefined,
            },
          });
          synced++;
        } catch (err) {
          failed++;
          console.warn(`⚠ Failed to upsert product ${product.posProductId}:`, err.message);
        }
      }));
    }

    console.log(`✅ Sync complete: ${synced} upserted, ${skipped} skipped, ${failed} failed`);

    res.json({ success: true, endpoint, total: productList.length, synced, updated, skipped, failed, lastSyncedAt: now });
  } catch (error) {
    console.error('❌ Sync error:', error.message);
    res.status(500).json({ success: false, error: error.message, details: error.response?.data });
  }
};

/**
 * @desc    Debug endpoint — inspect raw departments / fees / taxes response
 * @route   GET /api/pos/debug/reference-data
 * @access  Private
 */
export const debugReferenceData = async (req, res, next) => {
  try {
    const [deptPrimary, deptFallback, feesRaw, taxesRaw] = await Promise.allSettled([
      marktPOSRequest('GET', '/DepartmentsData/GetAllDepartments', req.posUser ?? req.user),
      marktPOSRequest('GET', '/departments', req.posUser ?? req.user),
      marktPOSRequest('GET', '/FeesData/GetAllFees', req.posUser ?? req.user),
      marktPOSRequest('GET', '/TaxesData/GetAllTaxes', req.posUser ?? req.user),
    ]);

    res.json({
      success: true,
      departments: {
        primary:  { endpoint: '/DepartmentsData/GetAllDepartments', status: deptPrimary.status,  data: deptPrimary.status  === 'fulfilled' ? deptPrimary.value  : deptPrimary.reason?.message  },
        fallback: { endpoint: '/departments',                       status: deptFallback.status, data: deptFallback.status === 'fulfilled' ? deptFallback.value : deptFallback.reason?.message },
      },
      fees:  { endpoint: '/FeesData/GetAllFees',   status: feesRaw.status,  data: feesRaw.status  === 'fulfilled' ? feesRaw.value  : feesRaw.reason?.message  },
      taxes: { endpoint: '/TaxesData/GetAllTaxes', status: taxesRaw.status, data: taxesRaw.status === 'fulfilled' ? taxesRaw.value : taxesRaw.reason?.message },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Debug endpoint — inspect raw MarktPOS products response
 * @route   GET /api/pos/debug/products-raw
 * @access  Private
 */
export const debugProductsRaw = async (req, res, next) => {
  try {
    const debugData = await getDebugProductsRaw(req.posUser ?? req.user);
    res.json({ success: true, ...debugData });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, details: error.response?.data });
  }
};

/**
 * @desc    Update price of a single product in MarktPOS
 * @route   PUT /api/pos/products/:id/price
 * @access  Private
 */
export const updateProductPrice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { price, retailPrice } = req.body;

    if (price === undefined && retailPrice === undefined) {
      return res.status(400).json({ success: false, error: 'Please provide price or retailPrice' });
    }

    const updateData = {};
    if (price !== undefined) updateData.price = price;
    if (retailPrice !== undefined) updateData.retailPrice = retailPrice;

    await marktPOSRequest('PUT', `/products/${id}`, req.posUser ?? req.user, updateData);

    // Mirror to local DB
    const local = {};
    if (price !== undefined) local.defaultCostPrice = Number(price);
    if (retailPrice !== undefined) local.defaultRetailPrice = Number(retailPrice);
    local.posLastSyncAt = new Date();

    await prisma.masterProduct.updateMany({
      where: { itRetailUpc: String(id), ...(req.orgId ? { orgId: req.orgId } : {}) },
      data: local,
    });

    res.json({ success: true, message: `Product ${id} price updated successfully`, updated: updateData });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Bulk update prices for multiple products in MarktPOS
 * @route   POST /api/pos/products/bulk-price-update
 * @access  Private
 */
export const bulkPriceUpdate = async (req, res, next) => {
  try {
    const { products } = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ success: false, error: 'Please provide an array of products' });
    }

    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (const item of products) {
      const { posProductId, price, retailPrice } = item;
      if (!posProductId) {
        failCount++;
        errors.push({ posProductId: 'missing', error: 'No posProductId provided' });
        continue;
      }

      try {
        const updateData = {};
        if (price !== undefined) updateData.price = price;
        if (retailPrice !== undefined) updateData.retailPrice = retailPrice;

        await marktPOSRequest('PUT', `/products/${posProductId}`, req.posUser ?? req.user, updateData);

        const local = { posLastSyncAt: new Date() };
        if (price !== undefined) local.defaultCostPrice = Number(price);
        if (retailPrice !== undefined) local.defaultRetailPrice = Number(retailPrice);

        await prisma.masterProduct.updateMany({
          where: { itRetailUpc: String(posProductId), ...(req.orgId ? { orgId: req.orgId } : {}) },
          data: local,
        });

        successCount++;
      } catch (err) {
        failCount++;
        errors.push({ posProductId, error: err.message });
      }
    }

    res.json({ success: true, total: products.length, successCount, failCount, errors: errors.length > 0 ? errors : undefined });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Fetch customers from IT Retail (MarktPOS)
 * @route   GET /api/pos/customers
 * @access  Private
 */
export const fetchCustomers = async (req, res, next) => {
  try {
    const rawData = await marktPOSRequest('GET', '/CustomersData/GetAllCustomers', req.posUser ?? req.user);
    const customerList = extractProductArray(rawData) || [];

    res.json({ success: true, count: customerList.length, customers: customerList });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Sync all IT Retail customers to local PostgreSQL
 * @route   POST /api/pos/customers/sync
 * @access  Private
 */
export const syncPOSCustomers = async (req, res, next) => {
  try {
    const rawData = await marktPOSRequest('GET', '/CustomersData/GetAllCustomers', req.posUser ?? req.user);
    const customerList = extractProductArray(rawData) || [];

    if (customerList.length === 0) {
      return res.json({ success: true, message: 'IT Retail returned 0 customers', total: 0, synced: 0, updated: 0, skipped: 0, failed: 0 });
    }

    const orgId   = req.orgId   ?? 'default';
    const storeId = req.storeId ?? null;
    const now     = new Date();
    let skipped   = 0;
    let synced    = 0;
    let failed    = 0;

    const BATCH = 100;
    const items = customerList.filter(raw => {
      if (raw.Deleted === true) { skipped++; return false; }
      const posId = String(raw.Id || raw.id || '');
      if (!posId) { skipped++; return false; }
      return true;
    });

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(async (raw) => {
        const posId    = String(raw.Id || raw.id || '');
        const firstName = raw.FirstName || raw.firstName || '';
        const lastName  = raw.LastName  || raw.lastName  || '';
        const fullName  = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';

        try {
          await prisma.customer.upsert({
            where: { id: posId }, // posCustomerId is not a unique field — use upsert by orgId+posCustomerId
            // Prisma upsert requires a unique field — use findFirst + update/create pattern
            create: undefined,
            update: undefined,
          });
        } catch (_) {}

        // Use findFirst + upsert workaround
        try {
          const existing = await prisma.customer.findFirst({
            where: { orgId, posCustomerId: posId },
          });

          const data = {
            posCustomerId:       posId,
            name:                fullName,
            firstName,
            lastName,
            cardNo:              raw.CardNo    || raw.cardNo    || '',
            email:               raw.Email     || raw.email     || '',
            phone:               raw.Phone     || raw.phone     || '',
            loyaltyPoints:       parseInt(raw.LoyaltyPoints || raw.loyaltyPoints || 0, 10) || 0,
            discount:            raw.Discount   != null ? raw.Discount   : null,
            balance:             raw.Balance    != null ? parseFloat(raw.Balance)    : null,
            balanceLimit:        raw.BalanceLimit != null ? parseFloat(raw.BalanceLimit) : null,
            birthDate:           raw.BirthDate  || null,
            expirationDate:      raw.ExpirationDate || raw.expiration_date || null,
            instoreChargeEnabled: raw.InstoreChargeEnabled || false,
            deleted:             false,
            posSyncedAt:         now,
          };

          if (existing) {
            await prisma.customer.update({ where: { id: existing.id }, data });
          } else {
            await prisma.customer.create({ data: { ...data, orgId, storeId } });
          }
          synced++;
        } catch (err) {
          failed++;
          console.warn(`⚠ Failed to sync customer ${posId}:`, err.message);
        }
      }));
    }

    res.json({ success: true, total: customerList.length, synced, skipped, failed, lastSyncedAt: now });
  } catch (error) {
    console.error('❌ Customer sync error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Fetch departments from MarktPOS (IT Retail)
 * @route   GET /api/pos/departments
 * @access  Private
 */
export const fetchDepartments = async (req, res, next) => {
  try {
    let raw;
    try {
      raw = await marktPOSRequest('GET', '/DepartmentsData/GetAllDepartments', req.posUser ?? req.user);
    } catch (primaryErr) {
      raw = await marktPOSRequest('GET', '/departments', req.posUser ?? req.user);
    }

    const deptList = Array.isArray(raw) ? raw : (raw?.value || raw?.data || raw?.items || raw?.departments || []);

    const normalized = deptList.map(d => ({
      id:   d.id   ?? d.departmentId ?? d.Id   ?? d.DepartmentId   ?? '',
      name: d.name ?? d.departmentName ?? d.Name ?? d.DepartmentName ?? `Dept ${d.id ?? '?'}`,
      ...d,
    }));

    res.json({ success: true, count: normalized.length, departments: normalized });
  } catch (error) {
    next(error);
  }
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
      itRetailUpc: { not: null },
      deleted: false,
      ...(req.orgId ? { orgId: req.orgId } : {}),
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { upc:  { contains: search } },
        { sku:  { contains: search } },
        { itRetailUpc: { contains: search } },
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
 * @desc    Global product search in MarktPOS (v2 API)
 * @route   GET /api/pos/products/search
 */
export const globalProductSearch = async (req, res, next) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query parameter is required' });
    }

    let result = [];
    try {
      if (/^\d{5,}$/.test(query)) {
        const raw = await marktPOSRequest('GET', `/v2/products/${query}`, req.posUser ?? req.user);
        if (raw) result = [normalizeProduct(raw)];
      } else {
        const rawData = await marktPOSRequest('GET', `/v2/products?search=${encodeURIComponent(query)}`, req.posUser ?? req.user);
        result = (extractProductArray(rawData) || []).map(normalizeProduct);
      }
    } catch (err) {
      console.warn('POS v2 search failed, falling back to local search:', err.message);
      const where = {
        deleted: false,
        ...(req.orgId ? { orgId: req.orgId } : {}),
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { upc:  { contains: query } },
          { sku:  { contains: query } },
          { itRetailUpc: { contains: query } },
        ],
      };
      result = await prisma.masterProduct.findMany({ where, take: 10 });
    }

    res.json({ success: true, count: result.length, products: result });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all vendors from MarktPOS
 * @route   GET /api/pos/vendors
 * @access  Private
 */
export const getAllVendors = async (req, res, next) => {
  try {
    const data = await marktPOSRequest('GET', '/VendorsData/GetAllVendors', req.posUser ?? req.user);
    const activeVendors = Array.isArray(data) ? data.filter(v => !v.deleted) : [];
    res.json(activeVendors);
  } catch (error) {
    console.error('Failed to fetch vendors:', error.message);
    res.json([]);
  }
};

/**
 * @desc    Fetch all Taxes and Fees from IT Retail
 * @route   GET /api/pos/taxes-fees
 * @access  Private
 */
export const getTaxesFees = async (req, res, next) => {
  try {
    const [taxesRaw, feesRaw] = await Promise.allSettled([
      marktPOSRequest('GET', '/TaxesData/GetAllTaxes', req.posUser ?? req.user),
      marktPOSRequest('GET', '/FeesData/GetAllFees',   req.posUser ?? req.user),
    ]);

    const unwrap = (settled) => {
      if (settled.status === 'rejected') return [];
      const d = settled.value;
      return Array.isArray(d) ? d : (d?.value || d?.data || d?.items || []);
    };

    const taxes = unwrap(taxesRaw).map(t => ({
      id:   t.id   ?? t.taxId   ?? t.Id   ?? t.TaxId   ?? '',
      name: t.name ?? t.taxName ?? t.Name ?? t.TaxName ?? `Tax ${t.id ?? '?'}`,
      rate: t.rate ?? t.taxRate ?? t.Rate ?? t.TaxRate ?? null,
      ...t,
    }));

    const fees = unwrap(feesRaw).map(f => ({
      id:      f.id      ?? f.feeId   ?? f.Id   ?? f.FeeId   ?? '',
      name:    f.name    ?? f.feeName ?? f.Name ?? f.FeeName ?? `Fee ${f.id ?? '?'}`,
      amount:  f.amount  ?? f.feeAmount ?? f.Amount ?? f.FeeAmount ?? null,
      pack:    f.pack    ?? f.quantity ?? f.Pack ?? f.Quantity ?? null,
      feeType: f.feeType ?? f.type     ?? f.FeeType ?? null,
      ...f,
    }));

    res.json({ success: true, taxes, fees });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update an existing IT Retail product's details from invoice data
 * @route   PUT /api/pos/products/:id/details
 * @access  Private
 */
export const updatePOSProductDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { description, upc, pack, case_cost, cost, normal_price, departmentId, vendorId, cert_code, fees, taxes, size } = req.body;

    const payload = {};
    if (description  !== undefined) payload.description  = description;
    if (upc          !== undefined) payload.upc          = upc;
    if (pack         !== undefined) payload.pack         = Number(pack);
    if (case_cost    !== undefined) payload.case_cost    = Number(case_cost);
    if (cost         !== undefined) payload.cost         = Number(cost);
    if (normal_price !== undefined) payload.normal_price = Number(normal_price);
    if (departmentId !== undefined) payload.departmentId = departmentId;
    if (vendorId     !== undefined) payload.vendorId     = vendorId;
    if (cert_code    !== undefined) payload.cert_code    = cert_code;
    if (fees         !== undefined) payload.fees         = fees;
    if (taxes        !== undefined) payload.taxes        = taxes;
    if (size         !== undefined) payload.size         = size;

    const posResult = await marktPOSRequest('PUT', `/products/${id}`, req.posUser ?? req.user, payload);

    const local = { posLastSyncAt: new Date() };
    if (normal_price !== undefined) local.defaultRetailPrice = Number(normal_price);
    if (case_cost    !== undefined) local.defaultCasePrice   = Number(case_cost);
    if (cost         !== undefined) local.defaultCostPrice   = Number(cost);
    if (pack         !== undefined) local.pack               = Number(pack);

    await prisma.masterProduct.updateMany({
      where: { itRetailUpc: String(id), ...(req.orgId ? { orgId: req.orgId } : {}) },
      data: local,
    });

    res.json({
      success: true,
      testingMode: posResult?.testingMode || false,
      message: posResult?.testingMode
        ? 'Dev mode: POS write blocked.'
        : `Product ${id} updated in IT Retail`,
      posResponse: posResult,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a new product in IT Retail from invoice line item data
 * @route   POST /api/pos/products/create
 * @access  Private
 */
export const createPOSProduct = async (req, res, next) => {
  try {
    const { description, upc, pack, case_cost, cost, normal_price, departmentId, vendorId, cert_code, fees, taxes, size } = req.body;

    if (!description) {
      return res.status(400).json({ success: false, error: 'description is required' });
    }

    const payload = {
      description,
      upc:          upc          || '',
      pack:         Number(pack) || 1,
      case_cost:    Number(case_cost) || 0,
      cost:         Number(cost || (pack > 0 ? case_cost / pack : 0)) || 0,
      normal_price: Number(normal_price) || 0,
      departmentId: departmentId || null,
      vendorId:     vendorId     || null,
      cert_code:    cert_code    || '',
      fees:         fees         || '',
      taxes:        taxes        || '',
      size:         size         || '',
      active:       true,
    };

    const posResult = await marktPOSRequest('POST', '/products', req.posUser ?? req.user, payload);

    res.json({
      success: true,
      testingMode: posResult?.testingMode || false,
      message: posResult?.testingMode
        ? 'Dev mode: product creation blocked.'
        : 'Product created in IT Retail',
      posResponse: posResult,
      newProductId: posResult?.upc || posResult?.id || posResult?.posProductId || null,
    });
  } catch (error) {
    next(error);
  }
};
