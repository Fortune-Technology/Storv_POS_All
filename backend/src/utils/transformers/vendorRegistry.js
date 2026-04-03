/**
 * Vendor Registry
 * Central registry for all supported vendor transformers
 * Add new vendors here to make them available in the system
 */

import * as agneTransformer from './agne.js';
import * as pineStateSpiritTransformer from './pine-state-spirits.js';

/**
 * Registry of all available vendor transformers
 * Each vendor must export: config, transformRow, getOutputColumns
 */
const vendorRegistry = {
    AGNE: agneTransformer,
    PINE_STATE_SPIRITS: pineStateSpiritTransformer,
    // Add more vendors here as they are implemented
    // Example:
    // VENDOR_X: vendorXTransformer,
    // VENDOR_Y: vendorYTransformer,
};

/**
 * Get list of all available vendors
 * @returns {Array} Array of vendor configurations
 */
export function getAvailableVendors() {
    return Object.keys(vendorRegistry).map(vendorId => {
        const vendor = vendorRegistry[vendorId];
        // Try to find the config object (could be agneConfig, pineStateSpiritConfig, etc.)
        const configKey = Object.keys(vendor).find(key => key.endsWith('Config'));
        const config = configKey ? vendor[configKey] : {};

        return {
            vendorId: config?.vendorId || vendorId,
            vendorName: config?.vendorName || vendorId,
            description: config?.description || 'No description available',
            supportedFormats: config?.supportedFormats || ['csv'],
            transformationRules: config?.transformationRules || {}
        };
    });
}

/**
 * Get transformer for a specific vendor
 * @param {string} vendorId - Vendor identifier
 * @returns {Object} Vendor transformer module
 * @throws {Error} If vendor not found
 */
export function getVendorTransformer(vendorId) {
    const transformer = vendorRegistry[vendorId];

    if (!transformer) {
        throw new Error(`Vendor "${vendorId}" not found. Available vendors: ${Object.keys(vendorRegistry).join(', ')}`);
    }

    return transformer;
}

/**
 * Check if vendor is supported
 * @param {string} vendorId - Vendor identifier
 * @returns {boolean} True if vendor is supported
 */
export function isVendorSupported(vendorId) {
    return vendorId in vendorRegistry;
}

/**
 * Get default vendor
 * @returns {string} Default vendor ID
 */
export function getDefaultVendor() {
    return 'AGNE';
}

export default {
    getAvailableVendors,
    getVendorTransformer,
    isVendorSupported,
    getDefaultVendor
};
