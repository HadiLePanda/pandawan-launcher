#!/usr/bin/env node
/**
 * Cut a launcher release: bump the version everywhere, commit, tag, push.
 *
 *   npm run release              bump the patch version (0.1.0 -> 0.1.1)
 *   npm run release -- minor     0.1.0 -> 0.2.0
 *   npm run release -- major     0.1.0 -> 1.0.0
 *   npm run release -- 0.2.0-beta.1   set an exact version (allowed by the tag pattern)
 *   npm run release -- --dry-run show what would happen, change nothing
 *
 * Pushing the tag is what triggers .github/workflows/release.yml, which builds
 * and signs the bundles and publishes them plus latest.json to R2. Nothing is
 * uploaded from this machine.
 *
 * The version lives in three files that CI requires to match, so all three are
 * written here rather than by hand.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { fail, repoRoot } from './lib/r2.mjs';

const VERSION_FILES = [
  'package.json',
  path.join('src-tauri', 'Cargo.toml'),
  path.join('src-tauri', 'tauri.conf.json'),
];

/** Matches the tag pattern that triggers the release workflow. */
const TAG_PATTERN = /^v\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;

function git(args, { capture = false } = {}) {
  const res = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (res.error) fail(`could not run git: ${res.error.message}`);
  if (res.status !== 0) {
    const detail = capture ? `\n${res.stderr || ''}` : '';
    fail(`git ${args.join(' ')} failed (exit ${res.status})${detail}`);
  }
  return capture ? res.stdout.trim() : '';
}

function currentVersion() {
  return JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')).version;
}

function bump(version, level) {
  const [major, minor, patch] = version.split('.').map((n) => parseInt(n, 10) || 0);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function writeVersion(version, { preview = false } = {}) {
  for (const file of VERSION_FILES) {
    const full = path.join(repoRoot, file);
    const original = readFileSync(full, 'utf-8');

    let updated;
    if (file.endsWith('.json')) {
      updated = original.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
    } else {
      // Cargo.toml has exactly one version field, in [package].
      updated = original.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
    }

    if (updated === original) {
      fail(`Could not find a version field to update in ${file}.`);
    }
    if (!preview) writeFileSync(full, updated);
    console.log(`  ${file} -> ${version}`);
  }
}

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const level = argv.find((a) => a === 'major' || a === 'minor' || a === 'patch');

const from = currentVersion();
const to = argv.find((a) => /^\d+\.\d+\.\d+/.test(a)) ?? bump(from, level ?? 'patch');

if (!TAG_PATTERN.test(`v${to}`)) {
  fail(`"${to}" is not a version the release tag accepts. Expected like 0.2.0 or 0.2.0-beta.1.`);
}

const branch = git(['branch', '--show-current'], { capture: true });
const dirty = git(['status', '--porcelain'], { capture: true });

if (dirty && !dryRun) {
  fail(
    'Working tree has uncommitted changes. Commit or stash them first so the\n' +
      'release commit only contains the version bump.'
  );
}

console.log(`Branch:   ${branch}`);
console.log(`Version:  ${from} -> ${to}`);
console.log(`Tag:      v${to}`);
console.log();

if (dryRun) {
  console.log('Dry run. Would write:');
  writeVersion(to, { preview: true });
  console.log();
  console.log(`Would run: git commit -am "chore: release v${to}"`);
  console.log(`Would run: git tag v${to}`);
  console.log(`Would run: git push && git push origin v${to}`);
  process.exit(0);
}

writeVersion(to);

git(['commit', '-am', `chore: release v${to}`]);
git(['tag', `v${to}`]);
git(['push']);
git(['push', 'origin', `v${to}`]);

console.log(`\nPushed tag v${to}. The release workflow will build and publish it to R2.`);
console.log('Watch it at: https://github.com/HadiLePanda/pandawan-launcher/actions');
