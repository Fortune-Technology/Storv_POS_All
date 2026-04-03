/**
 * Quick test to verify deposit mapping is loaded correctly
 */

import { parseFile } from '../src/utils/fileProcessor.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testDepositMapping() {
    console.log('Testing deposit mapping loading...\n');

    const depositMappingPath = path.join(__dirname, '..', 'sample-data', 'deposit-mapping.csv');
    console.log('Loading from:', depositMappingPath);

    const rows = await parseFile(depositMappingPath);
    console.log(`\nLoaded ${rows.length} rows from deposit-mapping.csv\n`);

    // Debug: show first row structure
    if (rows.length > 0) {
        console.log('First row keys:', Object.keys(rows[0]));
        console.log('First row:', rows[0]);
        console.log('');
    }

    const depositMapping = {};

    rows.forEach((row, index) => {
        const id = row.Id || row.ID || row.id;
        const amount = row.Amount || row.amount || row.AMOUNT;
        const name = row.Name || row.name || row.NAME;

        if (index < 3) {
            console.log(`Row ${index}: id=${id}, amount=${amount}, name=${name}`);
        }

        if (amount && id) {
            const normalizedAmount = parseFloat(amount).toString();
            depositMapping[normalizedAmount] = id;
            depositMapping[amount.toString().trim()] = id;
        }
    });

    console.log(`\n✅ Total mappings created: ${Object.keys(depositMapping).length}`);
    console.log(`✅ Unique deposit IDs: ${rows.length}`);

    // Test some lookups
    console.log('\n--- Testing Lookups ---');
    console.log('Lookup "0.3":', depositMapping['0.3']);
    console.log('Lookup "0.6":', depositMapping['0.6']);
    console.log('Lookup "0.05":', depositMapping['0.05']);
    console.log('Lookup "1.2":', depositMapping['1.2']);
}

testDepositMapping().catch(console.error);
