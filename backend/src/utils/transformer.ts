/**
 * Main Transformer Module
 * Delegates to vendor-specific transformers based on vendor selection
 */

import { getVendorTransformer, getDefaultVendor } from './transformers/vendorRegistry.js';

interface TransformOptions {
  vendorId?: string;
  [k: string]: unknown;
}

export interface TransformResult {
  transformedRow: Record<string, unknown>;
  warnings: string[];
}

/**
 * Transform row using vendor-specific transformer
 */
export function transformRow(
  row: Record<string, unknown>,
  depositMapping: Record<string, unknown> = {},
  options: TransformOptions = {},
): TransformResult {
  const vendorId = options.vendorId || getDefaultVendor();
  const transformer = getVendorTransformer(vendorId);

  return transformer.transformRow(row, depositMapping, options);
}

/**
 * Get output columns for vendor
 */
export function getOutputColumns(vendorId: string | null = null): string[] {
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