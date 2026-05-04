/**
 * S77 Phase 2 — Default Contract Template Seed
 *
 * Reads the user-supplied DOCX (converted to HTML by scripts/convert_contract_docx.mjs),
 * transforms placeholder blanks into {{mergeField}} tags, and stores it as the
 * default ContractTemplate (version 1, status='published').
 *
 * Idempotent — safe to re-run. Only creates the default template if none exists
 * with slug = 'merchant-services-agreement'. Re-running with NEW HTML content
 * will create a NEW VERSION (v2) of the existing template.
 *
 * Run: npx tsx prisma/seedContractTemplates.ts
 */
import prisma from '../src/config/postgres.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const RAW_HTML_PATH = path.resolve(__dirname, '..', 'scripts', '_contract_default.html');

// ── Catalog of merge fields ────────────────────────────────────────────
// These power the admin "Generate Contract" wizard — each field becomes a
// labelled input. The render function (in services/contractRender.ts)
// substitutes {{merchant.businessLegalName}} etc. at draft + display time.
const MERGE_FIELDS = {
  fields: [
    // ── Merchant identity ──
    { key: 'merchant.businessLegalName',    label: 'Legal Business Name',    type: 'text',     required: true,  group: 'Merchant Identity' },
    { key: 'merchant.dbaName',              label: 'DBA / Trade Name',       type: 'text',     required: false, group: 'Merchant Identity' },
    { key: 'merchant.address',              label: 'Business Address',       type: 'text',     required: true,  group: 'Merchant Identity' },
    { key: 'merchant.cityStateZip',         label: 'City / State / ZIP',     type: 'text',     required: true,  group: 'Merchant Identity' },
    { key: 'merchant.phone',                label: 'Business Phone',         type: 'text',     required: true,  group: 'Merchant Identity' },
    { key: 'merchant.email',                label: 'Business Email',         type: 'email',    required: true,  group: 'Merchant Identity' },
    { key: 'merchant.website',              label: 'Website',                type: 'text',     required: false, group: 'Merchant Identity' },
    { key: 'merchant.ein',                  label: 'Federal Tax ID (EIN)',   type: 'text',     required: true,  group: 'Merchant Identity' },
    { key: 'merchant.businessType',         label: 'Business Type',          type: 'choice',   required: true,  group: 'Merchant Identity', choices: ['LLC', 'Corp', 'Sole Prop', 'Partnership'] },
    { key: 'merchant.stateOfIncorporation', label: 'State of Incorporation', type: 'text',     required: true,  group: 'Merchant Identity' },
    { key: 'merchant.numLocations',         label: 'Number of Locations',    type: 'number',   required: true,  group: 'Merchant Identity', default: 1 },
    { key: 'merchant.ownerName',            label: 'Primary Owner Name',     type: 'text',     required: true,  group: 'Merchant Identity' },
    { key: 'merchant.ownerSsnLast4',        label: 'Owner SSN/EIN (last 4)', type: 'text',     required: true,  group: 'Merchant Identity' },
    { key: 'merchant.ownerDob',             label: 'Owner Date of Birth',    type: 'date',     required: true,  group: 'Merchant Identity' },
    { key: 'merchant.ownerPhone',           label: 'Owner Phone',            type: 'text',     required: true,  group: 'Merchant Identity' },
    { key: 'agreementDate',                 label: 'Agreement Effective Date', type: 'date',   required: true,  group: 'Agreement' },
    { key: 'merchant.mccCode',              label: 'MCC Code',               type: 'text',     required: false, group: 'Merchant Identity', default: 'TBD' },

    // ── SaaS Pricing ──
    { key: 'pricing.saas.baseMonthlyFee',         label: 'SaaS Base Monthly Fee',           type: 'currency', required: true,  group: 'SaaS Pricing', default: 79.00 },
    { key: 'pricing.saas.additionalLicenseFee',   label: 'Additional License Fee (per terminal)', type: 'currency', required: false, group: 'SaaS Pricing', default: 0 },
    { key: 'pricing.saas.addonsTotalMonthly',     label: 'Premium Add-ons Total',           type: 'currency', required: false, group: 'SaaS Pricing', default: 0 },

    // ── Processing — IC+ ──
    { key: 'pricing.processing.model',                 label: 'Processing Model',           type: 'choice',   required: true,  group: 'Payment Processing', choices: ['IC+', 'dual_pricing'], default: 'IC+' },
    { key: 'pricing.processing.icplusMarkupPercent',   label: 'IC+ Volume Markup (%)',      type: 'number',   required: false, group: 'Payment Processing', default: 0.05 },
    { key: 'pricing.processing.icplusInStorePerTx',    label: 'IC+ In-Store Per Tx ($)',    type: 'currency', required: false, group: 'Payment Processing', default: 0.05 },
    { key: 'pricing.processing.icplusOnlinePerTx',     label: 'IC+ Online/Keyed Per Tx ($)', type: 'currency', required: false, group: 'Payment Processing', default: 0.15 },
    { key: 'pricing.processing.batchFee',              label: 'Batch Settlement Fee ($)',   type: 'currency', required: false, group: 'Payment Processing', default: 0.05 },
    { key: 'pricing.processing.pciFee',                label: 'PCI Non-Validation Fee ($/mo)', type: 'currency', required: false, group: 'Payment Processing', default: 19.95 },
    { key: 'pricing.processing.breachFee',             label: 'Breach Coverage ($/mo)',     type: 'currency', required: false, group: 'Payment Processing', default: 6.95 },
    { key: 'pricing.processing.gatewayFee',            label: 'Gateway Fee per Terminal ($/mo)', type: 'currency', required: false, group: 'Payment Processing', default: 10.00 },
    { key: 'pricing.processing.aofFee',                label: 'Account on File ($/mo)',     type: 'currency', required: false, group: 'Payment Processing', default: 5.00 },
    { key: 'pricing.processing.chargebackFee',         label: 'Chargeback Fee ($/event)',   type: 'currency', required: false, group: 'Payment Processing', default: 25.00 },
    { key: 'pricing.processing.retrievalFee',          label: 'Retrieval Fee ($/event)',    type: 'currency', required: false, group: 'Payment Processing', default: 25.00 },
    { key: 'pricing.processing.achReturnFee',          label: 'ACH Return Fee ($/event)',   type: 'currency', required: false, group: 'Payment Processing', default: 25.00 },
    { key: 'pricing.processing.voiceAuthFee',          label: 'Voice Auth Fee ($/call)',    type: 'currency', required: false, group: 'Payment Processing', default: 0.75 },
    { key: 'pricing.processing.intlCardPercent',       label: 'International Card (%)',     type: 'number',   required: false, group: 'Payment Processing', default: 0.40 },

    // ── Processing — Dual Pricing (only when model = dual_pricing) ──
    { key: 'pricing.processing.cashDiscountPercent',   label: 'Cash Price Discount (%)',    type: 'number',   required: false, group: 'Payment Processing', default: null, conditional: { field: 'pricing.processing.model', equals: 'dual_pricing' } },
    { key: 'pricing.processing.cardSurchargePercent',  label: 'Card Price Surcharge (%)',   type: 'number',   required: false, group: 'Payment Processing', default: null, conditional: { field: 'pricing.processing.model', equals: 'dual_pricing' } },

    // ── Bank info (collected at signing time, not generation) ──
    { key: 'bank.name',          label: 'Bank Name',           type: 'text', required: false, group: 'ACH Authorization', collectedAtSigning: true },
    { key: 'bank.routingLast4',  label: 'Routing # (last 4)',  type: 'text', required: false, group: 'ACH Authorization', collectedAtSigning: true },
    { key: 'bank.accountLast4',  label: 'Account # (last 4)',  type: 'text', required: false, group: 'ACH Authorization', collectedAtSigning: true },
  ],
};

/**
 * Transform the raw mammoth HTML output into a templated version with
 * {{mergeKey}} placeholders. The raw DOCX has labelled blanks like:
 *   <p><strong>Business Legal Name:</strong></p><p>___________________________</p>
 * We walk a list of (label → mergeKey) mappings and replace each blank
 * that immediately follows the labelled paragraph.
 *
 * Also injects the special markers:
 *   <!--HARDWARE_ROWS-->  for the dynamic equipment table
 *   <!--SIGNATURE_BLOCK--> for the signature canvas
 */
function transformHtmlToTemplate(rawHtml: string): string {
  let html = rawHtml;

  // Map of "label text" → "merge key" — the regex matches the label, then the
  // immediately-following <p>blank</p>, and rewrites the blank with the tag.
  const replacements: Array<[string, string]> = [
    // Top header block
    ['Business Legal Name:',     'merchant.businessLegalName'],
    ['DBA (if different):',      'merchant.dbaName'],
    ['Address:',                 'merchant.address'],
    ['Agreement Date:',          'agreementDate'],
    // Merchant Information block
    ['Legal Business Name:',     'merchant.businessLegalName'],
    ['DBA / Trade Name:',        'merchant.dbaName'],
    ['Business Address:',        'merchant.address'],
    ['City / State / ZIP:',      'merchant.cityStateZip'],
    ['Business Phone:',          'merchant.phone'],
    ['Business Email:',          'merchant.email'],
    ['Website (if any):',        'merchant.website'],
    ['Federal Tax ID (EIN):',    'merchant.ein'],
    ['State of Incorporation:',  'merchant.stateOfIncorporation'],
    ['Number of Locations:',     'merchant.numLocations'],
    ['Primary Owner Name:',      'merchant.ownerName'],
    ['Owner SSN / EIN (last 4):', 'merchant.ownerSsnLast4'],
    ['Owner Date of Birth:',     'merchant.ownerDob'],
    ['Owner Phone:',             'merchant.ownerPhone'],
  ];

  for (const [labelText, mergeKey] of replacements) {
    // Match "<strong>Label:</strong></p><p>blank</p>" with optional cell wrapping.
    // The blank is 27 underscores in the original DOCX.
    const escapedLabel = labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `(<strong>${escapedLabel}</strong>(?:</p>)?\\s*(?:</td>\\s*<td>)?\\s*<p>)_+(</p>)`,
      'g',
    );
    html = html.replace(pattern, `$1{{${mergeKey}}}$2`);
  }

  // Business Type — replace the inline "[LLC / Corp / Sole Prop / Partnership]" placeholder
  html = html.replace(
    /<strong>Business Type:<\/strong>(?:<\/p>)?\s*(?:<\/td>\s*<td>)?\s*<p>\[LLC \/ Corp \/ Sole Prop \/ Partnership\]<\/p>/g,
    '<strong>Business Type:</strong></p></td><td><p>{{merchant.businessType}}</p>',
  );

  // MCC code — replace "[To be assigned by StoreVeu]"
  html = html.replace(
    /<strong>MCC Code:<\/strong>(?:<\/p>)?\s*(?:<\/td>\s*<td>)?\s*<p>\[To be assigned by StoreVeu\]<\/p>/g,
    '<strong>MCC Code:</strong></p></td><td><p>{{merchant.mccCode}}</p>',
  );

  // Equipment table — inject the dynamic-rows marker right before the TOTAL row.
  // The TOTAL row is identifiable by the "TOTAL ONE-TIME HARDWARE COST" text.
  html = html.replace(
    /(<tr><td><p>Dejavoo Terminal\(s\)[\s\S]*?)<tr><td><p><strong>TOTAL ONE-TIME HARDWARE COST<\/strong>/,
    '<!--HARDWARE_ROWS--><tr><td><p><strong>TOTAL ONE-TIME HARDWARE COST</strong>',
  );

  // SaaS fee tags
  html = html.replace(
    /\$79\.00 \/ month/g,
    '${{pricing.saas.baseMonthlyFee}}/month',
  );

  // Signature marker — append at the very end before the final </body> if any
  html += `
    <!--SIGNATURE_BLOCK-->
    <div class="signature-block" style="margin-top: 60px; border-top: 2px solid #1f2937; padding-top: 24px;">
      <p style="margin: 0 0 4px;"><strong>MERCHANT</strong></p>
      <p style="margin: 0 0 24px;">By signing below, the undersigned represents that they are authorized to bind the Merchant to this Agreement.</p>
      <table style="width: 100%; border: none;">
        <tr>
          <td style="width: 50%; vertical-align: bottom;">
            <p style="margin: 0;"><strong>Signature:</strong></p>
            <div style="border-bottom: 1px solid #1f2937; height: 60px;">{{signature.imageHtml}}</div>
            <p style="margin: 8px 0 0; font-size: 12px;">Signed by: {{signature.signerName}}</p>
            <p style="margin: 0; font-size: 12px;">Title: {{signature.signerTitle}}</p>
          </td>
          <td style="width: 50%; vertical-align: bottom; padding-left: 32px;">
            <p style="margin: 0;"><strong>Date Signed:</strong></p>
            <div style="border-bottom: 1px solid #1f2937; height: 60px; padding-top: 36px;">{{signature.signedAt}}</div>
            <p style="margin: 8px 0 0; font-size: 12px;">IP: {{signature.signerIp}}</p>
          </td>
        </tr>
      </table>
    </div>
  `;

  return html;
}

async function main() {
  console.log('🌱 Seeding default Contract Template...');

  // Read the converted HTML produced by scripts/convert_contract_docx.mjs.
  // If you change the source DOCX, re-run that script first.
  if (!fs.existsSync(RAW_HTML_PATH)) {
    console.error(`✗ Source HTML not found at ${RAW_HTML_PATH}`);
    console.error('  Run: node scripts/convert_contract_docx.mjs first.');
    process.exit(1);
  }

  const rawHtml = fs.readFileSync(RAW_HTML_PATH, 'utf-8');
  const templatedHtml = transformHtmlToTemplate(rawHtml);

  const slug = 'merchant-services-agreement';

  let template = await prisma.contractTemplate.findUnique({ where: { slug } });
  if (!template) {
    template = await prisma.contractTemplate.create({
      data: {
        slug,
        name: 'Merchant Services Agreement',
        description: 'Standard StoreVeu merchant onboarding contract — covers SaaS, payment processing, hardware sale, and ACH authorization.',
        isDefault: true,
        active: true,
      },
    });
    console.log(`  ✓ Created template: ${template.name} (${template.id})`);
  } else {
    console.log(`  → Template already exists: ${template.name}`);
  }

  // Check for an existing v1 — if same content, skip; if different, create v2.
  const latest = await prisma.contractTemplateVersion.findFirst({
    where: { templateId: template.id },
    orderBy: { versionNumber: 'desc' },
  });

  // Stable stringify — sorts object keys alphabetically so order-of-insertion
  // differences don't flag as drift. Postgres stores `Json` as jsonb which
  // normalizes key ordering on storage; reading it back returns keys in a
  // different order than the source `MERGE_FIELDS` literal. Without this,
  // every re-run would falsely "detect drift" and bump the version forever.
  const stableStringify = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
  };

  if (!latest) {
    const v1 = await prisma.contractTemplateVersion.create({
      data: {
        templateId: template.id,
        versionNumber: 1,
        bodyHtml: templatedHtml,
        mergeFields: MERGE_FIELDS,
        status: 'published',
        publishedAt: new Date(),
        changeNotes: 'Initial seed from storeveu_merchant_agreement.docx',
      },
    });
    console.log(`  ✓ Created version 1 (${v1.id})`);
  } else if (latest.bodyHtml !== templatedHtml || stableStringify(latest.mergeFields) !== stableStringify(MERGE_FIELDS)) {
    // Content drift — bump version
    const next = (latest.versionNumber || 1) + 1;
    // Archive the previous published version
    await prisma.contractTemplateVersion.update({
      where: { id: latest.id },
      data: { status: 'archived' },
    });
    const newV = await prisma.contractTemplateVersion.create({
      data: {
        templateId: template.id,
        versionNumber: next,
        bodyHtml: templatedHtml,
        mergeFields: MERGE_FIELDS,
        status: 'published',
        publishedAt: new Date(),
        changeNotes: `Auto-bumped by seed (${new Date().toISOString().slice(0, 10)})`,
      },
    });
    console.log(`  ✓ Bumped version → ${next} (${newV.id})  [previous archived]`);
  } else {
    console.log(`  → Version ${latest.versionNumber} already current — no changes.`);
  }

  console.log('✅ Contract template seed complete.\n');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
