/**
 * Shared helpers for the scan-data controller modules.
 * Split out from `scanDataController.ts` (S80 — refactor pass D)
 * following the S53 pattern (sales/shift split).
 */

import type { Request } from 'express';

export const getOrgId = (req: Request): string | null | undefined =>
  req.orgId || req.user?.orgId;
