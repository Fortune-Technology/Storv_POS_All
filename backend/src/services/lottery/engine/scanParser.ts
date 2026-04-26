// Thin wrapper around the state adapter registry that:
//   1. Tries the adapter for the store's configured state first.
//   2. Falls back to trying every registered adapter (helps when a store has
//      not yet chosen its state or when a multi-state operator scans a ticket
//      from the wrong state by accident — we can still identify it).
//
// Returns `{ adapter, parsed }` or null.

import { getAdapter, allAdapters } from '../adapters/_registry.js';
import type { ParseResult, StateAdapter, StateCode } from '../adapters/_base.js';

export interface ScanParseResult {
  adapter: StateAdapter;
  parsed: NonNullable<ParseResult>;
}

/**
 * @param raw       raw scan string from the hardware
 * @param stateCode preferred state code; try it first (null/undefined to skip)
 */
export function parseScan(
  raw: string | null | undefined,
  stateCode: StateCode | null | undefined,
): ScanParseResult | null {
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
