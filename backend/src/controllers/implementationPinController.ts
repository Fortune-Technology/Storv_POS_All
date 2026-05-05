/**
 * S78 — Implementation Engineer PIN endpoints.
 *
 * Public:
 *   POST /api/auth/implementation-pin/verify
 *     Body: { pin: '123456' }
 *     200:  { token, user, expiresAt }      — short-lived JWT (1h, purpose='hardware')
 *     401:  { error: 'invalid_pin' }
 *     400:  { error: 'invalid_format' }
 *
 *   This endpoint is NOT JWT-gated — the cashier-app may have a non-eligible
 *   user signed in (or no user at all if the cashier-app is fresh). The PIN
 *   IS the auth factor.
 *
 * Authenticated:
 *   GET  /api/users/me/implementation-pin
 *     Returns the calling user's current PIN (decrypted) so they can read
 *     it from the admin panel. Requires `canConfigureHardware = true`.
 *
 *   POST /api/users/me/implementation-pin/rotate
 *     Forces an immediate rotation. Returns the fresh PIN. Fires email.
 */
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/postgres.js';
import {
  verifyImplementationPin,
  getUserPinPlain,
  rotateUserPin,
  mostRecentMondayUTC,
} from '../services/implementationPin/service.js';
import { sendImplementationPinEmail } from '../services/notifications/email.js';
import { logAudit } from '../services/auditService.js';
import { pinLimiter } from '../middleware/rateLimit.js';

// 1-hour unlock window once PIN is verified — matches user's spec.
const HARDWARE_TOKEN_TTL_SECONDS = 60 * 60;

function jwtSecret(): string {
  return (process.env.JWT_SECRET || 'dev-secret-change-me') as string;
}

// ─── POST /auth/implementation-pin/verify ──────────────────────────────────
// Public — rate-limited via the existing pinLimiter (15 attempts / 5 min).
export async function verifyEndpoint(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body || {}) as { pin?: string };
    const result = await verifyImplementationPin(body.pin || '');

    if (!result.ok || !result.user) {
      const status = result.reason === 'invalid_format' ? 400 : 401;
      res.status(status).json({ error: result.reason === 'invalid_format' ? 'invalid_format' : 'invalid_pin' });
      // Audit the failed attempt — IP + user-agent come from req
      logAudit(req, 'implementation_pin_verify_fail', 'auth', null, { reason: result.reason });
      return;
    }

    const expiresAt = new Date(Date.now() + HARDWARE_TOKEN_TTL_SECONDS * 1000);
    const token = jwt.sign(
      {
        sub: result.user.id,
        purpose: 'hardware',
        userId: result.user.id,
        userEmail: result.user.email,
      },
      jwtSecret(),
      { expiresIn: HARDWARE_TOKEN_TTL_SECONDS },
    );

    logAudit(req, 'implementation_pin_verify_ok', 'user', result.user.id, {
      userEmail: result.user.email,
      stationId: req.headers['x-station-id'] || null,
    });

    res.json({
      token,
      user: result.user,
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: HARDWARE_TOKEN_TTL_SECONDS,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

// ─── GET /users/me/implementation-pin ──────────────────────────────────────
// Authenticated. Returns the calling user's current PIN if they have the flag.
export async function getMyPin(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { canConfigureHardware: true, implementationPinSetAt: true, name: true, email: true },
    });
    if (!u) { res.status(404).json({ error: 'User not found' }); return; }
    if (!u.canConfigureHardware) {
      res.status(403).json({ error: 'You do not have hardware-configuration access' });
      return;
    }

    const { pin, setAt } = await getUserPinPlain(userId);
    const nextRotation = nextMondayAfter(setAt || new Date());

    res.json({
      pin: pin || null,
      setAt: setAt ? setAt.toISOString() : null,
      nextRotationAt: nextRotation.toISOString(),
      canConfigureHardware: true,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

// ─── POST /users/me/implementation-pin/rotate ──────────────────────────────
// Authenticated. Force-rotates the calling user's PIN. Sends the new PIN
// by email AND returns it inline so the panel can show it immediately.
export async function rotateMyPin(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { canConfigureHardware: true, name: true, email: true },
    });
    if (!u) { res.status(404).json({ error: 'User not found' }); return; }
    if (!u.canConfigureHardware) {
      res.status(403).json({ error: 'You do not have hardware-configuration access' });
      return;
    }

    const newPin = await rotateUserPin(userId);
    // Fire email — best-effort; failure shouldn't block the response.
    sendImplementationPinEmail(u.email, u.name, newPin, 'manual_rotate').catch((e) =>
      console.warn('[implementationPin] manual_rotate email failed:', e?.message)
    );

    logAudit(req, 'implementation_pin_manual_rotate', 'user', userId, { self: true });

    res.json({
      pin: newPin,
      setAt: new Date().toISOString(),
      nextRotationAt: nextMondayAfter(new Date()).toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
/** Compute the upcoming Monday 00:00 UTC strictly AFTER `from`. */
function nextMondayAfter(from: Date): Date {
  const lastMonday = mostRecentMondayUTC(from);
  const next = new Date(lastMonday);
  next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

// Re-export pinLimiter so the route file can mount it without a separate import.
export { pinLimiter };
