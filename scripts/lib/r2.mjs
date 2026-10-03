import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Minimal .env reader: KEY=VALUE lines, `#` comments, optional surrounding
 * quotes. A value already set in the real environment wins, so CI can inject
 * secrets through the environment instead of a file.
 */
export function loadDotEnv(file = path.join(repoRoot, '.env')) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip a single layer of surrounding quotes, if present.
    if (value.length > 1 && /^("|').*\1$/.test(value)) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function fail(message) {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

export function requireEnv(name, hint) {
  const value = process.env[name];
  if (!value) fail(`${name} is not set.\n  ${hint}`);
  return value;
}

/** `throwOnFailure` lets the in-process dashboard caller report the error instead of exiting. */
export function run(command, args, label, { throwOnFailure = false } = {}) {
  console.log(`\n→ ${label}`);
  const res = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (res.error) {
    const message = `could not run ${command}: ${res.error.message}`;
    if (throwOnFailure) throw new Error(message);
    fail(message);
  }
  if (res.status !== 0) {
    const message = `${label} failed (exit ${res.status})`;
    if (throwOnFailure) throw new Error(message);
    fail(message);
  }
}

/**
 * Resolve R2 connection details from the environment. Reads .env first so a
 * local run needs no exported variables.
 */
export function r2Config() {
  loadDotEnv();

  const accountId = requireEnv('R2_ACCOUNT_ID', 'Cloudflare dashboard -> R2 -> Account ID');
  const bucket = requireEnv(
    'R2_BUCKET',
    'the bucket name from the R2 dashboard (not the r2.dev subdomain)'
  );
  const cdnOrigin = (process.env.R2_CDN_ORIGIN || process.env.VITE_CDN_ORIGIN || '').replace(
    /\/+$/,
    ''
  );
  if (!cdnOrigin) {
    fail('R2_CDN_ORIGIN is not set.\n  The public base URL players download from.');
  }

  // aws reads credentials from the environment; these are not VITE_ prefixed,
  // so they are never inlined into the frontend bundle.
  process.env.AWS_ACCESS_KEY_ID = requireEnv('R2_ACCESS_KEY_ID', 'R2 -> Manage R2 tokens');
  process.env.AWS_SECRET_ACCESS_KEY = requireEnv('R2_SECRET_ACCESS_KEY', 'R2 -> Manage R2 tokens');
  process.env.AWS_DEFAULT_REGION = 'auto';

  return {
    accountId,
    bucket,
    cdnOrigin,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  };
}

/**
 * Upload a file or folder to R2.
 *
 * Immutable, long-lived caching is the default because published object names
 * contain a version. Mutable indices (catalog, manifest) must pass
 * `cacheControl: NO_CACHE` or clients keep reading a stale copy.
 */
export function upload(source, key, { endpoint, cacheControl, contentType, throwOnFailure } = {}) {
  const args = ['s3', 'cp', source, key, '--endpoint-url', endpoint, '--no-progress'];
  if (cacheControl) args.push('--cache-control', cacheControl);
  if (contentType) args.push('--content-type', contentType);
  run('aws', args, `Uploading ${path.basename(source)} -> ${key}`, { throwOnFailure });
}

export function sync(sourceDir, keyPrefix, { endpoint, cacheControl } = {}) {
  const args = ['s3', 'sync', sourceDir, keyPrefix, '--endpoint-url', endpoint, '--no-progress'];
  if (cacheControl) args.push('--cache-control', cacheControl);
  run('aws', args, `Syncing ${path.basename(sourceDir)}/ -> ${keyPrefix}/`);
}

export const NO_CACHE = 'no-cache, no-store, must-revalidate';
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * List every object under a prefix, with the date and size `aws s3 ls` printed.
 *
 * `--only-show-keys` and `--encoding` are rejected by this AWS CLI build, so the
 * default "<date> <time> <size> <key>" listing is parsed instead. isMangledKey
 * flags a key the CLI could not encode to the console codepage, so a caller can
 * delete its parent prefix rather than guess at the name.
 */
export function listKeysWithMeta(keyPrefix, { endpoint } = {}) {
  const args = ['s3', 'ls', keyPrefix, '--recursive', '--endpoint-url', endpoint];
  const res = spawnSync('aws', args, { shell: false });
  if (res.error) fail(`could not run aws: ${res.error.message}`);
  if (res.status !== 0) fail(`listing ${keyPrefix} failed (exit ${res.status})`);
  const stdout = res.stdout ? res.stdout.toString('utf8') : '';
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Columns are matched rather than split on whitespace: keys may contain spaces.
      const match = line.match(/^(\S+\s+\S+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      const stamped = new Date(match[1].replace(' ', 'T') + 'Z');
      return {
        key: match[3],
        size: Number(match[2]),
        lastModified: Number.isNaN(stamped.getTime()) ? null : stamped.toISOString(),
      };
    })
    .filter((entry) => entry !== null);
}

/**
 * True when a key contains U+FFFD, meaning the CLI lost bytes while encoding
 * the key for output. Deleting such a key literally would fail, and guessing at
 * the original characters would risk hitting a different object.
 */
export function isMangledKey(key) {
  return key.includes('\uFFFD');
}

/**
 * Abort incomplete multipart uploads under a key prefix. An interrupted publish
 * leaves parts R2 bills for but that no object exists for, so they are invisible
 * to `s3 ls` and to prune.
 */
export function abortStaleMultipartUploads(keyPrefix, { endpoint, bucket } = {}) {
  const res = spawnSync(
    'aws',
    ['s3api', 'list-multipart-uploads', '--bucket', bucket, '--endpoint-url', endpoint],
    { encoding: 'utf8', shell: false }
  );
  if (res.error || res.status !== 0) {
    // Not being able to list uploads is not a reason to fail a publish.
    return 0;
  }

  let uploads = [];
  try {
    uploads = JSON.parse(res.stdout).Uploads ?? [];
  } catch {
    return 0;
  }

  // Only uploads under this game's own prefix. Never sweep the whole bucket:
  // a concurrent publish for another game would be killed.
  const relevant = uploads.filter((u) => u.Key && u.Key.startsWith(keyPrefix));
  if (relevant.length === 0) return 0;

  console.log(`\n→ Aborting ${relevant.length} incomplete upload(s) from an earlier run:`);
  for (const upload of relevant) {
    console.log(`   ${upload.Key}`);
    spawnSync(
      'aws',
      [
        's3api',
        'abort-multipart-upload',
        '--bucket',
        bucket,
        '--key',
        upload.Key,
        '--upload-id',
        upload.UploadId,
        '--endpoint-url',
        endpoint,
      ],
      { stdio: 'inherit', shell: false }
    );
  }
  return relevant.length;
}

/**
 * Delete every object under a prefix. Used only by prune, and only after the
 * operator confirms, so it deliberately has no dry-run default.
 */
export function deletePrefix(keyPrefix, { endpoint } = {}) {
  run(
    'aws',
    ['s3', 'rm', keyPrefix, '--recursive', '--endpoint-url', endpoint],
    `Deleting ${keyPrefix}`
  );
}

export const S3 = {
  s3Uri: (bucket, key) => `s3://${bucket}/${key}`,
};
