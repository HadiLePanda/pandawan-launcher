#!/usr/bin/env node
/**
 * Merge a freshly built latest.json into the one already on the bucket, so a
 * build that covers only some platforms never drops the others.
 *
 *   node scripts/merge-latest.mjs bundles/latest.json --from-config src-tauri/tauri.conf.json
 *
 * The incoming file is rewritten in place. The public base and the URL of the
 * existing manifest are both derived from tauri.conf.json's single updater
 * endpoint, so the merge can never look at a different host than the launcher
 * polls. A missing existing manifest (nothing published yet) leaves the incoming
 * file untouched.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { mergeLatest } from './lib/latest-merge.mjs';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function baseFromConfig(configPath) {
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const endpoints = config?.plugins?.updater?.endpoints;
  if (!Array.isArray(endpoints) || endpoints.length !== 1) {
    fail(`${configPath} must have exactly one plugins.updater.endpoints entry.`);
  }
  const url = endpoints[0].split(/[?#]/)[0];
  const lastSlash = url.lastIndexOf('/');
  if (lastSlash === -1) fail(`Updater endpoint has no directory: ${endpoints[0]}`);
  return url.slice(0, lastSlash);
}

const argv = process.argv.slice(2);
const configIndex = argv.indexOf('--from-config');
const configPath = configIndex !== -1 ? argv[configIndex + 1] : 'src-tauri/tauri.conf.json';
const positionals = argv.filter((arg, index) => !arg.startsWith('--') && index !== configIndex + 1);
const incomingPath = positionals[0];

if (!incomingPath) {
  fail('usage: node scripts/merge-latest.mjs <latest.json> [--from-config <tauri.conf.json>]');
}

const incoming = JSON.parse(readFileSync(incomingPath, 'utf-8'));
const base = baseFromConfig(configPath);
const existingUrl = `${base}/latest.json`;

let existing = null;
try {
  const res = await fetch(existingUrl, { cache: 'no-store' });
  if (res.ok) existing = await res.json();
  else if (res.status !== 404) {
    // Any failure other than "nothing published" must not be read as an empty
    // bucket: merging into null would overwrite a live manifest.
    fail(`Could not read ${existingUrl} (HTTP ${res.status}). Refusing to overwrite.`);
  }
} catch (err) {
  fail(`Could not read ${existingUrl}: ${err?.message ?? err}. Refusing to overwrite.`);
}

const merged = mergeLatest(existing, incoming);
const incomingTargets = Object.keys(incoming.platforms);
const kept = Object.keys(merged.platforms).filter((target) => !incomingTargets.includes(target));

writeFileSync(incomingPath, `${JSON.stringify(merged, null, 2)}\n`);

if (!existing) {
  console.log(`No published manifest at ${existingUrl}; wrote ${incomingTargets.length} platform(s).`);
} else if (existing.version !== incoming.version) {
  console.log(
    `Published manifest is ${existing.version}, this build is ${incoming.version}: ` +
      `wrote this build alone (${incomingTargets.length} platform(s)).`
  );
} else {
  console.log(
    `Merged. This build: ${incomingTargets.join(', ')}. ` +
      `Kept from the bucket: ${kept.length ? kept.join(', ') : '(none)'}.`
  );
}
