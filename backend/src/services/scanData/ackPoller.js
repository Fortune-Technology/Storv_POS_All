/**
 * ackPoller.js — Watch the SFTP /ack/ directory for response files (Session 48).
 *
 * Tied to the same dynamic-import stub as `sftpService.js` — without
 * `ssh2-sftp-client` installed, this is a no-op that warns once.
 *
 * Polling cadence: every 30 minutes (set via SCAN_DATA_ACK_POLL_INTERVAL_MS
 * env var, default 30 min). Most mfrs return acks within hours of upload,
 * but cert-time spikes can take longer; 30min is a reasonable balance.
 *
 * Convention for matching ack file → submission:
 *   1. Most mfrs name the ack with the original filename + a suffix
 *      (e.g. "STORV-001_20260424.csv.ack" or "STORV-001_20260424.RESP")
 *   2. We list the /ack/ dir, match files whose name STARTS WITH the
 *      submission's fileName (minus extension)
 *   3. Download the matched file, parse via the per-mfr parser, run reconciliation
 *   4. Move/delete the ack file from /ack/ to /ack/processed/ (best-effort)
 *
 * Stub-mode safe: if ssh2-sftp-client isn't installed, polling is skipped
 * cleanly and reconciliation can still happen via the manual
 * `POST /scan-data/submissions/:id/process-ack` endpoint.
 */

import path from 'path';
import { decrypt } from '../../utils/cryptoVault.js';
import prisma from '../../config/postgres.js';
import { parseAck } from './ackParsers/index.js';
import { reconcileAck } from './reconciliation.js';

let _SftpClient = null;
let _loadAttempted = false;
let _started = false;

const POLL_INTERVAL_MS = Number(process.env.SCAN_DATA_ACK_POLL_INTERVAL_MS || 30 * 60 * 1000);
const ACK_REMOTE_PATH  = process.env.SCAN_DATA_ACK_REMOTE_PATH  || '/ack/';
const PROCESSED_REMOTE = process.env.SCAN_DATA_ACK_PROCESSED_PATH || '/ack/processed/';

async function loadSftpClient() {
  if (_SftpClient) return _SftpClient;
  if (_loadAttempted) return null;
  _loadAttempted = true;
  try {
    const mod = await import('ssh2-sftp-client');
    _SftpClient = mod.default || mod;
    return _SftpClient;
  } catch {
    console.warn('[ScanData/AckPoller] ssh2-sftp-client not installed — ack polling disabled.');
    console.warn('[ScanData/AckPoller] Manual ack processing still works via POST /scan-data/submissions/:id/process-ack');
    return null;
  }
}

/**
 * Poll one enrollment's ack directory and reconcile any new files found.
 * Idempotent — already-processed submissions skip reconciliation a second time.
 *
 * Returns: { polled, processed, reconciled, errors }
 */
export async function pollAcksForEnrollment(enrollment) {
  const SftpClient = await loadSftpClient();
  if (!SftpClient || !enrollment.sftpHost) {
    return { polled: 0, processed: 0, reconciled: 0, errors: [], skipped: true };
  }

  const password = enrollment.sftpPasswordEnc ? decrypt(enrollment.sftpPasswordEnc) : null;
  const sftp = new SftpClient();
  const errors = [];

  try {
    await sftp.connect({
      host:     enrollment.sftpHost,
      port:     enrollment.sftpPort || 22,
      username: enrollment.sftpUsername,
      password: password || undefined,
      readyTimeout: 30000,
    });

    let ackFiles = [];
    try {
      ackFiles = (await sftp.list(ACK_REMOTE_PATH)).filter(f => f.type === '-');
    } catch (err) {
      errors.push(`list(${ACK_REMOTE_PATH}): ${err.message}`);
    }

    let processed = 0;
    let reconciled = 0;

    for (const f of ackFiles) {
      const matched = await findSubmissionForAckFile({
        ackFilename: f.name,
        orgId:          enrollment.orgId,
        storeId:        enrollment.storeId,
        manufacturerId: enrollment.manufacturerId,
      });
      if (!matched) {
        errors.push(`ack ${f.name} did not match any submission`);
        continue;
      }
      // Skip if this submission already has a non-empty ackContent
      if (matched.ackedAt) continue;

      try {
        const buf = await sftp.get(path.posix.join(ACK_REMOTE_PATH, f.name));
        const content = buf.toString('utf8');
        const parsed = parseAck({
          mfrCode: enrollment.manufacturer.code,
          content, fileName: f.name,
        });
        await reconcileAck({ submission: matched, ack: parsed });
        reconciled++;

        // Move to /ack/processed/ — best-effort
        try {
          await sftp.rename(
            path.posix.join(ACK_REMOTE_PATH, f.name),
            path.posix.join(PROCESSED_REMOTE, f.name),
          );
        } catch {/* mfr may not allow renames; that's fine */}
      } catch (err) {
        errors.push(`process ${f.name}: ${err.message}`);
      }
      processed++;
    }

    await sftp.end();
    return { polled: ackFiles.length, processed, reconciled, errors, skipped: false };
  } catch (err) {
    try { await sftp.end(); } catch {}
    return { polled: 0, processed: 0, reconciled: 0, errors: [err.message], skipped: false };
  }
}

/**
 * Match an ack filename to its corresponding ScanDataSubmission row.
 *
 * Most mfrs return the ack with the original filename plus a suffix or
 * extension change. We match by prefix:
 *   submission.fileName = "STORV-001_20260424.csv"
 *   ackFilename         = "STORV-001_20260424.csv.ack"  → match
 *   ackFilename         = "STORV-001_20260424.RESP"     → match (strip ext)
 *
 * Falls back to exact-match if prefix matching finds nothing.
 */
async function findSubmissionForAckFile({ ackFilename, orgId, storeId, manufacturerId }) {
  const stem = ackFilename.split('.')[0];
  const candidates = await prisma.scanDataSubmission.findMany({
    where: {
      orgId, storeId, manufacturerId,
      OR: [
        { fileName: { startsWith: stem } },
        { fileName: ackFilename },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  // Prefer the most recent submission whose fileName matches as a prefix
  return candidates.find(c => ackFilename.startsWith(c.fileName.split('.').slice(0, -1).join('.')))
      || candidates[0]
      || null;
}

/**
 * Tick: iterate every active+certifying enrollment that has an SFTP host,
 * poll its ack directory, and run reconciliation for new files.
 */
async function tick() {
  try {
    const enrollments = await prisma.scanDataEnrollment.findMany({
      where: {
        status:   { in: ['active', 'certifying'] },
        sftpHost: { not: null },
      },
      include: { manufacturer: true },
    });

    if (enrollments.length === 0) return;

    let totalPolled = 0, totalReconciled = 0, totalErrors = 0;
    for (const e of enrollments) {
      const r = await pollAcksForEnrollment(e);
      totalPolled     += r.polled;
      totalReconciled += r.reconciled;
      totalErrors     += r.errors.length;
      if (r.errors.length) {
        for (const err of r.errors) {
          console.warn(`[ScanData/AckPoller] ${e.manufacturer.code}: ${err}`);
        }
      }
    }

    if (totalPolled + totalReconciled + totalErrors > 0) {
      console.log(`[ScanData/AckPoller] tick — polled=${totalPolled} reconciled=${totalReconciled} errors=${totalErrors}`);
    }
  } catch (err) {
    console.error('[ScanData/AckPoller] tick failed:', err.message);
  }
}

export function startAckPoller() {
  if (_started) return;
  _started = true;
  console.log(`[ScanData/AckPoller] started — sweep every ${Math.round(POLL_INTERVAL_MS / 60000)}min, watching ${ACK_REMOTE_PATH}`);
  setTimeout(() => { tick().catch(() => {}); }, 60 * 1000); // first tick after 1 min
  setInterval(() => { tick().catch(() => {}); }, POLL_INTERVAL_MS);
}
