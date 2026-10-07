/**
 * Backfill latest.json for channels published before the per-platform index
 * existed.
 *
 * Mirrors the attribution publish-game.mjs performs, so the result is what the
 * next publish would have written. Reads the channel-root manifest because it is
 * the one object that states a channel's current version, and it exists for every
 * channel whether old or new.
 *
 *   node scripts/backfill-latest.mjs --game-id example-game --channel alpha
 *
 * Dry run unless --confirm is passed, like every other publish verb: this writes
 * to the bucket.
 */
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { NO_CACHE, S3, fail, repoRoot, upload, r2Config } from './lib/r2.mjs';
import { parseArgs } from './lib/args.mjs';
import { catalogGameId } from './lib/catalog-edit.mjs';
import { CHANNELS } from './lib/metadata-fields.mjs';

const args = parseArgs(process.argv.slice(2));

const gameIdArg = args['game-id'];
const channel = args.channel ?? 'stable';
if (!gameIdArg) fail('--game-id is required.');

// Same validator the other publish scripts use: the id and channel become a
// bucket path segment, and this one overwrites latest.json under it.
const gameIdCheck = catalogGameId(gameIdArg);
if (!gameIdCheck.ok) fail(`--game-id: ${gameIdCheck.error}`);
if (!CHANNELS.includes(channel)) {
  fail(`--channel must be one of ${CHANNELS.join(', ')} (got "${channel}").`);
}
const gameId = gameIdCheck.id;

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
  console.log('\nDry run. Nothing was uploaded.');
  process.exit(0);
}

// --dry-run is honoured above so a stale copy of the old invocation still lands
// on the safe path. The default is already dry, so the flag only matters as
// proof the operator meant it.
if (!Boolean(args.confirm)) {
  console.log('\nDry run. Nothing was uploaded.');
  console.log(`Re-run with --confirm to write ${prefix}/latest.json`);
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
