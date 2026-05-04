/**
 * POS Branding — theme presets + CSS variable applicator
 *
 * applyBranding(config) sets CSS custom properties on :root
 * so the entire POS re-themes instantly without a reload.
 */

// ── Theme presets ──────────────────────────────────────────────────────────

export const THEMES = {
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

export const DEFAULT_BRANDING = {
  theme:        'dark',
  primaryColor: '#7ac143',
  logoText:     '',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Persistence ────────────────────────────────────────────────────────────
// Cache last applied branding in localStorage so we can re-apply it
// synchronously on the next page load (before any API call) — kills the
// dark→light flash on refresh and makes pre-PIN screens (StationSetup,
// PinLogin) reflect the store's chosen theme.

const CACHE_KEY = 'pos_branding_cache';

export function loadCachedBranding() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCachedBranding(config) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(config));
  } catch {}
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Apply a branding config to the document root CSS variables.
 * Safe to call at any time — just sets inline style overrides on :root.
 * Also caches the config to localStorage for fast restore on next load.
 */
export function applyBranding(config = {}) {
  const {
    theme        = DEFAULT_BRANDING.theme,
    primaryColor = DEFAULT_BRANDING.primaryColor,
  } = config;

  const root = document.documentElement;
  const vars = THEMES[theme] || THEMES.dark;

  // Apply all theme variables
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }

  // Apply primary (brand) color + derived shades
  const safe = /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#7ac143';
  root.style.setProperty('--green',        safe);
  root.style.setProperty('--green-dim',    hexToRgba(safe, 0.15));
  root.style.setProperty('--green-border', hexToRgba(safe, 0.35));

  // Set data-theme attribute so component CSS can apply light-theme-only
  // overrides (e.g. AI button gradient is too pale on white statusbar) via
  // [data-pos-theme="light"] selectors without affecting dark styles.
  root.setAttribute('data-pos-theme', THEMES[theme] ? theme : 'dark');

  saveCachedBranding({ theme, primaryColor });
}

// ── Synchronous boot ───────────────────────────────────────────────────────
// Apply cached branding immediately when this module is imported, before
// React mounts. Prevents the dark-flash on refresh.
if (typeof document !== 'undefined') {
  const cached = loadCachedBranding();
  if (cached) applyBranding(cached);
}
