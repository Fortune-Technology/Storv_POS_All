/**
 * autoAudit — Global fire-and-forget audit logger for mutating API calls.
 *
 * Runs AFTER the response is sent for POST / PUT / PATCH / DELETE requests
 * against `/api/*`, and records one row in `audit_logs`. This captures every
 * write action automatically — no controller changes required.
 *
 * Explicit `logAudit(req, ...)` calls from controllers still write separate
 * rows with richer details (field-level before/after). The two coexist:
 * the auto row confirms the action happened; the explicit row carries the
 * meaningful diff.
 *
 * Skipped to avoid noise:
 *   - Non-mutating methods (GET / HEAD / OPTIONS)
 *   - Paths explicitly blacklisted (health, chat polls, AI stream, etc.)
 *   - Responses with 4xx/5xx status codes when `logFailures` is false
 */

import type { RequestHandler } from 'express';
import prisma from '../config/postgres.js';

// Paths to NOT auto-audit (health probes, polling endpoints, file proxies).
// Match by `req.originalUrl.startsWith(prefix)`.
const SKIP_PREFIXES = [
  '/api/auth/verify-password',  // lock-screen unlocks — noisy, no state change
  '/api/chat/read',             // read-receipt polling
  '/api/chat/partner/read',
  '/api/ai-assistant/conversations', // streaming + polling heavy, tracked per-message already
  '/api/pos-terminal/events',   // POS event log is its own stream
  '/api/pos-terminal/print',
  '/api/tasks/counts',          // badge polling
  '/api/chat/unread',
];

// Action inference from HTTP method.
function actionFor(method: string): string {
  switch (method.toUpperCase()) {
    case 'POST':   return 'create';
    case 'PUT':    return 'update';
    case 'PATCH':  return 'update';
    case 'DELETE': return 'delete';
    default:       return method.toLowerCase();
  }
}

// Derive a coarse "module" key from the URL path.
// /api/catalog/products/:id  -> "catalog"
// /api/customers             -> "customers"
// /api/roles/users/:uid/roles -> "roles"
export function moduleFromPath(urlPath: string | null | undefined): string {
  if (!urlPath) return 'other';
  const m = urlPath.replace(/^\/api\//, '').split('/')[0] || 'other';
  return m.split('?')[0];
}

// Entity inference — second URL segment when meaningful (products, customers,
// stores), otherwise the module itself.
function entityFromPath(urlPath: string): string {
  const parts = urlPath.replace(/^\/api\//, '').split('/');
  // For nested routes /catalog/products/:id/upcs etc., prefer the deepest
  // named segment (products / upcs / etc.)
  const namedSegments = parts.filter(p => p && !/^[0-9a-f-]{8,}$/i.test(p) && !p.includes('?'));
  return namedSegments[1] || namedSegments[0] || 'other';
}

function entityIdFromPath(urlPath: string): string | null {
  const parts = urlPath.replace(/^\/api\//, '').split('/').map(p => p.split('?')[0]);
  // Walk from the end; first segment that looks like an id wins
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (!p) continue;
    // Accept cuid (24+ alnum), uuid, or numeric id
    if (/^[a-z0-9_-]{8,}$/i.test(p) || /^\d+$/.test(p)) return p;
  }
  return null;
}

interface AutoAuditOptions {
  logFailures?: boolean;
}

export function autoAudit(opts: AutoAuditOptions = {}): RequestHandler {
  const { logFailures = false } = opts;

  return function (req, res, next) {
    const method = (req.method || 'GET').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      next();
      return;
    }

    const url = req.originalUrl || req.url || '';
    if (SKIP_PREFIXES.some(p => url.startsWith(p))) {
      next();
      return;
    }

    const started = Date.now();

    res.on('finish', () => {
      try {
        const status = res.statusCode;
        const ok = status >= 200 && status < 400;
        if (!ok && !logFailures) return;

        // Must be after `protect` middleware to have req.user; otherwise skip.
        const userId = req.user?.id;
        if (!userId) return;

        const entity   = entityFromPath(url);
        const entityId = entityIdFromPath(url);
        const module   = moduleFromPath(url);

        const userAgent = req.headers?.['user-agent'];
        const userAgentSample = typeof userAgent === 'string' ? userAgent.substring(0, 200) : null;
        const xForwardedFor = req.headers?.['x-forwarded-for'];
        const ipFromHeader = typeof xForwardedFor === 'string' ? xForwardedFor : null;

        prisma.auditLog.create({
          data: {
            orgId:     req.orgId || req.user?.orgId || 'unknown',
            storeId:   req.storeId || null,
            userId,
            userName:  req.user?.name || req.user?.email || 'Unknown',
            userRole:  req.user?.role || null,
            action:    actionFor(method),
            entity,
            entityId,
            details: {
              module,
              method,
              path:     url.split('?')[0],
              status,
              durationMs: Date.now() - started,
              auto:     true,
              ...(ok ? {} : { error: true }),
            },
            ipAddress: req.ip || ipFromHeader || null,
            userAgent: userAgentSample,
            source:    req.get?.('X-App-Surface') === 'cashier' ? 'cashier' : 'portal',
          },
        }).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('[autoAudit] write failed:', message);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[autoAudit] hook threw:', message);
      }
    });

    next();
  };
}

export default autoAudit;
