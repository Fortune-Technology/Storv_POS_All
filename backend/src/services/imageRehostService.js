/**
 * Image Re-hosting Service (Phase 3)
 *
 * Downloads product images from external URLs and saves them locally.
 * Updates GlobalProductImage.rehostedUrl with the local path.
 *
 * Images are stored at: backend/uploads/product-images/{strippedUpc}.{ext}
 * Served via:           GET /uploads/product-images/{strippedUpc}.{ext}
 *
 * This protects against external CDN deletions — once re-hosted,
 * the image lives on our server permanently.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';
import prisma from '../config/postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'product-images');

// Ensure directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/* ── Helpers ─────────────────────────────────────────────── */

/** Derive file extension from URL or content-type */
function getExtension(url, contentType) {
  // Try from URL path first
  const urlPath = new URL(url).pathname;
  const ext = path.extname(urlPath).toLowerCase().replace('.', '');
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(ext)) return ext;

  // Fall back to content-type
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('png'))  return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif'))  return 'gif';
  if (ct.includes('svg'))  return 'svg';
  if (ct.includes('avif')) return 'avif';

  return 'jpg'; // safe default
}

/** Download a URL to a local file. Returns { filePath, size, contentType } or null. */
function downloadImage(url, destPath, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;

    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      // Follow redirects (up to 3)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const newUrl = new URL(res.headers.location, url).toString();
        resolve(downloadImage(newUrl, destPath, timeoutMs));
        return;
      }

      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }

      const contentType = res.headers['content-type'] || '';
      if (!contentType.includes('image') && !contentType.includes('octet-stream')) {
        resolve(null);
        return;
      }

      // Size check — skip if > 10MB
      const contentLength = parseInt(res.headers['content-length'] || '0', 10);
      if (contentLength > 10 * 1024 * 1024) {
        resolve(null);
        return;
      }

      const chunks = [];
      let totalSize = 0;

      res.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize > 10 * 1024 * 1024) {
          res.destroy();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          fs.writeFileSync(destPath, buffer);
          resolve({ filePath: destPath, size: buffer.length, contentType });
        } catch {
          resolve(null);
        }
      });

      res.on('error', () => resolve(null));
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Build the public URL for a re-hosted image.
 * Uses the backend's base URL (from env or request) + static path.
 */
export function buildRehostedUrl(filename) {
  const base = process.env.BACKEND_URL || process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
  return `${base}/uploads/product-images/${filename}`;
}

/**
 * Re-host a single image by GlobalProductImage ID or strippedUpc.
 * Downloads the external URL, saves locally, updates DB.
 */
export async function rehostSingleImage(row) {
  if (!row?.imageUrl || row.rehostedUrl) return { status: 'skipped', reason: 'already re-hosted or no URL' };

  try {
    const ext = getExtension(row.imageUrl, null);
    const filename = `${row.strippedUpc}.${ext}`;
    const destPath = path.join(UPLOAD_DIR, filename);

    // Skip if file already exists on disk
    if (fs.existsSync(destPath)) {
      const rehostedUrl = buildRehostedUrl(filename);
      await prisma.globalProductImage.update({
        where: { id: row.id },
        data: { rehostedUrl },
      });
      return { status: 'exists', filename };
    }

    const result = await downloadImage(row.imageUrl, destPath);
    if (!result) {
      return { status: 'failed', reason: 'download failed', url: row.imageUrl };
    }

    // Update actual extension based on content-type
    const actualExt = getExtension(row.imageUrl, result.contentType);
    let finalFilename = filename;
    if (actualExt !== ext) {
      finalFilename = `${row.strippedUpc}.${actualExt}`;
      const newPath = path.join(UPLOAD_DIR, finalFilename);
      fs.renameSync(destPath, newPath);
    }

    const rehostedUrl = buildRehostedUrl(finalFilename);
    await prisma.globalProductImage.update({
      where: { id: row.id },
      data: { rehostedUrl },
    });

    return { status: 'ok', filename: finalFilename, size: result.size };
  } catch (err) {
    return { status: 'error', reason: err.message };
  }
}

/**
 * Process a batch of un-rehosted images.
 * @param {number} batchSize — how many to process in one run (default 100)
 * @returns {{ processed, succeeded, failed, skipped }}
 */
export async function rehostBatch(batchSize = 100) {
  const rows = await prisma.globalProductImage.findMany({
    where: { rehostedUrl: null, imageUrl: { not: '' } },
    take: batchSize,
    orderBy: { createdAt: 'asc' },
  });

  if (rows.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0, done: true };
  }

  let succeeded = 0, failed = 0, skipped = 0;

  // Process sequentially (don't hammer external CDNs)
  for (const row of rows) {
    const result = await rehostSingleImage(row);
    if (result.status === 'ok' || result.status === 'exists') succeeded++;
    else if (result.status === 'skipped') skipped++;
    else failed++;

    // Small delay between downloads (50ms) to be polite
    await new Promise(r => setTimeout(r, 50));
  }

  // Check if there are more to process
  const remaining = await prisma.globalProductImage.count({
    where: { rehostedUrl: null, imageUrl: { not: '' } },
  });

  return {
    processed: rows.length,
    succeeded,
    failed,
    skipped,
    remaining,
    done: remaining === 0,
  };
}

/**
 * Get re-hosting status / stats.
 */
export async function getRehostStatus() {
  const [total, rehosted, pending, failed] = await Promise.all([
    prisma.globalProductImage.count(),
    prisma.globalProductImage.count({ where: { rehostedUrl: { not: null } } }),
    prisma.globalProductImage.count({ where: { rehostedUrl: null, imageUrl: { not: '' } } }),
    prisma.globalProductImage.count({ where: { rehostedUrl: null, imageUrl: '' } }),
  ]);

  // Check disk usage
  let diskSizeMB = 0;
  try {
    const files = fs.readdirSync(UPLOAD_DIR);
    for (const f of files) {
      const stat = fs.statSync(path.join(UPLOAD_DIR, f));
      diskSizeMB += stat.size;
    }
    diskSizeMB = Math.round(diskSizeMB / 1024 / 1024 * 100) / 100;
  } catch { /* dir might not exist yet */ }

  return {
    total,
    rehosted,
    pending,
    failed,
    diskSizeMB,
    directory: UPLOAD_DIR,
  };
}
