#!/usr/bin/env node
/**
 * Delete old build directories for a game/channel on R2.
 *
 * Builds are version-stamped, so each publish adds a directory that nothing ever
 * overwrites. That is what makes the immutable cache header safe, but it also
 * means storage grows by a full build every release. This keeps the newest N and
 * offers to delete the rest.
 *
 *   npm run prune:builds -- --game-id misspell --channel alpha --keep 3
 *
 * Never deletes anything without an interactive confirmation, and never touches
 * the manifest or the builds the manifest currently points at. `--yes` skips the
 * prompt for scripted use; `--dry-run` only reports.
 */

import { spawnSync } from 'node:child_process';

import {
  deletePrefix,
  fail,
  isMangledKey,
  listKeysWithMeta,
  r2Config,
  run,
  S3,
} from './lib/r2.mjs';
import { parseArgs } from './lib/args.mjs';
import { catalogGameId } from './lib/catalog-edit.mjs';
import { CHANNELS } from './lib/metadata-fields.mjs';
import { planPrune, readActiveVersion, readPinnedVersions } from './lib/prune-plan.mjs';

const args = parseArgs(process.argv.slice(2));
const gameId = args['game-id'];
const channel = args.channel ?? 'stable';
const keep = Number.parseInt(args.keep ?? '3', 10);
const dryRun = Boolean(args['dry-run']);
const assumeYes = Boolean(args.yes);
const cleanFlat = Boolean(args['clean-flat']);
const olderThanDays = args['older-than'] ? Number.parseInt(args['older-than'], 10) : null;

if (!gameId) {
  fail(`--game-id is required.\n  Example: --game-id misspell --channel alpha --keep 3`);
}

// This is the one script that deletes recursively, so the id and channel are
// checked before anything is listed: an id carrying `/` or `..` would resolve the
// prefix to another game's builds, and a bare `--token` is read as a flag. Same
// validator the publish paths use, so a publish and a prune cannot disagree.
const gameIdCheck = catalogGameId(gameId);
if (!gameIdCheck.ok) fail(`--game-id: ${gameIdCheck.error}`);
if (!CHANNELS.includes(channel)) {
  fail(`--channel must be one of ${CHANNELS.join(', ')} (got "${channel}").`);
}
if (!Number.isInteger(keep) || keep < 1) {
  fail(`--keep must be a positive integer (got ${args.keep}).`);
}
if (olderThanDays !== null && (!Number.isInteger(olderThanDays) || olderThanDays < 1)) {
  fail(`--older-than must be a positive number of days (got ${args['older-than']}).`);
}

const { bucket, endpoint } = r2Config();
const prefix = `games/${gameId}/${channel}`;

console.log(`Game:    ${gameId}`);
console.log(`Channel: ${channel}`);
console.log(`Keep:    ${keep} newest build(s)\n`);

const keys = listKeysWithMeta(S3.s3Uri(bucket, prefix), { endpoint });

// Read the pins after the listing but before planning: planPrune needs them, and
// a const referenced before its declaration throws a temporal-dead-zone error.
const activeVersions = (() => {
  const origin = process.env.R2_CDN_ORIGIN || process.env.VITE_CDN_ORIGIN;
  // A network failure must not read the same as "the document is absent": an
  // empty pin list unprotects a pinned older build, which prune then deletes.
  const read = (file) => {
    const url = `${origin}/games/${gameId}/${channel}/${file}`;
    const res = spawnSync('curl', ['-s', '-o', '-', '-w', '\n%{http_code}', url], {
      encoding: 'utf8',
      shell: false,
    });
    if (res.status !== 0) {
      fail(
        `could not read ${file} from the CDN (curl exit ${res.status}). Refusing to prune: ` +
          'without the pins, a build a platform is live on could be deleted.'
      );
    }
    const out = res.stdout ?? '';
    const split = out.lastIndexOf('\n');
    const status = Number(out.slice(split + 1));
    if (status === 404) return null;
    if (status !== 200) {
      fail(
        `reading ${file} returned HTTP ${status}. Refusing to prune: ` +
          'without the pins, a build a platform is live on could be deleted.'
      );
    }
    return out.slice(0, split);
  };

  const pinned = Object.values(readPinnedVersions(read('latest.json')) ?? {});
  const manifestVersion = readActiveVersion(read('manifest.json'));
  return [...new Set([...pinned, manifestVersion].filter(Boolean))];
})();

const { all, flatLeftovers, doomed, skippedAsYoung } = planPrune(
  keys,
  prefix,
  keep,
  activeVersions,
  { olderThanDays }
);

console.log(`Found ${all.length} build(s):`);
for (const [version, info] of all) {
  console.log(`  ${version}  (${info.objects} objects)`);
}

if (flatLeftovers.length > 0) {
  console.log(`\n${flatLeftovers.length} leftover object(s) from the old flat layout:`);
  const shown = new Set(flatLeftovers.map((k) => k.slice(prefix.length + 1).split('/')[0]));
  for (const name of shown) console.log(`  ${name}`);
  console.log('  (manifest.json is live and is NOT a candidate.)');
  console.log('\nRemove them with:');
  console.log(
    `  npm run prune:builds -- --game-id ${gameId} --channel ${channel} --clean-flat --yes`
  );
}

// --clean-flat removes the pre-layout leftovers one key at a time. A recursive
// delete on the channel prefix would take the live manifest with them.
if (cleanFlat) {
  const targets = [...doomed.map(([version]) => `${prefix}/${version}/`), ...flatLeftovers];

  if (targets.length === 0) {
    console.log('\nNothing to delete.');
    process.exit(0);
  }

  console.log(`\nDeleting ${targets.length} prefix(es):`);
  for (const [version] of doomed) console.log(`  build ${version}`);
  if (flatLeftovers.length > 0) console.log(`  ${flatLeftovers.length} flat-layout object(s)`);

  if (!dryRun && !assumeYes) {
    process.stdout.write(`\nThis cannot be undone. Continue? [y/N] `);
    const answer = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', '$Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")'],
      { encoding: 'utf8', shell: false }
    );
    if ((answer.stdout || '').trim().toLowerCase() !== 'y') {
      console.log('\nCancelled. Nothing was deleted.');
      process.exit(0);
    }
  }

  if (dryRun) {
    console.log('\nDry run. Nothing was deleted.');
    process.exit(0);
  }

  for (const [version] of doomed) {
    deletePrefix(S3.s3Uri(bucket, `${prefix}/${version}/`), { endpoint });
  }
  // A key the CLI mangled cannot be deleted by name: the name it printed is not
  // the name R2 stored. Delete its parent folder instead. That is safe only when
  // the parent is DEEPER than the channel prefix -- a leftover sitting directly
  // under `games/<id>/<channel>/` resolves to the prefix itself, and deleting that
  // recursively would take the live manifest, latest.json and every build with it.
  // Artwork is written flat into exactly that level, so this is not hypothetical.
  let mangled = 0;
  for (const key of flatLeftovers) {
    if (isMangledKey(key)) {
      const dir = key.slice(0, key.lastIndexOf('/') + 1);
      if (!dir || !dir.startsWith(prefix)) continue;
      if (dir === `${prefix}/`) {
        console.log(
          `  refusing to delete ${dir}: that is the channel root, not a leftover folder.`
        );
        continue;
      }
      mangled += 1;
      deletePrefix(S3.s3Uri(bucket, dir), { endpoint });
      continue;
    }
    run('aws', ['s3', 'rm', S3.s3Uri(bucket, key), '--endpoint-url', endpoint], `Deleting ${key}`);
  }

  console.log(
    `\nDone. Removed ${doomed.length} build(s) and ${flatLeftovers.length} flat object(s).`
  );
  if (mangled > 0) {
    console.log(`${mangled} key(s) had a mangled encoding; deleted their parent folders instead.`);
  }
  process.exit(0);
}

if (all.length <= keep && flatLeftovers.length === 0) {
  console.log(`\nNothing to prune: ${all.length} build(s), keeping ${keep}.`);
  process.exit(0);
}

if (doomed.length === 0) {
  console.log(`\nNothing to prune: the ${keep} newest build(s) cover everything.`);
  process.exit(0);
}

const totalObjects = doomed.reduce((sum, [, info]) => sum + info.objects, 0);
console.log(`\nWould delete ${doomed.length} build(s), ${totalObjects} objects:`);
for (const [version, info] of doomed) {
  console.log(`  ${version}  (${info.objects} objects)`);
}

if (activeVersions.length > 0) {
  console.log(`\nPinned build(s), never deleted: ${activeVersions.join(', ')}`);
  if (olderThanDays !== null) {
    console.log('  The age rule does not override a pin.');
  }
}

if (dryRun) {
  console.log('\nDry run. Nothing was deleted.');
  process.exit(0);
}

console.log('\nThis cannot be undone: those builds are no longer downloadable.');
if (!assumeYes) {
  process.stdout.write(`Delete ${doomed.length} build(s)? [y/N] `);
  const answer = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', '$Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")'],
    {
      encoding: 'utf8',
      shell: false,
    }
  );
  const confirmed = (answer.stdout || '').trim().toLowerCase() === 'y';
  if (!confirmed) {
    console.log('\nCancelled. Nothing was deleted.');
    process.exit(0);
  }
}

for (const [version] of doomed) {
  deletePrefix(S3.s3Uri(bucket, `${prefix}/${version}/`), { endpoint });
}

console.log(`\nDeleted ${doomed.length} build(s).`);
