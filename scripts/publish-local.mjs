#!/usr/bin/env node
/**
 * Publish the locally built Windows launcher to R2 and fold it into latest.json.
 *
 *   npm run tauri:build              # signed NSIS bundle into src-tauri/target/release/bundle
 *   npm run release:local            # dry run: report what would upload
 *   npm run release:local -- --confirm
 *
 * Windows is built on this machine because it is faster than CI. macOS and Linux
 * come from the release workflow, which merges its platforms into the same
 * latest.json, so neither producer drops the other's. This uploads the Windows
 * bundle and updates the merged manifest; it never touches the other platforms'
 * files.
 *
 * Credentials come from .env (R2_*), the same as every other publish verb.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildDownloadsIndex, mergeDownloadsIndex } from './lib/downloads-index.mjs';
import { indexEntries } from './lib/index-assets.mjs';
import { mergeLatest } from './lib/latest-merge.mjs';
import { checkReleaseKey, signFile } from './lib/manifest-sign.mjs';
import { fetchSignedDocument } from './lib/signed-document.mjs';
import { publicKeyPath, secretKeyPath } from './lib/updater-key.mjs';
import { IMMUTABLE, NO_CACHE, S3, fail, repoRoot, r2Config, upload } from './lib/r2.mjs';

const argv = process.argv.slice(2);
const dryRun = !argv.includes('--confirm') || argv.includes('--dry-run');
const fromIndex = argv.indexOf('--from');
const fromDir = fromIndex !== -1 ? argv[fromIndex + 1] : null;
// The download index this run rewrites is signed, so the key must be present
// before the first byte lands in the bucket.
const KEY_PATH = secretKeyPath(repoRoot);
const PUBLIC_KEY_PATH = publicKeyPath(repoRoot);

const version = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')).version;
const bundleDir = fromDir
  ? path.resolve(repoRoot, fromDir)
  : path.join(repoRoot, 'src-tauri', 'target', 'release', 'bundle', 'nsis');

// The installer for THIS version. A build directory can hold installers from
// earlier versions, and taking the first match would publish the wrong bytes
// under this version's name - a file the updater accepts, because it carries the
// other version's signature.
const exe = existsSync(bundleDir)
  ? readdirSync(bundleDir).find(
      (name) => name.endsWith('-setup.exe') && name.includes(`_${version}_`)
    )
  : null;
if (!exe) {
  fail(
    `No _${version}_*-setup.exe in ${bundleDir}\n` +
      '  Build it first: npm run tauri:build   (needs src-tauri/.secrets/updater.key)'
  );
}
const sigName = `${exe}.sig`;
if (!existsSync(path.join(bundleDir, sigName))) {
  fail(`Missing ${sigName} next to ${exe}. The bundle is not updater-signed.`);
}

/** The public base directory, from the updater endpoint the launcher polls. */
function baseFromConfig() {
  const config = JSON.parse(
    readFileSync(path.join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf-8')
  );
  const endpoints = config?.plugins?.updater?.endpoints;
  if (!Array.isArray(endpoints) || endpoints.length !== 1) {
    fail('tauri.conf.json must have exactly one plugins.updater.endpoints entry.');
  }
  return endpoints[0].split(/[?#]/)[0].replace(/\/[^/]*$/, '');
}

// The published filename, so a bucket URL never carries a space and matches the
// names the CI-built website index already links from.
const base = baseFromConfig();
const publishedExe = `Pandawan.Launcher_${version}_x64-setup.exe`;
const signature = readFileSync(path.join(bundleDir, sigName), 'utf-8');
const url = `${base}/${encodeURIComponent(publishedExe)}`;

// One NSIS build feeds both Windows updater targets, exactly as a CI manifest does.
const entry = { signature, url };
const incoming = {
  version,
  notes: 'See the assets below to download and install Pandawan Launcher.',
  pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': entry, 'windows-x86_64-nsis': entry },
};

const { bucket, endpoint, cdnOrigin } = r2Config();

console.log(`Version:   ${version}`);
console.log(`Bundle:    ${path.join(bundleDir, exe)}`);
console.log(`Publishes: launcher/${publishedExe}`);
console.log('Platforms: windows-x86_64, windows-x86_64-nsis');

if (dryRun) {
  console.log('\nDry run. Would upload the bundle, its .sig, and a merged latest.json.');
  console.log('Re-run with --confirm to write to the bucket.');
  process.exit(0);
}

const key = checkReleaseKey(KEY_PATH);
if (!key.ok) fail(key.detail);

// The immutable bundle goes first, so the manifest never points at a file that
// is not there yet.
upload(path.join(bundleDir, exe), S3.s3Uri(bucket, `launcher/${publishedExe}`), {
  endpoint,
  cacheControl: IMMUTABLE,
});
upload(path.join(bundleDir, sigName), S3.s3Uri(bucket, `launcher/${publishedExe}.sig`), {
  endpoint,
  cacheControl: IMMUTABLE,
});
console.log(`Uploaded launcher/${publishedExe} and its .sig`);

// Merge with whatever the bucket advertises, so the macOS/Linux entries the CI
// build put there survive this upload.
let existing = null;
try {
  const res = await fetch(`${cdnOrigin}/launcher/latest.json`, { cache: 'no-store' });
  if (res.ok) existing = await res.json();
  else if (res.status !== 404) fail(`Could not read the published manifest (HTTP ${res.status}).`);
} catch (err) {
  fail(`Could not read the published manifest: ${err?.message ?? err}`);
}

const merged = mergeLatest(existing, incoming);
const stagingDir = path.join(repoRoot, '.publish');
mkdirSync(stagingDir, { recursive: true });
const out = path.join(stagingDir, 'launcher-latest.json');
writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);
upload(out, S3.s3Uri(bucket, 'launcher/latest.json'), {
  endpoint,
  cacheControl: NO_CACHE,
  contentType: 'application/json',
});

// Keep the public download page current. The page reads downloads.json, which
// is otherwise only rebuilt by a full release; without this a locally built
// Windows version would leave the page offering the previous one. Only the
// Windows group is replaced, so the macOS and Linux entries the CI build
// published survive.
//
// The live document is verified before it is merged: carrying an unverified
// entry into this run's signed document would launder a planted URL.
const liveRead = await fetchSignedDocument(`${base}/downloads.json`, PUBLIC_KEY_PATH);
if (liveRead.status === 'error' || liveRead.status === 'invalid') fail(liveRead.message);
if (liveRead.status === 'unsigned') {
  console.log(
    '\nWARNING: the live downloads.json has no signature. Adopting it once; the\n' +
      '         document this run uploads is signed and every later run verifies it.'
  );
}
const liveIndex =
  liveRead.status === 'signed' || liveRead.status === 'unsigned' ? JSON.parse(liveRead.text) : null;

// The hash comes from the file this run uploads, under the name its URL carries.
const [localFile] = indexEntries(bundleDir, [exe]);
const mergedIndex = mergeDownloadsIndex(
  liveIndex,
  buildDownloadsIndex({
    version,
    files: [{ name: publishedExe, sha256: localFile.sha256 }],
    base,
  })
);
const indexOut = path.join(stagingDir, 'launcher-downloads.json');
writeFileSync(indexOut, `${JSON.stringify(mergedIndex, null, 2)}\n`);
const signedIndex = signFile(indexOut, { repoRoot, keyPath: KEY_PATH });
if (!signedIndex.ok) fail(signedIndex.detail);
// Signature first, then the document it covers.
upload(`${indexOut}.sig`, S3.s3Uri(bucket, 'launcher/downloads.json.sig'), {
  endpoint,
  cacheControl: NO_CACHE,
});
upload(indexOut, S3.s3Uri(bucket, 'launcher/downloads.json'), {
  endpoint,
  cacheControl: NO_CACHE,
  contentType: 'application/json',
});

console.log(
  `\nPublished Windows ${version}. latest.json now lists: ${Object.keys(merged.platforms).join(', ')}`
);
console.log(`downloads.json platforms: ${Object.keys(mergedIndex.platforms).join(', ')}`);
