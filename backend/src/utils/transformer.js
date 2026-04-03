/**
 * Main Transformer Module
 * Delegates to vendor-specific transformers based on vendor selection
 */

import { getVendorTransformer, getDefaultVendor } from './transformers/vendorRegistry.js';

/**
 * Transform row using vendor-specific transformer
 * @param {Object} row - Input row
 * @param {Object} depositMapping - Deposit mapping
 * @param {Object} options - Transformation options
 * @param {string} options.vendorId - Vendor identifier (defaults to AGNE)
 * @returns {{transformedRow: Object, warnings: string[]}}
 */
export function transformRow(row, depositMapping = {}, options = {}) {
  const vendorId = options.vendorId || getDefaultVendor();
  const transformer = getVendorTransformer(vendorId);

  return transformer.transformRow(row, depositMapping, options);
}

/**
 * Get output columns for vendor
 * @param {string} vendorId - Vendor identifier (defaults to AGNE)
 * @returns {string[]} - Ordered column names
 */
export function getOutputColumns(vendorId = null) {
  const vendor = vendorId || getDefaultVendor();
  const transformer = getVendorTransformer(vendor);

  return transformer.getOutputColumns();
}

// Re-export vendor registry functions for convenience
export {
  getAvailableVendors,
  getVendorTransformer,
  isVendorSupported,
  getDefaultVendor
} from './transformers/vendorRegistry.js';