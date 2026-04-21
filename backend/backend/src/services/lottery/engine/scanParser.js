// Thin wrapper around the state adapter registry that:
//   1. Tries the adapter for the store's configured state first.
//   2. Falls back to trying every registered adapter (helps when a store has
//      not yet chosen its state or when a multi-state operator scans a ticket
//      from the wrong state by accident — we can still identify it).
//
// Returns `{ adapter, parsed }` or null.

import { getAdapter, allAdapters } from '../adapters/_registry.js';

/**
 * @param {string} raw           - raw scan string from the hardware
 * @param {string|null} stateCode - preferred state code; try it first
 */
export function parseScan(raw, stateCode) {
  if (raw == null || raw === '') return null;

  const preferred = getAdapter(stateCode);
  if (preferred) {
    const parsed = preferred.parseAny(raw);
    if (parsed) return { adapter: preferred, parsed };
  }

  // Fallback: try every registered adapter. First match wins.
  // (Skip the preferred one to avoid double work.)
  for (const a of allAdapters()) {
    if (preferred && a.code === preferred.code) continue;
    const parsed = a.parseAny(raw);
    if (parsed) return { adapter: a, parsed };
  }

  return null;
}
