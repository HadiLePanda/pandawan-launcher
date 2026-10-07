#!/usr/bin/env node
/**
 * Publish the launcher release to R2 from this machine.
 *
 *   npm run release:publish -- --tag v0.1.0 --confirm
 *   npm run release:publish -- --index-only --from bundles --confirm
 *
 * A dry run is the default: nothing is written to the bucket unless --confirm is
 * passed. An upload is what makes a release visible to every player, so making it
 * the deliberate option is safer than making it the default one. `--dry-run` is
 * still accepted so the command reads naturally in the terminal.
 *
 * CI (.github/workflows/release.yml) builds the macOS and Linux bundles and then
 * runs the same upload this script performs. That full run takes ~25 minutes,
 * almost all of it compiling Rust on three platforms. The upload itself is ~30
 * seconds, so when only publishing is broken - bad credentials, a botocore
 * regression, a wrong cache header - there is no reason to spend 25 minutes
 * rediscovering that. This script does the publish half on its own.
 *
 * `--index-only` does a narrower job still: it rebuilds and uploads only
 * launcher/downloads.json - the index the public website reads - from a
 * directory of already-downloaded bundles (`--from <dir>`, normally `bundles`).
 * The release workflow runs it after it has mirrored the bundles, because the
 * step that uploads them never regenerates the website index; without it the
 * offers on the download page fall a version behind on every release. It does
 * not re-upload the bundles and never touches latest.json, which the workflow
 * owns.
 *
 * It reads the already-built, already-signed assets off the draft GitHub release,
 * so it does not need macOS or Linux: this works from a plain Windows machine.
 *
 * Credentials come from the environment or .env (see scripts/lib/r2.mjs):
 *   R2_ACCOUNT_ID, R2_BUCKET, R2_CDN_ORIGIN, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 */

import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { buildDownloadsIndex } from './lib/downloads-index.mjs';
import {
  fail,
  IMMUTABLE,
  loadDotEnv,
  NO_CACHE,
  repoRoot,
  r2Config,
  S3,
  upload,
} from './lib/r2.mjs';

// `{owner}/{repo}` is a `gh api` placeholder resolved from the checkout's own
// remote, so no repository is named here and a copy of this script cannot act on
// the wrong one.
const REPO = '{owner}/{repo}';
const PREFIX = 'launcher';

const argv = process.argv.slice(2);
const tagIndex = argv.indexOf('--tag');
const tag = tagIndex !== -1 ? argv[tagIndex + 1] : null;
const dryRun = !argv.includes('--confirm') || argv.includes('--dry-run');
// Index-only mode rebuilds and uploads downloads.json alone, from a directory of
// already-downloaded bundles. CI runs it because its R2 upload step ships the
// bundles and latest.json but never regenerates the website index.
const indexOnly = argv.includes('--index-only');
const fromIndex = argv.indexOf('--from');
const fromDir = fromIndex !== -1 ? argv[fromIndex + 1] : null;

// The full publish needs a tag to fetch a release; the index-only mode works
// from a local directory and needs no tag at all.
if (!indexOnly && (!tag || !/^v\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(tag))) {
  fail('--tag is required, like --tag v0.1.0');
}

const staging = indexOnly ? null : path.join(repoRoot, '.publish', tag);

// The updater manifest plus every artifact and signature a latest.json can point
// at. A release whose latest.json references a missing file is worse than no
// release at all: the launcher finds an update, downloads it, and fails.
const WANTED = [
  /^latest\.json$/,
  /\.msi$/,
  /\.msi\.sig$/,
  /-setup\.exe$/,
  /-setup\.exe\.sig$/,
  /\.dmg$/,
  /\.app\.tar\.gz$/,
  /\.app\.tar\.gz\.sig$/,
  /\.deb$/,
  /\.deb\.sig$/,
  /\.rpm$/,
  /\.rpm\.sig$/,
];

function gh(args, { capture = false } = {}) {
  const res = spawnSync('gh', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    shell: false,
  });
  if (res.error) fail(`could not run gh: ${res.error.message}`);
  if (res.status !== 0) fail(`gh ${args.join(' ')} failed (exit ${res.status})`);
  return capture ? res.stdout : '';
}

/**
 * Pull the signed assets off the draft release.
 *
 * `gh release download` cannot see drafts, and this project deliberately keeps
 * releases in draft so the private GitHub asset URLs never leak into a published
 * latest.json. So the assets are fetched through the API instead - the same
 * approach the workflow uses.
 */
function fetchAssets() {
  const releases = JSON.parse(
    gh(['api', `repos/${REPO}/releases`, '--paginate'], { capture: true })
  );
  const release = releases.find((r) => r.tag_name === tag);
  if (!release) {
    fail(
      `No GitHub release found for ${tag}.\n` +
        '  The tag must be pushed and the release workflow must have run first.'
    );
  }

  console.log(`\nRelease: ${release.name} (id: ${release.id})`);
  mkdirSync(staging, { recursive: true });

  for (const asset of release.assets) {
    if (!WANTED.some((pattern) => pattern.test(asset.name))) continue;
    const dest = path.join(staging, asset.name);
    if (existsSync(dest)) continue;

    const fd = openSync(dest, 'w');
    const res = spawnSync(
      'gh',
      [
        'api',
        '-H',
        'Accept: application/octet-stream',
        `repos/${REPO}/releases/assets/${asset.id}`,
      ],
      { cwd: repoRoot, stdio: ['ignore', fd, 'inherit'], shell: false }
    );
    closeSync(fd);
    if (res.status !== 0) fail(`could not download ${asset.name}`);
    console.log(`  fetched ${asset.name}`);
  }

  return release;
}

/**
 * The public directory the downloads live under, derived from the committed
 * updater endpoint (which points at the manifest itself). Strip the filename so
 * joining it with an artifact name yields a per-asset URL, not
 * `.../launcher/latest.json/<file>`.
 */
function publicBase() {
  const config = JSON.parse(
    readFileSync(path.join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf-8')
  );
  const endpoints = config?.plugins?.updater?.endpoints;
  if (!Array.isArray(endpoints) || endpoints.length !== 1) {
    fail('Expected exactly one plugins.updater.endpoints entry in tauri.conf.json.');
  }
  return endpoints[0].split(/[?#]/)[0].replace(/\/[^/]*$/, '');
}

/**
 * Point latest.json at the public bucket.
 *
 * tauri-action writes two different URL shapes, and both have to be handled:
 *
 *  - `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>`
 *  - `https://api.github.com/repos/<owner>/<repo>/releases/assets/<id>`
 *
 * The second form appears for macOS, where one universal archive backs several
 * targets. Taking the last path segment of that URL yields the asset *id*, not a
 * filename, so a naive rewrite publishes a URL that 404s for every macOS player.
 * The id is resolved back to its filename through the release API instead.
 *
 * Either way the result is not publicly readable (releases are drafts), which is
 * why the URL has to be re-hosted onto the bucket at all.
 */
function rewriteManifestUrls(release) {
  const src = path.join(staging, 'latest.json');
  if (!existsSync(src)) fail(`latest.json missing from the ${tag} release.`);

  const base = publicBase();

  const byId = new Map(release.assets.map((asset) => [String(asset.id), asset.name]));
  const manifest = JSON.parse(readFileSync(src, 'utf-8'));
  if (!manifest.platforms) fail('latest.json has no "platforms" object.');

  const missing = [];
  for (const [target, entry] of Object.entries(manifest.platforms)) {
    const last = decodeURIComponent(entry.url.split('/').pop());
    const fileName = /^\d+$/.test(last) ? byId.get(last) : last;

    if (!fileName) {
      missing.push(`${target} -> ${entry.url}`);
      continue;
    }
    entry.url = `${base}/${encodeURIComponent(fileName)}`;
    if (!existsSync(path.join(staging, fileName))) missing.push(`${target} -> ${fileName}`);
  }

  if (missing.length) {
    fail(
      `latest.json references files that are not on the release:\n  ${missing.join('\n  ')}\n` +
        '  Publishing it would leave players with an update that cannot download.'
    );
  }

  writeFileSync(src, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nRewrote ${Object.keys(manifest.platforms).length} platform URL(s) to ${base}`);
  return manifest;
}

/**
 * Bucket and endpoint for an upload.
 *
 * CI exports the AWS_* variables the CLI reads (endpoint, bucket, credentials);
 * a local run supplies the R2_* names through .env. Accept either shape so the
 * same command works in both. Unlike r2Config this does not require
 * R2_CDN_ORIGIN, which only exists to print a URL.
 */
function r2Target() {
  loadDotEnv();
  const bucket = process.env.R2_BUCKET;
  const endpoint =
    process.env.AWS_ENDPOINT_URL ||
    (process.env.R2_ACCOUNT_ID
      ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : null);
  if (!bucket) fail('R2_BUCKET is not set.');
  if (!endpoint) fail('AWS_ENDPOINT_URL or R2_ACCOUNT_ID must be set.');
  if (!process.env.AWS_ACCESS_KEY_ID && process.env.R2_ACCESS_KEY_ID) {
    process.env.AWS_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
    process.env.AWS_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
  }
  return { bucket, endpoint };
}

/**
 * Rebuild and upload the website index, and nothing else.
 *
 * The bundles and latest.json are already in the bucket - CI's recursive upload
 * put them there - and this deliberately touches neither. The version comes from
 * the latest.json in the source directory, which the workflow has just
 * published, so the index can never describe a release other than the one on
 * offer.
 */
function publishIndexOnly() {
  if (!fromDir) fail('--index-only needs --from <dir>, like --from bundles');

  const manifestPath = path.join(fromDir, 'latest.json');
  if (!existsSync(manifestPath)) fail(`No latest.json in ${fromDir}.`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  if (!manifest.version) fail(`${manifestPath} has no "version".`);

  const downloads = buildDownloadsIndex({
    version: manifest.version,
    // Every file present is a candidate; the builder drops the signatures,
    // latest.json and the CI-only asset map, none of which is a download.
    files: readdirSync(fromDir),
    base: publicBase(),
  });

  if (dryRun) {
    console.log(`\nIndex-only dry run from ${fromDir} (version ${manifest.version}).`);
    console.log(`Would upload ${PREFIX}/downloads.json (no-cache):`);
    for (const [platform, items] of Object.entries(downloads.platforms)) {
      console.log(`  ${platform}: ${items.map((i) => i.label).join(', ') || 'none'}`);
    }
    process.exit(0);
  }

  const { bucket, endpoint } = r2Target();
  const indexPath = path.join(fromDir, 'downloads.json');
  writeFileSync(indexPath, `${JSON.stringify(downloads, null, 2)}\n`);
  upload(indexPath, S3.s3Uri(bucket, `${PREFIX}/downloads.json`), {
    endpoint,
    cacheControl: NO_CACHE,
    contentType: 'application/json',
  });
  console.log(`\nRefreshed ${PREFIX}/downloads.json (version ${manifest.version}).`);
}

if (indexOnly) {
  publishIndexOnly();
  process.exit(0);
}

const { bucket, endpoint } = r2Config();

console.log(`Tag:   ${tag}`);
console.log(`R2:    s3://${bucket}/${PREFIX}/`);

const release = fetchAssets();
const manifest = rewriteManifestUrls(release);
const base = JSON.parse(readFileSync(path.join(staging, 'latest.json'), 'utf-8'))
  .platforms[Object.keys(manifest.platforms)[0]].url.split('/')
  .slice(0, -1)
  .join('/');
const downloads = buildDownloadsIndex({
  version: JSON.parse(readFileSync(path.join(staging, 'latest.json'), 'utf-8')).version,
  // Only the files the publisher actually staged: a name listed on the release
  // whose bytes never made it here would produce a link that 404s.
  files: release.assets
    .map((asset) => asset.name)
    .filter((name) => existsSync(path.join(staging, name))),
  base,
});

if (dryRun) {
  console.log('\nDry run. Would upload:');
  for (const target of Object.keys(manifest.platforms)) console.log(`  ${target}`);
  console.log('\n  latest.json (no-cache) + every .sig (immutable)');
  console.log('\n  downloads.json — what the website offers:');
  for (const [platform, items] of Object.entries(downloads.platforms)) {
    console.log(`    ${platform}: ${items.map((i) => i.label).join(', ') || 'none'}`);
  }
  process.exit(0);
}

// latest.json is uploaded last: it is the file the launcher polls, so it must
// never point at an artifact that has not landed yet. Publishing it first would
// advertise an update whose download 404s for as long as the bundles take.
for (const name of readdirSync(staging)) {
  if (name === 'latest.json') continue;
  upload(path.join(staging, name), S3.s3Uri(bucket, `${PREFIX}/${name}`), {
    endpoint,
    cacheControl: IMMUTABLE,
  });
}

upload(path.join(staging, 'latest.json'), S3.s3Uri(bucket, `${PREFIX}/latest.json`), {
  endpoint,
  cacheControl: NO_CACHE,
  contentType: 'application/json',
});

// The website reads this one, not latest.json: it lists what a person should
// click, including the macOS .dmg that the updater manifest omits.
const indexPath = path.join(staging, 'downloads.json');
writeFileSync(indexPath, `${JSON.stringify(downloads, null, 2)}\n`);
upload(indexPath, S3.s3Uri(bucket, `${PREFIX}/downloads.json`), {
  endpoint,
  cacheControl: NO_CACHE,
  contentType: 'application/json',
});

console.log(`\nPublished ${tag} to s3://${bucket}/${PREFIX}/`);
console.log(`Manifest: ${process.env.R2_CDN_ORIGIN ?? ''}/${PREFIX}/latest.json`);

// The staged copy is a throwaway working directory holding every installer.
// Leaving it would put ~50 MB of binaries in the working tree.
if (!argv.includes('--keep')) rmSync(staging, { recursive: true, force: true });
