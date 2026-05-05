/**
 * S79d (C5) — Label preview pixel-accuracy math smoke.
 *
 * The preview pane needs to match what actually prints. The user reported
 * the old preview was "not accurate to what it actually prints" — the
 * culprit was a hardcoded `scale = 3` (1in = 3rem) that ignored DPI
 * entirely. Fixed by routing everything through `dots × px-per-dot`:
 *
 *   widthDots   = labelInches × DPI
 *   widthPx     = widthDots × scale       (scale = px per printer-dot)
 *   xDots       = toDots(field.x, unit, dpi)
 *   xPx         = xDots × scale
 *   fontDots    = (pt × dpi / 72)
 *   fontPx      = fontDots × scale
 *
 * This smoke pins the contract:
 *   1. Unit conversion (toDots/fromDots) round-trips at 203/300/600 dpi
 *   2. Font-dot math matches ZPL's pt-to-dot formula
 *   3. Label dimensions scale with DPI (a 4×2" at 300dpi has MORE dots than at 203dpi)
 *   4. Zoom changes screen px but never changes the dot math
 *   5. Barcode format dispatcher picks the right encoding for UPC / EAN / fallback
 */

let pass = 0, fail = 0;
const log = (label, ok, detail = '') => {
  const sym = ok ? '✓' : '✗';
  console.log(`  ${sym} ${label}${detail ? '  — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

console.log('=== S79d (C5) LABEL PREVIEW PIXEL-ACCURACY MATH SMOKE ===\n');

// ── Mirrors of LabelDesign.jsx helpers ──────────────────────────────
function toDots(value, unit, dpi) {
  switch (unit) {
    case 'pt':   return Math.round(value * (dpi / 72));
    case 'px':   return Math.round(value * (dpi / 96));
    case 'dots': return Math.round(value);
    case 'mm':   return Math.round(value * (dpi / 25.4));
    default:     return Math.round(value * (dpi / 72));
  }
}

function fromDots(dots, unit, dpi) {
  switch (unit) {
    case 'pt':   return Math.round(dots / (dpi / 72) * 10) / 10;
    case 'px':   return Math.round(dots / (dpi / 96) * 10) / 10;
    case 'dots': return Math.round(dots);
    case 'mm':   return Math.round(dots / (dpi / 25.4) * 10) / 10;
    default:     return Math.round(dots / (dpi / 72) * 10) / 10;
  }
}

const FONT_SIZE_OPTIONS = [
  { id: '6pt',  ptValue: 6 },
  { id: '8pt',  ptValue: 8 },
  { id: '12pt', ptValue: 12 },
  { id: '18pt', ptValue: 18 },
  { id: '32pt', ptValue: 32 },
];
const LEGACY_FONT_MAP = { tiny: '6pt', small: '8pt', medium: '12pt', large: '18pt', xlarge: '32pt' };

function getFontDots(fontSize, dpi) {
  const mapped = LEGACY_FONT_MAP[fontSize] || fontSize;
  const opt = FONT_SIZE_OPTIONS.find(f => f.id === mapped);
  const ptVal = opt ? opt.ptValue : 12;
  const h = toDots(ptVal, 'pt', dpi);
  const w = Math.round(h * 0.65);
  return { h, w };
}

function barcodeFormatFor(fieldId, value) {
  if (fieldId === 'upcBarcode' || fieldId === 'upc') {
    if (/^[0-9]{12}$/.test(String(value || ''))) return 'UPC';
    if (/^[0-9]{13}$/.test(String(value || ''))) return 'EAN13';
    if (/^[0-9]{8}$/.test(String(value || '')))  return 'EAN8';
    return 'CODE128';
  }
  return 'CODE128';
}

function previewLabelDims(widthIn, heightIn, dpi, scale) {
  const widthDots  = Math.round(widthIn  * dpi);
  const heightDots = Math.round(heightIn * dpi);
  return {
    widthDots, heightDots,
    widthPx:  Math.round(widthDots  * scale),
    heightPx: Math.round(heightDots * scale),
  };
}

// ── 1. toDots conversion at all 3 DPIs ──────────────────────────────
console.log('[1] toDots — pt/px/mm/dots at 203/300/600 dpi');
{
  // pt → dots: 1pt = (dpi/72) dots
  log('1pt @ 203dpi = 3 dots',  toDots(1,  'pt', 203) === 3);
  log('12pt @ 203dpi = 34 dots', toDots(12, 'pt', 203) === 34);
  log('72pt @ 203dpi = 203 dots (1 inch)', toDots(72, 'pt', 203) === 203);
  log('1pt @ 300dpi = 4 dots',  toDots(1,  'pt', 300) === 4);
  log('12pt @ 300dpi = 50 dots', toDots(12, 'pt', 300) === 50);
  log('72pt @ 300dpi = 300 dots (1 inch)', toDots(72, 'pt', 300) === 300);
  log('72pt @ 600dpi = 600 dots (1 inch)', toDots(72, 'pt', 600) === 600);

  // mm → dots: 1mm = (dpi/25.4) dots
  log('25.4mm @ 203dpi = 203 dots (1 inch)',
    toDots(25.4, 'mm', 203) === 203);
  log('25.4mm @ 300dpi = 300 dots',
    toDots(25.4, 'mm', 300) === 300);
  log('10mm @ 203dpi = 80 dots', toDots(10, 'mm', 203) === 80);

  // px → dots: 1px = (dpi/96) dots (CSS pixel ≈ 1/96 inch)
  log('96px @ 203dpi = 203 dots (1 inch)',
    toDots(96, 'px', 203) === 203);

  // dots passthrough
  log('100 dots @ any dpi → 100', toDots(100, 'dots', 203) === 100);
  log('100 dots @ 300 → 100',     toDots(100, 'dots', 300) === 100);
  log('100 dots @ 600 → 100',     toDots(100, 'dots', 600) === 100);

  // unknown unit defaults to pt
  log('unknown unit defaults to pt', toDots(1, 'unknown', 203) === toDots(1, 'pt', 203));
}

// ── 2. Round-trip: dots → user unit → dots ──────────────────────────
console.log('\n[2] Round-trip: dots ⇄ user units');
{
  // pt round-trip — losses happen at the rounding boundary, so we tolerate
  // ±1 dot at small values
  for (const dpi of [203, 300, 600]) {
    for (const pt of [6, 12, 18, 24, 32, 48]) {
      const dots = toDots(pt, 'pt', dpi);
      const back = fromDots(dots, 'pt', dpi);
      // 12pt @ 203dpi = 34 dots → 34 / (203/72) = 12.06… → rounds to 12.1 (1dp)
      log(`${pt}pt @ ${dpi}dpi: round-trip preserves within 0.5pt`,
        Math.abs(back - pt) <= 0.5,
        `dots=${dots}, back=${back}`);
    }
  }
}

// ── 3. Font-dot math ─────────────────────────────────────────────────
console.log('\n[3] Font-dot math (preview must match ZPL)');
{
  // 12pt @ 203dpi = 34 dots tall, 22 dots wide (h × 0.65)
  const f12_203 = getFontDots('12pt', 203);
  log('12pt @ 203dpi h=34',  f12_203.h === 34);
  log('12pt @ 203dpi w=22',  f12_203.w === 22);

  // 12pt @ 300dpi = 50 dots tall (more dots = sharper text on a 300dpi printer)
  const f12_300 = getFontDots('12pt', 300);
  log('12pt @ 300dpi h=50',  f12_300.h === 50);
  log('12pt @ 300dpi w=33',  f12_300.w === Math.round(50 * 0.65));

  // Legacy named sizes still resolve
  log('"medium" → 12pt → 34 dots @ 203dpi',
    getFontDots('medium', 203).h === 34);
  log('"large" → 18pt → 51 dots @ 203dpi',
    getFontDots('large', 203).h === 51);
  log('"xlarge" → 32pt → 90 dots @ 203dpi',
    getFontDots('xlarge', 203).h === 90);

  // Unknown font size → defaults to 12pt
  log('unknown size defaults to 12pt',
    getFontDots('mystery', 203).h === 34);

  // Scaling: at 300dpi, 12pt is 50 dots, at 203dpi it's 34 dots.
  // The same font on a sharper printer renders MORE dots — this is the
  // "right" thing because more dots = better resolution.
  log('higher dpi → more dots per pt',
    getFontDots('12pt', 300).h > getFontDots('12pt', 203).h);
  log('600dpi double 300dpi (within ±1)',
    Math.abs(getFontDots('12pt', 600).h - getFontDots('12pt', 300).h * 2) <= 1);
}

// ── 4. Label dimensions scale with DPI ──────────────────────────────
console.log('\n[4] Label dimensions — same physical label has more dots at higher DPI');
{
  // 4×2" at 203dpi = 812 × 406 dots
  // 4×2" at 300dpi = 1200 × 600 dots
  const at203 = previewLabelDims(4, 2, 203, 1.0);
  const at300 = previewLabelDims(4, 2, 300, 1.0);
  const at600 = previewLabelDims(4, 2, 600, 1.0);

  log('4×2" at 203dpi = 812×406 dots',  at203.widthDots === 812 && at203.heightDots === 406);
  log('4×2" at 300dpi = 1200×600 dots', at300.widthDots === 1200 && at300.heightDots === 600);
  log('4×2" at 600dpi = 2400×1200 dots', at600.widthDots === 2400 && at600.heightDots === 1200);

  // Different label sizes at same DPI scale by physical size
  const small  = previewLabelDims(2, 1, 203, 1.0);
  const medium = previewLabelDims(4, 2, 203, 1.0);
  log('2×1" has 1/4 the dots of 4×2" (at same dpi)',
    small.widthDots * 2 === medium.widthDots && small.heightDots * 2 === medium.heightDots);

  // Scale 0 dots becomes 0 px regardless
  const zeroLabel = previewLabelDims(0, 0, 203, 0.4);
  log('zero label → zero dots',
    zeroLabel.widthDots === 0 && zeroLabel.heightDots === 0 && zeroLabel.widthPx === 0);
}

// ── 5. Zoom changes screen px, NOT dots ─────────────────────────────
console.log('\n[5] Zoom — changes screen px while dot math stays fixed');
{
  // 4×2" at 203dpi = 812×406 dots, regardless of screen zoom
  // Screen px varies linearly with `scale`
  const dims_25  = previewLabelDims(4, 2, 203, 0.25); // 25% zoom
  const dims_40  = previewLabelDims(4, 2, 203, 0.4);  // default
  const dims_100 = previewLabelDims(4, 2, 203, 1.0);  // actual size
  const dims_200 = previewLabelDims(4, 2, 203, 2.0);  // 200%

  // dots are invariant under zoom
  log('dots invariant under zoom',
    dims_25.widthDots === 812 && dims_40.widthDots === 812 &&
    dims_100.widthDots === 812 && dims_200.widthDots === 812);

  // px scales linearly
  log('25% → 203px wide (812 × 0.25)',  dims_25.widthPx === 203);
  log('40% → 325px wide',                dims_40.widthPx === 325);
  log('100% → 812px wide (actual)',      dims_100.widthPx === 812);
  log('200% → 1624px wide',               dims_200.widthPx === 1624);

  // Aspect ratio preserved across zoom levels
  const ar = dims_100.widthPx / dims_100.heightPx;
  for (const d of [dims_25, dims_40, dims_200]) {
    log(`aspect ratio preserved at ${d.widthPx}×${d.heightPx}`,
      Math.abs(d.widthPx / d.heightPx - ar) < 0.01);
  }
}

// ── 6. Field positioning consistency ────────────────────────────────
console.log('\n[6] Field positioning — pt → dots → px');
{
  // Field at x=10pt on a 4×2" 203dpi label, default 0.4 zoom
  // 10pt = 28 dots @ 203dpi → 11 px @ 0.4 scale
  const dpi = 203, scale = 0.4;
  const xDots = toDots(10, 'pt', dpi);
  const xPx   = Math.round(xDots * scale);
  log('field at 10pt → 28 dots → 11px @ 0.4 zoom',
    xDots === 28 && xPx === 11);

  // Same field at 100% zoom: 28 px (1 dot per px)
  const xPx100 = Math.round(xDots * 1.0);
  log('field at 10pt → 28px @ 100% zoom',
    xPx100 === 28);

  // Field at x=72pt = 1 inch from left edge
  // At 203dpi: 203 dots. At 100% zoom: 203 px = 1 inch on 96dpi screen
  // (close to actual physical 1 inch, depending on monitor pixel density)
  const xOneInch = toDots(72, 'pt', 203);
  log('72pt = 1 inch = 203 dots @ 203dpi',
    xOneInch === 203);

  // dots stored unit (advanced users)
  const xRawDots = toDots(50, 'dots', 203);
  log('raw dots passthrough', xRawDots === 50);
}

// ── 7. Barcode format dispatcher ────────────────────────────────────
console.log('\n[7] Barcode format dispatcher');
{
  // Numeric 12-digit → UPC-A
  log('12-digit numeric → UPC',     barcodeFormatFor('upcBarcode', '012345678905') === 'UPC');
  log('12 digits, fieldId="upc"',   barcodeFormatFor('upc',        '012345678905') === 'UPC');

  // 13-digit → EAN-13
  log('13-digit → EAN13',           barcodeFormatFor('upcBarcode', '1234567890123') === 'EAN13');

  // 8-digit → EAN-8
  log('8-digit → EAN8',             barcodeFormatFor('upcBarcode', '12345678') === 'EAN8');

  // Non-numeric or wrong length → CODE128
  log('non-numeric → CODE128',      barcodeFormatFor('upcBarcode', 'ABC123') === 'CODE128');
  log('11-digit (wrong) → CODE128', barcodeFormatFor('upcBarcode', '01234567890') === 'CODE128');

  // Other field types → CODE128
  log('non-UPC field → CODE128',    barcodeFormatFor('sku',        '012345678905') === 'CODE128');
  log('null fieldId',               barcodeFormatFor(null,         '012345678905') === 'CODE128');

  // Empty / null value defaults to CODE128 (it's the safest fallback)
  log('null value → CODE128',       barcodeFormatFor('upcBarcode', null) === 'CODE128');
  log('empty value → CODE128',      barcodeFormatFor('upcBarcode', '')   === 'CODE128');
}

// ── 8. End-to-end label render math sanity ──────────────────────────
console.log('\n[8] End-to-end render math — same field, 3 different DPIs at same scale');
{
  // A 12pt field at x=5pt y=5pt on a 2×1" label, default 40% zoom
  // The screen px should change with DPI even though the LABEL is the same
  // physical size — because more dots per inch = more screen px to render
  // them at the same scale (dot-faithfulness).
  const scale = 0.4;
  const fieldX_pt = 5, fieldY_pt = 5, fontSize = '12pt';

  for (const dpi of [203, 300, 600]) {
    const dims = previewLabelDims(2, 1, dpi, scale);
    const xPx = Math.round(toDots(fieldX_pt, 'pt', dpi) * scale);
    const yPx = Math.round(toDots(fieldY_pt, 'pt', dpi) * scale);
    const fontPx = Math.round(getFontDots(fontSize, dpi).h * scale);

    log(`@${dpi}dpi: label=${dims.widthPx}×${dims.heightPx}, x=${xPx} y=${yPx} font=${fontPx}`,
      dims.widthDots === 2 * dpi && dims.heightDots === 1 * dpi);
  }

  // The 600dpi screen-px values should be approximately 3× the 203dpi
  // values (since 600/203 ≈ 2.96). This proves: a 12pt font on a 600dpi
  // printer is rendered with 3× as many dots as on 203dpi → on screen
  // (at same zoom) it appears bigger because there's more detail.
  const fontPx203 = Math.round(getFontDots('12pt', 203).h * 0.4);
  const fontPx600 = Math.round(getFontDots('12pt', 600).h * 0.4);
  log('font px ratio ≈ DPI ratio (600/203 ≈ 2.96)',
    Math.abs(fontPx600 / fontPx203 - 600 / 203) < 0.1,
    `${fontPx600}/${fontPx203} = ${(fontPx600/fontPx203).toFixed(2)}, expected ≈ 2.96`);
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`✓ pass: ${pass}`);
console.log(`✗ fail: ${fail}`);
console.log(`total:  ${pass + fail}`);

process.exit(fail > 0 ? 1 : 0);
