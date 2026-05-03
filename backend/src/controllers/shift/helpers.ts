/**
 * Shift controller — shared helpers + types.
 *
 * Used by every sub-module under `controllers/shift/*`. The split is
 * intentionally narrow — `getOrgId` and the `TenderLine` shape are the
 * only things multiple files need; everything else stays local to its
 * concern.
 */

import type { Request } from 'express';

export const getOrgId = (req: Request): string | null | undefined =>
  req.orgId || req.user?.orgId;

export interface TenderLine {
  method?: string | null;
  amount?: number | string | null;
}
