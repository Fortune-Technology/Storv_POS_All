/**
 * POS Customer Auth Service
 * Proxies customer auth operations to the POS backend.
 * The POS Customer table is the single source of truth.
 * Follows the same pattern as stockCheckService.js.
 */

import axios from 'axios';

const POS_BACKEND_URL = process.env.POS_BACKEND_URL || 'http://localhost:5000';
const TIMEOUT = 5000;

/**
 * Sign up a new customer (or claim an existing POS customer).
 */
export async function posSignup(orgId, storeId, { email, password, firstName, lastName, name, phone }) {
  const resp = await axios.post(
    `${POS_BACKEND_URL}/api/storefront/auth/signup`,
    { orgId, storeId, email, password, firstName, lastName, name, phone },
    { timeout: TIMEOUT, headers: { 'Content-Type': 'application/json' } }
  );
  return resp.data;
}

/**
 * Log in a customer.
 */
export async function posLogin(orgId, storeId, email, password) {
  const resp = await axios.post(
    `${POS_BACKEND_URL}/api/storefront/auth/login`,
    { orgId, storeId, email, password },
    { timeout: TIMEOUT, headers: { 'Content-Type': 'application/json' } }
  );
  return resp.data;
}

/**
 * Get customer profile by ID.
 */
export async function posGetProfile(customerId) {
  const resp = await axios.get(
    `${POS_BACKEND_URL}/api/storefront/auth/profile/${customerId}`,
    { timeout: TIMEOUT }
  );
  return resp.data;
}

/**
 * Update customer profile.
 */
export async function posUpdateProfile(customerId, data) {
  const resp = await axios.put(
    `${POS_BACKEND_URL}/api/storefront/auth/profile/${customerId}`,
    data,
    { timeout: TIMEOUT, headers: { 'Content-Type': 'application/json' } }
  );
  return resp.data;
}

/**
 * Change customer password.
 */
export async function posChangePassword(customerId, currentPassword, newPassword) {
  const resp = await axios.put(
    `${POS_BACKEND_URL}/api/storefront/auth/password/${customerId}`,
    { currentPassword, newPassword },
    { timeout: TIMEOUT, headers: { 'Content-Type': 'application/json' } }
  );
  return resp.data;
}

/**
 * List customers for a store (portal management).
 */
export async function posListCustomers(orgId, storeId, { search, page, limit } = {}) {
  const params = { orgId, storeId };
  if (search) params.search = search;
  if (page) params.page = page;
  if (limit) params.limit = limit;

  const resp = await axios.get(
    `${POS_BACKEND_URL}/api/storefront/customers`,
    { params, timeout: TIMEOUT }
  );
  return resp.data;
}

/**
 * Count customers for a store (analytics).
 */
export async function posCountCustomers(orgId, storeId) {
  const resp = await axios.get(
    `${POS_BACKEND_URL}/api/storefront/customers/count`,
    { params: { orgId, storeId }, timeout: TIMEOUT }
  );
  return resp.data;
}
