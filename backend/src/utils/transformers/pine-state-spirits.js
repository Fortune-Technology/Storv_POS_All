/**
 * Pine State Spirits - Monthly Specials Transformation
 * Vendor-specific transformation rules for Pine State Spirits monthly specials data
 */

import {
    getColumnValue,
    parseNumeric
} from './helpers.js';

/**
 * Pine State Spirits Vendor Configuration
 */
export const pineStateSpiritConfig = {
    vendorId: 'PINE_STATE_SPIRITS',
    vendorName: 'Pine State Spirits – Monthly Specials',
    description: 'Pine State Spirits monthly specials transformation with UPC padding and price formatting',
    supportedFormats: ['csv', 'xlsx', 'xls'],

    transformationRules: {
        columnsRemoved: [
            'Proof',
            'Retail Savings',
            'Agency Savings'
        ],
        columnsKept: [
            'Item #',
            'Description',
            'Size',
            'Unit'
        ],
        transformations: [
            'UPC: Ensure 13 digits with leading zero padding',
            'Effective Start/End: Convert to DD-MM-YYYY format',
            'Retail: Convert to numeric with 2 decimal places',
            'Sale Price: Convert to numeric with 2 decimal places',
            'Agency Cost: Convert to numeric with 2 decimal places',
            'Agency Sale Cost: Convert to numeric with 2 decimal places',
            'Special Pricing Method: Always set to "0"'
        ]
    }
};

/**
 * Pad UPC to ensure it's 13 digits
 * @param {string|number} upc - UPC code
 * @returns {string} - 13-digit UPC with leading zeros if needed
 */
function padUPC(upc) {
    if (upc === null || upc === undefined || upc === '') return '';

    let upcStr = String(upc).trim();

    // Handle scientific notation (e.g. "8.52E+11")
    if (/e/i.test(upcStr)) {
        const num = parseFloat(upcStr);
        if (!isNaN(num)) {
            // Convert to string without scientific notation
            upcStr = num.toLocaleString('fullwide', { useGrouping: false });
        }
    }

    // Remove non-digits
    upcStr = upcStr.replace(/\D/g, '');

    if (upcStr.length === 0) return '';

    // If already 13 digits or more, return as is
    if (upcStr.length >= 13) {
        return upcStr;
    }

    // Pad with leading zeros to make it 13 digits
    return upcStr.padStart(13, '0');
}

/**
 * Format date to DD-MM-YYYY
 * @param {string} dateStr - Date string in various formats
 * @returns {{value: string, warning: string|null}}
 */
function formatDateDDMMYYYY(dateStr) {
    if (dateStr === null || dateStr === undefined) return { value: '', warning: null };
    const s = String(dateStr).trim();

    if (s === '') return { value: '', warning: null };

    // normalize common noise (remove quotes, trim)
    const raw = s.replace(/^['"]|['"]$/g, '').trim();

    // helpers
    const toFourDigitYear = (yy) => {
        const n = parseInt(yy, 10);
        if (Number.isNaN(n)) return null;
        return (n < 50) ? `20${String(n).padStart(2, '0')}` : `19${String(n).padStart(2, '0')}`;
    };

    const pad2 = (v) => String(v).padStart(2, '0');

    // Try explicit formats in safe order:
    // 1) YYYYMMDD (compact)
    let m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) {
        const [, y, mo, d] = m;
        return { value: `${pad2(d)}-${pad2(mo)}-${y}`, warning: null };
    }

    // 2) YYYY-MM-DD
    m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
        const [, y, mo, d] = m;
        return { value: `${pad2(d)}-${pad2(mo)}-${y}`, warning: null };
    }

    // 3) DD-MM-YYYY or D-M-YYYY
    m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (m) {
        const [, d, mo, y] = m;
        return { value: `${pad2(d)}-${pad2(mo)}-${y}`, warning: null };
    }

    // 4) DD/MM/YYYY or D/M/YYYY
    m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
        const [, d, mo, y] = m;
        return { value: `${pad2(d)}-${pad2(mo)}-${y}`, warning: null };
    }

    // 5) DD-MM-YY or D-M-YY  (two-digit year) -> DMY
    m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
    if (m) {
        const [, d, mo, yy] = m;
        const y = toFourDigitYear(yy);
        if (!y) return { value: '', warning: `Could not parse date: "${raw}"` };
        return { value: `${pad2(d)}-${pad2(mo)}-${y}`, warning: null };
    }

    // 6) MM/DD/YYYY or M/D/YYYY  -> MDY
    m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
        const [, mo, d, y] = m;
        return { value: `${pad2(d)}-${pad2(mo)}-${y}`, warning: null };
    }

    // 7) MM/DD/YY or M/D/YY  -> MDY with 2-digit year
    m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (m) {
        const [, mo, d, yy] = m;
        const y = toFourDigitYear(yy);
        if (!y) return { value: '', warning: `Could not parse date: "${raw}"` };
        return { value: `${pad2(d)}-${pad2(mo)}-${y}`, warning: null };
    }

    // If nothing matched, fail gracefully
    return { value: '', warning: `Could not parse date: "${raw}"` };
}


/**
 * Format numeric value to 2 decimal places
 * @param {string|number} value - Numeric value
 * @returns {string} - Formatted value with 2 decimal places
 */
function formatPrice(value) {
    if (!value && value !== 0) return '';

    const numeric = parseNumeric(value);
    if (numeric === null) return '';

    return numeric.toFixed(2);
}

/**
 * Transform row according to Pine State Spirits rules
 * @param {Object} row - Input row
 * @param {Object} depositMapping - Deposit mapping (not used for this vendor)
 * @param {Object} options - Transformation options
 * @returns {{transformedRow: Object, warnings: string[]}}
 */
export function transformRow(row, depositMapping = {}, options = {}) {
    const warnings = [];
    const transformedRow = {};

    // Helper to get value case-insensitively
    const getValue = (name) => getColumnValue(row, name);

    // 0. Vendor ID - Add hardcoded value ('9')
    transformedRow['Vendor ID'] = '9';

    // 1. Item # - Keep as is
    // 1. Item # - Preserve leading zeros if present; if numeric, pad to 6 digits
    (function setItemNumber() {
        const rawItem =
            getValue('Item #') ||
            getValue('Item') ||
            getValue('ItemNumber') ||
            getValue('Item No') ||
            getValue('ItemNo') ||
            '';

        // If missing, set empty
        if (rawItem === null || rawItem === undefined || String(rawItem).trim() === '') {
            transformedRow['Product Code'] = '';
            return;
        }

        const itemStr = String(rawItem).trim();

        // If it is pure digits, pad to 6 digits (preserve existing leading zeros)
        if (/^\d+$/.test(itemStr)) {
            transformedRow['Product Code'] = itemStr.padStart(6, '0');
        } else {
            // Non-numeric item codes: preserve exactly as-is (trimmed)
            transformedRow['Product Code'] = itemStr;
        }
    })();

    // 2. Description - Keep as is
    transformedRow['Description'] = getValue('Description') || getValue('Desc') || '';

    // 3. Size - Keep as is
    transformedRow['Size'] = getValue('Size') || '';

    // 4. Unit - REMOVED (Ignored per requirements)
    // transformedRow['Unit'] = getValue('Unit') || getValue('UOM') || '';

    // 5. UPC - Ensure 13 digits with leading zero padding (map multiple column names)
    (function setUPC() {
        const upcRaw =
            getValue('UPC') ||
            getValue('UPC Code') ||
            getValue('UPC#') ||
            getValue('Code') ||
            getValue('Barcode') ||
            getValue('Bar Code') ||
            getValue('EAN') ||
            getValue('GTIN') ||
            getValue('Upc') ||
            '';

        transformedRow['UPC'] = padUPC(upcRaw);

        if (!upcRaw || String(upcRaw).trim() === '') {
            // optional: warn only if you want to log missing UPCs
            // warnings.push(`Missing UPC for item: ${transformedRow['Product Code']}`);
        } else {
            // If padUPC returned empty string, push a warning
            if (!transformedRow['UPC']) {
                warnings.push(`Could not normalize UPC for item: ${transformedRow['Product Code']} (original: "${upcRaw}")`);
            }
        }
    })();

    // 6. Proof - Remove (skip)

    // 7. Effective Start - Convert to DD-MM-YYYY
    const effectiveStart = getValue('Effective Start') || getValue('EffectiveStart') || getValue('Start Date');
    const startResult = formatDateDDMMYYYY(effectiveStart);
    transformedRow['Start Date'] = startResult.value;
    if (startResult.warning) warnings.push(startResult.warning);

    // 8. Effective End - Convert to DD-MM-YYYY
    const effectiveEnd = getValue('Effective End') || getValue('EffectiveEnd') || getValue('End Date');
    const endResult = formatDateDDMMYYYY(effectiveEnd);
    transformedRow['End Date'] = endResult.value;
    if (endResult.warning) warnings.push(endResult.warning);

    // 9. Retail - Convert to numeric with 2 decimal places
    const retail = getValue('Retail') || getValue('Retail Price');
    transformedRow['Price'] = formatPrice(retail);
    if (!transformedRow['Price'] && retail) {
        warnings.push(`Invalid retail price for item: ${transformedRow['Product Code']}`);
    }

    // 10. Special Pricing Method - Always "0"
    transformedRow['Special Price Method'] = '0';

    // 11. Sale Price - Convert to numeric with 2 decimal places
    const salePrice = getValue('Sale Price') || getValue('SalePrice') || getValue('Special Price');
    transformedRow['Special Price'] = formatPrice(salePrice);
    if (!transformedRow['Special Price'] && salePrice) {
        warnings.push(`Invalid sale price for item: ${transformedRow['Product Code']}`);
    }

    // 12. Retail Savings - Remove (skip)

    // 13. Agency Cost - Convert to numeric with 2 decimal places
    const agencyCost = getValue('Agency Cost') || getValue('AgencyCost') || getValue('Cost');
    transformedRow['Cost'] = formatPrice(agencyCost);
    if (!transformedRow['Cost'] && agencyCost) {
        warnings.push(`Invalid agency cost for item: ${transformedRow['Product Code']}`);
    }

    // 14. Agency Sale Cost - Convert to numeric with 2 decimal places
    const agencySaleCost = getValue('Agency Sale Cost') || getValue('AgencySaleCost') || getValue('Sale Cost');
    transformedRow['Special Cost'] = formatPrice(agencySaleCost);
    if (!transformedRow['Special Cost'] && agencySaleCost) {
        warnings.push(`Invalid agency sale cost for item: ${transformedRow['Product Code']}`);
    }

    // 15. Agency Savings - Remove (skip)

    return { transformedRow, warnings };
}

/**
 * Get output column order for Pine State Spirits
 * @returns {string[]} - Ordered column names
 */
export function getOutputColumns() {
    return [
        'Vendor ID',
        'Product Code',
        'Description',
        'Size',
        // 'Unit', Removed
        'UPC',
        'Start Date',
        'End Date',
        'Price',
        'Special Price Method',
        'Special Price',
        'Cost',
        'Special Cost'
    ];
}
