/**
 * Manufacturer catalog (read-only, platform-level).
 * Split from `scanDataController.ts` (S80) — listManufacturers handler.
 */

import type { Request, Response } from 'express';
import prisma from '../../config/postgres.js';

// ══════════════════════════════════════════════════════════════════════════
// MANUFACTURER CATALOG
// ══════════════════════════════════════════════════════════════════════════

export const listManufacturers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.tobaccoManufacturer.findMany({
      where: { active: true },
      orderBy: [{ parentMfrCode: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
