#!/usr/bin/env node
/**
 * Set the launcher version, or prove the four copies agree.
 *
 *   npm run version:set -- 0.2.0
 *   npm run version:check
 *
 * package.json is the source and the other three are written from it. They are
 * separate fields in separate formats, and a mismatch ships an app whose About
 * panel and updater document both disagree with the binary.
 */

import { checkVersions, VERSION_FILES, writeVersion } from './lib/version.mjs';

const argv = process.argv.slice(2);

if (argv.includes('--check')) {
  const { ok, versions } = checkVersions();
  if (ok) {
    console.log(`version ${versions[VERSION_FILES[0]]} in all ${VERSION_FILES.length} files`);
    process.exit(0);
  }
  console.error('version mismatch:');
  for (const file of VERSION_FILES) console.error(`  ${file}: ${versions[file] ?? 'missing'}`);
  process.exit(1);
}

const next = argv.find((arg) => !arg.startsWith('-'));
if (!next) {
  console.error('usage: npm run version:set -- <version>   |   npm run version:check');
  process.exit(1);
}

try {
  const { changed } = writeVersion(next);
  if (changed.length === 0) console.log(`already at ${next}`);
  for (const { file, from } of changed) console.log(`${file}: ${from} -> ${next}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
