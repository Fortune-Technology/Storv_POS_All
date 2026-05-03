/**
 * safeParseDate(value, fieldName) — parse user-supplied date input safely.
 *
 * Returns a valid `Date` object OR `null`. Throws a `ValidationError` when
 * the input cannot be reasonably interpreted as a date — so callers can
 * surface a 400 (not 500).
 *
 * Handles:
 *   • null / undefined / '' → returns null
 *   • ISO strings (standard + extended +YYYYYY form)
 *   • milliseconds numbers
 *   • Date instances
 *   • Prisma's `{$type: 'DateTime', value: '...'}` wrapper
 *
 * Rejects:
 *   • Invalid Date (e.g. 'hello')
 *   • Years < 1900 or > 2100 — almost certainly typos (e.g. user typed
 *     20001 instead of 2001)
 */

import type { Response } from 'express';

export class ValidationError extends Error {
  override readonly name = 'ValidationError';
  readonly field: string;
  readonly statusCode = 400;

  constructor(message: string, field: string) {
    super(message);
    this.field = field;
  }
}

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/**
 * Acceptable inputs at the call site. Most callers pass a string from
 * the request body, but Prisma can hand back a marker object in edge cases.
 */
export type DateInput =
  | string
  | number
  | Date
  | null
  | undefined
  | { $type: 'DateTime'; value: string };

export function safeParseDate(
  value: DateInput,
  fieldName: string = 'date',
): Date | null {
  if (value == null || value === '') return null;

  // Unwrap Prisma's internal type marker if it somehow reaches us.
  if (typeof value === 'object' && !(value instanceof Date)) {
    if (
      'value' in value &&
      typeof value.value === 'string' &&
      value.$type === 'DateTime'
    ) {
      value = value.value;
    } else {
      throw new ValidationError(
        `Invalid ${fieldName}: unexpected object shape`,
        fieldName,
      );
    }
  }

  const d = value instanceof Date ? value : new Date(value as string | number);
  if (isNaN(d.getTime())) {
    throw new ValidationError(
      `Invalid ${fieldName}: "${String(value).slice(0, 40)}"`,
      fieldName,
    );
  }

  const year = d.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new ValidationError(
      `${fieldName} year out of range (${MIN_YEAR}-${MAX_YEAR}): got ${year}`,
      fieldName,
    );
  }

  return d;
}

/**
 * Express-friendly wrapper: calls safeParseDate, catches ValidationError,
 * sends a 400. Returns `{ ok: true, value }` or `{ ok: false }` (response
 * already sent).
 */
export type TryParseDateResult =
  | { ok: true; value: Date | null }
  | { ok: false };

export function tryParseDate(
  res: Response,
  value: DateInput,
  fieldName: string,
): TryParseDateResult {
  try {
    return { ok: true, value: safeParseDate(value, fieldName) };
  } catch (err) {
    if (err instanceof ValidationError) {
      res
        .status(400)
        .json({ success: false, error: err.message, field: err.field });
      return { ok: false };
    }
    throw err;
  }
}
