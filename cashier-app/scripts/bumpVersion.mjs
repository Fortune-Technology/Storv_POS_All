#!/usr/bin/env node
/**
 * bumpVersion.mjs — auto-bump cashier-app patch version before electron-builder.
 *
 * Why this exists
 * ---------------
 * package.json on main stays at the human-readable "marketing version"
 * (1.0.0 today). Every actual build needs a strictly-greater patch number
 * so:
 *   1. Each .exe in dist-electron/ has a distinct filename — no silently
 *      overwriting prior builds, easy to tell builds apart on disk
 *   2. electron-updater's semver compare sees every new build as an update
 *      (clients running 1.0.5 will detect 1.0.6, etc.). If the version
 *      never changed, installed apps would never auto-update.
 *
 * Strategy per environment
 * ------------------------
 *   CI (GITHUB_RUN_NUMBER set):
 *     patch = github.run_number          → strictly monotonic across runs
 *
 *   Local (no GITHUB_RUN_NUMBER):
 *     patch = parseInt(MMDDHHmm)         → strictly monotonic for a given
 *     month (all values fit in 32-bit int, max ~12_312_359). Resets each
 *     month, but never decreases within a month — fine for local dev where
 *     you're not stress-testing the auto-updater.
 *
 * The bumped version is written back to package.json. We do NOT auto-revert
 * after the build because:
 *   - On CI, the workflow checkout is ephemeral — nothing to revert
 *   - Locally, you want to be able to ship the .exe you just built; if
 *     package.json still said 1.0.0 the auto-updater manifest (latest.yml)
 *     would record the wrong version
 * Just don't `git add` package.json after running this — it's a build
 * artifact, not a source change.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const [major, minor] = pkg.version.split('.');

let patch;
let source;
if (process.env.GITHUB_RUN_NUMBER) {
  patch = process.env.GITHUB_RUN_NUMBER;
  source = `GITHUB_RUN_NUMBER=${patch}`;
} else {
  // MMDDHHmm — e.g. 05041430 = May 4, 14:30. Strictly increases minute by
  // minute within a month. Fits in 32-bit int. Drops leading zero (Jan
  // 01 00:00 → 1010000) to avoid being misread as octal anywhere.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  patch = parseInt(
    `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`,
    10,
  );
  source = `local timestamp (${patch})`;
}

const newVersion = `${major}.${minor}.${patch}`;
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`[bumpVersion] cashier-app version → ${newVersion}  [source: ${source}]`);
