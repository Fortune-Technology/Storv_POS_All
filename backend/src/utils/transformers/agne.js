/**
 * AGNE Vendor Transformation Rules
 * Current transformation logic for AGNE CSV format
 */

import {
    transformUPC,
    transformTAX1,
    preserveDepartmentID,
    parseNumeric,
    normalizeDate,
    getColumnValue
} from './helpers.js';

/**
 * AGNE Vendor Configuration
 */
export const agneConfig = {
    vendorId: 'AGNE',
    vendorName: 'AGNE',
    description: 'Standard AGNE CSV transformation with special pricing logic',
    supportedFormats: ['csv', 'xlsx', 'xls'],

    transformationRules: {
        columnsRemoved: [
            'Status', 'CaseUPC', 'MANUFACTURER', 'REG_MULTIPLE',
            'CASE_RETAIL', 'TAX2', 'TAX3', 'CASE_DEPOSIT',
            'PRC_GRP', 'FUTURE_*', 'BRAND', 'PBHN', 'CLASS',
            'SALE_MULTIPLE', 'TPR_MULTIPLE'
        ],
        transformations: [
            'UPC: Remove one leading zero',
            'TAX1: Y→1, N→empty',
            'Dates: Normalized to YYYYMMDD',
            'SALE/TPR: Special pricing logic with quantity',
            'BOTTLE_DEPOSIT: Mapped from deposit file'
        ]
    }
};

/**
 * Transform row according to AGNE rules
 * @param {Object} row - Input row
 * @param {Object} depositMapping - Deposit mapping (UPC/Item -> DepositID)
 * @param {Object} options - Transformation options
 * @returns {{transformedRow: Object, warnings: string[]}}
 */
export function transformRow(row, depositMapping = {}, options = {}) {
    const warnings = [];
    const transformedRow = {};

    // Helper to get value case-insensitively
    const getValue = (name) => getColumnValue(row, name);

    // 1. Status - Remove (skip)

    // 2. Item - Keep
    transformedRow['Vendor ID'] = '3';
    transformedRow['Product Code'] = getValue('Item') || '';

    // 3. UPC - Remove one leading zero
    const upc = getValue('UPC');
    transformedRow.UPC = transformUPC(upc);

    // 4. CaseUPC - Remove (skip)

    // 5. Description - Keep
    transformedRow.Description = getValue('Description') || '';

    // 6. Department - Keep (with preservation logic)
    const deptResult = preserveDepartmentID(
        getValue('Department'),
        options.originalData?.[transformedRow['Product Code']]?.Department
    );
    transformedRow['Department ID'] = deptResult.value;
    if (deptResult.warning) warnings.push(deptResult.warning);

    // 7. MANUFACTURER - Remove (skip)
    // 8. REG_MULTIPLE - Remove (skip)

    // 9. REG_RETAIL - Keep
    transformedRow.Price = getValue('REG_RETAIL') || '';

    // 10. CASE_RETAIL - Remove (skip)

    // 11. PACK - Keep
    transformedRow.Pack = getValue('PACK') || '';

    // 12. REGULARCOST - Keep
    transformedRow.Cost = getValue('REGULARCOST') || '';

    // 13. TAX1 - Transform
    const tax1Result = transformTAX1(getValue('TAX1'));
    transformedRow['Tax ID'] = tax1Result.value;
    if (tax1Result.warning) warnings.push(tax1Result.warning);

    // 14. TAX2 - Remove (skip)
    // 15. TAX3 - Remove (skip)

    // 16. FOOD_STAMP - Keep
    transformedRow['Foodstamp Eligible'] = getValue('FOOD_STAMP') || '';

    // 17. WIC - Keep
    transformedRow['WIC Eligible'] = getValue('WIC') || '';

    // 18. BOTTLE_DEPOSIT - Map from deposit mapping
    const existingDeposit = getValue('BOTTLE_DEPOSIT');

    if (existingDeposit && depositMapping) {
        if (depositMapping[existingDeposit]) {
            transformedRow['Fee ID'] = depositMapping[existingDeposit];
        } else {
            const normalizedDeposit = parseNumeric(existingDeposit);
            if (normalizedDeposit !== null && depositMapping[normalizedDeposit.toString()]) {
                transformedRow['Fee ID'] = depositMapping[normalizedDeposit.toString()];
            } else {
                const itemKey = transformedRow.UPC || transformedRow['Product Code'];
                if (depositMapping[itemKey]) {
                    transformedRow['Fee ID'] = depositMapping[itemKey];
                } else {
                    transformedRow['Fee ID'] = existingDeposit;
                }
            }
        }
    } else {
        const itemKey = transformedRow.UPC || transformedRow['Product Code'];
        if (depositMapping && depositMapping[itemKey]) {
            transformedRow['Fee ID'] = depositMapping[itemKey];
        } else {
            transformedRow['Fee ID'] = '';
            if (itemKey) {
                warnings.push(`No deposit mapping found for UPC/Item: ${itemKey}`);
            }
        }
    }

    // 19. CASE_DEPOSIT - Remove (skip)
    // 20. PRC_GRP - Remove (skip)

    // 21. SALE_MULTIPLE and SPECIAL QUANTITY - Special logic
    const saleMultiple = parseNumeric(getValue('SALE_MULTIPLE'));
    const saleRetail = getValue('SALE_RETAIL');
    const regRetail = getValue('REG_RETAIL');

    transformedRow['Special Group Price'] = '';

    const hasSaleData = saleRetail || getValue('SALE_COST') ||
        getValue('SALE_START_DATE') || getValue('SALE_END_DATE') ||
        (saleMultiple !== null && saleMultiple > 0);

    if (hasSaleData) {
        if (saleMultiple !== null && saleMultiple > 1) {
            transformedRow['Special Group Price'] = saleRetail || '';
            transformedRow['Special Price'] = regRetail || '';
            transformedRow['Special Price Method'] = '2';
            transformedRow['Special Quantity'] = getValue('SALE_MULTIPLE') || '';
        } else {
            transformedRow['Special Price'] = saleRetail || '';
            transformedRow['Special Price Method'] = '0';
            transformedRow['Special Quantity'] = '';
        }
    } else {
        transformedRow['Special Price'] = '';
        transformedRow['Special Price Method'] = '';
        transformedRow['Special Quantity'] = '';
    }

    // 22. SALE_COST - Keep
    transformedRow['Special Cost'] = getValue('SALE_COST') || '';

    // 23. SALE_START_DATE - Keep and normalize
    const saleStartResult = normalizeDate(getValue('SALE_START_DATE'));
    transformedRow['Start Date'] = saleStartResult.value;
    if (saleStartResult.warning) warnings.push(saleStartResult.warning);

    // 24. SALE_END_DATE - Keep and normalize
    const saleEndResult = normalizeDate(getValue('SALE_END_DATE'));
    transformedRow['End Date'] = saleEndResult.value;
    if (saleEndResult.warning) warnings.push(saleEndResult.warning);

    // 25. TPR_MULTIPLE and SPECIAL QUANTITY - Special logic
    const tprMultiple = parseNumeric(getValue('TPR_MULTIPLE') || getValue('TRP_MULTIPLE'));
    const tprRetail = getValue('TPR_RETAIL') || getValue('TRP_RETAIL');

    transformedRow['Special Group Price #2'] = '';

    const hasTprData = tprRetail || getValue('TPR_COST') || getValue('TRP_COST') ||
        getValue('TPR_START_DATE') || getValue('TRP_START_DATE') ||
        getValue('TPR_END_DATE') || getValue('TRP_END_DATE') ||
        (tprMultiple !== null && tprMultiple > 0);

    if (hasTprData) {
        if (tprMultiple !== null && tprMultiple > 1) {
            transformedRow['Special Group Price #2'] = tprRetail || '';
            transformedRow['Special Price #2'] = regRetail || '';
            transformedRow['Special Price Method #2'] = '2';
            transformedRow['Special Quantity #2'] = getValue('TPR_MULTIPLE') || getValue('TRP_MULTIPLE') || '';
        } else {
            transformedRow['Special Price #2'] = tprRetail || '';
            transformedRow['Special Price Method #2'] = '0';
            transformedRow['Special Quantity #2'] = '';
        }
    } else {
        transformedRow['Special Price #2'] = '';
        transformedRow['Special Price Method #2'] = '';
        transformedRow['Special Quantity #2'] = '';
    }

    // 26. TPR_COST - Keep
    transformedRow['Special Cost #2'] = getValue('TPR_COST') || getValue('TRP_COST') || '';

    // 27. TPR_START_DATE - Keep and normalize
    const tprStartResult = normalizeDate(getValue('TPR_START_DATE') || getValue('TRP_START_DATE'));
    transformedRow['Start Date #2'] = tprStartResult.value;
    if (tprStartResult.warning) warnings.push(tprStartResult.warning);

    // 28. TPR_END_DATE - Keep and normalize
    const tprEndResult = normalizeDate(getValue('TPR_END_DATE') || getValue('TRP_END_DATE'));
    transformedRow['End Date #2'] = tprEndResult.value;
    if (tprEndResult.warning) warnings.push(tprEndResult.warning);

    // 29-32. FUTURE_* - Remove (skip)
    // 33. BRAND - Remove (skip)

    // 34. ITEM_SIZE - Keep
    transformedRow.Size = getValue('ITEM_SIZE') || '';

    // 35. ITEM_UOM - IGNORE COLUMN

    // 36. PBHN - Remove (skip)
    // 37. CLASS - Remove (skip)

    return { transformedRow, warnings };
}

/**
 * Get output column order for AGNE
 * @returns {string[]} - Ordered column names
 */
export function getOutputColumns() {
    return [
        // Core item information
        'Vendor ID',
        'Product Code',
        'UPC',
        'Description',
        'Department ID',
        'Price',
        'Pack',
        'Cost',
        'Tax ID',
        'Foodstamp Eligible',
        'WIC Eligible',
        'Fee ID',

        // SALE section
        'Special Price Method',
        'Special Price',
        'Special Quantity',
        'Special Group Price',
        'Start Date',
        'End Date',
        'Special Cost',

        // TPR section
        'Special Price Method #2',
        'Special Price #2',
        'Special Quantity #2',
        'Special Group Price #2',
        'Start Date #2',
        'End Date #2',
        'Special Cost #2',

        // Item details
        'Size'
        // 'ITEM_UOM' Removed
    ];
}
