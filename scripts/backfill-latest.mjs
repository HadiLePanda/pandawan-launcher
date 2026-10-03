/**
 * Backfill latest.json for channels published before the per-platform index
 * existed.
 *
 * Mirrors the attribution publish-game.mjs performs, so the result is what the
 * next publish would have written. Reads the channel-root manifest because it is
 * the one object that states a channel's current version, and it exists for every
 * channel whether old or new.
 *
 *   node scripts/backfill-latest.mjs --game-id misspell --channel alpha
 */
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { NO_CACHE, S3, fail, loadDotEnv, repoRoot, upload, r2Config } from './lib/r2.mjs';

loadDotEnv();

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (!process.argv[i].startsWith('--')) continue;
  const key = process.argv[i].slice(2);
  args[key] =
    process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true';
}

const gameId = args['game-id'];
const channel = args.channel ?? 'stable';
if (!gameId) fail('--game-id is required.');

const { bucket, cdnOrigin, endpoint } = r2Config();
const prefix = `games/${gameId}/${channel}`;
const manifestUrl = `${cdnOrigin}/${prefix}/manifest.json`;

console.log(`Reading ${manifestUrl}`);

const response = await fetch(manifestUrl);
if (!response.ok) {
  fail(`No manifest at ${manifestUrl} (HTTP ${response.status}). Nothing to backfill.`);
}

const manifest = JSON.parse(await response.text());
const build = Number(manifest.build_number ?? 0);

// A flat manifest is a single-platform publish. Windows is the only platform ever
// published that way, and claiming otherwise would advertise a macOS build that
// does not exist.
const platforms =
  manifest.platforms && Object.keys(manifest.platforms).length > 0
    ? Object.keys(manifest.platforms)
    : ['windows'];

const latest = {};
for (const platform of platforms) {
  latest[platform] = { version: manifest.version, build };
}

console.log(`\n${JSON.stringify(latest, null, 2)}`);

if (Boolean(args['dry-run'])) {
  console.log('\n--dry-run, nothing uploaded.');
  process.exit(0);
}

const outPath = path.join(repoRoot, 'dist', 'latest.json');
writeFileSync(outPath, `${JSON.stringify(latest, null, 2)}\n`);

upload(outPath, S3.s3Uri(bucket, `${prefix}/latest.json`), {
  endpoint,
  cacheControl: NO_CACHE,
  contentType: 'application/json',
});

console.log(`\nBackfilled ${prefix}/latest.json`);
console.log(`https://${cdnOrigin.replace(/^https?:\/\//, '')}/${prefix}/latest.json`);
