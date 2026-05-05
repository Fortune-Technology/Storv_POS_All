/**
 * S78 — Implementation Engineer PIN service.
 *
 * Per-user 6-digit PIN that gates the cashier-app's Hardware Settings flow.
 * Only granted to users with `User.canConfigureHardware = true` (intended
 * for internal implementation/support engineers, NOT store staff).
 *
 * ── Storage ──────────────────────────────────────────────────────────────
 * PIN is AES-256-GCM-encrypted via cryptoVault and stored on
 * `User.implementationPinEnc`. Reversible (so the user can view their own
 * PIN in the admin panel). Verify path = decrypt + constant-time compare.
 *
 * ── Lifecycle ────────────────────────────────────────────────────────────
 *   1. User created with canConfigureHardware=true       → PIN auto-generated
 *   2. Admin flips canConfigureHardware false → true     → PIN auto-generated
 *   3. Weekly scheduler ticks past Monday 00:00 UTC      → PIN rotated
 *   4. Admin flips canConfigureHardware true → false     → PIN cleared
 *
 * Each lifecycle event sends an email with the new PIN to the user.
 *
 * ── Verify ───────────────────────────────────────────────────────────────
 * Cashier-app POSTs the entered PIN to /auth/implementation-pin/verify.
 * The endpoint scans every user with canConfigureHardware=true (small set
 * — internal team only), decrypts each PIN, constant-time-compares to the
 * input. On hit, returns a short-lived JWT scoped to the implementation
 * purpose (1-hour expiry, used to unlock Hardware Settings).
 */

import crypto from 'crypto';
import prisma from '../../config/postgres.js';
import { encrypt as vaultEncrypt, decrypt as vaultDecrypt } from '../../utils/cryptoVault.js';

const PIN_LENGTH = 6;

// ── PIN generation ──────────────────────────────────────────────────────
/**
 * Generate a fresh 6-digit numeric PIN. Uses crypto.randomInt for a uniform
 * distribution across [000000, 999999]. Returns the plaintext (caller must
 * encrypt before persisting).
 */
export function generatePin(): string {
  // randomInt(min, max) — max exclusive. 1000000 → returns 0..999999.
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(PIN_LENGTH, '0');
}

/**
 * Constant-time compare. Both strings are coerced to fixed length before
 * the timingSafeEqual call so an attacker can't infer length from timing.
 */
function pinsEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a.padEnd(PIN_LENGTH, '\0'));
  const bBuf = Buffer.from(b.padEnd(PIN_LENGTH, '\0'));
  if (aBuf.length !== bBuf.length) return false;
  try {
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

/** Strict 6-digit numeric check on user input. */
export function validatePinFormat(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  if (input.length !== PIN_LENGTH) return false;
  return /^[0-9]+$/.test(input);
}

// ── Persistence helpers ─────────────────────────────────────────────────
/**
 * Generate a fresh PIN for a user, persist the encrypted form, return the
 * plaintext to the caller (which is responsible for sending it via email).
 *
 * Caller MUST verify `user.canConfigureHardware === true` before calling —
 * this function trusts that gate.
 */
export async function rotateUserPin(userId: string): Promise<string> {
  const pin = generatePin();
  const enc = vaultEncrypt(pin);
  if (!enc) throw new Error('Failed to encrypt implementation PIN');
  await prisma.user.update({
    where: { id: userId },
    data: {
      implementationPinEnc: enc,
      implementationPinSetAt: new Date(),
    },
  });
  return pin;
}

/** Clear the PIN (used when canConfigureHardware is flipped false). */
export async function clearUserPin(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      implementationPinEnc: null,
      implementationPinSetAt: null,
    },
  });
}

/**
 * Decrypt and return the user's current plaintext PIN. Returns null when
 * not set, or when decryption fails (corrupted ciphertext / vault key
 * mismatch). Caller is responsible for the auth check — this function
 * does NOT verify ownership.
 */
export async function getUserPinPlain(userId: string): Promise<{ pin: string | null; setAt: Date | null }> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { implementationPinEnc: true, implementationPinSetAt: true },
  });
  if (!u || !u.implementationPinEnc) return { pin: null, setAt: u?.implementationPinSetAt || null };
  const plain = vaultDecrypt(u.implementationPinEnc);
  return { pin: plain, setAt: u.implementationPinSetAt };
}

// ── Verify ──────────────────────────────────────────────────────────────
export interface PinVerifyResult {
  ok: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  reason?: 'invalid_format' | 'no_match' | 'no_eligible_users';
}

/**
 * Match an entered PIN against every user with canConfigureHardware=true.
 * Linear scan + decrypt is acceptable here: this set is the platform's
 * implementation team (typically <20 users). Use timingSafeEqual on every
 * comparison to avoid leaking which user matched via timing.
 *
 * Returns the matched user (without the PIN). Caller mints the unlock JWT
 * and adds the audit-log entry.
 */
export async function verifyImplementationPin(input: string): Promise<PinVerifyResult> {
  if (!validatePinFormat(input)) {
    return { ok: false, reason: 'invalid_format' };
  }
  const candidates = await prisma.user.findMany({
    where: {
      canConfigureHardware: true,
      status: 'active',
      implementationPinEnc: { not: null },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      implementationPinEnc: true,
    },
  });
  if (candidates.length === 0) return { ok: false, reason: 'no_eligible_users' };

  // Walk the entire list even after a match to keep timing constant. The
  // matched flag captures the winner; comparisons keep running.
  let match: typeof candidates[number] | null = null;
  for (const c of candidates) {
    const plain = vaultDecrypt(c.implementationPinEnc);
    if (!plain) continue;
    if (pinsEqual(plain, input)) {
      // Don't break — keep timing constant
      if (!match) match = c;
    }
  }
  if (!match) return { ok: false, reason: 'no_match' };
  return {
    ok: true,
    user: {
      id: match.id,
      name: match.name,
      email: match.email,
      role: match.role,
    },
  };
}

// ── Weekly rotation ────────────────────────────────────────────────────
/**
 * Find users whose PIN was set BEFORE last Monday 00:00 UTC and rotate.
 * Returns the list of rotated users (with the new plaintext PIN) so the
 * scheduler can fire emails. Idempotent — re-running mid-week without a
 * past Monday boundary returns an empty array.
 */
export interface RotatedUser {
  id: string;
  name: string;
  email: string;
  pin: string;
  rotatedAt: Date;
}

export async function rotateAllStalePins(now: Date = new Date()): Promise<RotatedUser[]> {
  const lastMondayUTC = mostRecentMondayUTC(now);
  const stale = await prisma.user.findMany({
    where: {
      canConfigureHardware: true,
      status: 'active',
      OR: [
        { implementationPinEnc: null },
        { implementationPinSetAt: null },
        { implementationPinSetAt: { lt: lastMondayUTC } },
      ],
    },
    select: { id: true, name: true, email: true },
  });
  const rotated: RotatedUser[] = [];
  for (const u of stale) {
    const pin = await rotateUserPin(u.id);
    rotated.push({ id: u.id, name: u.name, email: u.email, pin, rotatedAt: new Date() });
  }
  return rotated;
}

/**
 * Compute the most-recent Monday 00:00 UTC at-or-before `now`. If `now` is
 * Monday 00:00 itself, returns `now`. Used to gate "PIN is older than this
 * past Monday".
 */
export function mostRecentMondayUTC(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  // getUTCDay: 0 (Sun) ... 6 (Sat). Monday = 1.
  const day = d.getUTCDay();
  // diff to subtract: if day=1 (Mon) → 0, if day=0 (Sun) → 6, etc.
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

// ── Convenience: full grant flow (called from admin user-update) ────────
/**
 * Grant the canConfigureHardware flag to a user + auto-generate the first
 * PIN. Returns the plaintext PIN so the caller can fire the welcome email.
 *
 * No-op (returns null) if the user already had the flag.
 */
export async function grantHardwareAccess(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { canConfigureHardware: true },
  });
  if (!u) throw new Error('User not found');
  if (u.canConfigureHardware) return null; // already granted; no rotate

  const pin = generatePin();
  const enc = vaultEncrypt(pin);
  if (!enc) throw new Error('Failed to encrypt implementation PIN');
  await prisma.user.update({
    where: { id: userId },
    data: {
      canConfigureHardware: true,
      implementationPinEnc: enc,
      implementationPinSetAt: new Date(),
    },
  });
  return pin;
}

/**
 * Revoke the flag + clear the PIN. Used when admin flips the toggle off
 * OR when a user is suspended / deleted.
 */
export async function revokeHardwareAccess(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      canConfigureHardware: false,
      implementationPinEnc: null,
      implementationPinSetAt: null,
    },
  });
}

// ── RBAC sync: permission ↔ flag + PIN ─────────────────────────────────
/**
 * S(rbac-hardware) — keep `User.canConfigureHardware` in sync with the
 * RBAC permission `hardware_config.access`.
 *
 * Called whenever a user's roles change, a role's permissions change, or
 * an admin flips the shortcut toggle. Recomputes the user's effective
 * permissions; flips the flag + PIN to match.
 *
 *   has-perm + flag-false → grant: flag=true, generate PIN, return pin (caller emails)
 *   no-perm + flag-true   → revoke: flag=false, clear PIN
 *   no-op transitions     → return changed=false
 *
 * Superadmin users are skipped — they shouldn't auto-receive a PIN merely
 * because their catch-all role expanded to include the key. (The wildcard
 * is exempt from this key in expandPermissionGrants, so this guard is
 * belt-and-suspenders.)
 */
export interface HardwareSyncResult {
  changed: boolean;
  granted: boolean;        // true when this call generated a fresh PIN
  revoked: boolean;        // true when this call cleared a PIN
  pin?: string;            // plaintext PIN, present only when granted=true
  user?: { id: string; name: string; email: string };
}

export async function syncHardwareAccessForUser(userId: string): Promise<HardwareSyncResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, email: true, role: true, orgId: true,
      canConfigureHardware: true,
      status: true,
    },
  });
  if (!user) return { changed: false, granted: false, revoked: false };

  // Suspended users: revoke any active PIN regardless of permission state.
  if (user.status !== 'active' && user.canConfigureHardware) {
    await revokeHardwareAccess(userId);
    return { changed: true, granted: false, revoked: true, user: { id: user.id, name: user.name, email: user.email } };
  }

  // Skip superadmins — they don't auto-receive a PIN. If a superadmin needs
  // hardware access for testing, an admin assigns them the role explicitly.
  if (user.role === 'superadmin') {
    return { changed: false, granted: false, revoked: false };
  }

  // Compute effective permissions (org context = user's home org for the
  // permission lookup; admin-scope perms aren't org-bound but the function
  // handles that internally).
  const { computeUserPermissions } = await import('../../rbac/permissionService.js');
  const perms = await computeUserPermissions(user, user.orgId || null);
  const hasAccess = perms.includes('hardware_config.access');

  if (hasAccess && !user.canConfigureHardware) {
    // Grant + generate fresh PIN
    const pin = generatePin();
    const enc = vaultEncrypt(pin);
    if (!enc) throw new Error('Failed to encrypt implementation PIN');
    await prisma.user.update({
      where: { id: userId },
      data: {
        canConfigureHardware: true,
        implementationPinEnc: enc,
        implementationPinSetAt: new Date(),
      },
    });
    return {
      changed: true, granted: true, revoked: false, pin,
      user: { id: user.id, name: user.name, email: user.email },
    };
  }

  if (!hasAccess && user.canConfigureHardware) {
    // Permission was revoked — clear flag + PIN
    await revokeHardwareAccess(userId);
    return {
      changed: true, granted: false, revoked: true,
      user: { id: user.id, name: user.name, email: user.email },
    };
  }

  return { changed: false, granted: false, revoked: false };
}

// ── Hardware Configurator role helpers ─────────────────────────────────
/**
 * Find the system "Hardware Configurator" role row. Returns null when
 * seedRbac hasn't been run yet — callers MUST handle the null case
 * gracefully (typically: log a warning + skip the role assignment, then
 * fall back to the legacy direct-flag-flip behavior).
 */
export async function findHardwareConfiguratorRole(): Promise<{ id: string } | null> {
  return prisma.role.findFirst({
    where: { key: 'hardware-configurator', orgId: null, isSystem: true, status: 'active' },
    select: { id: true },
  });
}

/** Idempotent: assigns user to the Hardware Configurator role. */
export async function assignHardwareConfiguratorRole(userId: string): Promise<boolean> {
  const role = await findHardwareConfiguratorRole();
  if (!role) {
    console.warn('[implementationPin] Hardware Configurator role not found — run seedRbac first.');
    return false;
  }
  await prisma.userRole.upsert({
    where:  { userId_roleId: { userId, roleId: role.id } },
    create: { userId, roleId: role.id },
    update: {},
  });
  return true;
}

/** Idempotent: removes user from the Hardware Configurator role. */
export async function removeHardwareConfiguratorRole(userId: string): Promise<boolean> {
  const role = await findHardwareConfiguratorRole();
  if (!role) return false;
  await prisma.userRole.deleteMany({ where: { userId, roleId: role.id } });
  return true;
}

