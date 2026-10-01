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

import { existsSync } from 'node:fs';
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

const REQUIRED = ['game-id', 'channel', 'version', 'build-number', 'executable', 'input-dir'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    args[key] = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

for (const name of REQUIRED) {
  if (!args[name]) fail(`--${name} is required.`);
}

const gameId = args['game-id'];
const channel = args.channel;
const inputDir = path.resolve(args['input-dir']);
const manifestPath = path.resolve(args.output ?? path.join(repoRoot, 'dist', 'manifest.json'));

if (!existsSync(inputDir)) {
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
console.log(`Source:   ${path.relative(repoRoot, inputDir) || '.'}`);
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
  '--input-dir',
  inputDir,
  '--output',
  manifestPath,
];

for (const optional of ['description', 'patch-notes', 'icon-url', 'banner-url']) {
  if (args[optional]) manifestArgs.push(`--${optional}`, args[optional]);
}

run('python', manifestArgs, 'Generating manifest');

// Files first, manifest last: the manifest is what tells a client a build
// exists, so publishing it first would let someone resolve a manifest whose
// files are not there yet.
// Clear any half-finished upload from a previous interrupted run first; those
// parts are billed and are not visible to s3 ls.
abortStaleMultipartUploads(`${prefix}/`, { endpoint, bucket });

sync(inputDir, `${S3.s3Uri(bucket, versionPrefix)}/`, {
  endpoint,
  cacheControl: IMMUTABLE,
});

// The manifest is mutable and is the signal that a build is available, so it is
// uploaded last and never cached.
upload(manifestPath, S3.s3Uri(bucket, `${prefix}/manifest.json`), {
  endpoint,
  cacheControl: NO_CACHE,
  contentType: 'application/json',
});

console.log(`\nPublished ${gameId} ${args.version} (${channel}).`);
console.log(`Manifest: ${cdnOrigin}/${prefix}/manifest.json`);
console.log('Remember: republish the catalog if this game is new.');
