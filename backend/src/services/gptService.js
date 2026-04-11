/**
 * gptService.js — Invoice Extraction (Azure + GPT-4o Hybrid)
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

const validateAndNormalize = (result) => {
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

const performReconciliation = (result) => {
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
const isLikelyUPC = (code) => {
  const clean = (code || "").replace(/\s/g, "");
  return /^\d{7,14}$/.test(clean);
};

const extractWithAzure = async (buffer, mimetype) => {
  const client = getAzureClient();

  console.log("🔵 Starting Azure Document Intelligence extraction...");
  const poller = await client.beginAnalyzeDocument("prebuilt-invoice", buffer, {
    contentType: mimetype,
  });

  const result = await poller.pollUntilDone();

  if (!result.documents || result.documents.length === 0) {
    throw new Error("Azure Document Intelligence returned no documents");
  }

  const invoice    = result.documents[0];
  const f          = invoice.fields;
  const rawContent = result.content || ""; // full OCR text → used for GPT enrichment

  // ── Vendor-level fields ──
  const vendor = {
    vendorName:           f.VendorName?.value             || "",
    customerNumber:       f.CustomerId?.value             || "",
    invoiceNumber:        f.InvoiceId?.value              || "",
    invoiceDate:          f.InvoiceDate?.value            ? String(f.InvoiceDate.value)   : "",
    paymentDueDate:       f.DueDate?.value                ? String(f.DueDate.value)        : "",
    paymentType:          f.PaymentTerm?.value            || "",
    checkNumber:          "",
    totalInvoiceAmount:   f.InvoiceTotal?.value?.amount   || f.AmountDue?.value?.amount   || 0,
    tax:                  f.TotalTax?.value?.amount       || 0,
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
  const lineItems = (f.Items?.values || []).map((item) => {
    const p           = item.properties || {};
    const productCode = p.ProductCode?.value || "";

    // Store numeric codes in both fields — many vendors use their item# as UPC
    return {
      upc:                  isLikelyUPC(productCode) ? productCode : "",
      itemCode:             productCode, // always preserve the raw code for matching
      plu:                  "",
      description:          p.Description?.value || "",
      packUnits:            0,          // enriched by GPT
      unitsPerPack:         0,          // enriched by GPT
      containerSize:        "",
      quantity:             Number(p.Quantity?.value  || 0),
      unitType:             p.Unit?.value             || "case",
      caseCost:             p.UnitPrice?.value?.amount || 0,
      netCost:              0,          // enriched by GPT
      unitCost:             0,          // recalculated after enrichment
      depositAmount:        0,          // enriched by GPT
      totalAmount:          p.Amount?.value?.amount   || 0,
      suggestedRetailPrice: 0,          // enriched by GPT
      discount:             p.Tax?.value?.amount      || 0,
      transactionType:      "sale",
      category:             "Other",
      subCategory:          "",
    };
  });

  console.log(`✅ Azure extracted: vendor="${vendor.vendorName}", invoice="${vendor.invoiceNumber}", ${lineItems.length} line items`);

  return { vendor, lineItems, rawContent };
};

// ─── STEP 2: GPT-4o-mini TEXT ENRICHMENT ──────────────────────────────────────

const enrichLineItems = async (lineItems, rawContent) => {
  if (!lineItems.length || !rawContent) return lineItems;

  const truncatedContent = rawContent.slice(0, 6000);
  const itemsJson = JSON.stringify(
    lineItems.map((item, i) => ({
      index:       i,
      description: item.description,
      upc:         item.upc,
      itemCode:    item.itemCode,
      quantity:    item.quantity || 1,
      caseCost:    item.caseCost,
      totalAmount: item.totalAmount,
    })),
    null, 2
  );

  const prompt = `You are enriching extracted invoice line items with specialized fields.

FULL INVOICE TEXT (from OCR):
${truncatedContent}

ALREADY EXTRACTED LINE ITEMS (add missing fields to each):
${itemsJson}

For each item, identify from the invoice text:
1. upc — if invoice has a U.P.C./BARCODE column with a 12-13 digit value, put it here; otherwise leave ""
2. itemCode — vendor's internal code (ITEM#, CODE, Item Number column); even if it looks numeric
3. caseCost — wholesale case cost (NET, WHSL, COST, or Unit Price column)
4. netCost — cost after discount/allowance if separate column, else 0
5. depositAmount — deposit per case (DEP column), else 0
6. suggestedRetailPrice — vendor's suggested shelf price (SSP, SRP column), else 0
7. packUnits — from pack format like "6/12oz" = 6 (first number), else 0
8. unitsPerPack — from pack format like "6/12oz" = 12 (second number), else 0
9. containerSize — e.g. "12oz", "750ml", "1L", "1.5 QT"
10. category — one of: Beer|Wine|Spirits|Bakery|Dairy|Produce|Beverage|Snacks|Tobacco|Candy|Frozen|Grocery|IceCream|Other
11. transactionType — "credit" if quantity is negative or item is in a STALES/RETURNS section, else "sale"
12. subCategory — optional, e.g. "IPA", "Lager", "Vanilla"

RULES:
- Item Number / CODE column → itemCode. If it is purely numeric (7+ digits), ALSO copy it to upc (many vendors like Hershey's use their item# as their UPC barcode).
- If there is a separate dedicated UPC/BARCODE column, that takes priority for the upc field.
- If no DEP column exists, depositAmount = 0

Return JSON only:
{"enrichments": [{"index": 0, "upc": "...", "itemCode": "...", "caseCost": 0, "netCost": 0, "depositAmount": 0, "suggestedRetailPrice": 0, "packUnits": 0, "unitsPerPack": 0, "containerSize": "...", "category": "...", "transactionType": "sale", "subCategory": "..."}]}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are an invoice data enrichment engine. Return only valid JSON." },
        { role: "user",   content: prompt },
      ],
    });

    const parsed      = JSON.parse(response.choices[0].message.content);
    const enrichments = parsed.enrichments || [];

    for (const e of enrichments) {
      if (e.index == null || e.index >= lineItems.length) continue;
      const item = lineItems[e.index];

      if (e.upc             !== undefined && e.upc         !== "") item.upc                  = e.upc;
      if (e.itemCode        !== undefined && e.itemCode    !== "") item.itemCode              = e.itemCode;
      if (e.caseCost)                                               item.caseCost             = Number(e.caseCost);
      if (e.netCost)                                                item.netCost              = Number(e.netCost);
      if (e.depositAmount)                                          item.depositAmount        = Number(e.depositAmount);
      if (e.suggestedRetailPrice)                                   item.suggestedRetailPrice = Number(e.suggestedRetailPrice);
      if (e.packUnits)                                              item.packUnits            = Number(e.packUnits);
      if (e.unitsPerPack)                                           item.unitsPerPack         = Number(e.unitsPerPack);
      if (e.containerSize)                                          item.containerSize        = e.containerSize;
      if (e.category)                                               item.category             = e.category;
      if (e.transactionType)                                        item.transactionType      = e.transactionType;
      if (e.subCategory)                                            item.subCategory          = e.subCategory;
    }

    console.log(`✅ GPT-4o-mini enriched ${enrichments.length}/${lineItems.length} line items`);
  } catch (err) {
    console.warn("⚠️ GPT enrichment failed, proceeding with Azure data only:", err.message);
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
const extractWithVision = async (buffer, mimetype) => {
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
- caseCost = the per-case wholesale price (Unit Price column)
- totalAmount = the Price/Total column for that line. If blank, use caseCost × quantity.
- If invoice says "*** CONTINUED ***" that means this is page 1 — extract everything visible
- NEVER return an empty lineItems array if you can see product rows in the image
- Return only valid JSON, no markdown`;

  const response = await openai.chat.completions.create({
    model:       "gpt-4o",
    temperature: 0,
    response_format: { type: "json_object" },
    max_tokens: 4096,
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

  const raw = JSON.parse(response.choices[0].message.content);

  const vendor    = raw.vendor    || {};
  const lineItems = (raw.lineItems || []).map((item) => ({
    upc:                  item.upc                  || "",
    itemCode:             item.itemCode             || "",
    plu:                  item.plu                  || "",
    description:          item.description          || "",
    packUnits:            Number(item.packUnits      || 0),
    unitsPerPack:         Number(item.unitsPerPack   || 0),
    containerSize:        item.containerSize         || "",
    quantity:             Number(item.quantity        || 1),
    unitType:             "case",
    caseCost:             Number(item.caseCost        || 0),
    netCost:              Number(item.netCost         || 0),
    unitCost:             0,
    depositAmount:        Number(item.depositAmount   || 0),
    totalAmount:          Number(item.totalAmount     || 0),
    suggestedRetailPrice: Number(item.suggestedRetailPrice || 0),
    discount:             Number(item.discount        || 0),
    transactionType:      item.transactionType        || "sale",
    category:             item.category               || "Other",
    subCategory:          item.subCategory            || "",
  }));

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

const generateDisplayPages = async (buffer, mimetype) => {
  let tempDir = null;
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
      const images = [];
      for (const page of pages) {
        const base64 = await fs.readFile(page.path, "base64");
        images.push(`data:image/png;base64,${base64}`);
      }
      return images;
    } else {
      // For image files, use the original directly
      return [`data:${mimetype};base64,${buffer.toString("base64")}`];
    }
  } catch (err) {
    console.warn("⚠️ Display page generation failed:", err.message);
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
export const extractInvoiceData = async (buffer, mimetype) => {
  try {
    // Run page generation in parallel with extraction (display only)
    const pagesPromise = generateDisplayPages(buffer, mimetype);

    let vendor    = null;
    let lineItems = [];
    let rawContent = "";
    let usedVision = false;

    // ── Try Azure first ──────────────────────────────────────────────────────
    try {
      const azureResult = await extractWithAzure(buffer, mimetype);
      vendor     = azureResult.vendor;
      lineItems  = azureResult.lineItems;
      rawContent = azureResult.rawContent;
    } catch (azureErr) {
      console.warn("⚠️ Azure extraction failed:", azureErr.message);
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
          rawContent = visionResult.rawContent;
          usedVision = true;
        }
      } catch (visionErr) {
        console.warn("⚠️ GPT-4o vision fallback also failed:", visionErr.message);
        // Both failed — throw with combined context
        if (lineItems.length === 0) {
          throw new Error(`Both Azure and GPT-4o vision failed to extract invoice data. Azure error: ${visionErr.message}`);
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

    const result    = { vendor: vendor || {}, lineItems };
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
    console.error("❌ Invoice extraction error:", error.message);
    throw new Error(`Failed to extract invoice data: ${error.message}`);
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
export const extractMultiplePages = async (files) => {
  // Generate display pages for every file in parallel
  const pagesResults = await Promise.all(
    files.map(({ buffer, mimetype }) => generateDisplayPages(buffer, mimetype).catch(() => []))
  );
  const combinedPages = pagesResults.flat();

  // Extract invoice data from each file sequentially to avoid rate-limit bursts
  const extractions = [];
  for (const { buffer, mimetype } of files) {
    try {
      const result = await extractInvoiceData(buffer, mimetype);
      extractions.push(result.data);
      console.log(`  📄 Page extracted: ${result.data.lineItems?.length ?? 0} items`);
    } catch (err) {
      console.error("  ⚠️ Page extraction failed:", err.message);
    }
  }

  if (extractions.length === 0) {
    throw new Error("All page extractions failed — no data could be read from the uploaded files");
  }

  // ── Pick best vendor header (not just first page) ─────────────────────────
  // Choose the extraction with the most vendor fields populated
  const vendorQuality = (v) => {
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
  const taggedItems = extractions.flatMap((e, pageIdx) =>
    (e.lineItems || []).map(item => ({ ...item, _pageNumber: pageIdx + 1 }))
  );

  // ── Deduplicate: merge items with same itemCode + description + qty ──────
  const deduped = [];
  const seen = new Map(); // key → index in deduped

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

  const merged = {
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
