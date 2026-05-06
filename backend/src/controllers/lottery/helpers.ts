/**
 * Shared utilities for the Lottery controller modules.
 * Split from `lotteryController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Exports:
 *   - Tenant helpers: getOrgId, getStore
 *   - num — null-safe number coercer
 *   - Permissive Prisma row shapes: LotteryTxnRow, LotteryOnlineTotalRow,
 *     LotteryGameRow, LotteryBoxLite, LotteryBoxValueRow, LotteryScanEventRow
 *   - Per-day / per-game aggregation buckets: DayBucket, GameBucket
 *
 * Why row aliases? The default `prisma` import resolves to `any` (postgres.js
 * wraps a nullable global), which would taint every callback parameter with
 * implicit-any errors under strict mode. We cast each findMany result to
 * these shapes so .filter/.map/.reduce callbacks see real types.
 */

import type { Request } from 'express';

export const getOrgId = (req: Request): string | undefined =>
  req.orgId || req.user?.orgId || undefined;

export const getStore = (req: Request): string | undefined => {
  const h = req.headers['x-store-id'];
  if (typeof h === 'string') return h;
  if (Array.isArray(h) && typeof h[0] === 'string') return h[0];
  if (req.storeId) return req.storeId;
  const q = req.query?.storeId;
  if (typeof q === 'string') return q;
  if (Array.isArray(q) && typeof q[0] === 'string') return q[0];
  return undefined;
};

// ── helpers ────────────────────────────────────────────────────────────────
export const num = (v: unknown): number | null => (v != null ? Number(v) : null);

/**
 * Parse a YYYY-MM-DD query param into a local-midnight Date (DB Date column
 * stores the calendar day without TZ). Same pattern used by
 * employeeReportsController + posTerminalController.listTransactions.
 */
export function parseDate(str: unknown): Date | null {
  if (!str) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const d = new Date(String(str) + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// JSON-typed payload for LotteryScanEvent.parsed
export type ScanEventParsed = Record<string, unknown>;

// ── Permissive row shapes for prisma findMany results ─────────────────────
export type LotteryTxnRow = {
  id?: string;
  type: string;
  amount: number | string;
  shiftId?: string | null;
  cashierId?: string | null;
  stationId?: string | null;
  gameId?: string | null;
  boxId?: string | null;
  ticketCount?: number | null;
  notes?: string | null;
  posTransactionId?: string | null;
  createdAt: Date;
};

export type LotteryOnlineTotalRow = {
  date: Date;
  machineSales?: number | string | null;
  machineCashing?: number | string | null;
  instantCashing?: number | string | null;
};

export type LotteryGameRow = { id: string; name: string };

export type LotteryBoxLite = {
  id: string;
  ticketPrice: number | string;
  startTicket: string | null;
  totalTickets: number | null;
  currentTicket?: string | null;
  gameId?: string;
};

export type LotteryBoxValueRow = {
  totalValue: number | string | null;
  ticketsSold?: number | null;
  ticketPrice?: number | string | null;
  totalTickets?: number | null;
};

export type LotteryScanEventRow = {
  boxId: string | null;
  parsed: unknown;
  createdAt?: Date;
};

// Per-day / per-game / per-box buckets used in reports
export interface DayBucket {
  date: string;
  sales: number;
  payouts: number;
  net: number;
  machineSales: number;
  machineCashing: number;
  instantCashing: number;
}

export interface GameBucket {
  gameId: string;
  gameName: string | null;
  sales: number;
  payouts: number;
  net: number;
  count: number;
}
