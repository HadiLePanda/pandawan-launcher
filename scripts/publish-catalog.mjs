#!/usr/bin/env node
/**
 * Publish the game catalog (and news feed) to R2.
 *
 * The launcher resolves games from {CDN_ORIGIN}/launcher/catalog.json, so a new
 * or changed game is invisible until this runs. It is a small mutable index, so
 * it is never cached.
 *
 *   npm run publish:catalog
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { fail, NO_CACHE, repoRoot, r2Config, S3, upload } from './lib/r2.mjs';

const { bucket, cdnOrigin, endpoint } = r2Config();

const catalogPath = path.join(repoRoot, 'public', 'catalog.json');
if (!existsSync(catalogPath)) {
  fail(`Catalog not found: ${catalogPath}`);
}

// Validate before uploading: a malformed catalog breaks every client, and the
// remote copy is harder to inspect than a local file.
const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));
if (!Array.isArray(catalog.games) || catalog.games.length === 0) {
  fail('catalog.json has no games array (or it is empty).');
}
for (const game of catalog.games) {
  if (!game || typeof game.id !== 'string' || !game.id) {
    fail('catalog.json has a game entry without a valid id.');
  }
  if (!game.channel) {
    fail(`Game "${game.id}" has no channel; the launcher needs one to build its manifest URL.`);
  }
}

upload(catalogPath, S3.s3Uri(bucket, 'launcher/catalog.json'), {
  endpoint,
  cacheControl: NO_CACHE,
  contentType: 'application/json',
});

const newsPath = path.join(repoRoot, 'public', 'news.json');
if (existsSync(newsPath) && !process.env.SKIP_NEWS) {
  upload(newsPath, S3.s3Uri(bucket, 'launcher/news.json'), {
    endpoint,
    cacheControl: NO_CACHE,
    contentType: 'application/json',
  });
}

console.log(`\nCatalog published: ${cdnOrigin}/launcher/catalog.json`);
for (const game of catalog.games) {
  console.log(`  ${game.id} (${game.channel})`);
}
