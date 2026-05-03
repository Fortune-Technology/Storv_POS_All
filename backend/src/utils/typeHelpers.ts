/**
 * Shared type-narrowing helpers for controllers, routes, and services.
 *
 * Before: every controller declared its own copy of these tiny helpers
 * (errMsg / errCode / errStatus / StatusError) — 9+ duplicates that all
 * drifted slightly from each other (some tracked `status`, some `code`,
 * some both, with subtly different cast targets). Centralizing here so:
 *
 *   1. There's one canonical narrowing for `unknown` errors caught from
 *      `try { ... } catch (err) { ... }`.
 *   2. The `StatusError` augmentation is a single type — controllers that
 *      need to attach a domain-specific extra field (e.g. catalog's
 *      `conflict: UpcConflict`) can extend this locally instead of
 *      re-declaring the whole shape.
 *   3. Future error-shape changes (adding telemetry IDs, retry hints,
 *      etc.) happen in one place.
 *
 * NOT included here:
 *   - Axios-aware extractors (used by services/platforms/{doordash,
 *     instacart,ubereats}.ts and dejavoo/{spin,hpp}/client.ts) — each has
 *     a slightly different downstream-API quirk (some parse `data.error`,
 *     some `data.message`, some need an HTTP-status fallback). Forcing
 *     them into one helper would add `if/else` clutter without value.
 *   - Domain-specific extractors like salesController's
 *     `detailedErrorMessage` (handles both `message` + `Message` casing
 *     for an external API).
 */

/**
 * Status-augmented Error.
 *
 * Application code throws plain `Error` with `.status` and/or `.code`
 * glued on:
 *
 *   const e = new Error('not found') as StatusError;
 *   e.status = 404;
 *   e.code = 'NOT_FOUND';
 *   throw e;
 *
 * Express error handlers read `.status` to set the HTTP code; Prisma
 * rejection handlers read `.code` (e.g. 'P2002' for unique-constraint).
 *
 * Controllers that need to attach a domain-specific extra (catalog's
 * UPC-conflict path attaches `conflict`) extend this locally:
 *
 *   type CatalogStatusError = StatusError & { conflict?: UpcConflict | null };
 */
export interface StatusError extends Error {
  status?: number;
  code?: string;
}

/**
 * Narrow an unknown thrown value to a string. Use for log lines and
 * 5xx response bodies where you want the message but the catch
 * variable is typed as `unknown`.
 */
export const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Pull a `code` field off an Error if present. Prisma errors carry
 * one ('P2002' = unique constraint, 'P2025' = record not found, etc.),
 * and StatusErrors thrown by application code can too.
 */
export const errCode = (err: unknown): string | undefined =>
  err instanceof Error ? (err as StatusError).code : undefined;

/**
 * Pull a `status` field off an Error if present. Used by controllers
 * to map application-thrown StatusErrors back to HTTP codes.
 */
export const errStatus = (err: unknown): number | undefined =>
  err instanceof Error ? (err as StatusError).status : undefined;

/**
 * Build a StatusError in one expression — convenience constructor for
 * the throw-with-HTTP-hint pattern.
 *
 *   throw statusError('not found', 404);
 *   throw statusError('duplicate UPC', 409, 'UPC_CONFLICT');
 */
export function statusError(
  message: string,
  status: number,
  code?: string,
): StatusError {
  const e = new Error(message) as StatusError;
  e.status = status;
  if (code) e.code = code;
  return e;
}
