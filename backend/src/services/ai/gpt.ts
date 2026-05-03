/**
 * gptService.ts — Invoice Extraction (Azure + GPT-4o Hybrid)
 *
 * Strategy (most reliable → cheapest):
 *   Step 1 — Azure Document Intelligence (prebuilt-invoice)
 *             Best for clean PDFs & scans. Handles layout, OCR, standard fields.
 *   Step 2 — GPT-4o-mini text enrichment (always runs after Azure)
 *             Fills in DEP/NET/SSP columns, pack format, category, etc.
 *   Step 3 — GPT-4o VISION fallback (only when Azure returns < 2 line items)
 *             Handles phone-camera photos, skewed/rotated, low-res invoices,
 *             and invoices where the vendor name is inside a logo image.
 *
 * Display pages — pdf2pic at 150dpi (split-pane preview only, not OCR)
 */

import OpenAI from "openai";
import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";
import { fromBuffer } from "pdf2pic";
import fs from "fs/promises";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// ── Public domain shapes ────────────────────────────────────────────────────

export interface InvoiceVendor {
  vendorName: string;
  customerNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
  paymentDueDate: string;
  paymentType: string;
  checkNumber: string;
  totalInvoiceAmount: number;
  tax: number;
  totalDiscount: number;
  totalDeposit: number;
  otherFees: number;
  totalCasesReceived: number;
  totalUnitsReceived: number;
  driverName: string;
  salesRepName: string;
  loadNumber: string;
}

export interface InvoiceLineItem {
  upc: string;
  itemCode: string;
  plu: string;
  description: string;
  packUnits: number;
  unitsPerPack: number;
  containerSize: string;
  quantity: number;
  unitType: string;
  caseCost: number;
  netCost: number;
  unitCost: number;
  depositAmount: number;
  totalAmount: number;
  suggestedRetailPrice: number;
  discount: number;
  transactionType: 'sale' | 'credit' | string;
  category: string;
  subCategory: string;
  /** Set by `extractMultiplePages` when merging extractions across files. */
  _pageNumber?: number;
}

export interface InvoiceExtraction {
  vendor: InvoiceVendor;
  lineItems: InvoiceLineItem[];
  /** Raw OCR text from Azure (Vision path leaves this empty). */
  rawContent?: string;
}

export interface ExtractInvoiceResult {
  data: InvoiceExtraction;
  pages: string[];
}

export interface MultipageFile {
  buffer: Buffer;
  mimetype: string;
}

// HEIC converter signature — the npm package's default export takes
// `{ buffer, format, quality }` and returns a `Uint8Array | ArrayBuffer`.
type HeicConvertFn = (opts: { buffer: Buffer | Uint8Array; format: 'JPEG' | 'PNG'; quality?: number }) =>
  Promise<Uint8Array | ArrayBuffer>;

// Session 39 Round 5 — lazy-import HEIC converter so the backend starts
// even if the package isn't installed (defence against a bad deploy).
// Real upload request paths assert it exists when a HEIC file arrives.
// `null` = not yet probed; `false` = probed and missing; otherwise the fn.
let _heicConvert: HeicConvertFn | false | null = null;
async function getHeicConverter(): Promise<HeicConvertFn | false> {
  if (_heicConvert !== null) return _heicConvert;
  try {
    // @ts-expect-error — heic-convert has no shipped type declarations
    const mod = await import('heic-convert');
    _heicConvert = (mod.default || mod) as HeicConvertFn;
  } catch {
    _heicConvert = false; // distinct from null so we don't retry
  }
  return _heicConvert;
}

// ─── TOLERANT JSON PARSE ─────────────────────────────────────────────────────
// OpenAI can truncate the response when the output exceeds max_tokens, leaving
// malformed JSON like `{"lineItems": [ {...}, {"descripti`. Even with
// `response_format: json_object` the SDK returns the partial content plus
// `finish_reason: 'length'`. Native JSON.parse throws "Unterminated string…"
// and we lose the entire extraction.
//
// This helper tries normal parse first, then — if it fails with a truncation-
// shaped error — walks the string looking for the last COMPLETE line-item
// object in the `lineItems` (or `enrichments`) array, truncates there, and
// appends `]}` to close the structure. Returns the parsed object or throws
// the original error if repair fails.
//
// Usage:
//   const raw = response.choices[0].message.content;
//   const finishReason = response.choices[0].finish_reason;
//   const parsed = tolerantJsonParse(raw, { finishReason, context: 'vision' });
interface TolerantJsonOpts {
  finishReason?: string | null;
  context?: string;
}

function tolerantJsonParse(
  raw: string,
  { finishReason, context }: TolerantJsonOpts = {},
): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Only try repair for truncation-shaped errors, not actual malformed JSON.
    const truncated = /Unterminated string|Unexpected end of JSON input|Unexpected token/i.test(message)
                    || finishReason === 'length';
    if (!truncated) throw err;

    const repaired = repairTruncatedJson(raw);
    if (!repaired) {
      console.warn(`[gptService/${context || 'unknown'}] JSON truncation detected but repair failed:`, message);
      throw err;
    }
    try {
      const result = JSON.parse(repaired) as Record<string, unknown>;
      const arrayKey: 'lineItems' | 'enrichments' | null =
        Array.isArray(result.lineItems)   ? 'lineItems' :
        Array.isArray(result.enrichments) ? 'enrichments' : null;
      const saved = arrayKey ? ((result[arrayKey] as unknown[]) || []).length : 0;
      console.warn(`⚠️  [gptService/${context || 'unknown'}] Recovered truncated JSON — salvaged ${saved} ${arrayKey || 'items'}. Consider bumping max_tokens.`);
      return result;
    } catch (e2) {
      const m2 = e2 instanceof Error ? e2.message : String(e2);
      console.warn(`[gptService/${context || 'unknown'}] Repair attempt also failed:`, m2);
      throw err;  // surface the ORIGINAL error so upstream sees meaningful context
    }
  }
}

// Walk the string once, tracking `{}` nesting inside `"lineItems": [...]` (or
// `"enrichments": [...]`), and return a prefix ending at the last `}` that
// closed a top-level array element, with `]}` appended to close the array +
// outer object. Handles nested objects, strings, escapes. Returns null if
// no complete element could be found (e.g. truncated inside the first item).
function repairTruncatedJson(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length < 20) return null;

  // Find where the big array opens.
  const m = raw.match(/"(lineItems|enrichments)"\s*:\s*\[/);
  if (!m || m.index == null) return null;
  const arrayStart = m.index + m[0].length;

  let depth = 0;          // nesting depth of { } inside the array
  let inString = false;
  let escaped = false;
  let lastCompleteItemEnd = -1;

  for (let i = arrayStart; i < raw.length; i++) {
    const c = raw[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"')  { inString = !inString; continue; }
    if (inString)   continue;

    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) lastCompleteItemEnd = i;   // just closed an array element
    }
  }

  if (lastCompleteItemEnd < 0) return null;
  // Truncate at that position, close the array + outer object.
  return raw.slice(0, lastCompleteItemEnd + 1) + ']}';
}

// iPhone photos arrive as HEIC/HEIF. Neither Azure Document Intelligence
// nor OpenAI Vision accepts that format, so we transcode to JPEG before
// running OCR. Returns { buffer, mimetype } — pass-through for non-HEIC.
async function normalizeImageBuffer(
  buffer: Buffer,
  mimetype: string,
): Promise<{ buffer: Buffer; mimetype: string }> {
  const mt = (mimetype || '').toLowerCase();
  const isHeic = mt.includes('heic') || mt.includes('heif');
  if (!isHeic) return { buffer, mimetype };
  const convert = await getHeicConverter();
  if (!convert) {
    throw new Error(
      'HEIC/HEIF image received but heic-convert is not installed on the server. ' +
      'Run `npm install heic-convert` in backend/ and restart, or ask the user to export the photo as JPEG.'
    );
  }
  try {
    const jpegBuffer = await convert({ buffer, format: 'JPEG', quality: 0.9 });
    const out = Buffer.from(jpegBuffer as ArrayBuffer);
    console.log(`🖼  HEIC → JPEG converted (${buffer.length} → ${out.length} bytes)`);
    return { buffer: out, mimetype: 'image/jpeg' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`HEIC decode failed: ${message}. Try exporting the photo as JPEG.`);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const getAzureClient = () => {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key      = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  if (!endpoint || !key) {
    throw new Error(
      "Azure Document Intelligence credentials not configured. " +
      "Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY in .env"
    );
  }
  return new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
};

// ─── VALIDATION & RECONCILIATION ──────────────────────────────────────────────

const validateAndNormalize = (result: InvoiceExtraction | null | undefined): InvoiceExtraction | null => {
  if (!result || !result.lineItems) return null;

  result.lineItems = result.lineItems
    .map((item) => {
      const qty = Number(item.quantity || 0);
      return {
        ...item,
        description:          (item.description || "").trim(),
        // Default quantity to 1 — invoices often have a partially obscured Ordered column
        // and quantity is almost always 1 case per line for delivery invoices
        quantity:             qty !== 0 ? qty : 1,
        totalAmount:          Number(item.totalAmount          || 0),
        depositAmount:        Number(item.depositAmount        || 0),
        discount:             Number(item.discount             || 0),
        caseCost:             Number(item.caseCost             || 0),
        netCost:              Number(item.netCost              || 0),
        unitCost:             Number(item.caseCost || 0) / (Number(item.unitsPerPack || 1) || 1),
        packUnits:            Number(item.packUnits            || 0),
        unitsPerPack:         Number(item.unitsPerPack         || 0),
        suggestedRetailPrice: Number(item.suggestedRetailPrice || 0),
        upc:                  (item.upc       || "").trim(),
        itemCode:             (item.itemCode  || "").trim(),
        plu:                  (item.plu       || "").trim(),
        category:             item.category   || "Other",
      };
    })
    // Only require a non-empty description — quantity defaults to 1 above
    .filter((item) => item.description !== "");

  if (result.vendor) {
    result.vendor.totalInvoiceAmount  = Number(result.vendor.totalInvoiceAmount  || 0);
    result.vendor.tax                 = Number(result.vendor.tax                 || 0);
    result.vendor.totalDiscount       = Number(result.vendor.totalDiscount       || 0);
    result.vendor.totalDeposit        = Number(result.vendor.totalDeposit        || 0);
    result.vendor.otherFees           = Number(result.vendor.otherFees           || 0);
    result.vendor.totalCasesReceived  = Number(result.vendor.totalCasesReceived  || 0);
    result.vendor.totalUnitsReceived  = Number(result.vendor.totalUnitsReceived  || 0);
    result.vendor.vendorName          = (result.vendor.vendorName  || "").trim();
    result.vendor.invoiceNumber       = (result.vendor.invoiceNumber || "").trim();
  }

  return result;
};

interface ReconciliationResult {
  sumItems: number;
  finalDeposit: number;
  computedTotal: number;
  expectedTotal: number;
  mismatch: number;
  isValid: boolean;
}

const performReconciliation = (result: InvoiceExtraction): ReconciliationResult => {
  const sumItems        = result.lineItems.reduce((s, i) => s + (i.totalAmount    || 0), 0);
  const sumLineDeposits = result.lineItems.reduce((s, i) => s + (i.depositAmount  || 0), 0);

  const finalDeposit =
    Math.abs(sumLineDeposits - result.vendor.totalDeposit) < 0.5
      ? sumLineDeposits
      : result.vendor.totalDeposit;

  const computedTotal = sumItems + finalDeposit + result.vendor.tax + result.vendor.otherFees - result.vendor.totalDiscount;
  const expectedTotal = result.vendor.totalInvoiceAmount;
  const mismatch      = Math.abs(computedTotal - expectedTotal);

  return { sumItems, finalDeposit, computedTotal, expectedTotal, mismatch, isValid: mismatch <= 0.10 };
};

// ─── STEP 1: AZURE DOCUMENT INTELLIGENCE ──────────────────────────────────────

/**
 * UPC heuristic — any purely numeric string of 7+ digits is treated as a UPC/barcode.
 * Many vendors (e.g. Hershey's) use their internal item numbers as their product UPCs.
 * We store it in BOTH upc and itemCode so matching can use either field.
 */
const isLikelyUPC = (code: string | null | undefined): boolean => {
  const clean = (code || "").replace(/\s/g, "");
  return /^\d{7,14}$/.test(clean);
};

const extractWithAzure = async (
  buffer: Buffer,
  mimetype: string,
): Promise<InvoiceExtraction> => {
  const client = getAzureClient();

  console.log("🔵 Starting Azure Document Intelligence extraction...");
  // The Azure SDK's typed overload for beginAnalyzeDocument doesn't include
  // `contentType` in its options — but the runtime method accepts it (and
  // some buffer types depend on it). Cast loosely so the runtime behaviour
  // is preserved.
  const poller = await (client.beginAnalyzeDocument as unknown as (
    modelId: string,
    document: Buffer,
    options?: { contentType?: string },
  ) => Promise<{ pollUntilDone: () => Promise<unknown> }>)(
    "prebuilt-invoice",
    buffer,
    { contentType: mimetype },
  );

  // The Azure SDK loses its precise return type through our cast above. The
  // actual runtime shape is `AnalyzeResult<AnalyzedDocument>` from the SDK.
  interface AzureAnalyzeResult {
    documents?: Array<{ fields?: Record<string, { value?: unknown }> }>;
    content?: string;
  }
  const result = (await poller.pollUntilDone()) as AzureAnalyzeResult;

  if (!result.documents || result.documents.length === 0) {
    throw new Error("Azure Document Intelligence returned no documents");
  }

  const invoice    = result.documents[0];
  const f          = (invoice.fields ?? {}) as Record<string, { value?: unknown }>;
  const rawContent = result.content || ""; // full OCR text → used for GPT enrichment

  // Local helper: safely read deep `field.value.amount` / `field.value` paths
  // from the loose Azure shape — many fields are typed as DocumentField unions
  // whose `.value` is a discriminated union of types we don't statically know.
  const fv = (key: string): unknown => f[key]?.value;
  const fvAmount = (key: string): number => {
    const v = fv(key);
    if (v && typeof v === 'object' && 'amount' in v) {
      const amt = (v as { amount?: number }).amount;
      return typeof amt === 'number' ? amt : 0;
    }
    return 0;
  };

  // ── Vendor-level fields ──
  const vendor: InvoiceVendor = {
    vendorName:           (fv('VendorName') as string)             || "",
    customerNumber:       (fv('CustomerId') as string)             || "",
    invoiceNumber:        (fv('InvoiceId')  as string)              || "",
    invoiceDate:          fv('InvoiceDate')   ? String(fv('InvoiceDate')) : "",
    paymentDueDate:       fv('DueDate')       ? String(fv('DueDate'))      : "",
    paymentType:          (fv('PaymentTerm') as string)            || "",
    checkNumber:          "",
    totalInvoiceAmount:   fvAmount('InvoiceTotal') || fvAmount('AmountDue') || 0,
    tax:                  fvAmount('TotalTax')     || 0,
    totalDiscount:        0,
    totalDeposit:         0,
    otherFees:            0,
    totalCasesReceived:   0,
    totalUnitsReceived:   0,
    driverName:           "",
    salesRepName:         "",
    loadNumber:           "",
  };

  // ── Line items ──
  const itemsField = (f.Items as { values?: Array<{ properties?: Record<string, { value?: unknown }> }> } | undefined);
  const itemValues = itemsField?.values || [];
  const lineItems: InvoiceLineItem[] = itemValues.map((item): InvoiceLineItem => {
    const p           = (item.properties || {}) as Record<string, { value?: unknown }>;
    const pv = (key: string): unknown => p[key]?.value;
    const pvAmount = (key: string): number => {
      const v = pv(key);
      if (v && typeof v === 'object' && 'amount' in v) {
        const amt = (v as { amount?: number }).amount;
        return typeof amt === 'number' ? amt : 0;
      }
      return 0;
    };
    const productCode = (pv('ProductCode') as string) || "";

    // Session 39 Round 5 — `discount` used to read p.Tax which is Azure's
    // line-tax field (always 0 or the tax amount), NOT the discount. That
    // caused the cost-proximity tier to compare invoice gross price to
    // catalog cost. Azure's prebuilt-invoice model doesn't extract the
    // DISC column cleanly — GPT enrichment fills it in from raw OCR text.
    // Default to 0 here; enrichLineItems will populate from OCR.
    // Store numeric codes in both fields — many vendors use their item# as UPC
    return {
      upc:                  isLikelyUPC(productCode) ? productCode : "",
      itemCode:             productCode, // always preserve the raw code for matching
      plu:                  "",
      description:          (pv('Description') as string) || "",
      packUnits:            0,          // enriched by GPT
      unitsPerPack:         0,          // enriched by GPT
      containerSize:        "",
      quantity:             Number(pv('Quantity') || 0),
      unitType:             (pv('Unit') as string) || "case",
      caseCost:             pvAmount('UnitPrice'),  // ⚠ may be gross PRICE, not NET — enrichment prefers GPT's parsed value
      netCost:              0,          // enriched by GPT from NET column
      unitCost:             0,          // recalculated after enrichment
      depositAmount:        0,          // enriched by GPT from DEP column
      totalAmount:          pvAmount('Amount'),
      suggestedRetailPrice: 0,          // enriched by GPT
      discount:             0,          // enriched by GPT from DISC column
      transactionType:      "sale",
      category:             "Other",
      subCategory:          "",
    };
  });

  console.log(`✅ Azure extracted: vendor="${vendor.vendorName}", invoice="${vendor.invoiceNumber}", ${lineItems.length} line items`);

  return { vendor, lineItems, rawContent };
};

// ─── STEP 2: GPT-4o-mini TEXT ENRICHMENT ──────────────────────────────────────

interface EnrichmentRecord {
  index: number;
  upc?: string;
  itemCode?: string;
  caseCost?: number | string;
  discount?: number | string;
  netCost?: number | string;
  depositAmount?: number | string;
  suggestedRetailPrice?: number | string;
  packUnits?: number | string;
  unitsPerPack?: number | string;
  containerSize?: string;
  category?: string;
  transactionType?: string;
  subCategory?: string;
}

const enrichLineItems = async (
  lineItems: InvoiceLineItem[],
  rawContent: string,
): Promise<InvoiceLineItem[]> => {
  if (!lineItems.length || !rawContent) return lineItems;

  const truncatedContent = rawContent.slice(0, 6000);
  const itemsJson = JSON.stringify(
    lineItems.map((item, i) => ({
      index:       i,
      description: item.description,
      upc:         item.upc,
      itemCode:    item.itemCode,
      quantity:    item.quantity || 1,
      azureCaseCost: item.caseCost, // labelled so GPT knows Azure's value may be gross PRICE
      totalAmount: item.totalAmount,
    })),
    null, 2
  );

  const prompt = `You are enriching extracted invoice line items with specialized fields.

FULL INVOICE TEXT (from OCR):
${truncatedContent}

ALREADY EXTRACTED LINE ITEMS (add missing fields to each):
${itemsJson}

Beverage distributor invoices commonly use THIS column layout:
  ITEM# | QTY | DESCRIPTION | PRICE | DISC | DEP | NET | EXT
where PRICE is the gross case price, DISC is the per-case discount,
DEP is the per-case bottle deposit, NET = PRICE - DISC, and
EXT = (NET + DEP) × QTY. Your job is to distinguish PRICE from NET —
Azure's extractor usually grabs PRICE which is WRONG as the cost.

For each item, identify from the invoice text:
1.  upc — if invoice has a dedicated U.P.C./BARCODE column with a 12-13 digit value, put it here; otherwise ""
2.  itemCode — vendor's internal code (ITEM#, CODE, Item Number column); even if numeric
3.  caseCost — the GROSS case price (PRICE column, before any discount). If the invoice only has one
                price column, use that value.
4.  discount — the per-case DISC/DISCOUNT/ALLOW column value, else 0
5.  netCost — the NET case cost (caseCost - discount). If a NET column is printed on the invoice,
              use that value directly. If no explicit NET column, compute caseCost - discount.
6.  depositAmount — per-case bottle deposit (DEP column), else 0
7.  suggestedRetailPrice — vendor's suggested shelf price (SSP, SRP column), else 0
8.  packUnits — from pack format like "6/12oz" or "2-12/12OZ" = first number (6 or 2), else 0
9.  unitsPerPack — e.g. "6/12oz" → 12, "18/12OZ" → 12 (the last "per-unit" size number), else 0
10. containerSize — e.g. "12oz", "750ml", "1L", "24oz"
11. category — one of: Beer|Wine|Spirits|Bakery|Dairy|Produce|Beverage|Snacks|Tobacco|Candy|Frozen|Grocery|IceCream|Other
12. transactionType — "credit" if quantity is negative or item is in a STALES/RETURNS/DAMAGED section, else "sale"
13. subCategory — optional, e.g. "IPA", "Lager", "Vanilla"

RULES:
- ITEM# / CODE column → itemCode. If it is purely numeric (7+ digits), ALSO copy it to upc
  (many vendors like Hershey's use their item# as their UPC barcode).
- If there is a separate dedicated UPC/BARCODE column, that takes priority for the upc field.
- If the invoice has a DAMAGED / OUT OF STOCK / DECLINED marker for a line, set
  transactionType="credit" and keep the visible quantity (e.g. -1).
- If no DEP column exists, depositAmount = 0. If no DISC column, discount = 0.
- Always populate BOTH caseCost (gross) AND netCost (after discount) when you can. They may
  be equal if there is no discount, or a standalone NET column is the only price column.

Return JSON only:
{"enrichments": [{"index": 0, "upc": "...", "itemCode": "...", "caseCost": 0, "discount": 0, "netCost": 0, "depositAmount": 0, "suggestedRetailPrice": 0, "packUnits": 0, "unitsPerPack": 0, "containerSize": "...", "category": "...", "transactionType": "sale", "subCategory": "..."}]}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      // Long invoices with 30+ line items can hit the default 4K output limit
      // and silently truncate mid-JSON. 16K is the gpt-4o family hard cap.
      max_tokens: 16384,
      messages: [
        { role: "system", content: "You are an invoice data enrichment engine. Return only valid JSON." },
        { role: "user",   content: prompt },
      ],
    });

    const parsed = tolerantJsonParse(response.choices[0].message.content || '', {
      finishReason: response.choices[0].finish_reason,
      context:      'enrichment',
    });
    const enrichments = (parsed.enrichments as EnrichmentRecord[] | undefined) || [];

    for (const e of enrichments) {
      if (e.index == null || e.index >= lineItems.length) continue;
      const item = lineItems[e.index];

      if (e.upc             !== undefined && e.upc         !== "") item.upc                  = String(e.upc);
      if (e.itemCode        !== undefined && e.itemCode    !== "") item.itemCode              = String(e.itemCode);

      // Session 39 Round 5 — tighter caseCost merge.
      // Azure often extracts the GROSS price column (~18.10 on a $16 NET line);
      // GPT reads the invoice layout and picks the real PRICE. Trust GPT's
      // value when it differs from Azure's by more than 5% — that's the
      // tell that Azure grabbed the wrong column.
      if (e.caseCost != null && Number(e.caseCost) > 0) {
        const gptCost = Number(e.caseCost);
        const azureCost = Number(item.caseCost || 0);
        if (!azureCost || Math.abs(gptCost - azureCost) / Math.max(azureCost, gptCost) > 0.05) {
          item.caseCost = gptCost;
        }
      }

      // Discount — always overwrite (Azure never captures this correctly)
      if (e.discount != null)                                       item.discount             = Number(e.discount) || 0;

      // netCost — prefer GPT's value. If GPT didn't give one, derive from caseCost - discount.
      if (e.netCost != null && Number(e.netCost) > 0) {
        item.netCost = Number(e.netCost);
      } else if (item.caseCost && item.discount) {
        item.netCost = Math.max(0, Number(item.caseCost) - Number(item.discount));
      }

      if (e.depositAmount != null)                                  item.depositAmount        = Number(e.depositAmount) || 0;
      if (e.suggestedRetailPrice)                                   item.suggestedRetailPrice = Number(e.suggestedRetailPrice);
      if (e.packUnits)                                              item.packUnits            = Number(e.packUnits);
      if (e.unitsPerPack)                                           item.unitsPerPack         = Number(e.unitsPerPack);
      if (e.containerSize)                                          item.containerSize        = String(e.containerSize);
      if (e.category)                                               item.category             = String(e.category);
      if (e.transactionType)                                        item.transactionType      = String(e.transactionType);
      if (e.subCategory)                                            item.subCategory          = String(e.subCategory);
    }

    console.log(`✅ GPT-4o-mini enriched ${enrichments.length}/${lineItems.length} line items`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("⚠️ GPT enrichment failed, proceeding with Azure data only:", message);
  }

  return lineItems;
};

// ─── STEP 3: GPT-4o VISION FALLBACK ──────────────────────────────────────────

/**
 * Full GPT-4o vision extraction — used when:
 *   a) Azure returns 0 line items (photo invoice, rotated, low-res)
 *   b) Azure throws entirely
 *
 * Sends the image directly to GPT-4o which handles any orientation/quality.
 * More expensive than Azure+mini but extremely robust for real-world photos.
 */
const extractWithVision = async (
  buffer: Buffer,
  mimetype: string,
): Promise<InvoiceExtraction> => {
  console.log("🟡 Running GPT-4o vision fallback extraction...");

  // Convert buffer to base64 data URL for the API
  const base64  = buffer.toString("base64");
  const dataUrl = `data:${mimetype};base64,${base64}`;

  const prompt = `You are an expert invoice data extractor. Extract ALL data from this invoice image.

Return a JSON object with this exact structure:
{
  "vendor": {
    "vendorName": "string — company name at the top of the invoice",
    "customerNumber": "string",
    "invoiceNumber": "string",
    "invoiceDate": "YYYY-MM-DD or the raw date string",
    "paymentDueDate": "YYYY-MM-DD or raw date string",
    "paymentType": "string (NET 30, etc)",
    "checkNumber": "",
    "totalInvoiceAmount": number,
    "tax": number,
    "totalDiscount": number,
    "totalDeposit": number,
    "otherFees": number,
    "totalCasesReceived": number,
    "totalUnitsReceived": number,
    "driverName": "",
    "salesRepName": "",
    "loadNumber": ""
  },
  "lineItems": [
    {
      "description": "full product name",
      "quantity": number,
      "caseCost": number (unit price / case price),
      "totalAmount": number (line total),
      "upc": "12-13 digit barcode only, else empty string",
      "itemCode": "vendor's item number or code",
      "packUnits": number (units per case, 0 if unknown),
      "unitsPerPack": number,
      "containerSize": "e.g. 1.5 QT, 12oz",
      "netCost": number,
      "depositAmount": number,
      "suggestedRetailPrice": number,
      "category": "IceCream|Beer|Wine|Spirits|Bakery|Dairy|Produce|Beverage|Snacks|Tobacco|Candy|Frozen|Grocery|Other",
      "subCategory": "",
      "transactionType": "sale",
      "plu": "",
      "discount": 0
    }
  ]
}

CRITICAL RULES:
- Extract EVERY line item that is an actual product (skip subtotals, header rows, footer notes)
- quantity: if the Ordered/Qty column is partially cut off or unreadable, default to 1
- itemCode = the Item Number / vendor code column (e.g. 2468200901). Do NOT put this in upc.
- upc = only real 12-13 digit UPC barcodes. If there is no barcode column, leave "" for all items.
- caseCost = the GROSS case price (PRICE column, before any discount)
- discount = the DISC/DISCOUNT/ALLOW column value per case, else 0
- netCost = the NET case cost (caseCost - discount). If invoice prints a NET column, use that.
            Always fill BOTH caseCost AND netCost. They may be equal when there is no discount.
- depositAmount = the DEP / BOTTLE DEPOSIT column per case, else 0
- totalAmount = the EXT / Total / Amount column for that line. If blank, use (netCost + depositAmount) × quantity.
- transactionType = "credit" if quantity is negative OR the line says DAMAGED/RETURN/CREDIT/STALES. Keep the visible qty sign.
- If invoice says "*** CONTINUED ***" that means this is page 1 — extract everything visible
- NEVER return an empty lineItems array if you can see product rows in the image
- Return only valid JSON, no markdown`;

  const response = await openai.chat.completions.create({
    model:       "gpt-4o",
    temperature: 0,
    response_format: { type: "json_object" },
    // 4096 was too small — multi-page invoices with 30+ line items (e.g. the
    // A.S.D.K. Ram Corp / Merrimack Valley Distributing invoices with 37+
    // products and many columns per row) truncate to ~12 KB of JSON which
    // throws "Unterminated string in JSON at position 12294". 16384 is the
    // gpt-4o family hard cap; tolerantJsonParse handles edge cases where
    // even that isn't enough.
    max_tokens: 16384,
    messages: [
      {
        role:    "system",
        content: "You are a precise invoice data extraction engine. Return only valid JSON matching the requested schema.",
      },
      {
        role:    "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          { type: "text",      text: prompt },
        ],
      },
    ],
  });

  const raw = tolerantJsonParse(response.choices[0].message.content || '', {
    finishReason: response.choices[0].finish_reason,
    context:      'vision',
  });

  // Vision JSON shape mirrors Azure's at the field level — both pass through
  // the same prompt-defined contract. We narrow loosely + cast the Vendor
  // assembly below so the return type matches InvoiceExtraction.
  const vendor    = (raw.vendor as Partial<InvoiceVendor>) || {};
  const lineItems: InvoiceLineItem[] = ((raw.lineItems as Array<Partial<InvoiceLineItem>>) || []).map((item): InvoiceLineItem => {
    const caseCost = Number(item.caseCost || 0);
    const discount = Number(item.discount || 0);
    // Prefer explicit netCost from the invoice; fall back to caseCost - discount
    // (Session 39 Round 5 — ensures the cost-proximity tier compares against the
    // real post-discount price the store actually pays).
    const netCost = item.netCost != null && Number(item.netCost) > 0
      ? Number(item.netCost)
      : Math.max(0, caseCost - discount);
    return {
      upc:                  item.upc                  || "",
      itemCode:             item.itemCode             || "",
      plu:                  item.plu                  || "",
      description:          item.description          || "",
      packUnits:            Number(item.packUnits      || 0),
      unitsPerPack:         Number(item.unitsPerPack   || 0),
      containerSize:        item.containerSize         || "",
      quantity:             Number(item.quantity        || 1),
      unitType:             "case",
      caseCost,
      netCost,
      unitCost:             0,
      depositAmount:        Number(item.depositAmount   || 0),
      totalAmount:          Number(item.totalAmount     || 0),
      suggestedRetailPrice: Number(item.suggestedRetailPrice || 0),
      discount,
      transactionType:      item.transactionType        || "sale",
      category:             item.category               || "Other",
      subCategory:          item.subCategory            || "",
    };
  });

  console.log(`✅ GPT-4o vision extracted: vendor="${vendor.vendorName || '?'}", ${lineItems.length} line items`);

  return {
    vendor: {
      vendorName:          (vendor.vendorName          || "").trim(),
      customerNumber:      vendor.customerNumber        || "",
      invoiceNumber:       (vendor.invoiceNumber        || "").trim(),
      invoiceDate:         vendor.invoiceDate           || "",
      paymentDueDate:      vendor.paymentDueDate        || "",
      paymentType:         vendor.paymentType           || "",
      checkNumber:         vendor.checkNumber           || "",
      totalInvoiceAmount:  Number(vendor.totalInvoiceAmount  || 0),
      tax:                 Number(vendor.tax                 || 0),
      totalDiscount:       Number(vendor.totalDiscount       || 0),
      totalDeposit:        Number(vendor.totalDeposit        || 0),
      otherFees:           Number(vendor.otherFees           || 0),
      totalCasesReceived:  Number(vendor.totalCasesReceived  || 0),
      totalUnitsReceived:  Number(vendor.totalUnitsReceived  || 0),
      driverName:          vendor.driverName             || "",
      salesRepName:        vendor.salesRepName           || "",
      loadNumber:          vendor.loadNumber             || "",
    },
    lineItems,
    rawContent: "", // vision path has no separate rawContent
  };
};

// ─── DISPLAY PAGE GENERATION ───────────────────────────────────────────────────

const generateDisplayPages = async (
  buffer: Buffer,
  mimetype: string,
): Promise<string[]> => {
  let tempDir: string | null = null;
  try {
    if (mimetype === "application/pdf") {
      tempDir = path.join(__dirname, "../../uploads/temp", `preview_${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });

      const convert = fromBuffer(buffer, {
        density:      150,
        saveFilename: "page",
        savePath:     tempDir,
        format:       "png",
        width:        1200,
        height:       1600,
      });

      const pages  = await convert.bulk(-1);
      const images: string[] = [];
      for (const page of pages as Array<{ path: string }>) {
        const base64 = await fs.readFile(page.path, "base64");
        images.push(`data:image/png;base64,${base64}`);
      }
      return images;
    } else {
      // For image files, use the original directly
      return [`data:${mimetype};base64,${buffer.toString("base64")}`];
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("⚠️ Display page generation failed:", message);
    return [];
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
};

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

/**
 * Extract invoice data. Returns { data: { vendor, lineItems }, pages: string[] }
 *
 * Pipeline:
 *   1. Azure Document Intelligence → structured extraction
 *   2. GPT-4o-mini text enrichment (always, if Azure succeeded)
 *   3. GPT-4o vision fallback (only when Azure returns < 2 items)
 *   4. Validate, normalize, reconcile
 */
export const extractInvoiceData = async (
  buffer: Buffer,
  mimetype: string,
): Promise<ExtractInvoiceResult> => {
  try {
    // Session 39 Round 5 — transcode HEIC/HEIF to JPEG before anything
    // touches the buffer. Azure + OpenAI Vision both reject HEIC directly.
    const normalizedInput = await normalizeImageBuffer(buffer, mimetype);
    buffer   = normalizedInput.buffer;
    mimetype = normalizedInput.mimetype;

    // Run page generation in parallel with extraction (display only)
    const pagesPromise = generateDisplayPages(buffer, mimetype);

    let vendor: InvoiceVendor | null = null;
    let lineItems: InvoiceLineItem[] = [];
    let rawContent = "";
    let usedVision = false;

    // ── Try Azure first ──────────────────────────────────────────────────────
    try {
      const azureResult = await extractWithAzure(buffer, mimetype);
      vendor     = azureResult.vendor;
      lineItems  = azureResult.lineItems;
      rawContent = azureResult.rawContent ?? '';
    } catch (azureErr) {
      const message = azureErr instanceof Error ? azureErr.message : String(azureErr);
      console.warn("⚠️ Azure extraction failed:", message);
      // Azure failed entirely — will fall through to vision
    }

    // ── Vision fallback: Azure returned < 2 items OR failed completely ───────
    // (A single item might just be a header row that survived filtering)
    if (lineItems.length < 2) {
      if (lineItems.length === 0) {
        console.log("ℹ️ Azure returned 0 line items — triggering GPT-4o vision fallback");
      } else {
        console.log(`ℹ️ Azure returned only ${lineItems.length} item(s) — triggering GPT-4o vision fallback for better coverage`);
      }

      try {
        const visionResult = await extractWithVision(buffer, mimetype);

        // Use vision result if it gives us more items, or if Azure gave us nothing
        if (visionResult.lineItems.length > lineItems.length) {
          vendor     = visionResult.vendor;
          lineItems  = visionResult.lineItems;
          rawContent = visionResult.rawContent ?? '';
          usedVision = true;
        }
      } catch (visionErr) {
        const message = visionErr instanceof Error ? visionErr.message : String(visionErr);
        console.warn("⚠️ GPT-4o vision fallback also failed:", message);
        // Both failed — throw with combined context
        if (lineItems.length === 0) {
          throw new Error(`Both Azure and GPT-4o vision failed to extract invoice data. Azure error: ${message}`);
        }
      }
    }

    // ── GPT-4o-mini enrichment (runs on Azure path only; vision already enriched) ──
    if (!usedVision && rawContent) {
      lineItems = await enrichLineItems(lineItems, rawContent);
    }

    // ── Vendor name fallback from raw OCR content ─────────────────────────────
    // Azure may not extract VendorName when it's inside a logo graphic.
    // Try to find it in the raw OCR text before giving up.
    if (vendor && !vendor.vendorName && rawContent) {
      // Take the first non-empty line from the OCR content as vendor name
      const firstLines = rawContent
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 3 && !/^\d+$/.test(l)); // skip pure-number lines
      if (firstLines[0]) {
        vendor.vendorName = firstLines[0].substring(0, 80);
        console.log(`ℹ️ Vendor name derived from OCR text: "${vendor.vendorName}"`);
      }
    }

    const result: InvoiceExtraction = { vendor: vendor || ({} as InvoiceVendor), lineItems };
    const normalized = validateAndNormalize(result);

    if (!normalized) {
      throw new Error("Normalization failed — empty result from extraction");
    }

    if (normalized.lineItems.length === 0) {
      throw new Error(
        "No line items could be extracted from this invoice. " +
        "Please ensure the invoice is legible and not heavily rotated."
      );
    }

    // Vendor name is now a soft warning — don't throw
    if (!normalized.vendor.vendorName) {
      console.warn("⚠️ Could not determine vendor name — user can fill it in manually");
      normalized.vendor.vendorName = "Unknown Vendor";
    }

    // Reconciliation check (informational only)
    const reconciliation = performReconciliation(normalized);
    if (!reconciliation.isValid) {
      console.warn(
        `⚠️ Total mismatch: computed $${reconciliation.computedTotal.toFixed(2)}, ` +
        `expected $${reconciliation.expectedTotal.toFixed(2)} ` +
        `(diff $${reconciliation.mismatch.toFixed(2)}) — may be multi-page invoice`
      );
    }

    const pages = await pagesPromise;
    console.log(`✅ Extraction complete: ${normalized.lineItems.length} items, vendor="${normalized.vendor.vendorName}", vision=${usedVision}`);

    return { data: normalized, pages };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Invoice extraction error:", message);
    throw new Error(`Failed to extract invoice data: ${message}`);
  }
};

// ─── MULTI-PAGE EXPORT ────────────────────────────────────────────────────────

/**
 * Extract and merge data from multiple files that are pages of the same invoice.
 * - Generates display pages for all files in parallel
 * - Extracts invoice data from each file, then merges:
 *     • Vendor header taken from the first successful extraction
 *     • All line items concatenated (no dedup — user reviews in UI)
 * Returns { data: { vendor, lineItems }, pages: string[] }
 */
export const extractMultiplePages = async (
  files: MultipageFile[],
): Promise<ExtractInvoiceResult> => {
  // Session 39 Round 5 — normalise every input file to JPEG/PDF before
  // extraction so HEIC/HEIF photos don't silently fail mid-batch.
  const normalized = await Promise.all(
    files.map(async (f): Promise<MultipageFile> => {
      try { return await normalizeImageBuffer(f.buffer, f.mimetype); }
      catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn('⚠️ Image normalize failed for one page:', message);
        return f;
      }
    })
  );
  files = normalized;

  // Generate display pages for every file in parallel
  const pagesResults = await Promise.all(
    files.map(({ buffer, mimetype }) => generateDisplayPages(buffer, mimetype).catch(() => []))
  );
  const combinedPages = pagesResults.flat();

  // Extract invoice data from each file sequentially to avoid rate-limit bursts
  const extractions: InvoiceExtraction[] = [];
  for (const { buffer, mimetype } of files) {
    try {
      const result = await extractInvoiceData(buffer, mimetype);
      extractions.push(result.data);
      console.log(`  📄 Page extracted: ${result.data.lineItems?.length ?? 0} items`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("  ⚠️ Page extraction failed:", message);
    }
  }

  if (extractions.length === 0) {
    throw new Error("All page extractions failed — no data could be read from the uploaded files");
  }

  // ── Pick best vendor header (not just first page) ─────────────────────────
  // Choose the extraction with the most vendor fields populated
  const vendorQuality = (v: InvoiceVendor | null | undefined): number => {
    if (!v) return 0;
    let score = 0;
    if (v.vendorName) score += 3;
    if (v.invoiceNumber) score += 2;
    if (v.invoiceDate) score += 1;
    if (v.totalInvoiceAmount) score += 1;
    if (v.customerNumber) score += 1;
    return score;
  };
  const bestVendorIdx = extractions.reduce((bestIdx, e, idx) =>
    vendorQuality(e.vendor) > vendorQuality(extractions[bestIdx]?.vendor) ? idx : bestIdx
  , 0);

  // ── Tag each line item with its page number ──────────────────────────────
  const taggedItems: InvoiceLineItem[] = extractions.flatMap((e, pageIdx) =>
    (e.lineItems || []).map((item): InvoiceLineItem => ({ ...item, _pageNumber: pageIdx + 1 }))
  );

  // ── Deduplicate: merge items with same itemCode + description + qty ──────
  const deduped: InvoiceLineItem[] = [];
  const seen = new Map<string, number>(); // key → index in deduped

  for (const item of taggedItems) {
    const key = [
      (item.itemCode || '').trim().toLowerCase(),
      (item.description || '').trim().toLowerCase().slice(0, 40),
      String(item.quantity || 1),
    ].join('|');

    if (key && key !== '||1' && seen.has(key)) {
      // Duplicate detected — skip (keep the first occurrence)
      console.log(`  🔄 Dedup: skipping duplicate "${item.description}" (page ${item._pageNumber})`);
    } else {
      seen.set(key, deduped.length);
      deduped.push(item);
    }
  }

  const merged: InvoiceExtraction = {
    vendor: { ...extractions[bestVendorIdx].vendor },
    lineItems: deduped,
  };

  // Sum numeric totals across pages
  if (extractions.length > 1) {
    merged.vendor.totalCasesReceived = extractions.reduce((s, e) => s + (e.vendor?.totalCasesReceived || 0), 0);
    merged.vendor.totalUnitsReceived = extractions.reduce((s, e) => s + (e.vendor?.totalUnitsReceived || 0), 0);
  }

  const removed = taggedItems.length - deduped.length;
  console.log(`✅ Multi-page merge: ${extractions.length} pages → ${taggedItems.length} items → ${deduped.length} after dedup (${removed} duplicates removed)`);
  return { data: merged, pages: combinedPages };
};
