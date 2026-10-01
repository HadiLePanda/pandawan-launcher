#!/usr/bin/env node
/**
 * Publish a game build to R2.
 *
 * Files go up first and the manifest last: the manifest is what tells a client
 * a build exists, so publishing it first would let someone resolve a manifest
 * whose files are not there yet.
 *
 *   npm run publish:game -- --game-id g --channel alpha --version 1.0.0 \
 *     --build-number 1 --executable "G.exe" --input-dir ./Builds/g
 *
 * Credentials come from .env (gitignored) or the environment.
 */

import { existsSync, writeFileSync } from 'node:fs';
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
  sync,
  upload,
} from './lib/r2.mjs';

const REQUIRED = ['game-id', 'channel', 'version', 'build-number', 'executable'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    // Repeated flags must accumulate rather than overwrite. --platform is given
    // once per platform and publishing several in one run is the normal case;
    // last-one-wins would silently ship a single platform and report success.
    if (key in args) {
      args[key] = [].concat(args[key], value);
    } else {
      args[key] = value;
    }
  }
  return args;
}

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

// Unity's Mac export sits next to a .zip of the same bundle. Uploading it would
// double the platform's size for no benefit, and unlike the backup folder it is
// not in the generator's default excludes.
for (const pattern of asList(args.exclude)) {
  manifestArgs.push('--exclude', pattern);
}

run('python', manifestArgs, 'Generating manifest');

// Files first, manifest last: the manifest is what tells a client a build
// exists, so publishing it first would let someone resolve a manifest whose
// files are not there yet.
// Clear any half-finished upload from a previous interrupted run first; those
// parts are billed and are not visible to s3 ls.
abortStaleMultipartUploads(`${prefix}/`, { endpoint, bucket });

// Per-platform builds upload into their own subdirectory of the version, so the
// two cannot overwrite each other and a client only fetches its platform's
// files. A flat publish has no subdirectory and keeps the original shape.
for (const spec of platformSpecs) {
  const separator = spec.indexOf('=');
  const platform = spec.slice(0, separator).trim().toLowerCase();
  const dir = path.resolve(spec.slice(separator + 1).trim());
  if (!existsSync(dir)) {
    fail(`--platform ${platform} directory does not exist: ${dir}`);
  }
  console.log(`  ${platform}: ${path.relative(repoRoot, dir) || '.'}`);
  sync(dir, `${S3.s3Uri(bucket, `${versionPrefix}/${platform}`)}/`, {
    endpoint,
    cacheControl: IMMUTABLE,
  });
}

if (inputDir) {
  sync(inputDir, `${S3.s3Uri(bucket, versionPrefix)}/`, {
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
  }
} catch {
  // A missing or unreadable pointer means "nothing published yet", not a
  // failure: the first publish has nothing to merge with.
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
