/**
 * Audit Diff Helper — shared field-level before/after diff computation.
 *
 * Used by controllers that emit explicit `logAudit('update', ...)` events
 * with a `changes` payload. Keeps the diff format consistent so the portal
 * Audit Log page can render every entity's diff with the same UI.
 *
 * Output shape per changed field:
 *   { fieldName: { before: oldValue, after: newValue } }
 *
 * Equality rule: stringified-equal counts as unchanged. `null`/`undefined`
 * are treated as equivalent. This intentionally mirrors what
 * catalogController.updateMasterProduct has been doing since Session 9 so
 * historical and new audit rows render the same way.
 */

export type FieldDiff = Record<string, { before: unknown; after: unknown }>;

/**
 * Compute a field-level diff between two objects. Only keys present in
 * `after` are considered (we only care about fields the caller intended to
 * change). Pass a sensitive-key list to redact values from the resulting
 * diff entirely (e.g. password hashes — we want to know the field changed
 * but never log the value).
 */
export function computeDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  options: { redactKeys?: string[] } = {},
): FieldDiff {
  const diff: FieldDiff = {};
  const redact = new Set(options.redactKeys || []);

  for (const key of Object.keys(after)) {
    const beforeVal = before?.[key];
    const afterVal = after[key];
    const same =
      (beforeVal == null && afterVal == null) ||
      String(beforeVal ?? '') === String(afterVal ?? '');
    if (same) continue;

    if (redact.has(key)) {
      diff[key] = { before: beforeVal == null ? null : '[redacted]', after: '[redacted]' };
    } else {
      diff[key] = { before: beforeVal ?? null, after: afterVal ?? null };
    }
  }

  return diff;
}

/**
 * True when the diff has at least one changed field. Use this to skip
 * `logAudit` when an update endpoint was called but nothing actually
 * changed (saves audit-log noise).
 */
export function hasChanges(diff: FieldDiff): boolean {
  return Object.keys(diff).length > 0;
}

export default { computeDiff, hasChanges };
