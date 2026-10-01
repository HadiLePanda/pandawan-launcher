#!/usr/bin/env node
/**
 * Rewrite the download URLs in a Tauri updater `latest.json` to point at a
 * different host (e.g. an R2 bucket).
 *
 * Why this is needed: `tauri-action` generates latest.json with asset URLs that
 * point at the GitHub Release. When the repo is private those URLs are not
 * publicly readable, so serving the file as-is from a bucket would 404 on every
 * download. The updater reads `platforms.<target>.url` directly, so each URL is
 * rewritten to the public bucket base while keeping the asset filename.
 *
 * Usage:
 *   node scripts/rewrite-updater-urls.mjs <latest.json> <publicBaseUrl> [out.json]
 *   node scripts/rewrite-updater-urls.mjs <latest.json> --from-config [tauri.conf.json] [out.json]
 *
 * Example:
 *   node scripts/rewrite-updater-urls.mjs latest.json https://cdn.example.com/launcher
 *
 * `--from-config` reads the base URL from plugins.updater.endpoints[0] in
 * tauri.conf.json instead of taking it as an argument. The release workflow
 * uses this so the published manifest can never drift from the endpoint the
 * launcher actually polls.
 */

import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Derive the public base directory from the committed updater endpoint.
 *
 * The endpoint is the manifest itself (e.g.
 * https://cdn.example.com/launcher/latest.json), but the URLs we rewrite are
 * per-asset (…/Pandawan Launcher_0.1.0_x64.msi). Joining the manifest URL with
 * a filename would produce …/launcher/latest.json/<file>, which is wrong, so
 * the filename is stripped and the directory is used as the base.
 */
function baseFromConfig(configPath) {
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const endpoints = config?.plugins?.updater?.endpoints;
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    throw new Error(`No plugins.updater.endpoints in ${configPath}`);
  }
  if (endpoints.length > 1) {
    throw new Error(
      `${configPath} has ${endpoints.length} updater endpoints; ` +
        'expected exactly one so the published URL is unambiguous.'
    );
  }

  const endpoint = endpoints[0];
  if (!/^https?:\/\//.test(endpoint)) {
    throw new Error(`Updater endpoint must be absolute http(s), got: ${endpoint}`);
  }

  const withoutQuery = endpoint.split(/[?#]/)[0];
  const lastSlash = withoutQuery.lastIndexOf('/');
  if (lastSlash === -1) {
    throw new Error(`Updater endpoint has no directory to derive a base from: ${endpoint}`);
  }
  return withoutQuery.slice(0, lastSlash);
}

function rewrite(jsonPath, publicBase, outPath) {
  const base = publicBase.replace(/\/+$/, '');
  const manifest = JSON.parse(readFileSync(jsonPath, 'utf-8'));

  if (!manifest.platforms || typeof manifest.platforms !== 'object') {
    throw new Error(`No "platforms" object in ${jsonPath}`);
  }

  const rewritten = {};
  for (const [target, entry] of Object.entries(manifest.platforms)) {
    if (!entry || typeof entry.url !== 'string') {
      throw new Error(`Platform "${target}" has no url to rewrite`);
    }
    // Take the filename off the original URL and re-host it. Encode the
    // filename because release assets contain spaces (e.g. "App_0.1.0_x64.msi").
    const fileName = decodeURIComponent(entry.url.split('/').pop());
    rewritten[target] = {
      ...entry,
      url: `${base}/${encodeURIComponent(fileName)}`,
    };
  }

  const output = { ...manifest, platforms: rewritten };
  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (outPath) {
    writeFileSync(outPath, json);
  } else {
    process.stdout.write(json);
  }
}

const argv = process.argv.slice(2);
const fromConfigIndex = argv.indexOf('--from-config');

let jsonPath;
let publicBase;
let outPath;

if (fromConfigIndex !== -1) {
  // Drop the flag wherever it appears, then the positionals are always:
  //   <latest.json> <tauri.conf.json> [out.json]
  // so there is nothing to infer.
  const rest = argv.filter((a) => a !== '--from-config');
  jsonPath = rest[0];
  const configPath = rest[1];
  outPath = rest[2];
  if (!configPath) {
    console.error('--from-config needs the tauri.conf.json path as its argument.');
    process.exit(1);
  }
  publicBase = baseFromConfig(configPath);
} else {
  [jsonPath, publicBase, outPath] = argv;
}

if (!jsonPath || !publicBase) {
  console.error(
    'Usage: node scripts/rewrite-updater-urls.mjs <latest.json> <publicBaseUrl> [out.json]\n' +
      '   or: node scripts/rewrite-updater-urls.mjs <latest.json> --from-config [tauri.conf.json] [out.json]'
  );
  process.exit(1);
}

if (!/^https?:\/\//.test(publicBase)) {
  console.error(`Public base URL must be absolute http(s), got: ${publicBase}`);
  process.exit(1);
}

try {
  rewrite(jsonPath, publicBase, outPath);
} catch (err) {
  console.error(`Failed to rewrite updater URLs: ${err.message}`);
  process.exit(1);
}
