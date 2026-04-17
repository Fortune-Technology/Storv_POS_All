/**
 * paymentMerchantAudit.js
 *
 * Helpers for writing immutable audit entries when PaymentMerchant
 * credentials change. Never writes plaintext secrets — only flags
 * indicating whether a secret field was changed.
 */

import prisma from '../config/postgres.js';

const SECRET_FIELDS = ['spinAuthKey', 'hppAuthKey', 'transactApiKey'];

/**
 * Compute a safe diff between old and new data.
 * Secret fields become { changed: true/false } instead of leaking values.
 */
export function buildChangeDiff(oldData, newData) {
  const changes = {};
  const keys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);

  for (const k of keys) {
    if (SECRET_FIELDS.includes(k)) {
      // Never log secret values — just flag whether it changed.
      const oldSet = oldData?.[k] ? true : false;
      const newSet = newData?.[k] ? true : false;
      if (oldSet !== newSet || (newSet && oldData?.[k] !== newData?.[k])) {
        changes[k] = { changed: true, wasSet: oldSet, isSet: newSet };
      }
      continue;
    }
    // Skip audit-irrelevant fields
    if (['updatedAt', 'createdAt', 'id', 'updatedById'].includes(k)) continue;
    const oldV = oldData?.[k];
    const newV = newData?.[k];
    if (oldV !== newV) {
      changes[k] = { from: oldV ?? null, to: newV ?? null };
    }
  }

  return Object.keys(changes).length ? changes : null;
}

/**
 * Append an audit entry. Fire-and-forget: audit failures never block the
 * main operation (we log them but don't surface to the caller).
 */
export async function logMerchantAudit({ merchantId, action, user, changes = null, note = null }) {
  try {
    await prisma.paymentMerchantAudit.create({
      data: {
        merchantId,
        action,
        changedById:   user?.id || null,
        changedByName: user?.name || user?.email || null,
        changes,
        note,
      },
    });
  } catch (err) {
    console.warn('[paymentMerchantAudit] log failed:', err.message);
  }
}
