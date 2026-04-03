/**
 * Unit tests for transformation logic
 */

import {
    transformUPC,
    transformTAX1,
    parseNumeric,
    normalizeDate,
    transformRow,
    getOutputColumns,
    preserveDepartmentID
} from '../src/utils/transformer.js';


describe('transformUPC', () => {
    test('removes one leading zero', () => {
        expect(transformUPC('012345')).toBe('12345');
    });

    test('removes only one leading zero from multiple zeros', () => {
        expect(transformUPC('00012345')).toBe('0012345');
    });

    test('leaves UPC without leading zero unchanged', () => {
        expect(transformUPC('12345')).toBe('12345');
    });

    test('handles empty UPC', () => {
        expect(transformUPC('')).toBe('');
        expect(transformUPC(null)).toBe(null);
        expect(transformUPC(undefined)).toBe(undefined);
    });

    test('handles numeric UPC', () => {
        expect(transformUPC(12345)).toBe('12345');
    });
});

describe('transformTAX1', () => {
    test('converts Y to 1', () => {
        expect(transformTAX1('Y')).toEqual({ value: '1', warning: null });
    });

    test('converts y to 1 (case insensitive)', () => {
        expect(transformTAX1('y')).toEqual({ value: '1', warning: null });
    });

    test('converts N to empty', () => {
        expect(transformTAX1('N')).toEqual({ value: '', warning: null });
    });

    test('converts n to empty (case insensitive)', () => {
        expect(transformTAX1('n')).toEqual({ value: '', warning: null });
    });

    test('preserves unexpected values with warning', () => {
        const result = transformTAX1('X');
        expect(result.value).toBe('X');
        expect(result.warning).toContain('unexpected value');
    });

    test('handles empty value', () => {
        expect(transformTAX1('')).toEqual({ value: '', warning: null });
    });
});

describe('parseNumeric', () => {
    test('parses simple number', () => {
        expect(parseNumeric('123.45')).toBe(123.45);
    });

    test('parses currency with dollar sign', () => {
        expect(parseNumeric('$123.45')).toBe(123.45);
    });

    test('parses negative number', () => {
        expect(parseNumeric('-123.45')).toBe(-123.45);
    });

    test('handles empty value', () => {
        expect(parseNumeric('')).toBe(null);
        expect(parseNumeric(null)).toBe(null);
        expect(parseNumeric(undefined)).toBe(null);
    });

    test('handles numeric input', () => {
        expect(parseNumeric(123.45)).toBe(123.45);
    });
});

describe('normalizeDate', () => {
    test('normalizes YYYY-MM-DD format', () => {
        expect(normalizeDate('2025-11-01')).toEqual({
            value: '2025-11-01',
            warning: null
        });
    });

    test('normalizes YYYYMMDD format (compact)', () => {
        expect(normalizeDate('20251129')).toEqual({
            value: '2025-11-29',
            warning: null
        });
    });

    test('normalizes MM/DD/YYYY format', () => {
        expect(normalizeDate('11/01/2025')).toEqual({
            value: '2025-11-01',
            warning: null
        });
    });

    test('normalizes DD-MM-YYYY format', () => {
        expect(normalizeDate('01-11-2025')).toEqual({
            value: '2025-11-01',
            warning: null
        });
    });

    test('pads single digit month and day', () => {
        expect(normalizeDate('2025-1-5')).toEqual({
            value: '2025-01-05',
            warning: null
        });
    });

    test('handles invalid date with warning', () => {
        const result = normalizeDate('invalid');
        expect(result.value).toBe('');
        expect(result.warning).toContain('Could not parse date');
    });

    test('handles empty date', () => {
        expect(normalizeDate('')).toEqual({ value: '', warning: null });
    });
});

describe('transformRow', () => {
    test('transforms basic row correctly', () => {
        const inputRow = {
            Status: 'Active',
            Item: 'Chips',
            UPC: '012345',
            CaseUPC: '000012',
            Description: 'Potato chips',
            Department: 'Snacks',
            REG_RETAIL: '2.99',
            PACK: '1',
            REGULARCOST: '0.8',
            TAX1: 'Y',
            SALE_MULTIPLE: '1',
            SALE_RETAIL: '1.99',
            SALE_COST: '0.7',
            SALE_START_DATE: '2025-11-01',
            SALE_END_DATE: '2025-11-10',
            TPR_MULTIPLE: '1',
            TPR_RETAIL: '2.49',
            ITEM_SIZE: '100g',
            ITEM_UOM: 'bag'
        };

        const { transformedRow, warnings } = transformRow(inputRow);

        expect(transformedRow.Item).toBe('Chips');
        expect(transformedRow.UPC).toBe('12345'); // Leading zero removed
        expect(transformedRow.Description).toBe('Potato chips');
        expect(transformedRow.Department).toBe('Snacks');
        expect(transformedRow.REG_RETAIL).toBe('2.99');
        expect(transformedRow.TAX1).toBe('1'); // Y -> 1
        expect(transformedRow['SPECIAL PRICING #1']).toBe('0'); // SALE_MULTIPLE <= 1
        expect(transformedRow['SPECIAL PRICING #2']).toBe('0'); // TPR_MULTIPLE <= 1
    });

    test('handles SALE_MULTIPLE > 1', () => {
        const inputRow = {
            Item: 'Chips',
            UPC: '12345',
            Description: 'Potato chips',
            Department: 'Snacks',
            REG_RETAIL: '2.99',
            PACK: '1',
            REGULARCOST: '0.8',
            TAX1: 'N',
            SALE_MULTIPLE: '2',
            SALE_RETAIL: '1.99',
            SALE_COST: '0.7',
            SALE_START_DATE: '2025-11-01',
            SALE_END_DATE: '2025-11-10',
            TPR_MULTIPLE: '1',
            TPR_RETAIL: '2.49',
            ITEM_SIZE: '100g',
            ITEM_UOM: 'bag'
        };

        const { transformedRow } = transformRow(inputRow);

        expect(transformedRow.SALE_GROUP).toBe('1.99'); // Original SALE_RETAIL
        expect(transformedRow.SALE_RETAIL).toBe('2.99'); // Changed to REG_RETAIL
        expect(transformedRow['SPECIAL PRICING #1']).toBe('2');
    });

    test('handles TPR_MULTIPLE > 1', () => {
        const inputRow = {
            Item: 'Chips',
            UPC: '12345',
            Description: 'Potato chips',
            Department: 'Snacks',
            REG_RETAIL: '2.99',
            PACK: '1',
            REGULARCOST: '0.8',
            TAX1: 'N',
            SALE_MULTIPLE: '1',
            SALE_RETAIL: '1.99',
            TPR_MULTIPLE: '3',
            TPR_RETAIL: '2.49',
            ITEM_SIZE: '100g',
            ITEM_UOM: 'bag'
        };

        const { transformedRow } = transformRow(inputRow);

        expect(transformedRow.TRP_GROUP).toBe('2.49'); // Original TPR_RETAIL
        expect(transformedRow.TPR_RETAIL).toBe('2.99'); // Changed to REG_RETAIL
        expect(transformedRow['SPECIAL PRICING #2']).toBe('2');
    });

    test('handles deposit mapping', () => {
        const inputRow = {
            Item: 'Soda',
            UPC: '54321',
            Description: 'Cola',
            Department: 'Beverages',
            REG_RETAIL: '1.99'
        };

        const depositMapping = {
            '54321': 'DEP-001'
        };

        const { transformedRow, warnings } = transformRow(inputRow, depositMapping);

        expect(transformedRow.BOTTLE_DEPOSIT).toBe('DEP-001');
    });

    test('warns when deposit mapping not found', () => {
        const inputRow = {
            Item: 'Soda',
            UPC: '54321',
            Description: 'Cola',
            Department: 'Beverages',
            REG_RETAIL: '1.99'
        };

        const { transformedRow, warnings } = transformRow(inputRow, {});

        expect(transformedRow.BOTTLE_DEPOSIT).toBe('');
        expect(warnings.some(w => w.includes('No deposit mapping'))).toBe(true);
    });

    test('replaces deposit amount with ID from mapping', () => {
        const inputRow = {
            Item: 'Beer 6pk',
            UPC: '11111',
            Description: 'Beer 6 pack',
            Department: 'Beverages',
            REG_RETAIL: '9.99',
            BOTTLE_DEPOSIT: '0.3'
        };

        const depositMapping = {
            '0.3': '26'  // Amount -> ID mapping
        };

        const { transformedRow, warnings } = transformRow(inputRow, depositMapping);

        expect(transformedRow.BOTTLE_DEPOSIT).toBe('26');
        expect(warnings.length).toBe(0);
    });

    test('replaces deposit amount with ID using normalized amount', () => {
        const inputRow = {
            Item: 'Beer 12pk',
            UPC: '22222',
            Description: 'Beer 12 pack',
            Department: 'Beverages',
            REG_RETAIL: '15.99',
            BOTTLE_DEPOSIT: '0.60'
        };

        const depositMapping = {
            '0.6': '27'  // Normalized amount -> ID mapping
        };

        const { transformedRow, warnings } = transformRow(inputRow, depositMapping);

        expect(transformedRow.BOTTLE_DEPOSIT).toBe('27');
        expect(warnings.length).toBe(0);
    });

    test('keeps existing deposit amount when no mapping found', () => {
        const inputRow = {
            Item: 'Beer 6pk',
            UPC: '11111',
            Description: 'Beer 6 pack',
            Department: 'Beverages',
            REG_RETAIL: '9.99',
            BOTTLE_DEPOSIT: '0.3'
        };

        const depositMapping = {
            '0.5': '34'  // Different amount
        };

        const { transformedRow, warnings } = transformRow(inputRow, depositMapping);

        expect(transformedRow.BOTTLE_DEPOSIT).toBe('0.3');  // Keeps original
        expect(warnings.length).toBe(0);
    });

    test('uses UPC mapping when no deposit amount in row', () => {
        const inputRow = {
            Item: 'Beer 6pk',
            UPC: '11111',
            Description: 'Beer 6 pack',
            Department: 'Beverages',
            REG_RETAIL: '9.99'
        };

        const depositMapping = {
            '11111': '26'  // UPC -> ID mapping
        };

        const { transformedRow, warnings } = transformRow(inputRow, depositMapping);

        expect(transformedRow.BOTTLE_DEPOSIT).toBe('26');
        expect(warnings.length).toBe(0);
    });

    test('handles case-insensitive column names', () => {
        const inputRow = {
            item: 'Chips',
            upc: '012345',
            description: 'Potato chips',
            department: 'Snacks',
            reg_retail: '2.99'
        };

        const { transformedRow } = transformRow(inputRow);

        expect(transformedRow.Item).toBe('Chips');
        expect(transformedRow.UPC).toBe('12345');
        expect(transformedRow.Description).toBe('Potato chips');
    });

    test('handles rows with no SALE data - SPECIAL PRICING #1 should be null', () => {
        const inputRow = {
            Item: 'Chips',
            UPC: '012345',
            Description: 'Potato chips',
            Department: 'Snacks',
            REG_RETAIL: '2.99',
            PACK: '1',
            REGULARCOST: '0.8',
            TAX1: 'Y',
            // No SALE fields
            TPR_MULTIPLE: '1',
            TPR_RETAIL: '2.49',
            ITEM_SIZE: '100g',
            ITEM_UOM: 'bag'
        };

        const { transformedRow } = transformRow(inputRow);

        expect(transformedRow['SPECIAL PRICING #1']).toBe('');
        expect(transformedRow.SALE_RETAIL).toBe('');
    });

    test('handles rows with no TPR data - SPECIAL PRICING #2 should be null', () => {
        const inputRow = {
            Item: 'Chips',
            UPC: '012345',
            Description: 'Potato chips',
            Department: 'Snacks',
            REG_RETAIL: '2.99',
            PACK: '1',
            REGULARCOST: '0.8',
            TAX1: 'Y',
            SALE_MULTIPLE: '1',
            SALE_RETAIL: '1.99',
            // No TPR fields
            ITEM_SIZE: '100g',
            ITEM_UOM: 'bag'
        };

        const { transformedRow } = transformRow(inputRow);

        expect(transformedRow['SPECIAL PRICING #2']).toBe('');
        expect(transformedRow.TPR_RETAIL).toBe('');
    });

    test('preserves Department ID when original data is provided', () => {
        const inputRow = {
            Item: 'Chips',
            UPC: '012345',
            Description: 'Potato chips',
            Department: 'Beverages', // Changed from original
            REG_RETAIL: '2.99'
        };

        const options = {
            originalData: {
                'Chips': {
                    Department: 'Snacks' // Original value
                }
            }
        };

        const { transformedRow, warnings } = transformRow(inputRow, {}, options);

        expect(transformedRow.Department).toBe('Snacks'); // Should use original
        expect(warnings.some(w => w.includes('Department ID changed'))).toBe(true);
    });
});

describe('preserveDepartmentID', () => {
    test('preserves original department when values differ', () => {
        const result = preserveDepartmentID('Beverages', 'Snacks');

        expect(result.value).toBe('Snacks');
        expect(result.warning).toContain('Department ID changed');
        expect(result.warning).toContain('Snacks');
        expect(result.warning).toContain('Beverages');
    });

    test('uses incoming value when no original provided', () => {
        const result = preserveDepartmentID('Beverages', null);

        expect(result.value).toBe('Beverages');
        expect(result.warning).toBe(null);
    });

    test('uses incoming value when values match', () => {
        const result = preserveDepartmentID('Snacks', 'Snacks');

        expect(result.value).toBe('Snacks');
        expect(result.warning).toBe(null);
    });

    test('handles empty incoming department', () => {
        const result = preserveDepartmentID('', 'Snacks');

        expect(result.value).toBe('Snacks');
        expect(result.warning).toContain('Department ID changed');
    });
});

describe('getOutputColumns', () => {
    test('returns correct column order', () => {
        const columns = getOutputColumns();

        expect(columns[0]).toBe('Item');
        expect(columns[1]).toBe('UPC');
        expect(columns).toContain('SPECIAL PRICING #1');
        expect(columns).toContain('SPECIAL PRICING #2');
        expect(columns[columns.length - 1]).toBe('ITEM_UOM');
    });

    test('includes all required columns', () => {
        const columns = getOutputColumns();

        const required = [
            'Item', 'UPC', 'Description', 'Department', 'REG_RETAIL',
            'PACK', 'REGULARCOST', 'TAX1', 'FOOD_STAMP', 'WIC',
            'BOTTLE_DEPOSIT', 'SALE_RETAIL', 'TPR_RETAIL',
            'ITEM_SIZE', 'ITEM_UOM'
        ];

        required.forEach(col => {
            expect(columns).toContain(col);
        });
    });
});
