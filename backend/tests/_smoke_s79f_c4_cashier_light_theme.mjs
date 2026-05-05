/**
 * S79f (C4) — Cashier-app light-theme smoke.
 *
 * Verifies the contract that holds the cashier-app's two-theme system
 * together. The actual `applyBranding(config)` mutates `:root` CSS
 * variables in the browser; this test mirrors:
 *
 *   1. THEMES table shape — both dark + light expose the same key set
 *      (so any component reading `var(--bg-panel)` will resolve in both
 *      modes without `var(--bg-panel, fallback)` plumbing)
 *   2. Chrome surfaces actually flip between themes (bg-panel,
 *      statusbar-bg, etc. must be DIFFERENT in dark vs light)
 *   3. Semantic accents stay structurally consistent (red/amber/blue
 *      keys present in both, even if the exact shade differs)
 *   4. hexToRgba helper math
 *   5. applyBranding logic:
 *        - invalid primaryColor → falls back to '#7ac143'
 *        - data-pos-theme attribute set to 'dark' for unknown theme
 *        - --green-dim + --green-border derived from primaryColor
 *   6. Edge cases: empty config, missing fields, non-string theme
 */

let pass = 0, fail = 0;
const log = (label, ok, detail = '') => {
  const sym = ok ? '✓' : '✗';
  console.log(`  ${sym} ${label}${detail ? '  — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

console.log('=== S79f (C4) CASHIER-APP LIGHT-THEME SMOKE ===\n');

// ── Mirror branding.js exports ─────────────────────────────────────
// Kept in sync with cashier-app/src/utils/branding.js. Any divergence
// here means the production module changed shape — review carefully.

const THEMES = {
  dark: {
    '--bg-base':        '#0f1117',
    '--bg-panel':       '#161922',
    '--bg-card':        '#1e2130',
    '--bg-input':       '#252836',
    '--bg-hover':       '#2a2f44',
    '--text-primary':   '#f1f5f9',
    '--text-secondary': '#94a3b8',
    '--text-muted':     '#64748b',
    '--text-deposit':   '#7dd3fc',
    '--border':         'rgba(255,255,255,.07)',
    '--border-light':   'rgba(255,255,255,.12)',
    '--statusbar-bg':       '#0a0c12',
    '--statusbar-border':   'rgba(255,255,255,.06)',
    '--statusbar-divider':  'rgba(255,255,255,.08)',
    '--statusbar-btn-bg':       'rgba(255,255,255,.05)',
    '--statusbar-btn-border':   'rgba(255,255,255,.09)',
    '--statusbar-scroll-thumb':       'rgba(255,255,255,.12)',
    '--statusbar-scroll-thumb-hover': 'rgba(255,255,255,.28)',
    '--red':            '#e03f3f',
    '--red-dim':        'rgba(224,63,63,.15)',
    '--amber':          '#f59e0b',
    '--amber-dim':      'rgba(245,158,11,.15)',
    '--blue':           '#3b82f6',
    '--blue-dim':       'rgba(59,130,246,.15)',
    '--purple':         '#8b5cf6',
  },
  light: {
    '--bg-base':        '#f1f5f9',
    '--bg-panel':       '#ffffff',
    '--bg-card':        '#f8fafc',
    '--bg-input':       '#e8edf3',
    '--bg-hover':       '#dde4ec',
    '--text-primary':   '#0f172a',
    '--text-secondary': '#334155',
    '--text-muted':     '#475569',
    '--text-deposit':   '#0284c7',
    '--border':         'rgba(0,0,0,.08)',
    '--border-light':   'rgba(0,0,0,.14)',
    '--statusbar-bg':       '#ffffff',
    '--statusbar-border':   'rgba(15,23,42,.10)',
    '--statusbar-divider':  'rgba(15,23,42,.10)',
    '--statusbar-btn-bg':       'rgba(15,23,42,.05)',
    '--statusbar-btn-border':   'rgba(15,23,42,.10)',
    '--statusbar-scroll-thumb':       'rgba(15,23,42,.18)',
    '--statusbar-scroll-thumb-hover': 'rgba(15,23,42,.32)',
    '--red':            '#dc2626',
    '--red-dim':        'rgba(220,38,38,.12)',
    '--amber':          '#d97706',
    '--amber-dim':      'rgba(217,119,6,.12)',
    '--blue':           '#2563eb',
    '--blue-dim':       'rgba(37,99,235,.12)',
    '--purple':         '#7c3aed',
  },
};

const DEFAULT_BRANDING = {
  theme:        'dark',
  primaryColor: '#7ac143',
};

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Mirror of applyBranding's mutation logic, but writes to a plain object
// (acts as our ":root" stand-in). Returns the resulting state for asserts.
function applyBrandingMock(config = {}, root = { style: {}, attrs: {} }) {
  const {
    theme        = DEFAULT_BRANDING.theme,
    primaryColor = DEFAULT_BRANDING.primaryColor,
  } = config;

  const vars = THEMES[theme] || THEMES.dark;

  for (const [k, v] of Object.entries(vars)) {
    root.style[k] = v;
  }

  const safe = /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#7ac143';
  root.style['--green']        = safe;
  root.style['--green-dim']    = hexToRgba(safe, 0.15);
  root.style['--green-border'] = hexToRgba(safe, 0.35);

  root.attrs['data-pos-theme'] = THEMES[theme] ? theme : 'dark';

  return root;
}

// ── 1. THEMES key parity ────────────────────────────────────────────
console.log('[1] THEMES table — dark + light expose identical key sets');
{
  const darkKeys  = Object.keys(THEMES.dark).sort();
  const lightKeys = Object.keys(THEMES.light).sort();
  log('same length', darkKeys.length === lightKeys.length, `dark=${darkKeys.length} light=${lightKeys.length}`);
  log('same keys',
    JSON.stringify(darkKeys) === JSON.stringify(lightKeys));

  // Required core variables every component expects to resolve.
  const required = [
    '--bg-base', '--bg-panel', '--bg-card', '--bg-input',
    '--text-primary', '--text-secondary', '--text-muted',
    '--border', '--border-light',
    '--red', '--amber', '--blue', '--purple',
  ];
  let ok = true;
  for (const k of required) {
    if (!(k in THEMES.dark) || !(k in THEMES.light)) { ok = false; break; }
  }
  log('all 13 required core vars present in both themes', ok);
}

// ── 2. Chrome surfaces flip between themes ──────────────────────────
console.log('\n[2] Chrome surfaces actually differ');
{
  const surfaces = ['--bg-base', '--bg-panel', '--bg-card', '--bg-input',
                    '--text-primary', '--statusbar-bg'];
  for (const k of surfaces) {
    log(`${k} differs dark↔light`,
      THEMES.dark[k] !== THEMES.light[k],
      `dark=${THEMES.dark[k]} light=${THEMES.light[k]}`);
  }

  // Light theme MUST have light-colored backgrounds
  log('light --bg-base is near-white',
    THEMES.light['--bg-base'].toLowerCase() === '#f1f5f9');
  log('light --bg-panel is white',
    THEMES.light['--bg-panel'].toLowerCase() === '#ffffff');
  log('light --statusbar-bg is white',
    THEMES.light['--statusbar-bg'].toLowerCase() === '#ffffff');

  // Dark theme MUST have dark backgrounds
  log('dark --bg-base is dark slate',
    THEMES.dark['--bg-base'].toLowerCase() === '#0f1117');
  log('dark --bg-panel is dark',
    THEMES.dark['--bg-panel'].toLowerCase() === '#161922');
}

// ── 3. Semantic accents present + reasonable ─────────────────────────
console.log('\n[3] Semantic accents — red/amber/blue/purple in both');
{
  for (const accent of ['--red', '--amber', '--blue', '--purple']) {
    log(`${accent} present in dark`, !!THEMES.dark[accent]);
    log(`${accent} present in light`, !!THEMES.light[accent]);
  }
  // Light theme red should be slightly deeper/darker for contrast on white
  log('light --red is darker than dark theme red (visual contrast)',
    THEMES.light['--red'].toLowerCase() === '#dc2626' &&
    THEMES.dark['--red'].toLowerCase()  === '#e03f3f');
}

// ── 4. hexToRgba math ────────────────────────────────────────────────
console.log('\n[4] hexToRgba helper math');
{
  log('white #ffffff → rgba(255,255,255,1)',
    hexToRgba('#ffffff', 1) === 'rgba(255,255,255,1)');
  log('black #000000 → rgba(0,0,0,1)',
    hexToRgba('#000000', 1) === 'rgba(0,0,0,1)');
  log('brand green #7ac143 → rgba(122,193,67,...)',
    hexToRgba('#7ac143', 0.15) === 'rgba(122,193,67,0.15)');
  log('handles missing # prefix',
    hexToRgba('7ac143', 0.5) === 'rgba(122,193,67,0.5)');
  log('handles uppercase hex',
    hexToRgba('#7AC143', 0.35) === 'rgba(122,193,67,0.35)');
}

// ── 5. applyBranding logic ───────────────────────────────────────────
console.log('\n[5] applyBranding — config persistence + derived vars');
{
  const r1 = applyBrandingMock({ theme: 'dark', primaryColor: '#7ac143' });
  log('dark mode sets data-pos-theme="dark"',
    r1.attrs['data-pos-theme'] === 'dark');
  log('dark mode applies --bg-base #0f1117',
    r1.style['--bg-base'] === '#0f1117');
  log('--green is the requested primaryColor',
    r1.style['--green'] === '#7ac143');
  log('--green-dim derived at 0.15 alpha',
    r1.style['--green-dim'] === 'rgba(122,193,67,0.15)');
  log('--green-border derived at 0.35 alpha',
    r1.style['--green-border'] === 'rgba(122,193,67,0.35)');

  const r2 = applyBrandingMock({ theme: 'light', primaryColor: '#3b82f6' });
  log('light mode sets data-pos-theme="light"',
    r2.attrs['data-pos-theme'] === 'light');
  log('light mode applies --bg-base #f1f5f9',
    r2.style['--bg-base'] === '#f1f5f9');
  log('light mode applies --bg-panel #ffffff',
    r2.style['--bg-panel'] === '#ffffff');
  log('--green follows primaryColor across themes',
    r2.style['--green'] === '#3b82f6');
}

// ── 6. Invalid input fallbacks ───────────────────────────────────────
console.log('\n[6] Invalid input — graceful fallbacks');
{
  // Invalid theme → still sets data-pos-theme="dark", uses dark vars
  const r = applyBrandingMock({ theme: 'cyberpunk' });
  log('unknown theme falls back to dark vars',
    r.style['--bg-base'] === '#0f1117');
  log('unknown theme attribute is "dark"',
    r.attrs['data-pos-theme'] === 'dark');

  // Invalid primaryColor → falls back to brand green
  const r2 = applyBrandingMock({ primaryColor: 'not-a-color' });
  log('invalid primaryColor → --green falls back to #7ac143',
    r2.style['--green'] === '#7ac143');

  const r3 = applyBrandingMock({ primaryColor: '#xyz' });
  log('malformed hex (#xyz) → falls back',
    r3.style['--green'] === '#7ac143');

  const r4 = applyBrandingMock({ primaryColor: '#abc' });    // 3-char hex rejected
  log('3-char hex shortform rejected (must be #rrggbb)',
    r4.style['--green'] === '#7ac143');

  // Empty config → uses defaults
  const r5 = applyBrandingMock({});
  log('empty config uses dark defaults',
    r5.attrs['data-pos-theme'] === 'dark' &&
    r5.style['--bg-base'] === '#0f1117' &&
    r5.style['--green']   === '#7ac143');

  // Undefined config — guard against runtime crash
  const r6 = applyBrandingMock();
  log('undefined config does not crash and uses defaults',
    r6.attrs['data-pos-theme'] === 'dark');
}

// ── 7. data-pos-theme is the gate for [data-pos-theme="light"] CSS ───
// The C4 work added [data-pos-theme="light"] CSS overrides for places
// where rgba(255,255,255,X) overlays disappear on white panels. Verify
// the attribute is set EXACTLY to "light" (not "Light" or "LIGHT") so
// CSS selectors match.
console.log('\n[7] data-pos-theme attribute exactness — CSS selector match');
{
  const r = applyBrandingMock({ theme: 'light' });
  log('attribute value is exactly "light"',
    r.attrs['data-pos-theme'] === 'light');
  log('attribute is NOT capitalized',
    r.attrs['data-pos-theme'] !== 'Light' &&
    r.attrs['data-pos-theme'] !== 'LIGHT');

  const r2 = applyBrandingMock({ theme: 'dark' });
  log('dark theme value is exactly "dark"',
    r2.attrs['data-pos-theme'] === 'dark');
}

// ── 8. End-to-end — full theme-swap state ────────────────────────────
console.log('\n[8] End-to-end — full state after swap');
{
  // Start in dark
  const root = applyBrandingMock({ theme: 'dark', primaryColor: '#7ac143' });
  const darkBg = root.style['--bg-base'];
  const darkPanel = root.style['--bg-panel'];

  // Swap to light using the SAME root (mimics applyBranding-twice flow)
  applyBrandingMock({ theme: 'light', primaryColor: '#7ac143' }, root);
  const lightBg = root.style['--bg-base'];
  const lightPanel = root.style['--bg-panel'];

  log('--bg-base swaps when theme flips dark→light',
    darkBg === '#0f1117' && lightBg === '#f1f5f9');
  log('--bg-panel swaps when theme flips dark→light',
    darkPanel === '#161922' && lightPanel === '#ffffff');
  log('data-pos-theme reflects new state after swap',
    root.attrs['data-pos-theme'] === 'light');
  log('--green stays consistent (stays brand color through swap)',
    root.style['--green'] === '#7ac143');
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`✓ pass: ${pass}`);
console.log(`✗ fail: ${fail}`);
console.log(`total:  ${pass + fail}`);

process.exit(fail > 0 ? 1 : 0);
