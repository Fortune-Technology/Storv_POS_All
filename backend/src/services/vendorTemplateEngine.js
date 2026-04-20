/**
 * vendorTemplateEngine.js — Session 5
 *
 * Applies a VendorImportTemplate to a parsed CSV/XLSX. For each row, runs the
 * template's per-column mappings (vendor column → target field + optional
 * transform) and returns canonical rows matching our normal import shape.
 *
 * Transforms are intentionally small and data-focused — no general-purpose
 * JS sandbox. They handle real patterns observed in vendor files (AGNE's
 * leading-zero UPCs, Sante's `_`-prefixed barcodes, Pine State's Excel serial
 * dates, case-deposit derived from per-unit × packs, etc.).
 *
 * Adding a new transform: just drop a function into TRANSFORMS. All transforms
 * accept (value, args, row) and return the cooked value.
 */

// ─── Transform library ──────────────────────────────────────────────────────
// Each transform signature: (rawValue, args, fullRow) => cookedValue
// Return `null` / '' to mean "no value"; throwing indicates a bad input.

export const TRANSFORMS = {
  // String cleanups
  trim_leading_zero: (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    if (s === '') return null;
    // "0", "00", "000000" → null (empty-ish numeric placeholder)
    const stripped = s.replace(/^0+/, '');
    return stripped || null;
  },
  strip_prefix: (v, { prefix = '' } = {}) => {
    if (v == null) return v;
    const s = String(v).trim();
    if (!prefix) return s;
    return s.startsWith(prefix) ? s.slice(prefix.length) : s;
  },
  strip_suffix: (v, { suffix = '' } = {}) => {
    if (v == null) return v;
    const s = String(v).trim();
    if (!suffix) return s;
    return s.endsWith(suffix) ? s.slice(0, -suffix.length) : s;
  },
  trim: (v) => (v == null ? v : String(v).trim()),
  uppercase: (v) => (v == null ? v : String(v).toUpperCase()),
  lowercase: (v) => (v == null ? v : String(v).toLowerCase()),
  digits_only: (v) => (v == null ? v : String(v).replace(/\D/g, '')),

  // Numeric
  parse_currency: (v) => {
    if (v == null || String(v).trim() === '') return null;
    const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
    return isNaN(n) ? null : n;
  },
  parse_number: (v) => {
    if (v == null || String(v).trim() === '') return null;
    const n = parseFloat(String(v).replace(/[,\s]/g, ''));
    return isNaN(n) ? null : n;
  },
  parse_integer: (v) => {
    if (v == null || String(v).trim() === '') return null;
    const n = parseInt(String(v).trim(), 10);
    return isNaN(n) ? null : n;
  },
  parse_boolean: (v) => {
    if (v == null || v === '') return null;
    return ['true','yes','1','y','x','t'].includes(String(v).toLowerCase().trim());
  },

  // Row arithmetic — uses another column's value
  multiply_by_col: (v, { by }, row) => {
    const a = parseFloat(String(v || '').replace(/[,$\s]/g, ''));
    const b = parseFloat(String(row[by] || '').replace(/[,$\s]/g, ''));
    if (isNaN(a) || isNaN(b)) return null;
    return +(a * b).toFixed(4);
  },
  divide_by_col: (v, { by }, row) => {
    const a = parseFloat(String(v || '').replace(/[,$\s]/g, ''));
    const b = parseFloat(String(row[by] || '').replace(/[,$\s]/g, ''));
    if (isNaN(a) || isNaN(b) || b === 0) return null;
    return +(a / b).toFixed(4);
  },
  multiply_by: (v, { factor = 1 } = {}) => {
    const n = parseFloat(String(v || '').replace(/[,$\s]/g, ''));
    return isNaN(n) ? null : +(n * factor).toFixed(4);
  },

  // Date parsing — common vendor formats
  yyyymmdd_to_date: (v) => {
    if (!v) return null;
    const s = String(v).trim();
    if (s.length !== 8 || !/^\d{8}$/.test(s)) return null;
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  },
  excel_serial_to_date: (v) => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (isNaN(n)) return null;
    // Excel epoch: 1900-01-01 is serial 1 (with the 1900 leap-year bug).
    // Serial 25569 == 1970-01-01. Subtract and scale to ms.
    const ms = Math.round((n - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  },
  parse_date: (v) => {
    if (!v) return null;
    const d = new Date(String(v).trim());
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  },

  // Text splitting / extraction
  split_pick: (v, { sep = ',', index = 0 } = {}) => {
    if (v == null) return v;
    const parts = String(v).split(sep).map(s => s.trim());
    return parts[index] ?? null;
  },
  concat: (v, { cols = [], separator = ' ' } = {}, row) => {
    const pieces = cols.map(c => row[c]).filter(p => p != null && String(p).trim() !== '').map(String);
    return pieces.join(separator);
  },

  // Key-Value compound fields (Sante's "Tags" column)
  // Format: "Key: Value / Key: Value / ..." — returns an object
  parse_kv_pairs: (v, { pairSep = ' / ', kvSep = ': ' } = {}) => {
    if (!v) return {};
    const out = {};
    for (const chunk of String(v).split(pairSep)) {
      const [k, ...rest] = chunk.split(kvSep);
      if (!k) continue;
      out[k.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')] = rest.join(kvSep).trim();
    }
    return out;
  },
};

// ─── Core: apply a template to parsed rows ───────────────────────────────────
// Returns { transformedRows, warnings }.
// `rawRows` — array of objects keyed by vendor column headers (exactly as they
//             appear in the file).
// `template` — { mappings: [{ vendorColumn, targetField, transform, transformArgs, constantValue, skip }] }
export function applyTemplate(rawRows, template) {
  const mappings = template?.mappings || [];
  const warnings = [];

  // Build a lookup: vendorColumn → mapping (lowercased so matching is tolerant)
  const byCol = new Map();
  for (const m of mappings) {
    if (!m.vendorColumn) continue;
    byCol.set(String(m.vendorColumn).toLowerCase().trim(), m);
  }

  const transformed = rawRows.map((row, rowIdx) => {
    const canonical = {};

    // Pass 1 — apply mappings we have
    for (const m of mappings) {
      if (m.skip) continue;
      if (!m.targetField) continue;

      let value;
      if (m.constantValue != null && m.constantValue !== '') {
        value = m.constantValue;
      } else {
        const rawVal = row[m.vendorColumn];
        if (rawVal == null || rawVal === '') {
          // Only apply transform when there's a value OR the transform doesn't need one
          if (!m.transform) continue;
        }
        try {
          const fn = m.transform ? TRANSFORMS[m.transform] : null;
          value = fn ? fn(rawVal, m.transformArgs || {}, row) : rawVal;
        } catch (err) {
          warnings.push({ row: rowIdx + 1, column: m.vendorColumn, error: err.message });
          continue;
        }
      }

      if (value == null || value === '') continue;

      // Some transforms return a compound object (parse_kv_pairs); merge into
      // the attributes bucket when target is "attributes", otherwise stringify.
      if (m.targetField === 'attributes' && typeof value === 'object') {
        canonical.attributes = { ...(canonical.attributes || {}), ...value };
      } else {
        canonical[m.targetField] = value;
      }
    }

    return canonical;
  });

  return { transformedRows: transformed, warnings };
}

// ─── Validate a template at save-time (Admin UI will use this) ───────────────
export function validateTemplate(template) {
  const errors = [];
  if (!template.name) errors.push('name is required');
  if (!template.target || !['products','promotions','deposits','invoice_costs'].includes(template.target)) {
    errors.push(`target must be one of: products, promotions, deposits, invoice_costs`);
  }
  for (const m of template.mappings || []) {
    if (!m.vendorColumn && !m.constantValue) {
      errors.push('each mapping needs either vendorColumn or constantValue');
    }
    if (m.transform && !TRANSFORMS[m.transform]) {
      errors.push(`unknown transform: "${m.transform}" — available: ${Object.keys(TRANSFORMS).join(', ')}`);
    }
  }
  return errors;
}

export function listTransforms() {
  return Object.keys(TRANSFORMS).map(name => ({ name }));
}
