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
 * The version lives in VERSION_FILES (four files) that CI requires to match, so
 * all of them are written here rather than by hand.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { releaseChecks } from './lib/release-checks.mjs';
import { bumpVersion, repoRoot, VERSION_FILES, writeVersion } from './lib/version.mjs';

function fail(message) {
  console.error(message);
  process.exit(1);
}

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

const argv = process.argv.slice(2);
const dryRun = !argv.includes('--confirm') || argv.includes('--dry-run');
const level = argv.find((a) => a === 'major' || a === 'minor' || a === 'patch');

const from = currentVersion();
const to = argv.find((a) => /^\d+\.\d+\.\d+/.test(a)) ?? bumpVersion(from, level ?? 'patch');
const tag = `v${to}`;

const branch = git(['branch', '--show-current'], { capture: true });
const checks = releaseChecks({
  version: to,
  branch,
  // `--untracked-files=no` is the point: `git commit` cannot include an untracked
  // file, so a scratch note in the tree has nothing to do with the release commit.
  // Counting them made this refuse every real release while the dry run read the
  // same tree as clean.
  dirty: git(['status', '--porcelain', '--untracked-files=no'], { capture: true }) !== '',
  tagExists:
    spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd: repoRoot })
      .status === 0,
});

if (!checks.ok) {
  const lines = checks.errors.map((error) => `  ${error}`).join('\n');
  // A dry run reports the same problems rather than pretending they are not there:
  // it previews the real run, and the real run refuses.
  if (!dryRun) fail(`cannot release ${tag}:\n${lines}`);
  console.log(`Would refuse this release:\n${lines}\n`);
}

console.log(`Branch:   ${branch}`);
console.log(`Version:  ${from} -> ${to}`);
console.log(`Tag:      v${to}`);
console.log();

if (dryRun) {
  console.log('Dry run. Would write:');
  for (const file of VERSION_FILES) console.log(`  ${file} -> ${to}`);
  console.log();
  console.log(`Would run: git commit -m "chore: release ${tag}"`);
  console.log(`Would run: git tag ${tag}`);
  console.log(`Would run: git push && git push origin ${tag}`);
  process.exit(0);
}

// The push is the one step that can fail for a reason outside this repository - an
// expired credential, a network that cannot reach the remote - and it is the last
// thing here. A dry-run push exercises the credential while the tree is still
// clean, so that failure cannot leave a version bump committed but untagged.
git(['push', '--dry-run']);

try {
  writeVersion(to);
} catch (error) {
  fail(error.message);
}

// The version files by name, not `commit -a`: the release commit is the bump and
// nothing else, whatever else happens to be modified in the tree.
git(['add', ...VERSION_FILES]);
git(['commit', '-m', `chore: release ${tag}`]);
git(['tag', tag]);
git(['push']);
git(['push', 'origin', tag]);

console.log(`\nPushed tag ${tag}. The release workflow will build and publish it to R2.`);
console.log('Watch it at: https://github.com/HadiLePanda/pandawan-launcher/actions');
