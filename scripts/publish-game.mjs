#!/usr/bin/env node
/**
 * Publish a game build to R2.
 *
 *   npm run publish:game -- --game-id g --channel alpha --version 1.0.0 \
 *     --build-number 1 --executable "G.exe" --input-dir ./Builds/g
 *
 * Credentials come from .env (gitignored) or the environment.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  abortStaleMultipartUploads,
  fail,
  IMMUTABLE,
  NO_CACHE,
  repoRoot,
  r2Config,
  run,
  S3,
  uploadDir,
  uploadFiles,
  upload,
} from './lib/r2.mjs';
import { parseArgs } from './lib/args.mjs';
import { manifestFiles, planUpload } from './lib/upload-plan.mjs';

const REQUIRED = ['game-id', 'channel', 'version', 'build-number', 'executable'];

const asList = (value) => (value === undefined ? [] : [].concat(value));

const args = parseArgs(process.argv.slice(2));

for (const name of REQUIRED) {
  if (!args[name]) fail(`--${name} is required.`);
}

const gameId = args['game-id'];
const channel = args.channel;
const platformSpecs = asList(args.platform);
// --platform carries its own directory per platform, so --input-dir is only
// required for a single-platform (flat) publish.
if (!args['input-dir'] && platformSpecs.length === 0) {
  fail('--input-dir is required when no --platform is given.');
}

const inputDir = args['input-dir'] ? path.resolve(args['input-dir']) : null;
const manifestPath = path.resolve(args.output ?? path.join(repoRoot, 'dist', 'manifest.json'));

if (inputDir && !existsSync(inputDir)) {
  fail(`--input-dir does not exist: ${inputDir}`);
}

const { bucket, cdnOrigin, endpoint } = r2Config();
const prefix = `games/${gameId}/${channel}`;
const s3Prefix = S3.s3Uri(bucket, prefix);

// Build bytes go under a version-stamped directory so the IMMUTABLE cache header
// is truthful — a client's cached copy can never be stale, because the bytes at
// that URL never change. The manifest stays at .../{channel}/manifest.json: it is
// mutable and is the signal that a new build exists.
const versionPrefix = `${prefix}/${args.version}`;

console.log(`Game:     ${gameId}`);
console.log(`Channel:  ${channel}`);
console.log(`Version:  ${args.version} (build ${args['build-number']})`);
if (inputDir) console.log(`Source:   ${path.relative(repoRoot, inputDir) || '.'}`);
console.log(`Target:   ${S3.s3Uri(bucket, versionPrefix)}`);
console.log(`Manifest: ${S3.s3Uri(bucket, `${prefix}/manifest.json`)}`);

const manifestArgs = [
  'scripts/generate-manifest.py',
  '--game-id',
  gameId,
  '--name',
  args.name || gameId,
  '--version',
  args.version,
  '--build-number',
  args['build-number'],
  '--executable',
  args.executable,
  '--cdn-origin',
  cdnOrigin,
  '--channel',
  channel,
  '--output',
  manifestPath,
];

for (const optional of ['description', 'patch-notes', 'icon-url', 'banner-url']) {
  if (args[optional]) manifestArgs.push(`--${optional}`, args[optional]);
}

for (const spec of asList(args.platform)) {
  manifestArgs.push('--platform', spec);
}

// Extra exclude patterns from the caller. The backup folder, Unity's build report
// and the zip beside a Mac export are already excluded by the generator's
// defaults.
for (const pattern of asList(args.exclude)) {
  manifestArgs.push('--exclude', pattern);
}

run('python', manifestArgs, 'Generating manifest');

const localManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// What this version already has, read rather than listed. The manifest is
// uploaded last, so a version it describes is a version whose files are all
// there - and a 404 only means nothing has been published yet.
let publishedManifest = null;
try {
  const res = await fetch(`${cdnOrigin}/${versionPrefix}/manifest.json`);
  if (res.ok) publishedManifest = await res.json();
  else if (res.status !== 404) {
    fail(
      `could not read ${versionPrefix}/manifest.json (HTTP ${res.status}); refusing to guess which files are already published.`
    );
  }
} catch (err) {
  fail(
    `could not read ${versionPrefix}/manifest.json (${err.message}); refusing to guess which files are already published.`
  );
}

// Files first, manifest last: the manifest is what tells a client a build
// exists, so publishing it first would let someone resolve a manifest whose
// files are not there yet.
// Clear any half-finished upload from a previous interrupted run first; those
// parts are billed and are not visible to s3 ls.
abortStaleMultipartUploads(`${prefix}/`, { endpoint, bucket });
for (const spec of platformSpecs) {
  const separator = spec.indexOf('=');
  const platform = spec.slice(0, separator).trim().toLowerCase();
  const dir = path.resolve(spec.slice(separator + 1).trim());
  if (!existsSync(dir)) {
    fail(`--platform ${platform} directory does not exist: ${dir}`);
  }
  const local = manifestFiles(localManifest, platform);
  if (local.length === 0) {
    fail(
      `the generated manifest lists no files for ${platform}; refusing to publish an empty build.`
    );
  }
  const { upload: changed, skipped } = planUpload(
    local,
    manifestFiles(publishedManifest, platform)
  );
  console.log(
    `  ${platform}: ${path.relative(repoRoot, dir) || '.'} - ${changed.length} to upload, ${skipped.length} already published`
  );
  uploadFiles(dir, changed, `${S3.s3Uri(bucket, `${versionPrefix}/${platform}`)}/`, {
    endpoint,
    cacheControl: IMMUTABLE,
  });
}

if (inputDir) {
  // A flat publish has no per-platform list to compare, so the tree goes up whole.
  uploadDir(inputDir, `${S3.s3Uri(bucket, versionPrefix)}/`, {
    endpoint,
    cacheControl: IMMUTABLE,
  });
}

// The manifest also goes inside the version directory, and this is what makes
// per-platform resolution possible: a client pinned to an older version on one
// platform must be able to read that version's manifest after a newer one has
// overwritten the channel root. The copy here is immutable like everything else
// at that path, so it can be cached forever.
upload(manifestPath, S3.s3Uri(bucket, `${versionPrefix}/manifest.json`), {
  endpoint,
  cacheControl: IMMUTABLE,
  contentType: 'application/json',
});

// The channel-root copy is mutable and is the signal that a build is available,
// so it is uploaded last and never cached. Older clients read only this.
upload(manifestPath, S3.s3Uri(bucket, `${prefix}/manifest.json`), {
  endpoint,
  cacheControl: NO_CACHE,
  contentType: 'application/json',
});

// Per-platform "what is current" pointer. A channel has one immutable manifest
// per version, but platforms ship independently, so a flat manifest.json cannot
// say "windows is on 0.4.0, mac is still on 0.3.9". latest.json carries that,
// and the client reads its own platform's entry to decide which version to
// fetch.
const platformNames = asList(args.platform).map((spec) => spec.split('=')[0].trim().toLowerCase());

// A run with no --platform is a flat, pre-platform manifest. Attribute it to
// windows: that is the only platform ever published that way, and leaving it
// unattributed would make every client on mac grey out.
const attributed = platformNames.length > 0 ? platformNames : ['windows'];

let latest = {};
try {
  const res = await fetch(`${cdnOrigin}/${prefix}/latest.json`);
  if (res.ok) {
    const parsed = await res.json();
    if (parsed && typeof parsed === 'object') latest = parsed;
  } else if (res.status !== 404) {
    fail(
      `could not read ${prefix}/latest.json (HTTP ${res.status}); refusing to drop the other platforms' pins.`
    );
  }
} catch (err) {
  // Only a 404 means "nothing published yet"; a network error must not become an empty pointer.
  fail(
    `could not read ${prefix}/latest.json (${err.message}); refusing to drop the other platforms' pins.`
  );
}

for (const platform of attributed) {
  latest[platform] = { version: args.version, build: Number(args['build-number']) };
}

const latestPath = path.join(path.dirname(manifestPath), 'latest.json');
writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);

upload(latestPath, S3.s3Uri(bucket, `${prefix}/latest.json`), {
  endpoint,
  cacheControl: NO_CACHE,
  contentType: 'application/json',
});

const behind = Object.entries(latest)
  .filter(([, v]) => v.version !== args.version)
  .map(([k, v]) => `${k} ${v.version}`);

console.log(`\nPublished ${gameId} ${args.version} (${channel}) for ${attributed.join(', ')}.`);

// Platforms left behind are the entire reason latest.json exists, so say so here
// rather than letting the drift be discovered by a player on the other OS.
if (behind.length > 0) {
  console.log(`Still on an older build: ${behind.join(', ')}`);
}
console.log(`Manifest: ${cdnOrigin}/${prefix}/manifest.json`);
console.log('Remember: republish the catalog if this game is new.');
