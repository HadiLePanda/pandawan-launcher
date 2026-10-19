/**
 * Re-sign the manifests a published game already has.
 *
 *   npm run resign:manifests -- --game-id example-game --channel stable
 *   npm run resign:manifests -- --all
 *
 * The launcher refuses a manifest whose signature is missing, so every game published
 * before signing existed needs one before a launcher that verifies reaches players.
 * Only the .sig files are written: the manifest bytes are the ones clients already
 * hold, and rewriting them would change what a client with the old copy expects.
 *
 * latest.json is the other document the launcher verifies, and it is re-signed by
 * backfill-latest.mjs, which rewrites it from the published manifests.
 *
 * Dry run unless --confirm is passed, like every other publish verb.
 */

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  IMMUTABLE,
  NO_CACHE,
  S3,
  fail,
  listKeysWithMeta,
  repoRoot,
  r2Config,
  run,
  upload,
} from './lib/r2.mjs';
import { CATALOG_KEY, cdnUrl } from './lib/r2-keys.mjs';

import { parseArgs } from './lib/args.mjs';
import { catalogGameId } from './lib/catalog-edit.mjs';
import { checkReleaseKey, signFile } from './lib/manifest-sign.mjs';
import { CHANNELS } from './lib/metadata-fields.mjs';
import { planResign } from './lib/resign-plan.mjs';
import { secretKeyPath } from './lib/updater-key.mjs';

const CACHE = { 'no-cache': NO_CACHE, immutable: IMMUTABLE };

const args = parseArgs(process.argv.slice(2));
const dryRun = !args.confirm;
const force = Boolean(args.force);

const { bucket, cdnOrigin, endpoint } = r2Config();

// The key is checked before anything is read or uploaded: a publish without it would
// leave a game no client can install, and a missing key must cost nothing.
const keyPath = secretKeyPath(repoRoot);
const key = checkReleaseKey(keyPath);
if (!key.ok) fail(key.detail);

/** One `{ id, channel }` to re-sign. */
function target(gameId, channel) {
  const check = catalogGameId(gameId);
  if (!check.ok) fail(`--game-id ${gameId}: ${check.error}`);
  if (!CHANNELS.includes(channel)) {
    fail(`--channel must be one of ${CHANNELS.join(', ')} (got "${channel}").`);
  }
  return { id: check.id, channel };
}

async function targets() {
  if (args['game-id']) return [target(args['game-id'], args.channel ?? 'stable')];
  if (!args.all) fail('--game-id is required, or --all to re-sign every published game.');

  const response = await fetch(cdnUrl(cdnOrigin, CATALOG_KEY));
  if (!response.ok) fail(`could not read the catalog (HTTP ${response.status}).`);
  const catalog = await response.json();
  const games = Array.isArray(catalog?.games) ? catalog.games : [];
  if (!games.length) fail('the published catalog lists no games.');
  return games
    .filter((game) => game?.id)
    .map((game) => target(String(game.id), String(game.channel ?? 'stable')));
}

const staging = path.join(repoRoot, 'dist', 'resign-staging');
let signed = 0;
let alreadySigned = 0;

try {
  for (const game of await targets()) {
    const prefix = `games/${game.id}/${game.channel}`;
    const keys = listKeysWithMeta(S3.s3Uri(bucket, prefix), { endpoint, throwOnFailure: true });
    const plan = planResign(keys, prefix, { force });

    console.log(`\n${game.id} (${game.channel})`);
    if (!plan.sign.length && !plan.skip.length) {
      console.log('  no published manifest found');
      continue;
    }

    alreadySigned += plan.skip.length;
    for (const entry of plan.skip) console.log(`  already signed: ${entry.key}`);
    if (!plan.sign.length) continue;

    mkdirSync(staging, { recursive: true });
    for (const entry of plan.sign) {
      const local = path.join(staging, path.basename(path.dirname(entry.key)), 'manifest.json');
      mkdirSync(path.dirname(local), { recursive: true });

      if (dryRun) {
        console.log(`  would sign: ${entry.key} (${entry.cache})`);
        signed += 1;
        continue;
      }

      run(
        'aws',
        [
          's3',
          'cp',
          S3.s3Uri(bucket, entry.key),
          local,
          '--endpoint-url',
          endpoint,
          '--no-progress',
        ],
        `Downloading ${entry.key}`
      );

      const result = signFile(local, { repoRoot, keyPath });
      if (!result.ok) fail(result.detail);

      // The signature goes up alone: the document is already there, byte for byte.
      upload(`${local}.sig`, S3.s3Uri(bucket, `${entry.key}.sig`), {
        endpoint,
        cacheControl: CACHE[entry.cache],
        contentType: 'text/plain',
      });
      console.log(`  signed: ${entry.key} (${entry.cache})`);
      signed += 1;
    }
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

console.log(
  `\n${dryRun ? 'Would sign' : 'Signed'} ${signed} manifest(s); ${alreadySigned} already had a signature.`
);
if (dryRun) console.log('Nothing was uploaded. Pass --confirm to write the signatures.');
else
  console.log('Now re-sign the version index: npm run backfill:latest -- --game-id <id> --confirm');
