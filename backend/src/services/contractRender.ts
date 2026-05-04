/**
 * S77 Phase 2 — Contract HTML rendering
 *
 * Substitutes {{merge.field}} placeholders in a template's bodyHtml with
 * concrete values from a Contract.mergeValues object. Also injects:
 *   <!--HARDWARE_ROWS-->   → dynamic equipment table rows
 *   <!--SIGNATURE_BLOCK--> → already in template; signature.* tags fill it
 *
 * Pure function — no DB / no IO. Called from the controller and the PDF
 * generator. Output is plain HTML ready for either preview or Puppeteer.
 */

// HTML-escape a value before injecting into the document.
function escHtml(v: unknown): string {
  if (v === null || v === undefined) return '________';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Format helpers for typed merge fields.
function fmt(value: unknown, type: string | undefined): string {
  if (value === null || value === undefined || value === '') return '________';
  switch (type) {
    case 'currency': {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(2) : escHtml(value);
    }
    case 'date': {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return escHtml(value);
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    default:
      return escHtml(value);
  }
}

// Walk a dotted path on a nested object.
function getPath(obj: any, path: string): any {
  if (!obj) return undefined;
  return path.split('.').reduce((acc: any, k: string) => (acc == null ? undefined : acc[k]), obj);
}

// Build the dynamic hardware rows from mergeValues.pricing.hardware[].
function buildHardwareRowsHtml(items: Array<{ description?: string; model?: string; qty?: number; unitPrice?: number; total?: number }>): string {
  if (!items || items.length === 0) {
    return '<tr><td colspan="2"><p><em>No hardware ordered.</em></p></td><td><p>—</p></td></tr>';
  }
  return items
    .map((h) => {
      const desc = escHtml((h.model ? `${h.description} — ${h.model}` : h.description) || '—');
      const qty = h.qty ?? 0;
      const unit = (Number(h.unitPrice) || 0).toFixed(2);
      const total = (Number(h.total ?? (Number(h.qty) || 0) * (Number(h.unitPrice) || 0))).toFixed(2);
      return `<tr>
        <td><p>${desc}</p></td>
        <td><p>Qty: ${qty} units</p></td>
        <td><p>$ ${unit}</p></td>
        <td><p>$ ${total}</p></td>
      </tr>`;
    })
    .join('');
}

interface MergeFieldDef {
  key: string;
  type?: string;
  default?: unknown;
}
interface MergeFields {
  fields?: MergeFieldDef[];
}

export interface RenderOptions {
  // When true, replaces signature.* placeholders with the real signature data
  // in mergeValues.signature. Otherwise leaves the placeholders intact (used
  // by the admin preview pane before signing).
  withSignature?: boolean;
}

/**
 * Main entry point.
 *   templateBodyHtml — raw HTML from ContractTemplateVersion.bodyHtml
 *   templateMergeFields — for default lookups by field key
 *   mergeValues — the contract's filled-in values (nested object)
 */
export function renderContract(
  templateBodyHtml: string,
  templateMergeFields: MergeFields,
  mergeValues: Record<string, any>,
  options: RenderOptions = {},
): string {
  if (!templateBodyHtml) return '';
  let html = templateBodyHtml;

  // 1. Build a map of field type by key for proper formatting.
  const typeByKey: Record<string, string | undefined> = {};
  const defaultByKey: Record<string, unknown> = {};
  for (const f of templateMergeFields?.fields ?? []) {
    typeByKey[f.key] = f.type;
    if ('default' in f) defaultByKey[f.key] = f.default;
  }

  // Keys whose value is intentionally raw HTML (e.g. the signature <img> tag
  // injected at sign-time). These bypass HTML escaping. ANY other field is
  // always escaped to prevent XSS via injected mergeValues.
  const RAW_HTML_KEYS = new Set(['signature.imageHtml']);

  // 2. Replace every {{key}} placeholder.
  html = html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => {
    // Skip signature.* keys when rendering pre-sign preview.
    if (!options.withSignature && key.startsWith('signature.')) {
      return `{{${key}}}`;
    }
    let v = getPath(mergeValues, key);
    if (v === undefined || v === null || v === '') v = defaultByKey[key];
    if (RAW_HTML_KEYS.has(key)) {
      // Trusted at write-time: this is the <img src="data:..."> we built
      // ourselves in the sign handler, never user-supplied HTML.
      return v == null ? '' : String(v);
    }
    return fmt(v, typeByKey[key]);
  });

  // 3. Inject hardware rows.
  const hardware = mergeValues?.pricing?.hardware ?? [];
  html = html.replace('<!--HARDWARE_ROWS-->', buildHardwareRowsHtml(hardware));

  return html;
}

/**
 * Wrap rendered body HTML in a complete, print-ready HTML document.
 * Used by the PDF generator and the vendor signing page.
 */
export function buildFullHtmlDocument(bodyHtml: string, title = 'Merchant Services Agreement'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escHtml(title)}</title>
  <style>
    @page { size: Letter; margin: 0.75in 0.75in; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 11pt;
      line-height: 1.45;
      color: #111827;
      margin: 0;
      padding: 0;
    }
    h1, h2, h3 { color: #0f172a; margin: 18px 0 8px; }
    p { margin: 0 0 8px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
    }
    table, th, td {
      border: 1px solid #cbd5e1;
    }
    th, td {
      padding: 6px 10px;
      vertical-align: top;
      font-size: 10.5pt;
    }
    th { background: #f1f5f9; text-align: left; }
    strong { color: #0f172a; }
    em { color: #475569; }
    .signature-block { page-break-inside: avoid; }
    .signature-block table, .signature-block td { border: none !important; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
