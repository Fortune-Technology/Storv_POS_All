
import { transformRow } from './src/utils/transformer.js';

const testRows = [
    {
        Item: '17548',
        SALE_MULTIPLE: '4',
        SALE_RETAIL: '5.00',
        REG_RETAIL: '2.39',
        Description: 'SP PRINCE 001'
    },
    {
        Item: '25708',
        SALE_MULTIPLE: '1',
        SALE_RETAIL: '3.29',
        REG_RETAIL: '3.29',
        Description: 'GUMMISAV 001'
    }
];

console.log('--- TEST START ---');
testRows.forEach(row => {
    const { transformedRow } = transformRow(row);
    console.log(JSON.stringify({
        item: row.Item,
        input_mult: row.SALE_MULTIPLE,
        output_pricing: transformedRow['SPECIAL PRICING #1'],
        output_quantity: transformedRow['SPECIAL QUANTITY 1'],
        output_group_price: transformedRow.group_price,
        output_sale_retail: transformedRow.SALE_RETAIL
    }));
});
console.log('--- TEST END ---');
