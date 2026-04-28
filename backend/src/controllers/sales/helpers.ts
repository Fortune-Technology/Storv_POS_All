/**
 * Sales controller — shared helpers + types.
 *
 * Imported by every sub-module under `controllers/sales/*`. Keeps the date
 * arithmetic + error formatting + type definitions in one place so the
 * handler files stay focused on their domain logic.
 */

import type { Request } from 'express';

// ─── Date arithmetic ─────────────────────────────────────────────────────
export const toISO = (d: Date): string => d.toISOString().slice(0, 10);
export const r2    = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;

export const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISO(d);
};

export const weeksAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return toISO(d);
};

export const monthsAgo = (n: number): string => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return toISO(d);
};

export const today = (): string => toISO(new Date());

// ─── User-context types ──────────────────────────────────────────────────
// Wide-as-permissive — sales-service typing accepts SalesUserContext which is
// `{ orgId?, [key: string]: unknown }`. The req.user shape satisfies this since
// every controller injects `orgId` via scopeToTenant (or it's undefined for
// unauthenticated routes).
export type SalesUser = { orgId?: string | null; [k: string]: unknown };

// req.user has the rich AuthedUser shape but the legacy salesController treats
// it as opaque + reads optional storeLatitude/Longitude/Timezone fields that
// were previously on a flatter "POSUser" object. Cast through unknown to a
// permissive shape that exposes those fields without fighting Prisma's User type.
export type WithLatLng = SalesUser & {
  storeLatitude?: number | null;
  storeLongitude?: number | null;
  storeTimezone?: string | null;
};

export const userFor = (req: Request): SalesUser =>
  (req.posUser ?? req.user) as unknown as SalesUser;

export const userWithLatLng = (req: Request): WithLatLng =>
  (req.user ?? {}) as unknown as WithLatLng;

// ─── Error formatting ────────────────────────────────────────────────────
export interface ErrorWithResponse {
  message?: string;
  response?: {
    data?: { message?: string; Message?: string } | unknown;
  };
}

export const detailedErrorMessage = (err: unknown): string => {
  const e = err as ErrorWithResponse;
  const data = e.response?.data as { message?: string; Message?: string } | undefined;
  return data?.message || data?.Message || e.message || String(err);
};

// ─── Shared envelope shape used by daily/weekly/monthly aggregations ─────
export interface SalesEnvelopeRow {
  Date?: string;
  TotalNetSales?: number;
  tempMean?: number | null;
  precipitation?: number | null;
  weatherCode?: number | null;
  [k: string]: unknown;
}

export interface SalesEnvelope {
  value?: SalesEnvelopeRow[];
  [k: string]: unknown;
}
