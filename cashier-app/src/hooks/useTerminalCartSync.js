/**
 * useTerminalCartSync — push live cart updates to the customer-facing
 * Dejavoo terminal screen as the cashier scans items.
 *
 * Why a separate hook (instead of inlining in POSScreen):
 *   1. Encapsulation — one place to own the debounce, change-detection,
 *      online/offline gating, and silent error handling.
 *   2. Testable in isolation — can mock the API + assert call counts.
 *   3. POSScreen is already 2400+ lines; this avoids growing it further.
 *
 * Behaviour:
 *   - Debounces cart changes (500ms by default) — the cashier rapid-firing
 *     a barcode scanner shouldn't generate 10 cloud round-trips per second.
 *   - Skips when nothing meaningfully changed (same item count + same
 *     total + same line ids) — avoids re-pushing on cosmetic re-renders.
 *   - Skips when offline / no Dejavoo / no station / cart is empty.
 *   - Silent on failure — display isn't load-bearing.
 *   - Cleans up on unmount (no in-flight push triggered after teardown).
 *
 * @param {Object} args
 *   items        — useCartStore.items[] (the live cart)
 *   totals       — selectTotals(items, ...) output
 *   stationId    — active station id (from useStationStore)
 *   hasDejavoo   — true if a Dejavoo merchant is configured + active
 *   isOnline     — useSyncStore().isOnline
 *   debounceMs   — optional, default 500ms
 */
import { useEffect, useRef } from 'react';
import * as posApi from '../api/pos.js';
import { buildDejavooCart } from '../utils/dejavooCart.js';

export function useTerminalCartSync({
  items,
  totals,
  stationId,
  hasDejavoo,
  isOnline,
  debounceMs = 500,
}) {
  // Track the last cart "fingerprint" we successfully pushed so we don't
  // re-push when nothing meaningful changed. Fingerprint = item count +
  // grand total + comma-joined line ids (cheap structural hash).
  const lastFingerprintRef = useRef('');

  // Track active timer so we can cancel it on cleanup / new cart change.
  const timerRef = useRef(null);

  // Track whether we have any pending in-flight push, so unmount cleanup
  // can avoid pushing after the component is gone.
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // Hard gates — these all evaluate to "skip the push entirely":
    if (!stationId)   return;   // no station → backend can't resolve merchant
    if (!hasDejavoo)  return;   // no Dejavoo → nothing to push to
    if (!isOnline)    return;   // offline → push would error anyway

    // Compute fingerprint cheaply — guards against React re-render storms.
    const itemCount = Array.isArray(items) ? items.length : 0;
    const grand     = Number(totals?.grandTotal ?? 0).toFixed(2);
    const ids       = itemCount === 0 ? '' :
      items.map(i => `${i.lineId || i.productId}:${i.qty}`).join('|');
    const fingerprint = `${itemCount}|${grand}|${ids}`;

    // No-op when nothing meaningfully changed.
    if (fingerprint === lastFingerprintRef.current) return;

    // Cancel any pending push from a previous change — only the latest
    // cart state matters.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    timerRef.current = setTimeout(async () => {
      // Re-check the gates inside the timer callback; the cashier may have
      // signed out / lost network in the debounce window.
      if (!aliveRef.current) return;

      // Special case — empty cart. We push a clear() instead of a Cart
      // with empty Items, so the display goes back to its default "Listening
      // for transaction…" state immediately rather than a blank cart.
      if (itemCount === 0) {
        try {
          await posApi.dejavooClearDisplay({ stationId });
          lastFingerprintRef.current = fingerprint;
        } catch (err) {
          console.warn('[useTerminalCartSync] clear failed', err?.message);
        }
        return;
      }

      // Normal case — convert cart to Dejavoo's case-correct shape and push.
      const cart = buildDejavooCart(items, totals);
      if (!cart) {
        // Nothing displayable (refund-only? all manual lines?). Skip the push
        // and reset fingerprint so the next real change triggers fresh.
        lastFingerprintRef.current = fingerprint;
        return;
      }
      try {
        await posApi.dejavooPushCart({ stationId, cart });
        lastFingerprintRef.current = fingerprint;
      } catch (err) {
        // Display flakes are non-fatal. Surface in console for debug but
        // never throw or toast — the cashier doesn't care if the customer
        // display momentarily lags.
        console.warn('[useTerminalCartSync] push failed', err?.message);
      }
    }, debounceMs);

    // Clear pending timer when deps change before it fires.
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [items, totals?.grandTotal, stationId, hasDejavoo, isOnline, debounceMs]); // eslint-disable-line
}
