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

export function run(command, args, label) {
  console.log(`\n→ ${label}`);
  const res = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (res.error) fail(`could not run ${command}: ${res.error.message}`);
  if (res.status !== 0) fail(`${label} failed (exit ${res.status})`);
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
export function upload(source, key, { endpoint, cacheControl, contentType } = {}) {
  const args = ['s3', 'cp', source, key, '--endpoint-url', endpoint, '--no-progress'];
  if (cacheControl) args.push('--cache-control', cacheControl);
  if (contentType) args.push('--content-type', contentType);
  run('aws', args, `Uploading ${path.basename(source)} -> ${key}`);
}

export function sync(sourceDir, keyPrefix, { endpoint, cacheControl, exclude } = {}) {
  const args = ['s3', 'sync', sourceDir, keyPrefix, '--endpoint-url', endpoint, '--no-progress'];
  if (cacheControl) args.push('--cache-control', cacheControl);
  for (const pattern of exclude ?? []) args.push('--exclude', pattern);
  run('aws', args, `Syncing ${path.basename(sourceDir)}/ -> ${keyPrefix}/`);
}

export const NO_CACHE = 'no-cache, no-store, must-revalidate';
export const IMMUTABLE = 'public, max-age=31536000, immutable';

export const S3 = {
  s3Uri: (bucket, key) => `s3://${bucket}/${key}`,
};
