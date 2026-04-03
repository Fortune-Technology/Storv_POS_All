

import { transformRow } from '../src/utils/transformers/pine-state-spirits.js';

describe('Pine State Spirits Transformer', () => {

    it('should pad Item # to 6 digits if numeric', () => {
        const input = {
            'Item #': '165',
            'Description': 'BARR HILL GIN 2PK',
            'UPC': '852735003210'
        };

        const { transformedRow } = transformRow(input);

        expect(transformedRow['Item #']).toBe('000165');
    });

    it('should preserve Item # leading zeros if already present', () => {
        const input = {
            'Item #': '000165',
            'Description': 'Test Item',
            'UPC': '852735003210'
        };

        const { transformedRow } = transformRow(input);

        expect(transformedRow['Item #']).toBe('000165');
    });

    it('should pad UPC to 13 digits (add leading zero)', () => {
        const input = {
            'Item #': '165',
            'UPC': '852735003210' // 12 digits
        };

        const { transformedRow } = transformRow(input);

        expect(transformedRow['UPC']).toBe('0852735003210');
    });

    it('should NOT pad UPC if already 13 digits', () => {
        const input = {
            'Item #': '165',
            'UPC': '5029704217465' // 13 digits
        };

        const { transformedRow } = transformRow(input);

        expect(transformedRow['UPC']).toBe('5029704217465');
    });

    it('should parse MM/D/YY date format correctly (12/1/25 -> 01-12-2025)', () => {
        const input = {
            'Item #': '165',
            'UPC': '852735003210',
            'Effective Start': '12/1/25',
            'Effective End': '12/31/25'
        };

        const { transformedRow } = transformRow(input);

        expect(transformedRow['Effective Start']).toBe('01-12-2025');
        expect(transformedRow['Effective End']).toBe('31-12-2025');
    });

    it('should handle DD-MM-YYYY input correctly', () => {
        const input = {
            'Item #': '165',
            'UPC': '852735003210',
            'Effective Start': '01-12-2025',
            'Effective End': '31-12-2025'
        };

        const { transformedRow } = transformRow(input);

        expect(transformedRow['Effective Start']).toBe('01-12-2025');
        expect(transformedRow['Effective End']).toBe('31-12-2025');
    });

    it('should format prices to 2 decimal places', () => {
        const input = {
            'Item #': '165',
            'UPC': '852735003210',
            'Retail': '54.99',
            'Sale Price': '49.99',
            'Agency Cost': '45.1',
            'Agency Sale Cost': '41'
        };

        const { transformedRow } = transformRow(input);

        expect(transformedRow['Retail']).toBe('54.99');
        expect(transformedRow['Sale Price']).toBe('49.99');
        expect(transformedRow['Agency Cost']).toBe('45.10');
        expect(transformedRow['Agency Sale Cost']).toBe('41.00');
    });

    it('should process a full row correctly matching user example', () => {
        const input = {
            'Item #': '165',
            'Description': 'BARR HILL GIN 2PK',
            'Size': '375ML',
            'Unit': '1',
            'UPC': '852735003210',
            'Effective Start': '01-12-2025',
            'Effective End': '31-12-2025',
            'Retail': '54.99',
            'Special Pricing Method': '0',
            'Sale Price': '49.99',
            'Agency Cost': '45.1',
            'Agency Sale Cost': '41'
        };

        const { transformedRow } = transformRow(input);

        expect(transformedRow).toEqual({
            'Item #': '000165',
            'Description': 'BARR HILL GIN 2PK',
            'Size': '375ML',
            'Unit': '1',
            'UPC': '0852735003210',
            'Effective Start': '01-12-2025',
            'Effective End': '31-12-2025',
            'Retail': '54.99',
            'Special Pricing Method': '0',
            'Sale Price': '49.99',
            'Agency Cost': '45.10',
            'Agency Sale Cost': '41.00'
        });
    });
});
