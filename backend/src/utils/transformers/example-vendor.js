/**
 * EXAMPLE VENDOR - Simple Transformation
 * This is a template/example showing how to create a new vendor transformer
 * 
 * To activate this vendor:
 * 1. Uncomment this file
 * 2. Register it in vendorRegistry.js
 * 3. Restart backend
 */

import { getColumnValue, transformUPC, parseNumeric, normalizeDate } from './helpers.js';

/**
 * Example Vendor Configuration
 */
export const exampleVendorConfig = {
    vendorId: 'EXAMPLE',
    vendorName: 'Example Vendor',
    description: 'Simple example transformation - keeps basic columns only',
    supportedFormats: ['csv', 'xlsx'],

    transformationRules: {
        columnsRemoved: [
            'All columns except Item, UPC, Description, Price, Quantity'
        ],
        transformations: [
            'UPC: Remove one leading zero',
            'Price: Parse numeric values',
            'Date: Normalize to YYYYMMDD format',
            'Calculate: Total = Price × Quantity'
        ]
    }
};

/**
 * Transform row according to Example Vendor rules
 * @param {Object} row - Input row
 * @param {Object} depositMapping - Deposit mapping (not used in this example)
 * @param {Object} options - Transformation options
 * @returns {{transformedRow: Object, warnings: string[]}}
 */
export function transformRow(row, depositMapping = {}, options = {}) {
    const warnings = [];
    const transformedRow = {};

    // Helper to get value case-insensitively
    const getValue = (name) => getColumnValue(row, name);

    // 1. Item - Keep as is
    transformedRow.Item = getValue('Item') || getValue('ItemCode') || '';
    if (!transformedRow.Item) {
        warnings.push('Missing Item/ItemCode');
    }

    // 2. UPC - Transform (remove leading zero)
    const upc = getValue('UPC') || getValue('Barcode');
    transformedRow.UPC = transformUPC(upc);

    // 3. Description - Keep as is
    transformedRow.Description = getValue('Description') || getValue('Name') || '';

    // 4. Price - Parse numeric
    const priceValue = getValue('Price') || getValue('UnitPrice') || getValue('Cost');
    const price = parseNumeric(priceValue);
    transformedRow.Price = price !== null ? price.toFixed(2) : '';

    // 5. Quantity - Parse numeric
    const qtyValue = getValue('Quantity') || getValue('Qty') || getValue('Stock');
    const quantity = parseNumeric(qtyValue);
    transformedRow.Quantity = quantity !== null ? quantity.toString() : '1';

    // 6. Total - Calculate (Price × Quantity)
    if (price !== null && quantity !== null) {
        transformedRow.Total = (price * quantity).toFixed(2);
    } else {
        transformedRow.Total = '';
        if (price === null) warnings.push(`Invalid price for item: ${transformedRow.Item}`);
        if (quantity === null) warnings.push(`Invalid quantity for item: ${transformedRow.Item}`);
    }

    // 7. Date - Normalize if present
    const dateValue = getValue('Date') || getValue('EffectiveDate');
    if (dateValue) {
        const dateResult = normalizeDate(dateValue);
        transformedRow.EffectiveDate = dateResult.value;
        if (dateResult.warning) warnings.push(dateResult.warning);
    } else {
        transformedRow.EffectiveDate = '';
    }

    // 8. Category - Keep as is (optional field)
    transformedRow.Category = getValue('Category') || getValue('Department') || '';

    return { transformedRow, warnings };
}

/**
 * Get output column order for Example Vendor
 * @returns {string[]} - Ordered column names
 */
export function getOutputColumns() {
    return [
        'Item',
        'UPC',
        'Description',
        'Price',
        'Quantity',
        'Total',
        'EffectiveDate',
        'Category'
    ];
}

/**
 * USAGE INSTRUCTIONS:
 * 
 * 1. To activate this vendor, register it in vendorRegistry.js:
 * 
 *    import * as exampleVendorTransformer from './example-vendor.js';
 * 
 *    const vendorRegistry = {
 *      AGNE: agneTransformer,
 *      EXAMPLE: exampleVendorTransformer,  // Add this line
 *    };
 * 
 * 2. Restart the backend server:
 *    cd backend
 *    npm run dev
 * 
 * 3. The "Example Vendor" will now appear in the frontend dropdown!
 * 
 * 4. Test with a CSV file containing columns like:
 *    Item, UPC, Description, Price, Quantity, Date, Category
 * 
 * 5. Expected output will have columns:
 *    Item, UPC, Description, Price, Quantity, Total, EffectiveDate, Category
 * 
 * CUSTOMIZATION:
 * 
 * - Modify transformRow() to add your own transformation logic
 * - Update getOutputColumns() to change output column order
 * - Add more helper functions from helpers.js as needed
 * - Update config to reflect your transformation rules
 * 
 * EXAMPLE INPUT CSV:
 * Item,UPC,Description,Price,Quantity,Date,Category
 * 12345,0123456789,Widget A,$19.99,5,12/25/2023,Widgets
 * 67890,0987654321,Gadget B,$29.99,3,01/15/2024,Gadgets
 * 
 * EXAMPLE OUTPUT CSV:
 * Item,UPC,Description,Price,Quantity,Total,EffectiveDate,Category
 * 12345,123456789,Widget A,19.99,5,99.95,20231225,Widgets
 * 67890,987654321,Gadget B,29.99,3,89.97,20240115,Gadgets
 */
