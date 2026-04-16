/**
 * Database Backup Controller
 *
 * Streams a pg_dump of the requested database directly to the client.
 * No temp files are written — the dump is piped to the HTTP response.
 *
 * Security: only superadmin (enforced by router-level middleware).
 */

import { spawn, execSync } from 'child_process';
import { URL }    from 'url';
import fs         from 'fs';
import path       from 'path';

/* ── helpers ────────────────────────────────────────────────── */

/**
 * Resolve the pg_dump binary path.
 * Checks: env override → PATH → common install directories (Windows + Linux).
 */
function findPgDump() {
  /* 1. explicit env override */
  if (process.env.PG_DUMP_PATH) {
    if (fs.existsSync(process.env.PG_DUMP_PATH)) return process.env.PG_DUMP_PATH;
  }

  /* 2. already on PATH? */
  try {
    const cmd = process.platform === 'win32' ? 'where pg_dump' : 'which pg_dump';
    const result = execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim();
    if (result) return result.split(/\r?\n/)[0];
  } catch { /* not on PATH */ }

  /* 3. probe common install directories */
  const candidates = process.platform === 'win32'
    ? (() => {
        const dirs = [];
        const base = 'C:\\Program Files\\PostgreSQL';
        try {
          const versions = fs.readdirSync(base).sort((a, b) => Number(b) - Number(a));
          for (const v of versions) dirs.push(path.join(base, v, 'bin', 'pg_dump.exe'));
        } catch { /* dir doesn't exist */ }
        return dirs;
      })()
    : ['/usr/bin/pg_dump', '/usr/local/bin/pg_dump', '/usr/lib/postgresql/16/bin/pg_dump',
       '/usr/lib/postgresql/15/bin/pg_dump', '/usr/lib/postgresql/14/bin/pg_dump'];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

/**
 * Parse a PostgreSQL connection string into the parts pg_dump needs.
 * Handles: postgresql://user:pass@host:port/dbname?schema=public
 */
function parseDSN(dsn) {
  const u = new URL(dsn);
  return {
    host:     u.hostname,
    port:     u.port || '5432',
    user:     u.username,
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

/** dd-mm-yyyy */
function fmtDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/* ── controller ─────────────────────────────────────────────── */

/**
 * GET /api/admin/backup/:target?format=sql|dump
 *   :target = "main" | "ecom"
 *   ?format = "sql"  → plain SQL with INSERT statements (pgAdmin Query Tool / psql)
 *             "dump" → custom binary format (pgAdmin Restore / pg_restore)
 *   Default: "sql"
 */
export const downloadBackup = async (req, res, next) => {
  try {
    const { target } = req.params;
    const format = req.query.format === 'dump' ? 'dump' : 'sql';

    /* ---- resolve the DATABASE_URL for the requested DB ---- */
    let dsn;
    if (target === 'main') {
      dsn = process.env.DATABASE_URL;
    } else if (target === 'ecom') {
      dsn = process.env.ECOM_DATABASE_URL;
    }

    if (!dsn) {
      return res.status(400).json({
        error: target === 'ecom'
          ? 'ECOM_DATABASE_URL is not configured in .env'
          : 'DATABASE_URL is not configured in .env',
      });
    }

    const db = parseDSN(dsn);

    /* ---- locate pg_dump binary ---- */
    const pgDumpPath = findPgDump();
    if (!pgDumpPath) {
      return res.status(500).json({
        error: 'pg_dump not found. Install PostgreSQL or set PG_DUMP_PATH in .env',
      });
    }

    /* ---- build pg_dump args per format ---- */
    const baseArgs = [
      '-h', db.host,
      '-p', db.port,
      '-U', db.user,
      '-d', db.database,
      '--no-owner',
      '--no-acl',
    ];

    let ext, contentType, extraArgs;
    if (format === 'dump') {
      ext         = 'dump';
      contentType = 'application/octet-stream';
      extraArgs   = ['-Fc'];                       // custom binary format
    } else {
      ext         = 'sql';
      contentType = 'application/sql';
      extraArgs   = ['--inserts'];                  // INSERT statements
    }

    const filename = `${db.database}-${fmtDate()}.${ext}`;

    /* ---- set response headers for a file download ---- */
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    /* ---- spawn pg_dump ---- */
    const child = spawn(pgDumpPath, [...baseArgs, ...extraArgs], {
      env: { ...process.env, PGPASSWORD: db.password },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    /* pipe stdout straight to the HTTP response */
    child.stdout.pipe(res);

    /* collect stderr so we can report a meaningful error */
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({
          error: 'pg_dump is not installed or not on PATH',
          detail: err.message,
        });
      }
    });

    child.on('close', (code) => {
      if (code !== 0 && !res.headersSent) {
        res.status(500).json({
          error: 'pg_dump exited with an error',
          detail: stderr.slice(0, 500),
        });
      }
    });
  } catch (err) {
    next(err);
  }
};
