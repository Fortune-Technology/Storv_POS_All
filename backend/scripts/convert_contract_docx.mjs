// One-shot helper to convert the user-supplied DOCX to HTML.
// Output is written to backend/scripts/_contract_default.html for inspection,
// then read by seedContractTemplates.ts to populate the default template.
import mammoth from 'mammoth';
import fs from 'node:fs';
import path from 'node:path';

const DOCX = 'C:/Users/patel/Downloads/storeveu_merchant_agreement.docx';
const OUT = path.resolve('scripts', '_contract_default.html');

const result = await mammoth.convertToHtml({ path: DOCX });
console.log('Messages:', result.messages.length);
fs.writeFileSync(OUT, result.value, 'utf-8');
console.log(`Wrote ${OUT} (${result.value.length} bytes)`);
