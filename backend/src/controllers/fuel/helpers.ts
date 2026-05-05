/**
 * fuel/helpers.ts
 *
 * Shared helpers for the fuel controller modules. Extracted as part of the
 * Refactor Pass D split (S80) of fuelController.ts (1369L → per-domain
 * folder). Pattern matches controllers/sales/ and controllers/shift/ from S53.
 *
 *   getOrgId / getStore — request-scoped tenant + store id resolvers
 *   num                  — accept "", null, undefined → null else Number()
 *   FifoLayer            — shape of one entry inside FuelTransaction.fifoLayers JSON
 */

import type { Request } from 'express';

export const getOrgId = (req: Request): string | null | undefined =>
  req.orgId || req.user?.orgId;

export const getStore = (req: Request): string | null | undefined =>
  (req.headers['x-store-id'] as string | undefined)
  || req.storeId
  || (req.query as { storeId?: string } | undefined)?.storeId;

export const num = (v: unknown): number | null =>
  v != null && v !== '' ? Number(v) : null;

export interface FifoLayer {
  gallons?: number | string | null;
  pricePerGallon?: number | string | null;
  cost?: number | string | null;
}
