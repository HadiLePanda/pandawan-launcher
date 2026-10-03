#!/usr/bin/env node
/**
 * Cut and push a launcher release.
 *
 *   npm run release:launcher -- --version 0.2.0          (dry run, the default)
 *   npm run release:launcher -- --version 0.2.0 --confirm
 *
 * Bumps the three version files, commits, tags vX.Y.Z and pushes with the tag.
 * The tag is what triggers .github/workflows/release.yml, which builds and signs
 * the bundles on three platforms and leaves a draft GitHub release for
 * `release:publish` to upload to R2.
 *
 * A dry run changes nothing, including the version files - the point of reading
 * the plan first is to leave the tree exactly as it was.
 */

import { spawnSync } from 'node:child_process';

import { releaseChecks } from './lib/release-checks.mjs';
import { repoRoot, VERSION_FILES, writeVersion } from './lib/version.mjs';

const argv = process.argv.slice(2);
const confirm = argv.includes('--confirm');
const version = argv[argv.indexOf('--version') + 1];
const tag = `v${version}`;

function git(...args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr?.trim()}`);
  return result.stdout?.trim() ?? '';
}

function main() {
  const checks = releaseChecks({
    version,
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: git('status', '--porcelain', '--untracked-files=no') !== '',
    tagExists:
      spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd: repoRoot })
        .status === 0,
  });

  if (!checks.ok) {
    console.error(`cannot release ${tag}:`);
    for (const error of checks.errors) console.error(`  ${error}`);
    process.exit(1);
  }

  console.log(`release ${tag}`);
  console.log(`  bump ${VERSION_FILES.join(', ')} to ${version}`);
  console.log(`  git commit -m "chore(release): ${tag}"`);
  console.log(`  git tag -a ${tag}`);
  console.log(`  git push origin main --follow-tags`);

  if (!confirm) {
    console.log('\ndry run: nothing was written, committed, tagged or pushed');
    return;
  }

  for (const { file } of writeVersion(version).changed) console.log(`  bumped ${file}`);
  git('add', ...VERSION_FILES);
  git('commit', '-m', `chore(release): ${tag}`);
  git('tag', '-a', tag, '-m', tag);
  git('push', 'origin', 'main', '--follow-tags');
  console.log(
    `\n${tag} pushed. The signed build is running; publish it with release:publish once CI is done.`
  );
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
