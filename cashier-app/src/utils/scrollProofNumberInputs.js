/**
 * Scroll-proof every <input type="number"> on the page.
 *
 * Background:
 *   When a numeric input is focused and the user scrolls a touchpad / mouse
 *   wheel, the browser interprets the wheel event as ↑/↓ on the input — silently
 *   changing the value while the user thought they were scrolling the page.
 *   This is a notorious data-corruption foot-gun (e.g., a price field showing
 *   $5.99 silently flips to $25.99 the moment the user scrolls past the form).
 *
 * Fix:
 *   Register a single document-level capture-phase `wheel` listener. When the
 *   wheel target is a focused <input type="number">, blur it. Browser stops
 *   incrementing/decrementing AND the page scrolls naturally because the input
 *   is no longer focused. Passive: true so we never block the page scroll.
 *
 * Why one global listener instead of per-component fixes:
 *   We have ~73 files with native `<input type="number">`. Touching every
 *   one would be a multi-day chore and would still miss future inputs added
 *   by contributors who don't know the convention. A single document-level
 *   listener catches everything — current files, future files, third-party
 *   modal libraries — without touching a single component.
 *
 * Idempotency:
 *   Repeated calls are a no-op. Safe to call from any number of init paths.
 *   Tag attached to document so we don't double-install during HMR or in
 *   multi-root apps.
 *
 * Originally shipped: S81. Mirror this file into every app's `utils/` so each
 * app boots with the same protection — Vite's per-app build means there's no
 * shared workspace package between them.
 */
const FLAG = '__svScrollProofNumInputs__';

export function installScrollProofNumberInputs() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (document[FLAG]) return; // already installed
  document[FLAG] = true;

  const onWheel = (e) => {
    const t = e.target;
    if (
      t &&
      t instanceof HTMLInputElement &&
      t.type === 'number' &&
      document.activeElement === t
    ) {
      t.blur();
    }
  };

  // capture: true so we run BEFORE per-component handlers and can blur even
  // when the input's parent stopPropagation()s. passive: true means we never
  // block page scroll — we only blur the input so the browser stops feeding
  // the wheel delta into the input's increment logic.
  document.addEventListener('wheel', onWheel, { capture: true, passive: true });
}
