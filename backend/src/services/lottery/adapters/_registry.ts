// Central registry of all state adapters. Add an import line here when a new
// state is supported. Everything else in the lottery engine reads adapters
// through `getAdapter(stateCode)` or `allAdapters()`.

import type { StateAdapter, StateCode } from './_base.js';
import MA from './MA.js';
import ME from './ME.js';

const ADAPTERS: Readonly<Record<string, StateAdapter>> = Object.freeze({
  MA,
  ME,
});

/**
 * Look up a state adapter by its 2-letter code (case-insensitive).
 * Returns null if the state isn't supported — callers decide whether to
 * fall back (e.g. reject the scan) or try every adapter.
 */
export function getAdapter(code: StateCode | null | undefined): StateAdapter | null {
  if (!code) return null;
  return ADAPTERS[String(code).trim().toUpperCase()] || null;
}

/** Every supported state, in registration order. */
export function allAdapters(): StateAdapter[] {
  return Object.values(ADAPTERS);
}

/** List supported state codes — handy for admin UI validators. */
export function supportedStates(): string[] {
  return Object.keys(ADAPTERS);
}
