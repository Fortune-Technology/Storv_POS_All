import axios from 'axios';
import prisma from '../config/postgres.js';

/**
 * MarktPOS API Integration Service
 *
 * Handles authentication, token caching, automatic retry on 401,
 * exponential backoff on network failures, and endpoint discovery.
 */

const BASE_URL = (u) => u?.marktPOSConfig?.baseURL || process.env.MARKTPOS_BASE_URL || 'https://app.marktpos.com';
const MAX_RETRIES = 3;

// ─── Discovered endpoint cache ───
let discoveredProductsEndpoint = null;

/**
 * Load token from DB for a specific user
 */
const loadTokenFromDB = async (userId) => {
  try {
    const stored = await prisma.posToken.findFirst({ where: { userId: String(userId) } });
    if (stored && stored.expiresAt > new Date()) {
      return { token: stored.token, expiry: stored.expiresAt.getTime() };
    }
  } catch (err) {
    console.warn(`⚠ Could not load stored POS token for user ${userId}:`, err.message);
  }
  return null;
};

/**
 * Authenticate with MarktPOS and obtain an access token.
 */
export const getMarktPOSToken = async (user, credentials = null) => {
  const userId = user?._id || user?.id; // standardise
  const username = credentials?.username || user?.marktPOSUsername;
  const password = credentials?.password || user?.marktPOSPassword;
  
  const securityCode = user?.marktPOSConfig?.securityCode || process.env.MARKTPOS_SECURITY_CODE;
  const accessLevel  = user?.marktPOSConfig?.accessLevel  || process.env.MARKTPOS_ACCESS_LEVEL || '0';

  if (!username || !password) {
    throw new Error('MarktPOS credentials not provided or configured for this store.');
  }

  // If we have a userId, try loading from DB first
  if (userId && !credentials) {
    const stored = await loadTokenFromDB(userId);
    if (stored && Date.now() < stored.expiry - 3600000) {
      return stored.token;
    }
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('username', username);
  params.append('password', password);

  let tokenUrl = `${BASE_URL(user)}/token?accesslevel=${accessLevel}`;
  if (securityCode) {
    tokenUrl += `&securityCode=${securityCode}`;
  }

  try {
    const response = await axios.post(
      tokenUrl,
      params.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      }
    );

    const accessToken = response.data.access_token;
    const expiry = Date.now() + response.data.expires_in * 1000;

    if (userId) {
      try {
        await prisma.posToken.upsert({
          where:  { userId: String(userId) },
          update: { token: accessToken, expiresAt: new Date(expiry) },
          create: { userId: String(userId), token: accessToken, expiresAt: new Date(expiry), orgId: user.orgId || 'unknown' },
        });
      } catch (dbErr) {
        console.warn(`⚠ Could not persist POS token for user ${userId}:`, dbErr.message);
      }
    }

    console.log(`✓ MarktPOS token obtained for user ${userId || 'temp'}, expires:`, new Date(expiry).toISOString());
    await logPOSCall('POST', '/token', 'success', 200, 'Token obtained', user);

    return accessToken;
  } catch (error) {
    await logPOSCall('POST', '/token', 'fail', error.response?.status, error.message, user);

    if (error.response?.status === 400 || error.response?.status === 401) {
      throw new Error('Invalid MarktPOS credentials. Please check your username and password.');
    }
    throw new Error(`MarktPOS authentication failed: ${error.message}`);
  }
};

/**
 * Make an authenticated request to the MarktPOS API for a specific user.
 * Automatically handles token refresh on 401 and retries on network errors.
 */
export const marktPOSRequest = async (method, endpoint, user, data = null, retryCount = 0, params = null) => {
  try {
    const token = await getMarktPOSToken(user);
    const baseUrl = BASE_URL(user);
    const url = `${baseUrl}/api${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

    console.log(`🔗 MarktPOS ${method} ${url} (User: ${user?._id || user?.id})`);

    // POS write guard — set POS_WRITE_DISABLED=true in your .env to block mutations during testing
    if (method.toUpperCase() !== 'GET' && process.env.POS_WRITE_DISABLED === 'true') {
      console.log(`🛑 [POS_WRITE_DISABLED] Blocked MarktPOS mutation: ${method} ${url}`);
      return { success: true, message: 'POS writes disabled via POS_WRITE_DISABLED=true', testingMode: true };
    }

    const config = {
      method,
      url,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 60s — product lists can be large
    };

    if (data) config.data = data;
    if (params) config.params = params;

    const response = await axios(config);

    await logPOSCall(method, endpoint, 'success', response.status, '', user);

    return response.data;
  } catch (err) {
    // If 401, token expired — clear DB/cache and retry ONCE
    if (err.response?.status === 401 && retryCount === 0) {
      console.warn(`⚠ MarktPOS 401 for user ${user?._id} — refreshing token and retrying...`);
      // Force refresh by not passing through loadTokenFromDB logic? 
      // Actually getMarktPOSToken checks expiry. If we got 401, it means the token we have is invalid.
      // We should delete it from DB if it was from DB.
      if (user?._id || user?.id) {
        const uid = String(user._id || user.id);
        await prisma.posToken.deleteMany({ where: { userId: uid } });
      }
      return marktPOSRequest(method, endpoint, user, data, retryCount + 1, params);
    }

    // Network timeout — retry up to MAX_RETRIES with exponential backoff
    if (!err.response && retryCount < MAX_RETRIES) {
      const delay = Math.pow(2, retryCount) * 1000;
      console.warn(`⚠ Network error on ${endpoint}, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return marktPOSRequest(method, endpoint, user, data, retryCount + 1, params);
    }

    await logPOSCall(method, endpoint, 'fail', err.response?.status, err.message, user);

    if (!err.response) {
      throw new Error('MarktPOS system unavailable. Please try again later.');
    }

    throw new Error(err.response?.data?.message || err.response?.data?.Message || `MarktPOS API error (${err.response?.status}): ${err.message}`);
  }
};

/**
 * Clear the stored token for a specific user
 */
export const clearUserToken = async (userId) => {
  if (userId) {
    await prisma.posToken.deleteMany({ where: { userId: String(userId) } });
  }
};

/**
 * Get the current token expiry date for a specific user
 */
export const getTokenExpiry = async (userId) => {
  if (!userId) return null;
  try {
    const stored = await prisma.posToken.findFirst({ where: { userId: String(userId) } });
    return stored?.expiresAt ?? null;
  } catch {
    return null;
  }
};

// ═══════════════════════════════════════════════════════
// PRODUCTS ENDPOINT DISCOVERY
// IT Retail (MarktPOS) uses /ProductsData/GetAllProducts
// ═══════════════════════════════════════════════════════

const PRODUCT_ENDPOINTS = [
  '/ProductsData/GetAllProducts',   // ← documented IT Retail endpoint
  '/productsdata/getallproducts',
  '/products',
  '/Products',
  '/items',
  '/Items',
  '/inventory',
  '/Inventory',
];

/**
 * Try multiple endpoint variants to find products for a specific user.
 * Caches the working endpoint for subsequent calls.
 */
export const fetchMarktPOSProducts = async (user) => {
  // If we've already found a working endpoint, use it
  if (discoveredProductsEndpoint) {
    console.log(`📦 Using cached endpoint: ${discoveredProductsEndpoint}`);
    const result = await marktPOSRequest('GET', discoveredProductsEndpoint, user);
    return { endpoint: discoveredProductsEndpoint, data: result };
  }

  // Try each endpoint
  const errors = [];
  for (const endpoint of PRODUCT_ENDPOINTS) {
    try {
      console.log(`🔍 Trying products endpoint: ${endpoint}`);
      const result = await marktPOSRequest('GET', endpoint, user);

      // Check if we got something meaningful
      const items = extractProductArray(result);
      if (items !== null) {
        console.log(`✅ Found ${items.length} products at: ${endpoint}`);
        discoveredProductsEndpoint = endpoint; // cache it
        return { endpoint, data: result };
      }
      console.log(`⚠ ${endpoint} returned data but no product array`);
    } catch (err) {
      const status = err.message?.match(/\((\d+)\)/)?.[1] || 'unknown';
      console.log(`❌ ${endpoint} failed: ${status} — ${err.message.substring(0, 100)}`);
      errors.push({ endpoint, status, error: err.message.substring(0, 200) });
    }
  }

  throw new Error(
    `No valid products endpoint found on MarktPOS. Tried: ${PRODUCT_ENDPOINTS.join(', ')}. ` +
    `Errors: ${JSON.stringify(errors)}`
  );
};

// ═══════════════════════════════════════════════════════
// RESPONSE PARSING
// ═══════════════════════════════════════════════════════

/**
 * Extract the product array from various response shapes:
 *   - Direct array
 *   - OData { value: [] }
 *   - { items: [] }, { products: [] }, { data: [] }, { results: [] }
 *
 * Returns null if no array found.
 */
export const extractProductArray = (rawData) => {
  if (Array.isArray(rawData)) {
    return rawData;
  }
  if (rawData && typeof rawData === 'object') {
    // Try common wrappers in order of likelihood
    for (const key of ['value', 'items', 'products', 'data', 'results', 'Value', 'Items', 'Products', 'Data', 'Results']) {
      if (Array.isArray(rawData[key])) {
        console.log(`📋 Found product array under key: "${key}" (${rawData[key].length} items)`);
        return rawData[key];
      }
    }
    // Last resort: if the response has numeric keys, it might be an array-like object
    const keys = Object.keys(rawData);
    if (keys.length > 0 && keys.every(k => !isNaN(k))) {
      console.log(`📋 Converting array-like object to array (${keys.length} items)`);
      return Object.values(rawData);
    }
  }
  return null;
};

// ═══════════════════════════════════════════════════════
// PRODUCT NORMALIZATION
// Mapped to actual IT Retail (MarktPOS) field names
// from: https://retailnext.itretail.com API docs
//
// IT Retail fields:
//   upc, description, cost, normal_price, special_price,
//   departmentId, sectionId, vendorId, pack, size, taxes,
//   fees, foodstamp, scale, active, QuantityOnHand, PLU,
//   cert_code, Deleted, HideFromECommerce, case_cost, etc.
// ═══════════════════════════════════════════════════════

/**
 * Normalize a raw IT Retail / MarktPOS product into our local schema.
 */
export const normalizeProduct = (rawItem) => {
  // Log the first raw item so developers can verify field names
  if (!normalizeProduct._logged) {
    console.log('────────────────────────────────────────');
    console.log('📦 FIRST RAW IT RETAIL PRODUCT:');
    console.log('   Keys:', Object.keys(rawItem));
    console.log('   Full data:', JSON.stringify(rawItem, null, 2));
    console.log('────────────────────────────────────────');
    normalizeProduct._logged = true;
  }

  // ─── Unique ID ───
  // IT Retail uses `upc` as the primary unique identifier.
  // cert_code and PLU are secondary identifiers.
  const posId = String(
    rawItem.upc ?? rawItem.UPC ??
    rawItem.id ?? rawItem.Id ?? rawItem.ID ??
    rawItem.PLU ?? rawItem.plu ??
    rawItem.cert_code ??
    ''
  );

  // ─── Name ───
  const name = (
    rawItem.description ?? rawItem.Description ??
    rawItem.name ?? rawItem.Name ??
    'Unknown Product'
  );

  // ─── UPC (barcode) ───
  const upc = String(rawItem.upc ?? rawItem.UPC ?? '');

  // ─── Cost price ───
  // IT Retail: "cost" = wholesale cost
  const costPrice = parseFloat(rawItem.cost ?? rawItem.Cost ?? 0) || 0;

  // ─── Retail price ───
  // IT Retail: "normal_price" = regular selling price
  // "special_price" = sale price (if active)
  const normalPrice = parseFloat(rawItem.normal_price ?? rawItem.Normal_price ?? 0) || 0;
  const specialPrice = parseFloat(rawItem.special_price ?? rawItem.Special_price ?? 0) || 0;
  // Use special_price if it exists and is > 0, otherwise use normal_price
  const retailPrice = (specialPrice > 0) ? specialPrice : normalPrice;

  // ─── Category / Department ───
  // IT Retail stores departmentId (number), not the name.
  // We store the ID as string; can be resolved to name via /departments endpoint later.
  const category = String(
    rawItem.departmentId ?? rawItem.DepartmentId ??
    rawItem.department ?? rawItem.Department ??
    rawItem.category ?? rawItem.Category ??
    'Uncategorized'
  );

  // ─── Stock ───
  // IT Retail: "QuantityOnHand" (can be negative)
  const stock = parseInt(
    rawItem.QuantityOnHand ?? rawItem.quantityOnHand ??
    rawItem.quantity ?? rawItem.Quantity ??
    rawItem.stock ?? rawItem.Stock ??
    0, 10
  ) || 0;

  // ─── Deposit (fees) ───
  // IT Retail stores fee IDs in "fees" field, not a dollar amount.
  // We store the raw fees string for now.
  const deposit = parseFloat(
    rawItem.deposit ?? rawItem.Deposit ?? 0
  ) || 0;

  // ─── SKU / Item Code ───
  const sku = String(
    rawItem.cert_code ?? rawItem.PLU ??
    rawItem.sku ?? rawItem.SKU ??
    ''
  );

  return {
    posProductId: posId,
    name,
    upc,
    costPrice,
    retailPrice,
    category,
    stock,
    deposit,
    sku,
    // ─── IT Retail-specific extra fields ───
    normalPrice,
    specialPrice: specialPrice > 0 ? specialPrice : null,
    foodstamp: rawItem.foodstamp ?? null,
    scale: rawItem.scale ?? null,
    active: rawItem.active ?? true,
    deleted: rawItem.Deleted ?? false,
    departmentId: rawItem.departmentId != null ? String(rawItem.departmentId) : null,
    sectionId:    rawItem.sectionId    != null ? String(rawItem.sectionId)    : null,
    vendorId:     rawItem.vendorId     != null ? String(rawItem.vendorId)     : null,
    pack: rawItem.pack ?? null,
    size: rawItem.size ?? null,
    taxes: rawItem.taxes ?? '',
    fees: rawItem.fees ?? '',
    caseCost: rawItem.case_cost ? parseFloat(rawItem.case_cost) : null,
  };
};

/**
 * Reset normalizeProduct's logging flag so next call logs again
 */
export const resetNormalizeLogging = () => {
  normalizeProduct._logged = false;
};

/**
 * Get raw debug data from MarktPOS products endpoint for a specific user
 */
export const getDebugProductsRaw = async (user) => {
  const { endpoint, data } = await fetchMarktPOSProducts(user);
  const items = extractProductArray(data);

  return {
    discoveredEndpoint: endpoint,
    responseType: typeof data,
    isArray: Array.isArray(data),
    topLevelKeys: data && typeof data === 'object' ? Object.keys(data) : null,
    totalItems: items ? items.length : 0,
    firstItemKeys: items && items[0] ? Object.keys(items[0]) : null,
    sample: items ? items.slice(0, 3) : data,
  };
};

// ═══════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════

const logPOSCall = async (method, endpoint, status, statusCode, message = '', user = null) => {
  try {
    await prisma.posLog.create({
      data: {
        orgId:      user?.orgId || 'unknown', // log the actual org if possible
        method:     method.toUpperCase(),
        endpoint,
        status,
        statusCode: statusCode ?? null,
        message:    message ? String(message).substring(0, 500) : null,
      },
    });
  } catch (err) {
    // Non-fatal — log to console but don't break the POS request
    console.warn('⚠ Failed to log POS call:', err.message);
  }
};

export default {
  getMarktPOSToken,
  marktPOSRequest,
  clearUserToken,
  getTokenExpiry,
  normalizeProduct,
  resetNormalizeLogging,
  fetchMarktPOSProducts,
  extractProductArray,
  getDebugProductsRaw,
};
