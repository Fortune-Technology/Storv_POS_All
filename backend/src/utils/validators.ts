/**
 * Shared input validators for auth / pricing / contact fields.
 * Keep these rules server-authoritative — do not rely on frontend alone.
 */

// Simple RFC-5322-ish practical regex — rejects common garbage patterns.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// At least 8 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char.
const PASSWORD_RE =
  /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-={}[\]:;"'<>,.?/\\|`~]).{8,128}$/;

// E.164-ish phone: digits, optional leading +, 7–15 total digits.
const PHONE_RE = /^\+?[0-9\s\-().]{7,20}$/;

/**
 * Validators return `null` on success, or an error message string on failure.
 * Keeping the legacy "string | null" return shape so existing call sites
 * (which check truthiness) keep working without any caller changes.
 */
export type ValidatorResult = string | null;

export function validateEmail(email: unknown): ValidatorResult {
  if (!email || typeof email !== 'string') return 'Email is required';
  if (email.length > 254) return 'Email is too long';
  if (!EMAIL_RE.test(email.trim())) return 'Invalid email format';
  return null;
}

export function validatePassword(password: unknown): ValidatorResult {
  if (!password || typeof password !== 'string') return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 128) return 'Password is too long';
  if (!PASSWORD_RE.test(password)) {
    return 'Password must include uppercase, lowercase, number, and special character';
  }
  return null;
}

export function validatePhone(phone: unknown): ValidatorResult {
  if (phone == null || phone === '') return null; // optional
  if (typeof phone !== 'string') return 'Invalid phone';
  if (!PHONE_RE.test(phone.trim())) return 'Invalid phone format';
  const digitCount = phone.replace(/\D/g, '').length;
  if (digitCount < 7 || digitCount > 15) return 'Phone must have 7-15 digits';
  return null;
}

export interface ParsePriceOptions {
  min?: number;
  max?: number;
  allowNull?: boolean;
}

export type ParsePriceResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/**
 * Parse a price/amount value safely.
 * Rejects NaN, Infinity, negatives, scientific notation garbage.
 * Returns { ok: true, value } or { ok: false, error }.
 */
export function parsePrice(
  value: unknown,
  { min = 0, max = 999999, allowNull = true }: ParsePriceOptions = {},
): ParsePriceResult {
  if ((value === null || value === undefined || value === '') && allowNull) {
    return { ok: true, value: null };
  }
  // Reject obvious non-numeric strings (scientific notation, hex, etc.)
  if (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value.trim())) {
    return { ok: false, error: 'Invalid price format' };
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return { ok: false, error: 'Price must be a finite number' };
  }
  if (n < min) return { ok: false, error: `Price must be >= ${min}` };
  if (n > max) return { ok: false, error: `Price must be <= ${max}` };
  // Round to 4 decimals to match Prisma Decimal(10, 4)
  return { ok: true, value: Math.round(n * 10000) / 10000 };
}

/**
 * Express middleware helper — returns the first non-null validator result,
 * or null if all checks pass.
 */
export function runValidators(checks: ValidatorResult[]): ValidatorResult {
  for (const err of checks) {
    if (err) return err;
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Numeric parsing — fuel (3 decimals), count (integer), alphanumeric text.
 * Mirrors `parsePrice` shape (`{ ok, value | error }`) so existing call
 * sites can pattern-match the same way.
 * ─────────────────────────────────────────────────────────────────────── */

export interface ParseFuelOptions {
  min?: number;
  max?: number;
  allowNull?: boolean;
}

export type ParseNumericResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/**
 * Parse a fuel-related numeric value (gallons, $/gallon, tank capacity).
 * Always rounds to 3 decimal places — fuel pricing routinely uses 3dp
 * (e.g. $3.999/gal) and gallon dispensing measures to thousandths.
 */
export function parseFuel(
  value: unknown,
  { min = 0, max = 9_999_999.999, allowNull = true }: ParseFuelOptions = {},
): ParseNumericResult {
  if ((value === null || value === undefined || value === '') && allowNull) {
    return { ok: true, value: null };
  }
  if (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value.trim())) {
    return { ok: false, error: 'Invalid fuel value format' };
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, error: 'Fuel value must be finite' };
  if (n < min) return { ok: false, error: `Fuel value must be >= ${min}` };
  if (n > max) return { ok: false, error: `Fuel value must be <= ${max}` };
  // 3dp round — matches industry standard for fuel reporting + Prisma Decimal(10,3)
  return { ok: true, value: Math.round(n * 1000) / 1000 };
}

export interface ParseCountOptions {
  min?: number;
  max?: number;
  allowNull?: boolean;
}

/**
 * Parse a non-negative integer count (qty, units, ticket numbers, register
 * count, station count). Rejects any decimal portion outright — counts are
 * counts.
 */
export function parseCount(
  value: unknown,
  { min = 0, max = 1_000_000_000, allowNull = true }: ParseCountOptions = {},
): ParseNumericResult {
  if ((value === null || value === undefined || value === '') && allowNull) {
    return { ok: true, value: null };
  }
  if (typeof value === 'string' && !/^-?\d+$/.test(value.trim())) {
    return { ok: false, error: 'Count must be a whole number' };
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, error: 'Count must be finite' };
  if (!Number.isInteger(n)) return { ok: false, error: 'Count must be a whole number' };
  if (n < min) return { ok: false, error: `Count must be >= ${min}` };
  if (n > max) return { ok: false, error: `Count must be <= ${max}` };
  return { ok: true, value: n };
}

/* ─────────────────────────────────────────────────────────────────────────
 * String validation — alphanumeric with limited allowed specials.
 * ─────────────────────────────────────────────────────────────────────── */

export interface AlphanumericOptions {
  minLength?: number;
  maxLength?: number;
  allowedSpecials?: string;       // additional non-alphanumeric chars allowed
  allowSpaces?: boolean;          // default true
  allowNull?: boolean;            // default true (treats empty as ok)
  fieldLabel?: string;            // for error messages
}

export type ValidateStringResult = ValidatorResult;

/**
 * Validate a string field against an alphanumeric whitelist plus an
 * optional set of allowed special characters. Use this for product names,
 * customer names, store names, etc. — anywhere we want to block control
 * characters / injection-prone glyphs while allowing common punctuation.
 *
 * Defaults to allowing `- _ . , ' & / ( )` plus spaces.
 */
export function validateAlphanumeric(
  value: unknown,
  opts: AlphanumericOptions = {},
): ValidateStringResult {
  const {
    minLength = 0,
    maxLength = 255,
    allowedSpecials = "-_.,'&/() ",
    allowSpaces = true,
    allowNull = true,
    fieldLabel = 'Value',
  } = opts;

  if (value === null || value === undefined || value === '') {
    if (allowNull && minLength === 0) return null;
    return `${fieldLabel} is required`;
  }
  if (typeof value !== 'string') return `${fieldLabel} must be a string`;

  const trimmed = value.trim();
  if (trimmed.length < minLength) return `${fieldLabel} must be at least ${minLength} characters`;
  if (trimmed.length > maxLength) return `${fieldLabel} must be at most ${maxLength} characters`;

  // Build allowed-char regex: alphanumeric + caller-supplied specials
  // (escaped for use inside a character class).
  const escaped = allowedSpecials.replace(/[\\\-\]^]/g, '\\$&');
  const spaceClass = allowSpaces ? ' \\t' : '';
  const re = new RegExp(`^[A-Za-z0-9${escaped}${spaceClass}]+$`);
  if (!re.test(trimmed)) return `${fieldLabel} contains invalid characters`;

  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Formatters — output-only helpers to render numbers consistently. Use
 * these on every API response and report so currency / fuel / counts have
 * uniform precision across the platform.
 * ─────────────────────────────────────────────────────────────────────── */

/** Money formatter — always 2 decimals. Returns "0.00" for null/NaN. */
export function formatMoney(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '0.00';
  return v.toFixed(2);
}

/** Fuel formatter — always 3 decimals. Returns "0.000" for null/NaN. */
export function formatFuel(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '0.000';
  return v.toFixed(3);
}

/** Count formatter — integer, no decimals. Returns "0" for null/NaN. */
export function formatCount(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '0';
  return String(Math.trunc(v));
}
