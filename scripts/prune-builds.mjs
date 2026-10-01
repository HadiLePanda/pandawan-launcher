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

import { deletePrefix, fail, isMangledKey, listKeys, r2Config, run, S3 } from './lib/r2.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    args[key] = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const gameId = args['game-id'];
const channel = args.channel ?? 'stable';
const keep = Number.parseInt(args.keep ?? '3', 10);
const dryRun = Boolean(args['dry-run']);
const assumeYes = Boolean(args.yes);
const cleanFlat = Boolean(args['clean-flat']);

if (!gameId) {
  fail(`--game-id is required.\n  Example: --game-id misspell --channel alpha --keep 3`);
}
if (!Number.isInteger(keep) || keep < 1) {
  fail(`--keep must be a positive integer (got ${args.keep}).`);
}

const { bucket, endpoint } = r2Config();
const prefix = `games/${gameId}/${channel}`;

console.log(`Game:    ${gameId}`);
console.log(`Channel: ${channel}`);
console.log(`Keep:    ${keep} newest build(s)\n`);

const keys = listKeys(S3.s3Uri(bucket, prefix), { endpoint });

const versions = new Map();
for (const key of keys) {
  const rest = key.slice(prefix.length + 1).split('/');
  if (rest.length < 2) continue;
  const version = rest[0];
  // A real version segment starts with a digit (0.4.0, 1.2, 2026.1). Requiring
  // that rules out the older flat layout's directories - D3D12, MonoBleedingEdge,
  // misspell_Data - which must never be mistaken for a build to delete. "contains
  // a digit" is not enough: D3D12 has a 3 and a 1.
  if (!/^\d/.test(version)) continue;
  if (!versions.has(version)) versions.set(version, { objects: 0, bytes: 0 });
  versions.get(version).objects += 1;
}

// `aws s3 ls --only-show-keys` does not report sizes, so this is an object count
// rather than a byte total. Good enough to show what is at stake before deleting.
const all = Array.from(versions.entries()).sort(([a], [b]) =>
  b.localeCompare(a, undefined, { numeric: true })
);
console.log(`Found ${all.length} build(s):`);
for (const [version, info] of all) {
  console.log(`  ${version}  (${info.objects} objects)`);
}

// Files left over from the pre-version-stamped layout sit directly under the
// channel prefix, alongside the manifest. They are dead weight - nothing points
// at them any more - but they cannot be swept with a recursive delete, because
// the manifest.json in the same directory is live. Listing by prefix would
// happily take it out too and break every install.
const flatLeftovers = keys.filter((key) => {
  const rest = key.slice(prefix.length + 1).split('/');
  if (rest[0] === 'manifest.json') return false;
  return !/^\d/.test(rest[0]);
});

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

// The manifest names the build clients are currently downloading. Deleting it
// would break every install, so it is excluded from the candidates regardless of
// age. Best-effort: if the manifest cannot be read we keep the newest build only.
let activeVersion = null;
try {
  const origin = process.env.R2_CDN_ORIGIN || process.env.VITE_CDN_ORIGIN;
  const manifestUrl = `${origin}/games/${gameId}/${channel}/manifest.json`;
  const res = spawnSync('curl', ['-sf', manifestUrl], { encoding: 'utf8', shell: false });
  if (res.status === 0 && res.stdout) activeVersion = JSON.parse(res.stdout).version;
} catch {
  // Treated as "unknown"; the keep logic below still protects the newest build.
}

const protectedVersions = new Set(all.slice(0, keep).map(([v]) => v));
if (activeVersion) protectedVersions.add(activeVersion);

const doomed = all.filter(([v]) => !protectedVersions.has(v));

// --clean-flat removes the pre-layout leftovers one key at a time. A recursive
// delete on the channel prefix would take the live manifest with them.
if (cleanFlat) {
  const targets = [...doomed.map(([version]) => `${prefix}/${version}/`), ...flatLeftovers];

  if (targets.length === 0) {
    console.log('\nNothing to delete.');
    process.exit(0);
  }

  console.log(`\nDeleting ${targets.length} prefix(es):`);
  for (const target of doomed) console.log(`  build ${target[0]}`);
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
  // the name R2 stored. Delete its parent folder instead. That is safe here -
  // the leftovers sit under the game's own flat layout, the live manifest is a
  // sibling rather than a child, and the versioned builds this script protects
  // live under a different prefix entirely.
  let mangled = 0;
  for (const key of flatLeftovers) {
    if (isMangledKey(key)) {
      mangled += 1;
      const dir = key.slice(0, key.lastIndexOf('/') + 1);
      if (!dir || !dir.startsWith(prefix)) continue;
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

if (activeVersion) {
  console.log(`\nActive build (from manifest): ${activeVersion} - never deleted.`);
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
