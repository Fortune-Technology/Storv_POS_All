/**
 * Vendor Registry
 * Central registry for all supported vendor transformers
 * Add new vendors here to make them available in the system
 */

import * as agneTransformer from './agne.js';
import * as pineStateSpiritTransformer from './pine-state-spirits.js';
import * as santeTransformer from './sante.js';

// ── Public types ────────────────────────────────────────────────────────────

export interface VendorConfig {
  vendorId?: string;
  vendorName?: string;
  description?: string;
  supportedFormats?: string[];
  transformationRules?: Record<string, unknown>;
}

export interface VendorTransformer {
  transformRow(
    row: Record<string, unknown>,
    depositMapping: Record<string, unknown>,
    options: Record<string, unknown>,
  ): { transformedRow: Record<string, unknown>; warnings: string[] };
  getOutputColumns(): string[];
  [k: string]: unknown; // *Config exports etc.
}

/**
 * Registry of all available vendor transformers
 * Each vendor must export: config, transformRow, getOutputColumns
 */
const vendorRegistry: Record<string, VendorTransformer> = {
    AGNE: agneTransformer as unknown as VendorTransformer,
    PINE_STATE_SPIRITS: pineStateSpiritTransformer as unknown as VendorTransformer,
    SANTE: santeTransformer as unknown as VendorTransformer,
    // Add more vendors here as they are implemented
};

/**
 * Get list of all available vendors
 */
export interface AvailableVendor {
  vendorId: string;
  vendorName: string;
  description: string;
  supportedFormats: string[];
  transformationRules: Record<string, unknown>;
}
export function getAvailableVendors(): AvailableVendor[] {
    return Object.keys(vendorRegistry).map((vendorId) => {
        const vendor = vendorRegistry[vendorId];
        // Try to find the config object (could be agneConfig, pineStateSpiritConfig, etc.)
        const configKey = Object.keys(vendor).find((key) => key.endsWith('Config'));
        const config = (configKey ? (vendor[configKey] as VendorConfig) : {}) as VendorConfig;

        return {
            vendorId: config.vendorId || vendorId,
            vendorName: config.vendorName || vendorId,
            description: config.description || 'No description available',
            supportedFormats: config.supportedFormats || ['csv'],
            transformationRules: config.transformationRules || {},
        };
    });
}

/**
 * Get transformer for a specific vendor
 */
export function getVendorTransformer(vendorId: string): VendorTransformer {
    const transformer = vendorRegistry[vendorId];

    if (!transformer) {
        throw new Error(
            `Vendor "${vendorId}" not found. Available vendors: ${Object.keys(vendorRegistry).join(', ')}`,
        );
    }

    return transformer;
}

/**
 * Check if vendor is supported
 */
export function isVendorSupported(vendorId: string): boolean {
    return vendorId in vendorRegistry;
}

/**
 * Get default vendor
 */
export function getDefaultVendor(): string {
    return 'AGNE';
}

export default {
    getAvailableVendors,
    getVendorTransformer,
    isVendorSupported,
    getDefaultVendor
};
