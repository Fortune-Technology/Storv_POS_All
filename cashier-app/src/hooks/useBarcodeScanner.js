/**
 * Listens for USB barcode scanner input (HID keyboard-wedge mode).
 *
 * A scanner fires characters extremely fast (<50ms for a full barcode),
 * then sends Enter. A human cannot type that fast — we use timing to
 * distinguish scanner input from manual typing.
 */

import { useEffect, useRef, useCallback } from 'react';

const SCAN_TIMEOUT_MS = 80;
const MIN_LENGTH      = 6;

export function useBarcodeScanner(onScan, enabled = true) {
  const bufferRef = useRef('');
  const timerRef  = useRef(null);
  const lastKeyAt = useRef(0);
  // Whether the last character came fast enough to be from a scanner
  const isScannerInput = useRef(false);

  const flush = useCallback(() => {
    const raw = bufferRef.current.trim();
    bufferRef.current = '';
    clearTimeout(timerRef.current);
    if (raw.length >= MIN_LENGTH && isScannerInput.current) {
      onScan(raw);
    }
    isScannerInput.current = false;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      const now = Date.now();
      const gap = now - lastKeyAt.current;
      lastKeyAt.current = now;

      // A scanner key gap is typically <15ms; human typing is >80ms
      if (bufferRef.current.length === 0) {
        // First character — could be scanner or human
        isScannerInput.current = false;
      } else if (gap < 30) {
        // Very fast → definitely scanner
        isScannerInput.current = true;
      }

      if (e.key === 'Enter') {
        flush();
        return;
      }

      if (e.key.length === 1) {
        bufferRef.current += e.key;
        clearTimeout(timerRef.current);
        // Auto-flush in case Enter is missing (some symbologies)
        timerRef.current = setTimeout(flush, SCAN_TIMEOUT_MS);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      clearTimeout(timerRef.current);
    };
  }, [enabled, flush]);
}
