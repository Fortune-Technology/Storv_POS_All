/**
 * Certification harness — sample file generator + per-enrollment progress
 * checklist + per-mfr playbook content + canonical scenario list.
 * Split from `scanDataController.ts` (S80).
 *
 * Permissions:
 *   scan_data.view    — checklist, playbook, scenarios
 *   scan_data.submit  — sample-file generation
 */

import type { Request, Response } from 'express';
import { generateSampleFile, CERT_SCENARIOS } from '../../services/scanData/certHarness.js';
import { getChecklist as getCertChecklist } from '../../services/scanData/certChecklist.js';
import { getPlaybook, listAvailablePlaybooks } from '../../services/scanData/certPlaybook.js';
import { getOrgId } from './helpers.js';

// ── POST /scan-data/cert/sample-file (manager+ via scan_data.submit) ──────
//
// Builds a representative sample file for cert in-memory and returns the
// file body + scenario coverage report. NO DB writes — synthetic
// transactions never pollute real tx history.
export const generateCertSampleFile = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as { manufacturerId?: string; periodStart?: string };
    const { manufacturerId, periodStart } = body;
    if (!manufacturerId) { res.status(400).json({ success: false, error: 'manufacturerId is required' }); return; }

    const result = await generateSampleFile({ orgId: orgId as string, manufacturerId, periodStart } as Parameters<typeof generateSampleFile>[0]);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[scanData] generateCertSampleFile failed:', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── GET /scan-data/cert/checklist?enrollmentId=... (manager+ via scan_data.view) ──
//
// Derives the cert progress for a given enrollment from the DB. Used by
// the portal CertModal to render the green/amber/grey step list.
export const getEnrollmentCertChecklist = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as { enrollmentId?: string };
    const { enrollmentId } = q;
    if (!enrollmentId) { res.status(400).json({ success: false, error: 'enrollmentId is required' }); return; }

    const checklist = await getCertChecklist({ orgId: orgId as string, enrollmentId } as Parameters<typeof getCertChecklist>[0]);
    res.json({ success: true, data: checklist });
  } catch (err) {
    console.error('[scanData] getEnrollmentCertChecklist failed:', err);
    const e = err as Error;
    res.status(e.message === 'Enrollment not found' ? 404 : 500).json({ success: false, error: e.message });
  }
};

// ── GET /scan-data/cert/playbook/:mfrCode (manager+ via scan_data.view) ───
//
// Returns the per-mfr cert guide content. Sub-feeds (altria_pmusa, rjr_edlp,
// etc.) all return their parent's playbook since cert is conducted at the
// parent-mfr level.
export const getCertPlaybook = async (req: Request, res: Response): Promise<void> => {
  try {
    const { mfrCode } = req.params;
    const playbook = getPlaybook(mfrCode);
    if (!playbook) {
      res.status(404).json({
        success: false,
        error: `No playbook for manufacturer code: ${mfrCode}`,
        available: listAvailablePlaybooks(),
      });
      return;
    }
    res.json({ success: true, data: playbook });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── GET /scan-data/cert/scenarios (manager+ via scan_data.view) ───────────
//
// Returns the canonical list of cert scenarios the harness covers. The
// CertModal uses this for the "scenarios covered" checklist.
export const getCertScenarios = async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: { scenarios: CERT_SCENARIOS } });
};
