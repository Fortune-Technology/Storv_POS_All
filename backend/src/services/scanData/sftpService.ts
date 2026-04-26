/**
 * sftpService.ts — SFTP upload for scan-data submissions (Session 47).
 *
 * Dynamic-import pattern (same as smsService.js): the `ssh2-sftp-client`
 * package is loaded lazily so the rest of the scan-data pipeline works in
 * dry-run mode WITHOUT the dependency installed. To activate real SFTP:
 *
 *   cd backend
 *   npm i ssh2-sftp-client
 *   pm2 restart api-pos
 *
 * After install, real uploads happen automatically — no callsite changes.
 *
 * Retry policy: 3 attempts with exponential backoff (1s, 4s, 16s). After
 * exhaustion, throws — generator.js catches and marks the submission row
 * `status='failed'` with the last error message.
 */

import fs from 'fs';
import { decrypt } from '../../utils/cryptoVault.js';

/** Minimal subset of ScanDataEnrollment used by this module. */
export interface SftpEnrollment {
  sftpHost?: string | null;
  sftpPort?: number | null;
  sftpUsername?: string | null;
  sftpPasswordEnc?: string | null;
  sftpPath?: string | null;
  [extra: string]: unknown;
}

interface SftpRemoteEntry {
  name: string;
  [extra: string]: unknown;
}

/** Loose contract for the dynamic-imported ssh2-sftp-client class. */
interface SftpInstance {
  connect(opts: {
    host: string;
    port?: number;
    username?: string | null;
    password?: string;
    readyTimeout?: number;
  }): Promise<unknown>;
  fastPut(local: string, remote: string): Promise<unknown>;
  list(remotePath: string): Promise<SftpRemoteEntry[]>;
  end(): Promise<unknown>;
}

type SftpCtor = new () => SftpInstance;

let _SftpClient: SftpCtor | null = null;
let _loadAttempted = false;

async function loadSftpClient(): Promise<SftpCtor | null> {
  if (_SftpClient) return _SftpClient;
  if (_loadAttempted) return null;
  _loadAttempted = true;

  try {
    // @ts-expect-error — optional dep, no types installed
    const mod = await import('ssh2-sftp-client');
    _SftpClient = (mod.default || mod) as SftpCtor;
    console.log('[ScanData/SFTP] ssh2-sftp-client loaded.');
    return _SftpClient;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[ScanData/SFTP] ssh2-sftp-client not installed:', message);
    console.warn('[ScanData/SFTP] Submissions will write files locally but skip SFTP upload.');
    console.warn('[ScanData/SFTP] To enable real uploads: cd backend && npm i ssh2-sftp-client');
    return null;
  }
}

export interface UploadFileOpts {
  enrollment: SftpEnrollment;
  localFilePath: string;
  remoteFilename: string;
  onAttempt?: (attempt: number, err: Error | null) => void;
}

export interface UploadFileResult {
  uploaded: boolean;
  skipped: boolean;
  attempts: number;
  error?: string;
}

/**
 * Upload a single file via SFTP. Returns { uploaded, skipped, attempts, error? }.
 */
export async function uploadFile(
  { enrollment, localFilePath, remoteFilename, onAttempt }: UploadFileOpts,
): Promise<UploadFileResult> {
  const SftpClient = await loadSftpClient();

  // Stub mode — package not installed
  if (!SftpClient) {
    return {
      uploaded: false,
      skipped:  true,
      attempts: 0,
      error:    'ssh2-sftp-client not installed (run: npm i ssh2-sftp-client). File written locally only.',
    };
  }

  // Stub mode — host not configured (still in cert-prep stage)
  if (!enrollment.sftpHost) {
    return {
      uploaded: false,
      skipped:  true,
      attempts: 0,
      error:    'No SFTP host configured for this enrollment.',
    };
  }

  const password = enrollment.sftpPasswordEnc ? decrypt(enrollment.sftpPasswordEnc) : null;
  const remotePath = (enrollment.sftpPath || '/upload/').replace(/\/+$/, '') + '/' + remoteFilename;

  const MAX_ATTEMPTS = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const sftp = new SftpClient();
    try {
      await sftp.connect({
        host:     enrollment.sftpHost,
        port:     enrollment.sftpPort || 22,
        username: enrollment.sftpUsername,
        password: password || undefined,
        readyTimeout: 30000,
      });

      await sftp.fastPut(localFilePath, remotePath);
      await sftp.end();

      onAttempt?.(attempt, null);
      return { uploaded: true, skipped: false, attempts: attempt };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;
      onAttempt?.(attempt, error);
      console.warn(`[ScanData/SFTP] attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}`);
      try { await sftp.end(); } catch { /* noop */ }

      if (attempt < MAX_ATTEMPTS) {
        // Exponential backoff: 1s, 4s, 16s
        const delay = Math.pow(4, attempt - 1) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  return {
    uploaded: false,
    skipped:  false,
    attempts: MAX_ATTEMPTS,
    error:    lastError?.message || 'unknown SFTP error',
  };
}

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
  fileCount?: number;
  samples?: string[];
}

/**
 * Quick connection check — used by the back-office "Test Connection" button
 * (Session 48). Connects, lists the upload dir, returns success/error.
 */
export async function testConnection(enrollment: SftpEnrollment): Promise<TestConnectionResult> {
  const SftpClient = await loadSftpClient();
  if (!SftpClient) {
    return { ok: false, error: 'ssh2-sftp-client not installed' };
  }
  if (!enrollment.sftpHost || !enrollment.sftpUsername) {
    return { ok: false, error: 'SFTP host or username not configured' };
  }
  const password = enrollment.sftpPasswordEnc ? decrypt(enrollment.sftpPasswordEnc) : null;
  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host:     enrollment.sftpHost,
      port:     enrollment.sftpPort || 22,
      username: enrollment.sftpUsername,
      password: password || undefined,
      readyTimeout: 15000,
    });
    const list = await sftp.list(enrollment.sftpPath || '/upload/');
    await sftp.end();
    return {
      ok: true,
      fileCount: list.length,
      samples: list.slice(0, 5).map((f: SftpRemoteEntry) => f.name),
    };
  } catch (err) {
    try { await sftp.end(); } catch { /* noop */ }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export interface VerifyLocalFileResult {
  ok: boolean;
  size?: number;
  error?: string;
}

/**
 * Verify a local file exists + is readable. Used by generator before
 * starting the upload to catch fs issues early.
 */
export function verifyLocalFile(localFilePath: string): VerifyLocalFileResult {
  try {
    const st = fs.statSync(localFilePath);
    return { ok: true, size: st.size };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
