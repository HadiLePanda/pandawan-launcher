#!/usr/bin/env node
/**
 * Move the current version's tag onto the current commit and re-trigger CI.
 *
 *   npm run retag                 show what would happen, change nothing
 *   npm run retag -- --confirm    delete the remote tag, re-point it at HEAD, push
 *
 * This is the recovery for a release whose tag points at a commit that failed
 * CI. Bumping to a new version also works, but the version never shipped - R2
 * still serves the previous one - so moving the tag keeps the number and rebuilds
 * the SAME release from a fixed commit. It changes no file: HEAD must already be
 * the commit that should be built, and the tree must be clean.
 *
 * Pushing the tag is what triggers .github/workflows/release.yml, exactly as a
 * fresh tag does. The remote tag is deleted before it is recreated so the push
 * is a create, which always fires a run - an update to a ref whose SHA the runner
 * cannot compare would be the one push that produced no build.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { retagPlan } from './lib/retag-plan.mjs';
import { parseGithubRepo } from './lib/repo.mjs';
import { repoRoot } from './lib/version.mjs';

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

/** Like git(), but a non-zero exit is an empty answer rather than a failure. */
function tryGit(args) {
  const res = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf-8' });
  return res.status === 0 ? res.stdout.trim() : '';
}

const argv = process.argv.slice(2);
const dryRun = !argv.includes('--confirm') || argv.includes('--dry-run');

const version = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')).version;
const tag = `v${version}`;
const branch = git(['branch', '--show-current'], { capture: true });
const headSha = git(['rev-parse', 'HEAD'], { capture: true });
const localTagSha = tryGit(['rev-parse', '-q', '--verify', `refs/tags/${tag}`]) || null;
const remoteLine = tryGit(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
const remoteTagSha = remoteLine ? remoteLine.split(/\s+/)[0] : null;

const plan = retagPlan({
  version,
  branch,
  // `--untracked-files=no`, as in release.mjs: a scratch file the tag cannot
  // include has nothing to do with whether this is safe.
  dirty: git(['status', '--porcelain', '--untracked-files=no'], { capture: true }) !== '',
  headSha,
  tagSha: localTagSha,
});

if (!plan.ok) {
  const lines = plan.errors.map((error) => `  ${error}`).join('\n');
  // A dry run reports the same problems rather than pretending they are not there.
  if (!dryRun) fail(`cannot move ${tag}:\n${lines}`);
  console.log(`Would refuse to move ${tag}:\n${lines}\n`);
}

console.log(`Branch:   ${branch}`);
console.log(`Tag:      ${tag}`);
console.log(`Tag at:   ${localTagSha ? localTagSha.slice(0, 7) : '(not created)'}`);
console.log(`HEAD:     ${headSha.slice(0, 7)}`);
console.log(`Remote:   ${remoteTagSha ? remoteTagSha.slice(0, 7) : '(not pushed)'}`);
console.log();

if (dryRun) {
  console.log('Dry run. Would run:');
  if (remoteTagSha) console.log(`  git push origin :refs/tags/${tag}`);
  console.log(`  git tag -f ${tag}`);
  console.log(`  git push origin ${tag}`);
  console.log('  git push');
  process.exit(0);
}

// The branch push is exercised first: a credential problem is the one failure
// that would otherwise leave the tag moved but unpushed.
git(['push', '--dry-run']);
if (remoteTagSha) git(['push', 'origin', `:refs/tags/${tag}`]);
git(['tag', '-f', tag]);
git(['push', 'origin', tag]);
git(['push']);

console.log(
  `\nMoved ${tag} to ${headSha.slice(0, 7)} and pushed. The release workflow will rebuild it.`
);
// The owner is read from the remote, never named here: the URL must point at
// whatever repository the tag was pushed to, not at one baked into the script.
const repo = parseGithubRepo(git(['remote', 'get-url', 'origin'], { capture: true }));
if (repo) console.log(`Watch it at: https://github.com/${repo}/actions`);
