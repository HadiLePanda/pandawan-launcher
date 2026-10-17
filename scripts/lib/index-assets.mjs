/**
 * Files on disk -> the `{ name, sha256 }` entries the download index takes.
 *
 * Kept apart from `downloads-index.mjs`, which is pure, so the grouping rules can
 * be tested without touching the filesystem.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function sha256OfFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** One entry per named file, hashed from `dir`. */
export function indexEntries(dir, names) {
  return names.map((name) => ({ name, sha256: sha256OfFile(path.join(dir, name)) }));
}

/** One entry per regular file in `dir`. Directories are not downloads. */
export function indexEntriesIn(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, sha256: sha256OfFile(path.join(dir, entry.name)) }));
}
